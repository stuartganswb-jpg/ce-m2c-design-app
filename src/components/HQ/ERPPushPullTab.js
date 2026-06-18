import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, doc, updateDoc } from "firebase/firestore";

// DYNAMIC BRAND MAPPING DICTIONARY
const BRAND_NETSUITE_MAP = {
    'm2c': { subsidiary: "3", location: "19" },
    'uniquity': { subsidiary: "6", location: "22" },
    'ce': { subsidiary: "2", location: "17" },
    'leyla': { subsidiary: "5", location: "18" }
};

const ERPPushPullTab = ({ currentUser, activeBrand }) => {
  const [approvedJobs, setApprovedJobs] = useState([]);
  const [syncedJobs, setSyncedJobs] = useState([]);
  const [activeJob, setActiveJob] = useState(null);
  
  const [libraryParts, setLibraryParts] = useState([]);
  const [cpqFlows, setCpqFlows] = useState([]);
  const [outsourceFinishes, setOutsourceFinishes] = useState([]); // hq_outsource_finishes — an outsourced finish makes the line push the finished assembly (base/CODE) to consume plated stock
  const [isPushing, setIsPushing] = useState(false);
  const [syncLog, setSyncLog] = useState([]);

  // --- REPLACE WITH YOUR ACTUAL FIREBASE FUNCTION URL ---
  const FIREBASE_FUNCTION_URL = "https://netsuiteproxy-f3h3jadzaq-uc.a.run.app"; 

  useEffect(() => {
    if (!activeBrand) return;

    const unsubJobs = onSnapshot(collection(db, "jobs"), (snapshot) => {
        const allJobs = snapshot.docs.map(d => ({ id: d.id, ...d.data() })).filter(j => j.brandId === activeBrand);
        setApprovedJobs(allJobs.filter(j => j.status === 'APPROVED' || j.status === 'READY_FOR_ERP'));
        setSyncedJobs(allJobs.filter(j => j.status === 'TRANSMITTED_TO_ERP'));
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

    return () => { unsubJobs(); unsubParts(); unsubFlows(); unsubFinishes(); };
  }, [activeBrand]);

  const addLog = (msg, type = 'info') => {
      const time = new Date().toLocaleTimeString();
      setSyncLog(prev => [{ time, msg, type }, ...prev]);
  };

  // Resolve a job's CPQ selections into physical-inventory lines, while tracking what
  // could NOT be resolved so the push can report a specific reason instead of a generic
  // "no inventory" popup.
  const resolveJobLines = (job) => {
      const result = { lines: [], stepsConsidered: 0, unresolved: [], hasConfig: false };
      if (!job || !job.cpqData) return result;

      const flow = cpqFlows.find(f => f.id === job.flowId);
      const flowSteps = flow?.steps || [];
      const activeStepIds = new Set([
          ...Object.keys(job.cpqData?.configuration || {}),
          ...Object.keys(job.cpqData?.quantities || {})
      ]);
      result.hasConfig = activeStepIds.size > 0;

      // Resolve a CPQ selection to its real library part. STYLE_SWAP selections are per-instance
      // optIds whose styleOption carries a PROJECTED partId/partName (e.g. "FICERA1001 CEILING BRACKET
      // LEFT") that is NOT the doc id, and legacy parts have itemId != doc id — so without this, every
      // STYLE_SWAP bracket/finial/backplate silently dropped from the pushed BOM. Match exact, then by
      // longest part-code prefix (brackets: FICERA1001…→FICERA) or full item-name (poles/rings).
      const normCode = (s) => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
      const matchPart = (key) => {
          if (key == null || key === '') return null;
          const exact = libraryParts.find(p => p.id === key || p.itemId === key || p.itemName === key || p.legacyErpId === key);
          if (exact) return exact;
          const nk = normCode(key);
          if (nk.length < 3) return null;
          let best = null, bestLen = 0;
          libraryParts.forEach(p => {
              [p.legacyErpId, p.itemId].forEach(code => { const nc = normCode(code); if (nc.length >= 3 && nk.startsWith(nc) && nc.length > bestLen) { best = p; bestLen = nc.length; } });
              const nn = normCode(p.itemName); if (nn.length >= 3 && nk === nn && nn.length > bestLen) { best = p; bestLen = nn.length; }
          });
          return best;
      };
      // Find the styleOption (main step or backplate __sub) behind a selection id, to read its part link.
      const findOpt = (stepId, selId) => {
          const base = stepId.endsWith('__sub') ? stepId.slice(0, -5) : stepId;
          const st = flowSteps.find(s => s.id === base);
          if (!st) return null;
          const pool = stepId.endsWith('__sub') ? (st.subOptions || []) : (st.styleOptions || []);
          return pool.find(o => (o.optId || o.partId) === selId) || null;
      };

      activeStepIds.forEach(stepId => {
          if (stepId.endsWith('__finish')) return; // finishes are applied, not physical BOM components
          const step = flowSteps.find(s => s.id === stepId);
          const userSelectionId = job.cpqData.configuration?.[stepId];
          let qty = job.cpqData.quantities?.[stepId];
          if (qty === undefined || qty === null || qty === '') qty = 1;

          const targetPartId = step?.linkedItemId || step?.linkedPinId || userSelectionId;
          if (!targetPartId) return;

          result.stepsConsidered++;
          // direct match first, then resolve through the selection's styleOption (projected name → code)
          let masterPart = matchPart(targetPartId);
          if (!masterPart) {
              const opt = findOpt(stepId, userSelectionId);
              masterPart = matchPart(opt?.partId) || matchPart(opt?.partName);
          }
          if (!masterPart) {
              result.unresolved.push({ stepTitle: step?.title || stepId, partId: targetPartId });
              return;
          }
          // If the customer picked an OUTSOURCED finish on this step, the demand must land on the finished
          // plated assembly (base/CODE, e.g. H1-138BF/EP1) so NetSuite consumes the outsourced finished stock —
          // not the bare base. In-house finishes (phosphate /P etc.) stay on the base: the floor makes + finishes
          // it. Pricing stays on the base part so the quote total is unchanged (the rollup line absorbs any
          // balance); only the pushed ITEM id changes. If the finished assembly isn't in the library / isn't
          // NetSuite-mapped, we keep the base and flag it (can't push an item with no internal id).
          let nsId = masterPart.netSuiteInternalId || masterPart.legacyErpId || masterPart.itemId || 'UNMAPPED';
          let finishedErpId = '';
          let finishUnmapped = '';
          const finishId = job.cpqData.configuration?.[`${stepId}__finish`];
          if (finishId) {
              const outFinish = outsourceFinishes.find(f => f.id === finishId);
              const finishCode = outFinish ? String(outFinish.code || outFinish.name || '').toUpperCase() : '';
              if (finishCode) {
                  const baseErp = String(masterPart.legacyErpId || masterPart.itemId || '').toUpperCase();
                  finishedErpId = `${baseErp}/${finishCode}`;
                  const finishedPart = libraryParts.find(p => String(p.legacyErpId || p.itemId || '').toUpperCase() === finishedErpId);
                  if (finishedPart && finishedPart.netSuiteInternalId) {
                      nsId = finishedPart.netSuiteInternalId; // push the plated finished assembly → consumes outsourced stock
                  } else {
                      finishUnmapped = finishedErpId; // outsourced finish selected but the finished SKU has no NS id
                  }
              }
          }
          result.lines.push({
              stepId,
              masterPart,
              qty: parseInt(qty) || 1,
              nsId,
              finishedErpId,   // non-empty when this line is pushing an outsourced finished assembly
              finishUnmapped,  // non-empty when an outsourced finished SKU couldn't be NS-resolved (fell back to base)
              partCategory: masterPart.manufacturingSpecs?.partHandling || '',
              projection: job.cpqData.dimensions?.[stepId]?.length || ''
          });
      });
      return result;
  };

  const getJobLineItems = (job) => resolveJobLines(job).lines;

  const handlePushToNetSuite = async (job) => {
      const { lines: linesToPush, stepsConsidered, unresolved, hasConfig } = resolveJobLines(job);

      if (linesToPush.length === 0) {
          if (!hasConfig) {
              // No per-step configuration/quantities at all — almost always a stale quote
              // saved before CPQ wrote those maps, or a flow with no priced steps.
              addLog(`❌ FAILED: Job ${job.jobId || job.id} carries no CPQ configuration map. Re-save it as a fresh quote (older quotes lack the mapping the push needs).`, 'error');
              alert("Hold up! This quote has no CPQ configuration data attached.\n\nIt was likely saved before the latest CPQ update. Re-build and finalize it as a NEW quote, then push.");
          } else if (stepsConsidered === 0) {
              // Steps exist but none link to a physical part.
              addLog(`❌ FAILED: Job ${job.jobId || job.id} — flow steps aren't linked to physical parts (no Linked Item / Auto-Sync BOM).`, 'error');
              alert("Hold up! This flow's steps aren't linked to physical parts.\n\nIn System Admin → CPQ Flow Builder, set each step's Linked Item (or run Auto-Sync BOM against the linked Master Assembly), then re-save the quote.");
          } else {
              // Steps point to part IDs that don't exist in Approved_Designs for this brand.
              const refs = unresolved.map(u => `• ${u.stepTitle}  →  ${u.partId}`).join('\n');
              addLog(`❌ FAILED: Job ${job.jobId || job.id} — ${stepsConsidered} step(s) configured, 0 resolve to a library part. Unresolved IDs: ${unresolved.map(u => u.partId).join(', ')}`, 'error');
              alert(`Hold up! ${stepsConsidered} configured step(s), but none point to a part in the library (Approved_Designs):\n\n${refs}\n\nLink these steps to existing library parts, or check the part IDs / brand.`);
          }
          return;
      }

      // Outsourced-finish lines whose finished assembly (base/CODE) isn't in the library / NetSuite-mapped:
      // they'll fall back to pushing the BASE item, which would consume raw instead of the plated finished stock.
      // Warn before pushing so the user can sync/map the finished SKU first.
      const finishFallbacks = linesToPush.filter(l => l.finishUnmapped).map(l => l.finishUnmapped);
      if (finishFallbacks.length) {
          addLog(`⚠️ Outsourced finished item(s) not NetSuite-mapped — will push the BASE instead of the plated assembly: ${finishFallbacks.join(', ')}`, 'warn');
          if (!window.confirm(`These outsourced finished assemblies aren't synced to NetSuite yet:\n\n${finishFallbacks.map(f => `• ${f}`).join('\n')}\n\nIf you continue, those lines push the BASE item (consumes raw, not the plated stock). Sync/map them in the Library first for correct consumption.\n\nPush anyway?`)) return;
      }

      if (!window.confirm(`Push Quote ${job.jobId || job.id} to NetSuite? This will create a live Quote/Estimate.`)) return;

      setIsPushing(true);
      addLog(`Initiating NetSuite Cloud Proxy for Job: ${job.jobId || job.id}`, 'info');

      try {
          const lineItems = [];
          let physicalItemsTotal = 0;
          const unmappedNames = [];

          for (const line of linesToPush) {
              if (line.nsId !== 'UNMAPPED' && line.nsId !== 'PENDING') {
                  // Rate = the customer's negotiated price for this part if one exists,
                  // otherwise the part's base price. This mirrors how CPQ built the quote
                  // total, so the line rates + rollup line always sum to the quoted total.
                  // A part with neither lands at 0 and its value rolls into the rollup.
                  let itemRate = parseFloat(line.masterPart.manufacturingSpecs?.basePrice || 0) || 0;
                  const cp = line.masterPart.clientPricing?.find(c => c.customerId === job.customer?.id);
                  if (cp && cp.price !== undefined && cp.price !== '' && !isNaN(parseFloat(cp.price))) {
                      itemRate = parseFloat(cp.price);
                  }
                  const lineTotal = itemRate * line.qty;
                  physicalItemsTotal += lineTotal;

                  const linePayload = {
                      item: { id: line.nsId.toString() }, 
                      quantity: line.qty,
                      rate: parseFloat(itemRate.toFixed(2)), 
                      price: { id: "-1" },
                      description: line.finishedErpId
                          ? `${line.masterPart.itemName} → ${line.finishedErpId} (outsourced finish, CPQ)`
                          : `${line.masterPart.itemName} (Mapped from CPQ)`,
                      custcol_part_category: line.partCategory
                  };

                  if (line.projection) {
                      linePayload.custcol_bracket_projection = line.projection.toString();
                  }

                  lineItems.push(linePayload);
              } else {
                  unmappedNames.push(line.masterPart.itemName || line.masterPart.id);
                  addLog(`WARNING: Skipping "${line.masterPart.itemName}". No NetSuite ID mapped.`, 'warn');
              }
          }

          if (lineItems.length === 0) {
              addLog(`❌ FAILED: ${linesToPush.length} part(s) resolved but none have a NetSuite ID: ${unmappedNames.join(', ')}`, 'error');
              alert(`Hold up! ${linesToPush.length} part(s) resolved, but none have a NetSuite internal ID yet:\n\n${unmappedNames.map(n => `• ${n}`).join('\n')}\n\nSync these items to NetSuite (Library → NetSuite Sync) so they have an internal ID, then push again.`);
              throw new Error("No valid NetSuite IDs were found to push. Sync aborted.");
          }

          const cpqGrandTotal = parseFloat(job.cpqData.totalPrice || 0);
          const silentFeeBalance = Math.max(0, cpqGrandTotal - physicalItemsTotal);

          let nsCustomerId = job.customer?.id || "";
          if (nsCustomerId.startsWith('CUST-')) nsCustomerId = nsCustomerId.replace('CUST-', '');
          const brandMapping = BRAND_NETSUITE_MAP[activeBrand] || { subsidiary: "2", location: "17" };

          const flowDoc = cpqFlows.find(f => f.id === job.flowId);
          const flowName = flowDoc?.name || 'Custom Assembly';
          // The flow's dedicated NetSuite rollup item (set in the CPQ Flow Builder). Falls
          // back to the shared default 61502 for flows that haven't created one yet.
          const rollupItemId = flowDoc?.nsRollupItemId || '61502';
          if (!flowDoc?.nsRollupItemId) {
              addLog(`⚠️ Flow "${flowName}" has no dedicated rollup item — using shared default 61502. Create one in the CPQ Flow Builder for clean 1:1 mapping.`, 'warn');
          }
          const headerDesc = `${flowName} labor portion of quote# ${job.jobId || job.id} for Job: ${job.jobName || 'N/A'} Sidemark: ${job.sidemark || 'N/A'}`;

          const shippingPayload = {};
          if (job.shippingMethod === 'SAVED' && job.shippingAddressId) {
              shippingPayload.shipaddresslist = { id: job.shippingAddressId };
          } else if (job.shippingMethod === 'CUSTOM' && job.customShippingAddress) {
              let cleanState = job.customShippingAddress.state || '';
              if (cleanState) {
                  cleanState = cleanState.toUpperCase().replace(/\./g, '').trim();
              }
              shippingPayload.shippingaddress = {
                  attention: job.customShippingAddress.attention || '',
                  addressee: job.customShippingAddress.addressee || '',
                  addr1: job.customShippingAddress.addr1 || '',
                  addr2: job.customShippingAddress.addr2 || '',
                  city: job.customShippingAddress.city || '',
                  state: cleanState,
                  zip: job.customShippingAddress.zip || '',
                  country: { id: job.customShippingAddress.country || 'US' }
              };
          }

          const memoText = [job.jobName, job.sidemark].filter(Boolean).join(' - ').trim();

          const payload = {
              entity: { id: nsCustomerId }, 
              subsidiary: { id: brandMapping.subsidiary }, 
              location: { id: brandMapping.location },     
              memo: memoText,
              custbody50: job.jobId || job.id, 
              ...shippingPayload,
              item: {
                  items: [
                      {
                          item: { id: rollupItemId },
                          quantity: 1,
                          rate: parseFloat(silentFeeBalance.toFixed(2)),
                          price: { id: "-1" },
                          description: headerDesc
                      },
                      ...lineItems
                  ]
              }
          };

          addLog(`Payload constructed. Silent Fees/Assembly assigned $${silentFeeBalance.toFixed(2)}`, 'success');
          if (shippingPayload.shippingaddress) addLog(`Custom Shipping Override Attached.`, 'info');

          const targetUrl = `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/estimate`;
          addLog(`Transmitting to NetSuite via Google Cloud...`, 'info');

          const response = await fetch(FIREBASE_FUNCTION_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  targetUrl: targetUrl,
                  method: 'POST',
                  payload: payload
              })
          });

          const result = await response.json();

          if (!response.ok) {
              throw new Error(`API Rejected [${response.status}]: ${JSON.stringify(result)}`);
          }

          const returnedId = result.id || result.recordId || "CREATED_CHECK_NETSUITE";

          addLog(`✅ Success! NetSuite Quote Created (ID: ${returnedId})`, 'success');

          await updateDoc(doc(db, "jobs", job.id), {
              status: 'TRANSMITTED_TO_ERP',
              netsuiteEstimateId: returnedId, 
              dateTransmitted: new Date().toISOString()
          });

          setActiveJob(null);

      } catch (error) {
          console.error("NetSuite Push Error:", error);
          addLog(`❌ FAILED: ${error.message}`, 'error');
      }
      
      setIsPushing(false);
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
                                <span style={{ fontFamily: 'var(--serif)', fontSize: '1.1rem', color: 'var(--ink)' }}>${job.cpqData?.totalPrice?.toFixed(2) || '0.00'}</span>
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
                                            <td style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', color: 'var(--ink)' }}>{line.masterPart.itemName}{line.finishedErpId ? <span style={{ fontFamily: 'var(--mono)', fontSize: '0.8rem', color: 'var(--brass)' }}> → {line.finishedErpId}</span> : null}{line.finishUnmapped ? <span style={{ fontFamily: 'var(--mono)', fontSize: '0.75rem', color: '#d9534f' }}> ⚠ {line.finishUnmapped} not synced — pushing base</span> : null}</td>
                                            <td style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', textAlign: 'center', fontWeight: 500, color: 'var(--ink)' }}>{line.qty}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                    </div>

                    <div style={{ padding: '24px', background: 'var(--paper-2)', borderTop: '1px solid var(--line)' }}>
                        <button 
                            onClick={() => handlePushToNetSuite(activeJob)} 
                            disabled={isPushing}
                            style={{ width: '100%', padding: '16px', background: isPushing ? 'var(--paper)' : 'var(--ink)', color: isPushing ? 'var(--ink-soft)' : '#fff', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', border: '1px solid var(--ink)', cursor: isPushing ? 'wait' : 'pointer', transition: 'all 0.2s' }}
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