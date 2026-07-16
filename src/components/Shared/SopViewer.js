import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { db } from '../../firebase';
import { doc, getDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { Canvas } from '@react-three/fiber';
import { useGLTF, OrbitControls, Bounds, Html } from '@react-three/drei';
import { StudioRig } from './studioScene';

// ============================================================================
// SOP VIEWER (Stuart 2026-07-15) — the read-only half of the closed loop:
//   1.6 slot uploads the dedicated SOP model → Tab .6 builds annotated pages
//   (BOM tags + text callouts, saved on Approved_Designs.instructionSteps) →
//   THIS viewer opens them from the BOM Engine and the shop floor Custom tab,
//   live in 3D (orbit/zoom) with a Print/PDF export of the current page.
// Host renders <SopViewer assembly={doc}/> or <SopViewer assemblyId={docId}/>.
// ============================================================================

const SopModel = ({ url }) => {
    const { scene } = useGLTF(url, 'https://www.gstatic.com/draco/versioned/decoders/1.5.5/');
    const cloned = useMemo(() => scene.clone(true), [scene]);
    return <primitive object={cloned} />;
};

const SopViewer = ({ assembly: assemblyProp, assemblyId, onClose }) => {
    const [assembly, setAssembly] = useState(assemblyProp || null);
    const [pins, setPins] = useState([]);
    const [pageId, setPageId] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                let asm = assemblyProp || null;
                if (!asm && assemblyId) {
                    const snap = await getDoc(doc(db, 'Approved_Designs', assemblyId));
                    if (!snap.exists()) { if (alive) setError('Assembly not found.'); return; }
                    asm = { id: snap.id, ...snap.data() };
                }
                if (!alive || !asm) return;
                setAssembly(asm);
                // Parts table resolves BOM-tag pin ids -> names; non-fatal if it fails.
                try {
                    const ps = await getDocs(query(collection(db, 'assembly_pins'), where('assemblyId', '==', asm.itemId)));
                    if (alive) setPins(ps.docs.map(d => ({ id: d.id, ...d.data() })));
                } catch (e) { /* names fall back to — */ }
            } catch (e) { if (alive) setError(e.message || 'Failed to load SOPs.'); }
        })();
        return () => { alive = false; };
    }, [assemblyProp, assemblyId]);

    const steps = assembly?.instructionSteps || [];
    const page = steps.find(s => s.id === pageId) || steps[0] || null;
    const tags = (page?.tags || []).slice().sort((a, b) => a.number - b.number);
    const callouts = page?.callouts || [];
    const modelUrl = assembly?.manufacturingSpecs?.sopCadUrl || assembly?.manufacturingSpecs?.cadUrl || '';
    const partOf = (t) => pins.find(p => p.id === t.linkedPinId);

    // Print / PDF: snapshot the live canvas (preserveDrawingBuffer) + the page's notes and parts
    // into a printable window — the browser's Save-as-PDF is the PDF export.
    const printPage = () => {
        const cv = document.querySelector('#sop-viewer-3d canvas');
        const shot = cv ? cv.toDataURL('image/png') : '';
        const rows = tags.map(t => {
            const p = partOf(t);
            return `<tr><td style="text-align:center">${t.number}</td><td style="text-align:center">${p ? (p.defaultQty || 1) : '—'}</td><td>${p ? `${p.partName}${p.legacyErpId && p.legacyErpId !== 'PENDING' ? ` <span style="color:#888">(${p.legacyErpId})</span>` : ''}` : 'Unassigned'}</td></tr>`;
        }).join('');
        const notes = callouts.map((c, i) => `<li>${String(c.text || '').replace(/</g, '&lt;')}</li>`).join('');
        const w = window.open('', '_blank', 'noopener,width=900,height=1100');
        if (!w) return alert('Popup blocked — allow popups to print.');
        w.document.write(`<!doctype html><html><head><title>${assembly?.itemName || 'SOP'} — ${page?.title || ''}</title>
            <style>body{font-family:Georgia,serif;color:#1c1a16;padding:32px;max-width:820px;margin:0 auto} h1{font-size:22px;margin:0} h2{font-size:15px;color:#666;font-weight:normal;margin:4px 0 18px} img{width:100%;border:1px solid #ddd;margin-bottom:18px} table{width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:12px} th,td{border:1px solid #ccc;padding:6px 8px;text-align:left} th{background:#f2efe8;text-transform:uppercase;font-size:10px;letter-spacing:.08em} ul{font-family:Arial,sans-serif;font-size:13px;line-height:1.6} .sec{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:#888;margin:18px 0 8px;font-family:Arial,sans-serif}</style>
            </head><body>
            <h1>${assembly?.itemName || ''}</h1><h2>Shop Floor SOP — ${page?.title || ''}</h2>
            ${shot ? `<img src="${shot}"/>` : ''}
            ${notes ? `<div class="sec">Notes</div><ul>${notes}</ul>` : ''}
            ${rows ? `<div class="sec">Parts on this page</div><table><thead><tr><th style="width:50px">Item</th><th style="width:50px">Qty</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
            </body></html>`);
        w.document.close();
        w.focus();
        setTimeout(() => w.print(), 400);
    };

    return (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 12000, padding: '16px' }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--paper, #f7f4ee)', color: 'var(--ink, #2a2a2a)', width: 'min(1200px, 96vw)', maxHeight: '94vh', display: 'flex', flexDirection: 'column', borderRadius: '4px', boxShadow: '0 16px 60px rgba(0,0,0,0.3)', overflow: 'hidden', fontFamily: 'var(--sans)' }}>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '16px 20px', borderBottom: '1px solid var(--line, #ddd)', background: '#fff' }}>
                    <div>
                        <div style={{ fontFamily: 'var(--serif)', fontSize: '1.3rem', fontWeight: 500 }}>{assembly?.itemName || 'Shop Floor SOPs'}</div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-soft, #888)', marginTop: '4px' }}>Standing rules & instructions · every job under this assembly</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {steps.length > 1 && (
                            <select value={page?.id || ''} onChange={e => setPageId(e.target.value)} style={{ padding: '8px', border: '1px solid var(--line)', background: '#fff', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink)' }}>
                                {steps.map((s, i) => <option key={s.id} value={s.id}>{i + 1}. {s.title}</option>)}
                            </select>
                        )}
                        <button onClick={printPage} style={{ background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: '2px', padding: '8px 14px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.08em' }}>🖨 Print / PDF</button>
                        <button onClick={onClose} style={{ background: 'var(--ink)', color: '#fff', border: 'none', borderRadius: '2px', padding: '8px 14px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.08em' }}>Close</button>
                    </div>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: '20px', padding: '20px', alignItems: 'stretch' }}>
                    {error && <div style={{ flex: 1, textAlign: 'center', padding: '60px', color: '#d9534f' }}>{error}</div>}
                    {!error && !assembly && <div style={{ flex: 1, textAlign: 'center', padding: '60px', color: 'var(--ink-soft)' }}>Loading SOPs…</div>}
                    {assembly && (
                        <>
                            <div id="sop-viewer-3d" style={{ flex: '1 1 460px', minWidth: '320px', minHeight: '460px', background: 'var(--paper-2, #efeae0)', border: '1px solid var(--line)', borderRadius: '2px', position: 'relative' }}>
                                {modelUrl ? (
                                    <Canvas camera={{ position: [5, 5, 5], fov: 50 }} dpr={[1, 2]} gl={{ antialias: true, preserveDrawingBuffer: true }} style={{ width: '100%', height: '100%' }}>
                                        <Suspense fallback={null}>
                                            <StudioRig />
                                            <Bounds fit clip margin={1.2}>
                                                <SopModel url={modelUrl} />
                                            </Bounds>
                                        </Suspense>
                                        <OrbitControls makeDefault />
                                        {tags.map(t => (
                                            <Html key={t.id} position={[t.x, t.y, t.z]} zIndexRange={[100, 0]}>
                                                <div style={{ width: '22px', height: '22px', background: '#fff', color: 'var(--ink)', border: '1px solid var(--ink)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: '10px', transform: 'translate(-50%, -50%)', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>{t.number}</div>
                                            </Html>
                                        ))}
                                        {callouts.map(c => {
                                            const ox = c.ox ?? 30, oy = c.oy ?? -40;
                                            return (
                                                <Html key={c.id} position={[c.x, c.y, c.z]} zIndexRange={[100, 0]}>
                                                    <div style={{ position: 'relative' }}>
                                                        <svg style={{ position: 'absolute', top: 0, left: 0, width: '1px', height: '1px', overflow: 'visible', pointerEvents: 'none' }}>
                                                            <line x1="0" y1="0" x2={ox} y2={oy + 14} stroke="var(--brass, #b08d57)" strokeWidth="1.5" />
                                                        </svg>
                                                        <div style={{ width: '8px', height: '8px', background: 'var(--brass, #b08d57)', borderRadius: '50%', transform: 'translate(-50%, -50%)' }}></div>
                                                        <div style={{ position: 'absolute', top: `${oy}px`, left: `${ox}px`, width: '200px', background: 'rgba(255,255,255,0.96)', border: '1px solid var(--line, #ddd)', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', padding: '8px 10px', fontFamily: 'var(--sans)', fontSize: '0.82rem', color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>{c.text}</div>
                                                    </div>
                                                </Html>
                                            );
                                        })}
                                    </Canvas>
                                ) : (
                                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-soft)', padding: '24px', textAlign: 'center' }}>No 3D model attached — add one via 1.6 (SOP slot) or Tab 3.</div>
                                )}
                            </div>

                            <div style={{ flex: '1 1 320px', minWidth: '280px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                {steps.length === 0 && <div style={{ color: 'var(--ink-soft)', fontStyle: 'italic', padding: '20px', background: '#fff', border: '1px dashed var(--line)' }}>No instruction pages built yet — create them in HQ Tab .6 (Interactive 3D Instructions).</div>}
                                {steps.length > 0 && (
                                    <div style={{ background: '#fff', border: '1px solid var(--line)' }}>
                                        <div style={{ padding: '10px 14px', background: 'var(--paper-2)', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', borderBottom: '1px solid var(--line)' }}>Pages</div>
                                        {steps.map((s, i) => (
                                            <div key={s.id} onClick={() => setPageId(s.id)} style={{ padding: '10px 14px', borderBottom: '1px solid var(--paper-2)', cursor: 'pointer', background: (page?.id === s.id) ? 'var(--paper-2)' : '#fff', borderLeft: (page?.id === s.id) ? '3px solid var(--brass)' : '3px solid transparent', fontFamily: 'var(--sans)', fontSize: '0.9rem', color: 'var(--ink)' }}>
                                                {i + 1}. {s.title} <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)' }}>· {(s.tags || []).length} pins · {(s.callouts || []).length} notes</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {callouts.length > 0 && (
                                    <div style={{ background: '#fff', border: '1px solid var(--line)' }}>
                                        <div style={{ padding: '10px 14px', background: 'var(--paper-2)', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', borderBottom: '1px solid var(--line)' }}>Notes on this page</div>
                                        {callouts.map((c, i) => (
                                            <div key={c.id} style={{ padding: '10px 14px', borderBottom: '1px solid var(--paper-2)', fontFamily: 'var(--sans)', fontSize: '0.88rem', color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>📝 {c.text}</div>
                                        ))}
                                    </div>
                                )}
                                {tags.length > 0 && (
                                    <div style={{ background: '#fff', border: '1px solid var(--line)' }}>
                                        <div style={{ padding: '10px 14px', background: 'var(--paper-2)', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', borderBottom: '1px solid var(--line)' }}>Parts on this page</div>
                                        {tags.map(t => {
                                            const p = partOf(t);
                                            return (
                                                <div key={t.id} style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '8px 14px', borderBottom: '1px solid var(--paper-2)' }}>
                                                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', width: '20px', height: '20px', border: '1px solid var(--ink)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{t.number}</span>
                                                    <div style={{ minWidth: 0 }}>
                                                        <div style={{ fontFamily: 'var(--sans)', fontSize: '0.88rem', color: p ? 'var(--ink)' : '#d9534f' }}>{p ? p.partName : 'Unassigned'}</div>
                                                        {p && p.legacyErpId && p.legacyErpId !== 'PENDING' && <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)' }}>{p.legacyErpId}</div>}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SopViewer;
