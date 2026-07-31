import { describe, expect, it } from 'vitest';
import { escapeCsvField, neutralizeFormula, toCsv } from './csv';

/**
 * The exports on this dashboard put a merchant- or driver-supplied name in the
 * first column of a file the finance team opens in Excel and pastes into a bank
 * portal. Everything below is about that path.
 */
describe('neutralizeFormula', () => {
  it('neutralises every spreadsheet formula trigger', () => {
    expect(neutralizeFormula('=HYPERLINK("http://evil","click")')).toBe(
      '\'=HYPERLINK("http://evil","click")',
    );
    expect(neutralizeFormula('+cmd|\'/c calc\'!A1')).toBe('\'+cmd|\'/c calc\'!A1');
    expect(neutralizeFormula('-2+3+cmd|\' /c calc\'!A0')).toBe('\'-2+3+cmd|\' /c calc\'!A0');
    expect(neutralizeFormula('@SUM(1+1)')).toBe("'@SUM(1+1)");
    expect(neutralizeFormula('\tcmd')).toBe("'\tcmd");
    expect(neutralizeFormula('\rcmd')).toBe("'\rcmd");
  });

  it('leaves ordinary text alone', () => {
    expect(neutralizeFormula('Fares Seafood')).toBe('Fares Seafood');
    expect(neutralizeFormula('')).toBe('');
    expect(neutralizeFormula('مطعم فارس')).toBe('مطعم فارس');
  });

  it('leaves plain negative numbers as numbers', () => {
    // driver_settlements.net_payable_egp is negative on a COD-heavy week.
    // Quoting it would turn the finance team's SUM into a column of text.
    expect(neutralizeFormula('-450')).toBe('-450');
    expect(neutralizeFormula('-1250.75')).toBe('-1250.75');
    expect(neutralizeFormula('+12')).toBe('+12');
  });
});

describe('escapeCsvField', () => {
  it('neutralises before quoting, so the guard sees the real first character', () => {
    // A name with both a formula trigger and a comma must come out quoted AND
    // prefixed — not quoted only, which would leave the formula live.
    expect(escapeCsvField('=1+1,evil')).toBe('"\'=1+1,evil"');
  });

  it('still escapes RFC 4180 specials', () => {
    expect(escapeCsvField('Fares "The Fish" Seafood')).toBe('"Fares ""The Fish"" Seafood"');
    expect(escapeCsvField('Naama, Sharm')).toBe('"Naama, Sharm"');
  });
});

describe('toCsv', () => {
  it('guards data rows and the header alike', () => {
    const csv = toCsv(['restaurant', 'net_payable_egp'], [['=cmd', -450]]);
    expect(csv).toBe('restaurant,net_payable_egp\r\n\'=cmd,-450');
  });

  it('renders null and undefined as empty cells', () => {
    expect(toCsv(['a', 'b'], [[null, undefined]])).toBe('a,b\r\n,');
  });
});
