/**
 * iOS notch + status bar for the App Store screenshot posters.
 *
 * The signal / wifi / battery glyphs are drawn as inline SVG (not an icon font)
 * so they are pixel-exact and unmistakably *iOS* — Apple App Review rejected an
 * earlier set under Guideline 2.3.10 because the generic Phosphor icon-font
 * glyphs read as a non-iOS (Android) status bar. SVG also removes a CDN
 * icon-font dependency from the captured image, so the bar can never render
 * differently between preview and export.
 *
 * The `.notch` / `.statusbar` layout classes live in screenshots.module.css;
 * the icons inherit `currentColor` from `.statusbar .r` (white).
 */
export function StatusBar({ time = "9:41" }: { time?: string }) {
  return (
    <>
      <div className="notch" />
      <div className="statusbar">
        <span className="t">{time}</span>
        <span className="r" aria-hidden>
          <IosCellular />
          <IosWifi />
          <IosBattery />
        </span>
      </div>
    </>
  );
}

/** iOS cellular signal: four rounded bars, ascending height, all filled. */
function IosCellular() {
  // viewBox 18×12; bars get taller left→right (the iOS pattern, vs Android's
  // triangle-of-dots). Rendered at 36px row height to match the status bar.
  return (
    <svg width="34" height="24" viewBox="0 0 18 12" fill="currentColor" role="presentation">
      <rect x="0" y="8" width="3" height="4" rx="1" />
      <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
      <rect x="10" y="3" width="3" height="9" rx="1" />
      <rect x="15" y="0" width="3" height="12" rx="1" />
    </svg>
  );
}

/** iOS Wi-Fi: three nested arcs over a dot. */
function IosWifi() {
  return (
    <svg width="32" height="24" viewBox="0 0 16 12" fill="none" role="presentation">
      <path
        d="M8 2.4c2.7 0 5.2 1.05 7 2.85l-1.5 1.5C12 5.4 10.1 4.6 8 4.6S4 5.4 2.5 6.75L1 5.25C2.8 3.45 5.3 2.4 8 2.4Z"
        fill="currentColor"
      />
      <path
        d="M8 6.1c1.55 0 3 .6 4.1 1.6l-1.55 1.55C9.9 8.65 9 8.3 8 8.3s-1.9.35-2.55.95L3.9 7.7C5 6.7 6.45 6.1 8 6.1Z"
        fill="currentColor"
      />
      <circle cx="8" cy="10.4" r="1.4" fill="currentColor" />
    </svg>
  );
}

/** iOS battery: rounded body + terminal nub + near-full fill. */
function IosBattery() {
  return (
    <svg width="44" height="22" viewBox="0 0 26 13" fill="none" role="presentation">
      {/* Outline */}
      <rect
        x="0.6"
        y="0.6"
        width="22"
        height="11.8"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.1"
        opacity="0.5"
      />
      {/* Terminal nub */}
      <path d="M24.2 4.2v4.6c.95-.4.95-4.2 0-4.6Z" fill="currentColor" opacity="0.5" />
      {/* Fill */}
      <rect x="2.1" y="2.1" width="17.5" height="8.8" rx="1.6" fill="currentColor" />
    </svg>
  );
}
