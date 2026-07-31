/**
 * The two banners that make the alerting chain honest.
 *
 * `AlertingStatusBanner` states, in words, every way this tablet is currently
 * NOT alerting the kitchen: notifications denied at the OS level, the chime
 * muted, or the Realtime feed down. Silence is otherwise indistinguishable from
 * "no orders tonight", and that is how a restaurant loses a customer and blames
 * the platform.
 *
 * `UnacknowledgedAlert` is the alert of last resort: a pinned, pulsing, tappable
 * bar that appears whenever a ticket is sitting unaccepted. It depends on
 * NOTHING outside this process — no OS permission, no push pipeline, no audio
 * route — so it is the one signal that cannot be switched off by a setting
 * somebody changed six weeks ago.
 *
 * Colour is never the only carrier here: both banners lead with text, and the
 * unacknowledged bar states the count and the oldest wait numerically. Kitchen
 * tablets are read through steam and glare, where hue degrades first.
 */
import { Pressable, Text, View } from 'react-native';
import { font, radius, spacing } from '../theme';
import { useThemeColors } from '../themeProvider';
import { Icon } from './Icon';
import { Animated, usePulse } from './motion';
import { selection, tapMedium } from '../lib/haptics';
import { useLocale } from '../locale';
import type { PushAlertStatus } from '../alerting';

type StatusProps = {
  pushStatus: PushAlertStatus;
  muted: boolean;
  muteMinutesLeft: number;
  feedLive: boolean;
  onOpenSettings: () => void;
  onUnmute: () => void;
};

export function AlertingStatusBanner({
  pushStatus,
  muted,
  muteMinutesLeft,
  feedLive,
  onOpenSettings,
  onUnmute,
}: StatusProps) {
  const { direction, t } = useLocale();

  // 'unknown' and 'unsupported' are deliberately silent: nagging a simulator, or
  // a device whose first permission check has not returned, trains staff to
  // ignore the banner on the day it is telling the truth.
  const showPush = pushStatus === 'denied';
  if (!showPush && !muted && feedLive) return null;

  return (
    <View
      style={{
        width: '100%',
        maxWidth: 840,
        alignSelf: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.sm,
        direction,
      }}
    >
      {showPush && (
        <StatusRow
          tone="red"
          icon="bell"
          title={t('alert.pushDeniedTitle')}
          body={t('alert.pushDeniedBody')}
          actionLabel={t('alert.openSettings')}
          actionA11y={t('alert.openSettingsA11y')}
          onAction={onOpenSettings}
        />
      )}
      {muted && (
        <StatusRow
          tone="amber"
          icon="mute"
          title={t('alert.mutedTitle')}
          body={t('alert.mutedBody', { minutes: muteMinutesLeft })}
          actionLabel={t('header.sound')}
          actionA11y={t('alert.unmuteA11y')}
          onAction={onUnmute}
        />
      )}
      {!feedLive && (
        <StatusRow
          tone="amber"
          icon="warning"
          title={t('alert.feedTitle')}
          body={t('alert.feedBody')}
        />
      )}
    </View>
  );
}

function StatusRow({
  tone,
  icon,
  title,
  body,
  actionLabel,
  actionA11y,
  onAction,
}: {
  tone: 'red' | 'amber';
  icon: 'bell' | 'mute' | 'warning';
  title: string;
  body: string;
  actionLabel?: string;
  actionA11y?: string;
  onAction?: () => void;
}) {
  const colors = useThemeColors();
  const bg = tone === 'red' ? colors.redSoft : colors.amberSoft;
  const fg = tone === 'red' ? colors.redText : colors.amberText;

  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: fg,
        borderRadius: radius.lg,
        borderCurve: 'continuous',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
      }}
    >
      <Icon name={icon} size={18} color={fg} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: font.sizes.sm, fontWeight: '800', color: fg }}>{title}</Text>
        <Text style={{ fontSize: font.sizes.xs, color: fg }}>{body}</Text>
      </View>
      {actionLabel && onAction ? (
        <Pressable
          onPress={() => {
            selection();
            onAction();
          }}
          accessibilityRole="button"
          accessibilityLabel={actionA11y ?? actionLabel}
          style={{
            minHeight: 48,
            justifyContent: 'center',
            paddingHorizontal: spacing.md,
            borderRadius: radius.pill,
            borderWidth: 1,
            borderColor: fg,
          }}
        >
          <Text style={{ fontSize: font.sizes.sm, fontWeight: '800', color: fg }}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

type UnackedProps = {
  count: number;
  /** Oldest unaccepted ticket's wait, already formatted as m:ss. */
  oldestWait: string;
  onPress: () => void;
};

export function UnacknowledgedAlert({ count, oldestWait, onPress }: UnackedProps) {
  const colors = useThemeColors();
  const { direction, t } = useLocale();
  // Pulses for as long as ANY ticket is unaccepted, and is cancelled the moment
  // none is — a worklet left repeating behind an empty queue is a battery leak
  // on a tablet that never gets unplugged. Unlike the chime this has no mute:
  // silencing a loud pass is a reasonable request, going blind to unaccepted
  // orders is not.
  const pulseStyle = usePulse(count > 0, 1.015);

  if (count <= 0) return null;

  const summary = count === 1 ? t('alert.unackedOne') : t('alert.unackedMany', { count });
  const waiting = t('alert.unackedWaiting', { time: oldestWait });

  return (
    <Animated.View
      style={[
        {
          width: '100%',
          maxWidth: 840,
          alignSelf: 'center',
          marginTop: spacing.sm,
          direction,
        },
        pulseStyle,
      ]}
    >
      <Pressable
        onPress={() => {
          tapMedium();
          onPress();
        }}
        accessibilityRole="button"
        accessibilityLiveRegion="assertive"
        accessibilityLabel={t('alert.unackedA11y', { summary, waiting })}
        style={{
          marginHorizontal: spacing.lg,
          minHeight: 56,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          backgroundColor: colors.red,
          borderRadius: radius.lg,
          borderCurve: 'continuous',
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.sm,
        }}
      >
        <Icon name="alert" size={22} color={colors.onInk} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: font.sizes.base, fontWeight: '800', color: colors.onInk }}>
            {summary}
          </Text>
          <Text
            style={{
              fontSize: font.sizes.sm,
              fontWeight: '700',
              color: colors.onInk,
              fontVariant: ['tabular-nums'],
            }}
          >
            {waiting}
          </Text>
        </View>
        <Icon name="chevronForward" size={18} color={colors.onInk} />
      </Pressable>
    </Animated.View>
  );
}
