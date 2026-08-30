# Google Play graphic assets

Generated 2026-06-06 for the Play Store listings (see ../PLAY-STORE-LISTINGS.md).

| File | Use | Size |
|------|-----|------|
| `feature-customer.png` | Sharm Eats (customer) — Play **feature graphic** | 1024×500 |
| `feature-driver.png` | Sharm Eats Driver — Play **feature graphic** | 1024×500 |

Customer phone screenshots reuse the iOS set:
`apps/customer/store-screenshots-clean/iphone69/`.

Source HTML for the feature graphics: regenerate with Chrome headless
`--screenshot --window-size=1024,500` from the templates if edits are needed.

## Driver phone screenshots

Six ready-to-review driver captures exist in both App Store sizes:

- `apps/driver/store-screenshots/iphone69/`
- `apps/driver/store-screenshots/iphone65/`

They cover online/home, an active offer, pickup navigation, location permission,
customer navigation, and cash collection. Use 2–8 current captures for a Play
listing, and recapture only if the released UI changes materially.
