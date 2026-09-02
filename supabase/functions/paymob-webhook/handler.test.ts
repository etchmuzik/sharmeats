import { assertEquals } from 'jsr:@std/assert@1';
import { createHmac } from 'node:crypto';
import { handlePaymobWebhook } from './handler.ts';
import { buildHmacString } from './verify.ts';

function failedTransaction(): Record<string, unknown> {
  return {
    amount_cents: 15000,
    created_at: '2026-09-02T10:00:00Z',
    currency: 'EGP',
    error_occured: true,
    has_parent_transaction: false,
    id: 987654,
    integration_id: 111,
    is_3d_secure: true,
    is_auth: false,
    is_capture: false,
    is_refunded: false,
    is_standalone_payment: true,
    is_voided: false,
    order: { id: 555 },
    owner: 42,
    pending: false,
    source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' },
    success: false,
  };
}

Deno.test('a failed-payment persistence error returns 500 and does not emit a false failure push', async () => {
  const hmacSecret = 'test_hmac_secret';
  const obj = failedTransaction();
  const hmac = createHmac('sha512', hmacSecret)
    .update(buildHmacString(obj))
    .digest('hex');
  let pushCalls = 0;
  const logs: string[] = [];

  const admin = {
    from: (table: string) => {
      if (table !== 'payment_attempts') throw new Error(`unexpected table: ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({
              data: {
                id: 'attempt-1',
                order_id: 'order-1',
                user_id: 'user-1',
                amount_egp: 150,
                integration_id: '111',
                status: 'ready',
                provider_txn_id: null,
              },
              error: null,
            }),
          }),
        }),
        update: () => ({
          eq: () => Promise.resolve({ error: { message: 'write unavailable' } }),
        }),
      };
    },
  };

  const response = await handlePaymobWebhook(
    new Request(`https://example.test/paymob-webhook?hmac=${hmac}`, {
      method: 'POST',
      body: JSON.stringify({ obj }),
    }),
    {
      getEnv: (name) => ({
        PAYMOB_HMAC_SECRET: hmacSecret,
        PAYMOB_INTEGRATION_ID: '111',
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      })[name],
      createAdmin: () => admin as never,
      sendPush: () => {
        pushCalls++;
      },
      logError: (message) => logs.push(message),
    },
  );

  assertEquals(response.status, 500);
  assertEquals(await response.text(), 'database unavailable');
  assertEquals(pushCalls, 0);
  assertEquals(logs, [
    'paymob webhook: failed to persist unsuccessful transaction for attempt attempt-1: write unavailable',
  ]);
});
