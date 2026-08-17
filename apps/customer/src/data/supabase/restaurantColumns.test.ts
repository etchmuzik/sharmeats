/**
 * The storefront asks for the columns it renders — and nothing else.
 *
 * All four restaurant reads used `select('*')`. On a table that also holds
 * merchant banking identity (payout_iban / payout_wallet / payout_holder /
 * payout_bank_name / payout_method), the negotiated commission_pct, place_id
 * and the terms-acceptance record, `*` meant the public storefront requested
 * every one of them, and PostgREST returned them to anyone holding the
 * publishable anon key.
 *
 * RLS was never going to stop that. `restaurants_read` (mig 153) deliberately
 * exposes every active, visible merchant — that IS the storefront — so "which
 * rows" is correctly "all of them". "Which columns" is a grant question, and
 * migration 218 answers it. This test guards the client half: `*` expands to
 * every column in the table, so it would start failing outright the moment a
 * single column is ungranted.
 *
 * Verified against production before the fix: an anon-key GET for
 * name,payout_iban,payout_wallet,payout_holder,commission_pct returned a row per
 * active merchant. Every payout value was still NULL — this was closed before it
 * disclosed anything, not after.
 */
import { describe, it, expect } from 'vitest';
import { RESTAURANT_COLUMNS } from './restaurants';
import { rowToRestaurant } from './mappers';

const selected = RESTAURANT_COLUMNS.split(',').map((c) => c.trim());

/** Columns no client role may read after migration 218. */
const SENSITIVE = [
  'payout_method',
  'payout_bank_name',
  'payout_iban',
  'payout_wallet',
  'payout_holder',
  'commission_pct',
  'place_id',
  'terms_version',
  'terms_accepted_at',
  'founding_rate_until',
];

describe('restaurant storefront column scope', () => {
  it('never asks for payout, commission or contractual columns', () => {
    for (const column of SENSITIVE) {
      expect(selected).not.toContain(column);
    }
  });

  it('is a closed list, not a wildcard', () => {
    // `*` silently widens as columns are added, so a future sensitive column
    // would be exposed without anyone editing this file. That is exactly how
    // payout_* became readable in the first place.
    expect(RESTAURANT_COLUMNS).not.toContain('*');
    expect(selected.length).toBeGreaterThan(20);
  });

  it('carries every field the mapper renders, so nothing shows as undefined', () => {
    // The opposite failure, and the real risk of a hand-written list: too narrow
    // silently blanks a card in the UI instead of raising. Driving the mapper
    // with a row built ONLY from the selected columns proves the list is
    // sufficient — any field the mapper needs but the query omits lands as
    // undefined here.
    const row = Object.fromEntries(
      selected.map((c) => [c, sampleFor(c)]),
    ) as unknown as Parameters<typeof rowToRestaurant>[0];

    const mapped = rowToRestaurant(row);

    // Every non-optional field on the mapped shape must have a real value.
    for (const key of [
      'id',
      'slug',
      'name',
      'cuisineLabel',
      'coverImage',
      'zone',
      'rating',
      'ratingCount',
      'prepTimeLow',
      'prepTimeHigh',
      'deliveryFeeEgp',
      'minOrderEgp',
      'distanceMeters',
      'touristSafe',
      'isOpen',
      'description',
      'verticalId',
    ] as const) {
      expect(mapped[key], `${key} is undefined — RESTAURANT_COLUMNS is missing a column`)
        .toBeDefined();
    }
  });
});

/** A plausible non-empty value per column, so `undefined` can only come from omission. */
function sampleFor(column: string): unknown {
  if (column === 'cuisines') return ['egyptian'];
  if (column === 'merchant_type') return 'own_brand';
  if (column === 'vertical_id') return 'food';
  if (column.startsWith('is_') || column === 'featured' || column === 'tourist_safe') return true;
  if (
    column.endsWith('_egp') ||
    column.endsWith('_count') ||
    column.endsWith('_low') ||
    column.endsWith('_high') ||
    column === 'rating' ||
    column === 'distance_meters'
  ) {
    return 1;
  }
  return `sample-${column}`;
}
