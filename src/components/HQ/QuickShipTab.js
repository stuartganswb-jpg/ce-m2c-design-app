import React, { useState, useEffect, useMemo, useRef } from 'react';
import { isPoleCategory } from '../Shared/poleCut';
import { BRAND_NETSUITE_MAP } from '../Shared/brandNetsuite';
import { db } from '../../firebase';
import { collection, doc, onSnapshot, setDoc, getDoc, updateDoc, query, where, serverTimestamp } from "firebase/firestore";
import { isOutsourcedFinishCode } from '../Shared/finishRouting';
import { nsProxyFetch } from "../Shared/nsProxy";
import { enqueueNsWrite } from '../Shared/nsOutbox';
import { matchesCustomerCode, customerCodesOf } from '../Shared/aliasSearch';
import { customerKeys, clientPriceFor, findClientPriceRow } from "../Shared/clientPricing";
import { resolveKitCode, describeKitAlign } from '../Shared/kitCode';
import { explodeTraverse, singleProjections, projLabel } from '../Shared/traverseExplode';
import { isFeeItemRecord, feeRuleOf, computeFee, feeRuleSummary, isCheckoutForCustomer } from '../Shared/feeRules';
import { priceChoice } from '../Shared/hardwarePricing';
import { customerPriceLevel } from '../Shared/priceLevels';
import TraverseConfiguratorModal from '../Shared/TraverseConfiguratorModal';
import { sizeKeyOf, SIZE_FAMILIES } from "../Shared/sizeMatrix";
import { packSizeOf, packLabelOf, packUnitFor, isRealPack, rushFeeAmountOf, rushFeeLabelOf } from "../Shared/quickShipUom";
import { buildAliasIndex, aliasCodesOf as aliasCodesIn, effectiveCollectionsOf as effCollectionsIn, customerFaceOf, faceCodeFor, bareCode, isAliasDoc, realPartOf, aliasTargetIdOf } from "../Shared/aliasIdentity";

// Stocked / pre-finished items are sold flat — each line goes to NetSuite as its own sales-order
// line (NO assembly/BOM rollup like the CPQ does). Quick Ship is the fast counter for that stock.
// ONE copy now — Shared/brandNetsuite.js (2026-08-25).

const KITS_DOC = { col: "system", id: "quick_ship_kits" };

// Map a part's productType/name to one of our slot categories.
const classifyCat = (pt) => {
    const t = String(pt || '').toUpperCase();
    if (t.includes('BACKPLATE') || t.includes('BACK PLATE')) return 'BACKPLATE';
    if (t.includes('BRACKET')) return 'BRACKET';
    if (t.includes('FINIAL')) return 'FINIAL';
    if (t.includes('RING')) return 'RING';
    if (isPoleCategory(t)) return 'POLE';
    return '';
};
const erpOf = (it) => String(it.legacyErpId || it.itemId || '').toUpperCase();
const nsIdOf = (it) => it.netSuiteInternalId || it.legacyErpId || it.itemId || '';

// Collection tags on an item, uppercased — the SAME shape CPQ/Vision scope by
// (manufacturingSpecs.collections, legacy single customData.collection).
const collectionsOf = (it) => (it.manufacturingSpecs?.collections
    || (it.manufacturingSpecs?.customData?.collection ? [it.manufacturingSpecs.customData.collection] : []))
    .map(c => String(c || '').trim().toUpperCase()).filter(Boolean);

// Size identity of a STOCKED item. Stocked SKUs are pre-finished ("H2-75FB/BL") and the size-key
// grammar deliberately skips finish variants, so read the key off the BARE code — that's the same
// code the 🧬 stamper parses, so a stocked ring lands on exactly the diameter its master does.
// (Resolution happens in diaCandidatesFor, which also follows alias links.)
const diaCellLabel = (cell) => {
    const [fam, dia] = String(cell || '').split('|');
    const opt = SIZE_FAMILIES[fam]?.dia?.options?.find(o => o.value === dia);
    return opt ? `${SIZE_FAMILIES[fam].label} · ${opt.label}` : cell;
};

// An inside-mount bracket takes the customer's Inside Mount pack; every other bracket sells each.
const isInsideMount = (it) => /INSIDE/.test(String(it?.manufacturingSpecs?.customData?.bracketType || it?.manufacturingSpecs?.customData?.bracketMount || '').toUpperCase());

// The finish code, i.e. everything after the suffix separator. "H2-75FB/CC" → "CC".
// (The bare code the other way — everything BEFORE it — comes from Shared/aliasIdentity's bareCode.)
const finishCodeOf = (it) => erpOf(it).split('/')[1] || '';

// SELLABLE vs MILL (Stuart 2026-07-25): a code with no "/FINISH" suffix is the raw base part we
// buy and paint — it never goes to an end customer. Only finished variants (/CC, /WC, …) are
// offered in the kit builder. Quick Add still reaches everything, for the rare mill-stock sale.
const isFinished = (it) => erpOf(it).includes('/');

// Compact searchable picker — shows "ITEM# — Name", sorted by item# (numeric-aware).
const ItemSelect = ({ value, onChange, items, placeholder }) => {
    const [search, setSearch] = useState('');
    const [open, setOpen] = useState(false);
    useEffect(() => {
        const it = items.find(x => x.id === value);
        setSearch(it ? `${erpOf(it)} — ${it.itemName}` : '');
    }, [value, items]);
    const q = search.toLowerCase();
    const filtered = items
        .filter(it => !value || open ? (erpOf(it).toLowerCase().includes(q) || String(it.itemName || '').toLowerCase().includes(q) || matchesCustomerCode(it, q)) : true)
        .sort((a, b) => erpOf(a).localeCompare(erpOf(b), undefined, { numeric: true, sensitivity: 'base' }))
        .slice(0, 60);
    return (
        <div style={{ position: 'relative' }}>
            <input
                value={search}
                onChange={e => { setSearch(e.target.value); setOpen(true); if (e.target.value === '') onChange(''); }}
                onFocus={() => setOpen(true)}
                onBlur={() => setTimeout(() => setOpen(false), 200)}
                placeholder={placeholder || 'Search item #…'}
                style={{ width: '100%', boxSizing: 'border-box', padding: '10px', fontSize: '0.85rem', fontFamily: 'var(--mono)', border: '1px solid var(--line)', outline: 'none' }}
            />
            {open && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid var(--line)', maxHeight: '240px', overflowY: 'auto', zIndex: 9999, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
                    {filtered.length === 0 && <div style={{ padding: '10px', color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.8rem' }}>No matches.</div>}
                    {filtered.map(it => (
                        <div key={it.id} onMouseDown={() => { onChange(it.id); setOpen(false); }}
                            style={{ padding: '9px 12px', cursor: 'pointer', fontSize: '0.82rem', borderBottom: '1px solid var(--paper-2)', display: 'flex', justifyContent: 'space-between', gap: '10px' }}
                            onMouseOver={e => e.currentTarget.style.background = 'var(--paper)'}
                            onMouseOut={e => e.currentTarget.style.background = '#fff'}>
                            <span style={{ fontFamily: 'var(--mono)', color: 'var(--ink)' }}>{erpOf(it)}</span>
                            <span style={{ color: 'var(--ink-soft)', textAlign: 'right', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.itemName}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// bracketId = the OUTER (left/right) bracket — they're the same part, so one field covers both ends.
// centerBracketId = the center/passing bracket. miterId is retained (no UI) so kits saved before
// the Miter Return slot moved to CPQ still resolve their saved line.
// Every qty starts BLANK (Stuart 2026-07-25) — a pre-filled quantity is a quantity nobody chose,
// and on a counter that ships stock it would go out the door. The operator types what they're
// selling; addKbToCart refuses to silently drop a slot that has an item but no qty.
const EMPTY_KB = { poleId: '', poleQty: '', bracketId: '', bracketQty: '', centerBracketId: '', centerBracketQty: '', ringId: '', ringQty: '', finialId: '', finialQty: '', cutId: '', cutLen: '', cutQty: '', spliceId: '', spliceQty: '', miterId: '', miterQty: '', rushType: '', rushId: '', rushQty: '' };
// Slot label ↔ fields, for the "you picked it but gave it no quantity" check.
const KB_SLOTS = [
    { label: 'Pole', idKey: 'poleId', qtyKey: 'poleQty' },
    { label: 'Outer Brackets', idKey: 'bracketId', qtyKey: 'bracketQty' },
    { label: 'Center Brackets', idKey: 'centerBracketId', qtyKey: 'centerBracketQty' },
    { label: 'Ring', idKey: 'ringId', qtyKey: 'ringQty' },
    { label: 'Finial', idKey: 'finialId', qtyKey: 'finialQty' },
    { label: 'Cut', idKey: 'cutId', qtyKey: 'cutQty' },
    { label: 'Splice', idKey: 'spliceId', qtyKey: 'spliceQty' },
];
// A rush charge belongs to an ORDER, not to a saved kit — strip it from the stored config so
// re-adding the kit next month doesn't quietly re-bill last month's rush.
const KIT_CFG_KEYS = Object.keys(EMPTY_KB).filter(k => !k.startsWith('rush'));

const QuickShipTab = ({ currentUser, activeBrand }) => {
    const [allItems, setAllItems] = useState([]);     // every brand part (for fee lookup)
    const [customers, setCustomers] = useState([]);
    const [kits, setKits] = useState([]);             // saved prebuilt kits

    const [customerId, setCustomerId] = useState('');
    const [custSearch, setCustSearch] = useState('');
    const [custOpen, setCustOpen] = useState(false);
    const [jobName, setJobName] = useState('');

    const [cart, setCart] = useState([]);             // flat lines (rates resolve LIVE — see pricedCart)
    const [quickItemId, setQuickItemId] = useState('');
    // 📦 TRAVERSE KITS (Stuart 2026-08-13, the hybrid): the CSR fast path for kit-code POs — kit +
    // extra feet + motor as cart lines, priced from the customer's own kit row. End treatments are
    // added with the ordinary item search (they are real, NetSuite-mapped items).
    const [trvCode, setTrvCode] = useState('');
    const [trvKitId, setTrvKitId] = useState('');
    const [trvFeet, setTrvFeet] = useState('');
    const [trvMotor, setTrvMotor] = useState('');
    const [trvFinish, setTrvFinish] = useState('');   // the ACTUAL finish: /P kits → P01…, /EP → EP1…, /W → S01… stains
    // ⚠ THE PROJECTION IS A SEPARATE ANSWER FROM THE KIT (Stuart 2026-08-22). A kit code says
    // single/double, drive, mount and material — it does NOT say how far off the wall. The sheet
    // sells a single at three depths as three different brackets, so an order that never asked was
    // consuming the standard one whatever was actually sold. Asked here, standard depths only;
    // anything outside the catalogue is a trip to CPQ.
    const [trvProj, setTrvProj] = useState('');
    // Shipping — the same fields the CPQ checkout collects, because NetSuite's SO wants them
    // (Stuart 2026-08-13: "Netsuite not going to accept an order without this stuff").
    const [ship, setShip] = useState({ method: 'SAVED', addressId: '', amount: '', custom: { attention: '', addressee: '', addr1: '', addr2: '', city: '', state: '', zip: '', country: 'US' } });
    const shipMethodRef = useRef(undefined); // undefined = not looked up; null = none found (same cache as ERPPushPull)
    // NetSuite header fields (Stuart 2026-08-13, from the failed SO push — the exact alignment
    // list): PO# → otherrefnum, sidemark → mainline memo + every line's Tag (custcol3), internal
    // memo → custbody_bit_internalmemo. Form/class/status ride the payload, not fields here.
    const [soExtras, setSoExtras] = useState({ po: '', sidemark: '', internalMemo: '', needBy: '', prodNotes: '' });
    // The components configurator (required at checkout): opens right after a kit lands in the
    // cart, offering the rules doc's carrier styles / included picks / billable accessories.
    const [trvCfg, setTrvCfg] = useState(null);          // { drive, feet, kitCode, finish } while open
    const [trvRules, setTrvRules] = useState(null);      // system/traverse_rules_H1-2TRV
    const [quickQty, setQuickQty] = useState('');   // blank, like every other qty on this tab
    // TO BE FINISHED (Stuart 2026-08-22): the raw mill item plus the finish it is to be painted or
    // plated in. Not stock — this is an order for something we make, entered on the same counter,
    // so the CSR does not go to CPQ for a part that needs no configuring.
    const [tbfItemId, setTbfItemId] = useState('');
    const [tbfFinish, setTbfFinish] = useState('');
    const [tbfQty, setTbfQty] = useState('');
    const [tbfPrice, setTbfPrice] = useState('');   // prefilled from the customer's price; editable
    const [tbfFeet, setTbfFeet] = useState('');     // per-foot items: feet per piece (cut length)
    const [lastCreated, setLastCreated] = useState(null); // { kind, id } — the visible confirmation the button never gave (Stuart 2026-08-30)
    // FEES as their own entry line — rush, freight, packaging, coatings. Priced the same way every
    // fee is priced everywhere else (Shared/feeRules), so tab 7 and CPQ can never disagree.
    const [feeItemId, setFeeItemId] = useState('');
    const [feeQty, setFeeQty] = useState('');
    const [ccQty, setCcQty] = useState({});               // customer checkout items — itemId → qty typed
    const [kb, setKb] = useState(EMPTY_KB);
    // The Kit Builder is a BUILD tool, not an order-entry one (Stuart 2026-08-22: "make the kit
    // builder a collapsed window at the bottom, so we open it only to build kits, but its out of
    // the way when just entering orders"). Closed by default; the header is the switch.
    const [kbOpen, setKbOpen] = useState(false);
    const [kitName, setKitName] = useState('');
    const [kitCollection, setKitCollection] = useState(''); // "file" the kit under a collection (e.g. TQS)
    const [kitEdit, setKitEdit] = useState(null);     // kit pricing/collection editor {name, brand, basePrice, collection, clientPricing, finishCodes}
    const [openCols, setOpenCols] = useState({});     // collection accordion state
    const [finishList, setFinishList] = useState([]); // [{code, name, outsourced}] — kit finish options
    const [kitFinishPick, setKitFinishPick] = useState(null); // kit awaiting a finish choice on add

    // Catalog scope (Stuart 2026-07-25): pick a COLLECTION and every picker on this tab narrows to
    // it — the same manufacturingSpecs.collections tag CPQ/Vision scope by — then pick a ROD
    // DIAMETER and the kit slots narrow again to that diameter's parts.
    const [scopeCollection, setScopeCollection] = useState('');
    const [kbDia, setKbDia] = useState('');
    const [kbFinish, setKbFinish] = useState('');   // '/CODE' suffix — one finish per kit
    const [diagQuery, setDiagQuery] = useState(''); // "why isn't this item showing?" probe
    const [rushTypes, setRushTypes] = useState([]); // master list: "RUSH 3 DAY - 75"

    const [pushing, setPushing] = useState(false);
    const [log, setLog] = useState([]);
    const addLog = (msg, type = 'info') => setLog(prev => [{ time: new Date().toLocaleTimeString(), msg, type }, ...prev]);

    useEffect(() => {
        if (!activeBrand) return;
        const unsubParts = onSnapshot(collection(db, "Approved_Designs"), (snap) => {
            const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .filter(d => d.brandId === activeBrand || (d.sharedBrands && d.sharedBrands.includes(activeBrand)));
            setAllItems(docs);
        }, e => console.warn('Quick Ship parts listen failed', e));
        const unsubCrm = onSnapshot(collection(db, "crm_records"), (snap) => {
            setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(r =>
                r.type === 'CUSTOMER' && (r.brandId === activeBrand || (r.sharedBrands && r.sharedBrands.includes(activeBrand)))));
        }, e => console.warn('Quick Ship crm listen failed', e));
        const unsubKits = onSnapshot(doc(db, KITS_DOC.col, KITS_DOC.id), (s) => {
            setKits(s.exists() && Array.isArray(s.data().kits) ? s.data().kits : []);
        }, e => console.warn('Quick Ship kits listen failed', e));
        // Finish codes (in-house + outsourced) feed the kit "available finishes" picker —
        // one PATTERN kit + a color choice replaces one kit per finish.
        const unsubFin = onSnapshot(doc(db, "system", "master_finishes"), (s) => {
            const arr = (s.exists() && s.data().finishes) || [];
            setFinishList(prev => [...arr.filter(f => f && (f.code || f.name)).map(f => ({ code: String(f.code || f.name).trim().toUpperCase(), name: f.name || f.code, outsourced: false, subFinishCode: String(f.subFinishCode || '').toUpperCase() })), ...prev.filter(p => p.outsourced)]);
        }, e => console.warn('Quick Ship finishes listen failed', e));
        const unsubTrvRules = onSnapshot(doc(db, "system", "traverse_rules_H1-2TRV"), (s) => {
            setTrvRules(s.exists() ? s.data() : null);
        }, e => console.warn('Quick Ship traverse rules listen failed', e));
        const unsubOut = onSnapshot(collection(db, "hq_outsource_finishes"), (s) => {
            // code falls back to NAME (the finishText convention) — EP3–EP6 are stored name-only
            const arr = s.docs.map(d => d.data()).filter(f => f && (f.code || f.name));
            setFinishList(prev => [...prev.filter(p => !p.outsourced), ...arr.map(f => ({ code: String(f.code || f.name).trim().toUpperCase(), name: f.name || f.code, outsourced: true, subFinishCode: String(f.subFinishCode || '').toUpperCase() }))]);
        }, e => console.warn('Quick Ship outsource finishes listen failed', e));
        // Rush fee menu (Mass Update 4.5 → RUSH FEE TYPES). The dollar amount rides in the entry.
        const unsubLists = onSnapshot(doc(db, "system", "master_lists"), (s) => {
            setRushTypes(s.exists() ? (s.data().rushFeeTypes || []) : []);
        }, e => console.warn('Quick Ship master lists listen failed', e));
        return () => { unsubParts(); unsubCrm(); unsubKits(); unsubFin(); unsubOut(); unsubLists(); unsubTrvRules(); };
    }, [activeBrand]);

    // Strictly-stocked: only items flagged isStocked feed quick-add + the part dropdowns.
    const allStocked = useMemo(() => allItems.filter(it => it.manufacturingSpecs?.isStocked === true), [allItems]);

    // ---- ALIASES ---------------------------------------------------------------------------
    // An Alias doc (partClass 'Alias', aliasOf → the real item) renders as its own node but IS the
    // real item in the BOM: H2-1BE / H2-1BS alias back to H1-1BE. The two are ONE physical part,
    // so everything this tab keys off a code has to see through the link — and it matters in both
    // directions, because the H2-side alias is what carries the Simple Elegance collection tag and
    // the H2 size grammar, while the stocked, pre-finished variant carries the H1 code.
    //
    // Without this the aliased brackets fall out of the collection scope, the diameter cascade AND
    // the outer/center split, which is exactly the "skipping over alias items" symptom.
    const aliasIndex = useMemo(() => buildAliasIndex(allItems), [allItems]);
    const aliasCodesOf = (it) => aliasCodesIn(aliasIndex, it);
    const effectiveCollectionsOf = (it) => effCollectionsIn(aliasIndex, it);
    // The customer-facing doc for an item sold inside the scoped collection (null when none).
    const aliasFaceOf = (it) => customerFaceOf(aliasIndex, it, scopeCollection);
    const aliasCodeFor = (aliasDoc, it) => faceCodeFor(aliasDoc, it);

    // Every collection present on stocked inventory — the scope menu is data, never a hard-coded
    // list. Alias-reachable tags count, so a collection that only ever tags its H2-side aliases
    // still appears here.
    const stockedCollections = useMemo(
        () => [...new Set(allStocked.flatMap(it => [...effectiveCollectionsOf(it)]))].sort(),
        [allStocked, aliasIndex] // eslint-disable-line react-hooks/exhaustive-deps
    );

    // COLLECTION SCOPE: narrows every picker to one collection ("Simple Elegance"), matching what
    // the CPQ/Vision flows for that collection can build. Untagged items are excluded while a scope
    // is active — an untagged SKU leaking into a scoped list is exactly what the scope prevents.
    const stocked = useMemo(
        () => scopeCollection ? allStocked.filter(it => effectiveCollectionsOf(it).has(scopeCollection)) : allStocked,
        [allStocked, scopeCollection, aliasIndex] // eslint-disable-line react-hooks/exhaustive-deps
    );

    const catOf = (it) => classifyCat(it.manufacturingSpecs?.productType || it.productType || it.customData?.category);
    // Kit-builder pools are FINISHED goods only — the raw mill parts we paint never reach a customer.
    const byCat = (cat) => stocked.filter(it => catOf(it) === cat && isFinished(it));

    // Rod diameter cells an item can answer to, seen through the alias link. H1-1BE carries no H2
    // size grammar, but its alias H2-1BE does — and that alias is the whole reason the part is in
    // this collection. When a collection IS scoped, the identity that carries that collection wins,
    // so an aliased bracket files under its H2 diameter rather than the code it bills as.
    const diaCandidatesFor = (it) => {
        const cells = [];
        aliasCodesOf(it).forEach(c => {
            const sk = sizeKeyOf({ legacyErpId: c });
            if (!sk) return;
            const inScope = !scopeCollection || (aliasIndex.docsByCode.get(c) || []).some(d => collectionsOf(d).includes(scopeCollection));
            cells.push({ cell: `${sk.family}|${sk.dia}`, inScope });
        });
        const scoped = cells.filter(c => c.inScope);
        return [...new Set((scoped.length ? scoped : cells).map(c => c.cell))];
    };

    // Rod diameters offered by the scoped stock, derived from the item codes' size grammar.
    const diaCells = useMemo(() => {
        const seen = new Map();
        stocked.forEach(it => diaCandidatesFor(it).forEach(c => { if (!seen.has(c)) seen.set(c, diaCellLabel(c)); }));
        return [...seen.entries()]
            .sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }))
            .map(([cell, label]) => ({ cell, label }));
    }, [stocked, scopeCollection, aliasIndex]); // eslint-disable-line react-hooks/exhaustive-deps

    // Finish codes present on the scoped stock — the /SUFFIX on each SKU. Data-driven, so a new
    // finish appears here the moment its variants are stocked.
    const stockedFinishes = useMemo(() => {
        const seen = new Set();
        stocked.forEach(it => { const f = finishCodeOf(it); if (f) seen.add(f); });
        return [...seen].sort();
    }, [stocked]);

    // DIAMETER + FINISH CASCADE: pick the rod diameter and the finish once, and every part slot
    // narrows to that dia×finish — the operator then makes STYLE choices only, since a kit ships in
    // one finish. Parts whose code carries no size grammar drop out while a diameter is active;
    // that's the point ("1/2" Simple Elegance leaves very few options").
    const atDia = (list) => kbDia ? list.filter(it => diaCandidatesFor(it).includes(kbDia)) : list;
    const atFinish = (list) => kbFinish ? list.filter(it => finishCodeOf(it) === kbFinish) : list;
    const pool = (cat) => atFinish(atDia(byCat(cat)));
    const poles = useMemo(() => pool('POLE'), [stocked, kbDia, kbFinish]);        // eslint-disable-line react-hooks/exhaustive-deps
    const brackets = useMemo(() => pool('BRACKET'), [stocked, kbDia, kbFinish]);  // eslint-disable-line react-hooks/exhaustive-deps
    const rings = useMemo(() => pool('RING'), [stocked, kbDia, kbFinish]);        // eslint-disable-line react-hooks/exhaustive-deps
    const finials = useMemo(() => pool('FINIAL'), [stocked, kbDia, kbFinish]);    // eslint-disable-line react-hooks/exhaustive-deps

    // OUTER vs CENTER BRACKETS. 1.6 is the authority, but read it through the GENERATED FLOWS
    // rather than the pins: the generator turns each 1.6 bracket cluster into a step stamped
    // stepRole 'BRACKET' + position LEFT/CENTER/RIGHT (AdminTab addPerPosition), so one brand-wide
    // cpq_flows query gives the same answer as an N+1 walk of every assembly's clusters and pins —
    // and it does NOT depend on how the assembly doc happens to be collection-tagged, which is what
    // made the pins version come up empty. Left and right are the same part, hence one "Outer" list.
    // Position is a property of the PART, not of the collection, so this is indexed brand-wide and
    // works with or without a collection scope.
    const [brandFlows, setBrandFlows] = useState([]);
    useEffect(() => {
        if (!activeBrand) { setBrandFlows([]); return; }
        const unsub = onSnapshot(query(collection(db, 'cpq_flows'), where('brandId', '==', activeBrand)),
            (snap) => setBrandFlows(snap.docs.map(d => d.data())),
            e => { console.warn('Quick Ship flow listen failed', e); setBrandFlows([]); });
        return unsub;
    }, [activeBrand]);

    const bracketPos = useMemo(() => {
        const outer = new Set(), center = new Set();
        brandFlows.forEach(f => (f.steps || []).forEach(s => {
            if (String(s.stepRole || '').toUpperCase() !== 'BRACKET') return;
            const pos = String(s.position || '').toUpperCase();
            const target = pos === 'CENTER' ? center : (pos === 'LEFT' || pos === 'RIGHT') ? outer : null;
            if (!target) return;
            // Options may name the part by ERP code or by doc/item id — index every spelling so the
            // stocked variant matches on whichever one it carries.
            (s.styleOptions || []).forEach(o => [o.partName, o.partId].forEach(v => { const c = bareCode(v); if (c) target.add(c); }));
        }));
        return (outer.size || center.size) ? { outer, center } : null;
    }, [brandFlows]);

    // A stocked variant can be identified by its ERP code, its itemId, its doc id — or by any code
    // aliased to it. The flow step names the H2 alias (H2-1BE); the stocked variant is H1-1BE/CC.
    const bracketIn = (set, it) => [...aliasCodesOf(it)].some(x => x && set.has(x));
    const outerBrackets = useMemo(() => bracketPos ? brackets.filter(it => bracketIn(bracketPos.outer, it)) : brackets, [brackets, bracketPos]); // eslint-disable-line react-hooks/exhaustive-deps
    const centerBrackets = useMemo(() => bracketPos ? brackets.filter(it => bracketIn(bracketPos.center, it)) : brackets, [brackets, bracketPos]); // eslint-disable-line react-hooks/exhaustive-deps

    // ---- PORTAL QUOTE REQUESTS (portal Quick Ship → portalStockQuoteRequest) -----------------
    // Customer-built stock quotes land as jobs docs (status PORTAL_REQUEST, kind QUICKSHIP) with
    // server-validated lines. One click loads the customer + cart for review — ZERO re-entry —
    // then the SO pushes exactly like a counter-built cart (rates re-resolve LIVE via pricedCart,
    // so a price that changed since the customer submitted resolves to today's truth).
    const [portalReqs, setPortalReqs] = useState([]);
    // ── EDIT AN EXISTING SO (CRM ✎ Edit, Stuart 2026-08-30) ─────────────────────────────────
    // The CRM hands over an SO id (only when NO work orders exist — the CRM gate enforces it);
    // the cart rebuilds from the SO's lines, rates re-resolve LIVE, and pushing the edited cart
    // SUPERSEDES the original: the old SO closes with a pointer to the new one.
    const [editingSo, setEditingSo] = useState(null);
    // The quote currently being re-entered (CRM → Reopen Order Entry). Saving stamps the new
    // quote as its successor and marks this one superseded, so two live quotes never chase the
    // same job — the confusion the Fabricut re-quotes caused on 2026-08-31.
    const [reopenedQuote, setReopenedQuote] = useState('');
    useEffect(() => {
        if (!allItems.length) return;
        let h = null;
        try { h = JSON.parse(localStorage.getItem('hq_reopen_qs_quote') || 'null'); } catch (e) { h = null; }
        if (!h || !h.jobId) return;
        localStorage.removeItem('hq_reopen_qs_quote');
        (async () => {
            try {
                const snap = await getDoc(doc(db, 'jobs', h.jobId));
                if (!snap.exists()) return alert('That quote no longer exists.');
                const j = { id: snap.id, ...snap.data() };
                const saved = Array.isArray(j.quickShipCart) ? j.quickShipCart : null;
                if (!saved || !saved.length) {
                    return alert(`Quote ${j.jobId || j.id} was saved before Order Entry started keeping its cart (2026-08-31), so there is nothing to reopen — the printed lines are prose, not a cart. Rebuild it here and every quote from now on will reopen.`);
                }
                setCustomerId(j.customer?.id || '');
                setCustSearch(j.customer?.name ? `${j.customer.name} (${j.customer.id || ''})` : '');
                const ex = j.quickShipExtras || {};
                setJobName(ex.jobName || j.jobName || '');
                if (ex.soExtras) setSoExtras(p2 => ({ ...p2, ...ex.soExtras }));
                if (ex.ship) setShip(p2 => ({ ...p2, ...ex.ship }));
                setCart(saved.map((l, i) => ({ ...l, key: `${l.erp || 'line'}-${Date.now()}-${i}` })));
                setReopenedQuote(j.jobId || j.id);
                addLog(`✎ Quote ${j.jobId || j.id} reopened — ${saved.length} line(s). Saving creates the corrected quote and supersedes this one.`, 'info');
            } catch (e) { console.warn('quote reopen failed', e); alert(`Could not reopen that quote: ${e.message || e}`); }
        })();
    }, [allItems.length]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (!allItems.length) return;
        let handoff = null;
        try { handoff = JSON.parse(localStorage.getItem('hq_reopen_qs_so') || 'null'); } catch (e) { handoff = null; }
        if (!handoff || !handoff.soId) return;
        localStorage.removeItem('hq_reopen_qs_so');
        (async () => {
            try {
                const snap = await getDoc(doc(db, 'hq_sales_orders', handoff.soId));
                if (!snap.exists()) return alert('That sales order no longer exists.');
                const so = { id: snap.id, ...snap.data() };
                setCustomerId(so.customerId || '');
                setCustSearch(so.customer ? `${so.customer} (${so.customerId || ''})` : '');
                const ex = so.quickShipExtras || {};
                setJobName(ex.jobName || so.jobName || '');
                if (ex.soExtras) setSoExtras(p2 => ({ ...p2, ...ex.soExtras }));
                if (ex.ship) setShip(p2 => ({ ...p2, ...ex.ship }));
                // THE CART AS TYPED, when the order carries it: kits, footage, configurator picks
                // and per-line memos all return. `lines` is the fallback for orders written before
                // 2026-08-31 — and it cannot hold a traverse kit, so it says so rather than
                // quietly handing back an order worth less than the one being edited.
                if (Array.isArray(so.quickShipCart) && so.quickShipCart.length) {
                    setCart(so.quickShipCart.map((l, i) => ({ ...l, key: `${l.erp || 'line'}-${Date.now()}-${i}` })));
                    // Same slim shape the legacy path sets — the banner and the supersede write
                    // read exactly these three fields.
                    setEditingSo({ id: so.id, soId: so.soId || so.id, customer: so.customer || '' });
                    addLog(`✎ Editing SO ${so.soId || so.id} — restored from its stored cart (${so.quickShipCart.length} line(s), kits and footage included). Pushing this cart SUPERSEDES the original.`, 'warn');
                    return;
                }
                if ((so.invoiceLines || []).some(x => x && x.type === 'KIT')) {
                    alert(`⚠ SO ${so.soId || so.id} was written before Order Entry stored its cart (2026-08-31), and it contains a KIT.\n\nThe rebuilt cart below carries the component lines only — the kit and any additional-foot charge are NOT in it, and pushing as-is would supersede this order with a cheaper one. Re-add the kit before saving, or cancel the edit.`);
                }
                setCart((so.lines || []).map((l, i) => {
                    const erp = String(l.erp || '').toUpperCase();
                    const it = allItems.find(x => erpOf(x) === erp) || null;
                    return {
                        key: `${erp}-${Date.now()}-${i}`,
                        itemId: it?.itemId || it?.id || '', erp, nsId: it ? nsIdOf(it) : '',
                        name: l.name || it?.itemName || erp,
                        aliasErp: l.aliasErp || '', aliasItemId: null,
                        qty: Math.max(1, parseInt(l.packs != null && l.packUom ? l.packs : l.qty) || 1),
                        note: l.note || '',
                        bin: l.bin || it?.manufacturingSpecs?.homeBin || '',
                        packUom: l.packUom || '', packSize: l.packSize || 1,
                        rateOverride: null, kitKey: null, kitName: null, kitBrand: null, kitFinish: '',
                        ...(l.toBeFinished ? { toBeFinished: true, finishCode: l.finishCode || '' } : {}),
                    };
                }));
                setEditingSo({ id: so.id, soId: so.soId || so.id, customer: so.customer || '' });
                addLog(`✎ Editing SO ${so.soId || so.id} — pushing this cart SUPERSEDES the original (it closes with a pointer here).`, 'warn');
            } catch (e) { alert('Could not load the sales order for editing: ' + (e.message || e)); }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [allItems.length]);
    useEffect(() => {
        if (!activeBrand) { setPortalReqs([]); return; }
        const unsub = onSnapshot(query(collection(db, 'jobs'), where('brandId', '==', activeBrand), where('status', '==', 'PORTAL_REQUEST')),
            (snap) => setPortalReqs(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(j => j.portalRequest?.kind === 'QUICKSHIP')),
            e => { console.warn('Quick Ship portal request listen failed', e); setPortalReqs([]); });
        return unsub;
    }, [activeBrand]);
    const loadPortalReq = async (job) => {
        const pr = job.portalRequest || {};
        const lines = Array.isArray(pr.lines) ? pr.lines : [];
        setCustomerId(job.customer?.id || '');
        setCustSearch(job.customer ? `${job.customer.name || ''} (${job.customer.id})` : '');
        setJobName(job.jobName || '');
        setCart(lines.map((l, i) => {
            const it = itemById(l.itemId);
            return {
                key: `${l.itemId}-${Date.now()}-${i}`,
                itemId: l.itemId, erp: l.erp || (it ? erpOf(it) : ''), nsId: it ? nsIdOf(it) : '',
                name: l.name || it?.itemName || l.erp || '',
                aliasErp: l.aliasErp || '', aliasItemId: l.faceItemId || null,
                qty: Math.max(1, parseInt(l.qty) || 1), note: l.note || '',
                bin: it?.manufacturingSpecs?.homeBin || it?.binLocation || '',
                packUom: l.packUom || '', packSize: l.packSize || 1,
                rateOverride: null, kitKey: null, kitName: null, kitBrand: null, kitFinish: ''
            };
        }));
        try {
            await updateDoc(doc(db, 'jobs', job.id), { status: 'QUICKSHIP_REVIEW', 'portalRequest.loadedBy': currentUser?.name || currentUser?.uName || 'staff', 'portalRequest.loadedAt': new Date().toISOString() });
        } catch (e) { console.warn('portal request stamp failed', e); }
        addLog(`Loaded portal request ${job.quoteNo || job.id} — ${lines.length} line(s) for ${job.customer?.name || '?'}`, 'success');
    };

    // Fee / billable items — matched by keyword across ALL brand parts (fees aren't usually
    // "stocked"), and never narrowed by collection or diameter: a cut is a cut.
    const feeItems = (kw) => allItems.filter(it => {
        const hay = `${it.manufacturingSpecs?.productType || ''} ${it.productType || ''} ${it.itemName || ''} ${it.customData?.feeType || ''}`.toUpperCase();
        return kw.some(k => hay.includes(k));
    });
    const cutItems = useMemo(() => feeItems(['CUT']), [allItems]);            // eslint-disable-line react-hooks/exhaustive-deps
    const spliceItems = useMemo(() => feeItems(['SPLICE', 'JOINER', 'JNR', 'SPLC']), [allItems]); // eslint-disable-line react-hooks/exhaustive-deps
    const rushItems = useMemo(() => feeItems(['RUSH', 'EXPEDITE']), [allItems]); // eslint-disable-line react-hooks/exhaustive-deps

    // ---- "WHY ISN'T THIS ITEM SHOWING?" -------------------------------------------------------
    // The pickers are the product of six stacked predicates (brand → stocked → collection →
    // category → finished → diameter → finish), and when one of them rejects an item the UI just
    // shows a shorter list — the reason is invisible. Type a code here and it walks the SAME
    // predicates in order and names the first one that said no. Diagnosis, not a second code path:
    // every check below is the identical expression the pools use.
    const diagFor = (typed) => {
        const q = String(typed || '').trim().toUpperCase();
        if (!q) return null;
        const hit = allItems.find(it => erpOf(it) === q)
            || allItems.find(it => bareCode(it.itemId) === bareCode(q) || String(it.itemId || '').toUpperCase() === q)
            // The CUSTOMER'S number resolves too — their SKU (4.6) or Fabricut pattern # — since
            // that is what arrives on their POs (2026-08-26).
            || allItems.find(it => customerCodesOf(it).some(c => c.toUpperCase() === q))
            || allItems.find(it => erpOf(it).startsWith(q))
            || allItems.find(it => matchesCustomerCode(it, q));
        if (!hit) return { ok: false, step: 'Not found', detail: `No item in this brand matches "${q}". Check the brand selector and the spelling — Quick Ship only loads ${activeBrand}'s parts.` };

        const code = erpOf(hit);
        const face = aliasFaceOf(hit);
        const aka = [...aliasCodesOf(hit)].filter(c => c !== bareCode(code));
        const trail = [`Found ${code}${aka.length ? ` (also known as ${aka.join(', ')})` : ''}`];

        if (hit.manufacturingSpecs?.isStocked !== true) return { ok: false, step: 'Not stocked', detail: `${code} is not flagged Stocked. Quick Ship only sells stocked inventory — tick "Stocked" on the item, or mass-set it in 4.5.`, trail };
        trail.push('Stocked ✓');

        const cols = [...effectiveCollectionsOf(hit)];
        if (scopeCollection && !cols.includes(scopeCollection)) {
            return { ok: false, step: 'Collection', detail: `Scope is ${scopeCollection}, but ${code} reaches ${cols.length ? cols.join(', ') : 'no collection at all'}${aka.length ? ' (alias links included)' : ''}. Tag the item — or its alias — with ${scopeCollection}.`, trail };
        }
        trail.push(scopeCollection ? `In ${scopeCollection} ✓` : 'No collection scope ✓');

        const cat = catOf(hit);
        if (!['POLE', 'BRACKET', 'RING', 'FINIAL'].includes(cat)) {
            return { ok: false, step: 'Category', detail: `Product type "${hit.manufacturingSpecs?.productType || hit.productType || '(blank)'}" reads as "${cat || 'unclassified'}", and the kit builder only has Pole / Bracket / Ring / Finial slots. Fix Prod Type in the Master Library.`, trail };
        }
        trail.push(`Category ${cat} ✓`);

        if (!isFinished(hit)) return { ok: false, step: 'Mill part', detail: `${code} carries no "/FINISH" suffix, so it reads as a raw mill part and the kit builder hides it. The sellable variants are the /CODE ones (e.g. ${bareCode(code)}/CG). Quick Add can still reach ${code}.`, trail };
        trail.push('Finished good ✓');

        const dias = diaCandidatesFor(hit);
        if (kbDia && !dias.includes(kbDia)) {
            return { ok: false, step: 'Rod diameter', detail: `You have ${diaCellLabel(kbDia)} selected; ${code} answers to ${dias.length ? dias.map(diaCellLabel).join(' / ') : 'no size grammar at all'}. An item with no parseable size code only shows when the diameter is set to "Any".`, trail };
        }
        trail.push(kbDia ? `At ${diaCellLabel(kbDia)} ✓` : 'Any diameter ✓');

        const fin = finishCodeOf(hit);
        if (kbFinish && fin !== kbFinish) return { ok: false, step: 'Finish', detail: `You have ${kbFinish} selected and ${code} is ${fin}. Switch the Finish selector to ${fin} or to "Any finish".`, trail };
        trail.push(kbFinish ? `Finish ${kbFinish} ✓` : 'Any finish ✓');

        if (cat === 'BRACKET' && bracketPos) {
            const isOuter = bracketIn(bracketPos.outer, hit), isCenter = bracketIn(bracketPos.center, hit);
            if (!isOuter && !isCenter) return { ok: false, step: 'Bracket position', detail: `${code} passes every filter but no flow step tags it LEFT / RIGHT / CENTER, so it lands in neither bracket list. Its 1.6 cluster needs a position, and the flow needs regenerating after.`, trail };
            trail.push(`${isOuter && isCenter ? 'Outer + Center' : isOuter ? 'Outer' : 'Center'} bracket ✓`);
        }

        return { ok: true, step: 'Showing', detail: `${code} passes every filter${face ? ` and sells as ${aliasCodeFor(face, hit)}` : ''}. It should be in the ${cat.toLowerCase()} picker right now.`, trail };
    };
    const diag = useMemo(() => diagFor(diagQuery), [diagQuery, allItems, scopeCollection, kbDia, kbFinish, bracketPos]); // eslint-disable-line react-hooks/exhaustive-deps

    const itemById = (id) => allItems.find(it => it.id === id);

    // Customer identity for clientPricing lookups — SHARED with CPQ (Shared/clientPricing.js) so the
    // same customer can't price one way here and another way in the configurator. Rows may be keyed
    // by CRM doc id or by the customer's name, hence the key set rather than a strict id compare.
    const custKeys = useMemo(
        () => customerKeys(customerId, customers.find(c => c.id === customerId)),
        [customerId, customers]
    );
    const selectedCustomer = customers.find(c => c.id === customerId);

    // PACKS: the selling unit for a kit slot — the customer's CRM preference, else the item's own
    // Quick Ship UOM. Brackets only take a pack when they're inside-mount (that's the preference
    // Stuart set); poles and fees always sell each.
    const slotOfCat = (it) => {
        const c = catOf(it);
        if (c === 'RING') return 'ring';
        if (c === 'FINIAL') return 'finial';
        if (c === 'BRACKET' && isInsideMount(it)) return 'insideMount';
        return '';
    };
    const packForItem = (it) => {
        const slot = slotOfCat(it);
        if (!slot) return { uom: '', size: 1 };
        const uom = packUnitFor(slot, selectedCustomer, it);
        return isRealPack(uom) ? { uom: packLabelOf(uom), size: packSizeOf(uom) } : { uom: '', size: 1 };
    };

    // Stale-pick sweep: narrowing the collection or diameter must not leave a now-invisible part
    // selected in the kit builder — it would silently ride into the cart at the wrong size.
    useEffect(() => {
        setKb(prev => {
            const ok = (id, list) => !id || list.some(x => x.id === id);
            if (ok(prev.poleId, poles) && ok(prev.bracketId, outerBrackets) && ok(prev.centerBracketId, centerBrackets)
                && ok(prev.ringId, rings) && ok(prev.finialId, finials)) return prev;
            return {
                ...prev,
                poleId: ok(prev.poleId, poles) ? prev.poleId : '',
                bracketId: ok(prev.bracketId, outerBrackets) ? prev.bracketId : '',
                centerBracketId: ok(prev.centerBracketId, centerBrackets) ? prev.centerBracketId : '',
                ringId: ok(prev.ringId, rings) ? prev.ringId : '',
                finialId: ok(prev.finialId, finials) ? prev.finialId : '',
            };
        });
    }, [poles, outerBrackets, centerBrackets, rings, finials]);

    // A diameter or finish from a collection we just left is meaningless — clear it with the scope.
    useEffect(() => { setKbDia(prev => (prev && !diaCells.some(d => d.cell === prev)) ? '' : prev); }, [diaCells]);
    useEffect(() => { setKbFinish(prev => (prev && !stockedFinishes.includes(prev)) ? '' : prev); }, [stockedFinishes]);

    // ── ONE PRICING ENGINE (Stuart 2026-08-22) ───────────────────────────────────────────────
    // "one pricing engine for whole site, portal, etc."
    //
    // This tab used to answer the price question its own way — the customer's row, else base price —
    // which meant the Customer Alias & Pricing box that governs CPQ did not reach an order entered
    // here at all. Two engines, two answers, and the one that shipped depended on which door the
    // order came through. It now asks the SAME resolver CPQ asks (Shared/hardwarePricing): authored
    // override → the customer's price level → their negotiated row → base price → the flow default.
    // For a customer with no level that is exactly the old behaviour, which is what makes this safe.
    const priceCtx = useMemo(() => {
        const lvl = customerPriceLevel(selectedCustomer, 'STANDARD');
        return {
            customerId, customer: selectedCustomer || null,
            priceLevel: lvl.level, levelIsDefault: lvl.isDefault,
            outsourceCodes: finishList.filter(f => f.outsourced),
            // Tier inheritance needs the BASE doc for a /EP variant that carries no box of its own.
            findByCode: (c) => allItems.find(x => erpOf(x) === String(c || '').trim().toUpperCase()) || null,
        };
    }, [customerId, selectedCustomer, finishList, allItems]);
    // Quick Ship sells FINISHED skus, so the item on the line is already the record that is sold —
    // finishVariantOf leaves it alone and the price comes off that doc, exactly as before.
    const rateFor = (it) => (it ? (priceChoice({ partId: it.id }, it, priceCtx).price || 0) : 0);

    // qty is counted in PACKS; this is what the warehouse and NetSuite actually see.
    // Billing quantity: packs convert to eaches; a PER-FOOT line bills qty(pieces) × feet each
    // (Stuart 2026-08-30: H1-138TRV sells by the FOOT — the order asks feet per piece × pieces,
    // NetSuite bills and relieves stock in feet, the floor makes PIECES at the cut length).
    const eachQtyOf = (l) => l.perFoot
        ? (parseInt(l.qty) || 0) * (parseFloat(l.feetPer) || 1)
        : (parseInt(l.qty) || 0) * (l.packSize || 1);

    // ── TRAVERSE KITS ────────────────────────────────────────────────────────────────────────────
    // A kit the customer is entitled to = a Kit-class record carrying kitAlign AND a pricing row
    // for this customer — the same entitlement rule as every Quick Ship item.
    const kitRowOf = (it) => findClientPriceRow(it?.clientPricing, custKeys) || null;
    const trvKits = useMemo(() => {
        // Dropdown order (Stuart 2026-08-13): all MANUAL first — wall, double, ceiling — then the
        // same shape again for MOTORIZED, so the CSR's eye lands where the PO does.
        const rank = (k) => {
            const a = k.manufacturingSpecs.kitAlign;
            const drive = String(a.drive).toUpperCase() === 'MOTORIZED' ? 1 : 0;
            const mount = String(a.mount).toUpperCase() === 'CEILING' ? 1 : 0;
            const setup = String(a.setup).toUpperCase() !== 'DOUBLE' ? 0 : (String(a.frontRail).toUpperCase() === 'RING' ? 2 : 1);
            const mat = { P: 0, EP: 1, W: 2 }[String(a.material).toUpperCase()] ?? 3;
            return drive * 1000 + mount * 100 + setup * 10 + mat;
        };
        return allItems.filter(p => p.partClass === 'Kit' && p.manufacturingSpecs?.kitAlign && kitRowOf(p))
            .sort((x, y) => rank(x) - rank(y));
    }, [allItems, customerId]); // eslint-disable-line react-hooks/exhaustive-deps
    const trvKit = trvKits.find(k => k.id === trvKitId) || null;
    const trvResolve = (code) => {
        setTrvCode(code);
        const c = String(code || '').trim().toUpperCase();
        // their pattern # (clientSku) or our code, base or per-motor — all four spellings land
        const bySku = trvKits.find(k => { const r = kitRowOf(k); return r && String(r.clientSku || '').trim().toUpperCase() === c; })
            || trvKits.find(k => (k.manufacturingSpecs.kitMotorCodes || []).some(x => String(x.fabSku || '').trim().toUpperCase() === c));
        if (bySku) {
            const mc = (bySku.manufacturingSpecs.kitMotorCodes || []).find(x => String(x.fabSku || '').trim().toUpperCase() === c);
            setTrvKitId(bySku.id); if (mc?.motorItem) setTrvMotor(mc.motorItem);
            return;
        }
        const r = resolveKitCode(trvKits, c);
        if (r) { setTrvKitId(r.kit.id); if (r.motorItem) setTrvMotor(r.motorItem); }
    };
    // The finishes a kit's material accepts: /EP kits take the outsourced plated codes, /P kits the
    // in-house paints, /W kits the S-stains (Stuart 2026-08-13: "in the case of the W items those
    // should be looking for our S01, S02.. for the stained finishes").
    const trvFinishOptions = useMemo(() => {
        // The kit's own finish MATRIX wins (4.6 Kit Builder checkboxes, Stuart 2026-08-13: "just
        // check off which apply, this will work better than just rules and scale better") — the
        // material rules below are only the fallback for kits nobody has curated yet.
        const allowed = (trvKit?.manufacturingSpecs?.kitFinishOptions || []).map(c => String(c).toUpperCase());
        if (allowed.length) return finishList.filter(f => allowed.includes(f.code));
        const mat = String(trvKit?.manufacturingSpecs?.kitAlign?.material || '').toUpperCase();
        if (!mat) return [];
        if (mat === 'EP') return finishList.filter(f => f.outsourced);
        if (mat === 'W') return finishList.filter(f => /^S/.test(f.code));
        return finishList.filter(f => !f.outsourced && /^P/.test(f.code));
    }, [trvKit, finishList]);

    // A DOUBLE has no projection to ask about — one bracket carries both rods, and every double
    // part is tagged proj:any. So the question appears on singles and nowhere else.
    const trvIsSingle = !!trvKit && String(trvKit.manufacturingSpecs?.kitAlign?.setup || '').toUpperCase() !== 'DOUBLE';
    const trvProjOptions = useMemo(
        () => (trvIsSingle ? singleProjections(trvKit?.manufacturingSpecs?.kitFamily || 'H1-2TRV') : []),
        [trvIsSingle, trvKit]);

    // ── THE TRACK'S OWN COLOUR (Stuart 2026-08-22) ───────────────────────────────────────────────
    // "for every master finish ie. P01, EP01, etc. there is a matching bronze or champagne default
    // for the traverse track and brackets." That alignment already exists — `subFinishCode` on the
    // master finish (4.5), read by the push for every item flagged `usesSubFinish`. It was only ever
    // visible AFTER the fact, in a push warning. Shown at the moment of choosing instead, so a
    // finish with no aligned track colour is obvious while it can still be fixed.
    const subFinishOf = (code) => {
        const f = finishList.find(x => x.code === String(code || '').toUpperCase());
        return f && f.subFinishCode ? f.subFinishCode : '';
    };
    // A projection carried over from a kit we just left is meaningless — clear it with the kit, and
    // clear it outright on a double, which has none to give. Same idiom as the diameter/finish
    // guards above.
    useEffect(() => { setTrvProj(prev => (prev && !trvProjOptions.some(p => p.inches === prev)) ? '' : prev); }, [trvProjOptions]);

    const addTraverse = () => {
        if (!trvKit) return alert("Pick a kit (or paste one of the customer's kit codes).");
        if (!trvFinish) return alert('Pick the finish — the shop cannot build "painted" without knowing WHICH paint.');
        // A single at the wrong depth is the wrong bracket ITEM, not a note on the order — so the
        // question is answered before the line exists rather than assumed at push time.
        if (trvIsSingle && !trvProj) return alert('Pick the projection — a single sells at three depths and each one is a different bracket.');
        const row = kitRowOf(trvKit);
        const align = trvKit.manufacturingSpecs.kitAlign;
        const feet = Math.max(parseInt(trvFeet) || 4, 1);
        const billFeet = Math.max(feet, align.minFeet || 4);   // 4ft is the MINIMUM CHARGE — a shorter cut still bills the set
        // THE LINE IS THEIR COMPLETE KIT (Stuart 2026-08-13: "the in app forms should resolve to
        // the finished fabricut kits that include the motor upgrade to match their complete kit
        // code"). A motor pick folds INTO the kit line — their per-motor code at their per-motor
        // price — never a separate upgrade line, so our form line matches their PO line exactly.
        const mc = String(align.drive).toUpperCase() === 'MOTORIZED' && trvMotor
            ? (trvKit.manufacturingSpecs.kitMotorCodes || []).find(x => String(x.motorItem).toUpperCase() === trvMotor.toUpperCase())
            : null;
        const theirSku = mc?.fabSku || row?.clientSku || '';
        const mcNet = mc && Number.isFinite(parseFloat(mc.net)) ? parseFloat(mc.net) : null;
        // NO NetSuite identity by design (noNs) — the SO push consumes exploded components plus a
        // generic traverse $-holder, never the kit itself.
        setCart(prev => [...prev, {
            key: `${trvKit.id}-${Date.now()}`,
            itemId: trvKit.id, erp: mc?.code || trvKit.legacyErpId, nsId: '', name: trvKit.itemName || trvKit.legacyErpId,
            aliasErp: theirSku, aliasItemId: null,
            qty: 1, note: `${feet}ft system — 4ft set${feet < billFeet ? ' (min charge)' : ''} · ${trvFinish}${trvProj ? ` · ${projLabel(trvProj)}` : ''}${mc ? ` · ${trvMotor}` : ''}`,
            bin: '', packUom: '', packSize: 1,
            rateOverride: mcNet, // per-motor kits price at THEIR number; base kits price from the row (null → rateForLine)
            kitKey: null, kitName: null, kitBrand: null, kitFinish: '',
            // trvProj rides the LINE, not the kit record: the same kit sells at any of the three
            // depths, so the bracket the push consumes is a property of this order.
            trvFinish, trvProj, trvMotor: mc ? trvMotor : '', trvFeet: billFeet, trvKitCode: mc?.code || trvKit.legacyErpId,
        }]);
        const extra = billFeet - (align.minFeet || 4);
        const perFoot = parseFloat(row?.perFootPrice);
        if (extra > 0) setCart(prev => [...prev, {
            key: `${trvKit.id}-ft-${Date.now()}`,
            itemId: trvKit.id, erp: mc?.code || trvKit.legacyErpId, nsId: '', name: trvKit.itemName || trvKit.legacyErpId,
            aliasErp: theirSku, aliasItemId: null,
            qty: extra, note: `Additional foot · ${trvFinish}`,
            bin: '', packUom: '', packSize: 1,
            rateOverride: Number.isFinite(perFoot) ? perFoot : 0,
            kitKey: null, kitName: null, kitBrand: null, kitFinish: '',
            trvFinish, trvProj, trvKitCode: mc?.code || trvKit.legacyErpId, trvIsFeet: true,
        }]);
        // The components configurator opens NOW — required at checkout, and this IS checkout for
        // a kit order. Skip stays possible (the operator may be quoting blind), but the default
        // path walks through it.
        setTrvCfg({ drive: String(align.drive).toUpperCase(), feet: billFeet, kitCode: mc?.code || trvKit.legacyErpId, finish: trvFinish,
            trackCount: String(align.setup).toUpperCase() === 'DOUBLE' && String(align.frontRail).toUpperCase() !== 'RING' ? 2 : 1 });
        setTrvCode(''); setTrvKitId(''); setTrvFeet(''); setTrvMotor(''); setTrvFinish(''); setTrvProj('');
    };

    // Configurator lines → cart. Every line is a REAL library item (they consume inventory):
    // included lines ride rate 0, billables at the customer's price — both push as real NetSuite
    // lines, so no special casing downstream.
    const applyTrvComponents = (cfgLines) => {
        const byCode = (c) => allItems.find(x => String(x.legacyErpId || x.itemId || '').toUpperCase() === String(c).toUpperCase());
        let missing = 0;
        cfgLines.forEach(cl => {
            const it = byCode(cl.code);
            if (!it) { missing++; return; }
            const row = findClientPriceRow(it.clientPricing, custKeys);
            pushLine(it, cl.qty, `${cl.why}${trvCfg?.finish ? ` · ${trvCfg.finish}` : ''} [${trvCfg?.kitCode || 'traverse'}]`, null, { noPack: true, rateOverride: cl.billable ? cl.rate : 0, aliasErp: row?.clientSku || '' });
        });
        if (missing) alert(`${missing} component code(s) not in the library — not added. Check the rules doc against the Master Library.`);
        setTrvCfg(null);
    };

    const pushLine = (it, qty, note, kitMeta, opts) => {
        if (!it) return;
        const pack = opts?.noPack ? { uom: '', size: 1 } : packForItem(it);
        // Captured at ADD time so the line keeps the identity it was sold under even if the
        // operator changes the collection scope afterwards.
        const face = aliasFaceOf(it);
        setLastCreated(null);
        setCart(prev => [...prev, {
            key: `${it.id}-${Date.now()}-${Math.round(prev.length)}`,
            // noNs: a line with NO NetSuite identity BY DESIGN (traverse kit + per-foot lines —
            // the kit is the sales face; NetSuite gets the exploded components via the CPQ-shaped
            // handoff). Without this, nsIdOf's legacyErpId fallback would push the kit CODE as an
            // item id and the SO line would 400.
            itemId: it.id, erp: erpOf(it), nsId: opts?.noNs ? '' : nsIdOf(it), name: it.itemName || erpOf(it),
            // Customer-facing alias: shown on the quote/SO/invoice and priced from. The REAL item
            // above is what we stock, pick, barcode and send to NetSuite.
            // opts.aliasErp: the customer's part# straight from a clientPricing row (traverse
            // components) — alias DOCS are a different mechanism and most components have none.
            aliasErp: (opts && opts.aliasErp) || (face ? aliasCodeFor(face, it) : ''), aliasItemId: (opts && opts.aliasItemId) || (face ? face.id : null),
            qty: Math.max(1, parseInt(qty) || 1), note: note || '',
            bin: it.manufacturingSpecs?.homeBin || it.binLocation || '',
            // SELLING unit. qty means packs; packSize converts to the each count we stock, pick and
            // transmit. packUom '' / packSize 1 = a loose each line, exactly as before packs existed.
            packUom: pack.uom, packSize: pack.size,
            // Fees priced off a master list (rush) bill at the list amount, not the item's price.
            rateOverride: (opts && opts.rateOverride != null) ? opts.rateOverride : null,
            // What the floor paints it (a to-be-finished line), and the fee rule that prices it.
            ...(opts && opts.finishCode ? { finishCode: opts.finishCode } : {}),
            ...(opts && opts.toBeFinished ? { toBeFinished: true } : {}),
            ...(opts && opts.feeRule ? { feeRule: opts.feeRule } : {}),
            ...(opts && opts.perFoot ? { perFoot: true, feetPer: parseFloat(opts.feetPer) || 1 } : {}),
            // Kit lines carry their kit identity so pricedCart can apply KIT pricing live.
            kitKey: kitMeta?.kitKey || null, kitName: kitMeta?.kitName || null, kitBrand: kitMeta?.kitBrand || null, kitFinish: kitMeta?.kitFinish || ''
        }]);
    };

    const addQuick = () => {
        const it = itemById(quickItemId);
        if (!it) return alert('Pick a stocked item first.');
        if (!(parseInt(quickQty) > 0)) return alert('Enter a quantity.');
        pushLine(it, quickQty, '');
        setQuickItemId(''); setQuickQty('');
        addLog(`Added ${erpOf(it)} ×${quickQty}`, 'success');
    };

    // ── TO BE FINISHED ───────────────────────────────────────────────────────────────────────
    // The RAW item — the code before the "/" — because that is what the floor takes off the shelf
    // and paints. Deliberately NOT scoped to the collection selector: a mill part is often tagged
    // for nothing, and a picker that hides the item you are trying to order reads as broken.
    // ALIAS DOCS BELONG IN THIS POOL (Stuart 2026-08-30: typed the alias he built for READ and
    // got "No matches" — the old filter excluded alias records outright). The alias appears under
    // ITS code and name; adding it dereferences to the real item for stock/BOM/NetSuite while the
    // line prices from the alias and prints its code — the app-wide alias rule.
    const rawFindReal = (t) => allItems.find(p => [p.id, p.itemId, p.legacyErpId].map(x => String(x || '').toUpperCase()).includes(String(t || '').toUpperCase())) || null;
    const rawItems = useMemo(() => {
        const rawOk = (it) => !!it
            && !isFinished(it)                            // no /SUFFIX — this is the mill part
            && !isFeeItemRecord(it)
            && it.partClass !== 'Kit'
            && it.manufacturingSpecs?.isRetired !== true
            && !!erpOf(it);
        return allItems.filter(it => {
            if (isAliasDoc(it)) {
                if (it.manufacturingSpecs?.isRetired === true || !erpOf(it)) return false;
                const real = realPartOf(it, rawFindReal);
                return real !== it && rawOk(real);        // alias of a valid raw item → offered
            }
            return rawOk(it);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [allItems]);
    // Every fee record in the brand — the same identity test 4.6 and CPQ use, so a record that
    // reads as a fee there reads as one here. (`feeItems(kw)` above is a different thing: the
    // kit builder's keyword pick of cut / splice / rush.)
    const allFeeItems = useMemo(() => allItems.filter(it =>
        isFeeItemRecord(it) && it.manufacturingSpecs?.isRetired !== true), [allItems]);

    // ── THIS CUSTOMER'S CHECKOUT ITEMS (Stuart 2026-08-25) ───────────────────────────────────
    // The items assigned to the picked customer in 4.6 (manufacturingSpecs.checkoutCustomers) —
    // the SAME per-customer set CPQ checkout offers them, so an order entered here and an order
    // configured there see one list, priced by the one chain (rateFor → priceChoice → their row).
    // Fees and real items both: a fee rides its rule; a real item rides as a normal line.
    const custCheckoutItems = useMemo(() => (customerId
        ? allItems.filter(it => it.manufacturingSpecs?.isRetired !== true && isCheckoutForCustomer(it, customerId))
        : []), [allItems, customerId]);
    const addCustCheckout = (it) => {
        const isFee = isFeeItemRecord(it);
        const rule = isFee ? feeRuleOf(it.manufacturingSpecs) : null;
        const qty = (isFee && rule.mode === 'PERCENT') ? 1 : (parseInt(ccQty[it.id]) || 1);
        pushLine(it, qty, isFee && rule.mode === 'PERCENT' ? feeRuleSummary(rule, null) : '', null,
            isFee ? { noPack: true, feeRule: rule } : {});
        addLog(`Customer add-on: ${erpOf(it)}${isFee && rule.mode === 'PERCENT' ? ` (${rule.percent}% of the order)` : ` ×${qty}`}`, 'success');
        setCcQty(prev => ({ ...prev, [it.id]: '' }));
    };

    const tbfItem = itemById(tbfItemId) || null;
    // Sold by the FOOT? The REAL item's UOM governs — an alias whose UOM drifted from its main
    // cannot mis-shape the order (the Library banner offers the align; ordering never trusts it).
    const FOOT_UOMS = ['FT', 'FOOT', 'FEET'];
    const tbfReal = tbfItem ? (isAliasDoc(tbfItem) ? (realPartOf(tbfItem, rawFindReal) || tbfItem) : tbfItem) : null;
    const tbfPerFoot = !!tbfReal && FOOT_UOMS.includes(String(tbfReal.manufacturingSpecs?.uom || '').toUpperCase());
    // What this customer pays for it — their 4.6 row, else our base price. Shown rather than
    // assumed, and editable: an order taken over the phone sometimes carries a number that was
    // agreed before the row existed.
    const tbfResolved = tbfItem ? rateFor(tbfItem) : 0;
    useEffect(() => { setTbfPrice(tbfItem ? String(tbfResolved) : ''); }, [tbfItemId]); // eslint-disable-line react-hooks/exhaustive-deps

    const addToBeFinished = () => {
        const it = tbfItem;
        if (!it) return alert('Pick the raw item — the code before the "/".');
        if (!tbfFinish) return alert('Pick the finish. A part cannot go to the floor as "painted" without saying which paint.');
        if (!(parseInt(tbfQty) > 0)) return alert('Enter a quantity.');
        // An ALIAS pick dereferences here: the LINE is the real item (stock, BOM, NetSuite, the
        // floor); the alias rides as the customer-facing code and the line PRICES from it
        // (rateForLine reads aliasItemId first). The price shown above already came from the alias.
        const isAl = isAliasDoc(it);
        const real = isAl ? realPartOf(it, rawFindReal) : it;
        if (isAl && (!real || real === it)) return alert(`${erpOf(it)} is an alias but its main item (${aliasTargetIdOf(it)}) is not in this brand's library — fix the alias link first.`);
        const feetPer = parseFloat(tbfFeet);
        if (tbfPerFoot && !(feetPer > 0)) return alert(`${erpOf(real)} sells by the FOOT — enter the feet per piece (the cut length), then how many pieces.`);
        if (isAl && String(it.manufacturingSpecs?.uom || 'EA').toUpperCase() !== String(real.manufacturingSpecs?.uom || 'EA').toUpperCase()) {
            addLog(`⚠ Alias ${erpOf(it)} UOM (${it.manufacturingSpecs?.uom || 'EA'}) disagrees with ${erpOf(real)} (${real.manufacturingSpecs?.uom || 'EA'}) — the REAL item's UOM was used. Align the alias in the Library.`, 'warn');
        }
        const typed = parseFloat(tbfPrice);
        const priced = Number.isFinite(typed) ? typed : tbfResolved;
        const fin = finishList.find(f => f.code === tbfFinish);
        pushLine(real, tbfQty, `TO BE FINISHED · ${tbfFinish}${fin?.name && fin.name !== tbfFinish ? ` (${fin.name})` : ''}${tbfPerFoot ? ` · Cut ${feetPer} ft` : ''}`, null, {
            noPack: true,                                  // a made-to-order part is not a pack
            // Only override when the operator actually changed the number — otherwise the line
            // keeps repricing live, which is how every other line on this tab behaves.
            rateOverride: Math.abs(priced - tbfResolved) > 0.004 ? priced : null,
            finishCode: tbfFinish, toBeFinished: true,
            ...(isAl ? { aliasErp: erpOf(it), aliasItemId: it.id } : {}),
            ...(tbfPerFoot ? { perFoot: true, feetPer } : {}),
        });
        addLog(`To be finished: ${isAl ? `${erpOf(it)} (= ${erpOf(real)})` : erpOf(it)} ×${tbfQty}${tbfPerFoot ? ` pcs @ ${feetPer} ft (${(feetPer * (parseInt(tbfQty) || 0)).toFixed(0)} ft billed)` : ''} in ${tbfFinish}`, 'success');
        setTbfItemId(''); setTbfFinish(''); setTbfQty(''); setTbfPrice(''); setTbfFeet('');
    };

    // ── FEES ─────────────────────────────────────────────────────────────────────────────────
    // A flat fee bills qty × its price. A PERCENTAGE fee has no price of its own — it is worked
    // out from the order, and it is worked out LIVE in pricedCart, so adding a line after the fee
    // moves the fee with it.
    const feeItem = itemById(feeItemId) || null;
    const feeRule = feeItem ? feeRuleOf(feeItem.manufacturingSpecs) : null;
    const addFee = () => {
        const it = feeItem;
        if (!it) return alert('Pick a fee.');
        const rule = feeRuleOf(it.manufacturingSpecs);
        const qty = rule.mode === 'PERCENT' ? 1 : parseInt(feeQty);
        if (rule.mode !== 'PERCENT' && !(qty > 0)) return alert('Enter a quantity.');
        pushLine(it, qty, rule.mode === 'PERCENT' ? feeRuleSummary(rule, null) : '', null, {
            noPack: true,
            // The rule rides the LINE so pricedCart can price a percentage off the finished order
            // rather than off whatever the cart happened to hold at the moment it was added.
            feeRule: rule,
        });
        addLog(`Fee added: ${erpOf(it)}${rule.mode === 'PERCENT' ? ` (${rule.percent}% of the order)` : ` ×${qty}`}`, 'success');
        setFeeItemId(''); setFeeQty('');
    };

    // Resolve a kit-builder config into flat lines against CURRENT inventory (prices re-resolve live).
    // opts.noPack marks fee lines — a cut or a rush charge is never sold by the pack.
    const resolveKb = (cfg) => {
        const out = [];
        const add = (id, qty, note, opts) => { const it = itemById(id); if (it && qty > 0) out.push({ it, qty: parseInt(qty) || 1, note: note || '', opts: opts || null }); };
        add(cfg.poleId, cfg.poleQty, '');
        add(cfg.bracketId, cfg.bracketQty, '');
        add(cfg.centerBracketId, cfg.centerBracketQty, 'center bracket');
        add(cfg.ringId, cfg.ringQty, '');
        add(cfg.finialId, cfg.finialQty, '');
        add(cfg.cutId, cfg.cutQty, cfg.cutLen ? `cut @ ${cfg.cutLen}` : 'cut', { noPack: true });
        add(cfg.spliceId, cfg.spliceQty, 'splice', { noPack: true });
        // Miter returns are configured in CPQ now; kept only so pre-existing saved kits still resolve.
        add(cfg.miterId, cfg.miterQty, 'miter return', { noPack: true });
        // RUSH: the chosen "Rush Fee Type" sets BOTH the note and the billed rate; the item is only
        // the vessel that carries it to NetSuite. No type chosen = no rush line.
        if (cfg.rushType) {
            const amt = rushFeeAmountOf(cfg.rushType);
            add(cfg.rushId, cfg.rushQty, rushFeeLabelOf(cfg.rushType) || 'rush', { noPack: true, rateOverride: amt });
        }
        return out;
    };

    const addKbToCart = () => {
        // A slot with an item and no qty would resolve to nothing at all — say so instead.
        const noQty = KB_SLOTS.filter(s => kb[s.idKey] && !(parseInt(kb[s.qtyKey]) > 0)).map(s => s.label);
        if (noQty.length) return alert(`Enter a quantity for: ${noQty.join(', ')}.`);
        if (kb.rushType && !(parseInt(kb.rushQty) > 0)) return alert('Enter a quantity for the Rush Fee.');
        if (kb.rushType && !kb.rushId) return alert('Pick the rush fee ITEM too — a fee needs a NetSuite item to bill against.');
        if (kb.rushType && rushFeeAmountOf(kb.rushType) === null) return alert(`"${kb.rushType}" carries no amount. Edit it in Mass Update 4.5 → Rush Fee Types to end with the price, e.g. "RUSH 3 DAY - 75".`);
        const lines = resolveKb(kb);
        if (!lines.length) return alert('Fill at least one field in the kit builder.');
        lines.forEach(l => pushLine(l.it, l.qty, l.note, null, l.opts));
        addLog(`Kit builder → ${lines.length} line(s) added`, 'success');
        setKb(EMPTY_KB);
    };

    // Finish-variant swap (Stuart 2026-07-17): stocked components follow the same "/<FIN>"
    // suffix rule as production — HCUMP410/BL → HCUMP410/SG. Components without a "/" are
    // finish-agnostic and pass through unchanged.
    const variantFor = (it, fin) => {
        const erp = erpOf(it);
        if (!erp.includes('/')) return it;
        const target = `${erp.split('/')[0]}/${String(fin).toUpperCase()}`;
        return allItems.find(x => erpOf(x) === target) || null;
    };

    const addSavedKit = (kit, finCode) => {
        const fins = Array.isArray(kit.finishCodes) ? kit.finishCodes : [];
        if (!finCode && fins.length === 1) finCode = fins[0];
        if (!finCode && fins.length > 1) { setKitFinishPick(kit); return; } // choose a color first
        const lines = resolveKb(kit.cfg || {});
        if (!lines.length) return alert('That kit has no resolvable stocked items right now.');
        let resolved = lines;
        if (finCode) {
            const missing = [];
            resolved = [];
            lines.forEach(l => {
                const v = variantFor(l.it, finCode);
                if (v) resolved.push({ ...l, it: v });
                else missing.push(`${erpOf(l.it).split('/')[0]}/${String(finCode).toUpperCase()}`);
            });
            if (missing.length) return alert(`Can't add "${kit.name}" in ${finCode} — no stocked item for:\n\n${missing.map(m => `• ${m}`).join('\n')}\n\nCreate/stock those variants, or remove ${finCode} from this kit's available finishes.`);
        }
        // One kitKey per ADD — adding the same kit twice makes two independently-priced groups.
        const kitKey = `${kit.name}-${Date.now()}`;
        resolved.forEach(l => pushLine(l.it, l.qty, l.note, { kitKey, kitName: kit.name, kitBrand: kit.brand, kitFinish: finCode ? String(finCode).toUpperCase() : '' }, l.opts));
        addLog(`Kit "${kit.name}"${finCode ? ` · ${finCode}` : ''} → ${resolved.length} line(s) added`, 'success');
    };

    const saveKit = async () => {
        const name = (kitName || '').trim();
        if (!name) return alert('Name the kit first.');
        if (!resolveKb(kb).length) return alert('Build a kit (fill some fields) before saving.');
        try {
            const ref = doc(db, KITS_DOC.col, KITS_DOC.id);
            const snap = await getDoc(ref);
            const existing = snap.exists() && Array.isArray(snap.data().kits) ? snap.data().kits : [];
            const prior = existing.find(k => k.name === name && k.brand === activeBrand);
            const others = existing.filter(k => !(k.name === name && k.brand === activeBrand));
            // Re-saving a kit's CONTENTS never wipes its filing/pricing (collection, basePrice,
            // clientPricing survive an overwrite).
            const next = [...others, {
                name, brand: activeBrand, cfg: Object.fromEntries(KIT_CFG_KEYS.map(k => [k, kb[k]])),
                collection: (kitCollection || '').trim() || prior?.collection || '',
                basePrice: prior?.basePrice ?? '', clientPricing: prior?.clientPricing || [],
                savedBy: currentUser || '', savedAt: Date.now()
            }];
            await setDoc(ref, { kits: next }, { merge: true });
            setKitName(''); setKitCollection('');
            addLog(`Saved kit "${name}"`, 'success');
        } catch (e) { addLog(`Save kit failed: ${e.message}`, 'error'); }
    };

    // Rewrite one kit's metadata (pricing / collection) in place.
    const updateKitMeta = async (kitRef, patch) => {
        const ref = doc(db, KITS_DOC.col, KITS_DOC.id);
        const snap = await getDoc(ref);
        const existing = snap.exists() && Array.isArray(snap.data().kits) ? snap.data().kits : [];
        await setDoc(ref, { kits: existing.map(k => (k.name === kitRef.name && k.brand === kitRef.brand) ? { ...k, ...patch } : k) }, { merge: true });
    };

    // Effective KIT price for the CURRENT customer: clientPricing row → base kit price → null
    // (null = no kit pricing, lines bill at their own item rates).
    const effectiveKitPrice = (kitName2, kitBrand) => {
        const kit = kits.find(k => k.name === kitName2 && k.brand === kitBrand);
        if (!kit) return null;
        const cust = clientPriceFor(kit.clientPricing, custKeys);
        if (cust != null) return cust;
        const bp = parseFloat(kit.basePrice);
        return (kit.basePrice !== '' && kit.basePrice !== undefined && kit.basePrice !== null && !isNaN(bp)) ? bp : null;
    };

    const deleteKit = async (kit) => {
        if (!window.confirm(`Delete saved kit "${kit.name}"?`)) return;
        try {
            const ref = doc(db, KITS_DOC.col, KITS_DOC.id);
            const snap = await getDoc(ref);
            const existing = snap.exists() && Array.isArray(snap.data().kits) ? snap.data().kits : [];
            await setDoc(ref, { kits: existing.filter(k => !(k.name === kit.name && k.brand === kit.brand)) }, { merge: true });
            addLog(`Deleted kit "${kit.name}"`, 'info');
        } catch (e) { addLog(`Delete kit failed: ${e.message}`, 'error'); }
    };

    const setQty = (key, q) => setCart(prev => prev.map(l => l.key === key ? { ...l, qty: Math.max(1, parseInt(q) || 1) } : l));
    // ── EVERY LINE CAN NAME ITS ROOM (Stuart 2026-08-31) ────────────────────────────────────
    // One order covers several windows, so the room belongs on the LINE, not only in the header
    // sidemark. The memo prints on the customer's quote beside the line it describes, rides that
    // line's NetSuite Tag (custcol3 — the header sidemark stays the fallback), and is stored on
    // the sales-order line so the floor and the packing station read the same room.
    const setLineMemo = (key, v) => setCart(prev => prev.map(l => l.key === key ? { ...l, lineMemo: String(v || '').slice(0, 120) } : l));

    // ── A SAVED ORDER LEAVES NOTHING BEHIND (Stuart 2026-08-31) ─────────────────────────────
    // The cart emptied on save but the HEADER did not: the PO, the sidemark, the internal memo,
    // the need-by, the production notes, the shipping override and any half-finished kit picker
    // all survived and silently attached themselves to the next order — a quote's room memo on
    // somebody else's job. The customer stays selected (the counter usually takes another order
    // for the same account, and it is in plain sight at the top); everything that belonged to
    // THAT order goes.
    const resetOrderEntry = () => {
        setCart([]); setJobName('');
        setSoExtras({ po: '', sidemark: '', internalMemo: '', needBy: '', prodNotes: '' });
        setShip({ method: 'SAVED', addressId: '', amount: '', custom: { attention: '', addressee: '', addr1: '', addr2: '', city: '', state: '', zip: '', country: 'US' } });
        setTrvCfg(null); setTrvCode(''); setTrvKitId(''); setTrvFeet(''); setTrvMotor(''); setTrvFinish(''); setTrvProj('');
        setTbfItemId(''); setTbfFinish(''); setTbfQty(''); setQuickQty('');
        setEditingSo(null); setReopenedQuote('');
    };
    const removeLine = (key) => setCart(prev => prev.filter(l => l.key !== key));

    // LIVE pricing (Stuart 2026-07-17): rates resolve at RENDER/PUSH time, never frozen at add
    // time — so picking the customer before OR after filling the cart reprices every line
    // (item clientPricing included). A kit group with a kit price distributes it across the
    // group's lines proportionally to their standard subtotals (2dp, LAST line absorbs the
    // rounding) so the SO sums to the kit price; kits without a price bill per item.
    //
    // PACKS (2026-07-25): `rate` is always the price of ONE EACH, and every subtotal multiplies by
    // the each count (qty × packSize). A 7-pack of $4 rings at qty 2 is 14 × $4 — so kit
    // distribution, the cart total and the NetSuite rate all stay in the same unit as stock.
    const rateForId = (id) => { const it = itemById(id); return it ? rateFor(it) : 0; };
    // A line sold under an alias bills at the ALIAS's price — that's the price list the customer is
    // buying from. An unpriced alias doc falls back to the real item, so a missing price can never
    // silently zero a line.
    const rateForLine = (l) => {
        if (l.aliasItemId) { const a = itemById(l.aliasItemId); if (a) { const r = rateFor(a); if (r > 0) return r; } }
        return rateForId(l.itemId);
    };
    const pricedCart = useMemo(() => {
        const rateMap = new Map();
        const byKit = {};
        cart.forEach(l => {
            // A rate-overridden line (rush fee) is priced by its master-list amount and never
            // absorbs kit distribution — it isn't part of the kit's value.
            if (l.rateOverride != null) rateMap.set(l.key, l.rateOverride);
            else if (l.kitKey) (byKit[l.kitKey] = byKit[l.kitKey] || []).push(l);
            else rateMap.set(l.key, rateForLine(l));
        });
        Object.values(byKit).forEach(group => {
            const kp = effectiveKitPrice(group[0].kitName, group[0].kitBrand);
            const stds = group.map(l => ({ l, std: rateForLine(l), each: Math.max(1, eachQtyOf(l)) }));
            if (kp === null) { stds.forEach(({ l, std }) => rateMap.set(l.key, std)); return; }
            const S = stds.reduce((s, x) => s + x.std * x.each, 0);
            let spent = 0;
            stds.forEach(({ std, l, each }, i) => {
                let rate;
                if (i === stds.length - 1) {
                    rate = Math.round(((kp - spent) / each) * 100) / 100; // absorbs rounding
                } else {
                    const share = S > 0 ? (kp * (std * each) / S) : (kp / group.length);
                    rate = Math.floor((share / each) * 100) / 100;
                }
                rate = Math.max(0, rate);
                spent += rate * each;
                rateMap.set(l.key, rate);
            });
        });
        // ── PERCENTAGE FEES PRICE OFF THE ORDER, SO THEY GO LAST (Stuart 2026-08-22) ──────────
        // The base is everything that is not itself a fee — the same base CPQ uses (parts before
        // fees and before shipping), read through the same Shared/feeRules arithmetic, so 25% means
        // the same number whichever door the order came through. Two percentage fees on one order
        // therefore never compound, and a $100 floor still holds on a small one.
        const pct = cart.filter(l => l.feeRule && l.feeRule.mode === 'PERCENT');
        if (pct.length) {
            const isFeeLine = (l) => !!l.feeRule || (() => { const it = itemById(l.itemId); return !!it && isFeeItemRecord(it); })();
            const base = cart.filter(l => !isFeeLine(l))
                .reduce((sum, l) => sum + (rateMap.get(l.key) || 0) * Math.max(1, eachQtyOf(l)), 0);
            pct.forEach(l => rateMap.set(l.key, computeFee({ rule: l.feeRule, qty: 1, configSubtotal: base }).amount));
        }
        return cart.map(l => ({ ...l, rate: rateMap.get(l.key) ?? 0, eachQty: eachQtyOf(l) }));
    }, [cart, customerId, kits, allItems]); // eslint-disable-line react-hooks/exhaustive-deps
    const cartTotal = pricedCart.reduce((s, l) => s + l.rate * l.eachQty, 0);

    const myKits = kits.filter(k => k.brand === activeBrand);
    // Collections this customer is entitled to in the PORTAL (CRM → Portal Access). Surfaced here
    // as guidance — the internal counter can still sell anything.
    const custCollections = (selectedCustomer?.portalCollections || []).map(c => String(c).toUpperCase());

    // asType: 'salesorder' | 'estimate' — the team wants BOTH doors (Stuart 2026-08-13: "a button
    // next to the sales order button to push it in as a quote, so they have the option of either").
    const pushToNetSuite = async (asType = 'salesorder') => {
        const asLabel = asType === 'estimate' ? 'QUOTE (estimate)' : 'SALES ORDER';
        if (!customerId) return alert('Select a customer first.');
        if (cart.length === 0) return alert('Cart is empty.');
        // TRAVERSE ORDERS (Stuart 2026-08-13): the kit + feet lines never push as themselves —
        // NetSuite gets the exploded COMPONENTS (consumed from inventory, $0 rate) plus ONE generic
        // traverse $-holder carrying the order's traverse dollars so the SO total matches the quote.
        const trvOrder = pricedCart.filter(l => l.trvKitCode);
        const unmapped = pricedCart.filter(l => !l.nsId && !l.trvKitCode);
        if (unmapped.length) {
            if (!window.confirm(`${unmapped.length} line(s) have no NetSuite ID and will be skipped:\n\n${unmapped.map(l => `• ${l.erp || l.name}`).join('\n')}\n\nContinue with the rest?`)) return;
        }
        const lines = pricedCart.filter(l => l.nsId);
        if (!lines.length && !trvOrder.length) return alert('No lines have a NetSuite item ID. Sync these items to NetSuite first.');
        if (!window.confirm(`Create a ${asLabel} for ${selectedCustomer?.name || customerId} with ${lines.length} stock line(s)${trvOrder.length ? ` + a traverse system (components consumed + $ holder)` : ''}?\n\nThe record is saved HERE first, and the NetSuite write rides the staged sync (posts in ~1 min — RTG Transmit Log / 11.1 Sync Queue show progress).`)) return;

        setPushing(true);
        try {
            let nsCustomerId = customerId.startsWith('CUST-') ? customerId.replace('CUST-', '') : customerId;
            const brandMapping = BRAND_NETSUITE_MAP[activeBrand] || { subsidiary: "2", location: "17" };
            // Mainline memo = the sidemark/job — ONE value (the CPQ push's rule), Quick Ship label
            // only when neither is given.
            const memoText = (String(soExtras.sidemark || '').trim() || String(jobName || '').trim() || 'Quick Ship').slice(0, 40);

            // ── traverse explosion ───────────────────────────────────────────────────────────
            const trvPushLines = [];
            // ── THE SAME KIT, IN WORDS THE CUSTOMER CAN CHECK (Stuart 2026-08-31) ────────────
            // The NetSuite payload below already says everything: the kit as a priced holder line
            // and its contents beneath it. The QUOTE document was built from the cart alone, so it
            // printed the loose components and the kit's dollars appeared only in the total — a
            // quote with no kit code and no contents is one the client cannot verify. This mirror
            // is built from the very same data, so the paper and the ERP can never disagree.
            const trvDocLines = [];
            const kitMemo = (trvOrder.find(l => String(l.lineMemo || '').trim()) || {}).lineMemo || '';
            if (trvOrder.length) {
                // The $-holder: a generic traverse non-inventory item (made once with the 11.1
                // item tool), found by its code; falls back to the CPQ rollup item so a missing
                // holder can never silently drop the dollars.
                const holderDoc = allItems.find(x => String(x.legacyErpId || x.itemId || '').toUpperCase() === 'CE-TRV-SYSTEM');
                const holderNs = holderDoc?.netSuiteInternalId || '61502';
                if (!holderDoc) addLog('No CE-TRV-SYSTEM holder item found — using the CPQ rollup item (61502). Create it with the 11.1 tool and sync to use a dedicated holder.', 'warn');
                const trvTotal = trvOrder.reduce((sum, l) => sum + (l.rate || 0) * l.eachQty, 0);
                const kitLines = trvOrder.filter(l => !l.trvIsFeet);
                trvPushLines.push({
                    item: { id: String(holderNs) }, quantity: 1, rate: parseFloat(trvTotal.toFixed(2)), price: { id: '-1' },
                    description: `${kitLines.map(l => `${l.aliasErp ? l.aliasErp + ' — ' : ''}${l.erp}`).join(' + ')} · ${kitLines.map(l => l.note).join(' · ')} [traverse system — components below]`,
                });
                // ⚠ ONE HOLDER LINE FOR NETSUITE, ONE LINE PER KIT FOR THE CUSTOMER (Stuart
                // 2026-08-31). NetSuite wants the traverse dollars on a single non-inventory
                // holder — that is its design and it stays. The customer's document must not
                // inherit it: two kits and their extra footage collapsed into one $1,428 line
                // reading "6ft system · 8ft system" is impossible to check. So the mirror is
                // built per CART LINE — each kit its own line at its own price, each kit's parts
                // beneath it, and the additional-foot charge as its own line under the kit it
                // extends. The rows still sum to the holder's total, because they are its parts.
                const byId = (c) => allItems.find(x => String(x.legacyErpId || x.itemId || '').toUpperCase() === String(c).toUpperCase());
                // ── A SUB-FINISH SUFFIX IS A FINISH, NOT AN ITEM (Stuart 2026-08-31) ─────────
                // The family's track code carries the base colour it is finished in
                // (H1-2TRVTRK/C), and that /C is right for the floor — but the library and
                // NetSuite stock the bare H1-2TRVTRK, so the lookup missed and the TRACK was
                // dropped from the consumption entirely. The Fabricut estimate went out with a
                // fascia, brackets, a splice and a motor, and no track at all. So an unresolved
                // code now falls back to its base item and the suffix travels on as what it is.
                const resolveComponent = (code) => {
                    const exact = byId(code);
                    if (exact) return { part: exact, suffix: '' };
                    const m = String(code || '').match(/^(.+)\/([A-Za-z0-9]+)$/);
                    if (m) { const base = byId(m[1]); if (base) return { part: base, suffix: m[2].toUpperCase() }; }
                    return { part: null, suffix: '' };
                };
                let rulesDoc = null;
                const feetPool = trvOrder.filter(x => x.trvIsFeet);
                for (const l of kitLines) {
                    trvDocLines.push({
                        kind: 'KIT', key: l.key, kitCode: String(l.trvKitCode || l.erp || '').toUpperCase(),
                        code: l.aliasErp || l.erp, name: l.name, note: l.note,
                        qty: l.eachQty || 1, rate: l.rate || 0, memo: String(l.lineMemo || '').trim(),
                    });
                    const kitDoc = itemById(l.itemId);
                    const fam = kitDoc?.manufacturingSpecs?.kitFamily || 'H1-2TRV';
                    if (!rulesDoc) { try { const snap = await getDoc(doc(db, 'system', `traverse_rules_${fam}`)); rulesDoc = snap.exists() ? snap.data() : null; } catch { rulesDoc = null; } }
                    if (!rulesDoc) addLog(`No traverse rules doc for ${fam} — bracket/splice counts fall back to defaults. Re-run the 4.6 kit sheet import.`, 'warn');
                    const ex = explodeTraverse({ family: fam, align: kitDoc?.manufacturingSpecs?.kitAlign, feet: l.trvFeet, proj: l.trvProj, motorItem: l.trvMotor, rules: rulesDoc });
                    // SUB-FINISH ROUTING (Stuart 2026-08-13): an item marked usesSubFinish (the
                    // tracks) goes to the floor in the SUB color the mainline finish aligns to —
                    // P01 → C, EP5 → B — set per finish in the 4.5 editors. The "finish the track
                    // to match the fascia" upgrade is a configurator add-on fee that will override
                    // this per order when it lands.
                    //
                    // ⚠ THE BRACKETS GO WITH THE TRACK (Stuart 2026-08-22). They are made in the same
                    // two base colours and are chosen to match it, so a BOM that sent the track to
                    // bronze and the brackets to the customer's colour described a system nobody
                    // builds. The EXPLOSION now says which lines those are (`subFinish` on the line,
                    // from the family's subFinishRoles), so the routing no longer depends on every
                    // bracket item in the library having had the checkbox ticked — the item flag
                    // still counts, it is just no longer the only way to be right.
                    const finObj = finishList.find(f => f.code === String(l.trvFinish || '').toUpperCase());
                    ex.lines.forEach(c => {
                        const { part: cd, suffix: codeSub } = resolveComponent(c.code);
                        if (!cd) { addLog(`Component ${c.code} is not in the Master Library — NOT consumed (${c.why}). Check the code, or the traverse rules doc.`, 'warn'); return; }
                        if (!cd.netSuiteInternalId) { addLog(`Component ${cd.legacyErpId || c.code} has no NetSuite ID — NOT consumed (${c.why}).`, 'warn'); return; }
                        if (codeSub) addLog(`${c.code} → consuming ${cd.legacyErpId || c.code} (the /${codeSub} is the sub finish it is made in, not a separate item).`, 'info');
                        const takesSub = !!cd?.manufacturingSpecs?.usesSubFinish || !!c.subFinish;
                        const finShown = codeSub ? `${codeSub} (sub finish)`
                            : takesSub && finObj?.subFinishCode ? `${finObj.subFinishCode} (sub finish)` : (l.trvFinish || '');
                        if (takesSub && !finObj?.subFinishCode) addLog(`${c.code} (${c.role || 'sub-finish part'}) is made in the base colours, but ${l.trvFinish || 'the chosen finish'} has no aligned one (set it in 4.5) — pushing in the mainline finish.`, 'warn');
                        trvPushLines.push({
                            item: { id: String(cd.netSuiteInternalId) }, quantity: c.qty, rate: 0, price: { id: '-1' },
                            description: `${cd.legacyErpId || c.code} — ${cd.itemName || c.code} · ${c.why} · ${finShown} [consumed — $ in the traverse system line]`,
                        });
                        trvDocLines.push({ kind: 'PART', ofKey: l.key, code: cd.legacyErpId || c.code, name: cd.itemName || c.code, note: `${c.why}${finShown ? ` · ${finShown}` : ''}`, qty: c.qty, rate: 0 });
                    });
                    ex.skipped.forEach(sk => addLog(`Traverse: ${sk}`, 'info'));
                    // The extra footage beyond the kit's base length bills on its own line — the
                    // customer reads what the kit costs and what the length added, separately.
                    const fi = feetPool.findIndex(f => String(f.trvKitCode || '').toUpperCase() === String(l.trvKitCode || '').toUpperCase());
                    if (fi >= 0) {
                        const f = feetPool.splice(fi, 1)[0];
                        trvDocLines.push({ kind: 'FEET', ofKey: l.key, code: f.aliasErp || f.erp, name: f.name, note: f.note, qty: f.eachQty || 1, rate: f.rate || 0, memo: String(f.lineMemo || '').trim() });
                    }
                }
                // Any footage line whose kit never exploded still bills — never silently dropped.
                feetPool.forEach(f => trvDocLines.push({ kind: 'FEET', code: f.aliasErp || f.erp, name: f.name, note: f.note, qty: f.eachQty || 1, rate: f.rate || 0, memo: String(f.lineMemo || '').trim() }));
            }

            // Shipping — the exact shape ERPPushPull sends (proven against this account): saved
            // address by NetSuite Address Book id, or the custom override; a charge needs a ship
            // METHOD riding along or NetSuite 400s the order.
            const shippingPayload = {};
            if (ship.method === 'SAVED' && ship.addressId) shippingPayload.shipaddresslist = { id: ship.addressId };
            else if (ship.method === 'CUSTOM' && ship.custom.addr1) {
                shippingPayload.shippingaddress = {
                    attention: ship.custom.attention || '', addressee: ship.custom.addressee || '',
                    addr1: ship.custom.addr1 || '', addr2: ship.custom.addr2 || '',
                    city: ship.custom.city || '', state: String(ship.custom.state || '').toUpperCase().replace(/\./g, '').trim(),
                    zip: ship.custom.zip || '', country: { id: ship.custom.country || 'US' },
                };
            }
            const shipAmt = parseFloat(ship.amount) || 0;
            if (shipAmt > 0) {
                if (shipMethodRef.current === undefined) {
                    try {
                        const r = await nsProxyFetch({ targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql', method: 'POST', payload: { q: "SELECT id, itemid FROM item WHERE itemtype = 'ShipItem' AND NVL(isinactive,'F') = 'F' ORDER BY id" } });
                        const b = await r.json().catch(() => ({}));
                        const rows = (r.ok && b.items) || [];
                        const pick = rows.find(x => /ship|freight|delivery|best way/i.test(String(x.itemid))) || rows[0] || null;
                        shipMethodRef.current = pick ? { id: String(pick.id), name: String(pick.itemid) } : null;
                    } catch { shipMethodRef.current = null; }
                }
                if (shipMethodRef.current) { shippingPayload.shippingcost = parseFloat(shipAmt.toFixed(2)); shippingPayload.shipMethod = { id: shipMethodRef.current.id }; }
                else addLog(`⚠️ No active Ship Item in NetSuite — pushing WITHOUT the $${shipAmt.toFixed(2)} shipping charge; add it on the SO manually.`, 'warn');
            }

            // Header alignment (Stuart's NetSuite list, 2026-08-13): CE Sales Order form 177 /
            // CE Quote form 299 (proven by the CPQ estimate push) + Hardware class 2 — CE brand
            // only, other brands keep NS defaults. orderstatus is omitted: NS defaults to Pending
            // Fulfillment, exactly as specified.
            const lineTag = String(soExtras.sidemark || '').trim().slice(0, 300);
            const payload = {
                entity: { id: nsCustomerId },
                subsidiary: { id: brandMapping.subsidiary },
                location: { id: brandMapping.location },
                ...(activeBrand === 'ce' ? { customForm: { id: asType === 'estimate' ? '299' : '177' }, class: { id: '2' } } : {}),
                memo: memoText,
                ...(String(soExtras.po || '').trim() ? { otherRefNum: String(soExtras.po).trim().slice(0, 40) } : {}),
                ...(String(soExtras.internalMemo || '').trim() ? { custbody_bit_internalmemo: String(soExtras.internalMemo).trim().slice(0, 999) } : {}),
                ...shippingPayload,
                item: {
                    // PACKS never reach NetSuite: we stock and transmit EACH (2 × 7-pack = 14), and
                    // the pack only shows on the customer-facing quote/invoice. The description
                    // still names it so the SO reads the way the customer ordered.
                    items: lines.map(l => ({
                        item: { id: l.nsId.toString() },
                        quantity: l.eachQty,
                        rate: parseFloat((l.rate || 0).toFixed(2)),
                        price: { id: "-1" },
                        // The customer ordered the alias code — name it first so the SO reads the way
                        // they ordered, while the LINE ITEM stays the real stocked part.
                        description: `${l.aliasErp ? l.aliasErp + ' — ' : ''}${l.name}${l.note ? ' (' + l.note + ')' : ''}${l.packUom ? ' [' + l.qty + ' × ' + l.packUom + ']' : ''}${l.kitName ? ' [Kit: ' + l.kitName + (l.kitFinish ? ' - ' + l.kitFinish : '') + ']' : ''}${l.toBeFinished ? ` [TO BE FINISHED — ${l.finishCode || ''}]` : l.feeRule ? ' [fee]' : ' [Quick Ship stock]'}`,
                        ...((String(l.lineMemo || '').trim() || lineTag) ? { custcol3: String(l.lineMemo || '').trim().slice(0, 300) || lineTag } : {}),
                    })).concat(trvPushLines.map(t => (kitMemo || lineTag) ? { ...t, custcol3: String(kitMemo || lineTag).slice(0, 300) } : t))
                }
            };

            // ── LOCAL-FIRST + STAGED SYNC (Stuart 2026-08-25: uniform with the CPQ save buttons) ──
            // The record is created HERE first; the NetSuite write rides ns_outbox exactly like
            // every other push — staged, serial, retried, on RTG's Transmit Log — and the
            // writeBack stamps the returned NetSuite ids onto the local doc when it posts.
            const stamp = Date.now();
            if (asType === 'estimate') {
                // A Quick Ship QUOTE now leaves a real record: a jobs doc on the customer's CRM
                // pipeline. (It used to exist ONLY in NetSuite — zero local persistence.)
                const qJobId = `QSQUOTE-${stamp}`;
                await setDoc(doc(db, 'jobs', qJobId), {
                    jobId: qJobId, brandId: activeBrand, status: 'CONFIGURED', source: 'QUICKSHIP',
                    customer: { id: customerId, name: selectedCustomer?.name || customerId },
                    jobName: jobName || '', sidemark: String(soExtras.sidemark || '').trim(),
                    createdBy: { name: currentUser || '', via: 'QUICKSHIP' },
                    cpqData: {
                        totalPrice: lines.reduce((sum, l) => sum + l.rate * l.eachQty, 0) + trvPushLines.reduce((sum, t) => sum + ((t.rate || 0) * (t.quantity || 1)), 0),
                        // ── WHAT THE CLIENT HAS TO BE ABLE TO CHECK (Stuart 2026-08-31) ─────────
                        // The kit prints as ONE priced line under the code they ordered, and every
                        // part inside it prints beneath at no charge — the kit's dollars used to
                        // reach the paper only as the grand total, so the quote showed add-ons and
                        // a number that did not add up. Kit first, its contents indented under it,
                        // loose items after; each line says its own memo (the room).
                        breakdown: (() => {
                            const memoOf = (m) => String(m || '').trim() ? ` · 📍 ${String(m).trim()}` : '';
                            const cartRow = (l, indent) => ({
                                name: `${indent}${l.aliasErp || l.erp} — ${l.name}${l.perFoot ? ` [${l.qty} pc × ${l.feetPer} ft]` : ''}${l.toBeFinished ? ` [TO BE FINISHED — ${l.finishCode || ''}]` : ''}${memoOf(l.lineMemo)}`,
                                qty: l.eachQty, price: l.rate, total: l.rate * l.eachQty, legacyErpId: l.erp,
                                ...(indent ? { inKit: true } : {}),
                                ...(l.toBeFinished ? { toBeFinished: true, finishCode: l.finishCode || '' } : {}),
                            });
                            const partRow = (d) => ({ name: `   · ${d.code} — ${d.name}${d.note ? ` · ${d.note}` : ''}`, qty: d.qty, price: 0, total: 0, legacyErpId: d.code, inKit: true });
                            // The extra footage is a CHARGE, not a content — its own line, its own
                            // code, priced, sitting under the kit whose length it extends.
                            const feetRow = (d) => ({ name: `  ${d.code} — ${d.note || 'Additional foot'}${memoOf(d.memo)}`, qty: d.qty, price: d.rate, total: d.rate * d.qty, legacyErpId: d.code });
                            const used = new Set();
                            const rows = [];
                            trvDocLines.filter(d => d.kind === 'KIT').forEach(k => {
                                rows.push({ name: `${k.code} — ${k.name}${k.note ? ` · ${k.note}` : ''}${memoOf(k.memo)}`, qty: k.qty, price: k.rate, total: k.rate * k.qty, legacyErpId: k.code });
                                trvDocLines.filter(d => d.kind === 'PART' && d.ofKey === k.key).forEach(d => rows.push(partRow(d)));
                                // The components the operator picked for THIS kit — the configurator
                                // stamps its kit code into the line's note, which is the only tie
                                // back to the kit once they are ordinary cart lines.
                                lines.forEach(l => {
                                    if (used.has(l.key) || !k.kitCode) return;
                                    if (String(l.note || '').toUpperCase().includes(`[${k.kitCode}]`)) { used.add(l.key); rows.push(cartRow(l, '   · ')); }
                                });
                                trvDocLines.filter(d => d.kind === 'FEET' && d.ofKey === k.key).forEach(d => rows.push(feetRow(d)));
                            });
                            trvDocLines.filter(d => d.kind === 'FEET' && !d.ofKey).forEach(d => rows.push(feetRow(d)));
                            lines.filter(l => !used.has(l.key)).forEach(l => rows.push(cartRow(l, '')));
                            return rows;
                        })(),
                        cartItems: [],
                    },
                    // ── A QUOTE YOU CAN REOPEN (Stuart 2026-08-31) ──────────────────────────
                    // The printed breakdown is prose — a kit line reading "6ft system - 4ft set"
                    // cannot be turned back into a kit, its footage and its configurator picks.
                    // So the CART ITSELF rides along, exactly as it was typed, and the CRM's
                    // Reopen Order Entry hands it straight back to tab 7. Prices are NOT frozen
                    // here: the tab reprices on render, which is what it has always done.
                    quickShipCart: JSON.parse(JSON.stringify(cart || [])),
                    quickShipExtras: JSON.parse(JSON.stringify({ soExtras, ship, jobName: jobName || '' })),
                    ...(reopenedQuote ? { supersedes: reopenedQuote } : {}),
                    dateSaved: new Date().toISOString().split('T')[0], author: currentUser || '', createdAt: serverTimestamp(),
                });
                // The quote this one replaces stops being live paper.
                if (reopenedQuote) {
                    try {
                        await updateDoc(doc(db, 'jobs', reopenedQuote), { supersededBy: qJobId, status: 'SUPERSEDED', supersededAt: Date.now() });
                        addLog(`✎ Quote ${reopenedQuote} superseded by ${qJobId}.${'' } ⚠ Close the OLD estimate in NetSuite too.`, 'warn');
                    } catch (e) { addLog(`⚠ Could not mark ${reopenedQuote} superseded: ${e.message || e}`, 'error'); }
                }
                const obId = await enqueueNsWrite({
                    kind: 'estimate', label: `Quick Ship Quote · ${selectedCustomer?.name || customerId}`,
                    targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/estimate`,
                    method: 'POST', payload, sourceApp: 'QUICKSHIP', createdBy: currentUser || '',
                    writeBack: [{ collection: 'jobs', docId: qJobId, idField: 'netsuiteEstimateId', tranField: 'netsuiteEstimateNo', patch: { dateTransmitted: new Date().toISOString() } }],
                });
                addLog(`✅ Quote saved (${qJobId}) and queued to NetSuite (outbox ${obId}).`, 'success');
                alert(`✅ Quote saved on ${selectedCustomer?.name || customerId}'s pipeline (Tab 10) and queued to NetSuite — the estimate # lands on it in ~1 minute.`);
                setLastCreated({ kind: 'QUOTE', id: qJobId });
                resetOrderEntry();
                setPushing(false); return;
            }

            // IN-HOUSE vs OUTSOURCED — the routing authority is the outsource-finishes tab
            // (hq_outsource_finishes feeds finishList's `outsourced` flag), backed by the canonical
            // code vocabulary. 'P' is excluded by rule: phosphate is the CONVERT stage, never a
            // finish, and a stray record coded P must not send an in-house item to the plater.
            const isOutFinish = (code) => {
                const c = String(code || '').trim().toUpperCase();
                if (!c || c === 'P') return false;
                const entry = finishList.find(f => f.code === c);
                return entry ? entry.outsourced === true : isOutsourcedFinishCode(c);
            };

            const hqId = `QS-${stamp}`;
            await setDoc(doc(db, "hq_sales_orders", hqId), {
                id: hqId, soId: hqId, nsInternalId: null, nsQueuedAt: stamp,
                orderClass: 'QUICKSHIP', type: 'Stock',
                brand: activeBrand,
                customer: selectedCustomer?.name || nsCustomerId, customerId,
                jobName: jobName || '', memo: memoText,
                // THE DOCUMENTS NEED THESE (Stuart 2026-08-30: "the sales order forms … must show
                // the bill to address, the ship to address, the sidemark and the customer po").
                customerPo: String(soExtras.po || '').trim(),
                sidemark: String(soExtras.sidemark || '').trim(),
                shipTo: (() => {
                    if (ship.method === 'CUSTOM' && ship.custom.addr1) {
                        const c = ship.custom;
                        return [c.attention, c.addressee, c.addr1, c.addr2, [c.city, String(c.state || '').toUpperCase(), c.zip].filter(Boolean).join(', ')].filter(Boolean);
                    }
                    const a = (selectedCustomer?.shippingAddresses || []).find(x => String(x.addressBookId) === String(ship.addressId)) || (selectedCustomer?.shippingAddresses || [])[0] || null;
                    return a ? [a.label, a.addr1, a.addr2, [a.city, a.state, a.zip].filter(Boolean).join(', ')].filter(Boolean).filter(x => x !== a.label || !a.addr1) : [];
                })(),
                needByDate: String(soExtras.needBy || '').trim(), productionNotes: String(soExtras.prodNotes || '').trim(),
                // NS_QUEUED until NetSuite accepts — the writeBack flips it to 'Pending' and the real
                // SO number replaces the app id, and only then does WMS list it (uniform 2026-08-25).
                status: 'NS_QUEUED', pickStatus: 'Pending',
                totalParts: lines.reduce((s, l) => s + l.eachQty, 0),
                // PICK/PACK reads lines[].qty — it must be the EACH count the warehouse pulls off
                // the shelf (14 rings), never the pack count. packs/packUom ride alongside so the
                // packing station knows to bundle them 7 to a bag.
                // erp stays the REAL stocked code — pick/pack scans and barcodes it. aliasErp rides
                // alongside so the floor can see, in small print, what the customer ordered it as.
                // toBeFinished/finishCode ride the stored line (they were dropped here until
                // 2026-08-27, which left the WMS reading a made-to-order line as a shelf pull).
                // finishOutsourced routes the WMS label: FROM PLATING vs FROM FINISHING.
                lines: lines.map(l => ({ erp: l.erp, aliasErp: l.aliasErp || '', name: l.name, qty: l.perFoot ? l.qty : l.eachQty, packs: l.packUom ? l.qty : null, packUom: l.packUom || '', bin: l.bin || '', note: l.note || '', memo: String(l.lineMemo || '').trim(), kit: l.kitName ? `${l.kitName}${l.kitFinish ? ' - ' + l.kitFinish : ''}` : '', ...(l.perFoot ? { perFoot: true, feetPer: parseFloat(l.feetPer) || 1, billedFeet: l.eachQty } : {}), ...(l.toBeFinished ? { toBeFinished: true, finishCode: l.finishCode || '', ...(isOutFinish(l.finishCode) ? { finishOutsourced: true } : {}) } : {}) })),
                // Customer-facing INVOICE presentation (CRM prints/sends this): the customer pays
                // against the KIT # + kit price; components print as unpriced sub-lines; loose
                // items itemized. Captured at TRANSACTION time so later kit-price edits never
                // rewrite an issued invoice. NetSuite keeps the distributed per-item lines.
                invoiceLines: (() => {
                    const groups = {};
                    lines.forEach(l => { if (l.kitKey) (groups[l.kitKey] = groups[l.kitKey] || []).push(l); });
                    const out = Object.values(groups).map(g => {
                        const kp = effectiveKitPrice(g[0].kitName, g[0].kitBrand);
                        // Customer-facing kit # = pattern + finish suffix (HS0109T … - SG).
                        // The INVOICE is the customer's document: it carries the alias code they
                        // ordered. The real code is kept as realErp for internal reconciliation.
                        return { type: 'KIT', code: `${g[0].kitName}${g[0].kitFinish ? ' - ' + g[0].kitFinish : ''}`, price: kp !== null ? kp : g.reduce((s, l) => s + l.rate * l.eachQty, 0), components: g.map(l => ({ erp: l.aliasErp || l.erp, realErp: l.erp, name: l.name, qty: l.eachQty, packs: l.packUom ? l.qty : null, packUom: l.packUom || '' })) };
                    });
                    // ⚠ A TRAVERSE KIT IS NOT A `kitKey` GROUP (Stuart 2026-08-31). Its cart lines
                    // are pulled out into trvOrder before `lines` is built, so the loop above never
                    // sees it and the invoice carried no kit line at all — the same hole the quote
                    // document had. Same mirror, same numbers as the NetSuite holder line.
                    trvDocLines.filter(d => d.kind === 'KIT').forEach(d => out.push({
                        type: 'KIT', code: d.code, price: d.rate * (d.qty || 1),
                        components: trvDocLines.filter(x => x.kind === 'PART' && x.ofKey === d.key).map(x => ({ erp: x.code, realErp: x.code, name: `${x.name}${x.note ? ` · ${x.note}` : ''}`, qty: x.qty, packs: null, packUom: '' })),
                    }));
                    trvDocLines.filter(d => d.kind === 'FEET').forEach(d => out.push({
                        type: 'ITEM', erp: d.code, realErp: d.code, name: d.note || 'Additional foot',
                        qty: d.qty, packs: null, packUom: '', packSize: 1, rate: d.rate, total: d.rate * d.qty, note: String(d.memo || ''),
                    }));
                    // Loose lines invoice in the unit the customer BUYS: "2 × 7 PACK" at the pack
                    // price, with the each count kept for reference. qty stays the each count so an
                    // older invoice reader (which knows nothing about packs) still totals correctly.
                    lines.filter(l => !l.kitKey).forEach(l => out.push({ type: 'ITEM', erp: l.aliasErp || l.erp, realErp: l.erp, name: l.name, qty: l.perFoot ? l.qty : l.eachQty, packs: l.packUom ? l.qty : null, packUom: l.packUom || '', packSize: l.packSize || 1, rate: l.rate, total: l.rate * l.eachQty, note: l.note || '', ...(l.perFoot ? { perFoot: true, feetPer: parseFloat(l.feetPer) || 1, billedFeet: l.eachQty } : {}), ...(l.toBeFinished ? { toBeFinished: true, finishCode: l.finishCode || '' } : {}) }));
                    return out;
                })(),
                invoiceTotal: lines.reduce((s, l) => s + l.rate * l.eachQty, 0),
                // ── AN ORDER YOU CAN REOPEN WITHOUT LOSING THE KIT (Stuart 2026-08-31) ───────
                // ✎ Edit rebuilt the cart from `lines`, and a traverse order's KIT and its
                // additional-foot charge are not in `lines` — they are pulled into trvOrder
                // before that array exists. Editing such an order therefore brought back the
                // components and dropped most of the money. The cart itself now rides the SO,
                // exactly as typed, the same field the quote carries so ONE restore serves both.
                // Additive: work orders still fire from `lines`, the floors and WMS still read
                // `lines[]`, the NetSuite payload was built above, and RTG reads neither field.
                quickShipCart: JSON.parse(JSON.stringify(cart || [])),
                quickShipExtras: JSON.parse(JSON.stringify({ soExtras, ship, jobName: jobName || '' })),
                createdBy: currentUser || '', createdAt: Date.now(), createdDate: new Date().toISOString()
            });

            // ── TO-BE-FINISHED LINES ARE RECORDED, NOT FIRED (Stuart 2026-08-29, the review gate) ──
            // An Order Entry sales order is a demand statement: a line entered as raw part + finish
            // + qty is recorded on the SO (toBeFinished / finishCode / finishOutsourced on the line).
            // Generation lives on Stock View → 🧾 Order Entry Needs, where the review modal shows
            // live stock (with units), sourcing-resolved routing and the NetSuite work-order plan
            // BEFORE anything writes. The save-time auto-fire that used to live here was retired
            // behind a flag on 08-29 and deleted on 2026-09-03 (Brief E, Q12).
            const tbfLines = lines.filter(l => l.toBeFinished && l.finishCode);
            if (tbfLines.length) {
                addLog(`📋 ${tbfLines.length} to-be-finished line(s) recorded — generate their orders from Stock View → 🧾 Order Entry Needs (review-gated: stock, units, sourcing and the NetSuite WO plan are shown for approval first).`, 'info');
            }
            const obId = await enqueueNsWrite({
                kind: 'salesorder', label: `Quick Ship SO · ${selectedCustomer?.name || customerId} · ${lines.length} line(s)`,
                targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/salesorder`,
                method: 'POST', payload, sourceApp: 'QUICKSHIP', createdBy: currentUser || '',
                writeBack: [{ collection: 'hq_sales_orders', docId: hqId, idField: 'nsInternalId', tranField: 'soId', patch: { status: 'Pending' } }],
            });
            addLog(`✅ ${hqId} recorded and queued to NetSuite (outbox ${obId}) — enters the WMS Stock tab when NetSuite accepts.`, 'success');

            // SUPERSEDE (CRM ✎ Edit): the edited cart just became the real order — the original
            // closes with a pointer, so two live SOs can never both claim the same sale.
            if (editingSo) {
                try {
                    await updateDoc(doc(db, 'hq_sales_orders', editingSo.id), {
                        status: 'Closed', closedAt: Date.now(), closedBy: currentUser || '', closedFrom: 'ORDER_ENTRY_EDIT',
                        closeReason: `superseded by ${hqId}`, supersededBy: hqId,
                    });
                    addLog(`✎ Original SO ${editingSo.soId} closed — superseded by ${hqId}.${editingSo.soId && String(editingSo.soId).match(/^\d/) ? ' ⚠ Close/cancel the OLD SO in NetSuite too.' : ''}`, 'warn');
                } catch (e) { addLog(`⚠ Could not close the superseded SO ${editingSo.soId}: ${e.message || e} — close it from the CRM.`, 'error'); }
                setEditingSo(null);
            }

            setLastCreated({ kind: 'SALES ORDER', id: hqId });
            resetOrderEntry();
        } catch (e) {
            console.error('Quick Ship push error', e);
            addLog(`❌ FAILED: ${e.message}`, 'error');
            alert(`Sales Order push failed:\n\n${e.message}`);
        }
        setPushing(false);
    };

    // ---- shared styles ----
    const card = { background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' };
    const cardHd = { padding: '14px 20px', borderBottom: '1px solid var(--line)', background: 'var(--paper)', fontFamily: 'var(--serif)', fontSize: '1.15rem', fontWeight: 500, color: 'var(--ink)' };
    const lbl = { fontFamily: 'var(--mono)', fontSize: '9px', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '5px' };
    const inp = { width: '100%', boxSizing: 'border-box', padding: '10px', fontSize: '0.85rem', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' };
    const qtyInp = { ...inp, width: '64px', textAlign: 'center', fontFamily: 'var(--mono)' };
    const btn = (bg, fg) => ({ padding: '11px 18px', background: bg, color: fg, border: `1px solid ${bg}`, cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase' });

    // A kit slot. When the chosen item sells by the pack, the qty label says PACKS and the slot
    // spells out what that means in each — so nobody has to remember that 2 means 14.
    const KitSlot = ({ title, items, idKey, qtyKey, children }) => {
        const chosen = itemById(kb[idKey]);
        const pack = chosen ? packForItem(chosen) : { uom: '', size: 1 };
        const packs = parseInt(kb[qtyKey]) || 0;
        return (
            <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 64px', gap: '10px', alignItems: 'end' }}>
                <div style={{ fontFamily: 'var(--serif)', fontSize: '1.05rem', color: 'var(--ink)', paddingBottom: '8px' }}>{title}</div>
                <div>
                    <ItemSelect value={kb[idKey]} onChange={v => setKb({ ...kb, [idKey]: v })} items={items} placeholder={items.length ? `Search ${title.toLowerCase()}…` : `No ${title.toLowerCase()}s in this scope`} />
                    {pack.uom && (
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--brass)', marginTop: '5px', letterSpacing: '.06em' }}>
                            SOLD BY THE {pack.uom} · {packs > 0 ? `${packs} × ${pack.size} = ${packs * pack.size} EA` : `${pack.size} EA PER PACK`}
                        </div>
                    )}
                    {children}
                </div>
                <div><span style={lbl}>{pack.uom ? 'Packs' : 'Qty'}</span><input type="number" min="0" value={kb[qtyKey]} onChange={e => setKb({ ...kb, [qtyKey]: e.target.value })} style={qtyInp} /></div>
            </div>
        );
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', fontFamily: 'var(--sans)' }}>
            {/* HEADER */}
            <div style={{ ...card, padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <span style={{ ...lbl, color: 'var(--brass)' }}>Stock · To Be Finished · Kits · Fees</span>
                    <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>Order Entry</h2>
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textAlign: 'right' }}>
                    Flat lines → NetSuite Sales Order<br />No BOM build · {stocked.length} stocked items
                </div>
            </div>

            {/* ✎ EDITING AN EXISTING SO (CRM handoff) — pushing supersedes the original */}
            {reopenedQuote && (
                <div style={{ ...card, padding: '14px 24px', border: '2px solid var(--brass)', background: '#fdf8ef', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink)', letterSpacing: '.04em' }}>
                        ✎ REOPENED QUOTE <b>{reopenedQuote}</b> — saving creates the corrected quote and marks this one superseded. Close the old estimate in NetSuite by hand.
                    </span>
                    <button onClick={() => { setReopenedQuote(''); addLog('✎ Reopen cancelled — the cart stays, the original quote is untouched.', 'info'); }}
                        style={{ padding: '8px 14px', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink-soft)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em' }}>Unlink</button>
                </div>
            )}
            {editingSo && (
                <div style={{ ...card, padding: '14px 24px', border: '2px solid var(--brass)', background: '#fdf8ef', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink)', letterSpacing: '.04em' }}>
                        ✎ EDITING SO <b>{editingSo.soId}</b> · {editingSo.customer} — pushing this cart creates the corrected order and CLOSES the original (superseded, pointer kept).
                    </span>
                    <button onClick={() => { setEditingSo(null); setCart([]); setJobName(''); addLog('✎ Edit cancelled — original SO untouched.', 'info'); }}
                        style={{ padding: '8px 14px', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink-soft)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em' }}>Cancel edit</button>
                </div>
            )}

            {/* PORTAL QUOTE REQUESTS — customer-built stock quotes awaiting review */}
            {portalReqs.length > 0 && (
                <div style={{ ...card, padding: '20px 24px', border: '1px solid var(--brass)' }}>
                    <span style={{ ...lbl, color: 'var(--brass)' }}>Portal Quote Requests · {portalReqs.length} awaiting review</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                        {portalReqs.map(j => (
                            <div key={j.id} style={{ border: '1px solid var(--line)', padding: '10px 14px', background: 'var(--paper-2)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                                    <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink)' }}>{j.quoteNo || j.id}</span>
                                    <span style={{ fontSize: '0.9rem', color: 'var(--ink)', flex: 1 }}>{j.customer?.name || '?'}{j.jobName ? ` · ${j.jobName}` : ''}</span>
                                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>
                                        {(j.portalRequest?.lines || []).length} line(s){Number.isFinite(j.portalRequest?.total) ? ` · $${j.portalRequest.total.toLocaleString()}` : ''}{j.portalRequest?.collection ? ` · ${j.portalRequest.collection}` : ''}
                                    </span>
                                    <button onClick={() => loadPortalReq(j)} style={{ padding: '8px 16px', background: 'var(--brass)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Load into cart</button>
                                </div>
                                {j.portalRequest?.note && <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', fontStyle: 'italic', marginTop: '6px' }}>“{j.portalRequest.note}”</div>}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* CUSTOMER + JOB */}
            <div style={{ ...card, padding: '20px 24px', display: 'grid', gridTemplateColumns: '2fr 2fr', gap: '20px' }}>
                <div style={{ position: 'relative' }}>
                    <span style={lbl}>Customer</span>
                    <input value={customerId ? (custSearch || `${selectedCustomer?.name || ''} (${customerId})`) : custSearch}
                        onChange={e => { setCustSearch(e.target.value); setCustOpen(true); if (e.target.value === '') setCustomerId(''); }}
                        onFocus={() => setCustOpen(true)} onBlur={() => setTimeout(() => setCustOpen(false), 200)}
                        placeholder="Search customer…" style={inp} />
                    {custOpen && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid var(--line)', maxHeight: '240px', overflowY: 'auto', zIndex: 9999, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
                            {customers.filter(c => `${c.name} ${c.id}`.toLowerCase().includes((custSearch || '').toLowerCase())).slice(0, 50).map(c => (
                                <div key={c.id} onMouseDown={() => { setCustomerId(c.id); setCustSearch(`${c.name} (${c.id})`); setCustOpen(false); }}
                                    style={{ padding: '9px 12px', cursor: 'pointer', fontSize: '0.85rem', borderBottom: '1px solid var(--paper-2)' }}
                                    onMouseOver={e => e.currentTarget.style.background = 'var(--paper)'} onMouseOut={e => e.currentTarget.style.background = '#fff'}>
                                    {c.name} <span style={{ fontFamily: 'var(--mono)', fontSize: '0.75rem', color: 'var(--ink-soft)' }}>({c.id})</span>
                                </div>
                            ))}
                            {customers.length === 0 && <div style={{ padding: '10px', color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.8rem' }}>No customers for this brand.</div>}
                        </div>
                    )}
                </div>
                <div><span style={lbl}>Job / Sidemark (optional)</span><input value={jobName} onChange={e => setJobName(e.target.value)} placeholder="e.g. Smith Residence" style={inp} /></div>
            </div>

            {/* CATALOG SCOPE — pick the collection and every picker below narrows to the parts that
                collection's CPQ/Vision flows build from. Collections the selected customer is
                entitled to in the portal are listed first, but staff are never blocked from the
                rest: this is the internal counter. */}
            <div style={{ ...card, padding: '16px 24px', display: 'grid', gridTemplateColumns: '2fr 3fr', gap: '20px', alignItems: 'center' }}>
                <div>
                    <span style={lbl}>Collection Scope</span>
                    <select value={scopeCollection} onChange={e => setScopeCollection(e.target.value)} style={inp}>
                        <option value="">All collections ({allStocked.length} items)</option>
                        {custCollections.length > 0 && (
                            <optgroup label={`Assigned to ${selectedCustomer?.name || 'this customer'}`}>
                                {custCollections.map(c => <option key={c} value={c}>{c}</option>)}
                            </optgroup>
                        )}
                        <optgroup label={custCollections.length ? 'Other collections' : 'Collections'}>
                            {stockedCollections.filter(c => !custCollections.includes(c)).map(c => <option key={c} value={c}>{c}</option>)}
                        </optgroup>
                    </select>
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', lineHeight: 1.7 }}>
                    {scopeCollection
                        ? <>Scoped to <b style={{ color: 'var(--brass)' }}>{scopeCollection}</b> — {stocked.length} of {allStocked.length} stocked items{diaCells.length > 0 && <> · {diaCells.length} rod diameter{diaCells.length === 1 ? '' : 's'}</>}</>
                        : <>Showing the whole stocked catalog. Pick a collection to work the way CPQ and Vision do.</>}
                    {customerId && custCollections.length > 0 && <><br />Portal access: {custCollections.join(', ')}</>}
                    {customerId && custCollections.length === 0 && <><br />No portal collection restriction on this customer — they see everything online.</>}
                </div>
            </div>

            {/* PREBUILT KITS — filed under collections (Stuart 2026-07-17); click a group title to
                open it. Each kit chip shows its effective price for the SELECTED customer (★ = a
                per-customer row is driving it); the $ button edits pricing + filing. */}
            <div style={card}>
                <div style={{ ...cardHd, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Prebuilt Kits</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', fontWeight: 400 }}>{myKits.length} kit(s) · filed by collection</span>
                </div>
                <div style={{ padding: '4px 20px 16px' }}>
                    {myKits.length === 0 && <div style={{ padding: '12px 0', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)', fontSize: '0.95rem' }}>No saved kits yet — build one below and “Save as kit”.</div>}
                    {(() => {
                        const groups = new Map();
                        myKits.forEach(k => { const c = (k.collection || '').trim() || 'Unfiled'; if (!groups.has(c)) groups.set(c, []); groups.get(c).push(k); });
                        const names = [...groups.keys()].sort((a, b) => ((a === 'Unfiled') - (b === 'Unfiled')) || a.localeCompare(b));
                        return names.map(colName => {
                            const open = !!openCols[colName];
                            const list = groups.get(colName);
                            return (
                                <div key={colName} style={{ marginTop: '10px', border: '1px solid var(--line)' }}>
                                    <div onClick={() => setOpenCols(p => ({ ...p, [colName]: !p[colName] }))} style={{ padding: '10px 14px', background: open ? 'var(--ink)' : 'var(--paper-2)', color: open ? '#fff' : 'var(--ink)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.12em', fontWeight: 600 }}>{open ? '▾' : '▸'} {colName}</span>
                                        <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', opacity: 0.75 }}>{list.length} kit(s)</span>
                                    </div>
                                    {open && (
                                        <div style={{ padding: '12px 14px', display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                                            {list.map(kit => {
                                                const kp = effectiveKitPrice(kit.name, kit.brand);
                                                const hasCust = !!customerId && !!findClientPriceRow(kit.clientPricing, custKeys);
                                                return (
                                                    <div key={kit.name} style={{ display: 'flex', alignItems: 'stretch', border: '1px solid var(--line)' }}>
                                                        <button onClick={() => addSavedKit(kit)} style={{ ...btn('var(--paper-2)', 'var(--ink)'), border: 'none', textTransform: 'none', letterSpacing: 0, fontFamily: 'var(--sans)', fontSize: '0.9rem' }}
                                                            onMouseOver={e => e.currentTarget.style.background = 'var(--brass)'} onMouseOut={e => e.currentTarget.style.background = 'var(--paper-2)'}>
                                                            + {kit.name}{(kit.finishCodes || []).length > 0 && <span style={{ fontFamily: 'var(--mono)', fontSize: '0.75rem', color: 'var(--ink-soft)' }}> · {kit.finishCodes.length} color{kit.finishCodes.length === 1 ? '' : 's'}</span>}{kp !== null && <span style={{ fontFamily: 'var(--mono)', fontSize: '0.78rem', color: hasCust ? '#3a7d44' : 'var(--ink-soft)' }}> · ${kp.toFixed(2)}{hasCust ? ' ★' : ''}</span>}
                                                        </button>
                                                        <button title="Kit pricing, finishes & collection" onClick={() => setKitEdit({ name: kit.name, brand: kit.brand, basePrice: kit.basePrice ?? '', collection: kit.collection || '', clientPricing: (kit.clientPricing || []).map(r => ({ ...r })), finishCodes: Array.isArray(kit.finishCodes) ? [...kit.finishCodes] : [], addCust: '', addPrice: '' })} style={{ border: 'none', borderLeft: '1px solid var(--line)', background: '#fff', color: 'var(--brass)', cursor: 'pointer', padding: '0 10px', fontSize: '0.85rem', fontFamily: 'var(--mono)' }}>$</button>
                                                        <button title="Delete kit" onClick={() => deleteKit(kit)} style={{ border: 'none', borderLeft: '1px solid var(--line)', background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer', padding: '0 10px', fontSize: '0.9rem' }}>×</button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        });
                    })()}
                </div>

                {kitEdit && (
                    <div style={{ borderTop: '1px solid var(--brass)', padding: '16px 20px', background: 'var(--paper)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                            <span style={{ fontFamily: 'var(--serif)', fontSize: '1.1rem', color: 'var(--ink)' }}>Kit Pricing & Filing — {kitEdit.name}</span>
                            <button onClick={() => setKitEdit(null)} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', fontSize: '1.2rem', cursor: 'pointer' }}>×</button>
                        </div>
                        <div style={{ display: 'flex', gap: '16px', alignItems: 'end', flexWrap: 'wrap', marginBottom: '12px' }}>
                            <div><span style={lbl}>Collection (filing)</span><input value={kitEdit.collection} onChange={e => setKitEdit({ ...kitEdit, collection: e.target.value })} list="qs-collections" placeholder="e.g. TQS" style={{ ...inp, width: '160px' }} /></div>
                            <div><span style={lbl}>Base kit price ($)</span><input type="number" value={kitEdit.basePrice} onChange={e => setKitEdit({ ...kitEdit, basePrice: e.target.value })} placeholder="blank = per-item" style={{ ...inp, width: '140px', fontFamily: 'var(--mono)' }} /></div>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', paddingBottom: '10px', maxWidth: '380px' }}>Blank = lines bill at their own item rates. A kit price distributes across the component lines so the sales order totals exactly the kit price.</span>
                        </div>
                        <span style={lbl}>Available finishes — the counter picks a color; components resolve to their /CODE variants</span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
                            {[...new Map(finishList.map(f => [f.code, f])).values()].sort((a, b) => a.code.localeCompare(b.code)).map(f => {
                                const on = (kitEdit.finishCodes || []).includes(f.code);
                                return (
                                    <button key={f.code} title={f.name} onClick={() => setKitEdit({ ...kitEdit, finishCodes: on ? (kitEdit.finishCodes || []).filter(c => c !== f.code) : [...(kitEdit.finishCodes || []), f.code] })}
                                        style={{ padding: '5px 10px', border: on ? '1px solid var(--ink)' : '1px solid var(--line)', background: on ? 'var(--ink)' : '#fff', color: on ? '#fff' : 'var(--ink-soft)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px' }}>
                                        {f.code}
                                    </button>
                                );
                            })}
                            {finishList.length === 0 && <span style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No finish codes found — add them to the in-house / outsourced finish lists first (11.x / Library).</span>}
                        </div>
                        <span style={lbl}>Per-customer kit pricing</span>
                        {(kitEdit.clientPricing || []).length === 0 && <div style={{ fontSize: '0.82rem', color: 'var(--ink-soft)', fontStyle: 'italic', padding: '4px 0 8px' }}>None — every customer gets the base kit price.</div>}
                        {(kitEdit.clientPricing || []).map((r, i) => (
                            <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--paper-2)' }}>
                                <span style={{ flex: 1, fontSize: '0.85rem', color: 'var(--ink)' }}>{r.customerName || r.customerId}</span>
                                <span style={{ fontFamily: 'var(--mono)', fontSize: '0.85rem', color: 'var(--ink)' }}>${parseFloat(r.price || 0).toFixed(2)}</span>
                                <button onClick={() => setKitEdit({ ...kitEdit, clientPricing: kitEdit.clientPricing.filter((_, x) => x !== i) })} style={{ background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', fontSize: '1rem' }}>×</button>
                            </div>
                        ))}
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'end', marginTop: '10px', flexWrap: 'wrap' }}>
                            <div style={{ minWidth: '240px', flex: 1 }}>
                                <span style={lbl}>Customer</span>
                                <select value={kitEdit.addCust} onChange={e => setKitEdit({ ...kitEdit, addCust: e.target.value })} style={{ ...inp, background: '#fff' }}>
                                    <option value="">Select customer…</option>
                                    {customers.map(c => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
                                </select>
                            </div>
                            <div><span style={lbl}>Kit price ($)</span><input type="number" value={kitEdit.addPrice} onChange={e => setKitEdit({ ...kitEdit, addPrice: e.target.value })} style={{ ...inp, width: '120px', fontFamily: 'var(--mono)' }} /></div>
                            <button onClick={() => {
                                if (!kitEdit.addCust || kitEdit.addPrice === '' || isNaN(parseFloat(kitEdit.addPrice))) return alert('Pick a customer and enter a price.');
                                const c = customers.find(x => x.id === kitEdit.addCust);
                                const rows = (kitEdit.clientPricing || []).filter(r => r.customerId !== kitEdit.addCust);
                                setKitEdit({ ...kitEdit, clientPricing: [...rows, { customerId: kitEdit.addCust, customerName: c?.name || '', price: parseFloat(kitEdit.addPrice) }], addCust: '', addPrice: '' });
                            }} style={btn('transparent', 'var(--ink)')}>+ Add Row</button>
                            <div style={{ flex: 1 }} />
                            <button onClick={async () => {
                                try {
                                    await updateKitMeta({ name: kitEdit.name, brand: kitEdit.brand }, { collection: (kitEdit.collection || '').trim(), basePrice: (kitEdit.basePrice === '' || kitEdit.basePrice === null) ? '' : parseFloat(kitEdit.basePrice), clientPricing: kitEdit.clientPricing || [], finishCodes: kitEdit.finishCodes || [] });
                                    addLog(`Kit "${kitEdit.name}" pricing/filing saved`, 'success');
                                    setKitEdit(null);
                                } catch (e) { alert('Save failed: ' + (e.message || e)); }
                            }} style={btn('var(--ink)', '#fff')}>Save Kit Pricing</button>
                        </div>
                    </div>
                )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: '20px', alignItems: 'start' }}>
                {/* LEFT: QUICK ADD + KIT BUILDER */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div style={card}>
                        <div style={cardHd}>Quick Add Item</div>
                        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                            {/* 1 — OFF THE SHELF. Finished stock, in the scoped collection. */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px auto', gap: '12px', alignItems: 'end' }}>
                                <div><span style={lbl}>Stocked Item #</span><ItemSelect value={quickItemId} onChange={setQuickItemId} items={stocked} /></div>
                                <div><span style={lbl}>Qty</span><input type="number" min="1" value={quickQty} onChange={e => setQuickQty(e.target.value)} style={qtyInp} /></div>
                                <button onClick={addQuick} style={btn('var(--ink)', '#fff')}>Add</button>
                            </div>

                            {/* 2 — TO BE FINISHED. The raw mill part plus the colour it is going to
                                wear. Every other tab calls this a made-to-order line; here it is one
                                row, because nothing about it needs configuring. */}
                            <div style={{ borderTop: '1px dashed var(--line)', paddingTop: '14px', display: 'grid', gridTemplateColumns: tbfPerFoot ? '1fr 150px 76px 62px 82px auto' : '1fr 150px 62px 82px auto', gap: '10px', alignItems: 'end' }}>
                                <div>
                                    <span style={lbl}>To Be Finished item # — raw part, before the “/”</span>
                                    <ItemSelect value={tbfItemId} onChange={setTbfItemId} items={rawItems} placeholder="Search raw item #…" />
                                </div>
                                <div>
                                    <span style={lbl}>Finish</span>
                                    <select value={tbfFinish} onChange={e => setTbfFinish(e.target.value)} style={inp}>
                                        <option value="">— finish —</option>
                                        {[...new Map(finishList.map(f => [f.code, f])).values()]
                                            .sort((a, b) => Number(a.outsourced) - Number(b.outsourced) || a.code.localeCompare(b.code))
                                            .map(f => <option key={f.code} value={f.code}>{f.code}{f.name && f.name !== f.code ? ` — ${f.name}` : ''}{f.outsourced ? ' · outsourced' : ''}</option>)}
                                    </select>
                                </div>
                                {tbfPerFoot && (
                                    <div>
                                        <span style={{ ...lbl, color: 'var(--brass)' }}>Ft / piece</span>
                                        <input type="number" min="0" step="0.5" value={tbfFeet} onChange={e => setTbfFeet(e.target.value)} placeholder="ft" style={{ ...qtyInp, width: '72px' }} title="Sold by the FOOT: the cut length in feet for EACH piece. Billing = pieces × feet × $/ft; the floor makes pieces at this cut." />
                                    </div>
                                )}
                                <div><span style={lbl}>{tbfPerFoot ? 'Pieces' : 'Qty'}</span><input type="number" min="1" value={tbfQty} onChange={e => setTbfQty(e.target.value)} style={qtyInp} /></div>
                                <div>
                                    <span style={lbl}>{tbfPerFoot ? '$ / ft' : 'Price'}</span>
                                    <input type="number" min="0" step="0.01" value={tbfPrice} onChange={e => setTbfPrice(e.target.value)} placeholder="—" style={{ ...qtyInp, width: '82px', textAlign: 'right' }} />
                                </div>
                                <button onClick={addToBeFinished} style={btn('var(--ink)', '#fff')}>Add</button>
                            </div>
                            {tbfItem && (
                                <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', letterSpacing: '.06em', marginTop: '-6px' }}>
                                    {selectedCustomer
                                        ? (findClientPriceRow(tbfItem.clientPricing, custKeys)
                                            ? `${selectedCustomer.name.toUpperCase()}'S PRICE $${tbfResolved.toFixed(2)}${findClientPriceRow(tbfItem.clientPricing, custKeys)?.clientSku ? ` · THEIR # ${findClientPriceRow(tbfItem.clientPricing, custKeys).clientSku}` : ''}`
                                            : `NO ${selectedCustomer.name.toUpperCase()} PRICE ON THIS ITEM — BASE PRICE $${tbfResolved.toFixed(2)}`)
                                        : `BASE PRICE $${tbfResolved.toFixed(2)} — PICK A CUSTOMER TO PRICE IT FOR THEM`}
                                </div>
                            )}

                            {/* 3 — FEES. Every fee item in the brand, priced the one way fees are
                                priced. A percentage fee has no quantity: it is a share of the order. */}
                            <div style={{ borderTop: '1px dashed var(--line)', paddingTop: '14px', display: 'grid', gridTemplateColumns: '1fr 62px auto', gap: '10px', alignItems: 'end' }}>
                                <div>
                                    <span style={lbl}>Fee — rush, freight, packaging, coatings…</span>
                                    <ItemSelect value={feeItemId} onChange={setFeeItemId} items={allFeeItems} placeholder={allFeeItems.length ? 'Search fees…' : 'No fee items in this brand'} />
                                </div>
                                <div>
                                    <span style={lbl}>Qty</span>
                                    <input type="number" min="1" value={feeRule?.mode === 'PERCENT' ? '' : feeQty} onChange={e => setFeeQty(e.target.value)}
                                        disabled={feeRule?.mode === 'PERCENT'} placeholder={feeRule?.mode === 'PERCENT' ? '—' : ''}
                                        title={feeRule?.mode === 'PERCENT' ? 'A percentage fee is a share of the order, not a count' : ''}
                                        style={{ ...qtyInp, background: feeRule?.mode === 'PERCENT' ? 'var(--paper-2)' : '#fff' }} />
                                </div>
                                <button onClick={addFee} style={btn('var(--ink)', '#fff')}>Add</button>
                            </div>
                            {feeItem && (
                                <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--brass)', letterSpacing: '.06em', marginTop: '-6px' }}>
                                    {feeRuleSummary(feeRule, rateFor(feeItem)).toUpperCase()}
                                    {feeRule?.mode === 'PERCENT' && ' — WORKED OUT FROM THE ORDER, AND IT MOVES AS LINES ARE ADDED'}
                                </div>
                            )}

                            {/* 4 — THIS CUSTOMER'S CHECKOUT ITEMS. Assigned per customer in 4.6;
                                the same list CPQ checkout offers them, so the two doors agree. */}
                            {custCheckoutItems.length > 0 && (
                                <div style={{ borderTop: '1px dashed var(--line)', paddingTop: '14px' }}>
                                    <span style={lbl}>{(selectedCustomer?.name || 'Customer')}'s checkout items — assigned in 4.6, same list as CPQ checkout</span>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '4px' }}>
                                        {custCheckoutItems.map(it => {
                                            const isFee = isFeeItemRecord(it);
                                            const rule = isFee ? feeRuleOf(it.manufacturingSpecs) : null;
                                            const pct = isFee && rule.mode === 'PERCENT';
                                            return (
                                                <div key={it.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto 62px auto', gap: '10px', alignItems: 'center', padding: '7px 10px', border: '1px solid var(--line)', background: 'var(--paper-2)' }}>
                                                    <div style={{ minWidth: 0 }}>
                                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{erpOf(it)} <span style={{ color: 'var(--ink-soft)', fontFamily: 'var(--sans)', fontSize: '12px' }}>{it.itemName || ''}</span></div>
                                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '8.5px', color: 'var(--brass)', letterSpacing: '.05em', marginTop: '2px' }}>{isFee ? feeRuleSummary(rule, rateFor(it)).toUpperCase() : `$${rateFor(it).toFixed(2)} EACH`}</div>
                                                    </div>
                                                    <span style={{ fontFamily: 'var(--mono)', fontSize: '8px', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-soft)' }}>{isFee ? 'FEE' : 'ITEM'}</span>
                                                    <input type="number" min="1" value={pct ? '' : (ccQty[it.id] || '')} onChange={e => setCcQty(prev => ({ ...prev, [it.id]: e.target.value }))}
                                                        disabled={pct} placeholder={pct ? '—' : '1'}
                                                        title={pct ? 'A percentage fee is a share of the order, not a count' : ''}
                                                        style={{ ...qtyInp, padding: '7px', background: pct ? 'var(--paper-2)' : '#fff' }} />
                                                    <button onClick={() => addCustCheckout(it)} style={{ ...btn('var(--ink)', '#fff'), padding: '8px 14px' }}>Add</button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {trvKits.length > 0 && (
                        <div style={card}>
                            <div style={cardHd}>Traverse Kits — {trvKits.length} for this customer</div>
                            <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <div>
                                    <span style={lbl}>Their kit code (paste from the PO)</span>
                                    <input value={trvCode} onChange={e => trvResolve(e.target.value)} placeholder="e.g. HTS7504F or H1-2TRV-4M/P-60W" style={inp} />
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: '10px' }}>
                                    <div>
                                        <span style={lbl}>Kit</span>
                                        <select value={trvKitId} onChange={e => { setTrvKitId(e.target.value); setTrvMotor(''); setTrvProj(''); }} style={inp}>
                                            <option value="">— pick a kit —</option>
                                            {trvKits.map(k => { const r = kitRowOf(k); return <option key={k.id} value={k.id}>{k.legacyErpId}{r?.clientSku ? ` · ${r.clientSku}` : ''} — {k.itemName || ''} — ${r?.price ?? '—'}</option>; })}
                                        </select>
                                    </div>
                                    <div><span style={lbl}>Total feet</span><input type="number" min="1" value={trvFeet} onChange={e => setTrvFeet(e.target.value)} placeholder="4" style={qtyInp} /></div>
                                </div>
                                {trvKit && String(trvKit.manufacturingSpecs.kitAlign.drive).toUpperCase() === 'MOTORIZED' && (
                                    <div>
                                        <span style={lbl}>Motor — set includes HSOM-21; others bill the difference</span>
                                        <select value={trvMotor} onChange={e => setTrvMotor(e.target.value)} style={inp}>
                                            <option value="">HSOM-21 (included)</option>
                                            {[...new Set((trvKit.manufacturingSpecs.kitMotorCodes || []).map(x => x.motorItem).filter(Boolean))].map(mi => {
                                                // The motor is a real library item — show its description and the
                                                // CUSTOMER'S code for it (their component sku, else the per-motor kit
                                                // pattern), plus the upcharge over the included HSOM-21.
                                                const mDoc = allItems.find(x => String(x.legacyErpId || x.itemId || '').toUpperCase() === mi.toUpperCase());
                                                const mSku = kitRowOf(mDoc)?.clientSku || '';
                                                const mc = (trvKit.manufacturingSpecs.kitMotorCodes || []).find(x => String(x.motorItem).toUpperCase() === mi.toUpperCase());
                                                const kitRow = kitRowOf(trvKit);
                                                const d = mc && Number.isFinite(parseFloat(mc.net)) && Number.isFinite(parseFloat(kitRow?.price)) ? parseFloat(mc.net) - parseFloat(kitRow.price) : 0;
                                                return <option key={mi} value={mi}>{mi}{mSku ? ` · ${mSku}` : (mc?.fabSku ? ` · ${mc.fabSku}` : '')} — {mDoc?.itemName || 'motor'}{d > 0 ? ` (+$${d})` : ' (included)'}</option>;
                                            })}
                                        </select>
                                    </div>
                                )}
                                {/* PROJECTION — singles only. Each depth is a different bracket ITEM
                                    (3-5/8 standard / 4-5/8 extended / 6 extended), and the usage chart
                                    counts each separately, so this decides what the shop consumes. A
                                    depth outside the catalogue is a CPQ order. */}
                                {trvKit && trvIsSingle && (
                                    <div>
                                        <span style={lbl}>Bracket projection — standard depths only</span>
                                        <select value={trvProj} onChange={e => setTrvProj(e.target.value)} style={inp}>
                                            <option value="">— pick the projection —</option>
                                            {trvProjOptions.map(p => <option key={p.inches} value={p.inches}>{p.label}{p.standard ? ' — standard' : ' — extended'} · {p.code}</option>)}
                                        </select>
                                        {trvProj && (() => {
                                            const hit = trvProjOptions.find(p => p.inches === trvProj);
                                            return hit ? (
                                                <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', marginTop: '5px', letterSpacing: '.06em' }}>
                                                    CONSUMES {hit.code}{hit.returnArm ? ` · MATCHING RETURN ARM ${hit.returnArm}` : ''}
                                                </div>
                                            ) : null;
                                        })()}
                                    </div>
                                )}
                                {trvKit && !trvIsSingle && (
                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', letterSpacing: '.06em' }}>
                                        DOUBLE — ONE BRACKET CARRIES BOTH RODS, SO THERE IS NO PROJECTION TO PICK.
                                    </div>
                                )}
                                {trvKit && (
                                    <div>
                                        <span style={lbl}>Finish — {String(trvKit.manufacturingSpecs.kitAlign.material).toUpperCase() === 'W' ? 'stain (S…)' : String(trvKit.manufacturingSpecs.kitAlign.material).toUpperCase() === 'EP' ? 'plated (EP…)' : 'paint (P…)'}</span>
                                        <select value={trvFinish} onChange={e => setTrvFinish(e.target.value)} style={inp}>
                                            <option value="">— pick the finish —</option>
                                            {/* The FASCIA colour. The track and brackets take the sub colour
                                                aligned to it in 4.5 — named on the option so the CSR sees both
                                                halves of what they are ordering. */}
                                            {trvFinishOptions.map(f => <option key={f.code} value={f.code}>{f.code} — {f.name}{f.subFinishCode ? ` · track ${f.subFinishCode}` : ' · no track colour set'}</option>)}
                                        </select>
                                        {trvFinishOptions.length === 0 && (
                                            <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: '#d9534f', marginTop: '5px', letterSpacing: '.06em' }}>
                                                NO FINISHES OFFERED FOR THIS KIT — tick its finish matrix in 4.6 → KITS, or add the {String(trvKit.manufacturingSpecs.kitAlign.material).toUpperCase() === 'W' ? 'S-stain' : String(trvKit.manufacturingSpecs.kitAlign.material).toUpperCase() === 'EP' ? 'plated' : 'paint'} codes to the finish list.
                                            </div>
                                        )}
                                        {trvFinish && !subFinishOf(trvFinish) && (
                                            <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: '#a05a2c', marginTop: '5px', letterSpacing: '.06em', lineHeight: 1.6 }}>
                                                ⚠ {trvFinish} HAS NO ALIGNED TRACK COLOUR — the track and brackets will go to the floor in {trvFinish} itself. Set its bronze/champagne default in 4.5 → Master Finishes.
                                            </div>
                                        )}
                                    </div>
                                )}
                                {trvKit && (
                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', lineHeight: 1.7 }}>
                                        {[...describeKitAlign(trvKit.manufacturingSpecs.kitAlign, trvMotor), ...(trvProj ? [projLabel(trvProj)] : [])].join(' · ')}
                                        <br />End treatments (return arms) bill separately — add them with Quick Add above.
                                    </div>
                                )}
                                <button onClick={addTraverse} disabled={!trvKit} style={btn(trvKit ? 'var(--ink)' : 'var(--paper-2)', trvKit ? '#fff' : 'var(--ink-soft)')}>Add kit to cart</button>
                            </div>
                        </div>
                    )}

                    <div style={card}>
                        <div onClick={() => setKbOpen(o => !o)} title={kbOpen ? 'Collapse — out of the way while entering orders' : 'Open it to add a whole collection by slot, or to build and save a kit'}
                            style={{ ...cardHd, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}>
                            <span>Quick Add by Collection &amp; Kit Builder{!kbOpen && <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', letterSpacing: '.08em', color: 'var(--ink-soft)', marginLeft: '10px' }}>PICK BY COLLECTION, OR BUILD &amp; SAVE A KIT — CLOSED</span>}</span>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink-soft)' }}>{kbOpen ? '▾' : '▸'}</span>
                        </div>
                        <div style={{ padding: '18px 20px', display: kbOpen ? 'flex' : 'none', flexDirection: 'column', gap: '14px' }}>
                            {/* ROD DIAMETER FIRST — the same first question the CPQ landing asks.
                                Every slot below is filtered to it, so 1/2" Simple Elegance offers
                                only the handful of parts that actually fit a 1/2" rod. */}
                            <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 64px', gap: '10px', alignItems: 'end', paddingBottom: '12px', borderBottom: '1px dashed var(--line)' }}>
                                <div style={{ fontFamily: 'var(--serif)', fontSize: '1.05rem', color: 'var(--ink)', paddingBottom: '8px' }}>Size &amp; Finish</div>
                                <div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                        <div>
                                            <span style={lbl}>Rod Diameter</span>
                                            <select value={kbDia} onChange={e => setKbDia(e.target.value)} style={inp} disabled={diaCells.length === 0}>
                                                <option value="">{diaCells.length ? 'Any diameter' : 'No sized stock in scope'}</option>
                                                {diaCells.map(d => <option key={d.cell} value={d.cell}>{d.label}</option>)}
                                            </select>
                                        </div>
                                        {/* One finish per kit — set it here and the style pickers below stop
                                            repeating the same part once per colour. */}
                                        <div>
                                            <span style={lbl}>Finish</span>
                                            <select value={kbFinish} onChange={e => setKbFinish(e.target.value)} style={inp} disabled={stockedFinishes.length === 0}>
                                                <option value="">{stockedFinishes.length ? 'Any finish' : 'No finished stock in scope'}</option>
                                                {stockedFinishes.map(f => {
                                                    const meta = finishList.find(x => x.code === f);
                                                    return <option key={f} value={f}>{f}{meta && meta.name && meta.name !== f ? ` — ${meta.name}` : ''}</option>;
                                                })}
                                            </select>
                                        </div>
                                    </div>
                                    {(kbDia || kbFinish) && (
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--brass)', marginTop: '5px', letterSpacing: '.06em' }}>
                                            {poles.length} pole · {outerBrackets.length} outer / {centerBrackets.length} center bracket · {rings.length} ring · {finials.length} finial
                                        </div>
                                    )}
                                </div>
                                <div />
                            </div>

                            <KitSlot title="Pole" items={poles} idKey="poleId" qtyKey="poleQty" />
                            {/* OUTER = the left/right bracket (one part, both ends); CENTER = the
                                passing bracket. Split comes from 1.6, not from naming. */}
                            <KitSlot title="Outer Brackets" items={outerBrackets} idKey="bracketId" qtyKey="bracketQty" />
                            <KitSlot title="Center Brackets" items={centerBrackets} idKey="centerBracketId" qtyKey="centerBracketQty" />
                            {!bracketPos && (
                                <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: '#a05a2c', letterSpacing: '.06em', marginTop: '-6px', paddingLeft: '120px' }}>
                                    No position-tagged bracket steps in this brand's flows — both lists show every bracket.
                                </div>
                            )}
                            <KitSlot title="Ring" items={rings} idKey="ringId" qtyKey="ringQty" />
                            <KitSlot title="Finial" items={finials} idKey="finialId" qtyKey="finialQty" />

                            <div style={{ borderTop: '1px dashed var(--line)', margin: '4px 0', paddingTop: '12px', fontFamily: 'var(--mono)', fontSize: '9px', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Billable Fees</div>
                            <KitSlot title="Cut" items={cutItems} idKey="cutId" qtyKey="cutQty">
                                <input value={kb.cutLen} onChange={e => setKb({ ...kb, cutLen: e.target.value })} placeholder="Cut length (e.g. 84in)" style={{ ...inp, marginTop: '8px', fontSize: '0.8rem' }} />
                            </KitSlot>
                            <KitSlot title="Splice" items={spliceItems} idKey="spliceId" qtyKey="spliceQty" />

                            {/* RUSH — the TYPE carries the price (Mass Update 4.5 → Rush Fee Types);
                                the item is just the vessel that carries the charge to NetSuite.
                                Offered to every customer, no CRM setup. */}
                            <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 64px', gap: '10px', alignItems: 'end' }}>
                                <div style={{ fontFamily: 'var(--serif)', fontSize: '1.05rem', color: 'var(--ink)', paddingBottom: '8px' }}>Rush Fee</div>
                                <div>
                                    <select value={kb.rushType} onChange={e => setKb({ ...kb, rushType: e.target.value, rushId: kb.rushId || (rushItems.length === 1 ? rushItems[0].id : '') })} style={inp}>
                                        <option value="">{rushTypes.length ? 'No rush' : 'No rush fee types defined (4.5)'}</option>
                                        {rushTypes.map(t => {
                                            const amt = rushFeeAmountOf(t);
                                            return <option key={t} value={t}>{rushFeeLabelOf(t)}{amt === null ? ' — no amount set' : ` — $${amt.toFixed(2)}`}</option>;
                                        })}
                                    </select>
                                    {kb.rushType && (
                                        <>
                                            <ItemSelect value={kb.rushId} onChange={v => setKb({ ...kb, rushId: v })} items={rushItems} placeholder={rushItems.length ? 'Rush fee item…' : 'No RUSH fee item in the library'} />
                                            <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: rushFeeAmountOf(kb.rushType) === null ? '#d9534f' : 'var(--brass)', marginTop: '5px', letterSpacing: '.06em' }}>
                                                {rushFeeAmountOf(kb.rushType) === null
                                                    ? 'This type has no amount — fix it in 4.5 (end with "- 75")'
                                                    : `BILLS AT $${rushFeeAmountOf(kb.rushType).toFixed(2)} — overrides the item's own price`}
                                            </div>
                                        </>
                                    )}
                                </div>
                                <div><span style={lbl}>Qty</span><input type="number" min="0" value={kb.rushQty} onChange={e => setKb({ ...kb, rushQty: e.target.value })} style={qtyInp} /></div>
                            </div>

                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '6px', flexWrap: 'wrap' }}>
                                <button onClick={addKbToCart} style={btn('var(--brass)', '#fff')}>Add Kit to Cart</button>
                                <button onClick={() => setKb(EMPTY_KB)} style={btn('transparent', 'var(--ink-soft)')}>Clear</button>
                                <div style={{ flex: 1 }} />
                                <input value={kitName} onChange={e => setKitName(e.target.value)} placeholder="Name to save as kit…" style={{ ...inp, width: '170px', flex: 'none' }} />
                                <input value={kitCollection} onChange={e => setKitCollection(e.target.value)} list="qs-collections" placeholder="Collection (e.g. TQS)" style={{ ...inp, width: '150px', flex: 'none' }} />
                                <datalist id="qs-collections">{[...new Set(myKits.map(k => (k.collection || '').trim()).filter(Boolean))].map(c => <option key={c} value={c} />)}</datalist>
                                <button onClick={saveKit} style={btn('var(--ink)', '#fff')}>Save as Kit</button>
                            </div>

                            {/* The pickers are six stacked filters deep; when one hides an item the
                                list just gets shorter and the reason is invisible. Type a code and
                                this replays the SAME predicates and names the one that said no. */}
                            <div style={{ borderTop: '1px dashed var(--line)', paddingTop: '12px' }}>
                                <span style={lbl}>Item missing? Type its code</span>
                                <input value={diagQuery} onChange={e => setDiagQuery(e.target.value)} placeholder="e.g. H1-1BE/CG or H2-1BE" style={{ ...inp, fontFamily: 'var(--mono)', fontSize: '0.8rem' }} />
                                {diag && (
                                    <div style={{ marginTop: '8px', padding: '10px 12px', border: `1px solid ${diag.ok ? '#bcd8c0' : '#e0c9a0'}`, background: diag.ok ? '#f2f8f3' : 'var(--paper)' }}>
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: diag.ok ? '#3a7d44' : '#a05a2c', marginBottom: '4px' }}>
                                            {diag.ok ? '✓ ' : '✗ blocked at: '}{diag.step}
                                        </div>
                                        <div style={{ fontSize: '0.82rem', color: 'var(--ink)', lineHeight: 1.5 }}>{diag.detail}</div>
                                        {diag.trail && diag.trail.length > 0 && (
                                            <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', marginTop: '6px', letterSpacing: '.04em' }}>{diag.trail.join('  →  ')}</div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* RIGHT: CART */}
                <div style={{ ...card, display: 'flex', flexDirection: 'column', minHeight: '400px' }}>
                    <div style={{ ...cardHd, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>Order Cart</span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>{cart.length} line(s)</span>
                    </div>
                    <div style={{ padding: '12px 16px', flex: 1, overflowY: 'auto' }}>
                        {cart.length === 0 && <div style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)', padding: '20px', textAlign: 'center' }}>Empty — add stocked items or a kit.</div>}
                        {pricedCart.map(l => (
                            <div key={l.key} style={{ display: 'grid', gridTemplateColumns: '1fr 64px 74px auto', gap: '10px', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--paper-2)' }}>
                                <div style={{ minWidth: 0 }}>
                                    {/* Customer-facing code leads; the real stocked code rides small
                                        beneath it, since that's what we pick and barcode. */}
                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '0.82rem', color: 'var(--ink)' }}>{l.aliasErp || l.erp || '—'} {!l.nsId && <span style={{ color: '#d9534f' }} title="No NetSuite ID — will be skipped on push">⚠</span>}</div>
                                    {l.aliasErp && <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)' }}>ships as {l.erp}</div>}
                                    <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}{l.note ? ` · ${l.note}` : ''}{l.packUom && <span style={{ color: 'var(--brass)' }}> · {l.qty} × {l.packUom} = {l.eachQty} ea</span>}{l.kitName && <span style={{ color: 'var(--brass)' }}> · KIT: {l.kitName}{l.kitFinish ? ` · ${l.kitFinish}` : ''}</span>}</div>
                                    <input value={l.lineMemo || ''} onChange={e => setLineMemo(l.key, e.target.value)} placeholder="Memo / room — e.g. LIVING ROOM LEFT" title="Prints on the customer's quote beside this line, and rides the line's NetSuite Tag" style={{ width: '100%', marginTop: '4px', padding: '4px 6px', border: '1px solid var(--line)', background: l.lineMemo ? '#fffdf5' : '#fff', fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink)' }} />
                                </div>
                                <input type="number" min="1" value={l.qty} onChange={e => setQty(l.key, e.target.value)} style={qtyInp} title={l.packUom ? `Packs of ${l.packSize}` : 'Quantity'} />
                                <div style={{ fontFamily: 'var(--mono)', fontSize: '0.8rem', textAlign: 'right', color: 'var(--ink)' }}>${(l.rate * l.eachQty).toFixed(2)}</div>
                                <button onClick={() => removeLine(l.key)} style={{ border: 'none', background: 'none', color: 'var(--ink-soft)', cursor: 'pointer', fontSize: '1.1rem' }} title="Remove">×</button>
                            </div>
                        ))}
                    </div>
                    <div style={{ borderTop: '1px solid var(--line)', padding: '14px 20px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                            <div><span style={lbl}>Customer PO #</span><input value={soExtras.po} onChange={e => setSoExtras(p2 => ({ ...p2, po: e.target.value }))} placeholder="their PO number" style={{ ...inp, width: '100%' }} /></div>
                            <div><span style={lbl}>Sidemark / job (memo + line tag)</span><input value={soExtras.sidemark} onChange={e => setSoExtras(p2 => ({ ...p2, sidemark: e.target.value }))} placeholder="e.g. SMITH RESIDENCE" style={{ ...inp, width: '100%' }} /></div>
                            <div style={{ gridColumn: '1 / -1' }}><span style={lbl}>Internal memo (optional — never customer-facing)</span><input value={soExtras.internalMemo} onChange={e => setSoExtras(p2 => ({ ...p2, internalMemo: e.target.value }))} style={{ ...inp, width: '100%' }} /></div>
                            {/* Need-by + production notes (Stuart 2026-08-28): ride the SO record, the
                                Order Entry Needs board, every work order this order fires, and the WMS
                                card — the manufacturing side reads them everywhere the order goes. */}
                            <div><span style={lbl}>Need-by date (production)</span><input type="date" value={soExtras.needBy} onChange={e => setSoExtras(p2 => ({ ...p2, needBy: e.target.value }))} style={{ ...inp, width: '100%' }} /></div>
                            <div><span style={lbl}>Production notes (rides to the floor)</span><input value={soExtras.prodNotes} onChange={e => setSoExtras(p2 => ({ ...p2, prodNotes: e.target.value }))} placeholder="e.g. match sample on file · ship complete" style={{ ...inp, width: '100%' }} /></div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '10px' }}>
                            <span style={{ ...lbl, marginBottom: 0, flex: 1 }}>Shipping</span>
                            {[['SAVED', 'Saved address'], ['CUSTOM', 'Custom drop-ship']].map(([k, l2]) => (
                                <button key={k} onClick={() => setShip(prev => ({ ...prev, method: k }))} style={{ padding: '7px 12px', border: `1px solid ${ship.method === k ? 'var(--ink)' : 'var(--line)'}`, background: ship.method === k ? 'var(--ink)' : '#fff', color: ship.method === k ? '#fff' : 'var(--ink-soft)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase' }}>{l2}</button>
                            ))}
                        </div>
                        {ship.method === 'SAVED' ? (
                            (selectedCustomer?.shippingAddresses?.length ? (
                                <select value={ship.addressId} onChange={e => setShip(prev => ({ ...prev, addressId: e.target.value }))} style={{ ...inp, width: '100%', marginBottom: '10px' }}>
                                    <option value="">— saved NetSuite address (default if blank) —</option>
                                    {selectedCustomer.shippingAddresses.map(a => <option key={a.addressBookId} value={a.addressBookId}>{a.label} — {a.addr1}, {a.city} {a.state}</option>)}
                                </select>
                            ) : <div style={{ fontSize: '0.82rem', color: 'var(--ink-soft)', fontStyle: 'italic', marginBottom: '10px' }}>No synced NetSuite addresses — use Custom drop-ship, or the SO ships to the customer default.</div>)
                        ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
                                <input placeholder="Attention" value={ship.custom.attention} onChange={e => setShip(p2 => ({ ...p2, custom: { ...p2.custom, attention: e.target.value } }))} style={inp} />
                                <input placeholder="Addressee / company" value={ship.custom.addressee} onChange={e => setShip(p2 => ({ ...p2, custom: { ...p2.custom, addressee: e.target.value } }))} style={inp} />
                                <input placeholder="Address 1" value={ship.custom.addr1} onChange={e => setShip(p2 => ({ ...p2, custom: { ...p2.custom, addr1: e.target.value } }))} style={{ ...inp, gridColumn: '1 / -1' }} />
                                <input placeholder="Address 2" value={ship.custom.addr2} onChange={e => setShip(p2 => ({ ...p2, custom: { ...p2.custom, addr2: e.target.value } }))} style={{ ...inp, gridColumn: '1 / -1' }} />
                                <input placeholder="City" value={ship.custom.city} onChange={e => setShip(p2 => ({ ...p2, custom: { ...p2.custom, city: e.target.value } }))} style={inp} />
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <input placeholder="ST" value={ship.custom.state} onChange={e => setShip(p2 => ({ ...p2, custom: { ...p2.custom, state: e.target.value } }))} style={{ ...inp, width: '54px' }} />
                                    <input placeholder="Zip" value={ship.custom.zip} onChange={e => setShip(p2 => ({ ...p2, custom: { ...p2.custom, zip: e.target.value } }))} style={inp} />
                                </div>
                            </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ ...lbl, marginBottom: 0 }}>Shipping charge $</span>
                            <input type="number" min="0" step="0.01" value={ship.amount} onChange={e => setShip(prev => ({ ...prev, amount: e.target.value }))} placeholder="0.00" style={{ ...inp, width: '110px', textAlign: 'right' }} />
                            <span style={{ fontSize: '0.78rem', color: 'var(--ink-soft)' }}>rides the SO header with an auto-resolved ship method</span>
                        </div>
                    </div>
                    <div style={{ borderTop: '1px solid var(--line)', padding: '16px 20px', background: 'var(--paper)' }}>
                        {/* THE CONFIRMATION (Stuart 2026-08-30: the button stayed lit "like you
                            need to push it again"). Unmissable, and it clears on the next add. */}
                        {lastCreated && cart.length === 0 && (
                            <div style={{ marginBottom: '14px', padding: '12px 14px', background: '#eaf5ec', border: '2px solid #3a7d44', fontFamily: 'var(--mono)', fontSize: '11px', color: '#2f7d3b', letterSpacing: '.04em' }}>
                                ✅ {lastCreated.kind} <b>{lastCreated.id}</b> CREATED — queued to NetSuite (number stamps back on accept). It is on the customer's CRM card now{lastCreated.kind === 'SALES ORDER' ? '; generate its production from Stock View → 🧾 Order Entry Needs' : ''}.
                            </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '14px' }}>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Est. Total</span>
                            <span style={{ fontFamily: 'var(--serif)', fontSize: '1.5rem', color: 'var(--ink)' }}>${cartTotal.toFixed(2)}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button onClick={() => pushToNetSuite('salesorder')} disabled={pushing || cart.length === 0}
                                style={{ ...btn(pushing ? 'var(--paper-2)' : 'var(--ink)', pushing ? 'var(--ink-soft)' : '#fff'), flex: 1.4, cursor: pushing ? 'wait' : 'pointer' }}>
                                {pushing ? 'Transmitting…' : 'Create Sales Order'}
                            </button>
                            <button onClick={() => pushToNetSuite('estimate')} disabled={pushing || cart.length === 0}
                                title="Same cart, same fields — pushed as a NetSuite QUOTE (estimate, CE Quote form) instead of a sales order. No pick/pack until it becomes an order."
                                style={{ ...btn('transparent', pushing ? 'var(--ink-soft)' : 'var(--ink)'), flex: 1, border: '1px solid var(--ink)', cursor: pushing ? 'wait' : 'pointer' }}>
                                {pushing ? '…' : 'Create Quote'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {trvCfg && (
                <TraverseConfiguratorModal
                    rules={trvRules} drive={trvCfg.drive} feet={trvCfg.feet} trackCount={trvCfg.trackCount || 1} kitLabel={trvCfg.kitCode}
                    itemInfo={(id) => { const it = allItems.find(x => String(x.legacyErpId || x.itemId || '').toUpperCase() === id); const r = it && findClientPriceRow(it.clientPricing, custKeys); return it ? { name: it.itemName || id, sku: r?.clientSku || '' } : null; }}
                    priceOf={(id) => { const it = allItems.find(x => String(x.legacyErpId || x.itemId || '').toUpperCase() === id); return it ? rateFor(it) : 0; }}
                    onCancel={() => setTrvCfg(null)} onApply={applyTrvComponents}
                />
            )}

            {/* FINISH CHOOSER — a pattern kit with 2+ available finishes asks for the color first */}
            {kitFinishPick && (
                <div onClick={() => setKitFinishPick(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 11000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
                    <div onClick={e => e.stopPropagation()} style={{ background: '#fff', padding: '24px', width: 'min(560px, 94vw)', border: '1px solid var(--line)', borderRadius: '4px', boxShadow: '0 16px 60px rgba(0,0,0,0.3)' }}>
                        <div style={{ fontFamily: 'var(--serif)', fontSize: '1.25rem', color: 'var(--ink)', marginBottom: '4px' }}>{kitFinishPick.name}</div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '16px' }}>Select finish — every component resolves to its /CODE variant</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                            {(kitFinishPick.finishCodes || []).map(code => {
                                const f = finishList.find(x => x.code === code);
                                return (
                                    <button key={code} onClick={() => { const k = kitFinishPick; setKitFinishPick(null); addSavedKit(k, code); }}
                                        style={{ ...btn('var(--paper-2)', 'var(--ink)'), textTransform: 'none', letterSpacing: 0, fontFamily: 'var(--sans)', fontSize: '0.9rem' }}
                                        onMouseOver={e => e.currentTarget.style.background = 'var(--brass)'} onMouseOut={e => e.currentTarget.style.background = 'var(--paper-2)'}>
                                        <span style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{code}</span>{f && f.name && f.name !== code ? ` — ${f.name}` : ''}
                                    </button>
                                );
                            })}
                        </div>
                        <button onClick={() => setKitFinishPick(null)} style={{ marginTop: '18px', background: 'none', border: 'none', color: 'var(--ink-soft)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' }}>Cancel</button>
                    </div>
                </div>
            )}

            {/* LOG */}
            {log.length > 0 && (
                <div style={{ ...card, background: 'var(--dark)', overflow: 'hidden' }}>
                    <div style={{ padding: '10px 16px', background: 'var(--dark-2)', color: 'var(--paper)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', display: 'flex', justifyContent: 'space-between' }}>
                        <span>{'>'}_ Quick Ship Log</span>
                        <button onClick={() => setLog([])} style={{ background: 'none', border: 'none', color: 'var(--paper)', cursor: 'pointer', opacity: 0.6, fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase' }}>Clear</button>
                    </div>
                    <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto', fontFamily: 'var(--mono)', fontSize: '11px' }}>
                        {log.map((l, i) => {
                            let c = '#a8a5a0';
                            if (l.type === 'error') c = '#e27373';
                            if (l.type === 'success') c = '#7dbb81';
                            if (l.type === 'warn') c = '#e2b373';
                            return <div key={i} style={{ color: c }}><span style={{ opacity: 0.5, marginRight: '8px' }}>[{l.time}]</span>{l.msg}</div>;
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

export default QuickShipTab;
