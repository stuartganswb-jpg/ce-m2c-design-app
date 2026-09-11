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
// No work order is raised here — the numbers you raise are recorded, as the tracker does.

import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../../firebase';
import { collection, doc, onSnapshot, setDoc, deleteDoc, query, where } from 'firebase/firestore';
import { DISPLAY_STYLES, buildLinesFrom, resnapshotLines, displayDemandFrom, shipPlanFill, openBoards } from '../Shared/displayBom';

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
            qty, built: 0, status: 'PLANNED', shipPlan: [], notes: '',
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
                <button onClick={save} disabled={!dirty || !!busy} style={btn(dirty, { opacity: dirty ? 1 : .5 })}>Save order</button>
            </div>

            {/* header */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', marginBottom: '16px' }}>
                {[['Customer', <select value={draft.customerId || ''} onChange={e => { const c = customers.find(x => x.id === e.target.value); mutate(d => ({ ...d, customerId: c?.id || '', customerName: c?.name || '' })); }} style={{ ...inp, width: '100%' }}><option value="">—</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>],
                  ['Our SO #', <input value={draft.soNumber || ''} onChange={e => mutate(d => ({ ...d, soNumber: e.target.value }))} style={{ ...inp, width: '100%' }} />],
                  ['Their PO #', <input value={draft.poNumber || ''} onChange={e => mutate(d => ({ ...d, poNumber: e.target.value }))} style={{ ...inp, width: '100%' }} />],
                  ['Boards ordered', <input type="number" min="1" value={draft.qty} onChange={e => mutate(d => ({ ...d, qty: Math.max(1, N(e.target.value, 1)) }))} style={{ ...inp, width: '100%' }} />],
                  ['Boards built', <input type="number" min="0" value={N(draft.built)} onChange={e => mutate(d => ({ ...d, built: Math.max(0, N(e.target.value, 0)) }))} style={{ ...inp, width: '100%' }} title="Assembled boards — open demand = ordered − built" />],
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
