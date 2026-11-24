'use client';

import { useState } from 'react';
import { ZONES } from '@/data/zones';
import { dictionaries, type Locale } from '@/i18n/dictionaries';
import { homeCopy } from './homeCopy';
import { localized } from './routes';

// Schematic pin locations from the handoff. Names and membership are always
// derived from the dispatch-backed ZONES data.
const pins: Record<string, readonly [number, number]> = {
  naama: [515,415], hadaba: [462,515], nabq: [672,108], old_market: [412,655],
  soho: [575,320], sharks_bay: [632,212], el_salam: [500,300], mubarak_7: [340,500],
  el_rowaisat: [300,450], hay_el_nour: [365,405], el_hadaba_residential: [432,585],
};
const areaPages: Record<string, string> = { naama: 'naama-bay', nabq: 'nabq-bay', hadaba: 'hadaba' };

export default function HomeCoverage({ lang }: { lang: Locale }) {
  const [selected, select] = useState('naama');
  const t = dictionaries[lang];
  const c = homeCopy[lang];
  const name = (zone: (typeof ZONES)[number]) => lang === 'ar' ? zone.ar : zone.en;
  const area = ZONES.find(zone => zone.id === selected) ?? ZONES[0];
  const href = areaPages[area.id] ? '/areas/' + areaPages[area.id] + '/' : '/delivery-areas/';
  return <section id="coverage" className="home-band home-coverage" aria-labelledby="coverage-title">
    <div className="home-wrap home-coverage-layout">
      <div>
        <h2 id="coverage-title">{t.zones_t}</h2><p className="home-lede">{c.app}</p>
        <div className="home-zone-rail" role="group" aria-label={c.zones} onScroll={event => {
          const rail = event.currentTarget;
          const buttons = Array.from(rail.querySelectorAll<HTMLButtonElement>('button[data-zone]'));
          const bounds = rail.getBoundingClientRect();
          const center = bounds.left + bounds.width / 2;
          const nearest = buttons.reduce<HTMLButtonElement | undefined>((best, button) => {
            const distance = (node: HTMLElement) => Math.abs(node.getBoundingClientRect().left + node.offsetWidth / 2 - center);
            return !best || distance(button) < distance(best) ? button : best;
          }, undefined);
          const offset = Math.abs(rail.scrollLeft);
          const target = offset < 2 ? buttons[0] : offset >= rail.scrollWidth - rail.clientWidth - 2 ? buttons[buttons.length - 1] : nearest;
          if (target?.dataset.zone) select(target.dataset.zone);
        }}>
          {ZONES.map(zone => <button type="button" key={zone.id} data-zone={zone.id} aria-pressed={zone.id === selected}
            onClick={() => select(zone.id)}>{name(zone)}</button>)}
        </div>
        <div className="home-actions">
          <a href={localized(lang, '/delivery-areas/')} className="home-link">{c.checkLocation}<b aria-hidden="true">↗</b></a>
        </div>
        <div className="home-area-links">
          {ZONES.filter(zone => areaPages[zone.id]).map(zone =>
            <a key={zone.id} href={localized(lang, '/areas/' + areaPages[zone.id] + '/')}>{name(zone)}</a>)}
        </div>
      </div>
      <div className="home-map">
        <svg viewBox="215 55 535 665" aria-label={c.map} role="img">
          <path className="water" d="M726 40 C706 150 690 210 660 280 C630 350 560 400 528 470 C500 530 470 590 448 650 C436 700 452 760 470 830 H800 V40Z"/>
          <path className="coast" d="M726 40 C706 150 690 210 660 280 C630 350 560 400 528 470 C500 530 470 590 448 650 C436 700 452 760 470 830"/>
          <path className="road" d="M695 55 Q680 167 635 280 T510 471 Q473 547 420 664"/>
          {ZONES.map(zone => {
            const point = pins[zone.id];
            if (!point) return null;
            const active = area.id === zone.id;
            return <g key={zone.id} transform={`translate(${point.join(' ')})`} className={active ? 'selected' : undefined}>
              {active && <circle className="radius" r="28"/>}<circle r={active ? 8 : 5}/>
              {(active || areaPages[zone.id]) && <text x="-13" y="-11" textAnchor="end" direction="ltr">{name(zone)}</text>}
            </g>;
          })}
        </svg>
        <a href={localized(lang, href)} className="home-map-label" aria-live="polite">{name(area)} <span aria-hidden="true">↗</span></a>
      </div>
    </div>
  </section>;
}
