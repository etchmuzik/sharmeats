'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { WaitlistForm } from '@/components/WaitlistForm';
import { dictionaries, type Locale, rtlLocales } from '@/i18n/dictionaries';

/**
 * Sharm Eats marketing home — sunlit-coastal-editorial.
 *
 * Brand register: design IS the product. Asymmetric, image-led, coral as a
 * committed accent (not just a button), real food + real app screenshots in
 * every section. Keeps the committed identity (Sora display / coral+teal / warm
 * sand) but breaks the centered-stack template the old page defaulted to.
 * Static-export safe (client component for the locale switcher; no server bits).
 */
export default function HomePage() {
  const [locale, setLocale] = useState<Locale>('en');
  const dict = dictionaries[locale];
  const isRtl = rtlLocales.has(locale);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
  }, [locale, isRtl]);

  useEffect(() => {
    const lang = navigator.language.slice(0, 2).toLowerCase();
    if (['ar', 'ru', 'it', 'de'].includes(lang)) setLocale(lang as Locale);
  }, []);

  const [vp1, vp2, vp3] = dict.valueProps.items;

  return (
    <main dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-bg font-sans text-ink">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="absolute inset-x-0 top-0 z-20">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
          <span className="font-display text-xl font-extrabold tracking-tight">
            sharm<span className="text-accent">eats</span>
          </span>
          <LocaleSwitcher value={locale} onChange={setLocale} />
        </div>
      </header>

      {/* ── Hero: asymmetric, copy left + stacked food/app imagery right ── */}
      <section className="relative overflow-hidden">
        {/* warm coastal wash + a coral "sun" bleeding off the corner */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-sand via-bg to-bg" />
        <div className="pointer-events-none absolute -right-24 -top-24 h-[420px] w-[420px] rounded-full bg-accent/15 blur-3xl" />
        <div className="pointer-events-none absolute right-1/3 top-40 h-72 w-72 rounded-full bg-sea/10 blur-3xl" />

        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-36 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8 lg:pb-28 lg:pt-44">
          <div className={isRtl ? 'text-right' : 'text-left'}>
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-sea ring-1 ring-line">
              <span className="h-1.5 w-1.5 rounded-full bg-sea" />
              {dict.hero.eyebrow}
            </span>
            <h1 className="mt-6 font-display text-[2.6rem] font-extrabold leading-[1.04] tracking-tight sm:text-6xl lg:text-[4.2rem]">
              {dict.hero.title.replace(/\.$/, '')}
              <span className="text-accent">.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink2">{dict.hero.subtitle}</p>
            <div className={`mt-9 flex flex-wrap items-center gap-3 ${isRtl ? 'justify-end' : ''}`}>
              <a
                href="#get-the-app"
                className="inline-flex items-center justify-center rounded-full bg-accent px-7 py-3.5 text-base font-semibold text-white shadow-[0_8px_24px_-8px_rgba(255,90,60,0.6)] transition hover:bg-accentDark"
              >
                {dict.hero.cta}
              </a>
              <a
                href="#how"
                className="inline-flex items-center gap-1.5 rounded-full px-4 py-3.5 text-base font-semibold text-ink transition hover:text-accent"
              >
                {vp1.title}
                <span aria-hidden>{isRtl ? '←' : '→'}</span>
              </a>
            </div>
            <p className="mt-4 text-sm text-ink3">{dict.hero.notSpam}</p>
          </div>

          {/* Imagery cluster: a food photo with the app's tracking screen overlapping */}
          <div className="relative mx-auto w-full max-w-md lg:max-w-none">
            <div className="relative aspect-[4/5] overflow-hidden rounded-[2rem] ring-1 ring-line shadow-2xl">
              <Image
                src="/screenshots/item-hero.jpg"
                alt="A fresh smash burger, hand-stacked, ready to deliver across Sharm"
                fill
                priority
                sizes="(max-width: 1024px) 90vw, 460px"
                className="object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-ink/40 to-transparent" />
            </div>
            {/* floating phone with the real app */}
            <div className="absolute -bottom-8 w-36 overflow-hidden rounded-[1.6rem] ring-1 ring-line shadow-2xl sm:w-44"
              style={isRtl ? { left: '-1rem' } : { right: '-1rem' }}>
              <Image
                src="/app/tracking.png"
                alt="Live order tracking in the Sharm Eats app, with driver and ETA"
                width={260}
                height={563}
                sizes="180px"
                className="h-auto w-full"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── Value props: editorial alternating rows, each with imagery ── */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-20 lg:py-28">
        <h2 className="max-w-2xl font-display text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
          {dict.valueProps.title}
        </h2>

        <div className="mt-14 space-y-16 lg:space-y-24">
          <Row
            image="/screenshots/home-1.jpg"
            alt="A loaded cheeseburger from a Sharm kitchen, delivered hot to your room"
            kicker="01"
            title={vp1.title}
            body={vp1.body}
            rtl={isRtl}
          />
          <Row
            image="/app/order.png"
            alt="The Sharm Eats checkout, showing an honest up-front ETA and total"
            kicker="02"
            title={vp2.title}
            body={vp2.body}
            rtl={isRtl}
            flip
            contain
          />
          <Row
            image="/screenshots/ar-1.jpg"
            alt="Egyptian koshary, an Arabic-menu favourite, plated for delivery"
            kicker="03"
            title={vp3.title}
            body={vp3.body}
            rtl={isRtl}
          />
        </div>
      </section>

      {/* ── Waitlist: capture pre-install interest (coexists with the app CTA) ── */}
      <section id="waitlist" className="scroll-mt-20 bg-sand">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-20 lg:grid-cols-[1fr_0.9fr] lg:gap-14 lg:py-28">
          <div className={isRtl ? 'text-right' : 'text-left'}>
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-sea ring-1 ring-line">
              <span className="h-1.5 w-1.5 rounded-full bg-sea" />
              {dict.hero.eyebrow}
            </span>
            <h2 className="mt-6 max-w-lg font-display text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
              {dict.waitlist.title}
            </h2>
            <p className="mt-4 max-w-md text-lg leading-relaxed text-ink2">{dict.hero.subtitle}</p>
            <p className="mt-4 text-sm text-ink3">{dict.hero.notSpam}</p>
          </div>
          <div className="w-full">
            <WaitlistForm locale={locale} dict={dict.waitlist} />
          </div>
        </div>
      </section>

      {/* ── Get the app: coral-committed band ─────────────────────── */}
      <section id="get-the-app" className="scroll-mt-20 bg-accent text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-16 lg:grid-cols-[1fr_auto] lg:py-20">
          <div className={isRtl ? 'text-right' : 'text-left'}>
            <h2 className="font-display text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
              {dict.waitlist.title}
            </h2>
            <p className="mt-3 max-w-md text-white/85">{dict.hero.subtitle}</p>
            <div className={`mt-8 flex flex-wrap gap-3 ${isRtl ? 'justify-end' : ''}`}>
              <a
                href="https://apps.apple.com/app/id6776864451"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-ink transition hover:bg-white/90"
              >
                App Store
              </a>
              <a
                href="https://play.google.com/store/apps/details?id=eg.sharmeats.customer"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-ink/20 px-6 py-3 text-sm font-semibold text-white ring-1 ring-white/30 transition hover:bg-ink/30"
              >
                Google Play
              </a>
            </div>
          </div>
          <div className="relative hidden w-40 shrink-0 overflow-hidden rounded-[1.6rem] ring-4 ring-white/20 shadow-2xl lg:block">
            <Image
              src="/app/home.png"
              alt="The Sharm Eats home screen, restaurants near you"
              width={300}
              height={650}
              sizes="200px"
              className="h-auto w-full"
            />
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer className="border-t border-line bg-bg">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-12 sm:flex-row sm:items-center sm:justify-between">
          <span className="font-display text-lg font-extrabold tracking-tight">
            sharm<span className="text-accent">eats</span>
          </span>
          <p className="text-sm text-ink2">{dict.footer.tagline}</p>
          <p className="text-sm text-ink2">
            {dict.footer.contact}{' '}
            <a href="mailto:hello@sharmeats.online" className="font-semibold text-accent hover:text-accentDark">
              hello@sharmeats.online
            </a>
          </p>
        </div>
        {/* [H-LAND1] Legal links — required by users and store reviewers, and
            previously reachable only by typing the URL. */}
        <div className="border-t border-line">
          <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-6 py-4 text-xs text-ink3">
            <a href="/privacy" className="hover:text-accent">Privacy</a>
            <a href="/terms" className="hover:text-accent">Terms</a>
            <a href="/delete-account" className="hover:text-accent">Delete account</a>
            <a href="/privacy-driver" className="hover:text-accent">Driver privacy</a>
            <a href="/privacy-restaurant" className="hover:text-accent">Restaurant privacy</a>
          </nav>
        </div>
      </footer>
    </main>
  );
}

/** Editorial value-prop row: image one side, text the other; alternates. */
function Row({
  image,
  alt,
  kicker,
  title,
  body,
  rtl,
  flip,
  contain,
}: {
  image: string;
  alt: string;
  kicker: string;
  title: string;
  body: string;
  rtl: boolean;
  flip?: boolean;
  contain?: boolean;
}) {
  return (
    <div className={`grid items-center gap-8 lg:grid-cols-2 lg:gap-14 ${flip ? 'lg:[&>*:first-child]:order-2' : ''}`}>
      <div
        className={`relative aspect-[5/4] overflow-hidden rounded-[1.75rem] ring-1 ring-line ${
          contain ? 'bg-sand' : ''
        }`}
      >
        <Image
          src={image}
          alt={alt}
          fill
          sizes="(max-width: 1024px) 90vw, 520px"
          className={contain ? 'object-contain p-6' : 'object-cover'}
        />
      </div>
      <div className={rtl ? 'text-right' : 'text-left'}>
        <span className="font-display text-sm font-bold text-accent">{kicker}</span>
        <h3 className="mt-2 font-display text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">
          {title}
        </h3>
        <p className="mt-4 max-w-md text-[17px] leading-relaxed text-ink2">{body}</p>
      </div>
    </div>
  );
}
