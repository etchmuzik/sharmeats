/**
 * "Prescription required" marker for a catalog item.
 *
 * WHY THIS EXISTS. Pharmacy is a live vertical and its catalog already contains
 * a prescription-only antibiotic. Until now the customer app discarded
 * `requires_prescription` when mapping menu rows, so that item rendered exactly
 * like sunscreen — same row, same price, same tap-to-add. A customer would only
 * learn about the requirement when the driver refused to hand the item over, at
 * the door, after paying.
 *
 * The server already enforces the rule (mig 160 refuses to let an Rx item exist
 * in a vertical that cannot express it). This component is the part that makes
 * the requirement VISIBLE, before checkout, where it can still change what the
 * customer does.
 *
 * Deliberately styled as a WARNING rather than a neutral tag: it is a condition
 * of delivery, not a garnish like "spicy" or "vegan". It reuses the app's red
 * accent so it reads with the same weight as an allergen conflict.
 */
import { Text, View } from 'react-native';
import { font, radius } from '../theme';
import { makeStyles, useThemeColors } from '../themeProvider';
import { Icon } from './Icon';
import { useT } from '../i18n';

export function RxBadge({ compact = false }: { compact?: boolean }) {
  const colors = useThemeColors();
  const styles = useStyles();
  const t = useT();
  return (
    <View
      style={[styles.badge, compact && styles.compact]}
      // One label for the whole badge: a screen reader should announce
      // "Prescription required", not "icon, Prescription required".
      accessible
      accessibilityRole="text"
      accessibilityLabel={t('item.rxRequired')}>
      <Icon name="warning" size={compact ? 11 : 13} color={colors.red} />
      <Text style={[styles.text, compact && styles.textCompact]} numberOfLines={1}>
        {t('item.rxRequired')}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: colors.redSoft,
    borderWidth: 1,
    borderColor: colors.red,
  },
  compact: { paddingHorizontal: 6, paddingVertical: 2, gap: 3 },
  text: { fontSize: font.sizes.sm, fontWeight: font.weights.bold, color: colors.red },
  textCompact: { fontSize: font.sizes.xs },
}));
