import type { ItemFlag, MenuItem } from '../data/types';

/** Keep user text literal when it reaches SQL LIKE/ILIKE patterns. */
export function escapeCatalogPattern(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_')
    .replaceAll('*', '\\*');
}

/** Restore the visibility-scoped RPC's ranking after hydrating full item rows. */
export function orderCatalogItems(ids: string[], items: MenuItem[]): MenuItem[] {
  const byId = new Map(items.map((entry) => [entry.id, entry]));
  return ids.flatMap((id) => {
    const entry = byId.get(id);
    return entry ? [entry] : [];
  });
}

/** Dietary filters describe a dish the customer can order, not a menu-wide union. */
export function itemMatchesEveryFlag(item: MenuItem, flags: ItemFlag[]): boolean {
  return item.isAvailable && flags.every((flag) => item.flags.includes(flag));
}
