// Illustrative kitchens, dishes and prices from the November interactive prototype.
import type { Lang as Locale } from "../routes";

export type Localized = Record<Locale, string>;

export type DishGroup = "grill" | "bowls" | "bread" | "mezze" | "sweets" | "drinks";

export type Dish = {
  id: string;
  group: DishGroup;
  name: Localized;
  note: Localized;
};

export type Kitchen = {
  id: string;
  name: string;
  tagline: Localized;
  zoneId: string;
  eta: number;
  image?: string;
};

export type MenuEntry = {
  kitchenId: string;
  dishId: string;
  price: number;
  signature?: boolean;
};

/** Shown above each menu block, in menu order. */
export const groupOrder: DishGroup[] = ["grill", "bowls", "bread", "mezze", "sweets", "drinks"];

export const groupLabels: Record<DishGroup, Localized> = {
  grill: {
    en: "From the grill",
    ar: "من الشواية",
    ru: "С гриля",
    it: "Dalla brace",
    de: "Vom Grill",
  },
  bowls: {
    en: "Rice and bowls",
    ar: "أطباق الأرز",
    ru: "Рис и боулы",
    it: "Riso e bowl",
    de: "Reis und Bowls",
  },
  bread: {
    en: "Bread and sandwiches",
    ar: "خبز وسندويتشات",
    ru: "Хлеб и сэндвичи",
    it: "Pane e panini",
    de: "Brot und Sandwiches",
  },
  mezze: {
    en: "Mezze and sides",
    ar: "مزة ومقبلات",
    ru: "Мезе и закуски",
    it: "Mezze e contorni",
    de: "Mezze und Beilagen",
  },
  sweets: {
    en: "Sweets",
    ar: "حلويات",
    ru: "Сладкое",
    it: "Dolci",
    de: "Süßes",
  },
  drinks: {
    en: "Drinks",
    ar: "مشروبات",
    ru: "Напитки",
    it: "Bevande",
    de: "Getränke",
  },
};

export const dishes: Dish[] = [
  {
    id: "bream",
    group: "grill",
    name: {
      en: "Whole grilled sea bream",
      ar: "دنيس مشوي كامل",
      ru: "Целый дорадо на углях",
      it: "Orata intera alla brace",
      de: "Ganze Dorade vom Grill",
    },
    note: {
      en: "Charcoal, garlic and lemon, with tahini.",
      ar: "فحم وثوم وليمون، مع الطحينة.",
      ru: "Уголь, чеснок и лимон, с тахини.",
      it: "Carbone, aglio e limone, con tahina.",
      de: "Holzkohle, Knoblauch und Zitrone, mit Tahini.",
    },
  },
  {
    id: "fillet",
    group: "grill",
    name: {
      en: "Grilled fish fillet",
      ar: "فيليه سمك مشوي",
      ru: "Филе рыбы на гриле",
      it: "Filetto di pesce alla griglia",
      de: "Fischfilet vom Grill",
    },
    note: {
      en: "Sea bass, olive oil, cumin, rice.",
      ar: "قاروص وزيت زيتون وكمون وأرز.",
      ru: "Сибас, оливковое масло, зира, рис.",
      it: "Branzino, olio d'oliva, cumino, riso.",
      de: "Wolfsbarsch, Olivenöl, Kreuzkümmel, Reis.",
    },
  },
  {
    id: "shrimp",
    group: "grill",
    name: {
      en: "Charcoal shrimp",
      ar: "جمبري على الفحم",
      ru: "Креветки на углях",
      it: "Gamberi alla brace",
      de: "Garnelen von der Kohle",
    },
    note: {
      en: "Sixteen shrimp, chilli and lime butter.",
      ar: "ستة عشر جمبرياً بالفلفل وزبدة الليمون.",
      ru: "Шестнадцать креветок, чили и лаймовое масло.",
      it: "Sedici gamberi, peperoncino e burro al lime.",
      de: "Sechzehn Garnelen, Chili und Limettenbutter.",
    },
  },
  {
    id: "chicken",
    group: "grill",
    name: {
      en: "Half grilled chicken",
      ar: "نصف فرخة مشوية",
      ru: "Половина цыплёнка на гриле",
      it: "Mezzo pollo alla brace",
      de: "Halbes Grillhähnchen",
    },
    note: {
      en: "Charcoal, lemon, oregano, garlic sauce.",
      ar: "فحم وليمون وزعتر وصوص ثوم.",
      ru: "Уголь, лимон, орегано, чесночный соус.",
      it: "Carbone, limone, origano, salsa all'aglio.",
      de: "Holzkohle, Zitrone, Oregano, Knoblauchsauce.",
    },
  },
  {
    id: "kofta",
    group: "grill",
    name: {
      en: "Kofta kebab",
      ar: "كباب كفتة",
      ru: "Кебаб кофта",
      it: "Kofta kebab",
      de: "Kofta Kebab",
    },
    note: {
      en: "Charcoal beef, parsley, onion, flatbread.",
      ar: "لحم بقري على الفحم وبقدونس وبصل وخبز.",
      ru: "Говядина на углях, петрушка, лук, лепёшка.",
      it: "Manzo alla brace, prezzemolo, cipolla, pane.",
      de: "Rind vom Grill, Petersilie, Zwiebel, Fladenbrot.",
    },
  },
  {
    id: "koshary",
    group: "bowls",
    name: { en: "Koshary", ar: "كشري", ru: "Кошари", it: "Koshary", de: "Koshary" },
    note: {
      en: "Rice, lentils, macaroni, spiced tomato, crisp onions.",
      ar: "أرز وعدس ومكرونة وصلصة وبصل مقرمش.",
      ru: "Рис, чечевица, макароны, пряный томат, лук.",
      it: "Riso, lenticchie, maccheroni, pomodoro speziato, cipolle.",
      de: "Reis, Linsen, Makkaroni, Tomate, Röstzwiebeln.",
    },
  },
  {
    id: "fattah",
    group: "bowls",
    name: { en: "Fattah", ar: "فتة", ru: "Фаттах", it: "Fattah", de: "Fattah" },
    note: {
      en: "Rice, crisp bread, lamb, garlic yoghurt.",
      ar: "أرز وخبز محمص ولحم ضاني وزبادي بالثوم.",
      ru: "Рис, хрустящий хлеб, баранина, чесночный йогурт.",
      it: "Riso, pane croccante, agnello, yogurt all'aglio.",
      de: "Reis, knuspriges Brot, Lamm, Knoblauchjoghurt.",
    },
  },
  {
    id: "soup",
    group: "bowls",
    name: {
      en: "Red Sea seafood soup",
      ar: "شوربة مأكولات بحرية",
      ru: "Суп из морепродуктов",
      it: "Zuppa di mare",
      de: "Meeresfrüchtesuppe",
    },
    note: {
      en: "Tomato, fish, shrimp, coriander.",
      ar: "طماطم وسمك وجمبري وكسبرة.",
      ru: "Томат, рыба, креветки, кориандр.",
      it: "Pomodoro, pesce, gamberi, coriandolo.",
      de: "Tomate, Fisch, Garnelen, Koriander.",
    },
  },
  {
    id: "hawawshi",
    group: "bread",
    name: { en: "Hawawshi", ar: "حواوشي", ru: "Хававши", it: "Hawawshi", de: "Hawawshi" },
    note: {
      en: "Spiced minced beef baked in baladi bread.",
      ar: "لحم مفروم متبل داخل خبز بلدي.",
      ru: "Пряный фарш, запечённый в балади.",
      it: "Manzo macinato speziato nel pane baladi.",
      de: "Gewürztes Hackfleisch im Baladi-Brot.",
    },
  },
  {
    id: "burger",
    group: "bread",
    name: {
      en: "Smashed burger",
      ar: "برجر مضغوط",
      ru: "Смэш-бургер",
      it: "Smashed burger",
      de: "Smashed Burger",
    },
    note: {
      en: "Cheddar, pickles, house sauce, sesame bun.",
      ar: "شيدر ومخلل وصوص البيت وخبز بالسمسم.",
      ru: "Чеддер, огурцы, соус дома, булочка с кунжутом.",
      it: "Cheddar, cetriolini, salsa della casa, sesamo.",
      de: "Cheddar, Gurken, Haussauce, Sesambrötchen.",
    },
  },
  {
    id: "mezze",
    group: "mezze",
    name: { en: "Mezze plate", ar: "طبق مزة", ru: "Мезе", it: "Piatto mezze", de: "Mezze-Platte" },
    note: {
      en: "Hummus, baba ganoush, olives, baladi bread.",
      ar: "حمص ومتبل وزيتون وخبز بلدي.",
      ru: "Хумус, баба гануш, оливки, балади.",
      it: "Hummus, baba ganoush, olive, pane baladi.",
      de: "Hummus, Baba Ganoush, Oliven, Baladi-Brot.",
    },
  },
  {
    id: "baladi",
    group: "mezze",
    name: { en: "Baladi bread", ar: "خبز بلدي", ru: "Хлеб балади", it: "Pane baladi", de: "Baladi-Brot" },
    note: {
      en: "Warm from the oven, sesame.",
      ar: "ساخن من الفرن، بالسمسم.",
      ru: "Тёплый из печи, с кунжутом.",
      it: "Caldo dal forno, sesamo.",
      de: "Warm aus dem Ofen, Sesam.",
    },
  },
  {
    id: "basbousa",
    group: "sweets",
    name: { en: "Basbousa", ar: "بسبوسة", ru: "Басбуса", it: "Basbousa", de: "Basbousa" },
    note: {
      en: "Semolina, coconut, hot syrup.",
      ar: "سميد وجوز هند وشربات ساخن.",
      ru: "Манка, кокос, горячий сироп.",
      it: "Semolino, cocco, sciroppo caldo.",
      de: "Grieß, Kokos, heißer Sirup.",
    },
  },
  {
    id: "lemonade",
    group: "drinks",
    name: {
      en: "Mint lemonade",
      ar: "ليمون بالنعناع",
      ru: "Лимонад с мятой",
      it: "Limonata alla menta",
      de: "Minz-Limonade",
    },
    note: {
      en: "Fresh mint, lemon, crushed ice.",
      ar: "نعناع طازج وليمون وثلج مجروش.",
      ru: "Свежая мята, лимон, колотый лёд.",
      it: "Menta fresca, limone, ghiaccio.",
      de: "Frische Minze, Zitrone, Eis.",
    },
  },
];

export const kitchens: Kitchen[] = [
  {
    id: "fish-market",
    name: "Fish Market Grill",
    zoneId: "naama",
    eta: 35,
    image: "/home-media/fish.jpg",
    tagline: {
      en: "Boats in the morning, charcoal by noon.",
      ar: "قوارب في الصباح، وفحم قبل الظهر.",
      ru: "Лодки утром, угли в полдень.",
      it: "Barche al mattino, carbone a mezzogiorno.",
      de: "Morgens die Boote, mittags die Kohle.",
    },
  },
  {
    id: "koshary-house",
    name: "Koshary House",
    zoneId: "old-market",
    eta: 25,
    image: "/home-media/koshary.jpg",
    tagline: {
      en: "Three generations on one counter.",
      ar: "ثلاثة أجيال على منصة واحدة.",
      ru: "Три поколения за одной стойкой.",
      it: "Tre generazioni allo stesso banco.",
      de: "Drei Generationen an einem Tresen.",
    },
  },
  {
    id: "sunbed-burger",
    name: "Sunbed Burger Co.",
    zoneId: "sharks",
    eta: 30,
    image: "/home-media/burger.jpg",
    tagline: {
      en: "Smashed patties, beach towels.",
      ar: "برجر مضغوط وفوط الشاطئ.",
      ru: "Котлеты на плите, пляжные полотенца.",
      it: "Polpette schiacciate, asciugamani da mare.",
      de: "Gepresste Patties, Strandtücher.",
    },
  },
  {
    id: "sinai-kitchen",
    name: "Sinai Kitchen",
    zoneId: "hadaba",
    eta: 40,
    tagline: {
      en: "Family recipes from the mountain.",
      ar: "وصفات عائلية من الجبل.",
      ru: "Семейные рецепты с гор.",
      it: "Ricette di famiglia dalla montagna.",
      de: "Familienrezepte aus dem Berg.",
    },
  },
  {
    id: "coral-taverna",
    name: "Coral Taverna",
    zoneId: "soho",
    eta: 45,
    tagline: {
      en: "Coral Bay seafood, white tablecloths.",
      ar: "مأكولات بحرية من خليج القروش.",
      ru: "Морепродукты Корал-Бэй, белые скатерти.",
      it: "Pesce di Coral Bay, tovaglie bianche.",
      de: "Meeresfrüchte aus Coral Bay, weiße Tischdecken.",
    },
  },
  {
    id: "bakery-nour",
    name: "Bakery Nour",
    zoneId: "nour",
    eta: 20,
    tagline: {
      en: "Oven at five, coffee at six.",
      ar: "الفرن في الخامسة والقهوة في السادسة.",
      ru: "Печь в пять, кофе в шесть.",
      it: "Forno alle cinque, caffè alle sei.",
      de: "Ofen um fünf, Kaffee um sechs.",
    },
  },
];

export const menu: MenuEntry[] = [
  { kitchenId: "fish-market", dishId: "bream", price: 260, signature: true },
  { kitchenId: "fish-market", dishId: "shrimp", price: 240 },
  { kitchenId: "fish-market", dishId: "fillet", price: 210 },
  { kitchenId: "fish-market", dishId: "soup", price: 120 },
  { kitchenId: "fish-market", dishId: "mezze", price: 95 },
  { kitchenId: "fish-market", dishId: "lemonade", price: 45 },

  { kitchenId: "koshary-house", dishId: "koshary", price: 70, signature: true },
  { kitchenId: "koshary-house", dishId: "fattah", price: 150 },
  { kitchenId: "koshary-house", dishId: "hawawshi", price: 85 },
  { kitchenId: "koshary-house", dishId: "basbousa", price: 55 },
  { kitchenId: "koshary-house", dishId: "baladi", price: 15 },
  { kitchenId: "koshary-house", dishId: "lemonade", price: 40 },

  { kitchenId: "sunbed-burger", dishId: "burger", price: 165, signature: true },
  { kitchenId: "sunbed-burger", dishId: "chicken", price: 190 },
  { kitchenId: "sunbed-burger", dishId: "kofta", price: 175 },
  { kitchenId: "sunbed-burger", dishId: "baladi", price: 15 },
  { kitchenId: "sunbed-burger", dishId: "lemonade", price: 45 },

  { kitchenId: "sinai-kitchen", dishId: "fattah", price: 180, signature: true },
  { kitchenId: "sinai-kitchen", dishId: "kofta", price: 165 },
  { kitchenId: "sinai-kitchen", dishId: "chicken", price: 175 },
  { kitchenId: "sinai-kitchen", dishId: "mezze", price: 90 },
  { kitchenId: "sinai-kitchen", dishId: "basbousa", price: 60 },

  { kitchenId: "coral-taverna", dishId: "shrimp", price: 260, signature: true },
  { kitchenId: "coral-taverna", dishId: "fillet", price: 230 },
  { kitchenId: "coral-taverna", dishId: "soup", price: 130 },
  { kitchenId: "coral-taverna", dishId: "mezze", price: 105 },
  { kitchenId: "coral-taverna", dishId: "lemonade", price: 50 },

  { kitchenId: "bakery-nour", dishId: "basbousa", price: 45, signature: true },
  { kitchenId: "bakery-nour", dishId: "hawawshi", price: 75 },
  { kitchenId: "bakery-nour", dishId: "mezze", price: 80 },
  { kitchenId: "bakery-nour", dishId: "baladi", price: 12 },
  { kitchenId: "bakery-nour", dishId: "lemonade", price: 35 },
];

const dishById = new Map(dishes.map((dish) => [dish.id, dish]));
const kitchenById = new Map(kitchens.map((kitchen) => [kitchen.id, kitchen]));
const priceByKey = new Map(menu.map((entry) => [`${entry.kitchenId}:${entry.dishId}`, entry.price]));

export function getDish(dishId: string): Dish | undefined {
  return dishById.get(dishId);
}

export function getKitchen(kitchenId: string): Kitchen | undefined {
  return kitchenById.get(kitchenId);
}

export function priceOf(kitchenId: string, dishId: string): number | undefined {
  return priceByKey.get(`${kitchenId}:${dishId}`);
}

/** Cart line keys are `<kitchenId>:<dishId>` so one basket stays with one kitchen. */
export function kitchenMenu(kitchenId: string): MenuEntry[] {
  return menu.filter((entry) => entry.kitchenId === kitchenId);
}
