/**
 * Account security — TOTP enrolment for the ops dashboard.
 *
 * This page is the only way to turn MFA on, so it deliberately does not gate on
 * role: a dispatcher securing their own account is strictly good, and the page
 * shows nothing but the signed-in user's own factors. RLS is unchanged and this
 * grants nothing.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  describeMfaError,
  hasVerifiedFactor,
  isCompleteTotpCode,
  normalizeTotpCode,
  staleUnverifiedFactorIds,
  toFactorViews,
  type TotpFactorView,
} from '@/lib/mfa';

type Enrolling = { factorId: string; qr: string; secret: string };

export default function SecurityPage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [email, setEmail] = useState<string | null>(null);
  const [factors, setFactors] = useState<TotpFactorView[]>([]);
  const [enrolling, setEnrolling] = useState<Enrolling | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) setError(listError.message);
    // `all` rather than `totp`: the latter omits unverified factors, and those
    // are exactly the ones that block a re-enrol and need clearing.
    setFactors(toFactorViews(data?.all as never));
    setLoaded(true);
  }, [supabase]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.replace('/login');
        return;
      }
      setEmail(data.user.email ?? null);
      void refresh();
    });
  }, [supabase, router, refresh]);

  async function startEnrol() {
    setBusy(true);
    setError(null);
    setNotice(null);

    // Clear abandoned attempts first. enroll() refuses when an unverified
    // factor already exists, and the raw error ("factor already exists") reads
    // like the account is already protected when it is not.
    for (const id of staleUnverifiedFactorIds(factors)) {
      await supabase.auth.mfa.unenroll({ factorId: id });
    }

    const { data, error: enrolError } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `Ops dashboard · ${new Date().toISOString().slice(0, 10)}`,
    });
    setBusy(false);
    if (enrolError || !data) return setError(enrolError?.message ?? 'Could not start enrolment.');
    setEnrolling({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    setCode('');
  }

  async function confirmEnrol() {
    if (!enrolling) return;
    setBusy(true);
    setError(null);
    const { data: ch, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId: enrolling.factorId,
    });
    if (challengeError || !ch) {
      setBusy(false);
      return setError(describeMfaError(challengeError?.message));
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: enrolling.factorId,
      challengeId: ch.id,
      code: normalizeTotpCode(code),
    });
    setBusy(false);
    if (verifyError) {
      setCode('');
      return setError(describeMfaError(verifyError.message));
    }
    setEnrolling(null);
    setCode('');
    setNotice('Authenticator app enabled. This session now has admin authority.');
    await refresh();
    router.replace('/');
    router.refresh();
  }

  async function removeFactor(id: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error: unenrolError } = await supabase.auth.mfa.unenroll({ factorId: id });
    if (unenrolError) {
      setBusy(false);
      return setError(unenrolError.message);
    }
    // Supabase documents that an aal2 JWT can otherwise stay aal2 until its
    // normal refresh interval after factor removal. Refresh immediately so the
    // shell and database see the downgraded session without that grace period.
    const { error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) {
      setBusy(false);
      return setError('Authenticator removed, but the session could not be refreshed. Sign out now.');
    }
    // A full reload re-runs the root shell guard. router.refresh() can preserve
    // this client layout and leave stale privileged navigation painted.
    window.location.replace('/security');
  }

  const protectedNow = hasVerifiedFactor(factors);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-extrabold">Account security</h1>
      <p className="mt-1 text-sm text-ink2">
        {email ? <>Signed in as {email}.</> : null} Two-factor authentication protects this
        dashboard even if the password is known to someone else.
      </p>

      {loaded && (
        <div
          className={`mt-6 rounded-xl px-4 py-3 text-sm font-medium ${
            protectedNow ? 'bg-greensoft text-green' : 'bg-redsoft text-red'
          }`}
        >
          {protectedNow
            ? 'Two-factor authentication is ON for this account.'
            : 'Two-factor authentication is OFF. This account is protected by a password alone.'}
        </div>
      )}

      {/* Stated before enrolling, not after. The recovery path for a lost
          authenticator is not self-service, and someone should know that
          before they point their phone at the QR code. */}
      <div className="mt-4 rounded-xl border border-line bg-white p-4 text-sm text-ink2">
        <strong className="text-ink">Before you enrol:</strong> if you lose the device running the
        authenticator app, you cannot recover access yourself — a password reset will not help,
        because the code is the second factor. Someone with database access must delete the factor.
        Keep the setup key below somewhere safe, or add the account to an authenticator that syncs
        across your devices.
      </div>

      {error && <p className="mt-4 rounded-lg bg-redsoft px-3 py-2 text-sm text-red">{error}</p>}
      {notice && (
        <p className="mt-4 rounded-lg bg-greensoft px-3 py-2 text-sm text-green">{notice}</p>
      )}

      {enrolling ? (
        <section className="mt-6 rounded-2xl border border-line bg-white p-6">
          <h2 className="font-bold">Scan this with your authenticator app</h2>
          {/* Supabase returns the QR as a data: URI, so it renders directly. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={enrolling.qr}
            alt="QR code for enrolling this account in an authenticator app"
            className="mt-4 h-48 w-48"
          />
          <p className="mt-4 text-sm text-ink2">
            Can&rsquo;t scan? Enter this setup key manually:
          </p>
          <code className="mt-1 block break-all rounded-lg bg-bg px-3 py-2 font-mono text-sm">
            {enrolling.secret}
          </code>

          <label className="mt-6 block text-sm font-medium text-ink2">
            Then enter the six-digit code it shows
          </label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(normalizeTotpCode(e.target.value))}
            placeholder="123456"
            aria-label="Six-digit code from your authenticator app"
            className="mt-2 w-full rounded-xl border border-line px-4 py-3 text-center text-2xl font-bold tracking-[0.3em] outline-none focus:border-accent"
            onKeyDown={(e) => e.key === 'Enter' && isCompleteTotpCode(code) && confirmEnrol()}
          />
          <div className="mt-4 flex gap-3">
            <button
              disabled={busy || !isCompleteTotpCode(code)}
              onClick={confirmEnrol}
              className="flex-1 rounded-xl bg-accent py-3 font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Verifying…' : 'Turn on two-factor'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                await supabase.auth.mfa.unenroll({ factorId: enrolling.factorId });
                setEnrolling(null);
                setCode('');
                await refresh();
              }}
              className="rounded-xl border border-line px-4 py-3 font-semibold text-ink2 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </section>
      ) : (
        <section className="mt-6 rounded-2xl border border-line bg-white p-6">
          <h2 className="font-bold">Authenticator apps</h2>
          {!loaded && <p className="mt-3 text-sm text-ink2">Loading…</p>}
          {loaded && factors.length === 0 && (
            <p className="mt-3 text-sm text-ink2">No authenticator app is set up on this account.</p>
          )}
          {factors.map((f) => (
            <div
              key={f.id}
              className="mt-3 flex items-center justify-between rounded-xl border border-line px-4 py-3"
            >
              <div>
                <div className="font-medium">{f.friendlyName}</div>
                <div className="text-sm text-ink2">
                  {f.verified ? 'Active' : 'Started but never confirmed'}
                </div>
              </div>
              <button
                disabled={busy}
                onClick={() => removeFactor(f.id)}
                className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-red disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            disabled={busy}
            onClick={startEnrol}
            className="mt-4 w-full rounded-xl bg-accent py-3 font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Starting…' : protectedNow ? 'Add another authenticator' : 'Set up authenticator app'}
          </button>
        </section>
      )}
    </main>
  );
}
