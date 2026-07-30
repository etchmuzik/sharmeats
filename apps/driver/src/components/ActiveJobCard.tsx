/**
 * The in-progress delivery. Inverted (dark) so it reads as the one thing on the
 * screen that is *live* — everything else is a list or a number, this is a
 * commitment the driver is currently inside.
 *
 * The unread-message affordance is a nested Pressable so a driver can jump
 * straight to the chat without landing on the job screen first; a customer
 * asking "which gate?" mid-ride is time-critical.
 */
import { Pressable, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import type { Job } from '../jobs';
import { font, radius, spacing } from '../theme';
import { useThemeColors } from '../themeProvider';
import { Icon } from './Icon';
import { cardEnter, listReflow } from './motion';
import { tapLight } from '../lib/haptics';
import { useI18n } from '../i18n-context';
import type { TranslationKey } from '../i18n';

function statusKey(s: Job['status']): TranslationKey {
  return {
    placed: 'job.status.placed',
    accepted: 'job.status.accepted',
    preparing: 'job.status.preparing',
    ready: 'job.status.ready',
    picked_up: 'job.status.pickedUp',
    out_for_delivery: 'job.status.outForDelivery',
    delivered: 'job.status.delivered',
    cancelled: 'job.status.cancelled',
    rejected: 'job.status.rejected',
  }[s] as TranslationKey;
}

type Props = {
  job: Job;
  unreadMsgs: number;
  onOpen: () => void;
  onOpenChat: () => void;
};

export function ActiveJobCard({ job, unreadMsgs, onOpen, onOpenChat }: Props) {
  const colors = useThemeColors();
  const { direction, t } = useI18n();

  return (
    <Animated.View entering={cardEnter} layout={listReflow}>
      <Pressable
        onPress={() => {
          tapLight();
          onOpen();
        }}
        accessibilityRole="button"
        accessibilityLabel={t('job.continueA11y', {
          code: job.short_code,
          restaurant: job.restaurant_name,
        })}
        style={({ pressed }) => ({
          marginHorizontal: spacing.xl,
          marginBottom: spacing.lg,
          backgroundColor: colors.ink,
          borderRadius: radius.xl,
          borderCurve: 'continuous',
          padding: spacing.xl,
          gap: 4,
          direction: direction.direction,
          opacity: pressed ? 0.9 : 1,
          boxShadow: '0 4px 16px rgba(10, 10, 12, 0.22)',
        })}
      >
        <Text
          style={{
            color: colors.accentSoft,
            fontSize: font.sizes.xs,
            fontWeight: '700',
            textTransform: 'uppercase',
            letterSpacing: 0.6,
          }}
        >
          {t('job.active')}
        </Text>
        {/* onInk*, not white/hardcoded greys: this slab is filled with `ink`,
            which is near-white on the dark theme — a fixed light label would
            vanish on it. The two greys below were literal hexes for the same
            reason and are now tokens that invert with the slab. */}
        <Text
          style={{
            color: colors.onInk,
            fontSize: font.sizes.xl,
            fontWeight: '700',
            textAlign: direction.textAlign,
          }}
          selectable
        >
          <Text style={{ writingDirection: 'ltr' }}>{job.short_code}</Text> ·{' '}
          {job.restaurant_name}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ color: colors.onInkMuted, fontSize: font.sizes.sm }}>
            {t(statusKey(job.status))}
          </Text>
          <Text style={{ color: colors.onInkFaint, fontSize: font.sizes.sm }}>
            · {t('job.continue')}
          </Text>
          <Icon
            name={direction.direction === 'rtl' ? 'chevronBack' : 'chevronForward'}
            size={13}
            color={colors.onInkFaint}
          />
        </View>

        {unreadMsgs > 0 && (
          <Pressable
            onPress={() => {
              tapLight();
              onOpenChat();
            }}
            accessibilityRole="button"
            accessibilityLabel={t(
              unreadMsgs === 1 ? 'job.unreadA11yOne' : 'job.unreadA11yMany',
              { count: unreadMsgs },
            )}
            style={({ pressed }) => ({
              marginTop: spacing.md,
              alignSelf: 'flex-start',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: colors.accent,
              borderRadius: radius.pill,
              paddingHorizontal: spacing.lg,
              minHeight: 44,
              justifyContent: 'center',
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Icon name="chat" size={14} color={colors.onAccent} />
            <Text style={{ color: colors.onAccent, fontWeight: '700', fontSize: font.sizes.sm }}>
              {t(unreadMsgs === 1 ? 'job.unreadOne' : 'job.unreadMany', {
                count: unreadMsgs,
              })}
            </Text>
          </Pressable>
        )}
      </Pressable>
    </Animated.View>
  );
}
