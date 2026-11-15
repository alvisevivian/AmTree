self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname !== '/api/mission-window') return;
  event.respondWith((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows.find(item => item.id === event.clientId) || windows.find(item => item.url.startsWith(self.registration.scope));
    if (!client) return new Response(JSON.stringify({ error: 'Open AmTree before requesting an export.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    return new Promise(resolve => {
      const channel = new MessageChannel();
      channel.port1.onmessage = ({ data }) => {
        channel.port1.close();
        const headers = { 'Content-Type': data.type || 'application/json', 'Cache-Control': 'no-store' };
        if (url.searchParams.get('download') === '1' && !data.error) {
          const format = url.searchParams.get('format') || 'json';
          const extension = format.endsWith('-gif') ? 'gif' : format;
          headers['Content-Disposition'] = `attachment; filename="AmTree-${url.searchParams.get('site') || 'simulation'}.${extension}"`;
        }
        resolve(new Response(data.error ? JSON.stringify({ error: data.error }) : data.bytes, { status: data.error ? 400 : 200, headers }));
      };
      client.postMessage({ type: 'amtree-compute', query: url.search.slice(1) }, [channel.port2]);
    });
  })());
});
