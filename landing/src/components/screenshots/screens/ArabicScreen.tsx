import { StatusBar } from "../StatusBar";
import { FoodTile } from "../FoodTile";
import { HalalFlag } from "../flags";

/**
 * Shot 6 — Bilingual Arabic RTL hero. Ported from the design's
 * screenArabic(). Mirrored layout (dir="rtl"), Cairo font (--font-ar),
 * Eastern-Arabic numerals — all copied verbatim. Featured card uses the
 * koshary photo.
 */

const CUISINES: { icon: string; label: string; on: boolean }[] = [
  { icon: "fire", label: "مشويات", on: true },
  { icon: "fish", label: "بحري", on: false },
  { icon: "cooking-pot", label: "مصري", on: false },
  { icon: "pizza", label: "بيتزا", on: false },
];

export function ArabicScreen() {
  return (
    <>
      <StatusBar />
      <div className="app" dir="rtl" style={{ fontFamily: "var(--font-ar)" }}>
        <div className="pad row" style={{ justifyContent: "space-between", marginBottom: 30 }}>
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
              <i className="ph-fill ph-house" style={{ fontSize: 42, color: "var(--coral)" }} />
            </div>
            <div>
              <div style={{ font: "800 24px/1 var(--font-ar)", color: "var(--fg3)" }}>التوصيل إلى</div>
              <div style={{ font: "800 38px/1.1 var(--font-ar)", marginTop: 8 }}>١٤ شارع السلام · شقة ٧ ▾</div>
            </div>
          </div>
        </div>

        <div className="pad">
          <h1 style={{ font: "800 64px/1.1 var(--font-ar)", margin: "8px 0 28px" }}>مساء الخير يا أحمد</h1>
          <div
            className="row"
            style={{
              gap: 26,
              height: 120,
              background: "var(--surface-sunken)",
              borderRadius: 40,
              padding: "0 36px",
              color: "var(--fg3)",
              font: "600 38px/1 var(--font-ar)",
            }}
          >
            <i className="ph ph-magnifying-glass" style={{ fontSize: 46 }} /> ابحث عن مطاعم وأطباق
          </div>
        </div>

        <div className="row" style={{ gap: 44, padding: "46px 56px 10px", direction: "rtl" }}>
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
              <span style={{ font: "700 32px/1 var(--font-ar)", color: c.on ? "var(--coral)" : "var(--fg2)" }}>
                {c.label}
              </span>
            </div>
          ))}
        </div>

        <div className="pad" style={{ marginTop: 40 }}>
          <div style={{ font: "800 46px/1 var(--font-ar)", marginBottom: 30 }}>مميزة بالقرب منك</div>
          <div className="s-card" style={{ position: "relative", overflow: "hidden" }}>
            <FoodTile tone="egyptian" src="/screenshots/ar-1.jpg" alt="كشري" style={{ height: 560, borderRadius: 0 }}>
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
                  right: 34,
                  background: "var(--coral)",
                  color: "#fff",
                  font: "800 30px/1 var(--font-ar)",
                  padding: "18px 28px",
                  borderRadius: 999,
                }}
              >
                توصيل مجاني
              </div>
            </FoodTile>
            <div style={{ padding: "38px 44px 44px" }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span style={{ font: "800 46px/1.1 var(--font-ar)" }}>كشري التحرير</span>
                <span style={{ color: "var(--gold-400)", font: "800 38px/1 var(--font-num)" }}>
                  <i className="ph-fill ph-star" /> ٤٫٩
                </span>
              </div>
              <div style={{ font: "600 34px/1.3 var(--font-ar)", color: "var(--fg2)", marginTop: 18 }}>
                مصري · أكل شعبي · ١٥–٢٥ دقيقة
              </div>
              <div className="row" style={{ gap: 18, marginTop: 30 }}>
                <HalalFlag label="حلال" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
