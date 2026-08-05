# Customer manual smoke pass

This is the focused release acceptance pass for the customer app. It covers
the journeys most likely to affect ordering, localization, and recovery; it is
not a substitute for the automated unit suite or the staging Maestro flow.

## Before starting

```sh
cd /Users/etch/Downloads/sharmeats-new/apps/customer
npm run typecheck
npm test
npx expo start --clear
```

- Use a fresh simulator or clear app state when checking first-run and
  persistence behaviour.
- In default mock mode, any six-digit OTP completes sign-in. In Supabase mode,
  use a dedicated staging test account and configured test OTP only.
- Never use a production customer account or place a production test order.

## 1. Boot, locale, and accessibility

1. Open the app from a clean state, complete onboarding, and reach sign-in.
2. Change the language through the picker or Settings. Verify English, Arabic,
   Russian, Italian, and German copy loads rather than falling back to keys.
3. Select Arabic and verify the next screen uses RTL layout, readable Arabic
   labels, localized numeric/date formatting, and no clipped controls.
4. With a larger system text size, check that the primary sign-in, cart, and
   checkout actions remain reachable. Use VoiceOver/TalkBack to confirm action
   labels describe their purpose.

## 2. Address and discovery

1. Open the address picker and add each supported address type: hotel,
   apartment, and beach pin.
2. In the hotel form, search for a hotel, select it, enter a room number, and
   select a handoff option. Check that the search hint and verification badge
   use the active locale while actual hotel names remain recognizable.
3. In the apartment form, confirm street and landmark examples are appropriate
   to the active locale and that required fields gate Save correctly.
4. In beach-pin mode, drag or place a pin, provide a beach club name, save, and
   confirm the new address is selected at checkout.
5. Browse, search, filter, and open a restaurant. Confirm price, ETA, and
   distance formatting follows the selected locale.

## 3. Order journey

1. Open an item with required modifiers and verify it cannot be added until
   those choices are made.
2. Add a configured item, check the brief confirmation feedback, then open the
   cart from the restaurant and review the line, quantity controls, and total.
3. Go to checkout. Confirm a selected address, payment method, contact number,
   delivery availability, and quote are all present before Place order enables.
4. Select cash on delivery for the smoke order. Verify the final total and
   payment copy, place the order, and confirm that order tracking opens.
5. Check the order timeline, rider/contact controls, and return path to Orders.
   In mock mode, allow the simulated status progression to advance; do not rely
   on mock-only debug controls in staging or production.

## 4. Failure and recovery

1. Temporarily take the simulator offline during a safe, read-only refresh.
   The app should show a clear localized recovery message, not a backend error
   or stack detail.
2. Restore connectivity and use the presented retry action. Verify the screen
   recovers without losing the current cart or selected address.
3. Reopen the app and verify the cart, session preferences, locale, and selected
   address persistence appropriate to the active data mode.

Record the build, platform, data mode, locale, and any failed step with a
screenshot. Run the staging-only cash-on-delivery automation described in
[`.maestro/README.md`](../../.maestro/README.md) separately; it intentionally
creates a staging order and must not run against production.
