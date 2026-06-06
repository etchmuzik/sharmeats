'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <div className="text-2xl font-extrabold">
            Sharm Eats <span className="text-accent">Ops</span>
          </div>
          <div className="text-sm text-ink2">Operations dashboard</div>
        </div>

        <div className="space-y-3">
          <label className="block text-sm font-medium text-ink2">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ops@sharmeats.com"
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
        </div>

        {error && <p className="mt-4 rounded-lg bg-redsoft px-3 py-2 text-sm text-red">{error}</p>}
      </div>
    </main>
  );
}
