/**
 * Convert a stored phone number into the only form allowed in a `tel:` URL.
 *
 * A phone field is still remote input (a customer/merchant record can be stale
 * or malformed). Allow common formatting but reject URI delimiters, `*`/`#`
 * USSD codes, and arbitrary schemes; otherwise a database value could change
 * what the operating system is asked to open.
 */
export function dialablePhone(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!/^\+?[\d\s().-]+$/.test(raw)) return null;

  const digits = raw.replace(/\D/g, '');
  // E.164's maximum is 15. Eight is the existing app-wide minimum for a
  // plausible contact number, so an accidental short value cannot reach tel:.
  if (digits.length < 8 || digits.length > 15) return null;
  return raw.startsWith('+') ? `+${digits}` : digits;
}
