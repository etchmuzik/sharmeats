'use client';

/**
 * Small form-field primitives for the menu manager. Plain Tailwind, brand
 * tokens (border-line, text-ink2), no UI library — matches the rest of admin-web.
 */

export function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-ink2">
        {label}
        {required && <span className="text-accent"> *</span>}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-accent"
      />
    </label>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min = 0,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-ink2">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          onChange(Number.isFinite(n) ? Math.max(min, n) : min);
        }}
        className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-accent"
      />
    </label>
  );
}

export function TextArea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-ink2">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full resize-y rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-accent"
      />
    </label>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
        checked ? 'border-green bg-greensoft text-green' : 'border-line text-ink3'
      }`}
    >
      <span
        className={`inline-block h-4 w-7 rounded-full transition ${
          checked ? 'bg-green' : 'bg-ink3/30'
        } relative`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${
            checked ? 'left-3.5' : 'left-0.5'
          }`}
        />
      </span>
      {label}
    </button>
  );
}
