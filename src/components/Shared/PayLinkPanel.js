// THE PAYMENT PANEL — one implementation, mounted wherever staff take money against a document:
// the CRM quote / sales order card, the Quick Ship invoice, and Order Entry's deposit step.
//
// It creates a pay link (portal #/pay/<token>), shows the QR for a customer standing in front of
// you, and lists what has been paid. It NEVER handles card data: the customer enters their card on
// the portal pay page, in the gateway's own fields.
//
// Stuart's rules (2026-09-23): a quote / sales order asks for a deposit — 50% by default, staff may
// set another percentage OR a flat figure; an invoice is paid in full. Links are single use, expire
// in 30 days, and can be cancelled and reissued. A link goes on a PDF only when staff add it.
import React, { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import QRCode from 'qrcode';

const theme = { ink: '#1c1a16', inkSoft: '#524e46', brass: '#b08d57', line: 'rgba(28,26,22,.14)', mono: "'IBM Plex Mono', monospace", sans: "'Inter', -apple-system, sans-serif" };
const usd = (v) => `$${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (t) => t ? new Date(Number(t)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
const btn = (primary) => ({ padding: '7px 12px', background: primary ? theme.ink : 'transparent', color: primary ? '#fff' : theme.ink, border: `1px solid ${primary ? theme.ink : theme.line}`, fontFamily: theme.mono, fontSize: '9.5px', letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' });
const input = { padding: '6px 8px', border: `1px solid ${theme.line}`, background: '#fff', fontFamily: theme.sans, fontSize: '12.5px', outline: 'none' };

// The QR a customer scans at a trade show or across a desk — drawn locally, never sent to an
// outside service (the link would be the thing leaking).
export function PayQr({ url, size = 148 }) {
    const [svg, setSvg] = useState('');
    useEffect(() => {
        let alive = true;
        if (!url) return undefined;
        QRCode.toString(url, { type: 'svg', margin: 1, width: size, errorCorrectionLevel: 'M' })
            .then((s) => { if (alive) setSvg(s); })
            .catch(() => { if (alive) setSvg(''); });
        return () => { alive = false; };
    }, [url, size]);
    if (!svg) return null;
    return <div style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export default function PayLinkPanel({ docType, collection, docId, reference, customerName, totalAmount, brand = 'ce', compact = false, onLink }) {
    const [links, setLinks] = useState(null);
    const [paidTotal, setPaidTotal] = useState(0);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const [mode, setMode] = useState(docType === 'INVOICE' ? 'FULL' : 'PCT');
    const [pct, setPct] = useState('50');
    const [flat, setFlat] = useState('');
    const [showQr, setShowQr] = useState(null);

    const load = useCallback(async () => {
        try {
            const res = await httpsCallable(functions, 'payLinksFor')({ collection, docId, reference });
            setLinks(res.data.links || []);
            setPaidTotal(res.data.paidTotal || 0);
        } catch (e) { setErr(e.message || String(e)); setLinks([]); }
    }, [collection, docId, reference]);

    useEffect(() => { load(); }, [load]);

    const create = async () => {
        setBusy(true); setErr('');
        try {
            const res = await httpsCallable(functions, 'payLinkCreate')({
                docType, collection, docId, reference, customerName, brand,
                totalAmount: Number(totalAmount),
                ...(mode === 'FLAT' ? { flatAmount: Number(flat) } : {}),
                ...(mode === 'PCT' ? { depositPct: Number(pct) } : {}),
            });
            setShowQr(res.data.url);
            if (onLink) onLink(res.data);
            await load();
        } catch (e) { setErr(e.message || String(e)); }
        finally { setBusy(false); }
    };

    const voidLink = async (token) => {
        if (!window.confirm('Cancel this payment link?\n\nThe customer will no longer be able to pay from it. You can create another.')) return;
        setBusy(true); setErr('');
        try { await httpsCallable(functions, 'payLinkVoid')({ token }); await load(); }
        catch (e) { setErr(e.message || String(e)); }
        finally { setBusy(false); }
    };

    const open = (links || []).filter((l) => l.status === 'OPEN' || l.status === 'CHARGING');
    const due = Number(totalAmount || 0) - Number(paidTotal || 0);

    return (
        <div style={{ border: `1px solid ${theme.line}`, background: '#fff', padding: compact ? '10px 12px' : '14px 16px', fontFamily: theme.sans }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' }}>
                <span style={{ fontFamily: theme.mono, fontSize: '9.5px', letterSpacing: '.12em', textTransform: 'uppercase', color: theme.brass }}>Payment</span>
                <span style={{ fontSize: '12.5px', color: theme.inkSoft }}>
                    Total {usd(totalAmount)}
                    {paidTotal > 0 && <> · <span style={{ color: '#3a7d44' }}>paid {usd(paidTotal)}</span> · balance {usd(due)}</>}
                </span>
            </div>

            {paidTotal > 0 && due <= 0 && (
                <div style={{ fontSize: '12.5px', color: '#3a7d44', marginBottom: '8px' }}>✓ Paid in full</div>
            )}

            {/* Ask for a deposit (a percentage or a flat figure), or the full amount on an invoice. */}
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '8px' }}>
                {docType !== 'INVOICE' && (
                    <>
                        <button style={btn(mode === 'PCT')} onClick={() => setMode('PCT')}>% deposit</button>
                        <button style={btn(mode === 'FLAT')} onClick={() => setMode('FLAT')}>Flat $</button>
                        {mode === 'PCT'
                            ? <input style={{ ...input, width: '62px' }} value={pct} onChange={(e) => setPct(e.target.value.replace(/[^0-9]/g, ''))} />
                            : <input style={{ ...input, width: '92px' }} placeholder="e.g. 2500" value={flat} onChange={(e) => setFlat(e.target.value.replace(/[^0-9.]/g, ''))} />}
                        <span style={{ fontSize: '12px', color: theme.inkSoft }}>
                            asks for {usd(mode === 'FLAT' ? Number(flat || 0) : Number(totalAmount || 0) * Number(pct || 0) / 100)}
                        </span>
                    </>
                )}
                {docType === 'INVOICE' && <span style={{ fontSize: '12.5px', color: theme.inkSoft }}>Invoices are paid in full — {usd(totalAmount)}</span>}
                <button style={btn(true)} disabled={busy || !(Number(totalAmount) > 0)} onClick={create}>
                    {busy ? 'Working…' : 'Create pay link'}
                </button>
            </div>

            {err && <div style={{ fontSize: '12.5px', color: '#9b2c2c', marginBottom: '6px' }}>✗ {err}</div>}

            {/* The QR for a customer who is standing here — scan, pay on their own phone. */}
            {showQr && (
                <div style={{ display: 'flex', gap: '14px', alignItems: 'center', padding: '10px 0', borderTop: `1px solid ${theme.line}` }}>
                    <PayQr url={showQr} />
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '12.5px', marginBottom: '6px' }}>Have them scan this, or send the link:</div>
                        <input style={{ ...input, width: '100%', fontFamily: theme.mono, fontSize: '11px' }} readOnly value={showQr} onFocus={(e) => e.target.select()} />
                        <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                            <button style={btn(false)} onClick={() => navigator.clipboard && navigator.clipboard.writeText(showQr)}>Copy</button>
                            <a style={{ ...btn(false), textDecoration: 'none' }} href={`mailto:?subject=${encodeURIComponent(`Payment for ${reference || 'your order'}`)}&body=${encodeURIComponent(`You can pay securely here:\n\n${showQr}\n\nClassical Elements`)}`}>Email</a>
                            <button style={btn(false)} onClick={() => setShowQr(null)}>Hide</button>
                        </div>
                    </div>
                </div>
            )}

            {/* What has been asked for and what has been paid. */}
            {links && links.length > 0 && (
                <div style={{ borderTop: `1px solid ${theme.line}`, paddingTop: '8px', marginTop: '4px' }}>
                    {links.slice(0, compact ? 3 : 8).map((l) => (
                        <div key={l.token} style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', fontSize: '12px', padding: '4px 0' }}>
                            <span style={{ fontFamily: theme.mono, color: l.status === 'PAID' ? '#3a7d44' : theme.inkSoft }}>
                                {l.status === 'PAID' ? `✓ paid ${usd(l.paidAmount)}` : l.status === 'VOID' ? '✕ cancelled' : `${usd(l.amountDue)} due`}
                            </span>
                            <span style={{ color: theme.inkSoft }}>
                                {l.status === 'PAID' ? `${when(l.paidAt)} · ${l.transactionId}` : `made ${when(l.createdAt)}${l.createdBy ? ` by ${l.createdBy}` : ''} · expires ${when(l.expiresAt)}`}
                            </span>
                            {(l.status === 'OPEN' || l.status === 'CHARGING') && (
                                <>
                                    <button style={btn(false)} onClick={() => setShowQr(l.url)}>Show QR</button>
                                    <button style={btn(false)} onClick={() => voidLink(l.token)}>Cancel</button>
                                </>
                            )}
                        </div>
                    ))}
                </div>
            )}
            {links && links.length === 0 && !showQr && (
                <div style={{ fontSize: '12px', color: theme.inkSoft }}>No payment link yet for this {String(docType || '').toLowerCase().replace('_', ' ')}.</div>
            )}
            {open.length > 0 && (
                <div style={{ fontSize: '11.5px', color: theme.inkSoft, marginTop: '6px' }}>
                    A link is only printed on the document when you add it — see the 🖨 form.
                </div>
            )}
        </div>
    );
}
