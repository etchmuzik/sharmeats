import { describe, expect, it } from 'vitest';
import { glassEffectStyleForRole, shouldUseNativeGlass } from './glassMaterial';

describe('shouldUseNativeGlass', () => {
  const supportedIOS = {
    platform: 'ios',
    liquidGlassAvailable: true,
    glassEffectAPIAvailable: true,
    reduceTransparency: false,
  } as const;

  it('uses native glass only when the iOS APIs are fully available', () => {
    expect(shouldUseNativeGlass(supportedIOS)).toBe(true);
  });

  it('uses the solid fallback outside iOS', () => {
    expect(shouldUseNativeGlass({ ...supportedIOS, platform: 'android' })).toBe(false);
  });

  it('uses the solid fallback when the device disables transparency', () => {
    expect(shouldUseNativeGlass({ ...supportedIOS, reduceTransparency: true })).toBe(false);
  });

  it('uses the solid fallback when either native capability is unavailable', () => {
    expect(shouldUseNativeGlass({ ...supportedIOS, liquidGlassAvailable: false })).toBe(false);
    expect(shouldUseNativeGlass({ ...supportedIOS, glassEffectAPIAvailable: false })).toBe(false);
  });
});

describe('glassEffectStyleForRole', () => {
  it('keeps compact image and map controls clear while giving a floating action dock more legibility', () => {
    expect(glassEffectStyleForRole('overlayControl')).toBe('clear');
    expect(glassEffectStyleForRole('actionDock')).toBe('regular');
  });
});
