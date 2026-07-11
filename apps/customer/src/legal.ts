/**
 * Legal links + Terms-of-Service versioning for the customer app.
 *
 * The real legal pages are hosted on the marketing site (Next.js) and are the
 * single source of truth — the app just links out to them via
 * expo-web-browser's in-app browser. Keep these paths in sync with
 * landing/src/app/{terms,privacy}/page.tsx.
 */
import * as WebBrowser from 'expo-web-browser';

const LEGAL_BASE = 'https://sharmeats.online';

export const LEGAL_URLS = {
  terms: `${LEGAL_BASE}/terms`,
  // Customer-facing privacy policy (driver/restaurant apps use their own variants).
  privacy: `${LEGAL_BASE}/privacy`,
} as const;

/**
 * The Terms of Service version the app currently presents. Bump this string
 * (and the marketing site's terms) whenever the Terms materially change — a
 * signed-in user whose recorded acceptance != this value is re-prompted with the
 * consent checkpoint. Date-stamp form keeps it human-auditable and monotonic.
 */
export const CURRENT_TERMS_VERSION = '2026-07-11';

/** Open a legal page in the in-app browser. Errors are swallowed (best-effort). */
export async function openLegal(url: (typeof LEGAL_URLS)[keyof typeof LEGAL_URLS]): Promise<void> {
  try {
    await WebBrowser.openBrowserAsync(url);
  } catch {
    /* opening the browser is best-effort; never crash a screen over it */
  }
}
