import React, { useState, useEffect, useRef } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, doc, updateDoc, setDoc } from "firebase/firestore";

// --- 🚀 NEW: INJECT PRINT CSS FOR PDF GENERATION ---
const printStyles = `
  @media print {
    body * { visibility: hidden; }
    #printable-document, #printable-document * { visibility: visible; }
    #printable-document { position: absolute; left: 0; top: 0; width: 100%; margin: 0; padding: 20px; box-sizing: border-box; }
    .no-print { display: none !important; }
  }
`;

const INITIAL_CRM_DATA = {};

const ExternalCoopTab = ({ currentUser, activeBrand }) => {
  const [activeSubTab, setActiveSubTab] = useState('CUSTOMERS'); 
  const [inceptionJobs, setInceptionJobs] = useState([]);
  const [configuredJobs, setConfiguredJobs] = useState([]);
  
  // 🚀 NEW: State for ALL jobs to populate CRM History
  const [allBrandJobs, setAllBrandJobs] = useState([]); 
  
  const [debugStats, setDebugStats] = useState({ total: 0, brandMatch: 0, inception: 0, configured: 0 });

  // CRM State
  const [crmData, setCrmData] = useState(INITIAL_CRM_DATA);
  const [crmSearchQuery, setCrmSearchQuery] = useState('');
  const [activeCrmRecord, setActiveCrmRecord] = useState(null);
  
  const [showNewCrmModal, setShowNewCrmModal] = useState(false);
  const [newCrmForm, setNewCrmForm] = useState({ name: '', email: '', contact: '', phone: '', terms: 'Net 30' });
  const [globalLists, setGlobalLists] = useState({ customers: [], vendors: [] });

  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [activeModalJob, setActiveModalJob] = useState(null);
  const [activeAssembly, setActiveAssembly] = useState(null);
  const [activeRevisionId, setActiveRevisionId] = useState(null);
  const [isAddingCallout, setIsAddingCallout] = useState(false);
  const [activeCalloutId, setActiveCalloutId] = useState(null);
  const svgRef = useRef(null);

  // FORMS & DOCUMENT STUDIO
  const [formTemplates, setFormTemplates] = useState({});
  const [brandLogos, setBrandLogos] = useState({});
  const [libraryParts, setLibraryParts] = useState([]);
  const [activeDocJob, setActiveDocJob] = useState(null);
  const [activeDocType, setActiveDocType] = useState('QUOTE'); // 'QUOTE' or 'FACTORY_ROUTER'
  const DOC_TYPES = ['QUOTE', 'SALES_ORDER', 'WORK_ORDER', 'PACKING_SLIP', 'INVOICE'];

  useEffect(() => {
    const styleSheet = document.createElement("style");
    styleSheet.innerText = printStyles;
    document.head.appendChild(styleSheet);
    return () => styleSheet.remove();
  }, []);

  // 1. LIVE FIREBASE LISTENER (Jobs)
  useEffect(() => {
      if (!activeBrand) return;
      const unsub = onSnapshot(collection(db, "jobs"), (snapshot) => {
          const allJobs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
          const brandJobs = allJobs.filter(j => j.brandId === activeBrand);
          
          setAllBrandJobs(brandJobs); // 🚀 Store all jobs for CRM History

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

  // 3. LIVE FIREBASE LISTENER: Forms, Logos, and Parts Dictionary
  useEffect(() => {
      if (!activeBrand) return;
      const unsubForms = onSnapshot(doc(db, "hq_config", "form_templates"), (snap) => {
          if (snap.exists()) setFormTemplates(snap.data());
      });
      const unsubLogos = onSnapshot(doc(db, "hq_config", "brand_logos"), (snap) => {
          if (snap.exists()) setBrandLogos(snap.data());
      });
      const unsubParts = onSnapshot(collection(db, "Approved_Designs"), (snap) => {
          setLibraryParts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      });
      return () => { unsubForms(); unsubLogos(); unsubParts(); };
  }, [activeBrand]);

  // 4. LIVE FIREBASE LISTENER: Dynamic CRM Sync
  useEffect(() => {
      const unsubCrm = onSnapshot(collection(db, "crm_records"), (snap) => {
          const dbRecords = {};
          snap.docs.forEach(d => dbRecords[d.id] = { id: d.id, ...d.data() });
          setCrmData({ ...INITIAL_CRM_DATA, ...dbRecords });
      });

      const unsubLists = onSnapshot(doc(db, "system", "master_lists"), (snap) => {
          if (snap.exists()) {
              const data = snap.data();
              setGlobalLists({ customers: data.customers || [], vendors: data.vendors || [] });
          }
      });

      return () => { unsubCrm(); unsubLists(); };
  }, []);

  const handleSaveNewCrm = async () => {
      if (!newCrmForm.name.trim()) return alert("Entity Name is required.");
      
      const isCust = activeSubTab === 'CUSTOMERS';
      const prefix = isCust ? 'CUST' : 'VEND';
      const newId = `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;

      const newRecord = {
          id: newId,
          type: isCust ? 'CUSTOMER' : 'VENDOR',
          name: newCrmForm.name.trim(),
          email: newCrmForm.email.trim(),
          contact: newCrmForm.contact.trim(),
          phone: newCrmForm.phone.trim(),
          terms: newCrmForm.terms || 'Net 30',
          ytd: 0, mtd: 0, openOrders: 0, notes: ''
      };

      try {
          await setDoc(doc(db, "crm_records", newId), newRecord);
          const listKey = isCust ? 'customers' : 'vendors';
          const updatedList = [...new Set([...(globalLists[listKey] || []), newId])];
          await setDoc(doc(db, "system", "master_lists"), { [listKey]: updatedList }, { merge: true });

          setShowNewCrmModal(false);
          setNewCrmForm({ name: '', email: '', contact: '', phone: '', terms: 'Net 30' });
          setCrmSearchQuery('');
          setActiveCrmRecord(newRecord);
          
      } catch (err) {
          console.error(err);
          alert("Failed to create the new CRM record.");
      }
  };

  const handleEditJob = (job) => alert(`Loading ${job.jobId || job.id} into Global Context...\n\nRouting operator back to CPQ / Vision Tabs to configure physical inventory.`);
  
  const handleApproveJob = async (jobId) => {
      if(window.confirm(`Approve ${jobId}?\n\nThis will lock the configuration and move it to the Tab 12 (ERP) dispatch pipeline.`)) {
          try { await updateDoc(doc(db, "jobs", jobId), { status: 'APPROVED' }); } 
          catch (err) { console.error("Failed to approve job:", err); }
      }
  };

  const handleClearFilters = () => { setSearchQuery(''); setStartDate(''); setEndDate(''); };

  const handleEmailQuote = (job) => {
      const clientData = crmData[job.customer?.id] || { email: 'client@example.com', contact: 'Valued Client' };
      const subject = encodeURIComponent(`Your Custom Hardware Quote: ${job.sidemark} (${job.jobId})`);
      const body = encodeURIComponent(`Hi ${clientData.contact},\n\nPlease find attached your finalized quotation for the ${job.sidemark} project.\n\nTotal: $${job.cpqData?.totalPrice?.toFixed(2) || '0.00'}\n\nPlease review the attached PDF and reply to this email to approve the design for production.\n\nBest Regards,\nThe ${activeBrand.toUpperCase()} Team`);

      setActiveDocJob(job);
      setActiveDocType('QUOTE');

      setTimeout(() => { window.location.href = `mailto:${clientData.email}?subject=${subject}&body=${body}`; }, 1000);
  };

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

  const filterByActiveTab = (job) => { if (activeSubTab === 'CUSTOMERS') return !!job.clientName || !!job.customer; if (activeSubTab === 'VENDORS') return !!job.vendorName; return true; };
  const filteredInception = inceptionJobs.filter(job => filterByActiveTab(job)).filter(job => { const q = searchQuery.toLowerCase(); const entity = job.clientName || job.vendorName || ''; return (!q || job.id.toLowerCase().includes(q) || entity.toLowerCase().includes(q) || (job.note && job.note.toLowerCase().includes(q))) && (!startDate || job.date >= startDate) && (!endDate || job.date <= endDate); });
  const filteredConfigured = configuredJobs.filter(job => filterByActiveTab(job)).filter(job => { const q = searchQuery.toLowerCase(); const entity = job.customer?.name || ''; return (!q || (job.jobId || job.id).toLowerCase().includes(q) || entity.toLowerCase().includes(q) || (job.sidemark && job.sidemark.toLowerCase().includes(q))) && (!startDate || job.dateSaved >= startDate) && (!endDate || job.dateSaved <= endDate); });

  const activeRevisions = activeAssembly?.revisions || (activeAssembly?.finalImageUrl ? [{ id: 'INITIAL', name: 'Initial Design', url: activeAssembly.finalImageUrl }] : []);
  const currentRevisionObj = activeRevisions.find(r => r.id === activeRevisionId) || activeRevisions[0];
  const filteredCallouts = (activeAssembly?.spatialCallouts || []).filter(c => (c.revisionId === activeRevisionId || (!c.revisionId && activeRevisionId === 'INITIAL')) && c.user && c.user.includes('(External Note)'));

  const targetCrmType = activeSubTab === 'CUSTOMERS' ? 'CUSTOMER' : 'VENDOR';
  const activeCrmList = Object.values(crmData).filter(r => r.type === targetCrmType);
  const crmSearchResults = crmSearchQuery ? activeCrmList.filter(r => r.name.toLowerCase().includes(crmSearchQuery.toLowerCase()) || r.id.toLowerCase().includes(crmSearchQuery.toLowerCase())) : [];
  const exactMatchExists = crmSearchResults.some(r => r.name.toLowerCase() === crmSearchQuery.toLowerCase());

  // 🚀 UPDATED CRM PIPELINE BUCKETS
  const getCrmActivePipeline = (id) => {
      const entityName = crmData[id]?.name || "";
      return [...inceptionJobs, ...configuredJobs].filter(j => 
          j.customer?.id === id || 
          (j.clientName && j.clientName.includes(entityName)) || 
          (j.vendorName && j.vendorName.includes(entityName))
      ).sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  };

  const getCrmArchivedPipeline = (id) => {
      const entityName = crmData[id]?.name || "";
      return allBrandJobs.filter(j => 
          j.status !== 'INCEPTION' && j.status !== 'CONFIGURED' && // Get everything that has moved on
          (j.customer?.id === id || (j.clientName && j.clientName.includes(entityName)) || (j.vendorName && j.vendorName.includes(entityName)))
      ).sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  };

  const getPartName = (partId) => {
      const part = libraryParts.find(p => p.id === partId);
      return part ? part.itemName : partId;
  };
  const activeTemplate = formTemplates[activeDocType === 'FACTORY_ROUTER' ? 'WORK_ORDER' : activeDocType] || { header: '', footer: '', terms: '' };
  const currentLogo = brandLogos[activeBrand] || null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', fontFamily: 'monospace', backgroundColor: '#e5e5e5', minHeight: '100vh' }}>
      
      <div className="no-print" style={{ background: '#fff3cd', border: '2px solid #856404', padding: '10px', color: '#856404', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
          <span>🔍 DATA RADAR:</span><span>TOTAL JOBS IN DB: {debugStats.total}</span><span>MATCHING ACTIVE BRAND ({activeBrand}): {debugStats.brandMatch}</span><span>INCEPTION STATUS: {debugStats.inception}</span><span style={{ color: '#28a745' }}>CONFIGURED STATUS: {debugStats.configured}</span>
      </div>

      <div className="no-print" style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '5px 5px 0 #000' }}>
        <div><h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.4rem', color: '#007bff' }}>10. External Coop</h2><span style={{ fontSize: '0.7rem', color: '#666' }}>CLIENT & VENDOR PRESENTATION PORTAL</span></div>
        <div style={{ display: 'flex', gap: '10px', background: '#eee', padding: '5px', border: '2px solid #000' }}>
          <button onClick={() => { setActiveSubTab('CUSTOMERS'); setCrmSearchQuery(''); }} style={{ padding: '10px 30px', background: activeSubTab === 'CUSTOMERS' ? '#000' : 'transparent', color: activeSubTab === 'CUSTOMERS' ? '#fff' : '#666', fontWeight: 'bold', border: 'none', cursor: 'pointer', fontSize: '0.9rem' }}>👥 CUSTOMERS</button>
          <button onClick={() => { setActiveSubTab('VENDORS'); setCrmSearchQuery(''); }} style={{ padding: '10px 30px', background: activeSubTab === 'VENDORS' ? '#000' : 'transparent', color: activeSubTab === 'VENDORS' ? '#fff' : '#666', fontWeight: 'bold', border: 'none', cursor: 'pointer', fontSize: '0.9rem' }}>🏢 VENDORS</button>
        </div>
      </div>

      <div className="no-print" style={{ background: '#f8f9fa', border: '2px solid #000', borderTop: 'none', padding: '15px', display: 'flex', alignItems: 'center', gap: '20px', boxShadow: '5px 5px 0 rgba(0,0,0,0.05)' }}>
          <strong style={{ color: activeSubTab === 'CUSTOMERS' ? '#007bff' : '#fd7e14', fontSize: '0.9rem', whiteSpace: 'nowrap' }}>🔍 {activeSubTab} CRM DIRECTORY:</strong>
          <div style={{ position: 'relative', flex: 1 }}>
              <input 
                  type="text" 
                  placeholder={`Search ${activeSubTab.toLowerCase()} by name or ID...`} 
                  value={crmSearchQuery} 
                  onChange={e => setCrmSearchQuery(e.target.value)} 
                  style={{ width: '100%', padding: '12px', fontSize: '1rem', border: `2px solid ${activeSubTab === 'CUSTOMERS' ? '#007bff' : '#fd7e14'}`, boxSizing: 'border-box', outline: 'none', fontWeight: 'bold' }} 
              />
              {crmSearchQuery && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, width: '100%', background: '#fff', border: '2px solid #000', borderTop: 'none', zIndex: 1000, maxHeight: '250px', overflowY: 'auto', boxShadow: '4px 4px 0 rgba(0,0,0,0.2)' }}>
                      
                      {crmSearchResults.map(record => (
                          <div key={record.id} onClick={() => { setActiveCrmRecord(record); setCrmSearchQuery(''); }} style={{ padding: '15px', borderBottom: '1px solid #eee', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} onMouseOver={(e) => e.currentTarget.style.background = '#f4f4f4'} onMouseOut={(e) => e.currentTarget.style.background = '#fff'}>
                              <span style={{ fontWeight: 'bold', fontSize: '1rem' }}>{record.name}</span>
                              <span style={{ fontSize: '0.75rem', color: '#fff', background: '#333', padding: '4px 8px', borderRadius: '3px' }}>{record.id}</span>
                          </div>
                      ))}

                      {!exactMatchExists && (
                          <div 
                              onClick={() => {
                                  setNewCrmForm(prev => ({ ...prev, name: crmSearchQuery }));
                                  setShowNewCrmModal(true);
                              }} 
                              style={{ padding: '15px', background: '#eafaf1', color: '#28a745', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', borderTop: '2px dashed #28a745' }}
                          >
                              <span style={{ fontSize: '1.2rem' }}>+</span> 
                              ADD AS NEW {targetCrmType}: "{crmSearchQuery}"
                          </div>
                      )}
                  </div>
              )}
          </div>
      </div>

      <div className="no-print" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        
        <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', gap: '20px', alignItems: 'flex-end', boxShadow: '4px 4px 0 rgba(0,0,0,0.1)' }}>
           <div style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: '5px' }}><label style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#007bff' }}>OMNI-SEARCH (ID, ENTITY, NOTES):</label><input type="text" placeholder={`Filter local ${activeSubTab.toLowerCase()} jobs...`} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ padding: '10px', fontSize: '1rem', border: '2px solid #ccc', outline: 'none' }} /></div>
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
                        <button onClick={() => setActiveModalJob(job)} style={{ flex: 1.5, padding: '8px 10px', background: '#000', color: '#fff', border: 'none', fontSize: '0.7rem', fontWeight: 'bold', cursor: 'pointer' }}>💬 OPEN INCEPTION WINDOW</button>
                        <button onClick={() => handleEditJob(job)} style={{ flex: 1, padding: '8px 10px', background: '#fff', border: '1px solid #007bff', color: '#007bff', fontSize: '0.7rem', fontWeight: 'bold', cursor: 'pointer' }}>⚙️ START CPQ</button>
                        <button onClick={() => { setActiveDocJob(job); setActiveDocType('QUOTE'); }} style={{ padding: '8px 10px', background: '#fff', border: '1px solid #6f42c1', color: '#6f42c1', fontSize: '0.7rem', fontWeight: 'bold', cursor: 'pointer' }}>📄 PDF DOC</button>
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
              {filteredConfigured.map(job => {
                 // 🚀 NEW: Check if this job has dimensional math attached
                 const hasDimensionalMath = job.cpqData?.dimensions && Object.keys(job.cpqData.dimensions).length > 0;

                 return (
                 <div key={job.id} style={{ background: '#fff', border: '2px solid #28a745', padding: '0', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
                    <div style={{ padding: '10px 15px', background: '#f8f9fa', borderBottom: '1px solid #ddd', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'baseline' }}><span style={{ fontSize: '1rem', fontWeight: 'bold', color: '#000' }}>{job.customer?.name || "Unknown"}</span><span style={{ fontSize: '0.65rem', color: '#666', background: '#e2e3e5', padding: '2px 5px', borderRadius: '3px' }}>ID: {job.jobId || job.id}</span></div>
                        <span style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#28a745' }}>${job.cpqData?.totalPrice?.toFixed(2) || '0.00'}</span>
                    </div>
                    <div style={{ padding: '15px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#666' }}>SIDEMARK:</span><span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#000' }}>{job.sidemark || 'N/A'}</span></div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#666' }}>DATE SAVED:</span><span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#000' }}>{job.dateSaved || job.date || 'Unknown'}</span></div>
                    </div>
                    
                    <div style={{ padding: '10px', background: '#f1f1f1', borderTop: '1px solid #ddd', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        <button onClick={() => handleEditJob(job)} style={{ flex: 1, padding: '8px', background: '#fff', border: '2px solid #007bff', color: '#007bff', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.7rem' }}>✏️ EDIT</button>
                        <button onClick={() => handleEmailQuote(job)} style={{ flex: 1.5, padding: '8px', background: '#17a2b8', border: '2px solid #117a8b', color: '#fff', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.7rem' }}>📧 EMAIL QUOTE</button>
                        <button onClick={() => handleApproveJob(job.id)} style={{ flex: 1.5, padding: '8px', background: '#28a745', border: '2px solid #1e7e34', color: '#fff', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.7rem' }}>✅ APPROVE</button>
                        
                        <div style={{ display: 'flex', gap: '5px', flex: 1.5 }}>
                            <button onClick={() => { setActiveDocJob(job); setActiveDocType('QUOTE'); }} style={{ flex: 1, padding: '8px', background: '#fff', border: '2px solid #6f42c1', color: '#6f42c1', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.7rem' }}>📄 QUOTE</button>
                            {/* 🚀 NEW: Render Factory Router Button if Math exists */}
                            {hasDimensionalMath && (
                                <button onClick={() => { setActiveDocJob(job); setActiveDocType('FACTORY_ROUTER'); }} style={{ flex: 1, padding: '8px', background: '#fff', border: '2px solid #e83e8c', color: '#e83e8c', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.7rem' }}>🏭 ROUTER</button>
                            )}
                        </div>
                    </div>
                 </div>
              )})}
            </div>
          </div>
        </div>
      </div>

      {showNewCrmModal && (
          <div className="no-print" style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 4000 }}>
              <div style={{ background: '#fff', border: '4px solid #000', width: '500px', display: 'flex', flexDirection: 'column', boxShadow: '20px 20px 0 #28a745' }}>
                  <div style={{ padding: '20px', background: '#28a745', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h2 style={{ margin: 0, fontSize: '1.2rem', textTransform: 'uppercase' }}>ADD NEW {targetCrmType}</h2>
                      <button onClick={() => setShowNewCrmModal(false)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.5rem', cursor: 'pointer' }}>×</button>
                  </div>
                  <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                      
                      <div>
                          <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>ENTITY NAME:</label>
                          <input value={newCrmForm.name} onChange={e => setNewCrmForm({...newCrmForm, name: e.target.value})} autoFocus style={{ width: '100%', padding: '10px', border: '2px solid #000', boxSizing: 'border-box', fontWeight: 'bold' }} />
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                          <div><label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>PRIMARY CONTACT:</label><input value={newCrmForm.contact} onChange={e => setNewCrmForm({...newCrmForm, contact: e.target.value})} style={{ width: '100%', padding: '10px', border: '1px solid #ccc', boxSizing: 'border-box' }} /></div>
                          <div><label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>PAYMENT TERMS:</label><input value={newCrmForm.terms} onChange={e => setNewCrmForm({...newCrmForm, terms: e.target.value})} placeholder="e.g. Net 30" style={{ width: '100%', padding: '10px', border: '1px solid #ccc', boxSizing: 'border-box' }} /></div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                          <div><label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>EMAIL ADDRESS:</label><input value={newCrmForm.email} onChange={e => setNewCrmForm({...newCrmForm, email: e.target.value})} style={{ width: '100%', padding: '10px', border: '1px solid #ccc', boxSizing: 'border-box' }} /></div>
                          <div><label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>PHONE NUMBER:</label><input value={newCrmForm.phone} onChange={e => setNewCrmForm({...newCrmForm, phone: e.target.value})} style={{ width: '100%', padding: '10px', border: '1px solid #ccc', boxSizing: 'border-box' }} /></div>
                      </div>

                      <div style={{ marginTop: '10px', background: '#eafaf1', border: '1px solid #28a745', padding: '10px', fontSize: '0.75rem', color: '#1e7e34', fontWeight: 'bold' }}>
                          ✓ Saving this record will automatically sync it to the Master Library mapping dropdowns.
                      </div>

                      <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                          <button onClick={handleSaveNewCrm} disabled={!newCrmForm.name.trim()} style={{ flex: 1, padding: '15px', background: newCrmForm.name.trim() ? '#28a745' : '#ccc', color: '#fff', fontWeight: 'bold', border: 'none', cursor: newCrmForm.name.trim() ? 'pointer' : 'not-allowed' }}>💾 SAVE {targetCrmType}</button>
                          <button onClick={() => setShowNewCrmModal(false)} style={{ padding: '15px 20px', background: '#eee', color: '#333', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>CANCEL</button>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* --- CRM VIEWER MODAL --- */}
      {activeCrmRecord && (
          <div className="no-print" style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000 }}>
              <div style={{ background: '#fff', border: '4px solid #000', width: '900px', height: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '20px 20px 0 #000' }}>
                  
                  <div style={{ padding: '20px', background: activeSubTab === 'CUSTOMERS' ? '#007bff' : '#fd7e14', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000' }}>
                      <div>
                          <h2 style={{ margin: 0, fontSize: '1.5rem', textTransform: 'uppercase' }}>{activeCrmRecord.name}</h2>
                          <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>{activeCrmRecord.type} ID: {activeCrmRecord.id}</span>
                      </div>
                      <button onClick={() => setActiveCrmRecord(null)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '2rem', cursor: 'pointer' }}>×</button>
                  </div>
                  
                  <div style={{ padding: '20px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px', background: '#f8f9fa' }}>
                      
                      {/* Financial Highlights */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '15px' }}>
                          <div style={{ background: '#fff', padding: '15px', border: '2px solid #000', textAlign: 'center', boxShadow: '4px 4px 0 rgba(0,0,0,0.1)' }}>
                              <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#666' }}>OPEN / PENDING QUOTES</div>
                              <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#17a2b8' }}>{activeCrmRecord.openOrders || 0}</div>
                          </div>
                          <div style={{ background: '#fff', padding: '15px', border: '2px solid #000', textAlign: 'center', boxShadow: '4px 4px 0 rgba(0,0,0,0.1)' }}>
                              <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#666' }}>INVOICED MTD</div>
                              <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#28a745' }}>${(activeCrmRecord.mtd || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</div>
                          </div>
                          <div style={{ background: '#fff', padding: '15px', border: '2px solid #000', textAlign: 'center', boxShadow: '4px 4px 0 rgba(0,0,0,0.1)' }}>
                              <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#666' }}>INVOICED YTD</div>
                              <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#28a745' }}>${(activeCrmRecord.ytd || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</div>
                          </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '20px', flex: 1 }}>
                          {/* Left Panel: Contact & Notes */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                              <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', boxShadow: '4px 4px 0 rgba(0,0,0,0.1)' }}>
                                  <h4 style={{ margin: '0 0 10px 0', borderBottom: '1px solid #eee', paddingBottom: '5px' }}>CONTACT PROFILE</h4>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.85rem' }}>
                                      <div><strong style={{ color: '#666' }}>POC:</strong> {activeCrmRecord.contact || 'N/A'}</div>
                                      <div><strong style={{ color: '#666' }}>EMAIL:</strong> {activeCrmRecord.email || 'N/A'}</div>
                                      <div><strong style={{ color: '#666' }}>PHONE:</strong> {activeCrmRecord.phone || 'N/A'}</div>
                                      <div><strong style={{ color: '#666' }}>TERMS:</strong> {activeCrmRecord.terms || 'N/A'}</div>
                                  </div>
                              </div>
                              <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', flex: 1, display: 'flex', flexDirection: 'column', boxShadow: '4px 4px 0 rgba(0,0,0,0.1)' }}>
                                  <h4 style={{ margin: '0 0 10px 0', borderBottom: '1px solid #eee', paddingBottom: '5px' }}>RELATIONSHIP NOTES</h4>
                                  <textarea 
                                      value={activeCrmRecord.notes || ''}
                                      onChange={(e) => {
                                          const val = e.target.value;
                                          setActiveCrmRecord(prev => ({ ...prev, notes: val }));
                                          updateDoc(doc(db, "crm_records", activeCrmRecord.id), { notes: val }).catch(()=>{});
                                      }}
                                      style={{ flex: 1, padding: '10px', border: '1px solid #ccc', outline: 'none', resize: 'none', fontFamily: 'monospace', fontSize: '0.85rem' }}
                                      placeholder="Add strategic notes, preferences, or warnings here..."
                                  />
                                  <div style={{ textAlign: 'right', marginTop: '10px' }}>
                                      <span style={{ fontSize: '0.65rem', color: '#28a745', fontWeight: 'bold' }}>✓ AUTOSAVED</span>
                                  </div>
                              </div>
                          </div>

                          {/* 🚀 REBUILT: Active & Archived CRM Pipeline */}
                          <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', flexDirection: 'column', boxShadow: '4px 4px 0 rgba(0,0,0,0.1)' }}>
                              
                              <h4 style={{ margin: '0 0 10px 0', borderBottom: '1px solid #eee', paddingBottom: '5px', color: '#007bff' }}>ACTIVE PIPELINE (PENDING)</h4>
                              <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
                                  {getCrmActivePipeline(activeCrmRecord.id).length === 0 && <div style={{ color: '#999', fontStyle: 'italic', fontSize: '0.8rem', padding: '10px' }}>No active configurations pending.</div>}
                                  {getCrmActivePipeline(activeCrmRecord.id).map(job => (
                                      <div key={job.id} style={{ border: '1px solid #ccc', borderLeft: `4px solid ${job.status === 'CONFIGURED' ? '#28a745' : '#17a2b8'}`, padding: '10px', background: '#f4f4f4' }}>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '0.85rem' }}>
                                              <span>{job.jobId || job.id}</span>
                                              <span style={{ color: job.status === 'CONFIGURED' ? '#28a745' : '#17a2b8' }}>{job.status}</span>
                                          </div>
                                          <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '5px' }}>{job.sidemark || job.note || 'No description'}</div>
                                          {job.cpqData?.totalPrice && <div style={{ fontSize: '0.8rem', fontWeight: 'bold', marginTop: '5px', color: '#28a745' }}>Value: ${job.cpqData.totalPrice.toFixed(2)}</div>}
                                          <div style={{ display: 'flex', gap: '5px', marginTop: '10px' }}>
                                              <button onClick={() => { setActiveDocJob(job); setActiveDocType('QUOTE'); }} style={{ flex: 1, padding: '5px', fontSize: '0.65rem', fontWeight: 'bold', background: '#fff', border: '1px solid #6f42c1', color: '#6f42c1', cursor: 'pointer' }}>📄 QUOTE PDF</button>
                                              {job.cpqData?.dimensions && Object.keys(job.cpqData.dimensions).length > 0 && (
                                                  <button onClick={() => { setActiveDocJob(job); setActiveDocType('FACTORY_ROUTER'); }} style={{ flex: 1, padding: '5px', fontSize: '0.65rem', fontWeight: 'bold', background: '#fff', border: '1px solid #e83e8c', color: '#e83e8c', cursor: 'pointer' }}>🏭 ROUTER PDF</button>
                                              )}
                                          </div>
                                      </div>
                                  ))}
                              </div>

                              <h4 style={{ margin: '0 0 10px 0', borderBottom: '1px solid #eee', paddingBottom: '5px', color: '#6c757d' }}>ARCHIVED / APPROVED JOBS</h4>
                              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                  {getCrmArchivedPipeline(activeCrmRecord.id).length === 0 && <div style={{ color: '#999', fontStyle: 'italic', fontSize: '0.8rem', padding: '10px' }}>No historical jobs found.</div>}
                                  {getCrmArchivedPipeline(activeCrmRecord.id).map(job => (
                                      <div key={job.id} style={{ border: '1px solid #ccc', borderLeft: '4px solid #6c757d', padding: '10px', background: '#fff' }}>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '0.85rem' }}>
                                              <span>{job.jobId || job.id}</span>
                                              <span style={{ color: '#6c757d' }}>{job.status}</span>
                                          </div>
                                          <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '5px' }}>{job.sidemark || 'No description'}</div>
                                          <div style={{ display: 'flex', gap: '5px', marginTop: '10px' }}>
                                              <button onClick={() => { setActiveDocJob(job); setActiveDocType('QUOTE'); }} style={{ flex: 1, padding: '5px', fontSize: '0.65rem', fontWeight: 'bold', background: '#eee', border: '1px solid #ccc', color: '#333', cursor: 'pointer' }}>📄 HISTORICAL QUOTE</button>
                                              {job.cpqData?.dimensions && Object.keys(job.cpqData.dimensions).length > 0 && (
                                                  <button onClick={() => { setActiveDocJob(job); setActiveDocType('FACTORY_ROUTER'); }} style={{ flex: 1, padding: '5px', fontSize: '0.65rem', fontWeight: 'bold', background: '#eee', border: '1px solid #ccc', color: '#333', cursor: 'pointer' }}>🏭 HISTORICAL ROUTER</button>
                                              )}
                                          </div>
                                      </div>
                                  ))}
                              </div>
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* --- INCEPTION PRESENTATION MODAL --- */}
      {activeModalJob && (
        <div className="no-print" style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
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

      {/* 🚀 THE DOCUMENT GENERATOR STUDIO MODAL (Shared by Quote & Router) */}
      {activeDocJob && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 4000, overflowY: 'auto', padding: '40px 0' }}>
            
            <div className="no-print" style={{ background: '#fff', border: '4px solid #000', width: '816px', padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', boxShadow: '10px 10px 0 #000' }}>
                <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                    <label style={{ fontWeight: 'bold', fontSize: '0.85rem' }}>SELECT DOCUMENT FORMAT:</label>
                    <select value={activeDocType} onChange={(e) => setActiveDocType(e.target.value)} style={{ padding: '8px', border: `2px solid ${activeDocType === 'FACTORY_ROUTER' ? '#e83e8c' : '#6f42c1'}`, fontWeight: 'bold', fontSize: '1rem', outline: 'none' }}>
                        {DOC_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                        {activeDocJob.cpqData?.dimensions && Object.keys(activeDocJob.cpqData.dimensions).length > 0 && (
                            <option value="FACTORY_ROUTER">FACTORY SHOP ROUTER</option>
                        )}
                    </select>
                    <button onClick={() => window.print()} style={{ padding: '10px 20px', background: activeDocType === 'FACTORY_ROUTER' ? '#e83e8c' : '#6f42c1', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>🖨️ GENERATE PDF</button>
                </div>
                <button onClick={() => setActiveDocJob(null)} style={{ background: '#d9534f', color: '#fff', border: 'none', padding: '10px 20px', fontWeight: 'bold', cursor: 'pointer' }}>CLOSE STUDIO</button>
            </div>

            <div id="printable-document" style={{ background: '#fff', padding: '60px', border: '1px solid #ccc', minHeight: '1056px', width: '816px', boxShadow: '0 10px 20px rgba(0,0,0,0.3)', fontFamily: 'sans-serif', color: '#000', position: 'relative' }}>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '3px solid #000', paddingBottom: '30px', marginBottom: '40px' }}>
                    <div style={{ width: '300px' }}>
                        {currentLogo ? <img src={currentLogo} alt={activeBrand} style={{ maxWidth: '100%', maxHeight: '100px' }} /> : <h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '2rem' }}>{activeBrand}</h2>}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                        <h1 style={{ margin: '0 0 10px 0', fontSize: '2.5rem', color: activeDocType === 'FACTORY_ROUTER' ? '#000' : '#333', textTransform: 'uppercase', background: activeDocType === 'FACTORY_ROUTER' ? '#eee' : 'none', padding: activeDocType === 'FACTORY_ROUTER' ? '5px 15px' : '0' }}>
                            {activeDocType.replace('_', ' ')}
                        </h1>
                        <div style={{ fontSize: '1rem', color: '#666', marginBottom: '5px' }}><strong>DOC ID:</strong> {activeDocJob.jobId || activeDocJob.id.substring(0, 8).toUpperCase()}</div>
                        <div style={{ fontSize: '1rem', color: '#666' }}><strong>DATE:</strong> {activeDocJob.dateSaved || new Date().toLocaleDateString()}</div>
                    </div>
                </div>

                {activeTemplate.header && activeDocType !== 'FACTORY_ROUTER' && (
                    <div style={{ fontSize: '1rem', marginBottom: '40px', whiteSpace: 'pre-wrap', color: '#444' }}>{activeTemplate.header}</div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', background: '#f8f9fa', padding: '20px', border: '1px solid #eee', marginBottom: '40px' }}>
                    <div>
                        <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#888', textTransform: 'uppercase', marginBottom: '5px' }}>PREPARED FOR:</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{activeDocJob.customer?.name || activeDocJob.clientName || 'N/A'}</div>
                        <div style={{ fontSize: '1rem', marginTop: '8px' }}><strong>Project:</strong> {activeDocJob.jobName || 'Standard Order'}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#888', textTransform: 'uppercase', marginBottom: '5px' }}>REFERENCE:</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{activeDocJob.sidemark || 'N/A'}</div>
                    </div>
                </div>

                <div style={{ marginBottom: '40px' }}>
                    <div style={{ fontSize: '1rem', fontWeight: 'bold', color: '#333', borderBottom: '2px solid #000', paddingBottom: '10px', marginBottom: '20px', textTransform: 'uppercase' }}>
                        {activeDocType === 'FACTORY_ROUTER' ? 'BILL OF MATERIALS (BOM)' : 'ITEM SPECIFICATIONS & BUILD SHEET'}
                    </div>
                    
                    {activeDocJob.imageUrl && activeDocType !== 'FACTORY_ROUTER' && (
                        <div style={{ display: 'flex', gap: '30px', alignItems: 'flex-start' }}>
                            <div style={{ width: '400px', border: '1px solid #ccc', padding: '10px', background: '#fff' }}>
                                <img src={activeDocJob.imageUrl} alt="Scale Model" style={{ width: '100%', display: 'block' }} />
                            </div>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 'bold', fontSize: '1.2rem', marginBottom: '10px' }}>Spatial Concept / Request For Info</div>
                                <div style={{ fontSize: '1rem', whiteSpace: 'pre-wrap', color: '#444', lineHeight: '1.5' }}>{activeDocJob.note}</div>
                            </div>
                        </div>
                    )}

                    {activeDocJob.cpqData && (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '1rem' }}>
                            <thead>
                                <tr style={{ background: '#000', color: '#fff' }}>
                                    <th style={{ padding: '15px', textAlign: 'left' }}>DESCRIPTION</th>
                                    <th style={{ padding: '15px', textAlign: 'right' }}>{activeDocType === 'FACTORY_ROUTER' ? 'QTY' : 'AMOUNT'}</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr style={{ borderBottom: '1px solid #eee' }}>
                                    <td style={{ padding: '20px 15px', fontWeight: 'bold', fontSize: '1.1rem' }}>{getPartName(activeDocJob.linkedAssemblyId) || 'Master Assembly Base'}</td>
                                    <td style={{ padding: '20px 15px', textAlign: 'right', fontWeight: 'bold', color: '#666' }}>{activeDocType === 'FACTORY_ROUTER' ? '1' : 'Base Included'}</td>
                                </tr>
                                {Object.entries(activeDocJob.cpqData.configuration || {}).map(([stepId, valueId], idx) => {
                                    const qty = activeDocJob.cpqData.quantities?.[stepId] || 1;
                                    return (
                                        <tr key={idx} style={{ borderBottom: '1px solid #eee' }}>
                                            <td style={{ padding: '15px', paddingLeft: '40px', color: '#555' }}>• {getPartName(valueId)}</td>
                                            <td style={{ padding: '15px', textAlign: 'right', color: activeDocType === 'FACTORY_ROUTER' ? '#000' : '#999', fontWeight: activeDocType === 'FACTORY_ROUTER' ? 'bold' : 'normal' }}>
                                                {activeDocType === 'FACTORY_ROUTER' ? qty : 'Included'}
                                            </td>
                                        </tr>
                                    );
                                })}
                                
                                {activeDocType !== 'FACTORY_ROUTER' && (
                                    <tr>
                                        <td style={{ padding: '30px 15px', textAlign: 'right', fontWeight: 'bold', fontSize: '1.4rem' }}>TOTAL INVESTMENT:</td>
                                        <td style={{ padding: '30px 15px', textAlign: 'right', fontWeight: 'bold', fontSize: '1.4rem', borderTop: '3px solid #000' }}>${activeDocJob.cpqData.totalPrice?.toFixed(2)}</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* 🚀 NEW: Render Shop Cut Sheet specifically for Factory Routers */}
                {activeDocType === 'FACTORY_ROUTER' && activeDocJob.cpqData?.dimensions && Object.keys(activeDocJob.cpqData.dimensions).length > 0 && (
                    <div style={{ marginTop: '20px', border: '2px dashed #000', padding: '15px', background: '#fff3cd' }}>
                        <h4 style={{ margin: '0 0 10px 0', color: '#856404', textTransform: 'uppercase' }}>⚠️ DIMENSIONAL SHOP CUT SHEET</h4>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                            <tbody>
                                {Object.entries(activeDocJob.cpqData.dimensions).map(([stepId, dims]) => (
                                    <React.Fragment key={stepId}>
                                        <tr><td colSpan="2" style={{ padding: '10px', fontWeight: 'bold', background: '#e9ecef', borderTop: '2px solid #000' }}>Dimensional Inputs</td></tr>
                                        {Object.entries(dims).filter(([k,v]) => !k.startsWith('calc_') && v !== '').map(([key, val]) => (
                                            <tr key={key}>
                                                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>INPUT: {key.toUpperCase()}</td>
                                                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{val}</td>
                                            </tr>
                                        ))}
                                        {dims.calc_cutLength && (
                                            <tr>
                                                <td style={{ padding: '8px', borderBottom: '1px dashed #d9534f', color: '#d9534f', fontWeight: 'bold', fontSize: '14px' }}>SHOP RAW CUT LENGTH</td>
                                                <td style={{ padding: '8px', borderBottom: '1px dashed #d9534f', fontWeight: 'bold', fontSize: '16px', color: '#d9534f' }}>{dims.calc_cutLength}"</td>
                                            </tr>
                                        )}
                                        {dims.calc_o2o && (
                                            <tr>
                                                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 'bold' }}>FINISHED O2O</td>
                                                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 'bold' }}>{dims.calc_o2o}"</td>
                                            </tr>
                                        )}
                                        {dims.calc_c2c && (
                                            <tr>
                                                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 'bold' }}>FINISHED C2C</td>
                                                <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', fontWeight: 'bold' }}>{dims.calc_c2c}"</td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                <div style={{ position: 'absolute', bottom: '60px', left: '60px', right: '60px' }}>
                    {activeTemplate.footer && activeDocType !== 'FACTORY_ROUTER' && (
                        <div style={{ fontSize: '1rem', marginBottom: '20px', whiteSpace: 'pre-wrap', textAlign: 'center', fontWeight: 'bold', color: '#333' }}>{activeTemplate.footer}</div>
                    )}
                    {activeTemplate.terms && activeDocType !== 'FACTORY_ROUTER' && (
                        <div style={{ fontSize: '0.75rem', color: '#888', borderTop: '1px solid #ccc', paddingTop: '15px', whiteSpace: 'pre-wrap', textAlign: 'justify', lineHeight: '1.4' }}>{activeTemplate.terms}</div>
                    )}
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default ExternalCoopTab;