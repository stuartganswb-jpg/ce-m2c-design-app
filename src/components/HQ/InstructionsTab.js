import React, { useState, useEffect, useRef, useMemo } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, query, where, doc, updateDoc, writeBatch } from "firebase/firestore";
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF, OrbitControls, Html, Bounds } from '@react-three/drei';

const CameraController = ({ zoomTrigger }) => {
    const { camera } = useThree();
    useEffect(() => {
        if (zoomTrigger === 'IN') camera.position.multiplyScalar(0.8);
        if (zoomTrigger === 'OUT') camera.position.multiplyScalar(1.2);
        camera.updateProjectionMatrix();
    }, [zoomTrigger, camera]);
    return null;
};

const ExplodableModel = ({ url, explodeFactor, explodeMode, nodeClusters, onMeshClick, onMeshCount, activeTool, isFrozen }) => {
    const { scene } = useGLTF(url);
    const clonedScene = useMemo(() => scene.clone(true), [scene]);
    const modelRef = useRef();

    const { originalData, sceneSize } = useMemo(() => {
        const data = new Map();
        let count = 0;
        const sceneBox = new THREE.Box3().setFromObject(clonedScene);
        const size = sceneBox.getSize(new THREE.Vector3()).length();
        const sceneCenter = new THREE.Vector3();
        sceneBox.getCenter(sceneCenter);

        const clusterCenters = {};
        const meshToClusterMap = {};

        if (explodeMode === 'GROUPED' && nodeClusters && nodeClusters.length > 0) {
            nodeClusters.forEach(cluster => {
                const cBox = new THREE.Box3();
                let hasMeshes = false;
                clonedScene.traverse((child) => {
                    if (child.isMesh && cluster.meshes.includes(child.name)) {
                        child.geometry.computeBoundingBox();
                        const meshBox = child.geometry.boundingBox.clone();
                        meshBox.applyMatrix4(child.matrixWorld);
                        cBox.union(meshBox);
                        meshToClusterMap[child.name] = cluster.id;
                        hasMeshes = true;
                    }
                });
                if (hasMeshes) {
                    const cCenter = new THREE.Vector3();
                    cBox.getCenter(cCenter);
                    clusterCenters[cluster.id] = cCenter;
                }
            });
        }

        clonedScene.traverse((child) => {
            if (child.isMesh) {
                count++;
                child.material = child.material.clone();
                let moveCenter = new THREE.Vector3();
                if (explodeMode === 'GROUPED' && meshToClusterMap[child.name] && clusterCenters[meshToClusterMap[child.name]]) {
                    moveCenter.copy(clusterCenters[meshToClusterMap[child.name]]);
                } else {
                    child.geometry.computeBoundingBox();
                    child.geometry.boundingBox.getCenter(moveCenter);
                    child.localToWorld(moveCenter);
                }
                const direction = moveCenter.clone().sub(sceneCenter).normalize();
                if (direction.lengthSq() === 0) direction.set(0, 1, 0);
                data.set(child.uuid, { initialPosition: child.position.clone(), direction: direction });
            }
        });

        if (onMeshCount) onMeshCount(count);
        return { originalData: data, sceneSize: size };
    }, [clonedScene, explodeMode, nodeClusters, onMeshCount]);

    useFrame(() => {
        if (!modelRef.current) return;
        modelRef.current.traverse((child) => {
            if (child.isMesh) {
                const data = originalData.get(child.uuid);
                if (data) {
                    const pushDistance = (explodeFactor / 100) * (sceneSize * 0.8); 
                    child.position.copy(data.initialPosition).add(data.direction.clone().multiplyScalar(pushDistance));
                }
            }
        });
    });

    return (
        <primitive 
            ref={modelRef} object={clonedScene} 
            onPointerOver={(e) => { 
                e.stopPropagation(); 
                if (!isFrozen && activeTool === 'BOM') document.body.style.cursor = 'crosshair'; 
                if (isFrozen && activeTool === 'CALLOUT') document.body.style.cursor = 'crosshair';
            }}
            onPointerOut={(e) => { e.stopPropagation(); document.body.style.cursor = 'auto'; }}
            onClick={(e) => { e.stopPropagation(); onMeshClick(e.point); }}
        />
    );
};

const InstructionsTab = ({ currentUser, activeBrand }) => {
  const [masterAssemblies, setMasterAssemblies] = useState([]);
  const [activeAssembly, setActiveAssembly] = useState(null);
  const [bomParts, setBomParts] = useState([]);
  const [cpqRoutingTypes, setCpqRoutingTypes] = useState([]);
  
  const [rightPanelTab, setRightPanelTab] = useState('PAGES'); 
  const [sopEdits, setSopEdits] = useState({});

  const [activeStepId, setActiveStepId] = useState(null);
  const [activeTagId, setActiveTagId] = useState(null);
  
  // 🚀 MARKUP STUDIO STATE
  const [activeTool, setActiveTool] = useState('ORBIT'); // ORBIT, BOM, CALLOUT, DRAW
  const [isFrozen, setIsFrozen] = useState(false); // 🔥 NEW FREEZE MECHANIC
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentLine, setCurrentLine] = useState(null);
  const svgRef = useRef(null);

  const [explodeFactor, setExplodeFactor] = useState(0);
  const [explodeMode, setExplodeMode] = useState('INDIVIDUAL'); 
  const [meshCount, setMeshCount] = useState(0);
  const [zoomTrigger, setZoomTrigger] = useState(null);

  useEffect(() => {
      const unsubLists = onSnapshot(doc(db, "system", "master_lists"), (docSnap) => {
          if (docSnap.exists() && docSnap.data().cpqRoutingTypes) {
              setCpqRoutingTypes(docSnap.data().cpqRoutingTypes);
          }
      });
      return () => unsubLists();
  }, []);

  useEffect(() => {
    if (!activeBrand) return;
    const q = query(collection(db, "Approved_Designs"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      let docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const cpqTypes = cpqRoutingTypes.map(t => t.toUpperCase());

      docs = docs.filter(d => {
          const isBrandMatch = d.brandId === activeBrand || (d.sharedBrands && d.sharedBrands.includes(activeBrand));
          if (!isBrandMatch) return false;
          const rType = (d.routingType || "").toUpperCase();
          return d.partClass === 'Master Assembly' || cpqTypes.includes(rType) || rType === 'MASTER' || rType === 'MAIN' || rType.includes('CPQ');
      });

      docs.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setMasterAssemblies(docs);
      
      setActiveAssembly(prev => {
          if (prev) return docs.find(d => d.id === prev.id) || prev;
          return prev;
      });
    });
    return () => unsubscribe();
  }, [activeBrand, cpqRoutingTypes]);

  useEffect(() => {
    if (!activeAssembly) { setBomParts([]); return; }
    const q = query(collection(db, "assembly_pins"), where("assemblyId", "==", activeAssembly.itemId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setBomParts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    
    if (activeAssembly.instructionSteps && activeAssembly.instructionSteps.length > 0 && !activeStepId) {
        setActiveStepId(activeAssembly.instructionSteps[0].id);
    } else if ((!activeAssembly.instructionSteps || activeAssembly.instructionSteps.length === 0) && !activeStepId) {
        handleCreateStep(activeAssembly);
    }

    if (activeAssembly.manufacturingSpecs?.shopRoutings) {
        const edits = {};
        activeAssembly.manufacturingSpecs.shopRoutings.forEach(op => {
            edits[op.progId] = op.steps || '';
        });
        setSopEdits(edits);
    }

    return () => unsubscribe();
  }, [activeAssembly]);

  // =====================================
  // PAGE / STEP MANAGEMENT
  // =====================================
  const handleCreateStep = async (assembly) => {
      const currentSteps = assembly.instructionSteps || [];
      const newStep = { id: `STEP-${Date.now()}`, title: `Page ${currentSteps.length + 1}`, tags: [], callouts: [], drawings: [] };
      const updatedSteps = [...currentSteps, newStep];
      setActiveAssembly(prev => ({ ...prev, instructionSteps: updatedSteps }));
      setActiveStepId(newStep.id);
      setIsFrozen(false);
      setActiveTool('ORBIT');
      try { await updateDoc(doc(db, "Approved_Designs", assembly.id), { instructionSteps: updatedSteps }); } catch (e) {}
  };

  const handleDeleteStep = async (stepId) => {
      if(!window.confirm("Delete this entire instruction page and all its tags?")) return;
      const updatedSteps = activeAssembly.instructionSteps.filter(s => s.id !== stepId);
      setActiveAssembly(prev => ({ ...prev, instructionSteps: updatedSteps }));
      setActiveStepId(updatedSteps.length > 0 ? updatedSteps[0].id : null);
      try { await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { instructionSteps: updatedSteps }); } catch (e) {}
  };

  const updateStepTitle = async (stepId, newTitle) => {
      const updatedSteps = activeAssembly.instructionSteps.map(s => s.id === stepId ? { ...s, title: newTitle } : s);
      setActiveAssembly(prev => ({ ...prev, instructionSteps: updatedSteps }));
      try { await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { instructionSteps: updatedSteps }); } catch (e) {}
  };

  // =====================================
  // 3D CLICK HANDLER (TAGS & CALLOUTS)
  // =====================================
  const handleMeshClick = async (point3D) => {
      if (!activeAssembly || !activeStepId) return;
      
      const currentSteps = activeAssembly.instructionSteps || [];
      const activeStep = currentSteps.find(s => s.id === activeStepId);
      if (!activeStep) return;

      // 📍 Unfrozen: Drop BOM Pins
      if (!isFrozen && activeTool === 'BOM') {
          const nextNumber = activeStep.tags?.length > 0 ? Math.max(...activeStep.tags.map(t => t.number)) + 1 : 1;
          const newTag = { id: Date.now().toString(), x: point3D.x, y: point3D.y, z: point3D.z, number: nextNumber, linkedPinId: null };
          const updatedSteps = currentSteps.map(s => s.id === activeStepId ? { ...s, tags: [...(s.tags||[]), newTag] } : s);
          setActiveAssembly(prev => ({ ...prev, instructionSteps: updatedSteps }));
          setActiveTagId(newTag.id);
          setActiveTool('ORBIT'); 
          try { await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { instructionSteps: updatedSteps }); } catch (err) {}
      } 
      // 💬 Frozen: Drop Text Callouts
      else if (isFrozen && activeTool === 'CALLOUT') {
          const newCallout = { id: Date.now().toString(), x: point3D.x, y: point3D.y, z: point3D.z, text: "New Note..." };
          const updatedSteps = currentSteps.map(s => s.id === activeStepId ? { ...s, callouts: [...(s.callouts||[]), newCallout] } : s);
          setActiveAssembly(prev => ({ ...prev, instructionSteps: updatedSteps }));
          try { await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { instructionSteps: updatedSteps }); } catch (err) {}
      }
  };

  // =====================================
  // CALLOUT MANAGEMENT
  // =====================================
  const updateCalloutText = async (calloutId, text) => {
      const updatedSteps = activeAssembly.instructionSteps.map(s => {
          if (s.id !== activeStepId) return s;
          return { ...s, callouts: s.callouts.map(c => c.id === calloutId ? { ...c, text } : c) };
      });
      setActiveAssembly(prev => ({ ...prev, instructionSteps: updatedSteps }));
      try { await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { instructionSteps: updatedSteps }); } catch (e) {}
  };

  const removeCallout = async (calloutId) => {
      const updatedSteps = activeAssembly.instructionSteps.map(s => {
          if (s.id !== activeStepId) return s;
          return { ...s, callouts: s.callouts.filter(c => c.id !== calloutId) };
      });
      setActiveAssembly(prev => ({ ...prev, instructionSteps: updatedSteps }));
      try { await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { instructionSteps: updatedSteps }); } catch (e) {}
  };

  const updateTagAssignment = async (tagId, linkedPinId) => {
      const updatedSteps = activeAssembly.instructionSteps.map(s => {
          if (s.id !== activeStepId) return s;
          return { ...s, tags: s.tags.map(t => t.id === tagId ? { ...t, linkedPinId } : t) };
      });
      setActiveAssembly(prev => ({ ...prev, instructionSteps: updatedSteps }));
      try { await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { instructionSteps: updatedSteps }); } catch (e) {}
  };

  const removeTag = async (id) => {
      if(!window.confirm("Remove this BOM tag from this page?")) return;
      const updatedSteps = activeAssembly.instructionSteps.map(s => {
          if (s.id !== activeStepId) return s;
          const filteredTags = s.tags.filter(t => t.id !== id);
          return { ...s, tags: filteredTags.map((t, idx) => ({ ...t, number: idx + 1 })) };
      });
      setActiveAssembly(prev => ({ ...prev, instructionSteps: updatedSteps }));
      setActiveTagId(null);
      try { await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { instructionSteps: updatedSteps }); } catch (e) {}
  };

  // =====================================
  // 2D FINELINER SVG LOGIC
  // =====================================
  const getSvgCoords = (e) => {
      const rect = svgRef.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 1000;
      const y = ((e.clientY - rect.top) / rect.height) * 1000;
      return { x, y };
  };

  const startDraw = (e) => {
      if (!isFrozen || activeTool !== 'DRAW') return;
      e.preventDefault();
      setIsDrawing(true);
      setCurrentLine({ id: Date.now().toString(), points: [getSvgCoords(e)] });
  };

  const draw = (e) => {
      if (!isFrozen || !isDrawing || activeTool !== 'DRAW' || !currentLine) return;
      e.preventDefault();
      setCurrentLine(prev => ({ ...prev, points: [...prev.points, getSvgCoords(e)] }));
  };

  const endDraw = async () => {
      if (!isDrawing) return;
      setIsDrawing(false);
      if (currentLine && currentLine.points.length > 1) {
          const updatedSteps = activeAssembly.instructionSteps.map(s => {
              if (s.id !== activeStepId) return s;
              return { ...s, drawings: [...(s.drawings || []), currentLine] };
          });
          setActiveAssembly(prev => ({ ...prev, instructionSteps: updatedSteps }));
          setCurrentLine(null);
          try { await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { instructionSteps: updatedSteps }); } catch (e) {}
      } else {
          setCurrentLine(null);
      }
  };

  const clearDrawings = async (skipConfirm = false) => {
      if(!skipConfirm && !window.confirm("Clear all fineliner drawings from this page?")) return;
      const updatedSteps = activeAssembly.instructionSteps.map(s => {
          if (s.id !== activeStepId) return s;
          return { ...s, drawings: [] };
      });
      setActiveAssembly(prev => ({ ...prev, instructionSteps: updatedSteps }));
      try { await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { instructionSteps: updatedSteps }); } catch (e) {}
  };

  // 🔓 Handle Unfreezing Safely
  const handleUnfreeze = () => {
      const activeStepObj = (activeAssembly?.instructionSteps || []).find(s => s.id === activeStepId);
      if (activeStepObj?.drawings?.length > 0) {
          if(window.confirm("⚠️ UNFREEZING: This will clear your hand-drawn 2D Fineliner drawings because they will no longer align with the 3D model. (Your Text Callouts will stay). Continue?")) {
              clearDrawings(true);
              setIsFrozen(false);
              setActiveTool('ORBIT');
          }
      } else {
          setIsFrozen(false);
          setActiveTool('ORBIT');
      }
  };

  // =====================================
  // SHOP FLOOR SOP SYNC
  // =====================================
  const handleSyncSops = async () => {
      if (!window.confirm("Sync these instructions directly to the Factory Floor tablets?")) return;
      const batch = writeBatch(db);
      const updatedRoutings = activeAssembly.manufacturingSpecs.shopRoutings.map(op => {
          const newText = sopEdits[op.progId] || op.steps;
          const progRef = doc(db, "shop_programs", op.progId);
          batch.update(progRef, { steps: newText });
          return { ...op, steps: newText };
      });
      const hqRef = doc(db, "Approved_Designs", activeAssembly.id);
      batch.update(hqRef, { "manufacturingSpecs.shopRoutings": updatedRoutings });
      try {
          await batch.commit();
          alert("✅ SOPs successfully synced to Shop Floor Tablets!");
      } catch (err) {
          console.error(err);
          alert("Failed to sync SOPs to factory floor.");
      }
  };

  const triggerZoom = (direction) => {
      setZoomTrigger(direction);
      setTimeout(() => setZoomTrigger(null), 100);
  };

  const getToolStyle = (toolName) => ({
      padding: '8px 12px',
      background: activeTool === toolName ? '#000' : '#fff',
      color: activeTool === toolName ? '#fff' : '#000',
      border: '2px solid #000',
      cursor: 'pointer',
      fontWeight: 'bold',
      fontSize: '0.8rem',
      borderRadius: '4px',
      transition: '0.2s'
  });

  const activeStepObj = (activeAssembly?.instructionSteps || []).find(s => s.id === activeStepId);
  const activeTags = activeStepObj?.tags || [];
  const activeCallouts = activeStepObj?.callouts || [];
  const activeDrawings = activeStepObj?.drawings || [];
  const nodeClusters = activeAssembly?.nodeClusters || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', fontFamily: 'monospace', backgroundColor: '#e5e5e5', minHeight: '100vh' }}>
      
      <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '5px 5px 0 #000' }}>
        <div>
          <h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.4rem', color: '#fd7e14' }}>6. Interactive 3D Instructions</h2>
          <span style={{ fontSize: '0.7rem', color: '#666' }}>EXPLODED VIEW & BOM MAPPING STUDIO</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
        
        <div style={{ width: activeAssembly ? '300px' : '100%', display: 'flex', flexDirection: 'column', gap: '15px' }}>
          {masterAssemblies.length === 0 && (
              <div style={{ background: '#fff', padding: '30px', border: '2px dashed #fd7e14', textAlign: 'center', color: '#fd7e14', fontWeight: 'bold' }}>
                  NO MASTER ASSEMBLIES FOUND. Classify an assembly as "CPQ Enabled" or "MASTER" in Tab 4/Tab 2 to begin.
              </div>
          )}
          {masterAssemblies.map(asm => {
             const hasCAD = !!asm.manufacturingSpecs?.cadUrl;
             return (
              <div key={asm.id} onClick={() => { setActiveAssembly(asm); setExplodeFactor(0); setMeshCount(0); setIsFrozen(false); setActiveTool('ORBIT'); }} style={{ background: activeAssembly?.id === asm.id ? '#fff9c4' : '#fff', border: activeAssembly?.id === asm.id ? '3px solid #000' : '2px solid #ccc', cursor: 'pointer', display: 'flex', flexDirection: 'column', transition: '0.2s', boxShadow: activeAssembly?.id === asm.id ? '5px 5px 0 #000' : 'none' }}>
                <div style={{ padding: '5px 10px', background: hasCAD ? '#fd7e14' : '#666', color: '#fff', fontSize: '0.65rem', fontWeight: 'bold', textAlign: 'center', borderBottom: '1px solid #000' }}>
                    <span>{hasCAD ? '⚙️ 3D CAD AVAILABLE' : '⚠️ NO CAD UPLOADED'}</span>
                </div>
                <div style={{ padding: '15px' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#007bff' }}>{asm.legacyErpId !== "PENDING" && asm.legacyErpId !== "N/A" ? asm.legacyErpId : asm.itemId}</div>
                  <div style={{ fontSize: '1rem', fontWeight: 'bold', marginTop: '5px' }}>{asm.itemName}</div>
                </div>
              </div>
             )
          })}
        </div>

        {activeAssembly && (
          <div style={{ flex: 1, background: '#fff', border: '3px solid #000', boxShadow: '10px 10px 0 #000', display: 'flex', flexDirection: 'column' }}>
            
            <div style={{ padding: '15px 20px', background: '#000', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.4rem', color: '#fd7e14' }}>{activeAssembly.itemName} - MANUAL BUILDER</h3>
              <button onClick={() => setActiveAssembly(null)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.5rem', cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ padding: '20px', display: 'flex', gap: '20px', flex: 1 }}>
              
              <div style={{ border: isFrozen ? '4px solid #d9534f' : '2px solid #000', background: '#e5e5e5', display: 'flex', flexDirection: 'column', flex: 1.5, minHeight: '600px', position: 'relative', transition: '0.2s' }}>
                 
                 <div style={{ padding: '15px', background: '#fff', borderBottom: '2px solid #000', display: 'flex', flexDirection: 'column', gap: '15px', zIndex: 100 }}>
                     
                     {/* 🚀 UPGRADED: DYNAMIC FREEZE TOOLBAR */}
                     <div style={{ display: 'flex', gap: '10px', background: isFrozen ? '#fff0f0' : '#f8f9fa', padding: '10px', border: isFrozen ? '1px solid #d9534f' : '1px solid #ccc', borderRadius: '4px' }}>
                         
                         {!isFrozen ? (
                             <>
                                 <button onClick={() => setActiveTool('ORBIT')} style={getToolStyle('ORBIT')}>🖐️ ORBIT</button>
                                 <button onClick={() => setActiveTool('BOM')} style={getToolStyle('BOM')}>📍 BOM TAG</button>
                                 <button onClick={() => { setIsFrozen(true); setActiveTool('CALLOUT'); }} style={{ ...getToolStyle('FREEZE'), marginLeft: 'auto', background: '#007bff', color: '#fff', boxShadow: '2px 2px 0 #004085' }}>
                                     📸 FREEZE FOR MARKUP
                                 </button>
                             </>
                         ) : (
                             <>
                                 <button onClick={() => setActiveTool('CALLOUT')} style={getToolStyle('CALLOUT')}>💬 TEXT NOTE</button>
                                 <button onClick={() => setActiveTool('DRAW')} style={getToolStyle('DRAW')}>🖍️ FINELINER</button>
                                 <button onClick={handleUnfreeze} style={{ ...getToolStyle('UNFREEZE'), marginLeft: 'auto', background: '#d9534f', color: '#fff', boxShadow: '2px 2px 0 #851c19' }}>
                                     🔓 UNFREEZE VIEW
                                 </button>
                                 {activeTool === 'DRAW' && (
                                     <button onClick={() => clearDrawings()} style={{ background: '#888', color: '#fff', border: 'none', padding: '8px 12px', fontWeight: 'bold', borderRadius: '4px', cursor: 'pointer', fontSize: '0.7rem' }}>🧹 CLEAR LINES</button>
                                 )}
                             </>
                         )}
                     </div>

                     <div style={{ display: 'flex', gap: '15px', alignItems: 'center', justifyContent: 'space-between' }}>
                         <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                             <label style={{ fontSize: '0.8rem', fontWeight: 'bold', color: isFrozen ? '#aaa' : '#000' }}>EXPLODE BEHAVIOR:</label>
                             <div style={{ display: 'flex', border: isFrozen ? '2px solid #aaa' : '2px solid #000', borderRadius: '4px', overflow: 'hidden' }}>
                                 <button disabled={isFrozen} onClick={() => setExplodeMode('INDIVIDUAL')} style={{ padding: '8px 12px', background: explodeMode === 'INDIVIDUAL' ? (isFrozen ? '#aaa' : '#000') : '#fff', color: explodeMode === 'INDIVIDUAL' ? '#fff' : (isFrozen ? '#aaa' : '#000'), border: 'none', cursor: isFrozen ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '0.7rem' }}>INDIVIDUAL PARTS</button>
                                 <button disabled={isFrozen} onClick={() => setExplodeMode('GROUPED')} style={{ padding: '8px 12px', background: explodeMode === 'GROUPED' ? (isFrozen ? '#aaa' : '#000') : '#fff', color: explodeMode === 'GROUPED' ? '#fff' : (isFrozen ? '#aaa' : '#000'), border: 'none', cursor: isFrozen ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '0.7rem' }}>SUB-ASSEMBLIES</button>
                             </div>
                         </div>
                         <div style={{ display: 'flex', gap: '5px' }}>
                             <button disabled={isFrozen} onClick={() => triggerZoom('IN')} style={{ padding: '8px 15px', background: isFrozen ? '#aaa' : '#007bff', color: '#fff', border: '2px solid #000', fontWeight: 'bold', cursor: isFrozen ? 'not-allowed' : 'pointer' }}>🔍 +</button>
                             <button disabled={isFrozen} onClick={() => triggerZoom('OUT')} style={{ padding: '8px 15px', background: isFrozen ? '#aaa' : '#007bff', color: '#fff', border: '2px solid #000', fontWeight: 'bold', cursor: isFrozen ? 'not-allowed' : 'pointer' }}>🔍 -</button>
                         </div>
                     </div>

                     <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                        <label style={{ fontSize: '0.8rem', fontWeight: 'bold', color: isFrozen ? '#aaa' : '#000' }}>SLIDER:</label>
                        <input type="range" min="0" max="100" value={explodeFactor} onChange={(e) => setExplodeFactor(e.target.value)} disabled={!activeAssembly.manufacturingSpecs?.cadUrl || meshCount <= 1 || isFrozen} style={{ flex: 1, cursor: isFrozen ? 'not-allowed' : 'pointer' }} />
                     </div>
                 </div>
                 
                 <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                    {!activeAssembly.manufacturingSpecs?.cadUrl ? (
                        <div style={{ color: '#666', padding: '40px', textAlign: 'center', fontSize: '0.9rem', fontWeight: 'bold', marginTop: '100px' }}>A 3D CAD model (.glb) is required. Upload one in Tab 3.</div>
                    ) : (
                        <>
                            {/* 🚀 SVG FINELINER OVERLAY */}
                            <svg
                                ref={svgRef}
                                viewBox="0 0 1000 1000"
                                preserveAspectRatio="none"
                                style={{ position: 'absolute', inset: 0, zIndex: activeTool === 'DRAW' ? 10 : 1, pointerEvents: activeTool === 'DRAW' ? 'auto' : 'none', cursor: 'crosshair', width: '100%', height: '100%' }}
                                onPointerDown={startDraw}
                                onPointerMove={draw}
                                onPointerUp={endDraw}
                                onPointerLeave={endDraw}
                            >
                                {activeDrawings.map(line => (
                                    <polyline key={line.id} points={line.points.map(p => `${p.x},${p.y}`).join(' ')} stroke="#d9534f" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                                ))}
                                {currentLine && currentLine.points && (
                                    <polyline points={currentLine.points.map(p => `${p.x},${p.y}`).join(' ')} stroke="#d9534f" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                                )}
                            </svg>

                            <Canvas camera={{ position: [5, 5, 5], fov: 50 }}>
                                <ambientLight intensity={0.5} />
                                <directionalLight position={[10, 10, 5]} intensity={1} />
                                
                                {/* 🚀 FIX: Auto-disables Orbit Controls when Frozen */}
                                <OrbitControls makeDefault enabled={!isFrozen && activeTool !== 'DRAW'} />
                                <CameraController zoomTrigger={zoomTrigger} />
                                
                                {/* 🚀 FIX: Removed the 'observe' tag so bounds doesn't auto-snap when tools change */}
                                <Bounds fit clip margin={1.2}>
                                    <ExplodableModel 
                                        url={activeAssembly.manufacturingSpecs.cadUrl} 
                                        explodeFactor={explodeFactor} 
                                        explodeMode={explodeMode}
                                        nodeClusters={nodeClusters}
                                        onMeshClick={handleMeshClick} 
                                        onMeshCount={setMeshCount}
                                        activeTool={activeTool}
                                        isFrozen={isFrozen}
                                    />
                                </Bounds>

                                {/* RENDER BOM TAGS */}
                                {activeTags.map(tag => {
                                    const isActive = activeTagId === tag.id;
                                    return (
                                        <Html key={tag.id} position={[tag.x, tag.y, tag.z]} zIndexRange={[100, 0]}>
                                            <div onClick={(e) => { e.stopPropagation(); setActiveTagId(tag.id); }} style={{ width: '30px', height: '30px', background: isActive ? '#007bff' : '#fff', color: isActive ? '#fff' : '#000', border: '3px solid #000', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', cursor: 'pointer', transform: 'translate(-50%, -50%)', boxShadow: '2px 2px 5px rgba(0,0,0,0.3)' }}>{tag.number}</div>
                                            {isActive && (
                                                <div style={{ position: 'absolute', top: '15px', left: '15px', width: '200px', background: '#fff', border: '2px solid #000', padding: '10px', boxShadow: '4px 4px 0 rgba(0,0,0,0.2)' }}>
                                                    <label style={{ fontSize: '0.65rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>ASSIGN BOM COMPONENT:</label>
                                                    <select value={tag.linkedPinId || ''} onChange={(e) => updateTagAssignment(tag.id, e.target.value)} style={{ width: '100%', padding: '5px', fontSize: '0.75rem', border: '1px solid #ccc', marginBottom: '10px' }}>
                                                        <option value="">-- SELECT PART --</option>
                                                        {bomParts.map(p => ( <option key={p.id} value={p.id}>{p.partName}</option> ))}
                                                    </select>
                                                    <button onClick={() => removeTag(tag.id)} style={{ width: '100%', padding: '5px', background: '#d9534f', color: '#fff', border: 'none', fontSize: '0.65rem', fontWeight: 'bold', cursor: 'pointer' }}>REMOVE TAG</button>
                                                </div>
                                            )}
                                        </Html>
                                    )
                                })}

                                {/* 🚀 BRAND NEW: RENDER ARCHITECTURAL TEXT CALLOUTS */}
                                {activeCallouts.map(c => (
                                    <Html key={c.id} position={[c.x, c.y, c.z]} zIndexRange={[100, 0]}>
                                        <div style={{ position: 'relative' }}>
                                            <div style={{ width: '8px', height: '8px', background: '#d9534f', borderRadius: '50%', transform: 'translate(-50%, -50%)' }}></div>
                                            
                                            <div style={{ position: 'absolute', top: '-40px', left: '30px', width: '220px', background: 'rgba(255, 255, 255, 0.95)', border: '2px solid #000', padding: '8px', boxShadow: '4px 4px 0 rgba(0,0,0,0.1)' }}>
                                                <div style={{ position: 'absolute', top: '40px', left: '-30px', width: '30px', height: '2px', background: '#000' }}></div>
                                                
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px', borderBottom: '1px solid #ccc', paddingBottom: '3px' }}>
                                                    <span style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#d9534f' }}>CALLOUT NOTE</span>
                                                    <button onClick={(e) => { e.stopPropagation(); removeCallout(c.id); }} style={{ background: 'none', border: 'none', color: '#000', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold' }}>✖</button>
                                                </div>
                                                
                                                <textarea 
                                                    value={c.text} 
                                                    onChange={(e) => updateCalloutText(c.id, e.target.value)} 
                                                    onPointerDown={(e) => e.stopPropagation()} 
                                                    style={{ width: '100%', minHeight: '60px', border: 'none', background: 'transparent', outline: 'none', fontFamily: 'monospace', fontSize: '0.8rem', resize: 'vertical' }}
                                                />
                                            </div>
                                        </div>
                                    </Html>
                                ))}
                            </Canvas>
                        </>
                    )}
                 </div>
              </div>

              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '15px' }}>
                 
                 <div style={{ display: 'flex', gap: '10px', background: '#e9ecef', padding: '10px', border: '2px solid #000' }}>
                     <button onClick={() => setRightPanelTab('PAGES')} style={{ padding: '8px 15px', background: rightPanelTab === 'PAGES' ? '#000' : 'transparent', color: rightPanelTab === 'PAGES' ? '#fff' : '#000', fontWeight: 'bold', border: 'none', cursor: 'pointer', fontSize: '0.8rem' }}>📑 INSTRUCTION PAGES</button>
                     <button onClick={() => setRightPanelTab('SOPS')} style={{ padding: '8px 15px', background: rightPanelTab === 'SOPS' ? '#000' : 'transparent', color: rightPanelTab === 'SOPS' ? '#fff' : '#000', fontWeight: 'bold', border: 'none', cursor: 'pointer', fontSize: '0.8rem' }}>🏭 SHOP FLOOR SOPs</button>
                 </div>

                 {rightPanelTab === 'PAGES' && (
                     <>
                        <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 rgba(0,0,0,0.1)' }}>
                            <div style={{ padding: '12px 15px', background: '#28a745', color: '#fff', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000' }}>
                                <span>PAGES & VIEWS</span>
                                <button onClick={() => handleCreateStep(activeAssembly)} style={{ background: '#fff', color: '#28a745', border: 'none', padding: '4px 8px', fontSize: '0.7rem', fontWeight: 'bold', cursor: 'pointer' }}>+ NEW PAGE</button>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '200px', overflowY: 'auto' }}>
                                {(activeAssembly.instructionSteps || []).map((step, idx) => (
                                    <div key={step.id} onClick={() => { setActiveStepId(step.id); setIsFrozen(false); setActiveTool('ORBIT'); }} style={{ display: 'flex', alignItems: 'center', padding: '10px 15px', background: activeStepId === step.id ? '#eafaf1' : '#fff', borderBottom: '1px solid #ccc', cursor: 'pointer', borderLeft: activeStepId === step.id ? '6px solid #28a745' : '6px solid transparent' }}>
                                        <div style={{ fontWeight: 'bold', color: '#333', marginRight: '10px' }}>{idx + 1}.</div>
                                        <input value={step.title} onChange={(e) => updateStepTitle(step.id, e.target.value)} onClick={e => e.stopPropagation()} style={{ flex: 1, padding: '5px', border: activeStepId === step.id ? '1px solid #28a745' : '1px solid transparent', background: 'transparent', fontWeight: 'bold', color: activeStepId === step.id ? '#1e7e34' : '#666', outline: 'none' }} />
                                        <span style={{ fontSize: '0.7rem', color: '#007bff', fontWeight: 'bold', margin: '0 10px' }}>{step.tags?.length || 0} Pins</span>
                                        <button onClick={(e) => { e.stopPropagation(); handleDeleteStep(step.id); }} style={{ background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', fontSize: '1rem' }}>🗑️</button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div style={{ flex: 1, background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 rgba(0,0,0,0.1)' }}>
                            <div style={{ padding: '15px', background: '#000', color: '#fff', fontWeight: 'bold', fontSize: '1rem', borderBottom: '2px solid #000' }}>
                                PARTS FOR: {activeStepObj?.title?.toUpperCase() || 'CURRENT PAGE'}
                            </div>
                            <div style={{ padding: '15px', flex: 1, overflowY: 'auto', background: '#f8f9fa' }}>
                                {activeTags.length === 0 ? (
                                    <div style={{ color: '#999', fontStyle: 'italic', fontSize: '0.8rem', textAlign: 'center', marginTop: '20px' }}>Click directly on the 3D model to attach parts to this page.</div>
                                ) : (
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                                        <thead>
                                            <tr style={{ background: '#eee', borderBottom: '2px solid #000' }}>
                                                <th style={{ padding: '10px', textAlign: 'center', width: '40px' }}>ITEM</th>
                                                <th style={{ padding: '10px', textAlign: 'center', width: '40px' }}>QTY</th>
                                                <th style={{ padding: '10px', textAlign: 'left' }}>DESCRIPTION</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {activeTags.sort((a,b) => a.number - b.number).map(tag => {
                                                const bomPart = bomParts.find(p => p.id === tag.linkedPinId);
                                                return (
                                                    <tr key={tag.id} onClick={() => setActiveTagId(tag.id)} style={{ borderBottom: '1px solid #ccc', background: activeTagId === tag.id ? '#e6f2ff' : '#fff', cursor: 'pointer' }}>
                                                        <td style={{ padding: '10px', textAlign: 'center', fontWeight: 'bold' }}>{tag.number}</td>
                                                        <td style={{ padding: '10px', textAlign: 'center' }}>{bomPart ? (bomPart.defaultQty || 1) : '-'}</td>
                                                        <td style={{ padding: '10px', fontWeight: bomPart ? 'bold' : 'normal', color: bomPart ? '#000' : '#d9534f' }}>
                                                            {bomPart ? bomPart.partName : "UNASSIGNED PART"}
                                                            {bomPart && bomPart.legacyErpId !== "PENDING" && <div style={{ fontSize: '0.65rem', color: '#007bff', marginTop: '2px' }}>{bomPart.legacyErpId}</div>}
                                                        </td>
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                     </>
                 )}

                 {rightPanelTab === 'SOPS' && (
                     <div style={{ flex: 1, background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 #0056b3' }}>
                         <div style={{ padding: '15px', background: '#0056b3', color: '#fff', fontWeight: 'bold', fontSize: '1rem', borderBottom: '2px solid #000' }}>
                             FACTORY FLOOR ROUTING & SOPs
                         </div>
                         <div style={{ padding: '20px', flex: 1, overflowY: 'auto', background: '#f8f9fa' }}>
                             {!activeAssembly.manufacturingSpecs?.shopRoutings || activeAssembly.manufacturingSpecs.shopRoutings.length === 0 ? (
                                 <div style={{ color: '#d9534f', textAlign: 'center', fontWeight: 'bold', marginTop: '20px', border: '2px dashed #d9534f', padding: '20px', borderRadius: '8px' }}>
                                     No Factory Floor Programs are linked to this Master Assembly.<br/><br/>
                                     <span style={{ fontSize: '0.8rem', color: '#666' }}>A Shop Floor Engineer must build the routing on their tablet and sync it to the HQ Master Library.</span>
                                 </div>
                             ) : (
                                 <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                     {activeAssembly.manufacturingSpecs.shopRoutings.map((op, idx) => (
                                         <div key={idx} style={{ background: '#fff', border: '1px solid #ccc', borderLeft: '6px solid #0056b3', borderRadius: '4px', padding: '15px', boxShadow: '0 2px 5px rgba(0,0,0,0.05)' }}>
                                             <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                                                 <span style={{ fontWeight: 'bold', fontSize: '1.1rem', color: '#0056b3' }}>OP {idx + 1}: {op.machine}</span>
                                                 <span style={{ background: '#eef5ff', color: '#0056b3', padding: '2px 8px', fontSize: '0.8rem', fontWeight: 'bold', border: '1px solid #0056b3', borderRadius: '4px' }}>
                                                     {op.progName}
                                                 </span>
                                             </div>
                                             <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '10px' }}>
                                                 Setup Time: {op.setupTime}m | Run Time: {op.timePerPiece}m
                                             </div>
                                             <label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#333' }}>OPERATOR INSTRUCTIONS / SOP:</label>
                                             <textarea 
                                                value={sopEdits[op.progId] !== undefined ? sopEdits[op.progId] : op.steps}
                                                onChange={(e) => setSopEdits({...sopEdits, [op.progId]: e.target.value})}
                                                style={{ width: '100%', minHeight: '100px', padding: '10px', boxSizing: 'border-box', marginTop: '5px', border: '1px solid #ccc', borderRadius: '4px', fontFamily: 'monospace', fontSize: '0.85rem' }}
                                             />
                                         </div>
                                     ))}
                                     
                                     <button onClick={handleSyncSops} style={{ padding: '15px', background: '#28a745', color: '#fff', fontSize: '1.1rem', fontWeight: 'bold', border: '2px solid #1e7e34', cursor: 'pointer', boxShadow: '4px 4px 0 #1e7e34' }}>
                                         💾 SYNC SOPs TO SHOP FLOOR TABLETS
                                     </button>
                                 </div>
                             )}
                         </div>
                     </div>
                 )}

              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default InstructionsTab;