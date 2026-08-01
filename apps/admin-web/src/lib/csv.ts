// Small, pure CSV helpers for client-side exports.
// Kept dependency-free so it stays trivially unit-testable.

/**
 * Escape a single CSV field per RFC 4180 AND neutralize spreadsheet formula
 * injection (OWASP). A cell beginning with = + - @ (or a leading TAB / CR) is
 * treated as a formula by Excel/Sheets/LibreOffice, so an attacker-controlled
 * value like `=HYPERLINK(...)` or `=cmd|...` in a restaurant/driver name or a
 * free-text payment reference would execute on open. We prefix such a cell with
 * a single quote (the standard neutralizer) before RFC-4180 quoting, so it is
 * rendered as literal text.
 */
export function escapeCsvField(value: string): string {
  // Formula-injection guard first: a leading =, +, -, @, TAB (\t) or CR (\r)
  // is what triggers formula evaluation. Prefix an apostrophe so the cell is
  // inert text; the apostrophe itself is not shown by spreadsheet apps.
  const neutralized = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(neutralized)) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }
  return neutralized;
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
