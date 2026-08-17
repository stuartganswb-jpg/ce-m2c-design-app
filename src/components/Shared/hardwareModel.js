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
const DEFAULT_FITS = {
    FINIAL: [SOLID, TRAVERSE],
    INSIDE_MOUNT: [SOLID, TRAVERSE],
    RETURN: [SOLID, TRAVERSE],
    ACCESSORY: [SOLID, TRAVERSE],
    BRACKET: [SOLID],
    BACKPLATE: [SOLID],
    RING: [SOLID],
    CARRIER: [TRAVERSE],
    FCLIP: [TRAVERSE],
};

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
        fits: fitsTag.length ? fitsTag : (DEFAULT_FITS[role] || [SOLID, TRAVERSE]),
        setup: U(input.setup),                       // '' = suits every setup
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

/** Riders: never asked, always built, whenever their rod kind is the one in play. */
export function ridersFor(choices, answers = {}) {
    const ctx = contextOf(choices, answers);
    return choices.filter(c => c.always && admits(c, ctx).ok);
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
    const on = new Set();
    const take = (c) => c.nodes.forEach(n => on.add(n));
    choices.forEach(c => { if (want.has(c.id)) take(c); });
    ridersFor(choices, answers).forEach(take);
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
        const pos = c.position || '';
        const key = `${kind}|${pos}`;
        if (!bucket.has(key)) bucket.set(key, { key, kind, position: pos, all: [], options: [], rejected: [] });
        const slot = bucket.get(key);
        slot.all.push(c);
        const v = admits(c, { ...ctx, position: pos ? pos : undefined });
        if (v.ok) slot.options.push(c); else slot.rejected.push({ choice: c, ...v });
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
    const norm = choices.map(normalizeChoice).filter(c => c.role);
    const axes = activeAxes(norm, answers);
    const ctx = contextOf(norm, answers);
    const sl = slots(norm, answers);
    const riders = ridersFor(norm, answers);
    const visible = visibleNodes(norm, answers, selectedIds);
    const ownership = nodeOwnership(norm, modelNodes);
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
        bom,
    };
}

// Problems worth a human's attention, stated so a tag is always the thing to fix. Severity is
// about consequence, not tidiness: RED means a customer cannot build or cannot see something.
export function diagnose(model) {
    const out = [];
    const add = (sev, kind, msg) => out.push({ sev, kind, msg });
    model.slots.forEach(s => {
        const where = `${s.kind}${s.position ? ` · ${s.position}` : ''}`;
        if (!s.options.length && s.all.length) {
            const byRule = {};
            s.rejected.forEach(r => { byRule[r.rule] = (byRule[r.rule] || 0) + 1; });
            const worst = Object.entries(byRule).sort((a, b) => b[1] - a[1])[0];
            add('red', 'NO OPTIONS', `${where}: all ${s.all.length} choice(s) excluded — mostly by ${worst ? `${worst[0]} (${worst[1]})` : 'unknown'}. e.g. ${s.rejected[0].choice.name}: ${s.rejected[0].detail}`);
        }
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
