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
    const [session, pricing, levels, twin, handoff, itemKit, model] = await Promise.all([
        import(at('hardwareSession.js')), import(at('hardwarePricing.js')), import(at('priceLevels.js')), import(at('materialTwin.js')),
        import(at('hardwareHandoff.js')), import(at('itemKit.js')), import(at('hardwareModel.js'))]);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'MANIFEST.json'), 'utf8'));
    const engine = {
        sessionOf: session.sessionOf, offeredFinishesOf: session.offeredFinishesOf, stepHintOf: session.stepHintOf, valueLabel: session.valueLabel, AXIS_LABEL: session.AXIS_LABEL,
        aliasFor: pricing.aliasFor, PRICE_SOURCES: pricing.PRICE_SOURCES, customerPriceLevel: levels.customerPriceLevel,
        wearsAsTwin: twin.wearsAsTwin, customerLines: handoff.customerLines, isItemKit: itemKit.isItemKit, takesQty: model.takesQty,
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
        kits: [],                                   // "Start from a kit" comes to the portal with the traverse step — not offered yet
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
// The flow's own list (as CPQ narrows it), less any finish that would turn a part this assembly pins into
// its other-material item — solid brass is one item per part in another material, and it is CPQ-only.
function portalFinishesOf(engine, data) {
    const offered = engine.offeredFinishesOf(data.finishes, data.flowFinishes);
    const index = new Map();
    (data.parts || []).forEach((p) => [p.id, p.itemId, p.legacyErpId].forEach((k) => { const kk = U(k); if (kk && kk !== 'PENDING' && !index.has(kk)) index.set(kk, p); }));
    const find = (id) => index.get(U(id)) || null;
    const pinned = [...new Set((data.pins || []).map((pn) => U(pn.partId)).filter(Boolean))].map(find).filter(Boolean);
    return offered.filter((f) => !pinned.some((p) => engine.wearsAsTwin(p, f, find)));
}
const codeOfFinish = (f) => U(f && (f.code || f.name));

// ── WHAT THE BROWSER MAY SAY ─────────────────────────────────────────────────────────────────
// The customer's answers, field by field. Anything else it sends is dropped; anything the portal does not
// offer is refused by name. NOT taken from a customer: items added by hand, a declined splice, a kit, the
// traverse components (the engine seeds them from the chart), shop notes, a price level.
const FABRICS = ['SHEER', 'PRINT', 'BLACKOUT'];
class Refused extends Error { constructor(code, message) { super(message); this.code = code; } }
function stateFromClient(raw, { finishCodes = new Set() } = {}) {
    const r = isObj(raw) ? raw : {};
    const flat = (o, max, val) => { const out = {}; if (isObj(o)) Object.entries(o).slice(0, max).forEach(([k, v]) => { const x = val(v); if (x !== undefined && String(k).length <= 160) out[String(k)] = x; }); return out; };
    const scalar = (v) => (typeof v === 'string' ? v.slice(0, 160) : (typeof v === 'number' && Number.isFinite(v) ? v : undefined));
    const str = (v) => (typeof v === 'string' && v ? v.slice(0, 200) : undefined);
    const fin = (v) => { const c = U(v); if (!c) return undefined; if (!finishCodes.has(c)) throw new Refused('FINISH_NOT_OFFERED', `The finish ${c} is not offered on the portal.`); return c; };
    const length = Number(r.lengthInches);
    const stepQty = flat(r.stepQty, 60, (v) => { const n = parseInt(v, 10); return n > 0 && n <= 9999 ? String(n) : undefined; });
    const finishAnswers = {};
    if (isObj(r.finishAnswers)) Object.entries(r.finishAnswers).slice(0, 12).forEach(([code, a]) => { const c = U(code); if (finishCodes.has(c) && isObj(a)) finishAnswers[c] = flat(a, 8, str); });
    const qty = parseInt(r.qty, 10);
    return {
        answers: flat(r.answers, 20, scalar), picks: flat(r.picks, 80, str), sizePick: flat(r.sizePick, 8, str),
        lengthInches: Number.isFinite(length) && length > 0 && length <= 600 ? length : null,
        stepQty, fabricId: FABRICS.includes(U(r.fabricId)) ? U(r.fabricId) : 'PRINT',
        globalFinishes: flat(r.globalFinishes, 6, fin), partFinish: flat(r.partFinish, 80, fin), finishAnswers,
        memo: txt(r.memo, 120), qty: qty > 0 && qty <= 999 ? qty : 1,
        // what was named as removed and acknowledged — the keys only; the entries themselves are worked out here
        drops: (Array.isArray(r.drops) ? r.drops : []).slice(0, 80).filter((d) => isObj(d) && typeof d.key === 'string' && d.acked === true).map((d) => ({ key: d.key.slice(0, 400), acked: true })),
        extras: [], spliceWaived: false, kitPick: '', kitCode: '', kitMotor: '', trvSel: null, stepNotes: {}, stepNoteClient: {},
    };
}

// ── THE VIEW ─────────────────────────────────────────────────────────────────────────────────
// Everything the portal draws for one set of answers, built field by field from the engine's answer.
const REFUSAL_WORDS = {
    NOTHING_PRICED: 'Choose a rod to begin.',
    REMOVALS: 'A later choice removed something you had picked — look at what was removed and confirm before sending.',
    BARE_WOOD: 'Choose a wood finish — the wood parts on this order have none yet.',
    FINISH_QUESTIONS: 'One of your finishes has a question still to answer.',
};
function viewOf(engine, data, state, { level = 'STANDARD', money: showMoney = true } = {}) {
    const s = engine.sessionOf({ ...data, priceLevel: level }, state);
    const part = (id) => s.findPart(id);
    const their = (id) => engine.aliasFor(part(id), s.priceCtx) || '';
    const option = (o, key) => ({ id: o.id, code: s.ourId(o.partId), sku: their(o.partId), name: txt((part(o.partId) || {}).itemName || o.name), noFinish: !!o.noFinish, on: s.livePicks[key] === o.id });
    const slotView = (slot) => (slot ? { key: slot.key, notAsked: slot.suppressedBy ? txt(slot.suppressedReason, 240) : '', options: (slot.options || []).map((o) => option(o, slot.key)) } : null);
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
                qty: asksQty ? { typed: state.stepQty[st.slot.key] || '', recommended: s.recommendFor(st.slot, picked) || null } : null };
        }
        if (st.kind === 'LENGTH') return { ...base, lengthInches: s.lengthInches || null, feetBilled: s.lengthFeet || null, fabricId: state.fabricId,
            splice: s.spliceNeeded ? { overInches: s.spliceOverIn, included: !!s.spliceSatisfied } : null,
            support: s.advice ? { everyInches: s.advice.spanInches, supports: s.advice.brackets } : null };
        if (st.kind === 'CARRIERS') return { ...base, rows: st.carriers.map((c) => ({ code: s.ourId(c.partId), name: txt((part(c.partId) || {}).itemName || c.name) })) };
        return base;                               // TRV: the track's components — shown as the engine seeds them (the customer's own picks come with the traverse step)
    });
    // the finishes: what this configuration can wear among what the portal offers, grouped as the engine groups them
    const allowed = new Set(portalFinishesOf(engine, data).map(codeOfFinish));
    const swatch = (f) => ({ code: codeOfFinish(f), name: txt(f.name && f.name !== f.code ? f.name : ''), theirs: txt(s.clientFinishName(f) || ''), swatch: String(f.textureUrl || f.finalImageUrl || '') });
    const groups = (s.finishGroups || []).map(([material, g]) => ({ material, inHouse: g.inHouse.filter((f) => allowed.has(codeOfFinish(f))).map(swatch), out: g.out.filter((f) => allowed.has(codeOfFinish(f))).map(swatch) }))
        .filter((g) => g.inHouse.length + g.out.length > 0);
    const asking = (s.askingFinishes || []).map((a) => ({ code: a.code, name: txt(a.finish && a.finish.name), questions: (a.questions || []).map((q) => ({ label: q.label, choices: q.choices })), answers: (state.finishAnswers || {})[a.code] || {} }));
    // the price: the customer's lines at the level this portal shows; a line no rule priced firmly reads "priced on review"
    const onReview = (l) => l.source === engine.PRICE_SOURCES.NONE || l.source === engine.PRICE_SOURCES.FALLBACK;
    const finishOf = (l) => { const f = l.finishCode ? s.finishByCode.get(U(l.finishCode)) : null; return f ? txt(s.clientFinishName(f) || (f.name && f.name !== f.code ? f.name : '') || f.code) : (l.subFinishCode ? txt(l.subFinishCode) : ''); };
    const line = (l, extra = {}) => ({ code: txt(l.billedId || s.ourId(l.partId)), sku: txt(l.sku || l.aliasCode || ''), name: txt((part((l.twinOf && l.soldPartId) || l.partId) || {}).itemName || l.name), qty: l.qty,
        ...(l.perFoot ? { feet: l.billedFeet !== undefined ? l.billedFeet : l.feet } : {}), finish: finishOf(l), ...extra,
        ...(showMoney && !onReview(l) ? { unit: money(l.unit), total: money(l.total) } : { onReview: true }) });
    const takenExtras = s.extraLines.filter((l) => Number((s.extras.find((x) => x.code === l.partId && (x.slot || '') === (l.slot || '')) || {}).qty) > 0);
    const lines = [...engine.customerLines(s.priced.lines).map((l) => line(l)), ...takenExtras.map((l) => line(l, { added: true })), ...(s.trvLines || []).map((l) => line(l))];
    // The total is the ENGINE's (parts that are billed but not shown are in it, as on CPQ's own panel), less the money of
    // any line that is only a placeholder — that part is "priced on review", never passed off as firm.
    const everyLine = [...s.priced.lines, ...takenExtras, ...(s.trvLines || [])];
    const hasReview = everyLine.some(onReview);
    const firmTotal = money(s.grandTotal - everyLine.filter(onReview).reduce((n, l) => n + (Number(l.total) || 0), 0));
    return {
        engine: engine.stamp,
        flow: { id: String((data.flow && data.flow.id) || ''), name: txt(data.flow && data.flow.name) },
        assembly: { name: txt(data.assembly && data.assembly.itemName), cadUrl: String((data.assembly && data.assembly.manufacturingSpecs && data.assembly.manufacturingSpecs.cadUrl) || '') },
        steps,
        finishes: { groups, chosen: { ...s.globalFinishes }, byPart: { ...s.partFinish }, asking },
        render: s.renderState ? { visible: s.renderState.visibilityEntries.filter((e) => e.visible).map((e) => e.target), clear: s.renderState.clearNodes, textures: s.renderState.textureEntries,
            cloneSpecs: s.renderState.cloneSpecs, stretchSpec: s.renderState.stretchSpec, spliceMarks: s.renderState.spliceMarks } : null,
        price: { level: showMoney ? s.effectiveLevel : '', lines, ...(showMoney ? { total: firmTotal, totalForAll: money(firmTotal * s.qty) } : {}), hasReview: hasReview || !showMoney, qty: s.qty },
        removals: s.drops.map((d) => ({ key: d.key, step: d.step, part: txt(d.partName), reason: txt(d.reason, 240), acked: !!d.acked })),
        refusal: s.refusal ? { kind: s.refusal.kind, message: REFUSAL_WORDS[s.refusal.kind] || 'This configuration cannot be requested yet.' } : null,
    };
}

// ── THE REQUEST'S CART LINE ──────────────────────────────────────────────────────────────────
// The same answers, worked out again at the customer's OWN level: the cart line CPQ writes for them
// (engine 'TAGS', engineConfig, the frozen render, the engine and pin stamps) — or why it cannot be sent.
function requestLineOf(engine, data, state, { level = 'STANDARD' } = {}) {
    const s = engine.sessionOf({ ...data, priceLevel: level }, state);
    if (s.refusal) return { refusal: { kind: s.refusal.kind, message: REFUSAL_WORDS[s.refusal.kind] || 'This configuration cannot be requested yet.' }, item: null };
    return { refusal: null, item: s.item, effectiveLevel: s.effectiveLevel, total: money(s.grandTotal * s.qty) };
}

// ── IN LINE, OR BEHIND ───────────────────────────────────────────────────────────────────────
// Functions are deployed by hand, the portal site on every push: after an engine change this server runs
// the OLD engine until it is deployed. Two halves that disagree must not quote — said, never guessed.
const inLine = (serverStamp, siteStamp) => !!serverStamp && !!siteStamp && !!serverStamp.closureHash && serverStamp.closureHash === siteStamp.closureHash && serverStamp.engineVersion === siteStamp.engineVersion;

module.exports = { loadEngine, worldFor, trvFamilyOf, levelsFor, portalFinishesOf, stateFromClient, viewOf, requestLineOf, inLine, Refused, REFUSAL_WORDS, SHOWABLE };
