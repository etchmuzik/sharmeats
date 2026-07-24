'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { LegalLinks } from '../LegalLinks';

export default function SignupPage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function signUp() {
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
    });
    setBusy(false);
    if (error) return setError(error.message);
    // With email confirmation ON, no session exists yet — tell them to confirm.
    if (!data.session) {
      setNotice('Check your inbox to confirm your email, then log in to continue your application.');
      return;
    }
    router.replace('/');
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <div className="text-2xl font-extrabold text-accent">Sharm Eats</div>
          <div className="text-sm text-ink2">Partner with Sharm Eats</div>
        </div>

        <p className="mb-4 text-sm text-ink2">
          Create your account, tell us about your restaurant, and start selling after a quick review.
        </p>

        <div className="space-y-3">
          <label className="block text-sm font-medium text-ink2">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Business email"
            autoComplete="email"
            className="w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-accent"
          />
          <label className="block text-sm font-medium text-ink2">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (8+ characters)"
            autoComplete="new-password"
            className="w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-accent"
            onKeyDown={(e) => e.key === 'Enter' && email && password.length >= 8 && signUp()}
          />
          <button
            disabled={busy || !email || password.length < 8}
            onClick={signUp}
            className="w-full rounded-xl bg-accent py-3 font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Creating account…' : 'Create account'}
          </button>
        </div>

        {error && <p className="mt-4 rounded-lg bg-redsoft px-3 py-2 text-sm text-red">{error}</p>}
        {notice && (
          <p className="mt-4 rounded-lg bg-greensoft px-3 py-2 text-sm text-green">{notice}</p>
        )}

        <p className="mt-6 text-center text-sm text-ink2">
          Already a partner? <Link className="font-medium text-accent hover:underline" href="/login">Log in</Link>
        </p>

        <LegalLinks className="mt-6" />
      </div>
    </main>
  );
}
