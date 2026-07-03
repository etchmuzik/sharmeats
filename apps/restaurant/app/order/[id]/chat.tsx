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
import { useLocalSearchParams, useRouter } from 'expo-router';
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
import { colors, font, radius, spacing } from '../../../src/theme';

/** Friendly label for the OTHER party's role on a bubble. */
function roleLabel(role: MessageRole): string {
  if (role === 'customer') return 'Customer';
  if (role === 'driver') return 'Driver';
  return 'Restaurant';
}

/**
 * In-app order chat for the kitchen. The restaurant staffer's own messages are
 * the "mine" (violet, right-aligned) bubbles; customer/driver messages sit left.
 * Live via Realtime; the thread is marked read on open and on each new inbound.
 */
export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { toast } = useToast();
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
      toast(e instanceof Error ? e.message : 'Could not load messages', 'error');
    } finally {
      setLoading(false);
      scrollToEnd();
    }
  }, [id, toast, scrollToEnd]);

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
      toast(e instanceof Error ? e.message : 'Could not send message', 'error');
    } finally {
      setSending(false);
    }
  }, [id, draft, sending, toast]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Back header */}
      <View
        style={{
          paddingTop: insets.top + spacing.md,
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.md,
          backgroundColor: colors.white,
          borderBottomWidth: 1,
          borderBottomColor: colors.line,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          style={{ padding: spacing.xs }}
        >
          <Icon name="chevronBack" size={24} color={colors.ink} accessibilityLabel="Back" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: font.sizes.lg, fontWeight: '800', color: colors.ink }}>Messages</Text>
          <Text style={{ fontSize: font.sizes.xs, color: colors.ink3 }}>Customer &amp; driver</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + spacing.md}
      >
        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
            onContentSizeChange={scrollToEnd}
            keyboardShouldPersistTaps="handled"
          >
            {messages.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: spacing.xxxl * 2, gap: spacing.sm }}>
                <Icon name="chat" size={36} color={colors.ink3} accessibilityLabel="No messages" />
                <Text style={{ fontSize: font.sizes.base, color: colors.ink2 }}>No messages yet</Text>
                <Text style={{ fontSize: font.sizes.sm, color: colors.ink3, textAlign: 'center' }}>
                  Send a message to the customer or driver about this order.
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
                        {roleLabel(m.sender_role)}
                      </Text>
                    ) : null}
                    <View
                      style={{
                        maxWidth: '82%',
                        backgroundColor: mine ? colors.accent : colors.white,
                        borderWidth: mine ? 0 : 1,
                        borderColor: colors.line,
                        borderRadius: radius.xl,
                        paddingHorizontal: spacing.md,
                        paddingVertical: spacing.sm,
                      }}
                    >
                      <Text style={{ fontSize: font.sizes.base, color: mine ? colors.white : colors.ink }}>
                        {m.body}
                      </Text>
                    </View>
                    <Text style={{ fontSize: 10, color: colors.ink3, marginTop: 2, marginHorizontal: spacing.sm }}>
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
            backgroundColor: colors.white,
            borderTopWidth: 1,
            borderTopColor: colors.line,
          }}
        >
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Type a message…"
            placeholderTextColor={colors.ink3}
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
            }}
          />
          <Pressable
            onPress={send}
            disabled={sending || !draft.trim()}
            accessibilityRole="button"
            accessibilityLabel="Send message"
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
              <ActivityIndicator color={colors.white} />
            ) : (
              <Icon name="send" size={20} color={colors.white} accessibilityLabel="Send" />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
