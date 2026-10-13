// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE CONFIGURATION, WITHOUT THE SCREEN (Stuart 2026-10-12, the portal rebuild)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// "ok as long as we can always keep in total alignment."
//
// hardwareModel says what an assembly OFFERS, hardwarePricing what a resolved configuration COSTS,
// hardwareHandoff what the cart line LOOKS like. Between them sits the configuration itself — which
// part a pin points at for the size chosen, which picks survive a later answer, how many rings eight
// feet takes, which finish each part wears — and that lived inside the CPQ screen
// (HardwareConfigurator.js), where nothing but that screen could run it.
//
// The customer portal is being rebuilt on this engine. A second screen that worked the same things
// out its own way would agree with HQ only until the first rule changed — which is exactly how the
// old portal fell two months behind. So the working-out moves HERE, a piece at a time, and the CPQ
// screen calls it: one implementation, three callers (HQ's screen, the portal's screen, the
// portal's server). Each function below is the body of the memo it replaced — MOVED, not
// re-thought — with what it closed over handed in as arguments, and the words that explain the
// rule moved with it.
//
// Pure: no React, no Firebase, only the engine files beside it, imported with their .js (the rule
// scripts/sync-engine.mjs enforces — it copies this file to the portal's server with the rest).
// Harness: scripts/hardwareSession.test.mjs.

import { choicesFromAssembly, modelNodesOf } from './hardwareAdapter.js';
import { resolve, reseatPicks, recommendedQty, bearingEnds, centreBracketsFor, finishesFor } from './hardwareModel.js';
import { autoPicksOf } from './hardwareAutoPicks.js';
import { SIZE_STEP_TYPE, sizeSelectionsOf, buildSizeIndex, sizeVariantOf, partAllowedAtSize, returnsAllowedFor, projInchesOfSel } from './sizeMatrix.js';
import { bracketAdviceFor, DEFAULT_DROP_FT } from './bracketSpan.js';
import { carrierRows } from './traverseConfigurator.js';
import { usageAt } from './traverseExplode.js';
import { rodMaterialsOf, extrasForRod, liveExtrasOf } from './flowExtras.js';
import { normalizeExtras } from './extrasRestore.js';
import { wearsAsTwin } from './materialTwin.js';
import { subFinishOfFinish } from './subFinish.js';

// ── THE PARTS, AND HOW ONE IS FOUND ──────────────────────────────────────────────────────────
// A pin can be tagged with the library record's id, its itemId or OUR number, so every one of them
// finds the part: UPPERCASED, and the first record to claim a key keeps it. 'PENDING' is the
// placeholder on an item that has not been numbered yet — it is nobody's number.
export function partIndexOf(parts) {
    const m = new Map();
    (parts || []).forEach(pt => [pt.id, pt.itemId, pt.legacyErpId].forEach(k => {
        const kk = String(k || '').trim().toUpperCase();
        if (kk && kk !== 'PENDING' && !m.has(kk)) m.set(kk, pt);
    }));
    return m;
}
export const partIn = (partIndex, id) => partIndex.get(String(id || '').trim().toUpperCase()) || null;

// OUR PART NUMBER IS `legacyErpId` (Stuart 2026-08-17: "should be the field labelled legacy erp
// id"). H1-138BE is the number the shop, the catalogue and the customer all use; CE-INV-61954 is
// the app's own record id and means nothing off the screen. A pin can be tagged with either, so
// the pin's id is resolved to the library item and OUR number read off it — never printed raw.
// 'PENDING' is the placeholder on an item that has not been numbered yet, so it never prints.
export function ourNumberOf(pt, id) {
    const legacy = String(pt?.legacyErpId || '').trim();
    if (legacy && legacy.toUpperCase() !== 'PENDING') return legacy;
    return String(pt?.itemId || id || '').trim();
}

// ── ONE FLOW, EVERY DIAMETER (Stuart 2026-08-21) ─────────────────────────────────────────────
// "can you integrate the H2 combined flow with the new engine."
//
// H2-05 / H2-75 / H2-1 / H2-138 are ONE flow whose first question is the rod diameter, and the
// geometry is the H2-138 master — the fullest of the four. Everything else is the same product
// in another size, resolved through the code grammar (Shared/sizeMatrix). H1 goes the same way
// next, which is why none of this is written per-collection.
//
// ⚠ THE SWAP HAPPENS ON THE CHOICE, WHICH IS WHY IT IS THIS SMALL. Change the part a pin points
// AT and the whole engine follows for free: the cards name the right item, pricing bills it,
// the BOM carries it, the push maps it, the handoff hands it over. The pin's NODES are left
// alone on purpose — the render is the 138 master scaled, not four sets of geometry.
export const sizeStepsOf = (flow) => (flow?.steps || []).filter(st => st?.type === SIZE_STEP_TYPE);
// sizeSelectionsOf falls back to the family's base cell, so `sel` is complete from the first
// render — an unanswered diameter quotes the base size rather than nothing at all.
export const sizeSelOf = (flow, sizePick, sizeSteps) => (sizeSteps.length ? sizeSelectionsOf(flow, sizePick) : null);
export const sizeIndexOf = (sizeSel, parts) => (sizeSel ? buildSizeIndex(parts) : null);
export function choicesAtSize({ assembly, pins, sizeSel, sizeIndex, findPart }) {
    const raw = choicesFromAssembly(assembly, pins);
    if (!sizeSel || !sizeIndex) return raw;
    const returnsOk = returnsAllowedFor(sizeSel);
    const out = [];
    raw.forEach(c => {
        // A RETURN NEEDS DEPTH. At the shallow projection this collection makes no return, so
        // it is not offered — the same rule the old engine applies (returnsMinProj).
        if (!returnsOk && c.role === 'RETURN') return;
        const part = findPart(c.partId);
        if (!part) { out.push(c); return; }          // unresolvable parts are the diagnostics' problem
        // Not made at this size — not a choice at this size. A stamped family knows; an
        // unstamped part is left alone and behaves exactly as it does today.
        if (!partAllowedAtSize(part, sizeSel, sizeIndex)) return;
        const swapped = sizeVariantOf(part, sizeSel, sizeIndex);
        out.push(swapped.swapped && swapped.part ? { ...c, partId: swapped.part.id } : c);
    });
    return out;
}
// The size matrix answers the projection question for a combined flow, so the engine's own
// proj context is taken from it rather than asked twice. Untouched where there is no matrix.
export const sizeProjInchesOf = (sizeSel) => (sizeSel ? projInchesOfSel(sizeSel) : null);
export const answersAtSize = (answers, sizeProjInches) => (sizeProjInches != null ? { ...answers, proj: sizeProjInches } : answers);

// ── THE PICKS SETTLE ─────────────────────────────────────────────────────────────────────────
// ⚠ A PICK IS ONLY JUSTIFIED BY THE MODEL IT APPEARS IN, AND DROPPING ONE CHANGES THAT MODEL
// (Stuart 2026-08-20: "it deletes the bracket arms which is correct but it leaves the
//  backplates"). Pick brackets, then a return, and the plate stayed on the quote — three
// BP-S lines for two brackets.
//
// The filter has always dropped a pick that is no longer offered, but it read a model built
// from the RAW picks — so the suppressed bracket was still "chosen" as far as the model was
// concerned, the plate pool was still the bracket's plain pool, and the stale plate was still a
// valid option. One pass cannot see this: it is DROPPING THE BRACKET that makes the plate
// invalid, and that only becomes true on the next pass.
//
// So it settles. Each pass keeps the picks the current model still offers and re-resolves;
// when a pass drops nothing, the selection and the model agree and we stop. In the steady
// state — nothing to drop — this is exactly one resolve, as before.
// ⚠ REPLACE THE PIN, KEEP THE PART (Stuart 2026-08-20: "the incorrect finial disappears — you
// just need to replace with the correct one"). A finial is pinned once per bracket family, so
// choosing the OTHER double bracket invalidates the pin the customer picked — but not the part
// they chose. Dropping it empties a step they already answered and blames them for the
// bracket. The same part number, cut for the bracket now chosen, is sitting right there in the
// slot; the pick moves to it (hardwareModel.reseatPicks).
export function settle({ choices, answers, picks, modelNodes }) {
    let sel = Object.values(picks).filter(Boolean);
    let m = resolve({ choices, answers, selectedIds: sel, modelNodes });
    for (let pass = 0; pass < 4; pass++) {
        const next = Object.values(reseatPicks(m, picks));
        if (next.length === sel.length && next.every(id => sel.includes(id))) break;
        sel = next;
        m = resolve({ choices, answers, selectedIds: sel, modelNodes });
    }
    return m;
}

// ── LENGTH, AND WHAT IT IMPLIES ──────────────────────────────────────────────────────────────
// Typed the way an installer measures — whole inches and a fraction — and the FOOT figure is
// derived, because feet is what prices. One typed number, one shown consequence, no chance of
// the two disagreeing.
export function lengthInchesOf(poleIn, poleFrac) {
    const whole = parseFloat(poleIn);
    const m = String(poleFrac).trim().match(/^(\d+)\s*\/\s*(\d+)$/);
    const frac = m ? Number(m[1]) / Number(m[2]) : (parseFloat(poleFrac) || 0);
    const total = (Number.isFinite(whole) ? whole : 0) + (Number.isFinite(frac) ? frac : 0);
    return total > 0 ? total : null;
}
// ⚠ WE BILL IN FULL FEET, ROUNDED UP (Stuart 2026-08-17: "even if .25\" over we bill next foot
// size"). A pole is cut from stock in whole feet, so 90 1/2" is eight feet of material however
// the arithmetic reads. Showing the exact figure beside it keeps the operator honest about what
// was measured versus what is being charged.
export const lengthFeetExactOf = (lengthInches) => (lengthInches ? Math.round((lengthInches / 12) * 100) / 100 : null);
export const lengthFeetOf = (lengthInches) => (lengthInches ? Math.ceil(lengthInches / 12) : null);
// A SAVED length goes back into the two fields it was typed in — whole inches, and the fraction in
// sixteenths. That is the length a reopened line is then worked from, so it is the length every
// caller starts from (a saved 96.3" is 96 5/16").
export function lengthFieldsOf(lengthInches) {
    if (Number(lengthInches) > 0) {
        const whole = Math.floor(Number(lengthInches));
        const frac = Number(lengthInches) - whole;
        return { poleIn: String(whole), poleFrac: frac > 0.001 ? `${Math.round(frac * 16)}/16` : '' };
    }
    return { poleIn: '', poleFrac: '' };
}

// ── THE BRACKET RECOMMENDATION, from the engineering in 6.5 rather than a number in a file ────────
// ⚠ 6.5 IS KEYED ON OUR ITEM CODE, AND A PIN CARRIES THE LIBRARY DOC ID (Stuart 2026-08-20:
// "the fabric weight for bracket span states nothing is set up, but it is set up"). It IS set
// up — `H1-1.375 → H1-138R` — but this asked for `CE-INV-61954`, which no family claims, so
// every rod reported itself unlisted. ourId() is the same resolver the cards and the quote
// lines use, so what we look up is what he typed in 6.5.
export function bracketAdviceOf({ model, livePicks, lengthInches, spanMap, spanCaps, fabricId, ourId }) {
    // ⚠ READS `model`, NOT `resolved` (2026-08-20). The centre-bracket recommendation feeds
    // the quantities, which feed resolve — so taking the rod from the RESOLVED model would
    // close the loop: advice → quantities → resolved → advice. The pre-quantity model already
    // knows which rod was chosen, and a count never changes that.
    const ids = new Set(Object.values(livePicks));
    const rod = model.choices.find(c => ids.has(c.id) && ['ROD', 'FASCIA', 'TRACK'].includes(c.role));
    if (!rod || !lengthInches) return null;
    return bracketAdviceFor({ itemCode: ourId(rod.partId) || rod.name || rod.partId, map: spanMap, caps: spanCaps, rodInches: lengthInches, fabricId, dropFt: DEFAULT_DROP_FT });
}

// ── HOW MANY OF EACH (Stuart 2026-08-20) ─────────────────────────────────────────────────────
// Rings and carriers are spaced along the pole, so their count follows its length: four a foot
// plus the pair at the ends. That is a RECOMMENDATION — it seeds the field so the ordinary
// order needs no typing, and anything typed wins and is never overwritten.
//
// Carriers are riders: never offered, always built. They still need the right count, so they
// are seeded here rather than at a step that does not exist.
// How many the ENGINEERING wants for a step, or null where nothing decides it. Rings and
// carriers come from the length; the centre bracket comes from the span less whatever the ends
// are already carrying. Read by both the seeding below and the field's placeholder, so what is
// billed and what is shown can never drift apart.
export function recommendedFor({ slot, choice, advice, model, livePicks, lengthFeet }) {
    if (!slot) return null;
    if (slot.kind === 'BRACKET' && String(slot.position || '').toUpperCase() === 'CENTER') {
        return advice ? centreBracketsFor(advice.brackets, bearingEnds(model.choices, Object.values(livePicks), model.slots)) : null;
    }
    return recommendedQty(choice, lengthFeet);
}
export function quantitiesOf({ model, livePicks, stepQty, lengthFeet, recommendFor, trvRules, ourId }) {
    const q = {};
    model.slots.forEach(sl => {
        const id = livePicks[sl.key];
        if (!id) return;
        const typed = Number(stepQty[sl.key]);
        if (typed > 0) { q[id] = typed; return; }
        const rec = recommendFor(sl, sl.options.find(o => o.id === id));
        if (rec != null && rec > 0) q[id] = rec;
    });
    (model.riders || []).forEach(r => {
        // ONE CARRIER COUNT (Stuart 2026-09-19): where the collection's chart has a row for this
        // carrier, the chart IS the count at the length ordered (pinch pleat 4 a foot — 8 at 18") —
        // the same number the Traverse components step and the kit cover read. The old four-a-foot-
        // plus-two stays for a collection with no chart.
        const row = (r.role === 'CARRIER' && lengthFeet > 0 && trvRules)
            ? carrierRows(trvRules).find(u => String(u.itemId || '').trim().toUpperCase() === String(ourId(r.partId) || '').trim().toUpperCase()) : null;
        const rec = row ? usageAt(row, Math.max(lengthFeet, 2)) : recommendedQty(r, lengthFeet);
        if (rec) q[r.id] = rec;
    });
    return q;
}
// The configuration with its counts — what is rendered, priced and handed to the cart.
export const resolvedOf = ({ choices, answers, livePicks, modelNodes, quantities }) => resolve({ choices, answers, selectedIds: Object.values(livePicks), modelNodes, quantities });

// ── IS A SPLICE NECESSARY? (Stuart 2026-08-24) ───────────────────────────────────────────────
// "add the splice ability [to] the rod length step on the cpq — is splice necessary and
//  default is center, explain if otherwise. this should help align it with the vision tool
//  which is where we actually draw the splice location."
// The splice among a flow's add-by-hand items is found the way tab 7 finds its splice
// slot — by what the ITEM says it is (splice/joiner in its name, product type or fee type).
// ⚠ AVAILABLE AT ANY LENGTH, MANDATORY OVER THE LIMIT (Stuart 2026-08-24: "a lot of times
// customers order one before it is needed to save on shipping or for convenience. so it
// needs to be mandatory over 120\" but can be available at any length"). The extras list
// offers the splice at every length; over the flow's `spliceOverInches` (tab 11, blank =
// 120") it is REQUIRED — added automatically at the default, CENTER of the run, and re-added
// if removed, because a pole that long does not ship in one piece. The note carries the
// exact location only when it differs, which is precisely what Vision reads to draw it.
// Joiners are DIAMETER-SPECIFIC, and a multi-size flow derives several candidates — the
// step must never guess a diameter, so with ONE candidate it adds it itself and with more
// it requires the operator to add the right one (the banner says so).
// Only the items offered with the chosen rod are candidates — a wood rod's joiner is not a
// steel rod's candidate — so H1-138 with one joiner per material still has ONE to auto-add.
export function spliceCodesAmong(items, findPart) {
    const out = [];
    for (const it of (items || [])) {
        const part = findPart(it.code);
        const hay = `${it.code || ''} ${it.label || ''} ${part?.itemName || ''} ${part?.manufacturingSpecs?.productType || ''} ${part?.customData?.feeType || ''}`.toUpperCase();
        if (/SPLICE|JOINER|JNR|SPLC/.test(hay)) out.push(it.code);
    }
    return out;
}
export const singleSpliceOf = (spliceCodes) => (spliceCodes.length === 1 ? spliceCodes[0] : null);
export const spliceLimitOf = (flow) => (Number(flow?.spliceOverInches) > 0 ? Number(flow.spliceOverInches) : 120);
export const spliceIsNeeded = (spliceCodes, lengthInches, spliceOverIn) => spliceCodes.length > 0 && !!lengthInches && lengthInches > spliceOverIn;
// The same ITEM under any of its names (our number, the doc id) — never a string compare alone,
// which is what let a doc-id row and a code row both stand for one joiner (QUO147).
export function sameItem(a, b, findPart) {
    if (String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase()) return true;
    const pa = findPart(a), pb = findPart(b);
    return !!(pa && pb && pa.id && pa.id === pb.id);
}
export const spliceIsSatisfied = (spliceCodes, extras, sameItemCode) => spliceCodes.some(c => extras.some(x => sameItemCode(x.code, c) && Number(x.qty) > 0));
// The row the length step adds on its own, once: the list as it stands when the joiner is already on it
// (the SAME list — nothing to re-render), else the list with the one joiner at 1.
export const withRequiredSplice = (typedExtras, spliceCode, sameItemCode) =>
    (typedExtras.some(x => sameItemCode(x.code, spliceCode) && Number(x.qty) > 0) ? typedExtras : [...typedExtras.filter(x => !sameItemCode(x.code, spliceCode)), { code: spliceCode, qty: '1', note: '' }]);

// ── WHICH FINISH EACH PART WEARS ─────────────────────────────────────────────────────────────
// ── ONE DEFAULT PER MATERIAL (Stuart 2026-09-09: "when i just selected finish for the metal
// center bracket it removed my finish selection of the wood components"). The rail still sets a
// default for every step at once — that is the typical order — but a stain and a paint are two
// defaults, one per material, held side by side; a part wears the one its material can take,
// and "just this part" (a wood gem finial and its metal collar each have their own) overrules
// it on any step exactly as before. `globalFinish` stays the METAL default for the readers that
// want one code: the per-foot rod pricing, the track's stock colour, the kit and Vision seeds.
export const globalFinishOf = (globalFinishes) => globalFinishes.METAL || Object.values(globalFinishes).find(Boolean) || '';
export function finishIndexOf(finishes) {
    const m = new Map();
    finishes.forEach(f => { const k = String(f.code || f.name || '').toUpperCase(); if (k) m.set(k, f); });
    return m;
}
export const materialOfFinish = (f) => String((f && (f.material || f.type)) || 'METAL').toUpperCase();
// A single code lands in its material's slot (seeds, restores); blank clears every default.
export function withGlobalFinish(globalFinishes, code, finishByCode) {
    const c = String(code || '').toUpperCase();
    if (!c) return {};
    const f = finishByCode.get(c);
    return { ...globalFinishes, [materialOfFinish(f)]: c };
}
// ── WHO WEARS A FINISH (Stuart 2026-10-06, the 1" brass · Shared/materialTwin) ─────────────────
// The material rule, as ever (hardwareModel.finishesFor) — and a part ALSO wears a finish of a material
// its library record names a TWIN in: LBR is a BRASS finish, and H1-1BS is made in brass as H1-1BBS.
// "it is just the parts listed": a part with no brass twin does not wear LBR, on any path.
export const wearsAsTwinFinish = (c, f, findPart) => !!c && !!f && !c.noFinish && !finishesFor(c, [f]).length
    && wearsAsTwin(findPart(c.partId), f, findPart);
export const wearsFinishOf = (c, f, twinWear) => !!c && !!f && (finishesFor(c, [f]).length > 0 || twinWear(c, f));
// The default THIS part wears: the material's own pick. A finish the part wears as a twin outranks the
// one of its own material — pick LBR for the configuration and the brass-made parts go brass while
// everything else keeps the metal finish.
export function globalFinishForChoice(c, { globalFinishes, finishByCode, twinWear }) {
    const picks = Object.values(globalFinishes).map(code => [String(code || '').toUpperCase(), finishByCode.get(String(code || '').toUpperCase())]).filter(([, f]) => f);
    const asTwin = picks.find(([, f]) => twinWear(c, f));
    if (asTwin) return asTwin[0];
    for (const [code, f] of picks) if (finishesFor(c, [f]).length) return code;
    return '';
}
export const chosenListOf = (resolved, livePicks) =>
    [...resolved.choices.filter(c => Object.values(livePicks).includes(c.id)), ...resolved.riders, ...resolved.companions];
// What a given part is wearing: its own finish in per-part mode, the configuration's otherwise.
// ONE FINISH, THEN ANY EXCEPTIONS (Stuart 2026-08-17: "select a finish once for the whole
// config, select again at any part you would like in another finish"). The override is always
// available — it is not a mode to turn on. A part wears its own finish if one was set for it,
// and the configuration's otherwise, so the common order is one click and the mixed one is two.
export function partFinishByPartOf(partFinish, model) {
    const m = {};
    Object.entries(partFinish).forEach(([id, code]) => {
        const c = model.choices.find(x => x.id === id);
        if (c?.partId) m[String(c.partId).toUpperCase()] = code;
    });
    return m;
}
// ── A PLATE WEARS ITS ARM'S FINISH (Stuart 2026-09-09: "the bracket arm takes a finish code but
// the matching backplate/coverplate does not, stays mill finish"). "Just this part" on a bracket
// means the bracket AND the plate it sits on — they are one piece of hardware on the wall. A
// plate with no finish of its own follows the arm holding the rod at its position: the return
// or inside mount when one is chosen there, else the bracket. Its own pick still wins.
export function armFinishOfChoice(c, { resolved, livePicks, partFinish, partFinishByPart }) {
    if (!c || c.role !== 'BACKPLATE') return '';
    const pos = String(c.position || '').toUpperCase();
    const pickAt = (kind) => {
        const sl = resolved.slots.find(x => x.kind === kind && String(x.position || '').toUpperCase() === pos);
        const id = sl ? livePicks[sl.key] : '';
        return id ? (sl.options || []).find(o => o.id === id) || null : null;
    };
    const end = pickAt('END');
    const arm = (end && ['RETURN', 'INSIDE_MOUNT'].includes(end.role)) ? end : pickAt('BRACKET');
    if (!arm) return '';
    return partFinish[arm.id] || partFinishByPart[String(arm.partId || '').toUpperCase()] || '';
}
export const finishForChoice = (c, { partFinish, armFinishOf, globalFinishFor }) => partFinish[c.id] || armFinishOf(c) || globalFinishFor(c);

// ── A CUSTOM-FINISHED TRACK WEARS THE FASCIA'S FINISH (Stuart 2026-08-31) ────────────────
// "one tick per track and we will need if ticked to associate the same finish color as
//  selected for the fascia in the cpq." The stock track is bronze or champagne and never asks
// a finish question — the upcharge FEE on a track step IS the decision to paint it. So a fee
// extra ticked on a track step dresses THAT track in whatever the fascia is wearing (its own
// exception first, the configuration finish otherwise) — and it stays LIVE: change the
// fascia's finish and the paint-matched track follows, because this is derived, never copied.
// Scoped by data on every side: only a FEE item (partClass/productType, the same test the CPQ
// uses) ticked on a TRACK slot can arm it, and only traverse assemblies have track slots.
export function matchFinishOverrideOf({ extras, findPart, chosenList, finishFor, globalFinish, model, livePicks }) {
    const out = {};
    const isFeePart = (p) => !!(p && (p.partClass === 'Fee'
        || String(p.manufacturingSpecs?.productType || p.productType || '').toUpperCase() === 'FEE'));
    const feeSlots = new Set(extras
        .filter(x => Number(x.qty) > 0 && x.slot && isFeePart(findPart(x.code)))
        .map(x => x.slot));
    if (!feeSlots.size) return out;
    const fascia = chosenList.find(c => c.role === 'FASCIA');
    const code = fascia ? finishFor(fascia) : globalFinish;
    if (!code) return out;
    model.slots.filter(s => s.kind === 'TRACK' && feeSlots.has(s.key)).forEach(s => {
        const pick = livePicks[s.key];
        if (pick) out[pick] = code;
    });
    return out;
}

// ── THE FINISH A LINE IS ACTUALLY BILLED AND SPRAYED IN (Stuart 2026-08-21) ───────────────
// "once the finish is chosen to the left it needs to list the chosen color in the pricing
// window as well of course in the bom to send along to finishing … in case people do choose
// different finishes for different parts."
//
// Three things had to agree and only two did. The RENDER already painted per part; the PRICE
// and the sheet that reaches finishing read one code for the whole configuration. So brass
// rings on a black pole rendered brass, billed the black variant and told the floor black.
//
// ⚠ AN EXCEPTION IS KEYED ON THE CHOICE, AND A PART IS OFTEN SEVERAL PINS. A pole is three —
// left, core, right — so a finish set on the one the customer clicked would leave its own other
// two segments billing the configuration finish. The exception therefore travels by PART: same
// part number, same finish, which is what "just this part" means to the person clicking it.
// …and the MATERIAL GATE is applied here, exactly as the renderer applies it: a part wears only
// a finish its material can take, so a wood stain chosen for the configuration does not bill a
// stained bracket, and clear acrylic bills and sprays as nothing at all.
// ── A RETURN CUT INTO THE POLE WEARS THE POLE'S FINISH (Stuart 2026-09-18, SO60551 row 2: the
// miter return on a stained oak fascia went to the floor as EP4). A miter, a French return, a bend
// is a FEE — fabrication ON the rod, not a part beside it — so it has no material of its own to
// gate and no finish of its own to pick: it is whatever the rod it is cut into is. Derived, never
// copied, exactly as a plate follows its arm: change the rod's finish and the return follows.
// Scoped by data on both sides — role RETURN, and the library record is a Fee — so a real cast
// return bracket (an item) keeps the material rule it always had. The rod of the same tier on a
// double; its own per-part pick still wins.
export const isFeeRecord = (p) => !!(p && (p.partClass === 'Fee'
    || String(p.manufacturingSpecs?.productType || p.productType || '').toUpperCase() === 'FEE'));
export function rodFinishForChoice(choice, { chosenList, partFinish, partFinishByPart, globalFinishFor }) {
    const rods = chosenList.filter(c => ['ROD', 'FASCIA'].includes(c.role));
    if (!rods.length) return '';
    const tier = String((choice && choice.tier) || '').toUpperCase();
    const rod = (tier && rods.find(r => String(r.tier || '').toUpperCase() === tier)) || rods[0];
    return String(partFinish[rod.id] || partFinishByPart[String(rod.partId || '').toUpperCase()] || globalFinishFor(rod) || '').toUpperCase();
}
export const followsRodChoice = (choice, findPart) => !!choice && choice.role === 'RETURN' && isFeeRecord(findPart(choice.partId));
// ── THE STOCK COLOUR A PART IS MADE IN (Stuart 2026-09-18) — the sub finish 4.5 aligns to the ROD's
// finish first (S04 → TCP, so a stained traverse gets champagne brackets whatever the metal slot
// holds), the configuration's otherwise. Only a track, or an item the library says uses it.
export function subFinishForChoice(choice, part, { findPart, finishByCode, rodFinishFor, globalFinish }) {
    if (!choice) return '';
    const takes = choice.role === 'TRACK' || !!(part || findPart(choice.partId))?.manufacturingSpecs?.usesSubFinish;
    if (!takes) return '';
    // The ONE lookup the floor routes read too (Shared/subFinish.subFinishOfFinish, 2026-09-27).
    const subOf = (code) => subFinishOfFinish(code, [finishByCode.get(String(code || '').toUpperCase())].filter(Boolean));
    return subOf(rodFinishFor(choice)) || subOf(globalFinish);
}
export function lineFinishForChoice(choice, { partFinish, partFinishByPart, armFinishOf, globalFinishFor, finishByCode, matchFinishOverride, followsRod, rodFinishFor, findPart, wearsFinish }) {
    // The paint-to-match override outranks every gate — noFinish and the material rule say
    // what the STOCK part takes, and the upcharge is precisely the decision to overrule that.
    if (choice && matchFinishOverride[choice.id]) return matchFinishOverride[choice.id];
    // A TRACK ships in its stock finish (bronze or champagne, matched to the fascia in the
    // library) — the configuration's finish never lands on it uninvited, or every quote would
    // send the floor an unpaid paint job. Only the upcharge above can paint a track.
    if (choice && choice.role === 'TRACK') return '';
    if (!choice || choice.noFinish) return '';
    // A return cut into the pole: the rod's finish, past the material gate (it IS the pole).
    if (followsRod(choice)) return partFinish[choice.id] || rodFinishFor(choice);
    // A part made in a stock colour wears no finish unless one was picked for IT — the configuration's
    // metal finish does not repaint a champagne bracket uninvited (the track has always worked so).
    if (choice.role !== 'TRACK' && findPart(choice.partId)?.manufacturingSpecs?.usesSubFinish
        && !partFinish[choice.id] && !partFinishByPart[String(choice.partId || '').toUpperCase()]) return '';
    const code = partFinish[choice.id] || partFinishByPart[String(choice.partId || '').toUpperCase()] || armFinishOf(choice) || globalFinishFor(choice);
    if (!code) return '';
    const f = finishByCode.get(String(code).toUpperCase());
    if (!f || !wearsFinish(choice, f)) return '';
    return code;
}

// NODE → TEXTURE. A no-finish part is skipped entirely, so the clear rule paints it instead —
// the collar of a two-part finial takes the finish, the acrylic top never does.
export function textureOverridesOf({ resolved, chosenList, finishByCode, finishFor, matchFinishOverride, followsRod, rodFinishFor, partFinish, wearsFinish }) {
    const out = {};
    // ⚠ PAINT WHAT RENDERS, NOT WHAT WAS CLICKED (Stuart 2026-08-17: "the right end treatment is
    // not rendering the finish properly on the rod, only the end treatment is, the left side
    // works"). A three-piece pole is three PINS but one decision: choosing the rod renders its
    // left, core and right segments, yet only the pin the customer's answer points AT was in the
    // chosen list — so the other segments rendered in mill finish beside a brass one. Painting
    // per-click can only ever be right for parts that are one pin, which the pole is not.
    //
    // So the finish walks the VISIBLE set instead, the same set the renderer draws: every node
    // that renders is painted by the finish of the part that OWNS it, and a segment inherits
    // from the rod it belongs to — same partId, same decision, same finish, by construction.
    const chosenIds = new Set(chosenList.map(c => c.id));
    const byPart = new Map();
    chosenList.forEach(c => { if (c.partId) byPart.set(String(c.partId).toUpperCase(), c); });
    (resolved.visible ? [...resolved.visible] : []).forEach(node => {
        const owner = resolved.ownership?.owner?.get(node);
        if (!owner) return;
        // The owner itself if it was chosen; otherwise the chosen part it is a piece of.
        const c = chosenIds.has(owner.id) ? owner
            : (owner.partId ? byPart.get(String(owner.partId).toUpperCase()) : null);
        // A paint-matched track renders painted — the same override, applied to the same set.
        const ov = c && (matchFinishOverride[c.id] || matchFinishOverride[owner.id]);
        if (!c || ((c.noFinish || owner.noFinish) && !ov)) return;
        // …and an unmatched track renders its stock look, never the configuration's finish.
        if (!ov && (c.role === 'TRACK' || owner.role === 'TRACK')) return;
        // ⚠ A RETURN CUT INTO THE POLE IS DRAWN IN THE POLE'S FINISH (Stuart 2026-10-01, H1-2TRV wood miter return:
        // "the pole renders correctly as wood, the return is in cart correctly as wood finish but the rendering is
        // metal"). The 09-18 rule — a miter, a French return, a bend is fabrication ON the rod and wears what the rod
        // wears — was written into the cart line (lineFinishFor) and never into this pass, which still asked the
        // return's own material tag: metal, so the oak stain was refused and the return drew bare. Same rule, same
        // two helpers, here: the rod's finish (its own per-part pick still wins), past the material gate.
        const follows = !ov && followsRod(c);
        const f = finishByCode.get(String(ov || (follows ? (partFinish[c.id] || rodFinishFor(c)) : finishFor(c))).toUpperCase());
        // The material gate, applied at the last moment: a global pick of a wood stain simply
        // does not land on the steel brackets, and nothing lands on the acrylic.
        if (!f || (!ov && !follows && !wearsFinish(c, f))) return;
        const url = f.textureUrl || f.finalImageUrl;
        if (url) out[String(node).toLowerCase()] = url;
    });
    return out;
}
// The finishes this configuration actually wears — the configuration's own, plus any per-part
// exception. RTG reads the label off this, so it must be what is on the parts, not what is
// selected in the panel.
export function chosenFinishObjectsOf(globalFinishes, partFinish, finishByCode) {
    const codes = new Set([...Object.values(globalFinishes), ...Object.values(partFinish)].filter(Boolean).map(c => String(c).toUpperCase()));
    return [...codes].map(c => finishByCode.get(c)).filter(Boolean);
}
// ⚠ WOOD WEARS A STAIN OR IT DOES NOT LEAVE HERE (Stuart 2026-09-16, SO60429: "we lost the
// wood finish altogether"). A wood part with no finish chosen — no WOOD row pick, no per-part
// pick — reached the cart wearing nothing: no species item, no stain for the floor, a bare
// code in NetSuite. The add names the parts and waits; the WOOD row of the finish step (or
// the part's own swatch) is the answer. A part tagged as taking no finish is not asked.
export const bareWoodOf = (chosenList, finishFor) =>
    chosenList.filter(c => Array.isArray(c.materials) && c.materials.includes('WOOD') && !c.noFinish && !finishFor(c));

// ── WHICH FINISHES ARE OFFERED, AND WHAT THEY ARE CALLED ─────────────────────────────────────
// A FINISH IS NAMED, NOT JUST COLOURED (Stuart 2026-08-17: "make the finish chips bigger and
// place the name under each one, our code along with customer name"). The customer's own word
// for it comes from the finish's client mapping — it is what they will say on the phone.
export function clientFinishNameOf(f, customerId, customer) {
    if (!customerId && !customer) return '';
    const keys = new Set([customerId, customer?.name, customer?.companyName].filter(Boolean).map(v => String(v).trim().toUpperCase()));
    const hit = (Array.isArray(f.clientMapping) ? f.clientMapping : []).find(m => keys.has(String(m.customerId || '').trim().toUpperCase()));
    return hit?.clientFinishName || '';
}
// Material first, then where it is done — in-house and outsourced price and lead differently.
// ── WHAT THIS FLOW OFFERS, IN ONE PLACE (Stuart 2026-08-21) ──────────────────────────────
// "when selecting brimar flow at first its just there selected finishes, but as soon as i click
// on one it opens the full library of finishes even the ones not selected in tab 11."
//
// The flow's list was applied where the swatches are GROUPED and nowhere else, so the moment a
// part was picked the per-part row underneath — "just this part" — offered the whole library.
// A collection that has been narrowed to its own finishes must stay narrowed everywhere, or the
// narrowing is decoration: one wrong click and a Brimar quote wears a finish Brimar does not
// sell. An empty list still means "never narrowed", which is every flow's behaviour before the
// control existed.
export const offeredFinishesOf = (finishes, flowFinishes) => (flowFinishes.length
    ? finishes.filter(f => flowFinishes.includes(f.code || f.finishCode || f.name || f.id))
    : finishes);
export function finishGroupsOf({ offeredFinishes, chosenList, wearsFinish }) {
    // …and then the parts have their say: a finish no chosen part can wear is not offered.
    const usable = offeredFinishes.filter(f => !chosenList.length || chosenList.some(c => wearsFinish(c, f)));
    const byMat = new Map();
    usable.forEach(f => {
        const m = String(f.material || f.type || 'METAL').toUpperCase();
        if (!byMat.has(m)) byMat.set(m, { inHouse: [], out: [] });
        // A METAL finish splits by how it is applied — painted here, plated by a vendor. WOOD
        // does not: a stain is a stain whichever side of the wall it is done on, so it stays one
        // list rather than being cut in two and labelled the same thing twice.
        const splits = !m.includes('WOOD');
        const out = splits && (f.multiplier !== undefined || f.vendor);
        (out ? byMat.get(m).out : byMat.get(m).inHouse).push(f);
    });
    return [...byMat.entries()];
}
// ── WHAT THE FINISH IS, NOT WHO APPLIES IT (Stuart 2026-08-21) ──────────────────────────
// "we can rename the categories to Wood, Painted and Plated rather than in house and
// outsourced, just changing the naming conventions."
//
// Right, and it is not only nicer language: in house / outsourced is OUR problem, and it was on
// a screen where the question is what the customer is buying. The split underneath is unchanged
// — a paint we apply here, a plating a vendor does — only what it is called. A wood group is
// wood whichever side of the wall it is finished on, so it says so once instead of splitting.
export function finishGroupLabel(mat, kind) {
    const m = String(mat || '').toUpperCase();
    if (m.includes('WOOD')) return 'Wood';
    if (m.includes('METAL')) return kind === 'out' ? 'Plated' : 'Painted';
    if (m.includes('BRASS')) return 'Solid brass';      // the part is MADE in it — in house or sent out is ours to know
    return kind === 'out' ? 'Outsourced' : 'In house';   // an unfamiliar material keeps the old words
}

/**
 * The finish rules for one configuration, in one call — the same functions, bound to this configuration,
 * in the order the CPQ screen binds them. `finishFor` is what a part is wearing; `lineFinishFor` what
 * its line is billed and sprayed in; `subFinishFor` the stock colour it is made in.
 */
export function finishRulesOf({ finishes = [], flowFinishes = [], customer = null, customerId = '', findPart, model, resolved, livePicks, extras = [] },
    { globalFinishes = {}, partFinish = {} } = {}) {
    const finishByCode = finishIndexOf(finishes);
    const globalFinish = globalFinishOf(globalFinishes);
    const twinWear = (c, f) => wearsAsTwinFinish(c, f, findPart);
    const wearsFinish = (c, f) => wearsFinishOf(c, f, twinWear);
    const globalFinishFor = (c) => globalFinishForChoice(c, { globalFinishes, finishByCode, twinWear });
    const chosenList = chosenListOf(resolved, livePicks);
    const partFinishByPart = partFinishByPartOf(partFinish, model);
    const armFinishOf = (c) => armFinishOfChoice(c, { resolved, livePicks, partFinish, partFinishByPart });
    const finishFor = (c) => finishForChoice(c, { partFinish, armFinishOf, globalFinishFor });
    const matchFinishOverride = matchFinishOverrideOf({ extras, findPart, chosenList, finishFor, globalFinish, model, livePicks });
    const rodFinishFor = (choice) => rodFinishForChoice(choice, { chosenList, partFinish, partFinishByPart, globalFinishFor });
    const followsRod = (choice) => followsRodChoice(choice, findPart);
    const subFinishFor = (choice, part) => subFinishForChoice(choice, part, { findPart, finishByCode, rodFinishFor, globalFinish });
    const lineFinishFor = (choice) => lineFinishForChoice(choice, { partFinish, partFinishByPart, armFinishOf, globalFinishFor, finishByCode, matchFinishOverride, followsRod, rodFinishFor, findPart, wearsFinish });
    const textureOverrides = textureOverridesOf({ resolved, chosenList, finishByCode, finishFor, matchFinishOverride, followsRod, rodFinishFor, partFinish, wearsFinish });
    const chosenFinishObjects = chosenFinishObjectsOf(globalFinishes, partFinish, finishByCode);
    const offeredFinishes = offeredFinishesOf(finishes, flowFinishes);
    const finishGroups = finishGroupsOf({ offeredFinishes, chosenList, wearsFinish });
    const bareWood = bareWoodOf(chosenList, finishFor);
    const clientFinishName = (f) => clientFinishNameOf(f, customerId, customer);
    return { finishByCode, globalFinishes, globalFinish, partFinish, twinWear, wearsFinish, globalFinishFor, chosenList, partFinishByPart, armFinishOf, finishFor,
        matchFinishOverride, rodFinishFor, followsRod, subFinishFor, lineFinishFor, textureOverrides, chosenFinishObjects, offeredFinishes, finishGroups, bareWood, clientFinishName };
}

/**
 * The configuration, in one call — for a caller that is not a React screen (the portal's server, a
 * harness). The CPQ screen makes these SAME calls one memo at a time, so a keystroke re-works only
 * what it touched; this makes them in the same order, with the same arguments.
 *
 * @param data   { assembly, pins, parts, flow, spanMap, spanCaps, trvRules, extraItems, finishes, flowFinishes,
 *                 customer, customerId } — what the screen is handed
 * @param state  { answers, picks, sizePick, lengthInches, stepQty, fabricId, extras, spliceWaived, globalFinishes,
 *                 globalFinish, partFinish } — what the operator has answered, as a cart line saves it
 *               (engineConfig); a saved length, the saved add-by-hand rows and the saved finish defaults are
 *               read back exactly as Edit restores them
 */
export function sessionOf({ assembly, pins = [], parts = [], flow = null, spanMap = {}, spanCaps = {}, trvRules = null, extraItems = [],
    finishes = [], flowFinishes = [], customer = null, customerId = '' } = {},
    { answers = {}, picks = {}, sizePick = {}, lengthInches: savedLength = null, stepQty = {}, fabricId = 'PRINT', extras: savedExtras = [], spliceWaived = false,
        globalFinishes: savedGlobalFinishes = null, globalFinish: savedGlobalFinish = '', partFinish: savedPartFinish = null } = {}) {
    const partIndex = partIndexOf(parts);
    const findPart = (id) => partIn(partIndex, id);
    const ourId = (id) => ourNumberOf(findPart(id), id);
    const sizeSteps = sizeStepsOf(flow);
    const sizeSel = sizeSelOf(flow, sizePick, sizeSteps);
    const sizeIndex = sizeIndexOf(sizeSel, parts);
    const choices = choicesAtSize({ assembly, pins, sizeSel, sizeIndex, findPart });
    const sizeProjInches = sizeProjInchesOf(sizeSel);
    const effAnswers = answersAtSize(answers, sizeProjInches);
    const modelNodes = modelNodesOf(assembly);
    const model = settle({ choices, answers: effAnswers, picks, modelNodes });
    // The picks made on the operator's behalf (Shared/hardwareAutoPicks) — read from the answers AS GIVEN.
    const { settledKeys, livePicks } = autoPicksOf({ model, answers, operatorPicks: reseatPicks(model, picks) });
    const fields = lengthFieldsOf(savedLength);
    const lengthInches = lengthInchesOf(fields.poleIn, fields.poleFrac);
    const lengthFeetExact = lengthFeetExactOf(lengthInches);
    const lengthFeet = lengthFeetOf(lengthInches);
    const advice = bracketAdviceOf({ model, livePicks, lengthInches, spanMap, spanCaps, fabricId, ourId });
    const recommendFor = (slot, choice) => recommendedFor({ slot, choice, advice, model, livePicks, lengthFeet });
    const quantities = quantitiesOf({ model, livePicks, stepQty, lengthFeet, recommendFor, trvRules, ourId });
    const resolved = resolvedOf({ choices, answers: effAnswers, livePicks, modelNodes, quantities });
    // The add-by-hand rows: restored as Edit restores them, offered for the rod chosen, and — over the flow's
    // limit, with ONE joiner to choose from, unless the operator declined it — the joiner the length step adds itself.
    const sameItemCode = (a, b) => sameItem(a, b, findPart);
    const rodMats = rodMaterialsOf(model.choices, Object.values(livePicks));
    const offeredExtraItems = extrasForRod(extraItems, rodMats);
    const spliceCodes = spliceCodesAmong(offeredExtraItems, findPart);
    const spliceCode = singleSpliceOf(spliceCodes);
    const spliceOverIn = spliceLimitOf(flow);
    const spliceNeeded = spliceIsNeeded(spliceCodes, lengthInches, spliceOverIn);
    let typedExtras = normalizeExtras(Array.isArray(savedExtras) ? savedExtras : [], extraItems, findPart);
    if (spliceNeeded && spliceCode && !spliceWaived) typedExtras = withRequiredSplice(typedExtras, spliceCode, sameItemCode);
    const extras = liveExtrasOf(typedExtras, extraItems, rodMats);
    const spliceSatisfied = spliceIsSatisfied(spliceCodes, extras, sameItemCode);
    // The finishes: the saved defaults as Edit restores them — one per material, or (a line saved before there
    // was one per material) ONE code, which lands in its material's slot — and the rules bound to this configuration.
    const globalFinishes = (savedGlobalFinishes && typeof savedGlobalFinishes === 'object') ? { ...savedGlobalFinishes }
        : (savedGlobalFinish ? withGlobalFinish({}, savedGlobalFinish, finishIndexOf(finishes)) : {});
    const partFinish = { ...(savedPartFinish || {}) };
    const fin = finishRulesOf({ finishes, flowFinishes, customer, customerId, findPart, model, resolved, livePicks, extras }, { globalFinishes, partFinish });
    return { findPart, ourId, sizeSteps, sizeSel, sizeIndex, sizeProjInches, choices, effAnswers, modelNodes, model, settledKeys, livePicks,
        lengthInches, lengthFeetExact, lengthFeet, advice, recommendFor, quantities, resolved,
        sameItemCode, rodMats, offeredExtraItems, typedExtras, extras, spliceCodes, spliceCode, spliceOverIn, spliceNeeded, spliceSatisfied,
        ...fin };
}
