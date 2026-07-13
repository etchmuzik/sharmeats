// Supabase Edge Function — Paymob card REFUND (Sharm Eats).
//
// P0 #4 (2026-07-11 gap analysis): the platform could take card money but had no
// path to return it — `'refunded'` was an orphaned status and support could only
// grant store credit (a consumer-rights + chargeback problem). This function issues
// a real Paymob refund against the captured transaction.
//
// AUTH: admin-only. The caller must present a Supabase JWT whose user has role
// 'admin' (verified server-side against public.users). This is NOT a public webhook.
//
// FLOW:
//   1. Verify the caller is an admin.
//   2. Load the order server-side; must be a PAID CARD order with a stored
//      paymob_txn_id (mig 107). Amount is server-derived from the order (or a
//      partial amount ≤ the order total, admin-supplied).
//   3. POST Paymob's refund API with PAYMOB_SECRET_KEY.
//   4. Record the attempt in order_refunds and, on success, flip payment_status
//      to 'refunded'. Idempotent-ish: a prior succeeded refund short-circuits.
//
// Deploy (owner):
//   supabase functions deploy paymob-refund --project-ref <REF>
// Reuses the same PAYMOB_SECRET_KEY secret as paymob-create-intention.
// NOTE: this is built but should be deployed + tested by the owner alongside
// enabling card payments; under COD-only there is nothing to refund yet.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const PAYMOB_REFUND_URL = 'https://accept.paymob.com/api/acceptance/void_refund/refund';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const secretKey = Deno.env.get('PAYMOB_SECRET_KEY');
    if (!secretKey) return json({ error: 'Paymob key not configured on the server' }, 500);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'unauthorized' }, 401);

    let orderId: string | undefined;
    let amountEgp: number | undefined; // optional partial refund; defaults to full order total
    let reason: string | undefined;
    try {
      ({ orderId, amountEgp, reason } = await req.json());
    } catch {
      return json({ error: 'bad json' }, 400);
    }
    if (!orderId) return json({ error: 'orderId required' }, 400);

    // Caller-scoped client — verify the JWT and the caller's admin role via RLS-safe read.
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: 'unauthorized' }, 401);
    const { data: me } = await userClient
      .from('users')
      .select('role')
      .eq('id', userData.user.id)
      .single();
    if ((me?.role as string | undefined) !== 'admin') {
      return json({ error: 'forbidden: admin only' }, 403);
    }

    // Service-role client for the authoritative reads/writes (bypasses RLS; gated by the
    // admin check above).
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: order, error: orderErr } = await admin
      .from('orders')
      .select('id, total_egp, payment_method, payment_status, paymob_txn_id')
      .eq('id', orderId)
      .single();
    if (orderErr || !order) return json({ error: 'Order not found' }, 404);
    if (order.payment_method !== 'card') return json({ error: 'Not a card order' }, 409);
    if (order.payment_status === 'refunded') return json({ ok: true, alreadyRefunded: true }, 200);
    if (order.payment_status !== 'paid') {
      return json({ error: `Order payment is ${order.payment_status}, not refundable` }, 409);
    }
    if (!order.paymob_txn_id) {
      return json({ error: 'No captured Paymob transaction id on this order (mig 107 / webhook)' }, 422);
    }

    // Amount: server-derived. A partial amount, if provided, must be a positive integer
    // no greater than the order total.
    const fullCents = Math.round(order.total_egp * 100);
    let refundCents = fullCents;
    if (amountEgp != null) {
      if (!Number.isFinite(amountEgp) || amountEgp <= 0 || amountEgp > order.total_egp) {
        return json({ error: 'Invalid partial refund amount' }, 422);
      }
      refundCents = Math.round(amountEgp * 100);
    }

    // Record the attempt before calling the provider (so a crash mid-call is visible).
    const { data: refundRow } = await admin
      .from('order_refunds')
      .insert({
        order_id: order.id,
        amount_egp: Math.round(refundCents / 100),
        reason: reason ?? null,
        status: 'requested',
        actor_id: userData.user.id,
      })
      .select('id')
      .single();

    const refundRes = await fetch(PAYMOB_REFUND_URL, {
      method: 'POST',
      headers: { Authorization: `Token ${secretKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction_id: order.paymob_txn_id, amount_cents: refundCents }),
    });
    const refundBody = await refundRes.json().catch(() => ({}));

    if (!refundRes.ok || refundBody?.success === false) {
      if (refundRow?.id) {
        await admin.from('order_refunds')
          .update({ status: 'failed', provider_detail: refundBody })
          .eq('id', refundRow.id);
      }
      return json({ error: 'Paymob refund failed', detail: refundBody }, 502);
    }

    // Success: mark the order refunded and complete the audit row.
    await admin.from('orders').update({ payment_status: 'refunded' }).eq('id', order.id);
    if (refundRow?.id) {
      await admin.from('order_refunds')
        .update({ status: 'succeeded', provider_ref: String(refundBody?.id ?? ''), provider_detail: refundBody })
        .eq('id', refundRow.id);
    }

    return json({ ok: true, refundedEgp: Math.round(refundCents / 100) }, 200);
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
