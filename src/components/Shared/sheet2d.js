// ============================================================================
// 2D TEAR-SHEET CPQ — CORE (Stuart 2026-08-14, M2C lighting onboarding)
//
// The fast path for loading the M2C Studio lighting line (m2cstudio.com) into
// the app WITHOUT .fbx/.glb models: import the tear sheet's line drawing (PDF
// or image), draw oval/circle REGIONS over its areas in 1.5 Node Grouping
// (drag = oval, hold SHIFT = circle), and each region becomes a nodeCluster —
// the same record the pins, BOM engine, and flow generator already read. The
// CPQ then renders the DRAWING instead of a 3D canvas, with a soft brass halo
// over the region the customer is currently specifying.
//
// Design contract:
//   • Assembly doc:  manufacturingSpecs.sheet2d = { url, w, h }  (the drawing;
//     w/h = the stored image's pixel size, regions are normalized 0..1 so any
//     display size maps). An assembly is 2D when it has sheet2d and NO cadUrl —
//     upload a real .glb later and it graduates to the 3D pipeline untouched.
//   • Region cluster: normal nodeClusters[] entry + region2d {cx, cy, rx, ry}
//     (normalized ellipse) + nodes: ['2D__<clusterId>'] (the synthetic node id
//     that stands in wherever the 3D pipeline expects a node name).
//   • Choices/pins: assembly_pins exactly as today (clusterId links them);
//     choiceNode = a synthetic '2D__<clusterId>__C<n>' per choice.
//   • Flow: Shared/sheet2dFlow.js (the generator fork) stamps sheet2d + the
//     regions onto the flow doc, so the CPQ renders purely from the flow.
//
// This file is 3D-dependency-free (no three/pdfjs) — safe to import from CPQ.
// PDF rasterizing lives in Shared/sheet2dImport.js (dynamic pdfjs import).
// ============================================================================
import React, { useRef, useState } from 'react';

export const SHEET2D_PREFIX = '2D__';
export const regionNodeId = (clusterId) => `${SHEET2D_PREFIX}${clusterId}`;
export const sheet2dChoiceNode = (clusterId, n) => `${SHEET2D_PREFIX}${clusterId}__C${n}`;

// 2D when the tear sheet exists and no .glb does — a later .glb upload wins.
export const isSheet2dAssembly = (asm) => {
    const ms = asm?.manufacturingSpecs || {};
    return !!(ms.sheet2d && ms.sheet2d.url) && !ms.cadUrl;
};

export const sheet2dRegions = (asm) => (asm?.nodeClusters || []).filter(c => c.region2d);

const BRASS = '#b08d57';
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// ── VIEWER OVERLAY (CPQ runtime) ─────────────────────────────────────────────
// The drawing + halos. activeIds = regions of the step being answered NOW
// (strong, breathing brass halo + name label); litIds = regions already
// specified (faint steady wash, so the customer sees what's settled).
export const Sheet2DOverlay = ({ sheet2d, regions = [], activeIds = [], litIds = [], style }) => {
    const uidRef = useRef(`s2d${Math.random().toString(36).slice(2, 8)}`);
    const { url, w = 1000, h = 1000 } = sheet2d || {};
    if (!url) return null;
    const act = new Set(activeIds), lit = new Set(litIds);
    const uid = uidRef.current;
    const fs = Math.max(12, Math.round(h * 0.02)); // label size in image px
    return (
        <div style={{ position: 'relative', width: '100%', ...style }}>
            <img src={url} alt="tear sheet" draggable={false} style={{ display: 'block', width: '100%', height: 'auto', userSelect: 'none', pointerEvents: 'none' }} />
            <svg viewBox={`0 0 ${w} ${h}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                <defs>
                    <radialGradient id={`${uid}-halo`}>
                        <stop offset="0%" stopColor={BRASS} stopOpacity="0.34" />
                        <stop offset="62%" stopColor={BRASS} stopOpacity="0.20" />
                        <stop offset="100%" stopColor={BRASS} stopOpacity="0" />
                    </radialGradient>
                    <filter id={`${uid}-blur`} x="-40%" y="-40%" width="180%" height="180%">
                        <feGaussianBlur stdDeviation={Math.max(3, h * 0.006)} />
                    </filter>
                </defs>
                {regions.map(r => {
                    const cx = r.cx * w, cy = r.cy * h, rx = r.rx * w, ry = r.ry * h;
                    if (act.has(r.id)) {
                        return (
                            <g key={r.id}>
                                {/* soft halo wash, slightly larger than the drawn bound so it reads as a glow */}
                                <ellipse cx={cx} cy={cy} rx={rx * 1.18} ry={ry * 1.18} fill={`url(#${uid}-halo)`}>
                                    <animate attributeName="opacity" values="0.72;1;0.72" dur="2.6s" repeatCount="indefinite" />
                                </ellipse>
                                <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={BRASS} strokeOpacity="0.85" strokeWidth={Math.max(1.5, h * 0.0028)} filter={`url(#${uid}-blur)`}>
                                    <animate attributeName="stroke-opacity" values="0.55;0.95;0.55" dur="2.6s" repeatCount="indefinite" />
                                </ellipse>
                                {r.name ? (
                                    <text x={cx} y={Math.max(fs * 1.1, cy - ry - fs * 0.55)} textAnchor="middle" fill={BRASS} fillOpacity="0.95"
                                        style={{ fontSize: fs, fontFamily: 'monospace', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                                        {String(r.name).replace(/[-_]+/g, ' ')}
                                    </text>
                                ) : null}
                            </g>
                        );
                    }
                    if (lit.has(r.id)) {
                        return (
                            <g key={r.id}>
                                <ellipse cx={cx} cy={cy} rx={rx * 1.08} ry={ry * 1.08} fill={BRASS} fillOpacity="0.07" />
                                <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={BRASS} strokeOpacity="0.3" strokeWidth={Math.max(1, h * 0.0016)} />
                            </g>
                        );
                    }
                    return null;
                })}
            </svg>
        </div>
    );
};

// ── MATERIAL RAIL (CPQ hybrid viewer — Leyla 2026-08-14) ─────────────────────
// The 3D render sits center-window; selections that the model can't show (tassel
// colors, materials) appear as swatch cards down the RIGHT edge, each tied to the
// fixture by a fine architect-style leader line: a dot on the model at the
// region's height, a thin elbow line out to the card. The active step's card +
// line are brass; answered steps' are hairline grey. Display-only (no pointer
// events) — the pickers stay in the step panel.
// items: [{ id, title, label, imageUrl, active, frac }] — frac = 0..1 vertical
// anchor on the model (the generator ranks regions by their tear-sheet height).
export const MaterialRail = ({ items = [] }) => {
    if (!items.length) return null;
    const W = 1000, H = 600;              // stretched viewBox; strokes are non-scaling
    // TWO-SIDED (Stuart 2026-08-15: one-sided cards stacked into each other — chain/frame/wood
    // left, tassels/diffuser right). The model renders centered between the rails; each side
    // spreads its own cards over the full height, so 3 per side never collide.
    const L = items.filter(i => i.side === 'L');
    const R = items.filter(i => i.side !== 'L');
    const GEO = { L: { ax: 400, dir: -1, card: 210 }, R: { ax: 600, dir: 1, card: 790 } };
    const renderSide = (list, sk) => {
        const g = GEO[sk];
        const many = list.length > 4;
        return list.map((it, i) => {
            const topPct = ((i + 0.5) / list.length) * 100;
            const cardY = ((i + 0.5) / list.length) * H;
            const ay = Math.max(0.04, Math.min(0.96, it.frac ?? 0.5)) * H;
            const col = it.active ? BRASS : '#a49c90';
            return {
                line: (
                    <g key={it.id} stroke={col} fill="none">
                        {/* anchor dot (zero-length round-cap path = a dot that survives the stretch) */}
                        <path d={`M ${g.ax} ${ay} l 0.01 0`} strokeLinecap="round" strokeWidth={it.active ? 7 : 5} vectorEffect="non-scaling-stroke" strokeOpacity={it.active ? 1 : 0.75} />
                        <path d={`M ${g.ax + 6 * g.dir} ${ay} H ${(g.ax + g.card) / 2} L ${g.card - 14 * g.dir} ${cardY} H ${g.card - 2 * g.dir}`}
                            strokeWidth={it.active ? 1.6 : 1} vectorEffect="non-scaling-stroke" strokeOpacity={it.active ? 0.95 : 0.6} />
                    </g>
                ),
                card: (
                    <div key={it.id} style={{ position: 'absolute', [sk === 'L' ? 'left' : 'right']: '10px', top: `${topPct}%`, transform: 'translateY(-50%)', width: many ? '128px' : '148px', background: 'rgba(255,255,255,0.96)', border: `1px solid ${it.active ? BRASS : 'rgba(0,0,0,0.16)'}`, borderRadius: '2px', boxShadow: '0 2px 10px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
                        {it.imageUrl
                            ? <img src={it.imageUrl} alt={it.label} style={{ display: 'block', width: '100%', height: many ? '38px' : '64px', objectFit: 'cover' }} />
                            : <div style={{ width: '100%', height: many ? '22px' : '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', fontSize: '8px', letterSpacing: '.08em', color: '#a49c90', textTransform: 'uppercase' }}>{it.chosen ? 'no swatch on file' : 'choosing…'}</div>}
                        <div style={{ padding: '5px 8px 6px' }}>
                            <div style={{ fontFamily: 'monospace', fontSize: '7px', letterSpacing: '.1em', textTransform: 'uppercase', color: it.active ? BRASS : '#8b8578' }}>{String(it.title).slice(0, 26)}</div>
                            <div style={{ fontFamily: 'monospace', fontSize: '9px', letterSpacing: '.04em', textTransform: 'uppercase', color: '#2f2b26', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</div>
                        </div>
                    </div>
                ),
            };
        });
    };
    const parts = [...renderSide(L, 'L'), ...renderSide(R, 'R')];
    return (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
                {parts.map(p => p.line)}
            </svg>
            {parts.map(p => p.card)}
        </div>
    );
};

// ── REGION EDITOR (1.5 Node Grouping) ────────────────────────────────────────
// Drag on the drawing = new oval region (SHIFT while dragging = circle). Drag
// inside an existing region moves it; drag its SE handle resizes (SHIFT keeps
// it a circle); double-click renames. Persistence stays in the parent (the tab
// owns its updateDoc patterns) — this component only reports normalized shapes.
export const Sheet2DRegionEditor = ({ sheet2d, clusters = [], selectedId, onSelect, onCreate, onUpdateRegion, onRename, highlightIds = [] }) => {
    const svgRef = useRef(null);
    const [drag, setDrag] = useState(null);      // {mode:'draw'|'move'|'resize', ...}
    const [preview, setPreview] = useState(null); // live region during a drag
    const { url, w = 1000, h = 1000 } = sheet2d || {};
    const hi = new Set(highlightIds);
    if (!url) return null;

    const norm = (e) => {
        const rect = svgRef.current.getBoundingClientRect();
        return { x: clamp01((e.clientX - rect.left) / rect.width), y: clamp01((e.clientY - rect.top) / rect.height) };
    };
    const drawRegion = (a, p, shift) => {
        let rx = Math.abs(p.x - a.x) / 2, ry = Math.abs(p.y - a.y) / 2;
        const cx = (a.x + p.x) / 2, cy = (a.y + p.y) / 2;
        if (shift) { const rpx = Math.max(rx * w, ry * h); rx = rpx / w; ry = rpx / h; } // circle in IMAGE px = circle on screen
        return { cx, cy, rx, ry };
    };

    const down = (e) => {
        e.preventDefault();
        const p = norm(e);
        setDrag({ mode: 'draw', a: p });
        setPreview(null);
        if (onSelect) onSelect(null);
    };
    const downOn = (e, cl, mode) => {
        e.preventDefault(); e.stopPropagation();
        const p = norm(e);
        setDrag({ mode, id: cl.id, a: p, orig: { ...cl.region2d } });
        if (onSelect) onSelect(cl.id);
    };
    const move = (e) => {
        if (!drag) return;
        const p = norm(e);
        if (drag.mode === 'draw') setPreview(drawRegion(drag.a, p, e.shiftKey));
        else if (drag.mode === 'move') setPreview({ ...drag.orig, cx: clamp01(drag.orig.cx + (p.x - drag.a.x)), cy: clamp01(drag.orig.cy + (p.y - drag.a.y)) });
        else if (drag.mode === 'resize') {
            let rx = Math.max(0.004, Math.abs(p.x - drag.orig.cx)), ry = Math.max(0.004, Math.abs(p.y - drag.orig.cy));
            if (e.shiftKey) { const rpx = Math.max(rx * w, ry * h); rx = rpx / w; ry = rpx / h; }
            setPreview({ ...drag.orig, rx, ry });
        }
    };
    const up = () => {
        if (!drag) return;
        const d = drag, pv = preview;
        setDrag(null); setPreview(null);
        if (!pv) return;
        if (d.mode === 'draw') {
            if (pv.rx * w > 8 && pv.ry * h > 8 && onCreate) onCreate(pv); // ignore stray clicks
        } else if (onUpdateRegion) onUpdateRegion(d.id, pv);
    };

    const fs = Math.max(11, Math.round(h * 0.018));
    return (
        <div style={{ position: 'relative', width: '100%' }}>
            <img src={url} alt="tear sheet" draggable={false} style={{ display: 'block', width: '100%', height: 'auto', userSelect: 'none', pointerEvents: 'none' }} />
            <svg ref={svgRef} viewBox={`0 0 ${w} ${h}`} onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={up}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: drag ? (drag.mode === 'draw' ? 'crosshair' : 'grabbing') : 'crosshair' }}>
                {clusters.map(cl => {
                    const r = (preview && drag && drag.id === cl.id) ? preview : cl.region2d;
                    if (!r) return null;
                    const cx = r.cx * w, cy = r.cy * h, rx = r.rx * w, ry = r.ry * h;
                    const sel = selectedId === cl.id, glow = hi.has(cl.id);
                    return (
                        <g key={cl.id}>
                            {glow && <ellipse cx={cx} cy={cy} rx={rx * 1.15} ry={ry * 1.15} fill={BRASS} fillOpacity="0.16" />}
                            <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={BRASS} fillOpacity={sel ? 0.10 : 0.04}
                                stroke={sel ? BRASS : '#8a8a8a'} strokeOpacity={sel ? 0.95 : 0.6} strokeWidth={sel ? 2 : 1.25} vectorEffect="non-scaling-stroke"
                                style={{ cursor: 'grab' }} strokeDasharray={sel ? undefined : '6 4'}
                                onMouseDown={(e) => downOn(e, cl, 'move')} onDoubleClick={(e) => { e.stopPropagation(); if (onRename) onRename(cl.id); }} />
                            <text x={cx} y={Math.max(fs * 1.1, cy - ry - fs * 0.5)} textAnchor="middle" fill={sel ? BRASS : '#777'}
                                style={{ fontSize: fs, fontFamily: 'monospace', letterSpacing: '0.06em', textTransform: 'uppercase', pointerEvents: 'none' }}>
                                {String(cl.name || '').replace(/[-_]+/g, ' ')}
                            </text>
                            {sel && (
                                <rect x={cx + rx - 5} y={cy + ry - 5} width={10} height={10} fill="#fff" stroke={BRASS} strokeWidth="1.5"
                                    vectorEffect="non-scaling-stroke" style={{ cursor: 'nwse-resize' }} onMouseDown={(e) => downOn(e, cl, 'resize')} />
                            )}
                        </g>
                    );
                })}
                {preview && drag?.mode === 'draw' && (
                    <ellipse cx={preview.cx * w} cy={preview.cy * h} rx={preview.rx * w} ry={preview.ry * h}
                        fill={BRASS} fillOpacity="0.10" stroke={BRASS} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeDasharray="6 4" />
                )}
            </svg>
        </div>
    );
};
