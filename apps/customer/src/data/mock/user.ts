import type { Address, PaymentMethod, User } from '../types';

export const DEFAULT_USER: User = {
  id: 'u-ahmed-hassan',
  phone: '+20 100 555 1212',
  displayName: 'أحمد',
  email: 'ahmed@example.com',
  defaultAddressId: 'a-default-street',
  defaultPaymentMethodId: 'pm-cash',
  preferredCurrency: 'EGP',
  locale: 'ar',
  allergyProfile: [],
  createdAt: Date.now() - 86400000 * 4,
};

export const DEFAULT_ADDRESSES: Address[] = [
  {
    id: 'a-default-street',
    kind: 'street',
    label: 'البيت',
    streetText: 'السلام، شارع الإمام علي',
    building: 'بلوك ١٤',
    apartment: 'الدور ٣، شقة ٧',
    landmark: 'جنب مسجد الرحمة',
    isDefault: true,
  },
  {
    id: 'a-work',
    kind: 'street',
    label: 'الشغل',
    streetText: 'مبارك ٧، الشارع الرئيسي',
    building: 'مبنى الإدارة',
    apartment: 'الدور ٢',
    landmark: 'مقابل بنك مصر',
  },
  {
    id: 'a-hotel-hilton',
    kind: 'hotel',
    label: 'فندق ضيوف',
    hotelId: 'hotel-hilton-sharks-bay',
    hotelName: 'Hilton Sharks Bay Resort',
    roomNumber: '412',
    handoff: 'lobby',
  },
];

export const DEFAULT_PAYMENT_METHODS: PaymentMethod[] = [
  {
    id: 'pm-cash',
    kind: 'cash',
    label: 'كاش عند الاستلام',
    subline: 'السائق معاه فكة',
    isDefault: true,
  },
  {
    id: 'pm-vodafone',
    kind: 'vodafone_cash',
    label: 'فودافون كاش',
    subline: '+20 100 555 1212',
  },
  {
    id: 'pm-instapay',
    kind: 'instapay',
    label: 'InstaPay',
    subline: 'تحويل فوري',
  },
  {
    id: 'pm-fawry',
    kind: 'fawry',
    label: 'فوري',
    subline: 'أكشاك الدفع',
  },
  {
    id: 'pm-card-visa',
    kind: 'card',
    label: '·· 4242',
    subline: 'Visa · تنتهي 09/27',
  },
  {
    id: 'pm-apple',
    kind: 'apple_pay',
    label: 'Apple Pay',
    subline: 'Face ID',
  },
];
