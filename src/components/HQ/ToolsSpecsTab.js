import React, { useState, useMemo } from 'react';
import {
    FABRIC_CLASSES, fabricClass, loadPerFoot, spanTable, bracketsFor, ftIn,
    ROD_COLLECTIONS, DEFAULT_DROP_FT, ASSUMPTIONS,
} from '../Shared/bracketSpan';

// TOOLS, SPECS & FAQs (HQ 6.5) — the staff-side twin of the portal's Tools page. Same engineering
// (Shared/bracketSpan.js, a verbatim-copy pair with portal/src/shared/), but staff also see the
// assumptions behind the numbers; customers see only the answer.
//
// Built as a REGISTRY on purpose: the bracket-span guide is the first of several tools, so adding
// the next one is a new entry in TOOLS, not a rewrite of this file.

const theme = {
    paper: 'var(--paper)', paper2: 'var(--paper-2)', ink: 'var(--ink)',
    inkSoft: 'var(--ink-soft)', brass: 'var(--brass)', line: 'var(--line)',
};
const card = { background: '#fff', border: `1px solid ${theme.line}`, borderRadius: '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' };
const cardHd = { padding: '14px 20px', borderBottom: `1px solid ${theme.line}`, background: theme.paper, fontFamily: 'var(--serif)', fontSize: '1.15rem', fontWeight: 500, color: theme.ink };
const lbl = { fontFamily: 'var(--mono)', fontSize: '9px', letterSpacing: '.1em', textTransform: 'uppercase', color: theme.inkSoft, display: 'block', marginBottom: '5px' };
const inp = { width: '100%', boxSizing: 'border-box', padding: '10px', fontSize: '0.85rem', border: `1px solid ${theme.line}`, outline: 'none', fontFamily: 'var(--sans)', background: '#fff' };

// ---- TOOL 1 · BRACKET SPAN ----------------------------------------------------------------
const BracketSpanGuide = ({ showAssumptions }) => {
    const [fabricId, setFabricId] = useState('PRINT');
    const [dropFt, setDropFt] = useState(String(DEFAULT_DROP_FT));
    const [rodLen, setRodLen] = useState('');          // optional, inches → bracket count
    const [collectionId, setCollectionId] = useState('');

    const fab = fabricClass(fabricId);
    const drop = parseFloat(dropFt);
    const load = loadPerFoot(fab.areal, drop);
    const rows = useMemo(
        () => (drop > 0 ? spanTable(fabricId, drop, collectionId) : []),
        [fabricId, drop, collectionId]
    );
    const rodInches = parseFloat(rodLen) > 0 ? parseFloat(rodLen) : null;

    return (
        <div style={card}>
            <div style={cardHd}>Bracket Span Guide</div>
            <div style={{ padding: '18px 20px' }}>
                <p style={{ margin: '0 0 18px', fontFamily: 'var(--serif)', fontSize: '1rem', color: theme.inkSoft, lineHeight: 1.6 }}>
                    How far apart the brackets can sit before the rod starts to sag. Pick the fabric weight
                    and the curtain drop, and each rod shows the widest span it will carry.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '16px', alignItems: 'end', marginBottom: '18px' }}>
                    <div>
                        <span style={lbl}>Fabric weight</span>
                        <select value={fabricId} onChange={e => setFabricId(e.target.value)} style={inp}>
                            {FABRIC_CLASSES.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                        </select>
                        <div style={{ fontSize: '0.78rem', color: theme.inkSoft, marginTop: '5px', fontStyle: 'italic' }}>{fab.example}</div>
                    </div>
                    <div>
                        <span style={lbl}>Curtain drop (ft)</span>
                        <input type="number" min="1" step="0.5" value={dropFt} onChange={e => setDropFt(e.target.value)} style={inp} />
                        <div style={{ fontSize: '0.78rem', color: theme.inkSoft, marginTop: '5px', fontStyle: 'italic' }}>Rod to floor. 8 ft is typical.</div>
                    </div>
                    <div>
                        <span style={lbl}>Rod length (in) — optional</span>
                        <input type="number" min="0" value={rodLen} onChange={e => setRodLen(e.target.value)} placeholder="e.g. 120" style={inp} />
                        <div style={{ fontSize: '0.78rem', color: theme.inkSoft, marginTop: '5px', fontStyle: 'italic' }}>Adds the bracket count.</div>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
                    {[{ id: '', label: 'All rods' }, ...ROD_COLLECTIONS].map(c => (
                        <button key={c.id || 'ALL'} onClick={() => setCollectionId(c.id)}
                            style={{
                                padding: '8px 14px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px',
                                textTransform: 'uppercase', letterSpacing: '.08em',
                                border: `1px solid ${collectionId === c.id ? theme.ink : theme.line}`,
                                background: collectionId === c.id ? theme.ink : 'transparent',
                                color: collectionId === c.id ? '#fff' : theme.inkSoft,
                            }}>{c.label}</button>
                    ))}
                </div>

                {!(drop > 0) ? (
                    <div style={{ padding: '20px', color: theme.inkSoft, fontStyle: 'italic', fontFamily: 'var(--serif)' }}>Enter a curtain drop to see the spans.</div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                        <thead>
                            <tr style={{ background: theme.paper2 }}>
                                {['Rod', 'Collection', 'Max bracket span', rodInches ? 'Brackets needed' : ''].filter(Boolean).map(h => (
                                    <th key={h} style={{ textAlign: h === 'Rod' || h === 'Collection' ? 'left' : 'right', padding: '9px 14px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: theme.inkSoft, borderBottom: `1px solid ${theme.line}` }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(r => {
                                const n = rodInches ? bracketsFor(rodInches, r.spanInches) : null;
                                return (
                                    <tr key={r.id}>
                                        <td style={{ padding: '10px 14px', borderBottom: `1px solid ${theme.paper2}`, color: theme.ink }}>
                                            {r.label}
                                            <span style={{ fontFamily: 'var(--mono)', fontSize: '0.72rem', color: theme.inkSoft, marginLeft: '8px' }}>{r.material}</span>
                                        </td>
                                        <td style={{ padding: '10px 14px', borderBottom: `1px solid ${theme.paper2}`, color: theme.inkSoft, fontSize: '0.82rem' }}>
                                            {(ROD_COLLECTIONS.find(c => c.id === r.collection) || {}).label}
                                        </td>
                                        <td style={{ padding: '10px 14px', borderBottom: `1px solid ${theme.paper2}`, textAlign: 'right', fontFamily: 'var(--mono)', color: theme.ink }}>
                                            <strong style={{ fontWeight: 600 }}>{ftIn(r.spanInches)}</strong>
                                            <span style={{ color: theme.inkSoft, fontSize: '0.78rem', marginLeft: '8px' }}>{r.spanInches}"</span>
                                        </td>
                                        {rodInches && (
                                            <td style={{ padding: '10px 14px', borderBottom: `1px solid ${theme.paper2}`, textAlign: 'right', fontFamily: 'var(--mono)', color: theme.brass, fontWeight: 600 }}>{n}</td>
                                        )}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}

                <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: `1px dashed ${theme.line}`, fontSize: '0.8rem', color: theme.inkSoft, lineHeight: 1.6 }}>
                    Spans are rounded down to the inch. The 2" rectangular rod is Fabricut H1 only and is always
                    mounted with the 2" dimension vertical — we don't offer it the other way.
                </div>

                {/* Staff see what the numbers assume; the portal deliberately does not. */}
                {showAssumptions && (
                    <div style={{ marginTop: '12px', padding: '10px 12px', background: theme.paper, border: `1px solid ${theme.line}` }}>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: theme.brass, marginBottom: '6px' }}>Assumptions (staff only)</div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: theme.inkSoft, lineHeight: 1.7 }}>
                            {ASSUMPTIONS.map((a, i) => <div key={i}>· {a}</div>)}
                            <div>· Load at these settings: <strong style={{ color: theme.ink }}>{load.toFixed(2)} lb/ft</strong> ({fab.areal} lb/ft² × {drop || 0} ft × 2.5 fullness)</div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

// ---- The page --------------------------------------------------------------------------------
const TOOLS = [
    { id: 'span', label: 'Bracket Span Guide', blurb: 'Bracket spacing by fabric weight and drop', render: (p) => <BracketSpanGuide {...p} /> },
];

const ToolsSpecsTab = () => {
    const [activeTool, setActiveTool] = useState(TOOLS[0].id);
    const tool = TOOLS.find(t => t.id === activeTool) || TOOLS[0];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', fontFamily: 'var(--sans)' }}>
            <div style={{ ...card, padding: '20px 24px' }}>
                <span style={{ ...lbl, color: theme.brass }}>Reference</span>
                <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: theme.ink }}>Tools, Specs &amp; FAQs</h2>
                <div style={{ fontSize: '0.85rem', color: theme.inkSoft, marginTop: '6px' }}>
                    The same reference the client portal shows customers — with the engineering assumptions visible.
                </div>
            </div>

            {TOOLS.length > 1 && (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {TOOLS.map(t => (
                        <button key={t.id} onClick={() => setActiveTool(t.id)} title={t.blurb}
                            style={{
                                padding: '10px 16px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px',
                                textTransform: 'uppercase', letterSpacing: '.08em',
                                border: `1px solid ${activeTool === t.id ? theme.ink : theme.line}`,
                                background: activeTool === t.id ? theme.ink : '#fff',
                                color: activeTool === t.id ? '#fff' : theme.inkSoft,
                            }}>{t.label}</button>
                    ))}
                </div>
            )}

            {tool.render({ showAssumptions: true })}
        </div>
    );
};

export default ToolsSpecsTab;
