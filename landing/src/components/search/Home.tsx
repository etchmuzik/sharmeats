import Link from 'next/link';
import { dictionaries, locales, localeLabels, type Locale } from '@/i18n/dictionaries';
import { localized } from './routes';
import { homeCopy } from './homeCopy';
import HomeFilm from './HomeFilm';
import HomePlatformLink from './HomePlatformLink';
import { copy } from './guideData';
import { previewTitle } from './prototype/previewTitle';
import HomeCoverage from './HomeCoverage';
import './home-fonts.css';
import './home.css';

const dishImages = ['fish', 'koshary', 'burger'] as const;
const legalPaths = ['/terms/', '/privacy/', '/partner-terms/', '/privacy-driver/', '/privacy-restaurant/', '/delete-account/'];
const legalLabels = {
  en: ['Terms', 'Privacy', 'Partner terms', 'Driver privacy', 'Restaurant privacy', 'Delete account'],
  ar: ['الشروط', 'الخصوصية', 'شروط الشركاء', 'خصوصية المندوب', 'خصوصية المطعم', 'حذف الحساب'],
  ru: ['Условия', 'Конфиденциальность', 'Условия партнёров', 'Данные курьеров', 'Данные ресторанов', 'Удалить аккаунт'],
  it: ['Termini', 'Privacy', 'Termini per i partner', 'Privacy rider', 'Privacy ristoranti', 'Elimina account'],
  de: ['Nutzungsbedingungen', 'Datenschutz', 'Partnerbedingungen', 'Datenschutz für Fahrer', 'Datenschutz für Restaurants', 'Konto löschen'],
};
const languagesLabel = {en:'Language',ar:'اللغة',ru:'Язык',it:'Lingua',de:'Sprache'};
const point = { en:'1%', ar:'١٪', ru:'1%', it:'1%', de:'1%' };
const localizedPlace = { en:'Naama Bay', ar:'خليج نعمة', ru:'Наама-Бей', it:'Naama Bay', de:'Naama Bay' };
const paymentCopy = {
  en:'Cash in Egyptian pounds is an option. Check your available payment methods before confirming the order.',
  ar:'تقدر تدفع كاش بالجنيه المصري. راجع طرق الدفع المتاحة قبل ما تأكد الطلب.',
  ru:'Можно оплатить наличными в египетских фунтах. Проверьте доступные способы оплаты перед подтверждением заказа.',
  it:'Puoi pagare in contanti in lire egiziane. Verifica i metodi disponibili prima di confermare l’ordine.',
  de:'Du kannst bar in ägyptischen Pfund bezahlen. Prüfe die verfügbaren Zahlungsarten vor der Bestätigung.',
};

function Brand({ lang }: { lang: Locale }) {
  return <a href={localized(lang)} className="home-brand" aria-label="Sharm Eats" dir="ltr">sharm<span>eats</span></a>;
}

function LanguageLinks({ lang }: { lang: Locale }) {
  return <div className="home-lang-links">{locales.map(value =>
    <a key={value} lang={value} hrefLang={value} href={localized(value)} aria-current={value === lang ? 'page' : undefined}>
      {localeLabels[value]}
    </a>)}</div>;
}

export default function Home({ lang }: { lang: Locale }) {
  const installUrl = '/go/ios/?lang=' + lang + '&from=home';
  const t = dictionaries[lang];
  const c = homeCopy[lang];
  const path = (url: string) => localized(lang, url);
  const faqs = [
    [t.faq_q1, c.app], [t.faq_q2, paymentCopy[lang]], [t.faq_q3, t.faq_a3],
    [t.faq_q4, t.faq_a4], [t.faq_q5, t.faq_a5], [t.faq_q6, t.faq_a6],
  ];
  return <div className="sharm-home" lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
    <a className="home-skip" href="#kitchens">{c.skip}</a>
    <header className="home-header">
      <div className="home-wrap">
        <Brand lang={lang}/>
        <nav className="home-nav" aria-label="Sharm Eats">
          <a href={path('/restaurants/')}>{c.menus}</a>
          <a href={path('/hotel-delivery/')}>{c.hotel}</a>
          <a href="#partners">{t.nav_partner}</a>
        </nav>
        <div className="home-nav-tools">
          <details className="home-languages">
            <summary aria-label={languagesLabel[lang]}>{lang.toUpperCase()} <span aria-hidden="true">⌄</span></summary>
            <LanguageLinks lang={lang}/>
          </details>
          <HomePlatformLink iphoneHref={installUrl} iphoneLabel={copy[lang].nav.app}
            androidHref={path('/order/') + '#android'} androidLabel={copy[lang].order.androidNav}/>
        </div>
      </div>
    </header>
    <main>
      <section className="home-scene" data-film-scene="" aria-labelledby="home-title">
        <div className="home-sticky">
          <HomeFilm pin={localizedPlace[lang]}/>
          <div className="home-hero-shade"/>
          <div className="home-wrap home-hero-content">
            <h1 id="home-title">{c.title}<strong>{c.city}</strong></h1>
            <p>{c.intro}</p>
            <div className="home-actions">
              <a href={path('/order/')} className="home-btn">{c.order}<b aria-hidden="true">↗</b></a>
              <a href="#coverage" className="home-link">{c.zones}<b aria-hidden="true">↓</b></a>
            </div>
          </div>
        </div>
      </section>

      <section className="home-band home-kitchens" id="kitchens" aria-labelledby="kitchens-title">
        <div className="home-wrap">
          <div className="home-duo"><h2 id="kitchens-title">{c.kitchens}</h2>
            <a href={path('/restaurants/')} className="home-link">{c.menus}<b aria-hidden="true">↗</b></a></div>
          <div className="home-plates">
            {dishImages.map((file,i) => <figure key={file} className={'home-plate dish-' + file}>
              <img src={'/home-media/' + file + '.jpg'} alt={c.dishes[i]} loading="lazy" decoding="async" width="540" height="540"/>
              <figcaption><h3>{c.dishes[i]}</h3><p>{c.notes[i]}</p></figcaption>
            </figure>)}
          </div>
        </div>
      </section>

      <section className="home-band home-how" id="how" aria-labelledby="how-title">
        <div className="home-wrap home-two">
          <div><h2 id="how-title">{t.hiw_t}</h2>
            <div className="home-guide-links"><a className="home-link" href={path('/how-it-works/')}>{c.how}<b aria-hidden="true">↗</b></a>
            <a className="home-link" href={path('/hotel-delivery/')}>{c.hotel}<b aria-hidden="true">↗</b></a></div>
          </div>
          <ol className="home-steps">
            {[[t.s1t,c.handoff],[t.s2t,c.pricing],[t.s3t,t.s3b]].map(([title,body],i) =>
              <li key={title}><b aria-hidden="true">{String(i + 1).padStart(2,'0')}</b><div><h3>{title}</h3><p>{body}</p></div></li>)}
          </ol>
        </div>
      </section>

      <HomeCoverage lang={lang}/>

      <section className="home-band home-rewards" id="rewards" aria-labelledby="rewards-title">
        <div className="home-wrap home-two">
          <div><h2 id="rewards-title">{t.rew_t}</h2><div className="home-number">{point[lang]}</div><p>{t.rw1b}</p></div>
          <dl className="home-ledger">
            {[[t.rw2t,t.rw2b],[t.rw3t,t.rw3b]].map(([title,body]) => <div key={title}><dt>{title}</dt><dd>{body}</dd></div>)}
            <div><dt>{t.tr2t}</dt><dd>{t.tr2b} <Link href="/terms/">{legalLabels[lang][0]}</Link></dd></div>
          </dl>
        </div>
      </section>
      <section className="home-band home-partners" id="partners" aria-labelledby="partners-title">
        <div className="home-wrap">
          <div className="home-partner-layout">
            <img alt="" src="/home-media/courier.jpg" loading="lazy" decoding="async" width="1000" height="1501"/>
            <div><h2 id="partners-title">{c.partners}</h2>
              <div className="home-partner-links">
                <a href="https://merchant.sharmeats.online/signup" className="home-link">{c.merchant}<b aria-hidden="true">↗</b></a>
                <a href="https://wa.me/971581232600" className="home-link">{c.ride}<b aria-hidden="true">↗</b></a>
              </div>
              <a className="home-email" href="mailto:hello@sharmeats.online">hello@sharmeats.online</a>
            </div>
          </div>
          <div className="home-faq home-two"><div><h2>{t.faq_t}</h2>
            <a className="home-link" href="mailto:support@sharmeats.online">{c.help}<b aria-hidden="true">↗</b></a></div>
            <div>{faqs.map(([question,answer]) => <details key={question}><summary>{question}<b aria-hidden="true">+</b></summary><p>{answer}</p></details>)}</div>
          </div>
        </div>
      </section>
    </main>
    <footer className="home-footer"><div className="home-wrap">
      <div className="home-foot-top"><Brand lang={lang}/><LanguageLinks lang={lang}/></div>
      <div className="home-foot-links">
        <a href={installUrl}>{c.apple}</a><a href={path('/prototype/')}>{c.demo}</a>
        <a href={path('/prototype/order/')}>{previewTitle[lang]}</a>
        <a href={path('/order/')}>{c.order}</a><a href={path('/delivery-areas/')}>{c.checkLocation}</a>
        <a href="https://www.instagram.com/sharmeats/">@sharmeats</a>
      </div>
      <div className="home-foot-legal">{legalPaths.map((href,i) => <a key={href} href={href}>{legalLabels[lang][i]}</a>)}</div>
    </div></footer>
  </div>;
}
