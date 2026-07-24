# Mobile smoke tests

These Maestro flows exercise the installed customer, driver, and restaurant
apps without placing orders, charging cards, changing availability, or
uploading documents.

Run the login-screen checks against any configured build:

```sh
maestro test .maestro --include-tags boot
```

Run the authenticated staging checks with dedicated, least-privilege test
accounts:

```sh
CUSTOMER_E2E_PHONE='+201000000000' \
CUSTOMER_E2E_OTP='000000' \
DRIVER_E2E_EMAIL='e2e-driver@example.invalid' \
DRIVER_E2E_PASSWORD='set-in-ci' \
RESTAURANT_E2E_EMAIL='e2e-restaurant@example.invalid' \
RESTAURANT_E2E_PASSWORD='set-in-ci' \
maestro test .maestro --include-tags authenticated
```

Do not commit real credentials. The phone and OTP must be configured as a
Supabase test number in the staging project. The driver and restaurant
accounts must belong to staging test records. Run each flow on both one
supported iOS simulator and one supported Android emulator before promoting a
release. Screenshots are written under `.maestro/artifacts/` and ignored by
Git.
