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
import { resolve, reseatPicks, recommendedQty, bearingEnds, centreBracketsFor, finishesFor, ROD_ROLES, TRAVERSE } from './hardwareModel.js';
import { autoPicksOf } from './hardwareAutoPicks.js';
import { SIZE_STEP_TYPE, sizeSelectionsOf, buildSizeIndex, sizeVariantOf, partAllowedAtSize, returnsAllowedFor, projInchesOfSel } from './sizeMatrix.js';
import { bracketAdviceFor, DEFAULT_DROP_FT } from './bracketSpan.js';
import { carrierRows, configuratorLines, configuratorTotal, defaultPicks } from './traverseConfigurator.js';
import { usageAt, explodeTraverse } from './traverseExplode.js';
import { rodMaterialsOf, extrasForRod, liveExtrasOf, noSpliceOf, noSpliceNote } from './flowExtras.js';
import { normalizeExtras } from './extrasRestore.js';
import { wearsAsTwin } from './materialTwin.js';
import { subFinishOfFinish } from './subFinish.js';
import { priceConfiguration, priceChoice, pricingWarnings } from './hardwarePricing.js';
import { customerPriceLevel } from './priceLevels.js';
import { findClientPriceRow, customerKeys } from './clientPricing.js';
import { applyKitPricing } from './kitSeed.js';
import { kitForMount, motorCodeFor, parseKitCode } from './kitCode.js';
import { takesNoFinish, finishLabelOf } from './finishLabel.js';
import { questionsOf, unansweredOf } from './finishQuestions.js';
import { handoffItem } from './hardwareHandoff.js';
import { shopNotesOf, clientNotesOf } from './lineShopNotes.js';
import { droppedPicks, mergeDrops, unacknowledged } from './pickDrops.js';

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

// ── PRICE ─────────────────────────────────────────────────────────────────────────────────────
// ── OUR COST TO THEM IS THE DEFAULT, ONCE THERE IS A "THEM" ──────────────────────────────
// Stuart 2026-08-17: "it should default at our cost to them". The tier in the Customer Alias &
// Pricing box only ever applied ABOVE Standard, so a connected customer still quoted off the
// item's own base price — which a mill item does not have, hence a screen of $0.00 lines with
// a perfectly good 12.50 sitting in the box beside them. Standard is "our pricing", and our
// pricing to a NAMED account is the cost column; with nobody named there is no tier to read
// and Standard is the only honest answer.
//
// This is a DEFAULT, not an override: choosing Wholesale or Retail still wins, an item with no
// tier data still falls through to its customer row and then its base price, and the level in
// force is named on screen beside the total so a quote can never be priced off a tier nobody
// could see.
// ⚠ THE LEVEL IS THE CUSTOMER'S, NOT "any customer gets Fabricut's" (Stuart 2026-08-22). One
// shared answer, read by CPQ, Quick Ship and the portal alike — see Shared/priceLevels
// (customerPriceLevel → { level, isDefault }, which every caller asks before anything is priced).
//
// MANUAL unless the answer says motorised — the rules doc speaks MANUAL / MOTORIZED / BOTH, and
// a collection that never asks the question is manual by construction. One reading of the drive
// answer for the three that need it: what a track is cut to, what a kit explodes to, which
// traverse components are shown.
export const driveOf = (driveAnswer) => (/MOTOR/.test(String(driveAnswer || '').toUpperCase()) ? 'MOTORIZED' : 'MANUAL');
export function priceCtxOf({ customerId, customer, effectiveLevel, levelIsDefault, outsourceCodes, globalFinish, lineFinishFor, subFinishFor, findPart, finishByCode, flow, lengthFeet, lengthInches, drive }) {
    return {
        customerId, customer, priceLevel: effectiveLevel, outsourceCodes,
        // Whether that level was CHOSEN or defaulted decides whether it outranks the customer's own
        // negotiated row — see the precedence in hardwarePricing.
        levelIsDefault,
        finishCode: globalFinish, finishFor: lineFinishFor, findPart, findByCode: findPart,
        // The stock colour a sub-finish part is made in (rod's finish first) — sold as <base>/B · <base>/C.
        subFinishFor,
        // The finish RECORD behind a code — the engine reads its species suffix (OAK / WALNUT) to bill
        // the -O / -W item (hardwarePricing step 0a, Stuart 2026-09-16).
        finishObjOf: (code) => finishByCode.get(String(code || '').toUpperCase()) || null,
        // The flow's per-kind fallback, used only where a part has no price under any rule (tab 11).
        fallbackPrices: flow?.fallbackPrices || null,
        // What the rods are cut from — see the per-foot rule in priceConfiguration. The
        // inches travel too: they become the line's cutLength, which is what the bench reads.
        billedFeet: lengthFeet || 0,
        lengthInches: lengthInches || 0,
        // The drive decides what a track and an F-clip are cut to (Shared/traverseTags) — manual unless answered.
        drive,
    };
}

// ── THE KIT A LINE IS BILLED FROM ────────────────────────────────────────────────────────────
// A kit named on a saved line (Stuart 2026-09-19, QUO154 row 6): by the id it was picked under, else —
// a line saved before the pick travelled — by the kit number on its own bill. The kit is found among
// the kits THIS flow offers and must still carry its alignment; it then owns the first line of the bill
// again, at the base feet its alignment names (4 where it names none). Nothing is re-seeded: the saved
// answers are the truth.
//   → { none: true }          the line names no kit
//   → { missing: '<name>' }   it names one this flow no longer offers
//   → { kitPick, kitSource }  the kit, as the screen holds it: { code, name, baseFeet, record }
export function kitFromSaved(kits, { kitPick, kitCode } = {}) {
    const want = String(kitPick || '').trim();
    const wantCode = String(kitCode || '').trim().toUpperCase();
    if (!want && !wantCode) return { none: true };
    const idOf = (k) => String(k.id || k.legacyErpId || '');
    const chosen = kits.find(k => want && idOf(k) === want)
        || kits.find(k => wantCode && String(k.legacyErpId || '').trim().toUpperCase() === wantCode);
    if (!chosen || !chosen.manufacturingSpecs?.kitAlign) return { missing: wantCode || want };
    const name = String(chosen.legacyErpId || chosen.itemName || 'the kit');
    return { kitPick: idOf(chosen), kitSource: { code: name, name: chosen.itemName || name, baseFeet: Number(chosen.manufacturingSpecs.kitAlign.minFeet) || 4, record: chosen } };
}
// ⚠ THE KIT TRANSFORM RUNS ONLY WHERE A KIT WAS CHOSEN. Every other configuration gets
// priceConfiguration's answer verbatim, which is what keeps four tested collections still.
// ⚠ ONE DESCRIPTION OF THE BILL, USED TWICE. The panel below and the cart item built at Add
// must never disagree about money, and handoffItem prices the configuration AGAIN from
// `resolved` — so the kit has to travel to it rather than being applied only on screen. It is
// computed once here and passed to both.
export function kitBillOf({ kitSource, kits, priceCtx, customerId, customer, kitMotor, drive, proj, mount, trvRules, lengthFeet, findPart }) {
    if (!kitSource) return null;
    // ── THE KIT FOLLOWS THE MOUNT (Stuart 2026-10-12, QUO203: a wall double started, ceiling brackets picked —
    //    the wall kit billed and the two ceiling brackets billed on top at $55, where the order is the ceiling
    //    kit). The kit in hand stays what the operator started from; what BILLS is that kit followed to the
    //    mount answered (Shared/kitCode.kitForMount): the family's kit for that mount where one is made — its
    //    own number, price, per-foot rate and motor code — else the same kit covering that mount's bracket (the
    //    1-3/8" traverse has one kit for both: "swap out for ceiling brackets at same price"). Derived here,
    //    never a state change: the answer back to Wall is the kit as picked again, and a reopened line follows
    //    its saved mount the same way.
    const km = kitForMount(kits, kitSource.record, mount);
    const moved = km.mode === 'switched' && km.kit;
    const kitRecord = moved ? km.kit : kitSource.record;
    const kitCode = moved ? String(kitRecord.legacyErpId || kitRecord.itemName || kitSource.code) : kitSource.code;
    const kitName = moved ? (kitRecord.itemName || kitCode) : kitSource.name;
    const kp = priceChoice({ partId: kitCode }, kitRecord, priceCtx);
    // The ADDITIONAL-FOOT rate, from the same Client Pricing row tab 7 bills from — one
    // source of truth (Stuart 2026-08-27). Matched by the same key rule every row lookup
    // uses; absent → applyKitPricing falls back to the flow's own per-foot item rates.
    const kitRow = findClientPriceRow(kitRecord?.clientPricing, customerKeys(customerId, customer));
    // ── WHAT THE KIT ALREADY PAID FOR (Stuart 2026-09-03: "check back against 4.6 — all of
    // the kits are built, all of the info is tagged, you just need to gather and display it")
    // The rules explosion for a flow-aligned kit (fascia + track by the foot, the bracket count
    // at this length and projection, splices, the motor or plugs) plus the record's own
    // kitComponents. Each with the quantity the kit covers; applyKitPricing bills only above it.
    const ms = kitRecord?.manufacturingSpecs || {};
    const family = ms.kitFamily || (parseKitCode(kitCode) || {}).family || 'H1-2TRV';
    const motorCodes = Array.isArray(ms.kitMotorCodes) ? ms.kitMotorCodes : [];
    const driveNow = driveOf(drive);
    // (the motor was chosen by ITS code on the kit in hand; on the followed kit it is the same motor's code)
    const motorPick = moved ? motorCodeFor(kitSource.record, kitRecord, kitMotor) : kitMotor;
    const mc = driveNow === 'MOTORIZED' && motorPick ? motorCodes.find(x => String(x.code || '').toUpperCase() === String(motorPick).toUpperCase()) : null;
    const feet = lengthFeet || kitSource.baseFeet;
    const exploded = ms.kitAlign
        ? explodeTraverse({ family, align: { ...(km.mode === 'followed' ? km.align : ms.kitAlign), drive: driveNow }, feet, motorItem: mc?.motorItem || '', rules: trvRules, proj: proj != null ? String(proj) : '' })
        : { lines: [] };
    // THE KIT COVERS ITS CARRIERS (Stuart 2026-09-19, QUO156 row 6: "still billing them even though the
    // reduced number should be included in the kit"). The explosion leaves carriers to the components
    // step, so the carrier pinned on the assembly billed in full beside the kit. Covered at the chart
    // count for the length BILLED — the kit's own 4 ft below it (16), the length above it — so a
    // shorter system's smaller count is always inside the kit and only a count above the chart bills.
    const billedFeet = Math.max(Number(feet) || 0, Number(kitSource.baseFeet) || 4);
    const carrierCover = carrierRows(trvRules).map(u => ({ code: String(u.itemId || '').trim().toUpperCase(), partId: findPart(u.itemId)?.id, qty: usageAt(u, billedFeet) }));
    const included = [
        ...carrierCover,
        ...exploded.lines.map(l => ({ code: l.code, partId: findPart(l.code)?.id, qty: l.qty })),
        ...(Array.isArray(ms.kitComponents) ? ms.kitComponents : []).map(c => ({ partId: c.partId, code: findPart(c.partId)?.legacyErpId || '', qty: Number(c.qty) || 1 })),
    ];
    return {
        kitCode, kitName, kitPrice: kp?.price || 0,
        baseFeet: kitSource.baseFeet,
        // How the mount was followed — for the strip under the kit picker, which says so in words.
        mountFollow: km.mode === 'same' ? null : { mode: km.mode, mount: String(mount || '').toUpperCase(), from: kitSource.code, to: kitCode, theirs: (mc && mc.fabSku) || kp?.sku || kp?.aliasCode || '' },
        perFootPrice: kitRow?.perFootPrice,
        // THEIR number, resolved by the same rule every other line's alias is.
        clientSku: kp?.sku || kp?.aliasCode || '',
        included,
        // The per-motor code and net, folded onto the kit line by applyKitPricing (tab 7's way).
        motor: mc ? { code: mc.code, fabSku: mc.fabSku || '', motorItem: mc.motorItem || '', net: parseFloat(mc.net) } : null,
    };
}
// ── ONE SOURCE OF CARRIERS (Stuart 2026-09-19: "HTSLNTCAR is charging $9.00, aren't these included
// in the first 4 ft kit?"). They are — on the Traverse components line. The $9 was a SECOND set: the
// carrier pinned on the assembly rides every track, counted four a foot and billed at the customer's
// price, whatever style the components step chose (a ripplefold order still got pinch-pleat ones).
// Once the components step names a carrier style, that line IS the carriers: the pinned rider still
// renders in the track, and leaves the bill, the BOM and the pick. No style chosen → the rider stays
// exactly as it was, so a track can never go out with none.
export const carriersFromStepOf = (trvSel) => !!(trvSel && trvSel.carrierStyle);
export const pricingCtxOf = (priceCtx, carriersFromStep) => (carriersFromStep ? { ...priceCtx, skipRoles: ['CARRIER'] } : priceCtx);
export function pricedOf(resolved, pricingCtx, kitBill) {
    const p = priceConfiguration(resolved, pricingCtx);
    return kitBill ? applyKitPricing(p, kitBill) : p;
}
// A hidden part with no price is still a real problem — it just is not the operator's, so it
// is reported quietly rather than in red on a quote they cannot act on.
export const priceWarningsOf = (priced) => pricingWarnings({ lines: priced.lines.filter(l => !l.hidden) });
// THE FINISHES THAT ASK SOMETHING, among those a line actually wears (Stuart 2026-10-06, the brass surface and
// coating: "a dedicated field would be better" · one answer for the "whole config" · "yes required").
export function askingFinishesOf(priced, finishByCode) {
    const worn = new Set(priced.lines.map(l => String(l.finishCode || '').toUpperCase()).filter(Boolean));
    return [...worn].map(c => finishByCode.get(c)).filter(f => f && questionsOf(f).length)
        .map(f => ({ finish: f, code: String(f.code || f.name || '').toUpperCase(), questions: questionsOf(f) }));
}
// only the answers of finishes still worn travel with the line
export function liveFinishAnswersOf(askingFinishes, finishAnswers) {
    const out = {};
    askingFinishes.forEach(a => { if (finishAnswers[a.code]) out[a.code] = finishAnswers[a.code]; });
    return out;
}
// A FINISH THAT ASKS IS ANSWERED BEFORE THE LINE LEAVES (Stuart 2026-10-06: "yes required"). Solid brass with
// no word on brushed / polished, lacquered or not, is an order the floor cannot make.
export const openFinishQuestionsOf = (askingFinishes, finishAnswers) =>
    askingFinishes.map(a => [a, unansweredOf(a.finish, finishAnswers[a.code])]).filter(([, m]) => m.length);
// The parts each item-kit line brings — the hidden lines that follow it (hardwarePricing writes a kit, then its
// parts). Read by the pricing panel so a kit line can say what each part wears.
export function kitPartsByLineOf(priced) {
    const m = new Map();
    let cur = null;
    (priced.lines || []).forEach(l => {
        if (l.isKit && l.itemKit) { cur = l; m.set(l, []); return; }
        if (cur && l.inKit && l.hidden && l.kitOf === (cur.billedId || '')) { m.get(cur).push(l); return; }
        cur = null;
    });
    return m;
}
// Added by hand — priced by the SAME chain as everything else (override → price level → client
// row → base). A splice a customer negotiated is still that customer's price; nothing about it
// being typed in rather than resolved changes what they pay for it.
export function extraLinesOf({ extras, findPart, priceCtx, globalFinish, matchFinishOverride, livePicks }) {
    return extras.filter(x => x.code).map(x => {
        const part = findPart(x.code);
        const qty = Number(x.qty) > 0 ? Number(x.qty) : 1;
        // The slot travels with the line (a per-track fee is its own line per track), and a
        // paint-match fee says WHICH color the upcharge buys — the fascia's, via the override.
        // It also PRICES at that color: a fee with finish variants (painted vs plated upgrade)
        // bills the variant the matched finish actually is, not the configuration's.
        const matched = x.slot ? matchFinishOverride[livePicks[x.slot]] : '';
        // ⚠ UNFINISHED ITEMS (Stuart 2026-09-03, live order 1: the joiner went to the floor stamped
        // S04). An extra used to take the configuration's finish unconditionally; now the ITEM's own
        // "Unfinished" tag (Master Library / 4.5) is asked first — a splice, joiner or connector
        // prices as the plain part and carries no finish code, so the floor is told nothing to do.
        const unfinished = takesNoFinish(part);
        const p = priceChoice({ partId: x.code }, part, unfinished ? { ...priceCtx, finishCode: '' } : (matched ? { ...priceCtx, finishCode: matched } : priceCtx));
        return { partId: x.code, name: part?.itemName || x.code, qty, unit: p.price, total: p.price * qty,
                 sku: p.sku || p.aliasCode, source: p.source, detail: p.detail, note: x.note, extra: true,
                 ...(x.slot ? { slot: x.slot } : {}),
                 // Priced at the configuration's finish, so it says so — a row with no finish under
                 // it beside rows that have one reads as an oversight rather than a fact. Unless the
                 // item itself says it takes none: then no code, and the line says why.
                 finishCode: unfinished ? '' : (matched || globalFinish), noFinish: unfinished };
    });
}

// ── TRAVERSE COMPONENTS ARE THE LAST QUESTION A TRACK ASKS (Stuart 2026-08-21) ────────────
// "integrate that simple configurator at the last step of any traverse rod … it basically has
// two options, the manual components and the motorized components, that is what decides what
// is shown."
//
// The old engine interposed this as a MODAL on Add to Cart, and the new engine's onAdd went
// straight to the cart — so a traverse configuration reached a quote with no track components
// on it at all, silently. It is not a checkout interruption here: it is the last step of the
// walk, because that is what it is. A track without its carriers is not a finished decision.
//
// DRIVE IS ALREADY AN ANSWER. The engine asks manual vs motorised as a world axis (AXES, order
// 25) wherever a collection stocks both, so nothing new is asked — the answer already given is
// what gates the list, exactly as the rules doc gates it.
export function isTraverseOf(model, livePicks) {
    const ids = new Set(Object.values(livePicks));
    return model.choices.some(c => ids.has(c.id) && ROD_ROLES.includes(c.role) && c.rodKind === TRAVERSE);
}
export const trvFeetOf = (lengthFeet) => Math.max(lengthFeet || 4, 4);
export const trvTracksOf = (setupAnswer) => (String(setupAnswer || '').toUpperCase() === 'DOUBLE' ? 2 : 1);
export function trvPriceOfCode(code, findPart, priceCtx) {
    const part = findPart(code);
    return part ? (priceChoice({ partId: code }, part, priceCtx).price || 0) : 0;
}
export function trvItemInfoOf(code, findPart, priceCtx) {
    const part = findPart(code);
    if (!part) return null;
    const p = priceChoice({ partId: code }, part, priceCtx);
    return { name: part.itemName || code, sku: p.sku || p.aliasCode || '' };
}
// The selection SEEDS from the chart and stays seeded until it is touched: a length typed after
// the panel was first drawn re-seeds it, because the chart quantity IS a function of length and
// a stale count is a wrong count. Once the operator has answered, their answer stands.
export const trvSeedOf = ({ trvRules, isTraverse, trvDrive, trvFeet, trvTracks }) => (trvRules && isTraverse
    ? { carrierStyle: '', carrierQty: '', draw: '', motorSide: '', picks: defaultPicks({ rules: trvRules, drive: trvDrive, feet: trvFeet, trackCount: trvTracks }), accessories: {} }
    : null);
export const trvComponentsOf = ({ trvRules, isTraverse, trvLive, trvDrive, trvFeet, lengthFeet, trvPriceOf }) => ((trvRules && isTraverse && trvLive)
    ? configuratorLines({ rules: trvRules, drive: trvDrive, feet: trvFeet, realFeet: lengthFeet || undefined, sel: trvLive, priceOf: trvPriceOf })
    : []);
// On the quote the same way they land on the cart item: an included component rides at $0 so
// the documents and the BOM still show every part the order carries.
export const trvLinesOf = (trvComponents) => trvComponents.map(c => ({
    partId: c.code, name: c.why || c.code, qty: c.qty,
    unit: c.billable ? c.rate : 0, total: c.billable ? c.rate * c.qty : 0,
    source: 'traverse components', detail: c.billable ? c.why : `included — ${c.why}`, extra: true,
}));

// Over the limit with NO joiner on the line — from the length step or from the traverse chart
// (its joiner is a tick on the Traverse components step). Allowed; said here, on the step, and
// on the line the floor reads (Shared/flowExtras.noSpliceOf).
export const spliceOnLineOf = ({ extras, spliceCodes, sameItemCode, trvComponents }) =>
    extras.filter(x => spliceCodes.some(c => sameItemCode(x.code, c))).reduce((n, x) => n + (Number(x.qty) > 0 ? Number(x.qty) : 0), 0)
    + trvComponents.filter(c => /SPLICE|JOINER|JNR|SPLC/i.test(String(c.code || ''))).reduce((n, c) => n + (Number(c.qty) > 0 ? Number(c.qty) : 0), 0);
export const shipsInOnePieceOf = ({ lengthInches, spliceOverIn, spliceCodes, isTraverse, trvRules, spliceOnLine }) =>
    noSpliceOf({ lengthInches, limitInches: spliceOverIn, canSplice: spliceCodes.length > 0 || (isTraverse && !!trvRules), spliceQty: spliceOnLine });
export const grandTotalOf = (priced, extraLines, trvComponents) => priced.total + extraLines.reduce((s2, l) => s2 + l.total, 0) + configuratorTotal(trvComponents);

/**
 * The bill for one configuration, in one call — the same functions in the order the CPQ screen calls them:
 * the level in force, the price context, the kit a line is billed from, the priced lines, what was added by
 * hand, the traverse components, and the total.
 */
export function billOf({ customer = null, customerId = '', priceLevel = 'STANDARD', outsourceCodes = [], flow = null, kits = [], trvRules = null,
    findPart, model, resolved, livePicks, extras = [], lengthFeet, lengthInches, spliceCodes = [], spliceOverIn, sameItemCode,
    finishByCode, globalFinish, lineFinishFor, subFinishFor, matchFinishOverride },
    { answers = {}, kitPick = '', kitCode = '', kitMotor = '', trvSel = null, finishAnswers = {} } = {}) {
    const { level: effectiveLevel, isDefault: levelIsDefault } = customerPriceLevel(customer, priceLevel);
    const priceCtx = priceCtxOf({ customerId, customer, effectiveLevel, levelIsDefault, outsourceCodes, globalFinish, lineFinishFor, subFinishFor, findPart, finishByCode, flow, lengthFeet, lengthInches, drive: driveOf(answers.drive) });
    // The kit, restored as Edit restores it: found among the kits this flow offers, never re-seeded.
    const saved = kitFromSaved(kits, { kitPick, kitCode });
    const kitSource = saved.kitSource || null;
    const kitBill = kitBillOf({ kitSource, kits, priceCtx, customerId, customer, kitMotor: kitSource ? String(kitMotor || '') : '', drive: answers.drive, proj: answers.proj, mount: answers.mount, trvRules, lengthFeet, findPart });
    const carriersFromStep = carriersFromStepOf(trvSel);
    const pricingCtx = pricingCtxOf(priceCtx, carriersFromStep);
    const priced = pricedOf(resolved, pricingCtx, kitBill);
    const priceWarnings = priceWarningsOf(priced);
    const askingFinishes = askingFinishesOf(priced, finishByCode);
    const liveFinishAnswers = liveFinishAnswersOf(askingFinishes, finishAnswers);
    const openFinishQuestions = openFinishQuestionsOf(askingFinishes, finishAnswers);
    const kitPartsByLine = kitPartsByLineOf(priced);
    const extraLines = extraLinesOf({ extras, findPart, priceCtx, globalFinish, matchFinishOverride, livePicks });
    const isTraverse = isTraverseOf(model, livePicks);
    const trvDrive = driveOf(answers.drive);
    const trvFeet = trvFeetOf(lengthFeet);
    const trvTracks = trvTracksOf(answers.setup);
    const trvPriceOf = (code) => trvPriceOfCode(code, findPart, priceCtx);
    const trvItemInfo = (code) => trvItemInfoOf(code, findPart, priceCtx);
    const trvSeed = trvSeedOf({ trvRules, isTraverse, trvDrive, trvFeet, trvTracks });
    const trvLive = trvSel || trvSeed;
    const trvComponents = trvComponentsOf({ trvRules, isTraverse, trvLive, trvDrive, trvFeet, lengthFeet, trvPriceOf });
    const trvLines = trvLinesOf(trvComponents);
    const spliceOnLine = spliceOnLineOf({ extras, spliceCodes, sameItemCode, trvComponents });
    const noSplice = shipsInOnePieceOf({ lengthInches, spliceOverIn, spliceCodes, isTraverse, trvRules, spliceOnLine });
    const grandTotal = grandTotalOf(priced, extraLines, trvComponents);
    return { effectiveLevel, levelIsDefault, priceCtx, kitSaved: saved, kitSource, kitPick: saved.kitPick || '', kitMotor: kitSource ? String(kitMotor || '') : '', kitBill,
        carriersFromStep, pricingCtx, priced, priceWarnings, askingFinishes, liveFinishAnswers, openFinishQuestions, kitPartsByLine, extraLines,
        isTraverse, trvDrive, trvFeet, trvTracks, trvPriceOf, trvItemInfo, trvSeed, trvLive, trvComponents, trvLines, spliceOnLine, noSplice, grandTotal };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE WALK, WHAT IS DRAWN, THE REFUSALS AT ADD AND THE CART LINE (move 6 of 6)
// ─────────────────────────────────────────────────────────────────────────────────────────────

// ── THE WORDS ON THE RAIL ────────────────────────────────────────────────────────────────────
export const AXIS_LABEL = { rodKind: 'Rod Type', setup: 'Single or Double', drive: 'Drive', mount: 'Mount', proj: 'Bracket Projection', frontLayer: 'Front of the Double' };
export const valueLabel = (axis, v) => {
    if (axis === 'proj') {
        const n = Number(v);
        const known = { 0.75: '.75"', 3.625: '3-5/8"', 4.625: '4-5/8"', 6: '6"' };
        return known[n] || `${n}"`;
    }
    // The two ways a double carries its front layer — said as the product, not as the tag.
    if (axis === 'frontLayer') return v === 'FASCIA' ? 'Stationary fascia with rings (one track)' : 'Traverse track front & rear';
    return String(v).charAt(0) + String(v).slice(1).toLowerCase();
};
export const slotLabel = (s) => {
    const kind = s.kind === 'END' ? 'End Treatment' : s.kind.charAt(0) + s.kind.slice(1).toLowerCase().replace('_', ' ');
    const cap = (w) => `${w.charAt(0)}${w.slice(1).toLowerCase()}`;
    // On a double every rod asks its own questions, so the rail must say WHICH ROD — "Front Rod",
    // "Back Left End Treatment". Without it a double shows two identical headings and the operator
    // is answering one of them blind.
    // A single has ONE rod - saying Front/Back on it is noise (and on H1-75, whose only rod
    // is pinned BACK, it read as a rear-rod question on a single order). Doubles keep the word.
    const parts = [(s.tier && !s.tierSolo) ? cap(s.tier) : '', s.position ? cap(s.position) : '', kind].filter(Boolean);
    return parts.join(' ');
};

// ── WHAT IS DRAWN ────────────────────────────────────────────────────────────────────────────
// ADDITIVE, FROM NOTHING: geometry is default-hidden and what you see is exactly the union of what
// has been chosen — so the picture is a list of the nodes to show, keyed the way the renderer keys them.
export function visibleOverridesOf(resolved) {
    const o = {};
    resolved.visible.forEach(n => { o[String(n).toLowerCase()] = true; });
    return o;
}
// 🧊 The clear parts, from the TAG — never from a mesh name. Passing this switches the renderer
// off its hardcoded acrylic item-code list entirely for this configurator.
export const clearListOf = (resolved) => [...resolved.clear].map(n => String(n).toLowerCase());
// ── N CENTRE BRACKETS RENDER AS N (Stuart 2026-09-09: "the old engine used to clone the center
// bracket so if we added 2,3 etc the render added them, can we please bring back that feature
// on the new engine"). The renderer never lost it — DynamicModel still spaces N copies of a
// mesh set along a rail; the old engine fed it from the flow's clone step and this one fed it
// nothing. The same spec, from the resolved model: the CENTER bracket pick (and its plate) as
// the meshes, the bracket alone as the placement anchor, the chosen rod(s) as the rail, the
// slot's quantity as the count. Count comes from `quantities` — typed, else the span advice.
// THE RAIL IS THE WHOLE POLE AS DRAWN (Stuart 2026-09-09: "the 1st bracket is no longer in
// the center it is off to the left"). A rod slot's pick is ONE piece of a pole modelled in
// three (LEFT / CENTER / RIGHT), so spacing along the pick alone centred the bracket on a
// piece. The rail is every rod-role node the render currently shows — all the pieces, and
// only as long as the ends leave it (a return drops its end piece).
export function railNamesOf(resolved, model) {
    const shown = new Set([...resolved.visible].map(n => String(n).toLowerCase()));
    // The F-clip strip runs the length of the track (Stuart 2026-09-09: "it makes it appear
    // that the track is too short since it does not stretch") — a rider, not a rod, but it is
    // rail-length and stretches with the rail; carriers stay discrete pieces and spread.
    return [...new Set((model.choices || [])
        .filter(c => ROD_ROLES.includes(c.role) || c.role === 'FCLIP')
        .flatMap(c => c.nodes || [])
        .filter(n => shown.has(String(n).toLowerCase())))];
}
// ── A LONG ORDER RENDERS LONG (Stuart 2026-09-09: "i am working on a long rod of 144in and it
// will need 5 center brackets … the 5th overruns the left bracket and right bracket. can you
// stretch the rod/pole when they are long?"). DynamicModel scales the pole meshes along their
// axis to this length and moves everything else out with the ends; only when the order is
// longer than the model, and only where the model reads as inches.
export const stretchSpecOf = (railNames, lengthInches) => (lengthInches > 0 && railNames.length ? { railNames, lengthInches } : null);
// ── A SPLICE IS DRAWN AS A PENCIL LINE (Stuart 2026-09-09: "any time there is a splice entered
// it adds a fine line to show it … from cpq it would always be shown in the center, if the
// splice is added in vision at an exact spot then ideally the rendering could show that").
// Fractions along the rail, left to right: the drawing's positions where Vision placed them
// (from the left edge = d / L, from the right = 1 − d / L), else one at the centre, N spread
// evenly. Keyed on the flow's own splice item — the same detection the length step uses — so
// every flow with a joiner gets the line. A picture of a decision already on the line.
export function spliceMarksOf({ extras, spliceCodes, drawnSplices, lengthInches }) {
    const count = extras.filter(x => spliceCodes.includes(x.code)).reduce((n, x) => n + (Number(x.qty) > 0 ? Number(x.qty) : 0), 0);
    if (!count) return [];
    const L = Number(lengthInches) || 0;
    const drawn = drawnSplices.filter(sp => sp && sp.distInches != null && L > 0)
        .map(sp => (String(sp.ref).toUpperCase() === 'END' ? 1 - Number(sp.distInches) / L : Number(sp.distInches) / L))
        .filter(f => Number.isFinite(f)).map(f => Math.min(0.98, Math.max(0.02, f)));
    if (drawn.length) return drawn.map(frac => ({ frac }));
    return Array.from({ length: count }, (_, i) => ({ frac: (i + 1) / (count + 1) }));
}
export function cloneSpecsOf({ resolved, railNames, livePicks, quantities }) {
    const pickOf = (sl) => { const id = livePicks[sl.key]; return id ? (sl.options || []).find(x => x.id === id) || null : null; };
    const out = [];
    resolved.slots.forEach(sl => {
        if (sl.kind !== 'BRACKET' || String(sl.position || '').toUpperCase() !== 'CENTER') return;
        const o = pickOf(sl);
        if (!o || !(o.nodes || []).length) return;
        const plateSlot = resolved.slots.find(x => x.kind === 'BACKPLATE' && String(x.position || '').toUpperCase() === 'CENTER');
        const plate = plateSlot ? pickOf(plateSlot) : null;
        const count = Number(quantities[o.id]) || 1;
        out.push({ stepId: sl.key, meshNames: [...o.nodes, ...((plate && plate.nodes) || [])], anchorNames: [...o.nodes], railNames, count });
    });
    return out;
}
// The parts on the order: what was picked (or picked on the operator's behalf), and what rides on the rod.
export function chosenPartsOf(model, livePicks) {
    const ids = new Set(Object.values(livePicks));
    return [...model.choices.filter(c => ids.has(c.id)), ...model.riders];
}
// ── THE FROZEN RENDER (Stuart 2026-08-21) ────────────────────────────────────────────────────
// The shop floor, the finishing floor and the HQ work-order window re-render a saved
// order from this and nothing else (Shared/ConfiguredItemViewer). The old engine wrote
// it at add; without it a TAGS order opens to an empty canvas six weeks later, when the
// assembly has moved on and nobody can reconstruct what was sold.
//
// ⚠ `defaultHidden` AND `clearNodes` TRAVEL WITH IT. This engine renders ADDITIVELY —
// nothing is visible until it is chosen — so replaying the same overrides without that
// flag would show the entire .glb, every option at once. The old engine's saved states
// carry neither and behave exactly as they always have.
export const renderStateOf = ({ cadUrl, textureOverrides, visibleOverrides, cloneSpecs, stretchSpec, spliceMarks, clearList }) => (cadUrl ? {
    cadUrl,
    textureEntries: Object.entries(textureOverrides || {}).map(([target, url]) => ({ target, url })),
    visibilityEntries: Object.entries(visibleOverrides || {}).map(([target, visible]) => ({ target, visible })),
    cloneSpecs,
    stretchSpec,
    spliceMarks,
    defaultHidden: true,
    clearNodes: clearList,
} : null);

// ── EVERY DECISION IS A STEP (Stuart 2026-08-17) ─────────────────────────────────────────────
// The rail carries the whole product; the panel carries only what is being decided now. An
// answered step shows its ANSWER, so nothing has to be re-opened to check what it was.
//
// Backplates do not get a step of their own — a plate is chosen WITH its arm, so it nests
// inside the bracket step, which is also where the pairing rules can be seen doing their work.
export function stepsOf({ model, isTraverse, trvRules, sizeSteps, sizeProjInches, settledKeys }) {
    const out = [];
    // ── THE FRAMING QUESTIONS ARE ONE STEP (Stuart 2026-08-20) ───────────────────────────
    // "combine steps 1, 2 and 3 into one step … below the rod type box another box for single
    //  or double and then another box below that for mount … that will help keep the rail from
    //  being too long as well."
    //
    // Rod type, single-or-double, drive and mount are all the same kind of question: how is
    // this rod framed, before a single part is chosen. Each is two or three chips, so each was
    // spending a whole step and a whole rail cell on one line of buttons.
    //
    // ⚠ BRACKET PROJECTION IS NOT ONE OF THEM and keeps its own step. It is the one axis with
    // consequences — it gates which brackets exist, and pairs the plates to the arm — so it is
    // a decision, not framing. Grouping everything BELOW it also means nothing is reordered:
    // projection already sorts last of the axes, so the group is the contiguous block in front
    // of it and every question stays exactly where it was.
    // ⚠ THE SIZE QUESTIONS LEAD, because everything after them is a different part. On a
    // combined flow the diameter is the first thing asked and the projection second — the same
    // order, and the same option lists, the old engine asks them in. A collection with no size
    // matrix has no size steps and nothing here changes.
    sizeSteps.forEach(st => out.push({ kind: 'SIZE', key: `size:${st.id}`, sizeStep: st, label: st.title }));
    const liveAxes = model.axes.filter(a => !a.implied && a.values.length > 1)
        // …and the matrix's projection IS the projection question. Asking the tag axis as well
        // would put the same question on screen twice, with two different vocabularies.
        .filter(a => !(a.key === 'proj' && sizeProjInches != null));
    const framing = liveAxes.filter(a => a.key !== 'proj');
    if (framing.length === 1) {
        const a = framing[0];
        out.push({ kind: 'AXIS', key: `axis:${a.key}`, axis: a, label: AXIS_LABEL[a.key] || a.key });
    } else if (framing.length) {
        out.push({ kind: 'AXES', key: 'axes:framing', axes: framing, label: 'Rod Setup' });
    }
    liveAxes.filter(a => a.key === 'proj')
        .forEach(a => out.push({ kind: 'AXIS', key: `axis:${a.key}`, axis: a, label: AXIS_LABEL[a.key] || a.key }));
    const plates = model.slots.filter(s => s.kind === 'BACKPLATE');
    const nested = new Set();
    model.slots.filter(s => s.kind !== 'BACKPLATE').forEach(s => {
        if (!s.options.length && !s.suppressedBy) return;
        if (settledKeys.has(s.key)) return;      // answered by the drive — see settledKeys
        // ── A TRACK END IS NEVER A STEP (Stuart 2026-09-06) ────────────────────────────
        // "can't we remove steps 14+15 for the track ends since these are decided when
        //  choosing manual or motorized — there is no reason to have them as steps … they are
        //  chosen in step one and do not need their own steps as there are no options."
        // A settled end was already skipped (one option → auto-picked, above). A SUPPRESSED
        // front end on a fascia-front double still drew as "not asked", and an end with two
        // options — drive not yet answered — drew as a question that step one answers. None of
        // those is a decision made here. The pick still happens: the drive answer settles it
        // and livePicks carries it, so the end still renders and bills.
        if (s.kind === 'TRV_END') return;
        // A plate belongs to the arm that carries it. Normally that is the bracket — but when a
        // RETURN has taken that end the bracket step is suppressed, and the return is the arm
        // (see bracketAt in hardwareModel), so the plate travels to the END step instead. Left
        // under the suppressed bracket it rendered nowhere and the plate could not be chosen.
        const plateHere = () => plates.find(p => (p.position || '') === (s.position || ''));
        let sub = null;
        if (s.kind === 'BRACKET' && !s.suppressedBy) sub = plateHere();
        else if (s.kind === 'END' && s.position) {
            const bkt = model.slots.find(x => x.kind === 'BRACKET' && (x.position || '') === (s.position || ''));
            if (!bkt || bkt.suppressedBy) sub = plateHere();
        }
        // A double has a front and a back end at each position; the plate is shared, so the
        // first to claim it keeps it rather than both drawing the same picker.
        if (sub && nested.has(sub.key)) sub = null;
        if (sub) nested.add(sub.key);
        out.push({ kind: 'SLOT', key: s.key, slot: s, sub, label: slotLabel(s) });
    });
    plates.filter(p => !nested.has(p.key) && p.options.length)
        .forEach(p => out.push({ kind: 'SLOT', key: p.key, slot: p, label: slotLabel(p) }));
    // ── PHASE 2 OF THE RESHUFFLE (Stuart 2026-08-20) ────────────────────────────────────
    // "after these selections will come pole length (as it helps determine # of brackets)
    //  then lastly the brackets and shared items."
    //
    // Length stops being the last thing asked and becomes the last thing asked BEFORE the
    // brackets, because it is an input to them: 6.5 ft of heavy blackout wants a different
    // number of arms than 6.5 ft of sheer, and the span advice from 6.5 cannot say so until it
    // knows the length. Asked afterwards, the advice arrived when the decision was already made.
    //
    // ── …AND FROM 2026-09-10 RIGHT AFTER THE ROD (Stuart: "right after rod choice should
    // be rod length that is just more natural, then carry on as is with the order"). Placed
    // by the ROD-kind steps (rod, fascia, track) rather than by a fixed index, so it lands
    // correctly whatever the collection offers; a collection with no rod step at all gets
    // it right after the Rod Setup axes, still before the ends.
    const lengthStep = { kind: 'LENGTH', key: 'length', label: 'Pole length' };
    let lastRod = -1, lastAxis = -1;
    out.forEach((st, i) => {
        if (st.kind === 'SLOT' && ROD_ROLES.includes(st.slot.kind)) lastRod = i;
        if (st.kind === 'AXIS') lastAxis = i;
    });
    if (lastRod >= 0) out.splice(lastRod + 1, 0, lengthStep);
    else if (lastAxis >= 0) out.splice(lastAxis + 1, 0, lengthStep);
    else out.push(lengthStep);
    // ── WHAT RIDES ON THE ROD IS ONE QUESTION (Stuart 2026-08-21) ───────────────────────
    // "if the selection for front track is track then the carriers should be presented at 13,
    // if the front is omitted then rings should be presented … it could made in one step since
    // there again is only one answer here."
    //
    // Rings and carriers are the same job done by two parts, and WHICH of them an order needs
    // was already decided upstairs: a track takes carriers, a fascia takes rings (carriesRings,
    // in the model). The engine has always known that — it builds the carriers as riders — but
    // it built them SILENTLY, so a double that chose the front track reached the end of the
    // walk having never been shown the things that will hang the drapery.
    //
    // So where there is no ring question, the carriers take that place in the walk and are
    // SHOWN rather than merely billed. It is not a decision — there is one answer and the drive
    // and the track already gave it — so nothing is asked; it is the step saying what is
    // included, at the count the length works out to.
    const ringSlot = out.find(st => st.kind === 'SLOT' && st.slot.kind === 'RING');
    const carriers = (model.riders || []).filter(r => r.role === 'CARRIER');
    if (!ringSlot && carriers.length) out.push({ kind: 'CARRIERS', key: 'carriers', label: 'Carriers', carriers });

    // …and the track's own components last of all, which is where they belong: every one of
    // them is a function of a decision above (the drive, the length, one track or two), so it
    // is the only step that can be asked once and asked correctly. No rules doc, no step — a
    // collection whose components have never been charted is not asked a question it cannot
    // answer, and says so on the step rather than offering an empty list.
    if (isTraverse && trvRules) out.push({ kind: 'TRV', key: 'traverse', label: 'Traverse components' });
    return out;
}

// Rings-vs-track stopped being an omission the day it became a question (the frontLayer axis,
// Stuart 2026-08-31) — so the track step no longer coaches "omit it". What it says instead is
// the one fact the auto-picked card cannot: the stock finishes follow the fascia, and painting
// to match is the upcharge (offered below via the flow's checkout items on this step).
export function stepHintOf(st) {
    if (!st || st.kind !== 'SLOT') return '';
    if (st.slot.kind === 'TRACK') return 'Chosen by the layout at Rod Setup. Comes in bronze or champagne to coordinate with the fascia — add the custom-finish upcharge to paint it to match.';
    return '';
}

// MASTER CONTROL (Stuart 2026-08-26): tab 11's item list IS what CPQ presents, and each item
// names the STEP it belongs on (free-text match against the step label). Blank keeps the item
// on the pole-length step, where these have always lived — so existing flows are unchanged.
export const extrasOnStepOf = (offeredExtraItems, st) => (offeredExtraItems || []).filter(it => {
    const m = String(it.step || '').trim().toUpperCase();
    if (!m) return st?.kind === 'LENGTH';
    if (st?.kind === 'LENGTH' && /LENGTH|POLE/.test(m)) return true;
    const label = String(st?.label || '').toUpperCase();
    return !!label && (label.includes(m) || m.includes(label));
});

// What the rail shows under each heading: the answer, once there is one.
export function stepAnswerOf(st, { answers, livePicks, lengthFeet, ourId, trvLive, trvRules, trvComponents, sizePick }) {
    if (st.kind === 'AXIS') { const v = answers[st.axis.key]; return v == null || v === '' ? '' : valueLabel(st.axis.key, v); }
    // One cell, every answer in it — the rail still shows the whole product at a glance.
    if (st.kind === 'AXES') {
        return st.axes.map(a => {
            const v = answers[a.key];
            return v == null || v === '' ? '' : valueLabel(a.key, v);
        }).filter(Boolean).join(' \u00b7 ');
    }
    if (st.kind === 'SIZE') {
        const opt = (st.sizeStep.styleOptions || []).find(o => o.optId === sizePick[st.sizeStep.id]);
        return opt ? (opt.partName || opt.label || opt.optId) : '';
    }
    if (st.kind === 'CARRIERS') {
        const n = st.carriers.reduce((sum, c) => sum + (recommendedQty(c, lengthFeet) || c.qty || 1), 0);
        return n ? `${n} included` : 'included';
    }
    if (st.kind === 'LENGTH') return lengthFeet ? `${lengthFeet} ft` : '';
    // The rail says what was decided, so a traverse quote can be read back at a glance: the
    // carrier style is the decision, the count is the consequence.
    if (st.kind === 'TRV') {
        if (!trvLive?.carrierStyle) return '';
        const style = (trvRules?.usage || []).find(u => String(u.itemId || '').toUpperCase() === trvLive.carrierStyle);
        return `${style?.label || trvLive.carrierStyle} · ${trvComponents.length}`;
    }
    if (st.slot.suppressedBy) return 'not asked';
    const pick = st.slot.options.find(o => o.id === livePicks[st.slot.key]);
    return pick ? (ourId(pick.partId) || pick.name) : '';   // our number on the rail too
}

// ⚠ HOW MANY OF THIS EXACT CONFIGURATION (Stuart 2026-08-26: "if customer wants 2 of the exact
// config the last step is ask/enter this"). This is a MULTIPLIER on the whole build — 2 means
// two complete identical sets of every part below, never a dimension. It rides the cart item as
// `qty`, which every consumer already multiplies by (Shared/configQty: the floors print
// "×7 each · 14 total", the NetSuite resolver pushes line qty × this, per-foot lines push
// feet × this while the cut length stays per-piece — so 2 × an 8ft pole is two 8ft poles,
// never a 2ft pole).
export const configQtyOf = (typed) => Math.max(1, parseInt(typed, 10) || 1);

// ── THE REFUSALS AT ADD ──────────────────────────────────────────────────────────────────────
// The one sentence every refusal for a removal says — the same words on the button and in the strip.
export const dropRefusalOf = (pendingDrops) => (pendingDrops.length
    ? `${pendingDrops.length} selection${pendingDrops.length === 1 ? ' was' : 's were'} removed by a later choice — read the strip under the rail and press Understood on each before adding.`
    : '');
/**
 * Why this configuration may not be added yet — null when it may. In the order the screen checks them:
 *   NOTHING_PRICED    no line to add (the button is greyed; nothing is said)
 *   REMOVALS          ⚠ NEVER ADD SHORT (Stuart 2026-09-10). A removal nobody has acknowledged is an order that
 *                     would leave here missing a part the operator chose. The strip names it; Add waits.
 *   BARE_WOOD         ⚠ WOOD WEARS A STAIN OR IT DOES NOT LEAVE HERE (Stuart 2026-09-16 — bareWoodOf). The add names
 *                     the parts and waits; the WOOD row of the finish step (or the part's own swatch) is the answer.
 *   FINISH_QUESTIONS  A FINISH THAT ASKS IS ANSWERED BEFORE THE LINE LEAVES (Stuart 2026-10-06: "yes required"). Solid
 *                     brass with no word on brushed / polished, lacquered or not, is an order the floor cannot make.
 * `alert` is what the CPQ screen says out loud (the first two say nothing: the button and the strip already do).
 */
export function addRefusalOf({ priced, pendingDrops, chosenList, finishFor, askingFinishes, finishAnswers }) {
    if (!priced.lines.length) return { kind: 'NOTHING_PRICED' };
    if (pendingDrops.length) return { kind: 'REMOVALS', message: dropRefusalOf(pendingDrops) };
    const bareWood = bareWoodOf(chosenList, finishFor);
    if (bareWood.length) {
        return { kind: 'BARE_WOOD', bareWood,
            alert: `Pick the WOOD finish first — ${bareWood.map(c => c.name || c.partId).join(', ')} would leave here with no stain.\n\nChoose it on the WOOD row of the finish step, or on the part itself.` };
    }
    const openQuestions = openFinishQuestionsOf(askingFinishes, finishAnswers);
    if (openQuestions.length) {
        return { kind: 'FINISH_QUESTIONS', openQuestions,
            alert: `Answer the finish questions first — ${openQuestions.map(([a, m]) => `${a.code}${a.finish.name ? ` (${String(a.finish.name).trim()})` : ''}: ${m.join(', ')}`).join(' · ')}.\n\nThey are at the top of the finish panel and apply to the whole configuration.` };
    }
    return null;
}

// ── THE CART LINE ────────────────────────────────────────────────────────────────────────────
// extraLines = the extras AS THE PANEL PRICED THEM (priceChoice, customer row) — the
// handoff uses these verbatim so the docs, floors and NetSuite bill what was shown.
// Filtered to extras actually TAKEN: extraLines coerces a 0 qty to 1 for display.
export const takenExtraLinesOf = (extraLines, extras) =>
    extraLines.filter(l => Number((extras.find(x => x.code === l.partId && (x.slot || '') === (l.slot || '')) || {}).qty) > 0);
/**
 * THE HANDOFF IS BUILT HERE, in the shape CPQ has always written — so the shop floor, the
 * finishing floor, RTG, the ERP push and the CRM documents all keep working without
 * knowing which engine produced the order.
 *
 * `renderSnapshot` is a picture of what was configured, taken as it is added (the screen's; a caller with no
 * canvas passes none — it never blocks the add). `renderState` is the frozen render (renderStateOf).
 */
export function cartLineOf({ resolved, pricingCtx, assembly, flow, findPart, qty, renderSnapshot = null, pins, memo,
    chosenFinishObjects, effectiveLevel, lengthInches, lengthFeet, extras, extraLines, stepNotes, stepNoteClient,
    answers, livePicks, partFinish, globalFinish, globalFinishes, stepQty, liveFinishAnswers,
    kitBill, kitSource, kitPick, kitMotor, isTraverse, trvSel, trvComponents, trvLive, renderState,
    steps, noSplice, spliceOverIn }) {
    const built = handoffItem(resolved, {
        ...pricingCtx, assembly, flow, findPart, qty, renderSnapshot,
        // The pins this line was resolved from — fingerprinted on the line so Approve can tell
        // when the tags have changed since the save (Shared/cartStaleness).
        pins,
        sidemark: memo, memo,
        finishes: chosenFinishObjects, finishLabel: finishLabelOf(chosenFinishObjects),
        priceLevel: effectiveLevel, lengthInches, lengthFeet,
        extras, extraLines: takenExtraLinesOf(extraLines, extras),
        stepNotes, answers, picks: livePicks, partFinish, globalFinish, globalFinishes, stepQty,
        // What the finishes were asked — written into each line's finish text, and kept for Edit.
        finishAnswers: liveFinishAnswers,
        // The kit, so the cart bills exactly what the panel showed — and WHICH kit, so Edit restores it.
        kit: kitBill, kitPick: kitSource ? kitPick : '', kitMotor: kitSource ? kitMotor : '',
        // The Traverse components answers (carrier style + count, draw, picks) — Edit restores them, or
        // a re-add would silently swap the chosen carriers back for the pinned ones.
        trvSel: (isTraverse && trvSel) ? trvSel : null,
        // The track's components, in the shape the cart has always carried them — the ERP push
        // reads `trvComponents` off the item and the documents read the breakdown rows, so
        // neither can tell which engine asked the question.
        trvComponents,
        // ── HOW IT OPENS, ON THE ORDER (Stuart 2026-08-22) ───────────────────────────────
        // Not a part and not a price — an instruction. The bench assembles the carriers to it
        // and hangs the master on the drawn side, so it has to reach the floor and the
        // paperwork, not just the screen it was answered on.
        traverseDraw: trvLive?.draw || '',
        traverseMotorSide: trvLive?.motorSide || '',
        renderState,
    });
    // ── WHAT THE SHOP IS TOLD, ON THE LINE THE SHOP READS (Stuart 2026-10-01 · Shared/lineShopNotes) ──
    // The note typed on each step ("Anything the shop needs to know about Pole length") was saved
    // for Edit and read by nothing else. It goes on the line's generalNotes — View Item prints
    // them, RTG stamps them on the shop order — under the step it was typed on. A pole over the
    // one-piece limit going out with no joiner leads the list, and carries the flag the reopen reads.
    const shopNotes = shopNotesOf({ steps, stepNotes, lead: noSplice ? [noSpliceNote(lengthInches, spliceOverIn)] : [] });
    // The notes ticked "show to the customer" also ride the line as clientNotes — CPQ's save writes them under
    // this configuration as display-only rows the money documents print. The ticks are saved for Edit.
    const clientNotes = clientNotesOf({ steps, stepNotes, visible: stepNoteClient });
    const ticked = Object.keys(stepNoteClient).length > 0;
    return (noSplice || shopNotes.length || ticked)
        ? { ...built,
            ...((noSplice || ticked) ? { engineConfig: { ...built.engineConfig, ...(noSplice ? { spliceWaived: true } : {}), ...(ticked ? { stepNoteClient: { ...stepNoteClient } } : {}) } } : {}),
            ...(shopNotes.length ? { generalNotes: shopNotes } : {}),
            ...(clientNotes.length ? { clientNotes } : {}) }
        : built;
}

/**
 * The configuration, in one call — for a caller that is not a React screen (the portal's server, a
 * harness). The CPQ screen makes these SAME calls one memo at a time, so a keystroke re-works only
 * what it touched; this makes them in the same order, with the same arguments.
 *
 * @param data   { assembly, pins, parts, flow, spanMap, spanCaps, trvRules, extraItems, finishes, flowFinishes,
 *                 customer, customerId, priceLevel, outsourceCodes, kits } — what the screen is handed
 * @param state  { answers, picks, sizePick, lengthInches, stepQty, fabricId, extras, spliceWaived, globalFinishes,
 *                 globalFinish, partFinish, finishAnswers, kitPick, kitCode, kitMotor, trvSel, stepNotes,
 *                 stepNoteClient, memo, qty, drawnSplices, drops } — what the operator has answered, as a cart
 *               line saves it (engineConfig); a saved length, the saved add-by-hand rows, the saved finish
 *               defaults, the kit a line was billed from, the notes and the ticks are read back exactly as Edit
 *               restores them. `drops` is what has already been named as removed, with what was acknowledged
 *               (each { key, acked }) — a caller that shows the removals hands them back with `acked: true`.
 * @returns everything the screen works out, by the screen's own names — among them `steps` (the walk),
 *          `refusal` (why it may not be added yet, or null) and `item` (the cart line; null while refused)
 */
export function sessionOf({ assembly, pins = [], parts = [], flow = null, spanMap = {}, spanCaps = {}, trvRules = null, extraItems = [],
    finishes = [], flowFinishes = [], customer = null, customerId = '', priceLevel = 'STANDARD', outsourceCodes = [], kits = [] } = {},
    { answers = {}, picks = {}, sizePick = {}, lengthInches: savedLength = null, stepQty = {}, fabricId = 'PRINT', extras: savedExtras = [], spliceWaived = false,
        globalFinishes: savedGlobalFinishes = null, globalFinish: savedGlobalFinish = '', partFinish: savedPartFinish = null,
        finishAnswers: savedFinishAnswers = null, kitPick = '', kitCode = '', kitMotor = '', trvSel: savedTrvSel = null,
        stepNotes: savedStepNotes = null, stepNoteClient: savedStepNoteClient = null, memo: savedMemo = '', sidemark = '', qty: savedQty = 1,
        drawnSplices: savedDrawnSplices = null, drops: savedDrops = null, renderSnapshot = null } = {}) {
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
    // The bill: the answers a finish asked and the Traverse components answers as Edit restores them (each a copy),
    // the kit the line was billed from found among this flow's kits.
    const finishAnswers = (savedFinishAnswers && typeof savedFinishAnswers === 'object') ? JSON.parse(JSON.stringify(savedFinishAnswers)) : {};
    const trvSel = savedTrvSel && typeof savedTrvSel === 'object' ? { ...savedTrvSel } : null;
    const bill = billOf({ customer, customerId, priceLevel, outsourceCodes, flow, kits, trvRules, findPart, model, resolved, livePicks, extras, lengthFeet, lengthInches,
        spliceCodes, spliceOverIn, sameItemCode, finishByCode: fin.finishByCode, globalFinish: fin.globalFinish, lineFinishFor: fin.lineFinishFor, subFinishFor: fin.subFinishFor,
        matchFinishOverride: fin.matchFinishOverride }, { answers, kitPick, kitCode, kitMotor, trvSel, finishAnswers });
    // The walk, what is drawn, whether it may be added and the cart line: the notes, the ticks, the memo, the
    // multiplier and a drawing's splices read back as Edit (or a restored workspace) restores them.
    const stepNotes = { ...(savedStepNotes || {}) };
    const stepNoteClient = (savedStepNoteClient && typeof savedStepNoteClient === 'object') ? { ...savedStepNoteClient } : {};
    const drawnSplices = Array.isArray(savedDrawnSplices) ? savedDrawnSplices.map(sp => ({ distInches: sp.distInches, ref: sp.ref || '' })) : [];
    const memo = savedMemo || sidemark || '';
    const qty = configQtyOf(savedQty);
    const steps = stepsOf({ model, isTraverse: bill.isTraverse, trvRules, sizeSteps, sizeProjInches, settledKeys });
    const answerOf = (st) => stepAnswerOf(st, { answers, livePicks, lengthFeet, ourId, trvLive: bill.trvLive, trvRules, trvComponents: bill.trvComponents, sizePick });
    const extrasOnStep = (st) => extrasOnStepOf(offeredExtraItems, st);
    const visibleOverrides = visibleOverridesOf(resolved);
    const clearList = clearListOf(resolved);
    const railNames = railNamesOf(resolved, model);
    const stretchSpec = stretchSpecOf(railNames, lengthInches);
    const spliceMarks = spliceMarksOf({ extras, spliceCodes, drawnSplices, lengthInches });
    const cloneSpecs = cloneSpecsOf({ resolved, railNames, livePicks, quantities });
    const chosen = chosenPartsOf(model, livePicks);
    const cadUrl = assembly?.manufacturingSpecs?.cadUrl;
    const renderState = renderStateOf({ cadUrl, textureOverrides: fin.textureOverrides, visibleOverrides, cloneSpecs, stretchSpec, spliceMarks, clearList });
    // What a later choice removed (Shared/pickDrops), over what was already named and acknowledged.
    const drops = mergeDrops(Array.isArray(savedDrops) ? savedDrops : [], droppedPicks(model, picks, livePicks, { labelOf: slotLabel }));
    const pendingDrops = unacknowledged(drops);
    const dropRefusal = dropRefusalOf(pendingDrops);
    const refusal = addRefusalOf({ priced: bill.priced, pendingDrops, chosenList: fin.chosenList, finishFor: fin.finishFor, askingFinishes: bill.askingFinishes, finishAnswers });
    const item = refusal ? null : cartLineOf({ resolved, pricingCtx: bill.pricingCtx, assembly, flow, findPart, qty, renderSnapshot, pins, memo,
        chosenFinishObjects: fin.chosenFinishObjects, effectiveLevel: bill.effectiveLevel, lengthInches, lengthFeet, extras, extraLines: bill.extraLines, stepNotes, stepNoteClient,
        answers, livePicks, partFinish, globalFinish: fin.globalFinish, globalFinishes, stepQty, liveFinishAnswers: bill.liveFinishAnswers,
        kitBill: bill.kitBill, kitSource: bill.kitSource, kitPick: bill.kitPick, kitMotor: bill.kitMotor, isTraverse: bill.isTraverse, trvSel, trvComponents: bill.trvComponents, trvLive: bill.trvLive,
        renderState, steps, noSplice: bill.noSplice, spliceOverIn });
    return { findPart, ourId, sizeSteps, sizeSel, sizeIndex, sizeProjInches, choices, effAnswers, modelNodes, model, settledKeys, livePicks,
        lengthInches, lengthFeetExact, lengthFeet, advice, recommendFor, quantities, resolved,
        sameItemCode, rodMats, offeredExtraItems, typedExtras, extras, spliceCodes, spliceCode, spliceOverIn, spliceNeeded, spliceSatisfied,
        ...fin, finishAnswers, trvSel, ...bill,
        stepNotes, stepNoteClient, drawnSplices, memo, qty, steps, answerOf, extrasOnStep, visibleOverrides, clearList, railNames, stretchSpec, spliceMarks, cloneSpecs,
        chosen, cadUrl, renderState, drops, pendingDrops, dropRefusal, refusal, item };
}
