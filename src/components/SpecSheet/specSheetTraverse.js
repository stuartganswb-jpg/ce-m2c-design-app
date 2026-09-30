// specSheetTraverse.js — the TRAVERSE sheets: which drawings exist, and what each one draws.
//
// Stuart 2026-09-29: "the H1-2TRV are displaying terribly, not following any of the visual rules from
// cpq/tags … whatever route we take we need to respect the other flows rules and not break what we have
// done to date on them." The solid page (one bracket arm × its plate family) was never a traverse drawing:
// a traverse bay is a fascia or a rod on a bracket, one or two tracks behind it, carriers riding the
// tracks, and an end on each track. So a traverse leaf that carries a TRACK gets its own sheets, and every
// other leaf — every solid page, and a traverse world with no track — keeps the page it always had.
//
// Every drawing is a set-up exactly as the configurator settles it: the page's answers, the operator's
// picks (the bracket, the metal fascia — the reference sheets draw metal — and, on an end drawing, the
// end), then the picks the configurator makes on its own (Shared/hardwareAutoPicks: the tracks and the
// traverse ends). What renders is the engine's `visible` — nothing here decides what belongs.
//
// Layout agreed on the drafts (Stuart 2026-09-29): two drawings per landscape sheet; wall brackets, then
// the ceiling bracket, then the end arms, then the miters; the drive is a note on every drawing and ONE
// closing sheet shows both track ends from below. Pure: no three.js, no React, no Firestore.
import { resolve, reseatPicks } from '../Shared/hardwareModel.js';
import { autoPicksOf } from '../Shared/hardwareAutoPicks.js';

const U = (s) => String(s ?? '').trim().toUpperCase();

/** A traverse leaf that carries a track is drawn by these sheets; anything else is not. */
export function isTrackLeaf(model, leaf) {
    return U(leaf?.rodKind) === 'TRAVERSE' && (model?.slots || []).some(s => s.kind === 'TRACK');
}

// ── A SET-UP, SETTLED THE WAY THE CONFIGURATOR SETTLES IT ─────────────────────────────────────
// Operator picks by slot (pickFor), reseated against the live options, then the configurator's own
// picks on top of the model they produce — repeated until the picks stop changing.
export function settleSetUp(choices, answers, pickFor) {
    let model = resolve({ choices, answers, selectedIds: [] });
    let picks = {};
    for (let pass = 0; pass < 8; pass++) {
        const own = {};
        for (const s of model.slots || []) { const c = pickFor(s); if (c) own[s.key] = c.id; }
        const { livePicks } = autoPicksOf({ model, answers, operatorPicks: reseatPicks(model, own) });
        const same = JSON.stringify(Object.entries(livePicks).sort()) === JSON.stringify(Object.entries(picks).sort());
        picks = livePicks;
        model = resolve({ choices, answers, selectedIds: Object.values(picks) });
        if (same) break;
    }
    return { model, picks };
}

// A fee end is a miter — the fascia itself is cut and mitred back to the wall. A part end (an end arm)
// is its own leg, and the fascia is cut straight into it (Stuart 2026-09-29). The tag cannot tell them
// apart (both carry MITER_RETURN); the fee can.
// The fee is a fact on the PIN (hardwareAdapter keeps it as choice.raw) — the choice itself does not copy it.
export const isMiterEnd = (c) => !!(c && (c.isFee || c.feeItemNo || c.raw?.isFee || c.raw?.feeItemNo));

/**
 * One drawing: the settled set-up, and its geometry grouped by role and tier (node names only).
 * kind: BRACKET (wall) · CEILING · RETURN (an end arm or a miter) · ENDS (one side of the track-ends sheet)
 */
export function drawingOf({ kind, choices, answers, bracket, end = null }) {
    const pickFor = (s) => {
        const opts = s.options || [];
        if (s.kind === 'BRACKET') return opts.find(o => U(o.partId) === U(bracket?.partId)) || null;
        if (s.kind === 'FASCIA') return opts.find(o => (Array.isArray(o.materials) && o.materials.length ? o.materials : ['METAL']).includes('METAL')) || opts[0] || null;
        // The track is the operator's to pick on the Track step; the drawing picks it as they would. Where the
        // setup was answered the configurator has already picked the same one itself (hardwareAutoPicks).
        if (s.kind === 'TRACK' && !s.suppressedBy) return opts[0] || null;
        if (s.kind === 'END' && end) return opts.find(o => U(o.partId) === U(end.partId)) || null;
        return null;
    };
    const { model, picks } = settleSetUp(choices, answers, pickFor);
    const chosen = new Set(Object.values(picks));
    const owner = new Map();
    for (const c of model.choices || []) for (const n of c.nodes || []) if (!owner.has(n)) owner.set(n, c);
    const groups = {};
    for (const n of model.visible || []) {
        const c = owner.get(n);
        if (!c) continue;
        if (c.role === 'ROD' && U(c.rodKind) === 'SOLID') continue;   // the solid pole pinned where the fascia is — not this world's
        if (c.role === 'RING') continue;                               // rings: every option, drawn one by one
        const key = `${c.role}${c.tier ? '/' + U(c.tier) : ''}`;
        (groups[key] ||= { role: c.role, tier: U(c.tier), choices: [], nodes: [] });
        if (!groups[key].choices.some(x => x.id === c.id)) groups[key].choices.push(c);
        groups[key].nodes.push(n);
    }
    const ringSlot = (model.slots || []).find(s => s.kind === 'RING' && !s.suppressedBy && (s.options || []).length);
    const centre = (model.choices || []).find(c => chosen.has(c.id) && c.role === 'BRACKET' && U(c.position) === 'CENTER')
        || (model.choices || []).find(c => chosen.has(c.id) && c.role === 'BRACKET') || bracket;
    const endChosen = end ? ((model.choices || []).find(c => chosen.has(c.id) && c.role === 'RETURN' && U(c.partId) === U(end.partId)) || end) : null;
    return {
        kind, answers, bracket: centre, end: endChosen,
        isMiter: isMiterEnd(endChosen),
        rodFront: !!ringSlot,
        rings: ringSlot ? ringSlot.options.map(o => ({ choice: o, nodes: o.nodes || [] })) : [],
        groups,
        projTiers: centre?.projTiers || null,
        drive: U(answers.drive) || 'MANUAL',
        sig: [kind, U(centre?.partId), U(endChosen?.partId), U(answers.setup), U(answers.frontLayer), U(answers.mount), String(answers.proj ?? ''), JSON.stringify(endChosen?.projTiers || null)].join('|'),
    };
}

const bracketOptions = (model) => {
    const out = [];
    const slots = (model.slots || []).filter(s => s.kind === 'BRACKET').sort((a, b) => (U(a.position) === 'CENTER' ? -1 : 0) - (U(b.position) === 'CENTER' ? -1 : 0));
    for (const s of slots) for (const o of s.options || []) if (!out.some(x => U(x.partId) === U(o.partId))) out.push(o);
    return out;
};
const leafLabel = (leaf) => ['TRAVERSE', leaf.setup, leaf.frontLayer === 'FASCIA' ? 'ROD FRONT' : leaf.frontLayer === 'TRACK' ? 'TRACK FRONT' : '', leaf.mount, leaf.proj != null ? `${leaf.proj}"` : '']
    .filter(Boolean).map(String).join(' · ');
const projKey = (d) => Number(d.answers.proj ?? d.projTiers?.FRONT ?? 99);
const doubleLast = (d) => (U(d.answers.setup) === 'DOUBLE' ? 1 : 0);
const trackFrontFirst = (d) => (U(d.answers.frontLayer) === 'FASCIA' ? 1 : 0);

/**
 * The traverse sheets for the leaves that carry a track — two drawings per sheet, then the track-ends sheet.
 * @param {object} p
 * @param {Array} p.choices  the RAW choices (every resolve() here normalizes them itself)
 * @param {Array} p.leaves   the traverse leaves that carry a track (see isTrackLeaf)
 */
export function traverseSheets({ choices, leaves }) {
    const byKind = { BRACKET: [], CEILING: [], ARM: [], MITER: [] };
    const seen = new Set();
    const add = (bucket, d) => { if (seen.has(d.sig)) return; seen.add(d.sig); byKind[bucket].push(d); };
    // The drive is a NOTE on each drawing and the ends sheet (Stuart 2026-09-29) — the manual leaf draws.
    const drawn = (leaves || []).filter(l => !l.drive || U(l.drive) === 'MANUAL');
    for (const leaf of drawn) {
        const model = resolve({ choices, answers: leaf, selectedIds: [] });
        const ceiling = U(leaf.mount) === 'CEILING';
        for (const arm of bracketOptions(model)) {
            add(ceiling ? 'CEILING' : 'BRACKET', drawingOf({ kind: ceiling ? 'CEILING' : 'BRACKET', choices, answers: leaf, bracket: arm }));
        }
    }
    // The ends meet the wall: drawn from the wall leaves, a double's with its track-front bracket first.
    const wallLeaves = drawn.filter(l => U(l.mount) !== 'CEILING')
        .sort((a, b) => (U(a.frontLayer) === 'FASCIA' ? 1 : 0) - (U(b.frontLayer) === 'FASCIA' ? 1 : 0));
    const endSeen = new Set();
    for (const leaf of wallLeaves) {
        const model = resolve({ choices, answers: leaf, selectedIds: [] });
        const arm = bracketOptions(model)[0];
        if (!arm) continue;
        const endSlot = (model.slots || []).find(s => s.kind === 'END' && U(s.tier || 'FRONT') === 'FRONT' && U(s.position) === 'LEFT');
        for (const r of (endSlot?.options || []).filter(o => o.role === 'RETURN')) {
            const k = [U(r.partId), U(leaf.setup), String(leaf.proj ?? '')].join('|');
            if (endSeen.has(k)) continue;
            endSeen.add(k);
            const d = drawingOf({ kind: 'RETURN', choices, answers: leaf, bracket: arm, end: r });
            add(d.isMiter ? 'MITER' : 'ARM', d);
        }
    }
    const order = (a, b) => doubleLast(a) - doubleLast(b) || projKey(a) - projKey(b) || trackFrontFirst(a) - trackFrontFirst(b);
    const sheets = [];
    for (const kind of ['BRACKET', 'CEILING', 'ARM', 'MITER']) {
        const list = byKind[kind].sort(order);
        for (let i = 0; i < list.length; i += 2) {
            const pair = list.slice(i, i + 2);
            sheets.push({
                key: `TRV__${pair.map(d => d.sig).join('+')}`,
                kind: 'TRAVERSE', group: kind,
                answers: pair[0].answers, label: leafLabel(pair[0].answers),
                // A return sheet is ABOUT its end (the arm or the miter) — the bracket only holds the rail.
                subject: kind === 'ARM' || kind === 'MITER' ? pair[0].end : pair[0].bracket, rod: null, plates: [], rings: [], riders: [],
                drawings: pair, isTraverse: true, suppressedBy: null, reason: '',
            });
        }
    }
    // ── THE TRACK ENDS, FROM BELOW (Stuart 2026-09-29: "one page at the end with a view from below that
    //    shows the difference in how the track ends are") — the manual leaf beside its motorized twin.
    const singleWall = drawn.find(l => U(l.setup) !== 'DOUBLE' && U(l.mount) !== 'CEILING') || drawn.find(l => U(l.mount) !== 'CEILING');
    if (singleWall) {
        const model = resolve({ choices, answers: singleWall, selectedIds: [] });
        const arm = bracketOptions(model)[0];
        const motorLeaf = (leaves || []).find(l => U(l.drive) === 'MOTORIZED' && U(l.setup) === U(singleWall.setup)
            && U(l.mount) === U(singleWall.mount) && String(l.proj ?? '') === String(singleWall.proj ?? '') && U(l.frontLayer) === U(singleWall.frontLayer));
        const ends = [drawingOf({ kind: 'ENDS', choices, answers: singleWall, bracket: arm })];
        if (motorLeaf) ends.push(drawingOf({ kind: 'ENDS', choices, answers: motorLeaf, bracket: arm }));
        if (arm) sheets.push({ key: 'TRV__ENDS', kind: 'TRAVERSE_ENDS', group: 'ENDS', answers: {}, label: 'track ends', subject: null, rod: null, plates: [], rings: [], riders: [], drawings: ends, isTraverse: true, suppressedBy: null, reason: '' });
    }
    return sheets;
}

/**
 * The traverse sheets' own audit — only the statements that hold in every case (an audit that fires when
 * it should not is worse than none). Returns violations in auditPages' shape.
 */
export function auditTraverse(pages, admissibleAt) {
    const out = [];
    const say = (page, part, why) => out.push({ page: page.key, subject: page.subject?.partId || '(traverse)', part: part?.partId || part?.id || '(none)', why });
    for (const page of pages || []) {
        if (page.kind !== 'TRAVERSE' && page.kind !== 'TRAVERSE_ENDS') continue;
        for (const d of page.drawings || []) {
            const g = d.groups || {};
            const tracks = Object.keys(g).filter(k => k.startsWith('TRACK'));
            if (!tracks.length) say(page, d.bracket, 'a traverse drawing with no track');
            if ((d.rings || []).length && U(d.answers.frontLayer) !== 'FASCIA') say(page, d.rings[0].choice, 'rings on a traverse drawing whose front is not the stationary rod');
            if (U(d.answers.frontLayer) === 'FASCIA' && g['TRACK/FRONT']) say(page, g['TRACK/FRONT'].choices[0], 'a front track behind a stationary rod front');
            for (const t of tracks) {
                const tier = t.split('/')[1] || '';
                if (!Object.keys(g).some(k => k.startsWith('CARRIER') && ((k.split('/')[1] || '') === tier || !(k.split('/')[1])))) say(page, g[t].choices[0], `a ${tier ? tier.toLowerCase() + ' ' : ''}track with no carriers riding it`);
            }
            const ok = admissibleAt ? admissibleAt(d.answers) : null;
            if (ok) for (const grp of Object.values(g)) for (const c of grp.choices) if (!ok.has(String(c.id))) say(page, c, `not admissible at ${leafLabel(d.answers)}`);
        }
    }
    return out;
}
