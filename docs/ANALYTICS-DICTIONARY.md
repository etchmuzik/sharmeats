# Analytics dictionary

Package 01 §4. The canonical definition of every customer-app event. An event
that is not in this table is not part of the funnel and must not be used in a
KPI.

Implementation: `apps/customer/src/lib/analytics.ts`. Provider: PostHog EU
(`eu.i.posthog.com`), key injected at build time via the EAS `production`
profile.

## The canonical funnel

```
app_opened
  → restaurant_viewed
    → add_to_cart
      → checkout_opened
        → order_placed
          → order_delivered
            → reorder_tapped
```

Every step is a distinct event on one device. A drop-off between any two
adjacent steps is a product question with an owner.

## Common properties

Attached to **every** event by `track()`. Call sites do not supply them and
cannot forget them.

| Property | Source | Notes |
|---|---|---|
| `app_version` | `expo-constants` | marketing version, e.g. `1.1.0` |
| `app_build` | `expo-constants` | native build number / versionCode |
| `app_runtime_version` | `expo-updates` | OTA compatibility key |
| `app_update_id` | `expo-updates` | absent when running the embedded bundle |
| `app_channel` | `expo-updates` | e.g. `production` |
| `app_is_embedded` | `expo-updates` | `true` = no OTA update applied |
| `app_commit` | `EXPO_PUBLIC_GIT_SHA` | **not wired yet** — see `RELEASE-PROVENANCE.md` |
| `locale` | session store | `en` / `ar` / `ru` / `it` / `de` |
| `display_currency` | session store | display only; charges are always EGP |
| `auth_state` | session store | `anonymous` \| `signed_in` — never the identity |
| `acquisition_source` | session store | when known |

`app_version` + `app_build` + `app_update_id` together are what make a funnel
comparable across releases. Two devices reporting the same build can be running
different JS; only `app_update_id` distinguishes them.

## Events

| Event | Trigger | Key properties | Owner | Feeds |
|---|---|---|---|---|
| `app_opened` | root layout, once session state is hydrated | — | Growth | funnel head; DAU |
| `restaurant_viewed` | restaurant screen opens | `restaurantId` | Growth | browse → cart |
| `add_to_cart` | item added | `restaurantId`, item id | Growth | cart conversion |
| `checkout_opened` | checkout screen opens | `restaurantId` | Growth | checkout conversion |
| `order_placed` | `place_order` succeeds | `restaurantId`, totals | Ops | orders/day |
| `order_delivered` | order screen observes `delivered`; **idempotent per order per mount** | `order_id`, `restaurantId` | Ops | funnel close; delivery rate |
| `reorder_tapped` | "Order again" / saved preset tapped | `restaurantId` | Growth | repeat intent |
| `reorder_prepared` | after the cart is reconciled against the live menu | `source` (`orders_tab` \| `saved_preset`), `prepared_by` (`server` \| `client`), `outcome` (`exact` \| `changed` \| `all_unavailable`), `change_count`, `line_count` | Growth | reorder quality |
| `notification_opened` | push tapped, **before** routing | `notification_event`, `destination`, `campaign_id` | CRM | push → order attribution |
| `cart_restored` | a server/local cart is restored (two call sites in the cart tab since Package 02 Slice D — this row previously said "no call site yet" long after they existed) | `source` | Growth | cross-device continuity |
| `review_prompt_shown` | store-review prompt **requested** | `trigger`, `available` | Growth | rating funnel |
| `review_prompt_result` | outcome of the request | `result` (`requested` \| `unavailable` \| `error`) | Growth | rating funnel |
| `order_cancelled` | order cancelled | `restaurantId`, reason code | Ops | cancellation rate |
| `promo_applied` / `promo_rejected` | promo code evaluated | code outcome | Growth | promo efficiency |
| `favorite_toggled` | restaurant favourite toggled | `restaurantId` | Growth | saved intent |
| `cross_sell_added` | cross-sell accepted | item id | Growth | AOV |
| `push_permission` | primer shown/declined, or OS prompt resolved | `context` (`first_order` \| `marketing_opt_in` \| `settings`), `result` (`primer_shown` \| `primer_declined` \| `granted` \| `denied` \| `settings_opened`) — **never the token** | CRM | opt-in rate |
| `search_performed` | search executed | `queryLength` (the code never sent a result count — this row was wrong) | Growth | discovery |
| `referral_shared` | referral link shared | channel | Growth | referral loop |
| `saved_order_created` | preset saved | — | Growth | saved intent |
| `service_area_checked` | the backend fee quote resolves for the selected address (Package 05 §E) | `result` (`in_area` \| `failed` — never `out_of_area`: a network error is indistinguishable from a radius rejection client-side) | Growth | funnel: address → checkout |
| `second_order` | fires with `order_placed` when the account already has ≥ 1 **delivered** order (Package 05 §E) | `priorDelivered` | Growth | retention; funnel close |

### Events named for honesty

`review_prompt_shown` means **we asked the OS**, not that a human saw a dialog.
iOS silently rate-limits `requestReview()` and resolves either way, so a
"shown" that claimed display would be the same category of lie as calling an
Expo ticket a delivery. `available` records what we could actually observe.

`notification_opened` likewise records a **tap**, which is the only
user-confirmed step in the whole push chain — Expo acceptance and provider
receipts are not evidence a human saw anything.

`reorder_prepared.prepared_by` distinguishes the authoritative server path
(`prepare_cart`, mig 145) from the offline client fallback. Without it a rise in
fallbacks — customers on poor connections silently getting the weaker
reconciliation — would be invisible and every reorder would look equally clean.
A high `client` share is an availability signal, not a product signal.

## Privacy rules

Enforced in code by a deny-list inside `track()`, not by call-site discipline —
see `isBannedProperty`. A property whose name contains any of `phone`, `email`,
`address`, `room`, `note`, `token`, `password`, `message`, `support_text`,
`lat`, `lng`, `coordinate` (case-insensitive, substring) is **dropped** before
the event is sent; the rest of the event still ships.

One narrow exemption (2026-07-30): `message_id` and `attributed_message_id` —
exact key match AND the value must look like a minted token
(`isExemptAttributionId`). The `message` fragment had silently eaten both ids
in production, destroying the client half of push→funnel attribution while an
inline comment claimed they passed. Message TEXT under any other key still
dies to the fragment scan, and free text under an exempt key is dropped too.

This is structural on purpose. One `track('x', {notes})` written months from now
by someone who never read this file would otherwise ship a customer's hotel room
number or delivery instructions.

Also:

- `auth_state` records `signed_in`/`anonymous`, never the phone or user id;
- `identifyUser()` runs once the session is phone-verified (root layout watches
  `isSignedIn`; wired 2026-07-30 — this document claimed the wiring for months
  while the function had zero call sites), and `resetAnalyticsUser()` on
  sign-out and account deletion. Anonymous Supabase sessions are deliberately
  NOT identified: their uid is replaced when verification lands in an existing
  account, and identifying the throwaway uid would split one person into two
  profiles;
- notification payloads are untrusted network input: `notification_event` is
  length- and character-restricted, and the route is reduced to its first path
  segment (`/order/<id>` → `order`) so no order id is forwarded;
- reorder events carry issue **counts**, never dish names or the customer's own
  notes.

Tested in `apps/customer/src/lib/analytics.test.ts`, including that a payload of
only-banned properties leaks nothing into the serialized event.

## KPI formulas

| KPI | Formula |
|---|---|
| Browse → cart | `add_to_cart` users ÷ `restaurant_viewed` users |
| Cart → order | `order_placed` users ÷ `add_to_cart` users |
| Delivery completion | `order_delivered` ÷ `order_placed` |
| Repeat intent | `reorder_tapped` users ÷ `order_delivered` users |
| Reorder quality | `reorder_prepared{outcome=exact}` ÷ all `reorder_prepared` |
| Reorder fallback rate | `reorder_prepared{prepared_by=client}` ÷ all `reorder_prepared` |
| Push effectiveness | `order_placed` within 24h of `notification_opened` ÷ `notification_opened` |
| Rating funnel | `review_prompt_result{result=requested}` ÷ `review_prompt_shown` |

Attribution window for push → order is **24 hours**, bounded deliberately: a
longer window would credit CRM for organic repeat orders.

## Verification status

Events are defined, enriched and wired. **Production ingestion is not yet
proven** — the PostHog key is build-time, so it needs a fresh customer build,
and §4's acceptance requires one physical device producing the full funnel.
That device run is an owner action; do not mark §4 complete from unit tests.
