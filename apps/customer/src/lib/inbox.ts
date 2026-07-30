/**
 * Notification inbox — flag, copy resolution and tap routing (Package 03 Slice H).
 *
 * ================= WHY THERE IS A FLAG AT ALL =================
 * The spec gates this slice on the transport being truthful and on pilot evidence,
 * and NEITHER is met: push_messages is empty because the expo-push deploy that
 * writes it has not happened. An always-on inbox would therefore render blank for
 * every customer, which reads as a broken feature rather than an empty one.
 *
 * So it ships behind EXPO_PUBLIC_INBOX_ENABLED, defaulting OFF. Turn it on once
 * real messages exist.
 *
 * ================= WHERE THE TEXT COMES FROM =================
 * The server returns an EVENT, not a body (mig 179): ordinary events store no copy
 * and localize at dispatch from the edge function's copy table. Rather than
 * re-author all of that copy in the app bundle — two sources of truth for one
 * sentence, guaranteed to drift — the inbox shows a short CATEGORY LABEL per event
 * plus, for campaigns, the authored body verbatim. See EVENT_LABELS below.
 */
import type { InboxMessage } from '../data/types';
import { isAllowedRoute } from './notificationRoute';

/**
 * Is the inbox switched on?
 *
 * Read at call time rather than module load so a test can flip it. Anything other
 * than the exact string 'true' is off — a typo must leave the feature dark rather
 * than half-enable it, the same fail-closed rule the lifecycle mode uses.
 */
export function isInboxEnabled(): boolean {
  return process.env.EXPO_PUBLIC_INBOX_ENABLED === 'true';
}

/** What one row displays. `t()` resolves the key; literals are used verbatim. */
export interface InboxCopyKeys {
  /** A short CATEGORY label, not a reproduction of the push sentence. */
  titleKey: string;
  /** Campaign text, already authored for that send — shown verbatim. */
  literalBody?: string;
}

/**
 * Which label an event carries.
 *
 * ================= WHY A LABEL AND NOT THE PUSH SENTENCE =================
 * The obvious design re-renders the notification's own words here. That would mean
 * re-authoring every event's title and body in the app bundle — 17 events x 2
 * strings x 5 locales — while the SAME strings already live in the edge function's
 * copy.ts, which is where the push text actually comes from.
 *
 * Two sources of truth for one sentence drift. Someone improves the push copy, the
 * inbox keeps saying the old thing, and the customer sees two different texts for
 * one notification — the exact inconsistency the inbox is supposed to resolve.
 *
 * So the inbox shows a short category label ("Order update", "Reward", "Reminder")
 * and, for campaigns, the authored body verbatim. It cannot drift from the push
 * because it is not trying to reproduce it. If the product later wants the full
 * sentence, the right fix is to STORE the rendered copy on push_messages at
 * dispatch — one source, written once — not to duplicate the table.
 */
const EVENT_LABELS: Record<string, string> = {
  order_paid: 'inbox.labelOrder',
  order_accepted: 'inbox.labelOrder',
  order_ready: 'inbox.labelOrder',
  order_picked_up: 'inbox.labelOrder',
  order_out_for_delivery: 'inbox.labelOrder',
  order_delivered: 'inbox.labelOrder',
  order_rejected: 'inbox.labelOrder',
  order_cancelled: 'inbox.labelOrder',
  driver_assigned: 'inbox.labelOrder',
  payment_failed: 'inbox.labelPayment',
  credit_issued: 'inbox.labelReward',
  referral_rewarded: 'inbox.labelReward',
  tier_promoted: 'inbox.labelReward',
  new_message: 'inbox.labelMessage',
  support_reply: 'inbox.labelMessage',
  cart_reminder: 'inbox.labelReminder',
  reorder_reminder: 'inbox.labelReminder',
  campaign: 'inbox.labelOffer',
};

export function inboxCopyKeys(m: InboxMessage): InboxCopyKeys {
  return {
    // An unrecognised event gets the generic label rather than a raw i18n key.
    titleKey: EVENT_LABELS[m.event] ?? 'inbox.labelGeneric',
    // Campaign body only: it was authored for that send and IS the real text.
    literalBody: m.customBody || undefined,
  };
}

/**
 * Where a row's tap should go, or null if nowhere safe.
 *
 * REUSES the Slice F allow-list rather than defining a second one. A separate list
 * would drift, and the two would disagree about which destinations are safe — the
 * inbox would then become a way to reach screens the push layer refuses (/signin,
 * /delete-account). One list, one rule.
 *
 * The order fallback is deliberate and matches the push: a message about an order
 * with no explicit route still opens that order.
 */
export function inboxRoute(m: InboxMessage): string | null {
  if (m.route && isAllowedRoute(m.route)) return m.route;
  if (m.orderId) {
    const candidate = `/order/${m.orderId}`;
    return isAllowedRoute(candidate) ? candidate : null;
  }
  return null;
}

/**
 * Can this row be tapped at all?
 *
 * The spec asks that "expired order actions degrade safely". A message whose order
 * has since been deleted resolves to no route, and a row that navigates nowhere
 * must not look tappable — a dead press reads as the app being broken.
 */
export function isInboxRowTappable(m: InboxMessage): boolean {
  return inboxRoute(m) !== null;
}

/** Unread = never read IN THE INBOX. Deliberately not `openedAt`, which is push-tap
 *  attribution: tapping a push does not mean the customer read it in the list, and
 *  conflating them would silently mark things read the customer never opened. */
export function isUnread(m: InboxMessage): boolean {
  return !m.readAt;
}
