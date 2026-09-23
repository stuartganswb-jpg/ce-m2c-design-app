// HQ 11 → INTEGRATIONS — the admin's connection probes for the outside services the app talks to.
//
// Each probe proves a vendor pipe works before any screen depends on it, and each is READ-ONLY:
// nothing is written to Firestore, no order/RTG/NetSuite record is touched, and credentials stay
// on the server (Secret Manager) — the browser only ever sees a pass/fail summary.
//
// NMI (payments, SANDBOX): a key/connection check that sends NO card data, plus an OPTIONAL $1
// test invoice whose real purpose is to learn whether NMI hands back a payment-page URL we can put
// on our own quote/SO PDFs (Stuart's first payments use case) or only emails it itself.
import React, { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db, functions } from '../../firebase';

const card = { background: '#fff', border: '1px solid var(--line)', padding: '18px', marginBottom: '18px' };
const label = { fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink-soft)' };
const btn = (primary, busy) => ({
    padding: '10px 16px', background: primary ? 'var(--ink)' : 'transparent', color: primary ? '#fff' : 'var(--ink)',
    border: `1px solid ${primary ? 'var(--ink)' : 'var(--line)'}`, fontFamily: 'var(--mono)', fontSize: '10px',
    letterSpacing: '.1em', textTransform: 'uppercase', cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1,
});
const input = { padding: '8px 10px', border: '1px solid var(--line)', background: '#fff', fontFamily: 'var(--sans)', fontSize: '13px', outline: 'none' };

// The pay page's settings, and a way to mint a link by hand while the document buttons are built.
// TEST vs LIVE is decided here and read on the SERVER — a floor click can never charge a real card.
function PaySettings() {
    const [cfg, setCfg] = useState(null);
    const [saving, setSaving] = useState(false);
    const [key, setKey] = useState('');
    const [form, setForm] = useState({ docType: 'SALES_ORDER', reference: '', customerName: '', totalAmount: '', depositPct: '50', collection: '', docId: '' });
    const [link, setLink] = useState(null);
    const [err, setErr] = useState('');

    useEffect(() => onSnapshot(doc(db, 'system', 'nmi_config'),
        (s) => {
            const c = { environment: 'SANDBOX', tokenizationKeys: {}, ...(s.exists() ? s.data() : {}) };
            setCfg(c); setKey(c.tokenizationKeys.ce || '');
        }, () => setCfg({ environment: 'SANDBOX', tokenizationKeys: {} })), []);

    if (!cfg) return null;
    const isLive = cfg.environment === 'PRODUCTION';

    const save = async (patch) => {
        if (patch.environment === 'PRODUCTION' && !window.confirm('Switch payments to LIVE?\n\nPay links will charge real cards from then on.')) return;
        setSaving(true);
        try { await setDoc(doc(db, 'system', 'nmi_config'), patch, { merge: true }); }
        catch (e) { alert(`Could not save: ${e.message || e}`); }
        finally { setSaving(false); }
    };

    const makeLink = async () => {
        setErr(''); setLink(null);
        try {
            const res = await httpsCallable(functions, 'payLinkCreate')({
                docType: form.docType, reference: form.reference, customerName: form.customerName,
                totalAmount: Number(form.totalAmount), depositPct: Number(form.depositPct),
                collection: form.collection, docId: form.docId, brand: 'ce',
            });
            setLink(res.data);
        } catch (e) { setErr(e.message || String(e)); }
    };

    const chip = (active) => ({ padding: '7px 12px', border: `1px solid ${active ? 'var(--ink)' : 'var(--line)'}`, background: active ? 'var(--ink)' : '#fff', color: active ? '#fff' : 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', cursor: saving ? 'wait' : 'pointer' });

    return (
        <div style={card}>
            <span style={{ ...label, color: 'var(--brass)' }}>NMI · Pay links</span>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', margin: '10px 0 12px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '12px', color: 'var(--ink-soft)' }}>Mode</span>
                <button style={chip(!isLive)} disabled={saving} onClick={() => save({ environment: 'SANDBOX' })}>Test</button>
                <button style={{ ...chip(isLive), ...(isLive ? { background: '#3a7d44', borderColor: '#3a7d44' } : {}) }} disabled={saving} onClick={() => save({ environment: 'PRODUCTION' })}>Live</button>
                <span style={{ fontSize: '12px', color: 'var(--ink-soft)' }}>
                    {isLive ? 'LIVE — pay links charge real cards.' : 'TEST — nothing is charged.'}
                </span>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '14px' }}>
                <span style={{ fontSize: '12px', color: 'var(--ink-soft)' }}>CE public tokenization key</span>
                <input style={{ ...input, minWidth: '280px' }} value={key} onChange={(e) => setKey(e.target.value)} placeholder="e.g. hYW9bd-c6E952-Z4tCVb-kQk6c2" />
                <button style={btn(false, saving)} disabled={saving} onClick={() => save({ tokenizationKeys: { ...(cfg.tokenizationKeys || {}), ce: key.trim() } })}>Save key</button>
            </div>

            <div style={{ borderTop: '1px solid var(--line)', paddingTop: '12px' }}>
                <span style={label}>Make a pay link (until the buttons land on the documents)</span>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '8px 0' }}>
                    <select style={input} value={form.docType} onChange={(e) => setForm({ ...form, docType: e.target.value })}>
                        <option value="SALES_ORDER">Sales order (deposit)</option>
                        <option value="QUOTE">Quote (deposit)</option>
                        <option value="INVOICE">Invoice (paid in full)</option>
                    </select>
                    <input style={{ ...input, width: '150px' }} placeholder="Reference e.g. SO60428" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
                    <input style={{ ...input, width: '180px' }} placeholder="Customer name" value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} />
                    <input style={{ ...input, width: '110px' }} placeholder="Total $" value={form.totalAmount} onChange={(e) => setForm({ ...form, totalAmount: e.target.value.replace(/[^0-9.]/g, '') })} />
                    {form.docType !== 'INVOICE' && (
                        <input style={{ ...input, width: '90px' }} placeholder="Deposit %" value={form.depositPct} onChange={(e) => setForm({ ...form, depositPct: e.target.value.replace(/[^0-9]/g, '') })} />
                    )}
                    <button style={btn(true, false)} onClick={makeLink}>Create link</button>
                </div>
                {err && <div style={{ fontSize: '13px', color: '#9b2c2c' }}>✗ {err}</div>}
                {link && (
                    <div style={{ fontSize: '13px', marginTop: '6px' }}>
                        <div style={{ color: '#3a7d44' }}>✓ {Number(link.amountDue).toFixed(2)} due of {Number(link.totalAmount).toFixed(2)} · expires {new Date(link.expiresAt).toLocaleDateString()}</div>
                        <input style={{ ...input, width: '100%', marginTop: '6px', fontFamily: 'var(--mono)', fontSize: '12px' }} readOnly value={link.url} onFocus={(e) => e.target.select()} />
                    </div>
                )}
            </div>
        </div>
    );
}

// What actually arrived from the gateway, and whether we could prove it came from NMI. This is how
// the signature format is confirmed BEFORE anything downstream trusts a webhook.
function WebhookEvents() {
    const [busy, setBusy] = useState(false);
    const [rows, setRows] = useState(null);
    const [err, setErr] = useState('');

    const load = async () => {
        setBusy(true); setErr(''); setRows(null);
        try {
            const res = await httpsCallable(functions, 'nmiRecentEvents')();
            setRows(res.data.events || []);
        } catch (e) {
            setErr(e.message || String(e));
        } finally { setBusy(false); }
    };

    const when = (t) => t ? new Date(Number(t)).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

    return (
        <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '10px' }}>
                <span style={{ ...label, color: 'var(--brass)' }}>NMI · Webhook events received</span>
                <button style={btn(false, busy)} disabled={busy} onClick={load}>{busy ? 'Reading…' : 'Show last 10'}</button>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--ink-soft)', margin: '0 0 6px' }}>
                What the gateway has sent us. Nothing acts on these yet — they are recorded so we can prove the
                connection and the signature before any payment depends on them.
            </p>
            {err && <div style={{ fontSize: '13px', color: '#9b2c2c' }}>✗ {err}</div>}
            {rows && rows.length === 0 && (
                <div style={{ fontSize: '13px', color: '#9b6a2c' }}>
                    ⚠ Nothing received yet. Creating an invoice is not a transaction — pay one, or run a sale in NMI's
                    virtual terminal, then check again.
                </div>
            )}
            {rows && rows.length > 0 && (
                <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: 'var(--mono)', fontSize: '12px', marginTop: '8px' }}>
                    <thead><tr style={{ textAlign: 'left', color: 'var(--ink-soft)', borderBottom: '1px solid var(--line)' }}>
                        <th style={{ padding: '6px' }}>Received</th><th style={{ padding: '6px' }}>Event</th>
                        <th style={{ padding: '6px' }}>Amount</th><th style={{ padding: '6px' }}>Transaction</th>
                        <th style={{ padding: '6px' }}>Signature</th>
                    </tr></thead>
                    <tbody>
                        {rows.map((e) => (
                            <tr key={e.id} style={{ borderBottom: '1px solid var(--line)' }}>
                                <td style={{ padding: '6px' }}>{when(e.receivedAt)}</td>
                                <td style={{ padding: '6px' }}>{e.eventType || '—'}</td>
                                <td style={{ padding: '6px' }}>{e.amount ? `$${e.amount}` : '—'}</td>
                                <td style={{ padding: '6px' }}>{e.transactionId || '—'}</td>
                                <td style={{ padding: '6px', color: e.verified ? '#3a7d44' : '#9b2c2c' }}>
                                    {e.verified ? `✓ verified (${e.matchedForm})` : '✗ not verified'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}

export default function IntegrationsPanel() {
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(null);
    const [withInvoice, setWithInvoice] = useState(false);
    const [email, setEmail] = useState('');
    const [amount, setAmount] = useState('1.00');

    const run = async () => {
        if (withInvoice && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
            setResult({ error: 'Enter the email address the test invoice should go to.' });
            return;
        }
        setBusy(true); setResult(null);
        try {
            const res = await httpsCallable(functions, 'nmiProbe')({
                testInvoice: withInvoice, email: email.trim(), amount,
            });
            setResult(res.data);
        } catch (e) {
            setResult({ error: e.message || String(e) });
        } finally { setBusy(false); }
    };

    return (
        <div>
            <h3 style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: '1.5rem', margin: '0 0 6px' }}>Integrations</h3>
            <p style={{ fontSize: '13px', color: 'var(--ink-soft)', margin: '0 0 18px' }}>
                Connection tests for the outside services the app talks to. They read only — nothing is charged,
                written or sent to NetSuite.
            </p>

            <div style={card}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
                    <span style={{ ...label, color: 'var(--brass)' }}>NMI · Payments</span>
                    <span style={{ padding: '3px 8px', fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.1em', background: '#9b6a2c', color: '#fff' }}>SANDBOX</span>
                </div>
                <p style={{ fontSize: '13px', color: 'var(--ink-soft)', margin: '0 0 12px' }}>
                    Checks the gateway key and connection for the sandbox merchant. No card data is sent.
                </p>

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', marginBottom: '10px' }}>
                    <input type="checkbox" checked={withInvoice} onChange={(e) => setWithInvoice(e.target.checked)} />
                    Also create a test invoice — this tells us whether NMI gives back a pay link we can put on our own PDFs
                </label>
                {withInvoice && (
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
                        <input style={{ ...input, minWidth: '240px' }} placeholder="Send the test invoice to…" value={email} onChange={(e) => setEmail(e.target.value)} />
                        <input style={{ ...input, width: '90px' }} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
                        <span style={{ fontSize: '12px', color: 'var(--ink-soft)', alignSelf: 'center' }}>Sandbox — nothing is charged, but a real email may arrive.</span>
                    </div>
                )}

                <button style={btn(true, busy)} disabled={busy} onClick={run}>{busy ? 'Testing…' : 'Test NMI Connection'}</button>

                {result && result.error && (
                    <div style={{ marginTop: '12px', fontSize: '13px', color: '#9b2c2c' }}>✗ {result.error}</div>
                )}
                {result && !result.error && (
                    <div style={{ marginTop: '14px', fontSize: '13px' }}>
                        <div style={{ ...label, marginBottom: '8px' }}>{result.environment}</div>
                        {(result.steps || []).map((s) => (
                            <div key={s.step} style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                                <span style={{ color: s.ok ? '#3a7d44' : '#9b2c2c' }}>{s.ok ? '✓' : '✗'} {s.step === 'credentials' ? 'Key & connection' : 'Test invoice'}</span>
                                <span style={{ color: 'var(--ink-soft)' }}> — {s.detail}</span>
                                {s.step === 'invoice' && s.ok && (
                                    <div style={{ marginTop: '6px', fontSize: '12px' }}>
                                        {s.payUrlReturned
                                            ? <>🔗 NMI returned a pay link we can put on our own documents: <a href={s.payUrl} target="_blank" rel="noreferrer">{s.payUrl}</a></>
                                            : <span style={{ color: '#9b6a2c' }}>⚠ No pay link came back in the response — NMI emails the link itself. Ask the rep whether a per-invoice URL can be returned to us.</span>}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <PaySettings />
            <WebhookEvents />

            <div style={{ ...card, background: 'var(--paper-2, #f2efe8)' }}>
                <span style={label}>UPS · Shipping</span>
                <p style={{ fontSize: '13px', color: 'var(--ink-soft)', margin: '8px 0 0' }}>
                    The UPS connection test lives on tab 9.5 (UPS Shipping), beside the rate calculator and the
                    live/test switch the WMS Fulfillment tab reads.
                </p>
            </div>
        </div>
    );
}
