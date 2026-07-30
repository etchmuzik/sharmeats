/**
 * Today's earnings at a glance: total, delivery count, tips, and COD owed.
 *
 * COD owed is the one figure that can be *bad news* — it is money the driver is
 * holding on the platform's behalf and will have to settle. It gets amber
 * treatment plus an explicit label rather than sitting silently among the
 * positive numbers.
 */
import { Text, View } from 'react-native';
import type { EarningsSummary } from '../jobs';
import { font, radius, spacing } from '../theme';
import { useThemeColors } from '../themeProvider';
import { useI18n } from '../i18n-context';

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  const colors = useThemeColors();
  return (
    <View
      style={{
        flexGrow: 1,
        flexBasis: '46%',
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: warn ? colors.amber : colors.line,
        borderRadius: radius.lg,
        borderCurve: 'continuous',
        padding: spacing.md,
        gap: 2,
      }}
    >
      <Text
        selectable
        style={{
          fontSize: font.sizes.xl,
          fontWeight: '800',
          color: warn ? colors.amberText : colors.ink,
          fontVariant: ['tabular-nums'],
        }}
      >
        {value}
      </Text>
      <Text style={{ fontSize: font.sizes.xs, color: colors.ink2 }}>{label}</Text>
    </View>
  );
}

export function EarningsGrid({ earnings }: { earnings: EarningsSummary }) {
  const { t } = useI18n();

  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.md,
        paddingHorizontal: spacing.xl,
      }}
    >
      <Stat label={t('earnings.today')} value={`${earnings.todayTotal} ${t('common.egp')}`} />
      <Stat label={t('earnings.deliveries')} value={`${earnings.todayCount}`} />
      <Stat label={t('earnings.tips')} value={`${earnings.todayTips} ${t('common.egp')}`} />
      {/* Any NON-ZERO balance is an outstanding cash position and gets the amber
          treatment. Testing `> 0` alone was wrong: a negative figure (seen on a
          real account as "-810 EGP") is still money to reconcile, and it
          rendered in plain ink — the one number on this screen that can be bad
          news, styled as though it were routine. */}
      <Stat
        label={earnings.codOwed !== 0 ? t('earnings.cashToSettle') : t('earnings.codOwed')}
        value={`${earnings.codOwed} ${t('common.egp')}`}
        warn={earnings.codOwed !== 0}
      />
    </View>
  );
}
