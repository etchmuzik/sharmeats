/**
 * The merchant logo on the kitchen header: a tappable circle showing the
 * storefront logo (or the brand initial as fallback), opening the photo picker
 * to set or replace it.
 *
 * Customers see this logo in the storefront, so the fallback is the brand's
 * initial — identifying even before a logo is uploaded. Everything is
 * fail-soft: the kitchen queue must never depend on a cosmetic image loading.
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, Text } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { getRestaurantLogoUrl, uploadRestaurantLogo } from '../logo';
import { colors, font } from '../theme';
import { useToast } from './Toast';
import { notifySuccess, tapLight } from '../lib/haptics';
import { useLocale } from '../locale';
import { captureError } from '../lib/crash';
import { operationalErrorKey } from '../operationalErrors';

const SIZE = 48;

type Props = {
  restaurantId: string;
  /** Brand name — its first letter is the no-logo fallback. */
  name: string | null | undefined;
};

export function LogoButton({ restaurantId, name }: Props) {
  const { toast } = useToast();
  const { t } = useLocale();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    getRestaurantLogoUrl(restaurantId)
      .then((u) => {
        if (mounted) setUrl(u);
      })
      .catch((error) => {
        captureError(error, {
          where: 'restaurant.logo.load',
          restaurantId,
        });
      });
    return () => {
      mounted = false;
    };
  }, [restaurantId]);

  const pick = useCallback(async () => {
    tapLight();
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      toast(t('header.logoPermission'), 'error');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setBusy(true);
    try {
      const newUrl = await uploadRestaurantLogo(
        restaurantId,
        asset.uri,
        asset.mimeType,
        asset.fileSize,
      );
      setUrl(newUrl);
      notifySuccess();
      toast(t('header.logoUpdated'), 'success');
    } catch (e) {
      captureError(e, {
        where: 'restaurant.logo.upload',
        restaurantId,
      });
      toast(t(operationalErrorKey('logoUpload')), 'error');
    } finally {
      setBusy(false);
    }
  }, [restaurantId, t, toast]);

  const initial = (name ?? 'R').trim().charAt(0).toUpperCase() || 'R';

  return (
    <Pressable
      onPress={pick}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={url ? t('header.logoChangeA11y') : t('header.logoAddA11y')}
      accessibilityState={{ busy, disabled: busy }}
      hitSlop={8}
      style={({ pressed }) => ({
        width: SIZE,
        height: SIZE,
        borderRadius: SIZE / 2,
        backgroundColor: colors.accentSoft,
        borderWidth: 2,
        borderColor: colors.accent,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator color={colors.accentDark} />
      ) : url ? (
        <Image
          source={{ uri: url }}
          style={{ width: SIZE, height: SIZE }}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Text style={{ fontSize: font.sizes.xl, fontWeight: '800', color: colors.accentDark }}>
          {initial}
        </Text>
      )}
    </Pressable>
  );
}
