'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { SignOutButton } from '../SignOutButton';
import { useToast } from '../Toast';
import { Skeleton } from '../Skeleton';

const REQUIRED_DOCS = ['commercial_reg', 'tax_card', 'food_license'] as const;
const DOC_LABEL: Record<string, string> = {
  commercial_reg: 'Commercial reg',
  tax_card: 'Tax card',
  food_license: 'Food licence',
};

interface QueueRow {
  id: string;
  name: string;
  zone: string;
  phone: string | null;
  created_at: string;
  onboarding_status: 'submitted' | 'rejected';
  onboarding_rejection_reason: string | null;
  commission_pct: number;
  docs: Record<string, 'pending' | 'approved' | 'rejected' | 'missing'>;
  menuItems: number;
}

type Phase =
  | { state: 'loading' }
  | { state: 'unauthorized' }
  | { state: 'ready'; displayName: string };

/**
 * Restaurant onboarding approval queue — admin-only.
 *
 * Same client-side auth gate + Toast/Skeleton conventions as /kyc: admin only,
 * loads restaurants filtered by onboarding_status, joins kyc_documents +
 * menu_items client-side (mirrors /kyc's per-subject resolution pattern).
 * approve_restaurant / admin_set_commission (mig 123) do the real gating —
 * this UI only disables the button as a courtesy; the RPC is the source of truth.
 */
export default function OnboardingQueuePage() {
  const router = useRouter();
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>({ state: 'loading' });
  const [filter, setFilter] = useState<'submitted' | 'rejected'>('submitted');
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    const { data: restaurants, error } = await supabase
      .from('restaurants')
      .select(
        'id, name, zone, phone, created_at, onboarding_status, onboarding_rejection_reason, commission_pct',
      )
      .eq('onboarding_status', filter)
      .order('created_at', { ascending: true });
    if (error) {
      toast('Could not load queue', 'error');
      return;
    }
    const list = (restaurants ?? []) as Omit<QueueRow, 'docs' | 'menuItems'>[];
    const ids = list.map((r) => r.id);

    const [docsRes, itemsRes] = ids.length
      ? await Promise.all([
          supabase
            .from('kyc_documents')
            .select('subject_id, doc_type, status, created_at')
            .eq('subject_type', 'restaurant')
            .in('subject_id', ids),
          supabase.from('menu_items').select('restaurant_id').in('restaurant_id', ids),
        ])
      : [{ data: [] }, { data: [] }];

    setRows(
      list.map((r) => {
        const docs: QueueRow['docs'] = {};
        for (const t of REQUIRED_DOCS) docs[t] = 'missing';
        // latest doc per type wins
        const mine = (
          (docsRes.data ?? []) as {
            subject_id: string;
            doc_type: string;
            status: string;
            created_at: string;
          }[]
        )
          .filter((d) => d.subject_id === r.id)
          .sort((a, b) => a.created_at.localeCompare(b.created_at));
        for (const d of mine) {
          if ((REQUIRED_DOCS as readonly string[]).includes(d.doc_type)) {
            docs[d.doc_type] = d.status as 'pending' | 'approved' | 'rejected';
          }
        }
        const menuItems = ((itemsRes.data ?? []) as { restaurant_id: string }[]).filter(
          (m) => m.restaurant_id === r.id,
        ).length;
        return { ...r, docs, menuItems };
      }),
    );
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
      const { data: me } = await supabase
        .from('users')
        .select('role, display_name')
        .eq('id', session.user.id)
        .single();
      if ((me?.role as string | undefined) !== 'admin') {
        if (!cancelled) setPhase({ state: 'unauthorized' });
        return;
      }
      if (!cancelled) setPhase({ state: 'ready', displayName: me?.display_name ?? 'Admin' });
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (phase.state === 'ready') load();
  }, [phase.state, load]);

  async function decide(row: QueueRow, decision: 'approve' | 'reject') {
    const supabase = createSupabaseBrowserClient();
    let reason: string | null = null;
    if (decision === 'reject') {
      reason = window.prompt(`Reason for rejecting ${row.name} (shown to the merchant):`);
      if (!reason?.trim()) return;
    } else if (
      !window.confirm(
        `Approve ${row.name}? It becomes visible to customers (closed until the owner opens).`,
      )
    ) {
      return;
    }
    setBusyId(row.id);
    const { error } = await supabase.rpc('approve_restaurant', {
      p_restaurant_id: row.id,
      p_decision: decision,
      p_reason: reason,
    });
    setBusyId(null);
    if (error) {
      const m = error.message;
      toast(
        m.includes('KYC_INCOMPLETE')
          ? 'Blocked: 3 approved KYC docs required.'
          : m.includes('MENU_EMPTY')
            ? 'Blocked: seed the menu first.'
            : m.includes('REASON_REQUIRED')
              ? 'A rejection reason is required.'
              : `Failed: ${m}`,
        'error',
      );
      return;
    }
    toast(decision === 'approve' ? `${row.name} is live` : `${row.name} rejected`, 'success');
    load();
  }

  async function setCommission(row: QueueRow) {
    const raw = window.prompt(`Commission % for ${row.name}:`, String(row.commission_pct));
    if (raw === null) return;
    const pct = Number(raw);
    if (!Number.isFinite(pct) || pct < 0 || pct > 50) {
      toast('Enter 0–50', 'error');
      return;
    }
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.rpc('admin_set_commission', {
      p_restaurant_id: row.id,
      p_pct: pct,
    });
    if (error) {
      toast(`Failed: ${error.message}`, 'error');
      return;
    }
    toast('Commission updated', 'success');
    load();
  }

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
          <p className="mt-2 text-ink2">Restaurant onboarding requires an admin account.</p>
          <div className="mt-6 flex justify-center gap-3">
            <Link href="/" className="rounded-lg border border-line px-4 py-2 text-sm font-semibold">
              Back to dispatch
            </Link>
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
            Sharm Eats <span className="text-accent">Onboarding</span>
          </div>
          <div className="text-xs text-ink3">Restaurant approval queue · {phase.displayName}</div>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold hover:border-accent hover:text-accent"
          >
            Dispatch
          </Link>
          <SignOutButton />
        </div>
      </header>

      <div className="mx-auto max-w-4xl space-y-5 p-6">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilter('submitted')}
            className={`rounded-lg px-3.5 py-2 text-sm font-semibold ${
              filter === 'submitted' ? 'bg-accent text-white' : 'border border-line'
            }`}
          >
            Submitted
          </button>
          <button
            onClick={() => setFilter('rejected')}
            className={`rounded-lg px-3.5 py-2 text-sm font-semibold ${
              filter === 'rejected' ? 'bg-accent text-white' : 'border border-line'
            }`}
          >
            Rejected
          </button>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-white p-10 text-center text-ink3">
            Queue is empty.
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((row) => {
              const docsOk = REQUIRED_DOCS.every((t) => row.docs[t] === 'approved');
              const canApprove = docsOk && row.menuItems > 0;
              return (
                <li key={row.id} className="rounded-2xl border border-line bg-white p-4 text-sm">
                  <div className="flex items-center justify-between">
                    <p className="font-extrabold">{row.name}</p>
                    <p className="text-ink2">{new Date(row.created_at).toLocaleDateString()}</p>
                  </div>
                  <p className="text-ink2">
                    {row.zone} · {row.phone ?? 'no phone'}
                  </p>
                  {row.onboarding_rejection_reason && (
                    <p className="mt-1 text-red-600">
                      Rejected: {row.onboarding_rejection_reason}
                    </p>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {REQUIRED_DOCS.map((t) => (
                      <span
                        key={t}
                        className={`rounded-full border px-2 py-0.5 text-xs ${
                          row.docs[t] === 'approved'
                            ? 'border-green-500 text-green-700'
                            : row.docs[t] === 'rejected'
                              ? 'border-red-500 text-red-700'
                              : 'text-ink2'
                        }`}
                      >
                        {DOC_LABEL[t]}: {row.docs[t]}
                      </span>
                    ))}
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs ${
                        row.menuItems > 0 ? 'border-green-500 text-green-700' : 'text-ink2'
                      }`}
                    >
                      menu: {row.menuItems} items
                    </span>
                    <button
                      className="rounded-full border border-line px-2 py-0.5 text-xs font-semibold underline"
                      onClick={() => setCommission(row)}
                    >
                      commission: {row.commission_pct}%
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      className="rounded-lg border border-line px-3 py-1.5 text-xs font-bold hover:border-accent hover:text-accent"
                      href="/kyc"
                    >
                      Review docs
                    </Link>
                    <Link
                      className="rounded-lg border border-line px-3 py-1.5 text-xs font-bold hover:border-accent hover:text-accent"
                      href={`/menu?restaurant=${row.id}`}
                    >
                      Seed menu
                    </Link>
                    <button
                      className="rounded-lg bg-ink px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
                      disabled={!canApprove || busyId === row.id}
                      title={canApprove ? '' : 'Needs 3 approved docs + a seeded menu'}
                      onClick={() => decide(row, 'approve')}
                    >
                      {busyId === row.id ? '…' : 'Approve & go live'}
                    </button>
                    <button
                      className="rounded-lg border border-red-400 px-3 py-1.5 text-xs font-bold text-red-600 disabled:opacity-40"
                      disabled={busyId === row.id}
                      onClick={() => decide(row, 'reject')}
                    >
                      Reject
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
