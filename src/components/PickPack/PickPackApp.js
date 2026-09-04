import React, { useState, useEffect, useRef, useMemo } from 'react';
import { BRAND_NETSUITE_MAP } from '../Shared/brandNetsuite';
import OrderStatusChips from '../Shared/OrderStatusChips';
import { orderStatusOf, customPartsReady } from '../Shared/orderStatus';
import WhereIsIt from '../Shared/WhereIsIt';
import { woRefOf } from '../Shared/woRef';
import { queueNsAssemblyWorkOrder, pickNsWoItem } from '../Shared/nsWorkOrder';
import { groupPickLines, groupingSummary, codeHealth, isDataProblem } from '../Shared/pickOrder';
import { packLinesOf as packLinesShared, pickableLinesOf } from '../Shared/pickLines';
import { fetchAvailabilityUnits } from '../Shared/oeReviewPlan';
import { committedBinOf, committedQtyOf, planCommit, planRelease, totalGathered, planAllocation, allocationSummary } from '../Shared/committedBins';
import { isPaintOnlyOrder, paintOnlyAdjustment, PAINT_ONLY_BADGE } from '../Shared/paintOnly';
import { db, auth, functions, getOuterIdToken, storage } from '../../firebase';
import { collection, onSnapshot, doc, setDoc, updateDoc, getDoc, addDoc, deleteDoc, getDocs, query, where, serverTimestamp, deleteField, arrayUnion, runTransaction } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { signInWithCustomToken } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { CATEGORY_NAME_RX } from '../Shared/itemCodeMatch';
import SharedMessaging from '../Shared/SharedMessaging';
import AssetGalleryTab from '../Shared/AssetGalleryTab';
import AppImprovementTab from '../Shared/AppImprovementTab';
import { resolveByExactKey, normalizeKey, stagingScanMatches, woItemCodeOf, woItemNameOf, mirrorCustomStatusToSibling } from '../Shared/workOrderContract';
import { hardDeleteWithLedger, propagateFloorState, closeOrderEverywhere } from '../Shared/orderLifecycle';
import { clearConvertGate } from '../Shared/finishedRunPrecheck';
import { printPlatingPackingList } from '../Shared/platingPackingList';
import { downloadPlatingOrderPdf } from '../Shared/platingOrderPdf';
import { PICK_TABS, pickTabLabel } from '../Shared/pickTabs';
import { LANGS, readLang, writeLang, translator, coverageOf } from '../Shared/i18n';
import { holdOrder, releaseHold } from '../Shared/orderHold';
import { poleLengthOf, isPoleCategory, cutOptionsFor, targetCodeFor, planManualCut } from '../Shared/poleCut';
import HeldOrdersBanner from '../Shared/HeldOrdersBanner';
import { printItemLabel, printBinLabel, printItemLabels, printSetupLabel, printHandshakeLabels, printMachineLoadLabels, printStockItemLabels, printRodLabels, code128BSvg, emitLabel } from '../Shared/labelPrint';
import { machineLoadPlan } from '../Shared/finishingTime';
import { shortagesOf, coverPlan } from '../Shared/finishRouting';
import { readConvertDiag, diagSummary, isHealthyState } from '../Shared/convertDiag';
import { useRetiredSet } from '../Shared/retiredItems';
import { nsProxyFetch } from "../Shared/nsProxy";
import { enqueueNsWrite } from "../Shared/nsOutbox";
import { fetchNsPurchaseOrder, importNsPurchaseOrder, recordPoReceipt, openQtyOf, poRef } from "../Shared/purchaseOrders";
import { clearReceiptGate } from "../Shared/workOrderCreate";

const theme = { paper: '#faf8f4', paper2: '#f2efe8', ink: '#1c1a16', inkSoft: '#524e46', brass: '#b08d57', line: 'rgba(28,26,22,.14)', serif: "'Cormorant Garamond', Georgia, serif", sans: "'Inter', -apple-system, sans-serif", mono: "'IBM Plex Mono', monospace" };

// Packing photos come off a tablet camera at 3–5MB — downscale to ≤1600px JPEG before Storage
// upload. Caller falls back to the raw file if the browser can't decode the format (e.g. HEIC).
const downscalePackImage = (file, maxDim = 1600) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(img.src);
        c.toBlob(b => b ? resolve(b) : reject(new Error('compress failed')), 'image/jpeg', 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error('unreadable image')); };
    img.src = URL.createObjectURL(file);
});

// TABS updated to include COUNT + CHIPS (sample-chip production control)
const TABS = PICK_TABS;   // one definition, shared with the HQ role matrix (Shared/pickTabs)

// Sample-chip production steps, in run order. Painting reuses the paint recipes (P01, P02…).
// Finishes for the big HDSC chip run: P01–P30 (incl. P25), EP1–EP6, S01–S12 = 48 finishes.
const HDSC_RUN_FINISHES = [
  ...Array.from({ length: 30 }, (_, i) => 'P' + String(i + 1).padStart(2, '0')),
  ...Array.from({ length: 6 }, (_, i) => 'EP' + (i + 1)),
  ...Array.from({ length: 12 }, (_, i) => 'S' + String(i + 1).padStart(2, '0')),
];

const CHIP_STEPS = [
  { key: 'punching', label: 'Punching' },
  { key: 'painting', label: 'Painting' },
  { key: 'sanding', label: 'Sanding' },
  { key: 'cleaning', label: 'Cleaning' },
  { key: 'engraving', label: 'Engraving' },
];
const CHIP_STATUS_NEXT = { pending: 'doing', doing: 'done', done: 'pending' };

// NetSuite Mapping Dictionary
// ONE copy now — Shared/brandNetsuite.js (2026-08-25).


// --- LABEL PRINTING ----------------------------------------------------------------------------
// Labels print through the browser's NORMAL print queue (Stuart 2026-07-28: "can you just use a
// normal print queue rather than a zpl? we can't print the set up label"). The Zebra BrowserPrint
// path — raw ZPL straight to a ZP505 with no dialog — needs a local agent installed and running on
// the station; where it isn't, the attempt just burns a second and the operator sees nothing. It is
// now OPT-IN per station: localStorage 'labelPrintMode' = 'zebra' restores auto-print to the Zebra.

const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// esc / code128BSvg / printHtmlLabel / printZplBrowserPrint / emitLabel used to live here. They are
// now the shared route in Shared/labelPrint so Shop Floor prints through exactly the same code —
// one implementation, one place to fix. Behaviour on this screen is unchanged.

// Bin / ERP-id helpers (raw items carry binLocation top-level after mapping; library docs nest it under manufacturingSpecs).
const binOf = (p) => (p?.binLocation || p?.manufacturingSpecs?.binLocation || 'UNASSIGNED');
const erpOf = (p) => String(p?.legacyErpId || p?.itemId || '').toUpperCase();

// The plain REST record API can't set a build's component bin (the component sublist is static and
// unpopulated at create time), so the convert build runs through a SuiteScript RESTlet
// (netsuite/ce_convert_build_restlet.js) that sources the BOM then sets the bin on the raw line.
// After deploying it, set the Script internal id + Deploy id here.
const NS_RESTLET_HOST = 'https://3728153.restlets.api.netsuite.com';
const NS_CONVERT_RESTLET = { scriptId: '2848', deployId: '1' }; // CE Convert RESTlet (customdeploy1)
const convertRestletConfigured = () => !!NS_CONVERT_RESTLET.scriptId;

// Build a phosphated /P assembly via the RESTlet: it consumes the bin-tracked raw from `bin` and
// produces the /P (bin-untracked). Returns { success, id, componentsDetailed } or throws.
const postConvertBuild = async ({ itemId, quantity, subsidiary, location, bin, toBin, memo, diag, mode, workOrderId }) => {
    if (!convertRestletConfigured()) throw new Error("The Convert RESTlet isn't configured yet. Deploy netsuite/ce_convert_build_restlet.js in NetSuite and give me its Script + Deploy ids.");
    const url = `${NS_RESTLET_HOST}/app/site/hosting/restlet.nl?script=${NS_CONVERT_RESTLET.scriptId}&deploy=${NS_CONVERT_RESTLET.deployId}`;
    // workOrderId (2026-08-30): the demand's open NetSuite /P work order — the build posts AGAINST
    // it (createdfrom), consuming its commitment, instead of a standalone build leaving it open.
    const r = await nsProxyFetch({ targetUrl: url, method: 'POST', payload: { itemId, quantity, subsidiary, location, bin, toBin, memo, ...(diag ? { diag: true } : {}), ...(mode ? { mode } : {}), ...(workOrderId ? { workOrderId: String(workOrderId) } : {}) } });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(typeof b === 'object' ? JSON.stringify(b) : String(b));
    if (b && b.success === false) {
        const stepStr = b.step ? ` (at step: ${b.step})` : '';
        const c = b.context;
        const ctxStr = (c && (c.subsidiary != null || c.location != null || c.item != null))
            ? ` [sub=${c.subsidiary ?? '?'} loc=${c.location ?? '?'} item=${c.item ?? '?'}]` : '';
        throw new Error((b.error || 'RESTlet build failed') + stepStr + ctxStr);
    }
    return b;
};
// A finish's code is the assembly suffix (H1-138EC + EP1 → H1-138EC/EP1). Some finish records carry the
// identifier in `name` rather than `code`, so fall back to name — that's the suffix the assembly uses.
const finishCodeOf = (f) => String((f && (f.code || f.name)) || '').toUpperCase();

// Initial-stock plating WO# for MANUAL pulls (no HQ demand yet): IS_ + today's MMDDYY (e.g. IS_061926).
// Demand-routed pulls keep their own WO# (PLW-…); this only seeds the field when starting a manual pull.
const isStockWoNumber = () => {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    return `IS_${mm}${dd}${yy}`;
};

const PickPackApp = ({ activeBrand: activeBrandProp, setActiveBrand: setActiveBrandProp }) => {
    // Mounted standalone at /pick-pack with no props, so own the brand here (persisted) when no parent
    // controls it. The header switcher was a no-op before because setActiveBrand was undefined.
    const [internalBrand, setInternalBrand] = useState(() => {
        try { return localStorage.getItem('pp_brand') || activeBrandProp || 'ce'; } catch (e) { return activeBrandProp || 'ce'; }
    });
    const activeBrand = activeBrandProp || internalBrand;
    const setActiveBrand = setActiveBrandProp || ((b) => { setInternalBrand(b); try { localStorage.setItem('pp_brand', b); } catch (e) { /* storage unavailable */ } });

    const [operator, setOperator] = useState(null);
    const [pinInput, setPinInput] = useState("");
    const [activeTab, setActiveTab] = useState('QUEUE');
    // Sample-chip production control
    const [chipOrders, setChipOrders] = useState([]);
    const [showChipStats, setShowChipStats] = useState(false); // 📊 chip production statistics modal
    const [finUsers, setFinUsers] = useState([]);     // employees, for per-step assignment
    const [finRecipes, setFinRecipes] = useState([]); // paint recipes (P01, P02…) for the painting step
    const [chipForm, setChipForm] = useState({ customer: '', qty: 1, recipe: '', notes: '' });
    const [chipShowDone, setChipShowDone] = useState(false);
    const [batchQty, setBatchQty] = useState({}); // assign-amount per `${orderId}::${finish}` (default 200)
    const [perms, setPerms] = useState({});
    const [jobs, setJobs] = useState([]);
    const [finAll, setFinAll] = useState([]); // every fin_workorder (packing station's source)
    
    // Picking & Staging State
    const [activePickJob, setActivePickJob] = useState(null);
    const [currentPickLine, setCurrentPickLine] = useState(0);
    const [validation, setValidation] = useState({ bin: '', qty: '' });
    const [pickSkips, setPickSkips] = useState([]); // lines skipped this pick (order flagged, fixed later)
    const [expandedJob, setExpandedJob] = useState(null); // awaiting-pick card whose BOM detail is open
    const [expandedStaged, setExpandedStaged] = useState(null); // awaiting-staging row whose details are open
    // §A2: the staging handshake is a two-label verify — small-parts label + custom (shop) label.
    const [stagingSmallScan, setStagingSmallScan] = useState('');
    const [stagingCustomScan, setStagingCustomScan] = useState('');
    const [showNacho, setShowNacho] = useState(false);

    // Counting State
    const [hqParts, setHqParts] = useState([]);
    const retiredSet = useRetiredSet(); // internal-ID set of retired "- OLD" items → hidden from the count list
    const [nsStock, setNsStock] = useState({});
    const [isSyncing, setIsSyncing] = useState(false);
    const [physicalCounts, setPhysicalCounts] = useState({});
    const [binEdits, setBinEdits] = useState({}); // per-item bin reassignment during a count; a new bin is created in NetSuite on push
    const [extraCountRows, setExtraCountRows] = useState([]); // operator-added count rows for stock found in a bin NetSuite doesn't show yet ({id,itemId})
    const [showSynapsis, setShowSynapsis] = useState(false);
    const [countMemo, setCountMemo] = useState("");

    // CONVERT state (raw item -> in-house phosphated assembly build)
    const [convertBase, setConvertBase] = useState(null);      // the raw item picked from the list
    const [convertTargetId, setConvertTargetId] = useState(""); // manual override of the resolved /P assembly
    const [convertTargetSearch, setConvertTargetSearch] = useState("");
    const [convertQty, setConvertQty] = useState("");
    const [convertSrcScan, setConvertSrcScan] = useState("");
    const [convertDestScan, setConvertDestScan] = useState("");
    const [convertMemo, setConvertMemo] = useState("");
    const [convertLot, setConvertLot] = useState(""); // lot/serial # for the finished assembly (lot-tracked assemblies require it)
    const [convertDemandId, setConvertDemandId] = useState(null); // convert_demand doc this modal was opened from (cleared when its cart line converts)
    const [convertDemands, setConvertDemands] = useState([]);     // convert_demand — "Needs Phosphating" to-dos routed from HQ Stock View (3-Tier)
    // Conversion Cart (batch phosphate): pull raw -> a WIP cart bin in one trip, then convert off the cart.
    const [convBatch, setConvBatch] = useState(null);   // the active open batch for this brand
    const [cartBin, setCartBin] = useState('PHOS-CART'); // WIP bin the raw is staged into
    const [cartBinEdits, setCartBinEdits] = useState({}); // per-line put-away bin (finished /P is bin-untracked → reference)

    // BIN TRANSFER state (move qty between bins within a location)
    const [transferBase, setTransferBase] = useState(null);
    const [transferSrcScan, setTransferSrcScan] = useState("");
    const [transferQty, setTransferQty] = useState("");
    const [transferDestScan, setTransferDestScan] = useState("");
    const [transferMemo, setTransferMemo] = useState("");

    // PLATING WIP state (pull raw stock out to a plating staging bin + WIP-Plating status)
    const [platingBase, setPlatingBase] = useState(null);
    const [platingSrcScan, setPlatingSrcScan] = useState("");
    const [platingQty, setPlatingQty] = useState("");
    const [platingDestScan, setPlatingDestScan] = useState("");
    const [platingMemo, setPlatingMemo] = useState("");
    const [platingWO, setPlatingWO] = useState(""); // work order # (from HQ RTG) — printed on the plating label
    const [platingDemands, setPlatingDemands] = useState([]); // plating_demand — "Needs Plating" to-dos routed from the Library WO tool
    const [platingDemandId, setPlatingDemandId] = useState(null); // the demand the current pull is fulfilling (deleted on success)
    const [platingStaged, setPlatingStaged] = useState([]); // open (staged) plating-shipment lines
    const [platingShipped, setPlatingShipped] = useState([]); // lines shipped to the plater, awaiting receive/build-back
    const [platingReceived, setPlatingReceived] = useState([]); // lines received back from the plater, awaiting build-back (Phase 4b)
    const [platingFinish, setPlatingFinish] = useState(""); // selected outsource finish doc id — the plated finish to apply (drives the target assembly erpId/CODE)
    const [outsourceFinishes, setOutsourceFinishes] = useState([]); // hq_outsource_finishes (EP1, EP2…) — finish code + NS-synced vendor
    const [showShipModal, setShowShipModal] = useState(false);
    const [shipCosts, setShipCosts] = useState({}); // {plating_shipments docId: plating $/ea string}
    const [platingFees, setPlatingFees] = useState({}); // system/plating_fees.rules — { PRODUCTTYPE: { fee, unit } }
    const [expandedShip, setExpandedShip] = useState({}); // out-at-plater shipments: collapsed by default
    const [expandedSo, setExpandedSo] = useState({});     // SO Pack: force a not-yet-ready card open

    // ── THE VENDOR DOCK — RECEIVING (PO) (Stuart 2026-09-04) ──────────────────────────────────
    // "we enter po, we have a scan field to enter item id to find item on po, we receive it to
    //  cart, print labels and then scan it to final home. we also have the feature that if any
    //  outstanding backorders are waiting on these items, then they get routed directly to the
    //  finishing floor."
    //
    // Deliberately the SAME five steps as the plating receiving station below, because it is the
    // same job with a different supplier: find the line, say how many came, label them, put them
    // away, and — before they disappear onto a shelf — offer them to the orders that are waiting.
    // That last step is not new code: offerAllocation already does it for plated returns.
    const [rcvPoInput, setRcvPoInput] = useState('');    // the PO number typed or scanned at the dock
    const [rcvPo, setRcvPo] = useState(null);            // the resolved purchase order (app record)
    const [rcvBusy, setRcvBusy] = useState(false);
    const [rcvScan, setRcvScan] = useState('');          // the find box
    const [rcvFocusIdx, setRcvFocusIdx] = useState(null); // the line the scan found
    const [rcvQty, setRcvQty] = useState({});            // line index → how many arrived
    const [rcvBin, setRcvBin] = useState('');            // the home bin being scanned at put-away
    // ── THE RECEIVING STATION (Stuart 2026-09-03, receiving PLT-CE-1782150374239) ──────────────
    // Scan to find, receive to a cart, put the cart away — and the BUILD POSTS AT THE BIN SCAN.
    const [platingScan, setPlatingScan] = useState('');        // the find box (scanner or typing)
    const [platingFocusId, setPlatingFocusId] = useState(null); // the line the scan found
    const [cartQty, setCartQty] = useState({});                 // lineId → good pieces off the pallet
    const [openCartPanel, setOpenCartPanel] = useState(null);   // cartId being put away
    // THE ORDER RIDES WITH THE PIECES (Brief D · D1). A plating demand knows which sales order it
    // was raised for — Order Entry stamps soAppId (StockViewTab), the shop stamps salesOrderId /
    // orderKey / finSiblingId / shopOrderId (Brief C, 334c9c3). The demand is DELETED when the
    // pull posts, so whatever the returning pieces need to find their way home has to be copied
    // onto the shipment line first. Without this the plater's pallet comes back anonymous and the
    // warehouse cannot tell which order it belongs to.
    const [platingDemandLink, setPlatingDemandLink] = useState(null);
    const [paLineId, setPaLineId] = useState('');               // the line scanned at put-away
    const [paBins, setPaBins] = useState([{ bin: '', qty: '' }]); // where it physically went
    const [paMulti, setPaMulti] = useState(false);              // the rare split across bins

    // Counting Filter State
    const [searchQuery, setSearchQuery] = useState("");
    const [typeFilter, setTypeFilter] = useState("");
    const [collectionFilter, setCollectionFilter] = useState("");
    const [watchlistFilter, setWatchlistFilter] = useState("");
    const [globalLists, setGlobalLists] = useState({});

    // Quick Ship (stocked / pre-finished) sales orders — pick/pack in their OWN tab, kept separate
    // from custom orders (which arrive via fin_workorders). Sourced from hq_sales_orders tagged QUICKSHIP.
    const [quickShipOrders, setQuickShipOrders] = useState([]);

    // Fetch Global Lists & HQ Parts for cycle counting
    useEffect(() => {
        const unsubParts = onSnapshot(collection(db, "Approved_Designs"), (snap) => {
            let parts = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .filter(p => p.brandId === activeBrand || (p.sharedBrands && p.sharedBrands.includes(activeBrand))); 
            setHqParts(parts);
        });

        const unsubLists = onSnapshot(doc(db, "system", "master_lists"), (docSnap) => {
            if (docSnap.exists()) setGlobalLists(docSnap.data());
        });

        const unsubPlating = onSnapshot(collection(db, "plating_shipments"), (snap) => {
            const all = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(s => s.brandId === activeBrand);
            // Staged list sorted alphabetically by item (then finish) so it's easy to scan/find a line.
            const byErp = (a, b) => String(a.erpId || '').localeCompare(String(b.erpId || '')) || String(a.targetErpId || a.finishCode || '').localeCompare(String(b.targetErpId || b.finishCode || ''));
            setPlatingStaged(all.filter(s => s.status === 'staged').sort(byErp));
            setPlatingShipped(all.filter(s => s.status === 'shipped'));
            setPlatingReceived(all.filter(s => s.status === 'received'));
        });

        // Outsourced finishes (EP1, EP2…) — the plating finish the operator assigns at pull time. The `code`
        // is the suffix that turns a raw erpId into its plated assembly (H1-138EC + EP1 → H1-138EC/EP1).
        const unsubFinishes = onSnapshot(collection(db, "hq_outsource_finishes"), (snap) => {
            setOutsourceFinishes(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(f => f.code || f.name));
        });

        // "Needs Plating" to-dos routed from the Library WO tool (base in stock → plate it).
        const unsubDemand = onSnapshot(collection(db, "plating_demand"), (snap) => {
            setPlatingDemands(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => d.brandId === activeBrand && d.status === 'open'));
        });

        // "Needs Phosphating" to-dos routed from HQ Stock View's 3-Tier snapshot (raw core in stock →
        // convert it to the /P). Same shape/lifecycle as plating_demand: open until the cart line builds.
        const unsubConvDemand = onSnapshot(collection(db, "convert_demand"), (snap) => {
            setConvertDemands(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => d.brandId === activeBrand && d.status !== 'done'));
        }, e => console.warn('convert demand listen failed (publish the convert_demand firestore rule)', e));

        // Plating fee schedule (by product type) — edited in HQ Admin. The plater PO/packing-list cost.
        const unsubFees = onSnapshot(doc(db, "system", "plating_fees"), (s) => setPlatingFees(s.exists() ? (s.data().rules || {}) : {}));

        // Active conversion cart (one open batch per brand) for the phosphate pull → convert workflow.
        const unsubBatch = onSnapshot(query(collection(db, "conversion_batches"), where("brand", "==", activeBrand), where("status", "==", "open")), (snap) => {
            const open = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            setConvBatch(open[0] || null);
            if (open[0]?.cartBin) setCartBin(open[0].cartBin);
        });

        // Quick Ship stock orders for this brand (own pick/pack tab).
        const unsubQS = onSnapshot(query(collection(db, "hq_sales_orders"), where("orderClass", "==", "QUICKSHIP")), (snap) => {
            // NS_QUEUED = saved locally, NetSuite not yet accepted (staged sync) — not floor work yet.
            const rows = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(o => o.brand === activeBrand && o.status !== 'NS_QUEUED');
            rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            setQuickShipOrders(rows);
        }, e => console.warn('quick ship orders listen failed', e));

        return () => { unsubParts(); unsubLists(); unsubPlating(); unsubFinishes(); unsubDemand(); unsubConvDemand(); unsubFees(); unsubBatch(); unsubQS(); };
    }, [activeBrand]);

    // Global, brand-agnostic feeds for the Chips control (orders + employees + paint recipes). Their OWN
    // mount-only effect so they subscribe ONCE and stay live — they don't churn on brand switches, so a
    // seeded run pushes to every open screen live (no need to leave the tab and come back).
    useEffect(() => {
        const subs = [
            onSnapshot(collection(db, "sample_chip_orders"), (snap) => setChipOrders(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))), e => console.warn('chip orders listen failed', e)),
            onSnapshot(collection(db, "fin_users"), (snap) => setFinUsers(snap.docs.map(d => ({ id: d.id, ...d.data() }))), e => console.warn('fin_users listen failed', e)),
            onSnapshot(collection(db, "fin_recipes"), (snap) => setFinRecipes(snap.docs.map(d => ({ id: d.id, ...d.data() }))), e => console.warn('fin_recipes listen failed', e)),
        ];
        return () => subs.forEach(u => u && u());
    }, []);

    // ---- Sample-chip handlers ----
    const createChipOrder = async () => {
        if (!chipForm.recipe) return alert('Pick a paint recipe for the chips.');
        const qty = parseInt(chipForm.qty) || 1;
        const id = `CHIP-${Date.now()}`;
        const steps = {};
        CHIP_STEPS.forEach(s => { steps[s.key] = { status: 'pending', employee: '' }; });
        steps.painting.recipe = chipForm.recipe;
        await setDoc(doc(db, "sample_chip_orders", id), {
            id, brand: activeBrand, customer: chipForm.customer.trim() || 'Sample Chips',
            qty, recipe: chipForm.recipe, notes: chipForm.notes.trim(),
            status: 'open', inFinishing: false, steps,
            createdAt: Date.now(), createdBy: operator?.name || 'Unknown'
        });
        setChipForm({ customer: '', qty: 1, recipe: '', notes: '' });
        writeLog(`Sample-chip order ${id} created (${qty}× ${chipForm.recipe}).`, 'CHIPS');
    };
    const patchChipStep = async (order, stepKey, patch) => {
        const steps = { ...(order.steps || {}) };
        steps[stepKey] = { ...(steps[stepKey] || {}), ...patch };
        // Chips consume finishing capacity from the moment Painting starts until the whole order is done.
        const allDone = CHIP_STEPS.every(s => steps[s.key]?.status === 'done');
        const paintingStarted = steps.painting?.status && steps.painting.status !== 'pending';
        await updateDoc(doc(db, "sample_chip_orders", order.id), {
            steps, inFinishing: !!paintingStarted && !allDone, status: allDone ? 'done' : 'open', updatedAt: Date.now()
        });
    };
    const advanceChipStep = (order, stepKey) =>
        patchChipStep(order, stepKey, { status: CHIP_STATUS_NEXT[order.steps?.[stepKey]?.status || 'pending'] });
    const deleteChipOrder = async (id) => {
        if (!window.confirm('Remove this sample-chip order?\n\nA copy is kept on the master Deletion Ledger (RTG Dispatch).')) return;
        try {
            const snap = await getDoc(doc(db, "sample_chip_orders", id));
            await hardDeleteWithLedger({ db, doc, setDoc, deleteDoc }, {
                collection: 'sample_chip_orders', docId: id, record: snap.exists() ? snap.data() : { id },
                kind: 'sample_chip_orders', by: operator?.name || '', from: 'WMS', reason: '',
            });
        } catch (e) { alert('Delete refused — the Deletion Ledger entry could not be written: ' + (e.message || e)); }
    };

    // ---- Big multi-finish chip RUN (HDSC) ----
    // Model: the ORDER (lines: finish/qty/completed) is the top. Production is done in separate WORKING
    // BATCHES (e.g. 200 pcs of a finish at a time) that people sign in/out of per step; completing a batch
    // rolls its qty into that finish's completed.
    const mkChipSteps = () => { const s = {}; CHIP_STEPS.forEach(st => { s[st.key] = { status: 'pending', employee: '', startedBy: '', startedAt: null, stoppedBy: '', stoppedAt: null }; }); return s; };
    const updateOrderDoc = (order, patch) => updateDoc(doc(db, "sample_chip_orders", order.id), { ...patch, updatedAt: Date.now() });
    const seedHdscRun = async () => {
        if (!window.confirm(`Seed the HDSC sample-chip run — 1500 pcs each across ${HDSC_RUN_FINISHES.length} finishes (P01–P30, EP1–EP6, S01–S12)?`)) return;
        const id = `CHIPRUN-HDSC-${Date.now()}`;
        const lines = HDSC_RUN_FINISHES.map(f => ({ finish: f, qty: 1500, completed: 0 }));
        await setDoc(doc(db, "sample_chip_orders", id), {
            id, brand: activeBrand, type: 'run', code: 'HDSC', customer: 'HDSC Sample Chip Run',
            status: 'open', inFinishing: false, lines, batches: [], createdAt: Date.now(), createdBy: operator?.name || 'Unknown'
        });
        writeLog(`Seeded HDSC chip run (${lines.length} finishes × 1500).`, 'CHIPS');
        alert(`✅ Seeded HDSC chip run: ${lines.length} finishes × 1500 pcs. Enter what's already complete, then assign batches to the floor.`);
    };
    const setRunCompleted = (order, finish, val) => {
        const line = (order.lines || []).find(l => l.finish === finish);
        const c = Math.max(0, Math.min(parseInt(val) || 0, line?.qty || 0));
        return updateOrderDoc(order, { lines: (order.lines || []).map(l => l.finish === finish ? { ...l, completed: c } : l) });
    };
    // Assign a working batch (a sign-in card) for a finish — defaults to 200, capped at what's missing.
    const assignBatch = (order, finish, qtyVal) => {
        const qty = Math.max(1, parseInt(qtyVal) || 0);
        const batch = { id: `B${Date.now()}`, finish, qty, status: 'working', steps: mkChipSteps(), createdAt: Date.now(), createdBy: operator?.name || 'Unknown' };
        return updateOrderDoc(order, { batches: [...(order.batches || []), batch] });
    };
    const updateBatch = (order, batchId, mutate) => updateOrderDoc(order, { batches: (order.batches || []).map(b => b.id === batchId ? mutate({ ...b, steps: { ...(b.steps || {}) } }) : b) });
    const batchStepEmployee = (order, batchId, stepKey, employee) => updateBatch(order, batchId, b => ({ ...b, steps: { ...b.steps, [stepKey]: { ...(b.steps?.[stepKey] || {}), employee } } }));
    // PIN-gated start/stop on a process — valid PIN required; records who + when.
    const batchStepClock = (order, batchId, stepKey, stepLabel, action) => {
        const pin = window.prompt(`Enter your PIN to ${action === 'start' ? 'START' : 'STOP'} ${stepLabel}`);
        if (pin == null || !String(pin).trim()) return;
        const user = finUsers.find(u => String(u.pin) === String(pin).trim());
        if (!user) return alert('PIN not recognized.');
        return updateBatch(order, batchId, b => { const cur = b.steps?.[stepKey] || {}; return action === 'start'
            ? { ...b, steps: { ...b.steps, [stepKey]: { ...cur, status: 'running', employee: cur.employee || user.name, startedBy: user.name, startedAt: Date.now(), stoppedBy: '', stoppedAt: null } } }
            : { ...b, steps: { ...b.steps, [stepKey]: { ...cur, status: 'done', stoppedBy: user.name, stoppedAt: Date.now() } } }; });
    };
    const completeBatch = (order, batch) => {
        if (!window.confirm(`Complete this batch — add ${batch.qty} pcs to ${batch.finish}'s completed?`)) return;
        const lines = (order.lines || []).map(l => l.finish === batch.finish ? { ...l, completed: Math.min(l.qty, (l.completed || 0) + batch.qty) } : l);
        const batches = (order.batches || []).map(b => b.id === batch.id ? { ...b, status: 'done', completedAt: Date.now() } : b);
        return updateOrderDoc(order, { lines, batches });
    };
    const removeBatch = (order, batchId) => { if (!window.confirm('Discard this working batch?')) return; return updateOrderDoc(order, { batches: (order.batches || []).filter(b => b.id !== batchId) }); };

    const attemptLogin = async (e) => {
        e.preventDefault();
        if (!pinInput) return;
        try {
            // 🔐 Same secure flow as HQ: mint a custom token server-side, then sign in.
            const authenticatePin = httpsCallable(functions, 'authenticatePin');
            const result = await authenticatePin({ pin: pinInput, outerToken: await getOuterIdToken() });
            const { token, user: userData } = result.data;

            await signInWithCustomToken(auth, token);

            // All-tabs access is granted at render time to the admin/superadmin role claim (see
            // myTabs); there is no client-side master PIN. Everyone loads configured permissions here.
            const pSnap = await getDoc(doc(db, "pick_config", "permissions"));
            const pData = pSnap.exists() ? pSnap.data() : {};
            setPerms(pData);
            setOperator(userData);
            const r = userData.role ? userData.role.toLowerCase() : 'operator';
            // Return the operator to the screen they were on — it survives the per-transaction
            // logout (the component stays mounted). Only fall back to a default if their current
            // tab isn't permitted (e.g. the very first login).
            const allowed = pData[r] || pData['operator'] || TABS;
            setActiveTab(prev => allowed.includes(prev) ? prev : (allowed.includes('QUEUE') ? 'QUEUE' : (allowed[0] || 'QUEUE')));
            setPinInput("");
        } catch (error) {
            console.error("Authentication failed:", error);
            alert("Authentication failed: " + (error.message || "Invalid PIN"));
            setPinInput("");
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('hq_session');
        window.location.href = '/';
    };

    const writeLog = async (msg, cat) => {
        try { await addDoc(collection(db, "hq_logs"), { u: operator?.name || 'Unknown', msg, cat, t: serverTimestamp() }); } 
        catch (error) { console.error("Failed to write log:", error); }
    };

    useEffect(() => {
        const unsub = onSnapshot(collection(db, "fin_workorders"), (snap) => {
            const fetched = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            setJobs(fetched.filter(j => j.sentToPickPack));
            // Packing station reads the UNfiltered set: an order can finish without ever being
            // released to pick (pole-only jobs), and it still has to be packed.
            setFinAll(fetched);
        });
        return () => unsub();
    }, []);

    // Standard boxes from HQ → Packaging (tab 15) — the box designs the packing groups align to.
    const [stdBoxes, setStdBoxes] = useState([]);
    useEffect(() => {
        const unsub = onSnapshot(collection(db, 'standard_boxes'), s => setStdBoxes(s.docs.map(d => ({ id: d.id, ...d.data() }))), () => {});
        return () => unsub();
    }, []);

    // Sales-order join for the pick cards: customer name + sidemark/memo + customer PO.
    const [soIndex, setSoIndex] = useState({});
    useEffect(() => {
        const unsub = onSnapshot(collection(db, "hq_sales_orders"), (snap) => {
            const m = {};
            snap.docs.forEach(d => { const so = { id: d.id, ...d.data() }; if (so.soId) m[String(so.soId)] = so; m[String(d.id)] = so; });
            setSoIndex(m);
        });
        return () => unsub();
    }, []);
    // Returns/fees leaked into some already-dispatched partsLists — never pickable (no item #,
    // no bin; the bend rides the shop's custom order). New splits exclude them at the source
    // (lineClassification rule 0); this filter heals orders dispatched before that.
    // Fee/return/splice heal for ALREADY-dispatched partsLists (line-only signals — no part
    // join here): explicit fee flags, or a fee-ish name on a line with NO real item #.
    // Names alone are NOT enough — real backplates echo the return option in their names
    // ("Backplate (Mounting Base for 1\" French Return)") and must stay pickable.
    // ── NETSUITE CAPS THE MEMO AT 40 CHARACTERS (Sandra 2026-08-19) ────────────────────────────
    // Her bin count came back: "The field memo contained more than the maximum number ( 40 ) of
    // characters allowed." — so the whole adjustment was rejected and three bins' worth of counting
    // was lost, over a sentence being too long.
    //
    // Every memo we send is built the same way ("Cycle count by Sandra B — moved to right bin"),
    // so this is not one bad string, it is a pattern that happens to fit sometimes. The memo is a
    // convenience; the transaction is the point. So it is cut to fit, front-first — the identifying
    // half ("Cycle count by …") is what anyone reading NetSuite needs, and the FULL text is written
    // to the app log either way, which is where the detail actually lives.
    const NS_MEMO_MAX = 40;
    const nsMemo = (s) => {
        const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
        return t.length <= NS_MEMO_MAX ? t : `${t.slice(0, NS_MEMO_MAX - 1).trimEnd()}…`;
    };

    // THE FEE TEST NOW LIVES IN Shared/pickLines (Brief D · D7). It was here, and a near-copy was
    // in lineClassification, and the pick/pack/label readers each had their own idea of a line.
    // Moving it found two things the local copy got wrong: an explicit FEE- code still needed its
    // NAME to agree before it counted as a fee, and the name pattern required the SINGULAR
    // "RETURN" — so FEE-H1-MRPF called "Mitered Returns" passed both tests and reached the packer.
    const pickableLines = pickableLinesOf;
    // LIVE PER-BIN STOCK for pick lines (Stuart 2026-07-20 — HCUBEA1 showed UNASSIGNED while
    // NetSuite held 126 in a bin: the stored library home bin was blank/stale). Pulled when a
    // card expands / picking starts / ⟳ Live is tapped; the display and the bin-scan
    // validation both prefer this truth over the stamped or stored bin.
    const [liveBins, setLiveBins] = useState({}); // ITEMID → { bins: [{bin, qty}] desc, total, at }
    const fetchLiveBins = async (codes) => {
        const list = Array.from(new Set((codes || []).map(c => String(c || '').toUpperCase()).filter(c => c && c !== 'PENDING' && c !== 'N/A')));
        if (!list.length) return;
        try {
            const loc = BRAND_NETSUITE_MAP[activeBrand]?.location || '17';
            const idList = list.map(c => `'${c.replace(/'/g, "''")}'`).join(',');
            const r = await nsProxyFetch({ targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql', method: 'POST', payload: { q: `SELECT Item.itemid AS legacy_id, Bin.binnumber AS bin_number, SUM(InventoryBalance.quantityonhand) AS onhand FROM Item LEFT JOIN InventoryBalance ON InventoryBalance.item = Item.id LEFT JOIN Bin ON InventoryBalance.binnumber = Bin.id WHERE UPPER(Item.itemid) IN (${idList}) AND InventoryBalance.location = ${loc} GROUP BY Item.itemid, Bin.binnumber` } });
            const j = await r.json();
            if (!r.ok) throw new Error(JSON.stringify(j).slice(0, 200));
            const map = {};
            // `known` = NetSuite returned at least one inventory row for this code HERE. A code it
            // says nothing about is a different problem from a code it says zero about — the
            // shortage banner tells them apart (Stuart 2026-08-03, HCUSR1-EA on WO-SO58981).
            list.forEach(c => { map[c] = { bins: [], total: 0, known: false, at: Date.now() }; });
            (j.items || []).forEach(row => {
                const id = String(row.legacy_id || '').toUpperCase();
                if (!map[id]) map[id] = { bins: [], total: 0, known: false, at: Date.now() };
                map[id].known = true;
                const qty = parseInt(row.onhand) || 0;
                map[id].total += qty;
                const bn = (row.bin_number || '').trim().toUpperCase();
                if (bn && qty > 0) map[id].bins.push({ bin: bn, qty });
            });
            Object.values(map).forEach(m => m.bins.sort((a, b) => b.qty - a.qty));
            setLiveBins(prev => ({ ...prev, ...map }));
        } catch (e) { console.warn('Live bin pull failed:', e); }
    };
    const liveOf = (l) => liveBins[String((l && (l.legacyErpId || l.partId)) || '').toUpperCase()] || null;
    // Lines carry `quantity` (custom BOM splits, synthetic stock lines) or `qty` (older docs) —
    // one accessor so displays and validation can never read the wrong field again.
    const lineQty = (l) => Number((l && (l.quantity ?? l.qty))) || 0;
    // Line bin: LIVE top-stock bin → stamped line bin → library home bin → UNASSIGNED.
    const lineBin = (l) => {
        const lv = liveOf(l);
        if (lv && lv.bins.length) return lv.bins[0].bin;
        const stamped = (l && l.binLocation && l.binLocation !== 'UNASSIGNED') ? l.binLocation : '';
        if (stamped) return stamped;
        const code = String((l && (l.legacyErpId || l.partId)) || '').toUpperCase();
        const p = code && hqParts.find(x => String(x.legacyErpId || x.itemId || '').toUpperCase() === code);
        return (p && (p.binLocation || p.manufacturingSpecs?.binLocation)) || (l && l.binLocation) || 'UNASSIGNED';
    };

    // ===== SHORT PICK → MILL CORES → OB PLATING (Stuart 2026-07-30) =====
    // "the qty in the bins is insufficient for the order needs … it needs to see the qty in the bin
    // is not enough so it really needs then look at the root item and its bin and see if we have
    // enough qty of the item sitting in the Mill Finish".
    //
    // Demand is counted PER ITEM CODE ACROSS THE ORDER, not per line — the Fabricut order carries
    // H1-1CP-V/EP4 on two separate 100-pc lines against a bin holding 100. Line by line each looks
    // satisfiable; only the total (200 vs 100) shows the short.
    // Live availability for a code — the per-bin pull if we have it, else NetSuite's combined on-hand.
    const availOf = (code) => {
        const c = String(code || '').toUpperCase();
        const lv = liveBins[c];
        if (lv) return lv.total || 0;
        return nsStock[c]?.onHand || 0;
    };
    const findPartByErpCode = (code) => { const c = String(code || '').toUpperCase(); return c ? hqParts.find(x => String(x.legacyErpId || x.itemId || '').toUpperCase() === c) || null : null; };
    const shortagesFor = (job) => shortagesOf(pickableLines(job || {}), availOf);
    const shortageOfLine = (job, line) => {
        const c = String(((line && (line.legacyErpId || line.partId)) || '')).toUpperCase();
        return shortagesFor(job).find(s => s.code === c) || null;
    };

    // Route a shortage out to the plater: raise the open Plating order, record the short on the WO,
    // then drop the operator into the existing Pull-to-Plating screen pre-filled (mill core, qty,
    // OB PLATING) so they scan the mill bin and the proven NetSuite path does the move. The demand
    // card stays open on the Plating tab and rides the weekly shipment/PO with everything else.
    const [routedShorts, setRoutedShorts] = useState({});   // CODE -> demandId, this session
    const [pickShorts, setPickShorts] = useState([]);        // lines confirmed short, balance out to the plater
    // Raise the "make more cores" flag. The Sales Snapshot's own math should already be asking for
    // these, but a live backorder can't wait for the next reorder review — so it lands there in RED
    // as URGENT (Stuart 2026-07-30: "if we do not have enough stock of the base item in mill finish
    // then it needs to pop up on the stocked sales snapshot to be work ordered … in theory it
    // should already be there by the nature of that screen design, but just in case we need to
    // highlight these items in red as urgent").
    const flagUrgentCore = async (job, sh, millHave, uncovered) => {
        const id = `UCD-${String(job.id).replace(/[^A-Za-z0-9-]/g, '')}-${sh.mill.replace(/[^A-Za-z0-9]/g, '')}`;
        await setDoc(doc(db, 'core_urgent_demand', id), {
            id, brandId: activeBrand, status: 'open',
            coreErpId: sh.mill, plateErpId: sh.code, finishCode: sh.finishCode,
            need: sh.need, onHand: sh.have, short: sh.short,
            millAvail: millHave, shortfall: uncovered,
            jobId: job.id, ref: packRef(job), customer: job.customerName || job.clientName || job.customer || '',
            createdAt: Date.now(), createdBy: operator?.name || 'WMS Pick'
        }, { merge: true });
        writeLog(`URGENT core demand: ${sh.mill} short ${uncovered} for backorder ${packRef(job)} (${sh.code}) — flagged red on the Sales Snapshot`, 'wms');
    };

    const routeShortToPlating = async (job, sh) => {
        if (!sh || !sh.plateable) {
            return alert(`${sh ? sh.code : 'This item'} has no outsourced finish suffix, so there is no mill core to plate.\n\nShort ${sh ? sh.short : ''} — raise it with HQ or skip the line.`);
        }
        await fetchLiveBins([sh.code, sh.mill]);
        const millHave = availOf(sh.mill);
        // Cover what the mill CAN cover and flag the rest — a mill with 40 of the 100 we are short
        // should still send 40 out to plate, not stall the whole line.
        const plan = coverPlan(sh.short, millHave);
        const coverable = plan.fromMill, uncovered = plan.coresToMake;

        if (!plan.plate) {
            if (!window.confirm(`❌ No mill finish either.\n\n${sh.code}: need ${sh.need}, have ${sh.have} — short ${sh.short}\n${sh.mill} (mill): ${millHave} available\n\nFlag ${sh.mill} as URGENT so it shows in red on the Stocked Sales Snapshot to be work-ordered?`)) return;
            try {
                await flagUrgentCore(job, sh, millHave, uncovered);
                alert(`⚠ Flagged. ${sh.mill} — ${uncovered} core(s) needed for ${packRef(job)}.\n\nIt is now RED · URGENT on HQ → Stock View → Stocked Sales Snapshot, where it gets work-ordered. Nothing was sent to plating.`);
            } catch (e) { alert('❌ Could not raise the urgent flag:\n\n' + (e.message || e)); }
            return;
        }

        const millPart = enrichedByErp(sh.mill);
        if (!millPart) return alert(`${sh.mill} isn't in this brand's item list yet — run Pull Live Stock / Sync NetSuite Stock, then try again.`);
        if (!window.confirm(`⚗ Cover the short from mill finish?\n\n${sh.code} — need ${sh.need}, only ${sh.have} in stock (short ${sh.short}).\n${sh.mill} has ${millHave} in mill finish.\n\nThis opens a plating order for ${coverable} pc(s) and sends you to pull them from their bin into OB PLATING. It stays open on the Plating tab and rides this week's plater PO.${uncovered > 0 ? `\n\n⚠ ${uncovered} still uncovered — ${sh.mill} will ALSO be flagged red/urgent on the Stocked Sales Snapshot to be work-ordered.` : ''}`)) return;
        try {
            if (plan.flagUrgent) await flagUrgentCore(job, sh, millHave, uncovered).catch(() => { /* the plating half still proceeds */ });
            const finish = outsourceFinishes.find(f => finishCodeOf(f) === sh.finishCode);
            const demandId = `PLD-BO-${String(job.id).replace(/[^A-Za-z0-9-]/g, '')}-${sh.code.replace(/[^A-Za-z0-9]/g, '')}`;
            await setDoc(doc(db, 'plating_demand', demandId), {
                id: demandId, brandId: activeBrand, status: 'open', woNum: packRef(job),
                baseItemId: millPart.id || null, baseErpId: sh.mill, targetErpId: sh.code,
                finishCode: sh.finishCode, finishName: (finish && (finish.name || finish.code)) || sh.finishCode,
                qty: coverable, source: 'pick-backorder',
                backorder: {
                    jobId: job.id, ref: packRef(job), customer: job.customerName || job.clientName || job.customer || '',
                    code: sh.code, need: sh.need, onHand: sh.have, short: sh.short
                },
                note: `Backorder ${packRef(job)} — short ${sh.short} of ${sh.code}${uncovered > 0 ? ` (${coverable} from mill, ${uncovered} cores to make)` : ''}`,
                createdBy: operator?.name || 'WMS Pick', createdAt: Date.now()
            }, { merge: true });
            await updateDoc(doc(db, 'fin_workorders', job.id), {
                pickHadShorts: true,
                [`pickShortages.${sh.code.replace(/[^A-Za-z0-9]/g, '_')}`]: {
                    code: sh.code, need: sh.need, onHand: sh.have, short: sh.short,
                    mill: sh.mill, millAvail: millHave, fromMill: coverable, coresToMake: uncovered,
                    finishCode: sh.finishCode, platingDemandId: demandId, at: Date.now()
                }
            }).catch(() => { /* the demand is raised either way — never block the floor on this stamp */ });
            setRoutedShorts(prev => ({ ...prev, [sh.code]: demandId }));
            writeLog(`Pick short ${packRef(job)}: ${sh.code} need ${sh.need} / have ${sh.have} → ${coverable} pulled from mill ${sh.mill} to OB PLATING${uncovered > 0 ? `; ${uncovered} core(s) flagged URGENT for a work order` : ''}`, 'wms');

            // Pre-load the pull screen: mill core, the short qty, destination OB PLATING.
            setPlatingBase(millPart);
            setPlatingQty(String(coverable));
            setPlatingFinish(finish ? finish.id : '');
            setPlatingSrcScan(''); setPlatingDestScan('OB PLATING');
            setPlatingMemo(`Backorder ${packRef(job)} — ${sh.code} short ${sh.short}${uncovered > 0 ? `, ${coverable} from mill` : ''}`);
            setPlatingWO(packRef(job));
            setPlatingDemandId(demandId);
            releaseClaim(job, 'pick');
            setActivePickJob(null);
            setActiveTab('PLATING');
        } catch (e) {
            console.error('Short → plating route failed:', e);
            alert('❌ Could not queue the plating order:\n\n' + (e.message || e));
        }
    };
    // ===== END SHORT PICK =====

    // ================= PACKING STATION (Stuart 2026-07-18) =================
    // Finished orders (currentPhase 'Complete', custom only) queue compactly up top; opening one
    // gives a two-sided workspace — TO PACK on the left, physically confirmed pieces move right.
    // Lines group by category in packing order (brackets → rings → finials → plates → other small
    // parts = the SMALL box, then poles = the LARGE box/tube), aligned to the standard boxes
    // defined on HQ → Packaging (tab 15). ≥1 photo of the packaged parts is required to complete.
    const [packOrderId, setPackOrderId] = useState(null);
    const [packUploading, setPackUploading] = useState(false);
    const [packBoxSel, setPackBoxSel] = useState({ SMALL: '', POLE: '' });
    // TWO STATIONS IN ONE TAB (Stuart 2026-07-21): STOCK builds just get PUT AWAY — confirm the
    // pieces, scan the destination bin, done (no photo, no boxes). CUSTOM/QS orders are real
    // customer packing — photo required, small/large box flow.
    const [putawayBin, setPutawayBin] = useState('');
    // BOTH HALVES, CONFIRMED AT THE BOX (Stuart 2026-08-03: "the app did not ask for the
    // scanning/aligning of the poles with the small parts"). Staging matched the halves on their
    // way IN to finishing; nothing re-checked them on the way OUT, so a packer could box one
    // order's small parts with another's poles and every screen would still read correct.
    const [packCustomScan, setPackCustomScan] = useState('');
    const [expandedPacked, setExpandedPacked] = useState(null);
    // Two order sources share this station: custom finishing WOs (fin_workorders) and Quick Ship
    // stocked sales orders from HQ tab 7 (hq_sales_orders, orderClass QUICKSHIP — queue once
    // Picked off the shelf). Writes land on whichever doc the order came from.
    const isQsOrder = (j) => j && j.orderClass === 'QUICKSHIP';
    const packDocOf = (j) => doc(db, isQsOrder(j) ? 'hq_sales_orders' : 'fin_workorders', j.id);
    const packJob = finAll.find(j => j.id === packOrderId) || quickShipOrders.find(o => o.id === packOrderId) || null;

    const PACK_GROUP_ORDER = [
        { cat: 'BRACKET', title: 'Brackets & Arms', box: 'SMALL' },
        { cat: 'RING', title: 'Rings', box: 'SMALL' },
        { cat: 'FINIAL', title: 'Finials & End Caps', box: 'SMALL' },
        { cat: 'BACKPLATE', title: 'Backplates & Plates', box: 'SMALL' },
        { cat: 'SMALL', title: 'Other Small Parts', box: 'SMALL' },
        { cat: 'POLE', title: 'Poles', box: 'POLE' },
    ];
    // Order matters: BACKPLATE before FINIAL so "Backplate (Mounting Base for French Return)"
    // lands with the plates, not the finials its name echoes.
    const packCatOf = (l) => {
        const n = `${l.erp} ${l.name}`;
        if (l.isPole || CATEGORY_NAME_RX.POLE.test(n)) return 'POLE';
        if (CATEGORY_NAME_RX.BACKPLATE.test(n)) return 'BACKPLATE';
        if (CATEGORY_NAME_RX.BRACKET.test(n)) return 'BRACKET';
        if (CATEGORY_NAME_RX.RING.test(n)) return 'RING';
        if (CATEGORY_NAME_RX.FINIAL.test(n)) return 'FINIAL';
        return 'SMALL';
    };
    // ONE READER, both dialects (Brief D · D7 — Shared/pickLines). The category tag stays here:
    // it is display grouping for the pack screen, not part of what a line IS.
    const packLinesOf = (job) => packLinesShared(job).map(l => ({ ...l, cat: packCatOf(l) }));
    const packRef = (j) => isQsOrder(j) ? `SO ${j.soId || j.id}` : woRefOf(j);

    // ── ONE ORDER, ONE PAIR OF HANDS (Stuart 2026-09-02: "make sure each is gated so once a user
    // starts a pick another user sees that and does not start to pick") ─────────────────────────
    // Starting a pick (and opening an order to pack) used to live only in this tablet's React
    // state. Nothing was written, so the same card stayed live on every other tablet and two
    // people could walk the rack for one order's parts. Now the start is a CLAIM on the order doc:
    //   pickInProgress / packInProgress = { by, startedAt }
    // written in a transaction (two simultaneous taps cannot both win), shown on every queue card
    // ("Sandra is picking this since 10:14"), and refused to anyone else. The same person can
    // resume their own claim (line progress restarts — it was never persisted). Complete and abort
    // clear it. Nothing clears on its own: a tablet that died mid-pick leaves the order claimed,
    // the card says so after CLAIM_STALE_MS, and an admin releases it with a reason that is logged.
    // The claim carries the NAME only — the hq_users doc id is the PIN and never leaves the login.
    const CLAIM_STALE_MS = 4 * 60 * 60 * 1000;
    const claimFieldOf = (kind) => kind === 'pack' ? 'packInProgress' : 'pickInProgress';
    const claimVerbOf = (kind) => kind === 'pack' ? 'packing' : 'picking';
    const claimOf = (job, kind) => (job && job[claimFieldOf(kind)] && job[claimFieldOf(kind)].by) ? job[claimFieldOf(kind)] : null;
    const claimIsMine = (c) => !!c && !!operator?.name && String(c.by || '').trim() === String(operator.name).trim();
    const claimIsStale = (c) => !!c && (Date.now() - (Number(c.startedAt) || 0)) > CLAIM_STALE_MS;
    const claimBlocks = (job, kind) => { const c = claimOf(job, kind); return !!c && !claimIsMine(c); };
    const claimSince = (c) => new Date(Number(c.startedAt) || 0).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const claimOrder = async (job, kind) => {
        const me = String(operator?.name || '').trim();
        if (!me) throw new Error('No operator signed in.');
        const field = claimFieldOf(kind);
        return runTransaction(db, async (tx) => {
            const snap = await tx.get(packDocOf(job));
            if (!snap.exists()) throw new Error('This order no longer exists.');
            const cur = snap.data()[field];
            if (cur && cur.by && String(cur.by).trim() !== me) return { ok: false, claim: cur };
            const resumed = !!(cur && cur.by);
            tx.update(packDocOf(job), { [field]: { by: me, startedAt: resumed ? (Number(cur.startedAt) || Date.now()) : Date.now() } });
            return { ok: true, resumed };
        });
    };
    const releaseClaim = async (job, kind) => {
        try { await updateDoc(packDocOf(job), { [claimFieldOf(kind)]: null }); }
        catch (e) { console.warn('claim release failed (the order stays claimed by its operator):', e); }
    };
    // Admin/supervisor release — a STATEMENT with a reason, on the order and in the log, so an
    // order taken off someone can always be accounted for.
    const adminReleaseClaim = async (job, kind) => {
        const c = claimOf(job, kind);
        if (!c) return;
        const why = window.prompt(`${c.by} has ${packRef(job)} open for ${claimVerbOf(kind)} since ${claimSince(c)}${claimIsStale(c) ? ' (no activity for 4+ hours)' : ''}.\n\nReleasing lets someone else start it — ${c.by}'s tablet will lose it.\n\nWhy? (recorded against the order)`, '');
        if (why === null) return;
        const reason = String(why).trim();
        if (!reason) return alert('A reason is needed — nothing was changed.');
        try {
            await updateDoc(packDocOf(job), { [claimFieldOf(kind)]: null, [`${claimFieldOf(kind)}Released`]: { by: operator?.name || '', at: Date.now(), was: c, reason } });
            writeLog(`${kind === 'pack' ? 'Pack' : 'Pick'} claim released on ${packRef(job)} (was ${c.by} since ${claimSince(c)}): ${reason}`, 'wms');
        } catch (e) { alert('Could not release: ' + (e.message || e)); }
    };
    const renderClaimLine = (job, kind) => {
        const c = claimOf(job, kind);
        if (!c) return null;
        const mine = claimIsMine(c), stale = claimIsStale(c);
        return (
            <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.05em', color: mine ? '#3a7d44' : (stale ? '#d9534f' : theme.brass) }}>
                <span>{mine ? `🔒 ${t(kind === 'pack' ? 'You are packing this' : 'You are picking this')}` : `🔒 ${c.by} ${t(kind === 'pack' ? 'is packing this' : 'is picking this')}`} · {t('since')} {claimSince(c)}{stale ? ` · ${t('no activity for 4+ hours')}` : ''}</span>
                {!mine && isPlatingAdmin && <button onClick={(e) => { e.stopPropagation(); adminReleaseClaim(job, kind); }} style={{ padding: '3px 8px', background: 'transparent', border: `1px solid ${stale ? '#d9534f' : theme.line}`, color: stale ? '#d9534f' : theme.inkSoft, cursor: 'pointer', fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em' }}>{t('Release (admin)')}</button>}
            </div>
        );
    };
    // Resolve a raw fin/hq WO id to the honest reference (NetSuite number first) via the
    // unfiltered fin list this screen already holds; falls back to the id itself.
    const finRefOf = (id) => { const f = id && finAll.find(x => x.id === id); return f ? woRefOf(f) : (id || ''); };

    // 🖨 PACK-LINE LABELS (Sandra + Eric 2026-08-12 App Imp): item labels for packed orders, and
    // rod labels for custom CPQ poles — Line Sidemark · Length · "1 of X" per piece (halves and
    // multi-count rods print one label each). Defaults come off the order (cart sidemark, first
    // cut length found); the prompts let the packer correct them per line before printing.
    const printPackLineLabel = (job, l) => {
        if (l.cat === 'POLE' || l.isPole) {
            const carts = (job.cpqSpecs && job.cpqSpecs.cartItems) || [];
            const defSidemark = String((carts.find(c => String(c.sidemark || '').trim()) || {}).sidemark || job.sidemark || job.note || '').trim();
            let defLen = '';
            carts.some(c => Object.values(c.dimensionInputs || {}).some(d => { if (d && d.length) { defLen = String(d.length); return true; } return false; }));
            const sidemark = window.prompt('Line sidemark for the rod label:', defSidemark); if (sidemark === null) return;
            const length = window.prompt('Length (as it should print, e.g. 96 1/2"):', defLen); if (length === null) return;
            const count = parseInt(window.prompt('How many pieces? (each label prints "1 of X", "2 of X"…)', String(l.qty || 1))) || 0;
            if (count <= 0) return;
            printRodLabels({ orderRef: packRef(job), itemId: l.erp || '', sidemark: sidemark.trim(), length: String(length).trim(), count });
        } else {
            printStockItemLabels({ itemId: l.erp || '', itemName: l.name || '', uom: 'EA', woNum: packRef(job), copies: Math.max(1, Math.min(50, Number(l.qty) || 1)) });
        }
    };

    // PRODUCTION WINS (Stuart 2026-08-10: "one status in one place"): a pick still Pending while
    // the finishing floor is already painting/baking (or done) has been OVERTAKEN — the queue must
    // say so instead of presenting it as ordinary waiting work. Derived from the SAME canonical
    // status module the chips use, so the two can never disagree.
    // ── LANGUAGE (Stuart 2026-08-20) ────────────────────────────────────────────────────────────
    // Per-device, because the bench tablet and the office desktop are used by different people.
    // Untranslated phrases fall through to English, so this can grow one screen at a time.
    const [lang, setLangState] = useState(readLang);
    const t = useMemo(() => translator(lang), [lang]);
    const setLang = (l) => { setLangState(l); writeLang(l); };

    // ── PENDING QUEUE — WHAT IS COMING, BEFORE IT IS HERS (Stuart 2026-08-20) ──────────────────
    // Sandra: custom orders appear in her pick queue "sin haberlo solicitado". The release is
    // deliberate — starting the fab frees the small parts so picking runs in PARALLEL (§A1) — but
    // from the warehouse end it reads as work arriving unannounced, with no way to see what is
    // behind it. So the pipeline gets its own window: orders dispatched to finishing whose parts
    // have NOT been released yet. Collapsed by default — it is for looking at, not for working —
    // and she can pull one forward herself if she would rather pick ahead.
    const [pendingOpen, setPendingOpen] = useState(false);
    const pendingQueue = useMemo(() => finAll.filter(j =>
        !j.sentToPickPack
        && (j.brand || 'ce') === activeBrand
        && j.currentPhase !== 'Closed' && j.stepStatus !== 'Closed' && j.status !== 'Closed'
        && j.packStatus !== 'Packed'
        // Something to pick, eventually: either real BOM lines or a stock pull the Setup Queue
        // will synthesize. An order with neither is never going to reach her.
        && ((Array.isArray(j.partsList) && j.partsList.length > 0) || j.stockErpId || j.orderType === 'stock')
        // Sorted by the date the customer needs it. `needBy` is the one key (Brief E); the fin doc
        // still carries `reqDate`, written by RTG's split from that header, so both are read until
        // B's split is on the new name.
    ).sort((a, b) => String(a.needBy || a.reqDate || '￿').localeCompare(String(b.needBy || b.reqDate || '￿'))), [finAll, activeBrand]);
    // Why it is still upstream — so the window explains itself rather than just listing ids.
    // ══ RECEIVING (PO) — the vendor dock ═══════════════════════════════════════════════════
    // Find the purchase order, whichever way it was raised. Most POs on this dock were keyed
    // straight into NetSuite and the app has never seen them, so a miss against our own records is
    // not an error — it is the normal case, and we go and read NetSuite. Importing it gives the
    // receipt somewhere to accumulate AND puts the PO on the RTG board, which is the standing rule
    // that every order lands there whichever door it came through.
    const rcvLoadPo = async () => {
        const tran = String(rcvPoInput || '').trim().toUpperCase();
        if (!tran) return;
        setRcvBusy(true);
        try {
            let found = null;
            for (const field of ['poId', 'nsPoTran', 'nsPoId']) {
                const snap = await getDocs(query(collection(db, 'hq_purchase_orders'), where(field, '==', tran)));
                const hit = snap.docs.map(d => ({ id: d.id, ...d.data() })).find(p => !p.deleted && p.status !== 'Deleted');
                if (hit) { found = hit; break; }
            }
            if (!found) {
                const nsPo = await fetchNsPurchaseOrder(tran);
                if (!nsPo) {
                    alert(`No purchase order "${tran}".\n\nChecked this app's records and NetSuite. Check the number — receiving posts against the real PO, so it has to be the right one.`);
                    return;
                }
                found = await importNsPurchaseOrder({ nsPo, brand: activeBrand, createdBy: operator?.name || '' });
                writeLog(`Receiving: ${tran} was raised in NetSuite — imported so the receipt has a record and the PO shows in RTG.`, 'wms');
            }
            setRcvPo(found); setRcvScan(''); setRcvFocusIdx(null); setRcvQty({}); setRcvBin('');
        } catch (e) {
            console.error('Receiving: PO lookup failed', e);
            alert(`Could not read ${tran}:\n\n${e.message || e}\n\nNothing was changed.`);
        } finally { setRcvBusy(false); }
    };

    // Scan to find — exact code first, then a prefix, the same rule the plating station uses.
    const rcvFindIdx = (code, po) => {
        const c = String(code || '').trim().toUpperCase();
        if (!c || !po) return -1;
        const lines = po.items || [];
        const exact = lines.findIndex(l => String(l.itemId || '').toUpperCase() === c && openQtyOf(l) > 0);
        if (exact >= 0) return exact;
        return lines.findIndex(l => String(l.itemId || '').toUpperCase().startsWith(c) && openQtyOf(l) > 0);
    };

    // The cart lives ON the purchase order, not in this component: a dock tablet that reloads
    // mid-receipt must not lose what is already counted onto the trolley.
    const rcvCart = (rcvPo && Array.isArray(rcvPo.receivingCart)) ? rcvPo.receivingCart : [];
    const rcvSaveCart = async (cart) => {
        if (!rcvPo) return;
        await updateDoc(doc(db, 'hq_purchase_orders', rcvPo.id), { receivingCart: cart });
        setRcvPo(p => ({ ...p, receivingCart: cart }));
    };
    const rcvAddToCart = async (idx) => {
        const line = (rcvPo.items || [])[idx];
        if (!line) return;
        const room = openQtyOf(line);
        const asked = rcvQty[idx] != null && rcvQty[idx] !== '' ? parseInt(rcvQty[idx], 10) : room;
        const got = Math.max(0, Math.min(room, parseInt(asked, 10) || 0));
        if (!got) return alert('How many arrived? A receipt of nothing is not a receipt.');
        if (asked > room) alert(`${room} still outstanding on that line — receiving ${got}. The rest of the order stays open.`);
        try {
            const next = [...rcvCart.filter(c => c.index !== idx), { index: idx, itemId: line.itemId, qty: got }];
            await rcvSaveCart(next);
            setRcvQty(q => ({ ...q, [idx]: '' })); setRcvScan(''); setRcvFocusIdx(null);
            writeLog(`Receiving ${poRef(rcvPo)}: ${got} × ${line.itemId} onto the cart.`, 'wms');
        } catch (e) { alert('Could not add it to the cart: ' + (e.message || e)); }
    };
    const rcvRemoveFromCart = async (idx) => {
        try { await rcvSaveCart(rcvCart.filter(c => c.index !== idx)); }
        catch (e) { alert('Could not take it off the cart: ' + (e.message || e)); }
    };

    // PUT AWAY = the whole close for this cart, in order, each step guarded:
    //   1 the bin is real          same validator the pack put-away uses: refuse only on complete
    //                              knowledge, warn otherwise
    //   2 the app record           received accumulates per LINE (never per code — a PO carries the
    //                              same code twice on purpose, once for stock and once for an order)
    //   3 NetSuite                 the item receipt, through the outbox: deterministic id so a
    //                              double-tap cannot post twice, retried, and a real error in 11.1
    //   4 the waiting orders       offerAllocation, before the pieces vanish onto a shelf
    const rcvPutAway = async () => {
        if (!rcvPo || !rcvCart.length) return;
        const bin = String(rcvBin || '').trim().toUpperCase();
        if (!bin) return alert('Scan the home bin — the pieces have to land somewhere.');
        const chk = await platingBinCheck(bin);
        if (!chk.ok) return alert(chk.msg || `"${bin}" is not a bin here.`);
        const pcs = rcvCart.reduce((a, c) => a + (Number(c.qty) || 0), 0);
        if (!window.confirm(`Put away ${rcvCart.length} line(s) / ${pcs} pcs from ${poRef(rcvPo)} into ${bin}?\n\n${rcvCart.map(c => `   ${c.qty} × ${c.itemId}`).join('\n')}\n\nThe receipt posts to NetSuite from the queue, and any order waiting on these pieces is offered them next.`)) return;
        setRcvBusy(true);
        try {
            // 2 — the app's own record first, so what physically arrived is known even if NetSuite argues.
            const res = await recordPoReceipt({
                poId: rcvPo.id, by: operator?.name || '',
                receipts: rcvCart.map(c => ({ index: c.index, qty: c.qty, bin })),
            });
            await rcvSaveCart([]);
            setRcvPo(p => ({ ...(res.po || p), receivingCart: [] }));

            // 3 — NetSuite. Queued, never immediate: nobody waits on a receipt, and the outbox
            // gives it the guards every other write has.
            if (rcvPo.nsPoId) {
                try {
                    await enqueueNsWrite({
                        dedupeKey: `porcv-${String(rcvPo.id)}-${Date.now()}`,
                        kind: 'itemreceipt',
                        label: `Receipt — ${poRef(rcvPo)} (${pcs} pcs → ${bin})`,
                        sourceApp: 'WMS', createdBy: operator?.name || '',
                        targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/purchaseorder/${rcvPo.nsPoId}/!transform/itemreceipt`,
                        method: 'POST',
                        payload: {
                            memo: nsMemo(`PO ${poRef(rcvPo)} received ${pcs} pcs @ ${bin}`),
                            item: { items: res.applied.map(a => {
                                const l = (rcvPo.items || [])[a.index] || {};
                                return {
                                    ...(l.nsItemId ? { item: { id: String(l.nsItemId) } } : {}),
                                    quantity: a.qty,
                                    inventoryDetail: { quantity: a.qty, inventoryAssignment: { items: [{ binNumber: { refName: bin }, quantity: a.qty }] } },
                                };
                            }) },
                        },
                    });
                    writeLog(`Receiving ${poRef(rcvPo)}: item receipt queued — ${pcs} pcs into ${bin}.`, 'wms');
                } catch (nsErr) {
                    alert(`⚠ The pieces are recorded as received in the app, but the NETSUITE receipt could not be queued:\n\n${nsErr.message || nsErr}\n\nNothing is lost — raise it from 11.1, or tell Stuart. Do not receive it a second time.`);
                }
            } else {
                writeLog(`Receiving ${poRef(rcvPo)}: recorded in the app only — this PO has no NetSuite id on file, so no receipt was posted.`, 'wms');
            }

            // 4a — THE ORDERS PARKED ON THIS MATERIAL. An order placed with no stock has been
            // sitting AWAITING RECEIPT since the review raised the PO (Stuart 2026-09-04: "it
            // needs to wait for it to arrive and the order sits parked on wms"). Enough has now
            // arrived to cover some of them: the gate clears and the job goes to the floor. A part
            // delivery keeps the gate closed and says how much is still owed. The WMS never writes
            // work orders itself — clearReceiptGate is A's, called from here.
            const freed = [];
            for (const a of res.applied) {
                try {
                    const r = await clearReceiptGate({ itemId: a.itemId, receivedQty: a.qty, poId: rcvPo.poId || rcvPo.id, operatorName: operator?.name || '' });
                    (r.released || []).forEach(id => freed.push(id));
                    (r.cleared || []).forEach(id => writeLog(`Receiving ${poRef(rcvPo)}: ${a.itemId} covered ${id} — material gate cleared.`, 'wms'));
                    (r.notes || []).forEach(n => writeLog(`Receiving ${poRef(rcvPo)}: ${n}`, 'wms'));
                } catch (e) { console.warn('receipt gate clear failed (the receipt stands):', e); }
            }
            if (freed.length) writeLog(`Receiving ${poRef(rcvPo)}: ${freed.length} order(s) released to finishing — ${freed.join(', ')}.`, 'wms');

            // 4b — THE ORDERS THAT WERE WAITING. Before anything goes on a shelf: an order placed
            // with no stock has been sitting parked here waiting for exactly this delivery
            // (Stuart 2026-09-04). offerAllocation names them, and gathers the pieces into the
            // order's committed bin for the ones the operator takes.
            let taken = 0;
            for (const a of res.applied) {
                try { taken += await offerAllocation(a.itemId, a.qty, { from: `receiving ${poRef(rcvPo)}` }) || 0; }
                catch (e) { console.warn('arrival alert failed (the receipt stands):', e); }
            }
            alert(`✅ ${pcs} pcs received against ${poRef(rcvPo)} into ${bin}.`
                + (freed.length ? `\n\n🏭 ${freed.length} order(s) were waiting on this material and have gone to the finishing floor:\n   ${freed.join('\n   ')}` : '')
                + (taken ? `\n\n${taken} went to orders waiting to ship.` : '')
                + (rcvPo.nsPoId ? '\n\n📤 The NetSuite receipt is queued (11.1 → Sync Queue).' : ''));
            setRcvBin('');
            pullNetSuiteStock();
        } catch (e) {
            console.error('Receiving put-away failed', e);
            alert('❌ Put-away problem:\n\n' + (e.message || e) + '\n\nCheck the PO before receiving again — the app record is written first, so some lines may already be counted.');
        } finally { setRcvBusy(false); }
    };

    const pendingReasonOf = (j) => {
        if (j.awaitingRodCut) return 'poles being cut';
        if (!customPartsReady(j)) return j.customFabStatus === 'Sent to Plating'
            ? 'custom parts at the plater'
            : `shop fab ${String(j.customFabStatus || 'not started').toLowerCase()}`;
        return 'not released by finishing yet';
    };
    const releasePendingNow = async (job) => {
        if (!job) return;
        if (!window.confirm(`▶ Pick ${packRef(job)} now?\n\nIt is still upstream (${pendingReasonOf(job)}), so this is picking AHEAD of the floor asking for it.\n\nIt moves into Awaiting Pick and you can send it back at any time.`)) return;
        try {
            await updateDoc(packDocOf(job), {
                sentToPickPack: true, pickStatus: job.pickStatus || 'Pending',
                sentToPickPackAt: Date.now(), releasedEarlyBy: operator?.name || 'WMS', releasedEarlyAt: Date.now(),
            });
            writeLog(`▶ ${packRef(job)} pulled forward into the pick queue from Pending (${pendingReasonOf(job)}).`, 'wms');
        } catch (e) { alert('Could not release it: ' + (e.message || e)); }
    };

    // ── STOP AN ORDER FROM THE BENCH (Stuart 2026-08-21) ───────────────────────────────────────
    // Scrap found at PACKING is the same event as scrap found at finishing — the order stops. It
    // matters where it happened, so the stage is recorded and the banner says it.
    const holdCtx = { db, doc, getDoc, getDocs, query, collection, where, updateDoc };
    const notifyOps = async (msg) => {
        try { await addDoc(collection(db, 'global_messages'), { sender: 'System', sourceApp: 'WMS', target: 'ALL', isSystem: true, t: serverTimestamp(), msg }); }
        catch (e) { console.warn('OS Comms notify failed:', e); }
    };
    const stopOrderHere = async (job, stage) => {
        if (!job) return;
        const reason = window.prompt(`🛑 STOP ${packRef(job)}?\n\nUse this when the order cannot go on — parts short, damaged, or wrong item. It pins to the top of the warehouse, finishing and RTG, and notifies management now.\n\nWhat is wrong?`, '');
        if (reason === null) return;
        const r = String(reason).trim();
        if (!r) return alert('A reason is needed — it is what the next person acts on.');
        const detail = window.prompt('Which items / how many? (optional)', '') || '';
        try {
            await holdOrder(holdCtx, { order: job, kind: job.orderType === 'sales' ? 'sales' : 'stock', stage, reason: r, detail: detail.trim(), by: operator?.name || 'WMS', notify: notifyOps });
            writeLog(`🛑 STOPPED ${packRef(job)} at ${stage} — ${r}`, 'wms');
            alert(`🛑 ${packRef(job)} is stopped. It pins to the top of every screen showing it, and management has been notified.`);
        } catch (e) { alert('Could not stop the order: ' + (e.message || e)); }
    };
    const resumeOrderHere = async (job) => {
        const note = window.prompt(`▶ Resume ${packRef(job)}?\n\n${job.heldReason ? `Stopped because: ${job.heldReason}\n\n` : ''}What was done to fix it?`, '');
        if (note === null) return;
        const n = String(note).trim();
        if (!n) return alert('Say what was done — a hold lifted silently teaches nobody anything.');
        try {
            await releaseHold(holdCtx, { order: job, kind: job.orderType === 'sales' ? 'sales' : 'stock', note: n, by: operator?.name || 'WMS', notify: notifyOps });
            writeLog(`▶ RESUMED ${packRef(job)} — ${n}`, 'wms');
        } catch (e) { alert('Could not resume: ' + (e.message || e)); }
    };

    // RETURN A PICKED ORDER TO THE QUEUE (Sandra 2026-08-20). Picking was a one-way door: the only
    // exits from Picked_Awaiting_Staging were staging it or closing the order, so anything picked
    // early — which is most of what she is looking at, since the shop START releases the pick — had
    // nowhere to go and the list only grew. This puts it back where it came from, and says on the
    // record that it was returned and by whom, rather than quietly rewinding a step someone did.
    const returnToPickQueue = async (job) => {
        if (!job) return;
        const why = window.prompt(`↩ Send ${packRef(job)} back to Awaiting Pick?\n\nUse this when it was picked early, picked in error, or the parts have gone back on the shelf.\n\nReason (recorded on the order):`, 'picked early — parts returned to shelf');
        if (why === null) return;
        const reason = String(why).trim();
        if (!reason) return alert('A reason is needed — it is what makes the rewind accountable. Nothing was changed.');
        try {
            await updateDoc(packDocOf(job), {
                pickStatus: 'Pending',
                // The pick is being undone, so its results go with it — otherwise the next picker
                // inherits someone else's skips and shorts as if they were their own.
                pickedAt: null, pickedBy: null, pickHadSkips: false, pickSkips: [], pickShorts: [],
                returnedToQueueAt: Date.now(), returnedToQueueBy: operator?.name || 'WMS',
                returnedToQueueReason: reason,
            });
            writeLog(`↩ ${packRef(job)} returned to the pick queue — "${reason}"`, 'wms');
        } catch (e) { alert('Could not return it: ' + (e.message || e)); }
    };

    // A CLOSED ORDER LEAVES THE PICK QUEUE (Sandra 2026-08-17: "esta orden fue reemplazada porque
    // tenía el item incorrecto … ya la orden fue cerrada, así que debería desaparecer de la lista").
    //
    // She is right, and the queue below her was the only list that never checked. Closing from RTG
    // clears sentToPickPack, which drops the job out of `jobs` entirely — but closing from Stock
    // View's Open WOs or the finishing Setup Queue only stamped the PHASE, so the job stayed here
    // for a pick nobody should do. Both of those now clear the pick fields as well; this guard is
    // what heals the ones already sitting in the queue.
    const isOpenPick = (j) => j.pickStatus === 'Pending'
        && j.currentPhase !== 'Closed' && j.stepStatus !== 'Closed' && j.status !== 'Closed';

    // The way out of a pole match that cannot be satisfied, for the order that has no poles. It is a
    // STATEMENT, not a bypass: the reason is required, and it lands on the order and in the log next
    // to the packer's name, so a box that closed without the match can always be accounted for.
    const noPolesOnOrder = async () => {
        const job = packJob;
        if (!job) return;
        const why = window.prompt(`This will let ${packRef(job)} be packed WITHOUT matching poles to it.\n\nUse it only when the order genuinely has no poles — for example the custom half was replaced or removed after the order was split.\n\nWhy does this order have no poles? (recorded against the order)`, '');
        if (why === null) return;
        const reason = String(why).trim();
        if (!reason) return alert('A reason is needed — it is what makes this accountable. Nothing was changed.');
        try {
            await updateDoc(packDocOf(job), {
                packCustomMatchWaived: true,
                packCustomMatchWaivedBy: operator?.name || 'Packer',
                packCustomMatchWaivedAt: Date.now(),
                packCustomMatchWaivedReason: reason,
            });
            writeLog(`Pole match WAIVED on ${packRef(job)} — "${reason}"`, 'packing');
            setPackCustomScan('');
        } catch (e) { alert('Could not record that: ' + (e.message || e)); }
    };

    const isOvertakenPick = (job) => {
        if (job.currentPhase === 'Complete') return true;
        const st = orderStatusOf(job);
        return st.streams.some(s => s.key !== 'CUSTOM' && (['PAINTING', 'OVEN'].includes(s.stage) || s.stage === 'FINISHED'));
    };
    // The deliberate resolution: the floor evidently has (or no longer needs) the parts, so the
    // pick leaves the queue CLEARED — stamped and logged, never silently.
    const clearOvertakenPick = async (job) => {
        if (!window.confirm(`Clear the pick for ${packRef(job)}?\n\nThe finishing floor already has this order in production. Clearing records that the pull was handled outside the pick app — it leaves this queue (logged); nothing else changes.`)) return;
        try {
            await updateDoc(doc(db, 'fin_workorders', job.id), { pickStatus: 'Cleared_Overtaken', sentToPickPack: false, pickClearedAt: Date.now(), pickClearedBy: operator?.name || 'WMS' });
            writeLog(`⚠ Pick CLEARED as overtaken on ${packRef(job)} — order already in production on the finishing floor.`, 'wms');
        } catch (e) { alert('Could not clear the pick: ' + (e.message || e)); }
    };
    const packQueue = [
        ...quickShipOrders.filter(o => o.status === 'Picked' && o.packStatus !== 'Packed'),
        // Custom orders AND stock builds (Stuart 2026-07-20): a finished stock build lands here
        // too — its "packing" is binning the finished goods back to the shelf, and this is the
        // only queue that keeps a completed WO visible after it leaves the finishing floor.
        ...finAll.filter(j => j.currentPhase === 'Complete' && j.packStatus !== 'Packed')
    ].sort((a, b) => (a.packedReadyAt || a.completedAt || a.createdAt || 0) - (b.packedReadyAt || b.completedAt || b.createdAt || 0));
    const packedRecent = [...finAll, ...quickShipOrders].filter(j => j.packStatus === 'Packed').sort((a, b) => (b.packedAt || 0) - (a.packedAt || 0)).slice(0, 6);

    // OPENING A CARD IS LOOKING, NOT TAKING (Stuart 2026-09-03: "we need to be able to open the
    // card without starting the pick just to take a look at what is on there, i just did that and
    // there is no abort pick so i can't stop the process").
    //
    // That was mine. The claim gate shipped earlier tonight made OPENING a card take ownership of
    // it, and the only way back out was tapping the same chip again — invisible unless you already
    // knew. So the two acts are now separate: open = read-only, always allowed, even on an order
    // someone else holds; START PACKING is what claims it; Close leaves and releases what you hold.
    const openPackOrder = async (job) => {
        setPackOrderId(job.id);
        const brandBoxes = stdBoxes.filter(b => !b.brandId || b.brandId === 'global' || b.brandId === activeBrand);
        const small = brandBoxes.find(b => /small/i.test(b.name || ''));
        const large = brandBoxes.find(b => /pole|tube|large/i.test(b.name || ''));
        setPackBoxSel({
            SMALL: (job.packBoxes && job.packBoxes.SMALL) || (small ? small.name : ''),
            POLE: (job.packBoxes && job.packBoxes.POLE) || (large ? large.name : '')
        });
        if (job.orderType === 'stock') {
            const erp = String(job.stockErpId || job.type || '').toUpperCase();
            const part = hqParts.find(p => String(p.legacyErpId || p.itemId || '').toUpperCase() === erp);
            setPutawayBin(String((part && (part.binLocation || part.manufacturingSpecs?.binLocation)) || '').split(',')[0].trim().toUpperCase());
            fetchLiveBins([erp]);
        } else setPutawayBin('');
    };
    // ── ITEM LABELS FROM AN ORDER CARD (Stuart 2026-09-03: "on both of these tabs on the cards
    // we need the ability to print item labels") ────────────────────────────────────────────────
    // One label per piece, for one line or for every line on the order. Same 2x4 stock item label
    // and the same one label route the packing station and the plating dock already print through.
    // Take the order for packing — the claim that opening no longer makes.
    const startPacking = async (job) => {
        let r;
        try { r = await claimOrder(job, 'pack'); } catch (err) { return alert('Could not start packing: ' + (err.message || err)); }
        if (!r.ok) return alert(`${r.claim.by} ${t('is packing this')} — ${t('since')} ${claimSince(r.claim)}.\n\n${t('Pick a different order, or ask them (or an admin) to release it.')}`);
    };
    // Leave the card. Releases the claim only if it is OURS — closing a card you were only looking
    // at must never take the order off the person who holds it.
    const closePackCard = (job) => {
        const c = claimOf(job, 'pack');
        if (c && claimIsMine(c)) releaseClaim(job, 'pack');
        setPackOrderId(null);
    };

    // ══ WHERE IS EVERY PIECE OF THIS ORDER? (Stuart 2026-09-03) ═════════════════════════════════
    // "it should show qty ordered qty on hand, qty in production, qty committed and the status of
    // each, the cards can stay collapsed until all items on the order are committed, then the card
    // glows green and expands as it is ready to be packed."
    //
    // FOUR NUMBERS, FOUR SOURCES, and the distinctions are the whole point:
    //   ORDERED    the line. Compared against NetSuite quantities via `nsQty` when E stamps it —
    //              until then a per-foot rod line reads pieces here and feet there, so the compare
    //              is deliberately NOT made against NetSuite yet.
    //   ON HAND    `available` from Shared/oeReviewPlan.fetchAvailabilityUnits — NetSuite's
    //              quantityavailable, i.e. on hand NET OF COMMITTED, unit-aware. Free stock: what
    //              is on the shelf and promised to nobody. NOT raw on-hand, or an order would be
    //              told it can have pieces another order already owns.
    //   PRODUCTION open work orders and un-received purchase-order quantity STAMPED FOR THIS ORDER
    //              (soAppId) — the app's own claim on inbound stock, which Stuart chose over
    //              NetSuite's allocation ("build it for what the parts were ordered for, it will be
    //              better than netsuites"). The app cannot read NetSuite's per-SO commitment at
    //              all: the only commitment figure anywhere is an item-level aggregate.
    //   COMMITTED pieces physically GATHERED for this order — the committed-bin allocation. Zero
    //              until that flow lands; it is the number that turns a card green.
    //
    // COVERAGE, and why green is not "committed" alone yet: a line is READY when what is gathered
    // plus what is free on the shelf meets the order. Free stock is genuinely available, so an
    // order whose parts are all sitting in stock IS ready to pack. As the committed-bin flow fills
    // `committedQty`, the same test tightens on its own — gathered pieces stop being counted twice
    // because `available` already excludes what NetSuite has committed.
    const [soStats, setSoStats] = useState({}); // orderId → { codes: {CODE: {avail, unit, prod}}, at, error }
    const soStatsRef = useRef(new Set());
    const lineCodeOf = (l) => String((l && (l.erp || l.code)) || '').trim().toUpperCase();
    const loadSoStats = async (orders) => {
        const todo = (orders || []).filter(o => o && o.id && !soStatsRef.current.has(o.id));
        if (!todo.length) return;
        todo.forEach(o => soStatsRef.current.add(o.id));
        const codes = [...new Set(todo.flatMap(o => (o.lines || []).map(lineCodeOf).filter(Boolean)))];
        const loc = BRAND_NETSUITE_MAP[activeBrand]?.location || '17';
        let availMap = {}, availErr = null;
        if (codes.length) {
            try { const r = await fetchAvailabilityUnits(codes, loc); availMap = r.map || {}; }
            catch (e) { availErr = e.message || String(e); }
        }
        const next = {};
        for (const o of todo) {
            const prod = {};
            // Work orders raised FOR THIS SALES ORDER. Order Entry stamps soAppId on the hq doc
            // (Shared/stockRun salesHeader); the finished code is what the line will receive.
            try {
                const ws = await getDocs(query(collection(db, 'hq_work_orders'), where('soAppId', '==', o.id)));
                ws.docs.map(d => ({ id: d.id, ...d.data() }))
                    .filter(w => !w.deleted && !['Closed', 'Deleted', 'CANCELLED'].includes(String(w.status || '')))
                    .filter(w => w.floorPhase !== 'Complete' && !['Completed', 'Built'].includes(String(w.status || '')))
                    .forEach(w => { const c = woItemCodeOf(w); if (c) prod[c] = (prod[c] || 0) + (Number(w.qty ?? w.totalParts) || 0); });
            } catch (e) { /* production is additive detail — the card still shows ordered/on hand */ }
            // Purchase-order lines raised for this sales order: what is ORDERED MINUS RECEIVED is
            // still inbound. Reading `received` per line rather than the header status is the point
            // — a PO for 5 that returned 4 leaves 1 inbound, and a header status cannot say that.
            try {
                const ps = await getDocs(query(collection(db, 'hq_purchase_orders'), where('soAppIds', 'array-contains', o.id)));
                ps.docs.map(d => d.data()).filter(p => !p.deleted).forEach(p => {
                    (p.items || []).filter(it => String(it.soAppId || '') === String(o.id)).forEach(it => {
                        const c = String(it.itemId || '').trim().toUpperCase();
                        const left = Math.max(0, (Number(it.quantity) || 0) - (Number(it.received) || 0));
                        if (c && left > 0) prod[c] = (prod[c] || 0) + left;
                    });
                });
            } catch (e) { /* same — additive */ }
            const codeMap = {};
            (o.lines || []).forEach(l => {
                const c = lineCodeOf(l);
                if (!c || codeMap[c]) return;
                const a = availMap[c] || null;
                codeMap[c] = { avail: a ? Number(a.available) || 0 : null, unit: a ? a.unit : null, prod: prod[c] || 0 };
            });
            next[o.id] = { codes: codeMap, at: Date.now(), error: availErr };
        }
        setSoStats(prev => ({ ...prev, ...next }));
    };
    // One line's four numbers and the word that follows from them.
    const lineStats = (o, l) => {
        const c = lineCodeOf(l);
        const st = (soStats[o.id] && soStats[o.id].codes[c]) || null;
        const ordered = Number(l.qty) || 0;
        const committed = committedQtyOf(o, c);
        const avail = st && st.avail != null ? st.avail : null;
        const prod = st ? st.prod : 0;
        const covered = committed + (avail != null ? Math.max(0, avail) : 0);
        const state = committed >= ordered && ordered > 0 ? 'GATHERED'
            : covered >= ordered && ordered > 0 ? 'READY'
                : (covered + prod) >= ordered && ordered > 0 ? 'IN PRODUCTION'
                    : avail == null ? 'UNKNOWN' : 'SHORT';
        return { code: c, ordered, committed, avail, prod, covered, state };
    };
    // An order is ready when every REAL line is. A to-be-finished line arrives from a floor and is
    // never a shelf pull, so it answers to production, not to stock.
    const orderReady = (o) => {
        const lines = (o.lines || []).filter(l => lineCodeOf(l));
        if (!lines.length) return false;
        if (!soStats[o.id]) return false;
        return lines.every(l => { const st = lineStats(o, l); return st.state === 'GATHERED' || st.state === 'READY'; });
    };

    // ── GATHERING PIECES INTO AN ORDER'S COMMITTED BIN ───────────────────────────────────────
    // The rules live in Shared/committedBins (pure, 34 offline assertions); this is the Firestore
    // half. NOTHING HERE POSTS TO NETSUITE — a committed bin is app-only by Stuart's instruction,
    // and NetSuite goes on believing the stock is in its shelf bin while showing it committed.
    const soOpenFor = (o) => !['Shipped', 'Closed'].includes(String((o && o.status) || ''));
    const commitToOrder = async (order, { code, qty, ordered, bin }) => {
        let want = bin || committedBinOf(order);
        if (!want) {
            // FIRST PART ON THE ORDER PICKS THE BIN, and every later part is TOLD to follow it.
            const typed = window.prompt(`Scan the committed bin for ${packRef(order)}.\n\nAny empty committed bin — it becomes this order's until it ships, and the rest of the order will be sent to the same bin.`, '');
            if (typed === null) return null;
            want = typed;
        }
        const plan = planCommit({ order, code, qty, bin: want, ordered: Number(ordered) || 0, orders: quickShipOrders, isOpen: soOpenFor });
        if (!plan.ok) { alert(`Cannot gather that into ${packRef(order)}:\n\n${plan.reason}`); return null; }
        try {
            await updateDoc(doc(db, 'hq_sales_orders', order.id), {
                committedBin: plan.bin,
                [`committedQty.${plan.code}`]: plan.total,
                committedUpdatedAt: Date.now(), committedUpdatedBy: operator?.name || '',
                ...(plan.wasFirst ? { committedBinAt: Date.now(), committedBinBy: operator?.name || '' } : {}),
            });
            writeLog(`Committed ${plan.qty} × ${plan.code} to ${packRef(order)} in bin ${plan.bin}${plan.wasFirst ? ' (bin assigned)' : ''} — ${plan.total} of ${ordered || '?'} gathered.`, 'wms');
            return plan;
        } catch (e) { alert('Could not record it: ' + (e.message || e)); return null; }
    };
    const releaseFromOrder = async (order, code, ordered) => {
        const have = committedQtyOf(order, code);
        if (have <= 0) return alert('None of this item is gathered for this order.');
        // PARTIAL IS THE NORMAL CASE — plated poles come back short, part ships and part waits.
        const typed = window.prompt(`Release how many ${code} from ${packRef(order)}${committedBinOf(order) ? ` (bin ${committedBinOf(order)})` : ''}?\n\n${have} gathered of ${ordered || '?'} ordered. They stop being reserved for this order.`, String(have));
        if (typed === null) return;
        const plan = planRelease({ order, code, qty: typed });
        if (!plan.ok) return alert(plan.reason);
        const why = window.prompt(`Why? (recorded against the order)`, '');
        if (why === null) return;
        const reason = String(why).trim();
        if (!reason) return alert('A reason is needed — nothing was changed.');
        try {
            await updateDoc(doc(db, 'hq_sales_orders', order.id), {
                [`committedQty.${plan.code}`]: plan.left,
                ...(plan.emptyAfter ? { committedBin: null, committedBinAt: null } : {}),
                committedUpdatedAt: Date.now(), committedUpdatedBy: operator?.name || '',
                committedReleases: arrayUnion({ code: plan.code, qty: plan.qty, at: Date.now(), by: operator?.name || '', reason }),
            });
            writeLog(`Released ${plan.qty} × ${plan.code} from ${packRef(order)}: ${reason}${plan.emptyAfter ? ' — bin now free' : ` (${plan.left} still gathered)`}`, 'wms');
        } catch (e) { alert('Could not release: ' + (e.message || e)); }
    };

    // ── "WHO IS WAITING FOR THESE?" — the arrival alert (Stuart 2026-09-03) ──────────────────
    // "the small parts are ordered in bulk and kept in stock, so when they come back they at this
    // point may not realize there are back orders against them. so what is the tool that alerts
    // the wms operators that hey this just came in and 20 arrived 10 can go to the stock bin but
    // 10 are for SO## and need to go to a sales order commited bin."
    //
    // This is the tool. Given a code and a quantity that just arrived, it asks every OPEN sales
    // order what it is still short of, offers the split oldest-need-first, and — on a yes — gathers
    // each order's share into its committed bin, asking for that bin once per order. Whatever no
    // order is waiting for goes to stock exactly as it does today.
    //
    // It ANSWERS rather than acts: a No leaves everything on the shelf and nothing is written, so
    // an operator who is unsure is never trapped into an allocation.
    const demandsFor = (code) => {
        const c = String(code || '').trim().toUpperCase();
        if (!c) return [];
        return quickShipOrders
            .filter(o => soOpenFor(o) && o.packStatus !== 'Packed')
            .map(o => {
                const line = (o.lines || []).find(l => String(l.erp || '').trim().toUpperCase() === c);
                if (!line) return null;
                return {
                    orderId: o.id, ref: o.soId || o.id,
                    ordered: Number(line.qty) || 0, gathered: committedQtyOf(o, c),
                    needBy: o.needBy || o.needByDate || o.reqDate || '', createdAt: Number(o.createdAt) || 0,
                };
            })
            .filter(Boolean);
    };
    // Returns how many pieces were taken by orders — the caller puts the REST on the shelf.
    const offerAllocation = async (code, qty, { from = '' } = {}) => {
        const c = String(code || '').trim().toUpperCase();
        const plan = planAllocation({ qty, demands: demandsFor(c) });
        if (!plan.allocations.length) return 0;
        const lines = plan.allocations.map(a => {
            const ord = quickShipOrders.find(x => x.id === a.orderId);
            // An order set to finish as available does not sit waiting to be whole — say so here,
            // where the operator is deciding what to do with the pieces in their hands.
            return `   ${a.qty} → ${a.ref}${a.qty < a.outstanding ? ` (still short ${a.outstanding - a.qty})` : ''}${finishAsAvailable(ord) ? '  ⚡ finishes as available' : ''}`;
        }).join('\n');
        if (!window.confirm(`⚠ ${qty} × ${c} just arrived, and open orders are waiting for ${plan.demandTotal}.\n\n${lines}\n${plan.toStock > 0 ? `   ${plan.toStock} → stock\n` : ''}\nSend each order's share to its committed bin? You will be asked for the bin once per order.\n\nNo = put it all away as ordinary stock and leave the orders short.`)) {
            writeLog(`Arrival alert declined: ${qty} × ${c} put to stock while ${plan.demandTotal} were outstanding${from ? ` (${from})` : ''}.`, 'wms');
            return 0;
        }
        let taken = 0;
        for (const a of plan.allocations) {
            const order = quickShipOrders.find(o => o.id === a.orderId);
            if (!order) continue;
            const oline = (order.lines || []).find(l => String(l.erp || '').trim().toUpperCase() === c);
            const done = await commitToOrder(order, { code: c, qty: a.qty, ordered: Number(oline && oline.qty) || 0 });
            if (done) taken += a.qty;   // a refusal or a cancelled bin prompt leaves those pieces for stock
        }
        writeLog(`Arrival alert: ${allocationSummary(plan, c)}${from ? ` (${from})` : ''} — ${taken} gathered into committed bins.`, 'wms');
        return taken;
    };

    // ── "FINISH AS AVAILABLE" — the outlier, never the default (Stuart 2026-09-03) ───────────
    // "a flag on the order, that states 'Finish as available' that would be the outlier, default
    // would be to wait and finish complete when all available."
    //
    // Note the POLARITY, which is deliberate and is the opposite of the first draft: the field
    // names the EXCEPTION, so its ABSENCE is the normal case. Every order written before today has
    // no field at all, and absent has to mean "wait" — which it does this way round, and would not
    // if the flag were named for the default. (Same reasoning as the "Unfinished" item tag.)
    //
    // The WAREHOUSE end only. Setting it does not release anything: RTG owns the release and reads
    // this field. What it changes here is what the screen TELLS the operator to expect — an order
    // whose parts will leave for finishing as they arrive does not sit waiting to be whole.
    const finishAsAvailable = (o) => !!(o && o.finishAsAvailable);
    const toggleFinishAsAvailable = async (o) => {
        const on = finishAsAvailable(o);
        const msg = on
            ? `Turn OFF "Finish as available" for ${packRef(o)}?\n\nBack to the normal way: every part waits, and the order is finished complete once all of them are in.`
            : `Turn ON "Finish as available" for ${packRef(o)}?\n\nThis is the EXCEPTION. Parts will go to finishing as they arrive instead of waiting for the whole order — used when the last parts will be late and finishing early saves time.`;
        if (!window.confirm(msg)) return;
        const why = window.prompt(on ? 'Why is it going back to waiting? (recorded)' : 'Why finish ahead? (recorded — e.g. which parts are late)', '');
        if (why === null) return;
        const reason = String(why).trim();
        if (!reason) return alert('A reason is needed — nothing was changed.');
        try {
            await updateDoc(doc(db, 'hq_sales_orders', o.id), {
                finishAsAvailable: !on, finishAsAvailableAt: Date.now(), finishAsAvailableBy: operator?.name || '',
                finishAsAvailableReason: reason,
            });
            writeLog(`${!on ? 'Finish as available ON' : 'Finish as available OFF'} for ${packRef(o)}: ${reason}`, 'wms');
        } catch (e) { alert('Could not change it: ' + (e.message || e)); }
    };

    const printOrderLineLabels = (job, line) => printStockItemLabels({
        itemId: line.erp || line.code || '', itemName: line.name || '', uom: 'EA',
        woNum: packRef(job), copies: Math.max(1, Math.min(50, Number(line.qty) || 1)),
    });
    const printAllOrderLabels = (job, lines) => {
        const rows = (lines || []).filter(l => (l.erp || l.code));
        if (!rows.length) return alert('No item lines on this order to label.');
        const pcs = rows.reduce((a, l) => a + Math.max(1, Number(l.qty) || 1), 0);
        if (pcs > 50 && !window.confirm(`That is ${pcs} labels across ${rows.length} lines. Print them all?`)) return;
        rows.forEach(l => printOrderLineLabels(job, l));
    };

    // ── CLOSING A STALE ORDER FROM THE WAREHOUSE (Stuart 2026-09-03: "how do we get rid of those
    // old orders there is no mechanism to close in the app") ────────────────────────────────────
    // The closer already existed — Shared/orderLifecycle.closeOrderEverywhere, which closes the hq
    // record and every linked floor doc, clears the pick fields so the job leaves the queue, and
    // records who closed it, from where and why. It was wired to RTG ALONE, and an Order Entry
    // sales order never reaches RTG's board (its status is 'Pending'; the board queries
    // Approved/Dispatched), so exactly the orders that go stale were the ones with no way to close
    // them. Two from 2026-08-14 were still sitting here.
    // This is a CALLER of the one closer, not a second closer. And it says the part the app cannot
    // do: closing here does NOT release NetSuite's commitment — the sales order has to be closed
    // in NetSuite by a person, or the stock stays promised to a dead order.
    const closeStaleOrder = async (job) => {
        const ref = packRef(job);
        const why = window.prompt(`Close ${ref}?\n\nIt leaves the warehouse queues and every linked floor document is closed with it.\n\n⚠ This does NOT close the order in NetSuite — the stock stays COMMITTED there until someone closes the sales order in NetSuite itself.\n\nWhy is it being closed? (recorded against the order)`, '');
        if (why === null) return;
        const reason = String(why).trim();
        if (!reason) return alert('A reason is needed — it is what makes the close accountable. Nothing was changed.');
        try {
            const res = await closeOrderEverywhere(
                { db, doc, getDoc, getDocs, query, collection, where, updateDoc },
                { order: job, kind: 'sales', by: operator?.name || '', from: 'WMS_SO_PACK', reason },
            );
            writeLog(`Closed ${ref} from SO Pack: ${reason}${res && res.finIds && res.finIds.length ? ` · ${res.finIds.length} floor doc(s)` : ''}`, 'wms');
            alert(`✅ ${ref} closed in the app${res && res.finIds && res.finIds.length ? ` (${res.finIds.length} floor document(s) closed with it)` : ''}.\n\n⚠ NOW CLOSE IT IN NETSUITE — until you do, its lines stay committed and that stock cannot be promised to anyone else.`);
        } catch (e) { alert('Could not close it: ' + (e.message || e)); }
    };

    const confirmPackLine = async (job, line) => {
        // Looking is free; changing the order is not. (Stuart 2026-09-03 — the card opens read-only.)
        if (!claimIsMine(claimOf(job, 'pack'))) {
            const c = claimOf(job, 'pack');
            return alert(c ? `${c.by} ${t('is packing this')} — ${t('since')} ${claimSince(c)}.` : `Press START PACKING first — this order is not yours yet, and marking pieces packed on someone else's order is how a box goes out wrong.`);
        }
        try { await updateDoc(packDocOf(job), { [`packedLines.${line.key}`]: { at: Date.now(), by: operator?.name || 'Packer' } }); }
        catch (e) { alert('Could not mark packed: ' + (e.message || e)); }
    };
    const unpackLine = async (job, line) => {
        if (!window.confirm(`Move "${line.name}" back to TO PACK?`)) return;
        try { await updateDoc(packDocOf(job), { [`packedLines.${line.key}`]: deleteField() }); }
        catch (e) { alert(e.message || e); }
    };
    const uploadPackPhotos = async (job, files) => {
        const list = Array.from(files || []);
        if (!list.length) return;
        setPackUploading(true);
        try {
            for (let i = 0; i < list.length; i++) {
                let blob = list[i];
                try { blob = await downscalePackImage(list[i]); } catch (e) { /* undecodable — upload raw */ }
                const fRef = ref(storage, `packing_photos/${job.id}/${Date.now()}_${i}.jpg`);
                await uploadBytesResumable(fRef, blob);
                const url = await getDownloadURL(fRef);
                await updateDoc(packDocOf(job), { packPhotos: arrayUnion(url) });
            }
        } catch (e) { alert('Photo upload failed: ' + (e.message || e)); }
        finally { setPackUploading(false); }
    };
    // ⚠ PACKING SCRAP OUTLET (Stuart 2026-07-20): bad pieces found while bagging — same QC
    // semantics as the finishing floor's final gate, for orders that already passed it. Stock
    // builds: scrap counts recorded AND a −qty finished-goods adjustment queues to NetSuite
    // (the QC good-count already posted at completion). Customs: redline alert to the finishing
    // supervisor — a custom order can't quietly ship short. Fin-sourced orders only (not QS).
    const reportPackScrap = async (job) => {
        if (isQsOrder(job)) return;
        const n = parseInt(window.prompt(`How many pieces are BAD (scrap) on ${packRef(job)}?`, '1')) || 0;
        if (n <= 0) return;
        const note = window.prompt('What happened? (short reason for the log)', 'Damage found at packing') || 'Damage found at packing';
        const isStock = job.orderType === 'stock';
        try {
            const patch = {
                scrapReported: (Number(job.scrapReported) || 0) + n,
                packScrap: (Number(job.packScrap) || 0) + n,
                packScrapNote: note, packScrapAt: Date.now(), packScrapBy: operator?.name || ''
            };
            if (isStock) patch.completedParts = Math.max(0, (Number(job.completedParts) || Number(job.totalParts) || 0) - n);
            else patch.redlineAlert = `${operator?.name || 'Packer'} found ${n} bad piece(s) at PACKING on ${packRef(job)} — ${note}. Short-ship blocked until resolved.`;
            await updateDoc(packDocOf(job), patch);
            writeLog(`⚠ PACKING SCRAP: ${n} pc(s) on ${packRef(job)} (${job.stockErpId || job.type || ''}) — ${note}`, 'alert');
            if (isStock) {
                const erp = String(job.stockErpId || job.type || '').toUpperCase();
                const part = hqParts.find(p => String(p.legacyErpId || p.itemId || '').toUpperCase() === erp);
                const nsCfg = BRAND_NETSUITE_MAP[activeBrand] || { subsidiary: '2', location: '17' };
                const bin = part ? String(part.binLocation || part.manufacturingSpecs?.binLocation || '').toUpperCase() : '';
                if (part?.netSuiteInternalId) {
                    await enqueueNsWrite({
                        kind: 'inventoryadjustment',
                        label: `Pack scrap −${n} × ${erp} (${packRef(job)})`,
                        sourceApp: 'WMS', createdBy: operator?.name || '',
                        targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/inventoryadjustment',
                        method: 'POST',
                        payload: {
                            account: { id: "254" }, subsidiary: { id: nsCfg.subsidiary },
                            memo: nsMemo(`Packing scrap ${packRef(job)}: ${note}`),
                            inventory: { items: [{ item: { id: String(part.netSuiteInternalId) }, location: { id: nsCfg.location }, adjustQtyBy: -n, ...((bin && bin !== 'UNASSIGNED') ? { inventoryDetail: { quantity: -n, inventoryAssignment: { items: [{ binNumber: { refName: bin }, quantity: -n }] } } } : {}) }] }
                        },
                        writeBack: { collection: 'fin_workorders', docId: job.id, patch: { packScrapAdjPosted: true }, idField: 'packScrapAdjId', tranField: 'packScrapAdjTran' }
                    });
                    alert(`⚠ ${n} scrap recorded on ${packRef(job)}.\n\n− ${n} × ${erp} finished-goods adjustment queued to NetSuite (11.1 / transmit log).\n\nRe-make: Finishing → Setup Queue → ⟲ Scrap Re-make.`);
                } else {
                    alert(`⚠ ${n} scrap recorded on ${packRef(job)} — no NetSuite id on ${erp || 'the item'}, adjust finished goods manually.\n\nRe-make: Finishing → Setup Queue → ⟲ Scrap Re-make.`);
                }
            } else {
                alert(`⚠ ${n} bad piece(s) recorded — the finishing supervisor has been red-flagged (custom orders can't ship short).`);
            }
        } catch (e) { alert('Scrap report failed: ' + (e.message || e)); }
    };
    const packCompletingRef = useRef(false); // STOP MECHANISM: double-tap must not complete/queue twice
    // ===== 📥 OB PLATING — custom outgoing staging (Stuart 2026-07-21) =====
    // Custom-fabricated pieces ordered in /MEP, /EP or /P25 finishes arrive here at random times
    // as the shop completes them. Scanning one into the OB PLATING bin stages it as a normal
    // plating_shipments line (status 'staged', bin OB PLATING) — so the existing weekly
    // 📦 Ship button bundles customs + stock pulls into ONE plater PO + packing list. No NetSuite
    // bin transfer here: custom fab isn't stocked inventory, the pole just physically moves.
    const [obScan, setObScan] = useState('');
    const stageObDemand = async (d) => {
        if (!window.confirm(`📥 Scan ${d.woNum || d.targetErpId} into OB PLATING?\n\n${d.qty} pc(s) · ${d.baseErpId} → ${d.targetErpId} · finish ${d.finishCode}\n\nIt joins the staged plating lines and rides the next weekly shipment/PO.`)) return;
        try {
            const fin = outsourceFinishes.find(f => finishCodeOf(f) === String(d.finishCode || '').toUpperCase());
            const vendorCrmId = (fin && fin.vendorCrmId) || '';
            const nsVendorId = /^VEND-(\d+)$/.test(vendorCrmId) ? vendorCrmId.replace('VEND-', '') : '';
            await addDoc(collection(db, 'plating_shipments'), {
                brandId: activeBrand, status: 'staged', custom: true,
                itemId: null, netSuiteInternalId: null, erpId: d.baseErpId || 'CUSTOM',
                itemName: `CUSTOM ${d.finishName || d.finishCode || ''}${d.note ? ` — ${d.note}` : ''}`.trim(),
                finishCode: d.finishCode || '', finishName: d.finishName || '', targetErpId: d.targetErpId || '',
                vendorCrmId, nsVendorId, vendorName: (fin && fin.vendor) || '',
                qty: Number(d.qty) || 1, fromBin: 'CUSTOM FAB', platingBin: 'OB PLATING', woNum: d.woNum || '',
                operator: operator?.name || 'Unknown', createdAt: serverTimestamp()
            });
            printPlatingLabel({ erpId: d.baseErpId || 'CUSTOM', itemName: d.finishName || 'Custom plated part', qty: Number(d.qty) || 1, woNum: d.woNum || '', platingBin: 'OB PLATING', finishCode: d.finishCode || '', finishName: d.finishName || '', targetErpId: d.targetErpId || '' });
            await deleteDoc(doc(db, 'plating_demand', d.id)).catch(() => {});
            writeLog(`OB Plating scan-in: ${d.qty} × ${d.baseErpId} (${d.finishCode}) WO ${d.woNum} → OB PLATING`, 'wms');
            alert(`✅ ${d.woNum || d.baseErpId} staged in OB PLATING — it rides the next weekly plating shipment/PO.`);
        } catch (e) { alert('OB scan-in failed: ' + (e.message || e)); }
    };
    const obScanSubmit = () => {
        const s = obScan.trim().toUpperCase();
        if (!s) return;
        const hit = platingDemands.find(d => d.custom && (String(d.woNum || '').toUpperCase() === s || String(d.woNum || '').toUpperCase().includes(s) || String(d.id).toUpperCase() === s));
        setObScan('');
        if (!hit) return alert(`No custom outgoing piece matches "${s}" — check the WO # on the shop label.`);
        stageObDemand(hit);
    };
    // ===== END OB PLATING =====

    // ── A BIN IS A REAL PLACE, NOT WHATEVER WAS TYPED (Eric 2026-08-24) ────────────────────────
    // "WO-JFP-HSMCB1-04-983046 failed to create inventory adjustment due to the item BIN number
    //  being input wrong … Invalid binnumber reference key E3L- N5- R2 … is missing M and has
    //  improper spaces. Bin should have been M E3L-N5-R2."
    //
    // The bin goes to NetSuite as a binNumber refName, so a typo takes the whole adjustment down
    // and the app reads PUT AWAY while NetSuite received nothing. Checking BEFORE posting turns a
    // failed transaction into a corrected keystroke.
    //
    // Note on what this deliberately does NOT do: the app has ensureBinExists, which CREATES a bin
    // when it is missing. Using it here would have quietly created a bin literally called
    // "E3L- N5- R2" in NetSuite. A mistyped bin must be rejected, never manufactured.
    //
    // ONE PAGE OF BINS IS NOT THE BIN LIST (Andrea 2026-08-25: "trying to build rings on RTS-CUS
    // location and shows the same error as the other item"). SuiteQL returns 1000 rows per page,
    // and this query asked for one page and treated it as the whole warehouse — so every bin past
    // the thousandth read as "does not exist" and the app refused a bin the packer was holding in
    // her hand. The message even offers RTS-CUS as an EXAMPLE of a valid bin further down this
    // file. Keyset-paginated now, the same way the item metadata sync has always done it.
    //
    // And the rule that follows from being wrong about this: A VALIDATOR MAY ONLY REFUSE ON
    // COMPLETE KNOWLEDGE. If the list is short, unreachable, or truncated, the check drops to a
    // warning the person can pass — which still puts Eric's typo in front of him, without telling
    // someone correct that they are wrong. Refusing on partial data is worse than not checking:
    // the operator knows the bin is real, so the app just looks broken and gets worked around.
    const [binIndex, setBinIndex] = useState({ loc: null, list: [], complete: false, loaded: false });
    const loadBinIndex = async () => {
        const loc = (BRAND_NETSUITE_MAP[activeBrand] || {}).location;
        if (!loc) return { list: [], complete: false };
        if (binIndex.loaded && binIndex.loc === loc) return { list: binIndex.list, complete: binIndex.complete };
        const PAGE = 1000, MAX_PAGES = 40;   // 40k bins is far past any real warehouse
        let list = [], lastId = 0, complete = false;
        try {
            for (let page = 0; page < MAX_PAGES; page++) {
                const r = await nsProxyFetch({
                    targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql',
                    method: 'POST',
                    payload: { q: `SELECT bin.id, bin.binnumber FROM bin WHERE bin.location = ${loc} AND bin.id > ${lastId} ORDER BY bin.id ASC` },
                });
                const body = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(JSON.stringify(body).slice(0, 200));
                const rows = body.items || [];
                list = list.concat(rows.map(x => String(x.binnumber || '').toUpperCase()).filter(Boolean));
                if (rows.length < PAGE) { complete = true; break; }
                lastId = rows[rows.length - 1].id;
            }
            setBinIndex({ loc, list, complete, loaded: true });
            return { list, complete };
        } catch (e) {
            // Unreachable NetSuite must not block a put-away — warn instead of inventing certainty.
            console.warn('Bin list unavailable:', e);
            setBinIndex({ loc, list, complete: false, loaded: true });
            return { list, complete: false };
        }
    };
    // WHERE DOES THIS BIN ACTUALLY LIVE? Asked only when a bin fails the check, because "not at
    // this location" is a dead end and "it is a bin at M2C Studio" is an answer. Andrea called
    // RTS-CUS a location in her own words, so which it is — and where — is the thing worth saying.
    const lookupBinAnywhere = async (bin) => {
        try {
            const r = await nsProxyFetch({
                targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql',
                method: 'POST',
                payload: { q: `SELECT bin.binnumber, BUILTIN.DF(bin.location) AS locname FROM bin WHERE UPPER(bin.binnumber) = '${String(bin).toUpperCase().replace(/'/g, "''")}'` },
            });
            const body = await r.json().catch(() => ({}));
            return (body.items || []).map(x => String(x.locname || '').trim()).filter(Boolean);
        } catch { return []; }
    };
    // "E3L- N5- R2" and "m e3l-n5-r2" are the same keystrokes as "M E3L-N5-R2" once the scanner's
    // stray spaces are taken out. Squeeze, don't guess: spaces AROUND hyphens go, the zone space stays.
    const normalizeBin = (v) => String(v || '').toUpperCase().trim()
        .replace(/\s*-\s*/g, '-')
        .replace(/\s+/g, ' ');
    // Closest known bins, so the message says what they probably meant.
    const nearestBins = (want, list) => {
        const w = normalizeBin(want).replace(/[^A-Z0-9]/g, '');
        if (!w) return [];
        return list
            .map(b => ({ b, k: b.replace(/[^A-Z0-9]/g, '') }))
            .filter(x => x.k.includes(w) || w.includes(x.k))
            .map(x => x.b).slice(0, 6);
    };

    // ── REDO A PUT-AWAY THAT NETSUITE REFUSED (Eric 2026-08-24: "possible to move back to pack to
    // correct?") ──────────────────────────────────────────────────────────────────────────────
    // His adjustment failed on a mistyped bin, and the order was already Packed — so the pieces
    // were physically away but NetSuite never received them, with no way back to fix it. This
    // re-queues the SAME adjustment against a corrected bin, without re-opening the pack.
    const redoPutaway = async (job) => {
        if (!job) return;
        if (job.jfpAdjPosted) return alert(`${packRef(job)} already posted its NetSuite adjustment${job.jfpAdjTran ? ` (${job.jfpAdjTran})` : ''}.\n\nNothing to redo — re-posting would double the stock.`);
        const { list: known, complete: binsComplete } = await loadBinIndex();
        const entered = window.prompt(`↩ Re-post the put-away for ${packRef(job)}?\n\nThe last attempt used "${job.jfpAdjBin || job.putawayBin || '—'}" and NetSuite rejected it, so the pieces are physically away but NOT on the books.\n\nCorrect bin:`, job.putawayBin || '');
        if (entered === null) return;
        const bin = normalizeBin(entered);
        if (!bin) return alert('A bin is needed.');
        if (known.length && !known.includes(bin)) {
            const near = nearestBins(bin, known);
            const elsewhere = await lookupBinAnywhere(bin);
            const where = elsewhere.length ? `\n\nNetSuite has a bin by that name at: ${elsewhere.join(', ')} — not at this brand's location.` : '';
            const msg = `"${entered.trim()}" is not a bin at this location.${where}\n\n${near.length ? `Did you mean:\n${near.map(b => `   ${b}`).join('\n')}` : 'Scan the bin label rather than typing it.'}`;
            // Complete list → refuse. Incomplete → say so and let the person decide; they can see
            // the bin and the app cannot see all of them.
            if (binsComplete && !elsewhere.length) return alert(`${msg}\n\nNothing was posted.`);
            if (!window.confirm(`${msg}\n\n(The bin list here may be incomplete, so this is a warning, not a refusal.)\n\nPost to "${bin}" anyway?`)) return;
        }
        const qty = Number(job.jfpAdjQty) || Number(job.completedParts) || Number(job.totalParts) || 0;
        if (!job.jfpItemId) return alert(`${packRef(job)} has no NetSuite item id recorded, so nothing can be adjusted automatically. Adjust ${job.jfpItemCode || 'the item'} into ${bin} by hand in NetSuite.`);
        const nsCfg = BRAND_NETSUITE_MAP[activeBrand] || { subsidiary: '2', location: '17' };
        try {
            await enqueueNsWrite({
                kind: 'inventoryadjustment',
                label: `JFP RETRY +${qty} × ${job.jfpItemCode || ''} → ${bin} (${packRef(job)})`,
                sourceApp: 'WMS', createdBy: operator?.name || '',
                targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/inventoryadjustment',
                method: 'POST',
                payload: paintOnlyAdjustment({
                    itemId: job.jfpItemId, qty, bin,
                    subsidiary: nsCfg.subsidiary, location: nsCfg.location,
                    ref: packRef(job), itemCode: job.jfpItemCode, by: operator?.name || '',
                }),
                writeBack: { collection: 'fin_workorders', docId: job.id, patch: { jfpAdjPosted: true }, idField: 'jfpAdjId', tranField: 'jfpAdjTran' },
            });
            await updateDoc(packDocOf(job), { putawayBin: bin, jfpAdjBin: bin, jfpAdjQueued: true, jfpAdjRetriedAt: Date.now(), jfpAdjRetriedBy: operator?.name || '' });
            writeLog(`↩ JFP put-away re-posted for ${packRef(job)} → ${bin} (was "${job.jfpAdjBin || job.putawayBin || '—'}")`, 'wms');
            alert(`↩ Re-queued: +${qty} × ${job.jfpItemCode} into ${bin}.\n\nWatch it land in HQ 11.1 → NetSuite Sync Queue.`);
        } catch (e) { alert('Could not re-queue: ' + (e.message || e)); }
    };

    const completePacking = async (job) => {
        if (packCompletingRef.current) return;
        if (job.packStatus === 'Packed') return alert('This order is already packed.');
        const lines = packLinesOf(job);
        const left = lines.filter(l => !(job.packedLines && job.packedLines[l.key]));
        if (left.length) return alert(`Every piece must be physically packed and confirmed first — ${left.length} line${left.length === 1 ? '' : 's'} still on the TO PACK side.`);
        // The order must be YOURS to complete. (The card opens read-only — Stuart 2026-09-03.)
        if (!claimIsMine(claimOf(job, 'pack'))) {
            const c = claimOf(job, 'pack');
            return alert(c ? `${c.by} ${t('is packing this')} — ${t('since')} ${claimSince(c)}. Ask them, or have an admin release it.` : 'Press START PACKING first — this order is not yours yet.');
        }
        const isStockPutaway = job.orderType === 'stock';
        if (!(job.packPhotos || []).length && !isStockPutaway) return alert('A photo of the packaged parts is required — tap 📷 Add Photo first.');
        const bin = normalizeBin(putawayBin);
        if (isStockPutaway) {
            if (!bin) return alert('Scan/enter the put-away bin — stocked goods go straight to the shelf.');
            // THAT IS THE ITEM LABEL, NOT A BIN (Stuart 2026-08-18). WO-JFP-HTFMRLG-04 was put away
            // to "HTFMRLG/04" — its own item code — because the packer scanned the item label. The
            // bin is posted to NetSuite as a binNumber refName, so a bin that does not exist takes
            // the whole inventory adjustment down with it: the app says PUT AWAY and NetSuite never
            // receives the pieces. A finish suffix is the tell — no bin here is named "CODE/FIN".
            // IS IT A REAL BIN? (Eric 2026-08-24) Checked before posting, because NetSuite's answer
            // to a bad bin is a failed adjustment nobody sees until the stock does not add up.
            const { list: known, complete: binsComplete } = await loadBinIndex();
            if (known.length && !known.includes(bin)) {
                const near = nearestBins(bin, known);
                const elsewhere = await lookupBinAnywhere(bin);
                const read = bin !== putawayBin.trim().toUpperCase() ? `\n\n(Read as "${bin}" after tidying the spacing.)` : '';
                const where = elsewhere.length ? `\n\nNetSuite has a bin by that name at: ${elsewhere.join(', ')} — not at this brand's location.` : '';
                const msg = `"${putawayBin.trim()}" is not a bin at this location.${read}${where}\n\n${near.length ? `Did you mean:\n${near.map(b => `   ${b}`).join('\n')}` : 'Scan the bin label rather than typing it.'}`;
                if (binsComplete && !elsewhere.length) return alert(`${msg}\n\nNothing was posted — NetSuite rejects an unknown bin and the adjustment would have been lost.`);
                if (!window.confirm(`${msg}\n\n(The bin list here may be incomplete, so this is a warning, not a refusal.)\n\nPut away to "${bin}" anyway?`)) return;
            }
            const itemCodes = [job.jfpItemCode, job.stockErpId, job.type].map(v => String(v || '').trim().toUpperCase()).filter(Boolean);
            if (itemCodes.includes(bin) || (bin.includes('/') && !/^[A-Z]{2,}-/.test(bin))) {
                return alert(`"${bin}" looks like the ITEM code, not a bin.\n\nScan the BIN label (e.g. RTS-CUS, BB 2-2) — the bin is posted to NetSuite, and one that doesn't exist makes the whole inventory adjustment fail, leaving the pieces un-received there while this screen says they were put away.`);
            }
            const lv = liveBins[String(job.stockErpId || job.type || '').toUpperCase()];
            if (lv && lv.bins.length && !lv.bins.some(x => x.bin === bin) && !window.confirm(`Bin ${bin} isn't where NetSuite holds this item today (${lv.bins.slice(0, 3).map(x => x.bin).join(', ')}).\n\nPut away to ${bin} anyway? (Recorded as the physical location — no NetSuite move.)`)) return;
        }
        const confirmMsg = isStockPutaway
            ? `Put away ${packRef(job)} to bin ${bin}?\n\n${lines.length} line${lines.length === 1 ? '' : 's'} confirmed · stocked goods to the shelf (no customer packing).`
            : `Complete packing for ${packRef(job)}?\n\n${lines.length} line${lines.length === 1 ? '' : 's'} packed · ${(job.packPhotos || []).length} photo${(job.packPhotos || []).length === 1 ? '' : 's'}\nSmall parts box: ${packBoxSel.SMALL || '—'}\nPole box: ${packBoxSel.POLE || '—'}`;
        // BOTH HALVES OR NEITHER. Staging matched poles to small parts on the way IN to finishing;
        // nothing re-checked them at the box, so one order's parts could ship with another's poles
        // and every screen would still read correct (Stuart 2026-08-03, WO-SO59176).
        const custMatch = normalizeKey(packCustomScan);
        if (job.hasCustomSibling && !job.packCustomMatchedAt && !job.packCustomMatchWaived) {
            if (!stagingScanMatches(job, custMatch)) {
                return alert(`Scan the CUSTOM SHOP label on the poles first.\n\nThe poles for ${packRef(job)} came off the shop order — they are not on the parts list you just packed, so nothing here proves the right ones are in the box.\n\nIf this order genuinely has no poles, use "This order has no poles" above and say why — it is recorded against the order.`);
            }
        }
        if (!window.confirm(confirmMsg)) return;
        packCompletingRef.current = true;
        try {
            await updateDoc(packDocOf(job), { packStatus: 'Packed', packedAt: Date.now(), packedBy: operator?.name || 'Packer', packInProgress: null,
                ...(job.hasCustomSibling && !job.packCustomMatchedAt ? { packCustomMatchedAt: Date.now(), packCustomMatchedBy: operator?.name || '', packCustomMatchedScan: custMatch } : {}),
                ...(isStockPutaway ? { putawayBin: bin, packMode: 'PUTAWAY' } : { packBoxes: packBoxSel }) });
            setPackCustomScan('');
            // The board hears about packing/put-away like every other floor event (2026-08-29
            // audit: WMS events never reported). Best-effort — the pack stands regardless.
            try {
                await propagateFloorState({ db, doc, getDoc, getDocs, query, collection, where, updateDoc },
                    { finWo: job, phase: isStockPutaway ? 'Shelved' : 'Packed', by: operator?.name || '' });
            } catch (e) { console.warn('RTG propagate failed (pack stands):', e); }
            writeLog(isStockPutaway ? `Put away ${packRef(job)} → bin ${bin} (${lines.length} lines)` : `Packed ${packRef(job)} (${lines.length} lines, ${(job.packPhotos || []).length} photos)`, 'packing');
            // PACKED → NETSUITE (Stuart 2026-07-18): transform the NetSuite SO into an Item
            // Fulfillment at status Packed (staged via the outbox — serial, retried, visible in
            // the RTG transmit log + 11.1). Shipping then executes/ships it IN NetSuite; the
            // ⤓ Tracking pull below brings the tracking # back onto the sales order.
            let nsNote = '';
            if (isStockPutaway) {
                // Stock put-away: THIS is what posts the NetSuite assembly build (onStockBuildDone
                // fires on packStatus Packed, receiving into the bin scanned here — it used to fire
                // at bake complete, which put stock on the books before it reached a shelf and
                // guessed the bin). No sales order, no fulfillment: shelf and done.
                // JUST FOR PAINT closes out differently (Stuart 2026-08-03): there is no assembly
                // and no NetSuite work order to complete, so instead of a build we post a plain
                // inventory adjustment of the painted pieces into the bin just scanned. The
                // onStockBuildDone trigger ignores these on its own — it requires an nsWoId.
                if (isPaintOnlyOrder(job)) {
                    const nsCfg = BRAND_NETSUITE_MAP[activeBrand] || { subsidiary: '2', location: '17' };
                    const doneQty = Number(job.completedParts) > 0 ? Number(job.completedParts) : (Number(job.totalParts) || 0);
                    setPackOrderId(null);
                    if (!job.jfpItemId) {
                        alert(`📦 ${packRef(job)} put away → bin ${bin}.\n\n⚠ This paint run has no NetSuite item id recorded, so NOTHING was adjusted. Adjust ${job.jfpItemCode || 'the item'} into ${bin} manually in NetSuite.`);
                        return;
                    }
                    try {
                        await enqueueNsWrite({
                            kind: 'inventoryadjustment',
                            label: `JFP +${doneQty} × ${job.jfpItemCode || ''} → ${bin} (${packRef(job)})`,
                            sourceApp: 'WMS', createdBy: operator?.name || '',
                            targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/inventoryadjustment',
                            method: 'POST',
                            payload: paintOnlyAdjustment({
                                itemId: job.jfpItemId, qty: doneQty, bin,
                                subsidiary: nsCfg.subsidiary, location: nsCfg.location,
                                ref: packRef(job), itemCode: job.jfpItemCode, by: operator?.name || '',
                            }),
                            writeBack: { collection: 'fin_workorders', docId: job.id, patch: { jfpAdjPosted: true }, idField: 'jfpAdjId', tranField: 'jfpAdjTran' },
                        });
                        await updateDoc(packDocOf(job), { jfpAdjQueued: true, jfpAdjQty: doneQty, jfpAdjBin: bin });
                        alert(`📦 ${packRef(job)} — ${PAINT_ONLY_BADGE}.\n\n+${doneQty} × ${job.jfpItemCode} queued as a NetSuite inventory adjustment into ${bin}. Watch it land in 11.1 → NetSuite Sync Queue (~1 min).`);
                    } catch (obErr) {
                        alert(`📦 ${packRef(job)} put away → bin ${bin}.\n\n⚠ The NetSuite adjustment could NOT be queued: ${obErr.message || obErr}\n\nThe put-away stands — retry from 11.1 or adjust ${job.jfpItemCode} manually.`);
                    }
                    return;
                }
                // PACKAGING PREP IS THE HANDLER TO SO PACK FOR PAINTED/STAINED ITEMS (Stuart
                // 2026-09-03). A finished stock run reaching the shelf is precisely the moment the
                // backorders against it are invisible — so ask BEFORE it disappears into stock.
                // The NetSuite build is unaffected either way: it receives into the SCANNED bin,
                // because a committed bin is app-only and NetSuite must go on seeing the shelf.
                let allocNote = '';
                try {
                    const allocCode = woItemCodeOf(job);
                    const doneQty = Number(job.completedParts) > 0 ? Number(job.completedParts) : (Number(job.totalParts) || 0);
                    const taken = allocCode && doneQty > 0 ? await offerAllocation(allocCode, doneQty, { from: `put-away ${packRef(job)}` }) : 0;
                    if (taken > 0) allocNote = `\n\n📦 ${taken} of them are now gathered for open orders — see SO Pack. The rest stay in ${bin}.`;
                } catch (e) { console.warn('arrival alert failed (the put-away stands):', e); }
                setPackOrderId(null);
                alert(`📦 ${packRef(job)} put away → bin ${bin}.\n\nThe NetSuite assembly build is queued now and receives into ${bin} — watch it land in 11.1 → NetSuite Sync Queue (~1 min).${allocNote}`);
                return;
            }
            try {
                const soDoc = isQsOrder(job) ? job : (soIndex[String(job.salesOrderId || '')] || null);
                const nsSoId = String((isQsOrder(job) ? (job.nsInternalId || job.soId) : (soDoc && soDoc.nsInternalId)) || '');
                if (nsSoId && !job.nsFulfillQueued) {
                    const writeBack = [{ collection: isQsOrder(job) ? 'hq_sales_orders' : 'fin_workorders', docId: job.id, patch: {}, idField: 'nsIfId', tranField: 'nsIfTran' }];
                    if (!isQsOrder(job) && soDoc && soDoc.id) writeBack.push({ collection: 'hq_sales_orders', docId: soDoc.id, patch: {}, idField: 'nsIfId', tranField: 'nsIfTran' });
                    await enqueueNsWrite({
                        kind: 'itemfulfillment',
                        label: `NS Fulfillment — ${packRef(job)} (${job.customerName || job.clientName || job.customer || ''})`,
                        sourceApp: 'WMS', createdBy: operator?.name || '',
                        targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/salesOrder/${nsSoId}/!transform/itemFulfillment`,
                        method: 'POST',
                        payload: { shipStatus: { id: 'B' }, memo: nsMemo(`Packed in app by ${operator?.name || 'Packer'}`) },
                        writeBack
                    });
                    await updateDoc(packDocOf(job), { nsFulfillQueued: true });
                    nsNote = '\n\n📤 NetSuite Item Fulfillment queued (status: Packed). Shipping completes it in NetSuite — then hit ⤓ Tracking here to pull the tracking # back onto the sales order.';
                } else if (!nsSoId) {
                    nsNote = '\n\n⚠ No NetSuite sales order linked to this order — fulfillment NOT queued. Fulfill it manually in NetSuite.';
                }
            } catch (obErr) { nsNote = `\n\n⚠ Could not queue the NetSuite fulfillment: ${obErr.message || obErr}. Packing stands — retry from 11.1 or fulfill manually.`; }
            setPackOrderId(null);
            alert(`📦 ${packRef(job)} packed.${nsNote}`);
        } catch (e) { alert('Could not complete packing: ' + (e.message || e)); }
        finally { packCompletingRef.current = false; }
    };
    // FULFILLED → BACK INTO THE APP: pull the SO's Item Fulfillment(s) from NetSuite and stamp
    // status + tracking #(s) onto the sales order (and the fin doc for custom orders).
    const pullFulfillment = async (job) => {
        const soDoc = isQsOrder(job) ? job : (soIndex[String(job.salesOrderId || '')] || null);
        const nsSoId = String((isQsOrder(job) ? (job.nsInternalId || job.soId) : (soDoc && soDoc.nsInternalId)) || '');
        if (!nsSoId) return alert('No NetSuite sales order linked to this order.');
        try {
            const rq = await nsProxyFetch({ targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql', method: 'POST', payload: { q: `SELECT t.id, t.tranid, BUILTIN.DF(t.status) AS status FROM transaction t WHERE t.type = 'ItemShip' AND t.createdfrom = ${nsSoId} ORDER BY t.id DESC` } });
            const jq = await rq.json();
            if (!rq.ok) throw new Error(JSON.stringify(jq).slice(0, 300));
            const ifs = jq.items || [];
            if (!ifs.length) return alert('No Item Fulfillment in NetSuite for this SO yet.\n\nIf packing just completed, the queued transform may still be draining (~1/min — RTG transmit log / 11.1). Otherwise shipping hasn\'t started it.');
            let tracks = [];
            try {
                const rt = await nsProxyFetch({ targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql', method: 'POST', payload: { q: `SELECT DISTINCT tn.trackingnumber FROM trackingnumbermap tnm JOIN trackingnumber tn ON tn.id = tnm.trackingnumber WHERE tnm.transaction IN (${ifs.map(x => x.id).join(',')})` } });
                const jt = await rt.json();
                tracks = (jt.items || []).map(x => x.trackingnumber).filter(Boolean);
            } catch (tErr) { /* tracking join can fail on perms — status still stamps */ }
            const latest = ifs[0];
            const patch = { nsIfId: String(latest.id), nsIfTran: latest.tranid || '', nsFulfillStatus: latest.status || '', trackingNumbers: tracks, trackingPulledAt: Date.now() };
            await updateDoc(packDocOf(job), patch);
            if (!isQsOrder(job) && soDoc && soDoc.id) { try { await updateDoc(doc(db, 'hq_sales_orders', soDoc.id), patch); } catch (soErr) { /* fin doc still carries it */ } }
            writeLog(`Pulled fulfillment ${latest.tranid || latest.id} (${latest.status || '—'}) for ${packRef(job)}${tracks.length ? ` · 🚚 ${tracks.join(', ')}` : ''}`, 'packing');
            alert(`Fulfillment ${latest.tranid || latest.id} — ${latest.status || '—'}${tracks.length ? `\n\n🚚 Tracking: ${tracks.join(', ')}\n\nStamped onto the sales order.` : '\n\nNo tracking # on it yet — pull again after shipping adds it.'}`);
        } catch (e) { alert('Fulfillment pull failed: ' + (e.message || e)); }
    };
    // ================= END PACKING STATION =================

    // --- ROD CUTS (cut stocked 8 ft rods down to 6 ft / 4 ft; issued from the HQ Sales Snapshot) ---
    const [rodCutOrders, setRodCutOrders] = useState([]);
    // RING PACKS (Stuart 2026-07-28): build stocked multi-packs from loose eaches — legacy
    // collections carry an assembly per pack size (…/G-10, …/BL-12, …-7). The BOM in NetSuite is
    // what actually gets consumed; the parsed pack size below is only what the operator is shown.
    const [rodTabMode, setRodTabMode] = useState('CUTS');       // 'CUTS' | 'PACKS'
    const [packSearch, setPackSearch] = useState("");
    const [packTargetId, setPackTargetId] = useState("");       // the pack assembly being built
    const [packComponentId, setPackComponentId] = useState(""); // the each it consumes
    const [packQty, setPackQty] = useState("");
    const [packSrcScan, setPackSrcScan] = useState("");
    const [packDestScan, setPackDestScan] = useState("");
    const [packMemo, setPackMemo] = useState("");
    const [packOp, setPackOp] = useState('BUILD');       // 'BUILD' | 'BREAK'
    const [breakSrcScan, setBreakSrcScan] = useState(""); // bin the packs come OUT of
    const [breakDestScan, setBreakDestScan] = useState("");// bin the eaches go INTO
    const [breakToCore, setBreakToCore] = useState(false); // chain a second unbuild: eaches -> raw core
    const [breakCoreScan, setBreakCoreScan] = useState(""); // bin the raw core goes into
    const [packDiag, setPackDiag] = useState(null);       // what NetSuite says the BOM actually sources
    const [diagNames, setDiagNames] = useState({}); // NetSuite id -> { code, name } for unmapped components (BOTH diagnostics)
    const [cartDiag, setCartDiag] = useState(null);  // { lineId, res } — the same BOM check, for one conversion-cart line
    // ── ISSUE A CUT FROM THE BENCH (Eric 2026-08-21: "would be good and simple to have this
    // ability live … in the Rod Cut section of WMS. Perhaps an admin area to issue them there,
    // already has the live stock pull there too.") ──────────────────────────────────────────────
    // Until now a cut could only be raised from HQ's Stocked Sales Snapshot, which is the wrong
    // room: the person who knows a rack is running short is standing at the rack. The live stock
    // pull is already on this tab, which is exactly Eric's point.
    // ANY POLE, ANY LENGTH (Stuart 2026-08-25: "we shouldn't have to limit it by pattern … as long
    // as it is category pole and the larger pole and smaller poles are all existing items in
    // Netsuite that can be selected"). The 8-ft-source gate is gone and the cut length is a FIELD
    // rather than a string substitution on the source code — the grammar only pre-fills it. Same
    // planManualCut gate HQ uses, so the two benches cannot drift apart the way they already had.
    const [issueCut, setIssueCut] = useState({ code: '', qty: '', target: '', per: '2', scrapFt: '0', open: false });
    const cutLook = (code) => {
        const k = String(code || '').trim().toUpperCase();
        const part = k ? hqParts.find(p => erpOf(p) === k) : null;
        if (!part) return null;
        return { code: k, internalId: part.netSuiteInternalId ? String(part.netSuiteInternalId) : '', productType: part.manufacturingSpecs?.productType || part.productType || '' };
    };
    const issueRodCut = async () => {
        const src = String(issueCut.code || '').trim().toUpperCase();
        const tgt = String(issueCut.target || '').trim().toUpperCase();
        const qn = parseInt(issueCut.qty) || 0;
        const srcRec = cutLook(src), tgtRec = cutLook(tgt);
        if (src && !srcRec) return alert(`"${src}" is not in the Master Library.`);
        if (tgt && !tgtRec) return alert(`"${tgt}" is not in the Master Library — create & sync it first (HQ 11.1).`);
        const plan = planManualCut({
            source: srcRec || { code: src }, qtySource: qn, scrapFt: Number(issueCut.scrapFt) || 0,
            targets: [{ code: tgt, per: issueCut.per, internalId: tgtRec && tgtRec.internalId, productType: tgtRec && tgtRec.productType }],
        });
        if (!plan.ok) return alert(`✂ Can't issue this cut:\n\n${plan.errors.map(e => `• ${e}`).join('\n')}`);
        const line = plan.lines[0];
        if (!window.confirm(`✂ Issue a cut?\n\n${plan.qtySource} × ${src}  →  ${line.qty} × ${line.itemId}${plan.scrapFt ? `  (+${plan.scrapFt} ft scrap)` : ''}\n\nIt joins "Cuts for Sales Orders" below. NetSuite stock moves when the operator scans the bins and confirms the cut.`)) return;
        try {
            const id = `RC-WMS-${Date.now()}`;
            await setDoc(doc(db, 'rod_cut_orders', id), {
                id, brand: activeBrand, status: 'OPEN',
                sourceItemId: src, sourceInternalId: srcRec.internalId,
                targets: plan.lines,
                targetItemId: line.itemId, targetInternalId: line.internalId,
                qtySource: plan.qtySource, qtyTarget: line.qty, cutTo: `${line.per}× ${line.itemId}`, scrapFt: plan.scrapFt,
                sourceBin: null, destBin: null, nsAdjustmentId: null,
                purpose: 'STOCK', createdVia: 'WMS_BENCH',
                createdAt: Date.now(), createdBy: operator?.name || '', completedAt: null, completedBy: null,
            });
            writeLog(`✂ Issued rod cut ${id}: ${plan.qtySource} × ${src} → ${line.qty} × ${line.itemId}`, 'wms');
            setIssueCut({ code: '', qty: '', target: '', per: '2', scrapFt: '0', open: false });
            alert(`✂ Cut issued: ${plan.qtySource} × ${src} → ${line.qty} × ${line.itemId}.\n\nIt is in "Cuts for Sales Orders" below.`);
        } catch (e) { alert('Could not issue the cut: ' + (e.message || e)); }
    };
    const [activeCut, setActiveCut] = useState(null);        // the rod_cut_orders doc being worked
    const [cutSrcScan, setCutSrcScan] = useState('');
    const [cutDestScan, setCutDestScan] = useState('');
    const [cutConfirmed, setCutConfirmed] = useState(false); // operator confirmed the physical cut
    const [cutMemo, setCutMemo] = useState('');
    useEffect(() => {
        const unsub = onSnapshot(collection(db, "rod_cut_orders"), (snap) => {
            setRodCutOrders(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
        return () => unsub();
    }, []);

    // --- NETSUITE INVENTORY SYNC (PULL) ---
    const pullNetSuiteStock = async () => {
        setIsSyncing(true);
        try {
            const erpIds = hqParts.map(p => p.legacyErpId || p.itemId).filter(Boolean);
            const locationId = BRAND_NETSUITE_MAP[activeBrand]?.location || "17";

            if (erpIds.length > 0) {
                const chunkSize = 500;
                let allResults = [];
                let allBinResults = [];   // per-bin on-hand rows (one per item+bin) for the COUNT tab

                const runQuery = async (q) => {
                    const response = await nsProxyFetch({
                        targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`,
                        method: 'POST',
                        payload: { q }
                    });
                    const result = await response.json();
                    if (!response.ok) throw new Error(JSON.stringify(result));
                    return result.items || [];
                };

                for (let i = 0; i < erpIds.length; i += chunkSize) {
                    const chunk = erpIds.slice(i, i + chunkSize);
                    const idList = chunk.map(id => `'${id.replace(/'/g, "''")}'`).join(',');

                    // 1) Combined on-hand per item (unchanged source — keeps CONVERT/TRANSFER/PLATING totals correct).
                    const q = `
                        SELECT
                            Item.itemid AS legacy_id,
                            SUM(AggregateItemLocation.quantityonhand) AS onhand
                        FROM Item
                        LEFT JOIN AggregateItemLocation ON AggregateItemLocation.item = Item.id
                        WHERE Item.itemid IN (${idList})
                        AND AggregateItemLocation.location = ${locationId}
                        GROUP BY Item.itemid
                    `;
                    allResults = allResults.concat(await runQuery(q));

                    // 2) Per-bin on-hand (one row per item+bin) so a count can adjust ONLY the entered bin.
                    //    Modeled on StockViewTab's proven InventoryBalance/Bin join. Best-effort: a failure here
                    //    must not break the main pull — the COUNT tab then falls back to combined-total behavior.
                    try {
                        const qBins = `
                            SELECT
                                Item.itemid AS legacy_id,
                                Bin.binnumber AS bin_number,
                                SUM(InventoryBalance.quantityonhand) AS onhand
                            FROM Item
                            LEFT JOIN InventoryBalance ON InventoryBalance.item = Item.id
                            LEFT JOIN Bin ON InventoryBalance.binnumber = Bin.id
                            WHERE Item.itemid IN (${idList})
                            AND InventoryBalance.location = ${locationId}
                            GROUP BY Item.itemid, Bin.binnumber
                        `;
                        allBinResults = allBinResults.concat(await runQuery(qBins));
                    } catch (binErr) {
                        console.warn("Per-bin stock pull failed (count tab will use combined totals):", binErr);
                    }
                }

                const stockMap = {};
                allResults.forEach(row => {
                    if (row.legacy_id) stockMap[row.legacy_id.toUpperCase()] = { onHand: parseInt(row.onhand) || 0, bins: [] };
                });
                // Attach the per-bin breakdown. Only rows with an actual bin name count; null-bin rows
                // (non-bin-managed stock) are ignored here and handled by the total-on-hand fallback.
                allBinResults.forEach(row => {
                    if (!row.legacy_id) return;
                    const id = row.legacy_id.toUpperCase();
                    const binName = (row.bin_number || '').trim();
                    if (!binName) return;
                    if (!stockMap[id]) stockMap[id] = { onHand: 0, bins: [] };
                    stockMap[id].bins.push({ bin: binName.toUpperCase(), qty: parseInt(row.onhand) || 0 });
                });

                setNsStock(stockMap);
            }
        } catch (error) {
            console.error("NetSuite Sync Error:", error);
            alert("Failed to pull NetSuite Stock.");
        }
        setIsSyncing(false);
    };

    // Ensure a bin exists in NetSuite so transactions can reference it by name (idempotent — an already-existing bin is fine).
    // Resolve a NetSuite item's INTERNAL id from its item number. The stored netSuiteInternalId can be stale or
    // hold the item number itself, which NetSuite rejects as INVALID_VALUE — so look it up authoritatively.
    // Resolve a NetSuite item's internal id (+ type) from its item number. The stored netSuiteInternalId can be
    // stale or hold the item number (→ INVALID_VALUE), so look it up authoritatively; type confirms it's an Assembly.
    const resolveItemDetail = async (itemNumber) => {
        const name = (itemNumber || '').trim();
        if (!name) return null;
        const run = async (cols) => {
            const r = await nsProxyFetch({
                targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`,
                method: 'POST',
                payload: { q: `SELECT ${cols} FROM item WHERE UPPER(itemid) = '${name.toUpperCase().replace(/'/g, "''")}'` }
            });
            const b = await r.json().catch(() => ({}));
            return (r.ok && b.items && b.items.length) ? b.items[0] : null;
        };
        const row = (await run('id, itemtype')) || (await run('id')); // fall back if itemtype column is unavailable
        return row ? { id: String(row.id), type: String(row.itemtype || '') } : null;
    };

    const ensureBinExists = async (binNumber, locationId) => {
        const response = await nsProxyFetch({
            targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/bin`,
            method: 'POST',
            payload: { binNumber: (binNumber || '').toUpperCase(), location: { id: locationId } }
        });
        if (response.ok) return true;
        const body = await response.json().catch(() => ({}));
        const msg = JSON.stringify(body).toLowerCase();
        // A duplicate / already-exists error means the bin is already usable — treat as success.
        if (msg.includes('exist') || msg.includes('duplicate') || msg.includes('unique') || msg.includes('already')) return true;
        throw new Error(`Bin "${binNumber}" could not be created in NetSuite: ${typeof body === 'object' ? JSON.stringify(body) : String(body)}`);
    };

    // --- NETSUITE INVENTORY ADJUSTMENT (PUSH) ---
    const pushInventoryAdjustment = async () => {
        const skipped = [];
        // One delta per counted (item, bin): the variance is measured against THAT bin's on-hand, so a
        // count only ever moves the bin it was entered against — never the item's combined cross-bin total.
        const rowDeltas = countRows.map(row => {
            if (physicalCounts[row.rowKey] === undefined) return null;
            const delta = physicalCounts[row.rowKey] - row.binOnHand;
            if (delta === 0) return null;
            // Don't send a Firestore doc id as a NetSuite item ref — skip unmapped items (they'd 400).
            if (!row.netSuiteInternalId) { skipped.push(row.itemName || row.erpId || row.id); return null; }
            const storedBin = (row.binLocation || '').trim().toUpperCase();
            const rawEff = (row.isExistingBin ? row.countBin : ((binEdits[row.rowKey] ?? row.countBin) || '')).trim().toUpperCase();
            // "UNASSIGNED" is a UI placeholder, never a real bin — never create/push it to NetSuite.
            const effBin = rawEff === 'UNASSIGNED' ? '' : rawEff;
            return {
                internalId: row.netSuiteInternalId,
                docId: row.id,
                itemName: row.itemName || row.erpId || row.id,
                binNumber: effBin,
                // Only a brand-new bin assignment (new/unbinned row) needs creating in NetSuite + writing back
                // to the item's home bin. Counting an existing bin must never reassign the item's home bin.
                binChanged: !row.isExistingBin && effBin !== '' && effBin !== storedBin,
                adjustQtyBy: delta
            };
        }).filter(Boolean);

        // GUARD (Stuart 2026-07-16): a bin-managed location (e.g. loc 17) rejects any adjustment line
        // with an empty bin — "Please enter value(s) for: Bin." This bites brand-new items (0 on hand,
        // no home bin) counted without typing a destination bin. Catch it HERE with a clear, item-named
        // message instead of letting NetSuite 400 with a cryptic payload.
        const needBin = rowDeltas.filter(d => !d.binNumber);
        if (needBin.length) {
            return alert(`Type a destination bin before syncing.\n\n${needBin.length} counted item(s) have a variance but NO bin — a bin-managed location requires one on every adjustment. Enter a bin # in the BIN column for:\n\n${[...new Set(needBin.map(d => d.itemName))].slice(0, 12).join('\n')}${needBin.length > 12 ? `\n…+${needBin.length - 12} more` : ''}`);
        }

        // Group bins of the same item, then split each item's bin moves. A single inventory-adjustment line
        // can only push ONE direction (NetSuite rejects a mix of +/- bins with "Invalid number (must be
        // positive)" — that's a transfer, not an adjustment). So for each item we pair its down-bins with its
        // up-bins into BIN TRANSFERS, and only the leftover single-direction remainder becomes an ADJUSTMENT.
        const byItem = {};
        rowDeltas.forEach(d => {
            if (!byItem[d.internalId]) byItem[d.internalId] = { internalId: d.internalId, docId: d.docId, bins: [] };
            byItem[d.internalId].bins.push({ binNumber: d.binNumber, qty: d.adjustQtyBy });
        });

        const transferItems = []; // { internalId, moves: [{from, to, qty}] }  → bin transfers (crossing moves)
        const adjustItems = [];   // { internalId, bins: [{binNumber, qty}], total } → residual real variance
        Object.values(byItem).forEach(it => {
            const decs = it.bins.filter(b => b.qty < 0).map(b => ({ bin: b.binNumber, rem: -b.qty }));
            const incs = it.bins.filter(b => b.qty > 0).map(b => ({ bin: b.binNumber, rem: b.qty }));
            const moves = [];
            let di = 0, ii = 0;
            while (di < decs.length && ii < incs.length) {
                const move = Math.min(decs[di].rem, incs[ii].rem);
                if (move > 0) moves.push({ from: decs[di].bin, to: incs[ii].bin, qty: move });
                decs[di].rem -= move; incs[ii].rem -= move;
                if (decs[di].rem === 0) di++;
                if (incs[ii].rem === 0) ii++;
            }
            if (moves.length) transferItems.push({ internalId: it.internalId, moves });
            const adjBins = [
                ...decs.filter(x => x.rem > 0).map(x => ({ binNumber: x.bin, qty: -x.rem })),
                ...incs.filter(x => x.rem > 0).map(x => ({ binNumber: x.bin, qty: x.rem }))
            ];
            if (adjBins.length) adjustItems.push({ internalId: it.internalId, bins: adjBins, total: adjBins.reduce((s, b) => s + b.qty, 0) });
        });

        if (transferItems.length === 0 && adjustItems.length === 0) {
            return alert(skipped.length
                ? `No pushable adjustments — ${skipped.length} counted item(s) have no NetSuite Internal ID. Map them first (HQ → ERP Mapping Audit / Mass Update):\n\n${skipped.slice(0, 12).join('\n')}${skipped.length > 12 ? `\n…+${skipped.length - 12} more` : ''}`
                : "No variances found to adjust.");
        }

        const nsConfig = BRAND_NETSUITE_MAP[activeBrand];
        if (!nsConfig) return alert("NetSuite routing configuration missing for this brand.");

        const postNs = async (url, body) => {
            const r = await nsProxyFetch({ targetUrl: url, method: 'POST', payload: body });
            const rb = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(typeof rb === 'object' ? JSON.stringify(rb) : String(rb));
            return rb;
        };

        try {
            setIsSyncing(true);

            // Ensure every bin we reference exists (idempotent), and write any new home-bin back onto the item.
            const allBins = new Set();
            transferItems.forEach(t => t.moves.forEach(m => { allBins.add(m.from); allBins.add(m.to); }));
            adjustItems.forEach(a => a.bins.forEach(b => allBins.add(b.binNumber)));
            rowDeltas.filter(a => a.binChanged).forEach(a => allBins.add(a.binNumber));
            for (const bin of allBins) { if (bin) await ensureBinExists(bin, nsConfig.location); }
            await Promise.all(rowDeltas.filter(a => a.binChanged).map(a =>
                updateDoc(doc(db, "Approved_Designs", a.docId), { "manufacturingSpecs.binLocation": a.binNumber }).catch(() => {})
            ));

            const memoText = `Cycle count by ${operator?.name || 'Unknown'}${countMemo.trim() ? ` — ${countMemo.trim()}` : ''}`;
            const posted = [];

            // 1) Bin transfers for the crossing moves (qty positive; direction is from→to).
            if (transferItems.length) {
                await postNs(`https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/binTransfer`, {
                    subsidiary: { id: nsConfig.subsidiary }, location: { id: nsConfig.location }, memo: nsMemo(memoText),
                    inventory: { items: transferItems.map(t => {
                        const lineQty = t.moves.reduce((s, m) => s + m.qty, 0);
                        return ({
                            item: { id: t.internalId },
                            quantity: lineQty,   // line-level qty is required before NetSuite accepts the inventoryDetail
                            inventoryDetail: { quantity: lineQty, inventoryAssignment: { items: t.moves.map(m => ({ binNumber: { refName: m.from }, toBinNumber: { refName: m.to }, quantity: m.qty })) } }
                        });
                    }) }
                });
                posted.push(`${transferItems.reduce((s, t) => s + t.moves.length, 0)} bin transfer(s)`);
            }

            // 2) Inventory adjustment for the residual single-direction variance.
            if (adjustItems.length) {
                await postNs(`https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/inventoryadjustment`, {
                    account: { id: "254" }, subsidiary: { id: nsConfig.subsidiary }, memo: nsMemo(memoText),
                    inventory: { items: adjustItems.map(adj => ({
                        item: { id: adj.internalId },
                        location: { id: nsConfig.location },
                        adjustQtyBy: adj.total,
                        inventoryDetail: { quantity: adj.total, inventoryAssignment: { items: adj.bins.map(b => ({ binNumber: { refName: b.binNumber }, quantity: b.qty })) } }
                    })) }
                });
                posted.push(`${adjustItems.length} adjustment line(s)`);
            }

            alert(`✅ NetSuite updated: ${posted.join(' + ')}.${skipped.length ? `\n\n⚠️ Skipped ${skipped.length} counted item(s) with no NetSuite Internal ID.` : ''}`);
            writeLog(`Count push: ${posted.join(' + ')}.${countMemo.trim() ? ` Memo: ${countMemo.trim()}` : ''}`, 'wms');
            setPhysicalCounts({});
            setBinEdits({});
            setCountMemo("");
            setShowSynapsis(false);
            pullNetSuiteStock();
        } catch (e) {
            console.error("Inventory adjustment push failed:", e);
            alert("❌ NetSuite rejected the adjustment:\n\n" + (e.message || e) + "\n\nIf it mentions the bin / inventory number not being found, NetSuite couldn't match the bin by its name — tell me and I'll switch to the bin's internal id. If it mentions inventoryDetail on an item that isn't bin/lot-tracked, I'll drop the bin detail for those.");
        } finally {
            setIsSyncing(false);
        }
    };

    // --- NETSUITE ASSEMBLY BUILD (in-house convert: consume raw base -> build phosphated assembly) ---
    const pushAssemblyBuild = async () => {
        const base = convertBase;
        const target = (convertTargetId && hqParts.find(p => p.id === convertTargetId))
            || (base && hqParts.find(p => erpOf(p) === `${base.erpId}/P`))
            || null;
        const qty = parseInt(convertQty) || 0;
        if (!base || !target || qty <= 0) return;
        if (!base.netSuiteInternalId) return alert(`Base item ${base.erpId} has no NetSuite Internal ID — map it first (HQ → ERP Mapping Audit / Mass Update).`);
        if (!target.netSuiteInternalId) return alert(`Target assembly ${erpOf(target)} has no NetSuite Internal ID — map it first.`);
        const nsConfig = BRAND_NETSUITE_MAP[activeBrand];
        if (!nsConfig) return alert("NetSuite routing configuration missing for this brand.");

        const srcBin = binOf(base);
        const destBin = binOf(target);
        const memoText = `Phosphate convert by ${operator?.name || 'Unknown'}${convertMemo.trim() ? ` — ${convertMemo.trim()}` : ''}`;

        let dbg = '';
        try {
            setIsSyncing(true);
            // Resolve authoritative NetSuite internal ids + verify the target is actually an Assembly item
            // (an assembly build rejects a non-assembly id as INVALID_VALUE on `item`).
            const assembly = await resolveItemDetail(erpOf(target));
            if (!assembly) { setIsSyncing(false); return alert(`Couldn't find ${erpOf(target)} in NetSuite by item id — confirm the exact item id.`); }
            if (assembly.type && !/assembl/i.test(assembly.type)) { setIsSyncing(false); return alert(`${erpOf(target)} is type "${assembly.type}" in NetSuite, not an Assembly. An assembly build needs an Assembly/BOM item — set ${erpOf(target)} up as an assembly (with ${base.erpId} as a component), or tell me the correct assembly item id.`); }
            const assemblyId = assembly.id;
            dbg = `resolved ${erpOf(target)} -> id ${assemblyId} (type ${assembly.type || '?'})`;
            // Build via the RESTlet — it sources the BOM, sets the raw component's consume bin server-side,
            // and receives the finished /P into destBin (the plain REST record API can't do either at create).
            const consumeBin = String(srcBin).trim().toUpperCase();
            const receiveBin = String(destBin || '').trim().toUpperCase();
            if (!receiveBin) { setIsSyncing(false); return alert(`${erpOf(target)} has no destination bin — set its home bin (or use the Convert cart, which takes a put-away bin per line). The /P is bin-tracked, so NetSuite needs a receive bin.`); }
            const demandDoc = convertDemandId ? (convertDemands.find(d => d.id === convertDemandId) || {}) : {};
            const demandWo = (!demandDoc.nsWoOnErp || demandDoc.nsWoOnErp === demandDoc.targetErpId) ? demandDoc.nsWoId : null;
            const built = await postConvertBuild({ itemId: assemblyId, quantity: qty, subsidiary: nsConfig.subsidiary, location: nsConfig.location, bin: consumeBin, toBin: receiveBin, memo: nsMemo(memoText), workOrderId: demandWo || undefined });

            alert(`✅ Assembly build #${built.id || ''} posted: +${qty} × ${erpOf(target)}, −${qty} × ${base.erpId} (consumed from ${consumeBin}, received into ${receiveBin}).`);
            writeLog(`Assembly Build (phosphate): +${qty} ${erpOf(target)} / -${qty} ${base.erpId}.${convertMemo.trim() ? ` Memo: ${convertMemo.trim()}` : ''}`, 'wms');
            // Converted straight through (no cart hop) — the HQ to-do that opened this is satisfied.
            if (convertDemandId) {
                const dm = convertDemands.find(d => d.id === convertDemandId) || null;
                await deleteDoc(doc(db, "convert_demand", convertDemandId)).catch(() => {});
                if (dm && dm.finWoId) {
                    try {
                        const cleared = await clearConvertGate(dm, operator?.name || '');
                        if (cleared) writeLog(`Convert done — WO ${dm.finWoId} ${cleared === 'released' ? 'AUTO-RELEASED to the finishing floor (Order Entry auto-flow)' : 'released from its convert gate (RTG can dispatch it)'}.`, 'wms');
                    } catch (e) { console.warn('convert gate clear failed for', dm.finWoId, e); }
                }
            }
            setConvertBase(null); setConvertTargetId(""); setConvertTargetSearch(""); setConvertQty(""); setConvertSrcScan(""); setConvertDestScan(""); setConvertMemo(""); setConvertLot(""); setConvertDemandId(null);
            pullNetSuiteStock();
        } catch (e) {
            console.error("Assembly build push failed:", e);
            alert("❌ NetSuite rejected the build:\n\n" + (e.message || e) + (dbg ? `\n\n(${dbg})` : '') + "\n\nIf 'item' is still rejected with a valid Assembly id, the field name may differ — tell me and I'll adjust.");
        } finally {
            setIsSyncing(false);
        }
    };

    // --- NETSUITE BIN TRANSFER (move qty between bins within a location; total on-hand unchanged) ---
    const pushBinTransfer = async () => {
        const item = transferBase;
        const qty = parseInt(transferQty) || 0;
        const fromBin = (transferSrcScan || '').trim().toUpperCase();
        const toBin = (transferDestScan || '').trim().toUpperCase();
        if (!item || qty <= 0 || !fromBin || !toBin) return;
        if (!item.netSuiteInternalId) return alert(`${item.erpId} has no NetSuite Internal ID — map it first (HQ → ERP Mapping Audit / Mass Update).`);
        if (fromBin.toUpperCase() === toBin.toUpperCase()) return alert("Source and destination bins are the same.");
        const nsConfig = BRAND_NETSUITE_MAP[activeBrand];
        if (!nsConfig) return alert("NetSuite routing configuration missing for this brand.");
        const memoText = `Bin transfer by ${operator?.name || 'Unknown'}${transferMemo.trim() ? ` — ${transferMemo.trim()}` : ''}`;

        try {
            setIsSyncing(true);
            // Make sure the destination bin exists (idempotent — an existing bin is fine).
            await ensureBinExists(toBin, nsConfig.location);
            const payload = {
                targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/binTransfer`,
                method: 'POST',
                payload: {
                    subsidiary: { id: nsConfig.subsidiary },
                    location: { id: nsConfig.location },
                    memo: nsMemo(memoText),
                    inventory: {
                        items: [{
                            item: { id: item.netSuiteInternalId },
                            quantity: qty,   // line-level qty is required before NetSuite accepts the inventoryDetail
                            // move qty from the source bin to the destination bin (same item, same location)
                            inventoryDetail: {
                                quantity: qty,
                                inventoryAssignment: {
                                    items: [{ binNumber: { refName: fromBin }, toBinNumber: { refName: toBin }, quantity: qty }]
                                }
                            }
                        }]
                    }
                }
            };

            const response = await nsProxyFetch(payload);
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(typeof result === 'object' ? JSON.stringify(result) : String(result));

            alert(`✅ Bin transfer posted: ${qty} × ${item.erpId} moved ${fromBin} → ${toBin}.`);
            writeLog(`Bin Transfer: ${qty} ${item.erpId} ${fromBin} -> ${toBin}.${transferMemo.trim() ? ` Memo: ${transferMemo.trim()}` : ''}`, 'wms');
            setTransferBase(null); setTransferSrcScan(""); setTransferQty(""); setTransferDestScan(""); setTransferMemo("");
            pullNetSuiteStock();
        } catch (e) {
            console.error("Bin transfer push failed:", e);
            alert("❌ NetSuite rejected the bin transfer:\n\n" + (e.message || e) + "\n\nThis is the first bin transfer we've posted — if it names a field (toBinNumber / inventoryAssignment / binNumber / inventory), paste it and I'll correct the REST shape.");
        } finally {
            setIsSyncing(false);
        }
    };

    // --- ROD CUT (8 ft → 6 ft / 4 ft): ONE inventory adjustment with two single-direction lines ---
    // (−source 8 ft rods out of the scanned source bin, +cut-down rods into the scanned destination
    // bin). Same proven REST shape + account as the COUNT tab's adjustment; because each LINE stays
    // one direction, the mixed +/- bin rule is never violated. 6 ft cuts lose 2 ft/rod as untracked scrap.
    const pushRodCut = async () => {
        const o = activeCut;
        if (!o) return;
        const srcBin = (cutSrcScan || '').trim().toUpperCase();
        const destBin = (cutDestScan || '').trim().toUpperCase();
        if (!srcBin || !destBin || !cutConfirmed) return;
        const nsConfig = BRAND_NETSUITE_MAP[activeBrand];
        if (!nsConfig) return alert("NetSuite routing configuration missing for this brand.");
        // ONE STICK CAN BECOME TWO LENGTHS (Eric 2026-08-19: a 12 ft HTA1235 cuts into "one 6-ft +
        // one 4-ft"). `targets` is the real shape; a doc written before it existed carries only the
        // three legacy fields, so it is read back as a single line and posts exactly as it always did.
        const cutLines = Array.isArray(o.targets) && o.targets.length
            ? o.targets
            : [{ itemId: o.targetItemId, internalId: o.targetInternalId, qty: o.qtyTarget }];
        const yieldText = cutLines.map(l => `${l.qty} × ${l.itemId}`).join(' + ');
        const memoText = `Rod cut by ${operator?.name || 'Unknown'}: ${o.qtySource} × ${o.sourceItemId} → ${yieldText}${o.scrapFt ? ` (+${o.scrapFt} ft scrap)` : ''}${cutMemo.trim() ? ` — ${cutMemo.trim()}` : ''}`;
        try {
            setIsSyncing(true);
            await ensureBinExists(destBin, nsConfig.location);
            const r = await nsProxyFetch({
                targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/inventoryadjustment`,
                method: 'POST',
                payload: {
                    account: { id: "254" }, subsidiary: { id: nsConfig.subsidiary }, memo: nsMemo(memoText),
                    inventory: { items: [
                        { item: { id: String(o.sourceInternalId) }, location: { id: nsConfig.location }, adjustQtyBy: -o.qtySource, inventoryDetail: { quantity: -o.qtySource, inventoryAssignment: { items: [{ binNumber: { refName: srcBin }, quantity: -o.qtySource }] } } },
                        ...cutLines.map(l => ({ item: { id: String(l.internalId) }, location: { id: nsConfig.location }, adjustQtyBy: l.qty, inventoryDetail: { quantity: l.qty, inventoryAssignment: { items: [{ binNumber: { refName: destBin }, quantity: l.qty }] } } }))
                    ] }
                }
            });
            const body = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(typeof body === 'object' ? JSON.stringify(body) : String(body));
            await updateDoc(doc(db, "rod_cut_orders", o.id), { status: 'DONE', sourceBin: srcBin, destBin, nsAdjustmentId: body.id || null, completedAt: Date.now(), completedBy: operator?.name || '' });
            writeLog(`Rod cut ${o.id}: -${o.qtySource} ${o.sourceItemId} (${srcBin}) → ${cutLines.map(l => `+${l.qty} ${l.itemId}`).join(' ')} (${destBin}).`, 'wms');

            // ── A CUT FOR FINISHING RELEASES ITS WORK ORDER (Stuart 2026-08-19) ─────────────────
            // "Once confirmed as cut and complete it prints the work order label there for the
            // finishing of the 4ft poles just the same as if it was any normal piece."
            // The pieces now exist, so the order stops waiting and the label goes onto the cart with
            // them — the same setup label every other job carries, which is what makes the rest of
            // the journey ordinary.
            const isFinishingCut = o.purpose === 'FINISHING' || o.createdVia === 'FINISHING_WO';
            if (isFinishingCut && o.finWoId) {
                try {
                    await updateDoc(doc(db, 'hq_work_orders', o.finWoId), {
                        awaitingRodCut: false, rodCutDoneAt: Date.now(), rodCutDoneBy: operator?.name || '',
                        rodCutDestBin: destBin,
                    });
                } catch (e) { console.warn('Could not clear the cut gate on', o.finWoId, e); }
                printSetupLabel({
                    kind: 'SETUP · POLES (CUT)',
                    woRef: o.finWoId, orderKey: o.finWoId,
                    item: o.finWoErpId || o.targetItemId,
                    qty: o.finWoQty || o.qtyTarget,
                    finish: o.finWoRecipe || '',
                    customer: 'Internal Stock',
                });
                writeLog(`Cut ${o.id} released WO ${o.finWoId} to finishing — label printed.`, 'wms');
            }

            alert(`✅ Rod cut posted to NetSuite:\n\n−${o.qtySource} × ${o.sourceItemId} from ${srcBin}\n+${o.qtyTarget} × ${o.targetItemId} into ${destBin}${o.scrapFt ? `\n(${o.scrapFt} ft scrap — not tracked)` : ''}${isFinishingCut && o.finWoId ? `\n\n▶ WO ${o.finWoId} is released to finishing and its setup label is printing — send the cut poles with it.${Number(o.overrun) > 0 ? `\n(${o.overrun} spare ${o.targetItemId} stay in ${destBin}.)` : ''}` : ''}`);
            setActiveCut(null); setCutSrcScan(''); setCutDestScan(''); setCutConfirmed(false); setCutMemo('');
            pullNetSuiteStock();
        } catch (e) {
            console.error("Rod cut push failed:", e);
            alert("❌ NetSuite rejected the rod cut adjustment:\n\n" + (e.message || e) + "\n\nMost common cause: the source bin doesn't actually hold that many 8 ft rods — Pull Live Stock and re-check where they sit.");
        } finally {
            setIsSyncing(false);
        }
    };

    const cancelRodCut = async (o) => {
        if (!window.confirm(`Cancel rod cut order ${o.id}?\n\n${o.qtySource} × ${o.sourceItemId} → ${o.qtyTarget} × ${o.targetItemId}\n\nNo inventory has moved — this just removes the order from the queue.`)) return;
        try {
            await updateDoc(doc(db, "rod_cut_orders", o.id), { status: 'CANCELLED', cancelledAt: Date.now(), cancelledBy: operator?.name || '' });
            writeLog(`Rod cut ${o.id} cancelled.`, 'wms');
            if (activeCut?.id === o.id) { setActiveCut(null); setCutSrcScan(''); setCutDestScan(''); setCutConfirmed(false); setCutMemo(''); }
        } catch (e) { alert('Failed to cancel: ' + (e.message || e)); }
    };

    // --- CONVERSION CART (batch phosphate) ------------------------------------------------------
    // A reusable bin transfer (same proven REST shape as pushBinTransfer), parameterized so the cart
    // can stage raw → the WIP cart bin without touching the single-transfer form state.
    const runBinTransfer = async (item, qty, fromBin, toBin, memo) => {
        const nsConfig = BRAND_NETSUITE_MAP[activeBrand];
        if (!nsConfig) throw new Error("NetSuite routing configuration missing for this brand.");
        await ensureBinExists(toBin, nsConfig.location);
        const payload = {
            targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/binTransfer`,
            method: 'POST',
            payload: { subsidiary: { id: nsConfig.subsidiary }, location: { id: nsConfig.location }, memo,
                inventory: { items: [{ item: { id: item.netSuiteInternalId }, quantity: qty,
                    inventoryDetail: { quantity: qty, inventoryAssignment: { items: [{ binNumber: { refName: fromBin }, toBinNumber: { refName: toBin }, quantity: qty }] } } }] } }
        };
        const r = await nsProxyFetch(payload);
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof b === 'object' ? JSON.stringify(b) : String(b));
        return b;
    };

    // Pull the currently-selected raw item onto the cart: bin-transfer raw → cart bin, then add the
    // line to the (auto-created) open batch. NetSuite stays truthful — the stock shows in the cart bin.
    const addRawToCart = async () => {
        if (!convertBase || !convTarget) return alert("Pick a raw item and its /P assembly first.");
        if (!convertBase.netSuiteInternalId) return alert(`${convertBase.erpId} has no NetSuite Internal ID — map it first.`);
        const qty = convQtyNum;
        if (qty <= 0 || qty > convSrcQty) return alert("Enter a valid quantity (≤ the selected bin's on hand).");
        const src = convertSrcScan.trim().toUpperCase();
        if (!src || src === 'UNASSIGNED') return alert("Pick the source (raw) bin to pull from.");
        const bin = (convBatch?.cartBin || cartBin || 'PHOS-CART').trim().toUpperCase();
        const batchId = convBatch?.id || `CBATCH-${activeBrand}-${Date.now()}`;
        const existingLines = convBatch?.lines || [];
        const base = convBatch || { id: batchId, brand: activeBrand, cartBin: bin, status: 'open', lines: [], createdAt: Date.now(), createdBy: operator?.name || 'Unknown' };
        // demandId rides on the line when this pull answers an HQ "Needs Phosphating" to-do, so the
        // to-do closes when the BUILD posts (not when it reaches the cart — it isn't done until then).
        const line = { lineId: `L${Date.now()}`, rawId: convertBase.id, rawErpId: convertBase.erpId, rawName: convertBase.itemName, rawInternalId: convertBase.netSuiteInternalId, targetErpId: erpOf(convTarget), targetName: convTarget.itemName, targetInternalId: convTarget.netSuiteInternalId || null, qty, srcBin: src, status: 'on_cart', newBin: '', demandId: convertDemandId || null };
        try {
            setIsSyncing(true);
            // 1) Record the line FIRST — so a Firestore permission/write failure surfaces BEFORE any
            //    stock moves in NetSuite (no more "transferred but the cart never recorded it").
            await setDoc(doc(db, "conversion_batches", batchId), { ...base, cartBin: bin, lines: [...existingLines, line], updatedAt: Date.now() }, { merge: true });
            // 2) Move the raw onto the cart. If NetSuite rejects it, roll the line back so the two stay in sync.
            try {
                await runBinTransfer(convertBase, qty, src, bin, `Phos cart pull ${bin}`.slice(0, 40)); // NetSuite memo max = 40 chars
            } catch (txErr) {
                await updateDoc(doc(db, "conversion_batches", batchId), { lines: existingLines }).catch(() => {});
                throw txErr;
            }
            if (convertDemandId) await updateDoc(doc(db, "convert_demand", convertDemandId), { status: 'on_cart', cartBatchId: batchId, cartLineId: line.lineId, pulledAt: Date.now(), pulledBy: operator?.name || '' }).catch(() => {});
            writeLog(`Phosphate cart: pulled ${qty}× ${convertBase.erpId} ${src} → ${bin}.`, 'wms');
            setConvertBase(null); setConvertTargetId(""); setConvertTargetSearch(""); setConvertQty(""); setConvertSrcScan(""); setConvertDestScan(""); setConvertMemo(""); setConvertDemandId(null);
            pullNetSuiteStock();
        } catch (e) { console.error('add to cart failed', e); alert("❌ Pull to cart failed:\n\n" + (e.message || e)); }
        finally { setIsSyncing(false); }
    };

    // Convert one cart line: assembly build (consume the raw from the cart, produce the /P). Same proven
    // build shape as pushAssemblyBuild. The /P isn't bin-tracked in NetSuite, so the put-away bin is the
    // operator's physical reference, recorded on the line.
    const convertCartLine = async (line) => {
        if (!convBatch || line.status === 'converted') return;
        if (!line.targetErpId) return alert("This line has no target /P assembly.");
        const nsConfig = BRAND_NETSUITE_MAP[activeBrand];
        if (!nsConfig) return alert("NetSuite routing configuration missing for this brand.");
        const newBin = (cartBinEdits[line.lineId] ?? line.newBin ?? '').trim().toUpperCase();
        if (!newBin) return alert(`Enter a put-away bin for the finished ${line.targetErpId} on this line first — the /P is bin-tracked, so NetSuite needs a destination bin.`);
        try {
            setIsSyncing(true);
            const assembly = await resolveItemDetail(line.targetErpId);
            if (!assembly) { setIsSyncing(false); return alert(`Couldn't find ${line.targetErpId} in NetSuite by item id.`); }
            if (assembly.type && !/assembl/i.test(assembly.type)) { setIsSyncing(false); return alert(`${line.targetErpId} is type "${assembly.type}", not an Assembly.`); }
            // Build via the RESTlet — it sources the BOM and sets the raw component's consume bin server-side,
            // and receives the finished /P into the operator's put-away bin. Raw is consumed from the CART bin.
            const consumeBin = (convBatch.cartBin || cartBin || 'PHOS-CART').trim().toUpperCase();
            const lineDemandDoc = line.demandId ? (convertDemands.find(d => d.id === line.demandId) || {}) : {};
            const lineDemandWo = (!lineDemandDoc.nsWoOnErp || lineDemandDoc.nsWoOnErp === lineDemandDoc.targetErpId) ? lineDemandDoc.nsWoId : null;
            await postConvertBuild({ itemId: assembly.id, quantity: line.qty, subsidiary: nsConfig.subsidiary, location: nsConfig.location, bin: consumeBin, toBin: newBin, memo: nsMemo(`Phos convert ${convBatch.cartBin || ''}`), workOrderId: lineDemandWo || undefined });
            const lines = (convBatch.lines || []).map(l => l.lineId === line.lineId ? { ...l, status: 'converted', newBin, convertedAt: Date.now() } : l);
            await updateDoc(doc(db, "conversion_batches", convBatch.id), { lines, updatedAt: Date.now() });
            // The HQ to-do is satisfied only now, once the /P actually exists in NetSuite.
            if (line.demandId) {
                // A demand raised by a work-order pre-check carries the WO's id — completing the
                // convert is what opens that WO's gate (same release the rod cut performs).
                const dm = convertDemands.find(d => d.id === line.demandId) || null;
                await deleteDoc(doc(db, "convert_demand", line.demandId)).catch(() => {});
                if (dm && dm.finWoId) {
                    try {
                        const cleared = await clearConvertGate(dm, operator?.name || '');
                        if (cleared) writeLog(`Convert done — WO ${dm.finWoId} ${cleared === 'released' ? 'AUTO-RELEASED to the finishing floor (Order Entry auto-flow)' : 'released from its convert gate (RTG can dispatch it)'}.`, 'wms');
                    } catch (e) { console.warn('convert gate clear failed for', dm.finWoId, e); }
                }
            }
            writeLog(`Phosphate convert: +${line.qty} ${line.targetErpId} / −${line.qty} ${line.rawErpId} (cart ${convBatch.cartBin || ''} → ${newBin || 'finished'}).`, 'wms');
            pullNetSuiteStock();
        } catch (e) { console.error('convert line failed', e); alert("❌ NetSuite rejected the build:\n\n" + (e.message || e) + "\n\nIf it still mentions the component list / inventory detail, the raw isn't in the cart bin in NetSuite yet (stage it first), or the field name differs (componentInventoryDetail) — paste the error and I'll correct it."); }
        finally { setIsSyncing(false); }
    };

    // ASK WHAT THIS LINE'S BOM ACTUALLY SOURCES, WITHOUT BUILDING (Stuart 2026-08-06). Same RESTlet,
    // same `diag:true` mode as the Ring Packs BOM check — it stops at step 'built-detail' and returns
    // the component structure instead of saving, so this posts NOTHING and can be run on the bench
    // while an operator is standing at the failing line.
    //
    // It is deliberately given the EXACT arguments the real convert would use — the cart bin as the
    // consume bin, the operator's put-away bin, the line quantity — because a check run with different
    // inputs answers a different question than the one that failed.
    const runCartDiag = async (line) => {
        if (!convBatch || !line || !line.targetErpId) return;
        const nsConfig = BRAND_NETSUITE_MAP[activeBrand];
        if (!nsConfig) return alert("NetSuite routing configuration missing for this brand.");
        const newBin = (cartBinEdits[line.lineId] ?? line.newBin ?? '').trim().toUpperCase();
        try {
            setIsSyncing(true);
            setCartDiag(null);
            const assembly = await resolveItemDetail(line.targetErpId);
            if (!assembly) { setIsSyncing(false); return alert(`Couldn't find ${line.targetErpId} in NetSuite by item id.`); }
            const res = await postConvertBuild({
                itemId: assembly.id, quantity: line.qty,
                subsidiary: nsConfig.subsidiary, location: nsConfig.location,
                bin: (convBatch.cartBin || cartBin || 'PHOS-CART').trim().toUpperCase(),
                toBin: newBin,
                memo: 'BOM check', diag: true,
            });
            setCartDiag({ lineId: line.lineId, res });
            const unknown = (res && Array.isArray(res.diag) ? res.diag : [])
                .filter(d => d && d.item !== undefined)
                .map(d => String(d.item))
                .filter(id => !hqParts.some(p => String(p.netSuiteInternalId || '') === id));
            if (unknown.length) setDiagNames(await resolveItemNames(unknown));
        } catch (e) {
            setCartDiag({ lineId: line.lineId, res: { error: (e && e.message) ? e.message : String(e) } });
        } finally { setIsSyncing(false); }
    };

    const closeCartBatch = async () => {
        if (!convBatch) return;
        const open = (convBatch.lines || []).filter(l => l.status !== 'converted').length;
        if (open && !window.confirm(`${open} line(s) still on the cart (not converted). Close the batch anyway?`)) return;
        await updateDoc(doc(db, "conversion_batches", convBatch.id), { status: 'closed', closedAt: Date.now() });
    };

    // Spool a 2"x4" Zebra label for a plating pull (item / qty / work order + WO barcode). Matches the app's
    // existing ZPL-spool pattern (console.log) — no physical printer is wired anywhere in the app yet.
    const printPlatingLabel = ({ erpId, itemName, qty, woNum, platingBin, finishCode, finishName, targetErpId }) => {
        const wo = (woNum || '').trim();
        const name = String(itemName || '').slice(0, 40);
        const fin = (finishCode || '').toUpperCase();
        const finLong = finishName ? `${finishName} (${fin})` : fin;
        const target = targetErpId || (fin ? `${erpId}/${fin}` : erpId);
        // FINISH is the headline — it's what tells the plater what to do.
        const zpl = `^XA
^PW406
^CI28
^FO20,24^A0N,44,44^FDFINISH: ${fin || '—'}^FS
^FO20,76^A0N,26,26^FD${erpId}^FS
^FO20,108^A0N,28,28^FD-> ${target}^FS
^FO20,146^A0N,22,22^FB366,2,0,L^FD${name}^FS
^FO20,196^A0N,30,30^FDQty: ${qty}^FS
^FO20,234^A0N,26,26^FDWO: ${wo || '—'}^FS
^FO20,270^A0N,24,24^FDBin: ${platingBin}^FS
${wo ? `^FO20,308^BY2,2,80^BCN,80,Y,N,N^FD${wo}^FS` : ''}
^XZ`;
        emitLabel(zpl, {
            title: `Plating ${fin || ''}`.trim(), widthIn: 4, heightIn: 2,
            html: `<div class="hdr">PLATING · ${esc(fin || '—')}</div>
<div class="big">${esc(erpId)} → ${esc(target)}</div>
<div class="line">${esc(name)}</div>
<div class="line"><b>Finish:</b> ${esc(finLong || '—')}</div>
<div class="line"><b>Qty:</b> ${esc(qty)}&nbsp;&nbsp;<b>WO:</b> ${esc(wo || '—')}&nbsp;&nbsp;<b>Bin:</b> ${esc(platingBin)}</div>
${wo ? `<div class="bc">${code128BSvg(wo)}<div class="bctxt">${esc(wo)}</div></div>` : ''}`
        });
    };

    // --- NETSUITE PLATING PULL (Phase 2: move raw stock into WIP-Plating status) ---
    // Posts a BIN TRANSFER that moves the qty Good(1)@source bin → WIP-Plating(13)@plating bin in one
    // transaction (from/to bin + from/to status). Unlike an inventory adjustment it creates no GL
    // adjustment records (accounting's request). Net on-hand unchanged; available drops. Logs a staged line.
    const pushPlatingPull = async () => {
        const item = platingBase;
        const qty = parseInt(platingQty) || 0;
        const fromBin = (platingSrcScan || '').trim().toUpperCase();
        const platingBin = (platingDestScan || '').trim().toUpperCase();
        if (!item || qty <= 0 || !fromBin || !platingBin) return;
        if (!item.netSuiteInternalId) return alert(`${item.erpId} has no NetSuite Internal ID — map it first (HQ → ERP Mapping Audit / Mass Update).`);
        if (fromBin === platingBin) return alert("Source and plating bins are the same.");
        const nsConfig = BRAND_NETSUITE_MAP[activeBrand];
        if (!nsConfig) return alert("NetSuite routing configuration missing for this brand.");
        // The plating FINISH is required — it sets the finished assembly (erpId/CODE) that Phase 4b builds back,
        // and it's the line on the label that tells the plater what finish to apply.
        const finish = outsourceFinishes.find(f => f.id === platingFinish);
        if (!finish || !finishCodeOf(finish)) return alert("Select the plating finish — it determines the finished assembly and tells the plater what to apply.");
        const finishCode = finishCodeOf(finish);
        const targetErpId = `${item.erpId}/${finishCode}`; // e.g. H1-138EC/EP1 — the plated assembly built back in Phase 4b
        const finishVendorCrmId = finish.vendorCrmId || '';  // External Coop crm_records id, e.g. "VEND-42036"
        const finishVendorNsId = /^VEND-(\d+)$/.test(finishVendorCrmId) ? finishVendorCrmId.replace('VEND-', '') : ''; // NS internal id
        const memoText = `Pulled to plating (${finishCode}) by ${operator?.name || 'Unknown'}${platingMemo.trim() ? ` — ${platingMemo.trim()}` : ''}`;

        try {
            setIsSyncing(true);
            const goodId = "1";  // "Good" available status (from) — user-confirmed internal id
            const wipId = "13";  // "WIP-Plating" non-available status (to) — user-confirmed internal id
            await ensureBinExists(platingBin, nsConfig.location);
            // Bin Transfer (NOT Inventory Adjustment): moves the qty fromBin→platingBin AND flips status
            // Good→WIP-Plating in one transaction, without posting the inventory-adjustment GL records that
            // accounting flags. Net on-hand unchanged; available drops (WIP-Plating is non-available).
            const payload = {
                targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/binTransfer`,
                method: 'POST',
                payload: {
                    subsidiary: { id: nsConfig.subsidiary },
                    location: { id: nsConfig.location },
                    memo: nsMemo(memoText),
                    inventory: {
                        items: [{
                            item: { id: item.netSuiteInternalId },
                            quantity: qty,
                            inventoryDetail: {
                                quantity: qty,
                                inventoryAssignment: {
                                    items: [{
                                        binNumber: { refName: fromBin },          // FROM BIN
                                        toBinNumber: { refName: platingBin },      // TO BIN
                                        inventoryStatus: { id: goodId },           // FROM STATUS (Good)
                                        toInventoryStatus: { id: wipId },          // TO STATUS (WIP-Plating)
                                        quantity: qty
                                    }]
                                }
                            }
                        }]
                    }
                }
            };

            const response = await nsProxyFetch(payload);
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(typeof result === 'object' ? JSON.stringify(result) : String(result));

            await addDoc(collection(db, "plating_shipments"), {
                brandId: activeBrand, status: 'staged',
                itemId: item.id, netSuiteInternalId: item.netSuiteInternalId, erpId: item.erpId, itemName: item.itemName || '',
                finishCode, finishName: finish.name || '', targetErpId, // plated finish + the assembly Phase 4b builds back
                vendorCrmId: finishVendorCrmId, nsVendorId: finishVendorNsId, vendorName: finish.vendor || '', // NS-synced plater from the finish
                qty, fromBin, platingBin, woNum: (platingWO || '').trim(), operator: operator?.name || 'Unknown', createdAt: serverTimestamp(),
                ...(platingDemandLink || {}),
            }).catch(err => console.warn("plating_shipments log failed (is the firestore rule published?)", err)); // non-fatal: the NetSuite move already succeeded

            printPlatingLabel({ erpId: item.erpId, itemName: item.itemName, qty, woNum: platingWO, platingBin, finishCode, finishName: finish.name || '', targetErpId });
            alert(`✅ Pulled ${qty} × ${item.erpId} to plating WIP (${finishCode} → ${targetErpId}) — moved ${fromBin} → ${platingBin}, status WIP-Plating. Removed from Available.\n\n🖨️ 2×4 plating label spooled${(platingWO || '').trim() ? ` (WO ${(platingWO || '').trim()})` : ''}.`);
            writeLog(`Plating pull: ${qty} ${item.erpId} ${fromBin} -> ${platingBin} (WIP-Plating).${platingMemo.trim() ? ` Memo: ${platingMemo.trim()}` : ''}`, 'wms');
            // If this pull fulfilled a "Needs Plating" demand, clear it off the queue.
            if (platingDemandId) { await deleteDoc(doc(db, "plating_demand", platingDemandId)).catch(() => {}); }
            setPlatingBase(null); setPlatingSrcScan(""); setPlatingQty(""); setPlatingDestScan(""); setPlatingMemo(""); setPlatingWO(""); setPlatingFinish(""); setPlatingDemandId(null); setPlatingDemandLink(null);
            pullNetSuiteStock();
        } catch (e) {
            console.error("Plating bin-transfer push failed:", e);
            alert("❌ NetSuite rejected the plating pull:\n\n" + (e.message || e) + "\n\nThis posts a Bin Transfer (Good→WIP-Plating, fromBin→platingBin) — if it names a field (toBinNumber / toInventoryStatus / inventoryDetail), paste it and I'll correct the REST shape.");
        } finally {
            setIsSyncing(false);
        }
    };

    // Spool a pallet/shipment label for the weekly plating shipment (ship id + vendor + finish + pcs + total + barcode).
    const printShipmentLabel = ({ shipId, vendor, pcs, lineCount, total, finishes }) => {
        const fin = (finishes || '').toUpperCase();
        const zpl = `^XA
^PW812
^CI28
^FO40,36^A0N,50,50^FDPLATING SHIPMENT^FS
^FO40,98^A0N,34,34^FD${vendor}^FS
${fin ? `^FO40,144^A0N,32,32^FDFinish: ${fin}^FS` : ''}
^FO40,188^A0N,28,28^FDShip ID: ${shipId}^FS
^FO40,228^A0N,28,28^FDLines: ${lineCount}    Pcs: ${pcs}    Plating $: ${total.toFixed(2)}^FS
^FO40,288^BY3,2,110^BCN,110,Y,N,N^FD${shipId}^FS
^XZ`;
        emitLabel(zpl, {
            title: 'Plating Shipment', widthIn: 4, heightIn: 2,
            html: `<div class="hdr">PLATING SHIPMENT</div>
<div class="big">${esc(vendor)}</div>
${fin ? `<div class="line"><b>Finish:</b> ${esc(fin)}</div>` : ''}
<div class="line">Ship ID: ${esc(shipId)}</div>
<div class="line"><b>Lines:</b> ${esc(lineCount)}&nbsp;&nbsp;<b>Pcs:</b> ${esc(pcs)}&nbsp;&nbsp;<b>$:</b> ${esc(Number(total).toFixed(2))}</div>
<div class="bc">${code128BSvg(shipId)}<div class="bctxt">${esc(shipId)}</div></div>`
        });
    };

    // --- PHASE 3: SHIP THE WEEKLY PLATING PALLET ---
    // Bundles the staged plating lines into a shipment: a NetSuite PO to the plater (vendor 83361) with one
    // summary "Weekly Plating Shipment" service line (item 61947) at the total plating cost, a detailed app-side
    // PO (hq_purchase_orders) for the plater, a pallet label, then flips the staged lines to 'shipped'.
    const pushPlatingShipment = async () => {
        const lines = platingStaged;
        if (!lines.length) return alert("No staged plating lines to ship.");
        const nsConfig = BRAND_NETSUITE_MAP[activeBrand];
        if (!nsConfig) return alert("NetSuite routing configuration missing for this brand.");
        // plating $/unit = the PLATING FEE for the item's product type (HQ Admin → Plating Fees), kept
        // separate from the NetSuite assembly cost. Per-piece for most types; poles are priced per foot
        // and their qty is already in feet, so cost = fee × qty either way. Manual ship-modal override wins.
        const rateOf = (l) => {
            const v = shipCosts[l.id];
            if (v !== undefined) return parseFloat(v) || 0;
            const pt = String(hqParts.find(p => p.id === l.itemId)?.manufacturingSpecs?.productType || '').toUpperCase();
            return parseFloat(platingFees[pt]?.fee) || 0;
        };
        const total = lines.reduce((s, l) => s + rateOf(l) * (parseInt(l.qty) || 0), 0);
        const pcs = lines.reduce((s, l) => s + (parseInt(l.qty) || 0), 0);
        // ZERO-RATE GUARD (Eric 2026-08-13: the screw plating service rode the EP11 PO at $0 —
        // its product type has no rule in HQ Admin → Plating Fees and no per-line $ was typed).
        // A $0 plating line is never right: name each one and stop, instead of posting a PO the
        // vendor bill can't reconcile.
        const zeroRated = lines.filter(l => (parseInt(l.qty) || 0) > 0 && rateOf(l) === 0);
        if (zeroRated.length && !window.confirm(`⚠ ${zeroRated.length} line(s) carry a $0 plating rate:\n\n${zeroRated.map(l => { const pt = String(hqParts.find(p => p.id === l.itemId)?.manufacturingSpecs?.productType || '(no product type)').toUpperCase(); return `• ${l.erpId} — product type ${pt}: no Plating Fees rule, no per-line $ typed`; }).join('\n')}\n\nFix: type the $/ea on the line, or add the product type's rate in HQ Admin (tab 11) → Plating Fees — then ship.\n\nShip at $0 anyway?`)) return;
        const shipId = `PLT-${activeBrand.toUpperCase()}-${Date.now()}`;
        // Vendor = the plater carried on each line from its finish (vendorCrmId "VEND-{id}" → nsVendorId). A weekly
        // shipment is per-vendor; if lines mix vendors, ship them separately so each gets its own PO.
        const vendorIds = [...new Set(lines.map(l => l.nsVendorId).filter(Boolean))];
        if (vendorIds.length > 1) return alert(`These staged lines have different plating vendors (${vendorIds.join(', ')}). Ship one vendor at a time so each gets its own PO.`);
        const nsVendorId = vendorIds[0] || "42036"; // resolved plater internal id, else default Dayton Grey
        const vendorName = lines.find(l => l.vendorName)?.vendorName || "Dayton Grey";
        const finishSummary = [...new Set(lines.map(l => l.finishCode).filter(Boolean))].join(', ');
        try {
            setIsSyncing(true);
            // 1) NetSuite PO to the plater — ALL-OR-NOTHING. If the PO doesn't post we throw and abort BEFORE
            // creating the shipment, so there are never orphaned shipments without a PO.
            // entity MUST be the vendor's INTERNAL id (42036), NOT the vendor number/entityid (83361). Sending the
            // entityid left the entity unresolved, so subsidiary validation fell back to user context and rejected 2
            // ("Invalid Field Value 2 for subsidiary"). With the real internal id the vendor resolves to subsidiary 2
            // (CE), so subsidiary 2 + location 17 (High Point - CE, also sub 2) are valid. customForm 272 matches the
            // working manual PO. Item 61947 IS already the internal id of "Weekly Plating Shipment" (Service).
            // The single summary line carries the actual plated parts as a TEXT reference in its description (like the
            // CPQ push) so the PO itself shows what's on the pallet — item, qty, finish/WO — without separate item lines.
            const detailLines = lines.map(l => {
                const wo = l.woNum ? ` · WO# ${l.woNum}` : '';
                const tgt = l.targetErpId ? ` → ${l.targetErpId}` : '';
                const finx = l.finishCode ? ` · FINISH ${l.finishCode}` : '';
                return `• ${l.itemName || 'Item'} [${l.erpId || ''}${tgt}]${finx} — qty ${parseInt(l.qty) || 0}${wo}`;
            });
            // NetSuite caps a transaction line `description` at 4000 chars. Keep the header + as many
            // detail lines as fit, and point to the printed packing list for the rest (it has them all).
            const descHeader = `Weekly Plating Shipment (${shipId})${finishSummary ? ` — finish ${finishSummary}` : ''} — ${lines.length} item${lines.length === 1 ? '' : 's'}, ${pcs} pcs:`;
            let descBody = '', shownLines = 0;
            for (const dl of detailLines) {
                if (descHeader.length + descBody.length + dl.length + 2 > 3850) break;
                descBody += `\n${dl}`; shownLines++;
            }
            const lineDescription = descHeader + descBody + (shownLines < detailLines.length ? `\n…+${detailLines.length - shownLines} more line${detailLines.length - shownLines === 1 ? '' : 's'} — see packing list ${shipId}` : '');
            const payload = {
                targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/purchaseorder`,
                method: 'POST',
                payload: {
                    customForm: { id: "272" }, // "LG - Purchase Order Form" (matches the working manual PO)
                    entity: { id: nsVendorId }, // plater INTERNAL id from the finish's NS-synced vendor (NOT the entityid/vendor#); default 42036 (Dayton Grey)
                    // SUBSIDIARY IS EXPLICIT, AND MUST PRECEDE LOCATION (Eric, 2026-08-15). Omitting it
                    // worked here only by luck: Dayton Grey's primary subsidiary happens to BE CE (2),
                    // which matches location 17. Any plater whose primary sits in another subsidiary —
                    // or any M2C plating run — hit "Invalid Field Value <loc> for the following field:
                    // location", because setting the entity defaults the subsidiary to the VENDOR's,
                    // and the location then belongs to the wrong one.
                    ...(nsConfig.subsidiary
                        ? { subsidiary: { id: String(nsConfig.subsidiary) }, location: { id: String(nsConfig.location) } }
                        : {}),
                    memo: nsMemo(`Weekly Plating Shipment ${shipId}`),
                    item: { items: [{ item: { id: "61947" }, quantity: 1, rate: Number(total.toFixed(2)), description: lineDescription }] }
                }
            };
            const response = await nsProxyFetch(payload);
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(typeof result === 'object' ? JSON.stringify(result) : String(result));
            // NetSuite record POSTs return 204 with the new internal id ONLY in the Location header (which the proxy
            // doesn't forward), so result.id is usually empty. Recover the PO's internal id via SuiteQL by its unique
            // memo (shipId) — Phase 4a receive needs this id to transform the PO into an item receipt.
            let nsPoId = result.id ? String(result.id) : null;
            let nsPoTran = result.tranId || null; // human-readable PO number, e.g. "PO2179"
            if (!nsPoId || !nsPoTran) {
                try {
                    const lookup = await nsProxyFetch({
                        targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`,
                        method: 'POST',
                        payload: { q: `SELECT id, tranid FROM transaction WHERE type = 'PurchOrd' AND UPPER(memo) LIKE '%${shipId.toUpperCase()}%'` }
                    });
                    const lr = await lookup.json().catch(() => ({}));
                    if (lr.items && lr.items[0]) {
                        if (lr.items[0].id) nsPoId = String(lr.items[0].id);
                        if (lr.items[0].tranid) nsPoTran = String(lr.items[0].tranid);
                    }
                } catch (lookupErr) { console.warn("PO id lookup failed (PO still created):", lookupErr); }
            }
            const nsPoLabel = nsPoTran || nsPoId || '(pending sync)';

            // 2) Detailed app-side PO for the plater (only reached after the NS PO succeeded). Store a
            // self-contained `packingList` snapshot + vendorCrmId + expectedReceiveDate so the vendor
            // screen (External Co-Op) can list it, reprint the exact packing list, and track the ETA.
            const packingList = {
                shipId, brand: activeBrand, vendor: vendorName, poLabel: nsPoLabel,
                dateStr: new Date().toLocaleDateString(), operator: operator?.name || 'Unknown',
                lines: lines.map(l => ({ erpId: l.erpId || '', itemName: l.itemName || '', finishCode: l.finishCode || '', targetErpId: l.targetErpId || '', platingBin: l.platingBin || '', woNum: l.woNum || '', qty: parseInt(l.qty) || 0, rate: rateOf(l) })),
                pcs, total: Number(total.toFixed(2)), finishSummary
            };
            await addDoc(collection(db, "hq_purchase_orders"), {
                poId: shipId, brand: activeBrand, vendor: vendorName, nsVendorId, vendorCrmId: `VEND-${nsVendorId}`,
                status: "Sent to Plater", kind: "plating", finishSummary, expectedReceiveDate: null,
                nsPoId, nsPoTran, shipmentId: shipId,
                items: lines.map(l => ({ itemId: l.erpId, description: l.itemName, finishCode: l.finishCode || '', targetErpId: l.targetErpId || '', quantity: parseInt(l.qty) || 0, rate: rateOf(l), woNum: l.woNum || '', platingBin: l.platingBin })),
                packingList,
                total: Number(total.toFixed(2)), pcs, createdBy: operator?.name || 'Unknown', createdAt: serverTimestamp()
            }).catch(err => console.warn("app PO log failed", err));

            // 3) Flip the staged lines to 'shipped' (Phase 4 receives against this shipment).
            await Promise.all(lines.map(l => updateDoc(doc(db, "plating_shipments", l.id), {
                status: 'shipped', shipmentId: shipId, nsPoId, nsPoTran, platingRate: rateOf(l), shippedAt: serverTimestamp()
            }).catch(() => {})));

            // 4) Pallet/shipment label (Zebra) + an 8.5×11 laser packing list for the plater.
            printShipmentLabel({ shipId, vendor: vendorName, pcs, lineCount: lines.length, total, finishes: finishSummary });
            printPlatingPackingList(packingList);

            alert(`✅ Plating shipment ${shipId} created — NetSuite ${nsPoLabel} ("Weekly Plating Shipment" $${total.toFixed(2)}), ${lines.length} line${lines.length === 1 ? '' : 's'} / ${pcs} pcs shipped, label spooled.`);
            writeLog(`Plating shipment ${shipId}: NS PO ${nsPoLabel}, $${total.toFixed(2)}, ${lines.length} lines / ${pcs} pcs.`, 'wms');
            setShipCosts({}); setShowShipModal(false);
            pullNetSuiteStock();
        } catch (e) {
            console.error("Plating shipment push failed:", e);
            alert("❌ NetSuite rejected the plating PO — shipment NOT created, nothing changed (fix + retry):\n\n" + (e.message || e));
        } finally {
            setIsSyncing(false);
        }
    };

    // --- PHASE 4a: RECEIVE THE RETURNED PLATING PALLET (item receipt against the plater PO) ---
    // Transforms the plater PO into an Item Receipt in NetSuite (receives the "Weekly Plating Shipment" service
    // line → enables the vendor bill), then flips the shipment's lines to 'received' (ready for build-back).
    const pushPlatingReceive = async (shipmentId, nsPoId, lineIds) => {
        if (!shipmentId) return;
        if (!nsPoId) return alert("This shipment has no NetSuite PO id on file — can't create the item receipt. (Was the PO created in Phase 3?)");
        try {
            setIsSyncing(true);
            // ── THE RECEIPT RIDES THE OUTBOX (Brief D · D5; Stuart 2026-09-03: "receive and
            // build-back move to the queue while the pull stays immediate") ────────────────────
            // The pull stays synchronous because Sandra is standing at the bin and needs
            // NetSuite's answer before she stages the part. A RECEIPT is not like that — nobody
            // waits on it — and putting it on the one write path buys the guards every other write
            // already has: a DETERMINISTIC id, so a double-tap cannot post two receipts against
            // one plater PO; marker recovery, so a retry after a crash finds the posted copy
            // instead of duplicating it; retries with backoff; and a row in 11.1 with the real
            // error rather than an alert nobody kept.
            // enqueueNsWrite mints its own entry id, so the guard here is the DEDUPE KEY: a second
            // Receive is refused while one is still PENDING/POSTING. Once it has posted the lines
            // are 'received' and leave this list, so the button is gone.
            const obId = `platercv-${String(shipmentId).replace(/[^A-Za-z0-9_-]/g, '_')}`;
            await enqueueNsWrite({
                dedupeKey: obId,
                kind: 'itemreceipt',
                label: `Plating receipt — ${shipmentId} (PO ${nsPoId})`,
                sourceApp: 'WMS', createdBy: operator?.name || '',
                targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/purchaseorder/${nsPoId}/!transform/itemreceipt`,
                method: 'POST',
                payload: { memo: nsMemo(`Plating return received ${shipmentId}`) },
                writeBack: (lineIds || []).map(id => ({ collection: 'plating_shipments', docId: id, patch: { itemReceiptPosted: true }, idField: 'itemReceiptId' })),
            });
            const receiptId = null;   // it lands via writeBack when the worker posts it (~1 min)

            await Promise.all((lineIds || []).map(id => updateDoc(doc(db, "plating_shipments", id), {
                status: 'received', itemReceiptId: receiptId, receivedAt: serverTimestamp(), receivedAtMs: Date.now()
            }).catch(() => {})));
            // ── THE RECEIPT TELLS THE ORDER (Brief D · D1) ────────────────────────────────────
            // Until now the pallet came back and the ORDER heard nothing: no sibling, no board,
            // no chip. A custom order sat reading "At the plater" with no way to learn otherwise.
            // The pieces are physically here now — not yet built back, not yet packable — and that
            // is its own state, so the board can show a pallet that landed days ago and was never
            // built back. 'Plated' comes later, at put-away.
            for (const id of (lineIds || [])) {
                const ln = platingShipped.find(l => l.id === id) || platingReceived.find(l => l.id === id);
                if (!ln || !ln.finSiblingId) continue;
                try {
                    await propagateFloorState({ db, doc, getDoc, getDocs, query, collection, where, updateDoc },
                        { finWo: { id: ln.finSiblingId, salesOrderId: ln.soAppId || null, orderKey: ln.orderKey || null }, phase: 'Plating Received', by: operator?.name || '' });
                } catch (e) { console.warn('RTG propagate failed (the receipt stands):', e); }
            }

            alert(`✅ Plating shipment ${shipmentId} received — lines are ready for build-back now.\n\n📤 The NetSuite item receipt is QUEUED (PO ${nsPoId}) and posts within about a minute; watch it in HQ 11.1 → NetSuite Sync Queue. A second Receive while it is in flight is refused.`);
            writeLog(`Plating receive: shipment ${shipmentId} queued as item receipt against PO ${nsPoId}.`, 'wms');
        } catch (e) {
            console.error("Plating receive (item receipt) failed:", e);
            alert("❌ Could not QUEUE the item receipt:\n\n" + (e.message || e) + "\n\nNothing was posted. If it says 'already queued', the receipt is already on its way — check 11.1 rather than retrying.");
        } finally {
            setIsSyncing(false);
        }
    };

    // Re-stage a stuck/erroneous plating shipment: lines go back to 'staged' (reappear in the staged box, ready
    // to re-ship) + remove the orphaned app PO doc. Does NOT touch the WIP-Plating inventory (that move stays).
    const resetPlatingShipment = async (shipmentId, lineIds) => {
        if (!shipmentId) return;
        const role = String(operator?.role || '').toLowerCase().replace(/[^a-z]/g, '');
        if (!(operator?.superAdmin === true || role === 'admin' || role === 'superadmin')) return alert("⚠️ Reset is restricted to Admin or higher.");
        if (!window.confirm(`⚠️ RESET shipment ${shipmentId}?\n\nIts line(s) go back to "staged" so they can be re-shipped. (The WIP-Plating inventory move stays as-is.)\n\nAre you sure?`)) return;
        try {
            setIsSyncing(true);
            await Promise.all((lineIds || []).map(id => updateDoc(doc(db, "plating_shipments", id), {
                status: 'staged', shipmentId: null, nsPoId: null, platingRate: null, shippedAt: null
            }).catch(() => {})));
            const poSnap = await getDocs(query(collection(db, "hq_purchase_orders"), where("poId", "==", shipmentId)));
            await Promise.all(poSnap.docs.map(d => hardDeleteWithLedger({ db, doc, setDoc, deleteDoc }, {
                collection: 'hq_purchase_orders', docId: d.id, record: d.data(), kind: 'hq_purchase_orders',
                by: operator?.name || '', from: 'WMS', reason: `plating shipment ${shipmentId} reset`,
            }).catch(() => {})));
            alert(`✅ Shipment ${shipmentId} reset — its line(s) are back in "staged". Re-run Ship Pallet to test the PO.`);
            writeLog(`Plating shipment ${shipmentId} reset to staged.`, 'wms');
        } catch (e) {
            console.error("Plating shipment reset failed:", e);
            alert("Couldn't reset the shipment: " + (e.message || e));
        } finally {
            setIsSyncing(false);
        }
    };

    // Reverse a plating line's Phase-2 status move: WIP-Plating(13)@platingBin → Good(1)@fromBin. Shared by
    // build-back (Phase 4b) and cancel-pull. Same status-aware adjustment the pull used, with signs flipped.
    // qtyOverride (2026-09-03): a short return reverses only the pieces that came BACK; the
    // missing ones are scrapped out of WIP-Plating separately. Omitted = the whole line, which is
    // what cancel-pull has always done.
    const reversePlatingWip = async (line, nsConfig, memo, qtyOverride) => {
        const qty = qtyOverride != null ? (parseInt(qtyOverride) || 0) : (parseInt(line.qty) || 0);
        const payload = {
            targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/inventoryadjustment`,
            method: 'POST',
            payload: {
                account: { id: "254" },
                subsidiary: { id: nsConfig.subsidiary },
                memo,
                inventory: { items: [
                    { item: { id: line.netSuiteInternalId }, location: { id: nsConfig.location }, adjustQtyBy: -qty,
                      inventoryDetail: { quantity: -qty, inventoryAssignment: { items: [{ binNumber: { refName: line.platingBin }, inventoryStatus: { id: "13" }, quantity: -qty }] } } },
                    { item: { id: line.netSuiteInternalId }, location: { id: nsConfig.location }, adjustQtyBy: qty,
                      inventoryDetail: { quantity: qty, inventoryAssignment: { items: [{ binNumber: { refName: line.fromBin }, inventoryStatus: { id: "1" }, quantity: qty }] } } }
                ] }
            }
        };
        const r = await nsProxyFetch(payload);
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error("Status reversal (WIP-Plating → Good) failed: " + (typeof b === 'object' ? JSON.stringify(b) : String(b)));
    };

    // Cancel a STAGED plating pull (e.g. pulled before finish-assignment existed): reverse the WIP-Plating → Good
    // move so the stock is Available again, then delete the staged line. The operator then re-pulls with a finish.
    const cancelPlatingPull = async (line) => {
        if (!line) return;
        const qty = parseInt(line.qty) || 0;
        const nsConfig = BRAND_NETSUITE_MAP[activeBrand];
        if (!nsConfig) return alert("NetSuite routing configuration missing for this brand.");
        if (!window.confirm(`Cancel the pull of ${qty} × ${line.erpId}?\n\nReturns it to Good (WIP-Plating @ ${line.platingBin} → ${line.fromBin}) and removes the staged line so you can re-pull with a finish.`)) return;
        try {
            setIsSyncing(true);
            if (line.netSuiteInternalId && line.platingBin && line.fromBin && qty > 0) {
                await reversePlatingWip(line, nsConfig, `Cancel plating pull ${line.erpId} — return to Good`);
            }
            await hardDeleteWithLedger({ db, doc, setDoc, deleteDoc }, {
                collection: 'plating_shipments', docId: line.id, record: line, kind: 'plating_shipments',
                by: operator?.name || '', from: 'WMS', reason: 'plating pull canceled — returned to Good',
            });
            alert(`✅ Pull canceled — ${qty} × ${line.erpId} returned to Good and the staged line removed. Re-pull it with a finish.`);
            writeLog(`Plating pull canceled: ${qty} ${line.erpId} (WIP-Plating → Good, staged line deleted).`, 'wms');
            pullNetSuiteStock();
        } catch (e) {
            console.error("Plating pull cancel failed:", e);
            alert("❌ Couldn't cancel the pull:\n\n" + (e.message || e) + "\n\n(The staged line was NOT deleted — fix and retry.)");
        } finally {
            setIsSyncing(false);
        }
    };

    // ══ THE RECEIVING STATION (Stuart 2026-09-03) ═══════════════════════════════════════════════
    // He was receiving PLT-CE-1782150374239 at the dock and every build refused:
    //   "Please configure the inventory detail for the assembly item."
    // The plated assemblies are BIN-MANAGED, and the old build sent a bin only if the LIBRARY
    // happened to carry one for `H1-138BS/EP1` — most carry none, so the payload had no inventory
    // detail and NetSuite rejected it. Guessing a bin from a library record is the same mistake
    // the stock build already stopped making (Stuart 2026-08-03: the build waits for the bin the
    // packer actually scanned). So the bin is now CAPTURED PHYSICALLY, and the build posts with it:
    //
    //   scan to find  →  receive to a CART (qty off the pallet)  →  save the cart
    //                 →  put away from the cart: scan item, scan BIN  →  the build posts
    //
    // A cart is a grouping on the shipment lines (cartId / cartLabel / cartStatus), not a new
    // collection — one source of truth, no rules change. Several carts per PO.
    // SHORT RETURNS (Stuart: "yes, scrape"): fewer pieces back than went out. The reversal and the
    // build cover what CAME BACK; the difference is scrapped out of WIP-Plating, guarded, logged.
    const platingCodesOf = (l) => [l.erpId, l.targetErpId, l.finishCode ? `${l.erpId}/${l.finishCode}` : '']
        .map(c => String(c || '').toUpperCase().trim()).filter(Boolean);
    const findPlatingLine = (code, lines) => {
        const c = String(code || '').toUpperCase().trim();
        if (!c) return null;
        return lines.find(l => platingCodesOf(l).includes(c))
            || lines.find(l => platingCodesOf(l).some(x => x.startsWith(c))) || null;
    };
    // Carts, derived from the lines themselves.
    const cartsOfLines = (lines) => {
        const m = {};
        lines.filter(l => l.cartId).forEach(l => {
            (m[l.cartId] = m[l.cartId] || { cartId: l.cartId, label: l.cartLabel || l.cartId, status: l.cartStatus || 'open', lines: [] }).lines.push(l);
        });
        return Object.values(m);
    };
    const nextCartFor = (shipmentId, lines) => {
        const used = new Set(lines.filter(l => l.cartId).map(l => l.cartId));
        let n = 1; while (used.has(`CART-${shipmentId}-${n}`)) n += 1;
        return { cartId: `CART-${shipmentId}-${n}`, cartLabel: `Cart ${n}` };
    };
    const receiveToCart = async (line, shipLines) => {
        const sent = parseInt(line.qty) || 0;
        const got = parseInt(cartQty[line.id] != null && cartQty[line.id] !== '' ? cartQty[line.id] : sent) || 0;
        if (got <= 0) return alert('Enter how many good pieces came back on the pallet.');
        if (got > sent) return alert(`${sent} pcs went out — you cannot receive ${got}. Receive ${sent} or fewer; a plater never returns more than was sent.`);
        const shipmentId = line.shipmentId || line.id;
        const open = cartsOfLines(shipLines).find(c => c.status === 'open');
        const cart = open ? { cartId: open.cartId, cartLabel: open.label } : nextCartFor(shipmentId, shipLines);
        const scrap = sent - got;
        try {
            await updateDoc(doc(db, 'plating_shipments', line.id), {
                cartId: cart.cartId, cartLabel: cart.cartLabel, cartStatus: 'open',
                receivedQty: got, scrapQty: scrap,
                receivedToCartAt: Date.now(), receivedToCartBy: operator?.name || '',
            });
            writeLog(`Plating receive: ${got}/${sent} × ${line.targetErpId || line.erpId} onto ${cart.cartLabel} (${shipmentId})${scrap > 0 ? ` — ${scrap} SHORT, to be scrapped at put-away` : ''}.`, 'wms');
            setCartQty(p => ({ ...p, [line.id]: '' }));
            setPlatingFocusId(null); setPlatingScan('');
        } catch (e) { alert('Could not add it to the cart: ' + (e.message || e)); }
    };
    const removeFromCart = async (line) => {
        try {
            await updateDoc(doc(db, 'plating_shipments', line.id), { cartId: null, cartLabel: null, cartStatus: null, receivedQty: null, scrapQty: null });
            writeLog(`Plating receive: ${line.targetErpId || line.erpId} taken back off ${line.cartLabel || 'the cart'}.`, 'wms');
        } catch (e) { alert('Could not take it off the cart: ' + (e.message || e)); }
    };
    const saveCart = async (cart) => {
        if (!cart || !cart.lines.length) return;
        const pcs = cart.lines.reduce((a, l) => a + (parseInt(l.receivedQty) || 0), 0);
        if (!window.confirm(`Save ${cart.label}?\n\n${cart.lines.length} line(s) · ${pcs} pcs.\n\nIt closes for receiving and becomes available to put away. Nothing is posted to NetSuite yet — that happens when you scan the bin.`)) return;
        try {
            await Promise.all(cart.lines.map(l => updateDoc(doc(db, 'plating_shipments', l.id), { cartStatus: 'saved', cartSavedAt: Date.now(), cartSavedBy: operator?.name || '' })));
            writeLog(`Plating receive: ${cart.label} saved — ${cart.lines.length} line(s) / ${pcs} pcs, ready to put away.`, 'wms');
            setOpenCartPanel(cart.cartId);
        } catch (e) { alert('Could not save the cart: ' + (e.message || e)); }
    };
    // Is that a real bin here? Same question the pack put-away asks, same helpers, same rule: a
    // validator refuses only on COMPLETE knowledge, and warns otherwise.
    const platingBinCheck = async (bin) => {
        const { list: known, complete } = await loadBinIndex();
        if (!known.length || known.includes(bin)) return { ok: true };
        const near = nearestBins(bin, known);
        const elsewhere = await lookupBinAnywhere(bin);
        const where = elsewhere.length ? `\n\nNetSuite has a bin by that name at: ${elsewhere.join(', ')} — not at this brand's location.` : '';
        const msg = `"${bin}" is not a bin at this location.${where}\n\n${near.length ? `Did you mean:\n${near.map(b => `   ${b}`).join('\n')}` : 'Scan the bin label rather than typing it.'}`;
        if (complete && !elsewhere.length) return { ok: false, hard: true, msg: `${msg}\n\nNothing was posted — NetSuite rejects an unknown bin and the build would be lost.` };
        return { ok: window.confirm(`${msg}\n\n(The bin list here may be incomplete, so this is a warning, not a refusal.)\n\nPut away to "${bin}" anyway?`) };
    };
    // PUT AWAY = the whole NetSuite close for one line, in order, each step guarded:
    //   1 reversal  WIP-Plating → Good, for the pieces that came back
    //   2 scrap     the pieces that did not come back, out of WIP-Plating   (only when short)
    //   3 build     the plated assembly, INTO THE SCANNED BIN(S)
    // (The build is also the seam where the receipt will later tell the order it is ready to pack.)
    const putAwayFromCart = async (line, placements) => {
        const got = parseInt(line.receivedQty) || 0;
        const scrap = parseInt(line.scrapQty) || 0;
        const target = line.targetErpId || (line.finishCode ? `${line.erpId}/${String(line.finishCode).toUpperCase()}` : '');
        if (!target) return alert('This line has no plated finish/target assembly — reset and re-pull it with a finish.');
        if (got <= 0) return alert('This line has no received quantity — receive it to a cart first.');
        const nsConfig = BRAND_NETSUITE_MAP[activeBrand];
        if (!nsConfig) return alert('NetSuite routing configuration missing for this brand.');
        const bins = placements.map(p => ({ bin: normalizeBin(p.bin), qty: parseInt(p.qty) || 0 })).filter(p => p.bin);
        if (!bins.length) return alert('Scan the bin the pieces were placed in.');
        const placed = bins.reduce((a, p) => a + p.qty, 0);
        if (placed !== got) return alert(`The bins add up to ${placed}, but ${got} pcs were received. They must match — every piece has to be somewhere.`);
        // One row per bin: the retry guard below skips bins already built, so the same bin twice
        // would be ambiguous. Combine them instead.
        if (new Set(bins.map(p => p.bin)).size !== bins.length) return alert('The same bin is listed twice. Put the whole quantity for a bin on one row.');
        for (const p of bins) {
            const chk = await platingBinCheck(p.bin);
            if (!chk.ok) return alert(chk.hard ? chk.msg : 'Nothing was posted.');
        }
        if (!window.confirm(`Put away ${got} × ${target}?\n\n${bins.map(p => `   ${p.qty} → ${p.bin}`).join('\n')}${scrap > 0 ? `\n\n⚠ ${scrap} pc(s) did NOT come back and will be SCRAPPED out of WIP-Plating.` : ''}\n\nThis posts to NetSuite: the plated raw returns to Good${scrap > 0 ? ', the short pieces are adjusted out' : ''}, and the finished assembly is built into the bin(s) above.`)) return;
        try {
            setIsSyncing(true);
            // 1 — reverse only what came back.
            if (!line.wipReversed) {
                await reversePlatingWip(line, nsConfig, `Plating return → Good (${line.finishCode || ''}) ${line.erpId}`, got);
                await updateDoc(doc(db, 'plating_shipments', line.id), { wipReversed: true, wipReversedQty: got }).catch(() => {});
            }
            // 2 — the pieces that never came back leave WIP-Plating. Guarded: never scrapped twice.
            if (scrap > 0 && !line.scrapPosted) {
                const sp = {
                    targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/inventoryadjustment',
                    method: 'POST',
                    payload: {
                        account: { id: '254' }, subsidiary: { id: nsConfig.subsidiary },
                        memo: nsMemo(`Plating short ${line.erpId} ×${scrap}`),
                        inventory: { items: [{ item: { id: line.netSuiteInternalId }, location: { id: nsConfig.location }, adjustQtyBy: -scrap,
                            inventoryDetail: { quantity: -scrap, inventoryAssignment: { items: [{ binNumber: { refName: line.platingBin }, inventoryStatus: { id: '13' }, quantity: -scrap }] } } }] }
                    }
                };
                const sr = await nsProxyFetch(sp);
                const sb = await sr.json().catch(() => ({}));
                if (!sr.ok) throw new Error('Short-piece scrap failed: ' + (typeof sb === 'object' ? JSON.stringify(sb) : String(sb)));
                // Stays synchronous ON PURPOSE: it runs between the reversal and the build, and the
                // build must not go out if the scrap failed — the quantities would not agree.
                await updateDoc(doc(db, 'plating_shipments', line.id), { scrapPosted: true, scrapPostedAt: Date.now() }).catch(() => {});
                writeLog(`Plating short: ${scrap} × ${line.erpId} scrapped out of WIP-Plating @ ${line.platingBin} (${line.shipmentId || line.id}).`, 'wms');
            }
            // 3 — the build, THROUGH THE CONVERT RESTLET (Stuart 2026-09-03, second attempt).
            // Putting the scanned bin on the build header got past the first refusal and straight
            // into the next one: "configure the inventory detail in line 1 of the component list".
            // The plain REST record API cannot set the consume-from bin on the COMPONENT sublist —
            // it is static and unpopulated at create time. That is the entire reason the /P convert
            // runs through the RESTlet, which lets NetSuite source the BOM and then sets
            // componentinventorydetail on every bin-tracked component. The plated build-back is the
            // same shape: consume the raw from `fromBin` (where step 1 just returned it to Good),
            // receive the finished assembly into the bin that was SCANNED.
            const assembly = await resolveItemDetail(target);
            if (!assembly) throw new Error(`Couldn't find ${target} in NetSuite by item id. Confirm the plated assembly exists with ${line.erpId} as a BOM component.`);
            if (assembly.type && !/assembl/i.test(assembly.type)) throw new Error(`${target} is type "${assembly.type}" in NetSuite, not an Assembly.`);
            // The RESTlet receives into ONE bin, so a split posts one build per bin. Each build is
            // recorded the moment it lands, so a failure part-way through can never rebuild a bin
            // that already went in.
            const already = Array.isArray(line.builtPlacements) ? line.builtPlacements : [];
            const placements = [...already];
            for (const p of bins) {
                if (already.some(d => String(d.bin || '').toUpperCase() === p.bin)) continue;
                const res = await postConvertBuild({
                    itemId: String(assembly.id), quantity: p.qty,
                    subsidiary: nsConfig.subsidiary, location: nsConfig.location,
                    bin: line.fromBin, toBin: p.bin,
                    memo: nsMemo(`Plating back ${target} ${p.qty}@${p.bin}`),
                });
                placements.push({ bin: p.bin, qty: p.qty, nsId: res && res.id ? String(res.id) : null });
                await updateDoc(doc(db, 'plating_shipments', line.id), { builtPlacements: placements }).catch(() => {});
            }
            await updateDoc(doc(db, 'plating_shipments', line.id), {
                status: 'built', builtAt: serverTimestamp(), builtAssemblyId: (placements[0] && placements[0].nsId) || null,
                binPlacements: bins, putAwayAt: Date.now(), putAwayBy: operator?.name || '',
            }).catch(() => {});
            writeLog(`Plating put-away: ${got} × ${target} built into ${bins.map(p => `${p.qty}@${p.bin}`).join(' + ')} by ${operator?.name || 'Unknown'} (${line.cartLabel || 'cart'}, ${line.shipmentId || line.id}).`, 'wms');
            // PLATING IS THE HANDLER TO SO PACK FOR PLATED ITEMS (Stuart 2026-09-03). If these
            // pieces were plated FOR an order, they do not belong on the open shelf — they belong
            // in that order's committed bin, with the rest of its parts. Anything without an order
            // is ordinary stock and simply stays where it was put.
            // ── THE BUILD-BACK OPENS THE PACK GATE (Brief D · D1) ─────────────────────────────
            // C1 (334c9c3) made the shop stop lying: a plated custom part now mirrors 'Sent to
            // Plating' rather than 'Complete', so the pack gate correctly refuses while the pieces
            // are at the plater. NOTHING re-opened it — this is that half. The plated assembly
            // exists as of the build above, so the custom half IS complete, and the order can pack.
            if (line.finSiblingId) {
                try {
                    await mirrorCustomStatusToSibling({ finSiblingId: line.finSiblingId }, 'Complete');
                    await propagateFloorState({ db, doc, getDoc, getDocs, query, collection, where, updateDoc },
                        { finWo: { id: line.finSiblingId, salesOrderId: line.soAppId || null, orderKey: line.orderKey || null }, phase: 'Plated', by: operator?.name || '' });
                    writeLog(`Plated parts back on ${line.finSiblingId} — custom half Complete, pack gate open (${target} ×${got}).`, 'wms');
                } catch (e) {
                    console.warn('sibling/board update failed (the build stands):', e);
                    alert(`⚠ ${target} built and put away, but the ORDER was not told.\n\n${e.message || e}\n\nThe pack gate may still refuse. Tell Stuart rather than working around it — the NetSuite side is done and must not be repeated.`);
                }
            }
            const soId = line.soAppId || null;
            const forOrder = soId ? quickShipOrders.find(o => o.id === soId || String(o.soId || '') === String(soId)) : null;
            if (forOrder) {
                const oline = (forOrder.lines || []).find(l => String(l.erp || '').toUpperCase() === String(target).toUpperCase());
                await commitToOrder(forOrder, { code: target, qty: got, ordered: Number(oline && oline.qty) || 0 });
            } else if (soId) {
                writeLog(`⚠ Plating put-away: ${target} carries sales order ${soId} but no matching order is open in this brand — left in ${bins.map(p => p.bin).join(', ')} rather than guessed into a committed bin.`, 'wms');
            } else {
                // BULK PLATED SMALL PARTS — the case Stuart named: ordered for stock, so nothing on
                // the line points at an order, and the backorders against them are invisible at the
                // dock. Ask before they vanish onto the shelf.
                try { await offerAllocation(target, got, { from: `plating put-away ${line.shipmentId || line.id}` }); }
                catch (e) { console.warn('arrival alert failed (the build stands):', e); }
            }
            alert(`✅ ${got} × ${target} put away and built.\n\n${bins.map(p => `   ${p.qty} → ${p.bin}`).join('\n')}${scrap > 0 ? `\n\n${scrap} short piece(s) scrapped out of WIP-Plating.` : ''}`);
            setPaLineId(''); setPaBins([{ bin: '', qty: '' }]); setPaMulti(false); setPlatingScan(''); setPlatingFocusId(null);
            pullNetSuiteStock();
        } catch (e) {
            console.error('Plating put-away failed:', e);
            alert('❌ Put-away problem:\n\n' + (e.message || e) + '\n\nEvery step is guarded — the reversal, the scrap and each bin already built are recorded, so retrying re-posts none of them. If the RESTlet names a step or an item id, paste it.');
        } finally { setIsSyncing(false); }
    };
    // The old one-button build-back lived here. It sent inventory detail ONLY when the LIBRARY
    // happened to carry a bin for the plated assembly, so on 2026-09-03 every line of
    // PLT-CE-1782150374239 failed with "Please configure the inventory detail for the assembly
    // item". It is gone rather than patched: the bin is not a lookup, it is where the pieces were
    // physically put — putAwayFromCart above is now the ONE place that posts this build.

    const handlePickValidation = async (e) => {
        e.preventDefault();
        const lineItem = activePickJob.partsList[currentPickLine];
        const expectedBin = lineBin(lineItem);
        // Any bin that LIVE-holds this item is a valid scan (an item can sit in several bins —
        // NetSuite's balance is the truth, not just the displayed top bin).
        const scanned = validation.bin.toUpperCase();
        const lv = liveOf(lineItem);
        const okByLive = !!(lv && lv.bins.some(b => b.bin === scanned && b.qty > 0));

        if (!okByLive && scanned !== expectedBin.toUpperCase() && expectedBin !== 'UNASSIGNED') {
            return alert("❌ Incorrect Bin Scanned! Please verify location.");
        }
        // A SHORT quantity is only accepted once the shortfall has been routed to plating — otherwise
        // "expected N" still holds and a mis-count can't slip through (Stuart 2026-07-30). The order
        // carries the short so staging/HQ see the balance is coming back from the plater.
        const entered = parseInt(validation.qty);
        const target = lineQty(lineItem);
        const code = String((lineItem.legacyErpId || lineItem.partId) || '').toUpperCase();
        const routedShort = routedShorts[code];
        let shortRec = null;
        if (entered !== target) {
            if (!(routedShort && entered >= 0 && entered < target)) {
                return alert(`❌ Quantity Mismatch. Expected ${target}.`);
            }
            if (!window.confirm(`Confirm SHORT pick?\n\n${code}: picking ${entered} of ${target}. The remaining ${target - entered} is covered by the plating order already raised.`)) return;
            shortRec = { line: currentPickLine, itemId: code, name: lineItem.name || '', target, picked: entered, platingDemandId: routedShort };
        }

        // JFP AUTO-ADJUST (Eric 2026-08-12: "add the selection of replacement part at start
        // rather than pick"): a paint-only pull FROM STOCK adjusts −qty of the pulled item at
        // pick confirm — packing later adjusts the painted pieces IN, so without this every JFP
        // pull double-counted (the 'two raws added but never removed' drift). The source was
        // chosen at creation (Pull Pieces From) or defaults to the item's own code; customer-
        // supplied pieces are SKIPPED lines and never adjust.
        if (activePickJob.paintOnly === true && entered > 0) {
            const nsId = lineItem.jfpSourceNsId || (hqParts.find(p => String(p.legacyErpId || p.itemId || '').toUpperCase() === code) || {}).netSuiteInternalId;
            if (nsId) {
                const nsCfg = BRAND_NETSUITE_MAP[activeBrand] || { subsidiary: '2', location: '17' };
                const adjBin = scanned && scanned !== 'UNASSIGNED' ? scanned : '';
                try {
                    await enqueueNsWrite({
                        kind: 'inventoryadjustment',
                        label: `JFP pull −${entered} × ${code} (${packRef(activePickJob)})`,
                        sourceApp: 'WMS', createdBy: operator?.name || '',
                        targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/inventoryadjustment',
                        method: 'POST',
                        payload: {
                            account: { id: "254" }, subsidiary: { id: nsCfg.subsidiary },
                            memo: `JFP pull for ${packRef(activePickJob)}: −${entered} × ${code} (repaint source)`,
                            inventory: { items: [{ item: { id: String(nsId) }, location: { id: nsCfg.location }, adjustQtyBy: -entered, ...(adjBin ? { inventoryDetail: { quantity: -entered, inventoryAssignment: { items: [{ binNumber: { refName: adjBin }, quantity: -entered }] } } } : {}) }] }
                        },
                    });
                    writeLog(`JFP pull: −${entered} × ${code} adjustment queued (${packRef(activePickJob)}${adjBin ? ` · bin ${adjBin}` : ''}).`, 'wms');
                } catch (adjErr) {
                    alert(`Pick recorded, but the −${entered} × ${code} NetSuite adjustment could not be queued: ${adjErr.message || adjErr}\n\nAdjust it manually (11.1 / NetSuite).`);
                }
            } else {
                writeLog(`⚠ JFP pull of ${entered} × ${code} on ${packRef(activePickJob)} — no NetSuite id resolved, NO adjustment queued (adjust manually).`, 'alert');
            }
        }

        setValidation({ bin: '', qty: '' });
        const nextShorts = shortRec ? [...pickShorts, shortRec] : pickShorts;
        if (shortRec) setPickShorts(nextShorts);

        if (currentPickLine + 1 < activePickJob.partsList.length) {
            setCurrentPickLine(prev => prev + 1);
        } else {
            completePick(pickSkips, nextShorts);
        }
    };

    // Finish the pick (from the last confirmed line OR a skip of the last line). When lines were
    // skipped, the order is stamped so staging/HQ can fix it — the parts still went to staging,
    // just short the skipped line(s).
    const completePick = (skips, shorts) => {
        setShowNacho(true);
        setTimeout(async () => {
            const patch = { pickStatus: 'Picked_Awaiting_Staging', pickInProgress: null, pickedBy: operator?.name || '', pickedAt: Date.now() };
            if (skips && skips.length) { patch.pickSkips = skips; patch.pickHadSkips = true; }
            if (shorts && shorts.length) { patch.pickShorts = shorts; patch.pickHadShorts = true; }
            await updateDoc(doc(db, "fin_workorders", activePickJob.id), patch);
            writeLog(`Order Picked: ${activePickJob.id}${(skips && skips.length) ? ` — ⚠ ${skips.length} line(s) SKIPPED (fix at staging): ${skips.map(s => s.itemId || s.name).join(', ')}` : ''}${(shorts && shorts.length) ? ` — ⚗ ${shorts.length} line(s) SHORT, balance out to plating: ${shorts.map(s => `${s.itemId} ${s.picked}/${s.target}`).join(', ')}` : ''}`, 'wms');
            printZebraLabel(activePickJob, 'SMALL_PARTS');
            setActivePickJob(null);
            setPickSkips([]);
            setPickShorts([]);
            setShowNacho(false);
            setOperator(null);
        }, 2000);
    };

    // Skip the current line (Stuart 2026-07-17): some CPQ orders pushed lines that later defaulted
    // to 0 (e.g. splices) — the operator can't pick a phantom, so skip it and keep going. The order
    // is flagged (pickHadSkips) and the skipped lines recorded so it's corrected at the end.
    const handleSkipLine = () => {
        const lineItem = activePickJob.partsList[currentPickLine];
        if (!window.confirm(`Skip "${lineItem.name}"${lineItem.legacyErpId || lineItem.partId ? ` (item ${lineItem.legacyErpId || lineItem.partId})` : ''}?\n\nIt will NOT be picked. The order is flagged so it can be fixed at staging/end — use this for lines that shouldn't be on the order (e.g. a splice that should be 0).`)) return;
        const skip = { line: currentPickLine, itemId: lineItem.legacyErpId || lineItem.partId || '', name: lineItem.name || '', qty: lineItem.qty || 0 };
        const nextSkips = [...pickSkips, skip];
        setPickSkips(nextSkips);
        setValidation({ bin: '', qty: '' });
        if (currentPickLine + 1 < activePickJob.partsList.length) {
            setCurrentPickLine(prev => prev + 1);
        } else {
            completePick(nextSkips, pickShorts);
        }
    };

    // ⇄ SUBSTITUTE PULL (Eric 2026-08-11): the stated code doesn't exist or holds nothing, but an
    // EQUIVALENT item does (another finish of the same part — his HHRMBF75/M6 case, typical for
    // Just-For-Paint repaints). Pull that instead: the substitution is recorded on the order and —
    // when no NetSuite work order will consume components (JFP / no nsWoId) — a −qty inventory
    // adjustment for the substitute queues to NetSuite so stock stays true (the "two raws added in
    // but never removed" drift). When an NS WO exists, the substitution is recorded for review
    // instead, because the NS WO will consume the STATED component and a second write would drift
    // the other way.
    const handleSubstitutePick = async () => {
        const lineItem = activePickJob.partsList[currentPickLine];
        const target = String(lineItem.legacyErpId || lineItem.partId || '').toUpperCase();
        const code = String(window.prompt(`⇄ SUBSTITUTE PULL — which item are you taking INSTEAD of ${target}?\n\n(e.g. another finish of the same part: HHRMBF75/M6)`, '') || '').trim().toUpperCase();
        if (!code) return;
        if (code === target) return alert('That is the same code — scan the bin and pick it normally.');
        const part = hqParts.find(p => String(p.legacyErpId || p.itemId || '').toUpperCase() === code);
        if (!part) return alert(`${code} isn't in the library — check the code.`);
        if (!part.netSuiteInternalId) return alert(`${code} has no NetSuite id, so stock can't be adjusted out of it. Pick an item NetSuite tracks.`);
        const qty = parseInt(window.prompt(`How many ${code} did you pull?`, String(Number(lineItem.quantity ?? lineItem.qty) || 1))) || 0;
        if (qty <= 0) return;
        const subBin = String(window.prompt(`Which bin did you pull ${code} from? (leave blank if unbinned)`, '') || '').trim().toUpperCase();
        const postAdj = activePickJob.paintOnly === true || !activePickJob.nsWoId;
        if (!window.confirm(`⇄ Pull ${qty} × ${code}${subBin ? ` from ${subBin}` : ''} in place of ${target}?\n\n${postAdj ? `A −${qty} inventory adjustment for ${code} queues to NetSuite so stock stays true.` : `Recorded on the order for review — this order's NetSuite WO consumes the STATED component, so no adjustment posts here; reconcile the variance in NetSuite.`}`)) return;
        try {
            await updateDoc(doc(db, 'fin_workorders', activePickJob.id), {
                pickSubstitutions: arrayUnion({ forCode: target, code, qty, bin: subBin || null, adjustedOut: postAdj, by: operator?.name || '', at: Date.now() })
            });
            if (postAdj) {
                const nsCfg = BRAND_NETSUITE_MAP[activeBrand] || { subsidiary: '2', location: '17' };
                await enqueueNsWrite({
                    kind: 'inventoryadjustment',
                    label: `Substitute pull −${qty} × ${code} (for ${target} on ${packRef(activePickJob)})`,
                    sourceApp: 'WMS', createdBy: operator?.name || '',
                    targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/inventoryadjustment',
                    method: 'POST',
                    payload: {
                        account: { id: "254" }, subsidiary: { id: nsCfg.subsidiary },
                        memo: `Substitute pull on ${packRef(activePickJob)}: took ${qty} × ${code} in place of ${target}`,
                        inventory: { items: [{ item: { id: String(part.netSuiteInternalId) }, location: { id: nsCfg.location }, adjustQtyBy: -qty, ...((subBin && subBin !== 'UNASSIGNED') ? { inventoryDetail: { quantity: -qty, inventoryAssignment: { items: [{ binNumber: { refName: subBin }, quantity: -qty }] } } } : {}) }] }
                    },
                });
            }
            writeLog(`⇄ SUBSTITUTE PULL on ${packRef(activePickJob)}: ${qty} × ${code} taken in place of ${target}${subBin ? ` (bin ${subBin})` : ''}${postAdj ? ` — −${qty} adjustment queued` : ' — recorded for NS review (order has an NS WO)'}.`, 'wms');
        } catch (e) { return alert('Substitute failed: ' + (e.message || e)); }
        setValidation({ bin: '', qty: '' });
        if (currentPickLine + 1 < activePickJob.partsList.length) setCurrentPickLine(prev => prev + 1);
        else completePick(pickSkips, pickShorts);
    };

    const handleStagingMatch = async (e) => {
        e.preventDefault();
        // §A2: two-label staging handshake. Both halves of an order carry the same orderKey —
        // the small-parts label (printed at pick) and the shop custom label (barcode = orderKey).
        // We resolve the small-parts WO by EXACT key, then for orders that have a custom half we
        // require the second scan to match the SAME key exactly and the shop fab to be Complete.
        const smallKey = normalizeKey(stagingSmallScan);
        const custKey = normalizeKey(stagingCustomScan);

        if (!smallKey) return alert("Scan the SMALL-PARTS staging label first.");

        const job = resolveByExactKey(jobs, smallKey);
        if (!job) return alert(`❌ No picked small-parts order matches "${smallKey}".`);
        if (job.pickStatus !== 'Picked_Awaiting_Staging') {
            return alert(`❌ ${packRef(job)}: small parts are not picked yet (status: ${job.pickStatus || 'Pending'}).`);
        }

        // Orders with a custom (shop) half must pass the two-label verify; small-only orders skip it.
        if (job.hasCustomSibling) {
            if (!custKey) return alert(`📋 ${packRef(job)} has custom shop parts — scan the CUSTOM (shop) label too.`);
            if (smallKey !== custKey) {
                return alert(`🛑 DIFFERENT ORDERS — DO NOT MIX.\n\nSmall-parts label: ${smallKey}\nCustom label: ${custKey}\n\nSeparate these before staging.`);
            }
            // ONE TEST for "are the custom parts ready" (Brief B2's customPartsReady), so this
            // screen, RTG and the Setup Queue cannot disagree. 'Sent to Plating' is NOT ready —
            // the pieces are at the plater, and the receiving station's build-back is what makes
            // them Complete.
            if (!customPartsReady(job)) {
                return alert(`❌ ${packRef(job)}: custom parts are not ready (${job.customFabStatus || 'Pending'}).${job.customFabStatus === 'Sent to Plating' ? '\n\nThey are AT THE PLATER. They become packable when the pallet is received and built back on the Plating tab.' : '\n\nWait for the shop to finish + label them.'}`);
            }
        }

        await updateDoc(doc(db, "fin_workorders", job.id), {
            pickStatus: 'Staged_Ready_For_Finishing',
            stagingStatus: 'MATCHED',
            stagedAt: serverTimestamp()
        });
        writeLog(`Order Staged & Matched: ${packRef(job)}`, 'wms');
        alert(`✅ MATCH CONFIRMED: ${packRef(job)} is staged and ready for the Finishing floor.`);
        setStagingSmallScan('');
        setStagingCustomScan('');
        setOperator(null);
    };

    // SETUP LABEL (Stuart 2026-07-21 — replaces the Phase-2 stub that only console.logged):
    // prints the 4×2 the Staging Handshake scans AND that rides the fixture into finishing.
    // Barcode = the shared staging key (orderKey), exactly what VERIFY & STAGE resolves.
    const printZebraLabel = (job, type) => {
        const base = {
            kind: type === 'SMALL_PARTS' ? 'SETUP · SMALL PARTS' : String(type || 'SETUP').replace(/_/g, ' '),
            woRef: packRef(job),
            orderKey: job.orderKey || job.salesOrderId || job.soNum || job.id,
            item: job.stockErpId || job.type || '',
            qty: job.totalParts || '',
            finish: job.recipe || '',
            customer: job.customerName || job.clientName || job.customer || ''
        };
        // ONE ORDER, MACHINE-SIZED LOADS (Stuart 2026-08-28): a small-parts order bigger than one
        // spray-zone load (70 S · 35 M · 17 L) prints one label PER LOAD — PART 1 OF n — instead
        // of a single label. Same barcode on every label, so they stage and scan as one order.
        // Poles are racked, never zone-loaded, and an unsized job falls back to the single label.
        // ONE POLE TEST (sweep 2026-09-01) — the stamped count first, the category as the fallback
        // for orders raised before a count was stamped (Sandra's WO11535 shape).
        const isPole = !!(job.poles || job.totalPoles) || isPoleCategory(job.productType);
        const plan = (type === 'SMALL_PARTS' && !isPole)
            ? machineLoadPlan(null, job.paintSize, job.productType, job.totalParts) : null;
        if (plan) return printMachineLoadLabels(base, plan.loads);
        printSetupLabel(base);
    };

    // Filter Logic for cycle counting (robust search header, mirrors HQ Master Library)
    const dynamicProdTypes = Array.from(new Set([
        ...(globalLists.prodTypes || []),
        ...hqParts.map(p => p.manufacturingSpecs?.productType || "").filter(Boolean)
    ])).sort();

    const collectionsOf = (specs) => (Array.isArray(specs.collections) ? specs.collections : (specs.customData?.collection && specs.customData.collection !== 'N/A' ? [specs.customData.collection] : [])).map(c => String(c).toUpperCase());
    const dynamicCollections = Array.from(new Set(hqParts.flatMap(p => collectionsOf(p.manufacturingSpecs || {})).filter(Boolean))).sort();

    // Effective watchlist for a part: explicit watchList wins, else the NS-synced customData.watchlist (mirrors HQ).
    const watchlistOf = (specs) => String((specs.watchList || (specs.customData?.watchlist && specs.customData.watchlist !== 'N/A' ? specs.customData.watchlist : '')) || '').toUpperCase();
    const dynamicWatchlists = Array.from(new Set(hqParts.map(p => watchlistOf(p.manufacturingSpecs || {})).filter(Boolean))).sort();

    const baseFilteredItems = hqParts.filter(part => {
        if (part.manufacturingSpecs?.isRetired === true || retiredSet.has(String(part.netSuiteInternalId || ''))) return false; // hide retired (custitem28 / locked) items
        const term = searchQuery.toLowerCase();
        const specs = part.manufacturingSpecs || {};
        const erpId = (part.legacyErpId || part.itemId || "").toUpperCase();

        // Search matches item identity, the stored home bin, OR any LIVE bin the item occupies in
        // NetSuite — so you can search by bin and find every item sitting in that bin.
        const liveBins = (nsStock[erpId]?.bins || []).map(b => String(b.bin || '').toLowerCase());
        const matchesSearch = !term
            || part.itemName?.toLowerCase().includes(term)
            || erpId.toLowerCase().includes(term)
            || (part.itemId || "").toLowerCase().includes(term)
            || (specs.binLocation || "").toLowerCase().includes(term)
            || liveBins.some(b => b.includes(term));
        const matchesType = typeFilter === "" || (specs.productType || "").toUpperCase() === typeFilter.toUpperCase();
        const matchesCollection = collectionFilter === "" || collectionsOf(specs).includes(collectionFilter.toUpperCase());
        const matchesWatchlist = watchlistFilter === "" || watchlistOf(specs) === watchlistFilter.toUpperCase();

        // Countable = the same stock-bearing classes Stock View shows (Inventory + Assembly + Master
        // Assembly — raw, in-house, outsourced, and finished /P / painted / plated variants), PLUS
        // anything NetSuite carries on hand. NOT gated on partClass==='Inventory' alone, which hid the
        // finished variants. ('Approved_Designs' is just the collection name — there is no approval gate.)
        const cls = part.partClass || "";
        const isStockClass = cls === "Inventory" || cls === "Assembly" || cls === "Master Assembly";
        const erpForStock = (part.legacyErpId || part.itemId || "").toUpperCase();
        const liveStock = nsStock[erpForStock];
        const hasStock = !!liveStock && (((liveStock.onHand || 0) !== 0) || (Array.isArray(liveStock.bins) && liveStock.bins.length > 0));
        const isCountable = isStockClass || hasStock;

        return matchesSearch && matchesType && matchesCollection && matchesWatchlist && isCountable;
    }).map(part => {
        const erpId = (part.legacyErpId || part.itemId || "").toUpperCase();
        return {
            ...part,
            erpId: erpId,
            // Real NetSuite id only — never the Firestore doc id (a doc id sent as item.id 400s the adjustment).
            netSuiteInternalId: part.netSuiteInternalId || null,
            onHand: nsStock[erpId]?.onHand || 0,
            binLocation: part.manufacturingSpecs?.binLocation || 'UNASSIGNED'
        };
    });

    // Enriched item by ERP id, independent of the screen filters — a to-do routed from HQ must open its
    // item even when the operator has a search term typed (the list-based lookups can't see past it).
    const enrichedByErp = (erp) => {
        const want = String(erp || '').toUpperCase();
        const part = want && hqParts.find(p => erpOf(p) === want);
        if (!part) return null;
        return { ...part, erpId: want, netSuiteInternalId: part.netSuiteInternalId || null, onHand: nsStock[want]?.onHand || 0, binLocation: part.manufacturingSpecs?.binLocation || 'UNASSIGNED' };
    };

    // COUNT tab rows: expand each inventory item into one row PER BIN that holds stock, so a physical
    // count adjusts ONLY the entered bin instead of the item's combined cross-bin total. Items with no
    // per-bin breakdown (non-bin-managed, or the per-bin pull was unavailable) fall back to a single row
    // whose O.H. is the combined total — i.e. the original behavior, so nothing regresses for them.
    // Operator can add a fresh bin row for an item to count stock found in a bin NetSuite doesn't list
    // yet (binOnHand 0 → the push posts a +adjustment INTO that bin). Keyed to the item; live-resolved.
    const addCountBin = (item) => setExtraCountRows(prev => [...prev, { id: `xb-${item.id}-${Date.now()}`, itemId: item.id }]);
    const removeCountBin = (rowKey) => {
        setExtraCountRows(prev => prev.filter(x => x.id !== rowKey));
        setBinEdits(prev => { const n = { ...prev }; delete n[rowKey]; return n; });
        setPhysicalCounts(prev => { const n = { ...prev }; delete n[rowKey]; return n; });
    };

    const countRows = baseFilteredItems.flatMap(item => {
        const bins = (nsStock[item.erpId]?.bins || []).filter(b => b.bin);
        if (bins.length > 0) {
            return bins.map(b => ({
                ...item,
                rowKey: `${item.id}::${b.bin}`,
                countBin: b.bin,        // fixed, real bin (read-only in the UI)
                binOnHand: b.qty,       // on-hand in THIS bin — the basis for the delta
                isExistingBin: true
            }));
        }
        return [{
            ...item,
            rowKey: `${item.id}::__nobins__`,
            countBin: item.binLocation, // editable; 'UNASSIGNED' or the item's stored home bin
            binOnHand: item.onHand,     // no bin breakdown → use combined total (original behavior)
            isExistingBin: false
        }];
    }).filter(r => {
        // Row-level search: an item term keeps all of that item's bin rows; a bin term keeps only the
        // rows for the matching bin (across every item in it). Item-level filter already let it through.
        const term = searchQuery.trim().toLowerCase();
        if (!term) return true;
        const itemMatch = (r.itemName || '').toLowerCase().includes(term) || String(r.erpId || '').toLowerCase().includes(term) || String(r.itemId || '').toLowerCase().includes(term);
        const binMatch = String(r.countBin || '').toLowerCase().includes(term);
        return itemMatch || binMatch;
    }).concat(extraCountRows.map(x => {
        // Operator-added rows: count stock in a bin NetSuite doesn't show. binOnHand 0 → +adjustment.
        const item = baseFilteredItems.find(p => p.id === x.itemId);
        return item ? { ...item, rowKey: x.id, countBin: '', binOnHand: 0, isExistingBin: false, isExtra: true } : null;
    }).filter(Boolean));

    // DELETE a convert to-do (admin/superadmin ✕ on the Needs Phosphating list, 2026-08-29): the
    // one affordance this tab never had — stray demands from deleted or re-run ordering attempts
    // piled up here with no way to clear them. Deleting the LAST demand pointing at a still-live
    // work order also lifts that WO's awaitingConvert gate, but deliberately does NOT auto-release
    // it to the floor (a human deleting a demand is cleaning up, not saying "the phosphate is
    // done" — release stays RTG's call).
    const deleteConvertDemand = async (d) => {
        if (!window.confirm(`✕ Delete convert to-do ${d.woNum || d.id}?\n\n${d.baseErpId} → ${d.targetErpId} · ${d.qty} pcs${d.finWoId ? `\nRaised for work order ${d.finWoErpId || d.finWoId}.` : ''}\n\nThe to-do is removed permanently. If it was the last one gating a live work order, that WO stops waiting on a convert (it still releases from RTG, not automatically).`)) return;
        try {
            await deleteDoc(doc(db, "convert_demand", d.id));
            if (d.finWoId) {
                try {
                    const left = await getDocs(query(collection(db, "convert_demand"), where("finWoId", "==", d.finWoId)));
                    if (left.docs.filter(x => x.id !== d.id).length === 0) {
                        await updateDoc(doc(db, "hq_work_orders", d.finWoId), {
                            awaitingConvert: false,
                            convertGateNote: `convert to-do ${d.woNum || d.id} deleted by ${operator?.name || 'WMS'} — gate lifted, release from RTG`,
                        }).catch(() => {});
                    }
                } catch (e) { console.warn('convert-gate lift after demand delete failed (delete stands):', e); }
            }
        } catch (e) { alert('Delete failed: ' + (e.message || e)); }
    };

    // CONVERT derived: resolve target assembly (by /P convention or manual pick) + readiness gates
    const convTarget = (convertTargetId && hqParts.find(p => p.id === convertTargetId))
        || (convertBase && hqParts.find(p => erpOf(p) === `${convertBase.erpId}/P`))
        || null;
    const convQtyNum = parseInt(convertQty) || 0;
    // Source bin = one of the item's LIVE bins (stock can sit in several) — pick/scan exactly ONE and
    // pull from it. Validated against live per-bin stock, not the stale stored home bin (which may be
    // UNASSIGNED or hold no stock). Qty is capped at that bin's on-hand.
    const convSrcBins = convertBase ? (nsStock[convertBase.erpId]?.bins || []).filter(b => b.bin) : [];
    const convSrcBin = convSrcBins.find(b => String(b.bin).toUpperCase() === convertSrcScan.trim().toUpperCase());
    const convSrcQty = convSrcBin ? convSrcBin.qty : 0;
    const convSrcOk = !!convSrcBin;
    const convDestOk = !!convTarget && binOf(convTarget) !== 'UNASSIGNED' && convertDestScan.trim().toUpperCase() === binOf(convTarget).toUpperCase();
    const convReady = !!convertBase && !!convertBase.netSuiteInternalId && !!convTarget && !!convTarget.netSuiteInternalId && convQtyNum > 0 && convQtyNum <= convSrcQty && convSrcOk && convDestOk;
    const convTargetMatches = convertTargetSearch.trim().length >= 2
        ? hqParts.filter(p => p.id !== convertBase?.id && (erpOf(p).includes(convertTargetSearch.trim().toUpperCase()) || (p.itemName || '').toLowerCase().includes(convertTargetSearch.trim().toLowerCase()))).slice(0, 8)
        : [];

    // BIN TRANSFER derived: readiness gates. Validate against the LIVE per-bin stock (nsStock[...].bins),
    // not the item's stored home bin — that home bin can be stale (no on-hand there), and NetSuite rejects
    // a transfer out of a bin the item doesn't actually occupy ("Invalid binnumber reference key").
    const xferQtyNum = parseInt(transferQty) || 0;
    const xferFrom = (transferSrcScan || '').trim();
    const xferTo = (transferDestScan || '').trim();
    const xferBins = transferBase ? (nsStock[transferBase.erpId]?.bins || []).filter(b => b.bin) : [];
    const xferSrcBin = xferBins.find(b => b.bin.toUpperCase() === xferFrom.toUpperCase());
    const xferSrcQty = xferSrcBin ? xferSrcBin.qty : 0;     // on-hand of THIS item in the scanned source bin
    const xferSrcKnown = !!transferBase && xferFrom !== '' && !!xferSrcBin;
    const xferReady = !!transferBase && !!transferBase.netSuiteInternalId && xferQtyNum > 0 && xferQtyNum <= xferSrcQty && xferFrom !== '' && xferTo !== '' && xferFrom.toUpperCase() !== xferTo.toUpperCase();

    // PLATING WIP derived: readiness gates
    const platQtyNum = parseInt(platingQty) || 0;
    const platFrom = (platingSrcScan || '').trim();
    const platTo = (platingDestScan || '').trim();
    // Source bin = one of the item's LIVE bins (where stock actually sits), pick/scan one — matches Convert/Transfer.
    const platBins = platingBase ? (nsStock[platingBase.erpId]?.bins || []).filter(b => b.bin) : [];
    const platSrcBin = platBins.find(b => String(b.bin).toUpperCase() === platFrom.toUpperCase());
    const platSrcKnown = !!platSrcBin;
    // A plating pull flips status Good→WIP-Plating, so NetSuite ON-HAND never drops — only available does.
    // Compute available = on-hand − what's already in WIP (staged/shipped/received, live from Firestore), so
    // the number reflects committed pulls immediately (84 → 72 → 60 …) without waiting on a NetSuite re-pull.
    const platingWipByErp = [...platingStaged, ...platingShipped, ...platingReceived].reduce((acc, l) => {
        const k = String(l.erpId || '').toUpperCase();
        acc[k] = (acc[k] || 0) + (parseInt(l.qty) || 0);
        return acc;
    }, {});
    const platBaseWip = platingBase ? (platingWipByErp[String(platingBase.erpId || '').toUpperCase()] || 0) : 0;
    const platAvail = platingBase ? Math.max(0, (platingBase.onHand || 0) - platBaseWip) : 0;
    const platReady = !!platingBase && !!platingBase.netSuiteInternalId && !!platingFinish && platQtyNum > 0 && platQtyNum <= platAvail && platFrom !== '' && platTo !== '' && platFrom.toUpperCase() !== platTo.toUpperCase();
    // Finishes valid for THIS part/brand = those whose plated assembly (base/CODE) exists in the active-brand
    // library (hqParts is brand-scoped, so EP* resolve on CE, MEP* on M2C). Falls back to all finishes if none
    // of the targets are synced yet, so the operator is never stuck — the build-back still validates the assembly.
    const platingFinishOptions = (() => {
        if (!platingBase) return [];
        const base = erpOf(platingBase);
        const valid = outsourceFinishes.filter(f => hqParts.some(p => erpOf(p) === `${base}/${finishCodeOf(f)}`));
        return valid.length ? valid : outsourceFinishes;
    })();

    // Plating shipment cost helper: $/unit = the PLATING FEE for the item's product type
    // (HQ Admin → Plating Fees). Per-piece for most; poles are per-foot with qty already in feet.
    const platingBaseCost = (l) => {
        const pt = String(hqParts.find(p => p.id === l.itemId)?.manufacturingSpecs?.productType || '').toUpperCase();
        return parseFloat(platingFees[pt]?.fee) || 0;
    };
    const platingRateFor = (l) => { const v = shipCosts[l.id]; return v !== undefined ? (parseFloat(v) || 0) : platingBaseCost(l); };

    // Re-printable plating PO (Stuart 2026-08-13: "my vendor just asked for a copy of this po") —
    // rebuild the packing-list payload from the shipped lines, any time after ship. Same shape the
    // ship-time print used, so the laser copy and the PDF both carry Finish + Returns-As columns.
    const shipmentPrintData = (g) => {
        // Unit cost per line, best available: the rate stamped at ship → the current Plating Fees
        // rule for the item's product type → the item's Base Cost field (Stuart 2026-08-13).
        const costOf = (l) => parseFloat(l.platingRate)
            || platingBaseCost(l)
            || parseFloat(hqParts.find(p => p.id === l.itemId || String(p.legacyErpId || p.itemId || '').toUpperCase() === String(l.erpId || '').toUpperCase())?.manufacturingSpecs?.cost)
            || 0;
        const lines = g.lines.map(l => ({ erpId: l.erpId, itemName: l.itemName || '', finishCode: l.finishCode || '', targetErpId: l.targetErpId || '', platingBin: l.platingBin || '', woNum: l.woNum || '', qty: l.qty, rate: costOf(l) }));
        const total = g.lines.reduce((s, l) => s + costOf(l) * (parseInt(l.qty) || 0), 0);
        const shippedMs = g.lines.map(l => (l.shippedAt && l.shippedAt.seconds ? l.shippedAt.seconds * 1000 : 0)).find(Boolean);
        return {
            shipId: g.shipmentId,
            brand: String(activeBrand || '').toUpperCase(),
            vendor: g.lines.find(l => l.vendorName)?.vendorName || 'Plater',
            poLabel: g.nsPoTran || g.nsPoId || '',
            dateStr: shippedMs ? new Date(shippedMs).toLocaleDateString() : new Date().toLocaleDateString(),
            operator: operator?.name || '',
            lines,
            pcs: g.lines.reduce((s, l) => s + (parseInt(l.qty) || 0), 0),
            total,
            finishSummary: [...new Set(g.lines.map(l => l.finishCode).filter(Boolean))].join(', '),
        };
    };

    // RING PACKS derived. A pack SKU ends in "-<count>" (…/G-10, …/BL-12); "-EA" is the single.
    // The component defaults to the bare root (HCUSR15 for HCUSR15/G-10 — what Stuart described),
    // with the finished each (…/G-EA) offered as the alternative, because only NetSuite's BOM
    // knows which one this assembly really consumes.
    // On-hand comes from the live NetSuite pull (nsStock), NOT the item doc — the doc has no such
    // field, which is why every pack read 0 (Stuart 2026-07-28: "it is not seeing the stock
    // correctly… new tool showing nothing on any item").
    const ohOf = (part) => (part ? (nsStock[erpOf(part)]?.onHand || 0) : 0);
    const packSizeOf = (code) => { const m = /-(\d+)$/.exec(String(code || '').toUpperCase()); return m ? parseInt(m[1], 10) : 0; };
    const isPackCode = (code) => packSizeOf(code) > 1;
    const rootOfCode = (code) => String(code || '').toUpperCase().split('/')[0];
    const finishOfCode = (code) => ((/\/([A-Z0-9]+)-\d+$/.exec(String(code || '').toUpperCase()) || [])[1] || '');
    // The finished each a pack is built from — HCUSR15/BL-10 and /BL-12 both come from HCUSR15/BL-EA.
    const eachForPack = (code) => { const f = finishOfCode(code); return f ? `${rootOfCode(code)}/${f}-EA` : ''; };
    const ohOfCode = (code) => (code ? (nsStock[String(code).toUpperCase()]?.onHand || 0) : 0);
    const packTarget = packTargetId ? hqParts.find(p => p.id === packTargetId) || null : null;
    const packMatches = (() => {
        const q = packSearch.trim().toUpperCase();
        if (q.length < 2) return [];
        return hqParts
            .filter(p => isPackCode(erpOf(p)) && (
                erpOf(p).includes(q)
                || (p.itemName || '').toUpperCase().includes(q)
                || eachForPack(erpOf(p)).includes(q)   // search by the FINISHED EACH to find its packs
            ))
            .sort((a, b) => erpOf(a).localeCompare(erpOf(b)))
            .slice(0, 12);
    })();
    const packSize = packTarget ? packSizeOf(erpOf(packTarget)) : 0;
    const packRoot = packTarget ? rootOfCode(erpOf(packTarget)) : '';
    // THE COMPONENT IS THE FINISHED EACH IN THE PACK'S OWN FINISH (Stuart 2026-07-28: "we work
    // order and finish HCUSR15 into HCUSR15/BL-EA… then this tool can turn HCUSR15/BL-EA into
    // HCUSR15/BL-10 or HCUSR15/BL-12"). The RAW root is deliberately NOT offered: it is the input
    // to the finishing work order, never to a pack build, and offering it is what sent the first
    // test at a component the BOM never wanted.
    const packExpectedEach = packTarget ? eachForPack(erpOf(packTarget)) : '';
    const packComponentOptions = (() => {
        if (!packTarget) return [];
        const out = [];
        const ea = packExpectedEach ? hqParts.find(p => erpOf(p) === packExpectedEach) : null;
        if (ea) out.push(ea);
        // other finished eaches of the same root, for the odd legacy code that spells its finish differently
        hqParts.forEach(p => { const c = erpOf(p); if (c.startsWith(`${packRoot}/`) && c.endsWith('-EA') && !out.includes(p)) out.push(p); });
        return out.slice(0, 6);
    })();
    const packEachMissing = !!packTarget && !!packExpectedEach && !hqParts.some(p => erpOf(p) === packExpectedEach);
    const packComponent = (packComponentId && hqParts.find(p => p.id === packComponentId)) || packComponentOptions[0] || null;
    const packQtyNum = parseInt(packQty) || 0;
    const packEachesNeeded = packQtyNum * (packSize || 0);
    const packSrcBins = packComponent ? (nsStock[erpOf(packComponent)]?.bins || []).filter(b => b.bin) : [];
    const packSrcBin = packSrcBins.find(b => String(b.bin).toUpperCase() === packSrcScan.trim().toUpperCase());
    const packSrcQty = packSrcBin ? packSrcBin.qty : 0;
    const packDestOptions = packTarget && binOf(packTarget) !== 'UNASSIGNED'
        ? String(binOf(packTarget)).split(',').map(x => x.trim()).filter(Boolean) : [];
    const packDestBin = packDestScan.trim() || packDestOptions[0] || '';
    const packReady = !!packTarget && !!packComponent && packQtyNum > 0 && packSize > 0
        && !!packTarget.netSuiteInternalId && !!packComponent.netSuiteInternalId
        && !!packSrcBin && packEachesNeeded <= packSrcQty && !!packDestBin;

    // Ask NetSuite what this assembly's BOM ACTUALLY sources, without building anything. The RESTlet
    // returns each component line, whether it requires inventory detail, and the bin/status it could
    // resolve from live on-hand — which is exactly what "configure the inventory detail in line 1"
    // is complaining about (Stuart 2026-07-28). Component ids are mapped back to our item codes.
    const runPackDiag = async () => {
        if (!packTarget) return;
        const nsConfig = BRAND_NETSUITE_MAP[activeBrand];
        if (!nsConfig) return alert("NetSuite routing configuration missing for this brand.");
        try {
            setIsSyncing(true);
            setPackDiag(null); setDiagNames({});
            const assembly = await resolveItemDetail(erpOf(packTarget));
            if (!assembly) { setIsSyncing(false); return alert(`Couldn't find ${erpOf(packTarget)} in NetSuite.`); }
            const res = await postConvertBuild({
                itemId: assembly.id, quantity: packQtyNum || 1,
                subsidiary: nsConfig.subsidiary, location: nsConfig.location,
                bin: packSrcBin ? String(packSrcBin.bin).trim().toUpperCase() : '',
                toBin: String(packDestBin || '').trim().toUpperCase(),
                memo: 'BOM check', diag: true,
            });
            setPackDiag(res);
            // Name any component our library couldn't identify.
            const unknown = (res && Array.isArray(res.diag) ? res.diag : [])
                .filter(d => d && d.item !== undefined)
                .map(d => String(d.item))
                .filter(id => !hqParts.some(p => String(p.netSuiteInternalId || '') === id));
            if (unknown.length) setDiagNames(await resolveItemNames(unknown));
        } catch (e) {
            setPackDiag({ error: (e && e.message) ? e.message : String(e) });
        } finally { setIsSyncing(false); }
    };
    // Some BOM components aren't in our library at all (or carry no stored internal id), so the
    // map below can't name them — ask NetSuite directly. Best-effort: a failure just leaves the id.
    const resolveItemNames = async (ids) => {
        const want = [...new Set(ids.map(x => String(x || '')).filter(Boolean))];
        if (!want.length) return {};
        try {
            const r = await nsProxyFetch({
                targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`,
                method: 'POST',
                payload: { q: `SELECT id, itemid, displayname FROM item WHERE id IN (${want.map(x => parseInt(x, 10) || 0).join(',')})` }
            });
            const b = await r.json().catch(() => ({}));
            const out = {};
            (b.items || []).forEach(row => { if (row.id) out[String(row.id)] = { code: row.itemid || '', name: row.displayname || '' }; });
            return out;
        } catch (e) { return {}; }
    };

    // NetSuite internal id -> our item code, so a diag line reads HCUSR15/CP-EA instead of 62103.
    const codeForNsId = (nsId) => {
        const want = String(nsId || '');
        if (!want) return '';
        const hit = hqParts.find(p => String(p.netSuiteInternalId || '') === want);
        if (hit) return erpOf(hit);
        const looked = diagNames[want];
        return looked && looked.code ? `${looked.code} (NS #${want}, not in this brand's library)` : `NS #${want}`;
    };

    // Post the pack build. Same RESTlet as CONVERT — it sources the assembly's BOM, consumes from
    // the scanned bin and receives the finished pack into the destination bin.
    const pushRingPackBuild = async () => {
        if (!packReady) return;
        const nsConfig = BRAND_NETSUITE_MAP[activeBrand];
        if (!nsConfig) return alert("NetSuite routing configuration missing for this brand.");
        const packCode = erpOf(packTarget);
        const compCode = erpOf(packComponent);
        const consumeBin = String(packSrcBin.bin).trim().toUpperCase();
        const receiveBin = String(packDestBin).trim().toUpperCase();
        if (!window.confirm(`Build ${packQtyNum} × ${packCode}?\n\nConsumes ~${packEachesNeeded} × ${compCode} (finished each) from ${consumeBin}\nReceives ${packQtyNum} × ${packCode} into ${receiveBin}\n\nNetSuite's BOM decides the exact components.`)) return;
        try {
            setIsSyncing(true);
            const assembly = await resolveItemDetail(packCode);
            if (!assembly) { setIsSyncing(false); return alert(`Couldn't find ${packCode} in NetSuite by item id — confirm the exact item id.`); }
            if (assembly.type && !/assembl/i.test(assembly.type)) { setIsSyncing(false); return alert(`${packCode} is type "${assembly.type}" in NetSuite, not an Assembly. A pack build needs an assembly with ${compCode} as its component.`); }
            const memoText = `Ring pack build by ${operator?.name || 'Unknown'}${packMemo.trim() ? ` — ${packMemo.trim()}` : ''}`;
            const built = await postConvertBuild({ itemId: assembly.id, quantity: packQtyNum, subsidiary: nsConfig.subsidiary, location: nsConfig.location, bin: consumeBin, toBin: receiveBin, memo: nsMemo(memoText) });
            alert(`✅ Pack build #${built.id || ''} posted: +${packQtyNum} × ${packCode} into ${receiveBin}, consumed from ${consumeBin}.`);
            writeLog(`Ring Pack Build: +${packQtyNum} ${packCode} / -${packEachesNeeded} ${compCode} (from ${consumeBin}).${packMemo.trim() ? ` Memo: ${packMemo.trim()}` : ''}`, 'wms');
            setPackQty(""); setPackSrcScan(""); setPackDestScan(""); setPackMemo("");
            pullNetSuiteStock();
        } catch (e) {
            console.error("Ring pack build failed:", e);
            alert("❌ NetSuite rejected the pack build:\n\n" + (e.message || e) + "\n\nPulling the BOM so you can see which component it wants — check the panel below.");
            setIsSyncing(false);
            runPackDiag();   // a rejection is exactly when the sourced component list is worth seeing
            return;
        } finally { setIsSyncing(false); }
    };

    // ---- BREAK APART (the reversal). A pack unbuilds into its finished eaches; ticking "to core"
    // chains a SECOND unbuild that turns those eaches back into the raw ring, which is what makes a
    // batch re-paintable (Stuart 2026-07-28: "take apart a 12 pack of BL and turn it into 1 -10 pack
    // and 2 ea back into stock… we also need an option to unbuild and turn to core"). Re-packing into
    // a different size is then just BUILD on the eaches — two clean NetSuite records, not a fiction.
    const breakSrcBins = packTarget ? (nsStock[erpOf(packTarget)]?.bins || []).filter(b => b.bin) : [];
    const breakSrcBin = breakSrcBins.find(b => String(b.bin).toUpperCase() === breakSrcScan.trim().toUpperCase());
    const breakSrcQty = breakSrcBin ? breakSrcBin.qty : 0;
    const breakEachesBack = packQtyNum * (packSize || 0);
    const breakDestBin = breakDestScan.trim() || (packComponent && binOf(packComponent) !== 'UNASSIGNED' ? String(binOf(packComponent)).split(',')[0].trim() : '');
    const packCorePart = packRoot ? hqParts.find(p => erpOf(p) === packRoot) : null;
    const breakCoreBin = breakCoreScan.trim() || (packCorePart && binOf(packCorePart) !== 'UNASSIGNED' ? String(binOf(packCorePart)).split(',')[0].trim() : '');
    const breakReady = !!packTarget && packQtyNum > 0 && !!packTarget.netSuiteInternalId
        && !!breakSrcBin && packQtyNum <= breakSrcQty && !!breakDestBin
        && (!breakToCore || (!!packCorePart && !!packComponent && !!breakCoreBin));

    const pushPackBreak = async () => {
        if (!breakReady) return;
        const nsConfig = BRAND_NETSUITE_MAP[activeBrand];
        if (!nsConfig) return alert("NetSuite routing configuration missing for this brand.");
        const packCode = erpOf(packTarget);
        const eachCode = packComponent ? erpOf(packComponent) : eachForPack(packCode);
        const srcBin = String(breakSrcBin.bin).trim().toUpperCase();
        const destBin = String(breakDestBin).trim().toUpperCase();
        const coreBin = String(breakCoreBin || '').trim().toUpperCase();
        const msg = breakToCore
            ? `Break ${packQtyNum} × ${packCode} ALL THE WAY BACK TO CORE?\n\n1) ${packQtyNum} × ${packCode} from ${srcBin} → ${breakEachesBack} × ${eachCode} into ${destBin}\n2) ${breakEachesBack} × ${eachCode} → ${breakEachesBack} × ${packRoot} into ${coreBin}\n\nTWO separate NetSuite records — if the second fails the first still stands, and you'll be told exactly where it stopped.`
            : `Break ${packQtyNum} × ${packCode} apart?\n\nTakes ${packQtyNum} × ${packCode} from ${srcBin}\nReturns ${breakEachesBack} × ${eachCode} into ${destBin}`;
        if (!window.confirm(msg)) return;
        try {
            setIsSyncing(true);
            const asm = await resolveItemDetail(packCode);
            if (!asm) { setIsSyncing(false); return alert(`Couldn't find ${packCode} in NetSuite.`); }
            const first = await postConvertBuild({
                mode: 'unbuild', itemId: asm.id, quantity: packQtyNum,
                subsidiary: nsConfig.subsidiary, location: nsConfig.location,
                bin: srcBin, toBin: destBin,
                memo: `Pack break by ${operator?.name || 'Unknown'}${packMemo.trim() ? ` — ${packMemo.trim()}` : ''}`,
            });
            writeLog(`Pack Break: -${packQtyNum} ${packCode} / +${breakEachesBack} ${eachCode} (into ${destBin}).`, 'wms');
            if (!breakToCore) {
                alert(`✅ Unbuild #${first.id || ''} posted: ${packQtyNum} × ${packCode} → ${breakEachesBack} × ${eachCode} into ${destBin}.`);
            } else {
                // Second leg: the eaches back to the raw core, so the batch can be re-finished.
                try {
                    const eachAsm = await resolveItemDetail(eachCode);
                    if (!eachAsm) throw new Error(`${eachCode} not found in NetSuite`);
                    const second = await postConvertBuild({
                        mode: 'unbuild', itemId: eachAsm.id, quantity: breakEachesBack,
                        subsidiary: nsConfig.subsidiary, location: nsConfig.location,
                        bin: destBin, toBin: coreBin,
                        memo: `Pack break to core by ${operator?.name || 'Unknown'}`,
                    });
                    writeLog(`Pack Break to core: -${breakEachesBack} ${eachCode} / +${breakEachesBack} ${packRoot} (into ${coreBin}).`, 'wms');
                    alert(`✅ Both posted: unbuild #${first.id || ''} (${packCode} → ${eachCode}) and #${second.id || ''} (${eachCode} → ${packRoot} into ${coreBin}).`);
                } catch (e2) {
                    // Honest partial state — the operator must know exactly where this stopped.
                    alert(`⚠ HALF DONE.\n\n✅ Step 1 posted: ${packQtyNum} × ${packCode} → ${breakEachesBack} × ${eachCode}, now sitting in ${destBin}.\n\n❌ Step 2 (${eachCode} → ${packRoot}) failed:\n${(e2 && e2.message) || e2}\n\nThe eaches ARE in stock. Re-run Break Apart on ${eachCode} when the cause is fixed.`);
                }
            }
            setPackQty(""); setBreakSrcScan(""); setBreakDestScan(""); setBreakCoreScan(""); setPackMemo("");
            pullNetSuiteStock();
        } catch (e) {
            console.error("Pack break failed:", e);
            alert("❌ NetSuite rejected the unbuild:\n\n" + (e.message || e));
        } finally { setIsSyncing(false); }
    };

    // ROD CUTS derived: validate the source (8 ft) bin against LIVE per-bin stock when we have it;
    // dest bin is free-form (created in NetSuite if new — and it may legitimately equal the source bin,
    // since the cut-down rods are a DIFFERENT item). Same live-bin principle as Transfer/Convert.
    const cutSrc = (cutSrcScan || '').trim();
    const cutDest = (cutDestScan || '').trim();
    const cutBins = activeCut ? (nsStock[String(activeCut.sourceItemId || '').toUpperCase()]?.bins || []).filter(b => b.bin) : [];
    const cutBinsKnown = !!activeCut && cutBins.length > 0;
    const cutSrcBin = cutBins.find(b => String(b.bin).toUpperCase() === cutSrc.toUpperCase());
    const cutSrcQty = cutSrcBin ? cutSrcBin.qty : 0;
    const cutSrcOk = cutBinsKnown ? (!!cutSrcBin && cutSrcQty >= ((activeCut && activeCut.qtySource) || 0)) : cutSrc !== '';
    const cutReady = !!activeCut && cutSrc !== '' && cutDest !== '' && cutConfirmed && cutSrcOk;

    const safeUserRole = operator?.role ? operator.role.toLowerCase() : 'operator';
    const myTabs = ['admin', 'superadmin'].includes(safeUserRole) ? TABS : (perms[safeUserRole] || perms['operator'] || TABS);
    // Click-to-pick bin chips show unless this role is on the HQ "Force Bin Scan" list (admins always keep it).
    const canClickBin = ['admin', 'superadmin'].includes(safeUserRole) || !(perms.forceScanRoles || []).includes(safeUserRole);
    // Management-only chip reports (per-step timers + who-did-what roll-up): admins + HQ-granted roles.
    const canSeeChipReport = ['admin', 'superadmin'].includes(safeUserRole) || (perms.chipReportRoles || []).includes(safeUserRole);
    // Admin-or-higher gate (normalize so SUPERADMIN / super_admin match) — used for restricted actions.
    const isPlatingAdmin = operator?.superAdmin === true || ['admin', 'superadmin'].includes(String(operator?.role || '').toLowerCase().replace(/[^a-z]/g, ''));
    // ── WHO MAY ISSUE A ROD CUT (Stuart 2026-08-25: "make it manager level and up access on
    // matrix") ────────────────────────────────────────────────────────────────────────────────
    // Issuing a cut commits 8 ft stock to being sawn in half, so it is manager-and-up by default —
    // but it reads the permissions matrix too, so the roles allowed to do it are a setting rather
    // than a line of code someone has to come back and edit.
    const ROD_CUT_ISSUE_CAP = 'ROD CUTS · ISSUE';
    const canIssueRodCuts = operator?.superAdmin === true
        || ['admin', 'superadmin', 'manager', 'executive'].includes(safeUserRole)
        || (perms[safeUserRole] || []).includes(ROD_CUT_ISSUE_CAP);

    if (!operator) {
        return (
            <div style={{ position: 'fixed', inset: 0, backgroundColor: theme.paper, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: theme.sans }}>
                <div style={{ background: '#fff', padding: '50px 40px', border: `1px solid ${theme.line}`, boxShadow: '0 4px 24px rgba(0,0,0,0.02)', width: '400px', textAlign: 'center' }}>
                    <span style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.25em', textTransform: 'uppercase', color: theme.brass, display: 'block', marginBottom: '1rem' }}>WMS Portal</span>
                    <h2 style={{ fontFamily: theme.serif, margin: '0 0 30px 0', fontSize: '2.2rem', fontWeight: 500, color: theme.ink }}>Pick & Pack</h2>
                    <form onSubmit={attemptLogin}>
                        <input type="password" value={pinInput} onChange={e => setPinInput(e.target.value)} placeholder="ENTER PIN" maxLength="4" style={{ width: '100%', padding: '15px', border: `1px solid ${theme.line}`, marginBottom: '20px', boxSizing: 'border-box', textAlign: 'center', fontSize: '1.5rem', letterSpacing: '10px', fontFamily: theme.mono, color: theme.ink, outline: 'none' }} />
                        <button type="submit" style={{ width: '100%', padding: '15px', background: theme.ink, color: '#fff', fontWeight: 400, fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.18em', textTransform: 'uppercase', cursor: 'pointer', border: 'none', transition: 'background 0.2s' }} onMouseOver={(e) => e.currentTarget.style.background = theme.brass} onMouseOut={(e) => e.currentTarget.style.background = theme.ink}>LOGIN</button>
                    </form>
                    <button onClick={() => window.location.href = '/'} style={{ marginTop: '30px', background: 'none', border: 'none', color: theme.inkSoft, cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', borderBottom: `1px solid ${theme.brass}`, paddingBottom: '2px' }}>← BACK TO HUB</button>
                </div>
            </div>
        );
    }

    if (activePickJob) {
        const line = activePickJob.partsList[currentPickLine];
        return (
            <div style={{ position: 'fixed', inset: 0, backgroundColor: theme.paper, color: theme.ink, zIndex: 9999, display: 'flex', flexDirection: 'column', padding: '40px', fontFamily: theme.sans }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: `1px solid ${theme.line}`, paddingBottom: '20px', marginBottom: '40px' }}>
                    <h1 title={activePickJob.id} style={{ margin: 0, fontSize: '2.5rem', fontFamily: theme.serif, fontWeight: 500, color: theme.ink }}>Picking: {packRef(activePickJob)}{pickSkips.length > 0 && <span style={{ fontFamily: theme.mono, fontSize: '0.9rem', color: '#d9534f', marginLeft: '16px' }}>⚠ {pickSkips.length} SKIPPED</span>}</h1>
                    <button onClick={() => { releaseClaim(activePickJob, 'pick'); setActivePickJob(null); setPickSkips([]); setPickShorts([]); setValidation({ bin: '', qty: '' }); }} style={{ background: 'transparent', color: theme.inkSoft, border: `1px solid ${theme.line}`, padding: '15px 30px', fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.2s' }} onMouseOver={(e) => { e.currentTarget.style.color = theme.ink; e.currentTarget.style.borderColor = theme.ink; }} onMouseOut={(e) => { e.currentTarget.style.color = theme.inkSoft; e.currentTarget.style.borderColor = theme.line; }}>ABORT PICK</button>
                </div>

                {showNacho ? (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ fontSize: '6rem' }}>🐕</div>
                        <h2 style={{ color: theme.brass, fontFamily: theme.serif, fontSize: '2.5rem', fontWeight: 500, margin: '20px 0' }}>Order Complete.</h2>
                        <p style={{ fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.1em', color: theme.inkSoft, textTransform: 'uppercase' }}>Printing Staging Label...</p>
                    </div>
                ) : (
                    <div style={{ flex: 1, display: 'flex', gap: '40px' }}>
                        <div style={{ flex: 1, background: '#fff', padding: '40px', border: `1px solid ${theme.line}`, boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
                            <div style={{ fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.1em', color: theme.inkSoft, textTransform: 'uppercase' }}>Item {currentPickLine + 1} of {activePickJob.partsList.length}</div>
                            <div style={{ fontSize: '1.5rem', fontFamily: theme.mono, color: theme.ink, fontWeight: 600, letterSpacing: '.04em', margin: '18px 0 6px' }}>ITEM #: {line.legacyErpId || line.partId || 'UNASSIGNED'}</div>
                            <div style={{ fontSize: '2.2rem', fontWeight: 300, color: theme.ink, margin: '0 0 18px', fontFamily: theme.serif }}>{line.name}</div>
                            <div style={{ fontSize: '1.2rem', fontFamily: theme.mono, color: theme.brass, marginBottom: '8px' }}>BIN: {lineBin(line)}</div>
                            <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft, marginBottom: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', flexWrap: 'wrap' }}>
                                {(() => { const lv = liveOf(line); return lv
                                    ? <span>{lv.bins.length ? `LIVE: ${lv.bins.slice(0, 3).map(b => `${b.bin} ×${b.qty}`).join(' · ')}${lv.bins.length > 3 ? ' · …' : ''}` : (lv.total > 0 ? `LIVE: ${lv.total} on hand, no bin` : 'LIVE: none at this location')}</span>
                                    : <span>live stock not pulled yet</span>; })()}
                                <button onClick={() => fetchLiveBins([line.legacyErpId || line.partId])} title="Re-pull live per-bin stock from NetSuite" style={{ background: 'transparent', border: `1px solid ${theme.line}`, color: theme.ink, padding: '3px 8px', fontFamily: theme.mono, fontSize: '9px', cursor: 'pointer' }}>⟳ Live</button>
                            </div>
                            
                            {(() => {
                                const sh = shortageOfLine(activePickJob, line);
                                if (!sh) return null;
                                const routed = !!routedShorts[sh.code];
                                return (
                                    <div style={{ margin: '0 0 24px', padding: '16px', background: routed ? '#f2f7f2' : '#fdf3f3', border: `1px solid ${routed ? '#9dbf9d' : '#e2b8b8'}` }}>
                                        <div style={{ fontFamily: theme.mono, fontSize: '11px', color: routed ? '#3a7d44' : '#a33', letterSpacing: '.05em' }}>
                                            {routed ? `✓ ${sh.short} ROUTED TO PLATING` : `SHORT ${sh.short}`} — this order needs {sh.need} of {sh.code}, stock holds {sh.have}.
                                        </div>
                                        {routed ? (
                                            <div style={{ fontFamily: theme.sans, fontSize: '0.85rem', color: theme.inkSoft, marginTop: '8px' }}>Pick what is in the bin and confirm the SHORT quantity — the remainder is covered by the plating order.</div>
                                        ) : sh.plateable ? (
                                            <>
                                                <div style={{ fontFamily: theme.sans, fontSize: '0.85rem', color: theme.ink, marginTop: '8px' }}>
                                                    Mill core {sh.mill} has {sh.millAvail} available — {sh.millAvail >= sh.short ? 'enough to cover the short.' : (sh.millAvail > 0 ? `covers ${sh.millAvail}, the other ${sh.short - sh.millAvail} needs cores made.` : 'no cores in mill finish either, so this one has to be made.')}
                                                </div>
                                                <button type="button" onClick={() => routeShortToPlating(activePickJob, sh)} style={{ marginTop: '12px', padding: '12px 18px', background: sh.millAvail <= 0 ? '#a33' : theme.brass, color: '#fff', border: `1px solid ${sh.millAvail <= 0 ? '#a33' : theme.brass}`, cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                                                    {sh.millAvail <= 0 ? `⚠ Flag ${sh.mill} urgent — make cores` : `⚗ Pull ${Math.min(sh.short, sh.millAvail)} mill → OB Plating${sh.millAvail < sh.short ? ` · flag ${sh.short - sh.millAvail}` : ''}`}
                                                </button>
                                            </>
                                        ) : (
                                            <div style={{ fontFamily: theme.sans, fontSize: '0.85rem', color: theme.inkSoft, marginTop: '8px' }}>No outsourced finish on this code, so there is no mill core to plate. Skip the line and flag it at staging.</div>
                                        )}
                                    </div>
                                );
                            })()}

                            <a href={line.assetUrl || '#'} target="_blank" rel="noreferrer" style={{ display: 'inline-block', background: 'transparent', border: `1px solid ${theme.line}`, color: theme.ink, padding: '15px 30px', fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.1em', textDecoration: 'none', textTransform: 'uppercase', transition: 'all 0.2s' }} onMouseOver={(e) => e.currentTarget.style.borderColor = theme.brass} onMouseOut={(e) => e.currentTarget.style.borderColor = theme.line}>
                                OPEN REFERENCE PHOTO
                            </a>
                        </div>

                        <div style={{ flex: 1, background: '#fff', padding: '40px', border: `1px solid ${theme.brass}`, boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
                            {/* "14 = 2 configs × 7" (Stuart 2026-08-26): the target is already the
                                multiplied total — say WHY it is doubled so the picker pulls it all
                                instead of second-guessing the count against the per-config viewer. */}
                            <h2 style={{ margin: '0 0 30px 0', fontFamily: theme.serif, fontSize: '2rem', color: theme.ink, fontWeight: 500 }}>
                                Target Qty: {lineQty(line)}
                                {Number(line.configQty) > 1 && (
                                    <span style={{ display: 'block', fontFamily: theme.mono, fontSize: '0.85rem', color: theme.brass, marginTop: '6px', letterSpacing: '.04em' }}>
                                        = {line.configQty} identical configs × {line.qtyEach != null ? line.qtyEach : Math.round(lineQty(line) / Number(line.configQty))} each — pull the full {lineQty(line)}
                                    </span>
                                )}
                            </h2>
                            <form onSubmit={handlePickValidation} style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                                <div>
                                    <label style={{ fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.1em', color: theme.inkSoft, display: 'block', marginBottom: '10px', textTransform: 'uppercase' }}>1. SCAN BIN BARCODE</label>
                                    <input autoFocus value={validation.bin} onChange={e => setValidation({...validation, bin: e.target.value})} style={{ width: '100%', padding: '15px', fontSize: '1.2rem', fontFamily: theme.mono, background: theme.paper, border: `1px solid ${theme.line}`, outline: 'none' }} />
                                </div>
                                <div>
                                    <label style={{ fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.1em', color: theme.inkSoft, display: 'block', marginBottom: '10px', textTransform: 'uppercase' }}>2. ENTER QTY PICKED</label>
                                    <input type="number" value={validation.qty} onChange={e => setValidation({...validation, qty: e.target.value})} style={{ width: '100%', padding: '15px', fontSize: '1.2rem', fontFamily: theme.mono, background: theme.paper, border: `1px solid ${theme.line}`, outline: 'none' }} />
                                </div>
                                <button type="submit" style={{ padding: '20px', background: theme.ink, color: '#fff', fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.1em', textTransform: 'uppercase', border: 'none', cursor: 'pointer', marginTop: '20px', transition: 'background 0.2s' }} onMouseOver={(e) => e.currentTarget.style.background = theme.brass} onMouseOut={(e) => e.currentTarget.style.background = theme.ink}>
                                    CONFIRM PICK
                                </button>
                                <button type="button" onClick={handleSkipLine} style={{ padding: '14px', background: 'transparent', color: '#d9534f', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', border: `1px solid ${theme.line}`, cursor: 'pointer', transition: 'all 0.2s' }} onMouseOver={(e) => e.currentTarget.style.borderColor = '#d9534f'} onMouseOut={(e) => e.currentTarget.style.borderColor = theme.line}>
                                    ⤼ Skip This Item — can't pick / not on order
                                </button>
                                <button type="button" onClick={handleSubstitutePick} style={{ padding: '14px', background: 'transparent', color: theme.brass, fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', border: `1px solid ${theme.line}`, cursor: 'pointer', transition: 'all 0.2s' }} onMouseOver={(e) => e.currentTarget.style.borderColor = theme.brass} onMouseOut={(e) => e.currentTarget.style.borderColor = theme.line}>
                                    ⇄ Substitute — pull an equivalent item instead
                                </button>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: theme.paper, fontFamily: theme.sans }}>
            
            {/* TABLET-FIRST HEADER (Stuart 2026-08-20: "the warehouse app is not filling the android
                tablet screen well and she often zooms in and out"). The title and a dozen tabs on one
                un-wrapping row are wider than a 1024 px tablet, so the PAGE scrolled sideways — which
                is what the zooming was working around. It wraps now, and the tab strip scrolls
                within itself rather than dragging the whole screen with it. */}
            <header style={{ backgroundColor: '#fff', borderBottom: `1px solid ${theme.line}`, padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                    <h1 style={{ fontFamily: theme.serif, margin: '0', fontSize: '1.6rem', fontWeight: 500, color: theme.ink, letterSpacing: '0.05em' }}>WMS: Pick & Pack</h1>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '5px' }}>
                        <span style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, letterSpacing: '.18em', textTransform: 'uppercase' }}>Operator: {operator?.name || 'Unknown'}</span>
                        <select value={activeBrand} onChange={(e) => setActiveBrand && setActiveBrand(e.target.value)} style={{ padding: '2px 5px', fontSize: '10px', fontFamily: theme.mono, background: 'transparent', color: theme.ink, border: `1px solid ${theme.line}`, outline: 'none', textTransform: 'uppercase' }}>
                            <option value="m2c">M2C Studio</option>
                            <option value="uniquity">Uniquity</option>
                            <option value="ce">Classical Elements</option>
                            <option value="leyla">Leyla Gans LLC</option>
                        </select>
                    </div>
                </div>
                {/* NO overflow HERE (Eric 2026-08-21: "Item/Order lookup renders the results under the
                    menu and menu returns scroll bars"). My tablet fix put overflowX:auto on this row
                    — but WhereIsIt lives in it, and an absolutely-positioned dropdown inside a
                    scroll container gets clipped into scrollbars instead of floating over the page.
                    flexWrap alone already stops the row pushing the page sideways, which was the
                    whole point; the overflow was belt-and-braces and cost more than it bought. */}
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', maxWidth: '100%' }}>
                    {/* 'APP IMP' is force-included — feedback stays reachable by every role. */}
                    {TABS.filter(t => myTabs.includes(t) || t === 'APP IMP').map(tab => (
                        <button key={tab} onClick={() => setActiveTab(tab)} style={{ padding: '10px 16px', background: 'transparent', color: activeTab === tab ? theme.ink : theme.inkSoft, borderBottom: activeTab === tab ? `2px solid ${theme.brass}` : '2px solid transparent', borderTop: 'none', borderLeft: 'none', borderRight: 'none', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.2s' }}>
                            {t(pickTabLabel(tab))}
                        </button>
                    ))}
                    <div style={{ width: '1px', background: theme.line, height: '20px', margin: '0 10px' }}></div>
                    <WhereIsIt orders={finAll} compact extras={[
                        ...convertDemands.map(d => ({ ...d, __kind: 'CONVERT' })),
                        ...platingDemands.map(d => ({ ...d, __kind: 'PLATING' })),
                        ...rodCutOrders.filter(o => o.status !== 'DONE' && o.status !== 'CANCELLED').map(o => ({ ...o, __kind: 'RODCUT' })),
                    ]} />
                    <div style={{ width: '1px', background: theme.line, height: '20px', margin: '0 10px' }}></div>
                    {/* ES / EN — per device. The tooltip is honest about partial coverage rather
                        than claiming the whole app is translated. */}
                    <div style={{ display: 'flex', border: `1px solid ${theme.line}` }}>
                        {Object.entries(LANGS).map(([code, label]) => (
                            <button key={code} onClick={() => setLang(code)}
                                title={code === 'en' ? 'Show the app in English' : `Mostrar la aplicación en español — ${coverageOf('es')} frases traducidas; lo que falte se queda en inglés`}
                                style={{ padding: '8px 12px', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer', border: 'none', background: lang === code ? theme.ink : 'transparent', color: lang === code ? '#fff' : theme.inkSoft }}>
                                {label === 'English' ? 'EN' : 'ES'}
                            </button>
                        ))}
                    </div>
                    <button onClick={handleLogout} style={{ padding: '8px 16px', fontSize: '10px', fontFamily: theme.mono, letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer', background: theme.ink, color: '#fff', border: 'none', transition: 'background 0.2s' }} onMouseOver={(e) => e.currentTarget.style.background = theme.brass} onMouseOut={(e) => e.currentTarget.style.background = theme.ink}>{t('HUB / LOGOUT')}</button>
                </div>
            </header>

            <main style={{ flex: 1, padding: '30px', overflowY: 'auto' }}>
                
                {/* 📦 TAB: PICK QUEUE */}
                {activeTab === 'QUEUE' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0', width: '100%' }}>
                    <HeldOrdersBanner orders={finAll.filter(j => (j.brand || 'ce') === activeBrand)} onRelease={resumeOrderHere} refOf={packRef} />
                    <div style={{ display: 'flex', gap: '30px', height: '100%', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                        <div style={{ flex: '1 1 380px', minWidth: 0, background: '#fff', border: `1px solid ${theme.line}`, display: 'flex', flexDirection: 'column', boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
                            <div style={{ padding: '20px', borderBottom: `1px solid ${theme.line}`, fontFamily: theme.serif, color: theme.ink, fontWeight: 500, fontSize: '1.4rem' }}>{t('Awaiting Pick (Small Parts)')}</div>

                            {/* PENDING — the pipeline, collapsed. Visibility without noise. */}
                            <div style={{ borderBottom: `1px solid ${theme.line}`, background: theme.paper }}>
                                <div onClick={() => setPendingOpen(v => !v)} title="Orders on their way to you — still being fabricated, cut, or not yet released by finishing."
                                    style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', userSelect: 'none' }}>
                                    <span style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>{pendingOpen ? '▾' : '▸'}</span>
                                    <span style={{ fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', color: theme.ink, fontWeight: 600 }}>{t('Pending')} · {pendingQueue.length}</span>
                                    <span style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft }}>{t('coming — not released to pick yet')}</span>
                                </div>
                                {pendingOpen && (
                                    <div style={{ padding: '0 20px 14px' }}>
                                        {pendingQueue.length === 0 && (
                                            <div style={{ color: theme.inkSoft, fontStyle: 'italic', fontFamily: theme.serif, fontSize: '0.9rem' }}>{t('Nothing upstream — everything raised has reached you.')}</div>
                                        )}
                                        {pendingQueue.map(j => (
                                            <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', padding: '9px 0', borderTop: `1px solid ${theme.paper2}` }}>
                                                <span style={{ fontFamily: theme.mono, fontSize: '0.85rem', color: theme.ink }}>{packRef(j)}</span>
                                                {woItemCodeOf(j) && <span style={{ fontFamily: theme.mono, fontSize: '0.8rem', color: theme.ink, fontWeight: 600 }}>{woItemCodeOf(j)}</span>}
                                                <span style={{ fontFamily: theme.sans, fontSize: '0.8rem', color: theme.inkSoft }}>×{j.totalParts || 0}{j.recipe ? ` · ${j.recipe}` : ''}</span>
                                                <span style={{ fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.06em', color: theme.brass, border: `1px solid ${theme.brass}`, padding: '2px 7px' }}>{t(pendingReasonOf(j))}</span>
                                                {(j.needBy || j.reqDate) && <span style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.inkSoft }}>{t('need by')} {j.needBy || j.reqDate}</span>}
                                                <button onClick={() => releasePendingNow(j)} title="Pick it now, ahead of the floor asking — it moves to Awaiting Pick and can be sent back at any time."
                                                    style={{ marginLeft: 'auto', background: 'transparent', border: `1px solid ${theme.line}`, color: theme.ink, padding: '6px 12px', fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', cursor: 'pointer' }}>▶ {t('Pick now')}</button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div style={{ padding: '20px', overflowY: 'auto' }}>
                                {jobs.filter(isOpenPick).sort((a, b) => Number(isOvertakenPick(a)) - Number(isOvertakenPick(b))).map(job => {
                                    const overtaken = isOvertakenPick(job);
                                    const so = soIndex[String(job.salesOrderId || '')] || soIndex[String(job.orderKey || '')] || null;
                                    const customer = job.customerName || job.clientName || so?.customer || '';
                                    const sidemark = so?.memo || job.note || '';
                                    const poNum = so?.poNum || so?.po || so?.otherrefnum || '';
                                    // ONE STOP PER ITEM, IN RACK ORDER (Stuart 2026-08-03). A custom
                                    // order's BOM is written per configuration, so the same code
                                    // repeats down the list and the operator walked back to the same
                                    // bin a dozen times. Merged here and sorted by bin — quantities
                                    // are summed, nothing is dropped.
                                    const rawPickable = pickableLines(job);
                                    const pickable = groupPickLines(rawPickable, { binOf: lineBin });
                                    const grouping = groupingSummary(rawPickable, pickable);
                                    return (
                                    <div key={job.id} style={{ border: `1px solid ${overtaken ? '#d9a648' : theme.line}`, borderLeft: overtaken ? '4px solid #d9a648' : `1px solid ${theme.line}`, marginBottom: '15px' }}>
                                        {/* Header row toggles the BOM detail; START PICKING stops propagation. */}
                                        <div onClick={() => { const opening = expandedJob !== job.id; setExpandedJob(opening ? job.id : null); if (opening) fetchLiveBins(pickable.map(l => l.legacyErpId || l.partId)); }} style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', cursor: 'pointer' }}>
                                            <div style={{ minWidth: 0 }}>
                                                <h3 style={{ margin: 0, fontFamily: theme.serif, fontSize: '1.2rem', fontWeight: 500 }}>
                                                    <span style={{ color: theme.inkSoft, fontFamily: theme.mono, fontSize: '0.9rem', marginRight: '8px' }}>{expandedJob === job.id ? '▾' : '▸'}</span><span title={job.id}>{packRef(job)}</span>
                                                </h3>
                                                {customer && <div style={{ color: theme.ink, fontFamily: theme.sans, fontSize: '0.95rem', fontWeight: 500, marginTop: '5px' }}>{customer}</div>}
                                                {/* THE ITEM, ON THE CARD (Stuart 2026-08-17: "no pattern# nothing").
                                                    A stock build's whole identity is its code — the header showed
                                                    only the WO ref, so the warehouse had to expand the row to learn
                                                    what it was picking. */}
                                                {(() => { const c = woItemCodeOf(job), n = woItemNameOf(job); return c ? (
                                                    <div style={{ color: theme.ink, fontFamily: theme.mono, fontSize: '0.9rem', fontWeight: 600, marginTop: '4px' }}>
                                                        {c}{n ? <span style={{ color: theme.inkSoft, fontFamily: theme.sans, fontWeight: 400 }}> · {n}</span> : null}
                                                    </div>
                                                ) : null; })()}
                                                {(sidemark || poNum) && (
                                                    <div style={{ color: theme.inkSoft, fontFamily: theme.mono, fontSize: '10px', marginTop: '3px', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                                                        {sidemark ? `REF: ${sidemark}` : ''}{sidemark && poNum ? '  ·  ' : ''}{poNum ? `PO: ${poNum}` : ''}
                                                    </div>
                                                )}
                                                <OrderStatusChips wo={job} style={{ marginTop: '8px' }} />
                                                {renderClaimLine(job, 'pick')}
                                                <div style={{ color: theme.inkSoft, fontFamily: theme.mono, fontSize: '11px', marginTop: '5px' }}>{pickable.length} Line Item{pickable.length === 1 ? '' : 's'}{grouping.changed ? ` (${grouping.from} BOM lines grouped into ${grouping.to} picks)` : ''}{rawPickable.length !== (job.partsList?.length || 0) ? ` · ${(job.partsList?.length || 0) - rawPickable.length} return/fee line(s) ride the shop order` : ''} · tap for parts</div>
                                            </div>
                                            <button disabled={claimBlocks(job, 'pick')} onClick={async (e) => { e.stopPropagation();
                                                // CLAIM FIRST — the pick opens only once the order doc says it is ours.
                                                let r;
                                                try { r = await claimOrder(job, 'pick'); } catch (err) { return alert('Could not start the pick: ' + (err.message || err)); }
                                                if (!r.ok) return alert(`${r.claim.by} ${t('is picking this')} — ${t('since')} ${claimSince(r.claim)}.\n\n${t('Pick a different order, or ask them (or an admin) to release it.')}`);
                                                setActivePickJob({ ...job, partsList: pickable }); setCurrentPickLine(0); setPickSkips([]); setPickShorts([]); setValidation({ bin: '', qty: '' }); fetchLiveBins(pickable.map(l => l.legacyErpId || l.partId)); }} style={{ padding: '10px 20px', background: claimBlocks(job, 'pick') ? theme.paper2 : theme.ink, color: claimBlocks(job, 'pick') ? theme.inkSoft : '#fff', cursor: claimBlocks(job, 'pick') ? 'not-allowed' : 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', border: 'none', transition: 'background 0.2s', whiteSpace: 'nowrap' }} onMouseOver={(e) => { if (!claimBlocks(job, 'pick')) e.currentTarget.style.background = theme.brass; }} onMouseOut={(e) => { if (!claimBlocks(job, 'pick')) e.currentTarget.style.background = theme.ink; }}>
                                                START PICKING
                                            </button>
                                        </div>
                                        {/* One status in one place — production wins. The pick stays actionable
                                            (the floor may genuinely still need the pull), but it is never presented
                                            as ordinary waiting work once the floor has moved past setup. */}
                                        {overtaken && (
                                            <div style={{ margin: '0 20px 16px', padding: '10px 14px', background: '#fdf6ec', border: '1px solid #d9a648', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                                                <span style={{ fontFamily: theme.sans, fontSize: '0.85rem', color: '#8a6d3b' }}>⚠ Already <strong>in production</strong> on the finishing floor — this pick was overtaken. Pull the parts now if the floor still needs them, or clear it.</span>
                                                <button onClick={(e) => { e.stopPropagation(); clearOvertakenPick(job); }} style={{ padding: '8px 14px', background: 'transparent', color: '#8a6d3b', border: '1px solid #d9a648', cursor: 'pointer', fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', whiteSpace: 'nowrap' }}>✕ Clear Pick — parts on the floor</button>
                                            </div>
                                        )}
                                        {expandedJob === job.id && (
                                            <div style={{ borderTop: `1px solid ${theme.line}`, background: theme.paper, padding: '8px 20px 16px' }}>
                                                <div style={{ fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.1em', textTransform: 'uppercase', color: theme.inkSoft, display: 'flex', gap: '12px', alignItems: 'center', padding: '10px 0 6px', borderBottom: `1px solid ${theme.line}` }}>
                                                    <span style={{ flex: 1 }}>Part</span><span style={{ width: '130px' }}>Bin (live)</span><span style={{ width: '40px', textAlign: 'right' }}>Qty</span>
                                                    <button onClick={() => fetchLiveBins(pickable.map(l => l.legacyErpId || l.partId))} title="Re-pull live per-bin stock from NetSuite" style={{ background: 'transparent', border: `1px solid ${theme.line}`, color: theme.ink, padding: '3px 8px', fontFamily: theme.mono, fontSize: '9px', cursor: 'pointer' }}>⟳ Live</button>
                                                </div>
                                                {pickable.length === 0 && <div style={{ padding: '12px 0', fontFamily: theme.sans, fontSize: '0.85rem', color: theme.inkSoft, fontStyle: 'italic' }}>No pickable parts on this order.</div>}
                                                {/* SHORT = the order needs more than the bins hold. Counted per ITEM across the
                                                    order, so two 100-pc lines of the same code read as 200 against a 100 bin. */}
                                                {shortagesFor(job).map(sh => (
                                                    <div key={sh.code} style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', margin: '10px 0', padding: '10px 12px', background: '#fdf3f3', border: '1px solid #e2b8b8' }}>
                                                        <div style={{ flex: 1, minWidth: '240px', fontFamily: theme.mono, fontSize: '11px', color: '#a33' }}>
                                                            SHORT {sh.short} · {sh.code} needs {sh.need}, stock has {sh.have}
                                                            {sh.plateable ? <span style={{ color: theme.inkSoft }}> — mill {sh.mill}: {sh.millAvail} available</span> : <span style={{ color: theme.inkSoft }}> — no outsourced finish on this code</span>}
                                                        </div>
                                                        {(() => {
                                                            // "stock has 0" covered two unrelated problems and sent people
                                                            // hunting for parts when the answer was a bad item record.
                                                            const h = codeHealth(sh.code, { part: findPartByErpCode(sh.code), live: liveBins[sh.code] || null });
                                                            if (!isDataProblem(h.state)) return null;
                                                            return (
                                                                <div style={{ flexBasis: '100%', marginTop: '2px', padding: '8px 10px', background: '#fff', border: '1px solid #e2b8b8' }}>
                                                                    <div style={{ fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', color: '#a33' }}>⚠ This is not a shortage — {h.label}</div>
                                                                    <div style={{ fontFamily: theme.sans, fontSize: '0.82rem', color: theme.ink, marginTop: '4px', lineHeight: 1.45 }}>{h.detail}</div>
                                                                </div>
                                                            );
                                                        })()}
                                                        {sh.plateable && (() => {
                                                            const noMill = sh.millAvail <= 0;
                                                            return (
                                                                <button onClick={(e) => { e.stopPropagation(); routeShortToPlating(job, sh); }}
                                                                    title={noMill ? `No mill cores — flags ${sh.mill} as urgent on the Stocked Sales Snapshot to be work-ordered` : `Pull ${Math.min(sh.short, sh.millAvail)} × ${sh.mill} into OB PLATING${sh.millAvail < sh.short ? ` and flag the remaining ${sh.short - sh.millAvail} core(s) as urgent` : ''}`}
                                                                    style={{ padding: '8px 14px', background: noMill ? '#a33' : theme.brass, color: '#fff', border: `1px solid ${noMill ? '#a33' : theme.brass}`, cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', whiteSpace: 'nowrap' }}>
                                                                    {noMill ? '⚠ Flag urgent — make cores' : (sh.millAvail < sh.short ? `⚗ Mill ×${sh.millAvail} + flag ${sh.short - sh.millAvail}` : '⚗ Mill → OB Plating')}
                                                                </button>
                                                            );
                                                        })()}
                                                    </div>
                                                ))}
                                                {pickable.map((l, i) => (
                                                    <div key={i} style={{ display: 'flex', gap: '12px', alignItems: 'baseline', padding: '8px 0', borderBottom: `1px solid ${theme.line}` }}>
                                                        <div style={{ flex: 1, minWidth: 0 }}>
                                                            <span style={{ fontFamily: theme.mono, fontSize: '11px', fontWeight: 600, color: theme.ink }}>{l.legacyErpId || l.partId || '—'}</span>
                                                            <span style={{ fontFamily: theme.sans, fontSize: '0.85rem', color: theme.inkSoft, marginLeft: '8px' }}>{l.name}</span>
                                                            {l.mergedFrom > 1 && <span title={`${l.mergedFrom} BOM lines for this code, picked in one go`} style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.brass, marginLeft: '8px', border: `1px solid ${theme.brass}`, padding: '1px 5px', whiteSpace: 'nowrap' }}>×{l.mergedFrom} lines</span>}
                                                        </div>
                                                        <span style={{ width: '130px', fontFamily: theme.mono, fontSize: '11px', color: theme.brass }} title={(liveOf(l)?.bins || []).map(b => `${b.bin}: ${b.qty}`).join(' · ') || 'no live data yet — tap ⟳ Live'}>
                                                            {lineBin(l)}{(() => { const lv = liveOf(l); return lv ? <span style={{ color: lv.bins.length ? '#3a7d44' : '#d9534f' }}> · {lv.bins.length ? `${lv.bins[0].qty} live` : (lv.total > 0 ? `${lv.total} unbinned` : 'none live')}</span> : null; })()}
                                                        </span>
                                                        <span style={{ width: '40px', textAlign: 'right', fontFamily: theme.mono, fontSize: '11px', color: theme.ink }}>{Number(l.quantity ?? l.qty) || ''}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    );
                                })}
                                {jobs.filter(isOpenPick).length === 0 && (
                                    <div style={{ color: theme.inkSoft, fontStyle: 'italic', fontFamily: theme.serif }}>No orders currently require picking.</div>
                                )}
                            </div>
                        </div>

                        <div style={{ flex: '1 1 360px', minWidth: 0, maxWidth: '100%', background: '#fff', border: `1px solid ${theme.line}`, display: 'flex', flexDirection: 'column', boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
                            <div style={{ padding: '20px', borderBottom: `1px solid ${theme.line}`, fontFamily: theme.serif, color: theme.ink, fontWeight: 500, fontSize: '1.4rem' }}>Staging Handshake</div>
                            <div style={{ padding: '20px' }}>
                                <p style={{ color: theme.inkSoft, fontFamily: theme.sans, fontSize: '0.9rem', marginBottom: '20px' }}>Scan both labels. They must resolve to the <strong>same</strong> order — small-only orders need only the first scan.</p>
                                <form onSubmit={handleStagingMatch}>
                                    <label style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', color: theme.inkSoft, display: 'block', marginBottom: '8px', textTransform: 'uppercase' }}>1. Small-Parts Label</label>
                                    <input autoFocus placeholder="SCAN SMALL-PARTS LABEL..." value={stagingSmallScan} onChange={e => setStagingSmallScan(e.target.value)} style={{ width: '100%', padding: '15px', fontSize: '1rem', fontFamily: theme.mono, border: `1px solid ${theme.line}`, boxSizing: 'border-box', outline: 'none', marginBottom: '16px' }} />
                                    <label style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', color: theme.inkSoft, display: 'block', marginBottom: '8px', textTransform: 'uppercase' }}>2. Custom Shop Label <span style={{ textTransform: 'none', letterSpacing: 0 }}>(if any)</span></label>
                                    <input placeholder="SCAN CUSTOM SHOP LABEL..." value={stagingCustomScan} onChange={e => setStagingCustomScan(e.target.value)} style={{ width: '100%', padding: '15px', fontSize: '1rem', fontFamily: theme.mono, border: `1px solid ${theme.line}`, boxSizing: 'border-box', outline: 'none' }} />
                                    <button type="submit" style={{ width: '100%', padding: '15px', background: theme.brass, color: '#fff', fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.1em', textTransform: 'uppercase', marginTop: '16px', border: 'none', cursor: 'pointer' }}>VERIFY & STAGE</button>
                                </form>

                                <div style={{ marginTop: '30px', borderTop: `1px solid ${theme.line}`, paddingTop: '20px' }}>
                                    <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '15px' }}>PICKED — AWAITING STAGING:</div>
                                    {/* An order that has already been PACKED/put away is finished — it must not
                                        still read "awaiting staging" (Stuart 2026-08-03: "you can see items still
                                        sitting in pick, that must be marked as picked"). pickStatus alone never
                                        cleared, so a WO that had been through packing hours ago still sat here. */}
                                    {jobs.filter(j => j.pickStatus === 'Picked_Awaiting_Staging' && j.packStatus !== 'Packed' && j.currentPhase !== 'Closed').map(job => {
                                        const custReady = customPartsReady(job);
                                        const open = expandedStaged === job.id;
                                        const so = soIndex[String(job.salesOrderId || '')] || soIndex[String(job.soNum || '')] || null;
                                        return (
                                            <div key={job.id} style={{ background: theme.paper, border: `1px solid ${theme.line}`, marginBottom: '8px' }}>
                                                {/* Header row — tap to expand; NetSuite ref leads once posted (long id in the detail). */}
                                                <div onClick={() => setExpandedStaged(open ? null : job.id)} title={job.id} style={{ padding: '12px', fontSize: '0.9rem', fontFamily: theme.mono, color: theme.ink, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                                                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><span style={{ color: theme.inkSoft, marginRight: '6px' }}>{open ? '▾' : '▸'}</span>{packRef(job)}</span>
                                                    <span style={{ fontSize: '0.72rem', color: custReady ? '#3a7d44' : theme.brass, whiteSpace: 'nowrap' }}>
                                                        {!job.hasCustomSibling ? '● small-only' : (custReady ? '● custom ready' : '○ awaiting shop')}
                                                    </span>
                                                </div>
                                                {/* The same chips as everywhere else — this panel said only "small-only",
                                                    so a row gave no clue whether finishing had moved on (2026-08-03). */}
                                                <div style={{ padding: '0 12px 10px' }}><OrderStatusChips wo={job} showWho={false} /></div>
                                                {open && (
                                                    <div style={{ borderTop: `1px solid ${theme.line}`, padding: '10px 12px', fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft, lineHeight: 1.8 }}>
                                                        {(job.nsWoTran || job.soNum) && <div style={{ color: theme.ink }}>{job.nsWoTran ? `NetSuite WO: ${job.nsWoTran}` : ''}{job.nsWoTran && job.soNum ? ' · ' : ''}{job.soNum ? `SO: ${job.soNum}` : ''}</div>}
                                                        <div>Item: <span style={{ color: theme.ink }}>{job.stockErpId || job.type || '—'}</span> · Qty: <span style={{ color: theme.ink }}>{job.totalParts || 0}</span>{job.recipe ? <> · Finish: <span style={{ color: theme.ink }}>{job.recipe}</span></> : null}</div>
                                                        <div>Customer: {job.customerName || job.clientName || job.customer || '—'}{so && (so.sidemark || so.memo) ? ` · REF: ${so.sidemark || so.memo}` : ''}</div>
                                                        {job.pickHadSkips && <div style={{ color: '#d9534f' }}>⚠ picked with {(job.pickSkips || []).length} skipped line(s) — resolve before staging</div>}
                                                        {job.hasCustomSibling && <div>Shop custom parts: {job.customFabStatus || 'Pending'}</div>}
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
                                                            <button onClick={(e) => { e.stopPropagation(); printZebraLabel(job, 'SMALL_PARTS'); }} title="Reprint the setup label — scanned at the handshake, then rides the fixture into finishing" style={{ background: 'transparent', border: `1px solid ${theme.line}`, color: theme.ink, padding: '5px 10px', fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', cursor: 'pointer' }}>🖨 Setup Label</button>
                                                            {/* THE WAY BACK (Sandra 2026-08-20: "necesito agregar un botón para poder
                                                                regresar las órdenes al pick queue nuevamente y así no acumular work
                                                                orders en la lista"). A pick was one-way: once it flipped to
                                                                Picked_Awaiting_Staging nothing could put it back, so anything picked
                                                                early or in error sat in this list until it was staged. */}
                                                            <button onClick={(e) => { e.stopPropagation(); returnToPickQueue(job); }} title="Send this order back to Awaiting Pick — use it when it was picked early, picked in error, or the parts went back on the shelf." style={{ background: 'transparent', border: `1px solid ${theme.brass}`, color: theme.brass, padding: '5px 10px', fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', cursor: 'pointer' }}>↩ {t('Back to Pick Queue')}</button>
                                                            <span style={{ fontSize: '9px', color: theme.inkSoft }}>{job.id}</span>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                    {jobs.filter(j => j.pickStatus === 'Picked_Awaiting_Staging').length === 0 && (
                                        <div style={{ color: theme.inkSoft, fontStyle: 'italic', fontFamily: theme.serif, fontSize: '0.95rem' }}>Nothing picked and awaiting staging.</div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                    </div>
                )}

                {/* 📦 TAB: STOCK / QUICK SHIP — pre-finished stocked orders, kept apart from custom */}
                {activeTab === 'STOCK' && (() => {
                    // RING PACKS (Stuart 2026-07-17): "BASE/FIN-EA" = the stocked SINGLE on the shelf;
                    // "BASE/FIN-7/-10/-12" (digits, with an -EA sibling in the library) = customer pack
                    // ASSEMBLIES of that single. The floor picks SINGLES; confirming the pick queues a
                    // NetSuite ASSEMBLY BUILD per pack line (consumes the -EA per the pack's BOM) so the
                    // sales order can be fulfilled/packed in NetSuite.
                    const findPartByErp = (erp) => hqParts.find(p => String(p.legacyErpId || p.itemId || '').toUpperCase() === erp);
                    const packOf = (l) => {
                        const erp = String(l.erp || '').toUpperCase();
                        const m = erp.match(/^(.+\/[A-Z0-9]+)-(\d+)$/);
                        if (!m) return null;
                        const singleErp = `${m[1]}-EA`;
                        if (!findPartByErp(singleErp)) return null; // no -EA sibling → not a pack
                        return { size: parseInt(m[2]), singleErp };
                    };
                    const setQSStatus = async (o, status) => {
                        // Flow discipline: Pick (here) → Pack (PACKING tab, photo required) → Ship.
                        // TO-BE-FINISHED LINES HOLD (Stuart 2026-08-30): production may still be
                        // running — this SO's completed work MEETS it here; marking it moved with
                        // made-to-order lines outstanding ships a box missing its parts. The linked
                        // work orders are checked LIVE, not assumed.
                        const tbf = (o.lines || []).filter(l => l.toBeFinished);
                        if (tbf.length) {
                            let openWos = [];
                            try {
                                const ws = await getDocs(query(collection(db, 'hq_work_orders'), where('soAppId', '==', o.id)));
                                openWos = ws.docs.map(d => ({ id: d.id, ...d.data() }))
                                    .filter(w => !w.deleted && !['Closed', 'Deleted', 'CANCELLED'].includes(String(w.status || '')))
                                    .filter(w => w.floorPhase !== 'Complete' && String(w.status) !== 'Completed' && String(w.status) !== 'Built');
                            } catch (e) { console.warn('TBF production check failed', e); }
                            if (openWos.length && !window.confirm(`⏳ SO ${o.soId || o.id} has ${tbf.length} TO-BE-FINISHED line(s) and ${openWos.length} work order(s) STILL IN PRODUCTION:\n\n${openWos.slice(0, 6).map(w => `• ${w.nsWoTran || w.woDisplayId || w.id} — ${w.rootItem || ''} (${(w.awaitingConvert && 'awaiting convert') || (w.awaitingComponents && !w.componentsDone && 'awaiting milling') || w.floorPhase || w.status})`).join('\n')}${openWos.length > 6 ? `\n…and ${openWos.length - 6} more` : ''}\n\nPACK & HOLD until every part arrives is the model. Mark it ${status} anyway?`)) return;
                        }
                        if (status === 'Shipped' && o.packStatus !== 'Packed' && !window.confirm(`SO ${o.soId || o.id} has NOT been packed on the PACKING tab (piece-by-piece confirm + photo).\n\nShip anyway?`)) return;
                        try {
                            await updateDoc(doc(db, "hq_sales_orders", o.id), { status, pickStatus: status });
                            writeLog(`Quick Ship ${o.id} → ${status}`, 'STOCK');
                            if (status === 'Picked' && !o.packBuildsQueued) {
                                const packs = (o.lines || []).map(l => { const pk = packOf(l); return pk ? { l, pk, part: findPartByErp(String(l.erp).toUpperCase()) } : null; }).filter(Boolean);
                                if (packs.length) {
                                    const nsCfg = BRAND_NETSUITE_MAP[activeBrand] || { subsidiary: '2', location: '17' };
                                    let queued = 0; const skipped = [];
                                    for (const p of packs) {
                                        if (!p.part?.netSuiteInternalId) { skipped.push(p.l.erp); continue; }
                                        await enqueueNsWrite({
                                            kind: 'assemblybuild',
                                            label: `Build ${p.l.qty} × ${p.l.erp} (${(Number(p.l.qty) || 0) * p.pk.size} × ${p.pk.singleErp}) — SO ${o.soId || o.id}`,
                                            sourceApp: 'WMS', createdBy: operator?.name || '',
                                            targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/assemblybuild',
                                            method: 'POST',
                                            payload: {
                                                item: { id: String(p.part.netSuiteInternalId) },
                                                quantity: Number(p.l.qty) || 1,
                                                location: { id: nsCfg.location },
                                                subsidiary: { id: nsCfg.subsidiary },
                                                memo: `Pack build for SO ${o.soId || o.id} — picked as singles`
                                            },
                                            writeBack: { collection: 'hq_sales_orders', docId: o.id, patch: { packBuildsPosted: true } }
                                        });
                                        queued++;
                                    }
                                    if (queued) await updateDoc(doc(db, "hq_sales_orders", o.id), { packBuildsQueued: true });
                                    writeLog(`Queued ${queued} pack assembly build(s) for ${o.id}${skipped.length ? ` — ⚠ skipped (no NS id): ${skipped.join(', ')}` : ''}`, 'STOCK');
                                    if (queued || skipped.length) alert(`📦 ${queued} pack assembly build(s) queued to NetSuite (watch 11.1 → NetSuite Sync Queue).${skipped.length ? `\n\n⚠ Skipped — no NetSuite id (sync these items): ${skipped.join(', ')}` : ''}`);
                                }
                            }
                        }
                        catch (e) { alert('Update failed: ' + e.message); }
                    };
                    // ── SO PACK SHOWS BOTH DOORS (Stuart 2026-09-03: "so pack shows both, but
                    // packaging prep does the heavy lifting") ──────────────────────────────────────
                    // A CPQ order is a different animal and the card says so honestly rather than
                    // faking the four numbers. Its sales-order doc carries NO lines[] at all — the
                    // parts live on the fin_workorders RTG split out of it — so there is nothing to
                    // ask NetSuite about per line. What the warehouse actually needs from a custom
                    // order is WHERE ITS PIECES ARE: which floor documents exist, what each is doing,
                    // and whether anything is already gathered in the order's committed bin. That is
                    // the view; the packing itself stays on Packaging Prep, which is the heavy
                    // lifting Stuart means.
                    const cpqOrders = Object.values(soIndex)
                        .filter((so, i, arr) => arr.findIndex(x => x.id === so.id) === i)   // soIndex is keyed twice
                        .filter(so => so && (so.brand || 'ce') === activeBrand && so.orderClass !== 'QUICKSHIP'
                            && !so.deleted && !['Shipped', 'Closed', 'Deleted'].includes(String(so.status || '')))
                        .map(so => ({ so, docs: finAll.filter(f => f.salesOrderId && (f.salesOrderId === so.id || String(f.salesOrderId) === String(so.soId || ''))) }))
                        .filter(x => x.docs.length)
                        .sort((a, b) => String(a.so.needBy || a.so.needByDate || '￿').localeCompare(String(b.so.needBy || b.so.needByDate || '￿')));
                    const open = quickShipOrders.filter(o => (o.status || 'Pending') !== 'Shipped');
                    const shipped = quickShipOrders.filter(o => o.status === 'Shipped');
                    // Load the four numbers for the OPEN orders only, once each (soStatsRef), and
                    // never for shipped history — it is a NetSuite round trip per batch and a
                    // Firestore read per order, and history cannot change.
                    if (open.length) loadSoStats(open);
                    // COLLAPSED UNTIL IT IS WHOLE, then green and open (Stuart 2026-09-03). Not
                    // decoration: an order missing parts is not work the packer can do, and a screen
                    // that presents it identically to a ready one is what sends someone to a shelf
                    // for a piece still at the plater. An order the numbers cannot answer for yet
                    // stays neutral and open rather than pretending either way.
                    const Card = ({ o }) => {
                    const ready = orderReady(o);
                    const loaded = !!soStats[o.id];
                    const showLines = !!expandedSo[o.id] || ready || !loaded;
                    return (
                        <div style={{ border: `1px solid ${ready ? '#3a7d44' : theme.line}`, boxShadow: ready ? '0 0 0 2px rgba(58,125,68,0.18)' : 'none', marginBottom: '16px', background: '#fff' }}>
                            <div style={{ padding: '14px 18px', borderBottom: `1px solid ${theme.line}`, background: theme.paper, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                    <span style={{ fontFamily: theme.serif, fontSize: '1.2rem', color: theme.ink, fontWeight: 500 }}>{o.customer || 'Customer'}</span>
                                    <span style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, marginLeft: '12px' }}>SO {o.soId || o.id} · {o.totalParts || 0} pcs{o.jobName ? ` · ${o.jobName}` : ''}</span>
                                    {/* ONE DATE KEY (Brief E's header): `needBy`. `needByDate` and
                                        `reqDate` are aliases E writes equal to it for one release,
                                        kept here only so orders saved BEFORE the header landed still
                                        show a date. E deletes the aliases once every reader has
                                        moved; this one has. */}
                                    {(o.needBy || o.needByDate) && <span style={{ fontFamily: theme.mono, fontSize: '10px', fontWeight: 700, color: '#d9534f', marginLeft: '12px' }}>{t('NEED BY')} {o.needBy || o.needByDate}</span>}
                                    {/* Made-to-order lines arrive from the floors over days/weeks — the order
                                        typically PACKS & HOLDS in a bin until every part is in. */}
                                    {(o.lines || []).some(l => l.toBeFinished) && <span style={{ fontFamily: theme.mono, fontSize: '9px', fontWeight: 700, color: theme.brass, marginLeft: '12px', letterSpacing: '.05em' }}>📦 PACK &amp; HOLD — parts arrive from the floors</span>}
                                    {o.productionNotes && <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.ink, marginTop: '4px' }}>📝 {o.productionNotes}</div>}
                                </div>
                                <span onClick={() => setExpandedSo(p => ({ ...p, [o.id]: !p[o.id] }))} title={showLines ? 'Collapse' : 'Show the lines anyway'} style={{ cursor: 'pointer', fontFamily: theme.mono, fontSize: '11px', marginRight: '10px', color: theme.inkSoft }}>{showLines ? '▾' : '▸'}</span>
                                {finishAsAvailable(o) && <span title={`Parts go to finishing AS THEY ARRIVE instead of waiting for the whole order.${o.finishAsAvailableReason ? ` — ${o.finishAsAvailableReason}` : ''}`} style={{ fontFamily: theme.mono, fontSize: '9px', fontWeight: 700, letterSpacing: '.08em', color: theme.brass, border: `1px solid ${theme.brass}`, padding: '2px 6px', marginRight: '10px' }}>⚡ {t('FINISH AS AVAILABLE')}</span>}
                                {committedBinOf(o) && <span title={`${totalGathered(o)} piece(s) gathered for this order. App-only — NetSuite still shows them in their shelf bin.`} style={{ fontFamily: theme.mono, fontSize: '10px', fontWeight: 700, letterSpacing: '.06em', color: '#2e7d32', marginRight: '12px' }}>📦 {t('BIN')} {committedBinOf(o)} · {totalGathered(o)}</span>}
                                {loaded && (ready
                                    ? <span style={{ fontFamily: theme.mono, fontSize: '10px', fontWeight: 700, letterSpacing: '.1em', color: '#2e7d32', marginRight: '12px' }}>✓ {t('READY TO PACK')}</span>
                                    : <span style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.08em', color: theme.brass, marginRight: '12px' }}>{t('waiting on parts')}</span>)}
                                <span style={{ fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: o.status === 'Shipped' ? '#3a7d44' : (o.status === 'Picked' ? theme.brass : theme.inkSoft) }}>{o.status || 'Pending'}</span>
                            </div>
                            {showLines && <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                <thead><tr style={{ background: theme.paper2 }}>
                                    {['Item #', 'Description', 'Bin', 'Ord', 'Hand', 'Prod', 'Comm', 'Status', ''].map(h => <th key={h} style={{ textAlign: ['Ord', 'Hand', 'Prod', 'Comm'].includes(h) ? 'center' : 'left', padding: '8px 18px', fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', color: theme.inkSoft, borderBottom: `1px solid ${theme.line}` }}>{h}</th>)}
                                </tr></thead>
                                <tbody>
                                    {(o.lines || []).map((l, i) => (
                                        <tr key={i}>
                                            {/* The REAL stocked code is what the floor pulls and what
                                                the label barcodes. A line sold under an alias shows
                                                that alias underneath in small print, so the picker can
                                                tie the shelf part back to what the customer ordered. */}
                                            <td style={{ padding: '9px 18px', fontFamily: theme.mono, color: theme.ink, borderBottom: `1px solid ${theme.paper2}` }}>
                                                {l.erp || '—'}
                                                {l.aliasErp && <div style={{ fontSize: '9px', color: theme.inkSoft, letterSpacing: '.04em' }}>alias {l.aliasErp}</div>}
                                            </td>
                                            <td style={{ padding: '9px 18px', color: theme.inkSoft, borderBottom: `1px solid ${theme.paper2}` }}>{l.name}{l.note ? ` · ${l.note}` : ''}{(() => { const pk = packOf(l); return pk ? <span style={{ color: theme.brass, fontFamily: theme.mono, fontSize: '10px' }}> → pull {(Number(l.qty) || 0) * pk.size} × {pk.singleErp}</span> : null; })()}
                                                {/* A made-to-order line: the pieces ARRIVE from the finishing floor (in-house)
                                                    or the plater (outsourced) — do NOT pull the raw off the shelf for it
                                                    (its WO / plating demand carries the pull lines). */}
                                                {l.toBeFinished && <div style={{ color: theme.brass, fontFamily: theme.mono, fontSize: '10px', fontWeight: 600 }}>🎨 TO BE FINISHED · {l.finishCode || ''} — arrives from {l.finishOutsourced ? 'the plater (WMS Plating)' : 'the finishing floor'}, do not pull raw</div>}
                                            </td>
                                            <td style={{ padding: '9px 18px', fontFamily: theme.mono, color: l.toBeFinished ? theme.brass : (l.bin ? theme.ink : theme.inkSoft), borderBottom: `1px solid ${theme.paper2}` }}>{l.toBeFinished ? (l.finishOutsourced ? 'FROM PLATING' : 'FROM FINISHING') : (l.bin || 'UNASSIGNED')}</td>
                                            {(() => {
                                                const st = lineStats(o, l);
                                                const num = (v, col) => <td style={{ padding: '9px 10px', textAlign: 'center', fontFamily: theme.mono, fontSize: '12px', color: col || theme.ink, borderBottom: `1px solid ${theme.paper2}` }}>{v}</td>;
                                                const tone = { GATHERED: '#2e7d32', READY: '#3a7d44', 'IN PRODUCTION': theme.brass, SHORT: '#c0392b', UNKNOWN: theme.inkSoft }[st.state];
                                                return (<>
                                                    {num(st.ordered)}
                                                    {num(st.avail == null ? '—' : st.avail, st.avail != null && st.avail < st.ordered ? '#c0392b' : theme.ink)}
                                                    {num(st.prod || '—', st.prod ? theme.brass : theme.inkSoft)}
                                                    {num(st.committed || '—', st.committed ? '#2e7d32' : theme.inkSoft)}
                                                    <td style={{ padding: '9px 12px', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.05em', color: tone, borderBottom: `1px solid ${theme.paper2}`, whiteSpace: 'nowrap' }}>
                                                        {l.toBeFinished ? t('from the floor') : t(st.state)}
                                                        {st.unit && <span style={{ color: theme.inkSoft }}> · {st.unit}</span>}
                                                    </td>
                                                </>);
                                            })()}
                                            <td style={{ padding: '9px 12px', textAlign: 'right', borderBottom: `1px solid ${theme.paper2}` }}>
                                                {committedQtyOf(o, l.erp) > 0 && <button onClick={() => releaseFromOrder(o, String(l.erp || '').toUpperCase(), Number(l.qty) || 0)} title={`${committedQtyOf(o, l.erp)} gathered for this order — release some or all back`} style={{ padding: '5px 9px', marginRight: '6px', background: 'transparent', border: '1px solid #d9534f', color: '#c0392b', cursor: 'pointer', fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.06em' }}>{t('Release')}</button>}
                                                <button onClick={() => printOrderLineLabels(o, l)} title={`Print ${Math.max(1, Math.min(50, Number(l.qty) || 1))} × ${l.erp || ''} item label(s)`} style={{ padding: '5px 9px', background: 'transparent', border: `1px solid ${theme.line}`, color: theme.ink, cursor: 'pointer', fontSize: '12px' }}>🖨</button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>}
                            {o.status !== 'Shipped' && (
                                <div style={{ padding: '12px 18px', display: 'flex', gap: '10px', justifyContent: 'flex-end', alignItems: 'center', borderTop: `1px solid ${theme.line}` }}>
                                    {o.packStatus === 'Packed'
                                        ? <span style={{ marginRight: 'auto', fontFamily: theme.mono, fontSize: '10px', color: '#3a7d44' }}>📦 Packed · {(o.packPhotos || []).length} photo{(o.packPhotos || []).length === 1 ? '' : 's'} · {o.packedBy || ''}{o.nsIfTran ? ` · IF ${o.nsIfTran}${o.nsFulfillStatus ? ` (${o.nsFulfillStatus})` : ''}` : (o.nsFulfillQueued ? ' · IF queued…' : '')}{(o.trackingNumbers || []).length ? ` · 🚚 ${o.trackingNumbers.join(', ')}` : ''}</span>
                                        : (o.status === 'Picked' && <span style={{ marginRight: 'auto', fontFamily: theme.mono, fontSize: '10px', color: theme.brass }}>→ in the PACKING tab queue</span>)}
                                    <button onClick={() => toggleFinishAsAvailable(o)} title={finishAsAvailable(o) ? 'Parts are going to finishing as they arrive — switch back to waiting for the whole order' : 'The exception: send parts to finishing as they arrive, rather than waiting for the whole order'} style={{ padding: '9px 14px', background: 'transparent', color: finishAsAvailable(o) ? theme.brass : theme.inkSoft, border: `1px solid ${finishAsAvailable(o) ? theme.brass : theme.line}`, fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>⚡ {t(finishAsAvailable(o) ? 'Waiting off' : 'Finish as available')}</button>
                                    <button onClick={() => printAllOrderLabels(o, o.lines || [])} title="Print item labels for every line on this order" style={{ padding: '9px 14px', background: 'transparent', color: theme.ink, border: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>🖨 {t('Labels')}</button>
                                    {/* A stale order had nowhere to die: RTG's board cannot see an Order Entry sale, and RTG
                                        was the only caller of the closer. This is that same closer, reachable from where the
                                        stale order is actually noticed. */}
                                    <button onClick={() => closeStaleOrder(o)} title="Close this order in the app — it leaves the warehouse queues. Does NOT close it in NetSuite." style={{ padding: '9px 14px', background: 'transparent', color: '#c0392b', border: '1px solid #c0392b', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>{t('Close order')}</button>
                                    {o.packStatus === 'Packed' && <button onClick={() => pullFulfillment(o)} title="Pull fulfillment status + tracking # from NetSuite" style={{ padding: '9px 14px', background: 'transparent', color: theme.ink, border: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>⤓ Tracking</button>}
                                    {o.status !== 'Picked' && <button onClick={() => setQSStatus(o, 'Picked')} style={{ padding: '9px 18px', background: 'transparent', color: theme.ink, border: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>Mark Picked</button>}
                                    <button onClick={() => setQSStatus(o, 'Shipped')} style={{ padding: '9px 18px', background: theme.ink, color: '#fff', border: 'none', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>Mark Shipped</button>
                                </div>
                            )}
                        </div>
                    ); };
                    return (
                        <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '30px', minHeight: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
                            <div style={{ fontFamily: theme.serif, color: theme.ink, fontWeight: 500, fontSize: '1.4rem', marginBottom: '6px' }}>Stock / Quick Ship Orders</div>
                            <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, letterSpacing: '.05em', marginBottom: '24px' }}>Pre-finished stocked goods — pick off the shelf. Separate from custom orders.</div>
                            {open.length === 0 && <div style={{ color: theme.inkSoft, fontStyle: 'italic', fontFamily: theme.serif }}>No open stock orders.</div>}
                            {open.map(o => <Card key={o.id} o={o} />)}
                            {cpqOrders.length > 0 && (
                                <div style={{ marginTop: '26px' }}>
                                    <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '10px' }}>
                                        {t('Configured orders in production')} · {cpqOrders.length} — {t('packed on Packaging Prep; this is where their pieces are')}
                                    </div>
                                    {cpqOrders.map(({ so, docs }) => {
                                        const allDone = docs.every(d => d.packStatus === 'Packed' || d.currentPhase === 'Complete');
                                        return (
                                            <div key={so.id} style={{ border: `1px solid ${allDone ? '#3a7d44' : theme.line}`, boxShadow: allDone ? '0 0 0 2px rgba(58,125,68,0.18)' : 'none', marginBottom: '14px', background: '#fff' }}>
                                                <div style={{ padding: '12px 18px', borderBottom: `1px solid ${theme.line}`, background: theme.paper, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                                                    <div>
                                                        <span style={{ fontFamily: theme.serif, fontSize: '1.1rem', color: theme.ink, fontWeight: 500 }}>{so.customer || so.customerName || 'Customer'}</span>
                                                        <span style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, marginLeft: '12px' }}>SO {so.soId || so.id} · {docs.length} {docs.length === 1 ? t('work order') : t('work orders')}</span>
                                                        {(so.needBy || so.needByDate) && <span style={{ fontFamily: theme.mono, fontSize: '10px', fontWeight: 700, color: '#d9534f', marginLeft: '12px' }}>{t('NEED BY')} {so.needBy || so.needByDate}</span>}
                                                        {so.sidemark && <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, marginTop: '3px', textTransform: 'uppercase', letterSpacing: '.05em' }}>REF: {so.sidemark}</div>}
                                                    </div>
                                                    <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                        {committedBinOf(so) && <span style={{ fontFamily: theme.mono, fontSize: '10px', fontWeight: 700, color: '#2e7d32' }}>📦 {t('BIN')} {committedBinOf(so)} · {totalGathered(so)}</span>}
                                                        <span style={{ fontFamily: theme.mono, fontSize: '10px', fontWeight: 700, letterSpacing: '.1em', color: allDone ? '#2e7d32' : theme.brass }}>{allDone ? `✓ ${t('ALL PARTS DONE')}` : t('in production')}</span>
                                                    </span>
                                                </div>
                                                <div style={{ padding: '6px 18px 12px' }}>
                                                    {docs.map(d => (
                                                        <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', padding: '8px 0', borderBottom: `1px solid ${theme.paper2}` }}>
                                                            <span style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.ink, minWidth: '150px' }}>{woRefOf(d)}</span>
                                                            <span style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft, flex: 1, minWidth: '160px' }}>{woItemCodeOf(d) || '—'}{woItemNameOf(d) ? ` · ${woItemNameOf(d)}` : ''}</span>
                                                            <OrderStatusChips wo={d} showWho={false} />
                                                            {d.packStatus === 'Packed' && <span style={{ fontFamily: theme.mono, fontSize: '9px', color: '#3a7d44', letterSpacing: '.06em' }}>📦 {t('PACKED')}</span>}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            {shipped.length > 0 && (
                                <>
                                    <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', margin: '30px 0 14px' }}>Shipped ({shipped.length})</div>
                                    {shipped.map(o => <Card key={o.id} o={o} />)}
                                </>
                            )}
                        </div>
                    );
                })()}

                {/* 📦 TAB: PACKING STATION */}
                {activeTab === 'PACKING' && (() => {
                    const lines = packJob ? packLinesOf(packJob) : [];
                    const isPacked = (l) => !!(packJob.packedLines && packJob.packedLines[l.key]);
                    const toPack = packJob ? lines.filter(l => !isPacked(l)) : [];
                    const packed = packJob ? lines.filter(isPacked) : [];
                    const photos = packJob ? (packJob.packPhotos || []) : [];
                    const isStockJob = !!(packJob && packJob.orderType === 'stock');
                    // A custom order's poles come off the SHOP order, not this parts list — so
                    // "every line packed" says nothing about whether the right poles are in the box.
                    const needsPoleMatch = !!(packJob && packJob.hasCustomSibling && !packJob.packCustomMatchedAt && !packJob.packCustomMatchWaived);
                    const poleMatched = !needsPoleMatch || stagingScanMatches(packJob, packCustomScan);
                    const canComplete = packJob && toPack.length === 0 && poleMatched && (isStockJob ? !!putawayBin.trim() : photos.length > 0);
                    const brandBoxes = stdBoxes.filter(b => !b.brandId || b.brandId === 'global' || b.brandId === activeBrand);
                    const boxSelect = (slot, label) => (
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', color: theme.inkSoft }}>
                            {label}
                            <select value={packBoxSel[slot] || ''} onChange={e => setPackBoxSel({ ...packBoxSel, [slot]: e.target.value })} style={{ padding: '8px 10px', border: `1px solid ${theme.line}`, fontFamily: theme.sans, fontSize: '0.85rem', background: '#fff' }}>
                                <option value="">— pick box —</option>
                                {brandBoxes.map(b => <option key={b.id} value={b.name}>{b.name}{b.w ? ` (${b.w}×${b.h}${b.d ? `×${b.d}` : ''})` : ''}</option>)}
                            </select>
                        </label>
                    );
                    const lineRow = (l, side) => (
                        <div key={l.key} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', background: side === 'right' ? '#f0f7f1' : '#fff', border: `1px solid ${side === 'right' ? '#bcd8c0' : theme.line}`, marginBottom: '8px' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontFamily: theme.mono, fontSize: '0.85rem', color: theme.ink }}>
                                    {l.erp || '—'}
                                    {l.aliasErp && <span style={{ fontSize: '9px', color: theme.inkSoft, marginLeft: '8px', letterSpacing: '.04em' }}>alias {l.aliasErp}</span>}
                                </div>
                                <div style={{ fontSize: '0.8rem', color: theme.inkSoft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</div>
                                {side === 'right' && packJob.packedLines[l.key] && <div style={{ fontFamily: theme.mono, fontSize: '9px', color: '#3a7d44', marginTop: '2px' }}>✓ {packJob.packedLines[l.key].by} · {new Date(packJob.packedLines[l.key].at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>}
                            </div>
                            <span style={{ fontFamily: theme.mono, fontWeight: 'bold', fontSize: '1rem', color: theme.ink, whiteSpace: 'nowrap' }}>× {l.qty}</span>
                            <button onClick={() => printPackLineLabel(packJob, l)} title={l.cat === 'POLE' ? 'Rod labels — sidemark · length · 1 of X per piece' : 'Item labels — one per piece'} style={{ background: 'transparent', color: theme.inkSoft, border: `1px solid ${theme.line}`, padding: '8px 10px', fontFamily: theme.mono, fontSize: '10px', cursor: 'pointer' }}>🖨</button>
                            {side === 'left'
                                ? <button onClick={() => confirmPackLine(packJob, l)} style={{ background: theme.ink, color: '#fff', border: 'none', padding: '12px 16px', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', cursor: 'pointer', whiteSpace: 'nowrap' }}>✓ Packed</button>
                                : <button onClick={() => unpackLine(packJob, l)} title="Undo — move back to TO PACK" style={{ background: 'transparent', color: theme.inkSoft, border: `1px solid ${theme.line}`, padding: '8px 10px', fontFamily: theme.mono, fontSize: '10px', cursor: 'pointer' }}>↩</button>}
                        </div>
                    );
                    const groupBlock = (side, list) => PACK_GROUP_ORDER.map(g => {
                        const gl = list.filter(l => l.cat === g.cat);
                        if (!gl.length) return null;
                        return (
                            <div key={g.cat} style={{ marginBottom: '18px' }}>
                                <div style={{ fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.12em', color: g.box === 'POLE' ? theme.brass : theme.inkSoft, borderBottom: `1px solid ${theme.line}`, paddingBottom: '6px', marginBottom: '10px' }}>
                                    {g.title} · {g.box === 'POLE' ? 'LARGE BOX / TUBE' : 'SMALL BOX'}
                                </div>
                                {gl.map(l => lineRow(l, side))}
                            </div>
                        );
                    });
                    return (
                        <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '30px', minHeight: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
                            <div style={{ borderBottom: `1px solid ${theme.line}`, paddingBottom: '15px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '10px' }}>
                                <h2 style={{ color: theme.ink, fontFamily: theme.serif, fontWeight: 500, margin: 0 }}>{t('Packing Station')}</h2>
                                <span style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, letterSpacing: '.05em' }}>small parts first (brackets · rings · finials) → small box · poles last → large box · photo required</span>
                            </div>

                            {/* READY-TO-PACK QUEUE — compact strip up top */}
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '24px' }}>
                                {packQueue.length === 0 && <span style={{ color: theme.inkSoft, fontStyle: 'italic', fontFamily: theme.serif }}>No finished orders waiting to be packed.</span>}
                                {packQueue.map(j => {
                                    const jl = packLinesOf(j);
                                    const done = jl.filter(l => j.packedLines && j.packedLines[l.key]).length;
                                    const active = packOrderId === j.id;
                                    return (
                                        <button key={j.id} onClick={() => { if (active) closePackCard(j); else openPackOrder(j); }} style={{ background: active ? theme.ink : theme.paper, color: active ? '#fff' : theme.ink, border: `1px solid ${active ? theme.ink : theme.line}`, padding: '10px 14px', cursor: 'pointer', textAlign: 'left' }}>
                                            {!active && <OrderStatusChips wo={j} showWho={false} style={{ marginBottom: '6px' }} />}
                                            {/* A paint run looks like a stock build until you read the code — say so. */}
                                            {isPaintOnlyOrder(j) && <div title={`Legacy NetSuite item ${j.jfpItemCode || ''} — no assembly. Scanning the bin adjusts the painted pieces into it.`} style={{ display: 'inline-block', marginBottom: '6px', background: theme.brass, color: '#fff', fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.08em', padding: '2px 7px' }}>{PAINT_ONLY_BADGE} · {j.jfpItemCode || ''}</div>}
                                            <div style={{ fontFamily: theme.mono, fontSize: '0.85rem', fontWeight: 'bold' }}>{packRef(j)}{isQsOrder(j) && <span style={{ fontSize: '8px', letterSpacing: '.1em', color: active ? '#fff' : theme.brass, border: `1px solid ${active ? 'rgba(255,255,255,0.5)' : theme.brass}`, padding: '1px 5px', marginLeft: '8px', verticalAlign: 'middle' }}>QUICK SHIP</span>}{j.orderType === 'stock' && <span style={{ fontSize: '8px', letterSpacing: '.1em', color: active ? '#fff' : '#3a7d44', border: `1px solid ${active ? 'rgba(255,255,255,0.5)' : '#3a7d44'}`, padding: '1px 5px', marginLeft: '8px', verticalAlign: 'middle' }}>STOCK → BIN</span>}</div>
                                            <div style={{ fontFamily: theme.sans, fontSize: '0.75rem', color: active ? 'rgba(255,255,255,0.75)' : theme.inkSoft }}>
                                                {j.customerName || j.clientName || j.customer || '—'} · {jl.length} line{jl.length === 1 ? '' : 's'}{done > 0 ? ` · ${done}/${jl.length} packed` : ''}
                                            </div>
                                            {!active && renderClaimLine(j, 'pack')}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* WORKSPACE — TO PACK left, physically confirmed pieces move right */}
                            {packJob ? (
                                <>
                                    {/* WHO HAS THIS ORDER — and the way out. Opening is looking; START PACKING is
                                        taking. Everything that CHANGES the order is disabled until it is yours. */}
                                    {(() => {
                                        const c = claimOf(packJob, 'pack');
                                        const mine = claimIsMine(c);
                                        const held = !!c && !mine;
                                        return (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', padding: '10px 12px', marginBottom: '14px', border: `1px solid ${held ? '#d9534f' : (mine ? '#3a7d44' : theme.line)}`, background: held ? '#fdf3f3' : (mine ? '#f0f7f1' : theme.paper) }}>
                                                <span style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.05em', color: held ? '#c0392b' : (mine ? '#3a7d44' : theme.inkSoft), textTransform: 'uppercase' }}>
                                                    {committedBinOf(soIndex[String(packJob.salesOrderId || packJob.id)] || packJob) && `📦 ${t('Parts for this order are in bin')} ${committedBinOf(soIndex[String(packJob.salesOrderId || packJob.id)] || packJob)} · `}
                                                    {held ? `🔒 ${c.by} ${t('is packing this')} · ${t('since')} ${claimSince(c)}`
                                                        : mine ? `🔒 ${t('You are packing this')}`
                                                            : `👁 ${t('Looking only — nothing is changed until you start packing')}`}
                                                </span>
                                                <span style={{ marginLeft: 'auto', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                                    <button onClick={() => printAllOrderLabels(packJob, packLinesOf(packJob))} title="Print item labels for every line on this order" style={{ padding: '9px 14px', background: 'transparent', color: theme.ink, border: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>🖨 {t('Labels')}</button>
                                                    {!c && <button onClick={() => startPacking(packJob)} style={{ padding: '9px 16px', background: theme.ink, color: '#fff', border: 'none', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>{t('Start packing')}</button>}
                                                    {held && isPlatingAdmin && <button onClick={() => adminReleaseClaim(packJob, 'pack')} style={{ padding: '9px 14px', background: 'transparent', border: '1px solid #d9534f', color: '#c0392b', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>{t('Release (admin)')}</button>}
                                                    <button onClick={() => closePackCard(packJob)} style={{ padding: '9px 16px', background: 'transparent', color: theme.inkSoft, border: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>{t('Close')}</button>
                                                </span>
                                            </div>
                                        );
                                    })()}
                                    {needsPoleMatch && (
                                        <div style={{ background: poleMatched ? '#f0f7f1' : '#fdf3f3', border: `1px solid ${poleMatched ? '#3a7d44' : '#d9534f'}`, padding: '14px 16px', marginBottom: '16px' }}>
                                            <div style={{ fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: poleMatched ? '#3a7d44' : '#d9534f', marginBottom: '6px' }}>
                                                {poleMatched ? '✓ Both halves match' : '⚠ Match the poles to these small parts'}
                                            </div>
                                            <div style={{ fontFamily: theme.sans, fontSize: '0.88rem', color: theme.ink, marginBottom: '10px', lineHeight: 1.5 }}>
                                                The poles for this order came off the CUSTOM SHOP order — they are not on the parts list you just packed. Scan the shop label on the poles to prove the two halves belong together before the box closes.
                                            </div>
                                            <input autoFocus value={packCustomScan} onChange={e => setPackCustomScan(e.target.value)} placeholder="SCAN CUSTOM SHOP LABEL…"
                                                style={{ width: '100%', maxWidth: '420px', boxSizing: 'border-box', padding: '12px', border: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '1rem', outline: 'none' }} />
                                            {packCustomScan.trim() && !poleMatched && (
                                                <div style={{ fontFamily: theme.mono, fontSize: '10px', color: '#d9534f', marginTop: '8px' }}>
                                                    ✖ "{packCustomScan.trim()}" is a different order — these poles do NOT belong with these parts. Find the right ones.
                                                </div>
                                            )}
                                            {/* THERE MAY BE NO POLES TO MATCH (Sandra 2026-08-17: "no permite completar
                                                la operación de packing porque está pidiendo tubos y en este caso la orden
                                                sólo lleva 3 anillos"). The demand rides `hasCustomSibling`, stamped when
                                                the order was split — if the custom half was later replaced or removed,
                                                the flag outlives it and the box can never close, with nothing on this
                                                screen able to fix the record. So: an explicit way out that STATES what
                                                happened, rather than a silent bypass. The reason is required and is
                                                stored on the order and in the log. */}
                                            {!poleMatched && (
                                                <button onClick={noPolesOnOrder}
                                                    title="Use this only when the order genuinely has no poles — it is recorded against the order with your name and reason."
                                                    style={{ marginTop: '10px', padding: '9px 12px', background: 'transparent', border: `1px solid ${theme.line}`, color: theme.inkSoft, cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                                                    {t('This order has no poles — say why & continue')}
                                                </button>
                                            )}
                                        </div>
                                    )}
                                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap', padding: '12px 16px', background: theme.paper2, border: `1px solid ${theme.line}`, marginBottom: '16px' }}>
                                        <span style={{ fontFamily: theme.serif, fontSize: '1.2rem', color: theme.ink, fontWeight: 500 }}>{packRef(packJob)}</span>
                                        <span style={{ fontFamily: theme.sans, fontSize: '0.85rem', color: theme.inkSoft }}>{packJob.customerName || packJob.clientName || packJob.customer || ''}{packJob.recipe ? ` · ${packJob.recipe}` : ''}</span>
                                        {Number(packJob.packScrap) > 0 && <span style={{ fontFamily: theme.mono, fontSize: '10px', color: '#d9534f', border: '1px solid #d9534f', padding: '3px 8px' }}>⚠ {packJob.packScrap} scrap reported</span>}
                                        {packJob.packCustomMatchedAt && <span title={`Matched by ${packJob.packCustomMatchedBy || ''}`} style={{ fontFamily: theme.mono, fontSize: '10px', color: '#3a7d44', border: '1px solid #3a7d44', padding: '3px 8px' }}>✓ poles matched</span>}
                                        <span style={{ marginLeft: 'auto', display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
                                            {isStockJob ? (
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', color: theme.inkSoft }}>
                                                    Put-away bin
                                                    <input value={putawayBin} onChange={e => setPutawayBin(e.target.value)} placeholder="scan / enter bin" style={{ padding: '9px 10px', border: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '0.9rem', outline: 'none', width: '160px' }} />
                                                    {(() => { const lv = liveBins[String(packJob.stockErpId || packJob.type || '').toUpperCase()]; return lv && lv.bins.length ? <span style={{ color: '#3a7d44', textTransform: 'none' }}>live: {lv.bins.slice(0, 2).map(b => `${b.bin} ×${b.qty}`).join(' · ')}</span> : null; })()}
                                                </label>
                                            ) : (<>
                                                {boxSelect('SMALL', 'Small parts box')}
                                                {boxSelect('POLE', 'Pole box')}
                                            </>)}
                                        </span>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', alignItems: 'start' }}>
                                        <div style={{ border: `1px solid ${theme.line}`, padding: '16px', background: theme.paper }}>
                                            <div style={{ fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.12em', color: theme.ink, marginBottom: '14px' }}>To Pack ({toPack.length})</div>
                                            {toPack.length === 0 ? <div style={{ color: '#3a7d44', fontFamily: theme.serif, fontStyle: 'italic' }}>Everything is packed — add the photo and complete below.</div> : groupBlock('left', toPack)}
                                        </div>
                                        <div style={{ border: `1px solid ${theme.line}`, padding: '16px', background: '#fff' }}>
                                            <div style={{ fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.12em', color: '#3a7d44', marginBottom: '14px' }}>Packed ({packed.length}/{lines.length})</div>
                                            {packed.length === 0 ? <div style={{ color: theme.inkSoft, fontStyle: 'italic', fontFamily: theme.serif }}>Confirm pieces on the left as you physically pack them.</div> : groupBlock('right', packed)}
                                        </div>
                                    </div>

                                    {/* REQUIRED PHOTOS + COMPLETE */}
                                    <div style={{ marginTop: '20px', border: `1px solid ${theme.line}`, background: theme.paper, padding: '16px', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                                        <label style={{ cursor: 'pointer', border: `1px solid ${theme.line}`, background: '#fff', padding: '12px 16px', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                                            {packUploading ? '⏳ Uploading…' : (isStockJob ? '📷 Add Photo (optional)' : '📷 Add Photo (required)')}
                                            <input type="file" accept="image/*" capture="environment" multiple style={{ display: 'none' }} onChange={e => { uploadPackPhotos(packJob, e.target.files); e.target.value = ''; }} />
                                        </label>
                                        {photos.map((u, i) => <img key={i} src={u} alt={`packed ${i + 1}`} onClick={() => window.open(u, '_blank')} style={{ height: '54px', width: '76px', objectFit: 'cover', border: `1px solid ${theme.line}`, cursor: 'zoom-in' }} />)}
                                        {photos.length === 0 && !isStockJob && <span style={{ fontFamily: theme.sans, fontSize: '0.85rem', color: '#d9534f' }}>No photo yet — a photo of the packaged parts is required.</span>}
                                        {isStockJob && !putawayBin.trim() && <span style={{ fontFamily: theme.sans, fontSize: '0.85rem', color: '#d9534f' }}>Scan the put-away bin — stocked goods go straight to the shelf.</span>}
                                        {packJob && isPaintOnlyOrder(packJob) && <span style={{ fontFamily: theme.sans, fontSize: '0.85rem', color: theme.ink }}>{PAINT_ONLY_BADGE}: the bin you scan is where <b>{packJob.jfpItemCode}</b> gets adjusted in NetSuite — there is no assembly build.</span>}
                                        {isStockJob ? (
                                            <button onClick={() => {
                                                const erp = String(packJob.stockErpId || packJob.type || '').toUpperCase();
                                                const part = hqParts.find(p => String(p.legacyErpId || p.itemId || '').toUpperCase() === erp);
                                                const copies = parseInt(window.prompt(`How many item labels for ${erp}?\n\nEach shows the item # (text + barcode), description, UOM — and WO ${packRef(packJob)} small on the right as the BATCH #.`, '1')) || 0;
                                                if (copies > 0) printStockItemLabels({ itemId: erp, itemName: (part && part.itemName) || '', uom: (part && part.manufacturingSpecs?.uom) || 'EA', woNum: packRef(packJob), copies });
                                            }} title="Item labels with the WO # as batch reference" style={{ background: 'transparent', border: `1px solid ${theme.line}`, color: theme.ink, padding: '12px 16px', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', cursor: 'pointer' }}>🖨 Item Labels</button>
                                        ) : (<>
                                            {!isQsOrder(packJob) && (
                                                <button onClick={() => printHandshakeLabels({ woRef: packRef(packJob), orderKey: packJob.orderKey || packJob.salesOrderId || packJob.soNum || packJob.id, item: packJob.stockErpId || packJob.type || '', qty: packJob.totalParts || '', finish: packJob.recipe || '', customer: packJob.customerName || packJob.clientName || packJob.customer || '', hasCustom: !!packJob.hasCustomSibling })} title="Reprint both staging-handshake labels (small parts + custom shop when the order has one) — same barcode key the handshake scans" style={{ background: 'transparent', border: `1px solid ${theme.line}`, color: theme.ink, padding: '12px 16px', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', cursor: 'pointer' }}>🖨 Handshake Labels</button>
                                            )}
                                            <button onClick={() => { const ls = packLinesOf(packJob); if (ls.length) printItemLabels(ls.map(l => ({ itemId: l.erp, itemName: l.name }))); }} title="One 2×4 item label per line on this order" style={{ background: 'transparent', border: `1px solid ${theme.line}`, color: theme.ink, padding: '12px 16px', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', cursor: 'pointer' }}>🖨 Item Labels</button>
                                        </>)}
                                        {!isQsOrder(packJob) && (
                                            <button onClick={() => reportPackScrap(packJob)} title="Found bad pieces while bagging? Record scrap — stock builds queue the −qty NetSuite adjustment, customs red-flag the finishing supervisor" style={{ marginLeft: 'auto', background: 'transparent', color: '#d9534f', border: '1px solid #d9534f', padding: '14px 18px', fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>
                                                ⚠ Report Scrap
                                            </button>
                                        )}
                                        <button onClick={() => completePacking(packJob)} disabled={!canComplete} style={{ marginLeft: isQsOrder(packJob) ? 'auto' : '0', background: canComplete ? theme.ink : theme.paper2, color: canComplete ? '#fff' : theme.inkSoft, border: `1px solid ${canComplete ? theme.ink : theme.line}`, padding: '14px 26px', fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: canComplete ? 'pointer' : 'default' }}>
                                            {isStockJob ? '✓ Put Away to Bin' : '✓ Complete Packing'}
                                        </button>
                                    </div>
                                </>
                            ) : (
                                packQueue.length > 0 && <div style={{ color: theme.inkSoft, fontStyle: 'italic', fontFamily: theme.serif }}>Tap an order above to open the packing workspace.</div>
                            )}

                            {/* RECENTLY PACKED */}
                            {packedRecent.length > 0 && (
                                <div style={{ marginTop: '30px' }}>
                                    <div style={{ fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: theme.inkSoft, marginBottom: '10px' }}>Recently Packed</div>
                                    {packedRecent.map(j => (
                                        <div key={j.id} style={{ display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap', padding: '8px 12px', borderTop: `1px solid ${theme.paper2}`, fontFamily: theme.sans, fontSize: '0.85rem', color: theme.inkSoft }}>
                                            <span onClick={() => setExpandedPacked(expandedPacked === j.id ? null : j.id)} title="Show the lines that were packed" style={{ fontFamily: theme.mono, color: theme.ink, cursor: 'pointer' }}>
                                                <span style={{ color: theme.inkSoft, marginRight: '6px' }}>{expandedPacked === j.id ? '▾' : '▸'}</span>{packRef(j)}
                                            </span>
                                            <span>{j.customerName || j.clientName || j.customer || ''}</span>
                                            {/* A put-away paint run was indistinguishable from a stock build once it
                                                left the queue — the badge only ever rendered on the to-pack list
                                                (Stuart 2026-08-18). */}
                                            {isPaintOnlyOrder(j) && <span title={`Paint run — the painted pieces are adjusted into the scanned bin as ${j.jfpItemCode || 'the item'}`} style={{ background: theme.brass, color: '#fff', fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.08em', padding: '2px 7px' }}>{PAINT_ONLY_BADGE}{j.jfpItemCode ? ` · ${j.jfpItemCode}` : ''}</span>}
                                            {/* The adjustment was queued but never confirmed — the pieces are away and
                                                NetSuite has not got them (Eric 2026-08-24). */}
                                            {/* LABELS AFTER THE FACT (Sandra 2026-08-12: "need to add item
                                                print label for packed orders please"). The Item Labels button
                                                only ever existed on the order currently OPEN at the bench, so
                                                once a box was packed there was no way to reprint for it — which
                                                is exactly when a label goes missing or tears. */}
                                            <button onClick={(e) => { e.stopPropagation(); const ls = packLinesOf(j); if (!ls.length) return alert(`No packed lines recorded on ${packRef(j)}.`); printItemLabels(ls.map(l => ({ itemId: l.erp, itemName: l.name }))); writeLog(`🖨 Reprinted ${ls.length} item label(s) for ${packRef(j)}`, 'wms'); }}
                                                title="Reprint one 2×4 item label per line on this packed order"
                                                style={{ background: 'transparent', border: `1px solid ${theme.line}`, color: theme.ink, padding: '3px 9px', fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.06em', cursor: 'pointer' }}>🖨 {t('Item Labels')}</button>
                                            {isPaintOnlyOrder(j) && j.jfpAdjQueued && !j.jfpAdjPosted && (
                                                <button onClick={(e) => { e.stopPropagation(); redoPutaway(j); }} title="NetSuite has not confirmed this put-away — re-post it against a corrected bin."
                                                    style={{ background: 'transparent', border: '1px solid #d9534f', color: '#d9534f', padding: '3px 9px', fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.06em', cursor: 'pointer' }}>↩ Re-post put-away</button>
                                            )}
                                            <OrderStatusChips wo={j} showWho={false} />
                                            <span style={{ fontFamily: theme.mono, fontSize: '10px', color: j.nsIfTran ? '#3a7d44' : theme.inkSoft }}>
                                                {j.nsIfTran ? `IF ${j.nsIfTran}${j.nsFulfillStatus ? ` · ${j.nsFulfillStatus}` : ''}` : (j.nsFulfillQueued ? 'IF queued…' : '')}
                                            </span>
                                            {(j.trackingNumbers || []).length > 0 && <span style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.ink }}>🚚 {j.trackingNumbers.join(', ')}</span>}
                                            <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <span style={{ fontFamily: theme.mono, fontSize: '10px' }}>{j.packedBy || ''} · {j.packedAt ? new Date(j.packedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''} · {(j.packPhotos || []).length} 📷</span>
                                                <button onClick={() => pullFulfillment(j)} title="Pull fulfillment status + tracking # from NetSuite" style={{ background: 'transparent', border: `1px solid ${theme.line}`, color: theme.ink, padding: '5px 10px', fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', cursor: 'pointer' }}>⤓ Tracking</button>
                                                {!isQsOrder(j) && <button onClick={() => reportPackScrap(j)} title="Bad pieces found after packing — record scrap" style={{ background: 'transparent', border: '1px solid #d9534f', color: '#d9534f', padding: '5px 10px', fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', cursor: 'pointer' }}>⚠ Scrap</button>}
                                            </span>
                                            {/* WHAT WAS IN THE BOX, AFTER THE FACT (Stuart 2026-08-03: "we need access here to be
                                                able to see the order lines again and reprint labels"). A packed order used to be a
                                                one-line receipt — no way to answer "what shipped?" or replace a label that tore,
                                                short of hunting the order down on another screen. */}
                                            {expandedPacked === j.id && (
                                                <div style={{ flexBasis: '100%', marginTop: '8px', padding: '12px 14px', background: theme.paper, border: `1px solid ${theme.line}` }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '8px' }}>
                                                        <span style={{ fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: theme.inkSoft }}>Packed lines</span>
                                                        <span style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                                            <button onClick={() => printZebraLabel(j, 'SMALL_PARTS')} title="Reprint the small-parts / setup label" style={{ background: 'transparent', border: `1px solid ${theme.line}`, color: theme.ink, padding: '5px 10px', fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', cursor: 'pointer' }}>🖨 Setup Label</button>
                                                            {j.orderType === 'stock' && <button onClick={() => printZebraLabel(j, 'PUT_AWAY')} title="Reprint the put-away label" style={{ background: 'transparent', border: `1px solid ${theme.line}`, color: theme.ink, padding: '5px 10px', fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', cursor: 'pointer' }}>🖨 Put-Away</button>}
                                                            {j.hasCustomSibling && <button onClick={() => printZebraLabel(j, 'CUSTOM_SHOP')} title="Reprint the custom shop label (the poles' label)" style={{ background: 'transparent', border: `1px solid ${theme.line}`, color: theme.ink, padding: '5px 10px', fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', cursor: 'pointer' }}>🖨 Shop Label</button>}
                                                        </span>
                                                    </div>
                                                    {packLinesOf(j).map(l => (
                                                        <div key={l.key} style={{ display: 'flex', gap: '12px', alignItems: 'baseline', padding: '5px 0', borderBottom: `1px dashed ${theme.line}`, fontSize: '0.85rem' }}>
                                                            <span style={{ fontFamily: theme.mono, fontSize: '11px', fontWeight: 600, color: theme.ink, minWidth: '110px' }}>{l.erp || '—'}</span>
                                                            <span style={{ flex: 1, color: theme.inkSoft }}>{l.name}</span>
                                                            <span style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.ink }}>×{l.qty}</span>
                                                        </div>
                                                    ))}
                                                    {packLinesOf(j).length === 0 && <div style={{ fontFamily: theme.sans, fontSize: '0.85rem', color: theme.inkSoft, fontStyle: 'italic' }}>No line detail recorded on this order.</div>}
                                                    <div style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.inkSoft, marginTop: '8px' }}>
                                                        {j.packCustomMatchedAt ? `poles matched by ${j.packCustomMatchedBy || '—'}` : (j.hasCustomSibling ? 'poles were NOT match-scanned at packing' : '')}
                                                        {j.putawayBin ? `${j.hasCustomSibling ? ' · ' : ''}bin ${j.putawayBin}` : ''}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })()}

                {/* 📋 TAB: BIN COUNT */}
                {activeTab === 'COUNT' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '30px', height: '100%' }}>
                        
                        {/* SYNAPSIS MODAL */}
                        {showSynapsis && (
                            <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.8)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <div style={{ background: '#fff', padding: '40px', width: 'min(800px, 96vw)', maxHeight: '90vh', overflowY: 'auto', border: `1px solid ${theme.line}`, boxShadow: '0 4px 24px rgba(0,0,0,0.1)' }}>
                                    <h2 style={{ margin: '0 0 20px 0', fontFamily: theme.serif, fontSize: '2rem', color: theme.ink }}>Count Synapsis Review</h2>
                                    <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, marginBottom: '20px', letterSpacing: '.1em', textTransform: 'uppercase' }}>
                                        Target: Subsidiary {BRAND_NETSUITE_MAP[activeBrand]?.subsidiary} | Location {BRAND_NETSUITE_MAP[activeBrand]?.location}
                                    </div>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', marginBottom: '30px' }}>
                                        <thead style={{ borderBottom: `2px solid ${theme.ink}` }}>
                                            <tr>
                                                <th style={{ padding: '10px', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase' }}>Item</th>
                                                <th style={{ padding: '10px', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', textAlign: 'center' }}>Bin</th>
                                                <th style={{ padding: '10px', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', textAlign: 'center' }}>Bin O.H.</th>
                                                <th style={{ padding: '10px', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', textAlign: 'center' }}>Physical</th>
                                                <th style={{ padding: '10px', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', textAlign: 'center' }}>Net Delta</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {countRows.filter(row => physicalCounts[row.rowKey] !== undefined).map(row => {
                                                const delta = physicalCounts[row.rowKey] - row.binOnHand;
                                                const rawEff = (row.isExistingBin ? row.countBin : (binEdits[row.rowKey] ?? row.countBin) || '').trim().toUpperCase();
                                                const effBin = rawEff === 'UNASSIGNED' ? '' : rawEff;
                                                const binIsNew = !row.isExistingBin && effBin !== '' && effBin.toUpperCase() !== (row.binLocation || '').trim().toUpperCase();
                                                return (
                                                    <tr key={row.rowKey} style={{ borderBottom: `1px solid ${theme.line}` }}>
                                                        <td style={{ padding: '15px 10px', fontFamily: theme.sans, fontSize: '0.9rem' }}>{row.itemName}</td>
                                                        <td style={{ padding: '15px 10px', fontFamily: theme.mono, fontSize: '0.85rem', textAlign: 'center', color: binIsNew ? theme.brass : theme.inkSoft }}>{effBin || '—'}{binIsNew ? ' (new)' : ''}</td>
                                                        <td style={{ padding: '15px 10px', fontFamily: theme.mono, fontSize: '1.1rem', textAlign: 'center' }}>{row.binOnHand}</td>
                                                        <td style={{ padding: '15px 10px', fontFamily: theme.mono, fontSize: '1.1rem', textAlign: 'center' }}>{physicalCounts[row.rowKey]}</td>
                                                        <td style={{ padding: '15px 10px', fontFamily: theme.mono, fontSize: '1.1rem', textAlign: 'center', color: delta < 0 ? '#d9534f' : delta > 0 ? '#7dbb81' : theme.inkSoft }}>
                                                            {delta > 0 ? `+${delta}` : delta}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                    <div style={{ marginBottom: '24px' }}>
                                        <label style={{ display: 'block', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>
                                            Adjustment Memo{operator?.name ? ` — recorded as ${operator.name}` : ''}
                                        </label>
                                        <textarea
                                            value={countMemo}
                                            onChange={e => setCountMemo(e.target.value)}
                                            placeholder="Optional note (reason for the variance, who verified, etc.). Pushed to the NetSuite memo field along with your name."
                                            rows={2}
                                            style={{ width: '100%', padding: '12px', fontFamily: theme.sans, fontSize: '0.9rem', color: theme.ink, border: `1px solid ${theme.line}`, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
                                        />
                                    </div>
                                    <div style={{ display: 'flex', gap: '20px', justifyContent: 'flex-end' }}>
                                        <button onClick={() => setShowSynapsis(false)} style={{ padding: '15px 30px', background: 'transparent', border: `1px solid ${theme.line}`, cursor: 'pointer', fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase' }}>Go Back</button>
                                        <button onClick={pushInventoryAdjustment} disabled={isSyncing} style={{ padding: '15px 30px', background: theme.brass, color: '#fff', border: 'none', cursor: isSyncing ? 'wait' : 'pointer', fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase' }}>
                                            {isSyncing ? 'Pushing to ERP...' : 'Approve & Push Adjustment'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* HEADER FILTERS */}
                        <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '24px', display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ padding: '12px', border: `1px solid ${theme.line}`, fontFamily: theme.sans, outline: 'none', background: theme.paper2, minWidth: '150px' }}>
                                <option value="">All Categories</option>
                                {dynamicProdTypes.map(pt => <option key={pt} value={pt}>{pt}</option>)}
                            </select>
                            <select value={collectionFilter} onChange={(e) => setCollectionFilter(e.target.value)} style={{ padding: '12px', border: `1px solid ${theme.line}`, fontFamily: theme.sans, outline: 'none', background: theme.paper2, minWidth: '150px' }}>
                                <option value="">All Collections</option>
                                {dynamicCollections.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <select value={watchlistFilter} onChange={(e) => setWatchlistFilter(e.target.value)} style={{ padding: '12px', border: `1px solid ${theme.line}`, fontFamily: theme.sans, outline: 'none', background: theme.paper2, minWidth: '150px' }}>
                                <option value="">All Watchlists</option>
                                {dynamicWatchlists.map(w => <option key={w} value={w}>{w}</option>)}
                            </select>
                            <input placeholder="Search name, SKU, item id, or bin…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} style={{ padding: '12px', border: `1px solid ${theme.line}`, fontFamily: theme.sans, outline: 'none', flex: 1, minWidth: '180px' }} />
                            {(typeFilter || collectionFilter || watchlistFilter || searchQuery) && <button onClick={() => { setTypeFilter(''); setCollectionFilter(''); setWatchlistFilter(''); setSearchQuery(''); }} style={{ padding: '12px 14px', background: 'transparent', color: theme.inkSoft, border: `1px solid ${theme.line}`, cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase' }}>Clear</button>}
                            <button onClick={pullNetSuiteStock} disabled={isSyncing} style={{ padding: '12px 20px', background: isSyncing ? theme.paper : theme.ink, color: isSyncing ? theme.inkSoft : '#fff', border: 'none', cursor: isSyncing ? 'wait' : 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase' }}>
                                {isSyncing ? 'Syncing...' : 'Pull Live Stock'}
                            </button>
                        </div>

                        {/* COUNTING TABLE */}
                        <div style={{ flex: 1, background: '#fff', border: `1px solid ${theme.line}`, overflowY: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                <thead style={{ background: theme.paper2, position: 'sticky', top: 0, zIndex: 10 }}>
                                    <tr>
                                        <th style={{ padding: '16px', borderBottom: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase' }}>ERP ID / Item</th>
                                        <th style={{ padding: '16px', borderBottom: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', textAlign: 'center' }}>Bin</th>
                                        <th style={{ padding: '16px', borderBottom: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', textAlign: 'center' }}>Bin O.H.</th>
                                        <th style={{ padding: '16px', borderBottom: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', textAlign: 'center' }}>Physical Count</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {countRows.map(row => (
                                        <tr key={row.rowKey} style={{ borderBottom: `1px solid ${theme.line}`, background: physicalCounts[row.rowKey] !== undefined ? '#f8fdf8' : '#fff' }}>
                                            <td style={{ padding: '16px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                    <button onClick={() => { const bin = String(binEdits[row.rowKey] ?? row.countBin ?? '').trim(); printItemLabel({ itemId: row.erpId, itemName: row.itemName, imageUrl: row.imageUrl || row.manufacturingSpecs?.referenceImageUrl || '' }); if (bin && bin.toUpperCase() !== 'UNASSIGNED') setTimeout(() => printBinLabel({ bin }), 400); }} title="Print 2×4 item + bin labels" style={{ background: 'none', border: `1px solid ${theme.line}`, cursor: 'pointer', fontSize: '1rem', padding: '4px 8px', lineHeight: 1, color: theme.ink }}>🖨</button>
                                                    <div>
                                                        <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>{row.erpId}</div>
                                                        <div style={{ fontFamily: theme.sans, fontSize: '1rem', color: theme.ink, fontWeight: 500 }}>{row.itemName}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td style={{ padding: '16px', textAlign: 'center' }}>
                                                {row.isExistingBin ? (
                                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                                                        <span style={{ fontFamily: theme.mono, fontSize: '12px', color: theme.brass }}>{row.countBin}</span>
                                                        <button onClick={() => addCountBin(row)} title="Found this item in another bin? Add a row to count it there (posts a +adjustment into that bin)." style={{ background: 'none', border: 'none', color: theme.inkSoft, fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', cursor: 'pointer', textDecoration: 'underline' }}>+ add bin</button>
                                                    </div>
                                                ) : (
                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                                                        <input value={binEdits[row.rowKey] ?? (String(row.countBin || '').toUpperCase() === 'UNASSIGNED' ? '' : row.countBin)} onChange={e => setBinEdits(prev => ({ ...prev, [row.rowKey]: e.target.value }))} placeholder={row.isExtra ? 'new bin #…' : 'type bin #…'} style={{ width: '130px', padding: '8px', textAlign: 'center', fontFamily: theme.mono, fontSize: '12px', color: theme.brass, background: 'transparent', border: (binEdits[row.rowKey] !== undefined && (binEdits[row.rowKey] || '').toUpperCase() !== (row.countBin || '').toUpperCase()) ? `2px solid ${theme.brass}` : `1px solid ${theme.line}`, outline: 'none', boxSizing: 'border-box' }} />
                                                        {row.isExtra && <button onClick={() => removeCountBin(row.rowKey)} title="Remove this added bin row" style={{ background: 'none', border: 'none', color: '#d9534f', fontSize: '1.1rem', lineHeight: 1, cursor: 'pointer', padding: 0 }}>×</button>}
                                                    </div>
                                                )}
                                            </td>
                                            <td style={{ padding: '16px', textAlign: 'center', fontFamily: theme.mono, fontSize: '1.2rem', color: theme.inkSoft }}>{row.binOnHand}</td>
                                            <td style={{ padding: '16px', textAlign: 'center' }}>
                                                <input
                                                    type="number"
                                                    placeholder="-"
                                                    value={physicalCounts[row.rowKey] !== undefined ? physicalCounts[row.rowKey] : ''}
                                                    onChange={(e) => setPhysicalCounts(prev => ({ ...prev, [row.rowKey]: e.target.value === "" ? undefined : Math.max(0, parseInt(e.target.value) || 0) }))}
                                                    style={{ width: '100px', padding: '12px', textAlign: 'center', fontSize: '1.2rem', fontFamily: theme.mono, border: physicalCounts[row.rowKey] !== undefined ? `2px solid ${theme.brass}` : `1px solid ${theme.line}`, outline: 'none' }}
                                                />
                                            </td>
                                        </tr>
                                    ))}
                                    {countRows.length === 0 && (
                                        <tr>
                                            <td colSpan="4" style={{ padding: '40px', textAlign: 'center', color: theme.inkSoft, fontStyle: 'italic', fontFamily: theme.serif }}>No inventory items matched your filter.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* BOTTOM ACTION BAR */}
                        <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft, textTransform: 'uppercase' }}>
                                Bins Counted: {Object.keys(physicalCounts).filter(k => physicalCounts[k] !== undefined).length}
                            </div>
                            <button 
                                onClick={() => setShowSynapsis(true)} 
                                disabled={Object.keys(physicalCounts).filter(k => physicalCounts[k] !== undefined).length === 0}
                                style={{ padding: '15px 30px', background: Object.keys(physicalCounts).filter(k => physicalCounts[k] !== undefined).length > 0 ? theme.ink : theme.paper2, color: Object.keys(physicalCounts).filter(k => physicalCounts[k] !== undefined).length > 0 ? '#fff' : theme.inkSoft, border: 'none', cursor: Object.keys(physicalCounts).filter(k => physicalCounts[k] !== undefined).length > 0 ? 'pointer' : 'not-allowed', fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em' }}
                            >
                                Generate Synapsis
                            </button>
                        </div>
                    </div>
                )}

                {/* 🔁 TAB: CONVERT (raw -> in-house phosphated assembly build) */}
                {activeTab === 'CONVERT' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '30px', height: '100%' }}>

                        {/* NEEDS PHOSPHATING — to-dos routed from HQ Stock View (3-Tier): the /P ran low,
                            pull that many raw cores and convert them. Clicking one opens the convert modal
                            already filled in; the to-do closes when the BUILD posts, not at the cart. */}
                        {!convertBase && convertDemands.length > 0 && (
                            <div style={{ background: '#fff', border: `1px solid ${theme.brass}`, padding: '20px 24px' }}>
                                <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '12px' }}>Needs Phosphating · {convertDemands.length} to-do{convertDemands.length === 1 ? '' : 's'} routed from HQ</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {convertDemands.map(d => {
                                        const onCart = d.status === 'on_cart';
                                        const rawPart = enrichedByErp(d.baseErpId);
                                        const tgtPart = enrichedByErp(d.targetErpId);
                                        return (
                                            <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', borderBottom: `1px solid ${theme.line}`, paddingBottom: '8px' }}>
                                                <div style={{ fontFamily: theme.mono, fontSize: '12px', color: theme.ink }}>
                                                    {d.baseErpId} → <span style={{ color: theme.brass }}>{d.targetErpId}</span> · {d.qty} pcs{d.woNum ? ` · ${d.woNum}` : ''}{d.finWoId ? ` · for ${d.finWoErpId || finRefOf(d.finWoId)}` : ''}{d.nsWoTran ? <span style={{ color: '#3a7d33' }}>{` · NS WO ${d.nsWoTran}${d.nsWoOnErp && d.nsWoOnErp !== d.targetErpId ? ` (on ${d.nsWoOnErp})` : ''}`}</span> : ''}{d.createdBy ? ` · ${d.createdBy}` : ''}
                                                    {rawPart && <span style={{ color: theme.inkSoft }}> · raw on hand {rawPart.onHand}</span>}
                                                    {onCart && <span style={{ color: '#2f7d3b' }}> · ON CART — convert it above</span>}
                                                </div>
                                                <button onClick={() => {
                                                    if (!rawPart) { alert(`${d.baseErpId} isn't in this brand's item list yet — Sync NetSuite Stock first, then try again.`); return; }
                                                    setConvertBase(rawPart);
                                                    setConvertTargetId(tgtPart ? tgtPart.id : "");
                                                    setConvertTargetSearch(""); setConvertQty(String(d.qty || '')); setConvertSrcScan(""); setConvertDestScan(""); setConvertMemo("");
                                                    setConvertLot(new Date().toLocaleDateString('en-CA'));
                                                    setConvertDemandId(d.id);
                                                }} disabled={isSyncing || onCart} style={{ padding: '10px 16px', background: onCart ? theme.paper2 : theme.brass, color: onCart ? theme.inkSoft : '#fff', border: onCart ? `1px solid ${theme.line}` : 'none', cursor: (isSyncing || onCart) ? 'not-allowed' : 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' }}>{onCart ? 'On cart' : 'Pull & Convert →'}</button>
                                                {d.nsWoId && ['admin', 'superadmin'].includes(safeUserRole) && (
                                                    <button onClick={async () => {
                                                        // ⟲ RE-ANCHOR (Stuart 2026-08-31): for the multi-fire cleanup — close the
                                                        // stray NetSuite WOs there FIRST, then this clears the stamps and queues
                                                        // exactly one fresh WO under the current rule (/P first).
                                                        const pick = pickNsWoItem({ base: enrichedByErp(d.baseErpId), target: enrichedByErp(d.targetErpId), baseErp: d.baseErpId, targetErp: d.targetErpId });
                                                        if (!pick) return alert(`Neither ${d.baseErpId} nor ${d.targetErpId} is a synced NetSuite ASSEMBLY here — Sync NetSuite Stock / fix the item first.`);
                                                        if (!window.confirm(`⟲ Re-anchor ${d.targetErpId} ×${d.qty}?\n\nCurrent stamp ${d.nsWoTran || d.nsWoId} is dropped and ONE fresh NetSuite work order is queued on ${pick.erp}.\n\nClose the old WO(s) in NetSuite yourself first — this does not close anything there. Continue?`)) return;
                                                        try {
                                                            await updateDoc(doc(db, 'convert_demand', d.id), { nsWoId: deleteField(), nsWoTran: deleteField(), nsWoOnErp: deleteField(), nsWoQueuedAt: Date.now(), nsWoQueuedBy: `${operator?.name || 'WMS'} re-anchor`, nsWoAttempts: 1 });
                                                            await queueNsAssemblyWorkOrder({
                                                                brandId: activeBrand, assemblyInternalId: pick.internalId, erp: pick.erp, qty: d.qty,
                                                                memo: `${d.soRef ? `SO ${d.soRef} · ` : ''}${pick.side === 'base' ? `mill ${d.baseErpId}, convert to ${d.targetErpId}` : `convert ${d.baseErpId} → ${d.targetErpId}`}${d.finWoErpId ? ` · for ${d.finWoErpId}` : ''}`,
                                                                writeBacks: [{ collection: 'convert_demand', docId: d.id, patch: { nsWoOnErp: pick.erp }, idField: 'nsWoId', tranField: 'nsWoTran' }],
                                                                sourceApp: 'WMS_REANCHOR', createdBy: operator?.name || '',
                                                            });
                                                            alert(`📤 One fresh NetSuite work order queued on ${pick.erp} ×${d.qty} — its number lands on this row in ~1 min.`);
                                                        } catch (e) { alert('Re-anchor failed: ' + (e.message || e)); }
                                                    }} disabled={isSyncing}
                                                        title="Drop this demand's NetSuite WO stamp and queue ONE fresh work order under the current rule. Close the old WO(s) in NetSuite first — this does not close anything there."
                                                        style={{ padding: '10px 12px', background: 'transparent', color: '#8a7a4f', border: '1px solid #8a7a4f', cursor: isSyncing ? 'not-allowed' : 'pointer', fontFamily: theme.mono, fontSize: '10px' }}>⟲ Re-anchor</button>
                                                )}
                                                {!d.nsWoId && d.nsWoQueuedAt && (
                                                    <span style={{ fontFamily: theme.mono, fontSize: '10px', color: '#8a7a4f', alignSelf: 'center' }} title="The NetSuite work order is queued (ns_outbox) — its number stamps here when the worker posts it.">⚓ NS WO queued…</span>
                                                )}
                                                {!d.nsWoId && !d.nsWoQueuedAt && (
                                                    <button onClick={async () => {
                                                        // BACKFILL THE ANCHOR (2026-08-31): demands created before the
                                                        // /P work-order queueing shipped have no NS WO — one click opens
                                                        // it now, so this convert builds AGAINST a work order too.
                                                        const pick = pickNsWoItem({ base: enrichedByErp(d.baseErpId), target: enrichedByErp(d.targetErpId), baseErp: d.baseErpId, targetErp: d.targetErpId });
                                                        if (!pick) return alert(`Neither ${d.baseErpId} nor ${d.targetErpId} is a synced NetSuite ASSEMBLY here — Sync NetSuite Stock / fix the item first.`);
                                                        try {
                                                            await queueNsAssemblyWorkOrder({
                                                                brandId: activeBrand, assemblyInternalId: pick.internalId,
                                                                erp: pick.erp, qty: d.qty,
                                                                memo: `${d.soRef ? `SO ${d.soRef} · ` : ''}${pick.side === 'base' ? `mill ${d.baseErpId}, convert to ${d.targetErpId}` : `convert ${d.baseErpId} → ${d.targetErpId}`}${d.finWoErpId ? ` · for ${d.finWoErpId}` : ''}`,
                                                                writeBacks: [{ collection: 'convert_demand', docId: d.id, patch: { nsWoOnErp: pick.erp }, idField: 'nsWoId', tranField: 'nsWoTran' }],
                                                                sourceApp: 'WMS_CONVERT', createdBy: operator?.name || '',
                                                            });
                                                            await updateDoc(doc(db, 'convert_demand', d.id), { nsWoQueuedAt: Date.now(), nsWoQueuedBy: operator?.name || 'WMS', nsWoAttempts: (d.nsWoAttempts || 0) + 1 });
                                                            alert(`📤 NetSuite work order queued on ${pick.erp} ×${d.qty}${pick.side === 'base' ? ' (the root item)' : ''} — its number lands on this row in ~1 min.`);
                                                        } catch (e) { alert('NS WO queue failed: ' + (e.message || e)); }
                                                    }} disabled={isSyncing}
                                                        title="Open the NetSuite work order this convert should build against (demands created before 8/30 have none). The number stamps back here; the convert then posts createdfrom it."
                                                        style={{ padding: '10px 12px', background: 'transparent', color: '#3a7d44', border: '1px solid #3a7d44', cursor: isSyncing ? 'not-allowed' : 'pointer', fontFamily: theme.mono, fontSize: '10px' }}>⚓ NS WO</button>
                                                )}
                                                {['admin', 'superadmin'].includes(safeUserRole) && (
                                                    <button onClick={() => deleteConvertDemand(d)} disabled={isSyncing}
                                                        title={`Delete this convert to-do (admin) — for strays left by deleted or re-run ordering attempts. If it's the last one gating ${d.finWoErpId || d.finWoId || 'a work order'}, the gate lifts (release stays in RTG).`}
                                                        style={{ padding: '10px 12px', background: 'transparent', color: '#d9534f', border: '1px solid #d9534f', cursor: isSyncing ? 'not-allowed' : 'pointer', fontFamily: theme.mono, fontSize: '10px' }}>✕</button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* CONVERSION CART — pull raw → WIP cart bin in one trip, then convert off the cart */}
                        <div style={{ background: '#fff', border: `1px solid ${convBatch ? theme.brass : theme.line}`, padding: '20px 24px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: convBatch ? '16px' : '0' }}>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px', flexWrap: 'wrap' }}>
                                    <span style={{ fontFamily: theme.serif, fontSize: '1.4rem', fontWeight: 500, color: theme.ink }}>Conversion Cart</span>
                                    <span style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase' }}>Pull raw → cart bin in one trip, then convert off the cart</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <label style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.inkSoft, textTransform: 'uppercase' }}>Cart bin</label>
                                    <input value={convBatch?.cartBin || cartBin} onChange={e => setCartBin(e.target.value.toUpperCase())} disabled={!!convBatch} style={{ width: '120px', padding: '7px', fontFamily: theme.mono, border: `1px solid ${theme.line}`, textAlign: 'center', background: convBatch ? theme.paper : '#fff' }} />
                                    {convBatch && <button onClick={closeCartBatch} style={{ padding: '8px 14px', background: 'transparent', color: theme.inkSoft, border: `1px solid ${theme.line}`, cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase' }}>Close Batch</button>}
                                </div>
                            </div>
                            {!convBatch ? (
                                <div style={{ fontFamily: theme.sans, fontSize: '0.85rem', color: theme.inkSoft, fontStyle: 'italic' }}>No active cart. Pick a raw item below → set qty + scan its source bin → "➕ Add to Cart". The first add opens a batch and transfers the raw to the cart bin.</div>
                            ) : (
                                <div style={{ maxHeight: '34vh', overflowY: 'auto', border: `1px solid ${theme.line}` }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: theme.sans, fontSize: '0.85rem' }}>
                                    <thead><tr style={{ background: theme.paper, borderBottom: `1px solid ${theme.line}`, position: 'sticky', top: 0, zIndex: 1 }}>
                                        {['Raw item', 'Qty', 'From → Cart', 'Build /P', 'Put-away bin', ''].map(h => <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', color: theme.inkSoft }}>{h}</th>)}
                                    </tr></thead>
                                    <tbody>
                                        {(convBatch.lines || []).map(line => {
                                            const done = line.status === 'converted';
                                            const dg = cartDiag && cartDiag.lineId === line.lineId ? readConvertDiag(cartDiag.res) : null;
                                            return (
                                            <React.Fragment key={line.lineId}>
                                                <tr style={{ borderBottom: dg ? 'none' : `1px solid ${theme.line}`, opacity: done ? 0.55 : 1 }}>
                                                    <td style={{ padding: '10px 12px' }}><div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>{line.rawErpId}</div><div style={{ color: theme.ink }}>{line.rawName}</div></td>
                                                    <td style={{ padding: '10px 12px', fontFamily: theme.mono }}>{line.qty}</td>
                                                    <td style={{ padding: '10px 12px', fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>{line.srcBin} → {convBatch.cartBin}</td>
                                                    <td style={{ padding: '10px 12px', fontFamily: theme.mono, fontSize: '11px', color: theme.ink }}>{line.targetErpId}</td>
                                                    <td style={{ padding: '10px 12px' }}>{done ? <span style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.brass }}>{line.newBin || '—'}</span> : <input value={cartBinEdits[line.lineId] ?? line.newBin ?? ''} onChange={e => setCartBinEdits(prev => ({ ...prev, [line.lineId]: e.target.value.toUpperCase() }))} placeholder="bin…" style={{ width: '100px', padding: '6px', fontFamily: theme.mono, fontSize: '11px', border: `1px solid ${theme.line}`, textAlign: 'center', outline: 'none' }} />}</td>
                                                    <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>{done ? <span style={{ fontFamily: theme.mono, fontSize: '10px', color: '#2f7d3b', textTransform: 'uppercase' }}>Converted ✓</span> : (<>
                                                        {/* Reads the BOM through the RESTlet's diag mode — posts NOTHING. Run it on a line
                                                            NetSuite rejected: it names which component line is unresolved and why. */}
                                                        <button onClick={() => (dg ? setCartDiag(null) : runCartDiag(line))} disabled={isSyncing} style={{ padding: '8px 12px', marginRight: '8px', background: 'transparent', color: theme.inkSoft, border: `1px solid ${theme.line}`, cursor: isSyncing ? 'wait' : 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase' }}>{dg ? 'Hide' : 'Check BOM'}</button>
                                                        <button onClick={() => convertCartLine(line)} disabled={isSyncing} style={{ padding: '8px 14px', background: theme.brass, color: '#fff', border: 'none', cursor: isSyncing ? 'wait' : 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase' }}>Convert ▸</button>
                                                    </>)}</td>
                                                </tr>
                                                {dg && (
                                                    <tr style={{ borderBottom: `1px solid ${theme.line}` }}>
                                                        <td colSpan="6" style={{ padding: '0 12px 14px 12px', background: theme.paper }}>
                                                            <div style={{ border: `1px solid ${theme.line}`, background: '#fff', padding: '14px 16px' }}>
                                                                <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '10px' }}>
                                                                    What NetSuite's BOM sources for {line.targetErpId} · {diagSummary(dg)} · nothing was posted
                                                                </div>
                                                                {dg.error ? (
                                                                    <div style={{ fontFamily: theme.mono, fontSize: '11px', color: '#d9534f' }}>{dg.error}</div>
                                                                ) : (
                                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                                        {dg.lines.map((l, i) => {
                                                                            const ok = isHealthyState(l.state);
                                                                            const isTail = dg.tailUncommitted && i === dg.lines.length - 1;
                                                                            return (
                                                                                <div key={i} style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.ink, display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'baseline' }}>
                                                                                    <span style={{ color: ok ? '#3f8b45' : '#d9534f', fontWeight: 700 }}>{ok ? '✓' : '✗'}</span>
                                                                                    <span style={{ fontWeight: 600 }}>line {l.line + 1}</span>
                                                                                    <span title={(diagNames[String(l.item)] || {}).name || ''}>{codeForNsId(l.item)}</span>
                                                                                    <span style={{ color: theme.inkSoft }}>needs {l.needed}{l.fractional ? ` (bom ${l.qBom}/build)` : ''}</span>
                                                                                    <span style={{ color: theme.inkSoft }}>{l.onHand ? `${l.onHand} on hand in the bin it picked` : 'no stock resolved'}</span>
                                                                                    {l.assigned !== null && <span style={{ color: theme.inkSoft }}>assigned {l.assigned}</span>}
                                                                                    {isTail && <span style={{ color: '#d9534f', fontWeight: 600 }}>LAST LINE — still open at save</span>}
                                                                                    {l.error && <span style={{ color: '#d9534f' }}>{l.error}</span>}
                                                                                </div>
                                                                            );
                                                                        })}
                                                                        <div style={{ fontFamily: theme.mono, fontSize: '10px', lineHeight: 1.5, marginTop: '8px', color: dg.ok ? '#3f8b45' : theme.inkSoft }}>{dg.advice}</div>
                                                                    </div>
                                                                )}
                                                                {/* The raw reply, so a failure can be sent on verbatim instead of retyped. */}
                                                                <details style={{ marginTop: '10px' }}>
                                                                    <summary style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>Raw reply</summary>
                                                                    <button onClick={() => { try { navigator.clipboard.writeText(JSON.stringify(cartDiag.res, null, 2)); } catch (e) { /* clipboard blocked — the text is on screen */ } }} style={{ margin: '8px 0', padding: '6px 10px', background: 'transparent', border: `1px solid ${theme.line}`, color: theme.inkSoft, fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', cursor: 'pointer' }}>Copy</button>
                                                                    <pre style={{ margin: 0, maxHeight: '220px', overflow: 'auto', background: theme.paper, padding: '10px', fontFamily: theme.mono, fontSize: '10px', color: theme.ink }}>{JSON.stringify(cartDiag.res, null, 2)}</pre>
                                                                </details>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                            );
                                        })}
                                        {(convBatch.lines || []).length === 0 && <tr><td colSpan="6" style={{ padding: '14px 12px', color: theme.inkSoft, fontStyle: 'italic' }}>Cart is empty — add raw items below.</td></tr>}
                                    </tbody>
                                </table>
                                </div>
                            )}
                        </div>

                        {/* CONVERT MODAL */}
                        {convertBase && (
                            <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.8)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <div style={{ background: '#fff', padding: '40px', width: 'min(720px, 96vw)', maxHeight: '90vh', overflowY: 'auto', border: `1px solid ${theme.line}`, boxShadow: '0 4px 24px rgba(0,0,0,0.1)' }}>
                                    <h2 style={{ margin: '0 0 6px 0', fontFamily: theme.serif, fontSize: '2rem', color: theme.ink }}>Convert to Phosphated</h2>
                                    <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, marginBottom: '24px', letterSpacing: '.1em', textTransform: 'uppercase' }}>
                                        Posts a NetSuite assembly build · Subsidiary {BRAND_NETSUITE_MAP[activeBrand]?.subsidiary} | Location {BRAND_NETSUITE_MAP[activeBrand]?.location}
                                    </div>

                                    {/* FROM / TO */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '16px', alignItems: 'center', marginBottom: '24px' }}>
                                        <div style={{ border: `1px solid ${theme.line}`, padding: '16px', background: theme.paper }}>
                                            <div style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '6px' }}>Consume (raw)</div>
                                            <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>{convertBase.erpId}</div>
                                            <div style={{ fontFamily: theme.sans, fontSize: '1rem', color: theme.ink, fontWeight: 500 }}>{convertBase.itemName}</div>
                                            <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.brass, marginTop: '6px' }}>bin {binOf(convertBase)} · {convertBase.onHand} on hand</div>
                                        </div>
                                        <div style={{ fontFamily: theme.serif, fontSize: '1.6rem', color: theme.brass }}>→</div>
                                        <div style={{ border: `1px solid ${convTarget ? theme.brass : '#d9534f'}`, padding: '16px', background: theme.paper }}>
                                            <div style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '6px' }}>Build (phosphated)</div>
                                            {convTarget ? (
                                                <>
                                                    <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>{erpOf(convTarget)}{!convTarget.netSuiteInternalId && <span style={{ color: '#d9534f' }}> · NO NS ID</span>}</div>
                                                    <div style={{ fontFamily: theme.sans, fontSize: '1rem', color: theme.ink, fontWeight: 500 }}>{convTarget.itemName}</div>
                                                    <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.brass, marginTop: '6px' }}>bin {binOf(convTarget)}</div>
                                                </>
                                            ) : (
                                                <div style={{ fontFamily: theme.sans, fontSize: '0.9rem', color: '#d9534f' }}>No "/P" assembly found — search below.</div>
                                            )}
                                        </div>
                                    </div>

                                    {/* TARGET OVERRIDE SEARCH */}
                                    <div style={{ marginBottom: '24px' }}>
                                        <label style={{ display: 'block', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Target assembly {convTarget ? '(change)' : '(pick)'}</label>
                                        <input value={convertTargetSearch} onChange={e => setConvertTargetSearch(e.target.value)} placeholder="Search assembly by name or ID…" style={{ width: '100%', padding: '12px', fontFamily: theme.sans, fontSize: '0.9rem', border: `1px solid ${theme.line}`, outline: 'none', boxSizing: 'border-box' }} />
                                        {convTargetMatches.length > 0 && (
                                            <div style={{ border: `1px solid ${theme.line}`, borderTop: 'none', maxHeight: '160px', overflowY: 'auto' }}>
                                                {convTargetMatches.map(p => (
                                                    <div key={p.id} onClick={() => { setConvertTargetId(p.id); setConvertTargetSearch(""); }} style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: `1px solid ${theme.line}`, display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                                                        <span style={{ fontFamily: theme.sans, fontSize: '0.9rem', color: theme.ink }}>{p.itemName}</span>
                                                        <span style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>{erpOf(p)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    {/* QTY + SCANS */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                                        <div>
                                            <label style={{ display: 'block', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Quantity</label>
                                            <input type="number" min="1" max={convSrcBin ? convSrcQty : convertBase.onHand} value={convertQty} onChange={e => setConvertQty(e.target.value)} placeholder="0" style={{ width: '100%', padding: '12px', fontFamily: theme.mono, fontSize: '1.2rem', textAlign: 'center', border: `2px solid ${convQtyNum > 0 && convQtyNum <= (convSrcBin ? convSrcQty : convertBase.onHand) ? theme.brass : theme.line}`, outline: 'none', boxSizing: 'border-box' }} />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Source bin {canClickBin ? '(pick one)' : '(scan)'}</label>
                                            {canClickBin && convSrcBins.length > 0 && (
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
                                                    {convSrcBins.map(b => { const sel = convertSrcScan.trim().toUpperCase() === String(b.bin).toUpperCase(); return (
                                                        <button key={b.bin} onClick={() => setConvertSrcScan(b.bin)} style={{ padding: '5px 9px', fontFamily: theme.mono, fontSize: '10px', cursor: 'pointer', border: `1px solid ${sel ? '#7dbb81' : theme.line}`, background: sel ? '#eaf5ea' : '#fff', color: theme.ink }}>{b.bin} ({b.qty})</button>
                                                    ); })}
                                                </div>
                                            )}
                                            <input value={convertSrcScan} onChange={e => setConvertSrcScan(e.target.value)} placeholder={canClickBin ? "scan / click a bin" : "scan a bin"} style={{ width: '100%', padding: '12px', fontFamily: theme.mono, fontSize: '1rem', textAlign: 'center', border: `2px solid ${convSrcOk ? '#7dbb81' : theme.line}`, outline: 'none', boxSizing: 'border-box' }} />
                                            <div style={{ fontFamily: theme.mono, fontSize: '9px', color: convSrcOk ? '#7dbb81' : theme.inkSoft, marginTop: '4px', textAlign: 'center' }}>{convSrcOk ? `✓ ${convSrcQty} in this bin` : (convSrcBins.length ? 'pick a bin above' : 'no live bins — Pull Live Stock')}</div>
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Scan dest bin</label>
                                            <input value={convertDestScan} onChange={e => setConvertDestScan(e.target.value)} placeholder={convTarget ? binOf(convTarget) : '—'} disabled={!convTarget} style={{ width: '100%', padding: '12px', fontFamily: theme.mono, fontSize: '1rem', textAlign: 'center', border: `2px solid ${convDestOk ? '#7dbb81' : theme.line}`, outline: 'none', boxSizing: 'border-box' }} />
                                            <div style={{ fontFamily: theme.mono, fontSize: '9px', color: convDestOk ? '#7dbb81' : theme.inkSoft, marginTop: '4px', textAlign: 'center' }}>{convDestOk ? '✓ matches' : (convTarget ? `expect ${binOf(convTarget)}` : '')}</div>
                                        </div>
                                    </div>

                                    {/* LOT / SERIAL # (finished assembly) */}
                                    <div style={{ marginBottom: '24px' }}>
                                        <label style={{ display: 'block', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Lot / serial # (finished)</label>
                                        <input value={convertLot} onChange={e => setConvertLot(e.target.value)} placeholder="Required if this assembly is lot/serial-tracked in NetSuite" style={{ width: '100%', padding: '12px', fontFamily: theme.mono, fontSize: '1rem', color: theme.ink, border: `1px solid ${theme.line}`, outline: 'none', boxSizing: 'border-box' }} />
                                    </div>

                                    {/* MEMO */}
                                    <div style={{ marginBottom: '24px' }}>
                                        <label style={{ display: 'block', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Build memo{operator?.name ? ` — recorded as ${operator.name}` : ''}</label>
                                        <textarea value={convertMemo} onChange={e => setConvertMemo(e.target.value)} placeholder="Optional note. Pushed to the NetSuite build memo with your name." rows={2} style={{ width: '100%', padding: '12px', fontFamily: theme.sans, fontSize: '0.9rem', color: theme.ink, border: `1px solid ${theme.line}`, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
                                    </div>

                                    <div style={{ display: 'flex', gap: '20px', justifyContent: 'flex-end' }}>
                                        <button onClick={() => { setConvertBase(null); setConvertTargetId(""); setConvertTargetSearch(""); setConvertQty(""); setConvertSrcScan(""); setConvertDestScan(""); setConvertMemo(""); setConvertLot(""); setConvertDemandId(null); }} style={{ padding: '15px 30px', background: 'transparent', border: `1px solid ${theme.line}`, cursor: 'pointer', fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase' }}>Cancel</button>
                                        {(() => { const cartReady = !!convertBase && !!convTarget && !!convertBase.netSuiteInternalId && convQtyNum > 0 && convQtyNum <= convSrcQty && convSrcOk; return (
                                            <button onClick={addRawToCart} disabled={!cartReady || isSyncing} title="Pull this raw onto the phosphate cart (transfers it to the cart bin) instead of converting now" style={{ padding: '15px 24px', background: cartReady && !isSyncing ? theme.ink : theme.paper2, color: cartReady && !isSyncing ? '#fff' : theme.inkSoft, border: 'none', cursor: cartReady && !isSyncing ? 'pointer' : 'not-allowed', fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase' }}>
                                                {isSyncing ? 'Working…' : '➕ Add to Cart'}
                                            </button>
                                        ); })()}
                                        <button onClick={pushAssemblyBuild} disabled={!convReady || isSyncing} style={{ padding: '15px 30px', background: convReady && !isSyncing ? theme.brass : theme.paper2, color: convReady && !isSyncing ? '#fff' : theme.inkSoft, border: 'none', cursor: convReady && !isSyncing ? 'pointer' : 'not-allowed', fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase' }}>
                                            {isSyncing ? 'Posting build…' : 'Build & Post to NetSuite'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* HEADER FILTERS */}
                        <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '24px', display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ padding: '12px', border: `1px solid ${theme.line}`, fontFamily: theme.sans, outline: 'none', background: theme.paper2, minWidth: '150px' }}>
                                <option value="">All Categories</option>
                                {dynamicProdTypes.map(pt => <option key={pt} value={pt}>{pt}</option>)}
                            </select>
                            <select value={collectionFilter} onChange={(e) => setCollectionFilter(e.target.value)} style={{ padding: '12px', border: `1px solid ${theme.line}`, fontFamily: theme.sans, outline: 'none', background: theme.paper2, minWidth: '150px' }}>
                                <option value="">All Collections</option>
                                {dynamicCollections.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <select value={watchlistFilter} onChange={(e) => setWatchlistFilter(e.target.value)} style={{ padding: '12px', border: `1px solid ${theme.line}`, fontFamily: theme.sans, outline: 'none', background: theme.paper2, minWidth: '150px' }}>
                                <option value="">All Watchlists</option>
                                {dynamicWatchlists.map(w => <option key={w} value={w}>{w}</option>)}
                            </select>
                            <input placeholder="Search a raw item to convert…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} style={{ padding: '12px', border: `1px solid ${theme.line}`, fontFamily: theme.sans, outline: 'none', flex: 1, minWidth: '180px' }} />
                            {(typeFilter || collectionFilter || watchlistFilter || searchQuery) && <button onClick={() => { setTypeFilter(''); setCollectionFilter(''); setWatchlistFilter(''); setSearchQuery(''); }} style={{ padding: '12px 14px', background: 'transparent', color: theme.inkSoft, border: `1px solid ${theme.line}`, cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase' }}>Clear</button>}
                            <button onClick={pullNetSuiteStock} disabled={isSyncing} style={{ padding: '12px 20px', background: isSyncing ? theme.paper : theme.ink, color: isSyncing ? theme.inkSoft : '#fff', border: 'none', cursor: isSyncing ? 'wait' : 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase' }}>
                                {isSyncing ? 'Syncing...' : 'Pull Live Stock'}
                            </button>
                        </div>

                        {/* INVENTORY TABLE */}
                        <div style={{ flex: 1, background: '#fff', border: `1px solid ${theme.line}`, overflowY: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                <thead style={{ background: theme.paper2, position: 'sticky', top: 0, zIndex: 10 }}>
                                    <tr>
                                        <th style={{ padding: '16px', borderBottom: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase' }}>ERP ID / Item</th>
                                        <th style={{ padding: '16px', borderBottom: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', textAlign: 'center' }}>Bin Location</th>
                                        <th style={{ padding: '16px', borderBottom: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', textAlign: 'center' }}>On Hand</th>
                                        <th style={{ padding: '16px', borderBottom: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', textAlign: 'center' }}>Convert</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {/* Convert only RAW items (mill finish) — those whose item # has no "/" suffix; the
                                        "/P", "/P25" … are the finished/plated results, never a conversion source. */}
                                    {baseFilteredItems.filter(it => !String(it.erpId || '').includes('/')).map(item => (
                                        <tr key={item.id} style={{ borderBottom: `1px solid ${theme.line}` }}>
                                            <td style={{ padding: '16px' }}>
                                                <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>{item.erpId}</div>
                                                <div style={{ fontFamily: theme.sans, fontSize: '1rem', color: theme.ink, fontWeight: 500 }}>{item.itemName}</div>
                                            </td>
                                            <td style={{ padding: '16px', textAlign: 'center', fontFamily: theme.mono, fontSize: '12px', color: theme.brass }}>{item.binLocation}</td>
                                            <td style={{ padding: '16px', textAlign: 'center', fontFamily: theme.mono, fontSize: '1.2rem', color: theme.inkSoft }}>{item.onHand}</td>
                                            <td style={{ padding: '16px', textAlign: 'center' }}>
                                                <button onClick={() => { setConvertBase(item); setConvertTargetId(""); setConvertTargetSearch(""); setConvertQty(""); setConvertSrcScan(""); setConvertDestScan(""); setConvertMemo(""); setConvertLot(new Date().toLocaleDateString('en-CA')); setConvertDemandId(null); }} style={{ padding: '10px 18px', background: theme.ink, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Convert →</button>
                                            </td>
                                        </tr>
                                    ))}
                                    {baseFilteredItems.length === 0 && (
                                        <tr>
                                            <td colSpan="4" style={{ padding: '40px', textAlign: 'center', color: theme.inkSoft, fontStyle: 'italic', fontFamily: theme.serif }}>No inventory items matched your filter.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* ⇄ TAB: BIN TRANSFER (move qty between bins within a location) */}
                {/* MODE SWITCH — this tab carries two shop tools: rod cutting and ring-pack building. */}
                {activeTab === 'ROD CUTS' && (
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '18px' }}>
                        {[['CUTS', '✂ ROD CUTS'], ['PACKS', '⬡ RING PACKS']].map(([m, label]) => (
                            <button key={m} onClick={() => setRodTabMode(m)} style={{ padding: '10px 18px', background: rodTabMode === m ? theme.ink : 'transparent', color: rodTabMode === m ? '#fff' : theme.inkSoft, border: `1px solid ${rodTabMode === m ? theme.ink : theme.line}`, fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer' }}>{label}</button>
                        ))}
                    </div>
                )}

                {/* ⬡ RING PACKS — build stocked multi-packs from loose eaches (Stuart 2026-07-28:
                    "assembly build the packs, so it will consume our stock of single(EA)… this tool
                    is to build stock for the shelf for stocked items"). Posts the SAME NetSuite
                    assembly build the CONVERT tab uses, so NetSuite's BOM governs what is consumed. */}
                {activeTab === 'ROD CUTS' && rodTabMode === 'PACKS' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        {/* Live pull ON this tab (Eric 2026-08-12 App Imp) — no more detour to Stock/Bin Count. */}
                        {Object.keys(nsStock).length === 0 ? (
                            <div style={{ background: '#fff', border: `1px solid ${theme.brass}`, padding: '14px 18px', fontFamily: theme.mono, fontSize: '11px', color: theme.ink, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                                <span>⚠ No live stock pulled this session — quantities and bins will read 0.</span>
                                <button onClick={pullNetSuiteStock} disabled={isSyncing} style={{ padding: '10px 18px', background: isSyncing ? theme.inkSoft : theme.ink, color: '#fff', border: 'none', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: isSyncing ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}>{isSyncing ? 'Pulling…' : '⟳ Pull Live Stock'}</button>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <button onClick={pullNetSuiteStock} disabled={isSyncing} style={{ padding: '8px 14px', background: 'transparent', color: theme.inkSoft, border: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: isSyncing ? 'wait' : 'pointer' }}>{isSyncing ? 'Pulling…' : '⟳ Refresh Live Stock'}</button>
                            </div>
                        )}
                        <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '24px' }}>
                            <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '4px' }}>1 · Pick the pack to build</div>
                            <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, marginBottom: '12px' }}>Search a root, a name, or the finished each — typing HCUSR15/BL-EA lists every pack built from it. Pack SKUs end in the pack count (/BL-10, /BL-12).</div>
                            <input value={packSearch} onChange={e => { setPackSearch(e.target.value); setPackTargetId(""); }} placeholder="search ring packs…" style={{ width: '100%', padding: '12px', fontFamily: theme.mono, fontSize: '0.95rem', border: `1px solid ${theme.line}`, outline: 'none', boxSizing: 'border-box' }} />
                            {!packTarget && packMatches.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '10px' }}>
                                    {packMatches.map(p => (
                                        <button key={p.id} onClick={() => { setPackTargetId(p.id); setPackComponentId(""); setPackSearch(erpOf(p)); }} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '10px 12px', background: theme.paper, border: `1px solid ${theme.line}`, cursor: 'pointer', textAlign: 'left' }}>
                                            <span style={{ fontFamily: theme.mono, fontSize: '12px', color: theme.ink }}>{erpOf(p)}<span style={{ color: theme.inkSoft }}> · {p.itemName || ''}</span></span>
                                            <span style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.brass, whiteSpace: 'nowrap', textAlign: 'right' }}>
                                                {packSizeOf(erpOf(p))}-PACK · OH {ohOf(p)}
                                                {eachForPack(erpOf(p)) ? <><br /><span style={{ color: ohOfCode(eachForPack(erpOf(p))) > 0 ? '#3f8b45' : theme.inkSoft }}>from {eachForPack(erpOf(p))} · {ohOfCode(eachForPack(erpOf(p)))} ea</span></> : null}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            )}
                            {!packTarget && packSearch.trim().length >= 2 && packMatches.length === 0 && (
                                <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft, marginTop: '10px' }}>No pack SKUs match. A pack must end in its count (e.g. HCUSR15/G-10) and be in this brand's library.</div>
                            )}
                        </div>

                        {packTarget && (
                            <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
                                    <div>
                                        <div style={{ fontFamily: theme.mono, fontSize: '15px', color: theme.ink, fontWeight: 600 }}>{erpOf(packTarget)}</div>
                                        <div style={{ fontFamily: theme.sans, fontSize: '13px', color: theme.inkSoft }}>{packTarget.itemName || ''}</div>
                                        <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.brass, marginTop: '4px' }}>{packSize}-pack · on hand {ohOf(packTarget)} · home bin {binOf(packTarget)}</div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        {/* 🖨 Pack labels — the qty being built (Eric 2026-08-12 App Imp). */}
                                        <button onClick={() => { const n = packQtyNum || parseInt(window.prompt(`How many ${erpOf(packTarget)} labels?`, '1')) || 0; if (n > 0) printStockItemLabels({ itemId: erpOf(packTarget), itemName: packTarget.itemName || '', uom: 'PACK', woNum: '', copies: Math.min(50, n) }); }} title="Print an item label per pack being built (uses the qty entered below, or asks)" style={{ padding: '8px 14px', background: 'transparent', border: `1px solid ${theme.brass}`, color: theme.brass, fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', cursor: 'pointer' }}>🖨 LABELS{packQtyNum ? ` ×${packQtyNum}` : ''}</button>
                                        <button onClick={() => { setPackTargetId(""); setPackSearch(""); setPackQty(""); setPackSrcScan(""); setPackDestScan(""); setPackDiag(null); setDiagNames({}); }} style={{ padding: '8px 14px', background: 'transparent', border: `1px solid ${theme.line}`, color: theme.inkSoft, fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', cursor: 'pointer' }}>CHANGE</button>
                                    </div>
                                </div>

                                {/* BUILD or BREAK — the reversal shares the pack picker above. */}
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    {[['BUILD', '⬡ BUILD PACKS'], ['BREAK', '⤺ BREAK APART']].map(([m, label]) => (
                                        <button key={m} onClick={() => { setPackOp(m); setPackDiag(null); }} style={{ flex: 1, padding: '10px', background: packOp === m ? theme.ink : 'transparent', color: packOp === m ? '#fff' : theme.inkSoft, border: `1px solid ${packOp === m ? theme.ink : theme.line}`, fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer' }}>{label}</button>
                                    ))}
                                </div>

                                {packOp === 'BREAK' && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                                            <div style={{ flex: '0 0 160px' }}>
                                                <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Packs to break</div>
                                                <input value={packQty} onChange={e => setPackQty(e.target.value.replace(/[^0-9]/g, ''))} placeholder="0" inputMode="numeric" style={{ width: '100%', padding: '12px', fontFamily: theme.mono, fontSize: '1.2rem', textAlign: 'center', border: `1px solid ${theme.line}`, outline: 'none', boxSizing: 'border-box' }} />
                                            </div>
                                            <div style={{ flex: 1, minWidth: '240px', fontFamily: theme.mono, fontSize: '12px', color: packQtyNum > 0 ? theme.ink : theme.inkSoft, paddingBottom: '12px' }}>
                                                {packQtyNum > 0 && packComponent
                                                    ? <>takes <b>{packQtyNum}</b> × {erpOf(packTarget)} apart → <b>{breakEachesBack}</b> × {erpOf(packComponent)} back to stock</>
                                                    : 'enter how many packs to take apart'}
                                            </div>
                                        </div>

                                        <div>
                                            <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Bin the PACKS come out of</div>
                                            {breakSrcBins.length > 0 && (
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
                                                    {breakSrcBins.slice().sort((a, b) => b.qty - a.qty).map(b => { const sel = breakSrcScan.trim().toUpperCase() === String(b.bin).toUpperCase(); return (
                                                        <button key={b.bin} onClick={() => setBreakSrcScan(b.bin)} style={{ padding: '5px 9px', fontFamily: theme.mono, fontSize: '10px', cursor: 'pointer', border: `1px solid ${sel ? '#7dbb81' : theme.line}`, background: sel ? '#eaf5ea' : '#fff', color: theme.ink }}>{b.bin} ({b.qty})</button>
                                                    ); })}
                                                </div>
                                            )}
                                            <input value={breakSrcScan} onChange={e => setBreakSrcScan(e.target.value)} placeholder="scan the pack's bin" style={{ width: '100%', padding: '12px', fontFamily: theme.mono, fontSize: '1rem', textAlign: 'center', border: `2px solid ${breakSrcScan.trim() ? (breakSrcBin ? '#7dbb81' : '#d9534f') : theme.line}`, outline: 'none', boxSizing: 'border-box' }} />
                                            <div style={{ fontFamily: theme.mono, fontSize: '9px', textAlign: 'center', marginTop: '4px', color: !breakSrcScan.trim() ? theme.inkSoft : !breakSrcBin ? '#d9534f' : (packQtyNum > breakSrcQty ? '#d9534f' : '#7dbb81') }}>
                                                {!breakSrcScan.trim() ? (breakSrcBins.length ? 'pick or scan one of the bins above' : 'no packs stocked in any bin — nothing to break apart')
                                                    : !breakSrcBin ? '✗ no packs in this bin'
                                                    : packQtyNum > breakSrcQty ? `✗ only ${breakSrcQty} packs in this bin` : `✓ ${breakSrcQty} packs in this bin`}
                                            </div>
                                        </div>

                                        <div>
                                            <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Bin the loose EACHES go into</div>
                                            <input value={breakDestScan} onChange={e => setBreakDestScan(e.target.value)} placeholder={breakDestBin || 'scan the each bin'} style={{ width: '100%', padding: '12px', fontFamily: theme.mono, fontSize: '1rem', textAlign: 'center', border: `2px solid ${breakDestBin ? '#7dbb81' : theme.line}`, outline: 'none', boxSizing: 'border-box' }} />
                                            <div style={{ fontFamily: theme.mono, fontSize: '9px', textAlign: 'center', marginTop: '4px', color: breakDestBin ? '#7dbb81' : '#d9534f' }}>
                                                {breakDestBin ? `✓ ${packComponent ? erpOf(packComponent) : 'eaches'} back into ${breakDestBin}` : '✗ scan where the loose eaches go'}
                                            </div>
                                        </div>

                                        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', border: `1px dashed ${breakToCore ? theme.brass : theme.line}`, padding: '12px', fontFamily: theme.mono, fontSize: '11px', color: breakToCore ? theme.ink : theme.inkSoft }}>
                                            <input type="checkbox" checked={breakToCore} onChange={e => setBreakToCore(e.target.checked)} />
                                            ⤺ also turn the eaches back into the raw core {packRoot ? `(${packRoot})` : ''} — for re-painting into another colour
                                        </label>

                                        {breakToCore && (
                                            <div>
                                                <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Bin the raw {packRoot} goes into</div>
                                                <input value={breakCoreScan} onChange={e => setBreakCoreScan(e.target.value)} placeholder={breakCoreBin || 'scan the raw core bin'} style={{ width: '100%', padding: '12px', fontFamily: theme.mono, fontSize: '1rem', textAlign: 'center', border: `2px solid ${breakCoreBin ? '#7dbb81' : theme.line}`, outline: 'none', boxSizing: 'border-box' }} />
                                                <div style={{ fontFamily: theme.mono, fontSize: '9px', textAlign: 'center', marginTop: '4px', color: !packCorePart ? '#d9534f' : breakCoreBin ? '#7dbb81' : '#d9534f' }}>
                                                    {!packCorePart ? `✗ ${packRoot} isn't in this brand's library` : breakCoreBin ? `✓ ${breakEachesBack} × ${packRoot} into ${breakCoreBin}` : '✗ scan where the raw rings go'}
                                                </div>
                                                <div style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.inkSoft, marginTop: '6px' }}>Posts TWO NetSuite unbuilds — pack → eaches, then eaches → raw. If the second fails the first still stands and you'll be told exactly where it stopped.</div>
                                            </div>
                                        )}

                                        <input value={packMemo} onChange={e => setPackMemo(e.target.value)} placeholder="memo (optional)" style={{ width: '100%', padding: '10px 12px', fontFamily: theme.mono, fontSize: '11px', border: `1px solid ${theme.line}`, outline: 'none', boxSizing: 'border-box' }} />

                                        <button onClick={pushPackBreak} disabled={!breakReady || isSyncing} style={{ padding: '18px', background: breakReady && !isSyncing ? theme.ink : theme.paper, color: breakReady && !isSyncing ? '#fff' : theme.inkSoft, border: `1px solid ${breakReady && !isSyncing ? theme.ink : theme.line}`, fontFamily: theme.mono, fontSize: '12px', letterSpacing: '.15em', textTransform: 'uppercase', cursor: breakReady && !isSyncing ? 'pointer' : 'not-allowed' }}>
                                            {isSyncing ? 'POSTING…' : breakToCore ? `BREAK ${packQtyNum || ''} PACK${packQtyNum === 1 ? '' : 'S'} → CORE` : `BREAK ${packQtyNum || ''} PACK${packQtyNum === 1 ? '' : 'S'} APART`}
                                        </button>
                                        <div style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.inkSoft, textAlign: 'center' }}>Re-packing into another size? Break apart, then switch to BUILD PACKS and build the size you want from the loose eaches.</div>
                                    </div>
                                )}

                                {packOp === 'BUILD' && (<>
                                {/* COMPONENT */}
                                <div>
                                    <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>2 · The finished each it consumes</div>
                                    {packComponentOptions.length === 0 ? (
                                        <div style={{ fontFamily: theme.mono, fontSize: '11px', color: '#d9534f' }}>✗ No finished each found for {packRoot}{packExpectedEach ? ` (expected ${packExpectedEach})` : ''} in this brand's library — finish the raw {packRoot} into it on a work order first.</div>
                                    ) : (
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                            {packComponentOptions.map(c => { const sel = packComponent && c.id === packComponent.id; return (
                                                <button key={c.id} onClick={() => { setPackComponentId(c.id); setPackSrcScan(""); }} style={{ padding: '8px 12px', fontFamily: theme.mono, fontSize: '11px', cursor: 'pointer', border: `1px solid ${sel ? '#7dbb81' : theme.line}`, background: sel ? '#eaf5ea' : '#fff', color: theme.ink }}>
                                                    {erpOf(c)} <span style={{ color: theme.inkSoft }}>· OH {ohOf(c)}</span>
                                                </button>
                                            ); })}
                                        </div>
                                    )}
                                    <div style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.inkSoft, marginTop: '6px' }}>Packs are built from FINISHED eaches — the raw {packRoot} becomes {packExpectedEach || 'the finished each'} on a work order first. NetSuite's BOM decides what actually gets consumed; this picks the bin the parts come out of.</div>
                                    {packEachMissing && packComponentOptions.length > 0 && (
                                        <div style={{ fontFamily: theme.mono, fontSize: '11px', color: '#d9534f', marginTop: '8px' }}>⚠ {packExpectedEach} isn't in this brand's library — the eaches offered above are OTHER finishes. Check the colour before building.</div>
                                    )}
                                    {packComponent && ohOf(packComponent) === 0 && (
                                        <div style={{ fontFamily: theme.mono, fontSize: '11px', color: '#d9534f', marginTop: '8px' }}>✗ {erpOf(packComponent)} has none on hand — finish/plate a batch of {packRoot} into it before packing.</div>
                                    )}
                                </div>

                                {/* QTY */}
                                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                                    <div style={{ flex: '0 0 160px' }}>
                                        <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>3 · Packs to build</div>
                                        <input value={packQty} onChange={e => setPackQty(e.target.value.replace(/[^0-9]/g, ''))} placeholder="0" inputMode="numeric" style={{ width: '100%', padding: '12px', fontFamily: theme.mono, fontSize: '1.2rem', textAlign: 'center', border: `1px solid ${theme.line}`, outline: 'none', boxSizing: 'border-box' }} />
                                    </div>
                                    <div style={{ flex: 1, minWidth: '220px', fontFamily: theme.mono, fontSize: '12px', color: packQtyNum > 0 ? theme.ink : theme.inkSoft, paddingBottom: '12px' }}>
                                        {packQtyNum > 0 && packComponent
                                            ? <>consumes <b>{packEachesNeeded}</b> × {erpOf(packComponent)} <span style={{ color: theme.inkSoft }}>({ohOf(packComponent)} on hand)</span> → builds <b>{packQtyNum}</b> × {erpOf(packTarget)}</>
                                            : 'enter how many packs to build'}
                                    </div>
                                </div>

                                {/* SOURCE BIN */}
                                <div>
                                    <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>4 · Scan the bin the eaches come from</div>
                                    {packSrcBins.length > 0 && (
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
                                            {packSrcBins.slice().sort((a, b) => b.qty - a.qty).map(b => { const sel = packSrcScan.trim().toUpperCase() === String(b.bin).toUpperCase(); return (
                                                <button key={b.bin} onClick={() => setPackSrcScan(b.bin)} style={{ padding: '5px 9px', fontFamily: theme.mono, fontSize: '10px', cursor: 'pointer', border: `1px solid ${sel ? '#7dbb81' : theme.line}`, background: sel ? '#eaf5ea' : '#fff', color: theme.ink }}>{b.bin} ({b.qty})</button>
                                            ); })}
                                        </div>
                                    )}
                                    <input value={packSrcScan} onChange={e => setPackSrcScan(e.target.value)} placeholder="scan source bin" style={{ width: '100%', padding: '12px', fontFamily: theme.mono, fontSize: '1rem', textAlign: 'center', border: `2px solid ${packSrcScan.trim() ? (packSrcBin ? '#7dbb81' : '#d9534f') : theme.line}`, outline: 'none', boxSizing: 'border-box' }} />
                                    <div style={{ fontFamily: theme.mono, fontSize: '9px', textAlign: 'center', marginTop: '4px', color: !packSrcScan.trim() ? theme.inkSoft : !packSrcBin ? '#d9534f' : (packEachesNeeded > packSrcQty ? '#d9534f' : '#7dbb81') }}>
                                        {!packSrcScan.trim() ? (packSrcBins.length ? 'pick or scan one of the bins above' : 'no live bin data — Pull Live Stock on the Stock tab first')
                                            : !packSrcBin ? '✗ the each is not stocked in this bin'
                                            : packEachesNeeded > packSrcQty ? `✗ only ${packSrcQty} in this bin — need ${packEachesNeeded}`
                                            : `✓ ${packSrcQty} in this bin`}
                                    </div>
                                </div>

                                {/* DEST BIN */}
                                <div>
                                    <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>5 · Bin the finished packs go into</div>
                                    {packDestOptions.length > 0 && (
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
                                            {packDestOptions.map(b => { const sel = packDestBin.toUpperCase() === b.toUpperCase(); return (
                                                <button key={b} onClick={() => setPackDestScan(b)} style={{ padding: '5px 9px', fontFamily: theme.mono, fontSize: '10px', cursor: 'pointer', border: `1px solid ${sel ? '#7dbb81' : theme.line}`, background: sel ? '#eaf5ea' : '#fff', color: theme.ink }}>{b}</button>
                                            ); })}
                                            <span style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.inkSoft, alignSelf: 'center' }}>home bin{packDestOptions.length > 1 ? 's' : ''} — pick ONE</span>
                                        </div>
                                    )}
                                    <input value={packDestScan} onChange={e => setPackDestScan(e.target.value)} placeholder={packDestOptions[0] ? `${packDestOptions[0]} (home bin)` : 'scan destination bin'} style={{ width: '100%', padding: '12px', fontFamily: theme.mono, fontSize: '1rem', textAlign: 'center', border: `2px solid ${packDestBin ? '#7dbb81' : theme.line}`, outline: 'none', boxSizing: 'border-box' }} />
                                    <div style={{ fontFamily: theme.mono, fontSize: '9px', textAlign: 'center', marginTop: '4px', color: packDestBin ? '#7dbb81' : '#d9534f' }}>
                                        {packDestBin ? `✓ receiving into ${packDestBin}` : '✗ this pack has no home bin — scan where it goes'}
                                    </div>
                                </div>

                                <input value={packMemo} onChange={e => setPackMemo(e.target.value)} placeholder="memo (optional)" style={{ width: '100%', padding: '10px 12px', fontFamily: theme.mono, fontSize: '11px', border: `1px solid ${theme.line}`, outline: 'none', boxSizing: 'border-box' }} />

                                {(!packTarget.netSuiteInternalId || (packComponent && !packComponent.netSuiteInternalId)) && (
                                    <div style={{ fontFamily: theme.mono, fontSize: '11px', color: '#d9534f' }}>✗ {!packTarget.netSuiteInternalId ? erpOf(packTarget) : erpOf(packComponent)} has no NetSuite Internal ID — map it first (HQ → ERP Mapping Audit).</div>
                                )}

                                {/* WHAT THE BOM ACTUALLY SOURCES — the answer to "configure the inventory detail in
                                    line 1": NetSuite can only assign a consume bin for a component that HAS stock. */}
                                {packDiag && (
                                    <div style={{ border: `1px solid ${theme.line}`, background: theme.paper, padding: '16px' }}>
                                        <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '10px' }}>What NetSuite's BOM sources for this pack</div>
                                        {packDiag.error ? (
                                            <div style={{ fontFamily: theme.mono, fontSize: '11px', color: '#d9534f' }}>{packDiag.error}</div>
                                        ) : (
                                            <>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                    {(packDiag.diag || []).filter(d => d && d.item !== undefined).map((d, i) => {
                                                        const ok = d.detailed && d.useBinId;
                                                        return (
                                                            <div key={i} style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.ink, display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'baseline' }}>
                                                                <span style={{ color: ok ? '#3f8b45' : '#d9534f', fontWeight: 700 }}>{ok ? '✓' : '✗'}</span>
                                                                <span style={{ fontWeight: 600 }}>line {(d.line ?? i) + 1}</span>
                                                                <span title={(diagNames[String(d.item)] || {}).name || ''}>{codeForNsId(d.item)}</span>
                                                                <span style={{ color: theme.inkSoft }}>needs {d.qtyUsed ?? '?'}</span>
                                                                <span style={{ color: theme.inkSoft }}>{d.srcOnhand ? `${d.srcOnhand} on hand in the bin it picked` : 'NO STOCK — nothing to consume'}</span>
                                                                {d.error ? <span style={{ color: '#d9534f' }}>{d.error}</span> : null}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                                {(() => {
                                                    // The advice must follow the ACTUAL failure — a stock message on a line
                                                    // that plainly shows 220 on hand reads as nonsense (Stuart 2026-07-28:
                                                    // "why is it saying this at the bom level? looks correct to me?").
                                                    const lines = (packDiag.diag || []).filter(d => d && d.item !== undefined);
                                                    const noStock = lines.filter(d => !d.srcOnhand);
                                                    const errored = lines.filter(d => d.error && d.srcOnhand);
                                                    const note = { fontFamily: theme.mono, fontSize: '10px', marginTop: '10px', lineHeight: 1.5 };
                                                    if (noStock.length) return (
                                                        <div style={{ ...note, color: theme.inkSoft }}>
                                                            A ✗ line with NO STOCK is the problem: NetSuite can't assign a consume bin for a component it has none of. Finish a batch of the raw into that each first.
                                                        </div>
                                                    );
                                                    if (errored.length) return (
                                                        <div style={{ ...note, color: theme.inkSoft }}>
                                                            The component and its stock look right — NetSuite rejected the inventory DETAIL itself{errored[0].detailTotal !== undefined ? ` (it assigned ${errored[0].detailTotal} against a line needing ${errored[0].qtyUsed})` : ''}. This is the NetSuite-side script, not your data: the updated ce_convert_build_restlet.js in the repo clears the detail lines NetSuite pre-creates before writing ours. Re-upload it in NetSuite (File Cabinet → SuiteScripts, replace the file) and run this again.
                                                        </div>
                                                    );
                                                    return (
                                                        <div style={{ ...note, color: '#3f8b45' }}>
                                                            ✓ Every component resolved to a bin with stock — this pack is ready to build.
                                                        </div>
                                                    );
                                                })()}
                                            </>
                                        )}
                                    </div>
                                )}

                                <button onClick={runPackDiag} disabled={!packTarget || isSyncing} style={{ padding: '12px', background: 'transparent', color: theme.inkSoft, border: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.12em', textTransform: 'uppercase', cursor: packTarget && !isSyncing ? 'pointer' : 'not-allowed' }}>
                                    {isSyncing ? 'CHECKING…' : 'CHECK BOM (no build posted)'}
                                </button>

                                <button onClick={pushRingPackBuild} disabled={!packReady || isSyncing} style={{ padding: '18px', background: packReady && !isSyncing ? theme.ink : theme.paper, color: packReady && !isSyncing ? '#fff' : theme.inkSoft, border: `1px solid ${packReady && !isSyncing ? theme.ink : theme.line}`, fontFamily: theme.mono, fontSize: '12px', letterSpacing: '.15em', textTransform: 'uppercase', cursor: packReady && !isSyncing ? 'pointer' : 'not-allowed' }}>
                                    {isSyncing ? 'POSTING…' : `BUILD ${packQtyNum || ''} PACK${packQtyNum === 1 ? '' : 'S'}`}
                                </button>
                                </>)}
                            </div>
                        )}
                    </div>
                )}

                {/* ✂ TAB: ROD CUTS (cut 8 ft rods down to 6 ft / 4 ft — scan source bin, confirm cut, scan dest bin) */}
                {activeTab === 'ROD CUTS' && rodTabMode === 'CUTS' && (() => {
                    const cuts = rodCutOrders.filter(o => (o.brand || 'ce') === activeBrand);
                    const allOpen = cuts.filter(o => o.status === 'OPEN').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
                    // TWO QUEUES, TWO PURPOSES (Stuart 2026-08-19). A cut raised by the Sales
                    // Snapshot tops up shelf stock; a cut raised BY A WORK ORDER is the first step
                    // of finishing that order — the poles do not exist until it is done, and the
                    // finishing label prints here when it is. Same tool, different reason, so they
                    // are never mixed up on the bench.
                    const finishingCuts = allOpen.filter(o => o.purpose === 'FINISHING' || o.createdVia === 'FINISHING_WO');
                    const openCuts = allOpen.filter(o => !(o.purpose === 'FINISHING' || o.createdVia === 'FINISHING_WO'));
                    const doneCuts = cuts.filter(o => o.status === 'DONE').sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)).slice(0, 10);
                    const fmtD = (t) => t ? new Date(t).toLocaleDateString() : '';
                    const stepLbl = { display: 'block', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' };
                    return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '30px', height: '100%' }}>

                            {/* ROD CUT WORK MODAL */}
                            {activeCut && (() => {
                                const o = activeCut;
                                const destPart = hqParts.find(p => erpOf(p) === String(o.targetItemId || '').toUpperCase());
                                const destHome = destPart ? binOf(destPart) : '';
                                return (
                                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.8)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <div style={{ background: '#fff', padding: '40px', width: 'min(720px, 96vw)', maxHeight: '92vh', overflowY: 'auto', border: `1px solid ${theme.line}`, boxShadow: '0 4px 24px rgba(0,0,0,0.1)' }}>
                                            <h2 style={{ margin: '0 0 6px 0', fontFamily: theme.serif, fontSize: '2rem', color: theme.ink }}>✂ Rod Cut</h2>
                                            <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, marginBottom: '24px', letterSpacing: '.1em', textTransform: 'uppercase' }}>
                                                {o.id} · Location {BRAND_NETSUITE_MAP[activeBrand]?.location} · posts a NetSuite inventory adjustment on confirm
                                            </div>

                                            {/* THE CUT */}
                                            <div style={{ border: `1px solid ${theme.line}`, padding: '16px', background: theme.paper, marginBottom: '24px' }}>
                                                <div style={{ fontFamily: theme.mono, fontSize: '13px', color: theme.ink, fontWeight: 600 }}>{o.qtySource} × {o.sourceItemId} <span style={{ color: theme.inkSoft, fontWeight: 400 }}>(8 ft)</span> → {o.qtyTarget} × {o.targetItemId} <span style={{ color: theme.inkSoft, fontWeight: 400 }}>({o.cutTo === '4FT' ? '4 ft' : '6 ft'})</span>{o.scrapFt ? <span style={{ color: theme.inkSoft, fontWeight: 400 }}> + {o.scrapFt} ft scrap</span> : null}</div>
                                                <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.brass, marginTop: '6px' }}>{cutBins.length ? `8 ft stock by bin: ${cutBins.slice().sort((a, b) => b.qty - a.qty).map(b => `${b.bin} (${b.qty})`).join('  ·  ')}` : 'No live bin data — Pull Live Stock to validate the source bin'}</div>
                                                {o.createdBy ? <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, marginTop: '4px' }}>Issued by {o.createdBy} · {fmtD(o.createdAt)}</div> : null}
                                            </div>

                                            {/* STEP 1 — SOURCE BIN */}
                                            <div style={{ marginBottom: '20px' }}>
                                                <label style={stepLbl}>1 · Scan the bin you're taking the 8 ft rods from {canClickBin && cutBins.length > 0 ? '(or pick one)' : ''}</label>
                                                {canClickBin && cutBins.length > 0 && (
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
                                                        {cutBins.map(b => { const sel = cutSrc.toUpperCase() === String(b.bin).toUpperCase(); return (
                                                            <button key={b.bin} onClick={() => setCutSrcScan(b.bin)} style={{ padding: '5px 9px', fontFamily: theme.mono, fontSize: '10px', cursor: 'pointer', border: `1px solid ${sel ? '#7dbb81' : theme.line}`, background: sel ? '#eaf5ea' : '#fff', color: theme.ink }}>{b.bin} ({b.qty})</button>
                                                        ); })}
                                                    </div>
                                                )}
                                                <input value={cutSrcScan} onChange={e => setCutSrcScan(e.target.value)} placeholder="scan source bin" style={{ width: '100%', padding: '12px', fontFamily: theme.mono, fontSize: '1rem', textAlign: 'center', border: `2px solid ${cutSrc ? (cutSrcOk ? '#7dbb81' : '#d9534f') : theme.line}`, outline: 'none', boxSizing: 'border-box' }} />
                                                <div style={{ fontFamily: theme.mono, fontSize: '9px', color: cutSrc ? (cutSrcOk ? '#7dbb81' : '#d9534f') : theme.inkSoft, marginTop: '4px', textAlign: 'center' }}>
                                                    {!cutSrc ? 'the bin the 8 ft rods come out of'
                                                        : !cutBinsKnown ? '⚠ live stock not pulled — bin accepted unverified'
                                                        : cutSrcOk ? `✓ ${cutSrcQty} × 8 ft in this bin`
                                                        : cutSrcBin ? `✗ only ${cutSrcQty} in this bin — need ${o.qtySource}` : '✗ item not in this bin'}
                                                </div>
                                            </div>

                                            {/* STEP 2 — CONFIRM THE PHYSICAL CUT */}
                                            <div style={{ marginBottom: '20px' }}>
                                                <label style={stepLbl}>2 · Make the cut</label>
                                                <button onClick={() => setCutConfirmed(v => !v)} style={{ width: '100%', padding: '15px', background: cutConfirmed ? '#eaf5ea' : '#fff', color: cutConfirmed ? '#3a7d44' : theme.ink, border: `2px solid ${cutConfirmed ? '#7dbb81' : theme.line}`, cursor: 'pointer', fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                                                    {cutConfirmed ? `✓ Cut ${o.qtySource} × 8 ft into ${o.qtyTarget} × ${o.cutTo === '4FT' ? '4 ft' : '6 ft'}` : `Tap when you've cut ${o.qtySource} × 8 ft into ${o.qtyTarget} × ${o.cutTo === '4FT' ? '4 ft' : '6 ft'}`}
                                                </button>
                                            </div>

                                            {/* STEP 3 — DEST BIN */}
                                            <div style={{ marginBottom: '20px' }}>
                                                <label style={stepLbl}>3 · Scan the bin the {o.cutTo === '4FT' ? '4 ft' : '6 ft'} rods go into</label>
                                                <input value={cutDestScan} onChange={e => setCutDestScan(e.target.value)} placeholder={destHome && destHome !== 'UNASSIGNED' ? `e.g. ${destHome} (its home bin)` : 'new or existing bin'} style={{ width: '100%', padding: '12px', fontFamily: theme.mono, fontSize: '1rem', textAlign: 'center', border: `2px solid ${cutDest ? theme.brass : theme.line}`, outline: 'none', boxSizing: 'border-box' }} />
                                                <div style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.inkSoft, marginTop: '4px', textAlign: 'center' }}>{destHome && destHome !== 'UNASSIGNED' ? `${o.targetItemId} home bin: ${destHome} · ` : ''}created in NetSuite if new · same bin as the source is fine</div>
                                            </div>

                                            {/* MEMO */}
                                            <div style={{ marginBottom: '24px' }}>
                                                <label style={stepLbl}>Memo{operator?.name ? ` — recorded as ${operator.name}` : ''}</label>
                                                <textarea value={cutMemo} onChange={e => setCutMemo(e.target.value)} placeholder="Optional note. Goes on the NetSuite adjustment memo with your name." rows={2} style={{ width: '100%', padding: '12px', fontFamily: theme.sans, fontSize: '0.9rem', color: theme.ink, border: `1px solid ${theme.line}`, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
                                            </div>

                                            <div style={{ display: 'flex', gap: '14px', justifyContent: 'flex-end', alignItems: 'center' }}>
                                                <button onClick={() => cancelRodCut(o)} style={{ marginRight: 'auto', padding: '15px 20px', background: 'transparent', color: '#d9534f', border: '1px solid #d9534f', cursor: 'pointer', fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase' }}>Cancel Order</button>
                                                <button onClick={() => { setActiveCut(null); setCutSrcScan(''); setCutDestScan(''); setCutConfirmed(false); setCutMemo(''); }} style={{ padding: '15px 30px', background: 'transparent', border: `1px solid ${theme.line}`, cursor: 'pointer', fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase' }}>Close</button>
                                                <button onClick={pushRodCut} disabled={!cutReady || isSyncing} style={{ padding: '15px 30px', background: cutReady && !isSyncing ? theme.brass : theme.paper2, color: cutReady && !isSyncing ? '#fff' : theme.inkSoft, border: 'none', cursor: cutReady && !isSyncing ? 'pointer' : 'not-allowed', fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase' }}>
                                                    {isSyncing ? 'Posting…' : 'Confirm — Adjust NetSuite'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* HEADER */}
                            <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '24px', display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap' }}>
                                <div>
                                    <div style={{ fontFamily: theme.serif, fontSize: '1.4rem', color: theme.ink }}>Rod Cut Orders</div>
                                    <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.08em', marginTop: '4px' }}>Issued from HQ stock planning · cut 8 ft rods into 6 ft / 4 ft · scan source bin → cut → scan destination bin</div>
                                </div>
                                <button onClick={pullNetSuiteStock} disabled={isSyncing} style={{ marginLeft: 'auto', padding: '12px 20px', background: isSyncing ? theme.paper : theme.ink, color: isSyncing ? theme.inkSoft : '#fff', border: 'none', cursor: isSyncing ? 'wait' : 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase' }}>
                                    {isSyncing ? 'Syncing...' : 'Pull Live Stock'}
                                </button>
                            </div>

                            {/* ISSUE — manager and up. Eric asked for it here because the person who
                                can see the rack is running short is standing at the rack. */}
                            {canIssueRodCuts && (
                                <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '16px 20px' }}>
                                    <div onClick={() => setIssueCut(c => ({ ...c, open: !c.open }))} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                                        <span style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>{issueCut.open ? '▾' : '▸'}</span>
                                        <span style={{ fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 600, color: theme.ink }}>✂ Issue a rod cut</span>
                                        <span style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft }}>any pole or rod — pick the stick and the length it becomes</span>
                                    </div>
                                    {issueCut.open && (() => {
                                        // The grammar SUGGESTS: a length read off the source code pre-fills the
                                        // cut-down code and the pieces-per-rod. All of it stays editable, because a
                                        // pattern that does not follow the house grammar is still a pole (Stuart).
                                        const srcFt = poleLengthOf(issueCut.code);
                                        const opts = cutOptionsFor(srcFt);
                                        const qn = parseInt(issueCut.qty) || 0;
                                        const per = Number(issueCut.per) || 0;
                                        const tgtRec = cutLook(issueCut.target);
                                        const fieldS = { padding: '10px 12px', border: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '0.95rem', outline: 'none' };
                                        const capS = { display: 'block', fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', color: theme.inkSoft, marginBottom: '5px' };
                                        return (
                                        <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: '14px' }}>
                                            <label style={{ display: 'block' }}>
                                                <span style={capS}>Rod being cut</span>
                                                <input list="wms-cut-rods" value={issueCut.code} onChange={e => setIssueCut(c => ({ ...c, code: e.target.value }))} placeholder="e.g. HCUMP810"
                                                    style={{ ...fieldS, width: '190px' }} />
                                                <datalist id="wms-cut-rods">
                                                    {hqParts.filter(p => isPoleCategory(p.manufacturingSpecs?.productType || p.productType))
                                                        .slice(0, 500).map(p => <option key={p.id} value={erpOf(p)}>{p.itemName || ''}</option>)}
                                                </datalist>
                                            </label>
                                            <label style={{ display: 'block' }}>
                                                <span style={capS}>How many rods</span>
                                                <input type="number" min="1" value={issueCut.qty} onChange={e => setIssueCut(c => ({ ...c, qty: e.target.value }))}
                                                    style={{ ...fieldS, width: '110px' }} />
                                            </label>
                                            <label style={{ display: 'block' }}>
                                                <span style={capS}>Becomes</span>
                                                <input list="wms-cut-rods" value={issueCut.target} onChange={e => setIssueCut(c => ({ ...c, target: e.target.value }))} placeholder="e.g. HCUMP410"
                                                    style={{ ...fieldS, width: '190px' }} />
                                            </label>
                                            <label style={{ display: 'block' }}>
                                                <span style={capS}>Per rod</span>
                                                <input type="number" min="1" value={issueCut.per} onChange={e => setIssueCut(c => ({ ...c, per: e.target.value }))}
                                                    style={{ ...fieldS, width: '80px', textAlign: 'center' }} />
                                            </label>
                                            <label style={{ display: 'block' }}>
                                                <span style={capS}>Scrap ft</span>
                                                <input type="number" min="0" value={issueCut.scrapFt} onChange={e => setIssueCut(c => ({ ...c, scrapFt: e.target.value }))}
                                                    style={{ ...fieldS, width: '80px', textAlign: 'center' }} />
                                            </label>
                                            {opts.length > 0 && (
                                                <div style={{ display: 'flex', gap: '6px', paddingBottom: '2px', flexWrap: 'wrap' }}>
                                                    {opts.map(o => o.targets.map((t, i2) => (
                                                        <button key={o.key + i2} title={`${srcFt} ft rod → ${o.label}`}
                                                            onClick={() => setIssueCut(c => ({ ...c, target: targetCodeFor(c.code, t.ft) || c.target, per: String(t.per), scrapFt: String(o.scrapFt) }))}
                                                            style={{ padding: '10px 14px', background: '#fff', color: theme.ink, border: `1px solid ${theme.line}`, cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px' }}>{t.per} × {t.ft} ft</button>
                                                    )))}
                                                </div>
                                            )}
                                            <span style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft, paddingBottom: '10px' }}>
                                                {qn > 0 && per > 0 && issueCut.target
                                                    ? `→ ${qn * per} × ${String(issueCut.target).toUpperCase()}${Number(issueCut.scrapFt) ? ` (+${qn * Number(issueCut.scrapFt)} ft scrap)` : ''}${tgtRec ? '' : ' · not in the library'}`
                                                    : (srcFt ? `reads as ${srcFt} ft — the buttons fill the rest in` : 'no length in the code — set it by hand')}
                                            </span>
                                            <button onClick={issueRodCut} style={{ padding: '11px 20px', background: theme.ink, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>✂ Issue</button>
                                        </div>
                                        );
                                    })()}
                                </div>
                            )}

                            {/* CUTS FOR FINISHING — a work order is waiting on each of these. */}
                            {finishingCuts.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                                    <div style={{ padding: '12px 18px', background: theme.ink, color: '#fff' }}>
                                        <span style={{ fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.12em', fontWeight: 600 }}>✂ Cuts for Finishing · {finishingCuts.length}</span>
                                        <span style={{ fontFamily: theme.mono, fontSize: '10px', opacity: 0.85, marginLeft: '12px' }}>a work order is waiting on each of these — completing the cut prints its finishing label</span>
                                    </div>
                                    {finishingCuts.map(o => (
                                        <div key={o.id} style={{ background: '#fff', border: `1px solid ${theme.ink}`, borderLeft: `4px solid ${theme.brass}`, padding: '20px 24px', display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
                                            <div style={{ flex: 1, minWidth: '280px' }}>
                                                <div style={{ fontFamily: theme.serif, fontSize: '1.25rem', color: theme.ink }}>
                                                    {o.qtySource} × {o.sourceItemId} → {o.qtyTarget} × {o.targetItemId}
                                                </div>
                                                <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft, marginTop: '5px' }}>
                                                    for WO {finRefOf(o.finWoId)} · {o.finWoQty} × {o.finWoErpId}{o.finWoRecipe ? ` · ${o.finWoRecipe}` : ''}{o.finWoReqDate ? ` · need by ${o.finWoReqDate}` : ''}
                                                </div>
                                                {Number(o.overrun) > 0 && (
                                                    <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.brass, marginTop: '4px' }}>
                                                        +{o.overrun} spare {o.targetItemId} to stock — the order needs {o.finWoQty}, the cut yields {o.qtyTarget}
                                                    </div>
                                                )}
                                            </div>
                                            <button onClick={() => { setActiveCut(o); setCutSrcScan(''); setCutDestScan(''); setCutConfirmed(false); setCutMemo(''); }}
                                                style={{ padding: '12px 22px', background: theme.ink, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>✂ Cut &amp; release to finishing</button>
                                            <button onClick={() => cancelRodCut(o)} style={{ padding: '12px 16px', background: 'transparent', color: '#d9534f', border: `1px solid #d9534f`, cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase' }}>Cancel</button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* CUTS FOR SALES ORDERS — shelf top-ups from the snapshot. */}
                            {(finishingCuts.length > 0 || openCuts.length > 0) && (
                                <div style={{ padding: '12px 18px', background: theme.paper2, border: `1px solid ${theme.line}` }}>
                                    <span style={{ fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.12em', fontWeight: 600, color: theme.ink }}>✂ Cuts for Sales Orders · {openCuts.length}</span>
                                    <span style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, marginLeft: '12px' }}>shelf top-ups issued from the Stocked Sales Snapshot</span>
                                </div>
                            )}
                            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                                {openCuts.length === 0 && (
                                    <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '48px', textAlign: 'center', color: theme.inkSoft, fontStyle: 'italic', fontFamily: theme.serif, fontSize: '1.1rem' }}>No open rod cut orders. They're issued from HQ → Global Inventory → Stocked Sales Snapshot (✂ on 8 ft rod rows).</div>
                                )}
                                {openCuts.map(o => (
                                    <div key={o.id} style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '20px 24px', display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
                                        <div style={{ flex: 1, minWidth: '280px' }}>
                                            <div style={{ fontFamily: theme.mono, fontSize: '14px', color: theme.ink, fontWeight: 600 }}>{o.qtySource} × {o.sourceItemId} <span style={{ color: theme.inkSoft, fontWeight: 400 }}>(8 ft)</span> → {o.qtyTarget} × {o.targetItemId} <span style={{ color: theme.inkSoft, fontWeight: 400 }}>({o.cutTo === '4FT' ? '4 ft' : '6 ft'})</span></div>
                                            <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, marginTop: '6px' }}>{o.id} · issued {fmtD(o.createdAt)}{o.createdBy ? ` by ${o.createdBy}` : ''}{o.scrapFt ? ` · ${o.scrapFt} ft scrap expected` : ''}</div>
                                        </div>
                                        <button onClick={() => cancelRodCut(o)} style={{ padding: '10px 14px', background: 'transparent', color: theme.inkSoft, border: `1px solid ${theme.line}`, cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase' }}>Cancel</button>
                                        <button onClick={() => { const bins = (nsStock[String(o.sourceItemId || '').toUpperCase()]?.bins || []).filter(b => b.bin).sort((a, b) => b.qty - a.qty); setActiveCut(o); setCutSrcScan(bins[0]?.bin || ''); setCutDestScan(''); setCutConfirmed(false); setCutMemo(''); }} style={{ padding: '12px 22px', background: theme.brass, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Start Cut →</button>
                                    </div>
                                ))}

                                {/* RECENTLY COMPLETED */}
                                {doneCuts.length > 0 && (
                                    <div style={{ marginTop: '10px' }}>
                                        <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Recently completed</div>
                                        {doneCuts.map(o => (
                                            <div key={o.id} style={{ background: theme.paper, border: `1px solid ${theme.line}`, padding: '10px 16px', marginBottom: '6px', fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>
                                                ✓ {o.qtySource} × {o.sourceItemId} ({o.sourceBin}) → {o.qtyTarget} × {o.targetItemId} ({o.destBin}) · {fmtD(o.completedAt)}{o.completedBy ? ` by ${o.completedBy}` : ''}{o.nsAdjustmentId ? ` · NS adj #${o.nsAdjustmentId}` : ''}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })()}

                {activeTab === 'TRANSFER' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '30px', height: '100%' }}>

                        {/* TRANSFER MODAL */}
                        {transferBase && (
                            <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.8)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <div style={{ background: '#fff', padding: '40px', width: 'min(680px, 96vw)', maxHeight: '90vh', overflowY: 'auto', border: `1px solid ${theme.line}`, boxShadow: '0 4px 24px rgba(0,0,0,0.1)' }}>
                                    <h2 style={{ margin: '0 0 6px 0', fontFamily: theme.serif, fontSize: '2rem', color: theme.ink }}>Bin Transfer</h2>
                                    <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, marginBottom: '24px', letterSpacing: '.1em', textTransform: 'uppercase' }}>
                                        Moves stock between bins · Location {BRAND_NETSUITE_MAP[activeBrand]?.location} · total on hand unchanged
                                    </div>

                                    {/* ITEM */}
                                    <div style={{ border: `1px solid ${theme.line}`, padding: '16px', background: theme.paper, marginBottom: '24px' }}>
                                        <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>{transferBase.erpId}</div>
                                        <div style={{ fontFamily: theme.sans, fontSize: '1rem', color: theme.ink, fontWeight: 500 }}>{transferBase.itemName}</div>
                                        <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.brass, marginTop: '6px' }}>{xferBins.length ? `Stock by bin: ${xferBins.slice().sort((a, b) => b.qty - a.qty).map(b => `${b.bin} (${b.qty})`).join('  ·  ')}` : `${transferBase.onHand} on hand (location)`}</div>
                                    </div>

                                    {/* FROM / QTY / TO */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                                        <div>
                                            <label style={{ display: 'block', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Source bin {canClickBin ? '(pick one)' : '(scan)'}</label>
                                            {canClickBin && xferBins.length > 0 && (
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
                                                    {xferBins.map(b => { const sel = (transferSrcScan || '').trim().toUpperCase() === String(b.bin).toUpperCase(); return (
                                                        <button key={b.bin} onClick={() => setTransferSrcScan(b.bin)} style={{ padding: '5px 9px', fontFamily: theme.mono, fontSize: '10px', cursor: 'pointer', border: `1px solid ${sel ? '#7dbb81' : theme.line}`, background: sel ? '#eaf5ea' : '#fff', color: theme.ink }}>{b.bin} ({b.qty})</button>
                                                    ); })}
                                                </div>
                                            )}
                                            <input value={transferSrcScan} onChange={e => setTransferSrcScan(e.target.value)} placeholder={xferBins.slice().sort((a, b) => b.qty - a.qty)[0]?.bin || binOf(transferBase)} style={{ width: '100%', padding: '12px', fontFamily: theme.mono, fontSize: '1rem', textAlign: 'center', border: `2px solid ${xferSrcKnown ? '#7dbb81' : (xferFrom ? '#d9534f' : theme.line)}`, outline: 'none', boxSizing: 'border-box' }} />
                                            <div style={{ fontFamily: theme.mono, fontSize: '9px', color: xferSrcKnown ? '#7dbb81' : (xferFrom ? '#d9534f' : theme.inkSoft), marginTop: '4px', textAlign: 'center' }}>{xferSrcKnown ? `✓ ${xferSrcQty} in bin` : (xferFrom ? '⚠ item not in this bin' : 'pick a bin with stock')}</div>
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Quantity</label>
                                            <input type="number" min="1" max={xferSrcQty || undefined} value={transferQty} onChange={e => setTransferQty(e.target.value)} placeholder="0" style={{ width: '100%', padding: '12px', fontFamily: theme.mono, fontSize: '1.2rem', textAlign: 'center', border: `2px solid ${xferQtyNum > 0 && xferQtyNum <= xferSrcQty ? theme.brass : theme.line}`, outline: 'none', boxSizing: 'border-box' }} />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Scan / enter dest bin</label>
                                            <input value={transferDestScan} onChange={e => setTransferDestScan(e.target.value)} placeholder="new or existing bin" style={{ width: '100%', padding: '12px', fontFamily: theme.mono, fontSize: '1rem', textAlign: 'center', border: `2px solid ${xferTo !== '' && xferTo.toUpperCase() !== xferFrom.toUpperCase() ? theme.brass : theme.line}`, outline: 'none', boxSizing: 'border-box' }} />
                                            <div style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.inkSoft, marginTop: '4px', textAlign: 'center' }}>created if new</div>
                                        </div>
                                    </div>

                                    {/* MEMO */}
                                    <div style={{ marginBottom: '24px' }}>
                                        <label style={{ display: 'block', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Transfer memo{operator?.name ? ` — recorded as ${operator.name}` : ''}</label>
                                        <textarea value={transferMemo} onChange={e => setTransferMemo(e.target.value)} placeholder="Optional note. Pushed to the NetSuite transfer memo with your name." rows={2} style={{ width: '100%', padding: '12px', fontFamily: theme.sans, fontSize: '0.9rem', color: theme.ink, border: `1px solid ${theme.line}`, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
                                    </div>

                                    <div style={{ display: 'flex', gap: '20px', justifyContent: 'flex-end' }}>
                                        <button onClick={() => { setTransferBase(null); setTransferSrcScan(""); setTransferQty(""); setTransferDestScan(""); setTransferMemo(""); }} style={{ padding: '15px 30px', background: 'transparent', border: `1px solid ${theme.line}`, cursor: 'pointer', fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase' }}>Cancel</button>
                                        <button onClick={pushBinTransfer} disabled={!xferReady || isSyncing} style={{ padding: '15px 30px', background: xferReady && !isSyncing ? theme.brass : theme.paper2, color: xferReady && !isSyncing ? '#fff' : theme.inkSoft, border: 'none', cursor: xferReady && !isSyncing ? 'pointer' : 'not-allowed', fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase' }}>
                                            {isSyncing ? 'Posting transfer…' : 'Post Bin Transfer'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* HEADER FILTERS */}
                        <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '24px', display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ padding: '12px', border: `1px solid ${theme.line}`, fontFamily: theme.sans, outline: 'none', background: theme.paper2, minWidth: '150px' }}>
                                <option value="">All Categories</option>
                                {dynamicProdTypes.map(pt => <option key={pt} value={pt}>{pt}</option>)}
                            </select>
                            <select value={collectionFilter} onChange={(e) => setCollectionFilter(e.target.value)} style={{ padding: '12px', border: `1px solid ${theme.line}`, fontFamily: theme.sans, outline: 'none', background: theme.paper2, minWidth: '150px' }}>
                                <option value="">All Collections</option>
                                {dynamicCollections.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <select value={watchlistFilter} onChange={(e) => setWatchlistFilter(e.target.value)} style={{ padding: '12px', border: `1px solid ${theme.line}`, fontFamily: theme.sans, outline: 'none', background: theme.paper2, minWidth: '150px' }}>
                                <option value="">All Watchlists</option>
                                {dynamicWatchlists.map(w => <option key={w} value={w}>{w}</option>)}
                            </select>
                            <input placeholder="Search an item to move…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} style={{ padding: '12px', border: `1px solid ${theme.line}`, fontFamily: theme.sans, outline: 'none', flex: 1, minWidth: '180px' }} />
                            {(typeFilter || collectionFilter || watchlistFilter || searchQuery) && <button onClick={() => { setTypeFilter(''); setCollectionFilter(''); setWatchlistFilter(''); setSearchQuery(''); }} style={{ padding: '12px 14px', background: 'transparent', color: theme.inkSoft, border: `1px solid ${theme.line}`, cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase' }}>Clear</button>}
                            <button onClick={pullNetSuiteStock} disabled={isSyncing} style={{ padding: '12px 20px', background: isSyncing ? theme.paper : theme.ink, color: isSyncing ? theme.inkSoft : '#fff', border: 'none', cursor: isSyncing ? 'wait' : 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase' }}>
                                {isSyncing ? 'Syncing...' : 'Pull Live Stock'}
                            </button>
                        </div>

                        {/* INVENTORY TABLE */}
                        <div style={{ flex: 1, background: '#fff', border: `1px solid ${theme.line}`, overflowY: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                <thead style={{ background: theme.paper2, position: 'sticky', top: 0, zIndex: 10 }}>
                                    <tr>
                                        <th style={{ padding: '16px', borderBottom: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase' }}>ERP ID / Item</th>
                                        <th style={{ padding: '16px', borderBottom: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', textAlign: 'center' }}>Home Bin</th>
                                        <th style={{ padding: '16px', borderBottom: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', textAlign: 'center' }}>On Hand</th>
                                        <th style={{ padding: '16px', borderBottom: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', textAlign: 'center' }}>Move</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {baseFilteredItems.map(item => (
                                        <tr key={item.id} style={{ borderBottom: `1px solid ${theme.line}` }}>
                                            <td style={{ padding: '16px' }}>
                                                <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>{item.erpId}</div>
                                                <div style={{ fontFamily: theme.sans, fontSize: '1rem', color: theme.ink, fontWeight: 500 }}>{item.itemName}</div>
                                            </td>
                                            <td style={{ padding: '16px', textAlign: 'center', fontFamily: theme.mono, fontSize: '12px', color: theme.brass }}>{item.binLocation}</td>
                                            <td style={{ padding: '16px', textAlign: 'center', fontFamily: theme.mono, fontSize: '1.2rem', color: theme.inkSoft }}>{item.onHand}</td>
                                            <td style={{ padding: '16px', textAlign: 'center' }}>
                                                <button onClick={() => { const top = (nsStock[item.erpId]?.bins || []).filter(b => b.bin).slice().sort((a, b) => b.qty - a.qty)[0]; setTransferBase(item); setTransferSrcScan(top ? top.bin : ""); setTransferQty(""); setTransferDestScan(""); setTransferMemo(""); }} style={{ padding: '10px 18px', background: theme.ink, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Transfer →</button>
                                            </td>
                                        </tr>
                                    ))}
                                    {baseFilteredItems.length === 0 && (
                                        <tr>
                                            <td colSpan="4" style={{ padding: '40px', textAlign: 'center', color: theme.inkSoft, fontStyle: 'italic', fontFamily: theme.serif }}>No inventory items matched your filter.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* ⚗ TAB: PLATING (pull raw stock to plating WIP via inventory status change) */}
                {activeTab === 'RECEIVING' && (() => {
                    const po = rcvPo;
                    const lines = (po && po.items) || [];
                    const owed = lines.map((l, i) => ({ l, i })).filter(x => openQtyOf(x.l) > 0);
                    const inCart = new Set(rcvCart.map(c => c.index));
                    const pcs = rcvCart.reduce((a, c) => a + (Number(c.qty) || 0), 0);
                    const inp = { padding: '9px 10px', border: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '12px', background: '#fff', color: theme.ink };
                    const btn = (bg, fg) => ({ padding: '9px 14px', background: bg, color: fg, border: 'none', cursor: rcvBusy ? 'wait' : 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' });
                    const rowBox = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', borderTop: `1px solid ${theme.line}`, padding: '10px 0', flexWrap: 'wrap' };
                    return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                            <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '20px' }}>
                                <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '12px' }}>{t('Receiving — the vendor dock')}</div>
                                <form onSubmit={(e) => { e.preventDefault(); rcvLoadPo(); }} style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                    <input autoFocus value={rcvPoInput} onChange={(e) => setRcvPoInput(e.target.value)} placeholder={t('Purchase order # — e.g. PO2296')} style={{ ...inp, flex: '1 1 220px', textTransform: 'uppercase' }} />
                                    <button type="submit" disabled={rcvBusy} style={btn(theme.ink, '#fff')}>{rcvBusy ? t('Looking…') : t('Open PO')}</button>
                                    {po && <button type="button" onClick={() => { setRcvPo(null); setRcvPoInput(''); setRcvScan(''); setRcvFocusIdx(null); setRcvBin(''); }} style={{ ...btn('transparent', theme.ink), border: `1px solid ${theme.line}` }}>{t('Close')}</button>}
                                </form>
                                <div style={{ fontSize: '0.8rem', color: theme.inkSoft, marginTop: '8px' }}>
                                    {t('Raised here or straight in NetSuite — either works. A PO the app has never seen is read from NetSuite and recorded, so the receipt has a home and the PO shows in RTG.')}
                                </div>
                            </div>

                            {po && (
                                <div style={{ background: '#fff', border: `1px solid #7d9a6f`, padding: '20px' }}>
                                    <div style={{ fontFamily: theme.mono, fontSize: '12px', color: theme.ink, marginBottom: '4px' }}>
                                        {poRef(po)} · {po.vendor || t('vendor not named')} {po.importedFromNetSuite ? `· ${t('from NetSuite')}` : ''}
                                    </div>
                                    <div style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '14px' }}>
                                        {lines.length} {t('line(s)')} · {owed.length} {t('still outstanding')} · {String(po.status || '')}
                                    </div>

                                    {/* SCAN TO FIND — the label, not a scroll through the whole order. */}
                                    <form onSubmit={(e) => { e.preventDefault();
                                        const hit = rcvFindIdx(rcvScan, po);
                                        if (hit < 0) return alert(`Nothing outstanding on ${poRef(po)} matches "${rcvScan}".\n\nScan the item code exactly as it prints on the label. A line already fully received will not match.`);
                                        setRcvFocusIdx(hit);
                                    }} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
                                        <input value={rcvScan} onChange={(e) => setRcvScan(e.target.value)} placeholder={t('Scan or type the item code')} style={{ ...inp, flex: '1 1 240px', textTransform: 'uppercase' }} />
                                        <button type="submit" style={btn(theme.ink, '#fff')}>{t('Find')}</button>
                                        {(rcvScan || rcvFocusIdx != null) && <button type="button" onClick={() => { setRcvScan(''); setRcvFocusIdx(null); }} style={{ ...btn('transparent', theme.ink), border: `1px solid ${theme.line}` }}>{t('Clear')}</button>}
                                    </form>

                                    {/* 1 — OFF THE PALLET, ONTO THE CART. Nothing posts here. */}
                                    <div style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '4px' }}>{t('1 · Onto the cart')}</div>
                                    {owed.length === 0 && <div style={{ color: theme.inkSoft, fontStyle: 'italic', fontSize: '0.9rem', padding: '8px 0' }}>{t('Every line on this PO has been received.')}</div>}
                                    {owed.filter(x => !inCart.has(x.i)).map(({ l, i }) => {
                                        const dim = rcvFocusIdx != null && rcvFocusIdx !== i;
                                        const hit = rcvFocusIdx === i;
                                        const room = openQtyOf(l);
                                        const copies = Math.max(1, Math.min(50, parseInt(rcvQty[i] || room, 10) || 1));
                                        return (
                                            <div key={i} style={{ ...rowBox, opacity: dim ? 0.28 : 1, background: hit ? '#fdf6e3' : 'transparent' }}>
                                                <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.ink }}>
                                                    {l.itemId} · {t('ordered')} {l.quantity} · {t('received')} {Number(l.received) || 0} · <span style={{ color: theme.brass }}>{room} {t('outstanding')}</span>
                                                    {l.soRef && <span style={{ color: theme.brass }}> · SO {l.soRef}</span>}
                                                </div>
                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                    <input type="number" min="0" max={room} value={rcvQty[i] != null ? rcvQty[i] : ''} onChange={(e) => setRcvQty(q => ({ ...q, [i]: e.target.value }))} placeholder={String(room)} style={{ ...inp, width: '78px' }} />
                                                    <button title={`Print ${copies} label(s) for ${l.itemId}`} onClick={() => printStockItemLabels({ itemId: l.itemId, itemName: l.description || '', uom: 'EA', woNum: poRef(po), copies })}
                                                        style={{ ...btn('transparent', theme.ink), border: `1px solid ${theme.line}` }}>🏷 {t('Labels')}</button>
                                                    <button disabled={rcvBusy} onClick={() => rcvAddToCart(i)} style={btn('#7d9a6f', '#fff')}>{t('Receive')}</button>
                                                </div>
                                            </div>
                                        );
                                    })}

                                    {/* 2 — THE CART, AND THE BIN THAT CLOSES IT. */}
                                    {rcvCart.length > 0 && (
                                        <div style={{ marginTop: '18px', border: `1px solid ${theme.brass}`, padding: '14px' }}>
                                            <div style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.brass, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>{t('2 · On the cart')} — {rcvCart.length} {t('line(s)')} / {pcs} {t('pcs')}</div>
                                            {rcvCart.map(c => (
                                                <div key={c.index} style={rowBox}>
                                                    <span style={{ fontFamily: theme.mono, fontSize: '11px' }}>{c.qty} × {c.itemId}</span>
                                                    <button onClick={() => rcvRemoveFromCart(c.index)} style={{ ...btn('transparent', theme.inkSoft), border: `1px solid ${theme.line}` }}>{t('Take off')}</button>
                                                </div>
                                            ))}
                                            <form onSubmit={(e) => { e.preventDefault(); rcvPutAway(); }} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '14px', flexWrap: 'wrap' }}>
                                                <input value={rcvBin} onChange={(e) => setRcvBin(e.target.value)} placeholder={t('Scan the home bin')} style={{ ...inp, flex: '1 1 180px', textTransform: 'uppercase' }} />
                                                <button type="submit" disabled={rcvBusy} style={btn(theme.ink, '#fff')}>{rcvBusy ? t('Posting…') : t('Put away')}</button>
                                            </form>
                                            <div style={{ fontSize: '0.78rem', color: theme.inkSoft, marginTop: '8px' }}>
                                                {t('Put-away records the receipt, queues the NetSuite item receipt, and then offers these pieces to any order that has been waiting for them.')}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })()}

                {activeTab === 'PLATING' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '30px', height: '100%' }}>

                        {/* 📥 OB PLATING — custom outgoing staging: /MEP //EP //P25 pieces arrive here as the
                            shop completes them; scan-in stages the piece (bin OB PLATING) so the weekly
                            📦 Ship button below bundles customs + stock pulls into ONE plater PO. */}
                        {!platingBase && (() => {
                            const obDemands = platingDemands.filter(d => d.custom);
                            const obStaged = (platingStaged || []).filter(l => l.platingBin === 'OB PLATING');
                            if (!obDemands.length && !obStaged.length) return null;
                            const obPcs = obStaged.reduce((s, l) => s + (parseInt(l.qty) || 0), 0);
                            return (
                                <div style={{ background: '#fff', border: `1px solid ${theme.brass}`, padding: '20px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
                                        <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.brass, textTransform: 'uppercase', letterSpacing: '.1em' }}>📥 OB Plating — custom outgoing · {obDemands.length} awaiting scan-in · {obStaged.length} line{obStaged.length === 1 ? '' : 's'} in bin ({obPcs} pcs)</div>
                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                            <input value={obScan} onChange={e => setObScan(e.target.value)} onKeyDown={e => e.key === 'Enter' && obScanSubmit()} placeholder="Scan shop WO label…" style={{ padding: '9px 12px', border: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '0.85rem', outline: 'none', width: '200px' }} />
                                            <button onClick={obScanSubmit} style={{ padding: '9px 14px', background: theme.brass, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' }}>📥 Scan In</button>
                                        </div>
                                    </div>
                                    {obDemands.map(d => (
                                        <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', borderBottom: `1px solid ${theme.line}`, padding: '6px 0' }}>
                                            <div style={{ fontFamily: theme.mono, fontSize: '12px', color: theme.ink }}>
                                                {d.woNum ? `${d.woNum} · ` : ''}{d.baseErpId} → <span style={{ color: theme.brass }}>{d.targetErpId}</span> · {d.qty} pcs · finish {d.finishCode}{d.note ? <span style={{ color: theme.inkSoft }}> · {d.note}</span> : null}
                                            </div>
                                            <button onClick={() => stageObDemand(d)} style={{ padding: '8px 14px', background: 'transparent', border: `1px solid ${theme.brass}`, color: theme.brass, cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', whiteSpace: 'nowrap' }}>📥 Into OB Plating</button>
                                        </div>
                                    ))}
                                    {obStaged.length > 0 && (
                                        <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, marginTop: '10px' }}>
                                            In the bin, riding the next weekly shipment: {obStaged.map(l => `${l.woNum || l.erpId} ×${l.qty}`).join(' · ')} — ship with the weekly 📦 button below (one PO covers customs + stock pulls).
                                        </div>
                                    )}
                                </div>
                            );
                        })()}

                        {/* NEEDS PLATING — to-dos routed from the Library WO tool (base in stock → plate it) */}
                        {!platingBase && platingDemands.filter(d => !d.custom).length > 0 && (
                            <div style={{ background: '#fff', border: `1px solid #7d9a6f`, padding: '20px' }}>
                                <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '12px' }}>Needs Plating · {platingDemands.filter(d => !d.custom).length} item{platingDemands.filter(d => !d.custom).length === 1 ? '' : 's'} routed from HQ</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {platingDemands.filter(d => !d.custom).map(d => (
                                        <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', borderBottom: `1px solid ${theme.line}`, paddingBottom: '8px' }}>
                                            <div style={{ fontFamily: theme.mono, fontSize: '12px', color: theme.ink }}>
                                                {d.baseErpId} → <span style={{ color: theme.brass }}>{d.targetErpId}</span> · {d.qty} pcs · finish {d.finishCode}{d.woNum ? ` · WO ${d.woNum}` : ''}{d.createdBy ? ` · ${d.createdBy}` : ''}
                                            </div>
                                            <button onClick={() => {
                                                const basePart = baseFilteredItems.find(p => p.id === d.baseItemId) || baseFilteredItems.find(p => p.erpId === (d.baseErpId || '').toUpperCase());
                                                if (!basePart) { alert(`${d.baseErpId} isn't in this brand's list yet — Sync NetSuite Stock first, then try again.`); return; }
                                                const fin = outsourceFinishes.find(f => finishCodeOf(f) === (d.finishCode || '').toUpperCase());
                                                setPlatingBase(basePart); setPlatingQty(String(d.qty || '')); setPlatingFinish(fin ? fin.id : '');
                                                setPlatingSrcScan(''); setPlatingDestScan(''); setPlatingMemo(''); setPlatingWO(d.woNum || ''); setPlatingDemandId(d.id);
                                                setPlatingDemandLink({
                                                    soAppId: d.soAppId || d.salesOrderId || null, soRef: d.soRef || d.soId || null,
                                                    orderKey: d.orderKey || null, finSiblingId: d.finSiblingId || null,
                                                    shopOrderId: d.shopOrderId || null, custom: !!d.custom,
                                                    customerName: d.customerName || '', demandWoNum: d.woNum || '',
                                                });
                                            }} disabled={isSyncing} style={{ padding: '10px 16px', background: '#5e7d54', color: '#fff', border: 'none', cursor: isSyncing ? 'wait' : 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' }}>Pull &amp; Plate →</button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* PULL MODAL */}
                        {platingBase && (
                            <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.8)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <div style={{ background: '#fff', padding: '40px', width: 'min(680px, 96vw)', maxHeight: '90vh', overflowY: 'auto', border: `1px solid ${theme.line}`, boxShadow: '0 4px 24px rgba(0,0,0,0.1)' }}>
                                    <h2 style={{ margin: '0 0 6px 0', fontFamily: theme.serif, fontSize: '2rem', color: theme.ink }}>Pull to Plating WIP</h2>
                                    <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, marginBottom: '24px', letterSpacing: '.1em', textTransform: 'uppercase' }}>
                                        Status change Good → WIP-Plating · Subsidiary {BRAND_NETSUITE_MAP[activeBrand]?.subsidiary} | Location {BRAND_NETSUITE_MAP[activeBrand]?.location} · drops from Available
                                    </div>

                                    <div style={{ border: `1px solid ${theme.line}`, padding: '16px', background: theme.paper, marginBottom: '24px' }}>
                                        <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>{platingBase.erpId}</div>
                                        <div style={{ fontFamily: theme.sans, fontSize: '1rem', color: theme.ink, fontWeight: 500 }}>{platingBase.itemName}</div>
                                        <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.brass, marginTop: '6px' }}>home bin {binOf(platingBase)} · {platAvail} available{platBaseWip > 0 ? ` (${platingBase.onHand} on hand · ${platBaseWip} in plating WIP)` : ` · ${platingBase.onHand} on hand`}</div>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                                        <div>
                                            <label style={{ display: 'block', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Source bin {canClickBin ? '(pick one)' : '(scan)'}</label>
                                            {canClickBin && platBins.length > 0 && (
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
                                                    {platBins.map(b => { const sel = platFrom.toUpperCase() === String(b.bin).toUpperCase(); return (
                                                        <button key={b.bin} onClick={() => setPlatingSrcScan(b.bin)} style={{ padding: '5px 9px', fontFamily: theme.mono, fontSize: '10px', cursor: 'pointer', border: `1px solid ${sel ? '#7dbb81' : theme.line}`, background: sel ? '#eaf5ea' : '#fff', color: theme.ink }}>{b.bin} ({b.qty})</button>
                                                    ); })}
                                                </div>
                                            )}
                                            <input value={platingSrcScan} onChange={e => setPlatingSrcScan(e.target.value)} placeholder={platBins.slice().sort((a, b) => b.qty - a.qty)[0]?.bin || binOf(platingBase)} style={{ width: '100%', padding: '12px', fontFamily: theme.mono, fontSize: '1rem', textAlign: 'center', border: `2px solid ${platSrcKnown ? '#7dbb81' : (platFrom ? '#d9534f' : theme.line)}`, outline: 'none', boxSizing: 'border-box' }} />
                                            <div style={{ fontFamily: theme.mono, fontSize: '9px', color: platSrcKnown ? '#7dbb81' : (platFrom ? '#d9534f' : theme.inkSoft), marginTop: '4px', textAlign: 'center' }}>{platSrcKnown ? `✓ ${platSrcBin.qty} in bin` : (platFrom ? '⚠ item not in this bin' : (platBins.length ? 'pick a bin with stock' : `home: ${binOf(platingBase)}`))}</div>
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Quantity</label>
                                            <input type="number" min="1" max={platAvail} value={platingQty} onChange={e => setPlatingQty(e.target.value)} placeholder="0" style={{ width: '100%', padding: '12px', fontFamily: theme.mono, fontSize: '1.2rem', textAlign: 'center', border: `2px solid ${platQtyNum > 0 && platQtyNum <= platAvail ? theme.brass : theme.line}`, outline: 'none', boxSizing: 'border-box' }} />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Scan / enter plating bin</label>
                                            <input value={platingDestScan} onChange={e => setPlatingDestScan(e.target.value)} placeholder="PLATING" style={{ width: '100%', padding: '12px', fontFamily: theme.mono, fontSize: '1rem', textAlign: 'center', border: `2px solid ${platTo !== '' && platTo.toUpperCase() !== platFrom.toUpperCase() ? theme.brass : theme.line}`, outline: 'none', boxSizing: 'border-box' }} />
                                            <div style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.inkSoft, marginTop: '4px', textAlign: 'center' }}>created if new</div>
                                        </div>
                                    </div>

                                    <div style={{ marginBottom: '24px' }}>
                                        <label style={{ display: 'block', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Work Order # — scan the RTG label</label>
                                        <input value={platingWO} onChange={e => setPlatingWO(e.target.value)} placeholder="WO # from HQ / RTG — printed on the plating label" style={{ width: '100%', padding: '12px', fontFamily: theme.mono, fontSize: '1rem', color: theme.ink, border: `1px solid ${theme.line}`, outline: 'none', boxSizing: 'border-box' }} />
                                    </div>

                                    <div style={{ marginBottom: '24px' }}>
                                        <label style={{ display: 'block', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Plating finish — what the plater applies</label>
                                        <select value={platingFinish} onChange={e => setPlatingFinish(e.target.value)} style={{ width: '100%', padding: '12px', fontFamily: theme.mono, fontSize: '1rem', textAlign: 'center', border: `2px solid ${platingFinish ? theme.brass : theme.line}`, outline: 'none', boxSizing: 'border-box', background: '#fff' }}>
                                            <option value="">Select finish…</option>
                                            {platingFinishOptions.map(f => <option key={f.id} value={f.id}>{finishCodeOf(f)}{f.name && f.name.toUpperCase() !== finishCodeOf(f) ? ` — ${f.name}` : ''}{f.vendor ? ` · ${f.vendor}` : ''}</option>)}
                                        </select>
                                        <div style={{ fontFamily: theme.mono, fontSize: '10px', color: platingFinish ? theme.brass : theme.inkSoft, marginTop: '6px', textAlign: 'center' }}>
                                            {platingFinish ? `↳ builds back as ${platingBase.erpId}/${finishCodeOf(outsourceFinishes.find(f => f.id === platingFinish))}` : 'Required — sets the finished assembly & tells the plater what finish to do'}
                                        </div>
                                    </div>

                                    <div style={{ marginBottom: '24px' }}>
                                        <label style={{ display: 'block', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Note{operator?.name ? ` — recorded as ${operator.name}` : ''}</label>
                                        <textarea value={platingMemo} onChange={e => setPlatingMemo(e.target.value)} placeholder="Optional note. Pushed to the NetSuite status-change memo with your name." rows={2} style={{ width: '100%', padding: '12px', fontFamily: theme.sans, fontSize: '0.9rem', color: theme.ink, border: `1px solid ${theme.line}`, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
                                    </div>

                                    <div style={{ display: 'flex', gap: '20px', justifyContent: 'flex-end' }}>
                                        <button onClick={() => { setPlatingBase(null); setPlatingSrcScan(""); setPlatingQty(""); setPlatingDestScan(""); setPlatingMemo(""); setPlatingDemandId(null); }} style={{ padding: '15px 30px', background: 'transparent', border: `1px solid ${theme.line}`, cursor: 'pointer', fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase' }}>Cancel</button>
                                        <button onClick={pushPlatingPull} disabled={!platReady || isSyncing} style={{ padding: '15px 30px', background: platReady && !isSyncing ? theme.brass : theme.paper2, color: platReady && !isSyncing ? '#fff' : theme.inkSoft, border: 'none', cursor: platReady && !isSyncing ? 'pointer' : 'not-allowed', fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase' }}>
                                            {isSyncing ? 'Pulling…' : 'Pull to Plating WIP'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* STAGED-FOR-PLATING SUMMARY */}
                        {platingStaged.length > 0 && (
                            <div style={{ background: '#fff', border: `1px solid ${theme.brass}`, padding: '20px' }}>
                                <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '12px' }}>Staged for this week's plating shipment — {platingStaged.length} line{platingStaged.length === 1 ? '' : 's'} ({platingStaged.reduce((s, l) => s + (parseInt(l.qty) || 0), 0)} pcs)</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto' }}>
                                    {platingStaged.map(l => (
                                        <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', fontFamily: theme.mono, fontSize: '12px', color: theme.ink, borderBottom: `1px solid ${theme.line}`, paddingBottom: '4px' }}>
                                            <span>{l.erpId}{l.targetErpId ? ` → ${l.targetErpId}` : (l.finishCode ? `/${l.finishCode}` : ' · ⚠ no finish')} — {l.itemName}{l.woNum ? ` · WO ${l.woNum}` : ''}</span>
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '10px', whiteSpace: 'nowrap' }}>
                                                <span style={{ color: theme.brass }}>{l.qty} → {l.platingBin}</span>
                                                <button onClick={() => printPlatingLabel({ erpId: l.erpId, itemName: l.itemName, qty: l.qty, woNum: l.woNum, platingBin: l.platingBin, finishCode: l.finishCode, finishName: l.finishName, targetErpId: l.targetErpId })} title="Reprint this plating label" style={{ background: 'transparent', border: `1px solid ${theme.line}`, color: theme.inkSoft, cursor: 'pointer', fontFamily: theme.mono, fontSize: '11px', lineHeight: 1, padding: '3px 7px' }}>🖨</button>
                                                <button onClick={() => cancelPlatingPull(l)} disabled={isSyncing} title="Cancel this pull — return to Good and remove the staged line" style={{ background: 'transparent', border: `1px solid ${theme.line}`, color: theme.inkSoft, cursor: isSyncing ? 'wait' : 'pointer', fontFamily: theme.mono, fontSize: '11px', lineHeight: 1, padding: '3px 7px' }}>✕</button>
                                            </span>
                                        </div>
                                    ))}
                                </div>
                                <button onClick={() => setShowShipModal(true)} style={{ marginTop: '14px', padding: '12px 20px', background: theme.ink, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Ship Pallet → Create Plater PO</button>
                            </div>
                        )}

                        {/* RETURNED FROM PLATER — RECEIVE (Phase 4a) */}
                        {platingShipped.length > 0 && (() => {
                            const groups = Object.values(platingShipped.reduce((a, l) => { (a[l.shipmentId] = a[l.shipmentId] || { shipmentId: l.shipmentId, nsPoId: l.nsPoId, nsPoTran: l.nsPoTran, lines: [] }).lines.push(l); return a; }, {}));
                            return (
                                <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '20px' }}>
                                    <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '12px' }}>Out at plater — {groups.length} shipment{groups.length === 1 ? '' : 's'} awaiting receive · click a row to expand</div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                        {groups.map(g => {
                                            const open = !!expandedShip[g.shipmentId];
                                            const poUrl = g.nsPoId ? `https://3728153.app.netsuite.com/app/accounting/transactions/purchord.nl?id=${g.nsPoId}&whence=` : null;
                                            const poText = g.nsPoTran || g.nsPoId || '—';
                                            return (
                                            <div key={g.shipmentId} style={{ border: `1px solid ${theme.line}` }}>
                                                <div onClick={() => setExpandedShip(p => ({ ...p, [g.shipmentId]: !p[g.shipmentId] }))} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '12px 14px', cursor: 'pointer', background: open ? theme.paper2 : '#fff' }}>
                                                    <div style={{ fontFamily: theme.mono, fontSize: '12px', color: theme.ink, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <span style={{ color: theme.inkSoft }}>{open ? '▾' : '▸'}</span>
                                                        <span>{g.shipmentId} · {g.lines.length} line{g.lines.length === 1 ? '' : 's'} · {g.lines.reduce((s, l) => s + (parseInt(l.qty) || 0), 0)} pcs · NS PO {poUrl ? <a href={poUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: theme.brass, textDecoration: 'underline' }}>{poText}</a> : poText}</span>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '8px' }} onClick={e => e.stopPropagation()}>
                                                        <button onClick={() => printPlatingPackingList(shipmentPrintData(g))} title="Print the plating PO / packing list (item · finish · returns-as · qty)" style={{ padding: '10px 12px', background: 'transparent', color: theme.ink, border: `1px solid ${theme.line}`, cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' }}>🖨 Print</button>
                                                        <button onClick={async () => { try { const fn = await downloadPlatingOrderPdf(shipmentPrintData(g)); if (fn) alert(`⬇ ${fn} downloaded — attach it to your email to the plater.`); } catch (e) { alert('PDF failed: ' + (e.message || e)); } }} title="Save the plating PO as a PDF to email the vendor" style={{ padding: '10px 12px', background: 'transparent', color: theme.brass, border: `1px solid ${theme.brass}`, cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' }}>⬇ PDF</button>
                                                        {isPlatingAdmin && <button onClick={() => resetPlatingShipment(g.shipmentId, g.lines.map(l => l.id))} disabled={isSyncing} title="Admin only — sends the shipment back to staged" style={{ padding: '10px 12px', background: 'transparent', color: theme.inkSoft, border: `1px solid ${theme.line}`, cursor: isSyncing ? 'wait' : 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' }}>Reset</button>}
                                                        <button onClick={() => pushPlatingReceive(g.shipmentId, g.nsPoId, g.lines.map(l => l.id))} disabled={isSyncing} style={{ padding: '10px 16px', background: theme.brass, color: '#fff', border: 'none', cursor: isSyncing ? 'wait' : 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' }}>Receive PO → Item Receipt</button>
                                                    </div>
                                                </div>
                                                {open && (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '0 14px 14px' }}>
                                                        {g.lines.map(l => (
                                                            <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>
                                                                {/* WHAT IT RETURNS AS (Stuart 2026-08-13): the mill core is the pull; the
                                                                    plated target is the point — show both. */}
                                                                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.erpId} — {l.itemName}{(l.targetErpId || l.finishCode) && <span style={{ color: theme.brass }}> → {l.targetErpId || `/${l.finishCode}`}</span>}</span>
                                                                <span style={{ whiteSpace: 'nowrap' }}>{l.qty} @ {l.platingBin}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })()}

                        {/* RETURNED FROM PLATER — THE RECEIVING STATION (Phase 4b) */}
                        {/* Scan to find · receive to a cart · put the cart away, which is when the
                            build posts — into the bin that was actually scanned (Stuart 2026-09-03). */}
                        {platingReceived.length > 0 && (() => {
                            const groups = Object.values(platingReceived.reduce((a, l) => { (a[l.shipmentId || l.id] = a[l.shipmentId || l.id] || { shipmentId: l.shipmentId || l.id, lines: [] }).lines.push(l); return a; }, {}));
                            const rowBox = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', borderTop: `1px solid ${theme.line}`, paddingTop: '8px', flexWrap: 'wrap' };
                            const inp = { padding: '9px 10px', border: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '12px', background: '#fff', color: theme.ink };
                            const btn = (bg, fg) => ({ padding: '9px 14px', background: bg, color: fg, border: 'none', cursor: isSyncing ? 'wait' : 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' });
                            return (
                                <div style={{ background: '#fff', border: `1px solid #7d9a6f`, padding: '20px' }}>
                                    <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '12px' }}>Receiving station — {platingReceived.length} line{platingReceived.length === 1 ? '' : 's'} back from the plater · scan → cart → bin</div>

                                    {/* SCAN TO FIND — the label, not a scroll through every green row. */}
                                    <form onSubmit={(e) => { e.preventDefault();
                                        const hit = findPlatingLine(platingScan, platingReceived);
                                        if (!hit) return alert(`Nothing on this PO matches "${platingScan}".\n\nScan the raw code (H1-138BS) or the plated code (H1-138BS/EP1).`);
                                        setPlatingFocusId(hit.id);
                                        if (hit.cartId && hit.cartStatus === 'saved') { setOpenCartPanel(hit.cartId); setPaLineId(hit.id); setPaBins([{ bin: '', qty: String(hit.receivedQty || '') }]); setPaMulti(false); }
                                    }} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
                                        <input autoFocus value={platingScan} onChange={(e) => setPlatingScan(e.target.value)} placeholder={t('Scan or type the item — raw or plated code')} style={{ ...inp, flex: 1, minWidth: '260px', fontSize: '15px', padding: '12px' }} />
                                        <button type="submit" style={btn(theme.ink, '#fff')}>{t('Find')}</button>
                                        {(platingScan || platingFocusId) && <button type="button" onClick={() => { setPlatingScan(''); setPlatingFocusId(null); }} style={{ ...btn('transparent', theme.inkSoft), border: `1px solid ${theme.line}` }}>{t('Clear')}</button>}
                                    </form>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                        {groups.map(g => {
                                            const carts = cartsOfLines(g.lines);
                                            const openCart = carts.find(c => c.status === 'open');
                                            const savedCarts = carts.filter(c => c.status === 'saved');
                                            const toReceive = g.lines.filter(l => !l.cartId);
                                            return (
                                            <div key={g.shipmentId} style={{ border: `1px solid ${theme.line}`, padding: '14px' }}>
                                                <div style={{ fontFamily: theme.mono, fontSize: '12px', color: theme.ink, marginBottom: '8px' }}>{g.shipmentId} · {g.lines.length} line{g.lines.length === 1 ? '' : 's'}</div>

                                                {/* 1 — OFF THE PALLET, ONTO A CART. Nothing posts here. */}
                                                {toReceive.length > 0 && (
                                                    <div style={{ marginBottom: '14px' }}>
                                                        <div style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '6px' }}>{t('To receive')} · {toReceive.length}</div>
                                                        {toReceive.map(l => {
                                                            const tgt = l.targetErpId || (l.finishCode ? `${l.erpId}/${String(l.finishCode).toUpperCase()}` : '');
                                                            const dim = !!platingFocusId && platingFocusId !== l.id;
                                                            const hit = platingFocusId === l.id;
                                                            return (
                                                                <div key={l.id} style={{ ...rowBox, opacity: dim ? 0.28 : 1, background: hit ? '#fdf6e3' : 'transparent', padding: hit ? '8px' : undefined, borderLeft: hit ? `3px solid ${theme.brass}` : undefined }}>
                                                                    <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.ink }}>
                                                                        {l.erpId} → <span style={{ color: theme.brass }}>{tgt || '— no finish on line'}</span> · {t('sent')} {l.qty} pcs
                                                                    </div>
                                                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                                        <input type="number" min="0" max={l.qty} value={cartQty[l.id] != null ? cartQty[l.id] : ''} onChange={(e) => setCartQty(p => ({ ...p, [l.id]: e.target.value }))} placeholder={String(l.qty)} title="Good pieces off the pallet — leave blank for all of them" style={{ ...inp, width: '92px', textAlign: 'center' }} />
                                                                        {/* ITEM LABELS AT THE DOCK (Stuart 2026-09-03) — the PLATED code, because that is
                                                                            what the pieces are now and what goes on the shelf. One per piece, for the
                                                                            quantity in the box beside it (or all of them if it is blank). */}
                                                                        <button disabled={!tgt} title={tgt ? `Print ${Math.max(1, Math.min(50, parseInt(cartQty[l.id] || l.qty) || 1))} × ${tgt} item label(s)` : 'This line has no plated code yet'}
                                                                            onClick={() => printStockItemLabels({ itemId: tgt, itemName: l.itemName || '', uom: 'EA', woNum: l.shipmentId || l.woNum || '', copies: Math.max(1, Math.min(50, parseInt(cartQty[l.id] || l.qty) || 1)) })}
                                                                            style={{ ...btn('transparent', tgt ? theme.ink : theme.inkSoft), border: `1px solid ${theme.line}`, fontSize: '13px', padding: '8px 12px' }}>🖨</button>
                                                                        <button disabled={!tgt || isSyncing} onClick={() => receiveToCart(l, g.lines)} style={btn(!tgt ? theme.paper2 : theme.brass, !tgt ? theme.inkSoft : '#fff')}>{tgt ? t('Add to cart') : t('No finish')}</button>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}

                                                {/* 2 — THE OPEN CART. */}
                                                {openCart && (
                                                    <div style={{ marginBottom: '14px', border: `1px solid ${theme.brass}`, padding: '10px' }}>
                                                        <div style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.brass, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '6px' }}>{openCart.label} · {t('open')} · {openCart.lines.length} {t('line(s)')} · {openCart.lines.reduce((a, l) => a + (parseInt(l.receivedQty) || 0), 0)} pcs</div>
                                                        {openCart.lines.map(l => (
                                                            <div key={l.id} style={rowBox}>
                                                                <span style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.ink }}>{l.targetErpId || l.erpId} · {l.receivedQty}/{l.qty} pcs{(parseInt(l.scrapQty) || 0) > 0 ? <span style={{ color: '#c0392b' }}> · {l.scrapQty} {t('short')}</span> : ''}</span>
                                                                <button onClick={() => removeFromCart(l)} style={{ ...btn('transparent', theme.inkSoft), border: `1px solid ${theme.line}` }}>{t('Remove')}</button>
                                                            </div>
                                                        ))}
                                                        <button onClick={() => saveCart(openCart)} style={{ ...btn(theme.ink, '#fff'), marginTop: '10px' }}>{t('Save cart')}</button>
                                                    </div>
                                                )}

                                                {/* 3 — PUT AWAY FROM A SAVED CART: scan the item, scan the bin, the build posts. */}
                                                {savedCarts.map(c => {
                                                    const isOpen = openCartPanel === c.cartId;
                                                    const sel = isOpen ? c.lines.find(l => l.id === paLineId) : null;
                                                    const placed = paBins.reduce((a, p) => a + (parseInt(p.qty) || 0), 0);
                                                    return (
                                                    <div key={c.cartId} style={{ border: `1px solid ${theme.line}`, marginBottom: '8px' }}>
                                                        <div onClick={() => { setOpenCartPanel(isOpen ? null : c.cartId); setPaLineId(''); setPaBins([{ bin: '', qty: '' }]); setPaMulti(false); }} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', cursor: 'pointer', background: isOpen ? theme.paper2 : 'transparent', fontFamily: theme.mono, fontSize: '11px', color: theme.ink }}>
                                                            <span>{isOpen ? '▾' : '▸'} {c.label} · {t('saved')} · {c.lines.length} {t('line(s)')} · {c.lines.reduce((a, l) => a + (parseInt(l.receivedQty) || 0), 0)} pcs</span>
                                                            <span style={{ color: theme.inkSoft }}>{t('put away')}</span>
                                                        </div>
                                                        {isOpen && (
                                                            <div style={{ padding: '12px', borderTop: `1px solid ${theme.line}` }}>
                                                                {c.lines.map(l => (
                                                                    <div key={l.id} onClick={() => { setPaLineId(l.id); setPaBins([{ bin: '', qty: String(l.receivedQty || '') }]); setPaMulti(false); }} style={{ ...rowBox, cursor: 'pointer', background: paLineId === l.id ? '#fdf6e3' : 'transparent', borderLeft: paLineId === l.id ? `3px solid ${theme.brass}` : undefined, padding: paLineId === l.id ? '8px' : undefined }}>
                                                                        <span style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.ink }}>{l.targetErpId || l.erpId} · {l.receivedQty} pcs{(parseInt(l.scrapQty) || 0) > 0 ? <span style={{ color: '#c0392b' }}> · {l.scrapQty} {t('short — will be scrapped')}</span> : ''}</span>
                                                                        <span style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft }}>{paLineId === l.id ? t('selected') : t('tap to put away')}</span>
                                                                    </div>
                                                                ))}
                                                                {sel && (
                                                                    <div style={{ marginTop: '12px', borderTop: `1px solid ${theme.line}`, paddingTop: '12px' }}>
                                                                        <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>{t('Where did they go?')} — {sel.targetErpId || sel.erpId} · {sel.receivedQty} pcs</div>
                                                                        {paBins.map((p, i) => (
                                                                            <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
                                                                                <input value={p.bin} onChange={(e) => setPaBins(arr => arr.map((x, k) => k === i ? { ...x, bin: e.target.value } : x))} placeholder={t('Scan the bin')} style={{ ...inp, flex: 1, minWidth: '200px', fontSize: '15px', padding: '12px' }} />
                                                                                {paMulti && <input type="number" min="0" value={p.qty} onChange={(e) => setPaBins(arr => arr.map((x, k) => k === i ? { ...x, qty: e.target.value } : x))} placeholder="qty" style={{ ...inp, width: '92px', textAlign: 'center' }} />}
                                                                                {paMulti && paBins.length > 1 && <button onClick={() => setPaBins(arr => arr.filter((x, k) => k !== i))} style={{ ...btn('transparent', theme.inkSoft), border: `1px solid ${theme.line}` }}>−</button>}
                                                                            </div>
                                                                        ))}
                                                                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                                                                            {!paMulti && <button onClick={() => { setPaMulti(true); setPaBins([{ bin: paBins[0].bin, qty: '' }, { bin: '', qty: '' }]); }} style={{ ...btn('transparent', theme.inkSoft), border: `1px solid ${theme.line}` }}>{t('Multiple bins')}</button>}
                                                                            {paMulti && <button onClick={() => setPaBins(arr => [...arr, { bin: '', qty: '' }])} style={{ ...btn('transparent', theme.inkSoft), border: `1px solid ${theme.line}` }}>+ {t('another bin')}</button>}
                                                                            {paMulti && <span style={{ fontFamily: theme.mono, fontSize: '10px', color: placed === (parseInt(sel.receivedQty) || 0) ? '#3a7d44' : '#c0392b' }}>{placed} / {sel.receivedQty} {t('placed')}</span>}
                                                                            <button disabled={isSyncing} onClick={() => putAwayFromCart(sel, paMulti ? paBins : [{ bin: paBins[0].bin, qty: sel.receivedQty }])} style={{ ...btn('#5e7d54', '#fff'), marginLeft: 'auto' }}>{isSyncing ? '…' : t('Put away & build')}</button>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                    );
                                                })}
                                            </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })()}

                        {/* SHIP PALLET MODAL */}
                        {showShipModal && (
                            <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.8)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <div style={{ background: '#fff', padding: '40px', width: 'min(760px, 96vw)', maxHeight: '90vh', overflowY: 'auto', border: `1px solid ${theme.line}`, boxShadow: '0 4px 24px rgba(0,0,0,0.1)' }}>
                                    <h2 style={{ margin: '0 0 6px 0', fontFamily: theme.serif, fontSize: '2rem', color: theme.ink }}>Ship Plating Pallet</h2>
                                    <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, marginBottom: '20px', letterSpacing: '.1em', textTransform: 'uppercase' }}>
                                        Vendor: Dayton Grey · NetSuite PO summary line "Weekly Plating Shipment" · $/ea defaults to each item's outsourced Base Cost
                                    </div>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', marginBottom: '20px' }}>
                                        <thead style={{ borderBottom: `2px solid ${theme.ink}` }}>
                                            <tr>
                                                <th style={{ padding: '8px', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase' }}>Item</th>
                                                <th style={{ padding: '8px', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', textAlign: 'center' }}>WO</th>
                                                <th style={{ padding: '8px', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', textAlign: 'center' }}>Qty</th>
                                                <th style={{ padding: '8px', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', textAlign: 'center' }}>$ / ea</th>
                                                <th style={{ padding: '8px', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', textAlign: 'right' }}>Line $</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {platingStaged.map(l => {
                                                const rate = platingRateFor(l);
                                                const lineAmt = rate * (parseInt(l.qty) || 0);
                                                return (
                                                    <tr key={l.id} style={{ borderBottom: `1px solid ${theme.line}` }}>
                                                        <td style={{ padding: '10px 8px', fontFamily: theme.sans, fontSize: '0.85rem' }}>{l.erpId} — {l.itemName}</td>
                                                        <td style={{ padding: '10px 8px', textAlign: 'center', fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>{l.woNum || '—'}</td>
                                                        <td style={{ padding: '10px 8px', textAlign: 'center', fontFamily: theme.mono }}>{l.qty}</td>
                                                        <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                                                            <input type="number" min="0" step="0.01" value={shipCosts[l.id] !== undefined ? shipCosts[l.id] : (platingBaseCost(l) || '')} onChange={e => setShipCosts(prev => ({ ...prev, [l.id]: e.target.value }))} placeholder="0.00" style={{ width: '80px', padding: '8px', textAlign: 'center', fontFamily: theme.mono, border: `1px solid ${theme.line}`, outline: 'none' }} />
                                                        </td>
                                                        <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: theme.mono, color: theme.ink }}>${lineAmt.toFixed(2)}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '30px', alignItems: 'center', marginBottom: '24px' }}>
                                        <span style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase' }}>Total plating cost</span>
                                        <span style={{ fontFamily: theme.serif, fontSize: '1.8rem', color: theme.ink }}>${platingStaged.reduce((s, l) => s + platingRateFor(l) * (parseInt(l.qty) || 0), 0).toFixed(2)}</span>
                                    </div>
                                    <div style={{ display: 'flex', gap: '20px', justifyContent: 'flex-end' }}>
                                        <button onClick={() => setShowShipModal(false)} style={{ padding: '15px 30px', background: 'transparent', border: `1px solid ${theme.line}`, cursor: 'pointer', fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase' }}>Cancel</button>
                                        <button onClick={pushPlatingShipment} disabled={isSyncing} style={{ padding: '15px 30px', background: theme.brass, color: '#fff', border: 'none', cursor: isSyncing ? 'wait' : 'pointer', fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase' }}>
                                            {isSyncing ? 'Creating PO…' : 'Create PO & Ship Pallet'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* HEADER FILTERS */}
                        <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '24px', display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ padding: '12px', border: `1px solid ${theme.line}`, fontFamily: theme.sans, outline: 'none', background: theme.paper2, minWidth: '150px' }}>
                                <option value="">All Categories</option>
                                {dynamicProdTypes.map(pt => <option key={pt} value={pt}>{pt}</option>)}
                            </select>
                            <select value={collectionFilter} onChange={(e) => setCollectionFilter(e.target.value)} style={{ padding: '12px', border: `1px solid ${theme.line}`, fontFamily: theme.sans, outline: 'none', background: theme.paper2, minWidth: '150px' }}>
                                <option value="">All Collections</option>
                                {dynamicCollections.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <select value={watchlistFilter} onChange={(e) => setWatchlistFilter(e.target.value)} style={{ padding: '12px', border: `1px solid ${theme.line}`, fontFamily: theme.sans, outline: 'none', background: theme.paper2, minWidth: '150px' }}>
                                <option value="">All Watchlists</option>
                                {dynamicWatchlists.map(w => <option key={w} value={w}>{w}</option>)}
                            </select>
                            <input placeholder="Search an item to pull for plating…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} style={{ padding: '12px', border: `1px solid ${theme.line}`, fontFamily: theme.sans, outline: 'none', flex: 1, minWidth: '180px' }} />
                            {(typeFilter || collectionFilter || watchlistFilter || searchQuery) && <button onClick={() => { setTypeFilter(''); setCollectionFilter(''); setWatchlistFilter(''); setSearchQuery(''); }} style={{ padding: '12px 14px', background: 'transparent', color: theme.inkSoft, border: `1px solid ${theme.line}`, cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase' }}>Clear</button>}
                            <button onClick={pullNetSuiteStock} disabled={isSyncing} style={{ padding: '12px 20px', background: isSyncing ? theme.paper : theme.ink, color: isSyncing ? theme.inkSoft : '#fff', border: 'none', cursor: isSyncing ? 'wait' : 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase' }}>
                                {isSyncing ? 'Syncing...' : 'Pull Live Stock'}
                            </button>
                        </div>

                        {/* INVENTORY TABLE */}
                        <div style={{ flex: 1, background: '#fff', border: `1px solid ${theme.line}`, overflowY: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                <thead style={{ background: theme.paper2, position: 'sticky', top: 0, zIndex: 10 }}>
                                    <tr>
                                        <th style={{ padding: '16px', borderBottom: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase' }}>ERP ID / Item</th>
                                        <th style={{ padding: '16px', borderBottom: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', textAlign: 'center' }}>Home Bin</th>
                                        <th style={{ padding: '16px', borderBottom: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', textAlign: 'center' }}>On Hand</th>
                                        <th style={{ padding: '16px', borderBottom: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', textAlign: 'center' }}>Pull</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {baseFilteredItems.map(item => (
                                        <tr key={item.id} style={{ borderBottom: `1px solid ${theme.line}` }}>
                                            <td style={{ padding: '16px' }}>
                                                <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>{item.erpId}</div>
                                                <div style={{ fontFamily: theme.sans, fontSize: '1rem', color: theme.ink, fontWeight: 500 }}>{item.itemName}</div>
                                            </td>
                                            <td style={{ padding: '16px', textAlign: 'center', fontFamily: theme.mono, fontSize: '12px', color: theme.brass }}>{item.binLocation}</td>
                                            <td style={{ padding: '16px', textAlign: 'center', fontFamily: theme.mono, fontSize: '1.2rem', color: theme.inkSoft }}>{item.onHand}</td>
                                            <td style={{ padding: '16px', textAlign: 'center' }}>
                                                <button onClick={() => { setPlatingBase(item); setPlatingSrcScan(""); setPlatingQty(""); setPlatingDestScan(""); setPlatingMemo(""); setPlatingWO(isStockWoNumber()); setPlatingDemandId(null); }} style={{ padding: '10px 18px', background: theme.ink, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Pull →</button>
                                            </td>
                                        </tr>
                                    ))}
                                    {baseFilteredItems.length === 0 && (
                                        <tr>
                                            <td colSpan="4" style={{ padding: '40px', textAlign: 'center', color: theme.inkSoft, fontStyle: 'italic', fontFamily: theme.serif }}>No inventory items matched your filter.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* 🎨 TAB: SAMPLE CHIPS — PRODUCTION CONTROL */}
                {activeTab === 'CHIPS' && (() => {
                    const runOrders = chipOrders.filter(o => o.type === 'run');
                    const openOrders = chipOrders.filter(o => o.type !== 'run' && o.status !== 'done');
                    const doneOrders = chipOrders.filter(o => o.type !== 'run' && o.status === 'done');
                    const inFinishingCount = chipOrders.filter(o => o.inFinishing).length;
                    const recipeOptions = [...new Set(finRecipes.map(r => r.code || r.id).filter(Boolean))].sort();
                    const pillOf = (status) => ({
                        pending: { bg: theme.paper, fg: theme.inkSoft, label: 'Pending' },
                        doing: { bg: theme.brass, fg: '#fff', label: 'In Progress' },
                        done: { bg: '#e8f3e9', fg: '#2f7d3b', label: 'Done ✓' },
                    }[status] || { bg: theme.paper, fg: theme.inkSoft, label: 'Pending' });
                    const lbl = { fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', color: theme.inkSoft, display: 'block', marginBottom: '4px', letterSpacing: '.1em' };
                    const inp = { width: '100%', padding: '9px', border: `1px solid ${theme.line}`, fontFamily: theme.sans, boxSizing: 'border-box', background: '#fff', outline: 'none' };
                    const renderOrderCard = (o) => (
                        <div key={o.id} style={{ border: `1px solid ${o.inFinishing ? theme.brass : theme.line}`, background: '#fff', marginBottom: '16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '14px 18px', background: theme.paper, borderBottom: `1px solid ${theme.line}` }}>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px', flexWrap: 'wrap' }}>
                                    <span style={{ fontFamily: theme.serif, fontSize: '1.3rem', fontWeight: 500, color: theme.ink }}>{o.customer}</span>
                                    <span style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>{o.qty}× chips · {o.recipe} · {String(o.brand || '').toUpperCase()}</span>
                                    {o.inFinishing && <span style={{ fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', background: theme.brass, color: '#fff', padding: '3px 8px', borderRadius: '10px' }}>In Finishing · uses capacity</span>}
                                </div>
                                <button onClick={() => deleteChipOrder(o.id)} style={{ background: 'none', border: 'none', color: theme.inkSoft, fontSize: '1.3rem', cursor: 'pointer' }}>×</button>
                            </div>
                            {o.notes && <div style={{ padding: '8px 18px', fontStyle: 'italic', fontSize: '0.85rem', color: theme.inkSoft, borderBottom: `1px solid ${theme.line}` }}>{o.notes}</div>}
                            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${CHIP_STEPS.length}, 1fr)` }}>
                                {CHIP_STEPS.map((s, i) => {
                                    const st = o.steps?.[s.key] || { status: 'pending', employee: '' };
                                    const p = pillOf(st.status);
                                    return (
                                        <div key={s.key} style={{ padding: '14px', borderLeft: i ? `1px solid ${theme.line}` : 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                            <div style={{ fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', color: theme.ink, fontWeight: 600 }}>{i + 1}. {s.label}{s.key === 'painting' && st.recipe ? ` (${st.recipe})` : ''}</div>
                                            <button onClick={() => advanceChipStep(o, s.key)} title="Click to advance: Pending → In Progress → Done" style={{ background: p.bg, color: p.fg, border: `1px solid ${theme.line}`, padding: '8px', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.06em', cursor: 'pointer' }}>{p.label}</button>
                                            <select value={st.employee || ''} onChange={(e) => patchChipStep(o, s.key, { employee: e.target.value })} style={{ padding: '7px', border: `1px solid ${theme.line}`, fontFamily: theme.sans, fontSize: '0.8rem', background: '#fff', outline: 'none' }}>
                                                <option value="">— employee —</option>
                                                {finUsers.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                                            </select>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                    const thR = { padding: '8px 10px', textAlign: 'left', fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', color: theme.inkSoft, position: 'sticky', top: 0, background: theme.paper };
                    const fmtDur = (ms) => { if (!ms || ms < 0) return '—'; const t = Math.floor(ms / 1000); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return h ? `${h}h ${m}m` : (m ? `${m}m ${s}s` : `${s}s`); };
                    const stepElapsed = (st) => st?.startedAt ? ((st.stoppedAt || Date.now()) - st.startedAt) : 0;
                    const renderRun = (o) => {
                        const batches = o.batches || [];
                        const workingByFinish = {}; batches.filter(b => b.status === 'working').forEach(b => { workingByFinish[b.finish] = (workingByFinish[b.finish] || 0) + (b.qty || 0); });
                        const totalOnOrder = (o.lines || []).reduce((s, l) => s + (l.qty || 0), 0);
                        const totalDone = (o.lines || []).reduce((s, l) => s + (l.completed || 0), 0);
                        const totalMissing = totalOnOrder - totalDone;
                        const workingCards = batches.filter(b => b.status === 'working');
                        const stepPill = (status) => pillOf(status === 'running' ? 'doing' : status);
                        return (
                            <div key={o.id} style={{ marginBottom: '24px' }}>
                                {/* THE ORDER (top): totals + per-finish completed/missing + assign-to-floor */}
                                <div style={{ border: `1px solid ${theme.brass}`, background: '#fff' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '14px 18px', background: theme.paper, borderBottom: `1px solid ${theme.line}`, flexWrap: 'wrap' }}>
                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px', flexWrap: 'wrap' }}>
                                            <span style={{ fontFamily: theme.serif, fontSize: '1.3rem', fontWeight: 500 }}>{o.code} Sample Chip Run</span>
                                            <span style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>{o.lines?.length || 0} finishes · {totalOnOrder.toLocaleString()} on order · {totalDone.toLocaleString()} complete · <b style={{ color: totalMissing ? theme.brass : '#2f7d3b' }}>{totalMissing.toLocaleString()} missing</b></span>
                                        </div>
                                        <button onClick={() => deleteChipOrder(o.id)} style={{ background: 'none', border: 'none', color: theme.inkSoft, fontSize: '1.3rem', cursor: 'pointer' }}>×</button>
                                    </div>
                                    <div style={{ maxHeight: '42vh', overflowY: 'auto' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: theme.sans, fontSize: '0.85rem' }}>
                                            <thead><tr style={{ borderBottom: `1px solid ${theme.line}` }}>{['Finish', 'On Order', 'Completed', 'In Prog', 'Missing', 'Assign to floor'].map(h => <th key={h} style={thR}>{h}</th>)}</tr></thead>
                                            <tbody>
                                                {(o.lines || []).map(l => {
                                                    const inProg = workingByFinish[l.finish] || 0;
                                                    const missing = (l.qty || 0) - (l.completed || 0);
                                                    const remaining = missing - inProg;
                                                    const qkey = `${o.id}::${l.finish}`;
                                                    const aq = batchQty[qkey] ?? '200';
                                                    return (
                                                        <tr key={l.finish} style={{ borderBottom: `1px solid ${theme.line}`, background: missing <= 0 ? '#f4faf4' : '#fff' }}>
                                                            <td style={{ padding: '8px 10px', fontFamily: theme.mono, fontWeight: 600 }}>{l.finish}</td>
                                                            <td style={{ padding: '8px 10px', fontFamily: theme.mono }}>{(l.qty || 0).toLocaleString()}</td>
                                                            <td style={{ padding: '8px 10px' }}><input type="number" min="0" max={l.qty} value={l.completed ?? 0} onChange={e => setRunCompleted(o, l.finish, e.target.value)} style={{ width: '78px', padding: '6px', fontFamily: theme.mono, textAlign: 'center', border: `1px solid ${theme.line}`, outline: 'none' }} /></td>
                                                            <td style={{ padding: '8px 10px', fontFamily: theme.mono, color: inProg ? theme.brass : theme.inkSoft }}>{inProg ? inProg.toLocaleString() : '—'}</td>
                                                            <td style={{ padding: '8px 10px', fontFamily: theme.mono, color: missing > 0 ? theme.brass : '#2f7d3b', fontWeight: 600 }}>{missing.toLocaleString()}</td>
                                                            <td style={{ padding: '8px 10px' }}>
                                                                {remaining > 0 ? (
                                                                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                                                        <input type="number" min="1" max={remaining} value={aq} onChange={e => setBatchQty(p => ({ ...p, [qkey]: e.target.value }))} style={{ width: '62px', padding: '5px', fontFamily: theme.mono, textAlign: 'center', border: `1px solid ${theme.line}` }} />
                                                                        <button onClick={() => assignBatch(o, l.finish, Math.min(parseInt(aq) || 0, remaining))} style={{ padding: '5px 10px', background: theme.ink, color: '#fff', border: 'none', fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', cursor: 'pointer' }}>Assign ▾</button>
                                                                    </div>
                                                                ) : <span style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.inkSoft, textTransform: 'uppercase' }}>{missing <= 0 ? 'Complete ✓' : 'all assigned'}</span>}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                    {canSeeChipReport && (() => {
                                        const roll = {};
                                        batches.forEach(b => CHIP_STEPS.forEach(s => {
                                            const st = b.steps?.[s.key];
                                            if (st && st.startedBy && st.startedAt) {
                                                const r = roll[st.startedBy] = roll[st.startedBy] || { steps: 0, ms: 0, running: 0 };
                                                if (st.stoppedAt) r.steps += 1; else r.running += 1;
                                                r.ms += (st.stoppedAt || Date.now()) - st.startedAt;
                                            }
                                        }));
                                        const rows = Object.entries(roll).sort((a, b) => b[1].ms - a[1].ms);
                                        if (!rows.length) return null;
                                        return (
                                            <div style={{ borderTop: `1px solid ${theme.line}`, padding: '14px 18px', background: theme.paper }}>
                                                <div style={{ fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: theme.inkSoft, marginBottom: '8px' }}>📊 Roll-up — who did what · management only</div>
                                                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: theme.sans, fontSize: '0.82rem' }}>
                                                    <thead><tr>{['Employee', 'Steps done', 'Running', 'Total time'].map(h => <th key={h} style={{ textAlign: 'left', padding: '5px 10px', fontFamily: theme.mono, fontSize: '8px', textTransform: 'uppercase', color: theme.inkSoft }}>{h}</th>)}</tr></thead>
                                                    <tbody>
                                                        {rows.map(([who, r]) => (
                                                            <tr key={who} style={{ borderTop: `1px solid ${theme.line}` }}>
                                                                <td style={{ padding: '5px 10px', color: theme.ink }}>{who}</td>
                                                                <td style={{ padding: '5px 10px', fontFamily: theme.mono }}>{r.steps}</td>
                                                                <td style={{ padding: '5px 10px', fontFamily: theme.mono, color: r.running ? theme.brass : theme.inkSoft }}>{r.running || '—'}</td>
                                                                <td style={{ padding: '5px 10px', fontFamily: theme.mono }}>{fmtDur(r.ms)}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        );
                                    })()}
                                </div>

                                {/* WORKING (bottom): assigned batches people sign in/out of */}
                                {workingCards.length > 0 && (
                                    <div style={{ marginTop: '16px' }}>
                                        <div style={{ fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: theme.inkSoft, marginBottom: '10px' }}>On the floor — working batches ({workingCards.length})</div>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(580px, 1fr))', gap: '14px' }}>
                                            {workingCards.map(b => {
                                                const allDone = CHIP_STEPS.every(s => b.steps?.[s.key]?.status === 'done');
                                                return (
                                                    <div key={b.id} style={{ border: `1px solid ${theme.brass}`, background: '#fff', overflow: 'hidden' }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: theme.paper, borderBottom: `1px solid ${theme.line}` }}>
                                                            <span style={{ fontFamily: theme.serif, fontSize: '1.1rem', fontWeight: 500 }}>{b.finish} · {b.qty} pcs</span>
                                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                                <button onClick={() => completeBatch(o, b)} disabled={!allDone} title={allDone ? '' : 'Finish all steps first'} style={{ padding: '5px 10px', background: allDone ? '#2f7d3b' : theme.paper, color: allDone ? '#fff' : theme.inkSoft, border: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', cursor: allDone ? 'pointer' : 'not-allowed' }}>✓ Complete</button>
                                                                <button onClick={() => removeBatch(o, b.id)} title="Discard batch" style={{ background: 'none', border: 'none', color: theme.inkSoft, fontSize: '1.1rem', cursor: 'pointer' }}>×</button>
                                                            </div>
                                                        </div>
                                                        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${CHIP_STEPS.length}, minmax(0, 1fr))` }}>
                                                            {CHIP_STEPS.map((s, i) => { const st = b.steps?.[s.key] || {}; const p = stepPill(st.status); return (
                                                                <div key={s.key} style={{ padding: '10px', borderLeft: i ? `1px solid ${theme.line}` : 'none', display: 'flex', flexDirection: 'column', gap: '7px' }}>
                                                                    <div style={{ fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', fontWeight: 600 }}>{i + 1}. {s.label}</div>
                                                                    <div style={{ fontFamily: theme.mono, fontSize: '8px', textTransform: 'uppercase', color: p.fg, background: p.bg, border: `1px solid ${theme.line}`, padding: '2px 4px', textAlign: 'center' }}>{p.label}</div>
                                                                    <select value={st.employee || ''} onChange={e => batchStepEmployee(o, b.id, s.key, e.target.value)} style={{ padding: '4px', border: `1px solid ${theme.line}`, fontFamily: theme.sans, fontSize: '0.72rem', outline: 'none' }}>
                                                                        <option value="">— assign —</option>
                                                                        {finUsers.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                                                                    </select>
                                                                    {st.status === 'done' ? (
                                                                        <div style={{ fontFamily: theme.mono, fontSize: '8px', color: '#2f7d3b' }}>✓ {st.stoppedBy}</div>
                                                                    ) : (
                                                                        <button onClick={() => batchStepClock(o, b.id, s.key, s.label, st.status === 'running' ? 'stop' : 'start')} style={{ padding: '5px', background: st.status === 'running' ? '#d9534f' : theme.ink, color: '#fff', border: 'none', fontFamily: theme.mono, fontSize: '8px', textTransform: 'uppercase', cursor: 'pointer' }}>{st.status === 'running' ? '⏹ Stop' : '▶ Start'} (PIN)</button>
                                                                    )}
                                                                    {st.startedBy && <div style={{ fontFamily: theme.mono, fontSize: '8px', color: theme.inkSoft }}>{st.status === 'running' ? '▶' : 'by'} {st.startedBy}</div>}
                                                                    {canSeeChipReport && st.startedAt && <div style={{ fontFamily: theme.mono, fontSize: '8px', color: theme.brass }}>⏱ {fmtDur(stepElapsed(st))}{st.stoppedAt ? '' : ' (running)'}</div>}
                                                                </div>
                                                            ); })}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    };
                    return (
                        <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '24px', minHeight: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '8px' }}>
                                <h2 style={{ margin: 0, fontFamily: theme.serif, fontSize: '1.6rem', fontWeight: 500, color: theme.ink }}>Sample Chips — Production Control</h2>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                                    <span style={{ fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', color: theme.inkSoft }}>{openOrders.length} open · {inFinishingCount} in finishing</span>
                                    {canSeeChipReport && <button onClick={() => setShowChipStats(true)} style={{ padding: '9px 14px', background: theme.ink, color: '#fff', border: 'none', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', cursor: 'pointer' }}>📊 Stats</button>}
                                    <button onClick={seedHdscRun} style={{ padding: '9px 14px', background: theme.paper, border: `1px dashed ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', cursor: 'pointer', color: theme.ink }}>🌱 Seed HDSC Run</button>
                                </div>
                            </div>

                            {/* 📊 CHIP PRODUCTION STATISTICS — weekly throughput, people, steps. Computed
                                live from every chip order/batch since the first record: run batches carry
                                PIN-clocked start/stop per step (real labor time); small orders count on
                                their completion week with per-step employee credit. */}
                            {showChipStats && (() => {
                                const weekStart = (ts) => { const d = new Date(ts); const day = (d.getDay() + 6) % 7; d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - day); return d.getTime(); };
                                const wkLabel = (ts) => `Wk of ${new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
                                const weeks = {}; const people = {}; const stepAgg = {};
                                CHIP_STEPS.forEach(s => { stepAgg[s.key] = { label: s.label, done: 0, ms: 0, pcs: 0 }; });
                                let totalDoneChips = 0, wipChips = 0, runTarget = 0, runDone = 0, firstTs = null;
                                const wkOf = (ts) => { const k = weekStart(ts); return weeks[k] = weeks[k] || { k, chips: 0, batches: 0, orders: 0, ms: 0, people: new Set() }; };
                                chipOrders.forEach(o => {
                                    if (o.createdAt && (!firstTs || o.createdAt < firstTs)) firstTs = o.createdAt;
                                    if (o.type === 'run') {
                                        (o.lines || []).forEach(l => { runTarget += l.qty || 0; runDone += l.completed || 0; });
                                        (o.batches || []).forEach(b => {
                                            if (b.status === 'working') wipChips += b.qty || 0;
                                            if (b.status === 'done' && b.completedAt) { const w = wkOf(b.completedAt); w.chips += b.qty || 0; w.batches += 1; totalDoneChips += b.qty || 0; }
                                            CHIP_STEPS.forEach(s => {
                                                const st = b.steps?.[s.key];
                                                if (!st?.startedAt) return;
                                                const ms = (st.stoppedAt || Date.now()) - st.startedAt;
                                                const who = st.startedBy || st.employee || '';
                                                if (who) {
                                                    const p = people[who] = people[who] || { steps: 0, ms: 0, pieces: 0, running: 0 };
                                                    if (st.stoppedAt) { p.steps += 1; p.pieces += b.qty || 0; } else p.running += 1;
                                                    p.ms += ms;
                                                    const w = wkOf(st.startedAt); w.people.add(who); w.ms += ms;
                                                }
                                                if (st.stoppedAt) { stepAgg[s.key].done += 1; stepAgg[s.key].ms += ms; stepAgg[s.key].pcs += b.qty || 0; }
                                            });
                                        });
                                    } else {
                                        if (o.status === 'done') {
                                            const doneTs = o.updatedAt || o.createdAt || Date.now();
                                            const w = wkOf(doneTs); w.chips += o.qty || 0; w.orders += 1; totalDoneChips += o.qty || 0;
                                            CHIP_STEPS.forEach(s => { const who = o.steps?.[s.key]?.employee; if (who) { w.people.add(who); const p = people[who] = people[who] || { steps: 0, ms: 0, pieces: 0, running: 0 }; p.steps += 1; p.pieces += o.qty || 0; } });
                                        } else { wipChips += o.qty || 0; }
                                    }
                                });
                                const weekRows = Object.values(weeks).sort((a, b) => b.k - a.k);
                                const activeWeeks = Math.max(1, weekRows.filter(w => w.chips > 0 || w.ms > 0).length);
                                const best = weekRows.reduce((m, w) => (w.chips > (m?.chips || 0) ? w : m), null);
                                const peopleRows = Object.entries(people).sort((a, b) => b[1].ms - a[1].ms || b[1].pieces - a[1].pieces);
                                const hrs = (ms) => (ms / 3600000).toFixed(1);
                                const downloadCsv = () => {
                                    const esc = (c) => `"${String(c).replace(/"/g, '""')}"`;
                                    const out = [['Week of', 'Chips completed', 'Run batches', 'Small orders', 'People active', 'Clocked hours'].map(esc).join(',')];
                                    [...weekRows].reverse().forEach(w => out.push([new Date(w.k).toLocaleDateString(), w.chips, w.batches, w.orders, w.people.size, hrs(w.ms)].map(esc).join(',')));
                                    out.push('');
                                    out.push(['Employee', 'Steps done', 'Pieces credited', 'Clocked hours', 'Running now'].map(esc).join(','));
                                    peopleRows.forEach(([who, p]) => out.push([who, p.steps, p.pieces, hrs(p.ms), p.running].map(esc).join(',')));
                                    out.push('');
                                    out.push(['Step', 'Times completed', 'Total hours', 'Avg min / 100 pcs'].map(esc).join(','));
                                    CHIP_STEPS.forEach(s => { const a = stepAgg[s.key]; out.push([a.label, a.done, hrs(a.ms), a.pcs ? ((a.ms / 60000) / (a.pcs / 100)).toFixed(1) : ''].map(esc).join(',')); });
                                    const url = URL.createObjectURL(new Blob([out.join('\n')], { type: 'text/csv' }));
                                    const a = document.createElement('a'); a.href = url; a.download = `chip_stats_${activeBrand}.csv`; a.click(); URL.revokeObjectURL(url);
                                };
                                const card = (label, value, sub) => (
                                    <div key={label} style={{ flex: '1 1 130px', background: theme.paper, border: `1px solid ${theme.line}`, padding: '14px 16px' }}>
                                        <div style={{ fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', color: theme.inkSoft }}>{label}</div>
                                        <div style={{ fontFamily: theme.serif, fontSize: '1.6rem', color: theme.ink, marginTop: '4px' }}>{value}</div>
                                        {sub && <div style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.inkSoft, marginTop: '2px' }}>{sub}</div>}
                                    </div>
                                );
                                const thS = { textAlign: 'left', padding: '6px 10px', fontFamily: theme.mono, fontSize: '8px', textTransform: 'uppercase', letterSpacing: '.08em', color: theme.inkSoft, borderBottom: `2px solid ${theme.ink}` };
                                const tdS = { padding: '6px 10px', fontFamily: theme.mono, fontSize: '11px', color: theme.ink, borderBottom: `1px solid ${theme.line}` };
                                return (
                                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.8)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowChipStats(false)}>
                                        <div onClick={e => e.stopPropagation()} style={{ background: '#fff', width: 'min(980px, 95vw)', maxHeight: '92vh', overflowY: 'auto', padding: '28px 32px', border: `1px solid ${theme.line}`, boxShadow: '0 8px 40px rgba(0,0,0,0.25)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
                                                <h2 style={{ margin: 0, fontFamily: theme.serif, fontSize: '1.6rem', color: theme.ink }}>Chip Production — Statistics</h2>
                                                <div style={{ display: 'flex', gap: '10px' }}>
                                                    <button onClick={downloadCsv} style={{ padding: '8px 14px', background: theme.ink, color: '#fff', border: 'none', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', cursor: 'pointer' }}>⬇ CSV</button>
                                                    <button onClick={() => setShowChipStats(false)} style={{ background: 'transparent', border: 'none', fontSize: '1.3rem', cursor: 'pointer', color: theme.inkSoft }}>×</button>
                                                </div>
                                            </div>
                                            <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '18px' }}>
                                                Since {firstTs ? new Date(firstTs).toLocaleDateString() : '—'} · live from every chip order & batch · {String(activeBrand).toUpperCase()}
                                            </div>
                                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '22px' }}>
                                                {card('Chips completed', totalDoneChips.toLocaleString(), 'batches + small orders')}
                                                {card('Avg / active week', Math.round(totalDoneChips / activeWeeks).toLocaleString(), `${activeWeeks} active week(s)`)}
                                                {card('Best week', best ? best.chips.toLocaleString() : '—', best ? wkLabel(best.k) : '')}
                                                {card('Operators', String(peopleRows.length), 'all-time, clocked')}
                                                {card('Clocked hours', hrs(peopleRows.reduce((s, [, p]) => s + p.ms, 0)), 'PIN start→stop')}
                                                {card('In progress now', wipChips.toLocaleString(), 'working batches + open orders')}
                                                {runTarget > 0 && card('HDSC run', `${Math.round((runDone / runTarget) * 100)}%`, `${runDone.toLocaleString()} / ${runTarget.toLocaleString()} pcs`)}
                                            </div>

                                            <div style={{ fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: theme.inkSoft, margin: '0 0 6px' }}>Week by week</div>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '22px' }}>
                                                <thead><tr>{['Week', 'Chips completed', 'Run batches', 'Small orders', 'People', 'Clocked hrs'].map(h => <th key={h} style={thS}>{h}</th>)}</tr></thead>
                                                <tbody>
                                                    {weekRows.length === 0 && <tr><td colSpan={6} style={{ ...tdS, fontStyle: 'italic', color: theme.inkSoft }}>No activity recorded yet.</td></tr>}
                                                    {weekRows.map(w => (
                                                        <tr key={w.k}>
                                                            <td style={tdS}>{wkLabel(w.k)}</td>
                                                            <td style={{ ...tdS, fontWeight: 700 }}>{w.chips.toLocaleString()}</td>
                                                            <td style={tdS}>{w.batches || '·'}</td>
                                                            <td style={tdS}>{w.orders || '·'}</td>
                                                            <td style={tdS}>{w.people.size || '·'}</td>
                                                            <td style={tdS}>{w.ms ? hrs(w.ms) : '·'}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>

                                            <div style={{ fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: theme.inkSoft, margin: '0 0 6px' }}>People</div>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '22px' }}>
                                                <thead><tr>{['Employee', 'Steps done', 'Pieces credited', 'Clocked hrs', 'Avg min / step', 'Running now'].map(h => <th key={h} style={thS}>{h}</th>)}</tr></thead>
                                                <tbody>
                                                    {peopleRows.length === 0 && <tr><td colSpan={6} style={{ ...tdS, fontStyle: 'italic', color: theme.inkSoft }}>No clocked work yet — stats build as operators PIN in/out of batch steps.</td></tr>}
                                                    {peopleRows.map(([who, p]) => (
                                                        <tr key={who}>
                                                            <td style={{ ...tdS, fontFamily: theme.sans, fontWeight: 500 }}>{who}</td>
                                                            <td style={tdS}>{p.steps}</td>
                                                            <td style={tdS}>{p.pieces.toLocaleString()}</td>
                                                            <td style={tdS}>{hrs(p.ms)}</td>
                                                            <td style={tdS}>{p.steps ? ((p.ms / 60000) / p.steps).toFixed(1) : '·'}</td>
                                                            <td style={{ ...tdS, color: p.running ? theme.brass : theme.inkSoft }}>{p.running || '·'}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>

                                            <div style={{ fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: theme.inkSoft, margin: '0 0 6px' }}>Steps</div>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '10px' }}>
                                                <thead><tr>{['Step', 'Times completed', 'Total hrs', 'Avg min / batch', 'Avg min / 100 pcs'].map(h => <th key={h} style={thS}>{h}</th>)}</tr></thead>
                                                <tbody>
                                                    {CHIP_STEPS.map(s => { const a = stepAgg[s.key]; return (
                                                        <tr key={s.key}>
                                                            <td style={{ ...tdS, fontFamily: theme.sans, fontWeight: 500 }}>{a.label}</td>
                                                            <td style={tdS}>{a.done || '·'}</td>
                                                            <td style={tdS}>{a.ms ? hrs(a.ms) : '·'}</td>
                                                            <td style={tdS}>{a.done ? ((a.ms / 60000) / a.done).toFixed(1) : '·'}</td>
                                                            <td style={tdS}>{a.pcs ? ((a.ms / 60000) / (a.pcs / 100)).toFixed(1) : '·'}</td>
                                                        </tr>
                                                    ); })}
                                                </tbody>
                                            </table>
                                            <div style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.inkSoft }}>
                                                Pieces credited = the batch quantity passes through each step a person completed. Clocked time = PIN start → stop on run batches; small chip orders count on their completion week (no timers on those). A week runs Monday–Sunday.
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}
                            {runOrders.map(renderRun)}
                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end', background: theme.paper, border: `1px solid ${theme.line}`, padding: '16px', marginBottom: '24px' }}>
                                <div style={{ flex: 2, minWidth: '150px' }}><label style={lbl}>Customer</label><input value={chipForm.customer} onChange={e => setChipForm({ ...chipForm, customer: e.target.value })} placeholder="e.g. Brimar" style={inp} /></div>
                                <div style={{ width: '70px' }}><label style={lbl}>Qty</label><input type="number" min="1" value={chipForm.qty} onChange={e => setChipForm({ ...chipForm, qty: e.target.value })} style={inp} /></div>
                                <div style={{ width: '150px' }}><label style={lbl}>Paint Recipe</label><select value={chipForm.recipe} onChange={e => setChipForm({ ...chipForm, recipe: e.target.value })} style={inp}><option value="">— recipe —</option>{recipeOptions.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                                <div style={{ flex: 2, minWidth: '150px' }}><label style={lbl}>Notes</label><input value={chipForm.notes} onChange={e => setChipForm({ ...chipForm, notes: e.target.value })} placeholder="optional" style={inp} /></div>
                                <button onClick={createChipOrder} style={{ padding: '10px 18px', background: theme.ink, color: '#fff', border: 'none', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer', whiteSpace: 'nowrap' }}>+ Add Chip Order</button>
                            </div>
                            {openOrders.length === 0 && <p style={{ color: theme.inkSoft, fontStyle: 'italic', margin: 0 }}>No open sample-chip orders. Add one above to start the punching → painting → sanding → cleaning → engraving run.</p>}
                            {openOrders.map(renderOrderCard)}
                            {doneOrders.length > 0 && (
                                <div style={{ marginTop: '20px', borderTop: `1px solid ${theme.line}`, paddingTop: '16px' }}>
                                    <button onClick={() => setChipShowDone(v => !v)} style={{ background: 'none', border: 'none', color: theme.inkSoft, fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>{chipShowDone ? '▾' : '▸'} Completed ({doneOrders.length})</button>
                                    {chipShowDone && <div style={{ marginTop: '12px', opacity: 0.65 }}>{doneOrders.map(renderOrderCard)}</div>}
                                </div>
                            )}
                        </div>
                    );
                })()}

                {/* 🖼️ TAB: ASSET GALLERY */}
                {activeTab === 'GALLERY' && (
                    <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '10px', minHeight: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
                        <AssetGalleryTab currentUser={operator?.name || 'Unknown'} activeBrand={activeBrand} />
                    </div>
                )}

                {/* 💬 TAB: MESSAGING */}
                {activeTab === 'MESSAGING' && (
                    <div style={{ background: '#fff', border: `1px solid ${theme.line}`, height: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
                        <SharedMessaging currentUser={operator?.name || 'Unknown'} currentApp="PICK_PACK" writeLog={writeLog} />
                    </div>
                )}

                {/* 🛠️ TAB: APP IMP — bug reports & improvement requests */}
                {activeTab === 'APP IMP' && (
                    <div style={{ background: '#fff', border: `1px solid ${theme.line}`, minHeight: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
                        <AppImprovementTab currentUser={operator?.name || 'Unknown'} currentApp="WMS" canManage={['admin', 'superadmin'].includes(safeUserRole)} />
                    </div>
                )}

            </main>
        </div>
    );
};

export default PickPackApp;