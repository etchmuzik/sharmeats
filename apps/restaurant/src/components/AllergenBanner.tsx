import { Text, View } from 'react-native';
import { Icon } from './Icon';
import { allergenLabel, type AllergenKey } from '../orders';
import { colors, font, radius, spacing } from '../theme';

/**
 * [H-REST2] Prominent kitchen allergy briefing. `orders.aggregate_allergens` is
 * the DB's authoritative, deduplicated allergen list for an order — a food-safety
 * signal the kitchen MUST see. Rendered as a high-contrast red banner so it can't
 * be missed at a glance on a busy tablet. Renders nothing when there are none.
 */
export function AllergenBanner({ allergens }: { allergens: AllergenKey[] | null | undefined }) {
  if (!allergens || allergens.length === 0) return null;
  return (
    <View
      accessibilityRole="alert"
      accessibilityLabel={`Allergy alert: ${allergens.map(allergenLabel).join(', ')}`}
      style={{
        borderWidth: 1.5,
        borderColor: colors.red,
        backgroundColor: colors.redSoft,
        borderRadius: radius.md,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        gap: spacing.xs,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name="alert" size={16} color={colors.red} />
        <Text
          style={{
            fontSize: font.sizes.xs,
            fontWeight: '800',
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            color: colors.red,
          }}
        >
          Allergy alert
        </Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {allergens.map((a) => (
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
              {allergenLabel(a)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
