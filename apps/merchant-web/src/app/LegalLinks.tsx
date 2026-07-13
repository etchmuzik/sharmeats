/**
 * Footer legal links to the live Terms of Service and (restaurant-variant)
 * Privacy Policy on the marketing site. Opens in a new tab with
 * rel="noopener noreferrer". Drop into the login page and dashboard footer.
 */
const LEGAL_BASE = 'https://sharmeats.online';

const LINKS = [
  { label: 'Terms of Service', href: `${LEGAL_BASE}/terms` },
  { label: 'Privacy Policy', href: `${LEGAL_BASE}/privacy-restaurant` },
] as const;

export function LegalLinks({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-3 text-xs text-ink3 ${className}`}>
      {LINKS.map((link, i) => (
        <span key={link.href} className="flex items-center gap-3">
          {i > 0 && <span aria-hidden>·</span>}
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium hover:text-accent hover:underline"
          >
            {link.label}
          </a>
        </span>
      ))}
    </div>
  );
}
