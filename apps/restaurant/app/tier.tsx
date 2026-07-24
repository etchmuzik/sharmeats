import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getMyRestaurantTier, type RestaurantTierInfo } from '../src/loyalty';
import { colors, font, radius, spacing } from '../src/theme';
import { Icon } from '../src/components/Icon';

const TIER_LABEL: Record<RestaurantTierInfo['tier'], string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };

// Rolling-90-day delivered-order-count thresholds to advance a tier. Verified
// against the seeded platform_settings in supabase/migrations/042_loyalty_ledger.sql:
// loyalty_restaurant_silver_threshold = 50, loyalty_restaurant_gold_threshold = 200.
const NEXT_THRESHOLD: Record<RestaurantTierInfo['tier'], number | null> = { bronze: 50, silver: 200, gold: null };
const TIER_FLOOR: Record<RestaurantTierInfo['tier'], number> = { bronze: 0, silver: 50, gold: 200 };

export default function Tier() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tier, setTier] = useState<RestaurantTierInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const t = await getMyRestaurantTier();
    setTier(t);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const nextThreshold = tier ? NEXT_THRESHOLD[tier.tier] : null;
  const ordersToNext = tier && nextThreshold ? Math.max(0, nextThreshold - tier.ordersRolling90d) : 0;
  const floor = tier ? TIER_FLOOR[tier.tier] : 0;
  const progress = tier && nextThreshold
    ? Math.max(0, Math.min(1, (tier.ordersRolling90d - floor) / (nextThreshold - floor)))
    : 1;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
        />
      }
    >
      <View style={{ paddingTop: insets.top + spacing.lg }}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          style={styles.back}
        >
          <Icon name="chevronBack" size={18} color={colors.accent} />
          <Text style={{ color: colors.accent, fontWeight: '600' }}>Back</Text>
        </Pressable>
      </View>

      <Text style={styles.title}>
        {tier ? TIER_LABEL[tier.tier] : 'Bronze'} tier
      </Text>
      {tier?.featured && (
        <Text style={{ color: colors.accent, fontWeight: '600', marginTop: spacing.xs }}>Featured placement active</Text>
      )}
      {nextThreshold ? (
        <Text style={{ color: colors.ink2, marginTop: spacing.xs }}>{ordersToNext} more orders to next tier</Text>
      ) : (
        <Text style={{ color: colors.ink2, marginTop: spacing.xs }}>You&apos;ve reached the top tier.</Text>
      )}

      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Delivered-order progress to the next restaurant tier"
        accessibilityValue={{
          min: floor,
          max: nextThreshold ?? Math.max(floor, tier?.ordersRolling90d ?? floor),
          now: tier?.ordersRolling90d ?? 0,
          text: nextThreshold ? `${ordersToNext} more orders` : 'Top tier reached',
        }}
        style={styles.progressSection}
      >
        <View style={styles.progressHeading}>
          <Text style={styles.sectionTitle}>90-day delivery progress</Text>
          <Text style={styles.progressCount}>
            {tier?.ordersRolling90d ?? 0}{nextThreshold ? ` / ${nextThreshold}` : ''}
          </Text>
        </View>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
        <Text style={styles.progressHint}>
          {nextThreshold ? `${ordersToNext} delivered orders to the next tier` : 'You have every restaurant tier benefit.'}
        </Text>
      </View>

      <View style={styles.benefits}>
        <Text style={styles.sectionTitle}>Your benefits</Text>
        <Benefit label="Current commission" value={`${(tier?.commissionPct ?? 12).toFixed(1)}%`} />
        <Benefit
          label="Featured placement"
          value={tier?.featured ? 'Active' : tier?.tier === 'gold' ? 'Activating' : 'Unlocks at Gold'}
        />
        {tier?.tier === 'bronze' && <Benefit label="Next benefit" value="Silver: 1 point lower commission" />}
        {tier?.tier === 'silver' && <Benefit label="Next benefit" value="Gold: 2 points lower commission and featured placement" />}
        {tier?.tier === 'gold' && <Benefit label="Status" value="All restaurant benefits unlocked" />}
      </View>
    </ScrollView>
  );
}

function Benefit({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.benefitRow}>
      <Text style={styles.benefitLabel}>{label}</Text>
      <Text style={styles.benefitValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  back: { minHeight: 44, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 2 },
  title: { marginTop: spacing.md, fontSize: font.sizes.xxl, fontWeight: '800', color: colors.ink },
  progressSection: {
    marginTop: spacing.xl,
    paddingVertical: spacing.lg,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  progressHeading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.md },
  sectionTitle: { flex: 1, fontSize: font.sizes.lg, fontWeight: '800', color: colors.ink },
  progressCount: { fontSize: font.sizes.base, fontWeight: '800', color: colors.accentDark },
  track: { height: 10, marginTop: spacing.md, overflow: 'hidden', borderRadius: radius.pill, backgroundColor: colors.sand },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.accent },
  progressHint: { marginTop: spacing.sm, fontSize: font.sizes.sm, color: colors.ink2 },
  benefits: {
    marginTop: spacing.xl,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.xl,
    backgroundColor: colors.white,
    padding: spacing.lg,
    gap: spacing.md,
  },
  benefitRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: spacing.md,
  },
  benefitLabel: { flex: 1, fontSize: font.sizes.sm, color: colors.ink2 },
  benefitValue: { flexShrink: 1, maxWidth: '58%', fontSize: font.sizes.sm, fontWeight: '700', color: colors.ink, textAlign: 'right' },
});
