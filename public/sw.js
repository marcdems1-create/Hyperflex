// HYPERFLEX Push Notification Service Worker
self.addEventListener('push', function(e) {
  var d = { title: 'HYPERFLEX', body: 'New whale alert', url: 'https://hyperflex.network/whales' };
  try { d = e.data.json(); } catch(err) {}
  e.waitUntil(
    self.registration.showNotification(d.title, {
      body: d.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: d.url || 'https://hyperflex.network/whales' },
      vibrate: [200, 100, 200],
      tag: 'whale-alert',
      renotify: true
    })
  );
});

self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  var url = e.notification.data && e.notification.data.url ? e.notification.data.url : 'https://hyperflex.network/whales';
  e.waitUntil(clients.openWindow(url));
});
