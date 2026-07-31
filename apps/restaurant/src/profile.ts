/**
 * The one piece of this staffer's profile the tablet owns: their language.
 *
 * Push notifications are rendered SERVER-side from users.locale, which defaults
 * to 'ar' (mig 002). Nothing in this app ever wrote that column, so the two
 * halves of the same order drifted apart: an Arabic-speaking merchant read an
 * English tablet while their new-order pushes arrived in Arabic, and an English
 * one got Arabic pushes for an English UI. Whichever language the tablet is
 * showing is the language this account reads — say so.
 *
 * users.locale is one of the self-service columns migration 053 grants back to
 * `authenticated`, on the owner's own row only, so this needs no RPC.
 */
import { getSupabase } from './supabase';
import type { RestaurantLocale } from './i18n';

export async function syncProfileLocale(locale: RestaurantLocale): Promise<void> {
  const sb = getSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return; // not signed in yet; the caller re-runs this after auth
  const { error } = await sb.from('users').update({ locale }).eq('id', user.id);
  if (error) throw error;
}
