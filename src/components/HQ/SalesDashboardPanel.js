// 📈 SALES DASHBOARD — HQ → System Admin, admins only (Stuart 2026-10-16: "now that we have added the credit card
// payments and sales counter we need to create a sales dashboard for me … this should be a new page reachable from tab
// 11 menu bar"; approving the plan: "go ahead and add 1-6 they are great ideas").
//
// Top: every open sales order, collapsed to customer · total · paid (the deposit) — click one for the order, what it is
// worth, what has been paid, and what is in stock vs to be made vs to be ordered. Below: the period's sales against a
// compare period (default: month to date vs the same dates last year), the pace chart, and KPIs 1–6.
//
// READS ONLY. Nothing here writes to RTG, a work order, a floor, the WMS or NetSuite. The figures are the app's own
// readings, called — never re-decided:
//   · the order list and its money ............ Shared/salesDashboard (the pay link's total, the CRM chip's paid)
//   · where an order stands ................... Shared/daySummary (RTG's own verdict and work list)
//   · a shelf line in stock / short / coming .. Shared/pickLines.soPackLineStateOf (the WMS SO Pack's word)
//   · what a floor document has on hand ....... Shared/MaterialGridCard (the floor card's own grid)
//   · the period's sales ...................... NetSuite (Shared/salesDashboard.periodSql) — the only book with last year
//   · open receivables ........................ Shared/nsInvoiceQuery.fetchOpenInvoices (11 → Integrations' own read)
// NetSuite is read when the page opens, when a range is run, and when an order is opened — never on a timer, and at
// most two reads at once (the proxy shares an account limit of about five).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../../firebase';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { nsProxyFetch } from '../Shared/nsProxy';
import { BRAND_NETSUITE_MAP } from '../Shared/brandNetsuite';
import { fetchOpenInvoices } from '../Shared/nsInvoiceQuery';
import { isOrderEntryOrder } from '../Shared/reopenQuote';
import { daySummaryOf, DOOR, VERDICT } from '../Shared/daySummary';
import { soPackLineStateOf, soLineCodeOf, soLineIsFee } from '../Shared/pickLines';
import { fetchAvailabilityUnits, fetchOrderCommitted, orderHeldOf } from '../Shared/oeReviewPlan';
import { woItemCodeOf } from '../Shared/workOrderContract';
import { isFeePart } from '../Shared/oeClassify';
import MaterialGridCard from '../Shared/MaterialGridCard';
import PaymentsWaitingNote from '../Shared/PaymentsWaitingNote';   // ⏳ card money NetSuite has not heard about for 24 h+ (Payments session, Stuart 2026-10-17)
import {
    ymdOf, rangeMsOf, presetRangeOf, lastYearOf, rangeLabelOf, isYmd, PRESET, PRESET_LABEL, orderRowsOf, bookOf, doorSplitOf,
    quotePipelineOf, cpqLinesOf, oeLinesOf, periodSql, transactionsOf, basisOf, periodFiguresOf, compareRowsOf, cumulativeOf,
    topCustomersOf, receivablesOf, subsidiariesOf, usd, pctText,
} from '../Shared/salesDashboard';

const SUITEQL = 'https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql';
const BRAND_LABEL = { ce: 'Classical Elements', m2c: 'M2C Studio', uniquity: 'Uniquity', leyla: 'Leyla Gans' };
const ALL = 'ALL';
const ALL_BRANDS = Object.keys(BRAND_NETSUITE_MAP);
const MAX_PAGES = 30;   // 30 × 1000 transactions per range — said on screen if ever reached, never a quiet half

const box = { background: '#fff', border: '1px solid var(--line)', padding: '20px', marginBottom: '20px' };
const h4 = { margin: '0 0 12px 0', fontFamily: 'var(--serif)', fontSize: '1.3rem', fontWeight: 500 };
const mono = { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-soft)' };
const btn = { padding: '9px 16px', background: 'var(--ink)', color: '#fff', border: '1px solid var(--ink)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', whiteSpace: 'nowrap' };
const btnLight = { ...btn, background: '#fff', color: 'var(--ink)', border: '1px solid var(--line)' };
const chip = (on) => ({ ...btnLight, padding: '7px 12px', ...(on ? { background: 'var(--ink)', color: '#fff', borderColor: 'var(--ink)' } : {}) });
const th = { padding: '8px 6px', borderBottom: '1px solid var(--line)', textAlign: 'left', ...mono, whiteSpace: 'nowrap' };
const td = { padding: '8px 6px', borderBottom: '1px solid var(--line)', fontSize: '0.88rem', verticalAlign: 'top' };
const num = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const dateInput = { padding: '7px 8px', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '0.85rem' };
const GREEN = '#2e7d32', AMBER = '#8a6d1f', RED = '#b02d20', SOFT = 'var(--ink-soft)';
const dayText = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const short$ = (v) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `$${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k` : `$${Math.round(v)}`);
const diffTone = (d) => (d == null || d === 0 ? SOFT : d > 0 ? GREEN : RED);

// ── NetSuite reads ─────────────────────────────────────────────────────────────────────────────────────────────────────
const nsError = (b, r) => String((b && b['o:errorDetails'] && b['o:errorDetails'][0] && b['o:errorDetails'][0].detail) || (b && b.title) || `HTTP ${r.status}`).slice(0, 300);
// Every page of a query, in order. A refusal throws (the caller says so) — it never reads as "no sales".
async function suiteqlAll(q) {
    const rows = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const r = await nsProxyFetch({ targetUrl: `${SUITEQL}?limit=1000&offset=${page * 1000}`, method: 'POST', payload: { q } });
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(`NetSuite refused the query: ${nsError(b, r)}`);
        rows.push(...(b.items || []));
        if (b.hasMore !== true) return { rows, capped: false };
    }
    return { rows, capped: true };
}
// One range: the merchandise read first; if NetSuite refuses the line-level query, the document totals instead.
async function readRange({ subsidiaries, from, to }) {
    try {
        const { rows, capped } = await suiteqlAll(periodSql({ subsidiaries, from, to, withLines: true }));
        return { txs: transactionsOf(rows, { withLines: true }), withLines: true, capped, lineError: '' };
    } catch (e) {
        const { rows, capped } = await suiteqlAll(periodSql({ subsidiaries, from, to, withLines: false }));
        return { txs: transactionsOf(rows, { withLines: false }), withLines: false, capped, lineError: e.message || String(e) };
    }
}

// ── THE ORDER'S SHELF LINES, AS THE SO PACK READS THEM ──────────────────────────────────────────────────────────────────
// The same four inputs PickPackApp.loadSoStats gathers for its cards — free stock and its unit (fetchAvailabilityUnits),
// what NetSuite holds for this order (fetchOrderCommitted), and what is being made or bought for it (its open work orders
// and its purchase-order lines still to arrive) — for ONE order, handed to the SO Pack's own soPackLineStateOf.
async function readShelfStats(so, brand) {
    const lines = Array.isArray(so.lines) ? so.lines : [];
    const erps = [...new Set(lines.map(l => String((l && l.erp) || '').trim().toUpperCase()).filter(Boolean))];
    // Which of those codes are FEE records in the library (tab 7 stores a fee with no flag — Shared/pickLines.soLineIsFee).
    const parts = {};
    for (let i = 0; i < erps.length; i += 30) {
        const s = await getDocs(query(collection(db, 'Approved_Designs'), where('legacyErpId', 'in', erps.slice(i, i + 30)))).catch(() => null);
        if (s) s.docs.forEach(d => { const p = d.data(); parts[String(p.legacyErpId || '').toUpperCase()] = p; });
    }
    const isFeeCode = (code) => isFeePart(parts[String(code || '').toUpperCase()]);
    const codes = [...new Set(lines.filter((l, i) => !soLineIsFee(so, l, i, isFeeCode)).map(l => soLineCodeOf(l)).filter(Boolean))];
    const loc = (BRAND_NETSUITE_MAP[brand] || {}).location || '17';
    let avail = {}, held = {}, error = '';
    if (codes.length) {
        try { avail = (await fetchAvailabilityUnits(codes, loc)).map || {}; }
        catch (e) { error = `NetSuite stock could not be read (${e.message || e})`; }
        if (so.nsInternalId) {
            try { held = await fetchOrderCommitted([String(so.nsInternalId)], codes); }
            catch (e) { error = error || `what NetSuite holds for this order could not be read — free stock only (${e.message || e})`; }
        }
    }
    const prod = {};
    try {
        const ws = await getDocs(query(collection(db, 'hq_work_orders'), where('soAppId', '==', so.id)));
        ws.docs.map(d => ({ id: d.id, ...d.data() }))
            .filter(w => !w.deleted && !['Closed', 'Deleted', 'CANCELLED'].includes(String(w.status || '')))
            .filter(w => w.floorPhase !== 'Complete' && !['Completed', 'Built'].includes(String(w.status || '')))
            .forEach(w => { const c = woItemCodeOf(w); if (c) prod[c] = (prod[c] || 0) + (Number(w.qty ?? w.totalParts) || 0); });
    } catch (e) { /* additive detail — the line still shows ordered / in stock */ }
    try {
        const ps = await getDocs(query(collection(db, 'hq_purchase_orders'), where('soAppIds', 'array-contains', so.id)));
        ps.docs.map(d => d.data()).filter(p => !p.deleted).forEach(p => (p.items || []).filter(it => String(it.soAppId || '') === String(so.id)).forEach(it => {
            const c = String(it.itemId || '').trim().toUpperCase();
            const left = Math.max(0, (Number(it.quantity) || 0) - (Number(it.received) || 0));
            if (c && left > 0) prod[c] = (prod[c] || 0) + left;
        }));
    } catch (e) { /* same */ }
    const statOf = (c) => { const a = avail[c] || null; return { avail: a ? Number(a.available) || 0 : null, held: orderHeldOf(held, so.nsInternalId, c), unit: a ? a.unit : null, prod: prod[c] || 0 }; };
    const rows = lines.map((l, idx) => ({ l, idx })).filter(x => x.l && !soLineIsFee(so, x.l, x.idx, isFeeCode) && soLineCodeOf(x.l))
        .map(x => ({ idx: x.idx, line: x.l, name: String(x.l.name || ''), ...soPackLineStateOf({ so, line: x.l, idx: x.idx, stat: statOf(soLineCodeOf(x.l)), isFeeCode }) }));
    return { rows, error };
}

// The SO Pack's words, as the owner reads them.
const SHELF_WORD = {
    GATHERED: ['In the order bin', GREEN], READY: ['In stock', GREEN], 'IN PRODUCTION': ['Coming — being made or on order', AMBER],
    SHORT: ['Short — to order', RED], UNKNOWN: ['Stock not read', SOFT], 'NOT RELEASED': ['Not released yet', SOFT],
};
const VERDICT_TONE = {
    [VERDICT.NETSUITE]: RED, [VERDICT.REVIEW]: AMBER, [VERDICT.HOLD]: RED, [VERDICT.NOT_STARTED]: RED, [VERDICT.PARKED]: AMBER,
    [VERDICT.FLOOR]: GREEN, [VERDICT.STOCK]: SOFT, [VERDICT.DONE]: SOFT, [VERDICT.CLOSED]: SOFT,
};

// ── THE POPUP ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function OrderPopup({ row, loadWork, onClose }) {
    const so = row.so;
    const [work, setWork] = useState({ loading: true, error: '', summary: null, docs: [] });
    const [shelf, setShelf] = useState({ loading: !!(row.orderEntry && (so.lines || []).length), rows: [], error: '' });

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    useEffect(() => {
        let live = true;
        (async () => {
            try {
                const feeds = await loadWork(row.brand);
                const sum = daySummaryOf({ orders: [so], ...feeds, start: 0, end: Number.MAX_SAFE_INTEGER, isOrderEntry: () => row.orderEntry });
                const r0 = sum.rows[0] || null;
                const ids = new Set(((r0 && r0.work) || []).map(w => w.id));
                const docs = [...feeds.finDocs, ...feeds.shopDocs, ...feeds.workOrders].filter(d => ids.has(d.id) && Array.isArray(d.materialRows) && d.materialRows.length);
                const seen = new Set();
                const uniq = docs.filter(d => { const k = `${d.id}`; if (seen.has(k)) return false; seen.add(k); return true; });
                if (live) setWork({ loading: false, error: '', summary: r0, docs: uniq });
            } catch (e) { if (live) setWork({ loading: false, error: e.message || String(e), summary: null, docs: [] }); }
        })();
        if (row.orderEntry && (so.lines || []).length) {
            (async () => {
                try { const res = await readShelfStats(so, row.brand); if (live) setShelf({ loading: false, ...res }); }
                catch (e) { if (live) setShelf({ loading: false, rows: [], error: e.message || String(e) }); }
            })();
        }
        return () => { live = false; };
    }, [row, so, loadWork]);

    const lines = row.orderEntry ? oeLinesOf(so) : cpqLinesOf(row.job);
    const shelfRows = shelf.rows.filter(r => !r.fromFloor);
    const floorRows = shelf.rows.filter(r => r.fromFloor);
    const inStock = shelfRows.filter(r => r.state === 'READY' || r.state === 'GATHERED');
    const sum = work.summary;
    const placeholders = (so.lines || []).filter(l => l && l.placeholder).length;
    const notReleased = !row.orderEntry && String(so.status || '') === 'Approved' && !(sum && sum.work && sum.work.length);
    const sec = { marginTop: '22px' };

    return (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 10500, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '28px 16px', overflowY: 'auto' }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--paper, #faf9f6)', width: 'min(980px, 98vw)', border: '1px solid var(--line)', boxShadow: '0 16px 60px rgba(0,0,0,0.3)' }}>
                <div style={{ background: '#fff', borderBottom: '1px solid var(--line)', padding: '18px 22px', display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'flex-start' }}>
                    <div>
                        <div style={mono}>{row.ref} · {row.door}{row.brand ? ` · ${BRAND_LABEL[row.brand] || row.brand}` : ''}</div>
                        <div style={{ fontFamily: 'var(--serif)', fontSize: '1.7rem', color: 'var(--ink)', lineHeight: 1.2 }}>{row.customer}</div>
                        <div style={{ fontSize: '0.85rem', color: SOFT, marginTop: '4px' }}>
                            Entered {dayText(row.enteredAt)}{row.enteredBy ? ` by ${row.enteredBy}` : ''}
                            {so.customerPo || so.poNumber ? ` · PO ${so.customerPo || so.poNumber}` : ''}
                            {so.orderSidemark || so.sidemark ? ` · ${so.orderSidemark || so.sidemark}` : ''}
                            {so.jobName ? ` · ${so.jobName}` : ''}
                        </div>
                        {sum && <div style={{ marginTop: '8px', ...mono, color: VERDICT_TONE[sum.verdict] || SOFT, fontSize: '11px' }}>● {sum.verdict}{sum.netsuite ? ` · NetSuite: ${sum.netsuite}` : ''}</div>}
                    </div>
                    <button style={btn} onClick={onClose}>Close</button>
                </div>

                <div style={{ padding: '18px 22px 24px' }}>
                    {/* MONEY */}
                    <div style={{ display: 'flex', gap: '28px', flexWrap: 'wrap', background: '#fff', border: '1px solid var(--line)', padding: '14px 18px' }}>
                        {[
                            ['Order total', row.known ? usd(row.total) : '—', row.known && row.shipping ? `incl. ${usd(row.shipping)} shipping` : (row.known ? '' : 'its quote record could not be found')],
                            ['Paid', usd(row.paid), row.lastPaymentAt ? `last payment ${dayText(row.lastPaymentAt)}` : (row.paid > 0 ? '' : 'no deposit yet')],
                            ['Balance', row.known ? usd(row.balance) : '—', ''],
                        ].map(([label, value, note]) => (
                            <div key={label}>
                                <div style={mono}>{label}</div>
                                <div style={{ fontFamily: 'var(--serif)', fontSize: '1.6rem', color: label === 'Paid' && row.paid > 0 ? GREEN : 'var(--ink)' }}>{value}</div>
                                {note && <div style={{ fontSize: '0.78rem', color: SOFT }}>{note}</div>}
                            </div>
                        ))}
                    </div>
                    {row.quoteDeposits.length > 0 && (
                        <div style={{ marginTop: '10px', padding: '10px 14px', border: `1px solid ${AMBER}`, background: '#fbf7ec', fontSize: '0.86rem', color: 'var(--ink)' }}>
                            {row.quoteDeposits.map(q => <div key={q.id}>💳 A deposit of <strong>{usd(q.paid)}</strong> was paid on quote <strong>{q.no}</strong>{q.at ? ` (${dayText(q.at)})` : ''} before it became this order.</div>)}
                            <div style={{ color: SOFT, marginTop: '4px', fontSize: '0.8rem' }}>Not counted in Paid above — a deposit taken on a quote stays on the quote today. The Payments session is carrying it across to the order.</div>
                        </div>
                    )}

                    {/* WHAT WAS ORDERED */}
                    <div style={sec}>
                        <div style={{ ...h4, fontSize: '1.15rem' }}>What was ordered</div>
                        {lines.length === 0 ? <div style={{ color: SOFT, fontStyle: 'italic' }}>No lines on record for this order.</div> : (
                            <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', border: '1px solid var(--line)' }}>
                                <thead><tr><th style={th}>Item</th><th style={{ ...th, ...num }}>Qty</th><th style={{ ...th, ...num }}>Each</th><th style={{ ...th, ...num }}>Total</th></tr></thead>
                                <tbody>
                                    {lines.map((l, i) => (
                                        <tr key={i}>
                                            <td style={td}><div>{l.name}</div>{l.note && <div style={{ fontSize: '0.78rem', color: SOFT }}>{l.note}</div>}</td>
                                            <td style={{ ...td, ...num }}>{l.qty}</td>
                                            <td style={{ ...td, ...num }}>{l.each == null ? '—' : usd(l.each)}</td>
                                            <td style={{ ...td, ...num }}>{l.total == null ? '—' : usd(l.total)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>

                    {/* STOCK VS MADE VS ORDERED */}
                    <div style={sec}>
                        <div style={{ ...h4, fontSize: '1.15rem' }}>In stock · to make · to order</div>
                        {placeholders > 0 && <div style={{ color: RED, fontSize: '0.86rem', marginBottom: '8px' }}>✚ {placeholders} quick-add item{placeholders === 1 ? '' : 's'} still to identify — the order waits until {placeholders === 1 ? 'it is' : 'they are'} (RTG or the CRM).</div>}
                        {notReleased && <div style={{ color: SOFT, fontSize: '0.86rem', marginBottom: '8px' }}>RTG has not released this order yet — it decides what is picked from stock and what is made when it releases it.</div>}

                        {row.orderEntry && (
                            <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '12px 14px', marginBottom: '10px' }}>
                                <div style={{ ...mono, marginBottom: '6px' }}>From the shelf · NetSuite now{shelfRows.length ? ` · ${inStock.length} of ${shelfRows.length} in stock` : ''}</div>
                                {shelf.loading ? <div style={{ color: SOFT, fontStyle: 'italic' }}>Reading NetSuite…</div>
                                    : shelfRows.length === 0 ? <div style={{ color: SOFT, fontStyle: 'italic' }}>Nothing on this order is picked from the shelf.</div> : (
                                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                            <thead><tr><th style={th}>Item</th><th style={{ ...th, ...num }}>Need</th><th style={{ ...th, ...num }}>Held for this order</th><th style={{ ...th, ...num }}>Free</th><th style={{ ...th, ...num }}>Coming</th><th style={th}>&nbsp;</th></tr></thead>
                                            <tbody>
                                                {shelfRows.map(r => { const [word, tone] = SHELF_WORD[r.state] || [r.state, SOFT]; return (
                                                    <tr key={r.idx}>
                                                        <td style={td}><div style={{ fontFamily: 'var(--mono)', fontSize: '0.82rem' }}>{r.code}</div>{r.name && <div style={{ fontSize: '0.78rem', color: SOFT }}>{r.name}</div>}</td>
                                                        <td style={{ ...td, ...num }}>{r.need}</td>
                                                        <td style={{ ...td, ...num }}>{Math.max(Number(r.held) || 0, Number(r.committed) || 0) || '—'}</td>
                                                        <td style={{ ...td, ...num }}>{r.avail == null ? '—' : Math.max(0, r.avail - (Number(r.held) || 0))}</td>
                                                        <td style={{ ...td, ...num }}>{r.prod || '—'}</td>
                                                        <td style={{ ...td, color: tone, fontWeight: 600, whiteSpace: 'nowrap' }}>{word}</td>
                                                    </tr>
                                                ); })}
                                            </tbody>
                                        </table>
                                    )}
                                {shelf.error && <div style={{ color: RED, fontSize: '0.8rem', marginTop: '6px' }}>⚠ {shelf.error}</div>}
                            </div>
                        )}

                        <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '12px 14px', marginBottom: '10px' }}>
                            <div style={{ ...mono, marginBottom: '6px' }}>Made to order · the floors</div>
                            {floorRows.length > 0 && (
                                <div style={{ marginBottom: '8px', fontSize: '0.86rem' }}>
                                    {floorRows.map(r => <div key={r.idx}>• {r.code}{r.name ? ` — ${r.name}` : ''} · {r.need} · <span style={{ color: r.state === 'GATHERED' ? GREEN : AMBER }}>{r.state === 'GATHERED' ? 'made — in the order bin' : 'comes from the floor'}</span></div>)}
                                </div>
                            )}
                            {work.loading ? <div style={{ color: SOFT, fontStyle: 'italic' }}>Reading RTG…</div>
                                : work.error ? <div style={{ color: RED, fontSize: '0.85rem' }}>⚠ RTG's records could not be read ({work.error}).</div>
                                    : !(sum && sum.work.length) ? <div style={{ color: SOFT, fontStyle: 'italic' }}>No work order on the floors for this order{sum && sum.unstarted && sum.unstarted.length ? ` — ${sum.unstarted.length} line${sum.unstarted.length === 1 ? '' : 's'} to be finished not started yet` : ''}.</div> : (
                                        <div>
                                            {sum.work.map(w => (
                                                <div key={w.id} style={{ fontSize: '0.86rem', padding: '4px 0', borderBottom: '1px dashed var(--line)' }}>
                                                    <span style={{ fontFamily: 'var(--mono)' }}>{w.ref}</span> · {w.side === 'SHOP' ? 'Shop' : 'Finishing'}{w.finish ? ` · ${w.finish}` : ''} · <span style={{ color: w.held ? RED : w.state === 'FLOOR' ? GREEN : w.state === 'PARKED' ? AMBER : SOFT }}>{w.text}</span>
                                                </div>
                                            ))}
                                            {sum.unstarted && sum.unstarted.length > 0 && <div style={{ fontSize: '0.84rem', color: AMBER, marginTop: '6px' }}>{sum.unstarted.length} line{sum.unstarted.length === 1 ? '' : 's'} to be finished not started yet.</div>}
                                            {work.docs.map(d => <MaterialGridCard key={d.id} doc={d} title={`Material · ${d.nsWoTran || d.woDisplayId || d.id}`} style={{ marginTop: '10px' }} />)}
                                        </div>
                                    )}
                        </div>

                        <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '12px 14px' }}>
                            <div style={{ ...mono, marginBottom: '6px' }}>To order · true backorders recorded on the order</div>
                            {row.backorders.length === 0 ? <div style={{ color: SOFT, fontStyle: 'italic' }}>None recorded.</div> : row.backorders.map(b => (
                                <div key={b.code} style={{ fontSize: '0.86rem' }}>• <span style={{ fontFamily: 'var(--mono)' }}>{b.code}</span>{b.name ? ` — ${b.name}` : ''} · <strong style={{ color: RED }}>{b.qty} short</strong>{b.onOrder ? ` · ${b.onOrder} on order` : ' · nothing on order yet'}</div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── THE PACE CHART ─────────────────────────────────────────────────────────────────────────────────────────────────────
function PaceChart({ a, b, metric, labelA, labelB }) {
    const sa = cumulativeOf(a, metric), sb = cumulativeOf(b, metric);
    const n = Math.max(sa.length, sb.length, 1);
    const max = Math.max(1, ...sa.map(p => p.value), ...sb.map(p => p.value));
    const W = 720, H = 230, L = 58, R = 14, T = 14, B = 30;
    const x = (i) => L + (n === 1 ? 0 : (i / (n - 1)) * (W - L - R));
    const y = (v) => T + (1 - v / max) * (H - T - B);
    const path = (s) => s.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    const ticks = [0, 0.5, 1].map(f => f * max);
    return (
        <div>
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label={`Running total, ${labelA} against ${labelB}`}>
                {ticks.map(t => (
                    <g key={t}>
                        <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
                        <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--ink-soft)" fontFamily="var(--mono)">{short$(t)}</text>
                    </g>
                ))}
                {[0, Math.floor((n - 1) / 2), n - 1].filter((v, i, arr) => arr.indexOf(v) === i).map(i => (
                    <text key={i} x={x(i)} y={H - 10} textAnchor="middle" fontSize="11" fill="var(--ink-soft)" fontFamily="var(--mono)">day {i + 1}</text>
                ))}
                {sb.length > 0 && <path d={path(sb)} fill="none" stroke="#9a9488" strokeWidth="2" strokeDasharray="5 4" />}
                {sa.length > 0 && <path d={path(sa)} fill="none" stroke="var(--ink)" strokeWidth="2.5" />}
                {sa.length > 0 && <circle cx={x(sa.length - 1)} cy={y(sa[sa.length - 1].value)} r="4" fill="var(--ink)" />}
            </svg>
            <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', fontSize: '0.8rem', color: SOFT, marginTop: '4px' }}>
                <span><span style={{ display: 'inline-block', width: '18px', borderTop: '2.5px solid var(--ink)', verticalAlign: 'middle', marginRight: '6px' }} />{labelA}{sa.length ? ` · ${usd(sa[sa.length - 1].value, { cents: false })}` : ''}</span>
                <span><span style={{ display: 'inline-block', width: '18px', borderTop: '2px dashed #9a9488', verticalAlign: 'middle', marginRight: '6px' }} />{labelB}{sb.length ? ` · ${usd(sb[sb.length - 1].value, { cents: false })}` : ''}</span>
            </div>
        </div>
    );
}

const Tile = ({ label, value, note, tone }) => (
    <div style={{ minWidth: '150px', flex: '1 1 150px' }}>
        <div style={mono}>{label}</div>
        <div style={{ fontFamily: 'var(--serif)', fontSize: '1.65rem', color: tone || 'var(--ink)', lineHeight: 1.15 }}>{value}</div>
        {note && <div style={{ fontSize: '0.78rem', color: SOFT }}>{note}</div>}
    </div>
);

// ── THE PAGE ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export default function SalesDashboardPanel({ activeBrand }) {
    const [scope, setScope] = useState(BRAND_NETSUITE_MAP[activeBrand] ? activeBrand : 'ce');
    const brands = useMemo(() => (scope === ALL ? ALL_BRANDS : [scope]), [scope]);
    const [app, setApp] = useState({ loading: true, error: '', orders: [], jobs: [], at: 0 });
    const [listMode, setListMode] = useState('OPEN');
    const [openId, setOpenId] = useState('');
    const initialA = useMemo(() => presetRangeOf(PRESET.MTD), []);
    const [draftA, setDraftA] = useState(initialA);
    const [draftB, setDraftB] = useState(() => lastYearOf(initialA));
    const [ranges, setRanges] = useState(() => ({ a: initialA, b: lastYearOf(initialA) }));
    const [metric, setMetric] = useState('booked');
    const [ns, setNs] = useState({ loading: true, error: '', a: null, b: null, basis: 'MERCH', lineError: '', capped: false, at: 0 });
    const [ar, setAr] = useState({ loading: true, error: '', data: null, partial: false });
    const [reload, setReload] = useState(0);
    const workCache = useRef({});

    // The app's books: the sales orders and the quotes of each division in scope.
    useEffect(() => {
        let live = true;
        setApp(a => ({ ...a, loading: true, error: '' }));
        (async () => {
            try {
                const parts = await Promise.all(brands.map(async (b) => {
                    const [so, jobs] = await Promise.all([
                        getDocs(query(collection(db, 'hq_sales_orders'), where('brand', '==', b))),
                        getDocs(query(collection(db, 'jobs'), where('brandId', '==', b))),
                    ]);
                    return { orders: so.docs.map(d => ({ id: d.id, ...d.data() })), jobs: jobs.docs.map(d => ({ id: d.id, ...d.data() })) };
                }));
                const orders = parts.flatMap(p => p.orders);
                const jobs = parts.flatMap(p => p.jobs);
                // An open order's quote record that the division query missed (an older record without brandId) is read by
                // its id — a CPQ order's money lives on it, and a missing one would read as "no total".
                const known = new Set(jobs.flatMap(j => [j.id, j.jobId].filter(Boolean).map(String)));
                const missing = [...new Set(orders.filter(o => o && !o.deleted && o.hqJobId && !known.has(String(o.hqJobId)) && !['Shipped', 'Closed', 'CANCELLED', 'Cancelled', 'Deleted'].includes(String(o.status || ''))).map(o => String(o.hqJobId)))];
                const extra = (await Promise.all(missing.slice(0, 200).map(id => getDoc(doc(db, 'jobs', id)).catch(() => null))))
                    .filter(s => s && s.exists()).map(s => ({ id: s.id, ...s.data() }));
                if (live) setApp({ loading: false, error: '', orders, jobs: [...jobs, ...extra], at: Date.now() });
            } catch (e) { if (live) setApp({ loading: false, error: e.message || String(e), orders: [], jobs: [], at: Date.now() }); }
        })();
        return () => { live = false; };
    }, [brands, reload]);

    // NetSuite: the two ranges, side by side.
    useEffect(() => {
        let live = true;
        const subsidiaries = subsidiariesOf(brands, BRAND_NETSUITE_MAP);
        setNs(s => ({ ...s, loading: true, error: '' }));
        (async () => {
            try {
                const [ra, rb] = await Promise.all([readRange({ subsidiaries, ...ranges.a }), readRange({ subsidiaries, ...ranges.b })]);
                const withLines = ra.withLines && rb.withLines;
                const basis = basisOf([...ra.txs, ...rb.txs], { withLines }) === 'MERCH' ? 'MERCH' : 'GROSS';
                if (live) setNs({
                    loading: false, error: '', basis, lineError: ra.lineError || rb.lineError, capped: ra.capped || rb.capped, at: Date.now(),
                    a: periodFiguresOf(ra.txs, { ...ranges.a, basis }), b: periodFiguresOf(rb.txs, { ...ranges.b, basis }),
                });
            } catch (e) { if (live) setNs({ loading: false, error: e.message || String(e), a: null, b: null, basis: 'MERCH', lineError: '', capped: false, at: Date.now() }); }
        })();
        return () => { live = false; };
    }, [brands, ranges, reload]);

    // NetSuite: what customers still owe, division by division (Shared/nsInvoiceQuery — 11 → Integrations' own read).
    useEffect(() => {
        let live = true;
        setAr(s => ({ ...s, loading: true, error: '' }));
        (async () => {
            try {
                const all = [];
                let partial = false;
                for (const b of brands) {
                    for (let page = 0; page < 10; page += 1) {
                        const res = await fetchOpenInvoices({ brand: b, limit: 1000, offset: page * 1000 });
                        all.push(...res.invoices);
                        if (!res.hasMore) break;
                        if (page === 9) partial = true;
                    }
                }
                if (live) setAr({ loading: false, error: '', data: receivablesOf(all, ymdOf()), partial });
            } catch (e) { if (live) setAr({ loading: false, error: e.message || String(e), data: null, partial: false }); }
        })();
        return () => { live = false; };
    }, [brands, reload]);

    // RTG's records for the popup, read once per division the first time an order of it is opened.
    const loadWork = useCallback(async (brand) => {
        const b = brand || scope;
        if (!workCache.current[b]) {
            workCache.current[b] = (async () => {
                const read = async (coll) => (await getDocs(query(collection(db, coll), where('brand', '==', b)))).docs.map(d => ({ id: d.id, ...d.data() })).filter(d => !d.deleted);
                const [workOrders, finDocs, shopDocs] = await Promise.all([read('hq_work_orders'), read('fin_workorders'), read('shop_custom_orders')]);
                return { workOrders, finDocs, shopDocs };
            })().catch(e => { delete workCache.current[b]; throw e; });
        }
        return workCache.current[b];
    }, [scope]);

    const refresh = () => { workCache.current = {}; setReload(n => n + 1); };
    const runRanges = (a, b) => {
        if (!isYmd(a.from) || !isYmd(a.to) || !isYmd(b.from) || !isYmd(b.to)) { window.alert('Each range needs a from and a to date.'); return; }
        if (a.from > a.to || b.from > b.to) { window.alert('A range\'s from date must come before its to date.'); return; }
        setDraftA(a); setDraftB(b); setRanges({ a, b });
    };
    const preset = (p) => { const a = presetRangeOf(p); runRanges(a, lastYearOf(a)); };

    const rows = useMemo(() => orderRowsOf({ orders: app.orders, jobs: app.jobs, isOrderEntry: isOrderEntryOrder }), [app.orders, app.jobs]);
    const openRows = useMemo(() => rows.filter(r => r.open), [rows]);
    const msA = useMemo(() => rangeMsOf(ranges.a), [ranges.a]);
    const listRows = listMode === 'OPEN' ? openRows : rows.filter(r => r.enteredAt >= msA.start && r.enteredAt < msA.end);
    const book = useMemo(() => bookOf(openRows), [openRows]);
    const listBook = useMemo(() => bookOf(listRows), [listRows]);
    const doors = useMemo(() => ({ a: doorSplitOf(rows, msA), b: doorSplitOf(rows, rangeMsOf(ranges.b)) }), [rows, msA, ranges.b]);
    const pipe = useMemo(() => quotePipelineOf({ jobs: app.jobs, ...msA }), [app.jobs, msA]);
    const compare = useMemo(() => (ns.a && ns.b ? compareRowsOf(ns.a, ns.b) : []), [ns.a, ns.b]);
    const top = useMemo(() => (ns.a ? topCustomersOf(ns.a, ns.b, 10) : []), [ns.a, ns.b]);
    const openRow = openId ? rows.find(r => r.id === openId) || null : null;
    const labelA = rangeLabelOf(ranges.a), labelB = rangeLabelOf(ranges.b);
    const showBrand = scope === ALL;

    return (
        <div style={{ padding: '30px 40px' }}>
            <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: '15px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div>
                    <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500 }}>Sales Dashboard</h3>
                    <p style={{ margin: '8px 0 0 0', fontSize: '0.9rem', color: SOFT, maxWidth: '760px' }}>
                        Open orders from every door — CPQ, Order Entry and the show counter — with what each is worth and what has been paid. Below, the period's sales from NetSuite against a compare period. Read only; admins only.
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                    {ALL_BRANDS.map(b => <button key={b} style={chip(scope === b)} onClick={() => setScope(b)}>{BRAND_LABEL[b] || b}</button>)}
                    <button style={chip(scope === ALL)} onClick={() => setScope(ALL)}>All divisions</button>
                    <button style={btnLight} onClick={refresh} title="Read the orders and NetSuite again">↻ Refresh</button>
                </div>
            </div>

            {/* MONEY OUT OF THE BOOKS FIRST (Stuart 2026-10-17: "have it keep popping up on end of day summary and sales
                dashboard"): renders nothing unless a card payment has waited over 24 hours for NetSuite — every division. */}
            <PaymentsWaitingNote compact />

            {/* KPI 1 + 6 — THE OPEN ORDER BOOK */}
            <div style={{ ...box, display: 'flex', gap: '22px', flexWrap: 'wrap' }}>
                <Tile label="Open orders" value={app.loading ? '…' : book.count} note={book.unknown ? `${book.unknown} with no total on record` : ''} />
                <Tile label="Order value" value={app.loading ? '…' : usd(book.total, { cents: false })} />
                <Tile label="Deposits paid" value={app.loading ? '…' : usd(book.paid, { cents: false })} tone={book.paid > 0 ? GREEN : undefined} note={book.quoteDeposits > 0 ? `+ ${usd(book.quoteDeposits, { cents: false })} still sitting on quotes` : ''} />
                <Tile label="Balance to collect" value={app.loading ? '…' : usd(book.balance, { cents: false })} />
                <Tile label="No deposit yet" value={app.loading ? '…' : book.noDeposit} tone={book.noDeposit ? AMBER : undefined} note={book.noDeposit ? `${usd(book.noDepositValue, { cents: false })} of orders` : ''} />
                <Tile label="Waiting on backorders" value={app.loading ? '…' : book.onBackorder} tone={book.onBackorder ? RED : undefined} note={book.onBackorder ? `${book.backorderLines} line${book.backorderLines === 1 ? '' : 's'} short` : ''} />
            </div>

            {/* THE ORDERS, COLLAPSED */}
            <div style={box}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '10px' }}>
                    <div style={{ ...h4, margin: 0 }}>{listMode === 'OPEN' ? 'Open orders' : `Orders entered ${labelA}`}</div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                        <button style={chip(listMode === 'OPEN')} onClick={() => setListMode('OPEN')}>Open</button>
                        <button style={chip(listMode === 'PERIOD')} onClick={() => setListMode('PERIOD')}>Entered {labelA}</button>
                    </div>
                </div>
                {app.error && <div style={{ color: RED, marginBottom: '8px' }}>⚠ The orders could not be read ({app.error}).</div>}
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 120px 120px 120px', gap: '10px', padding: '0 12px 6px', ...mono }}>
                    <span>Customer</span><span style={num}>Order total</span><span style={num}>Paid</span><span style={num}>Balance</span>
                </div>
                <div style={{ maxHeight: '520px', overflowY: 'auto', borderTop: '1px solid var(--line)' }}>
                    {app.loading ? <div style={{ padding: '18px', color: SOFT, fontStyle: 'italic' }}>Reading the orders…</div>
                        : listRows.length === 0 ? <div style={{ padding: '18px', color: SOFT, fontStyle: 'italic' }}>{listMode === 'OPEN' ? 'No open orders.' : 'No order was entered in this period.'}</div>
                            : listRows.map(r => (
                                <div key={r.id} role="button" tabIndex={0} onClick={() => setOpenId(r.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(r.id); } }}
                                    style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 120px 120px 120px', gap: '10px', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid var(--line)', cursor: 'pointer', background: '#fff' }}
                                    onMouseOver={e => { e.currentTarget.style.background = 'var(--paper-2, #f2efe8)'; }} onMouseOut={e => { e.currentTarget.style.background = '#fff'; }}>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.customer}</div>
                                        <div style={{ fontSize: '0.75rem', color: SOFT, fontFamily: 'var(--mono)' }}>{r.ref} · {dayText(r.enteredAt)} · {r.door === DOOR.OE ? 'Order Entry' : r.door}{showBrand ? ` · ${BRAND_LABEL[r.brand] || r.brand}` : ''}{!r.open ? ' · closed' : ''}</div>
                                    </div>
                                    <div style={{ ...num, fontSize: '0.95rem' }}>{r.known ? usd(r.total) : '—'}</div>
                                    <div style={{ ...num, fontSize: '0.95rem', color: r.paid > 0 ? GREEN : SOFT }}>{r.paid > 0 ? usd(r.paid) : '—'}</div>
                                    <div style={{ ...num, fontSize: '0.8rem', color: SOFT }}>{r.known ? usd(r.balance) : '—'}</div>
                                </div>
                            ))}
                </div>
                {!app.loading && listRows.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 120px 120px 120px', gap: '10px', padding: '10px 12px 0', fontWeight: 600 }}>
                        <span style={mono}>{listBook.count} order{listBook.count === 1 ? '' : 's'}</span>
                        <span style={num}>{usd(listBook.total)}</span><span style={{ ...num, color: GREEN }}>{usd(listBook.paid)}</span><span style={{ ...num, color: SOFT }}>{usd(listBook.balance)}</span>
                    </div>
                )}
            </div>

            {/* THE PERIOD'S SALES */}
            <div style={box}>
                <div style={{ ...h4 }}>Sales · {labelA} <span style={{ color: SOFT, fontSize: '1rem' }}>vs {labelB}</span></div>
                <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '14px' }}>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {Object.values(PRESET).map(p => <button key={p} style={btnLight} onClick={() => preset(p)} title={`${PRESET_LABEL[p]}, against the same dates last year`}>{PRESET_LABEL[p]}</button>)}
                    </div>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={mono}>This period</span>
                        <span style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                            <input type="date" value={draftA.from} onChange={e => setDraftA(d => ({ ...d, from: e.target.value }))} style={dateInput} />–
                            <input type="date" value={draftA.to} onChange={e => setDraftA(d => ({ ...d, to: e.target.value }))} style={dateInput} />
                        </span>
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={mono}>Compare with</span>
                        <span style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                            <input type="date" value={draftB.from} onChange={e => setDraftB(d => ({ ...d, from: e.target.value }))} style={dateInput} />–
                            <input type="date" value={draftB.to} onChange={e => setDraftB(d => ({ ...d, to: e.target.value }))} style={dateInput} />
                        </span>
                    </label>
                    <button style={btnLight} onClick={() => setDraftB(lastYearOf(draftA))} title="Set the compare range to the same dates one year earlier">Same dates last year</button>
                    <button style={btn} onClick={() => runRanges(draftA, draftB)}>Run</button>
                </div>
                {ns.error && <div style={{ color: RED, marginBottom: '10px' }}>⚠ NetSuite could not be read — no figures are shown rather than wrong ones. ({ns.error})</div>}
                {ns.capped && <div style={{ color: RED, marginBottom: '10px' }}>⚠ A range holds more than {MAX_PAGES * 1000} NetSuite transactions — only the first {MAX_PAGES * 1000} are counted. Narrow the range.</div>}
                <div style={{ ...mono, textTransform: 'none', letterSpacing: 0, fontSize: '11px', marginBottom: '10px' }}>
                    {ns.loading ? 'Reading NetSuite…' : ns.basis === 'MERCH'
                        ? 'From NetSuite. Booked and Invoiced are merchandise — before tax and shipping. Cash in is what was received.'
                        : `From NetSuite. Booked and Invoiced are document totals — incl. tax & shipping${ns.lineError ? ' (NetSuite refused the merchandise-only read)' : ''}.`}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
                    <div>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead><tr><th style={th}>&nbsp;</th><th style={{ ...th, ...num }}>This period</th><th style={{ ...th, ...num }}>Compare</th><th style={{ ...th, ...num }}>Change</th></tr></thead>
                            <tbody>
                                {(ns.loading ? [] : compare).map(c => (
                                    <tr key={c.key}>
                                        <td style={td}>{c.label}</td>
                                        <td style={{ ...td, ...num, fontWeight: 600 }}>{c.money ? usd(c.a, { cents: false }) : c.a}</td>
                                        <td style={{ ...td, ...num, color: SOFT }}>{c.money ? usd(c.b, { cents: false }) : c.b}</td>
                                        <td style={{ ...td, ...num, color: diffTone(c.diff) }}>{c.diff == null ? '—' : `${c.money ? usd(c.diff, { cents: false }) : (c.diff > 0 ? `+${c.diff}` : c.diff)} · ${pctText(c.pct)}`}</td>
                                    </tr>
                                ))}
                                {ns.loading && <tr><td style={{ ...td, color: SOFT, fontStyle: 'italic' }} colSpan={4}>Reading NetSuite…</td></tr>}
                            </tbody>
                        </table>
                    </div>
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                            <span style={mono}>Running total, day by day</span>
                            <span style={{ display: 'flex', gap: '4px' }}>
                                {[['booked', 'Booked'], ['invoiced', 'Invoiced'], ['cash', 'Cash in']].map(([k, l]) => <button key={k} style={chip(metric === k)} onClick={() => setMetric(k)}>{l}</button>)}
                            </span>
                        </div>
                        {ns.a && !ns.loading ? <PaceChart a={ns.a} b={ns.b} metric={metric} labelA={labelA} labelB={labelB} /> : <div style={{ color: SOFT, fontStyle: 'italic', padding: '30px 0' }}>{ns.loading ? 'Reading NetSuite…' : 'No figures.'}</div>}
                    </div>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '20px' }}>
                {/* KPI 4 — TOP CUSTOMERS */}
                <div style={{ ...box, marginBottom: 0 }}>
                    <div style={h4}>Top customers</div>
                    <div style={{ ...mono, textTransform: 'none', letterSpacing: 0, fontSize: '11px', marginBottom: '6px' }}>Booked {labelA}, with the same customer's {labelB} beside it.</div>
                    {ns.loading ? <div style={{ color: SOFT, fontStyle: 'italic' }}>Reading NetSuite…</div> : ns.error ? <div style={{ color: RED }}>⚠ NetSuite could not be read.</div> : top.length === 0 ? <div style={{ color: SOFT, fontStyle: 'italic' }}>No sales orders in this period.</div> : (
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead><tr><th style={th}>Customer</th><th style={{ ...th, ...num }}>Orders</th><th style={{ ...th, ...num }}>Booked</th><th style={{ ...th, ...num }}>Compare</th></tr></thead>
                            <tbody>{top.map(c => (
                                <tr key={c.entity}><td style={td}>{c.name}</td><td style={{ ...td, ...num }}>{c.orders}</td><td style={{ ...td, ...num, fontWeight: 600 }}>{usd(c.booked, { cents: false })}</td><td style={{ ...td, ...num, color: SOFT }}>{c.compare ? usd(c.compare, { cents: false }) : '—'}</td></tr>
                            ))}</tbody>
                        </table>
                    )}
                </div>

                <div>
                    {/* KPI 2 — THE QUOTE PIPELINE */}
                    <div style={box}>
                        <div style={h4}>Quote pipeline</div>
                        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                            <Tile label="Open quotes" value={app.loading ? '…' : pipe.open.count} note={app.loading ? '' : usd(pipe.open.total, { cents: false })} />
                            <Tile label={`Written ${labelA}`} value={app.loading ? '…' : pipe.written.count} note={app.loading ? '' : usd(pipe.written.total, { cents: false })} />
                            <Tile label="Became orders" value={app.loading ? '…' : (pipe.rate == null ? '—' : pctText(pipe.rate).replace('+', ''))} note={app.loading ? '' : `${pipe.converted.count} · ${usd(pipe.converted.total, { cents: false })}`} tone={pipe.rate != null && pipe.rate >= 0.5 ? GREEN : undefined} />
                        </div>
                        <div style={{ fontSize: '0.76rem', color: SOFT, marginTop: '8px' }}>The app's quotes, both doors. A revised quote counts once; unpriced requests are left out.</div>
                    </div>
                    {/* KPI 5 — BY DOOR */}
                    <div style={box}>
                        <div style={h4}>Orders by door</div>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead><tr><th style={th}>Entered through</th><th style={{ ...th, ...num }}>{labelA}</th><th style={{ ...th, ...num }}>{labelB}</th></tr></thead>
                            <tbody>
                                {[DOOR.CPQ, DOOR.OE, DOOR.DISPLAY].filter(d => d !== DOOR.DISPLAY || doors.a.byDoor[d].count || doors.b.byDoor[d].count).map(d => (
                                    <tr key={d}>
                                        <td style={td}>{d === DOOR.OE ? 'Order Entry (incl. the counter)' : d}</td>
                                        <td style={{ ...td, ...num }}>{doors.a.byDoor[d].count} · {usd(doors.a.byDoor[d].total, { cents: false })}</td>
                                        <td style={{ ...td, ...num, color: SOFT }}>{doors.b.byDoor[d].count} · {usd(doors.b.byDoor[d].total, { cents: false })}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div style={{ fontSize: '0.76rem', color: SOFT, marginTop: '8px' }}>From the app's orders (RTG) — an order entered straight into NetSuite is not in these counts.</div>
                    </div>
                    {/* KPI 3 — RECEIVABLES */}
                    <div style={{ ...box, marginBottom: 0 }}>
                        <div style={h4}>Open receivables</div>
                        {ar.error ? <div style={{ color: RED }}>⚠ NetSuite's open invoices could not be read ({ar.error}).</div> : (
                            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                                <Tile label="Owed on invoices" value={ar.loading ? '…' : usd(ar.data && ar.data.due, { cents: false })} note={ar.loading ? '' : `${(ar.data && ar.data.count) || 0} open invoice${ar.data && ar.data.count === 1 ? '' : 's'}`} />
                                <Tile label="Overdue" value={ar.loading ? '…' : usd(ar.data && ar.data.overdue, { cents: false })} tone={ar.data && ar.data.overdue > 0 ? RED : undefined} note={ar.loading ? '' : `${(ar.data && ar.data.overdueCount) || 0} past due`} />
                                <Tile label="Over 60 days late" value={ar.loading ? '…' : usd(ar.data && ar.data.over60, { cents: false })} tone={ar.data && ar.data.over60 > 0 ? RED : undefined} />
                            </div>
                        )}
                        {ar.partial && <div style={{ color: RED, fontSize: '0.8rem', marginTop: '6px' }}>⚠ More than 10,000 open invoices — only the first 10,000 are counted.</div>}
                    </div>
                </div>
            </div>

            {openRow && <OrderPopup row={openRow} loadWork={loadWork} onClose={() => setOpenId('')} />}
        </div>
    );
}
