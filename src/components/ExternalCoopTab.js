import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, doc, updateDoc } from "firebase/firestore";

// Mock CRM Lookup (To map Customer IDs to Email Addresses)
const CRM_MOCK = {
    'CUST-882': { email: 'jane.smith@example.com', contact: 'Jane' },
    'CUST-310': { email: 'purchasing@harrisonproject.com', contact: 'Procurement Team' },
    'CUST-NEW': { email: 'client@example.com', contact: 'Client' }
};

const ExternalCoopTab = ({ currentUser, activeBrand }) => {
  const [activeSubTab, setActiveSubTab] = useState('CUSTOMERS'); 
  const [inceptionJobs, setInceptionJobs] = useState([]);
  const [configuredJobs, setConfiguredJobs] = useState([]);
  const [debugStats, setDebugStats] = useState({ total: 0, brandMatch: 0, inception: 0, configured: 0 });

  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [activeModalJob, setActiveModalJob] = useState(null);
  const [activeAssembly, setActiveAssembly] = useState(null);
  const [activeRevisionId, setActiveRevisionId] = useState(null);
  const [isAddingCallout, setIsAddingCallout] = useState(false);
  const [activeCalloutId, setActiveCalloutId] = useState(null);
  const svgRef = useRef(null);

  // 1. LIVE FIREBASE LISTENER
  useEffect(() => {
      if (!activeBrand) return;
      const unsub = onSnapshot(collection(db, "jobs"), (snapshot) => {
          const allJobs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
          const brandJobs = allJobs.filter(j => j.brandId === activeBrand);
          const inceptions = brandJobs.filter(j => j.status === 'INCEPTION');
          const configured = brandJobs.filter(j => j.status === 'CONFIGURED');
          
          setDebugStats({ total: allJobs.length, brandMatch: brandJobs.length, inception: inceptions.length, configured: configured.length });
          setInceptionJobs(inceptions);
          setConfiguredJobs(configured);
      });
      return () => unsub();
  }, [activeBrand]);

  // 2. LIVE FIREBASE LISTENER: Linked Assembly
  useEffect(() => {
      if (!activeModalJob?.linkedAssemblyId) { setActiveAssembly(null); return; }
      const unsub = onSnapshot(doc(db, "Approved_Designs", activeModalJob.linkedAssemblyId), (docSnap) => {
          if (docSnap.exists()) {
              const asmData = { id: docSnap.id, ...docSnap.data() };
              setActiveAssembly(asmData);
              const revs = asmData.revisions || (asmData.finalImageUrl ? [{ id: 'INITIAL', name: 'Initial Design', url: asmData.finalImageUrl }] : []);
              if (revs.length > 0 && !activeRevisionId) setActiveRevisionId(revs[revs.length - 1].id);
          }
      });
      return () => unsub();
  }, [activeModalJob, activeRevisionId]);

  // --- ACTION HANDLERS ---
  const handleEditJob = (job) => alert(`Loading ${job.jobId || job.id} into Global Context...\n\nRouting operator back to CPQ / Vision Tabs to configure physical inventory.`);
  
  const handleApproveJob = async (jobId) => {
      if(window.confirm(`Approve ${jobId}?\n\nThis will lock the configuration and move it to the Tab 12 (ERP) dispatch pipeline.`)) {
          try { await updateDoc(doc(db, "jobs", jobId), { status: 'APPROVED' }); } 
          catch (err) { console.error("Failed to approve job:", err); }
      }
  };

  const handleClearFilters = () => { setSearchQuery(''); setStartDate(''); setEndDate(''); };

  // --- 📧 PDF GENERATION & EMAIL DRAFTING LOGIC ---
  const handleEmailQuote = (job) => {
      // 1. Look up client email from mock CRM
      const clientData = CRM_MOCK[job.customer?.id] || { email: 'client@example.com', contact: 'Valued Client' };
      
      // 2. Draft the Email Payload
      const subject = encodeURIComponent(`Your Custom Hardware Quote: ${job.sidemark} (${job.jobId})`);
      const body = encodeURIComponent(`Hi ${clientData.contact},\n\nPlease find attached your finalized quotation for the ${job.sidemark} project.\n\nTotal: $${job.cpqData?.totalPrice?.toFixed(2) || '0.00'}\nFinish: ${job.cpqData?.finish || 'Standard'}\n\nPlease review the attached PDF and reply to this email to approve the design for production.\n\nBest Regards,\nThe ${activeBrand.toUpperCase()} Team`);

      // 3. Generate the PDF Document via Print Window
      const printWindow = window.open('', '_blank', 'width=800,height=900');
      const html = `
        <html>
          <head>
            <title>Quote_${job.jobId}</title>
            <style>
              body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 40px; color: #333; max-width: 800px; margin: 0 auto; }
              .header { display: flex; justify-content: space-between; border-bottom: 3px solid #000; padding-bottom: 20px; margin-bottom: 30px; }
              .brand { font-size: 28px; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; }
              .doc-type { font-size: 24px; color: #666; text-transform: uppercase; }
              .meta-grid { display: flex; justify-content: space-between; margin-bottom: 40px; background: #f8f9fa; padding: 20px; border-radius: 5px; }
              .meta-col { display: flex; flex-direction: column; gap: 8px; }
              .label { font-size: 12px; font-weight: bold; color: #888; text-transform: uppercase; }
              .val { font-size: 16px; font-weight: bold; }
              .specs { margin-bottom: 40px; border: 1px solid #ddd; }
              .spec-header { background: #000; color: #fff; padding: 10px 15px; font-weight: bold; }
              .spec-row { display: flex; justify-content: space-between; padding: 12px 15px; border-bottom: 1px solid #eee; }
              .total-row { display: flex; justify-content: space-between; padding: 20px 15px; background: #eef5eb; border-top: 2px solid #28a745; font-size: 20px; font-weight: bold; color: #1e7e34; }
              .footer { margin-top: 50px; font-size: 12px; color: #999; text-align: center; border-top: 1px solid #eee; padding-top: 20px; }
            </style>
          </head>
          <body>
            <div class="header">
              <div class="brand">${activeBrand}</div>
              <div class="doc-type">OFFICIAL QUOTATION</div>
            </div>
            
            <div class="meta-grid">
              <div class="meta-col">
                <div><span class="label">Client:</span><br/><span class="val">${job.customer?.name || 'N/A'}</span></div>
                <div><span class="label">Sidemark:</span><br/><span class="val">${job.sidemark || 'N/A'}</span></div>
              </div>
              <div class="meta-col">
                <div><span class="label">Quote #:</span><br/><span class="val">${job.jobId}</span></div>
                <div><span class="label">Date:</span><br/><span class="val">${job.dateSaved || new Date().toLocaleDateString()}</span></div>
              </div>
            </div>

            <div class="specs">
              <div class="spec-header">HARDWARE SPECIFICATIONS</div>
              <div class="spec-row"><span>Master Assembly</span><span>${job.jobName || 'Custom Drapery Hardware'}</span></div>
              <div class="spec-row"><span>Plating / Finish</span><span>${job.cpqData?.finish || 'N/A'}</span></div>
              <div class="spec-row"><span>Pole Diameter</span><span>${job.cpqData?.dimensions?.diameter || 'N/A'}" Tube</span></div>
              <div class="spec-row"><span>Pole Length</span><span>${job.cpqData?.dimensions?.poleLength || 'N/A'}"</span></div>
              <div class="spec-row"><span>Ring Quantity</span><span>${job.cpqData?.dimensions?.ringsQty || 0} Units</span></div>
              <div class="total-row"><span>TOTAL INVESTMENT</span><span>$${job.cpqData?.totalPrice?.toFixed(2) || '0.00'}</span></div>
            </div>

            <div class="footer">
              This quotation is valid for 30 days. Please review all dimensions and finishes carefully. Lead times begin upon receipt of approval and payment.
            </div>
            
            <script>
              window.onload = function() { window.print(); }
            </script>
          </body>
        </html>
      `;
      printWindow.document.write(html);
      printWindow.document.close();

      // 4. Open the local mail client (Wait 1 second so the browser doesn't block the print dialog)
      setTimeout(() => {
          window.location.href = `mailto:${clientData.email}?subject=${subject}&body=${body}`;
      }, 1000);
  };

  // --- SPATIAL CALLOUT LOGIC ---
  const handleSvgClick = async (e) => {
      if (!isAddingCallout || !activeRevisionId || !activeAssembly) { setActiveCalloutId(null); return; }
      const svg = svgRef.current;
      if (!svg) return;
      const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());
      const newCallout = { id: Date.now().toString(), revisionId: activeRevisionId, x: svgP.x, y: svgP.y, user: `${currentUser} (External Note)`, text: '', time: new Date().toLocaleTimeString() };
      const updatedCallouts = [...(activeAssembly.spatialCallouts || []), newCallout];
      setActiveAssembly(prev => ({ ...prev, spatialCallouts: updatedCallouts })); setActiveCalloutId(newCallout.id); setIsAddingCallout(false);
      try { await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { spatialCallouts: updatedCallouts }); } catch (err) { console.error(err); }
  };
  const handleLocalTextChange = (id, newText) => { setActiveAssembly(prev => ({ ...prev, spatialCallouts: (activeAssembly.spatialCallouts || []).map(c => c.id === id ? { ...c, text: newText } : c) })); };
  const saveCalloutTextToFirebase = async () => { try { await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { spatialCallouts: activeAssembly.spatialCallouts }); } catch (err) { console.error(err); } };
  const removeCallout = async (id) => { if(!window.confirm("Delete this external note?")) return; const updatedCallouts = (activeAssembly.spatialCallouts || []).filter(c => c.id !== id); try { await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { spatialCallouts: updatedCallouts }); } catch (err) { console.error(err); } };

  // --- FILTER ENGINE ---
  const filterByActiveTab = (job) => { if (activeSubTab === 'CUSTOMERS') return !!job.clientName || !!job.customer; if (activeSubTab === 'VENDORS') return !!job.vendorName; return true; };
  const filteredInception = inceptionJobs.filter(job => filterByActiveTab(job)).filter(job => { const q = searchQuery.toLowerCase(); const entity = job.clientName || job.vendorName || ''; return (!q || job.id.toLowerCase().includes(q) || entity.toLowerCase().includes(q) || (job.note && job.note.toLowerCase().includes(q))) && (!startDate || job.date >= startDate) && (!endDate || job.date <= endDate); });
  const filteredConfigured = configuredJobs.filter(job => filterByActiveTab(job)).filter(job => { const q = searchQuery.toLowerCase(); const entity = job.customer?.name || ''; return (!q || (job.jobId || job.id).toLowerCase().includes(q) || entity.toLowerCase().includes(q) || (job.sidemark && job.sidemark.toLowerCase().includes(q))) && (!startDate || job.dateSaved >= startDate) && (!endDate || job.dateSaved <= endDate); });

  const activeRevisions = activeAssembly?.revisions || (activeAssembly?.finalImageUrl ? [{ id: 'INITIAL', name: 'Initial Design', url: activeAssembly.finalImageUrl }] : []);
  const currentRevisionObj = activeRevisions.find(r => r.id === activeRevisionId) || activeRevisions[0];
  const filteredCallouts = (activeAssembly?.spatialCallouts || []).filter(c => (c.revisionId === activeRevisionId || (!c.revisionId && activeRevisionId === 'INITIAL')) && c.user && c.user.includes('(External Note)'));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', fontFamily: 'monospace', backgroundColor: '#e5e5e5', minHeight: '100vh' }}>
      
      <div style={{ background: '#fff3cd', border: '2px solid #856404', padding: '10px', color: '#856404', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
          <span>🔍 DATA RADAR:</span><span>TOTAL JOBS IN DB: {debugStats.total}</span><span>MATCHING ACTIVE BRAND ({activeBrand}): {debugStats.brandMatch}</span><span>INCEPTION STATUS: {debugStats.inception}</span><span style={{ color: '#28a745' }}>CONFIGURED STATUS: {debugStats.configured}</span>
      </div>

      <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '5px 5px 0 #000' }}>
        <div><h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.4rem', color: '#007bff' }}>10. External Coop</h2><span style={{ fontSize: '0.7rem', color: '#666' }}>CLIENT & VENDOR PRESENTATION PORTAL</span></div>
        <div style={{ display: 'flex', gap: '10px', background: '#eee', padding: '5px', border: '2px solid #000' }}>
          <button onClick={() => setActiveSubTab('CUSTOMERS')} style={{ padding: '10px 30px', background: activeSubTab === 'CUSTOMERS' ? '#000' : 'transparent', color: activeSubTab === 'CUSTOMERS' ? '#fff' : '#666', fontWeight: 'bold', border: 'none', cursor: 'pointer', fontSize: '0.9rem' }}>👥 CUSTOMERS</button>
          <button onClick={() => setActiveSubTab('VENDORS')} style={{ padding: '10px 30px', background: activeSubTab === 'VENDORS' ? '#000' : 'transparent', color: activeSubTab === 'VENDORS' ? '#fff' : '#666', fontWeight: 'bold', border: 'none', cursor: 'pointer', fontSize: '0.9rem' }}>🏢 VENDORS</button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        
        <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', gap: '20px', alignItems: 'flex-end', boxShadow: '4px 4px 0 rgba(0,0,0,0.1)' }}>
           <div style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: '5px' }}><label style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#007bff' }}>OMNI-SEARCH (ID, ENTITY, NOTES):</label><input type="text" placeholder={`Search ${activeSubTab.toLowerCase()} jobs...`} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ padding: '10px', fontSize: '1rem', border: '2px solid #ccc', outline: 'none' }} /></div>
           <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '5px' }}><label style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#666' }}>START DATE:</label><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ padding: '10px', fontSize: '1rem', border: '2px solid #ccc', outline: 'none' }} /></div>
           <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '5px' }}><label style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#666' }}>END DATE:</label><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ padding: '10px', fontSize: '1rem', border: '2px solid #ccc', outline: 'none' }} /></div>
           <button onClick={handleClearFilters} disabled={!searchQuery && !startDate && !endDate} style={{ padding: '12px 20px', background: '#f8f9fa', border: '2px solid #ccc', color: '#333', fontWeight: 'bold', cursor: (!searchQuery && !startDate && !endDate) ? 'not-allowed' : 'pointer', opacity: (!searchQuery && !startDate && !endDate) ? 0.5 : 1 }}>✖ CLEAR</button>
        </div>

        <div style={{ display: 'flex', gap: '25px', alignItems: 'flex-start' }}>
          
          <div style={{ flex: 1, background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '8px 8px 0 rgba(0,0,0,0.1)' }}>
            <div style={{ padding: '12px 15px', background: '#e9ecef', borderBottom: '2px solid #000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>📋 PRESENTATION QUEUE ({filteredInception.length})</span></div>
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px', background: '#f8f9fa', minHeight: '500px', maxHeight: '700px', overflowY: 'auto' }}>
              {filteredInception.length === 0 && <div style={{ textAlign: 'center', color: '#999', marginTop: '20px', fontStyle: 'italic' }}>No inception jobs found.</div>}
              {filteredInception.map(job => (
                 <div key={job.id} style={{ background: '#fff', border: '1px solid #ccc', borderLeft: '4px solid #17a2b8', padding: '15px', display: 'flex', flexDirection: 'column', gap: '10px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}><span style={{ fontWeight: 'bold', fontSize: '1rem', color: '#17a2b8' }}>{job.clientName || job.vendorName}</span><span style={{ fontSize: '0.7rem', color: '#888', fontWeight: 'bold' }}>{job.date || "Just now"}</span></div>
                    <div style={{ fontSize: '0.8rem', color: '#333' }}><strong>ID:</strong> {job.jobId || job.id}</div>
                    <div style={{ fontSize: '0.8rem', color: '#555', fontStyle: 'italic', background: '#f4f4f4', padding: '5px' }}>"{job.note}"</div>
                    <div style={{ display: 'flex', gap: '10px', borderTop: '1px dotted #eee', paddingTop: '10px', marginTop: '5px' }}>
                        <button onClick={() => setActiveModalJob(job)} style={{ flex: 1, padding: '8px 10px', background: '#000', color: '#fff', border: 'none', fontSize: '0.75rem', fontWeight: 'bold', cursor: 'pointer' }}>💬 OPEN INCEPTION WINDOW</button>
                        <button onClick={() => handleEditJob(job)} style={{ padding: '8px 10px', background: '#fff', border: '1px solid #007bff', color: '#007bff', fontSize: '0.75rem', fontWeight: 'bold', cursor: 'pointer' }}>⚙️ START CPQ</button>
                    </div>
                 </div>
              ))}
            </div>
          </div>

          <div style={{ flex: 1.2, background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '8px 8px 0 #000' }}>
            <div style={{ padding: '12px 15px', background: '#28a745', color: '#fff', borderBottom: '2px solid #000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>⚙️ FULLY CONFIGURED QUOTES ({filteredConfigured.length})</span>
              <span style={{ fontSize: '0.8rem', fontWeight: 'bold', background: '#1e7e34', padding: '4px 8px', borderRadius: '4px' }}>PENDING APPROVAL</span>
            </div>
            
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px', background: '#eef5eb', minHeight: '500px', maxHeight: '700px', overflowY: 'auto' }}>
              {filteredConfigured.length === 0 && <div style={{ textAlign: 'center', color: '#7ea97e', marginTop: '20px', fontStyle: 'italic' }}>No configured jobs waiting.</div>}
              {filteredConfigured.map(job => (
                 <div key={job.id} style={{ background: '#fff', border: '2px solid #28a745', padding: '0', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
                    <div style={{ padding: '10px 15px', background: '#f8f9fa', borderBottom: '1px solid #ddd', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'baseline' }}><span style={{ fontSize: '1rem', fontWeight: 'bold', color: '#000' }}>{job.customer?.name || "Unknown"}</span><span style={{ fontSize: '0.65rem', color: '#666', background: '#e2e3e5', padding: '2px 5px', borderRadius: '3px' }}>ID: {job.jobId || job.id}</span></div>
                        <span style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#28a745' }}>${job.cpqData?.totalPrice?.toFixed(2) || '0.00'}</span>
                    </div>
                    <div style={{ padding: '15px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#666' }}>SIDEMARK:</span><span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#000' }}>{job.sidemark || 'N/A'}</span></div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#666' }}>DATE SAVED:</span><span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#000' }}>{job.dateSaved || job.date || 'Unknown'}</span></div>
                    </div>
                    
                    {/* --- ACTION BUTTONS (UPDATED WITH EMAIL) --- */}
                    <div style={{ padding: '10px', background: '#f1f1f1', borderTop: '1px solid #ddd', display: 'flex', gap: '10px' }}>
                        <button onClick={() => handleEditJob(job)} style={{ flex: 1, padding: '10px', background: '#fff', border: '2px solid #007bff', color: '#007bff', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.75rem' }}>✏️ EDIT</button>
                        <button onClick={() => handleEmailQuote(job)} style={{ flex: 1.5, padding: '10px', background: '#17a2b8', border: '2px solid #117a8b', color: '#fff', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.75rem' }}>📧 EMAIL QUOTE</button>
                        <button onClick={() => handleApproveJob(job.id)} style={{ flex: 1.5, padding: '10px', background: '#28a745', border: '2px solid #1e7e34', color: '#fff', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.75rem' }}>✅ APPROVE</button>
                    </div>
                 </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {activeModalJob && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
          <div style={{ background: '#e5e5e5', border: '4px solid #000', width: '90%', maxWidth: '1200px', height: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '20px 20px 0 #000' }}>
            <div style={{ padding: '15px 20px', background: '#17a2b8', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000' }}>
               <div><h3 style={{ margin: 0, fontSize: '1.4rem', textTransform: 'uppercase' }}>EXTERNAL INCEPTION PORTAL</h3><span style={{ fontSize: '0.8rem' }}>Presenting to: <strong>{activeModalJob.clientName || activeModalJob.vendorName}</strong> | Ref: {activeAssembly?.itemName || 'Loading...'}</span></div>
               <button onClick={() => setActiveModalJob(null)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '2rem', cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ flex: 1, padding: '20px', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {!activeAssembly ? ( <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', color: '#666', fontSize: '1.2rem' }}>Loading Master Assembly Data...</div> ) : (
                    <div style={{ border: '2px solid #000', background: '#fff', display: 'flex', flexDirection: 'column', flex: 1 }}>
                        <div style={{ padding: '10px 15px', background: '#000', color: '#fff', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                                <span>📍 EXTERNAL SPATIAL REVIEW</span>
                                {activeRevisions.length > 0 && <select value={activeRevisionId || ''} onChange={(e) => setActiveRevisionId(e.target.value)} style={{ padding: '4px', fontSize: '0.75rem', fontWeight: 'bold', color: '#000', outline: 'none' }}>{activeRevisions.map(rev => <option key={rev.id} value={rev.id}>{rev.name}</option>)}</select>}
                            </div>
                            <button onClick={() => setIsAddingCallout(!isAddingCallout)} disabled={!currentRevisionObj?.url} style={{ padding: '6px 12px', background: isAddingCallout ? '#fff' : '#17a2b8', color: isAddingCallout ? '#17a2b8' : '#fff', border: 'none', fontWeight: 'bold', fontSize: '0.75rem', cursor: currentRevisionObj?.url ? 'pointer' : 'not-allowed' }}>{isAddingCallout ? 'CANCEL CALLOUT' : '+ DROP PIN & COMMENT'}</button>
                        </div>
                        <div style={{ position: 'relative', background: '#e9ecef', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: isAddingCallout ? 'crosshair' : 'default', overflow: 'hidden' }}>
                            {!currentRevisionObj?.url ? ( <div style={{ color: '#999', fontStyle: 'italic' }}>No images available for presentation yet.</div> ) : (
                                <svg ref={svgRef} onClick={handleSvgClick} viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block' }}>
                                    <image href={currentRevisionObj.url} x="0" y="0" width="1000" height="600" preserveAspectRatio="xMidYMid meet" />
                                    {filteredCallouts.map(callout => {
                                        const isActive = activeCalloutId === callout.id; const pinColor = '#17a2b8'; 
                                        return (
                                            <g key={callout.id} onClick={(e) => { e.stopPropagation(); setActiveCalloutId(callout.id); }} style={{ cursor: 'pointer' }}>
                                                <line x1={callout.x} y1={callout.y} x2={callout.x + 30} y2={callout.y - 40} stroke={isActive ? '#007bff' : pinColor} strokeWidth="2" />
                                                <circle cx={callout.x} cy={callout.y} r="6" fill={isActive ? '#007bff' : pinColor} stroke="#fff" strokeWidth="2" />
                                                <foreignObject x={callout.x + 30} y={callout.y - 80} width="220" height="100" style={{ overflow: 'visible' }}>
                                                    <div style={{ background: '#fff', border: `2px solid ${isActive ? '#007bff' : pinColor}`, padding: '5px', boxShadow: '2px 2px 5px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column' }}>
                                                        <div style={{ fontSize: '0.6rem', fontWeight: 'bold', color: '#666', borderBottom: '1px solid #eee', marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#17a2b8' }}>{callout.user.replace(' (External Note)', '')}</span>{isActive && <button onClick={() => removeCallout(callout.id)} style={{ background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', padding: 0 }}>✖</button>}</div>
                                                        {isActive ? <textarea autoFocus placeholder="Type note here..." value={callout.text} onChange={(e) => handleLocalTextChange(callout.id, e.target.value)} onBlur={saveCalloutTextToFirebase} style={{ width: '100%', fontSize: '0.75rem', border: 'none', outline: 'none', resize: 'none', minHeight: '60px', fontFamily: 'monospace' }} /> : <div style={{ fontSize: '0.75rem', color: '#000', wordWrap: 'break-word', whiteSpace: 'pre-wrap', minHeight: '20px' }}>{callout.text || <span style={{color:'#ccc', fontStyle:'italic'}}>Empty Note</span>}</div>}
                                                    </div>
                                                </foreignObject>
                                            </g>
                                        );
                                    })}
                                </svg>
                            )}
                        </div>
                    </div>
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExternalCoopTab;