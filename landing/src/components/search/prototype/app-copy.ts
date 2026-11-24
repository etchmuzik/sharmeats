import type { Lang as Locale } from "../routes";

export type AppCopy = {
  proto: {
    title: string;
    deck: string;
    note: string;
    customer: string;
    driver: string;
    restaurant: string;
    openOrdering: string;
    link: string;
  };
  customer: {
    zone: string;
    search: string;
    liveOrder: string;
    tabHome: string;
    tabOrders: string;
    tabRewards: string;
    tabAccount: string;
    track: string;
    arriving: string;
    addresses: string;
    history: string;
    languages: string;
  };
  driver: {
    offer: string;
    pickup: string;
    dropoff: string;
    accept: string;
    pass: string;
    onTheWay: string;
    navigate: string;
    chat: string;
    today: string;
    deliveries: string;
    tips: string;
    earnings: string;
    active: string;
    done: string;
    arrived: string;
  };
  restaurant: {
    open: string;
    pause: string;
    queue: string;
    newLane: string;
    preparing: string;
    ready: string;
    accept: string;
    prep: string;
    ticket: string;
    menu: string;
    available: string;
    soldOut: string;
    cash: string;
    back: string;
  };
};

export const appCopy: Record<Locale, AppCopy> = {
  en: {
    proto: {
      title: "The app, before it ships",
      deck: "Tap through the customer, driver and restaurant apps. Same brand, same flows, real screens.",
      note: "Prototype. Nothing here places an order or pays anyone.",
      customer: "Customer",
      driver: "Driver",
      restaurant: "Restaurant",
      openOrdering: "Order on the site",
      link: "App design",
    },
    customer: {
      zone: "Naama Bay",
      search: "Search kitchens",
      liveOrder: "Order SM-8F3K is on the way · 12 min",
      tabHome: "Home",
      tabOrders: "Orders",
      tabRewards: "Rewards",
      tabAccount: "Account",
      track: "Track order",
      arriving: "Arriving {time}",
      addresses: "Addresses",
      history: "Past orders",
      languages: "Language",
    },
    driver: {
      offer: "New delivery",
      pickup: "Pick up",
      dropoff: "Drop at",
      accept: "Accept",
      pass: "Pass",
      onTheWay: "On the way",
      navigate: "Navigate",
      chat: "Chat",
      today: "Today",
      deliveries: "deliveries",
      tips: "tips",
      earnings: "Earnings",
      active: "Picked up",
      done: "Delivered",
      arrived: "Arrived",
    },
    restaurant: {
      open: "Open",
      pause: "Pause kitchen",
      queue: "Queue",
      newLane: "New",
      preparing: "Preparing",
      ready: "Ready",
      accept: "Accept",
      prep: "min",
      ticket: "Ticket",
      menu: "Menu",
      available: "Available",
      soldOut: "Sold out",
      cash: "Cash on delivery",
      back: "Back",
    },
  },
  ar: {
    proto: {
      title: "التطبيق قبل الإطلاق",
      deck: "تنقّل بين تطبيق العميل والسائق والمطعم. نفس الهوية ونفس المسارات وشاشات حقيقية.",
      note: "نموذج تجريبي: لا يتم هنا أي طلب أو دفع.",
      customer: "العميل",
      driver: "السائق",
      restaurant: "المطعم",
      openOrdering: "اطلب من الموقع",
      link: "تصميم التطبيق",
    },
    customer: {
      zone: "نعمة باي",
      search: "ابحث عن مطبخ",
      liveOrder: "الطلب SM-8F3K في الطريق · 12 دقيقة",
      tabHome: "الرئيسية",
      tabOrders: "طلباتي",
      tabRewards: "المكافآت",
      tabAccount: "حسابي",
      track: "تابع الطلب",
      arriving: "يصل {time}",
      addresses: "العناوين",
      history: "طلبات سابقة",
      languages: "اللغة",
    },
    driver: {
      offer: "توصيل جديد",
      pickup: "الاستلام",
      dropoff: "التسليم",
      accept: "قبول",
      pass: "تجاهل",
      onTheWay: "في الطريق",
      navigate: "الملاحة",
      chat: "محادثة",
      today: "اليوم",
      deliveries: "توصيلات",
      tips: "بقشيش",
      earnings: "الأرباح",
      active: "تم الاستلام",
      done: "تم التسليم",
      arrived: "وصلت",
    },
    restaurant: {
      open: "مفتوح",
      pause: "إيقاف المطبخ",
      queue: "قائمة الطلبات",
      newLane: "جديد",
      preparing: "قيد التحضير",
      ready: "جاهز",
      accept: "قبول",
      prep: "دقيقة",
      ticket: "طلب",
      menu: "القائمة",
      available: "متوفر",
      soldOut: "غير متوفر",
      cash: "نقداً عند التسليم",
      back: "رجوع",
    },
  },
  ru: {
    proto: {
      title: "Приложение до запуска",
      deck: "Пройдите по приложениям клиента, водителя и ресторана. Тот же бренд, те же сценарии, реальные экраны.",
      note: "Прототип: здесь ничего не заказывается и не оплачивается.",
      customer: "Клиент",
      driver: "Водитель",
      restaurant: "Ресторан",
      openOrdering: "Заказать на сайте",
      link: "Дизайн приложения",
    },
    customer: {
      zone: "Наама-Бей",
      search: "Поиск кухонь",
      liveOrder: "Заказ SM-8F3K в пути · 12 мин",
      tabHome: "Главная",
      tabOrders: "Заказы",
      tabRewards: "Бонусы",
      tabAccount: "Профиль",
      track: "Отследить",
      arriving: "Прибудет {time}",
      addresses: "Адреса",
      history: "Прошлые заказы",
      languages: "Язык",
    },
    driver: {
      offer: "Новый заказ",
      pickup: "Забрать",
      dropoff: "Доставить",
      accept: "Принять",
      pass: "Пропустить",
      onTheWay: "В пути",
      navigate: "Маршрут",
      chat: "Чат",
      today: "Сегодня",
      deliveries: "доставок",
      tips: "чаевые",
      earnings: "Доход",
      active: "Забрано",
      done: "Доставлено",
      arrived: "На месте",
    },
    restaurant: {
      open: "Открыто",
      pause: "Пауза кухни",
      queue: "Очередь",
      newLane: "Новые",
      preparing: "Готовятся",
      ready: "Готовы",
      accept: "Принять",
      prep: "мин",
      ticket: "Заказ",
      menu: "Меню",
      available: "В наличии",
      soldOut: "Нет",
      cash: "Наличными при доставке",
      back: "Назад",
    },
  },
  it: {
    proto: {
      title: "L'app, prima del lancio",
      deck: "Attraversa le app cliente, rider e ristorante. Stesso marchio, stessi flussi, schermate reali.",
      note: "Prototipo: qui non si ordina e non si paga nulla.",
      customer: "Cliente",
      driver: "Rider",
      restaurant: "Ristorante",
      openOrdering: "Ordina sul sito",
      link: "Design dell'app",
    },
    customer: {
      zone: "Naama Bay",
      search: "Cerca cucine",
      liveOrder: "L'ordine SM-8F3K è in arrivo · 12 min",
      tabHome: "Home",
      tabOrders: "Ordini",
      tabRewards: "Premi",
      tabAccount: "Account",
      track: "Segui ordine",
      arriving: "Arriva {time}",
      addresses: "Indirizzi",
      history: "Ordini passati",
      languages: "Lingua",
    },
    driver: {
      offer: "Nuova consegna",
      pickup: "Ritiro",
      dropoff: "Consegna",
      accept: "Accetta",
      pass: "Passa",
      onTheWay: "In arrivo",
      navigate: "Naviga",
      chat: "Chat",
      today: "Oggi",
      deliveries: "consegne",
      tips: "mance",
      earnings: "Guadagni",
      active: "Ritirato",
      done: "Consegnato",
      arrived: "Arrivato",
    },
    restaurant: {
      open: "Aperto",
      pause: "Pausa cucina",
      queue: "Coda",
      newLane: "Nuovi",
      preparing: "In preparazione",
      ready: "Pronti",
      accept: "Accetta",
      prep: "min",
      ticket: "Comanda",
      menu: "Menu",
      available: "Disponibile",
      soldOut: "Esaurito",
      cash: "Contanti alla consegna",
      back: "Indietro",
    },
  },
  de: {
    proto: {
      title: "Die App, vor dem Start",
      deck: "Tippe dich durch Kunden-, Fahrer- und Restaurant-App. Gleiche Marke, gleiche Abläufe, echte Screens.",
      note: "Prototyp: hier wird nichts bestellt und nichts bezahlt.",
      customer: "Kunde",
      driver: "Fahrer",
      restaurant: "Restaurant",
      openOrdering: "Auf der Website bestellen",
      link: "App-Design",
    },
    customer: {
      zone: "Naama Bay",
      search: "Küchen suchen",
      liveOrder: "Bestellung SM-8F3K ist unterwegs · 12 Min",
      tabHome: "Start",
      tabOrders: "Bestellungen",
      tabRewards: "Prämien",
      tabAccount: "Konto",
      track: "Bestellung verfolgen",
      arriving: "Ankunft {time}",
      addresses: "Adressen",
      history: "Frühere Bestellungen",
      languages: "Sprache",
    },
    driver: {
      offer: "Neue Lieferung",
      pickup: "Abholen",
      dropoff: "Bringen",
      accept: "Annehmen",
      pass: "Weiter",
      onTheWay: "Unterwegs",
      navigate: "Route",
      chat: "Chat",
      today: "Heute",
      deliveries: "Lieferungen",
      tips: "Trinkgeld",
      earnings: "Verdienst",
      active: "Abgeholt",
      done: "Geliefert",
      arrived: "Angekommen",
    },
    restaurant: {
      open: "Geöffnet",
      pause: "Küche pausieren",
      queue: "Warteschlange",
      newLane: "Neu",
      preparing: "In Arbeit",
      ready: "Fertig",
      accept: "Annehmen",
      prep: "Min",
      ticket: "Bon",
      menu: "Karte",
      available: "Verfügbar",
      soldOut: "Ausverkauft",
      cash: "Bar bei Lieferung",
      back: "Zurück",
    },
  },
};
