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
export async function uploadKycDocument(docType: string, uri: string, ts: number): Promise<void> {
  const supabase = getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const ctx = await getMyRestaurant();
  if (!ctx) throw new Error('No restaurant');

  const res = await fetch(uri);
  const blob = await res.blob();
  const path = `${user.id}/restaurant-${docType}-${ts}.jpg`;

  const { error: upErr } = await supabase.storage.from('kyc').upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (upErr) throw upErr;

  const { error: insErr } = await supabase.from('kyc_documents').insert({
    subject_type: 'restaurant',
    subject_id: ctx.restaurantId,
    doc_type: docType,
    storage_path: path,
  });
  if (insErr) throw insErr;
}
