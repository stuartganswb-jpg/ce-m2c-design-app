import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, doc, setDoc, serverTimestamp, query, where } from "firebase/firestore";

const CPQTab = ({ currentUser, activeBrand }) => {
  // --- LIVE FIREBASE STATE ---
  const [liveAssemblies, setLiveAssemblies] = useState([]);
  const [liveCustomers, setLiveCustomers] = useState([]); // Will pull from 'customers' later, using a simple list for now

  // --- WORKFLOW STATE ---
  const [productType, setProductType] = useState(''); // E.g., 'DRAPERY', 'LIGHTING'
  const [activeAssemblyId, setActiveAssemblyId] = useState('');
  const [activeAssembly, setActiveAssembly] = useState(null);
  
  // --- CONFIGURATION STATE ---
  const [config, setConfig] = useState({
    finish: '',
    poleLength: 80,
    diameter: 1.0,
    bracketStyle: 'FLUSH',
    finialStyle: 'END_CAP',
    ringsQty: 14
  });

  // --- JOB ASSIGNMENT STATE ---
  const [jobData, setJobData] = useState({
    customerId: '',
    jobName: '',
    sidemark: ''
  });

  // --- CALCULATED STATE ---
  const [totalPrice, setTotalPrice] = useState(0);
  const [isLinked, setIsLinked] = useState(false);

  // 1. Fetch Live Assemblies from Firebase
  useEffect(() => {
    if (!activeBrand) return;
    // Fetching the Master Assemblies we created on Tab 1
    const q = query(collection(db, "Approved_Designs"), where("brandId", "==", activeBrand), where("partClass", "==", "Assembly"));
    const unsub = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setLiveAssemblies(docs);
    });
    return () => unsub();
  }, [activeBrand]);

  // 2. Fetch Live Customers (Placeholder until CRM is fully fleshed out)
  useEffect(() => {
    // In the future, this queries the 'customers' collection. 
    // For testing the pipeline, we provide quick mock selections.
    setLiveCustomers([
      { id: 'CUST-882', name: 'Smith Residence' },
      { id: 'CUST-310', name: 'The Harrison Project' },
      { id: 'CUST-NEW', name: '➕ ADD NEW CUSTOMER...' }
    ]);
  }, []);

  // Update active assembly when selection changes
  useEffect(() => {
      if (activeAssemblyId) {
          const asm = liveAssemblies.find(a => a.id === activeAssemblyId);
          setActiveAssembly(asm);
          // Set default finish if applicable
          if (asm && !config.finish) {
              setConfig(prev => ({ ...prev, finish: 'Matte Brass' })); // Default fallback
          }
      } else {
          setActiveAssembly(null);
      }
  }, [activeAssemblyId, liveAssemblies]);

  // Recalculate live price
  useEffect(() => {
      let base = 0;
      if (activeAssembly) {
          // Add up base prices of sub-assemblies (Render Groups)
          if (activeAssembly.subAssemblies) {
              base += activeAssembly.subAssemblies.reduce((acc, sub) => acc + (parseFloat(sub.basePrice) || 0), 0);
          }
      }
      
      // Dynamic dimensional pricing
      base += (config.poleLength * 2.5); // $2.50 per inch
      base += (config.ringsQty * 12);    // $12 per ring
      setTotalPrice(base);
  }, [activeAssembly, config]);

  // --- HANDLERS ---
  const handleClearJob = () => {
      if (window.confirm("⚠️ WARNING: This will delete the current working job and clear all selections. Are you sure you want to start over?")) {
          setProductType('');
          setActiveAssemblyId('');
          setConfig({ finish: '', poleLength: 80, diameter: 1.0, bracketStyle: 'FLUSH', finialStyle: 'END_CAP', ringsQty: 14 });
          setJobData({ customerId: '', jobName: '', sidemark: '' });
          setIsLinked(false);
      }
  };

  const handlePushToVisual = () => {
      if (!activeAssemblyId) return alert("Please select a product before visualizing.");
      setIsLinked(true);
      alert("🚀 Pushing parameters to global context...\n\nSwitch to the 'Client Vision' tab to see the live rendering with these dimensions.");
  };

  const handleSaveToCoop = async () => {
      if (!jobData.customerId || !jobData.sidemark) {
          return alert("❌ Missing Data: Please select a Customer and enter a Sidemark before saving the job.");
      }

      const newJobId = `JOB-${Math.floor(1000 + Math.random() * 9000)}`;
      const customerName = liveCustomers.find(c => c.id === jobData.customerId)?.name || "Unknown";

      // The Unified JSON Payload
      const payload = {
          jobId: newJobId,
          brandId: activeBrand,
          status: 'CONFIGURED', // Sends it to the right-side of Tab 10
          customer: { id: jobData.customerId, name: customerName },
          jobName: jobData.jobName,
          sidemark: jobData.sidemark,
          linkedAssemblyId: activeAssembly?.id || null,
          cpqData: {
              totalPrice: totalPrice,
              finish: config.finish,
              dimensions: {
                  poleLength: config.poleLength,
                  diameter: config.diameter,
                  ringsQty: config.ringsQty
              }
          },
          dispatchStatus: { nsSalesOrder: false, fabrication: false, finishing: false, packing: false },
          dateSaved: new Date().toISOString().split('T')[0],
          createdAt: serverTimestamp(),
          author: currentUser
      };

      try {
          // Write directly to the Firebase 'jobs' collection
          await setDoc(doc(db, "jobs", newJobId), payload);
          alert(`💾 JOB SAVED SUCCESSFULLY!\n\nRouted to External Coop -> Configured Jobs.`);
          handleClearJob(); // Reset form for the next quote
      } catch (err) {
          console.error("Error saving job:", err);
          alert("Failed to save job to Firebase.");
      }
  };

  // Filter assemblies by the selected category (using collection logic as a proxy)
  const availableAssemblies = liveAssemblies.filter(a => {
      if (productType === 'DRAPERY') return a.collection !== 'LIGHTING'; // Example filter
      if (productType === 'LIGHTING') return a.collection === 'LIGHTING';
      return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', fontFamily: 'monospace', backgroundColor: '#e5e5e5', minHeight: '100vh' }}>
      
      {/* HEADER */}
      <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '5px 5px 0 #000' }}>
        <div>
          <h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.4rem', color: '#007bff' }}>8. Configure, Price, Quote (CPQ)</h2>
          <span style={{ fontSize: '0.7rem', color: '#666' }}>MASTER BUILDER & JOB ASSIGNMENT</span>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {isLinked && <span style={{ background: '#ffc107', color: '#000', padding: '5px 10px', fontWeight: 'bold', fontSize: '0.75rem', border: '1px solid #000' }}>⚡ ACTIVE JOB IN MEMORY</span>}
          <button onClick={handleClearJob} style={{ padding: '8px 15px', background: '#fff', color: '#d9534f', fontWeight: 'bold', border: '2px solid #d9534f', cursor: 'pointer' }}>🗑️ CLEAR WORKING JOB</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '25px', alignItems: 'stretch' }}>
        
        {/* ============================================================ */}
        {/* LEFT PANEL: WATERFALL CONFIGURATION                          */}
        {/* ============================================================ */}
        <div style={{ flex: 1.5, display: 'flex', flexDirection: 'column', gap: '15px' }}>
            
            {/* STEP 1: CATEGORY */}
            <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 rgba(0,0,0,0.1)' }}>
               <div style={{ padding: '10px', background: '#000', color: '#fff', fontWeight: 'bold', fontSize: '0.8rem' }}>STEP 1: PRODUCT CATEGORY</div>
               <div style={{ padding: '15px', display: 'flex', gap: '10px' }}>
                  <button onClick={() => {setProductType('DRAPERY'); setActiveAssemblyId('');}} style={{ flex: 1, padding: '15px', background: productType === 'DRAPERY' ? '#007bff' : '#f4f4f4', color: productType === 'DRAPERY' ? '#fff' : '#333', border: '2px solid #000', fontWeight: 'bold', cursor: 'pointer', fontSize: '1rem' }}>
                    🪟 DRAPERY HARDWARE
                  </button>
                  <button onClick={() => {setProductType('LIGHTING'); setActiveAssemblyId('');}} style={{ flex: 1, padding: '15px', background: productType === 'LIGHTING' ? '#007bff' : '#f4f4f4', color: productType === 'LIGHTING' ? '#fff' : '#333', border: '2px solid #000', fontWeight: 'bold', cursor: 'pointer', fontSize: '1rem' }}>
                    💡 LIGHTING
                  </button>
               </div>
            </div>

            {/* STEP 2: ASSEMBLY SELECTION */}
            <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', opacity: productType ? 1 : 0.4, pointerEvents: productType ? 'auto' : 'none', boxShadow: '5px 5px 0 rgba(0,0,0,0.1)' }}>
               <div style={{ padding: '10px', background: '#000', color: '#fff', fontWeight: 'bold', fontSize: '0.8rem' }}>STEP 2: SELECT APPROVED DESIGN</div>
               <div style={{ padding: '15px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px' }}>
                  {availableAssemblies.length === 0 ? (
                      <span style={{ fontSize: '0.8rem', color: '#999' }}>No approved assemblies found for this brand.</span>
                  ) : (
                      availableAssemblies.map(asm => (
                         <button key={asm.id} onClick={() => setActiveAssemblyId(asm.id)} style={{ padding: '10px', background: activeAssemblyId === asm.id ? '#28a745' : '#fff', color: activeAssemblyId === asm.id ? '#fff' : '#333', border: `2px solid ${activeAssemblyId === asm.id ? '#1e7e34' : '#ccc'}`, fontWeight: 'bold', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}>
                            <div style={{ fontSize: '0.7rem', opacity: 0.8 }}>{asm.legacyErpId !== "PENDING" ? asm.legacyErpId : asm.itemId}</div>
                            <div>{asm.itemName}</div>
                         </button>
                      ))
                  )}
               </div>
            </div>

            {/* STEP 3: PARAMETERS */}
            <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', opacity: activeAssemblyId ? 1 : 0.4, pointerEvents: activeAssemblyId ? 'auto' : 'none', boxShadow: '5px 5px 0 rgba(0,0,0,0.1)' }}>
               <div style={{ padding: '10px', background: '#000', color: '#fff', fontWeight: 'bold', fontSize: '0.8rem' }}>STEP 3: HARDWARE PARAMETERS</div>
               
               <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  
                  <div style={{ display: 'flex', gap: '15px' }}>
                     <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#666' }}>FINISH / PLATING:</label>
                        <select value={config.finish} onChange={e => setConfig({...config, finish: e.target.value})} style={{ width: '100%', padding: '10px', fontSize: '1rem', border: '1px solid #000', outline: 'none' }}>
                            <option value="Matte Brass">Matte Brass</option>
                            <option value="Unlacquered Brass">Unlacquered Brass</option>
                            <option value="Antique Bronze">Antique Bronze</option>
                            <option value="Champagne Metallic">Champagne Metallic</option>
                        </select>
                     </div>
                     <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#666' }}>POLE DIAMETER (IN):</label>
                        <select value={config.diameter} onChange={e => setConfig({...config, diameter: parseFloat(e.target.value)})} style={{ width: '100%', padding: '10px', fontSize: '1rem', border: '1px solid #000', outline: 'none' }}>
                            <option value={1.0}>1.0" Tube</option>
                            <option value={1.5}>1.5" Tube</option>
                            <option value={2.0}>2.0" Tube</option>
                        </select>
                     </div>
                  </div>

                  <div style={{ display: 'flex', gap: '15px' }}>
                     <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#666' }}>ORDERING LENGTH (IN):</label>
                        <input type="number" value={config.poleLength} onChange={e => setConfig({...config, poleLength: parseFloat(e.target.value) || 0})} style={{ width: '100%', padding: '10px', fontSize: '1rem', border: '1px solid #000', outline: 'none', boxSizing: 'border-box' }} />
                     </div>
                     <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#666' }}>RINGS QUANTITY:</label>
                        <input type="number" value={config.ringsQty} onChange={e => setConfig({...config, ringsQty: parseInt(e.target.value) || 0})} style={{ width: '100%', padding: '10px', fontSize: '1rem', border: '1px solid #000', outline: 'none', boxSizing: 'border-box' }} />
                     </div>
                  </div>

                  <div style={{ display: 'flex', gap: '15px', borderTop: '1px solid #eee', paddingTop: '15px' }}>
                     <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#666' }}>BRACKET STYLE:</label>
                        <select value={config.bracketStyle} onChange={e => setConfig({...config, bracketStyle: e.target.value})} style={{ width: '100%', padding: '10px', fontSize: '1rem', border: '1px solid #000', outline: 'none' }}>
                            <option value="FLUSH">Standard Flush Mount</option>
                            <option value="EXTENDED">Extended Projection</option>
                            <option value="DECORATIVE">Decorative Mid-Century</option>
                        </select>
                     </div>
                     <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#666' }}>END TREATMENT:</label>
                        <select value={config.finialStyle} onChange={e => setConfig({...config, finialStyle: e.target.value})} style={{ width: '100%', padding: '10px', fontSize: '1rem', border: '1px solid #000', outline: 'none' }}>
                            <option value="END_CAP">Standard End Cap</option>
                            <option value="BALL">Ball Finial</option>
                            <option value="RETURN">French Return (Bend)</option>
                        </select>
                     </div>
                  </div>

               </div>
            </div>
        </div>

        {/* ============================================================ */}
        {/* RIGHT PANEL: LIVE BOM, ASSIGNMENT, & ROUTING                 */}
        {/* ============================================================ */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '15px' }}>
            
            {/* LIVE BILL OF MATERIALS */}
            <div style={{ flex: 1, background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 #000' }}>
               <div style={{ padding: '15px', background: '#f8f9fa', borderBottom: '2px solid #000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 'bold', fontSize: '1.2rem', color: '#333' }}>LIVE B.O.M.</span>
                  <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#28a745' }}>${totalPrice.toFixed(2)}</span>
               </div>
               
               <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px', flex: 1, overflowY: 'auto' }}>
                  {!activeAssembly ? (
                      <div style={{ color: '#999', fontStyle: 'italic', textAlign: 'center', marginTop: '40px' }}>Awaiting assembly selection...</div>
                  ) : (
                      <>
                        <div style={{ fontWeight: 'bold', borderBottom: '2px solid #ccc', paddingBottom: '5px', marginBottom: '5px' }}>{activeAssembly.itemName} Base Components:</div>
                        {activeAssembly.subAssemblies?.map(sub => (
                            <div key={sub.id} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dotted #eee', paddingBottom: '5px', fontSize: '0.8rem' }}>
                                <span>{sub.name}</span>
                                <span>${parseFloat(sub.basePrice).toFixed(2)}</span>
                            </div>
                        ))}
                        
                        <div style={{ fontWeight: 'bold', borderBottom: '2px solid #ccc', paddingBottom: '5px', marginBottom: '5px', marginTop: '15px' }}>Dimensional Add-ons:</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dotted #ccc', paddingBottom: '5px', fontSize: '0.8rem' }}>
                            <span>{config.diameter}" Steel Tube ({config.poleLength}")</span>
                            <span>${(config.poleLength * 2.5).toFixed(2)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dotted #ccc', paddingBottom: '5px', fontSize: '0.8rem' }}>
                            <span>Flat-Edge Rings ({config.ringsQty}x)</span>
                            <span>${(config.ringsQty * 12).toFixed(2)}</span>
                        </div>
                      </>
                  )}
               </div>

               <div style={{ padding: '15px', borderTop: '2px solid #000', background: '#e9ecef' }}>
                   <button onClick={handlePushToVisual} disabled={!activeAssemblyId} style={{ width: '100%', padding: '15px', background: activeAssemblyId ? '#007bff' : '#ccc', color: '#fff', fontSize: '1.1rem', fontWeight: 'bold', border: '2px solid #000', cursor: activeAssemblyId ? 'pointer' : 'not-allowed', boxShadow: activeAssemblyId ? '3px 3px 0 #0056b3' : 'none', transition: 'all 0.1s' }}>
                      🚀 PUSH TO VISUAL SYSTEM
                   </button>
               </div>
            </div>

            {/* JOB ASSIGNMENT & SAVE BLOCK */}
            <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 #000' }}>
               <div style={{ padding: '10px 15px', background: '#000', color: '#fff', fontWeight: 'bold', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>💾</span> JOB ASSIGNMENT & ROUTING
               </div>
               
               <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  <div>
                      <label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#d9534f', display: 'block', marginBottom: '5px' }}>* SELECT CUSTOMER:</label>
                      <select value={jobData.customerId} onChange={e => setJobData({...jobData, customerId: e.target.value})} style={{ width: '100%', padding: '10px', fontSize: '1rem', border: '2px solid #d9534f', outline: 'none', background: '#fff9fa' }}>
                          <option value="">-- Choose Customer --</option>
                          {liveCustomers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                  </div>

                  <div style={{ display: 'flex', gap: '15px' }}>
                      <div style={{ flex: 1 }}>
                          <label style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#666', display: 'block', marginBottom: '5px' }}>JOB NAME (Optional):</label>
                          <input type="text" placeholder="e.g. Master Suite Reno" value={jobData.jobName} onChange={e => setJobData({...jobData, jobName: e.target.value})} style={{ width: '100%', padding: '10px', fontSize: '0.9rem', border: '1px solid #ccc', outline: 'none', boxSizing: 'border-box' }} />
                      </div>
                      <div style={{ flex: 1 }}>
                          <label style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#d9534f', display: 'block', marginBottom: '5px' }}>* SIDEMARK:</label>
                          <input type="text" placeholder="e.g. Guest Bedroom 1" value={jobData.sidemark} onChange={e => setJobData({...jobData, sidemark: e.target.value})} style={{ width: '100%', padding: '10px', fontSize: '0.9rem', border: '2px solid #d9534f', background: '#fff9fa', outline: 'none', boxSizing: 'border-box' }} />
                      </div>
                  </div>

                  <button onClick={handleSaveToCoop} disabled={!activeAssemblyId} style={{ width: '100%', padding: '15px', background: activeAssemblyId ? '#28a745' : '#ccc', color: '#fff', fontSize: '1.1rem', fontWeight: 'bold', border: '2px solid #1e7e34', cursor: activeAssemblyId ? 'pointer' : 'not-allowed', marginTop: '10px', boxShadow: activeAssemblyId ? '3px 3px 0 #1e7e34' : 'none' }}>
                      ✅ SAVE CONFIGURED JOB
                  </button>
                  <div style={{ textAlign: 'center', fontSize: '0.65rem', color: '#666' }}>
                       Saves payload to External Coop. Readies job for ERP Push.
                  </div>
               </div>
            </div>

        </div>
      </div>
    </div>
  );
};

export default CPQTab;