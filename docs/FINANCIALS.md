# Sharm Eats — Financial Model

*Decided 2026-07-03 (owner session). All rates below are the source of truth; code and LOI follow this document. USD figures at ≈ EGP 50/USD.*

---

## 1. Decisions (locked)

| Decision | Value | Where it lives |
|---|---|---|
| Loyalty cashback | **~1%** (Bronze; Silver ~1.25%, Gold ~1.5% via earn multipliers) | migration 061 (`redeem_points`) — applied to prod |
| Customer service fee | **EGP 0** at launch — it is a published brand promise ("no service fee") | `platform_settings.service_fee_pct = 0` (knob dormant, not wired) |
| Delivery fee split | **Driver keeps 100%** of the zone fee + 100% of tips | `mark_cod_collected` (011) — unchanged |
| Commission (standard) | **15%** after founding cohort's 3 months | `docs/restaurant-loi.md` (updated from 18%) |
| Commission (founding) | **12%** — first 20 restaurants, 3 months | `restaurants.commission_pct` default (006) |

## 2. Revenue model

**Primary: restaurant commission on food subtotal.**
- Founding cohort: 12% (−1pp Silver / −2pp Gold loyalty discount possible → floor 10%)
- Standard: 15%

**Secondary (post-founding, per LOI):**
- Setup fee EGP 500 · tablet rental EGP 200/mo · menu photography EGP 1,500 one-time

**Deliberately NOT revenue at launch (differentiators):**
- Service fee = 0 ("no service fee, no hidden taxes" — landing page promise)
- Delivery fee = 100% pass-through to drivers (driver-recruitment moat)
- Prices tax-inclusive, `tax_pct = 0`

**Future levers (in priority order, not yet built/turned on):**
1. Card payments via Paymob (built, flag off) — enables tourist wallets, no extra fee to us but unlocks volume
2. Sponsored placement — `featured` exists as a loyalty perk; sellable slots need admin + ranking work
3. Delivery-fee margin (5 EGP) — revisit at 300+ orders/day when driver supply is healthy
4. Service fee — requires wiring `service_fee_pct` into `place_order` + updating brand copy
5. Grocery/pharmacy verticals (seeded in catalog) — higher-margin baskets
6. Hotel B2B partnerships (concierge/QR placement deals)
7. Subscription free-delivery pass — only meaningful once delivery fees matter to customers

## 3. Cost structure

**Variable, per order (AOV ≈ 300 EGP subtotal):**
| Item | EGP | Note |
|---|---|---|
| Driver tier bonus | ~3 avg | 0/5/10 by tier, platform-funded (042) |
| Loyalty accrual (at 1%) | ~3 | funded when redeemed; provision fully |
| Late-credit provision (15-min promise) | ~1.5 | scales with ops quality |
| SMS OTP + infra amortized | ~1 | guest checkout is anonymous → fewer OTPs |
| **Total variable** | **~8** | |

**Customer acquisition:** referral = EGP 100 per acquired customer (50+50). Payback ≈ 3 orders at founding rates, ≈ 2.2 at standard 15%.

**Fixed, monthly (lean launch):**
| Item | EGP/mo |
|---|---|
| Sharm ops co-founder (cash comp) | 35,000–60,000 |
| Infra (Supabase Pro, EAS, hosting, Apple amortized) | ~5,000 |
| Marketing (working budget) | 20,000–50,000 |
| Misc field ops (transport, photography, SIMs) | ~10,000 |
| **Total** | **~70,000–125,000** |

**One-time founding-cohort investment:** 20 tablets (~EGP 80k), photography, min-order guarantees (worst case 20 × EGP 1,000 = EGP 20k).

## 4. Unit economics (per order, AOV 300 EGP)

| | Founding 12% | Standard 15% |
|---|---|---|
| Commission revenue | 36 | 45 |
| − variable costs | ~8 | ~8 |
| **Contribution** | **~28** | **~37** |

## 5. Break-even & milestones

At ~EGP 100k/mo fixed:
- Break-even: **~120 orders/day** (founding mix) → **~90 orders/day** (standard 15% mix)
- 300 orders/day → GMV ≈ EGP 33M/yr → revenue ≈ EGP 5M/yr (~$100k)
- 1,000 orders/day → revenue ≈ EGP 16.5M/yr (~$330k)
- **$1M/yr revenue ≈ 2,800–3,000 orders/day at 15%** — i.e., Sharm dominance alone is not enough; the $1M path is **win Sharm (300–500/day), then replicate the tourist playbook in Hurghada / El Gouna / Dahab**.

## 6. Known financial risks / follow-ups

- **COD cash custody:** drivers hold the restaurant's money until settlement; weekly Sunday payouts per LOI. End-of-day driver cash-in tooling is a gap (see gap-analysis).
- **VAT/tax:** `tax_pct = 0`, prices tax-inclusive. Egyptian VAT + e-invoicing treatment of commission revenue needs an accountant before meaningful volume.
- **Referral abuse cap:** EGP 100 CAC is fine only while min-basket (150 EGP) and per-user limits hold; monitor for self-referral rings.
- **Loyalty history note:** redemption was 100–150% cashback between migrations 049 and 061; zero LOY- codes were minted in that window (verified in prod 2026-07-03) — no exposure.
