// ─────────────────────────────────────────────────────────────────────────────────────────────
// A VISION DRAWING, READ AS ANSWERS TO THE NEW ENGINE (Stuart 2026-08-21)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Vision is where a job is ENGINEERED — the bay is measured, the returns are drawn, the brackets
// and plates are chosen against the projection, and the O2O falls out of the geometry. CPQ then
// quotes what was engineered. That handoff is the reason Vision exists, and it spoke only to the
// old engine: handleResumeDraft translates a draft into `dynamicConfigParams` keyed by FLOW STEP
// ID, which the tag engine does not have and will never have.
//
// With the new engine launching by default, a resumed draft would have opened an empty
// configurator and every engineered decision would have been re-entered by hand — or worse, not
// noticed as missing. So the draft is translated into what this engine actually answers: picks
// (slot → choice), the world axes, and the length.
//
// WHAT MAKES THIS SAFE RATHER THAN CLEVER: it matches on PART NUMBERS, which both tools already
// agree on, and it never guesses. A pick that cannot be matched is REPORTED, not approximated —
// `missed` is as much the output as `picks`, because a silently dropped bracket is how a quote
// goes out for the wrong hardware. The caller shows both.
//
// ⚠ IT DOES NOT TOUCH PROJECTION. Since 2026-08-21 both tools read the same field — the pin's 1.6
// tag (Shared/hardwareAdapter.pinProjectionOf) — so there is nothing to translate and nothing that
// can disagree. That was the whole point of collapsing the two fields into one.

// The SAME rule the walk uses for which decisions carry a count — never a second copy of it.
import { takesQty, ROD_ROLES } from './hardwareModel.js';

const U = (v) => String(v ?? '').trim().toUpperCase();

/** Vision's mount vocabulary → the engine's `mount` axis. */
const MOUNT_TO_LOC = { OPEN: 'WALL', CEILING: 'CEILING', INSIDE: 'END' };

/**
 * Every part id a drawing carries, with the position it was chosen for where Vision knows it.
 *
 * TWO SOURCES, because Vision stores its answers twice for different reasons:
 *   · spatialData — the fabrication picks, per position (bracket + backplate, left/right/centre).
 *     These are what the drawing was engineered around, so they carry a POSITION hint.
 *   · specs — the flow's step selections (ends, rods, rings…), keyed by step id. Those are
 *     optIds, so they are resolved back to part ids through the flow's own option lists — the
 *     same lookup the old resume does, pointed the other way.
 */
export function visionPartIds(draft, flow) {
    const out = [];
    const sd = draft?.spatialData || {};
    const push = (partId, kind, position) => { if (partId) out.push({ partId: String(partId), kind, position }); };
    push(sd.bracketId, 'BRACKET', 'LEFT');
    push(sd.bracketIdRight, 'BRACKET', 'RIGHT');
    push(sd.bracketIdCenter, 'BRACKET', 'CENTER');
    push(sd.backplateIdLeft, 'BACKPLATE', 'LEFT');
    push(sd.backplateIdRight, 'BACKPLATE', 'RIGHT');
    push(sd.backplateIdCenter, 'BACKPLATE', 'CENTER');

    // The step selections. `specs` also holds metadata (engineeringNotes/collection/bracketId), so
    // only keys that resolve to a real option are taken — anything else is not a selection.
    // ⚠ THE STEP KNOWS ITS SIDE (Eric 2026-08-25, first Brimar drafts: "Right End Treatment not
    // retained"). "Left End Treatment" and "Right End Treatment" both name the same french-return
    // fee, and without a position the dedup below read them as ONE decision — the left seeded, the
    // right silently vanished. The position is right there in the step title, so it travels.
    const stepPos = (step) => {
        const t = String(step?.title || '');
        if (/\bLEFT\b/i.test(t)) return 'LEFT';
        if (/\bRIGHT\b/i.test(t)) return 'RIGHT';
        if (/\bCENT(ER|RE)\b/i.test(t)) return 'CENTER';
        return '';
    };
    const specs = draft?.specs || {};
    (flow?.steps || []).forEach(step => {
        const chosen = specs[step.id];
        if (chosen) {
            const opt = (step.styleOptions || []).find(o => (o.optId || o.partId) === chosen);
            if (opt?.partId) push(opt.partId, '', stepPos(step));
        }
        const sub = specs[`${step.id}__sub`];
        if (sub) {
            const opt = (step.subOptions || []).find(o => (o.optId || o.partId) === sub);
            if (opt?.partId) push(opt.partId, 'BACKPLATE', stepPos(step));
        }
    });
    return out;
}

/**
 * The drawing, as this engine's answers.
 *
 * @param model   resolve() output for the assembly
 * @param draft   the cpq_drafts doc
 * @param flow    the CPQ flow the draft was drawn against (for its option lists only)
 * @param sameId  (a, b) => boolean — tolerant identity, since a Vision id may be a library doc id
 *                while a pin carries the item number. The caller owns the parts index, so it owns
 *                this: the bridge never re-implements identity.
 *
 * @returns { answers, picks, lengthInches, carried, missed }
 *          `carried` and `missed` are for the operator: what came across, and what did not and why.
 */
export function seedFromVision({ model, draft, flow = null, sameId, resolveWith = null, nameOf = null }) {
    // ⚠ NAME IT BY OUR PATTERN ID (Stuart 2026-09-06, reading a live report: "CE-INV-42549 (right)").
    // A Vision id is a library record id; the walk's own rule is that a record id never reaches the
    // operator. The caller owns the parts index, so it lends the resolver — the bridge never guesses.
    const name = (id) => (typeof nameOf === 'function' ? (nameOf(id) || id) : id);
    const answers = {};
    const picks = {};
    const carried = [];
    const missed = [];
    if (!model || !draft) return { answers, picks, lengthInches: null, carried, missed, splices: [] };

    const eq = typeof sameId === 'function' ? sameId : ((a, b) => U(a) === U(b));
    const notes = draft.specs?.engineeringNotes || {};
    const sd = draft.spatialData || {};

    // ── THE LENGTH ────────────────────────────────────────────────────────────────────────────
    // The FINISHED outside-to-outside, which is what this engine's length step asks for and what
    // the pole is billed by. The RAW cut (bends and miters added back) is a different number and
    // travels on engineeringNotes, which rides the cart item to the bench — exactly as it did
    // under the old engine, where O2O went in the length box and the raw cut in the calculator.
    const lengthInches = Number(notes.poleO2O) > 0 ? Number(notes.poleO2O)
        : (Number(notes.totalSystemO2O) > 0 ? Number(notes.totalSystemO2O) : null);
    if (lengthInches) carried.push(`${lengthInches}" finished length`);
    else missed.push({ what: 'length', why: 'the drawing carries no O2O — type the finished length' });

    // ── THE MOUNT ─────────────────────────────────────────────────────────────────────────────
    // One answer for the configuration, taken from the side Vision engineers the bay from: on a
    // straight run the left mount, on a mitered or bowed one the outer.
    const vm = U(sd.shape) === 'STRAIGHT' ? (sd.mountLeft || sd.mountOuter) : (sd.mountOuter || sd.mountLeft);
    const loc = MOUNT_TO_LOC[U(vm)];
    if (loc && (model.axes || []).some(a => a.key === 'mount' && a.values.some(v => U(v) === loc))) {
        answers.mount = loc;
        carried.push(`${loc.toLowerCase()} mount`);
    } else if (vm && !loc) {
        missed.push({ what: 'mount', why: `the drawing says "${vm}", which is not a mount this assembly offers` });
    }

    // ── THE PARTS ─────────────────────────────────────────────────────────────────────────────
    // Hinted ids first — a bracket Vision chose FOR THE LEFT belongs in the left slot, even where
    // the same part is offered on both sides. Then the rest, into whatever slot offers them.
    const wanted = visionPartIds(draft, flow);
    // ⚠ A DRAWING NAMES THE SAME PART SEVERAL TIMES, AND THAT IS NOT A FAULT (Stuart 2026-08-21,
    // first Vision → new engine push: "⚠ CE-INV-51280 — nothing in this assembly offers it"
    // printed for ids the line above had just listed as carried over).
    //
    // Vision stores its answers twice — the fabrication picks per position in spatialData, and the
    // flow's step selections in specs — so a plate chosen for both ends arrives three or four times.
    // The hinted pass placed it, and then the SAME id came round again with no hint, found every
    // slot that offers it already taken, and reported it missing. It was not missing; it was
    // already on the order, and the operator was being told to go and tag something that is tagged.
    //
    // So a part that has been placed is never reported again, and the same id is not chased twice.
    const placed = [];
    const already = (partId) => placed.some(p => eq(p, partId));
    const taken = new Set();

    // Positioned ids first — a bracket drawn FOR THE LEFT belongs in the left slot even where the
    // same part is offered on both sides. Duplicates of one part-and-position are one decision.
    const seen = new Set();
    const fresh = wanted.filter(w => {
        const k = `${U(w.partId)}|${U(w.kind)}|${U(w.position)}`;
        if (seen.has(k)) return false;
        seen.add(k); return true;
    });

    // ── THE SEED SETTLES IN PASSES, EXACTLY AS THE MODEL DOES (Eric 2026-08-25) ──────────────
    // "the render is broken and selections not retained … ⚠ CE-INV-51280 — nothing in this
    // assembly offers it — it may not be pinned. This is the HUSCBPSTA item."
    //
    // It IS pinned — as a rtn-only plate, which the model only OFFERS once that end's return is
    // chosen. The old single pass placed everything against the un-picked model, so the return
    // landed and the plate it unlocks was reported missing in the same breath. So the bridge now
    // does what resolve() itself does: place what the current model offers, re-resolve with those
    // picks (the caller lends its resolver via `resolveWith`), and try the leftovers against the
    // model those picks produce — until a pass lands nothing new.
    let m = model;
    const runPass = (wants) => {
        const slots = (m.slots || []).filter(s => Array.isArray(s.options) && s.options.length);
        const claim = (slot, opt, label) => {
            picks[slot.key] = opt.id;
            taken.add(slot.key);
            placed.push(label);
            carried.push(`${name(label)}${slot.position ? ` (${slot.position.toLowerCase()})` : ''}`);
        };
        const tryHinted = (w) => {
            const pool = slots.filter(s => !taken.has(s.key)
                && (!w.kind || s.kind === w.kind)
                && (!w.position || U(s.position) === U(w.position)));
            for (const s of pool) {
                const opt = s.options.find(o => eq(o.partId, w.partId));
                if (opt) { claim(s, opt, w.partId); return true; }
            }
            // ── A BRACKET THAT IS THE END LIVES IN THE END SLOT (Stuart 2026-09-06) ──────────
            // Vision's bracket lists offer the end arms as brackets — that is what they were to
            // the old engine. Here an END-ARM bracket reads as a RETURN and pools into the End
            // step, so a drawing that chose H1-2RCTERA "for the left bracket" arrived with the arm
            // reported missing and the operator sent to check tags that were right. Same part,
            // same side, one slot over.
            if (w.kind === 'BRACKET' && w.position) {
                const ends = slots.filter(s => !taken.has(s.key) && s.kind === 'END' && U(s.position) === U(w.position));
                for (const s of ends) {
                    const opt = s.options.find(o => eq(o.partId, w.partId));
                    if (opt) { claim(s, opt, w.partId); carried[carried.length - 1] += ' — the end arm, placed as the end'; return true; }
                }
            }
            return false;
        };
        const leftovers = [];
        wants.filter(w => w.position).forEach(w => { if (!tryHinted(w) && !already(w.partId)) leftovers.push(w); });
        wants.filter(w => !w.position).forEach(w => { if (!already(w.partId) && !tryHinted(w)) leftovers.push(w); });
        return leftovers;
    };

    let remaining = fresh;
    for (let pass = 0; pass < 4; pass++) {
        const before = remaining.length;
        remaining = runPass(remaining);
        if (!remaining.length || remaining.length === before) break;   // done, or nothing landed
        if (typeof resolveWith !== 'function') break;
        const next = resolveWith({ answers, selectedIds: Object.values(picks) });
        if (!next || !Array.isArray(next.slots)) break;
        m = next;
    }

    const allChoices = () => (m.choices && m.choices.length) ? m.choices
        : [...new Map((m.slots || []).flatMap(s => s.all || s.options || []).map(c => [c.id, c])).values()];
    const placedNow = () => Object.values(picks).map(id => allChoices().find(c => c.id === id)).filter(Boolean);
    // The rod WORLD the drawing itself chose — a fascia or a track is traverse, a pole is solid.
    // Read before any rod is filled in for it, so nothing below can contradict the drawing.
    const drawnWorlds = new Set(placedNow().filter(c => ROD_ROLES.includes(c.role)).map(c => c.rodKind).filter(Boolean));
    // ⚠ THE DRAWING MAY SAY ITS ROD TYPE OUTRIGHT (Stuart 2026-09-07). Vision's Fabrication
    // Settings ask Solid / Traverse before the projection, and a traverse drawing places no rod at
    // all — so the saved answer is the first word, the drawn rods the second, and the worlds the
    // placed parts FIT (a bracket made only for the track) the last.
    const worldSaid = U(draft?.specs?.rodKind || '');
    const worldsKnown = drawnWorlds.size ? drawnWorlds : (worldSaid ? new Set([worldSaid]) : drawnWorlds);

    // ── THE ROD IS NOT A QUESTION THE DRAWING CAN ANSWER (Eric 2026-08-25: "Rod selection
    // missing") ──────────────────────────────────────────────────────────────────────────────
    // The old flow's pole lives on a calculator step — a dimension input, not a selection — so
    // the drawing has no rod id to carry. But a rod slot holding exactly ONE option is not a
    // question either; leaving it blank just breaks the render and blames the drawing. Seed it.
    (m.slots || []).filter(s => s.kind === 'ROD' && Array.isArray(s.options) && s.options.length === 1)
        .forEach(s => {
            if (picks[s.key] || taken.has(s.key)) return;
            // ⚠ NOT A ROD FROM THE OTHER WORLD (Stuart 2026-09-06). This filled every lone rod slot,
            // so a drawing that chose the FASCIA also received the solid pole in both tiers — and
            // then "traverse" and "solid" disagreed about the rod type. A lone option is only an
            // answer where it agrees with what the drawing drew.
            if (worldsKnown.size && !worldsKnown.has(s.options[0].rodKind)) return;
            picks[s.key] = s.options[0].id;
            taken.add(s.key);
            placed.push(s.options[0].partId);
            carried.push(`${name(s.options[0].partId)} — the only rod offered${s.position ? ` (${String(s.position).toLowerCase()})` : ''}`);
        });

    // What is STILL unplaced after the passes is genuinely missing — with the same grace the
    // single pass gave: a slot suppressed by another choice is not a failure, and a part already
    // on the order is not reported again.
    remaining.forEach(w => {
        if (already(w.partId)) return;
        if (w.position) {
            const suppressed = (m.slots || []).some(s => s.kind === w.kind && U(s.position) === U(w.position) && s.suppressedBy);
            if (suppressed) return;
            missed.push({ what: name(w.partId), why: `no ${String(w.kind || 'slot').toLowerCase()} at ${String(w.position).toLowerCase()} offers it — check the tags in 1.6` });
        } else {
            missed.push({ what: name(w.partId), why: 'nothing in this assembly offers it — it may not be pinned' });
        }
    });

    // ── THE SPLICES THE DRAWING PLACED (Eric 2026-08-25: drew two splices; none arrived) ─────
    // The drawing knows WHERE each splice sits — that is the whole point of drawing them. They
    // ride out as data; the caller owns the flow's splice item and the extras list, so it decides
    // which code carries them. STRAIGHT runs read START/END as the pole's own edges.
    const splices = (Array.isArray(sd.attachments) ? sd.attachments : [])
        .filter(a => a && a.type === 'splice')
        .map(a => ({
            distInches: (a.distInches !== undefined && a.distInches !== null) ? a.distInches : null,
            ref: a.ref || '',
            note: (a.note && typeof a.note === 'string') ? a.note.trim() : '',
        }));

    // ── THE FRAMING, READ OFF WHAT WAS PLACED (Stuart 2026-09-06) ────────────────────────────
    // "all the steps of the cpq for the rods, and brackets and returns should align in either
    //  direction starting in vision and then the selections populating cpq."
    //
    // The parts came across; the QUESTIONS did not. Only `mount` was ever answered, so a seeded
    // configuration opened with Rod Setup and Projection blank — invisible on Brimar, where one
    // world and one setup are implied, and wrong on a traverse double, where answering step one
    // differently from what the drawing chose drops the picks it chose.
    //
    // The parts already say the answer. A bracket tagged DOUBLE is a double; a track is a traverse
    // rod; a fascia in front is the stationary front; a drawn end carries its drive; a bracket made
    // in one depth IS the projection. So each live, unanswered axis is answered when every placed
    // part that speaks to it agrees on ONE value the assembly offers — and never otherwise. A
    // disagreement, or silence, is left to the operator and said so. A tiered bracket answers no
    // projection on purpose: on that assembly the bracket IS the projection question.
    const axisOffers = (key, value) => {
        const axis = (m.axes || []).find(a => a.key === key);
        return !!axis && !axis.implied && (axis.values || []).find(v => String(v).toUpperCase() === String(value).toUpperCase());
    };
    const answerFrom = (key, values, source) => {
        if (answers[key] !== undefined) return false;
        const distinct = [...new Set(values.filter(v => v !== '' && v !== undefined && v !== null).map(v => String(v).toUpperCase()))];
        if (distinct.length !== 1) {
            const what = key === 'proj' ? 'projection' : key;
            if (distinct.length > 1 && !missed.some(x => x.what === what)) missed.push({ what, why: `the parts drawn disagree (${distinct.map(d => d.toLowerCase()).join(' / ')}) — answer it on the walk` });
            return false;
        }
        const offered = axisOffers(key, distinct[0]);
        if (!offered) return false;
        answers[key] = offered;
        const say = key === 'proj' ? `${offered}" projection` : String(offered).toLowerCase() === 'FASCIA'.toLowerCase() ? 'stationary fascia with rings'
            : String(offered).toLowerCase() === 'track' && key === 'frontLayer' ? 'track front & rear' : String(offered).toLowerCase();
        carried.push(`${say} — from the ${source}`);
        return true;
    };
    const deriveRound = () => {
        const p = placedNow();
        let any = false;
        const fitWorlds = p.filter(c => !ROD_ROLES.includes(c.role) && !c.always && Array.isArray(c.fits) && c.fits.length === 1).map(c => c.fits[0]);
        any = (!!worldSaid && answerFrom('rodKind', [worldSaid], 'rod type chosen on the drawing'))
            || answerFrom('rodKind', [...drawnWorlds], 'rod drawn')
            || answerFrom('rodKind', fitWorlds, 'parts drawn') || any;
        any = answerFrom('setup', p.map(c => c.setup), 'parts drawn') || any;
        any = answerFrom('drive', p.map(c => c.drive), 'track ends drawn') || any;
        // Only a bracket made in ONE depth speaks; a tiered one is the question itself.
        any = answerFrom('proj', p.filter(c => ['BRACKET', 'BACKPLATE'].includes(c.role) && !c.projTiers && Array.isArray(c.projs) && c.projs.length === 1).map(c => c.projs[0]), 'bracket drawn') || any;
        const fronts = [
            ...p.filter(c => c.role === 'FASCIA').map(() => 'FASCIA'),
            ...p.filter(c => c.role === 'TRACK' && (U(c.tier) || 'FRONT') === 'FRONT').map(() => 'TRACK'),
            ...p.map(c => c.frontLayer),
        ];
        any = answerFrom('frontLayer', fronts, 'front drawn') || any;
        return any;
    };
    if (deriveRound() && typeof resolveWith === 'function') {
        // A gated axis (the front of a double) only exists once setup is answered — resolve once
        // more with what was just answered so it can be read, then read it.
        const next = resolveWith({ answers, selectedIds: Object.values(picks) });
        if (next && Array.isArray(next.slots)) { m = next; deriveRound(); }
    }

    // ── HOW MANY IS NOT THE DRAWING'S TO SAY (Stuart 2026-08-22) ─────────────────────────────
    // Eric, testing Vision → CPQ: "⚠ CE-INV-10286 — nothing in this assembly offers it… this times
    // 3, which should be the extension bracket where I had three."
    //
    // Three of one bracket is a QUANTITY, and the bridge has never carried one — visionPartIds
    // records {partId, kind, position} and `picks` holds one option per slot, so a count has no
    // field to travel in. That is deliberate rather than missing, and it should stay that way:
    // THIS ENGINE ALREADY WORKS THE NUMBER OUT, and works it out from things the drawing does not
    // know. centreBracketsFor takes the span 6.5 gives for the rod family at the quoted fabric
    // weight and subtracts bearingEnds — the rule that a plated return or an inside mount spends a
    // support while a no-plate return does not. A number sent across would be a second source of
    // truth for a figure derived here, free to disagree with it.
    //
    // So the drawing states the BUILD STYLE — which bracket, and where — and the count is settled
    // in the walk. Said out loud, because a silence reads as data lost in transit.
    const qtySlots = Object.keys(picks)
        .map(k => (m.slots || []).find(s => s.key === k))
        .filter(s => s && takesQty(s));
    if (qtySlots.length) {
        const what = [...new Set(qtySlots.map(s => s.kind === 'RING' ? 'ring' : 'centre bracket'))];
        carried.push(`${what.join(' and ')} style — the COUNT is set here from the span, not by the drawing`);
    }

    return { answers, picks, lengthInches, carried, missed, splices };
}
