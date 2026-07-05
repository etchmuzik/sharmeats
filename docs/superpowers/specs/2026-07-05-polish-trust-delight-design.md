# Polish as Trust — Customer App Delight Pass

**Date:** 2026-07-05
**Status:** Approved (design)
**Scope:** `apps/customer` only. Ships as a single **EAS OTA Update** — no store rebuild (JS + inline SVG only).
**Ships:** OTA (not gated on a new binary).

## Why

Nine design principles (from Chris Raroque's app-polish talk, extended by the user)
collapse into four *jobs* the polish must do. Sharm Eats is a trust-sensitive,
tourist-facing, **cash-on-delivery** food app: a first-time user in a foreign city
is deciding whether to trust an unknown brand with a hungry order. Polish here is
not decoration — it is the trust signal.

| Job | Principles | Where it lands |
|---|---|---|
| Feel alive & responsive | interactions (0:32), icons+weight (6:06) | `PressableScale` everywhere; Ionicons weight-swap; tab bar |
| Cheer the user on (emotional loop) | emotional feedback (4:04), haptics (4:52), mascot | add-to-cart bounce+buzz; **order-placed celebration**; encouraging empty states |
| Earn trust through care | polish-as-trust (7:55), first impression (11:00) | onboarding; COD "pay on delivery" reassurance beats |
| Human, not technical | design-for-people (8:08), illustrations (2:47), taste (8:56) | Sunny mascot; plain-language copy; design-taste QA checklist |

### Baseline (audited 2026-07-05)

- Stack: Expo 52 / RN 0.76 / expo-router. **All deps already installed**:
  `expo-haptics`, `react-native-reanimated`, `react-native-svg`,
  `expo-linear-gradient`, `@expo/vector-icons` (Ionicons).
- `src/theme.ts` — mature v2 design tokens (colors, spacing, radius, font, shadow).
- `src/haptics.ts` — a **crash-safe** helper (wraps every call in sync try/catch +
  async `.catch()` to survive New-Architecture native throws) — but it is called in
  only ~2 places. **Built and unused.**
- Reanimated used in **1 of ~28 screens** (`restaurant/[id].tsx`).
- Icons are **emoji**; only 2 real vector-icon usages in the whole app.
- 10 screens have **text-only** empty states.
- Onboarding loads **3 remote Unsplash photos** → first frame can be blank on slow
  cellular (a first-impression risk).
- Checkout (`checkout.tsx:261`) already fires `success()` haptic then
  `router.replace('/order/${order.id}')` — the visual celebration is the only gap.

## Architecture

Small, dumb, reusable **primitives** first; screens **compose** them. Primitives know
nothing about domain concepts (`PressableScale` knows nothing about carts; `Mascot`
knows nothing about orders). This keeps per-screen diffs tiny (mostly
`Pressable`→`PressableScale` swaps) and each unit independently testable.

```
apps/customer/
├── src/
│   ├── haptics.ts                      # EXISTS (crash-safe). Now actually called.
│   ├── components/
│   │   ├── PressableScale.tsx          # NEW primitive: spring press + optional haptic
│   │   ├── Mascot/
│   │   │   ├── Mascot.tsx              # NEW inline-SVG "Sunny" (theme-tinted, poses)
│   │   │   └── poses.ts                # per-pose params (cheer/shrug/wave/snooze/idle)
│   │   ├── EmptyState.tsx              # NEW: Sunny + encouraging copy + optional CTA
│   │   ├── OrderCelebration.tsx        # NEW: order-placed hero (cheer+glow+confetti)
│   │   ├── Confetti.tsx               # NEW: Reanimated particle burst (no new dep)
│   │   └── Icon.tsx                    # EXISTS. Extended: Ionicons outline↔filled
│   └── i18n/                           # EXISTS. New keys across all 5 locales.

docs/design/DESIGN-TASTE-CHECKLIST.md   # NEW (repo root): principle #5 as a pre-merge QA gate
```

## Components

### `PressableScale` — makes every tap feel alive (0:32, 4:52)

Drop-in `Pressable` replacement. Spring-scales to `scaleTo` on press-in, springs back on
release, fires a haptic on press-in (feels instant). Reanimated + native driver.

```tsx
interface PressableScaleProps extends PressableProps {
  scaleTo?: number;                                  // default 0.96
  haptic?: 'tap' | 'press' | 'selection' | 'none';  // default 'tap'
  children: React.ReactNode;
}
```

- **API-compatible with `Pressable`** → the ~21 screens already on `Pressable` migrate
  by name swap, no prop rewrites.
- **Reduced-motion:** reads `AccessibilityInfo.isReduceMotionEnabled()`; when on, skips
  the scale animation (haptic still fires).
- Haptic routed through the existing crash-safe `src/haptics.ts` (`tap`/`press`/`selection`).

### `Mascot` — "Sunny", the sun character (2:47, 8:08)

Inline `react-native-svg`. Sharm el-Sheikh = City of Sunshine → a cheerful sun with a
face; warm, culturally neutral (tourist-safe), legible at any size, tints to
`accent`/`star`. One component, `pose` prop, gentle idle bob/ray-rotate.

```tsx
interface MascotProps {
  pose?: 'cheer' | 'shrug' | 'wave' | 'snooze' | 'idle';  // default 'idle'
  size?: number;        // default 120
  animate?: boolean;    // idle bob + ray drift, default true
}
```

| Pose | Surface |
|---|---|
| `cheer` | Order-placed celebration; COD-trust onboarding slide |
| `shrug` | Empty cart |
| `snooze` | No past orders |
| `wave` | Onboarding welcome (slide 1) |
| `idle` | Anywhere it lingers |

### `EmptyState` — encourage, don't scold (4:04)

```tsx
interface EmptyStateProps {
  pose?: MascotProps['pose'];
  title: string;                 // i18n'd upstream
  body?: string;
  cta?: { label: string; onPress: () => void };  // rendered as PressableScale
}
```

Replaces the 10 text-only empty states (cart, orders, rewards, browse, support,
address picker, chat, restaurant, allergies, checkout). Copy is encouraging and human,
never an error tone (e.g. empty cart → "Nothing here yet — let's fix that").

### `OrderCelebration` + `Confetti` — the emotional centerpiece (4:04, 7:55)

The highest-anxiety instant in the app (a COD tourist just committed to paying a
stranger). We turn the flat post-placement transition into a cheer that *also*
reassures.

```tsx
interface OrderCelebrationProps {
  visible: boolean;
  etaText?: string;    // e.g. "≈ 25 min" from order.eta_at
  onDone: () => void;  // clears ?celebrate + hides
}
```

**Trigger (param-as-signal, no new store):** checkout changes its redirect to
`router.replace('/order/${order.id}?celebrate=1')`. `app/order/[id].tsx` reads
`celebrate` via `useLocalSearchParams()`, plays once, then clears the param so a
back-nav / refresh never replays.

**Sequence (~1.6s, skippable — tap anywhere to skip):**
```
0ms     success() haptic  (already fires in checkout; kept as the beat)
0–150   scrim fades in; Sunny enters from below
150–500 Sunny springs to 'cheer' + accent glow ring (theme shadow.accentGlow)
        + Confetti burst (12–16 themed dots: accent/sea/star)
500–900 "Order placed!" + "You'll pay on delivery — {etaText}" fades up
900+    auto-dismiss → live order-tracking view
```

- **COD reassurance at the peak** turns celebration into a trust signal (7:55).
- **Confetti** is a Reanimated particle burst (no new dependency).
- **Reduced-motion:** collapses to a static Sunny + copy card (no scrim/confetti
  animation); haptic still fires.
- **One-shot & skippable:** never blocks a user who just wants to track their food.

### `Icon` (extended) — good icons + active weight (6:06)

Every icon routes through one component that owns the outline↔filled rule.

```tsx
interface IconProps {
  name: string;      // Ionicons base, e.g. "home"
  active?: boolean;  // false → `${name}-outline`, true → `${name}` (filled)
  size?: number;
  color?: string;
}
```

**Tab bar** (`TabBar.tsx` — flagship active-weight surface). Active tab already sits in a
white labeled pill; now its icon also *fills*, doubling the active signal. Cart-badge
bounce (already present) kept.

| Tab | emoji now | inactive | active |
|---|---|---|---|
| home | 🏠 | `home-outline` | `home` |
| browse | 🔍 | `search-outline` | `search` |
| cart | 🛒 | `bag-outline` | `bag` |
| orders | 🧾 | `receipt-outline` | `receipt` |
| rewards | 🎁 | `gift-outline` | `gift` |
| profile | 👤 | `person-outline` | `person` |

**Cuisine chips** (`home.tsx:27-37`) — **kept as emoji, intentionally.** 🍳🥙🍲🍯 read as
food, are culturally warm and colorful in a way monochrome icons are not. Structural
chrome gets crisp icons; food stays appetizing.

**Inline icons** (back chevrons, close, chevron-right, etc.) route through `Icon.tsx`
opportunistically as each screen is touched for the `PressableScale` swap — no separate
sweep.

## Onboarding first-impression redesign (11:00)

Fixes a real risk: the first frame currently depends on a remote Unsplash photo.

- **Sunny greets you** — slide 1 opens with the `wave` pose animating in, offline-safe;
  no network gamble on the opening frame.
- **Crafted transitions** — keep the `ScrollView` paging; add parallax drift on slide
  art, page dots that grow to a pill on active (not hard on/off), and a `selection()`
  haptic on each page change.
- **A dedicated COD trust slide** — "Pay cash when it arrives — no card needed." The most
  important tourist trust message; Sunny `cheer`s here.
- **"Get started" CTA** is a `PressableScale` (`press` haptic) → the app's first tap
  feels alive.
- **Language picker kept**; each locale tap gets a `selection()` haptic.
- **Unchanged:** zero-friction anonymous guest entry (`onboarding.tsx:70`). Remote food
  photos may remain as a secondary layer on later slides; slide 1 must render instantly
  offline.

## Design-taste checklist (8:56)

`docs/design/DESIGN-TASTE-CHECKLIST.md` — a pre-merge QA gate distilling all 9
principles into yes/no checks:

- Does every tappable element scale + buzz (`PressableScale`)?
- Does every empty state have Sunny + encouraging (non-error) copy?
- Do active nav items change icon weight?
- Does the first frame render offline?
- Is there an emotional payoff at each success moment?
- Is the copy human, not technical?
- (Habit) Studied comparable apps on Mobbin before shipping a new screen?

## Data flow

No backend / schema changes. All state is local:

- Celebration signal: the `?celebrate=1` URL param (consumed + cleared on the order
  screen). No store, no persistence.
- Haptics: fire-and-forget through the existing crash-safe wrapper.
- Reduced-motion: read once per animated mount via `AccessibilityInfo`.
- i18n: new keys (celebration copy, empty-state copy, onboarding COD slide) added across
  all 5 existing locales.

## Error handling

- **Haptics never crash the app** — the existing `safeHaptic` sync-try/catch +
  async-catch wrapper is the single choke point; all haptics go through it.
- **Mascot / SVG** render is pure and local — no failure surface (no network, no async).
- **Celebration** is best-effort delight: if the `celebrate` param is absent or the
  order screen mounts without it, nothing plays — the tracking view renders normally.
- **Reduced-motion** and **web** (`Platform.OS === 'web'`) degrade gracefully:
  static visuals, no haptics.

## Testing

- **Unit (Vitest, already configured):** `PressableScale` reduced-motion branch and
  `haptic="none"` path; `Icon` outline↔filled name resolution given `active`.
- **Visual (in-app):** `Mascot` poses, `EmptyState`, `OrderCelebration` sequence, and
  onboarding — validated by running the app (not unit-tested; they are visual).
- **Regression:** haptics remain crash-safe (existing guarantee); tab routing / cart &
  unread badges in `TabBar.tsx` unchanged by the icon swap.
- **Manual QA gate:** the design-taste checklist above, run before merge.

## Out of scope

- Driver / restaurant / admin / merchant apps (customer only).
- Backend, schema, or RPC changes.
- New dependencies (everything uses already-installed packages).
- Cuisine-chip emoji (kept intentionally).
- A new store binary (this is OTA).

## Rollout

1. Build primitives (`PressableScale`, `Mascot`+`poses`, `Confetti`, `EmptyState`,
   `OrderCelebration`, extended `Icon`) with their unit tests.
2. Wire app-wide: `Pressable`→`PressableScale` swaps; empty states → `EmptyState`;
   tab bar + inline icons → `Icon`.
3. Celebration into checkout redirect + order screen.
4. Onboarding redesign.
5. Add i18n keys (5 locales); write the design-taste checklist.
6. `tsc` clean + Vitest green + manual QA checklist → PR → EAS OTA Update.
