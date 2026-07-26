# PROMPT: Sharm Eats Pre-Seed Deck — Egyptian Investor Edition

*For Claude Design / Gamma / Pitch. Audience: Egyptian angels and MENA pre-seed funds (Flat6Labs, A15, Algebra Ventures, Sawari, Disruptech, Camel Ventures, EFG EV, 500 MENA, Nclude, plus Sharm/Hurghada hospitality family offices).*

*Read the rules at the bottom BEFORE generating. Everything marked ✅ is verified in the live product. Everything in `[BRACKETS]` is a slot **you** must fill — the deck tool must render the bracket visibly, never invent a number.*

---

## BEFORE YOU GENERATE — 4 SLOTS LEFT, 2 ARE P0

The deck cannot be sent without these. Leave brackets visible until filled.

**Resolved — do not re-ask.** Founder **Hesham Saied**, software engineer, 15 years resident in Sharm, built the platform solo. Supply: **25 restaurants + 10 riders, verbally committed, not signed.** Kitchen at Mercato: **lease signed, EGP 40k/month, founder-operated, automation-first on our own stack**, five brands named **First Light · Sukkar · Corallo · Sinai Smash · Shawrimp**. Round: **EGP 8M post-money SAFE, EGP 40M cap, 20% at conversion, 18 months** (Package A: EGP 5M / 25M cap). Status: **pre-revenue, pilot-ready, no orders taken.** Burn: **≈ EGP 52k/month.** Entity registers on close. Market stats sourced (19M tourists / Ministry of Tourism & UN Tourism Jan 2026; 13.15M SSH passengers; 77,000 residents / CAPMAS 2017).

**Arithmetic verified 2026-07-26:** allocation sums to 100% and EGP 8.00M · both SAFE packages give exactly 20% · burn 40+5+5+2 = 52k · GMV and revenue figures correct at 15%. TAM low/high round to 1.2B/6.1B from 1.06B/6.39B — immaterial. **Corrected 2026-07-27:** the old "rent break-even 9.5 orders/day" was rent-coverage against a labour-inclusive contribution — superseded by the honest full-cash break-even **~15/day at EGP 192 contribution before labour** (slide 11 and `docs/CLOUD-KITCHEN-PLAN.md` §2).

| Slot | Why it's blocking |
|---|---|
| **`[KITCHEN AREAS + FIT-OUT WEEKS]`** | **P0 — CONTRADICTION.** Stated two ways during drafting: *69 m² kitchen + 29 m² dine-in = 98 m², 10-week fit-out* versus *159 m² (59 kitchen / 30 dine-in / 70 terrace), 3-week fit-out.* Both cannot be true. Take the areas off the lease, pick the honest fit-out timeline, and make the kitchen slide and the ask slide agree. Easiest fact in the deck for an investor to check. |
| **`[3 REAL APP SCREENSHOTS]`** | **P0.** Slide 4 is the product-proof slide. Three real screens — hotel-room delivery, multi-language storefront, live driver GPS. The repo has a screenshot generator; never illustrate imagined UI. |
| `[FOUNDER BACKGROUND]` | Two lines beyond "software engineer, 15 years in Sharm" — prior roles, why food delivery. Egyptian pre-seed is a founder bet. |
| `[KITCHEN FIT-OUT COST]` | The EGP 2.88M kitchen allocation should be built from a real fit-out quote, not a percentage. |

---

## THE PROMPT

Create a **17-slide pre-seed investor deck** for **Sharm Eats** — a live, three-sided delivery platform built exclusively for Sharm El Sheikh, Egypt, now paired with an owned five-brand cloud kitchen.

**Audience:** Egyptian and MENA early-stage investors. They already know Talabat, elmenus, Breadfast and Rabbit intimately — **do not explain what food delivery is, do not define GMV, do not pitch "the Egyptian market is large."** They know. Skip straight to why *this* town, *this* wedge, *this* founder.

**Currency: EGP is primary and always first.** Show USD only in small grey parentheses at ≈ EGP 50/USD, labeled approximate. Never lead with dollars — this business earns, spends and settles in Egyptian pounds.

**Tone:** confident, specific, unhype, numerate. Short declarative sentences. Numbers over adjectives. Egyptian investors punish inflated claims harder than they punish small numbers — being honest about being pre-revenue is a *credibility asset* here. Say what is built, what is dark, and what the money buys.

### Visual identity (mandatory — do not restyle)
- Coral `#ff5a3c` primary/energy · Red Sea teal `#0e7c91` trust · ink `#100e12` dark surfaces · warm sand neutrals. **Never pure white or pure black backgrounds.**
- Sora (700–800) headlines, Plus Jakarta Sans body, **Cairo** for any Arabic text.
- Wordmark: "SHARM" in tracked cream caps + large lowercase "eats" in coral, on a dark tile.
- Mood: **sunlit coastal editorial** — real food, Red Sea light, floating phone-screenshot frames, generous rounded cards.
- Banned: pyramids, pharaohs, camels, stock handshakes, clip-art rockets, generic "MENA growth" arrows.

---

### SLIDE 1 — Cover
Wordmark. One line: **"Food delivery built for Sharm."**
Subline: `Live in Sharm El Sheikh · 25 restaurants committed · 5-brand kitchen secured at Mercato · hotel-room delivery · cash-first`
Footer: `Pre-seed · [MONTH YEAR] · Hesham Saied · hello@sharmeats.online · sharmeats.online`

---

### SLIDE 2 — Why Sharm, why not Cairo
Open by pre-empting the first objection an Egyptian investor will raise: *"why not just do Cairo?"*

- Cairo delivery is **won and consolidated**. Talabat, elmenus, Breadfast, Rabbit — capital-heavy, commission wars, no entry wedge for a pre-seed team.
- Sharm is a **high-value, high-FX, structurally under-served city** that no national player has built *for*. They ported the Cairo app and stretched it.
- Sharm's customer earns and spends in **euros, pounds sterling, roubles and dollars**, and is not price-anchored to Egyptian street prices. *(Do not claim a specific basket-size multiple versus Cairo until we have live order data to evidence it.)*
- **Why now** — Egypt hit a record **19M tourists in 2025, up 21%**, with Sharm airport handling **13.15M passengers — the second-busiest in Africa**. Cite on-slide: *Ministry of Tourism & Antiquities / UN Tourism, Jan 2026* and *African airport traffic ranking, 2025*. The market is growing fast and nobody has built for it.
- **Fifteen minutes to any address in the city.** One dense corridor, 11 zones, no traffic tax on unit economics. Cairo dispatch economics do not apply.
- Sharm is a **repeatable template**: Hurghada, El Gouna, Dahab, Marsa Alam. Same guest, same problem, same playbook.

Closing line for the slide: **"Cairo is a capital war. Sharm is an unclaimed city — and we've lived in it for fifteen years."**

---

### SLIDE 3 — The problem (one tourist's evening, told concretely)
Sharm handles **~6.6M inbound arrivals a year** (derived from 13.15M SSH passenger movements, 2025) — yet a hungry hotel guest tonight hits five walls:

- **No Egyptian SIM.** The driver calls; nobody answers; the order fails. Every incumbent's flow assumes a local number.
- **No street address.** Resorts, room numbers, poolside and beach clubs don't fit an address form built for Cairo streets.
- **Language wall.** The guest speaks Russian, Italian or German. Apps and kitchens work in Arabic and English.
- **Payment wall.** Incumbents assume Egyptian cards and local wallets. Tourists carry foreign cards and cash.
- **Residents underserved too** — bloated catalogs, hidden fees, ETAs nobody believes. **77,000 residents** live here year-round *(CAPMAS, 2017 — label the year; expect "what is it now?")*.

✅ Verified: Talabat and Bringit ship **zero** tourist-specific features — no hotel directory, no room handoff, no RU/IT/DE, no foreign-currency display.

---

### SLIDE 4 — The solution (live product, not a mockup)
**`[3 REAL APP SCREENSHOTS — P0, blocking]`** in floating phone frames: **hotel-room delivery · multi-language storefront · live driver GPS.** This is the product-proof slide; with placeholders it proves nothing, and it is the one slide where an investor expects to see the thing exist. The repo has a screenshot generator — never illustrate imagined UI.

- **Hotel-room delivery with no phone call** ✅ — pick a verified hotel, enter the room number, choose handoff at room / lobby / reception / poolside. **Works with zero local SIM.** This is the killer feature.
- **Beach & GPS-pin delivery** ✅ — order to a sunbed.
- **5 full languages** ✅ — EN / AR (RTL) / RU / IT / DE at 100% translation parity (417 keys verified).
- **Prices shown in EUR / USD / GBP / RUB, charged in EGP** — ⚠️ **verify before claiming this as live.** `preferred_currency` is stored and read per user, but there is **no exchange-rate table in the schema and no conversion code** — while the shipped onboarding copy (`apps/customer/src/i18n/locales/en.json:57`) promises *"See prices in EUR, USD, GBP, or RUB. Paid in EGP at today's rate."* Either wire the conversion before the deck goes out, or move this to the known-gaps list on the traction slide and drop it from the moat/competition slides. Do not list it with a ✅ — it is shipped copy the backend cannot honour, and it becomes a consumer-protection exposure the moment real money moves.
- **Cash on delivery from day one** ✅. Paymob card + Apple Pay are **built and gated off** pending merchant KYC — not live.
- **Trust engineered in** ✅ — live driver GPS with photo, plate and rating; automatic credit if 15+ minutes late; flat **20–40 EGP** zone fee, no per-km surprises; **zero service fee**; free-cancellation window; allergy profile auto-briefed to the kitchen.
- **Local soul** ✅ — Ramadan-aware hours and iftar timing, Friday-prayer closing windows, halal-default catalog with dietary flags.

---

### SLIDE 5 — The moat
Frame as *"what a national player would have to rebuild, not just switch on."*

**Order matters — lead with what cannot be bought.** Items 1 and 2 are the real moats; a funded team could copy everything below them within two quarters. Design the slide so the first two dominate visually.

1. **Fifteen years of founder residency** — the hardest input to buy. Restaurant relationships, seasonality, which zones die in August, which hotels actually let couriers past the gate. A national player can hire an account manager; it cannot hire fifteen years.
2. **Driver economics no incumbent can match** ✅ — drivers keep **100% of the zone delivery fee and 100% of tips**, plus platform-funded tier bonuses. In a town where riders are the scarce input, this is the recruiting weapon — and matching it would require an incumbent to cut its own take rate nationally.
3. **12–15% commission vs Talabat 22–28% / Bringit 18–22%** ✅ — a permanent structural price, not a promo.
4. **Verified-hotel directory + handoff UX** ✅ — compounding local data asset. Every hotel added deepens it.
5. **Five-language, RTL-complete storefront** ✅ — not a translation layer bolted on; built in from the schema up. *(Add "multi-currency" here only once conversion is actually wired — see the caution on slide 4.)*
6. **Ramadan / prayer / halal awareness** ✅ — local trust incumbents can't retrofit credibly.
7. **Guest checkout** ✅ — first order two minutes after install, no signup wall.

---

### SLIDE 6 — What is actually built (technical credibility)
Egyptian pre-seed investors discount claimed product heavily. Show the receipts.

- **Six live surfaces** ✅ — customer app (iOS + Android), driver app, restaurant kitchen app, merchant web portal, admin ops/dispatch/finance console, marketing site.
- **App Store: LIVE** ✅ — customer app id `6776864451`, driver app live. Google Play on internal track.
- **126 database migrations** ✅, multi-round adversarial security audits, **106/106 tests green**, deny-by-default RLS on a single shared Postgres.
- **Authority lives in the database, not the client** ✅ — every price, status transition and commission figure is recomputed and enforced in SECURITY DEFINER Postgres functions. A client cannot send its own total. This is the part that makes the money layer auditable.
- **Money layer shipped** ✅ — per-order commission snapshotted and frozen at delivery, credit wallet, automatic SLA late-credit engine, refund and goodwill admin tooling, founding-rate expiry tracking with cost reporting.
- **11 delivery zones live** ✅ — Naama Bay, Soho Square, Sharks Bay, Hadaba, Nabq, Old Market, El Salam, Mubarak 7, El Rowaisat, Hay El Nour, El Hadaba Residential.
- **Built solo by the founder** ✅ — product, backend, five clients, full RTL, production-hardened.

One line: **"The platform is not the risk in this round. Distribution is."**

---

### SLIDE 7 — Market, bottoms-up in EGP
Build TAM/SAM/SOM from the ground up. **Cite every external stat on the slide itself.** No top-down "MENA food delivery is $X bn."

- **TAM** — **~7.1M guest-stays** (from 13.15M SSH passenger movements ≈ 6.6M inbound, plus land arrivals) × orders-per-stay × AOV EGP 300. **Resident layer on top:** 77,000 residents × 12 orders/year × EGP 300 ≈ **EGP 277M**.
- **Sensitivity row — required, not optional.** Orders-per-stay is the load-bearing assumption in the whole build, so show it three ways rather than hiding it inside one number: **0.5 / 1.5 / 3 orders per stay → EGP 1.2B / 3.2B / 6.1B TAM.** Label 1.5 as the base case. A visible assumption reads as rigour; a single unexplained TAM reads as a guess.
- **SAM** — the 11 live zones: the hotel and residential corridors our fleet reaches in under 15 minutes.
- **SOM, 18 months** ✅ — 300–500 orders/day ≈ **EGP 33–55M GMV/year run-rate** (derived from our own unit economics, not a market report).
- **Expansion, stated as optionality only** — the same tourist playbook fits Hurghada, El Gouna and Dahab. Keep this to one line: **city #2 is Phase 2, explicitly outside this round.** Do not put passenger-volume comparisons or a transfer-cost claim in the deck — a second city needs a real multi-tenancy migration (Sharm's zones are a hardcoded Postgres enum with no city dimension in the schema), and any "it just transfers" framing is disprovable in five minutes by an investor's CTO.
- **The FX angle** — this platform monetizes inbound tourist spend. Revenue is EGP, but the demand is hard-currency-backed and structurally inflation-resistant in a way domestic-only delivery is not.

---

### SLIDE 8 — Business model ✅
- **12% commission** for the founding cohort (first 20 restaurants, 3 months from go-live) → **15% standard**. Structurally below Talabat (22–28%) and Bringit (18–22%) forever.
- Commission is charged **on the food subtotal only** — not on delivery fees.
- **Deliberate launch trade-offs that buy the moat:** service fee EGP 0 (a published brand promise), drivers keep 100% of delivery fees and tips (the best rider pitch in town).
- **Secondary revenue, post-founding:** EGP 500 setup · EGP 200/month tablet rental · EGP 1,500 one-time menu photography.
- **Held-back levers, in priority order** — Paymob card flip (built, off) → sponsored placement → EGP 5 delivery-fee margin (revisit at 300+ orders/day) → service-fee knob (already in schema, dormant) → **grocery, then pharmacy** (category-agnostic architecture, sequenced *after* food is proven — a real product build, not a switch) → hotel B2B concierge → free-delivery subscription.
- Weekly **Sunday** merchant payout cycle ✅.
- **Second revenue line: own-brand food.** The Mercato kitchen (signed lease ✅) earns the full food margin rather than a 15% commission — five brands on the same fleet, same app, same customer. This is the lever that lifts **blended contribution per order** above what any pure marketplace can reach.

⚠️ **Never call this a "take rate."** Own-brand revenue is the full basket (EGP 300), not a commission on someone else's sale — describing it as a take rate compares a gross revenue line to a percentage and reads as massaged the moment an analyst notices. The correct and still-compelling framing is **blended contribution per order**: ~EGP 37 at pure marketplace, rising toward **~EGP 84 at a 30% own-brand mix** (0.7 × 37 + 0.3 × 192 — corrected 2026-07-27 from a stale figure derived from the superseded EGP 140).

---

### SLIDE 9 — Unit economics ✅ (AOV EGP 300 subtotal)
Header note on the slide: *AOV EGP 300 is a planning assumption until live order data exists.* Say it before an investor asks where the number came from.

| Per order | Founding 12% | Standard 15% | **Own brand** |
|---|---|---|---|
| Revenue to us | EGP 36 | EGP 45 | **EGP 300** (full basket) |
| Cost of goods / variable | ~EGP 8 | ~EGP 8 | food ~90 · packaging ~10 · platform variable ~8 |
| **Contribution (before fixed labour)** | **~EGP 28** | **~EGP 37** | **~EGP 192** |

*(Own-brand kitchen labour ~EGP 32k/month sits in the FIXED base with the rent — never
deduct it per order AND omit it from the burn slide; that inconsistency is the first
thing a financially literate investor will catch. Like-for-like: all three columns above
carry the same ~EGP 8 platform variable.)*

- **CAC: EGP 100** (EGP 50 give / EGP 50 get referral) → **payback in ~3.6 orders at 12%, ~2.7 at 15%.** Compute payback on **contribution** (EGP 28/37), not on commission revenue (36/45) — dividing CAC by revenue ignores the cost of serving the order and understates payback. *(Note: `docs/FINANCIALS.md:51` carries the revenue-based version and should be corrected at source.)* Add one honest line: **retention is unmeasured pre-launch**, so payback-in-N-orders is a model, not an observation.
- **Fixed base:** EGP 70–125k/month lean (ops co-founder cash, infra ~5k, marketing, field ops)
- **Break-even: ~120 orders/day** on founding mix → **~90 orders/day** at standard 15% ✅
- **300 orders/day → EGP 33M GMV/yr → ~EGP 5M revenue/yr.** **1,000 orders/day → ~EGP 16.5M revenue/yr** ✅
- Loyalty engine is built and **priced at ~1% cashback** ✅ — retention without burning contribution margin.

Design note: make the EGP 28 / EGP 37 contribution number the single largest element on the slide.

**Show the own-brand arithmetic on the slide, never just the answer.** The own-brand contribution is ~5× the marketplace number, so it is the first figure an investor attacks. Render the working — with labour classified honestly (corrected 2026-07-27, see `docs/CLOUD-KITCHEN-PLAN.md` §2): **EGP 300 basket − food ~90 (30%) − packaging ~10 − platform variable ~8 = ~EGP 192 contribution before labour.** Kitchen labour (~EGP 32k/month) is a **fixed** cost line next to the rent, NOT a per-order deduction — a cook is paid whether he makes 10 meals or 60. Do NOT present the older "− allocated labour 60 = 140" version: it deducts labour per order while the burn slide carries no labour line at all, and an investor who spots that inconsistency discounts every other number in the deck. Also note the ~EGP 8 platform variable (loyalty accrual, SLA provision, driver tier bonus) applies to own-brand orders exactly as it does to marketplace orders, and delivery fees remain 100% driver pass-through — the entire uplift is food gross margin, which is the cleaner story. Mark it a **target margin pending live menu costing** — these are planning figures until the kitchen trades.

State the strategic consequence plainly: **blended contribution per order rises with every own-brand order, and we control the mix.** Unlike a pure marketplace, we are not capped at 15% of someone else's P&L.

---

### SLIDE 10 — Traction & honest status
**This slide must be scrupulously honest. Egyptian investors do reference calls in Sharm — an inflated merchant count is fatal.**

**Live and verified** ✅
- Backend in production; `sharmeats.online`, `merchant.sharmeats.online`, `admin.sharmeats.online` all live
- Customer and driver apps **live on the App Store**
- COD order pipeline verified end-to-end: place → merchant accept → admin dispatch → driver pickup → deliver → settle
- Money layer, credit wallet, SLA engine, refund tooling, founding-rate expiry reporting all shipped
- Localized waitlist capturing email + WhatsApp in 5 languages

**Demand-side commitments secured — founder-led, on the ground**
- **25 restaurants verbally committed** to the founding cohort at 12%. Secured door-to-door by the founder in Sharm. **Handshake commitments — LOI signing begins on close.** Do not write "signed" anywhere on this slide.
- **10 riders verbally committed**, ready to onboard. Contracting on funding.
- Note the number against the plan: the LOI program targets **20 founding restaurants in 6 weeks**. **We are at 25 before the raise.** State that comparison explicitly — it is the strongest single line on the slide, because it shows supply acquisition works *before* any capital was spent on it.
- Founding-cohort **LOI ready in English + Arabic** ✅ — 12% for 3 months + free tablet + free menu photography + EGP 1,000 first-month volume guarantee. Non-binding intent by design; the binding commercial agreement is signed before a merchant goes live.
- `[ORDERS / GMV TO DATE — if none yet, write "pre-revenue, pilot-ready". Do not leave this blank and do not imply volume.]`

**Put the reference offer on the slide, in bold — do not leave it in the speaker notes:**
> **"We'll give you a reference list of all 25 owners you can call today."**

That single line converts the weakest-sounding number in the deck into the most credible one. Unsigned commitments are what every founder claims; twenty-five owners who will pick up the phone is what almost none can offer. Volunteering it before you are asked is the whole point.

**Read this the right way** — 25 restaurant commitments and 10 riders were secured with **zero paid acquisition, zero ops headcount, and no signed contracts to offer them.** That is fifteen years of local relationships converting. It is also the clearest evidence that the constraint on this business is operational capacity, not demand.

**Known gaps we are not hiding** — restaurant commitments are verbal, not signed; the restaurants currently visible in the production database are seed and demo data, not live merchants; card payments dark pending Paymob KYC; commission settlement is hand-reconcilable at pilot scale but not automated; VAT and ETA e-invoicing modeled in schema at 0% and flip on registration; company entity `[ENTITY STATUS]`.

Framing line: **"Platform built. Supply committed. What's missing is the team to switch it on — and that is exactly what this round buys."**

---

### SLIDE 11 — The kitchen (own supply, own margin, own storefront)
**Position this as strategy, not a side business.** Title it something like *"We don't only take a commission. We own the kitchen."*

**Secured** ✅ — a **signed lease** on a prime unit **directly opposite McDonald's at Mercato**, one of Sharm's highest-footfall commercial locations. **159 m² total — 59 m² kitchen · 30 m² dine-in · 70 m² terrace · rent EGP 40,000/month · 3-week fit-out.**

⚠️ **VERIFY AGAINST THE LEASE BEFORE SENDING.** These figures have been stated two different ways during drafting (once as 69 m² kitchen + 29 m² dine-in = 98 m² with a 10-week fit-out; once as the 159 m² breakdown above). **Both cannot be right.** Open the lease, take the exact areas and the real fit-out timeline, and make slide 11 and the ask slide agree. A founder who misstates the size of a unit they have signed for loses the room on everything else — and this is the single easiest fact in the deck for an investor to check.

**The dine-in room and terrace are a second revenue line, not a detail.** 100 of the 159 m² are customer-facing, directly opposite McDonald's at Mercato, where walk-in footfall arrives for free. Position it as **delivery-first economics with a walk-in counter that costs nothing extra** — same kitchen, same staff, same rent, serving a channel that pays commission to nobody and needs no driver. It also de-risks the launch: the kitchen earns from its first trading day rather than waiting on delivery volume to ramp.

*Sense-check the fit-out claim:* 3 weeks to fit out 159 m² including a terrace will read as optimistic to any investor who has built a food-service unit. If 3 weeks is real, say what makes it achievable (pre-existing kitchen infrastructure, minimal build). If it is aspirational, use the honest number — a missed opening date is the first promise you would break.

*Anchor the fixed base so it reads as cheap, because the arithmetic says it is — but present a BREAK-EVEN, not a rent-coverage number* (corrected 2026-07-27): the kitchen's full cash fixed base is ~**EGP 85k/month** (rent 40k + kitchen staff ~32k + utilities ~8k + cleaning/licences ~5k). At ~EGP 192 contribution before labour that is **~440 orders/month ≈ 15 a day across five brands — 3 per brand — to cover every cash cost including the whole team.** Still a strikingly low bar; put THIS calculation on the slide. Do not use the older "rent ÷ 140 ≈ under 10/day" line: it divides rent alone by a contribution that had already absorbed labour per-order — an investor who works it through will conclude the founder doesn't know a break-even from a rent-coverage figure. (Full sensitivity table: `docs/CLOUD-KITCHEN-PLAN.md` §2.)

**Who runs it** ✅ — **the founder operates the kitchen directly**, automation-first: a deliberately small menu, prep-forward processes and minimal headcount, **running on our own POS and order stack rather than a third-party system.** One platform end to end — the same software that runs the marketplace runs the kitchen, so there are no per-terminal POS fees, no integration layer, and full data on both sides of the transaction.

*Wording caution:* say **"runs on our own platform — no third-party POS fees."* Do not claim a separately built commercial POS or CRM product unless one exists — this is the differentiation an investor will most want to see demonstrated, so keep the claim to exactly what you can open on a laptop.

**Five brands from one kitchen**, launching sequentially:
| Brand | Category | Why it earns a slot |
|---|---|---|
| **First Light** | **Breakfast** | Hotel guests and residents; captures the dead 7–11am delivery window |
| **Sukkar** | **Desserts** | Highest margin, best attach rate as an add-on to any other order |
| **Corallo** | **Italian** | Proven top-selling cuisine with European guests |
| **Sinai Smash** | **American burgers** | The volume anchor, directly opposite McDonald's |
| **Shawrimp** | **Shrimp shawarma** | Red Sea shrimp in a shawarma format. Signature item, Sharm-native, **claimed as a world first** |

**Why this is strategic, not opportunistic — make these four points the spine of the slide:**
1. **It solves cold-start.** A marketplace with thin supply at 8pm loses the customer permanently. Five owned brands mean the catalog is never empty, in five categories we choose, from day one.
2. **It transforms contribution per order.** On a marketplace order we earn **15% commission**. On an own-brand order we earn the **full food margin** — several times that on the same delivery, the same driver, the same app, the same customer. *(Say "contribution," not "take rate" — see the rule on slide 8.)*
3. **It de-risks the third-party cohort — and we compete honestly.** If a founding restaurant churns or underperforms in a category, we fill that shelf ourselves rather than showing an empty one. And we compete on the same shelf: **own brands can never be featured, enforced by a database CHECK constraint** (`126_cloud_kitchen_foundation.sql:170-177`), not by a policy anyone could quietly change. Put this on the slide — pre-empting the channel-conflict question is worth more than the line it costs.
4. **One kitchen, five storefronts.** Shared rent, shared equipment, shared staff, shared prep. The marginal cost of brand five is far below the cost of brand one — the same operating leverage that makes cloud kitchens work globally, applied to a city with no serious competitor doing it.

Closing line: **"The platform earns 15%. The kitchen earns the rest."**

**Honesty guardrails for this slide — enforce strictly:**
- The lease is signed ✅. The kitchen is **not yet operating**. Say "secured, fitting out" — never imply it is trading or generating revenue.
- Brand names, menus and margins are `[BRACKETS]` until real. Do not invent them.
- **"World first" applies only to the shrimp-shawarma format**, and should be phrased as a claim about the dish, not a defensible moat — an investor will correctly point out that a recipe is copyable. Its value is as a signature marketing hook and a PR asset in a tourist town, not as IP. Frame it that way and you keep credibility; overclaim it and you lose the room.

---

### SLIDE 12 — Competition
Table or 2×2. Axes: *tourist-built ↔ Cairo-ported* and *hyper-local ↔ national*.

| | Commission | Tourist features | Sharm focus |
|---|---|---|---|
| **Talabat** | 22–28% | None | National, stretched |
| **Bringit** (local incumbent) | 18–22% | None | Sharm, but Cairo-pattern |
| **elmenus** | Discovery-first | None | Cairo |
| **Sharm Eats** | **12–15%** | Hotel handoff, 5 languages, beach delivery | **Built here, only here** |

Wedge sentence, large: **"They ported Cairo to Sharm. We built for who's actually here."**

Add one honest line: *Bringit is the real incumbent and is owner-confirmed operating — we are not claiming an empty market, we are claiming a mispriced and mis-built one.*

---

### SLIDE 13 — Go-to-market
1. **Supply first — already proven, not theoretical.** The founder walked Naama Bay door-to-door and secured **25 restaurant commitments and 10 rider commitments with no capital and no ops team.** The round funds an ops co-founder to convert those to signed LOIs (12% + free tablet + free photography + EGP 1,000 guarantee) and to keep the same motion running past the founding cohort.
2. **Hotel channel** — concierge partnerships and QR codes at check-in. The zero-CAC tourist funnel, and the reason the hotel directory matters.
3. **Russian-speaking social** — the largest single guest segment. RU-native content and Telegram groups, not Facebook ads.
4. **Referral flywheel** ✅ — EGP 50/50 already built into the product, min basket EGP 150. Hotel WhatsApp groups spread codes organically.
5. **Residents follow tourists** — locals see the brand everywhere tourists eat, at half the incumbent's commission.

**Add a timeline strip along the bottom of this slide — the deck currently has no dates anywhere:**
| 90 days | 4–6 months | 7–12 months | 13–18 months |
|---|---|---|---|
| Ops co-founder hired · 25 commitments converted to signed LOIs · first riders contracted · closed COD pilot | Kitchen fitted out and trading · founding cohort live · card payments switched on | Break-even ~90–120 orders/day | 300–500 orders/day · founding cohort fully live · own-brand mix at target |

---

### SLIDE 14 — Team & the key hire
- **Hesham Saied**, Founder — software engineer. **Fifteen years living in Sharm El Sheikh.** Built the entire six-surface platform solo: product, backend, five clients, 126 migrations, full RTL, production-hardened through multi-round security audits.

  Render this line prominently, as its own callout under his name — it is the strongest claim on the slide:
  > **"Fifteen years in Sharm. Every zone, every season, every hotel — this isn't market research, it's home."**

  Supporting point: the tourist-first insights this product is built on — no local SIM, no street address, five languages, Russian as the largest guest segment, Ramadan and prayer-time trading hours — are not findings from a deck exercise. They are fifteen years of watching the city work. **A Cairo team cannot acquire this by hiring for it.**
- **Hiring with this round: Sharm ops co-founder** ✅ — Egyptian national, Arabic native, Sharm-resident, 3+ years F&B/hospitality, ideally ex-Talabat/Otlob/elmenus/Bringit account manager. **5–15% equity, 4-year vest / 1-year cliff, EGP 35–60k/month** plus onboarding-and-volume bonus. Search document and four-stage interview pipeline — including a one-day in-Sharm field test walking into three Naama Bay restaurants — already written.
- Founder commits **a minimum of 5 weeks per quarter on the ground in Sharm** ✅.
- `[ADVISORS — if none, omit this line entirely rather than padding it.]`

- **Key-person risk, named before they raise it** — one engineer built and runs everything, and that is the sharpest single risk in this round. State the mitigation on the slide: the platform is documented (runbooks, migration house rules, audit reports in-repo), and **engineering continuity is funded in this raise.** Naming your own biggest risk is worth more than the slide it costs.

Honest framing line: **"One builder shipped the platform. This round hires the operator."**

---

### SLIDE 15 — The ask (EGP-first)
Raising **EGP 8M (≈ $160k)** on a **post-money SAFE, EGP 40M cap, 20% at conversion**, for **18 months of runway.** A SAFE rather than a priced round because the Egyptian company registers on close; it converts at the next priced round. Priced equity available on request once the entity is live.

**Allocation — verified to sum to 100% and EGP 8.00M:**
| | | |
|---|---|---|
| **36%** | EGP 2.88M | **Kitchen** — fit-out, equipment, staff, 18 months of rent, food working capital |
| **17%** | EGP 1.36M | **Growth** — 20 tablets ≈ EGP 80k, photography, volume guarantees, referral, hotels, RU social |
| **16%** | EGP 1.28M | **Ops team** — Sharm ops co-founder for 18 months plus the first field hire |
| **15%** | EGP 1.20M | **Founder + engineering continuity** — the funded answer to the bus-factor risk |
| **10%** | EGP 0.80M | **Buffer** |
| **6%** | EGP 0.48M | **Infrastructure & compliance** — SMS at scale, accounting, VAT and e-invoicing, registration |

**Put current burn on the slide, unprompted:** **≈ EGP 52k/month pre-revenue** (rent 40k · infrastructure ~5k · utilities ~5k · stores and SMS ~2k — note this is the PRE-TRADING burn: it carries no kitchen staff because none are hired yet; the trading kitchen's cash base is ~EGP 85k/month, slide 11). Pair it with the ~15-orders-a-day full-cash break-even so a signed-lease obligation reads as leverage rather than a hole.

**Milestones this buys** ✅
1. Convert the 25 committed restaurants and 10 committed riders into signed, live supply — the fastest milestone in the plan, because the relationships already exist
2. Break-even at **~90–120 orders/day**
3. **300–500 orders/day** — EGP 33–55M GMV run-rate
4. A second-city playbook documented — expansion is the *next* round's story, not a milestone this one promises

---

### SLIDE 16 — Two ways in
Give investors a choice of entry rather than a single take-it-or-leave-it number. Two packages, side by side:

- **Package A — platform only. EGP 5M (≈ $100k) · 20% at conversion · EGP 25M cap.** Funds the ops co-founder, converts the 25 commitments to signed supply, growth and runway to break-even. Excludes the kitchen. *Marketplace risk only — and a take rate capped at 15% of someone else's P&L.*
- **Package B — platform + kitchen. EGP 8M (≈ $160k) · 20% at conversion · EGP 40M cap.** Everything in A plus the Mercato fit-out and working capital for the five brands, so the own-brand margin line starts in month 3. *B carries food-service operating risk A does not: fit-out, kitchen staffing and food working capital, on a signed lease.*

**Same 20% either way — the cap scales with what the round buys.** Say this explicitly; it is what makes the two-package structure read as principled rather than as negotiating room.

Why this works on this audience: an investor who believes the marketplace but is wary of food-service operations can still say yes to A, and one who wants the margin story takes B. It converts a single objection ("I don't want to fund a kitchen") from a no into a smaller yes.

Keep the comparison honest — B carries operational risk A does not, and the slide should say so in one line.

---

### SLIDE 17 — Vision
**The Red Sea's everything-delivery app.**

The platform was architected **category-agnostic from the schema up** ✅ — merchants, catalog and orders are polymorphic, so grocery and pharmacy are a **product build on existing foundations, not a re-architecture.** Both are on the roadmap after Sharm food is proven, not before.

Sharm is the proof. Hurghada, El Gouna and Dahab are where the same playbook points next — **Phase 2, after this round.** Every Red Sea resort town is the map. Keep this aspirational and undated; the round is being raised to win one city, and saying so is a strength.

**Wording rule — enforce strictly.** Say "the architecture is category-agnostic" or "built to extend into grocery and pharmacy." **Never** say "config flip," "flip a switch," "already seeded," "zero engineering" or "just activate it." A new vertical is a real 3–5 month product build (catalog, stock, units, prescription handling, substitutions). Overclaiming this is the single easiest thing for a technical due-diligence reviewer to disprove — the schema column exists but no client code reads it yet. Claim the foundation, never the finished feature.

Close on the wordmark on ink, one line: *"Built for how people actually live and vacation here."*

---

## HARD RULES FOR THE DECK TOOL

1. **EGP first, always.** USD only in small grey parentheses at ≈ EGP 50/USD, marked approximate.
2. **Never present card or Apple Pay as live.** The exact phrasing is "built, gated for rollout."
3. **Never invent a market statistic.** If a `[VERIFY]` or `[BRACKET]` slot is unfilled, render the bracket visibly on the slide. Do not fabricate, do not estimate, do not silently drop it.
4. **Never inflate merchant or driver counts.** Only contracted merchants and contracted drivers may be counted. Seed and demo rows are not traction.
5. **Grocery/pharmacy: claim the architecture, never the feature.** Say "the platform is category-agnostic by design" or "built to extend into grocery and pharmacy." **Never** say "config flip," "already seeded," "zero engineering," or "just activate it." There is zero supply in either vertical, no merchant has been approached, and each is a 3–5 month product build sequenced after food is proven. This is the easiest overclaim in the deck for a technical reviewer to disprove — the schema column exists, but no client code reads it yet.
6. **Keep brand promise language verbatim:** "no service fee" · "credited if 15+ minutes late" · "drivers keep 100% of tips."
7. **Screenshots must be real app screens.** No illustrated or imagined UI.
8. **Do not explain food delivery, marketplaces, or GMV.** This audience knows. Every sentence must earn its place.
9. **The cloud kitchen has a signed lease but is not operating.** Say "secured, fitting out." Never imply it is trading, and never put a revenue figure against it.
10. **Supply commitments are verbal, never "signed."** 25 restaurants and 10 riders are handshake commitments. Any slide, caption or chart label that says "signed" is wrong.
11. **17 slides maximum.** Every slide survives the "so what?" test in five seconds.
12. **No expansion slide, and no transfer-cost claim.** City #2 (Hurghada) is **Phase 2, outside this round** — mention it only as one undated line of optionality on the market and vision slides. Never say "zero engineering cost", "the platform transfers", or give a passenger-volume comparison: Sharm's 11 zones are a hardcoded Postgres enum with no city dimension in the schema, and a hardcoded Sharm bounding box in `123_restaurant_self_onboarding.sql` means a Hurghada merchant cannot even self-onboard. This round wins one city. Say that plainly — focus is the strategy.
13. **Honesty over polish.** Where the product is incomplete, say so plainly. In this market, a founder who names their gaps reads as someone who can be trusted with money.

---

## SOURCE DOCUMENTS

| Doc | Contains |
|---|---|
| `docs/FINANCIALS.md` | Locked rates, unit economics, break-even, cost structure |
| `docs/restaurant-loi.md` | Founding-cohort commercial terms, EN + AR |
| `docs/hiring-sharm-ops-cofounder.md` | Ops hire spec, equity, comp, 90-day targets |
| `docs/DESIGNER-BRIEF.md` | Verified feature inventory + full brand system |
| `docs/PLATFORM-GAPS.md` | Technical due-diligence appendix + use-of-funds mapping |
| `docs/GO-LIVE.md` | Live/blocked status per surface |
| `landing/src/app/partner-terms/page.tsx` | Public merchant terms as published |
| Stores | App Store id `6776864451` · Play `eg.sharmeats.customer` |

---

## DUE-DILIGENCE PREP (not slides — for your data room)

Egyptian investors will ask these in the first two calls. Have answers ready:

- **"Are the 25 restaurants signed?"** No — they are verbal commitments secured door-to-door. Say that first, unprompted. Then offer the proof that costs nothing to give: **a reference list of owners they can call.** Twenty-five owners who will pick up the phone and confirm is worth more than twenty-five unsigned PDFs, and volunteering it converts your weakest-sounding number into your most credible one.
- **"Then what are the 47 restaurants in your database?"** Seed and demo data from platform testing. Migration 125 records exactly this and deliberately refused to backfill go-live dates because "any backfilled date would be fiction." If a technical DD reviewer opens the database before you explain this, it looks like inflated traction. **Get ahead of it in the first call.**
- **"What stops them signing with Bringit instead?"** The honest answer is the commission gap (12% vs 18–22%) plus a fifteen-year relationship — not exclusivity. There is no lock-in yet. Expect this question and don't overclaim one.
- **"What entity am I investing into?"** No Egyptian entity is registered yet. Have the registration plan, timeline and cost ready.
- **"VAT and e-invoicing?"** Modeled in schema at 0%, flips on registration. Needs an accountant before meaningful volume — say so.
- **"Who holds the cash in COD?"** Drivers hold restaurant money until the weekly Sunday payout. End-of-day driver cash-in tooling is a known gap.
- **"Backups and DR?"** Daily off-site backup now automated (14-day retention). No DR drill has been run yet — schedule one before the data room opens.
- **"Bus factor?"** One engineer built everything. This is the sharpest risk in the round. Address it directly: documentation state, and whether part of the raise funds engineering continuity.

**On the cloud kitchen specifically — expect all five of these:**
- **"Doesn't owning restaurants put you in competition with the merchants you're recruiting?"** The sharpest question in the deck — Talabat and Deliveroo have both taken real damage on it. **Do not answer "our brands fill gaps."** Italian and American burgers are the two most common cuisines in a resort town; the claim collapses the moment an owner asks, and 25 owners have your number.

  **Answer with the constraint instead — it is the strongest unused asset in the repo.** `supabase/migrations/126_cloud_kitchen_foundation.sql:170-177` adds `restaurants_own_brand_never_featured_chk`, a validated CHECK constraint making it **structurally impossible** for a company-owned brand to be featured. The migration comment documents why it exists: `featured` is the only above-the-fold ranking lever, it is written nightly by `loyalty_tier_sweep()`, and a gold-tier own brand would have been auto-promoted with no human involved — so the fix was applied at the source *and* backstopped so no RPC, cron or manual UPDATE can violate it.

  Say: **"We compete on the same shelf, and we made it structurally impossible to cheat. Own brands can never be featured — enforced by a database constraint, not a policy."** That converts your most dangerous question into a demonstration of how you think about risk.
- **"Can you operate a kitchen?"** Software and food service are different businesses. If you have F&B operating experience, lead with it; if not, say who runs it — this is a second key hire alongside the ops co-founder, and investors will want it named.
- **"What's the monthly burn from the signed lease, starting today?"** Rent is running before revenue.
- **"Five brands at once, or sequenced?"** Launching five simultaneously with no kitchen team is the most common way cloud kitchens fail. A sequenced answer (anchor brand first, then add) reads as far more operationally credible.
- **"Is 'world's first shrimp shawarma' defensible?"** No, and don't claim it is. It is a marketing hook and a PR asset in a tourist town. Say that plainly.

**On grocery and pharmacy — if a technical reviewer opens the repo:**
- **"You say category-agnostic. Does anything read `vertical_id`?"** Not yet, and say so before they find it. The column exists on merchants, the `verticals` table is seeded with grocery and pharmacy rows, and `menu_items` carries `sku`/`barcode`/`unit`/`requires_prescription` — but no client code consumes them, and `quote_delivery_fee` currently hardcodes `'food'`. The honest claim is that the **data model was designed not to need re-architecting**, which is true and verifiable. The dishonest claim is that a vertical is a config change. Never make the second one.
- **"So how long is a new vertical really?"** Grocery ~12–18 weeks, pharmacy ~16–25 weeks — decimal pricing (today `price_egp` is an integer), stock levels, bulk catalog import, substitutions, a picker role for 40-line baskets, and for pharmacy: prescription upload, pharmacist verification, age gates and an audit trail. Give this number rather than being caught short by it; a founder who has costed their own roadmap reads far better than one who hasn't.
- **"Why not launch them now?"** Deliberate sequencing. No grocery or pharmacy merchant has been approached, pharmacy needs the entity and licensing resolved first, and building either pre-launch would strand 25 perishable restaurant commitments. Focus is the strategy, not a limitation.
