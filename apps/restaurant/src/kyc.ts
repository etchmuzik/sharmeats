import { getSupabase } from './supabase';
import { getMyRestaurant } from './orders';
import type { TranslationKey } from './i18n';

export type KycStatus = 'pending' | 'approved' | 'rejected';

export interface KycDocument {
  id: string;
  doc_type: string;
  status: KycStatus;
  review_note: string | null;
  created_at: string;
}

// Documents a restaurant must provide to be verified (doc_type strings match
// the admin review queue, mig 075). The label is a translation KEY, not text:
// the doc_type itself is a protocol value shared with admin-web and must never
// change, while what the merchant reads has to follow the tablet's locale.
export const RESTAURANT_DOC_TYPES: { key: string; labelKey: TranslationKey }[] = [
  { key: 'commercial_reg', labelKey: 'kyc.doc.commercial_reg' },
  { key: 'tax_card', labelKey: 'kyc.doc.tax_card' },
  { key: 'food_license', labelKey: 'kyc.doc.food_license' },
];
const RESTAURANT_DOC_TYPE_KEYS = new Set(RESTAURANT_DOC_TYPES.map(({ key }) => key));
const MAX_KYC_FILE_BYTES = 5 * 1024 * 1024;
const KYC_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function validateRestaurantKycUpload(
  docType: string,
  mimeType: string,
  size: number,
): { contentType: string; extension: string } {
  if (!RESTAURANT_DOC_TYPE_KEYS.has(docType)) {
    throw new Error('Unsupported restaurant document type');
  }
  const normalizedMime = mimeType.trim().toLowerCase();
  const extension = KYC_IMAGE_TYPES[normalizedMime];
  if (!extension) throw new Error('Upload a JPEG, PNG, or WebP image');
  if (!Number.isFinite(size) || size <= 0) throw new Error('The selected document is empty');
  if (size > MAX_KYC_FILE_BYTES) throw new Error('Choose an image smaller than 5 MB');
  return { contentType: normalizedMime, extension };
}

export async function listMyKycDocuments(): Promise<KycDocument[]> {
  const supabase = getSupabase();
  const ctx = await getMyRestaurant();
  if (!ctx) return [];
  const { data, error } = await supabase.rpc('my_kyc_documents', {
    p_subject_type: 'restaurant',
    p_subject_id: ctx.restaurantId,
  });
  if (error) throw error;
  return (data as KycDocument[]) ?? [];
}

/** Upload a KYC photo to kyc/<uid>/<type>-<ts>.jpg then record the row. */
export async function uploadKycDocument(
  docType: string,
  uri: string,
  ts: number,
  selectedMimeType?: string | null,
  selectedFileSize?: number | null,
): Promise<void> {
  const supabase = getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const ctx = await getMyRestaurant();
  if (!ctx) throw new Error('No restaurant');

  const res = await fetch(uri);
  const blob = await res.blob();
  const { contentType, extension } = validateRestaurantKycUpload(
    docType,
    selectedMimeType ?? blob.type,
    Math.max(blob.size, selectedFileSize ?? 0),
  );
  if (!Number.isSafeInteger(ts) || ts <= 0) throw new Error('Invalid upload timestamp');
  const path = `${user.id}/restaurant-${docType}-${ts}.${extension}`;
  const bucket = supabase.storage.from('kyc');

  const { error: upErr } = await bucket.upload(path, blob, {
    contentType,
    // KYC evidence is immutable: a replacement creates a new timestamped
    // object + pending row, never overwrites bytes an admin already reviewed.
    upsert: false,
  });
  if (upErr) throw upErr;

  const { error: insErr } = await supabase.from('kyc_documents').insert({
    subject_type: 'restaurant',
    subject_id: ctx.restaurantId,
    doc_type: docType,
    storage_path: path,
  });
  if (insErr) {
    await bucket.remove([path]).catch(() => undefined);
    throw insErr;
  }
}
