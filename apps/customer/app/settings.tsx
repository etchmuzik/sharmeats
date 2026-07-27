import { useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCallback } from 'react';
import { BackButton } from '../src/components/BackButton';
import { colors, font, radius, shadow } from '../src/theme';
import { useT, LOCALE_LABELS, ALL_LOCALES } from '../src/i18n';
import { useSession, type Locale, type Currency } from '../src/store/session';
import { selection, tap } from '../src/haptics';
import { ALL_CURRENCIES } from '../src/currency/fx';
import { db } from '../src/data';
import type { NotificationPrefs, NotificationPrefsPatch } from '../src/data/types';
import {
  DEFAULT_NOTIFICATION_PREFS as DEFAULT_PREFS,
  formatQuietWindow,
} from '../src/lib/notificationPrefs';
import { getReleaseInfo, formatReleaseLine } from '../src/lib/release';
import { getPermissionDecision } from '../src/lib/push';
import type { PermissionDecision } from '../src/lib/pushPermission';

// 22:00–08:00 local. Sharm dines late, so a window starting much earlier would
// suppress offers during real ordering hours.
const DEFAULT_QUIET_START = 22;
const DEFAULT_QUIET_END = 8;

export default function Settings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  const locale = useSession((s) => s.locale);
  const setLocale = useSession((s) => s.setLocale);
  const currency = useSession((s) => s.currency);
  const setCurrency = useSession((s) => s.setCurrency);
  const [allergyCount, setAllergyCount] = useState(0);
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [prefsBusy, setPrefsBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  // OS-level permission state. When the customer has turned notifications off
  // in device settings, every in-app switch below is inert -- saying so is the
  // difference between a working control and a fake one.
  const [pushDecision, setPushDecision] = useState<PermissionDecision | null>(null);
  useEffect(() => {
    void getPermissionDecision().then(setPushDecision);
  }, []);

  // Release identity is fixed for the lifetime of the process — resolve once.
  const release = useMemo(() => getReleaseInfo(), []);
  const releaseLine = useMemo(() => formatReleaseLine(release), [release]);

  const copyDiagnostics = useCallback(async () => {
    // The full commit, not the shortened display form: support needs the value
    // that can actually be looked up in git.
    const detail = [
      releaseLine,
      release.commit ? `commit: ${release.commit}` : null,
      release.runtimeVersion ? `runtime: ${release.runtimeVersion}` : null,
      release.updateId ? `update: ${release.updateId}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    await Clipboard.setStringAsync(detail);
    tap();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [release, releaseLine]);

  useFocusEffect(
    useCallback(() => {
      db.user.getMe().then((u) => setAllergyCount(u.allergyProfile?.length ?? 0));
    }, []),
  );

  useEffect(() => {
    let cancelled = false;
    db.user
      .getNotificationPrefs()
      .then((p) => {
        if (!cancelled) setPrefs(p);
      })
      // Read failures leave the server-side defaults on screen. They are the
      // safe direction (marketing shown OFF), and the switch below always
      // re-reads the server's answer rather than trusting local state.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Optimistically flip the switch, then reconcile with what the server
   * actually stored. On failure we restore the SERVER's value rather than our
   * guess: leaving a switch showing "promotions off" when the opt-out never
   * persisted is exactly the lie this whole change exists to remove.
   */
  const savePrefs = async (patch: NotificationPrefsPatch) => {
    const previous = prefs;
    setPrefs((p) => ({
      ...p,
      ...(patch.transactional !== undefined ? { transactional: patch.transactional } : {}),
      ...(patch.marketing !== undefined ? { marketing: patch.marketing } : {}),
      ...(patch.clearQuietHours
        ? { quietHoursStart: null, quietHoursEnd: null }
        : {
            ...(patch.quietHoursStart !== undefined ? { quietHoursStart: patch.quietHoursStart } : {}),
            ...(patch.quietHoursEnd !== undefined ? { quietHoursEnd: patch.quietHoursEnd } : {}),
          }),
    }));
    setPrefsBusy(true);
    selection();
    try {
      const saved = await db.user.setNotificationPrefs(patch);
      setPrefs(saved);
    } catch {
      setPrefs(previous);
      Alert.alert(t('profile.notifications'), t('profile.notificationsSaveFailed'));
    } finally {
      setPrefsBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      <View style={[styles.head, { paddingTop: insets.top + 12 }]}>
        <BackButton />
        <Text style={styles.title}>{t('settings.title')}</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 + insets.bottom }}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('profile.language')}</Text>
          <View style={{ marginTop: 10, gap: 6 }}>
            {ALL_LOCALES.map((l) => {
              const isSel = locale === l;
              return (
                <Pressable
                  key={l}
                  onPress={() => {
                    selection();
                    setLocale(l as Locale);
                  }}
                  style={[styles.row, isSel && styles.rowActive]}>
                  <Text style={[styles.rowText, isSel && { color: colors.accent, fontWeight: font.weights.bold }]}>
                    {LOCALE_LABELS[l]}
                  </Text>
                  {isSel && <Text style={styles.check}>✓</Text>}
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('profile.currency')}</Text>
          <View style={{ marginTop: 10, gap: 6 }}>
            {ALL_CURRENCIES.map((c) => {
              const isSel = currency === c;
              return (
                <Pressable
                  key={c}
                  onPress={() => {
                    selection();
                    setCurrency(c as Currency);
                  }}
                  style={[styles.row, isSel && styles.rowActive]}>
                  <Text style={[styles.rowText, isSel && { color: colors.accent, fontWeight: font.weights.bold }]}>
                    {c}
                  </Text>
                  {isSel && <Text style={styles.check}>✓</Text>}
                </Pressable>
              );
            })}
          </View>
        </View>

        <Pressable
          onPress={() => {
            tap();
            router.push('/settings/allergies');
          }}
          style={styles.card}>
          <View style={styles.allergyRow}>
            <Text style={styles.cardTitle}>{t('profile.allergies')}</Text>
            <Text style={styles.allergyCount}>
              {allergyCount > 0 ? t('allergy.savedCount', { n: allergyCount }) : '+'}
            </Text>
          </View>
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('profile.notifications')}</Text>

          {/* If the OS is blocking notifications, the switches below cannot do
              anything. Show that plainly and point at the only place that can
              fix it, rather than re-prompting -- the OS would not show a dialog
              anyway (package 03 slice B). */}
          {pushDecision === 'settings_only' ? (
            <View style={styles.blockedBox}>
              <Text style={styles.blockedTitle}>{t('push.blockedTitle')}</Text>
              <Text style={styles.prefHint}>{t('push.blockedBody')}</Text>
              <Pressable
                onPress={() => {
                  tap();
                  void Linking.openSettings();
                }}
                accessibilityRole="button"
              >
                <Text style={styles.blockedLink}>{t('push.openSettings')}</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={[styles.prefRow, { marginTop: 10 }]}>
            <View style={styles.prefLabel}>
              <Text style={styles.rowText}>{t('profile.notificationsOrderUpdates')}</Text>
              <Text style={styles.prefHint}>{t('profile.notificationsOrderUpdatesHint')}</Text>
            </View>
            <Switch
              value={prefs.transactional}
              disabled={prefsBusy}
              onValueChange={(v) => savePrefs({ transactional: v })}
              trackColor={{ false: colors.line2, true: colors.accent }}
              accessibilityLabel={t('profile.notificationsOrderUpdates')}
            />
          </View>

          <View style={styles.prefRow}>
            <View style={styles.prefLabel}>
              <Text style={styles.rowText}>{t('profile.notificationsPromotions')}</Text>
              <Text style={styles.prefHint}>{t('profile.notificationsPromotionsHint')}</Text>
            </View>
            <Switch
              value={prefs.marketing}
              disabled={prefsBusy}
              onValueChange={(v) => savePrefs({ marketing: v })}
              trackColor={{ false: colors.line2, true: colors.accent }}
              accessibilityLabel={t('profile.notificationsPromotions')}
            />
          </View>

          {/* Quiet hours only affect promotions, so offering them while
              promotions are off would be a control with nothing to control. */}
          {prefs.marketing ? (
            <View style={styles.prefRow}>
              <View style={styles.prefLabel}>
                <Text style={styles.rowText}>{t('profile.notificationsQuietHours')}</Text>
                <Text style={styles.prefHint}>{t('profile.notificationsQuietHoursHint')}</Text>
              </View>
              <Switch
                value={prefs.quietHoursStart !== null}
                disabled={prefsBusy}
                onValueChange={(v) =>
                  savePrefs(
                    v
                      ? { quietHoursStart: DEFAULT_QUIET_START, quietHoursEnd: DEFAULT_QUIET_END }
                      : { clearQuietHours: true },
                  )
                }
                trackColor={{ false: colors.line2, true: colors.accent }}
                accessibilityLabel={t('profile.notificationsQuietHours')}
              />
            </View>
          ) : null}

          {prefs.marketing && formatQuietWindow(prefs) ? (
            <Text style={styles.quietWindow}>{formatQuietWindow(prefs)}</Text>
          ) : null}
        </View>

        {/* Build diagnostics (package 01 §3).
            Long-press copies the whole block: support needs to RECEIVE this,
            and a customer reading a build number down the phone gets it wrong.
            Deliberately last and visually quiet — operators need it, ordinary
            customers should not trip over it. */}
        <Pressable
          onLongPress={copyDiagnostics}
          delayLongPress={600}
          accessibilityRole="button"
          accessibilityLabel={t('settings.buildInfo')}
          accessibilityHint={t('settings.buildInfoCopyHint')}
          style={styles.card}>
          <Text style={styles.cardTitle}>{t('settings.buildInfo')}</Text>
          <Text style={styles.buildLine} selectable>
            {releaseLine}
          </Text>
          <Text style={styles.prefHint}>
            {copied ? t('settings.buildInfoCopied') : t('settings.buildInfoCopyHint')}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
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
  title: { fontSize: font.sizes['5xl'], fontWeight: font.weights.extrabold, letterSpacing: -0.4, color: colors.ink },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    ...shadow.soft,
  },
  cardTitle: { fontSize: font.sizes['2xl'], fontWeight: font.weights.bold, color: colors.ink },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: radius.md,
  },
  rowActive: { backgroundColor: colors.accentSoft },
  rowText: { fontSize: font.sizes.xl, color: colors.ink },
  check: { fontSize: 18, color: colors.accent },
  prefRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  prefLabel: { flex: 1 },
  prefHint: { fontSize: font.sizes.md, color: colors.ink3, marginTop: 2, lineHeight: 18 },
  quietWindow: {
    fontSize: font.sizes.lg,
    fontWeight: font.weights.bold,
    color: colors.ink2,
    paddingHorizontal: 10,
    paddingBottom: 6,
  },
  // Monospace so a build number read aloud or compared by eye is unambiguous
  // (l/1 and O/0 in a proportional face are a support-call hazard). Always LTR:
  // a SHA is not natural language and must not mirror under RTL.
  blockedBox: {
    marginTop: 10,
    padding: 12,
    borderRadius: radius.lg,
    backgroundColor: colors.sand,
  },
  blockedTitle: {
    fontSize: font.sizes.lg,
    fontWeight: font.weights.bold,
    color: colors.ink,
    marginBottom: 4,
  },
  blockedLink: {
    marginTop: 8,
    fontSize: font.sizes.lg,
    fontWeight: font.weights.bold,
    color: colors.accent,
  },
  buildLine: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: font.sizes.md,
    color: colors.ink2,
    marginTop: 8,
    writingDirection: 'ltr',
  },
  allergyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  allergyCount: {
    fontSize: font.sizes.lg,
    color: colors.accent,
    fontWeight: font.weights.bold,
  },
});
