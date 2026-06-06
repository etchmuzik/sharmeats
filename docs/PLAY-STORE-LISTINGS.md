# Google Play Store — Listing Content (copy-paste ready)

Everything to fill in Google Play Console for **Sharm Eats** (customer) and
**Sharm Eats Driver**. Drafted 2026-06-06 from PRODUCT.md + the iOS App Review
notes, so the facts match the App Store submission and the privacy policy.

**Play character limits** (enforced): app title ≤ 30 · short description ≤ 80 ·
full description ≤ 4000. All text below is within limits.

Shared facts for both apps:
- **Developer / contact email:** support@sharmeats.online
- **Privacy policy URL:** https://sharmeats.online/privacy
- **Website:** https://sharmeats.online
- **Category:** Food & Drink (customer) · Maps & Navigation *or* Business (driver)
- **Default language:** English (US); add Arabic (ar) as a second listing locale later.
- **Pricing:** Free
- **Contains ads:** No
- **In-app purchases:** No (all payment is COD or external Paymob — not Google Play Billing)

---

# 1) Sharm Eats (customer) — `eg.sharmeats.customer`

### App name (≤ 30)
```
Sharm Eats: Food Delivery
```
*(25 chars. Alternatives if you want the city in it: "Sharm Eats — Food Delivery".)*

### Short description (≤ 80)
```
Food delivery in Sharm el-Sheikh — to your hotel, home, or beach. Cash or card.
```
*(79 chars.)*

### Full description (≤ 4000)
```
Sharm Eats delivers food from local restaurants and shops straight to your hotel
room, apartment, or beach spot in Sharm el-Sheikh — whether you're a visitor or
you live here.

Browse nearby kitchens, build your order exactly how you like it, and track it
live from the restaurant to your door. Pay with cash on delivery or by card —
your choice.

WHY SHARM EATS
• Made for Sharm — real local restaurants, real delivery zones, honest ETAs.
• For visitors and residents alike — order to a hotel (Naama Bay, Sharks Bay,
  Nabq), an apartment, or a beach club. No Egyptian SIM or local know-how needed.
• English and Arabic — a real bilingual app with full right-to-left support, not
  a bolted-on translation.
• Start as a guest — browse and order with no account and no sign-up. Create one
  only if you want to save addresses across devices.
• Cash or card — pay cash on delivery, or by card through Paymob, Egypt's
  licensed payment provider. Your card details are never stored in the app.

HOW IT WORKS
1. Open the app and start as a guest.
2. Browse restaurants and shops near you.
3. Customize your dish — size, ingredients, add-ons.
4. Add your delivery address (optionally drop a precise GPS pin so the driver
   finds you).
5. Place your order and pay cash on delivery or by card.
6. Track your order live — accepted, prepared, on the way, delivered.

PRIVACY
We collect only what an order needs (contact, delivery address, optional GPS
pin). Location is requested only when you add an address, when-in-use only —
never in the background, never for tracking or advertising. We don't sell your
data. Full policy: https://sharmeats.online/privacy

Hungry in Sharm? Order in a few taps. Sharm Eats brings the food to you.
```

### Graphics you already have (reuse from iOS)
- **App icon (512×512):** `landing/public/brand/icon-512.png`
- **Phone screenshots:** `apps/customer/store-screenshots-clean/iphone69/` (these
  are tall portrait PNGs — Play accepts 1080×1920-ish; the 6.9" set works). Need
  **2–8**; you have 8 (home, browse, restaurant, item, cart, checkout, tracking, orders).
- **Feature graphic (1024×500):** ⚠️ **NOT yet made** — Play requires this one
  banner image. Can be generated from the brand (wordmark on a coastal coral/teal
  background). Flag: this is the one missing asset.

### Content rating questionnaire (IARC) — expected answers
- Violence: None · Sexual content: None · Profanity: None · Drugs/alcohol/tobacco:
  None (the app does not sell alcohol/tobacco/Rx) · Gambling: None ·
  User-generated content: No · Shares location: **Yes** (with the driver, to
  fulfil delivery) → expected rating: **Everyone / PEGI 3**.

### Data Safety form (must match privacy policy)
Answer "Yes, this app collects/shares user data," then declare:

| Data type | Collected | Shared | Purpose | Optional? |
|---|---|---|---|---|
| Name | Yes | Yes (restaurant/driver) | App functionality (delivery) | Required for order |
| Phone number | Yes | Yes (restaurant/driver) | App functionality, customer support | Required for order |
| Address | Yes | Yes (driver) | App functionality (delivery) | Required for order |
| Precise location (GPS pin) | Yes | Yes (driver) | App functionality (delivery) | **Optional** (user adds pin) |
| Purchase history (orders) | Yes | No | App functionality | Required |
| App-account / user ID | Yes | No | App functionality, fraud prevention | — |
| Payment info | **No** (handled by Paymob; not collected by us) | — | — | — |

- **Is data encrypted in transit?** Yes.
- **Can users request deletion?** Yes — via support@sharmeats.online.
- **Data used for tracking / advertising?** No.

> Note: card data is processed by Paymob on their secure checkout and is **not**
> collected or stored by the app — so do NOT declare payment info as collected.

---

# 2) Sharm Eats Driver — `eg.sharmeats.driver`

> ⚠️ **Background-location review.** This app declares `ACCESS_BACKGROUND_LOCATION`
> + `FOREGROUND_SERVICE_LOCATION`. Google requires a **prominent in-app disclosure**
> and a **short demo video** showing why background location is needed (live
> delivery tracking) before approving. Budget for this in the review. The app is a
> courier tool, so internal-testing distribution is fine; the video is needed for
> production.

### App name (≤ 30)
```
Sharm Eats Driver
```
*(17 chars.)*

### Short description (≤ 80)
```
Driver app for Sharm Eats couriers — accept jobs, navigate, deliver, get paid.
```
*(78 chars.)*

### Full description (≤ 4000)
```
Sharm Eats Driver is the courier app for delivery drivers working with Sharm
Eats in Sharm el-Sheikh. It is for approved drivers only.

Go online, accept delivery jobs, pick up from the restaurant, and deliver to the
customer — with live navigation and clear, glanceable pay for every job.

FOR DRIVERS
• Go online / offline with one tap.
• See new delivery jobs with pickup, drop-off, and pay up front.
• Accept a job and follow it through: head to the restaurant, pick up, deliver.
• Live location sharing while you're on a delivery, so the customer and dispatch
  can see your progress.
• Collect cash on delivery and confirm it in the app.
• Built for one-handed use, outdoors, in bright sun — big tap targets, clear
  status.

LOCATION
This app uses your location, including in the background while you are on an
active delivery, to share your live position with the customer and dispatch so
deliveries can be tracked and routed. Location sharing happens only while you are
online and on a job. Full policy: https://sharmeats.online/privacy

This app requires a Sharm Eats driver account. If you'd like to drive with us,
contact support@sharmeats.online.
```

### Graphics
- **App icon (512×512):** the teal driver icon — `apps/driver/assets/icon.png`
  (or export 512 from the brand set).
- **Phone screenshots:** ⚠️ **NOT yet captured** — the driver app has no store
  screenshots. Need 2–8 (sign-in, online toggle/home, a job card, active
  delivery/navigation, collect-cash confirm). Capture from the APK on a phone or
  a build.
- **Feature graphic (1024×500):** ⚠️ NOT yet made.

### Content rating (IARC)
Same as customer but note **shares location: Yes** (background, with dispatch/
customer for delivery). Expected: **Everyone / PEGI 3**. There is no UGC, no
ads, no purchases.

### Data Safety form
| Data type | Collected | Shared | Purpose | Optional? |
|---|---|---|---|---|
| Name | Yes | Yes (customer/dispatch) | App functionality | Required (driver account) |
| Phone number | Yes | Yes (dispatch) | App functionality, support | Required |
| Precise location | Yes | Yes (customer/dispatch) | App functionality (live delivery tracking) | Required while on a job |
| **Background location** | **Yes** | Yes | Live delivery tracking while on an active job | Required while on a job |
| App-account / user ID | Yes | No | App functionality | — |

- Encrypted in transit: Yes · Deletion: via support@sharmeats.online · Tracking/ads: No.

---

# Assets checklist before you can publish

| Asset | Customer | Driver |
|---|---|---|
| App icon 512×512 | ✅ have | ✅ have |
| Phone screenshots (2–8) | ✅ have (8, from iOS) | ❌ **need to capture** |
| **Feature graphic 1024×500** | ❌ **need to make** | ❌ **need to make** |
| Short + full description | ✅ above | ✅ above |
| Data safety answers | ✅ above | ✅ above |
| Content rating answers | ✅ above | ✅ above |

The text is done. The remaining gaps are **graphics**: a 1024×500 feature graphic
for each (Play requires it), and driver phone screenshots. Both can be generated/
captured before you publish — say the word and I can produce the feature graphics
from the brand and capture driver screenshots from the APK.
```
