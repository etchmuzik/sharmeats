export type ItemSubmissionFeedback = {
  showsConfirmation: boolean;
  navigationDelayMs: number;
};

/**
 * A new cart item gets a short, visible acknowledgement before the modal
 * closes. Editing an existing line keeps the established immediate return.
 */
export function itemSubmissionFeedback(isEditing: boolean): ItemSubmissionFeedback {
  if (isEditing) {
    return { showsConfirmation: false, navigationDelayMs: 0 };
  }

  return { showsConfirmation: true, navigationDelayMs: 220 };
}
