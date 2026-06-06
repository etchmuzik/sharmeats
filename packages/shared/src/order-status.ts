/**
 * Order status state machine — the SHARED KERNEL.
 *
 * This is the single definition of legal order transitions, imported by all
 * four surfaces (customer, driver, merchant, admin). The Postgres RPC
 * `advance_order_status` mirrors this exact table as the authority — clients
 * use it to know which action buttons to render; the server enforces it.
 *
 * Keep this in lockstep with supabase/migrations/011_rpcs.sql. If you add a
 * status or a transition here, update the SQL CASE in advance_order_status too.
 */

export type OrderStatus =
  | 'placed'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'picked_up'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'
  | 'rejected';

/** Who is allowed to drive a given transition. */
export type Actor = 'customer' | 'merchant' | 'driver' | 'dispatcher' | 'admin';

export interface Transition {
  from: OrderStatus;
  to: OrderStatus;
  /** Roles permitted to perform this transition (admin is implicitly allowed everywhere). */
  by: Actor[];
}

/**
 * The legal forward + terminal transitions.
 *
 * Happy path: placed → accepted → preparing → ready → picked_up →
 *             out_for_delivery → delivered
 *
 * Notes on fulfillment:
 * - For PLATFORM-delivered orders, the driver drives picked_up → delivered.
 * - For SELF-delivery merchants, the merchant drives ready → picked_up →
 *   out_for_delivery → delivered themselves (assigned_driver_id stays null),
 *   so merchant is included on those transitions as well.
 *
 * Cancellation policy is intentionally split out below (CANCEL_TRANSITIONS) so
 * it can be tuned independently of the forward flow.
 */
export const FORWARD_TRANSITIONS: readonly Transition[] = [
  { from: 'placed', to: 'accepted', by: ['merchant', 'admin'] },
  { from: 'accepted', to: 'preparing', by: ['merchant', 'admin'] },
  { from: 'preparing', to: 'ready', by: ['merchant', 'admin'] },
  // Pickup: a platform driver picks up; a self-delivery merchant marks pickup.
  { from: 'ready', to: 'picked_up', by: ['driver', 'merchant', 'admin'] },
  { from: 'picked_up', to: 'out_for_delivery', by: ['driver', 'merchant', 'admin'] },
  { from: 'out_for_delivery', to: 'delivered', by: ['driver', 'merchant', 'admin'] },
] as const;

/**
 * Cancellation / rejection transitions.
 *
 * PLACEHOLDER POLICY — to be finalized with a product decision (see the
 * cancellation-policy question). The conservative default below:
 * - Merchant may REJECT only before they've started cooking (placed/accepted).
 * - Customer may CANCEL only before the merchant accepts (placed) — once the
 *   kitchen accepts, cancellation needs admin involvement (refund/again).
 * - Admin may cancel from any non-terminal state (ops override).
 *
 * This will be replaced/confirmed by the answer to the cancellation question.
 */
export const CANCEL_TRANSITIONS: readonly Transition[] = [
  { from: 'placed', to: 'rejected', by: ['merchant', 'admin'] },
  { from: 'accepted', to: 'rejected', by: ['merchant', 'admin'] },
  { from: 'placed', to: 'cancelled', by: ['customer', 'admin'] },
  // Admin override from later states:
  { from: 'accepted', to: 'cancelled', by: ['admin'] },
  { from: 'preparing', to: 'cancelled', by: ['admin'] },
  { from: 'ready', to: 'cancelled', by: ['admin'] },
  { from: 'picked_up', to: 'cancelled', by: ['admin'] },
  { from: 'out_for_delivery', to: 'cancelled', by: ['admin'] },
] as const;

export const ALL_TRANSITIONS: readonly Transition[] = [
  ...FORWARD_TRANSITIONS,
  ...CANCEL_TRANSITIONS,
];

/** Terminal states — no further transitions allowed. */
export const TERMINAL_STATUSES: readonly OrderStatus[] = [
  'delivered',
  'cancelled',
  'rejected',
] as const;

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** The single next forward status on the happy path, or null if terminal/branching. */
export function nextForwardStatus(status: OrderStatus): OrderStatus | null {
  const t = FORWARD_TRANSITIONS.find((x) => x.from === status);
  return t ? t.to : null;
}

/** Can `actor` move an order from `from` to `to`? Admin is always allowed. */
export function canTransition(from: OrderStatus, to: OrderStatus, actor: Actor): boolean {
  if (actor === 'admin') {
    return ALL_TRANSITIONS.some((t) => t.from === from && t.to === to);
  }
  return ALL_TRANSITIONS.some(
    (t) => t.from === from && t.to === to && t.by.includes(actor),
  );
}

/** All statuses an actor can move the order to from its current status. */
export function allowedNextStatuses(from: OrderStatus, actor: Actor): OrderStatus[] {
  return ALL_TRANSITIONS.filter(
    (t) => t.from === from && (actor === 'admin' || t.by.includes(actor)),
  ).map((t) => t.to);
}

/** Ordered list of happy-path statuses for rendering a progress timeline. */
export const HAPPY_PATH: readonly OrderStatus[] = [
  'placed',
  'accepted',
  'preparing',
  'ready',
  'picked_up',
  'out_for_delivery',
  'delivered',
] as const;
