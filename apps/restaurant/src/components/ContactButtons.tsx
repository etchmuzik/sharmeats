import { Linking, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { font, radius, spacing } from '../theme';
import { useLocale } from '../locale';
import { useThemeColors } from '../themeProvider';

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
  const colors = useThemeColors();
  const router = useRouter();
  const { toast } = useToast();
  const { direction, t } = useLocale();

  const call = async () => {
    const phone = customerPhone?.trim();
    if (!phone) return;
    try {
      await Linking.openURL(`tel:${phone}`);
    } catch {
      toast(t('contact.dialerError'), 'error');
    }
  };

  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm, direction }}>
      {customerPhone?.trim() ? (
        <Pressable
          onPress={call}
          accessibilityRole="button"
          accessibilityLabel={t('contact.callCustomer')}
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
            {t('contact.callCustomer')}
          </Text>
        </Pressable>
      ) : null}
      <Pressable
        onPress={() => router.push(`/order/${orderId}/chat`)}
        accessibilityRole="button"
        accessibilityLabel={t('contact.message')}
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
        <Text style={{ fontSize: font.sizes.sm, fontWeight: '700', color: colors.accentText }}>
          {t('contact.message')}
        </Text>
      </Pressable>
    </View>
  );
}
