// Small, pure CSV helpers for client-side exports.
// Kept dependency-free so it stays trivially unit-testable.

/**
 * Characters that make Excel / Google Sheets / LibreOffice treat a cell as a
 * FORMULA rather than text. The first column of every export on this dashboard
 * is a merchant- or driver-supplied name, and those files are opened by the
 * finance team and pasted into a bank portal — so a restaurant called
 * `=HYPERLINK("http://evil","click")` or `+cmd|'/c calc'!A1` executes in their
 * spreadsheet, not ours. Leading tab/CR count because Excel strips them before
 * deciding.
 */
const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

/**
 * A plain signed number — `-50`, `-1250.75`. These start with `-`, which is a
 * formula trigger, but escaping them would turn every negative payout into the
 * text `'-50` and silently break the finance team's SUM. Numbers stay numbers;
 * anything else that starts dangerously gets neutralised.
 */
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;

/**
 * Neutralise a value that a spreadsheet would evaluate as a formula, by
 * prefixing a single quote — the documented way to force text in Excel, Sheets
 * and LibreOffice. The quote is visible in the raw CSV and invisible in the
 * spreadsheet cell, which is the right trade for a finance export.
 */
export function neutralizeFormula(value: string): string {
  if (value === '' || !FORMULA_TRIGGERS.includes(value[0])) return value;
  if (PLAIN_NUMBER.test(value)) return value;
  return `'${value}`;
}

/**
 * Escape a single CSV field per RFC 4180: wrap in double quotes when the value
 * contains a comma, double quote, or newline, and double any embedded quotes.
 * Formula injection is neutralised FIRST, so the guard applies to the real
 * leading character rather than to a quote we just added.
 */
export function escapeCsvField(value: string): string {
  const safe = neutralizeFormula(value);
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

/**
 * Serialize a header row plus data rows into a CSV string. Cells are coerced
 * to strings (null/undefined become empty) and each field is escaped. Rows are
 * joined with CRLF so the output opens cleanly in Excel and bank portals.
 */
export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const cell = (v: unknown): string => escapeCsvField(v == null ? '' : String(v));
  const lines = [header.map(cell).join(','), ...rows.map((row) => row.map(cell).join(','))];
  return lines.join('\r\n');
}
