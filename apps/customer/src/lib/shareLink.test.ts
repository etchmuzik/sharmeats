import { describe, it, expect } from 'vitest';
import { SHARE_PATH, shareUrlFor, tokenFromShareUrl } from './shareLink';
// Suffixed because the Italian locale would otherwise shadow vitest's `it`.
import enDict from '../i18n/locales/en.json';
import arDict from '../i18n/locales/ar.json';
import deDict from '../i18n/locales/de.json';
import itDict from '../i18n/locales/it.json';
import ruDict from '../i18n/locales/ru.json';

// Shaped like the real thing: 16 bytes of hex from mig 195's gen_random_bytes.
const TOKEN = 'a3f1c09e5b7d2648ff0a1b2c3d4e5f60';

describe('shareUrlFor', () => {
  it('builds an absolute https link on the marketing site', () => {
    const url = shareUrlFor(TOKEN);
    expect(url.startsWith('https://')).toBe(true);
    expect(new URL(url).protocol).toBe('https:');
  });

  /**
   * A QUERY parameter, not a path segment. The landing site is a Next.js static
   * export, so a dynamic `[token]` route would need generateStaticParams for
   * tokens that do not exist at build time — the link would 404.
   */
  it('carries the token as a query parameter, not a path segment', () => {
    const url = new URL(shareUrlFor(TOKEN));
    expect(url.pathname.replace(/\/+$/, '')).toBe(SHARE_PATH);
    expect(url.searchParams.get('t')).toBe(TOKEN);
    expect(url.pathname).not.toContain(TOKEN);
  });

  it('percent-encodes rather than interpolating raw', () => {
    // Not a token mig 195 would ever mint, but the helper must not produce an
    // ambiguous URL if the token format ever changes.
    const url = shareUrlFor('a b&c=d');
    expect(url).not.toContain('a b&c=d');
    expect(new URL(url).searchParams.get('t')).toBe('a b&c=d');
  });

  it('round-trips through tokenFromShareUrl', () => {
    expect(tokenFromShareUrl(shareUrlFor(TOKEN))).toBe(TOKEN);
    expect(tokenFromShareUrl(shareUrlFor('a b&c=d'))).toBe('a b&c=d');
  });
});

describe('tokenFromShareUrl', () => {
  it('rejects anything that is not a share link', () => {
    expect(tokenFromShareUrl('https://sharmeats.online/')).toBeNull();
    expect(tokenFromShareUrl('https://sharmeats.online/privacy')).toBeNull();
    expect(tokenFromShareUrl('not a url')).toBeNull();
    expect(tokenFromShareUrl('')).toBeNull();
  });

  it('rejects a share link with no token', () => {
    expect(tokenFromShareUrl('https://sharmeats.online/track')).toBeNull();
    expect(tokenFromShareUrl('https://sharmeats.online/track?t=')).toBeNull();
  });

  it('tolerates a trailing slash, which the static export adds', () => {
    expect(tokenFromShareUrl(`https://sharmeats.online/track/?t=${TOKEN}`)).toBe(TOKEN);
  });
});

/**
 * The share MESSAGE, not just the URL.
 *
 * `order.shareMessage` shipped as `{{url}}` in all five locales while this
 * app's interpolator (src/i18n/index.ts) is single-brace `replace('{url}', …)`.
 * String.replace matched the INNER braces, so every shared message rendered as
 *
 *     Follow my Sharm Eats delivery: {https://sharmeats.online/track?t=…}
 *
 * and WhatsApp/iMessage linkify greedily — the trailing `}` was pulled into the
 * href, producing a token that does not resolve. The feature was broken end to
 * end while `order_share_created` kept firing, so analytics reported it healthy.
 *
 * It was the only `{{ }}` among 552 keys. These tests exist so it stays that way.
 */
describe('order.shareMessage renders a usable link', () => {
  const LOCALES = { en: enDict, ar: arDict, de: deDict, it: itDict, ru: ruDict } as Record<
    string,
    Record<string, string>
  >;

  // Mirrors lookup() in src/i18n/index.ts exactly — single brace, no regex.
  const interpolate = (tmpl: string, url: string) => tmpl.replace('{url}', url);

  for (const [name, dict] of Object.entries(LOCALES)) {
    it(`${name}: substitutes cleanly, leaving no stray braces`, () => {
      const url = shareUrlFor(TOKEN);
      const rendered = interpolate(dict['order.shareMessage']!, url);

      expect(rendered).toContain(url);
      // The actual bug: braces surviving into the sent message.
      expect(rendered).not.toContain('{');
      expect(rendered).not.toContain('}');
      // And the URL must be the last thing, so linkifiers can't over-capture.
      expect(rendered.endsWith(url)).toBe(true);
    });

    it(`${name}: uses the single-brace placeholder this app's i18n supports`, () => {
      expect(dict['order.shareMessage']).toContain('{url}');
      expect(dict['order.shareMessage']).not.toContain('{{');
    });
  }

  it('a token round-trips out of the rendered message', () => {
    const rendered = interpolate(enDict['order.shareMessage'], shareUrlFor(TOKEN));
    const url = rendered.slice(rendered.indexOf('https://'));
    expect(tokenFromShareUrl(url)).toBe(TOKEN);
  });
});
