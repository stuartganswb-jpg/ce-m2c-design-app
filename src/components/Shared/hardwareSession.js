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
import { resolve, reseatPicks, recommendedQty, bearingEnds, centreBracketsFor } from './hardwareModel.js';
import { autoPicksOf } from './hardwareAutoPicks.js';
import { SIZE_STEP_TYPE, sizeSelectionsOf, buildSizeIndex, sizeVariantOf, partAllowedAtSize, returnsAllowedFor, projInchesOfSel } from './sizeMatrix.js';
import { bracketAdviceFor, DEFAULT_DROP_FT } from './bracketSpan.js';
import { carrierRows } from './traverseConfigurator.js';
import { usageAt } from './traverseExplode.js';
import { rodMaterialsOf, extrasForRod, liveExtrasOf } from './flowExtras.js';
import { normalizeExtras } from './extrasRestore.js';

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

/**
 * The configuration, in one call — for a caller that is not a React screen (the portal's server, a
 * harness). The CPQ screen makes these SAME calls one memo at a time, so a keystroke re-works only
 * what it touched; this makes them in the same order, with the same arguments.
 *
 * @param data   { assembly, pins, parts, flow, spanMap, spanCaps, trvRules, extraItems } — what the screen is handed
 * @param state  { answers, picks, sizePick, lengthInches, stepQty, fabricId, extras, spliceWaived } — what
 *               the operator has answered, as a cart line saves it (engineConfig); a saved length and the
 *               saved add-by-hand rows are read back exactly as Edit restores them
 */
export function sessionOf({ assembly, pins = [], parts = [], flow = null, spanMap = {}, spanCaps = {}, trvRules = null, extraItems = [] } = {},
    { answers = {}, picks = {}, sizePick = {}, lengthInches: savedLength = null, stepQty = {}, fabricId = 'PRINT', extras: savedExtras = [], spliceWaived = false } = {}) {
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
    return { findPart, ourId, sizeSteps, sizeSel, sizeIndex, sizeProjInches, choices, effAnswers, modelNodes, model, settledKeys, livePicks,
        lengthInches, lengthFeetExact, lengthFeet, advice, recommendFor, quantities, resolved,
        sameItemCode, rodMats, offeredExtraItems, typedExtras, extras, spliceCodes, spliceCode, spliceOverIn, spliceNeeded, spliceSatisfied };
}
