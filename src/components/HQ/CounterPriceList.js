// ── $$ PRICE LIST — the counter's quick reference (S7, 2026-10-15) ─────────────────────────────────
//
// Stuart: "a simple tab as a price list for quick reference, just show the category throws or pillows, and
// displays prices at base price, then a check box to show the prices at less 10%, 20%, 30%, 40%, 50% or 60%
// … needs to be really quick to look at". Read-only. Pillows = the price chart (size × group) the quick sell
// charges; Throws = each throw's own price per colourway. A ticked level prints under the base in every cell,
// rounded as the order discount rounds. The rule is Shared/counterPriceList (pure).
import React, { useEffect, useMemo, useState } from 'react';
import { db } from '../../firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { DEFAULT_PILLOW_PRICING, PILLOW_PRICING_DOC } from '../Shared/pillowPricing';
import { colourwaysOf } from '../Shared/pillowCatalog';
import { DISCOUNT_LEVELS, pillowPriceGridOf, throwPriceRowsOf, money } from '../Shared/counterPriceList';

const mono = { fontFamily: 'var(--mono)', fontSize: '11px', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-soft)' };
const chip = (on) => ({ padding: '14px 20px', border: `1px solid ${on ? 'var(--ink)' : 'var(--line)'}`, background: on ? 'var(--ink)' : '#fff', cursor: 'pointer', ...mono, fontSize: '13px', color: on ? '#fff' : 'var(--ink)' });
const th = { ...mono, textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid var(--ink)', background: '#fff', position: 'sticky', top: 0 };
const td = { padding: '10px 12px', borderBottom: '1px solid var(--line)', verticalAlign: 'top', fontFamily: 'var(--sans)' };

const Cell = ({ cell }) => (
    <div>
        <div style={{ fontSize: '1.25rem', fontWeight: 600, color: cell.base === null ? 'var(--ink-soft)' : 'var(--ink)' }}>{money(cell.base)}</div>
        {cell.less.map(l => <div key={l.pct} style={{ fontSize: '1rem', color: 'var(--brass)', whiteSpace: 'nowrap' }}>{money(l.price)} <span style={{ ...mono, fontSize: '9px', color: 'var(--ink-soft)' }}>−{l.pct}%</span></div>)}
    </div>
);

const CounterPriceList = ({ items = [], rateFor = null }) => {
    const [tab, setTab] = useState('PILLOWS');
    const [ticked, setTicked] = useState([]);
    const [q, setQ] = useState('');
    const [pricing, setPricing] = useState(null);
    useEffect(() => onSnapshot(doc(db, 'system', PILLOW_PRICING_DOC), s => setPricing(s.exists() ? { ...DEFAULT_PILLOW_PRICING, ...s.data() } : { ...DEFAULT_PILLOW_PRICING }), () => setPricing({ ...DEFAULT_PILLOW_PRICING })), []);
    const catalog = useMemo(() => colourwaysOf(items), [items]);
    const grid = useMemo(() => pillowPriceGridOf(pricing || DEFAULT_PILLOW_PRICING, ticked), [pricing, ticked]);
    const throwRows = useMemo(() => throwPriceRowsOf(catalog, { ticked, q, rateFor }), [catalog, ticked, q, rateFor]);
    const toggle = (pct) => setTicked(prev => (prev.includes(pct) ? prev.filter(x => x !== pct) : [...prev, pct]));

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem' }}>$$ Price list</span>
                <button onClick={() => setTab('PILLOWS')} style={chip(tab === 'PILLOWS')}>🛋 Pillows</button>
                <button onClick={() => setTab('THROWS')} style={chip(tab === 'THROWS')}>🧣 Throws</button>
                {tab === 'THROWS' && <input value={q} onChange={e => setQ(e.target.value)} placeholder="pattern · colour · number" style={{ boxSizing: 'border-box', padding: '12px 14px', fontSize: '1rem', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', width: '260px' }} />}
                <span style={{ ...mono, marginLeft: 'auto' }}>base price{ticked.length ? ` · less ${[...ticked].sort((a, b) => a - b).map(p => `${p}%`).join(' / ')}` : ''}</span>
            </div>
            <div style={{ display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={mono}>Show less</span>
                {DISCOUNT_LEVELS.map(pct => (
                    <label key={pct} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', border: `1px solid ${ticked.includes(pct) ? 'var(--ink)' : 'var(--line)'}`, background: ticked.includes(pct) ? 'var(--paper-2)' : '#fff', cursor: 'pointer', fontSize: '1.05rem', fontFamily: 'var(--sans)' }}>
                        <input type="checkbox" checked={ticked.includes(pct)} onChange={() => toggle(pct)} style={{ width: '20px', height: '20px' }} />{pct}%
                    </label>
                ))}
                {ticked.length > 0 && <button onClick={() => setTicked([])} style={{ background: 'none', border: 'none', cursor: 'pointer', ...mono, textDecoration: 'underline' }}>clear</button>}
            </div>

            {tab === 'PILLOWS' && (grid.empty
                ? <div style={{ color: 'var(--ink-soft)' }}>No price chart applied — 6.5 Tools → Pillow Pricing.</div>
                : <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid var(--line)' }}>
                    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                        <thead><tr><th style={th}>Size (wide × tall)</th>{grid.groups.map(g => <th key={g.code} style={th}>{g.label}</th>)}</tr></thead>
                        <tbody>{grid.rows.map(r => (
                            <tr key={r.sizeKey}>
                                <td style={{ ...td, fontFamily: 'var(--mono)', fontSize: '1.1rem', fontWeight: 700, whiteSpace: 'nowrap' }}>{r.sizeKey}</td>
                                {r.cells.map((c, i) => <td key={i} style={td}><Cell cell={c} /></td>)}
                            </tr>
                        ))}</tbody>
                    </table>
                </div>)}

            {tab === 'THROWS' && (
                <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid var(--line)', maxHeight: 'calc(100vh - 260px)', overflowY: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                        <thead><tr><th style={th}>Colourway</th>{throwRows.variants.map(v => <th key={v.code} style={th}>{v.label}</th>)}</tr></thead>
                        <tbody>{throwRows.rows.map(r => (
                            <tr key={r.key}>
                                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                                    <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{r.pattern}</div>
                                    <div style={mono}>#{r.colour}{r.colourName ? ` ${r.colourName}` : ''}{r.group ? ` · group ${r.group}` : ''}</div>
                                </td>
                                {r.cells.map(c => <td key={c.variant} style={td}><Cell cell={c} /></td>)}
                            </tr>
                        ))}</tbody>
                    </table>
                    {throwRows.rows.length === 0 && <div style={{ padding: '14px', color: 'var(--ink-soft)' }}>No throw matches.</div>}
                </div>
            )}
        </div>
    );
};

export default CounterPriceList;
