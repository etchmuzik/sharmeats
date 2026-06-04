import { StatusBar } from "../StatusBar";

/**
 * Shot 2 — Dual-market address picker. Ported from the design's
 * screenAddress(). Hilton hotel-room (selected) + apartment, then a dark
 * map with a coral pin. The dual-market hook.
 */

/** Address option card. Ported from the inline card(...) closure. */
function AddressCard({
  icon,
  tint,
  bg,
  name,
  sub,
  tag,
  selected,
}: {
  icon: string;
  tint: string;
  bg: string;
  name: string;
  sub: string;
  tag: string;
  selected?: boolean;
}) {
  return (
    <div
      className="s-card"
      style={{
        padding: 44,
        border: selected ? "4px solid var(--coral)" : "2px solid var(--border)",
        background: selected ? "rgba(255,90,60,.1)" : "var(--surface-raised)",
        marginBottom: 32,
      }}
    >
      <div className="row" style={{ gap: 30 }}>
        <div
          style={{
            width: 118,
            height: 118,
            borderRadius: 999,
            background: bg,
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
          }}
        >
          <i className={`ph-fill ph-${icon}`} style={{ fontSize: 58, color: tint }} />
        </div>
        <div style={{ flex: 1 }}>
          <div className="row" style={{ gap: 20 }}>
            <span style={{ font: "800 44px/1.1 var(--font-ui)" }}>{name}</span>
            <span
              style={{
                font: "800 26px/1 var(--font-ui)",
                letterSpacing: ".06em",
                textTransform: "uppercase",
                color: "var(--fg2)",
                background: "var(--surface-warm)",
                padding: "12px 20px",
                borderRadius: 999,
              }}
            >
              {tag}
            </span>
          </div>
          <div style={{ font: "600 34px/1.3 var(--font-ui)", color: "var(--fg3)", marginTop: 16 }}>{sub}</div>
        </div>
        {selected ? <i className="ph-fill ph-check-circle" style={{ fontSize: 72, color: "var(--coral)" }} /> : null}
      </div>
    </div>
  );
}

export function AddressScreen() {
  return (
    <>
      <StatusBar />
      <div className="app">
        <div className="pad">
          <h1 style={{ font: "800 72px/1.05 var(--font-display)", letterSpacing: "-.02em", margin: "18px 0 14px" }}>
            Deliver to
          </h1>
          <div style={{ font: "500 38px/1.35 var(--font-ui)", color: "var(--fg2)", marginBottom: 50 }}>
            Hotel or home — we handle the handoff.
          </div>

          <AddressCard
            icon="buildings"
            tint="var(--teal)"
            bg="var(--flag-tourist-bg)"
            name="Hilton Sharm · Room 412"
            sub="El Fanar Rd, Naama Bay · Leave at reception"
            tag="Hotel"
            selected
          />
          <AddressCard
            icon="house"
            tint="var(--coral)"
            bg="rgba(255,90,60,.16)"
            name="14 El Salam St · Apt 7"
            sub="Hadaba · Ring bell twice"
            tag="Home"
          />

          <div className="s-card" style={{ marginTop: 6, overflow: "hidden" }}>
            <div
              style={{
                height: 520,
                position: "relative",
                background: "linear-gradient(160deg,#14202a,#101820 60%,#16121a)",
              }}
            >
              <svg viewBox="0 0 1000 520" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
                <path
                  d="M-20 160 Q360 120 520 300 T1100 360"
                  stroke="rgba(255,255,255,.45)"
                  strokeWidth="26"
                  fill="none"
                />
                <path
                  d="M180 -20 Q260 220 520 300 T700 600"
                  stroke="rgba(255,255,255,.28)"
                  strokeWidth="18"
                  fill="none"
                />
              </svg>
              <i
                className="ph-fill ph-map-pin"
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "54%",
                  transform: "translate(-50%,-100%)",
                  fontSize: 120,
                  color: "var(--coral)",
                  filter: "drop-shadow(0 10px 16px rgba(0,0,0,.4))",
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
