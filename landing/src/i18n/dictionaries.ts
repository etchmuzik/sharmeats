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
  partner_email: string;
  partner_terms: string;
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
  faq_k: string;
  faq_t: string;
  faq_q1: string; faq_a1: string;
  faq_q2: string; faq_a2: string;
  faq_q3: string; faq_a3: string;
  faq_q4: string; faq_a4: string;
  faq_q5: string; faq_a5: string;
  faq_q6: string; faq_a6: string;
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
    w1b: 'See prices in EUR, USD, GBP or RUB and pay in EGP — cash to the driver, nothing to set up in advance. No Egyptian SIM needed: pick your hotel and room number, or drop a GPS pin on your sunbed.',
    w2t: 'ETAs you can trust',
    w2b: 'The time we promise is the time we mean. 15+ minutes late and the credit lands automatically. One flat delivery fee per zone, shown before you order — no per-km surprises, no service fee.',
    w3t: 'Curated, not crowded',
    w3b: "Fifty kitchens we visit and trust, not five hundred we've never seen. Every menu translated by humans, with clear allergen flags.",
    partner_k: 'For restaurants', partner_t: 'Put your kitchen on Sharm Eats.',
    partner_b: 'Start selling with a browser — a full merchant portal, no hardware to buy. Three-lane kitchen queue, same-day menu onboarding, commission discounts for top partners.',
    partner_cta: 'Add your restaurant',
    partner_email: 'or email hello@sharmeats.online',
    partner_terms: 'Partner terms',
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
    rw1t: 'Points worth real money', rw1b: 'Every EGP 10 you spend earns a point, and 100 points redeem for EGP 10 off your next order.',
    rw2t: 'Bronze to Gold', rw2b: 'Order more and every order earns faster: Silver banks points at 1.25×, Gold at 1.5×.',
    rw3t: 'EGP 50 / 50 referrals', rw3b: 'Give a friend EGP 50 off their first order over EGP 150 — get EGP 50 off yours once theirs is delivered.',
    faq_k: 'Questions', faq_t: 'The things people actually ask.',
    faq_q1: 'Where do you deliver?',
    faq_a1: 'The eleven zones listed above. Each kitchen delivers within about 8 km of itself, so a restaurant on the far side of town may be out of reach from your address.',
    faq_q2: 'How do I pay?',
    faq_a2: 'Cash to the driver when your order arrives. Card payments are not live yet — when they are, this page will say so.',
    faq_q3: 'What does delivery cost?',
    faq_a3: 'Between EGP 20 and EGP 40 depending on your zone, shown in full before you place the order. We do not add a service fee on top.',
    faq_q4: 'Is there a minimum order?',
    faq_a4: 'Usually EGP 50, and it varies by restaurant. If your cart is under it, the app tells you how much more to add and holds checkout until you do.',
    faq_q5: 'Does the driver keep the tip?',
    faq_a5: 'All of it — and the whole delivery fee too. Our cut comes out of restaurant commission, never out of the rider’s fee or your tip.',
    faq_q6: 'What do I get back?',
    faq_a6: 'Points: EGP 10 spent earns one, and 100 points redeem for EGP 10 off — about 1% back, up to 1.5% at Gold. Refunds and late-delivery credits are separate, and come in EGP.',
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
    w1b: 'شوف الأسعار باليورو أو الدولار أو الإسترليني أو الروبل وادفع بالجنيه — كاش للسائق، من غير أي تجهيز مسبق. من غير شريحة مصرية: اختار فندقك واكتب رقم الأوضة، أو حط دبوس GPS على البلاج.',
    w2t: 'ميعادنا كلمة',
    w2b: 'الوقت اللي بنقوله هو الوقت اللي بنقصده. لو اتأخرنا 15 دقيقة زيادة، الرصيد بينزل لوحده. ورسوم توصيل ثابتة لكل منطقة بتشوفها قبل ما تطلب — من غير مفاجآت بالكيلومتر ولا رسوم خدمة.',
    w3t: 'مختارين، مش مكدسين',
    w3b: 'خمسين مطبخ بنزورهم وواثقين فيهم، مش خمسمية عمرنا ما شفناهم. كل منيو مترجم بإيد بشر، ومسببات الحساسية متعلّمة بوضوح.',
    partner_k: 'للمطاعم', partner_t: 'حط مطبخك على شارم إيتس.',
    partner_b: 'ابدأ البيع من المتصفح — بورتال كامل للتاجر من غير أي أجهزة تشتريها. طابور مطبخ بتلات خانات، والمنيو بيطلع لايف في نفس اليوم، وأحسن الشركاء بياخدوا خصم على العمولة.',
    partner_cta: 'سجّل مطعمك',
    partner_email: 'أو راسلنا على hello@sharmeats.online',
    partner_terms: 'شروط الشراكة',
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
    rw1t: 'نقاط بقيمة حقيقية', rw1b: 'كل ١٠ جنيهات تنفقها تكسبك نقطة، و١٠٠ نقطة تُستبدل بخصم ١٠ جنيهات على طلبك التالي.',
    rw2t: 'من البرونز للجولد', rw2b: 'اطلب أكتر وتكسب أسرع: الفضي يجمّع النقاط ١٫٢٥ ضعف، والذهبي ١٫٥ ضعف.',
    rw3t: 'إحالة 50/50 جنيه', rw3b: 'ادّي صاحبك ٥٠ جنيه خصم على أول طلب فوق ١٥٠ جنيه — وخد ٥٠ جنيه خصم على طلبك أول ما يوصل طلبه.',
    faq_k: 'أسئلة', faq_t: 'ما يسأل عنه الناس فعلاً.',
    faq_q1: 'أين توصّلون؟',
    faq_a1: 'المناطق الإحدى عشرة المذكورة أعلاه. كل مطبخ يوصّل في حدود ٨ كم منه تقريباً، لذا قد يكون مطعم في الطرف الآخر من المدينة خارج النطاق بالنسبة لعنوانك.',
    faq_q2: 'كيف أدفع؟',
    faq_a2: 'نقداً للسائق عند وصول الطلب. الدفع بالبطاقة غير متاح بعد — وعندما يتاح ستجد ذلك مذكوراً هنا.',
    faq_q3: 'كم تكلفة التوصيل؟',
    faq_a3: 'بين ٢٠ و٤٠ جنيهاً حسب منطقتك، وتظهر كاملة قبل تأكيد الطلب. ولا نضيف رسوم خدمة فوقها.',
    faq_q4: 'هل هناك حد أدنى للطلب؟',
    faq_a4: 'غالباً ٥٠ جنيهاً، ويختلف من مطعم لآخر. وإذا كانت سلّتك أقل منه، يخبرك التطبيق بالمبلغ الناقص ولا يسمح بإتمام الطلب قبل استكماله.',
    faq_q5: 'هل يحتفظ السائق بالبقشيش؟',
    faq_a5: 'بالكامل — ورسوم التوصيل كاملة أيضاً. عائدنا يأتي من عمولة المطاعم، لا من أجر السائق ولا من بقشيشك.',
    faq_q6: 'ماذا أستفيد؟',
    faq_a6: 'نقاط: كل ١٠ جنيهات تكسبك نقطة، و١٠٠ نقطة تُستبدل بخصم ١٠ جنيهات — أي نحو ١٪، وتصل إلى ١٫٥٪ في المستوى الذهبي. أما المبالغ المستردة ورصيد التأخير فنظام منفصل يأتيك بالجنيه.',
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
    w1b: 'Цены в EUR, USD, GBP или RUB, оплата в EGP — наличными курьеру, без какой-либо предварительной настройки. Без египетской SIM: выберите отель и номер комнаты или поставьте GPS-точку прямо на пляже.',
    w2t: 'Срокам можно верить',
    w2b: 'Обещанное время — настоящее. Опоздаем больше чем на 15 минут — кредит начислится автоматически. Фиксированная цена доставки по зоне, видна до заказа — без сюрпризов за километры и сервисных сборов.',
    w3t: 'Отобрано, а не навалено',
    w3b: 'Пятьдесят кухонь, которые мы знаем лично, а не пятьсот, которых никогда не видели. Меню переведены людьми, аллергены отмечены.',
    partner_k: 'Ресторанам', partner_t: 'Подключите свою кухню к Sharm Eats.',
    partner_b: 'Продавайте через браузер — полный портал партнёра, без оборудования. Очередь заказов в три колонки, меню публикуется в тот же день, лучшие партнёры получают скидку на комиссию.',
    partner_cta: 'Подключить ресторан',
    partner_email: 'или напишите на hello@sharmeats.online',
    partner_terms: 'Условия партнёрства',
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
    rw1t: 'Баллы с реальной ценой', rw1b: 'Каждые потраченные 10 EGP приносят балл, а 100 баллов дают скидку 10 EGP на следующий заказ.',
    rw2t: 'От Bronze до Gold', rw2b: 'Чем больше заказов, тем быстрее копятся баллы: Silver — ×1,25, Gold — ×1,5.',
    rw3t: 'Рефералы 50/50 EGP', rw3b: 'Подарите другу 50 EGP на первый заказ от 150 EGP — и получите скидку 50 EGP, когда этот заказ доставят.',
    faq_k: 'Вопросы', faq_t: 'О чём спрашивают на самом деле.',
    faq_q1: 'Куда вы доставляете?',
    faq_a1: 'В одиннадцать зон, перечисленных выше. Каждая кухня доставляет примерно в радиусе 8 км, поэтому ресторан на другом конце города может оказаться недосягаем для вашего адреса.',
    faq_q2: 'Как оплатить?',
    faq_a2: 'Наличными курьеру при получении. Оплата картой пока не работает — когда заработает, мы напишем об этом здесь.',
    faq_q3: 'Сколько стоит доставка?',
    faq_a3: 'От 20 до 40 EGP в зависимости от зоны, и полная сумма видна до оформления заказа. Сервисный сбор сверху мы не добавляем.',
    faq_q4: 'Есть ли минимальная сумма заказа?',
    faq_a4: 'Обычно 50 EGP, но у каждого ресторана своя. Если корзина меньше, приложение покажет, сколько добавить, и не даст оформить заказ, пока вы этого не сделаете.',
    faq_q5: 'Курьер получает чаевые целиком?',
    faq_a5: 'Полностью — и всю стоимость доставки тоже. Наша доля идёт из комиссии ресторанов, а не из платы курьеру и не из ваших чаевых.',
    faq_q6: 'Что я получаю обратно?',
    faq_a6: 'Баллы: 10 EGP — один балл, 100 баллов — скидка 10 EGP, то есть около 1%, а на уровне Gold до 1,5%. Возвраты и компенсации за опоздание — отдельная история, они приходят в EGP.',
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
    w1b: 'Prezzi in EUR, USD, GBP o RUB, paghi in EGP — contanti al rider, senza nulla da configurare prima. Senza SIM egiziana: scegli il tuo hotel e il numero di camera, o lascia un pin GPS in spiaggia.',
    w2t: 'Tempi di cui fidarsi',
    w2b: "L'orario promesso è quello vero. Più di 15 minuti di ritardo e il credito arriva da solo. Una tariffa fissa per zona, visibile prima dell'ordine — niente sorprese al chilometro né costi di servizio.",
    w3t: 'Selezionati, non ammassati',
    w3b: 'Cinquanta cucine che visitiamo e di cui ci fidiamo, non cinquecento mai viste. Menu tradotti da persone, allergeni ben segnalati.',
    partner_k: 'Per i ristoranti', partner_t: 'Porta la tua cucina su Sharm Eats.',
    partner_b: 'Vendi da un browser — portale partner completo, nessun hardware da comprare. Coda cucina a tre corsie, menu online in giornata, sconti sulla commissione per i migliori partner.',
    partner_cta: 'Aggiungi il tuo ristorante',
    partner_email: 'o scrivi a hello@sharmeats.online',
    partner_terms: 'Condizioni per i partner',
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
    rw1t: 'Punti che valgono soldi', rw1b: 'Ogni 10 EGP spesi valgono un punto, e 100 punti diventano 10 EGP di sconto sul prossimo ordine.',
    rw2t: 'Da Bronze a Gold', rw2b: 'Più ordini, più in fretta accumuli: Silver a 1,25×, Gold a 1,5×.',
    rw3t: 'Referral 50/50 EGP', rw3b: 'Regala a un amico 50 EGP sul primo ordine sopra i 150 EGP — e ricevi 50 EGP di sconto quando quell’ordine arriva.',
    faq_k: 'Domande', faq_t: 'Quello che chiedono davvero.',
    faq_q1: 'Dove consegnate?',
    faq_a1: 'Nelle undici zone elencate sopra. Ogni cucina consegna entro circa 8 km, quindi un ristorante dall’altra parte della città può essere fuori portata dal tuo indirizzo.',
    faq_q2: 'Come si paga?',
    faq_a2: 'In contanti al rider alla consegna. I pagamenti con carta non sono ancora attivi — quando lo saranno, lo scriveremo qui.',
    faq_q3: 'Quanto costa la consegna?',
    faq_a3: 'Tra 20 e 40 EGP a seconda della zona, ed è tutto visibile prima di confermare. Non aggiungiamo costi di servizio.',
    faq_q4: 'C’è un ordine minimo?',
    faq_a4: 'Di solito 50 EGP, e cambia da ristorante a ristorante. Se il carrello è sotto la soglia, l’app ti dice quanto manca e non ti fa concludere l’ordine finché non ci arrivi.',
    faq_q5: 'La mancia va tutta al rider?',
    faq_a5: 'Tutta — e anche l’intero costo di consegna. Il nostro guadagno esce dalla commissione dei ristoranti, mai dal compenso del rider o dalla tua mancia.',
    faq_q6: 'Cosa ricevo indietro?',
    faq_a6: 'Punti: 10 EGP spesi valgono un punto, e 100 punti valgono 10 EGP di sconto — circa l’1%, fino all’1,5% da Gold. Rimborsi e crediti per i ritardi sono un’altra cosa e arrivano in EGP.',
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
    w1b: 'Preise in EUR, USD, GBP oder RUB, bezahlt wird in EGP — bar beim Fahrer, ohne vorher irgendetwas einzurichten. Ohne ägyptische SIM: Hotel und Zimmernummer wählen oder einen GPS-Pin am Strand setzen.',
    w2t: 'Lieferzeiten zum Verlassen',
    w2b: 'Die versprochene Zeit ist die echte Zeit. Über 15 Minuten zu spät? Die Gutschrift kommt automatisch. Eine feste Liefergebühr je Zone, sichtbar vor der Bestellung — keine Kilometer-Überraschungen, keine Servicegebühr.',
    w3t: 'Kuratiert statt überfüllt',
    w3b: 'Fünfzig Küchen, die wir besuchen und denen wir vertrauen — nicht fünfhundert, die wir nie gesehen haben. Menüs von Menschen übersetzt, Allergene klar markiert.',
    partner_k: 'Für Restaurants', partner_t: 'Bring deine Küche auf Sharm Eats.',
    partner_b: 'Verkaufe direkt im Browser — volles Partner-Portal, keine Hardware nötig. Drei-Spuren-Küchenboard, Menü noch am selben Tag online, Kommissionsrabatt für Top-Partner.',
    partner_cta: 'Restaurant hinzufügen',
    partner_email: 'oder schreib an hello@sharmeats.online',
    partner_terms: 'Partnerbedingungen',
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
    rw1t: 'Punkte mit echtem Wert', rw1b: 'Je 10 EGP Umsatz gibt es einen Punkt, und 100 Punkte werden zu 10 EGP Rabatt auf die nächste Bestellung.',
    rw2t: 'Von Bronze bis Gold', rw2b: 'Mehr bestellen heißt schneller sammeln: Silber 1,25×, Gold 1,5×.',
    rw3t: '50/50-EGP-Referrals', rw3b: 'Schenk einem Freund 50 EGP auf die erste Bestellung ab 150 EGP — und bekomm 50 EGP Rabatt, sobald diese geliefert ist.',
    faq_k: 'Fragen', faq_t: 'Was wirklich gefragt wird.',
    faq_q1: 'Wohin liefert ihr?',
    faq_a1: 'In die elf oben genannten Zonen. Jede Küche liefert etwa 8 km weit, ein Restaurant am anderen Ende der Stadt kann von deiner Adresse aus also außer Reichweite sein.',
    faq_q2: 'Wie bezahle ich?',
    faq_a2: 'Bar beim Fahrer, wenn die Bestellung ankommt. Kartenzahlung ist noch nicht aktiv — sobald sie es ist, steht es hier.',
    faq_q3: 'Was kostet die Lieferung?',
    faq_a3: 'Je nach Zone zwischen 20 und 40 EGP, vollständig sichtbar vor dem Bestellen. Eine Servicegebühr kommt nicht obendrauf.',
    faq_q4: 'Gibt es einen Mindestbestellwert?',
    faq_a4: 'Meist 50 EGP, je nach Restaurant unterschiedlich. Liegt dein Warenkorb darunter, sagt dir die App, wie viel fehlt, und lässt dich erst danach bestellen.',
    faq_q5: 'Bekommt der Fahrer das Trinkgeld ganz?',
    faq_a5: 'Vollständig — und die Liefergebühr ebenso. Unser Anteil kommt aus der Restaurantprovision, nie aus dem Lohn des Fahrers oder deinem Trinkgeld.',
    faq_q6: 'Was bekomme ich zurück?',
    faq_a6: 'Punkte: 10 EGP ergeben einen Punkt, 100 Punkte ergeben 10 EGP Rabatt — rund 1 %, mit Gold bis 1,5 %. Erstattungen und Verspätungs-Gutschriften laufen getrennt davon und kommen in EGP.',
    zones_k: 'Abdeckung', zones_t: 'Elf Zonen — ganz Sharm.',
    zones_n: 'Von Naama Bay bis Nabq — der volle Lieferpreis steht vor der Bestellung fest. Keine Servicegebühr, keine Überraschungen.',
    soul_k: 'Lokale Seele', soul_t: 'Aus Sharm, für Sharm.',
    soul_b: 'Gebaut von Leuten, die hier leben — kein Kairo-Klon. Wir wissen, wo die Einheimischen anstehen, welche Hotels drei Lobbys haben, und dass Abendessen am Strand jeden Speisesaal schlägt.',
    dl_t: 'Abendessen? Ein Tap.', dl_s: 'Gratis für iOS und Android. Von Naama Bay bis Nabq — 11 Zonen in Sharm.',
    foot_tag: 'Essenslieferung, gemacht für Sharm El Sheikh.', foot_contact: 'Restaurants & Partner:',
  },
};
