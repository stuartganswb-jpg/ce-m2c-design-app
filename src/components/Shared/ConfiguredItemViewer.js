import React, { useState, useEffect, Suspense } from 'react';
import { db } from '../../firebase';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Bounds } from '@react-three/drei';
import { DynamicModel, EngineeringSpecsStrip } from '../HQ/CPQTab';
import { StudioRig } from './studioScene';

// Read-only viewer for a CONFIRMED configured item, opened from the shop floor / finishing floor /
// HQ work-order windows. Loads the saved job by quoteId, re-renders the frozen `renderState`
// snapshot LIVE (spin/zoom only — no editing, since by the time the floor sees it the order is
// confirmed), and shows the engineering-spec roll-up beside it. Tablet-friendly: the body wraps to
// a single column on narrow screens. Self-contained modal — each host just renders
// <ConfiguredItemViewer quoteId={...} onClose={fn} />. Optional initialLine opens directly on
// that cart line (shop-floor per-configuration View buttons); the dropdown still switches.
const ConfiguredItemViewer = ({ quoteId, onClose, initialLine = 0 }) => {
    const [job, setJob] = useState(null);
    const [parts, setParts] = useState([]);
    const [flowsById, setFlowsById] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [lineIdx, setLineIdx] = useState(Number(initialLine) > 0 ? Number(initialLine) : 0);

    useEffect(() => {
        let alive = true;
        (async () => {
            setLoading(true); setError(null); setJob(null);
            if (!quoteId) { setError('No order id provided.'); setLoading(false); return; }
            try {
                const snap = await getDoc(doc(db, 'jobs', quoteId));
                if (!alive) return;
                if (!snap.exists()) { setError(`No saved job found for "${quoteId}".`); setLoading(false); return; }
                const jobData = { id: snap.id, ...snap.data() };
                setJob(jobData);
                // Parts let the spec strip resolve Vision-pick ids -> names; non-fatal if it fails.
                try {
                    const ps = await getDocs(collection(db, 'Approved_Designs'));
                    if (alive) setParts(ps.docs.map(d => ({ id: d.id, ...d.data() })));
                } catch (e) { /* names fall back to ids */ }
                // Each line's flow: needed to surface the HIDDEN includedParts accessories (bushings
                // etc.) the floor must pull — they never appear as priced breakdown lines.
                try {
                    const ids = [...new Set((jobData.cpqData?.cartItems || []).map(it => it.flowId).filter(Boolean))];
                    const fetched = {};
                    for (const fid of ids) {
                        const fs = await getDoc(doc(db, 'cpq_flows', fid));
                        if (fs.exists()) fetched[fid] = { id: fs.id, ...fs.data() };
                    }
                    if (alive) setFlowsById(fetched);
                } catch (e) { /* accessories section just stays empty */ }
            } catch (e) {
                if (alive) setError(e.message || 'Failed to load configuration.');
            }
            if (alive) setLoading(false);
        })();
        return () => { alive = false; };
    }, [quoteId]);

    const savedItems = job?.cpqData?.cartItems || [];
    const items = savedItems.length
        ? savedItems
        : (job ? [{ assemblyName: job.jobName, sidemark: job.sidemark, engineeringNotes: job.engineeringNotes, spatialData: job.spatialData, renderState: null }] : []);
    const item = items[Math.min(lineIdx, Math.max(0, items.length - 1))] || null;
    const rs = item?.renderState || null;
    // Overrides are saved as entry-arrays (their keys are GLB node names Firestore won't store as
    // field names); rebuild the node-name -> value maps DynamicModel expects, in memory.
    const texMap = {}, visMap = {};
    if (rs) {
        (rs.textureEntries || []).forEach(e => { if (e && e.target != null) texMap[e.target] = e.url; });
        (rs.visibilityEntries || []).forEach(e => { if (e && e.target != null) visMap[e.target] = e.visible; });
    }
    const notes = item?.engineeringNotes || job?.engineeringNotes || null;
    const breakdown = (item?.pricingBreakdown || []).filter(l => l && !l.isHeader);
    const svg = item?.draftSvg || null;
    const rawHangers = (notes && Array.isArray(notes.hangerLocations)) ? notes.hangerLocations : [];
    const bracketNotes = Array.isArray(item?.bracketNotes) ? item.bracketNotes : [];
    // Prefer hangerLocations (nicer edge-relative positions); else fall back to the raw note boxes.
    const hangers = rawHangers.length
        ? rawHangers
        : bracketNotes.map((b, i) => ({
            anchor: `${b.type === 'splice' ? 'Splice' : 'Bracket'} ${i + 1}`,
            position: (b.dist != null) ? `${b.dist}" from ${b.ref === 'END' ? 'end' : 'start'}` : '',
            note: b.note || ''
        }));
    const general = Array.isArray(item?.generalNotes) ? item.generalNotes : [];
    // HIDDEN / ACCESSORY items (bushings & co): flow steps carry them as includedParts — auto-added
    // to the BOM whenever the step is taken, never priced lines. Mirror the push's "taken" rule
    // (blank qty = 1; explicit 0 = not taken; selection-only steps heal to 1) so the floor sees
    // exactly what the NetSuite push consumes.
    const partFor = (pid) => parts.find(x => x.id === pid || x.itemId === pid || x.legacyErpId === pid);
    const accessories = (() => {
        const flow = item?.flowId ? flowsById[item.flowId] : null;
        if (!flow) return [];
        const out = [];
        (flow.steps || []).forEach(s => {
            if (!Array.isArray(s.includedParts) || !s.includedParts.length) return;
            const sel = item?.dynamicConfigParams?.[s.id];
            const rawQty = item?.stepQuantities?.[s.id];
            let q = (rawQty === undefined || rawQty === null || rawQty === '') ? 1 : (parseInt(rawQty) || 0);
            if (q <= 0 && s.hideQty && sel) q = 1;
            const dimensional = s.type === 'DIMENSIONS' || s.type === 'VISUAL_DIMENSIONS' || !!s.calculatorTemplate;
            if (q <= 0 || !(sel || dimensional || s.linkedItemId || s.linkedPinId)) return;
            s.includedParts.forEach(ip => {
                const p = partFor(ip.partId);
                out.push({ code: (p?.legacyErpId && p.legacyErpId !== 'PENDING' ? p.legacyErpId : p?.itemId) || ip.partId, name: p?.itemName || ip.partName || '', qty: parseInt(ip.qty) || 1, via: s.title });
            });
        });
        return out;
    })();
    const pseudoDraft = job ? {
        jobName: job.jobName,
        sidemark: item?.sidemark || job.sidemark,
        // The spec strip reads picks from draft.spatialData; merge every place the ids might live
        // (visionPicks is the flat snapshot saved at checkout).
        spatialData: { ...(item?.engineeringNotes || {}), ...(job.spatialData || {}), ...(item?.visionPicks || {}) }
    } : null;

    return (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 12000, padding: '16px' }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--paper, #f7f4ee)', color: 'var(--ink, #2a2a2a)', width: 'min(1200px, 96vw)', maxHeight: '94vh', display: 'flex', flexDirection: 'column', borderRadius: '4px', boxShadow: '0 16px 60px rgba(0,0,0,0.3)', overflow: 'hidden', fontFamily: 'var(--sans)' }}>

                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '16px 20px', borderBottom: '1px solid var(--line, #ddd)', background: '#fff' }}>
                    <div>
                        <div style={{ fontFamily: 'var(--serif)', fontSize: '1.3rem', fontWeight: 500 }}>{job?.jobName || 'Configured Item'}</div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-soft, #888)', marginTop: '4px' }}>
                            Confirmed Order · Read-Only{job?.customer?.name ? ` · ${job.customer.name}` : ''}{quoteId ? ` · ${quoteId}` : ''}
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {items.length > 1 && (
                            <select value={lineIdx} onChange={e => setLineIdx(Number(e.target.value))} style={{ padding: '8px', border: '1px solid var(--line)', background: '#fff', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink)' }}>
                                {items.map((it, i) => <option key={i} value={i}>{it.sidemark || it.assemblyName || `Line ${i + 1}`}</option>)}
                            </select>
                        )}
                        <button onClick={onClose} style={{ background: 'var(--ink)', color: '#fff', border: 'none', borderRadius: '2px', padding: '8px 14px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.08em' }}>Close</button>
                    </div>
                </div>

                {/* Body */}
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: '20px', padding: '20px', alignItems: 'stretch' }}>
                    {loading && <div style={{ flex: 1, textAlign: 'center', padding: '60px', color: 'var(--ink-soft)' }}>Loading configuration…</div>}
                    {error && !loading && <div style={{ flex: 1, textAlign: 'center', padding: '60px', color: 'var(--ink-soft)' }}>{error}</div>}
                    {!loading && !error && job && (
                        <>
                            {/* Live 3D */}
                            <div style={{ flex: '1 1 440px', minWidth: '320px', minHeight: '440px', background: 'var(--paper-2, #efeae0)', border: '1px solid var(--line)', borderRadius: '2px', position: 'relative' }}>
                                {rs?.cadUrl ? (
                                    <Canvas camera={{ position: [5, 5, 5], fov: 50 }} dpr={[1, 2]} gl={{ antialias: true }} style={{ width: '100%', height: '100%' }}>
                                        <Suspense fallback={null}>
                                            <StudioRig />
                                            <Bounds fit clip margin={1.2}>
                                                <DynamicModel
                                                    url={rs.cadUrl}
                                                    textureOverrides={texMap}
                                                    visibilityOverrides={visMap}
                                                    cloneSpecs={rs.cloneSpecs}
                                                />
                                            </Bounds>
                                        </Suspense>
                                        <OrbitControls makeDefault />
                                    </Canvas>
                                ) : (
                                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: 'var(--ink-soft)', padding: '24px', fontSize: '0.9rem', lineHeight: 1.5 }}>
                                        Live 3D preview wasn't captured for this order.<br />(Re-open &amp; re-save it in CPQ to enable the spin-able model.)
                                    </div>
                                )}
                                <div style={{ position: 'absolute', bottom: '10px', left: '12px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-soft)', background: 'rgba(255,255,255,0.8)', padding: '3px 8px', borderRadius: '2px' }}>Drag to rotate · scroll to zoom</div>
                            </div>

                            {/* Bracket locations + general notes — right after the model so the drill
                                points aren't buried below the fold (brass border to stand out) */}
                            {(hangers.length > 0 || general.length > 0) && (
                                <div style={{ flex: '1 1 360px', minWidth: '300px', maxHeight: '440px', overflowY: 'auto', background: '#fff', border: '1px solid var(--brass)', borderRadius: '2px', padding: '14px 16px' }}>
                                    <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--ink)', display: 'block', marginBottom: '8px', borderBottom: '1px solid var(--line)', paddingBottom: '5px' }}>Bracket Locations &amp; Notes</span>
                                    {hangers.map((h, i) => (
                                        <div key={i} style={{ padding: '6px 0', borderBottom: '1px dashed var(--line)' }}>
                                            <div style={{ fontSize: '0.8rem', color: 'var(--ink)' }}><strong style={{ fontWeight: 500 }}>{h.anchor}</strong>{h.position ? <span style={{ color: 'var(--ink-soft)' }}> · {h.position}</span> : null}</div>
                                            {h.note && <div style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', fontStyle: 'italic', marginTop: '2px' }}>“{h.note}”</div>}
                                        </div>
                                    ))}
                                    {general.length > 0 && (
                                        <div style={{ marginTop: hangers.length ? '12px' : 0 }}>
                                            <div style={{ fontFamily: 'var(--mono)', fontSize: '8px', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-soft)', marginBottom: '4px' }}>General Notes</div>
                                            {general.map((t, i) => <div key={i} style={{ fontSize: '0.8rem', color: 'var(--ink)', padding: '4px 0', borderBottom: '1px dashed var(--line)' }}>• {t}</div>)}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Engineering specs roll-up */}
                            <div style={{ flex: '1 1 360px', minWidth: '300px', display: 'flex' }}>
                                {notes
                                    ? <EngineeringSpecsStrip draft={pseudoDraft} notes={notes} parts={parts} hideHangers />
                                    : <div style={{ flex: 1, color: 'var(--ink-soft)', padding: '20px' }}>No engineering specs recorded on this order.</div>}
                            </div>

                            {/* Bill of Materials / factory router */}
                            <div style={{ flex: '1 1 360px', minWidth: '300px', maxHeight: '320px', overflowY: 'auto', background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', padding: '14px 16px' }}>
                                <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--ink)', display: 'block', marginBottom: '8px', borderBottom: '1px solid var(--line)', paddingBottom: '5px' }}>Bill of Materials · Router</span>
                                {breakdown.length === 0
                                    ? <div style={{ color: 'var(--ink-soft)', fontSize: '0.8rem' }}>No line items recorded.</div>
                                    : breakdown.map((l, i) => {
                                        // Part # for the floor: the line's baked ERP id, else resolve via its partId.
                                        const code = l.legacyErpId || (l.partId ? ((partFor(l.partId)?.legacyErpId !== 'PENDING' && partFor(l.partId)?.legacyErpId) || partFor(l.partId)?.itemId) : null);
                                        return (
                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '5px 0', borderBottom: '1px dashed var(--line)' }}>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                {code && <div style={{ fontFamily: 'var(--mono)', fontSize: '0.75rem', fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{code}</div>}
                                                <div style={{ color: code ? 'var(--ink-soft)' : 'var(--ink)', fontSize: '0.78rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name}</div>
                                                {(l.partHandling || l.cutLength) && <div style={{ fontFamily: 'var(--mono)', fontSize: '8px', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-soft)', marginTop: '2px' }}>{l.partHandling ? `→ ${l.partHandling}` : ''}{l.cutLength ? ` · cut ${l.cutLength}"` : ''}</div>}
                                            </div>
                                            <div style={{ color: 'var(--ink-soft)', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>×{l.qty}</div>
                                        </div>
                                        );
                                    })}
                                {accessories.length > 0 && (
                                    <>
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '8px', textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--brass)', margin: '10px 0 2px', borderBottom: '1px solid var(--line)', paddingBottom: '4px' }}>Hidden / Accessory Items — pull these too (per unit)</div>
                                        {accessories.map((a, i) => (
                                            <div key={`acc-${i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '5px 0', borderBottom: '1px dashed var(--line)' }}>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '0.75rem', fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.code}</div>
                                                    <div style={{ color: 'var(--ink-soft)', fontSize: '0.76rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}{a.via ? ` · rides "${a.via}"` : ''}</div>
                                                </div>
                                                <div style={{ color: 'var(--ink-soft)', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>×{a.qty}</div>
                                            </div>
                                        ))}
                                    </>
                                )}
                            </div>

                            {/* Vision shop drawing (cut lengths / miter angles / O2O-C2C) */}
                            {svg && (
                                <div style={{ flex: '1 1 100%', background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', padding: '14px 16px' }}>
                                    <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--ink)', display: 'block', marginBottom: '10px', borderBottom: '1px solid var(--line)', paddingBottom: '5px' }}>Shop Drawing · Vision Canvas</span>
                                    <div style={{ width: '100%', maxHeight: '380px', overflow: 'auto', background: 'var(--paper-2)', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '10px', boxSizing: 'border-box' }} dangerouslySetInnerHTML={{ __html: svg }} />
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ConfiguredItemViewer;
