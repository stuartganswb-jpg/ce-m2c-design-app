import React, { useState, useEffect, useRef } from 'react';
import { db, storage } from '../firebase';
import { collection, onSnapshot, query, where, doc, updateDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";

const COLLECTIONS = ["HARLOW", "SIGNATURE", "COASTAL", "MODERN ARCHITECTURAL", "CUSTOM", "N/A"];

// Mock CRM/Vendor Lists (To be pulled from actual Firebase collections later)
const VENDORS = ["VEND-101 (Acme Plating)", "VEND-202 (Prime Assembly)", "VEND-303 (Luxury Textiles Co.)", "VEND-404 (Custom Machining)"];
const CUSTOMERS = ["CUST-882 (Smith Residence)", "CUST-310 (The Harrison Project)", "CUST-105 (Alvarez Villa)"];

const InceptionTab = ({ currentUser, activeBrand }) => {
  const [assemblies, setAssemblies] = useState([]);
  const [activeAssembly, setActiveAssembly] = useState(null);
  const [bomParts, setBomParts] = useState([]); 

  // Form State
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({ itemName: "", legacyErpId: "", collection: "N/A", description: "" });
  const [imageFile, setImageFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Sub-Assembly & Kit State
  const [subModalOpen, setSubModalOpen] = useState(false);
  const [subFormData, setSubFormData] = useState({ name: "", basePrice: "", assignedPins: [] });
  const [subImageFile, setSubImageFile] = useState(null);
  const [subUploadProgress, setSubUploadProgress] = useState(0);

  const [outsourceModalOpen, setOutsourceModalOpen] = useState(false);
  const [outsourceFormData, setOutsourceFormData] = useState({ kitName: "", vendorId: VENDORS[0], purpose: "FINISHING", assignedPins: [] });

  // External Coop Push State
  const [coopModalOpen, setCoopModalOpen] = useState(false);
  const [coopFormData, setCoopFormData] = useState({ target: 'CUSTOMER', entityId: CUSTOMERS[0], note: '' });

  // --- SPATIAL CALLOUT & REVISION STATE ---
  const [isAddingCallout, setIsAddingCallout] = useState(false);
  const [activeCalloutId, setActiveCalloutId] = useState(null);
  const [activeRevisionId, setActiveRevisionId] = useState(null);
  const svgRef = useRef(null);

  // 1. Fetch Master Assemblies
  useEffect(() => {
    if (!activeBrand) return;
    const q = query(collection(db, "Approved_Designs"), where("brandId", "==", activeBrand), where("partClass", "==", "Assembly"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      let docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      docs.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setAssemblies(docs);
      
      if (activeAssembly) {
          const updatedActive = docs.find(d => d.id === activeAssembly.id);
          if (updatedActive) setActiveAssembly(updatedActive);
      }
    });
    return () => unsubscribe();
  }, [activeBrand, activeAssembly?.id]);

  // 2. Fetch BOM Parts
  useEffect(() => {
    if (!activeAssembly) { setBomParts([]); return; }
    const q = query(collection(db, "assembly_pins"), where("assemblyId", "==", activeAssembly.itemId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setBomParts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubscribe();
  }, [activeAssembly]);

  // Handle Revision active state mapping
  useEffect(() => {
      if (activeAssembly) {
          const revs = activeAssembly.revisions || (activeAssembly.finalImageUrl ? [{ id: 'INITIAL', name: 'Initial Design', url: activeAssembly.finalImageUrl }] : []);
          if (revs.length > 0 && !activeRevisionId) {
              setActiveRevisionId(revs[revs.length - 1].id); // Default to latest
          }
      } else {
          setActiveRevisionId(null);
      }
  }, [activeAssembly, activeRevisionId]);


  const openEditor = (assembly = null) => {
    if (assembly) {
      setFormData({
        itemName: assembly.itemName || "",
        legacyErpId: assembly.legacyErpId === "PENDING" ? "" : (assembly.legacyErpId || ""),
        collection: assembly.collection || "N/A",
        description: assembly.description || ""
      });
      setActiveAssembly(assembly);
    } else {
      setFormData({ itemName: "", legacyErpId: "", collection: "N/A", description: "" });
      setActiveAssembly(null);
    }
    setImageFile(null);
    setIsEditing(true);
  };

  const saveAssembly = async (status) => {
    if (!formData.itemName.trim()) return alert("Product Name is required.");
    
    let finalUrl = activeAssembly?.finalImageUrl || "";
    let updatedRevisions = activeAssembly?.revisions || (finalUrl ? [{ id: 'INITIAL', name: 'Initial Design', url: finalUrl }] : []);

    if (imageFile) {
      const storageRef = ref(storage, `assemblies/${activeBrand}_${formData.itemName}_${Date.now()}`);
      const uploadTask = uploadBytesResumable(storageRef, imageFile);
      await new Promise((resolve, reject) => {
        uploadTask.on("state_changed", 
          (snap) => setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
          (err) => reject(err),
          async () => { 
              finalUrl = await getDownloadURL(uploadTask.snapshot.ref); 
              updatedRevisions.push({ id: `REV-${Date.now()}`, name: `Revision ${updatedRevisions.length + 1}`, url: finalUrl, timestamp: new Date().toISOString() });
              resolve(); 
          }
        );
      });
    }

    const docId = activeAssembly ? activeAssembly.id : `${activeBrand.toUpperCase()}-ASM-${Math.floor(1000+Math.random()*9000)}`;
    
    const payload = {
      brandId: activeBrand,
      partClass: "Assembly",
      itemId: docId,
      itemName: formData.itemName.toUpperCase(),
      legacyErpId: formData.legacyErpId.toUpperCase() || "PENDING",
      collection: formData.collection,
      description: formData.description,
      finalImageUrl: finalUrl, 
      revisions: updatedRevisions, // NEW REVISION ARRAY
      lifecycleStatus: status, 
      subAssemblies: activeAssembly?.subAssemblies || [], 
      outsourceKits: activeAssembly?.outsourceKits || [], 
      spatialCallouts: activeAssembly?.spatialCallouts || [], 
      approvals: activeAssembly?.approvals || { designer: false, technical: false, machinist: false }, 
      author: currentUser,
      updatedAt: serverTimestamp()
    };

    if (!activeAssembly) payload.createdAt = serverTimestamp();

    try {
      await setDoc(doc(db, "Approved_Designs", docId), payload, { merge: true });
      setIsEditing(false);
      setUploadProgress(0);
      setActiveAssembly({ id: docId, ...payload }); 
    } catch (err) { console.error(err); alert("Save failed."); }
  };

  // --- REVISION UPLOAD (QUICK UPLOAD) ---
  const handleRevisionUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !activeAssembly) return;

    const storageRef = ref(storage, `assemblies/${activeBrand}_${activeAssembly.itemName}_REV_${Date.now()}`);
    const uploadTask = uploadBytesResumable(storageRef, file);

    uploadTask.on("state_changed",
        (snap) => setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
        (err) => { console.error(err); alert("Upload failed."); },
        async () => {
            const url = await getDownloadURL(uploadTask.snapshot.ref);
            
            const currentRevs = activeAssembly.revisions || (activeAssembly.finalImageUrl ? [{ id: 'INITIAL', name: 'Initial Design', url: activeAssembly.finalImageUrl }] : []);
            const newRevId = `REV-${Date.now()}`;
            const newRev = { id: newRevId, name: `Revision ${currentRevs.length + 1}`, url, timestamp: new Date().toISOString() };
            
            const updatedRevs = [...currentRevs, newRev];

            try {
                await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { revisions: updatedRevs, finalImageUrl: url });
                setUploadProgress(0);
                setActiveRevisionId(newRevId); // Switch view to new revision
            } catch (err) { console.error(err); }
        }
    );
  };

  // --- PUSH TO EXTERNAL COOP ---
  const handlePushToCoop = async () => {
      if (!coopFormData.entityId) return alert("Please select a target entity.");

      const newJobId = `LEAD-${Math.floor(1000 + Math.random() * 9000)}`;
      const payload = {
          jobId: newJobId,
          status: 'INCEPTION',
          brandId: activeBrand,
          clientName: coopFormData.target === 'CUSTOMER' ? coopFormData.entityId : '',
          vendorName: coopFormData.target === 'VENDOR' ? coopFormData.entityId : '',
          note: `[Ref: ${activeAssembly.itemName}] ${coopFormData.note}`,
          linkedAssemblyId: activeAssembly.id,
          date: new Date().toISOString().split('T')[0],
          createdAt: serverTimestamp()
      };

      try {
          await setDoc(doc(db, "jobs", newJobId), payload); // Assumes Tab 10 pulls from 'jobs'
          alert(`✅ Successfully pushed to External Coop (${coopFormData.target})!`);
          setCoopModalOpen(false);
          setCoopFormData({ ...coopFormData, note: '' });
      } catch (error) {
          console.error("Error pushing to Coop:", error);
          alert("Failed to push to External Coop.");
      }
  };

  // --- APPROVAL GATES LOGIC ---
  const toggleApproval = async (role) => {
      const currentApprovals = activeAssembly.approvals || { designer: false, technical: false, machinist: false };
      const updatedApprovals = { ...currentApprovals, [role]: !currentApprovals[role] };
      setActiveAssembly(prev => ({ ...prev, approvals: updatedApprovals }));
      try { await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { approvals: updatedApprovals }); } 
      catch (err) { console.error(err); }
  };

  // --- SPATIAL CALLOUT LOGIC ---
  const handleSvgClick = async (e) => {
    if (!isAddingCallout || !activeRevisionId) {
        setActiveCalloutId(null);
        return;
    }
    
    const svg = svgRef.current;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());

    const newCallout = {
        id: Date.now().toString(),
        revisionId: activeRevisionId, // Link pin to specific revision
        x: svgP.x,
        y: svgP.y,
        user: currentUser || 'UNKNOWN',
        text: '', // Start empty for clean UX
        time: new Date().toLocaleTimeString()
    };

    const updatedCallouts = [...(activeAssembly.spatialCallouts || []), newCallout];
    setActiveAssembly(prev => ({ ...prev, spatialCallouts: updatedCallouts }));
    setActiveCalloutId(newCallout.id);
    setIsAddingCallout(false);

    try { await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { spatialCallouts: updatedCallouts }); } 
    catch (err) { console.error(err); }
  };

  const handleLocalTextChange = (id, newText) => {
      const updatedCallouts = (activeAssembly.spatialCallouts || []).map(c => 
          c.id === id ? { ...c, text: newText } : c
      );
      setActiveAssembly(prev => ({ ...prev, spatialCallouts: updatedCallouts }));
  };

  const saveCalloutTextToFirebase = async () => {
      try { await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { spatialCallouts: activeAssembly.spatialCallouts }); } 
      catch (err) { console.error(err); }
  };

  const removeCallout = async (id) => {
      if(!window.confirm("Delete this spatial note?")) return;
      const updatedCallouts = (activeAssembly.spatialCallouts || []).filter(c => c.id !== id);
      setActiveAssembly(prev => ({ ...prev, spatialCallouts: updatedCallouts }));
      setActiveCalloutId(null);

      try { await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { spatialCallouts: updatedCallouts }); } 
      catch (err) { console.error(err); }
  };

  // --- CPQ SUB-ASSEMBLY & KIT LOGIC (Abbreviated handlers for space) ---
  const handleSubCheckbox = (pinId) => {
    const current = subFormData.assignedPins;
    if (current.includes(pinId)) setSubFormData({ ...subFormData, assignedPins: current.filter(id => id !== pinId) });
    else setSubFormData({ ...subFormData, assignedPins: [...current, pinId] });
  };

  const saveSubAssembly = async () => {
    if (!subFormData.name.trim()) return alert("Requires a name.");
    let finalUrl = "";
    if (subImageFile) {
      const storageRef = ref(storage, `subassemblies/${activeBrand}_${subFormData.name}_${Date.now()}`);
      const uploadTask = uploadBytesResumable(storageRef, subImageFile);
      await new Promise((resolve, reject) => {
        uploadTask.on("state_changed", null, reject, async () => { finalUrl = await getDownloadURL(uploadTask.snapshot.ref); resolve(); });
      });
    } else return alert("Image required.");

    const newSub = { id: `SUB-${Date.now()}`, name: subFormData.name.toUpperCase(), basePrice: parseFloat(subFormData.basePrice) || 0, assignedPins: subFormData.assignedPins, imageUrl: finalUrl };
    const updatedSubs = [...(activeAssembly.subAssemblies || []), newSub];
    try {
      await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { subAssemblies: updatedSubs });
      setActiveAssembly({ ...activeAssembly, subAssemblies: updatedSubs });
      setSubModalOpen(false); setSubFormData({ name: "", basePrice: "", assignedPins: [] }); setSubImageFile(null);
    } catch (err) { console.error(err); }
  };

  const deleteSubAssembly = async (subId) => {
    if(!window.confirm("Remove?")) return;
    const updatedSubs = activeAssembly.subAssemblies.filter(s => s.id !== subId);
    try {
      await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { subAssemblies: updatedSubs });
      setActiveAssembly({ ...activeAssembly, subAssemblies: updatedSubs });
    } catch (err) { console.error(err); }
  };

  const handleOutsourceCheckbox = (pinId) => {
    const current = outsourceFormData.assignedPins;
    if (current.includes(pinId)) setOutsourceFormData({ ...outsourceFormData, assignedPins: current.filter(id => id !== pinId) });
    else setOutsourceFormData({ ...outsourceFormData, assignedPins: [...current, pinId] });
  };

  const saveOutsourceKit = async () => {
    if (!outsourceFormData.kitName.trim() || outsourceFormData.assignedPins.length === 0) return alert("Invalid Kit.");
    const newKit = { id: `KIT-${Date.now()}`, kitName: outsourceFormData.kitName.toUpperCase(), vendorId: outsourceFormData.vendorId, purpose: outsourceFormData.purpose, assignedPins: outsourceFormData.assignedPins, createdAt: new Date().toISOString() };
    const updatedKits = [...(activeAssembly.outsourceKits || []), newKit];
    try {
      await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { outsourceKits: updatedKits });
      setActiveAssembly({ ...activeAssembly, outsourceKits: updatedKits });
      setOutsourceModalOpen(false); setOutsourceFormData({ kitName: "", vendorId: VENDORS[0], purpose: "FINISHING", assignedPins: [] });
    } catch (err) { console.error(err); }
  };

  const deleteOutsourceKit = async (kitId) => {
    if(!window.confirm("Remove?")) return;
    const updatedKits = activeAssembly.outsourceKits.filter(k => k.id !== kitId);
    try {
      await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { outsourceKits: updatedKits });
      setActiveAssembly({ ...activeAssembly, outsourceKits: updatedKits });
    } catch (err) { console.error(err); }
  };

  const printPickLabel = (kit) => {
    const printWindow = window.open('', '_blank', 'width=600,height=400');
    const partsListHtml = kit.assignedPins.map(pinId => {
      const part = bomParts.find(p => p.id === pinId);
      return part ? `<li>[${part.specs?.qty || 1}x] ${part.legacyErpId !== "PENDING" ? part.legacyErpId : part.partId} - ${part.partName}</li>` : `<li>Unknown Part</li>`;
    }).join('');

    const html = `
      <html>
        <head><title>Pick Label</title><style>body{font-family:monospace;padding:20px;border:2px solid #000;margin:0 auto;}</style></head>
        <body>
          <h2>📦 KIT: ${kit.kitName}</h2>
          <p><strong>ASSEMBLY:</strong> ${activeAssembly?.itemName || 'UNKNOWN'}<br/><strong>VENDOR:</strong> ${kit.vendorId}<br/><strong>ACTION:</strong> ${kit.purpose}</p>
          <ul>${partsListHtml}</ul>
          <script>window.onload=function(){window.print();setTimeout(function(){window.close();},500);}</script>
        </body>
      </html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
  };

  // View Computations
  const activeRevisions = activeAssembly?.revisions || (activeAssembly?.finalImageUrl ? [{ id: 'INITIAL', name: 'Initial Design', url: activeAssembly.finalImageUrl }] : []);
  const currentRevisionObj = activeRevisions.find(r => r.id === activeRevisionId) || activeRevisions[0];
  const filteredCallouts = (activeAssembly?.spatialCallouts || []).filter(c => c.revisionId === activeRevisionId || (!c.revisionId && activeRevisionId === 'INITIAL'));

  if (isEditing) {
    return (
      <div style={{ padding: '20px', fontFamily: 'monospace', backgroundColor: '#e5e5e5', minHeight: '100vh', display: 'flex', justifyContent: 'center' }}>
        <div style={{ background: '#fff', border: '3px solid #000', width: '600px', padding: '30px', boxShadow: '15px 15px 0 #000' }}>
          <h2 style={{ marginTop: 0, textTransform: 'uppercase' }}>{activeAssembly ? "EDIT PRODUCT METADATA" : "NEW PRODUCT INCEPTION"}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div><label style={{ fontWeight: 'bold', fontSize: '0.8rem', display: 'block', marginBottom: '5px' }}>PRODUCT NAME:</label><input value={formData.itemName} onChange={(e) => setFormData({...formData, itemName: e.target.value})} autoFocus style={{ width: '100%', padding: '12px', border: '2px solid #000', boxSizing: 'border-box', fontWeight: 'bold' }} /></div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <div style={{ flex: 1 }}><label style={{ fontWeight: 'bold', fontSize: '0.8rem', display: 'block', marginBottom: '5px' }}>LEGACY ERP ID:</label><input value={formData.legacyErpId} onChange={(e) => setFormData({...formData, legacyErpId: e.target.value})} placeholder="e.g. P-1234" style={{ width: '100%', padding: '12px', border: '2px solid #007bff', boxSizing: 'border-box' }} /></div>
              <div style={{ flex: 1 }}><label style={{ fontWeight: 'bold', fontSize: '0.8rem', display: 'block', marginBottom: '5px' }}>COLLECTION:</label><select value={formData.collection} onChange={(e) => setFormData({...formData, collection: e.target.value})} style={{ width: '100%', padding: '12px', border: '2px solid #000', boxSizing: 'border-box' }}>{COLLECTIONS.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
            </div>
            <div><label style={{ fontWeight: 'bold', fontSize: '0.8rem', display: 'block', marginBottom: '5px' }}>DESIGN DESCRIPTION:</label><textarea value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} rows={3} style={{ width: '100%', padding: '12px', border: '2px solid #000', boxSizing: 'border-box', resize: 'none' }} /></div>
            {!activeAssembly && (
                <div style={{ background: '#f8f9fa', padding: '15px', border: '2px dashed #ccc' }}>
                  <label style={{ fontWeight: 'bold', fontSize: '0.8rem', display: 'block', marginBottom: '5px' }}>INITIAL SKETCH:</label>
                  <input type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files[0])} style={{ width: '100%' }} />
                  {uploadProgress > 0 && <progress value={uploadProgress} max="100" style={{ width: '100%', marginTop: '10px' }}/>}
                </div>
            )}
            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
              <button onClick={() => saveAssembly("INCEPTION")} style={{ flex: 1, padding: '15px', background: '#000', color: '#fff', border: '2px solid #000', fontWeight: 'bold', cursor: 'pointer' }}>💾 SAVE METADATA</button>
            </div>
            <button onClick={() => setIsEditing(false)} style={{ background: 'none', border: 'none', color: '#d9534f', fontWeight: 'bold', cursor: 'pointer', marginTop: '10px', textDecoration: 'underline' }}>CANCEL</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', fontFamily: 'monospace', backgroundColor: '#e5e5e5', minHeight: '100vh' }}>
      
      {/* HEADER */}
      <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '5px 5px 0 #000' }}>
        <div>
          <h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.4rem' }}>1. Master Product Hub</h2>
          <span style={{ fontSize: '0.7rem', color: '#666' }}>{assemblies.length} ASSEMBLIES</span>
        </div>
        <button onClick={() => openEditor()} style={{ padding: '10px 20px', background: '#000', color: '#fff', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>+ INITIATE NEW PRODUCT</button>
      </div>

      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
        
        {/* LEFT LIST */}
        <div style={{ width: activeAssembly ? '350px' : '100%', display: 'grid', gridTemplateColumns: activeAssembly ? '1fr' : 'repeat(auto-fill, minmax(300px, 1fr))', gap: '15px' }}>
          {assemblies.map(asm => {
             const isFullyApproved = asm.approvals?.designer && asm.approvals?.technical && asm.approvals?.machinist;
             return (
              <div key={asm.id} onClick={() => setActiveAssembly(asm)} style={{ background: activeAssembly?.id === asm.id ? '#fff9c4' : '#fff', border: activeAssembly?.id === asm.id ? '3px solid #000' : '2px solid #ccc', cursor: 'pointer', display: 'flex', flexDirection: 'column', transition: '0.2s', boxShadow: activeAssembly?.id === asm.id ? '5px 5px 0 #000' : 'none' }}>
                <div style={{ padding: '5px 10px', background: isFullyApproved ? '#28a745' : '#ffc107', color: isFullyApproved ? '#fff' : '#000', fontSize: '0.65rem', fontWeight: 'bold', textAlign: 'center', borderBottom: '1px solid #000' }}>{isFullyApproved ? "APPROVED" : "INCEPTION"}</div>
                <div style={{ height: '180px', background: '#f4f4f4', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {asm.finalImageUrl ? <img src={asm.finalImageUrl} alt="Assembly" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ color: '#aaa' }}>NO IMAGE</span>}
                </div>
                <div style={{ padding: '15px' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#007bff' }}>{asm.legacyErpId !== "PENDING" && asm.legacyErpId !== "N/A" ? asm.legacyErpId : asm.itemId}</div>
                  <div style={{ fontSize: '1rem', fontWeight: 'bold', marginTop: '5px' }}>{asm.itemName}</div>
                </div>
              </div>
             )
          })}
        </div>

        {/* RIGHT PANEL: DASHBOARD */}
        {activeAssembly && (
          <div style={{ flex: 1, background: '#fff', border: '3px solid #000', boxShadow: '10px 10px 0 #000', display: 'flex', flexDirection: 'column' }}>
            
            {/* DASHBOARD HEADER */}
            <div style={{ padding: '20px', background: '#000', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.5rem', color: '#ffc107' }}>{activeAssembly.itemName}</h3>
                <div style={{ fontSize: '0.8rem', marginTop: '5px', color: '#ccc' }}>ERP ID: {activeAssembly.legacyErpId !== "PENDING" ? activeAssembly.legacyErpId : activeAssembly.itemId}</div>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                {/* --- NEW EXTERNAL COOP PUSH BUTTON --- */}
                <button onClick={() => setCoopModalOpen(true)} style={{ padding: '8px 15px', background: '#17a2b8', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>🚀 PUSH TO EXTERNAL COOP</button>
                <button onClick={() => openEditor(activeAssembly)} style={{ padding: '8px 15px', background: '#fff', color: '#000', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>EDIT METADATA</button>
                <button onClick={() => setActiveAssembly(null)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.5rem', cursor: 'pointer' }}>×</button>
              </div>
            </div>

            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              {/* --- 1. SPATIAL COMMUNICATION CANVAS (WITH REVISIONS) --- */}
              <div style={{ border: '2px solid #d9534f', background: '#fff', display: 'flex', flexDirection: 'column' }}>
                 <div style={{ padding: '10px 15px', background: '#d9534f', color: '#fff', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                        <span>📍 SPATIAL NOTES</span>
                        {/* --- REVISION DROPDOWN --- */}
                        {activeRevisions.length > 0 && (
                            <select 
                                value={activeRevisionId || ''} 
                                onChange={(e) => setActiveRevisionId(e.target.value)}
                                style={{ padding: '4px', fontSize: '0.75rem', fontWeight: 'bold', color: '#000', outline: 'none' }}
                            >
                                {activeRevisions.map(rev => (
                                    <option key={rev.id} value={rev.id}>{rev.name}</option>
                                ))}
                            </select>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <div style={{ position: 'relative' }}>
                            <input type="file" accept="image/*" onChange={handleRevisionUpload} style={{ position: 'absolute', width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }} title="Upload New Revision" />
                            <button style={{ padding: '5px 10px', background: '#fff', color: '#d9534f', border: 'none', fontWeight: 'bold', fontSize: '0.7rem', pointerEvents: 'none' }}>⬆️ UPLOAD NEW REVISION</button>
                        </div>
                        <button onClick={() => setIsAddingCallout(!isAddingCallout)} disabled={!currentRevisionObj?.url} style={{ padding: '5px 10px', background: isAddingCallout ? '#fff' : '#000', color: isAddingCallout ? '#d9534f' : '#fff', border: 'none', fontWeight: 'bold', fontSize: '0.7rem', cursor: currentRevisionObj?.url ? 'pointer' : 'not-allowed', opacity: currentRevisionObj?.url ? 1 : 0.5 }}>
                            {isAddingCallout ? 'CANCEL CALLOUT' : '+ ADD SPATIAL PIN'}
                        </button>
                    </div>
                 </div>
                 
                 {uploadProgress > 0 && <div style={{ padding: '5px 15px', background: '#f8d7da', fontSize: '0.7rem', fontWeight: 'bold', color: '#721c24' }}>UPLOADING REVISION: {uploadProgress}%</div>}
                 
                 <div style={{ position: 'relative', background: '#e9ecef', minHeight: '400px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: isAddingCallout ? 'crosshair' : 'default', overflow: 'hidden' }}>
                    {!currentRevisionObj?.url ? (
                        <div style={{ color: '#999', fontStyle: 'italic', padding: '40px' }}>Upload an initial sketch using the "Upload New Revision" button.</div>
                    ) : (
                        <svg ref={svgRef} onClick={handleSvgClick} viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '400px', display: 'block' }}>
                            <image href={currentRevisionObj.url} x="0" y="0" width="1000" height="600" preserveAspectRatio="xMidYMid meet" />
                            
                            {/* RENDER FILTERED CALLOUT PINS */}
                            {filteredCallouts.map(callout => {
                                const isActive = activeCalloutId === callout.id;
                                return (
                                    <g key={callout.id} onClick={(e) => { e.stopPropagation(); setActiveCalloutId(callout.id); }} style={{ cursor: 'pointer' }}>
                                        <line x1={callout.x} y1={callout.y} x2={callout.x + 30} y2={callout.y - 40} stroke={isActive ? '#007bff' : '#d9534f'} strokeWidth="2" />
                                        <circle cx={callout.x} cy={callout.y} r="5" fill={isActive ? '#007bff' : '#d9534f'} stroke="#fff" strokeWidth="2" />
                                        
                                        <foreignObject x={callout.x + 30} y={callout.y - 80} width="200" height="100" style={{ overflow: 'visible' }}>
                                            <div style={{ background: '#fff', border: `2px solid ${isActive ? '#007bff' : '#d9534f'}`, padding: '5px', boxShadow: '2px 2px 5px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column' }}>
                                                <div style={{ fontSize: '0.6rem', fontWeight: 'bold', color: '#666', borderBottom: '1px solid #eee', marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
                                                    <span>{callout.user} | {callout.time}</span>
                                                    {isActive && <button onClick={() => removeCallout(callout.id)} style={{ background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', padding: 0 }}>✖</button>}
                                                </div>
                                                {isActive ? (
                                                    <textarea 
                                                        autoFocus
                                                        placeholder="Type note here..."
                                                        value={callout.text} 
                                                        onChange={(e) => handleLocalTextChange(callout.id, e.target.value)} 
                                                        onBlur={saveCalloutTextToFirebase}
                                                        style={{ width: '100%', fontSize: '0.75rem', border: 'none', outline: 'none', resize: 'none', minHeight: '60px', fontFamily: 'monospace' }} 
                                                    />
                                                ) : (
                                                    <div style={{ fontSize: '0.75rem', color: '#000', wordWrap: 'break-word', whiteSpace: 'pre-wrap', minHeight: '20px' }}>
                                                        {callout.text || <span style={{color:'#ccc', fontStyle:'italic'}}>Empty Note</span>}
                                                    </div>
                                                )}
                                            </div>
                                        </foreignObject>
                                    </g>
                                );
                            })}
                        </svg>
                    )}
                 </div>
              </div>

              {/* --- 2. TRI-PARTY APPROVAL GATE --- */}
              <div style={{ border: '2px solid #28a745', background: '#f8f9fa' }}>
                 <div style={{ padding: '10px 15px', background: '#28a745', color: '#fff', fontWeight: 'bold', fontSize: '0.9rem' }}>🔐 DESIGN APPROVAL GATE</div>
                 <div style={{ padding: '15px' }}>
                    <div style={{ display: 'flex', gap: '20px', marginBottom: '15px' }}>
                        {['designer', 'technical', 'machinist'].map(role => {
                            const isChecked = activeAssembly.approvals?.[role] || false;
                            return (
                                <label key={role} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', background: isChecked ? '#d4edda' : '#fff', border: `2px solid ${isChecked ? '#28a745' : '#ccc'}`, padding: '15px', cursor: 'pointer', fontWeight: 'bold', textTransform: 'uppercase', fontSize: '0.8rem' }}>
                                    <input type="checkbox" checked={isChecked} onChange={() => toggleApproval(role)} style={{ transform: 'scale(1.5)', cursor: 'pointer' }} />
                                    {role.replace('technical', 'technical designer')} Sign-off
                                </label>
                            )
                        })}
                    </div>
                    {activeAssembly.approvals?.designer && activeAssembly.approvals?.technical && activeAssembly.approvals?.machinist ? (
                        <div style={{ background: '#28a745', color: '#fff', padding: '15px', textAlign: 'center', fontWeight: 'bold', fontSize: '1rem', border: '2px solid #1e7e34' }}>✅ DESIGN FULLY APPROVED. PROCEED TO TAB 2 (VISUAL ASSEMBLY).</div>
                    ) : (
                        <div style={{ background: '#fff3cd', color: '#856404', padding: '15px', textAlign: 'center', fontWeight: 'bold', fontSize: '0.85rem', border: '1px solid #ffeeba' }}>⚠️ DESIGN IN INCEPTION STAGE. AWAITING ALL 3 SIGN-OFFS.</div>
                    )}
                 </div>
              </div>

              {/* --- 3. CPQ GROUPS & OUTSOURCE KITS (HIDDEN IF NOT APPROVED) --- */}
              {(activeAssembly.approvals?.designer && activeAssembly.approvals?.technical && activeAssembly.approvals?.machinist) && (
                  <>
                      {/* CPQ GROUPS */}
                      <div style={{ border: '2px solid #007bff', background: '#f8f9fa' }}>
                        <div style={{ padding: '10px 15px', background: '#007bff', color: '#fff', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span>CPQ RENDER GROUPS (SUB-ASSEMBLIES)</span>
                          <button onClick={() => setSubModalOpen(true)} style={{ padding: '5px 10px', background: '#fff', color: '#007bff', border: 'none', fontWeight: 'bold', fontSize: '0.7rem', cursor: 'pointer' }}>+ CREATE GROUP</button>
                        </div>
                        <div style={{ padding: '15px', display: 'flex', gap: '15px', overflowX: 'auto' }}>
                          {(!activeAssembly.subAssemblies || activeAssembly.subAssemblies.length === 0) ? (
                            <div style={{ color: '#666', fontSize: '0.8rem', fontStyle: 'italic' }}>No sub-assemblies defined.</div>
                          ) : (
                            activeAssembly.subAssemblies.map(sub => (
                              <div key={sub.id} style={{ width: '200px', flexShrink: 0, background: '#fff', border: '1px solid #ccc', display: 'flex', flexDirection: 'column' }}>
                                <div style={{ height: '100px', background: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}><img src={sub.imageUrl} alt={sub.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /></div>
                                <div style={{ padding: '10px' }}><div style={{ fontWeight: 'bold', fontSize: '0.85rem' }}>{sub.name}</div><div style={{ fontSize: '0.7rem', color: '#28a745', fontWeight: 'bold', marginTop: '3px' }}>BASE: ${sub.basePrice.toFixed(2)}</div></div>
                                <button onClick={() => deleteSubAssembly(sub.id)} style={{ width: '100%', padding: '5px', background: '#d9534f', color: '#fff', border: 'none', fontSize: '0.65rem', cursor: 'pointer' }}>DELETE GROUP</button>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      {/* OUTSOURCE KITS */}
                      <div style={{ border: '2px solid #6f42c1', background: '#f3e5f5' }}>
                        <div style={{ padding: '10px 15px', background: '#6f42c1', color: '#fff', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span>VENDOR OUTSOURCE KITS (ROUTING)</span>
                          <button onClick={() => setOutsourceModalOpen(true)} style={{ padding: '5px 10px', background: '#fff', color: '#6f42c1', border: 'none', fontWeight: 'bold', fontSize: '0.7rem', cursor: 'pointer' }}>+ CREATE KIT</button>
                        </div>
                        <div style={{ padding: '15px', display: 'flex', gap: '15px', overflowX: 'auto' }}>
                          {(!activeAssembly.outsourceKits || activeAssembly.outsourceKits.length === 0) ? (
                            <div style={{ color: '#666', fontSize: '0.8rem', fontStyle: 'italic' }}>No kits defined.</div>
                          ) : (
                            activeAssembly.outsourceKits.map(kit => (
                              <div key={kit.id} style={{ width: '220px', flexShrink: 0, background: '#fff', border: '2px solid #6f42c1', display: 'flex', flexDirection: 'column' }}>
                                <div style={{ padding: '10px', borderBottom: '1px dashed #ccc' }}><div style={{ fontWeight: 'bold', fontSize: '0.9rem', color: '#6f42c1' }}>{kit.kitName}</div><div style={{ fontSize: '0.7rem', fontWeight: 'bold', marginTop: '5px' }}>VENDOR: {kit.vendorId.split(" ")[0]}</div></div>
                                <div style={{ display: 'flex' }}><button onClick={() => printPickLabel(kit)} style={{ flex: 1, padding: '8px', background: '#000', color: '#fff', border: 'none', fontSize: '0.65rem', fontWeight: 'bold', cursor: 'pointer', borderRight: '1px solid #fff' }}>🖨️ PRINT LABEL</button><button onClick={() => deleteOutsourceKit(kit.id)} style={{ flex: 1, padding: '8px', background: '#d9534f', color: '#fff', border: 'none', fontSize: '0.65rem', fontWeight: 'bold', cursor: 'pointer' }}>DELETE KIT</button></div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                  </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* --- EXTERNAL COOP MODAL --- */}
      {coopModalOpen && (
          <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
             <div style={{ background: '#fff', border: '4px solid #000', width: '450px', boxShadow: '15px 15px 0 #000', display: 'flex', flexDirection: 'column' }}>
                 <div style={{ padding: '20px', background: '#17a2b8', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                     <h3 style={{ margin: 0, fontSize: '1.2rem' }}>PUSH TO EXTERNAL COOP</h3>
                     <button onClick={() => setCoopModalOpen(false)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.5rem', cursor: 'pointer' }}>×</button>
                 </div>
                 <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                     <div>
                         <label style={{ fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>ROUTING DESTINATION:</label>
                         <select value={coopFormData.target} onChange={(e) => setCoopFormData({...coopFormData, target: e.target.value, entityId: e.target.value === 'CUSTOMER' ? CUSTOMERS[0] : VENDORS[0] })} style={{ width: '100%', padding: '10px', border: '2px solid #000', boxSizing: 'border-box', fontWeight: 'bold' }}>
                             <option value="CUSTOMER">👥 Customer CRM</option>
                             <option value="VENDOR">🏢 Vendor Portal</option>
                         </select>
                     </div>
                     <div>
                         <label style={{ fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '5px', color: '#007bff' }}>ASSIGN TO {coopFormData.target}:</label>
                         <select value={coopFormData.entityId} onChange={(e) => setCoopFormData({...coopFormData, entityId: e.target.value})} style={{ width: '100%', padding: '10px', border: '2px solid #007bff', boxSizing: 'border-box' }}>
                             {(coopFormData.target === 'CUSTOMER' ? CUSTOMERS : VENDORS).map(item => (
                                 <option key={item} value={item}>{item}</option>
                             ))}
                         </select>
                     </div>
                     <div>
                         <label style={{ fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>EXTERNAL NOTE / RFI:</label>
                         <textarea value={coopFormData.note} onChange={(e) => setCoopFormData({...coopFormData, note: e.target.value})} placeholder="e.g. Please review Rev 3 geometry..." rows={4} style={{ width: '100%', padding: '10px', border: '1px solid #ccc', boxSizing: 'border-box', resize: 'none' }} />
                     </div>
                     <button onClick={handlePushToCoop} style={{ width: '100%', padding: '15px', background: '#17a2b8', color: '#fff', fontWeight: 'bold', fontSize: '1rem', border: 'none', cursor: 'pointer', marginTop: '10px' }}>
                         🚀 SEND TO TAB 10 (COOP)
                     </button>
                 </div>
             </div>
          </div>
      )}

      {/* --- SUB-ASSEMBLY & KIT MODALS MINIMIZED FOR READABILITY --- */}
      {subModalOpen && ( <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}><div style={{ background: '#fff', border: '4px solid #000', width: '500px', padding: '20px' }}><h3>CREATE RENDER GROUP</h3><input value={subFormData.name} onChange={(e) => setSubFormData({...subFormData, name: e.target.value})} placeholder="Name" style={{ width: '100%', padding: '10px', marginBottom: '10px' }}/><input type="file" onChange={(e) => setSubImageFile(e.target.files[0])} style={{ marginBottom: '10px' }}/><button onClick={saveSubAssembly} style={{ width: '100%', padding: '10px', background: '#007bff', color: '#fff', fontWeight: 'bold' }}>SAVE</button><button onClick={() => setSubModalOpen(false)} style={{ width: '100%', padding: '10px', marginTop: '5px' }}>CANCEL</button></div></div> )}
      {outsourceModalOpen && ( <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}><div style={{ background: '#fff', border: '4px solid #000', width: '500px', padding: '20px' }}><h3>CREATE VENDOR KIT</h3><input value={outsourceFormData.kitName} onChange={(e) => setOutsourceFormData({...outsourceFormData, kitName: e.target.value})} placeholder="Kit Name" style={{ width: '100%', padding: '10px', marginBottom: '10px' }}/><button onClick={saveOutsourceKit} style={{ width: '100%', padding: '10px', background: '#6f42c1', color: '#fff', fontWeight: 'bold' }}>SAVE</button><button onClick={() => setOutsourceModalOpen(false)} style={{ width: '100%', padding: '10px', marginTop: '5px' }}>CANCEL</button></div></div> )}

    </div>
  );
};

export default InceptionTab;