import { DeviceFrame } from "./DeviceFrame";
import type { Shot } from "./config";
import styles from "../../app/screenshots/screenshots.module.css";

/**
 * One App Store poster: gradient background + gold glow + headline block +
 * the dark device frame holding a screen. Ported from the design's per-shot
 * composition in the CONFIG.forEach render loop.
 */
export function Poster({ shot, index, z }: { shot: Shot; index: number; z: number }) {
  const { theme, eyebrow, headline, caption, rtl, Screen } = shot;

  // .shot <theme> glow [ar] — module-scoped frame classes + page-scoped
  // gradient/glow/ar classes (all in screenshots.module.css).
  const shotClass = [styles.shot, styles[theme], styles.glow, rtl ? styles.ar : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={styles.frameScale} style={{ ["--z" as string]: z }}>
      <div className={shotClass} data-screen-label={`Screenshot ${index + 1}`}>
        <div className={styles.headlineWrap} dir={rtl ? "rtl" : undefined}>
          <div className={styles.eyebrow}>{eyebrow}</div>
          <div className={styles.headline}>
            {headline.lead}
            {headline.accent ? <span className="accent">{headline.accent}</span> : null}
            {headline.tail}
          </div>
          <div className={styles.caption}>{caption}</div>
        </div>
        <DeviceFrame>
          <Screen />
        </DeviceFrame>
      </div>
    </div>
  );
}
