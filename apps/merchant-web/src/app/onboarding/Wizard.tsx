'use client';

/**
 * 4-step onboarding wizard. Draft lives in localStorage (survives refresh);
 * the DB is touched exactly once, at final submit (apply_as_restaurant).
 */
import { useEffect, useMemo, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { applyAsRestaurant, rpcErrorToCopy } from '@/lib/onboarding';
import {
  type WizardDraft, emptyDraft, loadDraft, saveDraft, clearDraft, validateStep, draftToApplication,
} from '@/lib/wizardDraft';

const CUISINES = [
  'italian','seafood','egyptian','sushi','healthy','burgers','cafe','asian',
  'pizza','breakfast','late_night','street_food','sweets',
]; // food verticals only — grocery/pharmacy onboard via ops for now

interface Zone { id: string; name_en: string }

export function Wizard({ onSubmitted }: { onSubmitted: () => void }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  // Start empty and hydrate from localStorage on mount — `window` is not
  // available during Next.js static-export prerendering, so it must never be
  // touched in a useState initializer.
  const [draft, setDraft] = useState<WizardDraft>(emptyDraft);
  const [hydrated, setHydrated] = useState(false);
  const [zones, setZones] = useState<Zone[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    setDraft(loadDraft(window.localStorage));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveDraft(window.localStorage, draft);
  }, [draft, hydrated]);

  useEffect(() => {
    supabase.from('zones').select('id,name_en').eq('is_active', true)
      .then(({ data }) => setZones((data as Zone[]) ?? []));
  }, [supabase]);

  const set = (patch: Partial<WizardDraft>) => setDraft((d) => ({ ...d, ...patch }));

  function next() {
    const problem = validateStep(step, draft);
    if (problem) return setError(problem);
    setError(null);
    setStep((s) => (s < 4 ? ((s + 1) as 2 | 3 | 4) : s));
  }

  function useMyLocation() {
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        set({ lat: Number(pos.coords.latitude.toFixed(6)), lng: Number(pos.coords.longitude.toFixed(6)) });
      },
      () => {
        setLocating(false);
        setError('Could not read your location — enter coordinates manually.');
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function submit() {
    const problem = validateStep(4, draft);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      await applyAsRestaurant(supabase, draftToApplication(draft));
      clearDraft(window.localStorage);
      onSubmitted();
    } catch (e: unknown) {
      setError(rpcErrorToCopy(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-extrabold text-ink">Tell us about your restaurant</h1>
      <p className="text-sm text-ink2">Step {step} of 4</p>

      {step === 1 && (
        <section className="flex flex-col gap-3">
          <input className="rounded-xl border border-line px-4 py-3 outline-none focus:border-accent" placeholder="Restaurant name"
            value={draft.name} onChange={(e) => set({ name: e.target.value })} />
          <textarea className="rounded-xl border border-line px-4 py-3 outline-none focus:border-accent" placeholder="Short description"
            value={draft.description} onChange={(e) => set({ description: e.target.value })} />
          <div className="flex flex-wrap gap-2">
            {CUISINES.map((c) => (
              <button key={c} type="button"
                className={`rounded-full border border-line px-3 py-1 text-sm ${draft.cuisines.includes(c) ? 'bg-ink text-white' : 'text-ink2'}`}
                onClick={() => set({
                  cuisines: draft.cuisines.includes(c)
                    ? draft.cuisines.filter((x) => x !== c)
                    : [...draft.cuisines, c],
                })}>
                {c.replace('_', ' ')}
              </button>
            ))}
          </div>
          <input className="rounded-xl border border-line px-4 py-3 outline-none focus:border-accent" placeholder="Contact phone (+20…)"
            value={draft.phone} onChange={(e) => set({ phone: e.target.value })} />
          <input className="rounded-xl border border-line px-4 py-3 outline-none focus:border-accent" placeholder="Street address"
            value={draft.address} onChange={(e) => set({ address: e.target.value })} />
          <label className="flex items-center gap-2 text-sm text-ink2">
            <input type="checkbox" checked={draft.isOpen24h}
              onChange={(e) => set({ isOpen24h: e.target.checked })} />
            Open 24 hours
          </label>
        </section>
      )}

      {step === 2 && (
        <section className="flex flex-col gap-3">
          <select className="rounded-xl border border-line px-4 py-3 outline-none focus:border-accent" value={draft.zone}
            onChange={(e) => set({ zone: e.target.value })}>
            <option value="">Delivery zone…</option>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.name_en}</option>)}
          </select>
          <button type="button" className="rounded-xl border border-line px-4 py-3 font-semibold text-ink disabled:opacity-50"
            onClick={useMyLocation} disabled={locating}>
            {locating ? 'Locating…' : '📍 Use my current location'}
          </button>
          <div className="flex gap-2">
            <input className="w-1/2 rounded-xl border border-line px-4 py-3 outline-none focus:border-accent" type="number" step="0.000001"
              placeholder="Latitude" value={draft.lat ?? ''}
              onChange={(e) => set({ lat: e.target.value === '' ? null : Number(e.target.value) })} />
            <input className="w-1/2 rounded-xl border border-line px-4 py-3 outline-none focus:border-accent" type="number" step="0.000001"
              placeholder="Longitude" value={draft.lng ?? ''}
              onChange={(e) => set({ lng: e.target.value === '' ? null : Number(e.target.value) })} />
          </div>
          <p className="text-xs text-ink2">Stand at the restaurant and tap the button — or paste coordinates from Google Maps.</p>
        </section>
      )}

      {step === 3 && (
        <section className="flex flex-col gap-3">
          <div className="flex gap-2">
            {(['bank', 'wallet'] as const).map((m) => (
              <button key={m} type="button"
                className={`rounded-xl border border-line px-4 py-2 font-semibold ${draft.payoutMethod === m ? 'bg-ink text-white' : 'text-ink2'}`}
                onClick={() => set({ payoutMethod: m })}>
                {m === 'bank' ? 'Bank transfer' : 'Mobile wallet'}
              </button>
            ))}
          </div>
          {draft.payoutMethod === 'bank' ? (
            <>
              <input className="rounded-xl border border-line px-4 py-3 outline-none focus:border-accent" placeholder="Bank name"
                value={draft.payoutBankName} onChange={(e) => set({ payoutBankName: e.target.value })} />
              <input className="rounded-xl border border-line px-4 py-3 outline-none focus:border-accent" placeholder="IBAN"
                value={draft.payoutIban} onChange={(e) => set({ payoutIban: e.target.value })} />
            </>
          ) : (
            <input className="rounded-xl border border-line px-4 py-3 outline-none focus:border-accent" placeholder="Wallet number (+20…)"
              value={draft.payoutWallet} onChange={(e) => set({ payoutWallet: e.target.value })} />
          )}
          <input className="rounded-xl border border-line px-4 py-3 outline-none focus:border-accent" placeholder="Account holder name"
            value={draft.payoutHolder} onChange={(e) => set({ payoutHolder: e.target.value })} />
          <p className="text-xs text-ink2">Weekly settlement — see your statement any time in the dashboard.</p>
        </section>
      )}

      {step === 4 && (
        <section className="flex flex-col gap-3">
          <div className="rounded-xl border border-line p-4 text-sm">
            <p className="font-bold text-ink">{draft.name}</p>
            <p className="text-ink2">{draft.zone} · {draft.phone}</p>
            <p className="mt-2 text-ink">
              Standard commission: <span className="font-extrabold">15%</span> of food value.
              Delivery fees go to drivers. No signup or monthly fee.
            </p>
          </div>
          <label className="flex items-start gap-2 text-sm text-ink2">
            <input type="checkbox" checked={draft.termsAccepted}
              onChange={(e) => set({ termsAccepted: e.target.checked })} />
            <span>
              {/* TODO: dedicated partner-terms page — see PR description */}
              I accept the <a className="font-medium text-accent hover:underline" href="https://sharmeats.online/terms" target="_blank" rel="noopener noreferrer">partner terms</a> on behalf of this business.
            </span>
          </label>
        </section>
      )}

      {error && <p className="rounded-lg bg-redsoft px-3 py-2 text-sm text-red">{error}</p>}

      <div className="flex justify-between">
        <button type="button" className="rounded-xl border border-line px-4 py-3 text-ink2 disabled:opacity-40"
          disabled={step === 1 || busy} onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s))}>
          Back
        </button>
        {step < 4 ? (
          <button type="button" className="rounded-xl bg-accent px-6 py-3 font-semibold text-white" onClick={next}>
            Continue
          </button>
        ) : (
          <button type="button" className="rounded-xl bg-accent px-6 py-3 font-semibold text-white disabled:opacity-50"
            disabled={busy} onClick={submit}>
            {busy ? 'Submitting…' : 'Submit application'}
          </button>
        )}
      </div>
    </main>
  );
}
