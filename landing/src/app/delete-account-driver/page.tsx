import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Delete Driver Account — Sharm Eats',
  description:
    'How a Sharm Eats delivery driver can request deletion of their driver account and associated data (name, phone, vehicle, location history, device push token).',
};

// Static "last updated" — bump by hand when the process materially changes.
const LAST_UPDATED = 'July 2, 2026';

/**
 * Account & data deletion request page for the Sharm Eats Driver app
 * (eg.sharmeats.driver). Linked from the driver app's Google Play Data Safety
 * "Delete account URL" field. Driver accounts are provisioned/verified by the
 * Sharm Eats team, so deletion is handled by request. Lists exactly what is
 * removed and what minimal records are retained; keep in sync with the driver
 * Data Safety declaration and /privacy-driver.
 */
export default function DeleteDriverAccountPage() {
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
          Delete a Sharm Eats driver account
        </h1>
        <p className="mt-2 text-sm text-ink/50">Last updated: {LAST_UPDATED}</p>

        <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-ink/80">
          <section>
            <p>
              The <strong>Sharm Eats Driver</strong> app is used by delivery
              drivers who partner with Sharm Eats in Sharm el-Sheikh. Driver
              accounts are created and verified by the Sharm Eats team. This
              page explains how to request deletion of a driver account and its
              data. It complements our{' '}
              <Link
                href="/privacy-driver"
                className="font-medium text-accent hover:underline"
              >
                Driver Privacy Policy
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">How to request deletion</h2>
            <p className="mt-3">
              Email{' '}
              <a
                href="mailto:support@sharmeats.online?subject=Delete%20driver%20account"
                className="font-medium text-accent hover:underline"
              >
                support@sharmeats.online
              </a>{' '}
              with the subject &ldquo;Delete driver account&rdquo; from the phone
              number or email on your driver account, so we can verify it&rsquo;s
              really you. We confirm every request before acting on it and
              complete verified deletions within <strong>30 days</strong>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">What gets deleted</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>Your driver profile: name, mobile number, and vehicle details.</li>
              <li>Your account&rsquo;s last-known location and location history.</li>
              <li>Your device push-notification token(s).</li>
              <li>Your link between the driver profile and your sign-in identity.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">
              What we may keep, and for how long
            </h2>
            <p className="mt-3">
              We retain a minimal, de-identified record of completed deliveries
              and cash-on-delivery settlements where it is needed for accounting,
              driver-payout reconciliation, tax, and fraud prevention. These
              records are kept only for the period required by Egyptian law and
              are separated from your deleted profile where possible. We do not
              sell personal information.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">Questions</h2>
            <p className="mt-3">
              For anything about your data or this process, contact{' '}
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
