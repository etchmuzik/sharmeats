# Checkout redesign: dropoff preference + visual polish

Date: 2026-07-01
Status: Approved (visual mockup selected via brainstorming companion)

## Problem

The customer checkout screen (`apps/customer/app/checkout.tsx`) has no structured
way to tell the driver how to hand off the order — "don't ring the bell," "leave
at the door," "meet me outside," etc. Today the only outlet is the free-text
`kitchenNotes` field, which is framed as kitchen-facing ("👩‍🍳 Kitchen briefing")
and is not read by the driver app at all (`kitchen_notes` is fetched into
`apps/driver/src/jobs.ts` but never rendered in the driver's job screen).

Additionally, checkout has grown organically (11 stacked cards, no sense of
progress) and the user wants a visual refresh alongside the new feature.

## Scope (from brainstorming)

1. **Dropoff preference** — a first-class, structured field, not a notes hack.
2. **Visual polish** — restyle checkout's existing cards (spacing, hierarchy).
3. **Progress stepper** — slim "Cart → Details → Payment" indicator at top.
4. **Contactless signal** — NOT a separate toggle switch. Selecting a "quiet"
   dropoff chip (Don't ring bell / Meet outside) shows an inline confirmation
   banner. One control, not two — avoids a toggle and chip set disagreeing.
5. Driver app must actually surface this (today it silently drops kitchen_notes).

## Data model

New enum + column on `public.orders`, migration `039` is already taken
(auto-advance-kitchen, uncommitted) — this feature gets `040`.

```sql
-- 040_dropoff_preference.sql
create type public.dropoff_preference as enum (
  'hand_to_me',
  'leave_at_door',
  'meet_outside',
  'no_bell',
  'call_on_arrival'
);

alter table public.orders
  add column dropoff_preference public.dropoff_preference,
  add column dropoff_note text; -- optional free text, kept separate from kitchen_notes

comment on column public.orders.dropoff_preference is
  'Customer-selected handoff instruction, shown to the driver on the job screen.';
comment on column public.orders.dropoff_note is
  'Optional free-text elaboration on dropoff_preference (e.g. "gate code 4821").';
```

Why a separate `dropoff_note` instead of reusing `kitchen_notes`: kitchen_notes
is prep-facing (allergens, "no onions") and is shown to the **restaurant**;
dropoff is driver-facing. Conflating them means the kitchen sees "don't ring
bell," which is noise for them, or the driver has to fish it out of prep notes.

`place_order` RPC (`011_rpcs.sql`) gains two new params:

```sql
create or replace function public.place_order(
  ...,
  p_dropoff_preference public.dropoff_preference default null,
  p_dropoff_note text default null
)
...
insert into public.orders (..., dropoff_preference, dropoff_note)
values (..., p_dropoff_preference, p_dropoff_note);
```

Both nullable — existing orders and any in-flight client during rollout are
unaffected. No backfill needed.

## Chip set (5 options, enum-backed)

| Chip | value | Icon/label | Shown for |
|---|---|---|---|
| Hand to me | `hand_to_me` | 🤝 | all address kinds |
| Leave at door | `leave_at_door` | 🚪🏠 | **street only** — hidden for hotel/beach_pin |
| Meet outside | `meet_outside` | 🚶 | hotel, beach_pin (front desk / beach access doesn't have a "door") |
| Don't ring bell | `no_bell` | 🔕 | all address kinds |
| Call on arrival | `call_on_arrival` | 📞 | all address kinds |

Address-kind filtering happens client-side in checkout.tsx based on the
already-loaded `address.kind` (`hotel | street | beach_pin`) — no schema
change needed for this part, it's just a derived visible-chips array.

Default: none selected (`dropoff_preference: null`). Not selecting anything is
valid — same as today's behavior, driver gets no special instruction.

**Contactless banner trigger:** selecting `leave_at_door` or `no_bell` shows an
inline amber banner directly under the chip row: "🤫 Quiet dropoff — driver
won't ring the bell or knock." (copy varies slightly per chip — see i18n keys
below). Selecting `meet_outside`, `hand_to_me`, or `call_on_arrival` shows no
banner. Only one chip is selectable at a time (single-select, like the existing
tip amount chips) — deselecting clears the banner.

## Checkout layout (locked via visual mockup)

Structure, top to bottom, replacing the current flat card stack:

1. **Progress stepper** (new) — slim horizontal indicator under the header:
   `● Cart — ● Details — ○ Payment`. Purely presentational (checkout IS
   "Details"; Cart and Payment are prior/next screens in the existing flow).
   No new navigation, no new state — a static visual anchor so users know
   where they are in a flow they can't otherwise see end-to-end.
2. Deliver-to card (existing, restyled only)
3. **Dropoff preference card (new)** — chip row + conditional banner,
   positioned directly after "Deliver to" since it's spatially related.
4. Contact number card (existing)
5. Cart preview (existing)
6. Timing (existing)
7. Kitchen briefing (existing, unchanged — allergens + prep notes only)
8. Payment / tip / promo / totals (existing, restyled only)

No card is removed or reordered relative to today except inserting the new
dropoff card and the stepper. This keeps the diff focused — "visual polish"
means restyling `styles.card`/spacing/typography tokens, not restructuring
information architecture beyond the one intentional insertion.

### Visual polish scope (explicit, to prevent scope creep)

- Tighten card padding/spacing rhythm (already fairly good — mostly consistent
  `radius.xl` + `shadow.soft`; polish = consistent vertical rhythm between
  cards, slightly bolder card titles, no structural rewrite).
- Progress stepper is the one new persistent chrome element.
- No new screens, no new navigation, no animation library additions.

## Driver-side surface

`apps/driver/src/jobs.ts` already selects `kitchen_notes` — extend the select
list to include `dropoff_preference, dropoff_note`, and add both to the
mapped job type (mirroring how `kitchen_notes` is mapped today at line ~117).

`apps/driver/app/job/[id].tsx` currently never renders `kitchen_notes` at all
(dead data). Add a visually distinct instruction banner near the top of the
job screen (above item list, near address) — this is the single most
important part of the feature from a business standpoint: a customer
instruction that never reaches the driver is worse than no feature at all.

Rendering rule: show the banner only if `dropoff_preference` is non-null.
Map enum → icon + driver-facing copy (reuse the same icon set as checkout for
consistency, e.g. 🔕 "Don't ring the bell"). If `dropoff_note` is present,
show it as a secondary line under the primary instruction.

## Client plumbing

- `CreateOrderInput` (`apps/customer/src/data/repositories/orders.ts`) gains
  `dropoffPreference?: DropoffPreference` and `dropoffNote?: string`.
- New shared type `DropoffPreference` in `apps/customer/src/data/types.ts`,
  mirroring the SQL enum values exactly (string literal union).
- Mock repo (`orders.ts`) stores both fields on the created `Order` object,
  no special logic needed (mirrors how `kitchenNotes` mock-stores today).
- Supabase repo (`supabase/orders.ts`) passes `p_dropoff_preference` /
  `p_dropoff_note` into the `place_order` RPC call, and `rowToOrder` mapper
  gains the two new fields (read back from the row).
- `Order` type gains `dropoffPreference?: DropoffPreference` and
  `dropoffNote?: string` so the order-tracking screen *could* show it back to
  the customer as confirmation (not required this pass, but the type should
  carry it since it's cheap and the tracking screen already renders
  `kitchenNotes` — natural follow-up, not blocking this scope).

## i18n

All 5 locales (`en`, `ar`, `ru`, `de`, `it`) need new keys under a
`checkout.dropoff*` namespace:

```
checkout.dropoffTitle           "Dropoff preference"
checkout.dropoffHandToMe        "Hand to me"
checkout.dropoffLeaveAtDoor     "Leave at door"
checkout.dropoffMeetOutside     "Meet outside"
checkout.dropoffNoBell          "Don't ring bell"
checkout.dropoffCallOnArrival   "Call on arrival"
checkout.dropoffQuietBanner     "Quiet dropoff — driver won't ring the bell or knock."
checkout.stepperCart            "Cart"
checkout.stepperDetails         "Details"
checkout.stepperPayment         "Payment"
```

Driver app needs matching driver-facing strings if it has its own i18n setup
(check `apps/driver/src/i18n` — if it only supports `en`, only add `en`, don't
force parity the driver app doesn't already have).

## Testing

- Unit: chip visibility filtering logic (address.kind → visible chip set) as
  a pure function, easy to test in isolation.
- Unit: banner-trigger logic (which enum values show the banner).
- Migration: apply locally via the project's existing shimmed-Postgres
  workflow (see memory: sharmeats-local-sql-validation) before touching prod.
- Manual: place a test order end-to-end (mock mode is fine for UI, but the
  RPC param wiring needs a real Supabase local/branch check since place_order
  is server-authoritative).
- Driver app: verify the banner renders for an order with dropoff_preference
  set, and does NOT render (no empty card) when null.

## Out of scope (explicitly, to prevent creep)

- No changes to `kitchen_notes` / `KitchenBriefing` component behavior.
- No admin/merchant-web surfacing of dropoff_preference (driver-only for now).
- No push notification changes.
- No changes to the tracking screen UI beyond the type carrying the field
  (rendering it back to the customer post-order is a natural follow-up, not
  bundled here to keep this diff reviewable).
- No animation/haptic additions beyond reusing the existing `selection()`
  haptic already used by other chip rows in this file.
