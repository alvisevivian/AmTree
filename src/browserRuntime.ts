export async function installBrowserRuntime() {
  if (!('serviceWorker' in navigator)) throw new Error('AmTree requires a browser with service worker support and HTTPS (or localhost).');
  let engine: Worker | undefined;
  let sequence = 0;
  const pending = new Map<number, MessagePort>();
  document.addEventListener('click', async event => {
    const target = event.target instanceof Element ? event.target.closest('a[download]') : null;
    if (!(target instanceof HTMLAnchorElement)) return;
    const url = new URL(target.href);
    if (url.origin !== location.origin || url.pathname !== '/api/mission-window') return;
    event.preventDefault();
    if (target.getAttribute('aria-busy') === 'true') return;
    target.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error((await response.json()).error || 'Unable to generate the export.');
      const blob = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = blob;
      link.download = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'AmTree-export';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(blob), 60000);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to generate the export.');
    } finally {
      target.removeAttribute('aria-busy');
    }
  });
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type !== 'amtree-compute') return;
    if (!engine) {
      engine = new Worker(import.meta.env.BASE_URL + 'runtime/worker.js', { type: 'module' });
      engine.onmessage = ({ data }) => {
        const port = pending.get(data.id);
        if (!port) return;
        port.postMessage(data, data.bytes ? [data.bytes.buffer] : []);
        port.close();
        pending.delete(data.id);
      };
      engine.onerror = event => {
        for (const port of pending.values()) {
          port.postMessage({ error: `Unable to start the browser calculation engine: ${event.message}` });
          port.close();
        }
        pending.clear();
        engine?.terminate();
        engine = undefined;
      };
    }
    const id = ++sequence;
    pending.set(id, event.ports[0]);
    engine.postMessage({ id, query: event.data.query });
  });
  await navigator.serviceWorker.register(import.meta.env.BASE_URL + 'browser-api-sw.js', { scope: import.meta.env.BASE_URL });
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => {
    navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
  });
}
