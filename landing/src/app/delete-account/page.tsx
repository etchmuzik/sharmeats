import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Delete Your Account — Sharm Eats',
  description:
    'How to request deletion of your Sharm Eats account and associated personal data (name, phone, email, delivery addresses, and order history).',
};

// Static "last updated" — bump by hand when the process materially changes.
const LAST_UPDATED = 'July 2, 2026';

/**
 * Account & data deletion request page for the Sharm Eats customer app
 * (eg.sharmeats.customer). Linked from the Google Play Data Safety form's
 * "Delete account URL" field: Play requires a URL where a user can request
 * deletion of their account and associated data. Deletion is handled by
 * request (email) — the same path documented in the customer Privacy Policy.
 * Lists exactly what is deleted and what we may be legally required to retain,
 * so this page stays in sync with the Data Safety declaration.
 */
export default function DeleteAccountPage() {
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
          Delete your Sharm Eats account
        </h1>
        <p className="mt-2 text-sm text-ink/50">Last updated: {LAST_UPDATED}</p>

        <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-ink/80">
          <section>
            <p>
              You can ask us to delete your Sharm Eats account and the personal
              data linked to it at any time. This page explains how to make the
              request and exactly what happens to your data. It applies to the
              <strong> Sharm Eats</strong> customer app and complements our{' '}
              <Link href="/privacy" className="font-medium text-accent hover:underline">
                Privacy Policy
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">How to request deletion</h2>
            <p className="mt-3">
              Email{' '}
              <a
                href="mailto:support@sharmeats.online?subject=Delete%20my%20account"
                className="font-medium text-accent hover:underline"
              >
                support@sharmeats.online
              </a>{' '}
              from the phone number or email address on your account, with the
              subject &ldquo;Delete my account&rdquo;. So we can verify it&rsquo;s
              really you, please send the request from — or include — the mobile
              number you use to sign in. We confirm every request before acting on
              it and complete verified deletions within <strong>30 days</strong>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">What gets deleted</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>Your profile: name, mobile number, and email address.</li>
              <li>Your saved delivery addresses and drop-off preferences.</li>
              <li>Your device push-notification token.</li>
              <li>
                Your cart, favourites, and any referral or loyalty progress tied
                to your account.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">
              What we may keep, and for how long
            </h2>
            <p className="mt-3">
              We retain a minimal record of completed orders (order totals, dates,
              and payment method) where we are legally required to keep it for tax,
              accounting, and fraud-prevention purposes. These records are
              de-identified from your profile where possible and are kept only for
              the period required by Egyptian law, after which they are deleted.
              We do not sell personal information.
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
