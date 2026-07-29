// TOOLS, SPECS & FAQs — the customer-facing reference page. Twin of HQ tab 6.5.
//
// The engineering lives in shared/bracketSpan.js, a VERBATIM COPY of
// src/components/Shared/bracketSpan.js (same convention as sizeMatrix / priceLevels / bayMath /
// quickShipUom). Change one, copy to the other in the same commit, and diff them.
//
// Difference from the HQ twin: customers see the ANSWER, never the engineering. No moduli, no
// yield strengths, no safety factors, no gauges — those are on the staff page only.
//
// Built as a registry: the span guide is the first of several tools.
import React, { useState, useMemo } from 'react';
import {
  FABRIC_CLASSES, fabricClass, spanTable, bracketsFor, ftIn,
  ROD_COLLECTIONS, DEFAULT_DROP_FT,
} from './shared/bracketSpan';

const BracketSpanGuide = () => {
  const [fabricId, setFabricId] = useState('PRINT');
  const [dropFt, setDropFt] = useState(String(DEFAULT_DROP_FT));
  const [rodLen, setRodLen] = useState('');
  const [collectionId, setCollectionId] = useState('');

  const fab = fabricClass(fabricId);
  const drop = parseFloat(dropFt);
  const rows = useMemo(
    () => (drop > 0 ? spanTable(fabricId, drop, collectionId) : []),
    [fabricId, drop, collectionId]
  );
  const rodInches = parseFloat(rodLen) > 0 ? parseFloat(rodLen) : null;

  return (
    <div className="card" style={{ padding: 24 }}>
      <h3 style={{ fontFamily: 'var(--serif)', fontSize: '1.5rem', fontWeight: 500, margin: '0 0 6px' }}>Bracket Span Guide</h3>
      <p style={{ color: 'var(--ink-soft)', margin: '0 0 22px', lineHeight: 1.65 }}>
        How far apart your brackets can sit before the rod begins to sag. Choose the fabric weight and
        the curtain drop — each rod shows the widest span it will comfortably carry.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 20 }}>
        <label style={{ display: 'block' }}>
          <span className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>Fabric weight</span>
          <select value={fabricId} onChange={(e) => setFabricId(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', padding: 10, border: '1px solid var(--line)', background: 'var(--card)', font: 'inherit', color: 'var(--ink)' }}>
            {FABRIC_CLASSES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
          <span style={{ display: 'block', fontSize: '.8rem', color: 'var(--ink-soft)', marginTop: 6, fontStyle: 'italic' }}>{fab.example}</span>
        </label>

        <label style={{ display: 'block' }}>
          <span className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>Curtain length (ft)</span>
          <input type="number" min="1" step="0.5" value={dropFt} onChange={(e) => setDropFt(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', padding: 10, border: '1px solid var(--line)', background: 'var(--card)', font: 'inherit', color: 'var(--ink)' }} />
          <span style={{ display: 'block', fontSize: '.8rem', color: 'var(--ink-soft)', marginTop: 6, fontStyle: 'italic' }}>Rod to floor — the longer the curtain, the heavier. 8 ft is typical.</span>
        </label>

        <label style={{ display: 'block' }}>
          <span className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>Rod length (in) — optional</span>
          <input type="number" min="0" value={rodLen} onChange={(e) => setRodLen(e.target.value)} placeholder="e.g. 120"
            style={{ width: '100%', boxSizing: 'border-box', padding: 10, border: '1px solid var(--line)', background: 'var(--card)', font: 'inherit', color: 'var(--ink)' }} />
          <span style={{ display: 'block', fontSize: '.8rem', color: 'var(--ink-soft)', marginTop: 6, fontStyle: 'italic' }}>We'll add the bracket count.</span>
        </label>
      </div>

      <div className="finish-bar" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {[{ id: '', label: 'All rods' }, ...ROD_COLLECTIONS].map((c) => (
          <button key={c.id || 'ALL'} onClick={() => setCollectionId(c.id)}
            className={`finish-tab${collectionId === c.id ? ' active' : ''}`}>{c.label}</button>
        ))}
      </div>

      {!(drop > 0) ? (
        <div className="empty">Enter a curtain drop to see the spans.</div>
      ) : (
        <div className="lines">
          <table>
            <thead>
              <tr>
                <th>Rod</th>
                <th>Collection</th>
                <th style={{ width: 150 }}>Max bracket span</th>
                {rodInches ? <th style={{ width: 110 }}>Brackets</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.label} <span style={{ color: 'var(--ink-soft)', fontSize: '.8rem' }}>{r.material}</span></td>
                  <td style={{ color: 'var(--ink-soft)' }}>{(ROD_COLLECTIONS.find((c) => c.id === r.collection) || {}).label}</td>
                  <td className="num">
                    <strong>{ftIn(r.spanInches)}</strong> <span style={{ color: 'var(--ink-soft)', fontSize: '.8rem' }}>{r.spanInches}"</span>
                    {r.limitedBy === 'LOAD' && <div style={{ fontSize: '.7rem', color: 'var(--brass)' }}>shortened for this fabric</div>}
                  </td>
                  {rodInches ? <td className="num" style={{ color: 'var(--brass)', fontWeight: 600 }}>{bracketsFor(rodInches, r.spanInches)}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ fontSize: '.82rem', color: 'var(--ink-soft)', lineHeight: 1.65, marginTop: 18, paddingTop: 14, borderTop: '1px dashed var(--line)' }}>
        Spans are rounded down to the inch and never exceed our recommended maximum for that rod. Heavier
        fabric and longer curtains shorten the span further — where that happens we've marked the row. The 2"
        rectangular rod is part of the Fabricut collection and is always mounted with the 2" dimension
        vertical. If your opening falls close to a limit, talk to us — an extra centre bracket is always the
        safer choice.
      </p>
    </div>
  );
};

const TOOLS = [
  { id: 'span', label: 'Bracket Span Guide', render: () => <BracketSpanGuide /> },
];

export default function Tools() {
  const [tool, setTool] = useState(TOOLS[0].id);
  const active = TOOLS.find((t) => t.id === tool) || TOOLS[0];
  return (
    <>
      <h2 className="sec">Tools, Specs &amp; FAQs</h2>
      {TOOLS.length > 1 && (
        <div className="finish-bar" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {TOOLS.map((t) => (
            <button key={t.id} onClick={() => setTool(t.id)} className={`finish-tab${tool === t.id ? ' active' : ''}`}>{t.label}</button>
          ))}
        </div>
      )}
      {active.render()}
    </>
  );
}
