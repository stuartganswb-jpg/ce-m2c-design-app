import React, { useState } from 'react';
import { db } from '../../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { nsProxyFetch } from './nsProxy';
import { printForm } from './printForm';

// ============================================================================
// QUICK SHIP INVOICE (Stuart 2026-07-17) — the customer-facing document.
// The customer pays against the KIT # and KIT price; component details print as
// small UNPRICED sub-lines. NetSuite keeps the distributed per-item lines for
// inventory + accounting — "Match NetSuite Invoice #" ties the two together
// (SuiteQL: invoices created from this SO) so the books reconcile 1:1 and the
// app invoice carries the real NetSuite invoice number before it's sent.
// ============================================================================

const BRAND_NAMES = { ce: 'Classical Elements', m2c: 'M2C Studio', uniquity: 'Uniquity', leyla: 'Leyla Gans LLC' };

const QuickShipInvoiceModal = ({ order, customer, brand, onClose }) => {
    const [invNo, setInvNo] = useState(order.nsInvoiceNo || '');
    const [busy, setBusy] = useState(false);

    // Priced structure captured at TRANSACTION time; legacy orders (pushed before this
    // feature) fall back to an unpriced item list.
    const lines = Array.isArray(order.invoiceLines) && order.invoiceLines.length
        ? order.invoiceLines
        // Customer document → the alias code they ordered under, when the line carries one.
        : (order.lines || []).map(l => ({ type: 'ITEM', erp: l.aliasErp || l.erp, realErp: l.erp, name: l.name, qty: l.qty, rate: null, total: null }));
    const total = typeof order.invoiceTotal === 'number'
        ? order.invoiceTotal
        : lines.reduce((s, l) => s + (l.type === 'KIT' ? (l.price || 0) : (l.total || 0)), 0);

    const matchInvoice = async () => {
        if (!order.nsInternalId) return alert('This order has no NetSuite sales-order id.');
        setBusy(true);
        try {
            const r = await nsProxyFetch({
                targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql',
                method: 'POST',
                payload: { q: `SELECT id, tranid FROM transaction WHERE type = 'CustInvc' AND createdfrom = ${parseInt(order.nsInternalId, 10)}` }
            });
            const b = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(JSON.stringify(b).slice(0, 300));
            const rows = b.items || [];
            if (!rows.length) {
                alert(`No NetSuite invoice found yet for SO ${order.soId}.\n\nBill the sales order in NetSuite first, then hit Match again — the invoice # imports onto this document.`);
            } else {
                const no = rows.map(x => x.tranid).join(', ');
                await updateDoc(doc(db, 'hq_sales_orders', order.id), { nsInvoiceNo: no, nsInvoiceIds: rows.map(x => String(x.id)), invoiceMatchedAt: Date.now() });
                setInvNo(no);
            }
        } catch (e) { alert('Invoice match failed: ' + (e.message || e)); }
        setBusy(false);
    };

    const thS = { fontFamily: 'var(--mono, monospace)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.14em', color: '#8a857c', textAlign: 'left', padding: '6px', borderBottom: '2px solid #1c1a16' };
    const InvoiceDoc = () => (
        <div style={{ fontFamily: 'var(--sans, Arial)', color: '#1c1a16', width: '100%', maxWidth: '760px', margin: '0 auto', background: '#fff', padding: '10px 6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #1c1a16', paddingBottom: '14px' }}>
                <div>
                    <div style={{ fontFamily: 'var(--serif, Georgia)', fontSize: '26px', fontWeight: 500 }}>{BRAND_NAMES[brand] || String(brand || '').toUpperCase()}</div>
                    <div style={{ fontFamily: 'var(--mono, monospace)', fontSize: '9px', letterSpacing: '.18em', textTransform: 'uppercase', color: '#8a857c', marginTop: '4px' }}>Quick Ship · Stocked Program</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: 'var(--serif, Georgia)', fontSize: '22px', letterSpacing: '.08em' }}>INVOICE</div>
                    <div style={{ fontFamily: 'var(--mono, monospace)', fontSize: '11px', marginTop: '4px' }}>{invNo ? `# ${invNo}` : 'DRAFT — NetSuite # not matched'}</div>
                    <div style={{ fontFamily: 'var(--mono, monospace)', fontSize: '10px', color: '#8a857c', marginTop: '2px' }}>{new Date(order.createdAt || Date.now()).toLocaleDateString()}</div>
                </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid #ddd8cf' }}>
                <div>
                    <div style={{ fontFamily: 'var(--mono, monospace)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.14em', color: '#8a857c' }}>Bill To</div>
                    <div style={{ fontSize: '15px', fontWeight: 600, marginTop: '4px' }}>{customer?.name || order.customer || ''}</div>
                    {order.jobName ? <div style={{ fontSize: '12px', color: '#524e46', marginTop: '2px' }}>Job: {order.jobName}</div> : null}
                </div>
                <div style={{ textAlign: 'right', fontFamily: 'var(--mono, monospace)', fontSize: '10px', color: '#524e46' }}>
                    <div>Sales Order: {order.soId}</div>
                    {customer?.terms ? <div>Terms: {customer.terms}</div> : null}
                </div>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
                <thead>
                    <tr>
                        <th style={thS}>Item</th>
                        <th style={{ ...thS, textAlign: 'center', width: '60px' }}>Qty</th>
                        <th style={{ ...thS, textAlign: 'right', width: '110px' }}>Amount</th>
                    </tr>
                </thead>
                <tbody>
                    {lines.map((l, i) => l.type === 'KIT' ? (
                        <React.Fragment key={i}>
                            <tr style={{ borderTop: '1px solid #ddd8cf' }}>
                                <td style={{ padding: '10px 6px 4px' }}><span style={{ fontFamily: 'var(--mono, monospace)', fontWeight: 700, fontSize: '13px' }}>{l.code}</span></td>
                                <td style={{ textAlign: 'center', fontFamily: 'var(--mono, monospace)', fontSize: '12px', padding: '10px 6px 4px' }}>1</td>
                                <td style={{ textAlign: 'right', fontFamily: 'var(--mono, monospace)', fontSize: '13px', fontWeight: 700, padding: '10px 6px 4px' }}>${(l.price || 0).toFixed(2)}</td>
                            </tr>
                            {(l.components || []).map((c, ci) => (
                                <tr key={`${i}-${ci}`}>
                                    {/* Packed components read in the unit the customer ordered; loose
                                        ones are unchanged. c.qty is always the each count. */}
                                    <td colSpan={3} style={{ padding: '1px 6px 1px 26px', fontSize: '10.5px', color: '#8a857c' }}>{c.packs ? `${c.packs} × ${c.packUom} (${c.qty} ea) — ` : `${c.qty} × `}{c.erp} — {c.name}</td>
                                </tr>
                            ))}
                        </React.Fragment>
                    ) : (
                        <tr key={i} style={{ borderTop: '1px solid #ddd8cf' }}>
                            <td style={{ padding: '8px 6px' }}><span style={{ fontFamily: 'var(--mono, monospace)', fontSize: '12px' }}>{l.erp}</span><span style={{ fontSize: '11px', color: '#524e46' }}> — {l.name}</span></td>
                            {/* Sold by the pack → bill in packs ("2 × 7 PACK"), with the each count
                                underneath so the customer can reconcile against the shipment. */}
                            <td style={{ textAlign: 'center', fontFamily: 'var(--mono, monospace)', fontSize: '12px' }}>
                                {l.packs ? <>{l.packs} × {l.packUom}<div style={{ fontSize: '9px', color: '#8a857c' }}>{l.qty} ea</div></> : l.qty}
                            </td>
                            <td style={{ textAlign: 'right', fontFamily: 'var(--mono, monospace)', fontSize: '12px' }}>{l.total != null ? `$${l.total.toFixed(2)}` : '—'}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '2px solid #1c1a16', marginTop: '8px', paddingTop: '10px' }}>
                <div style={{ textAlign: 'right' }}>
                    <span style={{ fontFamily: 'var(--mono, monospace)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.14em', color: '#8a857c', marginRight: '16px' }}>Total Due</span>
                    <span style={{ fontFamily: 'var(--serif, Georgia)', fontSize: '22px' }}>${total.toFixed(2)}</span>
                </div>
            </div>
            <div style={{ marginTop: '18px', fontFamily: 'var(--mono, monospace)', fontSize: '9px', color: '#8a857c' }}>Thank you — please reference invoice #{invNo || order.soId} with payment.</div>
        </div>
    );

    return (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 12000, padding: '16px' }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--paper, #f7f4ee)', width: 'min(900px, 96vw)', maxHeight: '94vh', display: 'flex', flexDirection: 'column', borderRadius: '4px', boxShadow: '0 16px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '14px 20px', borderBottom: '1px solid var(--line, #ddd)', background: '#fff', flexWrap: 'wrap' }}>
                    <div style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)' }}>Invoice — {order.soId}{invNo ? ` · #${invNo}` : ''}</div>
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        <button onClick={matchInvoice} disabled={busy} title="Find the NetSuite invoice billed from this SO and import its number onto this document" style={{ padding: '9px 14px', background: invNo ? 'transparent' : 'var(--brass)', color: invNo ? 'var(--ink)' : '#fff', border: invNo ? '1px solid var(--line)' : 'none', cursor: busy ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                            {busy ? 'Matching…' : (invNo ? '↻ Re-match NS Invoice #' : '⤓ Match NetSuite Invoice #')}
                        </button>
                        <button onClick={() => printForm(<InvoiceDoc />, `Invoice ${invNo || order.soId}`)} style={{ padding: '9px 14px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' }}>🖨 Print / PDF</button>
                        <button onClick={() => { window.location.href = `mailto:${customer?.email || ''}?subject=${encodeURIComponent(`Invoice ${invNo || order.soId} — ${BRAND_NAMES[brand] || ''}`)}&body=${encodeURIComponent('Please find your invoice attached.\n\nThank you!')}`; }} style={{ padding: '9px 14px', background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' }}>✉ Email</button>
                        <button onClick={onClose} style={{ padding: '9px 14px', background: 'transparent', color: 'var(--ink-soft)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' }}>Close</button>
                    </div>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
                    <div style={{ background: '#fff', border: '1px solid var(--line, #ddd)', padding: '28px', boxShadow: '0 2px 12px rgba(0,0,0,0.05)' }}>
                        <InvoiceDoc />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default QuickShipInvoiceModal;
