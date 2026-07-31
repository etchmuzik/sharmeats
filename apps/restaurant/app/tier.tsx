import { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getMyRestaurantTier, type RestaurantTierInfo } from '../src/loyalty';
import { font, radius, spacing } from '../src/theme';
import { makeStyles, useThemeColors } from '../src/themeProvider';
import { useLocale } from '../src/locale';
import type { TranslationKey } from '../src/i18n';

const TIER_LABEL_KEY: Record<RestaurantTierInfo['tier'], TranslationKey> = {
  bronze: 'tier.bronze',
  silver: 'tier.silver',
  gold: 'tier.gold',
};

// Rolling-90-day delivered-order-count thresholds to advance a tier. Verified
// against the seeded platform_settings in supabase/migrations/042_loyalty_ledger.sql:
// loyalty_restaurant_silver_threshold = 50, loyalty_restaurant_gold_threshold = 200.
const NEXT_THRESHOLD: Record<RestaurantTierInfo['tier'], number | null> = { bronze: 50, silver: 200, gold: null };
const TIER_FLOOR: Record<RestaurantTierInfo['tier'], number> = { bronze: 0, silver: 50, gold: 200 };

export default function Tier() {
  const colors = useThemeColors();
  const styles = useStyles();
  const { direction, t } = useLocale();
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
      style={{ flex: 1, backgroundColor: colors.bg, direction }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
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
      <Text style={styles.title}>
        {t('tier.title', { tier: t(TIER_LABEL_KEY[tier?.tier ?? 'bronze']) })}
      </Text>
      {tier?.featured && (
        <Text style={{ color: colors.accentText, fontWeight: '600', marginTop: spacing.xs }}>
          {t('tier.featured')}
        </Text>
      )}
      {nextThreshold ? (
        <Text style={{ color: colors.ink2, marginTop: spacing.xs }}>
          {t('tier.ordersToNext', { count: ordersToNext })}
        </Text>
      ) : (
        <Text style={{ color: colors.ink2, marginTop: spacing.xs }}>{t('tier.topTier')}</Text>
      )}

      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={t('tier.progressA11y')}
        accessibilityValue={{
          min: floor,
          max: nextThreshold ?? Math.max(floor, tier?.ordersRolling90d ?? floor),
          now: tier?.ordersRolling90d ?? 0,
          text: nextThreshold
            ? t('tier.progressMoreA11y', { count: ordersToNext })
            : t('tier.progressTopA11y'),
        }}
        style={styles.progressSection}
      >
        <View style={styles.progressHeading}>
          <Text style={styles.sectionTitle}>{t('tier.progressTitle')}</Text>
          <Text style={styles.progressCount}>
            {tier?.ordersRolling90d ?? 0}{nextThreshold ? ` / ${nextThreshold}` : ''}
          </Text>
        </View>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
        <Text style={styles.progressHint}>
          {nextThreshold
            ? t('tier.progressHint', { count: ordersToNext })
            : t('tier.progressHintTop')}
        </Text>
      </View>

      <View style={styles.benefits}>
        <Text style={styles.sectionTitle}>{t('tier.benefits')}</Text>
        <Benefit label={t('tier.commission')} value={`${(tier?.commissionPct ?? 12).toFixed(1)}%`} />
        <Benefit
          label={t('tier.featuredLabel')}
          value={
            tier?.featured
              ? t('tier.featuredActive')
              : tier?.tier === 'gold'
                ? t('tier.featuredActivating')
                : t('tier.featuredLocked')
          }
        />
        {tier?.tier === 'bronze' && (
          <Benefit label={t('tier.nextBenefit')} value={t('tier.nextSilver')} />
        )}
        {tier?.tier === 'silver' && (
          <Benefit label={t('tier.nextBenefit')} value={t('tier.nextGold')} />
        )}
        {tier?.tier === 'gold' && (
          <Benefit label={t('tier.statusLabel')} value={t('tier.statusGold')} />
        )}
      </View>
    </ScrollView>
  );
}

function Benefit({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.benefitRow}>
      <Text style={styles.benefitLabel}>{label}</Text>
      <Text style={styles.benefitValue}>{value}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  content: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
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
    backgroundColor: colors.surface,
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
}));

/**
 * Per-ROUTE recovery. The root layout already exports this, but a boundary that
 * only exists at the root means any throw anywhere unmounts the whole stack —
 * including the kitchen queue. Exported here as well so a crash on this screen
 * is contained to this screen and offers Retry / Home instead.
 */
export { ScreenErrorBoundary as ErrorBoundary } from '../src/components/ScreenErrorBoundary';
