# Polish as Trust — Delight Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire nine app-polish principles into the Sharm Eats customer app — press animations, haptics, a Sunny mascot, an order-placed celebration, active-weight icons, and a first-impression onboarding — all as one EAS OTA Update.

**Architecture:** Build small, dumb, reusable primitives first (`PressableScale`, `Mascot`, `Confetti`, `EmptyState`, `OrderCelebration`, extended `Icon`), each with a pure exported helper that carries its unit test. Then compose them into screens with tiny diffs (mostly `Pressable`→`PressableScale` swaps and empty-state replacements). No backend, no new dependencies.

**Tech Stack:** Expo 52, React Native 0.76, expo-router 4, react-native-reanimated 3.16 (modern hooks: `useSharedValue`/`useAnimatedStyle`/`withSpring`), react-native-svg 15.8, @expo/vector-icons (Ionicons), Vitest 2 (pure-logic tests, RN stubbed via `vi.mock`).

## Global Constraints

- **Customer app only** — all paths under `apps/customer/`. Never touch driver/restaurant/admin/merchant.
- **No new dependencies** — everything uses already-installed packages.
- **All haptics** go through `src/haptics.ts` (`tap`/`press`/`selection`/`success`/`warn`) — never call `expo-haptics` directly. That module is the single crash-safe choke point.
- **Reduced-motion:** any component that animates must read `AccessibilityInfo.isReduceMotionEnabled()` and degrade to a static form; haptics still fire.
- **Web / non-native:** haptics already no-op on web via `Platform.OS !== 'web'` inside `haptics.ts`; animations must not crash on web.
- **i18n:** all user-facing copy is a flat string key added to ALL 5 locale files (`src/i18n/locales/{en,ar,ru,it,de}.json`). Access via `useT()(key, vars)`; interpolation is `{var}`.
- **Icons** reference intent, not glyph — extend the existing intent-based `src/components/Icon.tsx` (`name="cart"`), never introduce raw Ionicons names into screens.
- **Vitest tests** are pure-logic only: import from `'vitest'`, stub `react-native` with `vi.mock('react-native', …)` (copy the stub block from `src/components/DropoffPreferenceCard.test.ts`), and test **exported pure helpers**, not rendered components.
- **Commit discipline:** one commit per task; conventional-commit messages; branch is `feat/polish-trust-delight` (already created).
- **Every task ends green:** `npx tsc --noEmit` clean and `npx vitest run` passing (run from `apps/customer/`).

---

## File Structure

**New files:**
- `src/components/PressableScale.tsx` — spring-press + haptic Pressable replacement (+ pure helper `resolvePressHaptic`)
- `src/components/Mascot/Mascot.tsx` — inline-SVG "Sunny", poseable
- `src/components/Mascot/poses.ts` — pure pose params + helper `getPose`
- `src/components/Confetti.tsx` — Reanimated particle burst (+ pure helper `buildParticles`)
- `src/components/EmptyState.tsx` — Sunny + copy + optional CTA
- `src/components/OrderCelebration.tsx` — order-placed hero (+ pure helper `shouldCelebrate`)
- `src/components/PressableScale.test.ts`, `Mascot/poses.test.ts`, `Confetti.test.ts`, `OrderCelebration.test.ts`, `Icon.test.ts`
- `docs/design/DESIGN-TASTE-CHECKLIST.md`

**Modified files:**
- `src/components/Icon.tsx` — add `active` prop + filled-variant map + pure helper `resolveGlyph`
- `src/components/TabBar.tsx` — emoji → `<Icon active>`, `PressableScale`
- `app/checkout.tsx:261` — redirect gains `?celebrate=1`
- `app/order/[id].tsx` — mount `OrderCelebration`
- `app/onboarding.tsx` — Sunny welcome, COD trust slide, animated dots, haptics
- ~10 screens — text empty states → `<EmptyState>` (listed in Task 11)
- `src/i18n/locales/{en,ar,ru,it,de}.json` — new keys

---

### Task 1: `PressableScale` primitive

**Files:**
- Create: `apps/customer/src/components/PressableScale.tsx`
- Test: `apps/customer/src/components/PressableScale.test.ts`

**Interfaces:**
- Consumes: `tap`/`press`/`selection` from `src/haptics.ts`.
- Produces:
  - `resolvePressHaptic(kind: 'tap'|'press'|'selection'|'none'): (() => void) | null` — pure mapping from haptic kind to the haptic fn (or null for `'none'`).
  - `PressableScale(props: PressableScaleProps)` component where `interface PressableScaleProps extends PressableProps { scaleTo?: number; haptic?: 'tap'|'press'|'selection'|'none'; children: React.ReactNode }`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/customer/src/components/PressableScale.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios },
  StyleSheet: { create: (s: unknown) => s },
  Pressable: 'Pressable',
  AccessibilityInfo: { isReduceMotionEnabled: vi.fn(async () => false) },
}));
vi.mock('react-native-reanimated', () => ({
  default: { View: 'AnimatedView' },
  useSharedValue: (v: number) => ({ value: v }),
  useAnimatedStyle: (fn: () => unknown) => fn(),
  withSpring: (v: number) => v,
}));
vi.mock('expo-haptics', () => ({
  selectionAsync: vi.fn(), impactAsync: vi.fn(), notificationAsync: vi.fn(),
}));

import { resolvePressHaptic } from './PressableScale';
import * as haptics from '../haptics';

describe('resolvePressHaptic — maps kind to haptic fn', () => {
  it('returns null for "none"', () => {
    expect(resolvePressHaptic('none')).toBeNull();
  });
  it('returns the tap fn for "tap"', () => {
    expect(resolvePressHaptic('tap')).toBe(haptics.tap);
  });
  it('returns the press fn for "press"', () => {
    expect(resolvePressHaptic('press')).toBe(haptics.press);
  });
  it('returns the selection fn for "selection"', () => {
    expect(resolvePressHaptic('selection')).toBe(haptics.selection);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/customer && npx vitest run src/components/PressableScale.test.ts`
Expected: FAIL — `resolvePressHaptic` is not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// apps/customer/src/components/PressableScale.tsx
import { useEffect, useRef, useState } from 'react';
import { Pressable, PressableProps, AccessibilityInfo } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { tap, press, selection } from '../haptics';

type HapticKind = 'tap' | 'press' | 'selection' | 'none';

export function resolvePressHaptic(kind: HapticKind): (() => void) | null {
  switch (kind) {
    case 'none': return null;
    case 'tap': return tap;
    case 'press': return press;
    case 'selection': return selection;
  }
}

export interface PressableScaleProps extends PressableProps {
  scaleTo?: number;
  haptic?: HapticKind;
  children: React.ReactNode;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function PressableScale({
  scaleTo = 0.96, haptic = 'tap', children, onPressIn, onPressOut, style, ...rest
}: PressableScaleProps) {
  const scale = useSharedValue(1);
  const reduceMotion = useRef(false);
  const [, force] = useState(0);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (active) { reduceMotion.current = v; force((n) => n + 1); }
    });
    return () => { active = false; };
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => {
        const h = resolvePressHaptic(haptic);
        if (h) h();
        if (!reduceMotion.current) scale.value = withSpring(scaleTo, { damping: 15, stiffness: 400 });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (!reduceMotion.current) scale.value = withSpring(1, { damping: 15, stiffness: 400 });
        onPressOut?.(e);
      }}
      style={[animatedStyle, style as object]}>
      {children}
    </AnimatedPressable>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/customer && npx vitest run src/components/PressableScale.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
cd apps/customer && npx tsc --noEmit
cd ../.. && git add apps/customer/src/components/PressableScale.tsx apps/customer/src/components/PressableScale.test.ts
git commit -m "feat(customer): PressableScale primitive (spring press + haptic)"
```

---

### Task 2: Extend `Icon` with active weight

**Files:**
- Modify: `apps/customer/src/components/Icon.tsx`
- Test: `apps/customer/src/components/Icon.test.ts`

**Interfaces:**
- Consumes: existing `IconName` union + `MAP` in `Icon.tsx`.
- Produces:
  - `resolveGlyph(name: IconName, active: boolean): keyof typeof Ionicons.glyphMap` — pure. When `active` and a filled variant exists in `FILLED_MAP`, returns it; else returns the default `MAP[name]`.
  - `Icon` component gains an optional `active?: boolean` prop (default `false`).

- [ ] **Step 1: Write the failing test**

```ts
// apps/customer/src/components/Icon.test.ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('@expo/vector-icons', () => ({ Ionicons: { glyphMap: {} } }));
vi.mock('../theme', () => ({ colors: { ink: '#000' } }));

import { resolveGlyph } from './Icon';

describe('resolveGlyph — active weight swap', () => {
  it('returns outline variant when inactive', () => {
    expect(resolveGlyph('cart', false)).toBe('bag-handle-outline');
  });
  it('returns filled variant when active for a tab icon', () => {
    expect(resolveGlyph('cart', true)).toBe('bag-handle');
  });
  it('falls back to default glyph when no filled variant exists', () => {
    expect(resolveGlyph('close', true)).toBe('close');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/customer && npx vitest run src/components/Icon.test.ts`
Expected: FAIL — `resolveGlyph` not exported.

- [ ] **Step 3: Write minimal implementation**

Add above the `Props` type in `Icon.tsx` (after the existing `MAP` object):

```tsx
// Filled variants for icons that have an active state (nav tabs mostly).
// Only intents with a meaningful "on" state need an entry; others fall back.
const FILLED_MAP: Partial<Record<IconName, keyof typeof Ionicons.glyphMap>> = {
  cart: 'bag-handle',
  search: 'search',
  receipt: 'receipt',
  gift: 'gift',
  person: 'person',
  location: 'location',
  star: 'star',
  chat: 'chatbubble-ellipses',
  bell: 'notifications',
};

export function resolveGlyph(name: IconName, active: boolean): keyof typeof Ionicons.glyphMap {
  if (active && FILLED_MAP[name]) return FILLED_MAP[name] as keyof typeof Ionicons.glyphMap;
  return MAP[name];
}
```

Then change the `Props` type and component signature:

```tsx
type Props = {
  name: IconName;
  size?: number;
  color?: string;
  active?: boolean;
  accessibilityLabel?: string;
};

export function Icon({ name, size = 18, color = colors.ink, active = false, accessibilityLabel }: Props) {
  return (
    <Ionicons
      name={resolveGlyph(name, active)}
      size={size}
      color={color}
      accessibilityElementsHidden={!accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityLabel ? 'image' : undefined}
    />
  );
}
```

Also add a `home` intent (tabs need it): add `| 'home'` to the `IconName` union, `home: 'home-outline'` to `MAP`, and `home: 'home'` to `FILLED_MAP`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/customer && npx vitest run src/components/Icon.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
cd apps/customer && npx tsc --noEmit
cd ../.. && git add apps/customer/src/components/Icon.tsx apps/customer/src/components/Icon.test.ts
git commit -m "feat(customer): Icon active-weight (outline↔filled) support"
```

---

### Task 3: Mascot poses (pure) + Sunny SVG

**Files:**
- Create: `apps/customer/src/components/Mascot/poses.ts`
- Create: `apps/customer/src/components/Mascot/Mascot.tsx`
- Test: `apps/customer/src/components/Mascot/poses.test.ts`

**Interfaces:**
- Produces:
  - `type MascotPose = 'cheer' | 'shrug' | 'wave' | 'snooze' | 'idle'`
  - `interface PoseParams { mouthPath: string; eyeRy: number; rayScale: number; rayRotate: number }`
  - `getPose(pose: MascotPose): PoseParams` — pure; returns per-pose SVG params.
  - `Mascot(props: { pose?: MascotPose; size?: number; animate?: boolean })` component.

- [ ] **Step 1: Write the failing test**

```ts
// apps/customer/src/components/Mascot/poses.test.ts
import { describe, it, expect } from 'vitest';
import { getPose } from './poses';

describe('getPose — per-pose SVG params', () => {
  it('cheer has a big open smile and bigger rays', () => {
    const p = getPose('cheer');
    expect(p.rayScale).toBeGreaterThan(getPose('idle').rayScale);
    expect(p.mouthPath.length).toBeGreaterThan(0);
  });
  it('snooze narrows the eyes (small eyeRy)', () => {
    expect(getPose('snooze').eyeRy).toBeLessThan(getPose('idle').eyeRy);
  });
  it('shrug droops the rays (rotate negative or scale < idle)', () => {
    expect(getPose('shrug').rayScale).toBeLessThanOrEqual(getPose('idle').rayScale);
  });
  it('returns idle params for idle', () => {
    expect(getPose('idle')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/customer && npx vitest run src/components/Mascot/poses.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/customer/src/components/Mascot/poses.ts
export type MascotPose = 'cheer' | 'shrug' | 'wave' | 'snooze' | 'idle';

export interface PoseParams {
  mouthPath: string; // SVG path within a 100x100 viewBox, face centered ~ (50,52)
  eyeRy: number;     // eye vertical radius (open vs squinting)
  rayScale: number;  // sun-ray length multiplier
  rayRotate: number; // degrees the ray group is rotated
}

// Face lives in a 100x100 viewBox; sun body is a circle r=26 at (50,52).
const MOUTH_SMILE = 'M40 58 Q50 68 60 58';
const MOUTH_BIG = 'M38 56 Q50 72 62 56 Q50 64 38 56 Z';
const MOUTH_FLAT = 'M42 60 Q50 63 58 60';
const MOUTH_SMALL = 'M45 61 Q50 65 55 61';

export function getPose(pose: MascotPose): PoseParams {
  switch (pose) {
    case 'cheer': return { mouthPath: MOUTH_BIG, eyeRy: 4, rayScale: 1.25, rayRotate: 0 };
    case 'wave': return { mouthPath: MOUTH_SMILE, eyeRy: 4, rayScale: 1.1, rayRotate: 6 };
    case 'shrug': return { mouthPath: MOUTH_FLAT, eyeRy: 3.5, rayScale: 0.85, rayRotate: -4 };
    case 'snooze': return { mouthPath: MOUTH_SMALL, eyeRy: 1.2, rayScale: 0.9, rayRotate: 0 };
    case 'idle': default: return { mouthPath: MOUTH_SMILE, eyeRy: 4, rayScale: 1.0, rayRotate: 0 };
  }
}
```

```tsx
// apps/customer/src/components/Mascot/Mascot.tsx
import { useEffect } from 'react';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import Svg, { Circle, Ellipse, Path, G, Line } from 'react-native-svg';
import { colors } from '../../theme';
import { getPose, type MascotPose } from './poses';

const RAYS = Array.from({ length: 8 }, (_, i) => (i * 360) / 8);

export function Mascot({ pose = 'idle', size = 120, animate = true }: {
  pose?: MascotPose; size?: number; animate?: boolean;
}) {
  const p = getPose(pose);
  const bob = useSharedValue(0);

  useEffect(() => {
    if (animate) {
      bob.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }), -1, true);
    }
  }, [animate, bob]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateY: bob.value * -4 }] }));

  return (
    <Animated.View style={style}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <G rotation={p.rayRotate} origin="50, 52">
          {RAYS.map((deg) => (
            <Line
              key={deg}
              x1="50" y1={52 - 30} x2="50" y2={52 - 30 - 8 * p.rayScale}
              stroke={colors.star} strokeWidth="4" strokeLinecap="round"
              transform={`rotate(${deg} 50 52)`}
            />
          ))}
        </G>
        <Circle cx="50" cy="52" r="26" fill={colors.accent} />
        <Ellipse cx="42" cy="48" rx="3" ry={p.eyeRy} fill={colors.white} />
        <Ellipse cx="58" cy="48" rx="3" ry={p.eyeRy} fill={colors.white} />
        <Path d={p.mouthPath} stroke={colors.white} strokeWidth="3" strokeLinecap="round" fill="none" />
      </Svg>
    </Animated.View>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/customer && npx vitest run src/components/Mascot/poses.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
cd apps/customer && npx tsc --noEmit
cd ../.. && git add apps/customer/src/components/Mascot/
git commit -m "feat(customer): Sunny mascot (inline SVG, poseable)"
```

---

### Task 4: `Confetti` burst

**Files:**
- Create: `apps/customer/src/components/Confetti.tsx`
- Test: `apps/customer/src/components/Confetti.test.ts`

**Interfaces:**
- Produces:
  - `interface Particle { id: number; x: number; angle: number; distance: number; color: string; delay: number }`
  - `buildParticles(count: number, colors: string[]): Particle[]` — pure, deterministic (no `Math.random`; uses index-derived spread so it's testable).
  - `Confetti(props: { visible: boolean; count?: number })` component.

- [ ] **Step 1: Write the failing test**

```ts
// apps/customer/src/components/Confetti.test.ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('react-native', () => ({ StyleSheet: { create: (s: unknown) => s }, View: 'View', Dimensions: { get: () => ({ width: 390 }) } }));
vi.mock('react-native-reanimated', () => ({ default: { View: 'AV' }, useSharedValue: (v: number) => ({ value: v }), useAnimatedStyle: (f: () => unknown) => f(), withTiming: (v: number) => v, withDelay: (_d: number, v: number) => v }));

import { buildParticles } from './Confetti';

describe('buildParticles — deterministic particle spread', () => {
  it('returns exactly `count` particles', () => {
    expect(buildParticles(14, ['#a', '#b'])).toHaveLength(14);
  });
  it('cycles through the provided colors', () => {
    const ps = buildParticles(4, ['#a', '#b']);
    expect(ps.map((p) => p.color)).toEqual(['#a', '#b', '#a', '#b']);
  });
  it('spreads angles across 0..360', () => {
    const ps = buildParticles(8, ['#a']);
    expect(ps[0].angle).toBe(0);
    expect(ps[ps.length - 1].angle).toBeLessThan(360);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/customer && npx vitest run src/components/Confetti.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// apps/customer/src/components/Confetti.tsx
import { StyleSheet, View } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withDelay } from 'react-native-reanimated';
import { useEffect } from 'react';

export interface Particle {
  id: number; x: number; angle: number; distance: number; color: string; delay: number;
}

export function buildParticles(count: number, palette: string[]): Particle[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: 0,
    angle: (i * 360) / count,
    distance: 90 + (i % 3) * 30,
    color: palette[i % palette.length],
    delay: (i % 5) * 40,
  }));
}

function Dot({ p, progress }: { p: Particle; progress: { value: number } }) {
  const style = useAnimatedStyle(() => {
    const rad = (p.angle * Math.PI) / 180;
    const t = progress.value;
    return {
      opacity: 1 - t,
      transform: [
        { translateX: Math.cos(rad) * p.distance * t },
        { translateY: Math.sin(rad) * p.distance * t },
        { scale: 1 - t * 0.4 },
      ],
    };
  });
  return <Animated.View style={[styles.dot, { backgroundColor: p.color }, style]} />;
}

export function Confetti({ visible, count = 14, palette = ['#F05A1F', '#0E7C91', '#e8a317'] }: {
  visible: boolean; count?: number; palette?: string[];
}) {
  const progress = useSharedValue(0);
  const particles = buildParticles(count, palette);

  useEffect(() => {
    if (visible) { progress.value = 0; progress.value = withDelay(60, withTiming(1, { duration: 900 })); }
  }, [visible, progress]);

  if (!visible) return null;
  return (
    <View pointerEvents="none" style={styles.wrap}>
      {particles.map((p) => <Dot key={p.id} p={p} progress={progress} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', width: 10, height: 10, borderRadius: 3 },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/customer && npx vitest run src/components/Confetti.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
cd apps/customer && npx tsc --noEmit
cd ../.. && git add apps/customer/src/components/Confetti.tsx apps/customer/src/components/Confetti.test.ts
git commit -m "feat(customer): Confetti particle burst (Reanimated, no dep)"
```

---

### Task 5: `EmptyState` component

**Files:**
- Create: `apps/customer/src/components/EmptyState.tsx`

**Interfaces:**
- Consumes: `Mascot` (Task 3), `PressableScale` (Task 1), `MascotPose` type.
- Produces: `EmptyState(props: EmptyStateProps)` where `interface EmptyStateProps { pose?: MascotPose; title: string; body?: string; cta?: { label: string; onPress: () => void } }`.

This task has no pure helper worth a unit test (it is pure composition); it is validated by TypeScript + in-app use. Its correctness gate is `tsc` + the screens in Task 11 rendering it.

- [ ] **Step 1: Write the implementation**

```tsx
// apps/customer/src/components/EmptyState.tsx
import { StyleSheet, Text, View } from 'react-native';
import { Mascot } from './Mascot/Mascot';
import type { MascotPose } from './Mascot/poses';
import { PressableScale } from './PressableScale';
import { colors, font, radius, spacing } from '../theme';

export interface EmptyStateProps {
  pose?: MascotPose;
  title: string;
  body?: string;
  cta?: { label: string; onPress: () => void };
}

export function EmptyState({ pose = 'shrug', title, body, cta }: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      <Mascot pose={pose} size={128} />
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {cta ? (
        <PressableScale haptic="press" onPress={cta.onPress} style={styles.cta}>
          <Text style={styles.ctaLabel}>{cta.label}</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxxl, gap: spacing.md },
  title: { fontSize: font.sizes['4xl'], fontWeight: font.weights.extrabold, color: colors.ink, textAlign: 'center', marginTop: spacing.sm },
  body: { fontSize: font.sizes.xl, color: colors.ink2, textAlign: 'center', lineHeight: 20 },
  cta: { marginTop: spacing.md, backgroundColor: colors.accent, paddingVertical: 14, paddingHorizontal: 28, borderRadius: radius.pill },
  ctaLabel: { color: colors.white, fontWeight: font.weights.bold, fontSize: font.sizes.xl },
});
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd apps/customer && npx tsc --noEmit
cd ../.. && git add apps/customer/src/components/EmptyState.tsx
git commit -m "feat(customer): EmptyState (Sunny + encouraging copy + optional CTA)"
```

---

### Task 6: `OrderCelebration` component

**Files:**
- Create: `apps/customer/src/components/OrderCelebration.tsx`
- Test: `apps/customer/src/components/OrderCelebration.test.ts`

**Interfaces:**
- Consumes: `Mascot` (Task 3), `Confetti` (Task 4), `colors`/`shadow` from theme.
- Produces:
  - `shouldCelebrate(param: string | string[] | undefined): boolean` — pure; true only when the `celebrate` route param equals `'1'`.
  - `OrderCelebration(props: { visible: boolean; etaText?: string; onDone: () => void })`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/customer/src/components/OrderCelebration.test.ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('react-native', () => ({ StyleSheet: { create: (s: unknown) => s }, View: 'View', Text: 'Text', Pressable: 'Pressable', AccessibilityInfo: { isReduceMotionEnabled: vi.fn(async () => false) } }));
vi.mock('react-native-reanimated', () => ({ default: { View: 'AV' }, useSharedValue: (v: number) => ({ value: v }), useAnimatedStyle: (f: () => unknown) => f(), withTiming: (v: number) => v, withDelay: (_d: number, v: number) => v, withSpring: (v: number) => v }));

import { shouldCelebrate } from './OrderCelebration';

describe('shouldCelebrate — one-shot celebrate param gate', () => {
  it('true when param is "1"', () => { expect(shouldCelebrate('1')).toBe(true); });
  it('false when param absent', () => { expect(shouldCelebrate(undefined)).toBe(false); });
  it('false for any other value', () => { expect(shouldCelebrate('0')).toBe(false); });
  it('handles array params (expo-router repeats) by taking first', () => { expect(shouldCelebrate(['1'])).toBe(true); });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/customer && npx vitest run src/components/OrderCelebration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// apps/customer/src/components/OrderCelebration.tsx
import { useEffect } from 'react';
import { StyleSheet, Text, View, Pressable, AccessibilityInfo } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withDelay, withSpring } from 'react-native-reanimated';
import { Mascot } from './Mascot/Mascot';
import { Confetti } from './Confetti';
import { colors, font, radius, spacing, shadow } from '../theme';

export function shouldCelebrate(param: string | string[] | undefined): boolean {
  const v = Array.isArray(param) ? param[0] : param;
  return v === '1';
}

export function OrderCelebration({ visible, etaText, onDone }: {
  visible: boolean; etaText?: string; onDone: () => void;
}) {
  const enter = useSharedValue(0);

  useEffect(() => {
    if (!visible) return;
    let reduce = false;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { reduce = v; });
    enter.value = reduce ? 1 : withDelay(80, withSpring(1, { damping: 14 }));
    const timer = setTimeout(onDone, 1600);
    return () => clearTimeout(timer);
  }, [visible, enter, onDone]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 40 }, { scale: 0.9 + enter.value * 0.1 }],
  }));

  if (!visible) return null;
  return (
    <Pressable style={styles.scrim} onPress={onDone} accessibilityRole="button" accessibilityLabel="Dismiss">
      <Confetti visible={visible} />
      <Animated.View style={[styles.card, cardStyle]}>
        <View style={styles.glow}>
          <Mascot pose="cheer" size={140} />
        </View>
        <Text style={styles.title}>Order placed! 🎉</Text>
        <Text style={styles.sub}>
          {etaText ? `You'll pay on delivery — arriving ${etaText}` : "You'll pay on delivery — no card needed"}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(19,19,19,0.55)', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  card: { alignItems: 'center', backgroundColor: colors.white, borderRadius: radius.xxxl, paddingVertical: spacing.xxxl, paddingHorizontal: spacing.xxl, gap: spacing.sm, ...shadow.card },
  glow: { ...shadow.accentGlow, borderRadius: radius.pill },
  title: { fontSize: font.sizes['7xl'], fontWeight: font.weights.black, color: colors.ink, marginTop: spacing.md },
  sub: { fontSize: font.sizes.xl, color: colors.ink2, textAlign: 'center', maxWidth: 240, lineHeight: 20 },
});
```

**Note:** the title/sub copy above is hardcoded English for the first pass; Task 10 replaces the two strings with `useT()` calls (`celebration.title`, `celebration.cod`, `celebration.codEta`). Leave them literal here — Task 10 owns i18n so the reviewer sees copy centralized in one task.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/customer && npx vitest run src/components/OrderCelebration.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
cd apps/customer && npx tsc --noEmit
cd ../.. && git add apps/customer/src/components/OrderCelebration.tsx apps/customer/src/components/OrderCelebration.test.ts
git commit -m "feat(customer): OrderCelebration hero (cheer + glow + confetti)"
```

---

### Task 7: Wire celebration into checkout → order flow

**Files:**
- Modify: `apps/customer/app/checkout.tsx` (the two `router.replace` on placement — around lines 261 and the earlier success path near 197/259)
- Modify: `apps/customer/app/order/[id].tsx` (import + mount + param clear)

**Interfaces:**
- Consumes: `OrderCelebration`, `shouldCelebrate` (Task 6).

- [ ] **Step 1: Add the celebrate param to checkout's success redirect**

In `apps/customer/app/checkout.tsx`, change the post-placement redirect:

```tsx
// was: router.replace(`/order/${order.id}`);
router.replace(`/order/${order.id}?celebrate=1`);
```

(There is one canonical placement redirect after `success()` near line 261 — update that one. If a second identical redirect exists on an idempotent-resume path, update it too so a resumed placement also celebrates.)

- [ ] **Step 2: Mount the celebration in the order screen**

In `apps/customer/app/order/[id].tsx`:

Add imports near the existing component imports:
```tsx
import { OrderCelebration, shouldCelebrate } from '../../src/components/OrderCelebration';
```

The screen already calls `useLocalSearchParams()` (it reads `id`). Extend it to also read `celebrate`, and add local state:
```tsx
const { id, celebrate } = useLocalSearchParams<{ id: string; celebrate?: string }>();
const [showCelebration, setShowCelebration] = useState(shouldCelebrate(celebrate));
```

Compute an ETA string from the loaded order (the screen already loads `order`); pass it in. Render the overlay at the end of the returned tree (as the last sibling inside the root container, so it sits above content):
```tsx
<OrderCelebration
  visible={showCelebration}
  etaText={order?.eta_at ? formatTime(order.eta_at) : undefined}
  onDone={() => {
    setShowCelebration(false);
    router.setParams({ celebrate: undefined }); // clear so back/refresh won't replay
  }}
/>
```

`router` and `formatTime` are already imported in this file.

- [ ] **Step 3: Typecheck**

Run: `cd apps/customer && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run full test suite (nothing should regress)**

Run: `cd apps/customer && npx vitest run`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add apps/customer/app/checkout.tsx apps/customer/app/order/\[id\].tsx
git commit -m "feat(customer): play order-placed celebration on first arrival"
```

---

### Task 8: Tab bar → active-weight icons + PressableScale

**Files:**
- Modify: `apps/customer/src/components/TabBar.tsx`

**Interfaces:**
- Consumes: `Icon` with `active` (Task 2), `PressableScale` (Task 1).

- [ ] **Step 1: Replace emoji glyphs with intent-based Icon**

In `TabBar.tsx`, change the `TABS` array to carry an `IconName` instead of an emoji, and render `<Icon>`:

```tsx
import { Icon, type IconName } from './Icon';
// ...
const TABS: { key: TabKey; icon: IconName; tKey: string; path: string }[] = [
  { key: 'home', icon: 'home', tKey: 'tabs.home', path: '/(tabs)/home' },
  { key: 'browse', icon: 'search', tKey: 'tabs.browse', path: '/(tabs)/browse' },
  { key: 'cart', icon: 'cart', tKey: 'tabs.cart', path: '/(tabs)/cart' },
  { key: 'orders', icon: 'receipt', tKey: 'tabs.orders', path: '/(tabs)/orders' },
  { key: 'rewards', icon: 'gift', tKey: 'tabs.rewards', path: '/(tabs)/rewards' },
  { key: 'profile', icon: 'person', tKey: 'tabs.profile', path: '/(tabs)/profile' },
];
```

Replace the icon `<Text>` with `<Icon>` (active fills, inactive dims via color):
```tsx
<Icon
  name={tab.icon}
  active={active}
  size={22}
  color={active ? colors.inkDeep : colors.white}
/>
```

Note: the active tab sits in a white pill (dark icon), inactive tabs on the dark bar (white icon, dimmed). Replace the old `styles.icon`/`iconDim` opacity approach: for inactive, use `color={colors.white}` with the wrapping view at `opacity: 0.55`. Keep the badge `<View>`s exactly as they are (cart bounce, unread badges).

- [ ] **Step 2: Swap the tab Pressable for PressableScale**

```tsx
import { PressableScale } from './PressableScale';
// ...
<PressableScale
  key={tab.key}
  haptic="none"   // selection() is already called explicitly below; avoid double-buzz
  onPress={() => { if (!active) selection(); router.replace(tab.path as never); }}
  style={active ? styles.tabOn : styles.tab}>
  {/* unchanged inner content */}
</PressableScale>
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/customer && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/customer/src/components/TabBar.tsx
git commit -m "feat(customer): tab bar active-weight icons + press feedback"
```

---

### Task 9: Onboarding first-impression redesign

**Files:**
- Modify: `apps/customer/app/onboarding.tsx`

**Interfaces:**
- Consumes: `Mascot` (Task 3), `PressableScale` (Task 1), `selection` haptic.

- [ ] **Step 1: Open with Sunny + add a COD trust slide**

In `onboarding.tsx`, restructure `SLIDES` so slide 1 renders `Mascot` (`wave`) instead of a remote image, and add a dedicated COD slide. Since slides currently key off an `img` URL, change the slide type to allow a mascot slide:

```tsx
type Slide = {
  kind: 'mascot' | 'image';
  pose?: 'wave' | 'cheer';
  img?: string;
  titleKey: string; accentKey: string; descKey: string;
};

const SLIDES: Slide[] = [
  { kind: 'mascot', pose: 'wave', titleKey: 'onboarding.title1', accentKey: 'onboarding.accent1', descKey: 'onboarding.desc1' },
  { kind: 'mascot', pose: 'cheer', titleKey: 'onboarding.codTitle', accentKey: 'onboarding.codAccent', descKey: 'onboarding.codDesc' },
  { kind: 'image', img: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=900&h=1200&fit=crop&auto=format&q=80', titleKey: 'onboarding.title3', accentKey: 'onboarding.accent3', descKey: 'onboarding.desc3' },
];
```

In the slide render, branch: `slide.kind === 'mascot'` → `<Mascot pose={slide.pose} size={220} />` centered on the warm `colors.bg`; else the existing `<Image>` path. This guarantees the FIRST frame renders instantly offline.

- [ ] **Step 2: Haptic on page change + animated dots**

In `onScroll`, when the index changes, fire `selection()`:
```tsx
import { selection } from '../src/haptics';
// inside onScroll, where `if (i !== index) setIndex(i)`:
if (i !== index) { selection(); setIndex(i); }
```

For the page dots, make the active dot wider (pill) instead of just recolored — change the dot style to interpolate width by active index (a simple conditional `width: i === index ? 22 : 8` on the dot `View` is sufficient and matches the "pill-grows" intent).

- [ ] **Step 3: PressableScale the "Get started" CTA**

The CTA currently uses `PrimaryButton` (which already presses+haptics) — leave it if so. If there is a bare `Pressable` for "skip"/locale, swap those to `PressableScale haptic="selection"`.

- [ ] **Step 4: Typecheck**

Run: `cd apps/customer && npx tsc --noEmit`
Expected: no errors (copy keys resolve to themselves until Task 10 adds them; that's fine at runtime via the `?? key` fallback).

- [ ] **Step 5: Commit**

```bash
git add apps/customer/app/onboarding.tsx
git commit -m "feat(customer): onboarding first-impression (Sunny + COD trust slide)"
```

---

### Task 10: i18n keys across all 5 locales

**Files:**
- Modify: `apps/customer/src/i18n/locales/en.json`, `ar.json`, `ru.json`, `it.json`, `de.json`
- Modify: `apps/customer/src/components/OrderCelebration.tsx` (swap literals → `useT`)

**Interfaces:**
- Consumes: `useT()` from `src/i18n`.

- [ ] **Step 1: Add keys to `en.json`**

Add these flat keys (place near existing `onboarding.*` / `order.*` groups):
```json
"celebration.title": "Order placed! 🎉",
"celebration.cod": "You'll pay on delivery — no card needed",
"celebration.codEta": "You'll pay on delivery — arriving {eta}",
"onboarding.codTitle": "Pay when it arrives",
"onboarding.codAccent": "Cash on delivery",
"onboarding.codDesc": "No card needed. Pay the driver in cash when your food reaches you.",
"empty.cart.title": "Your cart is empty",
"empty.cart.body": "Nothing here yet — let's fix that.",
"empty.cart.cta": "Browse restaurants",
"empty.orders.title": "No orders yet",
"empty.orders.body": "Your first delicious order is one tap away.",
"empty.orders.cta": "Find food",
"empty.generic.title": "Nothing here yet"
```

- [ ] **Step 2: Add the same keys, translated, to `ar.json`, `ru.json`, `it.json`, `de.json`**

Provide real translations for each (Arabic is RTL — the app already handles RTL; just supply the string). Use the same key names. Example for `de.json`:
```json
"celebration.title": "Bestellung aufgegeben! 🎉",
"celebration.cod": "Du zahlst bei Lieferung — keine Karte nötig",
"celebration.codEta": "Du zahlst bei Lieferung — Ankunft {eta}",
"onboarding.codTitle": "Zahle bei Ankunft",
"onboarding.codAccent": "Barzahlung bei Lieferung",
"onboarding.codDesc": "Keine Karte nötig. Zahle dem Fahrer bar, wenn dein Essen ankommt.",
"empty.cart.title": "Dein Warenkorb ist leer",
"empty.cart.body": "Noch nichts hier — das ändern wir.",
"empty.cart.cta": "Restaurants ansehen",
"empty.orders.title": "Noch keine Bestellungen",
"empty.orders.body": "Deine erste leckere Bestellung ist nur einen Tipp entfernt.",
"empty.orders.cta": "Essen finden",
"empty.generic.title": "Noch nichts hier"
```
(Translate equivalently for `ar`, `ru`, `it`.)

- [ ] **Step 3: Swap OrderCelebration literals to useT**

In `OrderCelebration.tsx`, import and use `useT`:
```tsx
import { useT } from '../i18n';
// inside component:
const t = useT();
// title:
<Text style={styles.title}>{t('celebration.title')}</Text>
// sub:
<Text style={styles.sub}>{etaText ? t('celebration.codEta', { eta: etaText }) : t('celebration.cod')}</Text>
```

- [ ] **Step 4: Typecheck + full tests**

Run: `cd apps/customer && npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/customer/src/i18n/locales/ apps/customer/src/components/OrderCelebration.tsx
git commit -m "feat(customer): i18n for celebration + COD onboarding + empty states (5 locales)"
```

---

### Task 11: Replace text empty states with `EmptyState`

**Files (modify each; replace the existing inline "empty" JSX):**
- `apps/customer/app/(tabs)/cart.tsx` — pose `shrug`, keys `empty.cart.*`, CTA → `router.push('/(tabs)/browse')`
- `apps/customer/app/(tabs)/orders.tsx` — pose `snooze`, keys `empty.orders.*`, CTA → `router.push('/(tabs)/home')`
- `apps/customer/app/(tabs)/browse.tsx` — pose `shrug`, `empty.generic.title` (no CTA) for empty search results
- `apps/customer/app/(tabs)/rewards.tsx` — pose `idle`, `empty.generic.title` if no rewards
- `apps/customer/app/support.tsx` — pose `idle`, `empty.generic.title` for no messages
- `apps/customer/app/address/picker.tsx` — pose `shrug`, `empty.generic.title` for no saved addresses

For screens where the "empty" is a small inline hint rather than a full-screen state (chat, restaurant, allergies, checkout), leave them — forcing a big mascot there would be worse UX. **Log this decision** in the commit message so it's not read as an omission.

- [ ] **Step 1: Replace the cart empty state**

In `cart.tsx`, find the block rendered when `lines.length === 0` and replace with:
```tsx
import { EmptyState } from '../../src/components/EmptyState';
import { useRouter } from 'expo-router';
// ...
<EmptyState
  pose="shrug"
  title={t('empty.cart.title')}
  body={t('empty.cart.body')}
  cta={{ label: t('empty.cart.cta'), onPress: () => router.push('/(tabs)/browse') }}
/>
```

- [ ] **Step 2: Replace the orders empty state** (same pattern, `snooze`, `empty.orders.*`, CTA → home).

- [ ] **Step 3: Replace the remaining four** (browse/rewards/support/address-picker) with the generic title, no CTA.

- [ ] **Step 4: Typecheck + full tests**

Run: `cd apps/customer && npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/customer/app/
git commit -m "feat(customer): mascot empty states across 6 screens

Inline hints on chat/restaurant/allergies/checkout intentionally kept
(a full-screen mascot there would harm, not help, UX)."
```

---

### Task 12: App-wide `Pressable` → `PressableScale` sweep

**Files:** the ~21 screens/components currently importing `Pressable` for tappable rows/buttons.

**Rule:** Swap `Pressable`→`PressableScale` **only** for genuine tap targets (buttons, cards, rows, chips). Do NOT swap `Pressable`s used purely as layout/scrim/overlay wrappers or ones with a `style` function relying on `({ pressed }) =>` (those need manual review — either keep `Pressable` or drop the pressed-style since PressableScale handles press feel).

- [ ] **Step 1: Inventory**

Run: `cd apps/customer && grep -rln "from 'react-native'" app src/components | xargs grep -l "Pressable" | sort -u`
For each file, decide per-usage: tap target → swap; wrapper/scrim → leave.

- [ ] **Step 2: Swap in batches by screen**

For each tap-target `Pressable`, change the import to add `PressableScale` and replace the JSX tag. Choose `haptic`: `press` for primary actions (add to cart, place, confirm), `tap` for navigation/rows (default), `selection` for toggles/choices. Remove any now-redundant `pressed && {scale…}` style branches.

- [ ] **Step 3: Typecheck + full tests after each batch**

Run: `cd apps/customer && npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 4: Commit (may be 2-3 commits by batch)**

```bash
git add apps/customer/
git commit -m "feat(customer): press-scale + haptics on tap targets app-wide"
```

---

### Task 13: Design-taste checklist doc

**Files:**
- Create: `docs/design/DESIGN-TASTE-CHECKLIST.md`

- [ ] **Step 1: Write the checklist**

```markdown
# Design-Taste Checklist (pre-merge QA gate)

Distilled from the 9 app-polish principles. Run before merging any customer-app UI change.

## Feel alive & responsive
- [ ] Every tappable element is a `PressableScale` (scales + buzzes on press)
- [ ] Active nav / toggle items change icon **weight** (outline → filled), not just color

## Cheer the user on
- [ ] Every empty state uses `<EmptyState>` with Sunny + **encouraging** (never error-toned) copy
- [ ] Every success moment (order placed, saved, redeemed) has an emotional payoff, not just a checkmark
- [ ] Haptics chosen intentionally: `press` (commit actions), `tap` (nav), `selection` (choices), `success` (completions)

## Earn trust through care
- [ ] The first frame of any entry flow renders **instantly, offline** (no network-gated placeholder)
- [ ] Money / COD moments explicitly reassure ("pay on delivery — no card needed")

## Human, not technical
- [ ] Copy is plain and human, not technical or system-voiced
- [ ] All new user-facing copy exists in **all 5 locales**
- [ ] Reduced-motion degrades gracefully (static visual, haptic still fires)

## Elevate taste (habit)
- [ ] Studied a comparable flow on Mobbin before designing a new screen
```

- [ ] **Step 2: Commit**

```bash
git add docs/design/DESIGN-TASTE-CHECKLIST.md
git commit -m "docs: design-taste pre-merge QA checklist"
```

---

### Task 14: Final verification + PR

- [ ] **Step 1: Full green gate**

Run: `cd apps/customer && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all Vitest suites pass.

- [ ] **Step 2: Manual smoke (owner/simulator)**

Verify in a running app: onboarding opens with Sunny offline; tab icons fill when active + buzz; add-to-cart buzzes; place an order → celebration plays once, back-nav doesn't replay; empty cart shows Sunny.

- [ ] **Step 3: Open PR**

```bash
git push -u origin feat/polish-trust-delight
gh pr create --title "Polish as Trust — customer app delight pass" \
  --body "Implements the 9-principle delight spec (docs/superpowers/specs/2026-07-05-polish-trust-delight-design.md): PressableScale + haptics app-wide, Sunny mascot, order-placed celebration, active-weight icons, first-impression onboarding, empty states, design-taste checklist. Ships as an EAS OTA Update — no store rebuild. tsc clean, Vitest green."
```

---

## Self-Review

**1. Spec coverage:**
- PressableScale (0:32, 4:52) → Tasks 1, 12 ✓
- Sunny mascot (2:47, 8:08) → Task 3 ✓
- EmptyState / empty states (4:04) → Tasks 5, 11 ✓
- OrderCelebration (4:04, 7:55) → Tasks 6, 7 ✓
- Icon active weight (6:06) → Tasks 2, 8 ✓
- Onboarding first impression (11:00) → Task 9 ✓
- COD trust reassurance (7:55) → Tasks 6 (peak), 9 (slide) ✓
- Design-taste checklist (8:56) → Task 13 ✓
- i18n across 5 locales (constraint) → Task 10 ✓
- No spec section is unimplemented.

**2. Placeholder scan:** No TBD/TODO; all code steps contain full code; the one deferred detail (OrderCelebration copy) is explicitly owned by Task 10 with exact keys. ✓

**3. Type consistency:** `resolvePressHaptic`, `resolveGlyph`, `getPose`/`PoseParams`/`MascotPose`, `buildParticles`/`Particle`, `shouldCelebrate`, `EmptyStateProps`, `PressableScaleProps` are each defined once and consumed with matching signatures. `MascotPose` is imported from `poses.ts` everywhere it's used. `Icon` gains `active` in Task 2 and is consumed with `active` in Task 8. ✓
```
