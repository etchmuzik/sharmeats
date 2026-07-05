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
