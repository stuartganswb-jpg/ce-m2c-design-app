// ADD-ON PICKER (Stuart 2026-07-30) — the Quick-Ship-shaped step at the end of checkout.
//
// "we add a step to cpq that looks like quick ship where it presents lots of options that we can
// add to an order as single lines to go along with the configuration, so we do not need to add
// these items to a cpq flow but rather have them be selections at the end."
//
// Deliberately presentational: it owns no data and no pricing. The catalogue and the resulting
// lines come from Shared/feeRules (buildFeeCatalog / buildAddOnLines), so CPQ, Quick Ship and the
// portal all show the same fees at the same amounts without three copies of the arithmetic.
//
// Two shapes on one grid, because the fee sheet has two:
//   FLAT/per-unit  a quantity box — the unit says what you are counting (returns, feet, bends…)
//   PERCENTAGE     a tick — it is on or off, and the amount follows the configuration subtotal
// Every selected row shows its own arithmetic ("2 returns × 40.00", "25% of 1200.00 = …, below the
// 100.00 minimum, so the minimum applies") so a number on a quote is never a mystery.
import React from 'react';
import { computeFee } from './feeRules';

const T = {
    ink: '#1c1a16', inkSoft: '#524e46', brass: '#b08d57', brassDark: '#7d6031',
    line: '#d9d4ca', paper: '#faf8f4', paper2: '#f2efe8', green: '#3a7d44',
    mono: "'Courier New', monospace",
};

const money = (n) => `$${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;

const AddOnPicker = ({ catalog, selections, onChange, configSubtotal, title = 'Add-ons & fees', note, compact = false }) => {
    if (!catalog || !catalog.length) return null;
    const set = (id, v) => onChange({ ...(selections || {}), [id]: v });

    const chosen = catalog.filter(e => {
        const v = (selections || {})[e.id];
        return e.rule.mode === 'PERCENT' ? !!v : (parseFloat(v) || 0) > 0;
    });
    const total = chosen.reduce((s, e) => {
        const v = (selections || {})[e.id];
        return s + computeFee({ rule: e.rule, unitPrice: e.unitPrice, qty: e.rule.mode === 'PERCENT' ? 1 : v, configSubtotal }).amount;
    }, 0);

    return (
        <div style={{ border: `1px solid ${T.line}`, background: '#fff', marginTop: '16px' }}>
            <div style={{ padding: '12px 16px', background: T.paper2, borderBottom: `1px solid ${T.line}`, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: T.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: T.ink }}>{title}</span>
                <span style={{ fontFamily: T.mono, fontSize: '11px', color: chosen.length ? T.green : T.inkSoft }}>
                    {chosen.length ? `${chosen.length} added · ${money(total)}` : 'none added'}
                </span>
            </div>
            {note && <div style={{ padding: '10px 16px', fontSize: '0.82rem', color: T.inkSoft, borderBottom: `1px solid ${T.line}` }}>{note}</div>}
            <div style={{ maxHeight: compact ? '260px' : '340px', overflowY: 'auto' }}>
                {catalog.map(e => {
                    const v = (selections || {})[e.id];
                    const on = e.rule.mode === 'PERCENT' ? !!v : (parseFloat(v) || 0) > 0;
                    const calc = on ? computeFee({ rule: e.rule, unitPrice: e.unitPrice, qty: e.rule.mode === 'PERCENT' ? 1 : v, configSubtotal }) : null;
                    return (
                        <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '9px 16px', borderBottom: `1px solid ${T.paper2}`, background: on ? 'rgba(58,125,68,.05)' : '#fff' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: '0.9rem', color: T.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name || e.code}</div>
                                <div style={{ fontFamily: T.mono, fontSize: '10px', color: T.inkSoft, marginTop: '2px' }}>
                                    {e.code} · {e.summary}
                                    {calc && <span style={{ color: T.brassDark }}> · {calc.explain}</span>}
                                </div>
                            </div>
                            {e.rule.mode === 'PERCENT' ? (
                                <label style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer', fontFamily: T.mono, fontSize: '10px', color: T.inkSoft, textTransform: 'uppercase' }}>
                                    <input type="checkbox" checked={!!v} onChange={ev => set(e.id, ev.target.checked)} style={{ width: '15px', height: '15px', cursor: 'pointer' }} />
                                    add
                                </label>
                            ) : (
                                <input
                                    type="number" min="0" step="any"
                                    value={v ?? ''}
                                    onChange={ev => set(e.id, ev.target.value === '' ? '' : Math.max(0, parseFloat(ev.target.value) || 0))}
                                    placeholder="0"
                                    title={`Quantity — ${e.summary}`}
                                    style={{ width: '76px', padding: '6px 7px', textAlign: 'right', fontFamily: T.mono, fontSize: '12px', fontWeight: 600, border: `1px solid ${on ? T.brass : T.line}`, outline: 'none' }}
                                />
                            )}
                            <div style={{ width: '92px', textAlign: 'right', fontFamily: T.mono, fontSize: '12px', fontWeight: 600, color: on ? T.ink : T.line }}>
                                {on ? money(calc.amount) : '—'}
                            </div>
                        </div>
                    );
                })}
            </div>
            {chosen.length > 0 && (
                <div style={{ padding: '10px 16px', borderTop: `1px solid ${T.line}`, background: T.paper, display: 'flex', justifyContent: 'space-between', fontFamily: T.mono, fontSize: '11px' }}>
                    <span style={{ color: T.inkSoft }}>Add-ons — each becomes its own line on the order</span>
                    <b style={{ color: T.ink }}>{money(total)}</b>
                </div>
            )}
        </div>
    );
};

export default AddOnPicker;
