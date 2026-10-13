// ── 6.5 Tools → 🪟 Curtain Pricing (M2C Studio, 2026-10-12 — manager level and above, as Pillow Pricing) ──
//
// The ONE home of `system/curtain_pricing`, the chart `Shared/curtainPricing` looks a curtain up in.
// Stuart: "the curtains are sold by the fabric selection, then the pleat style … then the width group,
// and finally the length group … our work room when we send an order would want us to reference the
// appropriate line". Three cards:
//   1. THE CHART — drop the workroom's workbook; it is read through the shared workbook reader (with the
//      stored results of its formula cells — the low-width column is a formula and is 0 on every
//      half-width line), parsed by `Shared/curtainPricing` (every line keeps its sheet + row; what cannot
//      be read is refused by sheet and row), previewed with what would change, then Apply writes the
//      document whole. A line the sheet gets wrong is not sold until a corrected sheet is applied.
//   2. THE CHART IN FORCE — what is applied, and the workroom the lines are quoted to.
//   3. THE SWATCHES — drop the fabric pictures; a file name is read as fabric + colour against the chart
//      and each is filed in the Asset Gallery (the one capture writer, Shared/guideCapture) so the same
//      picture is the quick sell's tile and can ride an order line.
// Nothing here writes an order, a work order, a floor document or NetSuite. No native confirm (it
// freezes the browser tools): Apply and Load are two-press buttons.
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { db } from '../../firebase';
import { doc, onSnapshot, setDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { workbookFileToSheets } from '../Shared/customerControlFile';
import { saveGuideCapture } from '../Shared/guideCapture';
import {
    CURTAIN_PRICING_DOC, CURTAIN_BRAND, FABRIC_BY_WORKROOM, CHART_MAX_BYTES, swatchQueryTypesOf,
    parseCurtainWorkbook, curtainDocOf, chartBytesOf, chartDiffOf, issueSummaryOf, hasCurtainChart,
    curtainLiningsOf, curtainGroupsOf, linesOfChart, widthsWordOf,
    curtainSwatchesOf, swatchLoadPlanOf, swatchProductTypeOf, styleNameOf, styleNamesOf,
} from '../Shared/curtainPricing';

const mono = { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' };
const card = { background: '#fff', border: '1px solid var(--line)', padding: '20px', borderRadius: '2px' };
const h = { margin: '0 0 12px 0', fontFamily: 'var(--serif)', fontSize: '1.3rem', fontWeight: 500, color: 'var(--ink)' };
const field = { padding: '8px 10px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box', background: '#fff' };
const btn = (primary, disabled) => ({ padding: '10px 16px', background: disabled ? 'var(--paper-2)' : (primary ? 'var(--ink)' : 'transparent'), color: disabled ? 'var(--ink-soft)' : (primary ? '#fff' : 'var(--ink)'), border: primary ? 'none' : '1px solid var(--line)', cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: mono.fontFamily, fontSize: mono.fontSize, textTransform: mono.textTransform, letterSpacing: mono.letterSpacing });
const th = { ...mono, textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--line)' };
const td = { padding: '6px 8px', borderBottom: '1px solid var(--paper-2)', fontSize: '0.85rem', verticalAlign: 'top' };
const money = (v) => (v === null || v === undefined || v === '' ? '—' : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const TONE = { REFUSED: '#8a1f1f', GAP: '#a86b00', WARN: '#a86b00' };
const LEVEL_WORD = { REFUSED: 'not sold', GAP: 'not on the chart', WARN: 'check' };

const fileToDataUrl = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error || new Error('could not read the file')); r.readAsDataURL(file); });

// One style's fabrics with their linings and width groups — the same table for the preview and the chart in force.
const ChartTable = ({ chart }) => {
    if (!hasCurtainChart(chart)) return null;
    const count = {};
    linesOfChart(chart).forEach(l => { count[l.style] = (count[l.style] || 0) + 1; });
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {chart.styles.map(s => (
                <div key={s.key}>
                    <div style={{ ...mono, marginBottom: '4px', color: 'var(--ink)' }}>{s.label} · sheet {s.sheet} · {count[s.key] || 0} lines{styleNameOf(chart, s.key) !== s.label ? ` · shown as ${styleNameOf(chart, s.key)}` : ''}</div>
                    <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: 'var(--sans)' }}>
                        <thead><tr><th style={th}>Fabric</th><th style={th}>Cuttable</th><th style={th}>Lining</th><th style={th}>Width groups (finished panel)</th></tr></thead>
                        <tbody>
                            {chart.fabrics.map(f => {
                                const linings = curtainLiningsOf(chart, { style: s.key, fabric: f.key });
                                if (!linings.length) return null;
                                const groups = curtainGroupsOf(chart, { style: s.key, fabric: f.key, lining: linings[0].key });
                                return (
                                    <tr key={f.key}>
                                        <td style={{ ...td, fontWeight: 600 }}>{f.name}</td>
                                        <td style={td}>{f.cuttable === null || f.cuttable === undefined ? '—' : `${f.cuttable}"`}</td>
                                        <td style={td}>{linings.map(l => l.name).join(' · ')}</td>
                                        <td style={td}>{groups.map((g, i) => (
                                            <span key={g.n} style={{ color: g.bad ? '#8a1f1f' : 'inherit', textDecoration: g.bad ? 'line-through' : 'none' }} title={g.bad ? 'The sheet has this width range backwards — not sold' : `${g.word} · lengths ${g.minLength}"–${g.maxLength}"`}>
                                                {i ? ' · ' : ''}{g.word.replace(/ widths?$/, '')}: {g.range}
                                            </span>
                                        ))}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            ))}
        </div>
    );
};

const CurtainPricingAdmin = ({ currentUser }) => {
    const [live, setLive] = useState(undefined);       // system/curtain_pricing as served (null = none yet)
    const [prodTypes, setProdTypes] = useState([]);     // system/master_lists.prodTypes — the library's product types
    const [fileName, setFileName] = useState('');
    const [parsed, setParsed] = useState(null);
    const [armed, setArmed] = useState(false);          // Apply pressed once
    const [busy, setBusy] = useState(false);
    const [log, setLog] = useState([]);
    const say = (msg, tone = 'info') => setLog(prev => [{ t: new Date().toLocaleTimeString(), msg, tone }, ...prev].slice(0, 14));

    const [workroom, setWorkroom] = useState('');
    const [workroomDirty, setWorkroomDirty] = useState(false);
    const [names, setNames] = useState({});             // the name each top style is shown by, as typed
    const [namesDirty, setNamesDirty] = useState(false);

    const [assets, setAssets] = useState(null);         // the gallery's curtain pictures (null = not read yet)
    const [files, setFiles] = useState([]);             // the pictures dropped on the loader
    const [loadArmed, setLoadArmed] = useState(false);
    const [progress, setProgress] = useState(null);     // { done, total } while the load runs

    useEffect(() => {
        const u1 = onSnapshot(doc(db, 'system', CURTAIN_PRICING_DOC), (s) => setLive(s.exists() ? s.data() : null), () => setLive(null));
        const u2 = onSnapshot(doc(db, 'system', 'master_lists'), (s) => setProdTypes(s.exists() && Array.isArray(s.data().prodTypes) ? s.data().prodTypes : []), () => setProdTypes([]));
        return () => { u1(); u2(); };
    }, []);
    useEffect(() => { if (!workroomDirty) setWorkroom((live && live.workroom && live.workroom.name) || ''); }, [live, workroomDirty]);
    useEffect(() => { if (!namesDirty) setNames({ ...((live && live.styleNames) || {}) }); }, [live, namesDirty]);

    const readGallery = useCallback(async () => {
        try {
            const snap = await getDocs(query(collection(db, 'global_assets'), where('productType', 'in', swatchQueryTypesOf(prodTypes))));
            setAssets(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        } catch (e) { setAssets([]); setLog(prev => [{ t: new Date().toLocaleTimeString(), msg: `Could not read the Asset Gallery: ${e.message || e}`, tone: 'err' }, ...prev].slice(0, 14)); }
    }, [prodTypes]);
    useEffect(() => { readGallery(); }, [readGallery]);

    const hasChart = hasCurtainChart(live);
    const swatches = useMemo(() => curtainSwatchesOf(assets || [], live, { brand: CURTAIN_BRAND }), [assets, live]);
    const diff = useMemo(() => (parsed && parsed.ok ? chartDiffOf(live, parsed.chart) : null), [live, parsed]);
    const issues = useMemo(() => (parsed ? issueSummaryOf(parsed.issues) : []), [parsed]);
    const nextDoc = useMemo(() => (parsed && parsed.ok ? curtainDocOf({ chart: parsed.chart, live, fileName, by: currentUser || '', at: 0 }) : null), [parsed, live, fileName, currentUser]);
    const bytes = useMemo(() => (nextDoc ? chartBytesOf(nextDoc) : 0), [nextDoc]);
    const plan = useMemo(() => swatchLoadPlanOf(files.map(f => f.name), live, swatches), [files, live, swatches]);
    const newRows = plan.filter(r => r.status === 'NEW');

    const onFile = async (e) => {
        const f = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!f) return;
        setArmed(false);
        try {
            const p = parseCurtainWorkbook(await workbookFileToSheets(f, { cachedResults: true }));
            setParsed(p); setFileName(f.name);
            const refused = p.issues.filter(x => x.level === 'REFUSED').length;
            if (p.ok) say(`${f.name}: ${p.lines.length} lines read from ${p.sheetsRead.map(s => `"${s.name}"`).join(', ')}${refused ? ` · ${refused} of them not sold until the sheet is corrected` : ''}.`, refused ? 'warn' : 'ok');
            else say(`${f.name}: ${p.errors.length} problem(s) — nothing will be written until the workbook reads.`, 'err');
        } catch (err) { setParsed(null); say(`Could not read ${f.name}: ${err.message || err}`, 'err'); }
    };

    const apply = async () => {
        if (!parsed || !parsed.ok || !nextDoc) return;
        if (bytes > CHART_MAX_BYTES) { say(`This chart is too large for one document (${Math.round(bytes / 1024)} KB) — nothing was written.`, 'err'); return; }
        if (!armed) { setArmed(true); return; }
        setBusy(true);
        try {
            // the document WHOLE — never a merge: a line that left the sheet must leave the chart
            await setDoc(doc(db, 'system', CURTAIN_PRICING_DOC), { ...nextDoc, appliedAt: Date.now() });
            say(`Applied ${fileName}: ${parsed.lines.length} lines · ${parsed.chart.fabrics.length} fabrics · ${parsed.chart.styles.length} top styles.`, 'ok');
            setParsed(null); setFileName(''); setArmed(false);
        } catch (err) { say(`Apply failed: ${err.message || err}`, 'err'); }
        setBusy(false);
    };

    const saveWorkroom = async () => {
        if (!hasChart) return;
        setBusy(true);
        try {
            await setDoc(doc(db, 'system', CURTAIN_PRICING_DOC), { workroom: { name: String(workroom || '').trim(), fabricSuppliedBy: (live.workroom && live.workroom.fabricSuppliedBy) || FABRIC_BY_WORKROOM }, workroomSavedAt: Date.now(), workroomSavedBy: currentUser || '' }, { merge: true });
            setWorkroomDirty(false);
            say(`Workroom saved: ${String(workroom || '').trim() || '(blank)'}.`, 'ok');
        } catch (err) { say(`Save failed: ${err.message || err}`, 'err'); }
        setBusy(false);
    };

    const saveNames = async () => {
        if (!hasChart) return;
        const r = styleNamesOf(live, names);
        if (!r.ok) { r.errors.forEach(e => say(e.message, 'err')); return; }
        setBusy(true);
        try {
            // every style keyed (a cleared name is '' — never an empty map, which a merge would read as "replace")
            await setDoc(doc(db, 'system', CURTAIN_PRICING_DOC), { styleNames: r.names, styleNamesSavedAt: Date.now(), styleNamesSavedBy: currentUser || '' }, { merge: true });
            setNamesDirty(false);
            const set = live.styles.filter(s => r.names[s.key]).map(s => `${s.label} → ${r.names[s.key]}`);
            say(set.length ? `Shown names saved: ${set.join(' · ')}. The workroom is still quoted the sheet's own.` : 'Shown names cleared — every top style reads as its sheet names it.', 'ok');
        } catch (err) { say(`Save failed: ${err.message || err}`, 'err'); }
        setBusy(false);
    };

    const onPictures = (e) => {
        const list = Array.from((e.target.files) || []);
        e.target.value = '';
        setLoadArmed(false);
        setFiles(list);
    };

    const loadSwatches = async () => {
        if (!newRows.length) return;
        if (!loadArmed) { setLoadArmed(true); return; }
        setBusy(true);
        const type = swatchProductTypeOf(prodTypes);
        let done = 0, failed = 0;
        setProgress({ done, total: newRows.length });
        for (const row of newRows) {
            const file = files.find(f => f.name === row.name);
            try {
                const dataUrl = await fileToDataUrl(file);
                const isStyle = row.kind === 'STYLE';
                await saveGuideCapture({
                    dataUrl, kind: 'SWATCH', brandId: CURTAIN_BRAND, user: currentUser || '', productType: type,
                    name: isStyle ? row.style : `${row.fabric} ${row.colour}`,
                    code: isStyle ? row.style : row.fabric, finishId: isStyle ? '' : row.colour,
                    curtain: isStyle ? { style: row.style } : { fabric: row.fabric, colour: row.colour },
                });
            } catch (err) { failed++; say(`${row.name}: not filed — ${err.message || err}`, 'err'); }
            done++;
            setProgress({ done, total: newRows.length });
        }
        say(`${done - failed} picture(s) filed in the Asset Gallery as ${type}${failed ? ` · ${failed} failed` : ''}.`, failed ? 'warn' : 'ok');
        setFiles([]); setLoadArmed(false); setProgress(null);
        await readGallery();
        setBusy(false);
    };

    const fabricsWithout = hasChart ? live.fabrics.filter(f => !swatches.colours.some(c => c.fabricKey === f.key)) : [];
    const liveRefused = hasChart ? live.blocks.reduce((n, b) => n + b.groups.filter(g => g.bad).length, 0) : 0;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div style={card}>
                <h3 style={h}>🪟 Curtain chart</h3>
                <p style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: 'var(--ink-soft)' }}>
                    Drop the workroom's <b>Custom Drapery Pricing</b> workbook — one sheet per top style, one row per fabric · lining · width group · length band, with its cost and retail.
                    Every line keeps its <b>sheet and row number</b>: that is the line the workroom is quoted. Apply replaces the whole chart; a line the sheet gets wrong is not sold until a corrected sheet is applied.
                </p>
                <input type="file" accept=".xlsx" onChange={onFile} disabled={busy} style={{ fontSize: '0.85rem' }} />
                {parsed && !parsed.ok && (
                    <div style={{ marginTop: '12px', border: '1px solid #d9534f', background: '#fdf3f3', padding: '12px' }}>
                        <div style={{ ...mono, color: '#d9534f', marginBottom: '6px' }}>{fileName}: not applied — {parsed.errors.length} problem(s)</div>
                        {parsed.errors.map((e, i) => <div key={i} style={{ fontSize: '0.85rem', color: '#8a1f1f' }}>{e.message}</div>)}
                    </div>
                )}
                {parsed && parsed.ok && diff && (
                    <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div style={mono}>Preview · {fileName} · {parsed.lines.length} lines · {parsed.chart.fabrics.length} fabrics · {parsed.chart.styles.length} top styles · {parsed.chart.linings.length} linings · {parsed.chart.bands.length} length bands ({parsed.chart.bands[0].low}"–{parsed.chart.bands[parsed.chart.bands.length - 1].high}") · about {Math.round(bytes / 1024)} KB{parsed.sheetsSkipped.length ? ` · sheets not read: ${parsed.sheetsSkipped.join(', ')}` : ''}</div>
                        <ChartTable chart={parsed.chart} />
                        {issues.length > 0 && (
                            <div style={{ border: '1px solid var(--line)', background: 'var(--paper)', padding: '12px' }}>
                                <div style={{ ...mono, marginBottom: '6px', color: 'var(--ink)' }}>What the sheet gets wrong or does not carry</div>
                                {issues.map((x, i) => (
                                    <div key={i} style={{ fontSize: '0.85rem', color: TONE[x.level], marginBottom: '4px' }}>
                                        <b>{x.sheet}{x.fabric ? ` · ${x.fabric}` : ''}{x.rowsWord ? ` · rows ${x.rowsWord}` : ''}</b> — {x.count} line{x.count === 1 ? '' : 's'} {LEVEL_WORD[x.level]}. <span style={{ color: 'var(--ink-soft)' }}>{x.count > 1 ? 'The first: ' : ''}{x.first}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div style={{ fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <div>{diff.firstApply ? `First chart: ${diff.added.length} lines.` : `${diff.repriced.length} line(s) change price · ${diff.added.length} new · ${diff.removed.length} leave the chart · ${diff.unchanged} unchanged.`}</div>
                            {!diff.firstApply && diff.repriced.slice(0, 12).map((l, i) => <div key={`p${i}`} style={{ color: 'var(--ink-soft)' }}>· {l.sheet} row {l.row} — {l.fabric} · {l.lining} · {widthsWordOf(l.n)} · {l.lengthLow}–{l.lengthHigh}": retail {money(l.wasRetail)} → {money(l.retail)}, cost {money(l.wasCost)} → {money(l.cost)}</div>)}
                            {!diff.firstApply && diff.removed.slice(0, 8).map((l, i) => <div key={`r${i}`} style={{ color: '#a86b00' }}>· leaving: {l.styleLabel} · {l.fabric} · {l.lining} · {widthsWordOf(l.n)} · {l.lengthLow}–{l.lengthHigh}"</div>)}
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={apply} disabled={busy} style={btn(true, busy)}>{armed ? 'Press again to write the curtain chart' : 'Apply chart'}</button>
                            <button onClick={() => { setParsed(null); setFileName(''); setArmed(false); }} disabled={busy} style={btn(false, busy)}>Discard</button>
                        </div>
                    </div>
                )}
            </div>

            <div style={card}>
                <h3 style={h}>Chart in force</h3>
                {live === undefined ? <div style={{ color: 'var(--ink-soft)', fontSize: '0.9rem' }}>Reading…</div>
                    : !hasChart ? <div style={{ color: 'var(--ink-soft)', fontSize: '0.9rem' }}>No chart applied yet — a curtain cannot be priced until one is.</div>
                        : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                                <div style={mono}>
                                    {live.lineCount} lines{live.sourceFile ? ` · from ${live.sourceFile}` : ''}{live.appliedAt ? ` · applied ${new Date(live.appliedAt).toLocaleString()}` : ''}{live.appliedBy ? ` by ${live.appliedBy}` : ''}
                                    {liveRefused ? <span style={{ color: '#8a1f1f' }}> · {liveRefused} width group(s) not sold (struck through below)</span> : null}
                                </div>
                                <ChartTable chart={live} />
                                <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap', borderTop: '1px solid var(--paper-2)', paddingTop: '12px' }}>
                                    {live.styles.map(s => (
                                        <label key={s.key}><div style={mono}>{s.label} · shown as</div>
                                            <input value={names[s.key] || ''} onChange={e => { setNamesDirty(true); setNames(prev => ({ ...prev, [s.key]: e.target.value })); }} placeholder={s.label} style={{ ...field, width: '190px' }} /></label>
                                    ))}
                                    <button onClick={saveNames} disabled={busy || !namesDirty} style={btn(true, busy || !namesDirty)}>Save shown names</button>
                                    <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', flex: 1, minWidth: '260px' }}>
                                        The name on the seller's tile and on the order. Blank = the sheet's own. The workroom is always quoted the <b>sheet's</b> name and row.
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap', borderTop: '1px solid var(--paper-2)', paddingTop: '12px' }}>
                                    <label><div style={mono}>Workroom the lines are quoted to</div><input value={workroom} onChange={e => { setWorkroomDirty(true); setWorkroom(e.target.value); }} placeholder="the workroom's name" style={{ ...field, width: '260px' }} /></label>
                                    <button onClick={saveWorkroom} disabled={busy || !workroomDirty} style={btn(true, busy || !workroomDirty)}>Save workroom</button>
                                    <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', flex: 1, minWidth: '260px' }}>
                                        Fabric: <b>supplied by the workroom</b> — one cost per line, labour and fabric together. A sheet with labour and fabric in separate columns is not read yet.
                                    </div>
                                </div>
                            </div>
                        )}
            </div>

            <div style={card}>
                <h3 style={h}>Swatches</h3>
                <p style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: 'var(--ink-soft)' }}>
                    Drop the fabric pictures. A file name is read against the chart — <code>M2C DF UNIQ Winters 01 White.png</code> is <b>Winters · 01 White</b>; a file that names a top style (<code>Pinch Pleat.png</code>), by the sheet's word or the one it is shown by, is that style's own picture.
                    Each is filed in the <b>Asset Gallery</b>, where the quick sell reads its tiles. A gallery picture uploaded by hand reads the same when its pattern is the fabric, its finish the colour and its type a curtain type.
                </p>
                {!hasChart ? <div style={{ color: 'var(--ink-soft)', fontSize: '0.9rem' }}>Apply the chart first — the file names are read against its fabrics.</div> : (
                    <>
                        <input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={onPictures} disabled={busy} style={{ fontSize: '0.85rem' }} />
                        {plan.length > 0 && (
                            <div style={{ marginTop: '12px' }}>
                                <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: 'var(--sans)' }}>
                                    <thead><tr><th style={th}>File</th><th style={th}>Reads as</th><th style={th}>What happens</th></tr></thead>
                                    <tbody>
                                        {plan.map((r, i) => (
                                            <tr key={i}>
                                                <td style={td}>{r.name}</td>
                                                <td style={td}>{r.status === 'REFUSED' && !r.kind ? '—' : (r.kind === 'STYLE' ? `top style · ${r.style}` : `${r.fabric} · ${r.colour}`)}</td>
                                                <td style={{ ...td, color: r.status === 'NEW' ? '#2e7d32' : (r.status === 'HAVE' ? 'var(--ink-soft)' : '#8a1f1f') }}>{r.status === 'NEW' ? 'filed in the gallery' : (r.status === 'HAVE' ? 'skipped — already in the gallery' : `not filed — ${r.reason}`)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <div style={{ marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    <button onClick={loadSwatches} disabled={busy || !newRows.length} style={btn(true, busy || !newRows.length)}>{progress ? `Filing ${progress.done} of ${progress.total}…` : (loadArmed ? `Press again to file ${newRows.length} picture(s) in the gallery` : `Load ${newRows.length} picture(s)`)}</button>
                                    <button onClick={() => { setFiles([]); setLoadArmed(false); }} disabled={busy} style={btn(false, busy)}>Discard</button>
                                </div>
                            </div>
                        )}
                        <div style={{ marginTop: '16px', borderTop: '1px solid var(--paper-2)', paddingTop: '12px' }}>
                            <div style={{ ...mono, marginBottom: '8px' }}>
                                In the gallery now: {assets === null ? 'reading…' : `${swatches.colours.length} colourway(s) · ${Object.keys(swatches.styles).length} of ${live.styles.length} top-style picture(s)`}
                                {fabricsWithout.length ? <span style={{ color: '#a86b00' }}> · no swatch yet: {fabricsWithout.map(f => f.name).join(', ')}</span> : null}
                                {swatches.unmatched.length ? <span style={{ color: '#a86b00' }}> · {swatches.unmatched.length} curtain picture(s) name no fabric or style on the chart</span> : null}
                            </div>
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                {live.styles.map(s => (
                                    <div key={s.key} style={{ width: '96px' }} title={styleNameOf(live, s.key) === s.label ? s.label : `${styleNameOf(live, s.key)} — the sheet's ${s.label}`}>
                                        <div style={{ width: '96px', height: '64px', background: '#efe9e0', overflow: 'hidden', border: '1px solid var(--line)' }}>{swatches.styles[s.key] ? <img src={swatches.styles[s.key].url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ ...mono, padding: '6px', fontSize: '8px' }}>no picture yet</div>}</div>
                                        <div style={{ fontSize: '0.75rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{styleNameOf(live, s.key)}</div>
                                    </div>
                                ))}
                                {swatches.colours.map(c => (
                                    <div key={c.key} style={{ width: '96px' }} title={`${c.fabric} · ${c.colour}`}>
                                        <div style={{ width: '96px', height: '64px', background: '#efe9e0', overflow: 'hidden', border: '1px solid var(--line)' }}><img src={c.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>
                                        <div style={{ fontSize: '0.75rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.fabric}</div>
                                        <div style={{ ...mono, fontSize: '9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.colour}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </>
                )}
            </div>

            {log.length > 0 && (
                <div style={{ ...card, padding: '14px 20px' }}>
                    {log.map((l, i) => <div key={i} style={{ fontSize: '0.82rem', color: l.tone === 'err' ? '#8a1f1f' : (l.tone === 'warn' ? '#a86b00' : (l.tone === 'ok' ? '#2e7d32' : 'var(--ink-soft)')), marginBottom: '3px' }}><span style={{ ...mono, marginRight: '8px' }}>{l.t}</span>{l.msg}</div>)}
                </div>
            )}
        </div>
    );
};

export default CurtainPricingAdmin;
