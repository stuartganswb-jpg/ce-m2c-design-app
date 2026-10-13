// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE ENGINE'S INPUTS, AS ONE FILE (Stuart 2026-10-13: "hq button")
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// The customer portal is being rebuilt on the tag engine, and every rule moved out of the CPQ
// screen has to be proven to give the same answer on what production holds TODAY — the real
// library, the real pins, the real kits and finishes, the lines people actually quoted. Firestore
// answers only the signed-in app (App Check), so that data cannot be read from outside it. This is
// the way out: a super admin presses "⬇ Engine snapshot" in CPQ and the browser saves ONE file
// holding what CPQ hands the engine for each tagged flow of the brand.
//
// READS ONLY. Nothing here writes, and the button's handler writes nothing either: it reads the
// pins of each flow's assembly, the traverse charts and the brand's saved quotes, and saves a file
// to the operator's own machine.
//
// WHAT IS LEFT OUT, ON PURPOSE:
//   · our own purchase cost and vendor on every item — the engine never reads them (it prices from
//     the Customer Alias & Pricing box, the tiers and the item's base price);
//   · a customer is its id, its names and its price levels — no contact, address, terms or notes;
//   · a quoted line is the engine's own record of it (answers, picks, the bill). What was typed on
//     it — the memo, a note on a step, a note on an added item — is replaced by a marker that
//     something was there, and its picture is not carried;
//   · a record's revision history, approvals and drawing layers; and the geometry tags of an
//     assembly no exported flow reads.
//
// Pure: no React, no Firebase. Harness: scripts/engineSnapshot.test.mjs.

import { ENGINE_VERSION } from './engineVersion.js';

export const SNAPSHOT_KIND = 'engine-snapshot';
export const SNAPSHOT_VERSION = 1;
export const SNAPSHOT_QUOTES = 80;      // the newest quotes that carry an engine line
export const SNAPSHOT_QUOTE_DAYS = 60;  // …looked for among the quotes saved in this many days

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();

// A copy JSON can hold. A Firestore timestamp (or a Date) becomes its milliseconds; a function, an
// undefined and anything that is not plain data (a document reference, a blob) is dropped; a number
// JSON cannot write (NaN, Infinity) becomes null. Inside a list a dropped entry is null, so the list
// keeps its length.
export function plain(v, depth = 0) {
    if (v === undefined || typeof v === 'function' || typeof v === 'symbol') return undefined;
    if (v === null) return null;
    if (typeof v !== 'object') return (typeof v === 'number' && !Number.isFinite(v)) ? null : v;
    if (depth > 40) return undefined;
    if (typeof v.toMillis === 'function') { try { return v.toMillis(); } catch { return null; } }
    if (v instanceof Date) return v.getTime();
    if (Array.isArray(v)) return v.map(x => { const y = plain(x, depth + 1); return y === undefined ? null : y; });
    const proto = Object.getPrototypeOf(v);
    if (proto !== null && proto !== Object.prototype) return undefined;
    const out = {};
    Object.keys(v).forEach(k => { const y = plain(v[k], depth + 1); if (y !== undefined) out[k] = y; });
    return out;
}

// OUR cost and OUR vendor, by the names the library gives them. A customer's own tiers live a level
// down, in manufacturingSpecs.fabricut (cost / paintedCost / platedCost there are what the customer
// pays US) and are never touched.
const OWN_COST = /^(cost|averagecost|lastcost|landedcost|standardcost|purchaseprice|lastpurchaseprice)$|vendor/i;
const RECORD_DROP = ['revisions', 'approvals', 'builtFromLayers', 'comments', 'history'];

/**
 * A library record as the engine is handed it, less what the engine never reads.
 * `geometry: true` keeps the node tags (nodeClusters) — for the assembly a flow is linked to.
 */
export function recordForSnapshot(rec, { geometry = false } = {}) {
    if (!rec || typeof rec !== 'object') return null;
    const out = {};
    Object.keys(rec).forEach(k => {
        if (RECORD_DROP.includes(k) || OWN_COST.test(k)) return;
        if (k === 'nodeClusters' && !geometry) return;
        if (k === 'manufacturingSpecs' && rec[k] && typeof rec[k] === 'object' && !Array.isArray(rec[k])) {
            const ms = {};
            Object.keys(rec[k]).forEach(m => { if (!OWN_COST.test(m)) ms[m] = rec[k][m]; });
            out[k] = ms;
            return;
        }
        out[k] = rec[k];
    });
    return plain(out);
}

/** A customer, as far as the engine needs one: who (id and names, which is how a price row finds them) and at which level. */
export function customerForSnapshot(c) {
    if (!c || !c.id) return null;
    return plain({
        id: c.id, name: c.name || '', companyName: c.companyName || '', brandId: c.brandId || '',
        ...(c.defaultPriceLevel ? { defaultPriceLevel: c.defaultPriceLevel } : {}),
        ...(c.portalPriceLevel ? { portalPriceLevel: c.portalPriceLevel } : {}),
        ...(Array.isArray(c.portalFlowIds) ? { portalFlowIds: c.portalFlowIds } : {}),
        ...(Array.isArray(c.portalCollections) ? { portalCollections: c.portalCollections } : {}),
    });
}

/** The flows the tag engine can run — CPQ's own test: a linked assembly, and not a 2D tear sheet or the pillow questions. */
export const taggedFlowsOf = (flows = []) => (flows || []).filter(f => f && f.linkedAssemblyId
    && !(f.sheet2d && f.sheet2d.url) && !/PILLOW/i.test(f.name || ''));

/** The traverse chart CPQ reads for a flow: its kit-family tag, H1-2TRV where it names none. */
export const trvFamilyOf = (flow) => U(flow && flow.kitFamily) || 'H1-2TRV';
export const trvFamiliesOf = (flows = []) => [...new Set(taggedFlowsOf(flows).map(trvFamilyOf))].sort();

const marked = (v, word) => (String(v == null ? '' : v).trim() ? word : '');

/**
 * One quoted line as the ENGINE recorded it — or null for a line the tag engine did not build.
 * `where` says where it was found ({ source, jobId, line, customerId, status, savedAt }).
 */
export function engineLineOf(item, where = {}) {
    if (!item || item.engine !== 'TAGS' || !item.engineConfig || typeof item.engineConfig !== 'object') return null;
    const cfg = item.engineConfig;
    const stepNotes = {};
    Object.keys(cfg.stepNotes || {}).forEach(k => { if (marked(cfg.stepNotes[k], 'x')) stepNotes[k] = '(note)'; });
    return plain({
        ...where,
        assemblyId: item.assemblyId || '', assemblyName: item.assemblyName || '', flowId: item.flowId || '',
        qty: item.qty, priceLevel: item.priceLevel || '',
        engineVersion: item.engineVersion || '', pinsFingerprint: item.pinsFingerprint || '',
        engineConfig: {
            ...cfg, memo: marked(cfg.memo, '(memo)'), stepNotes,
            ...(cfg.sidemark !== undefined ? { sidemark: marked(cfg.sidemark, '(memo)') } : {}),
            ...(Array.isArray(cfg.extras) ? { extras: cfg.extras.map(x => (x && typeof x === 'object' ? { ...x, note: marked(x.note, '(note)') } : x)) } : {}),
        },
        pricing: item.pricing || null,
        pricingBreakdown: (Array.isArray(item.pricingBreakdown) ? item.pricingBreakdown : [])
            .map(l => (l && typeof l === 'object' && l.customNote !== undefined ? { ...l, customNote: marked(l.customNote, '(note)') } : l)),
        trvComponents: Array.isArray(item.trvComponents) ? item.trvComponents : [],
        finishLabel: item.finishLabel || '',
        shopNotes: Array.isArray(item.generalNotes) ? item.generalNotes.length : 0,
        hadPicture: !!item.renderSnapshot,
    });
}

const savedAtOf = (job) => {
    const c = job && job.createdAt;
    const ms = (c && typeof c.toMillis === 'function') ? c.toMillis() : (c && Number(c.seconds) > 0 ? Number(c.seconds) * 1000 : 0);
    return ms || Date.parse(String((job && job.dateSaved) || '')) || 0;
};

/** The engine lines of the newest `limit` quotes that carry one, newest first. */
export function quotedLinesOf(jobs = [], { limit = SNAPSHOT_QUOTES } = {}) {
    const out = [];
    let taken = 0;
    (jobs || []).filter(Boolean).map(j => [j, savedAtOf(j)]).sort((a, b) => b[1] - a[1]).forEach(([j, at]) => {
        if (taken >= limit) return;
        const items = (j.cpqData && Array.isArray(j.cpqData.cartItems)) ? j.cpqData.cartItems : [];
        // WHO THE QUOTE WAS FOR: CPQ saves it as `customer: { id, name }` — only the id is carried (the engine prices a line
        // for its job's customer, not the flow's; the first snapshots read a field a quote does not have and left this blank).
        const customerId = String((j.customer && j.customer.id) || j.customerId || '');
        const lines = items.map((it, i) => engineLineOf(it, { source: 'quote', jobId: j.id || '', line: i, customerId, status: j.status || '', savedAt: at || null })).filter(Boolean);
        if (!lines.length) return;
        taken++;
        out.push(...lines);
    });
    return out;
}

/** The day the button reads saved quotes back to, as a quote stamps its own day: 'YYYY-MM-DD'. */
export const quotesSinceDay = (now = Date.now(), days = SNAPSHOT_QUOTE_DAYS) => new Date(Number(now) - days * 864e5).toISOString().split('T')[0];

/** The engine lines waiting in the cart. */
export const cartLinesOf = (cart = []) => (Array.isArray(cart) ? cart : [])
    .map((it, i) => engineLineOf(it, { source: 'cart', line: i })).filter(Boolean);

/**
 * The file. Everything is handed in — what CPQ already holds (the brand's library records, kits,
 * flows, finishes, customers, the 6.5 span map, the cart) and what the button read for it (the pins
 * of each flow's assembly, the traverse charts, the brand's saved quotes).
 *
 * @returns { kind, version, at, brand, engineVersion, counts, flows[], parts[], kits[], finishes[],
 *            outsourceFinishes[], customers[], spanMap, spanCaps, trvRules{family}, lines[] }
 *          flows[] = { flow, trvFamily, assembly (with its node tags), pins[] }
 */
export function buildEngineSnapshot({ brand = '', at = '', flows = [], assemblies = [], parts = [], kits = [], finishes = [], outsourceFinishes = [],
    customers = [], spanMap = {}, spanCaps = {}, pinsByAssembly = {}, trvRulesByFamily = {}, jobs = [], cart = [], quoteLimit = SNAPSHOT_QUOTES } = {}) {
    const tagged = taggedFlowsOf(flows);
    const asmById = new Map((assemblies || []).filter(a => a && a.id).map(a => [String(a.id), a]));
    const outFlows = tagged.map(f => {
        const asm = asmById.get(String(f.linkedAssemblyId)) || null;
        const pins = Array.isArray(pinsByAssembly[f.linkedAssemblyId]) ? pinsByAssembly[f.linkedAssemblyId] : [];
        return { flow: plain(f), trvFamily: trvFamilyOf(f), assembly: asm ? recordForSnapshot(asm, { geometry: true }) : null, pins: plain(pins) };
    });
    const lines = [...quotedLinesOf(jobs, { limit: quoteLimit }), ...cartLinesOf(cart)];
    // the customers a flow is set up for, a quoted line belongs to, or the portal is opened to — nobody else
    const wanted = new Set([...tagged.map(f => f.customerId), ...lines.map(l => l.customerId)].filter(Boolean).map(String));
    const outCustomers = (customers || []).filter(c => c && c.id && (wanted.has(String(c.id))
        || (Array.isArray(c.portalFlowIds) && c.portalFlowIds.length) || (Array.isArray(c.portalCollections) && c.portalCollections.length) || c.portalPriceLevel))
        .map(customerForSnapshot).filter(Boolean);
    const trvRules = {};
    trvFamiliesOf(flows).forEach(fam => { if (trvRulesByFamily && trvRulesByFamily[fam]) trvRules[fam] = plain(trvRulesByFamily[fam]); });
    const outParts = [...(parts || []), ...(assemblies || [])].map(r => recordForSnapshot(r)).filter(Boolean);
    const outKits = (kits || []).map(r => recordForSnapshot(r)).filter(Boolean);
    return {
        kind: SNAPSHOT_KIND, version: SNAPSHOT_VERSION, at: String(at || ''), brand: String(brand || ''), engineVersion: ENGINE_VERSION,
        counts: {
            flows: outFlows.length, flowsWithoutAssembly: outFlows.filter(f => !f.assembly).length, flowsWithoutPins: outFlows.filter(f => !f.pins.length).length,
            pins: outFlows.reduce((n, f) => n + f.pins.length, 0), parts: outParts.length, kits: outKits.length,
            finishes: (finishes || []).length, outsourceFinishes: (outsourceFinishes || []).length, customers: outCustomers.length,
            trvRules: Object.keys(trvRules).length, quotedLines: lines.filter(l => l.source === 'quote').length, cartLines: lines.filter(l => l.source === 'cart').length,
        },
        flows: outFlows, parts: outParts, kits: outKits,
        finishes: plain(finishes || []), outsourceFinishes: plain(outsourceFinishes || []),
        customers: outCustomers, spanMap: plain(spanMap || {}), spanCaps: plain(spanCaps || {}), trvRules, lines,
    };
}

/** engine-snapshot-ce-2026-10-13-0915.json */
export function snapshotFileName(brand, at) {
    const d = at instanceof Date ? at : new Date(at || Date.now());
    const p = (n) => String(n).padStart(2, '0');
    const stamp = Number.isNaN(d.getTime()) ? 'undated' : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
    return `engine-snapshot-${String(brand || 'brand').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${stamp}.json`;
}

/** What the file holds, in one sentence — said to the operator once it is saved. */
export function snapshotSummary(snapshot) {
    const c = (snapshot && snapshot.counts) || {};
    const missing = [c.flowsWithoutAssembly ? `${c.flowsWithoutAssembly} with no assembly on file` : '', c.flowsWithoutPins ? `${c.flowsWithoutPins} with no pins` : ''].filter(Boolean).join(', ');
    return `${c.flows || 0} flow${c.flows === 1 ? '' : 's'}${missing ? ` (${missing})` : ''} · ${c.pins || 0} pins · ${c.parts || 0} library records · ${c.kits || 0} kits · ${c.finishes || 0} finishes · ${c.customers || 0} customers · ${c.quotedLines || 0} quoted lines · ${c.cartLines || 0} in the cart`;
}
