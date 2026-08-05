import { describe, expect, it } from 'vitest';
import { itemSubmissionFeedback } from './itemSubmissionFeedback';

describe('itemSubmissionFeedback', () => {
  it('shows a brief confirmation after adding a new item before returning to the menu', () => {
    expect(itemSubmissionFeedback(false)).toEqual({
      showsConfirmation: true,
      navigationDelayMs: 220,
    });
  });

  it('keeps editing a cart line immediate', () => {
    expect(itemSubmissionFeedback(true)).toEqual({
      showsConfirmation: false,
      navigationDelayMs: 0,
    });
  });
});
