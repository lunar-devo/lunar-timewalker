import '@fontsource-variable/exo-2';
import '@fontsource/jetbrains-mono';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { loadDict } from './core/l10n';
import { getGame } from './core/store';
import { startEngine } from './game/engine';
import App from './ui/App';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
const uiRoot = document.getElementById('ui-root');

if (!canvas || !uiRoot) {
  throw new Error('Missing #game-canvas or #ui-root in index.html');
}

// A saved translated language: its dictionary arrives a moment later and the UI re-renders into it.
loadDict(getGame().settings.lang);
startEngine(canvas);
createRoot(uiRoot).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
