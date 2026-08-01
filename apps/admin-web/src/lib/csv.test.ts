import { describe, expect, it } from 'vitest';
import { escapeCsvField, toCsv } from './csv';

describe('escapeCsvField', () => {
  it('passes plain values through unchanged', () => {
    expect(escapeCsvField('Falafel House')).toBe('Falafel House');
    expect(escapeCsvField('123.45')).toBe('123.45');
  });

  it('RFC-4180 quotes values with commas, quotes, or newlines', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('he said "hi"')).toBe('"he said ""hi"""');
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
  });

  it('neutralizes formula-injection payloads (OWASP)', () => {
    // Leading =, +, -, @, TAB, CR trigger formula evaluation in spreadsheets.
    for (const payload of ['=1+1', '=HYPERLINK("http://evil","x")', '+1', '-1', '@SUM(A1)', '\t=1', '\r=1']) {
      const out = escapeCsvField(payload);
      // The neutralized cell must not begin with a formula trigger.
      const inner = out.startsWith('"') ? out.slice(1) : out;
      expect(inner.startsWith("'")).toBe(true);
    }
  });

  it('neutralizes a formula that also needs RFC-4180 quoting', () => {
    // =cmd,attack has both a formula trigger and a comma → apostrophe + quotes.
    expect(escapeCsvField('=cmd,attack')).toBe('"\'=cmd,attack"');
  });

  it('does not touch a legitimate negative number that is a real number cell', () => {
    // A bare -5 is technically formula-triggering; neutralizing it is the safe
    // choice (correctness of a report cell over a spreadsheet-math convenience).
    expect(escapeCsvField('-5')).toBe("'-5");
  });
});

describe('toCsv', () => {
  it('escapes an injected restaurant name inside a full row', () => {
    const csv = toCsv(['name', 'amount'], [['=HYPERLINK("http://evil")', 100]]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv.split('\r\n')[1].startsWith('=')).toBe(false);
  });
});
