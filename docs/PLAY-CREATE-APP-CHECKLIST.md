# Play Console — create Sharm Eats (customer), fill-in-order

Do these top-to-bottom in Play Console. Every field has the exact value. Start
with **Internal testing** (instant, no verification gate). All assets are in
`apps/customer/store-screenshots/` (Finder window is open).

> ⚠️ First-time note: if your Play developer account was created recently, Google
> requires identity verification + (for personal accounts) a 14-day / 12-tester
> closed test before Production. Internal testing has NO such gate — ship there
> first today.

## A. Create new app (the page you're on)

| Field | Value |
|---|---|
| App name | `Sharm Eats: Food Delivery` |
| Default language | English (United States) – en-US |
| App or game | **App** |
| Free or paid | **Free** |
| Declarations | ✔ Developer Program Policies · ✔ US export laws |

→ **Create app**

## B. Dashboard → "Set up your app" tasks

### App access
- **All functionality is available without special access** (guest-first; no login
  required to browse or order).

### Ads
- **No**, this app does not contain ads.

### Content rating
- Start questionnaire → email: `support@sharmeats.online` → category: **Food & Drink / Utility**.
- Violence: **No** · Sexual: **No** · Profanity: **No** · Controlled substances: **No**
  (does not sell alcohol/tobacco/Rx) · Gambling: **No** · User-generated content: **No**.
- Does the app share the user's current location? **Yes** (with the driver, to deliver).
- → Expected rating: **Everyone / PEGI 3**. Submit.

### Target audience and content
- Target age group: **18 and over** (or 18+; not designed for children).
- Appeals to children: **No**.

### Data safety  (must match https://sharmeats.online/privacy)
- Does your app collect or share user data? **Yes**.
- Is all data encrypted in transit? **Yes**.
- Do you provide a way to request data deletion? **Yes** → `support@sharmeats.online`.
- Data types — declare:

| Data type | Collected | Shared | Purpose | Required? |
|---|---|---|---|---|
| Name | Yes | Yes (restaurant/driver) | App functionality | Required |
| Phone number | Yes | Yes (restaurant/driver) | App functionality, support | Required |
| Address | Yes | Yes (driver) | App functionality (delivery) | Required |
| Precise location | Yes | Yes (driver) | App functionality (delivery) | Optional |
| Purchase history | Yes | No | App functionality | Required |
| User IDs | Yes | No | App functionality, fraud prevention | Required |

- **Payment info: DO NOT declare collected** — Paymob processes cards on their
  checkout; the app never collects/stores card data.
- Used for tracking/advertising? **No**.

### Government apps
- **No**.

### Financial features
- Declare: app facilitates food-delivery payment via **cash on delivery** and an
  external licensed processor (Paymob). No Google Play Billing, no lending/banking.

## C. Store listing  (Main store listing)

| Field | Value | Source |
|---|---|---|
| App name | `Sharm Eats: Food Delivery` | — |
| Short description (≤80) | `Food delivery in Sharm el-Sheikh — to your hotel, home, or beach. Cash or card.` | RELEASE/LISTINGS doc |
| Full description (≤4000) | copy the block from `docs/PLAY-STORE-LISTINGS.md` §"Full description" | doc |
| App icon (512×512) | `landing/public/brand/icon-512.png` | repo |
| **Feature graphic (1024×500)** | `apps/customer/store-screenshots/play-feature-graphic.png` ✅ (just made) | repo |
| Phone screenshots (2–8) | the 6 in `apps/customer/store-screenshots/iphone69-ios-statusbar/` (use the `.jpg`) | repo |
| App category | **Food & Drink** | — |
| Email | `support@sharmeats.online` | — |
| Privacy policy | `https://sharmeats.online/privacy` | live |

## D. Create the release (Internal testing)

1. **Testing → Internal testing → Create new release**.
2. Upload the **AAB** (download already open in browser):
   `https://expo.dev/artifacts/eas/TYneXyLpzCBSdyCtePpqcOmZuJkymrqTNFxbQRvbYyY.aab`
3. Release name: `1.0.0 (2)`.
4. Release notes: paste the `en (Play)` block from `docs/RELEASE-NOTES.md`.
5. **Review release** → **Start rollout to Internal testing**.
6. Internal testing → **Testers** → add your email + team → open the opt-in link
   on an Android phone → install → smoke-test (order, switch language to ru/it/de,
   open Invite screen).

## E. Promote when happy
Internal → Closed/Open testing → Production (Production may trigger the
identity-verification / 12-tester gate if it's a new personal dev account).

---
Every asset referenced here exists in the repo. The only things that are
genuinely yours: the legal declarations (data safety / content rating), identity
verification if prompted, and clicking "Start rollout."
