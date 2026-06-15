import React, { useState, useEffect, Suspense } from 'react';
import { db } from '../../firebase';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Bounds, Environment, ContactShadows } from '@react-three/drei';
import { DynamicModel, EngineeringSpecsStrip } from '../HQ/CPQTab';

// Read-only viewer for a CONFIRMED configured item, opened from the shop floor / finishing floor /
// HQ work-order windows. Loads the saved job by quoteId, re-renders the frozen `renderState`
// snapshot LIVE (spin/zoom only — no editing, since by the time the floor sees it the order is
// confirmed), and shows the engineering-spec roll-up beside it. Tablet-friendly: the body wraps to
// a single column on narrow screens. Self-contained modal — each host just renders
// <ConfiguredItemViewer quoteId={...} onClose={fn} />.
const ConfiguredItemViewer = ({ quoteId, onClose }) => {
    const [job, setJob] = useState(null);
    const [parts, setParts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [lineIdx, setLineIdx] = useState(0);

    useEffect(() => {
        let alive = true;
        (async () => {
            setLoading(true); setError(null); setJob(null);
            if (!quoteId) { setError('No order id provided.'); setLoading(false); return; }
            try {
                const snap = await getDoc(doc(db, 'jobs', quoteId));
                if (!alive) return;
                if (!snap.exists()) { setError(`No saved job found for "${quoteId}".`); setLoading(false); return; }
                setJob({ id: snap.id, ...snap.data() });
                // Parts let the spec strip resolve Vision-pick ids -> names; non-fatal if it fails.
                try {
                    const ps = await getDocs(collection(db, 'Approved_Designs'));
                    if (alive) setParts(ps.docs.map(d => ({ id: d.id, ...d.data() })));
                } catch (e) { /* names fall back to ids */ }
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
    const notes = item?.engineeringNotes || job?.engineeringNotes || null;
    const pseudoDraft = job ? {
        jobName: job.jobName,
        sidemark: item?.sidemark || job.sidemark,
        // The spec strip reads picks from draft.spatialData; merge every place the ids might live.
        spatialData: { ...(item?.engineeringNotes || {}), ...(item?.spatialData || {}), ...(job.spatialData || {}) }
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
                                    <Canvas camera={{ position: [5, 5, 5], fov: 50 }} style={{ width: '100%', height: '100%' }}>
                                        <ambientLight intensity={0.9} />
                                        <directionalLight position={[5, 10, 5]} intensity={0.7} />
                                        <Suspense fallback={null}>
                                            <Environment preset="warehouse" />
                                            <ContactShadows position={[0, -0.5, 0]} opacity={0.5} scale={10} blur={2} far={4} />
                                            <Bounds fit clip margin={1.2}>
                                                <DynamicModel
                                                    url={rs.cadUrl}
                                                    textureOverrides={rs.textureOverrides}
                                                    visibilityOverrides={rs.visibilityOverrides}
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

                            {/* Engineering specs roll-up */}
                            <div style={{ flex: '1 1 360px', minWidth: '300px', display: 'flex' }}>
                                {notes
                                    ? <EngineeringSpecsStrip draft={pseudoDraft} notes={notes} parts={parts} />
                                    : <div style={{ flex: 1, color: 'var(--ink-soft)', padding: '20px' }}>No engineering specs recorded on this order.</div>}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ConfiguredItemViewer;
