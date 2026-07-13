/**
 * Legal links for the restaurant (merchant) app.
 *
 * The real pages live on the marketing site (Next.js) and are the single source
 * of truth. Restaurants get the RESTAURANT-specific privacy variant. We open
 * them with react-native Linking (already the app's link pattern — see
 * ContactButtons.tsx), so no new native dependency is added.
 */
import { Linking } from 'react-native';

const LEGAL_BASE = 'https://sharmeats.online';

export const LEGAL_URLS = {
  terms: `${LEGAL_BASE}/terms`,
  privacy: `${LEGAL_BASE}/privacy-restaurant`,
} as const;

/** Open a legal page in the system browser. Best-effort — never throws. */
export async function openLegal(url: (typeof LEGAL_URLS)[keyof typeof LEGAL_URLS]): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch {
    /* opening the browser is best-effort; never crash a screen over it */
  }
}
