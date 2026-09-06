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
    // ⚠ AN END ARM IS AN END TREATMENT, NOT A BRACKET (Stuart 2026-09-06, H1-2TRV slots 51/52):
    // "these are for the standard pole … these choices cause the left and right bracket choice to
    //  skip and we need to expose the backplates for each selection. in the old engine flat iron
    //  were end arms with backplates so they skipped the bracket choice and it worked."
    //
    // The END-ARM tag was born on a BRACKET cluster meaning exactly that — this bracket IS the end
    // — and the old engine honoured it (returnChosen). Here it was carried onto the choice but the
    // role stayed BRACKET, so the arm sat in the bracket picker beside the arms it replaces. Read
    // as a RETURN it gets everything the tag promises for free, because that is what RETURN already
    // means: pooled into the End step, replaces the bracket at its end, keeps its plate with the
    // return → in-line → plain fallback, counts as carrying the rod, hides the pole's end segment.
    // Same shape as the inside-mount rule above: a tag that already exists, read for what it says.
    if (input.isReturnArm === true && role === 'BRACKET') role = 'RETURN';
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
        passing: U(input.passing),                   // '' = suits either — every end bracket, and everything that does not pass
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
        // ⚠ BUILT, BILLED, NEVER READ BY THE CUSTOMER (Stuart: "the hidden, if they are actually
        // hidden items, can be hidden from these pages as well, only included in the shop floor
        // bom"). The adapter works this out from the pin; this line carries it the last inch.
        // Without it the flag died here, `bom` stamped every line hidden:false, and the panels that
        // filter on it had nothing to filter — so a nut plate with no item number was being read
        // out to the customer at $0.00. Read ONLY by customer-facing filters, never by slots,
        // selection or render, so it cannot move a question.
        hidden: !!input.hidden,
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
        // "this end treatment mounts without a backplate" — see the plate pairing in slots().
        noBackplate: input.noBackplate === true,
        // END RETURN ARM: this part IS the end treatment. Paired with noBackplate it means the
        // DECORATIVE kind, which supports nothing — see the bracket-replacing rule in slots().
        isReturnArm: input.isReturnArm === true,
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
    // ── THE FRONT OF A DOUBLE IS A DECISION (Stuart 2026-08-31, H1-2TRV) ─────────────────────
    // "when selecting double we have the secondary option of the front being fascia with rings and
    //  not track … an additional drop down that opens on the rod step if double is selected."
    // The engine always knew this fork — "choose the front track — omit it to use rings on the
    // fascia" — but said it as an omission, which reads as an unanswered step. Now it is asked.
    // The VALUES are discovered like every axis: a front-capable TRACK votes TRACK, a FASCIA votes
    // FASCIA, so the question only exists where both genuinely live in one assembly — no solid
    // family can ever grow it. `requires` keeps it closed until the order IS a double.
    { key: 'frontLayer', label: 'Front of the Double', tag: 'frontLayer', order: 22, scope: 'rods', requires: { setup: 'DOUBLE' } },
    // Motorised vs manual. Asked only where BOTH exist — a manual-only collection must not grow a
    // question with one answer, which is exactly what discovery gives us for free.
    { key: 'drive', label: 'Drive', tag: 'drive', order: 25, scope: 'admissible' },
    { key: 'mount', label: 'Mount', tag: 'mount', order: 30, scope: 'admissible' },
    // ⚠ WHICH PROJECTIONS EXIST IS A BRACKET QUESTION. Now that a part lists every projection it is
    // made in, a RETURN tagged 4-5/8" would otherwise ADD 4-5/8" to the assembly's projections even
    // where no bracket is made at that depth — inventing a configuration that cannot be built. The
    // mounting hardware establishes the projections; everything else is filtered BY them.
    { key: 'proj', label: 'Bracket Projection', tag: 'proj', order: 40, scope: 'admissible', roles: MOUNTED_ROLES },
    // ── PASSING IS NOT AN AXIS (Stuart 2026-08-27, live on H1-75) ────────────────────────────
    // "the passing bracket is not being shown as an option… if passing bracket is selected then
    // passing rings are the preferred ring selection, if not passing then standard rings."
    //
    // The first cut asked Ring Style as a framing question and filtered the centre bracket by the
    // answer — which HID the passing brackets from the very step where the decision is actually
    // made. The rule runs the other way: the BRACKET is the decision, the rings follow it. So there
    // is no Ring Style question at all; the centre bracket step shows every style, and the chosen
    // bracket's `passing` tag filters the rings (see slots() — the same chosen-part pattern as
    // projection pairing). The spec sheet already reads it this direction.
    //
    // ⚠ THE TAG STILL BELONGS ON THE PIN, AND END BRACKETS STAY BLANK: blank means "suits either",
    // and the same physical arm is untagged at the ends and tagged in the centre.
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
    // The front-of-a-double values are STRUCTURAL, not tagged: what could carry the front layer.
    // A track pinned to the rear (setup double) serves the rear whatever is chosen, so only a
    // front-capable track votes.
    if (axis.key === 'frontLayer') {
        if (choice.role === 'TRACK' && (choice.tier || 'FRONT') === 'FRONT') return ['TRACK'];
        if (choice.role === 'FASCIA') return ['FASCIA'];
        return [];
    }
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
        // A gated axis opens only under the required answer above it — answered, or implied where
        // the assembly only comes one way. Everything else about the cascade is untouched.
        if (axis.requires) {
            const eff = (k) => {
                const v = answers[k];
                if (v !== undefined && v !== '' && v !== null) return v;
                const above = out.find(a => a.key === k);
                return (above && above.implied) ? above.values[0] : undefined;
            };
            if (Object.entries(axis.requires).some(([k, v]) => eff(k) !== v)) return;
        }
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
    // ⚠ THE RINGS FOLLOW THE BRACKET, NEVER THE REVERSE (Stuart 2026-08-27: "if passing bracket is
    // selected then passing rings are the preferred ring selection, if not passing then standard
    // rings"). ctx.passing arrives from the CHOSEN bracket's tag (slots() derives it — there is no
    // Ring Style question), so this rule is scoped to RINGS ONLY: a bracket must never be filtered
    // by it, or picking one style would hide the way back to the other. The reason is written to be
    // acted on — it names the bracket step, where the fix lives.
    if (!skip('passing') && choice.role === 'RING' && ctx.passing && choice.passing && choice.passing !== ctx.passing) {
        return no('passing', ctx.passing === 'STANDARD'
            ? 'a passing ring only slides past a PASSING centre bracket — this order’s centre bracket is standard; choose a passing centre bracket to use it'
            : 'a standard ring cannot pass the centre bracket — this order’s centre bracket is a passing style; use passing rings');
    }
    // A rod has no projection either — the arm holding it does. (Setup and drive still apply: a
    // rear track genuinely is double-only.)
    // ── A RETURN PLATE FOLLOWS ITS RETURN, NOT THE PROJECTION AXIS (Stuart 2026-08-25) ──────
    // "only the 6\" projection is shown with the correct backplate, the 3.625 and 4.625 both are
    //  incorrect … we need to make all of this work with the tags so that this tool works well
    //  with all assemblies not just this one." A rtn-only plate sits flat on the wall behind
    // whichever return is chosen — the RETURN carries the projection, the plate merely meets the
    // wall — so a proj tag on a rtn-only plate records where it was modelled, never which depths
    // it may serve. The pairing rule still keeps rtn-only plates off ordinary arms.
    if (!skip('proj') && !ROD_ROLES.includes(choice.role) && !choice.returnOnly && ctx.proj != null && choice.projs.length) {
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
    if (!skip('proj') && choice.projTiers && ctx.tierProj) {
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
 * The picks that survive a model, with a pin swapped for its twin where the part still stands.
 *
 * ⚠ REPLACE THE PIN, KEEP THE PART (Stuart 2026-08-20: "the incorrect finial disappears — you just
 * need to replace with the correct one"). A finial is pinned once per bracket family, so choosing
 * the OTHER double bracket invalidates the PIN that was picked — but not the PART. Dropping it
 * empties a step the customer already answered and blames them for the bracket they just changed.
 * The same part number, cut for the bracket now chosen, is sitting in the slot; the pick moves.
 *
 * Pure, and keyed on slots, so the caller can settle with it: keep what the model offers, swap what
 * it can, re-resolve, and stop when a pass changes nothing.
 */
export function reseatPicks(model, picks = {}) {
    const out = {};
    (model?.slots || []).forEach(slot => {
        const want = picks[slot.key];
        if (!want) return;
        if (slot.options.some(o => o.id === want)) { out[slot.key] = want; return; }
        const had = (model.choices || []).find(c => c.id === want);
        const twin = had && had.partId && slot.options.find(o => o.partId === had.partId);
        if (twin) out[slot.key] = twin.id;
    });
    return out;
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
    // ⚠ THE COLLAR HAS TO BE THE ONE THAT FITS THIS ROD (Stuart 2026-08-18: "check out the acrylic
    // collar, it appears that it is showing the collar of a different projection"). A collar is
    // pinned once per end, per rod, and once per bracket family — so on a double there are several
    // of the same part, and matching only by code and position picked whichever came first. Same
    // fault the rear rod had: a name is not enough when the same name exists at several depths.
    //
    // Narrowed most specific first, and each filter is only kept if it leaves something — a
    // collection with ONE collar still finds it, which is every single-rod family.
    const narrow = (pool, pred) => { const n = pool.filter(pred); return n.length ? n : pool; };
    const cutOf = (x) => JSON.stringify(x.projTiers || null);
    choices.filter(c => want.has(c.id) && c.requiresCollar).forEach(c => {
        const key = c.requiresCollar;
        // By the code it names, then which ROD it is on, then which BRACKET it was cut for, then
        // which end. The tag names a PART; everything after it says WHICH of that part.
        const byCode = collars.filter(x => [x.partId, x.name, x.id].some(v => U(v) === key));
        let pool = byCode.length ? byCode : collars;
        pool = narrow(pool, x => !x.tier || !c.tier || x.tier === c.tier);
        pool = narrow(pool, x => !x.projTiers || cutOf(x) === cutOf(c));
        pool = narrow(pool, x => !c.position || !x.position || x.position === c.position);
        const hit = pool[0] || null;
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
    // ⚠ BLANK MATERIALS ALREADY MEAN METAL — normalizeChoice says so, and the overwhelming majority
    // of parts are tagged with nothing. So a choice that arrives without the field is read the same
    // way rather than throwing: this is asked from pricing, from the renderer and from the finish
    // rail, and a crash here takes the whole configurator down (2026-08-21, it did).
    const mats = Array.isArray(choice.materials) && choice.materials.length ? choice.materials : ['METAL'];
    return mats.some(m => m === fm);
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
    // ⚠ …AND CUT FOR THE SAME BRACKET (Stuart 2026-08-18: "when i chose round steel or wood both
    // rear projection rods still entered"). H1-138R exists TWICE at tier BACK — once cut for the
    // 6.5" bracket and once for the 8.5" — because the rear rod sits at a different distance behind
    // the front rod on each. Same number, same tier, different geometry, so pulling in every
    // sibling drew both rear rods at once. The acrylic looked right only because it does not have
    // two. The pair the chosen rod carries is what separates them, exactly as it does when the
    // OPTION is offered — the same fact, applied one step later.
    const cutOf = (x) => JSON.stringify(x.projTiers || null);
    const sameCut = (a, b) => cutOf(a) === cutOf(b);

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
                && (x.tier || '') === (c.tier || '') && sameCut(x, c))
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
    // ── RINGS ARE THE FRONT-LAYER ANSWER NOW (Stuart 2026-08-31) ────────────────────────────
    // "if single, then show one track … if double then show 2 tracks, if double with front
    //  stationary fascia rings then one track and open the ring option." So a fascia presents a
    //  ring surface in exactly one configuration: a DOUBLE whose front layer is the stationary
    //  fascia — which is now an asked question (the frontLayer axis) rather than an inference
    //  from tier. A single's fascia fronts one track and its drapery traverses; no rings.
    if (rod.role === 'FASCIA') return ctx.frontLayer === 'FASCIA';
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
    // ── A SINGLE ORDER HAS ONE ROD (Stuart 2026-08-26, live on H1-75) ───────────────────────
    // Tier questions — "Back Left End Treatment", "Back Rod" — exist only on a double. On a
    // single: with BOTH tiers admissible (drifted tags — a back rod missing its `setup: double`
    // gate), FRONT is the order's rod and BACK is dropped; with only BACK existing (H1-75's rods
    // are pinned BACK), that one rod IS the order's rod. Either way the slot keeps its tier
    // internally — geometry and projection pairing still resolve — but the operator is never
    // asked to dress a rear rod on a single, and the label drops the tier word (tierSolo).
    const isSingle = String(ctx.setup || '').toUpperCase() === 'SINGLE';
    const orderTiers = (isSingle && allTiers.length > 1) ? [allTiers[0]] : allTiers;
    // THE DEPTH AT EACH ROD, from the bracket that was actually chosen. Before a bracket is
    // picked this is empty and nothing is filtered by projection — the same restraint the return
    // and ring rules use, because guessing hides legitimate choices.
    // THE DEPTH AT EACH ROD, from the brackets that were actually chosen — but WHICH brackets
    // depends on where you are standing (Stuart 2026-08-18):
    //
    //   "once you select a bracket that has a different projection we need to gate off the others…
    //    2 have same projection so those 2 can be offered in steps 4, 5. the one with the longer
    //    projection on front rod if selected is only choice for steps 4, 5. then step 7 rear rod
    //    follows the same logic."
    //
    // Three brackets carry one order, so they must agree — but a step cannot be filtered by its OWN
    // answer, or choosing the 8.5" arm on the left would remove the 8.5" arm from the left. So a
    // BRACKET slot is judged against the brackets chosen at the OTHER positions, and everything
    // else — rods, ends, rings, plates — against all of them. Left then offers all three, centre
    // and right offer only what matches it, and the rear rod follows the same pair without a rule
    // of its own.
    // ⚠ ONLY A BRACKET DEFINES THE PAIR. A rod carries one to say which bracket it was CUT FOR;
    // letting it vote turned the rule around — with the 8.5" rear rod chosen, the bracket step
    // offered only the 8.5" arm, so changing family meant deselecting the rod first, and the rod
    // step only ever shows one rod. The bracket is the authority on depth; everything else answers
    // to it and nothing answers back.
    const chosenPairs = choices.filter(c => want.has(c.id) && c.projTiers && c.role === 'BRACKET');
    const tierProj = {};
    chosenPairs.forEach(c => Object.assign(tierProj, c.projTiers));
    const pairExcept = (position) => {
        const o = {};
        chosenPairs.filter(c => (c.position || '') !== (position || '')).forEach(c => Object.assign(o, c.projTiers));
        return o;
    };
    // ── THE RINGS FOLLOW THE CHOSEN BRACKET (Stuart 2026-08-27) ─────────────────────────────
    // Same chosen-part pattern as projection above: once a `passing`-tagged bracket is picked
    // (only centre pins carry the tag — end arms are deliberately blank), its value rides the
    // ring slots at that rod, and admits() filters mismatched rings with a reason that names the
    // bracket. Before a bracket is chosen nothing is filtered — guessing hides legitimate
    // choices. Untagged brackets (assemblies with no passing program) filter nothing.
    const tierPassing = {};
    choices.filter(c => want.has(c.id) && c.role === 'BRACKET' && c.passing)
        .forEach(c => { tierPassing[c.tier || ''] = c.passing; });
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
            ? (c.tier
                ? ((isSingle && orderTiers.length && !orderTiers.includes(c.tier)) ? [] : [c.tier])
                : (orderTiers.length ? orderTiers : ['']))
            : [''];
        tiers.forEach(tier => {
            const key = `${kind}|${tier}|${pos}`;
            if (!bucket.has(key)) bucket.set(key, { key, kind, tier, position: pos, tierSolo: isSingle, all: [], options: [], rejected: [] });
            const slot = bucket.get(key);
            slot.all.push(c);
            // Each tier is judged at ITS OWN depth. One bracket choice, two projections, and a
            // return that needs 6" is offered on the front rod and refused on the back.
            // A bracket answers to its siblings, not to itself.
            const pair = (kind === 'BRACKET') ? pairExcept(pos) : tierProj;
            const passHere = tierPassing[tier || ''] || tierPassing[''];
            const v = admits(c, {
                ...ctx,
                ...(Object.keys(pair).length ? { tierProj: pair } : {}),
                ...(tier && pair[tier] !== undefined ? { proj: pair[tier] } : {}),
                ...(passHere ? { passing: passHere } : {}),
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
    //
    // ⚠ IT IS A RULE ABOUT POLES, SO IT ONLY ASKS ABOUT POLES (Stuart 2026-08-19, H1-2TRV).
    // A traverse fascia is ONE continuous extrusion by construction — it has no left, centre and
    // right pieces and never will, so this test could only ever answer "no" and was silently
    // deleting every miter return from both traverse ends. On a traverse rod the return is a CUT on
    // the fascia plus its own arm, not an end segment swapped out.
    //
    // Scoped to a SEPARATE name on purpose: `chosenRods` is read again below by the ring rule, and
    // narrowing it there stopped a track suppressing rings. One rule, one variable.
    const chosenRods = choices.filter(c => want.has(c.id) && ROD_ROLES.includes(c.role));
    const chosenPoles = chosenRods.filter(c => c.rodKind !== TRAVERSE);
    if (chosenPoles.length) {
        // Same identity rule as the renderer: a segment belongs to a rod only if it shares BOTH the
        // part number and the tier.
        const segmentsAt = (pos, tier) => choices.some(c => ROD_ROLES.includes(c.role)
            && chosenPoles.some(r => r.partId && r.partId === c.partId && (r.tier || '') === (c.tier || '')
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
                detail: `${chosenPoles[0].name} is a single-piece pole — a return replaces an end SEGMENT, and there is none to replace`,
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
        // ⚠ A RETURN WITH NO TIER STILL LIVES SOMEWHERE (Stuart 2026-08-19: "def broke the f
        // returns, french and miter no longer working normal or traverse").
        //
        // Blank tier means "serves both rods", so an untiered return's key is `LEFT|` and it
        // matched NO tiered slot — including the one it was chosen in. Every end option was struck
        // out and the step read "not asked", so the operator could not see or change the return
        // they had just picked. It needs a return SELECTED to show at all, which is why it sat
        // here unnoticed.
        //
        // A return serving both rods is the FRONT rod's return — that is the whole premise of the
        // rule above: the front bend does the lifting and the rear terminates into it. So an
        // untiered return owns the front-most end at its position, and suppresses the rest.
        const frontTierAt = {};
        bucket.forEach(slot => {
            if (slot.kind !== 'END' || !slot.position) return;
            const t = slot.tier || '';
            const held = frontTierAt[slot.position];
            const rank = (x) => (x ? TIER_POSITIONS.indexOf(x) : -1);
            if (held === undefined || rank(t) < rank(held)) frontTierAt[slot.position] = t;
        });
        bucket.forEach(slot => {
            if (slot.kind !== 'END' || !posWithReturn.has(slot.position)) return;
            // the rod that owns the return keeps its slot — that IS where the return was chosen
            const here = `${slot.position}|${slot.tier || ''}`;
            const ownedUntiered = returnAt.has(`${slot.position}|`)
                && (slot.tier || '') === (frontTierAt[slot.position] || '');
            if (returnAt.has(here) || ownedUntiered) return;
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

    // ── A STATIONARY FRONT TAKES NO TRACK (Stuart 2026-08-31, H1-2TRV) ──────────────────────
    // The frontLayer answer: FASCIA means the front layer hangs on rings from the fascia, so the
    // front track — and the traverse ends that would dress it — serve nobody. One track remains
    // (the rear, which setup: double already admits) and the ring step opens via carriesRings.
    // TRACK answered means both layers traverse; the ring rule above already keeps rings away.
    if (ctx.frontLayer === 'FASCIA') {
        bucket.forEach(slot => {
            if (!(['TRACK', 'TRV_END'].includes(slot.kind) && (slot.tier || '') === 'FRONT')) return;
            if (!slot.options.length) return;
            slot.suppressedBy = 'the stationary fascia';
            slot.suppressedReason = 'the front layer is the fascia with rings — the track and its ends serve the rear layer only';
            slot.rejected = [...slot.rejected, ...slot.options.map(choice => ({
                choice, ok: false, rule: 'front layer', detail: slot.suppressedReason,
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
    //
    // ⚠ A RETURN IS THE ARM AT ITS OWN END (Stuart 2026-08-20: "these returns are supposed to use
    // the same call for backplates standard included and then the same upgrade fee to cover
    // plates … these should have the same backplate options as the inline"). A return replaces the
    // bracket there — the rule below suppresses it — and something still has to hold the rod to the
    // wall, so the plate question does not disappear with the bracket. It moves to the return.
    // Only where there is no bracket: a bracket that IS chosen still governs its own plate.
    const bracketAt = (pos) => {
        const chosen = choices.filter(c => want.has(c.id) && c.role === 'BRACKET');
        const bkt = chosen.find(c => (c.position || '') === pos)
            || chosen.find(c => !c.position)
            || (!pos ? chosen[0] : null) || null;
        if (bkt) return bkt;
        // A return that takes no plate cannot be the arm a plate pairs with — under a decorative end
        // the plate waits for the bracket the customer chooses, exactly as an unanswered bracket
        // step would ("a plate with no arm is not a question yet").
        return choices.find(c => want.has(c.id) && c.role === 'RETURN' && !c.noBackplate && (c.position || '') === pos) || null;
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
        // ⚠ SOME ENDS MOUNT WITHOUT A PLATE, AND ONLY THE ITEM KNOWS (Stuart 2026-08-20: "in
        // certain cases returns get backplates and in others they do not … if we choose traverse
        // rather than solid then the traverse french and miter return do not get backplates").
        //
        // True, and it is not a rule the engine can derive. A solid french return bolts to the wall
        // and needs a plate; the traverse one clamps to the fascia and does not. Same role, same
        // position, opposite answer — so the part says which, and nothing here guesses. Read the
        // same way BASIC is: whatever is chosen at this position, if it says it takes no plate,
        // there is no plate question.
        // ⚠ …UNLESS THE END IS DECORATIVE (Stuart 2026-09-06). An END-ARM + NO PLATE end keeps its
        // bracket open (the replace rule below stands aside for it), and that bracket needs a plate
        // of its own. Suppressing the plate on the END's tag then leaves the operator choosing a
        // bracket that can never get one — which is what happened the first night this shipped:
        // H1-2RCTECB chosen under H1-2TRVERA, "this end treatment mounts without a backplate". The
        // end itself still takes no plate; the question simply belongs to the bracket now.
        const noPlate = choices.find(c => want.has(c.id) && c.noBackplate && !c.isReturnArm
            && ((c.position || '') === slot.position || !c.position || !slot.position));
        if (noPlate) {
            slot.suppressedBy = noPlate.partId || noPlate.name;
            slot.suppressedReason = 'this end treatment mounts without a backplate';
            slot.options = [];
            return;
        }
        const arm = bracketAt(slot.position);
        // ── A PLATE WITH NO ARM IS NOT A QUESTION YET (Stuart 2026-08-21) ────────────────────
        // "on the left and right bracket selection, it is offering a matching backplate? the
        // backplate is tagged for rtn-only and both brackets are tagged as basic so they should not
        // even require a backplate."
        //
        // The pool used to be left UNTOUCHED until an arm was chosen, which quietly meant "offer
        // every plate in the assembly, including the copies tagged for somebody else". Two faults
        // fall out of that one line, and he found both:
        //
        //   · Brimar offered a RETURN's mounting base under a bracket step where no bracket had
        //     been chosen — the rtn-only tag was doing its job, there was simply nothing consulting
        //     it yet; and the BASIC tag could not speak either, because it is read off what is
        //     CHOSEN and nothing was.
        //   · Choosing a french return, picking its plate, then changing back to a finial left the
        //     plate in the render and on the quote ("that needs to be tied in to auto remove when a
        //     return is removed"). Removing the return removes the arm — and with the pool untouched
        //     the orphaned plate was still 'offered', so nothing dropped it. It is not a cleanup
        //     rule that was missing: a plate nobody is holding was never a legitimate offer.
        //
        // So the plate follows the arm all the way down. Where an arm is EXPECTED at this position
        // and has not been chosen, there is no plate question yet — and the moment the arm goes
        // away the pick goes with it, because reseatPicks keeps only what is still offered.
        if (!arm) {
            const armSlot = [...bucket.values()].find(s2 => s2.kind === 'BRACKET' && (s2.position || '') === (slot.position || ''));
            // EVERY ARM HERE IS ONE PIECE — then the plate is moot whichever of them is chosen,
            // and saying so now beats asking a question whose answer is already known. The BASIC
            // tag above says this about a CHOSEN part; this says it about a position where nothing
            // but one-piece arms is on offer, which is Brimar's left and right.
            if (armSlot && armSlot.options.length && armSlot.options.every(o => o.isBasic)) {
                slot.suppressedBy = armSlot.options[0].partId || armSlot.options[0].name;
                slot.suppressedReason = 'every bracket offered here is one piece — the arm and backplate are the same part';
                slot.options = [];
                return;
            }
            // Otherwise the plain plates stand, and only those: a copy tagged for an in-line arm or
            // for a return belongs to an arm nobody is holding. The plain pool is what an unanswered
            // bracket step would offer anyway, so nothing that used to be askable stops being
            // askable — only the copies that were never this step's to offer.
            slot.options = slot.options.filter(o => !o.inlineOnly && !o.returnOnly);
            return;
        }
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
            // A rtn-only plate follows its RETURN, not the projection pairing — same exemption as
            // the axis gate above (Stuart 2026-08-25): the return carries the projection, the
            // plate merely meets the wall behind it, and its own proj tag records where it was
            // modelled. Ordinary plates still pair strictly by depth.
            const paired = slot.options.filter(o => o.returnOnly || !o.projs.length || o.projs.some(p => arm.projs.some(q => sameMeasure(p, q))));
            if (paired.length) slot.options = paired;
            else {
                slot.suppressedBy = arm.name;
                slot.suppressedReason = `no backplate here is made in ${arm.projs.map(p => `${p}"`).join(' or ')}`;
                slot.options = [];
                return;
            }
        }

        // THREE PLATE POOLS, one live at a time — they occupy the same spot on the wall:
        //   in-line arm → the in-line copies (inl-only), falling back to the RETURN copies where a
        //                 collection has no in-line ones (1.6: "flows without inl-only plates fall
        //                 back to rtn-only for In Line brackets");
        //   return      → the return copies (rtn-only), falling back to the in-line ones, and to
        //                 the plain plates only where it has neither — a return always meets the
        //                 wall, so it is never left with nothing;
        //   any other   → the plain plates, neither in-line nor return.
        // A RETURN AND AN IN-LINE ARM SIT AGAINST THE WALL THE SAME WAY, which is why they share
        // each other's plates at all — standard included, cover plate the upgrade. What they do not
        // share is which set they ask for FIRST.
        if (arm.isInline || arm.role === 'RETURN') {
            const inl = slot.options.filter(o => o.inlineOnly);
            const rtn = slot.options.filter(o => o.returnOnly);
            const plain = slot.options.filter(o => !o.inlineOnly && !o.returnOnly);
            // ⚠ EACH ARM PREFERS ITS OWN COPIES (Stuart 2026-08-21: an In Line bracket "pulls the
            // backplates that inline with the returns … but these inline have their own inline
            // backplates"). Borrowing was written as a KINDNESS — a collection with only in-line
            // copies should still put a plate behind its returns — but it was written as the FIRST
            // choice for both arms, so the moment a collection tags both sets the return reads the
            // in-line pool and the two steps offer an identical list. Which is what he was looking
            // at: the same eight plates behind a french return and behind an in-line arm.
            //
            // So the borrowing stays and becomes what it always meant: a fallback. A return asks
            // for the return copies, an in-line arm asks for the in-line copies, and only where its
            // own set does not exist does either reach for the other's. A collection tagged one way
            // sees no change at all; a collection tagged both ways now gets the plate it was tagged
            // for. THE PLAIN COPIES ARE NOT IN EITHER POOL — those belong to the ordinary wall
            // bracket, and a return only falls that far when nothing else exists (below).
            let pool = arm.role === 'RETURN'
                ? (rtn.length ? rtn : inl)
                : (inl.length ? inl : rtn);
            // ⚠ A RETURN ALWAYS MEETS THE WALL (Stuart 2026-08-20: "on double when i choose double
            // french return … it should be showing the backplate options"). H1-138 has in-line
            // copies for the 6.5/3.25 pair and NONE for 8.5/3.25, so on that double the in-line
            // pool comes back empty — and an empty pool was read as "this assembly has no such
            // plates", which is the right answer for an IN-LINE BRACKET and the wrong one here.
            //
            // An in-line bracket is a STYLE: choose it where the plates for it exist, and where
            // they do not, do not offer a mismatched pair. A return is not a style. It is the
            // mount, it is bolted to the wall, and it needs a plate behind it whatever the
            // collection happens to stock — so it falls back to the plain plates rather than
            // leaving the customer with an explanation and nothing to pick.
            if (!pool.length && arm.role === 'RETURN') pool = plain;
            slot.options = pool;
            if (!slot.options.length) {
                slot.suppressedBy = arm.name;
                slot.suppressedReason = arm.role === 'RETURN'
                    ? 'a return needs a plate and this assembly has no plate made at this depth'
                    : 'an in-line bracket takes in-line plates, and this assembly has neither in-line nor return copies';
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
        // ⚠ A RETURN TAKES THE PLATE WITH IT (Stuart 2026-08-20). It replaces the BRACKET — the arm
        // is gone — but the rod still meets the wall there and still needs a plate behind it, at
        // the same standard-included / cover-plate-upgrade prices as an in-line arm. So the plate
        // question survives the bracket it displaced, and the pairing rule above has already handed
        // it the in-line pool. An INSIDE MOUNT is different: it sits in the frame with nothing
        // behind it, so that still clears both.
        if (slot.kind === 'BACKPLATE' && by && by.role === 'RETURN') return;
        // ── A DECORATIVE END ARM SUPPORTS NOTHING (Stuart 2026-09-06, H1-2TRV) ──────────────
        // "any end arms and returns (miter, etc) are tagged no plate — not only do we hide the
        //  choice of backplate, we need to keep open the choice of left and right bracket, since
        //  these returns with no plate are purely decorative; we need brackets placed at each end
        //  for support."
        //
        // The rule above is RIGHT and stays: an ordinary return DOES carry the rod, and most
        // returns are ordinary. This is the one collection where the same shape is a facade — it
        // clamps to the fascia, holds nothing up, and the rod still needs a real bracket under it.
        //
        // ⚠ IT TAKES BOTH TAGS, AND BOTH ALREADY EXIST (Stuart, same day): "the end arms that are
        // tagged without this box checked, they use backplates and do not need brackets — they are
        // actual brackets." So END-ARM alone is load-bearing and unchanged; END-ARM **with** NO
        // PLATE is the decorative one. Nothing new to tag, and no flow that has not ticked both can
        // reach this line — which is what keeps the other four collections byte-for-byte identical.
        //
        // The plate is still gone: noBackplate suppressed it earlier, on its own rule.
        if (slot.kind === 'BRACKET' && by && by.isReturnArm && by.noBackplate) return;
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
    // …and offered once per PART, however many pieces it is pinned as, and however many BRACKET
    // FAMILIES it is pinned for. H1-138R is one rod to the customer and H1-138KF is one finial —
    // which of their pins is the right geometry is the bracket's business, not a question.
    //
    // ⚠ THE ENDS NEEDED THIS TOO (Stuart 2026-08-18: "step 11 back right end treatment is changing
    // out front right treatment that was made in step 9"). The back-right step was listing every
    // finial TWICE — once pinned for the 6.5" family and once for the 8.5" — because a double has
    // one set of ends per bracket family. Two identical-looking cards, and whichever he picked
    // second swapped the geometry the first had put on screen. When the pins carry their pair the
    // gate above has already dropped the wrong one; when they do not, the one cut for the CHOSEN
    // bracket is preferred here, and only then the first.
    const cutKey = (x) => JSON.stringify(x.projTiers || null);
    const wantCut = JSON.stringify(Object.keys(tierProj).length ? tierProj : null);
    //
    // ⚠ EVERY SLOT, NOT JUST RODS AND ENDS (Stuart 2026-08-20: "you are showing all backplates and
    // coverplates"). H1-138 carries 113 BACKPLATE pins for FOUR real plates — each pinned per
    // projection, per bracket family and per position — so the matching-plate panel listed the same
    // four products sixteen times. The in-line tag was doing its job; there were simply four copies
    // of each survivor. A plate is one product to the person choosing it, wherever it is pinned.
    //
    // (This shipped once inside the step-reorder commit and was lost when that was reverted. It is
    // on its own here so the two can never take each other down again.)
    bucket.forEach(slot => {
        const seen = new Map();
        // ⚠ A PIN THAT DECLARES ITS TIER BEATS ONE THAT DOES NOT (Stuart 2026-08-20: "when i select
        // rear it actually replaces the front finial"). H1-138 pins H1-138GF six times — four
        // tagged BACK with real rear geometry, two UNTAGGED carrying the FRONT nodes. An untagged
        // pin means "serves both rods", so it lands in the back slot too, where it has the same
        // part number as the real back pin. Whichever came first in the array won, and when that
        // was the untagged one the rear choice rendered at the FRONT — the finial appeared to swap
        // rather than a second one appear.
        //
        // Which pin is right was never a question of array order. In a slot that HAS a tier, the
        // pin that names that tier is the one cut for it. Only where they tie does the bracket
        // break it, exactly as before — so nothing moves on a collection whose pins are tagged.
        const tierFit = (o) => ((o.tier || '') === (slot.tier || '') ? 1 : 0);
        const cutFit = (o) => (cutKey(o) === wantCut ? 1 : 0);
        slot.options.forEach(o => {
            const k = String(o.partId || o.id).toUpperCase();
            const held = seen.get(k);
            if (!held) { seen.set(k, o); return; }
            if (tierFit(o) !== tierFit(held)) { if (tierFit(o) > tierFit(held)) seen.set(k, o); return; }
            // A tie is broken by the bracket: the piece cut for it wins over one cut for another.
            if (cutFit(held) < cutFit(o)) seen.set(k, o);
        });
        slot.options = slot.options.filter(o => seen.get(String(o.partId || o.id).toUpperCase()) === o);
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
        // ── PHASE 1 OF THE RESHUFFLE (Stuart 2026-08-20) ────────────────────────────────
        // "move the front left and right end selections to be the next selections after bracket
        //  projection. remember to move the rear options as well if it is double selected."
        //
        // The ends go first, then the bracket, then its plate — everything else keeps the place it
        // already had. The rear ends need no rule of their own: within a kind the sort already runs
        // FRONT before BACK, so a double gets front left, front right, back left, back right in
        // that order for free.
        //
        // ⚠ THIS IS THE SAME RANK CHANGE THAT BROKE H1-138 ON TUESDAY, and it is worth being
        // honest about why it is being made again. It was not the ordering that broke: it was that
        // moving the ends to the FRONT exposed two bugs sitting underneath them — an untiered
        // return suppressed the very end step it had been chosen in (30804a9), and a pick outlived
        // the arm that justified it (e96131c). Both are fixed and tested now, so the ends can lead
        // without opening on a step that answers "not asked". Tagged engine-good-2026-08-20 first.
        if (allTiers.length) {
            if (s.kind === 'END') k = -2;
            else if (s.kind === 'BRACKET') k = -1;
            else if (s.kind === 'BACKPLATE') k = -0.9;
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
// ── HOW MANY (Stuart 2026-08-20) ──────────────────────────────────────────────────────────────
// "rings set a recommended amount at 4 per ft plus 2 per rod, same for carriers on track it is 4
//  per ft and 1 extra for the ends which is the plus 2."
//
// One rule, two parts that obey it: a ring rides a rod and a carrier rides a track, and both are
// spaced along the length rather than counted per assembly. The +2 is the pair at the ends, not a
// fudge — which is why it does not scale with the pole.
//
// A RECOMMENDATION, not a constraint. It seeds the quantity field so the common order needs no
// typing; anything the operator types wins and is never overwritten.
export const QTY_PER_FOOT = { RING: 4, CARRIER: 4 };
export const QTY_END_ALLOWANCE = { RING: 2, CARRIER: 2 };

/** The count this part wants for a pole of `feet`, or null where length does not decide it. */
export function recommendedQty(choice, feet) {
    const per = QTY_PER_FOOT[choice?.role];
    if (!per || !(Number(feet) > 0)) return null;
    return per * Math.ceil(Number(feet)) + (QTY_END_ALLOWANCE[choice.role] || 0);
}

// ── WHICH ENDS CARRY THE ROD (Stuart 2026-08-20) ──────────────────────────────────────────────
// "if the left and right end treatment are either inside mount or returns with backplates then
//  they count as brackets, if they do not have backplates then they do not."
//
// A support is a support wherever it sits. An inside mount is bolted to the frame and a return
// with a plate is bolted to the wall — both hold the rod up, so both spend one of the supports the
// span calls for. A return with NO plate clamps to the fascia and holds nothing, which is why the
// NO PLATE tag decides this: the same tag that says "offer no plate here" also says "this end
// carries nothing", because they are the same physical fact.
//
//   8 ft wants 3 supports.  Traverse returns (no plate) → 3 in the centre.
//                           Solid returns (plated)      → 2 ends + 1 centre.
export function bearingEnds(choices = [], selectedIds = []) {
    const want = new Set((selectedIds || []).filter(Boolean).map(String));
    const chosen = choices.filter(c => want.has(c.id));
    return ['LEFT', 'RIGHT'].reduce((n, pos) => {
        const here = chosen.filter(c => String(c.position || '').toUpperCase() === pos);
        const carries = here.some(c => c.role === 'BRACKET')
            || here.some(c => c.role === 'INSIDE_MOUNT')
            || here.some(c => c.role === 'RETURN' && !c.noBackplate);
        return n + (carries ? 1 : 0);
    }, 0);
}

/**
 * How many CENTRE brackets a pole wants: the span's total, less the ends already carrying it.
 *
 * Zero is a real answer — a short pole held at both ends needs nothing in the middle — so this
 * floors at zero rather than inventing a bracket to justify the step.
 */
export function centreBracketsFor(totalSupports, endsCarrying) {
    if (!(Number(totalSupports) > 0)) return null;
    return Math.max(0, Math.round(totalSupports) - Math.max(0, Math.round(endsCarrying || 0)));
}

/** Does this decision carry a count the operator can set? */
export function takesQty(slot) {
    if (!slot) return false;
    if (slot.kind === 'RING') return true;
    // "the left and right bracket choices and left and right treatment choices do not need qty" —
    // an end has one treatment and each side has one arm. The CENTRE is the one that repeats.
    return slot.kind === 'BRACKET' && String(slot.position || '').toUpperCase() === 'CENTER';
}

export function resolve({ choices = [], answers = {}, selectedIds = [], modelNodes = [], quantities = {} } = {}) {
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
    // ⚠ THE BOM READS IN THE ORDER IT WAS ANSWERED (Eric via Stuart, 2026-08-21: "Items return in
    // the pricing chart out of order of entry"). The chosen parts used to come out in PIN order —
    // the order they happen to sit in the assembly, which is an artefact of how the .glb was built
    // and means nothing to anyone reading a quote. A quote is read against the walk that produced
    // it: rod, ends, length, brackets, plates, rings. That order already exists — it is the order
    // of the SLOTS, which is what the steps are built from — so the lines borrow it rather than
    // inventing a second one that could disagree with the screen.
    const slotRank = new Map();
    sl.forEach((slot, i) => (slot.options || []).forEach(o => { if (!slotRank.has(o.id)) slotRank.set(o.id, i); }));
    const rankOf = (c) => (slotRank.has(c.id) ? slotRank.get(c.id) : Number.MAX_SAFE_INTEGER);
    const bom = [
        // Sorted, never the source array — and stable, so two parts from one slot keep their order.
        ...norm.filter(c => selectedIds.includes(c.id) && !c.parked).sort((a, b) => rankOf(a) - rankOf(b)),
        ...riders,
        ...companions,          // the collar bills with its finial
        // ⚠ THE COUNT REACHES THE BOM, NOT JUST THE QUOTE (Stuart: "bom and router, there is
        // nothing ever that would only stay on the quote"). Pricing and the shop both read these
        // lines, so the quantity belongs here — set it in one place and neither can disagree.
    ].map(c => ({ partId: c.partId, name: c.name,
        qty: Number(quantities[c.id]) > 0 ? Number(quantities[c.id]) : c.qty,
        price: c.price, raw: c.raw,
        // ⚠ THE LINE MUST BE ABLE TO ANSWER "WHAT ARE YOU MADE OF" (Stuart 2026-08-21, prod down:
        // "we created a bug in the engine when finishes are selected"). Pricing asks the caller
        // what finish each line wears, and the caller answers with the material gate — a wood stain
        // does not land on a steel bracket. It was handed THIS ROW, which carried no materials at
        // all, so the gate read `undefined.some` and took the configurator out the moment a finish
        // was chosen. A row that is asked about its finish has to carry what a finish is judged on.
        //
        // `id` travels for the same reason: a per-part finish EXCEPTION is keyed on the choice, and
        // a row with no id could never match one.
        id: c.id, materials: c.materials, noFinish: !!c.noFinish,
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
/**
 * IS EVERY MOUNTED PART TAGGED WITH THE DEPTH IT IS MADE AT? (Stuart 2026-08-21)
 *
 * "make sure the integration/handoff to the vision tool is aligned … brackets are all tagged with
 *  projection which is what drives most of visions math and most important" — and, once the drift
 *  was on screen: "over write vision and make it use the projection for the 1.6 tags as we need to
 *  properly tag everything for the rendering to work, this way if a projection is missing it will
 *  be missing from both."
 *
 * That settled it: THE PIN'S TAG IS THE PROJECTION. It gates what this engine offers, it decides
 * what renders, and Vision now engineers the bend and the bracket spacing from it too. The library
 * item's `customData.projection` is the older field — on H1-138 most items carry none and one
 * carries a different number, because tagging moved into 1.6 and that field stopped being kept.
 *
 * So this no longer asks "do the two agree". It asks the question that is left:
 *
 *   red    the part is NOT TAGGED — nothing gates it by depth, nothing renders it correctly, and
 *          Vision has nothing to engineer from. Missing from both, which is the point of one field.
 *   amber  the item's stale field disagrees with the tag. Nothing reads it any more, but a number
 *          that contradicts the truth is drift waiting to be believed — clear it or correct it.
 *   quiet  tagged. Whether the old field is blank or agrees does not matter.
 *
 * @param model      resolve() output — RAW choices in, since resolve normalizes and normalizing an
 *                   already-normalized choice drops `proj`
 * @param fabProjOf  partId → the item's legacy customData.projection (number, or null)
 * @param flowPreset the flow's stamped projection, which overrides everything inside Vision
 * @param nameOf     partId → OUR part number. A doc id means nothing to the person fixing this
 *                   (Stuart: "it is showing app internal id which i have no idea what they are").
 */
export function projectionAudit(model, fabProjOf, flowPreset = null, nameOf = null) {
    const out = [];
    const preset = measureOf(flowPreset);
    const name = (id) => (typeof nameOf === 'function' && nameOf(id)) || id;
    const legacy = (id) => (typeof fabProjOf === 'function' ? measureOf(fabProjOf(id)) : null);
    const seen = new Set();
    (model?.choices || []).filter(c => MOUNTED_ROLES.includes(c.role) && c.partId).forEach(c => {
        const key = String(c.partId).toUpperCase();
        if (seen.has(key)) return;                 // one note per PART, however many pins it has
        seen.add(key);
        // ⚠ A CEILING BRACKET HAS A DROP, NOT A PROJECTION (Stuart 2026-08-27, on H1-75CB's red
        // note: "ceiling brackets do not get a projection, they get a drop from the ceiling, the
        // spec sheet generator is showing it correctly"). Projection is a wall-depth question;
        // demanding the tag from a ceiling pin is a false alarm that teaches people to ignore
        // this audit. The pin's own mount tag identifies it — no new tag invented.
        if (String(c.mount || '').toUpperCase() === 'CEILING') return;
        const tagged = c.projs || [];
        const tiered = c.projTiers && Object.keys(c.projTiers).length;
        if (!tagged.length && !tiered) {
            // A flow that stamps its own projection engineers from that, so an untagged part is
            // not stranded there — but it still cannot be gated by depth in this engine.
            out.push({ sev: preset != null ? 'amber' : 'red', kind: 'projection',
                msg: `${name(c.partId)} has NO projection tag in 1.6 — this engine cannot gate it by depth${preset == null ? ', and Vision has nothing to engineer the bend or the bracket spacing from' : ` (the flow's ${preset}" preset is standing in)`}.` });
            return;
        }
        const old = legacy(c.partId);
        // A DOUBLE bracket carries two depths and the legacy item master has ONE projection field
        // (Stuart 2026-08-27: "the legacy on the item master does not have fields for double
        // brackets — that is the other mismatch"). Comparing two numbers against a field that can
        // only hold one is guaranteed noise, so doubles are exempt the same way tiered pins are.
        const isDouble = String(c.setup || '').toUpperCase() === 'DOUBLE';
        if (old != null && !tiered && !isDouble && !tagged.some(t => sameMeasure(t, old))) {
            out.push({ sev: 'amber', kind: 'projection',
                msg: `${name(c.partId)} is tagged ${tagged.map(t => `${t}"`).join(' / ')}, but its ITEM still says ${old}" in the old projection field. Nothing reads that field any more — clear it or correct it before somebody believes it.` });
        }
    });
    return out;
}

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
