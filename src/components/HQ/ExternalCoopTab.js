import React, { useState, useEffect } from 'react';
import { db, storage } from '../../firebase';
import { collection, onSnapshot, query, where, doc, updateDoc, setDoc, deleteDoc } from "firebase/firestore";
import { ref, deleteObject } from "firebase/storage";
import ConfiguredItemViewer from '../Shared/ConfiguredItemViewer';
import { printPlatingPackingList } from '../Shared/platingPackingList';

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
  const [cfgQuote, setCfgQuote] = useState(null); // read-only configured-item 3D viewer (opens a CONFIGURED job straight from the pipeline)
  const [activeAssemblyId, setActiveAssemblyId] = useState('');
  const [activeAssemblyName, setActiveAssemblyName] = useState('');
  
  const [liveAssemblies, setLiveAssemblies] = useState([]);
  
  const [activeDocJob, setActiveDocJob] = useState(null);
  const [activeDocType, setActiveDocType] = useState('FULL_PACKET'); 
  const [formTemplates, setFormTemplates] = useState({});
  const [brandLogos, setBrandLogos] = useState({});
  const [draftDrawings, setDraftDrawings] = useState([]); 

  const [expandedSections, setExpandedSections] = useState({ active: true, archive: false });
  const [platingPOs, setPlatingPOs] = useState([]);          // plating shipments (hq_purchase_orders, kind=plating)
  const [activePlatingPO, setActivePlatingPO] = useState(null); // shipment detail modal

  // --- JOB MODIFICATION STATE ---
  const [showEditJobModal, setShowEditJobModal] = useState(false);
  const [editJobForm, setEditJobForm] = useState({ id: '', jobName: '', sidemark: '', status: '' });

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

      // Plating shipments sent to vendors (from the Pick Pack plating tool) — surfaced on the vendor profile.
      const unsubPlating = onSnapshot(query(collection(db, "hq_purchase_orders"), where("kind", "==", "plating")), (snap) => {
          setPlatingPOs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      });

      return () => { unsubLists(); unsubDiscounts(); unsubAssemblies(); unsubCrm(); unsubForms(); unsubLogos(); unsubDrawings(); unsubPlating(); };
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

  // --- DELETE & EDIT HANDLERS ---
  const handleDeleteJob = async (jobId) => {
      if (window.confirm("WARNING: Are you sure you want to permanently delete this quote/job? This action cannot be undone.")) {
          try {
              await deleteDoc(doc(db, "jobs", jobId));
          } catch (err) {
              console.error("Error deleting job:", err);
              alert("Failed to delete job from the pipeline.");
          }
      }
  };

  const openEditJobModal = (job) => {
      setEditJobForm({
          id: job.id,
          jobName: job.jobName || '',
          sidemark: job.sidemark || '',
          status: job.status || ''
      });
      setShowEditJobModal(true);
  };

  const handleSaveJobEdit = async () => {
      try {
          await updateDoc(doc(db, "jobs", editJobForm.id), {
              jobName: editJobForm.jobName,
              sidemark: editJobForm.sidemark,
              status: editJobForm.status
          });
          setShowEditJobModal(false);
      } catch (err) {
          console.error("Error updating job:", err);
          alert("Failed to update job details.");
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
      const records = Object.values(crmData).filter(r =>
          r.type === (isCust ? 'CUSTOMER' : 'VENDOR') &&
          // Customers are brand-isolated; vendors are the central NetSuite-synced supplier DB shared
          // across all brands (e.g. a plater like Dayton Grey serves CE and M2C alike).
          (!isCust || r.brandId === activeBrand || (r.sharedBrands && r.sharedBrands.includes(activeBrand)))
      );
      
      let filteredRecords = records;
      
      if (crmSearchQuery) {
          const q = crmSearchQuery.toLowerCase();
          filteredRecords = records.filter(r => 
              (r.name || '').toLowerCase().includes(q) || 
              (r.id || '').toLowerCase().includes(q) || 
              (r.email || '').toLowerCase().includes(q)
          );
      }

      return filteredRecords.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  };

  const handleCreateNewCrm = async () => {
      if (!newCrmForm.name) return alert("Name is required.");
      const isCust = activeSubTab === 'CUSTOMERS';
      const newId = `${isCust ? 'CUST' : 'VEND'}-${Math.floor(1000 + Math.random() * 9000)}`;
      
      const payload = {
          ...newCrmForm,
          id: newId,
          type: isCust ? 'CUSTOMER' : 'VENDOR',
          brandId: activeBrand,                // Stamp new records with activeBrand
          sharedBrands: [activeBrand],         // Stamp new records with activeBrand
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

  // Plating shipments for a vendor — match by stored vendorCrmId, else NetSuite internal id, else name
  // (covers shipments created before vendorCrmId was stored).
  const getVendorPlatingShipments = (vendorId) => {
      const nsId = String(vendorId || '').replace(/^VEND-/, '');
      const vname = String(crmData[vendorId]?.name || '').toLowerCase();
      return platingPOs
          .filter(po => po.vendorCrmId === vendorId || String(po.nsVendorId) === nsId || String(po.vendor || '').toLowerCase() === vname)
          .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  };
  const reprintPlatingPackingList = (po) => {
      const pl = po.packingList || {
          shipId: po.poId || po.shipmentId, brand: po.brand, vendor: po.vendor, poLabel: po.nsPoTran || po.nsPoId || '—',
          dateStr: po.createdAt?.seconds ? new Date(po.createdAt.seconds * 1000).toLocaleDateString() : '',
          operator: po.createdBy || '', finishSummary: po.finishSummary || '',
          lines: (po.items || []).map(it => ({ erpId: it.itemId, itemName: it.description, finishCode: it.finishCode, targetErpId: it.targetErpId, platingBin: it.platingBin, woNum: it.woNum, qty: it.quantity })),
          pcs: po.pcs, total: po.total
      };
      printPlatingPackingList(pl);
  };
  const updatePlatingEta = async (poDocId, val) => {
      try { await updateDoc(doc(db, "hq_purchase_orders", poDocId), { expectedReceiveDate: val || null }); } catch (e) { console.error(e); }
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

  const renderDocument = () => {
      if (!activeDocJob) return null;

      const template = formTemplates['QUOTE'] || { header: '', footer: '', terms: '' };
      const logoUrl = brandLogos[activeBrand];

      let mathSection = '';
      if (activeDocJob.engineeringNotes) {
          const notes = activeDocJob.engineeringNotes;
          mathSection = `
              <div style="background: var(--paper-2); border: 1px solid var(--line); padding: 20px; margin-bottom: 20px;">
                  <h4 style="margin:0 0 15px 0; color: var(--ink); font-family: var(--serif); font-weight: 500; font-size: 1.2rem;">Engineering Dimensions</h4>
                  <table style="width: 100%; border-collapse: collapse; font-size: 13px; font-family: var(--sans);">
                      <tr>
                          <td style="padding: 8px; border-bottom: 1px solid var(--line); color: var(--ink-soft);">System O2O:</td>
                          <td style="padding: 8px; border-bottom: 1px solid var(--line); font-weight: 500;">${notes.systemO2O ? notes.systemO2O.toFixed(2) + '"' : 'N/A'}</td>
                      </tr>
                      <tr>
                          <td style="padding: 8px; border-bottom: 1px solid var(--line); color: var(--ink-soft);">System C2C:</td>
                          <td style="padding: 8px; border-bottom: 1px solid var(--line); font-weight: 500;">${notes.systemC2C ? notes.systemC2C.toFixed(2) + '"' : 'N/A'}</td>
                      </tr>
                      ${notes.shape === 'MITERED' ? `
                      <tr>
                          <td style="padding: 8px; border-bottom: 1px solid var(--line); color: var(--ink-soft);">Left Wall C2C:</td>
                          <td style="padding: 8px; border-bottom: 1px solid var(--line); font-weight: 500;">${notes.pole1 ? notes.pole1.toFixed(2) + '"' : 'N/A'}</td>
                      </tr>
                      ` : ''}
                      <tr>
                          <td style="padding: 8px; border-bottom: 1px solid var(--line); color: var(--ink-soft);">${notes.shape === 'STRAIGHT' ? 'Main Wall C2C:' : 'Center Wall C2C:'}</td>
                          <td style="padding: 8px; border-bottom: 1px solid var(--line); font-weight: 500;">${notes.pole2 ? notes.pole2.toFixed(2) + '"' : 'N/A'}</td>
                      </tr>
                      ${notes.shape === 'MITERED' ? `
                      <tr>
                          <td style="padding: 8px; border-bottom: 1px solid var(--line); color: var(--ink-soft);">Right Wall C2C:</td>
                          <td style="padding: 8px; border-bottom: 1px solid var(--line); font-weight: 500;">${notes.pole3 ? notes.pole3.toFixed(2) + '"' : 'N/A'}</td>
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
          <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 9999, overflowY: 'auto', padding: '40px 0' }}>
              <div style={{ position: 'relative' }}>
                  <div className="no-print" style={{ position: 'absolute', top: 0, right: '-160px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <button onClick={() => window.print()} style={{ padding: '16px 24px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>Print PDF</button>
                      <button onClick={() => setActiveDocJob(null)} style={{ padding: '16px 24px', background: '#fff', color: 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>Close</button>
                  </div>

                  <div id="printable-document" style={{ width: '8.5in', display: 'flex', flexDirection: 'column', gap: '30px' }}>
                      
                      {/* PAGE 1: QUOTE */}
                      {renderQuote && (
                          <div className="pdf-page" style={{ background: '#fff', width: '100%', minHeight: '11in', padding: '0.6in', boxSizing: 'border-box', fontFamily: 'var(--sans)', color: 'var(--ink)', boxShadow: '0 12px 48px rgba(0,0,0,0.05)', position: 'relative' }}>
                              <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: '20px', marginBottom: '30px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                                  {logoUrl ? (
                                      <img src={logoUrl} alt={activeBrand} style={{ height: '60px', objectFit: 'contain' }} />
                                  ) : (
                                      <div style={{ fontFamily: 'var(--serif)', fontSize: '28px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', lineHeight: 1 }}>{activeBrand}</div>
                                  )}
                                  <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink-soft)', letterSpacing: '.15em', textTransform: 'uppercase' }}>Official Quote</div>
                              </div>

                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px', marginBottom: '40px' }}>
                                  <div>
                                      <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Prepared For</div>
                                      <div style={{ fontSize: '15px', fontWeight: 500, marginTop: '6px' }}>{activeDocJob.customer?.name || activeDocJob.clientName || 'N/A'}</div>
                                      {activeCrmRecord?.billingAddress && <div style={{ fontSize: '13px', marginTop: '6px', whiteSpace: 'pre-wrap', color: 'var(--ink-soft)' }}>{activeCrmRecord.billingAddress}</div>}
                                  </div>
                                  <div>
                                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                          <div>
                                              <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Document ID</div>
                                              <div style={{ fontSize: '14px', fontWeight: 500, marginTop: '4px' }}>{activeDocJob.jobId || activeDocJob.id}</div>
                                          </div>
                                          <div>
                                              <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Date</div>
                                              <div style={{ fontSize: '14px', fontWeight: 500, marginTop: '4px' }}>{activeDocJob.dateSaved || new Date().toLocaleDateString()}</div>
                                          </div>
                                          <div style={{ gridColumn: 'span 2' }}>
                                              <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Project / Sidemark</div>
                                              <div style={{ fontSize: '15px', fontWeight: 500, color: 'var(--ink)', marginTop: '4px' }}>{activeDocJob.sidemark || activeDocJob.note || 'N/A'}</div>
                                          </div>
                                      </div>
                                  </div>
                              </div>

                              {template.header && <div style={{ marginBottom: '30px', fontSize: '13px', whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>{template.header}</div>}

                              <div style={{ border: '1px solid var(--line)', marginBottom: '40px', padding: '24px' }}>
                                  <div style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, marginBottom: '20px', borderBottom: '1px solid var(--line)', paddingBottom: '10px' }}>Configuration Details</div>
                                  {activeDocJob.cpqData?.breakdown ? (
                                      activeDocJob.cpqData.breakdown.map((item, i) => (
                                          <div key={i} style={{ display: 'flex', padding: '12px 0', borderBottom: '1px solid rgba(28,26,22,.08)', fontSize: '13px' }}>
                                              <span style={{ flex: 3 }}>{item.name}</span>
                                              <span style={{ flex: 1, textAlign: 'center', color: 'var(--ink-soft)' }}>Qty: {item.qty}</span>
                                              <span style={{ flex: 1, textAlign: 'right' }}>${item.total.toFixed(2)}</span>
                                          </div>
                                      ))
                                  ) : (
                                      <div style={{ padding: '20px', fontStyle: 'italic', color: 'var(--ink-soft)', textAlign: 'center' }}>No line items configured.</div>
                                  )}
                                  {activeDocJob.cpqData?.totalPrice && (
                                      <div style={{ display: 'flex', paddingTop: '20px', marginTop: '10px', borderTop: '1px solid var(--line)', fontSize: '16px', fontWeight: 500 }}>
                                          <span style={{ flex: 4, textAlign: 'right', paddingRight: '30px', fontFamily: 'var(--serif)' }}>Total Estimate</span>
                                          <span style={{ flex: 1, textAlign: 'right' }}>${activeDocJob.cpqData.totalPrice.toFixed(2)}</span>
                                      </div>
                                  )}
                              </div>

                              {template.footer && <div style={{ marginBottom: '20px', fontSize: '13px', whiteSpace: 'pre-wrap', lineHeight: '1.6', borderTop: '1px solid var(--line)', paddingTop: '20px' }}>{template.footer}</div>}
                              {template.terms && <div style={{ marginTop: '40px', fontSize: '10px', color: 'var(--ink-soft)', whiteSpace: 'pre-wrap', lineHeight: '1.5', borderTop: '1px solid var(--line)', paddingTop: '20px' }}>{template.terms}</div>}

                              <div style={{ marginTop: '60px', display: 'flex', justifyContent: 'space-between', gap: '40px' }}>
                                  <div style={{ flex: 1, borderTop: '1px solid var(--line)', paddingTop: '8px', fontSize: '10px', fontFamily: 'var(--mono)', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Client Approval Signature</div>
                                  <div style={{ width: '200px', borderTop: '1px solid var(--line)', paddingTop: '8px', fontSize: '10px', fontFamily: 'var(--mono)', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Date</div>
                              </div>
                          </div>
                      )}

                      {/* PAGE 2: FACTORY ROUTER (Internal BOM/Math) */}
                      {renderRouter && (
                          <div className="pdf-page" style={{ background: '#fff', width: '100%', minHeight: '11in', padding: '0.6in', boxSizing: 'border-box', fontFamily: 'var(--sans)', color: 'var(--ink)', boxShadow: '0 12px 48px rgba(0,0,0,0.05)', position: 'relative' }}>
                              <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: '20px', marginBottom: '30px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                                  <div>
                                      <div style={{ fontFamily: 'var(--serif)', fontSize: '28px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', lineHeight: 1 }}>{activeBrand}</div>
                                      <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', marginTop: '8px', letterSpacing: '.1em', textTransform: 'uppercase' }}>Manufacturing Division</div>
                                  </div>
                                  <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink-soft)', letterSpacing: '.15em', textTransform: 'uppercase' }}>Factory Router</div>
                              </div>

                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px', marginBottom: '40px' }}>
                                  <div>
                                      <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Prepared For</div>
                                      <div style={{ fontSize: '15px', fontWeight: 500, marginTop: '6px' }}>{activeDocJob.customer?.name || activeDocJob.clientName || 'N/A'}</div>
                                  </div>
                                  <div>
                                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                          <div>
                                              <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Work Order ID</div>
                                              <div style={{ fontSize: '14px', fontWeight: 500, marginTop: '4px' }}>{activeDocJob.jobId || activeDocJob.id}</div>
                                          </div>
                                          <div>
                                              <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Date Engineered</div>
                                              <div style={{ fontSize: '14px', fontWeight: 500, marginTop: '4px' }}>{activeDocJob.dateSaved || new Date().toLocaleDateString()}</div>
                                          </div>
                                          <div style={{ gridColumn: 'span 2' }}>
                                              <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Project / Sidemark</div>
                                              <div style={{ fontSize: '15px', fontWeight: 500, color: 'var(--ink)', marginTop: '4px' }}>{activeDocJob.sidemark || activeDocJob.note || 'N/A'}</div>
                                          </div>
                                      </div>
                                  </div>
                              </div>

                              {activeDocJob.engineeringNotes && <div dangerouslySetInnerHTML={{ __html: mathSection }} />}

                              <div style={{ border: '1px solid var(--line)', marginBottom: '40px', padding: '24px' }}>
                                  <div style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, marginBottom: '20px', borderBottom: '1px solid var(--line)', paddingBottom: '10px' }}>Bill of Materials</div>
                                  <div style={{ display: 'flex', paddingBottom: '12px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', letterSpacing: '.1em' }}>
                                      <span style={{ flex: 3 }}>Component / Material</span>
                                      <span style={{ flex: 1, textAlign: 'right' }}>Req. Qty</span>
                                  </div>

                                  {activeDocJob.cpqData?.breakdown ? (
                                      activeDocJob.cpqData.breakdown.map((item, i) => (
                                          <div key={i} style={{ display: 'flex', padding: '12px 0', borderBottom: '1px solid rgba(28,26,22,.08)', fontSize: '13px' }}>
                                              <span style={{ flex: 3, fontWeight: 500 }}>{item.name}</span>
                                              <span style={{ flex: 1, textAlign: 'right', fontSize: '14px', fontWeight: 500 }}>{item.qty}</span>
                                          </div>
                                      ))
                                  ) : (
                                      <div style={{ padding: '20px', fontStyle: 'italic', color: 'var(--ink-soft)', textAlign: 'center' }}>No line items configured.</div>
                                  )}
                              </div>

                              {!activeDocJob.engineeringNotes && (
                                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--ink-soft)', fontFamily: 'var(--serif)', fontStyle: 'italic', border: '1px solid var(--line)', marginBottom: '20px', background: 'var(--paper)' }}>
                                      No engineering dimensions attached to this configuration.
                                  </div>
                              )}

                              <div style={{ marginTop: '60px', display: 'flex', justifyContent: 'space-between', gap: '40px' }}>
                                  <div style={{ flex: 1, borderTop: '1px solid var(--line)', paddingTop: '8px', fontSize: '10px', fontFamily: 'var(--mono)', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Fabrication Sign-Off</div>
                                  <div style={{ width: '200px', borderTop: '1px solid var(--line)', paddingTop: '8px', fontSize: '10px', fontFamily: 'var(--mono)', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Date</div>
                              </div>
                          </div>
                      )}

                      {/* PAGE 3: DRAWING */}
                      {isFullPacket && linkedDrawing && (
                          <div className="pdf-page" style={{ background: '#fff', width: '100%', minHeight: '11in', padding: '0.6in', boxSizing: 'border-box', fontFamily: 'var(--sans)', color: 'var(--ink)', boxShadow: '0 12px 48px rgba(0,0,0,0.05)', position: 'relative' }}>
                              <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: '20px', marginBottom: '30px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                                  <div>
                                      <div style={{ fontFamily: 'var(--serif)', fontSize: '28px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', lineHeight: 1 }}>{activeBrand}</div>
                                      <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', marginTop: '8px', letterSpacing: '.1em', textTransform: 'uppercase' }}>Engineering Drawing</div>
                                  </div>
                                  <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink-soft)', letterSpacing: '.15em', textTransform: 'uppercase' }}>Shop Drawing</div>
                              </div>

                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '40px' }}>
                                  <div>
                                      <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Document ID</div>
                                      <div style={{ fontSize: '14px', fontWeight: 500, marginTop: '4px' }}>{activeDocJob.jobId || activeDocJob.id}</div>
                                  </div>
                                  <div>
                                      <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Project / Sidemark</div>
                                      <div style={{ fontSize: '15px', fontWeight: 500, color: 'var(--ink)', marginTop: '4px' }}>{activeDocJob.sidemark || activeDocJob.note || 'N/A'}</div>
                                  </div>
                              </div>

                              <div style={{ border: '1px solid var(--line)', padding: '20px', background: '#fff' }}>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '30px', fontFamily: 'var(--sans)', backgroundColor: 'transparent', minHeight: '100vh' }}>
      
      <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: '4px' }}>Customer Relationship & Pipeline</span>
            <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>External Co-op</h2>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '24px', alignItems: 'stretch' }}>
          
          <div style={{ width: '250px', background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', flexShrink: 0, borderRadius: '2px', overflow: 'hidden' }}>
              <button onClick={() => { setActiveSubTab('CUSTOMERS'); setActiveCrmRecord(null); }} style={{ padding: '16px 20px', textAlign: 'left', background: activeSubTab === 'CUSTOMERS' ? 'var(--paper-2)' : '#fff', color: activeSubTab === 'CUSTOMERS' ? 'var(--ink)' : 'var(--ink-soft)', border: 'none', borderBottom: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', cursor: 'pointer', borderLeft: activeSubTab === 'CUSTOMERS' ? '2px solid var(--brass)' : '2px solid transparent', transition: 'all 0.2s ease' }}>Customer CRM</button>
              <button onClick={() => { setActiveSubTab('VENDORS'); setActiveCrmRecord(null); }} style={{ padding: '16px 20px', textAlign: 'left', background: activeSubTab === 'VENDORS' ? 'var(--paper-2)' : '#fff', color: activeSubTab === 'VENDORS' ? 'var(--ink)' : 'var(--ink-soft)', border: 'none', borderBottom: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', cursor: 'pointer', borderLeft: activeSubTab === 'VENDORS' ? '2px solid var(--brass)' : '2px solid transparent', transition: 'all 0.2s ease' }}>Vendor / Co-op CRM</button>
              <button onClick={() => { setActiveSubTab('PIPELINE'); setActiveCrmRecord(null); }} style={{ padding: '16px 20px', textAlign: 'left', background: activeSubTab === 'PIPELINE' ? 'var(--paper-2)' : '#fff', color: activeSubTab === 'PIPELINE' ? 'var(--ink)' : 'var(--ink-soft)', border: 'none', borderBottom: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', cursor: 'pointer', borderLeft: activeSubTab === 'PIPELINE' ? '2px solid var(--brass)' : '2px solid transparent', transition: 'all 0.2s ease' }}>Global Pipeline</button>
          </div>

          <div style={{ flex: 1, background: '#fff', border: '1px solid var(--line)', minHeight: '600px', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
              
              {['CUSTOMERS', 'VENDORS'].includes(activeSubTab) && (
                  <div style={{ display: 'flex', height: '100%' }}>
                      
                      <div style={{ width: '320px', borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', background: 'var(--paper)' }}>
                          <div style={{ padding: '20px 24px', background: 'var(--paper-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
                              <span style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)' }}>{activeSubTab === 'CUSTOMERS' ? 'Customers' : 'Vendors'}</span>
                              <button onClick={() => setShowNewCrmModal(true)} style={{ background: 'var(--ink)', color: '#fff', border: 'none', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', padding: '6px 12px', cursor: 'pointer' }}>Add New</button>
                          </div>
                          <div style={{ padding: '16px' }}>
                              <input 
                                  type="text" 
                                  value={crmSearchQuery} 
                                  onChange={e => setCrmSearchQuery(e.target.value)} 
                                  placeholder="Search by name, ID..." 
                                  style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} 
                              />
                          </div>
                          <div style={{ flex: 1, overflowY: 'auto' }}>
                              {getFilteredCrmRecords(activeSubTab === 'CUSTOMERS').length === 0 ? (
                                  <div style={{ padding: '24px', color: 'var(--ink-soft)', fontStyle: 'italic', textAlign: 'center', fontSize: '0.9rem', fontFamily: 'var(--serif)' }}>No records found.</div>
                              ) : (
                                  getFilteredCrmRecords(activeSubTab === 'CUSTOMERS').map(record => (
                                      <div 
                                          key={record.id} 
                                          onClick={() => setActiveCrmRecord(record)}
                                          style={{ 
                                              padding: '16px 20px', 
                                              borderBottom: '1px solid var(--line)', 
                                              cursor: 'pointer', 
                                              background: activeCrmRecord?.id === record.id ? '#fff' : 'transparent',
                                              borderLeft: activeCrmRecord?.id === record.id ? '2px solid var(--brass)' : '2px solid transparent',
                                              transition: 'all 0.2s ease'
                                          }}
                                      >
                                          <div style={{ fontWeight: 500, fontSize: '1rem', color: 'var(--ink)' }}>{record.name}</div>
                                          <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', marginTop: '6px' }}>ID: {record.id}</div>
                                      </div>
                                  ))
                              )}
                          </div>
                      </div>

                      <div style={{ flex: 1, padding: '30px', overflowY: 'auto', background: '#fff' }}>
                          {!activeCrmRecord ? (
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)', fontSize: '1.2rem' }}>
                                  Select a {activeSubTab === 'CUSTOMERS' ? 'customer' : 'vendor'} to view profile
                              </div>
                          ) : (
                              <div style={{ display: 'flex', gap: '30px', alignItems: 'flex-start' }}>
                                  
                                  {/* Left Panel: Profile & Financials */}
                                  <div style={{ flex: 1.5, display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                      
                                      <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '30px', borderRadius: '2px' }}>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--line)', paddingBottom: '16px', marginBottom: '24px' }}>
                                              <div>
                                                  <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>{activeCrmRecord.name}</h3>
                                                  <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', display: 'block', marginTop: '6px' }}>{activeCrmRecord.type} ID: {activeCrmRecord.id}</span>
                                              </div>
                                          </div>

                                          {/* Mini Dashboard for Financials */}
                                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', marginBottom: '30px', background: 'var(--paper-2)', padding: '24px', border: '1px solid var(--line)' }}>
                                              <div style={{ textAlign: 'center', borderRight: '1px solid var(--line)' }}>
                                                  <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '8px' }}>Open Orders</div>
                                                  <div style={{ fontFamily: 'var(--serif)', fontSize: '2rem', color: 'var(--ink)' }}>{activeCrmRecord.openOrders || 0}</div>
                                              </div>
                                              <div style={{ textAlign: 'center', borderRight: '1px solid var(--line)' }}>
                                                  <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '8px' }}>MTD Volume</div>
                                                  <div style={{ fontFamily: 'var(--serif)', fontSize: '2rem', color: 'var(--ink)' }}>${(activeCrmRecord.mtd || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</div>
                                              </div>
                                              <div style={{ textAlign: 'center' }}>
                                                  <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '8px' }}>YTD Volume</div>
                                                  <div style={{ fontFamily: 'var(--serif)', fontSize: '2rem', color: 'var(--ink)' }}>${(activeCrmRecord.ytd || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</div>
                                              </div>
                                          </div>

                                          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                              
                                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                                  <div>
                                                      <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Primary Contact</label>
                                                      <input value={activeCrmRecord.contact || ''} onChange={e => handleUpdateActiveCrmField('contact', e.target.value)} style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} />
                                                  </div>
                                                  <div>
                                                      <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Email</label>
                                                      <input value={activeCrmRecord.email || ''} onChange={e => handleUpdateActiveCrmField('email', e.target.value)} style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} />
                                                  </div>
                                                  <div>
                                                      <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Phone</label>
                                                      <input value={activeCrmRecord.phone || ''} onChange={e => handleUpdateActiveCrmField('phone', e.target.value)} style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} />
                                                  </div>
                                              </div>

                                              <div style={{ borderTop: '1px solid var(--line)', paddingTop: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                                  <div>
                                                      <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Sales Rep</label>
                                                      <select value={activeCrmRecord.salesRep || ''} onChange={e => handleUpdateActiveCrmField('salesRep', e.target.value)} style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }}>
                                                          <option value="">-- Unassigned --</option>
                                                          {(globalLists.salesReps || []).map(r => <option key={r} value={r}>{r}</option>)}
                                                      </select>
                                                  </div>
                                                  <div>
                                                      <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Payment Terms</label>
                                                      <select value={activeCrmRecord.terms || ''} onChange={e => handleUpdateActiveCrmField('terms', e.target.value)} style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }}>
                                                          <option value="">-- Select Terms --</option>
                                                          {(globalLists.paymentTerms || []).map(t => <option key={t} value={t}>{t}</option>)}
                                                      </select>
                                                  </div>
                                                  <div>
                                                      <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Credit Limit ($)</label>
                                                      <input type="number" value={activeCrmRecord.creditLimit || ''} onChange={e => handleUpdateActiveCrmField('creditLimit', parseFloat(e.target.value)||0)} style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} />
                                                  </div>
                                                  <div>
                                                      <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Discount Tier</label>
                                                      <select value={activeCrmRecord.discountCode || ''} onChange={e => handleUpdateActiveCrmField('discountCode', e.target.value)} style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }}>
                                                          <option value="">-- No Discount --</option>
                                                          {crmDiscounts.map(d => <option key={d.code} value={d.code}>{d.code} (-{d.percent}%)</option>)}
                                                      </select>
                                                  </div>
                                              </div>

                                              <div style={{ borderTop: '1px solid var(--line)', paddingTop: '20px' }}>
                                                  <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Billing Address</label>
                                                  <textarea value={activeCrmRecord.billingAddress || ''} onChange={e => handleUpdateActiveCrmField('billingAddress', e.target.value)} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', resize: 'vertical', minHeight: '80px', outline: 'none', fontFamily: 'var(--sans)' }} />
                                              </div>
                                              
                                              <div style={{ marginTop: '10px', borderTop: '1px solid var(--line)', paddingTop: '20px' }}>
                                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                                      <h4 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500 }}>Saved Shipping Addresses</h4>
                                                  </div>
                                                  
                                                  {(activeCrmRecord.shippingAddresses || []).length === 0 ? (
                                                      <span style={{ fontSize: '0.9rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No shipping addresses synced.</span>
                                                  ) : (
                                                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '16px', maxHeight: '300px', overflowY: 'auto' }}>
                                                          {activeCrmRecord.shippingAddresses.map((addr, idx) => (
                                                              <div key={idx} style={{ 
                                                                  padding: '16px', 
                                                                  background: addr.isDefault ? 'var(--paper-2)' : '#fff', 
                                                                  border: '1px solid var(--line)', 
                                                                  borderLeft: addr.isDefault ? '2px solid var(--brass)' : '1px solid var(--line)'
                                                              }}>
                                                                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: '8px', marginBottom: '12px' }}>
                                                                      <span style={{ color: 'var(--ink)', fontSize: '0.9rem', fontWeight: 500 }}>{addr.label || 'Address'}</span>
                                                                      {addr.isDefault && <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--brass)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Default</span>}
                                                                  </div>
                                                                  
                                                                  <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', lineHeight: '1.5' }}>
                                                                      {addr.addressee && <div style={{ color: 'var(--ink)' }}>{addr.addressee}</div>}
                                                                      <div>{addr.addr1} {addr.addr2}</div>
                                                                      <div>{addr.city ? `${addr.city}, ` : ''}{addr.state} {addr.zip}</div>
                                                                  </div>
                                                                  
                                                                  <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', marginTop: '12px', textTransform: 'uppercase' }}>
                                                                      {addr.addressBookId ? `NS ID: ${addr.addressBookId}` : 'Manual Entry'}
                                                                  </div>
                                                              </div>
                                                          ))}
                                                      </div>
                                                  )}
                                              </div>
                                          </div>
                                      </div>

                                      <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                                          <h4 style={{ margin: '0 0 16px 0', fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, borderBottom: '1px solid var(--line)', paddingBottom: '10px' }}>Relationship Notes</h4>
                                          <textarea 
                                              value={activeCrmRecord.notes || ''}
                                              onChange={(e) => handleUpdateActiveCrmField('notes', e.target.value)}
                                              style={{ flex: 1, padding: '16px', border: '1px solid var(--line)', outline: 'none', resize: 'none', fontFamily: 'var(--sans)', fontSize: '0.9rem', background: 'var(--paper)' }}
                                              placeholder="Add strategic notes, preferences, or warnings here..."
                                          />
                                      </div>
                                  </div>

                                  {/* Right Panel: Active & Archived Pipeline with Collapsibles */}
                                  <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', display: 'flex', flexDirection: 'column', flex: 1 }}>

                                      {/* --- PLATING SHIPMENTS (vendors only) --- */}
                                      {activeSubTab === 'VENDORS' && (() => {
                                          const shipments = getVendorPlatingShipments(activeCrmRecord.id);
                                          return (
                                          <div style={{ marginBottom: '24px' }}>
                                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: '12px', marginBottom: '16px' }}>
                                                  <h4 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)' }}>Plating Shipments</h4>
                                                  <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>{shipments.length} sent</span>
                                              </div>
                                              {shipments.length === 0 ? (
                                                  <div style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.9rem', padding: '10px' }}>No plating shipments sent to this vendor yet. They appear here when the Pick Pack plating tool ships a pallet.</div>
                                              ) : (
                                                  <div style={{ maxHeight: '420px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                                      {shipments.map(po => {
                                                          const dateStr = po.createdAt?.seconds ? new Date(po.createdAt.seconds * 1000).toLocaleDateString() : (po.packingList?.dateStr || '');
                                                          return (
                                                          <div key={po.id} style={{ border: '1px solid var(--line)', padding: '16px', background: 'var(--paper)' }}>
                                                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                  <span style={{ fontWeight: 500, fontSize: '0.95rem', color: 'var(--ink)', fontFamily: 'var(--mono)' }}>{po.nsPoTran || po.poId}</span>
                                                                  <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', padding: '4px 8px', border: '1px solid var(--line)', background: '#fff' }}>{(po.status || 'Sent').replace(/_/g, ' ')}</span>
                                                              </div>
                                                              <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '8px' }}>
                                                                  {dateStr} · {po.pcs || 0} pcs / {(po.items || po.packingList?.lines || []).length} lines · ${Number(po.total || 0).toFixed(2)}{po.finishSummary ? ` · ${po.finishSummary}` : ''}
                                                              </div>
                                                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px' }}>
                                                                  <label style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-soft)' }}>Expected back</label>
                                                                  <input type="date" value={po.expectedReceiveDate || ''} onChange={e => updatePlatingEta(po.id, e.target.value)} style={{ padding: '6px 8px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.85rem' }} />
                                                              </div>
                                                              <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
                                                                  <button onClick={() => setActivePlatingPO(po)} style={{ flex: 1, padding: '8px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', background: 'var(--brass)', color: '#fff', border: 'none', cursor: 'pointer' }}>View Details</button>
                                                                  <button onClick={() => reprintPlatingPackingList(po)} style={{ flex: 1, padding: '8px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', background: '#fff', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer' }}>Reprint Packing List</button>
                                                              </div>
                                                          </div>
                                                          );
                                                      })}
                                                  </div>
                                              )}
                                          </div>
                                          );
                                      })()}

                                      {/* --- ACTIVE PIPELINE COLLAPSIBLE --- */}
                                      <div 
                                          onClick={() => setExpandedSections(prev => ({ ...prev, active: !prev.active }))}
                                          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: '12px', marginBottom: '16px', cursor: 'pointer' }}
                                      >
                                          <h4 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)' }}>Active Pipeline</h4>
                                          <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>{expandedSections.active ? '▼ HIDE' : '▶ SHOW'}</span>
                                      </div>
                                      
                                      {expandedSections.active && (
                                          <div style={{ maxHeight: '400px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
                                              {getCrmActivePipeline(activeCrmRecord.id).length === 0 && <div style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.9rem', padding: '10px' }}>No active configurations pending.</div>}
                                              {getCrmActivePipeline(activeCrmRecord.id).map(job => (
                                                  <div key={job.id} style={{ border: '1px solid var(--line)', padding: '16px', background: 'var(--paper)' }}>
                                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                          <span style={{ fontWeight: 500, fontSize: '0.95rem', color: 'var(--ink)' }}>{job.jobId || job.id}</span>
                                                          <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', padding: '4px 8px', border: '1px solid var(--line)', background: '#fff' }}>{job.status.replace(/_/g, ' ')}</span>
                                                      </div>
                                                      <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '8px' }}>{job.sidemark || job.note || 'No description'}</div>
                                                      {job.cpqData?.totalPrice && <div style={{ fontSize: '0.9rem', fontWeight: 500, marginTop: '8px', color: 'var(--ink)' }}>Est: ${job.cpqData.totalPrice.toFixed(2)}</div>}
                                                      
                                                      <div style={{ display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap' }}>
                                                          <button onClick={() => setCfgQuote(job.jobId || job.id)} style={{ flex: 1, padding: '8px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', background: 'var(--brass)', color: '#fff', border: 'none', cursor: 'pointer' }}>🔍 View Item</button>
                                                          {job.status === 'CONFIGURED' && (
                                                              <button onClick={() => updateJobStatus(job.id, 'APPROVED')} style={{ flex: 1, padding: '8px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer' }}>Approve</button>
                                                          )}
                                                          <button onClick={() => window.location.href = `mailto:${activeCrmRecord.email || ''}?subject=Quote ${job.jobId || job.id} from ${activeBrand.toUpperCase()}&body=Please find attached the latest documentation for your review...`} style={{ flex: 1, padding: '8px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', background: '#fff', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer' }}>Email</button>
                                                          <button onClick={() => { setActiveDocJob(job); setActiveDocType('FULL_PACKET'); }} style={{ flex: 1, padding: '8px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', background: '#fff', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer' }}>Docs</button>
                                                          <button onClick={() => openEditJobModal(job)} style={{ flex: 1, padding: '8px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', background: '#fff', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer' }}>Modify</button>
                                                          <button onClick={() => handleDeleteJob(job.id)} style={{ flex: 1, padding: '8px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', background: '#fff', border: '1px solid #d9534f', color: '#d9534f', cursor: 'pointer' }}>Delete</button>
                                                      </div>
                                                  </div>
                                              ))}
                                          </div>
                                      )}

                                      {/* --- ARCHIVE PIPELINE COLLAPSIBLE --- */}
                                      <div 
                                          onClick={() => setExpandedSections(prev => ({ ...prev, archive: !prev.archive }))}
                                          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: '12px', marginBottom: '16px', cursor: 'pointer', marginTop: expandedSections.active ? '10px' : '0' }}
                                      >
                                          <h4 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink-soft)' }}>Historical & Archived</h4>
                                          <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>{expandedSections.archive ? '▼ HIDE' : '▶ SHOW'}</span>
                                      </div>
                                      
                                      {expandedSections.archive && (
                                          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '400px' }}>
                                              {getCrmArchivedPipeline(activeCrmRecord.id).length === 0 && <div style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.9rem', padding: '10px' }}>No historical jobs found.</div>}
                                              {getCrmArchivedPipeline(activeCrmRecord.id).map(job => (
                                                  <div key={job.id} style={{ border: '1px solid var(--line)', padding: '16px', background: '#fff', opacity: 0.8 }}>
                                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                          <span style={{ fontWeight: 500, fontSize: '0.9rem', color: 'var(--ink)' }}>{job.jobId || job.id}</span>
                                                          <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>{job.status.replace(/_/g, ' ')}</span>
                                                      </div>
                                                      <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginTop: '6px' }}>{job.sidemark || job.note || 'No description'}</div>
                                                      <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', marginTop: '8px' }}>Saved: {new Date(job.createdAt?.seconds * 1000).toLocaleDateString()}</div>
                                                      
                                                      <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                                                          <button onClick={() => { setActiveDocJob(job); setActiveDocType('FULL_PACKET'); }} style={{ flex: 1, padding: '8px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', background: 'var(--paper-2)', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer' }}>Docs</button>
                                                          <button onClick={() => openEditJobModal(job)} style={{ flex: 1, padding: '8px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', background: '#fff', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer' }}>Modify</button>
                                                          <button onClick={() => handleDeleteJob(job.id)} style={{ flex: 1, padding: '8px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', background: '#fff', border: '1px solid #d9534f', color: '#d9534f', cursor: 'pointer' }}>Delete</button>
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
                  <div style={{ padding: '30px', display: 'flex', flexDirection: 'column', gap: '30px', height: '100%', overflowY: 'auto', boxSizing: 'border-box' }}>
                      
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
                          <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '30px', textAlign: 'center' }}>
                              <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Active Configurations</div>
                              <div style={{ fontFamily: 'var(--serif)', fontSize: '3rem', color: 'var(--ink)', marginTop: '10px' }}>{counts.active}</div>
                          </div>
                          <div style={{ background: 'var(--paper-2)', border: '1px solid var(--line)', padding: '30px', textAlign: 'center' }}>
                              <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Pending Review</div>
                              <div style={{ fontFamily: 'var(--serif)', fontSize: '3rem', color: 'var(--ink)', marginTop: '10px' }}>{counts.pending}</div>
                          </div>
                          <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', padding: '30px', textAlign: 'center' }}>
                              <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Completed / Archived</div>
                              <div style={{ fontFamily: 'var(--serif)', fontSize: '3rem', color: 'var(--ink-soft)', marginTop: '10px' }}>{counts.complete}</div>
                          </div>
                      </div>

                      <div style={{ display: 'flex', gap: '15px', background: 'var(--paper-2)', padding: '20px', border: '1px solid var(--line)' }}>
                          <input type="text" placeholder="Search ID, Client, Sidemark..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} style={{ flex: 1, padding: '12px', fontSize: '0.95rem', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} />
                          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} />
                          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} />
                          <button onClick={() => { setSearchQuery(''); setStartDate(''); setEndDate(''); }} style={{ padding: '0 24px', background: '#fff', color: 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Clear</button>
                      </div>

                      <div style={{ flex: 1, background: '#fff', border: '1px solid var(--line)', overflowY: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontFamily: 'var(--sans)' }}>
                              <thead style={{ background: 'var(--paper)' }}>
                                  <tr>
                                      <th style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Job ID / Ref</th>
                                      <th style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Customer / Entity</th>
                                      <th style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Date Saved</th>
                                      <th style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Value</th>
                                      <th style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Status</th>
                                      <th style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}></th>
                                  </tr>
                              </thead>
                              <tbody>
                                  {filteredConfigured.length === 0 ? (
                                      <tr><td colSpan="6" style={{ padding: '30px', textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No pipeline jobs found.</td></tr>
                                  ) : (
                                      filteredConfigured.map(job => (
                                          <tr key={job.id} style={{ borderBottom: '1px solid var(--line)', background: job.status === 'APPROVED' ? 'var(--paper)' : '#fff' }}>
                                              <td style={{ padding: '16px 20px' }}>
                                                  <div style={{ fontWeight: 500, color: 'var(--ink)' }}>{job.jobId || job.id}</div>
                                                  <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '4px' }}>{job.sidemark || job.note || 'No description'}</div>
                                              </td>
                                              <td style={{ padding: '16px 20px', color: 'var(--ink)' }}>{job.customer?.name || job.clientName || 'N/A'}</td>
                                              <td style={{ padding: '16px 20px', color: 'var(--ink-soft)', fontSize: '0.9rem' }}>{job.dateSaved || new Date(job.createdAt?.seconds * 1000).toLocaleDateString() || 'N/A'}</td>
                                              <td style={{ padding: '16px 20px', color: 'var(--ink)' }}>{job.cpqData?.totalPrice ? `$${job.cpqData.totalPrice.toFixed(2)}` : 'N/A'}</td>
                                              <td style={{ padding: '16px 20px' }}>
                                                  <span style={{ 
                                                      background: job.status === 'APPROVED' ? 'transparent' : 'var(--paper-2)', 
                                                      border: '1px solid var(--line)',
                                                      color: 'var(--ink)', padding: '6px 12px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em' 
                                                  }}>
                                                      {job.status.replace(/_/g, ' ')}
                                                  </span>
                                              </td>
                                              <td style={{ padding: '16px 20px', textAlign: 'right' }}>
                                                  {job.status === 'CONFIGURED' && (
                                                      <button onClick={() => updateJobStatus(job.id, 'APPROVED')} style={{ padding: '8px 16px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', marginRight: '8px', marginBottom: '8px' }}>Approve</button>
                                                  )}
                                                  <button onClick={() => setCfgQuote(job.jobId || job.id)} style={{ padding: '8px 16px', background: 'var(--brass)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', marginRight: '8px', marginBottom: '8px' }}>🔍 View Item</button>
                                                  <button onClick={() => { setActiveDocJob(job); setActiveDocType('FULL_PACKET'); }} style={{ padding: '8px 16px', background: '#fff', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', marginRight: '8px', marginBottom: '8px' }}>Docs</button>
                                                  <button onClick={() => openEditJobModal(job)} style={{ padding: '8px 16px', background: '#fff', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', marginRight: '8px', marginBottom: '8px' }}>Modify</button>
                                                  <button onClick={() => handleDeleteJob(job.id)} style={{ padding: '8px 16px', background: '#fff', border: '1px solid #d9534f', color: '#d9534f', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Delete</button>
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

      {cfgQuote && <ConfiguredItemViewer quoteId={cfgQuote} onClose={() => setCfgQuote(null)} />}

      {activePlatingPO && (() => {
          const po = activePlatingPO;
          const lines = po.packingList?.lines || (po.items || []).map(it => ({ erpId: it.itemId, itemName: it.description, finishCode: it.finishCode, targetErpId: it.targetErpId, platingBin: it.platingBin, woNum: it.woNum, qty: it.quantity }));
          const dateStr = po.createdAt?.seconds ? new Date(po.createdAt.seconds * 1000).toLocaleDateString() : (po.packingList?.dateStr || '');
          return (
          <div onClick={() => setActivePlatingPO(null)} style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
              <div onClick={e => e.stopPropagation()} style={{ background: '#fff', border: '1px solid var(--line)', boxShadow: '0 12px 48px rgba(0,0,0,0.1)', borderRadius: '2px', width: '780px', maxHeight: '85vh', overflowY: 'auto', padding: '32px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--line)', paddingBottom: '16px', marginBottom: '20px' }}>
                      <div>
                          <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)' }}>Plating Shipment {po.nsPoTran || po.poId}</h3>
                          <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', display: 'block', marginTop: '6px' }}>{po.vendor} · {dateStr} · {(po.status || 'Sent').replace(/_/g, ' ')}</span>
                      </div>
                      <button onClick={() => setActivePlatingPO(null)} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--ink-soft)', lineHeight: 1 }}>×</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '20px' }}>
                      {[['NetSuite PO', po.nsPoTran || po.nsPoId || '—'], ['Ship ID', po.poId || po.shipmentId], ['Finish(es)', po.finishSummary || '—'], ['Pieces', po.pcs || 0], ['Lines', lines.length], ['Plating Total', `$${Number(po.total || 0).toFixed(2)}`], ['Prepared by', po.createdBy || '—'], ['Expected back', po.expectedReceiveDate || '—']].map(([k, v]) => (
                          <div key={k}><div style={{ fontFamily: 'var(--mono)', fontSize: '8px', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-soft)' }}>{k}</div><div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--ink)', marginTop: '2px' }}>{v}</div></div>
                      ))}
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                      <thead><tr>{['#', 'Item', 'Description', 'Finish', 'Returns As', 'Bin', 'WO#', 'Qty'].map(h => <th key={h} style={{ textAlign: h === 'Qty' ? 'right' : 'left', borderBottom: '1px solid var(--line)', padding: '8px', fontFamily: 'var(--mono)', fontSize: '8px', textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-soft)' }}>{h}</th>)}</tr></thead>
                      <tbody>
                          {lines.map((l, i) => (
                              <tr key={i}>
                                  <td style={{ padding: '8px', borderBottom: '1px solid var(--paper-2)', color: 'var(--ink-soft)' }}>{i + 1}</td>
                                  <td style={{ padding: '8px', borderBottom: '1px solid var(--paper-2)', fontFamily: 'var(--mono)', fontSize: '0.8rem' }}>{l.erpId}</td>
                                  <td style={{ padding: '8px', borderBottom: '1px solid var(--paper-2)' }}>{l.itemName}</td>
                                  <td style={{ padding: '8px', borderBottom: '1px solid var(--paper-2)' }}>{l.finishCode}</td>
                                  <td style={{ padding: '8px', borderBottom: '1px solid var(--paper-2)', fontFamily: 'var(--mono)', fontSize: '0.8rem' }}>{l.targetErpId}</td>
                                  <td style={{ padding: '8px', borderBottom: '1px solid var(--paper-2)' }}>{l.platingBin}</td>
                                  <td style={{ padding: '8px', borderBottom: '1px solid var(--paper-2)' }}>{l.woNum}</td>
                                  <td style={{ padding: '8px', borderBottom: '1px solid var(--paper-2)', textAlign: 'right' }}>{l.qty}</td>
                              </tr>
                          ))}
                      </tbody>
                  </table>
                  <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
                      <button onClick={() => reprintPlatingPackingList(po)} style={{ flex: 1, padding: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer' }}>Reprint Packing List</button>
                      <button onClick={() => setActivePlatingPO(null)} style={{ padding: '12px 24px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', background: '#fff', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer' }}>Close</button>
                  </div>
              </div>
          </div>
          );
      })()}

      {showNewCrmModal && (
          <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
              <div style={{ background: '#fff', border: '1px solid var(--line)', width: '500px', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 48px rgba(0,0,0,0.1)', borderRadius: '2px' }}>
                  <div style={{ padding: '24px 30px', background: 'var(--paper-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
                      <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>Add New {activeSubTab === 'CUSTOMERS' ? 'Customer' : 'Vendor'}</h2>
                      <button onClick={() => setShowNewCrmModal(false)} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', fontSize: '1.5rem', cursor: 'pointer' }}>×</button>
                  </div>
                  <div style={{ padding: '30px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      <div>
                          <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Company / Entity Name *</label>
                          <input value={newCrmForm.name} onChange={e => setNewCrmForm({...newCrmForm, name: e.target.value})} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                          <div>
                              <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Primary Contact</label>
                              <input value={newCrmForm.contact} onChange={e => setNewCrmForm({...newCrmForm, contact: e.target.value})} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} />
                          </div>
                          <div>
                              <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Email</label>
                              <input value={newCrmForm.email} onChange={e => setNewCrmForm({...newCrmForm, email: e.target.value})} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} />
                          </div>
                      </div>
                      <button onClick={handleCreateNewCrm} style={{ width: '100%', padding: '16px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', marginTop: '10px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                          Create Profile
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* --- EDIT JOB MODAL --- */}
      {showEditJobModal && (
          <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
              <div style={{ background: '#fff', border: '1px solid var(--line)', width: '400px', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 48px rgba(0,0,0,0.1)', borderRadius: '2px' }}>
                  <div style={{ padding: '24px 30px', background: 'var(--paper-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
                      <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>Modify Quote / Job</h2>
                      <button onClick={() => setShowEditJobModal(false)} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', fontSize: '1.5rem', cursor: 'pointer' }}>×</button>
                  </div>
                  <div style={{ padding: '30px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      <div>
                          <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Project / Job Name</label>
                          <input value={editJobForm.jobName} onChange={e => setEditJobForm({...editJobForm, jobName: e.target.value})} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} />
                      </div>
                      <div>
                          <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Global Sidemark</label>
                          <input value={editJobForm.sidemark} onChange={e => setEditJobForm({...editJobForm, sidemark: e.target.value})} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} />
                      </div>
                      <div>
                          <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Pipeline Status</label>
                          <select value={editJobForm.status} onChange={e => setEditJobForm({...editJobForm, status: e.target.value})} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }}>
                              <option value="CONFIGURED">Configured (Pending Review)</option>
                              <option value="SENT_TO_CLIENT">Sent To Client</option>
                              <option value="REVISION_REQUESTED">Revision Requested</option>
                              <option value="APPROVED">Approved</option>
                              <option value="IN_PRODUCTION">In Production</option>
                              <option value="COMPLETED">Completed</option>
                              <option value="SHIPPED">Shipped</option>
                              <option value="CANCELLED">Cancelled</option>
                          </select>
                      </div>
                      <button onClick={handleSaveJobEdit} style={{ width: '100%', padding: '16px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', marginTop: '10px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                          Save Changes
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