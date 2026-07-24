/**
 * Self-onboarding data layer (mig 123).
 * Pure helpers are exported separately from the client wrappers so they can be
 * unit-tested without a Supabase client.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const MERCHANT_TERMS_VERSION = '2026-07-24-merchant-v1';

export type OnboardingPhase = 'none' | 'submitted' | 'rejected' | 'active';

export interface StaffOnboardingRow {
  restaurant_id: string;
  restaurants: {
    onboarding_status: string;
    onboarding_rejection_reason: string | null;
    name: string;
  };
}

export function resolveOnboardingPhase(
  staff: StaffOnboardingRow | null | undefined,
): OnboardingPhase {
  if (!staff) return 'none';
  const s = staff.restaurants.onboarding_status;
  if (s === 'submitted') return 'submitted';
  if (s === 'rejected') return 'rejected';
  // approved / live / anything unexpected → normal dashboard (RLS keeps drafts
  // customer-invisible regardless of what the client renders).
  return 'active';
}

const ERROR_COPY: Record<string, string> = {
  ZONE_NOT_SERVED: "We don't deliver in that area yet — pick the closest served zone, or contact us and we'll keep your details.",
  GEO_OUT_OF_AREA: "That location looks outside Sharm el-Sheikh. Please set your restaurant's actual position.",
  NOT_ELIGIBLE: "This account type can't apply as a restaurant. Sign up with a fresh email for your business.",
  INVALID_NAME: "Please enter your restaurant name (2–120 characters).",
  INVALID_PHONE: "Please enter a valid contact phone number.",
  TERMS_REQUIRED: "You need to accept the partner terms to submit.",
  AUTH_REQUIRED: "Your session expired — please log in again.",
};

export function rpcErrorToCopy(message: string): string {
  for (const code of Object.keys(ERROR_COPY)) {
    if (message.includes(code)) return ERROR_COPY[code];
  }
  return 'Something went wrong submitting your application. Please try again.';
}

export interface RestaurantApplication {
  name: string;
  description: string;
  cuisines: string[];
  phone: string;
  address: string;
  zone: string;
  lat: number;
  lng: number;
  isOpen24h: boolean;
  prepLow: number;
  prepHigh: number;
  payoutMethod: 'bank' | 'wallet';
  payoutBankName: string;
  payoutIban: string;
  payoutWallet: string;
  payoutHolder: string;
}

/** Calls apply_as_restaurant; resolves to the new restaurant id. Throws Error with raw RPC message (map with rpcErrorToCopy at the UI). */
export async function applyAsRestaurant(
  supabase: SupabaseClient,
  app: RestaurantApplication,
): Promise<string> {
  const { data, error } = await supabase.rpc('apply_as_restaurant', {
    p_name: app.name,
    p_description: app.description,
    p_cuisines: app.cuisines,
    p_phone: app.phone,
    p_address: app.address,
    p_zone: app.zone,
    p_lat: app.lat,
    p_lng: app.lng,
    p_is_open_24h: app.isOpen24h,
    p_prep_low: app.prepLow,
    p_prep_high: app.prepHigh,
    p_payout_method: app.payoutMethod,
    p_payout_bank_name: app.payoutBankName,
    p_payout_iban: app.payoutIban,
    p_payout_wallet: app.payoutWallet,
    p_payout_holder: app.payoutHolder,
    p_terms_version: MERCHANT_TERMS_VERSION,
  });
  if (error) throw new Error(error.message);
  return data as string;
}
