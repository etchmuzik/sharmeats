/**
 * Release identity — which build is this, and which JS is it running?
 *
 * Package 01 §3 (release provenance), mobile half. The web surfaces answer this
 * with a build-time /version.json; a mobile app cannot, because the JS can be
 * swapped underneath a fixed native binary by an OTA update. So there are two
 * different questions and an operator needs BOTH:
 *
 *   - which native binary is installed  -> version + buildNumber
 *   - which JS is it actually running   -> updateId + channel + runtimeVersion
 *
 * A build number alone is misleading: two devices reporting "1.1.0 (34)" can be
 * running different JS if one has taken an OTA update and the other has not.
 * `updateId` is the only field that distinguishes them, and `isEmbedded` says
 * whether any OTA has been applied at all.
 *
 * `commit` is injected at build time via EXPO_PUBLIC_GIT_SHA (eas.json), never
 * hand-maintained — a constant someone must remember to bump is a constant that
 * silently lies. When it is absent (local dev, or a build predating the wiring)
 * it reads `null` rather than guessing.
 *
 * Everything here is defensive: expo-updates throws in Expo Go and in dev
 * clients where updates are disabled, and this module is used by crash
 * reporting, so it must never be the thing that crashes.
 */
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

export interface ReleaseInfo {
  /** Marketing version, e.g. "1.1.0". */
  version: string | null;
  /** Native build number (iOS buildNumber / Android versionCode). */
  buildNumber: string | null;
  /** OTA compatibility key. Updates only apply to a matching runtime version. */
  runtimeVersion: string | null;
  /** The applied OTA update's id; null when running the embedded bundle. */
  updateId: string | null;
  /** EAS Update channel, e.g. "production". */
  channel: string | null;
  /** True when running the JS shipped inside the binary (no OTA applied). */
  isEmbedded: boolean;
  /** Git SHA injected at build time; null if not provided. */
  commit: string | null;
  /** Short form for display. */
  shortCommit: string | null;
}

function safe<T>(read: () => T, fallback: T): T {
  try {
    const v = read();
    return v === undefined ? fallback : v;
  } catch {
    // expo-updates throws when updates are disabled (Expo Go, some dev
    // clients). An unknown release is fine; a crash in the diagnostics path
    // is not.
    return fallback;
  }
}

/** Non-empty trimmed string, else null — avoids "" masquerading as a value. */
function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

export function getReleaseInfo(): ReleaseInfo {
  const expo = Constants.expoConfig ?? null;

  const commit = str(process.env.EXPO_PUBLIC_GIT_SHA);

  // runtimeVersion may be a string or a policy object ({policy: 'appVersion'})
  // in config; the RESOLVED value is what Updates reports at runtime, so prefer
  // it and fall back to config only when it is already a plain string.
  const configRuntime = typeof expo?.runtimeVersion === 'string' ? expo.runtimeVersion : null;

  const updateId = safe(() => Updates.updateId, null);

  return {
    version: str(expo?.version),
    buildNumber:
      str(expo?.ios?.buildNumber) ??
      (expo?.android?.versionCode != null ? String(expo.android.versionCode) : null),
    runtimeVersion: safe(() => str(Updates.runtimeVersion), null) ?? configRuntime,
    updateId: str(updateId),
    channel: safe(() => str(Updates.channel), null),
    // isEmbeddedLaunch is the direct answer; updateId === null is the fallback
    // signal for older SDKs that do not expose it.
    isEmbedded: safe(() => Updates.isEmbeddedLaunch, str(updateId) === null),
    commit,
    shortCommit: commit ? commit.slice(0, 7) : null,
  };
}

/**
 * Flat, non-identifying properties for analytics/crash context.
 *
 * Deliberately excludes anything user-scoped: this describes the BUILD, not the
 * person running it.
 */
export function releaseProperties(info: ReleaseInfo = getReleaseInfo()): Record<string, string | boolean> {
  const props: Record<string, string | boolean> = {
    app_is_embedded: info.isEmbedded,
  };
  if (info.version) props.app_version = info.version;
  if (info.buildNumber) props.app_build = info.buildNumber;
  if (info.runtimeVersion) props.app_runtime_version = info.runtimeVersion;
  if (info.updateId) props.app_update_id = info.updateId;
  if (info.channel) props.app_channel = info.channel;
  if (info.commit) props.app_commit = info.commit;
  return props;
}

/**
 * One-line operator summary, e.g.
 *   "1.1.0 (34) · a1b2c3d · production · update 9f8e7d6c"
 * Unknown fields are omitted rather than rendered as "undefined".
 */
export function formatReleaseLine(info: ReleaseInfo = getReleaseInfo()): string {
  const parts: string[] = [];
  if (info.version) parts.push(info.buildNumber ? `${info.version} (${info.buildNumber})` : info.version);
  if (info.shortCommit) parts.push(info.shortCommit);
  if (info.channel) parts.push(info.channel);
  parts.push(info.isEmbedded ? 'embedded' : `update ${info.updateId?.slice(0, 8) ?? 'unknown'}`);
  return parts.join(' · ');
}
