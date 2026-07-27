'use client';

import Link from "next/link";
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

type DeliveryStatus = 'dispatched' | 'delivered' | 'failed' | 'not_attempted';

interface Campaign {
  id: string;
  title: string;
  body: string;
  segment: string;
  segment_param: string | null;
  recipients: number;
  created_at: string;
  // Added by mig 137. `recipients` is the segment size resolved BEFORE sending
  // and cannot report failure — it used to be labelled "sent", which is how
  // every campaign silently failing to deliver went unnoticed. Read the status.
  delivery_status?: DeliveryStatus | null;
  delivery_detail?: string | null;
  // Added by mig 138: matched the segment but had not opted in to marketing
  // (or were inside quiet hours). Surfaced so a smaller audience reads as
  // consent working, not as a broken segment.
  suppressed_count?: number | null;
}

const DELIVERY_LABEL: Record<DeliveryStatus, { text: string; tone: string }> = {
  delivered: { text: 'Delivered', tone: '#0a7c42' },
  dispatched: { text: 'Sending…', tone: '#8a6d00' },
  failed: { text: 'Failed', tone: '#b3261e' },
  not_attempted: { text: 'Not sent', tone: '#5f6368' },
};

const SEGMENTS = [
  { key: 'all', label: 'All customers', needsParam: false },
  { key: 'lapsed', label: 'Lapsed (no order in N days)', needsParam: true, paramLabel: 'Days', paramPlaceholder: '30' },
  { key: 'never_ordered', label: 'Signed up, never ordered', needsParam: false },
  { key: 'zone', label: 'By delivery zone', needsParam: true, paramLabel: 'Zone id', paramPlaceholder: 'naama' },
] as const;

export default function CampaignsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>({ state: 'loading' });
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [segment, setSegment] = useState<string>('all');
  const [param, setParam] = useState('');
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<Campaign[]>([]);

  const loadHistory = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase.rpc('recent_push_campaigns', { p_limit: 20 });
    if (error) {
      toast(error.message, 'error');
      return;
    }
    setHistory((data as Campaign[]) ?? []);
  }, [toast]);

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
      await loadHistory();
      if (!cancelled) setPhase({ state: 'ready', displayName: me?.display_name ?? 'Admin' });
    })();
    return () => {
      cancelled = true;
    };
  }, [router, loadHistory]);

  const send = async () => {
    if (!title.trim() || !body.trim()) {
      toast('Add a title and message first.', 'error');
      return;
    }
    if (!window.confirm(`Send this push to the “${segment}” segment now?`)) return;
    setSending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.rpc('send_push_campaign', {
        p_title: title.trim(),
        p_body: body.trim(),
        p_segment: segment,
        p_segment_param: param.trim() || null,
      });
      if (error) throw error;
      // The RPC returns the RESOLVED segment size, not a delivery count — the
      // push is dispatched asynchronously and settled by a cron a few minutes
      // later. Saying "sent" here is what hid a total delivery outage before
      // (mig 137), so point the operator at the status instead.
      const n = data ?? 0;
      toast(
        n === 0
          ? 'No customers in that segment have a push token — nothing was sent.'
          : `Queued for ${n} customer(s). Delivery status appears below within ~5 min.`,
        n === 0 ? 'error' : 'success',
      );
      setTitle('');
      setBody('');
      setParam('');
      await loadHistory();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Send failed', 'error');
    } finally {
      setSending(false);
    }
  };

  if (phase.state === 'loading') {
    return (
      <main className="min-h-screen bg-bg">
        <header className="flex items-center justify-between border-b border-line bg-white px-6 py-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-8 w-20" />
        </header>
        <div className="mx-auto max-w-3xl space-y-3 p-6">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </main>
    );
  }

  if (phase.state === 'unauthorized') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg px-4 text-center">
        <div className="max-w-md">
          <h1 className="text-xl font-bold">Admin only</h1>
          <p className="mt-2 text-ink2">Push campaigns require an admin account.</p>
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

  const seg = SEGMENTS.find((s) => s.key === segment);

  return (
    <main className="min-h-screen bg-bg">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-white/90 px-6 py-4 backdrop-blur">
        <div>
          <div className="text-lg font-extrabold">
            Sharm Eats <span className="text-accent">Campaigns</span>
          </div>
          <div className="text-xs text-ink3">Push notifications · {phase.displayName}</div>
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

      <div className="mx-auto max-w-3xl space-y-6 p-6">
        {/* Composer */}
        <section className="space-y-4 rounded-2xl border border-line bg-white p-5">
          <div>
            <label className="mb-1 block text-sm font-semibold text-ink2">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
              placeholder="Craving koshary? 🍲"
              className="w-full rounded-lg border border-line px-3 py-2"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-ink2">Message</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={180}
              rows={3}
              placeholder="Your favourites are one tap away. 20% off your next order today."
              className="w-full rounded-lg border border-line px-3 py-2"
            />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-sm font-semibold text-ink2">Audience</label>
              <select
                value={segment}
                onChange={(e) => {
                  setSegment(e.target.value);
                  setParam('');
                }}
                className="rounded-lg border border-line px-3 py-2"
              >
                {SEGMENTS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            {seg?.needsParam && (
              <div>
                <label className="mb-1 block text-sm font-semibold text-ink2">{seg.paramLabel}</label>
                <input
                  value={param}
                  onChange={(e) => setParam(e.target.value)}
                  placeholder={seg.paramPlaceholder}
                  className="w-28 rounded-lg border border-line px-3 py-2"
                />
              </div>
            )}
            <button
              onClick={send}
              disabled={sending}
              className="rounded-lg bg-accent px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Send push'}
            </button>
          </div>
          <p className="text-xs text-ink3">
            Only reaches customers who <strong>opted in to promotions</strong> and are outside their
            quiet hours — enforced server-side, so the count below may be far smaller than the
            segment. Promotions are opt-in, so that number starts near zero and grows as customers
            turn them on. Sends immediately — there’s no undo.
          </p>
        </section>

        {/* History */}
        <section>
          <h2 className="mb-3 text-sm font-bold text-ink2">Recent campaigns</h2>
          {history.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-white p-8 text-center text-ink3">
              No campaigns sent yet.
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((c) => (
                <div key={c.id} className="rounded-xl border border-line bg-white p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-bold">{c.title}</div>
                      <div className="text-sm text-ink2">{c.body}</div>
                    </div>
                    <div className="text-right text-xs text-ink3">
                      {/* "{n} recipients" is the segment size resolved before
                          sending — deliberately NOT called "sent", because it
                          is written pre-send and cannot reflect a failure.
                          delivery_status carries the real outcome (mig 137). */}
                      <div className="font-semibold text-ink2">{c.recipients} recipients</div>
                      {c.suppressed_count ? (
                        <div title="Matched the segment but have not opted in to marketing, or were in quiet hours.">
                          {c.suppressed_count} opted out
                        </div>
                      ) : null}
                      {c.delivery_status ? (
                        <div
                          className="font-semibold"
                          style={{ color: DELIVERY_LABEL[c.delivery_status]?.tone ?? '#5f6368' }}
                          title={c.delivery_detail ?? undefined}
                        >
                          {DELIVERY_LABEL[c.delivery_status]?.text ?? c.delivery_status}
                        </div>
                      ) : null}
                      <div>
                        {c.segment}
                        {c.segment_param ? ` · ${c.segment_param}` : ''}
                      </div>
                      <div>{new Date(c.created_at).toLocaleString()}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
