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
import { colors, font, radius, spacing } from '../theme';
import { Icon } from './Icon';
import { cardEnter, listReflow } from './motion';
import { tapLight } from '../lib/haptics';

export function statusLabel(s: Job['status']): string {
  return (
    {
      placed: 'Placed',
      accepted: 'Accepted',
      preparing: 'Preparing',
      ready: 'Ready for pickup',
      picked_up: 'Picked up',
      out_for_delivery: 'Out for delivery',
      delivered: 'Delivered',
      cancelled: 'Cancelled',
      rejected: 'Rejected',
    } as const
  )[s];
}

type Props = {
  job: Job;
  unreadMsgs: number;
  onOpen: () => void;
  onOpenChat: () => void;
};

export function ActiveJobCard({ job, unreadMsgs, onOpen, onOpenChat }: Props) {
  return (
    <Animated.View entering={cardEnter} layout={listReflow}>
      <Pressable
        onPress={() => {
          tapLight();
          onOpen();
        }}
        accessibilityRole="button"
        accessibilityLabel={`Continue delivery ${job.short_code} from ${job.restaurant_name}`}
        style={({ pressed }) => ({
          marginHorizontal: spacing.xl,
          marginBottom: spacing.lg,
          backgroundColor: colors.ink,
          borderRadius: radius.xl,
          borderCurve: 'continuous',
          padding: spacing.xl,
          gap: 4,
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
          Active delivery
        </Text>
        <Text selectable style={{ color: colors.white, fontSize: font.sizes.xl, fontWeight: '700' }}>
          {job.short_code} · {job.restaurant_name}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ color: '#cfd6da', fontSize: font.sizes.sm }}>{statusLabel(job.status)}</Text>
          <Text style={{ color: '#8d979c', fontSize: font.sizes.sm }}>· tap to continue</Text>
          <Icon name="chevronForward" size={13} color="#8d979c" />
        </View>

        {unreadMsgs > 0 && (
          <Pressable
            onPress={() => {
              tapLight();
              onOpenChat();
            }}
            accessibilityRole="button"
            accessibilityLabel={`${unreadMsgs} unread message${unreadMsgs === 1 ? '' : 's'} — open chat`}
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
            <Icon name="chat" size={14} color={colors.white} />
            <Text style={{ color: colors.white, fontWeight: '700', fontSize: font.sizes.sm }}>
              {unreadMsgs} new message{unreadMsgs === 1 ? '' : 's'}
            </Text>
          </Pressable>
        )}
      </Pressable>
    </Animated.View>
  );
}
