import React, { useState, useEffect, useMemo, useRef } from 'react';
import { BRAND_NETSUITE_MAP } from '../Shared/brandNetsuite';
import OrderStatusChips from '../Shared/OrderStatusChips';
import { db } from '../../firebase';
import { collection, query, where, getDocs, getDoc, doc, setDoc, updateDoc, deleteDoc, onSnapshot, orderBy, limit, addDoc, serverTimestamp } from 'firebase/firestore';
import { classifyLine, isDisplayOnlyLine, DIVISION_CUSTOM, customerDocLines} from '../Shared/lineClassification';
import { customerKeys, findClientPriceRow } from '../Shared/clientPricing';
import { makeFullTasks, woItemCodeOf, withItemCode } from '../Shared/workOrderContract';
import { closeOrderEverywhere as closeEverywhere, linkedDocsOf, auditOrphans, confirmNsClosed, softDeleteOrder, hardDeleteWithLedger, DELETION_LEDGER } from '../Shared/orderLifecycle';
import { releaseHold } from '../Shared/orderHold';
import HeldOrdersBanner from '../Shared/HeldOrdersBanner';
import { planBalanceClose, describeBalanceClose, buildPayload, adjustmentPayload, canCloseBalance } from '../Shared/scrapClose';
import { millBaseOf } from '../Shared/finishRouting';
import { woRecipeCode } from '../Shared/finishingTime';
import { planFinishedRun, isAssemblyPart } from '../Shared/finishedGoodsRun';
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
// ONE copy now — Shared/brandNetsuite.js (2026-08-25).


const RTGDispatchTab = ({ currentUser, activeBrand, userRole }) => {
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
    // ── ⚡ AUTO-RELEASE (Stuart 2026-08-26: "auto send all the orders to the floors … queue them
    // to push in and avoid concurrency issues … remove the step to have to push, now that it is
    // keeping them all as a log") ────────────────────────────────────────────────────────────────
    // When ON, parked orders release themselves to the floors ONE AT A TIME, in arrival order —
    // serial on the app side, and the NetSuite legs already serialize through ns_outbox. Only
    // orders that STATE their route go automatically (finPayload / routeTo FINISHING → finishing;
    // routeTo SHOP → shop; sales orders → auto-split); anything ambiguous, rod-cut-gated, or
    // stopped stays parked for a human, with a log line saying why. Only orders created AFTER the
    // toggle was switched on are picked up — the pre-existing backlog stays manual so flipping the
    // switch can never flood the floor. Board + Daily Job Log remain the record of every release.
    const [autoRelease, setAutoRelease] = useState(null);   // null = loading; {enabled, sinceAt, by}
    const autoBusyRef = useRef(false);
    const autoTriedRef = useRef(new Set());                  // one attempt per order per session
    useEffect(() => {
        if (!activeBrand) return;
        const unsub = onSnapshot(doc(db, 'hq_config', 'rtg_auto_release'),
            snap => setAutoRelease((snap.exists() && snap.data()[activeBrand]) || { enabled: false }),
            () => setAutoRelease({ enabled: false }));
        return () => unsub();
    }, [activeBrand]);
    const toggleAutoRelease = async () => {
        const next = !(autoRelease && autoRelease.enabled);
        if (next && !window.confirm(`⚡ Turn AUTO-RELEASE on for ${activeBrand.toUpperCase()}?\n\nFrom now, newly created orders release themselves to the floors one at a time (sales orders auto-split; stock WOs follow their stated route). Orders already parked stay manual. Rod-cut-gated, stopped, or route-ambiguous orders always wait for a human.\n\nEvery auto release is logged on this board.`)) return;
        await setDoc(doc(db, 'hq_config', 'rtg_auto_release'), {
            [activeBrand]: { enabled: next, sinceAt: next ? Date.now() : (autoRelease?.sinceAt || Date.now()), by: currentUser || '' }
        }, { merge: true });
        addLog(next ? '⚡ Auto-release ON — new orders will dispatch themselves (one at a time).' : '⚡ Auto-release OFF — back to manual push.', next ? 'success' : 'warn');
    };
// (the auto-release ENGINE effect lives below the live-mirror subscriptions — its dependency
    // array reads liveSO/liveWO, which are declared there)


    // MASTER TRANSMIT REVIEW (Stuart 2026-08-25: RTG is "the master review and control of the in
    // and out of netsuite"). Brand-scoped jobs feed the ⇄ Quotes & Sales Orders panel: what is
    // queued, what NetSuite has accepted, and what number it came back as.
    const [txJobs, setTxJobs] = useState([]);
    useEffect(() => {
        if (!activeBrand) return;
        const unsub = onSnapshot(query(collection(db, 'jobs'), where('brandId', '==', activeBrand)),
            snap => setTxJobs(snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .filter(j => !j.deleted && (j.nsTransmitQueuedAt || j.netsuiteEstimateId || j.netsuiteSalesOrderId))
                .sort((a, b) => (b.nsTransmitQueuedAt || b.createdAt?.seconds * 1000 || 0) - (a.nsTransmitQueuedAt || a.createdAt?.seconds * 1000 || 0))
                .slice(0, 40)),
            () => {});
        return () => unsub();
    }, [activeBrand]);

    // The master DELETION LEDGER (Stuart 2026-08-25): every delete anywhere in the app — soft
    // tombstone or hard destroy — lands here, append-only, and THIS board is where it is reviewed.
    // ── ✎ PO EDITOR (Stuart 2026-08-26): a parked PO is editable until NetSuite has it — add or
    // remove lines, fix quantities/rates. Once queued or posted it locks; changes then belong in
    // NetSuite so the two can never disagree. New lines resolve from the Master Library by our
    // code (or the customer's) — an item without a NetSuite id is refused, never guessed.
    const [poEdit, setPoEdit] = useState(null);   // { po, items: [...], add: {code, qty, rate}, busy }
    const poLocked = (po) => !!(po.nsPoId || po.nsPoTran || po.status === 'Pushed to NetSuite');
    const openPoEdit = (po) => setPoEdit({ po, items: (po.items || []).map(x => ({ ...x })), add: { code: '', qty: '', rate: '' }, busy: false });
    const poEditAddLine = async () => {
        const e = poEdit; if (!e) return;
        const code = String(e.add.code || '').trim().toUpperCase();
        const qty = parseInt(e.add.qty) || 0;
        if (!code || qty <= 0) return alert('Give the new line an item code and a quantity.');
        try {
            let snap = await getDocs(query(collection(db, 'Approved_Designs'), where('legacyErpId', '==', code)));
            if (snap.empty) snap = await getDocs(query(collection(db, 'Approved_Designs'), where('itemId', '==', code)));
            const part = snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
            if (!part) return alert(`"${code}" is not in the Master Library — sync or create it first. Nothing was added.`);
            if (!part.netSuiteInternalId) return alert(`${code} has no NetSuite internal id yet (11.1 sync) — the PO line would be refused on push. Nothing was added.`);
            const rate = parseFloat(e.add.rate);
            const line = {
                itemId: part.legacyErpId || part.itemId, nsItemId: String(part.netSuiteInternalId),
                vendorPart: part.manufacturingSpecs?.vendorId || 'N/A', quantity: qty,
                rate: Number.isFinite(rate) ? rate : (parseFloat(part.manufacturingSpecs?.vendorPurchasePrice || part.manufacturingSpecs?.purchasePrice || part.manufacturingSpecs?.averageCost) || 0),
                description: part.manufacturingSpecs?.purchaseDescription || part.itemName || code,
            };
            setPoEdit(prev => prev ? { ...prev, items: [...prev.items, line], add: { code: '', qty: '', rate: '' } } : prev);
        } catch (err) { alert('Lookup failed: ' + (err.message || err)); }
    };
    const savePoEdit = async () => {
        const e = poEdit; if (!e) return;
        const items = e.items.filter(x => (parseInt(x.quantity) || 0) > 0)
            .map(x => ({ ...x, quantity: parseInt(x.quantity) || 0, rate: parseFloat(x.rate) || 0 }));
        if (!items.length) return alert('A PO needs at least one line — use ✕ on the card to delete the whole PO instead.');
        setPoEdit(prev => ({ ...prev, busy: true }));
        try {
            await updateDoc(doc(db, 'hq_purchase_orders', e.po.id), {
                items, editedAt: Date.now(), editedBy: currentUser || '',
            });
            addLog(`✎ PO ${e.po.poId || e.po.id} edited — now ${items.length} line(s).`, 'success');
            setPoEdit(null); loadRTGOrders();
        } catch (err) { alert('Save failed: ' + (err.message || err)); setPoEdit(prev => prev ? { ...prev, busy: false } : prev); }
    };

    const [deletionLog, setDeletionLog] = useState([]);
    const [showDeletionLog, setShowDeletionLog] = useState(false);
    useEffect(() => {
        const unsub = onSnapshot(query(collection(db, DELETION_LEDGER), orderBy('at', 'desc'), limit(100)),
            snap => setDeletionLog(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
            () => { /* ledger not deployed yet — rules must be published first */ });
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
        // Tombstones stay in the collection by design (soft delete, 2026-08-25) — the LIVE
        // feeds must not resurrect them into the Daily Job Log / held / orphan panels.
        const mk = (coll, setter) => onSnapshot(query(collection(db, coll), where("brand", "==", activeBrand)),
            s => setter(s.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => !d.deleted)),
            err => console.warn(`job-log ${coll} listen failed`, err));
        const subs = [
            mk("hq_sales_orders", setLiveSO), mk("hq_work_orders", setLiveWO),
            mk("shop_custom_orders", setLiveShop), mk("fin_workorders", setLiveFin),
        ];
        return () => subs.forEach(u => u && u());
    }, [activeBrand]);

    // ⚡ AUTO-RELEASE ENGINE — one order at a time off the live mirrors (state + toggle above).
    useEffect(() => {
        const cfg = autoRelease;
        if (!cfg || !cfg.enabled || autoBusyRef.current || isSyncing) return;
        const since = cfg.sinceAt || 0;
        const fresh = (o) => (o.createdAt || 0) >= since && !o.stopped && !autoTriedRef.current.has(o.id);
        // Live mirrors, not the manual board load — a new order triggers its own release.
        // An app-created SO (CPQ save) waits for NetSuite to accept it (nsInternalId via
        // writeBack) before splitting to the floors, so a rejected order never becomes work.
        const so = liveSO.find(o => o.status === 'Approved' && fresh(o) && o.hqJobId && (!o.appCreated || o.nsInternalId));
        const wo = !so && liveWO.find(o => o.status === 'Approved' && fresh(o) && !o.awaitingRodCut && !o.pushedToFinishing
            && (o.finPayload || o.routeTo === 'FINISHING' || o.routeTo === 'SHOP'));
        const target = so || wo;
        if (!target) return;
        autoBusyRef.current = true;
        autoTriedRef.current.add(target.id);
        (async () => {
            try {
                if (so) {
                    addLog(`⚡ Auto-release: importing & splitting SO ${so.soId || so.id}…`, 'info');
                    await autoSplitSalesOrder(so, { skipConfirm: true });
                } else if (wo.routeTo === 'SHOP') {
                    addLog(`⚡ Auto-release: ${wo.id} → shop floor…`, 'info');
                    await pushToShop(wo, 'stock', { auto: true });
                } else {
                    addLog(`⚡ Auto-release: ${wo.id} → finishing floor…`, 'info');
                    await pushToFinishing(wo, 'stock', { auto: true });
                }
            } catch (e) {
                console.error('auto-release failed', e);
                addLog(`⚡ Auto-release FAILED for ${target.id}: ${e.message} — left parked for a human.`, 'error');
            } finally {
                autoBusyRef.current = false;
                setTimeout(() => loadRTGOrders(), 900);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoRelease, liveSO, liveWO]);


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
                // APP-CREATED FIRST (2026-08-25): an order saved as a Sales Order in CPQ already
                // has its board doc (SO-APP-…) with this NetSuite id written back onto it — the
                // pull must not create a second card for the same transaction.
                const appDup = await getDocs(query(collection(db, "hq_sales_orders"), where("nsInternalId", "==", String(row.ns_id))));
                if (!appDup.empty) { addLog(`Skipped ${hqSalesOrderId} — already on the board as ${appDup.docs[0].id} (app-created).`, "info"); continue; }
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
                        memo: row.memo || '',
                        createdAt: Date.now()
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
                fp: { stockErpId: woItemCodeOf(order), type: order.type || 'Stock Build', woNum: order.woNo || order.woDisplayId || order.id, totalParts: order.totalParts || order.qty || 0, recipe: order.recipe || '', reqDate: order.reqDate || '', note: '' }
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
    // ⚡ URGENT RIDES TO THE TOP, IN RED (Eric 2026-08-17: "we now have several Brimars of varying
    // age entered, but the most recently entered is the oldest — its processing was delayed for the
    // elbows and wands. Nothing exists to flag it for first work").
    //
    // The flag already existed at Stock View's Generate press and pins the order in the Finishing
    // Setup Queue. What was missing is the middle of the journey: RTG could neither SHOW that an
    // order is urgent nor MARK one on its way out. Same field, same meaning, three screens.
    // Entry order is not priority order — that is the whole point of his report.
    const isUrgent = (o) => !!(o && o.urgent);
    const needByOf = (o) => (o && (o.needBy || o.reqDate)) || '2999-12-31';
    const urgentFirst = (a, b) => {
        if (isUrgent(a) !== isUrgent(b)) return isUrgent(a) ? -1 : 1;
        if (isUrgent(a)) return String(needByOf(a)).localeCompare(String(needByOf(b)));  // soonest first
        return 0;                                                                        // otherwise leave the existing order alone
    };
    const splitBoard = (list) => {
        const live = list.filter(o => !o.rtgArchived);
        const pending = live.filter(o => o.status === 'Approved').sort(urgentFirst);
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

    // Flip the flag ON THE ORDER, not on some dispatch-time-only checkbox: an order that is urgent
    // is urgent while it sits here waiting too, which is exactly the situation Eric described. The
    // need-by date is asked for when raising the flag (blank = keep the existing req date) and both
    // fields travel onto the floor doc at dispatch, where the Setup Queue already pins them.
    const toggleUrgent = async (order, collectionName) => {
        const on = !isUrgent(order);
        let needBy = order.needBy || '';
        if (on) {
            const ans = window.prompt(`⚡ Flag ${order.woNo || order.soId || order.id} URGENT.\n\nNeed-by date (YYYY-MM-DD) — leave blank to keep ${order.reqDate || 'the existing req date'}:`, order.needBy || order.reqDate || '');
            if (ans === null) return;                       // cancelled — no change
            needBy = String(ans).trim();
            if (needBy && !/^\d{4}-\d{2}-\d{2}$/.test(needBy)) return alert(`"${needBy}" isn't a date in YYYY-MM-DD form. Nothing was changed.`);
        }
        try {
            await updateDoc(doc(db, collectionName, order.id), on
                ? { urgent: true, urgentAck: false, needBy: needBy || order.reqDate || '', urgentBy: currentUser || '', urgentAt: Date.now() }
                : { urgent: false, urgentAck: false, urgentClearedBy: currentUser || '', urgentClearedAt: Date.now() });
            addLog(`${on ? '⚡ URGENT' : 'Cleared urgent on'} ${order.woNo || order.soId || order.id}${on && needBy ? ` — need by ${needBy}` : ''}.`, on ? 'warn' : 'info');
            loadRTGOrders();
        } catch (e) { alert(`Couldn't change the urgent flag: ${e.message || e}`); }
    };
    // The chip + the button, shared by the sales-order and work-order cards so the two can't drift.
    const urgentControls = (order, collectionName) => (
        <button
            onClick={() => toggleUrgent(order, collectionName)}
            title={isUrgent(order)
                ? `Urgent${order.needBy ? ` — need by ${order.needBy}` : ''}${order.urgentBy ? `, flagged by ${order.urgentBy}` : ''}. Click to clear.`
                : 'Flag this order URGENT — it moves to the top of this board in red, and arrives pinned to the top of the Finishing Setup Queue until an operator acknowledges it.'}
            style={{
                fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em',
                padding: '3px 8px', cursor: 'pointer', marginTop: '6px',
                border: `1px solid ${isUrgent(order) ? '#d9534f' : 'var(--line)'}`,
                background: isUrgent(order) ? '#d9534f' : '#fff',
                color: isUrgent(order) ? '#fff' : 'var(--ink-soft)',
                fontWeight: isUrgent(order) ? 700 : 400,
            }}>
            {isUrgent(order) ? `⚡ URGENT${order.needBy ? ` · BY ${order.needBy}` : ''}` : '⚡ Flag urgent'}
        </button>
    );
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

                await setDoc(doc(db, "fin_workorders", finId), withItemCode({
                    id: finId, woNum: finId, displayId: finId,
                    orderKey, quoteId: so.hqJobId, salesOrderId: so.soId || null,
                    estimateId: job.netsuiteEstimateId || null,
                    brand: activeBrand,
                    customerId, customerName, clientName: customerName,
                    orderType: 'sales',
                    // Canonical identity when the order IS one item (audit #1, 2026-08-25): a
                    // single-line sales order identifies on the floor card; multi-line stays
                    // legitimately un-coded ("Mixed").
                    ...(partsList.length === 1 && partsList[0].legacyErpId ? { itemCode: String(partsList[0].legacyErpId).toUpperCase() } : {}),
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
                }));
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

    // ROUTE A — THE REAL NETSUITE WORK ORDER, for any stock build (Eric 2026-08-17: "work orders are
    // no longer being created for standard assembly items … it looks like the system is treating them
    // like the Just for Paint item").
    //
    // He read it exactly right. A Just-For-Paint run is DEFINED by having no NetSuite work order, and
    // that is what these had become — not by intent, but because Route A lived inside the
    // finPayload-only release branch. Orders raised through the Master Library's make-up cascade or
    // Stock View's direct WO push carry no finPayload, so they took the other branch and no WO was
    // ever queued: no component commitment in NetSuite, no WO number on the card (his WO11411
    // rings came from the snapshot, which does have a finPayload), and no completion post at bake,
    // since that trigger needs the nsWoId this queues.
    //
    // Extracted here so BOTH release paths queue it from the same code. Sales orders are excluded by
    // the caller — their NetSuite side is an estimate, not a stock-build work order.
    const queueNsStockWorkOrder = async (hqOrder, fp) => {
        try {
            const nsConfig = BRAND_NETSUITE_MAP[activeBrand] || {};
            // Resolve the assembly's NetSuite internal id from FOUR sources — the payload field →
            // the item # (payload or the WO doc's own partErpId) → the WO id — so one dropped field
            // can never silently skip the NetSuite work order.
            let nsAsmId = String(fp.stockInternalId || '');
            let idSrc = 'payload';
            const erp = fp.stockErpId || hqOrder.partErpId || hqOrder.rootItem || hqOrder.variantErpId || '';
            if (!nsAsmId && erp) {
                try {
                    const libSnap = await getDocs(query(collection(db, 'Approved_Designs'), where('legacyErpId', '==', erp)));
                    const hit = libSnap.docs.map(d => d.data()).find(p => p.netSuiteInternalId);
                    if (hit) { nsAsmId = String(hit.netSuiteInternalId); idSrc = 'library'; }
                } catch (lookErr) { /* fall through to the WO-id parse */ }
            }
            if (!nsAsmId) {
                const m = String(hqOrder.id || '').match(/^WO-STK-(\d+)-/);
                if (m) { nsAsmId = m[1]; idSrc = 'wo-id'; }
            }
            // STOP MECHANISM: one NetSuite work order per app WO, ever — a re-release (or double
            // tap) must not queue a second one.
            if (nsAsmId && nsConfig.location && (hqOrder.nsWoQueued || hqOrder.nsWoId || fp.nsWoId)) {
                addLog(`ℹ NetSuite WO already queued/created for ${fp.woNum || fp.id} — not queued again.`, 'warn');
                return '\n\nℹ The NetSuite work order was already queued/created earlier — NOT duplicated.';
            }
            if (nsAsmId && nsConfig.location) {
                await enqueueNsWrite({
                    kind: 'workorder',
                    label: `NS WO — build ${erp || fp.id} ×${fp.totalParts}`,
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
                        memo: `Stock build ${fp.woNum || fp.id}`
                    },
                    // Ids stamp back onto BOTH docs: the floor card shows the WO#, and the
                    // completion trigger needs nsWoId on the fin doc.
                    writeBack: [
                        { collection: 'fin_workorders', docId: fp.id, patch: {}, idField: 'nsWoId', tranField: 'nsWoTran' },
                        { collection: 'hq_work_orders', docId: hqOrder.id, patch: {}, idField: 'nsWoId', tranField: 'nsWoTran' }
                    ]
                });
                await updateDoc(doc(db, "hq_work_orders", hqOrder.id), { nsWoQueued: true });
                addLog(`📤 NetSuite work order queued: ${erp || fp.id} ×${fp.totalParts}${idSrc !== 'payload' ? ` (internal id recovered via ${idSrc})` : ''}.`, 'success');
                return '\n\n📤 A real NetSuite work order is queued (11.1 → NetSuite Sync Queue) — On-Ord picks it up on the next live pull, and completion posts automatically when the bake finishes.';
            }
            const why = !nsAsmId
                ? `no NetSuite internal id found for ${erp || 'this order'} — check the item is synced (11.1 → Sync Master Library)`
                : 'no NetSuite location mapping for this brand';
            addLog(`⚠ No NetSuite WO queued for ${fp.woNum || fp.id} — ${why}.`, 'warn');
            return `\n\n⚠ No NetSuite work order queued — ${why}.`;
        } catch (nsErr) {
            console.error('Route A queue failed:', nsErr);
            addLog(`⚠ NetSuite WO queue failed for ${fp.woNum || fp.id}: ${nsErr.message || nsErr} — the floor job still went out.`, 'warn');
            return `\n\n⚠ The NetSuite work order could not be queued (${nsErr.message || nsErr}). The floor job WAS released.`;
        }
    };

    const pushToFinishing = async (hqOrder, orderType, opts = {}) => {
        // ⚡ AUTO mode (Stuart 2026-08-26): no dialogs — gated or already-dispatched orders are
        // SKIPPED with a log line, never forced. A human pressing the button keeps every confirm.
        if (opts.auto) {
            if (hqOrder.awaitingRodCut) { addLog(`⚡ auto: ${hqOrder.id} waiting on its rod cut — left parked.`, 'warn'); return; }
            if (hqOrder.pushedToFinishing) { addLog(`⚡ auto: ${hqOrder.id} already dispatched — skipped.`, 'info'); return; }
        }
        // THE POLES DO NOT EXIST YET (Stuart 2026-08-19). A 4 ft order is cut from stocked 8 ft rods,
        // and until WMS → ROD CUTS → Cuts for Finishing has done it there is nothing to pick or
        // spray. Releasing early sends the floor after rods nobody has made.
        if (!opts.auto && hqOrder.awaitingRodCut && !window.confirm(`⏳ ${hqOrder.id} is waiting on a rod cut.\n\n${hqOrder.rodCutNote || 'The 8 ft rods have not been cut yet.'}\n\nUntil WMS → ROD CUTS → "Cuts for Finishing" completes it, the ${woItemCodeOf(hqOrder) || 'cut'} poles do not exist to pick or finish — and that cut prints this order's label when it's done.\n\nRelease it to the floor anyway?`)) return;
        if (!opts.auto && !window.confirm(`Push HQ Order ${hqOrder.id} to the Finishing Floor Setup Queue?`)) return;
        // STOP MECHANISM (Stuart 2026-07-21): a second tap must never quietly duplicate the
        // floor card — an already-dispatched order needs an explicit, scary re-confirm.
        if (!opts.auto && hqOrder.pushedToFinishing && !window.confirm(`⚠ ${hqOrder.woNo || hqOrder.id} was ALREADY dispatched to finishing.\n\nRelease it AGAIN anyway? Normally NO — this re-copies the floor card.`)) return;

        // SALES-SNAPSHOT stock WOs (2026-07-16): the snapshot pre-builds the COMPLETE finishing
        // doc (pole rack info, paint sizes, stock ids) and parks the WO here for review —
        // releasing it is a verbatim copy, so nothing is lost or re-derived at dispatch.
        if (hqOrder.finPayload && hqOrder.finPayload.id) {
            try {
                const fp = hqOrder.finPayload;
                // The urgent flag rides the release. It may have been set at Stock View's Generate
                // press (already in the payload) or raised here while the order waited — the board's
                // value wins, since it is the later statement of intent.
                await setDoc(doc(db, "fin_workorders", fp.id), withItemCode({
                    ...fp,
                    ...(isUrgent(hqOrder) ? { urgent: true, urgentAck: false, needBy: hqOrder.needBy || fp.needBy || fp.reqDate || '', urgentBy: hqOrder.urgentBy || currentUser || '', urgentAt: hqOrder.urgentAt || Date.now() } : {}),
                    dispatchedAt: Date.now(), dispatchedBy: currentUser || ''
                }));
                await updateDoc(doc(db, "hq_work_orders", hqOrder.id), { pushedToFinishing: true, status: "Dispatched" });
                // ROUTE A (2026-07-16): these stocked items are real NetSuite assemblies with BOMs,
                // so releasing to the floor ALSO queues a real NetSuite work order (outbox — serial,
                // retried, idempotent). On-Ord sees it on the next live pull; component demand is
                // real; the floor's bake-complete auto-queues the WO COMPLETION (server trigger).
                const nsQueuedNote = await queueNsStockWorkOrder(hqOrder, fp);
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
            const finPayload = withItemCode({
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
                // LAST CHANCE TO STATE THE FINISH (2026-08-17). Neither the CPQ lookup nor the WO doc
                // has it for a stock build raised outside the snapshot — but the item code does, and
                // an order that reaches the floor labelled PENDING-RECIPE cannot be batched or
                // advanced. woRecipeCode reads it off the code and leaves a real recipe untouched.
                recipe: finishRecipe !== "PENDING-RECIPE" ? finishRecipe : woRecipeCode(hqOrder),
                reqDate: hqOrder.reqDate || "",
                // `type` is what the floor card shows as the item, so a stock build must carry its
                // CODE here — not the category label older writers put in this field (2026-08-17).
                // Sales orders keep the assembly/mixed wording they have always had.
                type: (orderType !== 'sales' && woItemCodeOf(hqOrder)) || hqOrder.type || "Mixed",
                itemName: hqOrder.itemName || '',
                stockInternalId: hqOrder.stockInternalId ? String(hqOrder.stockInternalId) : null,
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
                // `partErpId` added 2026-08-17: the Master Library's make-up cascade stamps ONLY
                // that, so its orders reached the floor with no item code on the card at all —
                // and nothing for the NetSuite work order to resolve the assembly from.
                stockErpId: hqOrder.paintOnly === true ? (hqOrder.jfpItemCode || null) : (hqOrder.rootItem || hqOrder.variantErpId || hqOrder.partErpId || null),
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

                // A BOM EXPLODED AT CREATION SURVIVES THE REVIEW HOP (2026-08-25). Stock View's
                // grid now plans its pull lines the way the Sales Snapshot always has; this branch
                // hard-coded [] and would have thrown them away, leaving the floor to synthesize a
                // raw pull of the assembly code — the very thing Eric reported. Empty when the
                // order carries none, exactly as before.
                partsList: Array.isArray(hqOrder.partsList) && hqOrder.partsList.length ? hqOrder.partsList : [],
                ...(Array.isArray(hqOrder.partsList) && hqOrder.partsList.length ? { bomExploded: true } : {}),
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
            });

            await setDoc(doc(db, "fin_workorders", finWorkOrderId), {
                ...finPayload,
                // Urgent travels here too — the Setup Queue pins it above every finish batch until
                // an operator acknowledges it.
                ...(isUrgent(hqOrder) ? { urgent: true, urgentAck: false, needBy: hqOrder.needBy || hqOrder.reqDate || '', urgentBy: hqOrder.urgentBy || currentUser || '', urgentAt: hqOrder.urgentAt || Date.now() } : {}),
            });

            // Change status to Dispatched so it leaves the RTG board
            const collectionName = orderType === 'sales' ? "hq_sales_orders" : "hq_work_orders";
            await updateDoc(doc(db, collectionName, hqOrder.id), { 
                pushedToFinishing: true,
                dispatchedAt: Date.now(),
                dispatchedBy: currentUser || '',
                status: "Dispatched" 
            });

            // ROUTE A FOR THIS BRANCH TOO (Eric 2026-08-17). A stock build released down this path
            // — the Master Library's make-up cascade, Stock View's direct WO push — never queued a
            // NetSuite work order, because Route A only existed in the finPayload branch above. That
            // is precisely why these looked like Just-For-Paint runs: no WO number, no component
            // commitment, no completion at bake. SALES orders are excluded: their NetSuite side is
            // an estimate, not a stock-build work order, and a JFP run has no assembly to build.
            let nsQueuedNote = '';
            if (orderType !== 'sales' && hqOrder.paintOnly !== true) {
                nsQueuedNote = await queueNsStockWorkOrder(hqOrder, finPayload);
            }

            addLog(`Dispatched ${finWorkOrderId} to Finishing Floor!`, "success");
            alert(`Successfully pushed ${finWorkOrderId} to Finishing Floor Setup Queue!${nsQueuedNote}`);
            loadRTGOrders();

        } catch (error) {
            console.error("Dispatch Error:", error);
            addLog(`Dispatch Failed: ${error.message}`, "error");
            alert("Failed to push to Finishing Floor. Check permissions/console.");
        }
    };

    const pushToShop = async (hqOrder, orderType, opts = {}) => {
        if (!opts.auto && !window.confirm(`Push HQ Order ${hqOrder.id} to the Shop Floor Custom Fabrication Queue?`)) return;

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

            await setDoc(doc(db, "shop_custom_orders", shopJobId), {
                ...shopPayload,
                // Same flag, same field names as the finishing side — the shop list sorts on it.
                ...(isUrgent(hqOrder) ? { urgent: true, urgentAck: false, needBy: hqOrder.needBy || hqOrder.reqDate || '', urgentBy: hqOrder.urgentBy || currentUser || '', urgentAt: hqOrder.urgentAt || Date.now() } : {}),
            });

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

    // SOFT delete + ledger (Stuart 2026-08-25) — the record STAYS, stamped deleted/when/who, and
    // the master Deletion Ledger below indexes it. Status 'Deleted' drops it from every
    // status-filtered screen; nothing is destroyed.
    const deleteOrder = async (collectionName, order) => {
        const id = order.id;
        const reason = window.prompt(`Remove ${id} from the dispatch board?\n\nThe record is KEPT — stamped deleted, dated, with your name — and stays on the master Deletion Ledger.\n\nReason (optional):`);
        if (reason === null) return;
        try {
            const res = await softDeleteOrder({ db, doc, updateDoc, setDoc }, {
                collection: collectionName, docId: id, record: order,
                kind: collectionName, by: currentUser || '', from: 'RTG_DISPATCH', reason: reason || '',
            });
            // A tombstoned board record must not leave its floor documents alive in the Setup
            // Queue / WMS pick queue (2026-08-25 audit #9) — close every linked doc, the same
            // stamps closeOrderEverywhere uses.
            let floorClosed = 0;
            if (collectionName === 'hq_sales_orders' || collectionName === 'hq_work_orders') {
                try {
                    const links = await linkedDocsOf({ db, doc, getDoc, getDocs, query, collection, where }, order, collectionName === 'hq_sales_orders' ? 'sales' : 'stock');
                    const stamp = { closedAt: Date.now(), closedBy: currentUser || '', closedFrom: 'RTG_DELETE', closeReason: reason || 'board record deleted' };
                    for (const [fid] of links.fin) {
                        await updateDoc(doc(db, 'fin_workorders', fid), { currentPhase: 'Closed', stepStatus: 'Closed', status: 'Closed', sentToPickPack: false, pickStatus: 'Closed', ...stamp }).catch(() => {});
                        floorClosed++;
                    }
                    for (const [sid] of links.shop) {
                        await updateDoc(doc(db, 'shop_custom_orders', sid), { status: 'Completed', closed: true, ...stamp }).catch(() => {});
                        floorClosed++;
                    }
                } catch (e) { console.warn('floor-doc close after delete failed:', e); }
            }
            addLog(`🗑 ${id} deleted (record kept${res.ledger ? ', ledger indexed' : ' — LEDGER WRITE FAILED, tombstone only'}${floorClosed ? `, ${floorClosed} floor doc(s) closed` : ''}).`, "warn");
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
    // The close a person still has to do in NetSuite goes out on OS Comms, because a task nobody
    // is told about is not a task (Eric's Option 3 — the app cannot close a non-WIP work order).
    const notify = async (msg) => {
        try {
            await addDoc(collection(db, 'global_messages'), {
                sender: 'System', sourceApp: 'RTG', target: 'ALL', isSystem: true,
                t: serverTimestamp(), msg,
            });
        } catch (e) { console.warn('OS Comms notify failed:', e); }
    };

    const closeOrderEverywhere = async (order, kind) => {
        const isSales = kind === 'sales';
        const ref = isSales ? `SO ${order.soId || order.id}` : `WO ${order.nsWoTran || order.woId || order.id}`;
        let links;
        try {
            links = await linkedDocsOf({ db, doc, getDoc, getDocs, query, collection, where }, order, kind);
        } catch (e) { return alert('Could not look up the linked floor documents: ' + (e.message || e)); }
        const nsOpen = [...links.fin.values()].some(d => d.nsWoId && !d.nsWoClosed && !d.nsWoCompletionPosted) || (order.nsWoId && !order.nsWoClosed);
        const nsLine = nsOpen ? `\n• NetSuite work order → CLOSE queued (releases the component commitment)\n  ⚠ QUEUED, NOT DONE — NetSuite refuses the close on a non-WIP work order. Check the transmit log below; if it fails, the WO stays open in NetSuite.` : '';
        if (!window.confirm(`✕ CLOSE ${ref} EVERYWHERE?\n\n• RTG record → Closed (leaves this board)\n• ${links.fin.size} finishing floor job(s) → Closed (leave the Setup Queue, Active Floor & WMS pick)\n• ${links.shop.size} shop floor job(s) → closed out of the shop queues${nsLine}\n\nDocuments are kept for history — nothing is deleted.`)) return;
        try {
            // THE one closer, shared with the Setup Queue and Stock View so a close means the same
            // thing wherever it is pressed (Stuart 2026-08-19).
            const res = await closeEverywhere(
                { db, doc, getDoc, getDocs, query, collection, where, updateDoc },
                { order, kind, by: currentUser || '', from: 'RTG', notify }
            );
            addLog(`✕ ${ref} closed — ${res.fin} finishing, ${res.shop} shop, ${res.hq} RTG${res.ns ? `. NetSuite close QUEUED for ${res.ns} — confirm it lands in the transmit log; a non-WIP work order will refuse it.` : ''}`, res.ns ? 'warn' : 'success');
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
    // ── RE-DERIVE THE PULL LINES FROM TODAY'S BOM (Stuart 2026-08-26) ─────────────────────────
    // `partsList` is a PHOTOGRAPH taken when the work order was raised — it never re-reads the BOM.
    // So an order raised before a BOM was corrected keeps the old components for life, which is why
    // Sandra's WO11476 and WO11479 still ask for 21568 and 42551 long after the sync stopped
    // producing them. Re-syncing cannot help: there is nothing stale to refresh, only an old copy.
    //
    // This re-explodes the assembly against the CURRENT pins and rewrites the lines. It refuses once
    // picking has started, because replacing a list somebody is halfway through is how you lose
    // count of what is already on the trolley.
    const refreshBomLines = async (order, kind) => {
        const code = woItemCodeOf(order);
        if (!code) return alert(`${order.id} has no item code, so there is no assembly to explode.`);
        let links;
        try { links = await linkedDocsOf({ db, doc, getDoc, getDocs, query, collection, where }, order, kind); }
        catch (e) { return alert('Could not find the linked floor documents: ' + (e.message || e)); }
        const finList = [...links.fin.entries()];
        if (!finList.length) return alert(`No finishing job found for ${order.id} — nothing to rewrite yet. Re-derive it after it reaches the floor.`);
        const started = finList.find(([, d]) => d.pickStatus && d.pickStatus !== 'Pending');
        if (started) return alert(`Picking has already started on ${order.id} (${started[1].pickStatus}).\n\nThe pull list is not rewritten mid-pick — that is how you lose track of what is already on the trolley.\n\nSend it back to the pick queue in WMS first, then refresh.`);
        try {
            const partsSnap = await getDocs(collection(db, 'Approved_Designs'));
            const inventory = partsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            const part = inventory.find(p => String(p.legacyErpId || p.itemId || '').toUpperCase() === code);
            if (!part) return alert(`"${code}" is not in the Master Library, so its BOM cannot be read.`);
            if (!isAssemblyPart(part)) return alert(`${code} is not an assembly (${part.partClass || 'unclassified'}) — it has no BOM to explode. Its pull is the item itself.`);
            const pinsSnap = await getDocs(query(collection(db, 'assembly_pins'), where('assemblyId', '==', part.itemId)));
            const pins = pinsSnap.docs.map(d => d.data());
            if (!pins.length) return alert(`${code} has no BOM lines in the app. Sync it from HQ 11.1 first — rewriting to an empty list would leave the floor nothing to pick.`);
            const qty = Number(order.totalParts || order.qty || finList[0][1].totalParts || 1);
            const plan = planFinishedRun({ part, qty, pins, inventory });
            if (!plan.lines.length) return alert(`Exploding ${code} produced no pull lines — nothing was changed.`);
            const before = (finList[0][1].partsList || []).map(l => `${l.quantity}×${l.legacyErpId || l.partId}`);
            const after = plan.lines.map(l => `${l.quantity}×${l.legacyErpId}`);
            if (!window.confirm(`Re-derive the pull lines for ${code} (×${qty})?\n\nWAS:\n   ${before.length ? before.join('\n   ') : '(none)'}\n\nNOW:\n   ${after.join('\n   ')}\n\nThis rewrites what the warehouse is asked to pick. Picking has not started, so nothing in progress is disturbed.`)) return;
            for (const [id] of finList) {
                await updateDoc(doc(db, 'fin_workorders', id), { partsList: plan.lines, bomExploded: true, bomRefreshedAt: Date.now(), bomRefreshedBy: currentUser || '' });
            }
            // A parked order has not been released yet — its payload is what RTG will copy verbatim,
            // so it has to be corrected too or the refresh is undone at dispatch.
            if (order.finPayload && order.finPayload.id) {
                await updateDoc(doc(db, kind === 'sales' ? 'hq_sales_orders' : 'hq_work_orders', order.id),
                    { 'finPayload.partsList': plan.lines, 'finPayload.bomExploded': true }).catch(() => {});
            }
            addLog(`↻ ${code}: pull lines re-derived from today's BOM — ${before.length} line(s) → ${after.length} (${after.join(', ')}).`, 'success');
            alert(`↻ ${code} now pulls:\n\n   ${after.join('\n   ')}\n\nThe warehouse sees this the moment it refreshes.`);
            loadRTGOrders();
        } catch (e) { alert('Could not re-derive: ' + (e.message || e)); }
    };

    // ── CLOSE THE BALANCE (Eric 2026-08-18; decisions Stuart 2026-08-19) ────────────────────────
    // "Scrap items are not allowed and must be pushed back to finishing or setup as required."
    // His four scenarios are one mechanism: how many are GOOD, how many BAD physically exist, and
    // are the bad ones salvageable. The arithmetic lives in Shared/scrapClose (tested); this is the
    // conversation and the writes. It sits on RTG because these are ORDER-LIFECYCLE events — the
    // order is being closed short — not packing events.
    const [balanceModal, setBalanceModal] = useState(null);   // { order, kind, ordered, good, bad, salvage }
    const mayCloseBalance = canCloseBalance(userRole);

    const runBalanceClose = async () => {
        const m = balanceModal;
        if (!m) return;
        const plan = planBalanceClose({ ordered: m.ordered, good: m.good, bad: m.bad, salvage: m.salvage });
        const itemCode = woItemCodeOf(m.order) || m.order.id;
        const rawCode = millBaseOf(itemCode);
        const nsCfg = BRAND_NETSUITE_MAP[activeBrand] || {};
        if (!window.confirm(`Close ${itemCode} short?\n\n${describeBalanceClose(plan, { itemCode, rawCode, bin: m.order.rodCutDestBin || '' })}\n\nThis writes to NetSuite. Continue?`)) return;
        setBalanceModal(null);
        try {
            // The item ids come from the Master Library — without them nothing is guessed, the step
            // is skipped and named, because a wrong internal id moves the wrong stock.
            const findNsId = async (code) => {
                try {
                    const snap = await getDocs(query(collection(db, 'Approved_Designs'), where('legacyErpId', '==', String(code).toUpperCase())));
                    const hit = snap.docs.map(d => d.data()).find(x => x.netSuiteInternalId);
                    return hit ? { id: String(hit.netSuiteInternalId), bin: (hit.manufacturingSpecs && hit.manufacturingSpecs.binLocation) || '' } : null;
                } catch (e) { return null; }
            };
            const skipped = [];
            const links = await linkedDocsOf({ db, doc, getDoc, getDocs, query, collection, where }, m.order, m.kind);
            const finEntry = [...links.fin.entries()][0] || null;
            const alreadyBuilt = finEntry ? !!(finEntry[1].nsWoCompletionPosted || finEntry[1].nsBuildPosted) : false;

            if (plan.buildQty > 0 && !alreadyBuilt) {
                const it = await findNsId(itemCode);
                if (!it) skipped.push(`build of ${itemCode} (no NetSuite id — sync the item)`);
                else await enqueueNsWrite({
                    kind: 'assemblybuild', label: `Partial build ${plan.buildQty} × ${itemCode} (${m.order.id})`,
                    sourceApp: 'RTG', createdBy: currentUser || '',
                    targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/assemblybuild',
                    method: 'POST',
                    payload: buildPayload({ nsItemId: it.id, qty: plan.buildQty, location: nsCfg.location, subsidiary: nsCfg.subsidiary, memo: `Partial build ${plan.buildQty} of ${plan.ordered} — balance closed from RTG (${m.order.id})` }),
                    ...(finEntry ? { writeBack: { collection: 'fin_workorders', docId: finEntry[0], patch: { nsBuildPosted: true } } } : {}),
                });
            } else if (plan.buildQty > 0 && alreadyBuilt) {
                skipped.push(`build of ${itemCode} — the floor already posted this order's build, so it is NOT built twice`);
            }

            // Only REAL scrap moves stock. Salvageable pieces go back in the bin — their raw was
            // never consumed, so an adjustment would double-count it (Eric 2026-08-21).
            const moveRaw = -plan.adjustOutQty;
            if (moveRaw !== 0) {
                const raw = await findNsId(rawCode);
                if (!raw) skipped.push(`scrap of ${plan.adjustOutQty} × ${rawCode} (no NetSuite id)`);
                else await enqueueNsWrite({
                    kind: 'inventoryadjustment',
                    label: `Scrap ${Math.abs(moveRaw)} × ${rawCode} (${m.order.id})`,
                    sourceApp: 'RTG', createdBy: currentUser || '',
                    targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/inventoryadjustment',
                    method: 'POST',
                    payload: adjustmentPayload({ nsItemId: raw.id, qty: moveRaw, bin: raw.bin, location: nsCfg.location, subsidiary: nsCfg.subsidiary, memo: `Scrap ${m.order.id}` }),
                });
            }

            // Close everywhere, through the one closer, with the reason on the record.
            const res = await closeEverywhere(
                { db, doc, getDoc, getDocs, query, collection, where, updateDoc },
                { order: m.order, kind: m.kind, by: currentUser || '', from: 'RTG_BALANCE',
                  reason: `built ${plan.good}/${plan.ordered}${plan.bad ? `, ${plan.bad} bad ${plan.returnToBinQty ? 'returned to bin' : 'scrapped'}` : ''}`, notify }
            );
            await updateDoc(doc(db, m.kind === 'sales' ? 'hq_sales_orders' : 'hq_work_orders', m.order.id), {
                builtQty: plan.good, badQty: plan.bad, balanceClosed: plan.balance,
                balanceClosedBy: currentUser || '', balanceClosedAt: Date.now(),
            }).catch(() => {});

            addLog(`⚖ ${itemCode}: built ${plan.good}/${plan.ordered}, closed balance ${plan.balance}${plan.bad ? `, ${plan.bad} ${plan.returnToBinQty ? '→ back to bin' : 'scrapped'}` : ''}${skipped.length ? ` — SKIPPED: ${skipped.join('; ')}` : ''}.`, skipped.length ? 'warn' : 'success');

            // Re-issue is PROMPTED, never automatic — the same shape as the make-up cascade.
            if (plan.reissueQty > 0) {
                const ans = window.prompt(`Re-issue the shortfall?\n\n${plan.balance} × ${itemCode} were not built.\n\nQuantity to re-issue (blank or 0 = none — adjust it for an efficient batch):`, String(plan.reissueQty));
                const rq = parseInt(ans) || 0;
                if (rq > 0) {
                    const stamp = Date.now().toString().slice(-6);
                    const newId = `WO-${String(itemCode).replace(/[^A-Za-z0-9]+/g, '-')}-${stamp}`;
                    await setDoc(doc(db, 'hq_work_orders', newId), withItemCode({
                        id: newId, woId: newId, brand: activeBrand, status: 'Approved',
                        customer: 'Internal Stock', type: String(itemCode), rootItem: String(itemCode).toUpperCase(),
                        partErpId: String(itemCode).toUpperCase(), itemName: m.order.itemName || '',
                        totalParts: rq, recipe: m.order.recipe || '',
                        reqDate: m.order.needBy || m.order.reqDate || new Date(Date.now() + 6048e5).toISOString().split('T')[0],
                        // LINEAGE — without it the board fills with replacements nobody can relate
                        // to the order they came from.
                        replacesWo: m.order.id, replacesReason: `balance closed, ${plan.balance} short`,
                        ...(m.order.stockInternalId ? { stockInternalId: String(m.order.stockInternalId) } : {}),
                        createdAt: Date.now(), createdBy: currentUser || '', source: 'RTG_REISSUE',
                    }));
                    addLog(`↻ Re-issued ${rq} × ${itemCode} as ${newId} (replaces ${m.order.id}) — parked here for release.`, 'success');
                }
            }
            alert(`⚖ ${itemCode} closed short.\n\nBuilt ${plan.good} of ${plan.ordered}; balance ${plan.balance} closed across ${res.fin} finishing / ${res.shop} shop / ${res.hq} RTG record(s).${skipped.length ? `\n\n⚠ NOT done: ${skipped.join('; ')}` : ''}${res.ns ? `\n\nNetSuite WO close queued (${res.ns}) — NOT confirmed; a non-WIP work order refuses it.` : ''}\n\nWatch the transmit log for the NetSuite writes.`);
            loadRTGOrders();
        } catch (e) {
            alert('Balance close failed partway: ' + (e.message || e) + '\n\nCheck the transmit log — some NetSuite writes may already be queued.');
        }
    };

    // STOPPED ORDERS, ABOVE EVERYTHING (Stuart 2026-08-21). Management sees them here the moment
    // the floor or the bench raises one — the whole point is not finding out later.
    const heldOrders = useMemo(
        () => [...liveWO, ...liveSO, ...liveFin, ...liveShop].filter(o => o && o.held === true)
            .filter((o, i, arr) => arr.findIndex(x => (x.nsWoTran || x.id) === (o.nsWoTran || o.id)) === i),
        [liveWO, liveSO, liveFin, liveShop]
    );
    const resumeHeld = async (o) => {
        const note = window.prompt(`▶ Resume ${o.nsWoTran || o.soId || o.id}?\n\n${o.heldReason ? `Stopped because: ${o.heldReason}\n\n` : ''}What was done to fix it? (recorded on the order)`, '');
        if (note === null) return;
        const n = String(note).trim();
        if (!n) return alert('Say what was done — a hold lifted silently teaches nobody anything.');
        try {
            await releaseHold({ db, doc, getDoc, getDocs, query, collection, where, updateDoc },
                { order: o, kind: o.soId ? 'sales' : 'stock', note: n, by: currentUser || '', notify });
            addLog(`▶ RESUMED ${o.nsWoTran || o.id} — ${n}`, 'success');
            loadRTGOrders();
        } catch (e) { alert('Could not resume: ' + (e.message || e)); }
    };

    // ── RECONCILIATION: WHERE THE BOARD AND THE FLOOR DISAGREE ──────────────────────────────────
    // (Stuart 2026-08-19: "this needs to be the single source of truth … no more orphans still open
    // on the floor.") RTG can only BE the authority if it can see where it is being contradicted.
    // The four live feeds it already subscribes to are exactly what the audit needs, so this costs
    // no extra reads. Every finding names the document and offers the close that settles it.
    const orphanFindings = useMemo(
        () => auditOrphans({ hqOrders: [...liveWO, ...liveSO], finWos: liveFin, shopJobs: liveShop }),
        [liveWO, liveSO, liveFin, liveShop]
    );
    const ORPHAN_COPY = {
        ORPHAN_FLOOR:   { label: 'On the floor, not on this board', why: 'A live floor job with no RTG record — nothing here can dispatch, close or report it.' },
        FLOOR_CLOSED:   { label: 'Closed on the floor, open here',  why: 'The floor finished with it; the board still lists it as live work.' },
        BOARD_CLOSED:   { label: 'Closed here, still live on the floor', why: 'The board closed it; the floor never heard, so it is still queued or being worked.' },
        NS_CLOSE_TODO:  { label: 'Close the balance in NetSuite', why: 'Closed in the app. A non-WIP work order cannot be closed through the API — its Close button is a client-side call, not an endpoint — so the balance has to be closed on the NetSuite transaction, then confirmed here.' },
    };
    const reconcileOne = async (f) => {
        const target = f.parent || f.floor;
        if (!target) return;
        const kind = (f.parent && f.parent.soId) ? 'sales' : 'stock';
        if (!window.confirm(`Reconcile ${target.id}?\n\n${ORPHAN_COPY[f.type].why}\n\nThis closes it EVERYWHERE — RTG, finishing, shop, and it queues the NetSuite close if one is open. Documents are kept.`)) return;
        try {
            const res = await closeEverywhere(
                { db, doc, getDoc, getDocs, query, collection, where, updateDoc },
                { order: target, kind, by: currentUser || '', from: 'RTG_RECONCILE', reason: f.type, notify }
            );
            addLog(`⇄ Reconciled ${target.id} (${f.type}) — ${res.fin} finishing, ${res.shop} shop, ${res.hq} RTG${res.ns ? `, NetSuite close queued (${res.ns})` : ''}.`, 'success');
            loadRTGOrders();
        } catch (e) { alert('Reconcile failed: ' + (e.message || e)); }
    };
    // The only honest way nsWoClosed becomes true: a person says they did it, with their name on it.
    const markNsClosed = async (f) => {
        const target = f.parent || f.floor;
        if (!target) return;
        const ref = target.nsWoTran || target.nsWoId || target.id;
        if (!window.confirm(`✓ Confirm the balance on NetSuite work order ${ref} has been closed?\n\nOnly tick this once it is actually closed on the NetSuite transaction — the app cannot check, so this is your word for it and it is recorded under your name.`)) return;
        try {
            const n = await confirmNsClosed({ db, doc, getDoc, getDocs, query, collection, where, updateDoc },
                { order: target, kind: (target.soId ? 'sales' : 'stock'), by: currentUser || '' });
            addLog(`✓ NetSuite close confirmed for ${ref} by ${currentUser || 'unknown'} — ${n} record(s) stamped.`, 'success');
            loadRTGOrders();
        } catch (e) { alert('Could not record that: ' + (e.message || e)); }
    };

    const reconcilePanel = () => {
        if (!orphanFindings.length) return (
            <div style={{ padding: '12px 24px', fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.06em', color: '#3a7d44' }}>
                ✓ BOARD AND FLOOR AGREE — no orphans, no unconfirmed closes.
            </div>
        );
        const byType = orphanFindings.reduce((m, f) => { (m[f.type] = m[f.type] || []).push(f); return m; }, {});
        return (
            <div style={{ padding: '4px 0 10px' }}>
                {Object.entries(byType).map(([type, list]) => (
                    <div key={type} style={{ padding: '10px 24px', borderTop: '1px solid var(--paper-2)' }}>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', color: '#d9534f', fontWeight: 700 }}>
                            {ORPHAN_COPY[type].label} · {list.length}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--ink-soft)', margin: '4px 0 8px', lineHeight: 1.5 }}>{ORPHAN_COPY[type].why}</div>
                        {list.slice(0, 12).map((f, i) => {
                            const t = f.parent || f.floor;
                            const code = woItemCodeOf(f.floor || f.parent);
                            return (
                                <div key={(t && t.id) + i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 0', fontSize: '0.85rem', flexWrap: 'wrap' }}>
                                    <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink)' }}>{(f.floor && (f.floor.nsWoTran || f.floor.displayId)) || (t && t.id)}</span>
                                    {code && <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>{code}</span>}
                                    {f.coll && <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)' }}>{f.coll === 'fin_workorders' ? 'FINISHING' : 'SHOP'}</span>}
                                    {type !== 'NS_CLOSE_TODO' && (
                                        <button onClick={() => reconcileOne(f)} style={{ ...btnStyle, padding: '4px 10px', fontSize: '9px', color: '#d9534f', borderColor: '#d9534f' }}>⇄ Close everywhere</button>
                                    )}
                                    {type === 'NS_CLOSE_TODO' && (
                                        <>
                                            <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)' }}>NS WO {(t && (t.nsWoTran || t.nsWoId)) || '—'}</span>
                                            <button onClick={() => markNsClosed(f)} title="Tick this once the balance is closed on the NetSuite work order — it is the only way this can be marked done, because the app cannot perform the close itself."
                                                style={{ ...btnStyle, padding: '4px 10px', fontSize: '9px', color: '#3a7d44', borderColor: '#3a7d44' }}>✓ Closed in NetSuite</button>
                                        </>
                                    )}
                                </div>
                            );
                        })}
                        {list.length > 12 && <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', marginTop: '4px' }}>…and {list.length - 12} more</div>}
                    </div>
                ))}
            </div>
        );
    };

    const dispatchedRow = (o, kind) => (
        <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', marginBottom: '6px', background: '#fff', border: '1px solid var(--line)', borderLeft: `4px solid ${(o.nsWoClosePending && !o.nsWoClosed) ? '#d9534f' : '#5a8f5a'}`, borderRadius: '2px' }}>
            {/* The close was queued and NetSuite has not confirmed it. Silence here is what let
                WO11434 read as closed in the app while it stayed open in NetSuite (Eric). */}
            {o.nsWoClosePending && !o.nsWoClosed && (
                <span title="The NetSuite close was queued but has not been confirmed. A non-WIP work order refuses the close transform — check the transmit log; it may still be open in NetSuite." style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.06em', padding: '2px 7px', border: '1px solid #d9534f', color: '#d9534f', whiteSpace: 'nowrap' }}>NS CLOSE UNCONFIRMED</span>
            )}
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
            {/* CLOSE SHORT — the scrap/partial-build path. Manager and above, because it moves
                NetSuite inventory (Stuart 2026-08-19). Stock builds only: a custom sales order
                cannot ship short, which the floor already enforces. */}
            {kind !== 'sales' && mayCloseBalance && (
                <button title="Built fewer than ordered? Record what was good, say what happened to the rest, close the balance and re-issue the shortfall."
                    style={{ ...btnStyle, padding: '6px 10px', fontSize: '9px', color: 'var(--brass)', borderColor: 'var(--brass)' }}
                    onClick={() => setBalanceModal({ order: o, kind, ordered: Number(o.totalParts || o.qty || 0), good: '', bad: '', salvage: true })}>⚖ Close Short</button>
            )}
            {kind !== 'sales' && (
                <button title="Re-explode this assembly against today's BOM and rewrite the pull lines — for an order raised before a BOM was corrected. Refused once picking has started."
                    style={{ ...btnStyle, padding: '6px 10px', fontSize: '9px' }} onClick={() => refreshBomLines(o, kind)}>↻ BOM</button>
            )}
            <button title="Close this order EVERYWHERE — RTG, finishing floor, shop floor, and the NetSuite work order if one exists. Docs kept for history."
                style={{ ...btnStyle, padding: '6px 10px', fontSize: '9px', color: '#d9534f', borderColor: '#d9534f' }} onClick={() => closeOrderEverywhere(o, kind)}>✕ Close</button>
        </div>
    );

    // ── REPAIR: the stock builds that went out with no NetSuite work order ────────────────────────
    // Every order released before 2026-08-17 through the non-finPayload path missed Route A entirely
    // (Eric: "no corresponding orders in NetSuite … treating them like the Just for Paint item").
    // Fixing the release path does nothing for those — they are already on the floor. This finds
    // them and queues the work order they should have had, without re-dispatching anything.
    //
    // Deliberately conservative: dispatched stock WOs only, never a paint run (which correctly has
    // no assembly), and never one that already has or has queued an id. queueNsStockWorkOrder keeps
    // its own stop mechanism, so running this twice cannot double-post.
    const nsOrphans = [...woBoard.recent, ...woBoard.archived].filter(o =>
        o.pushedToFinishing && o.paintOnly !== true && !o.nsWoId && !o.nsWoQueued);
    const repairMissingNsWos = async () => {
        if (!nsOrphans.length) return;
        const names = nsOrphans.slice(0, 12).map(o => `• ${o.woDisplayId || o.woId || o.id}${o.partErpId || o.rootItem ? ` — ${o.partErpId || o.rootItem}` : ''} ×${o.totalParts || 0}`).join('\n');
        if (!window.confirm(`Queue the missing NetSuite work orders for ${nsOrphans.length} dispatched stock build(s)?\n\n${names}${nsOrphans.length > 12 ? `\n…and ${nsOrphans.length - 12} more` : ''}\n\nThese were released before the NetSuite leg was queued for this path, so NetSuite never committed their components. This raises the work order they should have had — it does NOT re-dispatch them, and nothing on the floor changes.\n\nAn order that already has one is skipped.`)) return;
        let queued = 0, skipped = 0;
        for (const o of nsOrphans) {
            try {
                // The fin doc is the write-back target, so use the real one — its id differs by
                // release path (parked payload vs the WO id itself).
                const finId = (o.finPayload && o.finPayload.id) || o.id;
                const finSnap = await getDoc(doc(db, 'fin_workorders', finId));
                if (!finSnap.exists()) { skipped++; addLog(`○ ${o.woDisplayId || o.id}: no finishing job found (${finId}) — skipped.`, 'warn'); continue; }
                const fin = { id: finId, ...finSnap.data() };
                if (fin.nsWoId) { skipped++; addLog(`○ ${o.woDisplayId || o.id}: already has NetSuite WO ${fin.nsWoTran || fin.nsWoId} — skipped.`, 'info'); continue; }
                const note = await queueNsStockWorkOrder(o, fin);
                if (note.includes('📤')) queued++; else skipped++;
            } catch (e) {
                skipped++; addLog(`✗ ${o.woDisplayId || o.id}: ${e.message || e}`, 'error');
            }
        }
        addLog(`🏭 Repair done — ${queued} NetSuite work order(s) queued, ${skipped} skipped.`, queued ? 'success' : 'warn');
        alert(`${queued} NetSuite work order(s) queued, ${skipped} skipped.\n\nThey post from the sync queue over the next few minutes — watch 11.1 → NetSuite Sync Queue. Any skip is named in the log on this page.`);
        loadRTGOrders();
    };

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
    const buildFormData = (order, job, formType = '') => {
        const a = job?.customShippingAddress;
        const cityLine = a ? [a.city, a.state, a.zip].filter(Boolean).join(', ') : '';
        const shipTo = a ? [a.addressee || a.attention, a.addr1, a.addr2, cityLine].filter(Boolean) : null;
        const custName = job?.customer?.name || (typeof order?.customer === 'string' ? order.customer : '') || '';
        // ⚠ THE MONEY DOCUMENTS DROP BOM-ONLY PARTS (Stuart 2026-08-22: "hidden go to all shop
        // doc's just not customer docs"). A packing slip keeps them — the standoff is in the box.
        const lines = customerDocLines(job?.cpqData?.breakdown || [], formType).map(l => ({
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
            <FormPreview type={formType} brand={brand} logoUrl={brandLogos[brand]} header={tpl.header} footer={tpl.footer} terms={tpl.terms} docNumber={docNumber} data={buildFormData(order, job, formType)} />,
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
                try {
                    const s = await getDoc(doc(db, c, id)); if (!s.exists()) return false;
                    // Even test cleanup goes through the ledger — a HARD delete carries the record copy.
                    await hardDeleteWithLedger({ db, doc, setDoc, deleteDoc }, {
                        collection: c, docId: id, record: s.data(), kind: 'TEST_SEED',
                        by: currentUser || '', from: 'RTG_DISPATCH', reason: 'Brimar test-order removal',
                    });
                    return true;
                }
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
                    <button onClick={toggleAutoRelease} title={autoRelease?.enabled ? `Auto-release is ON (since ${autoRelease.sinceAt ? new Date(autoRelease.sinceAt).toLocaleString() : '—'}${autoRelease.by ? `, by ${autoRelease.by}` : ''}). New orders dispatch themselves one at a time; gated or ambiguous ones wait for a human. Click to turn OFF.` : 'Turn on auto-release: newly created orders push themselves to the floors, one at a time, fully logged. The parked backlog stays manual.'} style={{ ...btnStyle, background: autoRelease?.enabled ? 'var(--brass)' : '#fff', color: autoRelease?.enabled ? '#fff' : 'var(--brass)', border: '1px solid var(--brass)' }}>
                        {autoRelease?.enabled ? '⚡ Auto-Release ON' : '⚡ Auto-Release OFF'}
                    </button>
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
                                <div key={so.id} style={{ ...cardStyle, borderLeft: `4px solid ${isUrgent(so) ? '#d9534f' : 'var(--ink)'}`, ...(isUrgent(so) ? { background: '#fdf3f3' } : {}) }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                                        <div>
                                            <div style={{ fontWeight: 500, fontSize: '1.1rem', color: isUrgent(so) ? '#d9534f' : 'var(--ink)' }}>SO: {so.soId || so.id}</div>
                                            <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '4px' }}>Cust: {so.customer || 'N/A'}</div>
                                            {urgentControls(so, 'hq_sales_orders')}
                                        </div>
                                        <button onClick={() => deleteOrder('hq_sales_orders', so)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', padding: 0, color: 'var(--ink-soft)' }}>×</button>
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
                                <div key={wo.id} style={{ ...cardStyle, borderLeft: `4px solid ${isUrgent(wo) ? '#d9534f' : 'var(--brass)'}`, ...(isUrgent(wo) ? { background: '#fdf3f3' } : {}) }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                                        <div>
                                            <div style={{ fontWeight: 500, fontSize: '1.1rem', color: isUrgent(wo) ? '#d9534f' : 'var(--ink)' }} title={`${wo.id}${wo.nsWoTran ? ` · NetSuite ${wo.nsWoTran}` : ''}`}>WO: {wo.nsWoTran || wo.woId || wo.id}</div>
                                            {/* WHAT THE ORDER IS, WITHOUT OPENING IT (Eric 2026-08-18: "they sit in RTG as
                                                WO-STK-11941-1787076774248. You must click view to see what the order is.
                                                Can it display the item, finish, quantity, and date"). Everything here was
                                                already on the doc — the card just said "Build to Stock". */}
                                            {(() => {
                                                const code = woItemCodeOf(wo);
                                                const fin = String(wo.recipe || '').trim();
                                                const qty = Number(wo.totalParts || wo.qty || 0);
                                                const need = wo.needBy || wo.reqDate || '';
                                                return (
                                                    <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '4px' }}>
                                                        {code
                                                            ? <><span style={{ fontFamily: 'var(--mono)', fontSize: '0.95rem', fontWeight: 600, color: 'var(--ink)' }}>{code}</span>{qty ? ` (×${qty})` : ''}{fin && !code.toUpperCase().endsWith(`/${fin.toUpperCase()}`) ? ` · ${fin}` : ''}{need ? ` · Need by ${need}` : ''}</>
                                                            : <>Build to Stock{qty ? ` (×${qty})` : ''}{need ? ` · Need by ${need}` : ''}</>}
                                                        {wo.itemName ? <div style={{ fontSize: '0.8rem' }}>{wo.itemName}</div> : null}
                                                    </div>
                                                );
                                            })()}
                                            {wo.awaitingRodCut && (
                                                <div title={`WMS → ROD CUTS → Cuts for Finishing. ${wo.rodCutNote || ''}`} style={{ fontSize: '0.8rem', color: 'var(--brass)', fontWeight: 600, marginTop: '4px' }}>
                                                    ✂ AWAITING ROD CUT{wo.rodCutNote ? <span style={{ fontWeight: 400, color: 'var(--ink-soft)' }}> · {wo.rodCutNote}</span> : ''}
                                                </div>
                                            )}
                                            {wo.needsPhosphating && <div style={{ fontSize: '0.8rem', color: '#d9534f', fontWeight: 600, marginTop: '4px' }}>*REQUIRES PHOSPHATING*</div>}
                                            {wo.isPlatingDemand && <div style={{ fontSize: '0.8rem', color: 'var(--brass)', fontWeight: 600, marginTop: '4px' }}>*PLATING DEMAND STOCK*</div>}
                                            {urgentControls(wo, 'hq_work_orders')}
                                        </div>
                                        <button onClick={() => deleteOrder('hq_work_orders', wo)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', padding: 0, color: 'var(--ink-soft)' }}>×</button>
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                        <button style={{ ...btnStyle, flex: 1 }} onClick={() => handleViewOrder(wo, 'stock')}>View</button>
                                        <button style={{ ...btnStyle, flex: 1 }} title="Re-explode this assembly against today's BOM and rewrite the warehouse pull lines. Refused once picking has started." onClick={() => refreshBomLines(wo, 'stock')}>↻ BOM</button>
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

                            {nsOrphans.length > 0 && (
                                <div style={{ marginTop: '14px', padding: '12px 14px', border: '1px solid #d9534f', background: '#fdf3f3' }}>
                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', color: '#d9534f', fontWeight: 700, marginBottom: '6px' }}>
                                        ⚠ {nsOrphans.length} dispatched build{nsOrphans.length === 1 ? '' : 's'} with no NetSuite work order
                                    </div>
                                    <div style={{ fontSize: '11px', color: 'var(--ink)', lineHeight: 1.5, marginBottom: '9px' }}>
                                        Released before this path queued its NetSuite leg, so NetSuite never committed their components and no WO number came back. Raising the work orders now does not re-dispatch them or touch the floor.
                                    </div>
                                    <button onClick={repairMissingNsWos} style={{ ...btnStyle, background: '#d9534f', color: '#fff', border: 'none', width: '100%' }}>
                                        🏭 Queue the missing NetSuite work orders
                                    </button>
                                </div>
                            )}

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
                                        <button onClick={() => deleteOrder('hq_purchase_orders', po)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', padding: 0, color: 'var(--ink-soft)' }}>×</button>
                                    </div>
                                    {!poLocked(po) && (
                                        <button style={{ ...btnStyle, width: '100%', background: '#fff', border: '1px solid var(--brass)', color: 'var(--brass)', marginBottom: '8px' }} onClick={() => openPoEdit(po)} title="Add or remove lines, fix quantities and rates — editable until the PO is queued to NetSuite.">✎ Edit PO</button>
                                    )}
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
                                        <button onClick={() => deleteOrder('hq_inventory_tasks', inv)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', padding: 0, color: 'var(--ink-soft)' }}>×</button>
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
                    <>
                    <HeldOrdersBanner orders={heldOrders} onRelease={resumeHeld} refOf={(o) => o.nsWoTran || o.soId || o.woId || o.id} />
                    {/* RECONCILIATION sits directly above the transmit log: together they are the
                        two ways this board can be contradicted — by the floor, and by NetSuite. */}
                    <div style={{ background: '#fff', border: `1px solid ${orphanFindings.length ? '#d9534f' : 'var(--line)'}`, borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', marginBottom: '24px' }}>
                        <div style={{ padding: '14px 24px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                            <span style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)' }}>Board vs Floor</span>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: orphanFindings.length ? '#d9534f' : 'var(--ink-soft)' }}>
                                {orphanFindings.length ? `${orphanFindings.length} disagreement${orphanFindings.length === 1 ? '' : 's'} — RTG is the record; settle them here` : 'this board is the single source of truth'}
                            </span>
                        </div>
                        {reconcilePanel()}
                    </div>
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
                    </>
                );
            })()}

            {/* ✎ PO EDITOR MODAL (2026-08-26) */}
            {poEdit && (
                <div onClick={() => !poEdit.busy && setPoEdit(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.8)', zIndex: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                    <div onClick={e => e.stopPropagation()} style={{ background: '#fff', width: '860px', maxWidth: '96vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column', border: '1px solid var(--line)', boxShadow: '0 4px 24px rgba(0,0,0,0.15)' }}>
                        <div style={{ padding: '18px 24px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                            <div>
                                <span style={{ fontFamily: 'var(--serif)', fontSize: '1.3rem', fontWeight: 500 }}>✎ Edit PO {poEdit.po.poId || poEdit.po.id}</span>
                                <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', marginLeft: '12px' }}>{poEdit.po.vendor || ''} · editable until pushed to NetSuite</span>
                            </div>
                            <button onClick={() => setPoEdit(null)} style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: 'var(--ink-soft)', lineHeight: 1 }}>×</button>
                        </div>
                        <div style={{ padding: '18px 24px', overflowY: 'auto' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 70px 90px 34px', gap: '8px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-soft)', marginBottom: '6px' }}>
                                <span>Item</span><span>Description</span><span>Qty</span><span>Rate $</span><span></span>
                            </div>
                            {poEdit.items.map((ln, i) => (
                                <div key={i} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 70px 90px 34px', gap: '8px', alignItems: 'center', marginBottom: '6px' }}>
                                    <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink)' }}>{ln.itemId}</span>
                                    <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ln.description}>{ln.description}</span>
                                    <input value={ln.quantity} inputMode="numeric" onChange={e => setPoEdit(prev => ({ ...prev, items: prev.items.map((y, j) => j === i ? { ...y, quantity: e.target.value } : y) }))}
                                        style={{ padding: '6px', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '11px', textAlign: 'center' }} />
                                    <input value={ln.rate} inputMode="decimal" onChange={e => setPoEdit(prev => ({ ...prev, items: prev.items.map((y, j) => j === i ? { ...y, rate: e.target.value } : y) }))}
                                        style={{ padding: '6px', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '11px', textAlign: 'right' }} />
                                    <button onClick={() => setPoEdit(prev => ({ ...prev, items: prev.items.filter((_, j) => j !== i) }))} title="Remove this line" style={{ background: 'none', border: '1px solid var(--line)', color: '#d9534f', cursor: 'pointer', padding: '4px 0' }}>×</button>
                                </div>
                            ))}
                            <div style={{ display: 'grid', gridTemplateColumns: '200px 90px 100px auto', gap: '8px', alignItems: 'center', marginTop: '14px', paddingTop: '12px', borderTop: '1px dashed var(--line)' }}>
                                <input value={poEdit.add.code} placeholder="Add item — our code or customer #" onChange={e => setPoEdit(prev => ({ ...prev, add: { ...prev.add, code: e.target.value } }))}
                                    style={{ padding: '7px', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '11px' }} />
                                <input value={poEdit.add.qty} placeholder="Qty" inputMode="numeric" onChange={e => setPoEdit(prev => ({ ...prev, add: { ...prev.add, qty: e.target.value } }))}
                                    style={{ padding: '7px', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '11px', textAlign: 'center' }} />
                                <input value={poEdit.add.rate} placeholder="Rate (auto)" inputMode="decimal" onChange={e => setPoEdit(prev => ({ ...prev, add: { ...prev.add, rate: e.target.value } }))}
                                    style={{ padding: '7px', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '11px', textAlign: 'right' }} />
                                <button onClick={poEditAddLine} style={{ ...btnStyle, background: 'var(--ink)', color: '#fff', border: 'none' }}>+ Add line</button>
                            </div>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', marginTop: '8px' }}>Blank rate = the item's vendor purchase price. A line set to qty 0 is removed on save.</div>
                        </div>
                        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                            <button onClick={() => setPoEdit(null)} disabled={poEdit.busy} style={{ ...btnStyle }}>Cancel</button>
                            <button onClick={savePoEdit} disabled={poEdit.busy} style={{ ...btnStyle, background: '#3a7d44', color: '#fff', border: 'none' }}>{poEdit.busy ? 'Saving…' : `💾 Save ${poEdit.items.length} line(s)`}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ============ ⇄ QUOTES & SALES ORDERS — master in/out review (2026-08-25) ============ */}
            <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', marginBottom: '24px' }}>
                <div style={{ padding: '16px 24px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: '4px' }}>Saved in CPQ / Quick Ship → queued → NetSuite → # written back to CRM · the queue itself is the Transmit Log below</span>
                    <span style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)' }}>⇄ Quotes & Sales Orders — NetSuite In/Out</span>
                </div>
                <div style={{ maxHeight: '340px', overflowY: 'auto' }}>
                    {txJobs.length === 0 && <div style={{ padding: '18px 24px', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)' }}>Nothing transmitted yet — quotes and orders appear here the moment a CPQ or Quick Ship save queues them.</div>}
                    {txJobs.map(j => {
                        const queued = j.nsTransmitQueuedAt && !j.netsuiteEstimateId && !j.netsuiteSalesOrderId;
                        const stateTone = j.netsuiteSalesOrderId ? '#3a7d44' : (j.netsuiteEstimateId ? '#3f7fc4' : 'var(--brass)');
                        const stateLabel = j.netsuiteSalesOrderId ? `SO ${j.netsuiteSalesOrderNo || j.netsuiteSalesOrderId}` : (j.netsuiteEstimateId ? `EST ${j.netsuiteEstimateNo || j.netsuiteEstimateId}` : 'QUEUED — posting…');
                        return (
                            <div key={j.id} style={{ display: 'flex', alignItems: 'baseline', gap: '14px', flexWrap: 'wrap', padding: '10px 24px', borderBottom: '1px solid var(--paper-2)', fontSize: '0.85rem' }}>
                                <b style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink)' }}>{j.quoteNo || j.jobId || j.id}</b>
                                <span style={{ color: 'var(--ink-soft)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{j.customer?.name || ''}{j.sidemark ? ` · ${j.sidemark}` : ''}</span>
                                {j.cpqData?.totalPrice ? <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>${Number(j.cpqData.totalPrice).toFixed(2)}</span> : null}
                                <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.06em', color: stateTone, whiteSpace: 'nowrap' }}>{stateLabel}</span>
                                <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-faint, var(--ink-soft))', whiteSpace: 'nowrap' }}>{String(j.status || '').replace(/_/g, ' ')}</span>
                                {queued && <span title="Waiting on the staged sync (~1 min). If it sits here, check the Transmit Log below / 11.1 Sync Queue." style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--brass)' }}>⏳</span>}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ============ MASTER DELETION LEDGER (append-only, every screen's deletes) ============ */}
            <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', marginBottom: '24px' }}>
                <div onClick={() => setShowDeletionLog(v => !v)} style={{ padding: '16px 24px', background: 'var(--paper-2)', borderBottom: showDeletionLog ? '1px solid var(--line)' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
                    <div>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: '4px' }}>Append-only · every delete, every screen · the record never leaves the system</span>
                        <span style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)' }}>📜 Deletion Ledger</span>
                    </div>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>{deletionLog.length ? `${deletionLog.length} entr${deletionLog.length === 1 ? 'y' : 'ies'} · ` : ''}{showDeletionLog ? '▼ HIDE' : '▶ SHOW'}</span>
                </div>
                {showDeletionLog && (
                    <div style={{ maxHeight: '420px', overflowY: 'auto' }}>
                        {deletionLog.length === 0 && <div style={{ padding: '20px 24px', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)' }}>No deletions recorded. (If deletes are happening but nothing appears here, the hq_deletion_log firestore rule has not been deployed yet.)</div>}
                        {deletionLog.map(e => (
                            <div key={e.id} style={{ padding: '12px 24px', borderBottom: '1px solid var(--paper-2)', fontSize: '0.85rem' }}>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
                                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>{e.at ? new Date(e.at).toLocaleString() : '—'}</span>
                                    <b style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink)' }}>{e.collection}/{e.docId}</b>
                                    <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', padding: '2px 7px', border: '1px solid', borderColor: e.mode === 'HARD' ? '#d9534f' : 'var(--brass)', color: e.mode === 'HARD' ? '#d9534f' : 'var(--brass)' }}>{e.mode === 'HARD' ? 'DESTROYED (copy kept)' : 'DELETED (record kept)'}</span>
                                    <span style={{ color: 'var(--ink-soft)' }}>by <b style={{ color: 'var(--ink)' }}>{e.by || '?'}</b> from {String(e.from || '').replace(/_/g, ' ')}</span>
                                </div>
                                <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', marginTop: '5px', letterSpacing: '.02em' }}>
                                    {[e.identity?.itemCode, e.identity?.quoteNo, e.identity?.soId, e.identity?.woNum, e.identity?.customer,
                                      e.identity?.status ? `was ${e.identity.status}` : null,
                                      e.identity?.totalPrice ? `$${Number(e.identity.totalPrice).toFixed(2)}` : null,
                                      e.identity?.totalParts ? `×${e.identity.totalParts}` : null].filter(Boolean).join(' · ') || '—'}
                                    {e.reason ? <span style={{ color: 'var(--ink)', fontStyle: 'italic' }}> — “{e.reason}”</span> : null}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

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
            {/* ⚖ CLOSE SHORT — the four scenarios Eric described, as three numbers and one question. */}
            {balanceModal && (() => {
                const m2 = balanceModal;
                const code = woItemCodeOf(m2.order) || m2.order.id;
                const raw = millBaseOf(code);
                const plan = planBalanceClose({ ordered: m2.ordered, good: m2.good, bad: m2.bad, salvage: m2.salvage });
                const fld = { padding: '10px 12px', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '1rem', width: '110px', outline: 'none' };
                return (
                    <div onClick={() => setBalanceModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,.8)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                        <div onClick={e => e.stopPropagation()} style={{ background: '#fff', width: '640px', maxWidth: '96vw', maxHeight: '92vh', overflowY: 'auto', border: '1px solid var(--line)', padding: '28px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                                <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)' }}>Close short</h2>
                                <button onClick={() => setBalanceModal(null)} style={{ background: 'none', border: 'none', fontSize: '1.6rem', color: 'var(--ink-soft)', cursor: 'pointer' }}>×</button>
                            </div>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink-soft)', marginBottom: '20px' }}>{code} · ordered {plan.ordered} · {m2.order.nsWoTran || m2.order.id}</div>

                            <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', marginBottom: '18px' }}>
                                <label style={{ display: 'block' }}>
                                    <span style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-soft)', marginBottom: '6px' }}>Good — built</span>
                                    <input autoFocus type="number" min="0" max={plan.ordered} value={m2.good} onChange={e => setBalanceModal({ ...m2, good: e.target.value })} style={fld} />
                                </label>
                                <label style={{ display: 'block' }}>
                                    <span style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-soft)', marginBottom: '6px' }}>Bad — pieces that exist</span>
                                    <input type="number" min="0" value={m2.bad} onChange={e => setBalanceModal({ ...m2, bad: e.target.value })} style={fld} />
                                    <span style={{ display: 'block', fontSize: '10px', color: 'var(--ink-soft)', marginTop: '4px', maxWidth: '190px', lineHeight: 1.4 }}>Leave 0 for a plain shortage — nothing was made.</span>
                                </label>
                            </div>

                            {/* The salvage question, asked only when there is something to salvage. */}
                            {plan.hasPhysicalBad && (
                                <div style={{ padding: '14px 16px', border: '1px solid var(--brass)', background: '#fdfaf3', marginBottom: '18px' }}>
                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--brass)', marginBottom: '10px' }}>Are those {plan.bad} salvageable?</div>
                                    <div style={{ display: 'flex', gap: '10px' }}>
                                        <button onClick={() => setBalanceModal({ ...m2, salvage: true })} style={{ ...btnStyle, flex: 1, background: m2.salvage ? 'var(--ink)' : '#fff', color: m2.salvage ? '#fff' : 'var(--ink)', border: '1px solid var(--line)' }}>Yes — back to raw stock</button>
                                        <button onClick={() => setBalanceModal({ ...m2, salvage: false })} style={{ ...btnStyle, flex: 1, background: !m2.salvage ? '#d9534f' : '#fff', color: !m2.salvage ? '#fff' : 'var(--ink)', border: `1px solid ${!m2.salvage ? '#d9534f' : 'var(--line)'}` }}>No — adjust out</button>
                                    </div>
                                    <div style={{ fontSize: '11px', color: 'var(--ink-soft)', marginTop: '8px', lineHeight: 1.5 }}>
                                        {m2.salvage ? `Put ${plan.returnToBinQty} × ${raw} back in the bin — no stock movement, the build never consumed them.` : `−${plan.adjustOutQty} × ${raw} written off as unusable.`}
                                    </div>
                                </div>
                            )}

                            <div style={{ padding: '14px 16px', background: 'var(--paper)', border: '1px solid var(--line)', marginBottom: '20px', whiteSpace: 'pre-wrap', fontSize: '0.88rem', lineHeight: 1.7, color: 'var(--ink)' }}>
                                {describeBalanceClose(plan, { itemCode: code, rawCode: raw, bin: m2.order.rodCutDestBin || m2.order.binLocation || '' })}
                            </div>

                            <button disabled={plan.nothingToDo} onClick={runBalanceClose}
                                style={{ width: '100%', padding: '14px', background: plan.nothingToDo ? 'var(--paper-2)' : 'var(--ink)', color: plan.nothingToDo ? 'var(--ink-soft)' : '#fff', border: 'none', cursor: plan.nothingToDo ? 'default' : 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                                {plan.nothingToDo ? 'Enter what was built' : `⚖ Build ${plan.buildQty} · close balance ${plan.balance}`}
                            </button>
                        </div>
                    </div>
                );
            })()}


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