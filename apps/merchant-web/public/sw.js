// Sharm Eats merchant dashboard service worker.
//
// Minimal by design: its only job is to make new-order notifications clickable —
// tapping the banner focuses an existing dashboard tab (or opens one). The
// dashboard is a static SPA with a live Supabase Realtime subscription, so the
// page itself decides WHEN to show a notification (reg.showNotification in
// notify.ts); this worker only handles the click. No push/VAPID pipeline here.

self.addEventListener('install', (event) => {
  // Activate immediately so the first load can show clickable notifications.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      // Focus an already-open dashboard tab if there is one.
      for (const client of allClients) {
        if ('focus' in client) {
          await client.focus();
          return;
        }
      }
      // Otherwise open the dashboard root.
      if (self.clients.openWindow) {
        await self.clients.openWindow('/');
      }
    })(),
  );
});
