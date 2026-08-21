import { Image, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { radius, font, shadow } from '../theme';
import { makeStyles, useThemeColors } from '../themeProvider';
import { selection } from '../haptics';
import { PressableScale } from './PressableScale';
import { formatEgp, formatKm, formatNumber, formatPrepTime } from '../lib/format';
import { closedReasonKey, effectiveIsOpen } from '../lib/openHours';
import { useFavorite } from '../lib/favorites';
import type { Restaurant } from '../data/types';
import { OwnBrandBadge } from './OwnBrandBadge';
import { useT } from '../i18n';
import { useSession } from '../store/session';
import { useDirection } from '../lib/direction';

export function RestaurantCard({
  restaurant,
  onOpen,
}: {
  restaurant: Restaurant;
  /**
   * Side-effect to run just before navigating. Browse uses it to record a
   * search the user followed through on; the card itself stays responsible for
   * navigation so every caller behaves the same.
   */
  onOpen?: () => void;
}) {
  const colors = useThemeColors();
  const styles = useStyles();
  const router = useRouter();
  const t = useT();
  const locale = useSession((s) => s.locale);
  const dir = useDirection();
  const open = effectiveIsOpen(restaurant);
  const closedReason = closedReasonKey(restaurant);
  const { isFav, toggle } = useFavorite(restaurant.id);
  return (
    <View style={[styles.card, dir.row]}>
      <PressableScale
        haptic="tap"
        onPress={() => {
          onOpen?.();
          router.push(`/restaurant/${restaurant.id}` as never);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${restaurant.name}, ${restaurant.cuisineLabel}, ${t('restaurant.ratings', { count: restaurant.ratingCount })}`}
        style={[styles.cardBody, dir.row]}>
        <Image source={{ uri: restaurant.coverImage }} style={styles.ph} />
        <View style={styles.body}>
          <View style={[styles.topRow, dir.row]}>
            <Text style={[styles.name, dir.text, styles.nameWithHeart]} numberOfLines={1}>
              {restaurant.name}
            </Text>
            {!open && (
              <View style={styles.closedPill}>
                <Text style={[styles.closedText, dir.text]}>
                  {closedReason === 'fridayPrayer' ? t('restaurant.fridayPrayer') : t('restaurant.closed')}
                </Text>
              </View>
            )}
          </View>
          <Text style={[styles.cuisine, dir.text]}>{restaurant.cuisineLabel}</Text>
          <View style={[styles.badgeRow, dir.row]}>
            {restaurant.isOpen24h && (
              <View style={styles.open24Pill}>
                <Text style={styles.open24Text}>{t('restaurant.open24h')}</Text>
              </View>
            )}
            {restaurant.isOwnBrand && <OwnBrandBadge />}
            {restaurant.promo && (
              <View style={styles.promoPill}>
                <Text style={styles.promoText}>{restaurant.promo}</Text>
              </View>
            )}
          </View>
          <View style={[styles.metrics, dir.row]}>
            <Text style={[styles.rating, dir.text]}>★ {formatNumber(restaurant.rating, locale)}</Text>
            <Text style={[styles.metric, dir.text]}>({formatNumber(restaurant.ratingCount, locale)})</Text>
            <View style={styles.dot} />
            <Text style={[styles.metric, dir.text]}>{formatPrepTime(restaurant.prepTimeLow, restaurant.prepTimeHigh, locale)}</Text>
            <View style={styles.dot} />
            <Text style={[styles.metric, dir.text]}>{formatEgp(restaurant.deliveryFeeEgp, locale)}</Text>
            {restaurant.distanceMeters > 0 && (
              <>
                <View style={styles.dot} />
                <Text style={[styles.metric, dir.text]}>{formatKm(restaurant.distanceMeters, locale)}</Text>
              </>
            )}
          </View>
        </View>
      </PressableScale>
      <Pressable
        onPress={() => {
          selection();
          toggle();
        }}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityState={{ selected: isFav }}
        accessibilityLabel={isFav ? t('fav.remove') : t('fav.add')}
        style={[styles.heartBtn, dir.isRtl ? styles.heartBtnRtl : styles.heartBtnLtr]}>
        <Text style={[styles.heart, isFav && { color: colors.accent }]}>
          {isFav ? '♥' : '♡'}
        </Text>
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.xl,
    ...shadow.soft,
  },
  cardBody: {
    // The outer card is a flex row (dir.row); without flex: 1 this pressable
    // shrinks to content, its flex:1 body collapses to zero width, and every
    // text inside wraps letter-by-letter (broken since f859aa7).
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 10,
  },
  ph: { width: 96, height: 96, borderRadius: radius.md, backgroundColor: colors.bgSoft },
  body: { flex: 1, gap: 4 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { fontSize: font.sizes['3xl'], fontWeight: font.weights.bold, color: colors.ink, flex: 1 },
  nameWithHeart: { paddingEnd: 28 },
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
  heartBtn: { position: 'absolute', top: 10, padding: 6 },
  heartBtnLtr: { right: 10 },
  heartBtnRtl: { left: 10 },
  heart: { fontSize: 19, color: colors.ink3, lineHeight: 21 },
  promoPill: {
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 5,
  },
  promoText: { fontSize: font.sizes.xs, color: colors.accentDark, fontWeight: font.weights.bold },
  open24Pill: {
    backgroundColor: colors.green,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 5,
  },
  open24Text: { fontSize: font.sizes.xs, color: colors.onAccent, fontWeight: font.weights.bold, letterSpacing: 0.3 },
}));
