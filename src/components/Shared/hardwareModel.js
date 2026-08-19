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
// ── TIER vs POSITION (Stuart 2026-08-17, planning the doubles) ────────────────────────────────
// "for future doubles … we will just add more projection tags and control what is the front
//  (longest projection) … we will need to add finials for the new rods that will be in the back."
//
// The second half is exactly right and the first half is a trap, so the vocabulary gains ONE word
// instead. FRONT / BACK is a TIER — WHICH ROD of a double a part belongs to. LEFT / CENTER / RIGHT
// is a POSITION — WHERE ALONG one rod a piece sits. They are different questions, and a back rod's
// left finial answers both at once, which is why they cannot keep sharing a field.
//
// Projection cannot stand in for tier: `proj` means "this part is MADE IN these depths" and drives
// a question with ONE answer per order. Tagging the back rod 4-5/8" and the front 6" would offer
// them as ALTERNATIVES — pick one and the other rod vanishes from the order. A double is not
// 4-5/8" or 6"; it is both, at once, on one bracket.
export const TIER_POSITIONS = ['FRONT', 'BACK'];

// ── A DOUBLE BRACKET PRESENTS TWO DEPTHS AT ONCE (Stuart 2026-08-17) ─────────────────────────
// "how do we handle the situation coming up where there are two different double bracket options
//  and each one has a different projection both of the front rod and the rear?"
//
// This is the case that breaks projection as it has always worked. On a single, projection is ONE
// answer for the order — "4-5/8 off the wall" — and every part is filtered by it. A double bracket
// does not have a projection; it has TWO, one per rod, and they arrive together as a property of
// that bracket. Two bracket options are then two PAIRS: 6"/3-5/8" or 8"/4-5/8". Asking "what
// projection" cannot express that, and listing both numbers on the bracket makes them read as
// alternatives — the bracket would appear at 6" and again at 3-5/8", each time filtered against
// the wrong rod.
//
// So on a tiered assembly the BRACKET IS THE PROJECTION QUESTION. Tag the bracket per tier —
// "FRONT:6, BACK:3-5/8" in the same projection field — and:
//   • it stops voting for values in the projection axis, which then has nothing to ask and
//     disappears, because choosing the bracket already answers it;
//   • it is asked BEFORE the ends, since it is what gates them;
//   • each tier's parts are judged against THAT TIER's depth, so a return that needs 6" is offered
//     on the front rod and refused on the back, off one bracket choice.
// Untiered assemblies never see any of this: nothing is tagged per tier, so nothing changes.
export function parseProjTiers(raw) {
    const out = {};
    String(raw == null ? '' : raw).split(',').forEach(part => {
        const bits = String(part).split(':');
        if (bits.length < 2) return;
        const tier = String(bits[0] || '').trim().toUpperCase();
        if (!TIER_POSITIONS.includes(tier)) return;
        const v = measureOf(bits.slice(1).join(':'));
        if (v != null) out[tier] = v;
    });
    return out;
}

// WHAT A TIER SPLITS, AND WHAT IT DOES NOT. A double has two rods, so it has two of everything
// that DRESSES a rod — the rod, its ends, its rings. It does NOT have two of everything that CARRIES
// the rods: one bracket arm holds both, on one backplate, at one projection. Splitting those would
// ask for the same physical bracket twice and bill it twice.
const TIERED_ROLES = [...ROD_ROLES, 'FINIAL', 'INSIDE_MOUNT', 'RETURN', 'RING', 'TRV_END'];
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
// AN END, PER ROD — EXCEPT WHEN THE END IS THE MOUNT (Stuart 2026-08-18) ──────────────────────
// "the rear rod on the french return terminates directly into the bent portion of the front rod …
//  the rear rod is affixed to each return and follows the same rules with no left or right
//  brackets as the front french return does the lifting for both."
//
// So the two kinds of end treatment behave differently on a double, and the difference is not
// arbitrary — it is what they ARE:
//
//   A FINIAL DRESSES ONE ROD. Each rod gets its own, they can differ, and the question is asked
//     once per rod. Tier-scoped.
//   A RETURN OR INSIDE MOUNT IS THE MOUNT AT THAT END. It carries every rod there — that is why
//     it replaces the bracket — so it applies to the whole assembly at that end, whichever rod it
//     was pinned on. Not tier-scoped, in either direction: the rear rod ends into the front rod's
//     bend, and neither rod is offered a second end treatment there.
function endState(selected, pos, tier = '') {
    const here = selected.filter(c => c.position === pos && END_ROLES.includes(c.role));
    // The mount at this end belongs to the assembly, not to one rod.
    const isReturn = here.some(c => c.role === 'RETURN');
    const mine = here.filter(c => !tier || !c.tier || c.tier === tier);
    return { answered: mine.length > 0 || isReturn, isReturn };
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

// A PART IS AVAILABLE AT SEVERAL PROJECTIONS (Stuart 2026-08-17): "can you make that one multi
// select so we select all the ones it is available in — as in this case the 1-3/8 diameter it is
// only available in 6 but a .75 pole is available in 4-5/8."
//
// This replaces the MINIMUM-depth rule that returns read their single tag by. That rule existed
// only because availability could not be EXPRESSED: one value had to stand in for "this and
// everything deeper". Now the designer lists exactly the projections a part is made in — more
// precise, and in Stuart's words "not rule based, too easy to break down the line". Blank still
// means every projection.
export const measureList = (v) => {
    if (v == null || v === '') return [];
    const parts = Array.isArray(v) ? v : String(v).split(/[,;|]+/);
    const out = [];
    parts.forEach(x => { const n = measureOf(x); if (n != null && !out.some(y => sameMeasure(y, n))) out.push(n); });
    return out.sort((a, b) => a - b);
};

// ── THE CHOICE ───────────────────────────────────────────────────────────────────────────────
// One pinned part with its tags. Everything the engine knows comes from here; there is no second
// source. `raw` keeps the original record so callers can price and BOM without a second lookup.
export function normalizeChoice(input = {}) {
    let role = ROLES.includes(U(input.role)) ? U(input.role) : '';
    // AN INSIDE MOUNT IS AN END TREATMENT, NOT A MOUNT (Stuart 2026-08-17). It was appearing as a
    // value on the global Mount axis beside Wall and Ceiling, because that is how it is tagged —
    // but a bracket that mounts INSIDE the window carries the rod at that end and rules out every
    // other treatment there. It belongs beside the finials and returns, where the one-pick rule
    // already gives "no other end choice for that side" for free and the bracket-replacing rule
    // already removes that end's bracket.
    //
    // So a bracket or backplate tagged for an inside/end mount is READ as an inside mount and stops
    // voting on the mount axis, leaving Wall and Ceiling — the two ways a bracket actually attaches.
    // One rule, in tags that already exist, rather than moving pins by hand.
    const mountTag = U(input.mount);
    if (/INSIDE|^END$/.test(mountTag) && (role === 'BRACKET' || role === 'BACKPLATE')) role = 'INSIDE_MOUNT';
    // ⚠ BASIC MEANS ONE PIECE (Stuart 2026-08-17): "by nature a basic bracket (tagged) means it is
    // one piece — arm and backplate are combined into one simple piece, so that basic tag needs to
    // be watched, not whether it is an arm or a base."
    //
    // So it is not an arm that happens to skip its plate: the plate IS the part. Whatever cluster it
    // was filed under, a one-piece mounting part is the BRACKET decision — otherwise a basic tagged
    // on a backplate cluster would sit in the plate picker, offering the customer a plate to go with
    // the plate. The tag is watched; the category is not.
    if (input.isBasic === true && (role === 'BACKPLATE' || role === 'BRACKET')) role = 'BRACKET';
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
        // WHICH ROD OF A DOUBLE THIS BELONGS TO. Separate from position on purpose: a back rod's
        // LEFT piece is BACK **and** LEFT, and one field cannot hold both. Tagging tier on the pin
        // is the clean path; a part pinned FRONT/BACK in the position field is read as a tier and
        // its position cleared, so the collections already tagged that way keep working.
        tier: TIER_POSITIONS.includes(U(input.tier)) ? U(input.tier)
            : (TIER_POSITIONS.includes(U(input.position)) ? U(input.position) : ''),
        setup: U(input.setup),                       // '' = suits every setup
        // Tri-state, and only carried when actually tagged — undefined means "let the role and the
        // position decide" (see carriesRings), which is the normal case for every existing pin.
        ...(input.carriesRings === true || input.carriesRings === false ? { carriesRings: input.carriesRings } : {}),
        drive: U(input.drive),                       // '' = suits every drive (a fascia is a fascia)
        // A per-tier tag is NOT a list of alternatives, so it never lands in `projs` — otherwise a
        // double bracket would appear once per depth, each time judged against the wrong rod.
        projs: Object.keys(parseProjTiers(input.proj)).length ? [] : measureList(input.proj),
        ...(Object.keys(parseProjTiers(input.proj)).length ? { projTiers: parseProjTiers(input.proj) } : {}),
        // Blank on mounting hardware = WALL; blank on anything else = not filtered by mount.
        // ⚠ ONLY MOUNTING HARDWARE CARRIES A MOUNT (Stuart 2026-08-17: "when i switch to inside
        // mount or wall it reduces to only two, the wood and acrylic"). This line supplied a
        // DEFAULT of WALL for brackets — but it never CLEARED the tag on anything else, and a rod
        // inherits its cluster's location. The steel rod, whose cluster is tagged ceiling, was duly
        // filtered out the moment Wall was chosen. A pole is not built for a wall or a ceiling.
        mount: MOUNTED_ROLES.includes(role) ? (mountTag || 'WALL') : '',
        // WHERE ALONG the rod — LEFT / CENTER / RIGHT. A FRONT/BACK value has been lifted to tier
        // above, so this field means one thing only.
        position: TIER_POSITIONS.includes(U(input.position)) ? '' : U(input.position),
        // A PLACEHOLDER, NOT AN OPTION — by the flag, and by the NAME. The flag is written when a
        // pin is parked, but a pin that has been re-saved since can carry the minted id without it,
        // and `HIDDEN-83238L91253A1921` is never a part anybody can choose or buy whatever its
        // flags happen to say. The id is minted by this app for exactly one purpose, so reading it
        // is not a guess.
        parked: !!input.parked || /^HIDDEN-/i.test(String(input.partId || '')),
        // ⚠ A ROD IS NEVER A RIDER (Stuart 2026-08-17: "when solid pole is selected i am getting
        // offered only two choices of acrylic and wood, not metal"). The metal rod's centre piece
        // is tagged ALWAYS SHOWN — a fossil of the old engine, where the short centre rod was
        // permanently visible and hiding was done by other steps. Read literally, `always` made it
        // a rider, and riders are never offered — so the metal rod vanished from its own picker
        // and only the untagged wood and acrylic remained.
        //
        // Under the segment rule that tag is already redundant: the centre piece renders whenever
        // the rod is chosen, which is exactly what "always shown" was trying to say. So a rod is
        // always a CHOICE, whatever it is tagged, and no retagging is needed to fix this.
        always: (input.always === true || RIDER_ROLES.includes(role)) && !ROD_ROLES.includes(role),
        // A COLLAR IS NOT A CHOICE — it is the companion of the finial that requires it. Two-part
        // acrylic finials are a metal collar plus an acrylic top; the customer picks the finial and
        // the collar comes with it, always the matching one.
        isCollar: input.isCollar === true,
        requiresCollar: U(input.requiresCollar),
        // A BASIC bracket takes no backplate; an IN-LINE bracket takes only in-line plates. Both are
        // facts about the part, tagged in 1.6, and both are pairing rules rather than filters.
        // 🧪 WHAT THIS PART IS MADE IN. A part wears only finishes whose MATERIAL it is made in, so
        // a wood stain never lands on a steel bracket and nothing lands on clear acrylic — without
        // any rule naming a material. Blank reads as METAL, the overwhelming majority.
        materials: (() => {
            const list = String(input.materials || '').split(/[,;|]+/).map(x => x.trim().toUpperCase()).filter(Boolean);
            if (list.length) return list;
            return input.noFinish === true ? ['CLEAR (NO FINISH)'] : ['METAL'];
        })(),
        // Clear = made only in a material that takes no finish. The old boolean, now derived.
        noFinish: input.noFinish === true
            || (String(input.materials || '').trim()
                ? String(input.materials).split(/[,;|]+/).every(x => /CLEAR|NO\s*FINISH/i.test(x.trim()))
                : false),
        isBasic: input.isBasic === true,
        // ⚠ THE TWO SIDES OF "IN LINE" ARE DIFFERENT FIELDS, and 1.6 says so. On a BRACKET the flag
        // is `usesReturnPlates` — "this tag is how the system knows a bracket is In Line". On a
        // BACKPLATE it is `inlineOnly` — "the INLINE-bracket copy of a shared return-style plate".
        // Reading inlineOnly on the arm matched nothing, so an In Line arm fell through to the
        // standard pool and took a plate it does not sit on.
        isInline: input.usesReturnPlates === true || (input.isInline === true),
        inlineOnly: input.inlineOnly === true,
        returnOnly: input.returnOnly === true,
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
    // ⚠ WHICH PROJECTIONS EXIST IS A BRACKET QUESTION. Now that a part lists every projection it is
    // made in, a RETURN tagged 4-5/8" would otherwise ADD 4-5/8" to the assembly's projections even
    // where no bracket is made at that depth — inventing a configuration that cannot be built. The
    // mounting hardware establishes the projections; everything else is filtered BY them.
    { key: 'proj', label: 'Bracket Projection', tag: 'proj', order: 40, scope: 'admissible', roles: MOUNTED_ROLES },
];

// A CONSTRAINT IS NOT AN OPTION. Only a part that IS a value votes for it; a part that merely
// REQUIRES AT LEAST that value does not create it. A french return tagged 4-5/8" means "I need at
// least this much depth" — counting it would offer a 4-5/8" projection on an assembly whose
// brackets only come at 3-5/8", which is a projection you cannot actually build. (The old
// generator learned this the same way: phantom projection cards conjured out of return minimums.)
// An axis reads one value from a choice — except projection, where a part may be made in SEVERAL
// and every one of them is a projection this assembly can be built at.
const axisValuesOf = (choice, axis) => {
    if (axis.key === 'rodKind') return choice.rodKind ? [choice.rodKind] : [];
    if (axis.key === 'proj') return choice.projs;
    return choice[axis.key] ? [choice[axis.key]] : [];
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
        : choices.filter(c => !ROD_ROLES.includes(c.role) && !c.always
            && (!axis.roles || axis.roles.includes(c.role))
            && admits(c, ctx, { ignore: [axis.key] }).ok);
    const seen = new Map();
    pool.forEach(c => {
        axisValuesOf(c, axis).forEach(v => {
            if (v === '' || v == null) return;
            const key = typeof v === 'number' ? v.toFixed(3) : v;
            if (!seen.has(key)) seen.set(key, v);
        });
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
    // A rod has no projection either — the arm holding it does. (Setup and drive still apply: a
    // rear track genuinely is double-only.)
    if (!skip('proj') && !ROD_ROLES.includes(choice.role) && ctx.proj != null && choice.projs.length) {
        if (!choice.projs.some(p => sameMeasure(p, ctx.proj))) {
            return no('projection', `made in ${choice.projs.map(p => `${p}"`).join(', ')} — this order is ${ctx.proj}"`);
        }
    }
    if (!skip('position') && ctx.position && choice.position && choice.position !== ctx.position) {
        return no('position', `tagged ${choice.position}, this slot is ${ctx.position}`);
    }
    // A part tagged for one rod of a double never appears on the other. Untagged parts are shared
    // by both, which is what a bracket carrying two rods, or one finial style used front and back,
    // genuinely is.
    if (!skip('tier') && ctx.tier && choice.tier && choice.tier !== ctx.tier) {
        return no('tier', `tagged ${choice.tier}, this is the ${ctx.tier} rod`);
    }
    // ── CUT FOR A PARTICULAR BRACKET (Stuart 2026-08-18, from the double sheet) ───────────────
    // The rear rod is not one part used by every double. H1-138R appears THREE times in the
    // designer's file — once cut for the 6.5"/3.25" bracket, once for the 8.5"/3.25" decorative,
    // once for the traverse — same item number, different geometry, because the rod sits where the
    // bracket puts it. Nothing in role, position or tier tells those apart.
    //
    // The depth PAIR does, and it is already on the bracket. So a part may carry the same pair to
    // say "I am the piece cut for that bracket", and it is admitted only when that bracket is the
    // one chosen. Traverse is separated before this by rod world, so the two families that share
    // 6.5"/3.25" never collide.
    // ⚠ THE PART THAT DEFINES THE PAIR IS NOT FILTERED BY IT (Stuart 2026-08-18, found driving his
    // assembly). A bracket CARRIES a depth pair; a rod or an end is CUT FOR one. Applying the same
    // test to both meant that once a bracket was chosen it excluded every other bracket from its
    // own step — "H1-138D: cut for front 8.5, this order's bracket is front 6.5" — so changing your
    // mind about the bracket was impossible without first deselecting the one you had. A backplate
    // is still filtered: it belongs to a bracket rather than defining one.
    if (!skip('proj') && choice.projTiers && ctx.tierProj && choice.role !== 'BRACKET') {
        const off = Object.entries(choice.projTiers)
            .find(([t, v]) => ctx.tierProj[t] !== undefined && !sameMeasure(v, ctx.tierProj[t]));
        if (off) {
            const mine = Object.entries(choice.projTiers).map(([t, v]) => `${t.toLowerCase()} ${v}"`).join(' / ');
            const theirs = Object.entries(ctx.tierProj).map(([t, v]) => `${t.toLowerCase()} ${v}"`).join(' / ');
            return no('bracket', `cut for ${mine} — this order's bracket is ${theirs}`);
        }
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
 * The collars the selected parts require — matched to the finial that asks for them.
 *
 * A two-part acrylic finial is a metal collar plus an acrylic top: the customer picks the finial,
 * and the collar that belongs to it comes along. It is never a question, so it is resolved here
 * rather than offered anywhere.
 */
export function companionsFor(choices, selectedIds = []) {
    const want = new Set((selectedIds || []).filter(Boolean).map(String));
    const collars = choices.filter(c => c.isCollar);
    if (!collars.length) return [];
    const out = [];
    choices.filter(c => want.has(c.id) && c.requiresCollar).forEach(c => {
        const key = c.requiresCollar;
        // By the code it names, then by position — a left finial takes the left collar. Falling back
        // to position matters because the tag names a PART and the same collar is pinned per end.
        const byCode = collars.filter(x => [x.partId, x.name, x.id].some(v => U(v) === key));
        const pool = byCode.length ? byCode : collars;
        const hit = pool.find(x => !c.position || !x.position || x.position === c.position) || (byCode.length ? byCode[0] : null);
        if (hit && !out.includes(hit)) out.push(hit);
    });
    return out;
}

/**
 * The nodes that must render CLEAR — acrylic, glass, anything that never takes the finish.
 *
 * ⚠ THIS IS THE REPLACEMENT FOR A HARDCODED ITEM-CODE LIST (Stuart 2026-08-17: "why does the ball
 * and acrylic pole show as clear (correct) and these finials do not?"). The renderer decided
 * "acrylic" by matching MESH NAMES against fourteen item codes compiled into the render loop, so an
 * acrylic ball whose mesh name happened to contain a listed code rendered clear while the acrylic
 * gem and knob rendered as metal. A list that must be edited and deployed for every new part is not
 * a rule.
 *
 * The rule is the tag. Only SELECTED parts contribute, so this is the clear geometry of the actual
 * configuration — and a two-part acrylic finial works without any special case: the top is tagged
 * no-finish and its collar is not, so the collar takes the finish and the top stays clear.
 */
export function clearNodes(choices, selectedIds = []) {
    const want = new Set((selectedIds || []).filter(Boolean).map(String));
    const on = new Set();
    choices.forEach(c => {
        if (!c.noFinish) return;
        if (!want.has(c.id) && !c.always) return;
        c.nodes.forEach(n => on.add(n));
    });
    // A required collar is metal by definition — it is the part that DOES take the finish — so a
    // collar is never added here even if its finial is clear.
    return on;
}

/** Does this part wear this finish? A finish belongs to a material; a part is made in materials. */
export function takesFinish(choice, finish) {
    if (!choice || choice.noFinish) return false;
    const fm = String((finish && (finish.material || finish.type)) || '').trim().toUpperCase() || 'METAL';
    return choice.materials.some(m => m === fm);
}

/** The finishes a part can actually wear, out of those the flow offers. */
export function finishesFor(choice, finishes = []) {
    return finishes.filter(f => takesFinish(choice, f));
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
    // A chosen ROD brings every segment of the SAME PART **ON THE SAME ROD**, each judged by that
    // rod's own end. ⚠ THE TIER IS PART OF THE IDENTITY (Stuart 2026-08-17, tagging the double):
    // front and back are frequently the SAME item number — H1-138R is both rods — so grouping by
    // partId alone would light the rear rod's geometry the moment the front one was chosen, and
    // shorten it with the front rod's return. Two rods, same number, different pins, different rods.
    const segmentShows = (seg, tier) => {
        if (segmentOf(seg) === 'CORE') return true;
        const e = endState(selected, segmentOf(seg), tier);
        return e.answered && !e.isReturn;
    };
    selected.forEach(c => {
        if (!ROD_ROLES.includes(c.role)) { take(c); return; }
        choices
            .filter(x => ROD_ROLES.includes(x.role) && x.partId && x.partId === c.partId
                && (x.tier || '') === (c.tier || ''))
            .forEach(seg => { if (segmentShows(seg, c.tier || '')) take(seg); });
        if (!c.partId) take(c);   // an unidentified rod is only ever itself
    });
    ridersFor(choices, answers, selectedIds).forEach(take);
    companionsFor(choices, selectedIds).forEach(take);
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

// AN END TREATMENT THAT REPLACES THE BRACKET (Stuart 2026-08-17) ──────────────────────────────
// "on inside mount, once that is selected there can be no other end choices, and not left and
//  right bracket choices. inside mount rules are nearly the same as returns. returns can have no
//  other end choice and no left or right brackets and use the smaller pole, inside mounts have
//  same rules but use the longer poles."
//
// A return and an inside mount are both END TREATMENTS THAT ARE ALSO THE MOUNT — they carry the
// rod at that end themselves, so that end's bracket is not merely unnecessary, it does not exist
// on the product. The two differ in ONE respect and it is geometric, not structural: a return
// bends back and needs the SHORT pole, an inside mount runs the full length and keeps the LONG one.
// That difference is already expressed by the segment rule (only RETURN drops the end piece), so
// nothing extra is needed for it here.
const BRACKET_REPLACING_ROLES = ['RETURN', 'INSIDE_MOUNT'];

// WHAT A RING RIDES ON (Stuart 2026-08-17) ────────────────────────────────────────────────────
// "when traverse poles are selected skip the ring step, unless it is a double traverse and the
//  front rod is a fascia, then rings can be selected (see H1-2TRV flow, for this instance)."
//
// Stated as a rule about traverse it needs a rule about doubles too, and then one about the next
// configuration nobody has built yet. Stated as a fact about the PART it needs neither, because
// this is not really a rule about traverse at all — it is about whether the order contains a
// surface a ring can hang on:
//
//   • a SOLID ROD is one. Rings have always ridden on it.
//   • a TRACK is not. What rides in a track is a carrier, which the engine already builds without
//     asking — offering rings beside carriers offers the same job twice.
//   • a FASCIA is one WHEN IT IS THE FRONT FACE of a multi-rod order. That is precisely the double
//     he describes: a decorative face in front, a track working behind it, rings on the face. A
//     fascia that is the only rod is a cover, with nothing behind it to be the front of.
//
// So the answer falls out of the tags the pins already carry — role, position, setup — and a
// triple, or a fascia-and-solid pairing, or whatever comes next, is answered without another rule.
// `carriesRings` on the pin overrides it outright in either direction, so a genuine exception is a
// tag and never a code change.
export function carriesRings(rod, ctx = {}) {
    if (!rod) return false;
    if (rod.carriesRings === true || rod.carriesRings === false) return rod.carriesRings;
    if (rod.role === 'TRACK') return false;
    // Front-ness, from whichever tag carries it: the pin's own position, its own setup, or the
    // order's. A one-value setup axis is IMPLIED rather than asked, so it may never reach ctx —
    // reading the rod itself means the fact does not depend on whether a question was posed.
    if (rod.role === 'FASCIA') return rod.tier === 'FRONT' || rod.setup === 'DOUBLE' || ctx.setup === 'DOUBLE';
    return true;   // a solid rod, and anything else that is a rod
}

export function slots(choices, answers = {}, selectedIds = []) {
    const ctx = contextOf(choices, answers);
    const want = new Set((selectedIds || []).filter(Boolean).map(String));
    // Which ends have chosen a treatment that IS the mount.
    const replaced = new Set(choices
        .filter(c => want.has(c.id) && BRACKET_REPLACING_ROLES.includes(c.role) && c.position)
        .map(c => c.position));
    // The tiers this order ACTUALLY HAS — read from the rods that are admissible right now, not
    // from every rod the assembly contains. ⚠ A COMBINED FAMILY HOLDS BOTH (Stuart 2026-08-18,
    // reviewing the H1-138 double sheet): the back rod pins live in the same assembly as the
    // singles and are held off a single order by `setup: double`. Reading tiers from all choices
    // would still open a BACK slot on every single order, and an untagged finial — which serves
    // whichever rod is asking — would fill it. The operator would be asked to dress a rod that is
    // not on the order.
    const allTiers = [...new Set(choices
        .filter(c => ROD_ROLES.includes(c.role) && c.tier && admits(c, ctx).ok)
        .map(c => c.tier))]
        .sort((a, b) => TIER_POSITIONS.indexOf(a) - TIER_POSITIONS.indexOf(b));
    // THE DEPTH AT EACH ROD, from the bracket that was actually chosen. Before a bracket is
    // picked this is empty and nothing is filtered by projection — the same restraint the return
    // and ring rules use, because guessing hides legitimate choices.
    const tierProj = {};
    choices.filter(c => want.has(c.id) && c.projTiers).forEach(c => Object.assign(tierProj, c.projTiers));
    const bucket = new Map();
    choices.forEach(c => {
        if (c.always) return;                       // riders are never a question
        if (c.isCollar) return;                     // …and nor is a collar: it comes with its finial
        if (c.parked) return;                       // …nor a placeholder with no item number yet
        const kind = SLOT_OF_ROLE(c.role);
        if (!kind) return;
        // A rod's position carries TWO different facts, and they must not be treated alike:
        //
        //   ALONG the pole — LEFT / CENTER / RIGHT — is one part in three pieces, not three
        //     questions. It collapses to a single decision; the pieces are resolved by
        //     visibleNodes from the ends.
        //   ACROSS the pole — FRONT / BACK — is a genuinely separate rod. A double has a front rod
        //     and a back rod, each chosen, each dressed, each with its own ends. Collapsing those
        //     would let a double offer ONE rod decision and quietly drop the other.
        //
        // Today every solid family is single, so this reads '' and nothing changes; H1-2TRV's
        // fascia and track already separate because their ROLES differ. It is here so that pinning
        // a second rod BACK is all a double needs from the rod side — a tag, not a release.
        const pos = ROD_ROLES.includes(c.role) ? '' : (c.position || '');
        // A part that dresses a rod is asked once PER ROD; a part that carries them is asked once.
        // An UNTAGGED part is offered in every tier — one finial style used front and back is the
        // common case, and it must appear in both questions rather than inventing a third.
        const tiers = TIERED_ROLES.includes(c.role)
            ? (c.tier ? [c.tier] : (allTiers.length ? allTiers : ['']))
            : [''];
        tiers.forEach(tier => {
            const key = `${kind}|${tier}|${pos}`;
            if (!bucket.has(key)) bucket.set(key, { key, kind, tier, position: pos, all: [], options: [], rejected: [] });
            const slot = bucket.get(key);
            slot.all.push(c);
            // Each tier is judged at ITS OWN depth. One bracket choice, two projections, and a
            // return that needs 6" is offered on the front rod and refused on the back.
            const v = admits(c, {
                ...ctx,
                ...(Object.keys(tierProj).length ? { tierProj } : {}),
                ...(tier && tierProj[tier] !== undefined ? { proj: tierProj[tier] } : {}),
                position: pos ? pos : undefined, tier: tier || undefined,
            });
            if (v.ok) slot.options.push(c); else slot.rejected.push({ choice: c, ...v });
        });
    });
    // ── A RETURN NEEDS AN END SEGMENT TO REPLACE (Stuart 2026-08-17) ────────────────────────
    // "whenever there is not 3 poles — left, center and right — then there is no french return."
    //
    // True, and it does not need a rule OR a tag, because it is already in the data. A return works
    // by dropping that end's long piece so the short centre carries the length; a rod pinned as ONE
    // piece has no end piece to drop, so the return has nothing to do and cannot be built. The same
    // pins that decide the three-piece geometry decide this — which is why it cannot fluctuate: it
    // is not a statement ABOUT the product, it is the product.
    //
    // Only applies once a rod is chosen. Before that the engine does not know which pole it is, and
    // guessing would hide a legitimate choice.
    const chosenRods = choices.filter(c => want.has(c.id) && ROD_ROLES.includes(c.role));
    if (chosenRods.length) {
        // Same identity rule as the renderer: a segment belongs to a rod only if it shares BOTH the
        // part number and the tier.
        const segmentsAt = (pos, tier) => choices.some(c => ROD_ROLES.includes(c.role)
            && chosenRods.some(r => r.partId && r.partId === c.partId && (r.tier || '') === (c.tier || '')
                && (!tier || (r.tier || '') === tier))
            && (c.position === pos));
        bucket.forEach(slot => {
            if (slot.kind !== 'END' || !slot.position) return;
            if (segmentsAt(slot.position, slot.tier || '')) return;  // a piece exists here — returns are possible
            const dropped = slot.options.filter(o => o.role === 'RETURN');
            if (!dropped.length) return;
            slot.options = slot.options.filter(o => o.role !== 'RETURN');
            slot.rejected = [...slot.rejected, ...dropped.map(choice => ({
                choice, ok: false, rule: 'pole construction',
                detail: `${chosenRods[0].name} is a single-piece pole — a return replaces an end SEGMENT, and there is none to replace`,
            }))];
        });
    }

    // ── A RETURN ANSWERS THAT END FOR EVERY ROD ────────────────────────────────────────────
    // The front rod's french return does the lifting for both rods, so the rear rod is neither
    // bracketed nor finialled there — it terminates into the bend. Without this the operator would
    // be asked to dress an end that is already spoken for, and could put a finial on a rod that
    // ends inside another rod's return.
    const returnAt = new Set(choices
        .filter(c => want.has(c.id) && c.role === 'RETURN' && c.position)
        .map(c => `${c.position}|${c.tier || ''}`));
    if (returnAt.size) {
        const posWithReturn = new Set([...returnAt].map(k => k.split('|')[0]));
        bucket.forEach(slot => {
            if (slot.kind !== 'END' || !posWithReturn.has(slot.position)) return;
            // the rod that owns the return keeps its slot — that IS where the return was chosen
            if ([...returnAt].some(k => k === `${slot.position}|${slot.tier || ''}`)) return;
            if (!slot.options.length) return;
            const by = choices.find(c => want.has(c.id) && c.role === 'RETURN' && c.position === slot.position);
            slot.suppressedBy = by?.partId || by?.name || 'the return';
            slot.suppressedReason = 'the return at this end carries both rods — this rod terminates into it';
            slot.rejected = [...slot.rejected, ...slot.options.map(choice => ({
                choice, ok: false, rule: 'return carries both rods', detail: slot.suppressedReason,
            }))];
            slot.options = [];
        });
    }

    // ── RINGS NEED SOMETHING TO RIDE ON ────────────────────────────────────────────────────
    // See carriesRings() above. Only judged once a rod is chosen: before that the engine does not
    // know what it is dressing, and guessing hides a legitimate choice.
    if (chosenRods.length && !chosenRods.some(r => carriesRings(r, ctx))) {
        bucket.forEach(slot => {
            if (slot.kind !== 'RING' || !slot.options.length) return;
            const by = chosenRods[0];
            slot.suppressedBy = by.partId || by.name;
            slot.suppressedReason = by.role === 'TRACK'
                ? 'a track carries its drapery on carriers, which are built with it — rings would be the same job twice'
                : 'nothing in this order presents a face a ring can ride on';
            slot.rejected = [...slot.rejected, ...slot.options.map(choice => ({
                choice, ok: false, rule: 'nothing to ride on', detail: slot.suppressedReason,
            }))];
            slot.options = [];
        });
    }

    // ── WHICH BACKPLATE GOES WITH WHICH BRACKET (Stuart 2026-08-17) ─────────────────────────
    // "any bracket tagged as basic gets no backplate option. any bracket tagged inline only shows
    //  the backplate options tagged as inline, and any other bracket not tagged as inline or basic
    //  only shows backplates not tagged inline."
    // A pairing, not a filter: the plate pool follows the arm that was chosen, so the two can never
    // be a mismatched pair. Nothing is offered that would not physically fit.
    // ⚠ TOLERANT ON POSITION (Stuart 2026-08-17: "the wood brackets are clearly tagged as basic and
    // still asking for a backplate"). A plate is pinned per position while the arm governing it may
    // be pinned SHARED — or the reverse — so an exact match found no arm, and with no arm the pool
    // is left untouched by design. Same position first, then a shared arm, then any chosen arm when
    // the plate itself is shared.
    const bracketAt = (pos) => {
        const chosen = choices.filter(c => want.has(c.id) && c.role === 'BRACKET');
        return chosen.find(c => (c.position || '') === pos)
            || chosen.find(c => !c.position)
            || (!pos ? chosen[0] : null) || null;
    };
    bucket.forEach(slot => {
        if (slot.kind !== 'BACKPLATE') return;
        // The BASIC tag is watched wherever it sits — on anything chosen for this position — because
        // a one-piece part carries its own plate and there is nothing left to choose.
        const basic = choices.find(c => want.has(c.id) && c.isBasic
            && ((c.position || '') === slot.position || !c.position || !slot.position));
        if (basic) {
            slot.suppressedBy = basic.name;
            slot.suppressedReason = 'it is one piece — the arm and backplate are the same part';
            slot.options = [];
            return;
        }
        const arm = bracketAt(slot.position);
        if (!arm) return;                            // no arm chosen yet — the pool is untouched
        // ── PROJECTION IS A PAIRING TAG TOO (Stuart 2026-08-17: "the backplate/coverplates and the
        // bracket arms are tagged to match via projection as well as the style (inline), so the
        // projection is a pairing tag as well on both these parts").
        //
        // It was only an AXIS filter: both parts were gated against the CHOSEN projection, which
        // produces matched pairs as a side-effect — but only once that question has been answered.
        // Before it is, ctx.proj is undefined, nothing filters, and a 3-5/8" arm can be paired with
        // a 6" plate. That is the arm-floating-above-its-plate symptom, and the coherence check
        // could only report it AFTER the fact. As a pairing it cannot happen: the plate pool is
        // narrowed to plates that share a projection with the arm actually chosen, answered or not.
        // A plate tagged for no projection fits them all and always passes.
        if (arm.projs && arm.projs.length) {
            const paired = slot.options.filter(o => !o.projs.length || o.projs.some(p => arm.projs.some(q => sameMeasure(p, q))));
            if (paired.length) slot.options = paired;
            else {
                slot.suppressedBy = arm.name;
                slot.suppressedReason = `no backplate here is made in ${arm.projs.map(p => `${p}"`).join(' or ')}`;
                slot.options = [];
                return;
            }
        }

        // THREE PLATE POOLS, one live at a time — they occupy the same spot on the wall:
        //   in-line arm → the in-line copies, falling back to the RETURN copies where a collection
        //                 has no in-line ones (1.6: "flows without inl-only plates fall back to
        //                 rtn-only for In Line brackets");
        //   any other  → the plain plates, neither in-line nor return.
        if (arm.isInline) {
            const inl = slot.options.filter(o => o.inlineOnly);
            slot.options = inl.length ? inl : slot.options.filter(o => o.returnOnly);
            if (!slot.options.length) {
                slot.suppressedBy = arm.name;
                slot.suppressedReason = 'an in-line bracket takes in-line plates, and this assembly has neither in-line nor return copies';
            }
            return;
        }
        slot.options = slot.options.filter(o => !o.inlineOnly && !o.returnOnly);
        if (!slot.options.length) {
            slot.suppressedBy = arm.name;
            slot.suppressedReason = 'a standard bracket takes a plain backplate, and every plate here is tagged in-line or return';
        }
    });

    // An end that mounts itself takes its bracket and backplate off the table — with the reason
    // attached, so nothing downstream mistakes it for an empty pool that needs fixing.
    bucket.forEach(slot => {
        if (!['BRACKET', 'BACKPLATE'].includes(slot.kind) || !slot.position) return;
        if (!replaced.has(slot.position)) return;
        const by = choices.find(c => want.has(c.id) && BRACKET_REPLACING_ROLES.includes(c.role) && c.position === slot.position);
        // ⚠ NAME IT BY OUR PATTERN ID (Stuart 2026-08-17: "step 9 is referring to the id from the
        // node H1138inPOLEMTR6Right1 — never use these, always our pattern id"). A pin's name is
        // sometimes the node it was built from, which is an artefact of the .fbx and means nothing
        // to anyone quoting. The part number always does.
        slot.suppressedBy = by ? (by.partId || by.name) : 'the end treatment';
        slot.suppressedReason = by && by.role === 'RETURN'
            ? 'a return carries the rod at that end'
            : 'an inside mount carries the rod at that end';
        slot.options = [];
    });
    // …and offered once per PART, however many pieces it is pinned as — and however many BRACKETS
    // it is cut for. H1-138R is one rod to the customer; which of its pins is the right geometry is
    // the bracket's business, settled by the gate above before this ever runs.
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
        let k = SLOT_ORDER.indexOf(s.kind === 'END' ? 'FINIAL' : s.kind);
        if (k < 0) k = 99;                          // a kind nothing knows about sorts last
        // On a tiered assembly the bracket carries each rod's depth, so it must be answered BEFORE
        // the ends that depth gates — otherwise an end is chosen against no constraint and a later
        // bracket silently invalidates it. On a single nothing moves: projection is still its own
        // question, asked first, exactly as it always has been.
        // …and before the RODS too, once a rear rod can be cut for a particular bracket: the
        // bracket decides which rod geometry exists, so asking for the rod first asks a question
        // whose answer set is not yet known.
        if (allTiers.length && (s.kind === 'BRACKET' || s.kind === 'BACKPLATE')) {
            k = -1 + (s.kind === 'BRACKET' ? 0 : 0.1);
        }
        const t = TIER_POSITIONS.indexOf(s.tier);
        const p = POSITION_ORDER.indexOf(s.position);
        return k * 10000 + (t < 0 ? 0 : t) * 100 + (p < 0 ? 99 : p);
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
    const sl = slots(norm, answers, selectedIds);
    const riders = ridersFor(norm, answers, selectedIds);
    const companions = companionsFor(norm, selectedIds);
    const clear = clearNodes(norm, selectedIds);
    const visible = visibleNodes(norm, answers, selectedIds);
    const ownership = nodeOwnership(norm, modelNodes);
    const selected = norm.filter(c => selectedIds.includes(c.id));
    const bom = [
        ...norm.filter(c => selectedIds.includes(c.id) && !c.parked),
        ...riders,
        ...companions,          // the collar bills with its finial
    ].map(c => ({ partId: c.partId, name: c.name, qty: c.qty, price: c.price, raw: c.raw,
        // BOM-only parts stay IN the bill of materials — the shop picks them — but every
        // customer-facing surface filters on this. One list, two audiences.
        hidden: !!c.hidden, role: c.role, position: c.position }));
    return {
        choices: norm,
        axes,          // the questions, with their discovered values
        ctx,           // what those answers mean
        slots: sl,     // the per-place decisions, each with its live options + why the rest are out
        riders,        // built, never asked
        companions,    // collars pulled in by the part that requires them
        clear,         // Set of node names that never take the finish (tagged, never name-matched)
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
            if (s.suppressedBy) return;                                       // replaced by design
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
    // Projection compares SETS now: two parts disagree only when there is NO projection they are
    // both made in. A 6"-only arm beside an arm made in 4-5/8" and 6" is not a mismatch.
    const projSel = (model.selected || []).filter(c => c.projs && c.projs.length);
    if (projSel.length > 1) {
        const shared = projSel.reduce((acc, c) => acc.filter(p => c.projs.some(q => Math.abs(p - q) < 0.01)), projSel[0].projs.slice());
        if (!shared.length) add('red', 'MISMATCH', `the chosen parts share no projection: ${projSel.map(c => `${c.name} (${c.projs.map(p => `${p}"`).join('/')})`).join(' vs ')} — they will not sit together.`);
    }
    ['mount'].forEach(axis => {
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
