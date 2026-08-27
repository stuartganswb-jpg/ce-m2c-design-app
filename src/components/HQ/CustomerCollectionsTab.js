// CUSTOMER COLLECTIONS (HQ 4.6, Stuart 2026-07-29) — maintain a customer's pricing across a whole
// collection in one screen.
//
// WHY: Fabricut H1 was built from a one-off xlsx import. It worked, but it left no way to fix what
// the sheet missed (H1-1D), and no way at all to price a SECOND customer against an existing
// collection (Calico ↔ Simple Elegance). Re-uploading a sheet to change one number is not
// maintenance. This page is the maintenance surface: pick a customer and a collection, see every
// part, edit in place, add the ones that were missed, and import a control file when a new one
import { matchesCustomerCode } from '../Shared/aliasSearch';
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
import { collection, onSnapshot, query, where, doc, setDoc, updateDoc, writeBatch, deleteField } from "firebase/firestore";
import { parseControlWorkbook, workbookFileToSheets, collapseBySku, diffControlRows, diffSummary, upper } from '../Shared/customerControlFile';
import { parseTraverseKitSheets, diffTraverseKits, kitPricingRow, BILLABLE_ACCESSORY_SEED } from '../Shared/traverseKitImport';
import { fabricutCodeOf, isPlatedSuffix, PRICE_LEVELS, customerPriceLevel } from '../Shared/priceLevels';
import { FEE_MODES, FEE_UNITS, feeRuleOf, isCheckoutSelectable, isCheckoutForCustomer, checkoutCustomerIds } from '../Shared/feeRules';
import { PLATE_ROLES, plateRoleOf, pairedBackplateCode, includesPlate } from '../Shared/plateRules';

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
// KIT RECORDS (Stuart 2026-08-08, the traverse project) — the sales face of a set: a customer part#
// wrapping real component items (manufacturingSpecs.kitComponents). Same class-first test shape as
// isFeeItem, with the KIT- code convention as the legacy fallback.
const isKitItem = (p) => p?.partClass === 'Kit' || /(^|-)KIT-/.test(upper(p?.legacyErpId || p?.itemId));

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
    const [bulkVals, setBulkVals] = useState({});        // the shared pricing bulk bar
    const [bulkUp, setBulkUp] = useState('');            // PLATES bulk bar: painted upcharge
    const [bulkUpPrem, setBulkUpPrem] = useState('');    // …and the /EP //P25 premium tier
    const [mode, setMode] = useState('COLLECTION');        // COLLECTION | FEES | CHECKOUT | PLATES
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
    // 📦 KIT BUILDER (Stuart 2026-08-08) — kits are customer/collection creatures, so they are
    // built HERE in bulk, not one at a time in the Master Library (same ruling as fees, 07-30).
    const [newKit, setNewKit] = useState(null);            // ＋ New kit form (KITS mode)
    const [kitImp, setKitImp] = useState(null);            // kit-sheet import preview { parsed, kitEntries, compEntries, fileName }
    const kitFileRef = useRef(null);
    const [kitRow, setKitRow] = useState(null);            // docId of the open contents editor
    const [kitEditRows, setKitEditRows] = useState([]);    // working copy of kitComponents while open
    const [kitSearch, setKitSearch] = useState('');        // component picker (form + row editor share it)
    const [masterFin, setMasterFin] = useState([]);        // system/master_finishes — the in-house codes
    const [kitFinSel, setKitFinSel] = useState({});        // code → true while the kit row editor is open
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
        const unsubMF = onSnapshot(doc(db, 'system', 'master_finishes'), s2 =>
            setMasterFin(((s2.exists() && s2.data().finishes) || []).filter(f => f && (f.code || f.name)).map(f => ({ code: String(f.code || f.name).trim().toUpperCase(), name: f.name || f.code, outsourced: false }))));
        const unsubFin = onSnapshot(collection(db, 'hq_outsource_finishes'), snap =>
            setOutsourceFinishes(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(f => f.code || f.name)));
        return () => { unsubItems(); unsubCust(); unsubFin(); unsubMF(); };
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
    // The customer's pricing tier, read through the one shared answer so this screen and the engines
    // can never disagree about what it is (the Fabricut name shim shows here too, until it is set).
    const custLevel = customerPriceLevel(customer, 'STANDARD').level;
    const saveCustLevel = async (lvl) => {
        if (!custId) return;
        setSaving(true);
        try {
            await updateDoc(doc(db, 'crm_records', custId), { defaultPriceLevel: lvl });
        } catch (e) { console.error(e); alert('Could not save the pricing level:\n\n' + (e.message || e)); }
        setSaving(false);
    };

    const allCollections = useMemo(() => Array.from(new Set(
        inventory.flatMap(p => collectionsOf(p.manufacturingSpecs))
    )).sort(), [inventory]);

    // The customer's existing row on an item. Matched the same way CPQ/Quick Ship match — by CRM id
    // OR by the customer's NAME, because rows have been hand-entered both ways over time.
    const custKeys = useMemo(() => new Set([custId, customer?.name, customer?.companyName]
        .filter(Boolean).map(s => upper(s))), [custId, customer]);
    const rowFor = (p) => (p.clientPricing || []).find(r => custKeys.has(upper(r?.customerId))) || null;

    // ALIAS → MAIN linkage, computed once per library change. mainByAliasId folds an alias doc to
    // the real item it points at; aliasCodesByMainId is the reverse (for search + display).
    const aliasLinks = useMemo(() => {
        const mainByAliasId = new Map(), aliasCodesByMainId = new Map();
        const targetOf = (x) => upper(String(x.aliasOf || x.manufacturingSpecs?.aliasOf || ''));
        inventory.forEach(x => {
            const t = targetOf(x);
            if (!t) return;
            const base = t.split('/')[0];
            const main = inventory.find(y => !targetOf(y) && (codeOf(y) === t || codeOf(y).split('/')[0] === base));
            if (main) {
                mainByAliasId.set(x.id, main);
                aliasCodesByMainId.set(main.id, [...(aliasCodesByMainId.get(main.id) || []), codeOf(x)]);
            }
        });
        return { mainByAliasId, aliasCodesByMainId };
    }, [inventory]); // eslint-disable-line react-hooks/exhaustive-deps

    const members = useMemo(() => {
        // ALIASES FOLD INTO THEIR MAIN ITEM (Stuart 2026-08-11: "4.6 is not showing our main fee
        // for French or Miter Return — the fabricut information is stored on the main fee, not the
        // alias"). The H1 collection tags the ALIAS docs (H1-FRPF → CE-FEE-4594), so this screen
        // listed the alias — but every field 4.6 edits (tiers, client rows, plate & fee rules,
        // checkout) is read by the engine off the MAIN doc; the alias is customer-facing display
        // identity only (Shared/aliasIdentity). Editing the alias here wrote data nothing reads.
        // Each alias member resolves to its main doc (kept as-is if the target can't be found) and
        // duplicates collapse; the ⚙ panel's Alias line still shows/creates the customer code.
        const fold = (list) => {
            const seen = new Set(); const out = [];
            list.forEach(p => { const m = aliasLinks.mainByAliasId.get(p.id) || p; if (!seen.has(m.id)) { seen.add(m.id); out.push(m); } });
            return out;
        };
        if (mode === 'FEES') return fold(inventory.filter(isFeeItem));
        // KITS: the brand's kit records, scoped by the collection picker when one is chosen (same
        // rule as PLATES — a list that quietly ignores the visible selector reads as a bug).
        if (mode === 'KITS') return fold(inventory.filter(p => isKitItem(p)
            && p.manufacturingSpecs?.isRetired !== true
            && (!coll || collectionsOf(p.manufacturingSpecs).includes(upper(coll)))));
        // CHECKOUT ITEMS (Stuart 2026-07-31): what the CPQ checkout screen offers. By default the
        // list IS the curated set, so you see exactly what a customer sees. Type in the search box
        // and it searches the WHOLE library instead — that is how you find something new to tick.
        // PLATES (Stuart 2026-08-03: "can we add the bulk tool to 4.6 so we can add/update all in
        // one place, it is tedious to do this all via master library"). Every plate in the brand,
        // because the role is ITEM metadata — setting it once serves every customer and every flow.
        // SCOPED BY THE COLLECTION PICKER (Stuart 2026-08-03 — he opened Arms & Returns with
        // FABRICUT H1 selected and got a list of H2 items). The role is item metadata, so
        // brand-wide was defensible, but the screen still SHOWS a collection selector: a list that
        // quietly ignores it reads as a bug, and on a screen with an apply-to-all button that is
        // genuinely dangerous. Scope to the chosen collection; no collection = the whole brand.
        if (mode === 'PLATES') return fold(inventory.filter(p => /PLATE/i.test(String(p.manufacturingSpecs?.productType || ''))
            && p.manufacturingSpecs?.isRetired !== true
            && (!coll || collectionsOf(p.manufacturingSpecs).includes(upper(coll)))));
        // ARMS: everything that can CARRY a plate — bracket arms and the return fees that replace
        // them. This is where "which parts include a backplate" is answered.
        if (mode === 'ARMS') return fold(inventory.filter(p => {
            if (p.manufacturingSpecs?.isRetired === true) return false;
            if (coll && !collectionsOf(p.manufacturingSpecs).includes(upper(coll)) && !isFeeItem(p)) return false;
            const pt = String(p.manufacturingSpecs?.productType || '').toUpperCase();
            return /BRACKET|ARM/.test(pt) || isFeeItem(p);
        }));
        // With no search the list shows the curated set: the Std ticks PLUS anything assigned to
        // the picked customer (two-home model, Stuart 2026-08-25) — so with a customer picked you
        // see exactly the union CPQ checkout and tab 7 offer them.
        if (mode === 'CHECKOUT') return fold(upper(search).trim()
            ? inventory.filter(p => p?.manufacturingSpecs?.isRetired !== true)
            : inventory.filter(p => isCheckoutSelectable(p) || isCheckoutForCustomer(p, custId)));
        if (!coll) return [];
        return fold(inventory.filter(p => collectionsOf(p.manufacturingSpecs).includes(upper(coll))));
    }, [inventory, coll, mode, search, aliasLinks, custId]);

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
                    checkout: rv('checkout', isCheckoutSelectable(p)),
                    checkoutCust: rv('checkoutCust', isCheckoutForCustomer(p, custId)),
                    plateRole: rv('plateRole', plateRoleOf(p)),
                    carriesPlate: rv('carriesPlate', includesPlate(p)),
                    plateUpgradeOf: rv('plateUpgradeOf', p.manufacturingSpecs?.plateUpgradeOf || ''),
                    plateUpcharge: rv('plateUpcharge', p.manufacturingSpecs?.plateUpcharge ?? ''),
                    plateUpchargePremium: rv('plateUpchargePremium', p.manufacturingSpecs?.plateUpchargePremium ?? ''),
                    derivedPair: pairedBackplateCode(p),
                    isFeeRec: isFeeItem(p),
                    plated: isPlatedSuffix(codeOf(p).includes('/') ? codeOf(p).split('/')[1] : '', outsourceFinishes),
                    code: codeOf(p),
                    aliasCodes: aliasLinks.aliasCodesByMainId.get(p.id) || [],
                    name: p.itemName || '',
                    basePrice: e.basePrice !== undefined ? e.basePrice : (p.manufacturingSpecs?.basePrice ?? ''),
                    clientSku: pick('clientSku'),
                    price: pick('price'),
                    clientSalesPrice: pick('clientSalesPrice'),
                    clientRetailPrice: pick('clientRetailPrice'),
                    // The ADDITIONAL-FOOT triple (traverse kits) — import-stamped, now editable.
                    perFootPrice: pick('perFootPrice'),
                    perFootSales: pick('perFootSales'),
                    perFootRetail: pick('perFootRetail'),
                    dirty: !!edits[p.id],
                };
            })
            .filter(r => !term || r.code.includes(term) || upper(r.name).includes(term) || r.aliasCodes.some(c => c.includes(term)) || matchesCustomerCode(r.p, term))
            .filter(r => onlyPriced === 'ALL' || (onlyPriced === 'PRICED' ? money(r.price) !== '' : money(r.price) === ''));
    }, [members, edits, search, onlyPriced, custKeys, custId, suggestions, outsourceFinishes, aliasLinks]); // eslint-disable-line react-hooks/exhaustive-deps

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
                // ⚠ START FROM THE EXISTING ROW, then lay the edits over it. The row used to be
                // REBUILT from just the four grid fields — which silently DROPPED anything else it
                // carried, and the kit import's perFootPrice/perFootSales/perFootRetail were being
                // wiped by any later price edit on that kit (Stuart 2026-08-27: "i can't find
                // where to maintain that either"). A field the grid does not know about survives.
                const next = {
                    ...(cur || {}),
                    customerId: custId,
                    customerName: customer?.name || '',
                    clientSku: e.clientSku !== undefined ? String(e.clientSku).trim() : (cur?.clientSku ?? ''),
                    price: e.price !== undefined ? money(e.price) : (cur?.price ?? ''),
                    clientSalesPrice: e.clientSalesPrice !== undefined ? money(e.clientSalesPrice) : (cur?.clientSalesPrice ?? ''),
                    clientRetailPrice: e.clientRetailPrice !== undefined ? money(e.clientRetailPrice) : (cur?.clientRetailPrice ?? ''),
                    source: 'COLLECTION_PAGE', updatedAt: Date.now(), updatedBy: String(currentUser || ''),
                };
                // The additional-foot triple (traverse kits): editable in the open-kit panel.
                if (e.perFootPrice !== undefined) next.perFootPrice = money(e.perFootPrice);
                if (e.perFootSales !== undefined) next.perFootSales = money(e.perFootSales);
                if (e.perFootRetail !== undefined) next.perFootRetail = money(e.perFootRetail);
                ['perFootPrice', 'perFootSales', 'perFootRetail'].forEach(k => { if (next[k] === '' || next[k] === null) delete next[k]; });
                const others = (p.clientPricing || []).filter(r => !custKeys.has(upper(r?.customerId)));
                // A row with nothing in it is removed rather than stored as an empty shell.
                const keep = (next.clientSku || next.price !== '' || next.clientSalesPrice !== '' || next.clientRetailPrice !== ''
                    || next.perFootPrice != null || next.perFootSales != null || next.perFootRetail != null);
                const patch = { clientPricing: keep ? [...others, next] : others };
                if (e.basePrice !== undefined) patch['manufacturingSpecs.basePrice'] = money(e.basePrice);
                // Fee RULE — how the amount is worked out. The PRICE stays where every price lives
                // (base / clientPricing / the Fabricut box); only the shape is stored here.
                if (e.feeMode !== undefined) patch['manufacturingSpecs.feeRule.mode'] = e.feeMode;
                if (e.feeUnit !== undefined) patch['manufacturingSpecs.feeRule.unit'] = e.feeUnit;
                if (e.feePercent !== undefined) patch['manufacturingSpecs.feeRule.percent'] = money(e.feePercent);
                if (e.feeMin !== undefined) patch['manufacturingSpecs.feeRule.minAmount'] = money(e.feeMin);
                if (e.feePortal !== undefined) patch['manufacturingSpecs.feeRule.portalSelectable'] = !!e.feePortal;
                // TWO CHECKOUT HOMES (Stuart 2026-08-25). Std = the item-wide tick, every flow and
                // every customer, as it always was. The customer column writes membership in
                // manufacturingSpecs.checkoutCustomers — the per-customer assignment CPQ checkout
                // AND tab 7 both read, so the two screens can never disagree about what this
                // customer may add. (Per-FLOW standard items are the third home: tab 11.)
                if (e.checkout !== undefined) patch['manufacturingSpecs.checkoutSelectable'] = !!e.checkout;
                if (e.checkoutCust !== undefined) {
                    const cur = checkoutCustomerIds(p);
                    patch['manufacturingSpecs.checkoutCustomers'] = e.checkoutCust
                        ? [...new Set([...cur, custId])]
                        : cur.filter(id => id !== custId);
                }
                // Plate pricing role + its tiered upcharge. Blank is stored as '' rather than 0 —
                // "no figure entered" and "free" are different answers and the engine reads them so.
                if (e.plateRole !== undefined) patch['manufacturingSpecs.plateRole'] = e.plateRole || '';
                // Stored only when it is FALSE — the default (an arm covers its plate) stays absent,
                // so ticking everything on doesn't write a field to every item in the catalogue.
                if (e.carriesPlate !== undefined) {
                    // Included is the DEFAULT, carried by the field being absent. Ticking a row that
                    // is already included must write nothing — otherwise an apply-to-all stamps a
                    // redundant field onto every item in the catalogue for no behaviour change.
                    const wasExcepted = p.manufacturingSpecs?.includesPlate === false;
                    if (!e.carriesPlate) patch['manufacturingSpecs.includesPlate'] = false;
                    else if (wasExcepted) patch['manufacturingSpecs.includesPlate'] = deleteField();
                }
                if (e.plateUpgradeOf !== undefined) patch['manufacturingSpecs.plateUpgradeOf'] = upper(e.plateUpgradeOf);
                if (e.plateUpcharge !== undefined) patch['manufacturingSpecs.plateUpcharge'] = money(e.plateUpcharge);
                if (e.plateUpchargePremium !== undefined) patch['manufacturingSpecs.plateUpchargePremium'] = money(e.plateUpchargePremium);
                // "Priced in conjunction with" staged by the seed sweep (blank fields only). Lives in
                // the Fabricut box like the tier editor's writes; dot-path update creates the map.
                if (e.pricedWith !== undefined) patch['manufacturingSpecs.fabricut.pricedWith'] = String(e.pricedWith).trim() === '' ? deleteField() : String(e.pricedWith).trim();
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

    // ---- REFRESH EVERY ROW FROM THE PRICING BOX (Stuart 2026-08-22) --------------------------
    // Moved here from the Master Library item editor, where a CATALOGUE-WIDE write sat inside one
    // item's detail panel with no customer picked, no collection scope and nothing shown about what
    // it was about to touch. It belongs where the pricing work happens.
    //
    // Two differences from the Library version, both of which make it safer and more correct:
    //   · it reads the tier the way this page reads it — PLATED for a /EP //P25 doc, painted
    //     otherwise — where the old one stamped the painted price onto every variant;
    //   · it writes in batches keyed to the CUSTOMER YOU PICKED, rather than one document at a
    //     time against a name match.
    // Unlike Adopt, this REPLACES rows that already exist: it is the "the sheet changed, make the
    // rows say so" button, which is exactly why it must announce how many it will overwrite.
    const refreshAllFromBox = async () => {
        if (!custId || !legacySrc) return;
        const findByCode = (c) => byCode.get(upper(c)) || null;
        const targets = [];
        inventory.forEach(p => {
            const s2 = legacySrc.read(p, findByCode, outsourceFinishes);
            if (s2 && (s2.clientSku || s2.price !== '' || s2.clientSalesPrice !== '' || s2.clientRetailPrice !== '')) targets.push({ p, s: s2 });
        });
        if (!targets.length) return alert(`No items in this brand carry a ${legacySrc.label}.`);
        const overwrite = targets.filter(({ p }) => !!rowFor(p)).length;
        if (!window.confirm(`Refresh ${customer?.name || custId}'s Client Pricing from the ${legacySrc.label} on ${targets.length} item(s)?\n\n• Their SKU = the pattern #\n• Their Net = CE → Fabricut · Sales = wholesale · Retail = MSRP\n• A /EP //P25 item takes the PLATED tier, everything else the painted one\n\n⚠ ${overwrite} item(s) already have a ${customer?.name || 'customer'} row and will be REPLACED. Other customers' rows are untouched.\n\nThis is brand-wide — it is not limited to ${coll || 'the chosen collection'}.`)) return;
        setSaving(true);
        try {
            let batch = writeBatch(db), n = 0, written = 0;
            for (const { p, s: sug } of targets) {
                const others = (p.clientPricing || []).filter(r => !custKeys.has(upper(r?.customerId)));
                batch.update(doc(db, 'Approved_Designs', p.id), {
                    clientPricing: [...others, {
                        customerId: custId, customerName: customer?.name || '',
                        clientSku: sug.clientSku || '', price: sug.price, clientSalesPrice: sug.clientSalesPrice, clientRetailPrice: sug.clientRetailPrice ?? '',
                        source: 'REFRESHED_' + (legacySrc.label || '').toUpperCase().replace(/[^A-Z]+/g, '_'),
                        updatedAt: Date.now(), updatedBy: String(currentUser || ''),
                    }],
                });
                written++;
                if (++n >= 400) { await batch.commit(); batch = writeBatch(db); n = 0; }
            }
            if (n) await batch.commit();
            alert(`✅ ${written} item(s) refreshed from the ${legacySrc.label} for ${customer?.name || custId}.`);
        } catch (e) { console.error(e); alert('Refresh failed:\n\n' + (e.message || e)); }
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
    // The three tier groups and the null-vs-blank contract (pivot phase B, Stuart 2026-08-08 —
    // "we need to be sure tab 4.6 has everything it needs to control pricing and alias information
    // by customer per collection"): BLANK = no data at that tier → the CPQ level falls back to
    // standard; EXPLICIT NULL = the "$0 · w/ arm" grouping decision → the level quotes $0
    // (priceLevels.fabricutPriceOf: undefined→standard, null→0). The old save wrote blank AS null,
    // so clearing a price here silently turned "no data" into "quote $0" — fixed: blank now
    // DELETES the field, and null is written only by the toggles.
    const TIER_GROUPS = [
        { key: 'painted', label: 'Painted tier (/P)', f: { cost: 'paintedCost', wholesale: 'paintedWholesale', retail: 'paintedRetail' } },
        { key: 'plated', label: 'Plated / premium tier (/EP, /P25)', f: { cost: 'platedCost', wholesale: 'platedWholesale', retail: 'platedRetail' } },
        { key: 'direct', label: 'This item’s own price (variants, single-finish)', f: { cost: 'cost', wholesale: 'wholesale', retail: 'retail' } },
    ];
    const openTiers = (p) => {
        const fab = p.manufacturingSpecs?.fabricut || {};
        const seed = { pricedWith: fab.pricedWith || '' };
        [...TIER_FIELDS, ...CODE_FIELDS].forEach(f => { seed[f.key] = fab[f.key] === undefined || fab[f.key] === null ? '' : fab[f.key]; });
        // The explicit-null grouping flags, per tier group ("$0 · w/ arm").
        TIER_GROUPS.forEach(g => { seed[`incl_${g.key}`] = fab[g.f.cost] === null && fab[g.f.retail] === null; });
        setTierEdit(seed); setTierRow(p.id);
    };
    const saveTiers = async () => {
        const p = inventory.find(x => x.id === tierRow);
        if (!p) return;
        const patch = {};
        TIER_GROUPS.forEach(g => {
            const incl = !!tierEdit[`incl_${g.key}`];
            Object.values(g.f).forEach(key => {
                const v = tierEdit[key];
                patch[`manufacturingSpecs.fabricut.${key}`] = incl ? null : (v === '' ? deleteField() : money(v));
            });
        });
        CODE_FIELDS.forEach(f => { const v = String(tierEdit[f.key] || '').trim(); patch[`manufacturingSpecs.fabricut.${f.key}`] = v === '' ? deleteField() : v; });
        const pw = String(tierEdit.pricedWith || '').trim();
        patch['manufacturingSpecs.fabricut.pricedWith'] = pw === '' ? deleteField() : pw;
        patch['manufacturingSpecs.fabricut.source'] = 'COLLECTION_PAGE';
        patch['manufacturingSpecs.fabricut.updatedAt'] = Date.now();
        try {
            await setDoc(doc(db, 'Approved_Designs', p.id), { manufacturingSpecs: { fabricut: {} } }, { merge: true }); // ensure the map exists
            await updateDoc(doc(db, 'Approved_Designs', p.id), patch);
            setTierRow(null); setTierEdit({});
        } catch (e) { console.error(e); alert('Save failed:\n\n' + (e.message || e)); }
    };
    // Seed/refresh THIS customer's clientPricing row from the tiers just saved — the per-item
    // version of ↺ Adopt, for the SELECTED customer (not just a /fabricut/-named one). SKU =
    // resolved pattern #, price = cost, sales = wholesale, retail = MSRP; keyed by CRM doc id.
    const seedRowFromTiers = async (p) => {
        if (!customer) return alert('Pick a customer first.');
        const byCode = new Map(); inventory.forEach(x => { [x.legacyErpId, x.itemId].forEach(c => { const k = upper(c); if (k && k !== 'PENDING' && !byCode.has(k)) byCode.set(k, x); }); });
        const sug = fabricutSuggestion(p, (c) => byCode.get(upper(c)) || null, outsourceFinishes);
        if (!sug) return alert('No sellable tier price on this item (a group-priced $0 plate stays out of Client Pricing — its rule shows in "Priced in conjunction with").');
        const rows = (p.clientPricing || []).filter(r => upper(r.customerId) !== upper(customer.id) && upper(r.customerId) !== upper(customer.name));
        rows.push({ customerId: customer.id, customerName: customer.name || '', clientSku: sug.clientSku, price: sug.price, clientSalesPrice: sug.clientSalesPrice, clientRetailPrice: sug.clientRetailPrice, source: 'TIER_SEED', updatedAt: Date.now(), updatedBy: String(currentUser || '') });
        try { await setDoc(doc(db, 'Approved_Designs', p.id), { clientPricing: rows }, { merge: true }); alert(`✅ ${customer.name} row seeded from the tiers (${sug.clientSku || 'no SKU'} · $${sug.price}).`); }
        catch (e) { alert('Seed failed:\n\n' + (e.message || e)); }
    };
    // ---- ALIAS control (pivot phase B): the customer-facing identity, per collection ----------
    // An alias is a full Approved_Designs record pointing home via manufacturingSpecs.aliasOf
    // (the REAL item's bare ERP code — the shape aliasIdentity.buildAliasIndex keys on). It
    // carries the customer's collection so customerFaceOf can pick it, and it must NEVER get a
    // netSuiteInternalId (the sync excludes aliases; a mapped alias would push as itself).
    const aliasesOf = (p) => {
        const base = upper((p.legacyErpId && p.legacyErpId !== 'PENDING' ? p.legacyErpId : p.itemId) || '').split('/')[0];
        if (!base) return [];
        return inventory.filter(x => {
            const t = upper(x.aliasOf || x.manufacturingSpecs?.aliasOf || '');
            return t && (t === base || t.split('/')[0] === base);
        });
    };
    const createAlias = async (p) => {
        const base = upper((p.legacyErpId && p.legacyErpId !== 'PENDING' ? p.legacyErpId : p.itemId) || '').split('/')[0];
        if (!base) return alert('This item has no code to alias.');
        const code = upper(window.prompt(`Customer-facing item # for ${base} (the code ${customer?.name || 'the customer'} sees on quotes and the portal):`) || '').trim();
        if (!code) return;
        if (inventory.some(x => upper(x.legacyErpId) === code || upper(x.itemId) === code)) return alert(`${code} already exists in this brand.`);
        const name = String(window.prompt('Customer-facing display name:', p.itemName || '') || '').trim() || p.itemName || code;
        const id = code;
        try {
            await setDoc(doc(db, 'Approved_Designs', id), {
                id, itemId: code, legacyErpId: code, itemName: name,
                brandId: p.brandId, sharedBrands: p.sharedBrands || [],
                partClass: p.partClass || 'Inventory',
                clientPricing: [],
                manufacturingSpecs: {
                    aliasOf: base,
                    productType: p.manufacturingSpecs?.productType || '',
                    collections: coll ? [coll] : [],
                },
                createdAt: new Date().toISOString(), author: String(currentUser || ''),
            }, { merge: false });
            alert(`✅ Alias ${code} → ${base} created${coll ? ` in ${coll}` : ''}. It carries NO NetSuite id by design — quotes show ${code}, the floor and NetSuite see ${base}.`);
        } catch (e) { alert('Alias create failed:\n\n' + (e.message || e)); }
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

    // ---- CREATE A KIT (Stuart 2026-08-08, the traverse project) --------------------------------
    // "this kit will be where we load all of the actual associated inventory or assembly items,
    // and attach the customer alias/pricing tool to this. so we can give our customer a part# for
    // a 4ft set." Same one-action shape as createFee: the record, its contents, and the customer's
    // association (clientPricing row) are made together, tagged into the selected collection. The
    // kit is the SALES face only — shop documents always explode to kitComponents, so nothing here
    // ever reaches NetSuite as an item.
    const createKit = async () => {
        const f = newKit || {};
        const code = upper(f.code);
        if (!code) return alert('Give the kit an item # — ours, not the customer’s (e.g. CE-KIT-2TRV4).');
        if (!String(f.name || '').trim()) return alert('Give the kit a description (e.g. "4ft Traverse Starter Set").');
        if (inventory.some(p => codeOf(p) === code)) return alert(`"${code}" already exists in the library. Find it in the list and add ${customer?.name || 'the customer'}'s part # to it instead — that is the association.`);
        const comps = (f.components || []).filter(r => r.partId && (parseInt(r.qty) || 0) > 0);
        if (!comps.length) return alert('A kit with no contents cannot explode on the shop documents — add at least one component item.');
        const row = (f.theirSku || f.theirNet !== '' || f.theirSales !== '') ? [{
            customerId: custId, customerName: customer?.name || '',
            clientSku: String(f.theirSku || '').trim(), price: money(f.theirNet), clientSalesPrice: money(f.theirSales),
            source: 'COLLECTION_PAGE', updatedAt: Date.now(), updatedBy: String(currentUser || ''),
        }] : [];
        const id = `KIT-${code.replace(/[^A-Za-z0-9-]/g, '_')}-${Date.now().toString().slice(-6)}`;
        try {
            await setDoc(doc(db, 'Approved_Designs', id), {
                id, itemId: code, legacyErpId: code, itemName: String(f.name).trim(),
                brandId: activeBrand, sharedBrands: [activeBrand],
                partClass: 'Kit', routingType: '',
                clientPricing: row,
                manufacturingSpecs: {
                    basePrice: money(f.basePrice),
                    // KIT-FAMILY TAG (2026-08-26): derived from the code (H1-2TRV-4/EP → H1-2TRV)
                    // so the CPQ "Start from a kit" picker matches by tag automatically.
                    ...(code.includes('-') ? { kitFamily: code.split('-').slice(0, -1).join('-') } : {}),
                    kitComponents: comps.map(r => ({ partId: r.partId, qty: parseInt(r.qty) || 1 })),
                    ...(coll ? { collections: [upper(coll)] } : {}),
                    status: 'APP_ONLY', createdAt: Date.now(), createdBy: String(currentUser || ''),
                },
            });
            setNewKit(null); setKitSearch('');
        } catch (e) { alert(`Create failed: ${e?.message || e}`); }
    };

    // Save the open row editor's contents back onto the kit record. Contents are item metadata
    // (shared by every customer), so this writes the item doc, not the clientPricing row.
    const saveKitContents = async () => {
        if (!kitRow) return;
        const comps = kitEditRows.filter(r => r.partId && (parseInt(r.qty) || 0) > 0)
            .map(r => ({ partId: r.partId, qty: parseInt(r.qty) || 1 }));
        // FLOW-ALIGNED kits (the imported traverse ones) carry ZERO components BY DESIGN — they are
        // the customer-alias layer over a base identity (the id before the /, finish applied after),
        // and the components come from the rules EXPLOSION at order time (Stuart 2026-08-13: "these
        // are more like the customer alias's... only existing as references back to the main kits").
        // Requiring contents here blocked saving their finish matrix. Only a HAND-BUILT kit — no
        // kitAlign, so nothing can explode it — still needs at least one component.
        const aligned = !!inventory.find(x => x.id === kitRow)?.manufacturingSpecs?.kitAlign;
        if (!comps.length && !aligned) return alert('A kit needs at least one component — delete the kit record in the Master Library if it is obsolete.');
        try {
            await updateDoc(doc(db, 'Approved_Designs', kitRow), {
                'manufacturingSpecs.kitComponents': comps,
                'manufacturingSpecs.kitFinishOptions': Object.keys(kitFinSel).filter(c => kitFinSel[c]),
                updatedAt: new Date().toISOString(),
            });
            setKitRow(null); setKitEditRows([]); setKitSearch(''); setKitFinSel({});
        } catch (e) { alert(`Save failed: ${e?.message || e}`); }
    };

    // The component picker + qty rows, shared by the ＋New kit form and the per-row editor. Real
    // items only — a kit never contains a fee or another kit.
    const kitContentsEditor = (rowsIn, setRowsFn) => {
        const q = upper(kitSearch).trim();
        const inKit = new Set(rowsIn.map(r => r.partId));
        const hits = !q ? [] : inventory.filter(p => {
            if (isFeeItem(p) || isKitItem(p) || p.manufacturingSpecs?.isRetired === true) return false;
            if (inKit.has(p.id)) return false;
            return codeOf(p).includes(q) || upper(p.itemName).includes(q);
        }).slice(0, 8);
        const partById = (k) => inventory.find(p => p.id === k) || null;
        return (
            <div>
                {rowsIn.map((r, i) => {
                    const p = partById(r.partId);
                    return (
                        <div key={`${r.partId}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 0', borderBottom: `1px solid ${theme.paper2}` }}>
                            <span style={{ fontFamily: theme.mono, fontSize: '11px', width: '160px' }}>{p ? codeOf(p) : r.partId}</span>
                            <span style={{ flex: 1, fontSize: '0.84rem', color: p ? theme.inkSoft : theme.red, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p ? p.itemName : '⚠ not found in library'}</span>
                            <input type="number" min="1" value={r.qty} title="Quantity in ONE kit"
                                onChange={e => setRowsFn(rowsIn.map((x, j) => j === i ? { ...x, qty: Math.max(1, parseInt(e.target.value) || 1) } : x))}
                                style={{ ...fld, width: '64px', textAlign: 'center' }} />
                            <button onClick={() => setRowsFn(rowsIn.filter((_, j) => j !== i))} style={{ ...btn(false), padding: '6px 10px' }}>✕</button>
                        </div>
                    );
                })}
                <input value={kitSearch} onChange={e => setKitSearch(e.target.value)} placeholder="Search items to add (code or name)…" style={{ ...fld, width: '100%', marginTop: '10px' }} />
                {hits.map(p => (
                    <div key={p.id} onClick={() => { setRowsFn([...rowsIn, { partId: p.id, qty: 1 }]); setKitSearch(''); }}
                        style={{ display: 'flex', gap: '10px', padding: '7px 12px', border: `1px solid ${theme.line}`, borderTop: 'none', cursor: 'pointer', background: '#fff' }}>
                        <span style={{ fontFamily: theme.mono, fontSize: '11px', width: '160px' }}>{codeOf(p)}</span>
                        <span style={{ flex: 1, fontSize: '0.82rem', color: theme.inkSoft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.itemName}</span>
                    </div>
                ))}
            </div>
        );
    };

    // ---- KIT SHEET IMPORT (Stuart 2026-08-12, Fabricut/Aug12/Fabricut_Traverse.xlsx) ----------
    // Reads the traverse kit workbook and shows what it WOULD do before anything is written — the
    // same read-then-apply shape as the control-file import. Parsing lives in
    // Shared/traverseKitImport (pure, node-tested against the real sheet).
    const onKitSheetFile = async (file) => {
        if (!file || !custId) { if (!custId) alert('Pick the customer this kit sheet belongs to first.'); return; }
        setBusy('Reading the kit sheet…');
        try {
            const parsed = parseTraverseKitSheets(await workbookFileToSheets(file));
            const libByCode = new Map();
            inventory.forEach(p => { const c = codeOf(p); if (c && !libByCode.has(c)) libByCode.set(c, { id: p.id }); });
            const { kitEntries, compEntries } = diffTraverseKits(parsed, libByCode);
            setKitImp({ parsed, kitEntries, compEntries, fileName: file.name });
        } catch (e) { console.error(e); alert('Could not read that workbook:\n\n' + (e.message || e)); }
        setBusy('');
    };

    const applyKitImport = async () => {
        const { parsed, kitEntries, compEntries } = kitImp;
        setBusy('Writing kits…');
        try {
            const batch = writeBatch(db);
            const otherRows = (p) => (p?.clientPricing || []).filter(r =>
                upper(r?.customerId) !== upper(custId) && upper(r?.customerId) !== upper(customer?.name));
            kitEntries.forEach(k => {
                const row = kitPricingRow(k, { customerId: custId, customerName: customer?.name, user: currentUser });
                if (k.status === 'NEW') {
                    // Deterministic id — re-importing the sheet UPDATES rather than duplicating.
                    const id = `KIT-${k.code.replace(/[^A-Za-z0-9-]/g, '_')}`;
                    batch.set(doc(db, 'Approved_Designs', id), {
                        id, itemId: k.code, legacyErpId: k.code, itemName: k.name,
                        brandId: activeBrand, sharedBrands: [activeBrand], partClass: 'Kit', routingType: '',
                        clientPricing: [row],
                        manufacturingSpecs: {
                            kitFamily: parsed.family, kitAlign: k.align, kitMotorCodes: k.motorCodes,
                            ...(coll ? { collections: [upper(coll)] } : {}),
                            status: 'APP_ONLY', createdAt: Date.now(), createdBy: String(currentUser || ''),
                        },
                    });
                } else {
                    const p = inventory.find(x => x.id === k.docId);
                    batch.update(doc(db, 'Approved_Designs', k.docId), {
                        partClass: 'Kit', itemName: k.name,
                        // Backfill the brand stamp — an older kit record without brandId never
                        // reaches CPQ's brand-filtered library, which hides the kit picker.
                        brandId: p?.brandId || activeBrand,
                        clientPricing: [...otherRows(p), row],
                        'manufacturingSpecs.kitFamily': parsed.family,
                        'manufacturingSpecs.kitAlign': k.align,
                        'manufacturingSpecs.kitMotorCodes': k.motorCodes,
                        updatedAt: new Date().toISOString(),
                    });
                }
            });
            // Component alignment — EXISTING items only, last row per code wins (a code can appear
            // on both the main tab and Carrier Parts).
            const compByDoc = new Map();
            compEntries.filter(c => c.status === 'ALIGN').forEach(c => compByDoc.set(c.docId, c));
            compByDoc.forEach((c, docId) => {
                const p = inventory.find(x => x.id === docId);
                batch.update(doc(db, 'Approved_Designs', docId), {
                    clientPricing: [...otherRows(p), kitPricingRow(c, { customerId: custId, customerName: customer?.name, user: currentUser })],
                    updatedAt: new Date().toISOString(),
                });
            });
            // The rules doc — per-length usage + configurator list. One doc per flow family; the
            // future traverse rules tab edits THIS, so billable is a field, seeded not hardcoded.
            // Lives in the SYSTEM collection (system/traverse_rules_<family>) — firestore.rules is
            // a whitelist and a brand-new top-level collection is denied until a Cloud Shell rules
            // deploy; system/** is already open to authed staff and is where quick_ship_kits lives.
            // (First import attempt failed exactly there: "Missing or insufficient permissions",
            // 2026-08-13 — the batch is atomic, so the one denied write voided all of it.)
            batch.set(doc(db, 'system', `traverse_rules_${parsed.family}`), {
                ...parsed.rules, billableSeed: BILLABLE_ACCESSORY_SEED,
                updatedAt: Date.now(), updatedBy: String(currentUser || ''),
            });
            await batch.commit();
            const missing = compEntries.filter(c => c.status === 'MISSING');
            alert(`✅ Applied: ${kitEntries.length} kit(s), ${compByDoc.size} component(s) priced for ${customer?.name}, rules doc written.${missing.length ? `\n\n⚠ ${missing.length} component code(s) not in the library — not created, price them once the items exist:\n${missing.map(m => m.code).join(', ')}` : ''}${parsed.warnings.length ? `\n\nWarnings:\n• ${parsed.warnings.join('\n• ')}` : ''}`);
            setKitImp(null);
        } catch (e) { console.error(e); alert(`Apply failed: ${e?.message || e}`); }
        setBusy('');
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
                {/* ⚠ WHICH LEVEL THIS CUSTOMER PRICES AT (Stuart 2026-08-22). It used to be inferred:
                    ANY named customer defaulted to Fabricut Cost, which made somebody else's sheet
                    the fallback for every account. It is a fact about the customer, so it is stored
                    on the customer and set here — the one place their pricing is maintained. Blank
                    or Standard = their own rows, then base price. */}
                {custId && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                        title="The pricing tier this customer is quoted at everywhere — CPQ, Order Entry and the portal. Standard means their own Client Pricing rows, then our base price. A Fabricut level reads the item's Customer Alias & Pricing box instead, for the items that carry one.">
                        <span style={{ fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', color: theme.inkSoft }}>Prices at</span>
                        <select value={custLevel} onChange={e => saveCustLevel(e.target.value)} disabled={saving}
                            style={{ ...fld, minWidth: '210px', borderColor: custLevel && custLevel !== 'STANDARD' ? theme.brass : theme.line }}>
                            {PRICE_LEVELS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                        </select>
                    </label>
                )}
                <div style={{ display: 'flex', border: `1px solid ${theme.line}` }}>
                    {[['COLLECTION', 'Collection'], ['FEES', '💲 Fees & Add-ons'], ['KITS', '📦 Kit Builder'], ['CHECKOUT', '🛒 Checkout Items'], ['PLATES', '🔗 Plate Pricing'], ['ARMS', '🦾 Arms & Returns']].map(([k, l]) => (
                        <button key={k} onClick={() => { setMode(k); setEdits({}); setSearch(''); }} title={k === 'FEES' ? 'The brand\'s fee catalogue — rush, packaging, shipping, returns, colour upcharges. Fees are not collection-scoped, so they all show here.' : k === 'KITS' ? 'Kit records — a customer part# wrapping component items (the 4ft traverse starter). Build the kit, its contents, and the customer\'s SKU/pricing in one place. Shop documents always see the exploded components, never the kit.' : k === 'ARMS' ? 'Which bracket arms and return fees carry a free backplate in their price. Everything does by default — untick the exceptions.' : k === 'PLATES' ? 'Backplate / cover-plate pricing roles for the whole brand at once — which plates ride free with the arm, and what the upgrade costs painted vs premium.' : k === 'CHECKOUT' ? 'What the CPQ checkout screen offers as add-on lines — fees OR real items. Only ticked items appear there.' : 'Parts carrying the chosen collection'} style={{ padding: '11px 15px', background: mode === k ? theme.ink : '#fff', color: mode === k ? '#fff' : theme.inkSoft, border: 'none', borderLeft: k === 'COLLECTION' ? 'none' : `1px solid ${theme.line}`, cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' }}>{l}</button>
                    ))}
                </div>
                <select value={coll} onChange={e => { setColl(e.target.value); setEdits({}); }} title={mode === 'FEES' ? 'In Fees mode this does not filter the list (fees are brand-wide) — it is the collection a NEW fee gets tagged into.' : 'Parts carrying this collection'} style={{ ...fld, minWidth: '220px' }}>
                    <option value="">{mode === 'FEES' ? '— tag new fees into… (optional) —' : '— pick a collection —'}</option>
                    {allCollections.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                {(coll || mode !== 'COLLECTION') && (
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

                    {/* THE BRAND-WIDE REFRESH — moved out of the Master Library item editor (Stuart
                        2026-08-22). Adopt above only fills items with NO row and is scoped to the
                        collection on screen; this one rewrites EVERY row from the pricing box across
                        the brand, which is what you want after a sheet re-import and what you never
                        want by accident. Shown for the accounts that have a pricing box at all. */}
                    {legacySrc && custId && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', background: theme.paper2, border: `1px solid ${theme.line}`, padding: '12px 18px' }}>
                            <span style={{ fontSize: '0.85rem', color: theme.inkSoft, flex: 1, minWidth: '360px' }}>
                                Sheet re-imported? <b>Refresh every {customer?.name} row from the {legacySrc.label}</b> — brand-wide, not just {coll || 'this collection'}, and it <b>replaces</b> rows that already exist. A /EP or /P25 item takes the plated tier; everything else takes painted.
                            </span>
                            <button onClick={refreshAllFromBox} disabled={saving} style={btn(false)}>{saving ? 'Writing…' : `⇄ Refresh ALL from the ${legacySrc.label}`}</button>
                        </div>
                    )}

                    {/* Set any pricing column across every row currently listed (Stuart 2026-08-03:
                        "why not add to the top all the fields so that we can add Base $, Their SKU,
                        Their Net $, Their Sales $, Their Retail all at once"). SEARCH first — "all
                        shown" means exactly the rows below. Nothing is written until Save. */}
                    {(() => {
                        const FIELDS = [
                            { k: 'basePrice', label: 'Base $', w: '90px' },
                            { k: 'clientSku', label: 'Their SKU', w: '130px' },
                            { k: 'price', label: 'Their Net $', w: '100px' },
                            { k: 'clientSalesPrice', label: 'Their Sales $', w: '100px' },
                            { k: 'clientRetailPrice', label: 'Their Retail $', w: '100px' },
                        ];
                        const filled = FIELDS.filter(f => String(bulkVals[f.k] ?? '').trim() !== '');
                        const applyPricing = () => setEdits(prev => {
                            const next = { ...prev };
                            rows.forEach(r => {
                                const e = { ...(next[r.p.id] || {}) };
                                filled.forEach(f => { e[f.k] = bulkVals[f.k]; });
                                next[r.p.id] = e;
                            });
                            return next;
                        });
                        const needsCustomer = filled.some(f => f.k !== 'basePrice');
                        return (
                            <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '12px 18px', display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                <span style={{ fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: theme.inkSoft, alignSelf: 'center' }}>Set on all {rows.length} shown</span>
                                {FIELDS.map(f => (
                                    <label key={f.k} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        <span style={{ fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.06em', color: theme.inkSoft }}>{f.label}</span>
                                        <input value={bulkVals[f.k] ?? ''} onChange={e => setBulkVals(v => ({ ...v, [f.k]: e.target.value }))} placeholder="—" style={{ ...fld, width: f.w }} />
                                    </label>
                                ))}
                                <button onClick={applyPricing} disabled={!rows.length || !filled.length || (needsCustomer && !custId)}
                                    title={needsCustomer && !custId ? 'Pick a customer first — Their SKU / Net / Sales / Retail are per-customer' : 'Stage these values on every row listed below'}
                                    style={btn(true, { background: theme.green, borderColor: theme.green })}>
                                    Apply {filled.length ? `${filled.length} field${filled.length === 1 ? '' : 's'}` : ''}
                                </button>
                                {filled.length > 0 && <button onClick={() => setBulkVals({})} style={btn(false)}>Clear</button>}
                                <span style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.inkSoft, alignSelf: 'center' }}>
                                    Blank fields are left alone{needsCustomer && !custId ? ' · pick a customer for the per-customer columns' : ''}
                                </span>
                            </div>
                        );
                    })()}

                    {mode === 'PLATES' && (() => {
                        const applyAll = (field, value) => setEdits(prev => {
                            const next = { ...prev };
                            rows.forEach(r => { if (String(r[field] ?? '') !== String(value ?? '')) next[r.p.id] = { ...(next[r.p.id] || {}), [field]: value }; });
                            return next;
                        });
                        // ⚙ SEED (Stuart 2026-08-11): make the engine's implicit fallbacks EXPLICIT data —
                        // BP-coded plates → INCLUDED, CP-coded → UPGRADE with the pairing written out
                        // (the same grammar pairedBackplateCode uses), and a blank "Priced in conjunction
                        // with" gets the rule sentence. Stages into the edit buffer; Save commits.
                        const seedRules = () => {
                            const stage = {}; let roles = 0, pairs = 0, texts = 0;
                            rows.forEach(r => {
                                const isCP = /(^|[^A-Z])CP(?=$|[^A-Z0-9])/.test(r.code);
                                const isBP = !isCP && /(^|[^A-Z])BP(?=$|[^A-Z0-9])/.test(r.code);
                                if (!isCP && !isBP) return;
                                const e = {};
                                const want = isCP ? 'UPGRADE' : 'INCLUDED';
                                if ((r.plateRole || '') !== want) { e.plateRole = want; roles++; }
                                if (isCP && !String(r.plateUpgradeOf || '').trim() && r.derivedPair) { e.plateUpgradeOf = r.derivedPair; pairs++; }
                                if (!String(r.p.manufacturingSpecs?.fabricut?.pricedWith || '').trim() && edits[r.p.id]?.pricedWith === undefined) {
                                    e.pricedWith = isCP
                                        ? `Cover plate — upgrade over ${String(r.plateUpgradeOf || '').trim() || r.derivedPair || 'its backplate'}: bills the upcharge only, the arm/return still covers the plate; the BOM carries this cover plate instead of the backplate.`
                                        : 'Backplate — included with the bracket arm or french/miter return ($0 on the quote). Bills at its own price only when nothing on the step includes it.';
                                    texts++;
                                }
                                if (Object.keys(e).length) stage[r.p.id] = e;
                            });
                            if (!Object.keys(stage).length) return alert('Nothing to seed — every plate shown already carries its role, pairing and rule text.');
                            setEdits(prev => { const next = { ...prev }; Object.entries(stage).forEach(([id, e]) => { next[id] = { ...(next[id] || {}), ...e }; }); return next; });
                            alert(`Staged on ${Object.keys(stage).length} plate(s) — NOTHING SAVED YET:\n\n• ${roles} role(s): BP → INCLUDED, CP → UPGRADE\n• ${pairs} explicit CP→BP pairing(s) written from the code convention\n• ${texts} blank "Priced in conjunction with" field(s) filled with the rule sentence\n\nUpcharge $ fields are NOT seeded — blank keeps the live CP−BP difference; type a figure to freeze it. Review the rows, then press Save.`);
                        };
                        const declared = members.filter(p => plateRoleOf(p)).length;
                        return (
                            <div style={{ background: theme.paper2, border: `1px solid ${theme.line}`, padding: '14px 18px' }}>
                                <div style={{ fontSize: '0.88rem', color: theme.ink, marginBottom: '10px' }}>
                                    The arm's price has always covered its backplate; the cover plate is the paid upgrade. Declare it once here and the quote says so at <b>every</b> price level.
                                    <span style={{ display: 'block', color: theme.inkSoft, marginTop: '4px' }}>
                                        <b>Premium</b> is the /EP and /P25 tier — leave it blank and the painted figure is used for both. Leave <b>Upgrade over</b> blank and the pairing is read from the code ({'H1-1CP-R → H1-1BP-R'}). A plate with no role is priced exactly as it is today.
                                        {' '}<b style={{ color: theme.brassDark }}>{declared} of {members.length} plates declared.</b>
                                    </span>
                                </div>
                                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', borderTop: `1px solid ${theme.line}`, paddingTop: '12px' }}>
                                    <span style={{ fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: theme.inkSoft }}>Apply to all {rows.length} shown</span>
                                    <button onClick={seedRules} disabled={!rows.length} style={btn(true, { background: theme.brass, borderColor: theme.brass })} title="BP-coded plates → INCLUDED · CP-coded → UPGRADE with the pairing written out explicitly · blank rule text composed. Staged for review; Save commits.">⚙ Seed rules from item codes</button>
                                    <span style={{ width: '1px', height: '22px', background: theme.line }} />
                                    <button onClick={() => applyAll('plateRole', 'INCLUDED')} disabled={!rows.length} style={btn(false)}>Backplate — included</button>
                                    <button onClick={() => applyAll('plateRole', 'UPGRADE')} disabled={!rows.length} style={btn(false)}>Cover plate — upgrade</button>
                                    <button onClick={() => applyAll('plateRole', '')} disabled={!rows.length} style={btn(false)}>Clear role</button>
                                    <span style={{ width: '1px', height: '22px', background: theme.line }} />
                                    <input placeholder="upcharge $" value={bulkUp} onChange={e => setBulkUp(e.target.value)} style={{ ...fld, width: '110px' }} />
                                    <input placeholder="premium $" value={bulkUpPrem} onChange={e => setBulkUpPrem(e.target.value)} style={{ ...fld, width: '110px' }} />
                                    <button onClick={() => { if (bulkUp !== '') applyAll('plateUpcharge', bulkUp); if (bulkUpPrem !== '') applyAll('plateUpchargePremium', bulkUpPrem); }}
                                        disabled={!rows.length || (bulkUp === '' && bulkUpPrem === '')} style={btn(true, { background: theme.brass, borderColor: theme.brass })}>Set on all shown</button>
                                </div>
                                <div style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.inkSoft, marginTop: '8px', letterSpacing: '.04em' }}>
                                    Nothing is written until you press Save — search first to narrow what "all shown" means.
                                </div>
                            </div>
                        );
                    })()}

                    {mode === 'ARMS' && (() => {
                        const off = members.filter(p => !includesPlate(p)).length;
                        // Only stage rows that would actually CHANGE — otherwise the Save button
                        // announces "785 changes" for a press that alters nothing, and a count you
                        // cannot trust is worse than no count.
                        const applyAll = (v) => setEdits(prev => {
                            const next = { ...prev };
                            rows.forEach(r => { if (includesPlate(r.p) !== v) next[r.p.id] = { ...(next[r.p.id] || {}), carriesPlate: v }; });
                            return next;
                        });
                        return (
                            <div style={{ background: theme.paper2, border: `1px solid ${theme.line}`, padding: '14px 18px' }}>
                                <div style={{ fontSize: '0.88rem', color: theme.ink }}>
                                    This is the other half of the plate rule: <b>which arms and returns carry a free backplate</b>. A miter or french return is a fee item — it shows here too, so a return can include its plate exactly like an arm does.
                                    <span style={{ display: 'block', color: theme.inkSoft, marginTop: '4px' }}>
                                        Everything is included <b>by default</b>, because that is how the catalogue has always worked — untick only the exceptions. Unticking makes that arm's plate bill at its own price, and the quote line says which arm declined to cover it.
                                        {' '}<b style={{ color: off ? theme.red : theme.brassDark }}>{off === 0 ? 'No exceptions set — every arm and return covers its plate.' : `${off} exception${off === 1 ? '' : 's'} set.`}</b>
                                    </span>
                                </div>
                                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', borderTop: `1px solid ${theme.line}`, paddingTop: '12px', marginTop: '12px' }}>
                                    <span style={{ fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: theme.inkSoft }}>Apply to all {rows.length} shown</span>
                                    <button onClick={() => applyAll(true)} disabled={!rows.length} style={btn(false)}>✓ Includes its plate</button>
                                    <button onClick={() => applyAll(false)} disabled={!rows.length} style={btn(false)}>✕ Does not include</button>
                                    <span style={{ width: '1px', height: '22px', background: theme.line }} />
                                    <button disabled={!rows.length} style={btn(false)} title='Fills a BLANK "Priced in conjunction with" on every arm/return shown with its rule sentence (covers its plate / exception). Staged; Save commits.' onClick={() => {
                                        const stage = {};
                                        rows.forEach(r => {
                                            if (String(r.p.manufacturingSpecs?.fabricut?.pricedWith || '').trim() || edits[r.p.id]?.pricedWith !== undefined) return;
                                            stage[r.p.id] = { ...(edits[r.p.id] || {}), pricedWith: r.carriesPlate
                                                ? `Covers its backplate — the plate rides at $0 with this ${r.isFeeRec ? 'return' : 'arm'}; a cover plate bills only its upcharge.`
                                                : `EXCEPTION — this ${r.isFeeRec ? 'return' : 'arm'} does not cover its plate; the plate bills at its own price.` };
                                        });
                                        if (!Object.keys(stage).length) return alert('Nothing to seed — every arm/return shown already has rule text.');
                                        setEdits(prev => ({ ...prev, ...stage }));
                                        alert(`Staged rule text on ${Object.keys(stage).length} arm(s)/return(s) with a blank "Priced in conjunction with" — press Save to commit.`);
                                    }}>⚙ Seed rule text (blank only)</button>
                                </div>
                            </div>
                        );
                    })()}

                    {mode === 'CHECKOUT' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', background: theme.paper2, border: `1px solid ${theme.line}`, padding: '14px 18px' }}>
                            <span style={{ fontSize: '0.88rem', color: theme.ink, flex: 1, minWidth: '420px' }}>
                                Checkout items are assigned in <b>two homes</b>. <b style={{ color: theme.brassDark }}>Customer-specific</b> items live HERE: pick the customer, tick the <b>For&nbsp;{customer?.name ? String(customer.name).split(/\s+/)[0] : 'customer'}</b> column, and set their price on this same row — they then appear for that customer on <b>CPQ checkout and Quick Ship order entry</b>, priced by their row. <b>Standard</b> items that appear regardless of customer are set per flow on <b>tab&nbsp;11</b> (the flow's "Checkout items" list); the <b>Std</b> column here is the item-wide tick that shows on every flow. Anything a flow already decides (a french return, a cover-plate upcharge) should stay unticked everywhere: CPQ charges those itself, and offering them again double-bills.
                                <span style={{ display: 'block', color: theme.inkSoft, marginTop: '4px' }}>
                                    To add something new, <b>search</b> — that searches the whole library — then tick it and Save. A real item added this way stays a real part on the quote: its own NetSuite line, routed by its own Part Handling.
                                    {' '}<b style={{ color: theme.brassDark }}>{inventory.filter(isCheckoutSelectable).length} standard{custId ? ` · ${inventory.filter(p => isCheckoutForCustomer(p, custId)).length} for ${String(customer?.name || 'this customer').split(/\s+/)[0]}` : ''}.</b>
                                    {inventory.filter(isCheckoutSelectable).length === 0 && <span style={{ color: theme.red }}> Until at least one is ticked, checkout falls back to showing every fee — which is what you're seeing now.</span>}
                                </span>
                            </span>
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

                    {mode === 'KITS' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', background: theme.paper2, border: `1px solid ${theme.line}`, padding: '14px 18px' }}>
                            <button onClick={() => { setKitSearch(''); setNewKit({ code: '', name: '', basePrice: '', theirSku: '', theirNet: '', theirSales: '', components: [] }); }} style={btn(true, { background: theme.green, borderColor: theme.green })}>＋ New kit</button>
                            <input ref={kitFileRef} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={e => { onKitSheetFile(e.target.files[0]); e.target.value = ''; }} />
                            <button onClick={() => kitFileRef.current?.click()} disabled={!custId || !!busy} title="Read a traverse kit workbook (Fabricut_Traverse.xlsx shape) and preview what it would create/update — kit records, component pricing, and the per-length usage rules. Nothing is written until you apply." style={btn(false)}>⬆ Import kit sheet</button>
                            <span style={{ fontSize: '0.88rem', color: theme.ink, flex: 1, minWidth: '420px' }}>
                                A kit is the <b>sales face of a set</b> — a customer part# wrapping real component items (the 4ft traverse starter: fascia + track + 2 brackets). Give {customer?.name || 'the customer'} their SKU and pricing on the row, exactly like any item.
                                <span style={{ display: 'block', color: theme.inkSoft, marginTop: '4px' }}>
                                    The <b>BOM, shop floor and finishing floor never see the kit</b> — orders explode to its contents summed with everything else (a 4ft set + 3 more feet reads as one 7ft pole and track). ⚙ Contents opens the component list; contents are item metadata, shared by every customer.
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
                                    {mode === 'ARMS' && <th style={{ ...th, textAlign: 'center', width: '120px', borderLeft: `2px solid ${theme.ink}` }} title="Ticked = this arm or return's price already covers its backplate, so the plate quotes at $0. Unticked = the plate bills on its own.">Includes&nbsp;plate</th>}
                                    {mode === 'PLATES' && <>
                                        <th style={{ ...th, borderLeft: `2px solid ${theme.ink}`, width: '210px' }} title="How this plate prices in a quote. None = exactly as today.">Plate role</th>
                                        <th style={th} title="The backplate this cover plate replaces. Blank = derived from the code.">Upgrade over</th>
                                        <th style={{ ...th, textAlign: 'right' }} title="Flat upcharge for choosing this cover plate. Blank = this plate's base minus the backplate's.">Upcharge $</th>
                                        <th style={{ ...th, textAlign: 'right' }} title="The /EP and /P25 premium tier. Blank = same as the painted upcharge.">Premium $</th>
                                    </>}
                                    {mode === 'CHECKOUT' && <>
                                        <th style={{ ...th, textAlign: 'center', width: '64px' }} title="STANDARD — ticked = offered on every flow's checkout for every customer (collection-scoped). Flow-specific standard items are set on the flow itself, tab 11.">Std<br/>(all)</th>
                                        <th style={{ ...th, textAlign: 'center', width: '86px', color: theme.brass }} title={custId ? `Ticked = offered to ${customer?.name || 'this customer'} at CPQ checkout AND on Quick Ship order entry — fees and real items both. This is the per-customer assignment; their price comes from their row on this same screen.` : 'Pick a customer to assign checkout items to them.'}>{custId ? `For ${String(customer?.name || 'customer').split(/\s+/)[0]}` : 'For customer'}</th>
                                    </>}
                                    {mode === 'KITS' && <th style={{ ...th, borderLeft: `2px solid ${theme.ink}`, width: '150px' }} title="The component items ONE kit wraps — what an order explodes to on every shop document. Item metadata, shared by every customer.">Contents</th>}
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
                                        {mode === 'ARMS' && (
                                            <td style={{ ...td, textAlign: 'center', borderLeft: `2px solid ${theme.ink}` }}>
                                                <input type="checkbox" checked={!!r.carriesPlate} onChange={e => setEdit(r.p.id, 'carriesPlate', e.target.checked)} style={{ cursor: 'pointer', width: '16px', height: '16px' }} />
                                                <div style={{ fontFamily: theme.mono, fontSize: '9px', color: r.isFeeRec ? theme.brassDark : theme.inkSoft, marginTop: '3px' }}>{r.isFeeRec ? 'RETURN / FEE' : 'ARM'}</div>
                                            </td>
                                        )}
                                        {mode === 'PLATES' && <>
                                            <td style={{ ...td, borderLeft: `2px solid ${theme.ink}` }}>
                                                <select value={r.plateRole || ''} onChange={e => setEdit(r.p.id, 'plateRole', e.target.value)} style={{ ...cellInput(edits[r.p.id]?.plateRole !== undefined), width: '200px', textAlign: 'left' }}>
                                                    {PLATE_ROLES.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                                                </select>
                                            </td>
                                            <td style={td}>
                                                <input value={r.plateUpgradeOf} onChange={e => setEdit(r.p.id, 'plateUpgradeOf', e.target.value.toUpperCase())} disabled={r.plateRole !== 'UPGRADE'} placeholder={r.derivedPair || '—'} title={r.derivedPair ? `Blank uses ${r.derivedPair}, read from this item's code` : 'No pairing can be derived from this code — name it here'} style={{ ...cellInput(edits[r.p.id]?.plateUpgradeOf !== undefined), width: '140px', textAlign: 'left', background: r.plateRole !== 'UPGRADE' ? theme.paper2 : '#fff' }} />
                                            </td>
                                            <td style={{ ...td, textAlign: 'right' }}>
                                                <input value={r.plateUpcharge} onChange={e => setEdit(r.p.id, 'plateUpcharge', e.target.value)} disabled={r.plateRole !== 'UPGRADE'} placeholder={r.plateRole === 'UPGRADE' ? 'diff' : '—'} style={{ ...cellInput(edits[r.p.id]?.plateUpcharge !== undefined), width: '72px', background: r.plateRole !== 'UPGRADE' ? theme.paper2 : '#fff' }} />
                                            </td>
                                            <td style={{ ...td, textAlign: 'right' }}>
                                                <input value={r.plateUpchargePremium} onChange={e => setEdit(r.p.id, 'plateUpchargePremium', e.target.value)} disabled={r.plateRole !== 'UPGRADE'} placeholder={r.plateRole === 'UPGRADE' ? 'same' : '—'} style={{ ...cellInput(edits[r.p.id]?.plateUpchargePremium !== undefined), width: '72px', background: r.plateRole !== 'UPGRADE' ? theme.paper2 : '#fff' }} />
                                            </td>
                                        </>}
                                        {mode === 'CHECKOUT' && <>
                                            <td style={{ ...td, textAlign: 'center' }}>
                                                <input type="checkbox" checked={!!r.checkout} onChange={e => setEdit(r.p.id, 'checkout', e.target.checked)} title={r.checkout ? 'Standard — on every flow’s checkout' : 'Not a standard checkout item'} style={{ cursor: 'pointer', width: '16px', height: '16px' }} />
                                                <div style={{ fontFamily: theme.mono, fontSize: '9px', color: r.isFeeRec ? theme.brassDark : theme.inkSoft, marginTop: '3px' }}>{r.isFeeRec ? 'FEE' : 'ITEM'}</div>
                                            </td>
                                            <td style={{ ...td, textAlign: 'center' }}>
                                                <input type="checkbox" checked={!!r.checkoutCust} disabled={!custId} onChange={e => setEdit(r.p.id, 'checkoutCust', e.target.checked)}
                                                    title={!custId ? 'Pick a customer first' : r.checkoutCust ? `Offered to ${customer?.name || 'this customer'} — CPQ checkout and Quick Ship order entry` : `Not assigned to ${customer?.name || 'this customer'}`}
                                                    style={{ cursor: custId ? 'pointer' : 'not-allowed', width: '16px', height: '16px', accentColor: '#b08d57' }} />
                                                {checkoutCustomerIds(r.p).length > 0 && (
                                                    <div style={{ fontFamily: theme.mono, fontSize: '8px', color: theme.brassDark, marginTop: '3px' }} title="How many customers this item is assigned to">{checkoutCustomerIds(r.p).length} cust</div>
                                                )}
                                            </td>
                                        </>}
                                        {mode === 'KITS' && (() => {
                                            const comps = r.p.manufacturingSpecs?.kitComponents || [];
                                            const aligned = !!r.p.manufacturingSpecs?.kitAlign;
                                            const nFin = (r.p.manufacturingSpecs?.kitFinishOptions || []).length;
                                            const open = kitRow === r.p.id;
                                            // Empty contents are NORMAL on a flow-aligned kit — its components come
                                            // from the rules explosion. Only a hand-built kit with nothing inside is
                                            // a problem worth painting red.
                                            const bad = !comps.length && !aligned;
                                            return (
                                                <td style={{ ...td, borderLeft: `2px solid ${theme.ink}`, whiteSpace: 'nowrap' }}>
                                                    <button onClick={() => { if (open) { setKitRow(null); setKitEditRows([]); setKitFinSel({}); } else { setKitEditRows(comps.map(c => ({ ...c }))); setKitSearch(''); setKitFinSel(Object.fromEntries((r.p.manufacturingSpecs?.kitFinishOptions || []).map(c => [String(c).toUpperCase(), true]))); setKitRow(r.p.id); } }}
                                                        title={aligned ? 'Flow-aligned kit — components explode from the traverse rules at order time. Open to set its FINISH matrix (and any extra fixed contents).' : 'Open the component list — what ONE kit explodes to on shop documents'}
                                                        style={{ background: bad ? 'rgba(176,45,32,.08)' : 'none', border: `1px solid ${bad ? theme.red : theme.line}`, color: bad ? theme.red : theme.inkSoft, cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', padding: '5px 9px' }}>
                                                        {open ? '⚙ Close' : aligned ? `⚙ flow · ${nFin ? `${nFin} fin` : 'no fin'}` : `⚙ ${comps.length} item${comps.length === 1 ? '' : 's'}`}
                                                    </button>
                                                </td>
                                            );
                                        })()}
                                        <td style={{ ...td, whiteSpace: 'nowrap', fontWeight: 600 }}>{r.code}
                                            {r.aliasCodes.length > 0 && <span title={`Customer-facing alias code${r.aliasCodes.length > 1 ? 's' : ''} pointing at this item — quotes and the portal show the alias; the data you edit here lives on THIS main record (the one the engine reads).`} style={{ marginLeft: '8px', fontSize: '10px', color: theme.inkSoft, fontWeight: 600 }}>⤿ {r.aliasCodes.join(' · ')}</span>}
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
                                        <td colSpan={mode === 'FEES' ? 13 : mode === 'CHECKOUT' ? 9 : mode === 'PLATES' ? 12 : mode === 'ARMS' ? 9 : mode === 'KITS' ? 9 : 8} style={{ padding: '18px 22px', background: 'rgba(176,141,87,.07)', borderBottom: `1px solid ${theme.line}` }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
                                                <span style={{ fontFamily: theme.serif, fontSize: '1.15rem', color: theme.ink }}>Customer Alias &amp; Pricing — {r.code}</span>
                                                <span style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft }}>drives the CPQ price levels · blank = no price at that tier</span>
                                            </div>
                                            {(() => {
                                                // Resolved pattern # — the code Fabricut actually sees, through the SAME
                                                // resolver quotes and spec sheets use.
                                                const byCode = new Map(); inventory.forEach(x => { [x.legacyErpId, x.itemId].forEach(c => { const k = upper(c); if (k && k !== 'PENDING' && !byCode.has(k)) byCode.set(k, x); }); });
                                                const preview = { ...r.p, manufacturingSpecs: { ...(r.p.manufacturingSpecs || {}), fabricut: { ...(r.p.manufacturingSpecs?.fabricut || {}), fabCodePainted: tierEdit.fabCodePainted || undefined, fabCodePremium: tierEdit.fabCodePremium || undefined, fabCodeBase: tierEdit.fabCodeBase || undefined } } };
                                                const resolved = fabricutCodeOf(preview, (c) => byCode.get(upper(c)) || null, outsourceFinishes);
                                                return resolved ? <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.ink, marginBottom: '12px' }}>Resolved pattern #: <b>{resolved}</b>{r.code.includes('/') ? <span style={{ color: theme.inkSoft }}> (codes live on the base item)</span> : null}</div> : null;
                                            })()}
                                            {TIER_GROUPS.map(g => {
                                                const incl = !!tierEdit[`incl_${g.key}`];
                                                return (
                                                <div key={g.label} style={{ display: 'flex', alignItems: 'flex-end', gap: '14px', marginBottom: '10px', flexWrap: 'wrap' }}>
                                                    <span style={{ width: '250px', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.06em', color: theme.inkSoft }}>{g.label}</span>
                                                    {TIER_FIELDS.filter(f => f.group === g.label).map(f => (
                                                        <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                            <span style={{ fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', color: theme.inkSoft }}>{f.label}</span>
                                                            <input value={tierEdit[f.key] ?? ''} disabled={incl} onChange={e => setTierEdit(prev => ({ ...prev, [f.key]: e.target.value }))} placeholder="—" style={{ width: '96px', padding: '6px 7px', textAlign: 'right', fontFamily: theme.mono, fontSize: '12px', fontWeight: 600, border: `1px solid ${theme.line}`, outline: 'none', opacity: incl ? 0.4 : 1 }} />
                                                        </label>
                                                    ))}
                                                    <label title="Explicit $0 — this tier is priced in conjunction with the arm (the arm price covers it). Different from BLANK, which means no price at this tier (falls back to standard)." style={{ display: 'flex', alignItems: 'center', gap: '6px', fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.05em', color: incl ? theme.brass : theme.inkSoft, cursor: 'pointer', paddingBottom: '10px', whiteSpace: 'nowrap' }}>
                                                        <input type="checkbox" checked={incl} onChange={e => setTierEdit(prev => ({ ...prev, [`incl_${g.key}`]: e.target.checked }))} /> $0 · w/ arm
                                                    </label>
                                                </div>
                                                );
                                            })}
                                            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '14px', marginTop: '4px', flexWrap: 'wrap' }}>
                                                <span style={{ width: '250px', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.06em', color: theme.inkSoft }}>Priced in conjunction with…</span>
                                                <input value={tierEdit.pricedWith ?? ''} onChange={e => setTierEdit(prev => ({ ...prev, pricedWith: e.target.value }))} placeholder="e.g. Priced in conjunction with H1 bracket arms" style={{ flex: 1, minWidth: '320px', padding: '6px 8px', fontFamily: theme.sans, fontSize: '0.85rem', border: `1px solid ${theme.line}`, outline: 'none' }} />
                                            </div>
                                            {(() => {
                                                // ⚙ THE EFFECTIVE RULE (Stuart 2026-08-11: "key parts are still hiding in
                                                // coding rather than referring to the table in 4.6"). Composed from the SAME
                                                // fields and helpers the CPQ engine runs (Shared/plateRules) — this line IS
                                                // what the quote does for this item, including the code-derived fallbacks the
                                                // engine uses when a field is blank. Roles/pairings/upcharges are edited in
                                                // the Plate Rules and Arms & Returns modes above; "Use as rule text" copies
                                                // the sentence into "Priced in conjunction with" so the record says it too.
                                                const ms = r.p.manufacturingSpecs || {};
                                                const pt = String(ms.productType || '').toUpperCase();
                                                const isPlate = /PLATE/.test(pt);
                                                const isCarrier = /BRACKET|ARM/.test(pt) || r.isFeeRec;
                                                let text = '', warn = false;
                                                if (isPlate && r.plateRole === 'INCLUDED') {
                                                    text = 'Backplate — INCLUDED: $0 whenever the step carries a bracket arm or a french/miter return (its price lives in the arm). Bills at its own price only when nothing includes it.';
                                                } else if (isPlate && r.plateRole === 'UPGRADE') {
                                                    const pair = String(r.plateUpgradeOf || '').trim() || r.derivedPair;
                                                    const pairSrc = String(r.plateUpgradeOf || '').trim() ? 'explicit' : 'derived from the code — set it explicitly to be safe';
                                                    const bp = pair ? byCode.get(upper(pair)) : null;
                                                    const bpBase = bp ? parseFloat(bp.manufacturingSpecs?.basePrice ?? bp.basePrice) : NaN;
                                                    const ownBase = parseFloat(ms.basePrice ?? r.p.basePrice);
                                                    const up = String(r.plateUpcharge ?? '').trim();
                                                    const upP = String(r.plateUpchargePremium ?? '').trim();
                                                    const upTxt = up !== ''
                                                        ? `flat $${up} painted / $${upP !== '' ? upP : up} premium (explicit)`
                                                        : (Number.isFinite(bpBase) && Number.isFinite(ownBase)
                                                            ? `live difference: $${Math.max(0, ownBase - bpBase).toFixed(2)} today (own $${ownBase.toFixed(2)} − ${pair} $${bpBase.toFixed(2)}) — computed per quote, moves with base prices`
                                                            : 'live difference — but the paired backplate could not be resolved, so it BILLS IN FULL');
                                                    warn = !pair || (!up && !(Number.isFinite(bpBase) && Number.isFinite(ownBase)));
                                                    text = `Cover plate — UPGRADE over ${pair || '??'} (${pairSrc}): bills the upcharge only, the arm/return still covers the plate; the BOM carries this cover plate instead of the backplate. Upcharge: ${upTxt}.`;
                                                } else if (isPlate) {
                                                    warn = true;
                                                    text = 'NO plate rule declared — the engine prices this plate at its full price on every quote. Declare it in the Plate Rules mode (or Seed rules from item codes).';
                                                } else if (isCarrier) {
                                                    text = r.carriesPlate
                                                        ? `Covers its backplate — the plate rides at $0 with this ${r.isFeeRec ? 'return' : 'arm'}; a cover plate bills only its upcharge.`
                                                        : `EXCEPTION — this ${r.isFeeRec ? 'return' : 'arm'} does NOT cover its plate; the plate bills at its own price and the quote line says so.`;
                                                    warn = !r.carriesPlate;
                                                }
                                                if (!text) return null;
                                                return (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px', flexWrap: 'wrap' }}>
                                                        <span style={{ width: '250px', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.06em', color: theme.inkSoft }}>⚙ Effective engine rule</span>
                                                        <span style={{ flex: 1, minWidth: '320px', fontFamily: theme.mono, fontSize: '11px', lineHeight: 1.5, color: warn ? theme.red : theme.brassDark }}>{text}</span>
                                                        <button onClick={() => setTierEdit(prev => ({ ...prev, pricedWith: text }))} style={btn(false)} title='Copy this sentence into "Priced in conjunction with" (saved with Save tiers).'>Use as rule text</button>
                                                    </div>
                                                );
                                            })()}
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
                                            {/* Seed the row + alias control — the two actions that used to live only in the
                                                Master Library drawer (pivot phase B: 4.6 is the control surface). */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '14px', paddingTop: '12px', borderTop: `1px dashed ${theme.line}`, flexWrap: 'wrap' }}>
                                                <button onClick={() => seedRowFromTiers(r.p)} style={btn(true)} title={`Write/refresh ${customer?.name || 'the customer'}'s clientPricing row from these tiers — SKU = pattern #, price = cost, sales = wholesale. Keyed by the CRM doc id.`}>↑ Seed {customer?.name || 'customer'} row from tiers</button>
                                                {(() => {
                                                    const al = aliasesOf(r.p);
                                                    return (
                                                        <span style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                            <span style={{ fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', color: theme.inkSoft }}>Alias{al.length !== 1 ? 'es' : ''}:</span>
                                                            {al.length
                                                                ? al.map(a => <span key={a.id} title={`${a.itemName || ''}${(a.manufacturingSpecs?.collections || []).length ? ` · ${(a.manufacturingSpecs.collections || []).join(', ')}` : ''}${a.netSuiteInternalId ? ' · ⚠ HAS A NETSUITE ID — an alias must not; it would push as itself' : ''}`} style={{ fontFamily: theme.mono, fontSize: '11px', padding: '3px 8px', border: `1px solid ${a.netSuiteInternalId ? '#b00020' : theme.line}`, color: a.netSuiteInternalId ? '#b00020' : theme.ink }}>{a.legacyErpId || a.itemId}</span>)
                                                                : <span style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>none — quotes show the CE code</span>}
                                                            <button onClick={() => createAlias(r.p)} style={btn(false)} title={`Create the customer-facing item # for this part${coll ? ` in ${coll}` : ''} — quotes and the portal show it; the floor and NetSuite keep the real code. Never gets a NetSuite id.`}>＋ Alias</button>
                                                        </span>
                                                    );
                                                })()}
                                            </div>
                                            <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, marginTop: '12px', lineHeight: 1.6 }}>
                                                A BASE (mill) item carries the painted and plated tiers — its variants inherit them. A VARIANT or single-finish item carries its own price on the third row. Pattern #s live on the base item; a variant resolves to the premium code when its finish is outsourced (/EP* and /P25). BLANK = no price at that tier (standard pricing) · $0 · w/ arm = explicit $0, the arm carries the value.
                                            </div>
                                        </td>
                                    </tr>
                                ) : null, kitRow === r.p.id ? (
                                    <tr key={r.p.id + '-kit'}>
                                        <td colSpan={9} style={{ padding: '18px 22px', background: 'rgba(176,141,87,.07)', borderBottom: `1px solid ${theme.line}` }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
                                                <span style={{ fontFamily: theme.serif, fontSize: '1.15rem', color: theme.ink }}>Kit contents — {r.code}</span>
                                                <span style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft }}>what ONE kit explodes to · item metadata, shared by every customer</span>
                                            </div>
                                            {!!(inventory.find(x => x.id === kitRow)?.manufacturingSpecs?.kitAlign) && (
                                                <div style={{ fontSize: '0.82rem', color: theme.inkSoft, fontStyle: 'italic', marginBottom: '8px' }}>
                                                    Flow-aligned kit — empty contents are correct: the order explodes from the traverse rules (fascia, track, brackets by length). Anything added here rides ON TOP of that explosion.
                                                </div>
                                            )}
                                            {/* ── ADDITIONAL-FOOT PRICING, THIS CUSTOMER (Stuart 2026-08-27: "we imported
                                                these all at once with an extra per foot price, i can't find where to
                                                maintain that") — the kit-sheet import stamps this triple on the customer's
                                                Client Pricing row; this is its editor. Tab 7's "Additional foot" line
                                                bills at the NET figure for feet beyond the kit's base length. */}
                                            <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap', margin: '4px 0 14px', padding: '10px 14px', border: `1px dashed ${theme.line}`, background: '#fff' }}>
                                                <span style={{ fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: theme.inkSoft, flexBasis: '100%' }}>
                                                    Additional foot — {customer?.name || 'this customer'} (beyond the kit's base length; NET is what tab 7 bills)
                                                </span>
                                                {[['perFootPrice', 'Net $/ft'], ['perFootSales', 'Sales $/ft'], ['perFootRetail', 'Retail $/ft']].map(([k, label]) => (
                                                    <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                                        <span style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.inkSoft }}>{label}</span>
                                                        <input value={r[k] ?? ''} onChange={ev => setEdit(r.p.id, k, ev.target.value)}
                                                            placeholder="—" style={{ width: '90px', padding: '6px 8px', border: `1px solid ${r.dirty ? theme.brass : theme.line}`, fontFamily: theme.mono, fontSize: '12px', textAlign: 'right' }} />
                                                    </label>
                                                ))}
                                                <span style={{ fontSize: '0.78rem', color: theme.inkSoft, fontStyle: 'italic' }}>Saves with 💾 like every other price on this page.</span>
                                            </div>
                                            {kitContentsEditor(kitEditRows, setKitEditRows)}
                                            {(() => {
                                                // FINISH MATRIX (Stuart 2026-08-13): check off which finishes THIS kit
                                                // may be ordered in — the CPQ-flow checkbox model, not code rules.
                                                // Quick Ship's finish dropdown reads exactly this list.
                                                // code falls back to NAME — the finishText convention. EP3–EP6 live in
                                                // hq_outsource_finishes name-only, and filtering on f.code dropped them
                                                // (Stuart 2026-08-13: "i do not see EP3, EP4, EP5, EP6").
                                                const catalog = [...masterFin, ...outsourceFinishes.filter(f => f && (f.code || f.name)).map(f => ({ code: upper(f.code || f.name), name: f.name || f.code, outsourced: true }))];
                                                const seen = new Set(); const cat = catalog.filter(f => !seen.has(f.code) && seen.add(f.code));
                                                const nSel = Object.values(kitFinSel).filter(Boolean).length;
                                                const kitMat = String(r.p.manufacturingSpecs?.kitAlign?.material || '').toUpperCase();
                                                const copyToMaterial = async () => {
                                                    const codes = Object.keys(kitFinSel).filter(c => kitFinSel[c]);
                                                    const targets = members.filter(m => isKitItem(m) && String(m.manufacturingSpecs?.kitAlign?.material || '').toUpperCase() === kitMat && m.id !== r.p.id);
                                                    if (!targets.length) return alert(`No other /${kitMat} kits in view.`);
                                                    if (!window.confirm(`Apply these ${codes.length} finish(es) to ${targets.length} other /${kitMat} kit(s) shown?`)) return;
                                                    const b = writeBatch(db);
                                                    targets.forEach(t => b.update(doc(db, 'Approved_Designs', t.id), { 'manufacturingSpecs.kitFinishOptions': codes, updatedAt: new Date().toISOString() }));
                                                    await b.commit();
                                                    alert(`✅ ${targets.length} /${kitMat} kit(s) now carry the same finish list.`);
                                                };
                                                return (
                                                    <div style={{ marginTop: '16px', borderTop: `1px dashed ${theme.line}`, paddingTop: '14px' }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px', gap: '10px', flexWrap: 'wrap' }}>
                                                            <span style={{ fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: theme.inkSoft }}>Finish matrix — which finishes this kit sells in ({nSel || 'none'} checked{nSel ? '' : ' = Quick Ship falls back to material rules'})</span>
                                                            <button onClick={copyToMaterial} style={{ ...btn(false), padding: '6px 12px' }} title={`Copy this exact finish list onto every other /${kitMat} kit currently shown`}>⇒ Apply to all /{kitMat} kits shown</button>
                                                        </div>
                                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '6px 14px' }}>
                                                            {cat.map(f => (
                                                                <label key={f.code} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.84rem', color: theme.ink }}>
                                                                    <input type="checkbox" checked={!!kitFinSel[f.code]} onChange={e => setKitFinSel(prev => ({ ...prev, [f.code]: e.target.checked }))} style={{ cursor: 'pointer' }} />
                                                                    <span style={{ fontFamily: theme.mono, fontSize: '12px', color: f.outsourced ? theme.blueDark : theme.ink }}>{f.code}</span>
                                                                    <span style={{ color: theme.inkSoft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                                                                </label>
                                                            ))}
                                                        </div>
                                                    </div>
                                                );
                                            })()}
                                            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '14px' }}>
                                                <button onClick={() => { setKitRow(null); setKitEditRows([]); setKitSearch(''); setKitFinSel({}); }} style={btn(false)}>Cancel</button>
                                                <button onClick={saveKitContents} style={btn(true, { background: theme.green, borderColor: theme.green })}>Save contents + finishes</button>
                                            </div>
                                        </td>
                                    </tr>
                                ) : null])}
                                {rows.length === 0 && (
                                    <tr><td colSpan={mode === 'FEES' ? 13 : mode === 'CHECKOUT' ? 9 : mode === 'PLATES' ? 12 : mode === 'ARMS' ? 9 : mode === 'KITS' ? 9 : 8} style={{ padding: '28px 36px', textAlign: 'center', fontFamily: theme.serif, fontStyle: 'italic', color: theme.inkSoft }}>
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

            {/* ＋ NEW KIT — record, contents, and the customer association in one action */}
            {newKit && (
                <div onClick={() => setNewKit(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,.72)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '28px' }}>
                    <div onClick={e => e.stopPropagation()} style={{ background: '#fff', width: '760px', maxWidth: '96vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', border: `1px solid ${theme.line}` }}>
                        <div style={{ padding: '20px 26px', borderBottom: `1px solid ${theme.line}`, background: theme.paper2 }}>
                            <div style={{ fontFamily: theme.serif, fontSize: '1.4rem' }}>New kit{coll ? ` — tagged into ${coll}` : ''}</div>
                            <div style={{ fontSize: '0.85rem', color: theme.inkSoft, marginTop: '4px' }}>The sales face of a set. Shop documents always explode to the contents below — the kit part# never reaches the floor, and nothing here is pushed to NetSuite as an item.</div>
                        </div>
                        <div style={{ padding: '22px 26px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '18px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 120px', gap: '16px' }}>
                                <div><label style={lbl}>Our item #</label><input value={newKit.code} onChange={e => setNewKit({ ...newKit, code: e.target.value.toUpperCase() })} placeholder="CE-KIT-2TRV4" style={{ ...fld, width: '100%', fontFamily: theme.mono }} /></div>
                                <div><label style={lbl}>Description</label><input value={newKit.name} onChange={e => setNewKit({ ...newKit, name: e.target.value })} placeholder="4ft Traverse Starter Set" style={{ ...fld, width: '100%' }} /></div>
                                <div><label style={lbl}>Our base $</label><input value={newKit.basePrice} onChange={e => setNewKit({ ...newKit, basePrice: e.target.value })} placeholder="0.00" style={{ ...fld, width: '100%', textAlign: 'right', fontFamily: theme.mono }} /></div>
                            </div>
                            <div style={{ border: `1px solid ${theme.line}`, padding: '14px 16px' }}>
                                <div style={{ fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: theme.inkSoft, marginBottom: '8px' }}>Kit contents — what one kit explodes to</div>
                                {kitContentsEditor(newKit.components || [], (rows) => setNewKit({ ...newKit, components: rows }))}
                            </div>
                            <div style={{ borderTop: `1px solid ${theme.line}`, paddingTop: '18px' }}>
                                <div style={{ fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: theme.brassDark, marginBottom: '10px' }}>{customer?.name || 'This customer'} — their side of it</div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                                    <div><label style={lbl}>Their part #</label><input value={newKit.theirSku} onChange={e => setNewKit({ ...newKit, theirSku: e.target.value })} placeholder="H1-2TRV-SET4" style={{ ...fld, width: '100%', fontFamily: theme.mono }} /></div>
                                    <div><label style={lbl}>Their net $</label><input value={newKit.theirNet} onChange={e => setNewKit({ ...newKit, theirNet: e.target.value })} placeholder="0.00" style={{ ...fld, width: '100%', textAlign: 'right', fontFamily: theme.mono }} /></div>
                                    <div><label style={lbl}>Their sales $</label><input value={newKit.theirSales} onChange={e => setNewKit({ ...newKit, theirSales: e.target.value })} placeholder="0.00" style={{ ...fld, width: '100%', textAlign: 'right', fontFamily: theme.mono }} /></div>
                                </div>
                            </div>
                        </div>
                        <div style={{ padding: '16px 26px', borderTop: `1px solid ${theme.line}`, display: 'flex', gap: '12px', justifyContent: 'flex-end', background: theme.paper }}>
                            <button onClick={() => setNewKit(null)} style={btn(false)}>Cancel</button>
                            <button onClick={createKit} style={btn(true, { background: theme.green, borderColor: theme.green })}>Create kit →</button>
                        </div>
                    </div>
                </div>
            )}

            {/* KIT SHEET IMPORT — preview before anything is written */}
            {kitImp && (
                <div onClick={() => setKitImp(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,.72)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '28px' }}>
                    <div onClick={e => e.stopPropagation()} style={{ background: '#fff', width: '1000px', maxWidth: '96vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', border: `1px solid ${theme.line}` }}>
                        <div style={{ padding: '20px 26px', borderBottom: `1px solid ${theme.line}`, background: theme.paper2 }}>
                            <div style={{ fontFamily: theme.serif, fontSize: '1.4rem' }}>Kit sheet — what it would do</div>
                            <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, marginTop: '4px' }}>{kitImp.fileName} · {customer?.name} · family {kitImp.parsed.family}{coll ? ` · tagged into ${coll}` : ''}</div>
                            <div style={{ display: 'flex', gap: '18px', marginTop: '12px', fontFamily: theme.mono, fontSize: '11px' }}>
                                <span style={{ color: theme.green }}>KITS NEW {kitImp.kitEntries.filter(k => k.status === 'NEW').length}</span>
                                <span style={{ color: theme.brass }}>KITS UPDATE {kitImp.kitEntries.filter(k => k.status === 'UPDATE').length}</span>
                                <span>MOTOR CODES {kitImp.kitEntries.reduce((s, k) => s + k.motorCodes.length, 0)}</span>
                                <span style={{ color: theme.brassDark }}>COMPONENTS PRICED {kitImp.compEntries.filter(c => c.status === 'ALIGN').length}</span>
                                <span style={{ color: theme.red }}>NOT IN LIBRARY {kitImp.compEntries.filter(c => c.status === 'MISSING').length}</span>
                                <span>RULES: {kitImp.parsed.rules.usage.length} usage · {kitImp.parsed.rules.configurator.length} configurator</span>
                            </div>
                        </div>
                        <div style={{ padding: '18px 26px', overflowY: 'auto' }}>
                            {kitImp.parsed.warnings.length > 0 && (
                                <div style={{ background: 'rgba(176,45,32,.06)', border: `1px solid ${theme.red}`, padding: '10px 14px', marginBottom: '14px', fontSize: '0.85rem' }}>
                                    {kitImp.parsed.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
                                </div>
                            )}
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                                <thead><tr>{['', 'Kit code', 'Their pattern', 'Net $', '+/ft $', 'Setup · Drive · Mount', 'Motor codes'].map(h => <th key={h} style={{ textAlign: 'left', padding: '6px 8px', borderBottom: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', color: theme.inkSoft }}>{h}</th>)}</tr></thead>
                                <tbody>
                                    {kitImp.kitEntries.map(k => (
                                        <tr key={k.code}>
                                            <td style={{ padding: '5px 8px', fontFamily: theme.mono, fontSize: '10px', color: k.status === 'NEW' ? theme.green : theme.brass }}>{k.status}</td>
                                            <td style={{ padding: '5px 8px', fontFamily: theme.mono, fontSize: '11px' }}>{k.code}</td>
                                            <td style={{ padding: '5px 8px', fontFamily: theme.mono, fontSize: '11px', color: theme.brassDark }}>{k.fabSku || '—'}</td>
                                            <td style={{ padding: '5px 8px', textAlign: 'right' }}>{k.net ?? '—'}</td>
                                            <td style={{ padding: '5px 8px', textAlign: 'right' }}>{k.perFootNet ?? '—'}</td>
                                            <td style={{ padding: '5px 8px', color: theme.inkSoft }}>{k.align.setup}{k.align.frontRail === 'RING' ? ' (front ring)' : ''} · {k.align.drive} · {k.align.mount} · /{k.align.material}</td>
                                            <td style={{ padding: '5px 8px', color: theme.inkSoft }}>{k.motorCodes.length || '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {kitImp.compEntries.filter(c => c.status === 'MISSING').length > 0 && (
                                <div style={{ marginTop: '14px', fontSize: '0.85rem', color: theme.inkSoft }}>
                                    <b style={{ color: theme.red }}>Not in the library</b> (aligned once the items exist — never auto-created):{' '}
                                    <span style={{ fontFamily: theme.mono, fontSize: '11px' }}>{kitImp.compEntries.filter(c => c.status === 'MISSING').map(c => c.code).join(' · ')}</span>
                                </div>
                            )}
                        </div>
                        <div style={{ padding: '16px 26px', borderTop: `1px solid ${theme.line}`, display: 'flex', gap: '12px', justifyContent: 'flex-end', background: theme.paper }}>
                            <button onClick={() => setKitImp(null)} style={btn(false)}>Cancel</button>
                            <button onClick={applyKitImport} disabled={!!busy} style={btn(true, { background: theme.green, borderColor: theme.green })}>Apply →</button>
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
