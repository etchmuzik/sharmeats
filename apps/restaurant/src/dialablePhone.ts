/**
 * Convert a stored phone number into the only form allowed in a `tel:` URL.
 *
 * Phone fields are remote data. Allow common formatting but reject URI
 * delimiters, `*`/`#` USSD codes, and arbitrary schemes before asking the OS
 * to open a dialer.
 */
export function dialablePhone(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!/^\+?[\d\s().-]+$/.test(raw)) return null;

  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  return raw.startsWith('+') ? `+${digits}` : digits;
}
