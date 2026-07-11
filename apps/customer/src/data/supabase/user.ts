import { getSupabase } from './client';
import { rowToAddress, rowToPaymentMethod, rowToUser } from './mappers';
import type { Address, PaymentMethod, User } from '../types';
import { isPaymentMethodEnabled, withCashOnDelivery } from '../../lib/payments';

/** Why an account-deletion attempt could not complete. */
export type DeleteAccountReason = 'active_order' | 'failed';

/** Typed error so the UI can show the right message (active order vs. retry). */
export class AccountDeletionError extends Error {
  constructor(readonly reason: DeleteAccountReason) {
    super(`account deletion failed: ${reason}`);
    this.name = 'AccountDeletionError';
  }
}

export const userRepoSupabase = {
  async getMe(): Promise<User> {
    const sb = getSupabase();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { data, error } = await sb
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single();
    if (error) throw error;
    return rowToUser(data);
  },

  async update(patch: Partial<User>): Promise<User> {
    const sb = getSupabase();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const dbPatch: Record<string, unknown> = {};
    if (patch.displayName !== undefined) dbPatch.display_name = patch.displayName;
    if (patch.email !== undefined) dbPatch.email = patch.email;
    if (patch.defaultAddressId !== undefined) dbPatch.default_address_id = patch.defaultAddressId;
    if (patch.defaultPaymentMethodId !== undefined)
      dbPatch.default_payment_method_id = patch.defaultPaymentMethodId;
    if (patch.preferredCurrency !== undefined) dbPatch.preferred_currency = patch.preferredCurrency;
    if (patch.locale !== undefined) dbPatch.locale = patch.locale;
    if (patch.allergyProfile !== undefined) dbPatch.allergy_profile = patch.allergyProfile;
    const { data, error } = await sb
      .from('users')
      .update(dbPatch)
      .eq('id', user.id)
      .select()
      .single();
    if (error) throw error;
    return rowToUser(data);
  },

  async listAddresses(): Promise<Address[]> {
    const { data, error } = await getSupabase()
      .from('addresses')
      .select('*')
      .order('is_default', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(rowToAddress);
  },

  async addAddress(a: Address): Promise<Address> {
    const sb = getSupabase();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    // Write the GPS pin as PostGIS EWKT (geography column accepts this string).
    // Captured for every kind so the driver always has a map point.
    const geo =
      a.lat != null && a.lng != null ? `SRID=4326;POINT(${a.lng} ${a.lat})` : null;
    const { data, error } = await sb
      .from('addresses')
      .insert({
        user_id: user.id,
        kind: a.kind,
        label: a.label,
        hotel_id: a.hotelId ?? null,
        hotel_name: a.hotelName ?? null,
        room_number: a.roomNumber ?? null,
        handoff: a.handoff ?? null,
        street_text: a.streetText ?? null,
        building: a.building ?? null,
        apartment: a.apartment ?? null,
        landmark: a.landmark ?? null,
        beach_name: a.beachName ?? null,
        is_default: a.isDefault ?? false,
        geo,
      })
      .select()
      .single();
    if (error) throw error;
    return rowToAddress(data);
  },

  async setDefaultAddress(id: string): Promise<Address[]> {
    const sb = getSupabase();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    await sb.from('addresses').update({ is_default: false }).eq('user_id', user.id);
    await sb.from('addresses').update({ is_default: true }).eq('id', id);
    await sb.from('users').update({ default_address_id: id }).eq('id', user.id);
    return this.listAddresses();
  },

  async removeAddress(id: string): Promise<void> {
    const { error } = await getSupabase().from('addresses').delete().eq('id', id);
    if (error) throw error;
  },

  async listPaymentMethods(): Promise<PaymentMethod[]> {
    const { data, error } = await getSupabase()
      .from('payment_methods')
      .select('*')
      .order('is_default', { ascending: false });
    if (error) throw error;
    const saved = (data ?? []).map(rowToPaymentMethod).filter(isPaymentMethodEnabled);
    // COD is always available — a guest with no saved methods must still be able to pay.
    return withCashOnDelivery(saved);
  },

  async setDefaultPaymentMethod(id: string): Promise<PaymentMethod[]> {
    const sb = getSupabase();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    await sb.from('payment_methods').update({ is_default: false }).eq('user_id', user.id);
    await sb.from('payment_methods').update({ is_default: true }).eq('id', id);
    await sb.from('users').update({ default_payment_method_id: id }).eq('id', user.id);
    return this.listPaymentMethods();
  },

  /**
   * Register this device's Expo push token. Idempotent — (user_id, token) is
   * unique, so re-registering on every launch just touches updated_at.
   * RLS: push_tokens_owner_all lets a user manage only their own rows.
   */
  async registerPushToken(token: string, platform: 'ios' | 'android' | 'web'): Promise<void> {
    const sb = getSupabase();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { error } = await sb
      .from('push_tokens')
      .upsert({ user_id: user.id, token, platform }, { onConflict: 'user_id,token' });
    if (error) throw error;
  },

  /** Remove this device's token (sign-out) so the next account doesn't get our pushes. */
  async unregisterPushToken(token: string): Promise<void> {
    const { error } = await getSupabase().from('push_tokens').delete().eq('token', token);
    if (error) throw error;
  },

  /**
   * The caller's shareable referral code (e.g. SHARM-ABC123). The RPC lazily
   * generates one on first call, so this is safe to call from the invite screen
   * without any setup. RLS-safe: the SECURITY DEFINER fn scopes to auth.uid().
   */
  async myReferralCode(): Promise<string> {
    const { data, error } = await getSupabase().rpc('my_referral_code');
    if (error) throw error;
    if (typeof data !== 'string' || data.length === 0) {
      throw new Error('Could not load referral code');
    }
    return data;
  },

  /** Saved restaurants (owner-scoped by RLS). Returns restaurant ids, newest first. */
  async listFavorites(): Promise<string[]> {
    const { data, error } = await getSupabase()
      .from('favorites')
      .select('restaurant_id')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r: { restaurant_id: string }) => r.restaurant_id);
  },

  async setFavorite(restaurantId: string, on: boolean): Promise<void> {
    const sb = getSupabase();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    if (on) {
      const { error } = await sb
        .from('favorites')
        .upsert({ user_id: user.id, restaurant_id: restaurantId });
      if (error) throw error;
    } else {
      const { error } = await sb
        .from('favorites')
        .delete()
        .eq('user_id', user.id)
        .eq('restaurant_id', restaurantId);
      if (error) throw error;
    }
  },

  /**
   * Record that the signed-in user accepted the given Terms of Service version.
   *
   * Routes through the `record_terms_acceptance` SECURITY DEFINER RPC (mig 106),
   * which stamps users.terms_accepted_version/_at for auth.uid() with the server
   * clock.
   */
  async recordTermsAcceptance(version: string): Promise<void> {
    const sb = getSupabase();
    const { error } = await sb.rpc('record_terms_acceptance', { p_version: version });
    if (error) throw error;
  },

  /**
   * Permanently delete the signed-in user's account (Apple Guideline 5.1.1(v)).
   *
   * Invokes the `delete-account` Edge Function, which anonymizes + detaches the
   * user's orders (RPC) and then HARD-deletes the auth identity with the
   * service-role key (never exposed to the client). functions.invoke attaches
   * the current session JWT automatically.
   *
   * Throws AccountDeletionError('active_order') when an order is still in flight
   * (HTTP 409) so the caller can ask the user to finish/cancel it first, or
   * AccountDeletionError('failed') for any other/transient failure (safe to
   * retry — the server side is idempotent). On success, the caller must sign
   * out and clear local state; any still-valid JWT is stateless until expiry.
   */
  async deleteAccount(): Promise<void> {
    const sb = getSupabase();
    const { data, error } = await sb.functions.invoke('delete-account', { method: 'POST' });

    if (error) {
      // FunctionsHttpError carries the non-2xx Response; a 409 means active order.
      const resp = (error as { context?: Response }).context;
      if (resp?.status === 409) throw new AccountDeletionError('active_order');
      throw new AccountDeletionError('failed');
    }
    if (!data || (data as { success?: boolean }).success !== true) {
      const reason = (data as { error?: string } | null)?.error;
      throw new AccountDeletionError(reason === 'active_order' ? 'active_order' : 'failed');
    }
  },
};
