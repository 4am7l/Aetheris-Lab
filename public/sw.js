/* global self, URL, fetch, Response */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/") || event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => new Response('<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Aetheris Lab</title><body style="background:#141b21;color:white;font:18px system-ui;padding:32px"><h1>Aetheris Lab</h1><p>Internet connection required. Please reconnect and reload.</p><p lang="ar" dir="rtl">يلزم الاتصال بالإنترنت. أعد الاتصال ثم حدّث الصفحة.</p></body></html>', {headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}})));
});
