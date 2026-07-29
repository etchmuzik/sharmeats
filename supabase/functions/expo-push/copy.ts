// Localized push notification copy for the expo-push edge function (audit N4).
//
// The customer app supports en/ar/ru/it/de and public.users has a `locale`
// column, but server-side push copy used to be English-only. This module holds
// the per-locale event -> {title, body} map plus the locale-resolution helpers,
// kept separate from index.ts so it can be unit-tested under `deno test`
// (same pattern as paymob-webhook/verify.ts).
//
// Rules for these strings:
// - Short: push notifications get truncated on small lock screens.
// - English strings for pre-existing events are byte-identical to the old
//   hardcoded COPY map so behavior is unchanged for en users.
// - Translations reuse the customer app locale JSONs where an equivalent
//   string exists (order status names etc.).

export const SUPPORTED_LOCALES = ['en', 'ar', 'ru', 'it', 'de'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export interface PushCopy {
  title: string;
  body: string;
}

// Generic fallback per locale, used when an event key is unknown.
export const FALLBACK_COPY: Record<Locale, PushCopy> = {
  en: { title: 'Sharm Eats', body: 'Order update' },
  ar: { title: 'Sharm Eats', body: 'تحديث الطلب' },
  ru: { title: 'Sharm Eats', body: 'Обновление заказа' },
  it: { title: 'Sharm Eats', body: 'Aggiornamento ordine' },
  de: { title: 'Sharm Eats', body: 'Bestell-Update' },
};

// Event -> copy, per locale. Every event key MUST exist in all 5 locales
// (enforced by copy.test.ts parity check).
//
// The last 6 keys (order_cancelled_driver, settlement_finalized,
// settlement_paid, kyc_approved, kyc_rejected, kyc_submitted) are emitted by
// the companion N7 DB migration; they ship here first so the deployed function
// already knows them when N7 lands.
export const COPY: Record<Locale, Record<string, PushCopy>> = {
  en: {
    order_paid: { title: 'Payment confirmed', body: 'Your order is confirmed and sent to the kitchen.' },
    order_accepted: { title: 'Order accepted', body: 'The restaurant is preparing your order.' },
    order_ready: { title: 'Order ready', body: 'Your order is ready and waiting for pickup.' },
    order_picked_up: { title: 'On the way', body: 'Your driver has picked up your order.' },
    order_out_for_delivery: { title: 'Out for delivery', body: 'Your driver is heading to you.' },
    order_delivered: { title: 'Delivered', body: 'Enjoy your meal! Tap to rate your order.' },
    new_offer: { title: 'New delivery offer', body: 'You have a new job. Tap to accept.' },
    referral_rewarded: { title: 'Referral reward earned', body: 'Your friend ordered — your discount is ready. Tap to see it.' },
    order_placed_merchant: { title: 'New order', body: 'A new order just came in. Tap to accept it.' },
    order_rejected: { title: 'Order declined', body: 'The restaurant could not take your order. Any charge is refunded.' },
    order_cancelled: { title: 'Order cancelled', body: 'Your order was cancelled. Tap for details.' },
    order_cancelled_merchant: { title: 'Order cancelled', body: 'An order was cancelled — you can stop preparing it.' },
    payment_failed: { title: 'Payment failed', body: 'Your card payment did not go through. Tap to try again.' },
    credit_issued: { title: 'Credit added', body: 'Credit was added to your Sharm Eats wallet. Tap to see it.' },
    new_message: { title: 'New message', body: 'You have a new message about your order. Tap to reply.' },
    support_reply: { title: 'Support replied', body: 'Our team answered your message. Tap to read it.' },
    support_new_message: { title: 'New support message', body: 'A customer needs help. Tap to respond.' },
    driver_assigned: { title: 'Driver on the way', body: 'A driver is heading to the restaurant for your order.' },
    order_ready_pickup: { title: 'Order ready for pickup', body: 'An order is ready — head to the restaurant to collect it.' },
    low_rating: { title: 'Low rating received', body: 'A customer left a low rating on a recent order. Tap to review.' },
    tier_promoted: { title: 'You leveled up!', body: 'You reached a new rewards tier. Tap to see your new perks.' },
    // [P03-G] Lifecycle reminders. Deliberately gentle and non-urgent: these are
    // MARKETING, and copy that mimics an order alert to win a tap is a dark pattern.
    cart_reminder: { title: 'Still hungry?', body: 'Your basket is waiting. Tap to finish your order.' },
    reorder_reminder: { title: 'Order it again?', body: 'Enjoyed it last time? Reorder in a couple of taps.' },
    order_cancelled_driver: { title: 'Delivery cancelled', body: 'This order no longer needs pickup. You are free for new offers.' },
    settlement_finalized: { title: 'Weekly statement ready', body: 'Your settlement statement is ready. Tap to review it.' },
    settlement_paid: { title: 'Payout sent', body: 'Your settlement payout was marked as paid. Tap for details.' },
    kyc_approved: { title: 'Document approved', body: 'Your document was approved. You are all set.' },
    kyc_rejected: { title: 'Document rejected', body: 'Your document was rejected. Tap to upload a new one.' },
    kyc_submitted: { title: 'New KYC document', body: 'A new KYC document is awaiting review.' },
  },
  ar: {
    order_paid: { title: 'تم تأكيد الدفع', body: 'تم تأكيد طلبك وإرساله إلى المطبخ.' },
    order_accepted: { title: 'المطعم قبل طلبك', body: 'جاري تحضير طلبك الآن.' },
    order_ready: { title: 'الطلب جاهز', body: 'طلبك جاهز وبانتظار الاستلام.' },
    order_picked_up: { title: 'في الطريق إليك', body: 'السائق استلم طلبك.' },
    order_out_for_delivery: { title: 'خرج للتوصيل', body: 'السائق في الطريق إليك.' },
    order_delivered: { title: 'تم التسليم', body: 'بالهنا والشفا! اضغط لتقييم طلبك.' },
    new_offer: { title: 'عرض توصيل جديد', body: 'لديك مهمة جديدة. اضغط للقبول.' },
    referral_rewarded: { title: 'حصلت على مكافأة الدعوة', body: 'صديقك طلب وخصمك جاهز. اضغط لعرضه.' },
    order_placed_merchant: { title: 'طلب جديد', body: 'وصل طلب جديد الآن. اضغط لقبوله.' },
    order_rejected: { title: 'تعذر قبول الطلب', body: 'لم يستطع المطعم قبول طلبك. سيتم استرداد أي مبلغ مدفوع.' },
    order_cancelled: { title: 'تم إلغاء الطلب', body: 'تم إلغاء طلبك. اضغط للتفاصيل.' },
    order_cancelled_merchant: { title: 'تم إلغاء الطلب', body: 'تم إلغاء أحد الطلبات. يمكنك إيقاف تحضيره.' },
    payment_failed: { title: 'فشل الدفع', body: 'لم تنجح عملية الدفع بالبطاقة. اضغط للمحاولة مجددًا.' },
    credit_issued: { title: 'تمت إضافة رصيد', body: 'أضيف رصيد إلى محفظتك في Sharm Eats. اضغط لعرضه.' },
    new_message: { title: 'رسالة جديدة', body: 'لديك رسالة جديدة بخصوص طلبك. اضغط للرد.' },
    support_reply: { title: 'رد عليك الدعم', body: 'فريقنا رد على رسالتك. اضغط لقراءته.' },
    support_new_message: { title: 'رسالة دعم جديدة', body: 'عميل يحتاج إلى مساعدة. اضغط للرد.' },
    driver_assigned: { title: 'السائق في الطريق', body: 'سائق متجه إلى المطعم لاستلام طلبك.' },
    order_ready_pickup: { title: 'طلب جاهز للاستلام', body: 'هناك طلب جاهز. توجه إلى المطعم لاستلامه.' },
    low_rating: { title: 'تقييم منخفض', body: 'ترك عميل تقييمًا منخفضًا على طلب حديث. اضغط للمراجعة.' },
    tier_promoted: { title: 'ترقيت لمستوى جديد!', body: 'وصلت إلى مستوى مكافآت جديد. اضغط لعرض مزاياك.' },
    cart_reminder: { title: 'ما زلت جائعًا؟', body: 'سلتك تنتظرك. اضغط لإكمال طلبك.' },
    reorder_reminder: { title: 'تطلبه مرة أخرى؟', body: 'أعجبك في المرة السابقة؟ أعد الطلب بضغطتين.' },
    order_cancelled_driver: { title: 'أُلغي التوصيل', body: 'هذا الطلب لم يعد بحاجة للاستلام. أنت متاح لعروض جديدة.' },
    settlement_finalized: { title: 'كشف الحساب الأسبوعي جاهز', body: 'كشف التسوية الخاص بك جاهز. اضغط لمراجعته.' },
    settlement_paid: { title: 'تم تحويل المستحقات', body: 'تم تسجيل دفعتك كمدفوعة. اضغط للتفاصيل.' },
    kyc_approved: { title: 'تمت الموافقة على المستند', body: 'تمت الموافقة على مستندك. كل شيء جاهز.' },
    kyc_rejected: { title: 'تم رفض المستند', body: 'تم رفض مستندك. اضغط لرفع مستند جديد.' },
    kyc_submitted: { title: 'مستند تحقق جديد', body: 'هناك مستند تحقق جديد بانتظار المراجعة.' },
  },
  ru: {
    order_paid: { title: 'Оплата подтверждена', body: 'Ваш заказ подтверждён и отправлен на кухню.' },
    order_accepted: { title: 'Ресторан принял заказ', body: 'Ваш заказ уже готовится.' },
    order_ready: { title: 'Заказ готов', body: 'Ваш заказ готов и ждёт получения.' },
    order_picked_up: { title: 'Уже в пути', body: 'Курьер забрал ваш заказ.' },
    order_out_for_delivery: { title: 'Курьер едет к вам', body: 'Курьер уже направляется к вам.' },
    order_delivered: { title: 'Доставлено', body: 'Приятного аппетита! Нажмите, чтобы оценить заказ.' },
    new_offer: { title: 'Новая доставка', body: 'Есть новый заказ на доставку. Нажмите, чтобы принять.' },
    referral_rewarded: { title: 'Бонус за приглашение', body: 'Ваш друг сделал заказ, скидка уже ждёт вас. Нажмите, чтобы посмотреть.' },
    order_placed_merchant: { title: 'Новый заказ', body: 'Поступил новый заказ. Нажмите, чтобы принять.' },
    order_rejected: { title: 'Заказ отклонён', body: 'Ресторан не смог принять ваш заказ. Оплата будет возвращена.' },
    order_cancelled: { title: 'Заказ отменён', body: 'Ваш заказ отменён. Нажмите для подробностей.' },
    order_cancelled_merchant: { title: 'Заказ отменён', body: 'Заказ отменён, его можно не готовить.' },
    payment_failed: { title: 'Оплата не прошла', body: 'Платёж картой не прошёл. Нажмите, чтобы повторить.' },
    credit_issued: { title: 'Начислен бонус', body: 'На ваш кошелёк Sharm Eats зачислены средства. Нажмите, чтобы посмотреть.' },
    new_message: { title: 'Новое сообщение', body: 'Новое сообщение по вашему заказу. Нажмите, чтобы ответить.' },
    support_reply: { title: 'Ответ поддержки', body: 'Наша команда ответила на ваше сообщение. Нажмите, чтобы прочитать.' },
    support_new_message: { title: 'Новое обращение', body: 'Клиенту нужна помощь. Нажмите, чтобы ответить.' },
    driver_assigned: { title: 'Курьер в пути', body: 'Курьер едет в ресторан за вашим заказом.' },
    order_ready_pickup: { title: 'Заказ готов к выдаче', body: 'Заказ готов. Заберите его в ресторане.' },
    low_rating: { title: 'Низкая оценка', body: 'Клиент поставил низкую оценку недавнему заказу. Нажмите, чтобы посмотреть.' },
    tier_promoted: { title: 'Новый уровень!', body: 'Вы достигли нового уровня наград. Нажмите, чтобы увидеть бонусы.' },
    cart_reminder: { title: 'Ещё голодны?', body: 'Ваша корзина ждёт. Нажмите, чтобы завершить заказ.' },
    reorder_reminder: { title: 'Повторить заказ?', body: 'Понравилось в прошлый раз? Повторите за пару нажатий.' },
    order_cancelled_driver: { title: 'Доставка отменена', body: 'Этот заказ больше не нужно забирать. Вы свободны для новых заказов.' },
    settlement_finalized: { title: 'Недельный отчёт готов', body: 'Ваш отчёт по расчётам готов. Нажмите, чтобы посмотреть.' },
    settlement_paid: { title: 'Выплата отправлена', body: 'Ваша выплата отмечена как оплаченная. Нажмите для подробностей.' },
    kyc_approved: { title: 'Документ одобрен', body: 'Ваш документ одобрен. Всё готово.' },
    kyc_rejected: { title: 'Документ отклонён', body: 'Ваш документ отклонён. Нажмите, чтобы загрузить новый.' },
    kyc_submitted: { title: 'Новый документ KYC', body: 'Новый документ KYC ожидает проверки.' },
  },
  it: {
    order_paid: { title: 'Pagamento confermato', body: 'Il tuo ordine è confermato e inviato alla cucina.' },
    order_accepted: { title: 'Ordine accettato', body: 'Il ristorante sta preparando il tuo ordine.' },
    order_ready: { title: 'Ordine pronto', body: 'Il tuo ordine è pronto per il ritiro.' },
    order_picked_up: { title: 'In arrivo', body: 'Il corriere ha ritirato il tuo ordine.' },
    order_out_for_delivery: { title: 'In consegna', body: 'Il corriere sta arrivando da te.' },
    order_delivered: { title: 'Consegnato', body: 'Buon appetito! Tocca per valutare il tuo ordine.' },
    new_offer: { title: 'Nuova consegna disponibile', body: 'Hai un nuovo incarico. Tocca per accettare.' },
    referral_rewarded: { title: 'Premio invito ottenuto', body: 'Il tuo amico ha ordinato, il tuo sconto è pronto. Tocca per vederlo.' },
    order_placed_merchant: { title: 'Nuovo ordine', body: 'È appena arrivato un nuovo ordine. Tocca per accettarlo.' },
    order_rejected: { title: 'Ordine rifiutato', body: 'Il ristorante non ha potuto accettare il tuo ordine. Ogni addebito sarà rimborsato.' },
    order_cancelled: { title: 'Ordine annullato', body: 'Il tuo ordine è stato annullato. Tocca per i dettagli.' },
    order_cancelled_merchant: { title: 'Ordine annullato', body: 'Un ordine è stato annullato. Puoi smettere di prepararlo.' },
    payment_failed: { title: 'Pagamento non riuscito', body: 'Il pagamento con carta non è andato a buon fine. Tocca per riprovare.' },
    credit_issued: { title: 'Credito aggiunto', body: 'Credito aggiunto al tuo portafoglio Sharm Eats. Tocca per vederlo.' },
    new_message: { title: 'Nuovo messaggio', body: 'Hai un nuovo messaggio sul tuo ordine. Tocca per rispondere.' },
    support_reply: { title: "L'assistenza ha risposto", body: 'Il nostro team ha risposto al tuo messaggio. Tocca per leggerlo.' },
    support_new_message: { title: 'Nuova richiesta di assistenza', body: 'Un cliente ha bisogno di aiuto. Tocca per rispondere.' },
    driver_assigned: { title: 'Corriere in arrivo', body: 'Un corriere sta andando al ristorante per il tuo ordine.' },
    order_ready_pickup: { title: 'Ordine pronto per il ritiro', body: 'Un ordine è pronto. Vai al ristorante per ritirarlo.' },
    low_rating: { title: 'Valutazione bassa ricevuta', body: 'Un cliente ha lasciato una valutazione bassa su un ordine recente. Tocca per vedere.' },
    tier_promoted: { title: 'Sei salito di livello!', body: 'Hai raggiunto un nuovo livello premi. Tocca per vedere i vantaggi.' },
    cart_reminder: { title: 'Ancora fame?', body: 'Il tuo carrello ti aspetta. Tocca per completare l\'ordine.' },
    reorder_reminder: { title: 'Lo riordini?', body: 'Ti è piaciuto? Riordina in due tocchi.' },
    order_cancelled_driver: { title: 'Consegna annullata', body: 'Questo ordine non richiede più il ritiro. Sei libero per nuove consegne.' },
    settlement_finalized: { title: 'Estratto settimanale pronto', body: 'Il tuo estratto conto è pronto. Tocca per esaminarlo.' },
    settlement_paid: { title: 'Pagamento inviato', body: 'Il tuo pagamento è stato registrato come pagato. Tocca per i dettagli.' },
    kyc_approved: { title: 'Documento approvato', body: 'Il tuo documento è stato approvato. È tutto pronto.' },
    kyc_rejected: { title: 'Documento respinto', body: 'Il tuo documento è stato respinto. Tocca per caricarne uno nuovo.' },
    kyc_submitted: { title: 'Nuovo documento KYC', body: 'Un nuovo documento KYC è in attesa di revisione.' },
  },
  de: {
    order_paid: { title: 'Zahlung bestätigt', body: 'Deine Bestellung ist bestätigt und in der Küche.' },
    order_accepted: { title: 'Bestellung angenommen', body: 'Das Restaurant bereitet deine Bestellung zu.' },
    order_ready: { title: 'Bestellung fertig', body: 'Deine Bestellung ist fertig und wartet auf Abholung.' },
    order_picked_up: { title: 'Unterwegs zu dir', body: 'Dein Fahrer hat deine Bestellung abgeholt.' },
    order_out_for_delivery: { title: 'In Zustellung', body: 'Dein Fahrer ist auf dem Weg zu dir.' },
    order_delivered: { title: 'Geliefert', body: 'Guten Appetit! Tippe, um deine Bestellung zu bewerten.' },
    new_offer: { title: 'Neuer Lieferauftrag', body: 'Du hast einen neuen Auftrag. Tippe zum Annehmen.' },
    referral_rewarded: { title: 'Empfehlungsprämie erhalten', body: 'Dein Freund hat bestellt, dein Rabatt ist bereit. Tippe, um ihn zu sehen.' },
    order_placed_merchant: { title: 'Neue Bestellung', body: 'Eine neue Bestellung ist eingegangen. Tippe zum Annehmen.' },
    order_rejected: { title: 'Bestellung abgelehnt', body: 'Das Restaurant konnte deine Bestellung nicht annehmen. Zahlungen werden erstattet.' },
    order_cancelled: { title: 'Bestellung storniert', body: 'Deine Bestellung wurde storniert. Tippe für Details.' },
    order_cancelled_merchant: { title: 'Bestellung storniert', body: 'Eine Bestellung wurde storniert. Du kannst die Zubereitung stoppen.' },
    payment_failed: { title: 'Zahlung fehlgeschlagen', body: 'Deine Kartenzahlung war nicht erfolgreich. Tippe, um es erneut zu versuchen.' },
    credit_issued: { title: 'Guthaben hinzugefügt', body: 'Deinem Sharm Eats Guthaben wurde etwas gutgeschrieben. Tippe, um es zu sehen.' },
    new_message: { title: 'Neue Nachricht', body: 'Du hast eine neue Nachricht zu deiner Bestellung. Tippe zum Antworten.' },
    support_reply: { title: 'Support hat geantwortet', body: 'Unser Team hat auf deine Nachricht geantwortet. Tippe zum Lesen.' },
    support_new_message: { title: 'Neue Support-Anfrage', body: 'Ein Kunde braucht Hilfe. Tippe zum Antworten.' },
    driver_assigned: { title: 'Fahrer unterwegs', body: 'Ein Fahrer ist auf dem Weg zum Restaurant für deine Bestellung.' },
    order_ready_pickup: { title: 'Bestellung abholbereit', body: 'Eine Bestellung ist fertig. Fahre zum Restaurant und hole sie ab.' },
    low_rating: { title: 'Niedrige Bewertung erhalten', body: 'Ein Kunde hat eine niedrige Bewertung hinterlassen. Tippe zum Ansehen.' },
    tier_promoted: { title: 'Level aufgestiegen!', body: 'Du hast eine neue Prämienstufe erreicht. Tippe für deine neuen Vorteile.' },
    cart_reminder: { title: 'Noch hungrig?', body: 'Dein Warenkorb wartet. Tippe, um zu bestellen.' },
    reorder_reminder: { title: 'Nochmal bestellen?', body: 'Hat es geschmeckt? Bestelle mit zwei Tipps neu.' },
    order_cancelled_driver: { title: 'Lieferung storniert', body: 'Diese Bestellung muss nicht mehr abgeholt werden. Du bist frei für neue Aufträge.' },
    settlement_finalized: { title: 'Wochenabrechnung bereit', body: 'Deine Abrechnung ist fertig. Tippe, um sie zu prüfen.' },
    settlement_paid: { title: 'Auszahlung gesendet', body: 'Deine Auszahlung wurde als bezahlt markiert. Tippe für Details.' },
    kyc_approved: { title: 'Dokument genehmigt', body: 'Dein Dokument wurde genehmigt. Alles bereit.' },
    kyc_rejected: { title: 'Dokument abgelehnt', body: 'Dein Dokument wurde abgelehnt. Tippe, um ein neues hochzuladen.' },
    kyc_submitted: { title: 'Neues KYC-Dokument', body: 'Ein neues KYC-Dokument wartet auf Prüfung.' },
  },
};

// Normalize a raw users.locale value to a supported locale.
// Handles null/undefined (guests), casing, and region tags ('ar-EG', 'de_DE').
// Anything unknown falls back to 'en'.
export function normalizeLocale(raw: string | null | undefined): Locale {
  if (typeof raw !== 'string') return 'en';
  const base = raw.trim().toLowerCase().split(/[-_]/)[0];
  return (SUPPORTED_LOCALES as readonly string[]).includes(base) ? (base as Locale) : 'en';
}

// ---------------------------------------------------------------------------
// VERTICAL-AWARE COPY
// ---------------------------------------------------------------------------
// The COPY map above is FOOD copy: it says "sent to the kitchen", "the
// restaurant is preparing your order", "Enjoy your meal!". That is correct for
// a restaurant order and wrong — sometimes embarrassingly so — for anything
// else. A pharmacy customer told to "enjoy your meal" reads as a system that
// does not know what it just delivered, and for a prescription that lands
// somewhere between careless and a privacy signal on a lock screen.
//
// WHY AN OVERRIDE LAYER RATHER THAN REWRITING THE BASE MAP.
// Food is ~100% of live orders and its English strings are under a deliberate
// behaviour lock (copy.test.ts asserts them byte-for-byte). Rewriting the base
// map to be vertical-neutral would change what every current customer receives
// today in order to serve verticals that are still server-disabled. So the base
// map stays exactly as it is, and only non-food verticals override it.
//
// UNKNOWN VERTICALS FALL BACK TO GENERIC, NOT TO FOOD. A vertical added later
// (or a NULL from an old row) must not inherit "Enjoy your meal!" by accident —
// that is the failure this whole layer exists to prevent. GENERIC_BY_EVENT is
// the safety net, and it is deliberately bland: it describes the ORDER, never
// its contents.
export type VerticalId = 'food' | 'grocery' | 'pharmacy';

// Only the events whose FOOD wording is actually vertical-specific need an
// override. Everything else (payment_failed, new_message, credit_issued …) is
// already neutral and is deliberately absent here.
//
// Pharmacy copy additionally avoids naming the goods at all. A push preview is
// visible on a locked screen to anyone holding the phone, so "your pharmacy
// order" is the most it should ever say — never an item, never a category.
const VERTICAL_COPY: Partial<
  Record<VerticalId, Partial<Record<Locale, Record<string, PushCopy>>>>
> = {
  grocery: {
    en: {
      order_paid: { title: 'Payment confirmed', body: 'Your order is confirmed and being prepared.' },
      order_accepted: { title: 'Order accepted', body: 'The store is picking your items.' },
      order_delivered: { title: 'Delivered', body: 'Your order has arrived. Tap to rate it.' },
      order_rejected: { title: 'Order declined', body: 'The store could not take your order. Any charge is refunded.' },
      driver_assigned: { title: 'Driver on the way', body: 'A driver is heading to the store for your order.' },
      order_ready_pickup: { title: 'Order ready for pickup', body: 'An order is ready — head to the store to collect it.' },
    },
    ar: {
      order_paid: { title: 'تم تأكيد الدفع', body: 'تم تأكيد طلبك ويجري تجهيزه.' },
      order_accepted: { title: 'تم قبول الطلب', body: 'المتجر يجهّز منتجاتك.' },
      order_delivered: { title: 'تم التوصيل', body: 'وصل طلبك. اضغط للتقييم.' },
      order_rejected: { title: 'تم رفض الطلب', body: 'تعذر على المتجر قبول طلبك. سيتم رد أي مبلغ.' },
      driver_assigned: { title: 'السائق في الطريق', body: 'السائق متوجه إلى المتجر لاستلام طلبك.' },
      order_ready_pickup: { title: 'الطلب جاهز للاستلام', body: 'هناك طلب جاهز — توجه إلى المتجر لاستلامه.' },
    },
    ru: {
      order_paid: { title: 'Оплата подтверждена', body: 'Ваш заказ подтверждён и готовится.' },
      order_accepted: { title: 'Заказ принят', body: 'Магазин собирает ваши товары.' },
      order_delivered: { title: 'Доставлено', body: 'Ваш заказ доставлен. Нажмите, чтобы оценить.' },
      order_rejected: { title: 'Заказ отклонён', body: 'Магазин не смог принять заказ. Оплата будет возвращена.' },
      driver_assigned: { title: 'Курьер в пути', body: 'Курьер направляется в магазин за вашим заказом.' },
      order_ready_pickup: { title: 'Заказ готов к выдаче', body: 'Заказ готов — заберите его в магазине.' },
    },
    it: {
      order_paid: { title: 'Pagamento confermato', body: 'Il tuo ordine è confermato ed è in preparazione.' },
      order_accepted: { title: 'Ordine accettato', body: 'Il negozio sta preparando i tuoi articoli.' },
      order_delivered: { title: 'Consegnato', body: 'Il tuo ordine è arrivato. Tocca per valutarlo.' },
      order_rejected: { title: 'Ordine rifiutato', body: 'Il negozio non ha potuto accettare l\'ordine. Eventuali addebiti sono rimborsati.' },
      driver_assigned: { title: 'Corriere in arrivo', body: 'Un corriere sta andando al negozio per il tuo ordine.' },
      order_ready_pickup: { title: 'Ordine pronto per il ritiro', body: 'Un ordine è pronto — vai al negozio a ritirarlo.' },
    },
    de: {
      order_paid: { title: 'Zahlung bestätigt', body: 'Deine Bestellung ist bestätigt und wird vorbereitet.' },
      order_accepted: { title: 'Bestellung angenommen', body: 'Der Laden stellt deine Artikel zusammen.' },
      order_delivered: { title: 'Geliefert', body: 'Deine Bestellung ist angekommen. Tippe zum Bewerten.' },
      order_rejected: { title: 'Bestellung abgelehnt', body: 'Der Laden konnte die Bestellung nicht annehmen. Zahlungen werden erstattet.' },
      driver_assigned: { title: 'Fahrer unterwegs', body: 'Ein Fahrer ist auf dem Weg zum Laden für deine Bestellung.' },
      order_ready_pickup: { title: 'Bestellung abholbereit', body: 'Eine Bestellung ist fertig. Fahre zum Laden und hole sie ab.' },
    },
  },
  pharmacy: {
    en: {
      order_paid: { title: 'Payment confirmed', body: 'Your order is confirmed and being prepared.' },
      order_accepted: { title: 'Order accepted', body: 'The pharmacy is preparing your order.' },
      order_delivered: { title: 'Delivered', body: 'Your order has arrived. Tap to rate it.' },
      order_rejected: { title: 'Order declined', body: 'The pharmacy could not take your order. Any charge is refunded.' },
      driver_assigned: { title: 'Driver on the way', body: 'A driver is heading to the pharmacy for your order.' },
      order_ready_pickup: { title: 'Order ready for pickup', body: 'An order is ready — head to the pharmacy to collect it.' },
    },
    ar: {
      order_paid: { title: 'تم تأكيد الدفع', body: 'تم تأكيد طلبك ويجري تجهيزه.' },
      order_accepted: { title: 'تم قبول الطلب', body: 'الصيدلية تجهّز طلبك.' },
      order_delivered: { title: 'تم التوصيل', body: 'وصل طلبك. اضغط للتقييم.' },
      order_rejected: { title: 'تم رفض الطلب', body: 'تعذر على الصيدلية قبول طلبك. سيتم رد أي مبلغ.' },
      driver_assigned: { title: 'السائق في الطريق', body: 'السائق متوجه إلى الصيدلية لاستلام طلبك.' },
      order_ready_pickup: { title: 'الطلب جاهز للاستلام', body: 'هناك طلب جاهز — توجه إلى الصيدلية لاستلامه.' },
    },
    ru: {
      order_paid: { title: 'Оплата подтверждена', body: 'Ваш заказ подтверждён и готовится.' },
      order_accepted: { title: 'Заказ принят', body: 'Аптека готовит ваш заказ.' },
      order_delivered: { title: 'Доставлено', body: 'Ваш заказ доставлен. Нажмите, чтобы оценить.' },
      order_rejected: { title: 'Заказ отклонён', body: 'Аптека не смогла принять заказ. Оплата будет возвращена.' },
      driver_assigned: { title: 'Курьер в пути', body: 'Курьер направляется в аптеку за вашим заказом.' },
      order_ready_pickup: { title: 'Заказ готов к выдаче', body: 'Заказ готов — заберите его в аптеке.' },
    },
    it: {
      order_paid: { title: 'Pagamento confermato', body: 'Il tuo ordine è confermato ed è in preparazione.' },
      order_accepted: { title: 'Ordine accettato', body: 'La farmacia sta preparando il tuo ordine.' },
      order_delivered: { title: 'Consegnato', body: 'Il tuo ordine è arrivato. Tocca per valutarlo.' },
      order_rejected: { title: 'Ordine rifiutato', body: 'La farmacia non ha potuto accettare l\'ordine. Eventuali addebiti sono rimborsati.' },
      driver_assigned: { title: 'Corriere in arrivo', body: 'Un corriere sta andando in farmacia per il tuo ordine.' },
      order_ready_pickup: { title: 'Ordine pronto per il ritiro', body: 'Un ordine è pronto — vai in farmacia a ritirarlo.' },
    },
    de: {
      order_paid: { title: 'Zahlung bestätigt', body: 'Deine Bestellung ist bestätigt und wird vorbereitet.' },
      order_accepted: { title: 'Bestellung angenommen', body: 'Die Apotheke bereitet deine Bestellung vor.' },
      order_delivered: { title: 'Geliefert', body: 'Deine Bestellung ist angekommen. Tippe zum Bewerten.' },
      order_rejected: { title: 'Bestellung abgelehnt', body: 'Die Apotheke konnte die Bestellung nicht annehmen. Zahlungen werden erstattet.' },
      driver_assigned: { title: 'Fahrer unterwegs', body: 'Ein Fahrer ist auf dem Weg zur Apotheke für deine Bestellung.' },
      order_ready_pickup: { title: 'Bestellung abholbereit', body: 'Eine Bestellung ist fertig. Fahre zur Apotheke und hole sie ab.' },
    },
  },
};

// Safety net for a vertical we have no copy for — a new vertical, or a NULL
// from a row predating the order snapshot. Deliberately says nothing about
// WHAT was ordered: it describes the order's state only, which is true for
// every vertical that will ever exist.
const GENERIC_BY_EVENT: Record<Locale, Record<string, PushCopy>> = {
  en: {
    order_paid: { title: 'Payment confirmed', body: 'Your order is confirmed and being prepared.' },
    order_accepted: { title: 'Order accepted', body: 'Your order is being prepared.' },
    order_delivered: { title: 'Delivered', body: 'Your order has arrived. Tap to rate it.' },
    order_rejected: { title: 'Order declined', body: 'Your order could not be accepted. Any charge is refunded.' },
    driver_assigned: { title: 'Driver on the way', body: 'A driver is collecting your order.' },
    order_ready_pickup: { title: 'Order ready for pickup', body: 'An order is ready for collection.' },
  },
  ar: {
    order_paid: { title: 'تم تأكيد الدفع', body: 'تم تأكيد طلبك ويجري تجهيزه.' },
    order_accepted: { title: 'تم قبول الطلب', body: 'يجري تجهيز طلبك.' },
    order_delivered: { title: 'تم التوصيل', body: 'وصل طلبك. اضغط للتقييم.' },
    order_rejected: { title: 'تم رفض الطلب', body: 'تعذر قبول طلبك. سيتم رد أي مبلغ.' },
    driver_assigned: { title: 'السائق في الطريق', body: 'السائق في طريقه لاستلام طلبك.' },
    order_ready_pickup: { title: 'الطلب جاهز للاستلام', body: 'هناك طلب جاهز للاستلام.' },
  },
  ru: {
    order_paid: { title: 'Оплата подтверждена', body: 'Ваш заказ подтверждён и готовится.' },
    order_accepted: { title: 'Заказ принят', body: 'Ваш заказ готовится.' },
    order_delivered: { title: 'Доставлено', body: 'Ваш заказ доставлен. Нажмите, чтобы оценить.' },
    order_rejected: { title: 'Заказ отклонён', body: 'Ваш заказ не может быть принят. Оплата будет возвращена.' },
    driver_assigned: { title: 'Курьер в пути', body: 'Курьер забирает ваш заказ.' },
    order_ready_pickup: { title: 'Заказ готов к выдаче', body: 'Заказ готов к выдаче.' },
  },
  it: {
    order_paid: { title: 'Pagamento confermato', body: 'Il tuo ordine è confermato ed è in preparazione.' },
    order_accepted: { title: 'Ordine accettato', body: 'Il tuo ordine è in preparazione.' },
    order_delivered: { title: 'Consegnato', body: 'Il tuo ordine è arrivato. Tocca per valutarlo.' },
    order_rejected: { title: 'Ordine rifiutato', body: 'Il tuo ordine non è stato accettato. Eventuali addebiti sono rimborsati.' },
    driver_assigned: { title: 'Corriere in arrivo', body: 'Un corriere sta ritirando il tuo ordine.' },
    order_ready_pickup: { title: 'Ordine pronto per il ritiro', body: 'Un ordine è pronto per il ritiro.' },
  },
  de: {
    order_paid: { title: 'Zahlung bestätigt', body: 'Deine Bestellung ist bestätigt und wird vorbereitet.' },
    order_accepted: { title: 'Bestellung angenommen', body: 'Deine Bestellung wird vorbereitet.' },
    order_delivered: { title: 'Geliefert', body: 'Deine Bestellung ist angekommen. Tippe zum Bewerten.' },
    order_rejected: { title: 'Bestellung abgelehnt', body: 'Deine Bestellung konnte nicht angenommen werden. Zahlungen werden erstattet.' },
    driver_assigned: { title: 'Fahrer unterwegs', body: 'Ein Fahrer holt deine Bestellung ab.' },
    order_ready_pickup: { title: 'Bestellung abholbereit', body: 'Eine Bestellung ist abholbereit.' },
  },
};

// Which events change wording by vertical. Derived from GENERIC_BY_EVENT so the
// two cannot drift: adding a generic entry automatically makes that event
// vertical-sensitive.
const VERTICAL_SENSITIVE_EVENTS = new Set(Object.keys(GENERIC_BY_EVENT.en));

// Resolve the copy for an event in a recipient's locale.
//
// Chain, in order:
//   1. vertical-specific copy for this locale        (grocery/pharmacy)
//   2. vertical-specific copy in English             (partial translations)
//   3. GENERIC copy — for a vertical we do not know, on an event whose food
//      wording would be wrong. This is the step that prevents a pharmacy order
//      inheriting "Enjoy your meal!".
//   4. locale food copy -> English food copy -> per-locale generic fallback
//      (the original chain, unchanged, and what every food order still gets)
//
// `vertical` is optional so every existing caller keeps compiling and keeps its
// exact behaviour; omitting it is treated as food, which is what the callers
// that do not pass it are actually sending today.
export function resolveCopy(
  event: string,
  rawLocale: string | null | undefined,
  vertical?: string | null,
): PushCopy {
  const locale = normalizeLocale(rawLocale);
  const v = typeof vertical === 'string' ? vertical.trim().toLowerCase() : '';

  if (v && v !== 'food' && VERTICAL_SENSITIVE_EVENTS.has(event)) {
    const perVertical = VERTICAL_COPY[v as VerticalId];
    const hit = perVertical?.[locale]?.[event] ?? perVertical?.en?.[event];
    if (hit) return hit;
    // Known-to-be-non-food but unknown vertical: never fall through to the food
    // map for an event whose food wording would be wrong.
    return GENERIC_BY_EVENT[locale][event] ?? GENERIC_BY_EVENT.en[event];
  }

  return COPY[locale][event] ?? COPY.en[event] ?? FALLBACK_COPY[locale];
}
