import { type Locale, resolveCopy } from './copy.ts';
import { isRetryable } from './outbox.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_CHUNK_SIZE = 100;

export interface RetryAttempt {
  attemptId: string;
  messageId: string;
  event: string;
  orderId: string | null;
  route: string | null;
  vertical: string | null;
  customTitle: string | null;
  customBody: string | null;
  recipientUserId: string | null;
  token: string;
  attemptNo: number;
}

export interface RetryAttemptOutcome {
  attemptId: string;
  status: 'expo_accepted' | 'retryable_failed' | 'permanent_failed';
  ticketId: string | null;
  errorCode: string | null;
  errorDetail: string | null;
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
  data: {
    orderId: string;
    event: string;
    messageId: string;
    route?: string;
  };
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface RetrySendDependencies {
  fetchImpl?: FetchLike;
  localeByUser?: ReadonlyMap<string, Locale>;
  settleAttempt: (outcome: RetryAttemptOutcome) => Promise<void>;
}

export interface RetrySendSummary {
  accepted: number;
  failed: number;
  total: number;
  deadTokens: string[];
  /** Outcomes Expo already reported that could not be written to the DB. */
  settleFailures: number;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Parse the snake_case row shape produced by to_jsonb(claim_push_retries()). */
export function parseRetryAttempts(value: unknown): RetryAttempt[] | null {
  if (!Array.isArray(value) || value.length > 500) return null;

  const parsed: RetryAttempt[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const row = item as Record<string, unknown>;
    if (
      typeof row.attempt_id !== 'string' ||
      typeof row.message_id !== 'string' ||
      typeof row.event !== 'string' ||
      typeof row.token !== 'string' ||
      !row.token.startsWith('ExponentPushToken') ||
      typeof row.attempt_no !== 'number' ||
      !Number.isInteger(row.attempt_no) ||
      row.attempt_no < 2 ||
      row.attempt_no > 5
    ) {
      return null;
    }

    parsed.push({
      attemptId: row.attempt_id,
      messageId: row.message_id,
      event: row.event,
      orderId: nullableString(row.order_id),
      route: nullableString(row.route),
      vertical: nullableString(row.vertical),
      customTitle: nullableString(row.custom_title),
      customBody: nullableString(row.custom_body),
      recipientUserId: nullableString(row.recipient_user_id),
      token: row.token,
      attemptNo: row.attempt_no,
    });
  }
  return parsed;
}

function expoMessage(
  attempt: RetryAttempt,
  localeByUser: ReadonlyMap<string, Locale>,
): ExpoMessage {
  const locale = attempt.recipientUserId
    ? localeByUser.get(attempt.recipientUserId) ?? 'en'
    : 'en';
  const copy = resolveCopy(attempt.event, locale, attempt.vertical);
  return {
    to: attempt.token,
    sound: 'default',
    title: attempt.customTitle ?? copy.title,
    body: attempt.customBody ?? copy.body,
    data: {
      orderId: attempt.orderId ?? '',
      event: attempt.event,
      messageId: attempt.messageId,
      ...(attempt.route ? { route: attempt.route } : {}),
    },
  };
}

function httpFailure(attempt: RetryAttempt, status: number): RetryAttemptOutcome {
  const retryable = status === 429 || status >= 500;
  return {
    attemptId: attempt.attemptId,
    status: retryable ? 'retryable_failed' : 'permanent_failed',
    ticketId: null,
    errorCode: `HTTP_${status}`,
    errorDetail: `Expo API returned ${status}`,
  };
}

function ticketOutcome(
  attempt: RetryAttempt,
  ticket: ExpoTicket | undefined,
): RetryAttemptOutcome {
  if (!ticket) {
    return {
      attemptId: attempt.attemptId,
      status: 'retryable_failed',
      ticketId: null,
      errorCode: 'NO_TICKET',
      errorDetail: 'Expo returned fewer tickets than messages sent',
    };
  }
  if (ticket.status === 'ok') {
    if (!ticket.id) {
      return {
        attemptId: attempt.attemptId,
        status: 'retryable_failed',
        ticketId: null,
        errorCode: 'NO_TICKET_ID',
        errorDetail: 'Expo accepted the request without a receipt ticket id',
      };
    }
    return {
      attemptId: attempt.attemptId,
      status: 'expo_accepted',
      ticketId: ticket.id,
      errorCode: null,
      errorDetail: null,
    };
  }

  const code = ticket.details?.error ?? null;
  return {
    attemptId: attempt.attemptId,
    status: isRetryable(code) ? 'retryable_failed' : 'permanent_failed',
    ticketId: ticket.id ?? null,
    errorCode: code,
    errorDetail: ticket.message ?? null,
  };
}

/**
 * Send only the exact token carried by each claimed attempt.
 *
 * Settlement happens after fetch has produced a concrete HTTP/ticket outcome.
 * Merely queueing the SQL -> Edge pg_net call can therefore never manufacture
 * expo_accepted history.
 */
export async function sendRetryAttempts(
  attempts: RetryAttempt[],
  dependencies: RetrySendDependencies,
): Promise<RetrySendSummary> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const localeByUser = dependencies.localeByUser ?? new Map<string, Locale>();
  const summary: RetrySendSummary = {
    accepted: 0,
    failed: 0,
    total: attempts.length,
    deadTokens: [],
    settleFailures: 0,
  };

  for (let i = 0; i < attempts.length; i += EXPO_CHUNK_SIZE) {
    const chunk = attempts.slice(i, i + EXPO_CHUNK_SIZE);
    let outcomes: RetryAttemptOutcome[];

    try {
      const response = await fetchImpl(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(chunk.map((attempt) => expoMessage(attempt, localeByUser))),
      });
      if (!response.ok) {
        outcomes = chunk.map((attempt) => httpFailure(attempt, response.status));
      } else {
        const payload = (await response.json().catch(() => null)) as
          | { data?: ExpoTicket[] }
          | null;
        const tickets = payload?.data ?? [];
        outcomes = chunk.map((attempt, index) => ticketOutcome(attempt, tickets[index]));
      }
    } catch {
      outcomes = chunk.map((attempt) => ({
        attemptId: attempt.attemptId,
        status: 'retryable_failed',
        ticketId: null,
        errorCode: 'NETWORK',
        errorDetail: 'network error sending to Expo',
      }));
    }

    for (let index = 0; index < outcomes.length; index++) {
      const outcome = outcomes[index];
      const attempt = chunk[index];
      // This await is intentionally after the real HTTP/ticket classification.
      // A failed settle write must not discard the outcomes Expo already
      // reported for the rest of this chunk (or stop later chunks): every
      // unsettled attempt stays 'processing', is reclaimed after 10 minutes and
      // re-sent — a duplicate push to a device Expo already accepted. Mirror
      // outbox.settleAttempts: log, count, keep going.
      try {
        await dependencies.settleAttempt(outcome);
      } catch (settleError) {
        summary.settleFailures++;
        console.error(
          `expo-push retry: could not settle attempt ${outcome.attemptId} (${outcome.status}): ${
            settleError instanceof Error ? settleError.message : String(settleError)
          }`,
        );
      }
      if (outcome.status === 'expo_accepted') summary.accepted++;
      else summary.failed++;
      if (outcome.errorCode === 'DeviceNotRegistered') {
        summary.deadTokens.push(attempt.token);
      }
    }
  }

  return summary;
}
