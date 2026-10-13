// ── 7. QUICK SHIP → CURTAINS, THE QUICK SELL (M2C Studio · 2026-10-12) ───────────────────────────────
//
// Stuart: "the curtains are sold by the fabric selection, then the pleat style (pinch pleat, grommet
// pleat, or ripplefold) then the width group, and finally the length group, the width we order in the
// group, the length we order to the inch but pay in the length range." Tiles, as the Uniquity quick
// sell: the fabric's swatch → the top style → the lining (only what that fabric is offered in) → the
// width group → the length typed to the inch → how many panels. The answer is ONE LINE of the workroom's
// chart (Shared/curtainPricing): its price, and its sheet and row — "our work room when we send an order
// would want us to reference the appropriate line for dimensions, fabric, style, lined or unlined."
//
// TODAY THIS IS THE FINDER: it prices the curtain and names the workroom's line. Add to cart stays off
// until the workroom order route exists — a curtain is bought to order from an outside workroom, and
// Order Entry has no start for such a line yet (it would read as a shelf pick and sit on backorder).
// The chart is `system/curtain_pricing` (6.5 Tools → Curtain Pricing); the swatches are Asset Gallery
// pictures. M2C only; mounted by QuickShipTab under one guard. Reads only — no document is written.
import React, { useEffect, useMemo, useState } from 'react';
import { db } from '../../firebase';
import { doc, onSnapshot, collection, query, where, getDocs } from 'firebase/firestore';
import {
    CURTAIN_PRICING_DOC, CURTAIN_BRAND, hasCurtainChart, curtainStylesOf, curtainFabricsOf, curtainLiningsOf, curtainGroupsOf,
    curtainQuoteOf, workroomRefOf, curtainOrderTextOf, curtainSwatchesOf, swatchQueryTypesOf,
} from '../Shared/curtainPricing';

const mono = { fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-soft)' };
const lbl = { ...mono, fontSize: '9px', display: 'block', marginBottom: '6px' };
const inp = { boxSizing: 'border-box', padding: '9px 10px', fontSize: '0.95rem', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--mono)', background: '#fff', textAlign: 'center' };
const chip = (on, off) => ({ padding: '7px 12px', border: `1px solid ${on ? 'var(--ink)' : 'var(--line)'}`, background: on ? 'var(--ink)' : '#fff', cursor: off ? 'not-allowed' : 'pointer', ...mono, color: on ? '#fff' : 'var(--ink)', opacity: off ? 0.45 : 1 });
const tile = (on) => ({ border: `1px solid ${on ? 'var(--ink)' : 'var(--line)'}`, background: '#fff', cursor: 'pointer', padding: '4px', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '3px', outline: on ? '2px solid var(--ink)' : 'none' });
const money = (v) => (v === null || v === undefined ? '—' : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
// the prompts a half-made choice shows ("Pick a lining.") — said softly; every other refusal is a refusal
const PROMPTS = ['NO_FABRIC', 'NO_STYLE', 'NO_LINING', 'NO_WIDTH_GROUP', 'NO_LENGTH'];

// A top style's own picture is not in the gallery yet — a drawing of the heading stands in for it.
const HeadingGlyph = ({ label, on }) => {
    const c = on ? 'var(--ink)' : 'var(--brass, #b08d57)';
    const kind = /pinch/i.test(label) ? 'PINCH' : (/grommet/i.test(label) ? 'GROMMET' : (/ripple/i.test(label) ? 'RIPPLE' : ''));
    return (
        <svg viewBox="0 0 120 70" width="100%" height="100%" aria-hidden="true">
            <line x1="6" y1="10" x2="114" y2="10" stroke={c} strokeWidth="3" strokeLinecap="round" />
            {kind === 'PINCH' && [24, 60, 96].map(x => (
                <g key={x} stroke={c} strokeWidth="2" fill="none">
                    <path d={`M${x - 9} 16 L${x} 30 L${x + 9} 16`} /><line x1={x} y1="16" x2={x} y2="30" /><line x1={x} y1="30" x2={x - 12} y2="66" /><line x1={x} y1="30" x2={x} y2="66" /><line x1={x} y1="30" x2={x + 12} y2="66" />
                </g>
            ))}
            {kind === 'GROMMET' && (
                <g stroke={c} strokeWidth="2" fill="none">
                    <path d="M10 18 Q24 30 38 18 Q52 6 66 18 Q80 30 94 18 Q104 10 112 18" />
                    {[24, 52, 80, 104].map(x => <circle key={x} cx={x} cy="10" r="5" fill="#fff" />)}
                    {[24, 52, 80, 104].map(x => <line key={`l${x}`} x1={x} y1="26" x2={x} y2="66" />)}
                </g>
            )}
            {kind === 'RIPPLE' && (
                <g stroke={c} strokeWidth="2" fill="none">
                    <path d="M8 22 C20 6 32 6 44 22 S68 38 80 22 S104 6 114 22" />
                    {[20, 44, 68, 92].map(x => <line key={x} x1={x} y1="26" x2={x} y2="66" />)}
                </g>
            )}
            {!kind && [22, 42, 62, 82, 102].map(x => <line key={x} x1={x} y1="14" x2={x} y2="66" stroke={c} strokeWidth="2" />)}
        </svg>
    );
};

const CurtainQuickSell = () => {
    const [chart, setChart] = useState(undefined);     // system/curtain_pricing (null = none applied)
    const [prodTypes, setProdTypes] = useState(null);   // the library's product types — the gallery is asked by type
    const [assets, setAssets] = useState(null);
    const [galleryErr, setGalleryErr] = useState('');
    const [fabric, setFabric] = useState('');           // the chart's fabric key
    const [colour, setColour] = useState('');
    const [style, setStyle] = useState('');
    const [lining, setLining] = useState('');
    const [n, setN] = useState(null);
    const [length, setLength] = useState('');
    const [panels, setPanels] = useState('1');
    const [only, setOnly] = useState('');               // the fabric the tiles are narrowed to

    useEffect(() => {
        const u1 = onSnapshot(doc(db, 'system', CURTAIN_PRICING_DOC), s => setChart(s.exists() ? s.data() : null), () => setChart(null));
        const u2 = onSnapshot(doc(db, 'system', 'master_lists'), s => setProdTypes(s.exists() && Array.isArray(s.data().prodTypes) ? s.data().prodTypes : []), () => setProdTypes([]));
        return () => { u1(); u2(); };
    }, []);
    useEffect(() => {
        if (prodTypes === null) return undefined;
        let alive = true;
        (async () => {
            try {
                const snap = await getDocs(query(collection(db, 'global_assets'), where('productType', 'in', swatchQueryTypesOf(prodTypes))));
                if (alive) { setAssets(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setGalleryErr(''); }
            } catch (e) { if (alive) { setAssets([]); setGalleryErr(`The swatches could not be read from the Asset Gallery (${e.message || e}) — the prices below are unaffected.`); } }
        })();
        return () => { alive = false; };
    }, [prodTypes]);

    const ready = hasCurtainChart(chart);
    const fabrics = useMemo(() => curtainFabricsOf(chart), [chart]);
    const styles = useMemo(() => curtainStylesOf(chart), [chart]);
    const swatches = useMemo(() => curtainSwatchesOf(assets || [], chart, { brand: CURTAIN_BRAND }), [assets, chart]);
    // one tile per colourway; a fabric with no swatch in the gallery still gets its tile, without a colour
    const tiles = useMemo(() => {
        const rows = [];
        fabrics.forEach(f => {
            const mine = swatches.colours.filter(c => c.fabricKey === f.key);
            if (mine.length) mine.forEach(c => rows.push({ key: c.key, fabricKey: f.key, fabric: f.name, colour: c.colour, url: c.url }));
            else rows.push({ key: `${f.key}|`, fabricKey: f.key, fabric: f.name, colour: '', url: '' });
        });
        return rows.filter(r => !only || r.fabricKey === only);
    }, [fabrics, swatches, only]);

    const linings = useMemo(() => (fabric && style ? curtainLiningsOf(chart, { style, fabric }) : []), [chart, style, fabric]);
    const groups = useMemo(() => (fabric && style && lining ? curtainGroupsOf(chart, { style, fabric, lining }) : []), [chart, style, fabric, lining]);
    // a choice made for another fabric or style is kept only while the chart still offers it; a single lining picks itself
    useEffect(() => {
        if (!fabric || !style) return;
        if (linings.length === 1 && lining !== linings[0].key) { setLining(linings[0].key); return; }
        if (lining && !linings.some(l => l.key === lining)) setLining('');
    }, [fabric, style, linings, lining]);
    useEffect(() => { if (n !== null && groups.length && !groups.some(g => g.n === n)) setN(null); }, [groups, n]);

    const group = groups.find(g => g.n === n) || null;
    const quote = useMemo(() => (ready && fabric ? curtainQuoteOf(chart, { style, fabric, lining, n, lengthIn: length === '' ? null : Number(length), panels: panels === '' ? null : Number(panels), colour }) : null), [ready, chart, style, fabric, lining, n, length, panels, colour]);
    const prompt = quote && !quote.ok && PROMPTS.includes(quote.errors[0].code);
    const workroom = (chart && chart.workroom && chart.workroom.name) || '';

    if (chart === undefined) return null;
    const shell = (body) => (
        <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)', background: 'var(--paper)', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--serif)', fontSize: '1.15rem', fontWeight: 500, color: 'var(--ink)' }}>🪟 Custom curtains</span>
                {ready && <span style={mono}>{fabrics.length} fabrics · {swatches.colours.length} colourways · {styles.length} top styles · made to order{workroom ? ` by ${workroom}` : ''} · the price is the chart's line for the width group and the length</span>}
            </div>
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>{body}</div>
        </div>
    );
    if (!ready) return shell(<div style={{ color: 'var(--ink-soft)', fontSize: '0.85rem' }}>No curtain chart applied — 6.5 Tools → Curtain Pricing.</div>);

    return shell(
        <>
            <div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '8px' }}>
                    <span style={{ ...lbl, marginBottom: 0 }}>1 · Fabric and colour</span>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        <button onClick={() => setOnly('')} style={chip(only === '')}>All</button>
                        {fabrics.map(f => <button key={f.key} onClick={() => setOnly(f.key)} style={chip(only === f.key)}>{f.name}</button>)}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', maxHeight: '300px', overflowY: 'auto', padding: '2px' }}>
                    {tiles.map(t => {
                        const on = fabric === t.fabricKey && colour === t.colour;
                        return (
                            <button key={t.key} onClick={() => { setFabric(t.fabricKey); setColour(t.colour); }} title={`${t.fabric}${t.colour ? ` · ${t.colour}` : ' · no swatch in the gallery yet'}`} style={{ ...tile(on), width: '118px' }}>
                                <div style={{ width: '100%', height: '74px', background: '#efe9e0', overflow: 'hidden' }}>
                                    {t.url ? <img src={t.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ ...mono, padding: '8px', fontSize: '9px' }}>{t.fabric}<br />no swatch yet</div>}
                                </div>
                                <div style={{ fontSize: '0.78rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.fabric}</div>
                                <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.colour || 'colour to be named'}</div>
                            </button>
                        );
                    })}
                </div>
                {galleryErr && <div style={{ color: '#a86b00', fontSize: '0.8rem', marginTop: '6px' }}>{galleryErr}</div>}
                {assets !== null && !galleryErr && swatches.colours.length === 0 && <div style={{ color: 'var(--ink-soft)', fontSize: '0.8rem', marginTop: '6px' }}>No swatches in the Asset Gallery yet — 6.5 Tools → Curtain Pricing → Swatches.</div>}
            </div>

            <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div>
                    <span style={lbl}>2 · Top style</span>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {styles.map(s => {
                            const on = style === s.key;
                            const pic = swatches.styles[s.key];
                            return (
                                <button key={s.key} onClick={() => setStyle(s.key)} title={s.name === s.label ? s.label : `${s.name} — the workroom's ${s.label}`} style={{ ...tile(on), width: '132px' }}>
                                    <div style={{ width: '100%', height: '74px', background: on ? 'var(--paper)' : '#faf8f4', overflow: 'hidden' }}>
                                        {pic ? <img src={pic.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <HeadingGlyph label={s.label} on={on} />}
                                    </div>
                                    <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{s.name}</div>
                                </button>
                            );
                        })}
                    </div>
                </div>
                <div>
                    <span style={lbl}>3 · Lining</span>
                    {!fabric || !style ? <div style={{ color: 'var(--ink-soft)', fontSize: '0.85rem' }}>Pick a fabric and a top style.</div>
                        : linings.length === 0 ? <div style={{ color: '#d9534f', fontSize: '0.85rem' }}>The chart has no lines for this fabric in this style.</div>
                            : <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>{linings.map(l => <button key={l.key} onClick={() => setLining(l.key)} style={chip(lining === l.key)}>{l.name}</button>)}{linings.length === 1 && <span style={{ ...mono, alignSelf: 'center' }}>the only one offered</span>}</div>}
                </div>
            </div>

            <div>
                <span style={lbl}>4 · Width group · the finished panel width, ordered as the group</span>
                {groups.length === 0 ? <div style={{ color: 'var(--ink-soft)', fontSize: '0.85rem' }}>Pick a fabric, a top style and a lining.</div> : (
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {groups.map(g => {
                            const on = n === g.n;
                            return (
                                <button key={g.n} onClick={() => setN(g.n)} title={g.bad ? 'The sheet has this width range backwards — not sold until the chart is corrected' : `lengths ${g.minLength}"–${g.maxLength}"`}
                                    style={{ ...tile(on), width: '104px', alignItems: 'center', padding: '10px 4px', opacity: g.bad ? 0.5 : 1 }}>
                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '15px', color: g.bad ? '#8a1f1f' : 'var(--ink)', textDecoration: g.bad ? 'line-through' : 'none' }}>{g.range}</div>
                                    <div style={{ ...mono, fontSize: '9px' }}>{g.bad ? 'sheet error' : g.word}</div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <label><span style={lbl}>5 · Finished length (in) · to the inch</span>
                    <input value={length} onChange={e => setLength(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="numeric" placeholder={group && group.minLength !== null ? `${group.minLength}–${group.maxLength}` : 'inches'} style={{ ...inp, width: '110px' }} /></label>
                <label><span style={lbl}>Panels</span>
                    <input value={panels} onChange={e => setPanels(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" style={{ ...inp, width: '64px' }} /></label>
                {quote && quote.ok && <span style={{ ...mono, paddingBottom: '11px' }}>priced in the {quote.line.band.low}–{quote.line.band.high}" band</span>}
            </div>

            <div style={{ display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--paper-2)', paddingTop: '12px' }}>
                <div style={{ flex: 1, minWidth: '260px', fontSize: '0.9rem' }}>
                    {!fabric && <div style={{ color: 'var(--ink-soft)' }}>Pick a fabric.</div>}
                    {quote && quote.ok && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <div><b>{money(quote.line.price)}</b> each{quote.line.panels > 1 ? <> · {quote.line.panels} panels = <b>{money(quote.line.total)}</b></> : null} · {curtainOrderTextOf(quote.line)}</div>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink-soft)', userSelect: 'all' }}>{workroom ? `${workroom} · ` : ''}{workroomRefOf(quote.line)}</div>
                        </div>
                    )}
                    {quote && !quote.ok && <div style={{ color: prompt ? 'var(--ink-soft)' : '#d9534f' }}>{quote.errors.map(e => e.message).join(' ')}</div>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                    <button disabled style={{ padding: '11px 18px', background: 'var(--paper-2)', border: 'none', cursor: 'not-allowed', ...mono, color: 'var(--ink-soft)' }}>+ Add to cart</button>
                    <span style={{ ...mono, fontSize: '9px', maxWidth: '280px', textAlign: 'right' }}>Add to cart turns on when the workroom order route is live — quote from the price and the line above.</span>
                </div>
            </div>
        </>
    );
};

export default CurtainQuickSell;
