// PACKAGING PREP — A STOCK RUN (Stuart 2026-10-08): "packaging prep is really where the finished products are wrapped
// and placed in their individual product packaging … stock orders should operate pretty much like it does now, no
// picture required, just pack into each products set packaging (we will add images of proper packaging for each
// product) and then the user commits that they finished packing the products then they need to scan the items into
// their shelf bin to confirm they put it in the correct places."
//
// Mounted once in PickPackApp's Packaging Prep tab, on a stock run's card. This file is the screen; it writes nothing:
//   1 · PRODUCT PACKAGING  the item's packaging picture(s) and note (Shared/productPackaging — the item's own, else
//                          its base item's), and whether the packer has confirmed the packaging (the line's tick).
//   2 · PUT AWAY           the ITEM label, then the BIN label (Shared/putAwayScan). The boxes are PickPackApp's state,
//                          and its completePacking checks them again before anything is posted.
// The bin box starts EMPTY — the expected bin is words beside it, never a value the packer can accept unscanned.
// The card shows the two halves either side of the line the packer ticks: `show="packaging"` above it, `show="putaway"`
// beneath — the order the work is done in.
import React, { useEffect, useRef } from 'react';
import { PUT_AWAY_STEP } from '../Shared/putAwayScan';

const when = (ms) => (ms ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');

export default function StockPutAwayPanel({
    theme, t = (x) => x, show = 'both', itemCode = '', qtyText = '', packaging = null, packagedTick = null, mine = false, step = PUT_AWAY_STEP.PACKAGE,
    itemScan = '', onItemScan = () => {}, itemState = null, bin = '', onBin = () => {}, expectedText = '',
}) {
    const showPackaging = show !== 'putaway', showPutAway = show !== 'packaging';
    const itemRef = useRef(null), binRef = useRef(null);
    const packaged = !!packagedTick;
    const pk = packaging || { images: [], note: '', imagesFrom: '', noteFrom: '', any: false };
    const st = itemState || { ok: false, empty: true, code: '', msg: '' };
    // The scanner follows the work: the item box when the packaging is confirmed, the bin box once the item is right.
    useEffect(() => {
        if (!mine) return;
        if (step === PUT_AWAY_STEP.ITEM && itemRef.current) itemRef.current.focus();
        if (step === PUT_AWAY_STEP.BIN && binRef.current) binRef.current.focus();
    }, [step, mine]);

    const label = { fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.12em', textTransform: 'uppercase', color: theme.inkSoft };
    const open = packaged && mine;
    const box = (on, good, bad) => ({ padding: '11px 12px', border: `1px solid ${bad ? '#d9534f' : (good ? '#3a7d44' : (on ? theme.ink : theme.line))}`, background: on ? '#fff' : theme.paper2, fontFamily: theme.mono, fontSize: '1rem', outline: 'none', width: '100%', boxSizing: 'border-box', textTransform: 'uppercase' });
    const from = (code) => (code ? <span style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.inkSoft, letterSpacing: '.04em' }}> · {t('as for')} {code}</span> : null);

    return (
        <div style={{ border: `1px solid ${theme.line}`, background: '#fff', marginBottom: '16px' }}>
            {/* 1 — HOW THIS PRODUCT IS PACKAGED */}
            {showPackaging && <div style={{ padding: '12px 16px', borderBottom: showPutAway ? `1px solid ${theme.line}` : 'none' }}>
                <div style={{ ...label, marginBottom: '10px', display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                    <span>1 · {t('Product packaging')} — <b style={{ color: theme.ink }}>{itemCode}</b>{qtyText ? ` · ${qtyText}` : ''}</span>
                    {packaged
                        ? <span style={{ color: '#3a7d44', fontWeight: 700 }}>✓ {t('Packaging finished')}{packagedTick.by ? ` · ${packagedTick.by}` : ''}{packagedTick.at ? ` · ${when(packagedTick.at)}` : ''}</span>
                        : <span style={{ color: theme.brass, fontWeight: 700 }}>{t('pack each one as shown, then ✓ Packaging finished on the line below')}</span>}
                </div>
                {pk.any ? (
                    <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        {pk.images.length > 0 && (
                            <div>
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                    {pk.images.map((u, i) => (
                                        <img key={u} src={u} alt={`${t('packaging')} ${i + 1}`} title={t('Tap to enlarge')} onClick={() => window.open(u, '_blank')}
                                            style={{ height: '120px', width: '160px', objectFit: 'cover', border: `1px solid ${theme.line}`, cursor: 'zoom-in', background: theme.paper }} />
                                    ))}
                                </div>
                                {from(pk.imagesFrom)}
                            </div>
                        )}
                        {pk.note && (
                            <div style={{ flex: 1, minWidth: '220px', padding: '10px 12px', background: theme.paper, borderLeft: `3px solid ${theme.brass}`, fontFamily: theme.sans, fontSize: '0.95rem', color: theme.ink, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
                                {pk.note}{from(pk.noteFrom)}
                            </div>
                        )}
                    </div>
                ) : (
                    <div style={{ fontFamily: theme.sans, fontSize: '0.85rem', color: theme.inkSoft, fontStyle: 'italic' }}>
                        {t('No packaging picture on file for')} {itemCode} — {t('add one in the Master Library: the item\'s drawer → Product packaging')}.
                    </div>
                )}
            </div>}

            {/* 2 — INTO ITS SHELF BIN, BY SCAN */}
            {showPutAway && <div style={{ padding: '12px 16px', background: open ? '#fff' : theme.paper, opacity: packaged ? 1 : 0.7 }}>
                <div style={{ ...label, marginBottom: '10px' }}>
                    2 · {t('Put away — scan the item, then the shelf bin it went into')}
                    {!packaged && <span style={{ color: theme.brass, textTransform: 'none', letterSpacing: 0 }}> — {t('opens when the packaging is finished')}</span>}
                    {packaged && !mine && <span style={{ color: theme.brass, textTransform: 'none', letterSpacing: 0 }}> — {t('start packing to scan')}</span>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px', alignItems: 'start' }}>
                    <div>
                        <div style={{ ...label, fontSize: '9px', marginBottom: '4px' }}>{t('Item label')}</div>
                        <input ref={itemRef} value={itemScan} disabled={!open} onChange={e => onItemScan(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && st.ok && binRef.current) binRef.current.focus(); }}
                            placeholder={open ? t('SCAN THE ITEM LABEL…') : ''} autoComplete="off" spellCheck={false}
                            style={box(open, st.ok, !st.empty && !st.ok)} />
                        <div style={{ fontFamily: theme.sans, fontSize: '0.82rem', marginTop: '5px', minHeight: '1.2em', color: st.ok ? '#3a7d44' : '#c0392b' }}>
                            {st.ok ? `✓ ${st.code} — ${t('this run\'s item')}` : (st.empty ? '' : `✖ ${st.msg}`)}
                        </div>
                    </div>
                    <div>
                        <div style={{ ...label, fontSize: '9px', marginBottom: '4px' }}>{t('Bin label')}</div>
                        <input ref={binRef} value={bin} disabled={!open} onChange={e => onBin(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                            placeholder={open ? t('SCAN THE BIN LABEL…') : ''} autoComplete="off" spellCheck={false}
                            style={box(open, false, false)} />
                        <div style={{ fontFamily: theme.sans, fontSize: '0.82rem', marginTop: '5px', color: theme.inkSoft }}>{expectedText}</div>
                    </div>
                </div>
            </div>}
        </div>
    );
}
