// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE PORTAL'S SERVER RUNS THE ENGINE HQ RUNS (Stuart 2026-10-12, the portal rebuild — step 3)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// "ok as long as we can always keep in total alignment."
//
// The old portal carried its own port of CPQ's pricing (functions/portalEngine.js) and fell two months
// behind it. This file has no engine of its own: it loads the COPY of HQ's engine that the deploy makes
// (functions/engine — scripts/sync-engine.mjs, byte for byte from src/components/Shared) and calls the
// one function HQ's CPQ screen is built on, hardwareSession.sessionOf. What a customer sees on the portal
// and what lands in HQ are both that function's answer.
//
// THE SERVER DECIDES, THE BROWSER DRAWS. For each click the portal sends the customer's answers and gets
// back the whole VIEW — the steps and what each offers, what is drawn, the price lines, why it cannot be
// requested yet. No part record, no pin, no cost, no vendor and no other customer's row ever leaves here:
// the view is built field by field below, from names, part numbers, node names and money at the level
// this customer's portal shows.
//
// HIS RULINGS, kept here:
//   · 10-12 "price everything for now at full retail" — the portal SHOWS the level set in Portal Access
//     (Fabricut: Retail). It never shows a customer's COST level: where no shown level is set and the
//     customer's own level is cost, the view carries no money at all.
//   · 10-12 "request should land on our hq app at our selling price to fabricut" — the REQUEST is worked
//     out again here at the customer's OWN level (Shared/priceLevels.customerPriceLevel, the level CPQ
//     itself would use for them) and that is the cart line HQ receives. What was shown never reaches a quote.
//   · 10-12 solid brass: "cpq only" — a finish that turns a part into its other-material item is not
//     offered here and is refused if named (the test tab 7's refusal uses: Shared/materialTwin).
//   · 10-13 a customer adds NO items by hand (the engine adds the splice a long pole needs; staff add the
//     rest on review); a line with no firm price reads "priced on review" and the request still goes through.
//   · 10-14 (step 4, "yes go on A to D" · "yes love the preview idea"): solid brass is held back on EVERY flow,
//     not only where a pinned part swaps to its brass item; a finish click follows CPQ's own "this part only"
//     rule (Shared/finishScope); the screen gets what it needs to draw with HQ's own drawing code (the nodes of
//     each option for its picture, how each finish catches the light, the scale); a removed part is explained in
//     the customer's words; and a product can be on PREVIEW — seen only by the logins ticked for it.
//
// Pure but for loadEngine (which reads the copy from disk): the Cloud Functions in index.js fetch the
// records and call these. Harness: scripts/portalSession.test.mjs.

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const txt = (v, max = 200) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const money = (v) => Math.round((Number(v) || 0) * 100) / 100;

// ── THE ENGINE COPY ──────────────────────────────────────────────────────────────────────────
// ES modules (the copy carries its own package.json), loaded once per instance. `stamp` is what this
// server is running: the engine's version and the hash of every file in the copy (MANIFEST.json).
const loadedFrom = new Map();
async function loadEngine(dir = path.join(__dirname, 'engine')) {
    if (loadedFrom.has(dir)) return loadedFrom.get(dir);
    const at = (f) => pathToFileURL(path.join(dir, f)).href;
    const [session, pricing, levels, twin, handoff, itemKit, model, pbr, scope, span, size, kitStart, trvCfg, trvDraw, clientPricing, qsItems, qsPricing, kitSale] = await Promise.all([
        import(at('hardwareSession.js')), import(at('hardwarePricing.js')), import(at('priceLevels.js')), import(at('materialTwin.js')),
        import(at('hardwareHandoff.js')), import(at('itemKit.js')), import(at('hardwareModel.js')),
        import(at('finishPbr.js')), import(at('finishScope.js')), import(at('bracketSpan.js')), import(at('sizeMatrix.js')),
        import(at('kitStart.js')), import(at('traverseConfigurator.js')), import(at('traverseDraw.js')), import(at('clientPricing.js')),
        import(at('quickShipItems.js')), import(at('quickShipPricing.js')), import(at('traverseKitSale.js'))]);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'MANIFEST.json'), 'utf8'));
    const engine = {
        sessionOf: session.sessionOf, spanRiskKeyOf: session.spanRiskKeyOf, offeredFinishesOf: session.offeredFinishesOf, stepHintOf: session.stepHintOf, valueLabel: session.valueLabel, AXIS_LABEL: session.AXIS_LABEL,
        finishGroupLabel: session.finishGroupLabel, lengthInchesOf: session.lengthInchesOf,
        aliasFor: pricing.aliasFor, PRICE_SOURCES: pricing.PRICE_SOURCES, customerPriceLevel: levels.customerPriceLevel,
        wearsAsTwin: twin.wearsAsTwin, customerLines: handoff.customerLines, isItemKit: itemKit.isItemKit,
        takesQty: model.takesQty, companionsFor: model.companionsFor,
        pbrMapOf: pbr.pbrMapOf, FABRIC_CLASSES: span.FABRIC_CLASSES, renderScaleOf: size.renderScaleOf,
        scope: { scopeTargetsOf: scope.scopeTargetsOf, scopeInForce: scope.scopeInForce, swatchActionOf: scope.swatchActionOf, highlightOf: scope.highlightOf },
        // "Start from a kit" and the Traverse components step, as CPQ does them (2026-10-20)
        kitsForFlowOf: kitStart.kitsForFlowOf, kitIdOf: kitStart.kitIdOf, kitStartOf: kitStart.kitStartOf, kitFillsOf: kitStart.kitFillsOf,
        configuratorOffer: trvCfg.configuratorOffer, DRAWS: trvDraw.DRAWS, MOTOR_SIDES: trvDraw.MOTOR_SIDES, traverseAnswersMissing: trvDraw.traverseAnswersMissing,
        findClientPriceRow: clientPricing.findClientPriceRow, customerKeys: clientPricing.customerKeys,
        // the Quick Ship door, as tab 7 reads, prices and sells (2026-10-20)
        quickShip: { catOf: qsItems.catOf, isInsideMount: qsItems.isInsideMount, finishOf: qsItems.quickShipFinishOf, priceCtxOf: qsPricing.quickShipPriceCtxOf, rateOf: qsPricing.quickShipRateOf },
        kitSale: { kitsOf: kitSale.traverseKitsOf, byCode: kitSale.traverseKitByCode, finishesOf: kitSale.traverseKitFinishesOf, isSingle: kitSale.traverseKitIsSingle,
            projectionsOf: kitSale.traverseKitProjectionsOf, familyOf: kitSale.traverseKitFamilyOf, orderOf: kitSale.traverseKitOrderOf },
        stamp: { engineVersion: String(manifest.engineVersion || ''), closureHash: String(manifest.closureHash || ''), files: Object.keys(manifest.files || {}).length },
    };
    loadedFrom.set(dir, engine);
    return engine;
}

// ── WHAT CPQ HANDS THE ENGINE FOR A FLOW, FROM THE SAME RECORDS ──────────────────────────────
// HQ/CPQTab.js mounts the configurator with: the brand's library (Inventory / Fee / Alias and anything
// ticked for checkout), its assemblies, the kits that are made of parts, the master + outsourced finishes,
// the flow's own add-by-hand list and finish list, 6.5's span map, the flow family's traverse chart, and
// the customer's CRM record. This builds exactly that from the records the function read. `records` is
// every Approved_Designs record (the brand filter is CPQ's: the brand itself, or shared with it).
function worldFor(engine, { flow, records = [], pins = [], finishes = [], outsourceFinishes = [], spanDoc = null, trvRules = null, customer = null, customerId = '' }) {
    const brand = (flow && flow.brandId) || (customer && customer.brandId) || '';
    const mine = (records || []).filter((d) => d && (d.brandId === brand || (Array.isArray(d.sharedBrands) && d.sharedBrands.includes(brand))));
    const libraryParts = mine.filter((d) => ['Inventory', 'Fee', 'Alias'].includes(d.partClass) || (d.manufacturingSpecs && d.manufacturingSpecs.checkoutSelectable === true));
    const liveAssemblies = mine.filter((d) => d.partClass === 'Assembly' || d.partClass === 'Master Assembly');
    const kitLibrary = mine.filter((d) => d.partClass === 'Kit');
    const assembly = liveAssemblies.find((a) => a.id === (flow && flow.linkedAssemblyId)) || null;
    return {
        assembly, pins: pins || [],
        parts: [...libraryParts, ...liveAssemblies, ...kitLibrary.filter(engine.isItemKit)],
        // "Start from a kit": the kits CPQ's own picker offers on this flow (Shared/kitStart.kitsForFlowOf — 2026-10-20)
        kits: engine.kitsForFlowOf(kitLibrary, { assembly, flow }),
        finishes: [...(finishes || []), ...(outsourceFinishes || [])], outsourceCodes: outsourceFinishes || [],
        flow, spanMap: (spanDoc && spanDoc.map) || {}, spanCaps: (spanDoc && spanDoc.caps) || {},
        extraItems: (Array.isArray(flow && flow.extraItems) ? flow.extraItems : []).filter((x) => String((x && x.code) || '').trim()),
        flowFinishes: Array.isArray(flow && flow.flowFinishes) ? flow.flowFinishes : [],
        trvRules: trvRules || null, customer: customer || null, customerId: String(customerId || ''),
    };
}
// The traverse chart a flow reads: its kit family, H1-2TRV where it names none (CPQTab's own rule).
const trvFamilyOf = (flow) => U(flow && flow.kitFamily) || 'H1-2TRV';

// ── THE TWO LEVELS ───────────────────────────────────────────────────────────────────────────
// SHOWN: what Portal Access set for this customer (Wholesale or Retail). With none set the engine falls
// back to the customer's own level, as CPQ does — and if that is a COST level the portal shows no money.
// OWN: the level CPQ itself prices this customer at with nothing chosen — the request's.
const SHOWABLE = ['FAB_RETAIL', 'FAB_WHOLESALE'];
function levelsFor(engine, customer) {
    const set = U(customer && customer.portalPriceLevel);
    const own = engine.customerPriceLevel(customer, 'STANDARD').level;
    const shown = SHOWABLE.includes(set) ? set : own;
    return { own, shown, chosenForShown: SHOWABLE.includes(set) ? set : 'STANDARD', money: shown !== 'FAB_COST' };
}

// ── THE FINISHES THE PORTAL OFFERS ───────────────────────────────────────────────────────────
// The flow's own list (as CPQ narrows it), less SOLID BRASS — on every flow and at every step ("cpq only",
// Stuart 2026-10-12). A brass finish is known by its MATERIAL, the word the engine itself groups it by
// (hardwareSession.finishGroupLabel: a material that says BRASS is "Solid brass"). Until 2026-10-14 this held it
// back only where a part the assembly pins would swap to its brass item, and LBR showed on H1-75, H1-138 and
// H1-2TRV before anything was picked — CPQ lists a flow's whole list until a part is chosen.
const CPQ_ONLY_MATERIAL = /BRASS/;
function portalFinishesOf(engine, data) {
    return engine.offeredFinishesOf(data.finishes, data.flowFinishes).filter((f) => !CPQ_ONLY_MATERIAL.test(U(f.material || f.type)));
}
const codeOfFinish = (f) => U(f && (f.code || f.name));

// ── WHAT THE BROWSER MAY SAY ─────────────────────────────────────────────────────────────────
// The customer's answers, field by field. Anything else it sends is dropped; anything the portal does not
// offer is refused by name. NOT taken from a customer: items added by hand, a declined splice, shop notes, a
// price level. The kit, its motor code and the traverse components ARE (2026-10-20) — in their shape here, and
// whatever this configuration does not offer is dropped before anything is priced (sessionFor below).
const FABRICS = ['SHEER', 'PRINT', 'BLACKOUT'];
class Refused extends Error { constructor(code, message) { super(message); this.code = code; } }
function stateFromClient(raw, { finishCodes = new Set(), lengthOf = null } = {}) {
    const r = isObj(raw) ? raw : {};
    const flat = (o, max, val) => { const out = {}; if (isObj(o)) Object.entries(o).slice(0, max).forEach(([k, v]) => { const x = val(v); if (x !== undefined && String(k).length <= 160) out[String(k)] = x; }); return out; };
    const scalar = (v) => (typeof v === 'string' ? v.slice(0, 160) : (typeof v === 'number' && Number.isFinite(v) ? v : undefined));
    const str = (v) => (typeof v === 'string' && v ? v.slice(0, 200) : undefined);
    const fin = (v) => { const c = U(v); if (!c) return undefined; if (!finishCodes.has(c)) throw new Refused('FINISH_NOT_OFFERED', `The finish ${c} is not offered on the portal.`); return c; };
    // The length as the customer TYPED it — whole inches and a fraction, the way an installer measures — is turned into
    // inches here by the engine's own rule (hardwareSession.lengthInchesOf), so the screen never works a length out.
    const typedIn = (typeof r.poleIn === 'string' || typeof r.poleIn === 'number') ? String(r.poleIn).slice(0, 12) : '';
    const typedFrac = typeof r.poleFrac === 'string' ? r.poleFrac.slice(0, 12) : '';
    const typed = (typedIn || typedFrac) && typeof lengthOf === 'function' ? lengthOf(typedIn, typedFrac) : null;
    const length = typed !== null && typed !== undefined ? Number(typed) : Number(r.lengthInches);
    const stepQty = flat(r.stepQty, 60, (v) => { const n = parseInt(v, 10); return n > 0 && n <= 9999 ? String(n) : undefined; });
    const finishAnswers = {};
    if (isObj(r.finishAnswers)) Object.entries(r.finishAnswers).slice(0, 12).forEach(([code, a]) => { const c = U(code); if (finishCodes.has(c) && isObj(a)) finishAnswers[c] = flat(a, 8, str); });
    const qty = parseInt(r.qty, 10);
    // The curtain length (rod to floor) and whether the brackets go into studs — what 6.5's span is worked from with the
    // fabric weight (2026-10-19). A number or nothing: the engine works anything outside its range at the 8 ft 6.5 assumes.
    const drop = typeof r.dropFt === 'number' ? r.dropFt : (typeof r.dropFt === 'string' && r.dropFt.trim() ? Number(r.dropFt.slice(0, 8)) : NaN);
    return {
        answers: flat(r.answers, 20, scalar), picks: flat(r.picks, 80, str), sizePick: flat(r.sizePick, 8, str),
        lengthInches: Number.isFinite(length) && length > 0 && length <= 600 ? length : null,
        stepQty, fabricId: FABRICS.includes(U(r.fabricId)) ? U(r.fabricId) : 'PRINT',
        dropFt: Number.isFinite(drop) && drop > 0 ? drop : null, onStud: r.onStud !== false,
        // what the customer pressed Confirm on in the risk window (fewer centre brackets than recommended): the short count's own key
        // (hardwareSession.spanRiskKeyOf) — words on the request, and only while it is still the count on the line
        riskConfirmed: typeof r.riskConfirmed === 'string' ? r.riskConfirmed.slice(0, 80) : '',
        globalFinishes: flat(r.globalFinishes, 6, fin), partFinish: flat(r.partFinish, 80, fin), finishAnswers,
        memo: txt(r.memo, 120), qty: qty > 0 && qty <= 999 ? qty : 1,
        // what was named as removed and acknowledged — the keys only; the entries themselves are worked out here
        drops: (Array.isArray(r.drops) ? r.drops : []).slice(0, 80).filter((d) => isObj(d) && typeof d.key === 'string' && d.acked === true).map((d) => ({ key: d.key.slice(0, 400), acked: true })),
        extras: [], spliceWaived: false, kitCode: '', stepNotes: {}, stepNoteClient: {},
        // "Start from a kit" and the Traverse components step (Stuart 2026-10-20: "the traverse kits needs to behave the same cpq in
        // the app"): the kit picked (by the id CPQ's picker holds), its per-motor code, and the track's answers.
        kitPick: typeof r.kitPick === 'string' ? r.kitPick.slice(0, 120) : '', kitMotor: typeof r.kitMotor === 'string' ? r.kitMotor.slice(0, 80) : '',
        trvSel: trvSelShapeOf(r.trvSel),
    };
}
// The Traverse components answers, in CPQ's shape (TraverseConfiguratorPanel): a carrier style and how many, the draw, the motor
// side, the components and accessories ticked with their counts. Codes as the chart spells them; counts 0–99.
function trvSelShapeOf(raw) {
    if (!isObj(raw)) return null;
    const counts = (o) => { const out = {}; if (isObj(o)) Object.entries(o).slice(0, 40).forEach(([k, v]) => { const n = parseInt(v, 10); const c = U(k).slice(0, 60); if (c && n >= 0 && n <= 99) out[c] = n; }); return out; };
    return {
        carrierStyle: U(raw.carrierStyle).slice(0, 60), carrierQty: String(raw.carrierQty == null ? '' : raw.carrierQty).replace(/[^0-9]/g, '').slice(0, 4),
        draw: U(raw.draw).slice(0, 12), motorSide: U(raw.motorSide).slice(0, 12), picks: counts(raw.picks), accessories: counts(raw.accessories),
    };
}

// WHERE THE CUSTOMER IS — the step on screen and what they last said a finish click applies to there. Not part of
// the configuration (nothing is priced from it): it only decides what a swatch click would set (Shared/finishScope).
const SCOPES = ['PART', 'COLLAR', 'WHOLE'];
function uiFromClient(raw) {
    const r = isObj(raw) ? raw : {};
    return { step: typeof r.step === 'string' ? r.step.slice(0, 160) : '', scope: SCOPES.includes(U(r.scope)) ? U(r.scope) : '',
        // …and, for "Start from a kit" (2026-10-20): the kit just picked (what it fills in is worked out once, here), whether its
        // brackets are still being filled in as their steps become answerable, and the ones already filled (never filled twice)
        kitStart: typeof r.kitStart === 'string' ? r.kitStart.slice(0, 120) : '', kitArmed: r.kitArmed === true,
        kitDone: (Array.isArray(r.kitDone) ? r.kitDone : []).filter((k) => typeof k === 'string').slice(0, 200).map((k) => k.slice(0, 400)) };
}

// WHICH PRODUCTS A LOGIN MAY OPEN (CRM → Portal Access): every flow set LIVE; and, for the logins ticked "sees
// previews", the flows set to PREVIEW — so a product is tried on the customer's own account, exactly as they will
// see it, before any of their people can (Stuart 2026-10-14: "yes love the preview idea"). The same answer whether
// or not a flow exists, so nobody can probe for flows.
function flowIdsFor(crm, uid) {
    const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []);
    const live = list(crm && crm.portalFlowIds);
    const previewer = !!uid && list(crm && crm.portalPreviewUids).includes(String(uid));
    const preview = previewer ? list(crm && crm.portalPreviewFlowIds).filter((id) => !live.includes(id)) : [];
    return { live, preview, all: [...live, ...preview] };
}

// ── THE VIEW ─────────────────────────────────────────────────────────────────────────────────
// Everything the portal draws for one set of answers, built field by field from the engine's answer.
const REFUSAL_WORDS = {
    NOTHING_PRICED: 'Choose a rod to begin.',
    REMOVALS: 'A later choice removed something you had picked — look at what was removed and confirm before sending.',
    BARE_WOOD: 'Choose a wood finish — the wood parts on this order have none yet.',
    BARE_COLOUR: 'Choose a colour — a part on this order is sold in colours and has none yet.',
    FINISH_QUESTIONS: 'One of your finishes has a question still to answer.',
    SPLICE_CENTRE: 'This pole is made in two pieces — choose a centre bracket: one sits at the splice.',
};
// The words for a finish group that a CUSTOMER reads: CPQ's own for what it knows (Painted · Plated · Wood · Solid
// brass — hardwareSession.finishGroupLabel), and an unfamiliar material by its own name, never "In house" /
// "Outsourced", which are ours to know.
const titled = (v) => txt(String(v || '').toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()));
const groupWord = (engine, material, kind) => (/METAL|WOOD|BRASS/.test(U(material)) ? engine.finishGroupLabel(material, kind) : titled(material));
// Why a pick was taken off, in the customer's words. The engine's reason is written for the shop ("mount — tagged
// CEILING, this order is WALL", "its tag in 1.6 was changed …"); what the customer needs is what it means for them.
const removalWords = (reason) => (/not made in the size now chosen/i.test(String(reason || '')) ? 'it is not made in the size now chosen'
    : /no longer on this assembly|re-made since this line was saved/i.test(String(reason || '')) ? 'it is no longer offered on this step'
        : 'it does not go with a choice made after it');

function viewOf(engine, data, raw, { level = 'STANDARD', money: showMoney = true, ui = {} } = {}) {
    // (what this configuration does not offer — a kit, a motor code, a track answer — is dropped before anything is priced)
    const { s, state } = sessionFor(engine, data, raw, level);
    const part = (id) => s.findPart(id);
    const their = (id) => engine.aliasFor(part(id), s.priceCtx) || '';
    // An option: our number, theirs, our description — and the nodes it owns in the model, which is what HQ's own picture
    // of it is photographed from (Shared/hardwareThumbs). Node names are already what the drawing below is made of.
    const option = (o, key) => ({ id: o.id, code: s.ourId(o.partId), sku: their(o.partId), name: txt((part(o.partId) || {}).itemName || o.name), noFinish: !!o.noFinish, on: s.livePicks[key] === o.id,
        nodes: (Array.isArray(o.nodes) ? o.nodes : []).slice(0, 60).map((n) => txt(n, 160)) });
    const slotView = (slot) => (slot ? { key: slot.key, notAsked: slot.suppressedBy ? txt(slot.suppressedReason, 240) : '', options: (slot.options || []).map((o) => option(o, slot.key)) } : null);
    // WHICH ROD, BY WHAT THE LENGTH NEEDS (2026-10-19): each rod a step offers, with how many supports the pole would need with it.
    const rodRow = (x) => ({ id: x.id, code: s.ourId(x.partId), sku: their(x.partId), name: txt((part(x.partId) || {}).itemName || ''), supports: x.supports, picked: !!x.picked });
    const stepLabelOf = (key) => { const st = s.steps.find((x) => x.kind === 'SLOT' && x.slot.key === key); return st ? st.label : ''; };
    const rods = (s.rodOptions || []).map((r) => ({ key: r.slotKey, label: stepLabelOf(r.slotKey) || 'Rod', options: r.options.map(rodRow), better: r.better ? rodRow(r.better) : null }));
    const shortOf = (key) => (s.supportShort || []).find((x) => x.slotKey === key) || null;
    const steps = s.steps.map((st) => {
        const base = { key: st.key, kind: st.kind, label: st.label, answer: s.answerOf(st) || '', hint: engine.stepHintOf(st) };
        if (st.kind === 'AXIS' || st.kind === 'AXES') {
            const axes = st.kind === 'AXIS' ? [st.axis] : st.axes;
            return { ...base, axes: axes.map((a) => ({ key: a.key, label: engine.AXIS_LABEL[a.key] || a.key, values: a.values.map((v) => ({ value: v, label: engine.valueLabel(a.key, v), on: state.answers[a.key] === v })) })) };
        }
        if (st.kind === 'SIZE') return { ...base, sizeStepId: st.sizeStep.id, options: (st.sizeStep.styleOptions || []).map((o) => ({ optId: o.optId, label: txt(o.partName || o.label || o.optId), on: state.sizePick[st.sizeStep.id] === o.optId })) };
        if (st.kind === 'SLOT') {
            const picked = (st.slot.options || []).find((o) => o.id === s.livePicks[st.slot.key]) || null;
            const asksQty = !!picked && engine.takesQty(st.slot);
            return { ...base, ...slotView(st.slot), sub: st.sub ? { label: 'Matching backplate', ...slotView(st.sub) } : null,
                // A CHOSEN RETURN COLLAPSES THE REST (CPQ, Stuart 2026-08-20): the plate picker it brings sits under the other ends.
                collapse: !!(picked && picked.role === 'RETURN' && st.sub),
                qty: asksQty ? { typed: state.stepQty[st.slot.key] || '', recommended: s.recommendFor(st.slot, picked) || null,
                    // a typed centre count on a spliced pole, rounded up so one sits at the splice (hardwareSession.centreCountForSplices)
                    ...(Number(state.stepQty[st.slot.key]) > 0 && Number(s.quantities[picked.id]) !== Number(state.stepQty[st.slot.key]) ? { rounded: Number(s.quantities[picked.id]) } : {}),
                    ...(s.splice && s.splice.count > 0 && st.slot.kind === 'BRACKET' && String(st.slot.position || '').toUpperCase() === 'CENTER' ? { splices: s.splice.count } : {}) } : null,
                // fewer centre brackets than recommended — said, never refused
                short: shortOf(st.slot.key) ? { chosen: shortOf(st.slot.key).chosen, recommended: shortOf(st.slot.key).recommended } : null };
        }
        if (st.kind === 'LENGTH') return { ...base, lengthInches: s.lengthInches || null, exactFeet: s.lengthFeetExact || null, feetBilled: s.lengthFeet || null,
            fabricId: s.span.fabricId, dropFt: s.span.dropFt, onStud: s.span.onStud,
            fabrics: engine.FABRIC_CLASSES.map((f) => ({ id: f.id, label: txt(f.label) })),
            // (how many pieces and splices the pole is made in — the splice count its brackets and joiners follow, 2026-10-20)
            splice: s.spliceNeeded ? { overInches: s.spliceOverIn, included: !!s.spliceSatisfied, splices: (s.splice && s.splice.count) || 0, pieces: ((s.splice && s.splice.count) || 0) + 1 } : null,
            // the span in the column that applies (into studs or not), why, and the other column's count beside it
            support: s.advice ? { everyInches: s.advice.everyInches, supports: s.advice.supports, why: txt(s.advice.whyApplies), onStud: !!s.advice.onStud, other: s.advice.otherSupports || null,
                // a rod on this configuration with no span listed: said, so the count is never taken as covering it
                ...((s.advice.unlisted || []).length ? { unlisted: true } : {}) } : null,
            rods,
            // a kit-chart traverse (H1-2TRV, 2026-10-20): the brackets its kit includes at this length, from 4.6 — in place of the span line
            ...(s.kitChartBrackets ? { kitChart: { feet: s.kitChartBrackets.feet, count: s.kitChartBrackets.count, where: s.kitChartBrackets.where } } : {}) };
        if (st.kind === 'CARRIERS') return { ...base, rows: st.carriers.map((c) => ({ code: s.ourId(c.partId), name: txt((part(c.partId) || {}).itemName || c.name) })) };
        // TRV: the track's components, asked as CPQ asks them (2026-10-20) — the draw, the motor side, the carriers, the rest
        if (st.kind === 'TRV') return { ...base, trv: trvViewOf(engine, data, s, showMoney) };
        return base;
    });
    // ── THE FINISHES: what this configuration can wear among what the portal offers, grouped as the engine groups them ──
    const offered = portalFinishesOf(engine, data);
    const allowed = new Set(offered.map(codeOfFinish));
    const swatch = (f) => ({ code: codeOfFinish(f), name: txt(f.name && f.name !== f.code ? f.name : ''), theirs: txt(s.clientFinishName(f) || ''), swatch: String(f.textureUrl || f.finalImageUrl || '') });
    // WHAT A SWATCH CLICK APPLIES TO, by CPQ's own rule (Shared/finishScope — Stuart 2026-10-02: "when i change left to EP1
    // then right changes … this needs to work for all steps"): on a part's step, that part (once the configuration has a
    // finish for it), the collar a two-part finial brings, or the whole configuration. The screen says which step it is on
    // and what it last chose there; this works out what a click sets, and which swatch each group shows as chosen.
    const sc = engine.scope;
    const stepNow = s.steps.find((st) => st.key === (ui && ui.step)) || null;
    const stepOption = (stepNow && stepNow.kind === 'SLOT' && s.livePicks[stepNow.slot.key]) ? ((stepNow.slot.options || []).find((x) => x.id === s.livePicks[stepNow.slot.key]) || null) : null;
    const stepCollar = (stepOption && stepOption.requiresCollar) ? (engine.companionsFor(s.model.choices, [stepOption.id])[0] || null) : null;
    const targets = sc.scopeTargetsOf({ option: stepOption, collar: stepCollar, wears: (c) => offered.some((f) => s.wearsFinish(c, f)) });
    const now = sc.scopeInForce({ targets, picked: (ui && ui.scope) ? { step: ui.step || '', scope: ui.scope } : null, stepKey: (stepNow && stepNow.key) || '', configFinishOf: s.globalFinishFor });
    const target = targets.find((t) => t.scope === now) || targets[targets.length - 1];
    const wearsMaterial = (c, mat) => s.wearsFinish(c, { material: mat });
    const groups = (s.finishGroups || []).map(([material, g]) => {
        const lists = [['in', g.inHouse], ['out', g.out]].map(([kind, list]) => ({ label: groupWord(engine, material, kind), swatches: list.filter((f) => allowed.has(codeOfFinish(f))).map(swatch) }))
            .filter((l) => l.swatches.length);
        const act = sc.swatchActionOf({ target, material, code: '', wearsMaterial });
        return { material, heading: titled(material), lists,
            sel: sc.highlightOf({ target, material, partFinish: s.partFinish, configFinishOf: s.globalFinishFor, globalFinishes: s.globalFinishes, wearsMaterial }),
            applies: act.kind === 'PART' ? { part: act.id } : { whole: true } };
    }).filter((g) => g.lists.length);
    const scope = {
        step: (stepNow && stepNow.key) || '', now,
        targets: targets.map((t) => ({ scope: t.scope, code: t.choice ? txt(s.ourId(t.choice.partId)) : '', sku: t.choice ? txt(their(t.choice.partId)) : '' })),
        // the part this step's click would set, when it is wearing a finish of its own — "back to the configuration finish"
        exception: (target.choice && s.partFinish[target.choice.id]) ? { id: target.choice.id, code: txt(s.ourId(target.choice.partId)), finish: txt(s.partFinish[target.choice.id]) } : null,
        exceptions: Object.keys(s.partFinish || {}).length,
    };
    const asking = (s.askingFinishes || []).map((a) => ({ code: a.code, name: txt(a.finish && a.finish.name), questions: (a.questions || []).map((q) => ({ label: q.label, choices: q.choices })), answers: (state.finishAnswers || {})[a.code] || {} }));
    // ── THE PRICE: the customer's lines at the level this portal shows; a line no rule priced firmly reads "priced on review" ──
    const onReview = (l) => l.source === engine.PRICE_SOURCES.NONE || l.source === engine.PRICE_SOURCES.FALLBACK;
    // A finish is NAMED — their word for it first, else ours (as CPQ's pricing panel names it); a part made in a stock colour
    // says the colour's name, not its code (TCP, TBR), and a clear part says it takes none.
    const finishName = (f) => txt(s.clientFinishName(f) || (f.name && f.name !== f.code ? f.name : '') || f.code);
    const finishOf = (l) => {
        const f = l.finishCode ? s.finishByCode.get(U(l.finishCode)) : null;
        if (f) return { finish: finishName(f) };
        if (l.subFinishCode) { const sub = s.finishByCode.get(U(l.subFinishCode)); return { finish: sub ? finishName(sub) : txt(l.subFinishCode), stock: true }; }
        return { finish: '', ...(l.noFinish ? { clear: true } : {}) };
    };
    // A KIT LINE CARRYING A MOTOR CODE (2026-10-20): the engine prices it at the motor's NET (hardwareSession.kitBillOf →
    // kitSeed.applyKitPricing, "match tab 7") — a figure from the 4.6 kit sheet at every level, never a Retail price, and its
    // number is the per-motor code of the kit sheet. The portal shows its own level, so that line reads "priced on review", out of
    // the firm total; and its number is shown only to a customer whose own pricing row the kit carries. HQ's request keeps the line.
    const keys = engine.customerKeys(data.customerId, data.customer);
    const kitOfCode = (code) => (data.kits || []).find((k) => U(k.legacyErpId || k.itemName) === U(code)) || null;
    const motorSku = (l) => { const k = kitOfCode(l.partId); return k && engine.findClientPriceRow(k.clientPricing, keys) ? txt(l.sku || l.aliasCode || '') : ''; };
    const reviewOf = (l) => onReview(l) || !!l.motorCode;
    const line = (l, extra = {}) => ({ code: txt(l.billedId || s.ourId(l.partId)), sku: l.motorCode ? motorSku(l) : txt(l.sku || l.aliasCode || ''), name: txt((part((l.twinOf && l.soldPartId) || l.partId) || {}).itemName || l.name), qty: l.qty,
        ...(l.perFoot ? { feet: l.billedFeet !== undefined ? l.billedFeet : l.feet } : {}), ...finishOf(l), ...extra,
        ...(showMoney && !reviewOf(l) ? { unit: money(l.unit), total: money(l.total) } : { onReview: true }) });
    const takenExtras = s.extraLines.filter((l) => Number((s.extras.find((x) => x.code === l.partId && (x.slot || '') === (l.slot || '')) || {}).qty) > 0);
    const lines = [...engine.customerLines(s.priced.lines).map((l) => line(l)), ...takenExtras.map((l) => line(l, { added: true })), ...(s.trvLines || []).map((l) => line(l))];
    // The total is the ENGINE's (parts that are billed but not shown are in it, as on CPQ's own panel), less the money of
    // any line that is only a placeholder — that part is "priced on review", never passed off as firm.
    const everyLine = [...s.priced.lines, ...takenExtras, ...(s.trvLines || [])];
    // "Priced on review" is said of what the customer can SEE, or of a hidden part that carries money — a hidden part with no
    // price of its own (the standoffs a return brings: $0, as on CPQ's own panel) is part of the set, not a price to come.
    const hasReview = everyLine.some((l) => reviewOf(l) && (!l.hidden || Number(l.total) !== 0));
    const firmTotal = money(s.grandTotal - everyLine.filter(reviewOf).reduce((n, l) => n + (Number(l.total) || 0), 0));
    // ── THE DRAWING: what HQ's own drawing code (Shared/DynamicModel) is handed, and how each finish on screen catches the
    // light — the same numbers HQ's registry holds, worked out from the same two finish lists (Shared/finishPbr.pbrMapOf) ──
    let render = null;
    if (s.renderState) {
        const textures = s.renderState.textureEntries || [];
        const outsourced = data.outsourceCodes || [];
        const master = (data.finishes || []).filter((f) => !outsourced.includes(f));
        const all = engine.pbrMapOf(master, outsourced);
        const pbr = {};
        textures.forEach((e) => { if (e && e.url && all[e.url]) pbr[e.url] = all[e.url]; });
        render = { visible: s.renderState.visibilityEntries.filter((e) => e.visible).map((e) => e.target), clear: s.renderState.clearNodes, textures,
            cloneSpecs: s.renderState.cloneSpecs, stretchSpec: s.renderState.stretchSpec, spliceMarks: s.renderState.spliceMarks,
            pbr, scale: engine.renderScaleOf(data.flow, state.sizePick || {}, data.assembly) };
    }
    return {
        engine: engine.stamp,
        flow: { id: String((data.flow && data.flow.id) || ''), name: txt(data.flow && data.flow.name) },
        assembly: { name: txt(data.assembly && data.assembly.itemName), cadUrl: String((data.assembly && data.assembly.manufacturingSpecs && data.assembly.manufacturingSpecs.cadUrl) || '') },
        steps,
        finishes: { groups, chosen: { ...s.globalFinishes }, byPart: { ...s.partFinish }, asking, scope },
        render,
        price: { level: showMoney ? s.effectiveLevel : '', lines, ...(showMoney ? { total: firmTotal, totalForAll: money(firmTotal * s.qty) } : {}), hasReview: hasReview || !showMoney, qty: s.qty },
        // what a later choice took off: our number and our description, and why in the customer's words — Understood clears it
        removals: s.drops.map((d) => ({ key: d.key, step: txt(d.step), code: d.partCode ? txt(s.ourId(d.partCode)) : '', part: txt((part(d.partCode) || {}).itemName || d.partName), why: removalWords(d.reason), acked: !!d.acked })),
        // fewer centre brackets than recommended — the same words the request carries to HQ
        supportShort: shortNotesOf(engine, s, state),
        // …and the same counts as numbers, for the risk window (Shared/spanRisk draws it; the key is what a Confirm answers)
        risk: (s.supportShort || []).map((x) => ({ chosen: x.chosen, recommended: x.recommended, onStud: !!(s.span && s.span.onStud), lengthInches: s.lengthInches,
            everyInches: s.advice ? s.advice.everyInches : null, key: engine.spanRiskKeyOf({ chosen: x.chosen, recommended: x.recommended, onStud: !!(s.span && s.span.onStud), lengthInches: s.lengthInches }) })),
        refusal: s.refusal ? { kind: s.refusal.kind, message: REFUSAL_WORDS[s.refusal.kind] || 'This configuration cannot be requested yet.' } : null,
        // "Start from a kit" (2026-10-20): the kits, the one in hand, its motor code, how it follows the mount — what picking one fills
        // in (once, when it is picked) — and the kit's brackets that have just become answerable
        kit: kitViewOf(engine, data, s),
        kitStart: kitStartViewOf(engine, data, s, ui),
        kitFills: (ui && ui.kitArmed && s.kitSource && s.kitSource.record)
            ? engine.kitFillsOf({ model: s.model, kit: s.kitSource.record, answers: s.effAnswers, livePicks: s.livePicks, ourId: s.ourId, recommendFor: s.recommendFor, done: new Set(ui.kitDone || []) })
            : {},
        // what the track still needs (said, never refused — CPQ's rule; Stuart 2026-10-20 "a. yes")
        trvStill: trvMissingOf(engine, data, s),
    };
}

// ── WHAT THIS CONFIGURATION OFFERS, AND ONLY THAT ─────────────────────────────────────────────
// A kit the flow does not offer, a motor code the kit does not carry, a carrier, component, draw or side the chart does not offer
// for this drive and length — dropped, so a cart line never carries what was not on the screen. The engine is asked again only
// when something was dropped.
function offeredStateOf(engine, data, s, state) {
    let kitPick = state.kitPick || '';
    let kitMotor = state.kitMotor || '';
    let trvSel = state.trvSel || null;
    const kit = kitPick ? (data.kits || []).find((k) => engine.kitIdOf(k) === kitPick) : null;
    if (!kit) { kitPick = ''; kitMotor = ''; }
    else kitMotor = (((kit.manufacturingSpecs || {}).kitMotorCodes || []).find((x) => U(x.code) === U(kitMotor)) || {}).code || '';
    if (trvSel) {
        if (!s.isTraverse || !data.trvRules) trvSel = null;
        else trvSel = trvSelForOffer(engine, engine.configuratorOffer({ rules: data.trvRules, drive: s.trvDrive, feet: s.trvFeet, realFeet: s.lengthFeet || undefined }), trvSel);
    }
    return { ...state, kitPick, kitMotor, trvSel };
}
// The track's answers against what the chart offers here (the Configure walk and the Quick Ship kit alike): a carrier, component, accessory,
// draw or side nobody offers is dropped; the rest stands.
function trvSelForOffer(engine, offer, sel) {
    if (!sel) return null;
    const styles = new Set(offer.carrierStyles.map((x) => x.itemId));
    const only = (o, list) => { const ids = new Set(list.map((x) => x.itemId)); return Object.fromEntries(Object.entries(o || {}).filter(([k]) => ids.has(k))); };
    const style = styles.has(sel.carrierStyle) ? sel.carrierStyle : '';
    return { carrierStyle: style, carrierQty: style ? sel.carrierQty : '',
        draw: engine.DRAWS.some((d) => d.value === sel.draw) ? sel.draw : '',
        motorSide: engine.MOTOR_SIDES.some((m) => m.value === sel.motorSide) ? sel.motorSide : '',
        picks: only(sel.picks, offer.picks), accessories: only(sel.accessories, offer.accessories) };
}
function sessionFor(engine, data, raw, level) {
    const state = raw || {};
    let s = engine.sessionOf({ ...data, priceLevel: level }, state);
    const clean = offeredStateOf(engine, data, s, state);
    if (JSON.stringify([clean.kitPick, clean.kitMotor, clean.trvSel]) !== JSON.stringify([state.kitPick || '', state.kitMotor || '', state.trvSel || null])) s = engine.sessionOf({ ...data, priceLevel: level }, clean);
    return { s, state: clean };
}

// ── THE KIT STRIP — CPQ's "Start from a kit" (HardwareConfigurator), in the customer's words ──
// The kit's own number, and THEIRS beside it where their pricing row names one; never a motor's net price (the portal shows its
// own level). How the kit follows the mount is CPQ's sentence.
const mountWord = (m) => (m === 'CEILING' ? 'Ceiling' : 'Wall');
function mountFollowWords(f) {
    if (!f) return '';
    if (f.mode === 'switched') return `Mount is ${mountWord(f.mount)} — billing the ${mountWord(f.mount).toLowerCase()} kit ${f.to}${f.theirs ? ` (${f.theirs})` : ''}, not ${f.from}.`;
    if (f.mode === 'followed') return `Mount is ${mountWord(f.mount)} — this kit is the same on either mount: its ${mountWord(f.mount).toLowerCase()} brackets are in the kit, at the kit price.`;
    return `No kit is made for this set-up on a ${mountWord(f.mount).toLowerCase()} mount — ${f.from} bills as picked and the brackets bill on their own.`;
}
function kitViewOf(engine, data, s) {
    const kits = data.kits || [];
    if (!kits.length) return null;
    const keys = engine.customerKeys(data.customerId, data.customer);
    const theirs = (k) => String(((engine.findClientPriceRow(k.clientPricing, keys)) || {}).clientSku || '').trim();
    const src = s.kitSource;
    const motors = src && s.trvDrive === 'MOTORIZED' ? ((((src.record || {}).manufacturingSpecs) || {}).kitMotorCodes || []) : [];
    return {
        offered: kits.map((k) => { const code = txt(k.legacyErpId || k.itemName); const t = txt(theirs(k)); return { id: engine.kitIdOf(k), code, sku: t && t !== code ? t : '', name: k.itemName && k.legacyErpId ? txt(k.itemName) : '' }; }),
        chosen: src ? engine.kitIdOf(src.record) : '',
        baseFeet: src ? src.baseFeet : null,
        extraFeet: src ? Math.max(0, Math.round((s.lengthFeet || src.baseFeet) - src.baseFeet)) : null,
        motor: motors.length ? { chosen: s.kitMotor || '', codes: motors.map((x) => ({ code: txt(x.code), motor: txt(x.motorItem) })) } : null,
        mountFollow: s.kitBill && s.kitBill.mountFollow ? { words: mountFollowWords(s.kitBill.mountFollow), noKit: s.kitBill.mountFollow.mode === 'nokit' } : null,
    };
}
// What picking a kit fills in — worked out ONCE, when the browser says it was just picked (CPQ's applyKit; Shared/kitStart.kitStartOf).
// The browser applies it: the answers and picks, and the kit's base length only where nothing is typed yet.
function kitStartViewOf(engine, data, s, ui) {
    if (!ui || !ui.kitStart) return null;
    const kit = (data.kits || []).find((k) => engine.kitIdOf(k) === ui.kitStart);
    if (!kit) return null;
    const st = engine.kitStartOf({ model: s.model, kit, lengthTyped: false });
    const said = (b) => (b ? { what: txt(b.what), why: txt(b.why, 400) } : null);
    return { id: engine.kitIdOf(kit), blocked: said(st.blocked), answers: st.answers, picks: st.picks, lengthInches: st.lengthInches || null,
        report: { name: txt(st.report.name), blocked: said(st.report.blocked), carried: (st.report.carried || []).map((c) => txt(c, 400)), missed: (st.report.missed || []).map(said) } };
}

// ── THE TRAVERSE COMPONENTS STEP — CPQ's panel (Shared/TraverseConfiguratorModal), laid out for the portal to draw ──
// Every choice the chart offers for this drive and length, with what the length includes; the customer's own number for each part
// (their pricing row), never another customer's; a price only at the level this portal shows. `sel` is what stands (the chart's
// defaults until the customer answers).
function trvViewOf(engine, data, s, showMoney) {
    if (!data.trvRules || !s.isTraverse) return null;
    const offer = engine.configuratorOffer({ rules: data.trvRules, drive: s.trvDrive, feet: s.trvFeet, realFeet: s.lengthFeet || undefined });
    const sel = s.trvLive || { picks: {}, accessories: {} };
    const info = (code) => s.trvItemInfo(code) || { name: code, sku: '' };
    const unit = (code) => { if (!showMoney) return null; const p = Number(s.trvPriceOf(code)) || 0; return p > 0 ? money(p) : null; };
    const row = (code) => ({ id: code, name: txt(info(code).name), sku: txt(info(code).sku), unit: unit(code) });
    return {
        drive: s.trvDrive, feet: s.trvFeet, tracks: s.trvTracks,
        draws: engine.DRAWS.map((d) => ({ value: d.value, label: d.label, hint: d.hint })),
        motorSides: s.trvDrive === 'MOTORIZED' ? engine.MOTOR_SIDES.map((m) => ({ value: m.value, label: m.label })) : [],
        carrierStyles: offer.carrierStyles.map((c) => ({ ...row(c.itemId), label: txt(c.label), included: c.includedQty, defaultQty: c.defaultQty })),
        picks: offer.picks.map((p) => ({ ...row(p.itemId), included: p.includedQty, endStop: /ENDSTOP/i.test(p.itemId) })),
        accessories: offer.accessories.map((a) => row(a.itemId)),
        sel: { carrierStyle: sel.carrierStyle || '', carrierQty: sel.carrierQty || '', draw: sel.draw || '', motorSide: sel.motorSide || '', picks: { ...(sel.picks || {}) }, accessories: { ...(sel.accessories || {}) } },
        answered: !!s.trvSel,
        missing: trvMissingOf(engine, data, s),
    };
}
// What a track still needs before it can be built (CPQ's "Still needed" line): the draw always, the motor side on a motor, a carrier style.
function trvMissingOf(engine, data, s) {
    if (!data.trvRules || !s.isTraverse) return [];
    return [...engine.traverseAnswersMissing({ drive: s.trvDrive, sel: s.trvLive }), ...(s.trvLive && s.trvLive.carrierStyle ? [] : ['carrier style'])];
}

// FEWER CENTRE BRACKETS THAN RECOMMENDED, in words the customer and HQ both read (Shared/portalRequestLines prints them under
// the configuration). The engine decides it (hardwareSession.supportShortfallOf); this only says it.
function shortNotesOf(engine, s, state = {}) {
    const onStud = !!(s.span && s.span.onStud);
    const confirmed = (x) => !!state.riskConfirmed && state.riskConfirmed === engine.spanRiskKeyOf({ chosen: x.chosen, recommended: x.recommended, onStud, lengthInches: s.lengthInches });
    return (s.supportShort || []).map((x) => `Fewer centre brackets than recommended: ${x.picked ? x.chosen : 'none'} chosen, ${x.recommended} recommended for this ${s.lengthInches}″ pole ${onStud ? 'in a stud' : 'on drywall with toggles'}.${confirmed(x) ? ' The customer confirmed the risk.' : ''}`);
}

// ── THE REQUEST'S CART LINE ──────────────────────────────────────────────────────────────────
// The same answers, worked out again at the customer's OWN level: the cart line CPQ writes for them
// (engine 'TAGS', engineConfig, the frozen render, the engine and pin stamps) — or why it cannot be sent.
function requestLineOf(engine, data, raw, { level = 'STANDARD' } = {}) {
    const { s, state } = sessionFor(engine, data, raw, level);
    if (s.refusal) return { refusal: { kind: s.refusal.kind, message: REFUSAL_WORDS[s.refusal.kind] || 'This configuration cannot be requested yet.' }, item: null };
    // the notes: fewer centre brackets than recommended, and what the track still needs (said, never refused)
    const still = trvMissingOf(engine, data, s);
    return { refusal: null, item: s.item, effectiveLevel: s.effectiveLevel, total: money(s.grandTotal * s.qty),
        notes: [...shortNotesOf(engine, s, state), ...(still.length ? [`Traverse — still needed: ${still.join(' · ')}.`] : [])] };
}

// ── THE CUSTOMER'S PICTURE OF A LINE (step 5 of the portal rebuild, Stuart 2026-10-20) ───────────────────
// The portal takes the 3D view as it was left at Add (Shared/viewCapture — CPQ's own picture at Add) and sends it with the line;
// the cart line keeps it as `renderSnapshot`, the field CPQ's lines carry theirs in and the quote documents print. A picture is
// only ever kept as what it claims to be: a JPEG data URL, this size or smaller, whose bytes start and end as a JPEG's do.
// Anything else is left off — never a refusal: the request is the answers; the picture is a courtesy.
const PICTURE_MAX = 400000;   // characters of data URL (~290 KB of JPEG); a 900-px picture of the view runs far under it
function pictureOf(raw) {
    if (typeof raw !== 'string' || raw.length > PICTURE_MAX) return null;
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(raw);
    if (!m) return null;
    const b = Buffer.from(m[1], 'base64');
    return (b.length > 4 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF && b[b.length - 2] === 0xFF && b[b.length - 1] === 0xD9) ? raw : null;
}
// …and the request is ONE Firestore document (1 MiB at most) holding every line. Pictures are kept in line order while the
// document stays under `limit` bytes; one that would cross it is left off (a later, smaller one may still fit).
const REQUEST_DOC_LIMIT = 900000;
function picturesThatFit(pictures, baseBytes, limit = REQUEST_DOC_LIMIT) {
    let used = Number(baseBytes) || 0;
    return (Array.isArray(pictures) ? pictures : []).map((p) => {
        if (!p) return null;
        const n = Buffer.byteLength(p) + 32;
        if (used + n > limit) return null;
        used += n;
        return p;
    });
}

// ── IN LINE, OR BEHIND ───────────────────────────────────────────────────────────────────────
// Functions are deployed by hand, the portal site on every push: after an engine change this server runs
// the OLD engine until it is deployed. Two halves that disagree must not quote — said, never guessed.
const inLine = (serverStamp, siteStamp) => !!serverStamp && !!siteStamp && !!serverStamp.closureHash && serverStamp.closureHash === siteStamp.closureHash && serverStamp.engineVersion === siteStamp.engineVersion;

module.exports = { loadEngine, worldFor, trvFamilyOf, levelsFor, portalFinishesOf, stateFromClient, uiFromClient, flowIdsFor, viewOf, requestLineOf, pictureOf, picturesThatFit, PICTURE_MAX, REQUEST_DOC_LIMIT, trvSelShapeOf, trvSelForOffer, inLine, Refused, REFUSAL_WORDS, SHOWABLE };
