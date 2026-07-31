/**
 * All five locales must carry the same keys.
 *
 * `lookup()` falls back to English and then to the RAW KEY, so a key missing
 * from ar.json does not throw, does not fail a typecheck, and does not fail a
 * build — it renders `checkout.payCard` on the button of a paying customer, or
 * silently shows English inside an Arabic screen. `checkout.payCard` was missing
 * from every single file and had a hardcoded English fallback stapled onto the
 * call site to hide it.
 *
 * This is the cheapest possible guard: adding a string to one file and not the
 * other four now fails here instead of in Sharm.
 */
import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ar from './locales/ar.json';
import ru from './locales/ru.json';
import itDict from './locales/it.json';
import de from './locales/de.json';

const LOCALES: Record<string, Record<string, string>> = { ar, ru, it: itDict, de };
const enKeys = Object.keys(en as Record<string, string>);

describe('locale files stay in sync with en.json', () => {
  for (const [name, dict] of Object.entries(LOCALES)) {
    it(`${name}.json has every English key`, () => {
      const missing = enKeys.filter((k) => !(k in dict));
      expect(missing).toEqual([]);
    });

    it(`${name}.json has no keys English lacks`, () => {
      const extra = Object.keys(dict).filter((k) => !(k in (en as Record<string, string>)));
      expect(extra).toEqual([]);
    });

    it(`${name}.json has no empty translations`, () => {
      const blank = Object.entries(dict)
        .filter(([, v]) => typeof v !== 'string' || v.trim() === '')
        .map(([k]) => k);
      expect(blank).toEqual([]);
    });
  }

  it('keeps the {placeholder} set identical to English in every locale', () => {
    const placeholders = (s: string) => (s.match(/\{[a-zA-Z0-9_]+\}/g) ?? []).slice().sort();
    const mismatches: string[] = [];
    for (const [name, dict] of Object.entries(LOCALES)) {
      for (const key of enKeys) {
        const source = (en as Record<string, string>)[key];
        const target = dict[key];
        if (typeof target !== 'string') continue;
        // A dropped {amount} renders a price-less button; an invented one
        // renders a literal brace to the customer.
        if (placeholders(source).join(',') !== placeholders(target).join(',')) {
          mismatches.push(`${name}:${key}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });
});
