import React, { useMemo, useState } from 'react';
import { daySummaryOf, dayBoundsOf, dayStrOf, daySummaryText, daySummaryHtml, soLabel, VERDICT } from '../Shared/daySummary';
import { FINISH_MODE } from '../Shared/orderStatus';
import { printHtmlDocument } from '../Shared/labelPrint';

// THE DAY'S ORDERS — a screen opened from RTG (Stuart 2026-10-12: "end of day summary of orders entered and their status
// from both sales entry and cpq, so that management can see what has happened and overrule"). It reads the feeds the
// board already holds (Shared/daySummary — pure) and writes nothing itself: every overrule button here is the RTG
// card's own (the finish switch, the review, the dispatch), handed in by the board, so the two can never differ.
const TONE = {
    [VERDICT.NETSUITE]: '#d9534f', [VERDICT.REVIEW]: '#8a6d1f', [VERDICT.HOLD]: '#d9534f', [VERDICT.NOT_STARTED]: '#d9534f',
    [VERDICT.PARKED]: '#8a6d1f', [VERDICT.FLOOR]: '#3a7d44', [VERDICT.STOCK]: 'var(--ink-soft)', [VERDICT.DONE]: 'var(--ink-soft)', [VERDICT.CLOSED]: 'var(--ink-soft)',
};
const mono = { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' };
const btn = (strong) => ({ ...mono, padding: '8px 12px', cursor: 'pointer', background: strong ? 'var(--ink)' : '#fff', color: strong ? '#fff' : 'var(--ink)', border: '1px solid var(--ink)', whiteSpace: 'nowrap' });
const timeOf = (ms) => (ms ? new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');

const DaySummaryPanel = ({ onClose, orders = [], workOrders = [], finDocs = [], shopDocs = [], brand = '', userName = '', canOverrule = false, isOrderEntry, refOf, onToggleFinish, onReview, onDispatch }) => {
    const [day, setDay] = useState(dayStrOf());
    const [copied, setCopied] = useState(false);
    const sum = useMemo(() => {
        const { start, end } = dayBoundsOf(day);
        return daySummaryOf({ orders, workOrders, finDocs, shopDocs, start, end, isOrderEntry, refOf });
    }, [day, orders, workOrders, finDocs, shopDocs, isOrderEntry, refOf]);
    const soOf = (id) => orders.find(o => o.id === id) || null;
    const shift = (n) => { const { start } = dayBoundsOf(day); setDay(dayStrOf(start + n * 86400000 + 43200000)); };
    const c = sum.counts;
    const copy = async () => {
        const text = daySummaryText(sum, { day, brand });
        try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2500); }
        catch (e) { window.prompt('Copy the summary:', text); }
    };
    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10500, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px 16px', overflowY: 'auto' }}>
            <div style={{ background: 'var(--paper, #faf9f6)', width: 'min(1240px, 98vw)', border: '1px solid var(--line)', boxShadow: '0 16px 60px rgba(0,0,0,0.3)' }}>
                <div style={{ background: '#fff', borderBottom: '1px solid var(--line)', padding: '18px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap' }}>
                    <div>
                        <div style={{ ...mono, color: 'var(--ink-soft)' }}>RTG · both doors · {String(brand || '').toUpperCase()}</div>
                        <div style={{ fontFamily: 'var(--serif)', fontSize: '1.6rem', color: 'var(--ink)' }}>Orders entered</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <button style={btn(false)} onClick={() => shift(-1)} title="The day before">◀</button>
                        <input type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)} style={{ padding: '7px 8px', border: '1px solid var(--ink)', fontFamily: 'var(--mono)', fontSize: '0.85rem' }} />
                        <button style={btn(false)} onClick={() => shift(1)} title="The day after">▶</button>
                        <button style={btn(false)} onClick={() => setDay(dayStrOf())}>Today</button>
                        <button style={btn(false)} onClick={() => printHtmlDocument(daySummaryHtml(sum, { day, brand, printedBy: userName }), { autoPrintDelay: 400 })} title="Prints the day — or saves it as a PDF to send">🖨 Print / PDF</button>
                        <button style={btn(false)} onClick={copy} title="Copies the day as plain text, to paste into a message or an email">{copied ? '✓ Copied' : '⧉ Copy text'}</button>
                        <button style={btn(true)} onClick={onClose}>Close</button>
                    </div>
                </div>
                <div style={{ padding: '14px 22px', display: 'flex', gap: '22px', flexWrap: 'wrap', borderBottom: '1px solid var(--line)', background: '#fff' }}>
                    {[[c.entered, 'entered'], [c.orderEntry, 'order entry'], [c.cpq, 'cpq'], ...(c.display ? [[c.display, 'display']] : []), [c.needAttention, 'need attention', c.needAttention ? '#d9534f' : null], [c.onFloor, 'on the floor'], [c.parked, 'parked in RTG'], [c.asAvailable, 'finish as available'], [c.backorderedParts, 'parts backordered today', c.backorderedParts ? '#d9534f' : null]].map(([n, label, tone]) => (
                        <div key={label}><div style={{ fontFamily: 'var(--serif)', fontSize: '1.5rem', color: tone || 'var(--ink)', lineHeight: 1 }}>{n}</div><div style={{ ...mono, fontSize: '9px', color: 'var(--ink-soft)', marginTop: '4px' }}>{label}</div></div>
                    ))}
                </div>
                <div style={{ padding: '16px 22px 22px' }}>
                    {!canOverrule && <div style={{ ...mono, color: 'var(--ink-soft)', marginBottom: '10px', textTransform: 'none', letterSpacing: 0, fontSize: '11px' }}>Read only — a manager and above can switch how an order finishes, open its review or dispatch it from here.</div>}
                    {sum.rows.length === 0 && <div style={{ padding: '26px', background: '#fff', border: '1px dashed var(--line)', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No sales order was entered that day.</div>}
                    {sum.rows.map(r => {
                        const so = soOf(r.id);
                        const asAvail = r.finishMode === FINISH_MODE.AS_AVAILABLE;
                        return (
                            <div key={r.id} style={{ background: '#fff', border: '1px solid var(--line)', borderLeft: `4px solid ${TONE[r.verdict] || 'var(--line)'}`, padding: '12px 14px', marginBottom: '8px', display: 'grid', gridTemplateColumns: 'minmax(190px, 1.1fr) minmax(190px, 1fr) minmax(280px, 2.4fr) auto', gap: '14px', alignItems: 'start' }}>
                                <div>
                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '0.95rem', fontWeight: 700, color: 'var(--ink)' }}>{soLabel(r.ref)}</div>
                                    <div style={{ fontSize: '0.9rem', color: 'var(--ink)' }}>{r.customer}</div>
                                    <div style={{ ...mono, fontSize: '9px', color: 'var(--ink-soft)', marginTop: '4px' }}>{r.door}{r.enteredBy ? ` · ${r.enteredBy}` : ''} · {timeOf(r.enteredAt)} · {r.lineCount} line{r.lineCount === 1 ? '' : 's'}</div>
                                </div>
                                <div>
                                    <div style={{ ...mono, fontWeight: 700, color: TONE[r.verdict] || 'var(--ink)' }}>{r.verdict}</div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginTop: '4px' }}>NetSuite: {r.netsuite}</div>
                                    <div style={{ fontSize: '0.8rem', color: asAvail ? '#8a6d1f' : 'var(--ink-soft)', marginTop: '2px' }}>
                                        {asAvail ? '⚡ Finish as available' : 'Finish complete'}{r.finishBy ? ` · ${r.finishBy}` : (r.finishAsked ? '' : ' · default')}
                                    </div>
                                </div>
                                <div style={{ fontSize: '0.85rem', color: 'var(--ink)', lineHeight: 1.5 }}>
                                    {r.work.map(w => <div key={w.id}><span style={{ fontFamily: 'var(--mono)', fontSize: '0.78rem', fontWeight: 700 }}>{w.ref}</span>{w.finish ? <span style={{ color: 'var(--ink-soft)' }}> ({w.finish})</span> : null} — <span style={{ color: w.held ? '#d9534f' : (w.state === 'PARKED' ? '#8a6d1f' : 'var(--ink)') }}>{w.text}</span></div>)}
                                    {r.review.map(l => <div key={`rv${l.lineIdx}`} style={{ color: '#8a6d1f' }}><b>Needs review</b> — line {l.lineIdx + 1} · {l.erp}{l.reason ? `: ${l.reason}` : ''}</div>)}
                                    {r.backorders.map(b => <div key={`bo${b.code}`} style={{ color: '#d9534f' }}><b>Backorder</b> — {b.qty} × {b.code}{b.onOrder ? ` (${b.onOrder} on order)` : ' (nothing on order)'}</div>)}
                                    {!r.work.length && !r.review.length && !r.backorders.length && <span style={{ color: 'var(--ink-soft)', fontStyle: 'italic' }}>{r.verdict === VERDICT.STOCK ? 'Stock lines — picked and packed by the warehouse.' : (r.verdict === VERDICT.NETSUITE ? 'Nothing starts until NetSuite accepts it.' : 'Nothing has started yet.')}</span>}
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'stretch', minWidth: '170px' }}>
                                    {canOverrule && so && r.verdict !== VERDICT.CLOSED && onToggleFinish && (
                                        <button style={{ ...btn(false), borderColor: asAvail ? 'var(--ink)' : 'var(--brass)', color: asAvail ? 'var(--ink)' : '#8a6d1f' }} onClick={() => onToggleFinish(so)}
                                            title="The same switch as the RTG card: it asks why, records who and when, and (turned on) starts what is ready.">
                                            {asAvail ? 'Switch to complete' : '⚡ Finish as available'}
                                        </button>
                                    )}
                                    {canOverrule && so && r.canReview && onReview && <button style={btn(false)} onClick={() => onReview(so)} title="Opens this order's review on Order Entry Needs.">Review &amp; start →</button>}
                                    {canOverrule && so && r.canDispatch && onDispatch && <button style={btn(false)} onClick={() => onDispatch(so)} title="Splits this CPQ order to the floors now — the RTG card's own dispatch.">Dispatch now</button>}
                                </div>
                            </div>
                        );
                    })}
                    <div style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', color: 'var(--ink)', margin: '22px 0 8px' }}>Backordered today</div>
                    {sum.backorders.length === 0
                        ? <div style={{ padding: '14px', background: '#fff', border: '1px dashed var(--line)', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No part went on backorder that day.</div>
                        : (
                            <div style={{ background: '#fff', border: '1px solid var(--line)' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '2fr 90px 110px 2fr', gap: '10px', padding: '8px 14px', ...mono, fontSize: '9px', color: 'var(--ink-soft)', borderBottom: '1px solid var(--line)' }}><div>Part</div><div>Short</div><div>On order</div><div>Orders</div></div>
                                {sum.backorders.map(b => (
                                    <div key={b.code} style={{ display: 'grid', gridTemplateColumns: '2fr 90px 110px 2fr', gap: '10px', padding: '8px 14px', borderBottom: '1px solid var(--line)', fontSize: '0.88rem' }}>
                                        <div><span style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}>{b.code}</span>{b.name ? <span style={{ color: 'var(--ink-soft)' }}> — {b.name}</span> : null}</div>
                                        <div style={{ color: '#d9534f', fontWeight: 700 }}>{b.qty}</div>
                                        <div style={{ color: b.onOrder ? 'var(--ink)' : '#d9534f' }}>{b.onOrder || 'nothing'}</div>
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '0.8rem' }}>{b.orders.join(', ')}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    <div style={{ ...mono, fontSize: '9px', color: 'var(--ink-soft)', marginTop: '10px', textTransform: 'none', letterSpacing: 0 }}>Worked from Stock View → Sales Snapshot → Backorders (a PO or a work order covers each).</div>
                </div>
            </div>
        </div>
    );
};

export default DaySummaryPanel;
