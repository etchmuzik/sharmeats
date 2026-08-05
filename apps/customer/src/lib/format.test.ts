import { describe, expect, it } from 'vitest';
import {
  formatEgp,
  formatKm,
  formatMinutes,
  formatNumber,
  formatPrepTime,
  formatTime,
} from './format';

describe('locale-aware formatting', () => {
  it('keeps the existing EGP display when no locale is supplied', () => {
    expect(formatEgp(1_234.5)).toBe('EGP 1,235');
  });

  it('keeps the existing EGP display when English is explicitly supplied', () => {
    expect(formatEgp(1_234.5, 'en')).toBe('EGP 1,235');
  });

  it('keeps the existing distance display when no locale is supplied', () => {
    expect(formatKm(1_200)).toBe('1.2 km');
  });

  it('keeps the existing metres display when no locale is supplied', () => {
    expect(formatKm(930)).toBe('930 m');
  });

  it('keeps the existing duration display when no locale is supplied', () => {
    expect(formatMinutes(75)).toBe('1h 15m');
  });

  it('keeps the existing prep-time display when no locale is supplied', () => {
    expect(formatPrepTime(15, 25)).toBe('15–25 min');
  });

  it('keeps the existing clock display when no locale is supplied', () => {
    expect(formatTime(new Date(2024, 0, 1, 13, 5))).toBe('1:05 PM');
  });

  it('keeps the legacy English number display when no locale is supplied', () => {
    expect(formatNumber(1_234.5)).toBe('1,234.5');
  });

  it('formats EGP with Egyptian Arabic digits and currency notation', () => {
    expect(formatEgp(1_234.5, 'ar')).toBe('\u200F١٬٢٣٥\u00A0ج.م.\u200F');
  });

  it('formats generic numbers with Egyptian Arabic digits and separators', () => {
    expect(formatNumber(1_234.5, 'ar')).toBe('١٬٢٣٤٫٥');
  });

  it('formats distance with Egyptian Arabic digits and units', () => {
    expect(formatKm(930, 'ar')).toBe('٩٣٠ مترًا');
  });

  it('formats kilometres with Egyptian Arabic digits and units', () => {
    expect(formatKm(1_200, 'ar')).toBe('١٫٢ كم');
  });

  it('formats sub-hour durations with Egyptian Arabic digits and units', () => {
    expect(formatMinutes(45, 'ar')).toBe('٤٥ د');
  });

  it('formats multi-unit durations with Egyptian Arabic digits and units', () => {
    expect(formatMinutes(75, 'ar')).toBe('١ س ١٥ د');
  });

  it('formats whole-hour durations with Egyptian Arabic digits and units', () => {
    expect(formatMinutes(60, 'ar')).toBe('١ س');
  });

  it('formats prep-time ranges with Egyptian Arabic digits and minute notation', () => {
    expect(formatPrepTime(15, 25, 'ar')).toBe('١٥–٢٥ د');
  });

  it('formats clock time in Egyptian Arabic', () => {
    expect(formatTime(new Date(2024, 0, 1, 13, 5), 'ar')).toBe('١:٠٥ م');
  });
});
