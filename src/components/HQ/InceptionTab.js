import React, { useState, useEffect, useRef } from 'react';
import { db, storage } from '../../firebase';
import { collection, onSnapshot, doc, setDoc, deleteDoc, serverTimestamp, query, where, updateDoc, getDocs } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { removeImageBackground } from '../Shared/removeBg';
import { UncontrolledReactSVGPanZoom, TOOL_PAN, TOOL_ZOOM_IN, TOOL_ZOOM_OUT, TOOL_NONE } from 'react-svg-pan-zoom';

import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { useGLTF, OrbitControls, Html, Bounds } from '@react-three/drei';

class ErrorBoundary extends React.Component {
    constructor(props) { super(props); this.state = { hasError: false }; }
    static getDerivedStateFromError(error) { return { hasError: true }; }
    componentDidCatch(error, errorInfo) { console.error("3D Render Error:", error); }
    render() {
        if (this.state.hasError) {
            return (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', background: '#fff', border: '1px dashed var(--line)' }}>
                    <div style={{ textAlign: 'center', color: 'var(--ink-soft)' }}>
                        <h3 style={{ fontFamily: 'var(--serif)', fontSize: '2rem', margin: '0 0 10px 0', color: 'var(--ink)' }}>Render Unavailable</h3>
                        <p style={{ fontFamily: 'var(--sans)', fontSize: '0.95rem' }}>The uploaded 3D file is corrupted, missing .bin buffer data, or is an unsupported format.</p>
                        <p style={{ fontFamily: 'var(--sans)', fontSize: '0.85rem' }}>Please use the <b>Upload</b> button above to replace this with a valid <b>.glb</b> file.</p>
                    </div>
                </div>
            );
        }
        return this.props.children; 
    }
}

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
  
  // -- Dynamic HQ Dictionaries --
  const [dynamicProductTypes, setDynamicProductTypes] = useState([]);
  const [collectionsData, setCollectionsData] = useState([]);

  const [expandedGroups, setExpandedGroups] = useState({});

  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({ itemName: "", legacyErpId: "", collection: "N/A", productType: "", project: "", description: "", recordType: "PRODUCT" });
  const [imageFile, setImageFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const [isAddingNewCollection, setIsAddingNewCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [isAddingNewProductType, setIsAddingNewProductType] = useState(false);
  const [newProductTypeName, setNewProductTypeName] = useState("");
  const [isAddingNewProject, setIsAddingNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [imageMode, setImageMode] = useState("UPLOAD"); 
  const [selectedExistingImage, setSelectedExistingImage] = useState("");
  
  const [isAddingCallout, setIsAddingCallout] = useState(false);
  const [isEditingPins, setIsEditingPins] = useState(false);
  
  const [activeCalloutId, setActiveCalloutId] = useState(null);
  const [activeRevisionId, setActiveRevisionId] = useState(null);
  const [stripSwatchBg, setStripSwatchBg] = useState(true);

  const [activeTool, setActiveTool] = useState(TOOL_PAN);
  const [reactSvgPanZoomRef, setReactSvgPanZoomRef] = useState(null);
  
  const [isCanvasMaximized, setIsCanvasMaximized] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false); 

  const viewerContainerRef = useRef(null);
  const [viewerSize, setViewerSize] = useState({ width: 800, height: 600 });
  
  const crosshairHRef = useRef(null);
  const crosshairVRef = useRef(null);
  const crosshairTargetRef = useRef(null);

  const stopPropagation = (e) => {
      e.stopPropagation();
  };

  // Centralized HQ Listeners
  useEffect(() => {
      const unsubLists = onSnapshot(doc(db, "system", "master_lists"), (docSnap) => {
          if (docSnap.exists()){
            const data = docSnap.data();
            if (data.prodTypes) setDynamicProductTypes(data.prodTypes);
          }
      });
      const unsubCollections = onSnapshot(collection(db, "hq_collections"), snap => setCollectionsData(snap.docs.map(d => ({id: d.id, ...d.data()}))));

      return () => { unsubLists(); unsubCollections(); };
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
        collection: assembly.collection || "N/A", productType: assembly.productType || (dynamicProductTypes[0] || ""),
        project: assembly.project || "", description: assembly.description || "", recordType: assembly.recordType || "PRODUCT"
      });
      setActiveAssembly(assembly);
    } else {
      setFormData({ itemName: "", legacyErpId: "", collection: "N/A", productType: dynamicProductTypes[0] || "", project: "", description: "", recordType: "PRODUCT" });
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
        const safeId = `COL_${Date.now()}`;
        await setDoc(doc(db, "hq_collections", safeId), { id: safeId, name: finalCollection, brandId: activeBrand, allowedCustomers: [], allowedFinishes: [] });
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
      recordType: formData.recordType || "PRODUCT",
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
    } catch (err) { console.error(err); alert("Save failed."); }
  };

  const deleteAssembly = async () => {
    if (!activeAssembly) return;
    const confirmDelete = window.confirm(`⚠️ WARNING: Are you sure you want to permanently delete "${activeAssembly.itemName}"? This action cannot be undone.`);
    if (!confirmDelete) return;

    try {
        // Delete this assembly's BOM pins too — only the ones tied to THIS assembly (scoped by
        // assemblyId), so deleting one product never touches another's. Prevents "ghost" pins from
        // resurfacing if the assembly is rebuilt under the same id.
        const pinsSnap = await getDocs(query(collection(db, "assembly_pins"), where("assemblyId", "==", activeAssembly.id)));
        await Promise.all([
            deleteDoc(doc(db, "Approved_Designs", activeAssembly.id)),
            ...pinsSnap.docs.map(d => deleteDoc(doc(db, "assembly_pins", d.id)))
        ]);
        setActiveAssembly(null);
        setIsEditing(false);
        alert(`✅ Deleted "${activeAssembly.itemName}" and ${pinsSnap.docs.length} BOM pin(s).`);
    } catch (err) {
        console.error("Error deleting assembly:", err);
        alert("Failed to delete product.");
    }
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

  const toggleApproval = async (role) => {
      const currentApprovals = activeAssembly.approvals || { designer: false, technical: false, machinist: false };
      const updatedApprovals = { ...currentApprovals, [role]: !currentApprovals[role] };
      setActiveAssembly(prev => ({ ...prev, approvals: updatedApprovals }));
      try { 
          await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { approvals: updatedApprovals }); 
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
      setIsEditingPins(true);
      if(!is3D) setActiveTool(TOOL_NONE);   

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
      const updatedCallouts = (activeAssembly.spatialCallouts || []).filter(c => c.id !== id);
      setActiveAssembly(prev => ({ ...prev, spatialCallouts: updatedCallouts }));
      setActiveCalloutId(null);
      try { await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { spatialCallouts: updatedCallouts }); }
      catch (err) { console.error(err); }
  };

  // --- Drag a 2D note box to reposition it (so stacked notes can be pulled apart). The box position is
  // stored as bx/by on the callout (SVG coords); unset = the original computed offset. We convert the
  // pointer to SVG coords via the content group's screen CTM so it's correct at any pan/zoom level.
  const noteContentRef = useRef(null);
  const noteDragRef = useRef(null);
  const calloutsRef = useRef([]);
  calloutsRef.current = activeAssembly?.spatialCallouts || [];
  const screenToSvg = (clientX, clientY) => {
      const g = noteContentRef.current;
      if (!g || !g.ownerSVGElement || !g.getScreenCTM) return null;
      const pt = g.ownerSVGElement.createSVGPoint(); pt.x = clientX; pt.y = clientY;
      const ctm = g.getScreenCTM(); if (!ctm) return null;
      const p = pt.matrixTransform(ctm.inverse());
      return { x: p.x, y: p.y };
  };
  const onNoteDragMove = (e) => {
      const d = noteDragRef.current; if (!d) return;
      const p = screenToSvg(e.clientX, e.clientY); if (!p) return;
      const bx = p.x - d.grabDX, by = p.y - d.grabDY;
      setActiveAssembly(prev => ({ ...prev, spatialCallouts: (prev.spatialCallouts || []).map(c => c.id === d.id ? { ...c, bx, by } : c) }));
  };
  const onNoteDragEnd = async () => {
      window.removeEventListener('pointermove', onNoteDragMove);
      const d = noteDragRef.current; noteDragRef.current = null;
      if (!d) return;
      try { await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { spatialCallouts: calloutsRef.current }); }
      catch (err) { console.error(err); }
  };
  const startNoteDrag = (e, callout, boxX, boxY) => {
      e.stopPropagation();
      const p = screenToSvg(e.clientX, e.clientY); if (!p) return;
      noteDragRef.current = { id: callout.id, grabDX: p.x - boxX, grabDY: p.y - boxY };
      window.addEventListener('pointermove', onNoteDragMove);
      window.addEventListener('pointerup', onNoteDragEnd, { once: true });
  };

  // --- Image swatch overlays (paint chip / metal texture dropped onto the sketch over a part), per
  // revision. Stored as spatialOverlays: { id, revisionId, url, x, y, w, h } in SVG coords (same
  // 1000x600 space as the notes). Drag the swatch to move it, the corner handle to resize.
  const overlaysRef = useRef([]);
  overlaysRef.current = activeAssembly?.spatialOverlays || [];
  const overlayDragRef = useRef(null);
  const onOverlayDragMove = (e) => {
      const d = overlayDragRef.current; if (!d) return;
      const p = screenToSvg(e.clientX, e.clientY); if (!p) return;
      setActiveAssembly(prev => ({ ...prev, spatialOverlays: (prev.spatialOverlays || []).map(o => {
          if (o.id !== d.id) return o;
          if (d.mode === 'resize') return { ...o, w: Math.max(30, p.x - o.x), h: Math.max(20, p.y - o.y) };
          return { ...o, x: p.x - d.grabDX, y: p.y - d.grabDY };
      }) }));
  };
  const onOverlayDragEnd = async () => {
      window.removeEventListener('pointermove', onOverlayDragMove);
      if (!overlayDragRef.current) return;
      overlayDragRef.current = null;
      try { await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { spatialOverlays: overlaysRef.current }); }
      catch (err) { console.error(err); }
  };
  const startOverlayDrag = (e, ov, mode) => {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();   // stop the browser's native image drag (the "stick")
      const p = screenToSvg(e.clientX, e.clientY); if (!p) return;
      overlayDragRef.current = { id: ov.id, mode, grabDX: p.x - ov.x, grabDY: p.y - ov.y };
      window.addEventListener('pointermove', onOverlayDragMove);
      window.addEventListener('pointerup', onOverlayDragEnd, { once: true });
  };
  const removeOverlay = async (id) => {
      const updated = (activeAssembly.spatialOverlays || []).filter(o => o.id !== id);
      setActiveAssembly(prev => ({ ...prev, spatialOverlays: updated }));
      try { await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { spatialOverlays: updated }); }
      catch (err) { console.error(err); }
  };
  const handleOverlayUpload = async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file || !activeAssembly || !activeRevisionId) return;
      // Strip a clean/uniform background to transparent (in-browser) unless the user opted out.
      setUploadProgress(1);
      const uploadBlob = stripSwatchBg ? await removeImageBackground(file) : file;
      const storageRef = ref(storage, `assemblies/${activeBrand}_${activeAssembly.itemName}_OV_${Date.now()}.png`);
      const uploadTask = uploadBytesResumable(storageRef, uploadBlob);
      uploadTask.on("state_changed",
          (snap) => setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
          (err) => { console.error(err); alert("Swatch upload failed."); },
          async () => {
              const url = await getDownloadURL(uploadTask.snapshot.ref);
              const newOv = { id: `OV-${Date.now()}`, revisionId: activeRevisionId, url, x: 400, y: 230, w: 220, h: 140 };
              const updated = [...(activeAssembly.spatialOverlays || []), newOv];
              setActiveAssembly(prev => ({ ...prev, spatialOverlays: updated }));
              try { await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { spatialOverlays: updated }); setUploadProgress(0); }
              catch (err) { console.error(err); }
          }
      );
  };

  const activatePanMode = () => {
      setIsAddingCallout(false);
      setIsEditingPins(false);
      setActiveTool(TOOL_PAN);
      setActiveCalloutId(null);
  };

  const activatePinMode = () => {
      setIsAddingCallout(true);
      setIsEditingPins(false);
      setActiveTool(TOOL_NONE);
      setActiveCalloutId(null);
  };

  const activateEditMode = () => {
      setIsAddingCallout(false);
      setIsEditingPins(true);
      setActiveTool(TOOL_NONE);
  };

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
  const filteredOverlays = (activeAssembly?.spatialOverlays || []).filter(o => o.revisionId === activeRevisionId || (!o.revisionId && activeRevisionId === 'INITIAL'));
  // Collection picker mirrors the Master Library (LibraryTab): ALL registered hq_collections (no brand
  // filter — some are registered under a blank/other brand) UNION every collection already in use on
  // this brand's items, plus the current item's own value so editing never loses its selection.
  const availableCollections = [...new Set([
      ...collectionsData.map(c => c.name),
      ...assemblies.map(a => a.collection),
      activeAssembly?.collection,
  ].filter(n => n && n !== 'N/A'))].sort((a, b) => String(a).localeCompare(String(b)));

  if (isEditing) {
    const fieldStyle = { width: '100%', padding: '12px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none' };
    const labelStyle = { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px', letterSpacing: '.1em' };

    return (
      <div style={{ padding: '40px', fontFamily: 'var(--sans)', backgroundColor: 'transparent', minHeight: '100vh', display: 'flex', justifyContent: 'center' }}>
        <div style={{ background: '#fff', border: '1px solid var(--line)', width: '800px', padding: '40px', boxShadow: '0 4px 24px rgba(0,0,0,0.04)', borderRadius: '2px' }}>
          <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: '16px', marginBottom: '30px' }}>
              <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>{activeAssembly ? `Edit ${formData.recordType === 'PROJECT' ? 'Project' : 'Product'} Metadata` : `New ${formData.recordType === 'PROJECT' ? 'Project' : 'Product'} Inception`}</h2>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

            <div>
                <label style={labelStyle}>Record Type</label>
                <div style={{ display: 'flex', border: '1px solid var(--line)', width: 'fit-content' }}>
                    {['PRODUCT', 'PROJECT'].map(rt => (
                        <button key={rt} type="button" onClick={() => setFormData({ ...formData, recordType: rt })}
                            style={{ padding: '10px 32px', cursor: 'pointer', border: 'none', background: formData.recordType === rt ? 'var(--ink)' : '#fff', color: formData.recordType === rt ? '#fff' : 'var(--ink-soft)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>
                            {rt}
                        </button>
                    ))}
                </div>
                <span style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', display: 'block', marginTop: '8px' }}>
                    {formData.recordType === 'PROJECT'
                        ? 'Project — early concept to communicate & align. Same design tools; not slated for node grouping / BOM / assembly.'
                        : 'Product — full lifecycle: continues to node grouping, BOM, and assembly.'}
                </span>
            </div>

            <div>
                <label style={labelStyle}>{formData.recordType === 'PROJECT' ? 'Project Name' : 'Product Name'}</label>
                <input value={formData.itemName} onChange={(e) => setFormData({...formData, itemName: e.target.value})} autoFocus placeholder="e.g. The Harlow Bracket" style={{ ...fieldStyle, fontSize: '1.1rem', fontWeight: 500 }} />
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
              <div>
                  <label style={labelStyle}>Legacy ERP ID</label>
                  <input value={formData.legacyErpId} onChange={(e) => setFormData({...formData, legacyErpId: e.target.value})} placeholder="e.g. P-1234" style={{ ...fieldStyle, textTransform: 'uppercase' }} />
              </div>
              
              <div>
                  <label style={labelStyle}>Product Type</label>
                {!isAddingNewProductType ? (
                  <select value={formData.productType} onChange={(e) => { if (e.target.value === "ADD_NEW"){ setIsAddingNewProductType(true); setFormData({...formData, productType: ""}); } else { setFormData({...formData, productType: e.target.value}); } }} style={fieldStyle}>
                    <option value="ADD_NEW">+ Add New Product Type...</option>
                    {dynamicProductTypes.map(type => <option key={type} value={type}>{type}</option>)}
                  </select>
                ) : (
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <input value={newProductTypeName} onChange={(e) => setNewProductTypeName(e.target.value)} placeholder="Type new name..." style={fieldStyle} autoFocus />
                    <button onClick={() => setIsAddingNewProductType(false)} style={{ padding: '0 16px', background: 'var(--paper-2)', border: '1px solid var(--line)', color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', cursor: 'pointer' }}>Cancel</button>
                  </div>
                )}
              </div>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                <div style={{ background: 'var(--paper)', padding: '24px', border: '1px solid var(--line)' }}>
                    <label style={labelStyle}>Collection Assignment</label>
                    {!isAddingNewCollection ? (
                        <select value={formData.collection} onChange={(e) => { if (e.target.value === "ADD_NEW") { setIsAddingNewCollection(true); setFormData({...formData, collection: ""}); } else { setFormData({...formData, collection: e.target.value}); } }} style={fieldStyle}>
                            <option value="ADD_NEW">+ Add New Collection...</option>
                            <option value="N/A">N/A</option>
                            {availableCollections.map(name => <option key={name} value={name}>{name}</option>)}
                        </select>
                    ) : (
                        <div style={{ display: 'flex', gap: '12px' }}>
                            <input value={newCollectionName} onChange={(e) => setNewCollectionName(e.target.value)} placeholder="Type collection name..." style={fieldStyle} autoFocus />
                            <button onClick={() => setIsAddingNewCollection(false)} style={{ padding: '0 16px', background: '#fff', border: '1px solid var(--line)', color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', cursor: 'pointer' }}>Cancel</button>
                        </div>
                    )}
                </div>

                <div style={{ background: 'var(--paper-2)', padding: '24px', border: '1px solid var(--line)' }}>
                    <label style={labelStyle}>Master Project / Grouping</label>
                    {!isAddingNewProject ? (
                        <select value={formData.project} onChange={(e) => { if (e.target.value === "ADD_NEW") { setIsAddingNewProject(true); setFormData({...formData, project: ""}); } else { setFormData({...formData, project: e.target.value}); } }} style={fieldStyle}>
                            <option value="">-- Ungrouped Component --</option>
                            <option value="ADD_NEW">+ Create New Project...</option>
                            {existingProjects.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                    ) : (
                        <div style={{ display: 'flex', gap: '12px' }}>
                            <input value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder="e.g. THE DAWN44 SERIES" style={{ ...fieldStyle, textTransform: 'uppercase' }} autoFocus />
                            <button onClick={() => setIsAddingNewProject(false)} style={{ padding: '0 16px', background: '#fff', border: '1px solid var(--line)', color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', cursor: 'pointer' }}>Cancel</button>
                        </div>
                    )}
                    <span style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', display: 'block', marginTop: '8px' }}>Ensures all sub-components lock together perfectly on the left panel.</span>
                </div>
            </div>

            <div>
                <label style={labelStyle}>Design Description</label>
                <textarea value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} rows={3} style={{ ...fieldStyle, resize: 'vertical' }} />
            </div>
            
            {!activeAssembly && (
                <div style={{ background: '#fff', padding: '24px', border: '1px solid var(--line)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                      <label style={{ ...labelStyle, marginBottom: 0 }}>Initial Sketch / 3D Model (.GLB)</label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                          <button onClick={() => setImageMode("UPLOAD")} style={{ padding: '8px 12px', background: imageMode === "UPLOAD" ? 'var(--ink)' : '#fff', color: imageMode === "UPLOAD" ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', cursor: 'pointer', letterSpacing: '.1em' }}>Upload New</button>
                          <button onClick={() => setImageMode("LIBRARY")} style={{ padding: '8px 12px', background: imageMode === "LIBRARY" ? 'var(--ink)' : '#fff', color: imageMode === "LIBRARY" ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', cursor: 'pointer', letterSpacing: '.1em' }}>Reuse Existing</button>
                      </div>
                  </div>
                  
                  {imageMode === "UPLOAD" ? (
                      <>
                          <input type="file" accept="image/*,.glb" onChange={(e) => setImageFile(e.target.files[0])} style={{ width: '100%', fontFamily: 'var(--sans)', fontSize: '0.9rem' }} />
                          {uploadProgress > 0 && <progress value={uploadProgress} max="100" style={{ width: '100%', marginTop: '12px' }}/>}
                      </>
                  ) : (
                      <select value={selectedExistingImage} onChange={(e) => setSelectedExistingImage(e.target.value)} style={fieldStyle}>
                          <option value="">-- Select previously uploaded drawing --</option>
                          {imageLibrary.map(img => (
                              <option key={img.id} value={img.url}>{img.itemName} {img.is3D ? '(3D Model)' : '(2D Sketch)'} - from {img.project || 'Ungrouped'}</option>
                          ))}
                      </select>
                  )}
                </div>
            )}
            
            <div style={{ display: 'flex', gap: '16px', marginTop: '20px' }}>
              <button onClick={() => saveAssembly("INCEPTION")} style={{ flex: 1, padding: '16px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'background 0.2s' }}>Save Metadata</button>
            </div>
            <button onClick={() => setIsEditing(false)} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', marginTop: '8px' }}>Cancel / Go Back</button>
          </div>
        </div>
      </div>
    );
  }

  const canvasContainerStyle = isCanvasMaximized ? {
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 9999, 
      background: 'var(--paper)', display: 'flex', flexDirection: 'column', boxSizing: 'border-box'
  } : {
      border: '1px solid var(--line)', background: 'var(--paper)', display: 'flex', flexDirection: 'column', flex: 1, minHeight: '600px', overflow: 'hidden', position: 'relative'
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '30px', fontFamily: 'var(--sans)', backgroundColor: 'transparent', minHeight: '100vh' }}>
      
      {!isCanvasMaximized && (
          <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            <div>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: '4px' }}>{assemblies.length} Assemblies in Portfolio</span>
              <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>Product &amp; Project Inception Hub</h2>
            </div>
            <button onClick={() => openEditor()} style={{ padding: '12px 24px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>+ Initiate New Product</button>
          </div>
      )}

      <div style={{ display: 'flex', gap: '24px', alignItems: 'stretch', flex: 1 }}>
        
        {!isCanvasMaximized && (
            <div style={{ width: activeAssembly ? '320px' : '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {assemblies.length === 0 && (
                  <div style={{ background: 'var(--paper)', padding: '40px', border: '1px dashed var(--line)', textAlign: 'center', color: 'var(--ink-soft)', fontFamily: 'var(--serif)', fontSize: '1.2rem', fontStyle: 'italic' }}>
                      No assemblies found. Initiate a new product to begin.
                  </div>
              )}
              {Object.keys(groupedAssemblies).sort().map(groupKey => {
                 const group = groupedAssemblies[groupKey]; const isExpanded = expandedGroups[groupKey];
                 let headerBg = 'var(--paper-2)';
                 
                 return (
                     <div key={groupKey} style={{ background: '#fff', border: `1px solid var(--line)`, display: 'flex', flexDirection: 'column', borderRadius: '2px', overflow: 'hidden' }}>
                         <div onClick={() => toggleGroup(groupKey)} style={{ padding: '16px 20px', background: headerBg, color: 'var(--ink)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
                             <span style={{ fontFamily: 'var(--sans)', fontSize: '0.95rem', fontWeight: 500 }}>{groupKey}</span>
                             <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase' }}>{group.items.length} Items {isExpanded ? '▼' : '▶'}</span>
                         </div>
                         {isExpanded && (
                             <div style={{ display: 'grid', gridTemplateColumns: activeAssembly ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px', padding: '16px', background: '#fff' }}>
                                 {group.items.map(asm => {
                                     const isFullyApproved = asm.approvals?.designer && asm.approvals?.technical && asm.approvals?.machinist;
                                     return (
                                      <div key={asm.id} onClick={() => setActiveAssembly(asm)} style={{ background: activeAssembly?.id === asm.id ? 'var(--paper-2)' : '#fff', border: activeAssembly?.id === asm.id ? '1px solid var(--brass)' : '1px solid var(--line)', cursor: 'pointer', display: 'flex', flexDirection: 'column', transition: 'all 0.2s', boxShadow: activeAssembly?.id === asm.id ? '0 4px 12px rgba(0,0,0,0.05)' : 'none' }}>
                                        <div style={{ padding: '6px 12px', background: isFullyApproved ? 'transparent' : 'var(--paper)', color: 'var(--ink-soft)', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', textAlign: 'center', borderBottom: '1px solid var(--line)' }}>
                                            {isFullyApproved ? "Approved" : "Inception"}
                                        </div>
                                        <div style={{ height: '180px', background: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderBottom: '1px solid var(--line)' }}>
                                          {asm.finalImageUrl ? <img src={asm.finalImageUrl} alt="Assembly" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ color: 'var(--ink-soft)', fontFamily: 'var(--sans)', fontSize: '0.85rem' }}>{asm.manufacturingSpecs?.cadUrl ? '🧊 3D CAD' : 'No Image'}</span>}
                                        </div>
                                        <div style={{ padding: '16px' }}>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                {asm.recordType === 'PROJECT' && <span style={{ fontSize: '8px', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '.05em', color: '#fff', background: 'var(--brass)', padding: '1px 5px' }}>Proj</span>}
                                                <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink)' }}>{asm.legacyErpId !== "PENDING" && asm.legacyErpId !== "N/A" ? asm.legacyErpId : asm.itemId}</div>
                                              </div>
                                              {asm.productType && <div style={{ fontSize: '9px', fontFamily: 'var(--mono)', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{asm.productType}</div>}
                                          </div>
                                          <div style={{ fontFamily: 'var(--sans)', fontSize: '1rem', fontWeight: 500, color: 'var(--ink)', marginTop: '8px' }}>{asm.itemName}</div>
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
          <div style={{ flex: 1, background: isCanvasMaximized ? 'transparent' : '#fff', border: isCanvasMaximized ? 'none' : '1px solid var(--line)', boxShadow: isCanvasMaximized ? 'none' : '0 4px 12px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', borderRadius: '2px', overflow: 'hidden' }}>
            
            {!isCanvasMaximized && (
                <div style={{ padding: '24px 30px', background: 'var(--paper)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {activeAssembly.itemName}
                        {activeAssembly.recordType === 'PROJECT'
                            ? <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: '#fff', padding: '4px 8px', background: 'var(--brass)' }}>Project</span>
                            : <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: '#fff', padding: '4px 8px', background: 'var(--ink)' }}>Product</span>}
                        {activeAssembly.productType && <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', border: '1px solid var(--line)', padding: '4px 8px', background: '#fff' }}>{activeAssembly.productType}</span>}
                    </h3>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', marginTop: '8px', color: 'var(--ink-soft)' }}>
                        <span>ERP ID: {activeAssembly.legacyErpId !== "PENDING" ? activeAssembly.legacyErpId : activeAssembly.itemId}</span>
                        <span style={{ marginLeft: '20px' }}>Collection: {activeAssembly.collection || 'N/A'}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <button onClick={() => openEditor(activeAssembly)} style={{ padding: '8px 16px', background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.2s' }}>Edit Metadata</button>
                    <button onClick={deleteAssembly} style={{ padding: '8px 16px', background: 'transparent', color: '#d9534f', border: 'none', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', cursor: 'pointer' }}>Delete</button>
                    <button onClick={() => setActiveAssembly(null)} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', fontSize: '1.5rem', cursor: 'pointer', marginLeft: '10px' }}>×</button>
                  </div>
                </div>
            )}

            <div style={{ padding: isCanvasMaximized ? '0' : '30px', display: 'flex', flexDirection: 'column', gap: '24px', flex: 1, background: '#fff' }}>
              
              <div style={canvasContainerStyle}>
                 
                 {isCanvasMaximized && (
                     <div style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: 10000, background: '#fff', border: '1px solid var(--line)', borderRadius: '4px', padding: '8px', display: 'flex', gap: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                        <button onClick={activatePinMode} style={{ padding: '8px 16px', background: isAddingCallout ? 'var(--ink)' : 'transparent', color: isAddingCallout ? '#fff' : 'var(--ink)', border: isAddingCallout ? 'none' : '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', cursor: 'pointer', borderRadius: '2px' }}>
                            {isAddingCallout ? 'Targeting...' : 'Drop Pin'}
                        </button>
                        <button onClick={activateEditMode} style={{ padding: '8px 16px', background: isEditingPins ? 'var(--ink)' : 'transparent', color: isEditingPins ? '#fff' : 'var(--ink)', border: isEditingPins ? 'none' : '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', cursor: 'pointer', borderRadius: '2px' }}>
                            Edit Pins
                        </button>
                        <button onClick={activatePanMode} style={{ padding: '8px 16px', background: (!isAddingCallout && !isEditingPins) ? 'var(--ink)' : 'transparent', color: (!isAddingCallout && !isEditingPins) ? '#fff' : 'var(--ink)', border: (!isAddingCallout && !isEditingPins) ? 'none' : '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', cursor: 'pointer', borderRadius: '2px' }}>
                            {isCurrent3D ? 'Orbit' : 'Pan View'}
                        </button>
                        <div style={{ width: '1px', background: 'var(--line)', margin: '0 8px' }}></div>
                        
                        {!isCurrent3D && (
                            <>
                                <button onClick={() => { setIsAddingCallout(false); setIsEditingPins(false); setActiveTool(TOOL_ZOOM_IN); }} style={{ padding: '8px 16px', background: 'var(--paper-2)', color: 'var(--ink)', border: 'none', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', cursor: 'pointer', borderRadius: '2px' }}>Zoom In</button>
                                <button onClick={() => { setIsAddingCallout(false); setIsEditingPins(false); setActiveTool(TOOL_ZOOM_OUT); }} style={{ padding: '8px 16px', background: 'var(--paper-2)', color: 'var(--ink)', border: 'none', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', cursor: 'pointer', borderRadius: '2px' }}>Zoom Out</button>
                            </>
                        )}
                        <button onClick={() => { setIsCanvasMaximized(false); activatePanMode(); }} style={{ padding: '8px 24px', background: 'var(--brass)', color: '#fff', border: 'none', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', cursor: 'pointer', borderRadius: '2px', marginLeft: '8px' }}>Done</button>
                     </div>
                 )}

                 {!isCanvasMaximized && (
                     <div style={{ padding: '16px 20px', background: 'var(--paper)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink)' }}>Spatial Notes</span>
                            {activeRevisions.length > 0 && (
                                <select value={activeRevisionId || ''} onChange={(e) => setActiveRevisionId(e.target.value)} style={{ padding: '6px', fontSize: '0.85rem', fontFamily: 'var(--sans)', border: '1px solid var(--line)', outline: 'none', background: '#fff' }}>
                                    {activeRevisions.map(rev => ( <option key={rev.id} value={rev.id}>{rev.id === activeAssembly.finalRevisionId ? '★ ' : ''}{rev.name}</option> ))}
                                </select>
                            )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            {currentRevisionObj?.url && (
                                <div style={{ display: 'flex', gap: '8px', paddingRight: '20px', borderRight: '1px solid var(--line)' }}>
                                    <button onClick={activatePinMode} style={{ padding: '8px 16px', background: isAddingCallout ? 'var(--ink)' : '#fff', color: isAddingCallout ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.2s' }}>
                                        {isAddingCallout ? 'Targeting...' : 'Drop Pin'}
                                    </button>
                                    
                                    <button onClick={activateEditMode} style={{ padding: '8px 16px', background: isEditingPins ? 'var(--ink)' : '#fff', color: isEditingPins ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.2s' }}>
                                        Edit Pins
                                    </button>

                                    <button onClick={activatePanMode} style={{ padding: '8px 16px', background: (!isAddingCallout && !isEditingPins) ? 'var(--ink)' : '#fff', color: (!isAddingCallout && !isEditingPins) ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.2s' }}>
                                        {isCurrent3D ? 'Orbit' : 'Pan View'}
                                    </button>

                                    {!isCurrent3D && (
                                        <>
                                            <button onClick={() => { activatePanMode(); setActiveTool(TOOL_ZOOM_IN); }} style={{ padding: '8px 12px', background: activeTool === TOOL_ZOOM_IN && (!isAddingCallout && !isEditingPins) ? 'var(--paper-2)' : '#fff', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', cursor: 'pointer' }}>In</button>
                                            <button onClick={() => { activatePanMode(); setActiveTool(TOOL_ZOOM_OUT); }} style={{ padding: '8px 12px', background: activeTool === TOOL_ZOOM_OUT && (!isAddingCallout && !isEditingPins) ? 'var(--paper-2)' : '#fff', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', cursor: 'pointer' }}>Out</button>
                                        </>
                                    )}
                                </div>
                            )}

                            <div style={{ position: 'relative' }}>
                                <input type="file" accept="image/*,.glb" onChange={handleRevisionUpload} style={{ position: 'absolute', width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }} />
                                <button style={{ padding: '8px 16px', background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', pointerEvents: 'none' }}>Upload Revision</button>
                            </div>

                            {!isCurrent3D && activeRevisionId && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <div style={{ position: 'relative' }} title="Drop a paint chip / texture image onto this sketch">
                                        <input type="file" accept="image/*" onChange={handleOverlayUpload} style={{ position: 'absolute', width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }} />
                                        <button style={{ padding: '8px 16px', background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--brass)', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', pointerEvents: 'none' }}>+ Add Swatch</button>
                                    </div>
                                    <label title="Strip a clean/uniform background to transparent on upload" style={{ display: 'flex', alignItems: 'center', gap: '5px', fontFamily: 'var(--mono)', fontSize: '8px', textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-soft)', cursor: 'pointer' }}>
                                        <input type="checkbox" checked={stripSwatchBg} onChange={e => setStripSwatchBg(e.target.checked)} style={{ cursor: 'pointer' }} />
                                        Remove BG
                                    </label>
                                </div>
                            )}

                            {isCurrent3D && (
                                <button onClick={handleCaptureThumbnail} disabled={isCapturing} style={{ padding: '8px 16px', background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', cursor: isCapturing ? 'wait' : 'pointer' }}>
                                    {isCapturing ? 'Saving...' : 'Thumbnail'}
                                </button>
                            )}

                            <button onClick={() => setIsCanvasMaximized(true)} style={{ padding: '8px 16px', background: '#fff', color: 'var(--ink)', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', cursor: 'pointer' }}>Max</button>
                        </div>
                     </div>
                 )}
                 
                 <div ref={viewerContainerRef} onMouseMove={handleMouseMove} style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
                    
                    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 9999, display: isAddingCallout ? 'block' : 'none' }}>
                        <div ref={crosshairHRef} style={{ position: 'absolute', left: 0, width: '100%', height: '1px', background: 'var(--brass)' }} />
                        <div ref={crosshairVRef} style={{ position: 'absolute', top: 0, width: '1px', height: '100%', background: 'var(--brass)' }} />
                        <div ref={crosshairTargetRef} style={{ position: 'absolute', top: '-12px', left: '-12px', width: '24px', height: '24px', border: '1px solid var(--brass)', borderRadius: '50%' }}>
                            <div style={{ position: 'absolute', top: '30px', left: '30px', background: 'var(--paper)', border: '1px solid var(--brass)', color: 'var(--ink)', padding: '6px 10px', fontFamily: 'var(--sans)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                                Click to drop pin
                            </div>
                        </div>
                    </div>

                    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', cursor: isAddingCallout ? 'crosshair' : (isEditingPins ? 'default' : 'grab') }}>
                        
                        {!currentRevisionObj?.url ? (
                            <div style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)', fontSize: '1.2rem', padding: '60px', textAlign: 'center' }}>Upload an initial sketch or revision image using the "Upload Revision" button to start spatial notes.</div>
                        ) : isCurrent3D ? (
                            
                            <ErrorBoundary>
                                <React.Suspense fallback={<div style={{ padding: '60px', textAlign: 'center', fontFamily: 'var(--serif)', fontSize: '1.4rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>Loading 3D Engine...</div>}>
                                    <Canvas id="r3f-canvas-tab1" gl={{ preserveDrawingBuffer: true }} camera={{ position: [5, 5, 5], fov: 50 }}>
                                        <ambientLight intensity={0.5} />
                                        <directionalLight position={[10, 10, 5]} intensity={1} />
                                        <OrbitControls makeDefault enabled={!isAddingCallout && !isEditingPins} />
                                        <Bounds fit clip margin={1.2}>
                                            <ReviewModel url={currentRevisionObj.url} isAddingCallout={isAddingCallout} onMeshClick={handle3DViewerClick} />
                                        </Bounds>
                                        {filteredCallouts.map(callout => {
                                            if (!callout.is3D) return null;
                                            const isActive = activeCalloutId === callout.id;
                                            const isMyPin = callout.user === (currentUser || 'UNKNOWN');
                                            
                                            return (
                                                <Html key={callout.id} position={[callout.x, callout.y, callout.z]} zIndexRange={[100, 0]}>
                                                    <div style={{ position: 'relative' }}>
                                                        <div 
                                                            onPointerDown={stopPropagation} onClick={(e) => { e.stopPropagation(); setActiveCalloutId(callout.id); activateEditMode(); }} 
                                                            style={{ width: '12px', height: '12px', background: isActive ? 'var(--brass)' : '#fff', border: isActive ? '1px solid var(--ink)' : '1px solid var(--brass)', borderRadius: '50%', cursor: 'pointer', transform: 'translate(-50%, -50%)', position: 'absolute', zIndex: 2 }} 
                                                        />
                                                        <svg style={{ position: 'absolute', top: '-110px', left: '0px', width: '130px', height: '110px', pointerEvents: 'none', zIndex: 1, overflow: 'visible' }}>
                                                            <line x1="0" y1="110" x2="130" y2="0" stroke={isActive ? 'var(--brass)' : 'var(--line)'} strokeWidth="1" />
                                                        </svg>
                                                        <div onPointerDown={stopPropagation} onWheel={stopPropagation} style={{ position: 'absolute', top: '-110px', left: '130px', width: '220px', background: '#fff', border: isActive ? '1px solid var(--brass)' : '1px solid var(--line)', padding: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', zIndex: 3, transform: 'translateY(-50%)' }}>
                                                            
                                                            <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)', borderBottom: '1px solid var(--line)', paddingBottom: '6px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                <span>{callout.user}</span>
                                                                <div style={{ display: 'flex', gap: '10px' }}>
                                                                    {!isActive && isMyPin && <button onPointerDown={stopPropagation} onClick={(e) => { e.stopPropagation(); setActiveCalloutId(callout.id); activateEditMode(); }} style={{ background: 'none', border: 'none', color: 'var(--brass)', cursor: 'pointer', padding: 0, fontSize: '9px', fontFamily: 'var(--mono)', textTransform: 'uppercase', fontWeight: 'bold' }}>EDIT</button>}
                                                                    {isMyPin && <button onPointerDown={stopPropagation} onClick={(e) => { e.stopPropagation(); removeCallout(callout.id); }} style={{ background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', padding: 0, fontSize: '9px', fontFamily: 'var(--mono)', textTransform: 'uppercase', fontWeight: 'bold' }}>REMOVE</button>}
                                                                    {isActive && !isMyPin && <button onPointerDown={stopPropagation} onClick={(e) => { e.stopPropagation(); setActiveCalloutId(null); }} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', cursor: 'pointer', padding: 0, fontSize: '9px', fontFamily: 'var(--mono)', textTransform: 'uppercase', fontWeight: 'bold' }}>CLOSE</button>}
                                                                </div>
                                                            </div>
                                                            
                                                            {isActive && isMyPin ? (
                                                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                                    <textarea autoFocus value={callout.text || ''} onChange={(e) => handleLocalTextChange(callout.id, e.target.value)} onKeyDown={stopPropagation} style={{ width: '100%', fontSize: '0.85rem', fontFamily: 'var(--sans)', border: 'none', outline: 'none', resize: 'none', minHeight: '60px' }} />
                                                                    <button onPointerDown={stopPropagation} onClick={(e) => { e.stopPropagation(); setActiveCalloutId(null); saveCalloutTextToFirebase(); activatePanMode(); }} style={{ background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)', padding: '6px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', cursor: 'pointer', marginTop: '8px' }}>Finalize</button>
                                                                </div>
                                                            ) : (
                                                                <div onPointerDown={stopPropagation} onClick={(e) => { e.stopPropagation(); setActiveCalloutId(callout.id); activateEditMode(); }} style={{ fontSize: '0.85rem', fontFamily: 'var(--sans)', color: 'var(--ink)', wordWrap: 'break-word', whiteSpace: 'pre-wrap', minHeight: '20px', cursor: isMyPin ? 'text' : 'pointer' }}>{callout.text || <span style={{color:'var(--ink-soft)', fontStyle: 'italic'}}>Empty Note</span>}</div>
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
                            
                            <UncontrolledReactSVGPanZoom
                                ref={setReactSvgPanZoomRef} width={viewerSize.width} height={viewerSize.height}
                                tool={activeTool} onChangeTool={tool => setActiveTool(tool)}
                                preventPanOutside={false} background="var(--paper)" detectWheel={false}
                                detectAutoPan={false}
                                customMiniature={() => null} customToolbar={() => null} 
                                onClick={handle2DViewerClick}  
                            >
                                <svg viewBox="-300 0 1600 600" style={{ overflow: 'visible' }}>
                                  <g ref={noteContentRef}>
                                    <rect x="0" y="0" width="1000" height="600" fill="#ffffff" stroke="var(--line)" strokeWidth="1" />
                                    <image href={currentRevisionObj.url} x="0" y="0" width="1000" height="600" preserveAspectRatio="xMidYMid meet" style={{ pointerEvents: 'none' }} />

                                    {filteredOverlays.map(ov => (
                                        // No data-callout-g here: in DROP PIN mode we WANT clicks to fall through the
                                        // swatch so a pin (with its leader line) can land on top of it.
                                        <g key={ov.id}>
                                            <image href={ov.url} x={ov.x} y={ov.y} width={ov.w} height={ov.h} preserveAspectRatio="none"
                                                onPointerDown={isAddingCallout ? undefined : (e) => startOverlayDrag(e, ov, 'move')}
                                                onDragStart={(e) => e.preventDefault()}
                                                style={{ cursor: isAddingCallout ? 'crosshair' : 'move', touchAction: 'none', pointerEvents: isAddingCallout ? 'none' : 'auto', WebkitUserDrag: 'none', userSelect: 'none' }} />
                                            <rect x={ov.x} y={ov.y} width={ov.w} height={ov.h} fill="none" stroke="var(--brass)" strokeWidth="1" strokeDasharray="5 3" style={{ pointerEvents: 'none' }} />
                                            {!isAddingCallout && (
                                                <>
                                                    {/* dedicated move grip (top-left) — reliable grab point */}
                                                    <g onPointerDown={(e) => startOverlayDrag(e, ov, 'move')} style={{ cursor: 'move', touchAction: 'none' }}>
                                                        <rect x={ov.x - 1} y={ov.y - 1} width="22" height="20" rx="2" fill="var(--brass)" stroke="#fff" strokeWidth="1.5" />
                                                        <text x={ov.x + 10} y={ov.y + 13} textAnchor="middle" fontSize="12" fill="#fff" style={{ pointerEvents: 'none', fontFamily: 'var(--mono)' }}>⠿</text>
                                                    </g>
                                                    {/* resize grip (bottom-right) */}
                                                    <rect x={ov.x + ov.w - 8} y={ov.y + ov.h - 8} width="16" height="16" fill="var(--brass)" stroke="#fff" strokeWidth="1.5"
                                                        onPointerDown={(e) => startOverlayDrag(e, ov, 'resize')} style={{ cursor: 'nwse-resize', touchAction: 'none' }} />
                                                    <g onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); removeOverlay(ov.id); }} style={{ cursor: 'pointer' }}>
                                                        <circle cx={ov.x + ov.w} cy={ov.y} r="10" fill="#d9534f" stroke="#fff" strokeWidth="1.5" />
                                                        <text x={ov.x + ov.w} y={ov.y + 4} textAnchor="middle" fontSize="13" fontWeight="bold" fill="#fff" style={{ pointerEvents: 'none', fontFamily: 'var(--mono)' }}>×</text>
                                                    </g>
                                                </>
                                            )}
                                        </g>
                                    ))}

                                    {filteredCallouts.map(callout => {
                                        if (callout.is3D) return null; 
                                        const isActive = activeCalloutId === callout.id;
                                        const isMyPin = callout.user === (currentUser || 'UNKNOWN');
                                        
                                        const isLeftHalf = callout.x < 500;
                                        const boxWidth = 220;
                                        const lineTargetX = callout.x + (isLeftHalf ? 100 : -100);
                                        const lineTargetY = callout.y - 100;
                                        const defBoxX = isLeftHalf ? lineTargetX : lineTargetX - boxWidth;
                                        const defBoxY = lineTargetY - 50;
                                        // Box position: dragged (bx/by) if set, else the original computed offset.
                                        const boxX = callout.bx != null ? callout.bx : defBoxX;
                                        const boxY = callout.by != null ? callout.by : defBoxY;

                                        return (
                                            <g key={callout.id} data-callout-g style={{ cursor: 'pointer' }}>

                                                <path d={`M ${callout.x} ${callout.y} L ${boxX + boxWidth / 2} ${boxY + 16}`} fill="none" stroke={isActive ? 'var(--brass)' : 'var(--line)'} strokeWidth="1" />
                                                <circle cx={callout.x} cy={callout.y} r="4" fill={isActive ? 'var(--brass)' : '#fff'} stroke="var(--ink)" strokeWidth="1" />

                                                <foreignObject x={boxX} y={boxY} width={boxWidth} height="200" style={{ overflow: 'visible' }}>
                                                    <div 
                                                        onPointerDown={stopPropagation} onMouseDown={stopPropagation} onWheel={stopPropagation}
                                                        style={{ background: '#fff', border: isActive ? '1px solid var(--brass)' : '1px solid var(--line)', padding: '12px', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}
                                                    >
                                                        <div onPointerDown={(e) => startNoteDrag(e, callout, boxX, boxY)} title="Drag to move this note" style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)', borderBottom: '1px solid var(--line)', paddingBottom: '6px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'move', touchAction: 'none' }}>
                                                            <span>⠿ {callout.user}</span>
                                                            <div style={{ display: 'flex', gap: '10px' }}>
                                                                {!isActive && isMyPin && <button onPointerDown={stopPropagation} onMouseDown={stopPropagation} onClick={(e) => { e.stopPropagation(); setActiveCalloutId(callout.id); activateEditMode(); }} style={{ background: 'none', border: 'none', color: 'var(--brass)', cursor: 'pointer', padding: 0, fontSize: '9px', fontFamily: 'var(--mono)', textTransform: 'uppercase', fontWeight: 'bold' }}>EDIT</button>}
                                                                {isMyPin && <button onPointerDown={stopPropagation} onMouseDown={stopPropagation} onClick={(e) => { e.stopPropagation(); removeCallout(callout.id); }} style={{ background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', padding: 0, fontSize: '9px', fontFamily: 'var(--mono)', textTransform: 'uppercase', fontWeight: 'bold' }}>REMOVE</button>}
                                                                {isActive && !isMyPin && <button onPointerDown={stopPropagation} onMouseDown={stopPropagation} onClick={(e) => { e.stopPropagation(); setActiveCalloutId(null); }} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', cursor: 'pointer', padding: 0, fontSize: '9px', fontFamily: 'var(--mono)', textTransform: 'uppercase', fontWeight: 'bold' }}>CLOSE</button>}
                                                            </div>
                                                        </div>
                                                        
                                                        {isActive && isMyPin ? (
                                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                                <textarea 
                                                                    autoFocus value={callout.text || ''} 
                                                                    onChange={(e) => handleLocalTextChange(callout.id, e.target.value)} 
                                                                    onKeyDown={stopPropagation} onKeyUp={stopPropagation} onKeyPress={stopPropagation}
                                                                    style={{ width: '100%', fontSize: '0.85rem', fontFamily: 'var(--sans)', border: 'none', outline: 'none', resize: 'none', minHeight: '60px' }} 
                                                                />
                                                                <button onPointerDown={stopPropagation} onMouseDown={stopPropagation} onClick={(e) => { e.stopPropagation(); setActiveCalloutId(null); saveCalloutTextToFirebase(); activatePanMode(); }} style={{ background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)', padding: '6px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', cursor: 'pointer', marginTop: '8px' }}>
                                                                    Finalize
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <div onPointerDown={stopPropagation} onMouseDown={stopPropagation} onClick={(e) => { e.stopPropagation(); setActiveCalloutId(callout.id); activateEditMode(); }} style={{ fontSize: '0.85rem', fontFamily: 'var(--sans)', color: 'var(--ink)', wordWrap: 'break-word', whiteSpace: 'pre-wrap', minHeight: '20px', cursor: isMyPin ? 'text' : 'pointer' }}>
                                                                {callout.text || <span style={{color:'var(--ink-soft)', fontStyle:'italic'}}>Empty Note</span>}
                                                            </div>
                                                        )}
                                                    </div>
                                                </foreignObject>
                                            </g>
                                        );
                                    })}
                                  </g>
                                </svg>
                            </UncontrolledReactSVGPanZoom>
                        )}
                    </div>
                 </div>
              </div>

              {!isCanvasMaximized && (
                  <div style={{ border: '1px solid var(--line)', background: '#fff' }}>
                     <div style={{ padding: '16px 24px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                         <span style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)' }}>Design Approval Gate</span>
                     </div>
                     <div style={{ padding: '24px' }}>
                        <div style={{ display: 'flex', gap: '24px', marginBottom: '20px' }}>
                            {['designer', 'technical', 'machinist'].map(role => {
                                const isChecked = activeAssembly.approvals?.[role] || false;
                                return (
                                    <label key={role} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px', background: isChecked ? 'var(--paper-2)' : '#fff', border: `1px solid ${isChecked ? 'var(--brass)' : 'var(--line)'}`, padding: '16px', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: '0.95rem', color: 'var(--ink)', transition: 'all 0.2s' }}>
                                        <input type="checkbox" checked={isChecked} onChange={() => toggleApproval(role)} style={{ transform: 'scale(1.2)', cursor: 'pointer' }} />
                                        {role.replace('technical', 'technical designer')} Sign-off
                                    </label>
                                )
                            })}
                        </div>
                        {activeAssembly.approvals?.designer && activeAssembly.approvals?.technical && activeAssembly.approvals?.machinist ? (
                            <div style={{ background: 'var(--paper)', color: 'var(--ink)', padding: '16px', textAlign: 'center', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Design Fully Approved. Proceed to Visual Assembly.</div>
                        ) : (
                            <div style={{ background: '#fff', color: 'var(--ink-soft)', padding: '16px', textAlign: 'center', border: '1px dashed var(--line)', fontStyle: 'italic', fontSize: '0.9rem' }}>Design in Inception Stage. Awaiting Approvals.</div>
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