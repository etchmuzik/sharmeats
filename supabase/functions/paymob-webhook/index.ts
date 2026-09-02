// Supabase Edge Function — Paymob transaction webhook.
//
// Paymob calls this endpoint without a Supabase JWT, so deployment intentionally
// uses --no-verify-jwt. Every state change is gated by the Paymob SHA-512 HMAC.
// The callback is bound to payment_attempts.provider_order_id using only the
// HMAC-covered obj.order.id; unsigned merchant references are ignored.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handlePaymobWebhook } from './handler.ts';

Deno.serve((req) =>
  handlePaymobWebhook(req, {
    getEnv: Deno.env.get.bind(Deno.env),
    createAdmin: (supabaseUrl, serviceRoleKey) =>
      createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    sendPush,
  })
);

function sendPush(body: Record<string, unknown>): void {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${serviceRoleKey}`,
  };
  const internalSecret = Deno.env.get('PUSH_INTERNAL_SECRET');
  if (internalSecret) headers['x-internal-secret'] = internalSecret;
  fetch(`${supabaseUrl}/functions/v1/expo-push`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }).catch(() => {});
}
