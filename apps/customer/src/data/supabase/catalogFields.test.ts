/**
 * Catalog identity survives the row → MenuItem mapping.
 *
 * `menu_items` has carried sku/barcode/unit/requires_prescription since the
 * category-agnostic schema landed, and the menu query has always selected '*',
 * so these values arrived from the database all along — `rowToMenuItem` simply
 * dropped them on the floor.
 *
 * That was invisible while every merchant was a restaurant. It stopped being
 * invisible when pharmacy went live with a prescription-only antibiotic in its
 * catalog: the app rendered it identically to sunscreen, so the requirement
 * only surfaced when the driver refused to hand it over.
 *
 * These tests fail against the old mapper.
 */
import { describe, it, expect } from 'vitest';
import { rowToMenuItem } from './mappers';

const baseRow = {
  id: 'i-1',
  restaurant_id: 'r-1',
  section_id: 's-1',
  name: 'Amoxicillin 500mg (21 caps)',
  description: 'Antibiotic — prescription required',
  price_egp: 88,
  image: '',
  flags: [],
  is_available: true,
};

describe('rowToMenuItem — catalog identity', () => {
  it('carries the prescription flag through to the UI model', () => {
    const item = rowToMenuItem({ ...baseRow, requires_prescription: true });
    expect(item.requiresPrescription).toBe(true);
  });

  it('carries sku, barcode and unit', () => {
    const item = rowToMenuItem({
      ...baseRow,
      sku: 'PHA-AMOX-500',
      barcode: '6221055010103',
      unit: '21 caps',
    });
    expect(item.sku).toBe('PHA-AMOX-500');
    expect(item.barcode).toBe('6221055010103');
    expect(item.unit).toBe('21 caps');
  });

  it('maps SQL null to undefined, never to the string "null"', () => {
    // A null leaking through would render as literal "null" in any template
    // that interpolates it — e.g. "48 EGP / null" on a grocery row.
    const item = rowToMenuItem({
      ...baseRow,
      sku: null,
      barcode: null,
      unit: null,
      requires_prescription: null,
    });
    expect(item.unit).toBeUndefined();
    expect(item.sku).toBeUndefined();
    expect(item.barcode).toBeUndefined();
    expect(item.requiresPrescription).toBeUndefined();
  });

  it('a food row without the columns still maps cleanly', () => {
    // Cached payloads written before these columns were selected must not
    // throw, and must not claim a prescription is required.
    const item = rowToMenuItem(baseRow);
    expect(item.requiresPrescription).toBeUndefined();
    expect(item.name).toBe('Amoxicillin 500mg (21 caps)');
  });

  it('does NOT treat a false prescription flag as truthy', () => {
    // The badge renders on `item.requiresPrescription &&` — a non-Rx pharmacy
    // item (sunscreen) must not display a prescription warning.
    const item = rowToMenuItem({ ...baseRow, requires_prescription: false });
    expect(item.requiresPrescription).toBeFalsy();
  });
});
