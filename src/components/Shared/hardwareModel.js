// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE HARDWARE MODEL — one engine, driven by tags (Stuart 2026-08-17)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// "i need you to write the generator so that only the tags can be to blame so we can easily find
//  the bug, not chase our tail and break everything."
//
// WHY THIS EXISTS. The old path had TWO rule engines that never shared a line of code. The
// generator baked decisions at Regenerate time — which steps exist, which options are in them, and
// a frozen geometryMap of which nodes each option lights up. The CPQ runtime then re-decided the
// same things on every render from the tags: projection, mount, setup, traverse-ness, returns,
// size. Projection was implemented twice. Mount was implemented twice. They drifted, and the drift
// is what shows up as "I fixed the tag and nothing changed" or "it renders a part I didn't pick".
// Every new collection added a rule to one side or both, so every new collection broke an old one.
//
// This module is the single engine. Its ONLY inputs are the tagged choices and the current answers.
// It bakes nothing. A tag fix therefore takes effect WITHOUT regenerating — the failure mode that
// cost a weekend.
//
// TWO INVARIANTS THAT KILL WHOLE BUG CLASSES:
//
//   1. GEOMETRY IS DEFAULT-HIDDEN, and what renders is the UNION of the geometry owned by the
//      SELECTED choices (plus always-on parts). The old model was default-VISIBLE with an AND
//      across every step that named a node. Default-visible is why an unmapped node rendered in
//      every configuration forever (the "ghosts"). The AND is why two steps that each legitimately
//      claimed a node could make it permanently invisible with both of them correctly answered.
//      Union-of-selected has neither failure: a ceiling backplate is absent on a wall order because
//      it is not SELECTED, not because a second step vetoed it.
//
//   2. AXES AND THEIR VALUES ARE DISCOVERED FROM THE TAGS, never enumerated in code. If singles
//      carry three projections and doubles two, that falls out of the data. Add a fourth projection
//      to a single, or a third to a double, and it appears — no code change, no release. This is
//      the difference between a finished tool and a working experiment.
//
// NOTHING IN HERE MAY EVER KEY OFF A COLLECTION NAME, A STEP TITLE, OR AN ITEM CODE. If a rule
// cannot be expressed in the tag vocabulary below, the vocabulary is what needs extending.

// ── VOCABULARY ───────────────────────────────────────────────────────────────────────────────
// Roles are what a part IS. Everything else about how it behaves is derived from its role plus its
// own tags — never from its name.
export const ROLES = [
    'ROD',          // a solid rod/pole: steel, wood, acrylic
    'FASCIA',       // traverse system: the face, in front
    'TRACK',        // traverse system: the extrusion behind the fascia
    'CARRIER',      // rides inside a track/traverse rod. never chosen, always built
    'FCLIP',        // attaches track to fascia. never chosen, always built
    'TRV_END',      // the traverse end — a REAL part that differs by drive, so picking one picks
                    // the drive. Kept as its own role because tagging it TRACK once put it in the
                    // track picker beside the extrusion and left the drive as a label with no part
                    // behind it: nothing to bill, nothing to render.
    'BRACKET',
    'BACKPLATE',
    'RING',
    'FINIAL',
    'INSIDE_MOUNT',
    'RETURN',       // french / miter / bent
    'ACCESSORY',    // billed, never asked
];

// The roles that ARE the rod — the answer that sets the world everything else lives in.
export const ROD_ROLES = ['ROD', 'FASCIA', 'TRACK'];
// Never a question: built and billed whenever their rod kind is active.
export const RIDER_ROLES = ['CARRIER', 'FCLIP'];

// Rod kinds. Open on purpose: a third kind is a tag, not a release.
export const SOLID = 'SOLID';
export const TRAVERSE = 'TRAVERSE';

// WHAT AN ATTACHMENT FITS, WHEN IT DOES NOT SAY (Stuart's rules, 2026-08-17):
//   "Traverse rods means carriers and their own sets of brackets and backplates and returns.
//    all other rods use the same brackets/backplates and rings.
//    all share the same finials and inside mounts."
// So: finials and inside mounts are shared BY DEFINITION and need no tag. Brackets, backplates and
// rings belong to the solid world unless a tag says otherwise — which is what makes a traverse
// unit's own arms opt IN rather than every solid bracket having to opt out. Carriers and f-clips
// are traverse-only, by role.
// ⚠ CORRECTED 2026-08-17 by shadow-running H1-2TRV, the one collection that works. The first cut
// hardcoded BRACKET → [SOLID], and H1-2TRV's brackets are UNTAGGED — because that whole assembly is
// traverse, there was never anything to distinguish them FROM. The engine duly reported all five
// brackets at every position as excluded, on a flow that renders perfectly. A hardcoded assumption
// about what a role fits is exactly the thing this engine was built not to have.
//
// THE RULE, WHICH IS DATA-DRIVEN: a tag only becomes EXCLUSIVE when it is actually used to
// distinguish. Resolved per role, per assembly, in applyFitsDefaults() below:
//   • the assembly offers ONE rod world  → every attachment serves it. Nothing can be exclusive
//     when there is nothing to be exclusive against. (H1-2TRV, and every pole-only collection.)
//   • the assembly offers SEVERAL, and some choices of a role carry a tag → the tagged ones are
//     exclusive and the untagged ones take the COMPLEMENT. (H1-138: trv:bracket arms are
//     traverse-only, so the untagged arms are the solid ones.)
//   • the assembly offers several and NO choice of that role carries a tag → no distinction was
//     drawn, so they serve every world. Erring toward offering, because a wrongly-offered part is
//     visible and fixable while a wrongly-hidden one is invisible.
//
// Only the roles whose world is intrinsic keep a fixed answer: a carrier rides inside a track and
// cannot mean anything on a solid rod.
const DEFAULT_FITS = {
    CARRIER: [TRAVERSE],
    FCLIP: [TRAVERSE],
    TRV_END: [TRAVERSE],
};

/**
 * Fill in what each attachment fits, from what the assembly actually distinguishes.
 * Runs once per resolve, before any gate sees a choice.
 */
export function applyFitsDefaults(choices) {
    const worlds = [...new Set(choices.filter(c => ROD_ROLES.includes(c.role)).map(c => c.rodKind).filter(Boolean))];
    if (!worlds.length) return choices;
    const claimed = {};   // role -> Set(worlds explicitly claimed by a tagged sibling)
    choices.forEach(c => {
        if (ROD_ROLES.includes(c.role) || !c.fitsExplicit) return;
        (claimed[c.role] = claimed[c.role] || new Set());
        c.fits.forEach(f => claimed[c.role].add(f));
    });
    return choices.map(c => {
        if (ROD_ROLES.includes(c.role) || c.fitsExplicit) return c;
        if (DEFAULT_FITS[c.role]) return { ...c, fits: DEFAULT_FITS[c.role] };
        if (worlds.length === 1) return { ...c, fits: worlds };
        const taken = claimed[c.role];
        if (!taken || !taken.size) return { ...c, fits: worlds };
        const complement = worlds.filter(w => !taken.has(w));
        return { ...c, fits: complement.length ? complement : worlds };
    });
}

// ── THE ROD IS ONE DECISION; ITS SEGMENTS ARE GEOMETRY (Stuart 2026-08-17) ────────────────────
// "we decided on only two pole/fascia options … we will load the 3 piece poles or just one single
//  long rod … if a ball finial is on the left then the left node is selected, and if a return is on
//  the right then the short center is shown; if both sides are returns then only the short center
//  pole is used. for assemblies with only 1 long rod there are no returns, so just finials."
//
// A three-piece pole is pinned as LEFT / CENTER / RIGHT, which the model was reading as four
// separate questions offering the same part. It is ONE part. Which of its pieces render is not a
// customer decision at all — it follows from the ends, because a return bends back and needs the
// shorter pole:
//   • the CENTRE (short) piece renders whenever the rod is chosen;
//   • an END piece renders when that end's treatment is chosen and is NOT a return.
// A single-rod assembly has no end pieces, so it simply renders whole.
//
// The tag names for this grew over weeks — shared rod, short rod, center — so the SEGMENT is read
// from the canonical position and everything that is not LEFT/RIGHT counts as core. Renaming tags
// later cannot break it.
export const segmentOf = (choice) => (choice.position === 'LEFT' || choice.position === 'RIGHT') ? choice.position : 'CORE';
const END_ROLES = ['FINIAL', 'INSIDE_MOUNT', 'RETURN'];

/** Does this end have a chosen treatment, and is it a return? */
function endState(selected, pos) {
    const picks = selected.filter(c => c.position === pos && END_ROLES.includes(c.role));
    return { answered: picks.length > 0, isReturn: picks.some(c => c.role === 'RETURN') };
}

// MOUNT IS A PROPERTY OF MOUNTING HARDWARE, AND BLANK MEANS WALL (Stuart 2026-08-15: "all the
// wall brackets are left with no tag, as they are the default"). Two halves to that rule, and both
// matter:
//   • On a bracket or backplate, blank reads WALL — so the untagged majority stays wall-only and a
//     ceiling order does not silently offer wall arms beside the ceiling ones.
//   • On everything else, mount is NOT A FILTER AT ALL. A finial does not attach to a wall or a
//     ceiling, so an untagged finial must never be excluded by a ceiling answer. Treating blank as
//     WALL everywhere would delete the shared parts from every ceiling order.
export const MOUNTED_ROLES = ['BRACKET', 'BACKPLATE'];

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();

// A projection (or any measure tag) compared by VALUE, not spelling: 3-5/8, 3.625 and "3.625 in"
// are one projection. Returns null when there is no usable number, which reads as "untagged".
export const measureOf = (v) => {
    const raw = String(v == null ? '' : v).trim();
    if (!raw) return null;
    // mixed numbers first: 3-5/8 or 3 5/8
    const mixed = raw.match(/^(\d+)\s*[-\s]\s*(\d+)\s*\/\s*(\d+)/);
    if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
    const frac = raw.match(/^(\d+)\s*\/\s*(\d+)/);
    if (frac) return Number(frac[1]) / Number(frac[2]);
    const dec = raw.match(/-?\d*\.?\d+/);
    if (!dec) return null;
    const n = Number(dec[0]);
    return Number.isFinite(n) ? n : null;
};
const sameMeasure = (a, b) => a != null && b != null && Math.abs(a - b) < 0.01;

// ── THE CHOICE ───────────────────────────────────────────────────────────────────────────────
// One pinned part with its tags. Everything the engine knows comes from here; there is no second
// source. `raw` keeps the original record so callers can price and BOM without a second lookup.
export function normalizeChoice(input = {}) {
    const role = ROLES.includes(U(input.role)) ? U(input.role) : '';
    const fitsTag = []
        .concat(input.fits || [])
        .map(U)
        .filter(f => f === SOLID || f === TRAVERSE);
    return {
        id: String(input.id || input.optId || input.partId || ''),
        partId: String(input.partId || ''),
        name: String(input.name || input.partName || input.id || ''),
        role,
        nodes: []
            .concat(input.nodes || [])
            .map(n => String(n || '').trim())
            .filter(Boolean),
        // A rod declares its kind. Anything else declares what it fits.
        rodKind: ROD_ROLES.includes(role)
            ? (U(input.rodKind) === TRAVERSE || role === 'FASCIA' || role === 'TRACK' ? TRAVERSE : SOLID)
            : '',
        // Left as the raw tag. What an UNTAGGED attachment fits is decided per assembly by
        // applyFitsDefaults(), because it depends on what the assembly distinguishes.
        fits: fitsTag.length ? fitsTag : (DEFAULT_FITS[role] || [SOLID, TRAVERSE]),
        fitsExplicit: fitsTag.length > 0,
        setup: U(input.setup),                       // '' = suits every setup
        drive: U(input.drive),                       // '' = suits every drive (a fascia is a fascia)
        proj: measureOf(input.proj),                 // null = suits every projection
        // How this part reads its projection tag. Returns need a MINIMUM depth to be possible;
        // a bracket IS its projection. Defaulted by role, overridable by tag so a collection with
        // a different physical truth never needs a code change.
        projRule: U(input.projRule) || (role === 'RETURN' ? 'MIN' : 'EXACT'),
        // Blank on mounting hardware = WALL; blank on anything else = not filtered by mount.
        mount: U(input.mount) || (MOUNTED_ROLES.includes(role) ? 'WALL' : ''),
        position: U(input.position),                 // '' = shared across positions
        always: input.always === true || RIDER_ROLES.includes(role),
        qty: Number(input.qty) > 0 ? Number(input.qty) : 1,
        price: Number(input.price) || 0,
        raw: input.raw !== undefined ? input.raw : input,
    };
}

// ── THE AXES ─────────────────────────────────────────────────────────────────────────────────
// A question the assembly can ask. Its VALUES are discovered from whatever is tagged, so the
// vocabulary grows by tagging. Adding an axis later is one entry here — adding a value is nothing.
//
// `scope` decides which choices vote on the values. Projection is scoped to the parts that are
// still admissible under the answers ABOVE it, which is exactly why "singles have 3 projections,
// doubles have 2" needs no special case: on a double, only double brackets vote.
export const AXES = [
    { key: 'rodKind', label: 'Rod Type', tag: 'rodKind', order: 10, scope: 'rods' },
    { key: 'setup', label: 'Single or Double', tag: 'setup', order: 20, scope: 'admissible' },
    // Motorised vs manual. Asked only where BOTH exist — a manual-only collection must not grow a
    // question with one answer, which is exactly what discovery gives us for free.
    { key: 'drive', label: 'Drive', tag: 'drive', order: 25, scope: 'admissible' },
    { key: 'mount', label: 'Mount', tag: 'mount', order: 30, scope: 'admissible' },
    { key: 'proj', label: 'Bracket Projection', tag: 'proj', order: 40, scope: 'admissible' },
];

// A CONSTRAINT IS NOT AN OPTION. Only a part that IS a value votes for it; a part that merely
// REQUIRES AT LEAST that value does not create it. A french return tagged 4-5/8" means "I need at
// least this much depth" — counting it would offer a 4-5/8" projection on an assembly whose
// brackets only come at 3-5/8", which is a projection you cannot actually build. (The old
// generator learned this the same way: phantom projection cards conjured out of return minimums.)
const axisValueOf = (choice, axis) => {
    if (axis.key === 'rodKind') return choice.rodKind || '';
    if (axis.key === 'proj') return (choice.proj == null || choice.projRule === 'MIN') ? '' : choice.proj;
    return choice[axis.key] || '';
};

/**
 * The values an axis can actually take, given the answers already given.
 *
 * Untagged choices vote for NOTHING — they suit every value, so they must not create one. A pool
 * where every part is untagged therefore yields zero values, and the axis is not asked: a question
 * with one answer, or none, is not a question.
 */
export function axisValues(choices, axis, ctx = {}) {
    const pool = axis.scope === 'rods'
        ? choices.filter(c => ROD_ROLES.includes(c.role))
        : choices.filter(c => !ROD_ROLES.includes(c.role) && !c.always && admits(c, ctx, { ignore: [axis.key] }).ok);
    const seen = new Map();
    pool.forEach(c => {
        const v = axisValueOf(c, axis);
        if (v === '' || v == null) return;
        const key = typeof v === 'number' ? v.toFixed(3) : v;
        if (!seen.has(key)) seen.set(key, v);
    });
    return [...seen.values()].sort((a, b) => (typeof a === 'number' && typeof b === 'number') ? a - b : String(a).localeCompare(String(b)));
}

/** The axes this assembly genuinely asks, in order, each with its live values. */
export function activeAxes(choices, answers = {}) {
    const out = [];
    [...AXES].sort((a, b) => a.order - b.order).forEach(axis => {
        // Each axis is measured under the answers ABOVE it only, so the questions cascade.
        const ctx = {};
        out.forEach(a => { ctx[a.key] = answers[a.key]; });
        const values = axisValues(choices, axis, ctx);
        if (values.length >= 2) out.push({ ...axis, values });
        else if (values.length === 1) out.push({ ...axis, values, implied: true });
    });
    return out;
}

// ── THE GATE ─────────────────────────────────────────────────────────────────────────────────
// ONE function decides whether a choice is admissible. Everything that filters anywhere in the app
// must come through here, so there can never again be two answers to the same question.
//
// Returns a REASON on refusal, because "5 options, none survive" is a true and useless statement —
// naming the rule is the difference between fixing a tag and chasing your tail.
export function admits(choice, ctx = {}, { ignore = [] } = {}) {
    const skip = (k) => ignore.includes(k);
    const no = (rule, detail) => ({ ok: false, rule, detail });

    // THE ROD ANSWER SWITCHES THE ROD SLOTS THEMSELVES (Stuart 2026-08-17, the target shape for a
    // combined H1: "a fascia appears in front of a track when used with track, or we turn off the
    // track and use rings"). A fascia and a track are two QUESTIONS that both belong to the
    // traverse world; a solid rod is one question in the other. So once the world is chosen, the
    // other world's rods stop being asked about — otherwise a combined family would ask for a
    // fascia on a steel-rod-and-rings order.
    //
    // Discovery is deliberately exempt: axisValues() reads rod choices directly rather than through
    // this gate, so the rod question can always see every world it could offer.
    if (ROD_ROLES.includes(choice.role)) {
        if (!skip('rodKind') && ctx.rodKind && choice.rodKind && choice.rodKind !== ctx.rodKind) {
            return no('rod type', `this is a ${choice.rodKind} rod, the order is ${ctx.rodKind}`);
        }
    } else {
        if (!skip('rodKind') && ctx.rodKind && !choice.fits.includes(ctx.rodKind)) {
            return no('rod type', `fits ${choice.fits.join('/')}, the selected rod is ${ctx.rodKind}`);
        }
    }
    if (!skip('setup') && ctx.setup && choice.setup && choice.setup !== ctx.setup) {
        return no('setup', `tagged ${choice.setup}, this order is ${ctx.setup}`);
    }
    if (!skip('drive') && ctx.drive && choice.drive && choice.drive !== ctx.drive) {
        return no('drive', `tagged ${choice.drive}, this order is ${ctx.drive}`);
    }
    if (!skip('mount') && ctx.mount && choice.mount && choice.mount !== ctx.mount) {
        return no('mount', `tagged ${choice.mount}, this order is ${ctx.mount}`);
    }
    if (!skip('proj') && ctx.proj != null && choice.proj != null) {
        // A return needs AT LEAST its tagged depth; a bracket IS its projection.
        const ok = choice.projRule === 'MIN' ? ctx.proj >= choice.proj - 0.01 : sameMeasure(choice.proj, ctx.proj);
        if (!ok) {
            return no('projection', choice.projRule === 'MIN'
                ? `needs at least ${choice.proj}", this order is ${ctx.proj}"`
                : `built for ${choice.proj}", this order is ${ctx.proj}"`);
        }
    }
    if (!skip('position') && ctx.position && choice.position && choice.position !== ctx.position) {
        return no('position', `tagged ${choice.position}, this slot is ${ctx.position}`);
    }
    return { ok: true };
}

// ── RESOLUTION ───────────────────────────────────────────────────────────────────────────────

/** The context the answers describe: what world are we building in right now. */
export function contextOf(choices, answers = {}) {
    const ctx = {};
    activeAxes(choices, answers).forEach(axis => {
        // An axis with a single possible value is IMPLIED — it constrains without being asked, so a
        // one-mount assembly still filters correctly and never shows a pointless question.
        const answered = answers[axis.key];
        ctx[axis.key] = (answered !== undefined && answered !== '' && answered !== null)
            ? answered
            : (axis.implied ? axis.values[0] : undefined);
    });
    return ctx;
}

/**
 * Every choice, judged. `in` = offered here; `out` carries the rule that excluded it.
 *
 * This is the whole diagnostic surface: a flow can only misbehave because a tag is wrong or
 * because this function is wrong, and the second is one file.
 */
export function judge(choices, answers = {}, { position } = {}) {
    const ctx = { ...contextOf(choices, answers), ...(position ? { position } : {}) };
    const inn = [], out = [];
    choices.forEach(c => {
        const v = admits(c, ctx);
        (v.ok ? inn : out).push({ choice: c, ...v });
    });
    return { ctx, in: inn.map(x => x.choice), out };
}

/**
 * Riders: never asked, always built — but only once a rod they belong to is actually CHOSEN.
 *
 * ⚠ Stuart 2026-08-17, first run of the new configurator: "screen loads with traverse carriers
 * visible, they should [be] tagged always but only with Traverse rod." He is right, and "always"
 * was doing too much work. A carrier rides INSIDE a track; with no rod chosen there is nothing for
 * it to ride, so on a blank screen it must not be there. Reading `always` as "present from the
 * first frame" reintroduced exactly the thing additive rendering exists to prevent — geometry on
 * screen that nobody picked.
 *
 * So a rider rides when a SELECTED rod admits it. That is purely additive: nothing chosen, nothing
 * rendered; choose the traverse rod and its carriers arrive with it; choose a solid rod and they
 * stay away because a carrier does not fit a solid rod.
 */
export function ridersFor(choices, answers = {}, selectedIds = []) {
    const ctx = contextOf(choices, answers);
    const want = new Set((selectedIds || []).filter(Boolean).map(String));
    const chosenWorlds = new Set(choices
        .filter(c => want.has(c.id) && ROD_ROLES.includes(c.role) && c.rodKind)
        .map(c => c.rodKind));
    if (!chosenWorlds.size) return [];
    return choices.filter(c => c.always && admits(c, ctx).ok && c.fits.some(f => chosenWorlds.has(f)));
}

/**
 * WHAT RENDERS. The union of the geometry owned by the selected choices, plus the riders.
 *
 * `selectedIds` is whatever the customer has answered — one id per slot. Nothing else contributes,
 * and nothing subtracts: there is no veto, so no combination of correct answers can make a selected
 * part invisible. A node no choice owns simply does not render, and is reported as untagged rather
 * than appearing in every configuration.
 */
export function visibleNodes(choices, answers = {}, selectedIds = []) {
    const want = new Set(selectedIds.filter(Boolean).map(String));
    const selected = choices.filter(c => want.has(c.id));
    const on = new Set();
    const take = (c) => c.nodes.forEach(n => on.add(n));
    const left = endState(selected, 'LEFT');
    const right = endState(selected, 'RIGHT');
    // A chosen ROD brings every segment of the SAME PART, each judged by its own end.
    const segmentShows = (seg) => {
        if (seg === 'CORE') return true;
        const e = seg === 'LEFT' ? left : right;
        return e.answered && !e.isReturn;
    };
    selected.forEach(c => {
        if (!ROD_ROLES.includes(c.role)) { take(c); return; }
        choices
            .filter(x => ROD_ROLES.includes(x.role) && x.partId && x.partId === c.partId)
            .forEach(seg => { if (segmentShows(segmentOf(seg))) take(seg); });
        if (!c.partId) take(c);   // an unidentified rod is only ever itself
    });
    ridersFor(choices, answers, selectedIds).forEach(take);
    return on;
}

/**
 * Every node the model contains, attributed to its owner — or flagged unowned.
 *
 * Under default-hidden an unowned node is invisible rather than a ghost, so this is a TAGGING
 * report, not a rendering emergency. It is still the first thing to read when a part never appears.
 */
export function nodeOwnership(choices, modelNodes = []) {
    const owner = new Map();
    choices.forEach(c => c.nodes.forEach(n => { if (!owner.has(n)) owner.set(n, c); }));
    const unowned = modelNodes.filter(n => !owner.has(n));
    const missing = [];
    const present = new Set(modelNodes);
    if (modelNodes.length) {
        choices.forEach(c => c.nodes.forEach(n => { if (!present.has(n)) missing.push({ node: n, choice: c }); }));
    }
    return { owner, unowned, missing };
}

// ── THE SLOTS (questions with parts behind them) ─────────────────────────────────────────────
// A slot is one decision the customer makes about one place on the product. Slots come from the
// DATA: the distinct (role, position) pairs present. No step titles are matched, no collection is
// named, and a new position or role appears the moment something is tagged with it.
export const SLOT_ORDER = ['ROD', 'FASCIA', 'TRACK', 'FINIAL', 'INSIDE_MOUNT', 'RETURN', 'BRACKET', 'BACKPLATE', 'RING', 'ACCESSORY'];
const POSITION_ORDER = ['LEFT', 'CENTER', 'RIGHT', 'FRONT', 'BACK', ''];

/**
 * END TREATMENT IS ONE DECISION, NOT THREE (Stuart: "all share the same finials and inside
 * mounts"). A finial, an inside mount and a return are alternatives for the same place, so they
 * pool into one slot per end rather than three competing steps that can each hide the others.
 */
const SLOT_OF_ROLE = (role) => (['FINIAL', 'INSIDE_MOUNT', 'RETURN'].includes(role) ? 'END' : role);

export function slots(choices, answers = {}) {
    const ctx = contextOf(choices, answers);
    const bucket = new Map();
    choices.forEach(c => {
        if (c.always) return;                       // riders are never a question
        const kind = SLOT_OF_ROLE(c.role);
        if (!kind) return;
        // A rod pinned per position is ONE part in three pieces, not three questions. Its pieces
        // are resolved by visibleNodes from the ends; here it collapses to a single decision.
        const pos = ROD_ROLES.includes(c.role) ? '' : (c.position || '');
        const key = `${kind}|${pos}`;
        if (!bucket.has(key)) bucket.set(key, { key, kind, position: pos, all: [], options: [], rejected: [] });
        const slot = bucket.get(key);
        slot.all.push(c);
        const v = admits(c, { ...ctx, position: pos ? pos : undefined });
        if (v.ok) slot.options.push(c); else slot.rejected.push({ choice: c, ...v });
    });
    // …and offered once per PART, however many pieces it is pinned as.
    bucket.forEach(slot => {
        if (!ROD_ROLES.includes(slot.all[0]?.role)) return;
        const seen = new Set();
        slot.options = slot.options.filter(o => {
            const k = String(o.partId || o.id).toUpperCase();
            if (seen.has(k)) return false;
            seen.add(k); return true;
        });
    });
    const rank = (s) => {
        const k = SLOT_ORDER.indexOf(s.kind === 'END' ? 'FINIAL' : s.kind);
        const p = POSITION_ORDER.indexOf(s.position);
        return (k < 0 ? 99 : k) * 100 + (p < 0 ? 99 : p);
    };
    return [...bucket.values()].sort((a, b) => rank(a) - rank(b));
}

/**
 * THE ONE ENTRY POINT. Everything — the generator, the configurator, the portal, the spec sheet —
 * calls this and nothing else, which is what makes it impossible for two surfaces to disagree.
 */
export function resolve({ choices = [], answers = {}, selectedIds = [], modelNodes = [] } = {}) {
    const norm = applyFitsDefaults(choices.map(normalizeChoice).filter(c => c.role));
    const axes = activeAxes(norm, answers);
    const ctx = contextOf(norm, answers);
    const sl = slots(norm, answers);
    const riders = ridersFor(norm, answers, selectedIds);
    const visible = visibleNodes(norm, answers, selectedIds);
    const ownership = nodeOwnership(norm, modelNodes);
    const selected = norm.filter(c => selectedIds.includes(c.id));
    const bom = [
        ...norm.filter(c => selectedIds.includes(c.id)),
        ...riders,
    ].map(c => ({ partId: c.partId, name: c.name, qty: c.qty, price: c.price, raw: c.raw }));
    return {
        choices: norm,
        axes,          // the questions, with their discovered values
        ctx,           // what those answers mean
        slots: sl,     // the per-place decisions, each with its live options + why the rest are out
        riders,        // built, never asked
        visible,       // Set of node names that render. Everything else is hidden.
        ownership,     // node -> owning choice; unowned nodes; mapped names the model lacks
        selected,      // the chosen parts themselves, for coherence checks
        bom,
    };
}

// Problems worth a human's attention, stated so a tag is always the thing to fix. Severity is
// about consequence, not tidiness: RED means a customer cannot build or cannot see something.
export function diagnose(model) {
    const out = [];
    const add = (sev, kind, msg) => out.push({ sev, kind, msg });
    // A SLOT THAT BELONGS TO ANOTHER WORLD IS ABSENT, NOT BROKEN (2026-08-17, from shadow-running
    // H1-138 and H1-2TRV). The world axes — which rod, single or double, which drive — decide which
    // slots EXIST. Choose a solid rod and the fascia slot is not empty, it is simply not part of
    // this product; choose a single and the double-only rear track is not missing, it is not there.
    // Reporting those as faults is how a diagnostic teaches people to ignore it.
    //
    // The detail axes — projection, mount — choose AMONG a slot's options. If they leave a slot
    // with nothing, that IS a fault: the customer is in this world and needs that part.
    const WORLD_RULES = ['rod type', 'setup', 'drive'];
    model.slots.forEach(s => {
        const where = `${s.kind}${s.position ? ` · ${s.position}` : ''}`;
        if (!s.options.length && s.all.length) {
            if (s.rejected.every(r => WORLD_RULES.includes(r.rule))) return;  // absent by design
            const byRule = {};
            s.rejected.forEach(r => { byRule[r.rule] = (byRule[r.rule] || 0) + 1; });
            const worst = Object.entries(byRule).sort((a, b) => b[1] - a[1])[0];
            const lead = s.rejected.find(r => !WORLD_RULES.includes(r.rule)) || s.rejected[0];
            add('red', 'NO OPTIONS', `${where}: all ${s.all.length} choice(s) excluded — mostly by ${worst ? `${worst[0]} (${worst[1]})` : 'unknown'}. e.g. ${lead.choice.name}: ${lead.detail}`);
        }
    });
    // ── THE PARTS CHOSEN MUST AGREE WITH EACH OTHER (Stuart 2026-08-17, H1-138: "even on initial
    // display of 3-5/8 brackets not aligned with backplates") ────────────────────────────────────
    // Every gate so far asks whether an option is allowed. NOTHING asked whether the options
    // chosen TOGETHER describe one buildable product. An arm built for 3-5/8" beside a plate built
    // for 4-5/8" passes every individual rule and sits on a different wall plane — which is exactly
    // what "not aligned" looks like, and why the flow can report itself healthy while the render is
    // visibly wrong. Detail axes only: the world axes cannot disagree, they are one answer.
    ['proj', 'mount'].forEach(axis => {
        const seen = new Map();
        (model.selected || []).forEach(c => {
            const v = c[axis];
            if (v == null || v === '') return;
            const k = typeof v === 'number' ? v.toFixed(3) : v;
            if (!seen.has(k)) seen.set(k, []);
            seen.get(k).push(c);
        });
        if (seen.size < 2) return;
        const groups = [...seen.entries()].sort((a, b) => b[1].length - a[1].length);
        const [odd] = groups.slice(-1);
        const [main] = groups;
        add('red', 'MISMATCH', `the chosen parts disagree on ${axis}: ${groups.map(([k, cs]) => `${k} (${cs.map(c => c.name).join(', ')})`).join(' vs ')}. ${odd[1][0].name} is built for a different ${axis} than ${main[1][0].name} — they will not sit together.`);
    });
    model.ownership.unowned.forEach(n => add('amber', 'UNTAGGED GEOMETRY', `${n}: no choice claims this node, so it never renders. Tag it in 1.6 or remove it.`));
    if (model.ownership.missing.length) {
        const m = model.ownership.missing;
        add('red', 'MISSING GEOMETRY', `${m.length} tagged node name(s) are not in the model — e.g. "${m[0].node}" (${m[0].choice.name}). The choice will price but render nothing.`);
    }
    model.choices.forEach(c => {
        if (!c.always && !ROD_ROLES.includes(c.role) && !c.nodes.length && c.partId) {
            add('amber', 'NO GEOMETRY', `${c.name}: a real part with no nodes — it bills but cannot appear.`);
        }
    });
    return out;
}
