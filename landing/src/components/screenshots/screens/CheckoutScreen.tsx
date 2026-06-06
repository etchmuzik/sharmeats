import { StatusBar } from "../StatusBar";

/**
 * Shot 4 — Checkout / payment. Ported from the design's screenCheckout().
 * Payment methods (Visa selected, Cash, Fawry, Vodafone Cash), order
 * summary, multi-currency chips, coral "Place order" CTA.
 *
 * Note: the design had a `.replace(' credit-card','credit-card')` string
 * artefact on the Visa row — dropped here; the icon is passed directly.
 */

/** Payment-method row. Ported from the inline pay(label,sub,icon,sel) closure. */
function PayRow({
  label,
  sub,
  icon,
  selected,
}: {
  label: string;
  sub: string;
  icon: string;
  selected?: boolean;
}) {
  return (
    <div className="row" style={{ gap: 30, padding: "38px 44px", borderBottom: "2px solid var(--hairline)" }}>
      <div
        style={{
          width: 96,
          height: 96,
          borderRadius: 28,
          background: "var(--surface-warm)",
          display: "grid",
          placeItems: "center",
        }}
      >
        <i className={`ph ph-${icon}`} style={{ fontSize: 48, color: "var(--fg1)" }} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ font: "800 40px/1.1 var(--font-ui)" }}>{label}</div>
        <div style={{ font: "600 30px/1 var(--font-ui)", color: "var(--fg3)", marginTop: 12 }}>{sub}</div>
      </div>
      <span
        style={{
          width: 56,
          height: 56,
          borderRadius: 999,
          background: selected ? "var(--coral)" : "transparent",
          border: selected ? "none" : "4px solid var(--border-strong)",
          display: "grid",
          placeItems: "center",
        }}
      >
        {selected ? <i className="ph-bold ph-check" style={{ fontSize: 30, color: "#fff" }} /> : null}
      </span>
    </div>
  );
}

const SUMMARY: [string, string][] = [
  ["Subtotal", "255"],
  ["Delivery fee", "15"],
  ["Tax (5%)", "13"],
  ["Tip", "15"],
];

const CURRENCIES = ["€ 5.54", "$ 6.05", "£ 4.74", "₽ 530"];

export function CheckoutScreen() {
  return (
    <>
      <StatusBar />
      <div className="app">
        <div className="pad">
          <h1 style={{ font: "800 72px/1.05 var(--font-display)", letterSpacing: "-.02em", margin: "18px 0 40px" }}>
            Payment
          </h1>

          <div className="s-card" style={{ overflow: "hidden", marginBottom: 44 }}>
            <PayRow label="Visa · 4242" sub="Card" icon="credit-card" selected />
            <PayRow label="Cash on delivery" sub="Pay the rider" icon="money" />
            <PayRow label="Fawry" sub="Reference code" icon="barcode" />
            <PayRow label="Vodafone Cash" sub="Mobile wallet" icon="wallet" />
          </div>

          <div className="s-card" style={{ padding: 48 }}>
            {SUMMARY.map(([label, amount]) => (
              <div
                key={label}
                className="row"
                style={{
                  justifyContent: "space-between",
                  padding: "14px 0",
                  font: "600 36px/1.3 var(--font-ui)",
                  color: "var(--fg2)",
                }}
              >
                <span>{label}</span>
                <span className="price" style={{ fontSize: 36, fontWeight: 700 }}>
                  EGP {amount}
                </span>
              </div>
            ))}
            <div style={{ height: 2, background: "var(--hairline)", margin: "26px 0" }} />
            <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ font: "800 48px/1 var(--font-ui)" }}>Total</span>
              <span className="price" style={{ fontSize: 56 }}>
                EGP 298
              </span>
            </div>
            <div className="row" style={{ gap: 18, flexWrap: "wrap", marginTop: 34 }}>
              {CURRENCIES.map((c) => (
                <span
                  key={c}
                  style={{
                    font: "700 32px/1 var(--font-num)",
                    color: "var(--fg2)",
                    background: "var(--surface-warm)",
                    padding: "18px 26px",
                    borderRadius: 999,
                  }}
                >
                  ≈ {c}
                </span>
              ))}
            </div>
          </div>

          <div className="btn-primary" style={{ marginTop: 48 }}>
            Place order · Card <span style={{ marginLeft: "auto", fontWeight: 900 }}>EGP 298</span>
          </div>
        </div>
      </div>
    </>
  );
}
