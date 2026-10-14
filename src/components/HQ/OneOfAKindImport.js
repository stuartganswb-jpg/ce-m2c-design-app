// ── 6.5 Tools → ONE-OF-A-KIND IMPORT (Uniquity · S7, 2026-10-14) ───────────────────────────────────
//
// Stuart: "about 30 pillows that we made custom at the show … import the pictures, have a form where i can
// see the pillow image and enter in a sales price and the fabric used and amount used … scrap, bridsml or
// bridlrg … 1 per pillow … wall art the same but bridwall". Drop the photos → one card each (the picture
// large; the code typed from the tag, the name, the price, the size, the bin, and the MAKING as tiles: a
// fabric + its yards, or a non-inventory making × 1) → Create: the photo to Storage, the NetSuite item
// (optional per card — a non-inventory sale item modelled on a making the screen reads back; a refusal is
// said in NetSuite's words and the piece is filed app-only, selling on the CUSTOM PILLOW holder), then the
// Uniquity library record (Shared/oneOfAKind.oneOfAKindDocOf). The counter's "One of a kind" tile sells them.
import React, { useEffect, useMemo, useState } from 'react';
import { db, storage } from '../../firebase';
import { collection, query, where, getDocs, setDoc, doc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { nsProxyFetch } from '../Shared/nsProxy';
import { oneOfAKindCardOf, cardReadinessOf, oneOfAKindDocOf, newOneOfAKindId, nsOneOfAKindItemOf, OOAK_KINDS, OOAK_MAKINGS } from '../Shared/oneOfAKind';
import { nsIdOfCreateAnswer, nsErrorOf } from '../Shared/nsCustomer';
import { isFabricItem } from '../Shared/pillowFabricSheet';
import { sizeKeysOf } from '../Shared/pillowCuts';
import { DEFAULT_PILLOW_PRICING, PILLOW_PRICING_DOC } from '../Shared/pillowPricing';
import { onSnapshot } from 'firebase/firestore';

const mono = { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' };
const card = { background: '#fff', border: '1px solid var(--line)', padding: '20px', borderRadius: '2px' };
const h = { margin: '0 0 12px 0', fontFamily: 'var(--serif)', fontSize: '1.3rem', fontWeight: 500, color: 'var(--ink)' };
const field = { padding: '9px 10px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none', boxSizing: 'border-box', background: '#fff', width: '100%' };
const btn = (primary, disabled) => ({ padding: '10px 16px', background: disabled ? 'var(--paper-2)' : (primary ? 'var(--ink)' : 'transparent'), border: primary ? 'none' : '1px solid var(--line)', cursor: disabled ? 'not-allowed' : 'pointer', ...mono, color: disabled ? 'var(--ink-soft)' : (primary ? '#fff' : 'var(--ink)') });
const chip = (on) => ({ padding: '9px 12px', border: `1px solid ${on ? 'var(--ink)' : 'var(--line)'}`, background: on ? 'var(--ink)' : '#fff', cursor: 'pointer', ...mono, color: on ? '#fff' : 'var(--ink)' });
const BRAND = 'uniquity';

const readFileAsDataUrl = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result || '')); r.onerror = rej; r.readAsDataURL(file); });
const dataUrlToBlob = async (dataUrl) => (await fetch(dataUrl)).blob();
const resized = (dataUrl, maxPx) => new Promise((res) => {
    const img = new Image();
    img.onload = () => { const s = Math.min(1, maxPx / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.86)); };
    img.onerror = () => res(dataUrl);
    img.src = dataUrl;
});

const OneOfAKindImport = ({ currentUser, activeBrand }) => {
    const [items, setItems] = useState(null);
    const [pricing, setPricing] = useState(null);
    const [cards, setCards] = useState([]);
    const [busy, setBusy] = useState(false);
    const [armed, setArmed] = useState(false);
    const [log, setLog] = useState([]);
    const say = (msg, tone = 'info') => setLog(prev => [{ t: new Date().toLocaleTimeString(), msg, tone }, ...prev].slice(0, 60));

    const readLibrary = async () => {
        const snap = await getDocs(query(collection(db, 'Approved_Designs'), where('brandId', '==', BRAND)));
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setItems(all);
        return all;
    };
    useEffect(() => { readLibrary().catch(e => say(`Library read failed: ${e.message || e}`, 'err')); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => onSnapshot(doc(db, 'system', PILLOW_PRICING_DOC), s => setPricing(s.exists() ? { ...DEFAULT_PILLOW_PRICING, ...s.data() } : { ...DEFAULT_PILLOW_PRICING }), () => setPricing({ ...DEFAULT_PILLOW_PRICING })), []);
    const findByCode = useMemo(() => { const m = new Map(); (items || []).forEach(it => { [it.legacyErpId, it.itemId].forEach(c => { if (c) m.set(String(c).toUpperCase(), it); }); }); return (c) => m.get(String(c || '').toUpperCase()) || null; }, [items]);
    const fabrics = useMemo(() => (items || []).filter(isFabricItem).sort((a, b) => String(a.legacyErpId || '').localeCompare(String(b.legacyErpId || ''))), [items]);
    const sizes = useMemo(() => sizeKeysOf(pricing || DEFAULT_PILLOW_PRICING), [pricing]);
    const makingState = useMemo(() => {
        const out = {};
        [...OOAK_MAKINGS.PILLOW, ...OOAK_MAKINGS.WALL].forEach(mk => { const it = findByCode(mk.code); out[mk.code] = it ? (it.netSuiteInternalId ? 'ok' : 'no-ns') : 'missing'; });
        return out;
    }, [findByCode]);

    const onFiles = async (e) => {
        const files = [...(e.target.files || [])];
        e.target.value = '';
        if (!files.length) return;
        setBusy(true);
        try {
            const next = [];
            for (const f of files) {
                const raw = await readFileAsDataUrl(f);
                const dataUrl = await resized(raw, 1600);
                next.push(oneOfAKindCardOf({ fileName: f.name, dataUrl }));
            }
            setCards(prev => [...prev, ...next]);
            say(`${next.length} photo(s) in — one card each. Type the code from the tag, the price, and what it was made from.`, 'ok');
        } catch (err) { say(`Could not read the photos: ${err.message || err}`, 'err'); }
        setBusy(false);
    };
    const setCard = (id, patch) => { setArmed(false); setCards(prev => prev.map(c => (c.id === id ? { ...c, ...patch, state: c.state === 'DONE' ? 'DONE' : 'DRAFT' } : c))); };
    const setMaking = (id, patch) => setCards(prev => prev.map(c => (c.id === id ? { ...c, making: { ...c.making, ...patch } } : c)));
    const dropCard = (id) => setCards(prev => prev.filter(c => c.id !== id));

    const readiness = useMemo(() => {
        const libraryCodes = (items || []).map(it => String(it.legacyErpId || it.itemId || '').toUpperCase());
        return Object.fromEntries(cards.map(c => {
            const others = cards.filter(x => x.id !== c.id && x.state !== 'DONE').map(x => String(x.code || '').toUpperCase()).filter(Boolean);
            return [c.id, cardReadinessOf(c, { findByCode, takenCodes: [...libraryCodes, ...others] })];
        }));
    }, [cards, items, findByCode]);
    const readyCards = cards.filter(c => c.state !== 'DONE' && readiness[c.id] && readiness[c.id].ok);

    // A non-inventory making the screen reads back from NetSuite — the template the new item is modelled on.
    const readTemplate = async () => {
        const first = [...OOAK_MAKINGS.PILLOW, ...OOAK_MAKINGS.WALL].map(mk => findByCode(mk.code)).find(it => it && it.netSuiteInternalId);
        if (!first) return { template: null, note: 'no making with a NetSuite id in the library — the item body carries the tag and name only' };
        for (const type of ['nonInventorySaleItem', 'nonInventoryResaleItem', 'nonInventoryItem']) {
            try {
                const r = await nsProxyFetch({ targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/${type}/${first.netSuiteInternalId}`, method: 'GET' });
                const d = await r.json().catch(() => ({}));
                if (r.ok && d && (d.subsidiary || d.taxSchedule)) return { template: d, type, note: `modelled on ${first.legacyErpId} (${type})` };
            } catch (e) { /* try the next record type */ }
        }
        return { template: null, note: `${first.legacyErpId} could not be read back from NetSuite — the item body carries the tag and name only` };
    };

    const createAll = async () => {
        if (!readyCards.length) return;
        if (!armed) { setArmed(true); return; }
        setBusy(true); setArmed(false);
        let tpl = { template: null, type: 'nonInventorySaleItem', note: '' };
        if (readyCards.some(c => c.createInNetSuite)) { tpl = await readTemplate(); say(`NetSuite item template: ${tpl.note}`, tpl.template ? 'info' : 'warn'); }
        const at = Date.now();
        let i = 0;
        for (const c of readyCards) {
            const idx = i++;
            try {
                setCards(prev => prev.map(x => (x.id === c.id ? { ...x, state: 'BUSY' } : x)));
                const code = String(c.code).toUpperCase();
                // 1 · the photo
                let photoUrl = '', thumbUrl = '';
                if (c.dataUrl) {
                    const safe = code.replace(/[^A-Z0-9-]/g, '');
                    const hi = await dataUrlToBlob(c.dataUrl);
                    const th = await dataUrlToBlob(await resized(c.dataUrl, 420));
                    const hiRef = ref(storage, `global_assets/hires/${BRAND}/OOAK_${safe}_${at}_${idx}.jpg`);
                    const thRef = ref(storage, `global_assets/thumbs/${BRAND}/OOAK_${safe}_${at}_${idx}_thumb.jpg`);
                    const [u1, u2] = await Promise.all([uploadBytes(hiRef, hi), uploadBytes(thRef, th)]);
                    [photoUrl, thumbUrl] = await Promise.all([getDownloadURL(u1.ref), getDownloadURL(u2.ref)]);
                }
                // 2 · the NetSuite item (optional; a refusal files the piece app-only)
                let nsId = '', nsNote = '';
                if (c.createInNetSuite) {
                    const body = nsOneOfAKindItemOf(c, { template: tpl.template, brand: BRAND });
                    try {
                        const r = await nsProxyFetch({ targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/${tpl.type || 'nonInventorySaleItem'}`, method: 'POST', payload: body });
                        const d = await r.json().catch(() => ({}));
                        if (r.ok) { nsId = nsIdOfCreateAnswer(d, (r.headers && r.headers.get && r.headers.get('location')) || ''); nsNote = nsId ? `NetSuite item ${nsId}` : 'NetSuite took it but gave no id — sync 11.1 later'; }
                        else nsNote = `NetSuite refused the item (${nsErrorOf(d, r.status)}) — filed app-only; it sells on the CUSTOM PILLOW holder`;
                    } catch (e) { nsNote = `NetSuite unreachable (${e.message || e}) — filed app-only; it sells on the CUSTOM PILLOW holder`; }
                }
                // 3 · the library record
                const id = newOneOfAKindId(BRAND, at, idx);
                const rec = oneOfAKindDocOf(c, { id, brandId: BRAND, by: currentUser || '', at, nsId, photoUrl, thumbUrl });
                await setDoc(doc(db, 'Approved_Designs', id), rec);
                setCards(prev => prev.map(x => (x.id === c.id ? { ...x, state: 'DONE', result: { id, nsId, nsNote } } : x)));
                say(`✅ ${code} — ${rec.itemName} · $${rec.manufacturingSpecs.basePrice} · ${rec.manufacturingSpecs.customData.oneOfAKind.making.type === 'FABRIC' ? `${rec.manufacturingSpecs.customData.oneOfAKind.making.yards} yd of ${rec.manufacturingSpecs.customData.oneOfAKind.making.fabricCode}` : `${rec.manufacturingSpecs.customData.oneOfAKind.making.noninvCode} × 1`}${nsNote ? ` · ${nsNote}` : ' · app-only (sells on the CUSTOM PILLOW holder)'}`, nsNote.includes('refused') || nsNote.includes('unreachable') ? 'warn' : 'ok');
            } catch (err) {
                setCards(prev => prev.map(x => (x.id === c.id ? { ...x, state: 'FAILED', result: { error: err.message || String(err) } } : x)));
                say(`⛔ ${c.code}: ${err.message || err}`, 'err');
            }
        }
        try { await readLibrary(); } catch (e) { /* the list refreshes next open */ }
        setBusy(false);
    };

    if (activeBrand !== BRAND) return <div style={{ ...card, color: 'var(--ink-soft)' }}>One-of-a-kind pieces are Uniquity's — switch the brand to Uniquity.</div>;
    const makingsFor = (kind) => OOAK_MAKINGS[kind === 'WALL' ? 'WALL' : 'PILLOW'];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={card}>
                <h3 style={h}>🎁 One-of-a-kind pillows &amp; wall art — made at the show</h3>
                <p style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: 'var(--ink-soft)' }}>
                    Drop the photos (each pillow with its tag). One card per photo: type the code from the tag, the name, the sale price, the size, and what it was made from — a fabric and the yards used, or one of the makings at one per piece. Create files each as a Uniquity item, stocked one in bin SHOW, with its photo as the picture; it then sells on the Show Counter's <b>One of a kind</b> tile at its price with its making beneath at $0. A NetSuite item is created for each unless you untick it; if NetSuite refuses, the piece is filed in the app and sells on the CUSTOM PILLOW holder with its tag in the description.
                </p>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <label style={btn(true, busy)}>＋ Drop the photos<input type="file" accept="image/*" multiple capture="environment" onChange={onFiles} disabled={busy} style={{ display: 'none' }} /></label>
                    <span style={mono}>{items === null ? 'reading the library…' : `${items.length} Uniquity items · ${fabrics.length} fabrics`}</span>
                    <span style={mono}>makings: {[...OOAK_MAKINGS.PILLOW, ...OOAK_MAKINGS.WALL].map(mk => `${mk.code} ${makingState[mk.code] === 'ok' ? '✓' : makingState[mk.code] === 'no-ns' ? '⚠ no NetSuite id' : '✗ not in the library'}`).join(' · ')}</span>
                </div>
            </div>

            {cards.map(c => {
                const r = readiness[c.id] || { ok: false, errors: [], warnings: [] };
                const done = c.state === 'DONE';
                return (
                    <div key={c.id} style={{ ...card, display: 'grid', gridTemplateColumns: '340px 1fr', gap: '20px', opacity: done ? 0.75 : 1, borderLeft: `4px solid ${done ? '#2e7d32' : c.state === 'FAILED' ? '#d9534f' : r.ok ? 'var(--brass)' : 'var(--line)'}` }}>
                        <div>
                            {c.dataUrl ? <img src={c.dataUrl} alt={c.fileName} style={{ width: '100%', maxHeight: '420px', objectFit: 'contain', background: '#f4f1ec', border: '1px solid var(--line)' }} /> : <div style={{ ...mono, padding: '40px', textAlign: 'center' }}>no photo</div>}
                            <div style={{ ...mono, marginTop: '6px' }}>{c.fileName}</div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                                {OOAK_KINDS.map(k => <button key={k.code} disabled={done} onClick={() => { setCard(c.id, { kind: k.code }); setMaking(c.id, { type: '', noninvCode: '' }); }} style={chip(c.kind === k.code)}>{k.label}</button>)}
                                <span style={{ ...mono, marginLeft: 'auto' }}>{done ? `✅ created · ${c.result && c.result.id}${c.result && c.result.nsId ? ` · NetSuite ${c.result.nsId}` : ' · app-only'}` : c.state === 'FAILED' ? `⛔ ${c.result && c.result.error}` : c.state === 'BUSY' ? 'creating…' : r.ok ? 'ready' : `${r.errors.length} to fix`}</span>
                                {!done && <button onClick={() => dropCard(c.id)} style={{ ...btn(false, busy), color: '#d9534f' }}>remove</button>}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 120px', gap: '10px' }}>
                                <label><div style={mono}>Code (from the tag)</div><input value={c.code} disabled={done} onChange={e => setCard(c.id, { code: e.target.value })} placeholder="SHOW-0412" style={{ ...field, fontFamily: 'var(--mono)' }} /></label>
                                <label><div style={mono}>Name</div><input value={c.name} disabled={done} onChange={e => setCard(c.id, { name: e.target.value })} placeholder="what the customer reads on the quote" style={field} /></label>
                                <label><div style={mono}>Sale price $</div><input value={c.price} disabled={done} onChange={e => setCard(c.id, { price: e.target.value })} inputMode="decimal" style={{ ...field, textAlign: 'right' }} /></label>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 2fr', gap: '10px' }}>
                                <label><div style={mono}>Size</div>
                                    <select value={c.sizeKey} disabled={done} onChange={e => setCard(c.id, { sizeKey: e.target.value })} style={field}>
                                        <option value="">—</option>
                                        {sizes.map(s => <option key={s} value={s}>{s}</option>)}
                                    </select></label>
                                <label><div style={mono}>Bin</div><input value={c.bin} disabled={done} onChange={e => setCard(c.id, { bin: e.target.value })} style={{ ...field, fontFamily: 'var(--mono)' }} /></label>
                                <label><div style={mono}>Note</div><input value={c.note} disabled={done} onChange={e => setCard(c.id, { note: e.target.value })} style={field} /></label>
                            </div>
                            <div>
                                <div style={mono}>Made from</div>
                                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                                    <button disabled={done} onClick={() => setMaking(c.id, { type: 'FABRIC', noninvCode: '' })} style={chip(c.making.type === 'FABRIC')}>🧵 A fabric + yards</button>
                                    {makingsFor(c.kind).map(mk => <button key={mk.code} disabled={done} onClick={() => setMaking(c.id, { type: 'NONINV', noninvCode: mk.code })} style={{ ...chip(c.making.type === 'NONINV' && c.making.noninvCode === mk.code), opacity: makingState[mk.code] === 'ok' ? 1 : 0.5 }} title={makingState[mk.code] === 'ok' ? '' : (makingState[mk.code] === 'no-ns' ? 'no NetSuite id on this item' : 'not in the library — sync 11.1')}>{mk.label} <span style={{ opacity: 0.7 }}>({mk.code} × 1)</span></button>)}
                                </div>
                                {c.making.type === 'FABRIC' && (
                                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 120px', gap: '10px', marginTop: '8px' }}>
                                        <select value={c.making.fabricCode} disabled={done} onChange={e => setMaking(c.id, { fabricCode: e.target.value })} style={field}>
                                            <option value="">-- the fabric --</option>
                                            {fabrics.map(f => <option key={f.id} value={f.legacyErpId || f.itemId}>{f.legacyErpId || f.itemId} — {f.itemName}{f.manufacturingSpecs && f.manufacturingSpecs.priceGroup ? ` · group ${f.manufacturingSpecs.priceGroup}` : ''}</option>)}
                                        </select>
                                        <input value={c.making.yards} disabled={done} onChange={e => setMaking(c.id, { yards: e.target.value })} placeholder="yards" inputMode="decimal" style={{ ...field, textAlign: 'right' }} />
                                    </div>
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
                                <label style={{ ...mono, display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={!!c.createInNetSuite} disabled={done} onChange={e => setCard(c.id, { createInNetSuite: e.target.checked })} /> create the NetSuite item</label>
                                {r.errors.map((e, i) => <span key={i} style={{ fontSize: '0.82rem', color: '#d9534f' }}>{e.message}</span>)}
                                {r.ok && r.warnings.map((w, i) => <span key={i} style={{ fontSize: '0.82rem', color: '#a86b00' }}>⚠ {w}</span>)}
                            </div>
                        </div>
                    </div>
                );
            })}

            {cards.length > 0 && (
                <div style={{ ...card, display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button onClick={createAll} disabled={busy || !readyCards.length} style={btn(true, busy || !readyCards.length)}>{busy ? 'Creating…' : armed ? `Press again to create ${readyCards.length} piece(s)` : `Create ${readyCards.length} ready piece(s)`}</button>
                    <span style={mono}>{cards.filter(c => c.state === 'DONE').length} created · {readyCards.length} ready · {cards.filter(c => c.state !== 'DONE' && !(readiness[c.id] && readiness[c.id].ok)).length} to fix</span>
                    <button onClick={() => setCards(prev => prev.filter(c => c.state !== 'DONE'))} disabled={busy} style={btn(false, busy)}>Clear the created cards</button>
                </div>
            )}

            {log.length > 0 && (
                <div style={{ ...card, fontFamily: 'var(--mono)', fontSize: '11px' }}>
                    {log.map((l, i) => <div key={i} style={{ color: l.tone === 'err' ? '#d9534f' : (l.tone === 'ok' ? '#2e7d32' : l.tone === 'warn' ? '#a86b00' : 'var(--ink-soft)'), padding: '2px 0' }}>{l.t} · {l.msg}</div>)}
                </div>
            )}
        </div>
    );
};

export default OneOfAKindImport;
