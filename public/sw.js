/* Kuytu service worker: makes the app installable and delivers notifications.
   It deliberately caches nothing, so no message data is ever written by it. */

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("notificationclick", (event) => {
  const chatId = event.notification.tag;
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        client.postMessage({ type: "open-chat", id: chatId });
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow("/");
    })(),
  );
});
