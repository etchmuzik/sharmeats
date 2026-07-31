/**
 * The online/offline switch — the driver's single most consequential control:
 * offline means no income, online means committing to answer offers.
 *
 * An unverified driver sees the control disabled with an explicit reason rather
 * than a dead switch, because "nothing happens when I tap" reads as a bug and
 * generates a support call.
 */
import { Switch, Text, View } from 'react-native';
import { font, radius, spacing } from '../theme';
import { useThemeColors } from '../themeProvider';
import { useI18n } from '../i18n-context';

type Props = {
  online: boolean;
  verified: boolean;
  /**
   * Why this driver is not actually reachable by dispatch, already translated.
   *
   * Online is a claim about being REACHABLE, and dispatch (mig 201) only sees
   * drivers whose phone has reported a position recently. A driver who denied
   * location saw "You're online · receiving delivery offers" while being
   * invisible — the worst possible failure, because it is silent and it looks
   * like success. When this is set the card must never read as receiving work.
   */
  warning?: string | null;
  onToggle: (next: boolean) => void;
};

export function OnlineToggle({ online, verified, warning, onToggle }: Props) {
  const colors = useThemeColors();
  const { t } = useI18n();
  const blocked = Boolean(warning);

  return (
    <View
      style={{
        margin: spacing.xl,
        backgroundColor: blocked ? colors.amberSoft : online ? colors.accentSoft : colors.surface,
        borderRadius: radius.xl,
        borderCurve: 'continuous',
        borderWidth: online || blocked ? 2 : 1,
        borderColor: blocked ? colors.amber : online ? colors.accent : colors.line,
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
        {/* Deliberately NOT an Animated.Text with a changing `key`. Remounting
            on every toggle re-runs the entering animation, and on iOS the text
            can settle invisible — verified on a simulator, where the heading was
            simply absent while the subtitle below rendered. The status line is
            the whole point of this card; it must never depend on an animation
            completing to be readable. */}
        <Text
          style={{
            fontSize: font.sizes.xl,
            fontWeight: '700',
            // Amber while blocked so the heading never reads as a calm
            // confirmation of something that isn't true.
            color: blocked ? colors.amberText : online ? colors.accentDark : colors.ink,
          }}
        >
          {online ? t('home.online') : t('home.offline')}
        </Text>
        <Text
          style={{
            color: blocked ? colors.amberText : colors.ink2,
            fontSize: font.sizes.sm,
            fontWeight: blocked ? '700' : '400',
          }}
        >
          {warning
            ? warning
            : !verified
              ? t('home.verifyToReceive')
              : online
                ? t('home.receivingOffers')
                : t('home.goOnlineToReceive')}
        </Text>
      </View>
      <Switch
        value={online}
        onValueChange={onToggle}
        trackColor={{ true: colors.accent, false: colors.line }}
        disabled={!verified}
        accessibilityLabel={t('home.receiveOffersA11y')}
        accessibilityHint={
          verified
            ? t('home.toggleHint')
            : t('home.toggleVerifyHint')
        }
        accessibilityState={{ checked: online, disabled: !verified }}
      />
    </View>
  );
}
