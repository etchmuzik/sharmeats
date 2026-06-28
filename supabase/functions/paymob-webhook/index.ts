// Supabase Edge Function — Paymob transaction webhook (Sharm Eats).
//
// Ported from Go Sharm. Paymob POSTs here after a card payment attempt. We
// verify the HMAC signature (so a forged request can't mark an order paid),
// then flip payment_status. This is the ONLY place a CARD order becomes 'paid'
// — the client is never trusted. (COD orders settle via mark_cod_collected.)
//
// IDEMPOTENT: only pending → paid, with a row-count check, so Paymob's retries
// run side-effects exactly once.
//
// Deploy:
//   supabase functions deploy paymob-webhook --no-verify-jwt --project-ref <REF>
// Set the callback URL in the Paymob dashboard to:
//   https://<REF>.supabase.co/functions/v1/paymob-webhook
// Secret (set once):
//   supabase secrets set PAYMOB_HMAC_SECRET=... --project-ref <REF>
//
// --no-verify-jwt is required: Paymob calls this without a Supabase JWT.
// We use the service-role key for the DB write, gated by HMAC verification.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { createHmac } from 'node:crypto';

// Fields Paymob concatenates (documented order) to compute the HMAC.
const HMAC_FIELDS = [
  'amount_cents',
  'created_at',
  'currency',
  'error_occured',
  'has_parent_transaction',
  'id',
  'integration_id',
  'is_3d_secure',
  'is_auth',
  'is_capture',
  'is_refunded',
  'is_standalone_payment',
  'is_voided',
  'order.id',
  'owner',
  'pending',
  'source_data.pan',
  'source_data.sub_type',
  'source_data.type',
  'success',
];

Deno.serve(async (req: Request) => {
  try {
    const hmacSecret = Deno.env.get('PAYMOB_HMAC_SECRET');
    if (!hmacSecret) return new Response('not configured', { status: 500 });

    const url = new URL(req.url);
    const providedHmac = url.searchParams.get('hmac') ?? '';
    let payload: Record<string, unknown>;
    try {
      payload = await req.json();
    } catch {
      return new Response('bad json', { status: 400 });
    }
    const obj = (payload.obj ?? payload) as Record<string, any>;

    // Build the concatenation string from the documented fields.
    const concatenated = HMAC_FIELDS.map((path) => {
      const val = path.split('.').reduce((acc: any, k) => (acc == null ? acc : acc[k]), obj);
      if (typeof val === 'boolean') return val ? 'true' : 'false';
      return val == null ? '' : String(val);
    }).join('');

    const computed = createHmac('sha512', hmacSecret).update(concatenated).digest('hex');
    if (computed !== providedHmac) {
      return new Response('invalid hmac', { status: 401 });
    }

    const success = obj.success === true || obj.success === 'true';
    const orderId = obj.order?.merchant_order_id ?? obj.special_reference ?? obj.extras?.order_id;
    if (!orderId) return new Response('no order ref', { status: 400 });

    // Service-role client (bypasses RLS) — safe because HMAC is verified above.
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    if (!success) {
      await admin
        .from('orders')
        .update({ payment_status: 'failed' })
        .eq('id', orderId)
        .eq('payment_status', 'pending');
      return new Response('ok', { status: 200 });
    }

    // IDEMPOTENT transition: only pending → paid. Returned rows tell us whether
    // THIS call did the work. Paymob retries update 0 rows → side-effects once.
    const { data: transitioned, error: updErr } = await admin
      .from('orders')
      .update({ payment_status: 'paid', paymob_order_ref: String(obj.order?.id ?? obj.id ?? '') })
      .eq('id', orderId)
      .eq('payment_status', 'pending')
      .select('id, user_id, total_egp');

    if (updErr) {
      return new Response(`db error: ${updErr.message}`, { status: 500 });
    }

    const ord = transitioned && transitioned.length > 0 ? transitioned[0] : null;
    if (ord) {
      // Append a paid status event (audit + drives "payment confirmed" UI).
      await admin
        .from('order_status_events')
        .insert({ order_id: ord.id, status: 'placed', note: 'Payment confirmed (card)' })
        .then(() => {})
        .catch(() => {});

      // Notify the merchant their (now paid) order is live, via expo-push fn.
      // [M4] Send the internal shared secret so expo-push accepts the call.
      const fnUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/expo-push`;
      const pushHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      };
      const pushSecret = Deno.env.get('PUSH_INTERNAL_SECRET');
      if (pushSecret) pushHeaders['x-internal-secret'] = pushSecret;
      fetch(fnUrl, {
        method: 'POST',
        headers: pushHeaders,
        body: JSON.stringify({ event: 'order_paid', orderId: ord.id }),
      }).catch(() => {});
    }

    return new Response('ok', { status: 200 });
  } catch (e) {
    return new Response(`error: ${e}`, { status: 500 });
  }
});
