# Live order-tracking map — design

**Status:** Approved, ready for implementation plan
**Author:** Claude, with Beyond Tech
**Date:** 2026-07-02

## Problem

The order-tracking screen (`apps/customer/app/order/[id].tsx`) renders a fully mocked map: static decorative "roads," a fixed dashed route line, and a colored dot standing in for the driver. None of it moves. Meanwhile the app already has a live GPS pipeline: the driver app (`apps/driver/src/location.ts`) streams real fixes over Supabase Realtime broadcast (`order:{id}:driver_loc`), and the customer repository already subscribes to that channel (`db.orders.subscribeDriverLocation`) and receives real `{lat, lng, heading, at}` data into `driverLoc` state. The infrastructure is done; the screen just never draws it on a real map.

This is the highest-leverage item in the current competitive quick-wins queue (vs. Uber Eats/Talabat/Noon/Careem/Yandex Eda) because it requires no new backend work — only wiring an existing data stream into a real `MapView`, following the exact pattern already proven elsewhere in this app (`apps/customer/src/components/MapPinPicker.tsx`).

## Goals

- Replace the mock map in `order/[id].tsx` with a real `react-native-maps` `MapView`.
- Show the destination pin as soon as the order screen loads (all order states).
- Show a live, moving driver marker once tracking begins (`out_for_delivery` / `picked_up`), auto-fitting the camera to keep both pins visible.
- Surface a subtle signal if the live feed goes stale, instead of silently freezing.
- Ship on both iOS and Android.

## Non-goals

- No turn-by-turn driving route / road-path polyline. That needs a Directions/routing API (new integration, quota, cost) — explicitly deferred.
- No restaurant pickup pin. Two markers only: driver and destination.
- No changes to `location.ts`, the driver app, or the Realtime broadcast contract — this is a read-side, frontend-only change.

## Design

### Map states

The map's content is driven entirely by existing state already in the component (`order.status`, `driverLoc`):

1. **Pre-pickup** (`placed` / `accepted` / `preparing` / `ready`): real `MapView`, centered on the destination only. Coordinates come from `order.addressSnapshot.lat` / `.lng` — confirmed present for every address kind (including hotels; the `Address` type captures a GPS pin for all kinds specifically so there's always a map point). No driver marker.
2. **Live** (`out_for_delivery` / `picked_up`, matching the existing `trackingDriver` boolean): once `driverLoc` populates, add the driver marker and call `fitToCoordinates([driverPin, destinationPin])` so both stay in view as the driver moves. Same camera-fit technique already used in `MapPinPicker.tsx`'s `animateToRegion`.
3. **Cancelled/rejected**: map still shows the destination (order state elsewhere on the screen already handles the cancelled UI; the map itself doesn't need a special case).

### Markers

- **Destination**: existing `location` `IconName` glyph (already in `Icon.tsx`), rendered as a custom `Marker` child view, `colors.accent`.
- **Driver**: new `IconName` entries mapped to existing Ionicons glyphs, one per `order.rider.vehicle` value (`scooter` | `motorbike` | `bicycle` | `car` — this union already exists on the `Order` type). Rendered as a custom `Marker` child (icon inside a colored circle badge), replacing the current `riderDot`/`liveBadge` treatment with a real map marker carrying the same visual language (green when live, per the existing `riderDotLive` style).

### Staleness indicator

`driverLoc` fixes carry an `at` timestamp. The component already runs a 1-second ticker (`now` state, used today for the ETA countdown) — reuse it: compute `now - driverLoc.at` and, past a threshold, show a small inline "reconnecting…" note near the live badge instead of leaving the marker silently frozen with no explanation.

- **Threshold: 45 seconds.** The driver's own ping interval is ~25s (throttled RPC write) with a 25m distance-interval trigger; 45s gives roughly one missed interval of margin before flagging staleness, avoiding false positives on a driver momentarily stopped (red light, drop-off at another order) while still catching real connectivity loss reasonably fast.
- This is a pure frontend computation — no changes to the driver-side reconnect logic, which already handles its own rejoin via `onStreamHealth`/Realtime auto-rejoin. The customer side is only *noticing* staleness, not fixing it.

### Android Maps key

`react-native-maps` requires a Google Maps SDK key on Android (iOS uses Apple Maps, no key needed — already confirmed working key-free via `MapPinPicker.tsx`). `apps/customer/app.json` currently has no `android.config.googleMaps.apiKey` entry. This must be provisioned (Google Cloud Console, Maps SDK for Android enabled) and added to `app.json` before the Android build will show a real map; without it, Android silently falls back to a blank/broken map view. This is a deployment prerequisite, not a code question — flagged here so it isn't discovered late.

## Data flow

```
driver app (location.ts)
  → Realtime broadcast: order:{id}:driver_loc { lat, lng, heading, at }
  → customer repo: db.orders.subscribeDriverLocation(orderId, cb)
  → order/[id].tsx: driverLoc state (ALREADY WIRED, no change)
  → [NEW] MapView renders driverLoc as a Marker, recomputed on every fix
  → [NEW] staleness check: now - driverLoc.at vs 45s threshold
```

No new Supabase tables, RPCs, or migrations. No changes to `apps/driver`. The only new "backend" dependency is the Android Google Maps API key, which is infrastructure/config, not application code.

## Error handling

- If `order.addressSnapshot.lat`/`.lng` is ever missing (shouldn't happen per the `Address` type's guarantee, but defensively): fall back to the current Sharm-centered default region (`SHARM_CENTER` constant already defined in `MapPinPicker.tsx` — reuse rather than redefine) instead of crashing.
- If `driverLoc` is present but stale past the 45s threshold: show the reconnecting note; do not hide or remove the marker (last-known position is still useful context).
- Existing `ScreenErrorBoundary` already wraps this screen — no new error-boundary work needed.

## Testing

- The existing mock repository (`apps/customer/src/data/repositories/orders.ts`, `subscribeDriverLocation`) already simulates a random-walk driver position on a 3s interval — this makes the live-marker and camera-fit logic testable in dev without a real driver device.
- Staleness indicator: verify by temporarily pausing the mock interval (or adding a one-off dev toggle) and confirming the "reconnecting" note appears after 45s and disappears when fixes resume.
- Manual pass on both iOS Simulator (Apple Maps, no key needed) and an Android emulator/device once the Maps key is provisioned.
