/**
 * Driver profile photo — upload to the public `avatars` bucket (mig 167) and
 * record the resulting URL on `drivers.photo_url`.
 *
 * Deliberately NOT reusing the KYC path. A KYC document and a profile photo look
 * alike but have opposite requirements:
 *
 *   KYC                              avatar
 *   private bucket, owner+admin read  public bucket, world read
 *   immutable (audit trail)           replaceable by its owner
 *   indexed in kyc_documents          a single URL column
 *
 * Mirroring the KYC helper's hardening — explicit MIME allow-list, a size cap,
 * and a uid-prefixed path that matches the storage RLS — because the same
 * failure modes apply: a client-supplied MIME type is untrusted input, and an
 * unbounded upload is a cost and abuse vector.
 */
import { getSupabase } from './supabase';

/** Only real photo formats. No SVG: it can carry script and this bucket is public. */
const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

/** 5 MB, matching the KYC cap. A profile photo needs far less. */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export function validateAvatarUpload(
  mimeType: string | null | undefined,
  size: number,
): { contentType: string; extension: string } {
  const normalized = (mimeType ?? '').toLowerCase().trim();
  const extension = ALLOWED_MIME[normalized];
  if (!extension) {
    throw new Error('Choose a JPEG, PNG, WebP or HEIC photo.');
  }
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error("That file looks empty. Pick another photo.");
  }
  if (size > MAX_AVATAR_BYTES) {
    throw new Error('Choose a photo smaller than 5 MB.');
  }
  return { contentType: normalized, extension };
}

/**
 * Uploads `uri` to avatars/<uid>/profile.<ext> and writes the public URL to
 * `drivers.photo_url`. Returns the URL.
 *
 * The path is STABLE (always `profile`), not timestamped, so replacing a photo
 * overwrites rather than accumulating orphans — the inverse of the KYC rule,
 * and why `upsert: true`. A cache-busting query param is appended to the stored
 * URL so a replacement is visible immediately despite the CDN.
 */
export async function uploadDriverPhoto(
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
  const { contentType, extension } = validateAvatarUpload(
    selectedMimeType ?? blob.type,
    Math.max(blob.size, selectedFileSize ?? 0),
  );

  // Must match the storage RLS in mig 167: first path segment is the auth uid.
  const path = `${user.id}/profile.${extension}`;
  const bucket = supabase.storage.from('avatars');

  const { error: upErr } = await bucket.upload(path, blob, {
    contentType,
    upsert: true,
  });
  if (upErr) throw upErr;

  const {
    data: { publicUrl },
  } = bucket.getPublicUrl(path);
  // Cache-bust: the object path is stable, so without this a replaced photo can
  // keep serving the previous bytes from the CDN for as long as it caches them.
  const url = `${publicUrl}?v=${Date.now()}`;

  // RLS decides WHICH row (profile_id = auth.uid()); the column-level grant in
  // mig 167 decides that photo_url is the only column this write may touch.
  const { error: updErr } = await supabase
    .from('drivers')
    .update({ photo_url: url })
    .eq('profile_id', user.id);
  if (updErr) {
    // Leave no orphan if the row write failed — unlike KYC, these bytes carry
    // no evidentiary value, so removing them is the correct cleanup.
    await bucket.remove([path]).catch(() => undefined);
    throw updErr;
  }

  return url;
}

/**
 * The driver's current photo URL, or null.
 *
 * Deliberately its OWN query rather than a column on getMyDriver's select:
 * PostgREST rejects the whole select if any named column is missing, so adding
 * photo_url there would break the entire home screen for every driver whose
 * app updated (OTA) before migration 167 was applied. Kept separate and
 * fail-soft, the worst case in that window is "no photo yet" — the screen
 * still works. No release-order trap.
 */
export async function getDriverPhotoUrl(): Promise<string | null> {
  try {
    const supabase = getSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase
      .from('drivers')
      .select('photo_url')
      .eq('profile_id', user.id)
      .maybeSingle();
    if (error) return null; // column absent pre-migration, or transient — cosmetic either way
    return (data?.photo_url as string | null) ?? null;
  } catch {
    return null;
  }
}

/** Clears the photo. Removes the bytes too — a driver removing their picture expects it gone. */
export async function removeDriverPhoto(): Promise<void> {
  const supabase = getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { error } = await supabase
    .from('drivers')
    .update({ photo_url: null })
    .eq('profile_id', user.id);
  if (error) throw error;

  // Best-effort: the column is already cleared, so a storage failure here is
  // not worth surfacing to the driver.
  const bucket = supabase.storage.from('avatars');
  await bucket
    .remove(
      Object.values(ALLOWED_MIME).map((ext) => `${user.id}/profile.${ext}`),
    )
    .catch(() => undefined);
}
