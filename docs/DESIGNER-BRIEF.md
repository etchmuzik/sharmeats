# SHARM EATS — Design Brief: Landing Page + Social Media Kit

*Hand this entire document to the designer. Everything in it is verified against the shipped product — nothing here is aspirational except where marked "coming soon".*

---

## 1. What you're designing for

**Sharm Eats** is a three-sided food-delivery platform built exclusively for **Sharm El Sheikh** — one customer app (iOS + Android), a driver app, a restaurant app, a merchant web portal, and the marketing site at **sharmeats.online**. It is live. The customer app is on the App Store (id 6776864451) and Google Play (`eg.sharmeats.customer`).

The one-line positioning (already our hero H1 — keep it):

> **"Food delivery built for Sharm."**

We are not a Talabat clone. The product is designed around how people actually live and vacation in Sharm: tourists in hotels without Egyptian SIM cards, residents who pay cash, kitchens that close for Friday prayer. Every design decision should radiate **local intelligence** — smart, modern, Egyptian, coastal.

## 2. Audiences (design for all four)

1. **Tourists** — Russian, Italian, German, British/international guests in Naama Bay/Nabq resorts. They don't speak Arabic, may have no local SIM, want prices in their currency, and worry about food safety.
2. **Residents & expats** — Egyptians and long-stay foreigners in Hadaba, Old Market, etc. Cash-first, WhatsApp-native, value honest fees.
3. **Drivers** (recruitment creatives) — local couriers who want flexible hours and transparent earnings.
4. **Restaurants** (partner creatives) — kitchen owners who need orders without buying hardware.

## 3. Brand system — MUST use, do not reinvent

All assets exist in the repo (`landing/public/brand/`, canonical code in `landing/src/components/brand/SharmLogo.tsx`, tokens in `DESIGN.md` + `landing/tailwind.config.ts`).

**Wordmark:** type-only — "SHARM" tracked-out in cream + big lowercase "eats" in coral, on a dark `#100e12` squircle tile. Set in **Sora 800**. No symbol, no mascot. **Three approved finishes only:** dark+coral, coral-ink gradient (`#ff7559 → #ed3f20`), sand-light. Never recolor, never add effects, never set the wordmark in another font.

**Palette:**
| Token | Hex | Role |
|---|---|---|
| Coral (primary) | `#ff5a3c` | CTAs, appetite, energy — commit to whole coral sections, not just buttons |
| Coral pressed | `#e8482b` | hover/pressed |
| Coral soft | `#ffeae4` | tint backgrounds, chips |
| Red Sea teal | `#0e7c91` | trust, tracking, driver-side accent |
| Teal dark | `#0a5f70` | driver pressed states |
| Ink | `#100e12` | dark surfaces, logo tile |
| Sand neutrals | warm tints | all backgrounds — **never pure white, never pure black** |

**Type:** Sora (display, 500–800) + Plus Jakarta Sans (body). **Arabic: Cairo.**

**Art direction (established, extend it):** "sunlit coastal editorial" — asymmetric image-led layouts, real food photography (koshary, smash burgers, seafood) overlapped by real app screenshots in floating phone frames, soft coral/teal blur "suns" bleeding off corners, generous 2rem-radius cards, pill buttons with coral glow.

**Voice:** honest and specific, anti-hype. Existing copy to match: *"Honest delivery promises"*, *"fifty restaurants we actually trust, not five hundred we never visited"*, *"No spam. One message when we open in your area."*

**"Smart Egyptian" direction:** modern Egyptian confidence — NOT pharaohs, pyramids, or camels. Think Red Sea light, Sinai coastline, resort life, street food culture. Arabic copy in warm **Egyptian dialect (عامية مصرية)** with wit, not stiff فصحى. The brand should feel like it was made by sharp young Egyptians who know Sharm — because it was.

## 4. Languages — non-negotiable

**Five locales with 100% parity: EN, AR (RTL!), RU, IT, DE.** Every landing section and every social template must have at minimum **EN + AR + RU** variants. All layouts must mirror correctly for Arabic RTL. This is a headline feature, not a chore — *"the entire app is translated end-to-end"* is itself a selling point.

## 5. The features to showcase (verified — this is the product)

### Tourist magic (lead with these)
- **Hotel-room delivery, no phone call needed** — pick your verified hotel, add room number, choose handoff: room / lobby / reception / poolside. Works without an Egyptian SIM. *This is the killer feature — give it the hero treatment.*
- **Beach & GPS pin delivery** — no street address? Drop a pin on your sunbed.
- **Prices in your currency** — display in EUR / USD / GBP / RUB while paying in EGP; live conversion at checkout. "No surprises."
- **Five languages** — the whole app, not just a splash screen.
- **Guest checkout** — order two minutes after installing; phone OTP only, no signup wall.
- **WhatsApp built in** — message your driver ("I'm the one by the pool bar") and reach support on WhatsApp.
- **"Tourist-safe" venue badges** and dietary flags (halal, vegan, gluten-free, contains pork/alcohol warnings).
- **Allergy profile → Kitchen Briefing** — set allergies once; every order auto-warns the kitchen and shows you exactly what the kitchen sees. Huge trust point when you don't speak Arabic.
- **In-app rider tips** and **scheduled orders** (lunch to the beach, dinner timed for after the dive trip).

### Trust promises (our differentiators)
- **On-time promise:** automatically credited if 15+ minutes late. *"Real ETAs with credits when we miss them."*
- **Live GPS tracking** — watch the driver approach; see driver name, photo, plate, and rating.
- **Honest ratings** — food and delivery rated separately, so a late driver doesn't tank a great kitchen.
- **Flat, transparent fees** — fixed 20–40 EGP by zone. No per-km surprises, no service fee, no hidden taxes.
- **Free cancellation window** with clear "no money moved" confirmation.
- **Curated, not crowded** — a vetted selection, not an infinite directory.

### Local soul
- Ramadan-aware greetings and iftar timing; Friday-prayer closing windows respected; halal is the default, exceptions are flagged.
- Egyptian & street-food categories alongside Italian, sushi, seafood, healthy.
- **Beyond food:** grocery and pharmacy verticals are already in the platform — position as "more than food" / Sharm super-app roadmap.

### Rewards & growth loops
- **Loyalty:** 1 point per 10 EGP; Bronze / Silver / Gold tiers earn +0% / +25% / +50%; points convert to EGP off.
- **Referral: Give EGP 50, get EGP 50** (friend's first order, min. 150 EGP basket). Design a dedicated shareable card for this.
- Promo code engine for campaigns.

### Coverage
**11 delivery zones across Sharm El Sheikh** — name-drop them: Naama Bay, Soho Square, Nabq, Old Market, Hadaba, and the rest. "From Naama Bay to Nabq" beats "we deliver everywhere."

### For drivers (recruitment creatives)
- Work when you want — true online/offline toggle; location tracked **only** during deliveries (battery-friendly, privacy-honest).
- Offers pushed to the nearest driver, 45-second accept window — jobs come to you.
- Transparent earnings dashboard: delivery-fee share + **100% of tips** + tier bonus (**+5–10 EGP on every delivery** at Silver/Gold).
- **Gold tier gets first look** at new orders.
- Hotel handoff cards mean tourist deliveries without language barriers or international calls.

### For restaurants (partner creatives)
- **Start selling with a browser** — full merchant portal, no hardware to buy, installable as a PWA on any cheap tablet.
- Three-lane kitchen queue (New / In kitchen / Ready), one-tap flow, chime + push double alerts — impossible to miss an order.
- Pause intake with one tap when slammed; resume when ready.
- Volume rewards: **commission discounts (1–2 percentage points)** + featured placement for top partners.
- Keep your own delivery fleet if you have one — self-delivery is fully supported.
- Same-day menu onboarding; price changes go live instantly.

## 6. Payments — word this carefully

- **Live today: Cash on delivery** — "Pay the driver when your order arrives." Always available, works for guests.
- **Card & Apple Pay via Paymob: label as "coming soon."** The flow is built but not switched on. Do **not** show card payment as live. Do not mention Fawry.

## 7. Deliverable 1 — Landing page (sharmeats.online)

The current page is a strong single-page base (hero → 3 value props → coral CTA band → footer, with a localized email+WhatsApp waitlist). **Evolve it, don't discard it.** Target structure:

1. **Hero** — keep "Food delivery built for Sharm." + food photo + floating live-tracking phone. Update eyebrow to "Now live in Sharm El Sheikh" with App Store + Play badges.
2. **How it works** — 3 steps (browse → track live → pay cash at the door).
3. **Tourist section** — hotel-room delivery walkthrough (the room/lobby/poolside picker deserves its own visual), currency display, 5-language chips, WhatsApp driver chat.
4. **Trust band (teal)** — on-time credit promise, live tracking, flat 20–40 EGP fees, free cancellation.
5. **Zones strip** — stylized Sharm map naming the 11 districts.
6. **Rewards band (coral)** — loyalty tiers + EGP 50/50 referral.
7. **Local soul moment** — Ramadan/Friday-prayer awareness, halal default, allergy Kitchen Briefing.
8. **Drivers strip** — "Drive with Sharm Eats" → WhatsApp CTA (there is no web signup form — recruit via WhatsApp).
9. **Restaurants strip** — "Put your kitchen on Sharm Eats" → merchant portal pitch + WhatsApp/email CTA.
10. **App download band** (existing coral band, keep).
11. **Footer** — legal links, hello@sharmeats.online, language switcher.

All 5 locales, RTL-mirrored AR, responsive, static-export friendly (Next.js 15, deployed to Hostinger).

## 8. Deliverable 2 — Social media kit

**Profile identity:** avatar (approved tile only), FB cover, IG highlight icons (coral/teal line style).

**Templates (Figma, editable, AR + EN + RU versions of each):**
1. Launch announcement + countdown teasers ("Sharm, dinner is coming.")
2. **Feature carousel series** — 10 posts, one verified feature each (hotel delivery, beach pin, currency, tracking, late credit, allergy briefing, loyalty, referral, guest checkout, WhatsApp driver chat).
3. Story/Reel templates 1080×1920 with safe zones — order-tracking demo, restaurant spotlight, "order of the day".
4. **Referral share card** — "Give EGP 50, get EGP 50" (designed to be reshared in hotel WhatsApp groups).
5. Driver recruitment set — earnings transparency angle ("100% of your tips. Always.").
6. Restaurant partner set — "no hardware" + commission-discount angle.
7. Restaurant spotlight template (real partner photo + dish + zone tag).
8. Seasonal: Ramadan/iftar, Eid, high season welcome (RU-heavy), New Year.
9. Ad formats: 1080×1080, 1080×1350, 1080×1920, 1200×628 (Meta), 1024×500 Play feature graphic (template exists in repo — match it).

**Photography direction:** real dishes from real partner kitchens in Sharm light — golden hour, sea in the background where honest. No sterile stock food on white.

## 9. Hard rules (violations = revision)

- Only the three approved logo finishes; never distort/recolor the wordmark.
- Sand neutrals — never `#ffffff` or `#000000` surfaces.
- No pyramid/camel/pharaoh clichés. No hype-copy ("best app ever", "#1").
- Never show features that don't exist: no card payment as live (coming soon only), no cash-change feature, no web driver-signup form, no invented UI screens — use real app screenshots (a screenshot-poster generator exists at `landing`'s `/screenshots` route).
- Every claim above is real — don't soften it, and don't exaggerate it.
- AR is Egyptian dialect, warm and witty; RU translations professionally reviewed (biggest tourist segment).

## 10. What you'll receive

- Logo SVG set + app icons (`landing/public/brand/`)
- Palette + typography tokens (`DESIGN.md`, `landing/tailwind.config.ts`)
- All existing 5-locale copy (`landing/src/i18n/dictionaries.ts`)
- App screenshots + poster generator, Play feature graphics (`docs/play-assets/`)
- Store links: App Store id 6776864451 · Play `eg.sharmeats.customer`

**Deliver as:** Figma source with components + text styles per locale, exported PNG/WebP sets, and the landing design as desktop + mobile frames for EN and AR (RTL) minimum.
