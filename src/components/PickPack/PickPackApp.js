import React, { useState, useEffect } from 'react';
import { db, auth, functions } from '../../firebase';
import { collection, onSnapshot, doc, updateDoc, getDoc, addDoc, deleteDoc, getDocs, query, where, serverTimestamp } from "firebase/firestore";
import { signInWithCustomToken } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import SharedMessaging from '../Shared/SharedMessaging';
import AssetGalleryTab from '../Shared/AssetGalleryTab';
import { resolveByExactKey, normalizeKey } from '../Shared/workOrderContract';

const theme = { paper: '#faf8f4', paper2: '#f2efe8', ink: '#1c1a16', inkSoft: '#524e46', brass: '#b08d57', line: 'rgba(28,26,22,.14)', serif: "'Cormorant Garamond', Georgia, serif", sans: "'Inter', -apple-system, sans-serif", mono: "'IBM Plex Mono', monospace" };

// TABS updated to include COUNT
const TABS = ['QUEUE', 'PACKING', 'COUNT', 'CONVERT', 'TRANSFER', 'PLATING', 'GALLERY', 'MESSAGING'];
const FIREBASE_FUNCTION_URL = "https://netsuiteproxy-f3h3jadzaq-uc.a.run.app";

// NetSuite Mapping Dictionary
const BRAND_NETSUITE_MAP = {
    'm2c': { subsidiary: "3", location: "19" },
    'uniquity': { subsidiary: "6", location: "22" },
    'ce': { subsidiary: "2", location: "17" },
    'leyla': { subsidiary: "5", location: "18" }
};

// --- LABEL PRINTING (device-aware) -------------------------------------------------------------
// PCs print 2x4 labels in LANDSCAPE via the browser print dialog, honoring whatever printer settings
// the PC already has. Tablets ZPL-autoprint (wired up later — currently logs the ZPL). A station can
// pin its mode with localStorage 'labelPrintMode' = 'pc' | 'tablet' if auto-detection guesses wrong.
const detectPrintMode = () => {
    try { const o = (localStorage.getItem('labelPrintMode') || '').toLowerCase(); if (o === 'pc' || o === 'tablet') return o; } catch (e) { /* localStorage unavailable */ }
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    const touch = ((typeof navigator !== 'undefined' && navigator.maxTouchPoints) || 0) > 1;
    const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && touch); // iPadOS 13+ reports as a Mac
    const androidTablet = /Android/.test(ua) && !/Mobile/.test(ua);
    const otherTablet = /Tablet|PlayBook|Silk|Kindle|Nexus (7|9|10)/.test(ua);
    return (iPad || androidTablet || otherTablet) ? 'tablet' : 'pc';
};

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

// Route a label to the right device. Returns the mode used.
const emitLabel = (zpl, htmlSpec) => {
    const mode = detectPrintMode();
    if (mode === 'tablet') {
        // TODO: real ZPL autoprint (Zebra BrowserPrint SDK / local print bridge). Stub until set up.
        console.log("[label] tablet ZPL (autoprint pending):", zpl);
    } else {
        printHtmlLabel(htmlSpec); // PC: browser print dialog, landscape 2x4, PC's own printer settings
    }
    return mode;
};

// Bin / ERP-id helpers (raw items carry binLocation top-level after mapping; library docs nest it under manufacturingSpecs).
const binOf = (p) => (p?.binLocation || p?.manufacturingSpecs?.binLocation || 'UNASSIGNED');
const erpOf = (p) => String(p?.legacyErpId || p?.itemId || '').toUpperCase();
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

const PickPackApp = ({ activeBrand = "ce", setActiveBrand }) => {
    const [operator, setOperator] = useState(null);
    const [pinInput, setPinInput] = useState("");
    const [activeTab, setActiveTab] = useState('QUEUE');
    const [perms, setPerms] = useState({});
    const [jobs, setJobs] = useState([]);
    
    // Picking & Staging State
    const [activePickJob, setActivePickJob] = useState(null);
    const [currentPickLine, setCurrentPickLine] = useState(0);
    const [validation, setValidation] = useState({ bin: '', qty: '' });
    // §A2: the staging handshake is a two-label verify — small-parts label + custom (shop) label.
    const [stagingSmallScan, setStagingSmallScan] = useState('');
    const [stagingCustomScan, setStagingCustomScan] = useState('');
    const [showNacho, setShowNacho] = useState(false);

    // Counting State
    const [hqParts, setHqParts] = useState([]);
    const [nsStock, setNsStock] = useState({});
    const [isSyncing, setIsSyncing] = useState(false);
    const [physicalCounts, setPhysicalCounts] = useState({});
    const [binEdits, setBinEdits] = useState({}); // per-item bin reassignment during a count; a new bin is created in NetSuite on push
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

    // Counting Filter State
    const [searchQuery, setSearchQuery] = useState("");
    const [typeFilter, setTypeFilter] = useState("");
    const [collectionFilter, setCollectionFilter] = useState("");
    const [watchlistFilter, setWatchlistFilter] = useState("");
    const [globalLists, setGlobalLists] = useState({});

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
            setPlatingStaged(all.filter(s => s.status === 'staged'));
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

        return () => { unsubParts(); unsubLists(); unsubPlating(); unsubFinishes(); unsubDemand(); };
    }, [activeBrand]);

    const attemptLogin = async (e) => {
        e.preventDefault();
        if (!pinInput) return;
        try {
            // 🔐 Same secure flow as HQ: mint a custom token server-side, then sign in.
            const authenticatePin = httpsCallable(functions, 'authenticatePin');
            const result = await authenticatePin({ pin: pinInput });
            const { token, user: userData } = result.data;

            await signInWithCustomToken(auth, token);

            if (pinInput === "1032") {
                setOperator(userData);
                setPerms({ admin: TABS });
            } else {
                const pSnap = await getDoc(doc(db, "pick_config", "permissions"));
                const pData = pSnap.exists() ? pSnap.data() : {};
                setPerms(pData);
                setOperator(userData);
                const r = userData.role ? userData.role.toLowerCase() : 'operator';
                setActiveTab(pData[r]?.includes('QUEUE') ? 'QUEUE' : (pData[r]?.[0] || 'QUEUE'));
            }
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
                
                for (let i = 0; i < erpIds.length; i += chunkSize) {
                    const chunk = erpIds.slice(i, i + chunkSize);
                    const idList = chunk.map(id => `'${id.replace(/'/g, "''")}'`).join(',');

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
                    
                    const response = await fetch(FIREBASE_FUNCTION_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`,
                            method: 'POST',
                            payload: { q }
                        })
                    });
                    
                    const result = await response.json();
                    if (!response.ok) throw new Error(JSON.stringify(result));
                    if (result.items) allResults = allResults.concat(result.items);
                }
                
                const stockMap = {};
                allResults.forEach(row => {
                    if (row.legacy_id) stockMap[row.legacy_id.toUpperCase()] = { onHand: parseInt(row.onhand) || 0 };
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
            const r = await fetch(FIREBASE_FUNCTION_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`,
                    method: 'POST',
                    payload: { q: `SELECT ${cols} FROM item WHERE UPPER(itemid) = '${name.toUpperCase().replace(/'/g, "''")}'` }
                })
            });
            const b = await r.json().catch(() => ({}));
            return (r.ok && b.items && b.items.length) ? b.items[0] : null;
        };
        const row = (await run('id, itemtype')) || (await run('id')); // fall back if itemtype column is unavailable
        return row ? { id: String(row.id), type: String(row.itemtype || '') } : null;
    };

    const ensureBinExists = async (binNumber, locationId) => {
        const response = await fetch(FIREBASE_FUNCTION_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/bin`,
                method: 'POST',
                payload: { binNumber: (binNumber || '').toUpperCase(), location: { id: locationId } }
            })
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
        const adjustments = baseFilteredItems.map(item => {
            if (physicalCounts[item.id] === undefined) return null;
            const delta = physicalCounts[item.id] - item.onHand;
            if (delta === 0) return null;
            // Don't send a Firestore doc id as a NetSuite item ref — skip unmapped items (they'd 400).
            if (!item.netSuiteInternalId) { skipped.push(item.itemName || item.erpId || item.id); return null; }
            const storedBin = (item.binLocation || '').trim();
            const effBin = ((binEdits[item.id] ?? item.binLocation) || '').trim().toUpperCase();
            return {
                internalId: item.netSuiteInternalId,
                docId: item.id,
                binNumber: effBin,
                // operator typed a different bin than the item's stored one → create it in NetSuite + write it back
                binChanged: effBin !== '' && effBin.toUpperCase() !== storedBin.toUpperCase(),
                adjustQtyBy: delta
            };
        }).filter(Boolean);

        if (adjustments.length === 0) {
            return alert(skipped.length
                ? `No pushable adjustments — ${skipped.length} counted item(s) have no NetSuite Internal ID. Map them first (HQ → ERP Mapping Audit / Mass Update):\n\n${skipped.slice(0, 12).join('\n')}${skipped.length > 12 ? `\n…+${skipped.length - 12} more` : ''}`
                : "No variances found to adjust.");
        }

        const nsConfig = BRAND_NETSUITE_MAP[activeBrand];
        if (!nsConfig) return alert("NetSuite routing configuration missing for this brand.");

        try {
            setIsSyncing(true);

            // Create any newly-assigned bins in NetSuite (idempotent) and write the bin back onto the item
            // so the CONVERT / plating flows pick it up. Done before the adjustment so the bin resolves.
            const newBins = [...new Set(adjustments.filter(a => a.binChanged).map(a => a.binNumber))];
            for (const bin of newBins) { await ensureBinExists(bin, nsConfig.location); }
            await Promise.all(adjustments.filter(a => a.binChanged).map(a =>
                updateDoc(doc(db, "Approved_Designs", a.docId), { "manufacturingSpecs.binLocation": a.binNumber }).catch(() => {})
            ));

            // Stamp who ran the count (app operator) + their note into the NetSuite memo field.
            const memoText = `Cycle count by ${operator?.name || 'Unknown'}${countMemo.trim() ? ` — ${countMemo.trim()}` : ''}`;
            const payload = {
                targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/inventoryadjustment`,
                method: 'POST',
                payload: {
                    account: { id: "254" }, // NetSuite Inventory Adjustment Account internal id
                    subsidiary: { id: nsConfig.subsidiary },
                    memo: memoText,
                    // REST sublist for adjustment lines is `inventory` (NOT `inventoryList` — that's the
                    // legacy SOAP name; REST ignores it and reports "must enter at least one line item").
                    inventory: {
                        items: adjustments.map(adj => ({
                            item: { id: adj.internalId },
                            location: { id: nsConfig.location }, // location is a LINE field on REST adjustments
                            adjustQtyBy: adj.adjustQtyBy,
                            // Bin-tracked item: the detail qty and the bin assignment must reconcile to the
                            // line's signed adjustQtyBy. Bin referenced by refName (its bin number string).
                            inventoryDetail: {
                                quantity: adj.adjustQtyBy,
                                inventoryAssignment: {
                                    items: [{ binNumber: { refName: adj.binNumber }, quantity: adj.adjustQtyBy }]
                                }
                            }
                        }))
                    }
                }
            };

            const response = await fetch(FIREBASE_FUNCTION_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(typeof result === 'object' ? JSON.stringify(result) : String(result));

            alert(`✅ Inventory adjusted in NetSuite (${adjustments.length} line${adjustments.length === 1 ? '' : 's'}).${skipped.length ? `\n\n⚠️ Skipped ${skipped.length} counted item(s) with no NetSuite Internal ID.` : ''}`);
            writeLog(`Pushed Inventory Adjustment for ${adjustments.length} lines.${countMemo.trim() ? ` Memo: ${countMemo.trim()}` : ''}`, 'wms');
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
            const payload = {
                targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/assemblybuild`,
                method: 'POST',
                payload: {
                    item: { id: assemblyId }, // the assembly being built
                    subsidiary: { id: nsConfig.subsidiary },
                    quantity: qty,
                    location: { id: nsConfig.location },
                    memo: memoText,
                    // Lot/serial-numbered assemblies need an inventory number on the built units → send it via
                    // receiptInventoryNumber when a lot # is entered. Plain (untracked) assemblies omit this, and
                    // this /P assembly isn't bin-managed so no bin. Components auto-consume from the BOM.
                    ...(convertLot.trim() ? {
                        inventoryDetail: {
                            quantity: qty,
                            inventoryAssignment: { items: [{ receiptInventoryNumber: convertLot.trim(), quantity: qty }] }
                        }
                    } : {})
                }
            };

            const response = await fetch(FIREBASE_FUNCTION_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(typeof result === 'object' ? JSON.stringify(result) : String(result));

            alert(`✅ Assembly build posted: +${qty} × ${erpOf(target)}, −${qty} × ${base.erpId} (consumed from ${srcBin}).\n\nPlace the finished stock in bin ${destBin}. (This assembly isn't bin-tracked in NetSuite, so the bin is for your reference.)`);
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
                targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/bintransfer`,
                method: 'POST',
                payload: {
                    location: { id: nsConfig.location },
                    memo: memoText,
                    inventory: {
                        items: [{
                            item: { id: item.netSuiteInternalId },
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

            const response = await fetch(FIREBASE_FUNCTION_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
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
    // NetSuite REST has no inventorystatuschange record, so we move the qty with a STATUS-AWARE inventory
    // adjustment: two offsetting lines — -qty out of Good(1)@source bin and +qty into WIP-Plating(13)@plating
    // bin. Net on-hand unchanged; available drops (WIP-Plating is non-available). Logs a staged shipment line.
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
            const payload = {
                targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/inventoryadjustment`,
                method: 'POST',
                payload: {
                    account: { id: "254" }, // Inventory Adjustment account
                    subsidiary: { id: nsConfig.subsidiary },
                    memo: memoText,
                    inventory: {
                        items: [
                            { // out of Good (available) at the source bin
                                item: { id: item.netSuiteInternalId },
                                location: { id: nsConfig.location },
                                adjustQtyBy: -qty,
                                inventoryDetail: {
                                    quantity: -qty,
                                    inventoryAssignment: { items: [{ binNumber: { refName: fromBin }, inventoryStatus: { id: goodId }, quantity: -qty }] }
                                }
                            },
                            { // into WIP-Plating (non-available) at the plating bin
                                item: { id: item.netSuiteInternalId },
                                location: { id: nsConfig.location },
                                adjustQtyBy: qty,
                                inventoryDetail: {
                                    quantity: qty,
                                    inventoryAssignment: { items: [{ binNumber: { refName: platingBin }, inventoryStatus: { id: wipId }, quantity: qty }] }
                                }
                            }
                        ]
                    }
                }
            };

            const response = await fetch(FIREBASE_FUNCTION_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
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
            console.error("Plating status-change push failed:", e);
            alert("❌ NetSuite rejected the plating pull:\n\n" + (e.message || e) + "\n\nThis posts a status-aware inventory adjustment (Good→WIP-Plating) — if it names a field (inventoryStatus / inventoryDetail / account), paste it and I'll correct the REST shape.");
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
        // plating $/ea defaults to the item's outsourced Base Cost (manufacturingSpecs.cost) unless overridden
        const rateOf = (l) => { const v = shipCosts[l.id]; return v !== undefined ? (parseFloat(v) || 0) : (parseFloat(hqParts.find(p => p.id === l.itemId)?.manufacturingSpecs?.cost) || 0); };
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
            const lineDetail = lines.map(l => {
                const wo = l.woNum ? ` · WO# ${l.woNum}` : '';
                const tgt = l.targetErpId ? ` → ${l.targetErpId}` : '';
                const finx = l.finishCode ? ` · FINISH ${l.finishCode}` : '';
                return `• ${l.itemName || 'Item'} [${l.erpId || ''}${tgt}]${finx} — qty ${parseInt(l.qty) || 0}${wo}`;
            }).join('\n');
            const lineDescription = `Weekly Plating Shipment (${shipId})${finishSummary ? ` — finish ${finishSummary}` : ''} — ${lines.length} item${lines.length === 1 ? '' : 's'}, ${pcs} pcs:\n${lineDetail}`;
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
            const response = await fetch(FIREBASE_FUNCTION_URL, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(typeof result === 'object' ? JSON.stringify(result) : String(result));
            // NetSuite record POSTs return 204 with the new internal id ONLY in the Location header (which the proxy
            // doesn't forward), so result.id is usually empty. Recover the PO's internal id via SuiteQL by its unique
            // memo (shipId) — Phase 4a receive needs this id to transform the PO into an item receipt.
            let nsPoId = result.id ? String(result.id) : null;
            let nsPoTran = result.tranId || null; // human-readable PO number, e.g. "PO2179"
            if (!nsPoId || !nsPoTran) {
                try {
                    const lookup = await fetch(FIREBASE_FUNCTION_URL, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`,
                            method: 'POST',
                            payload: { q: `SELECT id, tranid FROM transaction WHERE type = 'PurchOrd' AND UPPER(memo) LIKE '%${shipId.toUpperCase()}%'` }
                        })
                    });
                    const lr = await lookup.json().catch(() => ({}));
                    if (lr.items && lr.items[0]) {
                        if (lr.items[0].id) nsPoId = String(lr.items[0].id);
                        if (lr.items[0].tranid) nsPoTran = String(lr.items[0].tranid);
                    }
                } catch (lookupErr) { console.warn("PO id lookup failed (PO still created):", lookupErr); }
            }
            const nsPoLabel = nsPoTran || nsPoId || '(pending sync)';

            // 2) Detailed app-side PO for the plater (only reached after the NS PO succeeded).
            await addDoc(collection(db, "hq_purchase_orders"), {
                poId: shipId, brand: activeBrand, vendor: vendorName, nsVendorId, status: "Sent to Plater", kind: "plating",
                nsPoId, nsPoTran, shipmentId: shipId,
                items: lines.map(l => ({ itemId: l.erpId, description: l.itemName, finishCode: l.finishCode || '', targetErpId: l.targetErpId || '', quantity: parseInt(l.qty) || 0, rate: rateOf(l), woNum: l.woNum || '', platingBin: l.platingBin })),
                total: Number(total.toFixed(2)), pcs, createdBy: operator?.name || 'Unknown', createdAt: serverTimestamp()
            }).catch(err => console.warn("app PO log failed", err));

            // 3) Flip the staged lines to 'shipped' (Phase 4 receives against this shipment).
            await Promise.all(lines.map(l => updateDoc(doc(db, "plating_shipments", l.id), {
                status: 'shipped', shipmentId: shipId, nsPoId, nsPoTran, platingRate: rateOf(l), shippedAt: serverTimestamp()
            }).catch(() => {})));

            // 4) Pallet/shipment label.
            printShipmentLabel({ shipId, vendor: vendorName, pcs, lineCount: lines.length, total, finishes: finishSummary });

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
            const response = await fetch(FIREBASE_FUNCTION_URL, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
            });
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
        if (!window.confirm(`Reset shipment ${shipmentId}? Its line(s) go back to "staged" so you can re-ship. (The WIP-Plating inventory move stays as-is.)`)) return;
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
        const r = await fetch(FIREBASE_FUNCTION_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
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
            const br = await fetch(FIREBASE_FUNCTION_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildPayload) });
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
        const expectedBin = lineItem.binLocation || 'UNASSIGNED';

        if (validation.bin.toUpperCase() !== expectedBin.toUpperCase() && expectedBin !== 'UNASSIGNED') {
            return alert("❌ Incorrect Bin Scanned! Please verify location.");
        }
        if (parseInt(validation.qty) !== lineItem.qty) {
            return alert(`❌ Quantity Mismatch. Expected ${lineItem.qty}.`);
        }

        setValidation({ bin: '', qty: '' });
        
        if (currentPickLine + 1 < activePickJob.partsList.length) {
            setCurrentPickLine(prev => prev + 1);
        } else {
            setShowNacho(true);
            setTimeout(async () => {
                await updateDoc(doc(db, "fin_workorders", activePickJob.id), { pickStatus: 'Picked_Awaiting_Staging' });
                writeLog(`Order Picked: ${activePickJob.id}`, 'wms');
                printZebraLabel(activePickJob, 'SMALL_PARTS');
                setActivePickJob(null);
                setShowNacho(false);
                setOperator(null);
            }, 2000);
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
            return alert(`❌ ${job.id}: small parts are not picked yet (status: ${job.pickStatus || 'Pending'}).`);
        }

        // Orders with a custom (shop) half must pass the two-label verify; small-only orders skip it.
        if (job.hasCustomSibling) {
            if (!custKey) return alert(`📋 ${job.id} has custom shop parts — scan the CUSTOM (shop) label too.`);
            if (smallKey !== custKey) {
                return alert(`🛑 DIFFERENT ORDERS — DO NOT MIX.\n\nSmall-parts label: ${smallKey}\nCustom label: ${custKey}\n\nSeparate these before staging.`);
            }
            if (job.customFabStatus !== 'Complete') {
                return alert(`❌ ${job.id}: custom parts not yet complete in the shop (status: ${job.customFabStatus || 'Pending'}). Wait for the shop to finish + label them.`);
            }
        }

        await updateDoc(doc(db, "fin_workorders", job.id), {
            pickStatus: 'Staged_Ready_For_Finishing',
            stagingStatus: 'MATCHED',
            stagedAt: serverTimestamp()
        });
        writeLog(`Order Staged & Matched: ${job.id}`, 'wms');
        alert(`✅ MATCH CONFIRMED: ${job.id} is staged and ready for the Finishing floor.`);
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
        const term = searchQuery.toLowerCase();
        const specs = part.manufacturingSpecs || {};
        const erpId = (part.legacyErpId || part.itemId || "").toUpperCase();

        const matchesSearch = !term
            || part.itemName?.toLowerCase().includes(term)
            || erpId.toLowerCase().includes(term)
            || (part.itemId || "").toLowerCase().includes(term)
            || (specs.binLocation || "").toLowerCase().includes(term);
        const matchesType = typeFilter === "" || (specs.productType || "").toUpperCase() === typeFilter.toUpperCase();
        const matchesCollection = collectionFilter === "" || collectionsOf(specs).includes(collectionFilter.toUpperCase());
        const matchesWatchlist = watchlistFilter === "" || watchlistOf(specs) === watchlistFilter.toUpperCase();

        const isInventory = part.partClass === "Inventory"; // count stock whether we make it (in-house) or buy it (outsourced)

        return matchesSearch && matchesType && matchesCollection && matchesWatchlist && isInventory;
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

    // CONVERT derived: resolve target assembly (by /P convention or manual pick) + readiness gates
    const convTarget = (convertTargetId && hqParts.find(p => p.id === convertTargetId))
        || (convertBase && hqParts.find(p => erpOf(p) === `${convertBase.erpId}/P`))
        || null;
    const convQtyNum = parseInt(convertQty) || 0;
    const convSrcOk = !!convertBase && binOf(convertBase) !== 'UNASSIGNED' && convertSrcScan.trim().toUpperCase() === binOf(convertBase).toUpperCase();
    const convDestOk = !!convTarget && binOf(convTarget) !== 'UNASSIGNED' && convertDestScan.trim().toUpperCase() === binOf(convTarget).toUpperCase();
    const convReady = !!convertBase && !!convertBase.netSuiteInternalId && !!convTarget && !!convTarget.netSuiteInternalId && convQtyNum > 0 && convQtyNum <= convertBase.onHand && convSrcOk && convDestOk;
    const convTargetMatches = convertTargetSearch.trim().length >= 2
        ? hqParts.filter(p => p.id !== convertBase?.id && (erpOf(p).includes(convertTargetSearch.trim().toUpperCase()) || (p.itemName || '').toLowerCase().includes(convertTargetSearch.trim().toLowerCase()))).slice(0, 8)
        : [];

    // BIN TRANSFER derived: readiness gates
    const xferQtyNum = parseInt(transferQty) || 0;
    const xferFrom = (transferSrcScan || '').trim();
    const xferTo = (transferDestScan || '').trim();
    const xferSrcKnown = !!transferBase && binOf(transferBase) !== 'UNASSIGNED' && xferFrom.toUpperCase() === binOf(transferBase).toUpperCase();
    const xferReady = !!transferBase && !!transferBase.netSuiteInternalId && xferQtyNum > 0 && xferQtyNum <= transferBase.onHand && xferFrom !== '' && xferTo !== '' && xferFrom.toUpperCase() !== xferTo.toUpperCase();

    // PLATING WIP derived: readiness gates
    const platQtyNum = parseInt(platingQty) || 0;
    const platFrom = (platingSrcScan || '').trim();
    const platTo = (platingDestScan || '').trim();
    const platSrcKnown = !!platingBase && binOf(platingBase) !== 'UNASSIGNED' && platFrom.toUpperCase() === binOf(platingBase).toUpperCase();
    const platReady = !!platingBase && !!platingBase.netSuiteInternalId && !!platingFinish && platQtyNum > 0 && platQtyNum <= platingBase.onHand && platFrom !== '' && platTo !== '' && platFrom.toUpperCase() !== platTo.toUpperCase();
    // Finishes valid for THIS part/brand = those whose plated assembly (base/CODE) exists in the active-brand
    // library (hqParts is brand-scoped, so EP* resolve on CE, MEP* on M2C). Falls back to all finishes if none
    // of the targets are synced yet, so the operator is never stuck — the build-back still validates the assembly.
    const platingFinishOptions = (() => {
        if (!platingBase) return [];
        const base = erpOf(platingBase);
        const valid = outsourceFinishes.filter(f => hqParts.some(p => erpOf(p) === `${base}/${finishCodeOf(f)}`));
        return valid.length ? valid : outsourceFinishes;
    })();

    // Plating shipment cost helpers: $/ea defaults to the item's outsourced Base Cost (manufacturingSpecs.cost).
    const platingBaseCost = (l) => parseFloat(hqParts.find(p => p.id === l.itemId)?.manufacturingSpecs?.cost) || 0;
    const platingRateFor = (l) => { const v = shipCosts[l.id]; return v !== undefined ? (parseFloat(v) || 0) : platingBaseCost(l); };

    const safeUserRole = operator?.role ? operator.role.toLowerCase() : 'operator';
    const myTabs = ['admin', 'superadmin'].includes(safeUserRole) ? TABS : (perms[safeUserRole] || perms['operator'] || TABS);

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
                    <h1 style={{ margin: 0, fontSize: '2.5rem', fontFamily: theme.serif, fontWeight: 500, color: theme.ink }}>Picking: {activePickJob.id}</h1>
                    <button onClick={() => setActivePickJob(null)} style={{ background: 'transparent', color: theme.inkSoft, border: `1px solid ${theme.line}`, padding: '15px 30px', fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.2s' }} onMouseOver={(e) => { e.currentTarget.style.color = theme.ink; e.currentTarget.style.borderColor = theme.ink; }} onMouseOut={(e) => { e.currentTarget.style.color = theme.inkSoft; e.currentTarget.style.borderColor = theme.line; }}>ABORT PICK</button>
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
                            <div style={{ fontSize: '3rem', fontWeight: 300, color: theme.ink, margin: '20px 0', fontFamily: theme.serif }}>{line.name}</div>
                            <div style={{ fontSize: '1.2rem', fontFamily: theme.mono, color: theme.brass, marginBottom: '40px' }}>BIN: {line.binLocation || 'UNASSIGNED'}</div>
                            
                            <a href={line.assetUrl || '#'} target="_blank" rel="noreferrer" style={{ display: 'inline-block', background: 'transparent', border: `1px solid ${theme.line}`, color: theme.ink, padding: '15px 30px', fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.1em', textDecoration: 'none', textTransform: 'uppercase', transition: 'all 0.2s' }} onMouseOver={(e) => e.currentTarget.style.borderColor = theme.brass} onMouseOut={(e) => e.currentTarget.style.borderColor = theme.line}>
                                OPEN REFERENCE PHOTO
                            </a>
                        </div>

                        <div style={{ flex: 1, background: '#fff', padding: '40px', border: `1px solid ${theme.brass}`, boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
                            <h2 style={{ margin: '0 0 30px 0', fontFamily: theme.serif, fontSize: '2rem', color: theme.ink, fontWeight: 500 }}>Target Qty: {line.qty}</h2>
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
                            <option value="leyla">Leyla Gans</option>
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
                                {jobs.filter(j => j.pickStatus === 'Pending').map(job => (
                                    <div key={job.id} style={{ border: `1px solid ${theme.line}`, padding: '20px', marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div>
                                            <h3 style={{ margin: 0, fontFamily: theme.serif, fontSize: '1.2rem', fontWeight: 500 }}>{job.id}</h3>
                                            <div style={{ color: theme.inkSoft, fontFamily: theme.mono, fontSize: '11px', marginTop: '5px' }}>{job.partsList?.length || 0} Line Items</div>
                                        </div>
                                        <button onClick={() => { setActivePickJob(job); setCurrentPickLine(0); }} style={{ padding: '10px 20px', background: theme.ink, color: '#fff', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', border: 'none', cursor: 'pointer', transition: 'background 0.2s' }} onMouseOver={(e) => e.currentTarget.style.background = theme.brass} onMouseOut={(e) => e.currentTarget.style.background = theme.ink}>
                                            START PICKING
                                        </button>
                                    </div>
                                ))}
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

                {/* 🏷️ TAB: PACKAGING PREP */}
                {activeTab === 'PACKING' && (
                    <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '30px', minHeight: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
                        <h2 style={{ borderBottom: `1px solid ${theme.line}`, paddingBottom: '15px', color: theme.ink, fontFamily: theme.serif, fontWeight: 500, margin: '0 0 30px 0' }}>Packaging Prep Queue</h2>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
                            {jobs.filter(j => j.pickStatus === 'Staged_Ready_For_Finishing').map(job => (
                                <div key={job.id} style={{ border: `1px solid ${theme.line}`, padding: '20px', background: theme.paper }}>
                                    <h3 style={{ margin: '0 0 10px 0', color: theme.ink, fontFamily: theme.serif, fontWeight: 500, fontSize: '1.3rem' }}>{job.id}</h3>
                                    <div style={{ fontFamily: theme.mono, fontSize: '0.85rem', color: theme.ink }}>Dims: {job.dimensions?.length || 0}"L x {job.dimensions?.width || 0}"W</div>
                                    <div style={{ fontSize: '0.85rem', color: theme.inkSoft, marginTop: '10px' }}>Review box sizes & tube lengths to prep materials while finishing cures.</div>
                                </div>
                            ))}
                            {jobs.filter(j => j.pickStatus === 'Staged_Ready_For_Finishing').length === 0 && (
                                <div style={{ gridColumn: '1 / -1', color: theme.inkSoft, fontStyle: 'italic', fontFamily: theme.serif }}>No orders currently awaiting packaging prep.</div>
                            )}
                        </div>
                    </div>
                )}

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
                                                <th style={{ padding: '10px', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', textAlign: 'center' }}>System O.H.</th>
                                                <th style={{ padding: '10px', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', textAlign: 'center' }}>Physical</th>
                                                <th style={{ padding: '10px', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', textAlign: 'center' }}>Net Delta</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {baseFilteredItems.filter(item => physicalCounts[item.id] !== undefined).map(item => {
                                                const delta = physicalCounts[item.id] - item.onHand;
                                                const effBin = ((binEdits[item.id] ?? item.binLocation) || '').trim().toUpperCase();
                                                const binIsNew = effBin !== '' && effBin.toUpperCase() !== (item.binLocation || '').trim().toUpperCase();
                                                return (
                                                    <tr key={item.id} style={{ borderBottom: `1px solid ${theme.line}` }}>
                                                        <td style={{ padding: '15px 10px', fontFamily: theme.sans, fontSize: '0.9rem' }}>{item.itemName}</td>
                                                        <td style={{ padding: '15px 10px', fontFamily: theme.mono, fontSize: '0.85rem', textAlign: 'center', color: binIsNew ? theme.brass : theme.inkSoft }}>{effBin || '—'}{binIsNew ? ' (new)' : ''}</td>
                                                        <td style={{ padding: '15px 10px', fontFamily: theme.mono, fontSize: '1.1rem', textAlign: 'center' }}>{item.onHand}</td>
                                                        <td style={{ padding: '15px 10px', fontFamily: theme.mono, fontSize: '1.1rem', textAlign: 'center' }}>{physicalCounts[item.id]}</td>
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
                                        <th style={{ padding: '16px', borderBottom: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', textAlign: 'center' }}>Bin Location</th>
                                        <th style={{ padding: '16px', borderBottom: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', textAlign: 'center' }}>System O.H.</th>
                                        <th style={{ padding: '16px', borderBottom: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', textAlign: 'center' }}>Physical Count</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {baseFilteredItems.map(item => (
                                        <tr key={item.id} style={{ borderBottom: `1px solid ${theme.line}`, background: physicalCounts[item.id] !== undefined ? '#f8fdf8' : '#fff' }}>
                                            <td style={{ padding: '16px' }}>
                                                <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>{item.erpId}</div>
                                                <div style={{ fontFamily: theme.sans, fontSize: '1rem', color: theme.ink, fontWeight: 500 }}>{item.itemName}</div>
                                            </td>
                                            <td style={{ padding: '16px', textAlign: 'center' }}>
                                                <input value={binEdits[item.id] ?? item.binLocation} onChange={e => setBinEdits(prev => ({ ...prev, [item.id]: e.target.value }))} placeholder="bin…" style={{ width: '130px', padding: '8px', textAlign: 'center', fontFamily: theme.mono, fontSize: '12px', color: theme.brass, background: 'transparent', border: (binEdits[item.id] !== undefined && (binEdits[item.id] || '').toUpperCase() !== (item.binLocation || '').toUpperCase()) ? `2px solid ${theme.brass}` : `1px solid ${theme.line}`, outline: 'none', boxSizing: 'border-box' }} />
                                            </td>
                                            <td style={{ padding: '16px', textAlign: 'center', fontFamily: theme.mono, fontSize: '1.2rem', color: theme.inkSoft }}>{item.onHand}</td>
                                            <td style={{ padding: '16px', textAlign: 'center' }}>
                                                <input
                                                    type="number"
                                                    placeholder="-"
                                                    value={physicalCounts[item.id] !== undefined ? physicalCounts[item.id] : ''} 
                                                    onChange={(e) => setPhysicalCounts(prev => ({ ...prev, [item.id]: e.target.value === "" ? undefined : Math.max(0, parseInt(e.target.value) || 0) }))}
                                                    style={{ width: '100px', padding: '12px', textAlign: 'center', fontSize: '1.2rem', fontFamily: theme.mono, border: physicalCounts[item.id] !== undefined ? `2px solid ${theme.brass}` : `1px solid ${theme.line}`, outline: 'none' }}
                                                />
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

                        {/* BOTTOM ACTION BAR */}
                        <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft, textTransform: 'uppercase' }}>
                                Items Counted: {Object.keys(physicalCounts).filter(k => physicalCounts[k] !== undefined).length}
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
                                            <input type="number" min="1" max={convertBase.onHand} value={convertQty} onChange={e => setConvertQty(e.target.value)} placeholder="0" style={{ width: '100%', padding: '12px', fontFamily: theme.mono, fontSize: '1.2rem', textAlign: 'center', border: `2px solid ${convQtyNum > 0 && convQtyNum <= convertBase.onHand ? theme.brass : theme.line}`, outline: 'none', boxSizing: 'border-box' }} />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Scan source bin</label>
                                            <input value={convertSrcScan} onChange={e => setConvertSrcScan(e.target.value)} placeholder={binOf(convertBase)} style={{ width: '100%', padding: '12px', fontFamily: theme.mono, fontSize: '1rem', textAlign: 'center', border: `2px solid ${convSrcOk ? '#7dbb81' : theme.line}`, outline: 'none', boxSizing: 'border-box' }} />
                                            <div style={{ fontFamily: theme.mono, fontSize: '9px', color: convSrcOk ? '#7dbb81' : theme.inkSoft, marginTop: '4px', textAlign: 'center' }}>{convSrcOk ? '✓ matches' : `expect ${binOf(convertBase)}`}</div>
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
                                    {baseFilteredItems.map(item => (
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
                                        <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.brass, marginTop: '6px' }}>home bin {binOf(transferBase)} · {transferBase.onHand} on hand (location)</div>
                                    </div>

                                    {/* FROM / QTY / TO */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                                        <div>
                                            <label style={{ display: 'block', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Scan source bin</label>
                                            <input value={transferSrcScan} onChange={e => setTransferSrcScan(e.target.value)} placeholder={binOf(transferBase)} style={{ width: '100%', padding: '12px', fontFamily: theme.mono, fontSize: '1rem', textAlign: 'center', border: `2px solid ${xferSrcKnown ? '#7dbb81' : theme.line}`, outline: 'none', boxSizing: 'border-box' }} />
                                            <div style={{ fontFamily: theme.mono, fontSize: '9px', color: xferSrcKnown ? '#7dbb81' : theme.inkSoft, marginTop: '4px', textAlign: 'center' }}>{xferSrcKnown ? '✓ home bin' : `home: ${binOf(transferBase)}`}</div>
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Quantity</label>
                                            <input type="number" min="1" max={transferBase.onHand} value={transferQty} onChange={e => setTransferQty(e.target.value)} placeholder="0" style={{ width: '100%', padding: '12px', fontFamily: theme.mono, fontSize: '1.2rem', textAlign: 'center', border: `2px solid ${xferQtyNum > 0 && xferQtyNum <= transferBase.onHand ? theme.brass : theme.line}`, outline: 'none', boxSizing: 'border-box' }} />
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
                                                <button onClick={() => { setTransferBase(item); setTransferSrcScan(""); setTransferQty(""); setTransferDestScan(""); setTransferMemo(""); }} style={{ padding: '10px 18px', background: theme.ink, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Transfer →</button>
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
                                        <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.brass, marginTop: '6px' }}>home bin {binOf(platingBase)} · {platingBase.onHand} on hand</div>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                                        <div>
                                            <label style={{ display: 'block', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Scan source bin</label>
                                            <input value={platingSrcScan} onChange={e => setPlatingSrcScan(e.target.value)} placeholder={binOf(platingBase)} style={{ width: '100%', padding: '12px', fontFamily: theme.mono, fontSize: '1rem', textAlign: 'center', border: `2px solid ${platSrcKnown ? '#7dbb81' : theme.line}`, outline: 'none', boxSizing: 'border-box' }} />
                                            <div style={{ fontFamily: theme.mono, fontSize: '9px', color: platSrcKnown ? '#7dbb81' : theme.inkSoft, marginTop: '4px', textAlign: 'center' }}>{platSrcKnown ? '✓ home bin' : `home: ${binOf(platingBase)}`}</div>
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Quantity</label>
                                            <input type="number" min="1" max={platingBase.onHand} value={platingQty} onChange={e => setPlatingQty(e.target.value)} placeholder="0" style={{ width: '100%', padding: '12px', fontFamily: theme.mono, fontSize: '1.2rem', textAlign: 'center', border: `2px solid ${platQtyNum > 0 && platQtyNum <= platingBase.onHand ? theme.brass : theme.line}`, outline: 'none', boxSizing: 'border-box' }} />
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
                            const groups = Object.values(platingShipped.reduce((a, l) => { (a[l.shipmentId] = a[l.shipmentId] || { shipmentId: l.shipmentId, nsPoId: l.nsPoId, lines: [] }).lines.push(l); return a; }, {}));
                            return (
                                <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '20px' }}>
                                    <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '12px' }}>Out at plater — {groups.length} shipment{groups.length === 1 ? '' : 's'} awaiting receive</div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                        {groups.map(g => (
                                            <div key={g.shipmentId} style={{ border: `1px solid ${theme.line}`, padding: '14px' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', gap: '12px' }}>
                                                    <div style={{ fontFamily: theme.mono, fontSize: '12px', color: theme.ink }}>{g.shipmentId} · {g.lines.length} line{g.lines.length === 1 ? '' : 's'} · {g.lines.reduce((s, l) => s + (parseInt(l.qty) || 0), 0)} pcs · NS PO {g.nsPoId || '—'}</div>
                                                    <div style={{ display: 'flex', gap: '8px' }}>
                                                        <button onClick={() => resetPlatingShipment(g.shipmentId, g.lines.map(l => l.id))} disabled={isSyncing} style={{ padding: '10px 12px', background: 'transparent', color: theme.inkSoft, border: `1px solid ${theme.line}`, cursor: isSyncing ? 'wait' : 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' }}>Reset</button>
                                                        <button onClick={() => pushPlatingReceive(g.shipmentId, g.nsPoId, g.lines.map(l => l.id))} disabled={isSyncing} style={{ padding: '10px 16px', background: theme.brass, color: '#fff', border: 'none', cursor: isSyncing ? 'wait' : 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' }}>Receive PO → Item Receipt</button>
                                                    </div>
                                                </div>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                    {g.lines.map(l => (
                                                        <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>
                                                            <span>{l.erpId} — {l.itemName}</span>
                                                            <span>{l.qty} @ {l.platingBin}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
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