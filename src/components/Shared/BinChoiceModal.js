import React, { useState } from 'react';
import { binPickRefusal } from './fulfilmentBins';

// "CONFIRM BINS" — the packer says which bin each piece came out of, for the lines NetSuite cannot answer itself
// (Shared/fulfilmentBins, Stuart 2026-10-12). One window, two screens (the pack bench and the Fulfilment tab): the hook
// gives a screen `askBins(title, choices)` → a promise of { [orderLine]: [{ binId, qty }] }, or null for "not now".
const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

const BinChoiceModal = ({ ask, onAnswer }) => {
    // qty typed per line per bin; a pre-chosen bin (the order's own) arrives filled in.
    const [qty, setQty] = useState(() => Object.fromEntries((ask.choices || []).map(c => [c.orderLine, Object.fromEntries((c.pick || []).map(p => [p.binId, String(p.qty)]))])));
    const pickOf = (c) => c.bins.map(b => ({ binId: b.id, qty: N((qty[c.orderLine] || {})[b.id]) })).filter(p => p.qty > 0);
    const allFrom = (c, b) => setQty(prev => ({ ...prev, [c.orderLine]: { [b.id]: String(c.qty) } }));
    const typed = (c, b, v) => setQty(prev => ({ ...prev, [c.orderLine]: { ...(prev[c.orderLine] || {}), [b.id]: v } }));
    const problems = (ask.choices || []).map(c => binPickRefusal(c, pickOf(c))).filter(Boolean);
    const mono = { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' };
    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 12000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
            <div style={{ background: '#fff', padding: '24px', width: 'min(720px, 96vw)', maxHeight: '90vh', overflowY: 'auto', border: '1px solid var(--line)', borderRadius: '4px', boxShadow: '0 16px 60px rgba(0,0,0,0.3)' }}>
                <div style={{ fontFamily: 'var(--serif)', fontSize: '1.3rem', color: 'var(--ink)' }}>Confirm bins — {ask.title}</div>
                <div style={{ ...mono, color: 'var(--ink-soft)', margin: '6px 0 16px' }}>NetSuite holds {ask.choices.length === 1 ? 'this item' : 'these items'} in more than one bin — say which bin the pieces came out of</div>
                {ask.choices.map(c => {
                    const why = binPickRefusal(c, pickOf(c));
                    const single = pickOf(c).length === 1 ? pickOf(c)[0].binId : '';
                    return (
                        <div key={c.orderLine} style={{ borderTop: '1px solid var(--line)', padding: '12px 0' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                                <div style={{ fontFamily: 'var(--mono)', fontSize: '0.95rem', fontWeight: 700, color: 'var(--ink)' }}>{c.item}</div>
                                <div style={{ ...mono, color: 'var(--ink)' }}>ships {c.qty}</div>
                            </div>
                            {c.bins.map(b => (
                                <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px', flexWrap: 'wrap' }}>
                                    <button onClick={() => allFrom(c, b)} disabled={b.onhand < c.qty}
                                        title={b.onhand < c.qty ? `Holds ${b.onhand} — not enough for the whole line; type a quantity to split the line across bins` : `Take all ${c.qty} from ${b.bin}`}
                                        style={{ ...mono, minWidth: '210px', textAlign: 'left', padding: '9px 12px', cursor: b.onhand < c.qty ? 'not-allowed' : 'pointer', opacity: b.onhand < c.qty ? 0.55 : 1,
                                            background: single === b.id ? 'var(--ink)' : '#fff', color: single === b.id ? '#fff' : 'var(--ink)', border: '1px solid var(--ink)' }}>
                                        {single === b.id ? '● ' : '○ '}{b.bin}
                                    </button>
                                    <span style={{ ...mono, color: 'var(--ink-soft)', minWidth: '110px' }}>holds {b.onhand}</span>
                                    <input type="number" min="0" step="any" value={(qty[c.orderLine] || {})[b.id] || ''} onChange={e => typed(c, b, e.target.value)} placeholder="0"
                                        style={{ width: '90px', padding: '8px', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '0.9rem', textAlign: 'right' }} />
                                </div>
                            ))}
                            {why && <div style={{ ...mono, color: '#d9534f', marginTop: '8px', textTransform: 'none', letterSpacing: 0, fontSize: '11px' }}>{why}</div>}
                        </div>
                    );
                })}
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginTop: '16px', flexWrap: 'wrap' }}>
                    <button onClick={() => onAnswer(null)} style={{ ...mono, padding: '10px 14px', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink-soft)', cursor: 'pointer' }}>Not now — the fulfilment is not sent</button>
                    <button disabled={problems.length > 0} onClick={() => onAnswer(Object.fromEntries(ask.choices.map(c => [c.orderLine, pickOf(c)])))}
                        style={{ ...mono, padding: '10px 18px', background: problems.length ? '#bbb' : 'var(--ink)', color: '#fff', border: 'none', cursor: problems.length ? 'not-allowed' : 'pointer', fontWeight: 700 }}>
                        Send the fulfilment from {ask.choices.length === 1 ? 'this bin' : 'these bins'}
                    </button>
                </div>
            </div>
        </div>
    );
};

/** const { askBins, binModal } = useBinAsk(); render {binModal} once; await askBins('SO60991', choices). */
export const useBinAsk = () => {
    const [ask, setAsk] = useState(null);
    const askBins = (title, choices) => new Promise(resolve => setAsk({ title, choices, resolve }));
    const onAnswer = (picks) => { const a = ask; setAsk(null); if (a && typeof a.resolve === 'function') a.resolve(picks); };
    return { askBins, binModal: ask ? <BinChoiceModal key={ask.title} ask={ask} onAnswer={onAnswer} /> : null };
};

export default BinChoiceModal;
