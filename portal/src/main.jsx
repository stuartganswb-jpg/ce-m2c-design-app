import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import { ENGINE_VERSION } from '@engine/engineVersion.js';

// WHICH ENGINE THIS PORTAL WAS BUILT WITH (Stuart 2026-10-12, "total alignment"). The portal builds
// from HQ's own engine files ('@engine', vite.config.js); this is their stamp, put on the page where
// it can be read. The server's copy carries the same figure (functions/engine/MANIFEST.json), so a
// half that is behind the other can be seen, never guessed.
document.documentElement.dataset.engine = ENGINE_VERSION;

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
