/**
 * Merchant logo — upload to the public `avatars` bucket (mig 167) and record the
 * URL on `restaurants.logo_url`.
 *
 * Mirrors the driver avatar helper (apps/driver/src/avatar.ts) and the KYC
 * hardening both descend from: MIME allow-list, size cap, uid-prefixed storage
 * path matching the bucket RLS.
 *
 * Authority shape: the storage path is scoped to the UPLOADER's auth uid (that
 * is what the bucket RLS checks), while the row write goes to the restaurant —
 * `restaurants_merchant_update` (RLS, mig 012/089) admits any staff of that
 * restaurant, and the column-level grant from mig 167 limits the write to
 * logo_url alone. A logo is cosmetic, so staff-level access is deliberate;
 * authority columns like is_open stay manager-gated (mig 136).
 */
import { getSupabase } from './supabase';

/** Only real image formats. No SVG: it can carry script and this bucket is public. */
const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

/** 5 MB, matching the KYC cap. */
export const MAX_LOGO_BYTES = 5 * 1024 * 1024;

export function validateLogoUpload(
  mimeType: string | null | undefined,
  size: number,
): { contentType: string; extension: string } {
  const normalized = (mimeType ?? '').toLowerCase().trim();
  const extension = ALLOWED_MIME[normalized];
  if (!extension) throw new Error('Choose a JPEG, PNG, WebP or HEIC image.');
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error('That file looks empty. Pick another image.');
  }
  if (size > MAX_LOGO_BYTES) throw new Error('Choose an image smaller than 5 MB.');
  return { contentType: normalized, extension };
}

/**
 * The restaurant's current logo URL, or null.
 *
 * Its OWN query, fail-soft, rather than a column added to getMyKitchen's
 * select: PostgREST rejects a select naming a missing column, so folding
 * logo_url in there would break the whole kitchen queue for any tablet whose
 * app updated (OTA) before migration 167 was applied. Worst case in that
 * window is "no logo yet" — the queue still works. No release-order trap.
 */
export async function getRestaurantLogoUrl(restaurantId: string): Promise<string | null> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('restaurants')
      .select('logo_url')
      .eq('id', restaurantId)
      .maybeSingle();
    if (error) return null; // column absent pre-migration, or transient — cosmetic
    return (data?.logo_url as string | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * Uploads `uri` and writes the public URL to `restaurants.logo_url` for
 * `restaurantId`. Returns the URL.
 *
 * Path: avatars/<uploader uid>/logo-<restaurantId>.<ext> — uid-first to satisfy
 * the bucket RLS, restaurant id in the name so a multi-brand kitchen account can
 * hold a distinct logo per brand without collisions.
 */
export async function uploadRestaurantLogo(
  restaurantId: string,
  uri: string,
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
  const { contentType, extension } = validateLogoUpload(
    selectedMimeType ?? blob.type,
    Math.max(blob.size, selectedFileSize ?? 0),
  );

  const path = `${user.id}/logo-${restaurantId}.${extension}`;
  const bucket = supabase.storage.from('avatars');

  const { error: upErr } = await bucket.upload(path, blob, {
    contentType,
    upsert: true,
  });
  if (upErr) throw upErr;

  const {
    data: { publicUrl },
  } = bucket.getPublicUrl(path);
  // Cache-bust: the object path is stable, so a replaced logo would otherwise
  // keep serving the old bytes from the CDN.
  const url = `${publicUrl}?v=${Date.now()}`;

  const { error: updErr } = await supabase
    .from('restaurants')
    .update({ logo_url: url })
    .eq('id', restaurantId);
  if (updErr) {
    // No orphans: these bytes carry no evidentiary value (unlike KYC).
    await bucket.remove([path]).catch(() => undefined);
    throw updErr;
  }

  return url;
}
