import { StatusBar } from "../StatusBar";
import { FoodTile } from "../FoodTile";

/**
 * Shot 3 — Item customization. Ported from the design's screenItem().
 * "Farsha smash burger": hero photo, EGP 165, Size segmented (Double),
 * tap-to-remove ingredient chips, Add-ons grid.
 */

/** Add-on card. Ported from the inline addon(name,price,icon,pop) closure. */
function Addon({
  name,
  price,
  icon,
  popular,
}: {
  name: string;
  price: number;
  icon: string;
  popular?: boolean;
}) {
  return (
    <div
      className="s-card"
      style={{
        padding: 34,
        border: popular ? "4px solid var(--coral)" : "2px solid var(--border)",
        background: popular ? "rgba(255,90,60,.1)" : "var(--surface-raised)",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 22,
      }}
    >
      {popular ? (
        <span
          style={{
            position: "absolute",
            top: 28,
            right: 28,
            background: "var(--gold-100)",
            color: "var(--gold-700)",
            font: "800 24px/1 var(--font-ui)",
            textTransform: "uppercase",
            letterSpacing: ".04em",
            padding: "12px 18px",
            borderRadius: 999,
          }}
        >
          Popular
        </span>
      ) : null}
      <div
        style={{
          width: 96,
          height: 96,
          borderRadius: 30,
          background: "var(--surface-warm)",
          display: "grid",
          placeItems: "center",
        }}
      >
        <i className={`ph ph-${icon}`} style={{ fontSize: 50, color: "var(--fg1)" }} />
      </div>
      <span style={{ font: "800 36px/1.15 var(--font-ui)" }}>{name}</span>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="price" style={{ fontSize: 32, color: "var(--fg2)" }}>
          + EGP {price}
        </span>
        <span
          style={{
            width: 56,
            height: 56,
            borderRadius: 999,
            background: popular ? "var(--coral)" : "transparent",
            border: popular ? "none" : "4px solid var(--border-strong)",
            display: "grid",
            placeItems: "center",
          }}
        >
          {popular ? <i className="ph-bold ph-check" style={{ fontSize: 30, color: "#fff" }} /> : null}
        </span>
      </div>
    </div>
  );
}

const INGREDIENTS: { label: string; removed: boolean }[] = [
  { label: "Lettuce", removed: false },
  { label: "No onions", removed: true },
  { label: "Tomato", removed: false },
  { label: "Pickles", removed: false },
];

export function ItemScreen() {
  return (
    <>
      <StatusBar />
      <div className="app" style={{ paddingTop: 0 }}>
        <FoodTile tone="grill" src="/screenshots/item-hero.jpg" alt="Smash burger" style={{ height: 620, borderRadius: 0 }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(to top,rgba(10,10,12,.5),transparent 45%)",
              pointerEvents: "none",
            }}
          />
        </FoodTile>
        <div className="pad" style={{ marginTop: 40 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <h1 style={{ font: "800 60px/1.05 var(--font-display)", letterSpacing: "-.02em" }}>
              Farsha smash burger
            </h1>
            <span className="price" style={{ fontSize: 48 }}>
              EGP 165
            </span>
          </div>
          <div style={{ font: "500 36px/1.3 var(--font-ui)", color: "var(--fg2)", marginTop: 20 }}>
            Double beef, cheddar, house sauce, fries
          </div>

          <div
            style={{
              font: "800 24px/1 var(--font-ui)",
              letterSpacing: ".1em",
              textTransform: "uppercase",
              color: "var(--fg3)",
              margin: "48px 0 22px",
            }}
          >
            Size · Required
          </div>
          <div
            className="row"
            style={{
              background: "var(--surface-sunken)",
              border: "2px solid var(--border)",
              borderRadius: 44,
              padding: 12,
              gap: 8,
            }}
          >
            <div
              style={{
                flex: 1,
                textAlign: "center",
                padding: "34px 0",
                borderRadius: 34,
                font: "700 38px/1 var(--font-ui)",
                color: "var(--fg2)",
              }}
            >
              Single
            </div>
            <div
              style={{
                flex: 1,
                textAlign: "center",
                padding: "34px 0",
                borderRadius: 34,
                font: "800 38px/1 var(--font-ui)",
                background: "var(--coral)",
                color: "#fff",
                boxShadow: "var(--shadow-coral)",
              }}
            >
              Double
            </div>
            <div
              style={{
                flex: 1,
                textAlign: "center",
                padding: "34px 0",
                borderRadius: 34,
                font: "700 38px/1 var(--font-ui)",
                color: "var(--fg2)",
              }}
            >
              Triple <span style={{ opacity: 0.6 }}>+45</span>
            </div>
          </div>

          <div className="row" style={{ gap: 24, margin: "48px 0 22px" }}>
            <span
              style={{
                font: "800 24px/1 var(--font-ui)",
                letterSpacing: ".1em",
                textTransform: "uppercase",
                color: "var(--fg3)",
              }}
            >
              Ingredients
            </span>
            <span style={{ font: "500 30px/1 var(--font-ui)", color: "var(--fg3)" }}>Tap to remove</span>
          </div>
          <div className="row" style={{ gap: 22, flexWrap: "wrap" }}>
            {INGREDIENTS.map((ing) => (
              <span
                key={ing.label}
                style={{
                  height: 84,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "0 34px",
                  borderRadius: 999,
                  border: "3px solid var(--border)",
                  font: "700 34px/1 var(--font-ui)",
                  ...(ing.removed
                    ? { color: "var(--fg3)", textDecoration: "line-through" }
                    : { background: "var(--surface-raised-2)", color: "var(--fg1)" }),
                }}
              >
                {ing.label}{" "}
                {ing.removed ? (
                  <i className="ph-bold ph-plus" style={{ fontSize: 30 }} />
                ) : (
                  <i className="ph-bold ph-x" style={{ fontSize: 28 }} />
                )}
              </span>
            ))}
          </div>

          <div
            style={{
              font: "800 24px/1 var(--font-ui)",
              letterSpacing: ".1em",
              textTransform: "uppercase",
              color: "var(--fg3)",
              margin: "48px 0 24px",
            }}
          >
            Add-ons
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 26 }}>
            <Addon name="Extra cheddar" price={20} icon="cheese" popular />
            <Addon name="Beef bacon" price={35} icon="meat" popular />
          </div>
        </div>
      </div>
    </>
  );
}
