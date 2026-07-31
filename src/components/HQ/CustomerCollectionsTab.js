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
import { collection, onSnapshot, query, where, doc, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { parseControlWorkbook, collapseBySku, diffControlRows, diffSummary, upper } from '../Shared/customerControlFile';
import { fabricutCodeOf, isPlatedSuffix } from '../Shared/priceLevels';
import { FEE_MODES, FEE_UNITS, feeRuleOf } from '../Shared/feeRules';

const theme = {
    paper: '#faf8f4', paper2: '#f2efe8', ink: '#1c1a16', inkSoft: '#524e46',
    // brassDark / blueDark are for TEXT: the brand brass and blue are chosen for borders and
    // fills and go muddy at label sizes on white (Stuart 2026-07-30: "darken the color font or
    // go bolder, it is too hard to read"). Borders and buttons keep the brand values.
    brass: '#b08d57', brassDark: '#7d6031', line: '#d9d4ca', green: '#3a7d44', red: '#d9534f',
    blue: '#3f7fc4', blueDark: '#2a5f9e',
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
const fabricutSuggestion = (part, findByCode, outsourceCodes) => {
    const fab = part?.manufacturingSpecs?.fabricut;
    if (!fab) return null;
    const code = upper(part.legacyErpId || part.itemId);
    // PREMIUM = an OUTSOURCED finish, not "a suffix starting with EP" (Stuart 2026-07-29) — /P25 is
    // plated too, and the EP test read it as an in-house paint and took the painted prices.
    const plated = isPlatedSuffix(code.includes('/') ? code.split('/')[1] : '', outsourceCodes);
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
        clientSku: fabricutCodeOf(part, findByCode, outsourceCodes) || '',
        price: cost === null || cost === undefined ? '' : cost,
        clientSalesPrice: ws === null || ws === undefined ? '' : ws,
        clientRetailPrice: retail === null || retail === undefined ? '' : retail,
        plated,
    };
};
const LEGACY_SOURCES = [
    { match: /fabricut/i, label: 'Fabricut pricing box', read: fabricutSuggestion },
];

// ---- WRITE-BACK: keep the legacy box in step with the rows (Stuart 2026-07-30) ---------------
// "i have not run the 4.6 on the fabricut because i see the 4.6 is populating different fields
// than the Fabricut." He was right to hold off. Two stores do two different jobs:
//   manufacturingSpecs.fabricut → the CPQ PRICE LEVELS (Standard / Cost / Wholesale / Retail)
//   clientPricing[]            → what the customer is actually CHARGED in CPQ / Quick Ship / portal
// For Fabricut they must agree, and a page that wrote only the rows would leave the levels stale.
// So an edit here writes both. Rules that keep it safe:
//   • NEVER creates a box — an item with no Fabricut data is not a Fabricut item, and inventing
//     one would put it into the price levels.
//   • A VARIANT writes its OWN direct cost/wholesale/retail even when it was inheriting a tier,
//     so one row's edit can never move its siblings.
//   • A suffixless doc (mill base, or a fee like CE-FEE-4594) writes the tier its row shows.
//   • Pattern #s and the explicit-null "$0 · w/ arm" flags are never touched — those are grouping
//     decisions, not prices.
const fabricutWriteBack = (part, next, outsourceCodes) => {
    const fab = part?.manufacturingSpecs?.fabricut;
    if (!fab) return null;
    const code = upper(part.legacyErpId || part.itemId);
    const sfx = code.includes('/') ? code.split('/')[1] : '';
    const hasDirect = fab.cost !== undefined || fab.retail !== undefined || fab.wholesale !== undefined;
    const keys = (sfx || hasDirect)
        ? { cost: 'cost', wholesale: 'wholesale', retail: 'retail' }
        : (isPlatedSuffix(sfx, outsourceCodes)
            ? { cost: 'platedCost', wholesale: 'platedWholesale', retail: 'platedRetail' }
            : { cost: 'paintedCost', wholesale: 'paintedWholesale', retail: 'paintedRetail' });
    const out = {};
    const put = (field, v) => { if (v !== '' && v !== null && v !== undefined) out[`manufacturingSpecs.fabricut.${field}`] = v; };
    put(keys.cost, next.price);
    put(keys.wholesale, next.clientSalesPrice);
    put(keys.retail, next.clientRetailPrice);
    if (!Object.keys(out).length) return null;
    out['manufacturingSpecs.fabricut.updatedAt'] = Date.now();
    out['manufacturingSpecs.fabricut.source'] = 'COLLECTION_PAGE';
    return out;
};

// FEE ITEMS — the same test the Master Library's "Fees only" filter uses, so a record that reads
// as a fee there reads as one here. Covers NetSuite-synced fees (CE-FEE-…), app records typed FEE,
// and the H1-… alias records that carry partClass Fee.
const isFeeItem = (p) => {
    const pt = upper(p?.manufacturingSpecs?.productType || p?.productType);
    return pt === 'FEE' || p?.partClass === 'Fee' || /(^|-)FEE-/.test(upper(p?.legacyErpId || p?.itemId));
};

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
    // FEES mode lists the brand's fee catalogue instead of a collection's parts. Fees are brand-wide,
    // not collection-scoped — a rush or shipping fee applies to any order — and they are almost never
    // tagged into a collection, which is exactly why they were invisible here (Stuart 2026-07-30).
    const [mode, setMode] = useState('COLLECTION');        // COLLECTION | FEES
    const [edits, setEdits] = useState({});                 // docId → { clientSku, price, clientSalesPrice, basePrice }
    const [saving, setSaving] = useState(false);
    const [addSearch, setAddSearch] = useState('');
    const [imp, setImp] = useState(null);                   // { entries, summary, fileName, applying }
    const [busy, setBusy] = useState('');
    const [outsourceFinishes, setOutsourceFinishes] = useState([]);  // hq_outsource_finishes — the PREMIUM authority
    const [newFee, setNewFee] = useState(null);            // ＋ New fee form (FEES mode)
    // ⚙ TIERS — the per-row Customer Alias & Pricing editor. The grid's single Net/Sales/Retail is
    // ONE tier; the box on the item carries PAINTED and PLATED side by side plus the pattern #s,
    // and that is what the CPQ price levels read (Stuart 2026-07-30: "it does not allow us to
    // update this properly as it does not have fields for the plated/premium items").
    const [tierRow, setTierRow] = useState(null);          // docId of the open editor
    const [tierEdit, setTierEdit] = useState({});          // field → value while open
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
        const unsubFin = onSnapshot(collection(db, 'hq_outsource_finishes'), snap =>
            setOutsourceFinishes(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(f => f.code || f.name)));
        return () => { unsubItems(); unsubCust(); unsubFin(); };
    }, [activeBrand]);

    // 'PENDING' is the app's placeholder for a record with no ERP id yet — the Master Library falls
    // back to itemId there (codeOfPart), so this must too or the same record reads "PENDING" here
    // and "CE-FEE-4594" there (Stuart 2026-07-30).
    // What the Customer Alias & Pricing box actually holds, in one line — so a premium/plated price
    // is VISIBLE on the row instead of hidden behind a button (Stuart 2026-07-31: "4.6 still is not
    // showing a way to handle the fees for the premium finishes, it still does not align with all
    // the fields in the customer alias"). A fee with a painted AND a plated price now reads as one.
    const tierSummaryOf = (p) => {
        const f = p?.manufacturingSpecs?.fabricut;
        if (!f) return null;
        const n = (v) => (v === null ? '$0' : (v === undefined || v === '' ? '—' : String(v)));
        const trio = (a, b, c) => [n(f[a]), n(f[b]), n(f[c])].join(' · ');
        const has = (a, b, c) => [a, b, c].some(k => f[k] !== undefined);
        const out = [];
        if (has('paintedCost', 'paintedWholesale', 'paintedRetail')) out.push(`PAINTED ${trio('paintedCost', 'paintedWholesale', 'paintedRetail')}`);
        if (has('platedCost', 'platedWholesale', 'platedRetail')) out.push(`PLATED ${trio('platedCost', 'platedWholesale', 'platedRetail')}`);
        if (has('cost', 'wholesale', 'retail')) out.push(`OWN ${trio('cost', 'wholesale', 'retail')}`);
        const codes = [f.fabCodePainted, f.fabCodePremium, f.fabCodeBase].filter(Boolean);
        if (codes.length) out.push(`# ${[...new Set(codes)].join(' / ')}`);
        return out.length ? out.join('   ') : null;
    };

    const codeOf = (p) => upper((p.legacyErpId && p.legacyErpId !== 'PENDING' ? p.legacyErpId : p.itemId) || p.id || '');
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
        if (mode === 'FEES') return inventory.filter(isFeeItem);
        if (!coll) return [];
        return inventory.filter(p => collectionsOf(p.manufacturingSpecs).includes(upper(coll)));
    }, [inventory, coll, mode]);

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
            const s = legacySrc.read(p, findByCode, outsourceFinishes);
            if (s && (s.clientSku || s.price !== '' || s.clientSalesPrice !== '' || s.clientRetailPrice !== '')) m.set(p.id, s);
        });
        return m;
    }, [legacySrc, members, byCode, coll, custKeys, outsourceFinishes]); // eslint-disable-line react-hooks/exhaustive-deps

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
                const rule = feeRuleOf(p.manufacturingSpecs);
                const rv = (k, v) => e[k] !== undefined ? e[k] : v;
                return {
                    p, row, sug, rule,
                    feeMode: rv('feeMode', rule.mode),
                    feeUnit: rv('feeUnit', rule.unit),
                    feePercent: rv('feePercent', rule.percent ?? ''),
                    feeMin: rv('feeMin', rule.minAmount ?? ''),
                    feePortal: rv('feePortal', rule.portalSelectable),
                    plated: isPlatedSuffix(codeOf(p).includes('/') ? codeOf(p).split('/')[1] : '', outsourceFinishes),
                    code: codeOf(p),
                    name: p.itemName || '',
                    basePrice: e.basePrice !== undefined ? e.basePrice : (p.manufacturingSpecs?.basePrice ?? ''),
                    clientSku: pick('clientSku'),
                    price: pick('price'),
                    clientSalesPrice: pick('clientSalesPrice'),
                    clientRetailPrice: pick('clientRetailPrice'),
                    dirty: !!edits[p.id],
                };
            })
            .filter(r => !term || r.code.includes(term) || upper(r.name).includes(term))
            .filter(r => onlyPriced === 'ALL' || (onlyPriced === 'PRICED' ? money(r.price) !== '' : money(r.price) === ''));
    }, [members, edits, search, onlyPriced, custKeys, suggestions, outsourceFinishes]); // eslint-disable-line react-hooks/exhaustive-deps

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
        const boxCount = legacySrc ? ids.filter(id => inventory.find(x => x.id === id)?.manufacturingSpecs?.fabricut).length : 0;
        if (!window.confirm(`Save ${ids.length} item(s) for ${customer?.name || custId}?\n\n• Their SKU / net price / sales price write to this customer's Client Pricing row.${boxCount ? `\n• ${boxCount} also update the ${legacySrc.label} on the item, so the CPQ price levels stay in step (pattern #s and the "$0 · w/ arm" flags are untouched).` : ''}${baseChanges.length ? `\n• ⚠ ${baseChanges.length} BASE price(s) change — that is our own price, for every customer.` : ''}\n\nCPQ, Quick Ship and the portal pick it up immediately.`)) return;
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
                    clientRetailPrice: e.clientRetailPrice !== undefined ? money(e.clientRetailPrice) : (cur?.clientRetailPrice ?? ''),
                    source: 'COLLECTION_PAGE', updatedAt: Date.now(), updatedBy: String(currentUser || ''),
                };
                const others = (p.clientPricing || []).filter(r => !custKeys.has(upper(r?.customerId)));
                // A row with nothing in it is removed rather than stored as an empty shell.
                const keep = (next.clientSku || next.price !== '' || next.clientSalesPrice !== '' || next.clientRetailPrice !== '');
                const patch = { clientPricing: keep ? [...others, next] : others };
                if (e.basePrice !== undefined) patch['manufacturingSpecs.basePrice'] = money(e.basePrice);
                // Fee RULE — how the amount is worked out. The PRICE stays where every price lives
                // (base / clientPricing / the Fabricut box); only the shape is stored here.
                if (e.feeMode !== undefined) patch['manufacturingSpecs.feeRule.mode'] = e.feeMode;
                if (e.feeUnit !== undefined) patch['manufacturingSpecs.feeRule.unit'] = e.feeUnit;
                if (e.feePercent !== undefined) patch['manufacturingSpecs.feeRule.percent'] = money(e.feePercent);
                if (e.feeMin !== undefined) patch['manufacturingSpecs.feeRule.minAmount'] = money(e.feeMin);
                if (e.feePortal !== undefined) patch['manufacturingSpecs.feeRule.portalSelectable'] = !!e.feePortal;
                // Keep the legacy box in step — Fabricut's price levels read it, not the rows.
                if (legacySrc) Object.assign(patch, fabricutWriteBack(p, next, outsourceFinishes) || {});
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
                        clientSku: s.clientSku || '', price: s.price, clientSalesPrice: s.clientSalesPrice, clientRetailPrice: s.clientRetailPrice ?? '',
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

    // ---- ⚙ TIER EDITOR -------------------------------------------------------------------------
    const TIER_FIELDS = [
        { key: 'paintedCost', label: 'Cost', group: 'Painted tier (/P)' },
        { key: 'paintedWholesale', label: 'Wholesale', group: 'Painted tier (/P)' },
        { key: 'paintedRetail', label: 'Retail (MSRP)', group: 'Painted tier (/P)' },
        { key: 'platedCost', label: 'Cost', group: 'Plated / premium tier (/EP, /P25)' },
        { key: 'platedWholesale', label: 'Wholesale', group: 'Plated / premium tier (/EP, /P25)' },
        { key: 'platedRetail', label: 'Retail (MSRP)', group: 'Plated / premium tier (/EP, /P25)' },
        { key: 'cost', label: 'Cost', group: 'This item’s own price (variants, single-finish)' },
        { key: 'wholesale', label: 'Wholesale', group: 'This item’s own price (variants, single-finish)' },
        { key: 'retail', label: 'Retail (MSRP)', group: 'This item’s own price (variants, single-finish)' },
    ];
    const CODE_FIELDS = [
        { key: 'fabCodePainted', label: 'Their part # — painted' },
        { key: 'fabCodePremium', label: 'Their part # — premium / plated' },
        { key: 'fabCodeBase', label: 'Their part # — base' },
    ];
    const openTiers = (p) => {
        const fab = p.manufacturingSpecs?.fabricut || {};
        const seed = {};
        [...TIER_FIELDS, ...CODE_FIELDS].forEach(f => { seed[f.key] = fab[f.key] === undefined || fab[f.key] === null ? '' : fab[f.key]; });
        setTierEdit(seed); setTierRow(p.id);
    };
    const saveTiers = async () => {
        const p = inventory.find(x => x.id === tierRow);
        if (!p) return;
        const patch = {};
        TIER_FIELDS.forEach(f => { const v = tierEdit[f.key]; patch[`manufacturingSpecs.fabricut.${f.key}`] = v === '' ? null : money(v); });
        CODE_FIELDS.forEach(f => { patch[`manufacturingSpecs.fabricut.${f.key}`] = String(tierEdit[f.key] || '').trim(); });
        patch['manufacturingSpecs.fabricut.source'] = 'COLLECTION_PAGE';
        patch['manufacturingSpecs.fabricut.updatedAt'] = Date.now();
        try {
            await setDoc(doc(db, 'Approved_Designs', p.id), { manufacturingSpecs: { fabricut: {} } }, { merge: true }); // ensure the map exists
            await updateDoc(doc(db, 'Approved_Designs', p.id), patch);
            setTierRow(null); setTierEdit({});
        } catch (e) { console.error(e); alert('Save failed:\n\n' + (e.message || e)); }
    };

    // ---- CREATE A FEE (Stuart 2026-07-30) ------------------------------------------------------
    // "i want to set up these fees myself not import, i just need the tools built for it… a tool to
    // create fees like this and add to the 4.6 when fabricut is selected and H1, and then associate
    // back." So: make the fee ITEM and the customer's association in one action, here, with the
    // rule set at the same time. The customer's own code goes on the clientPricing row's clientSku,
    // which is the association — the same field the grid edits and CPQ/portal already read.
    const createFee = async () => {
        const f = newFee || {};
        const code = upper(f.code);
        if (!code) return alert('Give the fee an item # — ours, not the customer’s (e.g. CE-FEE-6294).');
        if (!String(f.name || '').trim()) return alert('Give the fee a description.');
        if (inventory.some(p => codeOf(p) === code)) return alert(`"${code}" already exists in the library. Find it in the list and add ${customer?.name || 'the customer'}'s part # to it instead — that is the association.`);
        const rule = {
            mode: f.feeMode === 'PERCENT' ? 'PERCENT' : 'FLAT',
            unit: f.feeUnit || 'EACH',
            percent: money(f.feePercent), minAmount: money(f.feeMin),
            portalSelectable: !!f.feePortal,
        };
        const row = (f.theirSku || f.theirNet !== '' || f.theirSales !== '') ? [{
            customerId: custId, customerName: customer?.name || '',
            clientSku: String(f.theirSku || '').trim(), price: money(f.theirNet), clientSalesPrice: money(f.theirSales),
            source: 'COLLECTION_PAGE', updatedAt: Date.now(), updatedBy: String(currentUser || ''),
        }] : [];
        const id = `FEE-${code.replace(/[^A-Za-z0-9-]/g, '_')}-${Date.now().toString().slice(-6)}`;
        try {
            await setDoc(doc(db, 'Approved_Designs', id), {
                id, itemId: code, legacyErpId: code, itemName: String(f.name).trim(),
                brandId: activeBrand, sharedBrands: [activeBrand],
                partClass: 'Fee', productType: 'FEE', routingType: '',
                clientPricing: row,
                manufacturingSpecs: {
                    productType: 'FEE',
                    basePrice: money(f.basePrice),
                    feeRule: rule,
                    ...(coll ? { collections: [upper(coll)] } : {}),
                    status: 'APP_ONLY', createdAt: Date.now(), createdBy: String(currentUser || ''),
                },
            });
            setNewFee(null);
            alert(`✅ ${code} created${coll ? ` and tagged into ${coll}` : ''}${row.length ? `, with ${customer?.name}'s part # and pricing` : ''}.\n\nIt has NO NetSuite item yet — 11.1's write-back will link or create it. Set its Part Handling in the Master Library so the shop/finishing routing is right.`);
        } catch (e) { console.error(e); alert('Could not create it:\n\n' + (e.message || e)); }
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

    // SEARCHING FOR SOMETHING THAT ISN'T IN THE COLLECTION YET (Stuart 2026-07-30: typed
    // CE-FEE-4594 and got "No parts match"). FEES are the case that bites — a French/Miter return
    // fee is commercially part of Fabricut H1, but fees are almost never tagged into a collection,
    // so the grid can't see them and neither can 4.5's collection filter. Rather than a dead end,
    // the search falls back to the whole library and offers to add what it found.
    const searchMisses = useMemo(() => {
        const term = upper(search);
        if (!coll || term.length < 2 || rows.length) return [];
        return inventory.filter(p => !collectionsOf(p.manufacturingSpecs).includes(upper(coll)))
            .filter(p => codeOf(p).includes(term) || upper(p.itemName).includes(term))
            .slice(0, 12);
    }, [inventory, search, coll, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps

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
                    clientRetailPrice: cur?.clientRetailPrice ?? '',
                    source: 'CONTROL_FILE', updatedAt: Date.now(), updatedBy: String(currentUser || ''),
                };
                const others = (p.clientPricing || []).filter(r => !custKeys.has(upper(r?.customerId)));
                const patch = { clientPricing: [...others, next] };
                if (imp.applyBase && e.baseChanged && e.newBase !== null) patch['manufacturingSpecs.basePrice'] = e.newBase;
                if (legacySrc) Object.assign(patch, fabricutWriteBack(p, next, outsourceFinishes) || {});
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
    const fld = { padding: '10px 12px', border: `1px solid ${theme.line}`, outline: 'none', fontFamily: theme.sans, fontSize: '0.9rem', background: '#fff', boxSizing: 'border-box' };
    const lbl = { display: 'block', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', color: theme.inkSoft, marginBottom: '6px' };
    const th = { padding: '8px 10px', textAlign: 'left', fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: theme.inkSoft, borderBottom: `2px solid ${theme.ink}`, whiteSpace: 'nowrap' };
    const td = { padding: '7px 10px', textAlign: 'left', fontFamily: theme.mono, fontSize: '12px', color: theme.ink, borderBottom: `1px solid ${theme.paper2}` };
    // A SUGGESTED cell reads in brass on a dashed edge — the value is real and editable, but it
    // is not a saved customer price until it's adopted or saved.
    const cellInput = (dirty, sug) => ({ width: '92px', padding: '6px 7px', textAlign: 'right', fontFamily: theme.mono, fontSize: '12px', fontWeight: 600, outline: 'none', background: '#fff', color: (sug && !dirty) ? theme.brassDark : theme.ink, border: dirty ? `1px solid ${theme.brass}` : (sug ? `1px dashed ${theme.brass}` : `1px solid ${theme.line}`) });
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
                <div style={{ display: 'flex', border: `1px solid ${theme.line}` }}>
                    {[['COLLECTION', 'Collection'], ['FEES', '💲 Fees & Add-ons']].map(([k, l]) => (
                        <button key={k} onClick={() => { setMode(k); setEdits({}); setSearch(''); }} title={k === 'FEES' ? 'The brand\'s fee catalogue — rush, packaging, shipping, returns, colour upcharges. Fees are not collection-scoped, so they all show here.' : 'Parts carrying the chosen collection'} style={{ padding: '11px 15px', background: mode === k ? theme.ink : '#fff', color: mode === k ? '#fff' : theme.inkSoft, border: 'none', borderLeft: k === 'COLLECTION' ? 'none' : `1px solid ${theme.line}`, cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' }}>{l}</button>
                    ))}
                </div>
                <select value={coll} onChange={e => { setColl(e.target.value); setEdits({}); }} title={mode === 'FEES' ? 'In Fees mode this does not filter the list (fees are brand-wide) — it is the collection a NEW fee gets tagged into.' : 'Parts carrying this collection'} style={{ ...fld, minWidth: '220px' }}>
                    <option value="">{mode === 'FEES' ? '— tag new fees into… (optional) —' : '— pick a collection —'}</option>
                    {allCollections.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                {(coll || mode === 'FEES') && (
                    <span style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>
                        {members.length} {mode === 'FEES' ? 'fee' : 'part'}{members.length === 1 ? '' : 's'} · <span style={{ color: pricedCount ? theme.green : theme.red }}>{pricedCount} priced</span>
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

            {!custId || (mode === 'COLLECTION' && !coll) ? (
                <div style={{ padding: '48px', textAlign: 'center', fontFamily: theme.serif, fontStyle: 'italic', color: theme.inkSoft, fontSize: '1.1rem', border: `1px solid ${theme.line}`, background: '#fff' }}>
                    {custId ? 'Pick a collection to begin.' : 'Pick a customer to begin.'}<br />
                    <span style={{ fontSize: '0.9rem' }}>Fabricut × FABRICUT H1 · Calico Corners × SIMPLE ELEGANCE — the same screen maintains both. 💲 Fees &amp; Add-ons needs only the customer.</span>
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

                    {mode === 'FEES' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', background: theme.paper2, border: `1px solid ${theme.line}`, padding: '14px 18px' }}>
                            <button onClick={() => setNewFee({ code: '', name: '', basePrice: '', feeMode: 'FLAT', feeUnit: 'EACH', feePercent: '', feeMin: '', feePortal: false, theirSku: '', theirNet: '', theirSales: '' })} style={btn(true, { background: theme.green, borderColor: theme.green })}>＋ New fee</button>
                            <span style={{ fontSize: '0.88rem', color: theme.ink, flex: 1, minWidth: '420px' }}>
                                Already have the fee? Don't make another — find it below and put <b>{customer?.name || 'the customer'}'s part #</b> in <b>Their SKU</b>. That row <i>is</i> the association.
                                <span style={{ display: 'block', color: theme.inkSoft, marginTop: '4px' }}>
                                    ⚠ The <b>cover-plate upcharge is already handled</b> — CPQ charges the difference when a coverplate is chosen over the standard backplate, priced on the CP/RCP plate items themselves. Don't create a fee for it. To give it {customer?.name || 'the customer'}'s code, switch to <b>Collection</b> mode and put the code on those plate items.
                                </span>
                            </span>
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
                                    <th style={{ ...th, textAlign: 'right', color: theme.brass }} title="What they sell it for — their street/wholesale price">Their Sales $</th>
                                    <th style={{ ...th, textAlign: 'right', color: theme.brass }} title="Their list price / MSRP — the third Fabricut tier, kept alongside net and sales">Their Retail $</th>
                                    {mode === 'FEES' && <>
                                        <th style={{ ...th, borderLeft: `2px solid ${theme.ink}` }} title="Flat = the price is per unit, multiplied by the quantity. Percentage = worked out from the configuration subtotal (parts + labour, before other fees and shipping).">How it's charged</th>
                                        <th style={th} title="What the quantity counts — returns, feet, bends, strike-offs…">Unit</th>
                                        <th style={{ ...th, textAlign: 'right' }} title="Percentage of the configuration subtotal (percentage fees only)">%</th>
                                        <th style={{ ...th, textAlign: 'right' }} title="Floor. “10% or $100 minimum” = 10 in the % column, 100 here — the minimum wins whenever the percentage falls short.">Min $</th>
                                        <th style={{ ...th, textAlign: 'center' }} title="Ticked = the customer can pick this themselves in the portal. Left off, it is internal-only and staff add it on their behalf.">Portal</th>
                                    </>}
                                    <th style={{ ...th, textAlign: 'right' }} title="Customer Alias & Pricing — the painted and plated tiers plus their part #s, the same fields as the Master Library window. This is what the CPQ price levels read.">Painted / Plated</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.flatMap(r => [(
                                    <tr key={r.p.id} style={{ background: r.dirty ? 'rgba(176,141,87,.07)' : '#fff' }}>
                                        <td style={{ ...td, whiteSpace: 'nowrap', fontWeight: 600 }}>{r.code}
                                            {r.sug && !r.dirty && <span title={`These numbers come from the ${legacySrc?.label} on the item — not a saved ${customer?.name} price row yet`} style={{ marginLeft: '8px', fontSize: '10px', color: theme.brassDark, fontWeight: 600 }}>SUGGESTED</span>}
                                            {r.plated && <span title="Outsourced (plated) finish — priced off the PREMIUM tier. /P25 counts as premium too, not just /EP*." style={{ marginLeft: '8px', fontSize: '10px', color: theme.blueDark, fontWeight: 600 }}>PREMIUM</span>}
                                        </td>
                                        <td style={{ ...td, fontFamily: theme.sans, fontSize: '0.88rem', color: theme.inkSoft }}>
                                            {r.name}
                                            {(() => { const ts = tierSummaryOf(r.p); return ts ? <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.brassDark, marginTop: '3px', letterSpacing: '.02em' }}>{ts}</div> : null; })()}
                                        </td>
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
                                            <input value={r.clientRetailPrice} onChange={e => setEdit(r.p.id, 'clientRetailPrice', e.target.value)} placeholder="—" style={cellInput(edits[r.p.id]?.clientRetailPrice !== undefined, !!r.sug)} />
                                        </td>
                                        {mode === 'FEES' && <>
                                            <td style={{ ...td, borderLeft: `2px solid ${theme.ink}` }}>
                                                <select value={r.feeMode} onChange={e => setEdit(r.p.id, 'feeMode', e.target.value)} style={{ ...cellInput(edits[r.p.id]?.feeMode !== undefined), width: '150px', textAlign: 'left' }}>
                                                    {FEE_MODES.map(m => <option key={m.id} value={m.id} title={m.hint}>{m.label}</option>)}
                                                </select>
                                            </td>
                                            <td style={td}>
                                                <select value={r.feeUnit} disabled={r.feeMode === 'PERCENT'} onChange={e => setEdit(r.p.id, 'feeUnit', e.target.value)} style={{ ...cellInput(edits[r.p.id]?.feeUnit !== undefined), width: '120px', textAlign: 'left', background: r.feeMode === 'PERCENT' ? theme.paper2 : '#fff' }}>
                                                    {FEE_UNITS.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
                                                </select>
                                            </td>
                                            <td style={{ ...td, textAlign: 'right' }}>
                                                <input value={r.feePercent} disabled={r.feeMode !== 'PERCENT'} onChange={e => setEdit(r.p.id, 'feePercent', e.target.value)} placeholder={r.feeMode === 'PERCENT' ? '25' : '—'} style={{ ...cellInput(edits[r.p.id]?.feePercent !== undefined), width: '62px', background: r.feeMode !== 'PERCENT' ? theme.paper2 : '#fff' }} />
                                            </td>
                                            <td style={{ ...td, textAlign: 'right' }}>
                                                <input value={r.feeMin} onChange={e => setEdit(r.p.id, 'feeMin', e.target.value)} placeholder="—" style={{ ...cellInput(edits[r.p.id]?.feeMin !== undefined), width: '72px' }} />
                                            </td>
                                            <td style={{ ...td, textAlign: 'center' }}>
                                                <input type="checkbox" checked={!!r.feePortal} onChange={e => setEdit(r.p.id, 'feePortal', e.target.checked)} style={{ cursor: 'pointer', width: '15px', height: '15px' }} />
                                            </td>
                                        </>}
                                        <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                            <button onClick={() => (tierRow === r.p.id ? setTierRow(null) : openTiers(r.p))} title="Customer Alias & Pricing — painted and plated tiers plus their part #s. This is what the CPQ price levels read." style={{ background: r.p.manufacturingSpecs?.fabricut ? theme.brass : 'none', border: `1px solid ${r.p.manufacturingSpecs?.fabricut ? theme.brass : theme.line}`, color: r.p.manufacturingSpecs?.fabricut ? '#fff' : theme.inkSoft, cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', padding: '5px 9px', marginRight: '6px', whiteSpace: 'nowrap' }}>{tierRow === r.p.id ? '⚙ Close' : (r.p.manufacturingSpecs?.fabricut ? '⚙ P / EP' : '＋ P / EP')}</button>
                                            {mode === 'COLLECTION' && <button onClick={() => removeFromCollection(r.p)} title={`Remove from ${coll} (pricing rows are kept)`} style={{ background: 'none', border: 'none', color: theme.line, cursor: 'pointer', fontSize: '1rem' }}>×</button>}
                                        </td>
                                    </tr>
                                ), tierRow === r.p.id ? (
                                    <tr key={r.p.id + '-tiers'}>
                                        <td colSpan={mode === 'FEES' ? 13 : 8} style={{ padding: '18px 22px', background: 'rgba(176,141,87,.07)', borderBottom: `1px solid ${theme.line}` }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
                                                <span style={{ fontFamily: theme.serif, fontSize: '1.15rem', color: theme.ink }}>Customer Alias &amp; Pricing — {r.code}</span>
                                                <span style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft }}>drives the CPQ price levels · blank = no price at that tier</span>
                                            </div>
                                            {['Painted tier (/P)', 'Plated / premium tier (/EP, /P25)', 'This item’s own price (variants, single-finish)'].map(group => (
                                                <div key={group} style={{ display: 'flex', alignItems: 'flex-end', gap: '14px', marginBottom: '10px', flexWrap: 'wrap' }}>
                                                    <span style={{ width: '250px', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.06em', color: theme.inkSoft }}>{group}</span>
                                                    {TIER_FIELDS.filter(f => f.group === group).map(f => (
                                                        <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                            <span style={{ fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', color: theme.inkSoft }}>{f.label}</span>
                                                            <input value={tierEdit[f.key] ?? ''} onChange={e => setTierEdit(prev => ({ ...prev, [f.key]: e.target.value }))} placeholder="—" style={{ width: '96px', padding: '6px 7px', textAlign: 'right', fontFamily: theme.mono, fontSize: '12px', fontWeight: 600, border: `1px solid ${theme.line}`, outline: 'none' }} />
                                                        </label>
                                                    ))}
                                                </div>
                                            ))}
                                            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '14px', marginTop: '14px', paddingTop: '14px', borderTop: `1px solid ${theme.line}`, flexWrap: 'wrap' }}>
                                                <span style={{ width: '250px', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.06em', color: theme.inkSoft }}>Their part #s</span>
                                                {CODE_FIELDS.map(f => (
                                                    <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                        <span style={{ fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', color: theme.inkSoft }}>{f.label}</span>
                                                        <input value={tierEdit[f.key] ?? ''} onChange={e => setTierEdit(prev => ({ ...prev, [f.key]: e.target.value }))} placeholder="—" style={{ width: '170px', padding: '6px 7px', fontFamily: theme.mono, fontSize: '12px', border: `1px solid ${theme.line}`, outline: 'none' }} />
                                                    </label>
                                                ))}
                                                <span style={{ marginLeft: 'auto', display: 'flex', gap: '10px' }}>
                                                    <button onClick={() => { setTierRow(null); setTierEdit({}); }} style={btn(false)}>Cancel</button>
                                                    <button onClick={saveTiers} style={btn(true, { background: theme.green, borderColor: theme.green })}>Save tiers</button>
                                                </span>
                                            </div>
                                            <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, marginTop: '12px', lineHeight: 1.6 }}>
                                                A BASE (mill) item carries the painted and plated tiers — its variants inherit them. A VARIANT or single-finish item carries its own price on the third row. Pattern #s live on the base item; a variant resolves to the premium code when its finish is outsourced (/EP* and /P25).
                                            </div>
                                        </td>
                                    </tr>
                                ) : null])}
                                {rows.length === 0 && (
                                    <tr><td colSpan={mode === 'FEES' ? 13 : 8} style={{ padding: '28px 36px', textAlign: 'center', fontFamily: theme.serif, fontStyle: 'italic', color: theme.inkSoft }}>
                                        {members.length === 0 ? `No parts carry the ${coll} collection yet — add them with the search on the right.` : 'No parts match this filter.'}
                                        {searchMisses.length > 0 && (
                                            <div style={{ marginTop: '18px', fontStyle: 'normal', fontFamily: theme.sans }}>
                                                <div style={{ fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: theme.brassDark, marginBottom: '10px' }}>
                                                    {searchMisses.length} match{searchMisses.length === 1 ? '' : 'es'} in the library that {searchMisses.length === 1 ? 'is' : 'are'} not in {coll} yet
                                                </div>
                                                <div style={{ display: 'inline-block', textAlign: 'left', border: `1px solid ${theme.line}`, minWidth: '460px' }}>
                                                    {searchMisses.map(p => (
                                                        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 12px', borderBottom: `1px solid ${theme.paper2}`, background: '#fff' }}>
                                                            <span style={{ fontFamily: theme.mono, fontSize: '12px', width: '160px', color: theme.ink }}>{codeOf(p)}</span>
                                                            <span style={{ flex: 1, fontSize: '0.85rem', color: theme.inkSoft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.itemName}</span>
                                                            <button onClick={() => addToCollection(p)} style={{ ...btn(false), padding: '5px 12px' }}>Add to {coll}</button>
                                                        </div>
                                                    ))}
                                                </div>
                                                <div style={{ fontSize: '0.82rem', color: theme.inkSoft, marginTop: '10px' }}>Fees usually land here — a return fee belongs to the collection commercially but is rarely tagged into it.</div>
                                            </div>
                                        )}
                                    </td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, lineHeight: 1.6 }}>
                        Their Net is the price this customer is charged — it is what CPQ, Quick Ship and the portal quote them. Leave it blank and they simply pay the base price.
                        <br />⚙ P / EP opens the same painted + plated tiers as the Master Library's Customer Alias &amp; Pricing window — a fee whose premium finish costs more (french return $35 painted · $43 plated) carries both there, and the row shows them once set.
                        {mode === 'FEES' && <><br />A PERCENTAGE fee is worked out from the CONFIGURATION SUBTOTAL — parts and labour, before any other fee and before shipping — so two percentage fees on one order never compound. “10% or $100 minimum” is 10 in the % column and 100 in Min $.</>}
                    </div>
                </>
            )}

            {/* NEW FEE */}
            {newFee && (
                <div onClick={() => setNewFee(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,.72)', zIndex: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '28px' }}>
                    <div onClick={e => e.stopPropagation()} style={{ background: '#fff', width: '720px', maxWidth: '96vw', maxHeight: '92vh', overflowY: 'auto', border: `1px solid ${theme.line}` }}>
                        <div style={{ padding: '20px 26px', borderBottom: `1px solid ${theme.line}`, background: theme.paper2 }}>
                            <div style={{ fontFamily: theme.serif, fontSize: '1.4rem' }}>New fee</div>
                            <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, marginTop: '4px' }}>
                                Ours, with {customer?.name || 'the customer'}'s part # and pricing on it{coll ? ` · tagged into ${coll}` : ''}
                            </div>
                        </div>
                        <div style={{ padding: '22px 26px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px' }}>
                                <div><label style={lbl}>Our item #</label><input value={newFee.code} onChange={e => setNewFee({ ...newFee, code: e.target.value.toUpperCase() })} placeholder="CE-FEE-6294" style={{ ...fld, width: '100%', fontFamily: theme.mono }} /></div>
                                <div><label style={lbl}>Description</label><input value={newFee.name} onChange={e => setNewFee({ ...newFee, name: e.target.value })} placeholder="Mitered return fee — backplate, painted" style={{ ...fld, width: '100%' }} /></div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', alignItems: 'end' }}>
                                <div><label style={lbl}>Our base price $</label><input value={newFee.basePrice} onChange={e => setNewFee({ ...newFee, basePrice: e.target.value })} placeholder="0.00" style={{ ...fld, width: '100%', textAlign: 'right', fontFamily: theme.mono }} /></div>
                                <div><label style={lbl}>How it's charged</label>
                                    <select value={newFee.feeMode} onChange={e => setNewFee({ ...newFee, feeMode: e.target.value })} style={{ ...fld, width: '100%' }}>
                                        {FEE_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                                    </select>
                                </div>
                                <div><label style={lbl}>Unit</label>
                                    <select value={newFee.feeUnit} disabled={newFee.feeMode === 'PERCENT'} onChange={e => setNewFee({ ...newFee, feeUnit: e.target.value })} style={{ ...fld, width: '100%', background: newFee.feeMode === 'PERCENT' ? theme.paper2 : '#fff' }}>
                                        {FEE_UNITS.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
                                    </select>
                                </div>
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <div style={{ flex: 1 }}><label style={lbl}>%</label><input value={newFee.feePercent} disabled={newFee.feeMode !== 'PERCENT'} onChange={e => setNewFee({ ...newFee, feePercent: e.target.value })} placeholder={newFee.feeMode === 'PERCENT' ? '25' : '—'} style={{ ...fld, width: '100%', textAlign: 'right', fontFamily: theme.mono, background: newFee.feeMode !== 'PERCENT' ? theme.paper2 : '#fff' }} /></div>
                                    <div style={{ flex: 1 }}><label style={lbl}>Min $</label><input value={newFee.feeMin} onChange={e => setNewFee({ ...newFee, feeMin: e.target.value })} placeholder="—" style={{ ...fld, width: '100%', textAlign: 'right', fontFamily: theme.mono }} /></div>
                                </div>
                            </div>
                            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', border: `1px solid ${newFee.feePortal ? theme.brass : theme.line}`, background: newFee.feePortal ? 'rgba(176,141,87,.08)' : '#fff', padding: '12px 14px' }}>
                                <input type="checkbox" checked={!!newFee.feePortal} onChange={e => setNewFee({ ...newFee, feePortal: e.target.checked })} style={{ marginTop: '2px', width: '15px', height: '15px', cursor: 'pointer' }} />
                                <span style={{ fontSize: '0.88rem', color: theme.ink }}>Customer can pick this in the portal
                                    <span style={{ display: 'block', fontSize: '0.82rem', color: theme.inkSoft, marginTop: '2px' }}>Leave off for internal-only fees — staff still add them on the customer's behalf.</span>
                                </span>
                            </label>
                            <div style={{ borderTop: `1px solid ${theme.line}`, paddingTop: '18px' }}>
                                <div style={{ fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: theme.brassDark, marginBottom: '10px' }}>{customer?.name || 'This customer'} — their side of it</div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                                    <div><label style={lbl}>Their part #</label><input value={newFee.theirSku} onChange={e => setNewFee({ ...newFee, theirSku: e.target.value })} placeholder="H1-MRPF" style={{ ...fld, width: '100%', fontFamily: theme.mono }} /></div>
                                    <div><label style={lbl}>Their net $</label><input value={newFee.theirNet} onChange={e => setNewFee({ ...newFee, theirNet: e.target.value })} placeholder="40.00" style={{ ...fld, width: '100%', textAlign: 'right', fontFamily: theme.mono }} /></div>
                                    <div><label style={lbl}>Their sales $</label><input value={newFee.theirSales} onChange={e => setNewFee({ ...newFee, theirSales: e.target.value })} placeholder="80.00" style={{ ...fld, width: '100%', textAlign: 'right', fontFamily: theme.mono }} /></div>
                                </div>
                            </div>
                        </div>
                        <div style={{ padding: '16px 26px', borderTop: `1px solid ${theme.line}`, display: 'flex', gap: '12px', justifyContent: 'flex-end', background: theme.paper }}>
                            <button onClick={() => setNewFee(null)} style={btn(false)}>Cancel</button>
                            <button onClick={createFee} style={btn(true, { background: theme.green, borderColor: theme.green })}>Create fee →</button>
                        </div>
                    </div>
                </div>
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
