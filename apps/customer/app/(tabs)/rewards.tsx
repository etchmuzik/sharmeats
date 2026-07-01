import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../src/components/Icon';
import { colors, font, radius, shadow } from '../../src/theme';
import { useT } from '../../src/i18n';
import { useDirection } from '../../src/lib/direction';
import { tap, success } from '../../src/haptics';
import { db } from '../../src/data';
import type { RewardsHistoryEntry, RewardsStatus } from '../../src/data/types';

type ViewState =
  | { kind: 'loading' }
  | { kind: 'loaded'; status: RewardsStatus; history: RewardsHistoryEntry[] }
  | { kind: 'error' };

// Rolling-12mo point thresholds for tier progression, mirrored from
// platform_settings (migration 042): loyalty_customer_silver_threshold=500,
// loyalty_customer_gold_threshold=2000.
const TIER_NEXT: Record<RewardsStatus['tier'], { next: RewardsStatus['tier'] | null; threshold: number }> = {
  bronze: { next: 'silver', threshold: 500 },
  silver: { next: 'gold', threshold: 2000 },
  gold: { next: null, threshold: 0 },
};

// RewardsHistoryEntry.reason is a typed union, not display text — the Task 8
// i18n set has no per-reason copy, so map to short plain-English fallbacks
// rather than leaking raw enum values ("order_earn") into the UI.
const REASON_LABEL: Record<RewardsHistoryEntry['reason'], string> = {
  order_earn: 'Order reward',
  redeem: 'Redeemed',
  clawback: 'Adjustment',
  tier_bonus: 'Tier bonus',
};

const REDEEM_POINTS = 100;

export default function RewardsTab() {
  const insets = useSafeAreaInsets();
  const t = useT();
  const dir = useDirection();
  const [state, setState] = useState<ViewState>({ kind: 'loading' });
  const [redeeming, setRedeeming] = useState(false);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const [status, history] = await Promise.all([
        db.rewards.getStatus(),
        db.rewards.listHistory(20),
      ]);
      setState({ kind: 'loaded', status, history });
    } catch {
      setState({ kind: 'error' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const redeem = async (points: number) => {
    if (state.kind !== 'loaded' || redeeming) return;
    tap();
    setRedeeming(true);
    try {
      const code = await db.rewards.redeem(points);
      success();
      Alert.alert(t('rewards.title'), t('rewards.redeemSuccess', { code }));
      await load();
    } catch {
      Alert.alert(t('rewards.title'), t('rewards.redeemInsufficient'));
    } finally {
      setRedeeming(false);
    }
  };

  if (state.kind === 'loading') {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (state.kind === 'error') {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg, padding: 24 }]}>
        <Text style={{ color: colors.ink2, fontSize: font.sizes.lg }}>{t('rewards.title')}</Text>
        <Pressable onPress={() => void load()} style={{ marginTop: 12 }} accessibilityRole="button">
          <Text style={{ color: colors.accent, fontWeight: font.weights.bold }}>{t('common.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  const { status, history } = state;
  const nextInfo = TIER_NEXT[status.tier];
  const pointsToNext = nextInfo.next ? Math.max(0, nextInfo.threshold - status.pointsRolling12mo) : 0;
  const canRedeem = status.pointsBalance >= REDEEM_POINTS;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 14,
          paddingBottom: 120 + insets.bottom,
          paddingHorizontal: 20,
        }}>
        <Text style={[styles.title, dir.text]}>{t('rewards.title')}</Text>

        <View style={styles.balanceCard}>
          <View style={styles.balanceHead}>
            <View style={styles.giftCircle}>
              <Icon name="gift" size={28} color={colors.sea} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.balancePoints}>{t('rewards.pointsBalance', { points: status.pointsBalance })}</Text>
              <Text style={styles.tierLabel}>
                {t('rewards.tier', { tier: t(`rewards.tier${capitalize(status.tier)}`) })}
              </Text>
            </View>
          </View>
          {nextInfo.next && (
            <Text style={[styles.progressText, dir.text]}>
              {t('rewards.progressToNext', { points: pointsToNext, tier: t(`rewards.tier${capitalize(nextInfo.next)}`) })}
            </Text>
          )}
        </View>

        <View style={styles.perksCard}>
          <PerkRow text={t('rewards.perksFreeDelivery')} dir={dir} />
          <PerkRow text={t('rewards.perksMultiplier', { mult: tierMultiplier(status.tier) })} dir={dir} />
          <PerkRow text={t('rewards.perksPriority')} dir={dir} last />
        </View>

        <Pressable
          disabled={redeeming || !canRedeem}
          onPress={() => redeem(REDEEM_POINTS)}
          accessibilityRole="button"
          accessibilityLabel={t('rewards.redeemButton')}
          style={[styles.redeemBtn, { backgroundColor: canRedeem ? colors.accent : colors.line }]}>
          {redeeming ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.redeemBtnText}>{t('rewards.redeemButton')}</Text>
          )}
        </Pressable>

        <Text style={[styles.historyTitle, dir.text]}>{t('rewards.historyTitle')}</Text>
        {history.length === 0 ? (
          <Text style={[styles.historyEmpty, dir.text]}>{t('rewards.historyEmpty')}</Text>
        ) : (
          <View style={styles.historyCard}>
            {history.map((h, i) => (
              <View
                key={h.id}
                style={[
                  styles.historyRow,
                  dir.row,
                  i < history.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.line },
                ]}>
                <Text style={[styles.historyReason, dir.text]}>{REASON_LABEL[h.reason]}</Text>
                <Text style={[styles.historyDelta, { color: h.deltaPoints >= 0 ? colors.green : colors.ink3 }]}>
                  {h.deltaPoints >= 0 ? '+' : ''}
                  {h.deltaPoints}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function PerkRow({ text, dir, last }: { text: string; dir: ReturnType<typeof useDirection>; last?: boolean }) {
  return (
    <View style={[styles.perkRow, dir.row, !last && { borderBottomWidth: 1, borderBottomColor: colors.line }]}>
      <Icon name="star" size={16} color={colors.amber} />
      <Text style={[styles.perkText, dir.text]}>{text}</Text>
    </View>
  );
}

function tierMultiplier(tier: RewardsStatus['tier']): number {
  if (tier === 'gold') return 2;
  if (tier === 'silver') return 1.5;
  return 1;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: font.sizes['7xl'], fontWeight: font.weights.extrabold, color: colors.ink, letterSpacing: -0.4 },
  balanceCard: {
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    padding: 18,
    marginTop: 16,
    borderWidth: 1,
    borderColor: colors.line,
    ...shadow.soft,
  },
  balanceHead: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  giftCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.seaSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  balancePoints: { fontSize: font.sizes['8xl'], fontWeight: font.weights.extrabold, color: colors.accent },
  tierLabel: { fontSize: font.sizes.lg, color: colors.ink2, marginTop: 2, fontWeight: font.weights.semibold },
  progressText: { fontSize: font.sizes.base, color: colors.ink3, marginTop: 12 },
  perksCard: {
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    marginTop: 14,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
    ...shadow.soft,
  },
  perkRow: { alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  perkText: { flex: 1, fontSize: font.sizes.lg, color: colors.ink },
  redeemBtn: { borderRadius: radius.lg, paddingVertical: 15, alignItems: 'center', marginTop: 18, ...shadow.card },
  redeemBtnText: { color: colors.white, fontWeight: font.weights.bold, fontSize: font.sizes.xl },
  historyTitle: {
    fontSize: font.sizes['5xl'],
    fontWeight: font.weights.bold,
    color: colors.ink,
    marginTop: 28,
    marginBottom: 8,
  },
  historyEmpty: { color: colors.ink3, fontSize: font.sizes.lg },
  historyCard: {
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
    ...shadow.soft,
  },
  historyRow: { justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  historyReason: { color: colors.ink2, fontSize: font.sizes.lg },
  historyDelta: { fontWeight: font.weights.bold, fontSize: font.sizes.lg },
});
