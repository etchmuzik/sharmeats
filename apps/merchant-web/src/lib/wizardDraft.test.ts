import { describe, expect, it } from 'vitest';
import {
  emptyDraft, loadDraft, saveDraft, clearDraft, validateStep, draftToApplication,
} from './wizardDraft';

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(), key: () => null, length: 0,
  } as Storage;
}

describe('draft persistence', () => {
  it('round-trips through storage', () => {
    const s = memStorage();
    const d = { ...emptyDraft(), name: 'Koshary King', zone: 'naama' };
    saveDraft(s, d);
    expect(loadDraft(s)).toEqual(d);
  });
  it('corrupt storage yields a fresh draft', () => {
    const s = memStorage();
    s.setItem('sharmeats-merchant-onboarding-draft', '{not json');
    expect(loadDraft(s)).toEqual(emptyDraft());
  });
  it('clearDraft removes it', () => {
    const s = memStorage();
    saveDraft(s, emptyDraft());
    clearDraft(s);
    expect(s.getItem('sharmeats-merchant-onboarding-draft')).toBeNull();
  });
});

describe('validateStep', () => {
  it('step 1 requires name and phone', () => {
    expect(validateStep(1, emptyDraft())).toMatch(/name/i);
    const named = { ...emptyDraft(), name: 'Koshary King' };
    expect(validateStep(1, named)).toMatch(/phone/i);
    expect(validateStep(1, { ...named, phone: '+201234567890' })).toBeNull();
  });
  it('step 2 requires zone and in-box coordinates', () => {
    const base = { ...emptyDraft(), name: 'K', phone: '+201234567890' };
    expect(validateStep(2, base)).toMatch(/zone/i);
    const zoned = { ...base, zone: 'naama' };
    expect(validateStep(2, zoned)).toMatch(/location/i);
    expect(validateStep(2, { ...zoned, lat: 27.91, lng: 34.33 })).toBeNull();
    expect(validateStep(2, { ...zoned, lat: 30.0, lng: 31.2 })).toMatch(/Sharm/i);
  });
  it('step 3 requires payout details for the chosen method', () => {
    const d = { ...emptyDraft(), payoutMethod: 'bank' as const };
    expect(validateStep(3, d)).toMatch(/IBAN|bank/i);
    expect(validateStep(3, { ...d, payoutBankName: 'CIB', payoutIban: 'EG00', payoutHolder: 'Me' })).toBeNull();
    const w = { ...emptyDraft(), payoutMethod: 'wallet' as const };
    expect(validateStep(3, w)).toMatch(/wallet/i);
    expect(validateStep(3, { ...w, payoutWallet: '+2010', payoutHolder: 'Me' })).toBeNull();
  });
  it('step 4 requires terms acceptance', () => {
    expect(validateStep(4, emptyDraft())).toMatch(/terms/i);
    expect(validateStep(4, { ...emptyDraft(), termsAccepted: true })).toBeNull();
  });
});

describe('draftToApplication', () => {
  it('produces trimmed application fields', () => {
    const d = {
      ...emptyDraft(), name: '  Koshary King ', phone: ' +2012 ', zone: 'naama',
      lat: 27.91, lng: 34.33, termsAccepted: true,
    };
    const app = draftToApplication(d);
    expect(app.name).toBe('Koshary King');
    expect(app.phone).toBe('+2012');
    expect(app.lat).toBe(27.91);
  });
});
