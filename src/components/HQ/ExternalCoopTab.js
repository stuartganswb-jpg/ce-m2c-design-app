import React, { useState, useEffect } from 'react';
import { db, storage, functions } from '../../firebase';
import { httpsCallable } from 'firebase/functions';
import { collection, onSnapshot, query, where, doc, updateDoc, setDoc, deleteDoc } from "firebase/firestore";
import { ref, deleteObject } from "firebase/storage";
import ConfiguredItemViewer from '../Shared/ConfiguredItemViewer';
import QuickShipInvoiceModal from '../Shared/QuickShipInvoiceModal';
import FormPreview from '../Shared/FormPreview';
import { printPlatingPackingList } from '../Shared/platingPackingList';
import { downloadPlatingOrderPdf } from '../Shared/platingOrderPdf';
import { reopenQuoteInCpq, reopenQuoteInVision } from '../Shared/reopenQuote';

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

// ---- PORTAL ACCESS (customer logins for portal.classicalelements.com) --------------------------
// People at this customer who can sign into the client portal. Creation/disable/removal go through
// admin-gated Cloud Functions (createPortalUser & co.) — the panel never writes portal_users
// directly (rules: server-write-only). Reading portal_users requires an admin role claim, so
// non-admin staff see a quiet "admins only" note instead of the list.
const PortalAccessPanel = ({ customer, activeBrand }) => {
  const customerId = customer?.id;
  const [users, setUsers] = useState(null);      // null = loading/denied, [] = none
  const [denied, setDenied] = useState(false);
  const [form, setForm] = useState({ name: '', email: '' });
  const [busy, setBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState(null); // { email, link } of the latest created user

  // The CPQ flow is the customer-entitlement unit: an assigned flow's assembly (and its BOM)
  // defines everything the customer may see in the portal — showroom, and later gallery/stock/CPQ.
  // Local mirror of crm_records.portalFlowIds (the parent's selected-record state doesn't live-update).
  const [brandFlows, setBrandFlows] = useState([]);
  const [assignedFlowIds, setAssignedFlowIds] = useState([]);
  useEffect(() => { setAssignedFlowIds(customer?.portalFlowIds || []); }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setUsers(null); setDenied(false); setInviteLink(null);
    if (!customerId) return;
    const q = query(collection(db, 'portal_users'), where('customerId', '==', customerId));
    const unsub = onSnapshot(q,
      (snap) => setUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() }))),
      () => { setDenied(true); setUsers([]); });
    return unsub;
  }, [customerId]);

  useEffect(() => {
    const brand = customer?.brandId || activeBrand;
    if (!brand) { setBrandFlows([]); return; }
    const q = query(collection(db, 'cpq_flows'), where('brandId', '==', brand));
    const unsub = onSnapshot(q, (snap) => setBrandFlows(
      snap.docs.map(d => ({ id: d.id, name: d.data().name || d.id, linkedAssemblyId: d.data().linkedAssemblyId || null }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    ), () => setBrandFlows([]));
    return unsub;
  }, [customerId, customer?.brandId, activeBrand]);

  const toggleFlow = async (flowId) => {
    const next = assignedFlowIds.includes(flowId)
      ? assignedFlowIds.filter(f => f !== flowId)
      : [...assignedFlowIds, flowId];
    setAssignedFlowIds(next);
    try { await updateDoc(doc(db, 'crm_records', customerId), { portalFlowIds: next }); }
    catch (e) { setAssignedFlowIds(assignedFlowIds); alert('Could not update flow access: ' + (e.message || e)); }
  };

  // The price level THIS customer sees in the portal. Customer-safe options only — FAB_COST
  // (CE→Fabricut cost) is intentionally NOT offered, so a customer can never see cost.
  const PORTAL_PRICE_LEVELS = [
    { id: 'STANDARD', label: 'Your Price (client pricing)' },
    { id: 'FAB_WHOLESALE', label: 'Fabricut Wholesale' },
    { id: 'FAB_RETAIL', label: 'Fabricut Retail (MSRP)' },
  ];
  const [priceLevel, setPriceLevel] = useState('STANDARD');
  useEffect(() => { setPriceLevel(customer?.portalPriceLevel || 'STANDARD'); }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps
  const changePriceLevel = async (lvl) => {
    setPriceLevel(lvl);
    try { await updateDoc(doc(db, 'crm_records', customerId), { portalPriceLevel: lvl }); }
    catch (e) { alert('Could not update price level: ' + (e.message || e)); }
  };

  const call = async (fn, args, okMsg) => {
    setBusy(true);
    try {
      const res = await httpsCallable(functions, fn)(args);
      if (okMsg) alert(okMsg);
      return res.data;
    } catch (e) {
      alert('Portal action failed: ' + (e.message || e));
      return null;
    } finally { setBusy(false); }
  };

  const handleAdd = async () => {
    if (!form.email) return alert('Email is required.');
    const data = await call('createPortalUser', { customerId, email: form.email, name: form.name });
    if (data?.setupLink) {
      setInviteLink({ email: form.email.trim().toLowerCase(), link: data.setupLink });
      setForm({ name: '', email: '' });
    }
  };

  const copyLink = async (link) => {
    try { await navigator.clipboard.writeText(link); alert('Setup link copied — email it to the client. It lets them set their password.'); }
    catch (e) { window.prompt('Copy the setup link:', link); }
  };

  const handleReinvite = async (u) => {
    const data = await call('getPortalUserSetupLink', { uid: u.uid });
    if (data?.setupLink) { setInviteLink({ email: u.email, link: data.setupLink }); copyLink(data.setupLink); }
  };

  return (
    <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', marginBottom: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: '10px', marginBottom: '16px' }}>
        <h4 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500 }}>Portal Access</h4>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em' }}>portal.classicalelements.com</span>
      </div>

      {denied && <div style={{ fontFamily: 'var(--sans)', fontSize: '0.85rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>Managing portal logins requires an admin role.</div>}

      {!denied && (
        <>
          {users === null ? (
            <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>Loading…</div>
          ) : users.length === 0 ? (
            <div style={{ fontFamily: 'var(--sans)', fontSize: '0.85rem', color: 'var(--ink-soft)', fontStyle: 'italic', marginBottom: '14px' }}>No portal logins yet — add the first person below.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
              {users.map(u => (
                <div key={u.uid} style={{ display: 'flex', alignItems: 'center', gap: '10px', border: '1px solid var(--line)', padding: '10px 12px', background: u.active ? 'var(--paper)' : 'rgba(217,83,79,0.06)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontFamily: 'var(--sans)', fontSize: '0.9rem', color: 'var(--ink)' }}>{u.name || u.email}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', marginLeft: '10px' }}>{u.email}</span>
                    {!u.active && <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: '#d9534f', marginLeft: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Disabled</span>}
                  </div>
                  <button disabled={busy} onClick={() => handleReinvite(u)} title="Generate a fresh set-password link (re-invite / forgot password)" style={{ padding: '6px 10px', background: 'transparent', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-soft)' }}>Setup Link</button>
                  <button disabled={busy} onClick={() => call('setPortalUserStatus', { uid: u.uid, active: !u.active })} style={{ padding: '6px 10px', background: 'transparent', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', color: u.active ? '#a05a2c' : 'var(--brass)' }}>{u.active ? 'Disable' : 'Enable'}</button>
                  <button disabled={busy} onClick={() => { if (window.confirm(`Remove portal access for ${u.email}? They can no longer sign in.`)) call('deletePortalUser', { uid: u.uid }); }} style={{ padding: '6px 10px', background: 'transparent', border: '1px solid #d9534f', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', color: '#d9534f' }}>Remove</button>
                </div>
              ))}
            </div>
          )}

          {inviteLink && (
            <div style={{ border: '1px solid var(--brass)', background: 'var(--paper)', padding: '12px', marginBottom: '14px' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--brass)', marginBottom: '6px' }}>Setup link for {inviteLink.email} — email it to them (lets them set their password)</div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input readOnly value={inviteLink.link} onFocus={e => e.target.select()} style={{ flex: 1, padding: '8px', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', background: '#fff', outline: 'none' }} />
                <button onClick={() => copyLink(inviteLink.link)} style={{ padding: '8px 14px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Copy</button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px' }}>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Name" style={{ flex: 1, padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', fontSize: '0.9rem' }} />
            <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="email@company.com" type="email" style={{ flex: 1.4, padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', fontSize: '0.9rem' }} />
            <button disabled={busy || !form.email} onClick={handleAdd} style={{ padding: '10px 18px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: busy ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', opacity: !form.email ? 0.5 : 1 }}>{busy ? 'Working…' : '+ Add Login'}</button>
          </div>

          {/* Which CPQ flows this customer's portal may use. A flow's assembly + BOM defines
              everything they can see: showroom models, and later gallery/stock/configurator. */}
          <div style={{ marginTop: '22px', paddingTop: '16px', borderTop: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--ink-soft)' }}>Available CPQ Flows</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: assignedFlowIds.length ? 'var(--brass)' : 'var(--ink-soft)' }}>{assignedFlowIds.length ? `${assignedFlowIds.length} assigned` : 'none — portal shows nothing'}</span>
            </div>
            {brandFlows.length === 0 ? (
              <div style={{ fontFamily: 'var(--sans)', fontSize: '0.82rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No CPQ flows exist for this brand yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '180px', overflowY: 'auto' }}>
                {brandFlows.map(f => (
                  <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontFamily: 'var(--sans)', fontSize: '0.85rem', color: 'var(--ink)', cursor: 'pointer', padding: '6px 8px', border: '1px solid var(--line-soft, rgba(28,26,22,.07))', background: assignedFlowIds.includes(f.id) ? 'var(--paper)' : 'transparent' }}>
                    <input type="checkbox" checked={assignedFlowIds.includes(f.id)} onChange={() => toggleFlow(f.id)} style={{ accentColor: 'var(--brass)' }} />
                    <span style={{ flex: 1 }}>{f.name}</span>
                    {!f.linkedAssemblyId && <span title="This flow has no linked assembly — nothing will render in the portal showroom" style={{ fontFamily: 'var(--mono)', fontSize: '8px', color: '#a05a2c', textTransform: 'uppercase', letterSpacing: '.08em' }}>no assembly</span>}
                  </label>
                ))}
              </div>
            )}

            <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--ink-soft)' }}>Portal price level</span>
              <select value={priceLevel} onChange={e => changePriceLevel(e.target.value)} style={{ flex: 1, padding: '8px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.85rem', background: '#fff', outline: 'none' }}>
                {PORTAL_PRICE_LEVELS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '8px', color: 'var(--ink-soft)', marginTop: '6px', letterSpacing: '.04em' }}>The customer only ever sees this level — CE→Fabricut cost is never available in the portal.</div>
          </div>
        </>
      )}
    </div>
  );
};

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
  const [newContactInput, setNewContactInput] = useState({ name: '', email: '', department: '' });
  const [showListSetup, setShowListSetup] = useState(false);
  const [newTermInput, setNewTermInput] = useState('');
  const [newRepInput, setNewRepInput] = useState('');
  const [newDiscountInput, setNewDiscountInput] = useState({ code: '', percent: '' });
  
  const [globalLists, setGlobalLists] = useState({ customers: [], vendors: [], paymentTerms: [], salesReps: [] });
  const [crmDiscounts, setCrmDiscounts] = useState([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [activeModalJob, setActiveModalJob] = useState(null);
  const [cfgQuote, setCfgQuote] = useState(null); // read-only configured-item 3D viewer (opens a CONFIGURED job straight from the pipeline)
  const [qsOrders, setQsOrders] = useState([]);   // Quick Ship (stocked) orders — invoiced from the CRM
  const [qsInvoice, setQsInvoice] = useState(null); // Quick Ship invoice modal

  // Quick Ship orders live-feed: the customer card shows them with kit-grouped invoices
  // (customer pays the KIT price; NetSuite carries the per-item accounting lines).
  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'hq_sales_orders'), where('orderClass', '==', 'QUICKSHIP')), snap => {
      setQsOrders(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(o => o.brand === activeBrand));
    }, () => { /* none yet */ });
    return () => unsub();
  }, [activeBrand]);
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
  const [recordingReceipt, setRecordingReceipt] = useState(false);
  const [receiptDraft, setReceiptDraft] = useState({});         // { lineIndex: qty } being received now
  const [receiptNote, setReceiptNote] = useState('');

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

  const addCrmContact = async () => {
      if (!activeCrmRecord) return;
      const c = newContactInput;
      if (!c.name.trim() && !c.email.trim()) return alert("Enter at least a contact name or email.");
      const contacts = [...(activeCrmRecord.contacts || []), { name: c.name.trim(), email: c.email.trim(), department: c.department.trim() }];
      setActiveCrmRecord(prev => ({ ...prev, contacts }));
      setNewContactInput({ name: '', email: '', department: '' });
      try { await updateDoc(doc(db, "crm_records", activeCrmRecord.id), { contacts }); } catch (e) { console.error(e); }
  };
  const removeCrmContact = async (idx) => {
      if (!activeCrmRecord) return;
      const contacts = (activeCrmRecord.contacts || []).filter((_, i) => i !== idx);
      setActiveCrmRecord(prev => ({ ...prev, contacts }));
      try { await updateDoc(doc(db, "crm_records", activeCrmRecord.id), { contacts }); } catch (e) { console.error(e); }
  };

  // Generate the order PDF (downloads), then open a pre-addressed email to the vendor's contacts so the
  // operator attaches it. No server-side mail exists, so sending is via the operator's mail client.
  const emailPlatingOrder = async (po) => {
      const pl = po.packingList || {
          shipId: po.poId || po.shipmentId, brand: po.brand, vendor: po.vendor, poLabel: po.nsPoTran || po.nsPoId || '-',
          dateStr: po.createdAt?.seconds ? new Date(po.createdAt.seconds * 1000).toLocaleDateString() : '',
          operator: po.createdBy || '', finishSummary: po.finishSummary || '',
          lines: (po.items || []).map(it => ({ erpId: it.itemId, itemName: it.description, finishCode: it.finishCode, targetErpId: it.targetErpId, platingBin: it.platingBin, woNum: it.woNum, qty: it.quantity })),
          pcs: po.pcs, total: po.total
      };
      let fname;
      try { fname = await downloadPlatingOrderPdf({ ...pl, expectedReceiveDate: po.expectedReceiveDate }); }
      catch (e) { console.error(e); return alert("Could not build the order PDF: " + (e.message || e)); }
      const emails = [...new Set([activeCrmRecord?.email, ...(activeCrmRecord?.contacts || []).map(c => c.email)].filter(Boolean))];
      const subject = `Plating Order ${pl.poLabel || pl.shipId}${pl.brand ? ` — ${String(pl.brand).toUpperCase()}` : ''}`;
      const body = `Hello,\r\n\r\nPlease find attached our plating order ${pl.shipId} (${(pl.lines || []).length} line(s) / ${pl.pcs || 0} pcs).\r\n\r\nFinish(es): ${pl.finishSummary || '-'}\r\nNetSuite PO: ${pl.poLabel || '-'}\r\n\r\nThank you.`;
      alert(`📄 Order PDF "${fname}" downloaded. Your email is opening to ${emails.length ? emails.join(', ') : 'the vendor'} — attach that PDF before sending.`);
      window.location.href = `mailto:${emails.join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  // Setup/list managers — payment terms, sales reps, discount tiers (the dropdown OPTION lists).
  const saveMasterListKey = async (key, arr) => { try { await setDoc(doc(db, "system", "master_lists"), { [key]: arr }, { merge: true }); } catch (e) { console.error(e); alert('Save failed: ' + (e.message || e)); } };
  const addPaymentTerm = () => { const t = newTermInput.trim(); if (!t) return; saveMasterListKey('paymentTerms', [...new Set([...(globalLists.paymentTerms || []), t])]); setNewTermInput(''); };
  const removePaymentTerm = (t) => saveMasterListKey('paymentTerms', (globalLists.paymentTerms || []).filter(x => x !== t));
  const addSalesRep = () => { const t = newRepInput.trim(); if (!t) return; saveMasterListKey('salesReps', [...new Set([...(globalLists.salesReps || []), t])]); setNewRepInput(''); };
  const removeSalesRep = (t) => saveMasterListKey('salesReps', (globalLists.salesReps || []).filter(x => x !== t));
  const saveDiscounts = async (list) => { try { await setDoc(doc(db, "system", "crm_discounts"), { list }, { merge: true }); } catch (e) { console.error(e); alert('Save failed: ' + (e.message || e)); } };
  const addDiscountTier = () => { const code = newDiscountInput.code.trim().toUpperCase(); if (!code) return; const percent = parseFloat(newDiscountInput.percent) || 0; saveDiscounts([...crmDiscounts.filter(d => d.code !== code), { code, percent }]); setNewDiscountInput({ code: '', percent: '' }); };
  const removeDiscountTier = (code) => saveDiscounts(crmDiscounts.filter(d => d.code !== code));
  // Payment-terms options = curated master list UNION every term already synced from NetSuite onto a record.
  const paymentTermsOptions = [...new Set([...(globalLists.paymentTerms || []), ...Object.values(crmData).map(r => r.terms)].filter(Boolean))].sort();

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
  // Orders arrive in partial shipments — record what came back now, accumulate per-line received qty, and
  // log each receipt event. Status flows Sent → Partially Received → Received.
  const recordPlatingReceipt = async (po) => {
      const items = po.items || [];
      const draftEntries = items.map((it, idx) => ({ idx, qty: Math.max(0, parseInt(receiptDraft[idx]) || 0) })).filter(e => e.qty > 0);
      if (!draftEntries.length) return alert("Enter at least one received quantity.");
      const newItems = items.map((it, idx) => {
          const e = draftEntries.find(x => x.idx === idx);
          if (!e) return it;
          const remaining = (it.quantity || 0) - (it.received || 0);
          return { ...it, received: (it.received || 0) + Math.min(e.qty, remaining) };
      });
      const receipt = {
          date: new Date().toISOString(), by: currentUser || 'Unknown', note: receiptNote.trim(),
          lines: draftEntries.map(e => ({ erpId: items[e.idx].itemId, qty: Math.min(e.qty, (items[e.idx].quantity || 0) - (items[e.idx].received || 0)) })).filter(l => l.qty > 0)
      };
      const receipts = [...(po.receipts || []), receipt];
      const allReceived = newItems.every(it => (it.received || 0) >= (it.quantity || 0));
      const anyReceived = newItems.some(it => (it.received || 0) > 0);
      const status = allReceived ? 'Received' : (anyReceived ? 'Partially Received' : po.status);
      try {
          await updateDoc(doc(db, "hq_purchase_orders", po.id), { items: newItems, receipts, status });
          setActivePlatingPO({ ...po, items: newItems, receipts, status });
          setRecordingReceipt(false); setReceiptDraft({}); setReceiptNote('');
      } catch (e) { console.error(e); alert("Receipt save failed: " + (e.message || e)); }
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

      // Map the job onto the branded Form Template document (Shared/FormPreview) — the same form
      // the Admin Form Templates screen previews, logo + header/footer/terms + contact footer.
      // Discount / net-total rows keep their look: no qty, direct amount, net line bolded.
      // Bill-to/ship-to resolve from the JOB's customer record (not the sidebar selection):
      // ship-to = the job's custom address, else its saved NetSuite address-book entry, else the
      // customer's default shipping address — never the sidemark.
      const jobCrm = crmData[activeDocJob.customer?.id]
          || Object.values(crmData).find(r => r.type === 'CUSTOMER' && r.name && r.name === (activeDocJob.customer?.name || activeDocJob.clientName))
          || activeCrmRecord;
      const fmtAddr = (a) => !a ? [] : [a.addressee || a.attention || a.label, a.addr1, a.addr2, [a.city, a.state].filter(Boolean).join(', ') + (a.zip ? ' ' + a.zip : '')].map(x => String(x || '').trim()).filter(Boolean);
      const savedAddr = (jobCrm?.shippingAddresses || []).find(a => String(a.addressBookId) === String(activeDocJob.shippingAddressId))
          || (jobCrm?.shippingAddresses || []).find(a => a.isDefault) || (jobCrm?.shippingAddresses || [])[0] || null;
      const shipLines = activeDocJob.shippingMethod === 'CUSTOM' && activeDocJob.customShippingAddress
          ? fmtAddr(activeDocJob.customShippingAddress)
          : fmtAddr(savedAddr);
      const billLines = String(jobCrm?.billingAddress || '').split('\n').map(x => x.trim()).filter(Boolean);
      const shippingAmt = parseFloat(activeDocJob.shippingAmount) || 0;
      const quoteLines = (activeDocJob.cpqData?.breakdown || []).map(b => ({
          item: b.isHeader ? '▶' : '',
          desc: b.name,
          qty: (b.isDiscount || b.isNetLine || b.isHeader) ? '' : b.qty,
          price: (b.isDiscount || b.isNetLine || b.isHeader || b.qty == null || !b.qty) ? null : b.price,
          amount: b.total,
          bold: !!b.isNetLine || !!b.isHeader,
      }));
      if (shippingAmt > 0) quoteLines.push({ item: '', desc: 'Shipping', qty: '', price: null, amount: shippingAmt });
      const quoteFormData = {
          billTo: [activeDocJob.customer?.name || activeDocJob.clientName || 'N/A',
                   ...(billLines.length ? billLines : fmtAddr(savedAddr))],
          shipTo: (shipLines.length ? shipLines : [activeDocJob.customer?.name || activeDocJob.clientName || 'Per project']),
          lines: quoteLines,
          date: activeDocJob.dateSaved || new Date().toLocaleDateString(),
          po: activeDocJob.sidemark || activeDocJob.jobId || '—',
          termsLabel: activeCrmRecord?.terms || 'Per agreement',
          tax: 0,
          total: (activeDocJob.cpqData?.totalPrice || 0) + shippingAmt,
      };

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
                      
                      {/* PAGE 1: QUOTE — the actual Form Templates document */}
                      {renderQuote && (
                          <div className="pdf-page" style={{ background: '#fff', width: '100%', minHeight: '11in', padding: '0.45in 0.35in', boxSizing: 'border-box', boxShadow: '0 12px 48px rgba(0,0,0,0.05)' }}>
                              <FormPreview
                                  type="QUOTE"
                                  brand={activeBrand}
                                  logoUrl={logoUrl}
                                  header={template.header}
                                  footer={template.footer}
                                  terms={template.terms}
                                  docNumber={activeDocJob.jobId || activeDocJob.id}
                                  data={quoteFormData}
                              />
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
                                      activeDocJob.cpqData.breakdown.filter(item => !item.isDiscount && !item.isNetLine).map((item, i) => (
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
                              <div style={{ display: 'flex', gap: '8px' }}>
                                  <button onClick={() => setShowListSetup(true)} title="Manage payment terms, discount tiers & sales reps" style={{ background: '#fff', color: 'var(--ink)', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', padding: '6px 10px', cursor: 'pointer' }}>⚙ Lists</button>
                                  <button onClick={() => setShowNewCrmModal(true)} style={{ background: 'var(--ink)', color: '#fff', border: 'none', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', padding: '6px 12px', cursor: 'pointer' }}>Add New</button>
                              </div>
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
                                                          {[...new Set([...paymentTermsOptions, activeCrmRecord.terms].filter(Boolean))].map(t => <option key={t} value={t}>{t}</option>)}
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
                                                  <h4 style={{ margin: '0 0 16px', fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500 }}>Additional Contacts</h4>
                                                  {(activeCrmRecord.contacts || []).length === 0 ? (
                                                      <span style={{ fontSize: '0.9rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No additional contacts yet — add accounting, production, etc. below.</span>
                                                  ) : (
                                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
                                                          {(activeCrmRecord.contacts || []).map((c, idx) => (
                                                              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 1fr auto', gap: '10px', alignItems: 'center', background: 'var(--paper-2)', border: '1px solid var(--line)', padding: '10px 12px' }}>
                                                                  <span style={{ fontWeight: 500, fontSize: '0.9rem', color: 'var(--ink)' }}>{c.name || '—'}</span>
                                                                  <a href={`mailto:${c.email}`} style={{ fontSize: '0.85rem', color: 'var(--brass)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email || '—'}</a>
                                                                  <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-soft)' }}>{c.department || '—'}</span>
                                                                  <button onClick={() => removeCrmContact(idx)} title="Remove contact" style={{ background: 'transparent', border: 'none', color: '#d9534f', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1 }}>×</button>
                                                              </div>
                                                          ))}
                                                      </div>
                                                  )}
                                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 1fr auto', gap: '10px', alignItems: 'center' }}>
                                                      <input value={newContactInput.name} onChange={e => setNewContactInput({ ...newContactInput, name: e.target.value })} placeholder="Contact name" style={{ padding: '9px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', fontSize: '0.85rem' }} />
                                                      <input value={newContactInput.email} onChange={e => setNewContactInput({ ...newContactInput, email: e.target.value })} placeholder="Email" onKeyDown={e => { if (e.key === 'Enter') addCrmContact(); }} style={{ padding: '9px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', fontSize: '0.85rem' }} />
                                                      <input value={newContactInput.department} onChange={e => setNewContactInput({ ...newContactInput, department: e.target.value })} placeholder="Department" onKeyDown={e => { if (e.key === 'Enter') addCrmContact(); }} style={{ padding: '9px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', fontSize: '0.85rem' }} />
                                                      <button onClick={addCrmContact} style={{ padding: '9px 18px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Add</button>
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

                                      {/* Portal logins + flow entitlements — customers only (vendors share this detail panel) */}
                                      {activeSubTab === 'CUSTOMERS' && <PortalAccessPanel customer={activeCrmRecord} activeBrand={activeBrand} />}

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
                                                                  <button onClick={() => reprintPlatingPackingList(po)} style={{ flex: 1, padding: '8px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', background: '#fff', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer' }}>Reprint</button>
                                                                  <button onClick={() => emailPlatingOrder(po)} style={{ flex: 1, padding: '8px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer' }}>✉ Email Order (PDF)</button>
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
                                                          <button onClick={() => reopenQuoteInCpq(job)} title="Reopen this quote's configuration in the CPQ Configurator" style={{ flex: 1, padding: '8px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', background: '#fff', border: '1px solid var(--brass)', color: 'var(--brass)', cursor: 'pointer' }}>Reopen CPQ</button>
                                                          <button onClick={() => reopenQuoteInVision(job)} title="Reopen this quote's session on the Vision Hardware board — dimensions, bracket/splice placement, and shop notes live there (Engineering view → Load saved line)" style={{ flex: 1, padding: '8px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', background: '#fff', border: '1px solid var(--ink)', color: 'var(--ink)', cursor: 'pointer' }}>Reopen Vision</button>
                                                          <button onClick={() => handleDeleteJob(job.id)} style={{ flex: 1, padding: '8px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', background: '#fff', border: '1px solid #d9534f', color: '#d9534f', cursor: 'pointer' }}>Delete</button>
                                                      </div>
                                                  </div>
                                              ))}
                                          </div>
                                      )}

                                      {/* --- ARCHIVE PIPELINE COLLAPSIBLE --- */}
                                      {/* QUICK SHIP INVOICES (2026-07-17): stocked-program orders for this customer.
                                          The app invoice shows KIT # + kit price w/ unpriced component sub-lines;
                                          Match pulls the NetSuite invoice # so accounting ties 1:1 before sending. */}
                                      {(() => {
                                          const custQs = qsOrders.filter(o => o.customerId === activeCrmRecord.id).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
                                          if (!custQs.length) return null;
                                          return (
                                              <div style={{ marginBottom: '16px' }}>
                                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: '12px', marginBottom: '12px' }}>
                                                      <h4 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)' }}>Quick Ship Invoices</h4>
                                                      <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>{custQs.length} order(s)</span>
                                                  </div>
                                                  {custQs.slice(0, 12).map(o => (
                                                      <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', border: '1px solid var(--line)', background: 'var(--paper)', padding: '10px 14px', marginBottom: '8px' }}>
                                                          <div style={{ flex: 1, minWidth: 0 }}>
                                                              <span style={{ fontFamily: 'var(--mono)', fontSize: '0.85rem', fontWeight: 600, color: 'var(--ink)' }}>SO {o.soId}</span>
                                                              <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', marginLeft: '10px' }}>{o.createdAt ? new Date(o.createdAt).toLocaleDateString() : ''}{o.jobName ? ` · ${o.jobName}` : ''} · ${Number(o.invoiceTotal || 0).toFixed(2)}</span>
                                                          </div>
                                                          <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.06em', padding: '3px 8px', border: '1px solid', borderColor: o.nsInvoiceNo ? '#3a7d44' : 'var(--brass)', color: o.nsInvoiceNo ? '#3a7d44' : 'var(--brass)', whiteSpace: 'nowrap' }}>{o.nsInvoiceNo ? `INV ${o.nsInvoiceNo}` : 'NO NS INV #'}</span>
                                                          <button onClick={() => setQsInvoice(o)} style={{ padding: '8px 14px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', whiteSpace: 'nowrap' }}>🧾 Invoice</button>
                                                      </div>
                                                  ))}
                                              </div>
                                          );
                                      })()}
                                      {qsInvoice && <QuickShipInvoiceModal order={qsInvoice} customer={activeCrmRecord} brand={activeBrand} onClose={() => setQsInvoice(null)} />}

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

      {showListSetup && (
          <div onClick={() => setShowListSetup(false)} style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
              <div onClick={e => e.stopPropagation()} style={{ background: '#fff', border: '1px solid var(--line)', boxShadow: '0 12px 48px rgba(0,0,0,0.1)', borderRadius: '2px', width: '720px', maxHeight: '85vh', overflowY: 'auto', padding: '32px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: '16px', marginBottom: '8px' }}>
                      <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500 }}>Manage Lists</h3>
                      <button onClick={() => setShowListSetup(false)} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--ink-soft)', lineHeight: 1 }}>×</button>
                  </div>
                  <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: 0 }}>These populate the dropdowns on each profile. Payment terms also auto-include any term synced from NetSuite on a record.</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '28px', marginTop: '12px' }}>
                      <div>
                          <h4 style={{ margin: '0 0 12px', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink)' }}>Payment Terms</h4>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
                              {paymentTermsOptions.length === 0 && <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>None yet.</span>}
                              {paymentTermsOptions.map(t => (
                                  <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'var(--paper-2)', border: '1px solid var(--line)', padding: '4px 10px', fontSize: '0.85rem' }}>{t}{(globalLists.paymentTerms || []).includes(t) && <button onClick={() => removePaymentTerm(t)} style={{ background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', fontSize: '0.95rem', lineHeight: 1, padding: 0 }}>×</button>}</span>
                              ))}
                          </div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                              <input value={newTermInput} onChange={e => setNewTermInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addPaymentTerm(); }} placeholder="e.g. Net 30" style={{ flex: 1, padding: '8px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', fontSize: '0.85rem' }} />
                              <button onClick={addPaymentTerm} style={{ padding: '8px 14px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase' }}>Add</button>
                          </div>
                          <p style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', marginTop: '6px' }}>Terms with no × are auto-pulled from NetSuite and can't be removed here.</p>
                      </div>
                      <div>
                          <h4 style={{ margin: '0 0 12px', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink)' }}>Sales Reps</h4>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
                              {(globalLists.salesReps || []).length === 0 && <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>None yet.</span>}
                              {(globalLists.salesReps || []).map(t => (
                                  <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'var(--paper-2)', border: '1px solid var(--line)', padding: '4px 10px', fontSize: '0.85rem' }}>{t}<button onClick={() => removeSalesRep(t)} style={{ background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', fontSize: '0.95rem', lineHeight: 1, padding: 0 }}>×</button></span>
                              ))}
                          </div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                              <input value={newRepInput} onChange={e => setNewRepInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addSalesRep(); }} placeholder="Rep name" style={{ flex: 1, padding: '8px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', fontSize: '0.85rem' }} />
                              <button onClick={addSalesRep} style={{ padding: '8px 14px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase' }}>Add</button>
                          </div>
                      </div>
                  </div>
                  <div style={{ marginTop: '28px', borderTop: '1px solid var(--line)', paddingTop: '20px' }}>
                      <h4 style={{ margin: '0 0 12px', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink)' }}>Discount Tiers</h4>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
                          {crmDiscounts.length === 0 && <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>None yet.</span>}
                          {crmDiscounts.map(d => (
                              <span key={d.code} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'var(--paper-2)', border: '1px solid var(--line)', padding: '4px 10px', fontSize: '0.85rem' }}>{d.code} (-{d.percent}%)<button onClick={() => removeDiscountTier(d.code)} style={{ background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', fontSize: '0.95rem', lineHeight: 1, padding: 0 }}>×</button></span>
                          ))}
                      </div>
                      <div style={{ display: 'flex', gap: '8px', maxWidth: '420px' }}>
                          <input value={newDiscountInput.code} onChange={e => setNewDiscountInput({ ...newDiscountInput, code: e.target.value })} placeholder="Tier code (e.g. DEALER)" style={{ flex: 2, padding: '8px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', fontSize: '0.85rem' }} />
                          <input type="number" value={newDiscountInput.percent} onChange={e => setNewDiscountInput({ ...newDiscountInput, percent: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') addDiscountTier(); }} placeholder="%" style={{ flex: 1, padding: '8px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', fontSize: '0.85rem' }} />
                          <button onClick={addDiscountTier} style={{ padding: '8px 14px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase' }}>Add</button>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {activePlatingPO && (() => {
          const po = activePlatingPO;
          const items = (po.items && po.items.length)
              ? po.items
              : (po.packingList?.lines || []).map(l => ({ itemId: l.erpId, description: l.itemName, finishCode: l.finishCode, targetErpId: l.targetErpId, quantity: l.qty, received: 0 }));
          const dateStr = po.createdAt?.seconds ? new Date(po.createdAt.seconds * 1000).toLocaleDateString() : (po.packingList?.dateStr || '');
          const orderedPcs = items.reduce((s, it) => s + (it.quantity || 0), 0);
          const receivedPcs = items.reduce((s, it) => s + (it.received || 0), 0);
          const remainingPcs = orderedPcs - receivedPcs;
          const receipts = po.receipts || [];
          const closeModal = () => { setActivePlatingPO(null); setRecordingReceipt(false); setReceiptDraft({}); setReceiptNote(''); };
          const statusColor = po.status === 'Received' ? '#2e7d32' : (po.status === 'Partially Received' ? 'var(--brass)' : 'var(--ink-soft)');
          return (
          <div onClick={closeModal} style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
              <div onClick={e => e.stopPropagation()} style={{ background: '#fff', border: '1px solid var(--line)', boxShadow: '0 12px 48px rgba(0,0,0,0.1)', borderRadius: '2px', width: '900px', maxHeight: '88vh', overflowY: 'auto', padding: '32px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--line)', paddingBottom: '16px', marginBottom: '20px' }}>
                      <div>
                          <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)' }}>Plating Shipment {po.nsPoTran || po.poId}</h3>
                          <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', display: 'block', marginTop: '6px' }}>{po.vendor} · {dateStr} · <span style={{ color: statusColor, fontWeight: 700 }}>{(po.status || 'Sent').replace(/_/g, ' ')}</span></span>
                      </div>
                      <button onClick={closeModal} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--ink-soft)', lineHeight: 1 }}>×</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '20px' }}>
                      {[['NetSuite PO', po.nsPoTran || po.nsPoId || '—'], ['Finish(es)', po.finishSummary || '—'], ['Ordered', `${orderedPcs} pcs`], ['Received', `${receivedPcs} pcs`], ['Outstanding', `${remainingPcs} pcs`], ['Plating Total', `$${Number(po.total || 0).toFixed(2)}`], ['Prepared by', po.createdBy || '—'], ['Expected back', po.expectedReceiveDate || '—']].map(([k, v]) => (
                          <div key={k}><div style={{ fontFamily: 'var(--mono)', fontSize: '8px', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-soft)' }}>{k}</div><div style={{ fontSize: '0.95rem', fontWeight: 600, color: k === 'Outstanding' && remainingPcs > 0 ? 'var(--brass)' : 'var(--ink)', marginTop: '2px' }}>{v}</div></div>
                      ))}
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                      <thead><tr>{['#', 'Item', 'Description', 'Finish', 'Returns As', 'Ord', 'Recv', 'Rem', ...(recordingReceipt ? ['Receive Now'] : [])].map(h => <th key={h} style={{ textAlign: ['Ord', 'Recv', 'Rem', 'Receive Now'].includes(h) ? 'right' : 'left', borderBottom: '1px solid var(--line)', padding: '8px', fontFamily: 'var(--mono)', fontSize: '8px', textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-soft)' }}>{h}</th>)}</tr></thead>
                      <tbody>
                          {items.map((it, i) => {
                              const rem = (it.quantity || 0) - (it.received || 0);
                              return (
                              <tr key={i}>
                                  <td style={{ padding: '8px', borderBottom: '1px solid var(--paper-2)', color: 'var(--ink-soft)' }}>{i + 1}</td>
                                  <td style={{ padding: '8px', borderBottom: '1px solid var(--paper-2)', fontFamily: 'var(--mono)', fontSize: '0.8rem' }}>{it.itemId}</td>
                                  <td style={{ padding: '8px', borderBottom: '1px solid var(--paper-2)' }}>{it.description}</td>
                                  <td style={{ padding: '8px', borderBottom: '1px solid var(--paper-2)' }}>{it.finishCode}</td>
                                  <td style={{ padding: '8px', borderBottom: '1px solid var(--paper-2)', fontFamily: 'var(--mono)', fontSize: '0.8rem' }}>{it.targetErpId}</td>
                                  <td style={{ padding: '8px', borderBottom: '1px solid var(--paper-2)', textAlign: 'right' }}>{it.quantity || 0}</td>
                                  <td style={{ padding: '8px', borderBottom: '1px solid var(--paper-2)', textAlign: 'right', color: (it.received || 0) > 0 ? 'var(--ink)' : 'var(--ink-soft)' }}>{it.received || 0}</td>
                                  <td style={{ padding: '8px', borderBottom: '1px solid var(--paper-2)', textAlign: 'right', fontWeight: rem > 0 ? 700 : 400, color: rem > 0 ? 'var(--brass)' : '#2e7d32' }}>{rem}</td>
                                  {recordingReceipt && (
                                      <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--paper-2)', textAlign: 'right' }}>
                                          <input type="number" min="0" max={rem} disabled={rem <= 0} value={receiptDraft[i] ?? ''} onChange={e => setReceiptDraft({ ...receiptDraft, [i]: e.target.value })} style={{ width: '64px', padding: '5px', border: '1px solid var(--line)', textAlign: 'right', fontFamily: 'var(--sans)', fontSize: '0.85rem', background: rem <= 0 ? 'var(--paper-2)' : '#fff' }} />
                                      </td>
                                  )}
                              </tr>
                              );
                          })}
                      </tbody>
                  </table>

                  {receipts.length > 0 && (
                      <div style={{ marginTop: '20px' }}>
                          <h4 style={{ margin: '0 0 10px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Receipt History</h4>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              {receipts.map((r, ri) => (
                                  <div key={ri} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--paper-2)', border: '1px solid var(--line)', padding: '8px 12px', fontSize: '0.85rem' }}>
                                      <span>{new Date(r.date).toLocaleDateString()} · {r.by} · <strong>{(r.lines || []).reduce((s, l) => s + (l.qty || 0), 0)} pcs</strong>{r.note ? ` — ${r.note}` : ''}</span>
                                      <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)' }}>{(r.lines || []).length} line(s)</span>
                                  </div>
                              ))}
                          </div>
                      </div>
                  )}

                  {recordingReceipt && (
                      <div style={{ marginTop: '16px' }}>
                          <input value={receiptNote} onChange={e => setReceiptNote(e.target.value)} placeholder="Receipt note (optional) — e.g. partial, box 1 of 2" style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', fontSize: '0.85rem', boxSizing: 'border-box' }} />
                      </div>
                  )}

                  <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
                      {!recordingReceipt ? (
                          <button onClick={() => { setReceiptDraft(Object.fromEntries(items.map((it, i) => [i, Math.max(0, (it.quantity || 0) - (it.received || 0))]))); setReceiptNote(''); setRecordingReceipt(true); }} disabled={remainingPcs <= 0} style={{ flex: 1.4, padding: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', background: remainingPcs <= 0 ? 'var(--paper-2)' : 'var(--brass)', color: remainingPcs <= 0 ? 'var(--ink-soft)' : '#fff', border: 'none', cursor: remainingPcs <= 0 ? 'default' : 'pointer' }}>{remainingPcs <= 0 ? '✓ Fully Received' : '+ Record Receipt'}</button>
                      ) : (
                          <>
                              <button onClick={() => recordPlatingReceipt(po)} style={{ flex: 1.4, padding: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer' }}>Save Receipt</button>
                              <button onClick={() => { setRecordingReceipt(false); setReceiptDraft({}); setReceiptNote(''); }} style={{ padding: '12px 18px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', background: '#fff', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer' }}>Cancel</button>
                          </>
                      )}
                      <button onClick={() => reprintPlatingPackingList(po)} style={{ flex: 1, padding: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', background: '#fff', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer' }}>Reprint</button>
                      <button onClick={() => emailPlatingOrder(po)} style={{ flex: 1, padding: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer' }}>✉ Email PDF</button>
                      <button onClick={closeModal} style={{ padding: '12px 18px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', background: '#fff', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer' }}>Close</button>
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