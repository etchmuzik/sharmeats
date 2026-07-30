import { describe, it, expect } from 'vitest';
import {
  PROOF_REQUIRED_PREFERENCES,
  buildProofPath,
  isProofRequired,
  validateProofUpload,
} from './proofOfDelivery';

const UID = '50000000-0000-0000-0000-000000000001';
const ORDER = '52000000-0000-0000-0000-000000000001';

describe('isProofRequired mirrors delivery_proof_required in mig 189', () => {
  it('requires a photo when nobody is at the door', () => {
    expect(isProofRequired('leave_at_door')).toBe(true);
    expect(isProofRequired('no_bell')).toBe(true);
  });

  it('does not require one for an in-person handoff', () => {
    expect(isProofRequired('hand_to_me')).toBe(false);
    expect(isProofRequired('meet_outside')).toBe(false);
    expect(isProofRequired('call_on_arrival')).toBe(false);
  });

  // Fails closed: an order with no preference, or a preference added to the enum
  // later that this build has never heard of, must not block the driver.
  it('fails closed on null, undefined, empty and unknown values', () => {
    expect(isProofRequired(null)).toBe(false);
    expect(isProofRequired(undefined)).toBe(false);
    expect(isProofRequired('')).toBe(false);
    expect(isProofRequired('some_future_preference')).toBe(false);
  });

  // The SQL side is the source of truth for the ops report; if someone edits one
  // list and not the other, drivers get nagged for photos ops never asks about
  // (or worse, the reverse). Pin the set so that edit has to be deliberate.
  it('pins the required set to exactly two preferences', () => {
    expect([...PROOF_REQUIRED_PREFERENCES].sort()).toEqual(['leave_at_door', 'no_bell']);
  });
});

describe('validateProofUpload', () => {
  it('accepts the bucket allowlist and maps the extension', () => {
    expect(validateProofUpload('image/jpeg', 1024)).toEqual({
      contentType: 'image/jpeg',
      extension: 'jpg',
    });
    expect(validateProofUpload('image/png', 1024).extension).toBe('png');
    expect(validateProofUpload('image/webp', 1024).extension).toBe('webp');
  });

  it('normalises case and whitespace from the picker', () => {
    expect(validateProofUpload('  IMAGE/JPEG ', 1024).extension).toBe('jpg');
  });

  it('rejects anything the bucket would reject anyway', () => {
    expect(() => validateProofUpload('application/pdf', 1024)).toThrow(/JPEG, PNG, or WebP/);
    expect(() => validateProofUpload(null, 1024)).toThrow(/JPEG, PNG, or WebP/);
    expect(() => validateProofUpload('image/heic', 1024)).toThrow(/JPEG, PNG, or WebP/);
  });

  it('rejects empty and oversized photos', () => {
    expect(() => validateProofUpload('image/jpeg', 0)).toThrow(/empty/);
    expect(() => validateProofUpload('image/jpeg', Number.NaN)).toThrow(/empty/);
    expect(() => validateProofUpload('image/jpeg', 5 * 1024 * 1024 + 1)).toThrow(/5 MB/);
  });

  it('accepts a photo exactly at the 5 MB ceiling', () => {
    expect(validateProofUpload('image/jpeg', 5 * 1024 * 1024).extension).toBe('jpg');
  });
});

/**
 * The path shape is matched by a regex in the storage INSERT policy and
 * reconstructed by record_delivery_proof. These assertions are the app-side half
 * of that contract — if they change, mig 189 has to change with them.
 */
describe('buildProofPath matches what mig 189 will accept', () => {
  it('builds <uid>/<order>-<ts>.<ext>', () => {
    expect(buildProofPath(UID, ORDER, 1721800000000, 'jpg')).toBe(
      `${UID}/${ORDER}-1721800000000.jpg`,
    );
  });

  it('produces a path the storage policy regex accepts', () => {
    const policy = new RegExp(
      `^${UID}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9]+\\.(jpg|jpeg|png|webp)$`,
    );
    for (const ext of ['jpg', 'png', 'webp']) {
      expect(policy.test(buildProofPath(UID, ORDER, 1721800000000, ext))).toBe(true);
    }
  });

  it('rejects a timestamp that would break the regex', () => {
    expect(() => buildProofPath(UID, ORDER, 0, 'jpg')).toThrow(/timestamp/);
    expect(() => buildProofPath(UID, ORDER, -1, 'jpg')).toThrow(/timestamp/);
    expect(() => buildProofPath(UID, ORDER, 1.5, 'jpg')).toThrow(/timestamp/);
    expect(() => buildProofPath(UID, ORDER, Number.NaN, 'jpg')).toThrow(/timestamp/);
  });
});
