# Deploy `expo-push` (N4 localization + N7 new events) — owner run

**Why now:** migrations 086–094 are live in prod. Migration **093 (N7)** added DB
triggers that emit 6 new push events (`order_cancelled_driver`,
`settlement_finalized`, `settlement_paid`, `kyc_approved`, `kyc_rejected`,
`kyc_submitted`). The deployed `expo-push` is **v10**, which predates both those
keys and the N4 per-locale copy. Until you deploy the merged version, those 6
events fire but fall back to the function's **generic English** title/body, and
all other pushes stay English-only. This deploy makes them localized (×5) and
event-specific.

**Safe to deploy:** N4 is merged to `main` (`b19f7f6`). The request contract is
unchanged; behavior for `en` users is byte-identical (locked by `copy.test.ts`).
`PUSH_INTERNAL_SECRET` is already set in prod (v10 uses it), so auth doesn't
change. `deno test supabase/functions/` = 19/19 passing locally.

---

## ⚠️ The one thing that must be right: `--no-verify-jwt`

`expo-push` authenticates its callers itself, via an `x-internal-secret` header
(the Vault secret `push_internal_secret`, attached by the DB's `push_headers()`).
It is **not** called with a user JWT. The deployed function has `verify_jwt =
false`. There is **no `supabase/config.toml`** in this repo, so a bare
`supabase functions deploy` would reset it to the default `verify_jwt = true` —
which would make **every DB→function push 401** (silent, since pushes are
best-effort). **You must pass `--no-verify-jwt`.** The function's own header
comment (`index.ts:12`) says the same.

---

## Steps (run on your Mac — `supabase` CLI v2.62.5 is installed)

```bash
cd /Users/etch/Downloads/sharmeats
git checkout main && git pull        # ensure b19f7f6 (N4) is present

# 1. Log in / link if not already (opens browser once)
supabase login
supabase link --project-ref ilqpsebcfbaoaogimhud   # if not linked

# 2. Confirm the secret exists (do NOT reset it — v10 already uses it)
supabase secrets list --project-ref ilqpsebcfbaoaogimhud | grep PUSH_INTERNAL_SECRET
#   -> if MISSING (it shouldn't be): supabase secrets set PUSH_INTERNAL_SECRET=<same value the DB Vault holds>
#      (must match vault.decrypted_secrets 'push_internal_secret' — mismatch = all pushes 401)

# 3. DEPLOY — the --no-verify-jwt flag is mandatory (see warning above)
supabase functions deploy expo-push \
  --project-ref ilqpsebcfbaoaogimhud \
  --no-verify-jwt

# 4. Confirm it bumped past v10 and verify_jwt is still false
supabase functions list --project-ref ilqpsebcfbaoaogimhud | grep expo-push
```

---

## Verify it worked (no test-spam needed)

Ask me to run these after you deploy, or run them yourself:

1. **Version bumped, JWT still off** — `functions list` shows `expo-push` at v11+
   and `verify_jwt: false`.
2. **A real push renders localized** — trigger any one event, e.g. finalize a
   test settlement (`select finalize_settlement('<draft_settlement_id>')` as
   admin) → the merchant should get `settlement_finalized` copy in their
   `users.locale`, not "Order update".
3. **No 401s** — I can pull edge logs (`get_logs edge-function`) and confirm 2xx,
   not 401, on `/expo-push` after the trigger fires.

---

## Heads-up (already flagged): `users.locale` default is `'ar'`

Any user who never explicitly chose a language has `locale = 'ar'` (the column
default). After this deploy they start receiving **Arabic** push copy. That is
intended for a Sharm/Egypt audience, but the visible change is broader than just
users who actively picked AR — expect it and don't mistake it for a bug.

---

## Not part of this deploy (separate owner items)
- **CI billing lock** — GitHub account is billing-locked (annotation: "account is
  locked due to a billing issue"); account-level, not repo. Settings → Billing.
- **N1** watchdog webhook, **F6** leaked-password toggle, **N3/F12** store build.
- **PR #60** (db-types regen) — safe to merge; red CI is the billing lock only.
