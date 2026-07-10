// Small, pure CSV helpers for client-side exports.
// Kept dependency-free so it stays trivially unit-testable.

/**
 * Escape a single CSV field per RFC 4180: wrap in double quotes when the value
 * contains a comma, double quote, or newline, and double any embedded quotes.
 */
export function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
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
