/**
 * iOS notch + status bar. Ported from the design's `statusbar(time)` helper.
 * Renders the pill notch and the time / signal / wifi / battery row using
 * the Phosphor icon font (loaded via next/script in the page).
 *
 * The `.notch` / `.statusbar` classes live in screenshots.module.css.
 */
export function StatusBar({ time = "9:41" }: { time?: string }) {
  return (
    <>
      <div className="notch" />
      <div className="statusbar">
        <span className="t">{time}</span>
        <span className="r">
          <i className="ph-fill ph-cell-signal-full" />
          <i className="ph-fill ph-wifi-high" />
          <i className="ph-fill ph-battery-full" />
        </span>
      </div>
    </>
  );
}
