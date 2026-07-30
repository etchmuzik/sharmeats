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

// Egypt's largest circulating banknote. A customer pays with notes, so a
// plausible tender sits within a few of these above the bill.
const LARGEST_NOTE_EGP = 200;
const MAX_CHANGE_NOTES = 5;

/**
 * The most a driver could plausibly be asked to make change for.
 *
 * Scales with the order so a large bill can still be paid with large notes,
 * while a mistyped digit on a small order is caught at checkout rather than at
 * the doorstep, where the only outcomes are a failed handoff or a dispute.
 */
function maxPlausibleTender(payableEgp: number): number {
  return payableEgp + LARGEST_NOTE_EGP * MAX_CHANGE_NOTES;
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
    tenderEgp < payableEgp ||
    tenderEgp > maxPlausibleTender(payableEgp)
  ) {
    return { kind: 'invalid' };
  }

  return {
    kind: 'valid',
    tenderEgp,
    changeEgp: tenderEgp - payableEgp,
  };
}

// Customer prose and the generated marker share one transport
// (orders.dropoff_note), so prose that merely looks like a marker must never
// reach the driver's parser. Neutralize the opening delimiter and keep the
// rest of the customer's text intact and visible.
const MARKER_SHAPED = /\[\[sharmeats:cash-change:[^\]]*\]\]/g;

function stripMarkerShapedText(customerNote: string): string {
  return customerNote.replace(MARKER_SHAPED, '');
}

/**
 * Append a versioned machine-readable marker for the driver app.
 *
 * The driver owns presentation and localization. Keeping the transport marker
 * separate from customer prose also lets it remove only the generated line and
 * preserve the customer-authored note exactly.
 *
 * Only this function may emit a marker: any marker-shaped text the customer
 * typed is removed first, so the amount instruction a driver sees is always
 * one this app derived from the server-priced total.
 */
export function composeDriverDropoffNote(
  customerNote: string,
  tender: CashTender,
): string {
  const safeNote = stripMarkerShapedText(customerNote);

  if (tender.kind !== 'valid' || tender.changeEgp === 0) return safeNote;

  const marker =
    `[[sharmeats:cash-change:v1:tender=${tender.tenderEgp};` +
    `change=${tender.changeEgp}]]`;
  return safeNote ? `${safeNote}\n${marker}` : marker;
}
