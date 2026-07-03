import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../src/auth';
import { list, markRead, send, subscribe, type OrderMessage } from '../../../src/messages';
import { colors, font, radius, spacing } from '../../../src/theme';
import { Icon } from '../../../src/components/Icon';
import { useToast } from '../../../src/components/Toast';

/**
 * In-app chat between the driver and the other order parties (customer /
 * restaurant). Mirrors the shared `order_messages` thread. The driver's own
 * messages render as the accent "mine" bubbles on the right.
 */
export default function ChatScreen() {
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
  const listRef = useRef<FlatList<OrderMessage>>(null);

  // Live thread: subscribe() fetches on SUBSCRIBED and on every INSERT, so the
  // one-shot initial load is handled for us. Mark the thread read on open and
  // whenever new messages arrive while the screen is focused.
  useEffect(() => {
    if (!id) return;
    let mounted = true;
    const unsubscribe = subscribe(id, (msgs) => {
      if (!mounted) return;
      setMessages(msgs);
      setLoading(false);
      markRead(id).catch(() => {});
    });
    // Fallback initial load in case SUBSCRIBED is slow — list() is idempotent.
    list(id)
      .then((msgs) => {
        if (!mounted) return;
        setMessages(msgs);
        setLoading(false);
        markRead(id).catch(() => {});
      })
      .catch(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [id]);

  const onSend = useCallback(async () => {
    if (!id) return;
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setDraft('');
    try {
      await send(id, body);
      // The realtime INSERT will refetch the thread; no optimistic append needed.
    } catch (e) {
      setDraft(body); // restore so the driver doesn't lose their text
      toast(e instanceof Error ? e.message : "Couldn't send. Try again.", 'error');
    } finally {
      setSending(false);
    }
  }, [id, draft, sending, toast]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
      {/* Header */}
      <View
        style={{
          paddingTop: insets.top + spacing.sm,
          paddingHorizontal: spacing.xl,
          paddingBottom: spacing.md,
          borderBottomWidth: 1,
          borderColor: colors.line,
          backgroundColor: colors.white,
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
          style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
        >
          <Icon name="chevronBack" size={20} color={colors.accent} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: font.sizes.lg, fontWeight: '800', color: colors.ink }}>Messages</Text>
          <Text style={{ fontSize: font.sizes.xs, color: colors.ink3 }}>Customer &amp; restaurant</Text>
        </View>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.lg,
            gap: spacing.sm,
            flexGrow: 1,
          }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: spacing.xxxl }}>
              <Icon name="chat" size={40} color={colors.ink3} accessibilityLabel="No messages" />
              <Text style={{ color: colors.ink2, marginTop: spacing.md, textAlign: 'center' }}>
                No messages yet.
              </Text>
              <Text style={{ color: colors.ink3, marginTop: 2, textAlign: 'center', fontSize: font.sizes.sm }}>
                Say hi or share an update with the customer.
              </Text>
            </View>
          }
          renderItem={({ item }) => <Bubble message={item} mine={isMine(item, myId)} />}
        />
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
          borderTopWidth: 1,
          borderColor: colors.line,
          backgroundColor: colors.white,
        }}
      >
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Message the customer…"
          placeholderTextColor={colors.ink3}
          multiline
          accessibilityLabel="Message"
          style={{
            flex: 1,
            maxHeight: 120,
            minHeight: 44,
            backgroundColor: colors.bgSoft,
            borderRadius: radius.xl,
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.md,
            paddingBottom: spacing.md,
            color: colors.ink,
            fontSize: font.sizes.base,
          }}
        />
        <Pressable
          onPress={onSend}
          disabled={sending || draft.trim().length === 0}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: draft.trim().length === 0 ? colors.line : colors.accent,
          }}
        >
          {sending ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Icon name="navigate" size={18} color={colors.white} />
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

/** True when the message was sent by the current driver. */
function isMine(m: OrderMessage, myId: string | null): boolean {
  if (myId && m.sender_id === myId) return true;
  return m.sender_role === 'driver';
}

function Bubble({ message, mine }: { message: OrderMessage; mine: boolean }) {
  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
      {!mine && (
        <Text style={{ fontSize: font.sizes.xs, color: colors.ink3, marginBottom: 2, marginLeft: spacing.sm }}>
          {roleLabel(message.sender_role)}
        </Text>
      )}
      <View
        style={{
          maxWidth: '80%',
          backgroundColor: mine ? colors.accent : colors.white,
          borderWidth: mine ? 0 : 1,
          borderColor: colors.line,
          borderRadius: radius.xl,
          borderBottomRightRadius: mine ? radius.sm : radius.xl,
          borderBottomLeftRadius: mine ? radius.xl : radius.sm,
          paddingVertical: spacing.sm,
          paddingHorizontal: spacing.md,
        }}
      >
        <Text style={{ color: mine ? colors.white : colors.ink, fontSize: font.sizes.base }}>
          {message.body}
        </Text>
      </View>
      <Text style={{ fontSize: font.sizes.xs, color: colors.ink3, marginTop: 2, marginHorizontal: spacing.sm }}>
        {formatTime(message.created_at)}
      </Text>
    </View>
  );
}

function roleLabel(role: OrderMessage['sender_role']): string {
  return { customer: 'Customer', driver: 'You', restaurant: 'Restaurant' }[role];
}

/** Short HH:MM local time for a message timestamp; empty on parse failure. */
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
