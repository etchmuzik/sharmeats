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
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../src/components/Icon';
import { colors, font, radius } from '../src/theme';
import { useT } from '../src/i18n';
import { useDirection } from '../src/lib/direction';
import { tap } from '../src/haptics';
import { db } from '../src/data';
import type { OrderMessage } from '../src/data/types';

// Live support chat with the Sharm Eats team. Mirrors the order chat screen.
export default function SupportScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const dir = useDirection();
  const listRef = useRef<FlatList<OrderMessage>>(null);

  const [messages, setMessages] = useState<OrderMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const upsert = useCallback((m: OrderMessage) => {
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m].sort((a, b) => a.createdAt - b.createdAt)));
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const history = await db.support.list();
        if (active) setMessages(history);
        await db.support.markRead();
      } catch {
        // empty thread is fine
      } finally {
        if (active) setLoading(false);
      }
    })();
    const unsub = db.support.subscribe((m) => {
      upsert(m);
      void db.support.markRead();
    });
    return () => {
      active = false;
      unsub();
    };
  }, [upsert]);

  useEffect(() => {
    if (messages.length > 0) requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, [messages.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    tap();
    setSending(true);
    setDraft('');
    try {
      upsert(await db.support.send(body));
    } catch {
      setDraft(body);
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
        <Text style={styles.headerTitle}>{t('support.title')}</Text>
        <View style={{ width: 26 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top + 44}>
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
            ListHeaderComponent={
              <View style={styles.introCard}>
                <Text style={[styles.introText, dir.text]}>{t('support.intro')}</Text>
              </View>
            }
            renderItem={({ item }) => {
              const mine = item.senderRole === 'customer';
              return (
                <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
                  <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                    {!mine && <Text style={styles.senderLabel}>{t('support.team')}</Text>}
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
            placeholder={t('support.placeholder')}
            placeholderTextColor={colors.ink3}
            multiline
            maxLength={2000}
            accessibilityLabel={t('support.placeholder')}
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
  introCard: { backgroundColor: colors.seaSoft, borderRadius: radius.lg, padding: 14, marginBottom: 4 },
  introText: { color: colors.ink2, fontSize: font.sizes.base, lineHeight: 20 },
  row: { flexDirection: 'row' },
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
