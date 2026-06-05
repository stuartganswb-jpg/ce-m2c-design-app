import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, doc, updateDoc } from "firebase/firestore";

// 🚀 DYNAMIC BRAND MAPPING DICTIONARY
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

    return () => { unsubJobs(); unsubParts(); unsubFlows(); };
  }, [activeBrand]);

  const addLog = (msg, type = 'info') => {
      const time = new Date().toLocaleTimeString();
      setSyncLog(prev => [{ time, msg, type }, ...prev]);
  };

  // 🎯 Intelligent Line Item Extractor
  const getJobLineItems = (job) => {
      if (!job || !job.cpqData) return [];
      
      const flow = cpqFlows.find(f => f.id === job.flowId);
      
      const activeStepIds = new Set([
          ...Object.keys(job.cpqData?.configuration || {}),
          ...Object.keys(job.cpqData?.quantities || {})
      ]);

      const lines = [];

      activeStepIds.forEach(stepId => {
          const step = flow?.steps?.find(s => s.id === stepId);
          const userSelectionId = job.cpqData.configuration?.[stepId];
          let qty = job.cpqData.quantities?.[stepId];

          if (qty === undefined || qty === null || qty === '') qty = 1;

          const targetPartId = step?.linkedItemId || step?.linkedPinId || userSelectionId;

          if (targetPartId) {
              const masterPart = libraryParts.find(p => p.id === targetPartId || p.itemId === targetPartId || p.legacyErpId === targetPartId);
              
              if (masterPart) {
                  lines.push({
                      stepId,
                      masterPart,
                      qty: parseInt(qty) || 1,
                      nsId: masterPart.netSuiteInternalId || masterPart.legacyErpId || masterPart.itemId || 'UNMAPPED',
                      partCategory: masterPart.manufacturingSpecs?.partHandling || '',
                      projection: job.cpqData.dimensions?.[stepId]?.length || ''
                  });
              }
          }
      });

      return lines;
  };

  // --- 🚀 THE PUSH ENGINE (PROXY VERSION) ---
  const handlePushToNetSuite = async (job) => {
      const linesToPush = getJobLineItems(job);
      
      if (linesToPush.length === 0) {
          addLog(`❌ FAILED: Job ${job.jobId || job.id} has no mapped physical inventory.`, 'error');
          alert("Hold up! We couldn't find any physical NetSuite inventory linked to this configuration.");
          return;
      }

      if (!window.confirm(`Push Quote ${job.jobId || job.id} to NetSuite? This will create a live Quote/Estimate.`)) return;
      
      setIsPushing(true);
      addLog(`Initiating NetSuite Cloud Proxy for Job: ${job.jobId || job.id}`, 'info');

      try {
          const lineItems = [];
          let physicalItemsTotal = 0;
          
          // 1. Process Physical Inventory Components
          for (const line of linesToPush) {
              if (line.nsId !== 'UNMAPPED' && line.nsId !== 'PENDING') {
                  const rawRate = line.masterPart.manufacturingSpecs?.basePrice || 0;
                  const itemRate = parseFloat(rawRate); 
                  const lineTotal = itemRate * line.qty;
                  physicalItemsTotal += lineTotal;

                  const linePayload = {
                      item: { id: line.nsId.toString() }, 
                      quantity: line.qty,
                      rate: parseFloat(itemRate.toFixed(2)), 
                      price: { id: "-1" }, 
                      description: `${line.masterPart.itemName} (Mapped from CPQ)`,
                      custcol_part_category: line.partCategory
                  };

                  if (line.projection) {
                      linePayload.custcol_bracket_projection = line.projection.toString();
                  }

                  lineItems.push(linePayload);
              } else {
                  addLog(`WARNING: Skipping "${line.masterPart.itemName}". No NetSuite ID mapped.`, 'warn');
              }
          }

          if (lineItems.length === 0) {
              throw new Error("No valid NetSuite IDs were found to push. Sync aborted.");
          }

          // 2. Calculate "Silent Costs" (Fees, Base Price, Upcharges)
          const cpqGrandTotal = parseFloat(job.cpqData.totalPrice || 0);
          const silentFeeBalance = Math.max(0, cpqGrandTotal - physicalItemsTotal);

          // 3. Extract Customer & Brand
          let nsCustomerId = job.customer?.id || "";
          if (nsCustomerId.startsWith('CUST-')) nsCustomerId = nsCustomerId.replace('CUST-', '');
          const brandMapping = BRAND_NETSUITE_MAP[activeBrand] || { subsidiary: "2", location: "17" };

          // 4. Set Description
          const flowName = cpqFlows.find(f => f.id === job.flowId)?.name || 'Custom Assembly';
          const headerDesc = `${flowName} labor portion of quote# ${job.jobId || job.id} for Job: ${job.jobName || 'N/A'} Sidemark: ${job.sidemark || 'N/A'}`;

          // 🚀 5. CONSTRUCT SHIPPING OVERRIDES
          const shippingPayload = {};
          if (job.shippingMethod === 'SAVED' && job.shippingAddressId) {
              shippingPayload.shipaddresslist = { id: job.shippingAddressId };
          } else if (job.shippingMethod === 'CUSTOM' && job.customShippingAddress) {
              
              // Clean the state code (NetSuite expects strict 2-letter uppercase without periods, e.g., "FL" not "fl.")
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

          // 🚀 Clean the Memo Field (Removed the HQ APP CONFIG string)
          const memoText = [job.jobName, job.sidemark].filter(Boolean).join(' - ').trim();

          // 6. Construct the Final NetSuite Payload
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
                          item: { id: "61502" }, 
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

          // 7. Fire to Google Cloud Proxy
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', fontFamily: 'monospace', backgroundColor: '#e5e5e5', minHeight: '100vh' }}>
      
      <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '5px 5px 0 #000' }}>
        <div>
            <h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.4rem', color: '#6f42c1' }}>12. ERP Push/Pull</h2>
            <span style={{ fontSize: '0.7rem', color: '#666' }}>NETSUITE SYNCHRONIZATION PIPELINE</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', flex: 1 }}>
        
        {/* LEFT COLUMN: JOB QUEUES */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 rgba(0,0,0,0.1)' }}>
                <div style={{ padding: '15px', background: '#28a745', color: '#fff', fontWeight: 'bold', fontSize: '1.1rem', borderBottom: '2px solid #000' }}>
                    🟢 PENDING ERP DISPATCH ({approvedJobs.length})
                </div>
                <div style={{ padding: '15px', display: 'flex', flexDirection: 'column', gap: '10px', background: '#f8f9fa', maxHeight: '400px', overflowY: 'auto' }}>
                    {approvedJobs.length === 0 && <span style={{ color: '#999', fontStyle: 'italic' }}>No jobs pending push.</span>}
                    {approvedJobs.map(job => (
                        <div key={job.id} onClick={() => setActiveJob(job)} style={{ background: activeJob?.id === job.id ? '#eafaf1' : '#fff', border: `2px solid ${activeJob?.id === job.id ? '#28a745' : '#ccc'}`, padding: '15px', cursor: 'pointer', transition: '0.2s' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                                <span style={{ color: '#007bff' }}>{job.customer?.name || job.clientName || 'Unknown Customer'}</span>
                                <span style={{ color: '#28a745' }}>${job.cpqData?.totalPrice?.toFixed(2) || '0.00'}</span>
                            </div>
                            <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '5px' }}><strong>ID:</strong> {job.jobId || job.id}</div>
                            <div style={{ fontSize: '0.8rem', color: '#666' }}><strong>REF:</strong> {job.sidemark || 'N/A'}</div>
                        </div>
                    ))}
                </div>
            </div>

            <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 rgba(0,0,0,0.1)' }}>
                <div style={{ padding: '15px', background: '#6c757d', color: '#fff', fontWeight: 'bold', fontSize: '1.1rem', borderBottom: '2px solid #000' }}>
                    🔘 SYNCHRONIZED HISTORICAL ({syncedJobs.length})
                </div>
                <div style={{ padding: '15px', display: 'flex', flexDirection: 'column', gap: '10px', background: '#f8f9fa', maxHeight: '300px', overflowY: 'auto' }}>
                    {syncedJobs.length === 0 && <span style={{ color: '#999', fontStyle: 'italic' }}>No history found.</span>}
                    {syncedJobs.map(job => (
                        <div key={job.id} style={{ background: '#fff', border: '1px solid #ccc', borderLeft: '4px solid #6c757d', padding: '10px' }}>
                            <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{job.customer?.name || job.clientName || 'Unknown Customer'}</div>
                            <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '3px' }}><strong>NETSUITE ID:</strong> {job.netsuiteEstimateId || 'Unknown'}</div>
                        </div>
                    ))}
                </div>
            </div>

        </div>

        {/* MIDDLE COLUMN: PAYLOAD BUILDER / CONFIRMATION */}
        <div style={{ flex: 1.5, background: '#fff', border: '3px solid #000', boxShadow: '10px 10px 0 #000', display: 'flex', flexDirection: 'column', minHeight: '600px' }}>
            {activeJob ? (
                <>
                    <div style={{ padding: '20px', background: '#000', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <h3 style={{ margin: 0 }}>PRE-FLIGHT PAYLOAD REVIEW</h3>
                            <span style={{ fontSize: '0.75rem', color: '#aaa' }}>{activeJob.jobId || activeJob.id}</span>
                        </div>
                    </div>
                    
                    <div style={{ padding: '20px', flex: 1, display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto' }}>
                        
                        <div style={{ background: '#eafaf1', border: '2px solid #28a745', padding: '15px' }}>
                            <h4 style={{ margin: '0 0 10px 0', color: '#1e7e34' }}>TRANSACTION HEADER (NETSUITE ESTIMATE)</h4>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '0.85rem' }}>
                                <div><strong>CUSTOMER ID:</strong> <span style={{ color: '#007bff' }}>{activeJob.customer?.id || 'Missing!'}</span></div>
                                <div><strong>MEMO / SIDEMARK:</strong> {activeJob.sidemark || 'None'}</div>
                                <div><strong>TOTAL VALUE:</strong> <span style={{ color: '#28a745', fontWeight: 'bold' }}>${activeJob.cpqData?.totalPrice?.toFixed(2) || '0.00'}</span></div>
                                <div><strong>DATE:</strong> {new Date().toLocaleDateString()}</div>
                            </div>
                        </div>

                        <div style={{ background: '#f8f9fa', border: '2px solid #17a2b8', padding: '15px' }}>
                            <h4 style={{ margin: '0 0 10px 0', color: '#17a2b8' }}>SHIPPING DESTINATION OVERRIDE</h4>
                            <div style={{ fontSize: '0.85rem', color: '#333' }}>
                                <strong>Method:</strong> {activeJob.shippingMethod || 'Standard Defaults'}<br/>
                                {activeJob.shippingMethod === 'SAVED' && activeJob.shippingAddressId && (
                                    <div style={{ marginTop: '5px' }}><strong>NetSuite Address Book ID:</strong> {activeJob.shippingAddressId}</div>
                                )}
                                {activeJob.shippingMethod === 'CUSTOM' && activeJob.customShippingAddress && (
                                    <div style={{ marginTop: '5px', padding: '10px', background: '#fff', border: '1px solid #ccc' }}>
                                        <div style={{ fontWeight: 'bold' }}>{activeJob.customShippingAddress.attention || activeJob.customShippingAddress.addressee}</div>
                                        <div>{activeJob.customShippingAddress.addr1}</div>
                                        {activeJob.customShippingAddress.addr2 && <div>{activeJob.customShippingAddress.addr2}</div>}
                                        <div>{activeJob.customShippingAddress.city}, {activeJob.customShippingAddress.state} {activeJob.customShippingAddress.zip}</div>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div style={{ border: '2px solid #ccc', padding: '15px', background: '#f8f9fa' }}>
                            <h4 style={{ margin: '0 0 10px 0', color: '#333' }}>MAPPED LINE ITEMS (BOM)</h4>
                            
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left', background: '#fff' }}>
                                <thead style={{ background: '#eee' }}>
                                    <tr>
                                        <th style={{ padding: '8px', borderBottom: '2px solid #000' }}>NETSUITE ID</th>
                                        <th style={{ padding: '8px', borderBottom: '2px solid #000' }}>DESCRIPTION</th>
                                        <th style={{ padding: '8px', borderBottom: '2px solid #000', textAlign: 'center' }}>QTY</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td style={{ padding: '8px', borderBottom: '1px solid #eee', fontWeight: 'bold', color: '#007bff' }}>61502</td>
                                        <td style={{ padding: '8px', borderBottom: '1px solid #eee', fontStyle: 'italic' }}>
                                            {cpqFlows.find(f => f.id === activeJob.flowId)?.name || 'Custom Assembly'} labor portion of quote# {activeJob.jobId || activeJob.id} for Job: {activeJob.jobName || 'N/A'} Sidemark: {activeJob.sidemark || 'N/A'}
                                        </td>
                                        <td style={{ padding: '8px', borderBottom: '1px solid #eee', textAlign: 'center' }}>1</td>
                                    </tr>
                                    {getJobLineItems(activeJob).map((line, idx) => (
                                        <tr key={idx}>
                                            <td style={{ padding: '8px', borderBottom: '1px solid #eee', color: line.nsId === 'UNMAPPED' || line.nsId === 'PENDING' ? '#d9534f' : '#333', fontWeight: 'bold' }}>{line.nsId}</td>
                                            <td style={{ padding: '8px', borderBottom: '1px solid #eee' }}>{line.masterPart.itemName}</td>
                                            <td style={{ padding: '8px', borderBottom: '1px solid #eee', textAlign: 'center', fontWeight: 'bold' }}>{line.qty}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                    </div>

                    <div style={{ padding: '20px', background: '#f4f4f4', borderTop: '2px solid #000' }}>
                        <button 
                            onClick={() => handlePushToNetSuite(activeJob)} 
                            disabled={isPushing}
                            style={{ width: '100%', padding: '20px', background: isPushing ? '#ccc' : '#6f42c1', color: '#fff', fontSize: '1.2rem', fontWeight: 'bold', border: 'none', cursor: isPushing ? 'wait' : 'pointer', boxShadow: '4px 4px 0 rgba(0,0,0,0.2)', transition: '0.2s' }}
                        >
                            {isPushing ? "⚡ TRANSMITTING TO NETSUITE..." : "🚀 APPROVE & PUSH TO ERP"}
                        </button>
                    </div>
                </>
            ) : (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontWeight: 'bold', fontSize: '1.2rem' }}>
                    SELECT A PENDING JOB TO REVIEW PAYLOAD
                </div>
            )}
        </div>

        {/* RIGHT COLUMN: TERMINAL CONSOLE */}
        <div style={{ flex: 0.8, background: '#1e1e1e', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 #000', minHeight: '600px' }}>
            <div style={{ padding: '10px 15px', background: '#333', color: '#fff', fontWeight: 'bold', fontSize: '0.8rem', borderBottom: '2px solid #000', display: 'flex', justifyContent: 'space-between' }}>
                <span>>_ TERMINAL LOG</span>
                <button onClick={() => setSyncLog([])} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '0.7rem' }}>CLEAR</button>
            </div>
            <div style={{ padding: '15px', display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                {syncLog.length === 0 && <span style={{ color: '#666' }}>Awaiting transmission...</span>}
                {syncLog.map((log, idx) => {
                    let color = '#fff';
                    if (log.type === 'error') color = '#ff4d4d';
                    if (log.type === 'success') color = '#28a745';
                    if (log.type === 'warn') color = '#ffc107';
                    
                    return (
                        <div key={idx} style={{ color, borderBottom: '1px dotted #333', paddingBottom: '4px' }}>
                            <span style={{ color: '#888', marginRight: '8px' }}>[{log.time}]</span>
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