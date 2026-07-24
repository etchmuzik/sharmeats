'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { LegalLinks } from '../LegalLinks';

export default function LoginPage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    setBusy(false);
    if (error) return setError(error.message);
    router.replace('/');
    router.refresh();
  }

  // Send a reset email whose link returns to /reset-password on THIS dashboard,
  // where the recovery token is exchanged and a new password can be set. A
  // locked-out restaurant owner can now self-recover (previously impossible).
  async function sendReset() {
    const addr = email.trim().toLowerCase();
    if (!addr) {
      setError('Enter your email first, then tap “Forgot password”.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error } = await supabase.auth.resetPasswordForEmail(addr, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (error) return setError(error.message);
    setNotice(`If an account exists for ${addr}, a reset link is on its way.`);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <div className="text-2xl font-extrabold text-accent">Sharm Eats</div>
          <div className="text-sm text-ink2">Merchant dashboard</div>
        </div>

        <div className="space-y-3">
          <label className="block text-sm font-medium text-ink2">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="owner@restaurant.com"
            autoComplete="username"
            className="w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-accent"
          />
          <label className="block text-sm font-medium text-ink2">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            className="w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-accent"
            onKeyDown={(e) => e.key === 'Enter' && email && password && signIn()}
          />
          <button
            disabled={busy || !email || !password}
            onClick={signIn}
            className="w-full rounded-xl bg-accent py-3 font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={sendReset}
            className="w-full text-center text-sm font-medium text-ink2 hover:text-accent disabled:opacity-50"
          >
            Forgot password?
          </button>
        </div>

        {error && <p className="mt-4 rounded-lg bg-redsoft px-3 py-2 text-sm text-red">{error}</p>}
        {notice && (
          <p className="mt-4 rounded-lg bg-greensoft px-3 py-2 text-sm text-green">{notice}</p>
        )}

        <p className="mt-4 text-center text-sm text-ink2">
          New restaurant?{' '}
          <Link className="underline" href="/signup">
            Partner with Sharm Eats
          </Link>
        </p>

        <LegalLinks className="mt-6" />
      </div>
    </main>
  );
}
