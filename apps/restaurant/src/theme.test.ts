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

  it('keeps surface distinct from the canvas in BOTH themes', () => {
    expect(lightColors.surface).not.toBe(lightColors.bg);
    expect(darkColors.surface).not.toBe(darkColors.bg);
  });

  it('keeps onAccent near-white in both themes', () => {
    expect(lightColors.onAccent).toBe(darkColors.onAccent);
  });
});

/**
 * The accent split is the load-bearing decision in this palette, so it gets
 * tests rather than just a comment. `accent` is a FILL carrying 14–16px bold
 * white labels (4.5:1 required, not the 3:1 large-text allowance), which is why
 * it does NOT lighten for dark mode; `accentText` is the value for violet as
 * text. Collapsing the two would silently fail one role or the other.
 */
describe('accent stays a fill; accentText carries the text role', () => {
  it('keeps the accent FILL identical across themes', () => {
    expect(darkColors.accent).toBe(lightColors.accent);
  });

  it('lightens accentText for the dark canvas', () => {
    expect(darkColors.accentText).not.toBe(lightColors.accentText);
  });

  // In light the fill already passes as text, so the two legitimately match.
  // In dark they must not: that would put the fill-tuned teal back on the
  // canvas as small text, which is the exact failure the split exists to fix.
  it('separates accentText from the fill in dark, not in light', () => {
    expect(lightColors.accentText).toBe(lightColors.accent);
    expect(darkColors.accentText).not.toBe(darkColors.accent);
  });

  // accentDark is a TEXT color everywhere in this app (never a fill), mostly on
  // an accentSoft chip. Carrying its light value into dark would put a deep
  // violet on a near-black violet chip. This is the regression the palette pair
  // exists to prevent, so assert the inversion rather than trusting the comment.
  it('inverts accentDark instead of carrying the light value over', () => {
    expect(darkColors.accentDark).not.toBe(lightColors.accentDark);
  });
});

/**
 * `onInk` labels the two decisive ticket controls — Accept (green fill) and
 * Confirm reject (red fill). Both fills invert lightness between themes, so a
 * fixed white label scored 2.27:1 and 2.52:1 on the dark theme.
 */
describe('onInk inverts so labels survive on inverting fills', () => {
  it('flips between themes rather than tracking onAccent', () => {
    expect(darkColors.onInk).not.toBe(lightColors.onInk);
    expect(lightColors.onInk).toBe(lightColors.onAccent);
    expect(darkColors.onInk).not.toBe(darkColors.onAccent);
  });
});

/**
 * The semantic text trio inverts direction between themes: darkened in light to
 * carry contrast on pale soft backgrounds, lightened in dark for the same
 * reason against dark ones. A later edit that copies the light values into dark
 * would leave the kitchen/COD figures unreadable, so assert they diverge.
 */
describe('semantic text variants invert between themes', () => {
  it('differs from the light values in every channel of the trio', () => {
    expect(darkColors.greenText).not.toBe(lightColors.greenText);
    expect(darkColors.redText).not.toBe(lightColors.redText);
    expect(darkColors.amberText).not.toBe(lightColors.amberText);
  });

  it('keeps the text variant distinct from its own fill in both themes', () => {
    for (const p of [lightColors, darkColors]) {
      expect(p.greenText).not.toBe(p.green);
      expect(p.redText).not.toBe(p.red);
      expect(p.amberText).not.toBe(p.amber);
    }
  });
});
