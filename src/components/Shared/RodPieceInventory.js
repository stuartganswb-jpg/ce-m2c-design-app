// ─────────────────────────────────────────────────────────────────────────────────────────────
// ROD PIECE INVENTORY — THE SCREENS (Stuart 2026-08-27, ROD_PIECE_INVENTORY_BRIEF.md)
// ─────────────────────────────────────────────────────────────────────────────────────────────
// Two mounts of one truth, the way Pick status spans screens:
//   <RodPieceInventory>  the ledger of every offcut — HQ 6.5 (with the config editor: piece
//                        length per rod item, the "how is this stocked" declaration) and the
//                        shop's Custom tab (read/scrap/label, collapsed by default).
//   <RodCutPanel>        the cut-station recommendation on the shop custom card: which piece to
//                        pull for this order's cuts, per the waste rule — log the cut, label the
//                        remainder, scrap staged to NetSuite.
// Policy is Shared/rodPieces.js (offline-tested); writes are Shared/rodPieceLedger.js.

import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../../firebase';
import { collection, doc, onSnapshot, query, where, setDoc, updateDoc, deleteField, serverTimestamp } from 'firebase/firestore';
import { printRodPieceLabel } from './labelPrint';
import {
    PIECE_STATUS, MIN_USABLE_IN, rodCodeKey, configEntryFor, planCuts, sweepScrap, honestAvailability,
} from './rodPieces';
import { createPiece, logCut, scrapPiece, retryScrapPost } from './rodPieceLedger';

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
const inText = (n) => {
    const v = Number(n) || 0;
    return v >= 12 ? `${v}" (${Math.floor(v / 12)}′${Math.round(v % 12) ? ` ${Math.round(v % 12)}″` : ''})` : `${v}"`;
};
const ago = (t) => {
    const d = Math.floor((Date.now() - (Number(t) || Date.now())) / 86400000);
    return d <= 0 ? 'today' : d === 1 ? '1 day' : `${d} days`;
};

const mono = (px = 10) => ({ fontFamily: 'var(--mono)', fontSize: `${px}px`, textTransform: 'uppercase', letterSpacing: '.08em' });
const btn = { background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink)', padding: '6px 10px', cursor: 'pointer', ...mono(9) };
const inp = { padding: '8px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box', background: '#fff' };

// One subscription pair both components share.
const useRodConfig = () => {
    const [config, setConfig] = useState(null);
    useEffect(() => onSnapshot(doc(db, 'system', 'rod_stock_config'), d => setConfig(d.exists() ? d.data() : { items: {} }), () => setConfig({ items: {} })), []);
    return config;
};

const brandFits = (piece, brand) => {
    const b = String(brand || '').toLowerCase();
    return !b || b === 'all' || !piece.brand || piece.brand === b;
};

// ── THE CUT-STATION PANEL (shop custom card) ─────────────────────────────────────────────────
export const RodCutPanel = ({ order, itemCode, brand, user }) => {
    const config = useRodConfig();
    const entry = configEntryFor(itemCode, config);
    const key = rodCodeKey(itemCode);
    const [pieces, setPieces] = useState([]);
    const [choicePick, setChoicePick] = useState({});   // cutId -> piece id | 'NEW' override
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (!key || !entry) return undefined;
        return onSnapshot(query(collection(db, 'rod_pieces'), where('codeKey', '==', key)),
            s => setPieces(s.docs.map(d => d.data())), () => setPieces([]));
    }, [key, !!entry]);   // eslint-disable-line react-hooks/exhaustive-deps

    // The order's cuts: RAW segment lengths when fabrication has them (what the saw actually
    // cuts), else the plain cut length — × the build multiplier (N identical builds = N cuts,
    // never one combined length). A MITERED order pre-combines per build: angled joints must
    // all come from ONE rod so the section matches.
    const cuts = useMemo(() => {
        if (!order) return [];
        const fn = order.fabNotes || {};
        const segs = [
            { id: 'L', label: 'Left', lengthIn: num(fn.rawLeft) || num(fn.pole1) },
            { id: 'C', label: 'Center', lengthIn: num(fn.rawCenter) || num(fn.pole2) },
            { id: 'R', label: 'Right', lengthIn: num(fn.rawRight) || num(fn.pole3) },
        ].filter(s => s.lengthIn > 0);
        const ls = (order.cutList || []).filter(l => l.configQty != null);
        const m0 = ls.length ? Number(ls[0].configQty) || 1 : 1;
        const m = m0 > 1 && ls.every(l => Number(l.configQty) === m0) ? m0 : 1;
        const perBuild = segs.length ? segs : (num(order.cutLength) ? [{ id: 'P', label: 'Pole', lengthIn: num(order.cutLength) }] : []);
        if (!perBuild.length) return [];
        const miter = order.fabMethod === 'MITER' && perBuild.length > 1;
        const oneBuild = miter
            ? [{ id: 'M', label: `mitered set (${perBuild.map(s => `${s.lengthIn}"`).join(' + ')}) — ALL FROM ONE ROD`, lengthIn: Math.round(perBuild.reduce((s, c) => s + c.lengthIn, 0) * 100) / 100 }]
            : perBuild;
        return Array.from({ length: m }, (_, b) => oneBuild.map(c => ({
            ...c, id: m > 1 ? `B${b + 1}-${c.id}` : c.id, label: m > 1 ? `Build ${b + 1} · ${c.label}` : c.label,
        }))).flat();
    }, [order]);

    const logged = useMemo(() => order?.rodCutLog || {}, [order]);
    const pieceLengthIn = num(entry?.pieceLengthFt) * 12;
    const offcuts = useMemo(() => pieces.filter(p => p.status === PIECE_STATUS.OFFCUT && brandFits(p, brand)), [pieces, brand]);
    const plan = useMemo(() => planCuts({ cuts: cuts.filter(c => !logged[c.id]), pieces: offcuts, pieceLengthIn }),
        [cuts, offcuts, pieceLengthIn, logged]);   // eslint-disable-line react-hooks/exhaustive-deps

    if (!entry || !cuts.length) return null;
    const byId = new Map((plan.assignments || []).map(a => [a.cut.id, a]));

    const describe = (o) => !o ? 'no source fits'
        : o.source === 'NEW'
            ? `CUT NEW ${entry.pieceLengthFt} ft ROD — ${o.action === 'KEEP' ? `label the ${o.remainderIn}" remainder` : `${o.scrapIn}" scrap`}`
            : `USE PIECE ${o.piece.id} (${inText(o.piece.lengthIn)}) — ${o.action === 'KEEP' ? `label the ${o.remainderIn}" remainder` : o.scrapIn > 0 ? `scrap the ${o.scrapIn}"` : 'exact fit'}`;

    const doLog = async (cut) => {
        const a = byId.get(cut.id);
        const pickedId = choicePick[cut.id];
        const all = a ? [a.choice, ...a.alternatives, ...a.rejected].filter(Boolean) : [];
        const chosen = pickedId ? (pickedId === 'NEW' ? all.find(o => o.source === 'NEW') || { source: 'NEW' } : all.find(o => o.piece?.id === pickedId)) : a?.choice;
        if (!chosen) return;
        const isDead = chosen.action === 'DEAD';
        const src = chosen.source === 'NEW' ? 'NEW' : chosen.piece;
        if (src !== 'NEW' && src.virtual) return alert('That piece is the remainder of an earlier cut — log the earlier cut first, then this one will see it.');
        const what = chosen.source === 'NEW' ? `a NEW ${entry.pieceLengthFt} ft rod` : `piece ${src.id} (${inText(src.lengthIn)})`;
        if (!window.confirm(`✂ Log the ${cut.lengthIn}" cut (${cut.label}) from ${what}?${isDead ? `\n\n⚠ DEAD-ZONE OVERRIDE: this wastes ${chosen.remainderIn}" — over the 18" cap. The remainder will be scrapped.` : ''}`)) return;
        setBusy(true);
        try {
            const res = await logCut({
                source: src, cutIn: cut.lengthIn, itemCode, brand, pieceLengthIn,
                orderRef: order.woNum || order.orderKey || order.id, by: user?.name || 'Shop',
                homeBin: entry.homeBin || null, allowDeadZone: isDead,
            });
            await updateDoc(doc(db, 'shop_custom_orders', order.id), {
                [`rodCutLog.${cut.id}`]: {
                    source: chosen.source === 'NEW' ? 'NEW ROD' : src.id, outcome: res.outcome,
                    ...(res.newPiece ? { newPieceId: res.newPiece.id, remainderIn: res.newPiece.lengthIn } : {}),
                    ...(res.scrapIn ? { scrapIn: res.scrapIn, scrapFt: res.scrapFt } : {}),
                    by: user?.name || 'Shop', at: Date.now(),
                }, updatedAt: serverTimestamp(),
            });
            if (res.outcome === 'KEEP' && res.newPiece) {
                printRodPieceLabel({ pieceId: res.newPiece.id, itemCode, lengthIn: res.newPiece.lengthIn, bornOfRef: order.woNum || order.orderKey || '' });
                alert(`✂ Logged. LABEL THE REMAINDER: piece ${res.newPiece.id} — ${inText(res.newPiece.lengthIn)}. The label is printing; it goes ON the remaining pole.`);
            } else if (res.scrapIn > 0) {
                alert(`✂ Logged. The ${res.scrapIn}" remainder is SCRAP — bin it.${res.scrapFt ? ` (${res.scrapFt} ft is queued to NetSuite${res.nsStatus === 'UNRESOLVED' ? ' — could not resolve the item, HQ can retry from 6.5' : ''}.)` : ''}`);
            } else alert('✂ Logged — exact fit, nothing left over.');
        } catch (e) { alert('Could not log the cut: ' + (e.message || e)); }
        setBusy(false);
    };

    return (
        <div style={{ marginBottom: '20px', border: '1px solid var(--brass)' }}>
            <div style={{ ...mono(9), letterSpacing: '.1em', color: '#fff', background: 'var(--brass)', padding: '6px 12px', display: 'flex', justifyContent: 'space-between' }}>
                <span>✂ Rod Pieces — Cut Source</span>
                <span>{offcuts.length ? `${offcuts.length} offcut${offcuts.length > 1 ? 's' : ''} on the shelf · longest ${inText(offcuts.reduce((m, p) => Math.max(m, p.lengthIn), 0))}` : `no offcuts — new ${entry.pieceLengthFt} ft rods`}</span>
            </div>
            {cuts.map((cut, i) => {
                const done = logged[cut.id];
                const a = byId.get(cut.id);
                const options = a ? [a.choice, ...a.alternatives].filter(Boolean) : [];
                const picked = choicePick[cut.id];
                return (
                    <div key={cut.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderTop: i ? '1px solid var(--line)' : 'none', background: done ? '#f0f7f1' : '#fff', flexWrap: 'wrap' }}>
                        <span style={{ ...mono(10), color: 'var(--ink-soft)', minWidth: '110px' }}>{cut.label}</span>
                        <span style={{ fontFamily: 'var(--sans)', fontSize: '0.95rem', fontWeight: 600, color: 'var(--ink)', minWidth: '58px' }}>{cut.lengthIn}"</span>
                        {done ? (
                            <span style={{ flex: 1, ...mono(9), color: '#3a7d44' }}>
                                ✓ cut from {done.source}{done.newPieceId ? ` → remainder ${done.newPieceId} (${done.remainderIn}")` : ''}{done.scrapIn ? ` → ${done.scrapIn}" scrapped` : ''} · {done.by}
                            </span>
                        ) : (<>
                            <span style={{ flex: 1, fontFamily: 'var(--sans)', fontSize: '0.85rem', color: 'var(--ink)', minWidth: '220px' }}>
                                {describe(picked ? [...options, ...(a?.rejected || [])].find(o => (picked === 'NEW' ? o.source === 'NEW' : o.piece?.id === picked)) : a?.choice)}
                            </span>
                            {(options.length > 1 || (a?.rejected || []).length > 0) && (
                                <select value={picked || ''} onChange={e => setChoicePick(c => ({ ...c, [cut.id]: e.target.value }))} style={{ ...inp, padding: '6px', fontSize: '0.75rem', maxWidth: '210px' }}>
                                    <option value="">recommended</option>
                                    {options.map(o => <option key={o.piece?.id || 'NEW'} value={o.piece?.id || 'NEW'}>{o.source === 'NEW' ? `new ${entry.pieceLengthFt} ft rod` : `${o.piece.id} · ${o.piece.lengthIn}"`}</option>)}
                                    {(a?.rejected || []).map(o => <option key={o.piece.id} value={o.piece.id}>⚠ {o.piece.id} · {o.piece.lengthIn}" (dead zone)</option>)}
                                </select>
                            )}
                            <button disabled={busy || !a?.choice} onClick={() => doLog(cut)} style={{ ...btn, borderColor: 'var(--brass)', color: 'var(--brass)', opacity: busy || !a?.choice ? 0.5 : 1 }}>✂ Log Cut</button>
                        </>)}
                    </div>
                );
            })}
        </div>
    );
};

// ── THE INVENTORY / CONFIG SCREEN (HQ 6.5 + shop custom tab) ─────────────────────────────────
const RodPieceInventory = ({ vantage = 'HQ', activeBrand = null, currentUser = '' }) => {
    const isHq = vantage === 'HQ';
    const config = useRodConfig();
    const [pieces, setPieces] = useState([]);
    const [open, setOpen] = useState(isHq);            // shop: collapsed header until tapped
    const [expanded, setExpanded] = useState(null);    // codeKey with piece rows showing
    const [showHistory, setShowHistory] = useState(false);
    const [addForm, setAddForm] = useState({ code: '', lengthIn: '', brand: '' });
    const [cfgForm, setCfgForm] = useState({ code: '', pieceLengthFt: '', homeBin: '' });
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (!open) return undefined;
        return onSnapshot(collection(db, 'rod_pieces'), s => setPieces(s.docs.map(d => d.data())), () => setPieces([]));
    }, [open]);

    const mine = useMemo(() => pieces.filter(p => brandFits(p, activeBrand)), [pieces, activeBrand]);
    const offcuts = useMemo(() => mine.filter(p => p.status === PIECE_STATUS.OFFCUT), [mine]);
    const groups = useMemo(() => {
        const m = new Map();
        const keyRows = new Set([...offcuts.map(p => p.codeKey), ...(showHistory ? mine.map(p => p.codeKey) : [])]);
        // Configured items show even with zero pieces — the config row IS the declaration.
        Object.keys(config?.items || {}).forEach(k => keyRows.add(k));
        [...keyRows].forEach(k => {
            const ps = offcuts.filter(p => p.codeKey === k).sort((a, b) => b.lengthIn - a.lengthIn);
            const entry = (config?.items || {})[k] || null;
            m.set(k, { key: k, entry, code: entry?.code || ps[0]?.itemCode || k, pieces: ps, avail: honestAvailability({ pieces: ps, pieceLengthIn: num(entry?.pieceLengthFt) * 12 }) });
        });
        return [...m.values()].sort((a, b) => a.code.localeCompare(b.code));
    }, [offcuts, mine, config, showHistory]);
    const sweepable = useMemo(() => sweepScrap(offcuts), [offcuts]);

    const doScrap = async (piece, why) => {
        if (!window.confirm(`🗑 Scrap piece ${piece.id} (${inText(piece.lengthIn)} ${piece.itemCode})?${why ? `\n\n${why}` : ''}\n\nThe ledger marks it SCRAP and the feet post to NetSuite (rounded up).`)) return;
        setBusy(true);
        try {
            const entry = (config?.items || {})[piece.codeKey];
            const r = await scrapPiece({ piece, by: currentUser || vantage, homeBin: entry?.homeBin || null });
            alert(`🗑 ${piece.id} scrapped — ${r.scrapFt || 0} ft ${r.nsStatus === 'QUEUED' ? 'queued to NetSuite (11.1 sync queue)' : 'NOT posted (item unresolved — retry below)'}.`);
        } catch (e) { alert('Scrap failed: ' + (e.message || e)); }
        setBusy(false);
    };
    const doSweep = async () => {
        if (!window.confirm(`🧹 Sweep ${sweepable.length} piece${sweepable.length > 1 ? 's' : ''} under ${MIN_USABLE_IN}" to scrap?\n\n${sweepable.map(p => `${p.id} · ${p.lengthIn}" ${p.itemCode}`).join('\n')}\n\nEach posts its feet to NetSuite (rounded up).`)) return;
        setBusy(true);
        for (const p of sweepable) {
            try { await scrapPiece({ piece: p, by: currentUser || vantage, homeBin: (config?.items || {})[p.codeKey]?.homeBin || null }); }
            catch (e) { alert(`Sweep stopped at ${p.id}: ` + (e.message || e)); break; }
        }
        setBusy(false);
    };
    const doAdd = async () => {
        const lengthIn = num(addForm.lengthIn);
        if (!addForm.code.trim() || !lengthIn) return alert('Item code and length (inches) are required.');
        setBusy(true);
        try {
            const b = addForm.brand || (activeBrand && activeBrand !== 'all' ? activeBrand : '');
            const p = await createPiece({ itemCode: addForm.code.trim(), brand: b, lengthIn, bornOf: { fromPieceId: 'FULL', orderRef: 'manual add' }, by: currentUser || vantage });
            printRodPieceLabel({ pieceId: p.id, itemCode: p.itemCode, lengthIn: p.lengthIn, bornOfRef: 'manual add' });
            setAddForm({ code: '', lengthIn: '', brand: '' });
            alert(`＋ Piece ${p.id} added — the label is printing; put it on the pole.`);
        } catch (e) { alert('Add failed: ' + (e.message || e)); }
        setBusy(false);
    };
    const saveCfg = async () => {
        const key = rodCodeKey(cfgForm.code);
        const ft = num(cfgForm.pieceLengthFt);
        if (!key || !ft) return alert('Item code and piece length (ft) are required.');
        try {
            await setDoc(doc(db, 'system', 'rod_stock_config'), { items: { [key]: { code: cfgForm.code.trim().toUpperCase(), pieceLengthFt: ft, homeBin: cfgForm.homeBin.trim().toUpperCase() || null } } }, { merge: true });
            setCfgForm({ code: '', pieceLengthFt: '', homeBin: '' });
        } catch (e) { alert('Could not save: ' + (e.message || e)); }
    };
    const dropCfg = async (key, code) => {
        if (!window.confirm(`Remove the piece-length declaration for ${code}? Existing ledger pieces stay; the cut station stops recommending for it.`)) return;
        try { await updateDoc(doc(db, 'system', 'rod_stock_config'), { [`items.${key}`]: deleteField() }); }
        catch (e) { alert('Could not remove: ' + (e.message || e)); }
    };

    const historyRows = showHistory ? mine.filter(p => p.status !== PIECE_STATUS.OFFCUT).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 25) : [];

    return (
        <div style={{ background: '#fff', border: '1px solid var(--line)', marginBottom: '24px' }}>
            <div onClick={() => setOpen(o => !o)} style={{ padding: '12px 20px', borderBottom: open ? '1px solid var(--line)' : 'none', background: 'var(--paper)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontFamily: 'var(--serif)', fontSize: '1.1rem', color: 'var(--ink)' }}>📏 Rod Piece Inventory <span style={{ ...mono(9), color: 'var(--ink-soft)' }}>· offcuts by the piece — what feet can't tell you</span></span>
                <span style={{ ...mono(9), color: 'var(--ink-soft)' }}>{open ? '▾ hide' : `▸ show${offcuts.length ? ` (${offcuts.length} offcuts)` : ''}`}</span>
            </div>
            {open && (
                <div style={{ padding: '16px 20px' }}>
                    {sweepable.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', marginBottom: '14px', background: '#fff8e6', border: '1px solid var(--brass)' }}>
                            <span style={{ flex: 1, ...mono(10), color: 'var(--ink)' }}>⚠ {sweepable.length} piece{sweepable.length > 1 ? 's' : ''} under {MIN_USABLE_IN}" — unusable, standing sweep says scrap</span>
                            <button disabled={busy} onClick={doSweep} style={{ ...btn, borderColor: 'var(--brass)', color: 'var(--brass)' }}>🧹 Sweep to scrap</button>
                        </div>
                    )}
                    {groups.length === 0 && <div style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--sans)', marginBottom: '12px' }}>No offcut pieces{isHq ? ' — declare a rod\'s piece length below, then pieces are born at the shop cut station.' : ' yet — they are born when a rod is cut.'}</div>}
                    {groups.map(g => (
                        <div key={g.key} style={{ border: '1px solid var(--line)', marginBottom: '10px' }}>
                            <div onClick={() => setExpanded(x => x === g.key ? null : g.key)} style={{ display: 'flex', alignItems: 'baseline', gap: '14px', padding: '9px 12px', cursor: 'pointer', background: 'var(--paper-2)' }}>
                                <span style={{ fontFamily: 'var(--sans)', fontWeight: 600, fontSize: '0.95rem', color: 'var(--ink)', minWidth: '120px' }}>{g.code}</span>
                                <span style={{ ...mono(9), color: 'var(--ink-soft)', flex: 1 }}>
                                    {g.entry ? `stocked ${g.entry.pieceLengthFt} ft` : '⚠ no piece length declared (HQ 6.5)'}
                                    {g.pieces.length ? ` · ${g.pieces.length} offcut${g.pieces.length > 1 ? 's' : ''} = ${Math.round(g.avail.offcutIn / 12 * 10) / 10} ft · longest ${inText(g.avail.longestIn)}` : ' · no offcuts'}
                                </span>
                                <span style={{ ...mono(9), color: 'var(--ink-soft)' }}>{expanded === g.key ? '▾' : '▸'}</span>
                            </div>
                            {expanded === g.key && g.pieces.map(p => (
                                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 12px', borderTop: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.85rem' }}>
                                    <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', fontWeight: 700, color: 'var(--ink)', minWidth: '120px' }}>{p.id}</span>
                                    <span style={{ fontWeight: 600, minWidth: '100px', color: p.lengthIn < MIN_USABLE_IN ? '#d9534f' : 'var(--ink)' }}>{inText(p.lengthIn)}</span>
                                    <span style={{ flex: 1, color: 'var(--ink-soft)', fontSize: '0.78rem' }}>
                                        {ago(p.createdAt)} old · from {p.bornOf?.fromPieceId === 'FULL' ? 'a full rod' : p.bornOf?.fromPieceId}{p.bornOf?.orderRef ? ` · ${p.bornOf.orderRef}` : ''}{p.brand ? ` · ${p.brand.toUpperCase()}` : ''}
                                    </span>
                                    <button onClick={() => printRodPieceLabel({ pieceId: p.id, itemCode: p.itemCode, lengthIn: p.lengthIn, bornOfRef: p.bornOf?.orderRef || '' })} style={btn} title="Reprint the piece label">🖨</button>
                                    <button disabled={busy} onClick={() => doScrap(p)} style={{ ...btn, color: '#d9534f', borderColor: '#d9534f' }} title="Scrap this piece — posts the feet to NetSuite">🗑</button>
                                </div>
                            ))}
                            {expanded === g.key && !g.pieces.length && <div style={{ padding: '8px 12px', borderTop: '1px solid var(--line)', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--sans)', fontSize: '0.8rem' }}>No offcuts — shelf stock is full rods only.</div>}
                        </div>
                    ))}

                    {/* Bootstrapping + corrections: the shelf already holds unlabelled offcuts today. */}
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '14px', flexWrap: 'wrap' }}>
                        <span style={{ ...mono(9), color: 'var(--ink-soft)' }}>＋ Add a standing piece:</span>
                        <input placeholder="Item code (H1-138R)" value={addForm.code} onChange={e => setAddForm(f => ({ ...f, code: e.target.value }))} style={{ ...inp, width: '150px' }} />
                        <input placeholder='Length (in)' type="number" value={addForm.lengthIn} onChange={e => setAddForm(f => ({ ...f, lengthIn: e.target.value }))} style={{ ...inp, width: '90px' }} />
                        <select value={addForm.brand} onChange={e => setAddForm(f => ({ ...f, brand: e.target.value }))} style={{ ...inp, width: '90px' }}>
                            <option value="">brand…</option>
                            {['ce', 'm2c', 'uniquity', 'leyla'].map(b => <option key={b} value={b}>{b.toUpperCase()}</option>)}
                        </select>
                        <button disabled={busy} onClick={doAdd} style={{ ...btn, borderColor: 'var(--ink)', background: 'var(--ink)', color: '#fff' }}>＋ Add & label</button>
                        <button onClick={() => setShowHistory(h => !h)} style={{ ...btn, marginLeft: 'auto' }}>{showHistory ? 'hide history' : '🕘 recent consumed/scrap'}</button>
                    </div>

                    {showHistory && (
                        <div style={{ marginTop: '10px', border: '1px solid var(--line)' }}>
                            {historyRows.length === 0 && <div style={{ padding: '8px 12px', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--sans)', fontSize: '0.8rem' }}>Nothing consumed or scrapped yet.</div>}
                            {historyRows.map((p, i) => (
                                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 12px', borderTop: i ? '1px solid var(--line)' : 'none', fontFamily: 'var(--sans)', fontSize: '0.8rem', color: 'var(--ink-soft)' }}>
                                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', minWidth: '110px' }}>{p.id}</span>
                                    <span style={{ ...mono(8), color: p.status === PIECE_STATUS.SCRAP ? '#d9534f' : '#3a7d44', minWidth: '70px' }}>{p.status}</span>
                                    <span style={{ flex: 1 }}>{p.itemCode} · {inText(p.lengthIn)}{p.scrapFt ? ` · ${p.scrapFt} ft scrapped` : ''}{(p.history || []).slice(-1).map(h => ` · ${h.outcome}${h.orderRef ? ` (${h.orderRef})` : ''}`)}</span>
                                    {p.status === PIECE_STATUS.SCRAP && p.nsStatus === 'UNRESOLVED' && (
                                        <button disabled={busy} onClick={async () => { setBusy(true); try { const r = await retryScrapPost({ piece: p, by: currentUser || vantage, homeBin: (config?.items || {})[p.codeKey]?.homeBin || null }); alert(r.nsStatus === 'QUEUED' ? '✅ Queued to NetSuite.' : '⚠ Still unresolved — is the item\'s NetSuite internal id imported?'); } catch (e) { alert('Retry failed: ' + (e.message || e)); } setBusy(false); }} style={{ ...btn, color: 'var(--brass)', borderColor: 'var(--brass)' }}>⟳ post to NS</button>
                                    )}
                                    {p.status === PIECE_STATUS.SCRAP && p.nsStatus === 'QUEUED' && <span style={{ ...mono(8), color: '#3a7d44' }}>NS queued</span>}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* THE DECLARATION (HQ only): how each rod item is stocked. This row is what
                        turns the cut station on for an item — no piece length, no recommendation. */}
                    {isHq && (
                        <div style={{ marginTop: '18px', paddingTop: '14px', borderTop: '1px dashed var(--line)' }}>
                            <div style={{ ...mono(9), color: 'var(--brass)', marginBottom: '8px' }}>Stocked piece lengths (the 6.5 declaration — one row per rod item; finish suffixes match automatically)</div>
                            {Object.entries(config?.items || {}).sort((a, b) => (a[1].code || '').localeCompare(b[1].code || '')).map(([k, e]) => (
                                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '6px 0', fontFamily: 'var(--sans)', fontSize: '0.85rem' }}>
                                    <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', fontWeight: 700, minWidth: '130px', color: 'var(--ink)' }}>{e.code}</span>
                                    <span style={{ color: 'var(--ink-soft)' }}>{e.pieceLengthFt} ft pieces{e.homeBin ? ` · bin ${e.homeBin}` : ''}</span>
                                    <button onClick={() => dropCfg(k, e.code)} style={{ ...btn, marginLeft: 'auto', color: '#d9534f', borderColor: '#d9534f' }}>remove</button>
                                </div>
                            ))}
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px', flexWrap: 'wrap' }}>
                                <input placeholder="Item code (H1-138R)" value={cfgForm.code} onChange={e => setCfgForm(f => ({ ...f, code: e.target.value }))} style={{ ...inp, width: '150px' }} />
                                <input placeholder="Piece length (ft)" type="number" value={cfgForm.pieceLengthFt} onChange={e => setCfgForm(f => ({ ...f, pieceLengthFt: e.target.value }))} style={{ ...inp, width: '120px' }} />
                                <input placeholder="Home bin (opt)" value={cfgForm.homeBin} onChange={e => setCfgForm(f => ({ ...f, homeBin: e.target.value }))} style={{ ...inp, width: '120px' }} />
                                <button onClick={saveCfg} style={{ ...btn, borderColor: 'var(--ink)', background: 'var(--ink)', color: '#fff' }}>Save</button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default RodPieceInventory;
