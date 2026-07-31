import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getMyTier, type DriverTierInfo } from '../src/loyalty';
import { font, radius, spacing } from '../src/theme';
import { useThemeColors } from '../src/themeProvider';
import { useI18n } from '../src/i18n-context';
import type { TranslationKey } from '../src/i18n';
import { captureError } from '../src/lib/crash';

const TIER_LABEL_KEY: Record<DriverTierInfo['tier'], TranslationKey> = {
  bronze: 'tier.bronze',
  silver: 'tier.silver',
  gold: 'tier.gold',
};

// Rolling-90-day delivery-count thresholds to advance a tier. Verified against
// the seeded platform_settings in supabase/migrations/042_loyalty_ledger.sql:
// loyalty_driver_silver_threshold = 60, loyalty_driver_gold_threshold = 200.
const NEXT_TIER: Record<DriverTierInfo['tier'], 'silver' | 'gold' | null> = {
  bronze: 'silver',
  silver: 'gold',
  gold: null,
};

const NEXT_THRESHOLD: Record<DriverTierInfo['tier'], number | null> = {
  bronze: 60,
  silver: 200,
  gold: null,
};

export default function Tier() {
  const colors = useThemeColors();
  const { direction, t } = useI18n();
  const [tier, setTier] = useState<DriverTierInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // my_driver_tier throwing left this screen on a spinner forever — no error,
  // no retry, nothing to do but force-quit. A tier screen is not worth a
  // support call.
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      setTier(await getMyTier());
      setError(false);
    } catch (e) {
      captureError(e, { where: 'driver.tier.load' });
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
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

  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xxl }}>
        <Text style={{ color: colors.ink2, textAlign: 'center', writingDirection: direction.writingDirection }}>
          {t('tier.loadError')}
        </Text>
        <Pressable
          onPress={() => {
            setLoading(true);
            void load();
          }}
          accessibilityRole="button"
          accessibilityLabel={t('common.retry')}
          style={{ minHeight: 48, justifyContent: 'center', backgroundColor: colors.accent, borderRadius: radius.lg, paddingHorizontal: spacing.xl }}
        >
          <Text style={{ color: colors.onAccent, fontWeight: '700' }}>{t('common.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  const currentTier = tier?.tier ?? 'bronze';
  const nextTier = NEXT_TIER[currentTier];
  const nextThreshold = NEXT_THRESHOLD[currentTier];
  const deliveriesToNext =
    nextThreshold !== null ? Math.max(0, nextThreshold - (tier?.deliveriesRolling90d ?? 0)) : 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        paddingTop: spacing.lg,
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.xxxl,
        direction: direction.direction,
      }}
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
      <Text style={{ fontSize: font.sizes.xxl, fontWeight: '800', color: colors.ink, textAlign: direction.textAlign }}>
        {t('tier.title', { tier: t(TIER_LABEL_KEY[currentTier]) })}
      </Text>

      {nextTier && nextThreshold !== null && (
        <Text style={{ color: colors.ink2, marginTop: spacing.xs, textAlign: direction.textAlign }}>
          {t(deliveriesToNext === 1 ? 'tier.toNextOne' : 'tier.toNextMany', {
            count: deliveriesToNext,
            tier: t(TIER_LABEL_KEY[nextTier]),
          })}
        </Text>
      )}
      {!nextTier && (
        <Text style={{ color: colors.ink2, marginTop: spacing.xs, textAlign: direction.textAlign }}>
          {t('tier.top')}
        </Text>
      )}

      <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
        <Stat label={t('tier.deliveries90d')} value={String(tier?.deliveriesRolling90d ?? 0)} />
        <Stat
          label={t('tier.bonusPerDelivery')}
          value={t('tier.bonusValue', { amount: tier?.bonusPerDeliveryEgp ?? 0 })}
        />
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
        <Stat
          label={t('tier.firstLook')}
          value={
            tier?.firstLookSeconds
              ? t('tier.firstLookValue', { seconds: tier.firstLookSeconds })
              : t('tier.firstLookNone')
          }
        />
        <Stat
          label={t('tier.acceptanceRate')}
          value={`${Math.round(tier?.acceptanceRateSnapshot ?? 100)}%`}
        />
      </View>
    </ScrollView>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  const colors = useThemeColors();
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: spacing.md }}>
      <Text style={{ fontSize: font.sizes.lg, fontWeight: '800', color: warn ? colors.amber : colors.ink }}>{value}</Text>
      <Text style={{ fontSize: font.sizes.xs, color: colors.ink2 }}>{label}</Text>
    </View>
  );
}
