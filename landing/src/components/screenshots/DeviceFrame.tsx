import type { ReactNode } from "react";
import styles from "../../app/screenshots/screenshots.module.css";

/**
 * The dark iPhone bezel. Ported from the design's
 * `<div class="device"><div class="screen">…</div></div>` wrapper.
 *
 * `children` is a full screen (status bar + app content) — the screen
 * components include their own <StatusBar/>, matching the original where
 * each screenXxx() string began with statusbar().
 */
export function DeviceFrame({ children }: { children: ReactNode }) {
  return (
    <div className={styles.device}>
      <div className={styles.screen}>{children}</div>
    </div>
  );
}
