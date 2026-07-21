import React, { useState, useEffect, useRef } from 'react';
import { db, auth, functions, getOuterIdToken, storage } from '../../firebase';
import { collection, onSnapshot, doc, setDoc, updateDoc, getDoc, addDoc, deleteDoc, getDocs, query, where, serverTimestamp, deleteField, arrayUnion } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { signInWithCustomToken } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { CATEGORY_NAME_RX } from '../Shared/itemCodeMatch';
import SharedMessaging from '../Shared/SharedMessaging';
import AssetGalleryTab from '../Shared/AssetGalleryTab';
import { resolveByExactKey, normalizeKey } from '../Shared/workOrderContract';
import { printPlatingPackingList } from '../Shared/platingPackingList';
import { printItemLabel, printBinLabel } from '../Shared/labelPrint';
import { useRetiredSet } from '../Shared/retiredItems';
import { nsProxyFetch } from "../Shared/nsProxy";
import { enqueueNsWrite } from "../Shared/nsOutbox";

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
const TABS = ['QUEUE', 'STOCK', 'PACKING', 'COUNT', 'CONVERT', 'ROD CUTS', 'TRANSFER', 'PLATING', 'CHIPS', 'GALLERY', 'MESSAGING'];

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
const BRAND_NETSUITE_MAP = {
    'm2c': { subsidiary: "3", location: "19" },
    'uniquity': { subsidiary: "6", location: "20" },
    'ce': { subsidiary: "2", location: "17" },
    'leyla': { subsidiary: "5", location: "18" }
};

// --- LABEL PRINTING (device-aware) -------------------------------------------------------------
// Label routing: ZPL labels auto-print to a Zebra (e.g. ZP505, 2×4) via the Zebra BrowserPrint local
// agent when it's reachable; otherwise we fall back to the browser print dialog (the HTML label). A
// station can FORCE the dialog (skip the Zebra attempt) with localStorage 'labelPrintMode' = 'html'.

const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Minimal Code 128-B → SVG barcode (no external lib) so PC-printed labels stay scannable like the ZPL ones.
const CODE128B = ("212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112").split(' ');
const code128BSvg = (text) => {
    const s = String(text || '');
    const vals = [];
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c >= 32 && c <= 126) vals.push(c - 32); }
    if (!vals.length) return '';
    const codes = [104, ...vals];           // Start B
    let sum = 104; vals.forEach((v, i) => { sum += v * (i + 1); });
    codes.push(sum % 103, 106);             // checksum, Stop
    const widths = codes.map(c => CODE128B[c]).join('');
    const H = 10; let x = 0, rects = '';
    for (let i = 0; i < widths.length; i++) { const w = parseInt(widths[i], 10); if (i % 2 === 0) rects += `<rect x="${x}" y="0" width="${w}" height="${H}"/>`; x += w; }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x} ${H}" preserveAspectRatio="none" fill="#000">${rects}</svg>`;
};

// Render a label as a sized HTML page and send it to the browser print dialog. Uses a hidden iframe so
// it isn't blocked by pop-up blockers and prints only the label (its own @page size drives the paper).
const printHtmlLabel = ({ widthIn = 4, heightIn = 2, title = 'Label', html = '' }) => {
    const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>
@page{size:${widthIn}in ${heightIn}in;margin:0;}
html,body{margin:0;padding:0;}
.label{width:${widthIn}in;height:${heightIn}in;box-sizing:border-box;padding:0.1in 0.15in;font-family:Arial,Helvetica,sans-serif;color:#000;display:flex;flex-direction:column;overflow:hidden;}
.hdr{font-size:15pt;font-weight:800;letter-spacing:.4px;line-height:1.05;margin-bottom:1pt;}
.big{font-size:14pt;font-weight:800;line-height:1.1;}
.line{font-size:10.5pt;font-weight:600;line-height:1.22;}
.line b{font-weight:800;}
.bc{margin-top:auto;}
.bc svg{width:100%;height:0.42in;display:block;}
.bctxt{font-size:8pt;text-align:center;letter-spacing:2px;margin-top:1pt;}
</style></head><body><div class="label">${html}</div></body></html>`;
    try {
        const iframe = document.createElement('iframe');
        iframe.setAttribute('aria-hidden', 'true');
        iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
        document.body.appendChild(iframe);
        const cw = iframe.contentWindow;
        cw.document.open(); cw.document.write(doc); cw.document.close();
        const cleanup = () => { try { if (iframe.parentNode) document.body.removeChild(iframe); } catch (e) { /* already gone */ } };
        cw.onafterprint = cleanup;
        setTimeout(() => { try { cw.focus(); cw.print(); } catch (e) { console.warn('Label print failed:', e); } }, 250);
        setTimeout(cleanup, 60000); // fallback if onafterprint never fires
        return true;
    } catch (e) { console.warn('printHtmlLabel error:', e); return false; }
};

// Auto-print raw ZPL to a Zebra via the Zebra BrowserPrint local agent (USB/network printer, no dialog).
// Tries the HTTPS agent first (required when the app is served over HTTPS), then HTTP for localhost/dev.
// Each attempt is short-timed so a missing agent fails fast. Returns true only when a printer accepted it.
const printZplBrowserPrint = async (zpl) => {
    if (!zpl) return false;
    const bases = ['https://localhost:9101', 'https://127.0.0.1:9101', 'http://localhost:9100', 'http://127.0.0.1:9100'];
    for (const base of bases) {
        try {
            const ac = new AbortController();
            const t = setTimeout(() => ac.abort(), 1500);
            const dRes = await fetch(base + '/default', { method: 'GET', signal: ac.signal });
            clearTimeout(t);
            if (!dRes.ok) continue;
            const device = await dRes.json();
            const wRes = await fetch(base + '/write', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ device, data: zpl })
            });
            if (wRes.ok) return true;
        } catch (e) { /* agent not reachable on this base — try the next */ }
    }
    return false;
};

// Route a label: auto-print ZPL to the Zebra (BrowserPrint) when available, else the browser print
// dialog. Set localStorage 'labelPrintMode' = 'html' to force the dialog and skip the Zebra attempt.
const emitLabel = (zpl, htmlSpec) => {
    let forced = '';
    try { forced = (localStorage.getItem('labelPrintMode') || '').toLowerCase(); } catch (e) { /* localStorage unavailable */ }
    if (forced === 'html' || forced === 'pc') { printHtmlLabel(htmlSpec); return 'html'; }
    (async () => { const printed = await printZplBrowserPrint(zpl); if (!printed) printHtmlLabel(htmlSpec); })();
    return 'zebra';
};


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
const postConvertBuild = async ({ itemId, quantity, subsidiary, location, bin, toBin, memo }) => {
    if (!convertRestletConfigured()) throw new Error("The Convert RESTlet isn't configured yet. Deploy netsuite/ce_convert_build_restlet.js in NetSuite and give me its Script + Deploy ids.");
    const url = `${NS_RESTLET_HOST}/app/site/hosting/restlet.nl?script=${NS_CONVERT_RESTLET.scriptId}&deploy=${NS_CONVERT_RESTLET.deployId}`;
    const r = await nsProxyFetch({ targetUrl: url, method: 'POST', payload: { itemId, quantity, subsidiary, location, bin, toBin, memo } });
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
            const rows = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(o => o.brand === activeBrand);
            rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            setQuickShipOrders(rows);
        }, e => console.warn('quick ship orders listen failed', e));

        return () => { unsubParts(); unsubLists(); unsubPlating(); unsubFinishes(); unsubDemand(); unsubFees(); unsubBatch(); unsubQS(); };
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
        if (!window.confirm('Remove this sample-chip order?')) return;
        await deleteDoc(doc(db, "sample_chip_orders", id));
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
    const FEEISH_NAME_RE = /\b(FRENCH|MITERED|MITER|BENT)\s+RETURN\b|\bSPLICE\b|\bFEE\b/i;
    const lineIsFeeish = (l) => {
        if (l && (l.isFee || l.lineIsFee)) return true;
        const pid = String((l && (l.legacyErpId || l.partId)) || '');
        const hasRealId = pid && pid !== 'PENDING' && pid !== 'N/A' && pid !== 'UNASSIGNED' && !/(^|-)(FEE|HIDDEN)-/.test(pid);
        return !hasRealId && FEEISH_NAME_RE.test(String((l && l.name) || ''));
    };
    const pickableLines = (job) => (job.partsList || []).filter(l => !lineIsFeeish(l));
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
            list.forEach(c => { map[c] = { bins: [], total: 0, at: Date.now() }; });
            (j.items || []).forEach(row => {
                const id = String(row.legacy_id || '').toUpperCase();
                if (!map[id]) map[id] = { bins: [], total: 0, at: Date.now() };
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

    // ================= PACKING STATION (Stuart 2026-07-18) =================
    // Finished orders (currentPhase 'Complete', custom only) queue compactly up top; opening one
    // gives a two-sided workspace — TO PACK on the left, physically confirmed pieces move right.
    // Lines group by category in packing order (brackets → rings → finials → plates → other small
    // parts = the SMALL box, then poles = the LARGE box/tube), aligned to the standard boxes
    // defined on HQ → Packaging (tab 15). ≥1 photo of the packaged parts is required to complete.
    const [packOrderId, setPackOrderId] = useState(null);
    const [packUploading, setPackUploading] = useState(false);
    const [packBoxSel, setPackBoxSel] = useState({ SMALL: '', POLE: '' });
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
    const packLinesOf = (job) => {
        const out = [];
        if (isQsOrder(job)) {
            // Quick Ship SO: flat stocked lines (kit label kept so the packer sees the set).
            (job.lines || []).forEach((l, i) => {
                out.push({ key: `L${i}`, erp: l.erp || '', name: `${l.name || 'Item'}${l.kit ? ` · ${l.kit}` : ''}`, qty: Number(l.qty) || 1 });
            });
        } else if (job.orderType === 'stock') {
            // Stock build: what gets handled here is the FINISHED item going back to the shelf —
            // not the raw pull line the pick stage used.
            out.push({ key: 'STOCK', erp: job.stockErpId || job.type || '', name: `${job.stockErpId || job.type || 'Stock'} — finished stock, bin & shelve`, qty: Number(job.totalParts) || 1 });
        } else {
            (job.partsList || []).forEach((l, i) => {
                if (lineIsFeeish(l)) return;
                out.push({ key: `L${i}`, erp: l.legacyErpId || l.partId || '', name: l.partName || l.name || 'Part', qty: Number(l.quantity ?? l.qty) || 1 });
            });
            const poleQty = Number(job.totalPoles || (job.poles && job.poles.qty)) || 0;
            if (poleQty > 0) out.push({ key: 'POLES', erp: job.poles?.type || job.type || 'POLE', name: `Pole${poleQty === 1 ? '' : 's'} · ${job.poles?.type || job.type || ''}`, qty: poleQty, isPole: true });
        }
        return out.map(l => ({ ...l, cat: packCatOf(l) }));
    };
    const packRef = (j) => isQsOrder(j) ? `SO ${j.soId || j.id}` : (j.nsWoTran || j.displayId || j.woNum || j.id);
    const packQueue = [
        ...quickShipOrders.filter(o => o.status === 'Picked' && o.packStatus !== 'Packed'),
        // Custom orders AND stock builds (Stuart 2026-07-20): a finished stock build lands here
        // too — its "packing" is binning the finished goods back to the shelf, and this is the
        // only queue that keeps a completed WO visible after it leaves the finishing floor.
        ...finAll.filter(j => j.currentPhase === 'Complete' && j.packStatus !== 'Packed')
    ].sort((a, b) => (a.packedReadyAt || a.completedAt || a.createdAt || 0) - (b.packedReadyAt || b.completedAt || b.createdAt || 0));
    const packedRecent = [...finAll, ...quickShipOrders].filter(j => j.packStatus === 'Packed').sort((a, b) => (b.packedAt || 0) - (a.packedAt || 0)).slice(0, 6);

    const openPackOrder = (job) => {
        setPackOrderId(job.id);
        const brandBoxes = stdBoxes.filter(b => !b.brandId || b.brandId === 'global' || b.brandId === activeBrand);
        const small = brandBoxes.find(b => /small/i.test(b.name || ''));
        const large = brandBoxes.find(b => /pole|tube|large/i.test(b.name || ''));
        setPackBoxSel({
            SMALL: (job.packBoxes && job.packBoxes.SMALL) || (small ? small.name : ''),
            POLE: (job.packBoxes && job.packBoxes.POLE) || (large ? large.name : '')
        });
    };
    const confirmPackLine = async (job, line) => {
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
                            memo: `Packing scrap ${packRef(job)}: ${note}`,
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
    const completePacking = async (job) => {
        if (packCompletingRef.current) return;
        if (job.packStatus === 'Packed') return alert('This order is already packed.');
        const lines = packLinesOf(job);
        const left = lines.filter(l => !(job.packedLines && job.packedLines[l.key]));
        if (left.length) return alert(`Every piece must be physically packed and confirmed first — ${left.length} line${left.length === 1 ? '' : 's'} still on the TO PACK side.`);
        if (!(job.packPhotos || []).length) return alert('A photo of the packaged parts is required — tap 📷 Add Photo first.');
        if (!window.confirm(`Complete packing for ${packRef(job)}?\n\n${lines.length} line${lines.length === 1 ? '' : 's'} packed · ${(job.packPhotos || []).length} photo${(job.packPhotos || []).length === 1 ? '' : 's'}\nSmall parts box: ${packBoxSel.SMALL || '—'}\nPole box: ${packBoxSel.POLE || '—'}`)) return;
        packCompletingRef.current = true;
        try {
            await updateDoc(packDocOf(job), { packStatus: 'Packed', packedAt: Date.now(), packedBy: operator?.name || 'Packer', packBoxes: packBoxSel });
            writeLog(`Packed ${packRef(job)} (${lines.length} lines, ${(job.packPhotos || []).length} photos)`, 'packing');
            // PACKED → NETSUITE (Stuart 2026-07-18): transform the NetSuite SO into an Item
            // Fulfillment at status Packed (staged via the outbox — serial, retried, visible in
            // the RTG transmit log + 11.1). Shipping then executes/ships it IN NetSuite; the
            // ⤓ Tracking pull below brings the tracking # back onto the sales order.
            let nsNote = '';
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
                        payload: { shipStatus: { id: 'B' }, memo: `Packed in app by ${operator?.name || 'Packer'}` },
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
                    subsidiary: { id: nsConfig.subsidiary }, location: { id: nsConfig.location }, memo: memoText,
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
                    account: { id: "254" }, subsidiary: { id: nsConfig.subsidiary }, memo: memoText,
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
            const built = await postConvertBuild({ itemId: assemblyId, quantity: qty, subsidiary: nsConfig.subsidiary, location: nsConfig.location, bin: consumeBin, toBin: receiveBin, memo: memoText });

            alert(`✅ Assembly build #${built.id || ''} posted: +${qty} × ${erpOf(target)}, −${qty} × ${base.erpId} (consumed from ${consumeBin}, received into ${receiveBin}).`);
            writeLog(`Assembly Build (phosphate): +${qty} ${erpOf(target)} / -${qty} ${base.erpId}.${convertMemo.trim() ? ` Memo: ${convertMemo.trim()}` : ''}`, 'wms');
            setConvertBase(null); setConvertTargetId(""); setConvertTargetSearch(""); setConvertQty(""); setConvertSrcScan(""); setConvertDestScan(""); setConvertMemo(""); setConvertLot("");
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
                    memo: memoText,
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
        const memoText = `Rod cut by ${operator?.name || 'Unknown'}: ${o.qtySource} × ${o.sourceItemId} → ${o.qtyTarget} × ${o.targetItemId}${o.scrapFt ? ` (+${o.scrapFt} ft scrap)` : ''}${cutMemo.trim() ? ` — ${cutMemo.trim()}` : ''}`;
        try {
            setIsSyncing(true);
            await ensureBinExists(destBin, nsConfig.location);
            const r = await nsProxyFetch({
                targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/inventoryadjustment`,
                method: 'POST',
                payload: {
                    account: { id: "254" }, subsidiary: { id: nsConfig.subsidiary }, memo: memoText,
                    inventory: { items: [
                        { item: { id: String(o.sourceInternalId) }, location: { id: nsConfig.location }, adjustQtyBy: -o.qtySource, inventoryDetail: { quantity: -o.qtySource, inventoryAssignment: { items: [{ binNumber: { refName: srcBin }, quantity: -o.qtySource }] } } },
                        { item: { id: String(o.targetInternalId) }, location: { id: nsConfig.location }, adjustQtyBy: o.qtyTarget, inventoryDetail: { quantity: o.qtyTarget, inventoryAssignment: { items: [{ binNumber: { refName: destBin }, quantity: o.qtyTarget }] } } }
                    ] }
                }
            });
            const body = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(typeof body === 'object' ? JSON.stringify(body) : String(body));
            await updateDoc(doc(db, "rod_cut_orders", o.id), { status: 'DONE', sourceBin: srcBin, destBin, nsAdjustmentId: body.id || null, completedAt: Date.now(), completedBy: operator?.name || '' });
            writeLog(`Rod cut ${o.id}: -${o.qtySource} ${o.sourceItemId} (${srcBin}) → +${o.qtyTarget} ${o.targetItemId} (${destBin}).`, 'wms');
            alert(`✅ Rod cut posted to NetSuite:\n\n−${o.qtySource} × ${o.sourceItemId} from ${srcBin}\n+${o.qtyTarget} × ${o.targetItemId} into ${destBin}${o.scrapFt ? `\n(${o.scrapFt} ft scrap — not tracked)` : ''}`);
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
        const line = { lineId: `L${Date.now()}`, rawId: convertBase.id, rawErpId: convertBase.erpId, rawName: convertBase.itemName, rawInternalId: convertBase.netSuiteInternalId, targetErpId: erpOf(convTarget), targetName: convTarget.itemName, targetInternalId: convTarget.netSuiteInternalId || null, qty, srcBin: src, status: 'on_cart', newBin: '' };
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
            writeLog(`Phosphate cart: pulled ${qty}× ${convertBase.erpId} ${src} → ${bin}.`, 'wms');
            setConvertBase(null); setConvertTargetId(""); setConvertTargetSearch(""); setConvertQty(""); setConvertSrcScan(""); setConvertDestScan(""); setConvertMemo("");
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
            await postConvertBuild({ itemId: assembly.id, quantity: line.qty, subsidiary: nsConfig.subsidiary, location: nsConfig.location, bin: consumeBin, toBin: newBin, memo: `Phos convert ${convBatch.cartBin || ''}` });
            const lines = (convBatch.lines || []).map(l => l.lineId === line.lineId ? { ...l, status: 'converted', newBin, convertedAt: Date.now() } : l);
            await updateDoc(doc(db, "conversion_batches", convBatch.id), { lines, updatedAt: Date.now() });
            writeLog(`Phosphate convert: +${line.qty} ${line.targetErpId} / −${line.qty} ${line.rawErpId} (cart ${convBatch.cartBin || ''} → ${newBin || 'finished'}).`, 'wms');
            pullNetSuiteStock();
        } catch (e) { console.error('convert line failed', e); alert("❌ NetSuite rejected the build:\n\n" + (e.message || e) + "\n\nIf it still mentions the component list / inventory detail, the raw isn't in the cart bin in NetSuite yet (stage it first), or the field name differs (componentInventoryDetail) — paste the error and I'll correct it."); }
        finally { setIsSyncing(false); }
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
                    memo: memoText,
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
                qty, fromBin, platingBin, woNum: (platingWO || '').trim(), operator: operator?.name || 'Unknown', createdAt: serverTimestamp()
            }).catch(err => console.warn("plating_shipments log failed (is the firestore rule published?)", err)); // non-fatal: the NetSuite move already succeeded

            printPlatingLabel({ erpId: item.erpId, itemName: item.itemName, qty, woNum: platingWO, platingBin, finishCode, finishName: finish.name || '', targetErpId });
            alert(`✅ Pulled ${qty} × ${item.erpId} to plating WIP (${finishCode} → ${targetErpId}) — moved ${fromBin} → ${platingBin}, status WIP-Plating. Removed from Available.\n\n🖨️ 2×4 plating label spooled${(platingWO || '').trim() ? ` (WO ${(platingWO || '').trim()})` : ''}.`);
            writeLog(`Plating pull: ${qty} ${item.erpId} ${fromBin} -> ${platingBin} (WIP-Plating).${platingMemo.trim() ? ` Memo: ${platingMemo.trim()}` : ''}`, 'wms');
            // If this pull fulfilled a "Needs Plating" demand, clear it off the queue.
            if (platingDemandId) { await deleteDoc(doc(db, "plating_demand", platingDemandId)).catch(() => {}); }
            setPlatingBase(null); setPlatingSrcScan(""); setPlatingQty(""); setPlatingDestScan(""); setPlatingMemo(""); setPlatingWO(""); setPlatingFinish(""); setPlatingDemandId(null);
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
                    // subsidiary intentionally OMITTED — it derives from the (now-resolving) vendor, which is sub 2 (CE).
                    location: { id: nsConfig.location }, // High Point - CE = 17 (subsidiary 2)
                    memo: `Weekly Plating Shipment ${shipId}${finishSummary ? ` (${finishSummary})` : ''} — ${lines.length} items, ${pcs} pcs`,
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
                lines: lines.map(l => ({ erpId: l.erpId || '', itemName: l.itemName || '', finishCode: l.finishCode || '', targetErpId: l.targetErpId || '', platingBin: l.platingBin || '', woNum: l.woNum || '', qty: parseInt(l.qty) || 0 })),
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
            const payload = {
                targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/purchaseorder/${nsPoId}/!transform/itemreceipt`,
                method: 'POST',
                payload: { memo: `Plating return received — ${shipmentId}` }
            };
            const response = await nsProxyFetch(payload);
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(typeof result === 'object' ? JSON.stringify(result) : String(result));
            const receiptId = result.id ? String(result.id) : null;

            await Promise.all((lineIds || []).map(id => updateDoc(doc(db, "plating_shipments", id), {
                status: 'received', itemReceiptId: receiptId, receivedAt: serverTimestamp()
            }).catch(() => {})));

            alert(`✅ Plating shipment ${shipmentId} received in NetSuite${receiptId ? ` (item receipt #${receiptId})` : ''}. Lines are ready for build-back.`);
            writeLog(`Plating receive: shipment ${shipmentId} → item receipt ${receiptId || 'n/a'} (PO ${nsPoId}).`, 'wms');
        } catch (e) {
            console.error("Plating receive (item receipt) failed:", e);
            alert("❌ NetSuite rejected the item receipt:\n\n" + (e.message || e) + "\n\nFirst item receipt we've posted (PO→receipt transform) — if it names a path/field, paste it and I'll correct it (may need createdFrom instead of the transform URL).");
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
            await Promise.all(poSnap.docs.map(d => deleteDoc(d.ref).catch(() => {})));
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
    const reversePlatingWip = async (line, nsConfig, memo) => {
        const qty = parseInt(line.qty) || 0;
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
            await deleteDoc(doc(db, "plating_shipments", line.id));
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

    // --- PHASE 4b: BUILD BACK THE PLATED PART (received raw → finished plated assembly) ---
    // Two NetSuite writes: (1) reverse the Phase-2 status move so the returned raw is available again
    // (WIP-Plating(13)@platingBin → Good(1)@fromBin), then (2) assembly-build the plated finished good
    // (targetErpId = erpId/finishCode, e.g. H1-138EC/EP1), which auto-consumes the raw from its BOM.
    // The reversal is guarded by `wipReversed` so a retry after a failed build can't double-reverse.
    const pushPlatingBuildBack = async (line) => {
        if (!line) return;
        const qty = parseInt(line.qty) || 0;
        if (qty <= 0) return alert("This line has no quantity to build.");
        const target = line.targetErpId || (line.finishCode ? `${line.erpId}/${String(line.finishCode).toUpperCase()}` : '');
        if (!target) return alert("This line has no plated finish/target assembly — it predates finish assignment. Reset & re-pull it with a finish.");
        const nsConfig = BRAND_NETSUITE_MAP[activeBrand];
        if (!nsConfig) return alert("NetSuite routing configuration missing for this brand.");
        if (!window.confirm(`Build back ${qty} × ${target}?\n\nReturns the plated raw ${line.erpId} to Good (from WIP-Plating) and builds the finished assembly, consuming the raw.`)) return;
        try {
            setIsSyncing(true);
            // 1) Reverse the status move (guarded so a retry can't double-reverse) — WIP-Plating@platingBin → Good@fromBin.
            if (!line.wipReversed) {
                await reversePlatingWip(line, nsConfig, `Plating return → Good (${line.finishCode || ''}) ${line.erpId}`);
                await updateDoc(doc(db, "plating_shipments", line.id), { wipReversed: true }).catch(() => {});
            }
            // 2) Build the plated assembly (auto-consumes the now-Good raw from its BOM). Plated assemblies are
            // bin-managed (the bin syncs from NetSuite into the app), so assign the built units to that bin.
            const assembly = await resolveItemDetail(target);
            if (!assembly) throw new Error(`Couldn't find ${target} in NetSuite by item id. Confirm the plated assembly exists with ${line.erpId} as a BOM component.`);
            if (assembly.type && !/assembl/i.test(assembly.type)) throw new Error(`${target} is type "${assembly.type}" in NetSuite, not an Assembly. It needs to be an Assembly/BOM with ${line.erpId} as a component.`);
            const targetPart = hqParts.find(p => erpOf(p) === target.toUpperCase());
            const targetBin = targetPart ? binOf(targetPart) : '';
            const buildPayload = {
                targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/assemblybuild`,
                method: 'POST',
                payload: {
                    item: { id: assembly.id },
                    subsidiary: { id: nsConfig.subsidiary },
                    quantity: qty,
                    location: { id: nsConfig.location },
                    memo: `Plating build-back ${target} (${line.finishCode || ''})${line.shipmentId ? ` — shipment ${line.shipmentId}` : ''}`,
                    // bin-managed finished assembly → place the built units into its synced bin
                    ...(targetBin && targetBin !== 'UNASSIGNED' ? { inventoryDetail: { quantity: qty, inventoryAssignment: { items: [{ binNumber: { refName: targetBin }, quantity: qty }] } } } : {})
                }
            };
            const br = await nsProxyFetch(buildPayload);
            const bb = await br.json().catch(() => ({}));
            if (!br.ok) throw new Error("Assembly build failed: " + (typeof bb === 'object' ? JSON.stringify(bb) : String(bb)));
            await updateDoc(doc(db, "plating_shipments", line.id), { status: 'built', builtAt: serverTimestamp(), builtAssemblyId: bb.id ? String(bb.id) : null }).catch(() => {});
            alert(`✅ Built back ${qty} × ${target} — plated raw returned to Good and consumed into the finished assembly.`);
            writeLog(`Plating build-back: ${qty} ${target} (raw ${line.erpId}) built; WIP-Plating → Good reversed.`, 'wms');
            pullNetSuiteStock();
        } catch (e) {
            console.error("Plating build-back failed:", e);
            alert("❌ Build-back problem:\n\n" + (e.message || e) + "\n\nThe WIP→Good reversal is guarded, so retrying won't double-reverse. If it says \"configure the inventory detail\", either the plated assembly's bin didn't resolve (sync/map its bin in the library) or it's also lot-numbered — paste the message and I'll adjust.");
        } finally {
            setIsSyncing(false);
        }
    };

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
        if (parseInt(validation.qty) !== lineQty(lineItem)) {
            return alert(`❌ Quantity Mismatch. Expected ${lineQty(lineItem)}.`);
        }

        setValidation({ bin: '', qty: '' });

        if (currentPickLine + 1 < activePickJob.partsList.length) {
            setCurrentPickLine(prev => prev + 1);
        } else {
            completePick(pickSkips);
        }
    };

    // Finish the pick (from the last confirmed line OR a skip of the last line). When lines were
    // skipped, the order is stamped so staging/HQ can fix it — the parts still went to staging,
    // just short the skipped line(s).
    const completePick = (skips) => {
        setShowNacho(true);
        setTimeout(async () => {
            const patch = { pickStatus: 'Picked_Awaiting_Staging' };
            if (skips && skips.length) { patch.pickSkips = skips; patch.pickHadSkips = true; }
            await updateDoc(doc(db, "fin_workorders", activePickJob.id), patch);
            writeLog(`Order Picked: ${activePickJob.id}${(skips && skips.length) ? ` — ⚠ ${skips.length} line(s) SKIPPED (fix at staging): ${skips.map(s => s.itemId || s.name).join(', ')}` : ''}`, 'wms');
            printZebraLabel(activePickJob, 'SMALL_PARTS');
            setActivePickJob(null);
            setPickSkips([]);
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
            completePick(nextSkips);
        }
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
            if (job.customFabStatus !== 'Complete') {
                return alert(`❌ ${packRef(job)}: custom parts not yet complete in the shop (status: ${job.customFabStatus || 'Pending'}). Wait for the shop to finish + label them.`);
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

    const printZebraLabel = (job, type) => {
        // Real ZPL printing is Phase 2. The staging handshake matches on orderKey, so for now
        // surface it (operators can hand-key it into the staging scans during floor testing).
        console.log(`[label:${type}] orderKey=${job.orderKey || job.id}`);
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
                    <button onClick={() => { setActivePickJob(null); setPickSkips([]); setValidation({ bin: '', qty: '' }); }} style={{ background: 'transparent', color: theme.inkSoft, border: `1px solid ${theme.line}`, padding: '15px 30px', fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.2s' }} onMouseOver={(e) => { e.currentTarget.style.color = theme.ink; e.currentTarget.style.borderColor = theme.ink; }} onMouseOut={(e) => { e.currentTarget.style.color = theme.inkSoft; e.currentTarget.style.borderColor = theme.line; }}>ABORT PICK</button>
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
                            
                            <a href={line.assetUrl || '#'} target="_blank" rel="noreferrer" style={{ display: 'inline-block', background: 'transparent', border: `1px solid ${theme.line}`, color: theme.ink, padding: '15px 30px', fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.1em', textDecoration: 'none', textTransform: 'uppercase', transition: 'all 0.2s' }} onMouseOver={(e) => e.currentTarget.style.borderColor = theme.brass} onMouseOut={(e) => e.currentTarget.style.borderColor = theme.line}>
                                OPEN REFERENCE PHOTO
                            </a>
                        </div>

                        <div style={{ flex: 1, background: '#fff', padding: '40px', border: `1px solid ${theme.brass}`, boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
                            <h2 style={{ margin: '0 0 30px 0', fontFamily: theme.serif, fontSize: '2rem', color: theme.ink, fontWeight: 500 }}>Target Qty: {lineQty(line)}</h2>
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
                            </form>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: theme.paper, fontFamily: theme.sans }}>
            
            <header style={{ backgroundColor: '#fff', borderBottom: `1px solid ${theme.line}`, padding: '18px 30px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    {TABS.filter(t => myTabs.includes(t)).map(tab => (
                        <button key={tab} onClick={() => setActiveTab(tab)} style={{ padding: '10px 16px', background: 'transparent', color: activeTab === tab ? theme.ink : theme.inkSoft, borderBottom: activeTab === tab ? `2px solid ${theme.brass}` : '2px solid transparent', borderTop: 'none', borderLeft: 'none', borderRight: 'none', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.2s' }}>
                            {tab.replace('QUEUE', 'PICK QUEUE').replace('PACKING', 'PACKAGING PREP').replace('GALLERY', 'ASSET GALLERY').replace('COUNT', 'BIN COUNT')}
                        </button>
                    ))}
                    <div style={{ width: '1px', background: theme.line, height: '20px', margin: '0 10px' }}></div>
                    <button onClick={handleLogout} style={{ padding: '8px 16px', fontSize: '10px', fontFamily: theme.mono, letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer', background: theme.ink, color: '#fff', border: 'none', transition: 'background 0.2s' }} onMouseOver={(e) => e.currentTarget.style.background = theme.brass} onMouseOut={(e) => e.currentTarget.style.background = theme.ink}>HUB / LOGOUT</button>
                </div>
            </header>

            <main style={{ flex: 1, padding: '30px', overflowY: 'auto' }}>
                
                {/* 📦 TAB: PICK QUEUE */}
                {activeTab === 'QUEUE' && (
                    <div style={{ display: 'flex', gap: '30px', height: '100%' }}>
                        <div style={{ flex: 1, background: '#fff', border: `1px solid ${theme.line}`, display: 'flex', flexDirection: 'column', boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
                            <div style={{ padding: '20px', borderBottom: `1px solid ${theme.line}`, fontFamily: theme.serif, color: theme.ink, fontWeight: 500, fontSize: '1.4rem' }}>Awaiting Pick (Small Parts)</div>
                            <div style={{ padding: '20px', overflowY: 'auto' }}>
                                {jobs.filter(j => j.pickStatus === 'Pending').map(job => {
                                    const so = soIndex[String(job.salesOrderId || '')] || soIndex[String(job.orderKey || '')] || null;
                                    const customer = job.customerName || job.clientName || so?.customer || '';
                                    const sidemark = so?.memo || job.note || '';
                                    const poNum = so?.poNum || so?.po || so?.otherrefnum || '';
                                    const pickable = pickableLines(job);
                                    return (
                                    <div key={job.id} style={{ border: `1px solid ${theme.line}`, marginBottom: '15px' }}>
                                        {/* Header row toggles the BOM detail; START PICKING stops propagation. */}
                                        <div onClick={() => { const opening = expandedJob !== job.id; setExpandedJob(opening ? job.id : null); if (opening) fetchLiveBins(pickable.map(l => l.legacyErpId || l.partId)); }} style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', cursor: 'pointer' }}>
                                            <div style={{ minWidth: 0 }}>
                                                <h3 style={{ margin: 0, fontFamily: theme.serif, fontSize: '1.2rem', fontWeight: 500 }}>
                                                    <span style={{ color: theme.inkSoft, fontFamily: theme.mono, fontSize: '0.9rem', marginRight: '8px' }}>{expandedJob === job.id ? '▾' : '▸'}</span><span title={job.id}>{packRef(job)}</span>
                                                </h3>
                                                {customer && <div style={{ color: theme.ink, fontFamily: theme.sans, fontSize: '0.95rem', fontWeight: 500, marginTop: '5px' }}>{customer}</div>}
                                                {(sidemark || poNum) && (
                                                    <div style={{ color: theme.inkSoft, fontFamily: theme.mono, fontSize: '10px', marginTop: '3px', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                                                        {sidemark ? `REF: ${sidemark}` : ''}{sidemark && poNum ? '  ·  ' : ''}{poNum ? `PO: ${poNum}` : ''}
                                                    </div>
                                                )}
                                                <div style={{ color: theme.inkSoft, fontFamily: theme.mono, fontSize: '11px', marginTop: '5px' }}>{pickable.length} Line Items{pickable.length !== (job.partsList?.length || 0) ? ` (${(job.partsList?.length || 0) - pickable.length} return/fee line(s) ride the shop order)` : ''} · tap for parts</div>
                                            </div>
                                            <button onClick={(e) => { e.stopPropagation(); setActivePickJob({ ...job, partsList: pickable }); setCurrentPickLine(0); setPickSkips([]); setValidation({ bin: '', qty: '' }); fetchLiveBins(pickable.map(l => l.legacyErpId || l.partId)); }} style={{ padding: '10px 20px', background: theme.ink, color: '#fff', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', border: 'none', cursor: 'pointer', transition: 'background 0.2s', whiteSpace: 'nowrap' }} onMouseOver={(e) => e.currentTarget.style.background = theme.brass} onMouseOut={(e) => e.currentTarget.style.background = theme.ink}>
                                                START PICKING
                                            </button>
                                        </div>
                                        {expandedJob === job.id && (
                                            <div style={{ borderTop: `1px solid ${theme.line}`, background: theme.paper, padding: '8px 20px 16px' }}>
                                                <div style={{ fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.1em', textTransform: 'uppercase', color: theme.inkSoft, display: 'flex', gap: '12px', alignItems: 'center', padding: '10px 0 6px', borderBottom: `1px solid ${theme.line}` }}>
                                                    <span style={{ flex: 1 }}>Part</span><span style={{ width: '130px' }}>Bin (live)</span><span style={{ width: '40px', textAlign: 'right' }}>Qty</span>
                                                    <button onClick={() => fetchLiveBins(pickable.map(l => l.legacyErpId || l.partId))} title="Re-pull live per-bin stock from NetSuite" style={{ background: 'transparent', border: `1px solid ${theme.line}`, color: theme.ink, padding: '3px 8px', fontFamily: theme.mono, fontSize: '9px', cursor: 'pointer' }}>⟳ Live</button>
                                                </div>
                                                {pickable.length === 0 && <div style={{ padding: '12px 0', fontFamily: theme.sans, fontSize: '0.85rem', color: theme.inkSoft, fontStyle: 'italic' }}>No pickable parts on this order.</div>}
                                                {pickable.map((l, i) => (
                                                    <div key={i} style={{ display: 'flex', gap: '12px', alignItems: 'baseline', padding: '8px 0', borderBottom: `1px solid ${theme.line}` }}>
                                                        <div style={{ flex: 1, minWidth: 0 }}>
                                                            <span style={{ fontFamily: theme.mono, fontSize: '11px', fontWeight: 600, color: theme.ink }}>{l.legacyErpId || l.partId || '—'}</span>
                                                            <span style={{ fontFamily: theme.sans, fontSize: '0.85rem', color: theme.inkSoft, marginLeft: '8px' }}>{l.name}</span>
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
                                {jobs.filter(j => j.pickStatus === 'Pending').length === 0 && (
                                    <div style={{ color: theme.inkSoft, fontStyle: 'italic', fontFamily: theme.serif }}>No orders currently require picking.</div>
                                )}
                            </div>
                        </div>

                        <div style={{ width: '400px', background: '#fff', border: `1px solid ${theme.line}`, display: 'flex', flexDirection: 'column', boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
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
                                    {jobs.filter(j => j.pickStatus === 'Picked_Awaiting_Staging').map(job => {
                                        const custReady = !job.hasCustomSibling || job.customFabStatus === 'Complete';
                                        return (
                                            <div key={job.id} style={{ background: theme.paper, border: `1px solid ${theme.line}`, padding: '12px', marginBottom: '8px', fontSize: '0.9rem', fontFamily: theme.mono, color: theme.ink, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span>{job.id}</span>
                                                <span style={{ fontSize: '0.72rem', color: custReady ? '#3a7d44' : theme.brass }}>
                                                    {!job.hasCustomSibling ? '● small-only' : (custReady ? '● custom ready' : '○ awaiting shop')}
                                                </span>
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
                    const open = quickShipOrders.filter(o => (o.status || 'Pending') !== 'Shipped');
                    const shipped = quickShipOrders.filter(o => o.status === 'Shipped');
                    const Card = ({ o }) => (
                        <div style={{ border: `1px solid ${theme.line}`, marginBottom: '16px', background: '#fff' }}>
                            <div style={{ padding: '14px 18px', borderBottom: `1px solid ${theme.line}`, background: theme.paper, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                    <span style={{ fontFamily: theme.serif, fontSize: '1.2rem', color: theme.ink, fontWeight: 500 }}>{o.customer || 'Customer'}</span>
                                    <span style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, marginLeft: '12px' }}>SO {o.soId || o.id} · {o.totalParts || 0} pcs{o.jobName ? ` · ${o.jobName}` : ''}</span>
                                </div>
                                <span style={{ fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: o.status === 'Shipped' ? '#3a7d44' : (o.status === 'Picked' ? theme.brass : theme.inkSoft) }}>{o.status || 'Pending'}</span>
                            </div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                <thead><tr style={{ background: theme.paper2 }}>
                                    {['Item #', 'Description', 'Bin', 'Qty'].map(h => <th key={h} style={{ textAlign: h === 'Qty' ? 'center' : 'left', padding: '8px 18px', fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', color: theme.inkSoft, borderBottom: `1px solid ${theme.line}` }}>{h}</th>)}
                                </tr></thead>
                                <tbody>
                                    {(o.lines || []).map((l, i) => (
                                        <tr key={i}>
                                            <td style={{ padding: '9px 18px', fontFamily: theme.mono, color: theme.ink, borderBottom: `1px solid ${theme.paper2}` }}>{l.erp || '—'}</td>
                                            <td style={{ padding: '9px 18px', color: theme.inkSoft, borderBottom: `1px solid ${theme.paper2}` }}>{l.name}{l.note ? ` · ${l.note}` : ''}{(() => { const pk = packOf(l); return pk ? <span style={{ color: theme.brass, fontFamily: theme.mono, fontSize: '10px' }}> → pull {(Number(l.qty) || 0) * pk.size} × {pk.singleErp}</span> : null; })()}</td>
                                            <td style={{ padding: '9px 18px', fontFamily: theme.mono, color: l.bin ? theme.ink : theme.inkSoft, borderBottom: `1px solid ${theme.paper2}` }}>{l.bin || 'UNASSIGNED'}</td>
                                            <td style={{ padding: '9px 18px', textAlign: 'center', fontWeight: 500, color: theme.ink, borderBottom: `1px solid ${theme.paper2}` }}>{l.qty}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {o.status !== 'Shipped' && (
                                <div style={{ padding: '12px 18px', display: 'flex', gap: '10px', justifyContent: 'flex-end', alignItems: 'center', borderTop: `1px solid ${theme.line}` }}>
                                    {o.packStatus === 'Packed'
                                        ? <span style={{ marginRight: 'auto', fontFamily: theme.mono, fontSize: '10px', color: '#3a7d44' }}>📦 Packed · {(o.packPhotos || []).length} photo{(o.packPhotos || []).length === 1 ? '' : 's'} · {o.packedBy || ''}{o.nsIfTran ? ` · IF ${o.nsIfTran}${o.nsFulfillStatus ? ` (${o.nsFulfillStatus})` : ''}` : (o.nsFulfillQueued ? ' · IF queued…' : '')}{(o.trackingNumbers || []).length ? ` · 🚚 ${o.trackingNumbers.join(', ')}` : ''}</span>
                                        : (o.status === 'Picked' && <span style={{ marginRight: 'auto', fontFamily: theme.mono, fontSize: '10px', color: theme.brass }}>→ in the PACKING tab queue</span>)}
                                    {o.packStatus === 'Packed' && <button onClick={() => pullFulfillment(o)} title="Pull fulfillment status + tracking # from NetSuite" style={{ padding: '9px 14px', background: 'transparent', color: theme.ink, border: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>⤓ Tracking</button>}
                                    {o.status !== 'Picked' && <button onClick={() => setQSStatus(o, 'Picked')} style={{ padding: '9px 18px', background: 'transparent', color: theme.ink, border: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>Mark Picked</button>}
                                    <button onClick={() => setQSStatus(o, 'Shipped')} style={{ padding: '9px 18px', background: theme.ink, color: '#fff', border: 'none', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>Mark Shipped</button>
                                </div>
                            )}
                        </div>
                    );
                    return (
                        <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '30px', minHeight: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
                            <div style={{ fontFamily: theme.serif, color: theme.ink, fontWeight: 500, fontSize: '1.4rem', marginBottom: '6px' }}>Stock / Quick Ship Orders</div>
                            <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, letterSpacing: '.05em', marginBottom: '24px' }}>Pre-finished stocked goods — pick off the shelf. Separate from custom orders.</div>
                            {open.length === 0 && <div style={{ color: theme.inkSoft, fontStyle: 'italic', fontFamily: theme.serif }}>No open stock orders.</div>}
                            {open.map(o => <Card key={o.id} o={o} />)}
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
                    const canComplete = packJob && toPack.length === 0 && photos.length > 0;
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
                                <div style={{ fontFamily: theme.mono, fontSize: '0.85rem', color: theme.ink }}>{l.erp || '—'}</div>
                                <div style={{ fontSize: '0.8rem', color: theme.inkSoft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</div>
                                {side === 'right' && packJob.packedLines[l.key] && <div style={{ fontFamily: theme.mono, fontSize: '9px', color: '#3a7d44', marginTop: '2px' }}>✓ {packJob.packedLines[l.key].by} · {new Date(packJob.packedLines[l.key].at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>}
                            </div>
                            <span style={{ fontFamily: theme.mono, fontWeight: 'bold', fontSize: '1rem', color: theme.ink, whiteSpace: 'nowrap' }}>× {l.qty}</span>
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
                                <h2 style={{ color: theme.ink, fontFamily: theme.serif, fontWeight: 500, margin: 0 }}>Packing Station</h2>
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
                                        <button key={j.id} onClick={() => active ? setPackOrderId(null) : openPackOrder(j)} style={{ background: active ? theme.ink : theme.paper, color: active ? '#fff' : theme.ink, border: `1px solid ${active ? theme.ink : theme.line}`, padding: '10px 14px', cursor: 'pointer', textAlign: 'left' }}>
                                            <div style={{ fontFamily: theme.mono, fontSize: '0.85rem', fontWeight: 'bold' }}>{packRef(j)}{isQsOrder(j) && <span style={{ fontSize: '8px', letterSpacing: '.1em', color: active ? '#fff' : theme.brass, border: `1px solid ${active ? 'rgba(255,255,255,0.5)' : theme.brass}`, padding: '1px 5px', marginLeft: '8px', verticalAlign: 'middle' }}>QUICK SHIP</span>}{j.orderType === 'stock' && <span style={{ fontSize: '8px', letterSpacing: '.1em', color: active ? '#fff' : '#3a7d44', border: `1px solid ${active ? 'rgba(255,255,255,0.5)' : '#3a7d44'}`, padding: '1px 5px', marginLeft: '8px', verticalAlign: 'middle' }}>STOCK → BIN</span>}</div>
                                            <div style={{ fontFamily: theme.sans, fontSize: '0.75rem', color: active ? 'rgba(255,255,255,0.75)' : theme.inkSoft }}>
                                                {j.customerName || j.clientName || j.customer || '—'} · {jl.length} line{jl.length === 1 ? '' : 's'}{done > 0 ? ` · ${done}/${jl.length} packed` : ''}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>

                            {/* WORKSPACE — TO PACK left, physically confirmed pieces move right */}
                            {packJob ? (
                                <>
                                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap', padding: '12px 16px', background: theme.paper2, border: `1px solid ${theme.line}`, marginBottom: '16px' }}>
                                        <span style={{ fontFamily: theme.serif, fontSize: '1.2rem', color: theme.ink, fontWeight: 500 }}>{packRef(packJob)}</span>
                                        <span style={{ fontFamily: theme.sans, fontSize: '0.85rem', color: theme.inkSoft }}>{packJob.customerName || packJob.clientName || packJob.customer || ''}{packJob.recipe ? ` · ${packJob.recipe}` : ''}</span>
                                        {Number(packJob.packScrap) > 0 && <span style={{ fontFamily: theme.mono, fontSize: '10px', color: '#d9534f', border: '1px solid #d9534f', padding: '3px 8px' }}>⚠ {packJob.packScrap} scrap reported</span>}
                                        <span style={{ marginLeft: 'auto', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                                            {boxSelect('SMALL', 'Small parts box')}
                                            {boxSelect('POLE', 'Pole box')}
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
                                            {packUploading ? '⏳ Uploading…' : '📷 Add Photo (required)'}
                                            <input type="file" accept="image/*" capture="environment" multiple style={{ display: 'none' }} onChange={e => { uploadPackPhotos(packJob, e.target.files); e.target.value = ''; }} />
                                        </label>
                                        {photos.map((u, i) => <img key={i} src={u} alt={`packed ${i + 1}`} onClick={() => window.open(u, '_blank')} style={{ height: '54px', width: '76px', objectFit: 'cover', border: `1px solid ${theme.line}`, cursor: 'zoom-in' }} />)}
                                        {photos.length === 0 && <span style={{ fontFamily: theme.sans, fontSize: '0.85rem', color: '#d9534f' }}>No photo yet — a photo of the packaged parts is required.</span>}
                                        {!isQsOrder(packJob) && (
                                            <button onClick={() => reportPackScrap(packJob)} title="Found bad pieces while bagging? Record scrap — stock builds queue the −qty NetSuite adjustment, customs red-flag the finishing supervisor" style={{ marginLeft: 'auto', background: 'transparent', color: '#d9534f', border: '1px solid #d9534f', padding: '14px 18px', fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>
                                                ⚠ Report Scrap
                                            </button>
                                        )}
                                        <button onClick={() => completePacking(packJob)} disabled={!canComplete} style={{ marginLeft: isQsOrder(packJob) ? 'auto' : '0', background: canComplete ? theme.ink : theme.paper2, color: canComplete ? '#fff' : theme.inkSoft, border: `1px solid ${canComplete ? theme.ink : theme.line}`, padding: '14px 26px', fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: canComplete ? 'pointer' : 'default' }}>
                                            ✓ Complete Packing
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
                                            <span style={{ fontFamily: theme.mono, color: theme.ink }}>{packRef(j)}</span>
                                            <span>{j.customerName || j.clientName || j.customer || ''}</span>
                                            <span style={{ fontFamily: theme.mono, fontSize: '10px', color: j.nsIfTran ? '#3a7d44' : theme.inkSoft }}>
                                                {j.nsIfTran ? `IF ${j.nsIfTran}${j.nsFulfillStatus ? ` · ${j.nsFulfillStatus}` : ''}` : (j.nsFulfillQueued ? 'IF queued…' : '')}
                                            </span>
                                            {(j.trackingNumbers || []).length > 0 && <span style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.ink }}>🚚 {j.trackingNumbers.join(', ')}</span>}
                                            <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <span style={{ fontFamily: theme.mono, fontSize: '10px' }}>{j.packedBy || ''} · {j.packedAt ? new Date(j.packedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''} · {(j.packPhotos || []).length} 📷</span>
                                                <button onClick={() => pullFulfillment(j)} title="Pull fulfillment status + tracking # from NetSuite" style={{ background: 'transparent', border: `1px solid ${theme.line}`, color: theme.ink, padding: '5px 10px', fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', cursor: 'pointer' }}>⤓ Tracking</button>
                                                {!isQsOrder(j) && <button onClick={() => reportPackScrap(j)} title="Bad pieces found after packing — record scrap" style={{ background: 'transparent', border: '1px solid #d9534f', color: '#d9534f', padding: '5px 10px', fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', cursor: 'pointer' }}>⚠ Scrap</button>}
                                            </span>
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
                                <div style={{ background: '#fff', padding: '40px', width: '800px', maxHeight: '90vh', overflowY: 'auto', border: `1px solid ${theme.line}`, boxShadow: '0 4px 24px rgba(0,0,0,0.1)' }}>
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
                                            return (
                                                <tr key={line.lineId} style={{ borderBottom: `1px solid ${theme.line}`, opacity: done ? 0.55 : 1 }}>
                                                    <td style={{ padding: '10px 12px' }}><div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>{line.rawErpId}</div><div style={{ color: theme.ink }}>{line.rawName}</div></td>
                                                    <td style={{ padding: '10px 12px', fontFamily: theme.mono }}>{line.qty}</td>
                                                    <td style={{ padding: '10px 12px', fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>{line.srcBin} → {convBatch.cartBin}</td>
                                                    <td style={{ padding: '10px 12px', fontFamily: theme.mono, fontSize: '11px', color: theme.ink }}>{line.targetErpId}</td>
                                                    <td style={{ padding: '10px 12px' }}>{done ? <span style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.brass }}>{line.newBin || '—'}</span> : <input value={cartBinEdits[line.lineId] ?? line.newBin ?? ''} onChange={e => setCartBinEdits(prev => ({ ...prev, [line.lineId]: e.target.value.toUpperCase() }))} placeholder="bin…" style={{ width: '100px', padding: '6px', fontFamily: theme.mono, fontSize: '11px', border: `1px solid ${theme.line}`, textAlign: 'center', outline: 'none' }} />}</td>
                                                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>{done ? <span style={{ fontFamily: theme.mono, fontSize: '10px', color: '#2f7d3b', textTransform: 'uppercase' }}>Converted ✓</span> : <button onClick={() => convertCartLine(line)} disabled={isSyncing} style={{ padding: '8px 14px', background: theme.brass, color: '#fff', border: 'none', cursor: isSyncing ? 'wait' : 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase' }}>Convert ▸</button>}</td>
                                                </tr>
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
                                <div style={{ background: '#fff', padding: '40px', width: '720px', maxHeight: '90vh', overflowY: 'auto', border: `1px solid ${theme.line}`, boxShadow: '0 4px 24px rgba(0,0,0,0.1)' }}>
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
                                        <button onClick={() => { setConvertBase(null); setConvertTargetId(""); setConvertTargetSearch(""); setConvertQty(""); setConvertSrcScan(""); setConvertDestScan(""); setConvertMemo(""); setConvertLot(""); }} style={{ padding: '15px 30px', background: 'transparent', border: `1px solid ${theme.line}`, cursor: 'pointer', fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase' }}>Cancel</button>
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
                                                <button onClick={() => { setConvertBase(item); setConvertTargetId(""); setConvertTargetSearch(""); setConvertQty(""); setConvertSrcScan(""); setConvertDestScan(""); setConvertMemo(""); setConvertLot(new Date().toLocaleDateString('en-CA')); }} style={{ padding: '10px 18px', background: theme.ink, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Convert →</button>
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
                {/* ✂ TAB: ROD CUTS (cut 8 ft rods down to 6 ft / 4 ft — scan source bin, confirm cut, scan dest bin) */}
                {activeTab === 'ROD CUTS' && (() => {
                    const cuts = rodCutOrders.filter(o => (o.brand || 'ce') === activeBrand);
                    const openCuts = cuts.filter(o => o.status === 'OPEN').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
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
                                        <div style={{ background: '#fff', padding: '40px', width: '720px', maxHeight: '92vh', overflowY: 'auto', border: `1px solid ${theme.line}`, boxShadow: '0 4px 24px rgba(0,0,0,0.1)' }}>
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

                            {/* OPEN ORDERS */}
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
                                <div style={{ background: '#fff', padding: '40px', width: '680px', maxHeight: '90vh', overflowY: 'auto', border: `1px solid ${theme.line}`, boxShadow: '0 4px 24px rgba(0,0,0,0.1)' }}>
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
                {activeTab === 'PLATING' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '30px', height: '100%' }}>

                        {/* NEEDS PLATING — to-dos routed from the Library WO tool (base in stock → plate it) */}
                        {!platingBase && platingDemands.length > 0 && (
                            <div style={{ background: '#fff', border: `1px solid #7d9a6f`, padding: '20px' }}>
                                <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '12px' }}>Needs Plating · {platingDemands.length} item{platingDemands.length === 1 ? '' : 's'} routed from HQ</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {platingDemands.map(d => (
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
                                            }} disabled={isSyncing} style={{ padding: '10px 16px', background: '#5e7d54', color: '#fff', border: 'none', cursor: isSyncing ? 'wait' : 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' }}>Pull &amp; Plate →</button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* PULL MODAL */}
                        {platingBase && (
                            <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.8)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <div style={{ background: '#fff', padding: '40px', width: '680px', maxHeight: '90vh', overflowY: 'auto', border: `1px solid ${theme.line}`, boxShadow: '0 4px 24px rgba(0,0,0,0.1)' }}>
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
                                                        {isPlatingAdmin && <button onClick={() => resetPlatingShipment(g.shipmentId, g.lines.map(l => l.id))} disabled={isSyncing} title="Admin only — sends the shipment back to staged" style={{ padding: '10px 12px', background: 'transparent', color: theme.inkSoft, border: `1px solid ${theme.line}`, cursor: isSyncing ? 'wait' : 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' }}>Reset</button>}
                                                        <button onClick={() => pushPlatingReceive(g.shipmentId, g.nsPoId, g.lines.map(l => l.id))} disabled={isSyncing} style={{ padding: '10px 16px', background: theme.brass, color: '#fff', border: 'none', cursor: isSyncing ? 'wait' : 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' }}>Receive PO → Item Receipt</button>
                                                    </div>
                                                </div>
                                                {open && (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '0 14px 14px' }}>
                                                        {g.lines.map(l => (
                                                            <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>
                                                                <span>{l.erpId} — {l.itemName}</span>
                                                                <span>{l.qty} @ {l.platingBin}</span>
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

                        {/* RETURNED FROM PLATER — BUILD BACK (Phase 4b) */}
                        {platingReceived.length > 0 && (() => {
                            const groups = Object.values(platingReceived.reduce((a, l) => { (a[l.shipmentId || l.id] = a[l.shipmentId || l.id] || { shipmentId: l.shipmentId || l.id, lines: [] }).lines.push(l); return a; }, {}));
                            return (
                                <div style={{ background: '#fff', border: `1px solid #7d9a6f`, padding: '20px' }}>
                                    <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '12px' }}>Returned — ready to build back · {platingReceived.length} line{platingReceived.length === 1 ? '' : 's'}</div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                        {groups.map(g => (
                                            <div key={g.shipmentId} style={{ border: `1px solid ${theme.line}`, padding: '14px' }}>
                                                <div style={{ fontFamily: theme.mono, fontSize: '12px', color: theme.ink, marginBottom: '8px' }}>{g.shipmentId} · {g.lines.length} line{g.lines.length === 1 ? '' : 's'}</div>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                    {g.lines.map(l => {
                                                        const tgt = l.targetErpId || (l.finishCode ? `${l.erpId}/${String(l.finishCode).toUpperCase()}` : '');
                                                        // Preflight: does the plated assembly exist in the brand library (synced from NS), and what bin?
                                                        const tgtPart = tgt ? hqParts.find(p => erpOf(p) === tgt.toUpperCase()) : null;
                                                        const tgtBin = tgtPart ? binOf(tgtPart) : '';
                                                        return (
                                                            <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', borderTop: `1px solid ${theme.line}`, paddingTop: '8px' }}>
                                                                <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.ink }}>
                                                                    {l.erpId} → <span style={{ color: theme.brass }}>{tgt || '— no finish on line'}</span> · {l.qty} pcs{l.wipReversed ? ' · ✓ back in Good' : ''}
                                                                    {tgt && (tgtPart
                                                                        ? <span style={{ color: theme.inkSoft }}> · → {tgtBin && tgtBin !== 'UNASSIGNED' ? `bin ${tgtBin}` : <span style={{ color: '#c0392b' }}>no bin ⚠</span>}</span>
                                                                        : <span style={{ color: '#c0392b' }}> · ⚠ assembly not in library — sync from NetSuite first</span>)}
                                                                </div>
                                                                <button onClick={() => pushPlatingBuildBack(l)} disabled={isSyncing || !tgt} style={{ padding: '10px 16px', background: !tgt ? theme.paper2 : '#5e7d54', color: !tgt ? theme.inkSoft : '#fff', border: 'none', cursor: isSyncing ? 'wait' : (!tgt ? 'not-allowed' : 'pointer'), fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' }}>
                                                                    {isSyncing ? '…' : (tgt ? `Build ${tgt}` : 'No finish')}
                                                                </button>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })()}

                        {/* SHIP PALLET MODAL */}
                        {showShipModal && (
                            <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.8)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <div style={{ background: '#fff', padding: '40px', width: '760px', maxHeight: '90vh', overflowY: 'auto', border: `1px solid ${theme.line}`, boxShadow: '0 4px 24px rgba(0,0,0,0.1)' }}>
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

            </main>
        </div>
    );
};

export default PickPackApp;