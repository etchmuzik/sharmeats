# sharmeats — customer app

Expo SDK 52 · React Native 0.76 · Expo Router 4 · TypeScript · Zustand · AsyncStorage.

Tourist-first food delivery for Sharm El Sheikh. **All data is currently mocked in memory** — the Supabase swap is documented in `src/data/README.md` and is a one-file change.

## Quick start

```bash
cd /Users/etch/Projects/apps/sharmeats/apps/customer
npm install              # or pnpm install / yarn
npx expo start           # press i for iOS sim, a for Android
npx expo start --tunnel  # if you want to test on a physical device behind NAT
```

The app boots on a splash → routes to onboarding (first launch) or home.

## What works today

| Feature | Status |
|---|---|
| Splash + onboarding (3 slides + 5-language picker) | ✓ |
| Phone signin + OTP (mock accept any code) | ✓ |
| 5-tab bottom bar (Home / Browse / Cart / Orders / Profile) | ✓ |
| Cart badge with live count | ✓ |
| Home: address bar, greeting, cuisine pills, featured carousel, restaurant list | ✓ |
| Browse: search + cuisine filter | ✓ |
| Restaurant detail: hero, info bar, sticky menu nav, items with flags | ✓ |
| Item modal: modifiers (single + multi-select), notes, qty, add-to-cart | ✓ |
| Cart tab: line edits, qty steppers, checkout CTA | ✓ |
| Checkout: address, payment, tip, EGP+home-currency totals, place order | ✓ |
| Address picker: hotel / street / beach-pin tabs, add new | ✓ |
| Payment picker: card / Apple Pay / Fawry / cash | ✓ |
| Order tracking: map, timeline auto-advance, rider card, debug "mark delivered" | ✓ |
| Review: two-star + comment + submit | ✓ |
| Orders history: active + past with pull-to-refresh | ✓ |
| Profile: avatar, rows, sign out | ✓ |
| Settings: language + currency + notification toggles | ✓ |
| Help: contact + FAQ | ✓ |
| English + Arabic translations | ✓ |
| Cart + session persisted to AsyncStorage | ✓ |

## What's intentionally NOT here yet

- Real Supabase backend (mock layer is wired with the same interface)
- Real payments (Paymob / Stripe / Apple Pay SDKs)
- Real maps (Mapbox) — order tracking uses a stylized SVG map
- Real GPS (`expo-location`)
- Real push notifications
- RU / IT / DE translations (fallback to EN)
- Background location for beach-pin drop

See `SMOKE.md` for a 70-step manual test plan.

## Architecture

```
app/                    Expo Router file-based routes
├── _layout.tsx         root Stack
├── index.tsx           splash → routes
├── onboarding.tsx
├── signin.tsx
├── otp.tsx
├── (tabs)/             5 tab screens
├── restaurant/[id].tsx
├── item/[id].tsx       (modal)
├── checkout.tsx
├── address/{picker,add}.tsx
├── payment/picker.tsx
├── order/[id].tsx      + /[id]/review.tsx
├── settings.tsx
└── help.tsx

src/
├── theme.ts            colors / spacing / radius / font / shadow tokens
├── haptics.ts          tap / press / success / selection wrappers
├── components/         PrimaryButton, BackButton, TabBar, RestaurantCard, FlagBadge, ...
├── data/               see src/data/README.md — the seam for Supabase
├── store/              cart + session (Zustand + AsyncStorage)
├── i18n/               t() hook + en/ar JSON
├── currency/fx.ts      EGP → EUR/USD/GBP/RUB conversion
└── lib/format.ts       price / time / distance formatters
```

## Swap to Supabase

See `src/data/README.md`. One-file change in `src/data/index.ts`.
