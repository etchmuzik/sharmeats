/**
 * Expo receipt classification (Package 03 Slice E).
 *
 * Split from index.ts so the decisions can be unit-tested without network or
 * database, matching the prefs.ts / copy.ts / outbox.ts pattern.
 *
 * ================= WHAT A RECEIPT ACTUALLY MEANS =================
 * A TICKET means Expo accepted the message from us. A RECEIPT means APNs or FCM
 * accepted it from Expo. Neither means a device displayed anything, and neither
 * means a human saw it. Nothing in this module or the schema may be named
 * "delivered" — the spec is explicit about that and it is not pedantry: an
 * operator who believes "delivered" will stop investigating a customer who never
 * got their order update.
 *
 * ================= THE THREE-STATE PROBLEM =================
 * A receipt lookup has three outcomes, and collapsing them to two loses
 * messages:
 *
 *   ok            -> provider_accepted. Done.
 *   error         -> permanent or retryable, by code (below).
 *   NOT PRESENT   -> genuinely unknown. Expo has not decided yet.
 *
 * Treating "absent" as failure re-sends a push that already arrived. Treating it
 * as success loses one that never did. So absent means LEAVE IT ALONE and ask
 * again later — until a retention deadline, after which it becomes `expired`
 * (meaning "we never found out", not "it failed").
 */

/** Expo's receipt shape, per the sending-notifications docs. */
export interface ExpoReceipt {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

export type ReceiptVerdict =
  /** APNs/FCM accepted it. Still not display proof. */
  | { kind: 'provider_accepted' }
  /** Will never succeed; do not retry. */
  | { kind: 'permanent_failed'; code: string | null; detail: string | null }
  /** Worth another send while the business event is still valuable. */
  | { kind: 'retryable_failed'; code: string | null; detail: string | null }
  /** Expo has not answered yet — check again later, change nothing. */
  | { kind: 'unknown' }
  /** Past the retention deadline with no answer. Not a failure; an unknown. */
  | { kind: 'expired' };

/**
 * Receipt error codes that can never succeed on a retry.
 *
 * Deliberately a SEPARATE list from the ticket-level one in expo-push/outbox.ts.
 * The two look similar but answer different questions — a ticket error is Expo
 * refusing us, a receipt error is the push provider refusing Expo — and merging
 * them would mean a change for one silently altering the other.
 */
const PERMANENT_RECEIPT_CODES = new Set([
  // The device uninstalled or the token was revoked. Prune it.
  'DeviceNotRegistered',
  // Payload too large for the provider. Resending the same payload cannot help.
  'MessageTooBig',
  // Our credentials or project are wrong. Retrying hammers a broken config, and
  // this is the case that deserves an operator alert rather than a retry.
  'InvalidCredentials',
  'MismatchSenderId',
  'ExperienceNotFound',
]);

/**
 * Codes that indicate a PROJECT-WIDE problem rather than one bad device.
 *
 * The distinction drives alerting: one DeviceNotRegistered is routine and must
 * not page anyone, while InvalidCredentials means every push is failing and
 * somebody needs to know now. Alerting per dead token is how alerts get muted.
 */
const PROJECT_WIDE_CODES = new Set([
  'InvalidCredentials',
  'MismatchSenderId',
  'ExperienceNotFound',
]);

export function isProjectWideFailure(code: string | null | undefined): boolean {
  return !!code && PROJECT_WIDE_CODES.has(code);
}

/** Should this receipt error's token be removed from push_tokens? */
export function shouldPruneToken(code: string | null | undefined): boolean {
  return code === 'DeviceNotRegistered';
}

/**
 * Classify one attempt's receipt.
 *
 * `receipt` is undefined when Expo returned no entry for the ticket id, which is
 * the normal state for a few minutes after sending.
 */
export function classifyReceipt(
  receipt: ExpoReceipt | undefined,
  opts: { sentAt: Date; now: Date; retentionHours?: number },
): ReceiptVerdict {
  const retentionHours = opts.retentionHours ?? 24;

  if (!receipt) {
    const ageMs = opts.now.getTime() - opts.sentAt.getTime();
    if (ageMs > retentionHours * 3600_000) {
      // We are never going to find out. Recording this as `expired` rather than
      // failed keeps the operator-facing count honest: it is an unknown, and
      // counting unknowns as failures would overstate the failure rate.
      return { kind: 'expired' };
    }
    return { kind: 'unknown' };
  }

  if (receipt.status === 'ok') return { kind: 'provider_accepted' };

  const code = receipt.details?.error ?? null;
  // Expo's own diagnostic message, never our notification copy — the body could
  // contain a support reply or an order note, which must not enter a broad log.
  const detail = receipt.message ?? null;

  if (code && PERMANENT_RECEIPT_CODES.has(code)) {
    return { kind: 'permanent_failed', code, detail };
  }
  // Unknown or absent code: assume transient. Failing toward a retry is the
  // right bias for a delivery-critical push, and the attempt cap bounds it.
  return { kind: 'retryable_failed', code, detail };
}

/**
 * Is this business event still worth re-sending?
 *
 * The spec: "retry only while the original business event is still valuable."
 * push_messages.expires_at already encodes that per event (mig 172 sets 30
 * minutes for a courier-arriving push and 7 days for a settlement), so this is
 * just the comparison — but it is the difference between a helpful retry and
 * telling someone their driver is arriving six hours after they ate.
 */
export function stillWorthSending(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() > now.getTime();
}

/** Expo's documented per-request cap for receipt lookups. */
export const RECEIPT_CHUNK_SIZE = 1000;

/** Split ticket ids into Expo-sized request chunks. */
export function chunkTicketIds(ids: string[], size = RECEIPT_CHUNK_SIZE): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/**
 * How long to wait before asking about a ticket.
 *
 * Expo needs time to hand off to APNs/FCM; asking immediately reliably returns
 * nothing and wastes a request. 15 minutes is the spec's figure.
 */
export const MIN_RECEIPT_AGE_MINUTES = 15;
