// expo-push-receipts — Package 03 Slice E.
//
// Asks Expo what happened to the tickets that expo-push stored, and settles each
// attempt accordingly. Until mig 171 there was no ticket to ask about: expo-push
// parsed tickets and discarded them, which is why this function could not exist.
//
// DEPLOY:
//   supabase functions deploy expo-push-receipts --no-verify-jwt --project-ref <REF>
// Called only by pg_cron via net.http_post, never by a client.
//
// CALLER AUTH — same model as expo-push, and fails CLOSED for the same reason.
// The function runs with --no-verify-jwt so the internal cron caller needs no user
// JWT, which means without a check any caller who knew the URL could drive it. It
// requires `x-internal-secret` to match PUSH_INTERNAL_SECRET. If the secret is
// NOT configured it returns 503 and refuses to run, so an un-provisioned
// environment can never be driven unauthenticated.
//
// WHAT A RECEIPT PROVES, AND WHAT IT DOES NOT. An Expo ticket means Expo accepted
// the message from us. A receipt means APNs/FCM accepted it from Expo. NEITHER
// means a device displayed it or a human saw it. That is why the terminal status
// here is `provider_accepted` and never `delivered` — an operator who reads
// "delivered" stops investigating the customer who never got their order update.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  chunkTicketIds,
  classifyReceipt,
  isProjectWideFailure,
  MIN_RECEIPT_AGE_MINUTES,
  shouldPruneToken,
  stillWorthSending,
  type ExpoReceipt,
} from './receipts.ts';

const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

/** How many attempts to settle per invocation, so one run stays bounded. */
const MAX_ATTEMPTS_PER_RUN = 5000;

interface AttemptRow {
  id: string;
  message_id: string;
  expo_ticket_id: string;
  token_snapshot: string;
  push_token_id: string | null;
  sent_at: string;
  push_messages: { expires_at: string } | null;
}

Deno.serve(async (req: Request) => {
  try {
    const expectedSecret = Deno.env.get('PUSH_INTERNAL_SECRET');
    if (!expectedSecret) {
      console.error(
        'PUSH_INTERNAL_SECRET not set — refusing to process. Set it via `supabase secrets set`.',
      );
      return new Response('not configured', { status: 503 });
    }
    if (req.headers.get('x-internal-secret') !== expectedSecret) {
      return new Response('unauthorized', { status: 401 });
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const now = new Date();
    // Only ask about tickets old enough for Expo to have decided. Asking sooner
    // reliably returns nothing and wastes a request against the rate limit.
    const readyBefore = new Date(now.getTime() - MIN_RECEIPT_AGE_MINUTES * 60_000);

    const { data, error } = await admin
      .from('push_attempts')
      .select('id, message_id, expo_ticket_id, token_snapshot, push_token_id, sent_at, push_messages(expires_at)')
      .eq('status', 'expo_accepted')
      .not('expo_ticket_id', 'is', null)
      .lte('sent_at', readyBefore.toISOString())
      .order('sent_at', { ascending: true })
      .limit(MAX_ATTEMPTS_PER_RUN);

    if (error) {
      console.error(`receipts: could not load attempts: ${error.message}`);
      return new Response(`error: ${error.message}`, { status: 500 });
    }

    const attempts = (data ?? []) as unknown as AttemptRow[];
    if (attempts.length === 0) {
      return new Response('ok (nothing awaiting receipts)', { status: 200 });
    }

    const byTicket = new Map<string, AttemptRow>();
    for (const a of attempts) byTicket.set(a.expo_ticket_id, a);

    let providerAccepted = 0;
    let permanent = 0;
    let retryable = 0;
    let expired = 0;
    let stillUnknown = 0;
    const deadTokens: string[] = [];
    const projectWideCodes = new Set<string>();

    for (const idChunk of chunkTicketIds([...byTicket.keys()])) {
      let receipts: Record<string, ExpoReceipt> = {};
      try {
        const res = await fetch(EXPO_RECEIPTS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ ids: idChunk }),
        });
        if (!res.ok) {
          // A failed lookup changes NOTHING. Every attempt in this chunk stays
          // `expo_accepted` and is retried on the next run — which is correct,
          // because we still do not know what happened to them. Marking them
          // failed here would re-send pushes that may well have arrived.
          console.error(`receipts: Expo getReceipts returned ${res.status}; leaving chunk for next run`);
          continue;
        }
        const payload = (await res.json().catch(() => null)) as
          | { data?: Record<string, ExpoReceipt> }
          | null;
        receipts = payload?.data ?? {};
      } catch (e) {
        console.error(`receipts: network error asking Expo: ${e}`);
        continue; // same reasoning as above
      }

      for (const ticketId of idChunk) {
        const attempt = byTicket.get(ticketId);
        if (!attempt) continue;
        const verdict = classifyReceipt(receipts[ticketId], {
          sentAt: new Date(attempt.sent_at),
          now,
        });

        if (verdict.kind === 'unknown') {
          stillUnknown++;
          continue; // deliberately no write
        }

        const patch: Record<string, unknown> = {
          receipt_checked_at: now.toISOString(),
        };

        if (verdict.kind === 'provider_accepted') {
          providerAccepted++;
          patch.status = 'provider_accepted';
          patch.settled_at = now.toISOString();
        } else if (verdict.kind === 'expired') {
          expired++;
          patch.status = 'expired';
          patch.settled_at = now.toISOString();
          patch.error_code = 'NO_RECEIPT';
          patch.error_detail = 'no receipt from Expo within the retention window';
        } else if (verdict.kind === 'permanent_failed') {
          permanent++;
          patch.status = 'permanent_failed';
          patch.settled_at = now.toISOString();
          patch.error_code = verdict.code;
          patch.error_detail = verdict.detail?.slice(0, 500) ?? null;
          if (shouldPruneToken(verdict.code)) deadTokens.push(attempt.token_snapshot);
          if (isProjectWideFailure(verdict.code)) projectWideCodes.add(verdict.code!);
        } else {
          // Retryable — but only while the business event is still worth sending.
          // push_messages.expires_at encodes that per event (mig 172), so a
          // courier-arriving push whose window closed becomes `expired` rather
          // than being re-sent as misinformation.
          const expiresAt = attempt.push_messages?.expires_at
            ? new Date(attempt.push_messages.expires_at)
            : null;
          const worthIt = expiresAt ? stillWorthSending(expiresAt, now) : false;
          if (worthIt) {
            retryable++;
            patch.status = 'retryable_failed';
            patch.error_code = verdict.code;
            patch.error_detail = verdict.detail?.slice(0, 500) ?? null;
            // The dispatcher picks this up; first backoff is one minute.
            patch.next_attempt_at = new Date(now.getTime() + 60_000).toISOString();
          } else {
            expired++;
            patch.status = 'expired';
            patch.settled_at = now.toISOString();
            patch.error_code = verdict.code ?? 'EXPIRED';
            patch.error_detail = 'business event no longer worth re-sending';
          }
        }

        const { error: upErr } = await admin
          .from('push_attempts')
          .update(patch)
          .eq('id', attempt.id);
        if (upErr) console.error(`receipts: failed to settle attempt ${attempt.id}: ${upErr.message}`);
      }
    }

    // Prune devices Expo says are gone, so we stop pushing to them (Expo throttles
    // senders that keep hitting unregistered tokens).
    if (deadTokens.length > 0) {
      const { error: pruneErr } = await admin
        .from('push_tokens')
        .delete()
        .in('token', deadTokens);
      if (pruneErr) console.error(`receipts: failed to prune ${deadTokens.length} tokens: ${pruneErr.message}`);
      // NOTE: push_attempts.push_token_id is ON DELETE SET NULL and the token text
      // is snapshotted (mig 171), so pruning keeps the evidence that we tried.
    }

    // Alert ONLY on project-wide failures. One DeviceNotRegistered is routine and
    // paging on it is how an alert channel gets muted — and then nobody notices
    // the credentials breaking, which is the failure that stops every push.
    if (projectWideCodes.size > 0) {
      try {
        await admin.rpc('ops_alert', {
          p_text: `[PUSH] project-wide push failure from Expo receipts: ${[...projectWideCodes].join(', ')}. Every push is likely failing — check credentials/project config.`,
        });
      } catch (e) {
        console.error(`receipts: ops_alert failed: ${e}`);
      }
    }

    const summary =
      `ok (provider_accepted ${providerAccepted}, permanent ${permanent}, ` +
      `retryable ${retryable}, expired ${expired}, still-unknown ${stillUnknown}, ` +
      `pruned ${deadTokens.length})`;
    console.log(`receipts: ${summary}`);
    return new Response(summary, { status: 200 });
  } catch (e) {
    console.error(`receipts: unhandled: ${e}`);
    return new Response(`error: ${e}`, { status: 500 });
  }
});
