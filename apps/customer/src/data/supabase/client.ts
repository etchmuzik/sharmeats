import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (cached) return cached;
  if (!url || !anonKey) {
    throw new Error(
      'Supabase env not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY before flipping USE_SUPABASE on.',
    );
  }
  cached = createClient(url, anonKey, {
    auth: {
      // CRITICAL: without an explicit storage adapter, @supabase/auth-js falls
      // back to in-memory storage in React Native (no localStorage), so the
      // anonymous JWT is wiped on every cold start — minting a BRAND-NEW
      // anonymous user each launch and orphaning the customer's order history +
      // any in-flight order they're tracking. AsyncStorage persists the session
      // across restarts so the same auth.uid() (and thus the same RLS-visible
      // orders) survives. detectSessionInUrl is false: there's no URL to parse
      // on native, and leaving it on logs a warning every boot.
      storage: AsyncStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return cached;
}

export function isSupabaseConfigured(): boolean {
  return !!url && !!anonKey;
}
