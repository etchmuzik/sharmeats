// Supabase Edge Function — Paymob Unified Intention creator.
//
// The authenticated customer supplies only an order id. The order amount and
// ownership come from the database. A private payment_attempts row claims the
// order before Paymob is called, so concurrent/retried requests cannot create
// multiple hosted checkouts. Card payments remain disabled until this function,
// migration 121, and the webhook have passed Paymob sandbox verification.

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  attemptCanAutoExpire,
  checkoutResponse,
  resolveProviderIntentionId,
  resolveProviderOrderId,
} from "./logic.ts";

const PAYMOB_ORIGIN = "https://accept.paymob.com";
const PAYMOB_INTENTION_URL = `${PAYMOB_ORIGIN}/v1/intention/`;
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

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const declaredLength = Number(req.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new Error("BODY_TOO_LARGE");
  }
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new Error("BODY_TOO_LARGE");
  }
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("INVALID_BODY");
  }
  return parsed as Record<string, unknown>;
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
  const publicKey = Deno.env.get("PAYMOB_PUBLIC_KEY");
  const integrationId = Deno.env.get("PAYMOB_INTEGRATION_ID");
  if (
    !supabaseUrl || !anonKey || !serviceRoleKey ||
    !secretKey || !publicKey || !integrationId
  ) {
    return json(req, { error: "service_unavailable" }, 503);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json(req, { error: "unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await readJson(req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return json(
      req,
      { error: code === "BODY_TOO_LARGE" ? "body_too_large" : "invalid_json" },
      code === "BODY_TOO_LARGE" ? 413 : 400,
    );
  }
  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  if (!orderId) return json(req, { error: "order_id_required" }, 400);

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

  // This caller-scoped query intentionally relies on orders RLS for ownership.
  const { data: order, error: orderError } = await userClient
    .from("orders")
    .select(
      "id, short_code, total_egp, restaurant_name, payment_method, payment_status",
    )
    .eq("id", orderId)
    .single();
  if (orderError || !order) return json(req, { error: "order_not_found" }, 404);
  if (order.payment_method !== "card") {
    return json(req, { error: "not_a_card_order" }, 409);
  }
  if (order.payment_status !== "pending") {
    return json(req, { error: "order_not_payable" }, 409);
  }
  if (!Number.isInteger(order.total_egp) || order.total_egp <= 0) {
    return json(req, { error: "invalid_order_amount" }, 422);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const nowIso = new Date().toISOString();

  // Only a `creating` call can age out: its checkout secret was never handed to
  // the customer. A `ready` checkout is always reused because Paymob may still
  // accept it even after our local expiry timestamp.
  const expirableStatuses = (["creating", "ready"] as const).filter(
    attemptCanAutoExpire,
  );
  await admin
    .from("payment_attempts")
    .update({ status: "expired", updated_at: nowIso })
    .eq("order_id", order.id)
    .in("status", expirableStatuses)
    .lt("expires_at", nowIso);

  const { data: existing } = await admin
    .from("payment_attempts")
    .select("id, status, client_secret, checkout_url")
    .eq("order_id", order.id)
    .in("status", ["creating", "ready"])
    .maybeSingle();
  if (
    existing?.status === "ready" && existing.client_secret &&
    existing.checkout_url
  ) {
    return json(req, {
      clientSecret: existing.client_secret,
      checkoutUrl: existing.checkout_url,
    });
  }
  if (existing) {
    return json(req, { error: "payment_initializing" }, 409, {
      "Retry-After": "5",
    });
  }

  const { data: attempt, error: attemptError } = await admin
    .from("payment_attempts")
    .insert({
      order_id: order.id,
      user_id: userData.user.id,
      amount_egp: order.total_egp,
      integration_id: integrationId,
      status: "creating",
    })
    .select("id")
    .single();

  if (attemptError || !attempt) {
    // A concurrent request normally reaches the partial unique index first.
    if (attemptError?.code === "23505") {
      const { data: winner } = await admin
        .from("payment_attempts")
        .select("status, client_secret, checkout_url")
        .eq("order_id", order.id)
        .in("status", ["creating", "ready"])
        .maybeSingle();
      if (
        winner?.status === "ready" && winner.client_secret &&
        winner.checkout_url
      ) {
        return json(req, {
          clientSecret: winner.client_secret,
          checkoutUrl: winner.checkout_url,
        });
      }
      return json(req, { error: "payment_initializing" }, 409, {
        "Retry-After": "5",
      });
    }
    return json(req, { error: "payment_initialization_failed" }, 500);
  }

  const amountCents = order.total_egp * 100;
  let intentionResponse: Response;
  try {
    intentionResponse = await fetch(PAYMOB_INTENTION_URL, {
      method: "POST",
      headers: {
        Authorization: `Token ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amountCents,
        currency: "EGP",
        payment_methods: [Number(integrationId)],
        items: [{
          name: order.short_code,
          amount: amountCents,
          description: `Sharm Eats order from ${order.restaurant_name}`,
          quantity: 1,
        }],
        // The internal attempt id is deliberately not the customer order id.
        special_reference: attempt.id,
        extras: { payment_attempt_id: attempt.id },
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    await admin
      .from("payment_attempts")
      .update({
        last_error:
          "Provider request outcome unknown; manual reconciliation required",
        updated_at: new Date().toISOString(),
      })
      .eq("id", attempt.id);
    return json(req, { error: "payment_provider_unavailable" }, 502);
  }

  const intention = await intentionResponse.json().catch(() => null) as
    | Record<string, unknown>
    | null;
  if (!intentionResponse.ok) {
    await admin
      .from("payment_attempts")
      .update({
        status: "failed",
        last_error:
          `Provider rejected intention with HTTP ${intentionResponse.status}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", attempt.id);
    return json(req, { error: "payment_provider_rejected" }, 502);
  }

  const clientSecret = typeof intention?.client_secret === "string"
    ? intention.client_secret.trim()
    : "";
  const providerOrderId = intention ? resolveProviderOrderId(intention) : null;
  const providerIntentionId = intention
    ? resolveProviderIntentionId(intention)
    : null;
  if (!clientSecret || !providerOrderId) {
    await admin
      .from("payment_attempts")
      .update({
        last_error:
          "Provider response missing client secret or signed order binding",
        updated_at: new Date().toISOString(),
      })
      .eq("id", attempt.id);
    return json(req, { error: "invalid_payment_provider_response" }, 502);
  }

  const checkout = checkoutResponse(PAYMOB_ORIGIN, publicKey, clientSecret);
  const { error: readyError } = await admin
    .from("payment_attempts")
    .update({
      status: "ready",
      provider_intention_id: providerIntentionId,
      provider_order_id: providerOrderId,
      client_secret: clientSecret,
      checkout_url: checkout.checkoutUrl,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", attempt.id)
    .eq("status", "creating");
  if (readyError) {
    return json(req, { error: "payment_initialization_failed" }, 500);
  }

  return json(req, checkout);
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
