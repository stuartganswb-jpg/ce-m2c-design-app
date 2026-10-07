// THE PARTS OF A CARD, SAID THE SAME ON EVERY FLOOR (Shared/partFacts, Stuart 2026-10-07): what the work order is made
// of — "WOOD · 1 rod + 2 small parts" — which lines of the sales order it covers — "Lines 1–2 of 5" — and the order's
// other work orders by material, so wood is staged with wood and metal with metal. One component, so the shop card,
// the finishing cards and the warehouse cards cannot word it three ways. A document from before the stamp renders
// nothing — the card is exactly what it was.
import React from 'react';
import { cardFactsOf, orderMatesOf, materialRowText } from './partFacts';

const TONE = { WOOD: '#8a5a2b', METAL: '#4a5560', CLEAR: '#3f7fc4' };
const toneOf = (m) => TONE[String(m || '').toUpperCase()] || '#6b5b95';
const chip = (m) => ({ display: 'inline-block', border: `1px solid ${toneOf(m)}`, borderLeft: `4px solid ${toneOf(m)}`, color: toneOf(m), background: '#fff', padding: '2px 7px', fontFamily: 'var(--mono, monospace)', fontSize: '10px', fontWeight: 700, letterSpacing: '.04em', whiteSpace: 'nowrap' });

// `docs` — the documents this screen already holds (for the order's other work orders); `refOf` — how it names one.
const PartFactsStrip = ({ doc, docs = null, refOf, style = {}, matesLabel = 'Also on this order' }) => {
    const facts = cardFactsOf(doc);
    if (!facts.materials && !facts.lines) return null;
    const mates = docs ? orderMatesOf(doc, docs, refOf) : [];
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', ...style }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                {(doc.partsByMaterial || []).map(r => <span key={r.material} style={chip(r.material)}>{materialRowText(r)}</span>)}
                {facts.lines && <span style={{ fontFamily: 'var(--mono, monospace)', fontSize: '10px', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink, #1c1a16)', border: '1px solid var(--ink, #1c1a16)', padding: '2px 7px', whiteSpace: 'nowrap' }}>{facts.lines}</span>}
            </div>
            {mates.length > 0 && (
                <div style={{ fontFamily: 'var(--mono, monospace)', fontSize: '10px', color: 'var(--ink-soft, #524e46)', lineHeight: 1.5 }}>
                    {matesLabel}: {mates.map((m, i) => (
                        <span key={m.id}>{i ? '  ·  ' : ''}<b style={{ color: toneOf(m.head === 'MIXED' ? '' : m.head) }}>{m.ref}</b>{m.finish ? ` ${m.finish}` : ''} — {m.materials}</span>
                    ))}
                </div>
            )}
        </div>
    );
};

export default PartFactsStrip;
