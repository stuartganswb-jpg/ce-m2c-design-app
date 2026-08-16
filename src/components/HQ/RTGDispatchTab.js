import React, { useState, useEffect, useMemo } from 'react';
import OrderStatusChips from '../Shared/OrderStatusChips';
import { db } from '../../firebase';
import { collection, query, where, getDocs, getDoc, doc, setDoc, updateDoc, deleteDoc, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { classifyLine, isDisplayOnlyLine, DIVISION_CUSTOM } from '../Shared/lineClassification';
import { customerKeys, findClientPriceRow } from '../Shared/clientPricing';
import { makeFullTasks } from '../Shared/workOrderContract';
import ConfiguredItemViewer from '../Shared/ConfiguredItemViewer';
import FormPreview from '../Shared/FormPreview';
import { printForm } from '../Shared/printForm';
import { nsProxyFetch } from "../Shared/nsProxy";
import { enqueueNsWrite } from "../Shared/nsOutbox";

// Pull the real, classifiable order lines out of a CPQ job (skip the ▶ assembly headers and
// the trade-discount / net-total display rows).
const getJobLines = (job) => (job?.cpqData?.breakdown || []).filter(l => !isDisplayOnlyLine(l));

// Fixed ids for the Brimar test seed (shared by seed + remove so they can never drift). The floor
// doc ids follow autoSplitSalesOrder's orderKey convention (WO-/SHOP-/PKG- + soNum).
const TEST_SEED = { soNum: 'BRIMAR-TEST', quoteId: 'QUOTE-BRIMAR-TEST' };
const testSeedDocs = () => [
  ['jobs', TEST_SEED.quoteId],
  ['hq_sales_orders', `SO-${TEST_SEED.soNum}`],
  ['shop_custom_orders', `SHOP-${TEST_SEED.soNum}`],
  ['fin_workorders', `WO-${TEST_SEED.soNum}`],
  ['packaging_orders', `PKG-${TEST_SEED.soNum}`],
];

// Strip the "  - " display prefix CPQTab adds when merging cart lines.
const cleanLineName = (name) => String(name || '').replace(/^\s*[-▶]\s*/, '').trim();

// Keep in sync with PickPackApp/NetSuiteSyncTab/ERPPushPullTab/AdminTab (CLAUDE.md map).
// The missing `location` fields here were why Route A NetSuite work orders never queued.
const BRAND_NETSUITE_MAP = {
    'm2c': { subsidiary: "3", location: "19" },
    'uniquity': { subsidiary: "6", location: "20" },
    'ce': { subsidiary: "2", location: "17" },
    'leyla': { subsidiary: "5", location: "18" }
};

const RTGDispatchTab = ({ currentUser, activeBrand }) => {
    // NETSUITE TRANSMIT LOG (Stuart 2026-07-17): live ns_outbox tail so THIS screen shows the
    // data actually leaving for NetSuite — one row per staged push with live status, and a loud
    // diagnosis when the queue isn't draining (PENDING >3 min with zero attempts means the
    // nsOutboxWorker cloud function isn't deployed/running).
    const [nsOutboxTail, setNsOutboxTail] = useState([]);
    const [openObId, setOpenObId] = useState(null); // transmit-log row expanded for full error/payload

    // One-click recovery straight from the transmit log: reset a FAILED outbox entry so the
    // worker retries it on its next 1-minute tick (same effect as Retry in 11.1).
    const requeueOutbox = async (o) => {
        if (!window.confirm(`Re-queue "${o.label || o.id}" to NetSuite?\n\nThe worker will retry it within ~1 minute.`)) return;
        try {
            // Heal known payload-shape mistakes before resending, so a retry isn't a guaranteed
            // repeat failure: workorder creation must use `assemblyItem`, not `item` (2026-07-17);
            // workordercompletion receive bins must be ONE bin — the library home-bin field is a
            // comma-joined list from the item sync, invalid as a refName (2026-07-20).
            const p = o.payload ? JSON.parse(JSON.stringify(o.payload)) : {};
            if (o.kind === 'workorder' && p.item && !p.assemblyItem) { p.assemblyItem = p.item; delete p.item; }
            if (o.kind === 'workordercompletion' && p.inventoryDetail) {
                const q0 = p.inventoryDetail.quantity;
                const rawBin = String(p.inventoryDetail?.inventoryAssignment?.items?.[0]?.binNumber?.refName || '');
                const firstBin = rawBin.split(',')[0].trim().toUpperCase();
                if (!firstBin || firstBin === 'UNASSIGNED') delete p.inventoryDetail;
                else p.inventoryDetail = { quantity: q0, inventoryAssignment: { items: [{ binNumber: { refName: firstBin }, quantity: q0 }] } };
            }
            // Non-WIP WOs can't take workordercompletion — flip the transform to the WO-linked
            // assemblyBuild (the UI's "Create Build"), which IS how these complete (2026-07-21).
            const fixedUrl = String(o.targetUrl || '').replace('/!transform/workordercompletion', '/!transform/assemblyBuild');
            // Attempts are KEPT (not reset): the worker only runs its already-posted (marker
            // recovery) check on retried entries — resetting to 0 disabled it and allowed
            // double-posts when Retry was hammered (Stuart 2026-07-21).
            await updateDoc(doc(db, 'ns_outbox', o.id), { payload: p, targetUrl: fixedUrl, status: 'PENDING', nextAttemptAt: Date.now(), lastError: '', requeuedAt: Date.now(), requeuedBy: currentUser || '' });
            addLog(`↻ Re-queued ${o.label || o.id}.`, 'info');
        } catch (e) { alert(`Re-queue failed: ${e.message}`); }
    };
    useEffect(() => {
        const unsub = onSnapshot(query(collection(db, 'ns_outbox'), orderBy('createdAt', 'desc'), limit(12)),
            snap => setNsOutboxTail(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
            () => { /* collection may not exist yet */ });
        return () => unsub();
    }, []);
    const [salesOrders, setSalesOrders] = useState([]);
    const [showArchive, setShowArchive] = useState(false);   // dispatched rows older than a week
    const [workOrders, setWorkOrders] = useState([]);
    const [purchaseOrders, setPurchaseOrders] = useState([]);
    const [inventoryTasks, setInventoryTasks] = useState([]);
    const [loading, setLoading] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncLog, setSyncLog] = useState([]);

    const [activeViewOrder, setActiveViewOrder] = useState(null);
    const [activeJobDetails, setActiveJobDetails] = useState(null);
    const [cfgQuote, setCfgQuote] = useState(null); // "view configured item" read-only 3D modal
    // Live "Daily Job Log" feed — brand-scoped snapshots of the four stages a job moves through.
    const [liveSO, setLiveSO] = useState([]);
    const [liveWO, setLiveWO] = useState([]);
    const [liveShop, setLiveShop] = useState([]);
    const [liveFin, setLiveFin] = useState([]);
    const [logTodayOnly, setLogTodayOnly] = useState(false);
    const [formTemplates, setFormTemplates] = useState({}); // hq_config/form_templates — header/footer/terms per doc type
    const [brandLogos, setBrandLogos] = useState({});       // hq_config/brand_logos — printed on the forms

    const addLog = (msg, type = 'info') => {
        const time = new Date().toLocaleTimeString();
        setSyncLog(prev => [{ time, msg, type }, ...prev]);
    };

    // Push an approved app PO into NetSuite. The vendor was ALIGNED AT CREATION (nsVendorId = the
    // synced VEND-<id> CRM record) and every line carries the NetSuite item internal id — so this
    // can't mis-resolve a vendor or item at push time; anything unaligned is blocked with a fix-it
    // message instead. Same proven REST shape as the plating PO, plus an EXPLICIT subsidiary (our
    // vendors are shared across subsidiaries, so NetSuite won't infer one) and the req date.
    const pushPoToNetSuite = async (po) => {
        if (!po.nsVendorId) return alert(`PO ${po.poId || po.id} has no NetSuite vendor id.\n\nVendor "${po.vendor || '?'}" must match a NetSuite-synced vendor — run 11.1 → Sync Active Vendors (or fix the vendor name on the items), then re-generate the PO from the Sales Snapshot.`);
        const missing = (po.items || []).filter(l => !l.nsItemId);
        if (missing.length) return alert(`${missing.length} line(s) have no NetSuite item id — sync those items (11.1 → Sync Master Library) and re-generate:\n\n${missing.slice(0, 10).map(l => `• ${l.itemId}`).join('\n')}`);
        // Stamped at PO creation from the vendor's NetSuite subsidiary assignments. NetSuite reports
        // this as an "Invalid Field Value <loc> for the following field: location" error, which sends
        // everyone hunting the wrong field — so say what it actually is, before the push.
        const subGap = String(po.vendorSubsidiaryGap || '');
        if (subGap && !window.confirm(`⚠ ${po.vendor} is assigned to NetSuite subsidiary ${subGap.split(',').join(' / ')}, but this PO is issued by subsidiary ${po.nsSubsidiary || '?'}.\n\nNetSuite will almost certainly refuse it — and it will blame the LOCATION field, which is not the problem. Fix: add subsidiary ${po.nsSubsidiary || '?'} to that vendor record in NetSuite, then re-run 11.1 → Sync Active Vendors.\n\nPush anyway?`)) return;
        if (!window.confirm(`Queue PO ${po.poId || po.id} → NetSuite?\n\nVendor: ${po.vendor} (internal id ${po.nsVendorId})\n${(po.items || []).length} line(s), req ${po.reqDate || 'n/a'}.\n\nIt posts from the sync queue within ~a minute (11.1 → NetSuite Sync Queue shows status); the PO record picks up the NetSuite # automatically.`)) return;
        try {
            const nsConfig = BRAND_NETSUITE_MAP[activeBrand] || {};
            // LAYER 2 (2026-07-16): staged write — the outbox worker posts it (serial, retried,
            // idempotent via the [ob:] memo marker) and writes status + nsPoId/nsPoTran back
            // onto the PO doc. Concurrency-safe under the whole team; nobody waits on a PO.
            const obId = await enqueueNsWrite({
                kind: 'purchaseorder',
                label: `PO ${po.poId || po.id} → ${po.vendor}`,
                sourceApp: 'RTG',
                createdBy: currentUser || '',
                targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/purchaseorder`,
                method: 'POST',
                payload: {
                    entity: { id: String(po.nsVendorId) },
                    // SUBSIDIARY MUST COME BEFORE LOCATION, AND NEITHER GOES ALONE (Eric, 2026-08-15).
                    // Sending `location` with no `subsidiary` is what produced "Invalid Field Value 17
                    // for the following field: location" on a CE PO — 17 IS the right CE location, but
                    // setting the entity first auto-populates the VENDOR's primary subsidiary, and our
                    // vendors sit opposite the company buying from them (The Generator's primary is
                    // M2C; Dayton Grey's is CE). NetSuite then rejects a location belonging to the
                    // subsidiary it just defaulted away from. Subsidiary first pins it; location
                    // resolves against that. Keep this key order — it mirrors the order NetSuite
                    // applies them in.
                    ...(nsConfig.subsidiary
                        ? { subsidiary: { id: String(nsConfig.subsidiary) }, location: { id: String(nsConfig.location) } }
                        : {}),
                    // The date the PO is wanted. Without it NetSuite dates the whole PO today and
                    // receiving has nothing to schedule against — the req date is already on the doc.
                    ...(po.reqDate ? { dueDate: po.reqDate } : {}),
                    memo: `Stock replenishment ${po.poId || po.id} (Sales Snapshot)`,
                    item: { items: (po.items || []).map(l => ({ item: { id: String(l.nsItemId) }, quantity: parseInt(l.quantity) || 1, ...(parseFloat(l.rate) > 0 ? { rate: parseFloat(l.rate) } : {}), description: l.description || l.itemId })) }
                },
                writeBack: { collection: 'hq_purchase_orders', docId: po.id, patch: { status: 'Pushed to NetSuite', pushedAt: Date.now() }, idField: 'nsPoId', tranField: 'nsPoTran' }
            });
            await updateDoc(doc(db, 'hq_purchase_orders', po.id), { status: 'Queued to NetSuite', nsOutboxId: obId, queuedAt: Date.now() });
            addLog(`📤 PO ${po.poId || po.id} queued → NetSuite (${po.vendor}); posts within ~1 min.`, 'success');
            alert(`📤 PO queued for ${po.vendor}.\n\nIt posts to NetSuite from the sync queue within about a minute — watch 11.1 → NetSuite Sync Queue for the live status and PO #.`);
            loadRTGOrders();
        } catch (e) {
            console.error('PO queue failed:', e);
            alert('❌ Could not queue the PO: ' + (e.message || e));
        }
    };

    const loadRTGOrders = async () => {
        setLoading(true);
        try {
            // Approved AND Dispatched (Stuart 2026-07-28: "once sent they are gone, would much
            // prefer they stay on and show status, sent to floor, etc"). A dispatched order stays
            // on the board as a condensed row showing which floors it reached; rows older than a
            // week fall into the archive toggle below, so the board stays this week's work.
            const soQuery = query(collection(db, "hq_sales_orders"), where("status", "in", ["Approved", "Dispatched"]), where("brand", "==", activeBrand));
            const woQuery = query(collection(db, "hq_work_orders"), where("status", "in", ["Approved", "Dispatched"]), where("brand", "==", activeBrand));
            const poQuery = query(collection(db, "hq_purchase_orders"), where("status", "==", "Approved"), where("brand", "==", activeBrand));
            const invQuery = query(collection(db, "hq_inventory_tasks"), where("status", "==", "Active"), where("brand", "==", activeBrand));

            const [soSnap, woSnap, poSnap, invSnap] = await Promise.all([
                getDocs(soQuery), getDocs(woQuery), getDocs(poQuery), getDocs(invQuery)
            ]);

            setSalesOrders(soSnap.docs.map(d => ({ id: d.id, ...d.data() })));
            setWorkOrders(woSnap.docs.map(d => ({ id: d.id, ...d.data() })));
            setPurchaseOrders(poSnap.docs.map(d => ({ id: d.id, ...d.data() })));
            setInventoryTasks(invSnap.docs.map(d => ({ id: d.id, ...d.data() })));

        } catch (error) {
            console.error("Error loading RTG:", error);
            addLog("Failed to load local RTG board data.", "error");
        }
        setLoading(false);
    };

    useEffect(() => {
        loadRTGOrders();
    }, [activeBrand]);

    // Live job-log feed: read-only snapshots of the four stages a job moves through —
    // HQ/NetSuite order intake (hq_sales_orders / hq_work_orders) → Shop floor (shop_custom_orders)
    // → Finishing floor (fin_workorders). Brand-scoped; never writes. Unlike the dispatch board
    // above (which only shows orders still AWAITING dispatch), this shows every job, wherever it sits.
    useEffect(() => {
        if (!activeBrand) return;
        const mk = (coll, setter) => onSnapshot(query(collection(db, coll), where("brand", "==", activeBrand)),
            s => setter(s.docs.map(d => ({ id: d.id, ...d.data() }))),
            err => console.warn(`job-log ${coll} listen failed`, err));
        const subs = [
            mk("hq_sales_orders", setLiveSO), mk("hq_work_orders", setLiveWO),
            mk("shop_custom_orders", setLiveShop), mk("fin_workorders", setLiveFin),
        ];
        return () => subs.forEach(u => u && u());
    }, [activeBrand]);

    // Form branding (shared with Admin > Form Templates) so printed docs use the configured
    // header/footer/terms + brand logo.
    useEffect(() => {
        const u1 = onSnapshot(doc(db, "hq_config", "form_templates"), s => { if (s.exists()) setFormTemplates(s.data()); });
        const u2 = onSnapshot(doc(db, "hq_config", "brand_logos"), s => { if (s.exists()) setBrandLogos(s.data()); });
        return () => { u1(); u2(); };
    }, []);

    // Merge the four feeds into one job per order, keyed by the same canonical id the splitter
    // stamps as `orderKey` (SO → soId; stock WO → hqJobId/id), so an order's HQ row and its Shop /
    // Finishing children collapse into a single line that shows everywhere it currently lives.
    const dailyJobs = useMemo(() => {
        const jobs = {};
        const toMs = (v) => { if (v == null || v === '') return null; if (typeof v === 'number') return v; const t = Date.parse(v); return isNaN(t) ? null : t; };
        const get = (k) => (jobs[k] = jobs[k] || { key: k, soId: null, woId: null, customer: '', quoteId: null, orderTs: null, reqDate: '', stages: {}, latestTs: 0, soRec: null, woRec: null });
        const touch = (j, ts) => { if (ts && ts > j.latestTs) j.latestTs = ts; };
        liveSO.forEach(so => {
            const k = so.soId || so.id || so.hqJobId; if (!k) return; const j = get(k);
            j.soId = so.soId || so.id; j.customer = j.customer || so.customer || ''; j.quoteId = j.quoteId || so.hqJobId || null; j.soRec = so;
            if (!j.orderTs) j.orderTs = toMs(so.createdAt); j.reqDate = j.reqDate || so.reqDate || '';
            j.stages.HQ = { status: so.status || 'Approved', split: !!so.autoSplit, kind: 'SO' };
            touch(j, toMs(so.createdAt) || toMs(so.reqDate));
        });
        liveWO.forEach(wo => {
            const k = wo.hqJobId || wo.id || wo.woId; if (!k) return; const j = get(k);
            j.woId = wo.woId || wo.id; j.quoteId = j.quoteId || wo.hqJobId || null; j.woRec = wo;
            if (!j.orderTs) j.orderTs = toMs(wo.createdAt); j.reqDate = j.reqDate || wo.reqDate || '';
            j.stages.HQ = j.stages.HQ || { status: wo.status || 'Approved', kind: 'WO' };
            touch(j, toMs(wo.createdAt) || toMs(wo.reqDate));
        });
        liveShop.forEach(s => {
            const k = s.orderKey || s.salesOrderId || s.quoteId || s.id; if (!k) return; const j = get(k);
            j.soId = j.soId || s.salesOrderId; j.customer = j.customer || s.clientName || ''; j.quoteId = j.quoteId || s.quoteId || null;
            if (!j.orderTs) j.orderTs = toMs(s.createdAt); j.reqDate = j.reqDate || s.reqDate || '';
            j.stages.SHOP = { status: s.status || 'Pending', id: s.id };
            touch(j, toMs(s.updatedAt) || toMs(s.createdAt));
        });
        liveFin.forEach(f => {
            const k = f.orderKey || f.salesOrderId || f.quoteId || f.id; if (!k) return; const j = get(k);
            j.soId = j.soId || f.salesOrderId; j.customer = j.customer || f.customerName || f.clientName || ''; j.quoteId = j.quoteId || f.quoteId || null;
            if (!j.orderTs) j.orderTs = toMs(f.createdAt); j.reqDate = j.reqDate || f.reqDate || '';
            j.stages.FINISHING = { status: f.currentPhase || f.stepStatus || 'Setup', id: f.id };
            j.finDoc = f;   // the whole doc, so the row can render the SAME chips the floor sees
            touch(j, toMs(f.updatedAt) || toMs(f.createdAt));
        });
        let arr = Object.values(jobs);
        if (logTodayOnly) { const d = new Date(); d.setHours(0, 0, 0, 0); const startMs = d.getTime(); arr = arr.filter(j => (j.latestTs || 0) >= startMs); }
        return arr.sort((a, b) => (b.latestTs || 0) - (a.latestTs || 0));
    }, [liveSO, liveWO, liveShop, liveFin, logTodayOnly]);

    const pullNSSalesOrders = async () => {
        setIsSyncing(true);
        setSyncLog([]); 
        
        try {
            const subsidiaryId = BRAND_NETSUITE_MAP[activeBrand]?.subsidiary || "3";
            addLog(`Initiating Diagnostic Net Pull from NetSuite (Sub: ${subsidiaryId})...`, 'info');
            
            // custbody50 (our QUOTE- job id) is set on the Estimate and, as a stored body
            // field, copies to the Sales Order when the estimate is transformed. The earlier
            // miss was the unordered 1000-row page cap hiding a fresh SO — so narrow to app
            // orders (custbody50 LIKE 'QUOTE-%') and sort newest-first.
            const q = `
                SELECT
                    transaction.id AS ns_id,
                    transaction.tranid AS so_num,
                    transaction.custbody50 AS so_job_id,
                    transaction.entity AS customer_id,
                    transaction.trandate,
                    transaction.memo,
                    transaction.status AS raw_status
                FROM transaction
                WHERE transaction.type = 'SalesOrd'
                AND transaction.subsidiary = ${subsidiaryId}
                AND transaction.custbody50 LIKE 'QUOTE-%'
                ORDER BY transaction.id DESC
            `;
            
            addLog("Executing SuiteQL: Pulling Sales Orders to evaluate locally...", "info");

            const response = await nsProxyFetch({
                targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`,
                method: 'POST',
                payload: { q }
            });
            
            const result = await response.json();
            if (!response.ok) throw new Error(JSON.stringify(result));
            
            const records = result.items || [];
            addLog(`NetSuite returned ${records.length} total orders for subsidiary. Isolating App Quotes...`, records.length > 0 ? "success" : "warn");

            let newOrders = 0;
            let skippedOrganic = 0;
            let skippedStatus = 0;
            
            for (const row of records) {
                const hqJobId = row.so_job_id;
                const rawStatus = row.raw_status || 'UNKNOWN';

                if (!hqJobId || !hqJobId.startsWith('QUOTE-')) {
                    skippedOrganic++;
                    continue; 
                }

                if (!['SalesOrd:A', 'SalesOrd:B', 'A', 'B'].includes(rawStatus)) {
                    skippedStatus++;
                    continue; 
                }

                const hqSalesOrderId = `SO-${row.so_num}`;
                const soRef = doc(db, "hq_sales_orders", hqSalesOrderId);
                const soSnap = await getDoc(soRef);
                
                if (!soSnap.exists()) {
                    await setDoc(soRef, {
                        id: hqSalesOrderId,
                        soId: row.so_num,
                        nsInternalId: row.ns_id,
                        customer: `NS Entity ID: ${row.customer_id || 'Unknown'}`,
                        status: "Approved",
                        brand: activeBrand,
                        recipe: "PENDING-RECIPE", 
                        type: "Custom",
                        totalParts: 1, 
                        length: 0, width: 0, height: 0,
                        reqDate: row.trandate || new Date().toISOString().split('T')[0],
                        hqJobId: hqJobId,
                        memo: row.memo || ''
                    });
                    newOrders++;
                    addLog(`Imported App-Generated SO: ${hqSalesOrderId} (Linked to ${hqJobId})`, "success");
                } else {
                    addLog(`Skipped ${hqSalesOrderId} (Already exists on board).`, "info");
                }
            }
            
            if (skippedStatus > 0) addLog(`Skipped ${skippedStatus} order(s): status not awaiting dispatch (A/B).`, "info");
            if (skippedOrganic > 0) addLog(`Skipped ${skippedOrganic} order(s): no QUOTE- link (not app-originated).`, "info");
            addLog(`✅ Sync complete. Added ${newOrders} new orders.`, "success");
            loadRTGOrders();
        } catch(e) {
            console.error(e);
            addLog(`❌ FAILED: ${e.message}`, "error");
            alert("Failed to sync from NetSuite. See terminal for details.");
        }
        setIsSyncing(false);
    };

    const fetchEnrichedJobData = async (hqJobId, orderType) => {
        let originalJob = null;
        let svgUri = null;
        let finishRecipe = "PENDING-RECIPE";

        if (hqJobId) {
            try {
                if (orderType === 'stock') {
                    // For stock builds, we look directly in the Master Library (Approved_Designs)
                    const adSnap = await getDoc(doc(db, "Approved_Designs", hqJobId));
                    if (adSnap.exists()) {
                        originalJob = adSnap.data();
                    } else {
                        addLog(`Master Library item not found: ${hqJobId}`, 'warn');
                    }
                } else {
                    // For Sales Orders, we check the CPQ 'jobs' collection
                    const jSnap = await getDoc(doc(db, "jobs", hqJobId));
                    if (jSnap.exists()) {
                        originalJob = jSnap.data();
                    } else {
                        // Fallback to library
                        const adSnap = await getDoc(doc(db, "Approved_Designs", hqJobId));
                        if (adSnap.exists()) originalJob = adSnap.data();
                        else addLog(`Database missed job document: ${hqJobId}`, 'warn');
                    }
                    
                    // Only try to fetch CPQ Shop Drawings for Sales Orders
                    const filesSnap = await getDocs(query(collection(db, "crm_files"), where("jobId", "==", hqJobId)));
                    if (!filesSnap.empty) {
                        const drawingDoc = filesSnap.docs.find(d => d.data().type === 'VISION_DRAWING');
                        if (drawingDoc && drawingDoc.data().svgData) {
                            svgUri = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(drawingDoc.data().svgData);
                        }
                    }
                }

                // Check for CPQ finish recipe
                if (originalJob && originalJob.cpqData && originalJob.cpqData.configuration) {
                    const fSnap = await getDoc(doc(db, "system", "master_finishes"));
                    if (fSnap.exists() && fSnap.data().finishes) {
                        const configVals = Object.values(originalJob.cpqData.configuration);
                        const foundFin = fSnap.data().finishes.find(f => configVals.includes(f.id));
                        if (foundFin) {
                            finishRecipe = foundFin.code ? `${foundFin.code} - ${foundFin.name}` : foundFin.name;
                        }
                    }
                }
            } catch (err) {
                console.error("Enrichment Fetch Error:", err);
            }
        }
        return { originalJob, svgUri, finishRecipe };
    };

    const handleViewOrder = async (order, orderType) => {
        setActiveViewOrder({ ...order, orderType });
        setActiveJobDetails(null);
        // Snapshot stock WOs carry everything on the parked finPayload — no CPQ job to fetch
        // (the old path spun on "Fetching…" forever because hqJobId doesn't exist).
        if (order.finPayload && order.finPayload.id) {
            setActiveJobDetails({ snapshotStock: true, fp: order.finPayload });
            return;
        }
        if (order.hqJobId) {
            const { originalJob, finishRecipe, svgUri } = await fetchEnrichedJobData(order.hqJobId, orderType);
            // The order's OWN stamped recipe wins over an unresolved CPQ lookup — library/stock
            // releases stamp `recipe` (code) + `finishLabel` on the WO doc, and showing
            // PENDING-RECIPE over a stated RF1 read as "finish never attached" (2026-08-10).
            const ownRecipe = String(order.finishLabel || order.recipe || '').trim();
            const shownRecipe = (finishRecipe === 'PENDING-RECIPE' && ownRecipe && !/^PENDING/i.test(ownRecipe)) ? ownRecipe : finishRecipe;
            if (originalJob) {
                setActiveJobDetails({ ...originalJob, finishRecipe: shownRecipe, svgUri });
            } else {
                addLog(`Warning: Original Document [${order.hqJobId}] not found in database.`, 'warn');
                setActiveJobDetails({ finishRecipe: shownRecipe, svgUri });
            }
        } else {
            // No linked CPQ job at all (legacy grid/library stock builds) — show the order
            // record's own facts via the same stock summary instead of spinning.
            setActiveJobDetails({
                snapshotStock: true,
                fp: { stockErpId: order.partErpId || order.variantErpId || order.rootItem || '', type: order.type || 'Stock Build', woNum: order.woNo || order.woDisplayId || order.id, totalParts: order.totalParts || order.qty || 0, recipe: order.recipe || '', reqDate: order.reqDate || '', note: '' }
            });
        }
    };

    // Load every part referenced by a set of lines into a Map (id -> part doc), de-duped.
    const loadPartsForLines = async (lines) => {
        const ids = [...new Set(lines.map(l => l.partId).filter(Boolean))];
        const cache = new Map();
        await Promise.all(ids.map(async (pid) => {
            try {
                const snap = await getDoc(doc(db, "Approved_Designs", pid));
                if (snap.exists()) cache.set(pid, { id: snap.id, ...snap.data() });
            } catch (e) { /* missing part -> resolved fields fall back below */ }
        }));
        return cache;
    };

    // Resolve the brand's ring (FIPR) part footprint so packaging cuts an exact slot. The CPQ ring
    // line is a *finish* step (FIN- id, no geometry), so its OD can't come from the line — look up
    // the FIPR geometry part by code and read its captured dims. Returns {w:OD, h:thick} or null
    // (packaging then falls back to a 2.25" default). One brand query, cached per split.
    const resolveRingFootprint = async (brand) => {
        try {
            const snap = await getDocs(query(collection(db, "Approved_Designs"), where("brandId", "==", brand)));
            const fipr = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .find(p => /^FIPR/i.test(p.legacyErpId || '') || /^FIPR/i.test(p.id || ''));
            if (!fipr) return null;
            const pm = fipr.manufacturingSpecs?.parametric || {};
            const od = Math.max(parseFloat(pm.width) || 0, parseFloat(pm.height) || 0);
            const thick = parseFloat(pm.thickness) || null;
            return od > 0 ? { w: od, h: thick || od } : null;
        } catch (e) { return null; }
    };

    // Map associated part id -> reference image url, from the shared asset gallery.
    const loadAssetMap = async () => {
        const map = new Map();
        try {
            const snap = await getDocs(collection(db, "global_assets"));
            snap.docs.forEach(d => {
                const a = d.data();
                const url = a.thumbnailUrl || a.url || a.originalUrl || null;
                if (url && Array.isArray(a.associatedParts)) {
                    a.associatedParts.forEach(pid => { if (!map.has(pid)) map.set(pid, url); });
                }
            });
        } catch (e) { /* gallery unavailable -> assetUrl stays null */ }
        return map;
    };

    // Build the §6 small-parts pick list from the small lines. `custKeys` is the shared
    // clientPricing matcher set (id ∪ name ∪ companyName) — the strict-id match here missed
    // name-keyed rows, so the pick ticket dropped the customer's SKU that the quote showed.
    const buildPartsList = (smallLines, partCache, assetMap, custKeys) => smallLines.map(line => {
        const part = line.partId ? partCache.get(line.partId) : null;
        const cp = findClientPriceRow(part?.clientPricing, custKeys);
        return {
            partId: line.partId || null,
            // NetSuite item # for the pick ticket — prefer the id baked on the CPQ line, then the
            // resolved part, then the app part id, so it's populated even if the part hasn't synced.
            legacyErpId: line.legacyErpId || part?.legacyErpId || part?.itemId || line.partId || '',
            name: cleanLineName(line.name),
            clientSku: cp?.clientSku || '',
            qty: Number(line.qty) || 1,
            binLocation: part?.manufacturingSpecs?.binLocation || 'UNASSIGNED',
            // Scheduler keys (recipe lives on the WO; size + type live per part). The finishing
            // time matrix resolves minutes-per-part from (recipe × paintSize × productType).
            paintSize: (part?.manufacturingSpecs?.paintSize || '').toUpperCase() || null,
            productType: (part?.manufacturingSpecs?.productType || part?.productType || '').toUpperCase() || null,
            assetUrl: (line.partId && assetMap.get(line.partId)) || null
        };
    });

    // §6: import a confirmed Sales Order and fan it out into the two linked work orders.
    // Board split: what still needs dispatching vs what has already gone to the floors. A
    // dispatched row stays visible for a week (the "condensed and archived at end of each week"
    // he asked for), then only shows behind the archive toggle. Legacy rows with no dispatchedAt
    // are treated as old, so they archive straight away rather than crowding today's board.
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const isRecent = (o) => !!o.dispatchedAt && (Date.now() - o.dispatchedAt) < WEEK_MS;
    const splitBoard = (list) => {
        const live = list.filter(o => !o.rtgArchived);
        const pending = live.filter(o => o.status === 'Approved');
        const done = live.filter(o => o.status === 'Dispatched').sort((a, b) => (b.dispatchedAt || 0) - (a.dispatchedAt || 0));
        return { pending, recent: done.filter(isRecent), archived: done.filter(o => !isRecent(o)) };
    };

    // "maybe get condensed and archived at end of each week" — the weekly sweep. It stamps an
    // RTG-ONLY flag (rtgArchived), never the status, so nothing outside this board changes
    // behaviour: the order stays exactly as it is for Pick/Pack, Stock View and NetSuite; it just
    // stops being carried on the dispatch board.
    const archiveOlder = async (board, collectionName, label) => {
        if (!board.archived.length) return;
        if (!window.confirm(`Archive ${board.archived.length} dispatched ${label}(s) older than 7 days?\n\nThey come off this board only — the work orders on the floors, Pick/Pack and NetSuite are untouched.`)) return;
        try {
            for (const o of board.archived) {
                await updateDoc(doc(db, collectionName, o.id), { rtgArchived: true, archivedAt: Date.now(), archivedBy: currentUser || '' });
            }
            addLog(`Archived ${board.archived.length} dispatched ${label}(s) from the RTG board.`, 'success');
            loadRTGOrders();
        } catch (e) {
            addLog(`Archive failed: ${e.message}`, 'error');
        }
    };
    const soBoard = splitBoard(salesOrders);
    const woBoard = splitBoard(workOrders);
    const dispatchedChip = (o) => [o.pushedToFinishing ? 'FINISHING ✓' : null, o.pushedToShop ? 'SHOP ✓' : null].filter(Boolean).join('  ·  ') || 'SENT';
    const whenStr = (t) => t ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';

    const autoSplitSalesOrder = async (so, opts = {}) => {
        if (!so.hqJobId) return alert("This SO has no linked CPQ job (custbody50). Cannot auto-split.");
        const isRedispatch = so.status === 'Dispatched';
        if (!opts.skipConfirm && !window.confirm(isRedispatch
            ? `RE-DISPATCH SO ${so.soId || so.id}?\n\nThe split re-runs with the current routing rules and OVERWRITES the existing floor work orders (same ids) — any progress already logged against them is reset.`
            : `Import SO ${so.soId || so.id} and auto-split into Finishing + Shop work orders?`)) return;

        try {
            const jobSnap = await getDoc(doc(db, "jobs", so.hqJobId));
            if (!jobSnap.exists()) return alert(`Linked job ${so.hqJobId} not found.`);
            const job = jobSnap.data();

            const lines = getJobLines(job);
            if (lines.length === 0) return alert("Linked job has no CPQ lines to split.");

            const orderKey = so.soId || so.id || so.hqJobId;
            const customerId = job.customer?.id || null;
            const customerName = job.customer?.name || so.customer || "Unknown";
            // Same matcher CPQ prices with — resolve the CRM record so name/companyName-keyed
            // clientPricing rows still surface their clientSku on the pick list.
            let custRec = null;
            if (customerId) {
                try { const cs = await getDoc(doc(db, 'crm_records', customerId)); custRec = cs.exists() ? cs.data() : null; }
                catch (e) { /* fall back to the job's own name */ }
            }
            const custKeys = customerKeys(customerId, custRec || { name: customerName });

            const partCache = await loadPartsForLines(lines);

            const smallLines = [];
            const customLines = [];
            lines.forEach(line => {
                const part = line.partId ? partCache.get(line.partId) : null;
                (classifyLine(line, part) === DIVISION_CUSTOM ? customLines : smallLines).push(line);
            });

            const { svgUri, finishRecipe } = await fetchEnrichedJobData(so.hqJobId, 'sales');

            // Vision-computed fabrication geometry (bend vs splice vs miter, shape, O2O) lives
            // on the job's engineeringNotes. Carry it to the floors so the shop knows HOW to
            // make the pole, and the drawing rides along to both halves (it shows placement).
            const eng = job.engineeringNotes || {};
            const fabNotes = {
                shape: eng.shape || null,
                qtyBends: eng.qtyBends || 0,
                qtySplices: eng.qtySplices || 0,
                qtyMiters: eng.qtyMiters || 0,
                qtyMiterReturns: eng.qtyMiterReturns || 0,
                poleO2O: eng.poleO2O || null,
                totalSystemO2O: eng.totalSystemO2O || null,
                // Full cut sheet from Vision: per-segment finished lengths + raw cuts + miter saw / wall
                // angles + bend radius / pole diameter, so the shop gets the cut+bend detail, not just counts.
                pole1: eng.pole1 ?? null, pole2: eng.pole2 ?? null, pole3: eng.pole3 ?? null,
                rawLeft: eng.rawLeft ?? null, rawCenter: eng.rawCenter ?? null, rawRight: eng.rawRight ?? null,
                sawAngle1: eng.sawAngle1 ?? null, sawAngle2: eng.sawAngle2 ?? null,
                wallAngleL: eng.wallAngleL ?? null, wallAngleR: eng.wallAngleR ?? null,
                returnRadius: eng.returnRadius ?? null, poleDiameter: eng.poleDiameter ?? null,
                // Hidden-hanger mount positions captured in Vision: FIPBH per bracket, FIPBHS per
                // splice. The shop floor reads these to set the concealed hangers at the right spots.
                hangerLocations: Array.isArray(eng.hangerLocations) ? eng.hangerLocations : []
            };
            const fabMethod = eng.qtyBends > 0 ? 'BEND' : (eng.qtySplices > 0 ? 'SPLICE' : (eng.qtyMiters > 0 ? 'MITER' : null));

            // Vision canvas notes captured on the cart items: free-floating shop notes (generalNotes)
            // and per-bracket/splice note boxes (bracketNotes). Carry them to the floor verbatim.
            const cartItems = job.cpqData?.cartItems || [];
            const visionNotes = cartItems.flatMap(it => Array.isArray(it.generalNotes) ? it.generalNotes : []).map(s => String(s || '').trim()).filter(Boolean);
            const bracketNotes = cartItems.flatMap(it => Array.isArray(it.bracketNotes) ? it.bracketNotes : []).filter(b => b && b.note && String(b.note).trim());
            const drawingUrl = svgUri
                || (eng.svgString ? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(eng.svgString) : null)
                || job.finalImageUrl || null;

            const finId = `WO-${orderKey}`;
            const shopId = `SHOP-${orderKey}`;
            const hasCustom = customLines.length > 0;
            const hasSmall = smallLines.length > 0;

            // --- Finishing (small parts) ---
            if (hasSmall) {
                const assetMap = await loadAssetMap();
                const partsList = buildPartsList(smallLines, partCache, assetMap, custKeys);
                const cpqSpecs = {};
                smallLines.forEach(l => { cpqSpecs[cleanLineName(l.name)] = `Qty: ${l.qty}`; });
                const totalParts = smallLines.reduce((s, l) => s + (Number(l.qty) || 0), 0) || smallLines.length;
                // WO-level size breakdown (for the planner's section packing + a single display chip).
                // Per-part minutes still resolve off each partsList line; this is the rollup.
                const paintSizes = partsList.reduce((acc, p) => {
                    if (p.paintSize && ['S', 'M', 'L'].includes(p.paintSize)) acc[p.paintSize] += (Number(p.qty) || 0);
                    return acc;
                }, { S: 0, M: 0, L: 0 });
                const hasSize = (paintSizes.S + paintSizes.M + paintSizes.L) > 0;
                const paintSize = hasSize
                    ? Object.keys(paintSizes).sort((a, b) => paintSizes[b] - paintSizes[a]).find(k => paintSizes[k] > 0)
                    : null;

                await setDoc(doc(db, "fin_workorders", finId), {
                    id: finId, woNum: finId, displayId: finId,
                    orderKey, quoteId: so.hqJobId, salesOrderId: so.soId || null,
                    estimateId: job.netsuiteEstimateId || null,
                    brand: activeBrand,
                    customerId, customerName, clientName: customerName,
                    orderType: 'sales',
                    type: job.cpqData?.cartItems?.[0]?.assemblyName || "Mixed",
                    recipe: finishRecipe !== "PENDING-RECIPE" ? finishRecipe : (so.recipe || "PENDING-RECIPE"),
                    totalParts,
                    paintSize, paintSizes: hasSize ? paintSizes : null,
                    dimensions: { length: Number(so.length) || 0, width: Number(so.width) || 0, height: Number(so.height) || 0 },
                    cpqSpecs,
                    imageUrl: drawingUrl,
                    fabNotes, fabMethod,
                    note: so.memo || job.sidemark || "",
                    reqDate: so.reqDate || "",
                    partsList,
                    currentPhase: "Setup", stepStatus: 'Pending', currentStepIndex: 0,
                    tasks: makeFullTasks(),
                    machineAssigned: null, redlineAlert: false,
                    // §A1: a small-only order (no custom sibling) has no shop-start event to
                    // trigger its release, so send it to Pick/Pack now. Orders paired with a
                    // custom sibling wait until the shop operator STARTS the custom job.
                    sentToPickPack: !hasCustom, pickStatus: 'Pending',
                    shopSiblingId: hasCustom ? shopId : null, hasCustomSibling: hasCustom,
                    customFabStatus: 'Pending',
                    createdAt: Date.now(), updatedAt: Date.now(), createdBy: currentUser
                });
                addLog(`Created Finishing WO ${finId} (${partsList.length} small lines).`, "success");
            }

            // --- Shop (custom fabrication) ---
            if (hasCustom) {
                const outSnap = await getDocs(collection(db, "hq_outsource_finishes"));
                const outsourceFinishes = outSnap.docs.map(d => d.data());
                const matchedOutsource = outsourceFinishes.find(f => finishRecipe.toUpperCase().includes(String(f.name).toUpperCase()));
                const isOutsourced = !!matchedOutsource;
                // Fundamental rule (Stuart 2026-07-15): ANY in-house finish (a real recipe that
                // isn't an outsourced-plating match and isn't mill/raw) → the custom parts get
                // phosphated at the station adjacent to custom fab. The shop card renders
                // "Parts Require Phosphate" as the last router step (checkbox reminder only —
                // no NetSuite /P conversion like small parts).
                const needsPhosphating = !isOutsourced && finishRecipe !== 'PENDING-RECIPE' && !/\b(MILL|RAW|UNFINISHED)\b/i.test(finishRecipe);
                const cutLine = customLines.find(l => l.cutLength);
                const cpqSpecs = {};
                customLines.forEach(l => { cpqSpecs[cleanLineName(l.name)] = `Qty: ${l.qty}`; });
                // Structured per-line cut list the Shop custom card renders.
                const cutList = customLines.map(l => ({
                    name: cleanLineName(l.name),
                    qty: Number(l.qty) || 1,
                    // Per-configuration count + multiplier, so the shop card can say "2 × 7"
                    // rather than a bare 14 (Stuart 2026-08-03).
                    qtyEach: l.qtyEach != null ? Number(l.qtyEach) : null,
                    configQty: l.configQty != null ? Number(l.configQty) : null,
                    cutLength: l.cutLength || null,
                    partId: l.partId || null,
                    legacyErpId: l.legacyErpId || l.partId || null
                }));
                const qty = customLines.reduce((s, l) => s + (Number(l.qty) || 0), 0) || customLines.length;

                await setDoc(doc(db, "shop_custom_orders", shopId), {
                    id: shopId, woNum: shopId,
                    orderKey, quoteId: so.hqJobId, salesOrderId: so.soId || null,
                    finSiblingId: hasSmall ? finId : null, hasSmallSibling: hasSmall,
                    status: 'Pending',
                    item: cleanLineName(customLines[0]?.name) || job.cpqData?.cartItems?.[0]?.assemblyName || 'Custom App Order',
                    partNum: customLines[0]?.legacyErpId || customLines[0]?.partId || '',
                    qty,
                    cutLength: cutLine?.cutLength || null,
                    cutList,
                    clientName: customerName, customerId,
                    isOutsourced, finishRecipe, needsPhosphating,
                    outsourcePrice: isOutsourced ? (matchedOutsource.multiplier || 0) : 0,
                    category: 'Custom Fabrication',
                    priority: 999,
                    brand: activeBrand,
                    note: so.memo || job.sidemark || "",
                    visionNotes, bracketNotes,
                    cpqSpecs,
                    imageUrl: drawingUrl,
                    fabNotes, fabMethod,
                    reqDate: so.reqDate || "",
                    createdAt: Date.now(), createdBy: currentUser
                });
                addLog(`Created Shop custom order ${shopId}${fabMethod ? ` [${fabMethod}]` : ''} (${customLines.length} custom lines).`, "success");
            }

            // Packaging: create the packaging order alongside finishing + shop (shared orderKey)
            // so it lands in the Packaging inbox the moment the SO is split. Carries every line
            // (poles = Custom division, small parts) plus the CPQ config — the paired CPQ steps
            // are what decide which pieces bolt together / pack as one assembled (T-shaped) unit.
            const pkgId = `PKG-${orderKey}`;
            // Keep non-physical lines out of packaging: fees, the assembly/header line (-ASM-),
            // and the Rod-Material config line (records wood/metal; the rod is the Pole Length line).
            const keptLines = lines.filter(l =>
                !(!l.partId && /\bfee\b/i.test(l.name || '')) &&
                !(l.partId && /-ASM-/i.test(l.partId)) &&
                !(/^(wood|metal)$/i.test(l.partId || '') || /rod material/i.test(l.name || ''))
            );
            // Rings are a finish line with no geometry — resolve the brand's FIPR part footprint
            // once so packaging cuts an exact slot instead of the 2.25" default.
            const hasRing = keptLines.some(l => /\bring\b/i.test(l.name || ''));
            const ringFootprint = hasRing ? await resolveRingFootprint(activeBrand) : null;
            const pkgItems = keptLines.map(l => {
                const part = l.partId ? partCache.get(l.partId) : null;
                // Pole = the cut-to-length rod (Pole Length line). Backplates / bracket arms are
                // also fab-Custom but pack flat in the small box, so don't call them poles.
                const isPolePart = Number(l.cutLength) > 0 || /pole\s*length/i.test(l.name || '');
                const param = part?.manufacturingSpecs?.parametric || {};
                const fw = parseFloat(param.width), fh = parseFloat(param.height), ft = parseFloat(param.thickness);
                // Traced part footprint (in) for the small-parts foam nest; thick drives the T-unit
                // (backplate+arm) compose + pole bore. Rings borrow the FIPR footprint. null -> defaults.
                let footprint = (fw > 0 && fh > 0) ? { w: fw, h: fh, thick: ft > 0 ? ft : null } : null;
                if (!footprint && /\bring\b/i.test(l.name || '') && ringFootprint) footprint = ringFootprint;
                return {
                    partId: l.partId || null,
                    partName: cleanLineName(l.name),
                    legacyErpId: l.legacyErpId || part?.legacyErpId || null,
                    qty: Number(l.qty) || 1,
                    division: isPolePart ? 'pole' : 'small',
                    partHandling: l.partHandling || (classifyLine(l, part) === DIVISION_CUSTOM ? 'Custom' : 'Small Parts'),
                    cutLength: l.cutLength || null,
                    dimensions: l.dimensions || null,
                    footprint,
                    // Per-component .glb so the nester can trace the true cut silhouette.
                    glbUrl: part?.componentGlbUrl || null,
                };
            });
            const pkgDoc = {
                id: pkgId, orderKey, quoteId: so.hqJobId || null, salesOrderId: so.soId || null,
                brand: activeBrand || null, customerId: customerId || null, customerName: customerName || null, customer: customerName || null,
                sidemark: job.sidemark || "", reqDate: so.reqDate || "", note: so.memo || "",
                status: 'pending',
                items: pkgItems,
                // Fab geometry drives the pole box width: french-return bends need the wider 8" box.
                fab: { shape: fabNotes.shape || null, qtyBends: fabNotes.qtyBends || 0, qtyMiterReturns: fabNotes.qtyMiterReturns || 0 },
                // cpqData NOT stored here — large, and the grouping step re-fetches it via quoteId.
                finSiblingId: hasSmall ? finId : null, shopSiblingId: hasCustom ? shopId : null,
                createdAt: Date.now(), updatedAt: Date.now(), createdBy: currentUser || null
            };
            // Strip any undefined (Firestore rejects it anywhere in the doc) via a JSON round-trip.
            await setDoc(doc(db, "packaging_orders", pkgId), JSON.parse(JSON.stringify(pkgDoc)));
            addLog(`Created Packaging order ${pkgId} (${pkgItems.length} lines).`, "success");

            // Mark the originating job + SO board entry as imported.
            await updateDoc(doc(db, "jobs", so.hqJobId), {
                salesOrderId: so.soId || null,
                status: 'SO_CONFIRMED',
                dateImported: new Date().toISOString().split('T')[0]
            });
            await updateDoc(doc(db, "hq_sales_orders", so.id), {
                status: "Dispatched",
                pushedToFinishing: hasSmall,
                pushedToShop: hasCustom,
                autoSplit: true,
                dispatchedAt: Date.now(),
                dispatchedBy: currentUser || ''
            });

            alert(`✅ SO ${orderKey} split: ${hasSmall ? 'Finishing ✓' : '—'}  ${hasCustom ? 'Shop ✓' : '—'}`);
            loadRTGOrders();
        } catch (error) {
            console.error("Auto-Split Error:", error);
            addLog(`Auto-Split Failed: ${error.message}`, "error");
            alert(`Failed to auto-split Sales Order:\n${error.message || error}`);
        }
    };

    const pushToFinishing = async (hqOrder, orderType) => {
        if (!window.confirm(`Push HQ Order ${hqOrder.id} to the Finishing Floor Setup Queue?`)) return;
        // STOP MECHANISM (Stuart 2026-07-21): a second tap must never quietly duplicate the
        // floor card — an already-dispatched order needs an explicit, scary re-confirm.
        if (hqOrder.pushedToFinishing && !window.confirm(`⚠ ${hqOrder.woNo || hqOrder.id} was ALREADY dispatched to finishing.\n\nRelease it AGAIN anyway? Normally NO — this re-copies the floor card.`)) return;

        // SALES-SNAPSHOT stock WOs (2026-07-16): the snapshot pre-builds the COMPLETE finishing
        // doc (pole rack info, paint sizes, stock ids) and parks the WO here for review —
        // releasing it is a verbatim copy, so nothing is lost or re-derived at dispatch.
        if (hqOrder.finPayload && hqOrder.finPayload.id) {
            try {
                const fp = hqOrder.finPayload;
                await setDoc(doc(db, "fin_workorders", fp.id), { ...fp, dispatchedAt: Date.now(), dispatchedBy: currentUser || '' });
                await updateDoc(doc(db, "hq_work_orders", hqOrder.id), { pushedToFinishing: true, status: "Dispatched" });
                // ROUTE A (2026-07-16): these stocked items are real NetSuite assemblies with BOMs,
                // so releasing to the floor ALSO queues a real NetSuite work order (outbox — serial,
                // retried, idempotent). On-Ord sees it on the next live pull; component demand is
                // real; the floor's bake-complete auto-queues the WO COMPLETION (server trigger).
                let nsQueuedNote = '';
                try {
                    const nsConfig = BRAND_NETSUITE_MAP[activeBrand] || {};
                    // Resolve the assembly's NetSuite internal id from THREE sources — the payload
                    // field → the Master Library (by item #) → the WO id itself (WO-STK-<id>-…) —
                    // so one dropped field can never silently skip the NetSuite work order.
                    let nsAsmId = String(fp.stockInternalId || '');
                    let idSrc = 'payload';
                    if (!nsAsmId && fp.stockErpId) {
                        try {
                            const libSnap = await getDocs(query(collection(db, 'Approved_Designs'), where('legacyErpId', '==', fp.stockErpId)));
                            const hit = libSnap.docs.map(d => d.data()).find(p => p.netSuiteInternalId);
                            if (hit) { nsAsmId = String(hit.netSuiteInternalId); idSrc = 'library'; }
                        } catch (lookErr) { /* fall through to the WO-id parse */ }
                    }
                    if (!nsAsmId) {
                        const m = String(hqOrder.id || '').match(/^WO-STK-(\d+)-/);
                        if (m) { nsAsmId = m[1]; idSrc = 'wo-id'; }
                    }
                    if (nsAsmId && nsConfig.location && (hqOrder.nsWoQueued || hqOrder.nsWoId || fp.nsWoId)) {
                        // STOP MECHANISM: one NetSuite work order per app WO, ever — a re-release
                        // (or double tap) must not queue a second one.
                        addLog(`ℹ NetSuite WO already queued/created for ${fp.woNum || fp.id} — not queued again.`, 'warn');
                        nsQueuedNote = '\n\nℹ The NetSuite work order was already queued/created earlier — NOT duplicated.';
                    } else if (nsAsmId && nsConfig.location) {
                        await enqueueNsWrite({
                            kind: 'workorder',
                            label: `NS WO — build ${fp.stockErpId || fp.id} ×${fp.totalParts}`,
                            sourceApp: 'RTG', createdBy: currentUser || '',
                            targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/workorder',
                            method: 'POST',
                            payload: {
                                // NetSuite's workorder record names the assembly field `assemblyItem`
                                // (plain `item` is rejected with FIELD_PARAM_REQD — learned 2026-07-17).
                                assemblyItem: { id: nsAsmId },
                                quantity: Number(fp.totalParts) || 1,
                                location: { id: nsConfig.location },
                                subsidiary: { id: nsConfig.subsidiary },
                                ...(fp.reqDate ? { endDate: fp.reqDate } : {}),
                                memo: `Stock build ${fp.woNum || fp.id} (Sales Snapshot)`
                            },
                            // Ids stamp back onto BOTH docs: the floor card shows the WO#, and the
                            // completion trigger needs nsWoId on the fin doc.
                            writeBack: [
                                { collection: 'fin_workorders', docId: fp.id, patch: {}, idField: 'nsWoId', tranField: 'nsWoTran' },
                                { collection: 'hq_work_orders', docId: hqOrder.id, patch: {}, idField: 'nsWoId', tranField: 'nsWoTran' }
                            ]
                        });
                        await updateDoc(doc(db, "hq_work_orders", hqOrder.id), { nsWoQueued: true });
                        addLog(`📤 NetSuite work order queued: ${fp.stockErpId || fp.id} ×${fp.totalParts}${idSrc !== 'payload' ? ` (internal id recovered via ${idSrc})` : ''}.`, 'success');
                        nsQueuedNote = '\n\n📤 A real NetSuite work order is queued (11.1 → NetSuite Sync Queue) — On-Ord picks it up on the next live pull, and completion posts automatically when the bake finishes.';
                    } else {
                        const why = !nsAsmId ? 'no NetSuite internal id found in the payload, the Master Library, or the WO id' : 'no NetSuite location mapping for this brand';
                        addLog(`⚠ No NetSuite WO queued for ${fp.woNum || fp.id} — ${why}.`, 'warn');
                        nsQueuedNote = `\n\n⚠ No NetSuite work order queued — ${why}.`;
                    }
                } catch (obErr) {
                    addLog(`⚠ NetSuite WO queue failed for ${hqOrder.id}: ${obErr.message}`, 'error');
                    nsQueuedNote = '\n\n⚠ NetSuite work order could NOT be queued — floor release stands; create the WO manually or re-check 11.1.';
                }
                alert(`Successfully pushed ${fp.id} to Finishing Floor Setup Queue!${nsQueuedNote}`);
                loadRTGOrders();
            } catch (error) {
                console.error("Dispatch Error:", error);
                addLog(`Dispatch Failed: ${error.message}`, "error");
                alert("Failed to push to Finishing Floor. Check permissions/console.");
            }
            return;
        }

        try {
            const { originalJob, finishRecipe, svgUri } = await fetchEnrichedJobData(hqOrder.hqJobId, orderType);

            let cpqSpecs = {};
            if (originalJob && originalJob.cpqData && originalJob.cpqData.breakdown) {
                originalJob.cpqData.breakdown.forEach(item => {
                    if (isDisplayOnlyLine(item)) return; // headers, discount/net rows AND size/projection echoes
                    cpqSpecs[item.name] = `Qty: ${item.qty}`;
                });
            }

            // Fix the double WO-WO- issue by just using the ID properly
            let finWorkOrderId = hqOrder.id;
            if (orderType === 'sales' && !finWorkOrderId.startsWith('WO-')) {
                finWorkOrderId = `WO-${hqOrder.soId || hqOrder.id}`;
            }
            
            // Unified contract (§3). No SO for stock builds -> orderKey falls back to the WO/quote id.
            const orderKey = (orderType === 'sales' ? hqOrder.soId : null) || hqOrder.hqJobId || hqOrder.id;
            const finPayload = {
                id: finWorkOrderId,
                displayId: finWorkOrderId,
                woNum: finWorkOrderId,
                orderKey,
                quoteId: hqOrder.hqJobId || null,
                salesOrderId: (orderType === 'sales' ? hqOrder.soId : null) || null,
                estimateId: originalJob?.netsuiteEstimateId || null,
                orderType: orderType,
                soId: hqOrder.soId || null,
                soNum: hqOrder.soId || null,
                customerId: originalJob?.customer?.id || null,
                customerName: originalJob?.customer?.name || hqOrder.customer || "Internal Stock",
                customer: originalJob?.customer?.name || hqOrder.customer || "Internal Stock",
                clientName: originalJob?.customer?.name || hqOrder.customer || "Internal Stock",
                recipe: finishRecipe !== "PENDING-RECIPE" ? finishRecipe : (hqOrder.recipe || "PENDING-RECIPE"),
                reqDate: hqOrder.reqDate || "",
                type: hqOrder.type || "Mixed",
                totalParts: Number(hqOrder.totalParts) || 1,
                // JUST FOR PAINT (Stuart 2026-08-03): a legacy item with no assembly. Everything
                // packing needs to close it out in NetSuite rides here, because by then there is no
                // library record to look anything up in. onStockBuildDone skips it on its own —
                // that trigger requires an nsWoId and a paint run has none.
                paintOnly: hqOrder.paintOnly === true,
                jfpItemCode: hqOrder.jfpItemCode || null,
                jfpItemId: hqOrder.jfpItemId || null,
                jfpItemName: hqOrder.jfpItemName || null,
                jfpFinishLabel: hqOrder.jfpFinishLabel || null,
                stockErpId: hqOrder.paintOnly === true ? (hqOrder.jfpItemCode || null) : (hqOrder.rootItem || hqOrder.variantErpId || null),
                // Scheduler keys. A stock build is one finished assembly -> one size + one product
                // type, so the whole quantity packs into that size and resolves one matrix cell.
                paintSize: (hqOrder.paintSize || '').toUpperCase() || null,
                productType: (hqOrder.productType || '').toUpperCase() || null,
                paintSizes: (hqOrder.paintSize && ['S', 'M', 'L'].includes((hqOrder.paintSize || '').toUpperCase()))
                    ? { S: 0, M: 0, L: 0, [(hqOrder.paintSize).toUpperCase()]: Number(hqOrder.totalParts) || 0 }
                    : null,
                note: hqOrder.memo || originalJob?.sidemark || "",
                cpqSpecs: cpqSpecs,
                imageUrl: svgUri || originalJob?.finalImageUrl || null,

                dimensions: {
                    length: Number(hqOrder.length) || 10,
                    width: Number(hqOrder.width) || 5,
                    height: Number(hqOrder.height) || 2
                },

                partsList: [],
                currentPhase: "Setup",
                stepStatus: 'Pending',
                currentStepIndex: 0,
                tasks: makeFullTasks(),
                machineAssigned: null,
                redlineAlert: false,
                sentToPickPack: false,
                pickStatus: 'Pending',
                shopSiblingId: null,
                hasCustomSibling: false,
                customFabStatus: 'Pending',
                brand: activeBrand,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                createdBy: currentUser
            };

            await setDoc(doc(db, "fin_workorders", finWorkOrderId), finPayload);

            // Change status to Dispatched so it leaves the RTG board
            const collectionName = orderType === 'sales' ? "hq_sales_orders" : "hq_work_orders";
            await updateDoc(doc(db, collectionName, hqOrder.id), { 
                pushedToFinishing: true,
                dispatchedAt: Date.now(),
                dispatchedBy: currentUser || '',
                status: "Dispatched" 
            });

            addLog(`Dispatched ${finWorkOrderId} to Finishing Floor!`, "success");
            alert(`Successfully pushed ${finWorkOrderId} to Finishing Floor Setup Queue!`);
            loadRTGOrders(); 

        } catch (error) {
            console.error("Dispatch Error:", error);
            addLog(`Dispatch Failed: ${error.message}`, "error");
            alert("Failed to push to Finishing Floor. Check permissions/console.");
        }
    };

    const pushToShop = async (hqOrder, orderType) => {
        if (!window.confirm(`Push HQ Order ${hqOrder.id} to the Shop Floor Custom Fabrication Queue?`)) return;

        try {
            const { originalJob, svgUri, finishRecipe } = await fetchEnrichedJobData(hqOrder.hqJobId, orderType);

            let cpqSpecs = {};
            if (originalJob && originalJob.cpqData && originalJob.cpqData.breakdown) {
                originalJob.cpqData.breakdown.forEach(item => {
                    if (isDisplayOnlyLine(item)) return; // headers, discount/net rows AND size/projection echoes
                    cpqSpecs[item.name] = `Qty: ${item.qty}`;
                });
            }

            const shopJobId = `SHOP-${hqOrder.id}`;
            
            const outSnap = await getDocs(collection(db, "hq_outsource_finishes"));
            const outsourceFinishes = outSnap.docs.map(d => d.data());
            const matchedOutsource = outsourceFinishes.find(f => finishRecipe.toUpperCase().includes(f.name.toUpperCase()));
            
            const isOutsourced = !!matchedOutsource;
            const outsourcePrice = isOutsourced ? (matchedOutsource.multiplier || 0) : 0;

            // Unified contract (§4). No SO for stock builds -> orderKey falls back to the WO/quote id.
            const orderKey = (orderType === 'sales' ? hqOrder.soId : null) || hqOrder.hqJobId || hqOrder.id;
            // §12.3: stock replenishment goes into the milling pipeline (milling backlog ->
            // scheduler), NOT the custom-fab finish flow. Tag it so the Shop Floor routes it
            // to the Milling tab's intake instead of the Custom tab's Start/Complete cards.
            const isStock = orderType === 'stock';
            const shopPayload = {
                id: shopJobId,
                woNum: shopJobId,
                orderKey,
                quoteId: hqOrder.hqJobId || null,
                salesOrderId: (orderType === 'sales' ? hqOrder.soId : null) || null,
                finSiblingId: null,
                hasSmallSibling: false,
                soNum: hqOrder.soId || hqOrder.woId || 'N/A',
                isStock,
                routeTo: isStock ? 'MILLING' : 'CUSTOM_FAB',
                partNum: hqOrder.rootItem || hqOrder.variantErpId || '',
                isOutsourced: isOutsourced,
                finishRecipe: finishRecipe,
                outsourcePrice: outsourcePrice,
                // Ensure the itemName gets populated correctly for stock builds
                item: originalJob?.itemName || originalJob?.name || hqOrder.variantErpId || hqOrder.rootItem || hqOrder.hqJobId || 'Custom App Order',
                qty: Number(hqOrder.totalParts) || 1,
                reqDate: hqOrder.reqDate || "",
                category: isStock ? 'Stock Milling' : 'Custom Fabrication',
                status: 'Pending',
                priority: 999,
                brand: activeBrand,
                customerId: originalJob?.customer?.id || null,
                clientName: originalJob?.customer?.name || hqOrder.customer || "Internal Stock",
                note: hqOrder.memo || originalJob?.sidemark || "",
                cpqSpecs: cpqSpecs,
                imageUrl: svgUri || originalJob?.finalImageUrl || null,
                // Explicit flag from the stock order wins; otherwise the in-house-finish rule
                // applies (real recipe, not outsourced, not mill/raw → phosphate last step).
                needsPhosphating: hqOrder.needsPhosphating || (!isOutsourced && finishRecipe !== 'PENDING-RECIPE' && !/\b(MILL|RAW|UNFINISHED)\b/i.test(finishRecipe)),
                isPlatingDemand: hqOrder.isPlatingDemand || false,
                rootItem: hqOrder.rootItem || '',
                createdAt: Date.now(),
                createdBy: currentUser
            };

            await setDoc(doc(db, "shop_custom_orders", shopJobId), shopPayload);

            // Change status to Dispatched so it leaves the RTG board
            const collectionName = orderType === 'sales' ? "hq_sales_orders" : "hq_work_orders";
            await updateDoc(doc(db, collectionName, hqOrder.id), { 
                pushedToShop: true,
                status: "Dispatched" 
            });

            addLog(`Dispatched ${shopJobId} to Shop Floor!`, "success");
            alert(`Successfully pushed ${shopJobId} to Shop Floor Custom Fabrication Queue!`);
            loadRTGOrders(); 

        } catch (error) {
            console.error("Dispatch Error:", error);
            addLog(`Dispatch Failed: ${error.message}`, "error");
            alert("Failed to push to Shop Floor. Check permissions/console.");
        }
    };

    const deleteOrder = async (collectionName, id) => {
        if (!window.confirm(`Permanently remove ${id} from the dispatch board?`)) return;
        try {
            await deleteDoc(doc(db, collectionName, id));
            addLog(`Deleted document: ${id}`, "warn");
            loadRTGOrders();
        } catch (e) {
            console.error(e);
            addLog(`Failed to delete ${id}: ${e.message}`, "error");
        }
    };

    const cardStyle = { border: '1px solid var(--line)', padding: '20px', marginBottom: '16px', borderRadius: '2px', background: '#fff', transition: 'box-shadow 0.2s' };
    const btnStyle = { padding: '10px 16px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink)', background: 'var(--paper-2)', border: '1px solid var(--line)', cursor: 'pointer', transition: 'all 0.2s ease', whiteSpace: 'nowrap' };

    // ── CLOSE EVERYWHERE (Stuart 2026-08-10: "no clear path to closing — each screen has
    // different availability of actions") ───────────────────────────────────────────────────
    // ONE button that closes an order on every surface at once: the RTG ledger, every linked
    // finishing-floor job (leaves the Setup Queue, Active Floor and the WMS pick), every linked
    // shop-floor job, and — when a real NetSuite work order exists that hasn't completed — a
    // CLOSE queued in NetSuite so the component commitment releases. Docs are kept for history;
    // nothing is deleted. Linked docs are found by every identity the order may be keyed under
    // (doc id, woId, soId, orderKey, hqJobId → fin id / orderKey / SHOP-<key>).
    const closeOrderEverywhere = async (order, kind) => {
        const isSales = kind === 'sales';
        const hqColl = isSales ? 'hq_sales_orders' : 'hq_work_orders';
        const ref = isSales ? `SO ${order.soId || order.id}` : `WO ${order.nsWoTran || order.woId || order.id}`;
        const keys = [...new Set([order.id, order.woId, order.soId, order.orderKey, order.hqJobId].filter(Boolean).map(String))];
        const finDocs = new Map(), shopDocs = new Map();
        try {
            await Promise.all(keys.map(async (k) => {
                const [f, s] = await Promise.all([getDoc(doc(db, 'fin_workorders', k)), getDoc(doc(db, 'shop_custom_orders', `SHOP-${k}`))]);
                if (f.exists()) finDocs.set(f.id, f.data());
                if (s.exists()) shopDocs.set(s.id, s.data());
            }));
            const [fq, sq] = await Promise.all([
                getDocs(query(collection(db, 'fin_workorders'), where('orderKey', 'in', keys.slice(0, 10)))),
                getDocs(query(collection(db, 'shop_custom_orders'), where('orderKey', 'in', keys.slice(0, 10)))),
            ]);
            fq.forEach(d => finDocs.set(d.id, d.data()));
            sq.forEach(d => shopDocs.set(d.id, d.data()));
        } catch (e) { return alert('Could not look up the linked floor documents: ' + (e.message || e)); }

        const finList = [...finDocs.entries()];
        const finNs = finList.find(([, d]) => d.nsWoId && !d.nsWoClosed && !d.nsWoCompletionPosted);
        const ns = finNs
            ? { docId: finNs[0], coll: 'fin_workorders', nsWoId: finNs[1].nsWoId, tran: finNs[1].nsWoTran }
            : (order.nsWoId && !order.nsWoClosed ? { docId: order.id, coll: hqColl, nsWoId: order.nsWoId, tran: order.nsWoTran } : null);

        const nsLine = ns ? `\n• NetSuite WO ${ns.tran || ns.nsWoId} → CLOSE queued (releases the component commitment)` : '';
        if (!window.confirm(`✕ CLOSE ${ref} EVERYWHERE?\n\n• RTG record → Closed (leaves this board)\n• ${finDocs.size} finishing floor job(s) → Closed (leave the Setup Queue, Active Floor & WMS pick)\n• ${shopDocs.size} shop floor job(s) → closed out of the shop queues${nsLine}\n\nDocuments are kept for history — nothing is deleted.`)) return;
        try {
            const stamp = { closedAt: Date.now(), closedBy: currentUser || '', closedFrom: 'RTG' };
            for (const [id] of finList) {
                await updateDoc(doc(db, 'fin_workorders', id), { currentPhase: 'Closed', stepStatus: 'Closed', status: 'Closed', sentToPickPack: false, pickStatus: 'Closed', ...stamp });
            }
            for (const [id] of shopDocs) {
                // The shop queues exit on 'Completed'; `closed: true` records it was closed, not built.
                await updateDoc(doc(db, 'shop_custom_orders', id), { status: 'Completed', closed: true, ...stamp });
            }
            await updateDoc(doc(db, hqColl, order.id), { status: 'Closed', ...stamp });
            if (ns) {
                await enqueueNsWrite({
                    kind: 'workorderclose', label: `Close NS WO ${ns.tran || ns.nsWoId} — ${ref}`,
                    sourceApp: 'RTG', createdBy: currentUser || '',
                    targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/workorder/${ns.nsWoId}/!transform/workorderclose`,
                    method: 'POST', payload: { memo: `Closed from RTG (${ref})` },
                    writeBack: { collection: ns.coll, docId: ns.docId, patch: { nsWoClosed: true } }
                });
            }
            addLog(`✕ ${ref} closed everywhere — ${finDocs.size} finishing, ${shopDocs.size} shop${ns ? ', NetSuite close queued' : ''}.`, 'success');
            loadRTGOrders();
        } catch (e) {
            alert('Close failed partway: ' + (e.message || e) + '\n\nRe-run Close — docs already closed are unaffected.');
        }
    };

    // ── DISPATCHED STRIP ────────────────────────────────────────────────────────────────────
    // A dispatched order is DONE from this board's point of view but must still be VISIBLE with
    // its status (Stuart 2026-07-28). It renders as one condensed row — no action buttons except
    // View / Config — so the pending work above it stays the thing you act on. Rows dispatched in
    // the last 7 days show by default; older ones sit behind the archive toggle at the foot of
    // the column, which is the weekly condense he asked for.
    const dispatchedRow = (o, kind) => (
        <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', marginBottom: '6px', background: '#fff', border: '1px solid var(--line)', borderLeft: '4px solid #5a8f5a', borderRadius: '2px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.9rem', color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={o.id}>
                    {kind === 'sales' ? `SO: ${o.soId || o.id}${o.customer ? ` · ${o.customer}` : ''}` : `WO: ${o.nsWoTran || o.woId || o.id}`}
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', color: '#5a8f5a', marginTop: '3px' }}>
                    Sent to floor · {dispatchedChip(o)} · {whenStr(o.dispatchedAt)}
                </div>
            </div>
            <button style={{ ...btnStyle, padding: '6px 10px', fontSize: '9px' }} onClick={() => handleViewOrder(o, kind)}>View</button>
            {o.hqJobId && <button style={{ ...btnStyle, padding: '6px 10px', fontSize: '9px' }} onClick={() => setCfgQuote(o.hqJobId)}>🔍</button>}
            {kind === 'sales' && (
                <button title="Re-run the split with the current routing rules — the floor docs use fixed ids (WO-… / SHOP-…), so this overwrites rather than duplicating."
                    style={{ ...btnStyle, padding: '6px 10px', fontSize: '9px' }} onClick={() => autoSplitSalesOrder(o)}>↻ Re-dispatch</button>
            )}
            <button title="Close this order EVERYWHERE — RTG, finishing floor, shop floor, and the NetSuite work order if one exists. Docs kept for history."
                style={{ ...btnStyle, padding: '6px 10px', fontSize: '9px', color: '#d9534f', borderColor: '#d9534f' }} onClick={() => closeOrderEverywhere(o, kind)}>✕ Close</button>
        </div>
    );

    const dispatchedSection = (board, kind) => {
        if (!board.recent.length && !board.archived.length) return null;
        return (
            <div style={{ marginTop: board.pending.length ? '18px' : '12px', paddingTop: '14px', borderTop: '1px dashed var(--line)' }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--ink-soft)', marginBottom: '10px' }}>
                    Dispatched this week ({board.recent.length})
                </div>
                {board.recent.length === 0 && <p style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.8rem', margin: '0 0 8px' }}>Nothing dispatched in the last 7 days.</p>}
                {board.recent.map(o => dispatchedRow(o, kind))}
                {board.archived.length > 0 && (
                    <>
                        <button onClick={() => setShowArchive(v => !v)} style={{ ...btnStyle, width: '100%', marginTop: '4px', fontSize: '9px', borderStyle: 'dashed' }}>
                            {showArchive ? '▾ Hide older' : `▸ Older than 7 days · ${board.archived.length}`}
                        </button>
                        {showArchive && (
                            <div style={{ marginTop: '8px' }}>
                                <div style={{ opacity: 0.75 }}>{board.archived.map(o => dispatchedRow(o, kind))}</div>
                                <button onClick={() => archiveOlder(board, kind === 'sales' ? 'hq_sales_orders' : 'hq_work_orders', kind === 'sales' ? 'sales order' : 'work order')}
                                    title="Take these off the dispatch board. Nothing else changes — the floors, Pick/Pack and NetSuite keep them exactly as they are."
                                    style={{ ...btnStyle, width: '100%', marginTop: '6px', fontSize: '9px' }}>
                                    📦 Archive these {board.archived.length} off the board
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        );
    };

    // Clickable job-log row → best available detail view: the SO/WO modal if we still hold the
    // record, else the read-only configured-item 3D viewer via the linked quote.
    const openJobDetails = (job) => {
        if (job.soRec) return handleViewOrder(job.soRec, 'sales');
        if (job.woRec) return handleViewOrder(job.woRec, 'stock');
        if (job.quoteId) return setCfgQuote(job.quoteId);
        alert('No linked detail record for this job yet (it may have been dispatched and cleared from HQ).');
    };
    const fmtD = (v) => { if (v == null || v === '') return '—'; const ms = typeof v === 'number' ? v : Date.parse(v); if (isNaN(ms)) return String(v); return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }); };

    // Map an order + its linked CPQ quote into the FormPreview data shape. Line items come from the
    // quote's cpqData.breakdown (sans ▶ assembly headers); customer/ship-to from the quote.
    const buildFormData = (order, job) => {
        const a = job?.customShippingAddress;
        const cityLine = a ? [a.city, a.state, a.zip].filter(Boolean).join(', ') : '';
        const shipTo = a ? [a.addressee || a.attention, a.addr1, a.addr2, cityLine].filter(Boolean) : null;
        const custName = job?.customer?.name || (typeof order?.customer === 'string' ? order.customer : '') || '';
        const lines = getJobLines(job).map(l => ({
            item: l.legacyErpId || l.partId || '',
            desc: String(l.name || '').replace(/^\s*[-▶]\s*/, '').trim(),
            qty: l.qty,
            cut: l.cutLength || null,
            price: (l.price != null) ? l.price : ((l.total != null && l.qty) ? l.total / l.qty : 0),
        }));
        return {
            billTo: custName ? [custName] : [],
            shipTo: (shipTo && shipTo.length) ? shipTo : (custName ? [custName] : []),
            lines,
            date: order?.reqDate || '',
            po: order?.poNum || order?.po || '',
            total: job?.cpqData?.totalPrice,
        };
    };

    // Print a branded doc for the order currently open in the View modal. The NetSuite SO# is the
    // doc number (printed + barcoded); header/footer/terms come from the Admin form templates.
    const printDoc = (formType) => {
        const order = activeViewOrder, job = activeJobDetails;
        if (!order) return;
        const tpl = formTemplates[formType] || {};
        const brand = order.brand || activeBrand;
        const docNumber = order.soId || order.woId || order.id;
        printForm(
            <FormPreview type={formType} brand={brand} logoUrl={brandLogos[brand]} header={tpl.header} footer={tpl.footer} terms={tpl.terms} docNumber={docNumber} data={buildFormData(order, job)} />,
            `${formType.replace('_', ' ')} ${docNumber}`
        );
    };

    // One-click test seed: a complete Brimar French Return order (2× 8 ft poles + a center bracket
    // each, finish N80) written for the ACTIVE brand, then fanned out through the real auto-split
    // pipeline so it lands on every screen — RTG, Shop, Finishing, Packaging and Pick & Pack.
    const seedTestOrder = async () => {
        if (!activeBrand) return alert('Pick a brand first.');
        if (!window.confirm(`Seed the Brimar test order (2× 8 ft French Return poles + center brackets, finish N80) onto every screen for brand "${activeBrand}"?`)) return;
        setIsSyncing(true);
        try {
            const SO_NUM = TEST_SEED.soNum;
            const QUOTE_ID = TEST_SEED.quoteId;
            const soDocId = `SO-${SO_NUM}`;
            const reqDate = new Date(Date.now() + 14 * 864e5).toISOString().split('T')[0];

            // Pole = Custom (→ Shop); Center Bracket = Small Parts (→ Finishing). Two poles, a bracket each.
            const breakdown = [
                { name: '▶ Brimar French Return [Master Bath]', qty: 2, total: 901, isHeader: true },
                { name: '  - 8 ft French Return Pole — Finish N80', qty: 2, price: 412, total: 824, partHandling: 'Custom', partId: 'BRIMAR-FR-8FT', cutLength: 96 },
                { name: '  - Center Bracket & Mount — Finish N80', qty: 2, price: 38.5, total: 77, partHandling: 'Small Parts', partId: 'HCUMLPB410EB' },
            ];

            await setDoc(doc(db, "jobs", QUOTE_ID), {
                jobId: QUOTE_ID, brandId: activeBrand, status: 'CONFIGURED',
                customer: { id: 'BRIMAR', name: 'Brimar' },
                jobName: 'Brimar French Return — Test', sidemark: 'Master Bath',
                flowId: null, linkedAssemblyId: null,
                customShippingAddress: { attention: '', addressee: 'Brimar Inc.', addr1: '1 Research Drive', addr2: '', city: 'High Point', state: 'NC', zip: '27260', country: 'US' },
                cpqData: { totalPrice: 901, breakdown, configuration: {}, appliedRules: [] },
                createdAt: Date.now()
            }, { merge: true });

            await setDoc(doc(db, "hq_sales_orders", soDocId), {
                id: soDocId, soId: SO_NUM, nsInternalId: 'TEST',
                customer: 'Brimar', status: 'Approved', brand: activeBrand,
                recipe: 'N80', type: 'Custom', totalParts: 4,
                length: 96, width: 0, height: 0,
                reqDate, hqJobId: QUOTE_ID, memo: '2× 8 ft French Return poles + center brackets — Finish N80',
                createdAt: Date.now()
            }, { merge: true });

            // Real pipeline → Shop (WO/SHOP), Finishing (WO-…), Packaging (PKG-…).
            const seededSO = { id: soDocId, soId: SO_NUM, hqJobId: QUOTE_ID, brand: activeBrand, customer: 'Brimar', reqDate, recipe: 'N80', orderType: 'sales' };
            await autoSplitSalesOrder(seededSO, { skipConfirm: true });
            // The order has a custom pole, so its finishing WO normally waits for shop-start; force it
            // to Pick & Pack now so the test order is visible there too.
            await updateDoc(doc(db, "fin_workorders", `WO-${SO_NUM}`), { sentToPickPack: true, pickStatus: 'Pending' }).catch(() => {});

            addLog(`Seeded Brimar test order ${soDocId} across all screens (brand ${activeBrand}).`, 'success');
            alert(`✅ Seeded Brimar test order (${soDocId}) for brand "${activeBrand}".\n\nNow visible on: RTG Dispatch + Daily Job Log, Shop Floor, Finishing Floor, Packaging, and Pick & Pack. Print buttons on the SO view produce the Sales Order / Packing List / Invoice.`);
            loadRTGOrders();
        } catch (e) {
            console.error('seed failed', e);
            alert('Seed failed: ' + (e?.message || e));
        } finally { setIsSyncing(false); }
    };

    // Remove ONLY the Brimar test seed — the five fixed-id docs it created (quote, SO, shop,
    // finishing, packaging). Deterministic ids, so nothing real is ever touched.
    const removeTestOrder = async () => {
        if (!window.confirm('Remove the Brimar test order from every screen? This deletes only the seeded test docs — nothing else.')) return;
        setIsSyncing(true);
        try {
            const results = await Promise.all(testSeedDocs().map(async ([c, id]) => {
                try { const s = await getDoc(doc(db, c, id)); if (!s.exists()) return false; await deleteDoc(doc(db, c, id)); return true; }
                catch (e) { console.warn(`remove ${c}/${id} failed`, e); return false; }
            }));
            const n = results.filter(Boolean).length;
            addLog(`Removed Brimar test order — ${n} doc(s) deleted.`, 'info');
            alert(`✅ Brimar test order removed (${n} doc${n === 1 ? '' : 's'} deleted) — cleared from RTG, Shop, Finishing, Packaging, and Pick & Pack.`);
            loadRTGOrders();
        } catch (e) {
            console.error('remove failed', e);
            alert('Remove failed: ' + (e?.message || e));
        } finally { setIsSyncing(false); }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '30px', fontFamily: 'var(--sans)', backgroundColor: 'transparent', minHeight: '100vh' }}>
            <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                <div>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: '4px' }}>Action Center for Approved Orders</span>
                    <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>Ready to Go (RTG) Dispatch</h2>
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                    <button onClick={pullNSSalesOrders} disabled={isSyncing} style={{ ...btnStyle, background: isSyncing ? 'var(--paper)' : 'var(--ink)', color: isSyncing ? 'var(--ink-soft)' : '#fff', border: 'none' }}>
                        {isSyncing ? 'Syncing...' : 'Pull ERP Sales Orders'}
                    </button>
                    <button onClick={loadRTGOrders} style={{ ...btnStyle }}>
                        {loading ? 'Scanning...' : 'Refresh Dispatch List'}
                    </button>
                    <button onClick={seedTestOrder} disabled={isSyncing} title="Seed a complete Brimar French Return test order (2× 8ft poles + center brackets, N80) onto every screen for the active brand" style={{ ...btnStyle, background: 'var(--paper-2)', border: '1px dashed var(--line)' }}>
                        🌱 Seed Test Order
                    </button>
                    <button onClick={removeTestOrder} disabled={isSyncing} title="Delete only the Brimar test-order docs from every screen (nothing real is touched)" style={{ ...btnStyle, background: '#fff', border: '1px dashed #d9534f', color: '#d9534f' }}>
                        🗑 Remove Test Order
                    </button>
                </div>
            </div>

            <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
                
                {/* LEFT: 4x GRID BOARD */}
                <div style={{ flex: 1.5, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                    
                    {/* 1. SALES ORDERS */}
                    <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                        <div style={{ padding: '20px 24px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>Sales Orders</span>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Custom</span>
                        </div>
                        <div style={{ padding: '24px', flex: 1, background: 'var(--paper)', maxHeight: '600px', overflowY: 'auto' }}>
                            {soBoard.pending.length === 0 && <p style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.9rem', margin: 0 }}>No approved sales orders pending dispatch.</p>}
                            
                            {soBoard.pending.map(so => (
                                <div key={so.id} style={{ ...cardStyle, borderLeft: '4px solid var(--ink)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                                        <div>
                                            <div style={{ fontWeight: 500, fontSize: '1.1rem', color: 'var(--ink)' }}>SO: {so.soId || so.id}</div>
                                            <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '4px' }}>Cust: {so.customer || 'N/A'}</div>
                                        </div>
                                        <button onClick={() => deleteOrder('hq_sales_orders', so.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', padding: 0, color: 'var(--ink-soft)' }}>×</button>
                                    </div>
                                    {so.memo && (
                                        <div style={{ fontSize: '0.85rem', color: 'var(--ink)', marginBottom: '16px', fontStyle: 'italic', borderLeft: '2px solid var(--line)', paddingLeft: '8px' }}>
                                            "{so.memo}"
                                        </div>
                                    )}
                                    {/* Sales orders fan out to BOTH floors in one click — the split
                                        builds the cut list, parts list, drawing + links the halves.
                                        (Manual single-floor pushes live on the Work Order / stock cards.) */}
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                        <button style={{ ...btnStyle, flex: 2, background: so.autoSplit ? 'var(--paper-2)' : 'var(--ink)', color: so.autoSplit ? 'var(--ink-soft)' : '#fff', border: so.autoSplit ? '1px solid var(--line)' : 'none' }} onClick={() => autoSplitSalesOrder(so)}>
                                            {so.autoSplit ? 'Auto-Split ✓' : '⚡ Import & Auto-Split to Floors'}
                                        </button>
                                        <button style={{ ...btnStyle, flex: 1 }} onClick={() => handleViewOrder(so, 'sales')}>View</button>
                                        {so.hqJobId && <button style={{ ...btnStyle, flex: 1, background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)' }} onClick={() => setCfgQuote(so.hqJobId)}>🔍 Config</button>}
                                    </div>
                                </div>
                            ))}

                            {dispatchedSection(soBoard, 'sales')}
                        </div>
                    </div>

                    {/* 2. WORK ORDERS */}
                    <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                        <div style={{ padding: '20px 24px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>Work Orders</span>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Stock Builds</span>
                        </div>
                        <div style={{ padding: '24px', flex: 1, background: 'var(--paper)', maxHeight: '600px', overflowY: 'auto' }}>
                            {woBoard.pending.length === 0 && <p style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.9rem', margin: 0 }}>No approved work orders pending dispatch.</p>}
                            
                            {woBoard.pending.map(wo => (
                                <div key={wo.id} style={{ ...cardStyle, borderLeft: '4px solid var(--brass)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                                        <div>
                                            <div style={{ fontWeight: 500, fontSize: '1.1rem', color: 'var(--ink)' }} title={`${wo.id}${wo.nsWoTran ? ` · NetSuite ${wo.nsWoTran}` : ''}`}>WO: {wo.nsWoTran || wo.woId || wo.id}</div>
                                            <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '4px' }}>Build to Stock</div>
                                            {wo.needsPhosphating && <div style={{ fontSize: '0.8rem', color: '#d9534f', fontWeight: 600, marginTop: '4px' }}>*REQUIRES PHOSPHATING*</div>}
                                            {wo.isPlatingDemand && <div style={{ fontSize: '0.8rem', color: 'var(--brass)', fontWeight: 600, marginTop: '4px' }}>*PLATING DEMAND STOCK*</div>}
                                        </div>
                                        <button onClick={() => deleteOrder('hq_work_orders', wo.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', padding: 0, color: 'var(--ink-soft)' }}>×</button>
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                        <button style={{ ...btnStyle, flex: 1 }} onClick={() => handleViewOrder(wo, 'stock')}>View</button>
                                        <button style={{ ...btnStyle, flex: 1, background: wo.pushedToFinishing ? 'var(--paper-2)' : 'var(--ink)', color: wo.pushedToFinishing ? 'var(--ink-soft)' : '#fff', border: wo.pushedToFinishing ? '1px solid var(--line)' : 'none' }} onClick={() => pushToFinishing(wo, 'stock')}>
                                            {wo.pushedToFinishing ? 'Finishing Pushed ✓' : 'Push to Finishing'}
                                        </button>
                                        {wo.routeTo !== 'FINISHING' && (
                                            <button style={{ ...btnStyle, flex: 1, background: wo.pushedToShop ? 'var(--paper-2)' : 'var(--brass)', color: wo.pushedToShop ? 'var(--ink-soft)' : '#fff', border: wo.pushedToShop ? '1px solid var(--line)' : 'none' }} onClick={() => pushToShop(wo, 'stock')}>
                                                {wo.pushedToShop ? 'Shop Pushed ✓' : 'Push to Shop'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}

                            {dispatchedSection(woBoard, 'stock')}
                        </div>
                    </div>

                    {/* 3. PURCHASE ORDERS */}
                    <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                        <div style={{ padding: '20px 24px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>Purchase Orders</span>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Inbound</span>
                        </div>
                        <div style={{ padding: '24px', flex: 1, background: 'var(--paper)', maxHeight: '600px', overflowY: 'auto' }}>
                            {purchaseOrders.length === 0 && <p style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.9rem', margin: 0 }}>No approved purchase orders incoming.</p>}
                            
                            {purchaseOrders.map(po => (
                                <div key={po.id} style={{ ...cardStyle, borderLeft: `4px solid ${po.nsVendorId ? 'var(--brass)' : 'var(--line)'}` }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                                        <div>
                                            <div style={{ fontWeight: 500, fontSize: '1.1rem', color: 'var(--ink)' }}>PO: {po.poId || po.id}</div>
                                            <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '4px' }}>Vendor: {po.vendor || 'N/A'}{po.nsVendorId ? <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--brass)' }}> · NS {po.nsVendorId}</span> : <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: '#d9534f' }}> · no NS vendor id</span>}</div>
                                            <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', marginTop: '2px' }}>{(po.items || []).length} line(s){po.source === 'SALES_SNAPSHOT' ? ' · Sales Snapshot' : ''}</div>
                                        </div>
                                        <button onClick={() => deleteOrder('hq_purchase_orders', po.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', padding: 0, color: 'var(--ink-soft)' }}>×</button>
                                    </div>
                                    <button style={{ ...btnStyle, width: '100%', background: po.nsVendorId ? 'var(--brass)' : 'var(--paper-2)', color: po.nsVendorId ? '#fff' : 'var(--ink-soft)', border: 'none', marginBottom: '8px', cursor: po.nsVendorId ? 'pointer' : 'not-allowed' }} onClick={() => pushPoToNetSuite(po)}>⬆ Push PO → NetSuite</button>
                                    <button style={{ ...btnStyle, width: '100%', background: 'var(--ink)', color: '#fff', border: 'none' }} onClick={() => alert('Sent to Receiving Dock App')}>Alert Receiving Dock</button>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* 4. INVENTORY CONTROL */}
                    <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                        <div style={{ padding: '20px 24px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>Inventory Tasks</span>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Control</span>
                        </div>
                        <div style={{ padding: '24px', flex: 1, background: 'var(--paper)', maxHeight: '600px', overflowY: 'auto' }}>
                            {inventoryTasks.length === 0 && <p style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.9rem', margin: 0 }}>No active inventory tasks.</p>}
                            
                            {inventoryTasks.map(inv => (
                                <div key={inv.id} style={{ ...cardStyle, borderLeft: '4px solid var(--line)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                                        <div>
                                            <div style={{ fontWeight: 500, fontSize: '1.1rem', color: 'var(--ink)' }}>Task: {inv.taskId || inv.id}</div>
                                            <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '4px' }}>Type: {inv.type || 'Count'}</div>
                                        </div>
                                        <button onClick={() => deleteOrder('hq_inventory_tasks', inv.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', padding: 0, color: 'var(--ink-soft)' }}>×</button>
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                        <button style={{ ...btnStyle, flex: 1 }} onClick={() => alert('Cycle Count Dispatched')}>Dispatch Count</button>
                                        <button style={{ ...btnStyle, flex: 1 }} onClick={() => alert('Bin Transfer Initiated')}>Init Transfer</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                </div>

                {/* RIGHT: TERMINAL */}
                <div style={{ flex: 0.8, background: 'var(--dark)', border: '1px solid var(--line)', borderRadius: '2px', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', height: '800px', position: 'sticky', top: '20px', overflow: 'hidden' }}>
                    <div style={{ padding: '16px 20px', background: 'var(--dark-2)', color: 'var(--paper)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between' }}>
                        <span>>_ SuiteQL Pull Terminal</span>
                        <button onClick={() => setSyncLog([])} style={{ background: 'none', border: 'none', color: 'var(--paper)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', opacity: 0.6, textTransform: 'uppercase' }}>Clear</button>
                    </div>
                    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px', flex: 1, overflowY: 'auto', fontFamily: 'var(--mono)', fontSize: '11px', color: '#a8a5a0' }}>
                        {syncLog.length === 0 && <span style={{ opacity: 0.6 }}>Awaiting command...</span>}
                        {syncLog.map((log, idx) => {
                            let color = '#a8a5a0';
                            if (log.type === 'error') color = '#e27373';
                            if (log.type === 'success') color = '#7dbb81';
                            if (log.type === 'warn') color = '#e2b373';
                            
                            return (
                                <div key={idx} style={{ color, borderBottom: '1px solid #333', paddingBottom: '6px' }}>
                                    <span style={{ opacity: 0.5, marginRight: '10px' }}>[{log.time}]</span>
                                    {log.msg}
                                </div>
                            );
                        })}
                    </div>
                </div>

            </div>

            {/* ============ NETSUITE TRANSMIT LOG (live outbox tail) ============ */}
            {(() => {
                const nowMs = Date.now();
                const stuck = nsOutboxTail.filter(o => o.status === 'PENDING' && !o.attempts && (nowMs - (o.createdAt || nowMs)) > 3 * 60 * 1000);
                const chipC = (s) => s === 'POSTED' ? '#3a7d44' : (s === 'FAILED' ? '#d9534f' : 'var(--brass)');
                // NetSuite errors arrive as an RFC-9110 JSON envelope — the human-readable reason
                // lives in o:errorDetails[].detail. Pull those out; fall back to the raw string.
                const errDetail = (raw) => {
                    const s = String(raw || '');
                    const m = [...s.matchAll(/"detail"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map(x => x[1].replace(/\\"/g, '"').replace(/\\n/g, ' '));
                    return m.length ? m.join(' · ') : s;
                };
                const payloadSummary = (o) => {
                    const p = o.payload || {};
                    const bits = [];
                    if (p.assemblyItem?.id || p.item?.id) bits.push(`item ${p.assemblyItem?.id || p.item.id}`);
                    if (p.quantity != null) bits.push(`qty ${p.quantity}`);
                    if (p.location?.id) bits.push(`loc ${p.location.id}`);
                    if (p.subsidiary?.id) bits.push(`sub ${p.subsidiary.id}`);
                    if (p.endDate) bits.push(`due ${p.endDate}`);
                    if (p.tranId) bits.push(`tran ${p.tranId}`);
                    return bits.join(' · ');
                };
                return (
                    <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', marginBottom: '24px' }}>
                        <div style={{ padding: '14px 24px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                            <span style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)' }}>NetSuite Transmit Log</span>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>staged writes drain ~1/min · full queue + retry lives in 11.1 → NetSuite Sync Queue</span>
                        </div>
                        {stuck.length > 0 && (
                            <div style={{ padding: '12px 24px', background: '#fdf2f2', borderBottom: '1px solid #d9534f', color: '#d9534f', fontFamily: 'var(--mono)', fontSize: '11px', lineHeight: 1.6 }}>
                                ⚠ {stuck.length} entr{stuck.length === 1 ? 'y has' : 'ies have'} sat PENDING for over 3 minutes with ZERO attempts — the queue is NOT draining. The nsOutboxWorker cloud function isn't deployed/running. Cloud Shell: firebase deploy --only functions --project ce-m2c-design-collab
                            </div>
                        )}
                        <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
                            {nsOutboxTail.length === 0 && <div style={{ padding: '14px 24px', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--sans)', fontSize: '0.85rem' }}>Nothing staged yet — WO/PO pushes from this screen appear here with live status.</div>}
                            {nsOutboxTail.map(o => (
                                <div key={o.id} style={{ borderTop: '1px solid var(--paper-2)' }}>
                                    <div onClick={() => setOpenObId(openObId === o.id ? null : o.id)} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '8px 24px', fontFamily: 'var(--sans)', fontSize: '0.85rem', cursor: 'pointer' }} title="Click for full details">
                                        <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>{o.createdAt ? new Date(o.createdAt).toLocaleTimeString() : ''}</span>
                                        <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', padding: '2px 8px', border: `1px solid ${chipC(o.status)}`, color: chipC(o.status), whiteSpace: 'nowrap' }}>{o.status}</span>
                                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ink)' }}>{o.label || o.kind}{o.nsTran ? ` → ${o.nsTran}` : ''}{o.status === 'FAILED' && o.lastError ? ` — ${errDetail(o.lastError).slice(0, 140)}` : ''}</span>
                                        <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>{o.attempts ? `try ${o.attempts}` : ''}</span>
                                        <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>{openObId === o.id ? '▾' : '▸'}</span>
                                    </div>
                                    {openObId === o.id && (
                                        <div style={{ padding: '10px 24px 14px 24px', background: 'var(--paper)', fontFamily: 'var(--mono)', fontSize: '11px', lineHeight: 1.7, color: 'var(--ink)', userSelect: 'text' }}>
                                            <div style={{ color: 'var(--ink-soft)', overflowWrap: 'anywhere' }}>CALLED: {String(o.targetUrl || '').split('/services/rest/')[1] || o.targetUrl || '—'}</div>
                                            {payloadSummary(o) && <div style={{ color: 'var(--ink-soft)' }}>SENT: {payloadSummary(o)}</div>}
                                            {o.lastError && <div style={{ color: '#d9534f', overflowWrap: 'anywhere', marginTop: '4px' }}>NETSUITE SAID: {errDetail(o.lastError)}</div>}
                                            {o.lastError && errDetail(o.lastError) !== String(o.lastError) && <div style={{ color: 'var(--ink-soft)', overflowWrap: 'anywhere', marginTop: '4px', fontSize: '10px' }}>RAW: {String(o.lastError)}</div>}
                                            {o.nsId && <div style={{ marginTop: '4px' }}>NETSUITE ID: {o.nsId}{o.nsTran ? ` · ${o.nsTran}` : ''}</div>}
                                            {o.status === 'FAILED' && (
                                                <button onClick={(e) => { e.stopPropagation(); requeueOutbox(o); }} style={{ marginTop: '8px', background: 'var(--ink)', color: '#fff', border: 'none', padding: '6px 14px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', cursor: 'pointer' }}>↻ Re-queue to NetSuite</button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })()}

            {/* ============ DAILY JOB LOG (live, full-width, bottom of page) ============ */}
            <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                <div style={{ padding: '20px 24px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: '4px' }}>Live · NetSuite → HQ → Shop → Finishing</span>
                        <span style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>Daily Job Log</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase' }}>{dailyJobs.length} job{dailyJobs.length === 1 ? '' : 's'}</span>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', cursor: 'pointer' }}>
                            <input type="checkbox" checked={logTodayOnly} onChange={e => setLogTodayOnly(e.target.checked)} /> Today only
                        </label>
                    </div>
                </div>
                <div style={{ maxHeight: '440px', overflowY: 'auto' }}>
                    {dailyJobs.length === 0 ? (
                        <p style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.9rem', margin: 0, padding: '24px' }}>No jobs in the log{logTodayOnly ? ' for today' : ''} yet — orders appear here as they move through HQ, the shop floor and the finishing floor.</p>
                    ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--sans)', fontSize: '0.85rem' }}>
                            <thead>
                                <tr style={{ background: 'var(--paper)', borderBottom: '1px solid var(--line)' }}>
                                    {['Order', 'Customer', 'Order Date', 'Required', 'Stage', 'Status', 'Updated'].map(h => (
                                        <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', fontWeight: 500, position: 'sticky', top: 0, background: 'var(--paper)' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {dailyJobs.map(job => {
                                    // Source numbers only (Stuart 2026-07-17): the real NetSuite WO # leads
                                    // once posted; until then the app's long id is the reference.
                                    const woTran = job.woRec?.nsWoTran || null;
                                    const label = job.soId ? `SO ${job.soId}` : (job.woId ? (woTran || `WO ${job.woId}`) : job.key);
                                    const chips = [
                                        job.stages.HQ && { k: 'HQ', c: 'var(--ink)' },
                                        job.stages.SHOP && { k: 'Shop', c: 'var(--brass)' },
                                        job.stages.FINISHING && { k: 'Finishing', c: '#5b8a72' },
                                    ].filter(Boolean);
                                    const statusBits = [
                                        job.stages.SHOP && `Shop: ${job.stages.SHOP.status}`,
                                        job.stages.FINISHING && `Fin: ${job.stages.FINISHING.status}`,
                                        (!job.stages.SHOP && !job.stages.FINISHING && job.stages.HQ) && (job.stages.HQ.split ? 'Split to floors' : 'Awaiting dispatch'),
                                    ].filter(Boolean).join('  ·  ');
                                    return (
                                        <tr key={job.key} style={{ borderBottom: '1px solid var(--line)' }}>
                                            <td style={{ padding: '12px 16px' }}>
                                                <button onClick={() => openJobDetails(job)} title="Open details" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--brass)', fontFamily: 'var(--sans)', fontSize: '0.9rem', fontWeight: 600, textDecoration: 'underline' }}>{label}</button>
                                                {woTran && job.woId && <span style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', marginTop: '2px' }}>{job.woId}</span>}
                                            </td>
                                            <td style={{ padding: '12px 16px', color: 'var(--ink)' }}>{job.customer || '—'}</td>
                                            <td style={{ padding: '12px 16px', color: 'var(--ink-soft)' }}>{fmtD(job.orderTs)}</td>
                                            <td style={{ padding: '12px 16px', color: 'var(--ink-soft)' }}>{fmtD(job.reqDate)}</td>
                                            <td style={{ padding: '12px 16px' }}>
                                                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                                    {chips.map(s => <span key={s.k} style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', padding: '3px 9px', borderRadius: '10px', background: s.c, color: '#fff', letterSpacing: '.05em' }}>{s.k}</span>)}
                                                </div>
                                            </td>
                                            <td style={{ padding: '12px 16px', color: 'var(--ink-soft)', fontSize: '0.8rem' }}>
                                                {/* Same chips as the floor and the WMS — HQ reads the status it reads. */}
                                                {job.finDoc ? <OrderStatusChips wo={job.finDoc} showWho={false} /> : (statusBits || '—')}
                                            </td>
                                            <td style={{ padding: '12px 16px', color: 'var(--ink-soft)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{job.latestTs ? new Date(job.latestTs).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            {cfgQuote && <ConfiguredItemViewer quoteId={cfgQuote} onClose={() => setCfgQuote(null)} />}

            {/* VIEW ORDER MODAL */}
            {activeViewOrder && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: '#fff', padding: '40px', borderRadius: '2px', width: '800px', maxHeight: '90vh', overflowY: 'auto', border: '1px solid var(--line)', boxShadow: '0 12px 48px rgba(0,0,0,0.1)' }}>
                        
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--line)', paddingBottom: '20px', marginBottom: '30px' }}>
                            <div>
                                <h2 style={{ color: 'var(--ink)', margin: 0, fontFamily: 'var(--serif)', fontSize: '2rem', fontWeight: 500 }}>
                                    {activeViewOrder.orderType === 'sales' ? 'Sales Order' : 'Work Order'}: {activeViewOrder.soId || activeViewOrder.woId}
                                </h2>
                                <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginTop: '8px' }}>CPQ App ID: {activeViewOrder.hqJobId || 'N/A'}</div>
                            </div>
                            <button onClick={() => setActiveViewOrder(null)} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', fontSize: '2rem', cursor: 'pointer' }}>×</button>
                        </div>

                        {!activeJobDetails ? (
                            <div style={{ padding: '60px', textAlign: 'center', color: 'var(--ink-soft)', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontStyle: 'italic' }}>
                                Fetching Original Configuration Data...
                            </div>
                        ) : activeJobDetails.snapshotStock ? (
                            (() => { const fp = activeJobDetails.fp || {}; return (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    <div style={{ background: 'var(--paper-2)', border: '1px solid var(--line)', padding: '20px 24px' }}>
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '8px' }}>Stock Build</div>
                                        <div style={{ fontFamily: 'var(--serif)', fontSize: '1.6rem', color: 'var(--ink)' }}>{fp.stockErpId || fp.type || '—'}</div>
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink-soft)', marginTop: '6px' }}>
                                            WO {fp.woNum || fp.id} · Qty {fp.totalParts || 0} · Finish {fp.recipe || '—'} · Req {fp.reqDate || '—'}{fp.paintSize ? ` · Size ${fp.paintSize}` : ''}{fp.poles ? ' · POLES (rack of 8)' : ''}
                                        </div>
                                    </div>
                                    {fp.note && <div style={{ border: '1px solid var(--line)', borderLeft: '4px solid var(--brass)', padding: '14px 18px', fontSize: '0.9rem', color: 'var(--ink)' }}>{fp.note}</div>}
                                    {(activeViewOrder.nsWoId || activeViewOrder.nsWoTran) && (
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: '#3a7d44' }}>NetSuite WO: {activeViewOrder.nsWoTran || activeViewOrder.nsWoId}</div>
                                    )}
                                </div>
                            ); })()
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>

                                {/* Print branded docs — SO# is the printed + barcoded spine on each */}
                                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', background: 'var(--paper-2)', border: '1px solid var(--line)', padding: '14px 16px' }}>
                                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginRight: '4px' }}>Print:</span>
                                    <button onClick={() => printDoc('SALES_ORDER')} style={{ ...btnStyle, background: 'var(--ink)', color: '#fff', border: 'none' }}>🖨 Sales Order</button>
                                    <button onClick={() => printDoc('PACKING_SLIP')} style={{ ...btnStyle, background: 'var(--ink)', color: '#fff', border: 'none' }}>🖨 Packing List</button>
                                    <button onClick={() => printDoc('INVOICE')} style={{ ...btnStyle, background: 'var(--ink)', color: '#fff', border: 'none' }}>🖨 Invoice</button>
                                </div>

                                {activeJobDetails.svgUri ? (
                                    <div style={{ border: '1px solid var(--line)', padding: '20px', background: 'var(--paper)' }}>
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '16px' }}>Engineering Drawing</div>
                                        <img src={activeJobDetails.svgUri} alt="Shop Drawing" style={{ width: '100%', maxHeight: '400px', objectFit: 'contain', background: '#fff', border: '1px solid var(--line)' }} />
                                    </div>
                                ) : activeJobDetails.finalImageUrl ? (
                                    <div style={{ border: '1px solid var(--line)', padding: '20px', background: 'var(--paper)' }}>
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '16px' }}>Library Image</div>
                                        <img src={activeJobDetails.finalImageUrl} alt="Library Part" style={{ width: '100%', maxHeight: '400px', objectFit: 'contain', background: '#fff', border: '1px solid var(--line)' }} />
                                    </div>
                                ) : (
                                    <div style={{ padding: '20px', background: 'var(--paper)', color: 'var(--ink-soft)', fontStyle: 'italic', border: '1px solid var(--line)' }}>
                                        No visual assets attached to this configuration.
                                    </div>
                                )}

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
                                    <div style={{ background: 'var(--paper-2)', padding: '20px', border: '1px solid var(--line)' }}>
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '8px' }}>Customer / Entity</div>
                                        <div style={{ fontFamily: 'var(--sans)', fontSize: '1.1rem', fontWeight: 500, color: 'var(--ink)' }}>{activeJobDetails.customer?.name || activeJobDetails.customer || activeViewOrder.customer}</div>
                                    </div>
                                    <div style={{ background: 'var(--paper-2)', padding: '20px', border: '1px solid var(--line)' }}>
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '8px' }}>Project / Sidemark</div>
                                        <div style={{ fontFamily: 'var(--sans)', fontSize: '1.1rem', fontWeight: 500, color: 'var(--ink)' }}>{activeJobDetails.sidemark || activeViewOrder.memo || 'N/A'}</div>
                                    </div>
                                    <div style={{ background: 'var(--paper-2)', padding: '20px', border: '1px solid var(--line)' }}>
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '8px' }}>Finish Recipe</div>
                                        <div style={{ fontFamily: 'var(--sans)', fontSize: '1.1rem', fontWeight: 500, color: 'var(--ink)' }}>{activeJobDetails.finishRecipe}</div>
                                    </div>
                                </div>

                                <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '30px' }}>
                                    <div style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', color: 'var(--ink)', fontWeight: 500, marginBottom: '20px', borderBottom: '1px solid var(--line)', paddingBottom: '10px' }}>Bill of Materials / Specifications</div>
                                    
                                    {activeJobDetails.cpqData?.breakdown ? (
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--sans)', fontSize: '0.95rem' }}>
                                            <tbody>
                                                {activeJobDetails.cpqData.breakdown.map((item, i) => (
                                                    <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                                                        <td style={{ padding: '16px 0', color: 'var(--ink)' }}>
                                                            {!item.isHeader && (item.legacyErpId || item.partId) && <span style={{ fontFamily: 'var(--mono)', fontSize: '0.8rem', color: 'var(--ink-soft)', marginRight: '10px' }}>{item.legacyErpId || item.partId}</span>}
                                                            {item.name}
                                                        </td>
                                                        <td style={{ padding: '16px 0', textAlign: 'right', color: 'var(--ink-soft)' }}>Qty: {item.qty}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    ) : (
                                        <div style={{ fontStyle: 'italic', color: 'var(--ink-soft)' }}>
                                            {activeJobDetails.itemName ? `Stock Item: ${activeJobDetails.itemName}` : 'No itemized breakdown found in source document.'}
                                        </div>
                                    )}
                                </div>

                                <div style={{ display: 'flex', gap: '16px', marginTop: '10px' }}>
                                    <button 
                                        onClick={() => { pushToFinishing(activeViewOrder, activeViewOrder.orderType); setActiveViewOrder(null); }} 
                                        style={{ flex: 1, padding: '16px', background: 'var(--ink)', color: '#fff', border: 'none', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer', transition: 'background 0.2s' }}
                                    >
                                        Push to Finishing Floor
                                    </button>
                                    <button 
                                        onClick={() => { pushToShop(activeViewOrder, activeViewOrder.orderType); setActiveViewOrder(null); }} 
                                        style={{ flex: 1, padding: '16px', background: 'var(--brass)', color: '#fff', border: 'none', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer', transition: 'background 0.2s' }}
                                    >
                                        Push to Shop Floor
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

        </div>
    );
};

export default RTGDispatchTab;