'use client';

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { safeDisplayError } from '@/lib/displayError';
import { SignOutButton } from '../SignOutButton';
import { useToast } from '../Toast';
import { Skeleton } from '../Skeleton';
import {
  realtimeStatusAction,
  resolveAdminOnlyAccess,
  uniqueRealtimeChannelName,
} from '@/lib/webState';

type Phase =
  | { state: 'loading' }
  | { state: 'unauthorized' }
  | { state: 'error' }
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
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [threadError, setThreadError] = useState(false);
  const [threadListError, setThreadListError] = useState(false);
  const [realtimeState, setRealtimeState] = useState<
    'connecting' | 'connected' | 'reconnecting' | 'error'
  >('connecting');
  const [reloadKey, setReloadKey] = useState(0);
  const [realtimeRetryKey, setRealtimeRetryKey] = useState(0);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listEnd = useRef<HTMLDivElement>(null);
  // The realtime subscription must not tear down and rebuild every time an
  // agent opens a different thread, so the open user is read through a ref
  // rather than being a dependency of the effect.
  const openUserRef = useRef<string | null>(null);
  openUserRef.current = openUser;

  const loadThreads = useCallback(async (notifyOnError = true): Promise<boolean> => {
    const supabase = createSupabaseBrowserClient();
    // Admin RLS allows reading all support_messages; group into threads client-side.
    const { data, error } = await supabase
      .from('support_messages')
      .select('id, user_id, from_support, body, created_at, read_at')
      .order('created_at', { ascending: false });
    if (error) {
      setThreadListError(true);
      if (notifyOnError) {
        toast(safeDisplayError(error, { fallback: 'Could not load support conversations. Please try again.' }), 'error');
      }
      return false;
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
    setThreadListError(false);
    return true;
  }, [toast]);

  const openThread = useCallback(
    // `silent` refreshes an already-open thread in place. Opening a thread
    // should show a skeleton, but re-reading it after sending a reply must not
    // unmount the message list and composer: that drops keyboard focus on the
    // hot path, and a failed refresh would replace the composer with an error
    // block even though the reply was delivered.
    async (userId: string, opts?: { silent?: boolean }) => {
      setOpenUser(userId);
      if (!opts?.silent) {
        setMessagesLoading(true);
        setThreadError(false);
      }
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase
        .from('support_messages')
        .select('id, user_id, from_support, body, created_at, read_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });
      if (error) {
        if (!opts?.silent) setThreadError(true);
        setMessagesLoading(false);
        toast(safeDisplayError(error, { fallback: 'Could not load this conversation. Please try again.' }), 'error');
        return;
      }
      setMessages((data as Msg[]) ?? []);
      setMessagesLoading(false);
      // Mark the user's inbound messages read (admin path).
      await supabase.rpc('mark_support_thread_read', { p_user_id: userId });
      await loadThreads();
      requestAnimationFrame(() => listEnd.current?.scrollIntoView());
    },
    [loadThreads, toast],
  );

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let cancelled = false;
    (async () => {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (sessionError) {
        setPhase({ state: 'error' });
        return;
      }
      if (!session) {
        router.replace('/login');
        return;
      }
      const { data: me, error: meError } = await supabase
        .from('users')
        .select('role, display_name')
        .eq('id', session.user.id)
        .single();
      if (cancelled) return;
      const access = resolveAdminOnlyAccess({
        data: me as { role: string | null; display_name: string | null } | null,
        error: meError,
      });
      if (access.state !== 'allowed') {
        setPhase({ state: access.state });
        return;
      }
      const loaded = await loadThreads(false);
      if (!cancelled) {
        setPhase(loaded ? { state: 'ready', displayName: access.displayName } : { state: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, loadThreads, reloadKey]);

  // Live inbound messages. support_messages is realtime-published with replica
  // identity full precisely for this (mig 069), but only the customer end
  // subscribed — an agent sitting on the inbox never saw a new message or a new
  // thread until they re-opened a thread or reloaded, so "live support chat"
  // was live in one direction only.
  //
  // Gated on 'ready' so it never runs for an unauthorized viewer, and rebuilt
  // only on that transition (the open thread is read via ref).
  useEffect(() => {
    if (phase.state !== 'ready') return;
    const supabase = createSupabaseBrowserClient();
    let active = true;
    setRealtimeState('connecting');
    const name = uniqueRealtimeChannelName('admin:support:inbox');
    const channel = supabase
      .channel(name)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'support_messages' },
        (payload) => {
          if (!active) return;
          const row = payload.new as Msg;
          if (!row?.id) return;
          // Not the thread on screen: just refresh the list (new thread, new
          // preview, unread count).
          if (row.user_id !== openUserRef.current) {
            void loadThreads();
            return;
          }
          // On-screen thread: append rather than re-running openThread, which
          // would reload the whole message list on every keystroke-speed
          // insert. An agent's own reply already refreshed via reply().
          setMessages((prev) =>
            prev.some((m) => m.id === row.id) ? prev : [...prev, row],
          );
          requestAnimationFrame(() => listEnd.current?.scrollIntoView());
          // The agent is looking at it, so it is read — otherwise the thread
          // would keep an unread badge for a message visible on screen.
          // Idempotent (the RPC only touches read_at IS NULL rows), and
          // loadThreads runs after so the badge clears in the same pass.
          if (row.from_support) {
            void loadThreads();
            return;
          }
          void supabase
            .rpc('mark_support_thread_read', { p_user_id: row.user_id })
            .then(() => loadThreads());
        },
      )
      .subscribe((status) => {
        if (!active) return;
        const action = realtimeStatusAction(status);
        if (action === 'reconnecting') {
          setRealtimeState('reconnecting');
          return;
        }
        // Terminal: supabase-js will not rejoin a closed channel. Surface the
        // error state so the Retry control (which builds a fresh channel) is
        // reachable, instead of a "Reconnecting…" banner that never resolves.
        if (action === 'closed') {
          setRealtimeState('error');
          return;
        }
        // Resync on (re)connect: supabase-js rejoins after a drop but never
        // replays events emitted during the outage.
        if (action === 'resync') {
          void loadThreads(false).then((loaded) => {
            if (active) setRealtimeState(loaded ? 'connected' : 'error');
          });
        }
      });
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [phase.state, loadThreads, realtimeRetryKey]);

  const reply = async () => {
    if (!openUser || !draft.trim() || sending) return;
    setSending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.rpc('reply_support_message', { p_user_id: openUser, p_body: draft.trim() });
      if (error) throw error;
      setDraft('');
      await openThread(openUser, { silent: true });
    } catch (e) {
      toast(safeDisplayError(e, { fallback: 'Could not send the reply. Please try again.' }), 'error');
    } finally {
      setSending(false);
    }
  };

  if (phase.state === 'loading') {
    return (
      <main className="min-h-screen bg-bg">
        <header className="flex items-center justify-between border-b border-line bg-white px-6 py-4">
          <Skeleton className="h-5 w-40" />
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
            <Link href="/" className="rounded-lg border border-line px-4 py-2 text-sm font-semibold">
              Back to dispatch
            </Link>
            <SignOutButton />
          </div>
        </div>
      </main>
    );
  }

  if (phase.state === 'error') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg px-4 text-center">
        <div className="max-w-md">
          <h1 className="text-xl font-bold">Couldn&apos;t load support</h1>
          <p className="mt-2 text-ink2">Conversations could not be verified. Check the connection and try again.</p>
          <div className="mt-6 flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setPhase({ state: 'loading' });
                setReloadKey((key) => key + 1);
              }}
              className="rounded-lg bg-accent px-6 py-2 font-semibold text-white"
            >
              Retry
            </button>
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
            Support
          </div>
          <div className="text-xs text-ink3">Customer messages · {phase.displayName}</div>
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-4 p-6 md:grid-cols-[300px_1fr]">
        {(realtimeState !== 'connected' || threadListError) && (
          <div
            role="status"
            className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm md:col-span-2 ${
              realtimeState === 'error' || threadListError
                ? 'border-red bg-redsoft text-red'
                : 'border-amber/40 bg-amber/10 text-ink2'
            }`}
          >
            <span>
              {realtimeState === 'error' || threadListError
                ? 'Support conversations could not refresh. Existing messages may be out of date.'
                : 'Reconnecting live support updates…'}
            </span>
            {(realtimeState === 'error' || threadListError) && (
              <button
                type="button"
                onClick={() => setRealtimeRetryKey((key) => key + 1)}
                className="shrink-0 rounded-lg border border-red px-3 py-1.5 font-semibold"
              >
                Retry
              </button>
            )}
          </div>
        )}
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
          ) : messagesLoading ? (
            <div className="space-y-3" role="status" aria-busy="true" aria-label="Loading conversation">
              <Skeleton className="h-10 w-2/3" />
              <Skeleton className="ml-auto h-10 w-1/2" />
              <Skeleton className="h-10 w-3/4" />
            </div>
          ) : threadError ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-center text-red">
              <p>Could not load this conversation.</p>
              <button
                type="button"
                onClick={() => openThread(openUser)}
                className="rounded-lg border border-red px-3 py-1.5 text-sm font-semibold"
              >
                Retry
              </button>
            </div>
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
