'use client';

import { useSearchParams } from 'next/navigation';
import Script from 'next/script';
import { SHOTS } from '../../components/screenshots/config';
import { Poster } from '../../components/screenshots/Poster';
import styles from './screenshots.module.css';

// Preview scale: each poster is rendered at full 1320×2868 then scaled.
const Z = 0.3;

/**
 * Client half of the screenshots page. Reads `?export=N` / `?ipad=1` via
 * useSearchParams so the route stays statically exportable (a server component
 * awaiting searchParams breaks `output: "export"`); the query is resolved in
 * the browser instead, which is exactly when the capture tooling needs it.
 */
export function ScreenshotsView({ fontClass }: { fontClass: string }) {
  const params = useSearchParams();
  const exportRaw = params.get('export');
  const exportIdx = exportRaw != null ? Number(exportRaw) : null;
  const isExport =
    exportIdx != null && Number.isInteger(exportIdx) && exportIdx >= 0 && exportIdx < SHOTS.length;
  const ipadRaw = params.get('ipad');
  const isIpad = ipadRaw === '1' || ipadRaw === 'true';

  const rootClass = [styles.root, isIpad ? styles.ipad : '', fontClass].filter(Boolean).join(' ');
  const exportDims = isIpad ? { width: 2064, height: 2752 } : { width: 1320, height: 2868 };

  return (
    <div className={rootClass}>
      {/* Phosphor icon-font — every <i className="ph-* …"/> in the screens depends on it. */}
      <Script src="https://unpkg.com/@phosphor-icons/web@2.1.1" strategy="beforeInteractive" />

      {isExport ? (
        <div style={{ width: exportDims.width, height: exportDims.height, overflow: 'hidden' }}>
          <Poster shot={SHOTS[exportIdx]} index={exportIdx} z={1} />
        </div>
      ) : (
        <>
          <div className={styles.wrap}>
            {SHOTS.map((shot, i) => (
              <Poster key={i} shot={shot} index={i} z={Z} />
            ))}
          </div>
          <div className={styles.footerNote}>
            Sharm Eats — App Store set · iPhone 6.9″ (1320 × 2868)
          </div>
        </>
      )}
    </div>
  );
}
