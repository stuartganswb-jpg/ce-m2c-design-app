// specSheetSolidDraw.js — one SOLID sheet (specSheetSolid.solidSheets) as an SVG, drawn from the model.
//
// The layout Stuart approved on the drafts (2026-09-30 / 10-01), 8.5×11 landscape:
//   bracket   END VIEW (wall → rod ℄), then one column each: the rod size, every ring top → ring BODY bottom (never
//             the eyelet — "the only clear view of the ring itself"), plate top → rod top; the rod and ring drops under.
//   return    PLAN from above (wall → rod face, to rod ℄) beside the same END VIEW. An end arm is a part: the rod is
//             cut straight and the arm butts it (its leg IS a dimension). A miter / french return is a fee: no "leg"
//             ("there is no leg there … it should just be the smooth bend").
//   rows      BACKPLATES, then COVER PLATES: each plate facing the wall, the rod dashed in front of it — height,
//             width, plate top → rod top, rod bottom → plate bottom, plate top → the bottom of each ring's body.
//
// Three facts of the merged model this file exists to respect:
//   · THE PLATES ARE ONE SHARED SET, parked at one depth, while every bracket / return is modelled at its own — so
//     the plate's wall face goes to rod ℄ − the sheet's projection (as the sheets have always placed it), and a
//     subject that then fails to meet its plate is said so on the sheet.
//   · A RETURN THAT CARRIES ITS OWN BEND (more than an inch along the rail) takes the rod segment that ENDS where it
//     begins — the end segments run on to the very end and would draw a straight leg the rod never has.
//   · THE RODS ARE THE SHEET'S OWN TIERS: a single never draws a double's rear rod (it sat at the wall as a phantom
//     circle and dragged every rod dimension with it).
// The model must be laid out as the traverse composer expects — X away from the wall, Y up, Z along the rail — and is
// refused otherwise rather than drawn wrong.
import { renderHiddenLine } from './hiddenLine.js';
import { groupBbox, translateMeshes, fracText, M2IN } from './specSheetGeometry.js';
import { PAGE_W, PAGE_H, M, VIEW, clipU, ringBodyBottom, segPath, hDim, vDim, wallHatch, text, STYLE, f3, ins, makeGeo } from './specSheetTraverseDraw.js';

const U = (s) => String(s ?? '').trim().toUpperCase();
const RETURN_WORDS = {
    FRENCH: ['Solid french return', 'a fee — the rod bends back to the wall', 'the rod bends back into the wall (a fee)'],
    MITER: ['Solid miter return', 'a fee — the rod is mitred back to the wall', 'the rod is mitred into the return (a fee)'],
    ARM: ['Solid end return arm', 'a part — the rod is cut straight, the arm butts it', 'the rod is cut straight, the end arm butts it (a part)'],
};
const SCALES = [0.40, 0.37, 0.34, 0.31, 0.28];   // the approved scale first; smaller only when a sheet cannot fit
const FIT_BOTTOM = PAGE_H - 0.5;

function drawSheet(geo, sheet, nameOf, s, editionLabel) {
    const ret = sheet.group === 'RETURN', retType = sheet.returnType;
    const subjM = geo.meshes(sheet.subject?.nodes);
    if (!subjM.length) throw new Error('the bracket has no geometry in this model');
    const sb = groupBbox(subjM);
    const rodAll = geo.meshes([...new Set((sheet.rods || []).flatMap(c => c.nodes || []))]);
    const plates = (sheet.plates || []).map(x => ({ name: nameOf(x.choice), row: x.row, ms: geo.meshes(x.choice.nodes) })).filter(p => p.ms.length);
    if (!plates.length || !rodAll.length) throw new Error(`no ${plates.length ? 'rod' : 'plate'} geometry in this model`);
    const sizeOf = (p) => { const b = groupBbox(p.ms); return [b.max[2] - b.min[2], b.max[1] - b.min[1]]; };   // [width, height]
    // rows in the engine's family order; within a row the widest plate first (the rod's own wide plate leads)
    const rowKeys = [...new Map(plates.map(p => [p.row.key, p.row])).values()].sort((a, b) => a.order - b.order);
    const rows = rowKeys.map(r => ({ name: r.name, plates: plates.filter(p => p.row.key === r.key).sort((a, b) => sizeOf(b)[0] - sizeOf(a)[0]) }));
    const rings = (sheet.rings || []).map(o => { const ms = geo.meshes(o.nodes); return ms.length ? { name: nameOf(o), ms, b: groupBbox(ms), body: ringBodyBottom(ms) } : null; }).filter(Boolean);
    // the end view draws the tallest plate, a backplate over a cover plate of the same height
    const hMaxAll = Math.max(...plates.map(p => sizeOf(p)[1]));
    const tall = plates.filter(p => sizeOf(p)[1] >= hMaxAll - 0.05);
    const tallest = tall.find(p => p.row.key === 'BP') || tall[0];
    const pbT = groupBbox(tallest.ms); let wallX = pbT.min[0];

    const near = (ms, pad) => ms.filter(mm => { const b = groupBbox([mm]); return b.max[2] > sb.min[2] - pad && b.min[2] < sb.max[2] + pad; });
    const zc = (sb.min[2] + sb.max[2]) / 2;
    const thin = (mm) => { const b = groupBbox([mm]); return b.max[0] - b.min[0] < 2.5; };          // a straight run, not a bend
    const rodNear = rodAll.filter(mm => { const b = groupBbox([mm]); return b.min[2] <= zc + 0.01 && b.max[2] >= zc - 0.01 && thin(mm); });
    const bendRet = ret && sb.max[2] - sb.min[2] > 1.0;
    const rodEnd = rodAll.filter(mm => Math.abs(groupBbox([mm]).max[2] - sb.min[2]) < 0.1 && thin(mm));
    const ownsBend = bendRet && rodEnd.length > 0;
    const rodSec = ownsBend ? rodEnd : rodNear;
    const rb = groupBbox(rodSec.length ? rodSec : rodAll);
    // A model laid out differently would be drawn wrong, silently — so it is refused instead.
    if (!(rb.size[2] >= rb.size[0] && rb.size[2] >= rb.size[1]) || !(pbT.min[0] < rb.min[0]))
        throw new Error('this model is not laid out wall-at-−X / rail-along-Z — the solid sheet cannot be drawn from it');
    const zs = ownsBend ? sb.min[2] - 0.5 : zc;
    // round or not, from the rod's own section: as wide as it is tall AND no corners (a circle's reach r·1.41, a square's r·2)
    const rodRound = (() => {
        const cx0 = (rb.min[0] + rb.max[0]) / 2, cy0 = (rb.min[1] + rb.max[1]) / 2, w = rb.max[0] - rb.min[0], h = rb.max[1] - rb.min[1], r = Math.max(w, h) / 2;
        let m = 0;
        for (const mm of rodSec) { const P = mm.positions; for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i + 2] - zs) < 1) m = Math.max(m, Math.abs(P[i] - cx0) + Math.abs(P[i + 1] - cy0)); }
        return r > 0 && Math.abs(w - h) < 0.1 * Math.max(w, h) && m < r * 1.7;
    })();
    const sizeWord = (n) => `${ins(n)} ${rodRound ? 'dia' : 'face'}`;
    // which way, when the rod runs past the plate's edge
    const topWords = (plateTop) => { const d = plateTop - rb.max[1]; return d >= -0.01 ? ins(d) : `${ins(-d)} above`; };
    const botWords = (plateBot) => { const d = rb.min[1] - plateBot; return d >= -0.01 ? ins(d) : `${ins(-d)} below`; };

    // THE PLATE GOES TO THE PROJECTION
    const proj = sheet.answers?.proj, projTxt = proj != null && proj !== '' ? `${fracText(Number(proj))}"` : '';
    let warn = '';
    if (projTxt && Number.isFinite(Number(proj)) && U(sheet.answers?.mount || 'WALL') !== 'CEILING') {
        const dx = ((rb.min[0] + rb.max[0]) / 2 - Number(proj)) - pbT.min[0];
        if (Math.abs(dx) > 1e-4) {
            for (const p of plates) p.ms = translateMeshes(p.ms, [dx, 0, 0]);
            wallX += dx; pbT.min[0] += dx; pbT.max[0] += dx;
        }
        // the subject's wall end must land between the wall and the plate face (a miter leg runs through to the wall)
        const gap = sb.min[0] > pbT.max[0] ? sb.min[0] - pbT.max[0] : sb.min[0] < wallX ? sb.min[0] - wallX : 0;
        if (Math.abs(gap) > 1 / 16) warn = `⚠ the ${ret ? 'return' : 'arm'} model stops ${ins(gap)} ${gap > 0 ? 'short of' : 'past'} the plate at this projection`;
    }

    const head = ret ? RETURN_WORDS[retType][0] : 'Solid bracket';
    const sub = [editionLabel, 'SOLID', sheet.answers?.setup, sheet.answers?.mount, projTxt && `proj ${projTxt}`, ret ? RETURN_WORDS[retType][1] : '',
        rows.length === 2 ? 'both plate families' : ''].filter(Boolean).join(' · ');
    let out = text('t1', M, M + 0.16, `${head} · ${nameOf(sheet.subject)}`) + text('t2', M, M + 0.34, sub);
    const rodName = nameOf((sheet.rods || [])[0]);

    // THE END VIEW. compact: the labels wrap under their value (a return's end view shares the row with its plan).
    const endView = (x0, yTop, hs, { withDepth, compact }) => {
        const endV = renderHiddenLine([...subjM, ...rodSec, ...tallest.ms, ...rings.flatMap(r => r.ms)], VIEW.end, 1400).vis;
        const vMax = Math.max(pbT.max[1], rb.max[1], ...rings.map(r => r.b.max[1])), vMin = Math.min(pbT.min[1], rb.min[1], ...rings.map(r => r.b.min[1]));
        const oy = yTop + (withDepth ? 0.45 : 0.25) + vMax * hs, ox = x0 + 0.3 - wallX * hs;
        let o = wallHatch(ox + wallX * hs, oy - (vMax + 0.3) * hs, oy - (vMin - 0.3) * hs) + `<path class="ln" d="${segPath(endV, ox, oy, hs)}"/>`;
        const rc = (rb.min[0] + rb.max[0]) / 2;
        if (withDepth) {
            o += hDim(ox + wallX * hs, ox + rc * hs, oy - vMax * hs - 0.18, `${ins(rc - wallX)} to rod ℄`, oy - pbT.max[1] * hs, oy - rb.max[1] * hs);
            o += `<line class="cl" x1="${f3(ox + rc * hs)}" y1="${f3(oy - vMax * hs - 0.18)}" x2="${f3(ox + rc * hs)}" y2="${f3(oy - (rb.min[1] - 0.25) * hs)}"/>`;
        }
        const right = ox + Math.max(rb.max[0], ...rings.map(r => r.b.max[0])) * hs;
        const under = (cx, y0, y1, lines) => lines.map((t, i) => text('dimt', cx + 0.08, (y0 + y1) / 2 + 0.17 + i * 0.13, t)).join('');
        let cx = right + 0.3;
        o += vDim(cx, oy - rb.max[1] * hs, oy - rb.min[1] * hs, sizeWord(rb.max[1] - rb.min[1]), ox + rb.max[0] * hs, ox + rb.max[0] * hs);
        cx += compact ? 0.6 : 0.75;
        rings.forEach((r) => {
            const y0 = oy - r.b.max[1] * hs, y1 = oy - r.body * hs;
            o += vDim(cx, y0, y1, compact ? ins(r.b.max[1] - r.body) : `${ins(r.b.max[1] - r.body)} ring top → bottom`, ox + r.b.max[0] * hs, ox + r.b.max[0] * hs);
            o += under(cx, y0, y1, compact ? ['ring top → bottom', r.name, '(not the eyelet)'] : [`${r.name} (not the eyelet)`]);
            cx += compact ? 1.25 : 1.65;
        });
        // plate top → rod top goes LAST: between the rings, their extension lines ran through its label (Stuart 2026-10-01)
        const py0 = oy - pbT.max[1] * hs, py1 = oy - rb.max[1] * hs;
        if (compact) {
            o += vDim(cx, py0, py1, topWords(pbT.max[1]), ox + pbT.max[0] * hs, ox + rb.max[0] * hs) + under(cx, py0, py1, ['plate top → rod top', `(${tallest.name})`]);
            cx += 1.25;
        } else {
            o += vDim(cx, py0, py1, `${topWords(pbT.max[1])} plate top → rod top (${tallest.name})`, ox + pbT.max[0] * hs, ox + rb.max[0] * hs);
            cx += 2.25;
        }
        // the rod + ring drops: under the columns on a bracket; on a return, right-aligned in the free top-right corner
        const rodLine = `Rod ${rodName} (metal drawn) · ${sizeWord(rb.max[1] - rb.min[1])}`;
        const ny = compact ? M + 0.2 : oy - (vMin - 0.3) * hs - 0.12;
        if (compact) {
            o += text('t2', PAGE_W - M, ny, rodLine, 'end');
            rings.forEach((r, i) => { o += text('t2', PAGE_W - M, ny + 0.17 * (i + 1), `Ring ${r.name} · drop ${ins(rb.max[1] - r.b.min[1])} (rod top → eyelet)`, 'end'); });
        } else {
            o += text('t2', right + 0.3, ny, rodLine);
            if (rings.length) o += text('t2', right + 0.3, ny + 0.18, `Ring drops, rod top → eyelet: ${rings.map(r => `${r.name} ${ins(rb.max[1] - r.b.min[1])}`).join(' · ')}`);
        }
        o += text('t3', ox + wallX * hs, oy - (vMin - 0.3) * hs + 0.18, ret ? 'END VIEW — the return from the end, wall at left' : 'END VIEW — wall at left');
        const bottom = compact ? oy - (vMin - 0.3) * hs + 0.2 : Math.max(oy - (vMin - 0.3) * hs + 0.2, ny + 0.36);
        return { g: o, bottom };
    };

    let heroBottom;
    if (!ret) {
        const ev = endView(M + 0.32, M + 0.35, s, { withDepth: true, compact: false });
        out += ev.g;
        if (warn) out += text('t3', M + 0.62, ev.bottom + 0.02, warn);
        heroBottom = ev.bottom + (warn ? 0.14 : 0);
    } else {
        // PLAN from above (wall at left, the left end at the bottom)
        const WZ = [-(sb.max[2] + 0.5), -Math.max(sb.min[2] - 2.0, sb.max[2] - 3.6)];
        const rodPlan = ownsBend ? rodEnd : near(rodAll, 4);
        const planMs = [...subjM, ...rodPlan, ...tallest.ms.filter(mm => groupBbox([mm]).max[2] > sb.min[2] - 3)];
        const plan = renderHiddenLine(planMs, VIEW.planL, 1600).vis
            .map(q => [q[1], q[0], q[3], q[2]]).map(q => clipU([q], WZ[0], WZ[1])[0]).filter(Boolean).map(q => [q[1], q[0], q[3], q[2]]);
        const topY = M + 0.95, botY = topY + (WZ[1] - WZ[0]) * s;
        const X = (x) => M + 0.6 + (x - wallX) * s, Y = (vz) => topY + (WZ[1] - vz) * s;
        out += wallHatch(X(wallX), topY - 0.05, botY + 0.1);
        out += `<path class="ln" d="${plan.map(([u0, v0, u1, v1]) => `M${f3(X(u0))} ${f3(Y(v0))}L${f3(X(u1))} ${f3(Y(v1))}`).join('')}"/>`;
        out += hDim(X(wallX), X(rb.max[0]), topY - 0.12, `${ins(rb.max[0] - wallX)} wall → rod face`, topY, topY);
        const rc = (rb.min[0] + rb.max[0]) / 2;
        out += hDim(X(wallX), X(rc), topY - 0.32, `${ins(rc - wallX)} to rod ℄`, topY, topY);
        // the leg is a dimension on an end arm (a part) only — on a miter / french return it is a feature line of the
        // model the rod does not have (Stuart 2026-09-30: "remove that … there is no leg there")
        if (retType === 'ARM') out += vDim(X(rb.max[0]) + 0.2, Y(-sb.min[2]), Y(-sb.max[2]), `${ins(sb.max[2] - sb.min[2])} leg`, X(rb.max[0]), X(rb.max[0]));
        // THE JOINT where the return part is the leg alone: the model draws rod and return as one outline, so it is drawn
        // from the parts' own faces — mitred corner to corner, or the straight butt of an end arm. A return that carries
        // its own bend is drawn by the model.
        const jx0 = X(rb.min[0]), jx1 = X(rb.max[0]);
        if (!bendRet && retType === 'MITER') out += `<line class="ln" x1="${f3(jx0)}" y1="${f3(Y(-sb.min[2]))}" x2="${f3(jx1)}" y2="${f3(Y(-sb.max[2]))}"/>`;
        if (!bendRet && retType === 'ARM') out += `<line class="ln" x1="${f3(jx0)}" y1="${f3(Y(-sb.min[2]))}" x2="${f3(jx1)}" y2="${f3(Y(-sb.min[2]))}"/>`;
        out += text('t3', X(wallX), botY + 0.24, 'PLAN — left end from above (right mirrors)');
        out += text('t3', X(wallX), botY + 0.38, RETURN_WORDS[retType][2]);
        if (warn) out += text('t3', X(wallX), botY + 0.52, warn);
        // the END VIEW beside it, scaled down if the row would run off the page
        const x0 = Math.max(X(rb.max[0]) + (retType === 'ARM' ? 1.2 : 0.45), X(wallX) + 2.75);   // clear of the plan's caption
        const colsW = 0.3 + 0.6 + 1.25 + 1.25 * rings.length + 0.1;
        const span = Math.max(rb.max[0], ...rings.map(r => r.b.max[0])) - wallX;
        const hs = Math.min(0.36, s, (PAGE_W - M - x0 - 0.3 - colsW) / span);
        const ev = endView(x0, topY - 0.3, hs, { withDepth: false, compact: true });
        out += ev.g + text('t3', x0 + 0.3, topY - 0.38, `end view at ${Math.round(hs * 100)}%`);
        heroBottom = Math.max(botY + (warn ? 0.6 : 0.46), ev.bottom);
    }

    // ONE ROW PER PLATE FAMILY: each plate facing the wall, the rod dashed in front, with the client's dimensions
    let rowTop = heroBottom;
    const rodRow = ownsBend ? rodEnd : near(rodAll, 3);
    for (const f of rows) {
        const topAbove = Math.max(...f.plates.map(p => groupBbox(p.ms).max[1]), rb.max[1]);
        const botBelow = Math.min(...f.plates.map(p => groupBbox(p.ms).min[1]));
        out += `<text class="t1" x="${f3(M)}" y="${f3(rowTop + 0.14)}" style="font-size:.13px">${f.name}</text>`;
        let roy = rowTop + 0.32 + topAbove * s, px = M + 0.2;
        const lineH = () => (topAbove - botBelow) * s + 0.34 + rings.length * 0.13 + 0.36;
        for (const p of f.plates) {
            const pb = groupBbox(p.ms);
            const win = [-(pb.max[2] + 0.15), -(pb.min[2] - 0.15)];
            const w = (win[1] - win[0]) * s + 1.05;
            if (px + w > PAGE_W - M + 0.4 && px > M + 0.2) { px = M + 0.2; roy += lineH(); }   // a long family wraps
            const v = clipU(renderHiddenLine([...p.ms, ...subjM], VIEW.front, 900).vis, win[0], win[1]);
            const rv = clipU(renderHiddenLine(rodRow, VIEW.front, 900).vis, win[0], win[1]);
            const fox = px + 0.5 - win[0] * s;
            out += `<path class="ln" d="${segPath(v, fox, roy, s)}"/><path class="ph" d="${segPath(rv, fox, roy, s)}"/>`;
            const pl = fox + (-pb.max[2]) * s, pr = fox + (-pb.min[2]) * s, pt = roy - pb.max[1] * s, pbm = roy - pb.min[1] * s;
            const rt = roy - rb.max[1] * s, rbm = roy - rb.min[1] * s, edge = fox + win[1] * s;
            out += hDim(pl, pr, pbm + 0.17, ins(pb.max[2] - pb.min[2]), pbm, pbm);
            out += vDim(pl - 0.12, pt, pbm, ins(pb.max[1] - pb.min[1]), pl, pl, -1);
            out += vDim(edge + 0.08, pt, rt, topWords(pb.max[1]), pr, edge);
            out += vDim(edge + 0.08, rbm, pbm, botWords(pb.min[1]), edge, pr);
            const cx = fox + ((win[0] + win[1]) / 2) * s;
            out += text('t4', cx, Math.min(pt, rt) - 0.1, p.name, 'middle');   // above the plate or the rod, whichever is higher
            for (let ri = 0; ri < rings.length; ri++) out += text('dimt', cx, roy - botBelow * s + 0.34 + ri * 0.13, `plate top → ${rings[ri].name} ${ins(pb.max[1] - rings[ri].body)}`, 'middle');
            px += w;
        }
        rowTop = roy - botBelow * s + 0.34 + rings.length * 0.13 + 0.04;
    }
    return { g: out, bottom: rowTop };
}

/**
 * One solid sheet → { svg, viewMaps: [], paper: 'letter', scale }.
 * @param {object} p
 * @param {object} p.page         a SOLID sheet from specSheetSolid.solidSheets
 * @param {object} p.scene        the loaded THREE scene
 * @param {Function} p.nameOf     choice → the code to print (the modal's edition naming)
 * @param {string} [p.title]      the assembly name (footer)
 * @param {string} [p.editionLabel] the edition, first in the subtitle (the reader must know whose numbers they hold)
 * @param {number} [p.toInches]   scene units → inches (the modal's scene is metres)
 */
export function composeSolidSheet({ page, scene, nameOf, title = '', editionLabel = '', toInches = M2IN }) {
    const geo = makeGeo(scene, toInches);
    let drawn, scale;
    for (const s of SCALES) { scale = s; drawn = drawSheet(geo, page, nameOf, s, editionLabel); if (drawn.bottom <= FIT_BOTTOM) break; }
    const note = text('t4', M, PAGE_H - 0.42, 'Each plate facing the wall, the rod dashed: height at left, width below · right: plate top → rod top, rod bottom → plate bottom · below: plate top → bottom of each ring body (not the eyelet)');
    const foot = text('t4', M, PAGE_H - 0.18, `${title ? title + ' · ' : ''}SOLID · one ${page.group === 'RETURN' ? 'return' : 'bracket'} at one projection, drawn from the model · scale ${Math.round(scale * 100)}%`);
    const inner = `${STYLE}<rect width="${PAGE_W}" height="${PAGE_H}" fill="#fff"/>${drawn.g}${note}${foot}`;
    return {
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1100 850" font-family="Helvetica, Arial, sans-serif"><rect width="1100" height="850" fill="white"/><g transform="scale(100)">${inner}</g></svg>`,
        viewMaps: [], paper: 'letter', scale,
    };
}
