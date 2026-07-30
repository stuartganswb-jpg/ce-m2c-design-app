// CUSTOMER COLLECTIONS (HQ 4.6, Stuart 2026-07-29) — maintain a customer's pricing across a whole
// collection in one screen.
//
// WHY: Fabricut H1 was built from a one-off xlsx import. It worked, but it left no way to fix what
// the sheet missed (H1-1D), and no way at all to price a SECOND customer against an existing
// collection (Calico ↔ Simple Elegance). Re-uploading a sheet to change one number is not
// maintenance. This page is the maintenance surface: pick a customer and a collection, see every
// part, edit in place, add the ones that were missed, and import a control file when a new one
// arrives — as a reviewable diff, never a blind overwrite.
//
// WHERE THE DATA GOES — nothing new is invented, because the plumbing already exists:
//   clientPricing[] on the item   → { customerId, clientSku, price, clientSalesPrice }
//        price            = what this customer pays us   ("Calico Net")
//        clientSalesPrice = what they sell it for        ("Your Sales Price")
//        clientSku        = their own item id            ("Calico ID")
//   manufacturingSpecs.collections[] → collection membership (app-owned; the NetSuite item sync
//        merges customData app-wins and never writes `collections`, so it survives an import)
// CPQ, Quick Ship and the portal BFF all already read clientPricing through the same semantics
// (Shared/clientPricing.js — a row counts when its price parses > 0), so a save here is live
// everywhere on the next snapshot. No mirror, no deploy.
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, query, where, doc, setDoc, writeBatch } from "firebase/firestore";
import { parseControlWorkbook, collapseBySku, diffControlRows, diffSummary, upper } from '../Shared/customerControlFile';
import { fabricutCodeOf } from '../Shared/priceLevels';

const theme = {
    paper: '#faf8f4', paper2: '#f2efe8', ink: '#1c1a16', inkSoft: '#524e46',
    brass: '#b08d57', line: '#d9d4ca', green: '#3a7d44', red: '#d9534f', blue: '#3f7fc4',
    mono: "'Courier New', monospace", sans: 'var(--sans)', serif: 'var(--serif)',
};
const money = (v) => (v === '' || v === null || v === undefined || isNaN(parseFloat(v))) ? '' : parseFloat(v);
const fmt = (v) => { const n = money(v); return n === '' ? '' : n.toFixed(2); };

// ---- PRICING THAT ALREADY EXISTS SOMEWHERE ELSE (Stuart 2026-07-29) -------------------------
// "when i pick customer fabricut and collection H1, the fields on the master are already filled
// out, but on this new tool come up empty — can it search the fields for existing?"
//
// It can, and it has to: Fabricut's numbers were never written as customer rows. The CrossReference
// import stamped them into manufacturingSpecs.fabricut, and only the Library's "⇄ Populate Client
// Pricing" button ever copied them across. So this page reads that box too and shows the values as
// SUGGESTIONS — greyed, marked, not claimed as saved — with one button to adopt them into real
// clientPricing rows. Nothing is written behind the operator's back; the suggestion is a proposal
// he can see, edit, or ignore.
//
// A registry rather than an if-statement because the shape is customer-specific: Fabricut is the
// only customer with a legacy struct, and every customer set up through this page from now on uses
// clientPricing from the start.
const fabricutSuggestion = (part, findByCode) => {
    const fab = part?.manufacturingSpecs?.fabricut;
    if (!fab) return null;
    const code = upper(part.legacyErpId || part.itemId);
    const plated = (code.includes('/') ? code.split('/')[1] : '').startsWith('EP');
    // Variant docs carry {cost, retail, wholesale} directly; base (mill) docs carry the painted and
    // plated tiers side by side and the doc's own suffix picks which one applies.
    const pick = (direct, painted, platedKey) => (fab[direct] !== undefined ? fab[direct] : (plated ? fab[platedKey] : fab[painted]));
    const cost = pick('cost', 'paintedCost', 'platedCost');
    const retail = pick('retail', 'paintedRetail', 'platedRetail');
    let ws = pick('wholesale', 'paintedWholesale', 'platedWholesale');
    if (ws === undefined || ws === null) ws = Number.isFinite(parseFloat(retail)) ? parseFloat(retail) / 2 : null;
    if (cost === undefined && retail === undefined) return null;   // no tier for this variant
    if (cost === null && retail === null) return null;             // group-priced plate ($0 with the arm)
    return {
        clientSku: fabricutCodeOf(part, findByCode) || '',
        price: cost === null || cost === undefined ? '' : cost,
        clientSalesPrice: ws === null || ws === undefined ? '' : ws,
    };
};
const LEGACY_SOURCES = [
    { match: /fabricut/i, label: 'Fabricut pricing box', read: fabricutSuggestion },
];

// Every collection an item claims — explicit list first, else the NetSuite-synced single value.
const collectionsOf = (specs) => {
    const s = specs || {};
    if (Array.isArray(s.collections) && s.collections.length) return s.collections.map(c => upper(c));
    const c = s.customData?.collection;
    return c && c !== 'N/A' ? [upper(c)] : [];
};

const CustomerCollectionsTab = ({ currentUser, activeBrand }) => {
    const [inventory, setInventory] = useState([]);
    const [customers, setCustomers] = useState([]);
    const [custId, setCustId] = useState('');
    const [coll, setColl] = useState('');
    const [search, setSearch] = useState('');
    const [onlyPriced, setOnlyPriced] = useState('ALL');   // ALL | PRICED | MISSING
    const [edits, setEdits] = useState({});                 // docId → { clientSku, price, clientSalesPrice, basePrice }
    const [saving, setSaving] = useState(false);
    const [addSearch, setAddSearch] = useState('');
    const [imp, setImp] = useState(null);                   // { entries, summary, fileName, applying }
    const [busy, setBusy] = useState('');
    const fileRef = useRef(null);

    useEffect(() => {
        if (!activeBrand) return;
        const unsubItems = onSnapshot(query(collection(db, 'Approved_Designs')), snap => {
            const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .filter(d => d.brandId === activeBrand || (d.sharedBrands || []).includes(activeBrand))
                .filter(d => d.manufacturingSpecs?.isRetired !== true);
            docs.sort((a, b) => String(a.legacyErpId || a.itemId || '').localeCompare(String(b.legacyErpId || b.itemId || ''), undefined, { numeric: true }));
            setInventory(docs);
        });
        const unsubCust = onSnapshot(query(collection(db, 'crm_records'), where('type', '==', 'CUSTOMER')), snap => {
            const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            setCustomers(all.filter(c => c.brandId === activeBrand || (c.sharedBrands || []).includes(activeBrand))
                .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))));
        });
        return () => { unsubItems(); unsubCust(); };
    }, [activeBrand]);

    const codeOf = (p) => upper(p.legacyErpId || p.itemId || '');
    const customer = customers.find(c => c.id === custId) || null;

    const allCollections = useMemo(() => Array.from(new Set(
        inventory.flatMap(p => collectionsOf(p.manufacturingSpecs))
    )).sort(), [inventory]);

    // The customer's existing row on an item. Matched the same way CPQ/Quick Ship match — by CRM id
    // OR by the customer's NAME, because rows have been hand-entered both ways over time.
    const custKeys = useMemo(() => new Set([custId, customer?.name, customer?.companyName]
        .filter(Boolean).map(s => upper(s))), [custId, customer]);
    const rowFor = (p) => (p.clientPricing || []).find(r => custKeys.has(upper(r?.customerId))) || null;

    const members = useMemo(() => {
        if (!coll) return [];
        return inventory.filter(p => collectionsOf(p.manufacturingSpecs).includes(upper(coll)));
    }, [inventory, coll]);

    // Legacy-struct suggestions for THIS customer, keyed by doc id. Built once per customer/library
    // change rather than per render — it resolves a base doc per variant to find the pattern code.
    const byCode = useMemo(() => { const m = new Map(); inventory.forEach(p => m.set(codeOf(p), p)); return m; }, [inventory]); // eslint-disable-line react-hooks/exhaustive-deps
    const legacySrc = useMemo(() => LEGACY_SOURCES.find(s => s.match.test(String(customer?.name || ''))) || null, [customer]);
    const suggestions = useMemo(() => {
        const m = new Map();
        if (!legacySrc || !coll) return m;
        const findByCode = (c) => byCode.get(upper(c)) || null;
        members.forEach(p => {
            if (rowFor(p)) return;                       // a real customer row always wins
            const s = legacySrc.read(p, findByCode);
            if (s && (s.clientSku || s.price !== '' || s.clientSalesPrice !== '')) m.set(p.id, s);
        });
        return m;
    }, [legacySrc, members, byCode, coll, custKeys]); // eslint-disable-line react-hooks/exhaustive-deps

    const rows = useMemo(() => {
        const term = upper(search);
        return members
            .map(p => {
                const row = rowFor(p);
                const e = edits[p.id] || {};
                const sug = !row ? (suggestions.get(p.id) || null) : null;
                // A suggested value FILLS the cell so the number is visible and editable, but the row
                // is flagged so the UI can show it as not-yet-saved and the counter can tell the two
                // apart. Touching a cell turns it into a normal edit.
                const pick = (k) => e[k] !== undefined ? e[k] : (row?.[k] ?? (sug ? sug[k] : '') ?? '');
                return {
                    p, row, sug,
                    code: codeOf(p),
                    name: p.itemName || '',
                    basePrice: e.basePrice !== undefined ? e.basePrice : (p.manufacturingSpecs?.basePrice ?? ''),
                    clientSku: pick('clientSku'),
                    price: pick('price'),
                    clientSalesPrice: pick('clientSalesPrice'),
                    dirty: !!edits[p.id],
                };
            })
            .filter(r => !term || r.code.includes(term) || upper(r.name).includes(term))
            .filter(r => onlyPriced === 'ALL' || (onlyPriced === 'PRICED' ? money(r.price) !== '' : money(r.price) === ''));
    }, [members, edits, search, onlyPriced, custKeys, suggestions]); // eslint-disable-line react-hooks/exhaustive-deps

    const pricedCount = members.filter(p => money(rowFor(p)?.price) !== '').length;
    const dirtyCount = Object.keys(edits).length;

    const setEdit = (docId, field, value) => setEdits(prev => ({ ...prev, [docId]: { ...(prev[docId] || {}), [field]: value } }));

    // ---- SAVE ------------------------------------------------------------------------------
    // One batch. The customer's row is REPLACED and every other customer's rows are carried
    // through untouched — the whole point of keying by customerId.
    const saveEdits = async () => {
        if (!custId) return alert('Pick a customer first.');
        const ids = Object.keys(edits);
        if (!ids.length) return;
        const baseChanges = ids.filter(id => edits[id].basePrice !== undefined);
        if (!window.confirm(`Save ${ids.length} item(s) for ${customer?.name || custId}?\n\n• Their SKU / net price / sales price write to this customer's Client Pricing row.${baseChanges.length ? `\n• ⚠ ${baseChanges.length} BASE price(s) change — that is our own price, for every customer.` : ''}\n\nCPQ, Quick Ship and the portal pick it up immediately.`)) return;
        setSaving(true);
        try {
            let batch = writeBatch(db), n = 0, written = 0;
            for (const id of ids) {
                const p = inventory.find(x => x.id === id);
                if (!p) continue;
                const e = edits[id];
                const cur = rowFor(p);
                const next = {
                    customerId: custId,
                    customerName: customer?.name || '',
                    clientSku: e.clientSku !== undefined ? String(e.clientSku).trim() : (cur?.clientSku ?? ''),
                    price: e.price !== undefined ? money(e.price) : (cur?.price ?? ''),
                    clientSalesPrice: e.clientSalesPrice !== undefined ? money(e.clientSalesPrice) : (cur?.clientSalesPrice ?? ''),
                    source: 'COLLECTION_PAGE', updatedAt: Date.now(), updatedBy: String(currentUser || ''),
                };
                const others = (p.clientPricing || []).filter(r => !custKeys.has(upper(r?.customerId)));
                // A row with nothing in it is removed rather than stored as an empty shell.
                const keep = (next.clientSku || next.price !== '' || next.clientSalesPrice !== '');
                const patch = { clientPricing: keep ? [...others, next] : others };
                if (e.basePrice !== undefined) patch['manufacturingSpecs.basePrice'] = money(e.basePrice);
                batch.update(doc(db, 'Approved_Designs', id), patch);
                written++;
                if (++n >= 400) { await batch.commit(); batch = writeBatch(db); n = 0; }
            }
            if (n) await batch.commit();
            setEdits({});
            alert(`✅ Saved ${written} item(s) for ${customer?.name || custId}.`);
        } catch (e) { console.error(e); alert('Save failed:\n\n' + (e.message || e)); }
        setSaving(false);
    };

    // ---- ADOPT THE SUGGESTIONS ----------------------------------------------------------------
    // Copies the legacy struct's values into real clientPricing rows for this customer, which is
    // what makes them count everywhere (CPQ / Quick Ship / portal all read clientPricing, not the
    // Fabricut box). Items that already have a customer row are never touched.
    const adoptSuggestions = async () => {
        const ids = [...suggestions.keys()];
        if (!ids.length) return;
        if (!window.confirm(`Write ${ids.length} ${legacySrc.label} value(s) into ${customer?.name}'s Client Pricing?\n\n• Their SKU = the Fabricut pattern #\n• Their Net = CE → Fabricut price\n• Their Sales = Fabricut wholesale (MSRP ÷ 2 where the sheet had none)\n\nOnly items with NO ${customer?.name} row yet are written. This is what makes the numbers count in CPQ, Quick Ship and the portal — until now they only lived in the pricing box.`)) return;
        setSaving(true);
        try {
            let batch = writeBatch(db), n = 0, written = 0;
            for (const id of ids) {
                const p = inventory.find(x => x.id === id);
                const s = suggestions.get(id);
                if (!p || !s) continue;
                const others = (p.clientPricing || []).filter(r => !custKeys.has(upper(r?.customerId)));
                batch.update(doc(db, 'Approved_Designs', id), {
                    clientPricing: [...others, {
                        customerId: custId, customerName: customer?.name || '',
                        clientSku: s.clientSku || '', price: s.price, clientSalesPrice: s.clientSalesPrice,
                        source: 'ADOPTED_' + (legacySrc.label || '').toUpperCase().replace(/[^A-Z]+/g, '_'),
                        updatedAt: Date.now(), updatedBy: String(currentUser || ''),
                    }],
                });
                written++;
                if (++n >= 400) { await batch.commit(); batch = writeBatch(db); n = 0; }
            }
            if (n) await batch.commit();
            alert(`✅ ${written} item(s) now carry a real ${customer?.name} price row.`);
        } catch (e) { console.error(e); alert('Adopt failed:\n\n' + (e.message || e)); }
        setSaving(false);
    };

    // ---- ADD AN ITEM TO THE COLLECTION -------------------------------------------------------
    // The H1-1D case: an item that belongs to the collection but was never tagged into it. Adding
    // writes manufacturingSpecs.collections (app-owned) — pricing is then entered on its row.
    const addCandidates = useMemo(() => {
        const term = upper(addSearch);
        if (!coll || term.length < 2) return [];
        return inventory.filter(p => !collectionsOf(p.manufacturingSpecs).includes(upper(coll)))
            .filter(p => codeOf(p).includes(term) || upper(p.itemName).includes(term))
            .slice(0, 12);
    }, [inventory, addSearch, coll]); // eslint-disable-line react-hooks/exhaustive-deps

    const addToCollection = async (p) => {
        const cur = Array.isArray(p.manufacturingSpecs?.collections) ? p.manufacturingSpecs.collections.map(c => upper(c)) : collectionsOf(p.manufacturingSpecs);
        if (cur.includes(upper(coll))) return;
        try {
            await setDoc(doc(db, 'Approved_Designs', p.id), { manufacturingSpecs: { collections: [...cur, upper(coll)] } }, { merge: true });
            setAddSearch('');
        } catch (e) { alert('Could not add it: ' + (e.message || e)); }
    };
    const removeFromCollection = async (p) => {
        if (!window.confirm(`Remove ${codeOf(p)} from ${coll}?\n\nIts pricing rows are kept — only the collection tag is removed.`)) return;
        const cur = collectionsOf(p.manufacturingSpecs).filter(c => c !== upper(coll));
        await setDoc(doc(db, 'Approved_Designs', p.id), { manufacturingSpecs: { collections: cur } }, { merge: true }).catch(e => alert('Failed: ' + e.message));
    };

    // ---- IMPORT A CONTROL FILE ---------------------------------------------------------------
    const onImportFile = async (file) => {
        if (!file || !custId) { if (!custId) alert('Pick the customer this control file belongs to first.'); return; }
        setBusy('Reading the workbook…');
        try {
            const { rows: parsed, sheetsRead } = await parseControlWorkbook(file);
            const collapsed = collapseBySku(parsed);
            const libByCode = new Map();
            inventory.forEach(p => {
                const r = rowFor(p);
                libByCode.set(codeOf(p), { id: p.id, code: codeOf(p), basePrice: p.manufacturingSpecs?.basePrice ?? '', row: r });
            });
            const entries = diffControlRows(collapsed, libByCode);
            setImp({ entries, summary: diffSummary(entries), fileName: file.name, sheetsRead, applyBase: false });
        } catch (e) { console.error(e); alert('Could not read that workbook:\n\n' + (e.message || e)); }
        setBusy('');
    };

    // Apply only NEW + CHANGED. Blank cells in the sheet were already dropped by the differ, so an
    // import can add and correct but never silently erase a price somebody typed here.
    const applyImport = async () => {
        const todo = imp.entries.filter(e => e.status === 'NEW' || e.status === 'CHANGED');
        if (!todo.length) return alert('Nothing to apply — every matched row already agrees with the library.');
        const baseCount = imp.applyBase ? todo.filter(e => e.baseChanged).length : 0;
        if (!window.confirm(`Apply ${todo.length} row(s) to ${customer?.name}?\n\n• ${imp.summary.NEW || 0} new pricing row(s)\n• ${imp.summary.CHANGED || 0} changed\n• ${imp.summary.SAME || 0} already correct (skipped)\n• ${imp.summary.UNMATCHED || 0} not in the library (skipped)${baseCount ? `\n• ⚠ ${baseCount} BASE price(s) — our own price, every customer` : '\n\nBase prices are NOT written (tick the box to include them).'}`)) return;
        setImp(prev => ({ ...prev, applying: true }));
        try {
            let batch = writeBatch(db), n = 0, written = 0;
            for (const e of todo) {
                const p = inventory.find(x => x.id === e.docId);
                if (!p) continue;
                const cur = rowFor(p);
                const next = {
                    customerId: custId, customerName: customer?.name || '',
                    clientSku: e.changes.clientSku !== undefined ? e.changes.clientSku : (cur?.clientSku ?? ''),
                    price: e.changes.price !== undefined ? e.changes.price : (cur?.price ?? ''),
                    clientSalesPrice: e.changes.clientSalesPrice !== undefined ? e.changes.clientSalesPrice : (cur?.clientSalesPrice ?? ''),
                    source: 'CONTROL_FILE', updatedAt: Date.now(), updatedBy: String(currentUser || ''),
                };
                const others = (p.clientPricing || []).filter(r => !custKeys.has(upper(r?.customerId)));
                const patch = { clientPricing: [...others, next] };
                if (imp.applyBase && e.baseChanged && e.newBase !== null) patch['manufacturingSpecs.basePrice'] = e.newBase;
                batch.update(doc(db, 'Approved_Designs', e.docId), patch);
                written++;
                if (++n >= 400) { await batch.commit(); batch = writeBatch(db); n = 0; }
            }
            if (n) await batch.commit();
            setImp(null);
            alert(`✅ ${written} item(s) updated for ${customer?.name}.\n\nCPQ, Quick Ship and the portal are live on it now.`);
        } catch (err) { console.error(err); alert('Apply failed:\n\n' + (err.message || err)); setImp(prev => ({ ...prev, applying: false })); }
    };

    // ---- styles ------------------------------------------------------------------------------
    const fld = { padding: '10px 12px', border: `1px solid ${theme.line}`, outline: 'none', fontFamily: theme.sans, fontSize: '0.9rem', background: '#fff' };
    const th = { padding: '8px 10px', textAlign: 'left', fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: theme.inkSoft, borderBottom: `2px solid ${theme.ink}`, whiteSpace: 'nowrap' };
    const td = { padding: '6px 10px', textAlign: 'left', fontFamily: theme.mono, fontSize: '11px', borderBottom: `1px solid ${theme.paper2}` };
    // A SUGGESTED cell reads in brass on a dashed edge — the value is real and editable, but it
    // is not a saved customer price until it's adopted or saved.
    const cellInput = (dirty, sug) => ({ width: '92px', padding: '5px 6px', textAlign: 'right', fontFamily: theme.mono, fontSize: '11px', outline: 'none', background: '#fff', color: (sug && !dirty) ? theme.brass : theme.ink, border: dirty ? `1px solid ${theme.brass}` : (sug ? `1px dashed ${theme.brass}` : `1px solid ${theme.line}`) });
    const btn = (on, extra = {}) => ({ padding: '10px 16px', background: on ? theme.ink : 'transparent', color: on ? '#fff' : theme.ink, border: `1px solid ${on ? theme.ink : theme.line}`, cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', ...extra });

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '30px', fontFamily: theme.sans, textAlign: 'left' }}>
            <div>
                <h2 style={{ margin: 0, fontFamily: theme.serif, fontSize: '1.9rem', color: theme.ink }}>Customer Collections</h2>
                <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft, marginTop: '4px' }}>
                    One customer × one collection · their item id, what they pay us, what they sell it for — live in CPQ, Quick Ship and the portal the moment you save.
                </div>
            </div>

            {/* PICKERS */}
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', background: theme.paper2, border: `1px solid ${theme.line}`, padding: '16px 18px' }}>
                <select value={custId} onChange={e => { setCustId(e.target.value); setEdits({}); setImp(null); }} style={{ ...fld, minWidth: '240px' }}>
                    <option value="">— pick a customer —</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select value={coll} onChange={e => { setColl(e.target.value); setEdits({}); }} style={{ ...fld, minWidth: '220px' }}>
                    <option value="">— pick a collection —</option>
                    {allCollections.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                {coll && (
                    <span style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>
                        {members.length} part{members.length === 1 ? '' : 's'} · <span style={{ color: pricedCount ? theme.green : theme.red }}>{pricedCount} priced</span>
                        {suggestions.size > 0 && <> · <span style={{ color: theme.brass }}>{suggestions.size} suggested</span></>}
                        {' · '}{members.length - pricedCount - suggestions.size} not yet
                    </span>
                )}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <input ref={fileRef} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={e => { onImportFile(e.target.files[0]); e.target.value = ''; }} />
                    <button onClick={() => fileRef.current?.click()} disabled={!custId || !!busy} title="Read a customer control file (.xlsx) and show what it would change — nothing is written until you apply it" style={btn(false)}>⬆ Import Control File</button>
                    {dirtyCount > 0 && (
                        <button onClick={saveEdits} disabled={saving} style={btn(true, { background: theme.green, borderColor: theme.green })}>{saving ? 'Saving…' : `💾 Save ${dirtyCount} change${dirtyCount === 1 ? '' : 's'}`}</button>
                    )}
                </div>
            </div>
            {busy && <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.brass }}>{busy}</div>}

            {!custId || !coll ? (
                <div style={{ padding: '48px', textAlign: 'center', fontFamily: theme.serif, fontStyle: 'italic', color: theme.inkSoft, fontSize: '1.1rem', border: `1px solid ${theme.line}`, background: '#fff' }}>
                    Pick a customer and a collection to begin.<br />
                    <span style={{ fontSize: '0.9rem' }}>Fabricut × FABRICUT H1 · Calico Corners × SIMPLE ELEGANCE — the same screen maintains both.</span>
                </div>
            ) : (
                <>
                    {/* SUGGESTIONS FROM A LEGACY STRUCT — visible, counted, adopted on purpose. */}
                    {suggestions.size > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', background: 'rgba(176,141,87,.10)', border: `1px solid ${theme.brass}`, padding: '14px 18px' }}>
                            <span style={{ fontSize: '0.9rem', color: theme.ink, flex: 1, minWidth: '360px' }}>
                                <b>{suggestions.size} part(s) already carry {customer?.name} numbers in the {legacySrc?.label}</b> — shown below in brass. They are <i>not</i> customer price rows yet, so CPQ, Quick Ship and the portal don't use them. Adopt them to make them real, or edit a cell first and save it yourself.
                            </span>
                            <button onClick={adoptSuggestions} disabled={saving} style={btn(true, { background: theme.brass, borderColor: theme.brass })}>{saving ? 'Writing…' : `⇄ Adopt ${suggestions.size} into Client Pricing`}</button>
                        </div>
                    )}

                    {/* FILTERS + ADD */}
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search item # or name…" style={{ ...fld, width: '260px' }} />
                        <div style={{ display: 'flex', border: `1px solid ${theme.line}` }}>
                            {[['ALL', 'All'], ['PRICED', 'Priced'], ['MISSING', 'Not priced']].map(([k, l]) => (
                                <button key={k} onClick={() => setOnlyPriced(k)} style={{ padding: '9px 14px', background: onlyPriced === k ? theme.ink : '#fff', color: onlyPriced === k ? '#fff' : theme.inkSoft, border: 'none', borderLeft: k === 'ALL' ? 'none' : `1px solid ${theme.line}`, cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase' }}>{l}</button>
                            ))}
                        </div>
                        <div style={{ marginLeft: 'auto', position: 'relative' }}>
                            <input value={addSearch} onChange={e => setAddSearch(e.target.value)} placeholder="＋ Add a part to this collection…" style={{ ...fld, width: '300px' }} />
                            {addCandidates.length > 0 && (
                                <div style={{ position: 'absolute', right: 0, top: '100%', zIndex: 20, width: '420px', background: '#fff', border: `1px solid ${theme.line}`, boxShadow: '0 6px 24px rgba(0,0,0,.12)', maxHeight: '320px', overflowY: 'auto' }}>
                                    {addCandidates.map(p => (
                                        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderBottom: `1px solid ${theme.paper2}` }}>
                                            <span style={{ fontFamily: theme.mono, fontSize: '11px', width: '150px' }}>{codeOf(p)}</span>
                                            <span style={{ flex: 1, fontSize: '0.82rem', color: theme.inkSoft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.itemName}</span>
                                            <button onClick={() => addToCollection(p)} style={{ ...btn(false), padding: '5px 10px' }}>Add</button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* GRID */}
                    <div style={{ border: `1px solid ${theme.line}`, background: '#fff', overflow: 'auto', maxHeight: '64vh' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead style={{ position: 'sticky', top: 0, background: theme.paper, zIndex: 5 }}>
                                <tr>
                                    <th style={th}>Item #</th>
                                    <th style={{ ...th, width: '38%' }}>Description</th>
                                    <th style={{ ...th, textAlign: 'right' }} title="OUR price — shared by every customer. Editing it here changes it everywhere.">Base $</th>
                                    <th style={{ ...th, color: theme.brass }} title="The customer's own item id — what they call this part">Their SKU</th>
                                    <th style={{ ...th, textAlign: 'right', color: theme.brass }} title="What this customer pays us. This is the price CPQ, Quick Ship and the portal use for them.">Their Net $</th>
                                    <th style={{ ...th, textAlign: 'right', color: theme.brass }} title="What they sell it for — shown to them in the portal">Their Sales $</th>
                                    <th style={th}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(r => (
                                    <tr key={r.p.id} style={{ background: r.dirty ? 'rgba(176,141,87,.07)' : '#fff' }}>
                                        <td style={{ ...td, whiteSpace: 'nowrap', fontWeight: 600 }}>{r.code}
                                            {r.sug && !r.dirty && <span title={`These numbers come from the ${legacySrc?.label} on the item — not a saved ${customer?.name} price row yet`} style={{ marginLeft: '8px', fontSize: '9px', color: theme.brass, fontWeight: 400 }}>SUGGESTED</span>}
                                        </td>
                                        <td style={{ ...td, fontFamily: theme.sans, fontSize: '0.85rem', color: theme.inkSoft }}>{r.name}</td>
                                        <td style={{ ...td, textAlign: 'right' }}>
                                            <input value={r.basePrice} onChange={e => setEdit(r.p.id, 'basePrice', e.target.value)} placeholder="—" style={{ ...cellInput(edits[r.p.id]?.basePrice !== undefined, false), width: '80px', color: theme.inkSoft }} />
                                        </td>
                                        <td style={td}>
                                            <input value={r.clientSku} onChange={e => setEdit(r.p.id, 'clientSku', e.target.value)} placeholder="—" style={{ ...cellInput(edits[r.p.id]?.clientSku !== undefined, !!r.sug), width: '130px', textAlign: 'left' }} />
                                        </td>
                                        <td style={{ ...td, textAlign: 'right' }}>
                                            <input value={r.price} onChange={e => setEdit(r.p.id, 'price', e.target.value)} placeholder="—" style={cellInput(edits[r.p.id]?.price !== undefined, !!r.sug)} />
                                        </td>
                                        <td style={{ ...td, textAlign: 'right' }}>
                                            <input value={r.clientSalesPrice} onChange={e => setEdit(r.p.id, 'clientSalesPrice', e.target.value)} placeholder="—" style={cellInput(edits[r.p.id]?.clientSalesPrice !== undefined, !!r.sug)} />
                                        </td>
                                        <td style={{ ...td, textAlign: 'right' }}>
                                            <button onClick={() => removeFromCollection(r.p)} title={`Remove from ${coll} (pricing rows are kept)`} style={{ background: 'none', border: 'none', color: theme.line, cursor: 'pointer', fontSize: '1rem' }}>×</button>
                                        </td>
                                    </tr>
                                ))}
                                {rows.length === 0 && (
                                    <tr><td colSpan="7" style={{ padding: '36px', textAlign: 'center', fontFamily: theme.serif, fontStyle: 'italic', color: theme.inkSoft }}>
                                        {members.length === 0 ? `No parts carry the ${coll} collection yet — add them with the search on the right.` : 'No parts match this filter.'}
                                    </td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft }}>
                        Their Net is the price this customer is charged — it is what CPQ, Quick Ship and the portal quote them. Leave it blank and they simply pay the base price.
                    </div>
                </>
            )}

            {/* IMPORT DIFF */}
            {imp && (
                <div onClick={() => !imp.applying && setImp(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,.72)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '28px' }}>
                    <div onClick={e => e.stopPropagation()} style={{ background: '#fff', width: '1100px', maxWidth: '96vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', border: `1px solid ${theme.line}` }}>
                        <div style={{ padding: '20px 26px', borderBottom: `1px solid ${theme.line}`, background: theme.paper2 }}>
                            <div style={{ fontFamily: theme.serif, fontSize: '1.4rem' }}>Control file — what it would change</div>
                            <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, marginTop: '4px' }}>
                                {imp.fileName} · {(imp.sheetsRead || []).join(' · ')} · {customer?.name}
                            </div>
                            <div style={{ display: 'flex', gap: '18px', marginTop: '12px', fontFamily: theme.mono, fontSize: '11px' }}>
                                <span style={{ color: theme.green }}>NEW {imp.summary.NEW || 0}</span>
                                <span style={{ color: theme.brass }}>CHANGED {imp.summary.CHANGED || 0}</span>
                                <span style={{ color: theme.inkSoft }}>SAME {imp.summary.SAME || 0}</span>
                                <span style={{ color: theme.red }}>NOT IN LIBRARY {imp.summary.UNMATCHED || 0}</span>
                            </div>
                        </div>
                        <div style={{ overflow: 'auto', flex: 1 }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead style={{ position: 'sticky', top: 0, background: theme.paper }}>
                                    <tr>
                                        <th style={th}>Item #</th><th style={th}>Status</th><th style={th}>Their SKU</th>
                                        <th style={{ ...th, textAlign: 'right' }}>Their Net $</th><th style={{ ...th, textAlign: 'right' }}>Their Sales $</th><th style={{ ...th, textAlign: 'right' }}>Base $</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {imp.entries.filter(e => e.status !== 'SAME').slice(0, 600).map((e, i) => {
                                        const col = e.status === 'NEW' ? theme.green : e.status === 'CHANGED' ? theme.brass : theme.red;
                                        const was = (k) => e.current?.[k];
                                        const cell = (k, v) => e.changes?.[k] === undefined ? <span style={{ color: theme.line }}>·</span>
                                            : <span>{was(k) !== undefined && was(k) !== '' && <span style={{ color: theme.inkSoft, textDecoration: 'line-through', marginRight: '6px' }}>{k === 'clientSku' ? was(k) : fmt(was(k))}</span>}<b style={{ color: col }}>{k === 'clientSku' ? v : fmt(v)}</b></span>;
                                        return (
                                            <tr key={e.sku + i}>
                                                <td style={{ ...td, whiteSpace: 'nowrap' }}>{e.sku}</td>
                                                <td style={{ ...td, color: col }}>{e.status === 'UNMATCHED' ? 'not in library' : e.status.toLowerCase()}</td>
                                                <td style={td}>{cell('clientSku', e.changes?.clientSku)}</td>
                                                <td style={{ ...td, textAlign: 'right' }}>{cell('price', e.changes?.price)}</td>
                                                <td style={{ ...td, textAlign: 'right' }}>{cell('clientSalesPrice', e.changes?.clientSalesPrice)}</td>
                                                <td style={{ ...td, textAlign: 'right', color: e.baseChanged ? theme.red : theme.line }} title={e.baseChanged ? 'Our own base price differs from the sheet — only written if you tick the box below' : ''}>{e.baseChanged ? fmt(e.newBase) : '·'}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        <div style={{ padding: '16px 26px', borderTop: `1px solid ${theme.line}`, display: 'flex', gap: '14px', alignItems: 'center', background: theme.paper }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: theme.ink, cursor: 'pointer' }}>
                                <input type="checkbox" checked={!!imp.applyBase} onChange={e => setImp(prev => ({ ...prev, applyBase: e.target.checked }))} />
                                Also write the sheet's Base $ ({imp.entries.filter(e => e.baseChanged).length}) — <i>our own price, for every customer</i>
                            </label>
                            <div style={{ marginLeft: 'auto', display: 'flex', gap: '12px' }}>
                                <button onClick={() => setImp(null)} disabled={imp.applying} style={btn(false)}>Cancel</button>
                                <button onClick={applyImport} disabled={imp.applying} style={btn(true, { background: theme.green, borderColor: theme.green })}>{imp.applying ? 'Applying…' : `Apply ${(imp.summary.NEW || 0) + (imp.summary.CHANGED || 0)} row(s) →`}</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CustomerCollectionsTab;
