// Supabase Edge Function — Expo push fan-out (Sharm Eats).
//
// Internal function called by RPCs/webhooks (service-role auth) to push order
// status notifications to the right surface(s). Looks up Expo push tokens from
// public.push_tokens, maps an event to a localized title/body, and POSTs to
// Expo's push API.
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
// We fail CLOSED: if the secret is NOT configured the function returns 503 and
// refuses to process, so an un-provisioned environment can never be driven
// unauthenticated. If the secret IS set, a missing/mismatched header is 401.
//
// [M2 hardening] Messages are sent in chunks of 100 (Expo's per-request cap —
// one oversized POST would previously have been rejected wholesale), and the
// ticket response is parsed instead of discarded: a DeviceNotRegistered ticket
// deletes that token from push_tokens so we stop pushing to dead devices
// (Expo throttles senders that keep hitting unregistered tokens). Tickets are
// positional within a chunk: ticket[i] answers message[i].

import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_CHUNK_SIZE = 100; // hard cap per https://docs.expo.dev/push-notifications/sending-notifications/

interface PushBody {
  event: string;       // e.g. 'order_paid', 'order_accepted', 'order_out_for_delivery'
  orderId: string;
  // Optional explicit recipients; otherwise we resolve from the order.
  recipientUserIds?: string[];
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

// Minimal event -> copy map. Real i18n lives in the apps; this is a
// server-side fallback in English/Arabic-ready keys.
const COPY: Record<string, { title: string; body: string }> = {
  order_paid: { title: 'Payment confirmed', body: 'Your order is confirmed and sent to the kitchen.' },
  order_accepted: { title: 'Order accepted', body: 'The restaurant is preparing your order.' },
  order_ready: { title: 'Order ready', body: 'Your order is ready and waiting for pickup.' },
  order_picked_up: { title: 'On the way', body: 'Your driver has picked up your order.' },
  order_out_for_delivery: { title: 'Out for delivery', body: 'Your driver is heading to you.' },
  order_delivered: { title: 'Delivered', body: 'Enjoy your meal! Tap to rate your order.' },
  new_offer: { title: 'New delivery offer', body: 'You have a new job. Tap to accept.' },
  referral_rewarded: { title: 'Referral reward earned', body: 'Your friend ordered — your discount is ready. Tap to see it.' },
  order_placed_merchant: { title: 'New order', body: 'A new order just came in. Tap to accept it.' },
  order_rejected: { title: 'Order declined', body: 'The restaurant could not take your order. Any charge is refunded.' },
  order_cancelled: { title: 'Order cancelled', body: 'Your order was cancelled. Tap for details.' },
  order_cancelled_merchant: { title: 'Order cancelled', body: 'An order was cancelled — you can stop preparing it.' },
  payment_failed: { title: 'Payment failed', body: 'Your card payment did not go through. Tap to try again.' },
  credit_issued: { title: 'Credit added', body: 'Credit was added to your Sharm Eats wallet. Tap to see it.' },
  new_message: { title: 'New message', body: 'You have a new message about your order. Tap to reply.' },
  support_reply: { title: 'Support replied', body: 'Our team answered your message. Tap to read it.' },
  support_new_message: { title: 'New support message', body: 'A customer needs help. Tap to respond.' },
  driver_assigned: { title: 'Driver on the way', body: 'A driver is heading to the restaurant for your order.' },
  order_ready_pickup: { title: 'Order ready for pickup', body: 'An order is ready — head to the restaurant to collect it.' },
  low_rating: { title: 'Low rating received', body: 'A customer left a low rating on a recent order. Tap to review.' },
  tier_promoted: { title: 'You leveled up!', body: 'You reached a new rewards tier. Tap to see your new perks.' },
};

Deno.serve(async (req: Request) => {
  try {
    // [M4] Authenticate the internal caller via a shared secret. Fail closed:
    // refuse to process (503) when the secret is unconfigured, so the function
    // can never be driven unauthenticated by a remote caller.
    const expectedSecret = Deno.env.get('PUSH_INTERNAL_SECRET');
    if (!expectedSecret) {
      console.error('PUSH_INTERNAL_SECRET not set — refusing to process. Set it via `supabase secrets set`.');
      return new Response('not configured', { status: 503 });
    }
    if (req.headers.get('x-internal-secret') !== expectedSecret) {
      return new Response('unauthorized', { status: 401 });
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

    // [M2] Send in Expo-sized chunks; collect dead tokens from error tickets.
    const deadTokens: string[] = [];
    let sent = 0;
    for (let i = 0; i < messages.length; i += EXPO_CHUNK_SIZE) {
      const chunk = messages.slice(i, i + EXPO_CHUNK_SIZE);
      try {
        const res = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(chunk),
        });
        if (!res.ok) {
          console.error(`expo-push: Expo API ${res.status} for chunk ${i / EXPO_CHUNK_SIZE}`);
          continue; // best-effort: other chunks still go out
        }
        const payload = (await res.json().catch(() => null)) as { data?: ExpoTicket[] } | null;
        const tickets = payload?.data ?? [];
        // Tickets are positional: tickets[j] answers chunk[j].
        tickets.forEach((ticket, j) => {
          if (ticket.status === 'ok') {
            sent++;
            return;
          }
          const code = ticket.details?.error;
          if (code === 'DeviceNotRegistered' && chunk[j]) {
            deadTokens.push(chunk[j].to);
          } else {
            console.error(`expo-push: ticket error ${code ?? 'unknown'}: ${ticket.message ?? ''}`);
          }
        });
      } catch (e) {
        console.error(`expo-push: network error sending chunk: ${e}`);
      }
    }

    // [M2] Prune tokens Expo says are dead so we stop pushing to them.
    if (deadTokens.length > 0) {
      const { error: pruneErr } = await admin.from('push_tokens').delete().in('token', deadTokens);
      if (pruneErr) console.error(`expo-push: failed to prune ${deadTokens.length} dead tokens: ${pruneErr.message}`);
      else console.log(`expo-push: pruned ${deadTokens.length} DeviceNotRegistered token(s)`);
    }

    return new Response(`ok (sent ${sent}/${messages.length}, pruned ${deadTokens.length})`, { status: 200 });
  } catch (e) {
    return new Response(`error: ${e}`, { status: 500 });
  }
});
