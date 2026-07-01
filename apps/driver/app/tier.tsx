import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getMyTier, type DriverTierInfo } from '../src/loyalty';
import { colors, font, radius, spacing } from '../src/theme';
import { Icon } from '../src/components/Icon';

const TIER_LABEL: Record<DriverTierInfo['tier'], string> = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
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
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tier, setTier] = useState<DriverTierInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const t = await getMyTier();
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

  const currentTier = tier?.tier ?? 'bronze';
  const nextTier = NEXT_TIER[currentTier];
  const nextThreshold = NEXT_THRESHOLD[currentTier];
  const deliveriesToNext =
    nextThreshold !== null ? Math.max(0, nextThreshold - (tier?.deliveriesRolling90d ?? 0)) : 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl }}
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
      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={8}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
      >
        <Icon name="chevronBack" size={18} color={colors.accent} />
        <Text style={{ color: colors.accent, fontWeight: '600' }}>Back</Text>
      </Pressable>

      <Text style={{ fontSize: font.sizes.xxl, fontWeight: '800', color: colors.ink, marginTop: spacing.md }}>
        {TIER_LABEL[currentTier]} tier
      </Text>

      {nextTier && nextThreshold !== null && (
        <Text style={{ color: colors.ink2, marginTop: spacing.xs }}>
          {deliveriesToNext} more {deliveriesToNext === 1 ? 'delivery' : 'deliveries'} to {TIER_LABEL[nextTier]}
        </Text>
      )}
      {!nextTier && (
        <Text style={{ color: colors.ink2, marginTop: spacing.xs }}>You've reached the top tier.</Text>
      )}

      <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
        <Stat label="Deliveries (90d)" value={String(tier?.deliveriesRolling90d ?? 0)} />
        <Stat label="Bonus / delivery" value={`+${tier?.bonusPerDeliveryEgp ?? 0} EGP`} />
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
        <Stat
          label="First look"
          value={tier?.firstLookSeconds ? `${tier.firstLookSeconds}s early` : 'Not yet'}
        />
        <Stat label="Acceptance rate" value={`${Math.round(tier?.acceptanceRateSnapshot ?? 100)}%`} />
      </View>
    </ScrollView>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: spacing.md }}>
      <Text style={{ fontSize: font.sizes.lg, fontWeight: '800', color: warn ? colors.amber : colors.ink }}>{value}</Text>
      <Text style={{ fontSize: font.sizes.xs, color: colors.ink2 }}>{label}</Text>
    </View>
  );
}
