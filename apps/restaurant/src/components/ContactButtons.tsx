import { Linking, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { colors, font, radius, spacing } from '../theme';

/**
 * [H-REST2] Customer-contact actions for an order. The restaurant previously had
 * ZERO way to reach anyone. "Call" opens the dialer with the customer's phone;
 * "Message" opens the in-app chat thread for the order. Call hides itself when no
 * phone is on the order (older orders / customer opted out), but Message is always
 * available so the kitchen can still reach the customer or driver.
 */
export function ContactButtons({
  orderId,
  customerPhone,
}: {
  orderId: string;
  customerPhone: string | null | undefined;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const call = async () => {
    const phone = customerPhone?.trim();
    if (!phone) return;
    try {
      await Linking.openURL(`tel:${phone}`);
    } catch {
      toast('Could not open the dialer', 'error');
    }
  };

  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
      {customerPhone?.trim() ? (
        <Pressable
          onPress={call}
          accessibilityRole="button"
          accessibilityLabel="Call customer"
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radius.lg,
            paddingVertical: spacing.sm,
          }}
        >
          <Icon name="phone" size={16} color={colors.sea} />
          <Text style={{ fontSize: font.sizes.sm, fontWeight: '700', color: colors.sea }}>
            Call customer
          </Text>
        </Pressable>
      ) : null}
      <Pressable
        onPress={() => router.push(`/order/${orderId}/chat`)}
        accessibilityRole="button"
        accessibilityLabel="Message"
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: radius.lg,
          paddingVertical: spacing.sm,
        }}
      >
        <Icon name="chat" size={16} color={colors.accent} />
        <Text style={{ fontSize: font.sizes.sm, fontWeight: '700', color: colors.accent }}>
          Message
        </Text>
      </Pressable>
    </View>
  );
}
