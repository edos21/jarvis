// Notifications only: no offline cache, Jarvis is useless without the Mac anyway.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || "Jarvis", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.key,
      data: { url: data.url || "/#hoy" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/#hoy";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Links outside Jarvis (a factory panel) open as they are; Jarvis links reuse an open window.
      const inside = url.startsWith("/");
      const open = inside ? windows.find((w) => new URL(w.url).origin === self.location.origin) : null;
      if (open) {
        // navigate() throws on a window this worker does not control yet; opening a new one still works.
        try {
          await open.navigate(url);
          return open.focus();
        } catch {
          return self.clients.openWindow(url);
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
