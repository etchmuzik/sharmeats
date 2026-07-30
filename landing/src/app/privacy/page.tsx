import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy — Sharm Eats',
  description:
    'How Sharm Eats collects, uses, and protects your information when you order food delivery in Sharm el-Sheikh.',
};

// Static "last updated" — bump by hand when the policy materially changes.
const LAST_UPDATED = 'July 30, 2026';

/**
 * Privacy Policy for the Sharm Eats apps + site.
 *
 * Mirrors the App Store "App Privacy" answers and the App Review notes: we
 * collect only what an order needs (contact, delivery address + optional GPS
 * pin, basic identifiers), never sell data, and don't use it for cross-app
 * tracking. Keep this in sync with the App Store Connect data-collection
 * questionnaire.
 *
 * 2026-07-30 — two corrections, both of which had made this document WRONG
 * about live behaviour, which for a privacy policy is the failure that matters:
 *
 *  1. PAYMOB IS NOT A PROCESSOR TODAY. Card checkout is dark in production
 *     (`EXPO_PUBLIC_PAYMENTS_CARD_ENABLED=false`, apps/customer/eas.json), so
 *     no card is ever entered and no data reaches Paymob — yet this page named
 *     it as a live sub-processor and told users their card went to a third
 *     party. Naming a processor that receives nothing is not a harmless
 *     over-disclosure: it is an untrue statement about where data goes. When
 *     card is switched on, restore the Paymob paragraphs AND this comment.
 *  2. SHARE LINKS WERE UNDISCLOSED. Migration 195 lets a customer mint an
 *     unguessable link that shows a stranger the courier's live position, name,
 *     vehicle and rating. Whatever the customer chooses to do with that link,
 *     the policy has to say the capability exists before they use it.
 */
export default function PrivacyPage() {
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
        <h1 className="text-3xl font-bold tracking-tight text-ink">Privacy Policy</h1>
        <p className="mt-2 text-sm text-ink/50">Last updated: {LAST_UPDATED}</p>

        <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-ink/80">
          <section>
            <p>
              Sharm Eats (&ldquo;we&rdquo;, &ldquo;us&rdquo;) operates a food and
              shop delivery service in Sharm el-Sheikh, Egypt, through our mobile
              app and website. This policy explains what we collect, why, and your
              choices. We collect only what is needed to take and deliver your
              order. We do not sell your personal information, and we do not use it
              to track you across other companies&rsquo; apps or websites.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">Information we collect</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                <strong>Contact details</strong> — your name and phone number, so
                the restaurant and driver can reach you about your order.
              </li>
              <li>
                <strong>Delivery address</strong> — the hotel and room, apartment,
                or beach location you choose, and an optional precise GPS pin you
                add so the driver can find you. Location is requested only when you
                add an address; it is never collected in the background.
              </li>
              <li>
                <strong>Order information</strong> — the items you order, notes to
                the kitchen, and your order history.
              </li>
              <li>
                <strong>Payment information</strong> — Sharm Eats is{' '}
                <strong>cash on delivery</strong>. You pay the driver when your
                order arrives, so we never ask for and never hold card details.
                We record the amount due and whether it was collected, so the
                order can be reconciled. If we add card payment later, it will be
                handled by a licensed payment provider on their own checkout and
                this policy will be updated before that happens.
              </li>
              <li>
                <strong>Basic identifiers &amp; device data</strong> — an account
                identifier and standard technical data needed to operate the app
                reliably and prevent abuse.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">How we use it</h2>
            <p className="mt-3">
              To take, prepare, deliver, and support your orders; to send you
              order-status updates; and to keep the service secure and working.
              That&rsquo;s it — we don&rsquo;t use your information for
              advertising or cross-app tracking.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">Who we share it with</h2>
            <p className="mt-3">
              Only as needed to fulfill your order: the restaurant or shop and the
              delivery driver receive the details required to prepare and deliver
              it. We use one service provider — <strong>Supabase</strong> (secure
              backend and database) — that processes data on our behalf. We may
              disclose information if required by law. We do not sell your data.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">
              Sharing your delivery with someone else
            </h2>
            <p className="mt-3">
              If you tap <strong>Share</strong> on an order, we create a private
              web link that lets whoever you send it to follow that delivery
              without an account. Anyone holding the link can see it — so treat
              it like a key and send it only to people you mean to.
            </p>
            <p className="mt-3">
              The link shows the order&rsquo;s status, the estimated arrival
              time, and — while the courier is on the way — their live position
              on a map together with their first name, vehicle and rating. It
              deliberately does <em>not</em> show your delivery address, your
              hotel or room number, your name, your phone number, what you
              ordered, or what you paid.
            </p>
            <p className="mt-3">
              You can stop sharing at any time from the order screen, which kills
              that link immediately and permanently — sharing again mints a new
              one rather than reviving it. Links also expire on their own: the
              courier&rsquo;s position disappears the moment the order is
              delivered or cancelled, and the link stops answering altogether
              about two hours later.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">Data retention</h2>
            <p className="mt-3">
              We keep order and account information for as long as your account is
              active and as needed for legal, accounting, and dispute-resolution
              purposes, after which it is deleted or anonymized.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">Your choices &amp; rights</h2>
            <p className="mt-3">
              You can use the app as a guest without creating an account. You may
              decline the location permission and still enter an address manually.
            </p>
            <p className="mt-3">
              You can delete your account at any time directly in the app:
              open <strong>Profile → Delete account</strong> and confirm. This
              permanently removes your profile, saved addresses, payment methods,
              favourites, and notification settings, and signs you out. For legal
              and tax reasons we retain a record of completed orders, but we remove
              your name, phone, address, and location from them so they can no
              longer be linked to you.
            </p>
            <p className="mt-3">
              You can also request access to or correction of your personal
              information by contacting us at the address below; we will respond as
              required by applicable law.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">Children</h2>
            <p className="mt-3">
              Sharm Eats is intended for general audiences and is not directed at
              children under 13. We do not knowingly collect personal information
              from children.
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
