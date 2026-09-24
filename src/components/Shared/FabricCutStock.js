// ── FABRIC CUT STOCK — the drill-down (Uniquity · S7, Stuart 2026-09-24) ───────────────────────
//
// "when we see fabric Naka10 we can see 1 cut at 20" × w, 1 cut 18" × w, etc." Mounted on HQ 6.5
// Tools in PLACE of Rod Piece Stock when the brand is Uniquity (a different division). Reads the
// `fabric_pieces` ledger live, the Uniquity fabrics + throws once, and NetSuite's yards on demand
// (one SuiteQL read through the same reader the review gate uses). Every piece is labelled with the
// largest standard size it makes — computed from the live price table's minimum cuts.
//
// Writes: a cut added by hand (+ a printed label), a scrap (ledger + negative yards through the
// outbox), and THE CONVERT: N throws → yards of the fabric-yardage item as a NetSuite build through
// the CE Convert RESTlet (synchronous, like the ring packs). No native confirm — two-press buttons.
// The floor's "what is left and what size is it" prompt is step 5's, on the sewing work order.
import React, { useEffect, useMemo, useState } from 'react';
import { db } from '../../firebase';
import { collection, doc, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { BRAND_NETSUITE_MAP } from './brandNetsuite';
import { DEFAULT_PILLOW_PRICING, PILLOW_PRICING_DOC } from './pillowPricing';
import { isRailroad } from './pillowCuts';
import { fabricRowsOf, pieceLabelOf, convertPlanOf, yardsPerThrowOf } from './fabricPieces';
import { createFabricPiece, scrapFabricPiece, retryFabricScrap, convertThrowsToYardage } from './fabricPieceLedger';
import { isFabricItem } from './pillowFabricSheet';
import { fetchAvailabilityUnits } from './oeReviewPlan';
import { printHtmlLabel, code128BSvg } from './labelPrint';

const mono = { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' };
const card = { background: '#fff', border: '1px solid var(--line)', padding: '20px', borderRadius: '2px' };
const h = { margin: '0 0 12px 0', fontFamily: 'var(--serif)', fontSize: '1.3rem', fontWeight: 500, color: 'var(--ink)' };
const field = { padding: '8px 10px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box', background: '#fff' };
const btn = (primary, disabled) => ({ padding: '8px 14px', background: disabled ? 'var(--paper-2)' : (primary ? 'var(--ink)' : 'transparent'), color: disabled ? 'var(--ink-soft)' : (primary ? '#fff' : 'var(--ink)'), border: primary ? 'none' : '1px solid var(--line)', cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: mono.fontFamily, fontSize: mono.fontSize, textTransform: mono.textTransform, letterSpacing: mono.letterSpacing });
const esc = (s) => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const inText = (n) => `${Number(n) || 0}"`;
const isThrowItem = (it) => /THROW/i.test(String((it && it.manufacturingSpecs && it.manufacturingSpecs.productType) || (it && it.productType) || ''));

/** The 4×2 piece label: id, L × W, the fabric, the largest size, a Code-128 of the id. */
export const printFabricPieceLabel = ({ pieceId, itemCode, lengthIn, widthIn, upTo, bornOfRef }) => printHtmlLabel({
    title: `Fabric cut ${pieceId}`,
    html: `<div class="hdr">FABRIC CUT · ${esc(pieceId)}</div>
<div class="big">${esc(inText(lengthIn))} × ${esc(inText(widthIn))}</div>
<div class="line">${esc(itemCode)}</div>
<div class="line">${upTo ? `<b>${esc(upTo)}</b>` : 'no standard size'}${bornOfRef ? ` · from ${esc(bornOfRef)}` : ''}</div>
<div class="bc">${code128BSvg(String(pieceId))}<div class="bctxt">${esc(pieceId)}</div></div>`,
});

const FabricCutStock = ({ activeBrand = 'uniquity', currentUser = 'HQ' }) => {
    const brand = String(activeBrand || 'uniquity').toLowerCase();
    const [config, setConfig] = useState(null);
    const [pieces, setPieces] = useState([]);
    const [library, setLibrary] = useState(null);      // { fabrics, throwsByCode }
    const [nsYards, setNsYards] = useState({});        // code → yards
    const [nsAt, setNsAt] = useState(0);
    const [expanded, setExpanded] = useState(null);
    const [showHistory, setShowHistory] = useState(false);
    const [busy, setBusy] = useState(false);
    const [log, setLog] = useState([]);
    const say = (msg, tone = 'info') => setLog(prev => [{ t: new Date().toLocaleTimeString(), msg, tone }, ...prev].slice(0, 12));
    const [addForm, setAddForm] = useState({ code: '', lengthIn: '', widthIn: '', ref: '' });
    const [cvForm, setCvForm] = useState({ code: '', throws: '1', yardsPerThrow: '', bin: '', toBin: '' });
    const [armed, setArmed] = useState('');            // 'convert' | `scrap:<id>`

    useEffect(() => {
        const u1 = onSnapshot(doc(db, 'system', PILLOW_PRICING_DOC), s => setConfig(s.exists() ? { ...DEFAULT_PILLOW_PRICING, ...s.data() } : { ...DEFAULT_PILLOW_PRICING }));
        const u2 = onSnapshot(query(collection(db, 'fabric_pieces'), where('brand', '==', brand)), s => setPieces(s.docs.map(d => d.data())), () => setPieces([]));
        return () => { u1(); u2(); };
    }, [brand]);
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const snap = await getDocs(query(collection(db, 'Approved_Designs'), where('brandId', '==', brand)));
                const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                const throwsByCode = {};
                items.filter(isThrowItem).forEach(t => { const c = String(t.legacyErpId || t.itemId || '').toUpperCase(); if (c) throwsByCode[c] = t; });
                if (alive) setLibrary({ fabrics: items.filter(isFabricItem), throwsByCode });
            } catch (e) { if (alive) { setLibrary({ fabrics: [], throwsByCode: {} }); say(`Library read failed: ${e.message || e}`, 'err'); } }
        })();
        return () => { alive = false; };
    }, [brand]);

    const rows = useMemo(() => fabricRowsOf({ fabrics: (library && library.fabrics) || [], throwsByCode: (library && library.throwsByCode) || {}, pieces, config, nsYardsByCode: nsYards }), [library, pieces, config, nsYards]);
    const fabricByCode = useMemo(() => { const m = {}; ((library && library.fabrics) || []).forEach(f => { m[String(f.legacyErpId || f.itemId || '').toUpperCase()] = f; }); return m; }, [library]);
    const totals = useMemo(() => rows.reduce((a, r) => ({ pieces: a.pieces + r.pieces.length, fabrics: a.fabrics + (r.fabric ? 1 : 0) }), { pieces: 0, fabrics: 0 }), [rows]);

    const readNetSuite = async () => {
        const codes = rows.map(r => r.code).filter(Boolean);
        const loc = (BRAND_NETSUITE_MAP[brand] || {}).location;
        if (!codes.length || !loc) return;
        setBusy(true);
        try {
            const r = await fetchAvailabilityUnits(codes, loc);
            const m = {};
            Object.entries(r.map || {}).forEach(([code, v]) => { m[code] = v.available; });
            setNsYards(m); setNsAt(Date.now());
            say(`NetSuite read: ${Object.keys(m).length} of ${codes.length} fabric(s) answered${r.unitsKnown === false ? ' (units unknown — read as yards)' : ''}.`, 'ok');
        } catch (e) { say(`NetSuite read failed: ${e.message || e}`, 'err'); }
        setBusy(false);
    };

    const doAdd = async () => {
        const code = String(addForm.code || '').trim().toUpperCase();
        const fabric = fabricByCode[code] || null;
        const widthIn = Number(addForm.widthIn) || (fabric && fabric.manufacturingSpecs && Number(fabric.manufacturingSpecs.width)) || 0;
        if (!code || !(Number(addForm.lengthIn) > 0) || !(widthIn > 0)) { say('A cut needs a fabric code, a length and a width (inches).', 'err'); return; }
        setBusy(true);
        try {
            const p = await createFabricPiece({ itemCode: code, brand, lengthIn: Number(addForm.lengthIn), widthIn, bornOf: { from: 'ROLL', orderRef: addForm.ref || 'manual add' }, by: currentUser });
            const label = pieceLabelOf(p, { fabric, config });
            printFabricPieceLabel({ pieceId: p.id, itemCode: p.itemCode, lengthIn: p.lengthIn, widthIn: p.widthIn, upTo: label.text, bornOfRef: addForm.ref || 'manual add' });
            setAddForm({ code: '', lengthIn: '', widthIn: '', ref: '' });
            say(`＋ Cut ${p.id} added — ${inText(p.lengthIn)} × ${inText(p.widthIn)} ${p.itemCode}, ${label.text}. The label is printing.`, 'ok');
        } catch (e) { say(`Add failed: ${e.message || e}`, 'err'); }
        setBusy(false);
    };
    const doScrap = async (piece) => {
        if (armed !== `scrap:${piece.id}`) { setArmed(`scrap:${piece.id}`); return; }
        setArmed(''); setBusy(true);
        try {
            const fabric = fabricByCode[String(piece.itemCode || '').toUpperCase()] || null;
            const r = await scrapFabricPiece({ piece, by: currentUser, homeBin: (fabric && fabric.manufacturingSpecs && fabric.manufacturingSpecs.homeBin) || null });
            say(`🗑 ${piece.id} scrapped — ${r.scrapYd || 0} yd ${r.nsStatus === 'QUEUED' ? 'queued to NetSuite (11.1 sync queue)' : 'NOT posted (item unresolved — retry below)'}.`, r.nsStatus === 'QUEUED' ? 'ok' : 'err');
        } catch (e) { say(`Scrap failed: ${e.message || e}`, 'err'); }
        setBusy(false);
    };
    const doRetry = async (piece) => {
        setBusy(true);
        try { const r = await retryFabricScrap({ piece, by: currentUser }); say(`${piece.id}: ${r.nsStatus === 'QUEUED' ? 'scrap re-queued' : 'still unresolved — does the fabric carry a NetSuite id?'}`, r.nsStatus === 'QUEUED' ? 'ok' : 'err'); }
        catch (e) { say(`Retry failed: ${e.message || e}`, 'err'); }
        setBusy(false);
    };

    const cvFabric = fabricByCode[String(cvForm.code || '').trim().toUpperCase()] || null;
    const cvThrow = cvFabric ? ((library && library.throwsByCode) || {})[String(cvFabric.manufacturingSpecs && cvFabric.manufacturingSpecs.customData && cvFabric.manufacturingSpecs.customData.convertedFrom || '').toUpperCase()] || null : null;
    const cvPlan = cvFabric ? convertPlanOf({ throws: cvForm.throws, yardsPerThrow: cvForm.yardsPerThrow === '' ? undefined : cvForm.yardsPerThrow, fabric: cvFabric, throwItem: cvThrow }) : null;
    const doConvert = async () => {
        if (!cvPlan || !cvPlan.ok) return;
        if (armed !== 'convert') { setArmed('convert'); return; }
        setArmed(''); setBusy(true);
        try {
            const r = await convertThrowsToYardage({ fabric: cvFabric, throwItem: cvThrow, throws: cvForm.throws, yardsPerThrow: cvForm.yardsPerThrow === '' ? undefined : cvForm.yardsPerThrow, brand, by: currentUser, bin: cvForm.bin, toBin: cvForm.toBin });
            say(`⇄ Converted ${r.throws} × ${r.throwCode || 'throw'} → ${r.yards} yd ${r.fabricCode} — NetSuite build ${r.nsBuildId || 'posted'}. Read NetSuite again to see the yards.`, 'ok');
            setCvForm({ code: '', throws: '1', yardsPerThrow: '', bin: '', toBin: '' });
        } catch (e) { say(`Convert failed: ${e.message || e}`, 'err'); }
        setBusy(false);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', fontFamily: 'var(--sans)' }}>
            <div style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                    <div>
                        <h3 style={h}>🧵 Fabric Cut Stock</h3>
                        <div style={{ fontSize: '0.9rem', color: 'var(--ink-soft)' }}>
                            {totals.fabrics} fabric(s) in the library · {totals.pieces} cut(s) on the shelf. Every cut is labelled with the largest standard pillow it makes (one side, from the minimum cuts on Pillow Pricing). Roll yards = NetSuite's yards minus the cuts.
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <button onClick={readNetSuite} disabled={busy || !rows.length} style={btn(false, busy || !rows.length)}>↻ Read NetSuite yards</button>
                        <label style={{ ...mono, display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}><input type="checkbox" checked={showHistory} onChange={e => setShowHistory(e.target.checked)} /> history</label>
                    </div>
                </div>
                {nsAt ? <div style={{ ...mono, marginTop: '6px' }}>NetSuite read {new Date(nsAt).toLocaleTimeString()}</div> : null}
                {!library ? <div style={{ marginTop: '12px', color: 'var(--ink-soft)' }}>Reading the library…</div> : rows.length === 0 ? <div style={{ marginTop: '12px', color: 'var(--ink-soft)' }}>No fabrics yet — import them on 6.5 Tools → Pillow Pricing → Fabrics.</div> : (
                    <div style={{ overflowX: 'auto', marginTop: '12px' }}>
                        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem' }}>
                            <thead><tr>{['Fabric', 'Name', 'Throw', 'Width', 'Cuts', 'Cut yards', 'Roll yards', 'Longest cut', ''].map(t => <th key={t} style={{ ...mono, textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>{t}</th>)}</tr></thead>
                            <tbody>
                                {rows.map(r => (
                                    <React.Fragment key={r.key}>
                                        <tr style={{ background: expanded === r.key ? 'var(--paper-2)' : 'transparent' }}>
                                            <td style={{ padding: '6px 8px', fontWeight: 600 }}>{r.code}{r.railroad ? <span style={{ ...mono, marginLeft: '6px', color: '#a86b00' }}>railroad</span> : null}{!r.fabric ? <span style={{ ...mono, marginLeft: '6px', color: '#d9534f' }}>not in library</span> : null}</td>
                                            <td style={{ padding: '6px 8px', color: 'var(--ink-soft)' }}>{r.fabric ? r.fabric.itemName : '—'}</td>
                                            <td style={{ padding: '6px 8px' }}>{r.throwCode || '—'}</td>
                                            <td style={{ padding: '6px 8px' }}>{r.widthIn ? inText(r.widthIn) : '—'}</td>
                                            <td style={{ padding: '6px 8px' }}>{r.pieces.length}</td>
                                            <td style={{ padding: '6px 8px' }}>{r.avail.pieceYards}</td>
                                            <td style={{ padding: '6px 8px' }}>{r.avail.rollYards === null ? '—' : r.avail.rollYards}</td>
                                            <td style={{ padding: '6px 8px' }}>{r.avail.longestIn ? inText(r.avail.longestIn) : '—'}</td>
                                            <td style={{ padding: '6px 8px' }}><button onClick={() => setExpanded(expanded === r.key ? null : r.key)} style={btn(false, false)}>{expanded === r.key ? 'hide' : 'cuts'}</button></td>
                                        </tr>
                                        {expanded === r.key && (
                                            <tr><td colSpan={9} style={{ padding: '8px 16px 14px', background: 'var(--paper)' }}>
                                                {r.pieces.length === 0 && <div style={{ color: 'var(--ink-soft)' }}>No cuts on the shelf for this fabric — the roll only.</div>}
                                                {r.pieces.map(p => (
                                                    <div key={p.id} style={{ display: 'flex', gap: '14px', alignItems: 'center', padding: '5px 0', borderBottom: '1px dotted var(--line)', flexWrap: 'wrap' }}>
                                                        <span style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}>{p.id}</span>
                                                        <span style={{ fontWeight: 600 }}>{inText(p.lengthIn)} × {inText(p.widthIn)}</span>
                                                        <span style={{ color: p.label.key ? '#2e7d32' : 'var(--ink-soft)' }}>{p.label.text}{p.label.sizes.length > 1 ? ` (also ${p.label.sizes.slice(1).join(', ')})` : ''}</span>
                                                        <span style={{ ...mono }}>{p.bornOf && p.bornOf.orderRef ? `from ${p.bornOf.orderRef}` : ''}{p.createdAt ? ` · ${new Date(p.createdAt).toLocaleDateString()}` : ''}</span>
                                                        <span style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
                                                            <button onClick={() => printFabricPieceLabel({ pieceId: p.id, itemCode: p.itemCode, lengthIn: p.lengthIn, widthIn: p.widthIn, upTo: p.label.text, bornOfRef: p.bornOf && p.bornOf.orderRef })} style={btn(false, false)} title="Reprint the label">🖨</button>
                                                            <button onClick={() => doScrap(p)} disabled={busy} style={{ ...btn(false, busy), color: '#d9534f' }}>{armed === `scrap:${p.id}` ? 'press again to scrap' : '🗑 scrap'}</button>
                                                        </span>
                                                    </div>
                                                ))}
                                                {showHistory && r.history.map(p => (
                                                    <div key={p.id} style={{ display: 'flex', gap: '14px', padding: '4px 0', color: 'var(--ink-soft)', fontSize: '0.8rem', flexWrap: 'wrap' }}>
                                                        <span style={{ fontFamily: 'var(--mono)' }}>{p.id}</span><span>{inText(p.lengthIn)} × {inText(p.widthIn)}</span><span>{p.status}</span>
                                                        {p.status === 'SCRAP' && <span>{p.scrapYd || 0} yd · {p.nsStatus || '—'}{p.nsStatus === 'UNRESOLVED' && <button onClick={() => doRetry(p)} disabled={busy} style={{ ...btn(false, busy), marginLeft: '6px' }}>retry NetSuite</button>}</span>}
                                                    </div>
                                                ))}
                                            </td></tr>
                                        )}
                                    </React.Fragment>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '20px' }}>
                <div style={card}>
                    <h3 style={h}>＋ Add a cut on the shelf</h3>
                    <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginBottom: '10px' }}>A clean cut off the roll that is not going into a pillow today. Width defaults to the fabric's bolt width. The label prints.</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <input list="fcs-fabrics" value={addForm.code} onChange={e => setAddForm({ ...addForm, code: e.target.value })} placeholder="fabric code" style={field} />
                        <input value={addForm.ref} onChange={e => setAddForm({ ...addForm, ref: e.target.value })} placeholder="from (order / note)" style={field} />
                        <input value={addForm.lengthIn} onChange={e => setAddForm({ ...addForm, lengthIn: e.target.value })} placeholder="length off the roll (in)" style={field} />
                        <input value={addForm.widthIn} onChange={e => setAddForm({ ...addForm, widthIn: e.target.value })} placeholder="width (in) — blank = bolt width" style={field} />
                    </div>
                    <datalist id="fcs-fabrics">{rows.filter(r => r.fabric).map(r => <option key={r.code} value={r.code}>{r.fabric.itemName}</option>)}</datalist>
                    <div style={{ marginTop: '10px' }}><button onClick={doAdd} disabled={busy} style={btn(true, busy)}>Add the cut + print its label</button></div>
                </div>

                <div style={card}>
                    <h3 style={h}>⇄ Convert throws → yardage</h3>
                    <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginBottom: '10px' }}>A throw is typically 2 yards × the fabric's width; XL throws are longer. Posts a NetSuite build of the fabric-yardage item from the throw (the yardage item must be an assembly of the throw). Read NetSuite afterwards to see the yards.</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <input list="fcs-fabrics" value={cvForm.code} onChange={e => setCvForm({ ...cvForm, code: e.target.value })} placeholder="fabric (yardage) code" style={{ ...field, gridColumn: '1 / span 2' }} />
                        <input value={cvForm.throws} onChange={e => setCvForm({ ...cvForm, throws: e.target.value })} placeholder="throws" style={field} />
                        <input value={cvForm.yardsPerThrow} onChange={e => setCvForm({ ...cvForm, yardsPerThrow: e.target.value })} placeholder={cvThrow ? `yards per throw (${yardsPerThrowOf(cvThrow)} from the throw)` : 'yards per throw (2)'} style={field} />
                        <input value={cvForm.bin} onChange={e => setCvForm({ ...cvForm, bin: e.target.value })} placeholder="throw bin (optional)" style={field} />
                        <input value={cvForm.toBin} onChange={e => setCvForm({ ...cvForm, toBin: e.target.value })} placeholder="yardage bin (optional)" style={field} />
                    </div>
                    {cvFabric && (
                        <div style={{ marginTop: '8px', fontSize: '0.85rem' }}>
                            <div>{cvFabric.itemName} · throw <b>{cvFabric.manufacturingSpecs && cvFabric.manufacturingSpecs.customData && cvFabric.manufacturingSpecs.customData.convertedFrom ? cvFabric.manufacturingSpecs.customData.convertedFrom : '— (set the Throw Item Code on the fabric sheet)'}</b>{cvThrow ? '' : cvFabric.manufacturingSpecs && cvFabric.manufacturingSpecs.customData && cvFabric.manufacturingSpecs.customData.convertedFrom ? ' (not in the library)' : ''}{isRailroad(cvFabric) ? ' · railroad' : ''}</div>
                            {cvPlan && cvPlan.ok ? <div style={{ color: '#2e7d32' }}>{cvPlan.throws} throw(s) × {cvPlan.yardsPerThrow} yd = <b>{cvPlan.yards} yd</b> of {cvFabric.legacyErpId}</div> : cvPlan && cvPlan.errors.map((m, i) => <div key={i} style={{ color: '#d9534f' }}>{m}</div>)}
                        </div>
                    )}
                    <div style={{ marginTop: '10px' }}><button onClick={doConvert} disabled={busy || !cvPlan || !cvPlan.ok} style={btn(true, busy || !cvPlan || !cvPlan.ok)}>{armed === 'convert' ? 'Press again to post the NetSuite build' : 'Convert'}</button></div>
                </div>
            </div>

            {log.length > 0 && (
                <div style={{ ...card, fontFamily: 'var(--mono)', fontSize: '11px' }}>
                    {log.map((l, i) => <div key={i} style={{ color: l.tone === 'err' ? '#d9534f' : (l.tone === 'ok' ? '#2e7d32' : 'var(--ink-soft)'), padding: '2px 0' }}>{l.t} · {l.msg}</div>)}
                </div>
            )}
        </div>
    );
};

export default FabricCutStock;
