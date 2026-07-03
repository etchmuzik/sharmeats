'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { SignOutButton } from '../SignOutButton';
import { useToast } from '../Toast';
import { Skeleton } from '../Skeleton';

type Phase =
  | { state: 'loading' }
  | { state: 'unauthorized' }
  | { state: 'ready'; displayName: string };

interface KycDoc {
  id: string;
  subject_type: 'driver' | 'restaurant';
  subject_id: string;
  doc_type: string;
  storage_path: string;
  status: 'pending' | 'approved' | 'rejected';
  review_note: string | null;
  created_at: string;
  subject_name: string;
  signed_url: string | null;
}

const DOC_LABEL: Record<string, string> = {
  national_id: 'National ID',
  driving_license: 'Driving licence',
  vehicle_reg: 'Vehicle registration',
  commercial_reg: 'Commercial registration',
  tax_card: 'Tax card',
  food_license: 'Food licence',
};

export default function KycReviewPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>({ state: 'loading' });
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [docs, setDocs] = useState<KycDoc[]>([]);

  const loadDocs = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    let query = supabase
      .from('kyc_documents')
      .select('*')
      .order('created_at', { ascending: true });
    if (filter === 'pending') query = query.eq('status', 'pending');
    const { data, error } = await query;
    if (error) {
      toast(error.message, 'error');
      return;
    }
    // Resolve subject name + a short-lived signed URL for each file.
    const rows = (data ?? []) as Omit<KycDoc, 'subject_name' | 'signed_url'>[];
    const resolved = await Promise.all(
      rows.map(async (r) => {
        let subject_name = r.subject_id;
        if (r.subject_type === 'driver') {
          const { data: d } = await supabase.from('drivers').select('name').eq('id', r.subject_id).single();
          subject_name = d?.name ?? r.subject_id;
        } else {
          const { data: rest } = await supabase.from('restaurants').select('name').eq('id', r.subject_id).single();
          subject_name = rest?.name ?? r.subject_id;
        }
        const { data: signed } = await supabase.storage.from('kyc').createSignedUrl(r.storage_path, 300);
        return { ...r, subject_name, signed_url: signed?.signedUrl ?? null };
      }),
    );
    setDocs(resolved);
  }, [filter, toast]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace('/login');
        return;
      }
      const { data: me } = await supabase.from('users').select('role, display_name').eq('id', session.user.id).single();
      if ((me?.role as string | undefined) !== 'admin') {
        if (!cancelled) setPhase({ state: 'unauthorized' });
        return;
      }
      await loadDocs();
      if (!cancelled) setPhase({ state: 'ready', displayName: me?.display_name ?? 'Admin' });
    })();
    return () => {
      cancelled = true;
    };
  }, [router, loadDocs]);

  const review = async (id: string, approve: boolean) => {
    const note = approve ? null : window.prompt('Reason for rejection (shown to the applicant):') ?? '';
    if (!approve && note === '') return; // cancelled the prompt
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.rpc('review_kyc_document', {
      p_document_id: id,
      p_approve: approve,
      p_note: note,
    });
    if (error) {
      toast(error.message, 'error');
      return;
    }
    toast(approve ? 'Approved' : 'Rejected', 'success');
    await loadDocs();
  };

  if (phase.state === 'loading') {
    return (
      <main className="min-h-screen bg-bg">
        <header className="flex items-center justify-between border-b border-line bg-white px-6 py-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-8 w-20" />
        </header>
        <div className="mx-auto max-w-4xl space-y-3 p-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </main>
    );
  }

  if (phase.state === 'unauthorized') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg px-4 text-center">
        <div className="max-w-md">
          <h1 className="text-xl font-bold">Admin only</h1>
          <p className="mt-2 text-ink2">KYC review requires an admin account.</p>
          <div className="mt-6 flex justify-center gap-3">
            <a href="/" className="rounded-lg border border-line px-4 py-2 text-sm font-semibold">
              Back to dispatch
            </a>
            <SignOutButton />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-white/90 px-6 py-4 backdrop-blur">
        <div>
          <div className="text-lg font-extrabold">
            Sharm Eats <span className="text-accent">KYC</span>
          </div>
          <div className="text-xs text-ink3">Document review · {phase.displayName}</div>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/"
            className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold hover:border-accent hover:text-accent"
          >
            Dispatch
          </a>
          <SignOutButton />
        </div>
      </header>

      <div className="mx-auto max-w-4xl space-y-5 p-6">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilter('pending')}
            className={`rounded-lg px-3.5 py-2 text-sm font-semibold ${
              filter === 'pending' ? 'bg-accent text-white' : 'border border-line'
            }`}
          >
            Pending
          </button>
          <button
            onClick={() => setFilter('all')}
            className={`rounded-lg px-3.5 py-2 text-sm font-semibold ${
              filter === 'all' ? 'bg-accent text-white' : 'border border-line'
            }`}
          >
            All
          </button>
        </div>

        {docs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-white p-10 text-center text-ink3">
            {filter === 'pending' ? 'No documents awaiting review. 🎉' : 'No documents yet.'}
          </div>
        ) : (
          <div className="space-y-3">
            {docs.map((d) => (
              <div key={d.id} className="rounded-2xl border border-line bg-white p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-bold">
                      {d.subject_name}{' '}
                      <span className="text-xs font-normal text-ink3">({d.subject_type})</span>
                    </div>
                    <div className="text-sm text-ink2">{DOC_LABEL[d.doc_type] ?? d.doc_type}</div>
                    {d.review_note && <div className="mt-1 text-xs text-ink3">Note: {d.review_note}</div>}
                  </div>
                  <span
                    className={
                      'rounded-full px-2.5 py-1 text-xs font-bold ' +
                      (d.status === 'approved'
                        ? 'bg-green-100 text-green-700'
                        : d.status === 'rejected'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-700')
                    }
                  >
                    {d.status}
                  </span>
                </div>

                {d.signed_url && (
                  <a href={d.signed_url} target="_blank" rel="noreferrer" className="mt-3 block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={d.signed_url}
                      alt={d.doc_type}
                      className="max-h-64 rounded-lg border border-line object-contain"
                    />
                  </a>
                )}

                {d.status === 'pending' && (
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => review(d.id, true)}
                      className="rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => review(d.id, false)}
                      className="rounded-lg border border-red-300 px-4 py-2 text-sm font-bold text-red-600"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
