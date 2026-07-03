# Landing Page Design Prompt — Sharm Eats (paste into Claude / Claude Design)

*This is the final, self-contained prompt to redesign sharmeats.online. Everything below is verified against the shipped product as of the current build. Paste it whole.*

---

## THE PROMPT

Redesign the marketing landing page for **Sharm Eats** — a live, three-sided food-delivery platform built exclusively for **Sharm El Sheikh, Egypt**. It's on the App Store (id 6776864451) and Google Play (`eg.sharmeats.customer`) and live at **sharmeats.online**. This is a *refresh of an existing site*, not a from-scratch rebrand — keep the established brand and art direction below, and evolve the page to showcase the full, current feature set.

Build it as a single, responsive, mobile-first landing page (desktop + mobile). Every claim below is real — do not invent features or stats, and mark anything not yet live as "coming soon."

### Positioning (keep the hero line)
> **"Food delivery built for Sharm."**

We are not a Cairo delivery app stretched to a resort town. Every decision is designed around how people actually live and vacation in Sharm: tourists in hotels with no Egyptian SIM, residents who pay cash, kitchens that close for Friday prayer. The whole page should radiate **local intelligence** — smart, modern, Egyptian, coastal. NOT pyramids, camels, or pharaohs — think Red Sea light, Sinai coastline, resort life, street-food culture.

### Brand system (established — use exactly, do not reinvent)
- **Colors:** coral `#ff5a3c` (primary — CTAs, energy, appetite; commit to whole coral sections, not just buttons) · Red Sea teal `#0e7c91` (trust, tracking, calm) · ink `#0a0a0c` (dark surfaces) · warm **sand neutrals** for backgrounds — **never pure white, never pure black**.
- **Type:** Sora (display/headlines, 500–800) + Plus Jakarta Sans (body). Arabic: Cairo.
- **Wordmark:** type-only — "SHARM" tracked cream + big lowercase "eats" in coral on a dark tile. No symbol/mascot. Don't restyle it.
- **Art direction:** "sunlit coastal editorial" — asymmetric, image-led layouts; real food photography (koshary, seafood, smash burgers) overlapped by real app screenshots in floating phone frames; soft coral/teal blur "suns" bleeding off corners; 2rem-radius cards; pill buttons with coral glow.
- **Voice:** honest, specific, anti-hype. Match the existing copy: *"fifty restaurants we actually trust, not five hundred we never visited"* · *"No spam. One message when we open in your area."* Arabic copy in warm Egyptian dialect (عامية) with wit, not stiff فصحى.
- **Languages:** the app and site support **5 languages — EN, AR (RTL), RU, IT, DE**. The landing needs at minimum EN + AR (RTL-mirrored) + RU. The language switcher stays.

### The full feature set to showcase (all verified live)

**Tourist magic (lead with these):**
- **Hotel-room delivery, no phone call needed** — pick your verified hotel, add a room number, choose handoff at room / lobby / reception / poolside. Works with zero Egyptian SIM. *This is the killer feature — hero treatment.*
- **Beach & GPS-pin delivery** — no street address? Drop a pin on your sunbed.
- **Prices in your currency** — EUR / USD / GBP / RUB display while charging EGP. "No surprises."
- **Five full languages**, whole app translated (not just a splash).
- **Guest checkout** — order two minutes after installing; phone OTP only, no signup wall.

**Trust, engineered in (our differentiators):**
- **On-time promise, honestly kept** — realistic ETAs that account for prep + travel, and if we're 15+ minutes late we **automatically credit your Sharm Eats wallet** — no support ticket. *(This is now fully real: honest ETA + an automatic credit engine + a wallet.)*
- **Live GPS tracking** — watch your driver approach; see their name, photo, plate, and rating.
- **In-app chat** — message your driver and the restaurant right inside the app (no SIM, no WhatsApp needed).
- **Live support chat** — talk to the Sharm Eats team in-app; we usually reply within minutes.
- **Flat, transparent fees** — fixed 20–40 EGP by zone. No per-km surprises, no service fee, no hidden taxes.
- **Honest ratings** — food and delivery rated separately.
- **Allergy profile → kitchen briefing** — set allergies once; every order auto-warns the kitchen and shows you exactly what they see. Big trust point when you don't speak Arabic.

**Rewards & growth:**
- **Rewards wallet & loyalty** — earn points on every order; Bronze / Silver / Gold tiers; credits and refunds land in one wallet you can spend at checkout.
- **Give EGP 50, get EGP 50** referral — design a dedicated shareable card (built to be reshared in hotel WhatsApp groups).

**Local soul:**
- Ramadan-aware greetings and iftar timing; Friday-prayer closing windows respected; halal is the default, exceptions flagged.
- Egyptian & street-food categories alongside Italian, sushi, seafood, healthy — plus grocery & pharmacy already in the platform ("more than food").

**Coverage:** **11 delivery zones across Sharm** — name them: Naama Bay, Soho Square, Sharks Bay, Hadaba, Nabq, Old Market, and more. "From Naama Bay to Nabq" beats "we deliver everywhere."

**Payments:** **Cash on delivery is live today.** Card & Apple Pay via Paymob are **"coming soon"** — do NOT show card as live.

**For drivers & restaurants (short strips, they recruit):**
- Drivers: work when you want, transparent earnings, keep 100% of tips + tier bonuses, jobs come to you.
- Restaurants: start selling with just a browser (no hardware), same-day menu onboarding, commission that undercuts the incumbents, keep your own delivery fleet if you have one.

### Landing page structure (build these sections)
1. **Hero** — "Food delivery built for Sharm." + food photo + a floating live-tracking phone frame. Eyebrow "Now live in Sharm El Sheikh." App Store + Google Play badges. Language switcher in the header.
2. **How it works** — 3 steps: browse → track live → pay cash at the door.
3. **Tourist section** — the hotel-room delivery walkthrough (the room/lobby/poolside picker deserves its own visual), currency display, 5-language chips, in-app chat with the driver.
4. **Trust band (teal)** — the on-time-credit promise + wallet, live tracking, in-app + live support chat, flat 20–40 EGP fees, allergy kitchen-briefing.
5. **Rewards band (coral)** — loyalty tiers + wallet + the EGP 50/50 referral share card.
6. **Zones strip** — a stylised Sharm map naming the 11 districts.
7. **Local soul moment** — Ramadan/Friday-prayer awareness, halal default, "more than food" (grocery + pharmacy).
8. **Drivers strip** — "Drive with Sharm Eats" → WhatsApp CTA (recruit via WhatsApp; there's no web signup form).
9. **Restaurants strip** — "Put your kitchen on Sharm Eats" → merchant-portal pitch + WhatsApp/email CTA.
10. **Download band (coral)** — App Store + Google Play, home-screen phone mock.
11. **Footer** — legal links (privacy, terms, per-app privacy pages), hello@sharmeats.online, language switcher.

### Hard rules (violations = revision)
- Only sand neutrals for surfaces — never `#ffffff` / `#000000`.
- No pyramid/camel/pharaoh clichés. No hype ("best app ever", "#1").
- Card payments = "coming soon" only. COD is the live method.
- Use **real app screenshots**, not illustrated fake UI (a screenshot generator exists in the repo).
- Every feature above is real — don't soften and don't exaggerate.
- RTL Arabic must mirror correctly; keep the honest, specific brand voice.
- Static-export friendly (the site deploys as a Next.js static export to Hostinger) — no server-only features.

### Deliverable
Desktop + mobile frames for the full page, EN and AR (RTL) at minimum, using the exact brand tokens above. Keep the existing waitlist capture and the App Store / Google Play download band.
