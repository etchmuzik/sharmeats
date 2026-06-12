import { Image, Pressable, Text, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { colors, radius, font, shadow } from '../theme';
import { tap, selection } from '../haptics';
import { formatEgp, formatKm, formatPrepTime } from '../lib/format';
import { closedReasonKey, effectiveIsOpen } from '../lib/openHours';
import { useFavorite } from '../lib/favorites';
import type { Restaurant } from '../data/types';
import { TouristSafeBadge } from './TouristSafeBadge';
import { useT } from '../i18n';

export function RestaurantCard({ restaurant }: { restaurant: Restaurant }) {
  const router = useRouter();
  const t = useT();
  const open = effectiveIsOpen(restaurant);
  const closedReason = closedReasonKey(restaurant);
  const { isFav, toggle } = useFavorite(restaurant.id);
  return (
    <Pressable
      onPress={() => {
        tap();
        router.push(`/restaurant/${restaurant.id}` as never);
      }}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}>
      <Image source={{ uri: restaurant.coverImage }} style={styles.ph} />
      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text style={styles.name} numberOfLines={1}>
            {restaurant.name}
          </Text>
          {!open && (
            <View style={styles.closedPill}>
              <Text style={styles.closedText}>
                {closedReason === 'fridayPrayer' ? t('restaurant.fridayPrayer') : t('restaurant.closed')}
              </Text>
            </View>
          )}
          <Pressable
            onPress={() => {
              selection();
              toggle();
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityState={{ selected: isFav }}
            accessibilityLabel={isFav ? t('fav.remove') : t('fav.add')}
            style={styles.heartBtn}>
            <Text style={[styles.heart, isFav && { color: colors.accent }]}>
              {isFav ? '♥' : '♡'}
            </Text>
          </Pressable>
        </View>
        <Text style={styles.cuisine}>{restaurant.cuisineLabel}</Text>
        <View style={styles.badgeRow}>
          {restaurant.isOpen24h && (
            <View style={styles.open24Pill}>
              <Text style={styles.open24Text}>{t('restaurant.open24h')}</Text>
            </View>
          )}
          {restaurant.touristSafe && <TouristSafeBadge />}
          {restaurant.promo && (
            <View style={styles.promoPill}>
              <Text style={styles.promoText}>{restaurant.promo}</Text>
            </View>
          )}
        </View>
        <View style={styles.metrics}>
          <Text style={styles.rating}>★ {restaurant.rating.toFixed(1)}</Text>
          <Text style={styles.metric}>({restaurant.ratingCount})</Text>
          <View style={styles.dot} />
          <Text style={styles.metric}>{formatPrepTime(restaurant.prepTimeLow, restaurant.prepTimeHigh)}</Text>
          <View style={styles.dot} />
          <Text style={styles.metric}>{formatEgp(restaurant.deliveryFeeEgp)}</Text>
          <View style={styles.dot} />
          <Text style={styles.metric}>{formatKm(restaurant.distanceMeters)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.xl,
    padding: 10,
    ...shadow.soft,
  },
  ph: { width: 96, height: 96, borderRadius: radius.md, backgroundColor: colors.bgSoft },
  body: { flex: 1, gap: 4 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { fontSize: font.sizes['3xl'], fontWeight: font.weights.bold, color: colors.ink, flex: 1 },
  cuisine: { fontSize: font.sizes.md, color: colors.ink2 },
  badgeRow: { flexDirection: 'row', gap: 6, marginTop: 2 },
  metrics: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 'auto', flexWrap: 'wrap' },
  rating: { fontSize: font.sizes.md, color: colors.ink, fontWeight: font.weights.bold },
  metric: { fontSize: font.sizes.md, color: colors.ink2 },
  dot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: colors.ink3 },
  closedPill: {
    backgroundColor: colors.bgSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  closedText: { fontSize: font.sizes.xs, color: colors.ink2, fontWeight: font.weights.bold },
  heartBtn: { paddingLeft: 6 },
  heart: { fontSize: 19, color: colors.ink3, lineHeight: 21 },
  promoPill: {
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 5,
  },
  promoText: { fontSize: 10, color: colors.accentDark, fontWeight: font.weights.bold },
  open24Pill: {
    backgroundColor: colors.green,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 5,
  },
  open24Text: { fontSize: 10, color: colors.white, fontWeight: font.weights.bold, letterSpacing: 0.3 },
});
