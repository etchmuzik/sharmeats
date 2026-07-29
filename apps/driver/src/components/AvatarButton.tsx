/**
 * The driver's profile photo on the home identity strip: a tappable circle that
 * shows the photo (or the driver's initial as a fallback) and opens the photo
 * picker to set or replace it.
 *
 * Customers see this photo during a live delivery, so it exists to answer "is
 * this the person at my door?" — which is also why the fallback is an initial
 * rather than a generic silhouette: even without a photo the circle is
 * identifying, not decorative.
 *
 * Everything here is fail-soft. Photo load, upload, and refresh all degrade to
 * the initial + a toast; none of it can block the home screen, which must stay
 * usable mid-delivery on a bad connection.
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, Text } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { getDriverPhotoUrl, uploadDriverPhoto } from '../avatar';
import { colors, font } from '../theme';
import { useToast } from './Toast';
import { notifySuccess, tapLight } from '../lib/haptics';

const SIZE = 56;

type Props = {
  /** Driver display name — its first letter is the no-photo fallback. */
  name: string | null | undefined;
};

export function AvatarButton({ name }: Props) {
  const { toast } = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    getDriverPhotoUrl().then((u) => {
      if (mounted) setUrl(u);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const pick = useCallback(async () => {
    tapLight();
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      toast('Allow photo access in Settings to set a profile photo.', 'error');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setBusy(true);
    try {
      const newUrl = await uploadDriverPhoto(asset.uri, asset.mimeType, asset.fileSize);
      setUrl(newUrl);
      notifySuccess();
      toast('Profile photo updated.', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't upload the photo. Try again.", 'error');
    } finally {
      setBusy(false);
    }
  }, [toast]);

  const initial = (name ?? 'D').trim().charAt(0).toUpperCase() || 'D';

  return (
    <Pressable
      onPress={pick}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={url ? 'Change your profile photo' : 'Add a profile photo'}
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
        <Text style={{ fontSize: font.sizes.xxl, fontWeight: '800', color: colors.accentDark }}>
          {initial}
        </Text>
      )}
    </Pressable>
  );
}
