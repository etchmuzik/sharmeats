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

// Resolve the copy for an event in a recipient's locale.
// Chain: locale copy -> English copy -> per-locale generic fallback.
export function resolveCopy(event: string, rawLocale: string | null | undefined): PushCopy {
  const locale = normalizeLocale(rawLocale);
  return COPY[locale][event] ?? COPY.en[event] ?? FALLBACK_COPY[locale];
}
