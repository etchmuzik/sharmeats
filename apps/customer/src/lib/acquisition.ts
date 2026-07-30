/**
 * Acquisition capture (Package 05 Slice D).
 *
 * The client's whole job: mint one install id, report how this install ARRIVED
 * (deep-link params when a QR/link opened the app, organic otherwise), and let
 * the server keep the truth — first touch preserved, campaign touch bounded,
 * partner codes allow-listed server-side. Nothing here can influence an order:
 * orders are stamped by a DB trigger from the server's own records.
 *
 * Deep-link contract for partner QR codes:
 *   sharmeats://open?src=hotel_qr&campaign=hilton-lobby&partner=HILTON1
 * `src` must be one of the server's allow-listed sources; junk degrades to
 * 'unknown' server-side. Params are token-validated HERE too, so a hostile
 * link cannot push free text into the pipeline.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import { db, isBackendLive } from '../data';
import { setAnalyticsContext } from './analytics';

const INSTALL_ID_KEY = '@sharmeats:installId:v1';
const SOURCE_CACHE_KEY = '@sharmeats:acquisitionSource:v1';

const TOKEN_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function uuid(): string {
  // RFC4122-ish v4 from Math.random is fine here: the install id is an opaque
  // attribution key, not a security credential.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export async function getInstallId(): Promise<string> {
  const existing = await AsyncStorage.getItem(INSTALL_ID_KEY);
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  const minted = uuid();
  await AsyncStorage.setItem(INSTALL_ID_KEY, minted).catch(() => {});
  return minted;
}

interface ParsedAcquisition {
  source: string;
  campaign: string | null;
  partner: string | null;
  path: string | null;
}

/** Extract acquisition params from a URL; null when it carries none. */
export function parseAcquisitionParams(url: string): ParsedAcquisition | null {
  try {
    const { queryParams, path } = Linking.parse(url);
    const src = typeof queryParams?.src === 'string' ? queryParams.src : null;
    if (!src || !TOKEN_RE.test(src)) return null;
    const campaign =
      typeof queryParams?.campaign === 'string' && TOKEN_RE.test(queryParams.campaign)
        ? queryParams.campaign
        : null;
    const partner =
      typeof queryParams?.partner === 'string' && TOKEN_RE.test(queryParams.partner)
        ? queryParams.partner
        : null;
    return { source: src, campaign, partner, path: path ? `/${path}`.slice(0, 200) : null };
  } catch {
    return null;
  }
}

async function report(parsed: ParsedAcquisition | null): Promise<void> {
  const installId = await getInstallId();
  const source = parsed?.source ?? 'organic';
  try {
    await db.acquisition.recordTouch({
      installId,
      source,
      campaign: parsed?.campaign ?? null,
      partnerCode: parsed?.partner ?? null,
      deepLink: parsed?.path ?? null,
    });
  } catch {
    // Attribution must never surface an error. The server never hears about
    // this install until a later launch succeeds — acceptable loss.
  }
  if (parsed) {
    // The dead-since-birth analytics hook finally gets its value: every event
    // from here on carries acquisition_source. Persisted so later launches
    // keep it without re-parsing a link.
    setAnalyticsContext({ source });
    AsyncStorage.setItem(SOURCE_CACHE_KEY, source).catch(() => {});
  }
}

/**
 * Call once at startup. Handles: the URL that launched the app (QR scan),
 * links arriving while running, the organic first launch, and restoring the
 * remembered source into analytics context.
 */
export async function initAcquisition(): Promise<() => void> {
  const remembered = await AsyncStorage.getItem(SOURCE_CACHE_KEY).catch(() => null);
  if (remembered && TOKEN_RE.test(remembered)) setAnalyticsContext({ source: remembered });

  const initialUrl = await Linking.getInitialURL().catch(() => null);
  await report(initialUrl ? parseAcquisitionParams(initialUrl) : null);

  const sub = Linking.addEventListener('url', ({ url }) => {
    const parsed = parseAcquisitionParams(url);
    if (parsed) void report(parsed);
  });
  return () => sub.remove();
}

/** Call when the session becomes signed-in: attribution survives registration. */
export async function claimAcquisition(): Promise<void> {
  if (!isBackendLive) return;
  try {
    await db.acquisition.claim(await getInstallId());
  } catch {
    // Next sign-in-observed launch retries; losing a claim is recoverable.
  }
}
