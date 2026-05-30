import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, doc, updateDoc, getDoc } from "firebase/firestore";

// --- REQUIRED FOR NETSUITE AUTHENTICATION ---
// In a true production environment, you should move this block to a Firebase Cloud Function
// to hide your consumer secrets. For now, it runs client-side to test the pipeline.
import CryptoJS from 'crypto-js';

const ERPPushPullTab = ({ currentUser, activeBrand }) => {
  const [approvedJobs, setApprovedJobs] = useState([]);
  const [syncedJobs, setSyncedJobs] = useState([]);
  const [activeJob, setActiveJob] = useState(null);
  
  // Master library lookup for mapping ERP IDs
  const [libraryParts, setLibraryParts] = useState([]);

  const [isPushing, setIsPushing] = useState(false);
  const [syncLog, setSyncLog] = useState([]);

  // --- NetSuite API Credentials ---
  const NS_ACCOUNT = "3728153";
  const NS_CONSUMER_KEY = "0979687669fe99f5869793e3a911daeb062b779c4801817c86b494ccde1e0db4";
  const NS_CONSUMER_SECRET = "4f88d6f93c57a1b9e0ffb29ff71831d47b075dcdf609cdb028dd305cb552c243";
  const NS_TOKEN_ID = "2e5ce04cce902b621aad683d91e08674631cc7c9dd07edaae07cdc12e12f57ad";
  const NS_TOKEN_SECRET = "f5c98c85514f46fc67674d822b6d70461e5407da13c84c2db6c72d8a5592a72";

  useEffect(() => {
    if (!activeBrand) return;

    // Listen for Approved Jobs waiting for ERP dispatch
    const unsubJobs = onSnapshot(collection(db, "jobs"), (snapshot) => {
        const allJobs = snapshot.docs.map(d => ({ id: d.id, ...d.data() })).filter(j => j.brandId === activeBrand);
        setApprovedJobs(allJobs.filter(j => j.status === 'APPROVED' || j.status === 'READY_FOR_ERP'));
        setSyncedJobs(allJobs.filter(j => j.status === 'TRANSMITTED_TO_ERP'));
    });

    // Cache the Master Library so we can translate CPQ Object IDs into NetSuite ERP IDs
    const unsubParts = onSnapshot(collection(db, "Approved_Designs"), (snap) => {
        setLibraryParts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    return () => { unsubJobs(); unsubParts(); };
  }, [activeBrand]);

  const addLog = (msg, type = 'info') => {
      const time = new Date().toLocaleTimeString();
      setSyncLog(prev => [{ time, msg, type }, ...prev]);
  };

  // --- 🔐 NETSUITE AUTHENTICATION GENERATOR ---
  const generateNetSuiteHeader = (method, url) => {
      const oauth_nonce = Math.random().toString(36).substring(2, 15);
      const oauth_timestamp = Math.floor(Date.now() / 1000).toString();
      
      const baseString = `${method}&${encodeURIComponent(url)}&` + encodeURIComponent(
          `oauth_consumer_key=${NS_CONSUMER_KEY}&` +
          `oauth_nonce=${oauth_nonce}&` +
          `oauth_signature_method=HMAC-SHA256&` +
          `oauth_timestamp=${oauth_timestamp}&` +
          `oauth_token=${NS_TOKEN_ID}&` +
          `oauth_version=1.0`
      );
      
      const signingKey = `${encodeURIComponent(NS_CONSUMER_SECRET)}&${encodeURIComponent(NS_TOKEN_SECRET)}`;
      
      // Vercel-friendly CryptoJS implementation
      const hash = CryptoJS.HmacSHA256(baseString, signingKey);
      const oauth_signature = CryptoJS.enc.Base64.stringify(hash);
      
      return `OAuth realm="${NS_ACCOUNT}", oauth_consumer_key="${NS_CONSUMER_KEY}", oauth_token="${NS_TOKEN_ID}", oauth_nonce="${oauth_nonce}", oauth_timestamp="${oauth_timestamp}", oauth_signature_method="HMAC-SHA256", oauth_signature="${encodeURIComponent(oauth_signature)}", oauth_version="1.0"`;
  };

  // --- 🚀 THE PUSH ENGINE ---
  const handlePushToNetSuite = async (job) => {
      // 🛑 SAFETY CATCH: Ensure the job was actually configured in Tab 8
      if (!job.cpqData || !job.cpqData.configuration) {
          addLog(`❌ FAILED: Job ${job.jobId || job.id} has no CPQ data.`, 'error');
          alert("Hold up! This job hasn't been configured in the CPQ Engine (Tab 8) yet. There is no physical inventory attached to it.");
          return;
      }

      if (!window.confirm(`Are you sure you want to push Job ${job.jobId || job.id} to NetSuite? This will create a live Estimate record.`)) return;
      
      setIsPushing(true);
      addLog(`Initiating NetSuite Handshake for Job: ${job.jobId || job.id}`, 'info');

      try {
          // 1. Build the BOM Payload
          // We must translate the dynamic CPQ selections into actual NetSuite Items
          const lineItems = [];
          
          if (job.cpqData?.configuration) {
              for (const [stepId, partId] of Object.entries(job.cpqData.configuration)) {
                  const masterPart = libraryParts.find(p => p.id === partId);
                  const qty = job.cpqData.quantities?.[stepId] || 1;
                  
                  if (masterPart) {
                      const nsId = masterPart.legacyErpId || masterPart.itemId;
                      // Skip parts that haven't been mapped to an ERP ID yet to prevent API errors
                      if (nsId && nsId !== 'PENDING') {
                          lineItems.push({
                              item: { id: nsId }, 
                              quantity: qty,
                              rate: masterPart.manufacturingSpecs?.basePrice || 0,
                              description: `${masterPart.itemName} (Mapped from CPQ)`
                          });
                      } else {
                          addLog(`WARNING: Skipping "${masterPart.itemName}". No NetSuite ID mapped in Library.`, 'warn');
                      }
                  }
              }
          }

          if (lineItems.length === 0) {
              throw new Error("No valid items with NetSuite ERP IDs were found in this configuration.");
          }

          // Format Customer ID (Strip 'CUST-' prefix if necessary based on how NetSuite expects it)
          let nsCustomerId = job.customer?.id || "";
          if (nsCustomerId.startsWith('CUST-')) nsCustomerId = nsCustomerId.replace('CUST-', '');

          // 2. Construct the exact JSON payload for NetSuite
          const payload = {
              entity: { id: nsCustomerId || "12345" }, // Fallback to a test customer if missing
              memo: `[HQ APP CONFIG] ${job.jobName || ''} - ${job.sidemark || ''}`.trim(),
              item: {
                  items: [
                      // Top Level Description Anchor
                      {
                          item: { id: "123" }, // TODO: Update to your generic NetSuite "Configured Hardware" Non-Inventory Item ID
                          quantity: 1,
                          description: `=== CPQ BUILD: ${job.sidemark?.toUpperCase() || 'CUSTOM CONFIGURATION'} ===`
                      },
                      ...lineItems
                  ]
              }
          };

          addLog(`Payload constructed with ${lineItems.length} child items.`, 'success');

          // --- 🌐 THE CORS PROXY WORKAROUND FOR BROWSER TESTING ---
          const targetUrl = `https://${NS_ACCOUNT}.suitetalk.api.netsuite.com/services/rest/record/v1/estimate`;
          const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
          
          // NOTE: We generate the OAuth signature against the REAL NetSuite URL, not the proxy URL
          const authHeader = generateNetSuiteHeader('POST', targetUrl);

          addLog(`Transmitting to NetSuite via secure proxy...`, 'info');

          // 3. Fire the Request to NetSuite REST API
          const response = await fetch(proxyUrl, {
              method: 'POST',
              headers: {
                  'Authorization': authHeader,
                  'Content-Type': 'application/json',
                  'Prefer': 'return=representation' // Tells NetSuite to send back the created object
              },
              body: JSON.stringify(payload)
          });

          // 4. Handle Response
          if (!response.ok) {
              const errText = await response.text();
              throw new Error(`API Rejected [${response.status}]: ${errText}`);
          }

          const result = await response.json();
          addLog(`✅ Success! NetSuite Estimate Created (ID: ${result.id})`, 'success');

          // 5. Update Firebase with the NetSuite Tracking ID
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
                                        <td style={{ padding: '8px', borderBottom: '1px solid #eee', fontWeight: 'bold', color: '#007bff' }}>HEADER_NON_INV</td>
                                        <td style={{ padding: '8px', borderBottom: '1px solid #eee', fontStyle: 'italic' }}>=== CPQ BUILD: {activeJob.sidemark?.toUpperCase()} ===</td>
                                        <td style={{ padding: '8px', borderBottom: '1px solid #eee', textAlign: 'center' }}>1</td>
                                    </tr>
                                    {Object.entries(activeJob.cpqData?.configuration || {}).map(([stepId, partId], idx) => {
                                        const masterPart = libraryParts.find(p => p.id === partId);
                                        const qty = activeJob.cpqData?.quantities?.[stepId] || 1;
                                        const nsId = masterPart?.legacyErpId || masterPart?.itemId || 'UNMAPPED';
                                        
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