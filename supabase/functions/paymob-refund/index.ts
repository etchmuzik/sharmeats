// Supabase Edge Function — full Paymob card refund.
//
// Admin-only. Partial refunds are intentionally rejected until the accounting
// model can represent multiple captures/refunds. A unique requested/succeeded
// row claims each order before Paymob is called, and a database RPC finalizes
// the provider response and order status atomically.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { parseFullRefundRequest } from "./logic.ts";

const PAYMOB_REFUND_URL =
  "https://accept.paymob.com/api/acceptance/void_refund/refund";
const MAX_BODY_BYTES = 8 * 1024;

function corsHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  const origin = req.headers.get("Origin");
  const allowed = (Deno.env.get("PAYMENT_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (origin && allowed.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

async function readJson(req: Request): Promise<unknown> {
  const declaredLength = Number(req.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new Error("BODY_TOO_LARGE");
  }
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new Error("BODY_TOO_LARGE");
  }
  return JSON.parse(text);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return json(req, { error: "method_not_allowed" }, 405, {
      Allow: "POST, OPTIONS",
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const secretKey = Deno.env.get("PAYMOB_SECRET_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !secretKey) {
    return json(req, { error: "service_unavailable" }, 503);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json(req, { error: "unauthorized" }, 401);
  }

  let refundRequest: ReturnType<typeof parseFullRefundRequest>;
  try {
    refundRequest = parseFullRefundRequest(await readJson(req));
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "BODY_TOO_LARGE") {
      return json(req, { error: "body_too_large" }, 413);
    }
    if (code === "FULL_REFUNDS_ONLY") {
      return json(req, { error: "full_refunds_only" }, 422);
    }
    return json(req, { error: "invalid_request" }, 400);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = authHeader.slice("Bearer ".length);
  const { data: userData, error: userError } = await userClient.auth.getUser(
    token,
  );
  if (userError || !userData.user) {
    return json(req, { error: "unauthorized" }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: actor, error: actorError } = await admin
    .from("users")
    .select("role")
    .eq("id", userData.user.id)
    .single();
  if (actorError || actor?.role !== "admin") {
    return json(req, { error: "forbidden" }, 403);
  }

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id, total_egp, payment_method, payment_status, paymob_txn_id")
    .eq("id", refundRequest.orderId)
    .single();
  if (orderError || !order) return json(req, { error: "order_not_found" }, 404);
  if (order.payment_method !== "card") {
    return json(req, { error: "not_a_card_order" }, 409);
  }
  if (order.payment_status === "refunded") {
    return json(req, { ok: true, alreadyRefunded: true });
  }
  if (order.payment_status !== "paid") {
    return json(req, { error: "order_not_refundable" }, 409);
  }
  if (
    !order.paymob_txn_id || !Number.isInteger(order.total_egp) ||
    order.total_egp <= 0
  ) {
    return json(req, { error: "order_not_refundable" }, 422);
  }

  // This insert is the provider-call claim. The partial unique index in
  // migration 121 lets exactly one concurrent request proceed.
  const { data: refund, error: claimError } = await admin
    .from("order_refunds")
    .insert({
      order_id: order.id,
      amount_egp: order.total_egp,
      reason: refundRequest.reason,
      status: "requested",
      actor_id: userData.user.id,
    })
    .select("id")
    .single();
  if (claimError || !refund) {
    if (claimError?.code === "23505") {
      const { data: existing } = await admin
        .from("order_refunds")
        .select("status")
        .eq("order_id", order.id)
        .in("status", ["requested", "succeeded"])
        .maybeSingle();
      if (existing?.status === "succeeded") {
        return json(req, { ok: true, alreadyRefunded: true });
      }
      return json(req, { error: "refund_in_progress" }, 409);
    }
    return json(req, { error: "refund_initialization_failed" }, 500);
  }

  const amountCents = order.total_egp * 100;
  let providerResponse: Response;
  try {
    providerResponse = await fetch(PAYMOB_REFUND_URL, {
      method: "POST",
      headers: {
        Authorization: `Token ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transaction_id: order.paymob_txn_id,
        amount_cents: amountCents,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // The provider may have accepted the refund before the connection failed.
    // Leave status=requested so automatic retries cannot double-refund.
    await admin
      .from("order_refunds")
      .update({
        provider_detail: {
          error: "Provider outcome unknown; reconcile manually",
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", refund.id);
    return json(req, { error: "refund_reconciliation_required" }, 502);
  }

  const providerBody = await providerResponse.json().catch(
    () => ({}),
  ) as Record<string, unknown>;
  if (!providerResponse.ok || providerBody.success === false) {
    await admin
      .from("order_refunds")
      .update({
        status: "failed",
        provider_detail: {
          httpStatus: providerResponse.status,
          providerId: providerBody.id ?? null,
          success: providerBody.success ?? null,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", refund.id);
    return json(req, { error: "refund_provider_rejected" }, 502);
  }

  const providerReference = typeof providerBody.id === "string" ||
      typeof providerBody.id === "number"
    ? String(providerBody.id).trim()
    : "";
  if (!providerReference) {
    await admin
      .from("order_refunds")
      .update({
        provider_detail: {
          error: "Successful response missing provider reference",
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", refund.id);
    return json(req, { error: "refund_reconciliation_required" }, 502);
  }

  const { error: finalizeError } = await admin.rpc(
    "finalize_full_card_refund",
    {
      p_refund_id: refund.id,
      p_provider_ref: providerReference,
      p_provider_detail: providerBody,
    },
  );
  if (finalizeError) {
    // The unique requested claim remains in place. An operator can reconcile
    // the successful provider refund without issuing a second one.
    return json(req, { error: "refund_reconciliation_required" }, 500);
  }

  return json(req, { ok: true, refundedEgp: order.total_egp });
});

function json(
  req: Request,
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      ...extraHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
