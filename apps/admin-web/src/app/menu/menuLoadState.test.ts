import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MenuItem, MenuSection } from '@/lib/types';
import { MenuLoadError } from './MenuLoadError';
import {
  finishMenuLoad,
  startMenuLoad,
  type MenuLoadState,
} from './menuLoadState';

const sections: MenuSection[] = [
  {
    id: 'section-1',
    restaurant_id: 'restaurant-1',
    name: 'Mains',
    sort_order: 0,
  },
];

const items: MenuItem[] = [
  {
    id: 'item-1',
    restaurant_id: 'restaurant-1',
    section_id: 'section-1',
    name: 'Koshary',
    description: 'Lentils and pasta',
    price_egp: 95,
    image: '',
    flags: [],
    is_available: true,
    sort_order: 0,
  },
];

const loadedMenu: MenuLoadState = {
  sections,
  items,
  loading: false,
  loadError: false,
};

describe('menu load state', () => {
  // As an admin, I need a failed refresh to keep the menu I was already
  // editing, so that a temporary read failure never looks like an empty menu.
  it.each([
    [
      'section',
      { data: null, error: { message: 'connection interrupted' } },
      { data: [], error: null },
    ],
    [
      'item',
      { data: [], error: null },
      { data: null, error: { message: 'connection interrupted' } },
    ],
  ])('keeps the last successful menu and exposes a retryable error when the %s select fails', (
    _failedRead,
    sectionsResult,
    itemsResult,
  ) => {
    const state = finishMenuLoad(startMenuLoad(loadedMenu), sectionsResult, itemsResult);

    expect(state).toEqual({
      ...loadedMenu,
      loading: false,
      loadError: true,
    });
  });

  it('clears the error and replaces the menu only after both selects succeed', () => {
    const state = finishMenuLoad(
      { ...loadedMenu, loadError: true },
      { data: [], error: null },
      { data: [], error: null },
    );

    expect(state).toEqual({
      sections: [],
      items: [],
      loading: false,
      loadError: false,
    });
  });

  it('renders a safe retry control instead of the empty-menu copy after a failed read', () => {
    const markup = renderToStaticMarkup(createElement(MenuLoadError, { onRetry: () => undefined }));

    expect(markup).toContain('Could not refresh the menu. Check your connection and try again.');
    expect(markup).toContain('Try again');
    expect(markup).not.toContain('No sections yet.');
  });
});
