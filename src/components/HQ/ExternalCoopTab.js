import React, { useState, useEffect, useRef } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, doc, updateDoc, setDoc } from "firebase/firestore";

const printStyles = `
  @media print {
    body * { visibility: hidden; }
    #printable-document, #printable-document * { visibility: visible; }
    #printable-document { position: absolute; left: 0; top: 0; width: 100%; margin: 0; padding: 0; background: transparent; }
    .pdf-page { page-break-after: always; box-shadow: none !important; margin: 0 !important; }
    .pdf-page:last-child { page-break-after: auto; }
    .no-print { display: none !important; }
  }
`;

const INITIAL_CRM_DATA = {};

const ExternalCoopTab = ({ currentUser, activeBrand }) => {
  const [activeSubTab, setActiveSubTab] = useState('CUSTOMERS'); 
  const [inceptionJobs, setInceptionJobs] = useState([]);
  const [configuredJobs, setConfiguredJobs] = useState([]);
  
  const [allBrandJobs, setAllBrandJobs] = useState([]); 
  
  const [debugStats, setDebugStats] = useState({ total: 0, brandMatch: 0, inception: 0, configured: 0 });

  const [crmData, setCrmData] = useState(INITIAL_CRM_DATA);
  const [crmSearchQuery, setCrmSearchQuery] = useState('');
  const [activeCrmRecord, setActiveCrmRecord] = useState(null);
  
  const [showNewCrmModal, setShowNewCrmModal] = useState(false);
  
  const [newCrmForm, setNewCrmForm] = useState({ 
      name: '', email: '', contact: '', phone: '', 
      terms: '', salesRep: '', discountCode: '', creditLimit: '', 
      billingAddress: '', shippingAddresses: [] 
  });

  const [newAddressInput, setNewAddressInput] = useState({ label: '', street: '' });
  
  const [globalLists, setGlobalLists] = useState({ customers: [], vendors: [], paymentTerms: [], salesReps: [] });
  const [crmDiscounts, setCrmDiscounts] = useState([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [activeModalJob, setActiveModalJob] = useState(null);
  const [activeAssemblyId, setActiveAssemblyId] = useState('');
  const [activeAssemblyName, setActiveAssemblyName] = useState('');
  
  const [liveAssemblies, setLiveAssemblies] = useState([]);
  
  const [activeDocJob, setActiveDocJob] = useState(null);
  const [activeDocType, setActiveDocType] = useState('FULL_PACKET'); 
  const [formTemplates, setFormTemplates] = useState({});
  const [brandLogos, setBrandLogos] = useState({});
  const [draftDrawings, setDraftDrawings] = useState([]); 

  const [expandedSections, setExpandedSections] = useState({ active: true, archive: false });

  useEffect(() => {
      const unsubLists = onSnapshot(doc(db, "system", "master_lists"), (docSnap) => { 
          if (docSnap.exists()) setGlobalLists(docSnap.data()); 
      });

      const unsubDiscounts = onSnapshot(doc(db, "system", "crm_discounts"), (docSnap) => { 
          if (docSnap.exists() && docSnap.data().list) setCrmDiscounts(docSnap.data().list); 
      });

      const unsubAssemblies = onSnapshot(collection(db, "Approved_Designs"), (snap) => {
          const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          setLiveAssemblies(docs.filter(d => ['Assembly', 'Master Assembly'].includes(d.partClass)));
      });

      const unsubCrm = onSnapshot(collection(db, "crm_records"), (snap) => {
          const data = {};
          snap.docs.forEach(d => { data[d.id] = { id: d.id, ...d.data() }; });
          setCrmData(data);
      });

      const unsubForms = onSnapshot(doc(db, "hq_config", "form_templates"), (docSnap) => { 
          if (docSnap.exists()) setFormTemplates(docSnap.data());
      });

      const unsubLogos = onSnapshot(doc(db, "hq_config", "brand_logos"), (docSnap) => { 
          if (docSnap.exists()) setBrandLogos(docSnap.data());
      });

      const unsubDrawings = onSnapshot(collection(db, "crm_files"), (snap) => {
          const drawings = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(f => f.type === 'VISION_DRAWING');
          setDraftDrawings(drawings);
      });

      return () => { unsubLists(); unsubDiscounts(); unsubAssemblies(); unsubCrm(); unsubForms(); unsubLogos(); unsubDrawings(); };
  }, []);

  useEffect(() => {
    if (!activeBrand) return;

    const unsubJobs = onSnapshot(collection(db, "jobs"), (snapshot) => {
        const allJobs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        const brandJobs = allJobs.filter(j => j.brandId === activeBrand);
        
        setAllBrandJobs(brandJobs); 
        
        const inception = brandJobs.filter(j => ['INCEPTION', 'DRAFT'].includes(j.status));
        const configured = brandJobs.filter(j => !['INCEPTION', 'DRAFT'].includes(j.status));

        setInceptionJobs(inception);
        setConfiguredJobs(configured);

        setDebugStats({
            total: allJobs.length,
            brandMatch: brandJobs.length,
            inception: inception.length,
            configured: configured.length
        });

    }, (error) => {
        console.error("Error fetching jobs:", error);
    });

    return () => unsubJobs();
  }, [activeBrand]);

  const updateJobStatus = async (jobId, newStatus) => {
      try {
          await updateDoc(doc(db, "jobs", jobId), { status: newStatus });
      } catch (err) {
          console.error("Error updating status:", err);
          alert("Failed to update status.");
      }
  };

  const handleUpdateActiveCrmField = async (field, value) => {
      if (!activeCrmRecord) return;
      const updated = { ...activeCrmRecord, [field]: value };
      setActiveCrmRecord(updated);
      try { await updateDoc(doc(db, "crm_records", activeCrmRecord.id), { [field]: value }); } 
      catch (e) { console.error(e); }
  };

  const getFilteredCrmRecords = (isCust) => {
      const records = Object.values(crmData).filter(r => r.type === (isCust ? 'CUSTOMER' : 'VENDOR'));
      if (!crmSearchQuery) return records;
      const q = crmSearchQuery.toLowerCase();
      return records.filter(r => (r.name || '').toLowerCase().includes(q) || (r.id || '').toLowerCase().includes(q) || (r.email || '').toLowerCase().includes(q));
  };

  const handleCreateNewCrm = async () => {
      if (!newCrmForm.name) return alert("Name is required.");
      const isCust = activeSubTab === 'CUSTOMERS';
      const newId = `${isCust ? 'CUST' : 'VEND'}-${Math.floor(1000 + Math.random() * 9000)}`;
      
      const payload = {
          ...newCrmForm,
          id: newId,
          type: isCust ? 'CUSTOMER' : 'VENDOR',
          createdAt: new Date().toISOString(),
          ytd: 0, mtd: 0, openOrders: 0
      };

      try {
          await setDoc(doc(db, "crm_records", newId), payload);
          
          const listKey = isCust ? 'customers' : 'vendors';
          const updatedList = [...(globalLists[listKey] || []), newCrmForm.name];
          await setDoc(doc(db, "system", "master_lists"), { [listKey]: updatedList }, { merge: true });

          setNewCrmForm({ name: '', email: '', contact: '', phone: '', terms: '', salesRep: '', discountCode: '', creditLimit: '', billingAddress: '', shippingAddresses: [] });
          setShowNewCrmModal(false);
          setActiveCrmRecord(payload);

      } catch (err) {
          console.error(err);
          alert("Failed to create record.");
      }
  };

  const getCrmActivePipeline = (crmId) => {
      return allBrandJobs.filter(j => 
          (j.customer?.id === crmId || j.vendorId === crmId) && 
          !['COMPLETED', 'SHIPPED', 'CANCELLED', 'TRANSMITTED_TO_ERP'].includes(j.status)
      ).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  };

  const getCrmArchivedPipeline = (crmId) => {
      return allBrandJobs.filter(j => 
          (j.customer?.id === crmId || j.vendorId === crmId) && 
          ['COMPLETED', 'SHIPPED', 'CANCELLED', 'TRANSMITTED_TO_ERP'].includes(j.status)
      ).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  };

  const filterByActiveTab = (job) => {
      if (activeSubTab === 'CUSTOMERS') return !!job.clientName || !!job.customer;
      if (activeSubTab === 'VENDORS') return !!job.vendorName;
      return true;
  };

  const filteredConfigured = configuredJobs
      .filter(job => filterByActiveTab(job))
      .filter(job => {
          const q = searchQuery.toLowerCase();
          const entity = job.customer?.name || '';
          return (!q || (job.jobId || job.id).toLowerCase().includes(q) || entity.toLowerCase().includes(q) || (job.sidemark && job.sidemark.toLowerCase().includes(q))) &&
                 (!startDate || job.dateSaved >= startDate) &&
                 (!endDate || job.dateSaved <= endDate);
      });

  const getActiveTabCounts = () => {
      let active = 0; let pending = 0; let complete = 0;
      configuredJobs.filter(j => filterByActiveTab(j)).forEach(j => {
          if (['APPROVED', 'IN_PRODUCTION'].includes(j.status)) active++;
          else if (['CONFIGURED', 'SENT_TO_CLIENT', 'REVISION_REQUESTED'].includes(j.status)) pending++;
          else complete++;
      });
      return { active, pending, complete };
  };

  // 🚀 REBUILT: Multi-Page Render Logic
  const renderDocument = () => {
      if (!activeDocJob) return null;

      const template = formTemplates['QUOTE'] || { header: '', footer: '', terms: '' };
      const logoUrl = brandLogos[activeBrand];

      let mathSection = '';
      if (activeDocJob.engineeringNotes) {
          const notes = activeDocJob.engineeringNotes;
          mathSection = `
              <div style="background: #fff3cd; border: 2px dashed #ffc107; padding: 15px; margin-bottom: 20px;">
                  <h4 style="margin:0 0 10px 0; color: #1e7e34; text-transform: uppercase;">ENGINEERING DIMENSIONS</h4>
                  <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                      <tr>
                          <td style="padding: 6px; border-bottom: 1px solid #eee; color: #1e7e34;">System O2O (Outside-to-Outside):</td>
                          <td style="padding: 6px; border-bottom: 1px solid #eee; font-weight: bold;">${notes.systemO2O ? notes.systemO2O.toFixed(2) + '"' : 'N/A'}</td>
                      </tr>
                      <tr>
                          <td style="padding: 6px; border-bottom: 1px solid #eee; color: #007bff;">System C2C (Center-to-Center):</td>
                          <td style="padding: 6px; border-bottom: 1px solid #eee; font-weight: bold;">${notes.systemC2C ? notes.systemC2C.toFixed(2) + '"' : 'N/A'}</td>
                      </tr>
                      ${notes.shape === 'MITERED' ? `
                      <tr>
                          <td style="padding: 6px; border-bottom: 1px solid #eee;">Left Wall C2C:</td>
                          <td style="padding: 6px; border-bottom: 1px solid #eee; font-weight: bold;">${notes.pole1 ? notes.pole1.toFixed(2) + '"' : 'N/A'}</td>
                      </tr>
                      ` : ''}
                      <tr>
                          <td style="padding: 6px; border-bottom: 1px solid #eee;">${notes.shape === 'STRAIGHT' ? 'Main Wall C2C:' : 'Center Wall C2C:'}</td>
                          <td style="padding: 6px; border-bottom: 1px solid #eee; font-weight: bold;">${notes.pole2 ? notes.pole2.toFixed(2) + '"' : 'N/A'}</td>
                      </tr>
                      ${notes.shape === 'MITERED' ? `
                      <tr>
                          <td style="padding: 6px; border-bottom: 1px solid #eee;">Right Wall C2C:</td>
                          <td style="padding: 6px; border-bottom: 1px solid #eee; font-weight: bold;">${notes.pole3 ? notes.pole3.toFixed(2) + '"' : 'N/A'}</td>
                      </tr>
                      ` : ''}
                  </table>
              </div>
          `;
      }

      const linkedDrawing = draftDrawings.find(d => d.jobId === (activeDocJob.jobId || activeDocJob.id));

      const isFullPacket = activeDocType === 'FULL_PACKET';
      const renderQuote = isFullPacket || activeDocType === 'QUOTE';
      const renderRouter = isFullPacket || activeDocType === 'FACTORY_ROUTER';

      return (
          <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.9)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 9999, overflowY: 'auto', padding: '40px 0' }}>
              <div style={{ position: 'relative' }}>
                  <div className="no-print" style={{ position: 'absolute', top: 0, right: '-120px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <button onClick={() => window.print()} style={{ padding: '15px', background: '#007bff', color: '#fff', fontWeight: 'bold', border: 'none', cursor: 'pointer', boxShadow: '4px 4px 0 #000' }}>🖨️ PRINT PDF</button>
                      <button onClick={() => setActiveDocJob(null)} style={{ padding: '15px', background: '#d9534f', color: '#fff', fontWeight: 'bold', border: 'none', cursor: 'pointer', boxShadow: '4px 4px 0 #000' }}>❌ CLOSE</button>
                  </div>

                  <div id="printable-document" style={{ width: '8.5in', display: 'flex', flexDirection: 'column', gap: '30px' }}>
                      
                      {/* PAGE 1: QUOTE */}
                      {renderQuote && (
                          <div className="pdf-page" style={{ background: '#fff', width: '100%', minHeight: '11in', padding: '0.5in', boxSizing: 'border-box', fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", color: '#000', boxShadow: '0 0 20px rgba(0,0,0,0.5)', position: 'relative' }}>
                              <div style={{ borderBottom: '4px solid #000', paddingBottom: '15px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                                  {logoUrl ? (
                                      <img src={logoUrl} alt={activeBrand} style={{ height: '60px', objectFit: 'contain' }} />
                                  ) : (
                                      <div style={{ fontSize: '32px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px', lineHeight: 1 }}>{activeBrand}</div>
                                  )}
                                  <div style={{ fontSize: '20px', color: '#fff', background: '#000', padding: '6px 15px', textTransform: 'uppercase', fontWeight: 'bold' }}>OFFICIAL QUOTE</div>
                              </div>

                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '30px', background: '#f8f9fa', padding: '20px', border: '2px solid #000' }}>
                                  <div>
                                      <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#666', textTransform: 'uppercase' }}>Prepared For:</div>
                                      <div style={{ fontSize: '16px', fontWeight: 'bold', marginTop: '3px' }}>{activeDocJob.customer?.name || activeDocJob.clientName || 'N/A'}</div>
                                      {activeCrmRecord?.billingAddress && <div style={{ fontSize: '12px', marginTop: '5px', whiteSpace: 'pre-wrap' }}>{activeCrmRecord.billingAddress}</div>}
                                  </div>
                                  <div>
                                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                                          <div>
                                              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#666', textTransform: 'uppercase' }}>Document ID:</div>
                                              <div style={{ fontSize: '14px', fontWeight: 'bold' }}>{activeDocJob.jobId || activeDocJob.id}</div>
                                          </div>
                                          <div>
                                              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#666', textTransform: 'uppercase' }}>Date:</div>
                                              <div style={{ fontSize: '14px', fontWeight: 'bold' }}>{activeDocJob.dateSaved || new Date().toLocaleDateString()}</div>
                                          </div>
                                          <div style={{ gridColumn: 'span 2' }}>
                                              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#666', textTransform: 'uppercase' }}>Project / Sidemark:</div>
                                              <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#007bff' }}>{activeDocJob.sidemark || activeDocJob.note || 'N/A'}</div>
                                          </div>
                                      </div>
                                  </div>
                              </div>

                              {template.header && <div style={{ marginBottom: '20px', fontSize: '13px', whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>{template.header}</div>}

                              <div style={{ border: '2px solid #000', marginBottom: '30px' }}>
                                  <div style={{ background: '#000', color: '#fff', padding: '10px 15px', fontWeight: 'bold', textTransform: 'uppercase', fontSize: '14px' }}>CONFIGURATION DETAILS</div>
                                  {activeDocJob.cpqData?.breakdown ? (
                                      activeDocJob.cpqData.breakdown.map((item, i) => (
                                          <div key={i} style={{ display: 'flex', padding: '12px 15px', borderBottom: '1px solid #eee', background: i % 2 === 0 ? '#fff' : '#f8f9fa', fontSize: '14px' }}>
                                              <span style={{ flex: 3 }}>{item.name}</span>
                                              <span style={{ flex: 1, textAlign: 'center' }}>QTY: {item.qty}</span>
                                              <span style={{ flex: 1, textAlign: 'right', fontWeight: 'bold' }}>${item.total.toFixed(2)}</span>
                                          </div>
                                      ))
                                  ) : (
                                      <div style={{ padding: '20px', fontStyle: 'italic', color: '#666', textAlign: 'center' }}>No line items configured.</div>
                                  )}
                                  {activeDocJob.cpqData?.totalPrice && (
                                      <div style={{ display: 'flex', padding: '15px', background: '#eafaf1', borderTop: '2px solid #000', fontSize: '18px', fontWeight: 'bold' }}>
                                          <span style={{ flex: 4, textAlign: 'right', paddingRight: '20px' }}>TOTAL AMOUNT:</span>
                                          <span style={{ flex: 1, textAlign: 'right', color: '#1e7e34' }}>${activeDocJob.cpqData.totalPrice.toFixed(2)}</span>
                                      </div>
                                  )}
                              </div>

                              {template.footer && <div style={{ marginBottom: '20px', fontSize: '13px', whiteSpace: 'pre-wrap', lineHeight: '1.5', borderTop: '1px solid #ccc', paddingTop: '15px' }}>{template.footer}</div>}
                              {template.terms && <div style={{ marginTop: '40px', fontSize: '9px', color: '#666', whiteSpace: 'pre-wrap', lineHeight: '1.4', borderTop: '1px solid #eee', paddingTop: '15px' }}>{template.terms}</div>}

                              <div style={{ marginTop: '50px', display: 'flex', justifyContent: 'space-between', gap: '30px' }}>
                                  <div style={{ flex: 1, borderTop: '2px solid #000', paddingTop: '5px', fontSize: '12px', fontWeight: 'bold', color: '#666', textAlign: 'center' }}>CLIENT APPROVAL SIGNATURE</div>
                                  <div style={{ width: '200px', borderTop: '2px solid #000', paddingTop: '5px', fontSize: '12px', fontWeight: 'bold', color: '#666', textAlign: 'center' }}>DATE</div>
                              </div>
                          </div>
                      )}

                      {/* PAGE 2: FACTORY ROUTER (Internal BOM/Math) */}
                      {renderRouter && (
                          <div className="pdf-page" style={{ background: '#fff', width: '100%', minHeight: '11in', padding: '0.5in', boxSizing: 'border-box', fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", color: '#000', boxShadow: '0 0 20px rgba(0,0,0,0.5)', position: 'relative' }}>
                              <div style={{ borderBottom: '4px solid #000', paddingBottom: '15px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                                  <div>
                                      <div style={{ fontSize: '32px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px', lineHeight: 1 }}>{activeBrand}</div>
                                      <div style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>Manufacturing Division</div>
                                  </div>
                                  <div style={{ fontSize: '24px', color: '#fff', background: '#d9534f', padding: '8px 20px', fontWeight: 'bold', textTransform: 'uppercase' }}>FACTORY ROUTER</div>
                              </div>

                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '30px', background: '#f8f9fa', padding: '20px', border: '2px solid #000' }}>
                                  <div>
                                      <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#666', textTransform: 'uppercase' }}>Prepared For:</div>
                                      <div style={{ fontSize: '16px', fontWeight: 'bold', marginTop: '3px' }}>{activeDocJob.customer?.name || activeDocJob.clientName || 'N/A'}</div>
                                  </div>
                                  <div>
                                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                                          <div>
                                              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#666', textTransform: 'uppercase' }}>Document ID:</div>
                                              <div style={{ fontSize: '14px', fontWeight: 'bold' }}>{activeDocJob.jobId || activeDocJob.id}</div>
                                          </div>
                                          <div>
                                              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#666', textTransform: 'uppercase' }}>Date:</div>
                                              <div style={{ fontSize: '14px', fontWeight: 'bold' }}>{activeDocJob.dateSaved || new Date().toLocaleDateString()}</div>
                                          </div>
                                          <div style={{ gridColumn: 'span 2' }}>
                                              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#666', textTransform: 'uppercase' }}>Project / Sidemark:</div>
                                              <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#007bff' }}>{activeDocJob.sidemark || activeDocJob.note || 'N/A'}</div>
                                          </div>
                                      </div>
                                  </div>
                              </div>

                              {activeDocJob.engineeringNotes && <div dangerouslySetInnerHTML={{ __html: mathSection }} />}

                              <div style={{ border: '2px solid #000', marginBottom: '30px' }}>
                                  <div style={{ background: '#000', color: '#fff', padding: '10px 15px', fontWeight: 'bold', textTransform: 'uppercase', fontSize: '14px' }}>BILL OF MATERIALS (BOM)</div>
                                  <div style={{ display: 'flex', padding: '10px 15px', background: '#eee', fontWeight: 'bold', fontSize: '12px', borderBottom: '1px solid #ccc' }}>
                                      <span style={{ flex: 3 }}>COMPONENT / MATERIAL</span>
                                      <span style={{ flex: 1, textAlign: 'center' }}>REQ. QTY</span>
                                  </div>

                                  {activeDocJob.cpqData?.breakdown ? (
                                      activeDocJob.cpqData.breakdown.map((item, i) => (
                                          <div key={i} style={{ display: 'flex', padding: '12px 15px', borderBottom: '1px solid #eee', background: i % 2 === 0 ? '#fff' : '#f8f9fa', fontSize: '14px' }}>
                                              <span style={{ flex: 3, fontWeight: 'bold' }}>{item.name}</span>
                                              <span style={{ flex: 1, textAlign: 'center', fontWeight: 'bold', fontSize: '16px' }}>{item.qty}</span>
                                          </div>
                                      ))
                                  ) : (
                                      <div style={{ padding: '20px', fontStyle: 'italic', color: '#666', textAlign: 'center' }}>No line items configured.</div>
                                  )}
                              </div>

                              {!activeDocJob.engineeringNotes && (
                                  <div style={{ padding: '20px', textAlign: 'center', color: '#d9534f', fontWeight: 'bold', border: '2px dashed #d9534f', marginBottom: '20px', background: '#fff0f0' }}>
                                      ⚠️ NO ENGINEERING DIMENSIONS ATTACHED TO THIS CONFIGURATION
                                  </div>
                              )}

                              <div style={{ marginTop: '50px', display: 'flex', justifyContent: 'space-between', gap: '30px' }}>
                                  <div style={{ flex: 1, borderTop: '2px solid #000', paddingTop: '5px', fontSize: '12px', fontWeight: 'bold', color: '#666', textAlign: 'center' }}>FABRICATION SIGN-OFF</div>
                                  <div style={{ width: '200px', borderTop: '2px solid #000', paddingTop: '5px', fontSize: '12px', fontWeight: 'bold', color: '#666', textAlign: 'center' }}>DATE</div>
                              </div>
                          </div>
                      )}

                      {/* PAGE 3: DRAWING (If applicable & full packet) */}
                      {isFullPacket && linkedDrawing && (
                          <div className="pdf-page" style={{ background: '#fff', width: '100%', minHeight: '11in', padding: '0.5in', boxSizing: 'border-box', fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", color: '#000', boxShadow: '0 0 20px rgba(0,0,0,0.5)', position: 'relative' }}>
                              <div style={{ borderBottom: '4px solid #000', paddingBottom: '15px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                                  <div>
                                      <div style={{ fontSize: '32px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px', lineHeight: 1 }}>{activeBrand}</div>
                                      <div style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>Engineering Drawing</div>
                                  </div>
                                  <div style={{ fontSize: '24px', color: '#fff', background: '#007bff', padding: '8px 20px', fontWeight: 'bold', textTransform: 'uppercase' }}>SHOP DRAWING</div>
                              </div>

                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '30px', background: '#f8f9fa', padding: '20px', border: '2px solid #000' }}>
                                  <div>
                                      <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#666', textTransform: 'uppercase' }}>Document ID:</div>
                                      <div style={{ fontSize: '14px', fontWeight: 'bold' }}>{activeDocJob.jobId || activeDocJob.id}</div>
                                  </div>
                                  <div>
                                      <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#666', textTransform: 'uppercase' }}>Project / Sidemark:</div>
                                      <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#007bff' }}>{activeDocJob.sidemark || activeDocJob.note || 'N/A'}</div>
                                  </div>
                              </div>

                              <div style={{ border: '4px solid #000', padding: '10px' }}>
                                  <div dangerouslySetInnerHTML={{ __html: linkedDrawing.svgData }} style={{ width: '100%' }} />
                              </div>
                          </div>
                      )}

                      <style>{printStyles}</style>
                  </div>
              </div>
          </div>
      );
  };

  const counts = getActiveTabCounts();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', fontFamily: 'monospace', backgroundColor: '#e5e5e5', minHeight: '100vh' }}>
      
      <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '5px 5px 0 #000' }}>
        <div>
            <h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.4rem', color: '#007bff' }}>10. EXTERNAL COOP & CRM</h2>
            <span style={{ fontSize: '0.7rem', color: '#666' }}>CUSTOMER RELATIONSHIP & PIPELINE MANAGEMENT</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '20px', alignItems: 'stretch' }}>
          
          <div style={{ width: '250px', background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 #000', flexShrink: 0 }}>
              <button onClick={() => { setActiveSubTab('CUSTOMERS'); setActiveCrmRecord(null); }} style={{ padding: '15px', textAlign: 'left', background: activeSubTab === 'CUSTOMERS' ? '#e6f2ff' : '#fff', border: 'none', borderBottom: '1px solid #eee', fontWeight: 'bold', cursor: 'pointer', borderLeft: activeSubTab === 'CUSTOMERS' ? '4px solid #007bff' : '4px solid transparent' }}>👥 CUSTOMER CRM</button>
              <button onClick={() => { setActiveSubTab('VENDORS'); setActiveCrmRecord(null); }} style={{ padding: '15px', textAlign: 'left', background: activeSubTab === 'VENDORS' ? '#fff0f0' : '#fff', border: 'none', borderBottom: '1px solid #eee', fontWeight: 'bold', cursor: 'pointer', borderLeft: activeSubTab === 'VENDORS' ? '4px solid #dc3545' : '4px solid transparent' }}>🏭 VENDOR / COOP CRM</button>
              <button onClick={() => { setActiveSubTab('PIPELINE'); setActiveCrmRecord(null); }} style={{ padding: '15px', textAlign: 'left', background: activeSubTab === 'PIPELINE' ? '#eafaf1' : '#fff', border: 'none', borderBottom: '1px solid #eee', fontWeight: 'bold', cursor: 'pointer', borderLeft: activeSubTab === 'PIPELINE' ? '4px solid #28a745' : '4px solid transparent' }}>📊 GLOBAL PIPELINE</button>
          </div>

          <div style={{ flex: 1, background: '#fff', border: '2px solid #000', minHeight: '600px', boxShadow: '10px 10px 0 #000' }}>
              
              {['CUSTOMERS', 'VENDORS'].includes(activeSubTab) && (
                  <div style={{ display: 'flex', height: '100%' }}>
                      
                      <div style={{ width: '300px', borderRight: '2px solid #000', display: 'flex', flexDirection: 'column', background: '#f8f9fa' }}>
                          <div style={{ padding: '15px', background: '#000', color: '#fff', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span>{activeSubTab}</span>
                              <button onClick={() => setShowNewCrmModal(true)} style={{ background: '#28a745', color: '#fff', border: 'none', fontWeight: 'bold', padding: '4px 8px', cursor: 'pointer', fontSize: '0.7rem' }}>+ NEW</button>
                          </div>
                          <div style={{ padding: '10px' }}>
                              <input 
                                  type="text" 
                                  value={crmSearchQuery} 
                                  onChange={e => setCrmSearchQuery(e.target.value)} 
                                  placeholder="Search Name, ID, or Email..." 
                                  style={{ width: '100%', padding: '8px', border: '1px solid #ccc', boxSizing: 'border-box' }} 
                              />
                          </div>
                          <div style={{ flex: 1, overflowY: 'auto' }}>
                              {getFilteredCrmRecords(activeSubTab === 'CUSTOMERS').length === 0 ? (
                                  <div style={{ padding: '20px', color: '#999', fontStyle: 'italic', textAlign: 'center', fontSize: '0.8rem' }}>No records found.</div>
                              ) : (
                                  getFilteredCrmRecords(activeSubTab === 'CUSTOMERS').map(record => (
                                      <div 
                                          key={record.id} 
                                          onClick={() => setActiveCrmRecord(record)}
                                          style={{ 
                                              padding: '15px', 
                                              borderBottom: '1px solid #eee', 
                                              cursor: 'pointer', 
                                              background: activeCrmRecord?.id === record.id ? '#e6f2ff' : '#fff',
                                              borderLeft: activeCrmRecord?.id === record.id ? '4px solid #007bff' : '4px solid transparent'
                                          }}
                                      >
                                          <div style={{ fontWeight: 'bold', fontSize: '0.9rem', color: '#000' }}>{record.name}</div>
                                          <div style={{ fontSize: '0.7rem', color: '#666', marginTop: '3px' }}>ID: {record.id}</div>
                                          <div style={{ fontSize: '0.7rem', color: '#666' }}>{record.email || 'No email'}</div>
                                      </div>
                                  ))
                              )}
                          </div>
                      </div>

                      <div style={{ flex: 1, padding: '20px', overflowY: 'auto' }}>
                          {!activeCrmRecord ? (
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#999', fontWeight: 'bold', fontSize: '1.2rem' }}>
                                  SELECT A {activeSubTab === 'CUSTOMERS' ? 'CUSTOMER' : 'VENDOR'} TO VIEW PROFILE
                              </div>
                          ) : (
                              <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
                                  
                                  {/* Left Panel: Profile & Financials */}
                                  <div style={{ flex: 1.5, display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                      
                                      <div style={{ background: '#fff', border: '2px solid #000', padding: '20px', boxShadow: '4px 4px 0 rgba(0,0,0,0.1)' }}>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #000', paddingBottom: '10px', marginBottom: '15px' }}>
                                              <div>
                                                  <h3 style={{ margin: 0, fontSize: '1.5rem', color: '#000' }}>{activeCrmRecord.name}</h3>
                                                  <span style={{ fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginTop: '5px' }}>{activeCrmRecord.type} ID: {activeCrmRecord.id}</span>
                                              </div>
                                          </div>

                                          {/* Mini Dashboard for Financials */}
                                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '15px', marginBottom: '20px', background: '#f8f9fa', padding: '15px', border: '1px solid #ccc' }}>
                                              <div style={{ textAlign: 'center', borderRight: '1px solid #ccc' }}>
                                                  <div style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#666' }}>OPEN ORDERS</div>
                                                  <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#17a2b8' }}>{activeCrmRecord.openOrders || 0}</div>
                                              </div>
                                              <div style={{ textAlign: 'center', borderRight: '1px solid #ccc' }}>
                                                  <div style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#666' }}>MTD VOLUME</div>
                                                  <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#28a745' }}>${(activeCrmRecord.mtd || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</div>
                                              </div>
                                              <div style={{ textAlign: 'center' }}>
                                                  <div style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#666' }}>YTD VOLUME</div>
                                                  <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#28a745' }}>${(activeCrmRecord.ytd || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</div>
                                              </div>
                                          </div>

                                          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                              
                                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                                                  <div>
                                                      <label style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#666', display: 'block', marginBottom: '5px' }}>PRIMARY CONTACT:</label>
                                                      <input value={activeCrmRecord.contact || ''} onChange={e => handleUpdateActiveCrmField('contact', e.target.value)} style={{ flex: 1, padding: '6px', border: '1px solid #ccc', fontSize: '0.8rem' }} />
                                                  </div>
                                                  <div>
                                                      <label style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#666', display: 'block', marginBottom: '5px' }}>EMAIL:</label>
                                                      <input value={activeCrmRecord.email || ''} onChange={e => handleUpdateActiveCrmField('email', e.target.value)} style={{ flex: 1, padding: '6px', border: '1px solid #ccc', fontSize: '0.8rem' }} />
                                                  </div>
                                                  <div>
                                                      <label style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#666', display: 'block', marginBottom: '5px' }}>PHONE:</label>
                                                      <input value={activeCrmRecord.phone || ''} onChange={e => handleUpdateActiveCrmField('phone', e.target.value)} style={{ flex: 1, padding: '6px', border: '1px solid #ccc', fontSize: '0.8rem' }} />
                                                  </div>
                                              </div>

                                              <div style={{ borderTop: '2px dashed #ccc', paddingTop: '15px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                                                  <div>
                                                      <label style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#17a2b8', display: 'block', marginBottom: '5px' }}>SALES REP:</label>
                                                      <select value={activeCrmRecord.salesRep || ''} onChange={e => handleUpdateActiveCrmField('salesRep', e.target.value)} style={{ flex: 1, padding: '6px', border: '1px solid #17a2b8', fontSize: '0.8rem', fontWeight: 'bold' }}>
                                                          <option value="">-- Unassigned --</option>
                                                          {(globalLists.salesReps || []).map(r => <option key={r} value={r}>{r}</option>)}
                                                      </select>
                                                  </div>
                                                  <div>
                                                      <label style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#17a2b8', display: 'block', marginBottom: '5px' }}>PAYMENT TERMS:</label>
                                                      <select value={activeCrmRecord.terms || ''} onChange={e => handleUpdateActiveCrmField('terms', e.target.value)} style={{ flex: 1, padding: '6px', border: '1px solid #17a2b8', fontSize: '0.8rem', fontWeight: 'bold' }}>
                                                          <option value="">-- Select Terms --</option>
                                                          {(globalLists.paymentTerms || []).map(t => <option key={t} value={t}>{t}</option>)}
                                                      </select>
                                                  </div>
                                                  <div>
                                                      <label style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#17a2b8', display: 'block', marginBottom: '5px' }}>CREDIT LIMIT ($):</label>
                                                      <input type="number" value={activeCrmRecord.creditLimit || ''} onChange={e => handleUpdateActiveCrmField('creditLimit', parseFloat(e.target.value)||0)} style={{ flex: 1, padding: '6px', border: '1px solid #17a2b8', fontSize: '0.8rem', fontWeight: 'bold' }} />
                                                  </div>
                                                  <div>
                                                      <label style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#17a2b8', display: 'block', marginBottom: '5px' }}>DISCOUNT TIER:</label>
                                                      <select value={activeCrmRecord.discountCode || ''} onChange={e => handleUpdateActiveCrmField('discountCode', e.target.value)} style={{ flex: 1, padding: '6px', border: '1px solid #17a2b8', fontSize: '0.8rem', fontWeight: 'bold' }}>
                                                          <option value="">-- No Discount --</option>
                                                          {crmDiscounts.map(d => <option key={d.code} value={d.code}>{d.code} (-{d.percent}%)</option>)}
                                                      </select>
                                                  </div>
                                              </div>

                                              <div style={{ borderTop: '2px dashed #ccc', paddingTop: '15px' }}>
                                                  <label style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#666', display: 'block', marginBottom: '5px' }}>BILLING ADDRESS:</label>
                                                  <textarea value={activeCrmRecord.billingAddress || ''} onChange={e => handleUpdateActiveCrmField('billingAddress', e.target.value)} style={{ width: '100%', padding: '8px', border: '1px solid #ccc', resize: 'vertical', minHeight: '60px', boxSizing: 'border-box', fontSize: '0.8rem' }} />
                                              </div>
                                              
                                              <div style={{ marginTop: '15px', borderTop: '2px dashed #ccc', paddingTop: '15px' }}>
                                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                                      <h4 style={{ margin: '0', color: '#007bff', fontSize: '0.9rem' }}>📍 SAVED SHIPPING ADDRESSES</h4>
                                                  </div>
                                                  
                                                  {(activeCrmRecord.shippingAddresses || []).length === 0 ? (
                                                      <span style={{ fontSize: '0.75rem', color: '#999', fontStyle: 'italic' }}>No shipping addresses synced.</span>
                                                  ) : (
                                                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '10px', maxHeight: '300px', overflowY: 'auto', paddingRight: '5px' }}>
                                                          {activeCrmRecord.shippingAddresses.map((addr, idx) => (
                                                              <div key={idx} style={{ 
                                                                  padding: '10px', 
                                                                  background: addr.isDefault ? '#eafaf1' : '#f8f9fa', 
                                                                  border: '1px solid #ccc', 
                                                                  borderLeft: addr.isDefault ? '4px solid #28a745' : '4px solid #ccc',
                                                                  boxShadow: '2px 2px 0 rgba(0,0,0,0.05)'
                                                              }}>
                                                                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', borderBottom: '1px solid #ddd', paddingBottom: '5px', marginBottom: '5px' }}>
                                                                      <span style={{ color: '#000', fontSize: '0.85rem' }}>{addr.label || 'Address'}</span>
                                                                      {addr.isDefault && <span style={{ color: '#28a745', fontSize: '0.65rem', padding: '2px 6px', background: '#fff', border: '1px solid #28a745', borderRadius: '4px' }}>DEFAULT</span>}
                                                                  </div>
                                                                  
                                                                  <div style={{ fontSize: '0.8rem', color: '#333', lineHeight: '1.4' }}>
                                                                      {addr.addressee && <div style={{ fontWeight: 'bold' }}>{addr.addressee}</div>}
                                                                      <div>{addr.addr1} {addr.addr2}</div>
                                                                      <div>{addr.city ? `${addr.city}, ` : ''}{addr.state} {addr.zip}</div>
                                                                  </div>
                                                                  
                                                                  <div style={{ fontSize: '0.65rem', color: '#999', marginTop: '8px' }}>
                                                                      {addr.addressBookId ? `NetSuite Address Book ID: ${addr.addressBookId}` : 'Manual Entry'}
                                                                  </div>
                                                              </div>
                                                          ))}
                                                      </div>
                                                  )}
                                              </div>
                                          </div>
                                      </div>

                                      <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', flex: 1, display: 'flex', flexDirection: 'column', boxShadow: '4px 4px 0 rgba(0,0,0,0.1)' }}>
                                          <h4 style={{ margin: '0 0 10px 0', borderBottom: '1px solid #eee', paddingBottom: '5px' }}>RELATIONSHIP NOTES</h4>
                                          <textarea 
                                              value={activeCrmRecord.notes || ''}
                                              onChange={(e) => handleUpdateActiveCrmField('notes', e.target.value)}
                                              style={{ flex: 1, padding: '10px', border: '1px solid #ccc', outline: 'none', resize: 'none', fontFamily: 'monospace', fontSize: '0.85rem' }}
                                              placeholder="Add strategic notes, preferences, or warnings here..."
                                          />
                                      </div>
                                  </div>

                                  {/* Right Panel: Active & Archived Pipeline with Collapsibles */}
                                  <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', flexDirection: 'column', boxShadow: '4px 4px 0 rgba(0,0,0,0.1)', flex: 1 }}>
                                      
                                      {/* --- ACTIVE PIPELINE COLLAPSIBLE --- */}
                                      <div 
                                          onClick={() => setExpandedSections(prev => ({ ...prev, active: !prev.active }))}
                                          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000', paddingBottom: '5px', marginBottom: '10px', cursor: 'pointer' }}
                                      >
                                          <h4 style={{ margin: 0, color: '#007bff' }}>ACTIVE PIPELINE (PENDING)</h4>
                                          <span style={{ fontWeight: 'bold' }}>{expandedSections.active ? '▼' : '▶'}</span>
                                      </div>
                                      
                                      {expandedSections.active && (
                                          <div style={{ maxHeight: '350px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px', paddingRight: '5px' }}>
                                              {getCrmActivePipeline(activeCrmRecord.id).length === 0 && <div style={{ color: '#999', fontStyle: 'italic', fontSize: '0.8rem', padding: '10px' }}>No active configurations pending.</div>}
                                              {getCrmActivePipeline(activeCrmRecord.id).map(job => (
                                                  <div key={job.id} style={{ border: '1px solid #ccc', borderLeft: `4px solid ${job.status === 'CONFIGURED' ? '#17a2b8' : '#28a745'}`, padding: '10px', background: '#f4f4f4' }}>
                                                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '0.85rem' }}>
                                                          <span>{job.jobId || job.id}</span>
                                                          <span style={{ color: job.status === 'CONFIGURED' ? '#17a2b8' : '#28a745' }}>{job.status}</span>
                                                      </div>
                                                      <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '5px' }}>{job.sidemark || job.note || 'No description'}</div>
                                                      {job.cpqData?.totalPrice && <div style={{ fontSize: '0.8rem', fontWeight: 'bold', marginTop: '5px', color: '#28a745' }}>Value: ${job.cpqData.totalPrice.toFixed(2)}</div>}
                                                      
                                                      {/* 🚀 NEW CRM PIPELINE ACTION BUTTONS */}
                                                      <div style={{ display: 'flex', gap: '5px', marginTop: '10px', flexWrap: 'wrap' }}>
                                                          {job.status === 'CONFIGURED' && (
                                                              <button onClick={() => updateJobStatus(job.id, 'APPROVED')} style={{ flex: 1, padding: '6px', fontSize: '0.65rem', fontWeight: 'bold', background: '#28a745', color: '#fff', border: 'none', cursor: 'pointer' }}>✅ APPROVE</button>
                                                          )}
                                                          <button onClick={() => window.location.href = `mailto:${activeCrmRecord.email || ''}?subject=Quote ${job.jobId || job.id} from ${activeBrand.toUpperCase()}&body=Please find attached the latest documentation for your review...`} style={{ flex: 1, padding: '6px', fontSize: '0.65rem', fontWeight: 'bold', background: '#fff', border: '1px solid #17a2b8', color: '#17a2b8', cursor: 'pointer' }}>📧 EMAIL</button>
                                                          <button onClick={() => { setActiveDocJob(job); setActiveDocType('FULL_PACKET'); }} style={{ flex: 1, padding: '6px', fontSize: '0.65rem', fontWeight: 'bold', background: '#fff', border: '1px solid #6f42c1', color: '#6f42c1', cursor: 'pointer' }}>📄 FULL PACKET</button>
                                                      </div>
                                                  </div>
                                              ))}
                                          </div>
                                      )}

                                      {/* --- ARCHIVE PIPELINE COLLAPSIBLE --- */}
                                      <div 
                                          onClick={() => setExpandedSections(prev => ({ ...prev, archive: !prev.archive }))}
                                          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000', paddingBottom: '5px', marginBottom: '10px', cursor: 'pointer', marginTop: expandedSections.active ? '10px' : '0' }}
                                      >
                                          <h4 style={{ margin: 0, color: '#6c757d' }}>ERP TRANSMITTED & ARCHIVED</h4>
                                          <span style={{ fontWeight: 'bold' }}>{expandedSections.archive ? '▼' : '▶'}</span>
                                      </div>
                                      
                                      {expandedSections.archive && (
                                          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '5px', maxHeight: '350px' }}>
                                              {getCrmArchivedPipeline(activeCrmRecord.id).length === 0 && <div style={{ color: '#999', fontStyle: 'italic', fontSize: '0.8rem', padding: '10px' }}>No historical or transmitted jobs found.</div>}
                                              {getCrmArchivedPipeline(activeCrmRecord.id).map(job => (
                                                  <div key={job.id} style={{ border: '1px solid #ccc', borderLeft: `4px solid #6c757d`, padding: '10px', background: '#fff' }}>
                                                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '0.85rem' }}>
                                                          <span>{job.jobId || job.id}</span>
                                                          <span style={{ color: '#6c757d' }}>{job.status}</span>
                                                      </div>
                                                      <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '5px' }}>{job.sidemark || job.note || 'No description'}</div>
                                                      {job.cpqData?.totalPrice && <div style={{ fontSize: '0.8rem', fontWeight: 'bold', marginTop: '5px', color: '#000' }}>Value: ${job.cpqData.totalPrice.toFixed(2)}</div>}
                                                      <div style={{ fontSize: '0.65rem', color: '#999', marginTop: '5px' }}>Saved: {new Date(job.createdAt?.seconds * 1000).toLocaleDateString()}</div>
                                                      
                                                      <div style={{ display: 'flex', gap: '5px', marginTop: '10px' }}>
                                                          <button onClick={() => { setActiveDocJob(job); setActiveDocType('FULL_PACKET'); }} style={{ flex: 1, padding: '5px', fontSize: '0.65rem', fontWeight: 'bold', background: '#f8f9fa', border: '1px solid #ccc', color: '#333', cursor: 'pointer' }}>📄 FULL PACKET</button>
                                                      </div>
                                                  </div>
                                              ))}
                                          </div>
                                      )}
                                  </div>
                              </div>
                          )}
                      </div>
                  </div>
              )}

              {activeSubTab === 'PIPELINE' && (
                  <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px', height: '100%', overflowY: 'auto', boxSizing: 'border-box' }}>
                      
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '15px', marginBottom: '10px' }}>
                          <div style={{ background: '#eafaf1', border: '2px solid #28a745', padding: '20px', textAlign: 'center' }}>
                              <div style={{ fontSize: '1rem', fontWeight: 'bold', color: '#1e7e34' }}>ACTIVE CONFIGURATIONS</div>
                              <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#28a745' }}>{counts.active}</div>
                          </div>
                          <div style={{ background: '#fff3cd', border: '2px solid #ffc107', padding: '20px', textAlign: 'center' }}>
                              <div style={{ fontSize: '1rem', fontWeight: 'bold', color: '#856404' }}>PENDING REVIEW</div>
                              <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#ffc107' }}>{counts.pending}</div>
                          </div>
                          <div style={{ background: '#f8f9fa', border: '2px solid #6c757d', padding: '20px', textAlign: 'center' }}>
                              <div style={{ fontSize: '1rem', fontWeight: 'bold', color: '#495057' }}>COMPLETED / ARCHIVED</div>
                              <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#6c757d' }}>{counts.complete}</div>
                          </div>
                      </div>

                      <div style={{ display: 'flex', gap: '15px', background: '#f8f9fa', padding: '15px', border: '1px solid #ccc' }}>
                          <input type="text" placeholder="Search ID, Client, Sidemark..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} style={{ flex: 1, padding: '10px', fontSize: '1rem', border: '1px solid #ccc' }} />
                          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ padding: '10px', border: '1px solid #ccc' }} />
                          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ padding: '10px', border: '1px solid #ccc' }} />
                          <button onClick={() => { setSearchQuery(''); setStartDate(''); setEndDate(''); }} style={{ padding: '10px 20px', background: '#6c757d', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>CLEAR</button>
                      </div>

                      <div style={{ flex: 1, background: '#fff', border: '1px solid #ccc', overflowY: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                              <thead style={{ background: '#000', color: '#fff' }}>
                                  <tr>
                                      <th style={{ padding: '12px 15px' }}>JOB ID / REF</th>
                                      <th style={{ padding: '12px 15px' }}>CUSTOMER / ENTITY</th>
                                      <th style={{ padding: '12px 15px' }}>DATE SAVED</th>
                                      <th style={{ padding: '12px 15px' }}>VALUE</th>
                                      <th style={{ padding: '12px 15px' }}>STATUS</th>
                                      <th style={{ padding: '12px 15px', textAlign: 'right' }}>ACTIONS</th>
                                  </tr>
                              </thead>
                              <tbody>
                                  {filteredConfigured.length === 0 ? (
                                      <tr><td colSpan="6" style={{ padding: '20px', textAlign: 'center', color: '#999', fontStyle: 'italic' }}>No pipeline jobs found.</td></tr>
                                  ) : (
                                      filteredConfigured.map(job => (
                                          <tr key={job.id} style={{ borderBottom: '1px solid #eee', background: job.status === 'APPROVED' ? '#eafaf1' : '#fff' }}>
                                              <td style={{ padding: '12px 15px' }}>
                                                  <div style={{ fontWeight: 'bold', color: '#007bff' }}>{job.jobId || job.id}</div>
                                                  <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '3px' }}>{job.sidemark || job.note || 'No description'}</div>
                                              </td>
                                              <td style={{ padding: '12px 15px', fontWeight: 'bold' }}>{job.customer?.name || job.clientName || 'N/A'}</td>
                                              <td style={{ padding: '12px 15px', color: '#666' }}>{job.dateSaved || new Date(job.createdAt?.seconds * 1000).toLocaleDateString() || 'N/A'}</td>
                                              <td style={{ padding: '12px 15px', fontWeight: 'bold', color: '#28a745' }}>{job.cpqData?.totalPrice ? `$${job.cpqData.totalPrice.toFixed(2)}` : 'N/A'}</td>
                                              <td style={{ padding: '12px 15px' }}>
                                                  <span style={{ 
                                                      background: job.status === 'APPROVED' ? '#28a745' : (job.status === 'CONFIGURED' ? '#17a2b8' : '#6c757d'), 
                                                      color: '#fff', padding: '4px 8px', borderRadius: '12px', fontSize: '0.7rem', fontWeight: 'bold' 
                                                  }}>
                                                      {job.status}
                                                  </span>
                                              </td>
                                              <td style={{ padding: '12px 15px', textAlign: 'right' }}>
                                                  {job.status === 'CONFIGURED' && (
                                                      <button onClick={() => updateJobStatus(job.id, 'APPROVED')} style={{ padding: '6px 12px', background: '#28a745', color: '#fff', fontWeight: 'bold', border: 'none', cursor: 'pointer', fontSize: '0.75rem', marginRight: '5px' }}>APPROVE</button>
                                                  )}
                                                  <button onClick={() => { setActiveDocJob(job); setActiveDocType('FULL_PACKET'); }} style={{ padding: '6px 12px', background: '#fff', border: '1px solid #6f42c1', color: '#6f42c1', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.75rem' }}>📄 DOCS</button>
                                              </td>
                                          </tr>
                                      ))
                                  )}
                              </tbody>
                          </table>
                      </div>
                  </div>
              )}
          </div>
      </div>

      {showNewCrmModal && (
          <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
              <div style={{ background: '#fff', border: '4px solid #000', width: '500px', display: 'flex', flexDirection: 'column', boxShadow: '20px 20px 0 #000' }}>
                  <div style={{ padding: '20px', background: '#000', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000' }}>
                      <h2 style={{ margin: 0, fontSize: '1.2rem', textTransform: 'uppercase' }}>ADD NEW {activeSubTab === 'CUSTOMERS' ? 'CUSTOMER' : 'VENDOR'}</h2>
                      <button onClick={() => setShowNewCrmModal(false)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.5rem', cursor: 'pointer' }}>×</button>
                  </div>
                  <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                      <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Company / Entity Name *</label>
                          <input value={newCrmForm.name} onChange={e => setNewCrmForm({...newCrmForm, name: e.target.value})} style={{ width: '100%', padding: '10px', border: '2px solid #007bff', boxSizing: 'border-box', fontSize: '1rem', fontWeight: 'bold' }} />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                          <div>
                              <label style={{ fontSize: '0.75rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Primary Contact</label>
                              <input value={newCrmForm.contact} onChange={e => setNewCrmForm({...newCrmForm, contact: e.target.value})} style={{ width: '100%', padding: '8px', border: '1px solid #ccc', boxSizing: 'border-box' }} />
                          </div>
                          <div>
                              <label style={{ fontSize: '0.75rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Email</label>
                              <input value={newCrmForm.email} onChange={e => setNewCrmForm({...newCrmForm, email: e.target.value})} style={{ width: '100%', padding: '8px', border: '1px solid #ccc', boxSizing: 'border-box' }} />
                          </div>
                      </div>
                      <button onClick={handleCreateNewCrm} style={{ width: '100%', padding: '15px', background: '#28a745', color: '#fff', fontSize: '1.1rem', fontWeight: 'bold', border: 'none', cursor: 'pointer', marginTop: '10px' }}>
                          💾 CREATE CRM PROFILE
                      </button>
                  </div>
              </div>
          </div>
      )}

      {renderDocument()}

    </div>
  );
};

export default ExternalCoopTab;