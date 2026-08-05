import { describe, expect, it } from 'vitest';
import { dialerUrl, normalizeDialString } from './dial';

describe('normalizeDialString', () => {
  it.each([
    ['+20 100 123 4567', '+201001234567'],
    ['0100-123-4567', '01001234567'],
    ['(0100) 123 4567', '01001234567'],
  ])('keeps an ordinary dialable phone number: %s', (input, expected) => {
    expect(normalizeDialString(input)).toBe(expected);
  });

  it.each([
    'tel:+201001234567',
    '+20;12345678',
    '+20,12345678',
    '+20#12345678',
    '+20?12345678',
    '++201001234567',
    '1234567',
    '1234567890123456',
    '',
  ])('rejects a non-dialable or URI-bearing value: %s', (value) => {
    expect(normalizeDialString(value)).toBeNull();
  });
});

describe('dialerUrl', () => {
  it('only constructs a tel URL from a validated dial string', () => {
    expect(dialerUrl('+20 100 123 4567')).toBe('tel:+201001234567');
    expect(dialerUrl('tel:+201001234567')).toBeNull();
  });
});
