import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Delete Restaurant Staff Account — Sharm Eats',
  description:
    'How a restaurant partner can request deletion of a Sharm Eats Restaurant staff account and its associated data (work email, staff ID, device push token).',
};

// Static "last updated" — bump by hand when the process materially changes.
const LAST_UPDATED = 'July 2, 2026';

/**
 * Account & data deletion request page for the Sharm Eats Restaurant staff app
 * (eg.sharmeats.restaurant). Linked from the restaurant app's Google Play Data
 * Safety "Delete account URL" field. Staff accounts are provisioned by the
 * Sharm Eats team (no in-app self-serve sign-up), so deletion is handled by
 * request from the restaurant's authorised contact. Lists exactly what is
 * removed and what minimal audit records are retained; keep in sync with the
 * restaurant Data Safety declaration and /privacy-restaurant.
 */
export default function DeleteRestaurantAccountPage() {
  return (
    <main className="min-h-screen bg-bg">
      <header className="border-b border-black/5">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
          <Link href="/" className="text-lg font-semibold tracking-tight text-ink">
            sharmeats
          </Link>
          <Link href="/" className="text-sm text-ink/60 hover:text-ink">
            ← Home
          </Link>
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold tracking-tight text-ink">
          Delete a Sharm Eats Restaurant staff account
        </h1>
        <p className="mt-2 text-sm text-ink/50">Last updated: {LAST_UPDATED}</p>

        <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-ink/80">
          <section>
            <p>
              The <strong>Sharm Eats Restaurant</strong> app is a staff-only tool
              for partner restaurants. Staff accounts are created by the Sharm
              Eats team as part of the restaurant partnership — there is no
              in-app sign-up. This page explains how a restaurant can request
              deletion of a staff account and its data. It complements our{' '}
              <Link
                href="/privacy-restaurant"
                className="font-medium text-accent hover:underline"
              >
                Restaurant Privacy Policy
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">How to request deletion</h2>
            <p className="mt-3">
              The restaurant owner or an authorised contact should email{' '}
              <a
                href="mailto:support@sharmeats.online?subject=Delete%20restaurant%20staff%20account"
                className="font-medium text-accent hover:underline"
              >
                support@sharmeats.online
              </a>{' '}
              with the subject &ldquo;Delete restaurant staff account&rdquo; and
              the staff email address to remove. We verify the request with the
              restaurant before acting on it and complete verified deletions
              within <strong>30 days</strong>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">What gets deleted</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>The staff sign-in identity: work email address and stored credential.</li>
              <li>The staff user ID and its link to the restaurant.</li>
              <li>The device push-notification token(s) for that account.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">
              What we may keep, and for how long
            </h2>
            <p className="mt-3">
              We retain a minimal, de-identified record of order-handling actions
              (which order was accepted, prepared, or marked ready, and when)
              where it is needed for accounting, dispute resolution, and fraud
              prevention. These records are kept only for the period required and
              are not linked to the deleted staff identity. Customer order data
              shown in the app is not owned by the restaurant account and is
              governed by the customer&rsquo;s own data rights.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">Questions</h2>
            <p className="mt-3">
              For anything about restaurant data or this process, contact{' '}
              <a
                href="mailto:privacy@sharmeats.online"
                className="font-medium text-accent hover:underline"
              >
                privacy@sharmeats.online
              </a>
              . Sharm Eats, Sharm el-Sheikh, South Sinai, Egypt.
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}
