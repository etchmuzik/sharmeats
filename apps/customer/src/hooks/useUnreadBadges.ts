import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { usePathname } from 'expo-router';
import { db, isBackendLive } from '../data';
import { getSupabase } from '../data/supabase/client';

export interface UnreadBadges {
  /** Unread inbound messages across the user's order-chat threads. */
  orders: number;
  /** Unread replies on the user's support thread. */
  support: number;
}

/**
 * Unread counts for the tab-bar badges.
 *
 * The unread rule (inbound + not yet read, role-aware) lives server-side in
 * my_unread_message_count / my_support_unread_count — this hook only fetches
 * the totals, so the badges can never disagree with the chat screens.
 *
 * Refresh triggers: mount, every route change (chat screens mark their thread
 * read on open, so navigating back clears the badge), app foregrounding, and
 * Realtime INSERTs on either message table when the live backend is active.
 */
export function useUnreadBadges(): UnreadBadges {
  const pathname = usePathname();
  const [counts, setCounts] = useState<UnreadBadges>({ orders: 0, support: 0 });

  const refresh = useCallback(async () => {
    try {
      const [orders, support] = await Promise.all([
        db.messages.unreadCount(),
        db.support.unreadCount(),
      ]);
      setCounts((prev) =>
        prev.orders === orders && prev.support === support ? prev : { orders, support },
      );
    } catch {
      // Signed-out or offline: badges are advisory — keep the last known
      // counts rather than flashing to zero and back.
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, pathname]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  useEffect(() => {
    if (!isBackendLive) return;
    try {
      const sb = getSupabase();
      const name = 'badges:self';
      // supabase-js reuses a channel by name; .on() after subscribe() throws.
      // Drop any stale same-named channel first (same guard as the chat repos).
      for (const existing of sb.getChannels()) {
        if (existing.topic === `realtime:${name}`) sb.removeChannel(existing);
      }
      const channel = sb
        .channel(name)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'order_messages' },
          () => refresh(),
        )
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'support_messages' },
          () => refresh(),
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') refresh();
        });
      return () => {
        sb.removeChannel(channel);
      };
    } catch {
      // No client yet (e.g. before sign-in): route-change refreshes still run.
      return;
    }
  }, [refresh]);

  return counts;
}
