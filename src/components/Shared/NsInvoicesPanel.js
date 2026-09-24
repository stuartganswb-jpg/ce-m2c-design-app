// OPEN INVOICES THAT LIVE IN NETSUITE — the ones this app never raised, and won't for a long time.
//
// Stuart 2026-09-24: when the old processor is switched off, this is how those invoices get paid.
// Tick the ones to pay (in full — no part payments on an invoice), then either show the QR to a
// customer on the phone or send them the link. Each brand sees only its own subsidiary.
//
// mode 'CUSTOMER' — one customer's invoices, on their CRM card.
// mode 'ALL'      — every open invoice for the brand, oldest due first: the chasing list.
import React, { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import { PayQr } from './PayLinkPanel';

const theme = { ink: '#1c1a16', inkSoft: '#524e46', brass: '#b08d57', line: 'rgba(28,26,22,.14)', mono: "'IBM Plex Mono', monospace", sans: "'Inter', -apple-system, sans-serif" };
const usd = (v) => `$${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (s) => (s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—');
const overdue = (s) => !!s && new Date(s) < new Date();
const btn = (primary) => ({ padding: '7px 12px', background: primary ? theme.ink : 'transparent', color: primary ? '#fff' : theme.ink, border: `1px solid ${primary ? theme.ink : theme.line}`, fontFamily: theme.mono, fontSize: '9.5px', letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' });

export default function NsInvoicesPanel({ brand = 'ce', customerId = '', customerName = '', mode = 'CUSTOMER' }) {
    const [rows, setRows] = useState(null);
    const [picked, setPicked] = useState({});
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const [link, setLink] = useState(null);
    // An unfiltered read is thousands of rows and NetSuite pages at 1,000 — so the chasing list
    // asks for a slice, and says plainly when there is more behind it (Stuart 2026-09-24).
    const [who, setWho] = useState('');
    const [dueFrom, setDueFrom] = useState('');
    const [dueTo, setDueTo] = useState('');
    const [more, setMore] = useState(false);
    const [diag, setDiag] = useState(null);
    const [page, setPage] = useState(0);
    const PAGE = 200;

    const load = useCallback(async (opts = {}) => {
        const offset = Number(opts.offset || 0);
        setBusy(true); setErr(''); setLink(null);
        if (!offset) setPicked({});
        try {
            const res = await httpsCallable(functions, 'nsOpenInvoices')({
                brand, customerId: mode === 'CUSTOMER' ? customerId : '',
                customerLike: mode === 'ALL' ? (opts.who !== undefined ? opts.who : who) : '',
                dueFrom: opts.dueFrom !== undefined ? opts.dueFrom : dueFrom,
                dueTo: opts.dueTo !== undefined ? opts.dueTo : dueTo,
                limit: PAGE, offset,
            });
            setRows((prev) => (offset ? [...(prev || []), ...(res.data.invoices || [])] : (res.data.invoices || [])));
            setMore(res.data.hasMore === true);
            setPage(offset / PAGE);
        } catch (e) { setErr(e.message || String(e)); if (!offset) setRows([]); }
        finally { setBusy(false); }
    }, [brand, customerId, mode, who, dueFrom, dueTo]);

    useEffect(() => { if (mode === 'CUSTOMER') load(); }, [mode, load]);

    const chosen = (rows || []).filter((r) => picked[r.id]);
    const chosenTotal = chosen.reduce((s, r) => s + Number(r.due || 0), 0);
    // A link pays ONE customer's invoices — the payment applies to their ledger.
    const oneCustomer = new Set(chosen.map((r) => r.customerNsId)).size <= 1;

    const makeLink = async () => {
        if (!chosen.length) return;
        if (!oneCustomer) { setErr('Choose invoices for one customer at a time — a payment applies to one customer.'); return; }
        setBusy(true); setErr('');
        try {
            const res = await httpsCallable(functions, 'payLinkCreate')({
                docType: 'INVOICE', brand,
                customerId: customerId || `CUST-${chosen[0].customerNsId}`,
                customerName: customerName || chosen[0].customerName,
                reference: chosen.length === 1 ? chosen[0].tranid : `${chosen.length} invoices`,
                totalAmount: chosenTotal,
                invoices: chosen.map((r) => ({ id: r.id, tranid: r.tranid, amount: r.due })),
            });
            setLink(res.data);
        } catch (e) { setErr(e.message || String(e)); }
        finally { setBusy(false); }
    };

    return (
        <div style={{ border: `1px solid ${theme.line}`, background: '#fff', padding: '14px 16px', fontFamily: theme.sans }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' }}>
                <span style={{ fontFamily: theme.mono, fontSize: '9.5px', letterSpacing: '.12em', textTransform: 'uppercase', color: theme.brass }}>
                    Open invoices · NetSuite {mode === 'ALL' ? `· ${String(brand).toUpperCase()}` : ''}
                </span>
                <button style={btn(false)} disabled={busy} onClick={load}>{busy ? 'Reading…' : (rows ? 'Refresh' : 'Load')}</button>
                {rows && rows.length > 0 && (
                    <span style={{ fontSize: '12.5px', color: theme.inkSoft }}>
                        {rows.length} open · {usd(rows.reduce((s, r) => s + Number(r.due || 0), 0))} outstanding
                    </span>
                )}
            </div>

            {mode === 'ALL' && (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '10px' }}>
                    <input placeholder="Customer name or id" value={who} onChange={(e) => setWho(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') load({ offset: 0 }); }}
                        style={{ padding: '6px 8px', border: `1px solid ${theme.line}`, fontFamily: theme.sans, fontSize: '12.5px', minWidth: '190px' }} />
                    <span style={{ fontSize: '12px', color: theme.inkSoft }}>due</span>
                    <input type="date" value={dueFrom} onChange={(e) => setDueFrom(e.target.value)} style={{ padding: '6px 8px', border: `1px solid ${theme.line}`, fontSize: '12.5px' }} />
                    <span style={{ fontSize: '12px', color: theme.inkSoft }}>to</span>
                    <input type="date" value={dueTo} onChange={(e) => setDueTo(e.target.value)} style={{ padding: '6px 8px', border: `1px solid ${theme.line}`, fontSize: '12.5px' }} />
                    <button style={btn(true)} disabled={busy} onClick={() => load({ offset: 0 })}>{busy ? 'Reading…' : 'Find'}</button>
                    {(who || dueFrom || dueTo) && (
                        <button style={btn(false)} disabled={busy} onClick={() => { setWho(''); setDueFrom(''); setDueTo(''); load({ offset: 0, who: '', dueFrom: '', dueTo: '' }); }}>Clear</button>
                    )}
                    <button style={btn(false)} disabled={busy} onClick={() => { const d = new Date(); const iso = d.toISOString().slice(0, 10); setDueFrom(''); setDueTo(iso); load({ offset: 0, dueTo: iso }); }}>Overdue only</button>
                    {rows && rows.length === 0 && (
                        <button style={btn(false)} disabled={busy} title="Count invoices at each step of the query, to see which condition is excluding them"
                            onClick={async () => {
                                setBusy(true); setDiag(null);
                                try { const res = await httpsCallable(functions, 'nsOpenInvoices')({ brand, diagnose: true }); setDiag(res.data.diagnosis || []); }
                                catch (e) { setErr(e.message || String(e)); }
                                finally { setBusy(false); }
                            }}>Why is this empty?</button>
                    )}
                </div>
            )}

            {err && <div style={{ fontSize: '12.5px', color: '#9b2c2c', marginBottom: '6px' }}>✗ {err}</div>}
            {rows && rows.length === 0 && !busy && <div style={{ fontSize: '12.5px', color: theme.inkSoft }}>Nothing open in NetSuite.</div>}
            {diag && (
                <div style={{ marginTop: '8px', border: `1px solid ${theme.line}`, padding: '10px 12px', fontFamily: theme.mono, fontSize: '11.5px' }}>
                    {diag.map((d) => (
                        <div key={d.step} style={{ color: d.error ? '#9b2c2c' : theme.ink }}>
                            {d.step}: {d.error ? `error — ${d.error}` : d.count}
                        </div>
                    ))}
                </div>
            )}

            {rows && rows.length > 0 && (
                <div style={{ maxHeight: mode === 'ALL' ? '420px' : '260px', overflowY: 'auto', border: `1px solid ${theme.line}` }}>
                    <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '12.5px' }}>
                        <thead><tr style={{ textAlign: 'left', color: theme.inkSoft, background: 'var(--paper-2, #f2efe8)' }}>
                            <th style={{ padding: '6px' }} />
                            <th style={{ padding: '6px' }}>Invoice</th>
                            {mode === 'ALL' && <th style={{ padding: '6px' }}>Customer</th>}
                            <th style={{ padding: '6px' }}>Date</th>
                            <th style={{ padding: '6px' }}>Due</th>
                            <th style={{ padding: '6px', textAlign: 'right' }}>Owed</th>
                        </tr></thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.id} style={{ borderTop: `1px solid ${theme.line}` }}>
                                    <td style={{ padding: '6px' }}>
                                        <input type="checkbox" checked={!!picked[r.id]} onChange={(e) => setPicked({ ...picked, [r.id]: e.target.checked })} />
                                    </td>
                                    <td style={{ padding: '6px', fontFamily: theme.mono }}>{r.tranid}</td>
                                    {mode === 'ALL' && <td style={{ padding: '6px' }}>{r.customerName}</td>}
                                    <td style={{ padding: '6px' }}>{day(r.date)}</td>
                                    <td style={{ padding: '6px', color: overdue(r.dueDate) ? '#9b2c2c' : theme.ink }}>
                                        {day(r.dueDate)}{overdue(r.dueDate) ? ' · overdue' : ''}
                                    </td>
                                    <td style={{ padding: '6px', textAlign: 'right', fontFamily: theme.mono }}>{usd(r.due)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {rows && rows.length > 0 && more && (
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginTop: '8px', fontSize: '12.5px', color: '#9b6a2c' }}>
                    ⚠ There are more open invoices than shown — narrow by customer or due date, or
                    <button style={btn(false)} disabled={busy} onClick={() => load({ offset: (page + 1) * PAGE })}>Load more</button>
                </div>
            )}

            {chosen.length > 0 && (
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginTop: '10px' }}>
                    <span style={{ fontSize: '13px' }}>{chosen.length} selected · <strong>{usd(chosenTotal)}</strong></span>
                    <button style={btn(true)} disabled={busy} onClick={makeLink}>Create pay link</button>
                    <span style={{ fontSize: '12px', color: theme.inkSoft }}>Invoices are paid in full.</span>
                </div>
            )}

            {link && (
                <div style={{ display: 'flex', gap: '14px', alignItems: 'center', marginTop: '12px', paddingTop: '10px', borderTop: `1px solid ${theme.line}` }}>
                    <PayQr url={link.url} />
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '12.5px', marginBottom: '6px' }}>{usd(link.amountDue)} — have them scan, or send the link:</div>
                        <input readOnly value={link.url} onFocus={(e) => e.target.select()}
                            style={{ width: '100%', padding: '6px 8px', border: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '11px' }} />
                        <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                            <button style={btn(false)} onClick={() => navigator.clipboard && navigator.clipboard.writeText(link.url)}>Copy</button>
                            <a style={{ ...btn(false), textDecoration: 'none' }} href={`mailto:?subject=${encodeURIComponent('Invoice payment')}&body=${encodeURIComponent(`You can pay securely here:\n\n${link.url}\n\nClassical Elements`)}`}>Email</a>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
