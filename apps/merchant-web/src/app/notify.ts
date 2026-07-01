'use client';

/**
 * Out-of-app new-order alerts for the merchant dashboard (B2).
 *
 * The dashboard is a static SPA (no push server), but it holds a live Supabase
 * Realtime subscription while the tab is open. That means we can fire an
 * OS-level notification the moment a new order arrives — so a busy kitchen gets
 * a system banner + sound even when the browser tab isn't the focused window
 * (as long as the browser is running with the dashboard tab open).
 *
 * This is the realistic ceiling for a static SPA: true closed-laptop push would
 * need a VAPID web-push pipeline with a server to send, which this Hostinger
 * static deploy doesn't have. Notification API + a service worker (for a
 * clickable banner that focuses the tab) is the proportionate solution.
 *
 * All calls are best-effort and SSR-safe — they no-op when Notification /
 * serviceWorker are unavailable, so nothing here can break the dashboard.
 */

const SW_PATH = '/sw.js';

/** Register the service worker (idempotent). Enables clickable notifications. */
export async function registerNotificationWorker(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register(SW_PATH);
  } catch {
    // SW registration is optional — the Notification constructor still works
    // without it (just not clickable-to-focus). Never throw.
  }
}

/** Whether the browser can show notifications at all. */
export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/** Current permission state ('default' | 'granted' | 'denied' | 'unsupported'). */
export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission;
}

/**
 * Ask the user to allow notifications. Returns the resulting permission. Must be
 * called from a user gesture (a click) to satisfy browser policy — the dashboard
 * wires this to an "Enable alerts" button.
 */
export async function requestNotificationPermission(): Promise<
  NotificationPermission | 'unsupported'
> {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/**
 * Fire a new-order notification. Prefers the service worker registration
 * (clickable, shows reliably when the tab is backgrounded); falls back to the
 * plain Notification constructor. No-ops unless permission is granted.
 */
export async function notifyNewOrder(shortCode: string | null, totalEgp: number | null): Promise<void> {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  const title = 'New order';
  const body = [shortCode ? `#${shortCode}` : null, totalEgp != null ? `EGP ${totalEgp}` : null]
    .filter(Boolean)
    .join(' · ') || 'A new order just came in.';
  const options: NotificationOptions = {
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'sharmeats-new-order', // collapse rapid-fire into one, but renotify:
    // @ts-expect-error renotify is valid at runtime but missing from the lib DOM types
    renotify: true,
    requireInteraction: false,
  };
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.showNotification(title, options);
        return;
      }
    }
    // Fallback: plain notification (not guaranteed clickable-to-focus).
    new Notification(title, options);
  } catch {
    // Best-effort — the in-tab chime + visual pulse still fire regardless.
  }
}
