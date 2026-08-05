import { describe, expect, it } from 'vitest';
import { formatLocalizedNumber, interpolateTranslation } from './interpolation';

describe('formatLocalizedNumber', () => {
  it('preserves the existing English string representation', () => {
    expect(formatLocalizedNumber(1_234_567.8912345, 'en')).toBe('1234567.8912345');
  });

  it('leaves string interpolation values untouched', () => {
    expect(formatLocalizedNumber('07', 'ar')).toBe('07');
  });

  it('uses Arabic numerals for Arabic numeric interpolation', () => {
    expect(formatLocalizedNumber(42, 'ar')).toBe('٤٢');
  });

  it('supports locale-aware zero padding for clock-style values', () => {
    expect(formatLocalizedNumber(7, 'ar', { minimumIntegerDigits: 2 })).toBe('٠٧');
    expect(formatLocalizedNumber(7, 'en', { minimumIntegerDigits: 2 })).toBe('07');
  });

  it('uses the selected locale decimal separator', () => {
    expect(formatLocalizedNumber(1.5, 'de')).toBe('1,5');
  });

  it('applies the formatter when substituting translation variables', () => {
    expect(interpolateTranslation('إعادة الإرسال خلال ٠:{seconds}', 'ar', { seconds: 42 })).toBe(
      'إعادة الإرسال خلال ٠:٤٢',
    );
    expect(interpolateTranslation('Resend in 0:{seconds}', 'en', { seconds: 42 })).toBe(
      'Resend in 0:42',
    );
  });
});
