import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../src/components/BackButton';
import { EmptyState } from '../src/components/EmptyState';
import { font, radius } from '../src/theme';
import { ThemedStatusBar, makeStyles, useThemeColors } from '../src/themeProvider';
import { useT } from '../src/i18n';
import { useDirection } from '../src/lib/direction';
import { db } from '../src/data';
import { tap } from '../src/haptics';
import { inboxCopyKeys, inboxRoute, isInboxRowTappable, isUnread } from '../src/lib/inbox';
import type { InboxMessage } from '../src/data/types';

/**
 * Notification inbox (Package 03 Slice H).
 *
 * SHIPS BEHIND A FLAG, DEFAULTING OFF. The spec gates this slice on the transport
 * being truthful and on pilot evidence; neither is met, because push_messages is
 * empty until the expo-push deploy lands. An always-on inbox would render blank for
 * every customer, which reads as broken rather than empty. The route exists so it
 * can be turned on the moment real messages arrive — see lib/inbox.ts.
 *
 * WHAT IS NOT HERE, DELIBERATELY:
 *   * no "mark all read" — it would mark messages read that the customer never
 *     looked at, and read-state is the one honest signal this screen produces;
 *   * no pull-to-delete — retention is server-side (retain_until) and a client that
 *     could hide messages would disagree with the operator's view of what was sent.
 */
export default function Inbox() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const styles = useStyles();
  const t = useT();
  const dir = useDirection();

  const [items, setItems] = useState<InboxMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await db.user.notificationInbox();
      setItems(page);
      setExhausted(page.length === 0);
    } catch {
      // A failed load shows the empty state rather than an error screen: an inbox
      // is not load-bearing, and there is nothing the customer can do about it.
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const loadMore = async () => {
    const last = items[items.length - 1];
    if (!last || loadingMore || exhausted) return;
    setLoadingMore(true);
    try {
      // Keyset cursor, matching the server (mig 179): an inbox grows at the head,
      // so an offset-based page 2 would repeat rows once a new message arrives.
      const page = await db.user.notificationInbox({ queuedAt: last.queuedAt, id: last.id });
      if (page.length === 0) setExhausted(true);
      else setItems((prev) => [...prev, ...page]);
    } catch {
      setExhausted(true);
    } finally {
      setLoadingMore(false);
    }
  };

  const onPressRow = (m: InboxMessage) => {
    const route = inboxRoute(m);
    // Marking read BEFORE navigating, for the same reason the push layer tracks
    // before routing: navigation can unmount this screen, and the write would be
    // lost. It is fire-and-forget and never blocks the tap.
    void db.user.markNotificationRead(m.id);
    setItems((prev) =>
      prev.map((x) => (x.id === m.id ? { ...x, readAt: new Date().toISOString() } : x)),
    );
    if (route) {
      tap();
      router.push(route);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ThemedStatusBar />
      <View style={[styles.header, { paddingTop: insets.top + 12 }, dir.row]}>
        <BackButton />
        <Text style={[styles.title, dir.text]}>{t('inbox.title')}</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : items.length === 0 ? (
        <EmptyState icon="bell" title={t('inbox.empty')} body={t('inbox.emptyDesc')} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
          {items.map((m) => {
            const copy = inboxCopyKeys(m);
            const tappable = isInboxRowTappable(m);
            const unread = isUnread(m);
            return (
              <Pressable
                key={m.id}
                onPress={() => onPressRow(m)}
                // A row that navigates nowhere must not LOOK tappable — the spec's
                // "expired order actions degrade safely". It still marks read.
                style={[styles.row, unread && styles.rowUnread]}
                accessibilityRole={tappable ? 'button' : 'text'}
                accessibilityLabel={`${t(copy.titleKey)}${unread ? `, ${t('inbox.unread')}` : ''}`}>
                <View style={[styles.rowTop, dir.row]}>
                  {unread ? <View style={styles.dot} /> : null}
                  <Text style={[styles.label, dir.text]}>{t(copy.titleKey)}</Text>
                  <Text style={[styles.when, dir.text]}>{relativeDay(m.queuedAt)}</Text>
                </View>
                {copy.literalBody ? (
                  <Text style={[styles.body, dir.text]} numberOfLines={3}>
                    {copy.literalBody}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}

          {!exhausted ? (
            <Pressable
              style={styles.more}
              onPress={loadMore}
              disabled={loadingMore}
              accessibilityRole="button">
              {loadingMore ? (
                <ActivityIndicator color={colors.ink3} />
              ) : (
                <Text style={styles.moreText}>{t('inbox.loadMore')}</Text>
              )}
            </Pressable>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

/**
 * Coarse age label.
 *
 * Deliberately coarse: an exact timestamp invites the reader to treat it as when the
 * notification was DELIVERED, which nothing in this system knows — queued_at is when
 * we ENQUEUED it, and even an Expo receipt only proves the provider accepted it.
 * A day count cannot be misread that precisely.
 */
function relativeDay(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const days = Math.floor(ms / 86_400_000);
  // Day counts rather than words, so no new i18n keys are needed for something
  // this incidental — and "0d"/"1d" read the same in every supported locale.
  return `${Math.max(0, days)}d`;
}

const useStyles = makeStyles((colors) => ({
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
  },
  title: { fontSize: font.sizes['3xl'], fontWeight: font.weights.bold, color: colors.ink },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 10,
  },
  // Unread is carried by BOTH a dot and a tint, not colour alone — colour-only
  // state is invisible to a colourblind reader.
  rowUnread: { backgroundColor: colors.accentSoft },
  rowTop: { alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  label: { flex: 1, fontSize: font.sizes.lg, fontWeight: font.weights.semibold, color: colors.ink },
  when: { fontSize: font.sizes.md, color: colors.ink3 },
  body: { marginTop: 6, fontSize: font.sizes.md, color: colors.ink2, lineHeight: 19 },
  more: { paddingVertical: 14, alignItems: 'center' },
  moreText: { color: colors.ink3, fontSize: font.sizes.lg },
}));
