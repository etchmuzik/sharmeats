/**
 * Follow-my-order link construction.
 *
 * The recipient page is a route on the marketing site rather than a deep link,
 * because the whole point is that it opens for somebody who does not have the
 * app. It is a QUERY parameter, not a path segment: the landing site is a
 * Next.js static export (`output: 'export'`), and a dynamic `[token]` segment
 * would need `generateStaticParams` at build time — impossible for tokens minted
 * later.
 */
const SHARE_BASE = 'https://sharmeats.online';

/** Path of the public tracking page on the marketing site. */
export const SHARE_PATH = '/track';

/**
 * Build the shareable URL for a token.
 *
 * The token is URL-safe hex from mig 170, but it is still encoded rather than
 * interpolated raw — a helper that only works for well-formed input is one
 * schema change away from producing a broken or ambiguous link.
 */
export function shareUrlFor(token: string): string {
  return `${SHARE_BASE}${SHARE_PATH}?t=${encodeURIComponent(token)}`;
}

/**
 * Read a token back out of a share URL. Returns null when the URL is not a
 * share link or carries no token.
 *
 * Exists mainly so the round trip is testable — the app never parses its own
 * links at runtime.
 */
export function tokenFromShareUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.replace(/\/+$/, '') !== SHARE_PATH) return null;
    const token = parsed.searchParams.get('t');
    return token && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}
