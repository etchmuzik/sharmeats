'use client';

import { useState } from 'react';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import type { Dictionary, Locale } from '@/i18n/dictionaries';

interface WaitlistFormProps {
  locale: Locale;
  dict: Dictionary['waitlist'];
}

type SubmitState = 'idle' | 'submitting' | 'success' | 'error';

/** Postgres unique-violation error code — a duplicate email signup. */
const UNIQUE_VIOLATION = '23505';

export function WaitlistForm({ locale, dict }: WaitlistFormProps) {
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [state, setState] = useState<SubmitState>('idle');
  const [successMessage, setSuccessMessage] = useState(dict.success);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMessage(null);

    const normalizedEmail = email.trim().toLowerCase();
    if (!isValidEmail(normalizedEmail)) {
      setState('error');
      setErrorMessage(dict.errorEmail);
      return;
    }

    if (!isSupabaseConfigured()) {
      setState('error');
      setErrorMessage(dict.errorGeneric);
      return;
    }

    setState('submitting');
    try {
      // Static export: no API route. Insert directly with the anon key, gated by
      // the INSERT-only RLS policy (migration 063). Email is lowercased to match
      // the table's `email = lower(email)` check and unique(email) constraint.
      const { error } = await getSupabase()
        .from('waitlist')
        .insert({
          email: normalizedEmail,
          whatsapp: whatsapp.trim() || null,
          locale,
          source: 'landing',
          referrer: typeof document !== 'undefined' ? document.referrer || null : null,
        });

      if (error) {
        // A duplicate email is a success from the visitor's point of view: they
        // are already on the list. Show a friendly, localized message instead
        // of an error.
        if (error.code === UNIQUE_VIOLATION) {
          setSuccessMessage(dict.duplicate);
          setState('success');
          setEmail('');
          setWhatsapp('');
          return;
        }
        throw new Error(error.message);
      }

      setSuccessMessage(dict.success);
      setState('success');
      setEmail('');
      setWhatsapp('');
    } catch (err: unknown) {
      setState('error');
      setErrorMessage(err instanceof Error ? err.message : dict.errorGeneric);
    }
  }

  if (state === 'success') {
    return (
      <div className="rounded-2xl border border-accent/20 bg-white p-6 text-center text-ink shadow-sm">
        <p className="text-base font-medium">{successMessage}</p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm"
      noValidate
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-ink">
            {dict.emailLabel}
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            placeholder={dict.emailPlaceholder}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-black/10 bg-bg px-4 py-3 text-base text-ink placeholder:text-ink2/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </div>

        <div>
          <label htmlFor="whatsapp" className="block text-sm font-medium text-ink">
            {dict.whatsappLabel}
          </label>
          <input
            id="whatsapp"
            type="tel"
            autoComplete="tel"
            placeholder={dict.whatsappPlaceholder}
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-black/10 bg-bg px-4 py-3 text-base text-ink placeholder:text-ink2/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </div>

        {state === 'error' && errorMessage && (
          <p role="alert" className="text-sm text-accentDark">
            {errorMessage}
          </p>
        )}

        <button
          type="submit"
          disabled={state === 'submitting'}
          className="w-full rounded-full bg-accent px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-accentDark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {state === 'submitting' ? dict.submitting : dict.submit}
        </button>
      </div>
    </form>
  );
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
