import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { RESTAURANT_DOC_TYPES, listMyKycDocuments, uploadKycDocument, type KycDocument } from '../src/kyc';
import { font, radius, spacing, type Palette } from '../src/theme';
import { useThemeColors } from '../src/themeProvider';
import { useLocale } from '../src/locale';

/**
 * Takes the palette rather than baking it in at import time. These are TEXT
 * colors on a card, so they use the *Text variants — the fill values sit under
 * the 4.5:1 small-text floor (see theme.ts).
 */
function statusColor(status: KycDocument['status'], colors: Palette): string {
  return {
    approved: colors.greenText,
    rejected: colors.redText,
    pending: colors.amberText,
  }[status];
}
const STATUS_LABEL: Record<KycDocument['status'], string> = {
  approved: 'Approved',
  rejected: 'Rejected — re-upload',
  pending: 'Under review',
};

/**
 * Restaurant KYC: upload commercial registration, tax card, and food licence.
 * Files go to the private 'kyc' bucket (path-scoped RLS, mig 076); rows recorded
 * in kyc_documents. Admins review in admin-web.
 */
export default function RestaurantKyc() {
  const colors = useThemeColors();
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  const [docs, setDocs] = useState<KycDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDocs(await listMyKycDocuments());
    } catch {
      // empty is fine
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const latestFor = (type: string) =>
    docs
      .filter((d) => d.doc_type === type)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;

  const pickAndUpload = async (docType: string) => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('kyc.permissionNeeded'), t('kyc.permissionBody'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    setUploading(docType);
    try {
      const asset = result.assets[0];
      await uploadKycDocument(
        docType,
        asset.uri,
        Date.now(),
        asset.mimeType,
        asset.fileSize,
      );
      await load();
    } catch (e) {
      Alert.alert(t('kyc.uploadFailed'), e instanceof Error ? e.message : t('kyc.uploadRetry'));
    } finally {
      setUploading(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg, paddingBottom: insets.bottom + 40 }}
        >
          <Text style={{ color: colors.ink2, fontSize: font.sizes.base, lineHeight: 20 }}>
            Upload a clear photo of each document. Our team reviews them, usually within a day.
          </Text>

          {RESTAURANT_DOC_TYPES.map(({ key, label }) => {
            const doc = latestFor(key);
            const isUploading = uploading === key;
            return (
              <View
                key={key}
                style={{
                  backgroundColor: colors.surface,
                  borderRadius: radius.xl,
                  borderWidth: 1,
                  borderColor: colors.line,
                  padding: spacing.lg,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: font.sizes.base, fontWeight: '700', color: colors.ink }}>{label}</Text>
                  {doc && (
                    <Text style={{ fontSize: font.sizes.sm, fontWeight: '700', color: statusColor(doc.status, colors) }}>
                      {STATUS_LABEL[doc.status]}
                    </Text>
                  )}
                </View>
                {doc?.review_note && doc.status === 'rejected' && (
                  <Text style={{ marginTop: 4, fontSize: font.sizes.sm, color: colors.redText }}>{doc.review_note}</Text>
                )}
                <Pressable
                  onPress={() => pickAndUpload(key)}
                  disabled={isUploading}
                  accessibilityRole="button"
                  style={{
                    marginTop: spacing.md,
                    backgroundColor: doc?.status === 'approved' ? colors.bgSoft : colors.accent,
                    borderRadius: radius.lg,
                    paddingVertical: spacing.md,
                    alignItems: 'center',
                  }}
                >
                  {isUploading ? (
                    <ActivityIndicator color={colors.onAccent} />
                  ) : (
                    <Text
                      style={{
                        color: doc?.status === 'approved' ? colors.ink2 : colors.onAccent,
                        fontWeight: '700',
                        fontSize: font.sizes.base,
                      }}
                    >
                      {doc ? 'Replace photo' : 'Upload photo'}
                    </Text>
                  )}
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
