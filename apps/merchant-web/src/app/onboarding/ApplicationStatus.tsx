'use client';

/**
 * The merchant's home while their application is under review (submitted) or
 * after a rejection. Checklist: submitted ✓ → 3 KYC docs → menu (ops-seeded) →
 * go-live. Doc statuses refetch on upload and every 30s (cheap poll — the page
 * is only ever open pre-launch, realtime channel not worth it here).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type { StaffOnboardingRow } from '@/lib/onboarding';
import {
  type KycDocument, RESTAURANT_DOC_TYPES, listMyKycDocuments, uploadKycDocument,
} from '@/lib/kyc';
import { SignOutButton } from '../SignOutButton';

export function ApplicationStatus({
  staff, phase,
}: { staff: StaffOnboardingRow; phase: 'submitted' | 'rejected' }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [docs, setDocs] = useState<KycDocument[] | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setDocs(await listMyKycDocuments(supabase, staff.restaurant_id));
      // Auto-advance: when admin approves (or the status otherwise leaves
      // submitted/rejected), reload so the root page re-routes to the dashboard.
      const { data } = await supabase
        .from('restaurants')
        .select('onboarding_status')
        .eq('id', staff.restaurant_id)
        .single();
      const s = (data as { onboarding_status: string } | null)?.onboarding_status;
      if (s && s !== 'submitted' && s !== 'rejected') window.location.reload();
    } catch {
      setError('Could not load your documents — pull to refresh or try again shortly.');
    }
  }, [supabase, staff.restaurant_id]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  // Latest doc per type wins (re-uploads supersede).
  const latestByType = new Map<string, KycDocument>();
  for (const d of docs ?? []) {
    const prev = latestByType.get(d.doc_type);
    if (!prev || d.created_at > prev.created_at) latestByType.set(d.doc_type, d);
  }
  const approvedCount = RESTAURANT_DOC_TYPES
    .filter((t) => latestByType.get(t.key)?.status === 'approved').length;

  async function onPick(docType: string, file: File | undefined) {
    if (!file) return;
    setUploading(docType);
    setError(null);
    try {
      await uploadKycDocument(supabase, staff.restaurant_id, docType, file);
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed — try again.');
    } finally {
      setUploading(null);
    }
  }

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold">{staff.restaurants.name}</h1>
        <SignOutButton />
      </div>

      {phase === 'rejected' && (
        <div className="rounded-xl border border-red bg-redsoft p-4 text-sm">
          <p className="font-bold text-red">Your application was not approved.</p>
          <p className="mt-1">{staff.restaurants.onboarding_rejection_reason ?? 'Contact support for details.'}</p>
          <p className="mt-2 text-ink2">Fix the documents below and our team will take another look, or email partners@sharmeats.online.</p>
        </div>
      )}

      <ol className="flex flex-col gap-3">
        <li className="rounded-xl border border-line p-4 text-sm">
          ✅ <span className="font-bold">Application submitted</span> — we&apos;ve got your details.
        </li>

        <li className="rounded-xl border border-line p-4 text-sm">
          <p className="font-bold">
            {approvedCount === 3 ? '✅' : '⬜'} Business documents ({approvedCount}/3 approved)
          </p>
          {docs === null ? (
            <p className="mt-2 text-ink2">Loading…</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {RESTAURANT_DOC_TYPES.map((t) => {
                const doc = latestByType.get(t.key);
                return (
                  <li key={t.key} className="flex items-center justify-between gap-2">
                    <span>
                      {t.label} <span className="text-ink2">({t.hint})</span>
                      {doc?.status === 'approved' && ' ✅'}
                      {doc?.status === 'pending' && ' ⏳ under review'}
                      {doc?.status === 'rejected' && (
                        <span className="text-red"> ❌ {doc.review_note ?? 'rejected — re-upload'}</span>
                      )}
                    </span>
                    {doc?.status !== 'approved' && (
                      <label className="shrink-0 cursor-pointer rounded-lg border border-line px-3 py-1 font-bold">
                        {uploading === t.key ? 'Uploading…' : doc ? 'Re-upload' : 'Upload'}
                        <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                          disabled={uploading !== null}
                          onChange={(e) => onPick(t.key, e.target.files?.[0])} />
                      </label>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </li>

        <li className="rounded-xl border border-line p-4 text-sm">
          ⬜ <span className="font-bold">Menu setup</span> — our team builds your menu with you
          after document review. Have your menu (with prices) ready.
        </li>

        <li className="rounded-xl border border-line p-4 text-sm">
          ⬜ <span className="font-bold">Go live</span> — once approved, you&apos;ll manage orders
          right here and flip yourself Open when ready.
        </li>
      </ol>

      {error && <p className="rounded-lg bg-redsoft px-3 py-2 text-sm text-red">{error}</p>}
    </main>
  );
}
