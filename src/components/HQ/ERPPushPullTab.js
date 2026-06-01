import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, doc, updateDoc } from "firebase/firestore";

const ERPPushPullTab = ({ currentUser, activeBrand }) => {
  const [approvedJobs, setApprovedJobs] = useState([]);
  const [syncedJobs, setSyncedJobs] = useState([]);
  const [activeJob, setActiveJob] = useState(null);
  
  const [libraryParts, setLibraryParts] = useState([]);
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

    return () => { unsubJobs(); unsubParts(); };
  }, [activeBrand]);

  const addLog = (msg, type = 'info') => {
      const time = new Date().toLocaleTimeString();
      setSyncLog(prev => [{ time, msg, type }, ...prev]);
  };

  // --- 🚀 THE PUSH ENGINE (PROXY VERSION) ---
  const handlePushToNetSuite = async (job) => {
      if (!job.cpqData || !job.cpqData.configuration) {
          addLog(`❌ FAILED: Job ${job.jobId || job.id} has no CPQ data.`, 'error');
          alert("Hold up! This job hasn't been configured in the CPQ Engine (Tab 8) yet. There is no physical inventory attached to it.");
          return;
      }

      if (!window.confirm(`Push Quote ${job.jobId || job.id} to NetSuite? This will create a live Estimate.`)) return;
      
      setIsPushing(true);
      addLog(`Initiating NetSuite Cloud Proxy for Job: ${job.jobId || job.id}`, 'info');

      try {
          const lineItems = [];
          let physicalItemsTotal = 0;
          
          // 1. Process Physical Inventory Components
          if (job.cpqData?.configuration) {
              for (const [stepId, partId] of Object.entries(job.cpqData.configuration)) {
                  const masterPart = libraryParts.find(p => p.id === partId);
                  const qty = job.cpqData.quantities?.[stepId] || 1;
                  
                  if (masterPart) {
                      const nsId = masterPart.netSuiteInternalId || masterPart.legacyErpId; 
                      
                      if (nsId && nsId !== 'PENDING') {
                          const itemRate = masterPart.manufacturingSpecs?.basePrice || 0;
                          const lineTotal = itemRate * qty;
                          physicalItemsTotal += lineTotal;

                          // Extract specific custom columns
                          const partCategory = masterPart.manufacturingSpecs?.partHandling || '';
                          const projection = job.cpqData.dimensions?.[stepId]?.length || '';

                          const linePayload = {
                              item: { id: nsId.toString() }, 
                              quantity: qty,
                              rate: itemRate,
                              description: `${masterPart.itemName} (Mapped from CPQ)`,
                              custcol_part_category: partCategory
                          };

                          // Only append projection if it exists for this step
                          if (projection) {
                              linePayload.custcol_bracket_projection = projection.toString();
                          }

                          lineItems.push(linePayload);
                      } else {
                          addLog(`WARNING: Skipping "${masterPart.itemName}". No NetSuite ID mapped in Library.`, 'warn');
                      }
                  }
              }
          }

          // 2. Calculate "Silent Costs" (Fees, Base Price, Upcharges)
          const cpqGrandTotal = job.cpqData.totalPrice || 0;
          const silentFeeBalance = Math.max(0, cpqGrandTotal - physicalItemsTotal);

          // 3. Construct the NetSuite Header & Payload
          let nsCustomerId = job.customer?.id || "";
          if (nsCustomerId.startsWith('CUST-')) nsCustomerId = nsCustomerId.replace('CUST-', '');

          const payload = {
              entity: { id: nsCustomerId || "12345" }, 
              memo: `[HQ APP CONFIG] ${job.jobName || ''} - ${job.sidemark || ''}`.trim(),
              custbody50: job.jobId || job.id, // Injects Quote ID for inbound sync routing
              item: {
                  items: [
                      {
                          // Master Assembly / Fee Roll-up Line
                          item: { id: "61502" }, 
                          quantity: 1,
                          rate: silentFeeBalance,
                          description: `=== CPQ BUILD: ${job.sidemark?.toUpperCase() || 'CUSTOM CONFIGURATION'} ===`
                      },
                      ...lineItems
                  ]
              }
          };

          addLog(`Payload constructed. Silent Fees/Assembly assigned $${silentFeeBalance.toFixed(2)}`, 'success');

          // 4. Fire to Google Cloud Proxy
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

          addLog(`✅ Success! NetSuite Estimate Created (ID: ${result.id})`, 'success');

          await updateDoc(doc(db, "jobs", job.id), {
              status: 'TRANSMITTED_TO_ERP',
              netsuiteEstimateId: result.id,
              dateTransmitted: new Date().toISOString()
          });

          setActiveJob(null);

      } catch (error) {
          console.error("NetSuite Push Error:", error);
          addLog(`❌ FAILED: ${error.message}`, 'error');
          alert("Failed to push to NetSuite. Please check the logs on the right side of the screen.");
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
                                        <td style={{ padding: '8px', borderBottom: '1px solid #eee', fontStyle: 'italic' }}>=== CPQ BUILD: {activeJob.sidemark?.toUpperCase()} ===</td>
                                        <td style={{ padding: '8px', borderBottom: '1px solid #eee', textAlign: 'center' }}>1</td>
                                    </tr>
                                    {Object.entries(activeJob.cpqData?.configuration || {}).map(([stepId, partId], idx) => {
                                        const masterPart = libraryParts.find(p => p.id === partId);
                                        const qty = activeJob.cpqData?.quantities?.[stepId] || 1;
                                        const nsId = masterPart?.netSuiteInternalId || masterPart?.legacyErpId || masterPart?.itemId || 'UNMAPPED';
                                        
                                        return (
                                            <tr key={idx}>
                                                <td style={{ padding: '8px', borderBottom: '1px solid #eee', color: nsId === 'UNMAPPED' || nsId === 'PENDING' ? '#d9534f' : '#333', fontWeight: 'bold' }}>{nsId}</td>
                                                <td style={{ padding: '8px', borderBottom: '1px solid #eee' }}>{masterPart?.itemName || 'Unknown Part'}</td>
                                                <td style={{ padding: '8px', borderBottom: '1px solid #eee', textAlign: 'center', fontWeight: 'bold' }}>{qty}</td>
                                            </tr>
                                        );
                                    })}
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