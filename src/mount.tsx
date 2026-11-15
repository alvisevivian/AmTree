import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App, { type FlybyPose } from './App';
import './index.css';

export function mount(pose: FlybyPose | null, completed = true) {
  const logo = new Image();
  logo.src = import.meta.env.BASE_URL + 'assets/amtree-logo.svg';
  const logoReady = logo.decode().catch(() => {});
  let sceneReady = false;
  let animationComplete = completed;
  const ready = async () => {
    sceneReady = true;
    if (!animationComplete) return;
    await logoReady;
    const intro = document.getElementById('startup-intro');
    if (!intro) return;
    intro.style.opacity = '0';
    intro.style.pointerEvents = 'none';
    setTimeout(() => intro.remove(), 300);
  };
  const finished = (event: MessageEvent) => {
    const frame = document.getElementById('startup-flight') as HTMLIFrameElement | null;
    if (event.origin !== location.origin || event.source !== frame?.contentWindow || event.data !== 'earth-to-moon:complete') return;
    animationComplete = true;
    if (sceneReady) ready();
    window.removeEventListener('message', finished);
  };
  if (!completed) window.addEventListener('message', finished);
  createRoot(document.getElementById('root')!).render(
    <StrictMode><App initialPose={pose} initialIntroComplete={completed} externalIntro onVisualReady={ready}/></StrictMode>,
  );
}
