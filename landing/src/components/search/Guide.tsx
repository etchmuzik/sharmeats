import type { ReactNode } from 'react';
import Link from 'next/link';
import { restaurantReferences } from './catalogData';
import { venueGuides } from './venueGuides';
import { ZONES } from '@/data/zones';
import { copy, baseFees, money, pilots, type Pilot } from './guideData';
import { localized, languages, type Lang } from './routes';
import './guide.css';

export function GuideFrame({
  children,
  lang,
  path,
  title,
}: {
  children: ReactNode;
  lang: Lang;
  path: string;
  title: string;
}) {
  const n = copy[lang].nav;
  return (
    <div className="search-guide">
      <header className="sg-bar">
        <div className="sg-wrap sg-bar-inner">
          <a
            className="sg-brand"
            href={localized(lang)}
            dir="ltr"
            aria-label="Sharm Eats"
          >
            sharm<span>eats</span>
          </a>
          <nav className="sg-nav">
            <a href={localized(lang, 'delivery-areas')}>{n.areas}</a>
            <a href={localized(lang, 'restaurants')}>{n.menus}</a>
            <a className="sg-order" href={localized(lang, 'order')}>
              {n.order}
            </a>
          </nav>
        </div>
      </header>
      <div className="sg-wrap sg-langs">
        <nav aria-label={n.languages}>
          {languages.map((l) => (
            <a
              key={l}
              href={localized(l, path)}
              hrefLang={l}
              lang={l}
              aria-current={l === lang ? 'page' : undefined}
            >
              {l === 'ar' ? 'العربية' : l.toUpperCase()}
            </a>
          ))}
        </nav>
      </div>
      <main className="sg-wrap sg-main">
        <nav className="sg-crumb" aria-label={n.home}>
          <a href={localized(lang)}>{n.home}</a>
          <span aria-hidden="true"> / </span>
          {path.includes('/') && (
            <>
              <a
                href={localized(
                  lang,
                  path.startsWith('restaurants/')
                    ? 'restaurants'
                    : 'delivery-areas',
                )}
              >
                {path.startsWith('restaurants/') ? n.menus : n.areas}
              </a>
              <span aria-hidden="true"> / </span>
            </>
          )}
          <span aria-current="page">{title}</span>
        </nav>
        {children}
        <nav className="sg-related" aria-label={n.related}>
          {(
            [
              ['delivery-areas', n.areas],
              ['restaurants', n.menus],
              ['hotel-delivery', n.hotels],
              ['how-it-works', n.help],
            ] as const
          )
            .filter(([p]) => path !== p)
            .map(([p, label]) => (
              <a href={localized(lang, p)} key={p}>
                {label}
                <b aria-hidden="true">{lang === 'ar' ? '↖' : '↗'}</b>
              </a>
            ))}
        </nav>
      </main>
      <footer className="sg-footer">
        <div className="sg-wrap">
          <span dir="ltr">Sharm Eats</span>
          <Link href="/privacy/">{n.privacy}</Link>
          <Link href="/terms/">{n.terms}</Link>
          <a href="mailto:support@sharmeats.online">{n.support}</a>
        </div>
      </footer>
    </div>
  );
}

function Answer({
  title,
  children,
  id,
}: {
  title: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="sg-answer" id={id}>
      <h2>{title}</h2>
      <div>{children}</div>
    </section>
  );
}

function AreaLinks({ lang }: { lang: Lang }) {
  const c = copy[lang];
  return (
    <div className="sg-area-links">
      {Object.entries(pilots).map(([slug, id]) => (
        <a key={slug} href={localized(lang, 'areas/' + slug)}>
          {c[id].title}
          <span aria-hidden="true">↗</span>
        </a>
      ))}
    </div>
  );
}

export function Guide({ lang, path }: { lang: Lang; path: string }) {
  const c = copy[lang];
  const appLink = '/go/ios/?lang=' + lang + '&from=order';
  if (path === 'delivery-areas')
    return (
      <>
        <h1>{c.areas.title}</h1>
        <p className="sg-deck">{c.areas.summary}</p>
        <AreaLinks lang={lang} />
        <table className="sg-fees">
          <caption>{c.nav.asof}</caption>
          <thead>
            <tr>
              <th>{c.nav.zone}</th>
              <th>{c.nav.fee}</th>
            </tr>
          </thead>
          <tbody>
            {ZONES.map((z) => {
              const s = Object.entries(pilots).find(
                ([, id]) => id === z.id,
              )?.[0];
              const name = lang === 'ar' ? z.ar : z.en;
              return (
                <tr key={z.id}>
                  <th scope="row">
                    {s ? (
                      <a href={localized(lang, 'areas/' + s)}>{name}</a>
                    ) : (
                      name
                    )}
                  </th>
                  <td>{money(lang, baseFees[z.id])}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Answer title={c.areas.how}>{c.areas.answer}</Answer>
        <Answer title={c.areas.map}>{c.areas.mapAnswer}</Answer>
      </>
    );
  if (path === 'hotel-delivery')
    return (
      <>
        <h1>{c.hotels.title}</h1>
        <p className="sg-deck">{c.hotels.summary}</p>
        <Answer title={c.hotels.where}>{c.hotels.handoff}</Answer>
        <Answer title={c.hotels.address}>{c.hotels.pin}</Answer>
        <Answer id="beach-handoff" title={c.hotels.beach}>
          {c.hotels.beachAnswer}
        </Answer>
        <AreaLinks lang={lang} />
      </>
    );
  if (path === 'how-it-works')
    return (
      <>
        <h1>{c.how.title}</h1>
        <p className="sg-deck">{c.how.summary}</p>
        <Answer id="guest-orders" title={c.how.guest}>
          {c.how.guestAnswer}
        </Answer>
        <Answer id="delivery-fees" title={c.how.fees}>
          <p>{c.how.feesAnswer}</p>
          <a href={localized(lang, 'delivery-areas')}>{c.nav.areas}</a>
        </Answer>
        <Answer id="payment" title={c.how.payment}>
          {c.how.paymentAnswer}
        </Answer>
        <Answer id="tracking" title={c.how.tracking}>
          {c.how.trackingAnswer}
        </Answer>
        <a className="sg-button" href={localized(lang, 'order')}>
          {c.nav.order}
        </a>
      </>
    );
  if (path === 'order')
    return (
      <>
        <h1>{c.order.title}</h1>
        <p className="sg-deck">{c.order.summary}</p>
        <div className="sg-actions">
          <a className="sg-button" href={appLink}>
            {c.nav.app}
          </a>
          <a href="#android">{c.order.androidTitle}</a>
        </div>
        <Answer id="android" title={c.order.androidTitle}>
          <p>{c.order.androidHelp}</p>
          <a href={localized(lang, 'restaurants')}>{c.order.androidMenus}</a>
        </Answer>
        <Answer title={c.order.next}>{c.order.step}</Answer>
        <Answer title={c.order.total}>{c.order.end}</Answer>
        <a href={localized(lang, 'prototype')}>{c.nav.demo}</a>
      </>
    );
  const slug = path.split('/')[1] as Pilot;
  const id = pilots[slug];
  const area = c[id];
  const branches = restaurantReferences[id];
  const featured = [...branches]
    .sort(
      (a, b) =>
        Number(Object.hasOwn(venueGuides, b.slug)) -
        Number(Object.hasOwn(venueGuides, a.slug)),
    )
    .slice(0, 3);
  return (
    <>
      <h1>{area.title}</h1>
      <p className="sg-deck">{area.summary}</p>
      <div className="sg-actions">
        <a
          className="sg-button"
          href={localized(lang, 'restaurants') + '#' + slug}
        >
          {c.area.restaurants}
        </a>
        <a href={localized(lang, 'order')}>{c.nav.order}</a>
      </div>
      <section className="sg-branches">
        <h2>{c.nav.menus}</h2>
        <p>{c.restaurants.summary}</p>
        <ul>
          {featured.map((branch) => (
            <li key={branch.slug}>
              {Object.hasOwn(venueGuides, branch.slug) ? (
                <a href={localized(lang, 'restaurants/' + branch.slug)}>
                  <bdi>{branch.name}</bdi>
                </a>
              ) : (
                <bdi>{branch.name}</bdi>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="sg-price">
        <div>
          {c.area.base}
          <strong>{money(lang, baseFees[id])}</strong>
        </div>
        <p>{c.area.feeNote}</p>
      </section>
      <Answer title={c.area.pin}>{area.pin}</Answer>
      <Answer title={c.area.where}>{area.where}</Answer>
    </>
  );
}
