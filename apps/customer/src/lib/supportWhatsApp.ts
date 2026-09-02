/**
 * Returns the configured support number in the format WhatsApp's deep links
 * require, or null when support chat is not explicitly configured.
 *
 * This is intentionally fail-closed: the public app configuration may be
 * missing or malformed, and it must never turn that into a link to an unknown
 * recipient. Use an E.164 number, with an optional leading `+`.
 */
export function getSupportWhatsAppPhone(): string | null {
  const raw = process.env.EXPO_PUBLIC_SUPPORT_WHATSAPP_PHONE?.trim();
  if (!raw) return null;

  const phone = raw.startsWith('+') ? raw.slice(1) : raw;
  return /^[1-9]\d{6,14}$/.test(phone) ? phone : null;
}
