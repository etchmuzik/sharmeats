import { describe, it, expect, vi } from 'vitest';
vi.mock('@expo/vector-icons', () => ({ Ionicons: { glyphMap: {} } }));
vi.mock('../theme', () => ({ colors: { ink: '#000' } }));

import { resolveGlyph } from './Icon';

describe('resolveGlyph — active weight swap', () => {
  it('returns outline variant when inactive', () => {
    expect(resolveGlyph('cart', false)).toBe('bag-handle-outline');
  });
  it('returns filled variant when active for a tab icon', () => {
    expect(resolveGlyph('cart', true)).toBe('bag-handle');
  });
  it('falls back to default glyph when no filled variant exists', () => {
    expect(resolveGlyph('close', true)).toBe('close');
  });
});
