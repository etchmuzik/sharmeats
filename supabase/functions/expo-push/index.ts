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
//
// [N4 i18n] Copy is localized per recipient via public.users.locale
// (en/ar/ru/it/de; guests/unknown fall back to en). Locales are resolved with
// ONE batched users query per request (never per-token), and messages are
// grouped by locale so each Expo chunk carries a single language. The COPY map
// lives in ./copy.ts so it can be unit-tested. Request contract is unchanged.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { type Locale, resolveCopy, normalizeLocale } from './copy.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_CHUNK_SIZE = 100; // hard cap per https://docs.expo.dev/push-notifications/sending-notifications/

interface PushBody {
  event: string;       // e.g. 'order_paid', 'order_accepted', 'order_out_for_delivery'
  orderId: string;
  // Optional explicit recipients; otherwise we resolve from the order.
  recipientUserIds?: string[];
  // Optional custom copy (marketing campaigns) — overrides the COPY map.
  title?: string;
  body?: string;
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoMessage {
  to: string;
  sound: 'default';
  title: string;
  body: string;
  data: { orderId: string; event: string };
}

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

    // Look up Expo tokens with their owning user, so copy can be localized per
    // recipient (table may not exist yet — handle gracefully).
    const { data: tokens, error } = await admin
      .from('push_tokens')
      .select('token, user_id')
      .in('user_id', userIds);
    if (error) {
      // push_tokens not provisioned yet — no-op, don't fail the order flow.
      return new Response('ok (push_tokens unavailable)', { status: 200 });
    }
    const validTokens = (tokens ?? []).filter(
      (t: { token: string; user_id: string }) => t.token?.startsWith('ExponentPushToken'),
    );
    if (validTokens.length === 0) return new Response('ok (no tokens)', { status: 200 });

    // Custom copy (campaigns) overrides the event COPY map when provided.
    const customTitle = body.title?.trim() || null;
    const customBody = body.body?.trim() || null;

    // [N4] Resolve each recipient's locale in ONE batched query (never
    // per-token). Guests, missing rows, or a failed lookup fall back to 'en',
    // which matches the old English-only behavior.
    const localeByUser = new Map<string, Locale>();
    if (!customTitle || !customBody) {
      const { data: userRows, error: localeErr } = await admin
        .from('users')
        .select('id, locale')
        .in('id', userIds);
      if (localeErr) {
        console.error(`expo-push: locale lookup failed (falling back to en): ${localeErr.message}`);
      } else {
        for (const u of (userRows ?? []) as { id: string; locale: string | null }[]) {
          localeByUser.set(u.id, normalizeLocale(u.locale));
        }
      }
    }

    // [N4] Group messages by locale so each Expo chunk carries one language.
    const messagesByLocale = new Map<Locale, ExpoMessage[]>();
    for (const t of validTokens as { token: string; user_id: string }[]) {
      const locale = localeByUser.get(t.user_id) ?? 'en';
      const copy = resolveCopy(body.event, locale);
      const message: ExpoMessage = {
        to: t.token,
        sound: 'default',
        title: customTitle ?? copy.title,
        body: customBody ?? copy.body,
        data: { orderId: body.orderId, event: body.event },
      };
      const group = messagesByLocale.get(locale);
      if (group) group.push(message);
      else messagesByLocale.set(locale, [message]);
    }

    // [M2] Send in Expo-sized chunks; collect dead tokens from error tickets.
    const deadTokens: string[] = [];
    let sent = 0;
    let total = 0;
    for (const [locale, messages] of messagesByLocale) {
      total += messages.length;
      for (let i = 0; i < messages.length; i += EXPO_CHUNK_SIZE) {
        const chunk = messages.slice(i, i + EXPO_CHUNK_SIZE);
        try {
          const res = await fetch(EXPO_PUSH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(chunk),
          });
          if (!res.ok) {
            console.error(`expo-push: Expo API ${res.status} for ${locale} chunk ${i / EXPO_CHUNK_SIZE}`);
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
    }

    // [M2] Prune tokens Expo says are dead so we stop pushing to them.
    if (deadTokens.length > 0) {
      const { error: pruneErr } = await admin.from('push_tokens').delete().in('token', deadTokens);
      if (pruneErr) console.error(`expo-push: failed to prune ${deadTokens.length} dead tokens: ${pruneErr.message}`);
      else console.log(`expo-push: pruned ${deadTokens.length} DeviceNotRegistered token(s)`);
    }

    return new Response(`ok (sent ${sent}/${total}, pruned ${deadTokens.length})`, { status: 200 });
  } catch (e) {
    return new Response(`error: ${e}`, { status: 500 });
  }
});
