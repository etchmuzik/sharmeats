'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { LegalLinks } from '../LegalLinks';
import { describeMfaError, isCompleteTotpCode, mfaGate, normalizeTotpCode } from '@/lib/mfa';

export default function LoginPage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Second step of sign-in, shown only when the account has a verified factor.
  const [totpCode, setTotpCode] = useState('');
  const [challenge, setChallenge] = useState<{ factorId: string; challengeId: string } | null>(null);

  async function signIn() {
    setBusy(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (signInError) {
      setBusy(false);
      return setError(signInError.message);
    }

    // The password alone leaves the session at aal1. If a verified TOTP factor
    // exists, Supabase reports nextLevel 'aal2' and the session stays at aal1
    // until a code is verified — it does NOT block on its own, so if this app
    // simply navigated on, enrolling MFA would protect nothing.
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const gate = mfaGate(aal?.currentLevel, aal?.nextLevel);
    if (gate !== 'code_required') {
      setBusy(false);
      router.replace('/');
      router.refresh();
      return;
    }

    const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
    const factorId = factors?.totp?.[0]?.id;
    if (listError || !factorId) {
      // A code is owed but no factor is readable. Sign back out rather than
      // leaving a half-authenticated aal1 session sitting on the dashboard.
      await supabase.auth.signOut();
      setBusy(false);
      return setError('This account requires an authenticator code, but no factor could be read. Contact the platform owner.');
    }

    const { data: ch, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    setBusy(false);
    if (challengeError || !ch) return setError(describeMfaError(challengeError?.message));
    setChallenge({ factorId, challengeId: ch.id });
  }

  async function verifyCode() {
    if (!challenge) return;
    setBusy(true);
    setError(null);
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: challenge.factorId,
      challengeId: challenge.challengeId,
      code: normalizeTotpCode(totpCode),
    });
    setBusy(false);
    if (verifyError) {
      // Keep the operator on this step. The challenge is single-use, so mint a
      // fresh one — reusing a spent challengeId fails with a confusing error
      // that reads like the code was wrong.
      const { data: ch } = await supabase.auth.mfa.challenge({ factorId: challenge.factorId });
      if (ch) setChallenge({ factorId: challenge.factorId, challengeId: ch.id });
      setTotpCode('');
      return setError(describeMfaError(verifyError.message));
    }
    router.replace('/');
    router.refresh();
  }

  /** Abandon the code step and drop the half-authenticated aal1 session. */
  async function cancelChallenge() {
    setBusy(true);
    await supabase.auth.signOut();
    setBusy(false);
    setChallenge(null);
    setTotpCode('');
    setPassword('');
    setError(null);
  }

  // Send a reset email whose link returns to /reset-password on THIS dashboard,
  // where the recovery token is exchanged and a new password can be set.
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
          <div className="text-2xl font-extrabold">
            Sharm Eats <span className="text-accent">Ops</span>
          </div>
          <div className="text-sm text-ink2">Operations dashboard</div>
        </div>

        {/* Two steps, never both at once: showing a spent password field beside
            a code prompt invites re-typing the password when the code fails. */}
        {challenge ? (
          <div className="space-y-3">
            <label className="block text-sm font-medium text-ink2">Authenticator code</label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              value={totpCode}
              onChange={(e) => setTotpCode(normalizeTotpCode(e.target.value))}
              placeholder="123456"
              aria-label="Six-digit authenticator code"
              className="w-full rounded-xl border border-line px-4 py-3 text-center text-2xl font-bold tracking-[0.3em] outline-none focus:border-accent"
              onKeyDown={(e) => e.key === 'Enter' && isCompleteTotpCode(totpCode) && verifyCode()}
            />
            <p className="text-sm text-ink2">
              Open your authenticator app and enter the current six-digit code for Sharm Eats Ops.
            </p>
            <button
              disabled={busy || !isCompleteTotpCode(totpCode)}
              onClick={verifyCode}
              className="w-full rounded-xl bg-accent py-3 font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Verifying…' : 'Verify'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={cancelChallenge}
              className="w-full text-center text-sm font-medium text-ink2 hover:text-accent disabled:opacity-50"
            >
              Cancel and sign out
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block text-sm font-medium text-ink2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@sharmeats.online"
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
        )}

        {error && <p className="mt-4 rounded-lg bg-redsoft px-3 py-2 text-sm text-red">{error}</p>}
        {notice && (
          <p className="mt-4 rounded-lg bg-greensoft px-3 py-2 text-sm text-green">{notice}</p>
        )}

        <LegalLinks className="mt-6" />
      </div>
    </main>
  );
}
