'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { dictionaries, locales, localeShort, type Locale, rtlLocales } from '@/i18n/dictionaries';

/**
 * Sharm Eats marketing home — Landing v2 (Claude Design handoff, 2026-07).
 *
 * Warm off-white canvas, ink black, coral accent, teal secondary; Urbanist +
 * Tajawal. Structure mirrors the mock 1:1 — sticky nav with a pill language
 * switcher, photo-led hero with the on-time chip, zone ticker, three steps,
 * three promises, trust + rewards bands, 11-zone grid, local-soul spread,
 * partner/driver cards, download CTA. All styling lives in globals.css under
 * .lpage (ported near-verbatim from the design so it stays pixel-faithful).
 * Static-export safe: client component, no server bits.
 */

const APP_STORE_URL = 'https://apps.apple.com/eg/app/id6776864451';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=eg.sharmeats.customer';

/** Delivery zones (order matches the design's Z table). */
const ZONES = [
  'Naama Bay', 'Hay El Salam', 'Hadaba', 'Old Market', 'Rowaysat', 'Sunny Lakes',
  'Ras Um Sid', 'El Montazah', 'Soho Square', "Shark's Bay", 'Nabq Bay',
] as const;

/** Uppercase ticker run (duplicated in JSX for the seamless loop). */
const TICKER = [
  'NAAMA BAY', 'HADABA', 'OLD MARKET', 'NABQ BAY', "SHARK'S BAY", 'SOHO SQUARE',
  'RAS UM SID', 'EL MONTAZAH', 'SUNNY LAKES', 'HAY EL SALAM', 'ROWAYSAT',
] as const;

export default function HomePage() {
  const [locale, setLocale] = useState<Locale>('en');
  const t = dictionaries[locale];
  const isRtl = rtlLocales.has(locale);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
  }, [locale, isRtl]);

  // Saved choice wins (design behavior); otherwise fall back to browser language.
  useEffect(() => {
    try {
      const saved = localStorage.getItem('sharmeats-lang');
      if (saved && (locales as readonly string[]).includes(saved)) {
        setLocale(saved as Locale);
        return;
      }
    } catch {
      /* private mode — ignore */
    }
    const lang = navigator.language.slice(0, 2).toLowerCase();
    if (['ar', 'ru', 'it', 'de'].includes(lang)) setLocale(lang as Locale);
  }, []);

  const pickLocale = (code: Locale) => {
    setLocale(code);
    try {
      localStorage.setItem('sharmeats-lang', code);
    } catch {
      /* private mode — ignore */
    }
  };

  return (
    <main className={`lpage${isRtl ? ' rtl' : ''}`} dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Shared SVG symbols (Apple / Play / Instagram) — mirrors the design sheet. */}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
        <symbol id="i-apple" viewBox="0 0 384 512"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" /></symbol>
        <symbol id="i-play" viewBox="0 0 512 512"><path d="M325.3 234.3L104.6 13l280.8 161.2-60.1 60.1zM47 0C34 6.8 25.3 19.2 25.3 35.3v441.3c0 16.1 8.7 28.5 21.7 35.3l256.6-256L47 0zm425.2 225.6l-58.9-34.1-65.7 64.5 65.7 64.5 60.1-34.1c18-14.3 18-46.5-1.2-60.8zM104.6 499l280.8-161.2-60.1-60.1L104.6 499z" /></symbol>
        <symbol id="i-ig" viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="4.5" /><circle cx="12" cy="12" r="3.8" /><circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" stroke="none" /></symbol>
      </svg>

      {/* ── Nav ─────────────────────────────────────────────────── */}
      <nav className="nav">
        <div className="shell navi fx ac jb">
          <a className="logo" href="#top">sharm<span className="eats">eats</span></a>
          <div className="fx ac gap16">
            <a className="nlink" href="#partner">{t.nav_partner}</a>
            <div className="lgroup fx ac">
              {locales.map((code) => (
                <button
                  key={code}
                  type="button"
                  className={code === locale ? 'sw on' : 'sw'}
                  title={dictionaries[code] ? localeShort[code] : code}
                  onClick={() => pickLocale(code)}
                >
                  {localeShort[code]}
                </button>
              ))}
            </div>
            <a className="btn navcta" href="#download">{t.nav_cta}</a>
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────── */}
      <header className="hero" id="top">
        <div className="shell hgrid">
          <div>
            <div className="kick"><span className="kdot" /><span>{t.kick}</span></div>
            <h1 className="h1">{t.h1a} <em className="em">{t.h1b}</em></h1>
            <p className="sub">{t.sub}</p>
            <div className="fx ac wrap gap12">
              <StoreBadge href={APP_STORE_URL} icon="i-apple" line1={t.badge_a1} line2="App Store" />
              <StoreBadge href={PLAY_STORE_URL} icon="i-play" line1={t.badge_g1} line2="Google Play" />
            </div>
            <p className="note">{t.note}</p>
          </div>
          <div className="pwrap">
            <figure className="arch m0">
              <figcaption className="chip"><span className="pulse" /><span>{t.chip}</span></figcaption>
              <Image
                className="himg"
                src="/photos/hero-fish.jpg"
                alt="Grilled Red Sea fish with tomato and herb salsa on a brass platter"
                fill
                priority
                sizes="(max-width: 920px) 90vw, 480px"
              />
            </figure>
          </div>
        </div>
      </header>

      {/* ── Zone ticker ─────────────────────────────────────────── */}
      <div className="tick" aria-hidden>
        <div className="trow">
          {[0, 1].map((run) => (
            <span className="titem" key={run}>
              {TICKER.map((z) => (
                [<span key={`${z}-n`}>{z}</span>, <span key={`${z}-d`} className="tdot">◆</span>]
              ))}
            </span>
          ))}
        </div>
      </div>

      {/* ── How it works ────────────────────────────────────────── */}
      <section className="hiw">
        <div className="shell">
          <div className="kick"><span className="kdot" /><span>{t.hiw_k}</span></div>
          <h2 className="big">{t.hiw_t}</h2>
          <div className="steps">
            <div className="step"><div className="snum">01</div><h3 className="stt">{t.s1t}</h3><p className="stb">{t.s1b}</p></div>
            <div className="step"><div className="snum">02</div><h3 className="stt">{t.s2t}</h3><p className="stb">{t.s2b}</p></div>
            <div className="step"><div className="snum">03</div><h3 className="stt">{t.s3t}</h3><p className="stb">{t.s3b}</p></div>
          </div>
        </div>
      </section>

      {/* ── Why sharmeats ───────────────────────────────────────── */}
      <section className="why">
        <div className="shell">
          <div className="kick"><span className="kdot" /><span>{t.why_k}</span></div>
          <h2 className="big">{t.why_big}</h2>
          <div className="wrow"><div className="wnum">01</div><div><h3 className="wtitle">{t.w1t}</h3><p className="wbody">{t.w1b}</p></div></div>
          <div className="wrow"><div className="wnum">02</div><div><h3 className="wtitle">{t.w2t}</h3><p className="wbody">{t.w2b}</p></div></div>
          <div className="wrow wlast"><div className="wnum">03</div><div><h3 className="wtitle">{t.w3t}</h3><p className="wbody">{t.w3b}</p></div></div>
        </div>
      </section>

      {/* ── Trust band (teal) ───────────────────────────────────── */}
      <section className="band">
        <div className="shell">
          <div className="bk">{t.trust_k}</div>
          <h2 className="big" style={{ marginTop: 16 }}>{t.trust_t}</h2>
          <div className="bgrid">
            <div><h3 className="bt">{t.tr1t}</h3><p className="bb">{t.tr1b}</p></div>
            <div><h3 className="bt">{t.tr2t}</h3><p className="bb">{t.tr2b}</p></div>
            <div><h3 className="bt">{t.tr3t}</h3><p className="bb">{t.tr3b}</p></div>
          </div>
        </div>
      </section>

      {/* ── Rewards band (coral) ────────────────────────────────── */}
      <section className="band coral">
        <div className="shell">
          <div className="bk">{t.rew_k}</div>
          <h2 className="big" style={{ marginTop: 16 }}>{t.rew_t}</h2>
          <div className="bgrid">
            <div><h3 className="bt">{t.rw1t}</h3><p className="bb">{t.rw1b}</p></div>
            <div><h3 className="bt">{t.rw2t}</h3><p className="bb">{t.rw2b}</p></div>
            <div><h3 className="bt">{t.rw3t}</h3><p className="bb">{t.rw3b}</p></div>
          </div>
        </div>
      </section>

      {/* ── Zones ───────────────────────────────────────────────── */}
      <section className="zones">
        <div className="shell">
          <div className="kick"><span className="kdot" /><span>{t.zones_k}</span></div>
          <h2 className="big">{t.zones_t}</h2>
          <div className="zgrid">
            {ZONES.map((z) => (
              <div className="zone" key={z}><span>{z}</span><span className="tdot">◆</span></div>
            ))}
          </div>
          <p className="znote">{t.zones_n}</p>
        </div>
      </section>

      {/* ── Local soul ──────────────────────────────────────────── */}
      <section className="soul">
        <div className="shell sgrid">
          <div>
            <div className="kick"><span className="kdot" /><span>{t.soul_k}</span></div>
            <h2 className="big" style={{ marginBottom: 20 }}>{t.soul_t}</h2>
            <p className="wbody">{t.soul_b}</p>
          </div>
          <div className="simgs">
            <div className="simg">
              <Image src="/screenshots/home-1.jpg" alt="A loaded burger from a Sharm kitchen" fill sizes="(max-width: 920px) 45vw, 240px" style={{ objectFit: 'cover' }} />
            </div>
            <div className="simg s2m">
              <Image src="/screenshots/ar-1.jpg" alt="Egyptian koshary plated for delivery" fill sizes="(max-width: 920px) 45vw, 240px" style={{ objectFit: 'cover' }} />
            </div>
          </div>
        </div>
      </section>

      {/* ── Partner cards ───────────────────────────────────────── */}
      <section id="partner">
        <div className="shell">
          <div className="pcard">
            <div>
              <div className="pk">{t.partner_k}</div>
              <h2 className="pt">{t.partner_t}</h2>
              <p className="pb">{t.partner_b}</p>
            </div>
            <a className="btn dbtn" href="mailto:hello@sharmeats.online">{t.partner_cta}</a>
          </div>
          <div className="pcard drv">
            <div>
              <div className="pk">{t.drv_k}</div>
              <h2 className="pt">{t.drv_t}</h2>
              <p className="pb">{t.drv_b}</p>
            </div>
            <a className="btn dbtn" href="https://wa.me/971581232600" target="_blank" rel="noopener noreferrer">{t.drv_cta}</a>
          </div>
        </div>
      </section>

      {/* ── Download ────────────────────────────────────────────── */}
      <section className="dl" id="download">
        <div className="shell">
          <h2 className="dlt">{t.dl_t}</h2>
          <p className="dls">{t.dl_s}</p>
          <div className="fx ac jc wrap gap12">
            <StoreBadge href={APP_STORE_URL} icon="i-apple" line1={t.badge_a1} line2="App Store" />
            <StoreBadge href={PLAY_STORE_URL} icon="i-play" line1={t.badge_g1} line2="Google Play" />
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer className="foot">
        <div className="shell fx ac jb wrap gap24">
          <div>
            <a className="logo" href="#top">sharm<span className="eats">eats</span></a>
            <p className="fmut m0 mt8">{t.foot_tag}</p>
          </div>
          <p className="fmut m0">
            {t.foot_contact}{' '}
            <a className="mail" href="mailto:hello@sharmeats.online">hello@sharmeats.online</a>
          </p>
          <a className="igl" href="https://www.instagram.com/sharmeats" target="_blank" rel="noopener noreferrer">
            <svg className="igi"><use href="#i-ig" /></svg>@sharmeats
          </a>
          <p className="fmut m0">© 2026 sharmeats</p>
        </div>
        {/* [H-LAND1] Legal links — required by users and store reviewers. Kept
            from v1 (the v2 mock omits them, but they are a compliance need). */}
        <div className="shell fx ac wrap gap16" style={{ marginTop: 28 }}>
          <a className="fmut" href="/privacy" style={{ textDecoration: 'none' }}>Privacy</a>
          <a className="fmut" href="/terms" style={{ textDecoration: 'none' }}>Terms</a>
          <a className="fmut" href="/delete-account" style={{ textDecoration: 'none' }}>Delete account</a>
          <a className="fmut" href="/privacy-driver" style={{ textDecoration: 'none' }}>Driver privacy</a>
          <a className="fmut" href="/privacy-restaurant" style={{ textDecoration: 'none' }}>Restaurant privacy</a>
        </div>
      </footer>
    </main>
  );
}

/** App Store / Google Play badge (design's .store card). */
function StoreBadge({ href, icon, line1, line2 }: { href: string; icon: string; line1: string; line2: string }) {
  return (
    <a className="store" href={href} target="_blank" rel="noopener noreferrer">
      <svg className="sicon"><use href={`#${icon}`} /></svg>
      <span className="col">
        <span className="s1">{line1}</span>
        <span className="s2">{line2}</span>
      </span>
    </a>
  );
}
