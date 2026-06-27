/**
 * Tiny inline-SVG icon set for the merchant dashboard.
 *
 * Replaces emoji-as-UI (📍🛵⭐ …) which renders inconsistently across
 * platforms and reads poorly to screen readers. Zero dependency (no icon
 * library / bundle cost) — just a few stroked paths. Icons paired with a text
 * label are decorative and hidden from assistive tech.
 *
 * Stroke icons use currentColor, so set color via the parent's text color.
 */
type IconName =
  | 'location'
  | 'scooter'
  | 'star'
  | 'check'
  | 'x'
  | 'clock'
  | 'utensils'
  | 'plus'
  | 'trash'
  | 'edit'
  | 'chevronRight'
  | 'back'
  | 'image';

const PATHS: Record<IconName, React.ReactNode> = {
  location: (
    <>
      <path d="M12 21s-6-5.4-6-10a6 6 0 1 1 12 0c0 4.6-6 10-6 10Z" />
      <circle cx="12" cy="11" r="2" />
    </>
  ),
  scooter: (
    <>
      <circle cx="6" cy="17" r="2.2" />
      <circle cx="17" cy="17" r="2.2" />
      <path d="M8.2 17h6.6M19 17h1.5a1.5 1.5 0 0 0 1.5-1.5V13l-3-4h-3" />
      <path d="M5 8h4l2.5 7" />
    </>
  ),
  star: <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5Z" />,
  check: <path d="M4 12.5l5 5L20 6.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  utensils: (
    <>
      <path d="M5 3v7a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V3M7 12v9" />
      <path d="M17 3c-1.7 0-3 2-3 4.5S15.3 12 17 12v9" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  trash: (
    <>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
    </>
  ),
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
    </>
  ),
  chevronRight: <path d="M9 6l6 6-6 6" />,
  back: <path d="M15 6l-6 6 6 6" />,
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M21 16l-5-5L5 20" />
    </>
  ),
};

export function Icon({
  name,
  size = 16,
  className,
  label,
}: {
  name: IconName;
  size?: number;
  className?: string;
  label?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {PATHS[name]}
    </svg>
  );
}
