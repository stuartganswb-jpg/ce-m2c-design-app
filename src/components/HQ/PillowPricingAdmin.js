// ── 6.5 Tools → 🧵 Pillow Pricing (Uniquity · S7, 2026-09-24; moved off 11. System Admin the same day —
// Stuart: manager level and above, "an easy tool to use and i can have more associates help") ────
//
// The ONE home of `system/pillow_pricing`, the table `Shared/pillowPricing` prices a custom pillow
// from. Two halves:
//   1. THE CHART — drop Stuart's `Pillows Size Price Chart.xlsx`; the sheet is read through the
//      shared workbook reader, parsed by `Shared/pillowPriceSheet` (refuses by cell), previewed as
//      the matrix with a diff against the live document, then Apply writes the matrix AND populates
//      `system/master_lists.pillowSizes` with the chart's sizes in chart order (Stuart: "future new
//      sizes are easy and clear to add").
//   2. THE BLANKS the chart does not carry — labour per custom seam, the detail charges (a list the
//      operator adds to: new kinds are created fairly often, prices change often), the allowances,
//      the rollup item code. Saved with merge; the matrix is untouched by this half.
// Nothing here is read by any screen until the board (step 3) prices from it. No document, work
// order, floor or NetSuite write. No native confirm (it freezes the browser tools): Apply is a
// two-press button.
import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../../firebase';
import { doc, onSnapshot, setDoc, updateDoc, collection, query, where, getDocs, writeBatch } from 'firebase/firestore';
import { workbookFileToSheets } from '../Shared/customerControlFile';
import { DEFAULT_PILLOW_PRICING, PILLOW_PRICING_DOC } from '../Shared/pillowPricing';
import {
    parsePillowPriceChart, mergePricingFromChart, masterListSizesOf, chartDiffOf, masterListDiffOf,
    detailRowsOf, detailsFromRows, numbersPatchOf, DETAIL_KINDS, DETAIL_PER,
} from '../Shared/pillowPriceSheet';
import { parseFabricSheet, planFabricRows, fabricUpdatePatchOf, fabricCreateDocOf, newFabricItemId, fabricPlanSummary } from '../Shared/pillowFabricSheet';
import { downloadFabricTemplate, readFabricWorkbook, FABRIC_TEMPLATE_NAME } from '../Shared/pillowFabricXlsx';
import { sizeCutTableOf, minCutPatchOf, sizesWithMinCuts, allowanceOf } from '../Shared/pillowCuts';
import { catalogTagPlanOf, catalogTagPatchesOf, sizesWithFillItems, missingYardageRowsOf, fabricCreatePlanOf, DEFAULT_FABRIC_WIDTH_IN, DEFAULT_YARDS_PER_THROW } from '../Shared/pillowCatalog';   // the catalog tags itself + the fabric items from the throws (S7, 2026-10-12)

const mono = { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' };
const card = { background: '#fff', border: '1px solid var(--line)', padding: '20px', borderRadius: '2px' };
const h = { margin: '0 0 12px 0', fontFamily: 'var(--serif)', fontSize: '1.3rem', fontWeight: 500, color: 'var(--ink)' };
const field = { padding: '8px 10px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box', background: '#fff' };
const btn = (primary, disabled) => ({ padding: '10px 16px', background: disabled ? 'var(--paper-2)' : (primary ? 'var(--ink)' : 'transparent'), color: disabled ? 'var(--ink-soft)' : (primary ? '#fff' : 'var(--ink)'), border: primary ? 'none' : '1px solid var(--line)', cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: mono.fontFamily, fontSize: mono.fontSize, textTransform: mono.textTransform, letterSpacing: mono.letterSpacing });
const money = (v) => (v === null || v === undefined || v === '' ? '—' : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`);

const PillowPricingAdmin = ({ currentUser, activeBrand }) => {
    const [live, setLive] = useState(null);          // system/pillow_pricing as served
    const [sizesList, setSizesList] = useState([]);  // system/master_lists.pillowSizes
    const [fileName, setFileName] = useState('');
    const [parsed, setParsed] = useState(null);
    const [armed, setArmed] = useState(false);       // Apply pressed once
    const [busy, setBusy] = useState(false);
    const [log, setLog] = useState([]);
    const say = (msg, tone = 'info') => setLog(prev => [{ t: new Date().toLocaleTimeString(), msg, tone }, ...prev].slice(0, 12));

    // the blanks
    const [perSeam, setPerSeam] = useState('');
    const [allow, setAllow] = useState('');
    const [rounding, setRounding] = useState('');
    const [rollup, setRollup] = useState('');
    const [rows, setRows] = useState([]);
    const [dirty, setDirty] = useState(false);

    // the fabrics half: sheet → plan against the Uniquity library → Apply
    const [fabFile, setFabFile] = useState('');
    const [fabParsed, setFabParsed] = useState(null);
    const [fabPlans, setFabPlans] = useState(null);
    const [fabArmed, setFabArmed] = useState(false);
    // the minimum cut per size (ONE side) — follows the served document until the operator types
    const [cutRows, setCutRows] = useState([]);
    const [cutDirty, setCutDirty] = useState(false);
    // THE CATALOG TAGS ITSELF (Stuart 2026-10-12): read once, preview per pattern, two-press Apply.
    const [catPlan, setCatPlan] = useState(null);
    const [catArmed, setCatArmed] = useState(false);
    const [fillArmed, setFillArmed] = useState(false);
    const [catOpen, setCatOpen] = useState({});
    const [fabPlan, setFabPlan] = useState(null);     // the fabric items from the throws (Stuart 2026-10-12)
    const [fabCreateArmed, setFabCreateArmed] = useState(false);

    useEffect(() => {
        const u1 = onSnapshot(doc(db, 'system', PILLOW_PRICING_DOC), (s) => setLive(s.exists() ? { ...DEFAULT_PILLOW_PRICING, ...s.data() } : { ...DEFAULT_PILLOW_PRICING }));
        const u2 = onSnapshot(doc(db, 'system', 'master_lists'), (s) => setSizesList(s.exists() && Array.isArray(s.data().pillowSizes) ? s.data().pillowSizes : []));
        return () => { u1(); u2(); };
    }, []);
    // the editor follows the served document until the operator types
    useEffect(() => {
        if (!live || dirty) return;
        setPerSeam(live.seamLabor && live.seamLabor.perSeam !== null && live.seamLabor.perSeam !== undefined ? String(live.seamLabor.perSeam) : '');
        setAllow(live.seamAllowanceIn === undefined || live.seamAllowanceIn === null ? '' : String(live.seamAllowanceIn));
        setRounding(live.yardRounding === undefined || live.yardRounding === null ? '' : String(live.yardRounding));
        setRollup((live.rollupItem && live.rollupItem.legacyErpId) || '');
        setRows(detailRowsOf(live));
    }, [live, dirty]);
    useEffect(() => {
        if (!live || cutDirty) return;
        setCutRows(sizeCutTableOf(live).map(r => ({ key: r.key, w: r.w, h: r.h, lengthIn: r.minCut && !r.minCut.derived ? String(r.minCut.lengthIn) : '', widthIn: r.minCut && !r.minCut.derived ? String(r.minCut.widthIn) : '', dflt: r.minCut })));
    }, [live, cutDirty]);

    const cfg = live || DEFAULT_PILLOW_PRICING;
    const liveSizes = useMemo(() => (Array.isArray(cfg.sizeOrder) && cfg.sizeOrder.length ? cfg.sizeOrder : Object.keys(cfg.prices || {})), [cfg]);
    const liveGroups = useMemo(() => Object.entries(cfg.fabricGroups || {}).sort((a, b) => (a[1].rank || 0) - (b[1].rank || 0)).map(([code, g]) => ({ code, ...g })), [cfg]);
    const diff = useMemo(() => (parsed && parsed.ok ? chartDiffOf(cfg, parsed) : null), [cfg, parsed]);
    const listDiff = useMemo(() => (parsed && parsed.ok ? masterListDiffOf(sizesList, parsed) : null), [sizesList, parsed]);
    const changedKey = useMemo(() => new Set((diff ? diff.changedCells : []).map(c => `${c.size}|${c.group}`)), [diff]);

    const onFile = async (e) => {
        const f = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!f) return;
        setArmed(false);
        try {
            const sheets = await workbookFileToSheets(f);
            const p = parsePillowPriceChart(sheets);
            setParsed(p); setFileName(f.name);
            if (p.ok) say(`${f.name}: ${p.groups.length} groups × ${p.sizeKeys.length} sizes read from sheet "${p.sheetName}".`, 'ok');
            else say(`${f.name}: ${p.errors.length} problem(s) — nothing will be written until the sheet reads clean.`, 'err');
        } catch (err) {
            setParsed(null); say(`Could not read ${f.name}: ${err.message || err}`, 'err');
        }
    };

    const apply = async () => {
        if (!parsed || !parsed.ok) return;
        if (!armed) { setArmed(true); return; }
        setBusy(true);
        try {
            const next = mergePricingFromChart(live, parsed);
            const sizes = masterListSizesOf(parsed);
            await setDoc(doc(db, 'system', PILLOW_PRICING_DOC), { ...next, brandId: 'uniquity', chartFile: fileName, chartAppliedAt: Date.now(), chartAppliedBy: currentUser || '' });
            await setDoc(doc(db, 'system', 'master_lists'), { pillowSizes: sizes }, { merge: true });
            say(`Applied ${fileName}: ${parsed.sizeKeys.length} sizes × ${parsed.groups.length} groups written; master list Pillow Sizes now ${sizes.join(', ')}.`, 'ok');
            setParsed(null); setFileName(''); setArmed(false);
        } catch (err) { say(`Apply failed: ${err.message || err}`, 'err'); }
        setBusy(false);
    };

    const saveBlanks = async () => {
        const n = numbersPatchOf({ perSeam, seamAllowanceIn: allow, yardRounding: rounding, rollupCode: rollup });
        const d = detailsFromRows(rows);
        const errs = [...n.errors.map(x => x.message), ...d.errors.map(x => x.message)];
        if (errs.length) { errs.forEach(m => say(m, 'err')); return; }
        setBusy(true);
        try {
            // setDoc(merge) for the scalars, then updateDoc for `details` — a merge would keep a removed
            // detail's key inside the nested map; updateDoc replaces the whole field.
            await setDoc(doc(db, 'system', PILLOW_PRICING_DOC), { ...n.patch, brandId: 'uniquity', blanksSavedAt: Date.now(), blanksSavedBy: currentUser || '' }, { merge: true });
            await updateDoc(doc(db, 'system', PILLOW_PRICING_DOC), { details: d.details });
            setDirty(false);
            say(`Saved: labour per seam ${n.patch.seamLabor.perSeam === null ? 'BLANK (a seamed pillow refuses to price)' : money(n.patch.seamLabor.perSeam)}, ${Object.keys(d.details).length} priced detail(s).`, 'ok');
        } catch (err) { say(`Save failed: ${err.message || err}`, 'err'); }
        setBusy(false);
    };
    const setRow = (i, k, v) => { setDirty(true); setRows(prev => prev.map((r, j) => (j === i ? { ...r, [k]: v } : r))); };
    const addRow = () => { setDirty(true); setRows(prev => [...prev, { code: '', label: '', kind: 'ADDON', per: 'EACH', price: '', builtIn: false }]); };
    const dropRow = (i) => { setDirty(true); setRows(prev => prev.filter((_, j) => j !== i)); };

    const liveGroupCodes = useMemo(() => Object.keys(cfg.fabricGroups || {}), [cfg]);
    const onFabricFile = async (e) => {
        const f = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!f) return;
        setFabArmed(false); setFabPlans(null);
        try {
            const sheets = await readFabricWorkbook(f);
            const p = parseFabricSheet(sheets, { groups: liveGroupCodes });
            setFabParsed(p); setFabFile(f.name);
            if (!p.ok) { say(`${f.name}: ${p.errors.length} problem(s) — nothing will be written until the sheet reads clean.`, 'err'); return; }
            // one read of the brand's library at preview time (2,800 records — not a listener)
            const items = await readLibrary();
            const plans = planFabricRows(p.rows, items);
            setFabPlans(plans);
            const n = fabricPlanSummary(plans);
            say(`${f.name}: ${p.rows.length} row(s) read — ${n.CREATE} to create, ${n.UPDATE} to update, ${n.SKIP} unchanged (against ${items.length} Uniquity items).`, 'ok');
        } catch (err) { setFabParsed(null); say(`Could not read ${f.name}: ${err.message || err}`, 'err'); }
    };
    const applyFabrics = async () => {
        if (!fabParsed || !fabParsed.ok || !fabPlans) return;
        if (!fabArmed) { setFabArmed(true); return; }
        setBusy(true);
        try {
            const at = Date.now();
            const todo = fabPlans.filter(pl => pl.action !== 'SKIP');
            let done = 0;
            for (let i = 0; i < todo.length; i += 400) {
                const batch = writeBatch(db);
                todo.slice(i, i + 400).forEach((pl, j) => {
                    if (pl.action === 'UPDATE') batch.update(doc(db, 'Approved_Designs', pl.item.id), fabricUpdatePatchOf(pl, { by: currentUser || '', at }));
                    else { const id = newFabricItemId('uniquity', i + j, at); batch.set(doc(db, 'Approved_Designs', id), fabricCreateDocOf(pl.row, { id, brandId: 'uniquity', by: currentUser || '', at })); }
                });
                await batch.commit();
                done += Math.min(400, todo.length - i);
            }
            const n = fabricPlanSummary(fabPlans);
            say(`Applied ${fabFile}: ${n.CREATE} created, ${n.UPDATE} updated, ${n.SKIP} unchanged (${done} write(s)).`, 'ok');
            setFabParsed(null); setFabPlans(null); setFabFile(''); setFabArmed(false);
        } catch (err) { say(`Apply failed: ${err.message || err}`, 'err'); }
        setBusy(false);
    };
    const readLibrary = async () => {
        const snap = await getDocs(query(collection(db, 'Approved_Designs'), where('brandId', '==', 'uniquity')));
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    };
    const downloadTemplate = async () => {
        setBusy(true);
        try {
            const items = await readLibrary();
            // the sheet also carries the colourways with no yardage item, proposed from the catalog's own codes
            const missing = missingYardageRowsOf(catalogTagPlanOf({ items, config: cfg }).missing);
            const r = await downloadFabricTemplate({ items, config: cfg, missingYardage: missing });
            say(`${FABRIC_TEMPLATE_NAME} downloaded — ${r.rows} fabric / trim row(s) from the library, ${r.sizes} cut column(s), ${r.missing} colourway(s) on the Yardage to create sheet. The office edits it and sends it back.`, 'ok');
        } catch (err) { say(`Download failed: ${err.message || err}`, 'err'); }
        setBusy(false);
    };
    const readCatalog = async () => {
        setBusy(true); setCatArmed(false); setFillArmed(false);
        try {
            const items = await readLibrary();
            const plan = catalogTagPlanOf({ items, config: cfg });
            setCatPlan(plan);
            setFabPlan(fabricCreatePlanOf({ items, config: cfg })); setFabCreateArmed(false);
            const c = plan.counts;
            say(`Catalog read: ${c.patterns} patterns, ${c.colourways} colourways — ${c.derived} price a group from their pillows, ${c.writes} library write(s) to make, ${c.missing} colourway(s) with no yardage item, ${c.fill} fill insert(s) proposed (${items.length} Uniquity items).`, 'ok');
        } catch (err) { setCatPlan(null); say(`Could not read the catalog: ${err.message || err}`, 'err'); }
        setBusy(false);
    };
    const applyCatalogTags = async () => {
        if (!catPlan || !catPlan.writes.length) return;
        if (!catArmed) { setCatArmed(true); return; }
        setBusy(true);
        try {
            const at = Date.now();
            const patches = catalogTagPatchesOf(catPlan.writes, { by: currentUser || '', at });
            for (let i = 0; i < patches.length; i += 400) {
                const batch = writeBatch(db);
                patches.slice(i, i + 400).forEach(p => batch.update(doc(db, 'Approved_Designs', p.id), p.patch));
                await batch.commit();
            }
            say(`Tagged: ${patches.length} item(s) written (${catPlan.writes.filter(w => w.path.endsWith('priceGroup')).length} price group(s), ${catPlan.writes.filter(w => w.path.endsWith('convertedFrom')).length} throw link(s)). Read the catalog again to see it clean.`, 'ok');
            setCatPlan(null); setCatArmed(false);
        } catch (err) { say(`Tagging failed: ${err.message || err}`, 'err'); }
        setBusy(false);
    };
    // THE FABRIC ITEMS FROM THE THROWS (Stuart 2026-10-12): app-only yardage items — the throw stays the NetSuite
    // item and a pillow relieves a fraction of it; 54" wide and 2 yd per throw for now; blank widths filled.
    const createFabricsFromThrows = async () => {
        if (!fabPlan || (!fabPlan.creates.length && !fabPlan.widths.length && !fabPlan.throws.length)) return;
        if (!fabCreateArmed) { setFabCreateArmed(true); return; }
        setBusy(true);
        try {
            const at = Date.now();
            const ops = [
                ...fabPlan.creates.map((c, i) => ({ kind: 'set', id: newFabricItemId('uniquity', i, at), data: fabricCreateDocOf(c.row, { id: newFabricItemId('uniquity', i, at), brandId: 'uniquity', by: currentUser || '', at }) })),
                ...fabPlan.widths.map(w => ({ kind: 'update', id: w.id, data: { 'manufacturingSpecs.width': w.to, updatedAt: at, catalogTagAt: at, catalogTagBy: currentUser || '' } })),
                ...fabPlan.throws.map(t => ({ kind: 'update', id: t.id, data: { 'manufacturingSpecs.customData.yardsPerThrow': t.to, updatedAt: at, catalogTagAt: at, catalogTagBy: currentUser || '' } })),
            ];
            for (let i = 0; i < ops.length; i += 400) {
                const batch = writeBatch(db);
                ops.slice(i, i + 400).forEach(op => { if (op.kind === 'set') batch.set(doc(db, 'Approved_Designs', op.id), op.data); else batch.update(doc(db, 'Approved_Designs', op.id), op.data); });
                await batch.commit();
            }
            say(`Fabric items: ${fabPlan.creates.length} created from their throws (${DEFAULT_FABRIC_WIDTH_IN}" wide, ${DEFAULT_YARDS_PER_THROW} yd per throw, app-only), ${fabPlan.widths.length} blank width(s) set to ${DEFAULT_FABRIC_WIDTH_IN}", ${fabPlan.throws.length} throw(s) stamped ${DEFAULT_YARDS_PER_THROW} yd. Read the catalog again to see it clean.`, 'ok');
            setFabPlan(null); setFabCreateArmed(false); setCatPlan(null); setCatArmed(false);
        } catch (err) { say(`Create failed: ${err.message || err}`, 'err'); }
        setBusy(false);
    };
    const applyFillInserts = async () => {
        if (!catPlan || !catPlan.fill.length) return;
        if (!fillArmed) { setFillArmed(true); return; }
        setBusy(true);
        try {
            await updateDoc(doc(db, 'system', PILLOW_PRICING_DOC), { sizes: sizesWithFillItems(live, catPlan.fill), fillSavedAt: Date.now(), fillSavedBy: currentUser || '' });
            say(`Fill inserts set: ${catPlan.fill.map(f => `${f.sizeKey} → ${f.code}`).join(', ')}.`, 'ok');
            setCatPlan(prev => (prev ? { ...prev, fill: [] } : prev)); setFillArmed(false);
        } catch (err) { say(`Save failed: ${err.message || err}`, 'err'); }
        setBusy(false);
    };
    const saveMinCuts = async () => {
        const p = minCutPatchOf(cutRows);
        if (!p.ok) { p.errors.forEach(m => say(m, 'err')); return; }
        setBusy(true);
        try {
            await updateDoc(doc(db, 'system', PILLOW_PRICING_DOC), { sizes: sizesWithMinCuts(live, p.minCuts), minCutsSavedAt: Date.now(), minCutsSavedBy: currentUser || '' });
            setCutDirty(false);
            say(`Minimum cuts saved: ${Object.values(p.minCuts).filter(Boolean).length} size(s) set by hand, the rest at pillow + ${allowanceOf(live)}" allowance each way.`, 'ok');
        } catch (err) { say(`Save failed: ${err.message || err}`, 'err'); }
        setBusy(false);
    };
    const setCut = (i, k, v) => { setCutDirty(true); setCutRows(prev => prev.map((r, j) => (j === i ? { ...r, [k]: v } : r))); };

    if (activeBrand !== 'uniquity') {
        return <div style={{ ...card, color: 'var(--ink-soft)' }}>Pillow pricing is a Uniquity table — switch the brand to Uniquity to edit it.</div>;
    }

    const matrix = (sizes, groups, priceOf, mark) => (
        <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontFamily: 'var(--sans)', fontSize: '0.85rem', minWidth: '100%' }}>
                <thead><tr>
                    <th style={{ ...mono, textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>Group</th>
                    <th style={{ ...mono, textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>Typical fabric</th>
                    {sizes.map(s => <th key={s} style={{ ...mono, textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>{s}</th>)}
                </tr></thead>
                <tbody>
                    {groups.map(g => (
                        <tr key={g.code}>
                            <td style={{ padding: '6px 8px', fontWeight: 600 }}>{g.code}</td>
                            <td style={{ padding: '6px 8px', color: 'var(--ink-soft)' }}>{g.label}</td>
                            {sizes.map(s => {
                                const v = priceOf(s, g.code);
                                const hot = mark && mark.has(`${s}|${g.code}`);
                                return <td key={s} style={{ padding: '6px 8px', textAlign: 'right', background: hot ? '#fff6e0' : 'transparent', fontWeight: hot ? 700 : 400 }}>{money(v)}</td>;
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div style={card}>
                <h3 style={h}>🧵 Pillow price chart</h3>
                <p style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: 'var(--ink-soft)' }}>
                    Drop the <b>Pillows Size Price Chart</b> workbook (header row <code>Group · Fabric · 20x12 · …</code>, one row per fabric group; a size reads wide × tall).
                    Apply replaces the matrix and sets the master list <b>Pillow Sizes</b> to the chart's sizes. Labour, details, fill and zipper items are never touched by the chart.
                </p>
                <input type="file" accept=".xlsx" onChange={onFile} disabled={busy} style={{ fontSize: '0.85rem' }} />
                {parsed && !parsed.ok && (
                    <div style={{ marginTop: '12px', border: '1px solid #d9534f', background: '#fdf3f3', padding: '12px' }}>
                        <div style={{ ...mono, color: '#d9534f', marginBottom: '6px' }}>{fileName}: not applied — {parsed.errors.length} problem(s)</div>
                        {parsed.errors.map((e, i) => <div key={i} style={{ fontSize: '0.85rem', color: '#8a1f1f' }}>{e.message}</div>)}
                    </div>
                )}
                {parsed && parsed.ok && diff && listDiff && (
                    <div style={{ marginTop: '16px' }}>
                        <div style={{ ...mono, marginBottom: '8px' }}>Preview · {fileName} · changed cells highlighted</div>
                        {matrix(parsed.sizeKeys, parsed.groups, (s, g) => parsed.prices[s][g], changedKey)}
                        <div style={{ fontSize: '0.85rem', marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {parsed.warnings.map((w, i) => <div key={i} style={{ color: '#a86b00' }}>⚠ {w}</div>)}
                            <div>{diff.firstImport ? `First import: ${diff.newCells} prices.` : `${diff.changedCells.length} price(s) change, ${diff.newCells} new cell(s).`}
                                {diff.addedSizes.length ? ` Sizes added: ${diff.addedSizes.join(', ')}.` : ''}{diff.removedSizes.length ? ` Sizes leaving the table: ${diff.removedSizes.join(', ')}.` : ''}
                                {diff.addedGroups.length ? ` Groups added: ${diff.addedGroups.join(', ')}.` : ''}{diff.removedGroups.length ? ` Groups leaving: ${diff.removedGroups.join(', ')}.` : ''}</div>
                            {diff.changedCells.slice(0, 20).map((c, i) => <div key={i} style={{ color: 'var(--ink-soft)' }}>· {c.size} / {c.group}: {money(c.from)} → {money(c.to)}</div>)}
                            <div>Master list Pillow Sizes → <b>{listDiff.next.join(', ')}</b>
                                {listDiff.removed.length ? <span style={{ color: '#a86b00' }}> · leaving the list: {listDiff.removed.join(', ')}</span> : null}
                                {listDiff.relabelled.length ? <span style={{ color: 'var(--ink-soft)' }}> · relabelled: {listDiff.relabelled.join(', ')}</span> : null}</div>
                        </div>
                        <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
                            <button onClick={apply} disabled={busy} style={btn(true, busy)}>{armed ? 'Press again to write the table + master list' : 'Apply chart'}</button>
                            <button onClick={() => { setParsed(null); setFileName(''); setArmed(false); }} disabled={busy} style={btn(false, busy)}>Discard</button>
                        </div>
                    </div>
                )}
            </div>

            <div style={card}>
                <h3 style={h}>Current table</h3>
                {liveSizes.length === 0 ? <div style={{ color: 'var(--ink-soft)', fontSize: '0.9rem' }}>No chart applied yet — a custom pillow cannot be priced until one is.</div>
                    : matrix(liveSizes, liveGroups, (s, g) => (cfg.prices[s] || {})[g], null)}
                <div style={{ ...mono, marginTop: '10px' }}>
                    {cfg.chartFile ? `From ${cfg.chartFile}${cfg.chartAppliedAt ? ` · applied ${new Date(cfg.chartAppliedAt).toLocaleString()}` : ''}${cfg.chartAppliedBy ? ` by ${cfg.chartAppliedBy}` : ''}` : ''}
                    {' · '}master list Pillow Sizes: {sizesList.length ? sizesList.join(', ') : '(empty)'}
                </div>
            </div>

            <div style={card}>
                <h3 style={h}>Labour, details and the blanks the chart does not carry</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(140px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                    <label><div style={mono}>Labour per custom seam ($)</div><input value={perSeam} onChange={e => { setDirty(true); setPerSeam(e.target.value); }} placeholder="blank = refuses" style={{ ...field, width: '100%' }} /></label>
                    <label><div style={mono}>Seam allowance (in)</div><input value={allow} onChange={e => { setDirty(true); setAllow(e.target.value); }} placeholder="0.5" style={{ ...field, width: '100%' }} /></label>
                    <label><div style={mono}>Yard rounding</div><input value={rounding} onChange={e => { setDirty(true); setRounding(e.target.value); }} placeholder="0.125" style={{ ...field, width: '100%' }} /></label>
                    <label><div style={mono}>Rollup item (non-inventory)</div><input value={rollup} onChange={e => { setDirty(true); setRollup(e.target.value); }} placeholder="CUSTOM PILLOW" style={{ ...field, width: '100%' }} /></label>
                </div>
                <div style={{ ...mono, marginBottom: '6px' }}>Custom details · a blank price = not offered (a pillow that needs it refuses to price)</div>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: 'var(--sans)', fontSize: '0.85rem' }}>
                    <thead><tr>{['Code', 'Label', 'Where', 'Per', 'Price ($)', ''].map(t => <th key={t} style={{ ...mono, textAlign: 'left', padding: '6px 4px', borderBottom: '1px solid var(--line)' }}>{t}</th>)}</tr></thead>
                    <tbody>
                        {rows.map((r, i) => (
                            <tr key={i}>
                                <td style={{ padding: '4px' }}><input value={r.code} disabled={r.builtIn} onChange={e => setRow(i, 'code', e.target.value)} style={{ ...field, width: '140px', background: r.builtIn ? 'var(--paper-2)' : '#fff' }} /></td>
                                <td style={{ padding: '4px' }}><input value={r.label} onChange={e => setRow(i, 'label', e.target.value)} style={{ ...field, width: '100%' }} /></td>
                                <td style={{ padding: '4px' }}><select value={r.kind} disabled={r.builtIn} onChange={e => setRow(i, 'kind', e.target.value)} style={{ ...field }}>{DETAIL_KINDS.map(k => <option key={k} value={k}>{k}</option>)}</select></td>
                                <td style={{ padding: '4px' }}><select value={r.per} disabled={r.builtIn} onChange={e => setRow(i, 'per', e.target.value)} style={{ ...field }}>{DETAIL_PER.map(k => <option key={k} value={k}>{k}</option>)}</select></td>
                                <td style={{ padding: '4px' }}><input value={r.price} onChange={e => setRow(i, 'price', e.target.value)} placeholder="blank" style={{ ...field, width: '100px', textAlign: 'right' }} /></td>
                                <td style={{ padding: '4px' }}>{!r.builtIn && <button onClick={() => dropRow(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', ...mono, color: '#d9534f' }}>remove</button>}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div style={{ marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button onClick={addRow} disabled={busy} style={btn(false, busy)}>+ Add a detail</button>
                    <button onClick={saveBlanks} disabled={busy || !dirty} style={btn(true, busy || !dirty)}>Save labour + details</button>
                    {dirty && <span style={{ ...mono, color: '#a86b00' }}>unsaved edits</span>}
                </div>
            </div>

            <div style={card}>
                <h3 style={h}>Minimum cut per size — ONE side</h3>
                <p style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: 'var(--ink-soft)' }}>
                    The rectangle one side of each standard pillow takes off the roll: length runs along the roll (the pillow's height), width across the bolt. A standard pillow takes two.
                    Blank = the default, pillow + {allowanceOf(cfg)}" allowance each way. A railroad fabric takes the cut turned. Every fabric cut in stock is labelled with the largest size that fits inside it.
                </p>
                {cutRows.length === 0 ? <div style={{ color: 'var(--ink-soft)', fontSize: '0.9rem' }}>Apply the price chart first — the sizes come from it.</div> : (
                    <table style={{ borderCollapse: 'collapse', fontFamily: 'var(--sans)', fontSize: '0.85rem' }}>
                        <thead><tr>{['Size (wide × tall)', 'Default (in)', 'Cut length (in)', 'Cut width (in)'].map(t => <th key={t} style={{ ...mono, textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>{t}</th>)}</tr></thead>
                        <tbody>
                            {cutRows.map((r, i) => (
                                <tr key={r.key}>
                                    <td style={{ padding: '4px 8px', fontWeight: 600 }}>{r.key}</td>
                                    <td style={{ padding: '4px 8px', color: 'var(--ink-soft)' }}>{r.dflt ? `${r.h + 2 * allowanceOf(cfg)} × ${r.w + 2 * allowanceOf(cfg)}` : '—'}</td>
                                    <td style={{ padding: '4px 8px' }}><input value={r.lengthIn} onChange={e => setCut(i, 'lengthIn', e.target.value)} placeholder="default" style={{ ...field, width: '90px', textAlign: 'right' }} /></td>
                                    <td style={{ padding: '4px 8px' }}><input value={r.widthIn} onChange={e => setCut(i, 'widthIn', e.target.value)} placeholder="default" style={{ ...field, width: '90px', textAlign: 'right' }} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
                <div style={{ marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button onClick={saveMinCuts} disabled={busy || !cutDirty} style={btn(true, busy || !cutDirty)}>Save minimum cuts</button>
                    {cutDirty && <span style={{ ...mono, color: '#a86b00' }}>unsaved edits</span>}
                </div>
            </div>

            <div style={card}>
                <h3 style={h}>Tag the catalog from itself</h3>
                <p style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: 'var(--ink-soft)' }}>
                    Every pattern's pillows are already priced by the chart (Bell/10P19x19 at $500 is group C at 19x19, and only C). Read the catalog and it derives each colourway's group from those prices,
                    writes it onto the fabric yardage item and the throws (the field the fabric sheet writes), links a fabric to its throw by code, proposes the fill insert per size from the inserts in the library,
                    and names the colourways whose yardage item does not exist yet (they ride the fabric sheet download as <b>Yardage to create</b>). Nothing else on an item is touched.
                </p>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button onClick={readCatalog} disabled={busy || liveSizes.length === 0} style={btn(false, busy || liveSizes.length === 0)}>⟳ Read the catalog</button>
                    {liveSizes.length === 0 && <span style={{ ...mono, color: '#a86b00' }}>apply the price chart first — the groups come from it</span>}
                    {catPlan && <span style={mono}>{catPlan.counts.patterns} patterns · {catPlan.counts.colourways} colourways · {catPlan.counts.derived} priced to a group · {catPlan.counts.tagged} tagged today · {catPlan.counts.missing} with no yardage item</span>}
                </div>
                {catPlan && (
                    <div style={{ marginTop: '16px' }}>
                        <div style={{ overflowX: 'auto', maxHeight: '420px', overflowY: 'auto', border: '1px solid var(--line)' }}>
                            <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: 'var(--sans)', fontSize: '0.85rem' }}>
                                <thead><tr>{['Pattern', 'Colourways', 'Group', 'From the prices', 'Writes', 'No yardage item'].map(t => <th key={t} style={{ ...mono, textAlign: 'left', padding: '6px 6px', borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, background: '#fff' }}>{t}</th>)}</tr></thead>
                                <tbody>
                                    {catPlan.rows.map(r => {
                                        const open = !!catOpen[r.pattern];
                                        const nWrites = r.colourways.reduce((s2, c) => s2 + c.writes.length, 0);
                                        const nMissing = r.colourways.filter(c => catPlan.missing.some(m => m.key === c.cw.key)).length;
                                        const mism = r.colourways.reduce((s2, c) => s2 + c.derived.mismatches.length, 0);
                                        const tone = r.agree === 'ALL' ? '#2e7d32' : (r.agree === 'SPLIT' ? '#a86b00' : '#d9534f');
                                        return (
                                            <React.Fragment key={r.pattern}>
                                                <tr onClick={() => setCatOpen(prev => ({ ...prev, [r.pattern]: !open }))} style={{ cursor: 'pointer', borderBottom: '1px solid var(--paper-2)' }}>
                                                    <td style={{ padding: '5px 6px', fontWeight: 600 }}>{open ? '▾' : '▸'} {r.label}</td>
                                                    <td style={{ padding: '5px 6px' }}>{r.colourways.length}</td>
                                                    <td style={{ padding: '5px 6px', fontWeight: 700, color: tone }}>{r.agree === 'SPLIT' ? r.groups.join(' / ') : (r.group || '—')}</td>
                                                    <td style={{ padding: '5px 6px', color: 'var(--ink-soft)' }}>{r.agree === 'ALL' ? 'every colourway agrees' : (r.agree === 'SPLIT' ? 'colourways differ — written per colourway' : 'no group can be read')}{mism ? ` · ${mism} price(s) off the column` : ''}</td>
                                                    <td style={{ padding: '5px 6px' }}>{nWrites || '—'}</td>
                                                    <td style={{ padding: '5px 6px', color: nMissing ? '#a86b00' : 'var(--ink-soft)' }}>{nMissing || '—'}</td>
                                                </tr>
                                                {open && r.colourways.map(c => (
                                                    <tr key={c.cw.key} style={{ background: 'var(--paper)', borderBottom: '1px solid var(--paper-2)' }}>
                                                        <td style={{ padding: '4px 6px 4px 24px', fontFamily: 'var(--mono)', fontSize: '11px' }}>{c.cw.key}{c.cw.colourName ? <span style={{ color: 'var(--ink-soft)' }}> · {c.cw.colourName}</span> : null}</td>
                                                        <td style={{ padding: '4px 6px', color: 'var(--ink-soft)' }}>{Object.keys(c.cw.pillows).length} pillow(s){c.cw.throws.STD ? ' · throw' : ''}{c.cw.throws.XL ? ' · XL' : ''}{c.cw.fabric ? ' · fabric' : ''}</td>
                                                        <td style={{ padding: '4px 6px', fontWeight: 600 }}>{c.derived.group || '—'}{c.cw.group && c.cw.group !== c.derived.group ? <span style={{ color: '#a86b00', fontWeight: 400 }}> (was {c.cw.group})</span> : null}</td>
                                                        <td style={{ padding: '4px 6px', color: 'var(--ink-soft)' }}>
                                                            {c.derived.reason === 'ONE' ? `${c.derived.agree} of ${c.derived.priced} prices in column ${c.derived.group}` : c.derived.reason === 'MOST' ? `${c.derived.agree} of ${c.derived.priced} in ${c.derived.group} — off: ${c.derived.mismatches.map(m => `${m.sizeKey} ${money(m.price)} (chart ${money(m.expected)})`).join(', ')}` : c.derived.reason === 'TIE' ? `tie between ${Object.keys(c.derived.candidates).join(' / ')} — nothing chosen` : c.derived.reason === 'NO_FIT' ? 'prices fit no column' : 'no priced pillow'}
                                                        </td>
                                                        <td style={{ padding: '4px 6px', color: 'var(--ink-soft)' }}>{c.writes.length ? c.writes.map(w => `${w.code}: ${w.path.endsWith('priceGroup') ? 'group' : 'throw'} ${w.from || '—'} → ${w.to}`).join(' · ') : '—'}</td>
                                                        <td style={{ padding: '4px 6px', color: '#a86b00' }}>{catPlan.missing.some(m => m.key === c.cw.key) ? 'no yardage item' : ''}</td>
                                                    </tr>
                                                ))}
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        {catPlan.fill.length > 0 && <div style={{ marginTop: '10px', fontSize: '0.85rem' }}>Fill inserts proposed: {catPlan.fill.map(f => <span key={f.sizeKey}><b>{f.sizeKey}</b> → {f.code} &nbsp;</span>)}</div>}
                        {fabPlan && (
                            <div style={{ marginTop: '12px', padding: '12px', border: '1px solid var(--line)', background: 'var(--paper)', fontSize: '0.85rem' }}>
                                <div style={{ ...mono, marginBottom: '6px' }}>Fabric items from the throws · app-only, {DEFAULT_FABRIC_WIDTH_IN}" wide, {DEFAULT_YARDS_PER_THROW} yd per throw</div>
                                <div>{fabPlan.counts.creates} colourway(s) have a throw and no fabric yardage item → create <b>Pattern/NNF</b> for each (the throw's group, linked to the throw, the throw's bin, no NetSuite id — a pillow pushes as a fraction of the throw){fabPlan.counts.noGroup ? <span style={{ color: '#a86b00' }}> · {fabPlan.counts.noGroup} of them have no group yet (apply the tags first, or set it on the sheet)</span> : null}.
                                    {fabPlan.counts.widths ? <> {fabPlan.counts.widths} existing fabric(s) with no width → {DEFAULT_FABRIC_WIDTH_IN}".</> : null}
                                    {fabPlan.counts.throws ? <> {fabPlan.counts.throws} standard throw(s) stamped {DEFAULT_YARDS_PER_THROW} yd per throw.</> : null}
                                    {fabPlan.counts.skipped ? <span style={{ color: 'var(--ink-soft)' }}> {fabPlan.counts.skipped} colourway(s) have pillows but no throw — bought by the yard, create on the sheet: {fabPlan.skipped.slice(0, 12).map(x => x.key).join(', ')}{fabPlan.skipped.length > 12 ? '…' : ''}.</span> : null}</div>
                                <div style={{ marginTop: '8px' }}>
                                    <button onClick={createFabricsFromThrows} disabled={busy || (!fabPlan.creates.length && !fabPlan.widths.length && !fabPlan.throws.length)} style={btn(true, busy || (!fabPlan.creates.length && !fabPlan.widths.length && !fabPlan.throws.length))}>{fabCreateArmed ? `Press again to create ${fabPlan.creates.length} + fix ${fabPlan.widths.length + fabPlan.throws.length}` : `Create the fabric items from the throws (${fabPlan.creates.length})`}</button>
                                </div>
                            </div>
                        )}
                        <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            <button onClick={applyCatalogTags} disabled={busy || !catPlan.writes.length} style={btn(true, busy || !catPlan.writes.length)}>{catArmed ? `Press again to write ${catPlan.writes.length} field(s)` : `Apply the tags (${catPlan.writes.length})`}</button>
                            {catPlan.fill.length > 0 && <button onClick={applyFillInserts} disabled={busy} style={btn(false, busy)}>{fillArmed ? 'Press again to set the fill inserts' : `Set the fill inserts (${catPlan.fill.length})`}</button>}
                            <button onClick={() => { setCatPlan(null); setCatArmed(false); setFillArmed(false); setFabPlan(null); setFabCreateArmed(false); }} disabled={busy} style={btn(false, busy)}>Discard</button>
                        </div>
                    </div>
                )}
            </div>

            <div style={card}>
                <h3 style={h}>Fabrics — the yardage items and trims the board picks from</h3>
                <p style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: 'var(--ink-soft)' }}>
                    Download the sheet — pre-filled with every fabric and trim in the library, its throw code, and one computed column per size with the one-side cut length that fabric needs — the office edits it (or adds rows) and drops it back here.
                    A known code UPDATES the item; a new code CREATES it in the Uniquity library. Base price and the NetSuite id are never touched unless typed. Cuts are not items: they live in Fabric Cut Stock.
                </p>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button onClick={downloadTemplate} disabled={busy} style={btn(false, busy)}>⬇ Download the fabric sheet</button>
                    <input type="file" accept=".xlsx" onChange={onFabricFile} disabled={busy} style={{ fontSize: '0.85rem' }} />
                    {liveGroupCodes.length === 0 && <span style={{ ...mono, color: '#a86b00' }}>apply the price chart first — the groups a fabric may use come from it</span>}
                </div>
                {fabParsed && !fabParsed.ok && (
                    <div style={{ marginTop: '12px', border: '1px solid #d9534f', background: '#fdf3f3', padding: '12px' }}>
                        <div style={{ ...mono, color: '#d9534f', marginBottom: '6px' }}>{fabFile}: not applied — {fabParsed.errors.length} problem(s)</div>
                        {fabParsed.errors.map((e, i) => <div key={i} style={{ fontSize: '0.85rem', color: '#8a1f1f' }}>{e.message}</div>)}
                    </div>
                )}
                {fabParsed && fabParsed.ok && fabPlans && (
                    <div style={{ marginTop: '16px' }}>
                        <div style={{ ...mono, marginBottom: '8px' }}>Preview · {fabFile} · {(() => { const n = fabricPlanSummary(fabPlans); return `${n.CREATE} create · ${n.UPDATE} update · ${n.SKIP} unchanged`; })()}</div>
                        {fabParsed.warnings.map((w, i) => <div key={i} style={{ fontSize: '0.85rem', color: '#a86b00' }}>⚠ {w}</div>)}
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: 'var(--sans)', fontSize: '0.85rem' }}>
                                <thead><tr>{['Row', 'Code', 'Name', 'Type', 'Group', 'Width', 'Action', 'What changes'].map(t => <th key={t} style={{ ...mono, textAlign: 'left', padding: '6px 6px', borderBottom: '1px solid var(--line)' }}>{t}</th>)}</tr></thead>
                                <tbody>
                                    {fabPlans.map((pl, i) => (
                                        <tr key={i} style={{ opacity: pl.action === 'SKIP' ? 0.55 : 1 }}>
                                            <td style={{ padding: '4px 6px' }}>{pl.row.rowNo}</td>
                                            <td style={{ padding: '4px 6px', fontWeight: 600 }}>{pl.row.code}</td>
                                            <td style={{ padding: '4px 6px' }}>{pl.row.name}</td>
                                            <td style={{ padding: '4px 6px' }}>{pl.row.type}{pl.row.railroad ? ' · railroad' : ''}</td>
                                            <td style={{ padding: '4px 6px' }}>{pl.row.priceGroup || '—'}</td>
                                            <td style={{ padding: '4px 6px' }}>{pl.row.width == null ? '—' : `${pl.row.width}"`}</td>
                                            <td style={{ padding: '4px 6px', color: pl.action === 'CREATE' ? '#2e7d32' : (pl.action === 'UPDATE' ? '#a86b00' : 'var(--ink-soft)') }}>{pl.action}{pl.was ? ` (was ${pl.was})` : ''}</td>
                                            <td style={{ padding: '4px 6px', color: 'var(--ink-soft)' }}>{pl.action === 'CREATE' ? 'new item' : (pl.changes.length ? pl.changes.map(c => `${c.path.replace('manufacturingSpecs.', '').replace('customData.', '')}: ${c.from === undefined || c.from === '' ? '—' : String(c.from)} → ${String(c.to)}`).join(' · ') : '—')}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
                            <button onClick={applyFabrics} disabled={busy || fabPlans.every(pl => pl.action === 'SKIP')} style={btn(true, busy || fabPlans.every(pl => pl.action === 'SKIP'))}>{fabArmed ? 'Press again to write the items' : 'Apply fabrics'}</button>
                            <button onClick={() => { setFabParsed(null); setFabPlans(null); setFabFile(''); setFabArmed(false); }} disabled={busy} style={btn(false, busy)}>Discard</button>
                        </div>
                    </div>
                )}
            </div>

            {log.length > 0 && (
                <div style={{ ...card, fontFamily: 'var(--mono)', fontSize: '11px' }}>
                    {log.map((l, i) => <div key={i} style={{ color: l.tone === 'err' ? '#d9534f' : (l.tone === 'ok' ? '#2e7d32' : 'var(--ink-soft)'), padding: '2px 0' }}>{l.t} · {l.msg}</div>)}
                </div>
            )}
        </div>
    );
};

export default PillowPricingAdmin;
