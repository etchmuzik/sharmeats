import { Pressable, Text } from 'react-native';
import { useI18n } from '../i18n-context';
import { font, radius, spacing } from '../theme';
import { useThemeColors } from '../themeProvider';

type Props = {
  inverted?: boolean;
};

export function LanguageToggle({ inverted = false }: Props) {
  const colors = useThemeColors();
  const { locale, toggleLocale, t } = useI18n();
  const targetIsArabic = locale === 'en';
  const label = targetIsArabic
    ? t('language.switchToArabic')
    : t('language.switchToEnglish');
  const accessibilityLabel = targetIsArabic
    ? t('language.switchA11yArabic')
    : t('language.switchA11yEnglish');

  return (
    <Pressable
      onPress={toggleLocale}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({
        minHeight: 44,
        minWidth: 72,
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'flex-start',
        paddingHorizontal: spacing.md,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: inverted ? 'rgba(255,253,250,0.6)' : colors.line,
        backgroundColor: inverted ? 'rgba(255,253,250,0.12)' : colors.surface,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text
        style={{
          // `inverted` renders on the theme-invariant accent hero, so it keeps a
          // literal near-white; the normal branch follows the palette.
          color: inverted ? colors.white : colors.accentDark,
          fontSize: font.sizes.sm,
          fontWeight: '800',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
