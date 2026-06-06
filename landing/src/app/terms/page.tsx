import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service — Sharm Eats',
  description:
    'The terms that govern your use of the Sharm Eats apps and website for food and shop delivery in Sharm el-Sheikh.',
};

// Static "last updated" — bump by hand when the terms materially change.
const LAST_UPDATED = 'June 6, 2026';

/**
 * Terms of Service / EULA for the Sharm Eats apps + site.
 *
 * Sharm Eats is a marketplace: independent restaurants/shops prepare orders and
 * independent couriers (or the merchant) deliver them. We facilitate ordering,
 * payment, and dispatch — we are not the food preparer. These terms cover the
 * marketplace relationship, pricing/payment (incl. cash on delivery), the
 * late-ETA credit promised in the product, cancellations/refunds, acceptable
 * use, the app licence Apple expects, and Egyptian governing law. Keep the
 * structure in sync with /privacy.
 */
export default function TermsPage() {
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
        <h1 className="text-3xl font-bold tracking-tight text-ink">Terms of Service</h1>
        <p className="mt-2 text-sm text-ink/50">Last updated: {LAST_UPDATED}</p>

        <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-ink/80">
          <section>
            <p>
              These Terms of Service (&ldquo;Terms&rdquo;) govern your use of the
              Sharm Eats mobile apps and website (together, the
              &ldquo;Service&rdquo;), operated by Sharm Eats
              (&ldquo;we&rdquo;, &ldquo;us&rdquo;) in Sharm el-Sheikh, Egypt. By
              creating an account, placing an order, or otherwise using the
              Service, you agree to these Terms. If you do not agree, please do not
              use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">What Sharm Eats is</h2>
            <p className="mt-3">
              Sharm Eats is a <strong>marketplace</strong>. We connect you with
              independent restaurants and shops (&ldquo;Merchants&rdquo;) and with
              independent delivery couriers. The Merchant prepares your order; a
              courier — ours or the Merchant&rsquo;s — delivers it. We facilitate
              browsing, ordering, payment, and dispatch, but we do not prepare food
              and we are not the manufacturer or seller of the items. The Merchant
              is responsible for the quality, safety, ingredients, and accuracy of
              the items it prepares.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">Eligibility &amp; accounts</h2>
            <p className="mt-3">
              You must be at least 18 years old, or the age of majority where you
              live, to place an order. You can browse and order as a guest; if you
              create an account, you are responsible for keeping your login secure
              and for activity that happens under it. Provide accurate contact and
              delivery details so your order can reach you.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">Orders &amp; pricing</h2>
            <p className="mt-3">
              When you place an order it is an offer to buy the selected items.
              Prices, taxes, and the delivery fee are shown before you confirm and
              are calculated by us at the time of ordering — the price you are
              charged is the one computed and displayed at checkout. Item
              availability and Merchant operating hours can change; if a Merchant
              cannot fulfil an order, we will notify you and arrange a refund for
              any amount paid.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">Payment</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                <strong>Cash on delivery</strong> — you pay the courier the exact
                order total in cash when your order arrives.
              </li>
              <li>
                <strong>Card</strong> — where enabled, card payments are processed
                by <strong>Paymob</strong>, a licensed Egyptian payment provider.
                Your full card details are entered on Paymob&rsquo;s secure
                checkout and are never stored on our servers.
              </li>
            </ul>
            <p className="mt-3">
              All amounts are charged in Egyptian Pounds (EGP). Any home-currency
              figures shown (e.g. EUR, USD, GBP, RUB) are indicative only; the
              actual charge is in EGP.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">Delivery &amp; ETAs</h2>
            <p className="mt-3">
              We show an estimated delivery time for each order. Estimates are made
              in good faith but are not guarantees — traffic, weather, and Merchant
              preparation times affect them. Where we advertise a late-delivery
              credit, that credit is applied according to the terms shown in the app
              at the time of your order. You are responsible for providing an
              accurate delivery location and for being reachable so the courier can
              complete the handoff.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">Cancellations &amp; refunds</h2>
            <p className="mt-3">
              You can cancel an order before the Merchant accepts it at no charge.
              Once a Merchant has accepted and begun preparing your order, it may no
              longer be cancellable because food is made to order. If an item is
              missing, incorrect, or there is a problem with your order, contact us
              and we will work with the Merchant to make it right, which may include
              a partial or full refund. Card refunds are returned through Paymob to
              your original payment method.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">Acceptable use</h2>
            <p className="mt-3">
              Use the Service only for lawful purposes. Do not misuse it, place
              fraudulent or abusive orders, interfere with its operation, attempt to
              access it in unauthorized ways, or harass Merchants or couriers. We may
              suspend or close accounts that violate these Terms or that we
              reasonably believe are engaged in fraud or abuse.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">App licence</h2>
            <p className="mt-3">
              We grant you a personal, non-exclusive, non-transferable, revocable
              licence to use the Sharm Eats apps on devices you own or control, for
              your own non-commercial use, subject to these Terms and to the app
              store&rsquo;s terms. For apps installed from the Apple App Store, you
              acknowledge that these Terms are between you and Sharm Eats, not Apple;
              Apple is not responsible for the app or its content, and Apple is a
              third-party beneficiary entitled to enforce these Terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">Disclaimers &amp; liability</h2>
            <p className="mt-3">
              The Service is provided &ldquo;as is.&rdquo; To the fullest extent
              permitted by law, we are not liable for the acts or omissions of
              Merchants or independent couriers, for the quality or safety of items
              prepared by Merchants, or for indirect or consequential losses. Nothing
              in these Terms limits any rights you have under mandatory Egyptian
              consumer-protection law.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">Changes to these Terms</h2>
            <p className="mt-3">
              We may update these Terms from time to time. When we do, we will
              update the date above. Your continued use of the Service after changes
              take effect means you accept the updated Terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">Governing law</h2>
            <p className="mt-3">
              These Terms are governed by the laws of the Arab Republic of Egypt,
              and the courts of Egypt have jurisdiction over any dispute, without
              prejudice to any mandatory consumer rights in your place of residence.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">Contact us</h2>
            <p className="mt-3">
              Questions about these Terms? Email{' '}
              <a
                href="mailto:support@sharmeats.online"
                className="font-medium text-accent hover:underline"
              >
                support@sharmeats.online
              </a>
              . See also our{' '}
              <Link href="/privacy" className="font-medium text-accent hover:underline">
                Privacy Policy
              </Link>
              .
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}
