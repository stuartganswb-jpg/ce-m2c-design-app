// THE WMS TRAVERSE STATION TAB (Shared/traverseStation, Stuart 2026-10-07): "once finishing is complete then we can
// alert the traverse station that the order is ready and give them the pick list so they can check and confirm, and
// actually load the tracks with the components and confirm the tracks/rods are loaded then the order can be packed."
//
// Mounted once in PickPackApp, which works out the orders (it holds the sales orders, the floor documents and the
// Library) and owns every write: the shelf pick into the order's bin is ITS pickShelfIntoOrder — the same NetSuite bin
// transfer SO Pack makes — and the confirmations are its handlers. This file is the screen.
//   ORDER ENTRY order  pick the track parts (for the displays released) → confirm how many displays are LOADED.
//   CPQ order          tick each track part as picked → confirm the tracks loaded (lifts the gate on its documents).
import React, { useState } from 'react';

const num = (v) => Number(v) || 0;

export default function TraverseStationTab({ orders = [], theme, t = (x) => x, busy = false, onPick, onConfirmLoaded, onConfirmCpq, anyTagged = true }) {
    const [loadN, setLoadN] = useState({});       // order id → the count typed for "displays loaded"
    const [ticked, setTicked] = useState({});     // CPQ: `${orderId}|${code}` → picked
    const label = { fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.12em', textTransform: 'uppercase', color: theme.inkSoft };
    const btn = (primary, on = true) => ({ padding: '9px 14px', background: primary && on ? '#2e7d32' : 'transparent', color: primary && on ? '#fff' : (on ? theme.ink : theme.inkSoft), border: `1px solid ${primary && on ? '#2e7d32' : theme.line}`, fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', cursor: on ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap' });
    const th = (h, align = 'left') => <th key={h} style={{ textAlign: align, padding: '7px 10px', ...label, borderBottom: `1px solid ${theme.line}`, whiteSpace: 'nowrap' }}>{t(h)}</th>;
    const td = { padding: '8px 10px', borderBottom: `1px solid ${theme.paper2}`, fontSize: '0.85rem', verticalAlign: 'middle' };
    const ready = orders.filter(o => o.ready), coming = orders.filter(o => !o.ready);

    const card = (o) => {
        const isOe = o.kind === 'OE';
        const st = o.st || null;
        const units = isOe ? st.units : 1;
        const allTicked = !isOe && o.lines.every(r => r.pick === 0 || ticked[`${o.id}|${r.code}`]);
        const typed = loadN[o.id] != null ? loadN[o.id] : (isOe ? String(st.canLoadTo) : '');
        return (
            <div key={`${o.kind}-${o.id}`} style={{ border: `1px solid ${o.ready ? theme.ink : theme.line}`, background: '#fff', marginBottom: '16px', opacity: o.ready ? 1 : 0.75 }}>
                <div style={{ padding: '12px 16px', borderBottom: `1px solid ${theme.line}`, background: theme.paper, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <div>
                        <span style={{ fontFamily: theme.serif, fontSize: '1.15rem', color: theme.ink, fontWeight: 500 }}>{o.customer || 'Customer'}</span>
                        <span style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, marginLeft: '12px' }}>{o.ref}{o.jobName ? ` · ${o.jobName}` : ''}</span>
                        {o.needBy && <span style={{ fontFamily: theme.mono, fontSize: '10px', fontWeight: 700, color: '#d9534f', marginLeft: '12px' }}>{t('NEED BY')} {o.needBy}</span>}
                        {o.bin && <span style={{ fontFamily: theme.mono, fontSize: '10px', fontWeight: 700, color: '#2e7d32', marginLeft: '12px' }}>📦 {t('BIN')} {o.bin}</span>}
                    </div>
                    <span style={{ fontFamily: theme.mono, fontSize: '10px', fontWeight: 700, letterSpacing: '.1em', color: o.ready ? '#2e7d32' : theme.brass }}>
                        {o.ready ? `🧵 ${t('READY FOR THE TRAVERSE STATION')}` : `${t('still in finishing')} — ${(o.waitingDocs || []).slice(0, 4).join(', ')}${(o.waitingDocs || []).length > 4 ? '…' : ''}`}
                    </span>
                </div>

                {/* 1 — THE PICK LIST: the parts loaded onto the track */}
                <div style={{ padding: '12px 16px 4px', ...label }}>1 · {t('Pick list — the parts loaded onto the track')}{isOe && units > 1 ? ` · ${st.releasedUnits} ${t('of')} ${units} ${t('displays released')}` : ''}</div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr style={{ background: theme.paper2 }}>
                        {th('Item #')}{th('Description')}{isOe ? <>{th('Needed now', 'center')}{th(o.bin ? `In ${o.bin}` : 'In the bin', 'center')}{th('To pick', 'center')}</> : <>{th('Qty', 'center')}{th('From', 'left')}</>}{th('')}
                    </tr></thead>
                    <tbody>
                        {(isOe ? st.lines : o.lines).map(r => (
                            <tr key={r.code}>
                                <td style={{ ...td, fontFamily: theme.mono, color: theme.ink, whiteSpace: 'nowrap' }}>{r.code}</td>
                                <td style={{ ...td, color: theme.inkSoft }}>{r.name}{isOe && units > 1 ? <span style={{ fontFamily: theme.mono, fontSize: '10px' }}> · {r.perUnit} / {t('display')}</span> : null}</td>
                                {isOe ? (<>
                                    <td style={{ ...td, textAlign: 'center', fontFamily: theme.mono }}>{r.need}</td>
                                    <td style={{ ...td, textAlign: 'center', fontFamily: theme.mono, fontWeight: 700, color: r.have >= r.need && r.need > 0 ? '#2e7d32' : theme.ink }}>{r.have}</td>
                                    <td style={{ ...td, textAlign: 'center', fontFamily: theme.mono, fontWeight: 700, color: r.toPick ? '#c0392b' : theme.inkSoft }}>{r.toPick || '—'}</td>
                                    <td style={{ ...td, textAlign: 'right' }}>{r.toPick > 0 && <button disabled={busy || !o.ready} onClick={() => onPick(o, r.code)} title={`Pick ${r.toPick} × ${r.code} from the shelf into the order's bin — a NetSuite bin transfer`} style={btn(false, !busy && o.ready)}>⤓ {t('Pick')}</button>}</td>
                                </>) : (<>
                                    <td style={{ ...td, textAlign: 'center', fontFamily: theme.mono }}>{r.qty}</td>
                                    <td style={{ ...td, fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft }}>{r.pick > 0 ? `${t('shelf')} × ${r.pick}` : ''}{r.pick > 0 && r.qty - r.pick > 0 ? ' · ' : ''}{r.qty - r.pick > 0 ? `${t('from finishing')} × ${r.qty - r.pick}` : ''}</td>
                                    <td style={{ ...td, textAlign: 'right' }}>
                                        <label style={{ fontFamily: theme.mono, fontSize: '10px', cursor: o.ready ? 'pointer' : 'not-allowed', color: ticked[`${o.id}|${r.code}`] ? '#2e7d32' : theme.ink }}>
                                            <input type="checkbox" disabled={!o.ready} checked={!!ticked[`${o.id}|${r.code}`]} onChange={e => setTicked(p => ({ ...p, [`${o.id}|${r.code}`]: e.target.checked }))} style={{ marginRight: '6px' }} />{t('have it')}
                                        </label>
                                    </td>
                                </>)}
                            </tr>
                        ))}
                    </tbody>
                </table>
                {isOe && st.toPick > 0 && (
                    <div style={{ padding: '10px 16px', textAlign: 'right' }}>
                        <button disabled={busy || !o.ready} onClick={() => onPick(o, null)} style={btn(true, !busy && o.ready)} title="Pick every track part still missing from the order's bin — NetSuite bin transfers into it">⤓ {t('Pick all into')} {o.bin || t('the order\'s bin')} ({st.lines.filter(r => r.toPick > 0).length})</button>
                    </div>
                )}

                {/* 2 — THE TRACKS / RODS BEING LOADED */}
                {(o.tracks || []).length > 0 && (<>
                    <div style={{ padding: '12px 16px 4px', ...label }}>2 · {t('Load onto')}</div>
                    <div style={{ padding: '0 16px 8px' }}>
                        {o.tracks.map((k, i) => (
                            <div key={i} style={{ fontFamily: theme.mono, fontSize: '12px', color: theme.ink, padding: '3px 0' }}>
                                <b>{k.code}</b>{k.name ? <span style={{ color: theme.inkSoft }}> · {k.name}</span> : null}{k.cutLength ? ` · ${k.cutLength}"` : ''}{k.display ? ` · ${k.display}` : ''} · × {isOe && units > 1 ? `${num(k.qty) / units} / ${t('display')}` : k.qty}{k.row ? <span style={{ color: theme.inkSoft }}> · {k.row}</span> : null}
                            </div>
                        ))}
                    </div>
                </>)}

                {/* 3 — CONFIRM LOADED */}
                <div style={{ padding: '12px 16px', borderTop: `1px solid ${theme.line}`, display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', background: theme.paper }}>
                    {isOe ? (<>
                        <span style={{ marginRight: 'auto', fontFamily: theme.mono, fontSize: '11px', color: theme.ink }}>
                            <b>{st.loaded}</b> {t('of')} {st.releasedUnits} {units > 1 ? t('released displays loaded') : t('loaded')}{st.shipped ? ` · ${st.shipped} ${t('shipped')}` : ''}
                            {st.canLoadTo > st.loaded ? <span style={{ color: '#2e7d32' }}> · {t('parts in the bin for')} {st.canLoadTo}</span> : null}
                        </span>
                        {units > 1 ? (<>
                            <label style={{ ...label, display: 'flex', alignItems: 'center', gap: '8px' }}>{t('Displays loaded, in all')}
                                <input value={typed} onChange={e => setLoadN(p => ({ ...p, [o.id]: e.target.value.replace(/[^0-9]/g, '') }))} inputMode="numeric" style={{ width: '64px', padding: '8px', border: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '0.95rem', textAlign: 'center' }} />
                            </label>
                            <button disabled={busy || !o.ready || typed === '' || num(typed) === st.loaded} onClick={() => onConfirmLoaded(o, num(typed))} style={btn(true, !busy && o.ready && typed !== '' && num(typed) !== st.loaded)}>✓ {t('Confirm loaded')}</button>
                        </>) : (
                            <button disabled={busy || !o.ready || st.loaded >= 1 || st.canLoadTo < 1} onClick={() => onConfirmLoaded(o, 1)} style={btn(true, !busy && o.ready && st.loaded < 1 && st.canLoadTo >= 1)} title={st.canLoadTo < 1 ? 'Pick the track parts first' : undefined}>✓ {st.loaded >= 1 ? t('Loaded') : t('Tracks loaded — release to packing')}</button>
                        )}
                    </>) : (<>
                        <span style={{ marginRight: 'auto', fontFamily: theme.mono, fontSize: '11px', color: theme.ink }}>{o.docs.length} {t('work order(s) of this order wait on this')}: {o.docs.map(d => d.ref).join(', ')}</span>
                        <button disabled={busy || !o.ready || !allTicked} onClick={() => onConfirmCpq(o)} style={btn(true, !busy && o.ready && allTicked)} title={!allTicked ? 'Tick each part on the pick list first' : undefined}>✓ {t('Tracks loaded — release to packing')}</button>
                    </>)}
                </div>
            </div>
        );
    };

    return (
        <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '30px', minHeight: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
            <div style={{ fontFamily: theme.serif, color: theme.ink, fontWeight: 500, fontSize: '1.4rem', marginBottom: '6px' }}>{t('Traverse station')}</div>
            <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, letterSpacing: '.05em', marginBottom: '22px' }}>{t('Orders with parts loaded onto the track. After finishing: pick the parts, load the tracks, confirm — then the order can pack.')}</div>
            {!anyTagged && <div style={{ padding: '12px 14px', marginBottom: '18px', border: `1px solid ${theme.brass}`, background: '#fdf6e3', fontFamily: theme.sans, fontSize: '0.88rem', color: theme.ink }}>{t('No item is marked "Loaded onto the track" yet. Tick it on the carriers, master carriers, end stops, pulleys and batons in HQ → Master Library (the item drawer) — orders with those parts then come here.')}</div>}
            {orders.length === 0 && <div style={{ color: theme.inkSoft, fontStyle: 'italic', fontFamily: theme.serif }}>{t('Nothing for the traverse station right now.')}</div>}
            {ready.map(card)}
            {coming.length > 0 && (<>
                <div style={{ ...label, margin: '26px 0 12px' }}>{t('Coming — still in finishing')} · {coming.length}</div>
                {coming.map(card)}
            </>)}
        </div>
    );
}
