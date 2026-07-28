/**
 * The online/offline switch — the driver's single most consequential control:
 * offline means no income, online means committing to answer offers.
 *
 * An unverified driver sees the control disabled with an explicit reason rather
 * than a dead switch, because "nothing happens when I tap" reads as a bug and
 * generates a support call.
 */
import { Switch, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, font, radius, spacing } from '../theme';
import { contentEnter } from './motion';

type Props = {
  online: boolean;
  verified: boolean;
  onToggle: (next: boolean) => void;
};

export function OnlineToggle({ online, verified, onToggle }: Props) {
  return (
    <View
      style={{
        margin: spacing.xl,
        backgroundColor: online ? colors.accentSoft : colors.white,
        borderRadius: radius.xl,
        borderCurve: 'continuous',
        borderWidth: online ? 2 : 1,
        borderColor: online ? colors.accent : colors.line,
        padding: spacing.xl,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: spacing.md,
        boxShadow: online
          ? '0 2px 12px rgba(14, 124, 145, 0.15)'
          : '0 1px 3px rgba(10, 10, 12, 0.05)',
      }}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Animated.Text
          key={online ? 'on' : 'off'}
          entering={contentEnter}
          style={{
            fontSize: font.sizes.xl,
            fontWeight: '700',
            color: online ? colors.accentDark : colors.ink,
          }}
        >
          {online ? "You're online" : "You're offline"}
        </Animated.Text>
        <Text style={{ color: colors.ink2, fontSize: font.sizes.sm }}>
          {!verified
            ? 'Complete verification to start receiving offers'
            : online
              ? 'Receiving delivery offers'
              : 'Go online to receive offers'}
        </Text>
      </View>
      <Switch
        value={online}
        onValueChange={onToggle}
        trackColor={{ true: colors.accent, false: colors.line }}
        disabled={!verified}
        accessibilityLabel="Receive delivery offers"
        accessibilityHint={
          verified
            ? 'Turns new delivery offers on or off'
            : 'Complete verification before going online'
        }
        accessibilityState={{ checked: online, disabled: !verified }}
      />
    </View>
  );
}
