'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { mfaGate } from '@/lib/mfa';

/**
 * Reset-password landing for the recovery email link.
 *
 * The email link returns here with a recovery token in the URL. supabase-js
 * (detectSessionInUrl) consumes it and fires a PASSWORD_RECOVERY event, putting
 * the browser into a short-lived recovery session in which updateUser({password})
 * is allowed. We wait for that event, then let the user set a new password.
 *
 * THE TOTP HOLE THIS CLOSES: a recovery session is aal1 — it has satisfied a
 * password (well, an emailed link) and nothing else. This page used to send it
 * straight to `/` on success, so anyone who could read the admin's inbox got a
 * signed-in dashboard without ever touching the authenticator, which is the
 * entire protection TOTP was added for. A password change now ENDS the session:
 * sign back in properly, code and all.
 *
 * That is the client half. The server half is the one that actually holds —
 * RLS and the SECURITY DEFINER RPCs authorise on role alone and cannot
 * currently tell aal1 from aal2, so a recovery session that never loads this
 * app can still call them. See FOLLOWUPS-admin-web.md.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [signInRequired, setSignInRequired] = useState(false);

  useEffect(() => {
    // If the recovery token already produced a session (link just clicked), or
    // when the PASSWORD_RECOVERY event fires, we're ready to accept a new password.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setReady(true);
    });
    // Also check immediately in case the event already fired before mount.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  async function submit() {
    if (password.length < 8) {
      setError('Use at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setBusy(false);
      return setError(error.message);
    }

    // The password is changed. Decide where this aal1 session may go.
    const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    // Fail CLOSED on an indeterminate answer, the opposite of the sign-in gate:
    // there, blocking would lock the only admin out of production over a
    // transient. Here the user has just chosen a password they know, so the
    // cost of sending them to /login is one extra sign-in.
    const needsCode = Boolean(aalError) || mfaGate(aal?.currentLevel, aal?.nextLevel) === 'code_required';
    setBusy(false);
    setDone(true);

    if (needsCode) {
      setSignInRequired(true);
      await supabase.auth.signOut();
      setTimeout(() => router.replace('/login'), 1500);
      return;
    }
    setTimeout(() => router.replace('/'), 1500);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <div className="text-2xl font-extrabold">
            Sharm Eats <span className="text-accent">Ops</span>
          </div>
          <div className="text-sm text-ink2">Set a new password</div>
        </div>

        {done ? (
          <p className="rounded-lg bg-greensoft px-3 py-3 text-center text-sm font-semibold text-green">
            {signInRequired
              ? 'Password updated. Sign in again with your new password and your authenticator code.'
              : 'Password updated. Signing you in…'}
          </p>
        ) : !ready ? (
          <p className="text-center text-sm text-ink2">
            Open this page from the reset link in your email. Waiting for a valid
            recovery session…
          </p>
        ) : (
          <div className="space-y-3">
            <label className="block text-sm font-medium text-ink2">New password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              className="w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-accent"
            />
            <label className="block text-sm font-medium text-ink2">Confirm password</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              className="w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-accent"
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
            <button
              disabled={busy || !password || !confirm}
              onClick={submit}
              className="w-full rounded-xl bg-accent py-3 font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Set new password'}
            </button>
          </div>
        )}

        {error && <p className="mt-4 rounded-lg bg-redsoft px-3 py-2 text-sm text-red">{error}</p>}
      </div>
    </main>
  );
}
