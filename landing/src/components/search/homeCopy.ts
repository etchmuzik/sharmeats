import type { Locale } from '@/i18n/dictionaries';

type HomeCopy = {
  title: string; city: string; intro: string; order: string; zones: string; kitchens: string;
  menus: string; dishes: readonly [string, string, string]; notes: readonly [string, string, string];
  checkLocation: string; hotel: string; how: string; demo: string; map: string; skip: string;
  help: string; apple: string; partners: string; ride: string; merchant: string; pricing: string;
  handoff: string; app: string;
};

export const homeCopy: Record<Locale, HomeCopy> = {
  en: {
    title: 'Food delivery in', city: 'Sharm El Sheikh.', intro: 'From the kitchens of Sharm to your hotel, flat or a meeting point by the sea.',
    order: 'Order food', zones: 'Choose your area', kitchens: 'From the kitchens of Sharm.', menus: 'Explore restaurant menus',
    dishes: ['Grilled Red Sea fish', 'Egyptian koshary', 'The burger'],
    notes: ['Grilled with lemon and herbs.', 'Lentils, pasta and crisp onions.', 'A seared patty in a soft bun.'],
    checkLocation: 'Check your delivery area', hotel: 'Ordering to a hotel', how: 'How ordering works', demo: 'Explore the app prototype',
    map: 'Illustrated map of delivery areas', skip: 'Skip to the menus', help: 'Customer support', apple: 'Get the iPhone app',
    partners: 'For the people who feed Sharm.', ride: 'Apply to deliver', merchant: 'Add your restaurant',
    pricing: 'Choose a restaurant and check its menu, minimum and delivery fee before confirming.',
    handoff: 'At a hotel or resort, check the meeting point with reception and include it in your delivery instructions.',
    app: 'Open Sharm Eats to check what each kitchen can deliver to your address.',
  },
  ar: {
    title: 'توصيل أكل في', city: 'شرم الشيخ.', intro: 'من مطابخ شرم لحد فندقك أو بيتك أو نقطة تقابل فيها المندوب على البحر.',
    order: 'اطلب أكل', zones: 'اختار منطقتك', kitchens: 'من مطابخ شرم.', menus: 'شوف منيوهات المطاعم',
    dishes: ['سمك البحر الأحمر المشوي', 'كشري مصري', 'برجر'],
    notes: ['مشوي بالليمون والأعشاب.', 'عدس ومكرونة وبصل مقرمش.', 'برجر مشوي في عيش طري.'],
    checkLocation: 'شوف مناطق التوصيل', hotel: 'التوصيل للفنادق', how: 'إزاي تطلب', demo: 'جرّب نموذج التطبيق',
    map: 'خريطة توضيحية لمناطق التوصيل', skip: 'انتقل للمنيوهات', help: 'خدمة العملاء', apple: 'نزّل تطبيق الآيفون',
    partners: 'للي بيطبخوا ويوصّلوا في شرم.', ride: 'قدّم كمندوب', merchant: 'سجّل مطعمك',
    pricing: 'اختار مطعم وشوف المنيو والحد الأدنى ورسوم التوصيل قبل ما تأكد الطلب.',
    handoff: 'لو في فندق أو منتجع، اسأل الاستقبال هتقابل المندوب فين واكتب المكان في تعليمات التوصيل.',
    app: 'افتح شرم إيتس عشان تشوف إيه المطاعم اللي بتوصل لعنوانك.',
  },
  ru: {
    title: 'Доставка еды в', city: 'Шарм-эль-Шейхе.', intro: 'Из ресторанов Шарма в отель, к вам домой или к месту встречи у моря.',
    order: 'Заказать еду', zones: 'Выбрать район', kitchens: 'На кухнях Шарма.', menus: 'Посмотреть меню ресторанов',
    dishes: ['Рыба из Красного моря', 'Египетский кошари', 'Бургер'],
    notes: ['На гриле с лимоном и зеленью.', 'Чечевица, макароны и хрустящий лук.', 'Котлета на гриле в мягкой булочке.'],
    checkLocation: 'Проверить район доставки', hotel: 'Доставка в отель', how: 'Как заказать', demo: 'Посмотреть прототип приложения',
    map: 'Схематическая карта районов доставки', skip: 'Перейти к меню', help: 'Поддержка клиентов', apple: 'Скачать для iPhone',
    partners: 'Тем, кто готовит и доставляет в Шарме.', ride: 'Стать курьером', merchant: 'Подключить ресторан',
    pricing: 'Выберите ресторан и проверьте меню, минимальную сумму и стоимость доставки до подтверждения.',
    handoff: 'В отеле уточните на стойке регистрации, где можно встретить курьера, и укажите это место в заказе.',
    app: 'Откройте Sharm Eats, чтобы узнать, какие рестораны доставляют по вашему адресу.',
  },
  it: {
    title: 'Consegna di cibo a', city: 'Sharm el Sheikh.', intro: 'Dalle cucine di Sharm al tuo hotel, a casa o a un punto d’incontro sul mare.',
    order: 'Ordina da mangiare', zones: 'Scegli la zona', kitchens: 'Dalle cucine di Sharm.', menus: 'Scopri i menu dei ristoranti',
    dishes: ['Pesce del Mar Rosso', 'Koshary egiziano', 'Burger'],
    notes: ['Alla griglia con limone ed erbe.', 'Lenticchie, pasta e cipolle croccanti.', 'Carne alla piastra in un panino morbido.'],
    checkLocation: 'Verifica la zona di consegna', hotel: 'Consegne in hotel', how: 'Come ordinare', demo: 'Esplora il prototipo dell’app',
    map: 'Mappa illustrata delle zone di consegna', skip: 'Vai ai menu', help: 'Assistenza clienti', apple: 'Scarica l’app per iPhone',
    partners: 'Per chi cucina e consegna a Sharm.', ride: 'Diventa rider', merchant: 'Aggiungi il tuo ristorante',
    pricing: 'Scegli un ristorante e controlla il menu, l’ordine minimo e le spese di consegna prima di confermare.',
    handoff: 'In hotel, chiedi alla reception dove incontrare il rider e indica quel punto nelle istruzioni di consegna.',
    app: 'Apri Sharm Eats per vedere quali ristoranti consegnano al tuo indirizzo.',
  },
  de: {
    title: 'Essenslieferung in', city: 'Sharm el Sheikh.', intro: 'Aus den Küchen von Sharm in dein Hotel, nach Hause oder zu einem Treffpunkt am Meer.',
    order: 'Essen bestellen', zones: 'Liefergebiet wählen', kitchens: 'Aus den Küchen von Sharm.', menus: 'Speisekarten entdecken',
    dishes: ['Fisch aus dem Roten Meer', 'Ägyptisches Koshari', 'Burger'],
    notes: ['Gegrillt, mit Zitrone und Kräutern.', 'Linsen, Nudeln und knusprige Zwiebeln.', 'Ein gegrilltes Patty im weichen Brötchen.'],
    checkLocation: 'Liefergebiet prüfen', hotel: 'Lieferung ins Hotel', how: 'So bestellst du', demo: 'App-Prototyp ansehen',
    map: 'Schematische Karte der Liefergebiete', skip: 'Zu den Speisekarten', help: 'Kundenservice', apple: 'App für iPhone laden',
    partners: 'Für alle, die in Sharm kochen und liefern.', ride: 'Als Fahrer bewerben', merchant: 'Restaurant anmelden',
    pricing: 'Wähle ein Restaurant und prüfe Speisekarte, Mindestbestellwert und Liefergebühr vor der Bestätigung.',
    handoff: 'Frage im Hotel an der Rezeption nach dem Treffpunkt und gib ihn bei der Bestellung an.',
    app: 'Öffne Sharm Eats, um zu sehen, welche Restaurants an deine Adresse liefern.',
  },
};
