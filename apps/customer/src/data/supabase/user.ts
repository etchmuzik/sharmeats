import { getSupabase } from './client';
import { rowToAddress, rowToPaymentMethod, rowToUser } from './mappers';
import type {
  Address,
  NotificationPrefs,
  NotificationPrefsPatch,
  PaymentMethod,
  SavedItem,
  User,
  InboxMessage,
} from '../types';
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
   * Register this device's Expo push token. The server RPC atomically transfers
   * an existing device token to the current account, so a shared device cannot
   * keep receiving the previous account's private order notifications.
   */
  async registerPushToken(token: string, platform: 'ios' | 'android' | 'web'): Promise<void> {
    const sb = getSupabase();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { error } = await sb.rpc('register_push_token', {
      p_token: token,
      p_platform: platform,
    });
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

  /**
   * Saved DISHES (mig 139), newest first. One RPC returns the item and its
   * restaurant's display state, so the Saved screen needs no client-side join.
   * Unavailable items and closed restaurants ARE returned — the screen greys
   * them out instead of hiding them.
   */
  async listFavoriteItems(): Promise<SavedItem[]> {
    const { data, error } = await getSupabase().rpc('my_favorite_items');
    if (error) throw error;
    return ((data ?? []) as FavoriteItemRow[]).map((r) => ({
      menuItemId: r.menu_item_id,
      restaurantId: r.restaurant_id,
      name: r.item_name,
      description: r.item_description ?? '',
      priceEgp: r.price_egp,
      image: r.image ?? '',
      isAvailable: r.is_available,
      restaurantName: r.restaurant_name,
      restaurantIsOpen: r.restaurant_is_open,
      restaurantIsActive: r.restaurant_is_active,
      savedAt: new Date(r.created_at).getTime(),
    }));
  },

  /** Returns the saved menu-item ids only — used to hydrate the heart icons. */
  async listFavoriteItemIds(): Promise<string[]> {
    const { data, error } = await getSupabase()
      .from('favorite_items')
      .select('menu_item_id')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r: { menu_item_id: string }) => r.menu_item_id);
  },

  /**
   * Save/unsave a dish. restaurantId is required on save: the row denormalises
   * it, and the composite FK rejects a value that disagrees with the item.
   * There is no UPDATE grant, so save-then-unsave is insert + delete.
   */
  async setFavoriteItem(menuItemId: string, restaurantId: string, on: boolean): Promise<void> {
    const sb = getSupabase();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    if (on) {
      const { error } = await sb
        .from('favorite_items')
        .upsert(
          { user_id: user.id, menu_item_id: menuItemId, restaurant_id: restaurantId },
          { onConflict: 'user_id,menu_item_id', ignoreDuplicates: true },
        );
      if (error) throw error;
    } else {
      const { error } = await sb
        .from('favorite_items')
        .delete()
        .eq('user_id', user.id)
        .eq('menu_item_id', menuItemId);
      if (error) throw error;
    }
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

  /**
   * Notification preferences (mig 138).
   *
   * Reads go through get_notification_prefs() rather than selecting the table,
   * so the DEFAULTS live in one place: a user with no row yet gets
   * transactional=on, marketing=off from the server, and the client never
   * encodes defaults that could drift from the table's.
   */
  async getNotificationPrefs(): Promise<NotificationPrefs> {
    const sb = getSupabase();
    const { data, error } = await sb.rpc('get_notification_prefs');
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as NotificationPrefsRow | null;
    return {
      transactional: row?.transactional ?? true,
      marketing: row?.marketing ?? false,
      quietHoursStart: row?.quiet_hours_start ?? null,
      quietHoursEnd: row?.quiet_hours_end ?? null,
      timezone: row?.timezone ?? 'Africa/Cairo',
    };
  },

  /**
   * Writes go through set_notification_prefs(), which only ever touches the
   * CALLER's row and stamps the marketing consent timestamp server-side.
   * Undefined fields are sent as null = "leave unchanged", so toggling one
   * switch never clobbers the other.
   */
  async setNotificationPrefs(patch: NotificationPrefsPatch): Promise<NotificationPrefs> {
    const sb = getSupabase();
    const { data, error } = await sb.rpc('set_notification_prefs', {
      p_transactional: patch.transactional ?? null,
      p_marketing: patch.marketing ?? null,
      p_quiet_hours_start: patch.quietHoursStart ?? null,
      p_quiet_hours_end: patch.quietHoursEnd ?? null,
      p_timezone: patch.timezone ?? null,
      p_clear_quiet_hours: patch.clearQuietHours ?? false,
      p_source: 'settings',
    });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as NotificationPrefsRow | null;
    return {
      transactional: row?.transactional ?? true,
      marketing: row?.marketing ?? false,
      quietHoursStart: row?.quiet_hours_start ?? null,
      quietHoursEnd: row?.quiet_hours_end ?? null,
      timezone: row?.timezone ?? 'Africa/Cairo',
    };
  },

  /**
   * Record that a notification was opened (Package 03 Slice F).
   *
   * DELIBERATELY SWALLOWS EVERYTHING. This runs on the notification-tap path,
   * immediately before navigation, and attribution is worth strictly less than the
   * customer reaching the screen they tapped. So a missing session, an old backend
   * without the RPC (PGRST202), or being offline must all be no-ops rather than
   * anything that could interrupt routing.
   *
   * The server decides whether the caller is really the recipient — see mig 175. A
   * non-recipient gets silence, so nothing here needs to guess.
   */
  async recordNotificationOpen(messageId: string): Promise<void> {
    try {
      await getSupabase().rpc('record_notification_open', { p_message_id: messageId });
    } catch {
      // See above: attribution never blocks a tap.
    }
  },

  /**
   * Inbox page (Package 03 Slice H).
   *
   * Keyset cursor, not offset: an inbox grows at the head, so an offset page 2
   * would repeat rows that page 1 already showed once a new message arrives.
   */
  async notificationInbox(
    cursor?: { queuedAt: string; id: string },
  ): Promise<InboxMessage[]> {
    const { data, error } = await getSupabase().rpc('my_notification_inbox', {
      p_limit: 20,
      p_before_queued: cursor?.queuedAt ?? null,
      p_before_id: cursor?.id ?? null,
    });
    if (error) throw error;
    return ((data ?? []) as InboxRow[]).map(rowToInboxMessage);
  },

  async unreadNotificationCount(): Promise<number> {
    const { data, error } = await getSupabase().rpc('my_unread_notification_count');
    if (error) throw error;
    return typeof data === 'number' ? data : 0;
  },

  /**
   * Mark one message read.
   *
   * Swallows failures: read-state is convenience, and a customer who taps a
   * message should never see an error because a badge count could not update.
   * The server refuses a non-recipient silently anyway (mig 179).
   */
  async markNotificationRead(messageId: string): Promise<void> {
    try {
      await getSupabase().rpc('mark_notification_read', { p_message_id: messageId });
    } catch {
      // See above.
    }
  },
};

interface FavoriteItemRow {
  menu_item_id: string;
  restaurant_id: string;
  item_name: string;
  item_description: string | null;
  price_egp: number;
  image: string | null;
  is_available: boolean;
  restaurant_name: string;
  restaurant_is_open: boolean;
  restaurant_is_active: boolean;
  created_at: string;
}

interface NotificationPrefsRow {
  transactional: boolean;
  marketing: boolean;
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
  timezone: string;
}

/** Raw row from my_notification_inbox. */
interface InboxRow {
  id: string;
  event: string;
  category: string;
  order_id: string | null;
  route: string | null;
  vertical: string | null;
  custom_title: string | null;
  custom_body: string | null;
  queued_at: string;
  opened_at: string | null;
  read_at: string | null;
}

/**
 * `?? undefined` throughout rather than keeping nulls: a literal `null` reaching a
 * template renders as the string "null", which is the class of bug the catalog
 * mapper already had (see mappers.ts).
 */
function rowToInboxMessage(r: InboxRow): InboxMessage {
  return {
    id: r.id,
    event: r.event,
    category: r.category === 'marketing' ? 'marketing' : 'operational',
    orderId: r.order_id ?? undefined,
    route: r.route ?? undefined,
    vertical: r.vertical ?? undefined,
    customTitle: r.custom_title ?? undefined,
    customBody: r.custom_body ?? undefined,
    queuedAt: r.queued_at,
    openedAt: r.opened_at ?? undefined,
    readAt: r.read_at ?? undefined,
  };
}
