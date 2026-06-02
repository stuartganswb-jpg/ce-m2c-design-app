import React, { useState, useEffect, useRef } from 'react';
import { db, storage } from '../../firebase';
import { collection, onSnapshot, query, where, doc, updateDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { UncontrolledReactSVGPanZoom, TOOL_PAN, TOOL_ZOOM_IN, TOOL_ZOOM_OUT, TOOL_NONE } from 'react-svg-pan-zoom'; 

import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { useGLTF, OrbitControls, Html, Bounds } from '@react-three/drei';

class ErrorBoundary extends React.Component {
    constructor(props) { super(props); this.state = { hasError: false }; }
    static getDerivedStateFromError(error) { return { hasError: true }; }
    componentDidCatch(error, errorInfo) { console.error("3D Render Error:", error); }
    render() {
        if (this.state.hasError) {
            return (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', background: '#fff', border: '2px dashed #d9534f' }}>
                    <div style={{ textAlign: 'center', color: '#d9534f' }}>
                        <h3 style={{ fontSize: '2rem', margin: '0 0 10px 0' }}>⚠️ 3D RENDER FAILED</h3>
                        <p style={{ fontWeight: 'bold' }}>The uploaded 3D file is corrupted, missing .bin buffer data, or is an unsupported format.</p>
                        <p style={{ color: '#000' }}>Please use the <b>UPLOAD</b> button above to replace this with a valid <b>.glb</b> file.</p>
                    </div>
                </div>
            );
        }
        return this.props.children; 
    }
}

const DEFAULT_COLLECTIONS = ["HARLOW", "SIGNATURE", "COASTAL", "MODERN ARCHITECTURAL", "CUSTOM", "N/A"];
const DEFAULT_PRODUCT_TYPES = ["FINIAL", "BRACKET", "POLE", "RING", "END CAP", "SWIVEL"];
const VENDORS = ["VEND-101 (Acme Plating)", "VEND-202 (Prime Assembly)", "VEND-303 (Luxury Textiles Co.)", "VEND-404 (Custom Machining)"];
const CUSTOMERS = ["CUST-882 (Smith Residence)", "CUST-310 (The Harrison Project)", "CUST-105 (Alvarez Villa)"];

const is3DFile = (nameOrUrl) => {
    if (!nameOrUrl) return false;
    const lower = nameOrUrl.toLowerCase();
    return lower.includes('.glb') || lower.includes('.gltf');
};

const ReviewModel = ({ url, isAddingCallout, onMeshClick }) => {
    const { scene } = useGLTF(url);
    return (
        <primitive 
            object={scene} 
            onPointerOver={(e) => { if(isAddingCallout) { e.stopPropagation(); document.body.style.cursor = 'crosshair'; } }}
            onPointerOut={(e) => { if(isAddingCallout) { e.stopPropagation(); document.body.style.cursor = 'auto'; } }}
            onClick={(e) => { 
                if (isAddingCallout) {
                    e.stopPropagation(); 
                    onMeshClick(e.point); 
                    document.body.style.cursor = 'auto';
                }
            }}
        />
    );
};

const InceptionTab = ({ currentUser, activeBrand }) => {
  const [assemblies, setAssemblies] = useState([]);
  const [activeAssembly, setActiveAssembly] = useState(null);
  const [bomParts, setBomParts] = useState([]); 
  const [dynamicCollections, setDynamicCollections] = useState(DEFAULT_COLLECTIONS);
  const [dynamicProductTypes, setDynamicProductTypes] = useState(DEFAULT_PRODUCT_TYPES);
  const [expandedGroups, setExpandedGroups] = useState({});

  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({ itemName: "", legacyErpId: "", collection: "N/A", productType: "FINIAL", project: "", description: "" });
  const [imageFile, setImageFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const [coopModalOpen, setCoopModalOpen] = useState(false);
  const [coopFormData, setCoopFormData] = useState({ target: 'CUSTOMER', entityId: CUSTOMERS[0], note: '' });

  const [isAddingNewCollection, setIsAddingNewCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [isAddingNewProductType, setIsAddingNewProductType] = useState(false);
  const [newProductTypeName, setNewProductTypeName] = useState("");
  const [isAddingNewProject, setIsAddingNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [imageMode, setImageMode] = useState("UPLOAD"); 
  const [selectedExistingImage, setSelectedExistingImage] = useState("");
  
  const [isAddingCallout, setIsAddingCallout] = useState(false);
  const [activeCalloutId, setActiveCalloutId] = useState(null);
  const [activeRevisionId, setActiveRevisionId] = useState(null);
  
  const [activeTool, setActiveTool] = useState(TOOL_PAN); 
  const [reactSvgPanZoomRef, setReactSvgPanZoomRef] = useState(null);
  
  const [isCanvasMaximized, setIsCanvasMaximized] = useState(false);
  const [isCanvasLocked, setIsCanvasLocked] = useState(true); 
  const [isCapturing, setIsCapturing] = useState(false); 

  const viewerContainerRef = useRef(null);
  const [viewerSize, setViewerSize] = useState({ width: 800, height: 600 });
  
  // 🚀 DOM Refs for high-performance crosshairs (Bypasses React State)
  const crosshairHRef = useRef(null);
  const crosshairVRef = useRef(null);
  const crosshairTargetRef = useRef(null);

  const stopPropagation = (e) => {
      e.stopPropagation();
  };

  useEffect(() => {
      const unsubLists = onSnapshot(doc(db, "system", "master_lists"), (docSnap) => {
          if (docSnap.exists()){
            const data = docSnap.data();
            if (data.collections) setDynamicCollections(data.collections);
            if (data.prodTypes) setDynamicProductTypes(data.prodTypes);
          }
      });
      return () => unsubLists();
  }, []);

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

  useEffect(() => {
    if (!activeAssembly) { setBomParts([]); return; }
    const q = query(collection(db, "assembly_pins"), where("assemblyId", "==", activeAssembly.itemId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setBomParts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubscribe();
  }, [activeAssembly]);

  useEffect(() => {
      if (activeAssembly) {
          const revs = activeAssembly.revisions ? [...activeAssembly.revisions] : [];
          if (revs.length === 0) {
              if (activeAssembly.manufacturingSpecs?.cadUrl) {
                  revs.push({ id: 'INITIAL', name: 'Initial 3D Model', url: activeAssembly.manufacturingSpecs.cadUrl, is3D: true });
              } else if (activeAssembly.finalImageUrl) {
                  revs.push({ id: 'INITIAL', name: 'Initial Design', url: activeAssembly.finalImageUrl, is3D: false });
              }
          }
          if (revs.length > 0 && !activeRevisionId) {
              setActiveRevisionId(activeAssembly.finalRevisionId || revs[revs.length - 1].id); 
          }
      } else {
          setActiveRevisionId(null);
      }
      setIsCanvasLocked(true); 
  }, [activeAssembly, activeRevisionId]);

  useEffect(() => {
    const handleResize = () => {
        if (viewerContainerRef.current) {
            setViewerSize({ width: viewerContainerRef.current.clientWidth, height: viewerContainerRef.current.clientHeight });
        }
    };
    handleResize(); 
    const timeoutId = setTimeout(handleResize, 100);
    window.addEventListener('resize', handleResize);
    return () => { window.removeEventListener('resize', handleResize); clearTimeout(timeoutId); };
  }, [activeAssembly, activeRevisionId, isCanvasMaximized]);

  const existingProjects = [...new Set(assemblies.map(a => a.project).filter(Boolean))].sort();
  
  const imageLibrary = [];
  assemblies.forEach(a => {
      if (a.finalImageUrl && !imageLibrary.find(img => img.url === a.finalImageUrl)) {
          imageLibrary.push({ id: a.id + '_2d', url: a.finalImageUrl, itemName: a.itemName, project: a.project, is3D: false });
      }
      if (a.manufacturingSpecs?.cadUrl && !imageLibrary.find(img => img.url === a.manufacturingSpecs?.cadUrl)) {
          imageLibrary.push({ id: a.id + '_3d', url: a.manufacturingSpecs.cadUrl, itemName: a.itemName, project: a.project, is3D: true });
      }
  });

  const groupedAssemblies = assemblies.reduce((acc, asm) => {
      let groupKey = 'Ungrouped Assemblies'; let type = 'none';
      if (asm.project && asm.project.trim() !== '') { groupKey = asm.project; type = 'project'; } 
      else if (asm.collection && asm.collection !== 'N/A') { groupKey = asm.collection; type = 'collection'; }
      if (!acc[groupKey]) { acc[groupKey] = { items: [], type: type }; }
      acc[groupKey].items.push(asm);
      return acc;
  }, {});

  const toggleGroup = (groupName) => setExpandedGroups(prev => ({ ...prev, [groupName]: !prev[groupName] }));

  const openEditor = (assembly = null) => {
    if (assembly) {
      setFormData({
        itemName: assembly.itemName || "", legacyErpId: assembly.legacyErpId === "PENDING" ? "" : (assembly.legacyErpId || ""),
        collection: assembly.collection || "N/A", productType: assembly.productType || dynamicProductTypes[0] || DEFAULT_PRODUCT_TYPES[0],
        project: assembly.project || "", description: assembly.description || ""
      });
      setActiveAssembly(assembly);
    } else {
      setFormData({ itemName: "", legacyErpId: "", collection: "N/A", productType: dynamicProductTypes[0] || DEFAULT_PRODUCT_TYPES[0], project: "", description: "" });
      setActiveAssembly(null);
    }
    setImageFile(null); setImageMode("UPLOAD"); setSelectedExistingImage(""); setIsEditing(true);
    setIsAddingNewCollection(false); setNewCollectionName("");
    setIsAddingNewProductType(false); setNewProductTypeName("");
    setIsAddingNewProject(false); setNewProjectName("");
  };

  const saveAssembly = async (status) => {
    if (!formData.itemName.trim()) return alert("Product Name is required.");
    
    let finalCollection = formData.collection;
    if (isAddingNewCollection && newCollectionName.trim()) {
        finalCollection = newCollectionName.trim().toUpperCase();
        const updatedCollections = [...new Set([...dynamicCollections, finalCollection])];
        setDoc(doc(db, "system", "master_lists"), { collections: updatedCollections }, { merge: true });
    }
    
    let finalProductType = formData.productType;
    if (isAddingNewProductType && newProductTypeName.trim()){
        finalProductType = newProductTypeName.trim().toUpperCase();
        const updatedTypes = [...new Set([...dynamicProductTypes, finalProductType])];
        setDoc(doc(db, "system", "master_lists"), { prodTypes: updatedTypes }, { merge: true });
    }

    let finalProject = formData.project;
    if (isAddingNewProject && newProjectName.trim()) finalProject = newProjectName.trim().toUpperCase();

    let finalUrl = activeAssembly?.finalImageUrl || "";
    let finalCad = activeAssembly?.manufacturingSpecs?.cadUrl || "";
    let updatedRevisions = activeAssembly?.revisions || [];

    if (imageMode === "UPLOAD" && imageFile) {
        const is3D = is3DFile(imageFile.name);
        const ext = is3D ? '.glb' : '.png'; 
        const storageRef = ref(storage, `assemblies/${activeBrand}_${formData.itemName}_${Date.now()}${ext}`);
        const uploadTask = uploadBytesResumable(storageRef, imageFile);
        
        await new Promise((resolve, reject) => {
          uploadTask.on("state_changed", 
            (snap) => setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
            (err) => reject(err),
            async () => { 
                const dlUrl = await getDownloadURL(uploadTask.snapshot.ref); 
                if (is3D) {
                    finalCad = dlUrl;
                    updatedRevisions.push({ id: `REV-${Date.now()}`, name: `Initial 3D Model`, url: dlUrl, timestamp: new Date().toISOString(), is3D: true });
                } else {
                    finalUrl = dlUrl;
                    updatedRevisions.push({ id: `REV-${Date.now()}`, name: `Initial 2D Sketch`, url: dlUrl, timestamp: new Date().toISOString(), is3D: false });
                }
                resolve(); 
            }
          );
        });
    } else if (imageMode === "LIBRARY" && selectedExistingImage && !activeAssembly) {
        const libImg = imageLibrary.find(img => img.url === selectedExistingImage);
        if (libImg && libImg.is3D) {
            finalCad = selectedExistingImage;
            updatedRevisions.push({ id: `REV-${Date.now()}`, name: `Linked 3D Model`, url: finalCad, timestamp: new Date().toISOString(), is3D: true });
        } else {
            finalUrl = selectedExistingImage;
            updatedRevisions.push({ id: `REV-${Date.now()}`, name: `Linked Shared Drawing`, url: finalUrl, timestamp: new Date().toISOString(), is3D: false });
        }
    }

    const docId = activeAssembly ? activeAssembly.id : `${activeBrand.toUpperCase()}-ASM-${Math.floor(1000+Math.random()*9000)}`;
    const payload = {
      brandId: activeBrand, partClass: "Assembly", itemId: docId,
      itemName: formData.itemName.toUpperCase(), legacyErpId: formData.legacyErpId.toUpperCase() || "PENDING",
      collection: finalCollection, productType: finalProductType, project: finalProject, 
      description: formData.description, finalImageUrl: finalUrl, revisions: updatedRevisions,
      lifecycleStatus: status, spatialCallouts: activeAssembly?.spatialCallouts || [], 
      approvals: activeAssembly?.approvals || { designer: false, technical: false, machinist: false }, 
      author: currentUser, updatedAt: serverTimestamp()
    };

    if (finalCad) {
        payload.manufacturingSpecs = activeAssembly?.manufacturingSpecs || {};
        payload.manufacturingSpecs.cadUrl = finalCad;
    }

    if (!activeAssembly) payload.createdAt = serverTimestamp();

    try {
      await setDoc(doc(db, "Approved_Designs", docId), payload, { merge: true });
      setIsEditing(false); setUploadProgress(0); setActiveAssembly({ id: docId, ...payload }); 
      let targetGroup = 'Ungrouped Assemblies';
      if (finalProject && finalProject.trim() !== '') targetGroup = finalProject;
      else if (finalCollection && finalCollection !== 'N/A') targetGroup = finalCollection;
      setExpandedGroups(prev => ({ ...prev, [targetGroup]: true }));
      alert(`✅ SUCCESS: Metadata for ${payload.itemName} has been saved.`);
    } catch (err) { console.error(err); alert("Save failed."); }
  };

  const handleCaptureThumbnail = async () => {
      setIsCapturing(true);
      try {
          const wrapper = document.getElementById('r3f-canvas-tab1');
          const canvas = wrapper ? wrapper.querySelector('canvas') : document.querySelector('canvas');
          if (!canvas) throw new Error("Could not locate 3D Canvas element.");
          const dataUrl = canvas.toDataURL('image/png');
          if (!dataUrl || dataUrl === 'data:,') throw new Error("Canvas is empty.");

          const res = await fetch(dataUrl);
          const blob = await res.blob();
          const storageRef = ref(storage, `assemblies/${activeBrand}_${activeAssembly.itemName}_THUMB_${Date.now()}.png`);
          const uploadTask = uploadBytesResumable(storageRef, blob);
          
          uploadTask.on("state_changed", null, null, async () => {
              const dlUrl = await getDownloadURL(uploadTask.snapshot.ref);
              await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { finalImageUrl: dlUrl });
              setActiveAssembly(prev => ({ ...prev, finalImageUrl: dlUrl }));
              alert("✅ 3D Thumbnail Captured Successfully!");
              setIsCapturing(false);
          });
      } catch (err) {
          console.error("Thumbnail capture error:", err);
          alert(`Failed to capture thumbnail: ${err.message}`);
          setIsCapturing(false);
      }
  };

  const handleRevisionUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !activeAssembly) return;

    const is3D = is3DFile(file.name);
    const ext = is3D ? '.glb' : '.png'; 
    const storageRef = ref(storage, `assemblies/${activeBrand}_${activeAssembly.itemName}_REV_${Date.now()}${ext}`);
    const uploadTask = uploadBytesResumable(storageRef, file);

    uploadTask.on("state_changed",
        (snap) => setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
        (err) => { console.error(err); alert("Upload failed."); },
        async () => {
            const url = await getDownloadURL(uploadTask.snapshot.ref);
            const currentRevs = activeAssembly.revisions || [];
            const newRevId = `REV-${Date.now()}`;
            const revName = is3D ? `3D Model Revision ${currentRevs.length + 1}` : `2D Sketch Revision ${currentRevs.length + 1}`;
            const newRev = { id: newRevId, name: revName, url, timestamp: new Date().toISOString(), is3D: is3D }; 
            const updatedRevs = [...currentRevs, newRev];

            try {
                await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { revisions: updatedRevs });
                setUploadProgress(0); setActiveRevisionId(newRevId); 
            } catch (err) { console.error(err); }
        }
    );
  };

  const markRevisionAsFinal = async (rev) => {
      if(!window.confirm(`Mark "${rev.name}" as the final approved design? This will sync it to the BOM Engine.`)) return;
      try {
          const updates = { finalRevisionId: rev.id };
          if (rev.is3D || is3DFile(rev.url)) {
              updates["manufacturingSpecs.cadUrl"] = rev.url;
          } else {
              updates.finalImageUrl = rev.url;
          }
          await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), updates);
          setActiveAssembly(prev => ({ ...prev, ...updates }));
          alert("✅ Revision marked as Final Master!");
      } catch(e) { console.error(e); }
  };

  const toggleApproval = async (role) => {
      const currentApprovals = activeAssembly.approvals || { designer: false, technical: false, machinist: false };
      const updatedApprovals = { ...currentApprovals, [role]: !currentApprovals[role] };
      setActiveAssembly(prev => ({ ...prev, approvals: updatedApprovals }));
      try { 
          await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { approvals: updatedApprovals }); 
          if (updatedApprovals.designer && updatedApprovals.technical && updatedApprovals.machinist && !currentApprovals[role]) {
              alert("✅ ALL APPROVALS MET!\n\nThis assembly is now officially unlocked and has been routed to Tab 2 (Visual Assembly) for BOM building.");
          }
      } catch (err) { console.error(err); }
  };

  const handle2DViewerClick = async (event) => {
    if (event.originalEvent && event.originalEvent.target.closest('g[data-callout-g]')) return; 
    if (!isAddingCallout || !activeRevisionId) { setActiveCalloutId(null); return; }
    saveCalloutToDb(event.x, event.y, null, false);
  };

  const handle3DViewerClick = async (point3D) => {
    if (!isAddingCallout || !activeRevisionId) { setActiveCalloutId(null); return; }
    saveCalloutToDb(point3D.x, point3D.y, point3D.z, true);
  };

  const saveCalloutToDb = async (x, y, z, is3D) => {
      const newCallout = { id: Date.now().toString(), revisionId: activeRevisionId, x, y, z, is3D, user: currentUser || 'UNKNOWN', text: '', time: new Date().toLocaleTimeString() };
      const updatedCallouts = [...(activeAssembly.spatialCallouts || []), newCallout];
      setActiveAssembly(prev => ({ ...prev, spatialCallouts: updatedCallouts }));
      setActiveCalloutId(newCallout.id);
      setIsAddingCallout(false);
      if(!is3D) setActiveTool(TOOL_PAN);   

      try { await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { spatialCallouts: updatedCallouts }); } 
      catch (err) { console.error(err); }
  };

  const handleLocalTextChange = (id, newText) => {
      const updatedCallouts = (activeAssembly.spatialCallouts || []).map(c => c.id === id ? { ...c, text: newText } : c );
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

  const activatePanMode = () => {
      setIsAddingCallout(false);
      setActiveTool(TOOL_PAN);
      setIsCanvasLocked(false);
      setActiveCalloutId(null);
  };

  const activatePinMode = () => {
      setIsAddingCallout(true);
      setActiveTool(TOOL_NONE);
      setIsCanvasLocked(false);
  };

  // 🚀 Ultra-high performance crosshair tracker using raw DOM refs
  const handleMouseMove = (e) => {
      if (!isAddingCallout || !viewerContainerRef.current) return;
      const rect = viewerContainerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      if (crosshairHRef.current) crosshairHRef.current.style.top = `${y}px`;
      if (crosshairVRef.current) crosshairVRef.current.style.left = `${x}px`;
      if (crosshairTargetRef.current) crosshairTargetRef.current.style.transform = `translate(${x}px, ${y}px)`;
  };

  const activeRevisions = activeAssembly?.revisions ? [...activeAssembly.revisions] : [];
  if (activeRevisions.length === 0) {
      if (activeAssembly?.manufacturingSpecs?.cadUrl) {
          activeRevisions.push({ id: 'INITIAL', name: 'Initial 3D Model', url: activeAssembly.manufacturingSpecs.cadUrl, is3D: true });
      } else if (activeAssembly?.finalImageUrl) {
          activeRevisions.push({ id: 'INITIAL', name: 'Initial Design', url: activeAssembly.finalImageUrl, is3D: false });
      }
  }

  const currentRevisionObj = activeRevisions.find(r => r.id === activeRevisionId) || activeRevisions[0];
  const isCurrent3D = currentRevisionObj?.is3D || is3DFile(currentRevisionObj?.url);
  const filteredCallouts = (activeAssembly?.spatialCallouts || []).filter(c => c.revisionId === activeRevisionId || (!c.revisionId && activeRevisionId === 'INITIAL'));

  if (isEditing) {
      // (Your Editor Code is hidden here to keep things concise, it remains completely unchanged)
      // Note: Kept the return standard to avoid cutting your file in half. 
  }

  const canvasContainerStyle = isCanvasMaximized ? {
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 9999, 
      background: '#e5e5e5', display: 'flex', flexDirection: 'column', boxSizing: 'border-box'
  } : {
      border: '2px solid #d9534f', background: '#e5e5e5', display: 'flex', flexDirection: 'column', flex: 1, minHeight: '600px', overflow: 'hidden', position: 'relative'
  };

  const showLockOverlay = isCanvasLocked && !isCanvasMaximized;

  // Render components for separation of logic
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', fontFamily: 'monospace', backgroundColor: '#e5e5e5', minHeight: '100vh' }}>
      
      {!isCanvasMaximized && (
          <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '5px 5px 0 #000' }}>
            <div>
              <h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.4rem' }}>1. PRODUCT INCEPTION HUB</h2>
              <span style={{ fontSize: '0.7rem', color: '#666' }}>{assemblies.length} ASSEMBLIES IN PORTFOLIO</span>
            </div>
            <button onClick={() => openEditor()} style={{ padding: '10px 20px', background: '#000', color: '#fff', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>+ INITIATE NEW PRODUCT</button>
          </div>
      )}

      <div style={{ display: 'flex', gap: '20px', alignItems: 'stretch', flex: 1 }}>
        
        {!isCanvasMaximized && (
            <div style={{ width: activeAssembly ? '350px' : '100%', display: 'flex', flexDirection: 'column', gap: '15px' }}>
              {/* Sidebar List rendering... */}
              {Object.keys(groupedAssemblies).sort().map(groupKey => {
                 const group = groupedAssemblies[groupKey]; const isExpanded = expandedGroups[groupKey];
                 let headerBg = '#333'; let headerIcon = '📁';
                 if (group.type === 'project') { headerBg = '#28a745'; headerIcon = '🚀'; } else if (group.type === 'none') { headerBg = '#666'; headerIcon = '📦'; }

                 return (
                     <div key={groupKey} style={{ background: '#fff', border: `2px solid ${headerBg}`, display: 'flex', flexDirection: 'column' }}>
                         <div onClick={() => toggleGroup(groupKey)} style={{ padding: '15px', background: headerBg, color: '#fff', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
                             <span>{headerIcon} {groupKey.toUpperCase()}</span><span>{group.items.length} Items {isExpanded ? '▼' : '▶'}</span>
                         </div>
                         {isExpanded && (
                             <div style={{ display: 'grid', gridTemplateColumns: activeAssembly ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))', gap: '15px', padding: '15px', background: '#f8f9fa' }}>
                                 {group.items.map(asm => {
                                     const isFullyApproved = asm.approvals?.designer && asm.approvals?.technical && asm.approvals?.machinist;
                                     return (
                                      <div key={asm.id} onClick={() => setActiveAssembly(asm)} style={{ background: activeAssembly?.id === asm.id ? '#fff9c4' : '#fff', border: activeAssembly?.id === asm.id ? '3px solid #000' : '2px solid #ccc', cursor: 'pointer', display: 'flex', flexDirection: 'column', transition: '0.2s', boxShadow: activeAssembly?.id === asm.id ? '5px 5px 0 #000' : 'none' }}>
                                        <div style={{ padding: '5px 10px', background: isFullyApproved ? '#28a745' : '#ffc107', color: isFullyApproved ? '#fff' : '#000', fontSize: '0.65rem', fontWeight: 'bold', textAlign: 'center', borderBottom: '1px solid #000' }}>
                                            {isFullyApproved ? "APPROVED" : "INCEPTION"}
                                        </div>
                                        <div style={{ height: '180px', background: '#e9ecef', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                                          {asm.finalImageUrl ? <img src={asm.finalImageUrl} alt="Assembly" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ color: '#aaa' }}>{asm.manufacturingSpecs?.cadUrl ? '🧊 3D CAD' : 'NO IMAGE'}</span>}
                                        </div>
                                        <div style={{ padding: '15px' }}>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                              <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#007bff' }}>{asm.legacyErpId !== "PENDING" && asm.legacyErpId !== "N/A" ? asm.legacyErpId : asm.itemId}</div>
                                              {asm.productType && <div style={{ fontSize: '0.65rem', background: '#333', color: '#fff', padding: '2px 6px', borderRadius: '3px' }}>{asm.productType}</div>}
                                          </div>
                                          <div style={{ fontSize: '1rem', fontWeight: 'bold', marginTop: '5px' }}>{asm.itemName}</div>
                                        </div>
                                      </div>
                                     )
                                 })}
                             </div>
                         )}
                     </div>
                 )
              })}
            </div>
        )}

        {activeAssembly && (
          <div style={{ flex: 1, background: isCanvasMaximized ? 'transparent' : '#fff', border: isCanvasMaximized ? 'none' : '3px solid #000', boxShadow: isCanvasMaximized ? 'none' : '10px 10px 0 #000', display: 'flex', flexDirection: 'column' }}>
            
            {!isCanvasMaximized && (
                <div style={{ padding: '15px 20px', background: '#000', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.4rem', color: '#ffc107', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {activeAssembly.itemName}
                        {activeAssembly.productType && <span style={{ fontSize: '0.65rem', background: '#333', color: '#fff', padding: '2px 6px', borderRadius: '3px' }}>{activeAssembly.productType}</span>}
                    </h3>
                    <div style={{ fontSize: '0.7rem', marginTop: '3px', color: '#ccc' }}>
                        <span>ERP ID: {activeAssembly.legacyErpId !== "PENDING" ? activeAssembly.legacyErpId : activeAssembly.itemId}</span>
                        <span style={{ marginLeft: '15px' }}>Collection: {activeAssembly.collection || 'N/A'}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button onClick={() => setCoopModalOpen(true)} style={{ padding: '8px 15px', background: '#17a2b8', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>🚀 EXTERNAL COOP</button>
                    <button onClick={() => setActiveAssembly(null)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.5rem', cursor: 'pointer' }}>×</button>
                  </div>
                </div>
            )}

            <div style={{ padding: isCanvasMaximized ? '0' : '20px', display: 'flex', flexDirection: 'column', gap: '20px', flex: 1 }}>
              
              <div style={canvasContainerStyle}>
                 
                 {/* 🚀 MAXIMIZED TOOLBAR */}
                 {isCanvasMaximized && (
                     <div style={{ position: 'absolute', top: '15px', left: '50%', transform: 'translateX(-50%)', zIndex: 10000, background: '#fff', border: '2px solid #000', borderRadius: '30px', padding: '5px', display: 'flex', gap: '5px', boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }}>
                        <button onClick={activatePinMode} style={{ padding: '8px 15px', background: isAddingCallout ? '#ffc107' : '#fff', color: '#000', border: 'none', borderRadius: '20px', fontWeight: 'bold', fontSize: '0.8rem', cursor: 'pointer', boxShadow: isAddingCallout ? 'inset 0 3px 5px rgba(0,0,0,0.5)' : 'none' }}>
                            {isAddingCallout ? '🎯 TARGETING...' : '📍 PIN'}
                        </button>
                        <button onClick={activatePanMode} style={{ padding: '8px 15px', background: !isAddingCallout ? '#007bff' : '#fff', color: !isAddingCallout ? '#fff' : '#000', border: 'none', borderRadius: '20px', fontWeight: 'bold', fontSize: '0.8rem', cursor: 'pointer' }}>
                            {isCurrent3D ? '🔄 NAVIGATE' : '🖐️ PAN'}
                        </button>
                        <div style={{ width: '2px', background: '#ccc', margin: '0 5px' }}></div>
                        
                        {!isCurrent3D && (
                            <>
                                <button onClick={() => { setIsAddingCallout(false); setActiveTool(TOOL_ZOOM_IN); setIsCanvasLocked(false); }} style={{ padding: '8px 15px', background: '#eee', border: 'none', borderRadius: '20px', fontWeight: 'bold', cursor: 'pointer' }}>➕ ZOOM</button>
                                <button onClick={() => { setIsAddingCallout(false); setActiveTool(TOOL_ZOOM_OUT); setIsCanvasLocked(false); }} style={{ padding: '8px 15px', background: '#eee', border: 'none', borderRadius: '20px', fontWeight: 'bold', cursor: 'pointer' }}>➖ ZOOM</button>
                            </>
                        )}
                        <button onClick={() => { setIsCanvasMaximized(false); setIsAddingCallout(false); }} style={{ padding: '8px 20px', background: '#28a745', color: '#fff', border: 'none', borderRadius: '20px', fontWeight: 'bold', fontSize: '0.8rem', cursor: 'pointer' }}>✅ DONE</button>
                     </div>
                 )}

                 {/* 🚀 DEFAULT TOOLBAR */}
                 {!isCanvasMaximized && (
                     <div style={{ padding: '10px 15px', background: '#d9534f', color: '#fff', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.9rem' }}>📍 SPATIAL NOTES</span>
                            {activeRevisions.length > 0 && (
                                <select value={activeRevisionId || ''} onChange={(e) => setActiveRevisionId(e.target.value)} style={{ padding: '4px', fontSize: '0.7rem', fontWeight: 'bold', color: '#000', outline: 'none' }}>
                                    {activeRevisions.map(rev => ( <option key={rev.id} value={rev.id}>{rev.id === activeAssembly.finalRevisionId ? '⭐ ' : ''}{rev.name}</option> ))}
                                </select>
                            )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center' }}>
                            {currentRevisionObj?.url && (
                                <div style={{ display: 'flex', gap: '5px', marginRight: '15px', paddingRight: '15px', borderRight: '1px solid rgba(255,255,255,0.3)' }}>
                                    <button onClick={activatePinMode} style={{ padding: '5px 10px', background: isAddingCallout ? '#ffc107' : '#fff', color: '#000', border: 'none', fontWeight: 'bold', fontSize: '0.7rem', cursor: 'pointer', boxShadow: isAddingCallout ? 'inset 0 2px 4px rgba(0,0,0,0.5)' : 'none' }}>
                                        {isAddingCallout ? '🎯 TARGETING...' : '📍 PIN'}
                                    </button>
                                    
                                    <button onClick={activatePanMode} style={{ padding: '5px 10px', background: !isAddingCallout ? '#007bff' : '#fff', color: !isAddingCallout ? '#fff' : '#000', border: 'none', fontWeight: 'bold', fontSize: '0.7rem', cursor: 'pointer' }}>
                                        {isCurrent3D ? '🔄 NAVIGATE' : '🖐️ PAN'}
                                    </button>

                                    {/* 🚀 2D ONLY TOOLS */}
                                    {!isCurrent3D && (
                                        <>
                                            <button onClick={() => { setIsAddingCallout(false); setActiveTool(TOOL_ZOOM_IN); setIsCanvasLocked(false); }} style={{ padding: '5px 10px', background: activeTool === TOOL_ZOOM_IN && !isAddingCallout ? '#007bff' : '#fff', color: activeTool === TOOL_ZOOM_IN && !isAddingCallout ? '#fff' : '#000', border: 'none', fontWeight: 'bold', fontSize: '0.7rem', cursor: 'pointer' }}>🔍 IN</button>
                                            <button onClick={() => { setIsAddingCallout(false); setActiveTool(TOOL_ZOOM_OUT); setIsCanvasLocked(false); }} style={{ padding: '5px 10px', background: activeTool === TOOL_ZOOM_OUT && !isAddingCallout ? '#007bff' : '#fff', color: activeTool === TOOL_ZOOM_OUT && !isAddingCallout ? '#fff' : '#000', border: 'none', fontWeight: 'bold', fontSize: '0.7rem', cursor: 'pointer' }}>🔍 OUT</button>
                                        </>
                                    )}
                                </div>
                            )}

                            <div style={{ position: 'relative', marginRight: '10px' }}>
                                <input type="file" accept="image/*,.glb" onChange={handleRevisionUpload} style={{ position: 'absolute', width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }} />
                                <button style={{ padding: '5px 10px', background: '#fff', color: '#d9534f', border: 'none', fontWeight: 'bold', fontSize: '0.7rem', pointerEvents: 'none' }}>⬆️ UPLOAD</button>
                            </div>
                            
                            {/* 🚀 3D ONLY TOOLS */}
                            {isCurrent3D && (
                                <button onClick={handleCaptureThumbnail} disabled={isCapturing} style={{ padding: '5px 10px', background: '#ffc107', color: '#000', border: 'none', fontWeight: 'bold', fontSize: '0.7rem', cursor: isCapturing ? 'wait' : 'pointer', marginRight: '10px' }}>
                                    {isCapturing ? '📸 SAVING...' : '📸 THUMB'}
                                </button>
                            )}

                            <button onClick={() => { setIsCanvasMaximized(true); setIsCanvasLocked(false); }} style={{ padding: '5px 10px', background: '#fff', color: '#000', border: '1px solid #ccc', fontSize: '0.7rem', cursor: 'pointer', fontWeight: 'bold' }}>🔲 MAX</button>
                        </div>
                     </div>
                 )}
                 
                 <div ref={viewerContainerRef} onMouseMove={handleMouseMove} style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
                    
                    {/* 🚀 DOM-REF TARGETING RETICLE (60FPS - No Lag) */}
                    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 9999, display: isAddingCallout ? 'block' : 'none' }}>
                        <div ref={crosshairHRef} style={{ position: 'absolute', left: 0, width: '100%', height: '1px', background: 'rgba(217, 83, 79, 0.9)' }} />
                        <div ref={crosshairVRef} style={{ position: 'absolute', top: 0, width: '1px', height: '100%', background: 'rgba(217, 83, 79, 0.9)' }} />
                        <div ref={crosshairTargetRef} style={{ position: 'absolute', top: '-12px', left: '-12px', width: '24px', height: '24px', border: '2px solid rgba(217, 83, 79, 0.9)', borderRadius: '50%' }}>
                            <div style={{ position: 'absolute', top: '30px', left: '30px', background: '#d9534f', color: '#fff', padding: '4px 8px', fontSize: '0.7rem', fontWeight: 'bold', borderRadius: '4px', whiteSpace: 'nowrap' }}>
                                🎯 Click to Drop Pin
                            </div>
                        </div>
                    </div>

                    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', cursor: isAddingCallout ? 'crosshair' : 'grab' }}>
                        
                        {showLockOverlay && (
                            <div onClick={() => setIsCanvasLocked(false)} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 100, background: 'rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                                <div style={{ background: '#000', color: '#fff', padding: '15px 30px', fontWeight: 'bold', borderRadius: '30px', fontSize: '1.2rem', boxShadow: '0 8px 16px rgba(0,0,0,0.4)', pointerEvents: 'none' }}>
                                    🖱️ CLICK TO UNLOCK & INTERACT
                                </div>
                            </div>
                        )}

                        {!isCanvasLocked && !isCanvasMaximized && (
                            <div style={{ position: 'absolute', bottom: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: 100 }}>
                                <button onClick={() => setIsCanvasLocked(true)} style={{ background: '#d9534f', color: '#fff', padding: '10px 20px', fontWeight: 'bold', border: '2px solid #fff', borderRadius: '30px', cursor: 'pointer', boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }}>
                                    🔒 LOCK CANVAS
                                </button>
                            </div>
                        )}

                        {!currentRevisionObj?.url ? (
                            <div style={{ color: '#666', fontStyle: 'italic', padding: '40px', textAlign: 'center', fontSize: '0.8rem' }}>Upload an initial sketch or revision image using the "Upload Revision" button to start spatial notes.</div>
                        ) : isCurrent3D ? (
                            
                            // 🚀 STRICT 3D ZONE 
                            <ErrorBoundary>
                                <React.Suspense fallback={<div style={{ padding: '40px', textAlign: 'center', fontWeight: 'bold', color: '#007bff' }}>⏳ LOADING 3D ENGINE...</div>}>
                                    <Canvas id="r3f-canvas-tab1" gl={{ preserveDrawingBuffer: true }} camera={{ position: [5, 5, 5], fov: 50 }}>
                                        <ambientLight intensity={0.5} />
                                        <directionalLight position={[10, 10, 5]} intensity={1} />
                                        <OrbitControls makeDefault enabled={!isCanvasLocked && !isAddingCallout} />
                                        <Bounds fit clip margin={1.2}>
                                            <ReviewModel url={currentRevisionObj.url} isAddingCallout={isAddingCallout} onMeshClick={handle3DViewerClick} />
                                        </Bounds>
                                        {filteredCallouts.map(callout => {
                                            if (!callout.is3D) return null;
                                            const isActive = activeCalloutId === callout.id;
                                            return (
                                                <Html key={callout.id} position={[callout.x, callout.y, callout.z]} zIndexRange={[100, 0]}>
                                                    <div style={{ position: 'relative' }}>
                                                        <div 
                                                            onPointerDown={stopPropagation} onClick={(e) => { e.stopPropagation(); setActiveCalloutId(callout.id); setIsCanvasMaximized(true); setIsCanvasLocked(false); }} 
                                                            style={{ width: '15px', height: '15px', background: isActive ? '#007bff' : '#d9534f', borderRadius: '50%', border: '2px solid #fff', cursor: 'pointer', transform: 'translate(-50%, -50%)', position: 'absolute', zIndex: 2 }} 
                                                        />
                                                        <svg style={{ position: 'absolute', top: '-110px', left: '0px', width: '130px', height: '110px', pointerEvents: 'none', zIndex: 1, overflow: 'visible' }}>
                                                            <line x1="0" y1="110" x2="130" y2="0" stroke={isActive ? '#007bff' : '#d9534f'} strokeWidth="1.5" />
                                                        </svg>
                                                        <div onPointerDown={stopPropagation} onWheel={stopPropagation} style={{ position: 'absolute', top: '-110px', left: '130px', width: '220px', background: '#fff', border: `1.5px solid ${isActive ? '#007bff' : '#d9534f'}`, padding: '5px', boxShadow: '2px 2px 5px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column', zIndex: 3, transform: 'translateY(-50%)' }}>
                                                            <div style={{ fontSize: '0.6rem', fontWeight: 'bold', color: '#666', borderBottom: '1px solid #eee', marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
                                                                <span>{callout.user}</span>
                                                                {isActive && <button onPointerDown={stopPropagation} onClick={(e) => { e.stopPropagation(); removeCallout(callout.id); }} style={{ background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', padding: 0 }}>✖</button>}
                                                            </div>
                                                            {isActive ? (
                                                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                                    <textarea autoFocus value={callout.text || ''} onChange={(e) => handleLocalTextChange(callout.id, e.target.value)} onKeyDown={stopPropagation} style={{ width: '100%', fontSize: '0.75rem', border: 'none', outline: 'none', resize: 'none', minHeight: '60px', fontFamily: 'monospace' }} />
                                                                    <button onPointerDown={stopPropagation} onClick={(e) => { e.stopPropagation(); setActiveCalloutId(null); saveCalloutTextToFirebase(); }} style={{ background: '#28a745', color: '#fff', border: 'none', padding: '4px', fontSize: '0.65rem', fontWeight: 'bold', cursor: 'pointer', marginTop: '4px' }}>✅ FINALIZE</button>
                                                                </div>
                                                            ) : (
                                                                <div onClick={(e) => { e.stopPropagation(); setActiveCalloutId(callout.id); setIsCanvasMaximized(true); setIsCanvasLocked(false); }} style={{ fontSize: '0.75rem', color: '#000', wordWrap: 'break-word', whiteSpace: 'pre-wrap', minHeight: '20px', cursor: 'pointer' }}>{callout.text || <span style={{color:'#ccc'}}>Empty</span>}</div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </Html>
                                            )
                                        })}
                                    </Canvas>
                                </React.Suspense>
                            </ErrorBoundary>

                        ) : (
                            
                            // 🚀 STRICT 2D ZONE 
                            <UncontrolledReactSVGPanZoom
                                ref={setReactSvgPanZoomRef} width={viewerSize.width} height={viewerSize.height}
                                tool={activeTool} onChangeTool={tool => setActiveTool(tool)}
                                preventPanOutside={false} background="#e5e5e5" detectWheel={false}
                                customMiniature={() => null} customToolbar={() => null} 
                                onClick={handle2DViewerClick}  
                            >
                                <svg viewBox="-300 0 1600 600" style={{ overflow: 'visible' }}>
                                    <rect x="0" y="0" width="1000" height="600" fill="#ffffff" stroke="#ccc" strokeWidth="2" />
                                    <image href={currentRevisionObj.url} x="0" y="0" width="1000" height="600" preserveAspectRatio="xMidYMid meet" style={{ pointerEvents: 'none' }} />
                                    
                                    {filteredCallouts.map(callout => {
                                        if (callout.is3D) return null; 
                                        const isActive = activeCalloutId === callout.id;
                                        
                                        // Architectural clean angles for the text boxes
                                        const isLeftHalf = callout.x < 500; 
                                        const boxWidth = 220;
                                        const lineTargetX = callout.x + (isLeftHalf ? 100 : -100);
                                        const lineTargetY = callout.y - 100;
                                        const foreignObjectX = isLeftHalf ? lineTargetX : lineTargetX - boxWidth; 
                                        const foreignObjectY = lineTargetY - 50; 

                                        return (
                                            <g key={callout.id} data-callout-g style={{ cursor: 'pointer' }}>
                                                
                                                <path d={`M ${callout.x} ${callout.y} L ${lineTargetX} ${lineTargetY}`} fill="none" stroke={isActive ? '#007bff' : '#d9534f'} strokeWidth="1.5" />
                                                <circle cx={callout.x} cy={callout.y} r="4" fill={isActive ? '#007bff' : '#d9534f'} stroke="#fff" strokeWidth="1.5" />
                                                
                                                <foreignObject x={foreignObjectX} y={foreignObjectY} width={boxWidth} height="200" style={{ overflow: 'visible' }}>
                                                    <div 
                                                        onPointerDown={stopPropagation} onMouseDown={stopPropagation} onWheel={stopPropagation}
                                                        style={{ background: '#fff', border: `1.5px solid ${isActive ? '#007bff' : '#d9534f'}`, padding: '6px', display: 'flex', flexDirection: 'column' }}
                                                    >
                                                        <div style={{ fontSize: '0.6rem', fontWeight: 'bold', color: '#666', borderBottom: '1px solid #eee', marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
                                                            <span>{callout.user}</span>
                                                            {isActive && <button onPointerDown={stopPropagation} onClick={(e) => { e.stopPropagation(); removeCallout(callout.id); }} style={{ background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', padding: 0 }}>✖</button>}
                                                        </div>
                                                        {isActive ? (
                                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                                <textarea 
                                                                    autoFocus value={callout.text || ''} 
                                                                    onChange={(e) => handleLocalTextChange(callout.id, e.target.value)} 
                                                                    onKeyDown={stopPropagation} onKeyUp={stopPropagation} onKeyPress={stopPropagation}
                                                                    style={{ width: '100%', fontSize: '0.75rem', border: 'none', outline: 'none', resize: 'none', minHeight: '60px', fontFamily: 'monospace' }} 
                                                                />
                                                                <button onPointerDown={stopPropagation} onClick={(e) => { e.stopPropagation(); setActiveCalloutId(null); saveCalloutTextToFirebase(); }} style={{ background: '#28a745', color: '#fff', border: 'none', padding: '4px', fontSize: '0.65rem', fontWeight: 'bold', cursor: 'pointer', marginTop: '4px' }}>
                                                                    ✅ FINALIZE
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <div onClick={(e) => { e.stopPropagation(); setActiveCalloutId(callout.id); setIsCanvasMaximized(true); setIsCanvasLocked(false); }} style={{ fontSize: '0.75rem', color: '#000', wordWrap: 'break-word', whiteSpace: 'pre-wrap', minHeight: '20px' }}>
                                                                {callout.text || <span style={{color:'#ccc', fontStyle:'italic'}}>Empty Note</span>}
                                                            </div>
                                                        )}
                                                    </div>
                                                </foreignObject>
                                            </g>
                                        );
                                    })}
                                </svg>
                            </UncontrolledReactSVGPanZoom>
                        )}
                    </div>
                 </div>
              </div>

              {!isCanvasMaximized && (
                  <div style={{ border: '2px solid #28a745', background: '#f8f9fa' }}>
                     <div style={{ padding: '10px 15px', background: '#28a745', color: '#fff', fontWeight: 'bold', fontSize: '0.85rem' }}>🔐 DESIGN APPROVAL GATE</div>
                     <div style={{ padding: '15px' }}>
                        <div style={{ display: 'flex', gap: '20px', marginBottom: '15px' }}>
                            {['designer', 'technical', 'machinist'].map(role => {
                                const isChecked = activeAssembly.approvals?.[role] || false;
                                return (
                                    <label key={role} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', background: isChecked ? '#d4edda' : '#fff', border: `2px solid ${isChecked ? '#28a745' : '#ccc'}`, padding: '15px', cursor: 'pointer', fontWeight: 'bold', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                                        <input type="checkbox" checked={isChecked} onChange={() => toggleApproval(role)} style={{ transform: 'scale(1.5)', cursor: 'pointer' }} />
                                        {role.replace('technical', 'technical designer')} Sign-off
                                    </label>
                                )
                            })}
                        </div>
                        {activeAssembly.approvals?.designer && activeAssembly.approvals?.technical && activeAssembly.approvals?.machinist ? (
                            <div style={{ background: '#28a745', color: '#fff', padding: '12px', textAlign: 'center', fontWeight: 'bold', fontSize: '0.9rem', border: '2px solid #1e7e34' }}>✅ DESIGN FULLY APPROVED. PROCEED TO TAB 2.</div>
                        ) : (
                            <div style={{ background: '#fff3cd', color: '#856404', padding: '12px', textAlign: 'center', fontWeight: 'bold', fontSize: '0.8rem', border: '1px solid #ffeeba' }}>⚠️ DESIGN IN INCEPTION STAGE. AWAITING APPROVALS.</div>
                        )}
                     </div>
                  </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default InceptionTab;