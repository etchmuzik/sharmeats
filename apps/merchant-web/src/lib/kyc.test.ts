import { describe, expect, it } from 'vitest';
import { resolveKycImage } from './kyc';

const FRIENDLY_ERROR = /JPG, PNG or WebP/i;
const file = (name: string, type: string, size = 1024) => ({ name, type, size });

describe('resolveKycImage', () => {
  it('resolves .jpeg (lowercase name) by MIME to jpg/image-jpeg', () => {
    expect(resolveKycImage(file('doc.jpeg', 'image/jpeg')))
      .toEqual({ ext: 'jpg', contentType: 'image/jpeg' });
  });

  it('resolves .JPG (uppercase name) by MIME to jpg/image-jpeg', () => {
    expect(resolveKycImage(file('DOC.JPG', 'image/jpeg')))
      .toEqual({ ext: 'jpg', contentType: 'image/jpeg' });
  });

  it('resolves .png to png/image-png', () => {
    expect(resolveKycImage(file('doc.png', 'image/png')))
      .toEqual({ ext: 'png', contentType: 'image/png' });
  });

  it('resolves .webp to webp/image-webp', () => {
    expect(resolveKycImage(file('doc.webp', 'image/webp')))
      .toEqual({ ext: 'webp', contentType: 'image/webp' });
  });

  it('falls back to filename extension when MIME is generic (application/octet-stream)', () => {
    expect(resolveKycImage(file('doc.png', 'application/octet-stream')))
      .toEqual({ ext: 'png', contentType: 'image/png' });
  });

  it('rejects a .pdf with the friendly error', () => {
    expect(() => resolveKycImage(file('doc.pdf', 'application/pdf'))).toThrow(FRIENDLY_ERROR);
  });

  it('rejects a .heic with the friendly error', () => {
    expect(() => resolveKycImage(file('doc.heic', 'image/heic'))).toThrow(FRIENDLY_ERROR);
  });

  it('rejects an extensionless file with empty MIME type', () => {
    expect(() => resolveKycImage(file('doc', ''))).toThrow(FRIENDLY_ERROR);
  });

  it('rejects a file over 5 MiB', () => {
    const oversized = file('doc.jpg', 'image/jpeg', 5 * 1024 * 1024 + 1);
    expect(() => resolveKycImage(oversized)).toThrow(FRIENDLY_ERROR);
  });

  it('accepts a file exactly at the 5 MiB boundary', () => {
    const atLimit = file('doc.jpg', 'image/jpeg', 5 * 1024 * 1024);
    expect(resolveKycImage(atLimit)).toEqual({ ext: 'jpg', contentType: 'image/jpeg' });
  });
});

describe('KYC storage path shape', () => {
  const PATH_RE = /^[^/]+\/restaurant-(commercial_reg|tax_card|food_license)-[0-9]+\.(jpg|png|webp)$/;

  it('matches the storage/DB-enforced path regex for a sample docType', () => {
    const uid = 'a1b2c3d4-0000-4000-8000-000000000000';
    const { ext } = resolveKycImage(file('doc.png', 'image/png'));
    const path = `${uid}/restaurant-tax_card-${1690000000000}.${ext}`;
    expect(path).toMatch(PATH_RE);
  });

  it('matches for each restaurant doc type and each resolved extension', () => {
    const uid = 'fixture-uid';
    const docTypes = ['commercial_reg', 'tax_card', 'food_license'] as const;
    const samples = [
      file('a.jpg', 'image/jpeg'),
      file('b.png', 'image/png'),
      file('c.webp', 'image/webp'),
    ];
    for (const docType of docTypes) {
      for (const f of samples) {
        const { ext } = resolveKycImage(f);
        const path = `${uid}/restaurant-${docType}-${Date.now()}.${ext}`;
        expect(path).toMatch(PATH_RE);
      }
    }
  });
});
