import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Restaurant Privacy Policy — Sharm Eats',
  description:
    'How the Sharm Eats Restaurant app collects, uses, and protects restaurant staff information and the customer order details shown to your kitchen.',
};

// Static "last updated" — bump by hand when the policy materially changes.
const LAST_UPDATED = 'July 2, 2026';

/**
 * Privacy Policy for the Sharm Eats Restaurant app (eg.sharmeats.restaurant).
 *
 * Mirrors the Google Play Data Safety form: the restaurant app collects a staff
 * member's email (account sign-in), staff user ID, and a device push token so
 * new orders can buzz the kitchen tablet. It displays customer order details
 * (items, kitchen notes, delivery address snapshot) to the restaurant solely so
 * the order can be prepared — the app does NOT collect location, does not fetch
 * customer phone numbers, and carries no ads or analytics SDKs. Keep this
 * policy and the Play Data Safety form in sync.
 */
export default function PrivacyRestaurantPage() {
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
          Restaurant Privacy Policy
        </h1>
        <p className="mt-2 text-sm text-ink/50">Last updated: {LAST_UPDATED}</p>

        <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-ink/80">
          <section>
            <p>
              Sharm Eats (&ldquo;we&rdquo;, &ldquo;us&rdquo;) operates a food and
              shop delivery service in Sharm el-Sheikh, Egypt. This policy covers
              the <strong>Sharm Eats Restaurant</strong> app, which partner
              restaurants use to receive incoming orders, accept or reject them,
              and update kitchen progress until an order is ready for pickup. It
              explains what the restaurant app collects, why, and the choices you
              have. It is separate from our{' '}
              <Link href="/privacy" className="font-medium text-accent hover:underline">
                customer Privacy Policy
              </Link>{' '}
              and our{' '}
              <Link href="/privacy-driver" className="font-medium text-accent hover:underline">
                driver Privacy Policy
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">What we collect from you</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                <strong>Staff account details.</strong> Your work email address
                and a password (stored as a secure hash by our infrastructure
                provider), your staff role, and the restaurant your account is
                linked to. Accounts are created by the Sharm Eats team as part of
                the restaurant partnership — the app has no self-serve sign-up.
              </li>
              <li>
                <strong>A device push token.</strong> If you allow notifications,
                we store an app-scoped push token for your device so a new order
                can alert your kitchen tablet or phone the moment it arrives. The
                token is removed when you sign out.
              </li>
              <li>
                <strong>Order actions.</strong> When you accept, reject, or
                advance an order (preparing, ready), that action is recorded
                against your staff account in the order&rsquo;s audit history so
                order handling stays accountable.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">
              Customer information the app shows you
            </h2>
            <p className="mt-3">
              To prepare an order, the app displays the order&rsquo;s items,
              quantities, kitchen notes and allergy notes, the order total and
              payment method, and a delivery address summary (for example a hotel
              name and room number). This information belongs to the customer and
              is shown to your restaurant solely so the order can be fulfilled.
              It must not be copied, retained outside the app, or used for any
              other purpose. The restaurant app does not show customer phone
              numbers.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">What we do not collect</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>No location data — the app never requests your device location.</li>
              <li>No advertising identifiers, no ads, and no third-party analytics SDKs.</li>
              <li>No payment-card data — cash settlement and card processing happen outside this app.</li>
              <li>No contacts, photos, files, microphone, or camera access.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">How we use this information</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>Deliver incoming orders to your queue in real time and notify you of new ones.</li>
              <li>Record who accepted, rejected, or progressed each order (audit and dispute handling).</li>
              <li>Keep customers informed — your status updates (accepted, preparing, ready) drive the customer&rsquo;s live order tracking.</li>
              <li>Operate, secure, and improve the Sharm Eats platform.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">Sharing and processors</h2>
            <p className="mt-3">
              We do not sell personal information. Data is processed by{' '}
              <strong>Supabase</strong> (our database and authentication
              provider) and <strong>Expo</strong> (push notification delivery),
              acting as processors on our behalf. Your order-handling actions are
              visible to Sharm Eats operations staff and, as status updates, to
              the customer who placed the order.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">Security and retention</h2>
            <p className="mt-3">
              All traffic between the app and our servers is encrypted in transit
              (HTTPS/TLS), and database access is restricted with row-level
              security so your account can only see your own restaurant&rsquo;s
              orders. Staff accounts and order history are retained for as long
              as the restaurant partnership is active and as needed for
              bookkeeping and dispute resolution.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">Your choices</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                <strong>Notifications</strong> can be disabled in your device
                settings at any time (you&rsquo;ll then need to check the app for
                new orders manually).
              </li>
              <li>
                <strong>Account removal.</strong> To deactivate a staff account
                or request deletion of personal information, email{' '}
                <a
                  href="mailto:support@sharmeats.online"
                  className="font-medium text-accent hover:underline"
                >
                  support@sharmeats.online
                </a>{' '}
                from the account&rsquo;s email address. We may retain records we
                are legally required to keep.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">Changes and contact</h2>
            <p className="mt-3">
              We will update this page when the policy changes and bump the date
              above. Questions? Contact{' '}
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
