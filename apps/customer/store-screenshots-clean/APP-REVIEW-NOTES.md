# Sharm Eats — App Review response (Guideline 2.1, Information Needed)

This file holds the text to paste into **App Store Connect → App Review
Information → Notes** when resubmitting, plus a checklist of the binary/asset
fixes that accompany it. Drafted 2026-06-05. Resubmit is on hold until two
user-supplied items are ready (see "Still needed from you").

---

## A. Paste into the "Notes" field (answers Apple's 7 questions)

> Thank you for the review. Below is the information requested.
>
> **1. App purpose & target audience.** Sharm Eats is a local food-delivery app
> for Sharm el-Sheikh, Egypt. It lets visitors (hotel guests, tourists) and
> residents browse nearby restaurants and shops, customize dishes, and order
> delivery to a hotel room, an apartment, or a beach spot. The audience is
> general (rating 4+): tourists staying in Sharm and local residents.
>
> **2. Demo account / how to access all features.** No account is required.
> The app is guest-first: on launch, tap **"Start as guest"** on the onboarding
> screen to access the entire app — browse restaurants, open a restaurant menu,
> customize an item, add to cart, and reach checkout — with no login, no
> credentials, and no paywall. (An optional phone sign-in exists for saving
> addresses across devices, but it is never required to use or evaluate the
> app.) Therefore no demo username/password is needed.
>
> **3. Which features require the listed permissions.** The app requests
> **location only once**, and only when the user adds a new delivery address
> (Address → "Add a precise GPS pin"). The GPS pin is attached to the delivery
> address so the driver can find the customer's hotel/apartment/beach location.
> Location is **when-in-use only**, never collected in the background, and never
> used for tracking or advertising. The purpose string
> (NSLocationWhenInUseUsageDescription) is included in this build and explains
> this to the user at the prompt.
>
> **4. External / backend services.** The app uses:
> • **Supabase** — our hosted backend for the restaurant catalog, menus, and
>   order records (anonymous, RLS-protected sessions; the customer never logs
>   into Supabase directly).
> • **Paymob** — Egypt's licensed payment processor — to handle card payments
>   at checkout. Cash on delivery and local wallets (Fawry, Vodafone Cash) are
>   also offered. No card data is stored in the app.
> • **Unsplash** — source of placeholder food imagery only.
> No other third-party SDKs collect user data.
>
> **5. Differences across regions.** There are none functionally. The app is
> bilingual (English / Arabic, with full RTL for Arabic) and the same features
> are available everywhere it is offered. The content (restaurants in Sharm
> el-Sheikh) is identical regardless of the user's country; only the UI language
> follows the device/user setting.
>
> **6. Regulated content / industries.** Sharm Eats is not part of a regulated
> industry. It is a standard food-and-shop delivery marketplace. It does not
> provide alcohol, tobacco, pharmaceuticals as a regulated dispensary,
> gambling, or any other regulated category requiring special documentation.
> (One listing is a convenience/parapharmacy storefront for everyday items; it
> does not dispense prescription medication through the app.)
>
> **7. In-app purchases / subscriptions.** The app has **no in-app purchases
> and no subscriptions** (no Apple IAP). All payment for food orders is handled
> through the licensed external payment processor (Paymob) or cash on delivery,
> which is permitted for physical goods/services delivered in the real world.
>
> A screen recording demonstrating guest access and the full order flow on a
> physical device is attached to this submission. Please let us know if any
> further detail would help. Thank you.

---

## B. Accompanying binary / asset fixes (so Apple's auto-flags clear)

- [x] **Guideline 5.1.1 (purpose strings):** Added
  `NSLocationWhenInUseUsageDescription` to `app.json`
  (`expo.ios.infoPlist`). Committed `54c7795`. **Requires a new build** (#9)
  since Info.plist is compiled into the binary — the live build (#8) lacks it.
  Audited: location is the ONLY permission-gated API the app uses (no camera,
  photos, notifications, contacts, or tracking), so this is the only string
  required.
- [ ] **Guideline 2.3.3 (screenshots show app in use):** Replacing the
  marketing-poster screenshots with clean native in-app captures (home, browse,
  restaurant menu, item customization, cart, checkout, tracking, orders) taken
  from the running app on simulator. Swap these into App Store Connect before
  resubmitting.
- [ ] **Guideline 3.1.2 (subscriptions):** Not applicable — no IAP/subscriptions
  in the app (covered in Notes item 7). No action needed unless Apple's metadata
  scan flagged a stray "subscription" keyword; if so, remove it from the
  description/keywords.

## C. Still needed from you before resubmit
1. **Screen recording on a physical device** — short clip showing: launch →
   "Start as guest" → browse a restaurant → customize an item → add to cart →
   checkout. Upload it as an App Review attachment (or host + link in Notes).
   Apple explicitly asked for this (their item 1) and it must be a real device,
   not the simulator.
2. **App Review contact phone number** — App Store Connect requires a reachable
   phone number in the App Review Information section. (Name/email already set
   to the account holder.)
