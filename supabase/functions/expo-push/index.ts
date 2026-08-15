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
import { ESSENTIAL_EVENTS, recipientsAfterPrefs, type PrefRow } from './prefs.ts';
import {
  isRetryable,
  recordAttempts,
  recordMessage,
  settleAttempts,
  suppressMessage,
  type AttemptOutcome,
} from './outbox.ts';
import { parseRetryAttempts, sendRetryAttempts } from './retry.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_CHUNK_SIZE = 100; // hard cap per https://docs.expo.dev/push-notifications/sending-notifications/


interface PushBody {
  // SQL retry dispatcher contract. A retry carries exact attempt/token rows and
  // never re-enters the recipient fan-out path below.
  mode?: 'retry';
  attempts?: unknown;
  event?: string;       // e.g. 'order_paid', 'order_accepted', 'order_out_for_delivery'
  // The order this push is about. REQUIRED for order events; may be empty for
  // pushes that are not about an order (campaigns, wallet credit with no order).
  // See the orderId/route contract note below.
  orderId?: string;
  // Optional explicit recipients; otherwise we resolve from the order.
  recipientUserIds?: string[];
  // Optional custom copy (marketing campaigns) — overrides the COPY map.
  title?: string;
  body?: string;
  // Optional explicit in-app destination for a tap, e.g. '/rewards'. When absent
  // the client falls back to its orderId-based routing, so old senders and old
  // binaries keep working unchanged.
  route?: string;
  // The vertical this push is about ('food' | 'grocery' | 'pharmacy'), so the
  // copy can say "the pharmacy is preparing your order" rather than "sent to
  // the kitchen". Optional: senders that omit it get the order's snapshotted
  // vertical resolved below, and only if THAT is also unavailable does the copy
  // fall back to food wording — which is correct, because every order placed
  // before verticals existed was a food order.
  vertical?: string;
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
  // `route`, when the sender supplies one, is an explicit in-app destination
  // that takes precedence over orderId-based routing on the client.
  data: { orderId: string; event: string; route?: string };
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
    // Retry mode is deliberately handled before the fresh-send event contract.
    // Each row came from claim_push_retries and identifies ONE failed token. It
    // must not be converted back to recipientUserIds: doing that fans a retry
    // out to every healthy device the recipient owns.
    if (body.mode === 'retry') {
      const attempts = parseRetryAttempts(body.attempts);
      if (!attempts) return new Response('invalid retry attempts', { status: 400 });
      if (attempts.length === 0) return new Response('ok (no retry attempts)', { status: 200 });

      const admin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );

      const recipientIds = [...new Set(
        attempts
          .map((attempt) => attempt.recipientUserId)
          .filter((id): id is string => id !== null),
      )];
      const localeByUser = new Map<string, Locale>();
      if (recipientIds.length > 0) {
        const { data: userRows, error: localeErr } = await admin
          .from('users')
          .select('id, locale')
          .in('id', recipientIds);
        if (localeErr) {
          console.error(`expo-push retry: locale lookup failed (using en): ${localeErr.message}`);
        } else {
          for (const user of (userRows ?? []) as { id: string; locale: string | null }[]) {
            localeByUser.set(user.id, normalizeLocale(user.locale));
          }
        }
      }

      const summary = await sendRetryAttempts(attempts, {
        localeByUser,
        settleAttempt: async (outcome) => {
          const { error } = await admin.rpc('settle_push_attempt', {
            p_attempt_id: outcome.attemptId,
            p_status: outcome.status,
            p_ticket_id: outcome.ticketId,
            p_error_code: outcome.errorCode,
            p_error_detail: outcome.errorDetail,
          });
          if (error) {
            throw new Error(`could not settle retry attempt ${outcome.attemptId}: ${error.message}`);
          }
        },
      });

      if (summary.deadTokens.length > 0) {
        const { error: pruneErr } = await admin
          .from('push_tokens')
          .delete()
          .in('token', [...new Set(summary.deadTokens)]);
        if (pruneErr) {
          console.error(`expo-push retry: failed to prune dead tokens: ${pruneErr.message}`);
        }
      }

      return new Response(
        `ok (retry accepted ${summary.accepted}/${summary.total}, failed ${summary.failed}` +
          (summary.settleFailures > 0 ? `, unsettled ${summary.settleFailures}` : '') +
          ')',
        { status: 200 },
      );
    }

    // orderId/route contract (fixed 2026-07-27):
    //
    // This used to require a non-empty orderId for EVERY push, which had two
    // consequences, both live in production:
    //   1. Marketing campaigns (send_push_campaign) passed orderId '' and were
    //      rejected 400 here — while the campaign row had ALREADY been inserted
    //      and shown to the admin as "sent". Campaigns delivered nothing.
    //   2. Senders with no order to point at smuggled another id into the field
    //      to get past this check: credit_issued sent the USER id and
    //      referral_rewarded sent the referred friend's order id, so taps
    //      landed on /order/<not-an-order-of-mine>.
    // Now: event is required, orderId is optional, and `route` carries an
    // explicit destination. orderId still routes when present, so old senders
    // and already-installed binaries are unaffected.
    if (!body.event) return new Response('event required', { status: 400 });
    const orderId = body.orderId ?? '';

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Resolve recipients: explicit, else the order's customer.
    let userIds = body.recipientUserIds ?? [];
    if (userIds.length === 0 && orderId) {
      const { data: order } = await admin
        .from('orders')
        .select('user_id')
        .eq('id', orderId)
        .single();
      if (order?.user_id) userIds = [order.user_id];
    }
    if (userIds.length === 0) return new Response('ok (no recipients)', { status: 200 });

    // ---- Notification preferences (mig 138) --------------------------------
    //
    // Enforced HERE rather than in each of the 14 DB senders: this is the one
    // place that knows the final recipient list for every event (some senders
    // pass recipientUserIds, others let us resolve the order's customer), and
    // editing 14 SECURITY DEFINER bodies to add the same check is exactly the
    // "re-stating an old body reverts later hardening" trap in house rule 2.
    //
    // Only OPTIONAL events are filtered. ESSENTIAL_EVENTS below are exempt: a
    // customer who mutes notifications is asking for less noise, not to be left
    // standing outside while a driver waits, or to miss the fact that their
    // payment failed. Store policy and basic decency both treat these as
    // transactional service messages rather than notifications-by-preference.
    // Marketing has its own, stricter gate (marketing_allowed) in the sender.
    const filterable = !ESSENTIAL_EVENTS.has(body.event);
    if (filterable) {
      const { data: prefRows, error: prefErr } = await admin
        .from('notification_prefs')
        .select('user_id, transactional')
        .in('user_id', userIds);
      if (prefErr) {
        console.error(`expo-push: prefs lookup failed, sending anyway: ${prefErr.message}`);
      }
      const before = userIds.length;
      // A failed lookup passes null => fail OPEN (see prefs.ts).
      userIds = recipientsAfterPrefs(body.event, userIds, prefErr ? null : ((prefRows ?? []) as PrefRow[]));
      if (userIds.length < before) {
        console.log(
          `expo-push: ${before - userIds.length}/${before} recipient(s) opted out of '${body.event}'`,
        );
      }
      if (userIds.length === 0) {
        return new Response('ok (all recipients opted out)', { status: 200 });
      }
    }

    // Look up Expo tokens with their owning user, so copy can be localized per
    // recipient (table may not exist yet — handle gracefully).
    const { data: tokens, error } = await admin
      .from('push_tokens')
      // [P03-C] `id` is selected so push_attempts can reference the token row.
      // It is nullable there and ON DELETE SET NULL, so a missing id degrades to
      // "we tried this token text" rather than losing the attempt entirely.
      .select('id, token, user_id')
      .in('user_id', userIds);
    if (error) {
      // push_tokens not provisioned yet — no-op, don't fail the order flow.
      return new Response('ok (push_tokens unavailable)', { status: 200 });
    }
    const validTokens = (tokens ?? []).filter(
      (t: { id?: string; token: string; user_id: string }) =>
        t.token?.startsWith('ExponentPushToken'),
    );


    // Recording the "nobody has a token" case needs the copy/vertical values
    // resolved below, so the suppression row is written after they exist — see
    // the recordMessage call further down. Returning here without a row would
    // hide the case entirely, so the flag is carried instead.
    const noTokens = validTokens.length === 0;

    // Custom copy (campaigns) overrides the event COPY map when provided.
    const customTitle = body.title?.trim() || null;
    const customBody = body.body?.trim() || null;

    // [N4] Resolve each recipient's locale in ONE batched query (never
    // per-token). Guests, missing rows, or a failed lookup fall back to 'en',
    // which matches the old English-only behavior.
    // [E0] Which vertical is this push about? The copy layer needs it so a
    // grocery or pharmacy order is not described in restaurant language.
    //
    // Prefer what the sender told us. Fall back to the ORDER'S OWN SNAPSHOT
    // (orders.vertical_id, mig 157 — immutable, so a merchant reassigned later
    // never rewrites what an old push should have said). Only when both are
    // absent does resolveCopy default to food wording.
    let vertical: string | null = body.vertical?.trim().toLowerCase() || null;
    if (!vertical && orderId && (!customTitle || !customBody)) {
      const { data: ordRow, error: vErr } = await admin
        .from('orders')
        .select('vertical_id')
        .eq('id', orderId)
        .maybeSingle();
      if (vErr) {
        // Non-fatal: a failed lookup must not drop a delivery-critical push.
        // Copy degrades to food wording, which is what it was before this.
        console.error(`expo-push: vertical lookup failed (using default copy): ${vErr.message}`);
      } else {
        vertical = (ordRow as { vertical_id: string | null } | null)?.vertical_id ?? null;
      }
    }

    // [P03-C] Record the LOGICAL message. Placed here because it needs the
    // resolved copy overrides and vertical, and BEFORE the Expo call so that a
    // network failure has a row to attach itself to — the case that previously
    // vanished when index.ts caught the error and moved on.
    //
    // Recording NEVER blocks the send: outboxMsg is null on any failure (including
    // the outbox tables not being deployed) and everything below still runs.
    const outboxMsg = await recordMessage(admin, {
      event: body.event,
      orderId,
      recipientUserIds: userIds,
      route: body.route,
      vertical,
      customTitle,
      customBody,
      category: body.event === 'campaign' ? 'marketing' : 'operational',
    });

    if (noTokens) {
      if (outboxMsg) await suppressMessage(admin, outboxMsg.id, 'no_token');
      return new Response('ok (no tokens)', { status: 200 });
    }

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

    // [P03-C] One attempt row per token, created BEFORE the Expo call. A row that
    // only appeared after a successful response could never record a network
    // failure — exactly the case that used to vanish.
    const seeds = (validTokens as { id?: string; token: string; user_id: string }[]).map((t) => ({
      token: t.token,
      userId: t.user_id,
      tokenId: t.id ?? null,
    }));
    const attempts = outboxMsg ? await recordAttempts(admin, outboxMsg.id, seeds) : [];
    const attemptIdByToken = new Map<string, string | null>(
      attempts.map((a) => [a.token, a.attemptId]),
    );

    // [N4] Group messages by locale so each Expo chunk carries one language.
    // [P03-D] The token travels WITH the message so a positional ticket can be
    // attributed to the right attempt row. Expo answers tickets[j] for chunk[j],
    // and that correlation is the only link between a send and its receipt.
    const messagesByLocale = new Map<Locale, { msg: ExpoMessage; token: string }[]>();
    for (const t of validTokens as { token: string; user_id: string }[]) {
      const locale = localeByUser.get(t.user_id) ?? 'en';
      const copy = resolveCopy(body.event, locale, vertical);
      const message: ExpoMessage = {
        to: t.token,
        sound: 'default',
        title: customTitle ?? copy.title,
        body: customBody ?? copy.body,
        data: {
          orderId,
          event: body.event,
          ...(body.route ? { route: body.route } : {}),
          // [P03-F] The message id travels in the payload so a tap can be
          // attributed back to this send. Bounded and non-sensitive.
          ...(outboxMsg ? { messageId: outboxMsg.id } : {}),
        },
      };
      const group = messagesByLocale.get(locale);
      if (group) group.push({ msg: message, token: t.token });
      else messagesByLocale.set(locale, [{ msg: message, token: t.token }]);
    }

    // [M2] Send in Expo-sized chunks; collect dead tokens from error tickets.
    const deadTokens: string[] = [];
    let sent = 0;
    let total = 0;
    // [P03-D] Every attempt's outcome is collected here and written once at the
    // end, so a partial batch failure is recorded per token rather than lost.
    const outcomes: AttemptOutcome[] = [];
    for (const [locale, messages] of messagesByLocale) {
      total += messages.length;
      for (let i = 0; i < messages.length; i += EXPO_CHUNK_SIZE) {
        const chunk = messages.slice(i, i + EXPO_CHUNK_SIZE);
        try {
          const res = await fetch(EXPO_PUSH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            // Only the Expo message is sent; the token we tracked alongside it is
            // ours and must not leak into the request body.
            body: JSON.stringify(chunk.map((c) => c.msg)),
          });
          if (!res.ok) {
            // [P03-D] THE BUG THIS PACKAGE EXISTS TO FIX. This used to `continue`,
            // silently discarding the whole chunk with no record that these
            // customers were owed a notification. Now every message in the chunk
            // gets a durable outcome, and a 429/5xx is marked retryable so the
            // dispatcher picks it up.
            console.error(`expo-push: Expo API ${res.status} for ${locale} chunk ${i / EXPO_CHUNK_SIZE}`);
            const retryable = res.status === 429 || res.status >= 500;
            for (const c of chunk) {
              outcomes.push({
                attemptId: attemptIdByToken.get(c.token) ?? null,
                status: retryable ? 'retryable_failed' : 'permanent_failed',
                errorCode: `HTTP_${res.status}`,
                // Bounded, and deliberately NOT the response body: an upstream
                // error page could echo the notification content.
                errorDetail: `Expo API returned ${res.status}`,
              });
            }
            continue; // other chunks still go out
          }
          const payload = (await res.json().catch(() => null)) as { data?: ExpoTicket[] } | null;
          const tickets = payload?.data ?? [];
          // Tickets are positional: tickets[j] answers chunk[j]. That correlation
          // is the ONLY link between a send and the receipt polled for it later,
          // which is why the token was carried through the grouping above.
          tickets.forEach((ticket, j) => {
            const entry = chunk[j];
            const attemptId = entry ? attemptIdByToken.get(entry.token) ?? null : null;
            if (ticket.status === 'ok') {
              sent++;
              outcomes.push({
                attemptId,
                // [P03-D] The ticket id, previously parsed and thrown away. Slice
                // E cannot exist without it.
                ticketId: ticket.id ?? null,
                status: 'expo_accepted',
              });
              return;
            }
            const code = ticket.details?.error;
            if (code === 'DeviceNotRegistered' && entry) {
              deadTokens.push(entry.token);
            } else {
              console.error(`expo-push: ticket error ${code ?? 'unknown'}: ${ticket.message ?? ''}`);
            }
            outcomes.push({
              attemptId,
              ticketId: ticket.id ?? null,
              status: isRetryable(code) ? 'retryable_failed' : 'permanent_failed',
              errorCode: code ?? null,
              // ticket.message is Expo's own diagnostic, never our copy.
              errorDetail: ticket.message ?? null,
            });
          });
          // A malformed response with fewer tickets than messages would otherwise
          // leave those attempts stuck at 'queued' forever.
          if (tickets.length < chunk.length) {
            for (let k = tickets.length; k < chunk.length; k++) {
              outcomes.push({
                attemptId: attemptIdByToken.get(chunk[k].token) ?? null,
                status: 'retryable_failed',
                errorCode: 'NO_TICKET',
                errorDetail: 'Expo returned fewer tickets than messages sent',
              });
            }
          }
        } catch (e) {
          console.error(`expo-push: network error sending chunk: ${e}`);
          // Network failure is retryable by definition, and now recorded.
          for (const c of chunk) {
            outcomes.push({
              attemptId: attemptIdByToken.get(c.token) ?? null,
              status: 'retryable_failed',
              errorCode: 'NETWORK',
              errorDetail: 'network error sending to Expo',
            });
          }
        }
      }
    }

    // [P03-C/D] Persist every outcome and roll the message up. `complete` means
    // Expo accepted all attempts — NOT delivered and NOT seen.
    if (outboxMsg) await settleAttempts(admin, outboxMsg.id, outcomes);

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
