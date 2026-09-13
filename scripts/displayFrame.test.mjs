// Harness for the board frame math (Shared/displayFrame.js — the pure half).
//   node scripts/displayFrame.test.mjs
// The module imports react / r3f / three for the component and the capture; the math is pulled
// through a stub loader so node needs none of them.
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../src/components/Shared/displayFrame.js', import.meta.url), 'utf8');
const mathOnly = src.split('/** The visible model')[0].replace(/^import .*$/mg, '');
const { fixedBoardFrame, boardReading, depthForTrueScale } = await import('data:text/javascript,' + encodeURIComponent(mathOnly));

let pass = 0, fail = 0;
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`); };
const near = (name, got, want, tol = 0.5) => { if (Math.abs(got - want) <= tol) { pass++; return; } fail++; console.log(`✗ ${name}\n    got  ${got}\n    want ${want} ± ${tol}`); };

const pane = { w: 900, h: 420 };
const fovDeg = 50;
const visibleH = (d) => 2 * d * Math.tan(25 * Math.PI / 180);

// ── the frame is pinned to the pane ─────────────────────────────────────────────────────────
{
    const f = fixedBoardFrame({ widthIn: 24, heightIn: 24, pane });
    near('a square board in a wide pane is limited by the height: 92% of 420', f.h, 386.4, 1e-9);
    near('…and square', f.w, f.h, 1e-9);
    near('px per inch = frame px over board inches', f.pxPerInch, 386.4 / 24, 1e-9);
    near('centred horizontally', f.x + f.w / 2, 450, 1e-9);
    near('centred vertically', f.y + f.h / 2, 210, 1e-9);
    const far = fixedBoardFrame({ widthIn: 24, heightIn: 24, pane });
    eq('the frame does not depend on the camera — same pane, same frame', far, f);
    const wide = fixedBoardFrame({ widthIn: 96, heightIn: 24, pane });
    near('a 96 × 24 board is limited by the width: 92% of 900', wide.w, 828, 1e-9);
    near('…4:1', wide.h, 207, 1e-9);
    eq('no pane → null', fixedBoardFrame({ widthIn: 24, heightIn: 24, pane: { w: 0, h: 0 } }), null);
    near('blank sizes fall back to 24 × 24', fixedBoardFrame({ widthIn: '', heightIn: null, pane }).w, f.w, 1e-9);
    near('a bad margin falls back to 92%', fixedBoardFrame({ widthIn: 24, heightIn: 24, pane, margin: 7 }).h, 386.4, 1e-9);
    near('a margin of 1 fills the pane', fixedBoardFrame({ widthIn: 24, heightIn: 24, pane, margin: 1 }).h, 420, 1e-9);
}

// ── the reading: what the drawn rod measures on that board ──────────────────────────────────
// A 4 ft master rod drawn 1.2 world units long; the order is 16.75". Camera 3 units from the model centre.
const frame = fixedBoardFrame({ widthIn: 24, heightIn: 24, pane });
{
    const model = { longAxisWorld: 1.2, centerDepth: 3 };
    const projectedPx = 420 * 1.2 / visibleH(3);
    const r = boardReading({ model, pane, fovDeg, frame });
    near('reading = projected px over px-per-inch', r, projectedPx / frame.pxPerInch, 1e-9);
    near('zoom in (half the depth) doubles the reading — the frame did not move', boardReading({ model: { ...model, centerDepth: 1.5 }, pane, fovDeg, frame }), 2 * r, 1e-9);
    near('zoom out (twice the depth) halves it', boardReading({ model: { ...model, centerDepth: 6 }, pane, fovDeg, frame }), r / 2, 1e-9);
    near('a bigger board at the same zoom reads more inches for the same px', boardReading({ model, pane, fovDeg, frame: fixedBoardFrame({ widthIn: 48, heightIn: 48, pane }) }), 2 * r, 1e-9);
    eq('nothing drawn → null', boardReading({ model: null, pane, fovDeg, frame }), null);
    eq('model behind the camera → null', boardReading({ model: { longAxisWorld: 1, centerDepth: -1 }, pane, fovDeg, frame }), null);
    eq('no frame → null', boardReading({ model, pane, fovDeg, frame: null }), null);
}

// ── ⌖ true scale: the depth where the reading equals the ordered inches ─────────────────────
{
    const d = depthForTrueScale({ longAxisWorld: 1.2, lengthInches: 16.75, pane, fovDeg, frame });
    near('at that depth the rod reads exactly 16.75"', boardReading({ model: { longAxisWorld: 1.2, centerDepth: d }, pane, fovDeg, frame }), 16.75, 1e-9);
    near('…and spans 16.75/24 of the frame', (420 * 1.2 / visibleH(d)) / frame.w, 16.75 / 24, 1e-9);
    const d8 = depthForTrueScale({ longAxisWorld: 1.2, lengthInches: 8, pane, fovDeg, frame });
    eq('a shorter order at the same drawn size wants the camera farther away', d8 > d, true);
    near('twice the inches, half the depth', depthForTrueScale({ longAxisWorld: 1.2, lengthInches: 33.5, pane, fovDeg, frame }), d / 2, 1e-9);
    // strict null: JSON would read an Infinity depth as null too
    eq('no ordered length → null (nothing to be true to)', depthForTrueScale({ longAxisWorld: 1.2, lengthInches: 0, pane, fovDeg, frame }) === null, true);
    eq('nothing drawn → null', depthForTrueScale({ longAxisWorld: 0, lengthInches: 16.75, pane, fovDeg, frame }) === null, true);
}

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
