import { describe, expect, it } from 'vitest';
import {
  MAX_MENU_IMPORT_ROWS,
  MENU_CSV_TEMPLATE,
  parseMenuCsv,
} from './menuCsv';

describe('parseMenuCsv', () => {
  it('parses a BOM, CRLF, quoted commas, escaped quotes and friendly booleans', () => {
    const csv =
      '\uFEFFsection_name,item_name,description,price_egp,image_url,flags,is_available\r\n' +
      'Mains,"Chicken, grilled","Chef said ""fresh""",245,https://cdn.example.com/chicken.jpg,spicy|glutenfree,yes\r\n' +
      'Drinks,Lemonade,"Fresh lemon,\nand mint",80,,,0\r\n';

    const result = parseMenuCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      {
        section_name: 'Mains',
        item_name: 'Chicken, grilled',
        description: 'Chef said "fresh"',
        price_egp: 245,
        image: 'https://cdn.example.com/chicken.jpg',
        flags: ['spicy', 'glutenfree'],
        is_available: true,
      },
      {
        section_name: 'Drinks',
        item_name: 'Lemonade',
        description: 'Fresh lemon,\nand mint',
        price_egp: 80,
        image: '',
        flags: [],
        is_available: false,
      },
    ]);
    expect(result.sectionCount).toBe(2);
  });

  it('ships a header-only template that is safe to download and fill', () => {
    expect(MENU_CSV_TEMPLATE).toBe(
      'section_name,item_name,description,price_egp,image_url,flags,is_available\r\n',
    );
    expect(parseMenuCsv(MENU_CSV_TEMPLATE).errors).toEqual([
      { row: 1, column: 'file', message: 'Add at least one menu item.' },
    ]);
  });

  it('reports missing and unexpected headers before attempting row parsing', () => {
    const result = parseMenuCsv('section,item,price\nMains,Koshari,90');

    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([
      {
        row: 1,
        column: 'headers',
        message:
          'Use these exact columns: section_name, item_name, description, price_egp, image_url, flags, is_available.',
      },
    ]);
  });

  it('returns clear row errors and never returns invalid rows as importable', () => {
    const csv = [
      'section_name,item_name,description,price_egp,image_url,flags,is_available',
      ',Falafel,,0,http://example.com/f.jpg,vegetarian|unknown,maybe',
      'Mains,Very expensive,,10001,ftp://example.com/f.jpg,,true',
    ].join('\n');

    const result = parseMenuCsv(csv);

    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        { row: 2, column: 'section_name', message: 'Section name is required.' },
        {
          row: 2,
          column: 'price_egp',
          message: 'Price must be a whole number from 1 to 10,000 EGP.',
        },
        { row: 2, column: 'flags', message: 'Unknown flag: unknown.' },
        {
          row: 2,
          column: 'is_available',
          message: 'Use true/false, yes/no, or 1/0.',
        },
        {
          row: 3,
          column: 'price_egp',
          message: 'Price must be a whole number from 1 to 10,000 EGP.',
        },
        {
          row: 3,
          column: 'image_url',
          message: 'Image URL must start with http:// or https://.',
        },
      ]),
    );
  });

  it('rejects duplicate rows and items that already exist in the same section', () => {
    const csv = [
      'section_name,item_name,description,price_egp,image_url,flags,is_available',
      'Mains,Falafel,,90,,,true',
      ' mains , FALAFEL ,,95,,,true',
      'Drinks,Lemonade,,80,,,true',
    ].join('\n');

    const result = parseMenuCsv(csv, [
      { sectionName: 'DRINKS', itemName: 'lemonade' },
    ]);

    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([
      {
        row: 3,
        column: 'item_name',
        message: 'Duplicate item in this CSV: Mains / Falafel.',
      },
      {
        row: 4,
        column: 'item_name',
        message: 'This item already exists: Drinks / Lemonade.',
      },
    ]);
  });

  it('rejects malformed quoted CSV instead of guessing at the data', () => {
    const result = parseMenuCsv(
      'section_name,item_name,description,price_egp,image_url,flags,is_available\n' +
        'Mains,"Broken item,,90,,,true',
    );

    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([
      {
        row: 2,
        column: 'file',
        message: 'The CSV has an unterminated quoted field.',
      },
    ]);
  });

  it('rejects more flag entries than the supported enum count', () => {
    const result = parseMenuCsv(
      [
        'section_name,item_name,description,price_egp,image_url,flags,is_available',
        'Mains,Falafel,,90,,vegetarian|vegan|contains_pork|contains_alcohol|contains_nuts|spicy|glutenfree|spicy,true',
      ].join('\n'),
    );

    expect(result.rows).toEqual([]);
    expect(result.errors).toContainEqual({
      row: 2,
      column: 'flags',
      message: 'Use at most 7 flags.',
    });
  });

  it('enforces the server row limit before upload', () => {
    const rows = Array.from(
      { length: MAX_MENU_IMPORT_ROWS + 1 },
      (_, index) => `Mains,Item ${index},,90,,,true`,
    );
    const result = parseMenuCsv(
      [
        'section_name,item_name,description,price_egp,image_url,flags,is_available',
        ...rows,
      ].join('\n'),
    );

    expect(result.rows).toEqual([]);
    expect(result.errors).toContainEqual({
      row: 1,
      column: 'file',
      message: `A single import can contain at most ${MAX_MENU_IMPORT_ROWS} items.`,
    });
  });
});
