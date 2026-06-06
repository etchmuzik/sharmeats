# Sharm Eats — Product Context

register: product

## Product Purpose

Sharm Eats is a multi-category delivery super-app for **Sharm el-Sheikh, Egypt** —
food first, with groceries and pharmacy already schema-ready. It serves a dual
market: **international tourists** (hotel-room delivery, home-currency prices, no
Egyptian SIM needed) and **local residents** (apartments, cash on delivery,
Arabic-first). Four surfaces share one Supabase backend: a customer app
(Expo/React Native), a driver app (Expo), and two Next.js dashboards (merchant
order queue, admin dispatch).

This file governs design work across all four surfaces. The customer and driver
apps are the **product** register (UI serves the task). The landing site
(`sharmeats.online`) is the **brand** register (design is the product).

## Users

- **Tourists** — staying in Sharm hotels (Hilton, Marriott, resorts in Naama Bay,
  Sharks Bay, Nabq). Often don't speak Arabic, pay with a foreign card, want to
  order to a hotel room or a beach club without friction. Value: clarity, trust,
  no local-knowledge required, prices they understand (EUR/USD/GBP/RUB shown,
  charged in EGP).
- **Residents** — Egyptians in Sharm's residential zones (El Salam, Hay El Nour,
  Mubarak 7, El Rowaisat). Arabic-first, frequently cash-on-delivery, know the
  area. Value: speed, familiar food, fair delivery fees, RTL that feels native
  (not a bolted-on translation).
- **Drivers** — scooter/motorbike couriers. On the move, one-handed, outdoors in
  bright sun. Value: glanceable jobs, big tap targets, live navigation, clear pay.
- **Merchants / dispatch** — restaurant staff and platform ops on desktop. Value:
  a live order queue and dispatch board that never miss an order.

## Brand & Tone

- **Bilingual, equal-weight EN/AR.** Arabic is a first-class language with full
  RTL, native Eastern-Arabic numerals where appropriate, and Cairo type — not an
  afterthought. Switching language must feel like the app was built for both.
- **Warm, sunlit, coastal.** Sharm is sun, sea, and sand. The palette is warm
  sand neutrals + a coral accent (energy, appetite) + a Red Sea teal (trust,
  water). Not the cold blue/white of generic delivery apps.
- **Trustworthy and honest.** Real ETAs with automatic credit when late.
  Verified hotels. "No phone needed" handoff. The product earns trust by being
  straight with the user.
- **Confident, not cute.** Tight, plain copy. No mascots, no exclamation-mark
  spam, no growth-hack dark patterns.

## Strategic Principles

- **Guest-first.** A tourist can browse and order with zero signup ("Start as
  guest"). Never gate the core flow behind an account.
- **Tourist-legible.** Anything a local takes for granted (zones, currency,
  Friday hours, hotel handoff) must be made obvious for a visitor.
- **Server-authoritative trust.** Prices, totals, order status, and dispatch are
  computed server-side; the UI never invents a number. Design reflects real state.
- **Appetite + trust, balanced.** Coral drives appetite and action (CTAs, food);
  teal signals trust and calm (verification, tracking, info). Don't let one
  drown the other.

## Anti-References (what to avoid)

- **Generic Western delivery clones** (Uber Eats / Deliveroo / Talabat lookalikes):
  cold blue or pure-green palettes, endless identical restaurant cards, a sea of
  the same rounded rectangle. Sharm Eats should feel local and warm, not like a
  reskinned global app.
- **Cold "tech" aesthetics** — pure white + a single blue, flat gray cards,
  Helvetica-neutral everything. Wrong for a sunny coastal food brand.
- **Translation-as-afterthought** — Arabic that's clearly an LTR layout with the
  text swapped. RTL must be real.
- **Hero-metric SaaS dashboards** on the merchant/admin side — big-number-plus-
  gradient template. These are working tools, not pitch decks.
- **Cute over-design** — mascots, bouncy animations, emoji-as-UI, confetti. Warm
  but professional.
