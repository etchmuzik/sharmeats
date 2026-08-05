import { describe, expect, it } from 'vitest';
import { dialablePhone } from './dialablePhone';

describe('dialablePhone', () => {
  it.each([
    ['+20 (100) 123-4567', '+201001234567'],
    ['201001234567', '201001234567'],
  ])('normalizes a formatted number: %s', (input, expected) => {
    expect(dialablePhone(input)).toBe(expected);
  });

  it.each([
    'tel:+201001234567',
    '*#06#',
    '+20;ext=911',
    '+20123',
    '+2010012345678901',
    'call me +201001234567',
    '',
  ])('rejects a non-dialable value: %s', (input) => {
    expect(dialablePhone(input)).toBeNull();
  });
});
