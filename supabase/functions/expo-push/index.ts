// Supabase Edge Function — Expo push fan-out (Sharm Eats).
//
// Internal function called by RPCs/webhooks (service-role auth) to push order
// status notifications to the right surface(s). Looks up Expo push tokens from
// public.push_tokens (added in a small follow-up migration), maps an event to a
// localized title/body, and POSTs to Expo's push API.
//
// Gracefully no-ops if push_tokens is absent or a recipient has no token, so it
// never blocks the order flow.
//
// Deploy:
//   supabase functions deploy expo-push --no-verify-jwt --project-ref <REF>
// (Called server-to-server; not from clients.)
//
// Caller auth (audit M4): the function runs with --no-verify-jwt (so internal
// pg_net/RPC callers don't need a user JWT), which means without a check ANY
// caller who knows the URL could trigger push fan-out. We require a shared
// secret in the `x-internal-secret` header matching the PUSH_INTERNAL_SECRET
// env var. Set it once: `supabase secrets set PUSH_INTERNAL_SECRET=<random>`
// and pass the same header from every internal caller (net.http_post headers).
// If the secret is NOT configured we fail OPEN with a logged warning, so an
// un-provisioned environment never silently drops order notifications.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface PushBody {
  event: string;       // e.g. 'order_paid', 'order_accepted', 'order_out_for_delivery'
  orderId: string;
  // Optional explicit recipients; otherwise we resolve from the order.
  recipientUserIds?: string[];
}

// Minimal event -> copy map. Real i18n lives in packages/shared/i18n; this is a
// server-side fallback in English/Arabic-ready keys.
const COPY: Record<string, { title: string; body: string }> = {
  order_paid: { title: 'Payment confirmed', body: 'Your order is confirmed and sent to the kitchen.' },
  order_accepted: { title: 'Order accepted', body: 'The restaurant is preparing your order.' },
  order_ready: { title: 'Order ready', body: 'Your order is ready and waiting for pickup.' },
  order_picked_up: { title: 'On the way', body: 'Your driver has picked up your order.' },
  order_out_for_delivery: { title: 'Out for delivery', body: 'Your driver is heading to you.' },
  order_delivered: { title: 'Delivered', body: 'Enjoy your meal! Tap to rate your order.' },
  new_offer: { title: 'New delivery offer', body: 'You have a new job. Tap to accept.' },
};

Deno.serve(async (req: Request) => {
  try {
    // [M4] Authenticate the internal caller via a shared secret. Fail open
    // (with a warning) only when the secret is unconfigured, so notifications
    // aren't lost in an environment that hasn't set it yet.
    const expectedSecret = Deno.env.get('PUSH_INTERNAL_SECRET');
    if (expectedSecret) {
      if (req.headers.get('x-internal-secret') !== expectedSecret) {
        return new Response('unauthorized', { status: 401 });
      }
    } else {
      console.warn('PUSH_INTERNAL_SECRET not set — expo-push is unauthenticated. Set it via `supabase secrets set`.');
    }

    let body: PushBody;
    try {
      body = await req.json();
    } catch {
      return new Response('bad json', { status: 400 });
    }
    if (!body.event || !body.orderId) return new Response('event + orderId required', { status: 400 });

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Resolve recipients: explicit, else the order's customer.
    let userIds = body.recipientUserIds ?? [];
    if (userIds.length === 0) {
      const { data: order } = await admin
        .from('orders')
        .select('user_id')
        .eq('id', body.orderId)
        .single();
      if (order?.user_id) userIds = [order.user_id];
    }
    if (userIds.length === 0) return new Response('ok (no recipients)', { status: 200 });

    // Look up Expo tokens (table may not exist yet — handle gracefully).
    const { data: tokens, error } = await admin
      .from('push_tokens')
      .select('token')
      .in('user_id', userIds);
    if (error) {
      // push_tokens not provisioned yet — no-op, don't fail the order flow.
      return new Response('ok (push_tokens unavailable)', { status: 200 });
    }
    const messages = (tokens ?? [])
      .filter((t: { token: string }) => t.token?.startsWith('ExponentPushToken'))
      .map((t: { token: string }) => ({
        to: t.token,
        sound: 'default',
        title: COPY[body.event]?.title ?? 'Sharm Eats',
        body: COPY[body.event]?.body ?? 'Order update',
        data: { orderId: body.orderId, event: body.event },
      }));

    if (messages.length === 0) return new Response('ok (no tokens)', { status: 200 });

    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    }).catch(() => {});

    return new Response('ok', { status: 200 });
  } catch (e) {
    return new Response(`error: ${e}`, { status: 500 });
  }
});
