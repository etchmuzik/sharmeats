/**
 * Emit design tokens as CSS custom properties for the Next.js dashboards.
 *
 * Usage (in a Next.js global stylesheet generator or a <style> tag):
 *   import { cssVariablesBlock } from '@sharmeats/tokens/css';
 *   const css = `:root { ${cssVariablesBlock()} }`;
 *
 * Variables are prefixed `--se-` (Sharm Eats). Colors stay as hex; spacing and
 * radius become px; font sizes become px.
 */
import { colors, spacing, radius, fontSizes } from './index';

export function cssVariablesBlock(): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(colors)) {
    lines.push(`--se-color-${kebab(k)}: ${v};`);
  }
  for (const [k, v] of Object.entries(spacing)) {
    lines.push(`--se-space-${k}: ${v}px;`);
  }
  for (const [k, v] of Object.entries(radius)) {
    lines.push(`--se-radius-${k}: ${v}px;`);
  }
  for (const [k, v] of Object.entries(fontSizes)) {
    lines.push(`--se-font-${kebab(k)}: ${v}px;`);
  }
  return lines.join('\n');
}

/** Tailwind v4 theme tokens (for @theme inline in globals.css). */
export function tailwindColorVars(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(colors)) {
    out[`--color-se-${kebab(k)}`] = v;
  }
  return out;
}

function kebab(s: string): string {
  return s.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase();
}
