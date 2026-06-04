import type { Address, PaymentMethod, User } from '../types';

// Tourist-first demo persona: a hotel guest paying by card. A resident
// apartment address is still included (dual-market), but the default the app
// opens with is the hotel — matching the English-first, tourist-led framing.
export const DEFAULT_USER: User = {
  id: 'u-guest',
  phone: '+20 100 555 1212',
  displayName: 'Guest',
  email: 'guest@example.com',
  defaultAddressId: 'a-hotel-hilton',
  defaultPaymentMethodId: 'pm-card-visa',
  preferredCurrency: 'EGP',
  locale: 'en',
  allergyProfile: [],
  createdAt: Date.now() - 86400000 * 4,
};

export const DEFAULT_ADDRESSES: Address[] = [
  {
    id: 'a-hotel-hilton',
    kind: 'hotel',
    label: 'My hotel',
    hotelId: 'hotel-hilton-sharks-bay',
    hotelName: 'Hilton Sharks Bay Resort',
    roomNumber: '412',
    handoff: 'lobby',
    isDefault: true,
  },
  {
    id: 'a-home',
    kind: 'street',
    label: 'Home',
    streetText: 'El-Salam, Imam Ali St.',
    building: 'Block 14',
    apartment: 'Floor 3, Apt 7',
    landmark: 'Next to Al-Rahma Mosque',
  },
];

export const DEFAULT_PAYMENT_METHODS: PaymentMethod[] = [
  {
    id: 'pm-cash',
    kind: 'cash',
    label: 'كاش عند الاستلام',
    subline: 'السائق معاه فكة',
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
    label: 'Visa ·· 4242',
    subline: 'Expires 09/27',
    isDefault: true,
  },
  {
    id: 'pm-apple',
    kind: 'apple_pay',
    label: 'Apple Pay',
    subline: 'Face ID',
  },
];
