// Supabase Edge Function — Paymob "Unified Intention" creator (Sharm Eats).
//
// Ported from Go Sharm. The client calls this with an orderId. We look up the
// ORDER server-side (so the amount can't be tampered with), confirm it's a
// card order awaiting payment, create a Paymob intention, and return the
// client_secret + hosted checkout URL. The customer app opens that URL in
// expo-web-browser. Card data NEVER touches our servers (PCI handled by Paymob).
//
// COD orders never call this — they skip Paymob entirely.
//
// Deploy:
//   supabase functions deploy paymob-create-intention --project-ref <REF>
// Secrets (set once):
//   supabase secrets set PAYMOB_SECRET_KEY=sk_... PAYMOB_PUBLIC_KEY=pk_... \
//     PAYMOB_INTEGRATION_ID=12345 --project-ref <REF>

import { createClient } from 'jsr:@supabase/supabase-js@2';

const PAYMOB_BASE = 'https://accept.paymob.com/v1';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const secretKey = Deno.env.get('PAYMOB_SECRET_KEY');
    const publicKey = Deno.env.get('PAYMOB_PUBLIC_KEY');
    const integrationId = Deno.env.get('PAYMOB_INTEGRATION_ID');
    if (!secretKey || !publicKey || !integrationId) {
      return json({ error: 'Paymob keys not configured on the server' }, 500);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'unauthorized' }, 401);

    let orderId: string | undefined;
    try {
      ({ orderId } = await req.json());
    } catch {
      return json({ error: 'bad json' }, 400);
    }
    if (!orderId) return json({ error: 'orderId required' }, 400);

    // Authenticated client scoped to the caller (RLS enforces the customer owns the order).
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: order, error } = await supabase
      .from('orders')
      .select('id, short_code, total_egp, restaurant_name, payment_method, payment_status, status')
      .eq('id', orderId)
      .single();
    if (error || !order) return json({ error: 'Order not found' }, 404);
    if (order.payment_method !== 'card') return json({ error: 'Order is not a card order' }, 409);
    if (order.payment_status !== 'pending') {
      return json({ error: `Order payment is ${order.payment_status}, not payable` }, 409);
    }
    if (!order.total_egp || order.total_egp <= 0) return json({ error: 'Invalid order amount' }, 422);

    // Amount in piastres (EGP * 100). Server-derived — never trust a client amount.
    const amountCents = Math.round(order.total_egp * 100);

    const intentionRes = await fetch(`${PAYMOB_BASE}/intention/`, {
      method: 'POST',
      headers: { Authorization: `Token ${secretKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: amountCents,
        currency: 'EGP',
        payment_methods: [Number(integrationId)],
        items: [
          {
            name: order.short_code,
            amount: amountCents,
            description: `Sharm Eats order from ${order.restaurant_name}`,
            quantity: 1,
          },
        ],
        special_reference: order.id, // ties the Paymob txn back to our order for the webhook
        extras: { order_id: order.id },
      }),
    });

    const intention = await intentionRes.json();
    if (!intentionRes.ok || !intention.client_secret) {
      return json({ error: 'Paymob intention failed', detail: intention }, 502);
    }

    const checkoutUrl = `${PAYMOB_BASE}/checkout/?publicKey=${publicKey}&clientSecret=${intention.client_secret}`;
    return json({ clientSecret: intention.client_secret, checkoutUrl });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
