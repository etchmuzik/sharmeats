import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
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

      <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
        <Stat label="Orders (90d)" value={String(tier?.ordersRolling90d ?? 0)} />
        <Stat label="Commission" value={`${(tier?.commissionPct ?? 12).toFixed(1)}%`} />
      </View>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: spacing.md }}>
      <Text style={{ fontSize: font.sizes.lg, fontWeight: '800', color: colors.ink }}>{value}</Text>
      <Text style={{ fontSize: font.sizes.xs, color: colors.ink2 }}>{label}</Text>
    </View>
  );
}
