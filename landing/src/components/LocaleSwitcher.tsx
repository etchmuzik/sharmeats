import { localeLabels, locales, type Locale } from '@/i18n/dictionaries';

interface LocaleSwitcherProps {
  value: Locale;
  onChange: (next: Locale) => void;
}

export function LocaleSwitcher({ value, onChange }: LocaleSwitcherProps) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink2">
      <span className="sr-only">Language</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Locale)}
        className="rounded-full border border-black/10 bg-white/80 px-3 py-1.5 text-sm font-medium text-ink shadow-sm backdrop-blur transition hover:border-black/20 focus:outline-none focus:ring-2 focus:ring-accent/40"
      >
        {locales.map((l) => (
          <option key={l} value={l}>
            {localeLabels[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
