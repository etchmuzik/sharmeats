import type { Restaurant } from '@/lib/types';

/**
 * Current dashboard detail writes intentionally omit feature state. The legacy
 * endpoint still accepts p_featured for cached clients, but sending a stale
 * effective Gold flag after a tier change could alter editorial intent.
 */
export function buildAdminRestaurantDetailsPayload(form: Restaurant) {
  return {
    p_id: form.id,
    p_name: form.name.trim(),
    p_description: form.description,
    p_cuisines: form.cuisines,
    p_cuisine_label: form.cuisine_label,
    p_cover_image: form.cover_image.trim(),
    p_logo: form.logo,
    p_zone: form.zone,
    p_prep_time_low: form.prep_time_low,
    p_prep_time_high: form.prep_time_high,
    p_delivery_fee_egp: form.delivery_fee_egp,
    p_min_order_egp: form.min_order_egp,
    p_tourist_safe: form.tourist_safe,
    p_is_open: form.is_open,
    p_is_open_24h: form.is_open_24h,
    p_promo: form.promo,
    p_is_active: form.is_active,
  };
}
