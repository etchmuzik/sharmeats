import type { MenuItem, MenuSection } from '@/lib/types';

export type MenuLoadState = {
  sections: MenuSection[];
  items: MenuItem[];
  loading: boolean;
  loadError: boolean;
};

type MenuReadResult<T> = {
  data: T[] | null;
  error: unknown | null;
};

export const initialMenuLoadState: MenuLoadState = {
  sections: [],
  items: [],
  loading: true,
  loadError: false,
};

/**
 * Starts a refresh without throwing away the menu that was last confirmed by
 * Supabase. A transient read failure can then be retried without impersonating
 * an empty restaurant menu.
 */
export function startMenuLoad(state: MenuLoadState): MenuLoadState {
  return { ...state, loading: true, loadError: false };
}

/**
 * Treat the section and item reads as one atomic menu snapshot. If either one
 * fails, retain the previous snapshot and let the UI present a retry action.
 */
export function finishMenuLoad(
  state: MenuLoadState,
  sectionsResult: MenuReadResult<MenuSection>,
  itemsResult: MenuReadResult<MenuItem>,
): MenuLoadState {
  if (sectionsResult.error || itemsResult.error) {
    return { ...state, loading: false, loadError: true };
  }

  return {
    sections: sectionsResult.data ?? [],
    items: itemsResult.data ?? [],
    loading: false,
    loadError: false,
  };
}
