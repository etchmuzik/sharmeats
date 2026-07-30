import { Text, View } from 'react-native';
import { Icon } from './Icon';
import type { AllergenKey } from '../orders';
import { colors, font, radius, spacing } from '../theme';
import { useLocale } from '../locale';

/**
 * [H-REST2] Prominent kitchen allergy briefing. `orders.aggregate_allergens` is
 * the DB's authoritative, deduplicated allergen list for an order — a food-safety
 * signal the kitchen MUST see. Rendered as a high-contrast red banner so it can't
 * be missed at a glance on a busy tablet. Renders nothing when there are none.
 */
export function AllergenBanner({ allergens }: { allergens: AllergenKey[] | null | undefined }) {
  const { direction, isRtl, t } = useLocale();
  if (!allergens || allergens.length === 0) return null;
  const labels = allergens.map((allergen) => t(`allergen.${allergen}`));
  return (
    <View
      accessibilityRole="alert"
      accessibilityLabel={t('allergen.alertA11y', { allergens: labels.join(', ') })}
      style={{
        borderWidth: 1.5,
        borderColor: colors.red,
        backgroundColor: colors.redSoft,
        borderRadius: radius.md,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        gap: spacing.xs,
        direction,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name="alert" size={16} color={colors.red} />
        <Text
          style={{
            fontSize: font.sizes.xs,
            fontWeight: '800',
            letterSpacing: isRtl ? 0 : 0.5,
            textTransform: isRtl ? 'none' : 'uppercase',
            color: colors.red,
          }}
        >
          {t('allergen.alert')}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {allergens.map((a, index) => (
          <View
            key={a}
            style={{
              borderRadius: radius.pill,
              backgroundColor: colors.red,
              paddingHorizontal: spacing.sm,
              paddingVertical: 2,
            }}
          >
            <Text style={{ fontSize: font.sizes.xs, fontWeight: '700', color: colors.white }}>
              {labels[index]}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
