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
export async function uploadKycDocument(docType: string, uri: string, ts: number): Promise<void> {
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
  const path = `${user.id}/driver-${docType}-${ts}.jpg`;

  const { error: upErr } = await supabase.storage.from('kyc').upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (upErr) throw upErr;

  const { error: insErr } = await supabase.from('kyc_documents').insert({
    subject_type: 'driver',
    subject_id: driverId,
    doc_type: docType,
    storage_path: path,
  });
  if (insErr) throw insErr;
}
