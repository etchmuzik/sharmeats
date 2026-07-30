/**
 * The zones Sharm Eats actually delivers to.
 *
 * MIRRORS `public.zones` in supabase/migrations/002_app_schema.sql, which is the
 * source of truth: every id below has a row there AND a priced row in
 * `delivery_fee_rules` (migration 010). A zone missing from either cannot be
 * ordered to, so it must not appear on a page that promises coverage.
 *
 * This list had drifted from the database and nobody noticed, because the COUNT
 * stayed right while the NAMES went wrong — the page advertised Sunny Lakes, Ras
 * Um Sid and El Montazah, none of which exist as zones, and omitted Mubarak 7,
 * Hay El-Nour and El-Hadaba Residential, which are not only real but the three
 * cheapest to deliver to. `scripts/check-landing-zones.mjs` now fails if the two
 * ever disagree again.
 *
 * Names are the migration's `name_en` / `name_ar` verbatim, so an Arabic visitor
 * reads Arabic zone names rather than transliterated English.
 */
export interface Zone {
  /** `zones.id` — the enum value an address resolves to. */
  id: string;
  en: string;
  ar: string;
}

export const ZONES: readonly Zone[] = [
  { id: 'naama', en: 'Naama Bay', ar: 'خليج نعمة' },
  { id: 'hadaba', en: 'Hadaba', ar: 'الهضبة' },
  { id: 'nabq', en: 'Nabq', ar: 'نبق' },
  { id: 'old_market', en: 'Old Market', ar: 'السوق القديم' },
  { id: 'soho', en: 'Soho Square', ar: 'سوهو سكوير' },
  { id: 'sharks_bay', en: 'Sharks Bay', ar: 'خليج القروش' },
  { id: 'el_salam', en: 'El-Salam', ar: 'السلام' },
  { id: 'mubarak_7', en: 'Mubarak 7', ar: 'مبارك ٧' },
  { id: 'el_rowaisat', en: 'El-Rowaisat', ar: 'الرويسات' },
  { id: 'hay_el_nour', en: 'Hay El-Nour', ar: 'حي النور' },
  { id: 'el_hadaba_residential', en: 'El-Hadaba Residential', ar: 'الهضبة السكنية' },
] as const;
