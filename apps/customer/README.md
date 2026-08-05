# Sharm Eats customer app

Tourist-first food delivery for Sharm El Sheikh, built with Expo SDK 57,
React Native 0.86, Expo Router, TypeScript, Zustand, and AsyncStorage.

The customer app has two supported data modes behind one `db` interface:

- **Mock mode** is the local-development default. It uses deterministic seed
  data and simulated order progression, so the full UI can be explored without
  backend credentials.
- **Supabase mode** is enabled only when `EXPO_PUBLIC_USE_SUPABASE=true` and
  the public Supabase URL and anon key are provided. The UI then uses the live
  adapters in `src/data/supabase/`.

See [the data-layer guide](src/data/README.md) for the adapter contract and
runtime configuration.

## Start locally

```sh
cd /Users/etch/Downloads/sharmeats-new/apps/customer
npm install
npx expo start
```

Use `i` for an iOS simulator, `a` for Android, or `npx expo start --tunnel`
for a physical device behind NAT. With no backend variables set, this starts
in mock mode.

### Run against Supabase

Set these values in your local environment or the appropriate EAS environment
before starting or building:

```sh
EXPO_PUBLIC_USE_SUPABASE=true
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

The anon key is a client identifier protected by Supabase RLS; never put a
service-role key or another privileged secret in an `EXPO_PUBLIC_*` variable.
Use a dedicated staging project and test accounts for development and mobile
automation.

## Current product surface

- Onboarding, phone/OTP sign-in, address capture, restaurant discovery,
  modifiers, cart, checkout, payment selection, order tracking, review, saved
  orders, rewards, inbox, support, profile, and settings.
- English, Arabic (including RTL), Russian, Italian, and German UI
  dictionaries are shipped. The locale setting persists with the session.
- Cart, selected address, and local session preferences persist in
  AsyncStorage. In live mode, the data adapters also reconcile the supported
  server-backed customer records.
- The local mock adapter accepts any six-digit OTP strictly for mock-mode
  development. Staging and production must use configured Supabase test or
  real OTP credentials.

## Architecture

```
app/                    Expo Router routes and screens
src/
├── components/         Reusable native UI and accessibility primitives
├── currency/           EGP conversion and rate hydration
├── data/               Runtime-selected mock or Supabase adapters
├── i18n/               Translation lookup and five locale dictionaries
├── lib/                Formatting, analytics, push, navigation, and helpers
├── store/              Persisted Zustand cart and session state
└── theme*.ts           Tokens, theme provider, and direction helpers
```

All product code should import data through `src/data/index.ts`:

```ts
import { db } from '../src/data';

const restaurants = await db.restaurants.list();
```

Do not make UI screens depend directly on `mock/`, `repositories/`, or
`supabase/` modules; that would bypass the runtime switch and make the two
modes drift.

## Verification

Run from `apps/customer`:

```sh
npm run typecheck
npm test
npm run export
npm run test:adapters
```

Use [SMOKE.md](SMOKE.md) for the focused manual release pass. The repository's
staging-only mobile automation and its fixture contract live in
[`.maestro/README.md`](../../.maestro/README.md).
