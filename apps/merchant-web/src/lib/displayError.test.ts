import { describe, expect, it } from 'vitest';
import { hasErrorMarker, safeDisplayError } from './displayError';

describe('safeDisplayError', () => {
  it('never echoes unknown backend details or customer data', () => {
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
    expect(safeDisplayError({ message: 'ORDER_NOT_EDITABLE: raw input' }, {
      known: { ORDER_NOT_EDITABLE: 'This order can no longer be edited.' },
    })).toBe('This order can no longer be edited.');
  });

  it('detects known markers without exposing the original message', () => {
    const error = new Error('NOT_AUTHORIZED: customer +201234567890');

    expect(hasErrorMarker(error, 'NOT_AUTHORIZED')).toBe(true);
    expect(safeDisplayError(error)).not.toContain('+201234567890');
  });
});
