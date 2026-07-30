import { ITEM_FLAGS, type ItemFlag } from './types';

export const MAX_MENU_IMPORT_ROWS = 500;

const MENU_CSV_HEADERS = [
  'section_name',
  'item_name',
  'description',
  'price_egp',
  'image_url',
  'flags',
  'is_available',
] as const;

export const MENU_CSV_TEMPLATE = `${MENU_CSV_HEADERS.join(',')}\r\n`;

export type MenuImportRow = {
  section_name: string;
  item_name: string;
  description: string;
  price_egp: number;
  image: string;
  flags: ItemFlag[];
  is_available: boolean;
};

export type ExistingMenuEntry = {
  sectionName: string;
  itemName: string;
};

export type MenuCsvError = {
  row: number;
  column: string;
  message: string;
};

export type MenuCsvResult = {
  rows: MenuImportRow[];
  errors: MenuCsvError[];
  sectionCount: number;
};

type RawCsvRow = {
  rowNumber: number;
  cells: string[];
};

type RawCsvResult =
  | { rows: RawCsvRow[]; error?: never }
  | { rows?: never; error: MenuCsvError };

function readCsv(source: string): RawCsvResult {
  const text = source.startsWith('\uFEFF') ? source.slice(1) : source;
  const rows: RawCsvRow[] = [];
  let cells: string[] = [];
  let field = '';
  let quoted = false;
  let afterQuote = false;
  let rowNumber = 1;
  let rowStart = 1;

  const finishField = () => {
    cells.push(field);
    field = '';
    afterQuote = false;
  };

  const finishRow = () => {
    finishField();
    rows.push({ rowNumber: rowStart, cells });
    cells = [];
    rowStart = rowNumber;
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        field += char;
        if (char === '\n') rowNumber += 1;
      }
      continue;
    }

    if (afterQuote && char !== ',' && char !== '\r' && char !== '\n' && !/\s/.test(char)) {
      return {
        error: {
          row: rowStart,
          column: 'file',
          message: 'Unexpected text after a quoted field.',
        },
      };
    }

    if (char === '"' && field.trim() === '') {
      field = '';
      quoted = true;
    } else if (char === ',') {
      finishField();
    } else if (char === '\n') {
      rowNumber += 1;
      finishRow();
      rowStart = rowNumber;
    } else if (char === '\r') {
      if (text[index + 1] === '\n') continue;
      rowNumber += 1;
      finishRow();
      rowStart = rowNumber;
    } else if (!afterQuote) {
      field += char;
    }
  }

  if (quoted) {
    return {
      error: {
        row: rowStart,
        column: 'file',
        message: 'The CSV has an unterminated quoted field.',
      },
    };
  }

  if (field.length > 0 || cells.length > 0) finishRow();
  return { rows };
}

function normalizedKey(sectionName: string, itemName: string) {
  return `${sectionName.trim().toLocaleLowerCase('en-US')}\u001f${itemName
    .trim()
    .toLocaleLowerCase('en-US')}`;
}

function parseAvailability(value: string): boolean | null {
  const normalized = value.trim().toLocaleLowerCase('en-US');
  if (normalized === '' || ['true', 'yes', '1'].includes(normalized)) return true;
  if (['false', 'no', '0'].includes(normalized)) return false;
  return null;
}

function parseFlags(value: string, row: number, errors: MenuCsvError[]): ItemFlag[] {
  const flags = value
    .split('|')
    .map((flag) => flag.trim().toLocaleLowerCase('en-US'))
    .filter(Boolean);
  if (flags.length > ITEM_FLAGS.length) {
    errors.push({
      row,
      column: 'flags',
      message: `Use at most ${ITEM_FLAGS.length} flags.`,
    });
  }
  const uniqueFlags = [...new Set(flags)];

  for (const flag of uniqueFlags) {
    if (!ITEM_FLAGS.includes(flag as ItemFlag)) {
      errors.push({ row, column: 'flags', message: `Unknown flag: ${flag}.` });
    }
  }

  return uniqueFlags.filter((flag): flag is ItemFlag => ITEM_FLAGS.includes(flag as ItemFlag));
}

export function parseMenuCsv(
  source: string,
  existingItems: ExistingMenuEntry[] = [],
): MenuCsvResult {
  const parsed = readCsv(source);
  if (parsed.error) return { rows: [], errors: [parsed.error], sectionCount: 0 };

  const nonBlankRows = parsed.rows.filter((row) => row.cells.some((cell) => cell.trim() !== ''));
  const header = nonBlankRows[0];
  const expectedHeaders = MENU_CSV_HEADERS.join(',');
  const actualHeaders = header?.cells.map((cell) => cell.trim()).join(',');
  if (!header || actualHeaders !== expectedHeaders) {
    return {
      rows: [],
      errors: [
        {
          row: 1,
          column: 'headers',
          message: `Use these exact columns: ${MENU_CSV_HEADERS.join(', ')}.`,
        },
      ],
      sectionCount: 0,
    };
  }

  const dataRows = nonBlankRows.slice(1);
  if (dataRows.length === 0) {
    return {
      rows: [],
      errors: [{ row: 1, column: 'file', message: 'Add at least one menu item.' }],
      sectionCount: 0,
    };
  }

  if (dataRows.length > MAX_MENU_IMPORT_ROWS) {
    return {
      rows: [],
      errors: [
        {
          row: 1,
          column: 'file',
          message: `A single import can contain at most ${MAX_MENU_IMPORT_ROWS} items.`,
        },
      ],
      sectionCount: 0,
    };
  }

  const errors: MenuCsvError[] = [];
  const rows: MenuImportRow[] = [];
  const seen = new Map<string, { sectionName: string; itemName: string }>();
  const existing = new Set(
    existingItems.map((item) => normalizedKey(item.sectionName, item.itemName)),
  );

  for (const raw of dataRows) {
    if (raw.cells.length !== MENU_CSV_HEADERS.length) {
      errors.push({
        row: raw.rowNumber,
        column: 'file',
        message: `Expected ${MENU_CSV_HEADERS.length} columns but found ${raw.cells.length}.`,
      });
      continue;
    }

    const [rawSection, rawItem, rawDescription, rawPrice, rawImage, rawFlags, rawAvailable] =
      raw.cells;
    const sectionName = rawSection.trim();
    const itemName = rawItem.trim();
    const description = rawDescription.trim();
    const image = rawImage.trim();
    const price = Number(rawPrice.trim());
    const available = parseAvailability(rawAvailable);
    const flags = parseFlags(rawFlags, raw.rowNumber, errors);

    if (!sectionName) {
      errors.push({
        row: raw.rowNumber,
        column: 'section_name',
        message: 'Section name is required.',
      });
    } else if (sectionName.length > 120) {
      errors.push({
        row: raw.rowNumber,
        column: 'section_name',
        message: 'Section name must be 120 characters or fewer.',
      });
    }

    if (!itemName) {
      errors.push({
        row: raw.rowNumber,
        column: 'item_name',
        message: 'Item name is required.',
      });
    } else if (itemName.length > 160) {
      errors.push({
        row: raw.rowNumber,
        column: 'item_name',
        message: 'Item name must be 160 characters or fewer.',
      });
    }

    if (description.length > 1_000) {
      errors.push({
        row: raw.rowNumber,
        column: 'description',
        message: 'Description must be 1,000 characters or fewer.',
      });
    }

    if (!Number.isInteger(price) || price < 1 || price > 10_000) {
      errors.push({
        row: raw.rowNumber,
        column: 'price_egp',
        message: 'Price must be a whole number from 1 to 10,000 EGP.',
      });
    }

    if (image && !/^https?:\/\/\S+$/i.test(image)) {
      errors.push({
        row: raw.rowNumber,
        column: 'image_url',
        message: 'Image URL must start with http:// or https://.',
      });
    } else if (image.length > 2_048) {
      errors.push({
        row: raw.rowNumber,
        column: 'image_url',
        message: 'Image URL must be 2,048 characters or fewer.',
      });
    }

    if (available === null) {
      errors.push({
        row: raw.rowNumber,
        column: 'is_available',
        message: 'Use true/false, yes/no, or 1/0.',
      });
    }

    if (sectionName && itemName) {
      const key = normalizedKey(sectionName, itemName);
      const first = seen.get(key);
      if (first) {
        errors.push({
          row: raw.rowNumber,
          column: 'item_name',
          message: `Duplicate item in this CSV: ${first.sectionName} / ${first.itemName}.`,
        });
      } else {
        seen.set(key, { sectionName, itemName });
        if (existing.has(key)) {
          errors.push({
            row: raw.rowNumber,
            column: 'item_name',
            message: `This item already exists: ${sectionName} / ${itemName}.`,
          });
        }
      }
    }

    rows.push({
      section_name: sectionName,
      item_name: itemName,
      description,
      price_egp: price,
      image,
      flags,
      is_available: available ?? false,
    });
  }

  if (errors.length > 0) return { rows: [], errors, sectionCount: 0 };

  return {
    rows,
    errors: [],
    sectionCount: new Set(rows.map((row) => row.section_name.toLocaleLowerCase('en-US'))).size,
  };
}
