// specSheetTraverseDraw.js — draws the traverse sheets specSheetTraverse lists: two drawings per landscape
// letter sheet, hidden-line from the model, the way Stuart marked up the drafts on 2026-09-29.
//
//   wall bracket   END VIEW (wall at left: plate height, wall → each track ℄, overall to the face — to the rod's
//                  ℄ on a rod front — the 2" face, the carrier drop) + FRONT at the centre bracket (fascia dashed;
//                  a rod front solid, every ring beside the bracket) with the plate width and the client's dims:
//                  plate top → face top, face bottom → plate bottom, plate top → bottom of each ring (never the
//                  eyelet) and the ring drop kept.
//   ceiling        END VIEW with the ceiling on top — flush with the ceiling is the top, the lower plate "can drop
//                  up to 3/8" for leveling" — and the ceiling plate alone from above.
//   end arm/miter  PLAN from above (wall at left, the left end at the bottom) + SIDE (the return leg). An end arm
//                  is a part: the fascia is cut STRAIGHT and the arm butts it. A miter is a fee: the fascia itself
//                  is mitred back to the wall. The track stops short of the return by the app's cut rule.
//   track ends     from below: the manual plug beside the motorized drive, the track drawn where the cut rule
//                  puts it (the "track short" dimension itself was taken off both, 2026-10-01).
//
// The rear tier of a double sits where its TAG says (placement from the tag — the merged model parks one rear
// track for every bracket). The cut rule is Shared/traverseTags TRAVERSE_DEDUCTIONS — never a number of our own.
//
// Units: the modal's scene is in metres (it scales an inch model by 0.0254); `toInches` turns it back. Everything
// below is drawn in inches and the sheet is wrapped at 100 units per inch (the PAPERS 'letter' frame).
import { renderHiddenLine } from './hiddenLine.js';
import { extractWorldMeshes, groupBbox, translateMeshes, fracText, M2IN } from './specSheetGeometry.js';
import { TRAVERSE_DEDUCTIONS } from '../Shared/traverseTags.js';

const U = (s) => String(s ?? '').trim().toUpperCase();
const f3 = (n) => Number(n).toFixed(3);
const ins = (n) => `${fracText(Math.abs(n))}"`;
const PAGE_W = 11, PAGE_H = 8.5, M = 0.4, UW = PAGE_W - 2 * M, UH = (PAGE_H - 2 * M - 0.35) / 2;

// Views: X away from the wall, Y up, Z along the rail (the LEFT end at +Z).
const VIEW = {
    end: { right: [1, 0, 0], up: [0, 1, 0], viewDir: [0, 0, -1] },     // looking at the left end, wall at left
    front: { right: [0, 0, -1], up: [0, 1, 0], viewDir: [-1, 0, 0] },  // facing the wall; u = -Z
    plan: { right: [0, 0, -1], up: [-1, 0, 0], viewDir: [0, -1, 0] },  // from above, wall at the top; u = -Z, v = -X
    planL: { right: [1, 0, 0], up: [0, 0, -1], viewDir: [0, -1, 0] },  // from above, wall at left; u = X, v = -Z
    below: { right: [0, 0, -1], up: [1, 0, 0], viewDir: [0, 1, 0] },   // from below, wall at the bottom; u = -Z, v = X
};

// ── geometry ──────────────────────────────────────────────────────────────────────────────────
const scaleMeshes = (ms, k) => (k === 1 ? ms : ms.map(m => { const P = new Float32Array(m.positions); for (let i = 0; i < P.length; i++) P[i] *= k; return { ...m, positions: P }; }));
const clipU = (vis, lo, hi, dx = 0) => {
    const out = [];
    for (const [u0, v0, u1, v1] of vis) {
        let a = 0, b = 1; const du = u1 - u0;
        if (Math.abs(du) < 1e-9) { if (u0 < lo || u0 > hi) continue; } else {
            const t0 = (lo - u0) / du, t1 = (hi - u0) / du;
            a = Math.max(a, Math.min(t0, t1)); b = Math.min(b, Math.max(t0, t1)); if (a > b) continue;
        }
        out.push([u0 + du * a + dx, v0 + (v1 - v0) * a, u0 + du * b + dx, v0 + (v1 - v0) * b]);
    }
    return out;
};
const clipV = (vis, lo, hi) => vis.map(([u0, v0, u1, v1]) => [v0, u0, v1, u1]).map(q => clipU([q], lo, hi)[0]).filter(Boolean).map(([v0, u0, v1, u1]) => [u0, v0, u1, v1]);
// The fascia's modelled end is mitred (it serves the miter too); cut it at zCut and move the cut face to zTo.
function straightEnd(meshes, zCut, zTo) {
    return meshes.map(m => {
        const P = m.positions, I = m.indices || Uint32Array.from({ length: P.length / 3 }, (_, i) => i);
        const out = []; const v = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
        for (let t = 0; t < I.length; t += 3) {
            const poly = [v(I[t]), v(I[t + 1]), v(I[t + 2])], res = [];
            for (let k = 0; k < 3; k++) {
                const a = poly[k], b = poly[(k + 1) % 3], ina = a[2] <= zCut, inb = b[2] <= zCut;
                if (ina) res.push(a);
                if (ina !== inb) { const f = (zCut - a[2]) / (b[2] - a[2]); res.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, zCut]); }
            }
            for (let k = 1; k + 1 < res.length; k++) out.push(...res[0], ...res[k], ...res[k + 1]);
        }
        const pos = new Float32Array(out);
        for (let i = 2; i < pos.length; i += 3) if (pos[i] >= zCut - 1e-4) pos[i] = zTo;
        return { ...m, positions: pos, indices: null };
    });
}
// Split a welded mesh by triangle-centroid height: [above, below].
function splitByY(meshes, yCut) {
    const up = [], dn = [];
    for (const m of meshes) {
        const P = m.positions, I = m.indices || Uint32Array.from({ length: P.length / 3 }, (_, i) => i);
        const a = [], b = [];
        for (let t = 0; t < I.length; t += 3) {
            const tri = [I[t], I[t + 1], I[t + 2]].flatMap(i => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
            ((tri[1] + tri[4] + tri[7]) / 3 > yCut ? a : b).push(...tri);
        }
        if (a.length) up.push({ ...m, positions: new Float32Array(a), indices: null });
        if (b.length) dn.push({ ...m, positions: new Float32Array(b), indices: null });
    }
    return [up, dn];
}
// The bottom of a ring is the bottom of its BODY, never the eyelet (Stuart 2026-09-29): the lowest horizontal
// slice at least half as wide as the ring — below it only the narrow eyelet hangs.
function ringBodyBottom(ms) {
    const pts = []; for (const m of ms) for (let i = 0; i < m.positions.length; i += 3) pts.push([m.positions[i], m.positions[i + 1]]);
    if (!pts.length) return 0;
    const lo = Math.min(...pts.map(p => p[1])), hi = Math.max(...pts.map(p => p[1])), step = 0.02, n = Math.ceil((hi - lo) / step) + 1;
    const mn = new Array(n).fill(Infinity), mx = new Array(n).fill(-Infinity);
    for (const [x, y] of pts) { const k = Math.floor((y - lo) / step); mn[k] = Math.min(mn[k], x); mx[k] = Math.max(mx[k], x); }
    const span = mn.map((v, k) => mx[k] - v), full = Math.max(...span.filter(Number.isFinite));
    for (let k = 0; k < n; k++) if (span[k] >= full * 0.5) return lo + k * step;
    return lo;
}
// A bracket's plate is the slice of the bracket at the wall — plate and arm are one welded mesh.
function wallSlice(ms, wallX, depth = 0.12) {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const m of ms) { const P = m.positions; for (let i = 0; i < P.length; i += 3) if (P[i] - wallX < depth) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], P[i + a]); mx[a] = Math.max(mx[a], P[i + a]); } }
    return { min: mn, max: mx };
}
// The ceiling bracket's FIXED block: from the ceiling down while each slice stays inside the top plate's
// footprint; the first slice that reaches beyond it is the arm — everything from there down is the lower plate
// that drops for leveling.
function fixedBlockSplit(ms) {
    const pts = []; for (const m of ms) for (let i = 0; i < m.positions.length; i += 3) pts.push([m.positions[i], m.positions[i + 1]]);
    const top = Math.max(...pts.map(p => p[1]));
    const band = pts.filter(p => top - p[1] < 0.03).map(p => p[0]);
    const x0 = Math.min(...band) - 0.02, x1 = Math.max(...band) + 0.02;
    const ys = [...new Set(pts.map(p => Math.round(p[1] * 50) / 50))].sort((a, b) => b - a);
    for (const y of ys) {
        const xs = pts.filter(p => Math.round(p[1] * 50) / 50 === y).map(p => p[0]);
        if (Math.min(...xs) < x0 || Math.max(...xs) > x1) return y + 0.01;
    }
    return null;
}

// ── svg ───────────────────────────────────────────────────────────────────────────────────────
const segPath = (vis, ox, oy, s) => vis.map(([u0, v0, u1, v1]) => `M${f3(ox + u0 * s)} ${f3(oy - v0 * s)}L${f3(ox + u1 * s)} ${f3(oy - v1 * s)}`).join('');
function hDim(x0, x1, y, text, ext0, ext1) {
    const a = 0.06;
    return `<g class="dim"><line x1="${f3(x0)}" y1="${f3(ext0)}" x2="${f3(x0)}" y2="${f3(y + 0.05 * Math.sign(y - ext0 || 1))}"/><line x1="${f3(x1)}" y1="${f3(ext1)}" x2="${f3(x1)}" y2="${f3(y + 0.05 * Math.sign(y - ext1 || 1))}"/>`
        + `<line x1="${f3(x0)}" y1="${f3(y)}" x2="${f3(x1)}" y2="${f3(y)}"/>`
        + `<path d="M${f3(x0)} ${f3(y)}l${a} ${-a / 2.5}v${a / 1.25}z M${f3(x1)} ${f3(y)}l${-a} ${-a / 2.5}v${a / 1.25}z" class="ar"/>`
        + `<text x="${f3((x0 + x1) / 2)}" y="${f3(y - 0.05)}" text-anchor="middle">${text}</text></g>`;
}
function vDim(x, y0, y1, text, ext0, ext1, side = 1) {
    const a = 0.06, sg = Math.sign(y1 - y0) || 1;
    return `<g class="dim"><line x1="${f3(ext0)}" y1="${f3(y0)}" x2="${f3(x + 0.05 * side)}" y2="${f3(y0)}"/><line x1="${f3(ext1)}" y1="${f3(y1)}" x2="${f3(x + 0.05 * side)}" y2="${f3(y1)}"/>`
        + `<line x1="${f3(x)}" y1="${f3(y0)}" x2="${f3(x)}" y2="${f3(y1)}"/>`
        + `<path d="M${f3(x)} ${f3(y0)}l${-a / 2.5} ${a * sg}h${a / 1.25}z M${f3(x)} ${f3(y1)}l${-a / 2.5} ${-a * sg}h${a / 1.25}z" class="ar"/>`
        + `<text x="${f3(x + 0.08 * side)}" y="${f3((y0 + y1) / 2 + 0.04)}" text-anchor="${side > 0 ? 'start' : 'end'}">${text}</text></g>`;
}
const wallHatch = (x, y0, y1) => { let g = `<line class="wall" x1="${f3(x)}" y1="${f3(y0)}" x2="${f3(x)}" y2="${f3(y1)}"/>`; for (let y = y0; y < y1; y += 0.12) g += `<line class="hatch" x1="${f3(x)}" y1="${f3(y)}" x2="${f3(x - 0.1)}" y2="${f3(y + 0.1)}"/>`; return g; };
const hHatch = (x0, x1, y, down = false) => { let g = `<line class="wall" x1="${f3(x0)}" y1="${f3(y)}" x2="${f3(x1)}" y2="${f3(y)}"/>`; for (let x = x0; x < x1; x += 0.12) g += `<line class="hatch" x1="${f3(x)}" y1="${f3(y)}" x2="${f3(x + 0.1)}" y2="${f3(y + (down ? 0.1 : -0.1))}"/>`; return g; };
const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const text = (cls, x, y, t, anchor) => `<text class="${cls}" x="${f3(x)}" y="${f3(y)}"${anchor ? ` text-anchor="${anchor}"` : ''}>${esc(t)}</text>`;
const STYLE = `<style>.ln{fill:none;stroke:#111;stroke-width:.009;stroke-linecap:round}.dim line{stroke:#555;stroke-width:.006}.ar{fill:#555}.dim text,.dimt{font:.1px Helvetica,Arial;fill:#333}`
    + `.cl{stroke:#888;stroke-width:.005;stroke-dasharray:.08 .03 .02 .03}.wall{stroke:#111;stroke-width:.014}.hatch{stroke:#777;stroke-width:.005}.ph{fill:none;stroke:#777;stroke-width:.006;stroke-dasharray:.05 .03}`
    + `.t1{font:bold .16px Helvetica,Arial;fill:#111}.t2{font:.115px Helvetica,Arial;fill:#444}.t3{font:.09px Helvetica,Arial;fill:#666;letter-spacing:.01px}.t4{font:.085px Helvetica,Arial;fill:#555}.sep{stroke:#ccc;stroke-width:.006}</style>`;

const ROLE_NAME = { FASCIA: 'Fascia', TRACK: 'Track', CARRIER: 'Carrier', FCLIP: 'F-clip', TRV_END: 'End', BRACKET: 'Bracket', RETURN: 'Return' };
const trackShortPerSide = (drive) => (Number(TRAVERSE_DEDUCTIONS.TRACK?.[U(drive) || 'MANUAL']) || 0) / 2;
const setupText = (a) => [U(a.setup) === 'DOUBLE' ? 'double' : 'single', U(a.frontLayer) === 'FASCIA' ? 'rod front (rings)' : U(a.frontLayer) === 'TRACK' ? 'track front' : '', U(a.drive) === 'MOTORIZED' ? 'motorized' : 'manual']
    .filter(Boolean).join(' · ');
const motorNote = () => {
    const t = TRAVERSE_DEDUCTIONS.TRACK || {}, c = TRAVERSE_DEDUCTIONS.FCLIP || {};
    return `Motorized: the drive ends replace the end plugs · track ${ins(t.MOTORIZED / 2)} short of the fascia each side (${ins(t.MOTORIZED)} overall; manual ${ins(t.MANUAL / 2)} / ${ins(t.MANUAL)}) · F-clip ${ins(c.MOTORIZED)} overall (manual ${ins(c.MANUAL)}) · see the track-ends sheet`;
};

function makeGeo(scene, toInches) {
    const meshes = (nodes) => scaleMeshes(extractWorldMeshes(scene, nodes || []), toInches);
    const groupMeshes = (d, pred) => meshes(Object.entries(d.groups || {}).filter(([k]) => pred(k)).flatMap(([, g]) => g.nodes));
    const partsLine = (d, nameOf, skip = []) => {
        const seen = new Set(), out = [];
        for (const g of Object.values(d.groups || {})) {
            if (skip.includes(g.role)) continue;
            const names = [...new Set(g.choices.map(nameOf))].join('/');
            const s = `${ROLE_NAME[g.role] || g.role}${g.tier === 'BACK' ? ' (rear)' : ''} ${names}`;
            if (!seen.has(s)) { seen.add(s); out.push(s); }
        }
        (d.rings || []).forEach(r => { const s = `Ring ${nameOf(r.choice)}`; if (!seen.has(s)) { seen.add(s); out.push(s); } });
        return out.join('  ·  ');
    };
    return { meshes, groupMeshes, partsLine };
}
// A model laid out differently would be drawn wrong, silently — so it is refused instead.
function checkLayout(geo, d) {
    const tm = geo.groupMeshes(d, k => k.startsWith('TRACK'));
    const bm = geo.groupMeshes(d, k => k.startsWith('BRACKET'));
    if (!tm.length || !bm.length) return;
    const t = groupBbox(tm), b = groupBbox(bm);
    const railZ = t.size[2] >= t.size[0] && t.size[2] >= t.size[1];
    if (!railZ || !(b.min[0] < t.center[0])) {
        throw new Error('This traverse model is not laid out with the rail along Z and the wall at −X, so its sheet cannot place the parts — nothing drawn rather than something wrong.');
    }
}

// ═════ the wall bracket: END VIEW + FRONT ═════
function bracketParts(geo, d, nameOf) {
    // the rear tier sits where its tag says (placement from the tag, never where the merged model parked it)
    const centreOnly = (ms) => ms.filter(m => Math.abs(groupBbox([m]).center[2]) < 3);
    const brAll = centreOnly(geo.groupMeshes(d, k => k.startsWith('BRACKET')));
    const wall0 = groupBbox(brAll).min[0];
    let backShift = 0;
    if (d.projTiers?.BACK && d.groups['TRACK/BACK']) {
        const tb = groupBbox(geo.meshes(d.groups['TRACK/BACK'].nodes));
        backShift = (wall0 + Number(d.projTiers.BACK)) - tb.center[0];
    }
    const mesh = (keyPred) => Object.entries(d.groups).filter(([k]) => keyPred(k))
        .flatMap(([k, g]) => { const ms = geo.meshes(g.nodes); return backShift && /\/BACK$/.test(k) ? translateMeshes(ms, [backShift, 0, 0]) : ms; });
    const bb = (pred) => { const ms = mesh(pred); return ms.length ? groupBbox(ms) : null; };
    const ringsDrawn = (d.rings || []).map((r, i) => {
        const ms0 = geo.meshes(r.nodes);
        if (!ms0.length) return null;
        const rb = groupBbox(ms0), zAt = -(1.45 + i * 1.8);
        const ms = translateMeshes(ms0, [0, 0, zAt - rb.center[2]]);
        return { code: nameOf(r.choice), ms, b: groupBbox(ms), bodyBottom: ringBodyBottom(ms0) };
    }).filter(Boolean);
    return { mesh, bb, brAll, wall0, backShift, ringsDrawn };
}
function bracketUnit(geo, d, x0, y0, s, fxAt, nameOf, heading, kitText = '') {
    const { mesh, bb, brAll, wall0, ringsDrawn } = bracketParts(geo, d, nameOf);
    const prof = renderHiddenLine(mesh(k => !k.startsWith('TRV_END')), VIEW.end, 1400).vis;
    const rodFront = d.rodFront;
    const front = renderHiddenLine([...mesh(k => rodFront || !k.startsWith('FASCIA')), ...ringsDrawn.flatMap(r => r.ms)], VIEW.front, 1800).vis;
    const phantom = rodFront || !d.groups['FASCIA/FRONT'] ? [] : renderHiddenLine(mesh(k => k === 'FASCIA/FRONT'), VIEW.front, 900).vis;
    const bracket = groupBbox(brAll), wallX = wall0;
    const fascia = bb(k => k === 'FASCIA/FRONT');
    const tracks = ['TRACK/FRONT', 'TRACK/BACK'].filter(k => d.groups[k]).map(k => ({ k, b: bb(x => x === k) }));
    const carriers = Object.keys(d.groups).filter(k => k.startsWith('CARRIER')).map(k => ({ k, b: bb(x => x === k) }));
    const MID = [-1.6, rodFront ? 1.4 + 1.8 * ringsDrawn.length : 1.6];
    const frontVis = clipU(front, MID[0], MID[1]), phantomVis = clipU(phantom, MID[0], MID[1]);
    const plate = wallSlice(brAll, wallX);
    const vMin = Math.min(bracket.min[1], ...carriers.map(c => c.b.min[1]), ...ringsDrawn.map(r => r.b.min[1]));
    const vMax = Math.max(bracket.max[1], fascia?.max[1] ?? 0);
    const nDims = tracks.length + (fascia ? 1 : 0);
    const oy = y0 + 0.50 + nDims * 0.2 + 0.12 + vMax * s;
    const ox = x0 + 0.62 - wallX * s;
    let g = text('t1', x0, y0 + 0.16, heading) + text('t2', x0, y0 + 0.34, [subtitleOf(d), kitText].filter(Boolean).join(' · '));
    const wx = ox + wallX * s, wy0 = oy - (vMax + 0.3) * s, wy1 = oy - (vMin - 0.3) * s;
    g += wallHatch(wx, wy0, wy1);
    g += `<path class="ln" d="${segPath(prof, ox, oy, s)}"/>`;
    g += vDim(wx - 0.24, oy - plate.max[1] * s, oy - plate.min[1] * s, `${ins(plate.max[1] - plate.min[1])} plate`, wx, wx, -1);
    let dy = oy - vMax * s - 0.14;
    for (const t of [...tracks].sort((a, b) => a.b.min[0] - b.b.min[0])) {
        const cx = t.b.center[0];
        g += hDim(wx, ox + cx * s, dy, `${ins(cx - wallX)} to ${t.k.endsWith('BACK') ? 'rear' : 'front'} track ℄`, wy0, oy - t.b.max[1] * s);
        g += `<line class="cl" x1="${f3(ox + cx * s)}" y1="${f3(dy)}" x2="${f3(ox + cx * s)}" y2="${f3(oy - (t.b.min[1] - 0.25) * s)}"/>`;
        dy -= 0.2;
    }
    if (fascia && rodFront) {
        const rc = fascia.center[0];
        g += hDim(wx, ox + rc * s, dy, `${ins(rc - wallX)} to rod ℄`, wy0, oy - fascia.max[1] * s);
        g += `<line class="cl" x1="${f3(ox + rc * s)}" y1="${f3(dy)}" x2="${f3(ox + rc * s)}" y2="${f3(oy - (fascia.min[1] - 0.25) * s)}"/>`;
    } else if (fascia) g += hDim(wx, ox + fascia.max[0] * s, dy, `${ins(fascia.max[0] - wallX)} overall to fascia face`, wy0, oy - fascia.max[1] * s);
    if (fascia) g += vDim(ox + fascia.max[0] * s + 0.25, oy - fascia.max[1] * s, oy - fascia.min[1] * s, `${ins(fascia.max[1] - fascia.min[1])} face`, ox + fascia.max[0] * s, ox + fascia.max[0] * s);
    for (const c of carriers) {
        const tier = c.k.split('/')[1] || '';
        const t = tracks.find(x => (x.k.split('/')[1] || '') === tier) || tracks[0];
        if (!t) continue;
        g += vDim(ox + c.b.min[0] * s - 0.12, oy - t.b.min[1] * s, oy - c.b.min[1] * s, `${ins(t.b.min[1] - c.b.min[1])}`, ox + t.b.min[0] * s, ox + c.b.min[0] * s, -1);
    }
    // FRONT at the centre bracket
    const fox = fxAt - MID[0] * s;
    g += `<path class="ln" d="${segPath(frontVis, fox, oy, s)}"/>`;
    if (phantomVis.length) g += `<path class="ph" d="${segPath(phantomVis, fox, oy, s)}"/>`;
    const pu0 = fox + (-plate.max[2]) * s, pu1 = fox + (-plate.min[2]) * s, pTop = oy - plate.max[1] * s, pBot = oy - plate.min[1] * s;
    g += hDim(pu0, pu1, pBot + 0.2, `${ins(plate.max[2] - plate.min[2])} plate`, pBot, pBot);
    if (fascia) {
        const cx = fox + MID[0] * s - 0.12, fTop = oy - fascia.max[1] * s, fBot = oy - fascia.min[1] * s, word = rodFront ? 'rod' : 'fascia';
        g += vDim(cx, pTop, fTop, `${ins(plate.max[1] - fascia.max[1])} plate top → ${word} top`, pu0, fox + MID[0] * s, -1);
        g += vDim(cx, fBot, pBot, `${ins(fascia.min[1] - plate.min[1])} ${word} bottom → plate bottom`, fox + MID[0] * s, pu0, -1);
    }
    for (const r of ringsDrawn) {
        const uR = -r.b.min[2], uC = -r.b.center[2], xa = fox + uR * s + 0.07, xb = xa + 0.13;
        const yBody = oy - r.bodyBottom * s, yEye = oy - r.b.min[1] * s, yRodTop = fascia ? oy - fascia.max[1] * s : pTop;
        g += `<g class="dim"><line x1="${f3(pu1)}" y1="${f3(pTop)}" x2="${f3(xa + 0.04)}" y2="${f3(pTop)}"/><line x1="${f3(fox + uR * s)}" y1="${f3(yBody)}" x2="${f3(xa + 0.04)}" y2="${f3(yBody)}"/><line x1="${f3(xa)}" y1="${f3(pTop)}" x2="${f3(xa)}" y2="${f3(yBody)}"/>`
            + `<path d="M${f3(xa)} ${f3(pTop)}l-.024 .06h.048z M${f3(xa)} ${f3(yBody)}l-.024 -.06h.048z" class="ar"/></g>`
            + `<g class="dim"><line x1="${f3(fox + uR * s)}" y1="${f3(yEye)}" x2="${f3(xb + 0.04)}" y2="${f3(yEye)}"/><line x1="${f3(xb)}" y1="${f3(yRodTop)}" x2="${f3(xb)}" y2="${f3(yEye)}"/>`
            + `<path d="M${f3(xb)} ${f3(yRodTop)}l-.024 .06h.048z M${f3(xb)} ${f3(yEye)}l-.024 -.06h.048z" class="ar"/></g>`;
        g += text('dimt', xb + 0.06, (pTop + yBody) / 2, ins(plate.max[1] - r.bodyBottom));
        g += text('dimt', xb + 0.06, yEye + 0.02, `${ins((fascia ? fascia.max[1] : plate.max[1]) - r.b.min[1])} drop`);
        g += text('t4', fox + uC * s, yEye + 0.14, r.code, 'middle');
    }
    const capY = oy - (vMin - 0.1) * s + 0.25;
    if (ringsDrawn.length) g += text('t4', fxAt, capY + 0.15, 'per ring: plate top → ring bottom (not the eyelet) · drop = rod top → eyelet');
    g += text('t3', fxAt, capY, `FRONT${rodFront ? ' · rings beside the bracket' : ' · fascia dashed'}`);
    g += text('t3', x0 + 0.35, capY, 'END VIEW — wall at left');
    g += text('t4', x0, y0 + UH - 0.24, motorNote());
    g += text('t4', x0, y0 + UH - 0.08, geo.partsLine(d, nameOf));
    return g;
}
const bracketNeed = (geo, d, nameOf) => {
    const { bb, wall0 } = bracketParts(geo, d, nameOf);
    const fascia = bb(k => k === 'FASCIA/FRONT');
    return (Math.max(fascia?.max[0] ?? 0, 0) - wall0) + 1.1;
};
const subtitleOf = (d) => {
    const a = d.answers || {};
    const tags = d.projTiers ? `tag FRONT ${d.projTiers.FRONT ?? '—'} · BACK ${d.projTiers.BACK ?? '—'} (rear placed by the tag)` : (a.proj != null ? `proj ${a.proj}"` : '');
    return [setupText(a), tags].filter(Boolean).join(' · ');
};

// ═════ the ceiling bracket: END VIEW (flush with the ceiling, drops up to 3/8") + the plate from above ═════
const CEILING_DROP = 0.375;   // Stuart 2026-09-29: flush with the ceiling is the top; it "can drop up to 3/8" for leveling"
function ceilingUnit(geo, d, x0, y0, s, nameOf, heading, kitText = '') {
    const cbM = geo.groupMeshes(d, k => k.startsWith('BRACKET')).filter(m => Math.abs(groupBbox([m]).center[2]) < 3);
    const cb = groupBbox(cbM), ceilY = cb.max[1];
    const ringMs = (d.rings || []).flatMap(r => geo.meshes(r.nodes));
    const all = geo.groupMeshes(d, k => !k.startsWith('TRV_END') && !k.startsWith('BRACKET'));
    const endV = renderHiddenLine([...cbM, ...all, ...ringMs], VIEW.end, 1400).vis;
    const split = fixedBlockSplit(cbM);
    const lowerM = split != null ? splitByY(cbM, split)[1] : [];
    const ghost = lowerM.length ? renderHiddenLine(translateMeshes(lowerM, [0, -CEILING_DROP, 0]), VIEW.end, 900).vis : [];
    const face = d.groups['FASCIA/FRONT'] ? groupBbox(geo.meshes(d.groups['FASCIA/FRONT'].nodes)) : null;
    const tracks = ['TRACK/FRONT', 'TRACK/BACK'].filter(k => d.groups[k]).map(k => ({ k, b: groupBbox(geo.meshes(d.groups[k].nodes)) }));
    const carr = Object.keys(d.groups).filter(k => k.startsWith('CARRIER')).map(k => groupBbox(geo.meshes(d.groups[k].nodes)));
    const ox = x0 + 1.0 - cb.min[0] * s, oy = y0 + 0.62 + 0.55 + ceilY * s;
    const word = d.rodFront ? 'rod' : 'fascia';
    let g = text('t1', x0, y0 + 0.16, heading) + text('t2', x0, y0 + 0.34, [setupText(d.answers), kitText].filter(Boolean).join(' · '));
    g += hHatch(ox + (cb.min[0] - 0.4) * s, ox + ((face?.max[0] ?? 0) + 0.5) * s, oy - ceilY * s);
    g += `<path class="ln" d="${segPath(endV, ox, oy, s)}"/>`;
    if (ghost.length) {
        g += `<path class="ph" d="${segPath(ghost, ox, oy, s)}"/>`;
        const yN = oy - groupBbox(lowerM).max[1] * s;
        g += vDim(ox + cb.min[0] * s - 0.2, yN, yN + CEILING_DROP * s, `${ins(CEILING_DROP)} drop`, ox + cb.min[0] * s, ox + cb.min[0] * s, -1);
    }
    let dy = oy - ceilY * s - 0.2;
    for (const t of tracks) {
        g += hDim(ox + cb.min[0] * s, ox + t.b.center[0] * s, dy, `${ins(t.b.center[0] - cb.min[0])} to ${t.k.endsWith('BACK') ? 'rear' : 'front'} track ℄`, oy - ceilY * s, oy - t.b.max[1] * s);
        dy -= 0.2;
    }
    if (face) g += hDim(ox + cb.min[0] * s, ox + face.max[0] * s, dy, `${ins(face.max[0] - cb.min[0])} to ${word} face`, oy - ceilY * s, oy - face.max[1] * s);
    const vx = ox + (face?.max[0] ?? 0) * s + 0.25;
    if (face) {
        g += vDim(vx, oy - ceilY * s, oy - face.min[1] * s, `${ins(ceilY - face.min[1])} ceiling → ${word} bottom`, ox + face.max[0] * s, ox + face.max[0] * s);
        g += text('dimt', vx + 0.08, (oy - ceilY * s + oy - face.min[1] * s) / 2 + 0.18, `can drop up to ${ins(CEILING_DROP)} for leveling`);
    }
    (d.rings || []).forEach((r, i) => {
        const rbb = ringBodyBottom(geo.meshes(r.nodes));
        g += text('dimt', vx + 0.08, oy - (face?.min[1] ?? 0) * s + 0.1 + i * 0.13, `${ins(ceilY - rbb)} ceiling → bottom of ring ${nameOf(r.choice)} (not the eyelet)`);
    });
    if (carr.length) {
        const cm = Math.min(...carr.map(c => c.min[1]));
        g += vDim(vx + 1.85, oy - ceilY * s, oy - cm * s, `${ins(ceilY - cm)} ceiling → carrier eyelet`, ox + (face?.max[0] ?? 0) * s, ox + Math.max(...carr.map(c => c.max[0])) * s);
    }
    g += text('t3', ox + cb.min[0] * s, oy - (Math.min(...carr.map(c => c.min[1]), face?.min[1] ?? 0) - 0.2) * s + 0.2, 'END VIEW — ceiling at the top · dashed: the lower plate dropped 3/8" for leveling');
    // the ceiling plate alone, from above
    const plate = (() => { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (const m of cbM) { const P = m.positions; for (let i = 0; i < P.length; i += 3) if (ceilY - P[i + 1] < 0.1) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], P[i + a]); mx[a] = Math.max(mx[a], P[i + a]); } } return { min: mn, max: mx }; })();
    const planV = renderHiddenLine(cbM, VIEW.plan, 1000).vis;
    const px0 = x0 + UW * 0.79, poy = y0 + 0.85 + (-cb.min[0]) * s, pox = px0 - (-cb.max[2]) * s;
    g += `<path class="ln" d="${segPath(planV, pox, poy, s)}"/>`;
    g += hDim(pox + (-plate.max[2]) * s, pox + (-plate.min[2]) * s, poy - (-plate.min[0]) * s - 0.18, `${ins(plate.max[2] - plate.min[2])} wide`, poy - (-plate.min[0]) * s, poy - (-plate.min[0]) * s);
    g += vDim(pox + (-plate.min[2]) * s + 0.18, poy - (-plate.min[0]) * s, poy - (-plate.max[0]) * s, `${ins(plate.max[0] - plate.min[0])} plate`, pox + (-plate.min[2]) * s, pox + (-plate.min[2]) * s);
    g += text('t3', px0 - 0.3, poy - (-cb.max[0]) * s + 0.3, 'CEILING PLATE — from above, wall side up');
    g += text('t4', x0, y0 + UH - 0.1, geo.partsLine(d, nameOf));
    return g;
}

// ═════ the end arm / the miter: PLAN (wall at left, the left end at the bottom) + SIDE ═════
function endArmUnit(geo, d, x0, y0, s, nameOf, heading) {
    const leftOf = (ms) => ms.filter(m => groupBbox([m]).max[2] > 0);
    const endM = geo.groupMeshes(d, k => k.startsWith('RETURN')).filter(m => groupBbox([m]).center[2] > 0);
    if (!endM.length) throw new Error(`${heading}: the return has no geometry at the left end`);
    const brM = geo.groupMeshes(d, k => k.startsWith('BRACKET'));
    const wallX = groupBbox(brM).min[0];
    const eb = groupBbox(endM), legInner = eb.min[2];
    const face = d.groups['FASCIA/FRONT'] ? groupBbox(geo.meshes(d.groups['FASCIA/FRONT'].nodes)) : null;
    const short = trackShortPerSide(d.drive);
    const trackMs0 = leftOf(geo.groupMeshes(d, k => k.startsWith('TRACK')));
    const dz = trackMs0.length ? (legInner - short) - groupBbox(trackMs0).max[2] : 0;
    const placed = Object.entries(d.groups).flatMap(([k, g]) => {
        let ms = leftOf(geo.meshes(g.nodes));
        if (k.startsWith('FASCIA') && !d.isMiter) ms = straightEnd(ms, legInner - 0.3, legInner);   // an end arm butts a straight-cut fascia
        if (k.startsWith('TRACK') || k.startsWith('TRV_END')) ms = translateMeshes(ms, [0, 0, dz]);
        return ms;
    });
    const WZ = [-(eb.max[2] + 0.7), -(eb.max[2] - 4.1)];
    const plan = clipV(renderHiddenLine(placed, VIEW.planL, 1600).vis, WZ[0], WZ[1]);
    const side = renderHiddenLine(endM, VIEW.end, 1000).vis;
    const topY = y0 + 0.75, botY = topY + (WZ[1] - WZ[0]) * s;
    const X = (x) => x0 + 0.6 + (x - wallX) * s, Y = (vz) => topY + (WZ[1] - vz) * s;
    let g = text('t1', x0, y0 + 0.16, heading) + text('t2', x0, y0 + 0.34, 'left end shown, right is its mirror');
    g += wallHatch(X(wallX), topY - 0.05, botY + 0.1);
    g += `<path class="ln" d="${plan.map(([u0, v0, u1, v1]) => `M${f3(X(u0))} ${f3(Y(v0))}L${f3(X(u1))} ${f3(Y(v1))}`).join('')}"/>`;
    const faceX = face?.max[0] ?? eb.max[0];
    g += hDim(X(wallX), X(faceX), topY - 0.12, `${ins(faceX - wallX)} wall → ${d.rodFront ? 'rod' : 'fascia'} face`, topY, topY);
    g += vDim(X(faceX) + 0.2, Y(-eb.min[2]), Y(-eb.max[2]), `${ins(eb.max[2] - eb.min[2])} leg`, X(faceX), X(faceX));
    if (trackMs0.length) {
        const tb = groupBbox(translateMeshes(trackMs0, [0, 0, dz]));
        g += vDim(X(tb.min[0]) - 0.1, Y(-(legInner - short)), Y(-legInner), `${ins(short)} track short`, X(tb.min[0]), X(tb.min[0]), -1);
    }
    g += text('t3', X(wallX), botY + 0.28, `PLAN — left end from above · wall at left · ${d.isMiter ? 'fascia mitred into the return (fee)' : 'fascia cut straight, the end arm butts it'}`);
    const sb = groupBbox(endM);
    const sx0 = x0 + UW * 0.55, sox = sx0 - wallX * s, soy = topY + 0.2 + sb.max[1] * s;
    g += wallHatch(sox + wallX * s, soy - (sb.max[1] + 0.25) * s, soy - (sb.min[1] - 0.25) * s);
    g += `<path class="ln" d="${segPath(side, sox, soy, s)}"/>`;
    g += vDim(sox + sb.max[0] * s + 0.2, soy - sb.max[1] * s, soy - sb.min[1] * s, `${ins(sb.max[1] - sb.min[1])} high`, sox + sb.max[0] * s, sox + sb.max[0] * s);
    g += hDim(sox + wallX * s, sox + sb.max[0] * s, soy - sb.max[1] * s - 0.15, `${ins(sb.max[0] - wallX)} deep`, soy - sb.max[1] * s, soy - sb.max[1] * s);
    g += text('t3', sox + wallX * s, soy - (sb.min[1] - 0.25) * s + 0.2, 'SIDE — the return leg, from the end');
    g += text('t4', x0, y0 + UH - 0.12, `${d.isMiter ? 'Miter: a fee — the fascia is cut and mitred back to the wall' : 'End arm: a part — it closes the end back to the wall'} · shown with ${geo.partsLine(d, nameOf, ['RETURN'])}`);
    return g;
}

// ═════ the track ends, from below ═════
function endsUnit(geo, d, x0, y0, s, nameOf, heading) {
    const keys = Object.keys(d.groups).filter(k => !k.startsWith('BRACKET'));
    const faceMs = geo.groupMeshes(d, k => k === 'FASCIA/FRONT');
    const fEnd = faceMs.length ? groupBbox(faceMs).max[2] : 0;
    const short = trackShortPerSide(d.drive);
    const trackMs = geo.groupMeshes(d, k => k.startsWith('TRACK'));
    const dz = trackMs.length ? (fEnd - short) - groupBbox(trackMs).max[2] : 0;
    const placed = keys.flatMap(k => {
        let ms = geo.meshes(d.groups[k].nodes);
        if (k.startsWith('FASCIA')) ms = straightEnd(ms, fEnd - 0.8, fEnd);   // a plain end: the fascia cut square
        if (k.startsWith('TRACK') || k.startsWith('TRV_END')) ms = translateMeshes(ms, [0, 0, dz]);
        return ms;
    });
    const EW = [-(fEnd + 0.4), -(fEnd - 5.8)];
    const vis = clipU(renderHiddenLine(placed, VIEW.below, 1800).vis, EW[0], EW[1]);
    const vb = groupBbox(placed);
    const ox = x0 + 0.4 - EW[0] * s, oy = y0 + 0.85 + vb.max[0] * s;
    let g = text('t1', x0, y0 + 0.16, heading) + text('t2', x0, y0 + 0.34, 'view from below, looking up · wall at the bottom · left end shown, right end is its mirror');
    g += `<path class="ln" d="${segPath(vis, ox, oy, s)}"/>`;
    const endKey = keys.find(k => k.startsWith('TRV_END'));
    if (endKey) {
        const em = translateMeshes(geo.meshes(d.groups[endKey].nodes).filter(m => groupBbox([m]).center[2] > 0), [0, 0, dz]);
        if (em.length) {
            const eb = groupBbox(em), lx = ox + (-eb.max[2]) * s, rx = ox + (-eb.min[2]) * s, by = oy - eb.min[0] * s;
            const name = [...new Set(d.groups[endKey].choices.map(nameOf))].join('/');
            g += hDim(lx, rx, by + 0.22, `${ins(eb.max[2] - eb.min[2])} ${U(d.drive) === 'MOTORIZED' ? 'drive' : 'plug'}`, by, by);
            g += text('t2', lx, by + 0.48, name);
        }
    }
    const lx0 = ox + EW[1] * s + 0.3, ax = ox + (EW[1] - 0.25) * s;
    for (const [k, word] of [['FASCIA/FRONT', 'fascia'], ['TRACK/FRONT', 'track'], ['FCLIP', 'F-clip']]) {
        if (!d.groups[k]) continue;
        const b = groupBbox(geo.meshes(d.groups[k].nodes));
        const ly = oy - b.center[0] * s;
        g += `<line x1="${f3(ax)}" y1="${f3(ly)}" x2="${f3(lx0)}" y2="${f3(ly)}" stroke="#777" stroke-width=".005"/>` + text('t2', lx0 + 0.05, ly + 0.04, `${word} ${[...new Set(d.groups[k].choices.map(nameOf))].join('/')}`);
    }
    // NO "track short of the fascia" dimension here, manual or motorized (Stuart 2026-10-01: "remove that measurement from
    // both … it is not important on the spec sheets and i still find it could be confusing" — the motorized track is cut
    // 1" short but the Somfy drive fills it, so the number read as a gap that is not there). The track is still DRAWN at
    // its cut position above; only the dimension is gone.
    return g;
}

// A bracket or ceiling drawing that belongs to a kit is titled by the kit in the Fabricut edition (k = kitOf(d));
// every part inside keeps its own id on the drawing (Stuart 2026-09-30: "drop down and title").
const HEADINGS = {
    BRACKET: (d, n, k) => `${U(d.answers.setup) === 'DOUBLE' ? (U(d.answers.frontLayer) === 'FASCIA' ? 'Double — rod front (rings) · rear track' : 'Double traverse — track front') : 'Single traverse'} · ${k ? k.name : n(d.bracket)}`,
    CEILING: (d, n, k) => `Ceiling mount — ${U(d.answers.setup) === 'DOUBLE' ? (U(d.answers.frontLayer) === 'FASCIA' ? 'double, rod front (rings) · rear track' : 'double, track front') : 'single traverse'} · ${k ? k.name : n(d.bracket)}`,
    RETURN: (d, n) => `Traverse ${d.isMiter ? 'miter' : 'end arm'} — ${U(d.answers.setup) === 'DOUBLE' ? 'double' : `single ${fracText(Number(d.answers.proj || 0))}`} · ${n(d.end)}`,
    ENDS: (d) => `Track end — ${U(d.drive) === 'MOTORIZED' ? 'Motorized' : 'Manual'}`,
};

/**
 * One traverse sheet → { svg, viewMaps: [], paper: 'letter' }.
 * @param {object} p
 * @param {object} p.page      a TRAVERSE / TRAVERSE_ENDS page from specSheetTraverse
 * @param {object} p.scene     the loaded THREE scene
 * @param {Function} p.nameOf  choice → the code to print (the modal's edition naming)
 * @param {string} p.title     the sheet title (assembly name)
 * @param {number} [p.toInches] scene units → inches (the modal's scene is metres)
 * @param {Function} [p.kitOf] drawing → { name, line } of its kit, or null — the Fabricut edition only
 */
export function composeTraverseSheet({ page, scene, nameOf, title = '', toInches = M2IN, kitOf = null }) {
    const kit = (d) => (kitOf ? kitOf(d) : null);
    const geo = makeGeo(scene, toInches);
    const ds = page.drawings || [];
    ds.forEach(d => checkLayout(geo, d));
    let units = [], scale;
    if (page.kind === 'TRAVERSE_ENDS') {
        scale = 0.72;
        units = ds.map((d, i) => endsUnit(geo, d, M, M + i * UH, scale, nameOf, `${HEADINGS.ENDS(d)} · ${[...new Set(Object.entries(d.groups).filter(([k]) => k.startsWith('TRV_END')).flatMap(([, g]) => g.choices.map(nameOf)))].join('/')}`));
    } else if (page.group === 'ARM' || page.group === 'MITER') {
        scale = 0.5;
        units = ds.map((d, i) => endArmUnit(geo, d, M, M + i * UH, scale, nameOf, HEADINGS.RETURN(d, nameOf)));
    } else if (page.group === 'CEILING') {
        scale = 0.54;
        units = ds.map((d, i) => ceilingUnit(geo, d, M, M + i * UH, scale, nameOf, HEADINGS.CEILING(d, nameOf, kit(d)), kit(d)?.line));
    } else {
        const GUT = 1.6, frontW = 3.2 + (ds.some(d => d.rodFront) ? 1.8 * Math.max(...ds.map(d => (d.rings || []).length)) : 0) - (ds.some(d => d.rodFront) ? 0.2 : 0);
        const need = Math.max(...ds.map(d => bracketNeed(geo, d, nameOf)));
        scale = Math.min(0.54, (UW - 0.62 - GUT) / (need + frontW));
        const fxAt = M + 0.62 + need * scale + GUT;
        units = ds.map((d, i) => bracketUnit(geo, d, M, M + i * UH, scale, fxAt, nameOf, HEADINGS.BRACKET(d, nameOf, kit(d)), kit(d)?.line));
    }
    const body = units.join(`<line class="sep" x1="${M}" x2="${PAGE_W - M}" y1="${f3(M + UH - 0.02)}" y2="${f3(M + UH - 0.02)}"/>`);
    const foot = text('t4', M, PAGE_H - 0.18, `${title ? title + ' · ' : ''}TRAVERSE · drawn from the model as the configurator settles each set-up · scale ${Math.round(scale * 100)}% (one scale per sheet)`);
    const inner = `${STYLE}<rect width="${PAGE_W}" height="${PAGE_H}" fill="#fff"/>${body}${foot}`;
    return {
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1100 850" font-family="Helvetica, Arial, sans-serif"><rect width="1100" height="850" fill="white"/><g transform="scale(100)">${inner}</g></svg>`,
        viewMaps: [], paper: 'letter', scale,
    };
}
