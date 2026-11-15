import type { FlybyPose } from './App';

let started = false;
let pose: FlybyPose | null = null;
const frame = document.getElementById('startup-flight') as HTMLIFrameElement | null;
async function start() {
  if (started) return;
  started = true;
  clearTimeout(fallback);
  window.removeEventListener('message', message);
  try {
    const { mount } = await import('./mount');
    mount(pose);
  } catch {
    const intro = document.getElementById('startup-intro');
    if (intro) intro.textContent = 'Unable to load AmTree. Please reload the page.';
  }
}
function message(event: MessageEvent) {
  if (event.origin !== location.origin || event.source !== frame?.contentWindow) return;
  if (event.data?.type === 'earth-to-moon:pose') pose = event.data.pose;
  if (event.data === 'earth-to-moon:complete') void start();
}
window.addEventListener('message', message);
frame?.addEventListener('error', () => void start(), { once: true });
const fallback = window.setTimeout(() => void start(), 20000);
