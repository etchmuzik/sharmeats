/**
 * Open the device's maps app for turn-by-turn directions to a destination.
 *
 * Strategy:
 *  - If we have exact coordinates, navigate to the precise pin (best for
 *    finding a specific building/beach spot).
 *  - Otherwise fall back to a free-text address search.
 *  - iOS prefers Apple Maps (maps://); Android prefers Google Maps. We use the
 *    universal Google Maps https URL as the cross-platform fallback, which
 *    opens the Google Maps app if installed or the browser otherwise.
 */
import { Linking, Platform } from 'react-native';
import type { LatLng } from './geo';

interface NavTarget {
  point?: LatLng | null;
  /** Human-readable address used when no point is available, or as the pin label. */
  label?: string | null;
}

/**
 * Launch directions to the target. Returns true if a maps URL was opened.
 * Never throws — a failure to open just returns false so the caller can toast.
 *
 * We deliberately DON'T use Linking.canOpenURL as a gate: on Android 11+ it
 * returns false for un-declared schemes (package visibility) even when the app
 * is installed, so it would always wrongly skip the native maps app. Instead we
 * attempt the native scheme directly and fall back to the universal Google Maps
 * https URL (which the OS always resolves to the app-or-browser) if it throws.
 */
export async function openDirections(target: NavTarget): Promise<boolean> {
  const native = buildDirectionsUrl(target);
  const web = buildGoogleWebUrl(target);
  if (native) {
    try {
      await Linking.openURL(native);
      return true;
    } catch {
      // Native scheme not handled (no maps app for that scheme) — try web.
    }
  }
  if (web) {
    try {
      await Linking.openURL(web);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function buildDirectionsUrl(target: NavTarget): string | null {
  const { point, label } = target;
  if (Platform.OS === 'ios') {
    // Apple Maps. daddr accepts "lat,lng" or a free-text address.
    if (point) return `maps://?daddr=${point.lat},${point.lng}&dirflg=d`;
    if (label) return `maps://?daddr=${encodeURIComponent(label)}&dirflg=d`;
    return null;
  }
  // Android (and anything else): Google Maps navigation intent.
  if (point) return `google.navigation:q=${point.lat},${point.lng}`;
  if (label) return `google.navigation:q=${encodeURIComponent(label)}`;
  return null;
}

function buildGoogleWebUrl(target: NavTarget): string | null {
  const { point, label } = target;
  const dest = point
    ? `${point.lat},${point.lng}`
    : label
      ? encodeURIComponent(label)
      : null;
  if (!dest) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
}
