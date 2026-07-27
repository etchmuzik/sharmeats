# Physical-device acceptance matrix

Package 01 §6. Three apps × iOS and Android, on **real hardware**.

## Why simulator results do not count

A simulator cannot reproduce the failures this matrix exists to catch: push
delivery through APNs/FCM, background location under a real battery optimiser,
OTA update application, a device actually losing signal in a Sharm hotel
basement, or the OS killing a backgrounded app to reclaim memory. Every one of
those is a production incident that a green simulator run would have missed.

**"Simulator passed" cannot satisfy any row here.** Leave the row empty instead
— an empty row is honest, a simulator row is misleading.

## How to record a row

Every row needs: device, OS version, app build (from **Settings → Build** — long
press to copy it), date, tester, result, and a link to evidence (screenshot,
screen recording, or an order short code).

Result values: **PASS**, **FAIL**, **BLOCKED** (could not test), **N/A**.

A FAIL needs a linked issue. A P0 FAIL blocks the pilot.

## Severity

| | |
|---|---|
| **P0** | money, order completion, or a customer/driver being stranded |
| **P1** | a core flow works but is materially degraded |
| **P2** | cosmetic or edge-case |

Package 01 acceptance: **no P0 failure** on any row.

---

## Customer app

| # | Case | Sev | iOS device/OS/build | iOS result | Android device/OS/build | Android result | Evidence |
|---|---|---|---|---|---|---|---|
| C1 | Fresh install → first launch | P0 | | | | | |
| C2 | Upgrade over a previous build (state preserved) | P0 | | | | | |
| C3 | OTA update applies; Settings → Build shows a new update id | P1 | | | | | |
| C4 | Anonymous browse → phone-linked account; cart and favourites survive | P0 | | | | | |
| C5 | Push permission primer → deny → later enable in OS settings | P1 | | | | | |
| C6 | Notification tap: foreground / background / killed → correct screen | P0 | | | | | |
| C7 | Hotel or address selection, then live order tracking | P0 | | | | | |
| C8 | Place a COD order end to end | P0 | | | | | |
| C9 | Reorder ("Order again") when the menu has changed | P1 | | | | | |
| C10 | EN / AR / RU / IT / DE render; **Arabic RTL** layout correct | P1 | | | | | |
| C11 | Long strings (German) do not clip or overlap | P2 | | | | | |
| C12 | Offline launch → reconnect → missed Realtime events recovered | P0 | | | | | |
| C13 | Low storage / low memory: app resumes without losing the cart | P1 | | | | | |
| C14 | Sign out clears private state; a second account on the same device sees nothing of the first | P0 | | | | | |

## Restaurant app

| # | Case | Sev | iOS device/OS/build | iOS result | Android device/OS/build | Android result | Evidence |
|---|---|---|---|---|---|---|---|
| R1 | Fresh install → staff login | P0 | | | | | |
| R2 | New-order alarm audible with the screen off | P0 | | | | | |
| R3 | Accept / reject inside the response window | P0 | | | | | |
| R4 | Item 86 (mark unavailable) reaches the customer app | P1 | | | | | |
| R5 | Storefront pause honoured at checkout | P1 | | | | | |
| R6 | Staff vs manager role limits (mig 136) enforced in the UI | P0 | | | | | |
| R7 | Tablet left on charge overnight still receives orders next morning | P0 | | | | | |
| R8 | Arabic RTL for merchant staff | P1 | | | | | |

## Driver app

| # | Case | Sev | iOS device/OS/build | iOS result | Android device/OS/build | Android result | Evidence |
|---|---|---|---|---|---|---|---|
| D1 | Fresh install → driver login → go online | P0 | | | | | |
| D2 | Job offer arrives with the app backgrounded | P0 | | | | | |
| D3 | Foreground location tracking during an active delivery | P0 | | | | | |
| D4 | **Background** location survives OS battery restriction | P0 | | | | | |
| D5 | Battery-saver / Doze mode does not suppress offers | P0 | | | | | |
| D6 | Pickup → deliver → COD collected | P0 | | | | | |
| D7 | Cash hand-in, including a partial hand-in | P0 | | | | | |
| D8 | Signal loss mid-delivery, then recovery | P0 | | | | | |
| D9 | Shift handoff: sign out, second driver signs in on the same device | P0 | | | | | |
| D10 | Old push token after reinstall stops receiving another driver's jobs | P0 | | | | | |

---

## Cross-cutting checks

Confirm on at least one device per app:

- **Build identity** — Settings → Build (customer) shows version, build, channel
  and update id, and long-press copies it. This is what turns "it broke on my
  phone" into a specific artifact.
- **Crash reporting** — force a test crash and confirm it reaches Sentry tagged
  with the right release/dist.
- **Analytics** — one device produces the full funnel
  (`app_opened → restaurant_viewed → add_to_cart → checkout_opened →
  order_placed → order_delivered → reorder_tapped`). This is also Package 01 §4's
  acceptance; see `ANALYTICS-DICTIONARY.md`.

## Device coverage minimum

- **iOS**: one current-generation and one older supported device (small screen).
- **Android**: one recent flagship and one budget device with an aggressive
  battery optimiser — the budget device is where background location and push
  actually break, so testing only a flagship proves very little.

---

## Status

**No rows completed.** This matrix is deliberately empty: every row requires
physical hardware, a human tester and, for several rows, a live merchant and
driver. Those results cannot be produced from a development session, and
inventing them would defeat the gate they exist to enforce.

The customer **Settings → Build** block that fills the "build" columns shipped
on 2026-07-27 and is available from the next binary release.
