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
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToast } from '../src/components/Toast';
import { Icon } from '../src/components/Icon';
import { getMyRestaurant } from '../src/orders';
import { getMenuItems, setItemAvailability, type MenuItem } from '../src/menu';
import { colors, font, radius, spacing } from '../src/theme';

/**
 * Menu availability screen ("86-ing"). Staff flip a dish out-of-stock from the
 * tablet; place_order enforces `is_available`, so new orders for a sold-out item
 * are rejected immediately. Optimistic toggle with rollback on failure.
 */
export default function Menu() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { toast } = useToast();

  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const ctx = await getMyRestaurant();
      if (!ctx) {
        setItems([]);
        return;
      }
      const rows = await getMenuItems(ctx.restaurantId);
      setItems(rows);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not load menu', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

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
        toast(e instanceof Error ? e.message : 'Could not update item', 'error');
      } finally {
        setBusyIds((s) => {
          const nextSet = new Set(s);
          nextSet.delete(item.id);
          return nextSet;
        });
      }
    },
    [toast],
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
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Back header */}
      <View
        style={{
          paddingTop: insets.top + spacing.md,
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.md,
          backgroundColor: colors.white,
          borderBottomWidth: 1,
          borderBottomColor: colors.line,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          style={{ padding: spacing.xs }}
        >
          <Icon name="chevronBack" size={24} color={colors.ink} accessibilityLabel="Back" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: font.sizes.lg, fontWeight: '800', color: colors.ink }}>Menu availability</Text>
          <Text style={{ fontSize: font.sizes.xs, color: colors.ink3 }}>
            {outCount > 0 ? `${outCount} item${outCount === 1 ? '' : 's'} out of stock` : 'All items available'}
          </Text>
        </View>
      </View>

      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search items…"
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
          }}
        />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl, gap: spacing.sm }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
      >
        {filtered.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: spacing.xxxl * 2, gap: spacing.sm }}>
            <Icon name="restaurant" size={36} color={colors.ink3} accessibilityLabel="No items" />
            <Text style={{ fontSize: font.sizes.base, color: colors.ink2 }}>
              {items.length === 0 ? 'No menu items' : 'No matching items'}
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
                  {item.price_egp} EGP · {item.is_available ? 'Available' : 'Out of stock'}
                </Text>
              </View>
              <Switch
                value={item.is_available}
                onValueChange={() => toggle(item)}
                disabled={busyIds.has(item.id)}
                trackColor={{ true: colors.green, false: colors.line }}
                thumbColor={colors.white}
                accessibilityLabel={`${item.name} ${item.is_available ? 'available' : 'out of stock'}`}
              />
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}
