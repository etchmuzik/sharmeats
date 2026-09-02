import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSupportWhatsAppPhone } from './supportWhatsApp';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getSupportWhatsAppPhone', () => {
  it('returns null by default so the app does not ship a fake support number', () => {
    vi.stubEnv('EXPO_PUBLIC_SUPPORT_WHATSAPP_PHONE', '');

    expect(getSupportWhatsAppPhone()).toBeNull();
  });

  it('accepts an international E.164 number and normalizes an optional leading plus', () => {
    vi.stubEnv('EXPO_PUBLIC_SUPPORT_WHATSAPP_PHONE', '+201234567890');

    expect(getSupportWhatsAppPhone()).toBe('201234567890');
  });

  it.each([
    '20123',
    '012345678901',
    '2012345678901234',
    '201234567890&text=redirected',
    '201 234 567 890',
  ])('fails closed for an unsafe WhatsApp phone value: %s', (value) => {
    vi.stubEnv('EXPO_PUBLIC_SUPPORT_WHATSAPP_PHONE', value);

    expect(getSupportWhatsAppPhone()).toBeNull();
  });
});
