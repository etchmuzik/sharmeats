export type CashTender =
  | { kind: 'none' }
  | { kind: 'invalid' }
  | { kind: 'valid'; tenderEgp: number; changeEgp: number };

function normalizeDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[\s,٬،]/g, '');
}

/**
 * Interpret the optional note value as the cash amount the customer will hand
 * to the driver. EGP order totals are integer-valued throughout the platform.
 */
export function cashTenderForTotal(input: string, totalEgp: number): CashTender {
  if (!input.trim()) return { kind: 'none' };

  const normalized = normalizeDigits(input);
  if (!/^\d+$/.test(normalized)) return { kind: 'invalid' };

  const tenderEgp = Number(normalized);
  const payableEgp = Math.ceil(totalEgp);
  if (
    !Number.isSafeInteger(tenderEgp) ||
    tenderEgp <= 0 ||
    !Number.isFinite(payableEgp) ||
    tenderEgp < payableEgp
  ) {
    return { kind: 'invalid' };
  }

  return {
    kind: 'valid',
    tenderEgp,
    changeEgp: tenderEgp - payableEgp,
  };
}

/**
 * Add one concise English operational sentence for the currently English-only
 * driver app. The customer-authored note remains first and unchanged.
 */
export function composeDriverDropoffNote(
  customerNote: string,
  tender: CashTender,
): string {
  const note = customerNote.trim();
  if (tender.kind !== 'valid' || tender.changeEgp === 0) return note;

  const cashInstruction =
    `Cash: customer will pay ${tender.tenderEgp} EGP; ` +
    `bring ${tender.changeEgp} EGP change.`;
  return note ? `${note} · ${cashInstruction}` : cashInstruction;
}
