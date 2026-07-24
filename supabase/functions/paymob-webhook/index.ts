// Supabase Edge Function — Paymob transaction webhook.
//
// Paymob calls this endpoint without a Supabase JWT, so deployment intentionally
// uses --no-verify-jwt. Every state change is gated by the Paymob SHA-512 HMAC.
// The callback is bound to payment_attempts.provider_order_id using only the
// HMAC-covered obj.order.id; unsigned merchant references are ignored.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  attemptStatusAfterFailedTransaction,
  amountMatches,
  buildHmacString,
  isSuccess,
  resolveSignedProviderOrderId,
  signedTransactionId,
} from "./verify.ts";

const MAX_BODY_BYTES = 64 * 1024;

async function readPayload(req: Request): Promise<Record<string, unknown>> {
  const declaredLength = Number(req.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new Error("BODY_TOO_LARGE");
  }
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new Error("BODY_TOO_LARGE");
  }
  const payload = JSON.parse(text);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("INVALID_BODY");
  }
  return payload as Record<string, unknown>;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return response("method not allowed", 405, { Allow: "POST" });
  }

  const hmacSecret = Deno.env.get("PAYMOB_HMAC_SECRET");
  const integrationId = Deno.env.get("PAYMOB_INTEGRATION_ID");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!hmacSecret || !integrationId || !supabaseUrl || !serviceRoleKey) {
    return response("service unavailable", 503);
  }

  const providedHmac = new URL(req.url).searchParams.get("hmac") ?? "";
  if (!/^[0-9a-fA-F]{128}$/.test(providedHmac)) {
    return response("invalid hmac", 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await readPayload(req);
  } catch (error) {
    return response(
      error instanceof Error && error.message === "BODY_TOO_LARGE"
        ? "body too large"
        : "bad json",
      error instanceof Error && error.message === "BODY_TOO_LARGE" ? 413 : 400,
    );
  }
  const obj = (payload.obj ?? payload) as Record<string, unknown>;
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return response("bad payload", 400);
  }

  const computedHmac = createHmac("sha512", hmacSecret)
    .update(buildHmacString(obj))
    .digest("hex");
  const providedBuffer = Buffer.from(providedHmac, "hex");
  const computedBuffer = Buffer.from(computedHmac, "hex");
  if (
    providedBuffer.length !== computedBuffer.length ||
    !timingSafeEqual(providedBuffer, computedBuffer)
  ) {
    return response("invalid hmac", 401);
  }

  const providerOrderId = resolveSignedProviderOrderId(obj);
  const providerTransactionId = signedTransactionId(obj);
  const signedIntegrationId = String(obj.integration_id ?? "").trim();
  const signedCurrency = String(obj.currency ?? "").trim().toUpperCase();
  if (!providerOrderId || !providerTransactionId) {
    return response("missing signed reference", 400);
  }
  if (signedIntegrationId !== integrationId || signedCurrency !== "EGP") {
    return response("payment scope mismatch", 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Load only by the HMAC-covered provider order id. This lookup also supplies
  // the authoritative amount used to reject a replay against another order.
  const { data: attempt, error: attemptError } = await admin
    .from("payment_attempts")
    .select("id, order_id, user_id, amount_egp, integration_id, status, provider_txn_id")
    .eq("provider_order_id", providerOrderId)
    .maybeSingle();
  if (attemptError) return response("database unavailable", 500);
  if (!attempt) return response("unknown payment", 400);
  if (
    attempt.integration_id !== integrationId ||
    !amountMatches(obj.amount_cents, attempt.amount_egp)
  ) {
    return response("payment scope mismatch", 400);
  }

  if (!isSuccess(obj)) {
    const failedAt = new Date().toISOString();
    await admin
      .from("payment_attempts")
      .update({
        status: attemptStatusAfterFailedTransaction(attempt.status),
        provider_txn_id: providerTransactionId,
        last_error: "Provider reported an unsuccessful transaction",
        updated_at: failedAt,
      })
      .eq("id", attempt.id);

    if (attempt.user_id) {
      sendPush({
        event: "payment_failed",
        orderId: attempt.order_id,
        recipientUserIds: [attempt.user_id],
      });
    }
    return response("ok");
  }

  const amountCents = Number(obj.amount_cents);
  if (!Number.isSafeInteger(amountCents)) {
    return response("invalid amount", 400);
  }

  // One SQL transaction locks the attempt and order, rechecks every binding,
  // and performs the pending/failed -> paid transition exactly once.
  const { data: settlement, error: settlementError } = await admin.rpc(
    "settle_paymob_payment",
    {
      p_provider_order_id: providerOrderId,
      p_provider_txn_id: providerTransactionId,
      p_amount_cents: amountCents,
      p_integration_id: integrationId,
    },
  );
  if (settlementError) {
    const message = settlementError.message ?? "";
    if (/AMOUNT_MISMATCH|INTEGRATION_MISMATCH|METHOD_MISMATCH/.test(message)) {
      return response("payment scope mismatch", 400);
    }
    if (/ALREADY_PAID|NOT_PAYABLE/.test(message)) {
      return response("payment conflict", 409);
    }
    return response("database unavailable", 500);
  }

  const settled = settlement as {
    orderId?: string;
    userId?: string;
    transitioned?: boolean;
  } | null;
  if (settled?.transitioned && settled.orderId) {
    await admin
      .from("order_status_events")
      .insert({
        order_id: settled.orderId,
        status: "placed",
        note: "Payment confirmed (card)",
      })
      .then(() => {}, () => {});
    sendPush({ event: "order_paid", orderId: settled.orderId });
  }

  return response("ok");
});

function sendPush(body: Record<string, unknown>): void {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${serviceRoleKey}`,
  };
  const internalSecret = Deno.env.get("PUSH_INTERNAL_SECRET");
  if (internalSecret) headers["x-internal-secret"] = internalSecret;
  fetch(`${supabaseUrl}/functions/v1/expo-push`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }).catch(() => {});
}

function response(
  body: string,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(body, {
    status,
    headers: {
      ...extraHeaders,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
