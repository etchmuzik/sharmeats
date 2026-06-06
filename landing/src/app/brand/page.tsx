import type { Metadata } from "next";
import { Sora, Plus_Jakarta_Sans } from "next/font/google";
import { StackedTile, StackedRow, FINISHES, BRAND } from "../../components/brand/SharmLogo";
import styles from "./brand.module.css";

/**
 * Sharm Eats — Brand / Logo page.
 *
 * Faithful port of the Claude Design handoff "Sharm Eats Logo.html": the
 * chosen Direction E (bold stacked wordmark) built out — hero tile, color
 * finishes, header lockups, app-icon size ramp, and in-use treatments.
 *
 * Dark theme is fully scoped to `.root` (brand.module.css) so it does not
 * affect the light marketing homepage. Sora powers the wordmark via
 * next/font (self-hosted) for pixel-exact letterforms.
 */

const sora = Sora({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-sora" });
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jakarta",
});

export const metadata: Metadata = {
  title: "Sharm Eats — Brand & logo",
  description: "The Sharm Eats logo: bold stacked wordmark, color finishes, app icon, and usage.",
  robots: { index: false, follow: false },
};

export default function BrandPage() {
  return (
    <div className={`${styles.root} ${sora.variable} ${jakarta.variable}`}>
      <div className={styles.page}>
        {/* ---- intro ---- */}
        <div className={styles.intro}>
          <h1>The wordmark, built out.</h1>
          <p>
            We&rsquo;re running with the <strong>bold stacked wordmark</strong> &mdash; &ldquo;SHARM&rdquo; tracked
            over a big lowercase &ldquo;eats&rdquo; in coral, on the dark app tile. Original to Sharm&nbsp;Eats (coral
            + cream, Sora), not a copy of anyone&rsquo;s brand. Below: the hero tile, color finishes, header lockups,
            the full app-icon size ramp, and in-use treatments across themes.
          </p>
        </div>

        {/* ---- bold wordmark tile ---- */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionTitle}>Bold wordmark tile</div>
            <div className={styles.sectionSub}>Hero tile · variants · header lockups</div>
          </div>
          <div className={styles.grid}>
            <div className={`${styles.card} ${styles.cardWide}`}>
              <div className={styles.lab}>Direction E</div>
              <StackedTile size={232} />
              <div className={styles.divider} />
              <StackedRow size={42} />
              <div>
                <div className={styles.concept}>Stacked wordmark</div>
                <div className={styles.desc}>
                  No symbol &mdash; the name is the logo. &ldquo;SHARM&rdquo; tracked over a big lowercase
                  &ldquo;eats&rdquo; in coral, on the dark app tile. Punchy and instantly legible on a home screen.
                </div>
              </div>
            </div>

            <div className={`${styles.card} ${styles.cardWide}`}>
              <div className={styles.lab}>Tile variants</div>
              <div className={styles.tileRow}>
                <div className={styles.iconwrap}>
                  <StackedTile size={140} finish={FINISHES.darkCoral} />
                  <span>Dark · coral</span>
                </div>
                <div className={styles.iconwrap}>
                  <StackedTile size={140} finish={FINISHES.coralInk} />
                  <span>Coral · ink</span>
                </div>
                <div className={styles.iconwrap}>
                  <StackedTile size={140} finish={FINISHES.sandLight} />
                  <span>Sand · light</span>
                </div>
              </div>
            </div>

            <div className={`${styles.card} ${styles.cardWide}`}>
              <div className={styles.lab}>Header lockups</div>
              <div className={styles.ctxcard} style={{ background: BRAND.tile, maxWidth: 460 }}>
                <StackedRow size={40} />
              </div>
              <div className={styles.ctxcard} style={{ background: BRAND.coral, maxWidth: 460 }}>
                <StackedRow size={40} sharm="#fff" eats={BRAND.tile} />
              </div>
              <div className={styles.ctxcard} style={{ background: BRAND.sand, maxWidth: 460 }}>
                <StackedRow size={40} sharm={BRAND.ink} eats={BRAND.coralDeep} />
              </div>
            </div>
          </div>
        </section>

        {/* ---- app icon ---- */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionTitle}>App icon</div>
            <div className={styles.sectionSub}>The tile as a real home-screen icon — across sizes and finishes</div>
          </div>
          <div className={styles.grid}>
            <div className={styles.card}>
              <div className={styles.lab}>Home-screen icon</div>
              <StackedTile size={172} />
              <span style={{ font: "600 14px/1 var(--font-ui)", color: "var(--fg2)" }}>Sharm&nbsp;Eats</span>
            </div>

            <div className={`${styles.card} ${styles.cardWide}`}>
              <div className={styles.lab}>Size ramp</div>
              <div className={styles.tileRow}>
                {[120, 80, 56, 40, 29].map((s) => (
                  <div className={styles.iconwrap} key={s}>
                    <StackedTile size={s} />
                    <span>{s}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className={`${styles.card} ${styles.cardWide}`}>
              <div className={styles.lab}>Finishes</div>
              <div className={styles.tileRow}>
                <div className={styles.iconwrap}>
                  <StackedTile size={132} finish={FINISHES.darkCoral} />
                  <span>Dark · coral</span>
                </div>
                <div className={styles.iconwrap}>
                  <StackedTile size={132} finish={FINISHES.coralInk} />
                  <span>Coral · ink</span>
                </div>
                <div className={styles.iconwrap}>
                  <StackedTile size={132} finish={FINISHES.sandLight} />
                  <span>Sand · light</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---- primary in use ---- */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionTitle}>Primary in use</div>
            <div className={styles.sectionSub}>The bold wordmark across themes & sizes</div>
          </div>
          <div className={styles.grid}>
            <div className={styles.card}>
              <div className={styles.lab}>App header (dark)</div>
              <div className={styles.ctxcard} style={{ background: BRAND.tile }}>
                <StackedRow size={36} />
              </div>
            </div>
            <div className={styles.card}>
              <div className={styles.lab}>On sand (light)</div>
              <div className={styles.ctxcard} style={{ background: BRAND.sand }}>
                <StackedRow size={36} sharm={BRAND.ink} eats="#ed3f20" />
              </div>
            </div>
            <div className={styles.card}>
              <div className={styles.lab}>Reversed on coral</div>
              <div className={styles.ctxcard} style={{ background: BRAND.coral }}>
                <StackedRow size={36} sharm="#fff" eats={BRAND.tile} />
              </div>
            </div>
            <div className={styles.card}>
              <div className={styles.lab}>Small sizes</div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
                <StackedRow size={30} />
                <StackedRow size={20} />
                <StackedRow size={14} />
              </div>
              <div className={styles.swatchrow}>
                <div className={styles.sw} style={{ background: BRAND.coral }} />
                <div className={styles.sw} style={{ background: BRAND.gold }} />
                <div className={styles.sw} style={{ background: BRAND.teal }} />
                <div className={styles.sw} style={{ background: BRAND.sand }} />
              </div>
            </div>
          </div>
        </section>

        {/* ---- downloadable assets ---- */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionTitle}>Assets</div>
            <div className={styles.sectionSub}>Exported logo files — SVG (vector) and PNG app icons</div>
          </div>
          <div className={styles.assets}>
            <a className={styles.assetLink} href="/brand/sharm-eats-tile.svg" target="_blank" rel="noopener">
              App tile (SVG)
            </a>
            <a className={styles.assetLink} href="/brand/sharm-eats-wordmark.svg" target="_blank" rel="noopener">
              Wordmark (SVG)
            </a>
            <a className={styles.assetLink} href="/brand/sharm-eats-tile-sand.svg" target="_blank" rel="noopener">
              Tile · sand (SVG)
            </a>
            <a className={styles.assetLink} href="/brand/icon-512.png" target="_blank" rel="noopener">
              Icon 512px (PNG)
            </a>
            <a className={styles.assetLink} href="/brand/icon-180.png" target="_blank" rel="noopener">
              Icon 180px (PNG)
            </a>
            <a className={styles.assetLink} href="/brand/icon-32.png" target="_blank" rel="noopener">
              Icon 32px (PNG)
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
