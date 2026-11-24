import type { Metadata } from "next";
import { Suspense } from "react";
import { Sora, Plus_Jakarta_Sans, Cairo } from "next/font/google";
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
 * next/font; Phosphor icons come from the CDN icon-font.
 *
 * `?export=N` renders only poster N at full size (z=1) for native-resolution
 * capture; `?ipad=1` switches to the iPad 13″ canvas. Both are read client-side
 * (ScreenshotsView + useSearchParams) so this route stays statically
 * exportable for the Hostinger deploy.
 */

// next/font self-hosts these and exposes CSS variables that
// screenshots.module.css maps onto --font-display / --font-ui / --font-ar.
const sora = Sora({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-sora" });
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
});
const cairo = Cairo({ subsets: ["arabic", "latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-cairo" });

export const metadata: Metadata = {
  title: "Sharm Eats — App Store screenshots",
  description: "Marketing screenshot set for the Sharm Eats iOS app (iPhone 6.9″).",
  robots: { index: false, follow: false },
};

export default function ScreenshotsPage() {
  const fontClass = [sora.variable, jakarta.variable, cairo.variable].join(" ");
  return (
    <Suspense fallback={null}>
      <ScreenshotsView fontClass={fontClass} />
    </Suspense>
  );
}
