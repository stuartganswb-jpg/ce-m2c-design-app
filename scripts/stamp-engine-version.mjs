#!/usr/bin/env node
// Regenerates src/components/Shared/engineVersion.js from the engine files' content (S1, 2026-09-15).
// Runs on every build (package.json "prebuild") so production never ships a stale stamp; run it by
// hand after an engine change and commit the result — scripts/cartStaleness.test.mjs fails until
// you do. Writes only when the value changed, so a clean tree stays clean.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeEngineVersion, committedEngineVersion, stampSource, STAMP_FILE } from './_lib/engineVersion.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const next = computeEngineVersion(ROOT);
const prev = committedEngineVersion(ROOT);
const want = stampSource(next);
let current = '';
try { current = readFileSync(join(ROOT, STAMP_FILE), 'utf8'); } catch { current = ''; }
if (current === want) {
    console.log(`engine version ${next} — stamp already current`);
} else {
    writeFileSync(join(ROOT, STAMP_FILE), want);
    console.log(`engine version ${prev || '(none)'} → ${next} — ${STAMP_FILE} written`);
}
