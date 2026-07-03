import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../../src/components/Icon';
import { colors, font, radius } from '../../../src/theme';
import { useT } from '../../../src/i18n';
import { useDirection } from '../../../src/lib/direction';
import { tap } from '../../../src/haptics';
import { db } from '../../../src/data';
import type { MessageSenderRole, OrderMessage } from '../../../src/data/types';

// Human label for who sent a message (customer's own messages show as "You").
const roleLabelKey: Record<MessageSenderRole, string> = {
  customer: 'chat.you',
  driver: 'chat.driver',
  merchant_staff: 'chat.restaurant',
  admin: 'chat.support',
};

export default function OrderChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = String(id);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const dir = useDirection();
  const listRef = useRef<FlatList<OrderMessage>>(null);

  const [messages, setMessages] = useState<OrderMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const upsert = useCallback((incoming: OrderMessage) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === incoming.id)) return prev;
      return [...prev, incoming].sort((a, b) => a.createdAt - b.createdAt);
    });
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const history = await db.messages.list(orderId);
        if (active) setMessages(history);
        await db.messages.markRead(orderId);
      } catch {
        // thread may be empty or not yet authorized; show empty state
      } finally {
        if (active) setLoading(false);
      }
    })();
    // Live updates for new messages while the screen is open.
    const unsub = db.messages.subscribe(orderId, (m) => {
      upsert(m);
      void db.messages.markRead(orderId);
    });
    return () => {
      active = false;
      unsub();
    };
  }, [orderId, upsert]);

  useEffect(() => {
    if (messages.length > 0) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [messages.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    tap();
    setSending(true);
    setDraft('');
    try {
      const msg = await db.messages.send(orderId, body);
      upsert(msg);
    } catch {
      setDraft(body); // restore on failure so the user doesn't lose their text
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Icon name="chevronBack" size={26} color={colors.ink} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('chat.title')}</Text>
        <View style={{ width: 26 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 44}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={{ padding: 16, paddingBottom: 12, gap: 8 }}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Text style={[styles.emptyText, dir.text]}>{t('chat.empty')}</Text>
              </View>
            }
            renderItem={({ item }) => {
              const mine = item.senderRole === 'customer';
              return (
                <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}>
                  <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                    {!mine && <Text style={styles.senderLabel}>{t(roleLabelKey[item.senderRole])}</Text>}
                    <Text style={[styles.bubbleText, mine && { color: colors.white }]}>{item.body}</Text>
                  </View>
                </View>
              );
            }}
          />
        )}

        <View style={[styles.composer, { paddingBottom: insets.bottom + 8 }]}>
          <TextInput
            style={[styles.input, dir.text]}
            value={draft}
            onChangeText={setDraft}
            placeholder={t('chat.placeholder')}
            placeholderTextColor={colors.ink3}
            multiline
            maxLength={2000}
            accessibilityLabel={t('chat.placeholder')}
          />
          <Pressable
            onPress={send}
            disabled={!draft.trim() || sending}
            accessibilityRole="button"
            accessibilityLabel={t('chat.send')}
            style={[styles.sendBtn, { backgroundColor: draft.trim() ? colors.accent : colors.line }]}>
            {sending ? <ActivityIndicator color={colors.white} /> : <Icon name="send" size={20} color={colors.white} />}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  headerTitle: { fontSize: font.sizes['2xl'], fontWeight: font.weights.bold, color: colors.ink },
  emptyWrap: { paddingTop: 60, alignItems: 'center' },
  emptyText: { color: colors.ink3, fontSize: font.sizes.lg, textAlign: 'center', paddingHorizontal: 40 },
  bubbleRow: { flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleMine: { backgroundColor: colors.accent, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderBottomLeftRadius: 4 },
  senderLabel: { fontSize: font.sizes.xs, fontWeight: font.weights.bold, color: colors.sea, marginBottom: 2 },
  bubbleText: { fontSize: font.sizes.lg, color: colors.ink, lineHeight: 22 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 44,
    borderRadius: radius.lg,
    backgroundColor: colors.bg,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: font.sizes.lg,
    color: colors.ink,
  },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
