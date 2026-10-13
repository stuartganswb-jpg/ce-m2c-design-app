import React, { useMemo, useState, useEffect, useRef } from 'react';
import { daySummaryOf, dayBoundsOf, dayStrOf, daySummaryText, daySummaryHtml, soLabel, VERDICT } from '../Shared/daySummary';
import { FINISH_MODE } from '../Shared/orderStatus';
import { printHtmlDocument } from '../Shared/labelPrint';
import { materialRefreshable, materialCodesOf } from '../Shared/materialGrid';
import { fetchShelfFigures } from '../Shared/shelfFigures';
import { fetchStockHolds } from '../Shared/stockHolds';
import { stockToReallocateOf, REALLOCATE, REALLOCATE_WORD, orderLine, holdersText } from '../Shared/stockReallocate';
import { BRAND_NETSUITE_MAP } from '../Shared/brandNetsuite';

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
    // 📦 STOCK TO REALLOCATE (Stuart 2026-10-13: "add the warning/scenario to end of day summary so we can reallocate stock
    // if necessary prior to any build, but this does not need to stop production"). Every open document whose parts are
    // not pulled yet, against what NetSuite lists NOW — read when this screen opens and on ↻, never on a timer. It
    // reads only; nothing here holds or releases anything (Shared/stockReallocate).
    const [stock, setStock] = useState({ loading: true, items: [], error: '', at: 0, docs: 0, holdersKnown: true });
    const feeds = useRef({});
    feeds.current = { orders, workOrders, finDocs, shopDocs, refOf, brand };
    const readStock = async () => {
        const f = feeds.current;
        const targets = [
            ...(f.finDocs || []).filter(d => materialRefreshable(d, 'fin_workorders')).map(d => ({ coll: 'fin_workorders', d })),
            ...(f.shopDocs || []).filter(d => materialRefreshable(d, 'shop_custom_orders')).map(d => ({ coll: 'shop_custom_orders', d })),
            ...(f.workOrders || []).filter(d => materialRefreshable(d, 'hq_work_orders')).map(d => ({ coll: 'hq_work_orders', d })),
        ];
        const codes = materialCodesOf(targets.map(t => t.d));
        if (!targets.length || !codes.length) return setStock({ loading: false, items: [], error: '', at: Date.now(), docs: targets.length, holdersKnown: true });
        setStock(s => ({ ...s, loading: true, error: '' }));
        try {
            const locationId = (BRAND_NETSUITE_MAP[f.brand] || {}).location || '17';
            const [shelf, held] = await Promise.all([fetchShelfFigures(codes, locationId), fetchStockHolds(codes, locationId)]);
            if (!shelf.known) return setStock({ loading: false, items: [], error: 'NetSuite on hand / committed could not be read — try ↻ again.', at: Date.now(), docs: targets.length, holdersKnown: false });
            const soOfDoc = (d) => {
                const keys = [d.soAppId, d.salesOrderId, d.orderKey, d.soId].filter(Boolean).map(String);
                return keys.length ? ((f.orders || []).find(o => keys.includes(String(o.id)) || (o.soId && keys.includes(String(o.soId)))) || null) : null;
            };
            const items = stockToReallocateOf({ docs: targets, figures: shelf.map, holds: held.known ? held.map : null, refOf: f.refOf || ((d) => (d && (d.nsWoTran || d.id)) || ''), soOf: soOfDoc });
            setStock({ loading: false, items, error: '', at: Date.now(), docs: targets.length, holdersKnown: held.known });
        } catch (e) { setStock({ loading: false, items: [], error: `Stock could not be read (${e.message || e}).`, at: Date.now(), docs: targets.length, holdersKnown: false }); }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { readStock(); }, [brand]);
    const shift = (n) => { const { start } = dayBoundsOf(day); setDay(dayStrOf(start + n * 86400000 + 43200000)); };
    const c = sum.counts;
    const copy = async () => {
        const text = daySummaryText(sum, { day, brand, stock: stock.items });
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
                        <button style={btn(false)} onClick={() => printHtmlDocument(daySummaryHtml(sum, { day, brand, printedBy: userName, stock: stock.items }), { autoPrintDelay: 400 })} title="Prints the day — or saves it as a PDF to send">🖨 Print / PDF</button>
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

                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', margin: '26px 0 8px' }}>
                        <div style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', color: 'var(--ink)' }}>Stock to reallocate <span style={{ ...mono, fontSize: '9px', color: 'var(--ink-soft)' }}>every open order · as NetSuite reads now</span></div>
                        <button style={btn(false)} onClick={readStock} disabled={stock.loading} title="Reads NetSuite again: on hand, committed, and who each item is held for">{stock.loading ? 'Reading NetSuite…' : '↻ Read NetSuite'}</button>
                    </div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--ink-soft)', marginBottom: '8px', lineHeight: 1.45 }}>
                        Nothing here stops the floor — the picker pulls what is on the shelf. This is where to see, before a build, that stock an order needs is committed to another one, so it can be re-committed in NetSuite.
                    </div>
                    {stock.error
                        ? <div style={{ padding: '14px', background: '#fff', border: '1px solid #d9534f', color: '#d9534f' }}>{stock.error}</div>
                        : stock.loading
                            ? <div style={{ padding: '14px', background: '#fff', border: '1px dashed var(--line)', color: 'var(--ink-soft)', fontStyle: 'italic' }}>Reading NetSuite…</div>
                            : stock.items.length === 0
                                ? <div style={{ padding: '14px', background: '#fff', border: '1px dashed var(--line)', color: 'var(--ink-soft)', fontStyle: 'italic' }}>Every open order's parts are free for it — nothing to reallocate ({stock.docs} open document{stock.docs === 1 ? '' : 's'} read).</div>
                                : (
                                    <div style={{ background: '#fff', border: '1px solid var(--line)' }}>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(170px, 1.3fr) 80px 90px 80px 80px minmax(280px, 3fr)', gap: '10px', padding: '8px 14px', ...mono, fontSize: '9px', color: 'var(--ink-soft)', borderBottom: '1px solid var(--line)' }}>
                                            <div>Item</div><div>On hand</div><div>Committed</div><div>Wanted</div><div>Free</div><div>Orders that want it · who NetSuite holds it for</div>
                                        </div>
                                        {stock.items.map(it => {
                                            const tone = it.kind === REALLOCATE.SHORT ? '#d9534f' : '#8a6d1f';
                                            return (
                                                <div key={it.code} style={{ display: 'grid', gridTemplateColumns: 'minmax(170px, 1.3fr) 80px 90px 80px 80px minmax(280px, 3fr)', gap: '10px', padding: '10px 14px', borderBottom: '1px solid var(--line)', borderLeft: `4px solid ${tone}`, fontSize: '0.88rem', alignItems: 'start' }}>
                                                    <div>
                                                        <div style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}>{it.code}</div>
                                                        {it.name ? <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>{it.name}</div> : null}
                                                        <div style={{ ...mono, fontSize: '9px', fontWeight: 700, color: tone, marginTop: '4px' }}>{REALLOCATE_WORD[it.kind]}</div>
                                                    </div>
                                                    <div style={{ fontWeight: 700 }}>{it.onHand}</div>
                                                    <div>{it.committed}</div>
                                                    <div>{it.wanted}</div>
                                                    <div style={{ color: it.free < it.wanted ? tone : 'var(--ink)', fontWeight: 700 }}>{it.free}</div>
                                                    <div style={{ lineHeight: 1.5 }}>
                                                        {it.orders.map(o => <div key={o.id} style={{ color: o.state === 'OK' ? 'var(--ink-soft)' : 'var(--ink)' }}>{orderLine(o)}</div>)}
                                                        <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginTop: '4px' }}>NetSuite holds it for: {holdersText(it, 8)}</div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                    <div style={{ ...mono, fontSize: '9px', color: 'var(--ink-soft)', marginTop: '10px', textTransform: 'none', letterSpacing: 0 }}>
                        {stock.at ? `Read ${new Date(stock.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ` : ''}Counts every open document whose parts are not pulled yet, on any day — not only the day shown above. "Free" is on hand less what NetSuite holds for anyone other than the orders listed.{!stock.holdersKnown && !stock.error ? ' Who each item is held for could not be read this time, so every commitment is counted against the orders.' : ''}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DaySummaryPanel;
