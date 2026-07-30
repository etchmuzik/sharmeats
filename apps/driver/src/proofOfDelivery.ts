/**
 * Proof of delivery: a photo captured at handoff.
 *
 * WHY IT IS NOT A HARD GATE: `advance_order_status` is untouched and never
 * refuses a delivery for missing proof (see mig 189). The button in the UI waits
 * for a photo where one is required, but the status transition does not wait for
 * the upload — a driver on bad mobile data must never be stranded on an order
 * they have physically completed. `recordProof` is therefore called AFTER the
 * status advance, and a failure to upload is reported without rolling the
 * delivery back. `ops_deliveries_missing_proof` is how the resulting gap is
 * policed.
 *
 * The bytes go to the private 'delivery-proof' bucket under a path the storage
 * policy pins to the caller's own uid; the row in `delivery_proofs` is the index
 * and is written by the `record_delivery_proof` RPC, which re-checks the path and
 * snapshots the order's dropoff preference server-side.
 */
import { getSupabase } from './supabase';

/**
 * Dropoff preferences where nobody is at the door, so a photo is the only
 * evidence the handoff happened.
 *
 * MUST stay in step with `public.delivery_proof_required(text)` in mig 189 —
 * the DB copy drives the ops report, this copy drives the button. A mismatch
 * would either nag drivers for photos ops never asks about, or quietly stop
 * requiring one that ops then flags as missing.
 */
export const PROOF_REQUIRED_PREFERENCES = ['leave_at_door', 'no_bell'] as const;

/** Fails closed on null/unknown: never demand a photo we cannot justify. */
export function isProofRequired(dropoffPreference: string | null | undefined): boolean {
  if (!dropoffPreference) return false;
  return (PROOF_REQUIRED_PREFERENCES as readonly string[]).includes(dropoffPreference);
}

const MAX_PROOF_BYTES = 5 * 1024 * 1024;

/** Mirrors the bucket's allowed_mime_types and the storage policy's extensions. */
const PROOF_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function validateProofUpload(
  mimeType: string | null | undefined,
  size: number,
): { contentType: string; extension: string } {
  const normalizedMime = (mimeType ?? '').trim().toLowerCase();
  const extension = PROOF_IMAGE_TYPES[normalizedMime];
  if (!extension) throw new Error('The photo must be a JPEG, PNG, or WebP image');
  if (!Number.isFinite(size) || size <= 0) throw new Error('The photo is empty');
  if (size > MAX_PROOF_BYTES) throw new Error('The photo is larger than 5 MB');
  return { contentType: normalizedMime, extension };
}

/**
 * `<uid>/<order-uuid>-<epoch-ms>.<ext>`.
 *
 * Shape is load-bearing twice over: the storage INSERT policy matches this with
 * a regex, and `record_delivery_proof` reconstructs it to confirm the path
 * belongs to both the caller and the order. Changing it here without changing
 * mig 189 breaks uploads outright.
 */
export function buildProofPath(
  userId: string,
  orderId: string,
  ts: number,
  extension: string,
): string {
  if (!Number.isSafeInteger(ts) || ts <= 0) throw new Error('Invalid capture timestamp');
  return `${userId}/${orderId}-${ts}.${extension}`;
}

/**
 * Upload the photo and index it. Resolves to the new proof id.
 *
 * If the upload lands but indexing fails, the orphaned object is deleted so the
 * bucket does not accumulate unreferenced bytes — the storage policy permits
 * deleting only one's own UNINDEXED objects, which is exactly this case.
 */
export async function recordProof(
  orderId: string,
  uri: string,
  ts: number,
  selectedMimeType?: string | null,
  selectedFileSize?: number | null,
): Promise<string> {
  const supabase = getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const res = await fetch(uri);
  const blob = await res.blob();
  const { contentType, extension } = validateProofUpload(
    selectedMimeType ?? blob.type,
    Math.max(blob.size, selectedFileSize ?? 0),
  );

  const path = buildProofPath(user.id, orderId, ts, extension);
  const bucket = supabase.storage.from('delivery-proof');

  const { error: upErr } = await bucket.upload(path, blob, {
    contentType,
    // Evidence is immutable: a retry produces a new timestamped object rather
    // than overwriting bytes ops may already have reviewed.
    upsert: false,
  });
  if (upErr) throw upErr;

  const { data, error: rpcErr } = await supabase.rpc('record_delivery_proof', {
    p_order_id: orderId,
    p_storage_path: path,
  });
  if (rpcErr) {
    // Best-effort cleanup; the object is still unindexed at this point so the
    // delete policy allows it. Swallow a cleanup failure — the original error is
    // the one worth surfacing.
    await bucket.remove([path]).catch(() => {});
    throw rpcErr;
  }
  return data as string;
}
