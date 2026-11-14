import '@fontsource-variable/exo-2';
import '@fontsource/jetbrains-mono';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { lf, loadDict, tpl } from './core/l10n';
import { getGame, setGame } from './core/store';
import { startEngine } from './game/engine';
import App from './ui/App';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
const uiRoot = document.getElementById('ui-root');

if (!canvas || !uiRoot) {
  throw new Error('Missing #game-canvas or #ui-root in index.html');
}

// A saved translated language: its dictionary arrives a moment later and the UI re-renders into it.
loadDict(getGame().settings.lang);
createRoot(uiRoot).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
// Without WebGL (switched off, blocked, or refused by the graphics driver) the engine cannot be built at all:
// the page then says so instead of staying empty.
try {
  startEngine(canvas);
} catch (err) {
  const reason = err instanceof Error ? err.message : String(err);
  setGame({
    fatal: lf(
      tpl`3B grafik (WebGL) başlatılamadı. Tarayıcının donanım hızlandırması açık olmalıdır. (${reason})`,
      tpl`3D graphics (WebGL) could not be started. The browser’s hardware acceleration must be on. (${reason})`,
    ),
  });
}
