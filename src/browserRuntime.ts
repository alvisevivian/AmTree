let startEngine: ((query: string | undefined, port: MessagePort) => void) | undefined;
let warming: Promise<void> | undefined;
export function warmupScientificEngine() {
  return warming ||= new Promise<void>((resolve, reject) => {
    if (!startEngine) { reject(new Error('Browser runtime is not ready.')); return; }
    const channel = new MessageChannel();
    channel.port1.onmessage = ({ data }) => {
      channel.port1.close();
      if (data.error) reject(new Error(data.error)); else resolve();
    };
    startEngine(undefined, channel.port2);
  }).catch(error => { warming = undefined; throw error; });
}
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
  startEngine = (query, port) => {
    if (!engine) {
      engine = new Worker(import.meta.env.BASE_URL + 'runtime/worker.js?v=2', { type: 'module' });
      engine.onmessage = ({ data }) => {
        if (data.type === 'progress') {
          window.dispatchEvent(new CustomEvent('amtree:engine-progress', { detail: data.progress }));
          return;
        }
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
    pending.set(id, port);
    engine.postMessage({ id, query });
  };
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'amtree-compute') startEngine!(event.data.query, event.ports[0]);
  });
  await navigator.serviceWorker.register(import.meta.env.BASE_URL + 'browser-api-sw.js', { scope: import.meta.env.BASE_URL });
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => {
    navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
  });
}
