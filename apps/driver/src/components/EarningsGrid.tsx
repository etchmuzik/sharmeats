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
import { colors, font, radius, spacing } from '../theme';

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View
      style={{
        flexGrow: 1,
        flexBasis: '46%',
        backgroundColor: colors.white,
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
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.md,
        paddingHorizontal: spacing.xl,
      }}
    >
      <Stat label="Earned today" value={`${earnings.todayTotal} EGP`} />
      <Stat label="Deliveries" value={`${earnings.todayCount}`} />
      <Stat label="Tips today" value={`${earnings.todayTips} EGP`} />
      <Stat
        label={earnings.codOwed > 0 ? 'Cash to settle' : 'COD owed'}
        value={`${earnings.codOwed} EGP`}
        warn={earnings.codOwed > 0}
      />
    </View>
  );
}
