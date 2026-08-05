# Mobile smoke tests

These Maestro flows exercise installed customer, driver, and restaurant builds.
They are split by risk:

- `boot` flows only verify that a login screen becomes usable; they do not
  authenticate or mutate backend data.
- `authenticated` flows require dedicated staging accounts. The customer
  cash-on-delivery flow deliberately creates a staging order; it must never run
  against production.

Install the intended development or staging build on a booted iOS simulator or
Android emulator before invoking Maestro. A production build is not an E2E
target.

## Customer cash-on-delivery fixture contract

`customer-order-cod.yaml` needs a dedicated staging fixture, not a real
customer account:

- `CUSTOMER_E2E_PHONE` and `CUSTOMER_E2E_OTP` are a Supabase-configured staging
  test number and OTP.
- `CUSTOMER_E2E_RESTAURANT_NAME` is the exact visible restaurant name for an
  open, deliverable staging restaurant.
- `CUSTOMER_E2E_MENU_ITEM_NAME` is the exact visible name of one available
  item with no required modifiers. Its price must meet the restaurant minimum
  order for the test address.
- `CUSTOMER_E2E_ADDRESS_ID` is the UUID of an eligible **hotel** address
  already saved for that staging account. The flow deliberately clears local
  state, opens the address picker, and selects this row by its stable test ID.
- Cash on delivery must be available for the test account.
- The account must have accepted the current Terms version, so the consent
  checkpoint does not cover the post-login catalog during this smoke journey.
- Start each run with no active order and an empty server cart for this account;
  otherwise cart restoration or active-order limits can obscure the intended
  one-item checkout path.
- The restaurant must serve that address and have a valid delivery quote.

Keep fixture names stable, keep stock/availability enabled, and clean up the
created staging orders under the test account as part of environment hygiene.

## Run checks

Run the no-login checks against any configured development or staging build:

```sh
maestro test .maestro --include-tags boot
```

Run only the customer OTP smoke with a staging test account:

```sh
CUSTOMER_E2E_PHONE='+201000000000' \
CUSTOMER_E2E_OTP='000000' \
maestro test .maestro/customer-auth.yaml
```

Run the customer COD journey with its known catalog fixture:

```sh
CUSTOMER_E2E_PHONE='+201000000000' \
CUSTOMER_E2E_OTP='000000' \
CUSTOMER_E2E_RESTAURANT_NAME='Fixture Restaurant' \
CUSTOMER_E2E_MENU_ITEM_NAME='Fixture Item' \
CUSTOMER_E2E_ADDRESS_ID='00000000-0000-0000-0000-000000000000' \
maestro test .maestro/customer-order-cod.yaml
```

Run the driver and restaurant flows separately with their corresponding
dedicated staging credentials:

```sh
DRIVER_E2E_EMAIL='e2e-driver@example.invalid' \
DRIVER_E2E_PASSWORD='set-in-ci' \
maestro test .maestro/driver-auth.yaml
```

```sh
RESTAURANT_E2E_EMAIL='e2e-restaurant@example.invalid' \
RESTAURANT_E2E_PASSWORD='set-in-ci' \
maestro test .maestro/restaurant-auth.yaml
```

Do not commit credentials or OTPs. Maestro screenshots are written beneath
`.maestro/artifacts/` and are ignored by Git. Run the relevant flow on one
supported iOS simulator and one supported Android emulator before release, and
attach the generated screenshot when reporting a failure.
