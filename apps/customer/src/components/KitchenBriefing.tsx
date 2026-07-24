import { StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, font, radius, shadow } from '../theme';
import { useT } from '../i18n';
import type { AllergyKey } from '../data/types';
import { Icon } from './Icon';

interface Props {
  allergens: AllergyKey[];
  notes: string;
  onChangeNotes: (next: string) => void;
}

export function KitchenBriefing({ allergens, notes, onChangeNotes }: Props) {
  const t = useT();
  const hasAllergens = allergens.length > 0;

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <Icon name="receipt" size={20} color={colors.ink} />
        <Text style={styles.title}>{t('checkout.kitchenBriefingTitle')}</Text>
      </View>
      <Text style={styles.desc}>{t('checkout.kitchenBriefingDesc')}</Text>

      {hasAllergens && (
        <View style={styles.allergyBox}>
          <Icon name="warning" size={20} color={colors.red} />
          <Text style={styles.allergyText}>
            {t('checkout.allergiesSummary', {
              allergens: allergens.map((a) => t(`allergy.${a}`)).join(', '),
            })}
          </Text>
        </View>
      )}

      <TextInput
        value={notes}
        onChangeText={onChangeNotes}
        placeholder={t('checkout.orderWideNotesPlaceholder')}
        placeholderTextColor={colors.ink3}
        multiline
        accessibilityLabel={t('checkout.kitchenBriefingTitle')}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    marginBottom: 14,
    ...shadow.soft,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: font.sizes['2xl'], fontWeight: font.weights.bold, color: colors.ink },
  desc: { fontSize: font.sizes.md, color: colors.ink2, marginTop: 4, lineHeight: 18 },
  allergyBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 12,
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: colors.redSoft,
    borderWidth: 1,
    borderColor: colors.red,
  },
  allergyText: {
    flex: 1,
    fontSize: font.sizes.lg,
    color: colors.red,
    fontWeight: font.weights.bold,
  },
  input: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 12,
    fontSize: font.sizes.lg,
    color: colors.ink,
    backgroundColor: colors.bg,
    minHeight: 60,
    textAlignVertical: 'top',
  },
});
