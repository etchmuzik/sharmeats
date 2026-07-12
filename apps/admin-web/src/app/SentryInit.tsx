'use client';

import { useEffect } from 'react';
import { initSentry } from '@/lib/sentry';

/**
 * Boots client-side Sentry once, on mount, in the root layout. Renders nothing.
 *
 * Kept as a tiny client component so the layout itself can stay a server
 * component (it exports `metadata`/`viewport`, which client components can't).
 * Gated on NEXT_PUBLIC_SENTRY_DSN inside initSentry(), so this is a safe no-op
 * when Sentry isn't configured.
 */
export function SentryInit(): null {
  useEffect(() => {
    initSentry();
  }, []);
  return null;
}
