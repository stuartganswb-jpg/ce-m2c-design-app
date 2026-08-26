import React, { useState, useEffect, useRef } from 'react';
import { BRAND_NETSUITE_MAP } from '../Shared/brandNetsuite';
import { db } from '../../firebase';
import { collection, onSnapshot, doc, updateDoc, setDoc, getDoc, getDocs, query, where } from "firebase/firestore";
import { softDeleteOrder } from "../Shared/orderLifecycle";
import { reopenQuoteInCpq } from '../Shared/reopenQuote';
import { resolveJobLines, buildNsTransaction, queueNsTransaction, jobsEstimateWriteBack } from '../Shared/nsTransmit';

// DYNAMIC BRAND MAPPING DICTIONARY
// ONE copy now — Shared/brandNetsuite.js (2026-08-25).



const ERPPushPullTab = ({ currentUser, activeBrand }) => {
  const [approvedJobs, setApprovedJobs] = useState([]);
  const [syncedJobs, setSyncedJobs] = useState([]);
  const [activeJob, setActiveJob] = useState(null);
  
  const [libraryParts, setLibraryParts] = useState([]);
  const [cpqFlows, setCpqFlows] = useState([]);
  const [outsourceFinishes, setOutsourceFinishes] = useState([]); // hq_outsource_finishes — an outsourced finish makes the line push the finished assembly (base/CODE) to consume plated stock
  const [globalFinishes, setGlobalFinishes] = useState([]); // system/master_finishes — in-house finishes; needed to resolve the code for STOCKED finished assemblies
  const [isPushing, setIsPushing] = useState(false);
  const [syncLog, setSyncLog] = useState([]);

  useEffect(() => {
    if (!activeBrand) return;

    const unsubJobs = onSnapshot(collection(db, "jobs"), (snapshot) => {
        const allJobs = snapshot.docs.map(d => ({ id: d.id, ...d.data() })).filter(j => j.brandId === activeBrand);
        setApprovedJobs(allJobs.filter(j => !j.deleted && !j.netsuiteEstimateId && (j.status === 'APPROVED' || j.status === 'READY_FOR_ERP')));
        setSyncedJobs(allJobs.filter(j => !j.deleted && (j.netsuiteEstimateId || j.status === 'TRANSMITTED_TO_ERP')));
    });

    const unsubParts = onSnapshot(collection(db, "Approved_Designs"), (snap) => {
        setLibraryParts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    const unsubFlows = onSnapshot(collection(db, "cpq_flows"), (snap) => {
        setCpqFlows(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    const unsubFinishes = onSnapshot(collection(db, "hq_outsource_finishes"), (snap) => {
        setOutsourceFinishes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    const unsubInFinishes = onSnapshot(doc(db, "system", "master_finishes"), (snap) => {
        setGlobalFinishes(snap.exists() && snap.data().finishes ? snap.data().finishes : []);
    });

    return () => { unsubJobs(); unsubParts(); unsubFlows(); unsubFinishes(); unsubInFinishes(); };
  }, [activeBrand]);

  const addLog = (msg, type = 'info') => {
      const time = new Date().toLocaleTimeString();
      setSyncLog(prev => [{ time, msg, type }, ...prev]);
  };

  // ONE resolver now — Shared/nsTransmit.js (2026-08-25). The same lines here, behind the CPQ
  // save buttons, and on RTG's master review. This tab keeps only the pre-flight UI.
  const txData = () => ({ libraryParts, cpqFlows, outsourceFinishes, globalFinishes });
  const getJobLineItems = (job) => resolveJobLines(job, txData()).lines;

  const handlePushToNetSuite = async (job) => {
      if (job.netsuiteEstimateId) {
          alert(`${job.jobId || job.id} already has NetSuite estimate ${job.netsuiteEstimateNo || job.netsuiteEstimateId} — nothing to push.`);
          return;
      }
      if (job.nsTransmitQueuedAt && !window.confirm(`A NetSuite push for ${job.jobId || job.id} was already queued ${new Date(job.nsTransmitQueuedAt).toLocaleString()} — check the Transmit Log (RTG) / Sync Queue (11.1) before queueing another.\n\nQueue another anyway?`)) return;
      setIsPushing(true);
      try {
          const ctx = { db, doc, getDoc };
          const built = await buildNsTransaction({ job, asType: 'estimate', brand: activeBrand, data: txData(), ctx, log: addLog });
          if (!built.ok) {
              addLog(`❌ FAILED (${built.error.code}): ${built.error.message}`, 'error');
              alert('Hold up! ' + built.error.message);
              setIsPushing(false); return;
          }
          if (built.meta.finishFallbacks.length) {
              addLog(`⚠️ Finished assembly(ies) not NetSuite-mapped — will push the BASE instead: ${built.meta.finishFallbacks.join(', ')}`, 'warn');
              if (!window.confirm(`These finished assemblies aren't synced to NetSuite yet:\n\n${built.meta.finishFallbacks.map(f => `• ${f}`).join('\n')}\n\nIf you continue, those lines push the BASE item. Push anyway?`)) { setIsPushing(false); return; }
          }
          const lvlNote = job.priceLevel && job.priceLevel !== 'STANDARD'
              ? `\n\n⚠ Priced at the ${job.priceLevel.replace('FAB_', 'FABRICUT ')} level — the estimate total will match that quote.`
              : '';
          if (!window.confirm(`Queue Quote ${job.jobId || job.id} to NetSuite? The staged sync (ns_outbox) posts it within ~1 minute and writes the estimate # back onto the quote.${lvlNote}`)) { setIsPushing(false); return; }

          const res = await queueNsTransaction({
              job, asType: 'estimate', brand: activeBrand, data: txData(), ctx,
              by: currentUser || '', writeBacks: [jobsEstimateWriteBack(job.id)], log: addLog,
          });
          if (!res.ok) throw new Error(res.error?.message || res.error?.code || 'queue failed');
          await updateDoc(doc(db, "jobs", job.id), { nsTransmitQueuedAt: Date.now(), nsTransmitOutboxId: res.outboxId });
          addLog(`✅ Queued to NetSuite (outbox ${res.outboxId}) — rollup $${res.meta.silentFeeBalance.toFixed(2)}, ${res.meta.lineCount} line(s). The estimate # lands on the quote when it posts; watch RTG's Transmit Log.`, 'success');
          setActiveJob(null);
      } catch (error) {
          console.error("NetSuite Push Error:", error);
          addLog(`❌ FAILED: ${error.message}`, 'error');
      }
      setIsPushing(false);
  };

  // Delete a ghost/abandoned quote job (e.g. a Vision push that was never completed): removes the
  // jobs doc plus its orphaned cpq_drafts and Vision drawings. Blocked once the job has reached
  // NetSuite — void it there instead, so the app and NetSuite never disagree about a live estimate.
  const handleDeleteJob = async (job, e) => {
      e.stopPropagation();
      const jid = job.jobId || job.id;
      if (job.netsuiteEstimateId || job.dispatchStatus?.nsSalesOrder) {
          alert(`${jid} is already in NetSuite (estimate ${job.netsuiteEstimateId || 'created'}).\n\nVoid it in NetSuite first — deleting only the app copy would leave a live estimate with no app record.`);
          return;
      }
      // SOFT delete + master ledger (Stuart 2026-08-25): the record is KEPT and stamped — drafts
      // and Vision drawings stay with it, since the job doc they belong to still exists.
      const reason = window.prompt(`Delete quote ${jid} (${job.customer?.name || 'no customer'} · $${job.cpqData?.totalPrice?.toFixed(2) || '0.00'})?\n\nThe record is KEPT — stamped deleted, dated, with your name — on the master Deletion Ledger (RTG Dispatch). It never reached NetSuite, so nothing exists there.\n\nReason (optional):`);
      if (reason === null) return;
      try {
          await softDeleteOrder({ db, doc, updateDoc, setDoc }, {
              collection: 'jobs', docId: job.id, record: job, kind: 'jobs',
              by: currentUser || '', from: 'ERP_PUSH_PULL', reason: reason || '',
          });
          if (activeJob?.id === job.id) setActiveJob(null);
          addLog(`🗑 Deleted quote ${jid} — record kept on the Deletion Ledger.`, 'success');
      } catch (err) {
          console.error(err);
          alert('Delete failed: ' + (err?.message || err));
      }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '30px', fontFamily: 'var(--sans)', backgroundColor: 'transparent', minHeight: '100vh' }}>
      
      <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: '4px' }}>NetSuite Synchronization Pipeline</span>
            <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>ERP Push/Pull Hub</h2>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flex: 1 }}>
        
        {/* LEFT COLUMN: JOB QUEUES */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px' }}>
            
            <div style={{ background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                <div style={{ padding: '20px 24px', background: 'var(--paper)', color: 'var(--ink)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500 }}>Pending ERP Dispatch</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>{approvedJobs.length} Orders</span>
                </div>
                <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px', background: '#fff', maxHeight: '400px', overflowY: 'auto' }}>
                    {approvedJobs.length === 0 && <span style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.9rem' }}>No jobs pending push.</span>}
                    {approvedJobs.map(job => (
                        <div key={job.id} onClick={() => setActiveJob(job)} style={{ background: activeJob?.id === job.id ? 'var(--paper-2)' : '#fff', border: `1px solid ${activeJob?.id === job.id ? 'var(--brass)' : 'var(--line)'}`, padding: '16px', cursor: 'pointer', transition: 'all 0.2s ease', boxShadow: activeJob?.id === job.id ? '0 4px 12px rgba(0,0,0,0.05)' : 'none' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                <span style={{ fontWeight: 500, color: 'var(--ink)', fontSize: '1.05rem' }}>{job.customer?.name || job.clientName || 'Unknown Customer'}</span>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <span style={{ fontFamily: 'var(--serif)', fontSize: '1.1rem', color: 'var(--ink)' }}>${job.cpqData?.totalPrice?.toFixed(2) || '0.00'}</span>
                                    <button onClick={(e) => handleDeleteJob(job, e)} title="Delete this quote from the app (ghost/abandoned jobs only — blocked once it's in NetSuite). Also removes its staging drafts + Vision drawings." style={{ background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink-soft)', cursor: 'pointer', fontSize: '13px', lineHeight: 1, padding: '5px 7px', borderRadius: '2px' }}>🗑</button>
                                </span>
                            </div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', fontFamily: 'var(--mono)', textTransform: 'uppercase' }}>ID: {job.jobId || job.id}</div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '4px' }}>Ref: {job.sidemark || 'N/A'}</div>
                        </div>
                    ))}
                </div>
            </div>

            <div style={{ background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                <div style={{ padding: '20px 24px', background: 'var(--paper)', color: 'var(--ink)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500 }}>Synchronized Historical</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>{syncedJobs.length} Orders</span>
                </div>
                <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px', background: '#fff', maxHeight: '300px', overflowY: 'auto' }}>
                    {syncedJobs.length === 0 && <span style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.9rem' }}>No history found.</span>}
                    {syncedJobs.map(job => (
                        <div key={job.id} style={{ background: 'var(--paper-2)', border: '1px solid var(--line)', padding: '16px', opacity: 0.8 }}>
                            <div style={{ fontWeight: 500, fontSize: '0.95rem', color: 'var(--ink)', marginBottom: '6px' }}>{job.customer?.name || job.clientName || 'Unknown Customer'}</div>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>NetSuite ID: <span style={{ color: 'var(--ink)' }}>{job.netsuiteEstimateId || 'Unknown'}</span></div>
                        </div>
                    ))}
                </div>
            </div>

        </div>

        {/* MIDDLE COLUMN: PAYLOAD BUILDER / CONFIRMATION */}
        <div style={{ flex: 1.5, background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', minHeight: '600px' }}>
            {activeJob ? (
                <>
                    <div style={{ padding: '24px 30px', background: 'var(--paper-2)', color: 'var(--ink)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
                        <div>
                            <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500 }}>Pre-Flight Payload Review</h3>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginTop: '4px', display: 'block' }}>{activeJob.jobId || activeJob.id}</span>
                        </div>
                    </div>
                    
                    <div style={{ padding: '30px', flex: 1, display: 'flex', flexDirection: 'column', gap: '24px', overflowY: 'auto' }}>
                        
                        <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px' }}>
                            <h4 style={{ margin: '0 0 16px 0', fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)', borderBottom: '1px solid var(--line)', paddingBottom: '12px' }}>Transaction Header (NetSuite Estimate)</h4>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', fontSize: '0.9rem' }}>
                                <div><strong style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '4px' }}>Customer ID</strong> <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{activeJob.customer?.id || 'Missing!'}</span></div>
                                <div><strong style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '4px' }}>Memo / Sidemark</strong> <span style={{ color: 'var(--ink)' }}>{activeJob.sidemark || 'None'}</span></div>
                                <div><strong style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '4px' }}>Total Value</strong> <span style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', color: 'var(--ink)', fontWeight: 500 }}>${activeJob.cpqData?.totalPrice?.toFixed(2) || '0.00'}</span></div>
                                <div><strong style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '4px' }}>Date</strong> <span style={{ color: 'var(--ink)' }}>{new Date().toLocaleDateString()}</span></div>
                            </div>
                        </div>

                        <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', padding: '24px' }}>
                            <h4 style={{ margin: '0 0 16px 0', fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)', borderBottom: '1px solid var(--line)', paddingBottom: '12px' }}>Shipping Destination Override</h4>
                            <div style={{ fontSize: '0.9rem', color: 'var(--ink)' }}>
                                <div style={{ marginBottom: '8px' }}><strong style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', marginRight: '8px' }}>Method:</strong> {activeJob.shippingMethod || 'Standard Defaults'}</div>
                                {activeJob.shippingMethod === 'SAVED' && activeJob.shippingAddressId && (
                                    <div style={{ marginTop: '8px' }}><strong style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', marginRight: '8px' }}>NetSuite Address Book ID:</strong> {activeJob.shippingAddressId}</div>
                                )}
                                {activeJob.shippingMethod === 'CUSTOM' && activeJob.customShippingAddress && (
                                    <div style={{ marginTop: '12px', padding: '16px', background: '#fff', border: '1px solid var(--line)', lineHeight: '1.5' }}>
                                        <div style={{ fontWeight: 500 }}>{activeJob.customShippingAddress.attention || activeJob.customShippingAddress.addressee}</div>
                                        <div>{activeJob.customShippingAddress.addr1}</div>
                                        {activeJob.customShippingAddress.addr2 && <div>{activeJob.customShippingAddress.addr2}</div>}
                                        <div>{activeJob.customShippingAddress.city}, {activeJob.customShippingAddress.state} {activeJob.customShippingAddress.zip}</div>
                                    </div>
                                )}
                                {(parseFloat(activeJob.shippingAmount) || 0) > 0 && (
                                    <div style={{ marginTop: '8px' }}><strong style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', marginRight: '8px' }}>Shipping Charge:</strong> ${(parseFloat(activeJob.shippingAmount) || 0).toFixed(2)} <span style={{ color: 'var(--ink-soft)', fontSize: '0.8rem' }}>(pushes to estimate header)</span></div>
                                )}
                            </div>
                        </div>

                        <div style={{ border: '1px solid var(--line)', padding: '24px', background: '#fff' }}>
                            <h4 style={{ margin: '0 0 16px 0', fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)', borderBottom: '1px solid var(--line)', paddingBottom: '12px' }}>Mapped Line Items (BOM)</h4>
                            
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left', background: '#fff' }}>
                                <thead style={{ background: 'var(--paper-2)' }}>
                                    <tr>
                                        <th style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>NetSuite ID</th>
                                        <th style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Description</th>
                                        <th style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Qty</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontWeight: 500, color: 'var(--ink)' }}>61502</td>
                                        <td style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontStyle: 'italic', color: 'var(--ink-soft)' }}>
                                            {cpqFlows.find(f => f.id === activeJob.flowId)?.name || 'Custom Assembly'} labor portion of quote# {activeJob.jobId || activeJob.id} for Job: {activeJob.jobName || 'N/A'} Sidemark: {activeJob.sidemark || 'N/A'}
                                        </td>
                                        <td style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', textAlign: 'center', color: 'var(--ink)' }}>1</td>
                                    </tr>
                                    {getJobLineItems(activeJob).map((line, idx) => (
                                        <tr key={idx}>
                                            <td style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', color: line.nsId === 'UNMAPPED' || line.nsId === 'PENDING' ? '#d9534f' : 'var(--ink)', fontFamily: 'var(--mono)' }}>{line.nsId}</td>
                                            <td style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', color: 'var(--ink)' }}>{line.masterPart.itemName}{line.aliasFace ? <span style={{ fontFamily: 'var(--mono)', fontSize: '0.72rem', color: 'var(--ink-soft)' }} title="Sold under this alias — the estimate reads under it, the item pushed is the real part"> · alias {line.aliasFace.legacyErpId || line.aliasFace.itemId}</span> : null}{line.finishedErpId ? <span style={{ fontFamily: 'var(--mono)', fontSize: '0.8rem', color: 'var(--brass)' }}> → {line.finishedErpId}</span> : null}{line.finishUnmapped ? <span style={{ fontFamily: 'var(--mono)', fontSize: '0.75rem', color: '#d9534f' }}> ⚠ {line.finishUnmapped} not synced — pushing base</span> : null}</td>
                                            <td style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', textAlign: 'center', fontWeight: 500, color: 'var(--ink)' }}>{line.qty}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                    </div>

                    <div style={{ padding: '24px', background: 'var(--paper-2)', borderTop: '1px solid var(--line)', display: 'flex', gap: '12px' }}>
                        <button
                            onClick={() => reopenQuoteInCpq(activeJob)}
                            disabled={isPushing}
                            title="Reopen this quote's configuration in the CPQ Configurator"
                            style={{ flex: 1, padding: '16px', background: '#fff', color: 'var(--brass)', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', border: '1px solid var(--brass)', cursor: isPushing ? 'wait' : 'pointer', transition: 'all 0.2s' }}
                        >
                            Reopen in CPQ
                        </button>
                        <button
                            onClick={() => handlePushToNetSuite(activeJob)}
                            disabled={isPushing}
                            style={{ flex: 2, padding: '16px', background: isPushing ? 'var(--paper)' : 'var(--ink)', color: isPushing ? 'var(--ink-soft)' : '#fff', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', border: '1px solid var(--ink)', cursor: isPushing ? 'wait' : 'pointer', transition: 'all 0.2s' }}
                        >
                            {isPushing ? "Transmitting to NetSuite..." : "Approve & Push to ERP"}
                        </button>
                    </div>
                </>
            ) : (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)', fontSize: '1.4rem' }}>
                    Select a pending job to review payload
                </div>
            )}
        </div>

        {/* RIGHT COLUMN: TERMINAL CONSOLE */}
        <div style={{ flex: 0.8, background: 'var(--dark)', border: '1px solid var(--line)', borderRadius: '2px', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', minHeight: '600px', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', background: 'var(--dark-2)', color: 'var(--paper)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>>_ Terminal Log</span>
                <button onClick={() => setSyncLog([])} style={{ background: 'none', border: 'none', color: 'var(--paper)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', opacity: 0.6, textTransform: 'uppercase' }}>Clear</button>
            </div>
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px', flex: 1, overflowY: 'auto', fontFamily: 'var(--mono)', fontSize: '11px', color: '#a8a5a0' }}>
                {syncLog.length === 0 && <span style={{ opacity: 0.6 }}>Awaiting transmission...</span>}
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
    </div>
  );
};

export default ERPPushPullTab;