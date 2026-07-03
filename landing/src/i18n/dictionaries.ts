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

export interface Dictionary {
  hero: {
    eyebrow: string;
    title: string;
    subtitle: string;
    cta: string;
    notSpam: string;
  };
  valueProps: {
    title: string;
    items: { title: string; body: string }[];
  };
  waitlist: {
    title: string;
    emailLabel: string;
    emailPlaceholder: string;
    whatsappLabel: string;
    whatsappPlaceholder: string;
    submit: string;
    submitting: string;
    success: string;
    duplicate: string;
    errorEmail: string;
    errorGeneric: string;
  };
  footer: {
    tagline: string;
    contact: string;
    contactEmail: string;
  };
}

export const dictionaries: Record<Locale, Dictionary> = {
  en: {
    hero: {
      eyebrow: 'Sharm El Sheikh — now live',
      title: 'Food delivery built for Sharm.',
      subtitle:
        'Five languages. Hotel-room delivery. Real ETAs with credits when we miss them. The food app tourists and residents actually want.',
      cta: 'Get the app',
      notSpam: 'No spam. One message when we open in your area.',
    },
    valueProps: {
      title: 'Why we think Sharm deserves better',
      items: [
        {
          title: 'Tourist-first, by design',
          body: 'Order in your hotel room. Pay with your home-country card. See prices in EUR, USD, GBP, or RUB. No Egyptian SIM required.',
        },
        {
          title: 'Honest delivery promises',
          body: 'We tell you the ETA up front. If we miss it by 15 minutes, you get credit automatically — no support ticket needed.',
        },
        {
          title: 'Curated, not crowded',
          body: 'Fifty restaurants we actually trust, not five hundred we never visited. Every restaurant has an English menu and clear allergen flags.',
        },
      ],
    },
    waitlist: {
      title: 'Get the Sharm Eats app',
      emailLabel: 'Email',
      emailPlaceholder: 'you@example.com',
      whatsappLabel: 'WhatsApp (with country code)',
      whatsappPlaceholder: '+20 100 000 0000',
      submit: 'Join the waitlist',
      submitting: 'Joining…',
      success: 'You are on the list. We will message you when we open.',
      duplicate: 'You are already on the list. We will be in touch.',
      errorEmail: 'Please enter a valid email.',
      errorGeneric: 'Something went wrong. Please try again.',
    },
    footer: {
      tagline: 'A new food app for Sharm El Sheikh — built in 2026.',
      contact: 'Restaurant or hotel? Reach out:',
      contactEmail: 'hello@sharmeats.example',
    },
  },
  ar: {
    hero: {
      eyebrow: 'شرم الشيخ — متاح الآن',
      title: 'توصيل طعام مصمم لشرم.',
      subtitle:
        'خمس لغات. توصيل إلى غرفة الفندق. أوقات وصول صادقة مع رصيد تعويضي لو تأخّرنا. تطبيق الطعام اللي السياح والمقيمين بيدوّروا عليه.',
      cta: 'حمّل التطبيق',
      notSpam: 'لا رسائل مزعجة. رسالة واحدة لما نفتح في منطقتك.',
    },
    valueProps: {
      title: 'ليه شرم تستحق أحسن من كده',
      items: [
        {
          title: 'مصمم للسياح أولًا',
          body: 'اطلب من غرفتك في الفندق. ادفع ببطاقتك من بلدك. شوف الأسعار باليورو أو الدولار أو الإسترليني أو الروبل. مش محتاج شريحة مصرية.',
        },
        {
          title: 'وعود توصيل صادقة',
          body: 'بنقولك وقت الوصول من الأول. لو تأخّرنا ١٥ دقيقة، بتاخد رصيد تلقائي — من غير ما تكلّم خدمة العملاء.',
        },
        {
          title: 'مختار بعناية، مش مزحوم',
          body: 'خمسين مطعم بنثق فيهم فعلًا، مش ٥٠٠ مطعم ما زُرنا أي واحد منهم. كل مطعم عنده قائمة بالإنجليزي وعلامات واضحة لمسببات الحساسية.',
        },
      ],
    },
    waitlist: {
      title: 'كن أول من يعرف عند الإطلاق',
      emailLabel: 'البريد الإلكتروني',
      emailPlaceholder: 'you@example.com',
      whatsappLabel: 'واتساب (مع كود الدولة)',
      whatsappPlaceholder: '+20 100 000 0000',
      submit: 'انضم',
      submitting: 'جاري الانضمام…',
      success: 'أنت في القائمة. هنبعتلك رسالة لما نفتح.',
      duplicate: 'أنت مسجّل بالفعل. هنتواصل معاك.',
      errorEmail: 'من فضلك أدخل بريد صحيح.',
      errorGeneric: 'حصل خطأ. حاول تاني.',
    },
    footer: {
      tagline: 'تطبيق طعام جديد لشرم الشيخ — قيد البناء في ٢٠٢٦.',
      contact: 'مطعم أو فندق؟ تواصل معنا:',
      contactEmail: 'hello@sharmeats.example',
    },
  },
  ru: {
    hero: {
      eyebrow: 'Шарм-эль-Шейх — уже доступно',
      title: 'Доставка еды, созданная для Шарма.',
      subtitle:
        'Пять языков. Доставка в номер отеля. Честное время доставки — если опоздаем, автоматически зачислим кредит. Приложение, которое действительно нужно туристам и жителям.',
      cta: 'Скачать приложение',
      notSpam: 'Никакого спама. Одно сообщение, когда мы откроемся в вашем районе.',
    },
    valueProps: {
      title: 'Почему Шарм заслуживает лучшего',
      items: [
        {
          title: 'Для туристов с первого дня',
          body: 'Заказывайте в номер. Платите картой своей страны. Цены в EUR, USD, GBP или RUB. Без египетской SIM-карты.',
        },
        {
          title: 'Честные сроки доставки',
          body: 'Заранее показываем точное время. Опоздаем на 15 минут — автоматически зачислим кредит. Без обращений в поддержку.',
        },
        {
          title: 'Отобранные, не массовка',
          body: 'Пятьдесят ресторанов, которым мы доверяем, а не пятьсот наугад. Меню на английском и понятные пометки об аллергенах.',
        },
      ],
    },
    waitlist: {
      title: 'Узнайте первыми о запуске',
      emailLabel: 'Email',
      emailPlaceholder: 'you@example.com',
      whatsappLabel: 'WhatsApp (с кодом страны)',
      whatsappPlaceholder: '+7 900 000 00 00',
      submit: 'В список',
      submitting: 'Записываем…',
      success: 'Вы в списке. Напишем, как только откроемся.',
      duplicate: 'Вы уже в списке. Мы с вами свяжемся.',
      errorEmail: 'Введите корректный email.',
      errorGeneric: 'Что-то пошло не так. Попробуйте ещё раз.',
    },
    footer: {
      tagline: 'Новое приложение доставки еды для Шарм-эль-Шейха — 2026.',
      contact: 'Ресторан или отель? Свяжитесь с нами:',
      contactEmail: 'hello@sharmeats.example',
    },
  },
  it: {
    hero: {
      eyebrow: 'Sharm El Sheikh — ora disponibile',
      title: 'Consegna cibo pensata per Sharm.',
      subtitle:
        'Cinque lingue. Consegna in camera. Tempi reali con credito automatico se sbagliamo. L\'app che turisti e residenti aspettavano.',
      cta: 'Scarica l’app',
      notSpam: 'Niente spam. Un messaggio quando apriamo nella tua zona.',
    },
    valueProps: {
      title: 'Perché Sharm merita di meglio',
      items: [
        {
          title: 'Pensata per i turisti',
          body: 'Ordina dalla camera. Paga con la carta del tuo paese. Prezzi in EUR, USD, GBP o RUB. Niente SIM egiziana.',
        },
        {
          title: 'Tempi onesti',
          body: 'Diciamo subito quando arriva. Se siamo in ritardo di 15 minuti, ricevi un credito automatico — senza chiamare l\'assistenza.',
        },
        {
          title: 'Selezionati, non affollati',
          body: 'Cinquanta ristoranti di cui ci fidiamo davvero. Menu in inglese e indicazioni chiare sugli allergeni.',
        },
      ],
    },
    waitlist: {
      title: 'Scopri per primo quando apriamo',
      emailLabel: 'Email',
      emailPlaceholder: 'tu@example.com',
      whatsappLabel: 'WhatsApp (con prefisso paese)',
      whatsappPlaceholder: '+39 333 000 0000',
      submit: 'Iscriviti',
      submitting: 'Iscrivendo…',
      success: 'Sei in lista. Ti scriviamo all\'apertura.',
      duplicate: 'Sei già in lista. Ti scriveremo noi.',
      errorEmail: 'Email non valida.',
      errorGeneric: 'Qualcosa è andato storto. Riprova.',
    },
    footer: {
      tagline: 'Una nuova app di consegna per Sharm El Sheikh — costruita nel 2026.',
      contact: 'Ristorante o hotel? Scrivici:',
      contactEmail: 'hello@sharmeats.example',
    },
  },
  de: {
    hero: {
      eyebrow: 'Sharm El Sheikh — jetzt verfügbar',
      title: 'Lieferdienst, gemacht für Sharm.',
      subtitle:
        'Fünf Sprachen. Lieferung aufs Zimmer. Ehrliche Lieferzeiten mit automatischem Guthaben, wenn wir uns verspäten. Die Food-App, die Touristen und Bewohner wirklich brauchen.',
      cta: 'App holen',
      notSpam: 'Kein Spam. Eine Nachricht, sobald wir in deinem Gebiet starten.',
    },
    valueProps: {
      title: 'Warum Sharm Besseres verdient',
      items: [
        {
          title: 'Für Touristen entwickelt',
          body: 'Bestelle aufs Zimmer. Zahle mit deiner heimischen Karte. Preise in EUR, USD, GBP oder RUB. Keine ägyptische SIM nötig.',
        },
        {
          title: 'Ehrliche Lieferzeiten',
          body: 'Wir nennen die Ankunftszeit im Voraus. Wenn wir 15 Minuten zu spät sind, gibt es automatisch Guthaben — ohne Anruf beim Support.',
        },
        {
          title: 'Kuratiert, nicht überfüllt',
          body: 'Fünfzig Restaurants, denen wir wirklich vertrauen. Englische Speisekarten und klare Allergen-Hinweise.',
        },
      ],
    },
    waitlist: {
      title: 'Sei als Erste*r dabei, wenn wir starten',
      emailLabel: 'E-Mail',
      emailPlaceholder: 'du@example.com',
      whatsappLabel: 'WhatsApp (mit Ländervorwahl)',
      whatsappPlaceholder: '+49 170 0000000',
      submit: 'Beitreten',
      submitting: 'Eintragen…',
      success: 'Du bist auf der Liste. Wir melden uns bei Start.',
      duplicate: 'Du stehst bereits auf der Liste. Wir melden uns.',
      errorEmail: 'Bitte eine gültige E-Mail eingeben.',
      errorGeneric: 'Etwas ist schiefgelaufen. Bitte erneut versuchen.',
    },
    footer: {
      tagline: 'Eine neue Liefer-App für Sharm El Sheikh — gebaut 2026.',
      contact: 'Restaurant oder Hotel? Schreib uns:',
      contactEmail: 'hello@sharmeats.example',
    },
  },
};
