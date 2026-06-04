/**
 * Dietary-flag badges — branded mini-chips (glyph + label), colored per
 * token. The glyph SVGs are inline (copied verbatim from the design's
 * `Sharm Eats - App Store Screenshots.html`) so they stay on-brand.
 *
 * The `.flag` / `.f-*` classes live in screenshots.module.css (:global,
 * scoped under .root). These components only emit the inner SVG + label.
 */

/** Tourist-safe — shield-check glyph. */
export function TouristFlag() {
  return (
    <span className="flag f-tourist">
      <svg viewBox="0 0 24 24" fill="none">
        <path
          d="M12 3 5 5.5V11c0 4.5 3 7.7 7 9 4-1.3 7-4.5 7-9V5.5L12 3Z"
          fill="currentColor"
          opacity=".15"
        />
        <path
          d="M12 3 5 5.5V11c0 4.5 3 7.7 7 9 4-1.3 7-4.5 7-9V5.5L12 3Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="m9 11.5 2 2 4-4.2"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>{" "}
      Tourist-safe
    </span>
  );
}

/** Halal — circular crescent glyph. `label` lets the Arabic shot pass حلال. */
export function HalalFlag({ label = "Halal" }: { label?: string }) {
  return (
    <span className="flag f-halal">
      <svg viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" fill="currentColor" opacity=".15" />
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M15.5 8.5c-1.8-1-3.7.3-3.7 2.1 0 1.6 1.3 2.2 1.3 3.4 0 1-.9 1.6-1.9 1.4"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
        <circle cx="9.2" cy="9.6" r="1" fill="currentColor" />
      </svg>{" "}
      {label}
    </span>
  );
}
