// ORDER ENTRY → PRODUCTION: the one generator, for every screen that starts it.
//
// Stuart 2026-09-20: "if the order lines entered are stocked items then the demand is handled always
// by the stocked sales snapshot. but if it is an order for to be finished items, then they behave just
// like cpq and go straight to the floor from rtg. i do not like how we handled the first one, i am
// afraid these to-be-finished orders will get lost."
//
// They could get lost because production for a tab-7 sales order only ever started on Stock View →
// 🧾 Order Entry Needs, when somebody remembered to go there. Everything AFTER that press already ran
// through RTG (the work orders park there with their gates and RTG releases them). So the rule change
// is where it STARTS: RTG starts it, by itself, the moment NetSuite accepts the sales order — and asks
// a person only where the plan needs one.
//
// This module is the generator both doors call. It was StockViewTab's `executeOeReview` and its
// helpers, moved here WHOLE so there is one writer and not a copy (the working agreement, rule 4: no
// screen reads its own copy of the truth). Screen concerns — the modal, the logs panel, the PO
// preview — stay with the screen; everything that writes is here.
import { db } from '../../firebase';
import { doc, updateDoc, getDocs, query, collection, where, runTransaction } from 'firebase/firestore';
import { BRAND_NETSUITE_MAP } from './brandNetsuite';
import { customerCodesOf } from './aliasSearch';
import { realPartOf, isAliasDoc } from './aliasIdentity';
import { isPoleCategory, cutPlanFromSource } from './poleCut';
import { isOutsourcedFinishCode, handlingForErp } from './finishRouting';
import { orderRouteFor, ORDER_ROUTE, sourcingOf, SOURCING } from './sourcing';
import { ParkRefusal, stampReceiptPo } from './workOrderCreate';
import { isReleasable } from './orderStatus';
import { releaseFinWoToFloor } from './finishedRunPrecheck';
import { buildOeReviewPlan, actionsOfReviewedJob } from './oeReviewPlan';
import { createDraftPurchaseOrders } from './purchaseOrders';
import { issuePlatedDemand } from './platingDemand';
import { isAssemblyPart } from './finishedGoodsRun';
import { oeIsTbf, oeLineFinish, soNeedBy, oeJobBlocked, oeCoverageOf, uncoveredTbfOf, autoRunnable, oeAutoSig } from './oeLines';
import { floorGroupsOf, parkRowPair } from './rowPair.js';

export { oeIsTbf, oeLineFinish, soNeedBy, oeJobBlocked, oeCoverageOf, uncoveredTbfOf, autoRunnable, oeAutoSig };

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const LIVE_DOC = (d) => !d.deleted && !['Closed', 'Deleted', 'CANCELLED'].includes(String(d.status || ''));

// Resolve an ordered code to the part production plans against — direct record first, then a customer
// code carried ON a real record (clientPricing / fabricut aliases), then an Alias doc dereferenced to
// its real item. The alias stays for display; stock, BOM and the WO identity are always the REAL item.
export const resolveOePart = (erp, inventory = []) => {
    const code = U(erp);
    // The same key Stock View always used: a record answers to its ERP code, or its item id where it has
    // none — and the LAST record under a code wins, exactly as its lookup table filled.
    let direct = null;
    inventory.forEach(p => { if (U(p.legacyErpId || p.itemId) === code) direct = p; });
    let part = direct || inventory.find(it => customerCodesOf(it).some(c => U(c) === code)) || null;
    let aliasNote = (part && !direct) ? `${code} = customer code on ${part.legacyErpId || part.itemId}` : '';
    if (part && isAliasDoc(part)) {
        const real = realPartOf(part, (t) => inventory.find(p => [p.id, p.itemId, p.legacyErpId].map(U).includes(U(t))));
        if (real && real !== part) { aliasNote = `${code} is an ALIAS of ${real.legacyErpId || real.itemId}`; part = real; }
    }
    return { part, aliasNote };
};

// The library a brand plans against, in the order Stock View has always held it (its own brand + what is
// shared with it, sorted by code) — so "the last record under a code wins" answers the same on RTG.
export const oeInventoryOf = (allParts = [], brand) => allParts
    .filter(p => p.brandId === brand || (p.sharedBrands && p.sharedBrands.includes(brand)))
    .sort((a, b) => U(a.legacyErpId || a.itemName).localeCompare(U(b.legacyErpId || b.itemName)));

// Everything live that is linked to these sales orders: work orders, purchase orders, plating demands.
export const loadOeLinks = async (soIds = [], { all = false } = {}) => {
    const out = {};
    const ids = [...new Set(soIds.filter(Boolean))];
    ids.forEach(id => { out[id] = { wos: [], pos: [], demands: [] }; });
    for (let i = 0; i < ids.length; i += 10) {
        const chunk = ids.slice(i, i + 10);
        const [ws, ps, ds] = await Promise.all([
            getDocs(query(collection(db, 'hq_work_orders'), where('soAppId', 'in', chunk))),
            getDocs(query(collection(db, 'hq_purchase_orders'), where('soAppId', 'in', chunk))),
            getDocs(query(collection(db, 'plating_demand'), where('soAppId', 'in', chunk))),
        ]);
        // A closed or deleted order does not COVER a line — "does live work exist for this?"
        // `all` = the automatic start's reading: everything ever raised, closed and deleted included
        // (Shared/oeLines.oeCoverageOf says why).
        ws.docs.forEach(d => { const w = { id: d.id, ...d.data() }; if ((all || LIVE_DOC(w)) && out[w.soAppId]) out[w.soAppId].wos.push(w); });
        ps.docs.forEach(d => { const p = { id: d.id, ...d.data() }; if ((all || LIVE_DOC(p)) && out[p.soAppId]) out[p.soAppId].pos.push(p); });
        ds.docs.forEach(d => { const x = { id: d.id, ...d.data() }; if (out[x.soAppId]) out[x.soAppId].demands.push(x); });
    }
    return out;
};

// WHICH DOOR A LINE TAKES, before any plan is built. The same one rule as every other view.
//   PLATING — an outsourced finish: a plating demand, never a work order.
//   ASK     — the item is flagged BOTH (make and buy): a person answers, always (Brief E, S4).
//   BUY     — we buy the raw: through the review gate as a buy.
//   MAKE    — in-house manufacture: through the review gate.
export const oeDoorOf = (part, finish) => {
    if (isOutsourcedFinishCode(finish || '')) return 'PLATING';
    const specs = (part && part.manufacturingSpecs) || {};
    if (sourcingOf(specs) === SOURCING.BOTH) return 'ASK';
    const vendorName = String(specs.vendorName || '').trim();
    if ((specs.isInHouse === false && !!vendorName) || orderRouteFor(specs).route === ORDER_ROUTE.BUY) return 'BUY';
    return 'MAKE';
};

// items: [{ so, l, buy }] → the review jobs buildOeReviewPlan takes (pins loaded for assemblies).
export const buildOeJobs = async ({ items = [], inventory = [], log = () => {} }) => {
    const jobs = [];
    for (let i = 0; i < items.length; i++) {
        const { so, l, buy } = items[i];
        const erp = U(l.erp);
        const { part, aliasNote } = resolveOePart(erp, inventory);
        const finish = oeLineFinish(l);
        if (!part || !finish) continue;
        let pins = [];
        if (!buy && isAssemblyPart(part)) {
            try {
                const pinsSnap = await getDocs(query(collection(db, 'assembly_pins'), where('assemblyId', '==', part.itemId)));
                pins = pinsSnap.docs.map(d => d.data());
                if (!pins.length) log(`⚠ ${erp} is an assembly with NO BOM pins — the plan cannot see its components.`, 'warn');
            } catch (e) { console.warn('pins load failed', e); }
        }
        jobs.push({
            key: i, so, line: l, lineIdx: (so.lines || []).indexOf(l), part, finish, qty: Number(l.qty) || 0, pins, aliasNote, lineErp: erp, buy: !!buy,
            // A per-foot line NEEDS feet from the vendor (the SO stored pieces + billedFeet).
            ...(l.perFoot ? { buyQty: Number(l.billedFeet) || (Number(l.qty) || 0) * (Number(l.feetPer) || 1) } : {}),
        });
    }
    return jobs;
};

// EACH SALES-ORDER LINE RECORDS WHAT WAS RAISED FOR IT. Until 2026-09-20 the link was GUESSED back from
// the work orders (same item + same finish), so two identical lines read as one and a partly covered
// quantity read as covered — survivable while a person pressed Generate, not once it runs by itself.
const stampLineGenerated = async (so, lineIdx, entry) => {
    if (!so || !so.id || !(lineIdx >= 0)) return;
    try { await updateDoc(doc(db, 'hq_sales_orders', so.id), { [`oeGen.${lineIdx}`]: entry }); }
    catch (e) { console.warn('oeGen stamp failed', so.id, lineIdx, e); }
};

// OUTSOURCED FINISH → the plater, linked to the SO (the plated triple, issued once — Brief A, A3).
export const issueOePlatedLine = async ({ so, line, lineIdx, brand, user, inventory = [], auto = false, log = () => {} }) => {
    const erp = U(line.erp);
    const finish = oeLineFinish(line);
    const needBy = soNeedBy(so);
    const prodNote = so.productionNotes || '';
    const res = await issuePlatedDemand({
        target: `${erp}/${finish}`, base: erp, qty: Number(line.qty) || 0, brand, from: 'oe-needs',
        createdBy: user || '', inventory, coreAvailable: null, finishName: finish, reqDate: needBy,
        // THE CUT (S5, 2026-09-17) rides the note — the demand's field list is frozen (Brief D).
        note: `Order Entry ${so.soId || so.id} · ${so.customer || ''}${Number(line.cutLength) > 0 ? ` · cut ${Number(line.cutLength)}" (${Number(line.feetPer) || ''} ft pieces)` : ''}${needBy ? ` · need by ${needBy}` : ''}${prodNote ? ` · 📝 ${prodNote}` : ''}`,
        // The demand's field list is frozen (Brief D) — which LINE it is for is recorded on the sales order (oeGen).
        extra: { soAppId: so.id, customerId: so.customerId || null, customerName: so.customer || '' },
    });
    await stampLineGenerated(so, lineIdx, { kind: 'PLATING', ids: [res.demandId], ref: res.woNum || '', at: Date.now(), by: user || '', auto: !!auto });
    res.made.forEach((m, i) => log(`${i === 0 ? '' : '   '}${m}${i === 0 ? ` (linked to ${so.soId || so.id})` : ''}`, i === 0 ? 'success' : 'info'));
    return res;
};

// EXECUTE reviewed jobs — the ONLY writer on this path. Per job: make-up (converts + sourcing-correct
// shop WOs), the WO doc with its gates, the NetSuite work order (FLOW2) with awaitingNsWo so the floor
// waits for the number; PO drafts group per vendor+SO. `jobs` are the RUNNABLE ones (not blocked).
// Returns { draftPos, woIds }. Throws only on a failure that stops the run partway.
export const executeOeJobs = async ({ jobs = [], brand, user = '', inventory = [], log = () => {}, auto = false }) => {
    const locationId = (BRAND_NETSUITE_MAP[brand] || {}).location || '17';
    const poBuckets = {}; // `${vendor}|${soId}` → { vendorName, so, lines: [] }
    // Work orders parked AWAITING RECEIPT in this run: { woId, soAppId, itemId }. The review raises
    // the work orders first and buckets the POs afterwards, so the gate goes on immediately (that is
    // what holds the release) and the PO number is written on below.
    const gatedWos = [];
    const bookedJobs = new Set();
    const woIds = [];
    const idsByLine = {};
    // START-NOW SPLIT (Stuart 2026-08-31): a bought TO-BE-FINISHED line with stock on hand may begin
    // finishing immediately for the reviewed portion — that portion gets its own WO (-NOW) and picks
    // from the shelf; the remainder's WO (-PO) waits for the material. PO lines are collected once.
    const expanded = [];
    for (const job of jobs) {
        const nowQty = job.buy && job.finish ? Math.max(0, Math.min(Number(job.startNow) || 0, job.startNowMax || 0, job.qty)) : 0;
        if (nowQty > 0 && nowQty < job.qty) {
            const per = job.startNowPer || 1;
            const mkPlan = (pcs) => ({ ...job.plan, lines: (job.plan?.lines || []).map(pl => ({ ...pl, quantity: pcs * per })) });
            expanded.push({ ...job, qty: nowQty, buyQty: nowQty * per, plan: mkPlan(nowQty), __tag: '-NOW' });
            expanded.push({ ...job, qty: job.qty - nowQty, buyQty: (job.qty - nowQty) * per, plan: mkPlan(job.qty - nowQty), __tag: '-PO', __skipPo: true });
        } else expanded.push(job);
    }
    // ── GROUP BY ROW AND FINISH, ONE PAIR PER GROUP (Stuart 2026-09-23, Shared/rowPair) ─────────
    // "each row is like a small typical order": the to-be-finished lines of an order are grouped by
    // row and finish and each group is written as the pair the CPQ split writes — one finishing
    // document with every small part, one shop sibling with the custom pole(s), linked. A pair opens
    // NO NetSuite work order: the sales order is the NetSuite record, exactly as a CPQ pair.
    let linesStarted = 0;
    const bookPurchase = (job) => { if (!bookedJobs.has(job.key)) { bookedJobs.add(job.key); (job.__poLines || []).forEach(pl => {
        const k = `${pl.vendorName}|${job.so.id}`;
        (poBuckets[k] = poBuckets[k] || { vendorName: pl.vendorName, so: job.so, lines: [] }).lines.push(pl);
    }); } };
    const nsIdOf = (code) => { const hit = inventory.find(p => U(p.legacyErpId || p.itemId) === U(code)); return hit && hit.netSuiteInternalId ? String(hit.netSuiteInternalId) : null; };
    const prepared = [];
    for (const job of expanded) {
        const { so, part, finish, qty } = job;
        const erp = U(part.legacyErpId || part.itemId);
        // A BOUGHT LINE IS PLANNED AS ITS RAW ITEM — AND FINISHED AS THE FINISHED ONE (Stuart 2026-09-20).
        const finishedErp = (job.buy && finish && U(job.finishedErp) === erp) ? `${erp}/${U(finish)}` : job.finishedErp;
        const specs = part.manufacturingSpecs || {};
        const { makeup, poLines } = actionsOfReviewedJob(job);
        const prepared1 = { ...job, erp, finishedErp, __makeup: makeup, __poLines: poLines };
        if (job.buy) {
            if (!poLines.length && !job.__skipPo) log(`✔ ${erp} ×${qty} (SO ${so.soId || so.id}) — material covered by stock/on-order as reviewed; nothing ordered.`, 'success');
            // A raw-only buy (no finish) makes no work order — its purchase books straight away.
            if (!finish) { bookPurchase(prepared1); continue; }
            log(job.__tag === '-NOW'
                ? `🎨 ${erp} ×${qty}: START NOW from stock — finishing releases and picks from the shelf.`
                : `🎨 ${erp} ×${qty}: TO BE FINISHED — the pair is created now; its pick waits until the material arrives.`, 'info');
        }
        const planLines = (job.plan?.lines || []).map(pl => (U(pl.legacyErpId) === finishedErp || (job.buy && U(pl.legacyErpId) === erp))
            ? { ...pl, legacyErpId: erp, partId: erp, partName: `${part.itemName || erp} — raw pull (no /P record)` } : pl);
        // ONE POLE TEST (sweep 2026-09-01) — the CUSTOM PAIR rule: a mill code plus an applied finish
        // is made to order and is the shop's; a complete assembly (/BS, /N90) is finishing's.
        const isPole = isPoleCategory(U(specs.productType));
        const custom = isPole && handlingForErp(finishedErp) === 'Custom';
        // ── THE POLE CHOICE THE OPERATOR MADE (Q5) — a finishing-side pole cut or waited for ──
        let poleCut = null, backOrder = '';
        if (job.poleChoice) {
            const pc = job.poleChoice;
            const opt = pc.chosen && pc.chosen !== 'BACKORDER' ? (pc.options || []).find(o => o.sourceErp === pc.chosen) : null;
            if (opt) {
                poleCut = cutPlanFromSource({ targetErp: pc.pullErp, targetFt: pc.pullFt, sourceFt: opt.sourceFt, per: opt.per, scrapFt: opt.scrapFt, want: pc.short });
                if (!poleCut) log(`⚠ ${pc.pullErp}: could not build the cut from ${opt.sourceErp} — the order is created, raise the cut from WMS → Rod Cuts.`, 'warn');
            } else {
                backOrder = `${pc.short} × ${pc.pullErp} short (${pc.have} on hand of ${pc.need}) — waiting for the ${pc.pullFt} ft length`;
            }
        }
        const rcptRefs = job.__tag === '-NOW' ? []
            : (poLines || []).map(pl => ({ itemId: U(pl.code), qtyNeeded: Number(pl.editQty ?? pl.qty) || Number(pl.qty) || 0 })).filter(r => r.itemId && r.qtyNeeded > 0);
        prepared.push({ ...prepared1, custom, __planLines: planLines, __poleCut: poleCut, __backOrder: backOrder, __rcptRefs: rcptRefs });
    }
    // Per sales order, then by row and finish — the review modal may hand in several orders at once.
    const bySo = new Map();
    prepared.forEach(j => { const k = j.so.id; if (!bySo.has(k)) bySo.set(k, []); bySo.get(k).push(j); });
    for (const jobsOfSo of bySo.values()) {
        const so = jobsOfSo[0].so;
        for (const group of floorGroupsOf(jobsOfSo, so)) {
            const receiptRefs = group.jobs.flatMap(j => j.__rcptRefs || []);
            let res;
            try {
                res = await parkRowPair({
                    group, so, brand, user, inventory,
                    poleCutsOf: (j) => ({ poleCut: j.__poleCut, backOrder: j.__backOrder }),
                    receiptRefs, makeupActions: group.jobs.flatMap(j => j.__makeup || []), nsIdOf,
                });
            } catch (e) {
                if (e instanceof ParkRefusal) { log(`⛔ ${group.rowLabel || 'order'} · ${group.finish} (SO ${so.soId || so.id}): ${e.message}`, 'error'); continue; }
                throw e;
            }
            res.made.forEach((m, i) => log(`${i === 0 ? '' : '   '}${m}`, i === 0 ? 'success' : (/^[⚠✂⇄🏭🧩⏳📦]/.test(m) ? 'warn' : 'info')));
            // The pair exists: NOW its purchases are booked, and the receipt gate remembers the work order
            // so the PO number can be written onto it below.
            group.jobs.forEach(bookPurchase);
            receiptRefs.forEach(r => gatedWos.push({ woId: res.woId, soAppId: so.id, itemId: r.itemId }));
            woIds.push(res.woId);
            linesStarted += group.jobs.length;
            for (const job of group.jobs) {
                const lk = `${so.id}|${job.lineIdx}`;
                idsByLine[lk] = [...(idsByLine[lk] || []), res.woId, ...(res.shopWoId ? [res.shopWoId] : [])];
                await stampLineGenerated(so, job.lineIdx, { kind: 'WO', ids: idsByLine[lk], at: Date.now(), by: user || '', auto: !!auto, rowKey: group.rowKey || '', finish: group.finish });
            }
            const g = res.gate || {};
            const waitingText = [g.awaitingConvert ? 'its phosphate convert' : '', g.awaitingComponents ? 'its component work orders' : '', g.awaitingRodCut ? 'its rod cut' : '', g.awaitingReceipt ? 'its purchased material' : ''].filter(Boolean).join(' + ');
            if (isReleasable(g)) {
                await releaseFinWoToFloor({ id: res.woId, finPayload: res.finPayload }, user || 'oe-review');
                log(`✅ ${group.rowLabel ? `${group.rowLabel} · ` : ''}${group.finish} (SO ${so.soId || so.id}) — ${auto ? 'clean plan' : 'approved in review'} → RELEASED to the finishing floor (${res.woId})${res.shopWoId ? `; the shop job ${res.shopWoId} releases from RTG` : ''}.`, 'success');
            } else {
                log(`✅ ${res.woId} (SO ${so.soId || so.id}) — waiting on ${waitingText || 'its gates'}; RTG releases it when they clear.`, 'success');
            }
        }
    }
    // PO drafts — one per vendor per SO, exactly as reviewed (qtys already MOQ-adjusted). ONE PO WRITER
    // (Brief A, A4): each line carries the sales order that wants it; previewed and approved like any other.
    const draftPos = [];
    for (const bucket of Object.values(poBuckets)) {
        const { vendorName, so, lines } = bucket;
        const res = await createDraftPurchaseOrders({
            lines: lines.map(l => ({
                part: l.part, qty: Number(l.editQty ?? l.qty) || l.qty, vendorName,
                reason: l.reason, from: 'OE_REVIEW',
                soAppId: so.id, soRef: so.soId || so.id,
            })),
            brand, createdBy: user || '', source: 'OE_REVIEW',
            reqDate: soNeedBy(so) || '',
            note: `Order Entry ${so.soId || so.id} · ${so.customer || ''} · component make-up (review-approved)`,
        });
        if (!res.pos.length) { log(`⛔ PO skipped — no NetSuite-synced vendor matches "${vendorName}". Sync vendors (11.1), then Generate again.`, 'error'); continue; }
        draftPos.push(...res.pos);
        // The gate now knows WHICH purchase order it is waiting on.
        for (const po of res.pos) {
            for (const it of (po.items || [])) {
                const code = U(it.itemId);
                for (const g of gatedWos.filter(x => x.itemId === code && x.soAppId === (it.soAppId || so.id))) {
                    try { await stampReceiptPo(g.woId, code, po.poId); } catch (e) { console.warn('receipt-gate PO stamp failed', g.woId, e); }
                }
            }
        }
        res.pos.forEach(po => log(`🧾 DRAFT ${po.poId} → ${po.vendor}: ${po.items.map(l => `${l.quantity} × ${l.itemId}`).join(', ')} (SO ${so.soId || so.id}) — review and approve to send it to NetSuite.`, 'info'));
    }
    return { draftPos, woIds, linesStarted };
};

// ── THE AUTOMATIC RUN (RTG, Stuart 2026-09-20: "automatic when netsuite accepts") ───────────────────
// ONE browser does it. Every open RTG tab sees the same sales order at the same moment, and two of
// them running the plan is two sets of work orders — so the run is CLAIMED on the sales order inside a
// transaction first. A claim older than ten minutes is a browser that died mid-run and may be retaken.
const CLAIM_MS = 10 * 60 * 1000;
// The run's record on the sales order. `oeAuto` for the whole-order automatic start; a display
// order's rows each record under their own slot (`displayRows.ROW_2`) so two rows never share a
// claim or overwrite each other's review — Shared/displayRelease.
const slotOf = (data, slot) => String(slot || 'oeAuto').split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), data) || {};
export const claimOeAuto = async (soId, user, sig, slot = 'oeAuto', { force = false } = {}) => runTransaction(db, async (tx) => {
    const ref = doc(db, 'hq_sales_orders', soId);
    const snap = await tx.get(ref);
    if (!snap.exists()) return false;
    const cur = slotOf(snap.data(), slot);
    const now = Date.now();
    if (cur.state === 'RUNNING' && now - (cur.at || 0) < CLAIM_MS) return false;
    // "ALREADY ANSWERED" IS A GUARD AGAINST THE AUTOMATIC RUN REPEATING ITSELF — not against a
    // person (Stuart 2026-09-22, 10.5's ▶ Start row). A person asks again on purpose: the rule
    // changed, the stock arrived, the item was fixed. `force` waives only this; two runs at once
    // are still refused above.
    if (!force && ['NEEDS_REVIEW', 'DONE'].includes(cur.state) && cur.sig === sig) return false;   // already answered for exactly these lines
    if (!force && cur.state === 'FAILED' && cur.sig === sig && now - (cur.at || 0) < CLAIM_MS) return false;
    tx.update(ref, { [slot]: { state: 'RUNNING', at: now, by: user || '', sig } });
    return true;
});

/**
 * Start production for one accepted Order Entry sales order. Clean lines run; the rest are named.
 *
 * `only(line, lineIdx)` scopes the run to SOME of the order's lines — a display order's ROW
 * (Stuart 2026-09-22, 10.5 as mission control). Everything else is identical: the same coverage
 * reading so a line is never raised twice, the same claim, the same doors, the same writer. `slot`
 * is where this run records itself on the sales order; a row uses its own.
 * @returns { ran, review: [{ lineIdx, erp, finish, reasons[] }], state }
 */
export const runOeAuto = async ({ so, brand, user = '', inventory = [], links = null, log = () => {}, only = null, slot = 'oeAuto', force = false }) => {
    // Read FRESH, and read everything ever raised — the run must never raise a line twice on its own.
    const linkSet = links || (await loadOeLinks([so.id], { all: true }))[so.id] || { wos: [], pos: [], demands: [] };
    const open = uncoveredTbfOf(so, linkSet, { any: true }).filter(x => (typeof only === 'function' ? only(x.line, x.lineIdx) : true));
    const sig = oeAutoSig(open);
    if (!open.length) return { ran: 0, review: [], state: 'DONE' };
    if (!(await claimOeAuto(so.id, user, sig, slot, { force }))) return { ran: 0, review: [], state: 'SKIPPED' };
    const review = [];
    let ran = 0;
    const finish = async (state, extra = {}) => {
        try { await updateDoc(doc(db, 'hq_sales_orders', so.id), { [slot]: { state, at: Date.now(), by: user || '', sig, ran, review, ...extra } }); }
        catch (e) { console.warn('run state write failed', so.id, slot, e); }
    };
    try {
        const planItems = [];
        for (const { line, lineIdx } of open) {
            const erp = U(line.erp);
            const fin = oeLineFinish(line);
            const { part } = resolveOePart(erp, inventory);
            const named = (reasons) => review.push({ lineIdx, erp, finish: fin, reasons });
            if (!part) { named([`${erp} is not in the Master Library (real codes, customer codes and aliases searched)`]); continue; }
            if (!fin) { named(['no finish recorded on this line']); continue; }
            if (!(Number(line.qty) > 0)) { named(['the line has no quantity']); continue; }
            const door = oeDoorOf(part, fin);
            if (door === 'PLATING') {
                await issueOePlatedLine({ so, line, lineIdx, brand, user, inventory, auto: true, log });
                ran++;
            } else if (door === 'ASK') named([`${erp} is flagged BOTH (make and buy) — a person chooses`]);
            // A BOUGHT LINE IS PLANNED, NOT PRE-REFUSED (Stuart 2026-09-22, SO60565: "why is it asking
            // for the review and decision? the stock is clearly enough for the order"). The 09-20
            // rule sent every bought item to review before the plan had looked at the shelf, so a
            // line with 110 ft on hand against 50 needed — nothing to order, no PO drafted — still
            // waited on a person to decide a purchase that did not exist. The plan reads the stock;
            // autoRunnable then asks the honest question: is there a purchase to decide?
            else planItems.push({ so, l: line, buy: door === 'BUY' });
        }
        if (planItems.length) {
            const jobs = await buildOeJobs({ items: planItems, inventory, log });
            const plan = await buildOeReviewPlan({ jobs, inventory, locationId: (BRAND_NETSUITE_MAP[brand] || {}).location || '17' });
            if (plan.nsError) {
                log(`⛔ SO ${so.soId || so.id}: NetSuite unreachable for the stock read (${String(plan.nsError).slice(0, 120)}) — nothing was created; it will be tried again.`, 'error');
                await finish('FAILED', { error: String(plan.nsError).slice(0, 300) });
                return { ran, review, state: 'FAILED' };
            }
            const clean = [];
            plan.jobs.forEach(j => {
                const v = autoRunnable(j, { unitsKnown: plan.unitsKnown });
                if (v.ok) clean.push(j);
                else review.push({ lineIdx: j.lineIdx, erp: U(j.lineErp), finish: j.finish, reasons: v.reasons });
            });
            if (clean.length) {
                const res = await executeOeJobs({ jobs: clean, brand, user, inventory, log, auto: true });
                ran += res.linesStarted != null ? res.linesStarted : res.woIds.length;
            }
        }
        const state = review.length ? 'NEEDS_REVIEW' : 'DONE';
        // The answer is recorded against what REMAINS open (the lines named for review) — so the next
        // pass reads "already answered" instead of planning the same leftovers again.
        const leftSig = oeAutoSig(open.filter(x => review.some(r => r.lineIdx === x.lineIdx)));
        await finish(state, { sig: leftSig });
        return { ran, review, state };
    } catch (e) {
        await finish('FAILED', { error: String(e.message || e).slice(0, 300) });
        throw e;
    }
};
