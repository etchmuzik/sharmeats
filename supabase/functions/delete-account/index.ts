// Supabase Edge Function — Account deletion (Sharm Eats customer app).
//
// Apple App Store Guideline 5.1.1(v): an app that supports account creation
// MUST offer in-app, self-service account deletion. This is the server half of
// that flow. The client (Profile → Delete account) calls it with the signed-in
// user's JWT; it:
//   1. Verifies the JWT and derives the caller from it (never from the body).
//   2. STAGE 1 — calls the anonymize_my_account() RPC in the USER's context
//      (RLS + auth.uid() scope every write to the caller's own rows). This
//      detaches + PII-scrubs the user's orders and refuses (check_violation ->
//      HTTP 409) while an order is in flight.
//   3. STAGE 2 — with the SERVICE-ROLE key (admin), HARD-deletes the auth user.
//      That cascades auth.users -> public.users -> addresses / payment_methods /
//      push_tokens / favorites / merchant_staff. Soft delete is NEVER used:
//      it would leave auth.users alive (the "deactivate is insufficient" case
//      Apple rejects).
//
// The service-role key lives ONLY here, never in the client.
//
// Deploy (JWT verified at the platform edge AND re-checked here):
//   supabase functions deploy delete-account --project-ref <REF>
// Requires the standard auto-injected secrets: SUPABASE_URL,
// SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  // CORS preflight.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  try {
    // 1. Extract the bearer token.
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return json({ error: 'missing_authorization' }, 401);
    }
    const jwt = authHeader.slice('Bearer '.length);

    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // 2. USER-context client (RLS + auth.uid() apply). Verify the JWT and take
    //    the caller's identity ONLY from the verified token — never the body.
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser(jwt);
    if (userErr || !user) {
      return json({ error: 'invalid_token' }, 401);
    }
    const uid = user.id;

    // 3. STAGE 1 — anonymize the caller's data in their own context. Must
    //    succeed before the irreversible auth delete. Idempotent, so the
    //    client may safely retry on transient failure.
    const { error: rpcErr } = await userClient.rpc('anonymize_my_account');
    if (rpcErr) {
      // check_violation = our active-order guard (or no auth context).
      if (rpcErr.code === '23514' || /ACTIVE_ORDER/i.test(rpcErr.message ?? '')) {
        return json({ error: 'active_order' }, 409);
      }
      console.error('[delete-account] anonymize failed', { uid, code: rpcErr.code });
      return json({ error: 'anonymize_failed' }, 500);
    }

    // 4. STAGE 2 — admin HARD-delete of the auth identity (cascades to the
    //    public schema). NEVER pass shouldSoftDelete: true.
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: delErr } = await admin.auth.admin.deleteUser(uid);
    if (delErr) {
      // Idempotency: an already-deleted user is success on retry. Branch on
      // status/code, not a brittle message match.
      const status = (delErr as { status?: number }).status;
      const code = (delErr as { code?: string }).code;
      if (status === 404 || code === 'user_not_found') {
        return json({ success: true }, 200);
      }
      console.error('[delete-account] auth delete failed', { uid, status });
      return json({ error: 'delete_failed' }, 500);
    }

    return json({ success: true }, 200);
  } catch (e) {
    console.error('[delete-account] unexpected', e);
    return json({ error: 'internal_error' }, 500);
  }
});
