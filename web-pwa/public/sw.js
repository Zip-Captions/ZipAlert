const CACHE_NAME = "zip-alert-v1";
const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/src/main.tsx",
  "/src/App.tsx",
  "/src/index.css",
  "/public/manifest.json",
  "/icon-192.png",
  "/icon-512.png"
];

// Install: Cache critical shell assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[Service Worker] Pre-caching emergency shell assets");
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Activate: Purge old cache systems
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log("[Service Worker] Removing deprecated cache", key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch Interception: Cache First with dynamic network fallback
self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Return cached shell immediately, fetch fresh copy in background to refresh cache
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
            }
          })
          .catch(() => {/* Ignore background update failures */});
        return cachedResponse;
      }
      return fetch(event.request).catch(() => {
        // Safe offline page fallback if needed
        return caches.match("/");
      });
    })
  );
});

// Background Push Notification Listener
self.addEventListener("push", (event) => {
  if (!event.data) return;
  
  try {
    const payload = event.data.json();
    const { title, body, channel_id, status } = payload.notification || payload.data || {};
    
    const isCritical = status === "LOCKDOWN" || status === "FIRE_ALARM";
    
    const options = {
      body: body || "Crisis alert updated.",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: "emergency-broadcast",
      requireInteraction: isCritical, // Keep visible until user dismisses
      silent: false,
      renotify: isCritical,
      vibrate: isCritical 
        ? [500, 100, 500, 100, 500, 100, 500, 100, 500] // Powerful long pattern
        : [200, 100, 200], // Discrete 3-pulse for teachers
      data: {
        status: status,
        url: status === "SOFT_LOCKDOWN" ? "/teacher" : "/student"
      }
    };

    event.waitUntil(
      self.registration.showNotification(title || "ZIP-ALERT SYSTEM", options)
    );
  } catch (error) {
    console.error("[Service Worker] Failed to parse push event data", error);
  }
});

// Notification click router
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";
  
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(targetUrl) && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
