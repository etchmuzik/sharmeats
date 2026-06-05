'use client';

import { useMemo, useState } from 'react';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { dictionaries, type Locale, rtlLocales } from '@/i18n/dictionaries';

function detectInitialLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en';
  const lang = navigator.language.slice(0, 2).toLowerCase();
  if (lang === 'ar' || lang === 'ru' || lang === 'it' || lang === 'de') return lang;
  return 'en';
}

export default function HomePage() {
  const [locale, setLocale] = useState<Locale>('en');
  const dict = dictionaries[locale];
  const isRtl = rtlLocales.has(locale);

  useMemo(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = locale;
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
  }, [locale, isRtl]);

  useMemo(() => {
    if (typeof window === 'undefined') return;
    const initial = detectInitialLocale();
    if (initial !== 'en') setLocale(initial);
  }, []);

  return (
    <main dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen">
      <header className="absolute inset-x-0 top-0 z-10">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <span className="text-lg font-semibold tracking-tight text-ink">sharmeats</span>
          <LocaleSwitcher value={locale} onChange={setLocale} />
        </div>
      </header>

      <section className="relative overflow-hidden bg-gradient-to-b from-sand to-bg pt-28 pb-20">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <p className="mb-4 text-xs font-medium uppercase tracking-[0.18em] text-accent">
            {dict.hero.eyebrow}
          </p>
          <h1 className="font-display text-4xl leading-tight text-ink sm:text-5xl md:text-6xl">
            {dict.hero.title}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-ink2">
            {dict.hero.subtitle}
          </p>
          <a
            href="#waitlist"
            className="mt-10 inline-flex items-center justify-center rounded-full bg-accent px-7 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-accentDark"
          >
            {dict.hero.cta}
          </a>
          <p className="mt-3 text-sm text-ink2">{dict.hero.notSpam}</p>
        </div>
      </section>

      <section className="bg-bg py-20">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="text-center font-display text-3xl text-ink sm:text-4xl">
            {dict.valueProps.title}
          </h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {dict.valueProps.items.map((vp) => (
              <article
                key={vp.title}
                className="rounded-2xl border border-black/5 bg-white p-7 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
              >
                <h3 className="font-display text-xl text-ink">{vp.title}</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-ink2">{vp.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="get-the-app" className="bg-sand py-20">
        <div className="mx-auto max-w-xl px-6 text-center">
          <h2 className="font-display text-3xl text-ink sm:text-4xl">
            {dict.waitlist.title}
          </h2>
          <p className="mx-auto mt-4 max-w-md text-ink2">{dict.hero.eyebrow}</p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <span className="inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3 text-sm font-semibold text-white">
              📱 App Store · Google Play
            </span>
            <a
              href={`mailto:${dict.footer.contactEmail}`}
              className="inline-flex items-center gap-2 rounded-full border border-ink/15 px-6 py-3 text-sm font-semibold text-ink hover:border-ink/30"
            >
              {dict.footer.contact}
            </a>
          </div>
        </div>
      </section>

      <footer className="border-t border-black/5 bg-bg py-10">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 px-6 text-center text-sm text-ink2">
          <p>{dict.footer.tagline}</p>
          <p>
            {dict.footer.contact}{' '}
            <a
              href={`mailto:${dict.footer.contactEmail}`}
              className="font-medium text-accent hover:text-accentDark"
            >
              {dict.footer.contactEmail}
            </a>
          </p>
        </div>
      </footer>
    </main>
  );
}
