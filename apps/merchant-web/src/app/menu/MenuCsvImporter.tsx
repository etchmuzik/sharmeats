'use client';

import { useEffect, useRef, useState } from 'react';
import {
  MENU_CSV_TEMPLATE,
  parseMenuCsv,
  type ExistingMenuEntry,
  type MenuCsvResult,
} from '@/lib/menuCsv';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { permissionDeniedCopy } from '@/lib/capabilities';
import { useToast } from '../Toast';

const TEMPLATE_URL = `data:text/csv;charset=utf-8,${encodeURIComponent(MENU_CSV_TEMPLATE)}`;

export function MenuCsvImporter({
  restaurantId,
  existingItems,
  onImported,
}: {
  restaurantId: string;
  existingItems: ExistingMenuEntry[];
  onImported: () => boolean | void | Promise<boolean | void>;
}) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [fileContents, setFileContents] = useState('');
  const [result, setResult] = useState<MenuCsvResult | null>(null);
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [serverError, setServerError] = useState('');

  const clear = () => {
    setFileName('');
    setFileContents('');
    setResult(null);
    setServerError('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const chooseFile = async (file: File | undefined) => {
    clear();
    if (!file) return;
    setFileName(file.name);
    setReading(true);

    try {
      if (file.size > 2 * 1024 * 1024) {
        setResult({
          rows: [],
          sectionCount: 0,
          errors: [
            {
              row: 1,
              column: 'file',
              message: 'CSV files must be 2 MB or smaller.',
            },
          ],
        });
        return;
      }

      const contents = await file.text();
      setFileContents(contents);
      setResult(parseMenuCsv(contents, existingItems));
    } catch {
      setResult({
        rows: [],
        sectionCount: 0,
        errors: [
          {
            row: 1,
            column: 'file',
            message: 'This file could not be read. Download a fresh template and try again.',
          },
        ],
      });
    } finally {
      setReading(false);
    }
  };

  // A failed RPC response can mean either a database rejection or a lost
  // response after commit. MenuManager refreshes in that path; when its item
  // props change, re-run the local collision checks before offering Retry.
  useEffect(() => {
    if (!fileContents || reading || importing) return;
    setResult(parseMenuCsv(fileContents, existingItems));
  }, [existingItems, fileContents, importing, reading]);

  const importRows = async () => {
    if (!result || result.errors.length > 0 || result.rows.length === 0 || importing) return;
    setImporting(true);
    setServerError('');

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.rpc('import_merchant_menu', {
      p_restaurant_id: restaurantId,
      p_rows: result.rows,
    });

    if (error) {
      const detail = permissionDeniedCopy(error) ?? error.message;
      let refreshed = false;
      try {
        refreshed = (await onImported()) !== false;
      } catch {
        refreshed = false;
      }
      setServerError(
        refreshed
          ? `The import outcome could not be confirmed. The menu was refreshed—check it before retrying. ${detail}`
          : `The import outcome could not be confirmed, and the menu could not be refreshed. Refresh the page and check the menu before retrying. ${detail}`,
      );
      setImporting(false);
      return;
    }

    const itemCount = result.rows.length;
    await onImported();
    clear();
    setImporting(false);
    toast(`Imported ${itemCount} menu ${itemCount === 1 ? 'item' : 'items'}`, 'success');
  };

  return (
    <section className="border-t border-line pt-4" aria-labelledby="csv-import-heading">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h3 id="csv-import-heading" className="text-sm font-bold text-ink">
            Import menu from CSV
          </h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink3">
            Add up to 500 items at once. Existing items are never overwritten, and the database
            rejects the entire import if any row is invalid. Use whole-EGP prices, separate flags
            with |, and enter true or false for availability.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={TEMPLATE_URL}
            download="sharm-eats-menu-template.csv"
            className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ink2 transition hover:border-accent hover:text-accent active:scale-[0.98]"
          >
            Download template
          </a>
          <label className="cursor-pointer rounded-lg bg-accent px-3 py-2 text-xs font-bold text-white transition active:scale-[0.98]">
            Choose CSV
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              aria-label="Choose menu CSV"
              disabled={reading || importing}
              onChange={(event) => void chooseFile(event.target.files?.[0])}
            />
          </label>
        </div>
      </div>

      {reading && (
        <div className="mt-4 animate-pulse border-t border-line pt-4" aria-live="polite">
          <div className="h-4 w-40 rounded bg-line" />
          <div className="mt-3 h-8 w-full rounded bg-bg" />
          <span className="sr-only">Reading CSV</span>
        </div>
      )}

      {result && !reading && (
        <div className="mt-4 border-t border-line pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-bold text-ink">{fileName}</p>
              {result.errors.length === 0 && (
                <p className="text-xs text-ink3">
                  {result.rows.length} {result.rows.length === 1 ? 'item' : 'items'} across{' '}
                  {result.sectionCount} {result.sectionCount === 1 ? 'section' : 'sections'}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={clear}
              disabled={importing}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-ink3 transition hover:bg-bg hover:text-ink active:scale-[0.98] disabled:opacity-50"
            >
              Remove file
            </button>
          </div>

          {serverError && (
            <p
              role="alert"
              className="mt-3 border-l-2 border-red bg-redsoft px-4 py-3 text-sm text-red"
            >
              {serverError}
            </p>
          )}

          {result.errors.length > 0 ? (
            <div role="alert" className="mt-3 border-l-2 border-red bg-redsoft px-4 py-3">
              <p className="text-sm font-bold text-red">
                Fix {result.errors.length} {result.errors.length === 1 ? 'error' : 'errors'} before
                importing
              </p>
              <ul className="mt-2 max-h-52 space-y-1 overflow-y-auto text-xs text-red">
                {result.errors.map((error, index) => (
                  <li key={`${error.row}-${error.column}-${index}`}>
                    Row {error.row}, {error.column}: {error.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              <div className="mt-3 overflow-x-auto rounded-lg border border-line">
                <table className="w-full min-w-[560px] text-left text-xs">
                  <thead className="bg-bg text-ink3">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Section</th>
                      <th className="px-3 py-2 font-semibold">Item</th>
                      <th className="px-3 py-2 text-right font-semibold">Price</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {result.rows.slice(0, 50).map((row, index) => (
                      <tr key={`${row.section_name}-${row.item_name}-${index}`}>
                        <td className="px-3 py-2 text-ink2">{row.section_name}</td>
                        <td className="px-3 py-2 font-semibold text-ink">{row.item_name}</td>
                        <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">
                          {row.price_egp} EGP
                        </td>
                        <td className="px-3 py-2 text-ink2">
                          {row.is_available ? 'In stock' : 'Out of stock'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.rows.length > 50 && (
                <p className="mt-2 text-xs text-ink3">
                  Previewing 50 of {result.rows.length} items.
                </p>
              )}

              <div className="mt-4 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                <p className="max-w-lg text-xs leading-relaxed text-ink3">
                  Import adds new items and reuses matching section names. A matching item name in
                  the same section stops the whole import.
                </p>
                <button
                  type="button"
                  onClick={importRows}
                  disabled={importing}
                  className="w-full rounded-lg bg-accent px-5 py-2 text-sm font-bold text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {importing
                    ? 'Importing safely…'
                    : `Import ${result.rows.length} ${result.rows.length === 1 ? 'item' : 'items'}`}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
