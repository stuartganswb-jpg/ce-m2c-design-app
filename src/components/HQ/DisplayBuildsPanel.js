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
import { collection, doc, onSnapshot, setDoc, deleteDoc, updateDoc, query, where, getDoc, getDocs } from 'firebase/firestore';
import { DISPLAY_STYLES, buildLinesFrom, resnapshotLines, displayDemandFrom, shipPlanFill, openBoards, cpqEntryRows, cpqEntryCsv, SAMPLE_BIN_BY_STYLE, floorLinksByLine } from '../Shared/displayBom';
import { linkedDocsOf, identityKeysOf } from '../Shared/orderLifecycle';
import { finishSuffixOf } from '../Shared/finishRouting.js';
// ── MISSION CONTROL (Stuart 2026-09-22): rows are started FROM HERE, through Order Entry's one
// generator scoped to a row, and read back from the floor. Shared/displayRelease says how.
import { rowKeyOf, rowOfLine, rowLinesFromBreakdown, soRowsOf, rowStateOf, displayAnchorPatch, soNeedsLines, rowStartText, ROW_STATE } from '../Shared/displayRelease';
import { runOeAuto, oeInventoryOf, loadOeLinks } from '../Shared/oeGenerate';

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
    const writeDemand = async (all) => {
        const brand = activeBrand || 'ALL';
        const dem = displayDemandFrom(all.filter(b => !b.brandId || b.brandId === brand));
        await setDoc(doc(db, 'system', `display_demand_${brand}`), { ...dem, brandId: brand, updatedAt: Date.now(), updatedBy: String(currentUser || '') });
    };

    const open = (b) => { setDraft(JSON.parse(JSON.stringify(b))); setDirty(false); };
    const close = () => { if (dirty && !window.confirm('Discard unsaved changes to this build order?')) return; setDraft(null); setDirty(false); };
    const mutate = (fn) => { setDraft(d => fn({ ...d })); setDirty(true); };
    const setLine = (group, key, patch) => mutate(d => ({ ...d, lines: { ...d.lines, [group]: (d.lines?.[group] || []).map(l => (l.key === key ? { ...l, ...patch } : l)) } }));

    const create = async () => {
        const disp = displays.find(d => d.id === newForm?.displayId);
        if (!disp) return alert('Pick the display this order builds.');
        const qty = N(newForm.qty, 0);
        if (!(qty > 0)) return alert('How many boards?');
        const cust = customers.find(c => c.id === newForm.customerId);
        const id = `BUILD-${String(disp.name || disp.id).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Date.now().toString().slice(-5)}`;
        const b = {
            id, displayId: disp.id, displayName: disp.name, style: disp.style, brandId: activeBrand || '',
            name: `${disp.name} × ${qty}${cust ? ` — ${cust.name}` : ''}`,
            customerId: cust?.id || '', customerName: cust?.name || '', soNumber: String(newForm.soNumber || '').trim(), poNumber: String(newForm.poNumber || '').trim(),
            qty, built: 0, status: 'PLANNED', shipPlan: [], notes: '', sampleBin: SAMPLE_BIN_BY_STYLE[disp.style] || '',
            lines: buildLinesFrom(disp, finishList, flows), snapshotAt: Date.now(),
            createdAt: Date.now(), createdBy: String(currentUser || ''), updatedAt: Date.now(), updatedBy: String(currentUser || ''),
        };
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

    // ── THE ORDER ON THE FLOOR (Stuart 2026-09-17: "the work order#s should just appear there") ──
    // Our SO # → the CPQ sales order → every floor document RTG raised from it (Shared/orderLifecycle
    // .linkedDocsOf, the same lookup RTG's closer uses) + the plater's demands and shipment lines.
    // Read-only; nothing here writes.
    const [floor, setFloor] = useState(null);       // { loading, so, fin[], shop[], plating[], links, shipments[], error, forSo }
    const loadFloor = async (soNumber, soAppId = '') => {
        const v = String(soNumber || '').trim();
        const anchored = String(soAppId || '').trim();
        if (!v && !anchored) { setFloor(null); return; }
        setFloor({ loading: true, forSo: v || anchored, fin: [], shop: [], plating: [], links: null, shipments: [] });
        try {
            const salesOrders = collection(db, 'hq_sales_orders');
            let so = null;
            // ANCHORED: the build names the sales-order DOCUMENT, so there is nothing to search for.
            if (anchored) {
                const snap = await getDoc(doc(db, 'hq_sales_orders', anchored));
                if (snap.exists() && !(snap.data() || {}).deleted) so = { id: snap.id, ...snap.data() };
            }
            if (!so && v) {
                const direct = await getDoc(doc(db, 'hq_sales_orders', v));
                if (direct.exists()) so = { id: direct.id, ...direct.data() };
            }
            const tries = v ? [v, /^\d+$/.test(v) ? `SO${v}` : null, `SO-APP-${v}`].filter(Boolean) : [];
            for (const t of tries) {
                if (so) break;
                for (const field of ['soId', 'id']) {
                    const qs = await getDocs(query(salesOrders, where(field, '==', t)));
                    const hit = qs.docs.find(d => !(d.data() || {}).deleted);
                    if (hit) { so = { id: hit.id, ...hit.data() }; break; }
                }
            }
            if (!so) { setFloor({ loading: false, forSo: v || anchored, fin: [], shop: [], plating: [], links: null, shipments: [], error: anchored ? `The anchored sales order (${anchored}) no longer exists.` : `No sales order found for "${v}" — type the SO number as RTG shows it.` }); return; }
            // THE ROW ROUTE'S OWN LINKS: everything ever raised for this order (the strict reading, so
            // a finished row is not re-offered), and the plater's shipments, which carry the demand's
            // PLW number — how a plated line is followed staged → shipped → received → built.
            let links = null, shipments = [];
            try { links = (await loadOeLinks([so.id], { all: true }))[so.id] || null; } catch (e) { /* the row panel says it could not read */ }
            try { shipments = (await getDocs(query(collection(db, 'plating_shipments'), where('soAppId', '==', so.id)))).docs.map(d => ({ id: d.id, ...d.data() })); } catch (e) { /* likewise */ }
            const docs = await linkedDocsOf({ db, doc, getDoc, getDocs, query, collection, where }, so, 'sales');
            const keys = [...new Set([...identityKeysOf(so), ...docs.fin.keys(), ...docs.shop.keys()])].slice(0, 10);
            const plating = [];
            for (const [coll, field] of [['plating_demand', 'orderKey'], ['plating_demand', 'shopOrderId'], ['plating_shipments', 'orderKey'], ['plating_shipments', 'shopOrderId']]) {
                try {
                    const qs = await getDocs(query(collection(db, coll), where(field, 'in', keys)));
                    qs.docs.forEach(d => { if (!plating.some(p => p.id === d.id)) plating.push({ id: d.id, __coll: coll, ...d.data() }); });
                } catch (e) { /* a missing index or field: the rest still shows */ }
            }
            setFloor({
                loading: false, forSo: v || anchored, so,
                fin: [...docs.fin.entries()].map(([id, d]) => ({ id, ...d })),
                shop: [...docs.shop.entries()].map(([id, d]) => ({ id, ...d })),
                plating, links, shipments,
            });
        } catch (e) { setFloor({ loading: false, forSo: v || anchored, fin: [], shop: [], plating: [], links: null, shipments: [], error: e?.message || String(e) }); }
    };
    useEffect(() => { if (draft && !dirty) loadFloor(draft.soNumber, draft.soAppId); else if (!draft) setFloor(null); }, [draft?.id, draft?.soNumber, draft?.soAppId, dirty]); // eslint-disable-line react-hooks/exhaustive-deps
    const floorLinks = useMemo(() => (floor && !floor.loading && draft ? floorLinksByLine(draft.lines?.parts || [], floor) : {}), [floor, draft]);

    // ── THE ANCHOR: this build ⇄ that sales-order document ─────────────────────────────────────
    // Written once. A CPQ order gets its `lines[]` here — one per physical part per row, from the
    // job's breakdown, in Order Entry's shape — because that is the only way it can join the row
    // route; an Order Entry order already has them. Both get `displayRelease` (RTG's whole-order
    // split and the automatic start stand down) and `finishAsAvailable` (rows release alone).
    const anchor = async () => {
        const so = floor?.so;
        if (!so || !draft) return;
        let lines = null;
        if (soNeedsLines(so)) {
            if (!so.hqJobId) return alert('This sales order has no lines and no CPQ job to read them from — nothing to anchor to.');
            const job = await getDoc(doc(db, 'jobs', so.hqJobId));
            const breakdown = job.exists() ? ((job.data().cpqData || {}).breakdown || []) : [];
            lines = rowLinesFromBreakdown(breakdown);
            if (!lines.length) return alert(`The CPQ job ${so.hqJobId} has no physical lines in its breakdown — nothing to anchor to.`);
        }
        const rowsSeen = new Set((lines || so.lines || []).map(l => rowOfLine(l)).filter(Boolean));
        const unnamed = (lines || so.lines || []).filter(l => !rowOfLine(l)).length;
        if (!window.confirm(`Anchor "${draft.name}" to sales order ${so.soId || so.id}?\n\n`
            + (lines ? `${lines.length} line(s) will be written on the sales order from its CPQ breakdown, across ${rowsSeen.size} row(s)${unnamed ? ` — ${unnamed} name no row and will show as unassigned` : ''}.\n\n` : `Its ${(so.lines || []).length} existing line(s) are used as they are${unnamed ? ` — ${unnamed} name no row and will show as unassigned` : ''}.\n\n`)
            + 'From then on this order\'s rows are started HERE, one at a time. RTG will not split it as a whole and will not auto-start it; every work order still lands on RTG under this order.')) return;
        setBusy('Anchoring…');
        try {
            await updateDoc(doc(db, 'hq_sales_orders', so.id), displayAnchorPatch({ buildId: draft.id, lines }));
            const b = { ...draft, soAppId: so.id, soNumber: draft.soNumber || so.soId || so.id, updatedAt: Date.now(), updatedBy: String(currentUser || '') };
            await setDoc(doc(db, 'system', 'displays', 'builds', b.id), b, { merge: true });
            setDraft(b); setDirty(false);
            await loadFloor(b.soNumber, b.soAppId);
        } catch (e) { alert('Anchor failed: ' + (e?.message || e)); }
        setBusy('');
    };

    // ── A LINE THAT NAMES NO ROW is told which one (the operator's call, recorded on the line) ──
    const assignRow = async (lineIdx, label) => {
        const so = floor?.so;
        if (!so) return;
        setBusy('Assigning…');
        try {
            const fresh = await getDoc(doc(db, 'hq_sales_orders', so.id));
            const cur = (fresh.data() || {}).lines || [];
            if (!cur[lineIdx]) throw new Error('that line is no longer on the sales order');
            const next = cur.map((l, i) => (i === lineIdx ? { ...l, row: label } : l));
            await updateDoc(doc(db, 'hq_sales_orders', so.id), { lines: next });
            await loadFloor(draft.soNumber, draft.soAppId);
        } catch (e) { alert('Could not assign the row: ' + (e?.message || e)); }
        setBusy('');
    };

    // ── ▶ START A ROW — Order Entry's generator, scoped to this row's lines ─────────────────────
    const [runLog, setRunLog] = useState([]);
    const [starting, setStarting] = useState('');
    const libraryRef = React.useRef(null);
    const startRow = async (label, state) => {
        const so = floor?.so;
        if (!so || !draft) return;
        if (!window.confirm(rowStartText(label, state))) return;
        setStarting(label); setRunLog([]);
        const log = (msg, level = 'info') => setRunLog(l => [...l, { msg, level }]);
        try {
            if (!libraryRef.current) {
                log('Reading the Master Library…');
                const snap = await getDocs(collection(db, 'Approved_Designs'));
                libraryRef.current = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            }
            const inventory = oeInventoryOf(libraryRef.current, activeBrand);
            const fresh = await getDoc(doc(db, 'hq_sales_orders', so.id));
            const soNow = { id: fresh.id, ...fresh.data() };
            const key = rowKeyOf(label);
            const res = await runOeAuto({
                so: soNow, brand: activeBrand, user: currentUser || '10.5', inventory, log,
                only: (line) => rowKeyOf(rowOfLine(line)) === key,
                slot: `displayRows.${key}`,
            });
            if (res.state === 'SKIPPED') log(`${label}: another session is already starting it, or it was answered for exactly these lines — nothing done.`, 'warn');
            else log(`${label}: ${res.ran} started · ${res.review.length} line(s) need a decision.`, res.review.length ? 'warn' : 'success');
            if (res.ran > 0) {
                const rowsStarted = [...new Set([...(draft.rowsStarted || []), label])];
                const b = { ...draft, rowsStarted, status: draft.status === 'PLANNED' ? 'IN_PRODUCTION' : draft.status, updatedAt: Date.now(), updatedBy: String(currentUser || '') };
                await setDoc(doc(db, 'system', 'displays', 'builds', b.id), b, { merge: true });
                await writeDemand([...builds.filter(x => x.id !== b.id), b]);
                setDraft(b); setDirty(false);
            }
            await loadFloor(draft.soNumber, draft.soAppId);
        } catch (e) { log(`${label}: failed — ${e?.message || e}`, 'error'); }
        setStarting('');
    };

    // The display's own row order, so the panel reads top to bottom as the board does.
    const rowOrder = useMemo(() => {
        const disp = displays.find(d => d.id === draft?.displayId);
        const fromDisplay = disp ? (disp.faces || []).filter(f => f.kind === 'ROWS').flatMap(f => (f.rows || []).map(r => r.label || '')).filter(Boolean) : [];
        const fromLines = [...new Set(((floor?.so?.lines) || []).map(l => rowOfLine(l)).filter(Boolean))];
        return [...new Set([...fromDisplay, ...fromLines])];
    }, [displays, draft?.displayId, floor?.so]);
    const anchored = !!(draft?.soAppId && floor?.so && floor.so.id === draft.soAppId);
    const rowsView = useMemo(() => {
        if (!anchored || floor.loading) return null;
        const so = floor.so;
        const { rows, unassigned } = soRowsOf(so, rowOrder);
        const reviewsOf = (label) => {
            const rec = (so.displayRows || {})[rowKeyOf(label)];
            const out = {};
            ((rec && rec.review) || []).forEach(r => { out[r.lineIdx] = r.reasons || []; });
            return out;
        };
        return {
            rows: rowOrder.map(label => ({ label, state: rowStateOf({ so, entries: rows[label] || [], links: floor.links || { wos: [], pos: [], demands: [] }, shipments: floor.shipments || [], reviews: reviewsOf(label) }) })),
            unassigned,
        };
    }, [anchored, floor, rowOrder]);
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
                <span style={mono}>Demand published to the Sales Snapshot: open boards × per board, lines not done, rows not started</span>
            </div>

            {/* the order on the floor — read-only, from Our SO # */}
            {draft.soNumber && (
                <div style={{ border: '1px solid var(--line)', background: 'var(--paper-2)', padding: '10px 14px', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
                        <span style={mono}>On the floor</span>
                        {floor?.loading && <span style={{ ...mono, color: 'var(--brass)' }}>reading…</span>}
                        {floor?.so && <span style={{ fontSize: '0.85rem' }}>Sales order <b>{floor.so.soId || floor.so.id}</b>{floor.so.soId && floor.so.soId !== floor.so.id ? <span style={{ color: 'var(--ink-soft)' }}> ({floor.so.id})</span> : null} · {floor.so.status || '—'}{floor.so.customer ? ` · ${floor.so.customer}` : ''}</span>}
                        {floor?.error && <span style={{ fontSize: '0.82rem', color: '#b02d20' }}>{floor.error}</span>}
                        <span style={{ flex: 1 }} />
                        {floor?.so && !floor.loading && !anchored && (
                            <button onClick={anchor} disabled={dirty || !!busy} style={btn(true, { padding: '4px 10px', borderColor: 'var(--brass)', background: 'var(--brass)' })}
                                title={dirty ? 'Save the order first' : 'Tie this build to that sales-order document. From then on its rows are started from here, one at a time.'}>⚓ Anchor to this sales order</button>
                        )}
                        {anchored && <span style={{ ...mono, color: 'var(--brass)' }}>⚓ anchored · rows start from here</span>}
                        <button onClick={() => loadFloor(draft.soNumber, draft.soAppId)} disabled={dirty || floor?.loading} style={btn(false, { padding: '4px 10px' })} title={dirty ? 'Save the order first' : 'Read the floor again'}>⟳ Refresh</button>
                    </div>
                    {floor?.so && !floor.loading && (floor.fin.length + floor.shop.length + floor.plating.length === 0
                        ? <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginTop: '6px', fontStyle: 'italic' }}>No floor documents yet — RTG raises them when it splits the order.</div>
                        : <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: '6px', fontFamily: 'var(--mono)', fontSize: '11px' }}>
                            {floor.shop.map(d => <span key={d.id}>🔧 {d.id} · {d.status || 'Pending'}{d.nsWoTran ? ` · NS ${d.nsWoTran}` : ''}</span>)}
                            {floor.fin.map(d => <span key={d.id}>{d.pickOnly ? '📦' : '🎨'} {d.id} · {d.pickOnly ? (d.pickStatus || 'Pending') : (d.currentPhase || 'Setup')}{d.packStatus ? ` · ${d.packStatus}` : ''}{d.nsWoTran ? ` · NS ${d.nsWoTran}` : ''}</span>)}
                            {floor.plating.map(d => <span key={d.id}>⚡ {d.woNum || d.id} · {d.status || 'open'}{d.__coll === 'plating_shipments' ? ' (shipment)' : ''}</span>)}
                        </div>)}
                </div>
            )}

            {/* ── ROWS — mission control (Stuart 2026-09-22) ──────────────────────────────────── */}
            {anchored && rowsView && (
                <div style={{ border: '1px solid var(--brass)', padding: '12px 14px', marginBottom: '16px', background: '#fff' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' }}>
                        <span style={{ ...mono, color: 'var(--ink)' }}>Rows — released from here</span>
                        <span style={{ fontSize: '0.78rem', color: 'var(--ink-soft)' }}>Each row starts through the same route as any order: plated to the plater, painted to finishing, custom to the shop. Work orders land on RTG under this sales order; RTG still governs them.</span>
                        {!floor.so.nsInternalId && <span style={{ fontSize: '0.78rem', color: '#b02d20' }}>⚠ NetSuite has not accepted this sales order yet — rows can be read but not started until it has.</span>}
                        {!floor.links && <span style={{ fontSize: '0.78rem', color: '#b02d20' }}>⚠ Could not read this order's work orders — status may be incomplete.</span>}
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead><tr>{['Row', 'Status', 'Lines', '', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                        <tbody>
                            {rowsView.rows.map(({ label, state }) => (
                                <React.Fragment key={label}>
                                    <tr>
                                        <td style={{ ...td, fontFamily: 'var(--serif)', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{label}</td>
                                        <td style={{ ...td, ...mono, color: TONE[ROW_TONE[state.key]] || 'var(--ink)', fontWeight: 600 }}>{state.text}</td>
                                        <td style={{ ...td, fontSize: '0.78rem', color: 'var(--ink-soft)' }}>{state.lines.length} line(s) · {state.started} started · {state.open} to start{state.stocked ? ` · ${state.stocked} stocked` : ''}</td>
                                        <td style={{ ...td, whiteSpace: 'nowrap' }}>
                                            {state.open > 0 && (
                                                <button onClick={() => startRow(label, state)} disabled={!!starting || !!busy || dirty || !floor.so.nsInternalId}
                                                    style={btn(true, { padding: '5px 12px', opacity: (!!starting || dirty || !floor.so.nsInternalId) ? .5 : 1 })}
                                                    title={dirty ? 'Save the order first' : !floor.so.nsInternalId ? 'Waits for NetSuite to accept the sales order' : `Start the ${state.open} line(s) of ${label} not yet raised`}>
                                                    {starting === label ? '…' : '▶ Start row'}
                                                </button>
                                            )}
                                        </td>
                                        <td style={{ ...td, textAlign: 'right' }}>
                                            {state.key === ROW_STATE.NEEDS_DECISION && (
                                                <button onClick={() => { try { sessionStorage.setItem('hq_oe_review_so', floor.so.id); } catch (e) { /* the board still lists it */ } window.dispatchEvent(new CustomEvent('NAVIGATE_TAB', { detail: 'OE_NEEDS' })); }}
                                                    style={btn(false, { padding: '5px 10px', color: '#b02d20', borderColor: '#b02d20' })} title="The lines this row could not start cleanly — decide them on Order Entry Needs">Review →</button>
                                            )}
                                        </td>
                                    </tr>
                                    {state.lines.length > 0 && (
                                        <tr><td style={{ ...td, borderBottom: '1px solid var(--line)' }} /><td colSpan={4} style={{ ...td, paddingTop: 0 }}>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontFamily: 'var(--mono)', fontSize: '10px' }}>
                                                {state.lines.map(l => <span key={l.lineIdx} title={l.text} style={{ color: TONE[l.tone] || 'var(--ink-soft)' }}>{l.qty} × {l.erp}{l.finish ? `/${l.finish}` : ''} — {l.text}</span>)}
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
                            {rowsView.unassigned.map(({ line, lineIdx }) => (
                                <div key={lineIdx} style={{ display: 'flex', gap: '10px', alignItems: 'center', fontFamily: 'var(--mono)', fontSize: '11px', padding: '2px 0' }}>
                                    <span>{line.qty} × {line.erp}{line.finishCode ? `/${line.finishCode}` : ''}{line.memo ? ` · "${line.memo}"` : ''}</span>
                                    <select value="" onChange={e => e.target.value && assignRow(lineIdx, e.target.value)} disabled={!!busy} style={{ ...inp, padding: '2px 6px', fontSize: '11px' }}>
                                        <option value="">— assign to a row —</option>
                                        {rowOrder.map(r => <option key={r} value={r}>{r}</option>)}
                                    </select>
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
