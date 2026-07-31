# FOLLOWUPS — `apps/admin-web/`

Scope: `apps/admin-web/` only. Verified with `npx tsc --noEmit` (clean), `npx vitest run`
(50 tests, 4 files, all pass), `npm run lint` (clean) and `npx next build` (succeeds in
both the server and `STATIC_EXPORT=1` branches — see the one caveat at the bottom).

---

## Fixed

### FX operator surface (the 2026-08-06 expiry)

- `src/lib/fx.ts` (new, 190 lines) — pure validation, freshness and error mapping for
  migration 182: supported quotes, the 0.05–500 EGP-per-unit sanity range, the 1–720h
  shelf life, the >10% jump guard, and `PGRST202` "migration not applied" detection.
  Every bound mirrors a check inside `fx_apply_observation`; the RPC stays the authority.
- `src/lib/fx.test.ts` (new) — 24 tests, including the swapped-orientation bug (0.019
  instead of 52.85), the fat-fingered 5285, and `fxHealth` trusting the server's `stale`
  flag over a skewed browser clock.
- `src/app/fx/page.tsx` (new) — reads `current_fx_rates()` (the same call the customer app
  makes), writes only through `admin_set_fx_rate(p_quote, p_rate, p_reason, p_stale_hours,
  p_allow_jump)`. Shows all four currencies including ones with **no** active row (the
  state the RPC cannot report), flags anything within 72h of expiry, requires a reason,
  confirms the move percentage before submitting, and turns `RATE_JUMP_REJECTED` into
  "tick *this jump is intended* and submit again" rather than a raw `check_violation`.
- `src/app/navItems.ts:83` — `/fx` added to the Money group, admin only.

### Security headers (P1)

- `public/.htaccess:26-64` — `Content-Security-Policy: frame-ancestors 'none'`,
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy:
  no-referrer`, `Permissions-Policy` denying geolocation/camera/mic/payment/usb,
  `X-Robots-Tag: noindex, nofollow`, and HSTS `max-age=31536000` (`env=HTTPS`).
  This is the file that matters: the production deploy is a static export on Apache,
  where `next.config` `headers()` does nothing. `always` is used so the headers survive
  the SPA-fallback/404 responses. HSTS deliberately omits `includeSubDomains`/`preload` —
  committing the parent domain's other names is not this file's decision. `<If>` was
  avoided in favour of `env=HTTPS` because a syntax LiteSpeed rejects would 500 the
  whole dashboard.
- `next.config.mjs:20-42,60-66` — the same header set for `next dev` / `next start`,
  declared only in the non-export branch so it is never silently ignored.
- No `middleware.ts` was added: it would not run in a static export, so it would be
  protection that exists only in development.

### Sentry on caught errors, money paths (P1)

`captureError` (already existed, already normalises `PostgrestError`) wired into every
caught failure on a money screen, each with `{surface, screen, action}` plus the ids and
amounts needed to identify the attempt. Notes and free-text stay out of the payload.

- `src/app/finance/page.tsx` — load settlements, `platform_revenue_report`,
  `admin_issue_credit`, `generate_settlements`, `finalize_settlement`,
  `mark_settlement_paid` (6 sites).
- `src/app/driver-finance/page.tsx` — load, generate, finalize, mark paid (4 sites).
- `src/app/cash/page.tsx` — load balances, `record_cash_handin`, cash adjustment (3).
- `src/app/founding-rates/page.tsx` — report load, set expiry, set commission, and the
  partial-failure branch (4).
- `src/app/onboarding/page.tsx` — `approve_restaurant`, `admin_set_commission` (2).
- `src/app/fx/page.tsx`, `src/app/audit/page.tsx` — all failures except
  `RATE_JUMP_REJECTED`, which is the database asking for a second decision, not a fault.

### Money-out audit surface (P1)

- `src/app/audit/page.tsx` (new) — a readable, time-ordered feed of what this dashboard
  has paid out, over 24h / 7d / 30d, built **only from tables that already record it**:
  `credit_ledger` (positive deltas, actor stamped), `driver_cash_ledger` (`adjustment` /
  `write_off`), and `restaurant_settlements` / `driver_settlements` rows marked paid.
  Names resolved via `admin_resolve_user_names` (mig 098) and a direct `drivers` read.
  Includes **credit issued per person** — the closest readable substitute for the
  aggregate cap that does not exist — a CSV export through the guarded `toCsv`, a
  500-row-per-source bound with a "you may not be seeing everything" warning, and an
  explicit banner naming what is *not* recorded anywhere (below).
- `src/app/navItems.ts:84` — `/audit` as "Money out", Money group, admin only.

### CSV formula injection (P2)

- `src/lib/csv.ts:4-46` — `neutralizeFormula` prefixes `'` on any cell starting with
  `= + - @ TAB CR`, applied *before* RFC-4180 quoting so the guard sees the real first
  character. Plain signed numbers (`-450`, `-1250.75`) are exempt — `driver_settlements
  .net_payable_egp` is legitimately negative and quoting it would turn the finance team's
  SUM column into text. Covers all four exports (finance, driver-finance, cash,
  founding-rates) plus the new audit export, since they all go through `toCsv`.
- `src/lib/csv.test.ts` (new) — 8 tests, including `=HYPERLINK`, `+cmd|'/c calc'!A1`,
  and the negative-number exemption.

### Password-reset TOTP bypass (P2, client half)

- `src/app/reset-password/page.tsx:61-84` — after `updateUser({password})` the page now
  checks the assurance level and, if a code is owed **or the check is indeterminate**,
  signs the recovery session out and routes to `/login` with an explicit message. It
  fails CLOSED here (the opposite of the sign-in gate, which fails open to avoid locking
  the only admin out) because the user has just chosen a password they know.
- `src/app/OpsShell.tsx:69-81` — the shell every signed-in route passes through now signs
  out any session whose `mfaGate` says `code_required`. Fails open on an indeterminate
  answer, by the same reasoning as `lib/mfa.ts`.

### Production source maps shipped to Hostinger (P2)

- `scripts/strip-sourcemaps.mjs` (new) — deletes every `.map` from `out/` and strips the
  `sourceMappingURL` comment from `.js` **and** `.css`, after the Sentry upload. Sentry
  keeps its copy, so symbolication is unaffected; the maps merely stop being public.
- `package.json:9,11` — `build:export` now chains `sourcemaps:strip`.
- `next.config.mjs:14-22` — comment updated to say the maps are a build artifact, not a
  shipped one. Verified end to end: 34 maps and 34 comments removed, `out/.htaccess`
  present with the new headers.

### Support inbox unbounded query (P3)

- `src/app/support/page.tsx:61-72` — the thread list is built from the newest 400 messages
  instead of every support message ever sent (previously re-fetched on load, on every
  thread click, and after every reply).
- `src/app/support/page.tsx:109-124` — an opened thread loads the newest 200 messages
  (ordered `desc` + `limit`, then reversed — an ascending limit would have returned the
  *oldest* and hidden the message being replied to), and its error is now surfaced
  instead of silently rendering an empty conversation.

### "Move to standard rate" false success (P3)

- `src/app/founding-rates/page.tsx:174-215` — the second RPC's error is captured instead
  of discarded. On partial failure the toast now says the restaurant **is** on 15% but
  their founding window was not cleared, so they stay in the list and the end date must
  be cleared by hand. The list reloads either way.

---

## Deliberately NOT fixed

### Server-side AAL assertion — SQL agent's scope, and the real fix

The TOTP bypass is only *contained* client-side. A recovery session (or any aal1 session)
that never loads this app can still call `admin_issue_credit`, `admin_set_commission`,
`approve_restaurant` and every other admin RPC directly with its access token: the gates
are all `coalesce(public.auth_role()::text,'') <> 'admin'` and none of them looks at
assurance level. The required change, for whoever owns the SQL:

```sql
-- in every admin-authority RPC, after the role check:
if coalesce(auth.jwt()->>'aal', 'aal1') <> 'aal2' then
  raise exception 'MFA_REQUIRED' using errcode = 'check_violation';
end if;
```

Gate it on the admin having a verified factor first (`auth.mfa_factors`), or the single
production admin locks themselves out the moment it ships. This is a genuine
authorisation change and needs the migration author's judgement, not a UI patch.

### Money-out records that do not exist

The audit screen says this on the page, and it is worth repeating here because it is a
schema gap, not a UI gap:

1. **No actor on settlement payouts.** `restaurant_settlements` / `driver_settlements`
   store `paid_at` and `paid_reference` but no `paid_by`. `mark_settlement_paid` /
   `mark_driver_settlement_paid` would need to stamp `auth.uid()`.
2. **Commission changes are not logged at all.** `admin_set_commission` (mig 126) writes
   `restaurants.commission_pct` and `updated_at` and records nothing else — no before
   value, no actor, no reason. A rate silently moved from 5% to 15% (or 15% to 0%) leaves
   no trace anywhere. This is the single biggest remaining audit hole on the money side.
3. **No aggregate cap or alert on credit issuance.** `admin_issue_credit` caps one call at
   5,000 EGP and nothing counts the calls. A per-actor daily ceiling and an `ops_alert`
   above a threshold both belong in the RPC, not in the browser — a client-side cap is
   advisory only. The new per-person totals make an unusual day *visible*; they do not
   prevent one.

### Other missing operator surfaces — prioritized (not built, per instructions)

FX was the urgent one. The rest, by what breaks if they stay missing:

| # | RPC / gap | Why it matters | Urgency |
|---|---|---|---|
| 1 | `provision_driver` (mig 108) + `driver_applications` | Drivers can apply; **nothing in the product can approve one**. Onboarding a driver today means hand-running SQL. | High — blocks fleet growth from day one |
| 2 | `admin_grant_cod_override` (mig 149) | A driver at the COD ceiling stops receiving cash orders. There is no way to raise their limit for a shift, so the fix is "take them offline". | High — happens on a busy COD day, which is every day |
| 3 | `ops_deliveries_missing_proof` | Deliveries with no proof of delivery are the dispute evidence trail. Currently readable only from psql. | Medium — matters at the first chargeback/complaint |
| 4 | `admin_upsert_kitchen` (mig 126) | Own-brand kitchens (rent, lease dates, address) are seeded by SQL. Rare, but every edit is a hand-written statement against production. | Medium |
| 5 | `admin_set_merchant_type` (mig 126) | Flipping a merchant to `own_brand` changes settlement and revenue arithmetic. Rare and high-blast-radius — arguably *should* stay SQL-only, but then say so in the runbook. | Low–Medium |
| 6 | `admin_assign_merchant_vertical` (mig 158) | Called from one place already (`menu/`); a dedicated surface only matters when a second vertical launches. | Low |
| 7 | `ops_stats_text` / `ops_daily_digest` / `admin_test_ops_alert` | Telegram already delivers these. A web mirror is convenience, and `admin_test_ops_alert` is a one-off setup tool. | Low |

### Not touched (out of scope or wrong tool)

- **Paymob / card payments** — nothing in this scope touched them, as instructed. Note
  only: the finance CSV includes `card_sales_egp`, which is now formula-guarded like
  every other column; no card *logic* was changed.
- **`window.prompt` / `window.confirm` for money input** (`cash`, `founding-rates`,
  `finance` mark-paid, `onboarding`). A `prompt()` that returns `"1e5"` parses as 100,000,
  is unlabelled, uncancellable-with-context and unstyled — for hand-in amounts and signed
  adjustments this is genuinely poor. Replacing them is a real UI change across four
  screens (modal component + per-screen forms, >150 lines) and a product decision about
  confirmation copy, so it is written up rather than half-built. The RPCs validate
  server-side, so this is a usability and mis-entry risk, not an authorisation one.
- **`/audit` has no realtime or pagination.** Deliberate: it is a review screen with a
  bounded window and an honest "you hit the limit" warning, not an archive browser.

---

## Found along the way (not in the audit)

1. **`npm run build` fails without Supabase env vars.** `next build` prerenders `/login`,
   which constructs the Supabase client during render, and `createClient` throws
   `supabaseUrl is required`. Pre-existing (unrelated to these changes) and it means the
   build is only reproducible with `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   set — including in CI. Both builds verified green with dummy values. Cheapest fix:
   make `createSupabaseBrowserClient()` lazy at the call site, or give the two env vars
   build-time placeholder defaults.
2. **The thread-list unread badge is now window-bounded.** With the 400-message scan, a
   conversation whose only unread message is older than the window will not be counted.
   Correct fix is a server-side `support_unread_counts` view/RPC rather than counting in
   the browser; noted rather than papered over.
3. **`fx_rates_health_sweep`'s alert text tells the operator to call
   `admin_set_fx_rate(quote, rate, reason)`.** Now that `/fx` exists, that message should
   point at the screen instead. One-line change in mig 182's function body — SQL agent's
   file, so not touched here.
4. **The seeded FX rates are labelled `baseline:static-table`** and are, by their own
   note, "Phase-0 planning values, never updated in repo history". The `/fx` screen shows
   the source verbatim, so an operator can now see that the live EUR rate has never been
   a real rate. Somebody should set all four before 2026-08-06.
