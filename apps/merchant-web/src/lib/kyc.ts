/**
 * Restaurant KYC for the web dashboard. Mirrors apps/restaurant/src/kyc.ts:
 * same doc_type strings, same storage path convention
 * (kyc/<uid>/restaurant-<type>-<ts> — mig 075/076 + 20260724120946 policies
 * key off the uid folder and enforce the exact path shape server-side).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type KycStatus = 'pending' | 'approved' | 'rejected';

export interface KycDocument {
  id: string;
  doc_type: string;
  status: KycStatus;
  review_note: string | null;
  created_at: string;
}

export const RESTAURANT_DOC_TYPES: { key: string; label: string; hint: string }[] = [
  { key: 'commercial_reg', label: 'Commercial registration', hint: 'السجل التجاري' },
  { key: 'tax_card', label: 'Tax card', hint: 'البطاقة الضريبية' },
  { key: 'food_license', label: 'Food licence', hint: 'رخصة تشغيل / سلامة الغذاء' },
];

const MAX_KYC_FILE_BYTES = 5 * 1024 * 1024;
const KYC_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const FRIENDLY_TYPE_ERROR = 'Please upload a JPG, PNG or WebP image (max 5 MB).';

export interface ResolvedKycImage {
  ext: 'jpg' | 'png' | 'webp';
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
}

/**
 * Pure resolver: validates size + derives the storage extension/contentType
 * for a KYC upload, or throws the friendly error. Kept side-effect free (no
 * Supabase client) so it's unit-testable in isolation. Mirrors
 * apps/restaurant/src/kyc.ts's validateRestaurantKycUpload — MIME first (the
 * declared file.type), filename extension as a fallback for browsers that
 * report an empty/generic type on <input type="file">.
 */
export function resolveKycImage(file: { name: string; type: string; size: number }): ResolvedKycImage {
  if (file.size > MAX_KYC_FILE_BYTES) throw new Error(FRIENDLY_TYPE_ERROR);

  const normalizedMime = (file.type || '').trim().toLowerCase();
  let ext = KYC_IMAGE_TYPES[normalizedMime];
  if (!ext) {
    const nameExt = file.name.split('.').pop()?.toLowerCase();
    const candidate = nameExt === 'jpeg' ? 'jpg' : nameExt;
    if (candidate === 'jpg' || candidate === 'png' || candidate === 'webp') ext = candidate;
  }
  if (!ext) throw new Error(FRIENDLY_TYPE_ERROR);

  const contentType = ext === 'jpg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : 'image/webp';
  return { ext: ext as 'jpg' | 'png' | 'webp', contentType };
}

export async function listMyKycDocuments(
  supabase: SupabaseClient,
  restaurantId: string,
): Promise<KycDocument[]> {
  const { data, error } = await supabase.rpc('my_kyc_documents', {
    p_subject_type: 'restaurant',
    p_subject_id: restaurantId,
  });
  if (error) throw new Error(error.message);
  return (data as KycDocument[]) ?? [];
}

export async function uploadKycDocument(
  supabase: SupabaseClient,
  restaurantId: string,
  docType: string,
  file: File,
): Promise<void> {
  const { ext, contentType } = resolveKycImage(file);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const path = `${user.id}/restaurant-${docType}-${Date.now()}.${ext}`;
  const bucket = supabase.storage.from('kyc');

  const { error: upErr } = await bucket.upload(path, file, {
    contentType,
    // KYC evidence is immutable: a replacement creates a new timestamped
    // object + pending row, never overwrites bytes an admin already reviewed.
    upsert: false,
  });
  if (upErr) throw new Error(upErr.message);

  const { error: insErr } = await supabase.from('kyc_documents').insert({
    subject_type: 'restaurant',
    subject_id: restaurantId,
    doc_type: docType,
    storage_path: path,
  });
  if (insErr) {
    // Best-effort cleanup: the object is unindexed at this point, so
    // kyc_delete_unindexed_own permits the owner to remove it (mirrors
    // apps/restaurant/src/kyc.ts's bucket.remove([path]).catch(() => undefined)).
    await bucket.remove([path]).catch(() => undefined);
    throw new Error(insErr.message);
  }
}
