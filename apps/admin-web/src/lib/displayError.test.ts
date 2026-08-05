import { describe, expect, it } from 'vitest';
import { hasErrorMarker, safeDisplayError } from './displayError';

describe('safeDisplayError', () => {
  it('never echoes unknown backend details or user data', () => {
    const error = {
      code: 'P0001',
      message: 'database failure for customer +201234567890',
      details: 'address: 12 Coral Bay, room 34',
      hint: 'retry with token=super-secret',
    };

    const copy = safeDisplayError(error, { fallback: 'Could not save the change. Please try again.' });

    expect(copy).toBe('Could not save the change. Please try again.');
    expect(copy).not.toContain('+201234567890');
    expect(copy).not.toContain('Coral Bay');
    expect(copy).not.toContain('super-secret');
  });

  it('keeps static, actionable copy for recognised markers', () => {
    expect(safeDisplayError({ code: 'NOT_AUTHORIZED', message: 'raw backend detail' }))
      .toBe('You do not have permission to do that.');
    expect(safeDisplayError({ message: 'INVALID_DATE: raw input' }, {
      known: { INVALID_DATE: 'The end date must be after the start date.' },
    })).toBe('The end date must be after the start date.');
  });

  it('detects known markers without exposing the original message', () => {
    const error = new Error('KYC_INCOMPLETE: applicant +201234567890');

    expect(hasErrorMarker(error, 'KYC_INCOMPLETE')).toBe(true);
    expect(safeDisplayError(error)).not.toContain('+201234567890');
  });
});
