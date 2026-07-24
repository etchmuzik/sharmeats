import { getSupabase } from './supabase';

export type KycStatus = 'pending' | 'approved' | 'rejected';

export interface KycDocument {
  id: string;
  doc_type: string;
  status: KycStatus;
  review_note: string | null;
  created_at: string;
}

// The documents a driver must provide to be verified. doc_type strings match
// what admins expect in the review queue (mig 075).
export const DRIVER_DOC_TYPES: { key: string; label: string }[] = [
  { key: 'national_id', label: 'National ID' },
  { key: 'driving_license', label: 'Driving licence' },
  { key: 'vehicle_reg', label: 'Vehicle registration' },
];
const DRIVER_DOC_TYPE_KEYS = new Set(DRIVER_DOC_TYPES.map(({ key }) => key));
const MAX_KYC_FILE_BYTES = 5 * 1024 * 1024;
const KYC_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function validateDriverKycUpload(
  docType: string,
  mimeType: string,
  size: number,
): { contentType: string; extension: string } {
  if (!DRIVER_DOC_TYPE_KEYS.has(docType)) {
    throw new Error('Unsupported driver document type');
  }
  const normalizedMime = mimeType.trim().toLowerCase();
  const extension = KYC_IMAGE_TYPES[normalizedMime];
  if (!extension) throw new Error('Upload a JPEG, PNG, or WebP image');
  if (!Number.isFinite(size) || size <= 0) throw new Error('The selected document is empty');
  if (size > MAX_KYC_FILE_BYTES) throw new Error('Choose an image smaller than 5 MB');
  return { contentType: normalizedMime, extension };
}

async function myDriverId(): Promise<string | null> {
  const supabase = getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from('drivers').select('id').eq('profile_id', user.id).single();
  return (data?.id as string | undefined) ?? null;
}

export async function listMyKycDocuments(): Promise<KycDocument[]> {
  const supabase = getSupabase();
  const driverId = await myDriverId();
  if (!driverId) return [];
  const { data, error } = await supabase.rpc('my_kyc_documents', {
    p_subject_type: 'driver',
    p_subject_id: driverId,
  });
  if (error) throw error;
  return (data as KycDocument[]) ?? [];
}

/**
 * Upload a KYC photo to the private 'kyc' bucket under kyc/<uid>/<type>-<ts>.jpg
 * (path-scoped RLS from mig 076), then record the kyc_documents row. Returns the
 * created document. `uri` is a local file URI from the image picker.
 */
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
  const driverId = await myDriverId();
  if (!driverId) throw new Error('No driver profile');

  // Fetch the local file as a blob for upload.
  const res = await fetch(uri);
  const blob = await res.blob();
  const { contentType, extension } = validateDriverKycUpload(
    docType,
    selectedMimeType ?? blob.type,
    Math.max(blob.size, selectedFileSize ?? 0),
  );
  if (!Number.isSafeInteger(ts) || ts <= 0) throw new Error('Invalid upload timestamp');
  const path = `${user.id}/driver-${docType}-${ts}.${extension}`;
  const bucket = supabase.storage.from('kyc');

  const { error: upErr } = await bucket.upload(path, blob, {
    contentType,
    // KYC evidence is immutable: a replacement creates a new timestamped
    // object + pending row, never overwrites bytes an admin already reviewed.
    upsert: false,
  });
  if (upErr) throw upErr;

  const { error: insErr } = await supabase.from('kyc_documents').insert({
    subject_type: 'driver',
    subject_id: driverId,
    doc_type: docType,
    storage_path: path,
  });
  if (insErr) {
    // The bucket permits deleting only unindexed objects owned by this user.
    // Once the row exists, KYC evidence remains immutable.
    await bucket.remove([path]).catch(() => undefined);
    throw insErr;
  }
}
