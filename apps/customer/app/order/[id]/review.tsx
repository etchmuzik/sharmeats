import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as StoreReview from 'expo-store-review';
import { BackButton } from '../../../src/components/BackButton';
import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { colors, font, radius } from '../../../src/theme';
import { useT } from '../../../src/i18n';
import { db } from '../../../src/data';
import { success } from '../../../src/haptics';

function Stars({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
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

const stylesStar = StyleSheet.create({
  star: { fontSize: 36, color: colors.line2 },
});

export default function Review() {
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
        if (await StoreReview.isAvailableAsync()) await StoreReview.requestReview();
      } catch {
        // best-effort; never block the flow
      }
    }
    setTimeout(() => router.replace('/(tabs)/orders'), 1100);
  };

  if (submitted) {
    return (
      <View style={[styles.wrap, { paddingTop: insets.top + 40 }]}>
        <StatusBar style="dark" />
        <Text style={{ fontSize: 64 }}>✨</Text>
        <Text style={styles.thanks}>{t('review.thanks')}</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="dark" />
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

const styles = StyleSheet.create({
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
  block: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radius.xl, padding: 16, gap: 12 },
  label: { fontSize: font.sizes.xl, fontWeight: font.weights.bold, color: colors.ink },
  input: {
    backgroundColor: colors.white,
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
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
});
