import { assertEquals } from 'jsr:@std/assert';
import {
  sendRetryAttempts,
  type RetryAttempt,
  type RetryAttemptOutcome,
} from './retry.ts';

const FAILED_TOKEN = 'ExponentPushToken[failed-device]';
const HEALTHY_TOKEN = 'ExponentPushToken[healthy-device]';

function retryAttempt(overrides: Partial<RetryAttempt> = {}): RetryAttempt {
  return {
    attemptId: '20000000-0000-0000-0000-000000000002',
    messageId: '10000000-0000-0000-0000-000000000001',
    event: 'order_ready',
    orderId: '30000000-0000-0000-0000-000000000003',
    route: null,
    vertical: 'food',
    customTitle: 'Ready',
    customBody: 'Your order is ready',
    recipientUserId: '40000000-0000-0000-0000-000000000004',
    token: FAILED_TOKEN,
    attemptNo: 2,
    ...overrides,
  };
}

Deno.test('retry send targets the claimed failed token and never fans out to another token', async () => {
  const requestBodies: unknown[] = [];
  const outcomes: RetryAttemptOutcome[] = [];

  await sendRetryAttempts([retryAttempt()], {
    fetchImpl: (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      return Promise.resolve(new Response(JSON.stringify({
        data: [{ status: 'ok', id: 'expo-ticket-2' }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    },
    settleAttempt: (outcome) => {
      outcomes.push(outcome);
      return Promise.resolve();
    },
  });

  assertEquals(requestBodies, [[{
    to: FAILED_TOKEN,
    sound: 'default',
    title: 'Ready',
    body: 'Your order is ready',
    data: {
      orderId: '30000000-0000-0000-0000-000000000003',
      event: 'order_ready',
      messageId: '10000000-0000-0000-0000-000000000001',
    },
  }]]);
  assertEquals(JSON.stringify(requestBodies).includes(HEALTHY_TOKEN), false);
  assertEquals(outcomes, [{
    attemptId: '20000000-0000-0000-0000-000000000002',
    status: 'expo_accepted',
    ticketId: 'expo-ticket-2',
    errorCode: null,
    errorDetail: null,
  }]);
});

Deno.test('retry attempt is not marked expo_accepted before Expo returns its real outcome', async () => {
  let resolveFetch: ((response: Response) => void) | undefined;
  const outcomes: RetryAttemptOutcome[] = [];
  const deferredResponse = new Promise<Response>((resolve) => {
    resolveFetch = resolve;
  });

  const send = sendRetryAttempts([retryAttempt()], {
    fetchImpl: () => deferredResponse,
    settleAttempt: (outcome) => {
      outcomes.push(outcome);
      return Promise.resolve();
    },
  });

  // Let sendRetryAttempts reach and await fetch. The old dispatcher marked the
  // attempt accepted immediately after merely queueing net.http_post.
  await Promise.resolve();
  assertEquals(outcomes, []);

  resolveFetch!(new Response(JSON.stringify({
    data: [{
      status: 'error',
      message: 'rate limited',
      details: { error: 'MessageRateExceeded' },
    }],
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
  await send;

  assertEquals(outcomes, [{
    attemptId: '20000000-0000-0000-0000-000000000002',
    status: 'retryable_failed',
    ticketId: null,
    errorCode: 'MessageRateExceeded',
    errorDetail: 'rate limited',
  }]);
});

Deno.test('one failed settle write does not discard the other outcomes Expo already reported', async () => {
  // Three claimed attempts in one Expo chunk; the DB write for the FIRST
  // outcome fails. The two remaining outcomes must still be settled, the dead
  // token still pruned, and the failure counted — otherwise the unsettled
  // attempts sit in 'processing', are reclaimed after 10 minutes and re-sent to
  // devices Expo already accepted.
  const attempts = [
    retryAttempt({ attemptId: '20000000-0000-0000-0000-000000000011', token: 'ExponentPushToken[a]' }),
    retryAttempt({ attemptId: '20000000-0000-0000-0000-000000000012', token: 'ExponentPushToken[b]' }),
    retryAttempt({ attemptId: '20000000-0000-0000-0000-000000000013', token: 'ExponentPushToken[c]' }),
  ];
  const settled: string[] = [];
  const failedWrites: string[] = [];

  const summary = await sendRetryAttempts(attempts, {
    fetchImpl: () =>
      Promise.resolve(new Response(JSON.stringify({
        data: [
          { status: 'ok', id: 'ticket-a' },
          { status: 'ok', id: 'ticket-b' },
          { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    settleAttempt: (outcome) => {
      if (outcome.attemptId === '20000000-0000-0000-0000-000000000011') {
        failedWrites.push(outcome.attemptId);
        return Promise.reject(new Error('PGRST: connection reset'));
      }
      settled.push(outcome.attemptId);
      return Promise.resolve();
    },
  });

  assertEquals(failedWrites, ['20000000-0000-0000-0000-000000000011']);
  assertEquals(settled, [
    '20000000-0000-0000-0000-000000000012',
    '20000000-0000-0000-0000-000000000013',
  ]);
  assertEquals(summary.settleFailures, 1);
  assertEquals(summary.accepted, 2);
  assertEquals(summary.failed, 1);
  assertEquals(summary.deadTokens, ['ExponentPushToken[c]']);
});
