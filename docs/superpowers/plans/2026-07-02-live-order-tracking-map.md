# Live Order-Tracking Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fully mocked map on the customer order-tracking screen (`apps/customer/app/order/[id].tsx`) with a real `react-native-maps` `MapView` driven by the driver GPS stream that already works today.

**Architecture:** Pure-function helpers (staleness check, vehicle→icon lookup) get extracted and unit-tested in isolation, following this codebase's existing test pattern (`DropoffPreferenceCard.test.ts` tests exported helpers, not JSX). The screen component then wires those helpers plus two new `Marker`s into a `MapView`, reusing patterns already proven in `apps/customer/src/components/MapPinPicker.tsx` (region math, `fitToCoordinates`-style camera control, no-API-key iOS default).

**Tech Stack:** Expo Router, React Native, `react-native-maps` 1.18.0 (already a dependency), Supabase Realtime (already streaming), Vitest (existing test runner, `.test.ts` files, `vi.mock('react-native', ...)` stub pattern).

## Global Constraints

- No changes to `apps/driver/src/location.ts` or the Realtime broadcast contract — this is read-side only (per spec's Non-goals).
- No routing/Directions API, no restaurant pickup pin — two markers only: driver and destination (per spec).
- Staleness threshold is 45 seconds, computed from the existing 1-second `now` ticker already in the component — no new timers (per spec).
- Every new/changed user-facing string needs a translation key added to all 5 locale files: `en.json`, `ar.json`, `it.json`, `de.json`, `ru.json` (existing i18n convention, flat `"order.xxx"` keys).
- Android requires a Google Maps SDK key in `apps/customer/app.json` (`android.config.googleMaps.apiKey`) before the real map renders on that platform — this is a deployment/config prerequisite tracked as its own task (Task 5), not blocking the code tasks.
- Follow existing code conventions: TypeScript strict types on exported functions, no `any`, immutable updates, no `console.log`.

---

## File Structure

- **Modify:** `apps/customer/src/components/MapPinPicker.tsx` — export `SHARM_CENTER` and `LatLng` (already defined, currently unexported) for reuse as the tracking screen's fallback region.
- **Modify:** `apps/customer/src/components/Icon.tsx` — add 4 new `IconName` vehicle glyphs (`scooter`, `motorbike`, `bicycle`, `car`) mapped to Ionicons.
- **Create:** `apps/customer/src/lib/tracking.ts` — pure helpers: `isDriverLocationStale(lastFixAt, now, thresholdMs?)` and `vehicleIconName(vehicle)`.
- **Create:** `apps/customer/src/lib/tracking.test.ts` — unit tests for both helpers.
- **Modify:** `apps/customer/app/order/[id].tsx` — replace the mock map JSX (lines 133–154 and associated styles) with a real `MapView`, two `Marker`s, and the staleness note.
- **Modify:** `apps/customer/src/i18n/locales/{en,ar,it,de,ru}.json` — add `order.trackingReconnecting` key.

---

### Task 1: Export shared map constants from MapPinPicker

**Files:**
- Modify: `apps/customer/src/components/MapPinPicker.tsx:9-16`

**Interfaces:**
- Produces: `export interface LatLng { lat: number; lng: number }` (was already defined, now exported), `export const SHARM_CENTER: LatLng` (was already defined as a private const, now exported).

This task has no independent test — it's a visibility change to existing, already-correct code. Verified by Task 4's usage compiling.

- [ ] **Step 1: Export `LatLng` and `SHARM_CENTER`**

In `apps/customer/src/components/MapPinPicker.tsx`, change:

```typescript
export interface LatLng {
  lat: number;
  lng: number;
}

/** Naama Bay — the tourist heart of Sharm el-Sheikh. Sensible map center before GPS. */
const SHARM_CENTER: LatLng = { lat: 27.9158, lng: 34.3299 };
```

to:

```typescript
export interface LatLng {
  lat: number;
  lng: number;
}

/** Naama Bay — the tourist heart of Sharm el-Sheikh. Sensible map center before GPS. */
export const SHARM_CENTER: LatLng = { lat: 27.9158, lng: 34.3299 };
```

(`LatLng` was already exported — confirm it still is. Only `SHARM_CENTER` needs the `export` keyword added.)

- [ ] **Step 2: Verify the file still compiles**

Run: `cd apps/customer && npx tsc --noEmit`
Expected: No new errors (this is an additive export; nothing that imported `MapPinPicker` before is broken).

- [ ] **Step 3: Commit**

```bash
git add apps/customer/src/components/MapPinPicker.tsx
git commit -m "refactor(customer): export SHARM_CENTER for reuse in order tracking"
```

---

### Task 2: Add vehicle icon glyphs to the Icon component

**Files:**
- Modify: `apps/customer/src/components/Icon.tsx:14-79`

**Interfaces:**
- Produces: `IconName` union gains `'scooter' | 'motorbike' | 'bicycle' | 'car'`. `Icon` component (existing signature `{ name: IconName, size?, color?, accessibilityLabel? }`) now accepts these 4 new names.

- [ ] **Step 1: Add the 4 new names to the `IconName` union**

In `apps/customer/src/components/Icon.tsx`, change the end of the `IconName` type (currently ending `| 'person';`) to:

```typescript
  | 'person'
  | 'scooter'
  | 'motorbike'
  | 'bicycle'
  | 'car';
```

- [ ] **Step 2: Map the new names to Ionicons glyphs**

In the same file, add to the `MAP` object (after the `person: 'person-outline',` line):

```typescript
  person: 'person-outline',
  scooter: 'bicycle-outline',
  motorbike: 'bicycle-outline',
  bicycle: 'bicycle-outline',
  car: 'car-outline',
```

Ionicons has no dedicated scooter/motorbike glyph; `bicycle-outline` is the closest two-wheeler glyph available and is used for both `scooter` and `motorbike` (moped-style delivery vehicles read fine as a generic two-wheeler icon at map-marker size). `car-outline` covers the `car` vehicle type exactly.

- [ ] **Step 3: Verify it compiles**

Run: `cd apps/customer && npx tsc --noEmit`
Expected: No errors. `Ionicons.glyphMap` includes both `bicycle-outline` and `car-outline` in the installed `@expo/vector-icons` version — if `tsc` reports either glyph name as invalid, open `node_modules/@expo/vector-icons/build/Icons.d.ts` (or the Ionicons glyph map type) and substitute the nearest available two-wheeler/car outline glyph name, keeping the same `IconName` keys.

- [ ] **Step 4: Commit**

```bash
git add apps/customer/src/components/Icon.tsx
git commit -m "feat(customer): add vehicle icon glyphs for driver map marker"
```

---

### Task 3: Write and test the tracking helper functions

**Files:**
- Create: `apps/customer/src/lib/tracking.ts`
- Create: `apps/customer/src/lib/tracking.test.ts`

**Interfaces:**
- Consumes: `IconName` from `../components/Icon` (Task 2). `Rider['vehicle']` type shape (`'scooter' | 'motorbike' | 'bicycle' | 'car'`) from `../data/types`.
- Produces:
  - `export function isDriverLocationStale(lastFixAt: number, now: number, thresholdMs?: number): boolean`
  - `export const STALE_THRESHOLD_MS = 45_000`
  - `export function vehicleIconName(vehicle: 'scooter' | 'motorbike' | 'bicycle' | 'car'): IconName`

These are consumed by Task 4 (the screen component).

- [ ] **Step 1: Write the failing tests**

Create `apps/customer/src/lib/tracking.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isDriverLocationStale, STALE_THRESHOLD_MS, vehicleIconName } from './tracking';

describe('isDriverLocationStale — live-marker freshness check', () => {
  it('returns false when the fix is fresh (0ms old)', () => {
    expect(isDriverLocationStale(1000, 1000)).toBe(false);
  });

  it('returns false just under the threshold', () => {
    expect(isDriverLocationStale(1000, 1000 + STALE_THRESHOLD_MS - 1)).toBe(false);
  });

  it('returns true at exactly the threshold', () => {
    expect(isDriverLocationStale(1000, 1000 + STALE_THRESHOLD_MS)).toBe(true);
  });

  it('returns true well past the threshold', () => {
    expect(isDriverLocationStale(1000, 1000 + STALE_THRESHOLD_MS + 60_000)).toBe(true);
  });

  it('honors a custom threshold override', () => {
    expect(isDriverLocationStale(1000, 11_000, 5_000)).toBe(true);
    expect(isDriverLocationStale(1000, 4_000, 5_000)).toBe(false);
  });
});

describe('vehicleIconName — maps rider vehicle to an IconName', () => {
  it('maps scooter', () => {
    expect(vehicleIconName('scooter')).toBe('scooter');
  });

  it('maps motorbike', () => {
    expect(vehicleIconName('motorbike')).toBe('motorbike');
  });

  it('maps bicycle', () => {
    expect(vehicleIconName('bicycle')).toBe('bicycle');
  });

  it('maps car', () => {
    expect(vehicleIconName('car')).toBe('car');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/customer && npx vitest run src/lib/tracking.test.ts`
Expected: FAIL — `Cannot find module './tracking'` (the module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `apps/customer/src/lib/tracking.ts`:

```typescript
import type { IconName } from '../components/Icon';

/**
 * How long a live driver fix can go without an update before the tracking
 * screen tells the customer we've lost the live feed. The driver's own ping
 * is throttled to ~25s; 45s gives roughly one missed interval of margin
 * before flagging staleness, so a driver briefly stopped (red light, another
 * drop-off) doesn't trigger a false "reconnecting" note.
 */
export const STALE_THRESHOLD_MS = 45_000;

/** Whether a driver location fix (by its `at` timestamp) is too old to trust. */
export function isDriverLocationStale(
  lastFixAt: number,
  now: number,
  thresholdMs: number = STALE_THRESHOLD_MS,
): boolean {
  return now - lastFixAt >= thresholdMs;
}

/** Maps a rider's vehicle type to the map-marker IconName that represents it. */
export function vehicleIconName(vehicle: 'scooter' | 'motorbike' | 'bicycle' | 'car'): IconName {
  return vehicle;
}
```

`vehicleIconName` is an identity mapping today because the `IconName` union added in Task 2 uses the same literal names as `Rider['vehicle']`. It's kept as a real function (not a raw cast at call sites) so the mapping is unit-tested and the two type spaces can diverge later without hunting for casts.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/customer && npx vitest run src/lib/tracking.test.ts`
Expected: PASS — 9 tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/customer/src/lib/tracking.ts apps/customer/src/lib/tracking.test.ts
git commit -m "feat(customer): add live-tracking staleness and vehicle-icon helpers"
```

---

### Task 4: Add the reconnecting-note translation key to all locales

**Files:**
- Modify: `apps/customer/src/i18n/locales/en.json:253` (insert after)
- Modify: `apps/customer/src/i18n/locales/ar.json:253` (insert after)
- Modify: `apps/customer/src/i18n/locales/it.json:253` (insert after)
- Modify: `apps/customer/src/i18n/locales/de.json:253` (insert after)
- Modify: `apps/customer/src/i18n/locales/ru.json:253` (insert after)

**Interfaces:**
- Produces: i18n key `order.trackingReconnecting`, consumed by Task 5 via `t('order.trackingReconnecting')`.

- [ ] **Step 1: Add the key to `en.json`**

In `apps/customer/src/i18n/locales/en.json`, after the line `"order.statusOnTheWay": "{rider} is on the way",` (line 253), add:

```json
  "order.statusOnTheWay": "{rider} is on the way",
  "order.trackingReconnecting": "Reconnecting to your driver's location…",
```

- [ ] **Step 2: Add the key to `ar.json`**

In `apps/customer/src/i18n/locales/ar.json`, after the line `"order.statusOnTheWay": "{rider} في الطريق",` (line 253), add:

```json
  "order.statusOnTheWay": "{rider} في الطريق",
  "order.trackingReconnecting": "جارٍ إعادة الاتصال بموقع السائق…",
```

- [ ] **Step 3: Add the key to `it.json`**

In `apps/customer/src/i18n/locales/it.json`, after the line `"order.statusOnTheWay": "{rider} è in arrivo",` (line 253), add:

```json
  "order.statusOnTheWay": "{rider} è in arrivo",
  "order.trackingReconnecting": "Riconnessione alla posizione del rider…",
```

- [ ] **Step 4: Add the key to `de.json`**

In `apps/customer/src/i18n/locales/de.json`, after the line `"order.statusOnTheWay": "{rider} ist unterwegs",` (line 253), add:

```json
  "order.statusOnTheWay": "{rider} ist unterwegs",
  "order.trackingReconnecting": "Verbindung zum Standort des Fahrers wird wiederhergestellt…",
```

- [ ] **Step 5: Add the key to `ru.json`**

In `apps/customer/src/i18n/locales/ru.json`, after the line `"order.statusOnTheWay": "{rider} уже в пути",` (line 253), add:

```json
  "order.statusOnTheWay": "{rider} уже в пути",
  "order.trackingReconnecting": "Восстановление связи с местоположением водителя…",
```

- [ ] **Step 6: Verify all 5 JSON files are still valid**

Run: `cd apps/customer && node -e "['en','ar','it','de','ru'].forEach(l => JSON.parse(require('fs').readFileSync('src/i18n/locales/'+l+'.json','utf8')))"`
Expected: No output, no error (a JSON parse error would throw and print a stack trace).

- [ ] **Step 7: Commit**

```bash
git add apps/customer/src/i18n/locales/en.json apps/customer/src/i18n/locales/ar.json apps/customer/src/i18n/locales/it.json apps/customer/src/i18n/locales/de.json apps/customer/src/i18n/locales/ru.json
git commit -m "i18n(customer): add order.trackingReconnecting across all 5 locales"
```

---

### Task 5: Replace the mock map with a real MapView

**Files:**
- Modify: `apps/customer/app/order/[id].tsx`

**Interfaces:**
- Consumes:
  - `SHARM_CENTER: LatLng`, `LatLng` from `../../src/components/MapPinPicker` (Task 1)
  - `isDriverLocationStale`, `STALE_THRESHOLD_MS`, `vehicleIconName` from `../../src/lib/tracking` (Task 3)
  - `t('order.trackingReconnecting')` (Task 4)
  - Existing component state: `order: Order | null`, `driverLoc: {lat, lng} | null`, `now: number` (1s ticker), `trackingDriver: boolean` — all already defined in this file, unchanged.
  - Existing `Order.addressSnapshot.lat` / `.lng` (may be `undefined` per the `Address` type — both optional).
  - Existing `Order.rider?.vehicle` (`'scooter' | 'motorbike' | 'bicycle' | 'car'`, optional since `rider` itself is optional).
- Produces: no new exports — this is the leaf screen component.

This task is not unit-testable (it's a screen component rendering native map primitives) — verified by `tsc` type-checking cleanly and a manual run against the existing mock `subscribeDriverLocation` (Step 5).

- [ ] **Step 1: Add imports**

At the top of `apps/customer/app/order/[id].tsx`, add to the existing import block (after the `ScreenErrorBoundary` import on line 16):

```typescript
import MapView, { Marker } from 'react-native-maps';
import { SHARM_CENTER, type LatLng } from '../../src/components/MapPinPicker';
import { isDriverLocationStale, vehicleIconName } from '../../src/lib/tracking';
```

- [ ] **Step 2: Widen `driverLoc` state to carry the fix timestamp**

`driverLoc`'s current state type is `{ lat: number; lng: number } | null` (set in the `subscribeDriverLocation` callback at line 82), which drops the fix's `at` timestamp on the floor. This must change first — the staleness computation in Step 3 needs `at` to exist on `driverLoc`.

Change line 41 from:

```typescript
  const [driverLoc, setDriverLoc] = useState<{ lat: number; lng: number } | null>(null);
```

to:

```typescript
  const [driverLoc, setDriverLoc] = useState<{ lat: number; lng: number; at: number } | null>(null);
```

And change the subscription callback at lines 81-83 from:

```typescript
    const unsub = db.orders.subscribeDriverLocation(id, (loc) =>
      setDriverLoc({ lat: loc.lat, lng: loc.lng }),
    );
```

to:

```typescript
    const unsub = db.orders.subscribeDriverLocation(id, (loc) =>
      setDriverLoc({ lat: loc.lat, lng: loc.lng, at: loc.at }),
    );
```

This matches the callback signature already declared in the repository interface (`{ lat: number; lng: number; heading?: number; at: number }`, see `apps/customer/src/data/repositories/orders.ts:187`) — `at` was already being delivered, just previously dropped on the floor.

- [ ] **Step 3: Compute derived map state**

Inside the `OrderTracking` component function, after the existing `const canCancel = ...` line (around line 103), add:

```typescript
  const destination: LatLng = {
    lat: order.addressSnapshot.lat ?? SHARM_CENTER.lat,
    lng: order.addressSnapshot.lng ?? SHARM_CENTER.lng,
  };
  const driverIsStale = driverLoc ? isDriverLocationStale(driverLoc.at, now) : false;
```

- [ ] **Step 4: Replace the mock map JSX with a real MapView**

Replace the entire `{/* Mock map */}` block (lines 133-154 in the original file — from `<View style={styles.map}>` through its closing `</View>`) with:

```typescript
      <View style={styles.map}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFillObject}
          initialRegion={{
            latitude: destination.lat,
            longitude: destination.lng,
            latitudeDelta: 0.04,
            longitudeDelta: 0.04,
          }}>
          <Marker
            coordinate={{ latitude: destination.lat, longitude: destination.lng }}
            anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.destMarker}>
              <Icon name="location" size={20} color={colors.white} accessibilityLabel="Your delivery location" />
            </View>
          </Marker>
          {driverLoc && order.rider && (
            <Marker
              coordinate={{ latitude: driverLoc.lat, longitude: driverLoc.lng }}
              anchor={{ x: 0.5, y: 0.5 }}>
              <View style={[styles.riderMarker, driverIsStale && styles.riderMarkerStale]}>
                <Icon name={vehicleIconName(order.rider.vehicle)} size={18} color={colors.white} accessibilityLabel="Your driver" />
              </View>
            </Marker>
          )}
        </MapView>
        {driverLoc && (
          <View style={styles.liveBadge}>
            <View style={[styles.liveDot, driverIsStale && { backgroundColor: colors.amber }]} />
            <Text style={styles.liveText}>
              {driverIsStale ? t('order.trackingReconnecting') : 'LIVE'}
            </Text>
          </View>
        )}
        <View style={[styles.mapNav, { top: insets.top + 6 }]}>
          <BackButton tint="light" onPress={() => router.replace('/(tabs)/orders')} />
        </View>
      </View>
```

The `ref={mapRef}` prop on this `<MapView>` is wired up by Step 5 below, which declares `mapRef`.

- [ ] **Step 5: Add camera auto-fit when live tracking starts**

Add a `mapRef` and an effect that fits the camera to both pins whenever `driverLoc` changes while tracking. After the existing `const [driverLoc, setDriverLoc] = useState...` line, add:

```typescript
  const mapRef = useRef<MapView | null>(null);
```

Add `useRef` to the existing `import { useEffect, useState } from 'react';` line at the top of the file, changing it to:

```typescript
import { useEffect, useRef, useState } from 'react';
```

Then add a new effect near the existing driver-location effect (after the `useEffect` block that ends around line 85):

```typescript
  useEffect(() => {
    if (!driverLoc || !mapRef.current) return;
    mapRef.current.fitToCoordinates(
      [
        { latitude: driverLoc.lat, longitude: driverLoc.lng },
        { latitude: destination.lat, longitude: destination.lng },
      ],
      { edgePadding: { top: 60, right: 60, bottom: 60, left: 60 }, animated: true },
    );
  }, [driverLoc, destination.lat, destination.lng]);
```

- [ ] **Step 6: Add the new marker/badge styles**

In the `StyleSheet.create` block at the bottom of the file, replace the now-unused mock-map styles (`road`, `r1`, `r2`, `r3`, `routeLine`, `pinRider`, `riderDot`, `riderDotLive`, `pinDest`) with:

```typescript
  destMarker: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.white,
  },
  riderMarker: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.white,
  },
  riderMarkerStale: {
    backgroundColor: colors.amber,
  },
```

Keep `liveBadge`, `liveDot`, `liveText`, `mapNav`, and the `map` container style as-is — they're reused unchanged (only `liveBadge`'s position may need `position: 'absolute'` confirmed, which it already has per the original file).

- [ ] **Step 7: Type-check the file**

Run: `cd apps/customer && npx tsc --noEmit`
Expected: No errors. Pay particular attention to:
- `order.addressSnapshot.lat`/`.lng` being optional (`number | undefined`) — the `destination` fallback in Step 2/3 handles this.
- `order.rider?.vehicle` being optional through `order.rider` itself being optional — the JSX guard `driverLoc && order.rider &&` in Step 4 handles this.

- [ ] **Step 8: Manual verification against the mock driver stream**

Run the customer app in Expo dev mode (this repo's existing dev workflow — the mock `subscribeDriverLocation` in `apps/customer/src/data/repositories/orders.ts` simulates a random-walk position on a 3-second interval when running against the mock data layer rather than live Supabase).

Navigate to an order in `out_for_delivery` or `picked_up` status and confirm:
- The destination pin renders immediately on screen load, for any order status.
- Once tracking starts, a second marker (driver) appears and visibly moves every ~3s (mock cadence).
- The camera keeps both markers in view as the mock driver walks.
- Temporarily comment out the mock's `setInterval` callback body (or otherwise stop it from firing) to simulate a stalled feed; after 45s, the live badge switches to the "Reconnecting…" text. Restore the mock afterward.

- [ ] **Step 9: Commit**

```bash
git add apps/customer/app/order/[id].tsx
git commit -m "feat(customer): wire live driver GPS into a real order-tracking map"
```

---

### Task 6: Provision the Android Google Maps API key (deployment task, not code)

**Files:**
- Modify: `apps/customer/app.json`

**Interfaces:** None — configuration only, no code interface.

This task has no automated test. It is a deployment prerequisite: without it, Android builds show a blank/broken map even though Task 5's code is correct (iOS needs no key, per the spec, and is fully functional after Task 5 alone).

- [ ] **Step 1: Provision a Google Maps SDK for Android key**

In Google Cloud Console, in the GCP project associated with Sharm Eats (or a new project if none exists yet for this purpose):
1. Enable the "Maps SDK for Android" API.
2. Create an API key restricted to that API and to the app's Android package name + SHA-1 signing certificate fingerprint (both release and debug keystores, so it works in EAS builds and local dev).

This step requires interactive Google Cloud Console access — it cannot be automated from this repo. Record the resulting key value somewhere secure (e.g. the same secrets store used for other Sharm Eats API keys) before the next step.

- [ ] **Step 2: Add the key to app.json**

In `apps/customer/app.json`, inside the existing `"android": { ... }` block (confirmed present, currently without a `config.googleMaps` entry), add:

```json
"config": {
  "googleMaps": {
    "apiKey": "YOUR_ANDROID_MAPS_KEY_HERE"
  }
}
```

Replace `"YOUR_ANDROID_MAPS_KEY_HERE"` with the real key from Step 1. If this repo's convention is to keep keys out of committed `app.json` (check for an existing `app.config.js`/EAS secrets pattern used by other API keys in this app first — e.g. how the Supabase anon key or Paymob key are handled), follow that same pattern instead of hardcoding the literal key in `app.json`.

- [ ] **Step 3: Rebuild and verify on Android**

Run an Android build (EAS build or local) per this project's existing Android build workflow, install on a device/emulator, and confirm the real map renders (not blank) on the order-tracking screen for an active order.

- [ ] **Step 4: Commit**

```bash
git add apps/customer/app.json
git commit -m "chore(customer): add Android Google Maps API key for order tracking"
```

(If the key was routed through an EAS secret/env var instead of a literal in `app.json`, commit whatever config file changed to reference that secret, and note the secret was set via `eas secret:create` or equivalent — do not commit the raw key value to git if this project's convention is to avoid that, matching how other API keys in this repo are handled.)

---

## Self-Review

**Spec coverage:**
- Pre-pickup destination-only map → Task 5, Step 2/3 (`destination` always computed, driver marker gated on `driverLoc && order.rider`).
- Live driver marker + camera auto-fit → Task 5, Steps 4–5.
- Staleness indicator (45s, reusing the 1s ticker) → Task 3 (`isDriverLocationStale`) + Task 5, Steps 2–3, 4.
- Vehicle-specific marker icons → Task 2 (glyphs) + Task 3 (`vehicleIconName`) + Task 5, Step 4.
- Android Maps key → Task 6.
- No routing API, no restaurant pin → confirmed absent from all tasks (two markers only, straight `fitToCoordinates`, no polyline).
- Fallback to `SHARM_CENTER` if destination coords missing → Task 5, Step 2/3.
- `ScreenErrorBoundary` already wraps the screen (spec's Error Handling section) — no new task needed, unchanged.

**Placeholder scan:** No TBD/TODO markers. Task 6 contains a literal placeholder string `"YOUR_ANDROID_MAPS_KEY_HERE"` — this is intentional and flagged as such in the step text (the real value can only come from an interactive Google Cloud Console action a human must perform), not an unfinished-plan placeholder.

**Type consistency:** `driverLoc` state shape changed once (Task 5, Step 3) from `{lat, lng}` to `{lat, lng, at}` — every later reference in the same task uses the widened shape. `vehicleIconName`'s return type (`IconName`, defined in Task 2) matches what `Icon`'s `name` prop expects (Task 5, Step 4). `isDriverLocationStale`'s signature (`lastFixAt, now, thresholdMs?`) is used consistently in both its test (Task 3) and call site (Task 5).
