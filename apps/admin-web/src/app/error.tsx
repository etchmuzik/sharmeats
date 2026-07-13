'use client';

import { useEffect } from 'react';
import { captureError } from '@/lib/sentry';

/**
 * App Router route-segment error boundary for the ops dashboard content.
 *
 * This is what stops the silent white-screen when a money page (finance,
 * driver payouts, cash, KYC, support) throws: it reports to Sentry (no-op
 * without a DSN) and renders a recoverable fallback with a retry button that
 * re-renders the segment via `reset()`. Styled with the app's Tailwind tokens
 * to match the existing error/unauthorized states in page.tsx.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureError(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 text-center">
      <div className="max-w-md">
        <div className="text-2xl font-extrabold">
          Sharm Eats <span className="text-accent">Ops</span>
        </div>
        <h1 className="mt-3 text-xl font-bold">Something went wrong</h1>
        <p className="mt-2 text-ink2">
          This screen hit an unexpected error. Try again — nothing was lost.
        </p>
        <div className="mt-6">
          <button
            onClick={() => reset()}
            className="rounded-xl bg-accent px-6 py-2 font-semibold text-white"
          >
            Try again
          </button>
        </div>
      </div>
    </main>
  );
}
