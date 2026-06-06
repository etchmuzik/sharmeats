import { getSupabase } from './client';
import { rowToAddress, rowToPaymentMethod, rowToUser } from './mappers';
import type { Address, PaymentMethod, User } from '../types';
import { isPaymentMethodEnabled, withCashOnDelivery } from '../../lib/payments';

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
};
