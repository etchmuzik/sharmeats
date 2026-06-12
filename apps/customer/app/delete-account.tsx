import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../src/components/BackButton';
import { PrimaryButton } from '../src/components/PrimaryButton';
import { Icon } from '../src/components/Icon';
import { colors, font, radius, shadow } from '../src/theme';
import { useT } from '../src/i18n';
import { useDirection } from '../src/lib/direction';
import { useSession } from '../src/store/session';
import { tap, success, warn } from '../src/haptics';
import { db } from '../src/data';
import { AccountDeletionError } from '../src/data/supabase/user';
import { unregisterPush } from '../src/lib/push';
import { resetAnalyticsUser } from '../src/lib/analytics';

/**
 * Account deletion screen — Apple App Store Guideline 5.1.1(v).
 *
 * Self-service, in-app, irreversible. Flow:
 *   1. Explain exactly what is deleted (account + PII) and what is retained
 *      (de-identified order records, for legal/tax reasons).
 *   2. Block while an order is in flight (operational + payment integrity).
 *   3. Require typing the confirmation word (an allowed "prevent accidental
 *      deletion" step — never a phone call or email).
 *   4. Call db.user.deleteAccount() which (live mode) anonymizes orders and
 *      deletes the auth identity via the delete-account Edge Function, then
 *      signs out and returns to onboarding.
 */
export default function DeleteAccount() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  const dir = useDirection();
  const signOut = useSession((s) => s.signOut);

  const [confirmText, setConfirmText] = useState('');
  const [hasActiveOrder, setHasActiveOrder] = useState(false);
  const [checkingOrders, setCheckingOrders] = useState(true);
  const [deleting, setDeleting] = useState(false);

  // Block deletion while an order is in flight: the order's payment/settlement
  // and the driver assignment still reference this account. Best-effort — if
  // the check fails we don't hard-block (deletion still anonymizes safely).
  useEffect(() => {
    let cancelled = false;
    db.orders
      .listActive()
      .then((active) => {
        if (!cancelled) setHasActiveOrder(active.length > 0);
      })
      .catch(() => {
        /* ignore — treat as no active order */
      })
      .finally(() => {
        if (!cancelled) setCheckingOrders(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const confirmWord = t('deleteAccount.confirmWord');
  const canDelete =
    !deleting &&
    !hasActiveOrder &&
    confirmText.trim().toUpperCase() === confirmWord.toUpperCase();

  const handleDelete = async () => {
    if (!canDelete) return;
    setDeleting(true);
    try {
      // Stop this device from receiving the (now-detached) account's pushes,
      // then delete server-side data + auth identity.
      await unregisterPush().catch(() => {});
      await db.user.deleteAccount();

      // Full teardown so no orphaned credential or state survives:
      //  - clear the Supabase SDK session (its persisted access/refresh tokens
      //    are now for a deleted identity); without this they linger until the
      //    next cold launch.
      //  - reset analytics identity.
      //  - clear the local Zustand session (flips signed-out, wipes AsyncStorage).
      await db.auth.signOut().catch(() => {});
      resetAnalyticsUser();
      signOut();
      success();

      // Confirm, THEN navigate from the alert's action so the message is tied
      // to a real interaction (not a detached timer that can be orphaned by the
      // navigation that replaces this screen).
      Alert.alert(
        t('deleteAccount.successTitle'),
        t('deleteAccount.successBody'),
        [{ text: t('common.continue'), onPress: () => router.replace('/onboarding') }],
        { cancelable: false },
      );
    } catch (e) {
      warn();
      setDeleting(false);
      // Race: an order may have been placed after this screen loaded. The
      // server blocks it (409) — surface the active-order message instead.
      if (e instanceof AccountDeletionError && e.reason === 'active_order') {
        setHasActiveOrder(true);
        Alert.alert(t('deleteAccount.title'), t('deleteAccount.activeOrderBlock'));
      } else {
        Alert.alert(t('deleteAccount.title'), t('deleteAccount.error'));
      }
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="dark" />
      <View style={[styles.head, { paddingTop: insets.top + 12 }]}>
        {/* Block back-navigation mid-delete so the flow can't be interrupted. */}
        <BackButton onPress={deleting ? () => {} : undefined} />
        <Text style={styles.title}>{t('deleteAccount.title')}</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 + insets.bottom }}
        keyboardShouldPersistTaps="handled">
        <View style={styles.iconWrap}>
          <View style={styles.iconCircle}>
            <Icon name="trash" size={30} color={colors.red} />
          </View>
        </View>

        <Text style={[styles.heading, dir.text]}>{t('deleteAccount.heading')}</Text>

        <View style={styles.card}>
          <Text style={[styles.body, dir.text]}>{t('deleteAccount.intro')}</Text>
          <Text style={[styles.body, styles.bodyMuted, dir.text]}>
            {t('deleteAccount.ordersNote')}
          </Text>
          <Text style={[styles.body, styles.bodyWarn, dir.text]}>
            {t('deleteAccount.irreversible')}
          </Text>
        </View>

        {hasActiveOrder ? (
          <View style={[styles.card, styles.blockCard]}>
            <Icon name="warning" size={20} color={colors.red} />
            <Text style={[styles.blockText, dir.text]}>
              {t('deleteAccount.activeOrderBlock')}
            </Text>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={[styles.confirmPrompt, dir.text]}>{t('deleteAccount.confirmPrompt')}</Text>
            <TextInput
              value={confirmText}
              onChangeText={setConfirmText}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!deleting}
              placeholder={t('deleteAccount.confirmPlaceholder')}
              placeholderTextColor={colors.ink3}
              style={[styles.input, dir.text]}
              accessibilityLabel={t('deleteAccount.confirmPlaceholder')}
            />
          </View>
        )}

        <PrimaryButton
          label={deleting ? t('deleteAccount.deleting') : t('deleteAccount.cta')}
          onPress={handleDelete}
          disabled={!canDelete || checkingOrders}
          style={styles.deleteBtn}
        />
        {deleting && (
          <View style={styles.spinnerRow}>
            <ActivityIndicator color={colors.red} />
          </View>
        )}

        <PrimaryButton
          label={t('deleteAccount.cancel')}
          variant="ghost"
          onPress={() => {
            tap();
            router.back();
          }}
          disabled={deleting}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  head: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bg,
  },
  title: {
    fontSize: font.sizes['5xl'],
    fontWeight: font.weights.extrabold,
    letterSpacing: -0.4,
    color: colors.ink,
  },
  iconWrap: { alignItems: 'center', marginTop: 8 },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.redSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: {
    fontSize: font.sizes['3xl'],
    fontWeight: font.weights.extrabold,
    color: colors.ink,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    gap: 12,
    ...shadow.soft,
  },
  body: { fontSize: font.sizes.lg, color: colors.ink, lineHeight: 22 },
  bodyMuted: { color: colors.ink2 },
  bodyWarn: { color: colors.red, fontWeight: font.weights.semibold },
  blockCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.redSoft,
    borderColor: colors.red,
  },
  blockText: { flex: 1, fontSize: font.sizes.lg, color: colors.red, lineHeight: 21, fontWeight: font.weights.semibold },
  confirmPrompt: { fontSize: font.sizes.lg, color: colors.ink, fontWeight: font.weights.semibold },
  input: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: font.sizes['2xl'],
    color: colors.ink,
    fontWeight: font.weights.bold,
    backgroundColor: colors.bg,
    letterSpacing: 1,
  },
  deleteBtn: { backgroundColor: colors.red },
  spinnerRow: { alignItems: 'center', marginTop: -6 },
});
