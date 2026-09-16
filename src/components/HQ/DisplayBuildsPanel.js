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
// RAISING THE WORK (Stuart 2026-09-16): ⚙ Raise work orders splits every part line by its row and
// hands each (line × row) to the SAME stock writers every other door uses — Shared/workOrderCreate
// .parkWorkOrder (finishing / shop, parked in RTG, the component pre-check first) and
// Shared/platingDemand.issuePlatedDemand (plated: the WMS Plating tab and the weekly plater PO). No
// route, floor document or purchase order is decided here: "i want the work orders to flow like
// usual". What IS written here is the management record — each raised id on its line and row.

import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../../firebase';
import { collection, doc, onSnapshot, setDoc, deleteDoc, query, where, getDocs } from 'firebase/firestore';
import { DISPLAY_STYLES, buildLinesFrom, resnapshotLines, displayDemandFrom, shipPlanFill, openBoards, raisePlan, SAMPLE_BIN_BY_STYLE } from '../Shared/displayBom';
import { routeForCode } from '../Shared/stockRun.js';
import { finishSuffixOf, millBaseOf } from '../Shared/finishRouting.js';
import { parkWorkOrder, INTENT, ParkRefusal } from '../Shared/workOrderCreate';
import { issuePlatedDemand } from '../Shared/platingDemand';
import { runBatchPrecheck } from '../Shared/finishedRunPrecheck';
import { isAssemblyPart, fetchAvailability } from '../Shared/finishedGoodsRun.js';
import { BRAND_NETSUITE_MAP } from '../Shared/brandNetsuite';

const mono = { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-soft)' };
const btn = (on, extra = {}) => ({ padding: '8px 14px', border: `1px solid ${on ? 'var(--ink)' : 'var(--line)'}`, background: on ? 'var(--ink)' : '#fff', color: on ? '#fff' : 'var(--ink)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', ...extra });
const inp = { padding: '7px 9px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.88rem', outline: 'none', background: '#fff' };
const td = { padding: '5px 7px', borderBottom: '1px solid var(--line)', fontSize: '0.82rem', verticalAlign: 'top' };
const th = { ...mono, padding: '6px 7px', textAlign: 'left', borderBottom: '1px solid var(--line)' };
const STATUS = ['PLANNED', 'IN_PRODUCTION', 'COMPLETE', 'CANCELLED'];
const PLATER = ['', 'N/A', 'Sent', 'Completed'];
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
    const [raise, setRaise] = useState(null);       // the ⚙ Raise work orders review: { boards, reqDate, items, parts, pick, log, running, done }

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

    // ── ⚙ RAISE WORK ORDERS ─────────────────────────────────────────────────────────────────
    const locationId = (BRAND_NETSUITE_MAP[activeBrand] || {}).location || '17';
    const libraryFor = async (codes) => {
        const want = [...new Set(codes.map(c => String(c || '').toUpperCase()).filter(Boolean))];
        const out = [];
        for (let i = 0; i < want.length; i += 30) {
            const snap = await getDocs(query(collection(db, 'Approved_Designs'), where('legacyErpId', 'in', want.slice(i, i + 30))));
            snap.docs.forEach(d => out.push({ id: d.id, ...d.data() }));
        }
        return out;
    };
    const openRaise = async () => {
        if (!draft) return;
        if (dirty) return alert('Save the order first — the raise records its work orders on the saved order.');
        const plan = raisePlan(draft, { boards: draft.qty, routeOf: routeForCode, finishSuffixOf });
        if (plan.missingByRow.length) return alert(`This order was snapshotted before lines were split by row (${plan.missingByRow.length} line(s)).\n\nPress ⟳ Re-snapshot, Save order, then raise. Typed columns stay.`);
        setBusy('Reading the library…');
        try {
            const parts = await libraryFor(plan.items.flatMap(i => [i.target, i.kind === 'PLATING' ? millBaseOf(i.target) : '']));
            const partOf = (c) => parts.find(p => String(p.legacyErpId || p.itemId || '').toUpperCase() === String(c).toUpperCase()) || null;
            const items = plan.items.map(i => ({
                ...i,
                hasPart: i.kind === 'PLATING' ? true : !!partOf(i.target),
                ready: !i.raised && (i.kind === 'PLATING' || ((i.kind === 'FINISHING' || i.kind === 'SHOP') && !!partOf(i.target))),
            }));
            // A per-foot rod is raised in PIECES of its code — unchecked until the operator has looked.
            const pick = Object.fromEntries(items.map(i => [i.key, i.ready && !i.perFoot && !i.check]));
            const firstShip = (draft.shipPlan || []).map(p => p.date).filter(Boolean).sort()[0] || '';
            setRaise({ boards: N(draft.qty), reqDate: firstShip || new Date(Date.now() + 12096e5).toISOString().split('T')[0], items, parts, pick, log: [], running: false, done: false });
        } catch (e) { alert('Library read failed: ' + (e?.message || e)); }
        setBusy('');
    };
    const setRaiseBoards = (b) => setRaise(r => {
        const plan = raisePlan(draft, { boards: b, routeOf: routeForCode, finishSuffixOf });
        const byKey = Object.fromEntries(plan.items.map(i => [i.key, i.qty]));
        return { ...r, boards: N(b), items: r.items.map(i => ({ ...i, qty: byKey[i.key] ?? i.qty })) };
    });
    const runRaise = async () => {
        const r = raise; if (!r || r.running) return;
        const chosen = r.items.filter(i => r.pick[i.key] && !i.raised && i.qty > 0);
        if (!chosen.length) return alert('Nothing ticked to raise.');
        const nWo = chosen.filter(i => i.kind === 'FINISHING' || i.kind === 'SHOP').length, nPl = chosen.filter(i => i.kind === 'PLATING').length;
        if (!window.confirm(`Raise for ${draft.name}:\n\n• ${nWo} work order(s) — parked in RTG, released on their own when their gates clear\n• ${nPl} plating demand(s) — WMS Plating tab, the weekly plater shipment\n\n${r.boards} boards · required ${r.reqDate} · sample bin ${draft.sampleBin || '—'}\n\nThese are real orders on the floor. Continue?`)) return;
        setRaise(x => ({ ...x, running: true, log: [] }));
        const say = (m) => setRaise(x => ({ ...x, log: [...x.log, m] }));
        const partOf = (c) => r.parts.find(p => String(p.legacyErpId || p.itemId || '').toUpperCase() === String(c).toUpperCase()) || null;
        const by = String(currentUser || '');
        const tag = (i) => `Display ${draft.displayName} · ${draft.soNumber ? `SO ${draft.soNumber} · ` : ''}${i.row} · ${r.boards} boards${draft.sampleBin ? ` → bin ${draft.sampleBin}` : ''}${i.perFoot ? ` · rod ${i.cutLength ? `${i.cutLength}" cut` : ''}${i.feetPerBoard ? ` ${i.feetPerBoard} ft/board` : ''}` : ''}`;
        let lines = JSON.parse(JSON.stringify(draft.lines));
        const record = async (i, entry) => {
            lines = { ...lines, parts: lines.parts.map(l => {
                if (l.key !== i.lineKey) return l;
                const raised = [...(l.raised || []).filter(x => x.row !== i.row), entry];
                const ids = raised.map(x => x.woNum || x.id).filter(Boolean);
                return { ...l, raised, woNumber: [...new Set(ids)].join(', ') };
            }) };
            await setDoc(doc(db, 'system', 'displays', 'builds', draft.id), { lines, updatedAt: Date.now(), updatedBy: by }, { merge: true });
        };
        // the component pre-check for the work orders, once, as the Stock View grid runs it
        const woItems = chosen.filter(i => i.kind === 'FINISHING' || i.kind === 'SHOP');
        const preByKey = new Map();
        const pinsByKey = new Map();
        for (const i of woItems) {
            const part = partOf(i.target);
            if (part && isAssemblyPart(part)) {
                try { const ps = await getDocs(query(collection(db, 'assembly_pins'), where('assemblyId', '==', part.itemId))); pinsByKey.set(i.key, ps.docs.map(d => d.data())); }
                catch (e) { say(`⚠ ${i.target}: BOM pins not read (${e.message || e})`); }
            }
        }
        const checkRows = woItems.filter(i => !/\/P$/.test(i.target) && (isAssemblyPart(partOf(i.target)) || i.finish));
        if (checkRows.length) {
            try {
                const pre = await runBatchPrecheck({ rows: checkRows.map(i => ({ key: i.key, part: partOf(i.target), qty: i.qty, pins: pinsByKey.get(i.key) || [] })), inventory: r.parts, locationId });
                if (pre.nsError) say(`⚠ Component pre-check skipped — NetSuite unreachable (${String(pre.nsError).slice(0, 120)}). Verify component stock manually.`);
                else pre.results.forEach(x => preByKey.set(x.key, x));
            } catch (e) { say(`⚠ Component pre-check failed: ${e.message || e}`); }
        }
        // core stock for the plated lines, one read
        const platedItems = chosen.filter(i => i.kind === 'PLATING');
        let coreAvail = null;
        if (platedItems.length) {
            try { coreAvail = await fetchAvailability([...new Set(platedItems.map(i => millBaseOf(i.target)))], locationId); }
            catch (e) { say(`⚠ Core stock not read (${e.message || e}) — plating demands raised without a core check`); }
        }
        const coreLeft = coreAvail ? { ...coreAvail } : null;
        let ok = 0, refused = 0;
        for (const i of chosen) {
            try {
                if (i.kind === 'PLATING') {
                    const core = millBaseOf(i.target);
                    const have = coreLeft && Object.prototype.hasOwnProperty.call(coreLeft, core) ? coreLeft[core] : null;
                    const res = await issuePlatedDemand({ target: i.target, qty: i.qty, brand: activeBrand, from: 'stockview', createdBy: by, inventory: r.parts, coreAvailable: have, note: tag(i), reqDate: r.reqDate, woSource: 'DISPLAY_BUILD' });
                    if (coreLeft && have != null) coreLeft[core] = Math.max(0, have - i.qty);
                    await record(i, { row: i.row, kind: 'PLATING', id: res.demandId, woNum: res.woNum, shopWoId: res.shopWoId || '', target: i.target, qty: i.qty, boards: r.boards, at: Date.now(), by });
                    res.made.forEach(m => say(`${i.row} · ${m}`));
                } else {
                    const res = await parkWorkOrder({
                        intent: i.kind === 'FINISHING' ? INTENT.STOCK_FINISH : INTENT.STOCK_MILL,
                        part: partOf(i.target), qty: i.qty, brand: activeBrand, createdBy: by,
                        reqDate: r.reqDate, needBy: r.reqDate, note: tag(i), source: 'DISPLAY_BUILD',
                        precheck: preByKey.get(i.key) || null, pins: pinsByKey.get(i.key) || [], inventory: r.parts, locationId, soRef: draft.soNumber || '',
                    });
                    await record(i, { row: i.row, kind: i.kind, id: res.woId, shopWoId: res.shopWoId || '', target: i.target, qty: i.qty, boards: r.boards, at: Date.now(), by });
                    res.made.forEach(m => say(`${i.row} · ${m}`));
                }
                ok++;
            } catch (e) {
                if (e instanceof ParkRefusal) { refused++; say(`⛔ ${i.row} · ${i.target}: ${e.message}`); continue; }
                refused++; say(`❌ ${i.row} · ${i.target}: ${e.message || e} — stopped here; what was raised above is recorded on the order`);
                break;
            }
        }
        say(`✅ ${ok} raised${refused ? ` · ${refused} not raised (above)` : ''}. Work orders are on RTG; plating demands on the WMS Plating tab.`);
        setDraft(d => (d ? { ...d, lines } : d));
        setRaise(x => ({ ...x, running: false, done: true, items: x.items.map(it => { const l = lines.parts.find(p => p.key === it.lineKey); const rr = (l?.raised || []).find(z => z.row === it.row) || null; return { ...it, raised: rr }; }) }));
    };

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
                <button onClick={openRaise} disabled={!!busy} style={btn(false, { borderColor: 'var(--brass)' })} title="One work order per part per row — through the usual stock writers: finishing / shop to RTG, plated to the WMS Plating tab">⚙ Raise work orders</button>
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
                <span style={mono}>Demand published to the Sales Snapshot: open boards × per board, lines not done</span>
            </div>

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

            {raise && (
                <div style={{ border: '1px solid var(--brass)', background: 'var(--paper-2)', padding: '14px 16px', marginBottom: '18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: 'var(--serif)', fontSize: '1.15rem' }}>Raise work orders — one per part per row</span>
                        <span style={{ flex: 1 }} />
                        <span style={mono}>boards</span>
                        <input type="number" min="1" value={raise.boards} disabled={raise.running} onChange={e => setRaiseBoards(e.target.value)} style={{ ...inp, width: '70px', padding: '4px 6px' }} />
                        <span style={mono}>required</span>
                        <input type="date" value={raise.reqDate} disabled={raise.running} onChange={e => setRaise(x => ({ ...x, reqDate: e.target.value }))} style={{ ...inp, padding: '4px 6px' }} />
                        <button onClick={runRaise} disabled={raise.running || raise.done} style={btn(true)}>{raise.running ? 'Raising…' : `Raise ${raise.items.filter(i => raise.pick[i.key] && !i.raised).length}`}</button>
                        <button onClick={() => setRaise(null)} disabled={raise.running} style={btn(false)}>Close</button>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', margin: '6px 0 8px' }}>Finishing and shop work orders park on RTG and release on their own; plated parts become plating demands on the WMS Plating tab. Nothing about the route is decided here. Per-foot rods and lines whose finish reads differently from their code start unticked — check the code and quantity first.</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead><tr>{['', 'Row', 'Makes', 'As', 'Per board', 'Qty', 'Status'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                        <tbody>
                            {raise.items.map(i => (
                                <tr key={i.key} style={{ opacity: i.raised ? .6 : 1 }}>
                                    <td style={td}><input type="checkbox" checked={!!raise.pick[i.key]} disabled={!i.ready || raise.running || raise.done} onChange={e => setRaise(x => ({ ...x, pick: { ...x.pick, [i.key]: e.target.checked } }))} /></td>
                                    <td style={{ ...td, ...mono }}>{i.row}</td>
                                    <td style={td}><span style={{ fontFamily: 'var(--mono)', fontSize: '11px' }}>{i.target}</span><div style={{ fontSize: '0.74rem', color: 'var(--ink-soft)' }}>{i.name}</div></td>
                                    <td style={{ ...td, ...mono, color: i.kind === 'UNKNOWN' || i.kind === 'CONVERT' ? '#b02d20' : 'var(--ink)' }}>{i.kind === 'PLATING' ? 'plating demand' : i.kind === 'FINISHING' ? `finishing WO${i.finish ? ` · ${i.finish}` : ''}` : i.kind === 'SHOP' ? 'shop WO' : i.kind === 'CONVERT' ? 'convert — Stock View' : 'no route'}</td>
                                    <td style={{ ...td, textAlign: 'right' }}>{i.perBoard}{i.perFoot ? ` · ${i.feetPerBoard} ft${i.cutLength ? ` · cut ${i.cutLength}"` : ''}` : ''}</td>
                                    <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{i.qty}</td>
                                    <td style={{ ...td, fontSize: '0.78rem', color: i.raised ? 'var(--ink-soft)' : (!i.ready ? '#b02d20' : (i.perFoot || i.check) ? 'var(--brass)' : 'var(--ink-soft)') }}>
                                        {i.raised ? `raised ${i.raised.woNum || i.raised.id}` : i.kind === 'CONVERT' ? 'a /P is a bulk convert — raise it from Stock View' : !i.hasPart ? 'not in the library — sync or save the item first' : i.kind === 'UNKNOWN' ? 'no route for this code' : i.check ? `check: ${i.check}` : i.perFoot ? 'per-foot rod — raised in pieces of this code; check first' : 'ready'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {raise.log.length > 0 && (
                        <div style={{ marginTop: '10px', background: '#fff', border: '1px solid var(--line)', padding: '8px 10px', maxHeight: '260px', overflowY: 'auto', fontFamily: 'var(--mono)', fontSize: '11px', whiteSpace: 'pre-wrap' }}>
                            {raise.log.map((m, k) => <div key={k} style={{ color: /^[⛔❌⚠]/.test(m) || / · [⛔⚠]/.test(m) ? '#b02d20' : 'var(--ink)' }}>{m}</div>)}
                        </div>
                    )}
                </div>
            )}

            {/* lines — the tracker's columns */}
            <div style={mono}>Parts — one board × {openN} open boards</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', margin: '6px 0 18px' }}>
                <thead><tr>{['Position', 'Item', 'Finish', 'Per board', 'Order', 'Open', 'Work order #', 'At plater', 'Notes', 'Done'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                    {parts.map(l => (
                        <tr key={l.key} style={{ opacity: l.done ? .55 : 1 }}>
                            <td style={{ ...td, ...mono }}>{(l.rows || []).join(' / ')}</td>
                            <td style={td}><span style={{ fontFamily: 'var(--mono)', fontSize: '11px' }}>{l.billedId || l.code}</span><div style={{ fontSize: '0.76rem', color: 'var(--ink-soft)' }}>{l.name}</div></td>
                            <td style={{ ...td, fontFamily: 'var(--mono)', fontSize: '11px' }}>{l.finishCode}</td>
                            <td style={{ ...td, textAlign: 'right' }}>{l.qtyPerBoard}{l.perFoot ? ` · ${l.feetPerBoard} ft` : ''}</td>
                            <td style={{ ...td, textAlign: 'right' }}>{l.qtyPerBoard * N(draft.qty)}{l.perFoot ? ` · ${l.feetPerBoard * N(draft.qty)} ft` : ''}</td>
                            <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{l.done ? 0 : l.qtyPerBoard * openN}{l.perFoot && !l.done ? ` · ${l.feetPerBoard * openN} ft` : ''}</td>
                            <td style={td}><input value={l.woNumber || ''} onChange={e => setLine('parts', l.key, { woNumber: e.target.value })} placeholder="WO…" style={{ ...inp, width: '90px', padding: '3px 6px', fontFamily: 'var(--mono)', fontSize: '11px' }} /></td>
                            <td style={td}><select value={l.atPlater || ''} onChange={e => setLine('parts', l.key, { atPlater: e.target.value })} style={{ ...inp, padding: '3px 6px' }}>{PLATER.map(p => <option key={p} value={p}>{p || '—'}</option>)}</select></td>
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
