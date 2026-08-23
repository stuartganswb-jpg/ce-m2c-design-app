// ─────────────────────────────────────────────────────────────────────────────────────────────
// WHAT A SPEC SHEET *SET* IS — the CPQ's own narrowing, one page per leaf (Stuart 2026-08-23)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// "each page should be filtered down to show only a specific bracket arm at a specific projection.
//  so first we narrow down by diameter then we narrow down solid or traverse, then we narrow down
//  wood or metal, etc the same decisions made in the cpq steps."
//
// The old page list was a CROSS PRODUCT: every arm × every plate FAMILY, where "family" was the
// part code with its shape suffix chopped off and "return" / "in-line" were regexes over the code
// (/R[BC]P$/) and node names (/MTR|MITER|BEND/). Nothing in that consulted a tag, so nothing in it
// could be narrowed by diameter, rod world or projection — which is exactly why every page showed
// too much. The engine was then asked, afterwards, to hide nodes on a page whose identity was
// already wrong.
//
// This module decides page identity the only way that cannot disagree with a quote: it WALKS THE
// AXES. `activeAxes()` is the configurator's own question list, in the configurator's own order —
// rod kind, single/double, drive, mount, projection — each measured under the answers above it. A
// leaf of that walk is one column of the CPQ; the arms admissible there are that page's subjects;
// the plates and rings are whatever `slots()` offers once the arm is picked.
//
// Consequences worth stating, because each was a hand-written rule before:
//   · an arm made at two projections gets TWO pages, with each depth's own plates
//   · a traverse-only arm never appears on a solid page — it is not admissible there
//   · a return draws like a bracket because it IS one here: pick it, ask what plates follow
//   · rings are the rings that fit THAT rod, because that is what the RING slot answers
//   · material (wood vs metal) needs no axis: the code and the GLB carry the true dimensions
//
// Nothing here decides anything. Every sentence above is a call into hardwareModel.
//
// Pure — no React, no Firestore, no THREE. Tested by scripts/specSheetPages.test.mjs.

import { resolve, slots, activeAxes, ridersFor, judge, AXES, ROD_ROLES } from '../Shared/hardwareModel.js';
import { armsOf, platesForArm, rodForArm } from './specSheetRows.js';

const U = (v) => String(v ?? '').trim().toUpperCase();

/**
 * Every leaf of the configurator's question walk.
 *
 * Uses `activeAxes` rather than re-deriving the cascade, so a value that only exists under an
 * earlier answer only appears under it: a double's projections are the double brackets' own.
 * An IMPLIED axis (one value) is not a branch — it constrains without being asked, which is the
 * engine's rule, not a convenience.
 */
export function narrowings(choices, answers = {}, depth = 0) {
    if (depth > AXES.length) return [answers];           // belt and braces: the walk is finite
    const open = activeAxes(choices, answers)
        .find(a => !a.implied && answers[a.key] === undefined && (a.values || []).length > 1);
    if (!open) return [answers];
    return open.values.flatMap(v => narrowings(choices, { ...answers, [open.key]: v }, depth + 1));
}

/** Human-readable leaf, for a page title: "Solid · Single · 3-5/8″". */
export function narrowingLabel(choices, answers = {}) {
    const byKey = {};
    activeAxes(choices, answers).forEach(a => { byKey[a.key] = a; });
    return AXES
        .map(a => {
            const v = answers[a.key];
            if (v === undefined || v === '' || v === null) return null;
            if (!byKey[a.key]) return null;
            return a.key === 'proj' ? `${v}"` : String(v);
        })
        .filter(Boolean)
        .join(' · ');
}

/**
 * The MOUNTED parts a page can be about, at one leaf: bracket arms and returns alike.
 *
 * A french return draws exactly like a bracket on the hand-made sheets — plate column, elevation,
 * code, then its own detail — because it mounts the same way. `armsOf` reads the BRACKET slot.
 *
 * ⚠ READ BY ROLE, NOT BY SLOT KIND. The engine merges finials, returns and inside mounts into ONE
 * `END` slot per position — they are alternative answers to the same question, which is exactly
 * right for a configurator and exactly wrong for a page list that treats one of them as a subject
 * and another as catalogue. Looking for a slot named RETURN finds nothing and prints no return
 * pages at all; the option's own role is the fact.
 */
export function optionsByRole(model, role) {
    const seen = new Set();
    return (model?.slots || [])
        .filter(s => !s.suppressedBy)
        .flatMap(s => s.options || [])
        .filter(o => {
            if (U(o.role) !== U(role)) return false;
            const k = U(o.partId || o.id);
            if (!k || seen.has(k)) return false;
            seen.add(k); return true;
        });
}

export function subjectsOf(model) {
    const out = armsOf(model).map(arm => ({ choice: arm, kind: 'BRACKET' }));
    const seen = new Set(out.map(o => U(o.choice.partId || o.choice.id)));
    optionsByRole(model, 'RETURN').forEach(o => {
        const key = U(o.partId || o.id);
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ choice: o, kind: 'RETURN' });
    });
    return out;
}

/**
 * Everything ONE page draws, asked with that page's subject selected.
 *
 * One `slots()` call answers all of it, which is the point: plates and rings cannot disagree with
 * each other, or with the quote, because they are the same answer read twice.
 *
 * ⚠ Rings are the rings that FIT THIS ROD. `carriesRings`/`admits` already gate the RING slot on
 * the chosen rod, so "any ring options that fit that pole diameter" needs no measurement here —
 * asking with the rod selected IS the filter.
 */
export function pageSlots({ choices, answers = {}, subject, rod = null }) {
    const empty = { plates: [], rings: [], suppressedBy: null, reason: '' };
    if (!subject) return empty;
    const { plates, suppressedBy, reason } = platesForArm({ choices, answers, arm: subject, rod });
    const sl = slots(choices, answers, [subject.id, ...(rod ? [rod.id] : [])].filter(Boolean));
    const ringSlot = sl.find(s => s.kind === 'RING');
    const seen = new Set();
    const rings = (ringSlot?.suppressedBy ? [] : (ringSlot?.options || [])).filter(o => {
        const k = U(o.partId || o.id);
        if (!k || seen.has(k)) return false;
        seen.add(k); return true;
    });
    return { plates, rings, suppressedBy, reason };
}

/**
 * The parts that get a CATALOG page rather than a mounted one, at one leaf.
 *
 * "at the end after all these are down per diameter we then show all the finials and any other
 *  accessory items on one page" — finials and accessories are drawn alone, at size, in a grid.
 * They are read from the slots so a finial that is not offered in this world is not on the sheet.
 */
export function catalogOf(model) {
    return {
        finials: optionsByRole(model, 'FINIAL'),
        accessories: optionsByRole(model, 'ACCESSORY'),
        insideMounts: optionsByRole(model, 'INSIDE_MOUNT'),
    };
}

// ── A PLATE FAMILY IS A SHEET (Stuart's own reference set, read 2026-08-23) ──────────────────
// The example PDFs are named "…with screw Backplates" and "…with Hidden Backplates" — the same
// arm, drawn twice, once against the BP set and once against the CP set. Each sheet carries four
// rows, the four profiles H/R/S/V. H1-138 pins eleven plates (BP×4, CP×4, returns), so a page
// holding everything the engine offers is eight rows or more where the reference holds four.
//
// So the family split the old code had was RIGHT — what was wrong was that it was the ONLY split:
// families were regexed out of part codes and then crossed with every arm, unnarrowed by
// projection or rod world. Here it is the LAST cut, applied to a pool the engine has already
// narrowed, and it is presentation rather than a rule: which plates belong to an arm is still
// entirely the engine's answer, and this only decides how many sheets they are printed on.
const SHAPE_SUFFIX = /-(H|R|S|V)$/i;
export function plateFamilies(plates) {
    const fams = new Map();
    (plates || []).forEach(p => {
        const code = String(p.partId || p.id || '');
        const stem = code.replace(SHAPE_SUFFIX, '');
        if (!fams.has(stem)) fams.set(stem, []);
        fams.get(stem).push(p);
    });
    // Backplates before cover plates before returns — the order the hand-made set runs in.
    const rank = (stem) => (/RBP|RCP/i.test(stem) ? 2 : /CP$/i.test(stem) ? 1 : 0);
    return [...fams.entries()]
        .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
        .map(([stem, list]) => ({
            stem,
            // H, R, S, V — the profile order the reference rows run in.
            plates: list.slice().sort((x, y) => {
                const r = (o) => { const m = String(o.partId || '').match(SHAPE_SUFFIX); return m ? 'HRSV'.indexOf(m[1].toUpperCase()) : 9; };
                return r(x) - r(y) || String(x.partId).localeCompare(String(y.partId));
            }),
        }));
}

/**
 * THE PAGE LIST.
 *
 * One page per (leaf × subject). Deduped on what the page actually DRAWS — subject, rod, plates,
 * rings — because two leaves that answer a question the parts do not care about (a drive axis on a
 * manual-only bracket) describe the same drawing, and printing it twice is the old cross product
 * coming back by another door.
 *
 * @returns [{ key, kind, answers, label, subject, rod, plates, rings, suppressedBy, reason }]
 *          plus one CATALOG page per leaf that has finials or accessories.
 */
export function specPages({ choices, answers = {} }) {
    const pages = [];
    const seen = new Set();
    const catalogSeen = new Set();
    // ⚠ THE WALK NEEDS NORMALIZED CHOICES, AND ONLY ONCE. `admits` reads `fits`, which
    // `applyFitsDefaults` puts there — raw pins have none, so walking them throws. resolve() does
    // that normalization, so the walk is handed its output; the RAW list still goes to every
    // resolve() below, because normalizing an already-normalized choice drops the projection tag
    // these pages are judged on.
    const walkable = resolve({ choices, answers }).choices || [];
    for (const leaf of narrowings(walkable, answers)) {
        const model = resolve({ choices, answers: leaf, selectedIds: [] });
        const norm = model.choices || [];
        const label = narrowingLabel(norm, leaf);
        // ⚠ THE ROD MUST BE ONE THIS LEAF ACTUALLY OFFERS. `rodForArm` picks from every rod the
        // model carries, and a combined collection carries both worlds — so a traverse page was
        // handed the SOLID rod, which then dressed it with rings a track cannot take. Judging the
        // pool first is the same gate the configurator applies before it offers anything.
        const offered = { choices: judge(norm, leaf).in };
        for (const { choice: subject, kind } of subjectsOf(model)) {
            const rod = rodForArm(offered, subject);
            const { plates, rings, suppressedBy, reason } = pageSlots({ choices: norm, answers: leaf, subject, rod });
            const fams = plates.length ? plateFamilies(plates) : [{ stem: '', plates: [] }];
            for (const fam of fams) {
            const sig = [
                U(subject.partId || subject.id),
                U(rod?.partId || ''),
                fam.plates.map(p => U(p.partId || p.id)).sort().join(','),
                rings.map(r => U(r.partId || r.id)).sort().join(','),
            ].join('|');
            if (seen.has(sig)) continue;
            seen.add(sig);
            pages.push({
                key: `${U(subject.partId || subject.id)}__${U(fam.stem)}__${pages.length}`,
                kind, answers: leaf, label, subject, rod, plates: fam.plates, plateFamily: fam.stem,
                rings, suppressedBy, reason,
                isTraverse: !!rod && ROD_ROLES.includes(rod.role) && (U(rod.rodKind) === 'TRAVERSE' || rod.role === 'TRACK'),
                // ⚠ RIDERS ARE ONLY THERE ONCE THE ROD IS. `ridersFor` is deliberately additive —
                // nothing chosen, nothing rides — so asking with no selection returns nothing and a
                // traverse page would draw an empty track. The page's own rod is what carries them.
                riders: rod ? ridersFor(norm, leaf, [rod.id]) : [],
            });
            }
        }
        const cat = catalogOf(model);
        for (const im of cat.insideMounts) {
            const sig = `IM|${U(im.partId || im.id)}`;
            if (seen.has(sig)) continue;
            seen.add(sig);
            pages.push({
                key: sig, kind: 'INSIDE_MOUNT', answers: leaf, label, subject: im,
                rod: rodForArm(model, im), plates: [], rings: [], suppressedBy: null, reason: '',
                isTraverse: false, riders: [],
            });
        }
        const items = [...cat.finials, ...cat.accessories];
        if (!items.length) continue;
        const csig = items.map(i => U(i.partId || i.id)).sort().join(',');
        if (catalogSeen.has(csig)) continue;
        catalogSeen.add(csig);
        pages.push({
            key: `CATALOG__${catalogSeen.size}`, kind: 'CATALOG', answers: leaf, label,
            subject: null, rod: null, plates: [], rings: [],
            finials: cat.finials, accessories: cat.accessories,
            suppressedBy: null, reason: '', isTraverse: false, riders: [],
        });
    }
    return pages;
}
