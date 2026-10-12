// ── 7. QUICK SHIP → PILLOWS & THROWS, THE QUICK SELL (Uniquity · S7 step 2, 2026-10-12) ─────────
//
// Stuart: "an icon for pillow, then icons for the size shape, click, click, choose fabric, add to
// cart". Size tiles drawn to proportion → fabric tiles (one per colourway, its picture, its group) →
// edge / trim / fill → quantity → Add to cart. The rule is Shared/pillowQuickSell (pure): a plain
// pillow whose SKU is on the shelf is the SKU at the CHART price; anything else is made to order in
// the custom shape. The shelf is read from NetSuite for the one SKU at Add (one SuiteQL read); an
// unread shelf is said, never assumed. Uniquity only; mounted by QuickShipTab under one guard.
import React, { useEffect, useMemo, useState } from 'react';
import { db } from '../../firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { DEFAULT_PILLOW_PRICING, PILLOW_PRICING_DOC } from '../Shared/pillowPricing';
import { colourwaysOf } from '../Shared/pillowCatalog';
import { quickSellSizesOf, quickSellEdgesOf, quickSellPlanOf, quickSellTilesOf } from '../Shared/pillowQuickSell';
import { isTrimItem } from '../Shared/pillowFabricSheet';
import { fetchAvailabilityUnits } from '../Shared/oeReviewPlan';
import { BRAND_NETSUITE_MAP } from '../Shared/brandNetsuite';

const mono = { fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-soft)' };
const lbl = { ...mono, fontSize: '9px', display: 'block', marginBottom: '6px' };
const inp = { boxSizing: 'border-box', padding: '9px 10px', fontSize: '0.85rem', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', background: '#fff' };
const chip = (on) => ({ padding: '7px 12px', border: `1px solid ${on ? 'var(--ink)' : 'var(--line)'}`, background: on ? 'var(--ink)' : '#fff', cursor: 'pointer', ...mono, color: on ? '#fff' : 'var(--ink)' });
const money = (v) => (v === null || v === undefined ? '—' : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`);

const PillowQuickSell = ({ items = [], findPart, rateFor, onAdd, addLog = () => {} }) => {
    const [pricing, setPricing] = useState(null);
    const [fillTypes, setFillTypes] = useState([]);
    const [mode, setMode] = useState('PILLOW');
    const [sizeKey, setSizeKey] = useState('');
    const [cwKey, setCwKey] = useState('');
    const [variant, setVariant] = useState('STD');
    const [edge, setEdge] = useState('NONE');
    const [trimId, setTrimId] = useState('');
    const [fill, setFill] = useState('');
    const [qty, setQty] = useState('1');
    const [q, setQ] = useState('');
    const [group, setGroup] = useState('');
    const [busy, setBusy] = useState(false);
    const [last, setLast] = useState(null);   // what the last Add resolved to

    useEffect(() => {
        const u1 = onSnapshot(doc(db, 'system', PILLOW_PRICING_DOC), s => setPricing(s.exists() ? { ...DEFAULT_PILLOW_PRICING, ...s.data() } : { ...DEFAULT_PILLOW_PRICING }), () => setPricing({ ...DEFAULT_PILLOW_PRICING }));
        const u2 = onSnapshot(doc(db, 'system', 'master_lists'), s => setFillTypes(s.exists() && Array.isArray(s.data().fillTypes) ? s.data().fillTypes : []), () => setFillTypes([]));
        return () => { u1(); u2(); };
    }, []);
    const cfg = pricing || DEFAULT_PILLOW_PRICING;
    const catalog = useMemo(() => colourwaysOf(items), [items]);
    const sizes = useMemo(() => quickSellSizesOf(cfg, catalog), [cfg, catalog]);
    const edges = useMemo(() => quickSellEdgesOf(cfg), [cfg]);
    const trims = useMemo(() => items.filter(isTrimItem).sort((a, b) => String(a.legacyErpId || '').localeCompare(String(b.legacyErpId || ''))), [items]);
    const groups = useMemo(() => Object.keys(cfg.fabricGroups || {}).sort((a, b) => ((cfg.fabricGroups[a] || {}).rank || 0) - ((cfg.fabricGroups[b] || {}).rank || 0)), [cfg]);
    const tiles = useMemo(() => quickSellTilesOf(catalog, { q, group, mode }), [catalog, q, group, mode]);
    const cw = cwKey ? catalog.byKey.get(cwKey) || null : null;
    const qtyN = Math.max(1, parseInt(qty, 10) || 1);
    // the price before the shelf is read: the same rule with stock unknown
    const preview = useMemo(() => (cw ? quickSellPlanOf({ cw, mode, sizeKey, variant, edge, trimId, fill, qty: qtyN, available: null, config: cfg, findPart }) : null), [cw, mode, sizeKey, variant, edge, trimId, fill, qtyN, cfg, findPart]);
    const maxDim = Math.max(1, ...sizes.map(s => Math.max(s.w, s.h)));

    const add = async () => {
        if (!cw || !preview) return;
        setBusy(true);
        try {
            let available = null;
            const plainSku = mode === 'PILLOW' && edge === 'NONE' && !trimId && cw.pillows[sizeKey];
            if (plainSku) {
                try {
                    const r = await fetchAvailabilityUnits([String(cw.pillows[sizeKey].legacyErpId || cw.pillows[sizeKey].itemId)], BRAND_NETSUITE_MAP.uniquity.location);
                    const hit = r.map[String(cw.pillows[sizeKey].legacyErpId || cw.pillows[sizeKey].itemId).toUpperCase()];
                    available = hit ? hit.available : 0;
                } catch (e) { addLog(`⚠ Shelf read failed for ${cw.pillows[sizeKey].legacyErpId} (${e.message || e}) — sold as the item, the shelf decides at review.`, 'warn'); }
            }
            const plan = quickSellPlanOf({ cw, mode, sizeKey, variant, edge, trimId, fill, qty: qtyN, available, config: cfg, findPart });
            setLast(plan);
            if (!plan.ok) { plan.errors.forEach(e => addLog(`⛔ ${e.message}`, 'error')); setBusy(false); return; }
            plan.warnings.forEach(w => addLog(`⚠ ${w}`, 'warn'));
            onAdd(plan);
            const what = plan.kind === 'THROW' ? `${plan.throwItem.legacyErpId} × ${plan.qty}` : plan.kind === 'SKU' ? `${plan.sku.code} × ${plan.qty} at ${money(plan.chartPrice)}${plan.sku.available !== null ? ` (${plan.sku.available} on the shelf)` : ''}` : `CUSTOM PILLOW × ${plan.qty} at ${money(plan.mto.unitPrice)} — made to order, ${plan.summary}`;
            addLog(`🛋 Added ${what}`, 'success');
        } catch (e) { addLog(`Add failed: ${e.message || e}`, 'error'); }
        setBusy(false);
    };

    const sizeTile = (s) => {
        const on = sizeKey === s.key;
        const scale = 54 / maxDim;
        return (
            <button key={s.key} onClick={() => setSizeKey(s.key)} title={`${s.w}" wide × ${s.h}" tall${s.inCatalog ? ' · in the catalog' : ' · made to order'}`}
                style={{ width: '86px', height: '92px', border: `1px solid ${on ? 'var(--ink)' : 'var(--line)'}`, background: on ? 'var(--paper)' : '#fff', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '4px' }}>
                <div style={{ width: `${Math.max(14, s.w * scale)}px`, height: `${Math.max(10, s.h * scale)}px`, background: on ? 'var(--ink)' : 'var(--brass, #b08d57)', borderRadius: '3px', opacity: s.inCatalog ? 1 : 0.45 }} />
                <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink)' }}>{s.key}</div>
            </button>
        );
    };
    const fabricTile = (c) => {
        const on = cwKey === c.key;
        const hasSku = mode === 'PILLOW' && sizeKey && !!c.pillows[sizeKey];
        return (
            <button key={c.key} onClick={() => setCwKey(c.key)} title={`${c.label}${c.group ? ` · group ${c.group}` : ' · no group'}`}
                style={{ width: '118px', border: `1px solid ${on ? 'var(--ink)' : 'var(--line)'}`, background: '#fff', cursor: 'pointer', padding: '4px', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '3px', outline: on ? '2px solid var(--ink)' : 'none' }}>
                <div style={{ position: 'relative', width: '100%', height: '74px', background: '#efe9e0', overflow: 'hidden' }}>
                    {c.picture ? <img src={c.picture} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ ...mono, padding: '8px', fontSize: '9px', color: 'var(--ink-soft)' }}>{c.patternRaw}<br />{c.colourName || `#${c.colour}`}</div>}
                    <span style={{ position: 'absolute', top: '3px', right: '3px', background: c.group ? 'var(--ink)' : '#d9534f', color: '#fff', fontFamily: 'var(--mono)', fontSize: '10px', padding: '1px 5px' }}>{c.group || '?'}</span>
                    {hasSku && <span style={{ position: 'absolute', bottom: '3px', left: '3px', background: '#2e7d32', color: '#fff', fontFamily: 'var(--mono)', fontSize: '8px', padding: '1px 4px', letterSpacing: '.08em' }}>SKU</span>}
                </div>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.patternRaw}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>#{c.colour}{c.colourName ? ` ${c.colourName}` : ''}</div>
            </button>
        );
    };

    const ready = cw && preview && preview.ok;
    return (
        <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)', background: 'var(--paper)', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--serif)', fontSize: '1.15rem', fontWeight: 500, color: 'var(--ink)' }}>🛋 Pillows &amp; throws</span>
                <div style={{ display: 'flex', gap: '6px' }}>
                    <button onClick={() => { setMode('PILLOW'); setCwKey(''); }} style={chip(mode === 'PILLOW')}>Pillow</button>
                    <button onClick={() => { setMode('THROW'); setCwKey(''); setSizeKey(''); setEdge('NONE'); setTrimId(''); }} style={chip(mode === 'THROW')}>Throw</button>
                </div>
                <span style={mono}>{catalog.list.length} colourways · {sizes.length} sizes · a plain pillow on the shelf sells as its item at the chart price, anything else is made to order</span>
            </div>
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {mode === 'PILLOW' && (
                    <div>
                        <span style={lbl}>1 · Size (wide × tall) · a pale tile = no finished pillow in the catalog, made to order</span>
                        {sizes.length === 0 ? <div style={{ color: 'var(--ink-soft)', fontSize: '0.85rem' }}>No price chart applied — 6.5 Tools → Pillow Pricing.</div>
                            : <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>{sizes.map(sizeTile)}</div>}
                    </div>
                )}
                <div>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '8px' }}>
                        <span style={{ ...lbl, marginBottom: 0 }}>{mode === 'PILLOW' ? '2 · ' : '1 · '}Fabric</span>
                        <input value={q} onChange={e => setQ(e.target.value)} placeholder="pattern · colour · number" style={{ ...inp, width: '220px' }} />
                        <div style={{ display: 'flex', gap: '4px' }}>
                            <button onClick={() => setGroup('')} style={chip(group === '')}>All</button>
                            {groups.map(g => <button key={g} onClick={() => setGroup(g)} style={chip(group === g)}>{g}</button>)}
                        </div>
                        <span style={mono}>{tiles.length} shown{cw ? ` · ${cw.label}` : ''}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', maxHeight: '300px', overflowY: 'auto', padding: '2px' }}>
                        {tiles.slice(0, 240).map(fabricTile)}
                        {tiles.length === 0 && <div style={{ color: 'var(--ink-soft)', fontSize: '0.85rem' }}>No colourway matches.</div>}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    {mode === 'PILLOW' ? (
                        <>
                            <div><span style={lbl}>3 · Edge</span><div style={{ display: 'flex', gap: '4px' }}>{edges.map(e => <button key={e.code} onClick={() => setEdge(e.code)} style={chip(edge === e.code)}>{e.label}</button>)}</div></div>
                            <div><span style={lbl}>Trim (outer edges)</span>
                                <select value={trimId} onChange={e => setTrimId(e.target.value)} style={{ ...inp, minWidth: '180px' }}>
                                    <option value="">none</option>
                                    {trims.map(t => <option key={t.id} value={t.id}>{t.legacyErpId || t.itemId} — {t.itemName}</option>)}
                                </select></div>
                            {fillTypes.length > 0 && <div><span style={lbl}>Fill</span>
                                <select value={fill} onChange={e => setFill(e.target.value)} style={{ ...inp, minWidth: '120px' }}>
                                    <option value="">standard</option>
                                    {fillTypes.map(f => <option key={f} value={f}>{f}</option>)}
                                </select></div>}
                        </>
                    ) : (
                        <div><span style={lbl}>2 · Size</span><div style={{ display: 'flex', gap: '4px' }}>{['STD', 'XL', 'XXL'].map(v => <button key={v} onClick={() => setVariant(v)} disabled={cw && !cw.throws[v]} style={{ ...chip(variant === v), opacity: cw && !cw.throws[v] ? 0.4 : 1 }}>{v === 'STD' ? 'Standard' : v}</button>)}</div></div>
                    )}
                    <div><span style={lbl}>Qty</span><input value={qty} onChange={e => setQty(e.target.value)} style={{ ...inp, width: '64px', textAlign: 'center', fontFamily: 'var(--mono)' }} /></div>
                    <div style={{ flex: 1, minWidth: '240px' }}>
                        {preview && preview.ok && (
                            <div style={{ fontSize: '0.85rem' }}>
                                {preview.kind === 'THROW' ? <><b>{preview.throwItem.legacyErpId}</b> · {preview.throwItem.itemName} · {money(rateFor ? rateFor(preview.throwItem) : null)} each</>
                                    : preview.kind === 'SKU' ? <><b>{preview.sku.code}</b> · {money(preview.chartPrice)} each from the chart{preview.sku.mismatch ? <span style={{ color: '#a86b00' }}> · item carries {money(preview.sku.skuPrice)}</span> : null} · the shelf is read at Add</>
                                        : <><b>Made to order</b> · {money(preview.mto.unitPrice)} each · {preview.summary} · 3 weeks</>}
                            </div>
                        )}
                        {preview && !preview.ok && <div style={{ fontSize: '0.85rem', color: '#d9534f' }}>{preview.errors.map(e => e.message).join(' ')}</div>}
                        {!cw && <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>{mode === 'PILLOW' ? 'Pick a size and a fabric.' : 'Pick a fabric.'}</div>}
                    </div>
                    <button onClick={add} disabled={!ready || busy} style={{ padding: '11px 18px', background: ready && !busy ? 'var(--brass)' : 'var(--paper-2)', border: 'none', cursor: ready && !busy ? 'pointer' : 'not-allowed', ...mono, color: ready && !busy ? '#fff' : 'var(--ink-soft)' }}>{busy ? 'Reading the shelf…' : '+ Add to cart'}</button>
                </div>
                {last && last.ok && (
                    <div style={{ ...mono, color: last.kind === 'MTO' ? 'var(--brass)' : '#2e7d32' }}>
                        Last added: {last.kind === 'THROW' ? `${last.throwItem.legacyErpId} × ${last.qty}` : last.kind === 'SKU' ? `${last.sku.code} × ${last.qty} · ${last.sku.available === null ? 'shelf not read' : `${last.sku.available} on the shelf`}` : `made to order × ${last.qty} · ${last.summary}`}
                    </div>
                )}
            </div>
        </div>
    );
};

export default PillowQuickSell;
