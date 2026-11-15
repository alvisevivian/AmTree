import type { FlybyPose } from './App';

let started = false;
let pose: FlybyPose | null = null;
let completed = false;
let application: Promise<typeof import('./mount')> | undefined;
const frame = document.getElementById('startup-flight') as HTMLIFrameElement | null;
async function start() {
  if (started) return;
  started = true;
  try {
    const { mount } = await (application ||= import('./mount'));
    mount(pose, completed);
  } catch {
    const intro = document.getElementById('startup-intro');
    if (intro) intro.textContent = 'Unable to load AmTree. Please reload the page.';
  }
}
function message(event: MessageEvent) {
  if (event.origin !== location.origin || event.source !== frame?.contentWindow) return;
  if (event.data === 'earth-to-moon:ready') {
    application ||= import('./mount');
    void application.catch(() => { application = undefined; });
    void start();
  }
  if (event.data?.type === 'earth-to-moon:pose') pose = event.data.pose;
  if (event.data === 'earth-to-moon:complete') { completed = true; clearTimeout(fallback); void start(); window.removeEventListener('message', message); }
}
window.addEventListener('message', message);
frame?.addEventListener('error', () => { completed = true; void start(); }, { once: true });
const fallback = window.setTimeout(() => {
  completed = true;
  if (started) window.dispatchEvent(new MessageEvent('message', { data: 'earth-to-moon:complete', origin: location.origin, source: frame?.contentWindow }));
  else void start();
}, 20000);
