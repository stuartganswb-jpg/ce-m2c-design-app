import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeEngineVersion, stampSource, STAMP_FILE } from '../scripts/_lib/engineVersion.mjs';
import { mirrorPlan } from '../scripts/sync-engine.mjs';

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
// This build's engine, as the server's copy would be stamped if it were made from the same commit.
const { version: engineVersion, closureHash } = mirrorPlan(REPO);
const SITE_ENGINE = { engineVersion, closureHash };

// The engine's version is its source: the hash of the engine files AS BUILT, computed here exactly as
// HQ's own build computes it (scripts/stamp-engine-version.mjs on prebuild) — never read from the
// committed stamp file, which is behind the code whenever somebody forgets to run the stamp.
const engineStamp = () => ({
  name: 'engine-stamp',
  enforce: 'pre',
  load(id) {
    return resolve(id.split('?')[0]) === STAMP ? stampSource(computeEngineVersion(REPO)) : null;
  },
  // …AND THE SITE SAYS WHICH ENGINE IT WAS BUILT WITH, WHERE ITS SERVER CAN READ IT (step 3, 2026-10-13).
  // The portal's Cloud Functions run a COPY of the engine that is deployed by hand; this site is rebuilt on
  // every push. /engine.json is this build's stamp — the engine's version and the hash of every file the
  // server copies, worked out by the same function that makes the copy (scripts/sync-engine.mjs) — so the
  // server (portalEngineStatus) and HQ's Portal Access can tell "in line" from "behind" instead of guessing.
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'engine.json', source: JSON.stringify({ ...SITE_ENGINE, builtAt: new Date().toISOString() }) });
  },
});

// …AND IT DRAWS WITH HQ'S OWN DRAWING CODE (step 4, 2026-10-14). The configurator's picture is drawn by the same files HQ's
// CPQ draws with — Shared/DynamicModel.js, Shared/studioRig.js, Shared/finishPbr.js, Shared/hardwareThumbs.js — reached
// through '@engine' too. They are browser-only (React, three) and are not part of the server's copy, which takes only what
// scripts/sync-engine.mjs lists. Two things make HQ's files build here: they are .js files with JSX in them (as HQ's own build
// reads them), and the packages they import (react, three, the react-three pair) must resolve to THIS app's one copy — a
// file outside portal/ would otherwise look for them beside HQ, where Vercel installs nothing for this project.
export default defineConfig({
  plugins: [engineStamp(), react()],
  resolve: { alias: { '@engine': ENGINE }, dedupe: ['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/drei'] },
  esbuild: { loader: 'jsx', include: [/src\/components\/Shared\/.*\.js$/, /\.jsx$/], exclude: [] },
  optimizeDeps: { esbuildOptions: { loader: { '.js': 'jsx' } } },
  // The same stamp, in the bundle: what the portal sends with every configurator call (the server refuses a site on another engine).
  define: { __SITE_ENGINE__: JSON.stringify(SITE_ENGINE) },
  // The dev server may read the engine, which sits outside portal/.
  server: { fs: { allow: [REPO] } },
});
