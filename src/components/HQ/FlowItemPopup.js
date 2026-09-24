// 4.7 FLOW STOCK · THE ITEM POPUP (Stuart 2026-09-24): "clicking the item# should bring up a pop up window
// that allows us to print the spec sheet, see all images in the asset gallery, see the program print (pdf),
// and ideally has a small 3d viewer engine that can open the 3d node of that part, and a link to the item in
// the master library."
//
// Step 3 of the board: the Master Library link, the gallery images and the program print. (Spec sheet and
// the 3D node are steps 4 and 5.) READ-ONLY — it opens things; it writes nothing.
//
// What it reads, and from whom:
//   • the picture at the top      → Shared/partPicture.partImageOf (the label's picker: own → mill → species → kit)
//   • the program print           → Shared/programPrints.resolvePrintUrlAny over the SAME candidate names the
//                                   Master Library 🖨 button tries (LibraryTab, "🖨 Print"), for this item and
//                                   — labelled as such — for its mill item, plus the PDF uploaded on the record
//   • the gallery images          → global_assets, found the ways 14.5 links them (associatedParts = library doc
//                                   id; patternId = the mill code), shown THIS SKU first (its own finishes —
//                                   the ones the quote bills as this SKU) and then the rest of the pattern.
//                                   This is a browse list, not partImage.galleryImageForPart — that one picks
//                                   the single photo the 📷 tools may WRITE onto a record, and stays untouched.
import React, { useEffect, useMemo, useState } from 'react';
import { db } from '../../firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { subscribeProgramPrints, resolvePrintUrlAny } from '../Shared/programPrints';
import { partImageOf } from '../Shared/partPicture';
import { splitCode, normFinish } from '../Shared/partImage';
import { millBaseOf } from '../Shared/finishRouting';

const theme = {
    paper: '#faf8f4', paper2: '#f2efe8', ink: '#1c1a16', inkSoft: '#524e46',
    brass: '#b08d57', brassDark: '#7d6031', line: '#d9d4ca', redDark: '#a8322e', blueDark: '#2a5f9e',
    mono: "'Courier New', monospace", sans: 'var(--sans)', serif: 'var(--serif)',
};
const U = (v) => String(v ?? '').trim().toUpperCase();
const money = (v) => (v === null || v === undefined || !Number.isFinite(Number(v))) ? '—' : `$${Number(v).toFixed(2)}`;
const codeOf = (p) => String((p?.legacyErpId && p.legacyErpId !== 'PENDING' ? p.legacyErpId : p?.itemId) || '').trim();
// The Master Library 🖨 button's candidate names, in its order (LibraryTab — legacyErpId, itemName,
// itemId, programNum). Its fifth candidate is the unsaved edit field, which a read-only popup has not got.
const printNamesOf = (p) => (p ? [p.legacyErpId, p.itemName, p.itemId, p.manufacturingSpecs?.programNum] : []);
// Screens the gallery itself never shows as photographs: program prints live in their own collection,
// and CPQ screen captures (guide books / display boards) carry a patternId but are not pictures of a part.
const isPhoto = (a) => a && a.category !== 'PROGRAM_PRINT' && !a.guideCapture && !a.displayCapture && (a.thumbnailUrl || a.url || a.originalUrl);

const FlowItemPopup = ({ row, family, findPart, kits = [], speciesBase = null, stock, bo, onOpenInLibrary, onClose }) => {
    const part = row?.part || null;
    const code = row?.code || codeOf(part);
    const millCode = millBaseOf(U(code));
    const millPart = millCode && millCode !== U(code) ? findPart(millCode) : null;
    const picture = useMemo(() => partImageOf(part, findPart, kits, speciesBase), [part, findPart, kits, speciesBase]);

    // ── PROGRAM PRINTS — the same map the Master Library subscribes to ──────────────────────
    const [printMap, setPrintMap] = useState(null);
    useEffect(() => subscribeProgramPrints(db, setPrintMap), []);
    const ownPrint = printMap ? resolvePrintUrlAny(printMap, printNamesOf(part)) : null;
    const millPrint = printMap && millPart ? resolvePrintUrlAny(printMap, printNamesOf(millPart)) : null;
    const uploadedPdf = part?.manufacturingSpecs?.pdfUrl || '';
    const millUploadedPdf = millPart?.manufacturingSpecs?.pdfUrl || '';

    // ── GALLERY — at most three indexed reads, never the whole collection ─────────────────────
    const [assets, setAssets] = useState(null);
    const [assetError, setAssetError] = useState('');
    useEffect(() => {
        let live = true;
        const ids = [...new Set([part?.id, millPart?.id].filter(Boolean))];
        const pattern = splitCode(code)?.pattern || '';
        const reads = [
            ...ids.map(id => getDocs(query(collection(db, 'global_assets'), where('associatedParts', 'array-contains', id)))),
            ...(pattern ? [getDocs(query(collection(db, 'global_assets'), where('patternId', '==', pattern)))] : []),
        ];
        Promise.all(reads).then(snaps => {
            if (!live) return;
            const seen = new Map();
            snaps.forEach(s => s.docs.forEach(d => { if (!seen.has(d.id)) seen.set(d.id, { id: d.id, ...d.data() }); }));
            setAssets([...seen.values()].filter(isPhoto));
        }).catch(e => { if (live) { setAssetError(e.message || String(e)); setAssets([]); } });
        return () => { live = false; };
    }, [part, millPart, code]);

    // THIS SKU = an asset whose finish is one the quote bills as this SKU (row.finishes — every paint for
    // /P, the one plating for /EPn) or IS this code's suffix; an asset naming this very VARIANT record (14.5
    // links single items to the mill doc, so a link to a variant doc can only mean this SKU); and, on a mill
    // row, the pattern's no-finish pictures. Photos of the mill doc in some finish are "other finishes".
    const groups = useMemo(() => {
        if (!assets) return null;
        const own = new Set([...(row?.finishes || []), splitCode(code)?.finish || ''].map(normFinish).filter(Boolean));
        const isVariant = U(code).includes('/');
        const mine = [], rest = [];
        assets.forEach(a => {
            const fin = normFinish(a.finishId);
            const direct = isVariant && part && (a.associatedParts || []).includes(part.id);
            const byFinish = !!fin && own.has(fin);
            const millPlain = !isVariant && !fin;
            ((direct || byFinish || millPlain) ? mine : rest).push(a);
        });
        const byName = (x, y) => String(x.finishId || '').localeCompare(String(y.finishId || '')) || String(x.name || '').localeCompare(String(y.name || ''));
        return { mine: mine.sort(byName), rest: rest.sort(byName) };
    }, [assets, row, code, part]);

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const btn = (enabled) => ({ padding: '9px 14px', border: `1px solid ${enabled ? theme.ink : theme.line}`, background: enabled ? '#fff' : theme.paper2, color: enabled ? theme.ink : theme.inkSoft, fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.08em', cursor: enabled ? 'pointer' : 'default', whiteSpace: 'nowrap' });
    const lbl = { fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: theme.inkSoft };
    const open = (url) => url && window.open(url, '_blank', 'noopener');

    const tile = (a) => (
        <button key={a.id} onClick={() => open(a.originalUrl || a.url || a.thumbnailUrl)} title={`${a.name || ''}${a.fabCode ? ` · ${a.fabCode}` : ''} — open full size`}
            style={{ border: `1px solid ${theme.line}`, background: '#fff', padding: '4px', cursor: 'zoom-in', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', width: '132px' }}>
            <img src={a.thumbnailUrl || a.url || a.originalUrl} alt={a.name || ''} style={{ width: '122px', height: '122px', objectFit: 'contain', background: theme.paper }} loading="lazy" />
            <span style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.inkSoft, maxWidth: '122px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.finishId || a.name || a.id}</span>
        </button>
    );

    const printLine = (label, url, note) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <button style={btn(!!url)} disabled={!url} onClick={() => open(url)}>🖨 {label}</button>
            {!url && <span style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>{note}</span>}
        </div>
    );

    return (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,.45)', zIndex: 5000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px', overflow: 'auto' }}>
            <div onClick={e => e.stopPropagation()} style={{ background: theme.paper, width: 'min(980px, 100%)', border: `1px solid ${theme.line}`, boxShadow: '0 20px 60px rgba(0,0,0,.25)', fontFamily: theme.sans, color: theme.ink }}>
                {/* header */}
                <div style={{ display: 'flex', gap: '18px', padding: '20px 22px', borderBottom: `1px solid ${theme.line}`, alignItems: 'flex-start' }}>
                    <div style={{ width: '120px', height: '120px', flex: '0 0 120px', background: '#fff', border: `1px solid ${theme.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {picture.url
                            ? <img src={picture.url} alt={code} style={{ maxWidth: '112px', maxHeight: '112px', objectFit: 'contain' }} title={picture.from ? `picture of ${picture.from}` : ''} />
                            : <span style={{ ...lbl, fontSize: '9px' }}>no picture</span>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: theme.mono, fontSize: '1.3rem', fontWeight: 700 }}>{code}</div>
                        <div style={{ fontSize: '0.9rem', color: theme.inkSoft, marginTop: '2px' }}>{part?.itemName || family?.name || ''}</div>
                        {picture.from && <div style={{ ...lbl, fontSize: '9px', marginTop: '4px' }}>picture borrowed from {picture.from}</div>}
                        <div style={{ display: 'flex', gap: '22px', flexWrap: 'wrap', marginTop: '12px', fontFamily: theme.mono, fontSize: '12px' }}>
                            <div><div style={lbl}>Fabricut #</div>{row?.fabCode || '—'}</div>
                            <div><div style={lbl}>Our price to Fabricut</div>{row?.ourPrice ? money(row.ourPrice.value) : '—'}</div>
                            <div><div style={lbl}>Fabricut sells at</div>{money(row?.theirPrice)}</div>
                            <div><div style={lbl}>Avail</div>{stock ? Math.round(stock.avail) : '—'}</div>
                            <div><div style={lbl}>On Ord</div>{stock ? Math.round(stock.onOrd) : '—'}</div>
                            <div><div style={lbl}>BO</div><span style={{ color: bo?.qty ? theme.redDark : theme.ink }}>{bo ? bo.qty : 0}</span></div>
                        </div>
                        {row?.finishes?.length > 0 && <div style={{ ...lbl, marginTop: '8px', textTransform: 'none', letterSpacing: 0 }}>Sold as this SKU for: {row.finishes.join(' · ')}</div>}
                    </div>
                    <button onClick={onClose} title="Close (Esc)" style={{ background: 'none', border: 'none', fontSize: '1.6rem', color: theme.inkSoft, cursor: 'pointer', lineHeight: 1 }}>×</button>
                </div>

                {/* actions */}
                <div style={{ padding: '16px 22px', borderBottom: `1px solid ${theme.line}`, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <button style={btn(!!part)} disabled={!part} onClick={() => part && onOpenInLibrary(part.id)} title="Open this record in 4. Master Library">📖 Open in Master Library</button>
                        {millPart && <button style={btn(true)} onClick={() => onOpenInLibrary(millPart.id)} title="Open the mill item this is a finish of">📖 Mill item {millCode}</button>}
                    </div>
                    <div style={lbl}>Program print</div>
                    {printMap === null
                        ? <span style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>Looking for prints…</span>
                        : (
                            <>
                                {printLine(`Print for ${code}`, ownPrint, 'no program print on file for this item')}
                                {millPart && printLine(`Print for the mill item ${millCode}`, millPrint, 'no program print on file for the mill item either')}
                                {uploadedPdf && printLine(`PDF uploaded on ${code}`, uploadedPdf, '')}
                                {millUploadedPdf && printLine(`PDF uploaded on ${millCode}`, millUploadedPdf, '')}
                            </>
                        )}
                </div>

                {/* gallery */}
                <div style={{ padding: '16px 22px 22px' }}>
                    <div style={{ ...lbl, marginBottom: '10px' }}>Asset Gallery{assets ? ` · ${assets.length} image${assets.length === 1 ? '' : 's'}` : ''}</div>
                    {assetError && <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.redDark }}>Could not read the gallery: {assetError}</div>}
                    {!assets && <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>Loading images…</div>}
                    {groups && !assets.length && !assetError && <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>No images in the Asset Gallery for {millCode || code}.</div>}
                    {groups && groups.mine.length > 0 && (
                        <>
                            <div style={{ fontFamily: theme.mono, fontSize: '11px', margin: '4px 0 8px' }}>This SKU · {groups.mine.length}</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>{groups.mine.map(tile)}</div>
                        </>
                    )}
                    {groups && groups.rest.length > 0 && (
                        <>
                            <div style={{ fontFamily: theme.mono, fontSize: '11px', margin: '4px 0 8px', color: theme.inkSoft }}>Other finishes of {millCode || code} · {groups.rest.length}</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>{groups.rest.map(tile)}</div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FlowItemPopup;
