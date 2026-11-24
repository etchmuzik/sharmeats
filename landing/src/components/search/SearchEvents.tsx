'use client';

import { useEffect } from 'react';
import { parseRoute, type Lang } from './routes';

type Category = 'home' | 'area' | 'menu' | 'guide' | 'order' | 'prototype';
type Intent = 'area' | 'menu' | 'app_handoff';

function category(pathname: string): Category | undefined {
  const { path } = parseRoute(pathname.split('/').filter(Boolean));
  if (!path) return 'home';
  if (path === 'delivery-areas' || path.startsWith('areas/')) return 'area';
  if (path === 'restaurants' || path.startsWith('restaurants/')) return 'menu';
  if (path === 'hotel-delivery' || path === 'how-it-works') return 'guide';
  if (path === 'prototype' || path === 'prototype/order') return 'prototype';
  if (path === 'order') return 'order';
}

export function SearchEvents({ lang }: { lang: Lang }) {
  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.origin !== window.location.origin || anchor.hasAttribute('hreflang')) return;
      const source = category(window.location.pathname);
      if (!source) return;

      const target = category(anchor.pathname);
      const intent: Intent | undefined = anchor.pathname === '/go/ios/' ? 'app_handoff'
        : target === 'area' || target === 'menu' ? target : undefined;
      if (!intent) return;

      // Retain only fixed categories. Never read query strings, anchor text, IDs or form fields.
      const clientWindow = window as Window & { dataLayer?: unknown[] };
      (clientWindow.dataLayer ??= []).push({ event: intent, route_category: source, locale: lang });
    }

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [lang]);
  return null;
}
