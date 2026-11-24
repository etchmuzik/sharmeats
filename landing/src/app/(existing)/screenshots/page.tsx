import type { Metadata } from "next";
import { Suspense } from "react";
import "@fontsource-variable/sora/wght.css";
import "@fontsource-variable/plus-jakarta-sans/wght.css";
import "@fontsource-variable/cairo/wght.css";
import { ScreenshotsView } from "./ScreenshotsView";

/**
 * Sharm Eats — App Store Screenshots (press-kit gallery).
 *
 * Faithful port of the Claude Design handoff
 * "Sharm Eats - App Store Screenshots.html": six iPhone 6.9" (1320×2868)
 * poster compositions, dark-first, with marketing headlines, device
 * frames, real food photos, and an Arabic RTL hero.
 *
 * The dark theme is fully scoped to `.root` (screenshots.module.css) so it
 * does not affect the light marketing homepage. Fonts are self-hosted via
 * Fontsource. Phosphor icons come from the CDN icon-font.
 *
 * `?export=N` renders only poster N at full size (z=1) for native-resolution
 * capture; `?ipad=1` switches to the iPad 13″ canvas. Both are read client-side
 * (ScreenshotsView + useSearchParams) so this route stays statically
 * exportable for the Hostinger deploy.
 */

export const metadata: Metadata = {
  title: "Sharm Eats — App Store screenshots",
  description: "Marketing screenshot set for the Sharm Eats iOS app (iPhone 6.9″).",
  robots: { index: false, follow: false },
};

export default function ScreenshotsPage() {
  return (
    <Suspense fallback={null}>
      <ScreenshotsView />
    </Suspense>
  );
}
