import { describe, expect, it } from 'vitest';
import { radioAccessibilityState } from './accessibility';

describe('radioAccessibilityState', () => {
  it('exposes an active radio as checked', () => {
    expect(radioAccessibilityState(true)).toEqual({ checked: true });
  });

  it('exposes an inactive radio as unchecked', () => {
    expect(radioAccessibilityState(false)).toEqual({ checked: false });
  });
});
