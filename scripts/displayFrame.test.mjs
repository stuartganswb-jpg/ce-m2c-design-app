// Harness for the board frame math (Shared/displayFrame.js — the pure half).
//   node scripts/displayFrame.test.mjs
// The module imports react / r3f / three for the component and the capture; the math is pulled
// through a stub loader so node needs none of them.
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../src/components/Shared/displayFrame.js', import.meta.url), 'utf8');
const mathOnly = src.split('/** The visible model')[0].replace(/^import .*$/mg, '');
const { boardFrameRect } = await import('data:text/javascript,' + encodeURIComponent(mathOnly));

let pass = 0, fail = 0;
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`); };
const near = (name, got, want, tol = 0.5) => { if (Math.abs(got - want) <= tol) { pass++; return; } fail++; console.log(`✗ ${name}\n    got  ${got}\n    want ${want} ± ${tol}`); };

// A 4 ft master rod drawn 1.2 world units long, the order is 16.75": world-per-inch = 1.2 / 16.75.
// Camera 3 units from the model centre, fov 50, a 900 × 420 pane.
const pane = { w: 900, h: 420 };
const model = { longAxisWorld: 1.2, centerDepth: 3 };
{
    const r = boardFrameRect({ widthIn: 24, heightIn: 24, lengthInches: 16.75, model, pane, fovDeg: 50 });
    near('world per inch is the drawn rod over the ordered inches', r.worldPerInch, 1.2 / 16.75, 1e-9);
    const visibleH = 2 * 3 * Math.tan(25 * Math.PI / 180);
    near('the frame height is 24" of that scale against the visible height', r.h, 420 * (24 * 1.2 / 16.75) / visibleH);
    near('square board → square frame (pane aspect cancels)', r.w, r.h, 0.01);
    near('centred in the pane', r.x + r.w / 2, 450, 0.01);
    near('…both ways', r.y + r.h / 2, 210, 0.01);
    eq('at this distance the 24" board fits the pane (h ≈ 258 px < 420) → not oversize', r.oversize, false);
    eq('closer in (half the distance, frame doubles to ≈ 516 px) → oversize, the overlay turns red', boardFrameRect({ widthIn: 24, heightIn: 24, lengthInches: 16.75, model: { ...model, centerDepth: 1.5 }, pane, fovDeg: 50 }).oversize, true);
}
{
    // the rod inside the frame IS its ordered length: rod px / frame px = 16.75 / 24
    const r = boardFrameRect({ widthIn: 24, heightIn: 24, lengthInches: 16.75, model, pane, fovDeg: 50 });
    const visibleW = 2 * 3 * Math.tan(25 * Math.PI / 180) * (900 / 420);
    const rodPx = 900 * 1.2 / visibleW;
    near('the drawn rod spans 16.75/24 of the frame width', rodPx / r.w, 16.75 / 24, 1e-6);
}
{
    // zooming out (camera farther) shrinks the frame; a wider board widens it; a taller one lengthens it
    const far = boardFrameRect({ widthIn: 24, heightIn: 24, lengthInches: 16.75, model: { ...model, centerDepth: 6 }, pane });
    const base = boardFrameRect({ widthIn: 24, heightIn: 24, lengthInches: 16.75, model, pane });
    near('twice the distance, half the frame', far.h / base.h, 0.5, 1e-9);
    const wide = boardFrameRect({ widthIn: 36, heightIn: 24, lengthInches: 16.75, model, pane });
    near('a 36 × 24 board is 1.5× wider, same height', wide.w / base.w, 1.5, 1e-9); near('', wide.h, base.h, 1e-9);
    eq('zoomed out far enough the frame fits', boardFrameRect({ widthIn: 24, heightIn: 24, lengthInches: 16.75, model: { ...model, centerDepth: 12 }, pane }).oversize, false);
}
{
    // no ordered length → the GLB's metres stand in (0.0254 per inch); no pane / no depth → null
    near('no length: metres', boardFrameRect({ widthIn: 24, heightIn: 24, lengthInches: 0, model: { longAxisWorld: 1.2, centerDepth: 3 }, pane }).worldPerInch, 0.0254, 1e-12);
    eq('no pane → null', boardFrameRect({ widthIn: 24, heightIn: 24, lengthInches: 10, model, pane: { w: 0, h: 0 } }), null);
    eq('model behind the camera → null', boardFrameRect({ widthIn: 24, heightIn: 24, lengthInches: 10, model: { longAxisWorld: 1, centerDepth: -1 }, pane }), null);
    eq('blank sizes fall back to 24 × 24', boardFrameRect({ widthIn: '', heightIn: null, lengthInches: 16.75, model, pane }).w > 0, true);
}

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
