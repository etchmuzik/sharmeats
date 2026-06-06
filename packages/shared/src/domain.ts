/**
 * Domain enums + constants shared across all four surfaces.
 *
 * These mirror the Postgres enums in supabase/migrations. When you add a value
 * here, add it to the matching SQL enum (and regenerate db-types).
 */

/** Verticals — category-agnostic root. Food now; others later (zero schema change). */
export type Vertical = 'food' | 'grocery' | 'pharmacy';

/** Who fulfills delivery for an order. */
export type FulfillmentType = 'platform' | 'self_delivery';

/** Payment rails. Card = Paymob hosted checkout; cash_on_delivery = COD (no gateway). */
export type PaymentMethod = 'card' | 'cash_on_delivery';

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

/** Coarse app role (one per user). Fine merchant scoping is via merchant_staff. */
export type AppRole = 'customer' | 'driver' | 'merchant_staff' | 'dispatcher' | 'admin';

/** Driver availability. */
export type DriverStatus = 'offline' | 'online' | 'on_job';

export type Vehicle = 'scooter' | 'motorbike' | 'bicycle' | 'car';

/** Dispatch mode — manual now (admin assigns), auto later (PostGIS nearest-driver). */
export type DispatchMode = 'manual' | 'auto';

/** Assignment lifecycle. */
export type AssignmentStatus =
  | 'offered'
  | 'accepted'
  | 'rejected'
  | 'completed'
  | 'reassigned';

/** Sharm el-Sheikh delivery zones (mirrors zone_type enum + zones seed). */
export type Zone =
  | 'naama'
  | 'hadaba'
  | 'nabq'
  | 'old_market'
  | 'soho'
  | 'sharks_bay'
  | 'el_salam'
  | 'mubarak_7'
  | 'el_rowaisat'
  | 'hay_el_nour'
  | 'el_hadaba_residential';

export const CURRENCY = 'EGP' as const;
