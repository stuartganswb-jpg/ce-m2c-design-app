// ─────────────────────────────────────────────────────────────────────────────────────────────
// GUIDE BOOK BUILDER (Stuart 2026-08-25) — tab 1, "New Guide"
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// "a new tool to produce visual guide books and pages, for instance the notes that will need to
//  pop up at the miter corners … the same drawing/notation window that already exists, just
//  modify the drop pin/note box — once dropped it should just leave the text, no box around it …
//  the same fine line to the text, then just the text … this screen is going to need images …
//  saved in the asset gallery and accessible from this new tool … formatted for 8.5x11 and like
//  on the spec sheet generator i can hit a button to change from landscape to portrait."
//
// The Inception canvas (tab 1) is the parent of this tool: the same drop-pin + leader-line
// gesture and the same draggable/resizable image overlays — but on a LETTER PAGE instead of a
// free canvas, and the note renders as BARE TEXT: pin, fine leader, words. Nothing else.
//
// DATA: system/guide_books/entries/{id} — the system/** rule already covers it (no rules deploy).
//   { title, brandId, pages: [{ id, orientation, overlays:[{id,url,hiResUrl,x,y,w,h}],
//                               callouts:[{id,x,y,tx,ty,text,size}] }] }
// Coordinates are PAGE UNITS at 100/inch: portrait 850×1100, landscape 1100×850 — so print maps
// 1:1 onto 8.5×11 and nothing needs rescaling.
//
// IMAGES: the picker lists `global_assets` — CPQ captures (guideCapture: true) first, the rest of
// the gallery behind a toggle. The editor places the thumbnail; PRINT swaps in originalUrl, the
// hi-res transparent PNG, so the book goes out at capture resolution.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';

const PAGE = { PORTRAIT: { w: 850, h: 1100 }, LANDSCAPE: { w: 1100, h: 850 } };
const uid = () => `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
const mono = { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' };
const btn = (on) => ({ padding: '8px 14px', background: on ? 'var(--ink)' : '#fff', color: on ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', ...mono });

const newPage = (orientation = 'PORTRAIT') => ({ id: uid(), orientation, overlays: [], callouts: [] });

export default function GuideBuilder({ onClose, currentUser, activeBrand }) {
    const [guides, setGuides] = useState([]);
    const [assets, setAssets] = useState([]);
    const [openId, setOpenId] = useState(null);
    const [guide, setGuide] = useState(null);          // working copy of the open guide
    const [pageIx, setPageIx] = useState(0);
    const [tool, setTool] = useState('SELECT');        // SELECT | PIN
    const [activeCallout, setActiveCallout] = useState(null);
    const [showPicker, setShowPicker] = useState(false);
    const [capturesOnly, setCapturesOnly] = useState(true);
    const [assetSearch, setAssetSearch] = useState('');
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const svgRef = useRef(null);
    const dragRef = useRef(null);

    useEffect(() => {
        const u1 = onSnapshot(collection(db, 'system', 'guide_books', 'entries'),
            s => setGuides(s.docs.map(d => ({ id: d.id, ...d.data() }))), e => console.warn('guides listen', e));
        const u2 = onSnapshot(collection(db, 'global_assets'),
            s => setAssets(s.docs.map(d => ({ id: d.id, ...d.data() }))), e => console.warn('assets listen', e));
        return () => { u1(); u2(); };
    }, []);

    const page = guide?.pages?.[pageIx] || null;
    const dims = page ? PAGE[page.orientation === 'LANDSCAPE' ? 'LANDSCAPE' : 'PORTRAIT'] : PAGE.PORTRAIT;

    const mutatePage = (fn) => {
        setGuide(g => {
            const pages = g.pages.map((p, i) => (i === pageIx ? fn({ ...p, overlays: [...(p.overlays || [])], callouts: [...(p.callouts || [])] }) : p));
            return { ...g, pages };
        });
        setDirty(true);
    };

    const openGuide = (g) => {
        setGuide({ title: g.title || 'Untitled Guide', brandId: g.brandId || activeBrand || '', pages: (g.pages || []).length ? g.pages : [newPage()] });
        setOpenId(g.id); setPageIx(0); setTool('SELECT'); setActiveCallout(null); setDirty(false);
    };
    const createGuide = () => {
        const title = window.prompt('Name the new guide:', 'New Guide');
        if (title === null) return;
        openGuide({ id: `GUIDE-${uid()}`, title: title || 'Untitled Guide', pages: [newPage()] });
        setDirty(true);
    };
    const saveGuide = async () => {
        if (!openId || !guide) return;
        setSaving(true);
        try {
            await setDoc(doc(db, 'system', 'guide_books', 'entries', openId), {
                title: guide.title, brandId: guide.brandId || activeBrand || '', pages: guide.pages,
                updatedAt: serverTimestamp(), updatedBy: currentUser || 'Unknown',
            }, { merge: true });
            setDirty(false);
        } catch (e) { alert('Save failed: ' + (e.message || e)); }
        setSaving(false);
    };
    const deleteGuide = async (g) => {
        if (!window.confirm(`Delete guide "${g.title}"? This cannot be undone.`)) return;
        try { await deleteDoc(doc(db, 'system', 'guide_books', 'entries', g.id)); } catch (e) { alert('Delete failed: ' + (e.message || e)); }
    };

    // Screen px → page units, through the SVG's own transform so zoom/fit never skews a drop.
    const toPage = (e) => {
        const svg = svgRef.current;
        if (!svg) return { x: 0, y: 0 };
        const pt = svg.createSVGPoint();
        pt.x = e.clientX; pt.y = e.clientY;
        const p = pt.matrixTransform(svg.getScreenCTM().inverse());
        return { x: Math.round(p.x), y: Math.round(p.y) };
    };

    const handlePageClick = (e) => {
        if (tool !== 'PIN') return;
        const { x, y } = toPage(e);
        const left = x < dims.w / 2;
        const c = { id: uid(), x, y, tx: x + (left ? 90 : -90), ty: y - 70, text: '', size: 14 };
        mutatePage(p => ({ ...p, callouts: [...p.callouts, c] }));
        setActiveCallout(c.id);
        setTool('SELECT');
    };

    // One drag loop for everything on the page (image move/resize, text move, pin move).
    const startDrag = (e, kind, id, extra = {}) => {
        e.stopPropagation(); e.preventDefault();
        const start = toPage(e);
        dragRef.current = { kind, id, start, ...extra };
        const move = (ev) => {
            const d = dragRef.current; if (!d) return;
            const now = toPage(ev);
            const dx = now.x - d.start.x, dy = now.y - d.start.y;
            if (d.kind === 'ov-move') mutatePageNoDirty(p => ({ ...p, overlays: p.overlays.map(o => o.id === d.id ? { ...o, x: d.ox + dx, y: d.oy + dy } : o) }));
            if (d.kind === 'ov-resize') mutatePageNoDirty(p => ({ ...p, overlays: p.overlays.map(o => o.id === d.id ? { ...o, w: Math.max(30, d.ow + dx), h: Math.max(30, d.oh + dy) } : o) }));
            if (d.kind === 'text') mutatePageNoDirty(p => ({ ...p, callouts: p.callouts.map(c => c.id === d.id ? { ...c, tx: d.ox + dx, ty: d.oy + dy } : c) }));
            if (d.kind === 'pin') mutatePageNoDirty(p => ({ ...p, callouts: p.callouts.map(c => c.id === d.id ? { ...c, x: d.ox + dx, y: d.oy + dy } : c) }));
        };
        const up = () => { dragRef.current = null; setDirty(true); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    };
    // During a drag the page mutates every move — the dirty flag is set once, on release.
    const mutatePageNoDirty = (fn) => setGuide(g => ({ ...g, pages: g.pages.map((p, i) => (i === pageIx ? fn({ ...p, overlays: [...(p.overlays || [])], callouts: [...(p.callouts || [])] }) : p)) }));

    const placeAsset = (a) => {
        const w = 300, h = 300;
        mutatePage(p => ({ ...p, overlays: [...p.overlays, { id: uid(), url: a.thumbnailUrl || a.url, hiResUrl: a.originalUrl || a.url, x: Math.round(dims.w / 2 - w / 2), y: Math.round(dims.h / 2 - h / 2), w, h }] }));
        setShowPicker(false);
    };

    // ── PRINT: one letter sheet per page, landscape content rotated onto the portrait sheet the
    // way the spec sheet binder does it. Images print from the HI-RES url. ─────────────────────
    const handlePrint = () => {
        if (!guide) return;
        const pageHtml = guide.pages.map((p) => {
            const pd = PAGE[p.orientation === 'LANDSCAPE' ? 'LANDSCAPE' : 'PORTRAIT'];
            const inner = `
                <svg viewBox="0 0 ${pd.w} ${pd.h}" style="width:100%;height:100%;display:block;">
                    ${(p.overlays || []).map(o => `<image href="${o.hiResUrl || o.url}" x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" preserveAspectRatio="xMidYMid meet"/>`).join('')}
                    ${(p.callouts || []).map(c => `
                        <line x1="${c.x}" y1="${c.y}" x2="${c.tx}" y2="${c.ty}" stroke="#1c1a16" stroke-width="0.75"/>
                        <circle cx="${c.x}" cy="${c.y}" r="2.5" fill="#1c1a16"/>
                        <foreignObject x="${c.tx < c.x ? c.tx - 260 : c.tx}" y="${c.ty - 10}" width="260" height="300" style="overflow:visible;">
                            <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Georgia,serif;font-size:${c.size || 14}px;color:#1c1a16;line-height:1.35;white-space:pre-wrap;${c.tx < c.x ? 'text-align:right;' : ''}">${String(c.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>
                        </foreignObject>`).join('')}
                </svg>`;
            return p.orientation === 'LANDSCAPE'
                ? `<div class="sheet"><div class="rot">${inner}</div></div>`
                : `<div class="sheet">${inner}</div>`;
        }).join('');
        const w = window.open('', '_blank');
        if (!w) return alert('Pop-up blocked — allow pop-ups to print.');
        w.document.write(`<!DOCTYPE html><html><head><title>${guide.title}</title><style>
            @page { size: letter portrait; margin: 0; }
            html,body { margin:0; padding:0; }
            .sheet { width: 8.5in; height: 11in; page-break-after: always; position: relative; overflow: hidden; background: #fff; }
            .rot { width: 11in; height: 8.5in; transform: rotate(90deg) translateY(-8.5in); transform-origin: top left; }
        </style></head><body>${pageHtml}<script>window.onload=()=>setTimeout(()=>window.print(),400)</${'script'}></body></html>`);
        w.document.close();
    };

    const filteredAssets = useMemo(() => {
        const q = assetSearch.trim().toUpperCase();
        return assets
            .filter(a => !capturesOnly || a.guideCapture === true)
            .filter(a => !q || `${a.name || ''} ${a.patternId || ''} ${a.finishId || ''}`.toUpperCase().includes(q))
            .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    }, [assets, capturesOnly, assetSearch]);

    // ── RENDER ────────────────────────────────────────────────────────────────────────────────
    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.55)', zIndex: 11000, display: 'flex', alignItems: 'stretch', justifyContent: 'center', padding: '18px' }}>
            <div style={{ background: 'var(--paper, #f4f0e6)', width: '100%', maxWidth: '1500px', display: 'flex', flexDirection: 'column', borderRadius: '3px', overflow: 'hidden', boxShadow: '0 18px 70px rgba(0,0,0,0.35)' }}>

                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 20px', background: '#fff', borderBottom: '1px solid var(--line)' }}>
                    <span style={{ fontFamily: 'var(--serif)', fontSize: '1.3rem', fontWeight: 500, color: 'var(--ink)' }}>📖 Guide Books</span>
                    {guide && (
                        <input value={guide.title} onChange={e => { setGuide(g => ({ ...g, title: e.target.value })); setDirty(true); }}
                            style={{ flex: '0 1 340px', padding: '8px 10px', border: '1px solid var(--line)', fontSize: '0.95rem', fontFamily: 'var(--sans)' }} />
                    )}
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                        {guide && <button onClick={saveGuide} disabled={saving || !dirty} style={{ ...btn(dirty), background: dirty ? 'var(--brass)' : 'var(--paper-2)', color: dirty ? '#fff' : 'var(--ink-soft)', border: '1px solid var(--line)' }}>{saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}</button>}
                        {guide && <button onClick={handlePrint} style={btn(false)}>Print / PDF</button>}
                        {guide && <button onClick={() => { if (dirty && !window.confirm('Discard unsaved changes?')) return; setGuide(null); setOpenId(null); }} style={btn(false)}>All guides</button>}
                        <button onClick={() => { if (dirty && !window.confirm('Discard unsaved changes?')) return; onClose(); }} style={{ ...btn(true) }}>Close</button>
                    </div>
                </div>

                {!guide ? (
                    /* ── The guide list ── */
                    <div style={{ padding: '26px', overflowY: 'auto' }}>
                        <button onClick={createGuide} style={{ ...btn(true), padding: '12px 22px', marginBottom: '20px' }}>+ New Guide</button>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '14px' }}>
                            {guides.sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0)).map(g => (
                                <div key={g.id} style={{ background: '#fff', border: '1px solid var(--line)', padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <span style={{ fontFamily: 'var(--serif)', fontSize: '1.05rem', color: 'var(--ink)' }}>{g.title || 'Untitled'}</span>
                                    <span style={{ ...mono, color: 'var(--ink-soft)' }}>{(g.pages || []).length} page(s){g.updatedBy ? ` · ${g.updatedBy}` : ''}</span>
                                    <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                                        <button onClick={() => openGuide(g)} style={btn(false)}>Open</button>
                                        <button onClick={() => deleteGuide(g)} style={{ ...btn(false), color: '#d9534f' }}>Delete</button>
                                    </div>
                                </div>
                            ))}
                            {guides.length === 0 && <div style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)' }}>No guides yet — create the first one.</div>}
                        </div>
                    </div>
                ) : (
                    /* ── The editor ── */
                    <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                            {/* Toolbar */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
                                <button onClick={() => setTool(tool === 'PIN' ? 'SELECT' : 'PIN')} style={btn(tool === 'PIN')}>{tool === 'PIN' ? 'Click page to drop pin…' : 'Drop Pin'}</button>
                                <button onClick={() => setShowPicker(v => !v)} style={btn(showPicker)}>Images</button>
                                <span style={{ width: '1px', height: '22px', background: 'var(--line)' }} />
                                <button onClick={() => mutatePage(p => ({ ...p, orientation: p.orientation === 'LANDSCAPE' ? 'PORTRAIT' : 'LANDSCAPE' }))} style={btn(false)}
                                    title="Flip this page between portrait and landscape — same 8.5×11 sheet, turned.">
                                    {page?.orientation === 'LANDSCAPE' ? '▭ Landscape' : '▯ Portrait'}
                                </button>
                                <span style={{ width: '1px', height: '22px', background: 'var(--line)' }} />
                                <button onClick={() => setPageIx(i => Math.max(0, i - 1))} disabled={pageIx === 0} style={{ ...btn(false), opacity: pageIx === 0 ? .4 : 1 }}>‹</button>
                                <span style={{ ...mono, color: 'var(--ink)' }}>page {pageIx + 1} / {guide.pages.length}</span>
                                <button onClick={() => setPageIx(i => Math.min(guide.pages.length - 1, i + 1))} disabled={pageIx >= guide.pages.length - 1} style={{ ...btn(false), opacity: pageIx >= guide.pages.length - 1 ? .4 : 1 }}>›</button>
                                <button onClick={() => { setGuide(g => ({ ...g, pages: [...g.pages, newPage(page?.orientation)] })); setPageIx(guide.pages.length); setDirty(true); }} style={btn(false)}>+ Page</button>
                                <button onClick={() => { if (guide.pages.length <= 1) return alert('A guide keeps at least one page.'); if (!window.confirm('Delete this page?')) return; setGuide(g => ({ ...g, pages: g.pages.filter((_, i) => i !== pageIx) })); setPageIx(i => Math.max(0, i - 1)); setDirty(true); }} style={{ ...btn(false), color: '#d9534f' }}>Delete page</button>
                            </div>

                            {/* The letter page */}
                            <div style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '22px' }}>
                                <svg ref={svgRef} viewBox={`0 0 ${dims.w} ${dims.h}`} onClick={handlePageClick}
                                    style={{ background: '#fff', boxShadow: '0 3px 18px rgba(0,0,0,0.14)', width: page?.orientation === 'LANDSCAPE' ? 'min(100%, 1050px)' : 'min(100%, 780px)', height: 'auto', cursor: tool === 'PIN' ? 'crosshair' : 'default' }}>
                                    {/* images */}
                                    {(page?.overlays || []).map(ov => (
                                        <g key={ov.id}>
                                            <image href={ov.url} x={ov.x} y={ov.y} width={ov.w} height={ov.h} preserveAspectRatio="xMidYMid meet"
                                                onPointerDown={tool === 'PIN' ? undefined : (e) => startDrag(e, 'ov-move', ov.id, { ox: ov.x, oy: ov.y })}
                                                style={{ cursor: tool === 'PIN' ? 'crosshair' : 'move', pointerEvents: tool === 'PIN' ? 'none' : 'auto' }} />
                                            {tool !== 'PIN' && (
                                                <>
                                                    <rect x={ov.x} y={ov.y} width={ov.w} height={ov.h} fill="none" stroke="var(--brass)" strokeWidth="1" strokeDasharray="5 3" style={{ pointerEvents: 'none' }} />
                                                    <rect x={ov.x + ov.w - 9} y={ov.y + ov.h - 9} width="18" height="18" fill="var(--brass)" stroke="#fff" strokeWidth="1.5"
                                                        onPointerDown={(e) => startDrag(e, 'ov-resize', ov.id, { ow: ov.w, oh: ov.h })} style={{ cursor: 'nwse-resize' }} />
                                                    <g onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); mutatePage(p => ({ ...p, overlays: p.overlays.filter(o => o.id !== ov.id) })); }} style={{ cursor: 'pointer' }}>
                                                        <circle cx={ov.x + ov.w} cy={ov.y} r="10" fill="#d9534f" stroke="#fff" strokeWidth="1.5" />
                                                        <text x={ov.x + ov.w} y={ov.y + 4} textAnchor="middle" fontSize="13" fontWeight="bold" fill="#fff" style={{ pointerEvents: 'none' }}>×</text>
                                                    </g>
                                                </>
                                            )}
                                        </g>
                                    ))}
                                    {/* pins + bare text — the fine pin, the fine line, the words. No box. */}
                                    {(page?.callouts || []).map(c => {
                                        const isActive = activeCallout === c.id;
                                        const rightward = c.tx >= c.x;
                                        return (
                                            <g key={c.id}>
                                                <line x1={c.x} y1={c.y} x2={c.tx} y2={c.ty} stroke={isActive ? 'var(--brass)' : 'var(--ink)'} strokeWidth="0.75" />
                                                <circle cx={c.x} cy={c.y} r="2.5" fill={isActive ? 'var(--brass)' : 'var(--ink)'}
                                                    onPointerDown={tool === 'PIN' ? undefined : (e) => startDrag(e, 'pin', c.id, { ox: c.x, oy: c.y })}
                                                    style={{ cursor: 'move' }} />
                                                <foreignObject x={rightward ? c.tx : c.tx - 260} y={c.ty - 10} width="260" height="300" style={{ overflow: 'visible' }}>
                                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: rightward ? 'flex-start' : 'flex-end' }}>
                                                        {isActive ? (
                                                            <textarea autoFocus value={c.text}
                                                                onChange={e => mutatePage(p => ({ ...p, callouts: p.callouts.map(x => x.id === c.id ? { ...x, text: e.target.value } : x) }))}
                                                                onBlur={() => setActiveCallout(null)}
                                                                onPointerDown={e => e.stopPropagation()}
                                                                style={{ width: '240px', minHeight: '54px', fontFamily: 'Georgia, serif', fontSize: `${c.size || 14}px`, color: 'var(--ink)', background: 'rgba(197,160,89,0.06)', border: '1px dashed var(--brass)', outline: 'none', resize: 'vertical', lineHeight: 1.35, textAlign: rightward ? 'left' : 'right' }} />
                                                        ) : (
                                                            <div onPointerDown={tool === 'PIN' ? undefined : (e) => startDrag(e, 'text', c.id, { ox: c.tx, oy: c.ty })}
                                                                onDoubleClick={(e) => { e.stopPropagation(); setActiveCallout(c.id); }}
                                                                title="Drag to move · double-click to edit"
                                                                style={{ fontFamily: 'Georgia, serif', fontSize: `${c.size || 14}px`, color: 'var(--ink)', whiteSpace: 'pre-wrap', lineHeight: 1.35, cursor: 'move', maxWidth: '240px', textAlign: rightward ? 'left' : 'right', minHeight: '16px' }}>
                                                                {c.text || <span style={{ color: 'var(--brass)', fontStyle: 'italic' }}>double-click to write…</span>}
                                                            </div>
                                                        )}
                                                        {(isActive || !c.text) && (
                                                            <button onPointerDown={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}
                                                                onClick={(e) => { e.stopPropagation(); mutatePage(p => ({ ...p, callouts: p.callouts.filter(x => x.id !== c.id) })); setActiveCallout(null); }}
                                                                style={{ marginTop: '4px', background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', padding: 0 }}>remove</button>
                                                        )}
                                                    </div>
                                                </foreignObject>
                                            </g>
                                        );
                                    })}
                                </svg>
                            </div>
                        </div>

                        {/* Image picker rail */}
                        {showPicker && (
                            <div style={{ width: '300px', borderLeft: '1px solid var(--line)', background: '#fff', display: 'flex', flexDirection: 'column' }}>
                                <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <span style={{ ...mono, color: 'var(--ink)' }}>Asset Gallery</span>
                                    <input value={assetSearch} onChange={e => setAssetSearch(e.target.value)} placeholder="Search…"
                                        style={{ padding: '7px 9px', border: '1px solid var(--line)', fontSize: '12px' }} />
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '11px', color: 'var(--ink-soft)', cursor: 'pointer' }}>
                                        <input type="checkbox" checked={capturesOnly} onChange={e => setCapturesOnly(e.target.checked)} />
                                        CPQ guide captures only
                                    </label>
                                </div>
                                <div style={{ flex: 1, overflowY: 'auto', padding: '10px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', alignContent: 'start' }}>
                                    {filteredAssets.slice(0, 120).map(a => (
                                        <div key={a.id} onClick={() => placeAsset(a)} title={`${a.name || ''} — click to place`}
                                            style={{ border: '1px solid var(--line)', background: 'var(--paper-2)', cursor: 'pointer', padding: '5px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                            <img src={a.thumbnailUrl || a.url} alt={a.name || ''} style={{ width: '100%', height: '86px', objectFit: 'contain' }} />
                                            <span style={{ fontFamily: 'var(--mono)', fontSize: '8px', color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name || a.patternId || ''}</span>
                                        </div>
                                    ))}
                                    {filteredAssets.length === 0 && <span style={{ fontSize: '11px', color: 'var(--ink-soft)', fontStyle: 'italic', gridColumn: '1 / -1' }}>{capturesOnly ? 'No CPQ captures yet — use “Send to Guide” on the CPQ render.' : 'Nothing matches.'}</span>}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
