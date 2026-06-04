'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [phase, setPhase] = useState<'email' | 'otp'>('email');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendOtp() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: false },
    });
    setBusy(false);
    if (error) return setError(error.message);
    setPhase('otp');
  }

  async function verify() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: token.trim(),
      type: 'email',
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

        {phase === 'email' ? (
          <div className="space-y-3">
            <label className="block text-sm font-medium text-ink2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ops@sharmeats.com"
              className="w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-accent"
              onKeyDown={(e) => e.key === 'Enter' && email && sendOtp()}
            />
            <button
              disabled={busy || !email}
              onClick={sendOtp}
              className="w-full rounded-xl bg-accent py-3 font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block text-sm font-medium text-ink2">
              Enter the 6-digit code sent to {email}
            </label>
            <input
              inputMode="numeric"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="123456"
              className="w-full rounded-xl border border-line px-4 py-3 text-center text-lg tracking-widest outline-none focus:border-accent"
              onKeyDown={(e) => e.key === 'Enter' && token && verify()}
            />
            <button
              disabled={busy || token.length < 6}
              onClick={verify}
              className="w-full rounded-xl bg-accent py-3 font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Verifying…' : 'Sign in'}
            </button>
            <button onClick={() => setPhase('email')} className="w-full py-2 text-sm text-ink3">
              Use a different email
            </button>
          </div>
        )}

        {error && <p className="mt-4 rounded-lg bg-redsoft px-3 py-2 text-sm text-red">{error}</p>}
      </div>
    </main>
  );
}
