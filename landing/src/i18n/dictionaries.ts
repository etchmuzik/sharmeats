export const locales = ['en', 'ar', 'ru', 'it', 'de'] as const;
export type Locale = (typeof locales)[number];

export const rtlLocales: ReadonlySet<Locale> = new Set(['ar']);

export const localeLabels: Record<Locale, string> = {
  en: 'English',
  ar: 'العربية',
  ru: 'Русский',
  it: 'Italiano',
  de: 'Deutsch',
};

/** Short pill labels for the nav language switcher (Landing v2). */
export const localeShort: Record<Locale, string> = {
  en: 'EN',
  ar: 'ع',
  ru: 'RU',
  it: 'IT',
  de: 'DE',
};

/**
 * Landing v2 dictionary (Claude Design handoff, 2026-07). Keys mirror the
 * design file's translation table one-to-one so copy stays diffable against
 * the mock. All five languages were authored in the design — ported verbatim.
 */
export interface Dictionary {
  nav_partner: string;
  nav_cta: string;
  kick: string;
  h1a: string;
  h1b: string;
  sub: string;
  note: string;
  chip: string;
  soon: string;
  badge_a1: string;
  badge_g1: string;
  why_k: string;
  why_big: string;
  w1t: string;
  w1b: string;
  w2t: string;
  w2b: string;
  w3t: string;
  w3b: string;
  partner_k: string;
  partner_t: string;
  partner_b: string;
  partner_cta: string;
  drv_k: string;
  drv_t: string;
  drv_b: string;
  drv_cta: string;
  hiw_k: string;
  hiw_t: string;
  s1t: string;
  s1b: string;
  s2t: string;
  s2b: string;
  s3t: string;
  s3b: string;
  trust_k: string;
  trust_t: string;
  tr1t: string;
  tr1b: string;
  tr2t: string;
  tr2b: string;
  tr3t: string;
  tr3b: string;
  rew_k: string;
  rew_t: string;
  rw1t: string;
  rw1b: string;
  rw2t: string;
  rw2b: string;
  rw3t: string;
  rw3b: string;
  zones_k: string;
  zones_t: string;
  zones_n: string;
  soul_k: string;
  soul_t: string;
  soul_b: string;
  dl_t: string;
  dl_s: string;
  foot_tag: string;
  foot_contact: string;
}

export const dictionaries: Record<Locale, Dictionary> = {
  en: {
    nav_partner: 'For partners', nav_cta: 'Get the app',
    kick: 'Now live in Sharm El Sheikh',
    h1a: 'Food delivery', h1b: 'built for Sharm.',
    sub: 'Fifty hand-picked restaurants, menus in five languages, delivery to your hotel room, your flat, or your sunbed on the beach.',
    note: 'Guest checkout — ordering takes two minutes. Pay cash at the door.',
    chip: 'On time — or credited, automatically',
    soon: 'soon', badge_a1: 'Download on the', badge_g1: 'Get it on',
    why_k: 'Why sharmeats', why_big: 'Three promises we run on.',
    w1t: 'Made for how Sharm eats',
    w1b: 'See prices in EUR, USD, GBP or RUB and pay in EGP — cash at the door, card coming soon. No Egyptian SIM needed: pick your hotel and room number, or drop a GPS pin on your sunbed.',
    w2t: 'ETAs you can trust',
    w2b: 'The time we promise is the time we mean. 15+ minutes late and the credit lands automatically. One flat delivery fee per zone, shown before you order — no per-km surprises, no service fee.',
    w3t: 'Curated, not crowded',
    w3b: "Fifty kitchens we visit and trust, not five hundred we've never seen. Every menu translated by humans, with clear allergen flags.",
    partner_k: 'For restaurants', partner_t: 'Put your kitchen on Sharm Eats.',
    partner_b: 'Start selling with a browser — a full merchant portal, no hardware to buy. Three-lane kitchen queue, same-day menu onboarding, commission discounts for top partners.',
    partner_cta: 'Write to us',
    drv_k: 'For drivers', drv_t: 'Drive with Sharm Eats.',
    drv_b: 'Work when you want — offers come to the nearest driver. Keep 100% of your tips, and Silver & Gold tiers add 5–10 EGP on every delivery.',
    drv_cta: 'Apply on WhatsApp',
    hiw_k: 'How it works', hiw_t: 'Three steps to dinner.',
    s1t: 'Pick your spot', s1b: 'Your hotel and room number, your flat, or a GPS pin on your sunbed.',
    s2t: 'Order in your language', s2b: 'Guest checkout in two minutes — menus and prices in EN, AR, RU, IT or DE.',
    s3t: 'Track it live', s3b: 'Watch the driver on the map, chat in the app, pay cash at the door.',
    trust_k: 'The honest ETA', trust_t: 'We promise the time we can keep.',
    tr1t: 'Real ETAs', tr1b: 'Prep time plus travel time — calculated, not guessed. What you see is when it arrives.',
    tr2t: '15 minutes late? Credited.', tr2b: 'The credit fires into your wallet automatically. No support ticket, no screenshots, no arguing.',
    tr3t: "Chat, don't call", tr3b: 'Message your driver or the restaurant inside the app — and a real human answers on live support.',
    rew_k: 'Rewards', rew_t: 'Loyalty that pays for dinner.',
    rw1t: 'A wallet, not points', rw1b: 'Credits land in EGP and spend on any order — including your late-order credits.',
    rw2t: 'Bronze to Gold', rw2b: 'Order more, get more: free-delivery days, early access to new kitchens, priority support.',
    rw3t: 'EGP 50 / 50 referrals', rw3b: 'Give a friend EGP 50 off their first order — get EGP 50 in your wallet when it delivers.',
    zones_k: 'Coverage', zones_t: 'Eleven zones, all of Sharm.',
    zones_n: 'From Naama Bay to Nabq — your full delivery cost is shown before you order. No service fee, no surprises.',
    soul_k: 'Local soul', soul_t: 'From Sharm, for Sharm.',
    soul_b: "Built by people who live here — not a Cairo clone. We know which kitchens locals queue for, which hotels have three lobbies, and that dinner on the beach beats any dining room.",
    dl_t: 'Dinner is a tap away.', dl_s: 'Free on iOS and Android. From Naama Bay to Nabq — 11 zones across Sharm.',
    foot_tag: 'Food delivery built for Sharm El Sheikh.', foot_contact: 'Restaurants & partners:',
  },
  ar: {
    nav_partner: 'للشركاء', nav_cta: 'حمّل التطبيق',
    kick: 'دلوقتي شغالين في شرم الشيخ',
    h1a: 'توصيل أكل', h1b: 'معمول لشرم.',
    sub: 'خمسين مطعم مختارين واحد واحد، منيوهات بخمس لغات، وتوصيل لأوضتك في الفندق أو شقتك أو حتى سريرك على البلاج.',
    note: 'اطلب كضيف — دقيقتين وخلاص. وادفع كاش عند الباب.',
    chip: 'في معادنا — أو الرصيد ينزل لوحده',
    soon: 'قريباً', badge_a1: 'حمّله من', badge_g1: 'احصل عليه من',
    why_k: 'ليه شارم إيتس', why_big: 'تلات وعود شغالين بيها.',
    w1t: 'معمول على مزاج شرم',
    w1b: 'شوف الأسعار باليورو أو الدولار أو الإسترليني أو الروبل وادفع بالجنيه — كاش عند الباب، والكارت قريب. من غير شريحة مصرية: اختار فندقك واكتب رقم الأوضة، أو حط دبوس GPS على البلاج.',
    w2t: 'ميعادنا كلمة',
    w2b: 'الوقت اللي بنقوله هو الوقت اللي بنقصده. لو اتأخرنا 15 دقيقة زيادة، الرصيد بينزل لوحده. ورسوم توصيل ثابتة لكل منطقة بتشوفها قبل ما تطلب — من غير مفاجآت بالكيلومتر ولا رسوم خدمة.',
    w3t: 'مختارين، مش مكدسين',
    w3b: 'خمسين مطبخ بنزورهم وواثقين فيهم، مش خمسمية عمرنا ما شفناهم. كل منيو مترجم بإيد بشر، ومسببات الحساسية متعلّمة بوضوح.',
    partner_k: 'للمطاعم', partner_t: 'حط مطبخك على شارم إيتس.',
    partner_b: 'ابدأ البيع من المتصفح — بورتال كامل للتاجر من غير أي أجهزة تشتريها. طابور مطبخ بتلات خانات، والمنيو بيطلع لايف في نفس اليوم، وأحسن الشركاء بياخدوا خصم على العمولة.',
    partner_cta: 'راسلنا',
    drv_k: 'للطيارين', drv_t: 'اشتغل مع شارم إيتس.',
    drv_b: 'اشتغل وقت ما تحب — الطلبات بتيجي لأقرب طيار. البقشيش كله ليك 100%، ومستويات السيلفر والجولد بتزوّد 5–10 جنيه على كل توصيلة.',
    drv_cta: 'قدّم على واتساب',
    hiw_k: 'إزاي بنشتغل', hiw_t: 'تلات خطوات والعشا عندك.',
    s1t: 'اختار مكانك', s1b: 'فندقك ورقم الأوضة، شقتك، أو دبوس GPS على سريرك في البلاج.',
    s2t: 'اطلب بلغتك', s2b: 'اطلب كضيف في دقيقتين — منيوهات وأسعار بالإنجليزي والعربي والروسي والإيطالي والألماني.',
    s3t: 'تابع الطلب لايف', s3b: 'شوف الطيار على الخريطة، كلّمه في التطبيق، وادفع كاش عند الباب.',
    trust_k: 'الميعاد الصادق', trust_t: 'بنوعد بالوقت اللي نقدر نلتزم بيه.',
    tr1t: 'مواعيد حقيقية', tr1b: 'وقت التحضير زائد وقت الطريق — محسوبين مش تخمين. اللي بتشوفه هو وقت الوصول.',
    tr2t: 'اتأخرنا 15 دقيقة؟ رصيد.', tr2b: 'الرصيد بينزل في محفظتك لوحده. من غير تذاكر دعم ولا سكرين شوت ولا جدال.',
    tr3t: 'شات، مش مكالمات', tr3b: 'كلّم الطيار أو المطعم جوه التطبيق — وعلى شات الدعم بيرد عليك بني آدم حقيقي.',
    rew_k: 'المكافآت', rew_t: 'ولاء بيدفع تمن العشا.',
    rw1t: 'محفظة مش نقط', rw1b: 'الرصيد بينزل بالجنيه وبيتصرف على أي طلب — بما فيه رصيد التأخير.',
    rw2t: 'من البرونز للجولد', rw2b: 'اطلب أكتر تاخد أكتر: أيام توصيل مجاني، أولوية في الدعم، وتجربة المطابخ الجديدة الأول.',
    rw3t: 'إحالة 50/50 جنيه', rw3b: 'ادّي صاحبك 50 جنيه خصم على أول طلب — وخد 50 جنيه في محفظتك أول ما يوصل.',
    zones_k: 'التغطية', zones_t: 'إحدى عشر منطقة، شرم كلها.',
    zones_n: 'من نعمة باي لنبق — تكلفة التوصيل كاملة بتظهرلك قبل ما تطلب. من غير رسوم خدمة ولا مفاجآت.',
    soul_k: 'روح محلية', soul_t: 'من شرم، لشرم.',
    soul_b: 'معمول بإيد ناس عايشة هنا — مش نسخة من القاهرة. عارفين المطابخ اللي أهل البلد بيصطفوا عليها، والفنادق اللي ليها تلات لوبيات، وإن العشا على البحر أحلى من أي صالة.',
    dl_t: 'العشا على بُعد ضغطة.', dl_s: 'مجاني على iOS وأندرويد. من نعمة باي لنبق — 11 منطقة في شرم.',
    foot_tag: 'توصيل أكل معمول لشرم الشيخ.', foot_contact: 'للمطاعم والشركاء:',
  },
  ru: {
    nav_partner: 'Партнёрам', nav_cta: 'Скачать',
    kick: 'Уже работаем в Шарм-эль-Шейхе',
    h1a: 'Доставка еды,', h1b: 'созданная для Шарма.',
    sub: 'Пятьдесят отобранных ресторанов, меню на пяти языках, доставка в номер отеля, домой или прямо на пляж.',
    note: 'Гостевой заказ — без регистрации, за две минуты. Оплата наличными при получении.',
    chip: 'Вовремя — или кредит, автоматически',
    soon: 'скоро', badge_a1: 'Загрузите в', badge_g1: 'Доступно в',
    why_k: 'Почему sharmeats', why_big: 'Три обещания, по которым мы работаем.',
    w1t: 'Создано для жизни в Шарме',
    w1b: 'Цены в EUR, USD, GBP или RUB, оплата в EGP — наличными при получении, карта скоро. Без египетской SIM: выберите отель и номер комнаты или поставьте GPS-точку прямо на пляже.',
    w2t: 'Срокам можно верить',
    w2b: 'Обещанное время — настоящее. Опоздаем больше чем на 15 минут — кредит начислится автоматически. Фиксированная цена доставки по зоне, видна до заказа — без сюрпризов за километры и сервисных сборов.',
    w3t: 'Отобрано, а не навалено',
    w3b: 'Пятьдесят кухонь, которые мы знаем лично, а не пятьсот, которых никогда не видели. Меню переведены людьми, аллергены отмечены.',
    partner_k: 'Ресторанам', partner_t: 'Подключите свою кухню к Sharm Eats.',
    partner_b: 'Продавайте через браузер — полный портал партнёра, без оборудования. Очередь заказов в три колонки, меню публикуется в тот же день, лучшие партнёры получают скидку на комиссию.',
    partner_cta: 'Написать нам',
    drv_k: 'Курьерам', drv_t: 'Работайте с Sharm Eats.',
    drv_b: 'Работайте когда хотите — заказы приходят ближайшему курьеру. 100% чаевых ваши, а уровни Silver и Gold добавляют 5–10 EGP к каждой доставке.',
    drv_cta: 'Написать в WhatsApp',
    hiw_k: 'Как это работает', hiw_t: 'Три шага до ужина.',
    s1t: 'Укажите место', s1b: 'Отель и номер комнаты, квартира или GPS-точка прямо на лежаке.',
    s2t: 'Закажите на своём языке', s2b: 'Гостевой заказ за две минуты — меню и цены на EN, AR, RU, IT и DE.',
    s3t: 'Следите вживую', s3b: 'Курьер на карте, чат в приложении, оплата наличными у двери.',
    trust_k: 'Честный срок', trust_t: 'Обещаем время, которое можем сдержать.',
    tr1t: 'Настоящие ETA', tr1b: 'Время готовки плюс дорога — расчёт, а не догадка. Что видите, то и приедет.',
    tr2t: 'Опоздали на 15 минут? Кредит.', tr2b: 'Кредит падает в кошелёк автоматически. Без тикетов, скриншотов и споров.',
    tr3t: 'Чат вместо звонков', tr3b: 'Пишите курьеру или ресторану прямо в приложении — а в поддержке отвечает живой человек.',
    rew_k: 'Награды', rew_t: 'Лояльность, которая платит за ужин.',
    rw1t: 'Кошелёк, а не баллы', rw1b: 'Кредиты приходят в EGP и тратятся на любой заказ — включая кредиты за опоздание.',
    rw2t: 'От Bronze до Gold', rw2b: 'Заказывайте больше — получайте больше: дни бесплатной доставки, ранний доступ к новым кухням, приоритетная поддержка.',
    rw3t: 'Рефералы 50/50 EGP', rw3b: 'Подарите другу 50 EGP на первый заказ — и получите 50 EGP в кошелёк после доставки.',
    zones_k: 'Покрытие', zones_t: 'Одиннадцать зон — весь Шарм.',
    zones_n: 'От Наама-Бей до Набка — полная стоимость доставки видна до заказа. Без сервисных сборов и сюрпризов.',
    soul_k: 'Местная душа', soul_t: 'Из Шарма — для Шарма.',
    soul_b: 'Сделано людьми, которые здесь живут, а не каирским клоном. Мы знаем, за какими кухнями очередь у местных, в каких отелях три лобби, и что ужин на пляже лучше любого зала.',
    dl_t: 'Ужин — в один тап.', dl_s: 'Бесплатно для iOS и Android. От Наама-Бей до Набка — 11 зон Шарма.',
    foot_tag: 'Доставка еды, созданная для Шарм-эль-Шейха.', foot_contact: 'Ресторанам и партнёрам:',
  },
  it: {
    nav_partner: 'Per i partner', nav_cta: "Scarica l'app",
    kick: 'Ora attivi a Sharm El Sheikh',
    h1a: 'Il food delivery', h1b: 'fatto per Sharm.',
    sub: "Cinquanta ristoranti selezionati, menu in cinque lingue, consegna in camera d'hotel, a casa o sul lettino in spiaggia.",
    note: 'Ordina da ospite in due minuti. Paghi in contanti alla consegna.',
    chip: 'Puntuali — o credito automatico',
    soon: 'presto', badge_a1: 'Scarica su', badge_g1: 'Disponibile su',
    why_k: 'Perché sharmeats', why_big: 'Tre promesse su cui lavoriamo.',
    w1t: 'Fatto per come si mangia a Sharm',
    w1b: 'Prezzi in EUR, USD, GBP o RUB, paghi in EGP — contanti alla consegna, carta in arrivo. Senza SIM egiziana: scegli il tuo hotel e il numero di camera, o lascia un pin GPS in spiaggia.',
    w2t: 'Tempi di cui fidarsi',
    w2b: "L'orario promesso è quello vero. Più di 15 minuti di ritardo e il credito arriva da solo. Una tariffa fissa per zona, visibile prima dell'ordine — niente sorprese al chilometro né costi di servizio.",
    w3t: 'Selezionati, non ammassati',
    w3b: 'Cinquanta cucine che visitiamo e di cui ci fidiamo, non cinquecento mai viste. Menu tradotti da persone, allergeni ben segnalati.',
    partner_k: 'Per i ristoranti', partner_t: 'Porta la tua cucina su Sharm Eats.',
    partner_b: 'Vendi da un browser — portale partner completo, nessun hardware da comprare. Coda cucina a tre corsie, menu online in giornata, sconti sulla commissione per i migliori partner.',
    partner_cta: 'Scrivici',
    drv_k: 'Per i rider', drv_t: 'Guida con Sharm Eats.',
    drv_b: 'Lavora quando vuoi — gli ordini arrivano al rider più vicino. Il 100% delle mance è tuo, e i livelli Silver e Gold aggiungono 5–10 EGP a ogni consegna.',
    drv_cta: 'Scrivici su WhatsApp',
    hiw_k: 'Come funziona', hiw_t: 'Tre passi e la cena arriva.',
    s1t: 'Scegli il punto', s1b: 'Hotel e numero di camera, casa tua, o un pin GPS sul lettino.',
    s2t: 'Ordina nella tua lingua', s2b: 'Checkout da ospite in due minuti — menu e prezzi in EN, AR, RU, IT e DE.',
    s3t: 'Segui in diretta', s3b: "Il rider sulla mappa, chat nell'app, contanti alla porta.",
    trust_k: "L'ETA onesta", trust_t: 'Promettiamo il tempo che possiamo mantenere.',
    tr1t: 'ETA vere', tr1b: 'Preparazione più viaggio — calcolate, non indovinate. Quello che vedi è quando arriva.',
    tr2t: '15 minuti di ritardo? Credito.', tr2b: 'Il credito arriva nel wallet da solo. Niente ticket, screenshot o discussioni.',
    tr3t: 'Chatta, non chiamare', tr3b: "Scrivi al rider o al ristorante nell'app — e in supporto risponde una persona vera.",
    rew_k: 'Premi', rew_t: 'Una fedeltà che paga la cena.',
    rw1t: 'Un wallet, non punti', rw1b: 'I crediti arrivano in EGP e si spendono su qualsiasi ordine — inclusi quelli per i ritardi.',
    rw2t: 'Da Bronze a Gold', rw2b: 'Più ordini, più ottieni: giorni di consegna gratis, accesso anticipato alle nuove cucine, supporto prioritario.',
    rw3t: 'Referral 50/50 EGP', rw3b: 'Regala a un amico 50 EGP sul primo ordine — e ricevi 50 EGP nel wallet alla consegna.',
    zones_k: 'Copertura', zones_t: 'Undici zone, tutta Sharm.',
    zones_n: "Da Naama Bay a Nabq — il costo di consegna completo appare prima dell'ordine. Nessun costo di servizio, nessuna sorpresa.",
    soul_k: 'Anima locale', soul_t: 'Da Sharm, per Sharm.',
    soul_b: "Fatto da chi vive qui — non un clone del Cairo. Sappiamo per quali cucine i locali fanno la fila, quali hotel hanno tre lobby, e che la cena in spiaggia batte qualsiasi sala.",
    dl_t: 'La cena è a un tap.', dl_s: 'Gratis su iOS e Android. Da Naama Bay a Nabq — 11 zone di Sharm.',
    foot_tag: 'Food delivery fatto per Sharm El Sheikh.', foot_contact: 'Ristoranti e partner:',
  },
  de: {
    nav_partner: 'Für Partner', nav_cta: 'App holen',
    kick: 'Jetzt live in Sharm El Sheikh',
    h1a: 'Essenslieferung,', h1b: 'gemacht für Sharm.',
    sub: 'Fünfzig handverlesene Restaurants, Menüs in fünf Sprachen, Lieferung aufs Hotelzimmer, nach Hause oder an den Strand.',
    note: 'Als Gast bestellen — in zwei Minuten. Bar bezahlen an der Tür.',
    chip: 'Pünktlich — oder automatische Gutschrift',
    soon: 'bald', badge_a1: 'Laden im', badge_g1: 'Jetzt bei',
    why_k: 'Warum sharmeats', why_big: 'Drei Versprechen, nach denen wir arbeiten.',
    w1t: 'Gemacht dafür, wie Sharm isst',
    w1b: 'Preise in EUR, USD, GBP oder RUB, bezahlt wird in EGP — bar an der Tür, Karte bald. Ohne ägyptische SIM: Hotel und Zimmernummer wählen oder einen GPS-Pin am Strand setzen.',
    w2t: 'Lieferzeiten zum Verlassen',
    w2b: 'Die versprochene Zeit ist die echte Zeit. Über 15 Minuten zu spät? Die Gutschrift kommt automatisch. Eine feste Liefergebühr je Zone, sichtbar vor der Bestellung — keine Kilometer-Überraschungen, keine Servicegebühr.',
    w3t: 'Kuratiert statt überfüllt',
    w3b: 'Fünfzig Küchen, die wir besuchen und denen wir vertrauen — nicht fünfhundert, die wir nie gesehen haben. Menüs von Menschen übersetzt, Allergene klar markiert.',
    partner_k: 'Für Restaurants', partner_t: 'Bring deine Küche auf Sharm Eats.',
    partner_b: 'Verkaufe direkt im Browser — volles Partner-Portal, keine Hardware nötig. Drei-Spuren-Küchenboard, Menü noch am selben Tag online, Kommissionsrabatt für Top-Partner.',
    partner_cta: 'Schreib uns',
    drv_k: 'Für Fahrer', drv_t: 'Fahr mit Sharm Eats.',
    drv_b: 'Arbeite, wann du willst — Aufträge kommen zum nächsten Fahrer. 100% deiner Trinkgelder bleiben bei dir, Silver- und Gold-Stufen bringen 5–10 EGP extra pro Lieferung.',
    drv_cta: 'Auf WhatsApp bewerben',
    hiw_k: 'So funktioniert es', hiw_t: 'Drei Schritte bis zum Abendessen.',
    s1t: 'Ort wählen', s1b: 'Hotel und Zimmernummer, deine Wohnung oder ein GPS-Pin auf der Sonnenliege.',
    s2t: 'In deiner Sprache bestellen', s2b: 'Gast-Checkout in zwei Minuten — Menüs und Preise auf EN, AR, RU, IT und DE.',
    s3t: 'Live verfolgen', s3b: 'Fahrer auf der Karte, Chat in der App, bar an der Tür zahlen.',
    trust_k: 'Die ehrliche ETA', trust_t: 'Wir versprechen die Zeit, die wir halten können.',
    tr1t: 'Echte ETAs', tr1b: 'Zubereitung plus Fahrzeit — berechnet, nicht geraten. Was du siehst, ist die Ankunft.',
    tr2t: '15 Minuten zu spät? Gutschrift.', tr2b: 'Die Gutschrift landet automatisch im Wallet. Kein Ticket, kein Screenshot, kein Streit.',
    tr3t: 'Chatten statt anrufen', tr3b: 'Schreib dem Fahrer oder Restaurant direkt in der App — und im Support antwortet ein echter Mensch.',
    rew_k: 'Belohnungen', rew_t: 'Treue, die das Abendessen zahlt.',
    rw1t: 'Ein Wallet, keine Punkte', rw1b: 'Guthaben kommt in EGP und gilt für jede Bestellung — auch die Verspätungs-Gutschriften.',
    rw2t: 'Von Bronze bis Gold', rw2b: 'Mehr bestellen, mehr bekommen: gratis Liefertage, früher Zugang zu neuen Küchen, Priority-Support.',
    rw3t: '50/50-EGP-Referrals', rw3b: 'Schenk einem Freund 50 EGP auf die erste Bestellung — und bekomm 50 EGP ins Wallet bei Zustellung.',
    zones_k: 'Abdeckung', zones_t: 'Elf Zonen — ganz Sharm.',
    zones_n: 'Von Naama Bay bis Nabq — der volle Lieferpreis steht vor der Bestellung fest. Keine Servicegebühr, keine Überraschungen.',
    soul_k: 'Lokale Seele', soul_t: 'Aus Sharm, für Sharm.',
    soul_b: 'Gebaut von Leuten, die hier leben — kein Kairo-Klon. Wir wissen, wo die Einheimischen anstehen, welche Hotels drei Lobbys haben, und dass Abendessen am Strand jeden Speisesaal schlägt.',
    dl_t: 'Abendessen? Ein Tap.', dl_s: 'Gratis für iOS und Android. Von Naama Bay bis Nabq — 11 Zonen in Sharm.',
    foot_tag: 'Essenslieferung, gemacht für Sharm El Sheikh.', foot_contact: 'Restaurants & Partner:',
  },
};
