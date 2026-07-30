import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToast } from '../src/components/Toast';
import { Icon } from '../src/components/Icon';
import { getMyKitchen } from '../src/orders';
import { getMenuItems, setItemAvailability, type MenuItem } from '../src/menu';
import { colors, font, radius, spacing } from '../src/theme';
import { useLocale } from '../src/locale';
import { captureError } from '../src/lib/crash';
import { operationalErrorKey } from '../src/operationalErrors';

/**
 * Menu availability screen ("86-ing"). Staff flip a dish out-of-stock from the
 * tablet; place_order enforces `is_available`, so new orders for a sold-out item
 * are rejected immediately. Optimistic toggle with rollback on failure.
 */
export default function Menu() {
  const insets = useSafeAreaInsets();
  const { toast } = useToast();
  const { direction, isRtl, t } = useLocale();

  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  // [P06 Stage 3] Multi-brand 86 fix: this screen silently operated on the
  // LOWEST-id brand only, so a cloud-kitchen operator could never 86 an item
  // on brand two — the switch flipped the wrong storefront's menu. The brand
  // now comes from an explicit selector (single-brand accounts see no chips
  // and behave exactly as before: the default IS the lowest id).
  const [brands, setBrands] = useState<{ restaurantId: string; shortName: string }[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);

  const load = useCallback(
    async (brandId?: string | null) => {
      try {
        const kitchen = await getMyKitchen();
        if (!kitchen || kitchen.brands.length === 0) {
          setItems([]);
          return;
        }
        const sorted = [...kitchen.brands].sort((a, b) =>
          a.restaurantId.localeCompare(b.restaurantId),
        );
        setBrands(
          kitchen.isMultiBrand
            ? sorted.map((b) => ({ restaurantId: b.restaurantId, shortName: b.shortName }))
            : [],
        );
        const target =
          brandId && sorted.some((b) => b.restaurantId === brandId)
            ? brandId
            : sorted[0].restaurantId;
        setSelectedBrandId(target);
        const rows = await getMenuItems(target);
        setItems(rows);
      } catch (e) {
        captureError(e, {
          where: 'restaurant.menu.load',
          requestedRestaurantId: brandId ?? null,
        });
        toast(t(operationalErrorKey('menuLoad')), 'error');
      } finally {
        setLoading(false);
      }
    },
    [toast, t],
  );

  const selectBrand = useCallback(
    (brandId: string) => {
      if (brandId === selectedBrandId) return;
      setLoading(true);
      void load(brandId);
    },
    [selectedBrandId, load],
  );

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load(selectedBrandId);   // keep the operator's brand selection
    setRefreshing(false);
  }, [load, selectedBrandId]);

  const toggle = useCallback(
    async (item: MenuItem) => {
      const next = !item.is_available;
      setBusyIds((s) => new Set(s).add(item.id));
      // Optimistic flip.
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, is_available: next } : i)));
      try {
        await setItemAvailability(item.id, next);
      } catch (e) {
        // Roll back on failure.
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, is_available: !next } : i)));
        captureError(e, {
          where: 'restaurant.menu.setAvailability',
          itemId: item.id,
          intendedAvailable: next,
        });
        toast(t(operationalErrorKey('menuUpdate')), 'error');
      } finally {
        setBusyIds((s) => {
          const nextSet = new Set(s);
          nextSet.delete(item.id);
          return nextSet;
        });
      }
    },
    [toast, t],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.name.toLowerCase().includes(q));
  }, [items, query]);

  const outCount = useMemo(() => items.filter((i) => !i.is_available).length, [items]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, direction }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl, gap: spacing.sm }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
      >
        {brands.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {brands.map((b) => {
              const active = b.restaurantId === selectedBrandId;
              return (
                <Pressable
                  key={b.restaurantId}
                  onPress={() => selectBrand(b.restaurantId)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={t('menu.brandA11y', { brand: b.shortName })}
                  style={{
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.sm,
                    borderRadius: radius.lg,
                    borderWidth: 1,
                    borderColor: active ? colors.ink : colors.line,
                    backgroundColor: active ? colors.ink : colors.white,
                  }}
                >
                  <Text style={{ fontSize: font.sizes.xs, fontWeight: '800', color: active ? colors.white : colors.ink, writingDirection: 'ltr' }}>
                    {b.shortName}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        <Text style={{ fontSize: font.sizes.xs, color: colors.ink3 }}>
          {outCount === 0
            ? t('menu.allAvailable')
            : outCount === 1
              ? t('menu.outCountOne')
              : t('menu.outCountMany', { count: outCount })}
        </Text>

        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('menu.search')}
          placeholderTextColor={colors.ink3}
          style={{
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radius.lg,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            backgroundColor: colors.white,
            color: colors.ink,
            fontSize: font.sizes.base,
            textAlign: isRtl ? 'right' : 'left',
            writingDirection: direction,
          }}
        />

        {filtered.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: spacing.xxxl * 2, gap: spacing.sm }}>
            <Icon name="restaurant" size={36} color={colors.ink3} accessibilityLabel={t('menu.noItemsA11y')} />
            <Text style={{ fontSize: font.sizes.base, color: colors.ink2 }}>
              {items.length === 0 ? t('menu.noItems') : t('menu.noMatches')}
            </Text>
          </View>
        ) : (
          filtered.map((item) => (
            <View
              key={item.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                borderWidth: 1,
                borderColor: colors.line,
                borderRadius: radius.lg,
                backgroundColor: colors.white,
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.md,
                opacity: item.is_available ? 1 : 0.7,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: font.sizes.base, fontWeight: '700', color: colors.ink }} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={{ fontSize: font.sizes.xs, color: item.is_available ? colors.ink3 : colors.red, fontWeight: item.is_available ? '400' : '700' }}>
                  <Text style={{ writingDirection: 'ltr' }}>{item.price_egp} EGP</Text>
                  {' · '}
                  {item.is_available ? t('menu.available') : t('menu.outOfStock')}
                </Text>
              </View>
              <Switch
                value={item.is_available}
                onValueChange={() => toggle(item)}
                disabled={busyIds.has(item.id)}
                trackColor={{ true: colors.green, false: colors.line }}
                thumbColor={colors.white}
                accessibilityLabel={t('menu.itemAvailabilityA11y', {
                  item: item.name,
                  availability: item.is_available ? t('menu.available') : t('menu.outOfStock'),
                })}
              />
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}
