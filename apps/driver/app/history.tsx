import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { getHistory, getMyDriver, type DeliveryHistoryItem } from '../src/jobs';
import { font, radius, spacing } from '../src/theme';
import { useThemeColors } from '../src/themeProvider';
import { Icon } from '../src/components/Icon';

/** Past deliveries for the signed-in driver, newest first (buried feature). */
export default function HistoryScreen() {
  const colors = useThemeColors();
  const [items, setItems] = useState<DeliveryHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const driver = await getMyDriver();
      if (!driver) {
        setItems([]);
        setError(false);
        return;
      }
      setItems(await getHistory(driver.id));
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : error ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl }}>
          <Text style={{ color: colors.ink2, textAlign: 'center' }}>Couldn't load your history.</Text>
          <Pressable
            onPress={() => {
              setLoading(true);
              load();
            }}
            style={{ marginTop: spacing.lg, backgroundColor: colors.accent, borderRadius: radius.lg, paddingVertical: spacing.md, paddingHorizontal: spacing.xl }}
          >
            <Text style={{ color: colors.onAccent, fontWeight: '700' }}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ padding: spacing.xl, gap: spacing.md, flexGrow: 1 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
            />
          }
          ListEmptyComponent={
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: spacing.xxxl }}>
              <Icon name="receipt" size={40} color={colors.ink3} accessibilityLabel="No deliveries" />
              <Text style={{ color: colors.ink2, marginTop: spacing.md, textAlign: 'center' }}>
                No deliveries yet.
              </Text>
              <Text style={{ color: colors.ink3, marginTop: 2, textAlign: 'center', fontSize: font.sizes.sm }}>
                Completed deliveries will show up here.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View
              style={{
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.line,
                borderRadius: radius.xl,
                padding: spacing.lg,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: spacing.md,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: font.sizes.base, fontWeight: '700', color: colors.ink }}>
                  {item.short_code} · {item.restaurant_name}
                </Text>
                <Text style={{ fontSize: font.sizes.sm, color: colors.ink3, marginTop: 2 }}>
                  {formatDate(item.created_at)}
                  {item.tip > 0 ? ` · ${item.tip} EGP tip` : ''}
                </Text>
              </View>
              <Text style={{ fontSize: font.sizes.lg, fontWeight: '800', color: colors.greenText }}>
                {item.total} EGP
              </Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

/** Compact "Mon 3 Jul, 14:20" style date; empty on parse failure. */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
