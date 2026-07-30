/**
 * Durable outbox recording for expo-push (Package 03 Slices C/D).
 *
 * ================= WHY THIS LIVES HERE AND NOT IN THE SENDERS =================
 * The obvious reading of the spec is "make all 15 DB senders enqueue instead of
 * calling net.http_post". I started down that road, mechanically rewriting each
 * body from pg_get_functiondef, and abandoned it — for two reasons worth
 * recording so nobody retries it.
 *
 * 1. IT IS UNNECESSARY. Every one of the 14 push senders posts to the same
 *    endpoint: `v_base || '/expo-push'` (verified across all of them; only
 *    ops_alert differs, and it targets a Telegram/Slack webhook, so it is not a
 *    push at all and has no ticket, token or recipient). Recording here therefore
 *    covers 100% of push events with ZERO edits to any SECURITY DEFINER body —
 *    and house rule 2 exists precisely because editing those bodies is how later
 *    hardening gets silently reverted.
 *
 * 2. THE MECHANICAL REWRITE WAS PRODUCING WRONG SQL. Across 19 call sites written
 *    by different migrations there are two statement forms (`perform` and
 *    `select ... into`), two header mechanisms (a v_headers variable and
 *    public.push_headers()), and payload argument lists that a regex cannot
 *    safely split. Inspecting the generated output showed it had put a USER id
 *    into p_order_id for tier_promoted and settlement events — the exact
 *    category error the comment at index.ts:~112 says already caused a
 *    production incident, where taps landed on /order/<not-an-order-of-mine>.
 *
 * The edge function is also where the ticket must be stored anyway, so message
 * and attempt rows are created in the same place that learns their outcome.
 *
 * ================= FAIL OPEN, ALWAYS =================
 * Every function here swallows its own errors and returns a degraded value. The
 * outbox is observability, not delivery: if recording fails, the push must still
 * go out. A notification that arrives without a row is a monitoring gap; a
 * notification withheld because bookkeeping failed is a customer harm.
 */
// Same specifier index.ts uses to CREATE the client. Importing the type from a
// different source (esm.sh vs jsr) yields two structurally-identical but
// nominally distinct SupabaseClient types, and every call here fails to
// typecheck — which is how this was caught.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

/** What the caller needs back to attach attempts and tickets later. */
export interface OutboxMessage {
  id: string;
  /** False when recording failed — callers must still send. */
  recorded: boolean;
}

/**
 * Build the idempotency key for a logical push.
 *
 * Derived only from what the SENDER knew, so a trigger that fires twice for one
 * transition produces one message. Deliberately excludes any timestamp (which
 * would defeat it) and the recipient list (resolved later, and one event may
 * legitimately fan out to several people).
 *
 * The recipient hint IS folded in when present, because two different merchant
 * staff sets for the same order+event are genuinely different messages — that is
 * how `order_cancelled` and `order_cancelled_merchant` coexist on one order.
 */
export function idempotencyKey(input: {
  event: string;
  orderId?: string;
  recipientUserIds?: string[];
  campaignId?: string;
}): string {
  const parts = [`evt:${input.event}`];
  if (input.orderId) parts.push(`order:${input.orderId}`);
  if (input.campaignId) parts.push(`campaign:${input.campaignId}`);
  // A campaign already has a unique id, so its recipients need not be hashed in.
  // For everything else, a stable (sorted) recipient fingerprint separates the
  // customer-facing and merchant-facing versions of the same order event.
  if (!input.campaignId && input.recipientUserIds?.length) {
    parts.push(`to:${[...input.recipientUserIds].sort().join(',')}`);
  }
  return parts.join('|');
}

/**
 * Record the logical message, or find the existing one.
 *
 * Returns `recorded: false` on any failure, including when the outbox tables are
 * not yet deployed — the caller sends regardless.
 */
export async function recordMessage(
  admin: SupabaseClient,
  input: {
    event: string;
    orderId?: string;
    recipientUserIds?: string[];
    route?: string;
    vertical?: string | null;
    customTitle?: string | null;
    customBody?: string | null;
    campaignId?: string;
    category?: 'operational' | 'marketing';
  },
): Promise<OutboxMessage | null> {
  const key = idempotencyKey(input);
  try {
    const { data, error } = await admin
      .from('push_messages')
      .insert({
        event: input.event,
        // Empty string is not a valid uuid and is how campaigns used to smuggle
        // "no order" past a NOT NULL check. Normalise it to null.
        order_id: input.orderId && input.orderId.length > 0 ? input.orderId : null,
        recipient_user_ids:
          input.recipientUserIds && input.recipientUserIds.length > 0
            ? input.recipientUserIds
            : null,
        route: input.route ?? null,
        vertical: input.vertical ?? null,
        custom_title: input.customTitle ?? null,
        custom_body: input.customBody ?? null,
        campaign_id: input.campaignId ?? null,
        category: input.category ?? 'operational',
        idempotency_key: key,
        status: 'processing',
      })
      .select('id')
      .single();

    if (!error && data) return { id: (data as { id: string }).id, recorded: true };

    // 23505 = unique violation: this logical message already exists, which is the
    // normal outcome for a re-fired trigger. Adopt the existing row so attempts
    // attach to it rather than being orphaned.
    const { data: existing } = await admin
      .from('push_messages')
      .select('id')
      .eq('idempotency_key', key)
      .maybeSingle();
    if (existing) return { id: (existing as { id: string }).id, recorded: true };

    console.error(`outbox: could not record message (${error?.message ?? 'unknown'})`);
    return null;
  } catch (e) {
    console.error(`outbox: recordMessage threw: ${e}`);
    return null;
  }
}

/** One attempt row per token, created before the Expo call. */
export interface AttemptSeed {
  token: string;
  userId: string;
  /** push_tokens.id, when known — nullable so a missing lookup is not fatal. */
  tokenId?: string | null;
}

export interface RecordedAttempt extends AttemptSeed {
  /** push_attempts.id, or null when recording failed. */
  attemptId: string | null;
}

/**
 * Create attempt rows for every token this send will touch.
 *
 * Created BEFORE the Expo call, deliberately: a row that exists only after a
 * successful response cannot record a network failure, which is the exact case
 * that used to vanish (index.ts caught the error and moved on).
 */
export async function recordAttempts(
  admin: SupabaseClient,
  messageId: string,
  seeds: AttemptSeed[],
): Promise<RecordedAttempt[]> {
  if (seeds.length === 0) return [];
  try {
    const { data, error } = await admin
      .from('push_attempts')
      .insert(
        seeds.map((s) => ({
          message_id: messageId,
          push_token_id: s.tokenId ?? null,
          token_snapshot: s.token,
          recipient_user_id: s.userId,
          attempt_no: 1,
          status: 'queued',
        })),
      )
      .select('id, token_snapshot');
    if (error || !data) {
      console.error(`outbox: could not record attempts (${error?.message ?? 'unknown'})`);
      return seeds.map((s) => ({ ...s, attemptId: null }));
    }
    // Map back by token, since insert order is not guaranteed to be preserved.
    const byToken = new Map<string, string>();
    for (const row of data as { id: string; token_snapshot: string }[]) {
      byToken.set(row.token_snapshot, row.id);
    }
    return seeds.map((s) => ({ ...s, attemptId: byToken.get(s.token) ?? null }));
  } catch (e) {
    console.error(`outbox: recordAttempts threw: ${e}`);
    return seeds.map((s) => ({ ...s, attemptId: null }));
  }
}

/** Terminal-ish outcome for one attempt, derived from an Expo ticket. */
export interface AttemptOutcome {
  attemptId: string | null;
  ticketId?: string | null;
  status: 'expo_accepted' | 'retryable_failed' | 'permanent_failed';
  errorCode?: string | null;
  errorDetail?: string | null;
}

/**
 * Expo error codes that must NEVER be retried.
 *
 * Per https://docs.expo.dev/push-notifications/sending-notifications/ — retrying
 * these burns quota and can never succeed, because the fault is in the message
 * or the credentials rather than the network.
 */
const PERMANENT_CODES = new Set([
  'DeviceNotRegistered',
  'MessageTooBig',
  'InvalidCredentials',
  'MismatchSenderId',
  'ExperienceNotFound',
]);

/** Is this Expo ticket error worth another try? */
export function isRetryable(code: string | null | undefined): boolean {
  if (!code) return true; // unknown/absent code: assume transient
  if (PERMANENT_CODES.has(code)) return false;
  // MessageRateExceeded is explicitly documented as retryable with backoff.
  return true;
}

/**
 * Write per-attempt outcomes and roll the parent message up.
 *
 * `error_detail` is truncated to the column bound and must never carry the
 * notification body: a support reply or an order note in a broad operational log
 * is a privacy leak, not a debugging aid.
 */
export async function settleAttempts(
  admin: SupabaseClient,
  messageId: string,
  outcomes: AttemptOutcome[],
): Promise<void> {
  try {
    const now = new Date().toISOString();
    for (const o of outcomes) {
      if (!o.attemptId) continue;
      await admin
        .from('push_attempts')
        .update({
          expo_ticket_id: o.ticketId ?? null,
          status: o.status,
          error_code: o.errorCode ?? null,
          error_detail: o.errorDetail ? o.errorDetail.slice(0, 500) : null,
          sent_at: now,
          // Only a retryable failure gets a next attempt; the dispatcher picks it
          // up. First backoff is 1 minute; the dispatcher widens it per attempt.
          next_attempt_at:
            o.status === 'retryable_failed'
              ? new Date(Date.now() + 60_000).toISOString()
              : null,
          settled_at: o.status === 'expo_accepted' ? null : now,
        })
        .eq('id', o.attemptId);
    }

    // Roll up. `complete` here means "Expo accepted every attempt" — NOT
    // delivered, and not seen. The receipt poller later promotes attempts to
    // provider_accepted, which is APNs/FCM acceptance and still not display.
    const accepted = outcomes.filter((o) => o.status === 'expo_accepted').length;
    const status =
      outcomes.length === 0
        ? 'failed'
        : accepted === outcomes.length
          ? 'complete'
          : accepted > 0
            ? 'partly_failed'
            : 'failed';

    await admin
      .from('push_messages')
      .update({ status, settled_at: now })
      .eq('id', messageId);
  } catch (e) {
    console.error(`outbox: settleAttempts threw: ${e}`);
  }
}

/** Mark a message that never reached Expo at all (no tokens, all opted out). */
export async function suppressMessage(
  admin: SupabaseClient,
  messageId: string,
  reason:
    | 'no_consent'
    | 'quiet_hours'
    | 'no_token'
    | 'frequency_cap'
    | 'opted_out'
    | 'expired'
    | 'no_recipient',
): Promise<void> {
  try {
    await admin
      .from('push_messages')
      .update({
        status: 'suppressed',
        suppression_reason: reason,
        settled_at: new Date().toISOString(),
      })
      .eq('id', messageId);
  } catch (e) {
    console.error(`outbox: suppressMessage threw: ${e}`);
  }
}
