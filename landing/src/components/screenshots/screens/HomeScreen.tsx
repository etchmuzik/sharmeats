import { StatusBar } from "../StatusBar";
import { FoodTile } from "../FoodTile";
import { TouristFlag, HalalFlag } from "../flags";

/**
 * Shot 1 — Home. Ported from the design's screenHome() + featuredCard().
 * The original built an empty placeholder card and then swapped it via a
 * post-mount outerHTML hack (the fixHome IIFE); here FeaturedCard renders
 * directly inside the screen — no DOM swap.
 */

const CUISINES: { icon: string; label: string; on: boolean }[] = [
  { icon: "fire", label: "Grill", on: true },
  { icon: "fish", label: "Seafood", on: false },
  { icon: "cooking-pot", label: "Egyptian", on: false },
  { icon: "pizza", label: "Pizza", on: false },
];

/** Featured restaurant card — slot-as-background + overlaid text/badges. */
function FeaturedCard() {
  return (
    <div className="s-card" style={{ position: "relative", overflow: "hidden", marginTop: 0 }}>
      <FoodTile tone="grill" src="/screenshots/home-1.jpg" alt="Featured dish" style={{ height: 540, borderRadius: 0 }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(to top,rgba(10,10,12,.55),transparent 55%)",
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 34,
            left: 34,
            background: "var(--coral)",
            color: "#fff",
            font: "800 30px/1 var(--font-ui)",
            padding: "18px 28px",
            borderRadius: 999,
            pointerEvents: "none",
          }}
        >
          −20% today
        </div>
      </FoodTile>
      <div style={{ padding: "38px 44px 44px" }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span style={{ font: "800 46px/1.1 var(--font-ui)" }}>Farsha Grill House</span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 12,
              color: "var(--gold-400)",
              font: "800 38px/1 var(--font-num)",
            }}
          >
            <i className="ph-fill ph-star" style={{ fontSize: 40 }} />
            4.8
          </span>
        </div>
        <div style={{ font: "600 34px/1.3 var(--font-ui)", color: "var(--fg2)", marginTop: 18 }}>
          Grill · Seafood · 25–35 min · EGP 15 fee
        </div>
        <div className="row" style={{ gap: 18, marginTop: 30 }}>
          <TouristFlag />
          <HalalFlag />
        </div>
      </div>
    </div>
  );
}

export function HomeScreen() {
  return (
    <>
      <StatusBar />
      <div className="app">
        <div className="pad row" style={{ justifyContent: "space-between", marginBottom: 36 }}>
          <div className="row" style={{ gap: 20 }}>
            <div
              style={{
                width: 84,
                height: 84,
                borderRadius: 999,
                background: "var(--flag-tourist-bg)",
                display: "grid",
                placeItems: "center",
              }}
            >
              <i className="ph-fill ph-buildings" style={{ fontSize: 42, color: "var(--teal)" }} />
            </div>
            <div>
              <div
                style={{
                  font: "800 24px/1 var(--font-ui)",
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                  color: "var(--fg3)",
                }}
              >
                Deliver to
              </div>
              <div style={{ font: "800 38px/1.1 var(--font-ui)", color: "var(--fg1)", marginTop: 8 }}>
                Hilton Sharm · Room 412 ▾
              </div>
            </div>
          </div>
        </div>

        <div className="pad">
          <h1 style={{ font: "800 64px/1.05 var(--font-display)", letterSpacing: "-.02em", margin: "8px 0 30px" }}>
            Good evening, Lena
          </h1>
          <div
            className="row"
            style={{
              gap: 26,
              height: 120,
              background: "var(--surface-sunken)",
              borderRadius: 40,
              padding: "0 36px",
              color: "var(--fg3)",
              font: "500 38px/1 var(--font-ui)",
            }}
          >
            <i className="ph ph-magnifying-glass" style={{ fontSize: 46 }} /> Search restaurants &amp; dishes
          </div>
        </div>

        <div className="row" style={{ gap: 44, padding: "46px 56px 10px" }}>
          {CUISINES.map((c) => (
            <div key={c.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
              <div
                style={{
                  width: 150,
                  height: 150,
                  borderRadius: 48,
                  display: "grid",
                  placeItems: "center",
                  background: c.on ? "var(--coral)" : "var(--surface-raised)",
                  boxShadow: c.on ? "var(--shadow-coral)" : "var(--shadow-sm)",
                }}
              >
                <i className={`ph ph-${c.icon}`} style={{ fontSize: 66, color: c.on ? "#fff" : "var(--fg1)" }} />
              </div>
              <span style={{ font: "700 30px/1 var(--font-ui)", color: c.on ? "var(--coral)" : "var(--fg2)" }}>
                {c.label}
              </span>
            </div>
          ))}
        </div>

        <div className="pad" style={{ marginTop: 30 }}>
          <div className="row" style={{ gap: 20 }}>
            <span className="flag f-tourist" style={{ height: 74, fontSize: 32 }}>
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 3 5 5.5V11c0 4.5 3 7.7 7 9 4-1.3 7-4.5 7-9V5.5L12 3Z"
                  fill="currentColor"
                  opacity=".15"
                />
                <path
                  d="M12 3 5 5.5V11c0 4.5 3 7.7 7 9 4-1.3 7-4.5 7-9V5.5L12 3Z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
                <path
                  d="m9 11.5 2 2 4-4.2"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>{" "}
              Tourist-safe
            </span>
            <span
              style={{
                height: 74,
                display: "inline-flex",
                alignItems: "center",
                padding: "0 28px",
                borderRadius: 999,
                background: "var(--surface-raised)",
                border: "1px solid var(--border)",
                font: "700 32px/1 var(--font-ui)",
                color: "var(--fg1)",
              }}
            >
              Under 30 min
            </span>
          </div>
        </div>

        <div className="pad" style={{ marginTop: 40 }}>
          <div style={{ font: "800 46px/1 var(--font-display)", marginBottom: 30 }}>Featured near you</div>
          <FeaturedCard />
        </div>
      </div>
    </>
  );
}
