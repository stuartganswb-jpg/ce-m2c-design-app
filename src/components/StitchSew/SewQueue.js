// ── STITCH & SEW · QUEUE (S7, step 5b) ──────────────────────────────────────────────────────────
// The sewing documents not yet on the floor: what each is (the pillows, the pulls), where it stands with the
// WMS (pick · staging), and the two actions the finishing Setup Queue has — ▶ Start (the document is Running;
// its pick was released at birth) and 🧵 To the floor (only once the WMS staging handshake matched the label —
// Shared/orderStatus.stageWaitsOnMatch, the one rule every floor reads) — plus the staging label reprint.
import React, { useState } from 'react';
import { finishingDb as db } from '../../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { stageWaitsOnMatch, stagingMatched } from '../Shared/orderStatus';
import { holdGateOf } from '../Shared/OrderStatusChips';
import { woRefOf } from '../Shared/woRef';
import { printSetupLabel } from '../Shared/labelPrint';
import { sewLabelOf, sewPhaseOf } from '../Shared/sewFloor';
import { sewStyles as S } from './StitchSew';

const PillowCard = ({ p }) => (
    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', border: '1px solid #e6e6e6', padding: '8px', background: '#fafafa', borderRadius: '2px' }}>
        {p.snapshot ? <img src={p.snapshot} alt="pillow" style={{ width: '80px', height: '48px', objectFit: 'cover', border: '1px solid #ddd' }} /> : null}
        <div style={{ fontSize: '0.9rem' }}>
            <div style={{ fontWeight: 600 }}>{p.qty} × {p.sizeKey || '?'}{p.group ? ` · group ${p.group}` : ''}</div>
            <div style={{ color: '#777', fontSize: '0.8rem' }}>{p.summary || ''}{p.minCut ? ` · cut ${p.minCut.lengthIn}" × ${p.minCut.widthIn}" per side` : ''}</div>
            {(p.sourced || []).length > 0 && <div style={{ color: '#a86b00', fontSize: '0.8rem' }}>TO BE SOURCED: {p.sourced.map(s => s.code).join(', ')}</div>}
        </div>
    </div>
);

export const SewDocHeader = ({ d }) => (
    <div style={{ display: 'flex', gap: '14px', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--mono, monospace)', fontWeight: 700, fontSize: '1.05rem' }}>{woRefOf(d)}</span>
        <span style={{ fontWeight: 600 }}>{d.customer || ''}</span>
        {d.rowLabel ? <span style={S.mono}>{d.rowLabel}</span> : null}
        <span style={S.mono}>{d.totalPillows || d.totalParts || 0} pillow(s)</span>
        {d.needBy ? <span style={{ ...S.mono, color: '#a86b00' }}>need by {d.needBy}</span> : null}
        <span style={{ marginLeft: 'auto', ...S.mono }}>{sewPhaseOf(d)}</span>
    </div>
);

const SewQueue = ({ docs = [], user, findPart, writeLog, tellRtg }) => {
    const [busy, setBusy] = useState('');
    const by = (user && user.name) || 'Sew';

    const start = async (d) => {
        const hold = holdGateOf(d);
        if (hold) return alert(`${hold.label} — ${woRefOf(d)} cannot start.\n\n${hold.reason}\n\n${hold.liftedBy}`);
        setBusy(d.id);
        try {
            await updateDoc(doc(db, 'fin_workorders', d.id), { stepStatus: 'Running', startedSetupAt: Date.now(), startedSetupBy: by, ...(d.sentToPickPack ? {} : { sentToPickPack: true, pickStatus: d.pickStatus || 'Pending', sentToPickPackAt: Date.now() }) });
            writeLog(`Started ${woRefOf(d)} (Stitch & Sew) — the fabric pull is with the WMS`);
            await tellRtg(d, 'Setup');
        } catch (e) { alert(`Could not start: ${e.message || e}`); }
        setBusy('');
    };
    const toFloor = async (d) => {
        const hold = holdGateOf(d);
        if (hold) return alert(`${hold.label} — ${woRefOf(d)} cannot be staged.\n\n${hold.reason}\n\n${hold.liftedBy}`);
        const wait = stageWaitsOnMatch(d);
        if (wait) return alert(`⏳ ${woRefOf(d)} — ${wait}.\n\nThe fabric, inserts and zippers are picked by the WMS into the staging bin and the label is scanned there; then it comes to the floor.`);
        setBusy(d.id);
        try {
            await updateDoc(doc(db, 'fin_workorders', d.id), { stepStatus: 'Staged', currentPhase: 'Cutting', currentStepIndex: 0, stagedToFloorAt: Date.now(), stagedToFloorBy: by });
            writeLog(`Staged ${woRefOf(d)} to the Stitch & Sew floor`);
            await tellRtg(d, 'Cutting');
        } catch (e) { alert(`Could not stage: ${e.message || e}`); }
        setBusy('');
    };

    if (!docs.length) return <div style={{ ...S.card, color: '#777' }}>No pillows waiting. A custom pillow arrives here when its Order Entry sales order starts on RTG.</div>;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {docs.map(d => {
                const matched = stagingMatched(d);
                const wait = stageWaitsOnMatch(d);
                return (
                    <div key={d.id} style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <SewDocHeader d={d} />
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '8px' }}>
                            {(d.pillows || []).map((p, i) => <PillowCard key={i} p={p} />)}
                        </div>
                        <div style={{ fontSize: '0.85rem' }}>
                            <div style={{ ...S.mono, marginBottom: '4px' }}>Pulls</div>
                            {(d.partsList || []).map((p, i) => (
                                <div key={i} style={{ display: 'flex', gap: '10px', padding: '2px 0', borderBottom: '1px dotted #e6e6e6' }}>
                                    <span style={{ fontWeight: 600, minWidth: '140px' }}>{p.legacyErpId}</span>
                                    <span style={{ flex: 1, color: '#555' }}>{p.partName}</span>
                                    <span>{p.quantity} {String(p.uom || '').toUpperCase() === 'YARD' ? 'yd' : 'ea'}</span>
                                    <span style={S.mono}>{p.binLocation || ''}</span>
                                </div>
                            ))}
                        </div>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ ...S.mono, color: matched ? '#2e7d32' : '#a86b00' }}>WMS: {d.pickStatus || 'Pending'}{matched ? ' · staged & matched' : (wait ? ` · ${wait}` : '')}</span>
                            <span style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                                <button onClick={() => printSetupLabel(sewLabelOf(d))} style={S.btn(false, false)} title="Reprint the staging label">🖨 Label</button>
                                {String(d.stepStatus || '').toUpperCase() !== 'RUNNING' && <button onClick={() => start(d)} disabled={busy === d.id} style={S.btn(false, busy === d.id)}>▶ Start</button>}
                                <button onClick={() => toFloor(d)} disabled={busy === d.id || !!wait} style={S.btn(true, busy === d.id || !!wait)} title={wait || 'Stage to the floor'}>🧵 To the floor</button>
                            </span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default SewQueue;
