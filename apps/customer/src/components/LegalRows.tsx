import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font } from '../theme';
import { Icon } from './Icon';
import { useT } from '../i18n';
import { useDirection } from '../lib/direction';
import { tap } from '../haptics';
import { LEGAL_URLS, openLegal } from '../legal';

/**
 * Two tappable rows — Terms of Service, Privacy Policy — that open the live
 * legal pages in the in-app browser. Styled to match the Profile list rows so
 * it drops into the existing settings/profile card without a new design system.
 */
export function LegalRows() {
  const t = useT();
  const dir = useDirection();

  const rows: { label: string; url: (typeof LEGAL_URLS)[keyof typeof LEGAL_URLS] }[] = [
    { label: t('legal.terms'), url: LEGAL_URLS.terms },
    { label: t('legal.privacy'), url: LEGAL_URLS.privacy },
  ];

  return (
    <>
      {rows.map((r, i) => (
        <Pressable
          key={r.label}
          onPress={() => {
            tap();
            openLegal(r.url);
          }}
          accessibilityRole="link"
          accessibilityLabel={r.label}
          style={({ pressed }) => [
            styles.row,
            dir.row,
            i < rows.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.line },
            pressed && { backgroundColor: colors.bgSoft },
          ]}>
          <View style={styles.rowIcon}>
            <Icon name="doc" size={20} color={colors.ink2} />
          </View>
          <Text style={[styles.rowLabel, dir.text]}>{r.label}</Text>
          <Icon name={dir.isRtl ? 'chevronBack' : 'chevronForward'} size={18} color={colors.ink3} />
        </Pressable>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 14 },
  rowIcon: { width: 26, alignItems: 'center' },
  rowLabel: { flex: 1, fontSize: font.sizes.xl, color: colors.ink, fontWeight: font.weights.semibold },
});
