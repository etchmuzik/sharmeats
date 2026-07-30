import type { Metadata } from 'next';
import TrackView from './TrackView';

export const metadata: Metadata = {
  title: 'Follow a delivery — Sharm Eats',
  description: 'Live status for a Sharm Eats delivery someone shared with you.',
  // A tracking link is personal and short-lived, and it carries its secret in
  // the query string. Keep it out of search results entirely.
  robots: { index: false, follow: false },
};

/**
 * Public "follow my order" page.
 *
 * The customer taps Share in the app, which mints an unguessable token
 * (migration 184) and drops a link here. Whoever holds the link sees a
 * deliberately minimal view — status, ETA, restaurant, courier first name, and
 * the courier's position while the order is actually moving. Never the delivery
 * address, the contents, the prices, or anyone's phone number.
 *
 * The work happens in the client component: this site is a static export, so
 * there is no server to resolve the token, and the anon key plus the
 * SECURITY DEFINER `get_shared_order` RPC are what make an anonymous read safe.
 */
export default function TrackPage() {
  return <TrackView />;
}
