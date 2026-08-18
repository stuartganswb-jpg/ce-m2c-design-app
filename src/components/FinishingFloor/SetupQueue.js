import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { doc, updateDoc, setDoc, getDocs, query, where, collection, onSnapshot } from "firebase/firestore";
import { btnStyle, cardStyle } from './finishingStyles';
import { enqueueNsWrite } from '../Shared/nsOutbox';
import { nsProxyFetch } from '../Shared/nsProxy';
import { makeFullTasks, woItemCodeOf, woItemNameOf, isPlaceholderDims } from '../Shared/workOrderContract';
import ConfiguredItemViewer from '../Shared/ConfiguredItemViewer';
import { finishRouteOf } from '../Shared/finishRouting';
import OrderStatusChips from '../Shared/OrderStatusChips';

// Brand → NetSuite map (keep in sync with PickPackApp/NetSuiteSync/ERPPushPull/AdminTab/RTG).
// Finishing converts only ever run for the shop brands.
const BRAND_NETSUITE_MAP = { 'ce': { subsidiary: "2", location: "17" }, 'm2c': { subsidiary: "3", location: "19" } };

const SetupQueue = ({ workOrders = [], recipes = {}, writeLog, sysConfig = {}, currentUser = '' }) => {
  // Active Floor load is INFORMATIONAL ONLY (Stuart 2026-07-21: the old §A4 200-pc daily cap
  // blocked real staging — removed; the floor manages its own pace).
  const activeFloorLoad = workOrders
    .filter(w => w.currentPhase === 'Painting')
    .reduce((sum, w) => sum + (Number(w.totalParts) || 0), 0);
  const [activeSpecs, setActiveSpecs] = useState(null);
  // 📝 ORDER NOTES (Stuart 2026-08-01) — free notes tied to ONE work order, with the author
  // stamped and a READ LOG beneath, so "did the floor see this?" is answerable after the fact
  // rather than a conversation. Stored on the WO doc: orderNotes[] and noteReads[].
  const [noteWo, setNoteWo] = useState(null);   // the WO whose notes panel is open
  const [noteDraft, setNoteDraft] = useState('');
  const [cfgQuote, setCfgQuote] = useState(null); // "view configured item" read-only 3D modal

  // (Stuart 2026-07-17: Direct Order Intake removed — every WO now arrives through the real
  // pipelines: CPQ/RTG dispatch for sales, Sales Snapshot → RTG for stock builds.)

  // OUTSOURCED FINISHES DO NOT BELONG ON THIS FLOOR (Stuart 2026-07-30: "these orders … are both
  // for items that have outsourced finishes, so the cpq/routing … needs to respect the outsourced
  // and these both should be routed to wms pick and pack"). An EP*/MEP*/P25 part is plated by an
  // outside vendor — there is no recipe to batch and nothing to spray, which is exactly why both of
  // them were sitting in the PENDING-RECIPE group as work no one could start. They keep their WMS
  // pick (that is untouched — the pick queue reads sentToPickPack/pickStatus, not currentPhase) and
  // ride the OB PLATING bin out on the weekly plater PO.
  const inSetup = workOrders.filter(w => w.currentPhase === "Setup" || w.currentPhase === "setup");
  const outsourcedOrders = inSetup.filter(w => finishRouteOf(w).outsourced);
  const outsourcedIds = new Set(outsourcedOrders.map(w => w.id));
  const pendingOrders = inSetup.filter(w => !outsourcedIds.has(w.id));

  // ⚡ URGENT, UNACKNOWLEDGED → PINNED ABOVE EVERYTHING (Stuart 2026-07-30: "when flagged this way
  // the work order should arrive pinned to the top of the set up queue screen where the operator
  // can easily see it and acknowledge it then it can fall back into the ordered group of its finish
  // code"). Acknowledging does NOT change the order's phase or priority — it only says a human has
  // seen it, at which point it drops back into its finish batch where the work actually happens.
  const urgentPinned = pendingOrders
    .filter(w => w.urgent && !w.urgentAck)
    .sort((a, b) => new Date(a.needBy || a.reqDate || '2999-12-31') - new Date(b.needBy || b.reqDate || '2999-12-31'));
  const ackUrgent = async (wo) => {
    try {
      await updateDoc(doc(db, "fin_workorders", wo.id), { urgentAck: true, urgentAckAt: Date.now(), urgentAckBy: currentUser || 'Floor' });
      if (writeLog) writeLog(`Acknowledged URGENT ${wo.displayId || wo.id} (need by ${wo.needBy || wo.reqDate || 'ASAP'})`, 'setup');
    } catch (e) { alert(`Couldn't acknowledge: ${e.message}`); }
  };

  // 📅 PLANNED RUN DAY PER FINISH (Stuart 2026-07-30: "the operator can highlight the day they plan
  // to run that finish color so that the rest of the team will know and it can plan accordingly if
  // they need to place any more orders for parts in those finishes"). One shared doc so every
  // screen — and everyone ordering parts — sees the same plan. Multi-select: a big colour can run
  // across two days.
  const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'];
  const [runDays, setRunDays] = useState({});   // recipe -> { days: [], by, at }
  useEffect(() => onSnapshot(doc(db, 'system', 'finish_run_days'), (d) => setRunDays(d.exists() ? (d.data().byRecipe || {}) : {})), []);
  const toggleRunDay = async (recipe, day) => {
    const cur = (runDays[recipe] && runDays[recipe].days) || [];
    const next = cur.includes(day) ? cur.filter(d => d !== day) : [...cur, day].sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b));
    try {
      await setDoc(doc(db, 'system', 'finish_run_days'), {
        byRecipe: { ...runDays, [recipe]: { days: next, by: currentUser || 'Floor', at: Date.now() } }
      }, { merge: true });
      if (writeLog) writeLog(`Run day for ${recipe}: ${next.length ? next.join(', ') : 'cleared'}`, 'setup');
    } catch (e) { alert(`Couldn't save the run day: ${e.message}`); }
  };
  // Follow the committed run order (scheduleSeq, set by the Schedule's "Commit" button) when present;
  // fall back to required date for anything not yet committed.
  pendingOrders.sort((a, b) => {
    // Urgent first inside its batch — acknowledging takes it off the pin, it should not then be
    // buried behind everything else in the same colour.
    if (!!a.urgent !== !!b.urgent) return a.urgent ? -1 : 1;
    const sa = a.scheduleSeq ?? Infinity, sb = b.scheduleSeq ?? Infinity;
    if (sa !== sb) return sa - sb;
    return new Date(a.needBy || a.reqDate) - new Date(b.needBy || b.reqDate);
  });

  // GROUPED BY FINISH (Stuart 2026-07-17): the floor finishes in batches per recipe, so the
  // queue displays one section per finish — orders keep their committed/req-date order inside
  // a section; sections order by their earliest member. (Replaces the AI Batching toggle —
  // grouping is now always on.)
  const finishGroups = (() => {
      const m = new Map();
      pendingOrders.forEach(wo => {
          const key = String(wo.recipe || wo.color || '— NO RECIPE —').trim() || '— NO RECIPE —';
          if (!m.has(key)) m.set(key, []);
          m.get(key).push(wo);
      });
      return [...m.entries()].map(([recipe, orders]) => ({
          recipe, orders,
          pieces: orders.reduce((s, w) => s + (Number(w.totalParts) || 0), 0),
          firstSeq: Math.min(...orders.map(o => (o.scheduleSeq ?? Infinity))),
          firstDate: Math.min(...orders.map(o => { const t = new Date(o.reqDate || '2999-12-31').getTime(); return Number.isFinite(t) ? t : Infinity; }))
      })).sort((a, b) => (a.firstSeq !== b.firstSeq) ? a.firstSeq - b.firstSeq : a.firstDate - b.firstDate);
  })();

  // Same precision rule as the WMS pick app: a line with a real item # is pickable; the
  // fee/return/splice NAME test only applies to lines with no real id.
  const FEEISH_RE = /\b(FRENCH|MITERED|MITER|BENT)\s+RETURN\b|\bSPLICE\b|\bFEE\b/i;
  const pickableCount = (wo) => (wo.partsList || []).filter(l => {
      if (l && (l.isFee || l.lineIsFee)) return false;
      const pid = String((l && (l.legacyErpId || l.partId)) || '');
      const hasRealId = pid && pid !== 'PENDING' && pid !== 'N/A' && pid !== 'UNASSIGNED' && !/(^|-)(FEE|HIDDEN)-/.test(pid);
      return hasRealId || !FEEISH_RE.test(String((l && l.name) || ''));
  }).length;
  // Release the small-parts pick to the WMS pick app (its queue = sentToPickPack +
  // pickStatus 'Pending'). Idempotent: an already-released or already-picked order is untouched.
  const releasePickPatch = (wo) => {
      if (wo.sentToPickPack) return { patch: {}, note: '' };
      const n = pickableCount(wo);
      if (n > 0) return {
          patch: { sentToPickPack: true, pickStatus: wo.pickStatus || 'Pending', sentToPickPackAt: Date.now() },
          note: ` — ${n} part line${n === 1 ? '' : 's'} released to the WMS pick queue`
      };
      // SNAPSHOT STOCK BUILDS (Stuart 2026-07-20): no BOM partsList on these — the pull IS the
      // raw base core (finish suffix stripped off the stock item), qty = the build count.
      // Synthesize that single pick line so WMS pulls the cores for finishing; the bin
      // resolves from the Master Library on the WMS side.
      const stockErp = String(wo.stockErpId || (wo.orderType === 'stock' ? wo.type : '') || '');
      if (stockErp) {
          const cut = stockErp.lastIndexOf('/');
          // JFP paint-only (Eric 2026-08-11/12): the PULL SOURCE was decided at creation —
          // jfpPullFrom when repainting stock of a different finish, else the code as typed.
          // Never strip the suffix into an invented "raw core". The pick posts the −qty
          // adjustment for JFP pulls automatically (jfpSource flag below).
          const jfpBase = String(wo.jfpPullFrom || stockErp);
          const base = wo.paintOnly === true ? jfpBase : (cut > 0 ? stockErp.slice(0, cut) : stockErp);
          const qty = Number(wo.totalParts) || 1;
          const label = wo.paintOnly === true
              ? `${base} — pull ${qty} to repaint ${wo.recipe || ''} → ${stockErp}${base !== stockErp ? ' (source set at creation)' : ''} · skip if customer-supplied`
              : `RAW ${base} — pull ${qty} to finish ${wo.recipe || ''} → ${stockErp}`;
          return {
              patch: {
                  sentToPickPack: true, pickStatus: wo.pickStatus || 'Pending', sentToPickPackAt: Date.now(),
                  partsList: [{ legacyErpId: base, partId: base, partName: label, quantity: qty, partHandling: 'Small Parts',
                      ...(wo.paintOnly === true ? { jfpSource: true, ...(wo.jfpPullFromNsId ? { jfpSourceNsId: String(wo.jfpPullFromNsId) } : {}) } : {}) }]
              },
              note: ` — pull ${qty} × ${base}${wo.paintOnly === true ? ' (JFP repaint)' : ' (raw base)'} released to the WMS pick queue`
          };
      }
      return { patch: {}, note: ' — no small parts to pick (not sent to WMS)' };
  };

  const startSetup = async (wo) => {
    try {
        // Start Setup RELEASES THE PARTS PICK (Stuart 2026-07-18): warehouse pulls the small
        // parts on the WMS pick app while setup runs — not just a button-status change.
        const { patch, note } = releasePickPatch(wo);
        await updateDoc(doc(db, "fin_workorders", wo.id), { stepStatus: "Running", ...patch });
        if (writeLog) writeLog(`Started Setup for ${wo.displayId || wo.id}${note}`, 'production');
        if (patch.sentToPickPack) alert(`📦 Parts pick released to the WMS pick app${note.replace(' — ', ': ')}.`);
        else if (note) alert(`Setup started${note}.`);
    } catch (err) {
        console.error("Start Setup Error:", err);
        alert(`FIREBASE BLOCKED UPDATE for ID [${wo.id}]. Reason: ${err.message}`);
    }
  };

  const stageToFloor = async (wo) => {
    const pieces = Number(wo.totalParts) || 0;
    try {
        // Safety net: an order that went Running before the Start-Setup release fix (or was
        // never released) still gets its parts pick sent to WMS at the latest possible gate.
        const { patch, note } = releasePickPatch(wo);
        await updateDoc(doc(db, "fin_workorders", wo.id), { stepStatus: "Staged", currentPhase: "Painting", currentStepIndex: 0, ...patch });
        if (writeLog) writeLog(`Staged ${wo.displayId || wo.id} to Floor (${pieces} pcs; floor now ~${activeFloorLoad + pieces} pcs)${note}`, 'production');
        if (patch.sentToPickPack) alert(`📦 Parts pick released to the WMS pick app${note.replace(' — ', ': ')}.`);
    } catch (err) {
        console.error("Stage to Floor Error:", err);
        alert(`FIREBASE BLOCKED STAGE for ID [${wo.id}]. Reason: ${err.message}`);
    }
  };

  // SAFE CLOSE (Stuart 2026-07-17, replaces the all-or-nothing Nuke Queue — real orders live
  // here now): one WO at a time, confirm first. Soft-close — the doc is KEPT for history,
  // currentPhase 'Closed' drops it from every queue/planner. If a REAL NetSuite work order
  // backs it (nsWoId, Route A stock builds), the NetSuite WO close is queued through the
  // outbox too, so On-Ord stops counting it. Old pre-NetSuite WOs close app-side only.
  // WHO IS READING/WRITING. The finishing app identifies people by their chip PIN; currentUser is
  // whoever opened the screen. A note is worthless without a name against it, so an unnamed
  // session is asked once rather than allowed to post anonymously.
  const noteActor = () => {
      const u = String(currentUser || '').trim();
      if (u) return u;
      const typed = window.prompt('Your name (it is stamped on the note):');
      return String(typed || '').trim();
  };
  const notesOf = (wo) => Array.isArray(wo?.orderNotes) ? wo.orderNotes : [];
  const readsOf = (wo) => Array.isArray(wo?.noteReads) ? wo.noteReads : [];
  const stamp = (ms) => ms ? new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

  // OPENING THE PANEL IS THE READ. Recorded once per person per NOTE — if the same person opens it
  // again with nothing new posted since, it is not logged twice; a new note makes their next open
  // count again. That keeps the log meaningful ("who has seen the CURRENT note") instead of a
  // thousand identical rows.
  const openNotes = async (wo) => {
      setNoteWo(wo); setNoteDraft('');
      const notes = notesOf(wo);
      if (!notes.length) return;
      const who = String(currentUser || '').trim();
      if (!who) return;                                  // never invent a reader
      const newest = Math.max(...notes.map(n => n.at || 0));
      const mine = readsOf(wo).filter(r => String(r.by || '') === who).map(r => r.at || 0);
      if (mine.length && Math.max(...mine) >= newest) return;   // already seen this one
      try {
          await updateDoc(doc(db, 'fin_workorders', wo.id), { noteReads: [...readsOf(wo), { by: who, at: Date.now() }] });
      } catch (e) { /* a read receipt must never block reading */ }
  };

  const addNote = async () => {
      const text = noteDraft.trim();
      if (!text || !noteWo) return;
      const by = noteActor();
      if (!by) return;
      try {
          await updateDoc(doc(db, 'fin_workorders', noteWo.id), { orderNotes: [...notesOf(noteWo), { text, by, at: Date.now() }] });
          if (writeLog) writeLog(`📝 Note added to ${noteWo.nsWoTran || noteWo.woNum || noteWo.id} by ${by}: ${text.slice(0, 80)}`, 'info');
          setNoteDraft('');
      } catch (e) { alert('Could not save the note: ' + (e.message || e)); }
  };

  const closeOrder = async (wo) => {
      const nsNote = wo.nsWoId
          ? `\n\nThis WO has a NetSuite work order (${wo.nsWoTran || wo.nsWoId}) — closing here ALSO queues the NetSuite WO close (watch 11.1 → NetSuite Sync Queue).`
          : '\n\n(App-side only — no NetSuite work order attached.)';
      if (!window.confirm(`✕ CLOSE work order ${wo.displayId || wo.id}?\n\n${wo.recipe || 'no recipe'} · ${wo.totalParts || 0} pcs · ${wo.customer || wo.clientName || ''}\n\nIt leaves every queue (the record is kept for history). This does not undo picking/staging already done.${nsNote}`)) return;
      try {
          // Clearing the PICK fields is part of closing — a job that only had its phase stamped
          // stayed in the WMS pick queue afterwards (Sandra 2026-08-17). Same shape as RTG's close.
          await updateDoc(doc(db, "fin_workorders", wo.id), { currentPhase: 'Closed', stepStatus: 'Closed', status: 'Closed', sentToPickPack: false, pickStatus: 'Closed', closedAt: Date.now(), closedBy: 'Setup Queue' });
          if (wo.nsWoId && !wo.nsWoClosed && !wo.nsCompletionQueued) {
              try {
                  await enqueueNsWrite({
                      kind: 'workorderclose',
                      label: `Close NS WO ${wo.nsWoTran || wo.nsWoId} — ${wo.stockErpId || wo.displayId || wo.id}`,
                      sourceApp: 'FINISHING', createdBy: 'Setup Queue',
                      targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/workorder/${wo.nsWoId}/!transform/workorderclose`,
                      method: 'POST',
                      payload: { memo: `Closed from Setup Queue (app WO ${wo.id})` },
                      writeBack: { collection: 'fin_workorders', docId: wo.id, patch: { nsWoClosed: true } }
                  });
              } catch (e) { alert('App WO closed, but queueing the NetSuite close failed: ' + (e.message || e)); }
          }
          if (writeLog) writeLog(`Closed WO ${wo.displayId || wo.id} from the Setup Queue`, 'setup');
      } catch (err) { alert(`Close failed: ${err.message}`); }
  };

  // ===== ⇄ CONVERT FINISHED → RAW (Stuart 2026-07-20) =====
  // Out of raw base cores for a stock build? Strip a finished color back to raw instead of
  // waiting on backorder. Works like the WMS phosphate convert but in reverse — a 2-line
  // NetSuite inventory adjustment (acct 254, same shape as rod cuts): −finished(bin) +raw(bin).
  const [convOpen, setConvOpen] = useState(false);
  const [convBrand, setConvBrand] = useState('ce');
  const [convCode, setConvCode] = useState('');
  const [convBusy, setConvBusy] = useState(false);
  const [convRows, setConvRows] = useState(null);
  const [convSel, setConvSel] = useState(null);
  const [convQty, setConvQty] = useState('');
  const [convSrcBin, setConvSrcBin] = useState('');
  const [convDstBin, setConvDstBin] = useState('');
  const [convPosting, setConvPosting] = useState(false);
  const convBase = (() => { const s = String(convCode || '').trim().toUpperCase(); const i = s.indexOf('/'); return i > 0 ? s.slice(0, i) : s; })();
  const convRaw = (convRows || []).find(r => r.isRaw) || null;

  const convSuiteql = async (q) => {
      const r = await nsProxyFetch({ targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql', method: 'POST', payload: { q } });
      const j = await r.json();
      if (!r.ok) throw new Error(JSON.stringify(j).slice(0, 300));
      return j.items || [];
  };
  const convSearch = async () => {
      if (!convBase) return alert('Enter the raw item # you need (e.g. HCUMLB415).');
      setConvBusy(true); setConvRows(null); setConvSel(null);
      try {
          const loc = BRAND_NETSUITE_MAP[convBrand].location;
          const items = await convSuiteql(`SELECT id, itemid FROM item WHERE (UPPER(itemid) = '${convBase}' OR UPPER(itemid) LIKE '${convBase}/%') AND isinactive = 'F'`);
          if (!items.length) { alert(`No NetSuite items found for ${convBase}.`); return; }
          const idList = items.map(x => `'${String(x.itemid).replace(/'/g, "''")}'`).join(',');
          let binRows = [];
          try {
              binRows = await convSuiteql(`SELECT Item.itemid AS legacy_id, Bin.binnumber AS bin_number, SUM(InventoryBalance.quantityonhand) AS onhand FROM Item LEFT JOIN InventoryBalance ON InventoryBalance.item = Item.id LEFT JOIN Bin ON InventoryBalance.binnumber = Bin.id WHERE Item.itemid IN (${idList}) AND InventoryBalance.location = ${loc} GROUP BY Item.itemid, Bin.binnumber`);
          } catch (binErr) { /* bins optional — totals still shown as 0 and NetSuite validates on post */ }
          const rows = items.map(it => {
              const code = String(it.itemid).toUpperCase();
              const mine = binRows.filter(b => String(b.legacy_id || '').toUpperCase() === code);
              const bins = mine.filter(b => (b.bin_number || '').trim()).map(b => ({ bin: String(b.bin_number).trim().toUpperCase(), qty: parseInt(b.onhand) || 0 })).filter(b => b.qty > 0).sort((a, b) => b.qty - a.qty);
              const total = mine.reduce((s, b) => s + (parseInt(b.onhand) || 0), 0);
              return { itemid: code, internalId: String(it.id), total, bins, isRaw: code === convBase, isPack: /-\d+$/.test(code) };
          }).sort((a, b) => (b.isRaw ? 1 : 0) - (a.isRaw ? 1 : 0) || b.total - a.total);
          setConvRows(rows);
      } catch (e) { alert('Stock lookup failed: ' + (e.message || e)); }
      finally { setConvBusy(false); }
  };
  const convPick = (row) => {
      setConvSel(row); setConvQty('');
      setConvSrcBin(row.bins[0]?.bin || '');
      setConvDstBin((convRaw && convRaw.bins[0]?.bin) || '');
  };
  const convPost = async () => {
      const src = convSel, raw = convRaw;
      const qty = parseInt(convQty) || 0;
      if (!src || !raw) return;
      if (qty <= 0) return alert('Enter how many pieces to convert.');
      if (qty > src.total) return alert(`Only ${src.total} on hand of ${src.itemid} at this location.`);
      const srcBin = (convSrcBin || '').trim().toUpperCase();
      const dstBin = (convDstBin || '').trim().toUpperCase();
      if (src.bins.length > 0 && !srcBin) return alert('Pick the bin the finished parts come out of.');
      const binQty = (src.bins.find(b => b.bin === srcBin) || {}).qty || 0;
      if (srcBin && binQty < qty) return alert(`Bin ${srcBin} holds only ${binQty} of ${src.itemid} — pick a different bin or lower the qty.`);
      if (!window.confirm(`⇄ CONVERT ${qty} × ${src.itemid} → ${raw.itemid}?\n\nOut of: ${srcBin || 'no bin'}\nInto: ${dstBin || 'no bin'}\n\nPosts the 2-line NetSuite inventory adjustment now.`)) return;
      setConvPosting(true);
      try {
          const cfg = BRAND_NETSUITE_MAP[convBrand];
          const r = await nsProxyFetch({
              targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/inventoryadjustment',
              method: 'POST',
              payload: {
                  account: { id: "254" }, subsidiary: { id: cfg.subsidiary },
                  memo: `Convert ${qty} ${src.itemid} → ${raw.itemid} for finishing (Setup Queue)`,
                  inventory: { items: [
                      { item: { id: src.internalId }, location: { id: cfg.location }, adjustQtyBy: -qty, ...(srcBin ? { inventoryDetail: { quantity: -qty, inventoryAssignment: { items: [{ binNumber: { refName: srcBin }, quantity: -qty }] } } } : {}) },
                      { item: { id: raw.internalId }, location: { id: cfg.location }, adjustQtyBy: qty, ...(dstBin ? { inventoryDetail: { quantity: qty, inventoryAssignment: { items: [{ binNumber: { refName: dstBin }, quantity: qty }] } } } : {}) }
                  ] }
              }
          });
          if (!r.ok) {
              const btxt = await r.text().catch(() => '');
              const det = (btxt.match(/"detail"\s*:\s*"((?:[^"\\]|\\.)*)"/) || [])[1];
              throw new Error(det || btxt.slice(0, 250) || `HTTP ${r.status}`);
          }
          if (writeLog) writeLog(`⇄ Converted ${qty} × ${src.itemid} → ${raw.itemid} (${srcBin || 'no bin'} → ${dstBin || 'no bin'})`, 'inventory');
          alert(`✅ Converted ${qty} × ${src.itemid} → ${raw.itemid}.\n\nNetSuite adjusted — pull the parts and prep them for finishing.`);
          setConvSel(null); setConvQty('');
          convSearch();
      } catch (e) { alert('Convert failed: ' + (e.message || e)); }
      finally { setConvPosting(false); }
  };

  // ⟲ SCRAP RE-MAKE (Stuart 2026-07-20): when final QC reports scrap, the manager re-orders the
  // scrapped pieces RIGHT HERE — creates the same RTG-parked stock WO the snapshot generates
  // (control gate kept; Route A NetSuite WO fires at release), flagged remake:true and logged
  // so scrap → re-order stays accountable and watchable.
  const [rmOpen, setRmOpen] = useState(false);
  const [rmCode, setRmCode] = useState('');
  const [rmQty, setRmQty] = useState('');
  const [rmNote, setRmNote] = useState('Scrap replacement');
  const [rmBusy, setRmBusy] = useState(false);
  const createRemake = async () => {
      const code = rmCode.trim().toUpperCase();
      const qty = parseInt(rmQty) || 0;
      if (!code) return alert('Enter the finished item # (e.g. HCUMLB410/SG).');
      if (qty <= 0) return alert('Enter how many pieces to re-make.');
      setRmBusy(true);
      try {
          const snap = await getDocs(query(collection(db, 'Approved_Designs'), where('legacyErpId', '==', code)));
          const part = snap.docs.map(d => ({ id: d.id, ...d.data() }))[0] || null;
          if (!part) { alert(`"${code}" is not in the Master Library — check the item #.`); setRmBusy(false); return; }
          const specs = part.manufacturingSpecs || {};
          const cut = code.lastIndexOf('/');
          const recipe = cut > 0 ? code.slice(cut + 1).split('-')[0] : 'PENDING-RECIPE';
          const isPole = String(specs.productType || '').toUpperCase().includes('POLE');
          const size = String(specs.paintSize || '').toUpperCase() || null;
          const woId = `WO-STK-${part.netSuiteInternalId || 'RM'}-${Date.now()}`;
          const reqDate = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
          const paintSizes = (!isPole && ['S', 'M', 'L'].includes(size)) ? { S: 0, M: 0, L: 0, [size]: qty } : null;
          const finPayload = {
              id: woId, orderKey: woId, quoteId: null, salesOrderId: null, estimateId: null,
              orderType: 'stock', soId: null, soNum: null,
              customerId: null, customerName: 'Internal Stock', customer: 'Internal Stock', clientName: 'Internal Stock',
              recipe, reqDate, type: code, totalParts: qty,
              stockErpId: code, stockInternalId: part.netSuiteInternalId ? String(part.netSuiteInternalId) : null,
              paintSize: isPole ? null : size, productType: String(specs.productType || '').toUpperCase() || null, paintSizes,
              ...(isPole ? { poles: { qty, type: String(specs.productType || 'POLE').toUpperCase() }, totalPoles: qty } : {}),
              ...(specs.finishStream ? { finishStream: String(specs.finishStream).toUpperCase() } : {}),
              note: `⟲ SCRAP RE-MAKE · ${rmNote || ''}`.trim(),
              remake: true,
              cpqSpecs: {}, imageUrl: part.finalImageUrl || null,
              dimensions: { length: 0, width: 0, height: 0 }, partsList: [],
              currentPhase: 'Setup', stepStatus: 'Pending', currentStepIndex: 0,
              tasks: makeFullTasks(),
              machineAssigned: null, redlineAlert: false,
              sentToPickPack: false, pickStatus: 'Pending',
              shopSiblingId: null, hasCustomSibling: false, customFabStatus: 'Pending',
              brand: String(part.brandId || 'ce'), createdAt: Date.now(), updatedAt: Date.now(), createdBy: 'Setup Queue'
          };
          await setDoc(doc(db, 'hq_work_orders', woId), {
              id: woId, woId, brand: String(part.brandId || 'ce'), type: 'Stock', status: 'Approved',
              source: 'SETUP_QUEUE_REMAKE', routeTo: 'FINISHING', finPayload, remake: true, remakeReason: rmNote || '',
              erpId: code, recipe, qty, totalParts: qty, reqDate,
              paintSize: size, customer: 'Internal Stock',
              createdAt: Date.now(), createdBy: 'Setup Queue'
          }, { merge: true });
          if (writeLog) writeLog(`⟲ Scrap re-make WO created: ${qty} × ${code} (${recipe}) — parked in RTG Dispatch`, 'setup');
          alert(`⟲ Re-make order created: ${qty} × ${code} (${recipe}).\n\nPARKED in RTG Dispatch (same control gate as snapshot builds) — Push to Finishing there releases it back to this queue and queues the real NetSuite work order.`);
          setRmCode(''); setRmQty(''); setRmNote('Scrap replacement');
      } catch (e) { alert('Re-make failed: ' + (e.message || e)); }
      finally { setRmBusy(false); }
  };

  return (
    <div style={{ padding: '30px', fontFamily: 'var(--sans)' }}>

      <div style={{ background: 'var(--paper-2)', padding: '24px', border: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', borderRadius: '2px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)' }}>Work Order Queue</h2>
            <span title="Pieces currently on the Active Floor (informational — no staging cap)" style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', padding: '6px 10px', border: '1px solid var(--line)', borderRadius: '2px', color: 'var(--ink-soft)', background: '#fff' }}>
                Active Floor: {activeFloorLoad} pcs
            </span>
        </div>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', padding: '6px 10px', border: '1px solid var(--line)', borderRadius: '2px', background: '#fff' }}>
            {finishGroups.length} finish batch{finishGroups.length === 1 ? '' : 'es'} · {pendingOrders.length} order{pendingOrders.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* ⚡ PINNED — urgent and not yet acknowledged. These are ALSO still in their finish batch
          below; this strip is the "did anyone see it" gate, not a second copy of the work. */}
      {urgentPinned.length > 0 && (
        <div style={{ background: '#fdf3f3', border: '2px solid #d9534f', borderRadius: '2px', padding: '16px 20px', marginBottom: '24px' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.12em', color: '#d9534f', fontWeight: 700, marginBottom: '12px' }}>
            ⚡ Urgent — {urgentPinned.length} order{urgentPinned.length === 1 ? '' : 's'} needing acknowledgement
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '14px' }}>
            {urgentPinned.map(wo => {
              const need = wo.needBy || wo.reqDate || '';
              const late = need && new Date(need) < new Date(new Date().toDateString());
              return (
                <div key={wo.id} style={{ background: '#fff', border: '1px solid #e2b8b8', borderLeft: '4px solid #d9534f', padding: '14px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: '1.05rem', color: 'var(--ink)', fontWeight: 500 }}>WO: {wo.nsWoTran || wo.woNum || wo.displayId || wo.id}</strong>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', padding: '3px 8px', border: '1px solid var(--line)', background: 'var(--paper)', color: 'var(--ink)' }}>{wo.recipe || wo.color || '—'}</span>
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: late ? '#d9534f' : 'var(--ink)', marginTop: '8px', fontWeight: late ? 700 : 500 }}>
                    NEED BY {need || 'ASAP'}{late ? ' · PAST DUE' : ''}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '4px' }}>
                    {(wo.type || wo.stockErpId || wo.itemName || '—')} · {wo.totalParts || wo.qty || 0} pcs · {wo.customer || wo.clientName || 'Internal Stock'}
                  </div>
                  <button onClick={() => ackUrgent(wo)} style={{ ...btnStyle, width: '100%', marginTop: '12px', background: '#d9534f', color: '#fff', border: 'none' }}>
                    ✓ Acknowledge — drop into the {wo.recipe || wo.color || 'finish'} batch
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Orders this floor does NOT finish — shown so they don't just vanish from the queue. */}
      {outsourcedOrders.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid var(--brass)', borderRadius: '2px', padding: '16px 24px', marginBottom: '24px' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--brass)', marginBottom: '10px' }}>
            ⚗ Outsourced finish · {outsourcedOrders.length} order{outsourcedOrders.length === 1 ? '' : 's'} routed to WMS pick &amp; the plater — not this floor
          </div>
          {outsourcedOrders.map(w => {
            const r = finishRouteOf(w);
            return (
              <div key={w.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', borderTop: '1px solid var(--line)', padding: '7px 0', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink)' }}>
                <span>{w.displayId || w.id}{w.customer || w.clientName ? ` · ${w.customer || w.clientName}` : ''}</span>
                <span style={{ color: 'var(--ink-soft)' }}>
                  {r.codes.join(', ')} (by {r.via}) · {w.totalParts || 0} pcs · {w.sentToPickPack ? `pick: ${w.pickStatus || 'Pending'}` : 'not yet released to pick'}
                </span>
              </div>
            );
          })}
          <div style={{ fontFamily: 'var(--sans)', fontSize: '0.82rem', color: 'var(--ink-soft)', marginTop: '10px', fontStyle: 'italic' }}>
            These are plated by an outside vendor — nothing to set up or spray here. WMS picks them and stages them in OB PLATING for the weekly plater PO.
          </div>
        </div>
      )}

      {/* ⇄ CONVERT FINISHED → RAW — for stock builds short on raw base cores */}
      <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', marginBottom: '24px' }}>
        <div onClick={() => setConvOpen(!convOpen)} style={{ padding: '14px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', background: 'var(--paper-2)', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)' }}>⇄ Convert Finished → Raw</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', letterSpacing: '.05em' }}>short on raw cores? strip a finished color back to raw — posts the NetSuite adjustment {convOpen ? '▾' : '▸'}</span>
        </div>
        {convOpen && (
          <div style={{ padding: '20px 24px' }}>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              {Object.keys(BRAND_NETSUITE_MAP).map(b => (
                <button key={b} onClick={() => { setConvBrand(b); setConvRows(null); setConvSel(null); }} style={{ padding: '9px 14px', background: convBrand === b ? 'var(--ink)' : '#fff', color: convBrand === b ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>{b}</button>
              ))}
              <input type="text" placeholder="Raw item # you need (e.g. HCUMLB415)" value={convCode} onChange={e => setConvCode(e.target.value)} onKeyDown={e => e.key === 'Enter' && convSearch()} style={{ flex: 1, minWidth: '220px', padding: '10px 12px', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '0.9rem', outline: 'none' }} />
              <button onClick={convSearch} disabled={convBusy} style={{ ...btnStyle, background: 'var(--ink)', color: '#fff', opacity: convBusy ? 0.6 : 1 }}>{convBusy ? '⏳ Checking…' : '🔍 Find Stock'}</button>
            </div>
            {convRows && (
              <div style={{ marginTop: '16px' }}>
                {convRows.map(r => (
                  <div key={r.itemid} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '9px 12px', borderTop: '1px solid var(--paper-2)', background: r.isRaw ? '#f6fbf7' : (convSel && convSel.itemid === r.itemid ? 'var(--paper-2)' : '#fff'), flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '0.9rem', fontWeight: r.isRaw ? 700 : 400, color: 'var(--ink)', minWidth: '160px' }}>{r.itemid}{r.isRaw ? ' — RAW' : ''}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '0.95rem', fontWeight: 600, color: r.total > 0 ? 'var(--ink)' : '#d9534f' }}>{r.total} on hand</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', flex: 1 }}>{r.bins.map(b => `${b.bin}: ${b.qty}`).join(' · ') || (r.total > 0 ? 'no bin' : '')}</span>
                    {!r.isRaw && (
                      r.isPack
                        ? <span title="Pack assembly — unbuild packs in WMS first, then convert the singles" style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)' }}>PACK — skip</span>
                        : <button onClick={() => convPick(r)} disabled={r.total <= 0} style={{ padding: '8px 14px', background: convSel && convSel.itemid === r.itemid ? 'var(--brass)' : '#fff', color: convSel && convSel.itemid === r.itemid ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', cursor: r.total > 0 ? 'pointer' : 'default', opacity: r.total > 0 ? 1 : 0.4, fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' }}>Select</button>
                    )}
                  </div>
                ))}
                {convSel && (
                  <div style={{ marginTop: '14px', padding: '14px 16px', background: 'var(--paper-2)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '0.9rem', color: 'var(--ink)', fontWeight: 600 }}>{convSel.itemid} → {convBase}</span>
                    <input type="number" min="1" placeholder="Qty" value={convQty} onChange={e => setConvQty(e.target.value)} style={{ width: '90px', padding: '10px', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '1rem', outline: 'none' }} />
                    {convSel.bins.length > 0 ? (
                      <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', display: 'flex', alignItems: 'center', gap: '6px' }}>OUT OF
                        <select value={convSrcBin} onChange={e => setConvSrcBin(e.target.value)} style={{ padding: '9px', border: '1px solid var(--line)', fontFamily: 'var(--mono)', background: '#fff' }}>
                          {convSel.bins.map(b => <option key={b.bin} value={b.bin}>{b.bin} ({b.qty})</option>)}
                        </select>
                      </label>
                    ) : <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>no source bin</span>}
                    <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', display: 'flex', alignItems: 'center', gap: '6px' }}>INTO
                      {convRaw && convRaw.bins.length > 0 ? (
                        <select value={convDstBin} onChange={e => setConvDstBin(e.target.value)} style={{ padding: '9px', border: '1px solid var(--line)', fontFamily: 'var(--mono)', background: '#fff' }}>
                          {convRaw.bins.map(b => <option key={b.bin} value={b.bin}>{b.bin} ({b.qty})</option>)}
                          <option value="">no bin</option>
                        </select>
                      ) : (
                        <input type="text" placeholder="raw bin (blank = none)" value={convDstBin} onChange={e => setConvDstBin(e.target.value)} style={{ width: '150px', padding: '9px', border: '1px solid var(--line)', fontFamily: 'var(--mono)', outline: 'none' }} />
                      )}
                    </label>
                    <button onClick={convPost} disabled={convPosting} style={{ ...btnStyle, background: '#3a7d44', color: '#fff', marginLeft: 'auto', opacity: convPosting ? 0.6 : 1 }}>{convPosting ? '⏳ Posting…' : '⚡ Convert Now'}</button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ⟲ SCRAP RE-MAKE — manager's quick stock re-order for scrapped pieces */}
      <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', marginBottom: '24px' }}>
        <div onClick={() => setRmOpen(!rmOpen)} style={{ padding: '14px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', background: 'var(--paper-2)', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)' }}>⟲ Scrap Re-make / New Stock Order</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', letterSpacing: '.05em' }}>QC reported scrap? re-order the pieces here — parks in RTG like a snapshot build {rmOpen ? '▾' : '▸'}</span>
        </div>
        {rmOpen && (
          <div style={{ padding: '20px 24px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="text" placeholder="Finished item # (e.g. HCUMLB410/SG)" value={rmCode} onChange={e => setRmCode(e.target.value)} style={{ flex: 2, minWidth: '220px', padding: '10px 12px', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '0.9rem', outline: 'none' }} />
            <input type="number" min="1" placeholder="Qty" value={rmQty} onChange={e => setRmQty(e.target.value)} style={{ width: '90px', padding: '10px', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '1rem', outline: 'none' }} />
            <input type="text" placeholder="Reason" value={rmNote} onChange={e => setRmNote(e.target.value)} style={{ flex: 1, minWidth: '160px', padding: '10px 12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.9rem', outline: 'none' }} />
            <button onClick={createRemake} disabled={rmBusy} style={{ ...btnStyle, background: '#3a7d44', color: '#fff', opacity: rmBusy ? 0.6 : 1 }}>{rmBusy ? '⏳ Creating…' : '⟲ Create Re-make WO'}</button>
          </div>
        )}
      </div>

      {pendingOrders.length === 0 && (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)', fontSize: '1.2rem', background: '#fff', border: '1px dashed var(--line)' }}>Queue is empty.</div>
      )}
      {finishGroups.map(g => (
        <div key={g.recipe} style={{ marginBottom: '28px' }}>
          {/* One section per FINISH — run it as a batch, then move to the next finish. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '10px 16px', background: 'var(--ink)', color: '#fff', borderRadius: '2px', marginBottom: '14px', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.12em', fontWeight: 600 }}>{g.recipe}</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', opacity: 0.85 }}>{g.orders.length} order{g.orders.length === 1 ? '' : 's'} · {g.pieces} pcs — batch this finish together</span>
            {g.orders.some(w => w.urgent) && <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', letterSpacing: '.08em', background: '#d9534f', color: '#fff', padding: '3px 8px' }}>⚡ {g.orders.filter(w => w.urgent).length} URGENT</span>}
            {/* 📅 Planned run day — tap a day to tell the rest of the team when this colour runs, so
                parts for it get ordered in time. Shared doc: everyone sees the same plan. */}
            <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', letterSpacing: '.1em', opacity: 0.6, textTransform: 'uppercase' }}>Run day</span>
              {DAYS.map(d => {
                const on = ((runDays[g.recipe] && runDays[g.recipe].days) || []).includes(d);
                return (
                  <button key={d} onClick={() => toggleRunDay(g.recipe, d)}
                    title={on ? `${g.recipe} is planned for ${d} — tap to clear` : `Plan the ${g.recipe} run for ${d}`}
                    style={{ padding: '4px 10px', borderRadius: '999px', border: `1px solid ${on ? 'var(--brass)' : 'rgba(255,255,255,0.28)'}`, background: on ? 'var(--brass)' : 'transparent', color: '#fff', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', letterSpacing: '.08em', fontWeight: on ? 700 : 400 }}>
                    {d}
                  </button>
                );
              })}
              {runDays[g.recipe] && runDays[g.recipe].by && ((runDays[g.recipe].days || []).length > 0) && (
                <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', opacity: 0.55 }}>set by {runDays[g.recipe].by}</span>
              )}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '24px' }}>
            {g.orders.map(wo => {
              const isMatched = wo.stagingStatus === 'MATCHED';
              return (
            <div key={wo.id} style={{...cardStyle, background: isMatched ? '#f6fbf7' : (cardStyle.background || '#fff'), borderLeft: isMatched ? '4px solid #3a7d44' : '4px solid var(--ink)'}}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: '12px', marginBottom: '16px' }}>
                    <strong style={{ fontSize: '1.1rem', color: 'var(--ink)', fontWeight: 500 }}>
                        WO: {wo.nsWoTran || wo.woNum || wo.displayId || wo.id}
                        {(wo.type === 'sales' || wo.soNum) && <span style={{color:'var(--ink-soft)', fontSize:'0.85rem'}}> (SO: {wo.soId || wo.soNum})</span>}
                    </strong>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {wo.urgent && <span title={`Urgent · need by ${wo.needBy || wo.reqDate || 'ASAP'}${wo.urgentAck ? ` · acknowledged by ${wo.urgentAckBy || 'floor'}` : ''}`} style={{ background: '#d9534f', color: '#fff', padding: '4px 8px', fontSize: '0.75rem', fontFamily: 'var(--mono)', letterSpacing: '.06em' }}>⚡ {wo.needBy || wo.reqDate || 'URGENT'}</span>}
                        <span style={{ background: 'var(--paper)', padding: '4px 8px', fontSize: '0.85rem', fontFamily: 'var(--mono)', textTransform: 'uppercase', border: '1px solid var(--line)', color: 'var(--ink)' }}>{wo.recipe || wo.color}</span>
                        <button onClick={() => closeOrder(wo)} title="Close this work order — removes it from production (record kept; an attached NetSuite WO is closed too)" style={{ background: 'none', border: '1px solid var(--line)', color: '#d9534f', fontSize: '0.9rem', cursor: 'pointer', padding: '2px 8px', lineHeight: 1.4 }}>✕</button>
                    </div>
                </div>
                <div style={{ fontSize: '0.9rem', color: 'var(--ink)', marginBottom: '12px' }}><span style={{color:'var(--ink-soft)'}}>Customer:</span> {wo.customer || wo.clientName || 'N/A'}</div>
                {/* The same status every other screen shows — so "where is it" reads identically here. */}
                <OrderStatusChips wo={wo} recipeLen={((recipes[wo.recipe] || recipes[(wo.recipe || '').toUpperCase()] || {}).steps || []).length} style={{ marginBottom: '12px' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: '0.9rem', color: 'var(--ink)' }}><span style={{color:'var(--ink-soft)'}}>Req Date:</span> <span style={{ fontWeight: 500 }}>{wo.reqDate || 'ASAP'}</span></div>
                    {(() => {
                        const n = notesOf(wo);
                        const has = n.length > 0;
                        const last = has ? n[n.length - 1] : null;
                        return (
                            <button onClick={() => openNotes(wo)}
                                title={has ? `${n.length} note${n.length === 1 ? '' : 's'} · latest by ${last.by || 'unknown'} ${stamp(last.at)} — ${String(last.text || '').slice(0, 120)}` : 'No notes on this order yet — add one'}
                                style={{ padding: '4px 12px', borderRadius: '999px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', whiteSpace: 'nowrap',
                                    background: has ? 'var(--brass)' : 'transparent', color: has ? '#fff' : 'var(--ink-soft)', border: `1px solid ${has ? 'var(--brass)' : 'var(--line)'}` }}>
                                📝 Notes{has ? ` · ${n.length}` : ''}
                            </button>
                        );
                    })()}
                </div>
                
                <div style={{ fontSize: '0.85rem', lineHeight: '1.6', color: 'var(--ink)' }}>
                    {/* THE ITEM, NOT THE WORD "STOCK BUILD" (Stuart 2026-08-17: "there is no pattern#
                        nothing, they are all blank"). The code was always on the order — in
                        stockErpId / partErpId — but this line read `type`, which only the Sales
                        Snapshot fills with a real code. Everything else writes a category label. */}
                    {(() => {
                        const code = woItemCodeOf(wo);
                        const name = woItemNameOf(wo);
                        return code
                            ? <div style={{ marginBottom: '4px' }}>
                                <span style={{ color: 'var(--ink-soft)' }}>Item:</span>{' '}
                                <span style={{ fontFamily: 'var(--mono)', fontSize: '0.95rem', fontWeight: 600, color: 'var(--ink)' }}>{code}</span>
                                {name && <span style={{ color: 'var(--ink-soft)' }}> · {name}</span>}
                              </div>
                            : <div style={{ marginBottom: '4px', color: '#d9534f', fontFamily: 'var(--mono)', fontSize: '11px' }}>⚠ No item # on this order — it cannot be identified on the floor.</div>;
                    })()}
                    <span style={{color:'var(--ink-soft)'}}>Type:</span> {(wo.type || wo.itemName || 'Custom').toUpperCase()} | <span style={{color:'var(--ink-soft)'}}>Total Parts:</span> {wo.totalParts || wo.qty || 1} <br/>
                    {wo.type === 'sales' && (
                        <span style={{color: 'var(--ink-soft)'}}>
                            (Poles: {wo.poles?.qty || 0}, Fin: {wo.smallParts?.fin || 0}, Rng: {wo.smallParts?.rng || 0}, Brk: {wo.smallParts?.brk || 0})
                        </span>
                    )}
                    {/* Only REAL dimensions. 10L × 5W × 2H is the fallback every stock build gets
                        when nothing measured it — printing it as fact told the floor a size that
                        was never established. */}
                    {wo.dimensions && !isPlaceholderDims(wo.dimensions) && (
                        <div style={{ fontWeight: 500, marginTop: '8px', fontSize: '0.85rem', color: 'var(--ink)' }}>
                            Item Dimensions: {wo.dimensions.length}L x {wo.dimensions.width}W x {wo.dimensions.height}H
                        </div>
                    )}
                </div>

                {wo.hasCustomSibling && (() => {
                    const cf = wo.customFabStatus || 'Pending';
                    const cfColor = cf === 'Complete' ? 'var(--ink)' : (cf === 'In Process' ? 'var(--brass)' : 'var(--ink-soft)');
                    return (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '14px', padding: '10px 12px', background: 'var(--paper-2)', border: '1px solid var(--line)', borderRadius: '2px' }}>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Custom Parts (Shop)</span>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600, color: cfColor }}>● {cf}</span>
                        </div>
                    );
                })()}

                {/* Small-parts PICK status (2026-07-17): picking runs IN PARALLEL with shop fab —
                    an order sitting here while it's also in the WMS pick queue is the designed
                    pipeline, so show that progress instead of looking contradictory. */}
                {((wo.partsList || []).length > 0 || wo.sentToPickPack) && (() => {
                    const ps = wo.pickStatus || 'Pending';
                    const picked = ps === 'Picked_Awaiting_Staging';
                    const label = !wo.sentToPickPack ? 'Awaiting release (▶ Start Setup sends the pick)'
                        : picked ? (wo.pickHadSkips ? `Picked ⚠ ${(wo.pickSkips || []).length} skip(s)` : 'Picked — at staging')
                        : 'In pick queue (WMS)';
                    const color = picked ? (wo.pickHadSkips ? '#d9534f' : 'var(--ink)') : (wo.sentToPickPack ? 'var(--brass)' : 'var(--ink-soft)');
                    return (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: wo.hasCustomSibling ? '8px' : '14px', padding: '10px 12px', background: 'var(--paper-2)', border: '1px solid var(--line)', borderRadius: '2px' }}>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Small Parts (Pick)</span>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600, color }}>● {label}</span>
                        </div>
                    );
                })()}

                {wo.convertSuggestion && (
                    <div title="Attached by the planner on the Sales Snapshot — run it with the ⇄ Convert Finished → Raw tool at the top of this screen" style={{ marginTop: '8px', padding: '10px 12px', background: '#fdf8ef', border: '1px solid var(--brass)', borderRadius: '2px', fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink)', lineHeight: 1.5 }}>
                        ⇄ <b>PLANNER SUGGESTS:</b> convert {wo.convertSuggestion.qty} × {wo.convertSuggestion.from} → {wo.convertSuggestion.to} (raw short — use the converter above)
                    </div>
                )}
                
                {isMatched && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '14px', padding: '10px 12px', background: '#eaf5ec', border: '1px solid #3a7d44', borderRadius: '2px' }}>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 600, color: '#3a7d44' }}>✓ Staged & Matched — ready for the floor</span>
                    </div>
                )}

                <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
                    <button onClick={() => setActiveSpecs(wo)} style={{ ...btnStyle, flex: 1, background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)' }}>Specs</button>
                    {wo.quoteId && <button onClick={() => setCfgQuote(wo.quoteId)} style={{ ...btnStyle, flex: 1, background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)' }}>🔍 View Item</button>}
                    {isMatched ? (
                        <button onClick={() => stageToFloor(wo)} style={{ ...btnStyle, flex: 2, background: '#3a7d44', color: '#fff', border: 'none' }}>✓ Push to Active Floor</button>
                    ) : wo.stepStatus === "Pending" ? (
                        <button onClick={() => startSetup(wo)} style={{ ...btnStyle, flex: 2, background: 'transparent', border: '1px solid var(--ink)', color: 'var(--ink)' }}>Start Setup</button>
                    ) : (
                        <button onClick={() => stageToFloor(wo)} style={{ ...btnStyle, flex: 2, background: 'var(--ink)', color: '#fff' }}>Stage to Floor</button>
                    )}
                </div>
            </div>
            );})}
          </div>
        </div>
      ))}

      {cfgQuote && <ConfiguredItemViewer quoteId={cfgQuote} onClose={() => setCfgQuote(null)} />}

      {activeSpecs && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ background: '#fff', padding: '40px', borderRadius: '2px', width: '800px', maxHeight: '90vh', overflowY: 'auto', border: '1px solid var(--line)', boxShadow: '0 12px 48px rgba(0,0,0,0.1)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--line)', paddingBottom: '20px', marginBottom: '30px' }}>
                      <h2 style={{ color: 'var(--ink)', margin: 0, fontFamily: 'var(--serif)', fontSize: '2rem', fontWeight: 500 }}>Job Specs: {activeSpecs.nsWoTran || activeSpecs.woNum || activeSpecs.displayId || activeSpecs.id}</h2>
                      <button onClick={() => setActiveSpecs(null)} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', fontSize: '2rem', cursor: 'pointer' }}>×</button>
                  </div>
                  
                  <div style={{ display: 'flex', gap: '30px' }}>
                      {activeSpecs.imageUrl && (
                          <div style={{ flex: 1, background: 'var(--paper)', border: '1px solid var(--line)', padding: '20px' }}>
                              <img src={activeSpecs.imageUrl} alt="Part" style={{ width: '100%', objectFit: 'contain' }}/>
                          </div>
                      )}
                      
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px' }}>
                          <div style={{ background: 'var(--paper-2)', padding: '24px', border: '1px solid var(--line)' }}>
                              <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '8px' }}>Client</div>
                              <div style={{ fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)', fontFamily: 'var(--sans)' }}>{activeSpecs.clientName || activeSpecs.customer || 'N/A'}</div>
                          </div>
                          
                          {activeSpecs.note && (
                              <div style={{ background: '#fff', padding: '24px', border: '1px solid var(--line)', borderLeft: '4px solid var(--brass)' }}>
                                  <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--brass)', marginBottom: '8px' }}>Client / RFI Notes</div>
                                  <div style={{ fontSize: '0.95rem', whiteSpace: 'pre-wrap', color: 'var(--ink)', lineHeight: '1.5' }}>{activeSpecs.note}</div>
                              </div>
                          )}
                          
                          {/* THE BUILD FACTS. A stock build has no CPQ configuration, so this modal
                              used to open on "no extended specifications" and tell the floor nothing
                              — not even WHAT to make (Stuart 2026-08-17). These facts are always on
                              the order; they were simply never rendered. */}
                          {(() => {
                              const code = woItemCodeOf(activeSpecs);
                              const name = woItemNameOf(activeSpecs);
                              const rows = [
                                  ['Item #', code],
                                  ['Description', name],
                                  ['Finish / recipe', activeSpecs.recipe || activeSpecs.color || ''],
                                  ['Quantity', activeSpecs.totalParts || activeSpecs.qty || ''],
                                  ['NetSuite WO', activeSpecs.nsWoTran || activeSpecs.nsWoId || ''],
                                  ['Need by', activeSpecs.needBy || activeSpecs.reqDate || ''],
                                  ['Pull source', activeSpecs.jfpPullFrom || ''],
                              ].filter(([, v]) => v !== '' && v !== undefined && v !== null);
                              if (!rows.length) return null;
                              return (
                                  <div style={{ background: '#fff', padding: '24px', border: '1px solid var(--line)' }}>
                                      <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '16px', borderBottom: '1px solid var(--line)', paddingBottom: '8px' }}>Build</div>
                                      {rows.map(([k, v]) => (
                                          <div key={k} style={{ fontSize: '0.9rem', display: 'flex', justifyContent: 'space-between', gap: '16px', borderBottom: '1px solid var(--line)', padding: '8px 0' }}>
                                              <span style={{ color: 'var(--ink-soft)' }}>{k}:</span>
                                              <span style={{ fontWeight: 500, color: 'var(--ink)', fontFamily: k === 'Item #' ? 'var(--mono)' : 'var(--sans)', textAlign: 'right' }}>{String(v)}</span>
                                          </div>
                                      ))}
                                  </div>
                              );
                          })()}

                          {activeSpecs.cpqSpecs && Object.keys(activeSpecs.cpqSpecs).length > 0 && (
                              <div style={{ background: '#fff', padding: '24px', border: '1px solid var(--line)' }}>
                                  <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '16px', borderBottom: '1px solid var(--line)', paddingBottom: '8px' }}>CPQ Build Specs</div>
                                  {Object.entries(activeSpecs.cpqSpecs).map(([k, v]) => (
                                      <div key={k} style={{ fontSize: '0.9rem', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', padding: '8px 0' }}>
                                          <span style={{ color: 'var(--ink-soft)' }}>{k}:</span><span style={{ fontWeight: 500, color: 'var(--ink)' }}>{v}</span>
                                      </div>
                                  ))}
                              </div>
                          )}

                          {!activeSpecs.imageUrl && !activeSpecs.note && !woItemCodeOf(activeSpecs) && (!activeSpecs.cpqSpecs || Object.keys(activeSpecs.cpqSpecs).length === 0) && (
                              <div style={{ padding: '30px', textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic', border: '1px dashed var(--line)', fontFamily: 'var(--serif)', fontSize: '1.2rem' }}>
                                  No extended specifications or client notes attached to this Work Order.
                              </div>
                          )}
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* 📝 ORDER NOTES — the note, who left it and when, and every operator who has read it. */}
      {noteWo && (() => {
          const wo = workOrders.find(w => w.id === noteWo.id) || noteWo;
          const notes = notesOf(wo), reads = readsOf(wo);
          const newest = notes.length ? Math.max(...notes.map(n => n.at || 0)) : 0;
          return (
              <div onClick={() => setNoteWo(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,.72)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
                  <div onClick={e => e.stopPropagation()} style={{ background: '#fff', width: '620px', maxWidth: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', border: '1px solid var(--line)', boxShadow: '0 12px 48px rgba(0,0,0,.28)' }}>
                      <div style={{ padding: '18px 24px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                              <div style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', color: 'var(--ink)' }}>Order notes</div>
                              <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', marginTop: '3px', letterSpacing: '.06em' }}>
                                  {wo.nsWoTran || wo.woNum || wo.displayId || wo.id} · {wo.customer || wo.clientName || 'N/A'}
                              </div>
                          </div>
                          <button onClick={() => setNoteWo(null)} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', fontSize: '1.6rem', cursor: 'pointer', lineHeight: 1 }}>×</button>
                      </div>

                      <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
                          {notes.length === 0 && <div style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', color: 'var(--ink-soft)', padding: '8px 0 18px' }}>No notes on this order yet.</div>}
                          {notes.map((n, i) => (
                              <div key={i} style={{ border: '1px solid var(--line)', borderLeft: '3px solid var(--brass)', padding: '12px 14px', marginBottom: '10px', background: 'var(--paper)' }}>
                                  <div style={{ fontSize: '0.95rem', color: 'var(--ink)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{n.text}</div>
                                  <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', marginTop: '8px', letterSpacing: '.04em' }}>
                                      — {n.by || 'unknown'} · {stamp(n.at)}
                                  </div>
                              </div>
                          ))}

                          <div style={{ marginTop: '16px' }}>
                              <textarea value={noteDraft} onChange={e => setNoteDraft(e.target.value)} rows={3} placeholder="Add a note for this order…"
                                  style={{ width: '100%', boxSizing: 'border-box', padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', fontSize: '0.95rem', resize: 'vertical' }} />
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', gap: '10px', flexWrap: 'wrap' }}>
                                  <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', letterSpacing: '.04em' }}>Stamped with your name and the time · notes are never edited or deleted, only added</span>
                                  <button onClick={addNote} disabled={!noteDraft.trim()} style={{ padding: '10px 18px', background: noteDraft.trim() ? 'var(--ink)' : 'var(--paper-2)', color: noteDraft.trim() ? '#fff' : 'var(--ink-soft)', border: noteDraft.trim() ? 'none' : '1px solid var(--line)', cursor: noteDraft.trim() ? 'pointer' : 'not-allowed', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' }}>＋ Add note</button>
                              </div>
                          </div>

                          {/* READ LOG — who has opened this, and whether they saw the LATEST note. */}
                          <div style={{ marginTop: '22px', paddingTop: '16px', borderTop: '1px solid var(--line)' }}>
                              <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '10px' }}>Read by</div>
                              {reads.length === 0 ? (
                                  <div style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', color: 'var(--ink-soft)', fontSize: '0.9rem' }}>Nobody has opened this yet.</div>
                              ) : (
                                  [...reads].sort((a, b) => (b.at || 0) - (a.at || 0)).map((r, i) => {
                                      const current = (r.at || 0) >= newest;
                                      return (
                                          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '6px 0', borderBottom: '1px solid var(--paper-2)', fontFamily: 'var(--mono)', fontSize: '11px' }}>
                                              <span style={{ color: 'var(--ink)' }}>{r.by || 'unknown'}</span>
                                              <span style={{ color: current ? '#3a7d44' : 'var(--ink-soft)' }}>{stamp(r.at)}{current ? '' : ' · before the latest note'}</span>
                                          </div>
                                      );
                                  })
                              )}
                          </div>
                      </div>
                  </div>
              </div>
          );
      })()}
    </div>
  );
};

export default SetupQueue;