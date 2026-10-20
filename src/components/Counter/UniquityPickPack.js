// ── UNIQUITY · PICK & PACK — its own page, its own team (S7, 2026-10-20) ───────────────────────────────────────────
//
// Stuart: "we need a separate pick/pack for uniquity, it is a totally different team that pulls and ships these from the
// classical team. it is simple as we just need a pick channel for these orders above that are clicked ok to ship, it
// appears in order for them, by order/customer and they click the block need to mark each one packed and eventually
// marked each one shipped." Decisions: own page (/uniquity-pickpack, the counter's PIN) · UPS exactly as Classical, a
// different UPS account (the Payments session's per-brand accounts) · a pillow is in hand once Stitch & Sew says Complete.
//
// The rules are Shared/uniquityPickPack (pure). Every write is the WMS's own: the packed stamp the WMS pack bench writes,
// the ONE fulfilment queue (Shared/fulfilmentQueue for a whole order, Shared/launchShipment for a shipment of part of one),
// the terms gate (Shared/shipClearance) and the Fulfilment panel (Shared/fulfilmentPanel) for the label and the tracking —
// so RTG, 12.7 and the Classical WMS read one record, whichever screen pressed.
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db, functions, getOuterIdToken } from '../../firebase';
import { signInWithCustomToken } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { addDoc, collection, doc, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { setAuditPage, auditPageOf } from '../Shared/auditContext';
import { nsProxyFetch } from '../Shared/nsProxy';
import { isQuickShip, ORDER_ENTRY_CLASS } from '../Shared/pickLines';
import { channelRowsOf, channelPackedPatchOf, channelLineWords } from '../Shared/uniquityPickPack';
import { isShipmentRecord, shipmentWordsOf } from '../Shared/launchBoard';
import { gateShipmentWith, writeShipment, queueShipmentFulfilment, shipHoldNoteOf, packRefOfRecord, nsMemoOf } from '../Shared/launchShipment';
import { queueSoFulfilment } from '../Shared/fulfilmentQueue';
import { useBinAsk } from '../Shared/BinChoiceModal';
import { isShipHeld, shipClearedStampOf, shipReleaseStampOf, mayReleaseShipHold } from '../Shared/shipClearance';
import { fetchShipClearance } from '../Shared/shipClearance';
import FulfilmentPanel from '../Shared/fulfilmentPanel';

const BRAND = 'uniquity';
const mono = { fontFamily: 'var(--mono, monospace)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: '#777' };
const card = { background: '#fff', border: '1px solid #ddd', borderRadius: '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' };
const btn = (primary, disabled = false) => ({ padding: '10px 16px', background: disabled ? '#eee' : (primary ? '#1a1a1a' : 'transparent'), color: disabled ? '#999' : (primary ? '#fff' : '#1a1a1a'), border: primary ? 'none' : '1px solid #ccc', cursor: disabled ? 'default' : 'pointer', fontFamily: 'var(--mono, monospace)', fontSize: '11px', letterSpacing: '.1em', textTransform: 'uppercase', borderRadius: '2px' });
const field = { padding: '10px 12px', border: '1px solid #ccc', fontFamily: 'var(--sans, sans-serif)', fontSize: '1rem', outline: 'none', boxSizing: 'border-box', background: '#fff', borderRadius: '2px' };
const chip = (bg, fg) => ({ ...mono, padding: '3px 8px', background: bg, color: fg, border: `1px solid ${bg === '#fff' ? '#ddd' : bg}`, borderRadius: '2px' });
const TONE = { 'TO PACK': ['#eaf5ec', '#2e7d32'], WAITING: ['#fbf1e6', '#9a5a1e'] };
const when = (ms) => (ms ? new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

const UniquityPickPack = () => {
    const navigate = useNavigate();
    const [user, setUser] = useState(null);
    const [pinInput, setPinInput] = useState('');
    const [orders, setOrders] = useState([]);
    const [sewDocs, setSewDocs] = useState([]);
    const [stdBoxes, setStdBoxes] = useState([]);
    const [side, setSide] = useState('PACK');   // PACK | SHIP
    const [open, setOpen] = useState(null);
    const [busy, setBusy] = useState('');
    const [look, setLook] = useState({});       // the terms, read when a block opens
    const { askBins, binModal } = useBinAsk();
    useEffect(() => { setAuditPage({ app: 'Uniquity Pick & Pack', tab: side === 'PACK' ? 'Pack' : 'Ship', user: (user && user.name) || '' }); }, [user, side]);

    useEffect(() => {
        if (!user) return undefined;
        const u1 = onSnapshot(query(collection(db, 'hq_sales_orders'), where('orderClass', '==', ORDER_ENTRY_CLASS), where('brand', '==', BRAND)),
            s => setOrders(s.docs.map(d => ({ id: d.id, ...d.data() }))), e => { console.warn('orders listen failed', e); setOrders([]); });
        const u2 = onSnapshot(query(collection(db, 'fin_workorders'), where('division', '==', 'SEW')),
            s => setSewDocs(s.docs.map(d => ({ id: d.id, ...d.data() }))), e => { console.warn('sewing listen failed', e); setSewDocs([]); });
        const u3 = onSnapshot(collection(db, 'standard_boxes'), s => setStdBoxes(s.docs.map(d => ({ id: d.id, ...d.data() }))), () => {});
        return () => { u1(); u2(); u3(); };
    }, [user]);

    const rows = useMemo(() => channelRowsOf(orders, { brand: BRAND, sewDocs }), [orders, sewDocs]);
    const toPack = rows.filter(r => r.stage === 'TO PACK'), waiting = rows.filter(r => r.stage === 'WAITING');
    const shipDocs = useMemo(() => orders.filter(o => o && o.packStatus === 'Packed' && !o.shippedAt && !o.closed && o.status !== 'Closed'), [orders]);

    const writeLog = async (msg, cat) => {
        try { await addDoc(collection(db, 'hq_logs'), { u: (user && user.name) || 'Unknown', msg, cat, src: 'UNIQ_PICKPACK', page: auditPageOf() || null, t: serverTimestamp() }); }
        catch (e) { console.error('log failed', e); }
    };
    const by = () => (user && user.name) || 'Packer';
    // Card money taken in the app that NetSuite has not posted yet counts as paid (the Payments callable).
    const unpostedCardFor = async ({ nsSoId }) => (await httpsCallable(functions, 'paymentsUnpostedForOrder')({ nsSoId })).data;
    const gate = (args) => gateShipmentWith({ nsProxyFetch, unpostedOf: unpostedCardFor, by: by(), log: writeLog, ...args });

    const attemptLogin = async (e) => {
        e.preventDefault();
        if (!pinInput) return;
        try {
            const authenticatePin = httpsCallable(functions, 'authenticatePin');
            const result = await authenticatePin({ pin: pinInput, outerToken: await getOuterIdToken() });
            const { token, user: userData } = result.data;
            await signInWithCustomToken(auth, token);
            setUser(userData);
            setPinInput('');
        } catch (err) { console.error(err); alert('Authentication failed: ' + (err.message || 'Invalid PIN')); setPinInput(''); }
    };

    const openBlock = async (r) => {
        const id = r.so.id;
        setOpen(p => (p === id ? null : id));
        if (look[id] || !r.so.nsInternalId) return;
        setLook(p => ({ ...p, [id]: { loading: true } }));
        const shippingNow = r.partial ? r.pack.reduce((s, i) => { const l = r.so.lines[i] || {}; return s + (l.total != null ? Number(l.total) || 0 : (Number(l.price) || 0) * (Number(l.qty) || 0)); }, 0) : 0;
        const c = await fetchShipClearance({ nsProxyFetch, nsSoId: r.so.nsInternalId, unpostedOf: unpostedCardFor, shippingNow });
        setLook(p => ({ ...p, [id]: { at: Date.now(), clearance: c.clearance } }));
    };

    // ── PACKED: one press. A whole order → the WMS's packed stamp + the ONE fulfilment queue; a partial → a shipment child.
    const markPacked = async (r) => {
        const so = r.so, ref = packRefOfRecord(so);
        const names = (idxs) => idxs.map(i => (so.lines[i] || {}).erp || '?').join(', ');
        const live = orders.find(o => o.id === so.id) || so;
        if (live.packStatus === 'Packed') return alert(`${ref} is already packed.`);
        if (r.partial) {
            if (!window.confirm(`📦 SHIPMENT ${r.plan.n} of ${ref} — ${so.customer || ''}?\n\nShips now: ${names(r.pack)}\nStays behind: ${r.waiting.map(w => `${(so.lines[w.idx] || {}).erp || '?'} (${w.why})`).join(', ')}\n\nThe shipment becomes its own packed order and goes to the Ship side; its NetSuite fulfilment takes only these lines. ${ref} stays open for the rest.`)) return;
        } else if (!window.confirm(`📦 PACKED — ${ref} · ${so.customer || ''}?\n\n${names(r.pack)}\n\nIt goes to the Ship side for the UPS label, and its NetSuite fulfilment is queued (after the terms check).`)) return;
        setBusy(so.id);
        try {
            if (r.partial) {
                const w = await writeShipment({ parent: live, plan: r.plan, by: by(), now: Date.now(), boxes: {}, photos: [] });
                if (!w.ok) return alert(`Not packed — ${w.why}`);
                writeLog(`📦 Shipment ${w.built.n} of ${ref} packed on Uniquity Pick & Pack — ${shipmentWordsOf(w.built.record)}`, 'packing');
                const note = await queueShipmentFulfilment({ child: w.built.doc, nsProxyFetch, gate, by: by(), sourceApp: 'UNIQ_PICKPACK', log: writeLog });
                alert(`📦 Shipment ${w.built.n} of ${ref} packed (${w.built.id}).${note}\n\n${ref} stays open for: ${names(r.waiting.map(x => x.idx))}.`);
                return;
            }
            await updateDoc(doc(db, 'hq_sales_orders', so.id), channelPackedPatchOf(live, r.pack, { by: by(), now: Date.now() }));
            writeLog(`📦 ${ref} packed on Uniquity Pick & Pack by ${by()} — ${names(r.pack)}`, 'packing');
            let note = '';
            if (!live.nsFulfillQueued && !live.nsIfId) {
                const refDoc = doc(db, 'hq_sales_orders', so.id);
                const g = await gate({ nsSoId: String(live.nsInternalId || ''), refs: [refDoc], ref });
                if (!g.clear) note = shipHoldNoteOf(g);
                else {
                    try {
                        const sent = await queueSoFulfilment({
                            nsSoId: String(live.nsInternalId || ''), ref, label: `NS Fulfillment — ${ref} (${so.customer || ''})`,
                            memo: nsMemoOf(`Packed on Uniquity Pick & Pack by ${by()}`),
                            writeBack: [{ collection: 'hq_sales_orders', docId: so.id, patch: {}, idField: 'nsIfId', tranField: 'nsIfTran' }],
                            createdBy: by(), sourceApp: 'UNIQ_PICKPACK', preferBin: live.committedBin || '', askBins,
                        });
                        if (sent.ok) { await updateDoc(refDoc, { nsFulfillQueued: true, nsFulfillNeedsBins: false, ...(sent.binText ? { nsFulfilBins: sent.binText, nsFulfilBinsBy: by(), nsFulfilBinsAt: Date.now() } : {}) }); note = `\n\n📤 NetSuite Item Fulfillment queued (status: Packed).${sent.binText ? ` Taken from: ${sent.binText}.` : ''}`; }
                        else if (sent.reason === 'NOT_CHOSEN') { await updateDoc(refDoc, { nsFulfillNeedsBins: true }); note = `\n\n⚠ ${sent.text}`; }
                        else note = `\n\n⚠ ${sent.text}`;
                    } catch (e) { note = `\n\n⚠ Could not queue the NetSuite fulfilment: ${e.message || e}. The packing stands — send it from the Ship side (📤), or fulfil it in NetSuite.`; }
                }
            }
            alert(`📦 ${ref} packed.${note}\n\nIt is on the Ship side now.`);
        } catch (e) { alert('Could not mark it packed: ' + (e.message || e)); }
        finally { setBusy(''); }
    };

    // ⏸ waiting for payment: Check again / a manager's Release — the same stamps as the WMS (Shared/shipClearance)
    const recheck = async (d) => {
        const nsSoId = isShipmentRecord(d) ? d.shipmentOfNsId : d.nsInternalId;
        const r = await fetchShipClearance({ nsProxyFetch, nsSoId, unpostedOf: unpostedCardFor, shippingNow: isShipmentRecord(d) ? (Number(d.shipmentAmount) || 0) : 0 });
        const refDoc = doc(db, 'hq_sales_orders', d.id);
        if (!r.clearance.clear) { await gate({ nsSoId, refs: [refDoc], ref: packRefOfRecord(d) }); return alert(`⏸ ${packRefOfRecord(d)} still waits — ${r.clearance.why}`); }
        await updateDoc(refDoc, shipClearedStampOf(r, { at: Date.now(), by: by() }));
        writeLog(`✓ ${packRefOfRecord(d)} cleared to ship — ${r.clearance.why}`, 'packing');
        const note = (d.nsFulfillQueued || d.nsIfId) ? '' : await sendFor(d);
        alert(`✓ ${packRefOfRecord(d)} may ship — ${r.clearance.why}.${note}`);
    };
    const release = async (d) => {
        if (!mayReleaseShipHold(user && user.role, user && user.superAdmin)) return alert('Only a manager or an admin can release a held order — sign in with their PIN.');
        const why = window.prompt(`Release ${packRefOfRecord(d)} to ship although: ${(d.shipHold && d.shipHold.why) || ''}?\n\nThe reason is recorded.`);
        if (why === null) return;
        const reason = String(why).trim();
        if (!reason) return alert('A reason is needed — nothing was changed.');
        await updateDoc(doc(db, 'hq_sales_orders', d.id), shipReleaseStampOf({ hold: d.shipHold, reason }, { at: Date.now(), by: by() }));
        writeLog(`🔓 ${packRefOfRecord(d)} released to ship by ${by()} — ${reason}`, 'packing');
        const note = (d.nsFulfillQueued || d.nsIfId) ? '' : await sendFor(d);
        alert(`🔓 ${packRefOfRecord(d)} released to ship.${note}`);
    };
    const sendFor = async (d) => {
        if (isShipmentRecord(d)) return queueShipmentFulfilment({ child: d, nsProxyFetch, gate: null, by: by(), sourceApp: 'UNIQ_PICKPACK', log: writeLog });
        try {
            const sent = await queueSoFulfilment({ nsSoId: String(d.nsInternalId || ''), ref: packRefOfRecord(d), label: `NS Fulfillment — ${packRefOfRecord(d)} (${d.customer || ''})`, memo: nsMemoOf(`Packed on Uniquity Pick & Pack by ${by()}`), writeBack: [{ collection: 'hq_sales_orders', docId: d.id, patch: {}, idField: 'nsIfId', tranField: 'nsIfTran' }], createdBy: by(), sourceApp: 'UNIQ_PICKPACK', preferBin: d.committedBin || '', askBins });
            if (sent.ok) { await updateDoc(doc(db, 'hq_sales_orders', d.id), { nsFulfillQueued: true, nsFulfillNeedsBins: false }); return '\n\n📤 NetSuite Item Fulfillment queued (status: Packed).'; }
            return `\n\n⚠ ${sent.text}`;
        } catch (e) { return `\n\n⚠ Could not queue the NetSuite fulfilment: ${e.message || e}`; }
    };

    if (!user) {
        return (
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#faf8f5', fontFamily: 'var(--sans, sans-serif)' }}>
                <form onSubmit={attemptLogin} style={{ ...card, padding: '16px', width: '340px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={mono}>Uniquity</div>
                    <h2 style={{ margin: 0, fontFamily: 'var(--serif, serif)', fontWeight: 500 }}>📦 Pick & Pack</h2>
                    <input type="password" inputMode="numeric" autoFocus value={pinInput} onChange={e => setPinInput(e.target.value)} placeholder="PIN" style={{ ...field, fontSize: '1.4rem', letterSpacing: '.3em', textAlign: 'center' }} />
                    <button type="submit" style={btn(true)}>Sign in</button>
                    <button type="button" onClick={() => navigate('/')} style={btn(false)}>← Hub</button>
                </form>
            </div>
        );
    }

    const holdBar = (d) => (
        <span style={{ ...mono, color: '#a86b00', display: 'inline-flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            ⏸ waiting for payment — {d.shipHold && d.shipHold.why}
            <button onClick={() => recheck(d)} style={{ ...btn(false), padding: '4px 8px' }}>Check again</button>
            <button onClick={() => release(d)} style={{ ...btn(false), padding: '4px 8px' }}>Release</button>
        </span>
    );

    return (
        <div style={{ minHeight: '100vh', background: '#faf8f5', fontFamily: 'var(--sans, sans-serif)', color: '#1a1a1a' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '12px 20px', background: '#fff', borderBottom: '1px solid #ddd', flexWrap: 'wrap', position: 'sticky', top: 0, zIndex: 20 }}>
                <div style={{ fontFamily: 'var(--serif, serif)', fontSize: '1.3rem' }}>📦 Uniquity · Pick & Pack</div>
                <div style={{ display: 'flex', gap: '6px' }}>
                    <button onClick={() => setSide('PACK')} style={btn(side === 'PACK')}>Pack · {toPack.length}{waiting.length ? ` (+${waiting.length} waiting)` : ''}</button>
                    <button onClick={() => setSide('SHIP')} style={btn(side === 'SHIP')}>Ship · {shipDocs.length}</button>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <span style={mono}>{user.name}</span>
                    <button onClick={() => setUser(null)} style={btn(false)}>Switch user</button>
                    <button onClick={() => navigate('/')} style={btn(false)}>Hub</button>
                </div>
            </div>
            {binModal}

            {side === 'SHIP' && (
                <div style={{ padding: '16px 20px' }}>
                    <div style={{ ...mono, marginBottom: '10px' }}>Packed orders — the UPS label and the tracking, on the Uniquity account. A held one waits here until it is paid.</div>
                    {shipDocs.filter(isShipHeld).map(d => (
                        <div key={d.id} style={{ ...card, padding: '10px 14px', marginBottom: '8px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ fontFamily: 'var(--mono, monospace)', fontWeight: 700 }}>{packRefOfRecord(d)}</span><span>{d.customer || ''}</span>{holdBar(d)}
                        </div>
                    ))}
                    <FulfilmentPanel operator={user} activeBrand={BRAND} docs={shipDocs} soIndex={{}} stdBoxes={stdBoxes} isQsOrder={isQuickShip} packRefOf={packRefOfRecord} writeLog={writeLog} />
                </div>
            )}

            {side === 'PACK' && (
                <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {rows.length === 0 && <div style={{ ...card, padding: '20px', color: '#777', fontStyle: 'italic' }}>Nothing to pack — every Uniquity order is packed, shipped or waiting on 12.7.</div>}
                    {rows.map(r => {
                        const so = r.so, isOpen = open === so.id, lk = look[so.id];
                        return (
                            <div key={so.id} style={{ ...card, borderLeft: `5px solid ${TONE[r.stage][1]}` }}>
                                <div onClick={() => openBlock(r)} style={{ display: 'grid', gridTemplateColumns: '170px 1fr 1fr auto', gap: '14px', alignItems: 'center', padding: '14px 18px', cursor: 'pointer' }}>
                                    <div>
                                        <div style={{ fontFamily: 'var(--mono, monospace)', fontWeight: 700 }}>{so.soId || so.id}</div>
                                        <div style={mono}>{when(so.createdAt)}</div>
                                    </div>
                                    <div>
                                        <div style={{ fontWeight: 600, fontSize: '1.05rem' }}>{so.customer || '—'}</div>
                                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
                                            <span style={chip(TONE[r.stage][0], TONE[r.stage][1])}>{r.stage}</span>
                                            {r.pack.length > 0 && <span style={chip('#fff', '#2e7d32')}>{r.pack.length} line{r.pack.length === 1 ? '' : 's'} to pack</span>}
                                            {r.waiting.length > 0 && <span style={chip('#fff', '#9a5a1e')}>{r.waiting.length} waiting</span>}
                                            {r.shipments.length > 0 && <span style={chip('#eef7ff', '#1e5fa8')}>{r.shipments.length} shipment{r.shipments.length === 1 ? '' : 's'} sent</span>}
                                        </div>
                                    </div>
                                    <div style={{ fontSize: '0.9rem', color: TONE[r.stage][1] }}>{r.note}</div>
                                    <div style={mono}>{isOpen ? '▾' : '▸'}</div>
                                </div>
                                {isOpen && (
                                    <div style={{ borderTop: '1px solid #eee', padding: '14px 18px', background: '#faf8f5' }}>
                                        {so.nsInternalId && <div style={{ ...mono, marginBottom: '10px', color: lk && lk.clearance ? (lk.clearance.clear ? '#2e7d32' : '#a86b00') : '#777' }}>💲 {lk ? (lk.loading ? 'reading the terms in NetSuite…' : lk.clearance.why) : ''}</div>}
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.95rem', background: '#fff' }}>
                                            <tbody>
                                                {r.lines.filter(x => x.kind !== 'FEE').map(x => (
                                                    <tr key={x.idx} style={{ borderBottom: '1px solid #f0ece6', opacity: x.shipped ? 0.5 : 1 }}>
                                                        <td style={{ padding: '8px 10px', fontFamily: 'var(--mono, monospace)', fontWeight: 700, whiteSpace: 'nowrap' }}>{x.line.erp}</td>
                                                        <td style={{ padding: '8px 10px', color: '#555' }}>{x.line.name}{x.line.note ? <div style={{ ...mono, textTransform: 'none', letterSpacing: 0 }}>{x.line.note}</div> : null}</td>
                                                        <td style={{ padding: '8px 10px', fontFamily: 'var(--mono, monospace)', fontSize: '1.1rem', textAlign: 'center' }}>{x.line.qty}</td>
                                                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}><span style={chip(x.shipped ? '#fff' : (x.ready ? '#eaf5ec' : '#fbf1e6'), x.shipped ? '#999' : (x.ready ? '#2e7d32' : '#9a5a1e'))}>{channelLineWords(x)}</span></td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                        {r.shipments.length > 0 && <div style={{ ...mono, marginTop: '8px', textTransform: 'none', letterSpacing: 0 }}>{r.shipments.map(s => <div key={s.n}>📦 {shipmentWordsOf(s)} · {when(s.at)}</div>)}</div>}
                                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '14px', flexWrap: 'wrap' }}>
                                            {r.stage === 'TO PACK'
                                                ? <button disabled={busy === so.id} onClick={() => markPacked(r)} style={btn(true, busy === so.id)}>{r.partial ? `📦 Packed — ship ${r.pack.length} line${r.pack.length === 1 ? '' : 's'} now` : '📦 Packed'}</button>
                                                : <span style={{ ...mono, color: '#9a5a1e' }}>waiting — {r.note}</span>}
                                            {so.productionNotes && <span style={{ ...mono, textTransform: 'none', letterSpacing: 0 }}>📝 {so.productionNotes}</span>}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default UniquityPickPack;
