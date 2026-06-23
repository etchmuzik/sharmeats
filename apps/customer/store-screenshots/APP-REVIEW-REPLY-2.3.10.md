# App Review reply — Guideline 2.3.10 (non-iOS status bar in screenshots)

Submission ID: 97bcbf3c-0e20-48e5-a1af-f6c89d87e289
Version: 1.0 (22) · Rejected June 14, 2026 · Reviewed on iPad Air 11-inch (M3)

This is a **metadata-only** fix — no binary change is required. The flagged
content was the **status bar drawn into the marketing screenshots**, which used
generic icons that read as a non-iOS (Android) status bar. We regenerated all
screenshots with an authentic iOS status bar.

---

## Paste into App Store Connect → reply to App Review

> Thank you for the review.
>
> We understand the issue under Guideline 2.3.10: our uploaded screenshots
> showed a status bar (top-right signal/battery icons) that did not match iOS.
> This was an artwork issue in our screenshot template, not app functionality —
> the app itself uses the standard iOS system status bar.
>
> We have replaced **all** screenshots, for **both** iPhone (6.9") and iPad
> (13"), with new images that use an accurate iOS status bar (iOS cellular,
> Wi-Fi, and battery indicators). The screenshots otherwise accurately reflect
> the app in use and highlight its main features. No third-party platform is
> referenced anywhere in the app or its metadata.
>
> The updated screenshots are uploaded to this version. Please re-review at your
> convenience — thank you.

---

## What we changed (for our own record)

1. **Root cause:** the screenshot generator's status-bar component
   (`landing/src/components/screenshots/StatusBar.tsx`) rendered the
   signal/battery glyphs with a generic icon font, which Apple's reviewer read
   as an Android status bar.
2. **Fix:** replaced those glyphs with inline-SVG iOS indicators (iOS cellular
   bars, Wi-Fi arc, rounded iOS battery). The notch is hidden on the iPad
   variant (iPads have no notch).
3. **Regenerated both required sizes** at native resolution:
   - iPhone 6.9" — 2064×2752 → `store-screenshots/iphone69-ios-statusbar/` (1320×2868)
   - iPad 13" — `store-screenshots/ipad13-ios-statusbar/` (2064×2752)

## Upload checklist (App Store Connect → this version → Previews and Screenshots)

- [ ] Select **iPhone 6.9" Display** → "View All Sizes in Media Manager" →
      delete the old images → upload the 6 from `iphone69-ios-statusbar/`.
- [ ] Select **iPad 13" Display** → delete the old images → upload the 6 from
      `ipad13-ios-statusbar/`. (This is the set the reviewer tested on iPad —
      do not skip it.)
- [ ] Confirm no other device size still shows the old status bar.
- [ ] Save → reply to App Review with the message above → resubmit (no new build
      needed; the same binary 1.0 (22) can be re-reviewed with updated metadata).

## Note

App Store accepts PNG or JPG. These are PNG at native resolution. If App Store
Connect rejects the file size, re-export as JPG (quality ~90) — the dimensions
are already correct (1320×2868 / 2064×2752).
