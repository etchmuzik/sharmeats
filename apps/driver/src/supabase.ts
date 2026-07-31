import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

let cached: SupabaseClient | null = null;

/**
 * Device-clock error, in milliseconds, measured against the server.
 *
 * Every deadline the driver acts on — the 45s offer countdown above all — is a
 * SERVER timestamp compared against the phone's clock. A courier phone with a
 * wrong clock (manual time, a bad carrier sync, a dead battery reset) therefore
 * either expires every offer the instant it arrives or keeps dead offers alive
 * long past the sweep. Neither failure is visible to the driver.
 *
 * Rather than add a round trip, we read the `Date` response header that every
 * Supabase reply already carries and keep the difference. Resolution is one
 * second and the reading is late by roughly the response leg of the round trip,
 * so this is accurate to a second or two — which is all a 45-second window
 * needs, and immeasurably better than an unbounded skew.
 */
let serverOffsetMs = 0;

/** "Now" on the server's clock. Falls back to the device clock until a reply is seen. */
export function serverNow(): number {
  return Date.now() + serverOffsetMs;
}

/** The measured device-clock error in ms (positive = the device is behind). */
export function serverTimeOffsetMs(): number {
  return serverOffsetMs;
}

/** Record the server clock from a response that carries a `Date` header. */
function recordServerTime(response: Response): Response {
  const header = response.headers?.get('date');
  if (header) {
    const serverMs = new Date(header).getTime();
    if (Number.isFinite(serverMs)) serverOffsetMs = serverMs - Date.now();
  }
  return response;
}

/**
 * Supabase client for the driver app. Sessions persist via AsyncStorage so a
 * driver stays logged in across restarts (important — they shouldn't re-auth
 * every shift). detectSessionInUrl is off (native, no URL callback).
 */
export function getSupabase(): SupabaseClient {
  if (cached) return cached;
  if (!url || !anonKey) {
    throw new Error(
      'Supabase env not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }
  cached = createClient(url, anonKey, {
    auth: {
      storage: AsyncStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
    global: {
      // Clock sync piggybacks on traffic the app already makes; it must never
      // change request behaviour, so the header read is wrapped and the
      // response is passed through untouched.
      fetch: (input, init) => fetch(input, init).then(recordServerTime),
    },
  });
  return cached;
}

export function isSupabaseConfigured(): boolean {
  return !!url && !!anonKey;
}
