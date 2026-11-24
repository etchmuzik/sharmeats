import type { Lang } from './routes';
import { restaurantMenuLinks } from './catalogData';

interface VenueCopy {
  title: string;
  description: string;
  menu: string;
}

interface VenueGuide {
  section: string;
  verifiedOn: string;
  sourceLabel: string;
  sourceUrl: string;
  languages: Record<Lang, VenueCopy>;
}

export const venueGuides: Record<string,VenueGuide> = {
  pomodoro: {
    section: 'naama-bay',
    verifiedOn: '2026-11-24',
    sourceLabel: 'Camel Dive Club & Hotel',
    sourceUrl: restaurantMenuLinks.pomodoro,
    languages: {
      en: {
        title: 'Pomodoro menu in Naama Bay',
        description: 'Pomodoro is the restaurant at Camel Dive Club & Hotel in central Naama Bay. The hotel publishes its lunch and dinner menu online.',
        menu: 'For pizza, the kitchen lists Margherita and a seafood pizza. For pasta, look for the penne with spicy tomato sauce or spaghetti with prawns and calamari. The restaurant marks vegetarian dishes on its menu and lists table prices in Egyptian pounds, including service and taxes.',
      },
      ar: {
        title: 'منيو بومودورو في خليج نعمة',
        description: 'مطعم بومودورو موجود في Camel Dive Club & Hotel في وسط خليج نعمة. الفندق ناشر منيو الغدا والعشا على موقعه.',
        menu: 'هتلاقي بيتزا مارجريتا وبيتزا سي فود. وفي الباستا فيه بينّي بصلصة طماطم حارة أو سباجيتي بالجمبري والكاليماري. المنيو عليه علامة جنب الأطباق النباتية، وأسعار الأكل في المطعم بالجنيه المصري وشاملة الخدمة والضريبة.',
      },
      ru: {
        title: 'Меню Pomodoro в Наама-Бей',
        description: 'Ресторан Pomodoro находится при Camel Dive Club & Hotel в центре Наама-Бей. На сайте отеля опубликовано меню обедов и ужинов.',
        menu: 'Среди пицц есть «Маргарита» и пицца с морепродуктами. В разделе пасты — пенне с острым томатным соусом и спагетти с креветками и кальмарами. Вегетарианские блюда обозначены значком. Цены в зале указаны в египетских фунтах и включают налоги и обслуживание.',
      },
      it: {
        title: 'Il menu di Pomodoro a Naama Bay',
        description: 'Pomodoro è il ristorante del Camel Dive Club & Hotel, nel centro di Naama Bay. Sul sito dell’hotel trovi il menu del pranzo e della cena.',
        menu: 'Tra le pizze ci sono la margherita e quella ai frutti di mare. Per un primo puoi scegliere le penne all’arrabbiata o gli spaghetti con gamberi e calamari. La carta segnala i piatti vegetariani. I prezzi al tavolo sono in lire egiziane, con servizio e tasse inclusi.',
      },
      de: {
        title: 'Die Speisekarte von Pomodoro in Naama Bay',
        description: 'Das Pomodoro gehört zum Camel Dive Club & Hotel im Zentrum von Naama Bay. Das Hotel veröffentlicht die Mittags- und Abendkarte online.',
        menu: 'Auf der Karte stehen unter anderem Pizza Margherita und Pizza mit Meeresfrüchten. Bei der Pasta gibt es Penne mit scharfer Tomatensauce sowie Spaghetti mit Garnelen und Calamari. Vegetarische Gerichte sind gekennzeichnet. Die Preise im Restaurant sind in ägyptischen Pfund angegeben und enthalten Steuern und Service.',
      },
    },
  },
  'hard-rock-cafe-sharm-el-sheikh': {
    section: 'naama-bay',
    verifiedOn: '2026-11-24',
    sourceLabel: 'Hard Rock Cafe',
    sourceUrl: restaurantMenuLinks['hard-rock-cafe-sharm-el-sheikh'],
    languages: {
      en: {
        title: 'Hard Rock Cafe menu in Naama Bay',
        description: 'The Hard Rock Cafe Sharm el Sheikh branch is in central Naama Bay. Its local website has separate food, drinks and children’s menus.',
        menu: 'For American-style food, the branch highlights its cheeseburger. Open the Eats Menu on the venue website for the main dishes. Families can open the Kids Menu separately, and drinks are listed on their own card. Use the Naama Bay branch page for current dine-in choices.',
      },
      ar: {
        title: 'منيو هارد روك كافيه في خليج نعمة',
        description: 'فرع هارد روك كافيه شرم الشيخ موجود في وسط خليج نعمة. على موقع الفرع هتلاقي منيو للأكل ومنيو للمشروبات ومنيو للأطفال.',
        menu: 'الفرع معروف بالأكل الأمريكي وبيذكر التشيز برجر ضمن اختياراته. للأطباق الرئيسية افتح Eats Menu على موقع الفرع. للأطفال فيه Kids Menu منفصل، والمشروبات ليها قايمة لوحدها. راجع صفحة فرع خليج نعمة عشان تشوف الاختيارات المتاحة في المطعم.',
      },
      ru: {
        title: 'Меню Hard Rock Cafe в Наама-Бей',
        description: 'Hard Rock Cafe Sharm el Sheikh находится в центре Наама-Бей. На сайте этого кафе размещены отдельные меню блюд, напитков и детское меню.',
        menu: 'Из американских блюд кафе выделяет чизбургер. На странице заведения откройте Eats Menu для основных блюд и Kids Menu для детских. Для напитков есть отдельная карта. Актуальный выбор блюд в зале смотрите на странице кафе в Наама-Бей.',
      },
      it: {
        title: 'Il menu dell’Hard Rock Cafe a Naama Bay',
        description: 'L’Hard Rock Cafe Sharm el Sheikh si trova nel centro di Naama Bay. La pagina del locale presenta tre menu separati per cibo, bevande e bambini.',
        menu: 'Tra i piatti americani il locale segnala il suo cheeseburger. Sulla pagina di Naama Bay apri Eats Menu per i piatti principali e Kids Menu per le proposte dedicate ai bambini. Le bevande hanno una carta a parte. Controlla la pagina del locale per la selezione servita in sala.',
      },
      de: {
        title: 'Die Speisekarte des Hard Rock Cafe in Naama Bay',
        description: 'Das Hard Rock Cafe Sharm el Sheikh liegt im Zentrum von Naama Bay. Auf der Website des Cafés gibt es eigene Karten für Speisen, Getränke und Kinder.',
        menu: 'Bei den amerikanischen Gerichten hebt das Café seinen Cheeseburger hervor. Die Hauptgerichte stehen auf der Standortseite unter Eats Menu. Für Familien gibt es das separate Kids Menu, für Getränke eine eigene Karte. Die aktuelle Auswahl vor Ort findest du auf der Seite der Filiale in Naama Bay.',
      },
    },
  },
};
