import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeEngineVersion, stampSource, STAMP_FILE } from '../scripts/_lib/engineVersion.mjs';

// ── THE PORTAL BUILDS FROM HQ'S OWN ENGINE, NOT FROM A COPY (Stuart 2026-10-12: "ok as long as we can
// always keep in total alignment") ────────────────────────────────────────────────────────────────
// The old portal kept its own copies of CPQ's modules in src/shared/ and they fell behind HQ within
// weeks. '@engine' is src/components/Shared itself — the files HQ's CPQ runs — so a portal build can
// only ever contain the engine main has. It is for the engine's pure modules (what
// scripts/sync-engine.mjs --list prints): nothing there imports React, Firebase or a package, and
// nothing with a screen in it belongs behind this name.
const REPO = fileURLToPath(new URL('..', import.meta.url));
const ENGINE = fileURLToPath(new URL('../src/components/Shared', import.meta.url));
const STAMP = resolve(REPO, STAMP_FILE);

// The engine's version is its source: the hash of the engine files AS BUILT, computed here exactly as
// HQ's own build computes it (scripts/stamp-engine-version.mjs on prebuild) — never read from the
// committed stamp file, which is behind the code whenever somebody forgets to run the stamp.
const engineStamp = () => ({
  name: 'engine-stamp',
  enforce: 'pre',
  load(id) {
    return resolve(id.split('?')[0]) === STAMP ? stampSource(computeEngineVersion(REPO)) : null;
  },
});

export default defineConfig({
  plugins: [engineStamp(), react()],
  resolve: { alias: { '@engine': ENGINE } },
  // The dev server may read the engine, which sits outside portal/.
  server: { fs: { allow: [REPO] } },
});
