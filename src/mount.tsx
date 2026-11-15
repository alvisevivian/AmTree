import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App, { type FlybyPose } from './App';
import './index.css';

export function mount(pose: FlybyPose | null) {
  const ready = () => {
    const intro = document.getElementById('startup-intro');
    if (!intro) return;
    intro.style.opacity = '0';
    intro.style.pointerEvents = 'none';
    setTimeout(() => intro.remove(), 300);
  };
  createRoot(document.getElementById('root')!).render(
    <StrictMode><App initialPose={pose} initialIntroComplete onVisualReady={ready}/></StrictMode>,
  );
}
