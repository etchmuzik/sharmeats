/**
 * The notification-attribution window (Package 03 Slice F).
 *
 * ================= WHY THIS IS ITS OWN MODULE =================
 * The window is SET when a notification is tapped (lib/push.ts) and READ when any
 * funnel event is built (lib/analytics.ts). push.ts already imports analytics.ts
 * for track(), so putting the state in either one creates an import cycle. A tiny
 * leaf module both can depend on is the fix.
 *
 * ================= WHY BOUNDED =================
 * The spec asks for message and campaign ids on "subsequent funnel events for a
 * bounded attribution window", and BOUNDED is the operative word. Without an
 * expiry, every order a customer ever places gets credited to the last
 * notification they happened to tap — which makes campaign reporting actively
 * misleading rather than merely absent. A push that genuinely drove a sale and one
 * that was tapped and ignored would look identical.
 *
 * 30 minutes covers the realistic tap → browse → basket → checkout path without
 * crediting tomorrow's dinner to today's push.
 *
 * ================= WHY MEMORY ONLY =================
 * Persisting the window would mean a tap survives an app restart hours later and
 * re-attributes an unrelated session. It would also put a marketing identifier
 * into device storage, which identity teardown (lib/identityTeardown.ts) would then
 * have to purge on sign-out or leak the previous person's campaign attribution to
 * the next one. In memory, sign-out clears it for free.
 */

const ATTRIBUTION_WINDOW_MS = 30 * 60 * 1000;

interface Attribution {
  messageId: string;
  campaignId?: string;
  /** Epoch ms after which this attribution is no longer claimed. */
  until: number;
}

let current: Attribution | null = null;

/** Called when a notification tap is recorded. */
export function openAttributionWindow(messageId: string, campaignId?: string): void {
  current = { messageId, campaignId, until: Date.now() + ATTRIBUTION_WINDOW_MS };
}

/**
 * Attribution properties for a funnel event, or `{}` once the window has closed.
 *
 * Expiry is checked on READ rather than by a timer: a timer would keep a JS
 * interval alive for no reason and could fire while the app is backgrounded, where
 * timers are unreliable anyway.
 */
export function notificationAttribution(): Record<string, string> {
  if (!current) return {};
  if (Date.now() > current.until) {
    current = null;
    return {};
  }
  return {
    attributed_message_id: current.messageId,
    ...(current.campaignId ? { attributed_campaign_id: current.campaignId } : {}),
  };
}

/**
 * Forget any open window.
 *
 * Called on sign-out: the next person to use this device must not have their
 * orders credited to a campaign the previous person tapped.
 */
export function clearNotificationAttribution(): void {
  current = null;
}
