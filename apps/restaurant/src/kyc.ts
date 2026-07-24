import { getSupabase } from './supabase';
import { getMyRestaurant } from './orders';

export type KycStatus = 'pending' | 'approved' | 'rejected';

export interface KycDocument {
  id: string;
  doc_type: string;
  status: KycStatus;
  review_note: string | null;
  created_at: string;
}

// Documents a restaurant must provide to be verified (doc_type strings match
// the admin review queue, mig 075).
export const RESTAURANT_DOC_TYPES: { key: string; label: string }[] = [
  { key: 'commercial_reg', label: 'Commercial registration' },
  { key: 'tax_card', label: 'Tax card' },
  { key: 'food_license', label: 'Food licence' },
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
