import { StatusBar } from "../StatusBar";

/**
 * Shot 5 — Live tracking. Ported from the design's screenTracking().
 * Dark map (route + teal moped + coral pin), "Arriving ~7:45", driver
 * card, and the status timeline (Preparing → Delivered).
 */

type StepState = "done" | "active" | "pending" | "last";

/** Timeline step. Ported from the inline step(label,time,state) closure. */
function Step({ label, time, state }: { label: string; time: string; state: StepState }) {
  const dotColor =
    state === "done" ? "var(--green)" : state === "active" ? "var(--coral)" : "rgba(255,255,255,.12)";
  return (
    <div className="row" style={{ gap: 34, alignItems: "flex-start", marginBottom: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <span
          style={{
            width: 54,
            height: 54,
            borderRadius: 999,
            background: dotColor,
            display: "grid",
            placeItems: "center",
            boxShadow: state === "active" ? "0 0 0 12px rgba(255,90,60,.18)" : "none",
          }}
        >
          {state === "done" ? (
            <i className="ph-bold ph-check" style={{ fontSize: 30, color: "#fff" }} />
          ) : state === "active" ? (
            <span style={{ width: 18, height: 18, borderRadius: 999, background: "#fff" }} />
          ) : null}
        </span>
        {state === "last" ? null : (
          <span
            style={{
              width: 5,
              height: 60,
              background: state === "done" ? "var(--green)" : "rgba(255,255,255,.12)",
            }}
          />
        )}
      </div>
      <div className="row" style={{ justifyContent: "space-between", flex: 1, paddingBottom: 50 }}>
        <span
          style={{
            font: `${state === "active" ? "800" : "600"} 38px/1.2 var(--font-ui)`,
            color: state === "pending" ? "var(--fg3)" : "var(--fg1)",
          }}
        >
          {label}
        </span>
        <span style={{ font: "700 32px/1 var(--font-num)", color: state === "active" ? "var(--coral)" : "var(--fg3)" }}>
          {time}
        </span>
      </div>
    </div>
  );
}

export function TrackingScreen() {
  return (
    <>
      <StatusBar />
      <div className="app" style={{ paddingTop: 0 }}>
        <div style={{ height: 920, position: "relative", background: "linear-gradient(160deg,#14202a,#101820 55%,#16121a)" }}>
          <svg viewBox="0 0 1044 920" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
            <path d="M-40 300 Q360 250 520 460 T1140 640" stroke="rgba(255,255,255,.45)" strokeWidth="34" fill="none" />
            <path d="M160 -40 Q230 320 520 460 T780 1000" stroke="rgba(255,255,255,.26)" strokeWidth="24" fill="none" />
            <path
              d="M300 560 Q420 480 520 460 Q640 430 760 300"
              stroke="var(--coral)"
              strokeWidth="14"
              fill="none"
              strokeLinecap="round"
              strokeDasharray="2 30"
            />
          </svg>
          <i
            className="ph-fill ph-map-pin"
            style={{
              position: "absolute",
              left: 760,
              top: 300,
              transform: "translate(-50%,-100%)",
              fontSize: 110,
              color: "var(--coral)",
              filter: "drop-shadow(0 10px 16px rgba(0,0,0,.4))",
            }}
          />
          <span
            style={{
              position: "absolute",
              left: 300,
              top: 560,
              transform: "translate(-50%,-50%)",
              width: 118,
              height: 118,
              borderRadius: 999,
              background: "var(--teal)",
              border: "8px solid #fff",
              display: "grid",
              placeItems: "center",
              boxShadow: "var(--shadow-teal)",
            }}
          >
            <i className="ph-fill ph-moped" style={{ fontSize: 58, color: "#fff" }} />
          </span>
          <div
            style={{
              position: "absolute",
              top: 150,
              right: 56,
              background: "var(--ink-900)",
              color: "#fff",
              borderRadius: 999,
              padding: "24px 36px",
              display: "flex",
              alignItems: "center",
              gap: 18,
              boxShadow: "var(--shadow-lg)",
            }}
          >
            <i className="ph-fill ph-clock" style={{ fontSize: 42, color: "var(--gold-300)" }} />
            <span style={{ font: "800 38px/1 var(--font-num)" }}>Arriving ~7:45</span>
          </div>
        </div>

        <div
          style={{
            background: "var(--surface-app)",
            borderRadius: "64px 64px 0 0",
            marginTop: -56,
            position: "relative",
            padding: "36px 56px 0",
          }}
        >
          <div style={{ width: 96, height: 13, borderRadius: 999, background: "var(--border-strong)", margin: "0 auto 40px" }} />
          <div className="row" style={{ gap: 24 }}>
            <span style={{ width: 26, height: 26, borderRadius: 999, background: "var(--green)", boxShadow: "0 0 0 10px var(--positive-bg)" }} />
            <span style={{ font: "800 50px/1 var(--font-display)" }}>On the way</span>
            <span style={{ marginLeft: "auto", font: "700 32px/1 var(--font-ui)", color: "var(--fg3)" }}>#SE-4821</span>
          </div>

          <div className="s-card" style={{ padding: 34, display: "flex", alignItems: "center", gap: 30, margin: "40px 0 50px", boxShadow: "var(--shadow-md)" }}>
            <div
              style={{
                width: 128,
                height: 128,
                borderRadius: 999,
                background: "linear-gradient(135deg,#54b3c4,#0a5260)",
                display: "grid",
                placeItems: "center",
                color: "#fff",
                font: "800 46px/1 var(--font-display)",
              }}
            >
              MA
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ font: "800 42px/1 var(--font-ui)" }}>Mahmoud A.</div>
              <div style={{ font: "700 32px/1 var(--font-num)", color: "var(--gold-400)", marginTop: 14 }}>
                <i className="ph-fill ph-star" /> 4.9 · Scooter 1234
              </div>
            </div>
            <span style={{ width: 104, height: 104, borderRadius: 999, background: "var(--positive-bg)", display: "grid", placeItems: "center" }}>
              <i className="ph-fill ph-phone" style={{ fontSize: 48, color: "var(--green)" }} />
            </span>
            <span style={{ width: 104, height: 104, borderRadius: 999, background: "var(--flag-tourist-bg)", display: "grid", placeItems: "center" }}>
              <i className="ph-fill ph-chat-circle" style={{ fontSize: 48, color: "var(--teal)" }} />
            </span>
          </div>

          <Step label="Preparing" time="7:18" state="done" />
          <Step label="Ready" time="7:31" state="done" />
          <Step label="Picked up" time="7:34" state="done" />
          <Step label="On the way" time="~7:45" state="active" />
          <Step label="Delivered" time="" state="pending" />
        </div>
      </div>
    </>
  );
}
