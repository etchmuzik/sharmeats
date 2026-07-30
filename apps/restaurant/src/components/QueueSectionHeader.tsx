/**
 * Section divider in the kitchen queue ("New", "In kitchen", "Ready").
 * The "New" section is accented so the eye lands there first on a busy tablet.
 */
import { Text, View } from 'react-native';
import { colors, font, radius, spacing } from '../theme';
import { useLocale } from '../locale';

type Props = {
  title: string;
  count: number;
  accent?: boolean;
};

export function QueueSectionHeader({ title, count, accent }: Props) {
  const { direction, isRtl } = useLocale();
  return (
    <View
      style={{
        width: '100%',
        maxWidth: 840,
        alignSelf: 'center',
        paddingTop: spacing.lg,
        paddingBottom: spacing.sm,
        backgroundColor: colors.bg,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        direction,
      }}
    >
      {/* TalkBack's "navigate by heading" gesture is the only fast way through
          a long queue; without the role a kitchen worker must swipe past every
          ticket to reach the next section. */}
      <Text
        accessibilityRole="header"
        style={{
          fontSize: font.sizes.sm,
          fontWeight: '800',
          letterSpacing: isRtl ? 0 : 1,
          textTransform: isRtl ? 'none' : 'uppercase',
          color: accent ? colors.accent : colors.ink2,
        }}
      >
        {title}
      </Text>
      <View
        style={{
          minWidth: 22,
          alignItems: 'center',
          borderRadius: radius.pill,
          backgroundColor: accent ? colors.accentSoft : colors.sand,
          paddingHorizontal: 8,
          paddingVertical: 2,
        }}
      >
        <Text
          style={{
            fontSize: font.sizes.xs,
            fontWeight: '700',
            color: accent ? colors.accentDark : colors.ink2,
            fontVariant: ['tabular-nums'],
          }}
        >
          {count}
        </Text>
      </View>
    </View>
  );
}
