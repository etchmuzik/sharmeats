import { describe, expect, it } from 'vitest';
import ar from './locales/ar.json';
import de from './locales/de.json';
import en from './locales/en.json';
import itLocale from './locales/it.json';
import ru from './locales/ru.json';

const UI_KEYS = [
  'checkout.placing',
  'modifier.required',
  'modifier.optional',
  'modifier.upTo',
  'modifier.no',
  'modifier.popular',
  'modifier.free',
  'modifier.add',
  'modifier.remove',
  'otp.codeInput',
  'otp.codeHint',
  'quantity.decrease',
  'quantity.increase',
  'quantity.value',
  'allergy.conflictHint',
] as const;

describe('customer UI translations', () => {
  it.each([
    ['English', en],
    ['Arabic', ar],
    ['Russian', ru],
    ['Italian', itLocale],
    ['German', de],
  ])('%s includes labels used by accessible selection controls', (_locale, dictionary) => {
    for (const key of UI_KEYS) {
      expect(dictionary[key]).toEqual(expect.any(String));
      expect(dictionary[key].trim()).not.toHaveLength(0);
    }
  });
});
