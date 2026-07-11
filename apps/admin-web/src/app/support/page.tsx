'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { SignOutButton } from '../SignOutButton';
import { useToast } from '../Toast';
import { Skeleton } from '../Skeleton';

type Phase =
  | { state: 'loading' }
  | { state: 'unauthorized' }
  | { state: 'ready'; displayName: string };

interface Msg {
  id: string;
  user_id: string;
  from_support: boolean;
  body: string;
  created_at: string;
  read_at: string | null;
}
interface Thread {
  user_id: string;
  user_name: string;
  last_body: string;
  last_at: string;
  unread: number;
}

/**
 * Admin support inbox — the reader/replier for the live support chat
 * (support_messages, mig 069). Lists threads (one per user), opens a thread,
 * and replies via reply_support_message (admin-only). Without this, users could
 * send support messages but no one could answer.
 */
export default function SupportInboxPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>({ state: 'loading' });
  const [threads, setThreads] = useState<Thread[]>([]);
  const [openUser, setOpenUser] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listEnd = useRef<HTMLDivElement>(null);

  const loadThreads = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    // Admin RLS allows reading all support_messages; group into threads client-side.
    const { data, error } = await supabase
      .from('support_messages')
      .select('id, user_id, from_support, body, created_at, read_at')
      .order('created_at', { ascending: false });
    if (error) {
      toast(error.message, 'error');
      return;
    }
    const rows = (data ?? []) as Msg[];
    const byUser = new Map<string, Thread>();
    for (const m of rows) {
      if (!byUser.has(m.user_id)) {
        byUser.set(m.user_id, {
          user_id: m.user_id,
          user_name: m.user_id.slice(0, 8),
          last_body: m.body,
          last_at: m.created_at,
          unread: 0,
        });
      }
      if (!m.from_support && !m.read_at) byUser.get(m.user_id)!.unread += 1;
    }
    // Resolve display names via an admin-gated definer RPC (mig 098): the only
    // SELECT policy on public.users is self-only, so a direct read here returns
    // just the admin's own row and every thread shows a UUID.
    const ids = [...byUser.keys()];
    if (ids.length) {
      const { data: users } = await supabase.rpc('admin_resolve_user_names', { p_ids: ids });
      for (const u of users ?? []) {
        const t = byUser.get(u.id as string);
        if (t) t.user_name = (u.display_name as string) || t.user_name;
      }
    }
    setThreads([...byUser.values()].sort((a, b) => b.last_at.localeCompare(a.last_at)));
  }, [toast]);

  const openThread = useCallback(
    async (userId: string) => {
      setOpenUser(userId);
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase
        .from('support_messages')
        .select('id, user_id, from_support, body, created_at, read_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });
      setMessages((data as Msg[]) ?? []);
      // Mark the user's inbound messages read (admin path).
      await supabase.rpc('mark_support_thread_read', { p_user_id: userId });
      await loadThreads();
      requestAnimationFrame(() => listEnd.current?.scrollIntoView());
    },
    [loadThreads],
  );

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
      await loadThreads();
      if (!cancelled) setPhase({ state: 'ready', displayName: me?.display_name ?? 'Admin' });
    })();
    return () => {
      cancelled = true;
    };
  }, [router, loadThreads]);

  const reply = async () => {
    if (!openUser || !draft.trim() || sending) return;
    setSending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.rpc('reply_support_message', { p_user_id: openUser, p_body: draft.trim() });
      if (error) throw error;
      setDraft('');
      await openThread(openUser);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Reply failed', 'error');
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
        <div className="mx-auto max-w-4xl space-y-3 p-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
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
          <p className="mt-2 text-ink2">Support inbox requires an admin account.</p>
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
            Sharm Eats <span className="text-accent">Support</span>
          </div>
          <div className="text-xs text-ink3">Customer messages · {phase.displayName}</div>
        </div>
        <div className="flex items-center gap-3">
          <a href="/" className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold hover:border-accent hover:text-accent">
            Dispatch
          </a>
          <SignOutButton />
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-4 p-6 md:grid-cols-[300px_1fr]">
        {/* Thread list */}
        <aside className="space-y-2">
          {threads.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-white p-6 text-center text-sm text-ink3">
              No support messages yet.
            </div>
          ) : (
            threads.map((t) => (
              <button
                key={t.user_id}
                onClick={() => openThread(t.user_id)}
                className={`w-full rounded-xl border p-3 text-left ${
                  openUser === t.user_id ? 'border-accent bg-accentSoft' : 'border-line bg-white'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{t.user_name}</span>
                  {t.unread > 0 && (
                    <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-white">{t.unread}</span>
                  )}
                </div>
                <div className="truncate text-xs text-ink3">{t.last_body}</div>
              </button>
            ))
          )}
        </aside>

        {/* Thread view */}
        <section className="rounded-2xl border border-line bg-white p-4">
          {!openUser ? (
            <div className="flex h-64 items-center justify-center text-ink3">Select a conversation.</div>
          ) : (
            <>
              <div className="mb-3 max-h-[50vh] space-y-2 overflow-y-auto">
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.from_support ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                        m.from_support ? 'bg-accent text-white' : 'border border-line bg-bg'
                      }`}
                    >
                      {m.body}
                    </div>
                  </div>
                ))}
                <div ref={listEnd} />
              </div>
              <div className="flex items-end gap-2 border-t border-line pt-3">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={2}
                  placeholder="Type a reply…"
                  className="flex-1 rounded-lg border border-line px-3 py-2 text-sm"
                />
                <button
                  onClick={reply}
                  disabled={sending || !draft.trim()}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  {sending ? '…' : 'Reply'}
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
