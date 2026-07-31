import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../src/auth';
import { useToast } from '../../../src/components/Toast';
import { Icon } from '../../../src/components/Icon';
import {
  listMessages,
  markThreadRead,
  sendMessage,
  subscribeMessages,
  type MessageRole,
  type OrderMessage,
} from '../../../src/messages';
import { font, radius, spacing } from '../../../src/theme';
import { useThemeColors } from '../../../src/themeProvider';
import { useLocale } from '../../../src/locale';
import type { TranslationKey } from '../../../src/i18n';
import { captureError } from '../../../src/lib/crash';

/** Friendly label for the OTHER party's role on a bubble. */
const ROLE_LABEL_KEY: Record<MessageRole, TranslationKey> = {
  customer: 'chat.roleCustomer',
  driver: 'chat.roleDriver',
  restaurant: 'chat.roleRestaurant',
};

/**
 * In-app order chat for the kitchen. The restaurant staffer's own messages are
 * the "mine" (violet, right-aligned) bubbles; customer/driver messages sit left.
 * Live via Realtime; the thread is marked read on open and on each new inbound.
 */
export default function Chat() {
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { toast } = useToast();
  const { direction, isRtl, t } = useLocale();
  const myId = session?.user?.id ?? null;

  const [messages, setMessages] = useState<OrderMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const rows = await listMessages(id);
      setMessages(rows);
      // Clear the unread badge for this thread; ignore failures (non-critical).
      markThreadRead(id).catch(() => {});
    } catch (e) {
      captureError(e, { where: 'restaurant.chat.load', orderId: id });
      toast(t('chat.loadError'), 'error');
    } finally {
      setLoading(false);
      scrollToEnd();
    }
  }, [id, toast, t, scrollToEnd]);

  useEffect(() => {
    load();
  }, [load]);

  // Live inbound messages; merge (de-duped) and keep the thread marked read.
  useEffect(() => {
    if (!id) return;
    const unsub = subscribeMessages(
      id,
      (row) => {
        setMessages((prev) => {
          if (prev.some((m) => m.id === row.id)) return prev;
          return [...prev, row].sort((a, b) => a.created_at.localeCompare(b.created_at));
        });
        // A message we didn't send just arrived → clear the unread badge.
        if (row.sender_id !== myId) markThreadRead(id).catch(() => {});
        scrollToEnd();
      },
      // On (re)connect, refetch to backfill anything missed during an outage.
      () => {
        listMessages(id)
          .then((rows) => {
            setMessages(rows);
            scrollToEnd();
          })
          .catch(() => {});
      },
    );
    return unsub;
  }, [id, myId, scrollToEnd]);

  const send = useCallback(async () => {
    const body = draft.trim();
    if (!id || !body || sending) return;
    setSending(true);
    setDraft('');
    try {
      await sendMessage(id, body);
      // The Realtime INSERT echoes our own message back and appends it.
    } catch (e) {
      setDraft(body); // restore so the staffer can retry
      captureError(e, { where: 'restaurant.chat.send', orderId: id });
      toast(t('chat.sendError'), 'error');
    } finally {
      setSending(false);
    }
  }, [id, draft, sending, toast, t]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, direction }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        // The native Stack header sits above this view, so the screen already
        // starts below it — no manual offset to compensate for.
        keyboardVerticalOffset={0}
      >
        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
            onContentSizeChange={scrollToEnd}
            keyboardShouldPersistTaps="handled"
          >
            {messages.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: spacing.xxxl * 2, gap: spacing.sm }}>
                <Icon name="chat" size={36} color={colors.ink3} accessibilityLabel={t('chat.emptyA11y')} />
                <Text style={{ fontSize: font.sizes.base, color: colors.ink2 }}>
                  {t('chat.emptyTitle')}
                </Text>
                <Text style={{ fontSize: font.sizes.sm, color: colors.ink3, textAlign: 'center' }}>
                  {t('chat.emptyBody')}
                </Text>
              </View>
            ) : (
              messages.map((m) => {
                const mine = m.sender_id === myId;
                return (
                  <View
                    key={m.id}
                    style={{ alignItems: mine ? 'flex-end' : 'flex-start', maxWidth: '100%' }}
                  >
                    {!mine ? (
                      <Text style={{ fontSize: font.sizes.xs, color: colors.ink3, marginBottom: 2, marginLeft: spacing.sm }}>
                        {t(ROLE_LABEL_KEY[m.sender_role])}
                      </Text>
                    ) : null}
                    <View
                      style={{
                        maxWidth: '82%',
                        backgroundColor: mine ? colors.accent : colors.surface,
                        borderWidth: mine ? 0 : 1,
                        borderColor: colors.line,
                        borderRadius: radius.xl,
                        paddingHorizontal: spacing.md,
                        paddingVertical: spacing.sm,
                      }}
                    >
                      <Text style={{ fontSize: font.sizes.base, color: mine ? colors.onAccent : colors.ink }}>
                        {m.body}
                      </Text>
                    </View>
                    <Text style={{ fontSize: font.sizes.xs, color: colors.ink3, marginTop: 2, marginHorizontal: spacing.sm }}>
                      {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                );
              })
            )}
          </ScrollView>
        )}

        {/* Composer */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: spacing.sm,
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.sm,
            paddingBottom: insets.bottom + spacing.sm,
            backgroundColor: colors.surface,
            borderTopWidth: 1,
            borderTopColor: colors.line,
          }}
        >
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={t('chat.placeholder')}
            placeholderTextColor={colors.ink3}
            accessibilityLabel={t('chat.placeholder')}
            multiline
            style={{
              flex: 1,
              maxHeight: 120,
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: radius.xl,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              backgroundColor: colors.bg,
              color: colors.ink,
              fontSize: font.sizes.base,
              textAlign: isRtl ? 'right' : 'left',
              writingDirection: direction,
            }}
          />
          <Pressable
            onPress={send}
            disabled={sending || !draft.trim()}
            accessibilityRole="button"
            accessibilityLabel={t('chat.sendA11y')}
            accessibilityState={{ disabled: sending || !draft.trim(), busy: sending }}
            style={{
              width: 44,
              height: 44,
              borderRadius: radius.pill,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: draft.trim() ? colors.accent : colors.line,
            }}
          >
            {sending ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Icon name="send" size={20} color={colors.onAccent} />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

/**
 * Per-ROUTE recovery. The root layout already exports this, but a boundary that
 * only exists at the root means any throw anywhere unmounts the whole stack —
 * including the kitchen queue. Exported here as well so a crash on this screen
 * is contained to this screen and offers Retry / Home instead.
 */
export { ScreenErrorBoundary as ErrorBoundary } from '../../../src/components/ScreenErrorBoundary';
