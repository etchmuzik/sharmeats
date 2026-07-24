# Sharm Eats — Design System

Source of truth for the customer/driver apps is `apps/customer/src/theme.ts`
(mirrored in the driver app). The Next.js dashboards + landing use Tailwind with
the same brand colors. This file documents the system; when you change a token,
change it in `theme.ts` (apps) or `tailwind.config` (web) too.

## Color

Warm, sunlit, coastal. Sand neutrals carry the surface; coral drives appetite
and action; Red Sea teal signals trust and calm. **Two-accent system** — coral
(`accent`) and teal (`sea`) are both first-class; most other hues are status only.

### Neutrals (warm, sand-tinted — never pure white/black)
- `bg` `#faf9f6` — app background (warm off-white)
- `bgSoft` `#f2efea`, `bgSoft2` `#f6f2ec` — raised/inset warm surfaces
- `sand` `#eee8de`, `sand2` `#e4dccf` — section bands, chips
- `ink` `#141210` — primary text (near-black, faintly warm)
- `ink2` `#554f49` — secondary text, 7.9:1 on cards
- `ink3` `#706a64` — tertiary / placeholder, 5.2:1 on cards
- `line` `#e8e3d4`, `line2` `#dad3bf` — borders/dividers (sand-tinted)
- `white` `#fffdfa` — cards/inputs only (warm near-white, never pure white)

### Accents (the two carriers)
- `accent` `#c8452f` (coral) — primary CTAs, active nav, food energy, selection;
  it keeps white button text at WCAG AA contrast.
  `accentDark` `#963222` (pressed), `accentSoft` `#fbeae4` (tint backgrounds).
- `sea` `#0e7c91` (Red Sea teal) — trust, tracking, verification, info, the
  driver app's identity color. `seaSoft` `#dff0f3` (tint).

### Status (use only for their meaning)
- `green`/`greenSoft` success · `red`/`redSoft` error/destructive ·
  `amber`/`amberSoft` warning · `blue`/`blueSoft` info-neutral ·
  `star` `#e8a317` ratings.

### Color strategy
Customer app = **Restrained-plus**: warm neutral surface, coral as the ≤10%
action accent, teal as a second deliberate trust accent. Not single-accent
Restrained (teal earns its place), not Committed (no single color owns 30%+).
Food photography supplies the saturation; the chrome stays calm so food pops.

> Migration note: tokens are hex today. New work may express color in OKLCH and
> reduce chroma near the extremes, but match the existing palette's hues.

## Typography

- Apps: system font (SF Pro on iOS) for UI; **Cairo** for Arabic. Landing uses
  Sora (display) / Plus Jakarta Sans (UI) / Cairo (Arabic).
- Scale (`font.sizes`, in pt): xs `12`, base `15`, lg `16`, xl `17`, 2xl `18`,
  up through display 9xl `34` / 10xl `40` / 11xl `48`. Steps are fine-grained — when
  building hierarchy pick steps ≥1.25 apart (e.g. body `15` → heading `22`/`28`),
  don't stack adjacent sizes.
- Weights: `regular 400` body, `semibold 600`/`bold 700` labels+headings,
  `extrabold 800`/`black 900` for screen titles and prices. Hierarchy comes from
  weight × scale contrast, not color alone.
- Arabic: render Eastern-Arabic numerals where culturally expected (prices in
  Arabic-locale contexts, addresses); keep Latin numerals in EN.

## Spacing & Radius

- `spacing` (pt): xs 4, sm 8, md 12, lg 16, xl 20, xxl 24, xxxl 32, huge 48.
  Vary it for rhythm — screen padding `xl`/`xxl`, tight chip gaps `sm`.
- `radius` (pt): sm 8, md 12, lg 14, xl 16, xxl 18, xxxl 24, pill 999. Cards/
  sheets lean `xl`–`xxxl` (soft, friendly); chips/pills use `pill`.

## Elevation

Three shadow tiers in `theme.ts`, all low-opacity (soft, daylight, not heavy):
- `shadow.soft` — list items, subtle lift (opacity .05, r8).
- `shadow.card` — featured cards, sheets (opacity .10, r16).
- `shadow.accentGlow` — coral glow for the primary CTA / hero only (opacity .30).
  Use sparingly; it's a spotlight, not a default.

## Components & conventions

- `PrimaryButton` (coral, pill, optional accentGlow), `BackButton` (sand circle,
  uses `useGoBack` guard), `FlagBadge` (dietary: Halal/Tourist-safe/etc.),
  `QuantityStepper`, `ModifierGroup`, `AllergyChipRow`.
- **MV / no-ViewModels** (per repo CLAUDE.md): screens are pure SwiftUI-style
  state expressions in React; logic lives in `src/data` repositories + zustand
  stores (`src/store`). Keep components small and focused.
- RTL: only the Arabic screen wrappers set `dir="rtl"`; layout must mirror, not
  just translate.

## Motion

- Ease-out, no bounce/elastic. Don't animate layout props (use transform/opacity).
- Haptics are part of the motion language: `selection`/`tap`/`success` from
  `src/haptics` fire on meaningful interactions (add to cart, place order, pin
  set). Keep them purposeful.

## Absolute bans (from impeccable shared laws)

No side-stripe borders, no gradient text, no decorative glassmorphism, no
hero-metric template, no identical-card-grid monotony, no modal-as-first-thought,
no em dashes in copy.
