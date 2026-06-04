import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius } from '../theme';
import { selection } from '../haptics';
import { useT } from '../i18n';
import { ALLERGY_KEYS, type AllergyKey } from '../data/types';

interface Props {
  selected: AllergyKey[];
  onChange: (next: AllergyKey[]) => void;
  conflictWith?: AllergyKey[];
}

const ALL: readonly AllergyKey[] = ALLERGY_KEYS;

export function AllergyChipRow({ selected, onChange, conflictWith }: Props) {
  const t = useT();
  const conflicts = new Set(conflictWith ?? []);
  const sel = new Set(selected);

  const toggle = (k: AllergyKey) => {
    selection();
    const next = new Set(sel);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    onChange(Array.from(next));
  };

  return (
    <View style={styles.wrap}>
      {ALL.map((k) => {
        const isSel = sel.has(k);
        const isConflict = conflicts.has(k) && isSel;
        return (
          <Pressable
            key={k}
            onPress={() => toggle(k)}
            style={[
              styles.chip,
              isSel && styles.chipSel,
              isConflict && styles.chipConflict,
            ]}>
            <Text
              style={[
                styles.label,
                isSel && styles.labelSel,
                isConflict && styles.labelConflict,
              ]}>
              {isConflict ? '⚠ ' : ''}
              {t(`allergy.${k}`)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSoft,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipSel: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  chipConflict: {
    backgroundColor: colors.redSoft,
    borderColor: colors.red,
  },
  label: {
    fontSize: font.sizes.lg,
    color: colors.ink,
    fontWeight: font.weights.bold,
  },
  labelSel: { color: colors.white },
  labelConflict: { color: colors.red },
});
