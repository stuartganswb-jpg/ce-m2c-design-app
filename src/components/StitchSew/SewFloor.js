// ── STITCH & SEW · FLOOR (S7, step 5b) ──────────────────────────────────────────────────────────
// The staged sewing documents and their four zones — CUT · SEW · STUFF · PACK — one at a time, Start then
// Complete (Shared/sewFloor, pure). Completing CUT asks the cutter what fabric is left and its usable size
// (Stuart: "prompted for any remaining fabric and what is usable size") and files it in the fabric cut ledger
// with a printed label (Shared/fabricPieceLedger). Completing PACK completes the document the way every floor
// does — currentPhase 'Complete' + completedAt — and tells RTG; SO Pack takes it from there.
import React, { useState } from 'react';
import { finishingDb as db } from '../../firebase';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { woRefOf } from '../Shared/woRef';
import { SEW_ZONES, SEW_ZONE_LABELS, zoneStateOf, currentZoneOf, zoneStartCheck, zoneCompleteCheck, zoneStartPatchOf, zoneCompletePatchOf, remainderRowsOf, remainderPiecesOf, SEW_PHASE_OF_ZONE } from '../Shared/sewFloor';
import { createFabricPiece } from '../Shared/fabricPieceLedger';
import { pieceLabelOf } from '../Shared/fabricPieces';
import { printFabricPieceLabel } from '../Shared/FabricCutStock';
import { sewStyles as S } from './StitchSew';
import { SewDocHeader } from './SewQueue';

const ZONE_ICON = { CUT: '✂️', SEW: '🪡', STUFF: '☁️', PACK: '📦' };

const SewFloor = ({ docs = [], user, findPart, writeLog, tellRtg }) => {
    const [busy, setBusy] = useState('');
    const [cutAsk, setCutAsk] = useState(null);   // { doc, rows, err }
    const by = (user && user.name) || 'Sew';

    const startZone = async (d, z) => {
        const why = zoneStartCheck(d, z);
        if (why) return alert(`${woRefOf(d)}: ${why}.`);
        setBusy(d.id);
        try {
            await updateDoc(doc(db, 'fin_workorders', d.id), zoneStartPatchOf(d, z, { by }));
            writeLog(`${SEW_ZONE_LABELS[z]} started on ${woRefOf(d)}`);
            await tellRtg(d, SEW_PHASE_OF_ZONE[z]);
        } catch (e) { alert(`Could not start ${SEW_ZONE_LABELS[z]}: ${e.message || e}`); }
        setBusy('');
    };
    const completeZone = async (d, z, remainders = null) => {
        const why = zoneCompleteCheck(d, z);
        if (why) return alert(`${woRefOf(d)}: ${why}.`);
        setBusy(d.id);
        try {
            const patch = zoneCompletePatchOf(d, z, { by });
            const extra = {};
            if (z === 'CUT' && remainders) {
                const made = [];
                for (const r of remainders.pieces) {
                    const fabric = findPart(r.itemCode);
                    const piece = await createFabricPiece({ itemCode: r.itemCode, brand: 'uniquity', lengthIn: r.lengthIn, widthIn: r.widthIn, bornOf: { from: 'ROLL', orderRef: woRefOf(d) }, by });
                    const label = pieceLabelOf(piece, { fabric, config: null });
                    printFabricPieceLabel({ pieceId: piece.id, itemCode: piece.itemCode, lengthIn: piece.lengthIn, widthIn: piece.widthIn, upTo: label.text, bornOfRef: woRefOf(d) });
                    made.push({ pieceId: piece.id, itemCode: piece.itemCode, lengthIn: piece.lengthIn, widthIn: piece.widthIn, at: Date.now(), by });
                }
                extra.remainders = arrayUnion(...(made.length ? made : [{ none: true, at: Date.now(), by }]));
            }
            await updateDoc(doc(db, 'fin_workorders', d.id), { ...patch, ...extra });
            const isLast = z === SEW_ZONES[SEW_ZONES.length - 1];
            writeLog(`${SEW_ZONE_LABELS[z]} complete on ${woRefOf(d)}${isLast ? ' — pillows COMPLETE, to SO Pack' : ''}${remainders ? ` · ${remainders.pieces.length} remainder cut(s) into the ledger` : ''}`);
            await tellRtg(d, isLast ? 'Complete' : patch.currentPhase);
        } catch (e) { alert(`Could not complete ${SEW_ZONE_LABELS[z]}: ${e.message || e}`); }
        setBusy('');
    };
    const askCut = (d) => {
        const why = zoneCompleteCheck(d, 'CUT');
        if (why) return alert(`${woRefOf(d)}: ${why}.`);
        const rows = remainderRowsOf(d, findPart);
        if (!rows.length) return completeZone(d, 'CUT', { pieces: [] });
        setCutAsk({ doc: d, rows, err: '' });
    };
    const submitCut = async () => {
        if (!cutAsk) return;
        const r = remainderPiecesOf(cutAsk.rows);
        if (!r.ok) { setCutAsk(p => ({ ...p, err: r.errors.join(' · ') })); return; }
        const d = cutAsk.doc;
        setCutAsk(null);
        await completeZone(d, 'CUT', r);
    };
    const setRow = (i, k, v) => setCutAsk(p => ({ ...p, err: '', rows: p.rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }));

    if (!docs.length) return <div style={{ ...S.card, color: '#777' }}>Nothing on the floor. Stage a document from the queue once the WMS has picked and matched it.</div>;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {cutAsk && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div style={{ ...S.card, width: 'min(680px, 94vw)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div style={S.mono}>{woRefOf(cutAsk.doc)} · Cut complete</div>
                        <h3 style={{ margin: 0, fontFamily: 'var(--serif, serif)', fontWeight: 500 }}>What fabric is left, and what size is usable?</h3>
                        <div style={{ fontSize: '0.85rem', color: '#555' }}>For each fabric pulled: the length left along the roll and its width, or tick none. Each remainder gets a cut label and shows under Cut Stock with the largest pillow it still makes.</div>
                        {cutAsk.rows.map((r, i) => (
                            <div key={r.code} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr auto', gap: '8px', alignItems: 'center', border: '1px solid #e6e6e6', padding: '10px', opacity: r.none ? 0.55 : 1 }}>
                                <div><div style={{ fontWeight: 600 }}>{r.code}</div><div style={{ fontSize: '0.8rem', color: '#777' }}>{r.name} · pulled {r.pulledYards} yd{r.widthIn ? ` · ${r.widthIn}" bolt` : ''}</div></div>
                                <input value={r.lengthIn} disabled={r.none} onChange={e => setRow(i, 'lengthIn', e.target.value)} placeholder="length left (in)" inputMode="decimal" style={S.field} />
                                <input value={r.remWidthIn} disabled={r.none} onChange={e => setRow(i, 'remWidthIn', e.target.value)} placeholder="width (in)" inputMode="decimal" style={S.field} />
                                <label style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}><input type="checkbox" checked={r.none} onChange={e => setRow(i, 'none', e.target.checked)} /> none</label>
                            </div>
                        ))}
                        {cutAsk.err && <div style={{ color: '#d9534f', fontSize: '0.85rem' }}>{cutAsk.err}</div>}
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                            <button onClick={() => setCutAsk(null)} style={S.btn(false, false)}>Back</button>
                            <button onClick={submitCut} style={S.btn(true, false)}>Complete Cut</button>
                        </div>
                    </div>
                </div>
            )}
            {docs.map(d => {
                const zs = zoneStateOf(d);
                const cur = currentZoneOf(d);
                return (
                    <div key={d.id} style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <SewDocHeader d={d} />
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '8px' }}>
                            {(d.pillows || []).map((p, i) => (
                                <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'center', border: '1px solid #e6e6e6', padding: '8px', background: '#fafafa' }}>
                                    {p.snapshot ? <img src={p.snapshot} alt="pillow" style={{ width: '70px', height: '42px', objectFit: 'cover', border: '1px solid #ddd' }} /> : null}
                                    <div style={{ fontSize: '0.85rem' }}>
                                        <div style={{ fontWeight: 600 }}>{p.qty} × {p.sizeKey}{p.group ? ` · ${p.group}` : ''}</div>
                                        <div style={{ color: '#777', fontSize: '0.78rem' }}>{p.minCut ? `cut ${p.minCut.lengthIn}" × ${p.minCut.widthIn}" per side` : ''}{(p.panels || []).length > 1 ? ` · ${p.panels.length} panels` : ''}</div>
                                        {(p.sourced || []).length > 0 && <div style={{ color: '#a86b00', fontSize: '0.78rem' }}>TO BE SOURCED: {p.sourced.map(s => s.code).join(', ')}</div>}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${SEW_ZONES.length}, 1fr)`, gap: '8px' }}>
                            {SEW_ZONES.map(z => {
                                const st = zs[z];
                                const isCur = cur === z;
                                const tone = st === 'Complete' ? '#2e7d32' : (st === 'Running' ? '#a86b00' : '#999');
                                return (
                                    <div key={z} style={{ border: `2px solid ${isCur ? '#1a1a1a' : '#e6e6e6'}`, padding: '10px', borderRadius: '2px', display: 'flex', flexDirection: 'column', gap: '6px', background: st === 'Complete' ? '#f3f8f3' : '#fff' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                            <span style={{ fontWeight: 700 }}>{ZONE_ICON[z]} {SEW_ZONE_LABELS[z]}</span>
                                            <span style={{ ...S.mono, color: tone }}>{st}</span>
                                        </div>
                                        {d.zoneLog && d.zoneLog[z] && (d.zoneLog[z].startedBy || d.zoneLog[z].completedBy) ? <div style={{ fontSize: '0.75rem', color: '#777' }}>{d.zoneLog[z].startedBy ? `started ${d.zoneLog[z].startedBy}` : ''}{d.zoneLog[z].completedBy ? ` · done ${d.zoneLog[z].completedBy}` : ''}</div> : null}
                                        {isCur && st === 'Pending' && <button onClick={() => startZone(d, z)} disabled={busy === d.id} style={S.btn(true, busy === d.id)}>Start</button>}
                                        {isCur && st === 'Running' && <button onClick={() => (z === 'CUT' ? askCut(d) : completeZone(d, z))} disabled={busy === d.id} style={S.btn(true, busy === d.id)}>{z === 'PACK' ? 'Complete · pillows done' : 'Complete'}</button>}
                                    </div>
                                );
                            })}
                        </div>
                        {(d.remainders || []).filter(r => !r.none).length > 0 && (
                            <div style={{ fontSize: '0.8rem', color: '#555' }}>Remainders into Cut Stock: {d.remainders.filter(r => !r.none).map(r => `${r.pieceId} ${r.itemCode} ${r.lengthIn}" × ${r.widthIn}"`).join(' · ')}</div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export default SewFloor;
