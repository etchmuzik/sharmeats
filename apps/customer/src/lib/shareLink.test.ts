import { describe, it, expect } from 'vitest';
import { SHARE_PATH, shareUrlFor, tokenFromShareUrl } from './shareLink';

// Shaped like the real thing: 16 bytes of hex from mig 186's gen_random_bytes.
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
    // Not a token mig 186 would ever mint, but the helper must not produce an
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
