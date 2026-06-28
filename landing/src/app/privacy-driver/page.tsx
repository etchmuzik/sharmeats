import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Driver Privacy Policy — Sharm Eats',
  description:
    'How the Sharm Eats Driver app collects, uses, and protects driver and customer information, including live location shared with customers while you are on a delivery.',
};

// Static "last updated" — bump by hand when the policy materially changes.
const LAST_UPDATED = 'June 28, 2026';

/**
 * Privacy Policy for the Sharm Eats Driver app (eg.sharmeats.driver).
 *
 * Mirrors the Google Play Data Safety form and the in-app disclosure: the
 * driver app collects precise location only while the app is open and a
 * delivery is in progress (foreground-only — it stops when the app is closed or
 * backgrounded), and shares the driver's live position with the customer for
 * real-time tracking. It also surfaces the customer's contact and delivery
 * details to the driver solely so the assigned order can be completed. No ads,
 * no analytics SDKs, no payment-card data. Keep the three artifacts — this
 * policy, the in-app disclosure, and the Play Data Safety form — in sync:
 * Precise location = Collected + Shared (to the customer), purpose = App
 * functionality.
 */
export default function PrivacyDriverPage() {
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
          Driver Privacy Policy
        </h1>
        <p className="mt-2 text-sm text-ink/50">Last updated: {LAST_UPDATED}</p>

        <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-ink/80">
          <section>
            <p>
              Sharm Eats (&ldquo;we&rdquo;, &ldquo;us&rdquo;) operates a food and
              shop delivery service in Sharm el-Sheikh, Egypt. This policy covers
              the <strong>Sharm Eats Driver</strong> app, which our delivery
              drivers use to receive jobs, navigate to restaurants and customers,
              and complete deliveries. It explains what the driver app collects,
              why, and the choices you have. It is separate from our{' '}
              <Link
                href="/privacy"
                className="font-medium text-accent hover:underline"
              >
                customer Privacy Policy
              </Link>
              . We collect only what is needed to dispatch and deliver orders. We
              do not sell personal information, and we do not use it to track you
              across other companies&rsquo; apps or websites.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">
              Information we collect about you (the driver)
            </h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                <strong>Account &amp; profile</strong> — your account identifier,
                name, vehicle details, verification status, online/offline
                availability, and your driver rating, so we can sign you in,
                dispatch nearby orders to you, and show you to customers.
              </li>
              <li>
                <strong>Precise location (during deliveries)</strong> — while you
                are on an active delivery and the app is open, it collects your
                precise GPS location so the customer can track you. Collection
                starts when you pick up an order and stops automatically when the
                order is delivered, cancelled, or rejected. It is{' '}
                <em>foreground only</em>: the app does not collect your location
                in the background when it is closed or not in use, and it does{' '}
                <em>not</em> track you when you are offline or not handling an
                order. See &ldquo;Live location&rdquo; below for how this is
                shared.
              </li>
              <li>
                <strong>Earnings information</strong> — daily earnings totals and
                cash-on-delivery amounts you collect, so we can show your
                earnings summary and reconcile payouts.
              </li>
              <li>
                <strong>Basic identifiers &amp; device data</strong> — an account
                identifier and standard technical data (such as app version and
                IP address from sign-in and connection logs) needed to operate
                the app reliably and prevent abuse.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">
              Live location shared with the customer
            </h2>
            <p className="mt-3">
              During an active delivery, your live location is{' '}
              <strong>shared in real time with the customer</strong> who placed
              the order, so they can see your position on a map and know when to
              expect you. This sharing happens only while the delivery is in
              progress and ends as soon as the order is completed or cancelled.
              We use your precise location for two purposes: assigning you nearby
              deliveries, and powering real-time delivery tracking and navigation.
              We do not use your location for advertising or cross-app tracking.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">
              Customer information the app shows you
            </h2>
            <p className="mt-3">
              To complete an assigned delivery, the app shows you the
              customer&rsquo;s <strong>delivery address</strong> (hotel and room,
              building, apartment, beach location, landmarks, and any handoff
              instructions) and the <strong>order details</strong> (items,
              quantities, and the amount to collect for cash orders). The
              customer&rsquo;s <strong>phone number</strong> is also made
              available to the app so you can contact them about the delivery
              when needed. This information is provided solely so you can
              complete the order assigned to you. Please use it only for that
              purpose, do not share it, and do not keep it after the delivery is
              done.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">How we use it</h2>
            <p className="mt-3">
              To dispatch nearby orders to you, route you to the restaurant and
              customer, share your live position with the customer during a
              delivery, track your earnings and cash collected, and keep the
              service secure and working. That&rsquo;s it — we don&rsquo;t use
              your information for advertising or cross-app tracking, and the
              driver app contains no third-party advertising or analytics
              software.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">Who we share it with</h2>
            <p className="mt-3">
              Only as needed to run deliveries: your live location and driver
              profile are shared with the <strong>customer</strong> during an
              active delivery as described above. We use{' '}
              <strong>Supabase</strong> (secure backend and database) as a
              service provider that processes data on our behalf and serves all
              data over encrypted (HTTPS/TLS) connections. The driver app does
              not handle card payments and contains no payment-card data. We may
              disclose information if required by law. We do not sell your data.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">Data retention</h2>
            <p className="mt-3">
              Live location points streamed to the customer are ephemeral and are
              not stored as history; we keep only your most recent position while
              you are active, for dispatch. We keep account, earnings, and
              delivery records for as long as your driver account is active and as
              needed for legal, accounting, and dispute-resolution purposes, after
              which they are deleted or anonymized.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">Your choices &amp; rights</h2>
            <p className="mt-3">
              The app asks for the location permission before any location is
              collected, and explains that your live location is shared with the
              customer while you deliver. You can manage or revoke the location
              permission at any time in your device settings; however, location
              is required to receive and complete deliveries, so the driver app
              cannot function without it.
            </p>
            <p className="mt-3">
              You can request deletion of your driver account and personal data,
              or request access to or correction of your information, by
              contacting us at the address below. We will respond as required by
              applicable law. For legal and tax reasons we retain a record of
              completed deliveries and earnings, but we remove information that
              identifies you so the records can no longer be linked to you.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">Children</h2>
            <p className="mt-3">
              The Sharm Eats Driver app is intended for adult delivery drivers and
              is not directed at children under 13. We do not knowingly collect
              personal information from children.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">Contact us</h2>
            <p className="mt-3">
              Questions about this policy or your data? Email{' '}
              <a
                href="mailto:privacy@sharmeats.online"
                className="font-medium text-accent hover:underline"
              >
                privacy@sharmeats.online
              </a>
              . See also our{' '}
              <Link href="/terms" className="font-medium text-accent hover:underline">
                Terms of Service
              </Link>
              .
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}
