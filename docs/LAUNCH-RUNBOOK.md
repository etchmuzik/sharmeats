# Sharm Eats — Launch Runbook (domain + Paymob + deploy)

The apps are built and the schema is live. What remains to go fully live are
**three configuration blockers**, in dependency order. Steps marked **YOU** need
your action (a purchase, a login, a secret, a dashboard click); steps marked
**DONE** are already in the repo.

**Apex domain:** `sharmeats.online`
**Supabase project ref:** `ilqpsebcfbaoaogimhud`
**Apple Team / bundle:** `CHSAVJ5X6U` / `eg.sharmeats.customer`

---

## 1. Domain — register + wire 4 surfaces

### 1.1 Register the domain — **YOU**
`sharmeats.online` is available (checked). Register it at any registrar
(Hostinger, GoDaddy, Namecheap, Cloudflare…). You already use Hostinger for
gosharm.com, so that's a convenient home.

### 1.2 Landing, merchant, and admin (Hostinger static hosting) — **SUPERSEDES the Vercel plan below**
All 3 web surfaces actually deploy as **static exports to Hostinger shared
hosting**, not Vercel — `landing`, `apps/merchant-web`, and `apps/admin-web`
all support `STATIC_EXPORT=1 npm run build` (see each app's `next.config.mjs`),
which produces a Node-free `out/` directory. Each is client-only (Supabase
auth + Realtime in the browser), so this exports cleanly with no API routes.

**To deploy any of the 3 after a code change:**
```bash
cd apps/merchant-web   # or apps/admin-web, or landing
STATIC_EXPORT=1 npm run build
cd out && zip -r ../../<app>-deploy_$(date +%Y%m%d_%H%M%S).zip . && cd ../..
```
Then upload via the Hostinger MCP `hosting_deployStaticWebsite` tool
(`domain` = the subdomain, e.g. `merchant.sharmeats.online`), or manually
through hPanel → File Manager → replace `public_html` for that subdomain.
Verified live 2026-07-01: `curl -sI https://merchant.sharmeats.online` returns
`server: LiteSpeed` / `platform: hostinger`, not a Vercel response header.

DNS: each subdomain already resolves (A/CNAME already wired at the
registrar level to Hostinger) — no further DNS action needed.

<details>
<summary>Original Vercel plan (not what actually shipped — kept for history)</summary>

The landing app has a Vercel project (`prj_UHdybpN705MRgJVv1JDD4juQinzF`) that
was never pointed at the domain. If you ever want to move off Hostinger:
1. Vercel → the landing project → **Settings → Domains → Add** → `sharmeats.online`
   and `www.sharmeats.online`.
2. Vercel shows the DNS records to add at your registrar — typically:
   - `A  @  76.76.21.21`  (Vercel apex)
   - `CNAME  www  cname.vercel-dns.com`
3. Same flow for `merchant.sharmeats.online` → **merchant-web** and
   `admin.sharmeats.online` → **admin-web** Vercel projects, each with a
   `CNAME <sub> cname.vercel-dns.com`.
</details>

### 1.4 iOS universal links — **DONE in repo** (needs the domain live + a rebuild)
- `apps/customer/app.json` → `ios.associatedDomains: ["applinks:sharmeats.online"]` ✅
- `landing/public/.well-known/apple-app-site-association` (appID
  `CHSAVJ5X6U.eg.sharmeats.customer`, paths `/order/*`, `/restaurant/*`,
  `/item/*`, `/track/*`) ✅
- `landing/next.config.mjs` serves it as `application/json` ✅
Once `sharmeats.online` is live, verify:
`curl -s https://sharmeats.online/.well-known/apple-app-site-association | jq .`
(Universal links take effect in the NEXT app build, i.e. #11+.)

### 1.5 Privacy policy page — **DONE in repo**
`landing/src/app/privacy/page.tsx` → live at `https://sharmeats.online/privacy`.
Update the App Store Connect privacy-policy URL to that once the domain resolves.

---

## 2. Paymob — account → keys → deploy → secrets → callback → test

> Card payments flow: customer places a card order → app calls the
> `paymob-create-intention` function → opens Paymob hosted checkout → Paymob
> POSTs the `paymob-webhook` → webhook flips the order to `paid`. COD orders
> skip Paymob entirely. **No card data ever touches our servers.**

### 2.1 Create a Paymob merchant account — **YOU**
1. Sign up at <https://paymob.com> (Egypt). Complete merchant KYC (commercial
   registration / tax card / bank account for payouts). This is the long pole —
   approval can take a few business days.
2. In the dashboard, enable an **online card** integration (Accept → Integrations).
   Note its **Integration ID** (a number).

### 2.2 Collect the 4 credentials — **YOU**
From the Paymob dashboard:
| Secret name | Where to find it |
|---|---|
| `PAYMOB_SECRET_KEY` | Settings → Account Info → **Secret Key** (`sk_...`) |
| `PAYMOB_PUBLIC_KEY` | Settings → Account Info → **Public Key** (`pk_...`) |
| `PAYMOB_INTEGRATION_ID` | Accept → Integrations → your online-card integration ID (number) |
| `PAYMOB_HMAC_SECRET` | Settings → Account Info → **HMAC Secret** |

### 2.3 Deploy the edge functions — **YOU run** (functions already written ✅)
The functions are inert until secrets are set, so deploying first is safe.
The Supabase CLI needs a one-time login (browser):
```bash
cd /Users/etch/Projects/apps/sharmeats
supabase login                       # opens browser, paste access token
supabase link --project-ref ilqpsebcfbaoaogimhud

supabase functions deploy paymob-create-intention --project-ref ilqpsebcfbaoaogimhud
supabase functions deploy paymob-webhook --no-verify-jwt --project-ref ilqpsebcfbaoaogimhud
supabase functions deploy expo-push --project-ref ilqpsebcfbaoaogimhud
```
`--no-verify-jwt` on the webhook is REQUIRED — Paymob calls it without a Supabase
JWT; it authenticates via HMAC instead.

Verify (should be 204/401, NOT 404):
```bash
for f in paymob-create-intention paymob-webhook expo-push; do
  curl -s -o /dev/null -w "$f → %{http_code}\n" -X OPTIONS \
    https://ilqpsebcfbaoaogimhud.supabase.co/functions/v1/$f
done
```

### 2.4 Set the secrets — **YOU** (paste your real values)
```bash
supabase secrets set \
  PAYMOB_SECRET_KEY="sk_live_xxx" \
  PAYMOB_PUBLIC_KEY="pk_live_xxx" \
  PAYMOB_INTEGRATION_ID="123456" \
  PAYMOB_HMAC_SECRET="xxxxxxxx" \
  --project-ref ilqpsebcfbaoaogimhud
```
(`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically by Supabase — you do NOT set those.)

### 2.5 Point Paymob's callbacks at the webhook — **YOU**
In the Paymob dashboard, on your integration, set BOTH callbacks to:
```
https://ilqpsebcfbaoaogimhud.supabase.co/functions/v1/paymob-webhook
```
- **Transaction processed callback** (server-to-server) → the URL above.
- **Transaction response callback** (where the user's browser returns) → the URL
  above is acceptable, or a friendly `https://sharmeats.online/order` page once
  the domain is live.

### 2.6 Test the card flow — **YOU**
1. In the app (real device or sim, live backend), add items → checkout → choose
   **Card** → place order.
2. On Paymob's hosted checkout use a **test card** (Paymob test pan, e.g.
   `4987 6543 2100 0008`, any future expiry, CVV `123`, OTP `123456` — confirm
   current test values in your Paymob dashboard).
3. Confirm the order flips to **paid**:
   ```sql
   select id, short_code, payment_method, payment_status, paymob_order_ref
   from orders order by placed_at desc limit 5;
   ```
4. A failed/abandoned payment should leave it `pending` → `failed`, never `paid`.

---

## 3. After domain + Paymob are live

- **Rebuild the iOS app (#11)** so `associatedDomains` ships:
  `cd apps/customer && eas build -p ios --profile production`
  (Keeps the pinned Xcode 26.2 image + the fmt fix from build #10.)
- **App Store Connect:** set privacy-policy URL → `https://sharmeats.online/privacy`;
  attach the newest build; the v1.0 version is in REJECTED state so it edits in
  place (see `apps/customer/store-screenshots-clean/APP-REVIEW-NOTES.md` §D).
- **Driver/merchant/admin** all point at the same Supabase project already, so no
  change needed beyond their domains (1.3).

---

## 4. Driver app → TestFlight

The driver app (`apps/driver`, bundle `eg.sharmeats.driver`) is now fully
prepped: EAS project linked (`@etchmuzik/sharmeats-driver`), teal icon, fmt
plugin + pinned Xcode 26.2, location purpose strings + background mode. It is
code-complete (sign in → online → accept job → pickup → deliver → COD settle,
all validated live). **Merchant + admin dashboards are already live; only the
driver app still needs building/distributing.**

### 4.1 First build — mint credentials (interactive, one time) — **YOU**
The driver app has no signing credentials on EAS yet (the customer app already
had its own). The FIRST build must run **interactively** so EAS can create the
Distribution Certificate + provisioning profile and register the App ID via your
Mac's Keychain Apple session (no 2FA on this trusted Mac):
```bash
cd /Users/etch/Projects/apps/sharmeats/apps/driver
eas build --platform ios --profile production
```
- When prompted "Generate a new Apple Distribution Certificate?" → **Yes**.
- "Register bundle identifier eg.sharmeats.driver?" → **Yes**.
- It reuses Apple team `CHSAVJ5X6U`. After this once, future builds can run
  `--non-interactive` like the customer app.
- This build will survive the fmt/Xcode-26.4 compile (the fix is in place) — it
  should take ~10–20 min, not die at ~90s.

### 4.2 Create the App Store Connect app record — **YOU** (web UI)
The ASC API key can't create apps (403) — use the web UI:
1. <https://developer.apple.com/account/resources/identifiers> → the App ID
   `eg.sharmeats.driver` should already exist from 4.1; if not, add it.
2. <https://appstoreconnect.apple.com/apps> → **+ → New App**:
   - Platform iOS, Name **“Sharm Eats Driver”**, primary language English,
   - Bundle ID `eg.sharmeats.driver`, SKU `sharmeats-driver-001`.
3. Copy the **Apple ID** (numeric `ascAppId`) ASC shows for the new app.

### 4.3 Wire submit + push to TestFlight — **YOU**
Add the ascAppId to `apps/driver/eas.json` submit profile (mirror the customer
app), then submit:
```jsonc
// apps/driver/eas.json → "submit": { "production": { "ios": {
"ascApiKeyPath": "../customer/credentials/AuthKey_C4TFQQ5AAD.p8",
"ascApiKeyId": "C4TFQQ5AAD",
"ascApiKeyIssuerId": "d19fd03e-1f5b-44b1-a3e9-519b25a39274",
"ascAppId": "<the numeric id from 4.2>"
// } } }
```
```bash
cd apps/driver && eas submit -p ios --profile production --latest
```
Then in App Store Connect → Sharm Eats Driver → TestFlight, add your drivers as
internal/external testers. (The driver app needs no marketing screenshots to go
to TestFlight; full App Store listing is only needed if you later publicly list
it — most delivery fleets keep the driver app TestFlight-only or unlisted.)

### 4.4 Driver test login
Use the seeded driver account (see project memory):
`ahmed.driver@sharmeats.test` / `Driver#Test2026` (or create real driver
accounts via the admin flow).

---

## Quick status

| Blocker | Code/repo | Live config |
|---|---|---|
| Domain registered | — | ☐ YOU |
| Landing + subdomains on Vercel | ✅ | ☐ YOU (DNS) |
| Universal links (AASA + app.json) | ✅ DONE | ☐ needs domain + rebuild |
| Privacy page | ✅ DONE | ☐ needs domain |
| Paymob functions written | ✅ DONE | — |
| Paymob account + keys | — | ☐ YOU |
| Functions deployed | ✅ written | ☐ YOU run (2.3) |
| Secrets + callback set | — | ☐ YOU (2.4–2.5) |
| Card flow tested | — | ☐ YOU (2.6) |
| **Customer app** | ✅ build #10 (.ipa) | ☐ resubmit (TestFlight now) |
| **Merchant dashboard** | ✅ | ✅ LIVE (vercel) |
| **Admin dashboard** | ✅ | ✅ LIVE (vercel) |
| **Driver app** | ✅ prepped + validated | ☐ YOU run 1st build (§4.1) |
