import { notFound } from 'next/navigation';
import { ZONES } from '@/data/zones';
import { localized, type Lang } from './routes';
import { catalogAreas, publishedDeliveryMenus, referenceDate, restaurantMenuLinks, restaurantReferences } from './catalogData';
import { venueGuides } from './venueGuides';
import styles from './Catalog.module.css';

export const restaurantSlugs = [...new Set([...Object.keys(venueGuides), ...publishedDeliveryMenus.map(menu => menu.slug)])];

const copy = {
  en: {
    title: 'Restaurants in Sharm El Sheikh',
    intro: 'Browse the Sharm Eats restaurant directory by area. For delivery, set your address in the app to check the restaurants, prices and handoff options available to you.',
    app: 'Get Sharm Eats for iPhone', coverage: 'Check delivery areas and fees', jump: 'Jump to an area',
    guide: 'Delivery in this area', menu: 'Restaurant’s own menu', date: 'Directory checked', source: 'Menu source',
    datesLocale: 'en-GB', prices: 'Delivery menu', updated: 'Menu verified', all: 'All restaurants', unit: 'EGP',
  },
  ar: {
    title: 'مطاعم شرم الشيخ',
    intro: 'تصفّح دليل مطاعم شرم إيتس حسب المنطقة. للتوصيل، حدّد عنوانك في التطبيق عشان تشوف المطاعم والأسعار وأماكن استلام الطلب المتاحة ليك.',
    app: 'نزّل شرم إيتس للآيفون', coverage: 'مناطق التوصيل والرسوم', jump: 'اختار المنطقة',
    guide: 'التوصيل في المنطقة دي', menu: 'منيو المطعم الرسمي', date: 'تاريخ مراجعة الدليل', source: 'مصدر المنيو',
    datesLocale: 'ar-EG', prices: 'منيو التوصيل', updated: 'تاريخ مراجعة المنيو', all: 'كل المطاعم', unit: 'ج.م.',
  },
  ru: {
    title: 'Рестораны Шарм-эль-Шейха',
    intro: 'Найдите рестораны в каталоге Sharm Eats по районам. Для доставки укажите адрес в приложении: вы увидите доступные рестораны, цены и варианты получения заказа.',
    app: 'Скачать Sharm Eats для iPhone', coverage: 'Районы и стоимость доставки', jump: 'Перейти к району',
    guide: 'Доставка в этом районе', menu: 'Меню на сайте ресторана', date: 'Каталог проверен', source: 'Источник меню',
    datesLocale: 'ru-RU', prices: 'Меню доставки', updated: 'Меню проверено', all: 'Все рестораны', unit: 'EGP',
  },
  it: {
    title: 'Ristoranti a Sharm el Sheikh',
    intro: 'Esplora i ristoranti del catalogo Sharm Eats per zona. Inserisci il tuo indirizzo nell’app per vedere i ristoranti disponibili, i prezzi e dove ritirare l’ordine.',
    app: 'Scarica Sharm Eats per iPhone', coverage: 'Zone e tariffe di consegna', jump: 'Vai a una zona',
    guide: 'Consegna in questa zona', menu: 'Menu sul sito del ristorante', date: 'Catalogo verificato il', source: 'Fonte del menu',
    datesLocale: 'it-IT', prices: 'Menu per la consegna', updated: 'Menu verificato il', all: 'Tutti i ristoranti', unit: 'EGP',
  },
  de: {
    title: 'Restaurants in Sharm el Sheikh',
    intro: 'Entdecke Restaurants im Verzeichnis von Sharm Eats nach Stadtteil. Gib für eine Lieferung deine Adresse in der App ein. Dort siehst du verfügbare Restaurants, Preise und Übergabeorte.',
    app: 'Sharm Eats für iPhone laden', coverage: 'Liefergebiete und Gebühren', jump: 'Zum Stadtteil springen',
    guide: 'Lieferung in diesem Stadtteil', menu: 'Speisekarte auf der Restaurantwebsite', date: 'Verzeichnis geprüft am', source: 'Quelle der Speisekarte',
    datesLocale: 'de-DE', prices: 'Speisekarte für Lieferungen', updated: 'Speisekarte geprüft am', all: 'Alle Restaurants', unit: 'EGP',
  },
} satisfies Record<Lang, Record<string,string>>;

const guideCopy: Record<Lang, { food: string; delivery: string; check: string }> = {
  en: { food: 'On the restaurant menu', delivery: 'Delivery to your address', check: 'Enter your hotel, apartment or meeting point in Sharm Eats to see which kitchens can deliver. Check the available dishes, delivery price and estimated time in the app for that address.' },
  ar: { food: 'منيو الأكل في المطعم', delivery: 'التوصيل لعنوانك', check: 'حدّد الفندق أو الشقة أو نقطة الاستلام في شرم إيتس عشان تعرف المطاعم اللي بتوصل للمكان ده. راجع الأطباق المتاحة وتكلفة التوصيل والوقت المتوقع في التطبيق حسب عنوانك.' },
  ru: { food: 'Что есть в меню ресторана', delivery: 'Доставка по вашему адресу', check: 'Укажите в Sharm Eats отель, квартиру или место встречи с курьером. В приложении можно посмотреть, какие кухни доставляют по этому адресу, а также доступные блюда, стоимость и ожидаемое время доставки.' },
  it: { food: 'Cosa trovi nel menu del ristorante', delivery: 'Consegna al tuo indirizzo', check: 'Inserisci in Sharm Eats l’hotel, l’appartamento o il punto d’incontro per vedere quali cucine consegnano in zona. Nell’app puoi controllare piatti disponibili, costo della consegna e tempo previsto per quell’indirizzo.' },
  de: { food: 'Auf der Speisekarte', delivery: 'Lieferung an deine Adresse', check: 'Gib in Sharm Eats dein Hotel, deine Wohnung oder einen Treffpunkt ein. In der App siehst du, welche Küchen dorthin liefern, welche Gerichte verfügbar sind und was die Lieferung kostet. Dort findest du auch die voraussichtliche Lieferzeit.' },
};

export function catalogMeta(lang: Lang, slug?: string) {
  const guide = slug && Object.hasOwn(venueGuides, slug) ? venueGuides[slug] : undefined;
  const menu = publishedDeliveryMenus.find(item => item.slug === slug);
  return {
    title: guide?.languages[lang].title ?? (menu ? menu.restaurantName + ' · ' + copy[lang].prices : copy[lang].title),
    description: guide?.languages[lang].description ?? copy[lang].intro,
  };
}

function dateLabel(day: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(day + 'T12:00:00Z'));
}

export function Catalog({ lang, slug }: { lang: Lang; slug?: string }) {
  const t = copy[lang];
  const iosUrl = '/go/ios/?lang=' + lang + '&from=restaurants';
  if (slug) {
    const menu = publishedDeliveryMenus.find(item => item.slug === slug);
    const guide = Object.hasOwn(venueGuides, slug) ? venueGuides[slug] : undefined;
    if (guide && !menu) {
      const g = guide.languages[lang];
      const wording = guideCopy[lang];
      return <article className={styles.catalog} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <a href={localized(lang,'restaurants')+'#'+guide.section}>{t.all}</a>
        <header className={styles.intro}><h1>{g.title}</h1><p>{g.description}</p></header>
        <section className={styles.guide}>
          <h2>{wording.food}</h2>
          <p>{g.menu}</p>
          <a href={guide.sourceUrl}>{t.menu} · <bdi>{guide.sourceLabel}</bdi></a>
          <p className={styles.date}>{t.updated} <time dateTime={guide.verifiedOn}>{dateLabel(guide.verifiedOn, t.datesLocale)}</time>.</p>
        </section>
        <section className={styles.guide}>
          <h2>{wording.delivery}</h2><p>{wording.check}</p>
          <div className={styles.actions}><a className={styles.app} href={iosUrl}>{t.app}</a><a href={localized(lang,'areas/'+guide.section)}>{t.guide}</a></div>
        </section>
      </article>;
    }
    if (!menu) notFound();
    return <article className={styles.catalog} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <a href={localized(lang,'restaurants')}>{t.all}</a>
      <h1><bdi>{menu.restaurantName}</bdi></h1>
      <h2>{t.prices}</h2>
      <ul className={styles.entries}>
        {menu.dishes.map(dish => <li key={dish.name.en}><span>{dish.name[lang]}</span> <bdi>{new Intl.NumberFormat(t.datesLocale).format(dish.priceEgp)} {t.unit}</bdi></li>)}
      </ul>
      <p>{t.updated} <time dateTime={menu.verifiedOn}>{dateLabel(menu.verifiedOn, t.datesLocale)}</time>. <a href={menu.sourceUrl}>{t.source}</a></p>
      <a className={styles.app} href={iosUrl}>{t.app}</a>
    </article>;
  }
  const areas = catalogAreas.map(area => {
    const zone = ZONES.find(item => item.id === area.zone)!;
    return { ...area, title: lang === 'ar' ? zone.ar : lang === 'ru' ? area.ru : zone.en };
  });
  return <article className={styles.catalog} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
    <header className={styles.intro}>
      <h1>{t.title}</h1>
      <p>{t.intro}</p>
      <div className={styles.actions}>
        <a className={styles.app} href={iosUrl}>{t.app}</a>
        <a href={localized(lang,'delivery-areas')}>{t.coverage}</a>
      </div>
    </header>
    <nav aria-label={t.jump} className={styles.jump}>
      {areas.map(area => <a key={area.zone} href={'#'+area.anchor}>{area.title}</a>)}
    </nav>
    {areas.map(area => <section key={area.zone} id={area.anchor} className={styles.area}>
      <div className={styles.areaHead}>
        <h2>{area.title}</h2>
        {area.guide && <a href={localized(lang,'areas/'+area.anchor)}>{t.guide}</a>}
      </div>
      <ul className={styles.entries}>
        {restaurantReferences[area.zone].map(venue => <li key={venue.slug}>
          {restaurantSlugs.includes(venue.slug)
            ? <a href={localized(lang,'restaurants/'+venue.slug)}><bdi>{venue.name}</bdi></a>
            : <bdi>{venue.name}</bdi>}
          {!restaurantSlugs.includes(venue.slug) && restaurantMenuLinks[venue.slug] && <a className={styles.menu} href={restaurantMenuLinks[venue.slug]}>{t.menu}<span className={styles.srOnly}> · {venue.name}</span></a>}
        </li>)}
      </ul>
    </section>)}
    <p className={styles.date}>{t.date} <time dateTime={referenceDate}>{dateLabel(referenceDate, t.datesLocale)}</time>.</p>
  </article>;
}
