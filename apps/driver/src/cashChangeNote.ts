export interface CashChangeInstruction {
  tenderEgp: number;
  changeEgp: number;
}

export interface ParsedCashChangeNote {
  customerNote: string;
  cashChange: CashChangeInstruction | null;
}

/** Pure rendering contract used by the driver card, including note-only jobs. */
export function shouldRenderDropoffCard(
  hasKnownPreference: boolean,
  parsed: ParsedCashChangeNote,
): boolean {
  return Boolean(
    hasKnownPreference || parsed.customerNote || parsed.cashChange,
  );
}

// Contract owned by the customer writer and driver reader. Anchoring the v1
// marker at the end means ordinary customer prose remains untouched.
const CASH_CHANGE_V1 =
  /\n?\[\[sharmeats:cash-change:v1:tender=(\d+);change=(\d+)\]\]$/;

/**
 * Extract the generated cash-change marker without rewriting customer prose.
 * Unsupported or malformed markers stay visible, which fails safely if a
 * future client version writes a contract this driver does not understand.
 */
export function parseCashChangeNote(
  note: string | null | undefined,
): ParsedCashChangeNote {
  const raw = note ?? '';
  const match = CASH_CHANGE_V1.exec(raw);
  if (!match || match.index === undefined) {
    return { customerNote: raw, cashChange: null };
  }

  const tenderEgp = Number(match[1]);
  const changeEgp = Number(match[2]);
  if (
    !Number.isSafeInteger(tenderEgp) ||
    !Number.isSafeInteger(changeEgp) ||
    tenderEgp <= 0 ||
    changeEgp <= 0 ||
    changeEgp >= tenderEgp
  ) {
    return { customerNote: raw, cashChange: null };
  }

  return {
    customerNote: raw.slice(0, match.index),
    cashChange: { tenderEgp, changeEgp },
  };
}
