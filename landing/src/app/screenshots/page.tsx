import type { Metadata } from "next";
import Script from "next/script";
import { Sora, Plus_Jakarta_Sans, Cairo } from "next/font/google";
import { SHOTS } from "../../components/screenshots/config";
import { Poster } from "../../components/screenshots/Poster";
import styles from "./screenshots.module.css";

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

// Preview scale: each poster is rendered at full 1320×2868 then scaled.
const Z = 0.3;

export default function ScreenshotsPage() {
  return (
    <div className={`${styles.root} ${sora.variable} ${jakarta.variable} ${cairo.variable}`}>
      {/* Phosphor icon-font — every <i className="ph-* …"/> in the screens depends on it. */}
      <Script src="https://unpkg.com/@phosphor-icons/web@2.1.1" strategy="beforeInteractive" />

      <div className={styles.wrap}>
        {SHOTS.map((shot, i) => (
          <Poster key={i} shot={shot} index={i} z={Z} />
        ))}
      </div>

      <div className={styles.footerNote}>
        Sharm Eats — App Store set · iPhone 6.9″ (1320 × 2868)
      </div>
    </div>
  );
}
