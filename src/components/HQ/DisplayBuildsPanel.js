// ─────────────────────────────────────────────────────────────────────────────────────────────
// SALES DISPLAY BUILD ORDERS (Stuart 2026-09-11, piece 2)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// "then on the 10.5 the bom gets populated as orders that we need to manage … these types of order
//  always cause a problem on our stock management as they consume much more than typical day to
//  day orders … typically we build these and ship them over time rather than all at once."
//
// A build order = a display × a quantity for a customer (their PO, our SO), a ship plan, and the
// tracker's per-line columns (work order #, at plater, notes, done). Its lines are a snapshot of
// the display's bill at the time the order opens (re-taken on purpose, never silently).
//
// WRITES: system/displays/builds/{id} and system/display_demand_<brand> — the open demand per
// item (boards still to build × per board) that the Sales Snapshot's "Display" column will read
// (S2's file, hand-off). READS: displays, the finish lists, CRM customers.
// NEVER writes `jobs`: the CRM, RTG and tab 12 list every brand job, and a build order would
// surface there as a phantom quote. 10.5 mounts THIS panel instead (one guarded mount).
// THE CPQ ENTRY SHEET (Stuart 2026-09-17): each build is entered in CPQ (or tab 7) as ONE sales
// order. The sheet lists one line per part per row, as corrected, for the whole order.
//
// MISSION CONTROL (Stuart 2026-09-22): "from this screen is where we release these large projects
// … rtg still manages … but 10.5 is really mission control for these types of orders." Once a build
// is ANCHORED to its sales-order document, its rows are started from here — each through Order
// Entry's one generator scoped to that row's lines (Shared/displayRelease + Shared/oeGenerate) —
// and read back from the floor: work orders, plating demands and the plater's shipments. RTG's
// whole-order split and automatic start stand down for an anchored order (`displayRelease`); every
// work order still lands on RTG under the order and is governed there. The old typed WO# and
// plater fields are gone: they were written by nothing on the floor and read by nothing on it.

import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../../firebase';
import { collection, doc, onSnapshot, setDoc, deleteDoc, updateDoc, query, where, getDoc, getDocs, deleteField } from 'firebase/firestore';
import { DISPLAY_STYLES, buildLinesFrom, resnapshotLines, displayDemandFrom, shipPlanFill, openBoards, cpqEntryRows, cpqEntryCsv, SAMPLE_BIN_BY_STYLE, floorLinksByLine } from '../Shared/displayBom';
import { linkedDocsOf, identityKeysOf, closeOrderEverywhere } from '../Shared/orderLifecycle';
import { cancelPlatingDemand } from '../Shared/platingDemand';
import { hardDeleteWithLedger, closeDocsExactly, isClosedState } from '../Shared/orderLifecycle';
import { finishSuffixOf } from '../Shared/finishRouting.js';
// ── MISSION CONTROL (Stuart 2026-09-22): rows are started FROM HERE, through Order Entry's one
// generator scoped to a row, and read back from the floor. Shared/displayRelease says how.
import { quoteDoorOf, quoteCopyOf, confirmCartReplace, openQuoteCopyInCpq } from '../Shared/reopenQuote';
import { duplicateText, ORDER_ROW_LABEL, stalePackCardsOf, packCardCloseStamp, lineCodeFixesOf, lineCodeFixText, rereadLinesPatchOf, rereadLinesText, lineQtyEditOf, kitFinishEditOf, kitQtyEditOf, rodLineEditOf, rowUndoBlockersOf, rowReleaseText, rowReleaseCountOf, countSwitchText, rowRestartPlanOf, rowRestartText, soIsClosed, reopenForRowsCheck, reopenForRowsText, reopenForRowsSoPatch, splitRetiredStamp, rowKeyOf, rowOfLine, rowLinesFromBreakdown, soRowsOf, rowStateOf, displayAnchorPatch, soNeedsLines, rowStartText, ROW_STATE, wholeOrderDocsOf, wholeOrderText, retireBlockersOf, retireText, splitRetiredOf, packagingIdsOf, needsPackCard, packCardToRemove } from '../Shared/displayRelease';
import { runOeAuto, oeInventoryOf, loadOeLinks } from '../Shared/oeGenerate';
import { isReleaseByCount, anchorCountPatchOf, releaseRowKeyOf, rowTargetOf, rowReleaseOf, nextRowReleaseOf, releaseRunOf, releaseLabelOf, releasesOf, stampWithoutRunOf, rowReleasePlanOf, countSwitchOf, isWholeStamp, ORDER_ROW_KEY } from '../Shared/rowRelease';
import { soLineCodeOf, soCodeReleasedOf } from '../Shared/pickLines';
import { finishedCodeOf } from '../Shared/subFinish';

const mono = { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-soft)' };
const btn = (on, extra = {}) => ({ padding: '8px 14px', border: `1px solid ${on ? 'var(--ink)' : 'var(--line)'}`, background: on ? 'var(--ink)' : '#fff', color: on ? '#fff' : 'var(--ink)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', ...extra });
const inp = { padding: '7px 9px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.88rem', outline: 'none', background: '#fff' };
const td = { padding: '5px 7px', borderBottom: '1px solid var(--line)', fontSize: '0.82rem', verticalAlign: 'top' };
const th = { ...mono, padding: '6px 7px', textAlign: 'left', borderBottom: '1px solid var(--line)' };
const STATUS = ['PLANNED', 'IN_PRODUCTION', 'COMPLETE', 'CANCELLED'];
const N = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

const DisplayBuildsPanel = ({ currentUser, activeBrand, embedded = false }) => {
    const [builds, setBuilds] = useState([]);
    const [displays, setDisplays] = useState([]);
    const [finishes, setFinishes] = useState({ inHouse: [], outsourced: [] });
    const [customers, setCustomers] = useState([]);
    const [flows, setFlows] = useState([]);         // the display's flow decides its chip set
    const [draft, setDraft] = useState(null);
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState('');
    const [newForm, setNewForm] = useState(null);
    const [fill, setFill] = useState({ perShip: 10, start: '', everyDays: 7 });

    useEffect(() => {
        const u1 = onSnapshot(collection(db, 'system', 'displays', 'builds'), s => setBuilds(s.docs.map(d => ({ id: d.id, ...d.data() })).filter(b => !activeBrand || !b.brandId || b.brandId === activeBrand).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))), () => {});
        const u2 = onSnapshot(collection(db, 'system', 'displays', 'entries'), s => setDisplays(s.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => !activeBrand || !d.brandId || d.brandId === activeBrand)), () => {});
        const u3 = onSnapshot(doc(db, 'system', 'master_finishes'), s => setFinishes(f => ({ ...f, inHouse: (s.exists() && Array.isArray(s.data().finishes)) ? s.data().finishes : [] })), () => {});
        const u4 = onSnapshot(collection(db, 'hq_outsource_finishes'), s => setFinishes(f => ({ ...f, outsourced: s.docs.map(d => ({ id: d.id, ...d.data(), outsourced: true })) })), () => {});
        const u5 = onSnapshot(query(collection(db, 'crm_records'), where('type', '==', 'CUSTOMER')), s => setCustomers(s.docs.map(d => ({ id: d.id, name: d.data().companyName || d.data().name || d.id })).sort((a, b) => a.name.localeCompare(b.name))), () => {});
        const u6 = onSnapshot(collection(db, 'cpq_flows'), s => setFlows(s.docs.map(d => ({ id: d.id, ...d.data() }))), () => {});
        return () => { u1(); u2(); u3(); u4(); u5(); u6(); };
    }, [activeBrand]);
    const finishList = useMemo(() => [...finishes.inHouse, ...finishes.outsourced], [finishes]);

    // ── the demand record: recomputed from EVERY open order of the brand on every write ──────
    // AN ORDER RELEASED BY COUNT PUBLISHES ITS OWN LINES (Stuart 2026-10-06, Shared/displayBom.orderDemandLines): each open
    // build's anchored sales orders are read as they stand and handed to the one demand function, which uses them in
    // place of the build's bill when every one is released by count.
    const writeDemand = async (all) => {
        const brand = activeBrand || 'ALL';
        const mine = all.filter(b => !b.brandId || b.brandId === brand);
        const ordersByBuild = {};
        for (const b of mine) {
            if (!b || b.status === 'COMPLETE' || b.status === 'CANCELLED' || !openBoards(b)) continue;
            const sos = [];
            for (const id of anchoredIdsOf(b)) {
                const snap = await getDoc(doc(db, 'hq_sales_orders', id));
                if (snap.exists() && !(snap.data() || {}).deleted) sos.push({ id: snap.id, ...snap.data() });
            }
            if (sos.length) ordersByBuild[b.id] = sos;
        }
        const dem = displayDemandFrom(mine, { ordersByBuild });
        await setDoc(doc(db, 'system', `display_demand_${brand}`), { ...dem, brandId: brand, updatedAt: Date.now(), updatedBy: String(currentUser || '') });
        return dem;
    };
    // After a write that changes an order's lines or what is released of them, and on ⟳ Publish demand. A failure here
    // never undoes the change that was just made — it is said, and the button publishes again.
    const republishDemand = async (b = null) => {
        try { return await writeDemand(b ? [...builds.filter(x => x.id !== b.id), b] : builds); }
        catch (e) { console.warn('display demand not republished', e); return null; }
    };
    const publishDemandNow = async () => {
        setBusy('Publishing demand…');
        const dem = await republishDemand(draft && !dirty ? draft : null);
        setBusy('');
        alert(dem ? `Demand published to Stock View: ${Object.keys(dem.byItem || {}).length} item(s) across ${(dem.builds || []).length} open build order(s), ${dem.openBoards} display(s) open.` : 'The demand could not be published — try again.');
    };

    const open = (b) => { setDraft(JSON.parse(JSON.stringify(b))); setDirty(false); };
    const close = () => { if (dirty && !window.confirm('Discard unsaved changes to this build order?')) return; setDraft(null); setDirty(false); };
    const mutate = (fn) => { setDraft(d => fn({ ...d })); setDirty(true); };
    const setLine = (group, key, patch) => mutate(d => ({ ...d, lines: { ...d.lines, [group]: (d.lines?.[group] || []).map(l => (l.key === key ? { ...l, ...patch } : l)) } }));

    // A new build order, as it is opened: the display's bill as designed now, nothing built, nothing anchored.
    const buildOf = ({ disp, qty, cust = null, soNumber = '', poNumber = '', extra = {} }) => {
        const id = `BUILD-${String(disp.name || disp.id).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Date.now().toString().slice(-5)}`;
        return {
            id, displayId: disp.id, displayName: disp.name, style: disp.style, brandId: activeBrand || '',
            name: `${disp.name} × ${qty}${cust ? ` — ${cust.name}` : ''}`,
            customerId: cust?.id || '', customerName: cust?.name || '', soNumber: String(soNumber || '').trim(), poNumber: String(poNumber || '').trim(),
            qty, built: 0, status: 'PLANNED', shipPlan: [], notes: '', sampleBin: SAMPLE_BIN_BY_STYLE[disp.style] || '',
            lines: buildLinesFrom(disp, finishList, flows), snapshotAt: Date.now(),
            createdAt: Date.now(), createdBy: String(currentUser || ''), updatedAt: Date.now(), updatedBy: String(currentUser || ''),
            ...extra,
        };
    };
    const create = async () => {
        const disp = displays.find(d => d.id === newForm?.displayId);
        if (!disp) return alert('Pick the display this order builds.');
        const qty = N(newForm.qty, 0);
        if (!(qty > 0)) return alert('How many boards?');
        const cust = customers.find(c => c.id === newForm.customerId);
        const b = buildOf({ disp, qty, cust, soNumber: newForm.soNumber, poNumber: newForm.poNumber });
        const id = b.id;
        setBusy('Opening the order…');
        try { await setDoc(doc(db, 'system', 'displays', 'builds', id), b); await writeDemand([...builds.filter(x => x.id !== id), b]); setNewForm(null); open(b); }
        catch (e) { alert('Create failed: ' + (e?.message || e)); }
        setBusy('');
    };
    const save = async () => {
        if (!draft) return;
        setBusy('Saving…');
        try {
            const b = { ...draft, name: `${draft.displayName} × ${draft.qty}${draft.customerName ? ` — ${draft.customerName}` : ''}`, updatedAt: Date.now(), updatedBy: String(currentUser || '') };
            await setDoc(doc(db, 'system', 'displays', 'builds', b.id), b);
            await writeDemand([...builds.filter(x => x.id !== b.id), b]);
            setDraft(b); setDirty(false);
        } catch (e) { alert('Save failed: ' + (e?.message || e)); }
        setBusy('');
    };
    const remove = async (b) => {
        if (!window.confirm(`Delete build order "${b.name}"? Its demand leaves the snapshot.`)) return;
        try { await deleteDoc(doc(db, 'system', 'displays', 'builds', b.id)); await writeDemand(builds.filter(x => x.id !== b.id)); if (draft?.id === b.id) { setDraft(null); setDirty(false); } }
        catch (e) { alert('Delete failed: ' + (e?.message || e)); }
    };
    const resnapshot = () => {
        const disp = displays.find(d => d.id === draft?.displayId);
        if (!disp) return alert('The display this order was opened from no longer exists.');
        if (!window.confirm('Re-take the bill from the display as it is now? Typed work-order numbers, plater status and notes stay on lines that still exist; lines the design no longer has are dropped.')) return;
        mutate(d => ({ ...d, lines: resnapshotLines(d.lines, buildLinesFrom(disp, finishList, flows)), snapshotAt: Date.now() }));
    };
    const fillPlan = () => {
        const plan = shipPlanFill({ qty: draft.qty, perShip: fill.perShip, start: fill.start, everyDays: fill.everyDays });
        if (!plan.length) return alert('Give the plan a start date and boards per shipment.');
        mutate(d => ({ ...d, shipPlan: plan }));
    };

    // ── ⬇ CPQ ENTRY SHEET ───────────────────────────────────────────────────────────────────
    const entrySheet = async () => {
        if (!draft) return;
        const disp = displays.find(d => d.id === draft.displayId);
        const rowOrder = disp ? (disp.faces || []).filter(f => f.kind === 'ROWS').flatMap(f => (f.rows || []).map(r => r.label || '')) : [];
        const rows = cpqEntryRows(draft, { rowOrder, finishSuffixOf });
        if (!rows.length) return alert('No part lines split by row on this order — press ⟳ Re-snapshot, then Save order.');
        const csv = cpqEntryCsv(rows);
        const name = `${String(draft.displayName || 'display').replace(/[^A-Za-z0-9]+/g, '-')}-x${draft.qty}-CPQ-entry.csv`;
        try {
            const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
            const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
        } catch (e) { /* the copy below still works */ }
        try { await navigator.clipboard.writeText(csv); } catch (e) { /* download is enough */ }
        alert(`⬇ ${name}\n\n${rows.length} entries across ${new Set(rows.map(r => r.row)).size} rows for ${draft.qty} boards — downloaded and copied.`);
    };

    // ── ⧉ DUPLICATE FOR N DISPLAYS (Stuart 2026-10-06: "duplicate the first order of 50 with a brand new identical order
    // for 100pcs do not release it yet … use old prices … base front 1 put it all on one sales order") ──────────────────
    // One press: a NEW build order for the same display (nothing anchored, nothing released) and CPQ opened on a NEW,
    // unsaved quote copied from the CPQ quote(s) of the orders anchored here (Shared/reopenQuote.quoteCopyOf — each row at
    // the new count, the price set on it kept). An anchored order that is not a CPQ quote cannot be copied into CPQ; its
    // lines are named in the confirmation, for the new count, to be added there as a row. Nothing here writes a quote, a
    // sales order, a work order or a NetSuite record — the quote exists once it is saved in CPQ, and is reviewed there.
    const duplicateBuild = async () => {
        if (!draft || dirty || busy) return;
        const disp = displays.find(d => d.id === draft.displayId);
        if (!disp) return alert('The display this order was opened from no longer exists.');
        if (!floor || floor.loading) return alert('Still reading the orders on the floor — try again in a moment.');
        if (!(floor.sos || []).length) return alert('No sales order is anchored to this build order — there is no quote to copy. Open a new build order instead.');
        const typed = window.prompt(`⧉ Duplicate "${draft.name}" as a NEW order.\n\nFor how many displays?`, String(N(draft.qty) * 2));
        if (typed == null) return;
        const to = Number(String(typed).trim());
        if (!(Number.isInteger(to) && to > 0)) return alert('Give a whole number of displays.');
        setBusy('Reading the quote…');
        try {
            const jobs = [], others = [];
            for (const s of floor.sos) {
                const snap = s.so.hqJobId ? await getDoc(doc(db, 'jobs', s.so.hqJobId)) : null;
                const job = snap && snap.exists() ? { id: snap.id, ...snap.data() } : null;
                if (job && quoteDoorOf(job) === 'CPQ') jobs.push(job); else others.push(s.so);
            }
            if (!jobs.length) { alert('None of the orders anchored here came from a CPQ quote — there is nothing CPQ can open. Reopen the order in Order Entry (tab 7) and save it as a new one.'); return; }
            const wrongBrand = jobs.find(j => j.brandId && activeBrand && j.brandId !== activeBrand);
            if (wrongBrand) { alert(`${wrongBrand.quoteNo || wrongBrand.id} belongs to another division — switch to it first.`); return; }
            const copy = quoteCopyOf(jobs, { from: N(draft.qty), to });
            if (!copy.ok) { alert(`Cannot duplicate — ${copy.reason}.`); return; }
            if (!window.confirm(duplicateText({ build: draft, to, copy, others }))) return;
            if (!confirmCartReplace('the copy')) return;
            const cust = customers.find(c => c.id === draft.customerId) || (draft.customerId ? { id: draft.customerId, name: draft.customerName || '' } : null);
            const b = buildOf({ disp, qty: to, cust, extra: { copiedFromBuildId: draft.id } });
            setBusy('Opening the new order…');
            await setDoc(doc(db, 'system', 'displays', 'builds', b.id), b);
            await writeDemand([...builds.filter(x => x.id !== b.id), b]);
            // The new quote says what it is for — its sales order is then BORN parked for 10.5 (RTG never splits it).
            copy.header.jobData.displayOrder = { buildId: b.id, displays: to };
            openQuoteCopyInCpq(copy, { brand: activeBrand || '' });
        } catch (e) { alert('Duplicate failed: ' + (e?.message || e)); }
        setBusy('');
    };

    // ── THE ORDER ON THE FLOOR (Stuart 2026-09-17: "the work order#s should just appear there") ──
    // Our SO # → the CPQ sales order → every floor document RTG raised from it (Shared/orderLifecycle
    // .linkedDocsOf, the same lookup RTG's closer uses) + the plater's demands and shipment lines.
    // Read-only; nothing here writes.
    // ── THE ORDERS ON THE FLOOR — SEVERAL PER BUILD (Stuart 2026-09-22) ─────────────────────────
    // "the table top display is SO60551 + SO60565 … the wall display is SO60583 + SO60585." A build
    // anchors to every sales-order DOCUMENT that carries part of it (`soAppIds`), and reads each one
    // with its own links, shipments, floor documents and — when RTG already split it whole — the
    // whole-order documents its rows read their state from. `lookup` is a typed SO number that has
    // resolved but is not anchored yet: the thing the ⚓ button anchors.
    const [floor, setFloor] = useState(null);       // { loading, sos: [{ so, fin, shop, plating, links, shipments, whole, rowLines }], lookup, fin, shop, plating, error }
    const anchoredIdsOf = (b) => [...new Set([...(Array.isArray(b?.soAppIds) ? b.soAppIds : []), ...(b?.soAppId ? [b.soAppId] : [])].filter(Boolean))];
    const findSoByNumber = async (soNumber) => {
        const v = String(soNumber || '').trim();
        if (!v) return null;
        const salesOrders = collection(db, 'hq_sales_orders');
        const direct = await getDoc(doc(db, 'hq_sales_orders', v));
        if (direct.exists() && !(direct.data() || {}).deleted) return { id: direct.id, ...direct.data() };
        for (const t of [v, /^\d+$/.test(v) ? `SO${v}` : null, `SO-APP-${v}`].filter(Boolean)) {
            for (const field of ['soId', 'id']) {
                const qs = await getDocs(query(salesOrders, where(field, '==', t)));
                const hit = qs.docs.find(d => !(d.data() || {}).deleted);
                if (hit) return { id: hit.id, ...hit.data() };
            }
        }
        return null;
    };
    const readSo = async (so) => {
        const docs = await linkedDocsOf({ db, doc, getDoc, getDocs, query, collection, where }, so, 'sales');
        const fin = [...docs.fin.entries()].map(([id, d]) => ({ id, ...d }));
        const shop = [...docs.shop.entries()].map(([id, d]) => ({ id, ...d }));
        const keys = [...new Set([...identityKeysOf(so), ...docs.fin.keys(), ...docs.shop.keys()])].slice(0, 10);
        const plating = [];
        for (const [coll, field] of [['plating_demand', 'orderKey'], ['plating_demand', 'shopOrderId'], ['plating_shipments', 'orderKey'], ['plating_shipments', 'shopOrderId']]) {
            try {
                const qs = await getDocs(query(collection(db, coll), where(field, 'in', keys)));
                qs.docs.forEach(d => { if (!plating.some(p => p.id === d.id)) plating.push({ id: d.id, __coll: coll, ...d.data() }); });
            } catch (e) { /* a missing index or field: the rest still shows */ }
        }
        let links = null, shipments = [];
        try { links = (await loadOeLinks([so.id], { all: true }))[so.id] || null; } catch (e) { /* the row panel says it could not read */ }
        try { shipments = (await getDocs(query(collection(db, 'plating_shipments'), where('soAppId', '==', so.id)))).docs.map(d => ({ id: d.id, ...d.data() })); } catch (e) { /* likewise */ }
        const whole = wholeOrderDocsOf(so, fin, shop);
        // The split's packaging document(s), PKG-<key>: shown, and closed with the split when it is retired.
        const pkg = [];
        for (const id of packagingIdsOf(so)) {
            try { const d = await getDoc(doc(db, 'packaging_orders', id)); if (d.exists()) pkg.push({ id, ...d.data() }); } catch (e) { /* shown as absent */ }
        }
        // A split CPQ order has no lines[] and must not be given any: its rows are read off the
        // breakdown at load time, for visibility only, and nothing on the order changes.
        let rowLines = null;
        if (whole && soNeedsLines(so) && so.hqJobId) {
            try { const job = await getDoc(doc(db, 'jobs', so.hqJobId)); rowLines = job.exists() ? rowLinesFromBreakdown(((job.data().cpqData || {}).breakdown) || []) : []; }
            catch (e) { rowLines = []; }
        }
        return { so, fin, shop, plating, pkg, links, shipments, whole, rowLines };
    };
    const loadFloor = async (build) => {
        const ids = anchoredIdsOf(build);
        const typed = String(build?.soNumber || '').trim();
        // THE ORDER BORN FOR THIS BUILD (Shared/salesOrderHeader.displayParkOf): a sales order whose quote was made by
        // ⧉ Duplicate names the build order it is for — offered for its anchor without anybody typing its number.
        let born = null;
        if (build?.id) {
            try {
                const qs = await getDocs(query(collection(db, 'hq_sales_orders'), where('displayOrder.buildId', '==', build.id)));
                born = qs.docs.map(d => ({ id: d.id, ...d.data() })).find(o => !o.deleted && !ids.includes(o.id)) || null;
            } catch (e) { /* the typed number still finds it */ }
        }
        if (!ids.length && !typed && !born) { setFloor(null); return; }
        setFloor({ loading: true, sos: [], lookup: null, fin: [], shop: [], plating: [] });
        try {
            const sos = [];
            for (const id of ids) {
                const snap = await getDoc(doc(db, 'hq_sales_orders', id));
                if (snap.exists() && !(snap.data() || {}).deleted) sos.push(await readSo({ id: snap.id, ...snap.data() }));
            }
            // The typed number, when it is not one of the anchored orders, is offered for anchoring.
            let lookup = null;
            if (typed) {
                const so = await findSoByNumber(typed);
                if (!so) lookup = { error: `No sales order found for "${typed}" — type the SO number as RTG shows it.` };
                else if (!ids.includes(so.id)) lookup = await readSo(so);
            }
            if (!lookup && born) lookup = { ...(await readSo(born)), born: true };
            setFloor({
                loading: false, sos, lookup,
                fin: sos.flatMap(s => s.fin), shop: sos.flatMap(s => s.shop), plating: sos.flatMap(s => s.plating),
                shipments: sos.flatMap(s => s.shipments),
            });
        } catch (e) { setFloor({ loading: false, sos: [], lookup: null, fin: [], shop: [], plating: [], error: e?.message || String(e) }); }
    };
    useEffect(() => { if (draft && !dirty) loadFloor(draft); else if (!draft) setFloor(null); }, [draft?.id, draft?.soNumber, JSON.stringify(draft?.soAppIds || []), draft?.soAppId, dirty]); // eslint-disable-line react-hooks/exhaustive-deps
    const floorLinks = useMemo(() => (floor && !floor.loading && draft ? floorLinksByLine(draft.lines?.parts || [], floor) : {}), [floor, draft]);
    const [addSo, setAddSo] = useState('');

    // ── THE ANCHOR: this build ⇄ that sales-order document ─────────────────────────────────────
    // Written once per order. A CPQ order gets its `lines[]` here — one per physical part per row,
    // from the job's breakdown, in Order Entry's shape — because that is the only way it can join
    // the row route; an Order Entry order already has them. Both get `displayRelease` (RTG's
    // whole-order split and the automatic start stand down) and `finishAsAvailable` (rows release
    // alone). An order RTG ALREADY SPLIT is anchored for visibility only: nothing is written on it,
    // its rows read the whole-order documents, and it is never offered a Start.
    // AN ORDER PUT ON THE ROW ROUTE FROM NOW ON IS RELEASED BY COUNT (Stuart 2026-10-05, Shared/rowRelease): its rows
    // start for as many displays as are asked ("10 of 35"), its stocked lines follow each row's count at SO Pack. Only an
    // order nothing has been started or gathered on — one already in motion keeps the whole-row rules it began under.
    const countPatchFor = (so) => anchorCountPatchOf(so, N(draft?.qty));
    const anchor = async (entry) => {
        const so = entry?.so;
        if (!so || !draft) return;
        const already = anchoredIdsOf(draft);
        if (already.includes(so.id)) return;
        let lines = null;
        let text;
        if (entry.whole) {
            text = `Anchor "${draft.name}" to sales order ${so.soId || so.id} — FOR VISIBILITY ONLY?\n\nRTG has already split this order as a whole: ${wholeOrderText(entry.whole)}. Its rows will show what those documents are doing, managed on RTG. Nothing is written on the order and no row of it can be started from here — starting one would raise the same parts twice.`;
        } else {
            if (soNeedsLines(so)) {
                if (!so.hqJobId) return alert('This sales order has no lines and no CPQ job to read them from — nothing to anchor to.');
                const job = await getDoc(doc(db, 'jobs', so.hqJobId));
                lines = rowLinesFromBreakdown(job.exists() ? ((job.data().cpqData || {}).breakdown || []) : []);
                if (!lines.length) return alert(`The CPQ job ${so.hqJobId} has no physical lines in its breakdown — nothing to anchor to.`);
            }
            const src = lines || so.lines || [];
            const rowsSeen = new Set(src.map(l => rowOfLine(l)).filter(Boolean));
            const unnamed = src.filter(l => !rowOfLine(l)).length;
            text = `Anchor "${draft.name}" to sales order ${so.soId || so.id}?\n\n`
                + (lines ? `${lines.length} line(s) will be written on the sales order from its CPQ breakdown, across ${rowsSeen.size} row(s)${unnamed ? ` — ${unnamed} name no row and will show as unassigned` : ''}.\n\n` : `Its ${src.length} existing line(s) are used as they are${unnamed ? ` — ${unnamed} name no row and will show as unassigned` : ''}.\n\n`)
                + 'From then on this order\'s rows are started HERE, one at a time. RTG will not split it as a whole and will not auto-start it; every work order still lands on RTG under this order.'
                + (Object.keys(countPatchFor(so)).length ? `\n\nIt is released BY COUNT: each row starts for as many of the ${N(draft.qty)} displays as you ask, and its stocked lines are offered to the warehouse for the displays released.` : '');
        }
        if (!window.confirm(text)) return;
        setBusy('Anchoring…');
        try {
            if (!entry.whole) await updateDoc(doc(db, 'hq_sales_orders', so.id), { ...displayAnchorPatch({ buildId: draft.id, lines, so }), ...countPatchFor(so) });
            const soAppIds = [...already, so.id];
            const b = { ...draft, soAppIds, soAppId: soAppIds[0], soNumber: draft.soNumber || so.soId || so.id, updatedAt: Date.now(), updatedBy: String(currentUser || '') };
            await setDoc(doc(db, 'system', 'displays', 'builds', b.id), b, { merge: true });
            setDraft(b); setDirty(false); setAddSo('');
            await republishDemand(b); await loadFloor(b);
        } catch (e) { alert('Anchor failed: ' + (e?.message || e)); }
        setBusy('');
    };
    // ── ⟲ RETIRE THE WHOLE-ORDER SPLIT → RELEASE BY ROWS (Stuart 2026-09-22) ───────────────────
    // "keep the sales orders but otherwise start over, it is not workable in current format." The
    // whole-order finishing and shop documents close through the closer's own path — state kept
    // for reopen, pick fields cleared, open rod cuts cancelled, their queued NetSuite work-order
    // writes cancelled — with `keepRecord`, so the sales order itself is not closed and its own
    // queued writes are not touched. Open plating demands the split raised are cancelled through
    // the ledger. Then the order is anchored for real, and its rows start from here.
    //
    // Refused outright if anything on those documents has moved (retireBlockersOf): a document with
    // work logged against it is closed by a person on RTG who can see that work, not from here.
    const retireSplit = async (entry) => {
        const so = entry?.so;
        if (!so || !draft || !entry.whole) return;
        const blockers = retireBlockersOf({ fin: entry.whole.fin, shop: entry.whole.shop, fins: entry.whole.fins, shops: entry.whole.shops, plating: entry.plating || [], pkg: entry.pkg || [] });
        if (blockers.length) return alert(`Cannot retire the whole-order split of ${so.soId || so.id} — work has been logged on it:\n\n${blockers.map(b => `  • ${b}`).join('\n')}\n\nClose or finish it on RTG, where that work is visible.`);
        // The lines that will replace it: read now, so a breakdown with nothing in it stops this before anything closes.
        let lines = null;
        if (soNeedsLines(so)) {
            if (!so.hqJobId) return alert('This sales order has no lines and no CPQ job to read them from — nothing to release by rows.');
            const job = await getDoc(doc(db, 'jobs', so.hqJobId));
            lines = rowLinesFromBreakdown(job.exists() ? ((job.data().cpqData || {}).breakdown || []) : []);
            if (!lines.length) return alert(`The CPQ job ${so.hqJobId} has no physical lines in its breakdown — nothing to release by rows.`);
        }
        if (!window.confirm(retireText(so, { fin: entry.whole.fin, shop: entry.whole.shop, fins: entry.whole.fins, shops: entry.whole.shops, plating: entry.plating || [], pkg: entry.pkg || [] }))) return;
        setBusy('Retiring the whole-order split…');
        const by = String(currentUser || '10.5');
        try {
            const ctx = { db, doc, updateDoc, getDoc, getDocs, query, collection, where, deleteDoc, setDoc };
            const res = await closeOrderEverywhere(ctx, { order: so, kind: 'sales', by, from: '10.5', reason: 'released by rows from 10.5 (the whole-order split retired)', keepRecord: true });
            const demands = (entry.plating || []).filter(p => p && p.__coll === 'plating_demand');
            let cancelled = 0;
            for (const d of demands) {
                const r = await cancelPlatingDemand(ctx, { id: d.id, record: d, by, from: '10.5', reason: 'the whole-order split was retired — the row raises its own', shipmentLines: (entry.plating || []).filter(p => p.__coll === 'plating_shipments') });
                if (r.ok) cancelled++;
            }
            // The packaging document the split wrote (the closer does not know packaging_orders):
            // the same stamp shape, state kept, so it leaves the packing queue and can be read back.
            let pkgClosed = 0;
            for (const p of (entry.pkg || [])) {
                if (!p || p.closed || String(p.closedFrom || '') === '10.5') continue;
                await updateDoc(doc(db, 'packaging_orders', p.id), { status: 'closed', closed: true, closedAt: Date.now(), closedBy: by, closedFrom: '10.5', closeReason: 'released by rows from 10.5 (the whole-order split retired)', stateBeforeClose: { status: p.status || 'pending' } });
                pkgClosed++;
            }
            // The retired split's own backorder records go with it (2026-09-27): each row records its own shortfalls
            // (OE_ROW) when it starts — a stale split record would sit on the Snapshot board after its row covered it.
            await updateDoc(doc(db, 'hq_sales_orders', so.id), { ...displayAnchorPatch({ buildId: draft.id, lines, so }), ...countPatchFor(so), backorderLines: (so.backorderLines || []).filter(r => r && r.source === 'OE_ROW') });
            alert(`Retired: ${res.fin} finishing doc(s), ${res.shop} shop doc(s)${pkgClosed ? `, ${pkgClosed} packaging doc(s)` : ''} closed${res.rodCuts ? `, ${res.rodCuts} rod cut(s) cancelled` : ''}${(res.nsWritesCancelled || []).length ? `, ${res.nsWritesCancelled.length} queued NetSuite write(s) cancelled` : ''}${cancelled ? `, ${cancelled} plating demand(s) cancelled` : ''}${res.nsNeedsManualClose ? `.\n\n⚠ NetSuite work order ${res.ns} must be closed by hand — a task was raised.` : '.'}\n\n${so.soId || so.id} is now released by rows from here.`);
            await republishDemand(); await loadFloor(draft);
        } catch (e) { alert('Retire failed partway: ' + (e?.message || e) + '\n\nRead the floor again before doing anything else — some documents may already be closed.'); }
        setBusy('');
    };

    // ⟲ REOPEN FOR ROWS (Stuart 2026-09-26, the wall's SO60585 / SO60586): a closed anchored order
    // whose whole-order split never did any work goes back on the row route. Shared/displayRelease
    // decides whether it may, says what happens, and shapes the patch; this writes it.
    const reopenForRows = async (entry) => {
        const so = entry?.so;
        if (!so || !draft || !entry.whole) return;
        const chk = reopenForRowsCheck(so, entry.whole);
        if (!chk.ok) return alert(`Cannot reopen ${so.soId || so.id} for rows:\n\n${chk.why.map(w => `  • ${w}`).join('\n')}\n\nWork that was really done is reopened on RTG (⟲ Reopen), not here.`);
        let lines = null;
        if (soNeedsLines(so)) {
            if (!so.hqJobId) return alert('This sales order has no lines and no CPQ job to read them from — nothing to release by rows.');
            const job = await getDoc(doc(db, 'jobs', so.hqJobId));
            lines = rowLinesFromBreakdown(job.exists() ? ((job.data().cpqData || {}).breakdown || []) : []);
            if (!lines.length) return alert(`The CPQ job ${so.hqJobId} has no physical lines in its breakdown — nothing to release by rows.`);
        }
        if (!window.confirm(reopenForRowsText(so, entry.whole, entry.pkg || []))) return;
        setBusy('Reopening for rows…');
        const by = String(currentUser || '10.5');
        const now = Date.now();
        try {
            const w = entry.whole;
            const docs = [...(Array.isArray(w.fins) && w.fins.length ? w.fins : (w.fin ? [w.fin] : [])), ...(Array.isArray(w.shops) && w.shops.length ? w.shops : (w.shop ? [w.shop] : []))];
            // The split's documents stay exactly as closed — only marked retired, so they leave the whole-order read.
            for (const x of docs) {
                const coll = String(x.id).startsWith('SHOP-') ? 'shop_custom_orders' : 'fin_workorders';
                await updateDoc(doc(db, coll, x.id), splitRetiredStamp(by, now));
            }
            let pkgClosed = 0;
            for (const pk of (entry.pkg || [])) {
                if (!pk || pk.closed || String(pk.closedFrom || '') === '10.5') continue;
                await updateDoc(doc(db, 'packaging_orders', pk.id), { status: 'closed', closed: true, closedAt: now, closedBy: by, closedFrom: '10.5', closeReason: 'reopened for rows from 10.5 (the whole-order split retired)' });
                pkgClosed++;
            }
            const { patch, clear } = reopenForRowsSoPatch({ so, buildId: draft.id, lines, by, now });
            await updateDoc(doc(db, 'hq_sales_orders', so.id), { ...patch, ...countPatchFor(so), ...Object.fromEntries(clear.map(k => [k, deleteField()])) });
            alert(`⟲ ${so.soId || so.id} is open again, on the row route (${patch.status}). ${docs.length} whole-order document(s) marked retired${pkgClosed ? `, ${pkgClosed} pack card(s) closed` : ''}.\n\nIts rows read NOT STARTED — start them from here, one at a time.`);
            await republishDemand(); await loadFloor(draft);
        } catch (e) { alert('Reopen failed partway: ' + (e?.message || e) + '\n\nRead the floor again before doing anything else.'); }
        setBusy('');
    };

    // ↻ FIX LINE CODES (Stuart 2026-09-27): lines anchored before the base-item rule carry the CPQ
    // billing SKU as the item. The pure fix says which; this writes the corrected lines[] only.
    const fixLineCodes = async (entry) => {
        const so = entry?.so;
        const fix = so ? lineCodeFixesOf(so) : null;
        if (!so || !draft || !fix) return;
        if (!window.confirm(lineCodeFixText(so, fix))) return;
        setBusy('Fixing line codes…');
        try {
            await updateDoc(doc(db, 'hq_sales_orders', so.id), { lines: fix.lines, lineCodesFixedAt: Date.now(), lineCodesFixedBy: String(currentUser || '10.5') });
            alert(`↻ ${fix.fixed.length} line code(s) fixed on ${so.soId || so.id}.`);
            await republishDemand(); await loadFloor(draft);
        } catch (e) { alert('Could not fix the line codes: ' + (e?.message || e)); }
        setBusy('');
    };

    // ✕ THE RETIRED SPLIT'S PACK CARD (Shared/displayRelease.stalePackCardsOf, Stuart 2026-09-28): a rows-released order
    // packs at SO Pack; a PKG-<key> still pending on it is the whole-order split's, left behind by the retire — it sat in
    // the Packaging tab as live work. Closed with the retire's own stamp, so it leaves the queue and can be read back.
    const closeStalePackCards = async (entry) => {
        const so = entry?.so;
        const cards = stalePackCardsOf(entry);
        if (!so || !cards.length) return;
        if (!window.confirm(`Close ${so.soId || so.id}'s retired pack card${cards.length === 1 ? '' : 's'}?\n\n${cards.map(p => `  • ${p.id} · ${p.status || 'pending'} · ${(p.items || []).length} item(s) · written ${p.createdBy ? `by ${p.createdBy}` : ''}`).join('\n')}\n\nThe whole-order split that wrote ${cards.length === 1 ? 'it' : 'them'} is retired — this order is released by rows and packs at SO Pack. ${cards.length === 1 ? 'It leaves' : 'They leave'} the Packaging tab (closed, not deleted).`)) return;
        setBusy('Closing the pack card…');
        try {
            const by = String(currentUser || '10.5');
            for (const p of cards) await updateDoc(doc(db, 'packaging_orders', p.id), packCardCloseStamp(by, 'the whole-order split was retired — the order is released by rows and packs at SO Pack; this card was left pending'));
            alert(`✕ ${cards.map(p => p.id).join(', ')} closed.`);
            await loadFloor(draft);
        } catch (e) { alert('Could not close the pack card: ' + (e?.message || e)); }
        setBusy('');
    };

    // ↻ RE-READ LINES FROM THE CPQ JOB (Shared/displayRelease.rereadLinesPatchOf, 2026-09-27): lines anchored by the
    // old reader gain the fields CPQ's classifier reads, and the lines it dropped (fees, add-ons) come back — no line
    // moves, nothing is started.
    const rereadLines = async (entry) => {
        const so = entry?.so;
        if (!so || !draft || !so.hqJobId) return;
        setBusy('Reading the CPQ job…');
        try {
            const job = await getDoc(doc(db, 'jobs', so.hqJobId));
            // CPQ's row rules read the library (a part made in a stock colour, its /C record) and 4.5 (the sub finish).
            if (!libraryRef.current) {
                const snap = await getDocs(collection(db, 'Approved_Designs'));
                libraryRef.current = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            }
            const patch = rereadLinesPatchOf({
                so, breakdown: job.exists() ? ((job.data().cpqData || {}).breakdown || []) : [],
                finishes: [...(finishes.inHouse || []), ...(finishes.outsourced || [])], inventory: libraryRef.current,
            });
            setBusy('');
            if (!patch) return alert(`${so.soId || so.id}'s lines already carry everything its CPQ job has — nothing to re-read.`);
            if (!window.confirm(rereadLinesText(so, patch))) return;
            setBusy('Re-reading lines…');
            await updateDoc(doc(db, 'hq_sales_orders', so.id), { lines: patch.lines, backorderLines: patch.backorderLines, linesRereadAt: Date.now(), linesRereadBy: String(currentUser || '10.5') });
            alert(`↻ ${so.soId || so.id}: ${patch.enriched} line(s) completed, ${patch.added.length} added${(patch.kitsExploded || []).length ? `, ${patch.kitsExploded.length} kit(s) became their parts (added at the end — start them on their rows)` : ''}${(patch.restamped || []).length ? `, ${patch.restamped.length} brought to CPQ's rules` : ''}${patch.droppedBackorders ? `, ${patch.droppedBackorders} stale backorder record(s) removed` : ''}.${(patch.restamped || []).some(c => c.netsuite) ? `\n\n⚠ Change in NetSuite before packing:\n${patch.restamped.filter(c => c.netsuite).map(c => `  • line ${c.idx + 1}: ${c.text.split(':')[0]}`).join('\n')}` : ''}`);
            await republishDemand(); await loadFloor(draft);
        } catch (e) { alert('Could not re-read the lines: ' + (e?.message || e)); }
        setBusy('');
    };

    // ✎ A LINE'S QUANTITY (Shared/displayRelease.lineQtyEditOf, Stuart 2026-09-28 — SO60551's nuts: one rides each bracket):
    // only a line nothing has been raised or gathered for; read fresh, stamped, NetSuite changed by hand to match.
    const editLineQty = async (l) => {
        if (!l || !l.soAppId) return;
        try {
            const snap = await getDoc(doc(db, 'hq_sales_orders', l.soAppId));
            if (!snap.exists()) return alert('That sales order is gone.');
            const so = { id: snap.id, ...snap.data() };
            const line = (so.lines || [])[l.lineIdx];
            if (!line) return alert('That line is no longer on the order — reload the build.');
            const typed = window.prompt(`✎ ${so.soId || so.id} · line ${l.lineIdx + 1} · ${line.erp}${line.row ? ` (${line.row})` : ''}\n\nNew quantity (now ${line.qty}) — 0 takes it off the order:`, String(line.qty));
            if (typed === null) return;
            const why = window.prompt('Why? (recorded on the line)', '');
            if (why === null) return;
            const r = lineQtyEditOf({ so, lineIdx: l.lineIdx, qty: Number(String(typed).trim()), by: String(currentUser || '10.5'), reason: why });
            if (!r.ok) return alert(`Not changed — ${r.reason}.`);
            if (!window.confirm(`Change line ${l.lineIdx + 1} (${line.erp}) from ${r.from} to ${r.to}${r.to === 0 ? ' — OFF THE ORDER' : ''}?\n\n"${String(why).trim()}" is recorded on the line.\n\n⚠ NetSuite: change the same line on the sales order by hand — the app does not send it.`)) return;
            await updateDoc(doc(db, 'hq_sales_orders', so.id), { lines: r.lines });
            alert(`✎ ${so.soId || so.id} line ${l.lineIdx + 1}: ${line.erp} ${r.from} → ${r.to}. Change NetSuite to match.`);
            await republishDemand(); await loadFloor(draft);
        } catch (e) { alert('Could not change the line: ' + (e?.message || e)); }
    };

    // ✎ A ROD LINE (Shared/displayRelease.rodLineEditOf, Stuart 2026-09-30 — the wall's Row 1 rod read 70 FEET as 70 rods, no cut):
    // how many rods, the feet billed per rod, the cut length — read fresh, stamped; NetSuite's line in feet is unchanged when
    // rods × feet is what it already bills.
    const editRodLine = async (l) => {
        if (!l || !l.soAppId) return;
        try {
            const snap = await getDoc(doc(db, 'hq_sales_orders', l.soAppId));
            if (!snap.exists()) return alert('That sales order is gone.');
            const so = { id: snap.id, ...snap.data() };
            const line = (so.lines || [])[l.lineIdx];
            if (!line) return alert('That line is no longer on the order — reload the build.');
            const head = `✎ ${so.soId || so.id} · line ${l.lineIdx + 1} · ${line.erp}${line.row ? ` (${line.row})` : ''}\n${line.name || ''}\n\n`;
            const pcs = window.prompt(`${head}How many RODS (pieces)? Now ${line.qty}${line.perFoot ? '' : ' — not marked per foot'}.`, String(line.perFoot ? line.qty : ''));
            if (pcs === null) return;
            const ft = window.prompt(`${head}Feet BILLED per rod?`, String(line.feetPer || ''));
            if (ft === null) return;
            const cut = window.prompt(`${head}CUT LENGTH per rod, in inches?`, String(line.cutLength || ''));
            if (cut === null) return;
            const why = window.prompt('Why? (recorded on the line)', '');
            if (why === null) return;
            const r = rodLineEditOf({ so, lineIdx: l.lineIdx, pieces: Number(String(pcs).trim()), feetPer: Number(String(ft).trim()), cutLength: Number(String(cut).trim()), by: String(currentUser || '10.5'), reason: why });
            if (!r.ok) return alert(`Not changed — ${r.reason}.`);
            const nsSame = r.from.qty === r.to.billedFeet || (r.from.perFoot && r.from.qty * (r.from.feetPer || 0) === r.to.billedFeet);
            if (!window.confirm(`Line ${l.lineIdx + 1} (${line.erp}): ${r.from.qty}${r.from.perFoot ? ` rods × ${r.from.feetPer} ft` : ''}${r.from.cutLength ? ` · cut ${r.from.cutLength}"` : ' · no cut'} → ${r.to.qty} rods × ${r.to.feetPer} ft (${r.to.billedFeet} ft billed) · cut ${r.to.cutLength}"?\n\n"${String(why).trim()}" is recorded on the line.\n\n${nsSame ? `NetSuite: unchanged — the line already bills ${r.to.billedFeet} ft.` : `⚠ NetSuite: the line should bill ${r.to.billedFeet} ft — change it by hand.`}`)) return;
            await updateDoc(doc(db, 'hq_sales_orders', so.id), { lines: r.lines });
            alert(`✎ ${so.soId || so.id} line ${l.lineIdx + 1}: ${line.erp} — ${r.to.qty} rods × ${r.to.cutLength}" (${r.to.billedFeet} ft).`);
            await republishDemand(); await loadFloor(draft);
        } catch (e) { alert('Could not change the line: ' + (e?.message || e)); }
    };

    // ✎ A KIT'S QUANTITY (Shared/displayRelease.kitQtyEditOf, Stuart 2026-09-29): the kit and its parts together; 0 takes
    // them OFF THE ORDER, kept in their places. Read fresh, stamped, a part's shelf-pick stamp dropped with it; NetSuite by hand.
    const editKitQty = async (l) => {
        if (!l || !l.soAppId) return;
        try {
            const snap = await getDoc(doc(db, 'hq_sales_orders', l.soAppId));
            if (!snap.exists()) return alert('That sales order is gone.');
            const so = { id: snap.id, ...snap.data() };
            const line = (so.lines || [])[l.lineIdx];
            if (!line) return alert('That line is no longer on the order — reload the build.');
            const typed = window.prompt(`✎ ${so.soId || so.id} · line ${l.lineIdx + 1} · kit ${line.erp}${line.row ? ` (${line.row})` : ''}\n\nNew quantity for the kit and its parts (now ${line.qty}) — 0 takes it off the order:`, String(line.qty));
            if (typed === null) return;
            const why = window.prompt('Why? (recorded on the kit and its parts)', '');
            if (why === null) return;
            const r = kitQtyEditOf({ so, lineIdx: l.lineIdx, qty: Number(String(typed).trim()), by: String(currentUser || '10.5'), reason: why });
            if (!r.ok) return alert(`Not changed — ${r.reason}.`);
            if (!window.confirm(`Kit line ${l.lineIdx + 1} (${line.erp}${line.row ? `, ${line.row}` : ''}): ${r.from} → ${r.to}${r.to === 0 ? ' — OFF THE ORDER' : ''}?\n\nIts parts:\n${r.parts.map(p => `  • line ${p.idx + 1}: ${p.from} → ${p.to} × ${p.code}`).join('\n')}${r.oeGenDrop.length ? `\n\nTheir shelf-pick stamp${r.oeGenDrop.length > 1 ? 's go' : ' goes'} with them (nothing was made).` : ''}\n\n"${String(why).trim()}" is recorded on each line.\n\n⚠ NetSuite: change the same lines on the sales order by hand — the app does not send it.`)) return;
            const patch = { lines: r.lines };
            r.oeGenDrop.forEach(i => { patch[`oeGen.${i}`] = deleteField(); });
            await updateDoc(doc(db, 'hq_sales_orders', so.id), patch);
            alert(`✎ ${so.soId || so.id} kit line ${l.lineIdx + 1}: ${line.erp} ${r.from} → ${r.to}${r.to === 0 ? ' (off the order)' : ''}. Change NetSuite to match.`);
            await republishDemand(); await loadFloor(draft);
        } catch (e) { alert('Could not change the kit: ' + (e?.message || e)); }
    };

    // ✎ A KIT'S FINISH (Shared/displayRelease.kitFinishEditOf, Stuart 2026-09-29: "table top base back1 is ep1"): the kit and
    // its parts change together by the one kit rule — only while nothing is raised or gathered for its parts; read fresh,
    // stamped, NetSuite changed by hand to match. A part that must now be made reads NOT STARTED: ▶ Start row plans it.
    const editKitFinish = async (l) => {
        if (!l || !l.soAppId) return;
        try {
            const snap = await getDoc(doc(db, 'hq_sales_orders', l.soAppId));
            if (!snap.exists()) return alert('That sales order is gone.');
            const so = { id: snap.id, ...snap.data() };
            const line = (so.lines || [])[l.lineIdx];
            if (!line) return alert('That line is no longer on the order — reload the build.');
            const typed = window.prompt(`✎ ${so.soId || so.id} · line ${l.lineIdx + 1} · kit ${line.erp}${line.row ? ` (${line.row})` : ''}\n\nFinish for the kit and its parts (now ${line.finishCode || 'none'}):`, String(line.finishCode || ''));
            if (typed === null) return;
            const why = window.prompt('Why? (recorded on the kit)', '');
            if (why === null) return;
            if (!libraryRef.current) {
                const lib = await getDocs(collection(db, 'Approved_Designs'));
                libraryRef.current = lib.docs.map(d => ({ id: d.id, ...d.data() }));
            }
            const r = kitFinishEditOf({ so, lineIdx: l.lineIdx, finishCode: typed, inventory: libraryRef.current, by: String(currentUser || '10.5'), reason: why });
            if (!r.ok) return alert(`Not changed — ${r.reason}.`);
            if (!window.confirm(`Kit line ${l.lineIdx + 1} (${line.erp}${line.row ? `, ${line.row}` : ''}): finish ${r.from} → ${r.to}?\n\nIts parts:\n${r.parts.map(p => `  • line ${p.idx + 1}: ${p.from} → ${p.to}`).join('\n')}\n\n"${String(why).trim()}" is recorded on the kit. A part that must now be made reads NOT STARTED — ▶ Start row plans it.\n\n⚠ NetSuite: change the same lines on the sales order by hand — the app does not send it.`)) return;
            await updateDoc(doc(db, 'hq_sales_orders', so.id), { lines: r.lines });
            alert(`✎ ${so.soId || so.id} kit line ${l.lineIdx + 1}: ${line.erp} ${r.from} → ${r.to}. Change NetSuite to match.`);
            await republishDemand(); await loadFloor(draft);
        } catch (e) { alert('Could not change the kit: ' + (e?.message || e)); }
    };

    // ↩ UNDO A ROW START (Shared/displayRelease.rowUndoBlockersOf, 2026-09-27): a row started under an older rule is put
    // back while nothing on its documents has moved — its pair's documents leave through the ledger, its lines read
    // NOT STARTED, and ▶ Start row writes it again under today's rules.
    const undoRowStart = async (label, state) => {
        if (!draft) return;
        const by = String(currentUser || '10.5');
        const ctx = { db, doc, updateDoc, getDoc, getDocs, query, collection, where, deleteDoc, setDoc };
        setBusy('Checking the row…');
        try {
            const soIds = [...new Set((state.lines || []).map(l => l.soAppId).filter(Boolean))];
            const plan = [];   // { so, idxs, hqs, fins, shops, stockIdxs }
            for (const soAppId of soIds) {
                const fresh = await getDoc(doc(db, 'hq_sales_orders', soAppId));
                if (!fresh.exists()) continue;
                const so = { id: fresh.id, ...fresh.data() };
                const idxs = (state.lines || []).filter(l => l.soAppId === soAppId).map(l => l.lineIdx).filter(i => so.oeGen && so.oeGen[i]);
                const ids = [...new Set(idxs.flatMap(i => (so.oeGen[i].kind === 'WO' ? (so.oeGen[i].ids || []) : [])))];
                const hqs = [], fins = [], shops = [];
                for (const id of ids) {
                    const h = await getDoc(doc(db, 'hq_work_orders', id)); if (h.exists()) hqs.push({ id: h.id, ...h.data() });
                    const f = await getDoc(doc(db, 'fin_workorders', id)); if (f.exists()) fins.push({ id: f.id, ...f.data() });
                    const sh = await getDoc(doc(db, 'shop_custom_orders', `SHOP-${id}`)); if (sh.exists()) shops.push({ id: sh.id, ...sh.data() });
                }
                const plating = idxs.filter(i => so.oeGen[i].kind === 'PLATING');
                const gatheredCodes = idxs.filter(i => so.oeGen[i].kind === 'STOCK').map(i => String(so.oeGen[i].code || '')).filter(c => ((so.committedQty || {})[c] || 0) > 0);
                plan.push({ so, idxs, hqs, fins, shops, plating, gatheredCodes });
            }
            const blockers = plan.flatMap(p => rowUndoBlockersOf({ hqs: p.hqs, fins: p.fins, shops: p.shops, gatheredCodes: p.gatheredCodes }))
                .concat(plan.some(p => p.plating.length) ? ['it has plating demands — use ↩ Undo plating start'] : []);
            setBusy('');
            if (blockers.length) return alert(`Cannot undo ${label} — work has moved:\n\n${blockers.map(b => `  • ${b}`).join('\n')}\n\nClose or finish it on RTG, where that work is visible.`);
            const docs = plan.flatMap(p => [...p.hqs.map(d => `hq ${d.id}`), ...p.fins.map(d => `floor ${d.id}`), ...p.shops.map(d => `shop ${d.id}`)]);
            if (!window.confirm(`↩ Undo the start of ${label}?\n\nNothing on it has moved. These leave (recorded in the deletion ledger):\n${docs.map(d => `  • ${d}`).join('\n') || '  • (no documents — stock picks only)'}\n\nIts lines read NOT STARTED; press ▶ Start row to write it under today's rules.`)) return;
            setBusy('Undoing the row…');
            const reason = `${label}: started under an older rule — restarted under today's (10.5 ↩ Undo row start)`;
            for (const p of plan) {
                for (const d of p.fins) await hardDeleteWithLedger(ctx, { collection: 'fin_workorders', docId: d.id, record: d, kind: 'fin_workorder', by, from: '10.5', reason });
                for (const d of p.shops) await hardDeleteWithLedger(ctx, { collection: 'shop_custom_orders', docId: d.id, record: d, kind: 'shop_custom_order', by, from: '10.5', reason });
                for (const d of p.hqs) await hardDeleteWithLedger(ctx, { collection: 'hq_work_orders', docId: d.id, record: d, kind: 'hq_work_order', by, from: '10.5', reason });
                const patch = {};
                p.idxs.forEach(i => { patch[`oeGen.${i}`] = deleteField(); });
                const boLeft = (p.so.backorderLines || []).filter(r => !(r && r.source === 'OE_ROW' && p.idxs.includes(r.lineIndex)));
                if (boLeft.length !== (p.so.backorderLines || []).length) patch.backorderLines = boLeft;
                patch[`displayRows.${rowKeyOf(label)}`] = deleteField();
                await updateDoc(doc(db, 'hq_sales_orders', p.so.id), patch);
            }
            alert(`${label} is NOT STARTED again — ${docs.length} document(s) removed through the ledger. Press ▶ Start row.`);
            await republishDemand(); await loadFloor(draft);
        } catch (e) { alert('Could not undo the row: ' + (e?.message || e)); }
        setBusy('');
    };

    // An order released by rows before the class rule (Shared/displayRelease.needsPackCard): the
    // same stamp the anchor and the retire write, applied by itself — nothing else on the order moves.
    const givePackCard = async (entry) => {
        const so = entry?.so;
        const need = so && !entry.whole ? needsPackCard(so) : '';
        if (!so || !draft || !need) return;
        if (!window.confirm(need === 'count'
            ? `Correct the piece count on ${so.soId || so.id}'s pack card?\n\nThe card reads ${so.totalParts || 0} pcs; its lines add up to ${(so.lines || []).reduce((a, l) => a + (Number(l.qty) || 0), 0)}. Nothing else on the order changes.`
            : `Give ${so.soId || so.id} its pack card?\n\nThe order is stamped as an Order Entry order (its lines are the truth): the WMS SO Pack card appears with its stocked lines to pick and its made-to-order lines on hold until their row work orders come back. Nothing else on the order changes.`)) return;
        setBusy('Stamping…');
        try {
            await updateDoc(doc(db, 'hq_sales_orders', so.id), displayAnchorPatch({ buildId: draft.id, so }));
            await loadFloor(draft);
        } catch (e) { alert('Could not stamp it: ' + (e?.message || e)); }
        setBusy('');
    };
    // The reverse, for a whole-order order that carries the class by mistake: it packs on its
    // whole-order documents, so the class and the pick status come back off. Never an Order Entry sale.
    const removePackCard = async (entry) => {
        const so = entry?.so;
        if (!so || !draft || !packCardToRemove(so, entry.whole)) return;
        if (!window.confirm(`Remove the pack card from ${so.soId || so.id}?\n\nThis order is split whole by RTG and packs on ${wholeOrderText(entry.whole)} — the SO Pack card is a second pack home with no lines on it. The Order Entry class and the pick status come off; nothing else on the order changes.`)) return;
        setBusy('Removing…');
        try {
            await updateDoc(doc(db, 'hq_sales_orders', so.id), { orderClass: deleteField(), pickStatus: deleteField() });
            await loadFloor(draft);
        } catch (e) { alert('Could not remove it: ' + (e?.message || e)); }
        setBusy('');
    };

    // ↩ UNDO A PLATING START (Stuart 2026-09-27, SO60551 Base Front 3). Until 09-27 a row sent every plated
    // line straight to the plater as raw cores — a finial on the shelf included, a pole never cut. Now a
    // plated small part is picked from stock (or backordered to the Snapshot) and a plated pole goes to the
    // shop, which sends it to plating. A row started under the old rule is put back: its plating demands are
    // cancelled through the one cancel (ledgered; refused once anything has shipped) and each line's record
    // cleared, so the row reads NOT STARTED and ▶ Start row runs it under the rule it should have had.
    const undoPlatingStart = async (label, state) => {
        const lines = (state.lines || []).filter(l => l.key === 'PLATING');
        if (!lines.length || !draft) return;
        if (!window.confirm(`↩ Undo the plating start of ${label}?\n\n${lines.map(l => `   ${l.soId} · ${l.qty} × ${l.erp}/${l.finish} — ${l.text}`).join('\n')}\n\nIts plating demands are cancelled (nothing has gone to the plater yet) and the lines read NOT STARTED. Then ▶ Start row: a plated finial is picked from stock, a plated pole goes to the shop and then to plating.`)) return;
        setBusy('Undoing the plating start…');
        const by = String(currentUser || '10.5');
        const ctx = { db, doc, updateDoc, getDoc, getDocs, query, collection, where, deleteDoc, setDoc };
        let cancelled = 0, cleared = 0;
        const refused = [];
        try {
            for (const soAppId of [...new Set(lines.map(l => l.soAppId))]) {
                const fresh = await getDoc(doc(db, 'hq_sales_orders', soAppId));
                if (!fresh.exists()) continue;
                const soNow = { id: fresh.id, ...fresh.data() };
                const entry = (floor?.sos || []).find(x => x.so.id === soAppId) || {};
                const shipments = (entry.plating || []).filter(p => p && p.__coll === 'plating_shipments');
                const dSnap = await getDocs(query(collection(db, 'plating_demand'), where('soAppId', '==', soAppId)));
                const demands = dSnap.docs.map(d => ({ id: d.id, ...d.data() }));
                for (const l of lines.filter(x => x.soAppId === soAppId)) {
                    const gen = (soNow.oeGen || {})[l.lineIdx];
                    if (!gen || gen.kind !== 'PLATING') continue;
                    let ok = true;
                    for (const id of (gen.ids || [])) {
                        const d = demands.find(x => x.id === id);
                        if (!d) continue;   // already gone
                        const r = await cancelPlatingDemand(ctx, { id, record: d, by, from: '10.5', reason: `${label}: started under the old plated rule — restarted stock-first`, shipmentLines: shipments });
                        if (r.ok) cancelled++; else { ok = false; refused.push(`${l.erp}/${l.finish}: ${r.reason}`); }
                    }
                    if (ok) { await updateDoc(doc(db, 'hq_sales_orders', soAppId), { [`oeGen.${l.lineIdx}`]: deleteField() }); cleared++; }
                }
            }
            await republishDemand(); await loadFloor(draft);
            alert(`${label}: ${cancelled} plating demand(s) cancelled, ${cleared} line(s) back to NOT STARTED.${refused.length ? `\n\nNot undone:\n${refused.map(x => `  • ${x}`).join('\n')}` : ''}${cleared ? '\n\nPress ▶ Start row to run it under the stock-first rule.' : ''}`);
        } catch (e) { alert('Could not undo it: ' + (e?.message || e)); }
        setBusy('');
    };

    // Another sales order for this build: type its number, it resolves, ⚓ anchors it.
    const lookupSo = async () => {
        const v = String(addSo || '').trim();
        if (!v || !draft) return;
        setBusy('Looking up…');
        try {
            const so = await findSoByNumber(v);
            if (!so) { alert(`No sales order found for "${v}" — type the SO number as RTG shows it.`); setBusy(''); return; }
            if (anchoredIdsOf(draft).includes(so.id)) { alert(`${so.soId || so.id} is already anchored to this build.`); setBusy(''); return; }
            const entry = await readSo(so);
            setFloor(f => ({ ...(f || { sos: [], fin: [], shop: [], plating: [] }), lookup: entry }));
        } catch (e) { alert('Lookup failed: ' + (e?.message || e)); }
        setBusy('');
    };

    // ── A LINE THAT NAMES NO ROW is told which one (the operator's call, recorded on the line) ──
    const assignRow = async (soAppId, lineIdx, label) => {
        setBusy('Assigning…');
        try {
            const fresh = await getDoc(doc(db, 'hq_sales_orders', soAppId));
            const cur = (fresh.data() || {}).lines || [];
            if (!cur[lineIdx]) throw new Error('that line is no longer on the sales order');
            // "The order itself" marks the display's own line (its base) — not a row, never unassigned.
            const next = cur.map((l, i) => (i !== lineIdx ? l : label === ORDER_ROW_LABEL ? { ...l, row: '', orderLevel: true } : { ...l, row: label, orderLevel: false }));
            await updateDoc(doc(db, 'hq_sales_orders', soAppId), { lines: next });
            await republishDemand(); await loadFloor(draft);
        } catch (e) { alert('Could not assign the row: ' + (e?.message || e)); }
        setBusy('');
    };

    // ── ▶ START A ROW — Order Entry's generator, scoped to this row's lines, per sales order ────
    const [runLog, setRunLog] = useState([]);
    const [starting, setStarting] = useState('');
    const libraryRef = React.useRef(null);
    const startRow = async (label, state) => {
        if (!draft || !floor) return;
        if (!window.confirm(rowStartText(label, state))) return;
        setStarting(label); setRunLog([]);
        const log = (msg, level = 'info') => setRunLog(l => [...l, { msg, level }]);
        let ranTotal = 0, reviewTotal = 0;
        try {
            if (!libraryRef.current) {
                log('Reading the Master Library…');
                const snap = await getDocs(collection(db, 'Approved_Designs'));
                libraryRef.current = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            }
            const inventory = oeInventoryOf(libraryRef.current, activeBrand);
            const key = label === ORDER_ROW_LABEL ? 'ORDER' : rowKeyOf(label);
            const onlyThese = label === ORDER_ROW_LABEL ? (line) => !!(line && line.orderLevel) : (line) => !(line && line.orderLevel) && rowKeyOf(rowOfLine(line)) === key;
            // Only the orders that hold a startable line of this row; a whole-order one never does.
            const targets = (floor.sos || []).filter(s => !s.whole && state.lines.some(l => l.soAppId === s.so.id && (l.key === 'NONE' || l.key === 'REVIEW')));
            for (const s of targets) {
                const fresh = await getDoc(doc(db, 'hq_sales_orders', s.so.id));
                const soNow = { id: fresh.id, ...fresh.data() };
                log(`${label} · ${soNow.soId || soNow.id}:`);
                const res = await runOeAuto({
                    so: soNow, brand: activeBrand, user: currentUser || '10.5', inventory, log,
                    finishes: [...(finishes.inHouse || []), ...(finishes.outsourced || [])],
                    only: onlyThese,
                    slot: `displayRows.${key}`,
                    // A person pressing the button asks again on purpose — the automatic run's
                    // "already answered" guard does not apply to them.
                    force: true,
                });
                if (res.state === 'SKIPPED') log(`   another session is already starting it, or it was answered for exactly these lines — nothing done.`, 'warn');
                else log(`   ${res.ran} started · ${res.review.length} line(s) need a decision.`, res.review.length ? 'warn' : 'success');
                ranTotal += res.ran; reviewTotal += res.review.length;
            }
            if (!targets.length) log(`${label}: nothing startable — its lines are stocked, already raised, or on a whole-order document.`, 'warn');
            if (ranTotal > 0) {
                const rowsStarted = [...new Set([...(draft.rowsStarted || []), label])];
                const b = { ...draft, rowsStarted, status: draft.status === 'PLANNED' ? 'IN_PRODUCTION' : draft.status, updatedAt: Date.now(), updatedBy: String(currentUser || '') };
                await setDoc(doc(db, 'system', 'displays', 'builds', b.id), b, { merge: true });
                await writeDemand([...builds.filter(x => x.id !== b.id), b]);
                setDraft(b); setDirty(false);
            }
            log(`${label}: ${ranTotal} started across ${targets.length} sales order(s)${reviewTotal ? ` · ${reviewTotal} need a decision` : ''}.`, reviewTotal ? 'warn' : 'success');
            await loadFloor(draft);
        } catch (e) { log(`${label}: failed — ${e?.message || e}`, 'error'); }
        setStarting('');
    };

    // ── ▶ START n OF m DISPLAYS OF A ROW (Stuart 2026-10-05, Shared/rowRelease) ─────────────────────────────────────────
    // "we would like the ability to put say just 10pcs (full rows) of the 35pcs into motion." The row's count goes on the
    // sales order FIRST (rowRelease.<ROW>), then the same generator runs: it raises, for each line, what that count calls
    // for and has not yet been raised. `add` 0 runs the row again at the count it already has (a line named for a decision
    // last time). Every line is read and confirmed at its quantity before anything is written; a line that does not divide
    // evenly by the display stops a partial release. A release nothing came of (another session was starting it, NetSuite
    // could not be read) is taken back, so the count never says more than was put in motion.
    const [relN, setRelN] = useState({});
    const rowKeyFor = (label) => (label === ORDER_ROW_LABEL ? ORDER_ROW_KEY : rowKeyOf(label));
    const startRowByCount = async (label, state, add) => {
        if (!draft || !floor) return;
        const of = Math.floor(N(draft.qty));
        const key = rowKeyFor(label);
        if (!(of > 0)) return alert('The build does not say how many displays it is — set the quantity and save first.');
        setStarting(label); setRunLog([]);
        const log = (msg, level = 'info') => setRunLog(l => [...l, { msg, level }]);
        try {
            const targets = [];
            for (const s of (floor.sos || []).filter(x => !x.whole && isReleaseByCount(x.so))) {
                const fresh = await getDoc(doc(db, 'hq_sales_orders', s.so.id));
                if (!fresh.exists()) continue;
                const soNow = { id: fresh.id, ...fresh.data() };
                if ((soNow.lines || []).some(l => l && releaseRowKeyOf(l) === key)) targets.push(soNow);
            }
            if (!targets.length) { log(`${label}: no sales order released by count carries this row.`, 'warn'); return; }
            const from = Math.max(0, ...targets.map(so => rowTargetOf(so, key)));
            const to = Math.min(of, from + Math.max(0, Math.floor(N(add))));
            if (N(add) > 0 && to === from) { alert(`Every display of ${label} is already released (${from} of ${of}).`); return; }
            const plans = targets.map(so => ({ so, plan: rowReleasePlanOf({ so, rowKey: key, target: to, of }) }));
            const bad = plans.flatMap(x => x.plan.why.map(w => `${x.so.soId || x.so.id} · ${w}`));
            if (bad.length) { alert(`Cannot start ${label} for ${to} of ${of}:\n\n${bad.map(b => `  • ${b}`).join('\n')}\n\nA partial release needs every line of the row to divide evenly by the display. Release every display of the row (${of - from} more), or correct the line's quantity (✎).`); return; }
            // 10.5's own reading says which lines are shelf picks no start ever raises: they follow the count alone.
            const stocked = new Set(state.lines.filter(l => l.key === 'STOCKED' && /^stocked —/.test(String(l.text || ''))).map(l => `${l.soAppId}|${l.lineIdx}`));
            const textLines = plans.flatMap(x => x.plan.lines.filter(l => !l.fee).map(l => {
                const isStocked = stocked.has(`${x.so.id}|${l.lineIdx}`);
                return { ...l, stocked: isStocked, released: isStocked ? l.prev : l.released, now: isStocked ? Math.max(0, l.want - l.prev) : l.now, soId: targets.length > 1 ? (x.so.soId || x.so.id) : '' };
            }));
            if (!window.confirm(rowReleaseText({ label, from, to, of, lines: textLines }))) return;
            const by = String(currentUser || '10.5');
            const now = Date.now();
            const before = {};
            for (const so of targets) {
                before[so.id] = rowReleaseOf(so, key);
                await updateDoc(doc(db, 'hq_sales_orders', so.id), { [`rowRelease.${key}`]: nextRowReleaseOf({ so, rowKey: key, add: to - rowTargetOf(so, key), of, by, now }), releaseOf: of });
            }
            if (!libraryRef.current) {
                log('Reading the Master Library…');
                const snap = await getDocs(collection(db, 'Approved_Designs'));
                libraryRef.current = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            }
            const inventory = oeInventoryOf(libraryRef.current, activeBrand);
            const onlyThese = (line) => !!line && releaseRowKeyOf(line) === key;
            let ranTotal = 0, reviewTotal = 0, kept = 0;
            for (const so of targets) {
                const fresh = await getDoc(doc(db, 'hq_sales_orders', so.id));
                const soNow = { id: fresh.id, ...fresh.data() };
                const run = releaseRunOf(soNow, key);
                log(`${label} · ${soNow.soId || soNow.id} — ${to} of ${of}${to > from ? ` (${releaseLabelOf(run)})` : ''}:`);
                let res = null, threw = '';
                try {
                    res = await runOeAuto({
                        so: soNow, brand: activeBrand, user: currentUser || '10.5', inventory, log,
                        finishes: [...(finishes.inHouse || []), ...(finishes.outsourced || [])],
                        only: onlyThese, slot: `displayRows.${key}`, force: true,
                    });
                } catch (e) { threw = String(e?.message || e); }
                const nothing = threw || (res && (res.state === 'SKIPPED' || res.state === 'FAILED'));
                if (nothing && to > from) {
                    // Did ANY line take this run before it stopped? Then the release stands (and is run again); else it is taken back.
                    const after = await getDoc(doc(db, 'hq_sales_orders', so.id));
                    const data = after.exists() ? after.data() : {};
                    const took = Object.entries(data.oeGen || {}).some(([i, g]) => g && (data.lines || [])[i] && releaseRowKeyOf(data.lines[i]) === key && releasesOf(g).some(r => Number(r.no) === Number(run.no)));
                    if (!took) {
                        await updateDoc(doc(db, 'hq_sales_orders', so.id), { [`rowRelease.${key}`]: before[so.id] || deleteField() });
                        log(`   ${threw ? `failed — ${threw}` : res.state === 'SKIPPED' ? 'another session is already starting this row' : 'NetSuite could not be read'} — the release was TAKEN BACK (${from} of ${of} stands). Nothing was started; try again.`, 'error');
                        continue;
                    }
                }
                kept++;
                if (threw) log(`   stopped partway — ${threw}. What was raised stands; press ▶ Try again for the rest.`, 'error');
                else if (res.state === 'SKIPPED') log('   another session is already starting it — nothing done.', 'warn');
                else log(`   ${res.ran} started · ${res.review.length} line(s) need a decision.`, res.review.length ? 'warn' : 'success');
                ranTotal += res ? res.ran : 0; reviewTotal += res ? res.review.length : 0;
            }
            // A sales order of this build from before release counts starts its lines of the row whole, as it always has.
            for (const s of (floor.sos || []).filter(x => !x.whole && !isReleaseByCount(x.so) && state.lines.some(l => l.soAppId === x.so.id && (l.key === 'NONE' || l.key === 'REVIEW')))) {
                const fresh = await getDoc(doc(db, 'hq_sales_orders', s.so.id));
                const soNow = { id: fresh.id, ...fresh.data() };
                log(`${label} · ${soNow.soId || soNow.id} (released whole — on the row route before release counts):`);
                const res = await runOeAuto({ so: soNow, brand: activeBrand, user: currentUser || '10.5', inventory, log, finishes: [...(finishes.inHouse || []), ...(finishes.outsourced || [])], only: (line) => !!line && releaseRowKeyOf(line) === key, slot: `displayRows.${key}`, force: true });
                ranTotal += res.ran; reviewTotal += res.review.length;
            }
            const final = kept ? to : from;
            if (final > 0 || ranTotal > 0) {
                const rowsStarted = [...new Set([...(draft.rowsStarted || []), label])];
                const b = { ...draft, rowsStarted, rowReleased: { ...(draft.rowReleased || {}), [key]: final }, status: draft.status === 'PLANNED' ? 'IN_PRODUCTION' : draft.status, updatedAt: Date.now(), updatedBy: String(currentUser || '') };
                await setDoc(doc(db, 'system', 'displays', 'builds', b.id), b, { merge: true });
                await writeDemand([...builds.filter(x => x.id !== b.id), b]);
                setDraft(b); setDirty(false);
            }
            setRelN(m => ({ ...m, [label]: '' }));
            log(`${label}: ${final} of ${of} displays released — ${ranTotal} line(s) started${reviewTotal ? ` · ${reviewTotal} need a decision` : ''}.`, reviewTotal ? 'warn' : 'success');
            await loadFloor(draft);
        } catch (e) { log(`${label}: failed — ${e?.message || e}`, 'error'); }
        finally { setStarting(''); }
    };

    // ↩ UNDO THE LAST RELEASE of a row — only while nothing on it has moved (the same test ↩ Undo row start uses), and
    // only while nothing gathered into the order's bin would be left without a release to belong to. Its documents leave
    // through the ledger, each line drops that release, and the row's count goes back to what it was before it.
    const undoLastRelease = async (label) => {
        if (!draft || !floor) return;
        const key = rowKeyFor(label);
        const by = String(currentUser || '10.5');
        const ctx = { db, doc, updateDoc, getDoc, getDocs, query, collection, where, deleteDoc, setDoc };
        setBusy('Checking the release…');
        try {
            const plan = [];
            for (const s of (floor.sos || []).filter(x => !x.whole && isReleaseByCount(x.so))) {
                const fresh = await getDoc(doc(db, 'hq_sales_orders', s.so.id));
                if (!fresh.exists()) continue;
                const so = { id: fresh.id, ...fresh.data() };
                const rr = rowReleaseOf(so, key);
                if (!rr || !(rowTargetOf(so, key) > 0)) continue;
                const runs = Array.isArray(rr.log) ? rr.log : [];
                const last = runs[runs.length - 1] || { no: 1, from: 0, to: rowTargetOf(so, key) };
                const idxs = (so.lines || []).map((l, i) => i).filter(i => so.lines[i] && releaseRowKeyOf(so.lines[i]) === key);
                // A row started WHOLE before release counts has no releases to take back one at a time.
                if (idxs.some(i => isWholeStamp((so.oeGen || {})[i]))) { setBusy(''); return alert(`${label} was started whole, before release counts — there is no single release to undo.\n\nTo run it again by count, press ⟲ Restart row.`); }
                const hit = idxs.filter(i => releasesOf((so.oeGen || {})[i]).some(r => Number(r.no) === Number(last.no)));
                const ids = [...new Set(hit.flatMap(i => releasesOf(so.oeGen[i]).filter(r => Number(r.no) === Number(last.no) && String(r.kind) !== 'STOCK').flatMap(r => r.ids || [])))];
                const hqs = [], fins = [], shops = [];
                for (const id of ids) {
                    const h = await getDoc(doc(db, 'hq_work_orders', id)); if (h.exists()) hqs.push({ id: h.id, ...h.data() });
                    const f = await getDoc(doc(db, 'fin_workorders', id)); if (f.exists()) fins.push({ id: f.id, ...f.data() });
                    const sh = await getDoc(doc(db, 'shop_custom_orders', `SHOP-${id}`)); if (sh.exists()) shops.push({ id: sh.id, ...sh.data() });
                }
                const oeGenAfter = { ...(so.oeGen || {}) };
                hit.forEach(i => { const nx = stampWithoutRunOf(so.oeGen[i], last.no); if (nx) oeGenAfter[i] = nx; else delete oeGenAfter[i]; });
                const rrAfter = { ...rr, boards: Math.max(0, Math.floor(N(last.from))), log: runs.slice(0, -1) };
                const after = { ...so, oeGen: oeGenAfter, rowRelease: { ...(so.rowRelease || {}), [key]: rrAfter } };
                // Nothing in the order's bin (or already shipped) may be left without a release to belong to.
                const gathered = [...new Set(idxs.map(i => soLineCodeOf(so.lines[i])).filter(Boolean))].map(c => {
                    const inEver = N((so.committedQty || {})[c]) + N((so.shippedQty || {})[c]);
                    const stay = soCodeReleasedOf(after, c).total;
                    return inEver > stay ? `${c}: ${inEver} in the order's bin or shipped — only ${stay} would stay released; release them at SO Pack first` : '';
                }).filter(Boolean);
                plan.push({ so, rr, last, hit, hqs, fins, shops, oeGenAfter, rrAfter, gathered, idxs });
            }
            setBusy('');
            if (!plan.length) return alert(`${label} has no release to undo.`);
            const blockers = [...new Set(plan.flatMap(x => [...rowUndoBlockersOf({ hqs: x.hqs, fins: x.fins, shops: x.shops }), ...x.gathered]))];
            const span = releaseLabelOf({ from: plan[0].last.from, to: plan[0].last.to, of: N(draft.qty) });
            if (blockers.length) return alert(`Cannot undo the last release of ${label} (${span}) — work has moved:\n\n${blockers.map(b => `  • ${b}`).join('\n')}\n\nClose or finish it on RTG, where that work is visible.`);
            const docs = plan.flatMap(x => [...x.hqs.map(d => `hq ${d.id}`), ...x.fins.map(d => `floor ${d.id}`), ...x.shops.map(d => `shop ${d.id}`)]);
            if (!window.confirm(`↩ Undo the last release of ${label} — ${span}?\n\nNothing on it has moved. These leave (recorded in the deletion ledger):\n${docs.map(d => `  • ${d}`).join('\n') || '  • (no documents — shelf picks only)'}\n\n${label} goes back to ${Math.floor(N(plan[0].last.from))} of ${N(draft.qty)} released.`)) return;
            setBusy('Undoing the release…');
            const reason = `${label}: ${span} taken back (10.5 ↩ Undo last release)`;
            let final = 0;
            for (const x of plan) {
                for (const d of x.fins) await hardDeleteWithLedger(ctx, { collection: 'fin_workorders', docId: d.id, record: d, kind: 'fin_workorder', by, from: '10.5', reason });
                for (const d of x.shops) await hardDeleteWithLedger(ctx, { collection: 'shop_custom_orders', docId: d.id, record: d, kind: 'shop_custom_order', by, from: '10.5', reason });
                for (const d of x.hqs) await hardDeleteWithLedger(ctx, { collection: 'hq_work_orders', docId: d.id, record: d, kind: 'hq_work_order', by, from: '10.5', reason });
                const patch = {};
                x.hit.forEach(i => { patch[`oeGen.${i}`] = x.oeGenAfter[i] || deleteField(); });
                // A line this row leaves with nothing raised drops the shortfall record its start wrote (OE_ROW).
                const bare = x.idxs.filter(i => !x.oeGenAfter[i]);
                const boLeft = (x.so.backorderLines || []).filter(r => !(r && r.source === 'OE_ROW' && bare.includes(r.lineIndex)));
                if (boLeft.length !== (x.so.backorderLines || []).length) patch.backorderLines = boLeft;
                patch[`rowRelease.${key}`] = (x.rrAfter.boards > 0 || x.rrAfter.log.length) ? x.rrAfter : deleteField();
                patch[`displayRows.${key}`] = deleteField();
                await updateDoc(doc(db, 'hq_sales_orders', x.so.id), patch);
                final = Math.max(final, x.rrAfter.boards);
            }
            const rowReleased = { ...(draft.rowReleased || {}), [key]: final };
            const b = { ...draft, rowReleased, rowsStarted: final > 0 ? (draft.rowsStarted || []) : (draft.rowsStarted || []).filter(r => r !== label), updatedAt: Date.now(), updatedBy: by };
            await setDoc(doc(db, 'system', 'displays', 'builds', b.id), b, { merge: true });
            await writeDemand([...builds.filter(y => y.id !== b.id), b]);
            setDraft(b); setDirty(false);
            alert(`${label}: ${span} taken back — ${docs.length} document(s) removed through the ledger. ${final} of ${N(draft.qty)} released.`);
            await loadFloor(draft);
        } catch (e) { alert('Could not undo the release: ' + (e?.message || e)); }
        setBusy('');
    };

    // ⇄ RELEASE BY COUNT — an order already on the row route goes onto release counts (Shared/rowRelease.countSwitchOf,
    // Stuart 2026-10-06, the wall). Rows already started read fully released and keep their documents; nothing on the
    // floors changes. Each order is read fresh, and the confirm names the rows.
    const switchToCounts = async () => {
        if (!draft || !floor) return;
        const of = Math.floor(N(draft.qty));
        if (!(of > 0)) return alert('The build does not say how many displays it is — set the quantity and save first.');
        const by = String(currentUser || '10.5');
        const now = Date.now();
        setBusy('Reading the orders…');
        try {
            const plans = [];
            for (const s of (floor.sos || []).filter(x => !x.whole)) {
                const fresh = await getDoc(doc(db, 'hq_sales_orders', s.so.id));
                if (!fresh.exists()) continue;
                const so = { id: fresh.id, ...fresh.data() };
                const sw = countSwitchOf({ so, of, by, now });
                if (sw) plans.push({ so, sw });
            }
            setBusy('');
            if (!plans.length) return alert('Every sales order of this build is already released by count.');
            const keys = new Set(plans.flatMap(x => x.sw.rows));
            const labels = [...rowOrder, ORDER_ROW_LABEL].filter(l => keys.has(rowKeyFor(l)));
            if (!window.confirm(countSwitchText({ orders: plans.map(x => x.so.soId || x.so.id), of, rows: labels }))) return;
            setBusy('Switching…');
            for (const x of plans) await updateDoc(doc(db, 'hq_sales_orders', x.so.id), x.sw.patch);
            const rowReleased = { ...(draft.rowReleased || {}) };
            keys.forEach(k => { rowReleased[k] = of; });
            const b = { ...draft, rowReleased, updatedAt: Date.now(), updatedBy: by };
            await setDoc(doc(db, 'system', 'displays', 'builds', b.id), b, { merge: true });
            await writeDemand([...builds.filter(y => y.id !== b.id), b]);
            setDraft(b); setDirty(false);
            await loadFloor(draft);
        } catch (e) { alert('Could not switch: ' + (e?.message || e)); }
        setBusy('');
    };

    // ⟲ RESTART A ROW (Shared/displayRelease.rowRestartPlanOf, Stuart 2026-10-06: "i prefer to restart and just alert the
    // floor not to duplicate"). The row's documents — the finishing documents, shop documents and RTG records its lines
    // name, read by id — are CLOSED through the lifecycle's exact close (state kept, reopenable; never another row's),
    // its lines drop their start records and the row reads 0 of N. Refused while pieces of the row are in the order's
    // bin, or out at the plater. A reason is asked for and stamped on every document closed.
    const restartRow = async (label) => {
        if (!draft || !floor) return;
        const key = rowKeyFor(label);
        const by = String(currentUser || '10.5');
        const ctx = { db, doc, updateDoc, getDoc, getDocs, query, collection, where, deleteDoc, setDoc };
        setBusy('Reading the row…');
        try {
            const plan = [];
            for (const s of (floor.sos || []).filter(x => !x.whole && isReleaseByCount(x.so))) {
                const fresh = await getDoc(doc(db, 'hq_sales_orders', s.so.id));
                if (!fresh.exists()) continue;
                const so = { id: fresh.id, ...fresh.data() };
                const p = rowRestartPlanOf({ so, rowKey: key });
                if (!p.hit.length && !rowReleaseOf(so, key)) continue;
                const records = [], fins = [], shops = [];
                for (const id of p.ids) {
                    const h = await getDoc(doc(db, 'hq_work_orders', id)); if (h.exists()) records.push({ id: h.id, data: h.data() });
                    const f = await getDoc(doc(db, 'fin_workorders', id)); if (f.exists()) fins.push({ id: f.id, data: f.data() });
                    const sh = await getDoc(doc(db, 'shop_custom_orders', `SHOP-${id}`)); if (sh.exists()) shops.push({ id: sh.id, data: sh.data() });
                }
                // Anything of this row still OUT at the plater would come back with no order to belong to.
                const out = [];
                const shopIds = shops.map(x => x.id);
                for (let i = 0; i < shopIds.length; i += 10) {
                    const qs = await getDocs(query(collection(db, 'plating_shipments'), where('shopOrderId', 'in', shopIds.slice(i, i + 10))));
                    qs.docs.forEach(d => { const v = d.data() || {}; if (['staged', 'shipped'].includes(String(v.status || '').toLowerCase())) out.push(`${v.qty || '?'} × ${v.targetErpId || v.erpId || 'a part'} is ${String(v.status).toLowerCase()} at the plater — receive it first, or it comes back with no order to belong to`); });
                }
                plan.push({ so, p, records, fins, shops, out });
            }
            setBusy('');
            if (!plan.length) return alert(`${label} has nothing started — there is nothing to restart.`);
            const blockers = [...new Set(plan.flatMap(x => [...x.p.gathered, ...x.out]))];
            if (blockers.length) return alert(`Cannot restart ${label}:\n\n${blockers.map(b => `  • ${b}`).join('\n')}`);
            const live = (x) => !isClosedState(x.data || {});
            const docs = plan.flatMap(x => [
                ...x.fins.filter(live).map(d => ({ kind: 'floor', id: d.id, text: [d.data.pickOnly ? 'pick only' : `${d.data.currentPhase || 'Setup'}${d.data.machineAssigned ? ` on ${d.data.machineAssigned}` : ''}`, `${N(d.data.totalParts)} pcs`, `pick ${String(d.data.pickStatus || 'Pending').toLowerCase().replace(/_/g, ' ')}`].join(' · ') })),
                ...x.shops.filter(live).map(d => ({ kind: 'shop', id: d.id, text: `${d.data.status || 'Pending'} · ${N(d.data.poles) || N(d.data.qty)} pole(s)` })),
                ...x.records.filter(live).map(d => ({ kind: 'RTG', id: d.id, text: '' })),
            ]);
            const stock = plan.reduce((a, x) => a + x.p.hit.filter(i => String((x.so.oeGen[i] || {}).kind) === 'STOCK').length, 0);
            const why = window.prompt(`${rowRestartText({ label, of: N(draft.qty), docs, stock })}\n\nWhy? (stamped on every document closed)`, 'restarted to release by count');
            if (why === null) return;
            const reason = String(why).trim();
            if (!reason) return alert('A reason is needed — nothing was changed.');
            setBusy('Restarting the row…');
            let closed = 0;
            for (const x of plan) {
                const res = await closeDocsExactly(ctx, { fins: x.fins, shops: x.shops, records: x.records, by, from: '10.5', reason: `${label}: ${reason}`, label: `${label} of ${x.so.soId || x.so.id}` });
                closed += res.fin + res.shop + res.records;
                const patch = {};
                x.p.hit.forEach(i => { patch[`oeGen.${i}`] = deleteField(); });
                if (x.p.boChanged) patch.backorderLines = x.p.backorderLines;
                patch[`rowRelease.${key}`] = deleteField();
                patch[`displayRows.${key}`] = deleteField();
                await updateDoc(doc(db, 'hq_sales_orders', x.so.id), patch);
            }
            const b = { ...draft, rowReleased: { ...(draft.rowReleased || {}), [key]: 0 }, rowsStarted: (draft.rowsStarted || []).filter(r => r !== label), updatedAt: Date.now(), updatedBy: by };
            await setDoc(doc(db, 'system', 'displays', 'builds', b.id), b, { merge: true });
            await writeDemand([...builds.filter(y => y.id !== b.id), b]);
            setDraft(b); setDirty(false);
            alert(`${label} restarted — ${closed} document(s) closed. It reads 0 of ${N(draft.qty)}; tell the floor, then start it for as many displays as you choose.`);
            await loadFloor(draft);
        } catch (e) { alert('Restart stopped partway: ' + (e?.message || e) + '\n\nRead the row again before doing anything else — some documents may already be closed.'); }
        setBusy('');
    };

    // The display's own row order, so the panel reads top to bottom as the board does.
    const linesOf = (s) => (s.rowLines || s.so.lines || []);
    const rowOrder = useMemo(() => {
        const disp = displays.find(d => d.id === draft?.displayId);
        const fromDisplay = disp ? (disp.faces || []).filter(f => f.kind === 'ROWS').flatMap(f => (f.rows || []).map(r => r.label || '')).filter(Boolean) : [];
        const fromLines = [...new Set((floor?.sos || []).flatMap(s => linesOf(s).map(l => rowOfLine(l))).filter(Boolean))];
        return [...new Set([...fromDisplay, ...fromLines])];
    }, [displays, draft?.displayId, floor?.sos]); // eslint-disable-line react-hooks/exhaustive-deps
    const anchored = !!(floor && !floor.loading && (floor.sos || []).length);
    const rowsView = useMemo(() => {
        if (!anchored) return null;
        const byRow = {}; rowOrder.forEach(l => { byRow[l] = []; });
        byRow[ORDER_ROW_LABEL] = [];
        const unassigned = [];
        (floor.sos || []).forEach(s => {
            const soLike = { ...s.so, lines: linesOf(s) };
            const { rows, unassigned: un, orderLines } = soRowsOf(soLike, rowOrder);
            const reviews = {};
            Object.entries(s.so.displayRows || {}).forEach(([, rec]) => ((rec && rec.review) || []).forEach(r => { reviews[r.lineIdx] = r.reasons || []; }));
            const ctx = { so: soLike, links: s.links || { wos: [], pos: [], demands: [] }, shipments: s.shipments || [], whole: s.whole, reviews };
            rowOrder.forEach(l => (rows[l] || []).forEach(e => byRow[l].push({ ...e, ...ctx })));
            (orderLines || []).forEach(e => byRow[ORDER_ROW_LABEL].push({ ...e, ...ctx }));
            un.forEach(e => unassigned.push({ ...e, soAppId: s.so.id, soId: s.so.soId || s.so.id, whole: !!s.whole }));
        });
        const labels = [...rowOrder, ...(byRow[ORDER_ROW_LABEL].length ? [ORDER_ROW_LABEL] : [])];
        // A row of an order released by count carries its count: how many displays are in motion, of how many.
        const countOrders = (floor.sos || []).filter(s => !s.whole).map(s => ({ ...s.so, lines: linesOf(s) }));
        return { rows: labels.map(label => ({ label, state: rowStateOf({ entries: byRow[label] }), count: rowReleaseCountOf({ orders: countOrders, rowKey: rowKeyFor(label), of: N(draft?.qty) }) })), unassigned };
    }, [anchored, floor, rowOrder, draft?.qty]); // eslint-disable-line react-hooks/exhaustive-deps
    const anyAccepted = (floor?.sos || []).some(s => !s.whole && s.so.nsInternalId);
    // The plater's own word for a part line, from its shipments — by the code's base, since the
    // shipment names the core going out and the plated code coming back.
    const baseOf = (c) => String(c || '').toUpperCase().split('/')[0].trim();
    const platerWordOf = (l) => {
        const b = baseOf(l.billedId || l.code);
        if (!b) return '';
        const mine = (floor?.shipments || []).filter(s => baseOf(s.erpId) === b || baseOf(s.targetErpId) === b);
        if (!mine.length) return '';
        const st = mine.map(s => String(s.status || '').toLowerCase());
        const word = st.includes('built') ? 'built back' : st.includes('received') ? 'received' : st.includes('shipped') ? 'at the plater' : st.includes('staged') ? 'staged' : st[0];
        const qty = mine.reduce((s, x) => s + N(x.qty), 0);
        return `${word}${qty ? ` · ${qty}` : ''}`;
    };
    const TONE = { grey: 'var(--ink-soft)', red: '#b02d20', brass: 'var(--brass)', green: '#2e7d32' };
    const ROW_TONE = { NOT_STARTED: 'grey', NEEDS_DECISION: 'red', BACKORDERED: 'red', PARTLY_STARTED: 'brass', ISSUED: 'brass', ON_FLOOR: 'brass', AT_PLATER: 'brass', DONE: 'green', EMPTY: 'grey' };

    const openN = draft ? openBoards(draft) : 0;
    const custOf = (b) => b.customerName || customers.find(c => c.id === b.customerId)?.name || '';
    const nextShip = (b) => (b.shipPlan || []).find(p => N(p.shipped) < N(p.qty))?.date || '';

    // ── list ─────────────────────────────────────────────────────────────────────────────────
    if (!draft) {
        return (
            <div style={{ fontFamily: 'var(--sans)', background: '#fff', border: '1px solid var(--line)', padding: embedded ? '18px 22px' : '24px', marginBottom: embedded ? '24px' : 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
                    <div>
                        <span style={mono}>Sales display boards</span>
                        <h3 style={{ margin: '2px 0 0', fontFamily: 'var(--serif)', fontSize: embedded ? '1.3rem' : '1.6rem', fontWeight: 500, color: 'var(--ink)' }}>Build orders</h3>
                    </div>
                    <span style={{ flex: 1 }} />
                    <span style={mono}>{builds.filter(b => !['COMPLETE', 'CANCELLED'].includes(b.status)).reduce((s, b) => s + openBoards(b), 0)} boards open</span>
                    <button onClick={() => setNewForm({ displayId: displays[0]?.id || '', qty: 50, customerId: '', soNumber: '', poNumber: '' })} disabled={!displays.length} style={btn(true)} title={displays.length ? '' : 'Design a display on 5. Marketing first'}>+ New build order</button>
                </div>
                {newForm && (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '12px', border: '1px solid var(--line)', background: 'var(--paper-2)', marginBottom: '12px', flexWrap: 'wrap' }}>
                        <select value={newForm.displayId} onChange={e => setNewForm({ ...newForm, displayId: e.target.value })} style={inp}>{displays.map(d => <option key={d.id} value={d.id}>{d.name} ({DISPLAY_STYLES[d.style]?.label || d.style})</option>)}</select>
                        <input type="number" min="1" value={newForm.qty} onChange={e => setNewForm({ ...newForm, qty: e.target.value })} style={{ ...inp, width: '80px' }} title="boards" />
                        <select value={newForm.customerId} onChange={e => setNewForm({ ...newForm, customerId: e.target.value })} style={inp}><option value="">— customer —</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                        <input value={newForm.soNumber} onChange={e => setNewForm({ ...newForm, soNumber: e.target.value })} placeholder="Our SO #" style={{ ...inp, width: '120px' }} />
                        <input value={newForm.poNumber} onChange={e => setNewForm({ ...newForm, poNumber: e.target.value })} placeholder="Their PO #" style={{ ...inp, width: '150px' }} />
                        <button onClick={create} disabled={!!busy} style={btn(true)}>Open order</button>
                        <button onClick={() => setNewForm(null)} style={btn(false)}>Cancel</button>
                    </div>
                )}
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>{['Order', 'Customer', 'SO / PO', 'Boards', 'Built', 'Open', 'Next ship', 'Status', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                    <tbody>
                        {builds.length === 0 && <tr><td colSpan={9} style={{ ...td, padding: '18px', fontStyle: 'italic', color: 'var(--ink-soft)' }}>No build orders yet.</td></tr>}
                        {builds.map(b => (
                            <tr key={b.id}>
                                <td style={{ ...td, fontFamily: 'var(--serif)', fontSize: '0.95rem' }}><span onClick={() => open(b)} style={{ cursor: 'pointer', textDecoration: 'underline' }}>{b.name}</span></td>
                                <td style={td}>{custOf(b)}</td>
                                <td style={{ ...td, fontFamily: 'var(--mono)', fontSize: '11px' }}>{b.soNumber || '—'} / {b.poNumber || '—'}</td>
                                <td style={{ ...td, textAlign: 'right' }}>{b.qty}</td>
                                <td style={{ ...td, textAlign: 'right' }}>{N(b.built)}</td>
                                <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{['COMPLETE', 'CANCELLED'].includes(b.status) ? 0 : openBoards(b)}</td>
                                <td style={{ ...td, fontFamily: 'var(--mono)', fontSize: '11px' }}>{nextShip(b) || '—'}</td>
                                <td style={{ ...td, ...mono, color: b.status === 'IN_PRODUCTION' ? 'var(--brass)' : b.status === 'COMPLETE' ? 'green' : 'var(--ink-soft)' }}>{b.status}</td>
                                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}><button onClick={() => open(b)} style={btn(false)}>Open</button> <button onClick={() => remove(b)} style={btn(false, { color: '#b02d20', borderColor: '#b02d20' })}>Delete</button></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    }

    // ── editor ───────────────────────────────────────────────────────────────────────────────
    const parts = draft.lines?.parts || [], chips = draft.lines?.chips || [], extras = draft.lines?.extras || [];
    const plannedShip = (draft.shipPlan || []).reduce((s, p) => s + N(p.qty), 0);
    const shippedN = (draft.shipPlan || []).reduce((s, p) => s + N(p.shipped), 0);
    return (
        <div style={{ fontFamily: 'var(--sans)', background: '#fff', border: '1px solid var(--line)', padding: '20px 24px', marginBottom: embedded ? '24px' : 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
                <button onClick={close} style={btn(false)}>‹ Orders</button>
                <span style={{ fontFamily: 'var(--serif)', fontSize: '1.3rem' }}>{draft.name}</span>
                <span style={mono}>{DISPLAY_STYLES[draft.style]?.label || draft.style} · snapshot {draft.snapshotAt ? new Date(draft.snapshotAt).toLocaleDateString() : '—'}</span>
                <span style={{ flex: 1 }} />
                {busy && <span style={{ ...mono, color: 'var(--brass)' }}>{busy}</span>}
                <span style={{ ...mono, color: dirty ? '#b02d20' : 'var(--ink-soft)' }}>{dirty ? 'unsaved' : 'saved'}</span>
                <button onClick={resnapshot} style={btn(false)} title="Re-take the bill from the display as designed now">⟳ Re-snapshot</button>
                <button onClick={entrySheet} disabled={!!busy || dirty} style={btn(false, { borderColor: 'var(--brass)' })} title="One line per part per row for the whole order — what to enter in CPQ as one sales order (downloads a CSV and copies it)">⬇ CPQ entry sheet</button>
                <button onClick={duplicateBuild} disabled={!!busy || dirty || !anchored} style={btn(false, { borderColor: 'var(--brass)', opacity: (!!busy || dirty || !anchored) ? .5 : 1 })} title={anchored ? 'A NEW build order for the same display and a NEW quote in CPQ, copied from this order\'s quote at the count you give — rows at the prices they carry. Nothing is released.' : 'Anchor a sales order first — its quote is what gets copied'}>⧉ Duplicate for…</button>
                <button onClick={save} disabled={!dirty || !!busy} style={btn(dirty, { opacity: dirty ? 1 : .5 })}>Save order</button>
            </div>

            {/* header */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', marginBottom: '16px' }}>
                {[['Customer', <select value={draft.customerId || ''} onChange={e => { const c = customers.find(x => x.id === e.target.value); mutate(d => ({ ...d, customerId: c?.id || '', customerName: c?.name || '' })); }} style={{ ...inp, width: '100%' }}><option value="">—</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>],
                  ['Our SO #', <input value={draft.soNumber || ''} onChange={e => mutate(d => ({ ...d, soNumber: e.target.value }))} style={{ ...inp, width: '100%' }} />],
                  ['Their PO #', <input value={draft.poNumber || ''} onChange={e => mutate(d => ({ ...d, poNumber: e.target.value }))} style={{ ...inp, width: '100%' }} />],
                  ['Boards ordered', <input type="number" min="1" value={draft.qty} onChange={e => mutate(d => ({ ...d, qty: Math.max(1, N(e.target.value, 1)) }))} style={{ ...inp, width: '100%' }} />],
                  ['Boards built', <input type="number" min="0" value={N(draft.built)} onChange={e => mutate(d => ({ ...d, built: Math.max(0, N(e.target.value, 0)) }))} style={{ ...inp, width: '100%' }} title="Assembled boards — open demand = ordered − built" />],
                  ['Sample bin', <input value={draft.sampleBin ?? (SAMPLE_BIN_BY_STYLE[draft.style] || '')} onChange={e => mutate(d => ({ ...d, sampleBin: e.target.value.toUpperCase() }))} style={{ ...inp, width: '100%', fontFamily: 'var(--mono)' }} title="Where this build's finished pieces are put away until the displays are packed" />],
                  ['Status', <select value={draft.status || 'PLANNED'} onChange={e => mutate(d => ({ ...d, status: e.target.value }))} style={{ ...inp, width: '100%' }}>{STATUS.map(s => <option key={s} value={s}>{s}</option>)}</select>],
                ].map(([l, el]) => <div key={l}><div style={mono}>{l}</div>{el}</div>)}
            </div>
            <div style={{ display: 'flex', gap: '18px', marginBottom: '16px', flexWrap: 'wrap' }}>
                <span style={mono}>Open to build: <b style={{ color: 'var(--ink)' }}>{openN}</b> of {draft.qty}</span>
                <span style={mono}>Shipped: <b style={{ color: 'var(--ink)' }}>{shippedN}</b> · planned {plannedShip}{plannedShip !== N(draft.qty) ? ` (⚠ plan ≠ ${draft.qty})` : ''}</span>
                <span style={mono}>Demand published to Stock View: {(floor?.sos || []).length > 0 && (floor.sos || []).every(x => isReleaseByCount(x.so)) ? 'the order\'s own lines, pieces not yet released' : 'open boards × per board, lines not done, rows not started'}</span>
                <button onClick={publishDemandNow} disabled={!!busy || dirty} style={btn(false, { padding: '2px 10px' })} title="Work the open display demand out again from every open build order and its sales orders, and publish it to Stock View's Display column">⟳ Publish demand</button>
            </div>

            {/* the orders on the floor — several per build; anchored ones read, the typed one offered */}
            {(draft.soNumber || anchoredIdsOf(draft).length > 0 || floor?.lookup) && (
                <div style={{ border: '1px solid var(--line)', background: 'var(--paper-2)', padding: '10px 14px', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
                        <span style={mono}>On the floor</span>
                        {floor?.loading && <span style={{ ...mono, color: 'var(--brass)' }}>reading…</span>}
                        {floor?.error && <span style={{ fontSize: '0.82rem', color: '#b02d20' }}>{floor.error}</span>}
                        {anchored && <span style={{ ...mono, color: 'var(--brass)' }}>⚓ {floor.sos.length} sales order(s) anchored · rows start from here</span>}
                        <span style={{ flex: 1 }} />
                        <input value={addSo} onChange={e => setAddSo(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') lookupSo(); }} placeholder="+ another SO #" disabled={dirty || !!busy}
                            style={{ ...inp, width: '130px', padding: '4px 8px', fontFamily: 'var(--mono)', fontSize: '11px' }} title="A display can span several sales orders — type another one's number and anchor it" />
                        <button onClick={lookupSo} disabled={dirty || !!busy || !String(addSo || '').trim()} style={btn(false, { padding: '4px 10px' })}>Find</button>
                        <button onClick={() => loadFloor(draft)} disabled={dirty || floor?.loading} style={btn(false, { padding: '4px 10px' })} title={dirty ? 'Save the order first' : 'Read the floor again'}>⟳ Refresh</button>
                    </div>
                    {/* each anchored order, with what RTG raised from it */}
                    {(floor?.sos || []).map(s => (
                        <div key={s.so.id} style={{ marginTop: '8px', paddingTop: '6px', borderTop: '1px solid var(--line)' }}>
                            <div style={{ fontSize: '0.85rem' }}>
                                Sales order <b>{s.so.soId || s.so.id}</b>{s.so.soId && s.so.soId !== s.so.id ? <span style={{ color: 'var(--ink-soft)' }}> ({s.so.id})</span> : null} · {s.so.status || '—'}{s.so.customer ? ` · ${s.so.customer}` : ''}
                                {s.whole
                                    ? <>
                                        <span style={{ ...mono, color: 'var(--brass)', marginLeft: '10px' }}>whole-order · split by RTG · managed there</span>
                                        {soIsClosed(s.so)
                                            ? <button onClick={() => reopenForRows(s)} disabled={dirty || !!busy} style={btn(false, { padding: '3px 9px', marginLeft: '10px', color: '#b02d20', borderColor: '#b02d20' })}
                                                title="This order was CLOSED before its rows were started, and its whole-order split never did any work. Reopen the sales order on the row route; the split's documents stay closed, marked retired. Refuses if any work was logged on them.">⟲ Reopen for rows</button>
                                            : <button onClick={() => retireSplit(s)} disabled={dirty || !!busy} style={btn(false, { padding: '3px 9px', marginLeft: '10px', color: '#b02d20', borderColor: '#b02d20' })}
                                                title="Close the whole-order finishing and shop documents (reopenable, through RTG's own close), keep the sales order, and release its rows from here. Refuses if any work has been logged on them.">⟲ Retire the split → release by rows</button>}
                                    </>
                                    : <span style={{ ...mono, color: 'var(--brass)', marginLeft: '10px' }}>⚓ rows start from here{!s.so.nsInternalId ? ' · ⚠ NetSuite has not accepted it yet' : ''}{splitRetiredOf(s.so, s.fin, s.shop) ? ` · split retired (${splitRetiredOf(s.so, s.fin, s.shop).map(d => d.id).join(', ')}) · released by rows` : ''}</span>}
                                {!s.whole && s.so.hqJobId && <button onClick={() => rereadLines(s)} disabled={dirty || !!busy} style={btn(false, { padding: '3px 9px', marginLeft: '10px' })}
                                    title="Re-read this order's lines from its CPQ job: lines gain the fields CPQ's classifier reads, lines the old reader dropped (fees, add-ons) come back. No line moves; nothing is started.">↻ Re-read lines</button>}
                                {!s.whole && lineCodeFixesOf(s.so) && <button onClick={() => fixLineCodes(s)} disabled={dirty || !!busy} style={btn(false, { padding: '3px 9px', marginLeft: '10px', color: '#b02d20', borderColor: '#b02d20' })}
                                    title="Some lines carry the CPQ billing SKU (…/P, …/EP2) as the item, so the route composes the finish twice and finds no stock. Rewrite them as base item + finish.">↻ Fix line codes ({lineCodeFixesOf(s.so).fixed.length})</button>}
                                {!s.whole && needsPackCard(s.so) === 'class' && <button onClick={() => givePackCard(s)} disabled={dirty || !!busy} style={btn(false, { padding: '3px 9px', marginLeft: '10px', color: '#b02d20', borderColor: '#b02d20' })}
                                    title="This order was released by rows before the rule that makes such an order an Order Entry order. Without the stamp the WMS has no SO Pack card for it: its stocked lines are picked by nobody and its finished rows have nothing to hold them together.">📦 Give it its pack card</button>}
                                {!s.whole && needsPackCard(s.so) === 'count' && <button onClick={() => givePackCard(s)} disabled={dirty || !!busy} style={btn(false, { padding: '3px 9px', marginLeft: '10px', color: '#b02d20', borderColor: '#b02d20' })}
                                    title="The pack card's piece count is not the sum of this order's lines — it still carries the count from before the lines were written.">📦 Fix its piece count</button>}
                                {packCardToRemove(s.so, s.whole) && <button onClick={() => removePackCard(s)} disabled={dirty || !!busy} style={btn(false, { padding: '3px 9px', marginLeft: '10px', color: '#b02d20', borderColor: '#b02d20' })}
                                    title="This order is split whole by RTG and packs on its whole-order documents at Packaging Prep. Its SO Pack card is a second pack home with no lines on it.">↩ Remove its pack card</button>}
                                {stalePackCardsOf(s).length > 0 && <button onClick={() => closeStalePackCards(s)} disabled={dirty || !!busy} style={btn(false, { padding: '3px 9px', marginLeft: '10px', color: '#b02d20', borderColor: '#b02d20' })}
                                    title="The retired whole-order split's packing document is still pending in the Packaging tab. This order is released by rows and packs at SO Pack — close it (closed, not deleted).">✕ Close the retired split's pack card ({stalePackCardsOf(s).map(p => p.id).join(', ')})</button>}
                                {!s.links && <span style={{ ...mono, color: '#b02d20', marginLeft: '10px' }}>⚠ could not read its work orders</span>}
                            </div>
                            {(s.fin.length + s.shop.length + s.plating.length + (s.pkg || []).length === 0)
                                ? <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginTop: '4px', fontStyle: 'italic' }}>No floor documents yet.</div>
                                : <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: '4px', fontFamily: 'var(--mono)', fontSize: '11px' }}>
                                    {s.shop.map(d => <span key={d.id}>🔧 {d.id} · {d.status || 'Pending'}{d.nsWoTran ? ` · NS ${d.nsWoTran}` : ''}</span>)}
                                    {s.fin.map(d => <span key={d.id}>{d.pickOnly ? '📦' : '🎨'} {d.id} · {d.pickOnly ? (d.pickStatus || 'Pending') : (d.currentPhase || 'Setup')}{d.packStatus ? ` · ${d.packStatus}` : ''}{d.nsWoTran ? ` · NS ${d.nsWoTran}` : ''}</span>)}
                                    {s.plating.map(d => <span key={d.id}>⚡ {d.woNum || d.id} · {d.status || 'open'}{d.__coll === 'plating_shipments' ? ' (shipment)' : ''}</span>)}
                                    {(s.pkg || []).map(d => <span key={d.id}>📦 {d.id} · {d.status || 'pending'}</span>)}
                                </div>}
                        </div>
                    ))}
                    {/* a resolved sales order that is not anchored yet */}
                    {floor?.lookup && !floor.loading && (
                        <div style={{ marginTop: '8px', paddingTop: '6px', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
                            {floor.lookup.error
                                ? <span style={{ fontSize: '0.82rem', color: '#b02d20' }}>{floor.lookup.error}</span>
                                : <>
                                    <span style={{ fontSize: '0.85rem' }}>Sales order <b>{floor.lookup.so.soId || floor.lookup.so.id}</b> · {floor.lookup.so.status || '—'}{floor.lookup.so.customer ? ` · ${floor.lookup.so.customer}` : ''}{floor.lookup.whole ? <span style={{ ...mono, color: 'var(--brass)', marginLeft: '10px' }}>already split whole by RTG ({wholeOrderText(floor.lookup.whole)})</span> : null}</span>
                                    <span style={{ flex: 1 }} />
                                    <button onClick={() => anchor(floor.lookup)} disabled={dirty || !!busy} style={btn(true, { padding: '4px 10px', borderColor: 'var(--brass)', background: 'var(--brass)' })}
                                        title={dirty ? 'Save the order first' : floor.lookup.whole ? 'Anchor for VISIBILITY: its rows read the whole-order documents; nothing on it can be started from here.' : 'Tie this build to that sales-order document. From then on its rows are started from here, one at a time.'}>
                                        ⚓ {floor.lookup.whole ? 'Anchor (visibility only)' : 'Anchor to this sales order'}</button>
                                </>}
                        </div>
                    )}
                </div>
            )}

            {/* ── ROWS — mission control (Stuart 2026-09-22) ──────────────────────────────────── */}
            {anchored && rowsView && (
                <div style={{ border: '1px solid var(--brass)', padding: '12px 14px', marginBottom: '16px', background: '#fff' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' }}>
                        <span style={{ ...mono, color: 'var(--ink)' }}>Rows — released from here</span>
                        <span style={{ fontSize: '0.78rem', color: 'var(--ink-soft)' }}>Each row starts by the same rules as a CPQ order: plated parts picked from stock (short → the Snapshot Backorder board), painted to finishing, poles to the shop — a plated pole goes on to the plater from there. Work orders land on RTG under this sales order; RTG still governs them.</span>
                        {!anyAccepted && <span style={{ fontSize: '0.78rem', color: '#b02d20' }}>⚠ No anchored sales order that rows can start from has been accepted by NetSuite yet — rows can be read, not started.</span>}
                        {(floor.sos || []).some(s => !s.whole && !isReleaseByCount(s.so)) && (
                            <button onClick={switchToCounts} disabled={!!busy || !!starting || dirty}
                                style={btn(false, { padding: '4px 10px', borderColor: 'var(--brass)', color: 'var(--brass)' })}
                                title="Put this build's sales orders on release counts: each row then starts for as many displays as you ask. Rows already started stay as they are (fully released); restart one with ⟲ Restart row.">⇄ Release by count</button>
                        )}
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead><tr>{['Row', 'Status', 'Lines', '', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                        <tbody>
                            {rowsView.rows.map(({ label, state, count }) => (
                                <React.Fragment key={label}>
                                    <tr>
                                        <td style={{ ...td, fontFamily: 'var(--serif)', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{label}</td>
                                        <td style={{ ...td, ...mono, color: TONE[ROW_TONE[state.key]] || 'var(--ink)', fontWeight: 600 }}>{count.byCount ? `${count.released} of ${count.of} released${count.released > 0 ? ` · ${state.text}` : ''}` : state.text}</td>
                                        <td style={{ ...td, fontSize: '0.78rem', color: 'var(--ink-soft)' }}>{state.lines.length} line(s) · {state.started} started · {state.open} to start{state.stocked ? ` · ${state.stocked} stocked` : ''}</td>
                                        <td style={{ ...td, whiteSpace: 'nowrap' }}>
                                            {/* RELEASED BY COUNT (Shared/rowRelease): start as many of the remaining displays as asked. */}
                                            {count.byCount && count.left > 0 && (() => {
                                                const typed = relN[label];
                                                const n = typed === undefined || typed === '' ? count.left : Math.max(1, Math.min(count.left, Math.floor(N(typed)) || 1));
                                                const off = !!starting || !!busy || dirty || !anyAccepted;
                                                return (<>
                                                    <input type="number" min="1" max={count.left} value={typed === undefined || typed === '' ? count.left : typed}
                                                        onChange={e => setRelN(m => ({ ...m, [label]: e.target.value }))} disabled={off}
                                                        title={`How many of the ${count.left} display(s) of ${label} still unreleased to put in motion now`}
                                                        style={{ ...inp, width: '58px', padding: '4px 6px', marginRight: '4px' }} />
                                                    <span style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', marginRight: '6px' }}>of {count.left} left</span>
                                                    <button onClick={() => startRowByCount(label, state, n)} disabled={off}
                                                        style={btn(true, { padding: '5px 12px', opacity: off ? .5 : 1 })}
                                                        title={dirty ? 'Save the order first' : !anyAccepted ? 'Waits for NetSuite to accept the sales order' : `Start ${n} more display(s) of ${label} — displays ${count.released + 1}${n > 1 ? `–${count.released + n}` : ''} of ${count.of}`}>
                                                        {starting === label ? '…' : `▶ Start ${n}`}
                                                    </button>
                                                </>);
                                            })()}
                                            {count.byCount && count.released > 0 && state.open > 0 && (
                                                <button onClick={() => startRowByCount(label, state, 0)} disabled={!!starting || !!busy || dirty || !anyAccepted}
                                                    style={btn(count.left === 0, { padding: '5px 12px', marginLeft: count.left > 0 ? '6px' : 0, opacity: (!!starting || dirty || !anyAccepted) ? .5 : 1 })}
                                                    title={`Run ${label} again for the ${count.released} display(s) already released — ${state.open} line(s) are still to start`}>
                                                    {starting === label ? '…' : '▶ Try again'}
                                                </button>
                                            )}
                                            {!count.byCount && state.open > 0 && (
                                                <button onClick={() => startRow(label, state)} disabled={!!starting || !!busy || dirty || !anyAccepted}
                                                    style={btn(true, { padding: '5px 12px', opacity: (!!starting || dirty || !anyAccepted) ? .5 : 1 })}
                                                    title={dirty ? 'Save the order first' : !anyAccepted ? 'Waits for NetSuite to accept the sales order' : `Start the ${state.open} line(s) of ${label} not yet raised`}>
                                                    {starting === label ? '…' : state.key === ROW_STATE.NEEDS_DECISION ? '▶ Try again' : '▶ Start row'}
                                                </button>
                                            )}
                                        </td>
                                        <td style={{ ...td, textAlign: 'right' }}>
                                            {count.byCount && count.released > 0 && (
                                                <button onClick={() => undoLastRelease(label)} disabled={!!busy || !!starting}
                                                    style={btn(false, { padding: '5px 10px', marginRight: '6px', color: '#b02d20', borderColor: '#b02d20' })}
                                                    title="Take the row's latest release back — only while nothing on its documents has moved and nothing of it is gathered.">↩ Undo last release</button>
                                            )}
                                            {count.byCount && (count.released > 0 || state.started > 0) && (
                                                <button onClick={() => restartRow(label)} disabled={!!busy || !!starting}
                                                    style={btn(false, { padding: '5px 10px', marginRight: '6px', color: '#b02d20', borderColor: '#b02d20' })}
                                                    title="Close this row's documents (state kept, reopenable) and put the row back to 0 — for a row whose work has already moved. The floor must be told: pieces already made stay where they are.">⟲ Restart row</button>
                                            )}
                                            {!count.byCount && state.lines.some(l => ['FLOOR', 'PARKED', 'STOCKED'].includes(l.key) && !/stocked — picked by the warehouse, not started here/.test(l.text)) && (
                                                <button onClick={() => undoRowStart(label, state)} disabled={!!busy || !!starting}
                                                    style={btn(false, { padding: '5px 10px', marginRight: '6px', color: '#b02d20', borderColor: '#b02d20' })}
                                                    title="Put this row back to NOT STARTED while nothing on its documents has moved, so ▶ Start row writes it under today's rules.">↩ Undo row start</button>
                                            )}
                                            {state.lines.some(l => l.key === 'PLATING') && (
                                                <button onClick={() => undoPlatingStart(label, state)} disabled={!!busy || !!starting}
                                                    style={btn(false, { padding: '5px 10px', marginRight: '6px', color: '#b02d20', borderColor: '#b02d20' })}
                                                    title="Started under the old rule: plated lines went straight to the plater. Cancel those plating demands (nothing has shipped) and restart the row stock-first.">↩ Undo plating start</button>
                                            )}
                                            {state.key === ROW_STATE.NEEDS_DECISION && (
                                                <button onClick={() => { try { const rv = state.lines.filter(l => l.key === 'REVIEW'); const soApp = (rv[0] || {}).soAppId || (floor.sos[0] && floor.sos[0].so.id) || ''; sessionStorage.setItem('hq_oe_review_so', soApp); sessionStorage.setItem('hq_oe_review_lines', JSON.stringify(rv.filter(l => l.soAppId === soApp).map(l => l.lineIdx))); } catch (e) { /* the board still lists it */ } window.dispatchEvent(new CustomEvent('NAVIGATE_TAB', { detail: 'OE_NEEDS' })); }}
                                                    style={btn(false, { padding: '5px 10px', color: '#b02d20', borderColor: '#b02d20' })} title="The lines this row could not start cleanly — decide them on Order Entry Needs">Review →</button>
                                            )}
                                        </td>
                                    </tr>
                                    {state.lines.length > 0 && (
                                        <tr><td style={{ ...td, borderBottom: '1px solid var(--line)' }} /><td colSpan={4} style={{ ...td, paddingTop: 0 }}>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontFamily: 'var(--mono)', fontSize: '10px' }}>
                                                {state.lines.map(l => <span key={`${l.soAppId}|${l.lineIdx}`} title={`${l.soId} · ${l.text}`} style={{ color: TONE[l.tone] || 'var(--ink-soft)' }}>{(floor.sos || []).length > 1 ? `${l.soId} · ` : ''}{l.qty} × {finishedCodeOf(l.erp, l.finish)} — {l.text}{/^kit —/.test(String(l.text || '')) && <button onClick={() => editKitQty(l)} disabled={!!busy || !!starting} title="Change the kit's quantity — the kit and its parts together; 0 takes them off the order" style={{ marginLeft: '4px', padding: '0 4px', fontSize: '9px', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink-soft)', cursor: 'pointer' }}>✎ qty</button>}{/^kit —/.test(String(l.text || '')) && <button onClick={() => editKitFinish(l)} disabled={!!busy || !!starting} title="Change the kit's finish — the kit and its parts change together, only while nothing is raised or gathered for its parts" style={{ marginLeft: '4px', padding: '0 4px', fontSize: '9px', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink-soft)', cursor: 'pointer' }}>✎ finish</button>}{l.key === 'NONE' && (() => { const sl = (((floor.sos || []).find(s => s.so && s.so.id === l.soAppId) || {}).so || {}).lines; const ln = sl && sl[l.lineIdx]; return !!ln && !ln.isKit && !ln.inKit && (ln.perFoot || Number(ln.cutLength) > 0 || /\b(ROD|POLE|TRACK)\b/i.test(String(ln.name || ''))); })() && <button onClick={() => editRodLine(l)} disabled={!!busy || !!starting} title="A rod line: how many rods, the feet billed per rod and the cut length — only while nothing is raised or gathered for it" style={{ marginLeft: '4px', padding: '0 4px', fontSize: '9px', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink-soft)', cursor: 'pointer' }}>✎ rod</button>}{['STOCKED', 'NONE'].includes(l.key) && !/^(kit —|off the order)/.test(String(l.text || '')) && <button onClick={() => editLineQty(l)} disabled={!!busy || !!starting} title="Change this line's quantity — only while nothing is raised or gathered for it" style={{ marginLeft: '4px', padding: '0 4px', fontSize: '9px', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink-soft)', cursor: 'pointer' }}>✎</button>}</span>)}
                                            </div>
                                        </td></tr>
                                    )}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                    {rowsView.unassigned.length > 0 && (
                        <div style={{ marginTop: '10px', padding: '8px 10px', background: '#fdf3f2', border: '1px solid #e8b8b3' }}>
                            <div style={{ ...mono, color: '#b02d20', marginBottom: '4px' }}>{rowsView.unassigned.length} line(s) on the sales order name no row — nothing starts them until they belong to one</div>
                            {rowsView.unassigned.map(({ line, lineIdx, soAppId, soId, whole }) => (
                                <div key={`${soAppId}|${lineIdx}`} style={{ display: 'flex', gap: '10px', alignItems: 'center', fontFamily: 'var(--mono)', fontSize: '11px', padding: '2px 0' }}>
                                    <span>{line.qty} × {line.erp}{line.finishCode ? `/${line.finishCode}` : ''}{line.memo ? ` · "${line.memo}"` : ''} <span style={{ color: 'var(--ink-soft)' }}>· {soId}</span></span>
                                    {whole ? <span style={{ ...mono }}>whole-order · read only</span> : <select value="" onChange={e => e.target.value && assignRow(soAppId, lineIdx, e.target.value)} disabled={!!busy} style={{ ...inp, padding: '2px 6px', fontSize: '11px' }}>
                                        <option value="">— assign to a row —</option>
                                        <option value={ORDER_ROW_LABEL}>{ORDER_ROW_LABEL} — the display's own line (its base)</option>
                                        {rowOrder.map(r => <option key={r} value={r}>{r}</option>)}
                                    </select>}
                                </div>
                            ))}
                        </div>
                    )}
                    {runLog.length > 0 && (
                        <div style={{ marginTop: '10px', maxHeight: '180px', overflowY: 'auto', background: 'var(--paper-2)', border: '1px solid var(--line)', padding: '6px 10px', fontFamily: 'var(--mono)', fontSize: '10px', lineHeight: 1.6 }}>
                            {runLog.map((l, i) => <div key={i} style={{ color: l.level === 'error' ? '#b02d20' : l.level === 'warn' ? 'var(--brass)' : l.level === 'success' ? '#2e7d32' : 'var(--ink)' }}>{l.msg}</div>)}
                        </div>
                    )}
                </div>
            )}

            {/* ship plan */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
                <div style={mono}>Ship plan</div>
                <span style={{ flex: 1 }} />
                <input type="number" min="1" value={fill.perShip} onChange={e => setFill({ ...fill, perShip: e.target.value })} style={{ ...inp, width: '64px', padding: '4px 6px' }} title="boards per shipment" />
                <span style={mono}>every</span>
                <input type="number" min="1" value={fill.everyDays} onChange={e => setFill({ ...fill, everyDays: e.target.value })} style={{ ...inp, width: '54px', padding: '4px 6px' }} />
                <span style={mono}>days from</span>
                <input type="date" value={fill.start} onChange={e => setFill({ ...fill, start: e.target.value })} style={{ ...inp, padding: '4px 6px' }} />
                <button onClick={fillPlan} style={btn(false)}>Fill plan</button>
                <button onClick={() => mutate(d => ({ ...d, shipPlan: [...(d.shipPlan || []), { date: '', qty: 0, shipped: 0 }] }))} style={btn(false)}>+ Row</button>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', margin: '6px 0 18px' }}>
                <thead><tr>{['Ship date', 'Planned', 'Shipped', 'Tracking / note', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                    {(draft.shipPlan || []).length === 0 && <tr><td colSpan={5} style={{ ...td, fontStyle: 'italic', color: 'var(--ink-soft)' }}>No plan yet — fill one above or add rows.</td></tr>}
                    {(draft.shipPlan || []).map((p, i) => (
                        <tr key={i}>
                            <td style={td}><input type="date" value={p.date || ''} onChange={e => mutate(d => ({ ...d, shipPlan: d.shipPlan.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)) }))} style={{ ...inp, padding: '3px 6px' }} /></td>
                            <td style={td}><input type="number" min="0" value={N(p.qty)} onChange={e => mutate(d => ({ ...d, shipPlan: d.shipPlan.map((x, j) => (j === i ? { ...x, qty: N(e.target.value) } : x)) }))} style={{ ...inp, width: '70px', padding: '3px 6px' }} /></td>
                            <td style={td}><input type="number" min="0" value={N(p.shipped)} onChange={e => mutate(d => ({ ...d, shipPlan: d.shipPlan.map((x, j) => (j === i ? { ...x, shipped: N(e.target.value) } : x)) }))} style={{ ...inp, width: '70px', padding: '3px 6px' }} /></td>
                            <td style={td}><input value={p.note || ''} onChange={e => mutate(d => ({ ...d, shipPlan: d.shipPlan.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)) }))} style={{ ...inp, width: '100%', padding: '3px 6px' }} /></td>
                            <td style={td}><button onClick={() => mutate(d => ({ ...d, shipPlan: d.shipPlan.filter((_, j) => j !== i) }))} style={btn(false, { padding: '3px 8px' })}>×</button></td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {/* lines — the tracker's columns */}
            <div style={mono}>Parts — one board × {openN} open boards</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', margin: '6px 0 18px' }}>
                <thead><tr>{['Position', 'Item', 'Finish', 'Per board', 'Order', 'Open', 'On the floor', 'At plater', 'Notes', 'Done'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                    {parts.map(l => (
                        <tr key={l.key} style={{ opacity: l.done ? .55 : 1 }}>
                            <td style={{ ...td, ...mono }}>{(l.rows || []).join(' / ')}</td>
                            <td style={td}><span style={{ fontFamily: 'var(--mono)', fontSize: '11px' }}>{l.billedId || l.code}</span><div style={{ fontSize: '0.76rem', color: 'var(--ink-soft)' }}>{l.name}</div></td>
                            <td style={{ ...td, fontFamily: 'var(--mono)', fontSize: '11px' }}>{l.finishCode}</td>
                            <td style={{ ...td, textAlign: 'right' }}>{l.qtyPerBoard}{l.perFoot ? ` · ${l.feetPerBoard} ft` : ''}</td>
                            <td style={{ ...td, textAlign: 'right' }}>{l.qtyPerBoard * N(draft.qty)}{l.perFoot ? ` · ${l.feetPerBoard * N(draft.qty)} ft` : ''}</td>
                            <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{l.done ? 0 : l.qtyPerBoard * openN}{l.perFoot && !l.done ? ` · ${l.feetPerBoard * openN} ft` : ''}</td>
                            {/* READ FROM THE FLOOR, NOT TYPED (2026-09-22). The typed WO box and the plater
                                dropdown were written by nothing on the floor and read by nothing on it — a
                                parallel record that could only drift. What shows here is what exists. */}
                            <td style={td}>{(floorLinks[l.key] || []).length
                                ? (floorLinks[l.key] || []).map(e => <div key={`${e.kind}${e.id}`} title={`${e.kind} · ${e.status}${e.qty ? ` · ${e.qty}` : ''}`} style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--brass)', whiteSpace: 'nowrap' }}>{e.id} · {e.status}</div>)
                                : <span style={{ ...mono, color: 'var(--ink-faint, #bbb)' }}>{l.woNumber ? `(typed: ${l.woNumber})` : '—'}</span>}</td>
                            <td style={{ ...td, fontFamily: 'var(--mono)', fontSize: '10px' }}>{platerWordOf(l) || <span style={{ color: 'var(--ink-faint, #bbb)' }}>—</span>}</td>
                            <td style={td}><input value={l.notes || ''} onChange={e => setLine('parts', l.key, { notes: e.target.value })} style={{ ...inp, width: '100%', padding: '3px 6px' }} /></td>
                            <td style={{ ...td, textAlign: 'center' }}><input type="checkbox" checked={!!l.done} onChange={e => setLine('parts', l.key, { done: e.target.checked })} title="Pulled / built for the whole order — leaves the demand" /></td>
                        </tr>
                    ))}
                    {chips.map(c => (
                        <tr key={c.key} style={{ opacity: c.done ? .55 : 1 }}>
                            <td style={{ ...td, ...mono }}>Chips</td>
                            <td style={td}><span style={{ fontFamily: 'var(--mono)', fontSize: '11px' }}>CHIP {c.code}</span><div style={{ fontSize: '0.76rem', color: 'var(--ink-soft)' }}>{c.name} · {c.group}</div></td>
                            <td style={{ ...td, fontFamily: 'var(--mono)', fontSize: '11px' }}>{c.code}</td>
                            <td style={{ ...td, textAlign: 'right' }}>{c.qtyPerBoard}</td>
                            <td style={{ ...td, textAlign: 'right' }}>{c.qtyPerBoard * N(draft.qty)}</td>
                            <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{c.done ? 0 : c.qtyPerBoard * openN}</td>
                            <td style={td}><input value={c.woNumber || ''} onChange={e => setLine('chips', c.key, { woNumber: e.target.value })} placeholder="chip run" style={{ ...inp, width: '90px', padding: '3px 6px', fontFamily: 'var(--mono)', fontSize: '11px' }} /></td>
                            <td style={td} />
                            <td style={td}><input value={c.notes || ''} onChange={e => setLine('chips', c.key, { notes: e.target.value })} style={{ ...inp, width: '100%', padding: '3px 6px' }} /></td>
                            <td style={{ ...td, textAlign: 'center' }}><input type="checkbox" checked={!!c.done} onChange={e => setLine('chips', c.key, { done: e.target.checked })} /></td>
                        </tr>
                    ))}
                    {extras.map(x => (
                        <tr key={x.key} style={{ opacity: x.done ? .55 : 1 }}>
                            <td style={{ ...td, ...mono }}>Board</td>
                            <td style={td} colSpan={2}>{x.text}</td>
                            <td style={{ ...td, textAlign: 'right' }}>{x.qtyPerBoard}</td>
                            <td style={{ ...td, textAlign: 'right' }}>{x.qtyPerBoard * N(draft.qty)}</td>
                            <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{x.done ? 0 : x.qtyPerBoard * openN}</td>
                            <td style={td} /><td style={td} />
                            <td style={td}><input value={x.notes || ''} onChange={e => setLine('extras', x.key, { notes: e.target.value })} style={{ ...inp, width: '100%', padding: '3px 6px' }} /></td>
                            <td style={{ ...td, textAlign: 'center' }}><input type="checkbox" checked={!!x.done} onChange={e => setLine('extras', x.key, { done: e.target.checked })} /></td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <div style={mono}>Order notes</div>
            <textarea value={draft.notes || ''} onChange={e => mutate(d => ({ ...d, notes: e.target.value }))} rows={3} style={{ ...inp, width: '100%', marginTop: '4px' }} />
        </div>
    );
};

export default DisplayBuildsPanel;
