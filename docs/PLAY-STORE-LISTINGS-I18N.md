# Google Play Store — Localized Listings (ar · ru · it · de)

Companion to [PLAY-STORE-LISTINGS.md](./PLAY-STORE-LISTINGS.md). Ready-to-paste store
listing text for the **Sharm Eats customer app** (`eg.sharmeats.customer`) in Arabic,
Russian, Italian, and German, plus a corrected English baseline. Drafted 2026-07-18.
The driver app's listing is not localized here.

**Play character limits** (enforced by Play Console): app title ≤ 30 · short
description ≤ 80 · full description ≤ 4000. Every field below was counted by script
(Unicode characters, newlines included) and the exact count is stated on each field.

## Stale claims fixed vs. the 2026-06-06 EN draft

1. **The app is COD-only today.** The old draft said "Pay with cash on delivery or by
   card — your choice". Card checkout is dark in production
   (`EXPO_PUBLIC_PAYMENTS_CARD_ENABLED=false` in `eas.json`), so every listing below
   says **cash on delivery**, with card framed as **coming soon**. When card is
   enabled, re-add the Paymob copy in all five languages at once.
2. **Five languages, not two.** The old draft claimed "English and Arabic — a real
   bilingual app". The app ships en, ar, ru, it, de
   (`apps/customer/src/i18n/locales/`), so each listing now says five languages and
   leads with the reader's own.
3. **Missing product beats added** to match the live app copy: sunbed/beach delivery
   (beach-pin addresses) and the honest-ETA promise with automatic late credit
   (`order.slaLine`: 15+ min late → wallet credit, no support call).

Terminology follows the live locale files so the listing reads like the app:
AR «كاش عند الاستلام» / «توصيل صادق», RU «оплата наличными при получении» /
«честная доставка» / «Шаркс-Бей», IT «contrassegno» / «rider» / «consegna onesta»,
DE „Barzahlung bei Lieferung" / „Gutschrift bei Verspätung".

Brand-name note (AR): the app UI uses both «شرم إيتس» and «شارم إيتس»; this doc
standardizes on «شرم إيتس» (the form used in the support and consent strings).

## Character-count summary

| Locale | Title | Short | Full |
|---|---|---|---|
| en | 25 / 30 | 75 / 80 | 2009 / 4000 |
| ar | 21 / 30 | 78 / 80 | 1664 / 4000 |
| ru | 24 / 30 | 76 / 80 | 2089 / 4000 |
| it | 28 / 30 | 77 / 80 | 2109 / 4000 |
| de | 27 / 30 | 76 / 80 | 2191 / 4000 |

---

## 0) English (US) — corrected baseline

Replaces the stale EN full description (card claims removed, five languages, sunbed + late-credit beats added). Use for the default `en-US` listing.

### App name — 25 chars (limit 30)
```
Sharm Eats: Food Delivery
```

### Short description — 75 chars (limit 80)
```
Food delivery in Sharm el-Sheikh — hotel, home, or beach. Cash on delivery.
```

### Full description — 2009 chars (limit 4000)
```
Sharm Eats delivers food from local restaurants and shops straight to your hotel room, apartment, or sunbed on the beach in Sharm el-Sheikh — whether you're a visitor or you live here.

Browse nearby kitchens, build your order exactly how you like it, and track it live from the kitchen to your door. Pay cash on delivery — no card, no prepayment. (Card payments are coming soon.)

WHY SHARM EATS
• Made for Sharm — real local restaurants, real delivery zones, honest ETAs.
• For visitors and residents alike — order to a hotel (Naama Bay, Sharks Bay, Nabq), an apartment, a beach club, or straight to your sunbed. No Egyptian SIM or local know-how needed.
• Five languages — English, Arabic, Russian, Italian, and German, with full right-to-left support. The whole app speaks your language, including driver chat.
• Honest ETAs, credited if late — we tell you the delivery time up front. If we miss it by 15 minutes or more, credit lands in your wallet automatically. No support call needed.
• Start as a guest — browse and order with no account and no sign-up. Create one only if you want to save addresses.
• Cash on delivery — pay the driver when your order arrives. See prices in your home currency (EUR, USD, GBP, RUB) and pay in EGP at today's rate. Card payments are coming soon.

HOW IT WORKS
1. Open the app and start as a guest.
2. Browse restaurants and shops near you.
3. Customize your dish — size, ingredients, add-ons.
4. Add your delivery address (optionally drop a precise GPS pin so the driver finds you).
5. Place your order and pay cash on delivery.
6. Track your order live — accepted, preparing, on the way, delivered.

PRIVACY
We collect only what an order needs (contact, delivery address, optional GPS pin). Location is requested only when you add an address, when-in-use only — never in the background, never for tracking or advertising. We don't sell your data. Full policy: https://sharmeats.online/privacy

Hungry in Sharm? Order in a few taps. Sharm Eats brings the food to you.
```

---

## 1) العربية — Arabic (`ar`)

Written RTL-first (Egyptian-flavored, matching the app's ar.json tone). Paste as-is into Play Console; do not wrap in LTR direction marks. Latin fragments (Sharm Eats, GPS, the privacy URL) are intentional and render correctly inside RTL text.

### App name — 21 chars (limit 30)
```
شرم إيتس – توصيل طعام
```

### Short description — 78 chars (limit 80)
```
توصيل طعام في شرم الشيخ — لفندقك أو شقتك أو حتى الشاطئ. ادفع كاش عند الاستلام.
```

### Full description — 1664 chars (limit 4000)
```
شرم إيتس (Sharm Eats) يوصّل لك الأكل من مطاعم شرم الشيخ المحلية إلى غرفتك في الفندق، أو شقتك، أو حتى شمسيتك على الشاطئ — سواء كنت زائرًا أو من سكان شرم.

تصفّح المطاعم القريبة منك، ركّب طلبك زي ما تحب، وتابعه لايف من المطبخ لحد بابك. الدفع كاش عند الاستلام — من غير كارت ومن غير دفع مقدم. (الدفع بالبطاقة قريبًا.)

ليه شرم إيتس؟
• معمول لشرم — مطاعم محلية حقيقية، مناطق توصيل حقيقية، وأوقات وصول صادقة.
• للزوار والمقيمين — اطلب لفندقك (نعمة باي، شاركس باي، نبق)، أو شقتك، أو نادي الشاطئ، أو حتى لشمسيتك على الرملة. من غير شريحة مصرية ومن غير ما تعرف المنطقة.
• خمس لغات — العربية والإنجليزية والروسية والإيطالية والألمانية، مع دعم كامل للكتابة من اليمين لليسار. التطبيق كله بالعربي، حتى الشات مع السائق.
• توصيل صادق — بنقولك وقت الوصول من الأول. لو اتأخرنا ١٥ دقيقة أو أكتر، بينزلك رصيد تلقائي في محفظتك، من غير ما تكلم الدعم.
• ابدأ كضيف — تصفّح واطلب من غير حساب ومن غير تسجيل. اعمل حساب بس لو عايز تحفظ عناوينك.
• كاش عند الاستلام — ادفع للسائق لما طلبك يوصلك. شوف الأسعار بعملتك (يورو، دولار، إسترليني، روبل) وادفع بالجنيه المصري. الدفع بالبطاقة جاي قريب.

إزاي بيشتغل؟
١. افتح التطبيق وابدأ كضيف.
٢. تصفّح المطاعم والمحلات القريبة منك.
٣. ظبّط طبقك — الحجم والمكونات والإضافات.
٤. ضيف عنوان التوصيل (وتقدر تحط نقطة GPS دقيقة علشان السائق يلاقيك).
٥. أكّد طلبك وادفع كاش عند الاستلام.
٦. تابع طلبك لايف — اتقبل، بيتحضّر، في الطريق، وصل.

الخصوصية
بنجمع بس اللي الطلب محتاجه (بيانات التواصل، عنوان التوصيل، ونقطة GPS اختيارية). الموقع بيتطلب وقت إضافة العنوان فقط وأثناء الاستخدام بس — مش في الخلفية، ومش للتتبع أو الإعلانات، وما بنبيعش بياناتك. السياسة كاملة: https://sharmeats.online/privacy

جعان في شرم؟ اطلب في كام ضغطة — شرم إيتس بيجيبلك الأكل لحد عندك.
```

---

## 2) Русский — Russian (`ru-RU`)

### App name — 24 chars (limit 30)
```
Sharm Eats: доставка еды
```

### Short description — 76 chars (limit 80)
```
Доставка еды в Шарм-эль-Шейхе: в отель, домой или на пляж. Оплата наличными.
```

### Full description — 2089 chars (limit 4000)
```
Sharm Eats доставляет еду из местных ресторанов Шарм-эль-Шейха прямо в ваш номер в отеле, в квартиру или даже к лежаку на пляже — и туристам, и тем, кто здесь живёт.

Выбирайте из ближайших ресторанов, собирайте заказ по своему вкусу и следите за ним в реальном времени — от кухни до вашей двери. Оплата наличными при получении: карта не нужна, предоплаты нет. (Оплата картой скоро появится.)

ПОЧЕМУ SHARM EATS
• Создано для Шарма — настоящие местные рестораны, реальные зоны доставки и честное время прибытия.
• Для туристов и местных — закажите в отель (Наама-Бей, Шаркс-Бей, Набк), в квартиру, в пляжный клуб или прямо к лежаку. Египетская SIM-карта не нужна.
• Пять языков — русский, английский, арабский, итальянский и немецкий. Всё приложение по-русски, включая чат с курьером и поддержкой.
• Честная доставка — мы называем время прибытия заранее. Если опоздаем на 15 минут и больше, компенсация автоматически зачислится в ваш кошелёк. Звонить в поддержку не нужно.
• Начните как гость — смотрите меню и заказывайте без аккаунта и без регистрации. Аккаунт нужен, только если хотите сохранить адреса.
• Наличные при получении — заплатите курьеру, когда заказ приедет. Смотрите цены в EUR, USD, GBP или RUB, платите в EGP по сегодняшнему курсу. Оплата картой скоро появится.

КАК ЭТО РАБОТАЕТ
1. Откройте приложение и начните как гость.
2. Посмотрите рестораны и магазины рядом с вами.
3. Настройте блюдо: размер, ингредиенты, добавки.
4. Добавьте адрес доставки (можно поставить точную GPS-точку, чтобы курьер вас нашёл).
5. Оформите заказ и оплатите наличными при получении.
6. Следите за заказом в реальном времени: принят, готовится, в пути, доставлен.

КОНФИДЕНЦИАЛЬНОСТЬ
Мы собираем только то, что нужно для заказа (контакты, адрес доставки, необязательную GPS-точку). Геолокация запрашивается только при добавлении адреса и только во время использования — никогда в фоновом режиме, не для слежки и не для рекламы. Мы не продаём ваши данные. Полная политика: https://sharmeats.online/privacy

Проголодались в Шарме? Закажите в пару нажатий — Sharm Eats привезёт еду прямо к вам.
```

---

## 3) Italiano — Italian (`it-IT`)

### App name — 28 chars (limit 30)
```
Sharm Eats: cibo a domicilio
```

### Short description — 77 chars (limit 80)
```
Consegna cibo a Sharm el-Sheikh: hotel, casa o spiaggia. Paghi alla consegna.
```

### Full description — 2109 chars (limit 4000)
```
Sharm Eats consegna il cibo dei ristoranti locali di Sharm el-Sheikh direttamente nella tua camera d'hotel, nel tuo appartamento o perfino al tuo lettino in spiaggia — che tu sia in vacanza o che tu viva qui.

Sfoglia i ristoranti vicino a te, componi l'ordine esattamente come lo vuoi e seguilo in tempo reale dalla cucina alla tua porta. Paghi in contanti alla consegna: nessuna carta, nessun anticipo. (Il pagamento con carta arriverà presto.)

PERCHÉ SHARM EATS
• Fatto per Sharm — veri ristoranti locali, vere zone di consegna, orari di arrivo onesti.
• Per turisti e residenti — ordina in hotel (Naama Bay, Sharks Bay, Nabq), in appartamento, al beach club o direttamente al lettino. Nessuna SIM egiziana necessaria.
• Cinque lingue — italiano, inglese, arabo, russo e tedesco. Tutta l'app in italiano, chat con il rider inclusa.
• Consegna onesta — ti diciamo subito l'orario di arrivo. Se ritardiamo di 15 minuti o più, un credito arriva automaticamente nel tuo portafoglio, senza chiamare l'assistenza.
• Inizia come ospite — sfoglia e ordina senza account e senza registrazione. Creane uno solo se vuoi salvare i tuoi indirizzi.
• Contrassegno — paga il rider in contanti quando l'ordine arriva. Vedi i prezzi nella tua valuta (EUR, USD, GBP, RUB) e paghi in EGP al tasso di oggi. La carta arriverà presto.

COME FUNZIONA
1. Apri l'app e inizia come ospite.
2. Sfoglia ristoranti e negozi vicino a te.
3. Personalizza il piatto: dimensione, ingredienti, extra.
4. Aggiungi l'indirizzo di consegna (puoi fissare un punto GPS preciso così il rider ti trova).
5. Invia l'ordine e paga in contanti alla consegna.
6. Segui l'ordine in tempo reale: accettato, in preparazione, in arrivo, consegnato.

PRIVACY
Raccogliamo solo ciò che serve all'ordine (contatti, indirizzo di consegna, punto GPS facoltativo). La posizione viene richiesta solo quando aggiungi un indirizzo e solo durante l'uso: mai in background, mai per tracciamento o pubblicità. Non vendiamo i tuoi dati. Informativa completa: https://sharmeats.online/privacy

Fame a Sharm? Ordina in pochi tocchi: Sharm Eats ti porta il cibo dove sei.
```

---

## 4) Deutsch — German (`de-DE`)

### App name — 27 chars (limit 30)
```
Sharm Eats: Essenslieferung
```

### Short description — 76 chars (limit 80)
```
Essenslieferung in Sharm el-Sheikh – Hotel, Zuhause oder Strand. Barzahlung.
```

### Full description — 2191 chars (limit 4000)
```
Sharm Eats liefert Essen aus den lokalen Restaurants von Sharm el-Sheikh direkt in dein Hotelzimmer, deine Wohnung oder sogar an deine Sonnenliege am Strand — egal, ob du zu Besuch bist oder hier lebst.

Stöbere durch Restaurants in deiner Nähe, stelle deine Bestellung genau nach deinem Geschmack zusammen und verfolge sie live von der Küche bis zu deiner Tür. Bezahlt wird bar bei Lieferung: keine Karte, keine Vorauszahlung. (Kartenzahlung kommt bald.)

WARUM SHARM EATS
• Gemacht für Sharm — echte lokale Restaurants, echte Lieferzonen, ehrliche Ankunftszeiten.
• Für Urlauber und Einheimische — bestell ins Hotel (Naama Bay, Sharks Bay, Nabq), in die Wohnung, in den Beachclub oder direkt an die Sonnenliege. Keine ägyptische SIM nötig.
• Fünf Sprachen — Deutsch, Englisch, Arabisch, Russisch und Italienisch. Die ganze App auf Deutsch, inklusive Chat mit dem Fahrer.
• Ehrliche Lieferung — wir nennen dir die Ankunftszeit vorab. Sind wir 15 Minuten oder mehr zu spät, landet automatisch eine Gutschrift in deinem Guthaben, ganz ohne Anruf beim Support.
• Starte als Gast — stöbern und bestellen ohne Konto und ohne Registrierung. Ein Konto brauchst du nur, wenn du Adressen speichern willst.
• Barzahlung bei Lieferung — zahle dem Fahrer bar, wenn deine Bestellung ankommt. Sieh Preise in deiner Währung (EUR, USD, GBP, RUB) und zahle in EGP zum Tageskurs. Kartenzahlung kommt bald.

SO FUNKTIONIERT'S
1. App öffnen und als Gast starten.
2. Restaurants und Shops in deiner Nähe entdecken.
3. Gericht anpassen: Größe, Zutaten, Extras.
4. Lieferadresse hinzufügen (optional mit präzisem GPS-Pin, damit dich der Fahrer findet).
5. Bestellung aufgeben und bar bei Lieferung zahlen.
6. Bestellung live verfolgen: angenommen, in Zubereitung, unterwegs, geliefert.

DATENSCHUTZ
Wir erheben nur, was eine Bestellung braucht (Kontaktdaten, Lieferadresse, optionaler GPS-Pin). Der Standort wird nur beim Hinzufügen einer Adresse abgefragt und nur während der Nutzung — nie im Hintergrund, nie für Tracking oder Werbung. Wir verkaufen deine Daten nicht. Vollständige Erklärung: https://sharmeats.online/privacy

Hunger in Sharm? Bestell in ein paar Fingertipps — Sharm Eats bringt dir dein Essen.
```

---

## Play Console notes

- Add these under **Store presence → Main store listing → Manage translations** with
  locale codes `ar`, `ru-RU`, `it-IT`, `de-DE` (default stays `en-US`).
- Graphics (icon, screenshots, feature graphic) are shared: Play falls back to the
  default language's assets, so no per-locale graphics are required. Localized
  screenshots can be added later since the app itself is localized.
- Keep all five listings in sync on the payments claim: when card payments go live,
  update EN + the four translations in the same edit.
