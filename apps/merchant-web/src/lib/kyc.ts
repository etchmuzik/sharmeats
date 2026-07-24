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
  if (file.size > MAX_KYC_FILE_BYTES) throw new Error(FRIENDLY_TYPE_ERROR);

  // Derive the extension from the declared MIME type (normalizing jpeg→jpg);
  // fall back to the filename's own extension for browsers that report an
  // empty/octet-stream type. Anything outside the bucket's allowlist is
  // rejected client-side before we ever attempt the upload.
  const normalizedMime = (file.type || '').trim().toLowerCase();
  let ext = KYC_IMAGE_TYPES[normalizedMime];
  if (!ext) {
    const nameExt = file.name.split('.').pop()?.toLowerCase();
    const candidate = nameExt === 'jpeg' ? 'jpg' : nameExt;
    if (candidate === 'jpg' || candidate === 'png' || candidate === 'webp') ext = candidate;
  }
  if (!ext) throw new Error(FRIENDLY_TYPE_ERROR);
  const contentType = ext === 'jpg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : 'image/webp';

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const path = `${user.id}/restaurant-${docType}-${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage.from('kyc').upload(path, file, {
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
  if (insErr) throw new Error(insErr.message);
}
