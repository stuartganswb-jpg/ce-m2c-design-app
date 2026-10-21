// 🌍 LIVE RATE CHECK — HQ 9.5 (Stuart 2026-10-21: "check live negotiated rates for international
// shipments, not using the uploaded agreement but actually using their system for live check").
//
// The rest of 9.5 reads the uploaded agreement — a table. This asks UPS, on the brand's own account,
// and shows the PUBLISHED and the NEGOTIATED figure side by side.
//
// The table stays, deliberately: the comparison is the useful part. When UPS's live answer and the
// uploaded agreement disagree, the agreement has drifted, and that is worth seeing rather than
// discovering on an invoice.
import React, { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { doc, onSnapshot } from 'firebase/firestore';
import { functions, db } from '../../firebase';
import { addressBookOf } from './UpsAddressBook';

const mono = { fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-soft)' };
const input = { padding: '9px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', width: '100%', boxSizing: 'border-box' };
const usd = (v) => (v === null || v === undefined ? '—' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

const BRANDS = [['ce', 'Classical Elements'], ['uniquity', "Uniq'uity (MC America)"], ['m2c', 'M2C Studio'], ['leyla', 'Leyla']];

export default function UpsLiveRatePanel() {
    const [brand, setBrand] = useState('ce');
    // OUR OWN DOCK unless a supplier is chosen. An INBOUND quote is a supplier here and us in To —
    // and because either end abroad makes it international, it is quoted on the right account
    // (Stuart 2026-10-21: "an order ready in china … from our supplier address to us").
    const [from, setFrom] = useState(null);
    const [to, setTo] = useState({ addressee: '', addr1: '', city: '', state: '', zip: '', country: 'GB' });
    const [book, setBook] = useState([]);
    useEffect(() => onSnapshot(doc(db, 'system', 'ups_config'),
        (s2) => setBook(addressBookOf(s2.exists() ? s2.data() : {})), () => setBook([])), []);
    const [pkg, setPkg] = useState({ length: '12', width: '12', height: '12', weight: '5' });
    const [declaredValue, setDeclaredValue] = useState('');
    const [res, setRes] = useState(null);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');

    const run = async () => {
        setBusy(true); setErr(''); setRes(null);
        try {
            const r = await httpsCallable(functions, 'upsRate')({
                brand, shipTo: to, ...(from ? { shipFrom: from } : {}),
                packages: [{ length: Number(pkg.length), width: Number(pkg.width), height: Number(pkg.height), weight: Number(pkg.weight) }],
                ...(Number(declaredValue) > 0 ? { declaredValue: Number(declaredValue) } : {}),
            });
            setRes(r.data);
        } catch (e) { setErr(e.message || String(e)); }
        finally { setBusy(false); }
    };

    const set = (k) => (e) => setTo({ ...to, [k]: e.target.value });

    return (
        <div style={{ border: '1px solid var(--line)', background: '#fff', padding: '20px', marginTop: '16px' }}>
            <div style={{ ...mono, color: 'var(--brass)', marginBottom: '6px' }}>🌍 Live rate check — UPS's own system</div>
            <p style={{ fontSize: '0.88rem', color: 'var(--ink-soft)', margin: '0 0 14px' }}>
                Asks UPS directly, on the brand's own account, and shows what they publish beside what we actually pay.
                A destination outside the US is quoted on that brand's <strong>international</strong> account. Nothing is
                shipped and nothing is recorded — this only asks.
            </p>

            {/* FROM — ours, or a saved supplier. Picking one is the whole point of the list. */}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '12px', background: 'var(--paper-2)', padding: '10px 12px', border: '1px solid var(--line)' }}>
                <span style={{ ...mono }}>From</span>
                <select
                    style={{ ...input, maxWidth: '280px' }}
                    value={from ? String(from.__i) : ''}
                    onChange={(e) => {
                        const i = e.target.value;
                        setFrom(i === '' ? null : { ...book[Number(i)], __i: Number(i) });
                    }}
                >
                    <option value="">Our own dock (outbound)</option>
                    {book.map((a, i) => <option key={i} value={i}>{a.label || a.city || `Address ${i + 1}`}{a.country ? ` · ${a.country}` : ''}</option>)}
                </select>
                <span style={{ fontSize: '12px', color: 'var(--ink-soft)' }}>
                    {from ? 'Inbound — quoted on the international account, billed to us.' : 'Leaving our building.'}
                </span>
                {/* The From box can only hold a SAVED address, so swapping a typed To into it would
                    read "our own dock" while a supplier was being quoted. Offered only when both
                    ends can be shown truthfully. */}
                <button
                    type="button"
                    disabled={to.__i === undefined}
                    onClick={() => { const i = to.__i; setTo(from ? { ...from } : to); setFrom({ ...book[i], __i: i }); }}
                    style={{ ...mono, padding: '6px 11px', background: 'transparent', border: '1px solid var(--line)', cursor: to.__i === undefined ? 'not-allowed' : 'pointer', color: 'var(--ink)', opacity: to.__i === undefined ? 0.4 : 1 }}
                    title={to.__i === undefined ? 'Pick a saved address in To first — a typed one cannot be shown in the From list.' : 'Swap the two ends'}
                >⇄ Swap</button>
            </div>

            {/* TO — typed, or filled from the list in one click. */}
            {book.length > 0 && (
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
                    <span style={{ ...mono }}>To</span>
                    <select
                        style={{ ...input, maxWidth: '280px' }} value=""
                        onChange={(e) => { const i = e.target.value; if (i !== '') setTo({ ...book[Number(i)], __i: Number(i) }); }}
                    >
                        <option value="">Fill from a saved address…</option>
                        {book.map((a, i) => <option key={i} value={i}>{a.label || a.city || `Address ${i + 1}`}{a.country ? ` · ${a.country}` : ''}</option>)}
                    </select>
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', marginBottom: '10px' }}>
                <div><div style={{ ...mono, marginBottom: '4px' }}>Brand</div>
                    <select style={input} value={brand} onChange={(e) => setBrand(e.target.value)}>
                        {BRANDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select></div>
                <div><div style={{ ...mono, marginBottom: '4px' }}>Country</div>
                    <input style={input} value={to.country} onChange={set('country')} placeholder="GB" maxLength={2} /></div>
                <div><div style={{ ...mono, marginBottom: '4px' }}>Name / company</div>
                    <input style={input} value={to.addressee} onChange={set('addressee')} placeholder="A Customer Ltd" /></div>
                <div><div style={{ ...mono, marginBottom: '4px' }}>Street</div>
                    <input style={input} value={to.addr1} onChange={set('addr1')} placeholder="1 High Street" /></div>
                <div><div style={{ ...mono, marginBottom: '4px' }}>City</div>
                    <input style={input} value={to.city} onChange={set('city')} placeholder="London" /></div>
                <div><div style={{ ...mono, marginBottom: '4px' }}>State / province</div>
                    <input style={input} value={to.state} onChange={set('state')} placeholder="only where used" /></div>
                <div><div style={{ ...mono, marginBottom: '4px' }}>Postal code</div>
                    <input style={input} value={to.zip} onChange={set('zip')} placeholder="SW1A 1AA" /></div>
                <div><div style={{ ...mono, marginBottom: '4px' }}>Value for customs</div>
                    <input style={input} value={declaredValue} onChange={(e) => setDeclaredValue(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="USD" /></div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '10px', marginBottom: '12px' }}>
                {[['length', 'Length in'], ['width', 'Width in'], ['height', 'Height in'], ['weight', 'Weight lb']].map(([k, lab]) => (
                    <div key={k}><div style={{ ...mono, marginBottom: '4px' }}>{lab}</div>
                        <input style={input} value={pkg[k]} onChange={(e) => setPkg({ ...pkg, [k]: e.target.value.replace(/[^0-9.]/g, '') })} /></div>
                ))}
            </div>

            <button onClick={run} disabled={busy} style={{ ...mono, padding: '11px 20px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: busy ? 'wait' : 'pointer' }}>
                {busy ? 'Asking UPS…' : 'Check live rates'}
            </button>

            {err && <div style={{ fontSize: '13px', color: '#9b2c2c', marginTop: '12px' }}>✗ {err}</div>}

            {res && (
                <div style={{ marginTop: '16px' }}>
                    {/* SAY WHICH ACCOUNT ANSWERED. A rate is only meaningful beside the account that
                        gave it, and a reader should never have to assume which one that was. */}
                    <div style={{ ...mono, marginBottom: '8px' }}>
                        {res.environment} · {res.shipperName} · account {res.account}
                        {res.international ? ' · INTERNATIONAL' : ' · domestic'}{res.inbound ? ' · INBOUND' : ''}
                        {res.declaredValueSent ? ` · value ${usd(res.declaredValueSent)}` : ''}
                    </div>
                    {res.environment !== 'PRODUCTION' && (
                        <div style={{ fontSize: '12.5px', color: '#9b6a2c', marginBottom: '8px' }}>
                            ⚠ UPS is in TEST — these figures are invented by UPS's test system and are not your rates.
                        </div>
                    )}
                    {!res.services.length && <div style={{ fontSize: '13px', color: 'var(--ink-soft)' }}>UPS returned no services for that address.</div>}
                    {res.services.length > 0 && (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                            <thead><tr>
                                <th style={{ textAlign: 'left', padding: '6px 0', borderBottom: '1px solid var(--line)', fontWeight: 500 }}>Service</th>
                                <th style={{ textAlign: 'right', padding: '6px 0', borderBottom: '1px solid var(--line)', fontWeight: 500 }}>Published</th>
                                <th style={{ textAlign: 'right', padding: '6px 0', borderBottom: '1px solid var(--line)', fontWeight: 500 }}>Negotiated</th>
                                <th style={{ textAlign: 'right', padding: '6px 0', borderBottom: '1px solid var(--line)', fontWeight: 500 }}>Days</th>
                            </tr></thead>
                            <tbody>
                                {res.services.map((s) => (
                                    <tr key={s.code}>
                                        <td style={{ padding: '7px 0' }}>{s.name}</td>
                                        <td style={{ padding: '7px 0', textAlign: 'right', color: 'var(--ink-soft)' }}>{usd(s.published)}</td>
                                        <td style={{ padding: '7px 0', textAlign: 'right', fontWeight: 600, color: s.negotiated === null ? 'var(--ink-soft)' : '#3a7d44' }}>{usd(s.negotiated)}</td>
                                        <td style={{ padding: '7px 0', textAlign: 'right', color: 'var(--ink-soft)' }}>{s.businessDays || '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                    {/* A NEGOTIATED COLUMN OF DASHES MEANS SOMETHING, so it says what. */}
                    {res.services.length > 0 && res.services.every((s) => s.negotiated === null) && (
                        <div style={{ fontSize: '12.5px', color: '#9b6a2c', marginTop: '10px' }}>
                            UPS returned no negotiated rates for this account — published only. That usually means the
                            account has no negotiated agreement loaded, or the rates are not enabled for it.
                        </div>
                    )}
                    {(res.alerts || []).length > 0 && (
                        <div style={{ fontSize: '12px', color: 'var(--ink-soft)', marginTop: '10px' }}>
                            {res.alerts.map((a, i) => <div key={i}>UPS: {a}</div>)}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
