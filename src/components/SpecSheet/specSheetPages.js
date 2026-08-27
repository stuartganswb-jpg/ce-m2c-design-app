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
import { armsOf, platesForArm, rodForArm, backRodForArm } from './specSheetRows.js';

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
// ⚠ THE FAMILY IS THE PART CODE, AND NO SINGLE FIELD RELIABLY HOLDS IT.
//   · prod  — the adapter sets name = pin.partName ("H1-138CP-H") and partId = the library doc id
//             ("CE-INV-56809"). Grouping on partId made every plate its own family: one row per
//             sheet where the reference has four, 187 sheets instead of ~46, and a family label
//             reading "CE-INV-56809".
//   · tests — normalizeChoice DEFAULTS name to the choice id, so `name` there is "PL-H" and the
//             code is in partId. Which is exactly why every fixture passed while prod did not.
// So the code is whichever candidate actually looks like one. We are grouping by profile suffix,
// so the string that carries a profile suffix is the string that means something here; anything
// equal to the raw id is normalizeChoice's fallback and is never the answer.
const codeOf = (c) => {
    const id = String(c?.id || '');
    const cands = [String(c?.name || ''), String(c?.partId || ''), id].filter(Boolean);
    return cands.find(v => v !== id && SHAPE_SUFFIX.test(v))
        || cands.find(v => v !== id)
        || id;
};
export function plateFamilies(plates) {
    const fams = new Map();
    (plates || []).forEach(p => {
        const code = codeOf(p);
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
                const r = (o) => { const m = codeOf(o).match(SHAPE_SUFFIX); return m ? 'HRSV'.indexOf(m[1].toUpperCase()) : 9; };
                return r(x) - r(y) || codeOf(x).localeCompare(codeOf(y));
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
    // ── ONE CATALOG, NOT ONE PER LEAF (Stuart 2026-08-23) ────────────────────────────────────
    // "there is no need to duplicate them as the finials are in many locations just show them
    //  from the front single once is enough for group." A finial is pinned per side, per rod
    // world and per bracket family, so the per-leaf catalogs listed the same parts again and
    // again. They are unioned by part across every leaf and printed once, at the end.
    const catFinials = new Map();
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
            // ── A RETURN MEETS THE WALL (Stuart 2026-08-23b) ────────────────────────────────
            // The ceiling leaf offered the returns too (an END option votes on no mount), so
            // every return got a SECOND page whose plates deduped to the CEILING pins — which is
            // exactly the "showing them with ceiling backplates" he reported, plus audit noise
            // once the rtn-only swap put wall plates on a ceiling page. The engine's own pairing
            // comment already states the rule: a return always meets the wall.
            if (kind === 'RETURN' && U(leaf.mount) === 'CEILING') continue;
            // ── A TIERED ARM ANSWERS PROJECTION ITSELF (Stuart 2026-08-27, H1-75D) ──────────
            // "i do not see any wrong tags on H1-75D … tagged with front and rear projection just
            // like in H1-138." He is right — the pin is correct. The fan-out came from the LEAF:
            // H1-75's backplates carry flat proj tags, so the projection axis stays alive under
            // DOUBLE and handed the (projection-less) double arm one page per plate depth — four
            // near-identical D page groups. The axis doctrine already says a projTiers bracket IS
            // the projection question, so its pages are built from the leaf WITHOUT the proj
            // answer: plates unfiltered by leaf depth (pairing rules still apply), one page set,
            // which is exactly how H1-138D — whose plates carry no proj tags — always behaved.
            const tiered = !!(subject.projTiers && Object.keys(subject.projTiers).length);
            const leafFor = (tiered && leaf.proj !== undefined)
                ? Object.fromEntries(Object.entries(leaf).filter(([k]) => k !== 'proj'))
                : leaf;
            const offeredFor = leafFor === leaf ? offered : { choices: judge(norm, leafFor).in };
            const pageLabel = leafFor === leaf ? label : narrowingLabel(norm, leafFor);
            const rod = rodForArm(offeredFor, subject);
            // ── A DOUBLE HAS TWO POLES AND THE SHEET SHOWS BOTH ─────────────────────────────
            // Stuart 2026-08-23: "on doubles you should show both poles in their place not just
            // one." rodForArm answers WHICH rod this arm holds — the tier question, and still the
            // right answer for the projection and for the rings. But a double bracket physically
            // carries a front rod and a back rod, and a drawing showing one is a drawing of a
            // single. So the page carries the whole admissible set alongside its own rod.
            // ⚠ ONLY A DOUBLE HAS A SECOND POLE. Taking every admissible rod put a back rod on
            // SINGLE sheets (Stuart 2026-08-23: "the single is showing the double pole in the
            // wrong position") — H1-138's back-rod pins are not all tagged setup:DOUBLE, so the
            // gate does not exclude them and "admissible" is a weaker claim than "part of this
            // configuration". The arm's own rod always leads, so axis inference stays stable.
            // ⚠ AND THE SECOND POLE IS *THE* SECOND POLE, NOT EVERY OTHER-TIER ROD IN THE FILE
            // (Stuart 2026-08-23: "H1-138D is a mess … the poles are all in the wrong place").
            // "Every admissible rod of the other tier" swept 15 choices onto the D page — acrylic,
            // wood, and the BASIC double's 6.5" back rod alongside the DEC double's 8.5" — because
            // material is not an axis and the two double families only differ by projTiers, which
            // the leaf does not narrow. The configurator pairs the rear rod to the CHOSEN bracket
            // by its cut; backRodForArm applies that same rule here.
            const rods = U(leaf.setup) === 'DOUBLE'
                ? [rod, backRodForArm(offeredFor, subject, rod, { forReturn: kind === 'RETURN' })].filter(Boolean)
                : (rod ? [rod] : []);
            const { plates: plates0, rings: rings0, suppressedBy, reason } = pageSlots({ choices: norm, answers: leafFor, subject, rod });
            // ── A RETURN DRAWS THE RETURN PLATES (Stuart 2026-08-23b) ────────────────────────
            // "on the miter and french returns, you are currently showing them with ceiling
            //  backplates and they need to be shown with the backplates marked rtn-only." The
            // return leaf answers no mount, so every copy of a plate is admissible and the
            // slot's dedupe can keep ANY pin — a ceiling one included. And filtering the pool is
            // not enough: the kept option IS a specific pin, so when the ceiling copy won, no
            // returnOnly option is left to filter to. Each plate is therefore swapped for its
            // returnOnly TWIN — same part, the pin tagged rtn-only, same side where possible —
            // which is the one-code-many-pins resolution again, decided by the tag.
            // ⚠ THE TWIN COMES FROM THE LEAF'S OWN ADMISSIBLE SET. Searching the whole choice
            // list handed a single-return page the DOUBLE world's rtn plates — the audit caught
            // it ("not admissible at SOLID · SINGLE · WALL · 3.625"). judge() has already said
            // which copies belong at this leaf; the swap picks among those.
            const plates = kind !== 'RETURN' ? plates0 : plates0.map(p => {
                if (p.returnOnly) return p;
                const twin = (offeredFor.choices || []).find(c => c.returnOnly && U(c.role) === 'BACKPLATE'
                    && U(c.partId) === U(p.partId)
                    && (!c.position || !p.position || c.position === p.position));
                return twin || p;
            });
            const isTrav = !!rod && ROD_ROLES.includes(rod.role) && (U(rod.rodKind) === 'TRAVERSE' || rod.role === 'TRACK');
            // ── A TRAVERSE PAGE DRAWS CARRIERS, NEVER RINGS (Stuart 2026-08-23b) ────────────
            // "on the traverse poles remove the rings, only show the carriers." The untagged
            // rings serve both worlds, so the slot still offers them here — but the audit's own
            // unconditional rule already says a track carries its drapery on carriers, and the
            // builder now agrees. The H1-2TRV fascia (traverse + stationary front rod) keeps its
            // rings when that collection arrives: they hang on the SOLID front rod's page.
            const rings = isTrav ? [] : rings0;
            const fams0 = plates.length ? plateFamilies(plates) : [{ stem: '', plates: [] }];
            // ── EVERY MULTI-PLATE FAMILY PRINTS TWO ROWS PER SHEET (Stuart 2026-08-27) ──────
            // Began as the deep-double rule (2026-08-23: "start with the deep doubles 2 per page")
            // and is now universal: "look at H1-138CB … the CB is way too small … in the H1-75 it
            // is even worse, super small with tons of wasted white space." A row's height is
            // partly TEXT — captions, dim labels, the ring-code lanes — which does not shrink
            // with the scale, so FOUR rows of it on one portrait sheet crushes the drawings no
            // matter the assembly. Two rows per sheet frees the height, and the page-level scale
            // then grows each sheet to fill the paper. The split is presentation only: which
            // plates belong to the arm is still entirely the engine's answer.
            const fams = fams0.flatMap(f => {
                if (!(f.plates.length > 2)) return [f];
                const out = [];
                const n = Math.ceil(f.plates.length / 2);
                for (let i = 0; i < f.plates.length; i += 2) {
                    out.push({ ...f, plates: f.plates.slice(i, i + 2), part: `${i / 2 + 1}/${n}` });
                }
                return out;
            });
            for (const fam of fams) {
            const sig = [
                U(subject.partId || subject.id),
                // ⚠ THE PROJECTION IS PART OF A DRAWING'S IDENTITY (Stuart 2026-08-24c: "the
                // H1-MRPF is available in 3 projections … we need the other two and we need to
                // align the backplates with the correct return projections"). The dedupe was
                // collapsing a subject tagged at several depths into its first leaf's page; one
                // page per projection keeps each leaf's own plates and its own projection figure
                // (the plate depth and the dim both read the LEAF's tag).
                String(leafFor.proj ?? ''),
                U(rod?.partId || ''),
                fam.plates.map(p => U(p.partId || p.id)).sort().join(','),
                rings.map(r => U(r.partId || r.id)).sort().join(','),
            ].join('|');
            if (seen.has(sig)) continue;
            seen.add(sig);
            pages.push({
                key: `${U(subject.partId || subject.id)}__${U(fam.stem)}__${pages.length}`,
                kind, answers: leafFor, label: pageLabel, subject, rod, rods, plates: fam.plates, plateFamily: fam.stem,
                part: fam.part || '',
                rings, suppressedBy, reason,
                isTraverse: isTrav,
                // ⚠ RIDERS ARE ONLY THERE ONCE THE ROD IS. `ridersFor` is deliberately additive —
                // nothing chosen, nothing rides — so asking with no selection returns nothing and a
                // traverse page would draw an empty track. The page's own rod is what carries them.
                riders: rod ? ridersFor(norm, leafFor, [rod.id]) : [],
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
                // ⚠ `offered`, NOT `model` — same reason as the bracket pages above. Picking from
                // the unjudged model handed inside-mount sheets a rod their own leaf excludes (a
                // WALL-tagged pole on a CEILING page), which is what the audit was reporting across
                // 77 sheets. The audit disagreeing with the builder is the audit working.
                rod: rodForArm(offered, im), plates: [], rings: [], suppressedBy: null, reason: '',
                isTraverse: false, riders: [],
            });
        }
        // ⚠ FINIALS ONLY (Stuart 2026-08-23b: "remove the accessories no need to show those
        // carriers there, that throws off the scale of the metal finials"). The 20-1/2" carrier
        // strip was the widest thing on the metal page, and the whole grid shrank to hold it.
        cat.finials.forEach(f => { const k = U(f.partId || f.id); if (k && !catFinials.has(k)) catFinials.set(k, f); });
    }
    // ── ONE CATALOG PAGE PER MATERIAL (Stuart 2026-08-23b) ───────────────────────────────────
    // "finials are all overlapping, put metal on one page, wood on one page and acrylic all on
    //  one page, probably fit that way at 1:1." The bucket is the TAG: no-finish/clear parts are
    // the acrylic page, WOOD-tagged the wood page, everything else metal (blank means METAL, the
    // engine's own rule). An untagged wood finial lands on the metal page — the fix is its tag.
    const bucketOf = (c) => {
        const mats = (Array.isArray(c.materials) ? c.materials : [String(c.materials || '')]).map(U);
        if (c.noFinish || mats.some(m => m.includes('CLEAR') || m.includes('ACRYL'))) return 'Acrylic';
        if (mats.some(m => m.includes('WOOD'))) return 'Wood';
        return 'Metal';
    };
    for (const mat of ['Metal', 'Wood', 'Acrylic']) {
        const finials = [...catFinials.values()].filter(c => bucketOf(c) === mat);
        if (!finials.length) continue;
        pages.push({
            key: `CATALOG__${mat.toUpperCase()}`, kind: 'CATALOG', answers: {}, label: mat,
            subject: null, rod: null, plates: [], rings: [],
            finials, accessories: [],
            suppressedBy: null, reason: '', isTraverse: false, riders: [],
        });
    }
    return pages;
}

// ── PROVING A SHEET SET BELONGS TO ITS ASSEMBLY (Stuart 2026-08-23) ──────────────────────────
// "every assembly needs its own to avoid a mess."
//
// The mess is a page showing something that is not part of the combination it names. Every filter
// above is the engine's, so the pages SHOULD be clean — but "should" is what the old sheet also
// believed, and it was wrong for months without saying so.
//
// This audits the finished page list along an INDEPENDENT path. It does not call pageSlots or
// slots() again — restating the builder in different words proves nothing. It asks `judge`, which
// is the gate itself, whether each drawn part is admissible under that page's own answers, and it
// checks the three pairing rules in their plain form. A disagreement between this and the builder
// is a real defect in one of them.
//
// Returns [] when the set is clean. Never throws: an audit that can take the tool down is worse
// than no audit.
export function auditPages(pages, choices) {
    const out = [];
    if (!pages || !choices) return out;
    let norm;
    try { norm = resolve({ choices }).choices || []; } catch (e) { return out; }
    const byLeaf = new Map();
    const admissible = (answers) => {
        const k = JSON.stringify(answers || {});
        if (!byLeaf.has(k)) {
            let ids = null;
            try { ids = new Set(judge(norm, answers || {}).in.map(c => String(c.id))); } catch (e) { ids = null; }
            byLeaf.set(k, ids);
        }
        return byLeaf.get(k);
    };
    const say = (page, part, why) => out.push({
        page: page.key,
        subject: page.subject?.partId || page.subject?.id || '(catalog)',
        part: part?.partId || part?.id || '(none)',
        why,
    });

    for (const page of pages) {
        const ok = admissible(page.answers);
        const drawn = [
            ...(page.subject ? [['bracket arm', page.subject]] : []),
            ...(page.rod ? [['rod', page.rod]] : []),
            ...(page.plates || []).map(p => ['backplate', p]),
            ...(page.rings || []).map(r => ['ring', r]),
        ];
        // 1 · every part must survive the gate under this page's OWN answers
        if (ok) {
            for (const [what, part] of drawn) {
                if (!ok.has(String(part.id))) say(page, part, `this ${what} is not admissible at ${narrowingLabel(norm, page.answers) || 'this configuration'}`);
            }
        }
        // 2 · the pairing rules — ONLY the ones that hold unconditionally
        //
        // ⚠ An audit that fires when it should not is worse than none: it trains you to ignore it.
        // The first cut of this reported 76 false alarms on 19 sheets because it tested
        // `arm.inlineOnly` — a flag PLATES carry and arms do not. The engine keys on `arm.isInline`.
        //
        // It also claimed "a standard plate on an in-line arm", which is not a rule at all: the
        // engine deliberately falls back to the plain plates for a RETURN that has neither in-line
        // nor return copies, because a return always meets the wall. Only the statements that are
        // true in every case survive here — anything conditional would need the builder's own
        // reasoning, and an audit that re-runs the builder proves nothing.
        const arm = page.subject;
        if (arm && (page.plates || []).length) {
            if (arm.isBasic) say(page, page.plates[0], 'a basic arm is one piece and takes no backplate, but this page carries plates');
            // A return and an in-line arm sit against the wall the same way and share each other's
            // plates; an ordinary wall bracket is offered neither set.
            const wallSharing = !!arm.isInline || U(arm.role) === 'RETURN' || !!arm.usesReturnPlates;
            for (const p of page.plates) {
                if (p.inlineOnly && !wallSharing) say(page, p, 'an in-line plate on an ordinary wall bracket');
                if (p.returnOnly && !wallSharing) say(page, p, 'a return plate on an ordinary wall bracket');
            }
        }
        // 3 · a track carries carriers, not rings
        if (page.rod && U(page.rod.role) === 'TRACK' && (page.rings || []).length) {
            say(page, page.rings[0], 'a track carries its drapery on carriers — a ring cannot ride it');
        }
    }
    return out;
}
