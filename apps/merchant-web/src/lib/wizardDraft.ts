/**
 * Onboarding wizard draft: localStorage persistence + per-step validation.
 * Pure functions (storage injected) so vitest covers them without a DOM.
 */
import type { RestaurantApplication } from './onboarding';

const KEY = 'sharmeats-merchant-onboarding-draft';

function isDraftShaped(v: unknown): v is Partial<WizardDraft> {
  if (typeof v !== 'object' || v === null) return false;

  const obj = v as Record<string, unknown>;
  const empty = emptyDraft();

  for (const key of Object.keys(obj)) {
    if (!(key in empty)) continue; // Skip unknown keys

    const val = obj[key];
    const emptyVal = empty[key as keyof WizardDraft];

    // Validate type compatibility
    if (typeof emptyVal === 'string' && typeof val !== 'string') return false;
    if (typeof emptyVal === 'boolean' && typeof val !== 'boolean') return false;
    if (typeof emptyVal === 'number' && (typeof val !== 'number' || !Number.isFinite(val))) return false;
    if (Array.isArray(emptyVal)) {
      if (!Array.isArray(val)) return false;
      if (!val.every((item) => typeof item === 'string')) return false;
    }
    if ((key === 'lat' || key === 'lng') && val !== null && (typeof val !== 'number' || !Number.isFinite(val))) return false;
    if (key === 'payoutMethod' && val !== 'bank' && val !== 'wallet') return false;
  }

  return true;
}

export interface WizardDraft {
  name: string;
  description: string;
  cuisines: string[];
  phone: string;
  address: string;
  isOpen24h: boolean;
  prepLow: number;
  prepHigh: number;
  zone: string;
  lat: number | null;
  lng: number | null;
  payoutMethod: 'bank' | 'wallet';
  payoutBankName: string;
  payoutIban: string;
  payoutWallet: string;
  payoutHolder: string;
  termsAccepted: boolean;
}

export function emptyDraft(): WizardDraft {
  return {
    name: '', description: '', cuisines: [], phone: '', address: '',
    isOpen24h: false, prepLow: 15, prepHigh: 30,
    zone: '', lat: null, lng: null,
    payoutMethod: 'bank', payoutBankName: '', payoutIban: '', payoutWallet: '',
    payoutHolder: '', termsAccepted: false,
  };
}

export function loadDraft(storage: Pick<Storage, 'getItem'>): WizardDraft {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return emptyDraft();
    const parsed = JSON.parse(raw);
    if (!isDraftShaped(parsed)) return emptyDraft();
    return { ...emptyDraft(), ...parsed };
  } catch {
    return emptyDraft();
  }
}

export function saveDraft(storage: Pick<Storage, 'setItem'>, draft: WizardDraft): void {
  storage.setItem(KEY, JSON.stringify(draft));
}

export function clearDraft(storage: Pick<Storage, 'removeItem'>): void {
  storage.removeItem(KEY);
}

const IN_SHARM = (lat: number, lng: number) =>
  lat >= 27.7 && lat <= 28.35 && lng >= 34.2 && lng <= 34.7;

export function validateStep(step: 1 | 2 | 3 | 4, d: WizardDraft): string | null {
  switch (step) {
    case 1: {
      if (d.name.trim().length < 2) return 'Please enter your restaurant name.';
      if (d.phone.trim().length < 6) return 'Please enter a contact phone number.';
      return null;
    }
    case 2: {
      if (!d.zone) return 'Pick your delivery zone.';
      if (d.lat == null || d.lng == null) return 'Set your restaurant location.';
      if (!IN_SHARM(d.lat, d.lng)) return 'That location looks outside Sharm el-Sheikh.';
      return null;
    }
    case 3: {
      if (d.payoutHolder.trim() === '') {
        return d.payoutMethod === 'bank'
          ? 'Enter the bank account holder, bank name and IBAN.'
          : 'Enter the wallet number and account holder.';
      }
      if (d.payoutMethod === 'bank' && (d.payoutBankName.trim() === '' || d.payoutIban.trim() === ''))
        return 'Enter your bank name and IBAN.';
      if (d.payoutMethod === 'wallet' && d.payoutWallet.trim() === '')
        return 'Enter your wallet number.';
      return null;
    }
    case 4:
      return d.termsAccepted ? null : 'Please accept the partner terms to submit.';
  }
}

export function draftToApplication(d: WizardDraft): RestaurantApplication {
  return {
    name: d.name.trim(),
    description: d.description.trim(),
    cuisines: d.cuisines,
    phone: d.phone.trim(),
    address: d.address.trim(),
    zone: d.zone,
    lat: d.lat as number,
    lng: d.lng as number,
    isOpen24h: d.isOpen24h,
    prepLow: d.prepLow,
    prepHigh: d.prepHigh,
    payoutMethod: d.payoutMethod,
    payoutBankName: d.payoutBankName.trim(),
    payoutIban: d.payoutIban.trim(),
    payoutWallet: d.payoutWallet.trim(),
    payoutHolder: d.payoutHolder.trim(),
  };
}
