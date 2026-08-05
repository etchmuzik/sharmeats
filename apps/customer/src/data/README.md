# Customer data layer

Every customer screen reads or writes through the `db` facade exported by
`src/data/index.ts`:

```ts
import { db } from '../data';

const restaurants = await db.restaurants.list();
```

`index.ts` selects the adapter once when the app bundle starts:

| Mode | Selection | Intended use |
| --- | --- | --- |
| Mock | `EXPO_PUBLIC_USE_SUPABASE` is absent or not `true` | Local UI work and deterministic manual smoke tests |
| Supabase | `EXPO_PUBLIC_USE_SUPABASE=true` with both public Supabase values | Staging and production builds |

The rest of the app should not care which mode is active. `isBackendLive` is
available only for behaviour that genuinely differs between local and live
data, such as server reconciliation or push registration.

## Layout

```
src/data/
├── index.ts            Selects and exports the single `db` facade
├── types.ts            Shared domain types
├── mock/               Deterministic seed data
├── repositories/       Mock-mode repository implementations
└── supabase/           Live Supabase implementations and mappers
```

Both implementations cover the same customer-facing slices: authentication,
catalog and menus, hotels, user profile and addresses, cart, orders, rewards,
saved orders, messages, support, FX, and acquisition.

## Supabase configuration

The live client requires these public build-time values:

```sh
EXPO_PUBLIC_USE_SUPABASE=true
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

`getSupabase()` fails clearly if live mode is accessed without the URL or anon
key. Set all three together in the intended EAS environment rather than
changing imports by hand. The Expo public anon key is expected to ship in a
client application and must be protected with Row Level Security; a Supabase
service-role key must never be placed in the app or in any `EXPO_PUBLIC_*`
variable.

The live client persists its Supabase auth session in AsyncStorage and refreshes
it while the app is active. The root layout ensures an anonymous session is
available before live data is requested; phone verification upgrades that
identity through the auth adapter.

## Working safely with the facade

1. Add or change a domain shape in `types.ts` first.
2. Keep the mock repository and the Supabase adapter compatible with the same
   `db.<slice>.<method>` call shape.
3. Preserve the distinction between a missing record (`null` where the method
   contract permits it) and a real failure (a rejected promise).
4. Keep customer-facing error mapping at the UI/service boundary; adapters may
   return typed failures but must not dictate raw backend text to customers.
5. Add focused tests next to the adapter or mapper you change, then run the
   customer test suite and adapter contract check.

```sh
cd /Users/etch/Downloads/sharmeats-new/apps/customer
npm test
npm run test:adapters
```

The mock mode is deliberately useful, but it is not a future migration plan:
the Supabase adapters are already part of the runtime switch. New work must
maintain both paths unless the feature is explicitly live-only.
