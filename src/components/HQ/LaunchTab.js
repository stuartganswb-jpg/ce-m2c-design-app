// ── 12.7 LAUNCH — the day's orders, opened one at a time, decided line by line (S7, 2026-10-20) ─────
//
// Stuart: "RTG is really now more of a snapshot of all details happening everywhere and we need a more focused screen
// for all the brands that just address launching the orders … list the daily orders and click each one open it and
// look at it and decide what to do, release partial lines … orders that are entirely in stock go straight to auto
// release … the throws for uniquity never hit the floor … the orders that have some pillows with throws we need to look
// at to decide whether to ship the throws ahead or wait for the pillows." Decisions: tab 12.7 · HOLD as the default ·
// a second shipment per order is fine.
//
// PHASE 1 (this file): the board and the decisions, on the record (`launch`, Shared/launchBoard). The warehouse honours
// a HELD line in phase 2 (Shared/pickLines + the pack / fulfilment side, with the WMS and Payments sessions). Starting
// a made line is the review Order Entry Needs already does — the row hands the order to 12.5 as RTG's card does.
import React, { useEffect, useMemo, useState } from 'react';
import { db } from '../../firebase';
import { collection, doc, getDocs, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { nsProxyFetch } from '../Shared/nsProxy';
import { isQuickShip } from '../Shared/pickLines';
import { oeCoverageOf } from '../Shared/oeLines';
import { fetchShipClearance } from '../Shared/shipClearance';
import { launchRowsOf, launchPatchOf, shipAheadPatchOf, holdAllPatchOf, SUGGESTION_WORDS, LAUNCH_MODES } from '../Shared/launchBoard';

const mono = { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' };
const card = { background: '#fff', border: '1px solid var(--line)', borderRadius: '2px' };
const btn = (primary, disabled) => ({ padding: '9px 14px', background: disabled ? 'var(--paper-2)' : (primary ? 'var(--ink)' : 'transparent'), border: primary ? 'none' : '1px solid var(--line)', cursor: disabled ? 'not-allowed' : 'pointer', ...mono, color: disabled ? 'var(--ink-soft)' : (primary ? '#fff' : 'var(--ink)') });
const chip = (bg, fg) => ({ ...mono, padding: '3px 8px', background: bg, color: fg, border: `1px solid ${bg === '#fff' ? 'var(--line)' : bg}` });
const KIND_WORDS = { SHELF: 'on the shelf', SEW: 'stitch & sew', FINISH: 'finishing floor', FLOOR: 'made on a floor', PLACEHOLDER: 'to identify', FEE: '' };
const KIND_TONE = { SHELF: ['#eaf5ec', '#2e7d32'], SEW: ['#eef1fb', '#3b4f9a'], FINISH: ['#fbf1e6', '#9a5a1e'], FLOOR: ['#f3eee6', '#6b5a3c'], PLACEHOLDER: ['#fdf3f3', '#b3362f'], FEE: ['#fff', '#9a948a'] };
const STATE_TONE = { AUTO: ['#eaf5ec', '#2e7d32'], HELD: ['#fdf3f3', '#b3362f'], RELEASED: ['#eef7ff', '#1e5fa8'] };
const SUG_TONE = { AUTO: '#2e7d32', DECIDE: '#b3362f', START: '#9a5a1e', HELD: '#b3362f', IDENTIFY: '#b3362f', WAIT_NS: '#9a948a', CLOSED: '#9a948a' };
const when = (ms) => (ms ? new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

const LaunchTab = ({ currentUser = '', activeBrand = '', userRole = '' }) => {
    const [orders, setOrders] = useState([]);
    const [wosBySo, setWosBySo] = useState({});
    const [days, setDays] = useState(14);
    const [open, setOpen] = useState('');
    const [busy, setBusy] = useState('');
    const [clearance, setClearance] = useState({});   // so.id → { ok, clearance, at }
    const [note, setNote] = useState('');
    const [msg, setMsg] = useState('');

    // the brand's stocked orders (Order Entry / the counter), live
    useEffect(() => {
        if (!activeBrand) return undefined;
        const unsub = onSnapshot(query(collection(db, 'hq_sales_orders'), where('brand', '==', activeBrand)), snap => {
            setOrders(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(isQuickShip));
        }, e => { console.warn('launch orders listen failed', e); setOrders([]); });
        return unsub;
    }, [activeBrand]);
    const sinceMs = days > 0 ? Date.now() - days * 24 * 3600 * 1000 : 0;
    const visible = useMemo(() => orders.filter(o => !sinceMs || (Number(o.createdAt) || Number(o.nsQueuedAt) || 0) >= sinceMs), [orders, sinceMs]);
    // the orders' work orders (the floor's documents), read for the visible set — in chunks of 30 (Firestore's `in`)
    const readWos = async () => {
        const ids = visible.map(o => o.id);
        const out = {};
        for (let i = 0; i < ids.length; i += 30) {
            const chunk = ids.slice(i, i + 30);
            if (!chunk.length) continue;
            const snap = await getDocs(query(collection(db, 'hq_work_orders'), where('soAppId', 'in', chunk)));
            snap.docs.forEach(d => { const w = { id: d.id, ...d.data() }; if (w.deleted) return; (out[w.soAppId] = out[w.soAppId] || []).push(w); });
        }
        setWosBySo(out);
    };
    useEffect(() => { readWos().catch(e => console.warn('launch wos read failed', e)); }, [visible.length]);   // eslint-disable-line react-hooks/exhaustive-deps

    const startedOf = (so, line, lineIdx) => { const c = oeCoverageOf({ so, line, lineIdx, wos: wosBySo[so.id] || [], any: true }); return !!c && !c.dead; };
    const rows = useMemo(() => launchRowsOf(visible, { brand: activeBrand, sinceMs, startedOf }), [visible, activeBrand, sinceMs, wosBySo]);   // eslint-disable-line react-hooks/exhaustive-deps
    const counts = useMemo(() => rows.reduce((a, r) => { a[r.suggestion] = (a[r.suggestion] || 0) + 1; return a; }, {}), [rows]);

    const readClearance = async (so) => {
        if (!so.nsInternalId) { setClearance(p => ({ ...p, [so.id]: { ok: false, clearance: { why: 'NetSuite has not accepted the order yet' }, at: Date.now() } })); return; }
        const r = await fetchShipClearance({ nsProxyFetch, nsSoId: so.nsInternalId });
        setClearance(p => ({ ...p, [so.id]: { ...r, at: Date.now() } }));
    };
    const toggle = (so) => { const next = open === so.id ? '' : so.id; setOpen(next); setNote(''); setMsg(''); if (next && !clearance[so.id]) readClearance(so).catch(() => {}); };

    const write = async (so, patch, said) => {
        setBusy(so.id); setMsg('');
        try { await updateDoc(doc(db, 'hq_sales_orders', so.id), patch); setMsg(`✓ ${said}`); setNote(''); }
        catch (e) { setMsg(`⛔ ${e.message || e}`); }
        setBusy('');
    };
    const shipAhead = (so) => write(so, shipAheadPatchOf(so, { by: currentUser }), `${so.soId || so.id}: the shelf lines are released — the warehouse picks them now; the made lines follow in a second shipment.`);
    const holdAll = (so) => write(so, holdAllPatchOf(so, { by: currentUser, note }), `${so.soId || so.id}: the shelf lines are held until the made lines are ready.`);
    const lineTo = (so, idx, state) => write(so, launchPatchOf(so, { lineIdxs: [idx], state, by: currentUser, note, mode: LAUNCH_MODES.PARTIAL }), `${so.soId || so.id} line ${idx + 1}: ${state === 'HELD' ? 'held' : 'released'}.`);
    const startLines = (so) => { try { sessionStorage.setItem('hq_oe_review_so', so.id); } catch (e) { /* the view still opens */ } window.dispatchEvent(new CustomEvent('NAVIGATE_TAB', { detail: 'OE_NEEDS' })); };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', fontFamily: 'var(--sans)' }}>
            <div style={{ ...card, padding: '22px 26px', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                <div>
                    <span style={{ ...mono, display: 'block', marginBottom: '4px' }}>Order Entry · the counter · {activeBrand}</span>
                    <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>Launch</h2>
                    <div style={{ fontSize: '0.88rem', color: 'var(--ink-soft)', marginTop: '6px', maxWidth: '760px' }}>Every stocked order, line by line: on the shelf, to be sewn, to be finished, to identify. An order entirely on the shelf is picked as it always was. One with pillows beside shelf lines waits here for a decision — <b>ship the shelf lines ahead</b>, or <b>hold</b> them until the pillows are sewn. Start the made lines from the review. Any shelf line can be held or released by hand, for a partial on any brand.</div>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    {[7, 14, 30, 0].map(d => <button key={d} onClick={() => setDays(d)} style={btn(days === d, false)}>{d === 0 ? 'all open' : `${d} days`}</button>)}
                    <button onClick={() => readWos().catch(() => {})} style={btn(false, false)} title="Re-read the floor's documents">↻</button>
                </div>
                <div style={{ width: '100%', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {Object.entries(SUGGESTION_WORDS).filter(([k]) => counts[k]).map(([k, w]) => <span key={k} style={chip('#fff', SUG_TONE[k])}>{counts[k]} · {w.split(' — ')[0]}</span>)}
                    {rows.length === 0 && <span style={mono}>no open stocked order in this window</span>}
                </div>
            </div>

            {rows.map(r => {
                const so = visible.find(o => o.id === r.id);
                const isOpen = open === r.id;
                const cl = clearance[r.id];
                return (
                    <div key={r.id} style={{ ...card, borderLeft: `4px solid ${SUG_TONE[r.suggestion] || 'var(--line)'}` }}>
                        <div onClick={() => toggle(so)} style={{ display: 'grid', gridTemplateColumns: '170px 1fr 1fr auto', gap: '14px', alignItems: 'center', padding: '14px 18px', cursor: 'pointer' }}>
                            <div>
                                <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--ink)' }}>{r.number}</div>
                                <div style={mono}>{when(r.createdAt)}{r.nsAccepted ? '' : ' · awaiting NetSuite'}</div>
                            </div>
                            <div>
                                <div style={{ fontWeight: 600 }}>{r.customer || '—'}</div>
                                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
                                    {['SHELF', 'SEW', 'FINISH', 'FLOOR', 'PLACEHOLDER'].filter(k => r.kinds[k]).map(k => <span key={k} style={chip(KIND_TONE[k][0], KIND_TONE[k][1])}>{r.kinds[k]} {KIND_WORDS[k]}</span>)}
                                    {r.shelf.held > 0 && <span style={chip(STATE_TONE.HELD[0], STATE_TONE.HELD[1])}>{r.shelf.held} held</span>}
                                    {r.shelf.released > 0 && <span style={chip(STATE_TONE.RELEASED[0], STATE_TONE.RELEASED[1])}>{r.shelf.released} released</span>}
                                    {r.backorders.length > 0 && <span style={chip('#fdf3f3', '#b3362f')}>{r.backorders.length} backordered</span>}
                                </div>
                            </div>
                            <div style={{ fontSize: '0.9rem', color: SUG_TONE[r.suggestion] }}>{SUGGESTION_WORDS[r.suggestion]}{r.decided ? <span style={{ ...mono, marginLeft: '8px' }}>· decided{r.mode ? ` (${r.mode.toLowerCase().replace('_', ' ')})` : ''}</span> : null}</div>
                            <div style={mono}>{isOpen ? '▾' : '▸'}</div>
                        </div>
                        {isOpen && so && (
                            <div style={{ borderTop: '1px solid var(--line)', padding: '14px 18px', background: 'var(--paper)' }}>
                                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '12px' }}>
                                    <span style={{ ...mono, color: cl && cl.ok ? (cl.clearance.clear ? '#2e7d32' : '#b3362f') : 'var(--ink-soft)' }}>💲 {cl ? (cl.ok ? cl.clearance.why : (cl.clearance && cl.clearance.why) || 'NetSuite could not be read') : 'reading the terms and what is paid…'}</span>
                                    <button onClick={() => readClearance(so).catch(() => {})} style={{ ...btn(false, false), padding: '4px 8px' }}>↻</button>
                                    {so.nsInternalId && <span style={mono}>NetSuite {so.soId !== so.id ? so.soId : so.nsInternalId}</span>}
                                </div>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', background: '#fff' }}>
                                    <thead><tr>{['#', 'Line', 'Qty', 'Kind', 'State', ''].map(h => <th key={h} style={{ ...mono, textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>{h}</th>)}</tr></thead>
                                    <tbody>
                                        {r.lines.filter(x => x.kind !== 'FEE').map(x => (
                                            <tr key={x.idx} style={{ borderBottom: '1px solid var(--paper-2)' }}>
                                                <td style={{ padding: '6px 8px', fontFamily: 'var(--mono)', color: 'var(--ink-soft)' }}>{x.idx + 1}</td>
                                                <td style={{ padding: '6px 8px' }}><span style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}>{x.line.erp}</span> <span style={{ color: 'var(--ink-soft)' }}>{x.line.name}</span>{x.line.note ? <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>{x.line.note}</div> : null}</td>
                                                <td style={{ padding: '6px 8px', fontFamily: 'var(--mono)' }}>{x.line.qty}</td>
                                                <td style={{ padding: '6px 8px' }}><span style={chip(KIND_TONE[x.kind][0], KIND_TONE[x.kind][1])}>{KIND_WORDS[x.kind]}</span></td>
                                                <td style={{ padding: '6px 8px' }}>
                                                    {x.kind === 'SHELF' && <span style={chip(STATE_TONE[x.state][0], STATE_TONE[x.state][1])}>{x.state === 'AUTO' ? 'picked as always' : x.state.toLowerCase()}</span>}
                                                    {(x.kind === 'SEW' || x.kind === 'FINISH' || x.kind === 'FLOOR') && <span style={chip(x.started ? '#eaf5ec' : '#fff', x.started ? '#2e7d32' : '#9a5a1e')}>{x.started ? 'started' : 'not started'}</span>}
                                                    {x.kind === 'PLACEHOLDER' && <span style={chip('#fdf3f3', '#b3362f')}>identify on RTG / CRM</span>}
                                                </td>
                                                <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                                                    {x.kind === 'SHELF' && x.state !== 'RELEASED' && <button disabled={busy === so.id} onClick={() => lineTo(so, x.idx, 'RELEASED')} style={{ ...btn(false, busy === so.id), padding: '5px 9px', marginRight: '4px' }}>Release</button>}
                                                    {x.kind === 'SHELF' && x.state !== 'HELD' && <button disabled={busy === so.id} onClick={() => lineTo(so, x.idx, 'HELD')} style={{ ...btn(false, busy === so.id), padding: '5px 9px' }}>Hold</button>}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {r.backorders.length > 0 && <div style={{ fontSize: '0.85rem', color: '#b3362f', marginTop: '10px' }}>Backordered: {r.backorders.map(b => `${b.qty || b.short || ''} × ${b.code || b.erp || '?'}`).join(' · ')} — order it from 12.5 → Sales Snapshot → Backorders.</div>}
                                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginTop: '14px' }}>
                                    {r.mixed && <button disabled={busy === so.id} onClick={() => shipAhead(so)} style={btn(true, busy === so.id)} title="Release every shelf line now — the warehouse picks and ships them; the pillows follow in a second shipment">🚚 Ship the shelf lines ahead</button>}
                                    {r.mixed && <button disabled={busy === so.id} onClick={() => holdAll(so)} style={btn(false, busy === so.id)} title="Hold every shelf line until the made lines are ready — one shipment">⏸ Hold until the pillows are sewn</button>}
                                    {r.lines.some(x => (x.kind === 'SEW' || x.kind === 'FINISH') && !x.started) && <button onClick={() => startLines(so)} style={btn(false, false)} title="Opens this order's review on 12.5 → Order Entry Needs — the start writes the documents">▶ Start the made lines → review</button>}
                                    <input value={note} onChange={e => setNote(e.target.value)} placeholder="a note on the decision (optional)" style={{ flex: '1 1 220px', padding: '8px 10px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.85rem' }} />
                                </div>
                                {so.launch && so.launch.decidedAt && <div style={{ ...mono, marginTop: '8px' }}>decided {when(so.launch.decidedAt)}{so.launch.decidedBy ? ` by ${so.launch.decidedBy}` : ''}{Object.values(so.launch.lines || {}).find(l => l.note) ? ` · ${Object.values(so.launch.lines).find(l => l.note).note}` : ''}</div>}
                                {msg && <div style={{ fontSize: '0.85rem', marginTop: '8px', color: msg.startsWith('⛔') ? '#b3362f' : '#2e7d32' }}>{msg}</div>}
                                <div style={{ ...mono, marginTop: '10px', textTransform: 'none', letterSpacing: 0, fontSize: '11px' }}>Phase 1: the decision is on the order. The warehouse honours a held line in phase 2 (the pick, the pack and the second fulfilment), coming with the WMS and Payments sessions.</div>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export default LaunchTab;
