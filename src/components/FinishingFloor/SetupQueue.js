import React, { useState } from 'react';
import { db } from '../../firebase';
import { doc, updateDoc } from "firebase/firestore";
import { btnStyle, cardStyle } from './finishingStyles';
import { enqueueNsWrite } from '../Shared/nsOutbox';
import ConfiguredItemViewer from '../Shared/ConfiguredItemViewer';

const SetupQueue = ({ workOrders = [], recipes = {}, writeLog, sysConfig = {} }) => {
  // §A4: the Active Floor only ever holds about a day's work. Cap admission by piece count
  // (configurable in fin_config/settings -> activeFloorDailyCapacity); the rest stay "ready"
  // here in the queue. Current load = pieces already on the floor (currentPhase 'Painting').
  const ACTIVE_CAP = Number(sysConfig?.activeFloorDailyCapacity) || 200;
  const activeFloorLoad = workOrders
    .filter(w => w.currentPhase === 'Painting')
    .reduce((sum, w) => sum + (Number(w.totalParts) || 0), 0);
  const [activeSpecs, setActiveSpecs] = useState(null);
  const [cfgQuote, setCfgQuote] = useState(null); // "view configured item" read-only 3D modal

  // (Stuart 2026-07-17: Direct Order Intake removed — every WO now arrives through the real
  // pipelines: CPQ/RTG dispatch for sales, Sales Snapshot → RTG for stock builds.)

  const pendingOrders = workOrders.filter(w => w.currentPhase === "Setup" || w.currentPhase === "setup");
  // Follow the committed run order (scheduleSeq, set by the Schedule's "Commit" button) when present;
  // fall back to required date for anything not yet committed.
  pendingOrders.sort((a, b) => {
    const sa = a.scheduleSeq ?? Infinity, sb = b.scheduleSeq ?? Infinity;
    if (sa !== sb) return sa - sb;
    return new Date(a.reqDate) - new Date(b.reqDate);
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
      if (n === 0) return { patch: {}, note: ' — no small parts to pick (not sent to WMS)' };
      return {
          patch: { sentToPickPack: true, pickStatus: wo.pickStatus || 'Pending', sentToPickPackAt: Date.now() },
          note: ` — ${n} part line${n === 1 ? '' : 's'} released to the WMS pick queue`
      };
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
    // §A4: respect the daily Active Floor capacity (pieces). If this order would push the
    // floor over its cap, keep it ready here instead of admitting it.
    const pieces = Number(wo.totalParts) || 0;
    if (activeFloorLoad + pieces > ACTIVE_CAP) {
        return alert(`🚧 Active Floor is at capacity.\n\nOn the floor now: ${activeFloorLoad} pcs\nThis order: ${pieces} pcs\nDaily cap: ${ACTIVE_CAP} pcs\n\n"${wo.displayId || wo.id}" stays ready here until floor work clears.`);
    }
    try {
        // Safety net: an order that went Running before the Start-Setup release fix (or was
        // never released) still gets its parts pick sent to WMS at the latest possible gate.
        const { patch, note } = releasePickPatch(wo);
        await updateDoc(doc(db, "fin_workorders", wo.id), { stepStatus: "Staged", currentPhase: "Painting", currentStepIndex: 0, ...patch });
        if (writeLog) writeLog(`Staged ${wo.displayId || wo.id} to Floor (${pieces} pcs; floor now ~${activeFloorLoad + pieces}/${ACTIVE_CAP})${note}`, 'production');
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
  const closeOrder = async (wo) => {
      const nsNote = wo.nsWoId
          ? `\n\nThis WO has a NetSuite work order (${wo.nsWoTran || wo.nsWoId}) — closing here ALSO queues the NetSuite WO close (watch 11.1 → NetSuite Sync Queue).`
          : '\n\n(App-side only — no NetSuite work order attached.)';
      if (!window.confirm(`✕ CLOSE work order ${wo.displayId || wo.id}?\n\n${wo.recipe || 'no recipe'} · ${wo.totalParts || 0} pcs · ${wo.customer || wo.clientName || ''}\n\nIt leaves every queue (the record is kept for history). This does not undo picking/staging already done.${nsNote}`)) return;
      try {
          await updateDoc(doc(db, "fin_workorders", wo.id), { currentPhase: 'Closed', stepStatus: 'Closed', closedAt: Date.now(), closedBy: 'Setup Queue' });
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

  return (
    <div style={{ padding: '30px', fontFamily: 'var(--sans)' }}>

      <div style={{ background: 'var(--paper-2)', padding: '24px', border: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', borderRadius: '2px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)' }}>Work Order Queue</h2>
            {(() => {
                const over = activeFloorLoad >= ACTIVE_CAP;
                return (
                    <span title="Active Floor daily capacity (pieces). Set via fin_config/settings → activeFloorDailyCapacity." style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', padding: '6px 10px', border: '1px solid var(--line)', borderRadius: '2px', color: over ? '#d9534f' : 'var(--ink-soft)', background: over ? '#fdf2f2' : '#fff' }}>
                        Active Floor: {activeFloorLoad}/{ACTIVE_CAP} pcs{over ? ' • FULL' : ''}
                    </span>
                );
            })()}
        </div>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', padding: '6px 10px', border: '1px solid var(--line)', borderRadius: '2px', background: '#fff' }}>
            {finishGroups.length} finish batch{finishGroups.length === 1 ? '' : 'es'} · {pendingOrders.length} order{pendingOrders.length === 1 ? '' : 's'}
        </span>
      </div>
      
      {pendingOrders.length === 0 && (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)', fontSize: '1.2rem', background: '#fff', border: '1px dashed var(--line)' }}>Queue is empty.</div>
      )}
      {finishGroups.map(g => (
        <div key={g.recipe} style={{ marginBottom: '28px' }}>
          {/* One section per FINISH — run it as a batch, then move to the next finish. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '10px 16px', background: 'var(--ink)', color: '#fff', borderRadius: '2px', marginBottom: '14px' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.12em', fontWeight: 600 }}>{g.recipe}</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', opacity: 0.85 }}>{g.orders.length} order{g.orders.length === 1 ? '' : 's'} · {g.pieces} pcs — batch this finish together</span>
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
                        <span style={{ background: 'var(--paper)', padding: '4px 8px', fontSize: '0.85rem', fontFamily: 'var(--mono)', textTransform: 'uppercase', border: '1px solid var(--line)', color: 'var(--ink)' }}>{wo.recipe || wo.color}</span>
                        <button onClick={() => closeOrder(wo)} title="Close this work order — removes it from production (record kept; an attached NetSuite WO is closed too)" style={{ background: 'none', border: '1px solid var(--line)', color: '#d9534f', fontSize: '0.9rem', cursor: 'pointer', padding: '2px 8px', lineHeight: 1.4 }}>✕</button>
                    </div>
                </div>
                <div style={{ fontSize: '0.9rem', color: 'var(--ink)', marginBottom: '12px' }}><span style={{color:'var(--ink-soft)'}}>Customer:</span> {wo.customer || wo.clientName || 'N/A'}</div>
                <div style={{ fontSize: '0.9rem', color: 'var(--ink)', marginBottom: '16px' }}><span style={{color:'var(--ink-soft)'}}>Req Date:</span> <span style={{ fontWeight: 500 }}>{wo.reqDate || 'ASAP'}</span></div>
                
                <div style={{ fontSize: '0.85rem', lineHeight: '1.6', color: 'var(--ink)' }}>
                    <span style={{color:'var(--ink-soft)'}}>Type:</span> {(wo.type || wo.itemName || 'Custom').toUpperCase()} | <span style={{color:'var(--ink-soft)'}}>Total Parts:</span> {wo.totalParts || wo.qty || 1} <br/>
                    {wo.type === 'sales' && (
                        <span style={{color: 'var(--ink-soft)'}}>
                            (Poles: {wo.poles?.qty || 0}, Fin: {wo.smallParts?.fin || 0}, Rng: {wo.smallParts?.rng || 0}, Brk: {wo.smallParts?.brk || 0})
                        </span>
                    )}
                    {wo.dimensions && (
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

                          {!activeSpecs.imageUrl && !activeSpecs.note && (!activeSpecs.cpqSpecs || Object.keys(activeSpecs.cpqSpecs).length === 0) && (
                              <div style={{ padding: '30px', textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic', border: '1px dashed var(--line)', fontFamily: 'var(--serif)', fontSize: '1.2rem' }}>
                                  No extended specifications or client notes attached to this Work Order.
                              </div>
                          )}
                      </div>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default SetupQueue;