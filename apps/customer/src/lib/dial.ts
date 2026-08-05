/**
 * Normalize a number before it reaches an OS URL scheme. Phone data is remote
 * input here (restaurant and rider snapshots), so do not let URI delimiters or
 * dialer control characters become part of a `tel:`, `sms:`, or WhatsApp URL.
 */
export function normalizeDialString(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  // Keep familiar display separators, then require a deliberately small
  // E.164-ish grammar: optional leading + and 8–15 digits. In particular this
  // rejects additional `+`, `;`, `,`, `?`, `#`, and URI schemes.
  const normalized = value.trim().replace(/[\s().-]/g, '');
  return /^\+?\d{8,15}$/.test(normalized) ? normalized : null;
}

/** Returns a safe dialer URL, or null when the stored phone is not dialable. */
export function dialerUrl(value: unknown): string | null {
  const number = normalizeDialString(value);
  return number ? `tel:${number}` : null;
}
