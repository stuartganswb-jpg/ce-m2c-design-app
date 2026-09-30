import React, { useState } from 'react';
import { shipToError } from '../Shared/displayShipment';

// ── 📦 SHIP ONE DISPLAY (Stuart 2026-09-30: "fulfill one at a time (1/50 logic works) at $0.00 on new sales orders to the
// showrooms with custom shipping addresses" · "one per shipment" · the ship-to "need an entry point somewhere as it is always
// changing") ────────────────────────────────────────────────────────────────────────────────────────────────────────────
// The ship-to: a saved address (the customer's NetSuite addresses and the app's book) or a new one, saved to the book. The
// display's pieces, each ticked into the box; the box; the photo. Ship hands everything to PickPackApp.shipOneDisplay.
const blank = { addressee: '', attention: '', addr1: '', addr2: '', city: '', state: '', zip: '', country: 'US', phone: '' };
const DisplayShipModal = ({ theme, t = (s) => s, order, n, boards, share = [], shareWhy = '', saved = [], boxOptions = [], busy = false, onCancel, onShip }) => {
    const [pick, setPick] = useState('');                  // index into saved, or '' for a new address
    const [addr, setAddr] = useState(blank);
    const [checked, setChecked] = useState({});
    const [boxes, setBoxes] = useState({ SMALL: '', POLE: '' });
    const [files, setFiles] = useState([]);
    const choose = (v) => { setPick(v); setAddr(v === '' ? blank : { ...blank, ...saved[Number(v)] }); };
    const allIn = share.length > 0 && share.every((l, i) => checked[i]);
    const addrErr = shipToError(addr);
    const blocker = shareWhy || (!allIn ? 'tick every piece into the box' : (addrErr ? `ship-to: ${addrErr}` : (!boxes.SMALL && !boxes.POLE ? 'pick the box' : (!files.length ? 'add the photo of the packed display' : ''))));
    const field = (k, label, w = '100%') => (
        <label style={{ display: 'block', width: w }}>
            <span style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.08em' }}>{t(label)}</span>
            <input value={addr[k] || ''} onChange={e => setAddr(a => ({ ...a, [k]: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px', border: `1px solid ${theme.line}`, fontFamily: theme.sans, fontSize: '0.9rem', outline: 'none' }} />
        </label>
    );
    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.8)', zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: '#fff', padding: '32px', width: 'min(920px, 96vw)', maxHeight: '92vh', overflowY: 'auto', border: `1px solid ${theme.line}` }}>
                <h2 style={{ margin: '0 0 4px 0', fontFamily: theme.serif, fontSize: '1.8rem', color: theme.ink }}>📦 {t('Ship one display')}</h2>
                <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: '20px' }}>
                    {order.customer} · SO {order.soId} · {t('display')} {n} {t('of')} {boards} · {t('from')} {order.committedBin} · $0 {t('on its own sales order')}
                </div>

                <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.ink, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>1 · {t('Ship to')}</div>
                <select value={pick} onChange={e => choose(e.target.value)} style={{ width: '100%', padding: '10px', border: `1px solid ${theme.line}`, fontFamily: theme.sans, marginBottom: '10px' }}>
                    <option value="">＋ {t('New address')}</option>
                    {saved.map((a, i) => <option key={i} value={String(i)}>{a.addressee} — {a.addr1}, {a.city} {a.state}{a.from === 'book' ? '' : ' (NetSuite)'}</option>)}
                </select>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '20px' }}>
                    {field('addressee', 'Showroom / addressee', 'calc(60% - 5px)')}{field('attention', 'Attention', 'calc(40% - 5px)')}
                    {field('addr1', 'Street', 'calc(60% - 5px)')}{field('addr2', 'Suite / unit', 'calc(40% - 5px)')}
                    {field('city', 'City', 'calc(40% - 7px)')}{field('state', 'State', 'calc(20% - 6px)')}{field('zip', 'Zip', 'calc(20% - 6px)')}{field('phone', 'Phone', 'calc(20% - 6px)')}
                </div>

                <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.ink, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>2 · {t('Into the box')} — {t('one display')}</div>
                {shareWhy ? <div style={{ color: '#c0392b', fontFamily: theme.sans, fontSize: '0.9rem', marginBottom: '16px' }}>⛔ {shareWhy}</div> : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '8px' }}>
                        <tbody>
                            {share.map((l, i) => (
                                <tr key={i} onClick={() => setChecked(c => ({ ...c, [i]: !c[i] }))} style={{ cursor: 'pointer', background: checked[i] ? '#f3faf3' : '#fff', borderBottom: `1px solid ${theme.paper2}` }}>
                                    <td style={{ padding: '7px 8px', width: '28px' }}><input type="checkbox" readOnly checked={!!checked[i]} /></td>
                                    <td style={{ padding: '7px 8px', fontFamily: theme.mono, fontSize: '12px' }}>{l.code}</td>
                                    <td style={{ padding: '7px 8px', fontFamily: theme.sans, fontSize: '0.85rem', color: theme.inkSoft }}>{l.name}{l.row ? ` · ${l.row}` : ''}</td>
                                    <td style={{ padding: '7px 8px', fontFamily: theme.mono, fontSize: '13px', textAlign: 'right' }}>× {l.pieces}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
                {!shareWhy && <button type="button" onClick={() => setChecked(Object.fromEntries(share.map((_, i) => [i, !allIn])))} style={{ marginBottom: '20px', padding: '6px 12px', background: 'transparent', border: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', cursor: 'pointer' }}>{allIn ? t('Untick all') : t('Tick all — every piece is in the box')}</button>}

                <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.ink, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>3 · {t('Box and photo')}</div>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '24px' }}>
                    {['SMALL', 'POLE'].map(k => (
                        <select key={k} value={boxes[k]} onChange={e => setBoxes(b => ({ ...b, [k]: e.target.value }))} style={{ padding: '10px', border: `1px solid ${theme.line}`, fontFamily: theme.sans }}>
                            <option value="">{k === 'SMALL' ? t('Small parts box') : t('Pole box')} —</option>
                            {boxOptions.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
                        </select>
                    ))}
                    <label style={{ padding: '10px 14px', border: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', cursor: 'pointer' }}>
                        📷 {files.length ? `${files.length} ${t('photo(s)')}` : t('Add photo (required)')}
                        <input type="file" accept="image/*" capture="environment" multiple style={{ display: 'none' }} onChange={e => setFiles(Array.from(e.target.files || []))} />
                    </label>
                </div>

                <div style={{ display: 'flex', gap: '16px', justifyContent: 'flex-end', alignItems: 'center' }}>
                    {blocker && <span style={{ marginRight: 'auto', color: '#c0392b', fontFamily: theme.sans, fontSize: '0.85rem' }}>{t('Waits for')}: {blocker}</span>}
                    <button onClick={onCancel} disabled={busy} style={{ padding: '14px 26px', background: 'transparent', border: `1px solid ${theme.line}`, cursor: 'pointer', fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase' }}>{t('Cancel')}</button>
                    <button onClick={() => onShip({ shipTo: addr, isNew: pick === '', boxes, files })} disabled={!!blocker || busy}
                        style={{ padding: '14px 26px', background: blocker || busy ? theme.paper : '#2e7d32', color: blocker || busy ? theme.inkSoft : '#fff', border: 'none', cursor: blocker || busy ? 'not-allowed' : 'pointer', fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                        {busy ? t('Shipping…') : `📦 ${t('Ship display')} ${n}`}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DisplayShipModal;
