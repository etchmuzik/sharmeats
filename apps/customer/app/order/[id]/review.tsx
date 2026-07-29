import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as StoreReview from 'expo-store-review';
import { BackButton } from '../../../src/components/BackButton';
import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { font, radius } from '../../../src/theme';
import { ThemedStatusBar, makeStyles, useThemeColors } from '../../../src/themeProvider';
import { useT } from '../../../src/i18n';
import { db } from '../../../src/data';
import { success } from '../../../src/haptics';
import { track } from '../../../src/lib/analytics';

function Stars({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  const colors = useThemeColors();
  const stylesStar = useStylesStar();
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} onPress={() => onChange(n)} hitSlop={6}>
          <Text style={[stylesStar.star, value >= n && { color: colors.star }]}>★</Text>
        </Pressable>
      ))}
    </View>
  );
}

const useStylesStar = makeStyles((colors) => ({
  star: { fontSize: 36, color: colors.line2 },
}));

export default function Review() {
  const colors = useThemeColors();
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  const [food, setFood] = useState(5);
  const [delivery, setDelivery] = useState(5);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const submit = async () => {
    if (!id) return;
    await db.orders.submitReview(id, food, delivery, comment.trim());
    success();
    setSubmitted(true);
    // Happy moment: if the customer rated the order highly, ask them to rate the
    // app in the store too (native prompt; the OS rate-limits how often it shows).
    // App-store rating is the top conversion factor for tourist search discovery.
    if (food >= 4 && delivery >= 4) {
      try {
        const available = await StoreReview.isAvailableAsync();
        // "shown" here means WE ASKED THE OS, not that a human saw a dialog:
        // iOS silently rate-limits requestReview() and resolves either way, so
        // claiming a display would be the same lie as calling an Expo ticket a
        // delivery. The result property records exactly what we can observe.
        track('review_prompt_shown', { trigger: 'high_rating', available });
        if (available) {
          await StoreReview.requestReview();
          track('review_prompt_result', { result: 'requested' });
        } else {
          track('review_prompt_result', { result: 'unavailable' });
        }
      } catch {
        // best-effort; never block the flow
        track('review_prompt_result', { result: 'error' });
      }
    }
    setTimeout(() => router.replace('/(tabs)/orders'), 1100);
  };

  if (submitted) {
    return (
      <View style={[styles.wrap, { paddingTop: insets.top + 40 }]}>
        <ThemedStatusBar />
        <Text style={{ fontSize: 64 }}>✨</Text>
        <Text style={styles.thanks}>{t('review.thanks')}</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ThemedStatusBar />
      <View style={[styles.head, { paddingTop: insets.top + 12 }]}>
        <BackButton />
        <Text style={styles.title}>{t('review.title')}</Text>
        <View style={{ width: 38 }} />
      </View>

      <View style={{ padding: 20, gap: 18 }}>
        <View style={styles.block}>
          <Text style={styles.label}>{t('review.food')}</Text>
          <Stars value={food} onChange={setFood} />
        </View>
        <View style={styles.block}>
          <Text style={styles.label}>{t('review.delivery')}</Text>
          <Stars value={delivery} onChange={setDelivery} />
        </View>
        <TextInput
          value={comment}
          onChangeText={setComment}
          multiline
          placeholder={t('review.placeholder')}
          placeholderTextColor={colors.ink3}
          style={styles.input}
        />
      </View>

      <View style={{ flex: 1 }} />
      <View style={[styles.bottom, { paddingBottom: 24 + insets.bottom }]}>
        <PrimaryButton label={t('review.submit')} onPress={submit} />
      </View>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { flex: 1, backgroundColor: colors.bg, alignItems: 'center' },
  thanks: { marginTop: 14, fontSize: font.sizes['7xl'], fontWeight: font.weights.extrabold, color: colors.ink },
  head: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bg,
  },
  title: { fontSize: font.sizes['5xl'], fontWeight: font.weights.extrabold, letterSpacing: -0.4, color: colors.ink },
  block: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.xl, padding: 16, gap: 12 },
  label: { fontSize: font.sizes.xl, fontWeight: font.weights.bold, color: colors.ink },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.xl,
    padding: 16,
    fontSize: font.sizes.lg,
    color: colors.ink,
    minHeight: 90,
    textAlignVertical: 'top',
  },
  bottom: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
}));
