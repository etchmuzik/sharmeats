import { describe, it, expect } from 'vitest';
import { resolveScheme, lightColors, darkColors } from './theme';

describe('resolveScheme — explicit choice wins over the OS', () => {
  it('honours light even on a dark device', () => {
    expect(resolveScheme('light', 'dark')).toBe('light');
  });
  it('honours dark even on a light device', () => {
    expect(resolveScheme('dark', 'light')).toBe('dark');
  });
});

describe('resolveScheme — system follows the OS', () => {
  it('is dark when the OS reports dark', () => {
    expect(resolveScheme('system', 'dark')).toBe('dark');
  });
  it('is light when the OS reports light', () => {
    expect(resolveScheme('system', 'light')).toBe('light');
  });

  // The OS value is not always a clean 'light'/'dark'. RN returns null before
  // the value is known and can report 'unspecified'; resolving either to dark
  // would flash a dark frame on a light device during the first render.
  it('falls back to light when the OS value is unknown', () => {
    expect(resolveScheme('system', null)).toBe('light');
    expect(resolveScheme('system', undefined)).toBe('light');
    expect(resolveScheme('system', 'unspecified')).toBe('light');
  });
});

describe('palettes satisfy the same token contract', () => {
  it('defines every light token in dark too', () => {
    expect(Object.keys(darkColors).sort()).toEqual(Object.keys(lightColors).sort());
  });

  // These are the tokens the dark-mode migration split apart, and the whole
  // migration rests on them diverging. If a later edit collapses one back into
  // the other, half the UI silently loses contrast on one theme.
  it('keeps surface distinct from the canvas in BOTH themes', () => {
    expect(lightColors.surface).not.toBe(lightColors.bg);
    expect(darkColors.surface).not.toBe(darkColors.bg);
  });

  it('keeps onAccent near-white in both themes', () => {
    expect(lightColors.onAccent).toBe(darkColors.onAccent);
  });

  // onInk has to INVERT with ink: `ink` is the fill for selected chips and is
  // itself near-white on dark, so a label that tracked onAccent would vanish.
  it('inverts onInk between themes so it never matches its ink fill', () => {
    expect(lightColors.onInk).not.toBe(darkColors.onInk);
    expect(darkColors.onInk).not.toBe(darkColors.ink);
    expect(lightColors.onInk).not.toBe(lightColors.ink);
  });
});
