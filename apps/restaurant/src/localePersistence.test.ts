import { describe, expect, it } from 'vitest';
import { shouldApplyPersistedLocale } from './localePersistence';

describe('restaurant locale hydration', () => {
  it('applies persisted locale only while mounted and before a manual selection', () => {
    expect(shouldApplyPersistedLocale(true, false)).toBe(true);
    expect(shouldApplyPersistedLocale(true, true)).toBe(false);
    expect(shouldApplyPersistedLocale(false, false)).toBe(false);
  });
});
