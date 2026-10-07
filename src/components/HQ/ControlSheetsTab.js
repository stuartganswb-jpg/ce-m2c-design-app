import React, { useState, useEffect, useMemo } from 'react';
import { db, storage } from '../../firebase';
import { collection, doc, onSnapshot, query, where, setDoc, updateDoc, deleteDoc, writeBatch, deleteField, getDocFromServer, getDocsFromServer } from 'firebase/firestore';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { canLineDiscount } from '../Shared/lineDiscount';   // the app's ONE manager-or-higher rule (admin · superadmin · manager · executive)
import { canonicalCollection } from '../Shared/collectionName';
import {
    LINE_STATUSES, PUSHED, SHEET_KINDS, CURRENCIES, defaultGroupsFor, sheetGroupsFor, libraryTargetOf, pushStateOf, noLibraryFieldText,
    cellRawOf, cellValueOf, cellTextOf, moneyText, numOf,
    landedEachOf, lineCostIn, sectionTotalOf, childChoicesFor, usesListOf, linesOn, placeOf,
    sortLines, sortOnSection, nextOrder, lineLabelOf, quoteTextOf, matchesSearch,
    projectNameKey, tab1ProjectsOf, blankLine, blankProject,
    readBundle, planImport, finishImport,
    exportColumnsFor, startsInDownload, planReimport, startsTicked, patchForCells, lineFromNewRow,
    readinessOf, existingByCode, libraryIdFor, pushPlanOf, pushedStamp, unlockStamp,
} from '../Shared/controlSheet';
import { usdRateFor, originPricePatch, fxNoteOf, currenciesToRefresh, refreshPlan } from '../Shared/fxRates';

// ── 1.2 CONTROL SHEETS (Stuart 2026-10-07) ──────────────────────────────────────────────────────────────
// "create a tab/page in the app that replaces the excel spreadsheet … a true working center where we store
// all our work until its ready to push into the app as final/approved."
//
// THE WORKING / HOLDING SHEET. A project named in tab 1 has one control sheet here: its parts (each entered
// ONCE), and a sheet per assembly saying how many of each part it takes and the balloon number on its
// drawing. The page adds up the way the spreadsheets did — landed cost each, cost per assembly, sub-assemblies
// rolled into the product. The rules and every field are in Shared/controlSheet.
//
// NOTHING ELSE IN THE APP READS THIS STORE (system/control_sheets/…): an item reaches CPQ, Order Entry, the
// floors, WMS and NetSuite only when its line is PUSHED into the Master Library — the one write this tab makes
// outside its own store (runPush: one Approved_Designs record, set once, after looking). Everything else here
// is the sheet's own.
//
// His calls: the tab is 1.2 · tab 1 only NAMES the project, the project is the sheet's name · the 1.6 tags are
// HELD here and put in their actual place at the 1.6 upload · pictures come from tab 1 going forward (the
// three workbooks came in with their own) · milling stays on the sheet until that tab is finished.

const STORE = ['system', 'control_sheets', 'projects'];
const projectsCol = () => collection(db, ...STORE);
const projectRef = (pid) => doc(db, ...STORE, pid);
const linesCol = (pid) => collection(db, ...STORE, pid, 'lines');
const lineRef = (pid, id) => doc(db, ...STORE, pid, 'lines', id);
const newId = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();

const KIND_LABEL = { LIGHTING: 'Lighting', HARDWARE: 'Hardware' };
const STAYS_PUT = ['SEL', '#', 'QTY', 'pictureUrl', 'itemCode', 'name'];   // the columns that do not scroll away
const STATUS_LABEL = { DRAFT: 'Draft', SOURCING: 'Sourcing', SAMPLED: 'Sampled', READY: 'Ready', PUSHED: 'Pushed' };

const S = {
    card: { background: '#fff', border: '1px solid var(--line)', padding: '20px 24px', borderRadius: '2px' },
    label: { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' },
    btn: { padding: '9px 16px', background: '#fff', color: 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', whiteSpace: 'nowrap' },
    btnDark: { padding: '9px 16px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', whiteSpace: 'nowrap' },
    chip: (on) => ({ padding: '6px 12px', background: on ? 'var(--ink)' : '#fff', color: on ? '#fff' : 'var(--ink-soft)', border: `1px solid ${on ? 'var(--ink)' : 'var(--line)'}`, cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap' }),
    tab: (on) => ({ padding: '10px 16px', background: on ? 'var(--paper-2)' : 'transparent', color: on ? 'var(--ink)' : 'var(--ink-soft)', border: 'none', borderBottom: on ? '2px solid var(--brass)' : '2px solid transparent', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: '0.88rem', fontWeight: on ? 500 : 400, whiteSpace: 'nowrap' }),
    th: { position: 'sticky', top: 0, zIndex: 2, background: 'var(--paper-2)', borderBottom: '1px solid var(--line)', borderRight: '1px solid var(--line)', padding: '8px', textAlign: 'left', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-soft)', fontWeight: 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', boxSizing: 'border-box' },
    td: { borderBottom: '1px solid var(--line)', borderRight: '1px solid var(--line)', padding: '2px 4px', verticalAlign: 'middle', fontFamily: 'var(--sans)', fontSize: '0.8rem', color: 'var(--ink)', boxSizing: 'border-box' },
    input: { width: '100%', boxSizing: 'border-box', border: 'none', background: 'transparent', padding: '6px 4px', fontFamily: 'var(--sans)', fontSize: '0.8rem', color: 'var(--ink)', outline: 'none' },
    overlay: { position: 'fixed', inset: 0, background: 'rgba(28,26,22,.45)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '30px' },
    modal: { background: '#fff', border: '1px solid var(--line)', width: 'min(880px, 100%)', maxHeight: '86vh', overflowY: 'auto', padding: '28px 30px', boxShadow: '0 12px 40px rgba(0,0,0,.18)' },
    h3: { margin: '0 0 6px 0', fontFamily: 'var(--serif)', fontSize: '1.5rem', fontWeight: 500, color: 'var(--ink)' },
    note: { fontFamily: 'var(--sans)', fontSize: '0.85rem', color: 'var(--ink-soft)', lineHeight: 1.5 },
};

// A render fault on this page stays on this page — the rest of HQ keeps running.
class SheetBoundary extends React.Component {
    constructor(props) { super(props); this.state = { failed: null }; }
    static getDerivedStateFromError(error) { return { failed: error }; }
    componentDidCatch(error) { console.error('Control Sheets render error', error); }
    render() {
        if (!this.state.failed) return this.props.children;
        return (
            <div style={{ ...S.card, margin: '30px' }}>
                <h3 style={S.h3}>This sheet could not be drawn</h3>
                <p style={S.note}>Nothing was changed. Reload the page; if it happens again send this line with the project name: <code>{String(this.state.failed && this.state.failed.message)}</code></p>
            </div>
        );
    }
}

// One box of the grid. Text boxes hold what is typed until the cursor leaves, then save — the key is the
// stored text, so a save from another screen redraws the box with what is now there.
const Cell = ({ field, line, lists, locked, onCommit, onOpen }) => {
    const value = cellRawOf(field, line);
    const type = field.type;
    if (type === 'picture') {
        return (
            <button onClick={() => onOpen('PICTURE')} title={value ? 'Change the picture' : 'Choose a picture from tab 1'} style={{ width: '52px', height: '52px', padding: 0, border: value ? '1px solid var(--line)' : '1px dashed var(--line)', background: 'var(--paper)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-soft)', fontSize: '1.1rem' }}>
                {value ? <img src={value} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : '+'}
            </button>
        );
    }
    if (type === 'landed') {
        const each = landedEachOf(line);
        return <div style={{ padding: '6px 4px', textAlign: 'right', color: each === null ? 'var(--ink-soft)' : 'var(--ink)' }}>{each === null ? '—' : moneyText(each, each < 1 ? 3 : 2)}</div>;
    }
    // THE USD IS WORKED OUT once the line carries an origin price (price × the rate of the day it was entered —
    // Shared/fxRates); the box says what it was made from. A line with no origin price keeps a typed USD.
    if (type === 'usd' && numOf(line.priceOrigin) !== null) {
        const usd = numOf(value);
        const note = fxNoteOf(line);
        return <div title={note} style={{ padding: '6px 4px', textAlign: 'right', color: usd === null ? 'var(--brass)' : 'var(--ink)', cursor: 'help' }}>{usd === null ? (line.currency ? 'no rate' : 'currency?') : moneyText(usd, usd < 1 ? 4 : 2)}</div>;
    }
    if (type === 'quotes') {
        const quotes = Array.isArray(value) ? value : [];
        return (
            <button onClick={() => onOpen('QUOTES')} title="The vendor's quoted prices" style={{ ...S.input, textAlign: 'left', cursor: 'pointer', color: quotes.length ? 'var(--ink)' : 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {quotes.length ? `${quoteTextOf(quotes[0])}${quotes.length > 1 ? `  +${quotes.length - 1}` : ''}` : '+ quote'}
            </button>
        );
    }
    if (type === 'bool') {
        return <div style={{ textAlign: 'center' }}><input type="checkbox" checked={value === true} disabled={locked} onChange={e => onCommit(cellValueOf(field, e.target.checked))} style={{ cursor: locked ? 'default' : 'pointer' }} /></div>;
    }
    if (type === 'pick' || type === 'list') {
        const options = (type === 'pick' ? field.options : (lists[field.list] || [])).map(o => String(o));
        const current = value === null || value === undefined ? '' : String(value);
        // A value that is not on the list (an imported word, a list edited since) is kept and shown, never dropped.
        const offList = current && !options.some(o => o.toUpperCase() === current.toUpperCase());
        const selected = offList ? current : (options.find(o => o.toUpperCase() === current.toUpperCase()) || '');
        return (
            <select value={selected} disabled={locked} onChange={e => onCommit(e.target.value)} style={{ ...S.input, cursor: locked ? 'default' : 'pointer', color: offList ? 'var(--brass)' : 'var(--ink)' }}>
                <option value=""></option>
                {offList && <option value={current}>{current} (not on the list)</option>}
                {options.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
        );
    }
    const text = cellTextOf(field, value);
    const numeric = ['num', 'money', 'pct', 'usd'].includes(type);
    const box = (
        <input key={text} defaultValue={text} disabled={locked} title={text.length > 24 ? text : undefined}
            list={field.datalist ? `cs-${field.datalist}` : undefined}
            onBlur={e => { if (e.target.value !== text) onCommit(cellValueOf(field, e.target.value)); }}
            onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
            style={{ ...S.input, textAlign: numeric ? 'right' : 'left', fontFamily: field.mono ? 'var(--mono)' : 'var(--sans)', fontSize: field.mono ? '0.75rem' : '0.8rem' }} />
    );
    if (type === 'pct') return <div style={{ display: 'flex', alignItems: 'center' }}>{box}<span style={{ color: 'var(--ink-soft)', fontSize: '0.75rem', paddingRight: '2px' }}>%</span></div>;
    if (type === 'url') return <div style={{ display: 'flex', alignItems: 'center' }}>{box}{text && <a href={text} target="_blank" rel="noreferrer" title={text} style={{ color: 'var(--brass)', textDecoration: 'none', padding: '0 4px' }}>↗</a>}</div>;
    return box;
};

const ControlSheetsInner = ({ currentUser, activeBrand, userRole, isSuperAdmin, writeLog, onNavigateToLibrary }) => {
    const canManage = canLineDiscount(userRole, isSuperAdmin);
    const [projects, setProjects] = useState([]);
    const [tab1Records, setTab1Records] = useState([]);
    const [masterLists, setMasterLists] = useState({});
    const [collectionsData, setCollectionsData] = useState([]);
    const [vendors, setVendors] = useState([]);
    const [projectId, setProjectId] = useState('');
    const [lines, setLines] = useState([]);
    const [sectionId, setSectionId] = useState('');       // '' = every part of the project
    const [shown, setShown] = useState([]);                 // field groups ticked on
    const [search, setSearch] = useState('');
    const [open, setOpen] = useState(null);                 // { kind: 'PICTURE' | 'QUOTES' | 'DRAWING', lineId?, sectionId? }
    const [starter, setStarter] = useState(null);           // { name, kind } — starting a sheet for a tab-1 project
    const [importer, setImporter] = useState(null);         // the import window's state
    const [useExisting, setUseExisting] = useState('');
    const [customSchema, setCustomSchema] = useState([]);  // 4.5's custom Library attributes (system/master_schema)
    const [selected, setSelected] = useState([]);           // line ids ticked on the left
    const [downloader, setDownloader] = useState(null);     // the download window
    const [reimporter, setReimporter] = useState(null);     // the bring-back window
    const [ratesBusy, setRatesBusy] = useState(false);
    const [pusher, setPusher] = useState(null);             // the push window

    const log = (msg) => { try { if (writeLog) writeLog(currentUser, '1.2 Control Sheets', msg); } catch (_) { /* a log line never stops the work */ } };
    const stamp = () => ({ updatedAt: new Date().toISOString(), updatedBy: currentUser || '' });
    const say = (what, err) => { console.error(what, err); alert(`${what}: ${(err && err.message) || err}\n\nNothing was changed by that step.`); };

    useEffect(() => {
        if (!activeBrand) return undefined;
        setProjectId('');
        const unsubProjects = onSnapshot(projectsCol(), snap => setProjects(snap.docs.map(d => ({ ...d.data(), id: d.id })).filter(p => p.brandId === activeBrand)), err => console.warn('control sheets listen failed', err));
        // The same read tab 1 makes — its designs are where a project's NAME and its pictures come from.
        const unsubTab1 = onSnapshot(query(collection(db, 'Approved_Designs'), where('brandId', '==', activeBrand), where('partClass', '==', 'Assembly')), snap => setTab1Records(snap.docs.map(d => ({ ...d.data(), id: d.id }))), err => console.warn('tab 1 designs listen failed', err));
        const unsubLists = onSnapshot(doc(db, 'system', 'master_lists'), snap => setMasterLists(snap.exists() ? snap.data() : {}));
        const unsubCollections = onSnapshot(collection(db, 'hq_collections'), snap => setCollectionsData(snap.docs.map(d => d.data())));
        const unsubVendors = onSnapshot(query(collection(db, 'crm_records'), where('type', '==', 'VENDOR')), snap => setVendors(snap.docs.map(d => d.data())));
        const unsubSchema = onSnapshot(doc(db, 'system', 'master_schema'), snap => setCustomSchema((snap.exists() && snap.data().inventoryFields) || []));
        return () => { unsubProjects(); unsubTab1(); unsubLists(); unsubCollections(); unsubVendors(); unsubSchema(); };
    }, [activeBrand]);

    useEffect(() => {
        if (!projectId) { setLines([]); return undefined; }
        return onSnapshot(linesCol(projectId), snap => setLines(snap.docs.map(d => ({ ...d.data(), id: d.id }))), err => console.warn('control sheet lines listen failed', err));
    }, [projectId]);

    const project = projects.find(p => p.id === projectId) || null;
    const kind = project ? project.kind : '';
    useEffect(() => { setSectionId(''); setSearch(''); setShown(defaultGroupsFor(kind)); }, [projectId, kind]);
    useEffect(() => { setSelected([]); }, [projectId, sectionId]);

    const sections = useMemo(() => (project && Array.isArray(project.sections) ? project.sections : []), [project]);
    const section = sections.find(s => s.id === sectionId) || null;
    const tab1Projects = useMemo(() => tab1ProjectsOf(tab1Records), [tab1Records]);
    const tab1Here = project ? tab1Projects.find(p => p.key === projectNameKey(project.name)) || null : null;
    const sheetNames = new Set(projects.map(p => projectNameKey(p.name)));
    const unstarted = tab1Projects.filter(p => !sheetNames.has(p.key));

    // The 4.5 dictionary lists the Master Library offers, by the names Shared/controlSheet's fields use.
    const lists = useMemo(() => ({
        uom: masterLists.uom || [], prodTypes: masterLists.prodTypes || [], partHandling: masterLists.partHandling || [],
        watchLists: masterLists.watchLists || [], materials: masterLists.materials || [], projections: masterLists.projections || [],
        bracketMounts: masterLists.bracketMounts || [], bins: masterLists.bins || [], outsourceActions: masterLists.outsourceActions || [],
        feeTypes: masterLists.feeTypes || [], routingTypes: [...new Set([...(masterLists.inventoryTypes || []), ...(masterLists.assemblyTypes || [])])],
        collections: [...new Set(collectionsData.filter(c => c.brandId === activeBrand).map(c => canonicalCollection(c.name)).filter(Boolean))].sort(),
    }), [masterLists, collectionsData, activeBrand]);
    const vendorNames = useMemo(() => [...new Set(vendors.map(v => String(v.name || v.companyName || '').trim()).filter(Boolean))].sort(), [vendors]);

    const groups = useMemo(() => sheetGroupsFor(kind, customSchema), [kind, customSchema]);
    const allFields = groups.flatMap(g => g.fields);
    const fields = groups.filter(g => g.always || shown.includes(g.key)).flatMap(g => g.fields);
    const pushColumns = (project && project.pushColumns) || {};
    // THE GRID'S COLUMNS, in order, each a fixed width — a sheet, not a page that reflows. The first few (balloon,
    // quantity, picture, item #, description) stay put while the rest scroll sideways.
    const columns = [
        { key: 'SEL', label: '', width: 34 },
        ...(section ? [{ key: '#', label: '#', width: 52 }, { key: 'QTY', label: 'Qty', width: 64 }] : []),
        ...fields.map(fd => ({ key: fd.key, label: fd.label, width: fd.width, field: fd })),
        section ? { key: 'COST', label: 'Cost here', width: 96, right: true } : { key: 'ON', label: 'On sheets', width: 220 },
        ...(section ? [{ key: 'NOTE', label: 'Note on this sheet', width: 240 }] : []),
        { key: 'STATUS', label: 'Status', width: 112 },
        { key: 'PUSH', label: 'Master Library', width: 156 },
        { key: 'ACT', label: '', width: 44 },
    ];
    let stuck = 0;
    columns.forEach(c => { if (STAYS_PUT.includes(c.key)) { c.left = stuck; stuck += c.width; } });
    const lastStuck = [...columns].reverse().find(c => c.left !== undefined) || null;
    const tableWidth = columns.reduce((n, c) => n + c.width, 0);
    const edge = (c) => ({ ...(c === lastStuck ? { borderRight: '2px solid var(--line)' } : {}), ...(c.key === 'ACT' ? { borderRight: 'none', textAlign: 'center' } : {}) });
    const thStyle = (c) => ({ ...S.th, textAlign: c.right ? 'right' : 'left', ...(c.left !== undefined ? { left: `${c.left}px`, zIndex: 4 } : {}), ...edge(c) });
    const tdStyle = (c, bg) => ({ ...S.td, ...(c.left !== undefined ? { position: 'sticky', left: `${c.left}px`, zIndex: 1, background: bg } : {}), ...edge(c) });

    const rows = (section ? sortOnSection(linesOn(lines, section.id), section.id) : sortLines(lines)).filter(l => matchesSearch(l, search));
    const total = section ? sectionTotalOf(section.id, sections, lines) : null;
    const counts = LINE_STATUSES.concat(PUSHED).map(s => ({ s, n: lines.filter(l => (l.status || 'DRAFT') === s).length })).filter(c => c.n > 0);

    // ── writes: every one is to this tab's own store ──
    const patchLine = async (line, patch) => {
        try { await updateDoc(lineRef(projectId, line.id), { ...patch, ...stamp() }); }
        catch (err) { say(`Could not save ${lineLabelOf(line)}`, err); }
    };
    const saveSections = async (next) => {
        try { await updateDoc(projectRef(projectId), { sections: next, ...stamp() }); return true; }
        catch (err) { say('Could not save the sheet', err); return false; }
    };
    const patchSection = (id, patch) => saveSections(sections.map(s => (s.id === id ? { ...s, ...patch } : s)));

    // THE ORIGIN PRICE (Shared/fxRates). The price or the currency changing works the USD out again at TODAY'S
    // rate and keeps the rate and its date on the line; after that only Update rates moves it. A currency
    // chosen on a line that has no origin price yet leaves a typed USD exactly as it is.
    const setOrigin = async (line, next) => {
        const price = numOf(next.priceOrigin);
        if (price === null && numOf(line.priceOrigin) === null) return patchLine(line, { currency: String(next.currency || '') });
        const rate = price !== null && next.currency ? await usdRateFor(next.currency) : null;
        const patch = originPricePatch(next, rate);
        await patchLine(line, patch);
        if (patch.fxSource === 'PENDING') alert(`Today's ${patch.currency} rate could not be had, so the USD of ${lineLabelOf(line)} is blank.\n\nPress Update rates when the connection is back.`);
        return undefined;
    };
    const commitCell = (line, field, value) => {
        if (field.key === 'priceOrigin') return setOrigin(line, { priceOrigin: value, currency: line.currency });
        if (field.key === 'currency') return setOrigin(line, { priceOrigin: line.priceOrigin, currency: value });
        return patchLine(line, { [field.key]: value });
    };

    // UPDATE RATES — the one thing that moves a USD after the day its price was entered. It asks for today's
    // rates afresh, says how far each assembly's cost moves, and writes only on a yes.
    const updateRates = async () => {
        const open_ = lines.filter(l => l.status !== PUSHED);
        const need = currenciesToRefresh(open_);
        if (!need.length) return alert('No line on this sheet is priced in RMB or euros, so there is no rate to update.');
        setRatesBusy(true);
        try {
            const rates = {}, failed = [];
            for (const cur of need) { const r = await usdRateFor(cur, { fresh: true }); if (r) rates[cur] = r; else failed.push(cur); }
            const plan = refreshPlan(lines, rates, l => l.status === PUSHED);
            const failText = failed.length ? `\n\n${failed.join(' and ')}: today's rate could not be had — those lines are left as they are.` : '';
            const rateText = Object.entries(rates).map(([c, r]) => `${c} ${r.rate} (${r.source}, ${r.date})`).join(' · ');
            if (!plan.length) return alert(`${rateText ? `Every line is already at today's rate.\n\n${rateText}` : 'Nothing was updated.'}${failText}`);
            const after = lines.map(l => { const m = plan.find(x => x.line.id === l.id); return m ? { ...l, ...m.patch } : l; });
            const moves = sections.map(sec => ({ name: sec.name, was: sectionTotalOf(sec.id, sections, lines).total, now: sectionTotalOf(sec.id, sections, after).total })).filter(m => Math.abs(m.was - m.now) >= 0.005);
            const detail = moves.length
                ? moves.map(m => `${m.name}: ${moneyText(m.was)} → ${moneyText(m.now)}`).join('\n')
                : plan.slice(0, 10).map(m => `${lineLabelOf(m.line)}: ${m.before === null ? '(blank)' : moneyText(m.before, 4)} → ${moneyText(m.after, 4)}`).join('\n') + (plan.length > 10 ? `\n…and ${plan.length - 10} more` : '');
            if (!window.confirm(`Update ${plan.length} line${plan.length === 1 ? '' : 's'} to today's rate?\n\n${rateText}\n\n${detail}${failText}`)) return undefined;
            for (let i = 0; i < plan.length; i += 300) {
                const batch = writeBatch(db);
                plan.slice(i, i + 300).forEach(m => batch.update(lineRef(projectId, m.line.id), { ...m.patch, ...stamp() }));
                await batch.commit();
            }
            log(`Updated rates on ${plan.length} line(s) of ${project.name}: ${rateText}`);
        } catch (err) { say('Could not update the rates', err); }
        finally { setRatesBusy(false); }
        return undefined;
    };

    // THE "PUSH TO LIBRARY" TICK of a column — a choice kept on the sheet (project.pushColumns); it pushes
    // nothing. Ticking a column the Library has no field for says so, and how to set one up before the push.
    const setPush = async (field, on) => {
        if (on && !libraryTargetOf(field, customSchema)) alert(noLibraryFieldText(field));
        try { await updateDoc(projectRef(projectId), { [`pushColumns.${field.key}`]: on, ...stamp() }); }
        catch (err) { say('Could not save the Push to Library tick', err); }
    };
    const pushTitle = (field, ps) => {
        const who = canManage ? '' : ' A manager sets these.';
        if (ps.locked) return `Always pushed with the line — the Master Library's ${ps.target.label}.`;
        if (ps.missing) return `Ticked, but the Master Library has no field for "${field.label}" yet. Add it in 4.5 → Static Part Attributes before the push.${who}`;
        if (ps.on) return `Goes to the Master Library as: ${ps.target.label}.${who}`;
        return (ps.target ? `Not pushed. (The Library's field for it: ${ps.target.label}.)` : `Not pushed — the Master Library has no field for "${field.label}".`) + who;
    };

    // DOWNLOAD the ticked lines as an Excel file to send out, and BRING BACK what returns (Shared/controlSheet
    // decides what is in the file and what may come back; Shared/controlSheetXlsx writes and reads it — loaded
    // only when asked for, it carries the spreadsheet library).
    const picked = () => rows.filter(l => selected.includes(l.id));
    const openDownload = () => {
        if (!picked().length) return alert('Tick the lines to download first — the box at the left of each row, or the one in the heading for every line shown.');
        const cols = exportColumnsFor(fields, section).map(c => ({ ...c, on: !!c.fixed || startsInDownload(c) }));
        return setDownloader({ columns: cols, pictures: true, busy: false, progress: '' });
    };
    const runDownload = async () => {
        const cols = downloader.columns.filter(c => c.on);
        const sel = picked();
        setDownloader(d => ({ ...d, busy: true, progress: 'Preparing…' }));
        try {
            const xlsx = await import('../Shared/controlSheetXlsx');
            const pictures = {};
            if (downloader.pictures && cols.some(c => c.field && c.field.type === 'picture')) {
                for (let i = 0; i < sel.length; i++) {
                    if (!sel[i].pictureUrl) continue;
                    setDownloader(d => ({ ...d, progress: `Pictures ${i + 1} of ${sel.length}…` }));
                    const pic = await xlsx.fetchPicture(sel[i].pictureUrl);
                    if (pic) pictures[sel[i].id] = pic;
                }
            }
            const meta = { projectId, projectName: project.name, sectionId: section ? section.id : '', sectionName: section ? section.name : '', exportedAt: new Date().toISOString() };
            const bytes = await xlsx.buildControlSheetXlsx({ columns: cols, lines: sel, sectionId: meta.sectionId, meta, pictures });
            xlsx.saveXlsx(bytes, `${project.name}${section ? ` - ${section.name}` : ''} - ${meta.exportedAt.slice(0, 10)}.xlsx`.replace(/[\\/:*?"<>|]+/g, ' '));
            log(`Downloaded ${sel.length} line(s) of ${project.name}${section ? ` / ${section.name}` : ''} as .xlsx`);
            setDownloader(null);
        } catch (err) { setDownloader(d => (d ? { ...d, busy: false, progress: '' } : d)); say('Could not make the file', err); }
    };
    const readReimport = async (file) => {
        if (!file) return;
        setReimporter({ reading: true, fileName: file.name });
        try {
            const xlsx = await import('../Shared/controlSheetXlsx');
            // Every column a download of this sheet could have carried — whatever was showing when it was made.
            const known = exportColumnsFor(allFields, { id: '_' });
            const read = await xlsx.readControlSheetXlsx(await file.arrayBuffer(), known);
            const plan = planReimport({ ...read, lines, projectId, sections, knownColumns: known });
            const ticks = {};
            plan.changes.forEach(ch => ch.cells.forEach(c => { ticks[`${ch.lineId}|${c.key}`] = startsTicked(c); }));
            setReimporter({ fileName: file.name, plan, ticks, newTicks: {}, exportedAt: read.meta ? read.meta.exportedAt : '' });
        } catch (err) { console.error('re-import read failed', err); setReimporter({ fileName: file.name, error: `This file could not be read as a control sheet (${(err && err.message) || err}). Nothing was changed.` }); }
    };
    const applyReimport = async () => {
        const { plan, ticks, newTicks } = reimporter;
        const work = plan.changes.map(ch => ({ ch, cells: ch.cells.filter(c => ticks[`${ch.lineId}|${c.key}`]) })).filter(w => w.cells.length);
        const adds = plan.newRows.filter(r => newTicks[r.index]);
        if (!work.length && !adds.length) return;
        setReimporter(r => ({ ...r, busy: true }));
        try {
            const now = new Date().toISOString();
            const writes = [], noRate = [];
            // A price or a currency that came back is worked into USD exactly as a typed one is.
            const withUsd = async (base, patch, label) => {
                if (!('priceOrigin' in patch) && !('currency' in patch)) return patch;
                const next = { priceOrigin: 'priceOrigin' in patch ? patch.priceOrigin : base.priceOrigin, currency: 'currency' in patch ? patch.currency : base.currency };
                if (numOf(next.priceOrigin) === null && numOf(base.priceOrigin) === null) return patch;
                const rate = numOf(next.priceOrigin) !== null && next.currency ? await usdRateFor(next.currency) : null;
                const fx = originPricePatch(next, rate);
                if (fx.fxSource === 'PENDING') noRate.push(label);
                return { ...patch, ...fx };
            };
            for (const { ch, cells } of work) {
                const line = lines.find(l => l.id === ch.lineId);
                if (!line || line.status === PUSHED) continue;
                writes.push({ ref: lineRef(projectId, line.id), data: { ...(await withUsd(line, patchForCells(cells, plan.sectionId), ch.label)), ...stamp() }, isNew: false });
            }
            let order = nextOrder(lines);
            for (const row of adds) {
                const made = lineFromNewRow(row.cells, { id: newId('L'), projectId, brandId: activeBrand, order, user: currentUser, nowIso: now, sectionId: plan.sectionId });
                order += 10;
                Object.assign(made, await withUsd({}, { priceOrigin: made.priceOrigin, currency: made.currency || '' }, row.label));
                writes.push({ ref: lineRef(projectId, made.id), data: made, isNew: true });
            }
            for (let i = 0; i < writes.length; i += 300) {
                const batch = writeBatch(db);
                writes.slice(i, i + 300).forEach(w => (w.isNew ? batch.set(w.ref, w.data) : batch.update(w.ref, w.data)));
                await batch.commit();
            }
            const cells = work.reduce((n, w) => n + w.cells.length, 0);
            log(`Brought back ${reimporter.fileName} into ${project.name}: ${cells} change(s) on ${work.length} line(s), ${adds.length} line(s) added`);
            setReimporter({ fileName: reimporter.fileName, finished: { lines: work.length, cells, added: adds.length, noRate } });
        } catch (err) { setReimporter(r => (r ? { ...r, busy: false } : r)); say('Could not bring the file back', err); }
    };

    const addLine = async () => {
        const now = new Date().toISOString();
        const line = blankLine({ id: newId('L'), projectId, brandId: activeBrand, order: nextOrder(lines), user: currentUser, nowIso: now });
        if (section) line.uses = { [section.id]: { qty: null, balloon: '', note: '' } };
        try { await setDoc(lineRef(projectId, line.id), line); } catch (err) { say('Could not add the line', err); }
    };
    const putOnSheet = async (lineId) => {
        const line = lines.find(l => l.id === lineId);
        setUseExisting('');
        if (!line || !section || placeOf(line, section.id)) return;
        await patchLine(line, { [`uses.${section.id}`]: { qty: null, balloon: '', note: '' } });
    };
    const takeOffSheet = async (line) => {
        if (!section) return;
        if (!window.confirm(`Take ${lineLabelOf(line)} off "${section.name}"?\n\nThe part stays in the project — only its row on this sheet goes.`)) return;
        await patchLine(line, { [`uses.${section.id}`]: deleteField() });
    };
    const deleteLine = async (line) => {
        if (line.status === PUSHED) return alert(`${lineLabelOf(line)} has been pushed to the Master Library — it is kept here as the record of that.`);
        const on = usesListOf(line, sections);
        if (!window.confirm(`Delete ${lineLabelOf(line)} from this project?${on.length ? `\n\nIt is on ${on.length} sheet(s): ${on.map(u => u.section.name).join(', ')} — it leaves those too.` : ''}\n\nThis cannot be undone.`)) return;
        try { await deleteDoc(lineRef(projectId, line.id)); log(`Deleted line ${lineLabelOf(line)} from ${project.name}`); }
        catch (err) { say(`Could not delete ${lineLabelOf(line)}`, err); }
    };

    const addSection = async () => {
        const name = window.prompt('Name of the new sheet (an assembly of this project):', '');
        if (name === null || !name.trim()) return;
        const id = newId('S');
        if (await saveSections([...sections, { id, name: name.trim(), kind: 'ASSEMBLY', drawings: [], children: [] }])) setSectionId(id);
    };
    const renameSection = async () => {
        const name = window.prompt('Sheet name:', section.name);
        if (name === null || !name.trim() || name.trim() === section.name) return;
        await patchSection(section.id, { name: name.trim() });
    };
    const deleteSection = async () => {
        const parents = sections.filter(s => (s.children || []).some(c => c.section === section.id));
        const onIt = linesOn(lines, section.id).length;
        if (onIt || parents.length || (section.children || []).length) {
            return alert(`"${section.name}" is not empty, so it stays.\n\n${[onIt ? `${onIt} part(s) are on it` : '', (section.children || []).length ? `it takes ${(section.children || []).length} sub-assembly sheet(s)` : '', parents.length ? `it is a sub-assembly of ${parents.map(p => p.name).join(', ')}` : ''].filter(Boolean).join(' · ')}.`);
        }
        if (!window.confirm(`Remove the empty sheet "${section.name}"?`)) return;
        if (await saveSections(sections.filter(s => s.id !== section.id))) { log(`Removed sheet ${section.name} from ${project.name}`); setSectionId(''); }
    };
    const addChild = (childId) => { if (childId) patchSection(section.id, { children: [...(section.children || []), { section: childId, qty: 1, balloon: '' }] }); };
    const patchChild = (childId, patch) => patchSection(section.id, { children: (section.children || []).map(c => (c.section === childId ? { ...c, ...patch } : c)) });
    const removeChild = (childId) => patchSection(section.id, { children: (section.children || []).filter(c => c.section !== childId) });
    const removeDrawing = (url) => { if (window.confirm('Take this drawing off the sheet? (The picture itself is not deleted.)')) patchSection(section.id, { drawings: (section.drawings || []).filter(d => d.url !== url) }); };

    // ── THE PUSH: a line becomes a Master Library record (Shared/controlSheet decides whether it may, whether the
    // Library already has it, and exactly what is written). The ONLY writes this tab makes outside its own store
    // are the one record set here; the line is stamped in the same batch, so the two cannot disagree.
    const pushContext = { fields: allFields, pushColumns, customSchema, lists, lines };
    const readLibrary = async () => {
        // The division's records and those shared into it, FROM THE SERVER — never the cache: this is the look
        // that decides whether an item is new.
        const col = collection(db, 'Approved_Designs');
        const [own, shared] = await Promise.all([getDocsFromServer(query(col, where('brandId', '==', activeBrand))), getDocsFromServer(query(col, where('sharedBrands', 'array-contains', activeBrand)))]);
        const byId = new Map();
        [...own.docs, ...shared.docs].forEach(d => { const x = d.data(); byId.set(d.id, { id: d.id, legacyErpId: x.legacyErpId, itemId: x.itemId, itemName: x.itemName, partClass: x.partClass }); });
        return [...byId.values()];
    };
    const openPush = async (line) => {
        const ready = readinessOf(line, pushContext);
        if (!ready.ok) return setPusher({ lineId: line.id, ready });
        setPusher({ lineId: line.id, ready, looking: true });
        try {
            const existing = existingByCode(await readLibrary(), line.itemCode);
            return setPusher({ lineId: line.id, ready, looked: true, existing: existing || null });
        } catch (err) { console.error('library read failed', err); return setPusher({ lineId: line.id, ready, error: `The Master Library could not be read (${(err && err.message) || err}). Nothing was written.` }); }
    };
    const runPush = async () => {
        const line = lines.find(l => l.id === pusher.lineId);
        if (!line) return;
        setPusher(x => ({ ...x, busy: true }));
        try {
            // Looked at AGAIN at the moment of writing: the line may have been edited, and the item may have been
            // made in the Library, since the window opened.
            const ready = readinessOf(line, pushContext);
            if (!ready.ok) { setPusher({ lineId: line.id, ready }); return; }
            const code = String(line.itemCode).trim().toUpperCase();
            const col = collection(db, 'Approved_Designs');
            const again = await Promise.all([getDocsFromServer(query(col, where('legacyErpId', '==', code))), getDocsFromServer(query(col, where('itemId', '==', code)))]);
            const hit = [...again[0].docs, ...again[1].docs].map(d => ({ ...d.data(), id: d.id })).find(r => r.brandId === activeBrand || (r.sharedBrands || []).includes(activeBrand));
            if (hit) { setPusher({ lineId: line.id, ready, looked: true, existing: { id: hit.id, legacyErpId: hit.legacyErpId, itemId: hit.itemId, itemName: hit.itemName, partClass: hit.partClass } }); return; }
            const now = new Date();
            const id = libraryIdFor(activeBrand, line.recordClass, now.getTime());
            if ((await getDocFromServer(doc(db, 'Approved_Designs', id))).exists()) throw new Error('a record took that id in the same instant — press Push again');
            const plan = pushPlanOf(line, { project, brandId: activeBrand, fields: allFields, pushColumns, customSchema, user: currentUser, nowIso: now.toISOString(), id });
            const batch = writeBatch(db);
            batch.set(doc(db, 'Approved_Designs', id), plan.record);
            batch.update(lineRef(projectId, line.id), { ...pushedStamp(plan.record, { user: currentUser, nowIso: now.toISOString() }), ...stamp() });
            await batch.commit();
            log(`Pushed ${code} from ${project.name} to the Master Library as ${id} (${plan.written.length} fields)`);
            setPusher({ lineId: line.id, finished: { code, id, fields: plan.written.length } });
        } catch (err) { setPusher(x => (x ? { ...x, busy: false } : x)); say('Could not push the line', err); }
    };
    const linkExisting = async () => {
        const line = lines.find(l => l.id === pusher.lineId);
        const existing = pusher.existing;
        if (!line || !existing) return;
        setPusher(x => ({ ...x, busy: true }));
        try {
            await updateDoc(lineRef(projectId, line.id), { ...pushedStamp(existing, { user: currentUser, nowIso: new Date().toISOString(), linked: true }), ...stamp() });
            log(`Linked ${lineLabelOf(line)} of ${project.name} to the Master Library record ${existing.id} (nothing written to the Library)`);
            setPusher({ lineId: line.id, finished: { code: String(line.itemCode).trim().toUpperCase(), id: existing.id, linked: true } });
        } catch (err) { setPusher(x => (x ? { ...x, busy: false } : x)); say('Could not link the line', err); }
    };
    // A pushed line belongs to the Library. It comes back to the sheet only when its record is GONE from there
    // (removed with 4.5 → True delete) — checked on the server, never assumed.
    const unlockLine = async (line) => {
        const to = line.pushedTo || {};
        const what = to.code || lineLabelOf(line);
        try {
            const snap = to.docId ? await getDocFromServer(doc(db, 'Approved_Designs', to.docId)) : null;
            if (snap && snap.exists()) return alert(`${what} is in the Master Library (${to.docId}). The Library owns it now — change it there.\n\nTo push this line again, the record has to be removed from the Library first (4.5 → True delete).`);
            if (!window.confirm(`The Master Library no longer has ${what}.\n\nUnlock this line so it can be worked on and pushed again?`)) return undefined;
            await updateDoc(lineRef(projectId, line.id), { ...unlockStamp(line, { user: currentUser, nowIso: new Date().toISOString() }), ...stamp() });
            log(`Unlocked ${what} of ${project.name} — its Master Library record ${to.docId || ''} is gone`);
        } catch (err) { say('Could not check the Master Library', err); }
        return undefined;
    };

    const choosePicture = async (pic) => {
        if (!open) return;
        if (open.kind === 'DRAWING') {
            const target = sections.find(s => s.id === open.sectionId);
            if (target && !(target.drawings || []).some(d => d.url === pic.url)) await patchSection(target.id, { drawings: [...(target.drawings || []), { url: pic.url, from: 'TAB1', label: pic.label || '' }] });
        } else {
            const line = lines.find(l => l.id === open.lineId);
            if (line) await patchLine(line, { pictureUrl: pic.url, pictureFrom: { kind: 'TAB1', recordId: pic.recordId || '', label: pic.label || '' } });
        }
        setOpen(null);
    };

    // ── starting a sheet for a project tab 1 has named ──
    const startSheet = async () => {
        if (!starter || !starter.name) return;
        const fresh = blankProject({ brandId: activeBrand, name: starter.name, kind: starter.kind, user: currentUser, nowIso: new Date().toISOString() });
        try {
            const there = await getDocFromServer(projectRef(fresh.id));
            if (there.exists()) { setStarter(null); setProjectId(fresh.id); return; }
            await setDoc(projectRef(fresh.id), fresh);
            log(`Started the control sheet for ${fresh.name}`);
            setStarter(null); setProjectId(fresh.id);
        } catch (err) { say('Could not start the sheet', err); }
    };

    // ── importing a prepared workbook file (scripts/controlSheetBundle.py) ──
    const readImportFile = (file) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onerror = () => setImporter({ error: 'The file could not be read.' });
        reader.onload = () => {
            let bundle = null;
            try { bundle = JSON.parse(String(reader.result)); } catch (_) { return setImporter({ error: 'This is not a control-sheet file (it is not readable as one).' }); }
            const read = readBundle(bundle);
            setImporter(read.ok ? { bundle, read, target: read.summary.name } : { error: read.errors.slice(0, 6).join('\n') });
        };
        reader.readAsText(file);
    };
    const runImport = async () => {
        const { bundle, read, target } = importer;
        const brandName = String(activeBrand).toUpperCase();
        if (read.summary.suggestedBrand && read.summary.suggestedBrand !== activeBrand
            && !window.confirm(`This file was prepared for the ${read.summary.suggestedBrand.toUpperCase()} division and you are in ${brandName}.\n\nImport it into ${brandName} anyway?`)) return;
        const plan = planImport(bundle, { brandId: activeBrand, projectName: target, user: currentUser, nowIso: new Date().toISOString() });
        setImporter(s => ({ ...s, running: true, progress: 'Checking…' }));
        try {
            // Look before writing: an existing sheet is never written over.
            const there = await getDocFromServer(projectRef(plan.projectId));
            if (there.exists()) { setImporter(s => ({ ...s, running: false, progress: '', refused: `"${plan.project.name}" already has a control sheet in this division. Nothing was written.` })); return; }
            const urlByKey = {};
            const missing = [];
            for (let i = 0; i < plan.images.length; i++) {
                const img = plan.images[i];
                setImporter(s => ({ ...s, progress: `Pictures ${i + 1} of ${plan.images.length}…` }));
                try {
                    const r = ref(storage, img.path);
                    await uploadString(r, img.data, 'base64', { contentType: img.mime });
                    urlByKey[img.key] = await getDownloadURL(r);
                } catch (picErr) { console.warn('picture failed', img.key, picErr); missing.push(img.key); }
            }
            const done = finishImport(plan, urlByKey);
            // The lines first, the sheet last: it appears only once it is whole, and a run that stops half way
            // can be pressed again (the same file writes the same lines).
            for (let i = 0; i < done.lines.length; i += 300) {
                setImporter(s => ({ ...s, progress: `Lines ${Math.min(i + 300, done.lines.length)} of ${done.lines.length}…` }));
                const batch = writeBatch(db);
                done.lines.slice(i, i + 300).forEach(l => batch.set(lineRef(plan.projectId, l.id), l));
                await batch.commit();
            }
            await setDoc(projectRef(plan.projectId), { ...done.project, importNotes: read.summary.report });
            log(`Imported ${read.summary.sourceFile} as ${done.project.name}: ${done.lines.length} lines, ${plan.images.length - missing.length} pictures`);
            setImporter({ finished: { name: done.project.name, lines: done.lines.length, pictures: plan.images.length - missing.length, missing: missing.length, report: read.summary.report } });
            setProjectId(plan.projectId);
        } catch (err) {
            console.error('import failed', err);
            setImporter(s => ({ ...s, running: false, progress: '', refused: `The import stopped: ${(err && err.message) || err}. The sheet itself was not created — press Import again to finish it.` }));
        }
    };

    // ── the windows ──
    const pictureWindow = () => {
        const isDrawing = open.kind === 'DRAWING';
        const line = isDrawing ? null : lines.find(l => l.id === open.lineId);
        const pics = tab1Here ? tab1Here.pictures : [];
        return (
            <div style={S.overlay} onClick={() => setOpen(null)}>
                <div style={S.modal} onClick={e => e.stopPropagation()}>
                    <h3 style={S.h3}>{isDrawing ? 'Add a drawing from tab 1' : `Picture — ${lineLabelOf(line)}`}</h3>
                    <p style={S.note}>Pictures come from tab 1: every drawing and image filed under <b>{project.name}</b> there is offered here. Add or replace one in tab 1 and it appears in this list.</p>
                    {!isDrawing && line && line.pictureUrl && (
                        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', margin: '14px 0', padding: '12px', background: 'var(--paper)', border: '1px solid var(--line)' }}>
                            <img src={line.pictureUrl} alt="" style={{ maxWidth: '180px', maxHeight: '140px', objectFit: 'contain', background: '#fff' }} />
                            <div>
                                <div style={S.label}>On the line now{line.pictureFrom && line.pictureFrom.kind === 'IMPORT' ? ' · came in with the workbook' : ''}</div>
                                <button style={{ ...S.btn, marginTop: '10px' }} onClick={async () => { await patchLine(line, { pictureUrl: '', pictureFrom: deleteField() }); setOpen(null); }}>Remove from the line</button>
                            </div>
                        </div>
                    )}
                    {pics.length === 0
                        ? <div style={{ ...S.note, padding: '24px', border: '1px dashed var(--line)', textAlign: 'center', marginTop: '14px' }}>{tab1Here ? 'No pictures are filed under this project in tab 1 yet.' : `Tab 1 has no project named ${project.name} yet — name it there and its pictures are offered here.`}</div>
                        : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px', marginTop: '14px' }}>
                            {pics.map(p => (
                                <button key={p.url} onClick={() => choosePicture(p)} style={{ background: '#fff', border: '1px solid var(--line)', padding: '8px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    <div style={{ height: '110px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--paper)' }}><img src={p.url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /></div>
                                    <span style={{ fontFamily: 'var(--sans)', fontSize: '0.75rem', color: 'var(--ink-soft)', textAlign: 'left' }}>{p.label}</span>
                                </button>
                            ))}
                        </div>}
                    <div style={{ marginTop: '20px', textAlign: 'right' }}><button style={S.btn} onClick={() => setOpen(null)}>Close</button></div>
                </div>
            </div>
        );
    };

    const quotesWindow = () => {
        const line = lines.find(l => l.id === open.lineId);
        if (!line) return null;
        const quotes = Array.isArray(line.quotes) ? line.quotes : [];
        const locked = line.status === PUSHED;
        const save = (next) => patchLine(line, { quotes: next });
        const edit = (i, key, raw) => save(quotes.map((q, n) => (n === i ? { ...q, [key]: key === 'price' ? numOf(raw) : String(raw).trim() } : q)));
        const box = { ...S.input, border: '1px solid var(--line)', background: '#fff' };
        return (
            <div style={S.overlay} onClick={() => setOpen(null)}>
                <div style={{ ...S.modal, width: 'min(720px, 100%)' }} onClick={e => e.stopPropagation()}>
                    <h3 style={S.h3}>Quotes — {lineLabelOf(line)}</h3>
                    <p style={S.note}>What the vendor quoted, as it was quoted: a price in its own currency at a quantity. <b>Use</b> makes a quote the line's <b>Price</b>; its USD is then worked out at the day's rate. A quote that is not in use changes nothing.</p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 0.8fr 1fr 64px 34px', gap: '8px', marginTop: '14px', alignItems: 'center' }}>
                        {['What (material, price break)', 'Price', 'Currency', 'At quantity', '', ''].map((h, i) => <span key={`${h}${i}`} style={S.label}>{h}</span>)}
                        {quotes.map((q, i) => (
                            <React.Fragment key={`${i}-${q.label}-${q.price}-${q.currency}-${q.qty}`}>
                                <input defaultValue={q.label || ''} disabled={locked} onBlur={e => { if (e.target.value !== (q.label || '')) edit(i, 'label', e.target.value); }} style={box} />
                                <input defaultValue={q.price === null || q.price === undefined ? '' : String(q.price)} disabled={locked} onBlur={e => { if (numOf(e.target.value) !== numOf(q.price)) edit(i, 'price', e.target.value); }} style={{ ...box, textAlign: 'right' }} />
                                <input defaultValue={q.currency || ''} disabled={locked} placeholder="RMB / USD" onBlur={e => { if (e.target.value.trim().toUpperCase() !== (q.currency || '')) edit(i, 'currency', e.target.value.toUpperCase()); }} style={box} />
                                <input defaultValue={q.qty || ''} disabled={locked} onBlur={e => { if (e.target.value !== (q.qty || '')) edit(i, 'qty', e.target.value); }} style={box} />
                                <button disabled={locked || numOf(q.price) === null} title="Make this quote the line's price — the USD is worked out from it at today's rate" onClick={() => setOrigin(line, { priceOrigin: q.price, currency: CURRENCIES.includes(String(q.currency || '').toUpperCase()) ? String(q.currency).toUpperCase() : line.currency })} style={{ ...S.btn, padding: '6px 8px', borderColor: numOf(q.price) !== null && numOf(line.priceOrigin) === numOf(q.price) ? 'var(--brass)' : 'var(--line)' }}>{numOf(q.price) !== null && numOf(line.priceOrigin) === numOf(q.price) ? 'In use' : 'Use'}</button>
                                <button disabled={locked} title="Remove this quote" onClick={() => save(quotes.filter((_, n) => n !== i))} style={{ background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', fontSize: '1.1rem' }}>×</button>
                            </React.Fragment>
                        ))}
                    </div>
                    {quotes.length === 0 && <div style={{ ...S.note, marginTop: '10px' }}>No quote on this line yet.</div>}
                    <div style={{ marginTop: '18px', display: 'flex', justifyContent: 'space-between' }}>
                        <button style={S.btn} disabled={locked} onClick={() => save([...quotes, { label: '', price: null, currency: '', qty: '' }])}>+ Add a quote</button>
                        <button style={S.btnDark} onClick={() => setOpen(null)}>Done</button>
                    </div>
                </div>
            </div>
        );
    };

    const importWindow = () => {
        const im = importer;
        const sum = im.read ? im.read.summary : null;
        const targets = sum ? [...new Set([sum.name, ...tab1Projects.map(p => p.name)])] : [];
        return (
            <div style={S.overlay}>
                <div style={S.modal}>
                    <h3 style={S.h3}>Import a prepared workbook</h3>
                    {!sum && !im.finished && (
                        <>
                            <p style={S.note}>Choose a <b>.control-sheet.json</b> file — a workbook prepared for this tab (Inception / import on the office machine), with its rows and its pictures inside. It is read here first; nothing is written until you press Import.</p>
                            <input type="file" accept=".json,application/json" onChange={e => readImportFile(e.target.files && e.target.files[0])} style={{ marginTop: '12px', fontFamily: 'var(--sans)', fontSize: '0.9rem' }} />
                            {im.error && <pre style={{ marginTop: '14px', padding: '12px', background: '#fdf3f2', border: '1px solid #e9c4c1', color: '#8a2a25', fontFamily: 'var(--sans)', fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>{im.error}</pre>}
                        </>
                    )}
                    {sum && !im.finished && (
                        <>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', margin: '14px 0' }}>
                                {[['Workbook', sum.sourceFile], ['Kind', KIND_LABEL[sum.kind]], ['Sheets · lines', `${sum.sections} · ${sum.lines}`], ['Pictures', `${sum.pictures} (${sum.withPicture} lines)`]].map(([k, v]) => (
                                    <div key={k} style={{ background: 'var(--paper)', padding: '12px' }}><div style={S.label}>{k}</div><div style={{ fontFamily: 'var(--sans)', fontSize: '0.95rem', marginTop: '4px', wordBreak: 'break-word' }}>{v}</div></div>
                                ))}
                            </div>
                            <label style={S.label}>Import as the control sheet of project</label>
                            <select value={im.target} disabled={!!im.running} onChange={e => setImporter(s => ({ ...s, target: e.target.value, refused: '' }))} style={{ display: 'block', width: '100%', padding: '10px', marginTop: '6px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem' }}>
                                {targets.map(t => <option key={t} value={t}>{t}{t === sum.name && !tab1Projects.some(p => p.name === t) ? '  — the name in the file (not named in tab 1 yet)' : ''}</option>)}
                            </select>
                            <p style={{ ...S.note, marginTop: '8px' }}>Into the <b>{String(activeBrand).toUpperCase()}</b> division. Every line comes in as a <b>Draft</b>; a project that already has a sheet is refused, never written over.</p>
                            {sum.report.length > 0 && (
                                <div style={{ marginTop: '12px', padding: '12px 14px', background: '#fff8ec', border: '1px solid var(--brass)' }}>
                                    <div style={S.label}>Read from the workbook as typed — worth a look</div>
                                    <ul style={{ margin: '8px 0 0 0', paddingLeft: '18px' }}>{sum.report.map((r, i) => <li key={i} style={{ fontFamily: 'var(--sans)', fontSize: '0.85rem', color: 'var(--ink)' }}>{r}</li>)}</ul>
                                </div>
                            )}
                            {im.refused && <div style={{ marginTop: '12px', padding: '12px', background: '#fdf3f2', border: '1px solid #e9c4c1', color: '#8a2a25', fontFamily: 'var(--sans)', fontSize: '0.88rem' }}>{im.refused}</div>}
                            {im.running && <div style={{ ...S.label, marginTop: '14px', color: 'var(--brass)' }}>{im.progress}</div>}
                        </>
                    )}
                    {im.finished && (
                        <>
                            <p style={{ ...S.note, color: 'var(--ink)', fontSize: '0.95rem' }}><b>{im.finished.name}</b> is in: {im.finished.lines} lines and {im.finished.pictures} pictures.{im.finished.missing ? ` ${im.finished.missing} picture(s) did not go up — those cells are empty.` : ''}</p>
                            {im.finished.report.length > 0 && <p style={S.note}>The notes from the workbook are kept on the sheet, under “Notes from the import”.</p>}
                        </>
                    )}
                    <div style={{ marginTop: '22px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                        <button style={S.btn} disabled={!!im.running} onClick={() => setImporter(null)}>{im.finished ? 'Close' : 'Cancel'}</button>
                        {sum && !im.finished && <button style={{ ...S.btnDark, opacity: im.running ? 0.6 : 1 }} disabled={!!im.running} onClick={runImport}>{im.running ? 'Importing…' : 'Import'}</button>}
                    </div>
                </div>
            </div>
        );
    };

    const starterWindow = () => (
        <div style={S.overlay} onClick={() => setStarter(null)}>
            <div style={{ ...S.modal, width: 'min(560px, 100%)' }} onClick={e => e.stopPropagation()}>
                <h3 style={S.h3}>Start a control sheet</h3>
                <p style={S.note}>A sheet belongs to a project named in tab 1 and takes its name. To add a project, name it in tab 1 first.</p>
                <label style={{ ...S.label, display: 'block', marginTop: '14px' }}>Project</label>
                <select value={starter.name} onChange={e => setStarter(s => ({ ...s, name: e.target.value }))} style={{ display: 'block', width: '100%', padding: '10px', marginTop: '6px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem' }}>
                    <option value="">— choose a project —</option>
                    {unstarted.map(p => <option key={p.key} value={p.name}>{p.name}</option>)}
                </select>
                <label style={{ ...S.label, display: 'block', marginTop: '16px' }}>Kind of sheet</label>
                <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                    {SHEET_KINDS.map(k => <button key={k} style={S.chip(starter.kind === k)} onClick={() => setStarter(s => ({ ...s, kind: k }))}>{KIND_LABEL[k]}</button>)}
                </div>
                <p style={{ ...S.note, marginTop: '8px' }}>{starter.kind === 'LIGHTING' ? 'A light: a costed parts list per assembly, sub-assemblies rolled into the product.' : 'Hardware: the item list of a collection, with pricing, the Library fields, the 1.6 tags and the milling columns.'}</p>
                <div style={{ marginTop: '22px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                    <button style={S.btn} onClick={() => setStarter(null)}>Cancel</button>
                    <button style={{ ...S.btnDark, opacity: starter.name ? 1 : 0.5 }} disabled={!starter.name} onClick={startSheet}>Start the sheet</button>
                </div>
            </div>
        </div>
    );

    const pushWindow = () => {
        const x = pusher;
        const line = lines.find(l => l.id === x.lineId);
        if (!line) return null;
        const label = String(line.itemCode || '').trim().toUpperCase() || lineLabelOf(line);
        const plan = x.looked && !x.existing ? pushPlanOf(line, { project, brandId: activeBrand, fields: allFields, pushColumns, customSchema, user: currentUser, nowIso: '', id: '' }) : null;
        const warn = { margin: '6px 0 0 0', paddingLeft: '18px', fontFamily: 'var(--sans)', fontSize: '0.86rem' };
        const red = { padding: '12px 14px', background: '#fdf3f2', border: '1px solid #e9c4c1', color: '#8a2a25', fontFamily: 'var(--sans)', fontSize: '0.9rem' };
        return (
            <div style={S.overlay}>
                <div style={{ ...S.modal, width: 'min(820px, 100%)' }}>
                    <h3 style={S.h3}>{x.finished ? `${x.finished.code} is in the Master Library` : `Push ${label} to the Master Library`}</h3>
                    {x.finished && (
                        <p style={{ ...S.note, color: 'var(--ink)', fontSize: '0.95rem' }}>
                            {x.finished.linked
                                ? <>The line is linked to the record the Library already had (<code>{x.finished.id}</code>). Nothing was written to the Library.</>
                                : <>Written as <code>{x.finished.id}</code> — {x.finished.fields} fields. The Library owns the item from here; the line stays on the sheet as the record of how it got there. It is app-only until it is created in NetSuite from tab 11.</>}
                        </p>
                    )}
                    {!x.finished && !x.ready.ok && (
                        <>
                            <p style={S.note}>Before this line can be pushed:</p>
                            <ul style={warn}>{x.ready.blocks.map((b, i) => <li key={i} style={{ color: '#8a2a25' }}>{b}</li>)}</ul>
                            {x.ready.warnings.length > 0 && <><p style={{ ...S.note, marginTop: '12px' }}>Worth a look, though they would not stop it:</p><ul style={warn}>{x.ready.warnings.map((w, i) => <li key={i} style={{ color: 'var(--ink-soft)' }}>{w}</li>)}</ul></>}
                        </>
                    )}
                    {x.looking && <p style={S.note}>Looking in the Master Library for {label}…</p>}
                    {x.error && <div style={red}>{x.error}</div>}
                    {!x.finished && x.looked && x.existing && (
                        <>
                            <div style={red}>The Master Library already has <b>{label}</b>: {x.existing.itemName || '(no name)'} — {x.existing.partClass || 'record'} <code>{x.existing.id}</code>. Nothing was written.</div>
                            <p style={{ ...S.note, marginTop: '12px' }}>If that record IS this part, link the line to it: the line is marked as in the Library and points at that record, and nothing is written to the Library. If it is a different part, give this line its own item #.</p>
                        </>
                    )}
                    {plan && (
                        <>
                            <p style={S.note}>The Library has no <b>{label}</b>. This is exactly what will be written — one new record. Only the columns ticked "Library" travel.</p>
                            <div style={{ maxHeight: '40vh', overflowY: 'auto', border: '1px solid var(--line)', marginTop: '12px' }}>
                                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                                    <thead><tr>{['On the sheet', 'In the Master Library', 'Value'].map(h => <th key={h} style={{ ...S.th, position: 'sticky', top: 0 }}>{h}</th>)}</tr></thead>
                                    <tbody>
                                        {plan.written.map(w => (
                                            <tr key={w.label}>
                                                <td style={{ ...S.td, padding: '6px 8px', color: 'var(--ink-soft)' }}>{w.label}</td>
                                                <td style={{ ...S.td, padding: '6px 8px' }}>{w.to}</td>
                                                <td style={{ ...S.td, padding: '6px 8px', fontWeight: 500, borderRight: 'none', wordBreak: 'break-word' }}>{w.text}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <p style={{ ...S.note, marginTop: '10px', fontSize: '0.8rem' }}>Also on the record: the project ({project.name}), this division, and the line it came from. {plan.kept.length > 0 && <>Stays on the sheet: {plan.kept.join(' · ')}.</>}</p>
                            {x.ready.warnings.length > 0 && (
                                <div style={{ marginTop: '10px', padding: '10px 14px', background: '#fff8ec', border: '1px solid var(--brass)' }}>
                                    <div style={S.label}>Worth a look before you push</div>
                                    <ul style={warn}>{x.ready.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                                </div>
                            )}
                        </>
                    )}
                    <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                        {x.finished && onNavigateToLibrary && <button style={S.btn} onClick={() => { const id = x.finished.id; setPusher(null); onNavigateToLibrary(id); }}>Open in Master Library ↗</button>}
                        <button style={S.btn} disabled={!!x.busy} onClick={() => setPusher(null)}>{x.finished || !x.ready.ok || x.error ? 'Close' : 'Cancel'}</button>
                        {!x.finished && x.looked && x.existing && <button style={{ ...S.btnDark, opacity: x.busy ? 0.6 : 1 }} disabled={!!x.busy} onClick={linkExisting}>{x.busy ? 'Linking…' : 'Link this line to that record'}</button>}
                        {plan && <button style={{ ...S.btnDark, background: 'var(--brass)', opacity: x.busy ? 0.6 : 1 }} disabled={!!x.busy} onClick={runPush}>{x.busy ? 'Pushing…' : 'Push to the Master Library'}</button>}
                    </div>
                </div>
            </div>
        );
    };

    const downloadWindow = () => {
        const d = downloader;
        const sel = picked();
        const toggle = (key) => setDownloader(x => ({ ...x, columns: x.columns.map(c => (c.key === key && !c.fixed ? { ...c, on: !c.on } : c)) }));
        const hasPicture = d.columns.some(c => c.on && c.field && c.field.type === 'picture');
        return (
            <div style={S.overlay}>
                <div style={S.modal}>
                    <h3 style={S.h3}>Download {sel.length} line{sel.length === 1 ? '' : 's'} as .xlsx</h3>
                    <p style={S.note}>The columns showing on the sheet, in its order — untick what should not leave. <b>Our own figures</b> (USD, duty, landed, base price) start unticked: tick them only for a file that stays in-house. To send a column that is not listed, switch its group on first.</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '6px 14px', margin: '16px 0' }}>
                        {d.columns.map(c => (
                            <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'var(--sans)', fontSize: '0.86rem', color: c.on ? 'var(--ink)' : 'var(--ink-soft)', cursor: c.fixed ? 'default' : 'pointer' }}>
                                <input type="checkbox" checked={c.on} disabled={!!c.fixed || d.busy} onChange={() => toggle(c.key)} />
                                {c.label}{c.fixed ? ' — how a row finds its line' : c.back ? '' : ' (read only)'}
                            </label>
                        ))}
                    </div>
                    {hasPicture && <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'var(--sans)', fontSize: '0.86rem' }}><input type="checkbox" checked={d.pictures} disabled={d.busy} onChange={e => setDownloader(x => ({ ...x, pictures: e.target.checked }))} /> Put each line's picture in the file</label>}
                    <p style={{ ...S.note, marginTop: '12px', fontSize: '0.8rem' }}>What comes back is never applied by itself: <b>Bring back a returned file</b> lists every difference first. "(read only)" columns are worked out here and are not read back.</p>
                    {d.busy && <div style={{ ...S.label, color: 'var(--brass)', marginTop: '10px' }}>{d.progress}</div>}
                    <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                        <button style={S.btn} disabled={d.busy} onClick={() => setDownloader(null)}>Cancel</button>
                        <button style={{ ...S.btnDark, opacity: d.busy ? 0.6 : 1 }} disabled={d.busy} onClick={runDownload}>{d.busy ? 'Making the file…' : 'Download'}</button>
                    </div>
                </div>
            </div>
        );
    };

    const reimportWindow = () => {
        const r = reimporter;
        const plan = r.plan;
        const setTick = (key, on) => setReimporter(x => ({ ...x, ticks: { ...x.ticks, [key]: on } }));
        const tickAll = (on) => setReimporter(x => ({ ...x, ticks: Object.fromEntries(Object.keys(x.ticks).map(k => [k, on])) }));
        const nTicked = plan ? Object.values(r.ticks).filter(Boolean).length + Object.values(r.newTicks).filter(Boolean).length : 0;
        const list = { margin: '6px 0 0 0', paddingLeft: '18px', fontFamily: 'var(--sans)', fontSize: '0.84rem', color: 'var(--ink-soft)' };
        return (
            <div style={S.overlay}>
                <div style={{ ...S.modal, width: 'min(980px, 100%)' }}>
                    <h3 style={S.h3}>Bring back — {r.fileName}</h3>
                    {r.reading && <p style={S.note}>Reading the file…</p>}
                    {r.error && <div style={{ padding: '12px', background: '#fdf3f2', border: '1px solid #e9c4c1', color: '#8a2a25', fontFamily: 'var(--sans)', fontSize: '0.9rem' }}>{r.error}</div>}
                    {plan && plan.refused && <div style={{ padding: '12px', background: '#fdf3f2', border: '1px solid #e9c4c1', color: '#8a2a25', fontFamily: 'var(--sans)', fontSize: '0.9rem' }}>{plan.refused} Nothing was changed.</div>}
                    {r.finished && <p style={{ ...S.note, color: 'var(--ink)', fontSize: '0.95rem' }}>{r.finished.cells} change{r.finished.cells === 1 ? '' : 's'} taken on {r.finished.lines} line{r.finished.lines === 1 ? '' : 's'}{r.finished.added ? `, and ${r.finished.added} line${r.finished.added === 1 ? '' : 's'} added` : ''}.{r.finished.noRate.length ? ` Today's rate could not be had for ${r.finished.noRate.join(', ')} — their USD is blank until Update rates is pressed.` : ''}</p>}
                    {plan && !plan.refused && !r.finished && (
                        <>
                            <p style={S.note}>Every difference between the file and the sheet, as <b>what is here → what the file says</b>. Only what is ticked is taken. A blank in the file never clears a value unless you tick it; a price or currency taken is worked into USD at today's rate.{r.exportedAt ? ` The file was downloaded ${r.exportedAt.slice(0, 16).replace('T', ' at ')}.` : ' This file has lost the note of which sheet it came from, so its rows were matched by their Ref alone.'}</p>
                            {plan.changes.length === 0 && plan.newRows.length === 0 && <div style={{ ...S.note, padding: '20px', border: '1px dashed var(--line)', textAlign: 'center', margin: '14px 0' }}>The file says what the sheet already says — {plan.unchanged} line{plan.unchanged === 1 ? '' : 's'} read, nothing to take.</div>}
                            {plan.changes.length > 0 && (
                                <div style={{ margin: '14px 0 6px 0', display: 'flex', gap: '10px', alignItems: 'center' }}>
                                    <span style={S.label}>{plan.changes.length} line{plan.changes.length === 1 ? '' : 's'} differ · {plan.unchanged} the same</span>
                                    <button style={{ ...S.btn, padding: '5px 10px' }} onClick={() => tickAll(true)}>Tick all</button>
                                    <button style={{ ...S.btn, padding: '5px 10px' }} onClick={() => tickAll(false)}>Untick all</button>
                                </div>
                            )}
                            <div style={{ maxHeight: '44vh', overflowY: 'auto', border: plan.changes.length ? '1px solid var(--line)' : 'none' }}>
                                {plan.changes.map(ch => (
                                    <div key={ch.lineId} style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '0.78rem', color: 'var(--ink)' }}>{ch.label}{ch.stale && <span style={{ marginLeft: '10px', color: '#b5651d', fontFamily: 'var(--sans)' }}>edited here{ch.staleBy ? ` by ${ch.staleBy}` : ''} after the file was downloaded — check before taking</span>}</div>
                                        {ch.cells.map(c => (
                                            <label key={c.key} style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '6px', fontFamily: 'var(--sans)', fontSize: '0.86rem', cursor: 'pointer' }}>
                                                <input type="checkbox" checked={!!r.ticks[`${ch.lineId}|${c.key}`]} disabled={r.busy} onChange={e => setTick(`${ch.lineId}|${c.key}`, e.target.checked)} />
                                                <span style={{ ...S.label, minWidth: '130px' }}>{c.label}</span>
                                                <span style={{ color: 'var(--ink-soft)' }}>{c.fromText}</span><span style={{ color: 'var(--brass)' }}>→</span><span style={{ color: 'var(--ink)', fontWeight: 500 }}>{c.toText}</span>
                                                {c.clears && <span style={{ color: '#b5651d', fontSize: '0.78rem' }}>blank in the file — would clear it</span>}
                                            </label>
                                        ))}
                                    </div>
                                ))}
                            </div>
                            {plan.newRows.length > 0 && (
                                <div style={{ marginTop: '14px' }}>
                                    <div style={S.label}>Rows the file adds (no Ref) — taken only if ticked, as new draft lines</div>
                                    {plan.newRows.map(row => (
                                        <label key={row.index} style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '6px', fontFamily: 'var(--sans)', fontSize: '0.86rem', cursor: 'pointer' }}>
                                            <input type="checkbox" checked={!!r.newTicks[row.index]} disabled={r.busy} onChange={e => setReimporter(x => ({ ...x, newTicks: { ...x.newTicks, [row.index]: e.target.checked } }))} />
                                            <span style={{ fontWeight: 500 }}>{row.label}</span>
                                            <span style={{ color: 'var(--ink-soft)' }}>{row.cells.map(c => `${c.label}: ${c.toText}`).join(' · ')}</span>
                                        </label>
                                    ))}
                                </div>
                            )}
                            {(plan.locked.length > 0 || plan.unknownRefs.length > 0 || plan.ignored.length > 0) && (
                                <details style={{ marginTop: '14px' }}>
                                    <summary style={{ ...S.label, cursor: 'pointer' }}>Left alone ({plan.locked.length + plan.unknownRefs.length + plan.ignored.length})</summary>
                                    <ul style={list}>
                                        {plan.locked.map(t => <li key={`k${t}`}>{t} — already pushed to the Master Library; the file cannot change it</li>)}
                                        {plan.unknownRefs.map(t => <li key={`u${t}`}>Ref {t} — no such line on this sheet (deleted since, or the Ref was changed)</li>)}
                                        {plan.ignored.map(t => <li key={`i${t}`}>Column {t}</li>)}
                                    </ul>
                                </details>
                            )}
                        </>
                    )}
                    <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                        <button style={S.btn} disabled={!!r.busy} onClick={() => setReimporter(null)}>{r.finished || r.error || (plan && plan.refused) ? 'Close' : 'Cancel'}</button>
                        {plan && !plan.refused && !r.finished && (plan.changes.length > 0 || plan.newRows.length > 0) && <button style={{ ...S.btnDark, opacity: r.busy || !nTicked ? 0.6 : 1 }} disabled={!!r.busy || !nTicked} onClick={applyReimport}>{r.busy ? 'Taking…' : `Take ${nTicked} ticked`}</button>}
                    </div>
                </div>
            </div>
        );
    };

    // ── the page ──
    const header = (
        <div style={{ ...S.card, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
            <div>
                <span style={{ ...S.label, display: 'block', marginBottom: '4px' }}>{projects.length} sheet{projects.length === 1 ? '' : 's'} in this division · working / holding — nothing here is in the app until it is pushed</span>
                <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>Control Sheets</h2>
            </div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                <select value={projectId} onChange={e => setProjectId(e.target.value)} style={{ padding: '10px 12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.9rem', minWidth: '240px', background: 'var(--paper-2)' }}>
                    <option value="">— every project —</option>
                    {[...projects].sort((a, b) => String(a.name).localeCompare(String(b.name))).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <button style={S.btn} onClick={() => setStarter({ name: '', kind: 'HARDWARE' })}>+ Start a sheet</button>
                {canManage && <button style={S.btn} onClick={() => setImporter({})} title="Bring in a workbook prepared for this tab, with its pictures">⤓ Import a workbook</button>}
            </div>
        </div>
    );

    const projectList = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {projects.length === 0 && unstarted.length === 0 && <div style={{ ...S.card, ...S.note, textAlign: 'center', padding: '50px' }}>No control sheets yet. Name a project in tab 1, then start its sheet here.</div>}
            {projects.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                    {[...projects].sort((a, b) => String(a.name).localeCompare(String(b.name))).map(p => {
                        const named = tab1Projects.some(t => t.key === projectNameKey(p.name));
                        return (
                            <button key={p.id} onClick={() => setProjectId(p.id)} style={{ ...S.card, textAlign: 'left', cursor: 'pointer' }}>
                                <div style={S.label}>{KIND_LABEL[p.kind] || p.kind} · {(p.sections || []).length} sheet{(p.sections || []).length === 1 ? '' : 's'}</div>
                                <div style={{ fontFamily: 'var(--serif)', fontSize: '1.35rem', margin: '6px 0', color: 'var(--ink)' }}>{p.name}</div>
                                <div style={{ ...S.note, fontSize: '0.8rem', color: named ? 'var(--ink-soft)' : 'var(--brass)' }}>{named ? 'Named in tab 1' : 'Not named in tab 1 yet — name the project there to bring its pictures in'}</div>
                            </button>
                        );
                    })}
                </div>
            )}
            {unstarted.length > 0 && (
                <div style={S.card}>
                    <div style={S.label}>Projects named in tab 1 with no control sheet yet</div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
                        {unstarted.map(p => <button key={p.key} style={S.btn} onClick={() => setStarter({ name: p.name, kind: 'HARDWARE' })}>{p.name} →</button>)}
                    </div>
                </div>
            )}
        </div>
    );

    const sheet = project && (
        <>
            <div style={{ ...S.card, padding: '0' }}>
                <div style={{ padding: '18px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap', borderBottom: '1px solid var(--line)' }}>
                    <div>
                        <span style={{ fontFamily: 'var(--serif)', fontSize: '1.5rem', color: 'var(--ink)' }}>{project.name}</span>
                        <span style={{ ...S.label, marginLeft: '14px' }}>{KIND_LABEL[kind] || kind} · {lines.length} line{lines.length === 1 ? '' : 's'}{counts.length ? ` · ${counts.map(c => `${c.n} ${STATUS_LABEL[c.s].toLowerCase()}`).join(' · ')}` : ''}{tab1Here ? '' : ' · not named in tab 1 yet'}</span>
                    </div>
                    <input placeholder="Search item #, words, vendor…" value={search} onChange={e => setSearch(e.target.value)} style={{ padding: '9px 12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.88rem', width: '240px', outline: 'none' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', overflowX: 'auto', padding: '0 12px', borderBottom: '1px solid var(--line)' }}>
                    <button style={S.tab(!section)} onClick={() => setSectionId('')}>Every part ({lines.length})</button>
                    {sections.map(s => <button key={s.id} style={S.tab(sectionId === s.id)} onClick={() => setSectionId(s.id)}>{s.kind === 'PRODUCT' ? '◆ ' : ''}{s.name}</button>)}
                    <button style={{ ...S.tab(false), color: 'var(--brass)' }} onClick={addSection}>+ sheet</button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', padding: '12px 24px' }}>
                    <span style={S.label}>Columns</span>
                    {groups.filter(g => !g.always).map(g => <button key={g.key} style={S.chip(shown.includes(g.key))} onClick={() => setShown(prev => (prev.includes(g.key) ? prev.filter(k => k !== g.key) : [...prev, g.key]))}>{g.label}</button>)}
                </div>
                {Array.isArray(project.importNotes) && project.importNotes.length > 0 && (
                    <details style={{ padding: '0 24px 14px 24px' }}>
                        <summary style={{ ...S.label, cursor: 'pointer', color: 'var(--brass)' }}>Notes from the import ({project.importNotes.length}) — read from {project.importedFrom || 'the workbook'} as typed</summary>
                        <ul style={{ margin: '8px 0 0 0', paddingLeft: '18px' }}>{project.importNotes.map((r, i) => <li key={i} style={{ fontFamily: 'var(--sans)', fontSize: '0.85rem' }}>{r}</li>)}</ul>
                    </details>
                )}
            </div>

            {section && (
                <div style={{ ...S.card, display: 'flex', gap: '20px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                        {(section.drawings || []).map(d => (
                            <div key={d.url} style={{ position: 'relative', border: '1px solid var(--line)', background: 'var(--paper)' }}>
                                <a href={d.url} target="_blank" rel="noreferrer" title="Open the drawing full size"><img src={d.url} alt="Drawing" style={{ display: 'block', height: '150px', maxWidth: '200px', objectFit: 'contain' }} /></a>
                                <button onClick={() => removeDrawing(d.url)} title="Take this drawing off the sheet" style={{ position: 'absolute', top: '2px', right: '2px', width: '20px', height: '20px', lineHeight: 1, background: '#fff', border: '1px solid var(--line)', color: '#d9534f', cursor: 'pointer' }}>×</button>
                            </div>
                        ))}
                        <button onClick={() => setOpen({ kind: 'DRAWING', sectionId: section.id })} style={{ height: '150px', width: '110px', border: '1px dashed var(--line)', background: 'transparent', color: 'var(--ink-soft)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em' }}>+ drawing from tab 1</button>
                    </div>
                    <div style={{ flex: 1, minWidth: '300px' }}>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ fontFamily: 'var(--serif)', fontSize: '1.3rem' }}>{section.name}</span>
                            <select value={section.kind || 'ASSEMBLY'} onChange={e => patchSection(section.id, { kind: e.target.value })} title="A sub-assembly is taken by another sheet; the product is the light itself" style={{ padding: '6px 8px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.82rem' }}>
                                <option value="ASSEMBLY">An assembly</option>
                                <option value="PRODUCT">The product</option>
                            </select>
                            <button style={S.btn} onClick={renameSection}>Rename</button>
                            <button style={{ ...S.btn, color: '#d9534f' }} onClick={deleteSection}>Remove sheet</button>
                        </div>
                        <div style={{ marginTop: '14px', display: 'flex', alignItems: 'baseline', gap: '14px', flexWrap: 'wrap' }}>
                            <span style={S.label}>Cost per assembly</span>
                            <span style={{ fontFamily: 'var(--serif)', fontSize: '1.7rem' }}>{moneyText(total.total)}</span>
                            {total.unpriced > 0 && <span style={{ ...S.note, color: 'var(--brass)' }}>{total.unpriced} line{total.unpriced === 1 ? '' : 's'} not in this figure — no USD or no quantity yet</span>}
                            {numOf(section.importedTotal) !== null && <span style={{ ...S.note, fontSize: '0.8rem' }}>the workbook read {moneyText(numOf(section.importedTotal))} when it came in</span>}
                        </div>
                        {((section.children || []).length > 0 || childChoicesFor(section.id, sections).length > 0) && (
                            <div style={{ marginTop: '14px' }}>
                                <div style={S.label}>Sub-assemblies this sheet takes</div>
                                {total.children.map(c => (
                                    <div key={c.section} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px', fontFamily: 'var(--sans)', fontSize: '0.88rem' }}>
                                        <input key={`b-${(section.children.find(x => x.section === c.section) || {}).balloon || ''}`} defaultValue={(section.children.find(x => x.section === c.section) || {}).balloon || ''} placeholder="#" title="Balloon number on the drawing" onBlur={e => patchChild(c.section, { balloon: e.target.value.trim() })} style={{ width: '44px', padding: '5px', border: '1px solid var(--line)', textAlign: 'center' }} />
                                        <button onClick={() => setSectionId(c.section)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--ink)', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'var(--sans)', fontSize: '0.88rem' }}>{c.name}</button>
                                        <span style={{ color: 'var(--ink-soft)' }}>×</span>
                                        <input key={`q-${c.qty}`} defaultValue={c.qty === null ? '' : String(c.qty)} title="How many this sheet takes" onBlur={e => { const q = numOf(e.target.value); if (q !== c.qty) patchChild(c.section, { qty: q }); }} style={{ width: '52px', padding: '5px', border: '1px solid var(--line)', textAlign: 'right' }} />
                                        <span style={{ color: 'var(--ink-soft)' }}>{c.each === null ? '' : `${moneyText(c.each)} each`}</span>
                                        <span style={{ marginLeft: 'auto' }}>{c.cost === null ? '—' : moneyText(c.cost)}</span>
                                        <button onClick={() => removeChild(c.section)} title="Take this sub-assembly off the sheet" style={{ background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', fontSize: '1rem' }}>×</button>
                                    </div>
                                ))}
                                {childChoicesFor(section.id, sections).length > 0 && (
                                    <select value="" onChange={e => addChild(e.target.value)} style={{ marginTop: '8px', padding: '6px 8px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.82rem', color: 'var(--ink-soft)' }}>
                                        <option value="">+ take another sheet as a sub-assembly…</option>
                                        {childChoicesFor(section.id, sections).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                    </select>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            <div style={{ ...S.card, padding: 0 }}>
                <div style={{ overflow: 'auto', maxHeight: '72vh' }}>
                    <table style={{ borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed', width: `${tableWidth}px` }}>
                        <colgroup>{columns.map(c => <col key={c.key} style={{ width: `${c.width}px` }} />)}</colgroup>
                        <thead>
                            <tr>{columns.map(c => {
                                if (c.key === 'SEL') return <th key={c.key} style={{ ...thStyle(c), textAlign: 'center', padding: '8px 0' }}><input type="checkbox" title="Select every line shown" checked={rows.length > 0 && rows.every(l => selected.includes(l.id))} onChange={e => setSelected(e.target.checked ? rows.map(l => l.id) : [])} style={{ cursor: 'pointer' }} /></th>;
                                const ps = c.field ? pushStateOf(c.field, pushColumns, customSchema) : null;
                                return (
                                    <th key={c.key} title={c.label} style={{ ...thStyle(c), verticalAlign: 'top' }}>
                                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label || '\u00a0'}</div>
                                        {ps && ps.offered && (
                                            <label title={pushTitle(c.field, ps)} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '5px', fontSize: '8px', letterSpacing: '.04em', color: ps.missing ? '#b5651d' : ps.on ? 'var(--brass)' : 'var(--ink-soft)', cursor: ps.locked || !canManage ? 'default' : 'pointer', opacity: ps.on ? 1 : 0.75 }}>
                                                <input type="checkbox" checked={ps.on} disabled={ps.locked || !canManage} onChange={e => setPush(c.field, e.target.checked)} style={{ margin: 0, width: '11px', height: '11px' }} />
                                                {ps.missing ? (c.width < 84 ? '\u26a0' : '\u26a0 no field') : (c.width < 84 ? 'Lib' : 'Library')}
                                            </label>
                                        )}
                                        {ps && !ps.offered && <div title="Held on the sheet — never pushed to the Master Library" style={{ marginTop: '5px', fontSize: '8px', letterSpacing: '.04em', opacity: 0.6 }}>sheet only</div>}
                                    </th>
                                );
                            })}</tr>
                        </thead>
                        <tbody>
                            {rows.length === 0 && <tr><td colSpan={columns.length} style={{ ...S.td, ...S.note, padding: '34px', borderRight: 'none' }}>{search ? 'No line matches the search.' : section ? 'No parts on this sheet yet.' : 'No lines yet.'}</td></tr>}
                            {rows.map(line => {
                                const locked = line.status === PUSHED;
                                const use = section ? placeOf(line, section.id) : null;
                                const cost = section ? lineCostIn(line, section.id) : null;
                                const bg = locked ? 'var(--paper)' : '#fff';
                                const enter = e => { if (e.key === 'Enter') e.target.blur(); };
                                return (
                                    <tr key={line.id} style={{ background: bg }}>
                                        {columns.map(c => {
                                            const style = tdStyle(c, bg);
                                            if (c.key === 'SEL') return <td key={c.key} style={{ ...style, textAlign: 'center', padding: 0 }}><input type="checkbox" title="Select this line" checked={selected.includes(line.id)} onChange={e => setSelected(prev => (e.target.checked ? [...prev, line.id] : prev.filter(id => id !== line.id)))} style={{ cursor: 'pointer' }} /></td>;
                                            if (c.key === '#') return <td key={c.key} style={style}><input key={`b-${use.balloon || ''}`} defaultValue={use.balloon || ''} disabled={locked} title="Balloon number on the drawing" onBlur={e => { if (e.target.value.trim() !== (use.balloon || '')) patchLine(line, { [`uses.${section.id}.balloon`]: e.target.value.trim() }); }} onKeyDown={enter} style={{ ...S.input, textAlign: 'center', fontWeight: 500 }} /></td>;
                                            if (c.key === 'QTY') return <td key={c.key} style={style}><input key={`q-${use.qty}`} defaultValue={use.qty === null || use.qty === undefined ? '' : String(use.qty)} disabled={locked} title="How many of this part the assembly takes" onBlur={e => { const q = numOf(e.target.value); if (q !== numOf(use.qty)) patchLine(line, { [`uses.${section.id}.qty`]: q }); }} onKeyDown={enter} style={{ ...S.input, textAlign: 'right' }} /></td>;
                                            if (c.key === 'COST') return <td key={c.key} style={{ ...style, textAlign: 'right', padding: '6px 8px', color: cost === null ? 'var(--ink-soft)' : 'var(--ink)' }}>{cost === null ? '—' : moneyText(cost, cost < 1 ? 3 : 2)}</td>;
                                            if (c.key === 'ON') { const on = usesListOf(line, sections).map(u => `${u.section.name}${numOf(u.use.qty) === null ? '' : ` ×${numOf(u.use.qty)}`}`).join(' · '); return <td key={c.key} title={on || undefined} style={{ ...style, padding: '6px 8px', color: 'var(--ink-soft)', fontSize: '0.76rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{on || '—'}</td>; }
                                            if (c.key === 'NOTE') return <td key={c.key} style={style}><input key={`n-${use.note || ''}`} defaultValue={use.note || ''} disabled={locked} title={use.note || undefined} onBlur={e => { if (e.target.value.trim() !== (use.note || '')) patchLine(line, { [`uses.${section.id}.note`]: e.target.value.trim() }); }} onKeyDown={enter} style={S.input} /></td>;
                                            if (c.key === 'STATUS') return (
                                                <td key={c.key} style={style}>
                                                    {locked
                                                        ? <span style={{ ...S.label, color: 'var(--brass)', padding: '0 6px' }}>{line.pushedTo && line.pushedTo.linked ? 'In library' : 'Pushed'}</span>
                                                        : <select value={LINE_STATUSES.includes(line.status) ? line.status : 'DRAFT'} onChange={e => patchLine(line, { status: e.target.value })} style={{ ...S.input, cursor: 'pointer' }}>{LINE_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>}
                                                </td>
                                            );
                                            if (c.key === 'PUSH') {
                                                if (locked) {
                                                    const to = line.pushedTo || {};
                                                    return (
                                                        <td key={c.key} style={{ ...style, padding: '4px 8px' }}>
                                                            <button onClick={() => (onNavigateToLibrary && to.docId ? onNavigateToLibrary(to.docId) : alert(`${to.code || lineLabelOf(line)} is in the Master Library as ${to.docId || '(no record noted)'}.`))} title={`Open ${to.code || ''} in the Master Library${to.by ? ` — ${to.linked ? 'linked' : 'pushed'} by ${to.by} ${String(to.at || '').slice(0, 10)}` : ''}`} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--brass)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.06em' }}>Open in Library ↗</button>
                                                            {canManage && <button onClick={() => unlockLine(line)} title="If this record was removed from the Master Library, bring the line back to the sheet" style={{ display: 'block', background: 'none', border: 'none', padding: 0, marginTop: '3px', color: 'var(--ink-soft)', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: '0.7rem', textDecoration: 'underline' }}>unlock</button>}
                                                        </td>
                                                    );
                                                }
                                                const ready = readinessOf(line, pushContext);
                                                const word = ready.ok ? 'Push \u2192' : `${ready.blocks.length} to fix`;
                                                return (
                                                    <td key={c.key} style={{ ...style, padding: '4px 8px' }}>
                                                        {canManage
                                                            ? <button onClick={() => openPush(line)} title={ready.ok ? 'Push this line into the Master Library — you are shown exactly what is written first' : `Not ready to push:\n${ready.blocks.join('\n')}`} style={{ ...S.btn, padding: '6px 10px', width: '100%', ...(ready.ok ? { background: 'var(--brass)', color: '#fff', borderColor: 'var(--brass)' } : { color: 'var(--ink-soft)' }) }}>{word}</button>
                                                            : <span title={ready.ok ? 'A manager pushes it' : ready.blocks.join('\n')} style={{ ...S.label, color: ready.ok ? 'var(--brass)' : 'var(--ink-soft)' }}>{ready.ok ? 'Ready to push' : word}</span>}
                                                    </td>
                                                );
                                            }
                                            if (c.key === 'ACT') return (
                                                <td key={c.key} style={style}>
                                                    {section
                                                        ? <button onClick={() => takeOffSheet(line)} disabled={locked} title="Take this part off the sheet (it stays in the project)" style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', cursor: 'pointer', fontSize: '1rem' }}>×</button>
                                                        : <button onClick={() => deleteLine(line)} title="Delete this line from the project" style={{ background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', fontSize: '0.9rem' }}>🗑</button>}
                                                </td>
                                            );
                                            return (
                                                <td key={c.key} style={{ ...style, ...(c.field.type === 'picture' ? { padding: '4px 6px' } : {}) }}>
                                                    <Cell field={c.field} line={line} lists={lists} locked={locked}
                                                        onCommit={v => commitCell(line, c.field, v)}
                                                        onOpen={k => setOpen({ kind: k, lineId: line.id })} />
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', padding: '14px 20px', borderTop: '1px solid var(--line)' }}>
                    <button style={S.btnDark} onClick={addLine}>+ New line{section ? ' on this sheet' : ''}</button>
                    {section && lines.some(l => !placeOf(l, section.id)) && (
                        <select value={useExisting} onChange={e => putOnSheet(e.target.value)} style={{ padding: '8px 10px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.85rem', maxWidth: '360px' }}>
                            <option value="">+ use a part already in the project…</option>
                            {sortLines(lines).filter(l => !placeOf(l, section.id)).map(l => <option key={l.id} value={l.id}>{lineLabelOf(l)}{l.name && l.name !== lineLabelOf(l) ? ` — ${String(l.name).slice(0, 50)}` : ''}</option>)}
                        </select>
                    )}
                    <span style={{ ...S.note, fontSize: '0.8rem', marginLeft: 'auto' }}>A box saves when the cursor leaves it.</span>
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', padding: '12px 20px', borderTop: '1px solid var(--line)', background: 'var(--paper)' }}>
                    <span style={S.label}>{selected.length ? `${picked().length} selected` : 'To send out'}</span>
                    <button style={S.btn} onClick={openDownload} title="An Excel file of the ticked lines, with their pictures, to send to a vendor">⤓ Download selected as .xlsx</button>
                    <label style={{ ...S.btn, display: 'inline-block' }} title="Read a file that came back, see every difference, and choose what to take">
                        ⤒ Bring back a returned file
                        <input type="file" accept=".xlsx" style={{ display: 'none' }} onChange={e => { const fl = e.target.files && e.target.files[0]; e.target.value = ''; readReimport(fl); }} />
                    </label>
                    <button style={{ ...S.btn, marginLeft: 'auto', opacity: ratesBusy ? 0.6 : 1 }} disabled={ratesBusy} onClick={updateRates} title="Work every RMB and euro price out again at today's rate. A USD does not move until this is pressed.">{ratesBusy ? 'Asking for rates…' : '↻ Update rates'}</button>
                </div>
            </div>
        </>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '30px', fontFamily: 'var(--sans)', minHeight: '100vh' }}>
            <datalist id="cs-vendors">{vendorNames.map(v => <option key={v} value={v} />)}</datalist>
            {header}
            {project ? sheet : projectList}
            {open && (open.kind === 'QUOTES' ? quotesWindow() : pictureWindow())}
            {starter && starterWindow()}
            {importer && importWindow()}
            {downloader && downloadWindow()}
            {reimporter && reimportWindow()}
            {pusher && pushWindow()}
        </div>
    );
};

const ControlSheetsTab = (props) => <SheetBoundary><ControlSheetsInner {...props} /></SheetBoundary>;

export default ControlSheetsTab;
