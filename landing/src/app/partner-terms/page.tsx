import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Partner Terms — Sharm Eats',
  description:
    'The terms a restaurant accepts when applying to sell on Sharm Eats: commission, weekly payouts, verification documents, order handling, and how either side can end the partnership.',
};

// Static "last updated" — bump by hand when the terms materially change.
// Keep in step with MERCHANT_TERMS_VERSION in apps/merchant-web/src/lib/onboarding.ts:
// the wizard stamps that version string onto restaurants.terms_version at apply time,
// so a material change here should get a NEW version string there.
const LAST_UPDATED = 'July 25, 2026';
const TERMS_VERSION = '2026-07-24-merchant-v1';

/**
 * Partner (restaurant) terms — the page linked from the merchant onboarding
 * wizard's final step, where the applicant ticks "I accept the partner terms
 * on behalf of this business".
 *
 * Every commercial number here must match the source of truth:
 *   - commission 15% standard / 12% founding cohort .... docs/FINANCIALS.md, docs/restaurant-loi.md
 *   - weekly Sunday payout ............................. docs/restaurant-loi.md
 *   - delivery fees go to drivers, no service fee ...... docs/FINANCIALS.md
 * and the operational promises must match what the platform actually enforces:
 *   - 3 approved KYC docs + a seeded menu before go-live ... approve_restaurant (mig 123)
 *   - restaurant stays closed until the owner opens it ..... is_open, merchant-controlled
 *   - the merchant, not the customer, is the seller of the food.
 * If any of those change, change them here too.
 */
export default function PartnerTermsPage() {
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
        <h1 className="text-3xl font-bold tracking-tight text-ink">Partner Terms</h1>
        <p className="mt-2 text-sm text-ink/50">
          Last updated: {LAST_UPDATED} · Version {TERMS_VERSION}
        </p>

        <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-ink/80">
          <section>
            <p>
              These terms apply when a restaurant applies to sell on{' '}
              <strong>Sharm Eats</strong>, a food and shop delivery service in
              Sharm el-Sheikh, Egypt. You accept them when you tick the
              acceptance box at the end of the partner application, on behalf of
              your business. They sit alongside our{' '}
              <Link href="/terms" className="font-medium text-accent hover:underline">
                general Terms of Service
              </Link>{' '}
              and the{' '}
              <Link
                href="/privacy-restaurant"
                className="font-medium text-accent hover:underline"
              >
                Restaurant Privacy Policy
              </Link>
              .
            </p>
            <p className="mt-3">
              If you have signed a separate written agreement or Letter of Intent
              with us — for example as part of our founding cohort — that
              document governs wherever it differs from this page.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">Applying and going live</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                Submitting the application does not put you on the platform. Your
                restaurant is created in a pending state that customers cannot
                see.
              </li>
              <li>
                Before you can go live we need{' '}
                <strong>three approved business documents</strong> — commercial
                registration, tax card, and food licence — and a menu with
                prices. Our team reviews these; approval is at our discretion and
                we may ask for clearer copies.
              </li>
              <li>
                When we approve you, your restaurant becomes visible to customers
                but stays <strong>closed</strong> until you open it yourself from
                your dashboard. You decide when you start taking orders.
              </li>
              <li>
                If we cannot approve your application we will tell you why so you
                can fix it and be reviewed again.
              </li>
              <li>
                You confirm you are authorised to enter into this agreement for
                the business, and that the details and documents you give us are
                accurate and genuinely yours.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">Commission and fees</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                <strong>Commission is 15% of the food value</strong> of each
                delivered order. This is the standard rate and the one that
                applies unless we have agreed otherwise with you in writing.
              </li>
              <li>
                <strong>Founding cohort — 12%.</strong> Our launch cohort pays a
                reduced <strong>12%</strong> for the first three months from
                their go-live date, after which the standard 15% applies. This
                offer is limited to a fixed number of launch partners and is not
                automatic: it applies only if we confirm it with you in writing
                before you go live. If you are not offered it, your rate is 15%.
              </li>
              <li>
                <strong>No signup fee and no monthly fee.</strong> We do not
                charge you to list, and we do not charge you for the dashboard.
              </li>
              <li>
                <strong>Delivery fees are not yours or ours to share</strong> —
                they go to the driver who delivers the order.
              </li>
              <li>
                Commission is calculated on the food subtotal, not on delivery
                fees, and is recorded per order so you can check it.
              </li>
              <li>
                We will give you reasonable written notice before changing your
                commission rate. If you do not accept a change, you may leave.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">Payouts</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                We pay out <strong>weekly, every Sunday</strong>, by bank
                transfer or mobile wallet to the payout details you gave us. You
                are responsible for keeping those details correct and current.
              </li>
              <li>
                A payout is the food value of your delivered orders for the
                period, less commission, less any refunds, chargebacks, or
                agreed adjustments. Your statement in the dashboard shows the
                breakdown.
              </li>
              <li>
                For cash-on-delivery orders the driver collects the cash and it
                is reconciled into the same weekly settlement.
              </li>
              <li>
                Prices you set are tax-inclusive. You are responsible for your
                own taxes, licences, and any invoicing your business is legally
                required to issue.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">Running your restaurant</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                <strong>You are the seller of the food.</strong> You are
                responsible for its preparation, quality, safety, allergen
                accuracy, and for meeting Egyptian food-safety and licensing law.
                We provide the platform and the delivery.
              </li>
              <li>
                Keep your menu, prices, and availability accurate. If an item is
                out of stock, mark it so — customers are charged what your menu
                says.
              </li>
              <li>
                Accept and prepare orders during the hours you publish. If you
                need to stop taking orders, close your restaurant in the
                dashboard rather than rejecting orders one by one.
              </li>
              <li>
                Prepare orders within your stated prep time. Repeated late or
                rejected orders affect your rating and may lead us to pause your
                listing.
              </li>
              <li>
                Customer details shown to you exist only so you can fulfil the
                order. Do not keep them, market to them, or use them outside the
                platform.
              </li>
              <li>
                Keep your dashboard credentials secure. You are responsible for
                what your staff accounts do.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">
              Refunds, complaints, and late deliveries
            </h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                Where an order is wrong, missing items, or not of acceptable
                quality because of the kitchen, we may refund the customer and
                deduct that amount from your settlement. We will show it on your
                statement.
              </li>
              <li>
                Where a delivery is late for reasons outside your kitchen, any
                credit we give the customer is ours to bear, not yours.
              </li>
              <li>
                We will discuss disputed deductions with you in good faith before
                they are final.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">Ending the partnership</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                <strong>There is no exclusivity.</strong> You are free to list on
                any other platform at the same time.
              </li>
              <li>
                You can leave at any time by telling us. We will settle what we
                owe you in the next payout run.
              </li>
              <li>
                We may suspend or remove a restaurant for food-safety concerns,
                fraud, false documents, repeated failure to fulfil orders, or
                breach of these terms. Where it is not urgent, we will raise the
                problem with you first.
              </li>
              <li>
                Ending the partnership does not cancel payouts already earned.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">Changes and contact</h2>
            <p className="mt-3">
              We will update this page when these terms change and bump the date
              and version above. Material changes will be notified to partner
              restaurants. Questions about partnering, payouts, or these terms?
              Contact{' '}
              <a
                href="mailto:partners@sharmeats.online"
                className="font-medium text-accent hover:underline"
              >
                partners@sharmeats.online
              </a>
              . Sharm Eats, Sharm el-Sheikh, South Sinai, Egypt.
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}
