export const SUPPORTED_LOCALES = ['en', 'ar'] as const;
export const DRIVER_LOCALE_STORAGE_KEY = 'sharmeats.driver.locale';

export type Locale = (typeof SUPPORTED_LOCALES)[number];

const ENGLISH = {
  'language.current': 'Language',
  'language.switchToArabic': 'العربية',
  'language.switchToEnglish': 'English',
  'language.switchA11yArabic': 'Switch language to Arabic',
  'language.switchA11yEnglish': 'تغيير اللغة إلى الإنجليزية',
  'nav.deliveries': 'Deliveries',
  'nav.delivery': 'Delivery',
  'nav.chat': 'Chat',
  'nav.history': 'History',
  'nav.tier': 'My tier',
  'nav.verification': 'Verification',
  'signin.driver': 'Driver',
  'signin.title': 'Sign in',
  'signin.subtitle': 'Use the email and password from dispatch.',
  'signin.email': 'Email address',
  'signin.password': 'Password',
  'signin.submit': 'Sign in',
  'signin.error': 'Could not sign in',
  'signin.invalidCredentials': 'The email or password is incorrect.',
  'signin.invalidEmail': 'Enter a valid email address.',
  'signin.emailNotConfirmed': 'Confirm your email before signing in.',
  'signin.rateLimited': 'Too many attempts. Wait a minute, then try again.',
  'signin.help': 'Can’t sign in? Contact driver support',
  'signin.helpA11y': 'Contact Sharm Eats support for sign-in help',
  'signin.agreementPrefix': 'By continuing you agree to our',
  'signin.terms': 'Terms of Service',
  'signin.privacy': 'Privacy Policy',
  'common.retry': 'Retry',
  'common.signOut': 'Sign out',
  'common.legal': 'Legal',
  'common.terms': 'Terms of Service',
  'common.privacy': 'Privacy Policy',
  'common.cancel': 'Cancel',
  'common.continue': 'Continue',
  'common.complete': 'complete',
  'common.notComplete': 'not complete',
  'common.driver': 'Driver',
  'common.egp': 'EGP',
  'common.connectionRetry': 'Check your connection and try again.',
  'common.sessionExpired': 'Your session expired. Sign in again.',
  'index.backendTitle': 'Backend not configured',
  'index.backendBody':
    'Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY, then restart.',
  'avatar.permission': 'Allow photo access in Settings to set a profile photo.',
  'avatar.updated': 'Profile photo updated.',
  'avatar.uploadError': "Couldn't upload the photo. Try again.",
  'avatar.changeA11y': 'Change your profile photo',
  'avatar.addA11y': 'Add a profile photo',
  'home.profileLoadTitle': "Couldn't load your profile",
  'home.profileLoadBody': 'Check your connection and try again.',
  'home.retryA11y': 'Retry loading your profile',
  'home.notRegisteredTitle': 'Not a registered driver',
  'home.notRegisteredBody':
    "Your account isn't linked to a driver profile yet. Contact Sharm Eats ops to get set up.",
  'home.pendingVerification': 'pending verification',
  'home.statusError': "Couldn't update your status. Check your connection.",
  'home.acceptError': "Couldn't accept the offer. Refresh offers and try again.",
  'home.declineError': "Couldn't decline the offer.",
  'home.online': "You're online",
  'home.offline': "You're offline",
  'home.verifyToReceive': 'Complete verification to start receiving offers',
  'home.receivingOffers': 'Receiving delivery offers',
  'home.goOnlineToReceive': 'Go online to receive offers',
  'home.receiveOffersA11y': 'Receive delivery offers',
  'home.toggleHint': 'Turns new delivery offers on or off',
  'home.toggleVerifyHint': 'Complete verification before going online',
  'home.deliveryHistory': 'Delivery history',
  'home.myTier': 'My tier',
  'home.verificationDocuments': 'Verification documents',
  'home.newOffers': 'New offers · {count}',
  'home.waitingOffers': 'Waiting for offers',
  'home.offersPaused': 'Offers paused',
  'home.onlineEmptyA11y':
    'No offers right now. You are online and ready for nearby deliveries.',
  'home.offlineEmptyA11y': 'Offers are paused. Go online to receive deliveries.',
  'home.onlineEmptyTitle': 'You’re ready for nearby deliveries',
  'home.offlineEmptyTitle': 'Go online when you’re ready',
  'home.onlineEmptyBody': 'New offers will appear here with a notification.',
  'home.offlineEmptyBody': 'Use the switch above to start receiving offers.',
  'earnings.today': 'Earned today',
  'earnings.deliveries': 'Deliveries',
  'earnings.tips': 'Tips today',
  'earnings.cashToSettle': 'Cash to settle',
  'earnings.codOwed': 'COD owed',
  'job.active': 'Active delivery',
  'job.continue': 'tap to continue',
  'job.continueA11y': 'Continue delivery {code} from {restaurant}',
  'job.unreadOne': '{count} new message',
  'job.unreadMany': '{count} new messages',
  'job.unreadA11yOne': '{count} unread message — open chat',
  'job.unreadA11yMany': '{count} unread messages — open chat',
  'job.status.placed': 'Placed',
  'job.status.accepted': 'Accepted',
  'job.status.preparing': 'Preparing',
  'job.status.ready': 'Ready for pickup',
  'job.status.pickedUp': 'Picked up',
  'job.status.outForDelivery': 'Out for delivery',
  'job.status.delivered': 'Delivered',
  'job.status.cancelled': 'Cancelled',
  'job.status.rejected': 'Rejected',
  'offer.criticalAnnouncement': 'Offer from {restaurant} expires in {seconds} seconds',
  'offer.expired': 'Expired',
  'offer.expiresIn': 'Expires in {time}',
  'offer.pickup': 'Pickup',
  'offer.earn': 'You earn {amount} EGP',
  'offer.dropoffArea': 'Drop-off area: {zone}',
  'offer.dropoffPending': 'Drop-off area appears when dispatch confirms it.',
  'offer.unlock': 'The exact address and customer contact unlock after you accept.',
  'offer.decline': 'Decline',
  'offer.accept': 'Accept',
  'offer.declineA11y': 'Decline offer from {restaurant}',
  'offer.acceptA11y': 'Accept offer from {restaurant} for {amount} EGP',
  'offer.expiredA11y': 'Offer expired',
  'offer.noLongerAvailable': 'This offer is no longer available. Refreshing offers.',
  'job.locationError': 'Live location could not start. Check location permissions.',
  'job.updateError': 'Could not update. Try again.',
  'job.generalError': 'Something went wrong. Try again.',
  'job.statusChanged': 'The delivery status changed. Refresh and try again.',
  'job.assignmentChanged':
    'This delivery is no longer assigned to you. Return home for the latest job.',
  'job.locationPermission':
    'Allow location all the time in Settings before starting the delivery.',
  'job.locationServices': 'Turn on device location services, then try again.',
  'job.mapsError': 'Could not open maps. Is a maps app installed?',
  'job.notFound': 'Job not found.',
  'job.codeA11y': 'Delivery code {code}',
  'job.collectCashTitle': 'Collect cash',
  'job.collectCashBody': 'Collect {amount} EGP from the customer?',
  'job.cashCollected': 'Collected {amount} EGP',
  'job.hotel': 'Hotel',
  'job.room': 'Room',
  'job.building': 'Bldg',
  'job.apartment': 'Apt',
  'job.beachPin': 'Beach pin',
  'job.address': 'Address',
  'job.beach': 'Beach',
  'job.stepA11y': '{step}: {state}',
  'job.navigateRestaurant': 'Navigate to restaurant',
  'job.navigateCustomer': 'Navigate to customer',
  'job.deliverTo': 'Deliver to',
  'job.landmark': 'Landmark: {landmark}',
  'job.callCustomer': 'Call customer',
  'job.message': 'Message',
  'job.customerNote': 'Note from the customer',
  'job.bagOne': '{count} item in the bag',
  'job.bagMany': '{count} items in the bag',
  'job.prescription': 'Rx — check prescription before handover',
  'job.prescriptionA11y': 'Prescription required — check before handover',
  'job.collectCash': 'Collect {amount} EGP cash',
  'job.paidCard': 'Paid by card · {amount} EGP',
  'job.tipIncluded': 'Includes {amount} EGP tip for you',
  'job.pickedUpAction': 'Picked up from restaurant',
  'job.startDelivery': 'Start delivery',
  'job.completeDelivery': 'Complete delivery',
  'job.waitingRestaurant': 'Waiting for the restaurant to finish preparing…',
  'tracking.title': 'Live delivery location',
  'tracking.body':
    'While this delivery is active, Sharm Eats uses your location in the background so the customer can follow the driver and dispatch can keep the delivery safe. Android shows a persistent notification. Tracking stops when the delivery ends or you go offline.',
  'tracking.notNow': 'Not now',
  'tracking.notificationTitle': 'Sharm Eats delivery in progress',
  'tracking.notificationBody': 'Sharing your live location for the active delivery.',
  'countdown.pickupBy': 'Pick up by',
  'countdown.deliverBy': 'Deliver by',
  'countdown.pickupOverdue': 'Pickup overdue',
  'countdown.deliveryOverdue': 'Delivery overdue',
  'hotel.delivery': 'Hotel delivery',
  'hotel.noCall': 'No phone call needed',
  'hotel.room': 'Room',
  'hotel.receptionTitle': 'Hand to reception',
  'hotel.receptionHint': 'Leave with the front desk under the guest name.',
  'hotel.lobbyTitle': 'Meet in the lobby',
  'hotel.lobbyHint': 'The guest will meet you in the hotel lobby.',
  'hotel.poolsideTitle': 'Deliver poolside',
  'hotel.poolsideHint': 'Take the order to the pool area and ask staff for the guest.',
  'hotel.toRoom': 'Deliver to the room',
  'dropoff.handToGuest': 'Hand to the guest',
  'dropoff.leaveAtDoor': "Leave at the door, don't wait",
  'dropoff.meetOutside': 'Guest will meet you outside',
  'dropoff.noBell': "Don't ring the bell or knock",
  'dropoff.callOnArrival': 'Call the guest on arrival',
} as const;

export type TranslationKey = keyof typeof ENGLISH;

const ARABIC: Record<TranslationKey, string> = {
  'language.current': 'اللغة',
  'language.switchToArabic': 'العربية',
  'language.switchToEnglish': 'English',
  'language.switchA11yArabic': 'تغيير اللغة إلى العربية',
  'language.switchA11yEnglish': 'تغيير اللغة إلى الإنجليزية',
  'nav.deliveries': 'التوصيلات',
  'nav.delivery': 'التوصيل',
  'nav.chat': 'المحادثة',
  'nav.history': 'السجل',
  'nav.tier': 'مستواي',
  'nav.verification': 'التحقق',
  'signin.driver': 'السائق',
  'signin.title': 'تسجيل الدخول',
  'signin.subtitle': 'استخدم البريد الإلكتروني وكلمة المرور من فريق التشغيل.',
  'signin.email': 'البريد الإلكتروني',
  'signin.password': 'كلمة المرور',
  'signin.submit': 'تسجيل الدخول',
  'signin.error': 'تعذر تسجيل الدخول',
  'signin.invalidCredentials': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
  'signin.invalidEmail': 'أدخل بريدًا إلكترونيًا صحيحًا.',
  'signin.emailNotConfirmed': 'أكد بريدك الإلكتروني قبل تسجيل الدخول.',
  'signin.rateLimited': 'محاولات كثيرة. انتظر دقيقة ثم حاول مرة أخرى.',
  'signin.help': 'لا تستطيع تسجيل الدخول؟ تواصل مع دعم السائقين',
  'signin.helpA11y': 'تواصل مع دعم شارم إيتس للمساعدة في تسجيل الدخول',
  'signin.agreementPrefix': 'بالمتابعة، أنت توافق على',
  'signin.terms': 'شروط الخدمة',
  'signin.privacy': 'سياسة الخصوصية',
  'common.retry': 'إعادة المحاولة',
  'common.signOut': 'تسجيل الخروج',
  'common.legal': 'قانوني',
  'common.terms': 'شروط الخدمة',
  'common.privacy': 'سياسة الخصوصية',
  'common.cancel': 'إلغاء',
  'common.continue': 'متابعة',
  'common.complete': 'مكتملة',
  'common.notComplete': 'غير مكتملة',
  'common.driver': 'سائق',
  'common.egp': 'ج.م',
  'common.connectionRetry': 'تحقق من الاتصال وحاول مرة أخرى.',
  'common.sessionExpired': 'انتهت جلستك. سجّل الدخول مرة أخرى.',
  'index.backendTitle': 'لم يتم إعداد الخادم',
  'index.backendBody':
    'اضبط EXPO_PUBLIC_SUPABASE_URL وEXPO_PUBLIC_SUPABASE_ANON_KEY ثم أعد التشغيل.',
  'avatar.permission': 'اسمح بالوصول إلى الصور من الإعدادات لإضافة صورة ملفك.',
  'avatar.updated': 'تم تحديث صورة الملف.',
  'avatar.uploadError': 'تعذر رفع الصورة. حاول مرة أخرى.',
  'avatar.changeA11y': 'تغيير صورة ملفك',
  'avatar.addA11y': 'إضافة صورة للملف',
  'home.profileLoadTitle': 'تعذر تحميل ملفك',
  'home.profileLoadBody': 'تحقق من الاتصال وحاول مرة أخرى.',
  'home.retryA11y': 'إعادة محاولة تحميل ملف السائق',
  'home.notRegisteredTitle': 'الحساب غير مسجل كسائق',
  'home.notRegisteredBody':
    'حسابك غير مرتبط بملف سائق حتى الآن. تواصل مع فريق تشغيل شارم إيتس لتفعيله.',
  'home.pendingVerification': 'التحقق قيد الانتظار',
  'home.statusError': 'تعذر تحديث حالتك. تحقق من الاتصال.',
  'home.acceptError': 'تعذر قبول العرض. حدّث العروض وحاول مرة أخرى.',
  'home.declineError': 'تعذر رفض العرض.',
  'home.online': 'أنت متصل الآن',
  'home.offline': 'أنت غير متصل',
  'home.verifyToReceive': 'أكمل التحقق لتبدأ في استقبال العروض',
  'home.receivingOffers': 'تستقبل عروض التوصيل',
  'home.goOnlineToReceive': 'اتصل لاستقبال العروض',
  'home.receiveOffersA11y': 'استقبال عروض التوصيل',
  'home.toggleHint': 'يشغل أو يوقف عروض التوصيل الجديدة',
  'home.toggleVerifyHint': 'أكمل التحقق قبل الاتصال',
  'home.deliveryHistory': 'سجل التوصيلات',
  'home.myTier': 'مستواي',
  'home.verificationDocuments': 'مستندات التحقق',
  'home.newOffers': 'عروض جديدة · {count}',
  'home.waitingOffers': 'في انتظار العروض',
  'home.offersPaused': 'العروض متوقفة',
  'home.onlineEmptyA11y': 'لا توجد عروض الآن. أنت متصل ومستعد للتوصيلات القريبة.',
  'home.offlineEmptyA11y': 'العروض متوقفة. اتصل لاستقبال التوصيلات.',
  'home.onlineEmptyTitle': 'أنت مستعد للتوصيلات القريبة',
  'home.offlineEmptyTitle': 'اتصل عندما تكون مستعدًا',
  'home.onlineEmptyBody': 'ستظهر العروض الجديدة هنا مع إشعار.',
  'home.offlineEmptyBody': 'استخدم المفتاح بالأعلى لبدء استقبال العروض.',
  'earnings.today': 'أرباح اليوم',
  'earnings.deliveries': 'التوصيلات',
  'earnings.tips': 'إكراميات اليوم',
  'earnings.cashToSettle': 'نقدية للتسوية',
  'earnings.codOwed': 'نقدية التحصيل',
  'job.active': 'توصيل نشط',
  'job.continue': 'اضغط للمتابعة',
  'job.continueA11y': 'متابعة التوصيل {code} من {restaurant}',
  'job.unreadOne': 'رسالة جديدة واحدة',
  'job.unreadMany': '{count} رسائل جديدة',
  'job.unreadA11yOne': 'رسالة واحدة غير مقروءة — افتح المحادثة',
  'job.unreadA11yMany': '{count} رسائل غير مقروءة — افتح المحادثة',
  'job.status.placed': 'تم الطلب',
  'job.status.accepted': 'تم القبول',
  'job.status.preparing': 'قيد التحضير',
  'job.status.ready': 'جاهز للاستلام',
  'job.status.pickedUp': 'تم الاستلام',
  'job.status.outForDelivery': 'خرج للتوصيل',
  'job.status.delivered': 'تم التوصيل',
  'job.status.cancelled': 'ملغي',
  'job.status.rejected': 'مرفوض',
  'offer.criticalAnnouncement': 'عرض من {restaurant} ينتهي خلال {seconds} ثانية',
  'offer.expired': 'انتهى',
  'offer.expiresIn': 'ينتهي خلال {time}',
  'offer.pickup': 'الاستلام',
  'offer.earn': 'ربحك {amount} ج.م',
  'offer.dropoffArea': 'منطقة التسليم: {zone}',
  'offer.dropoffPending': 'تظهر منطقة التسليم بعد تأكيد فريق التشغيل.',
  'offer.unlock': 'يظهر العنوان الدقيق وبيانات العميل بعد قبولك.',
  'offer.decline': 'رفض',
  'offer.accept': 'قبول',
  'offer.declineA11y': 'رفض العرض من {restaurant}',
  'offer.acceptA11y': 'قبول العرض من {restaurant} مقابل {amount} ج.م',
  'offer.expiredA11y': 'انتهى العرض',
  'offer.noLongerAvailable': 'لم يعد هذا العرض متاحًا. جارٍ تحديث العروض.',
  'job.locationError': 'تعذر بدء الموقع المباشر. تحقق من أذونات الموقع.',
  'job.updateError': 'تعذر التحديث. حاول مرة أخرى.',
  'job.generalError': 'حدث خطأ. حاول مرة أخرى.',
  'job.statusChanged': 'تغيرت حالة التوصيل. حدّث الشاشة وحاول مرة أخرى.',
  'job.assignmentChanged':
    'لم يعد هذا التوصيل مسندًا إليك. ارجع إلى الرئيسية لرؤية أحدث مهمة.',
  'job.locationPermission':
    'اسمح للموقع بالعمل طوال الوقت من الإعدادات لبدء التوصيل.',
  'job.locationServices': 'شغّل خدمات الموقع في الجهاز ثم حاول مرة أخرى.',
  'job.mapsError': 'تعذر فتح الخرائط. تأكد من تثبيت تطبيق خرائط.',
  'job.notFound': 'لم يتم العثور على التوصيل.',
  'job.codeA11y': 'رمز التوصيل {code}',
  'job.collectCashTitle': 'تحصيل النقدية',
  'job.collectCashBody': 'هل حصلت {amount} ج.م من العميل؟',
  'job.cashCollected': 'تم تحصيل {amount} ج.م',
  'job.hotel': 'الفندق',
  'job.room': 'غرفة',
  'job.building': 'مبنى',
  'job.apartment': 'شقة',
  'job.beachPin': 'نقطة الشاطئ',
  'job.address': 'العنوان',
  'job.beach': 'الشاطئ',
  'job.stepA11y': '{step}: {state}',
  'job.navigateRestaurant': 'الاتجاه إلى المطعم',
  'job.navigateCustomer': 'الاتجاه إلى العميل',
  'job.deliverTo': 'التسليم إلى',
  'job.landmark': 'علامة مميزة: {landmark}',
  'job.callCustomer': 'اتصال بالعميل',
  'job.message': 'رسالة',
  'job.customerNote': 'ملاحظة من العميل',
  'job.bagOne': 'صنف واحد في الحقيبة',
  'job.bagMany': '{count} أصناف في الحقيبة',
  'job.prescription': 'دواء بوصفة — تحقق من الوصفة قبل التسليم',
  'job.prescriptionA11y': 'الوصفة مطلوبة — تحقق منها قبل التسليم',
  'job.collectCash': 'حصّل {amount} ج.م نقدًا',
  'job.paidCard': 'مدفوع بالبطاقة · {amount} ج.م',
  'job.tipIncluded': 'يشمل {amount} ج.م إكرامية لك',
  'job.pickedUpAction': 'تم الاستلام من المطعم',
  'job.startDelivery': 'بدء التوصيل',
  'job.completeDelivery': 'إكمال التوصيل',
  'job.waitingRestaurant': 'في انتظار انتهاء المطعم من التحضير…',
  'tracking.title': 'موقع التوصيل المباشر',
  'tracking.body':
    'أثناء التوصيل النشط، تستخدم شارم إيتس موقعك في الخلفية ليتابعك العميل وليحافظ فريق التشغيل على سلامة التوصيل. يعرض أندرويد إشعارًا دائمًا. يتوقف التتبع عند انتهاء التوصيل أو عند إيقاف اتصالك.',
  'tracking.notNow': 'ليس الآن',
  'tracking.notificationTitle': 'توصيل شارم إيتس جارٍ',
  'tracking.notificationBody': 'تتم مشاركة موقعك المباشر أثناء التوصيل النشط.',
  'countdown.pickupBy': 'الاستلام قبل',
  'countdown.deliverBy': 'التوصيل قبل',
  'countdown.pickupOverdue': 'تأخر الاستلام',
  'countdown.deliveryOverdue': 'تأخر التوصيل',
  'hotel.delivery': 'توصيل إلى فندق',
  'hotel.noCall': 'لا حاجة للاتصال',
  'hotel.room': 'الغرفة',
  'hotel.receptionTitle': 'سلّم إلى الاستقبال',
  'hotel.receptionHint': 'اترك الطلب في الاستقبال باسم النزيل.',
  'hotel.lobbyTitle': 'قابل العميل في البهو',
  'hotel.lobbyHint': 'سيقابلك النزيل في بهو الفندق.',
  'hotel.poolsideTitle': 'التوصيل بجوار المسبح',
  'hotel.poolsideHint': 'خذ الطلب إلى منطقة المسبح واسأل العاملين عن النزيل.',
  'hotel.toRoom': 'التوصيل إلى الغرفة',
  'dropoff.handToGuest': 'سلّم الطلب إلى العميل',
  'dropoff.leaveAtDoor': 'اتركه عند الباب ولا تنتظر',
  'dropoff.meetOutside': 'سيقابلك العميل في الخارج',
  'dropoff.noBell': 'لا تطرق الباب ولا تستخدم الجرس',
  'dropoff.callOnArrival': 'اتصل بالعميل عند الوصول',
};

const MESSAGES: Record<Locale, Record<TranslationKey, string>> = {
  en: ENGLISH,
  ar: ARABIC,
};

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === 'string' && SUPPORTED_LOCALES.includes(value as Locale);
}

export function translate(
  locale: Locale,
  key: TranslationKey,
  params: Record<string, string | number> = {},
): string {
  let message: string = MESSAGES[locale][key] ?? ENGLISH[key];
  for (const [name, value] of Object.entries(params)) {
    message = message.split(`{${name}}`).join(String(value));
  }
  return message;
}

export function localeDirection(locale: Locale) {
  const rtl = locale === 'ar';
  // Use Yoga direction as the only mirroring mechanism. Callers keep
  // flexDirection: 'row'; combining RTL direction with row-reverse would flip
  // the same row twice and put Arabic actions back in physical LTR order.
  return {
    direction: rtl ? ('rtl' as const) : ('ltr' as const),
    textAlign: rtl ? ('right' as const) : ('left' as const),
    writingDirection: rtl ? ('rtl' as const) : ('ltr' as const),
  };
}

export type OperationalFailure =
  | 'signin'
  | 'online'
  | 'offerAccept'
  | 'offerDecline'
  | 'jobUpdate'
  | 'jobComplete'
  | 'location';

function errorDiagnostic(error: unknown): string {
  if (typeof error === 'string') return error.toLowerCase();
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message.toLowerCase();
  }
  return '';
}

function containsAny(value: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern));
}

export function operationalErrorKey(
  failure: OperationalFailure,
  error: unknown,
): TranslationKey {
  const diagnostic = errorDiagnostic(error);
  const network = containsAny(diagnostic, [
    'network',
    'failed to fetch',
    'fetch failed',
    'offline',
    'connection',
    'timed out',
    'timeout',
  ]);
  const session = containsAny(diagnostic, [
    'not authenticated',
    'jwt',
    'session expired',
    'invalid token',
  ]);

  if (failure === 'signin') {
    if (
      containsAny(diagnostic, [
        'invalid email',
        'validate email address',
        'email address is invalid',
      ])
    ) {
      return 'signin.invalidEmail';
    }
    if (containsAny(diagnostic, ['invalid login', 'invalid credentials', 'wrong password'])) {
      return 'signin.invalidCredentials';
    }
    if (diagnostic.includes('email not confirmed')) return 'signin.emailNotConfirmed';
    if (containsAny(diagnostic, ['rate limit', 'too many requests', 'too many attempts'])) {
      return 'signin.rateLimited';
    }
    return network ? 'common.connectionRetry' : 'signin.error';
  }

  if (failure === 'location') {
    if (
      containsAny(diagnostic, [
        'permission denied',
        'background location',
        'location permission',
        'allow location',
      ])
    ) {
      return 'job.locationPermission';
    }
    if (containsAny(diagnostic, ['location services', 'location unavailable', 'provider'])) {
      return 'job.locationServices';
    }
    return 'job.locationError';
  }

  if (session) return 'common.sessionExpired';
  if (network) return 'common.connectionRetry';

  if (failure === 'offerAccept' || failure === 'offerDecline') {
    if (
      containsAny(diagnostic, [
        'expired',
        'no longer',
        'already responded',
        'already accepted',
        'reassigned',
        'not offered',
      ])
    ) {
      return 'offer.noLongerAvailable';
    }
    return failure === 'offerAccept' ? 'home.acceptError' : 'home.declineError';
  }

  if (failure === 'jobUpdate' || failure === 'jobComplete') {
    if (
      containsAny(diagnostic, [
        'invalid status',
        'illegal transition',
        'status transition',
        'status changed',
      ])
    ) {
      return 'job.statusChanged';
    }
    if (
      containsAny(diagnostic, [
        'not assigned',
        'reassigned',
        'not authorized',
        'permission denied',
      ])
    ) {
      return 'job.assignmentChanged';
    }
    return failure === 'jobUpdate' ? 'job.updateError' : 'job.generalError';
  }

  return 'home.statusError';
}

export function localizedOperationalError(
  locale: Locale,
  failure: OperationalFailure,
  error: unknown,
): string {
  return translate(locale, operationalErrorKey(failure, error));
}

export function trackingNotificationCopy(storedLocale: unknown): {
  title: string;
  body: string;
} {
  const locale: Locale = isSupportedLocale(storedLocale) ? storedLocale : 'en';
  return {
    title: translate(locale, 'tracking.notificationTitle'),
    body: translate(locale, 'tracking.notificationBody'),
  };
}
