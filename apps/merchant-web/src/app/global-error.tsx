'use client';

import { useEffect } from 'react';
import { captureError } from '@/lib/sentry';

/**
 * App Router GLOBAL error boundary. Catches errors thrown in the root layout
 * itself (which `error.tsx` cannot). Because it replaces the whole document
 * when it renders, it must ship its own <html>/<body>.
 *
 * Reports to Sentry (no-op without a DSN) and renders a minimal branded
 * fallback so the money surfaces never white-screen silently.
 */
export default function GlobalError({
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
    <html lang="en">
      <body style={{ margin: 0, background: '#F6F5F2', color: '#161616' }}>
        <main
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
            textAlign: 'center',
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
          }}
        >
          <div style={{ maxWidth: '28rem' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#F05A1F' }}>Sharm Eats</div>
            <h1 style={{ marginTop: '0.75rem', fontSize: '1.25rem', fontWeight: 700 }}>
              Something went wrong
            </h1>
            <p style={{ marginTop: '0.5rem', color: '#8B8984' }}>
              The dashboard hit an unexpected error. Reloading usually fixes it.
            </p>
            <button
              onClick={() => reset()}
              style={{
                marginTop: '1.5rem',
                borderRadius: '0.75rem',
                background: '#F05A1F',
                color: '#fff',
                border: 'none',
                padding: '0.5rem 1.5rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Reload
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
