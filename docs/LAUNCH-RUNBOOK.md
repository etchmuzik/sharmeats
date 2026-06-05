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

### 1.2 Point the landing site (Vercel) — **YOU** (I prepped the code)
The landing app is a Vercel project (`prj_UHdybpN705MRgJVv1JDD4juQinzF`).
1. Vercel → the landing project → **Settings → Domains → Add** → `sharmeats.online`
   and `www.sharmeats.online`.
2. Vercel shows the DNS records to add at your registrar — typically:
   - `A  @  76.76.21.21`  (Vercel apex)
   - `CNAME  www  cname.vercel-dns.com`
   (Use the exact values Vercel displays.)
3. Wait for DNS to verify (minutes to a couple hours).

### 1.3 Merchant + admin subdomains (Vercel) — **YOU**
Same flow on the respective Vercel projects:
- `merchant.sharmeats.online` → the **merchant-web** project
- `admin.sharmeats.online` → the **admin-web** project
Add a `CNAME <sub> cname.vercel-dns.com` for each.

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
