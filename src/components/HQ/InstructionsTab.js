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
                    if (child.isMesh && (cluster.meshes || []).includes(child.name)) {
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
  
  const [activeTool, setActiveTool] = useState('ORBIT'); 
  const [isFrozen, setIsFrozen] = useState(false); 
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

  const handleMeshClick = async (point3D) => {
      if (!activeAssembly || !activeStepId) return;
      
      const currentSteps = activeAssembly.instructionSteps || [];
      const activeStep = currentSteps.find(s => s.id === activeStepId);
      if (!activeStep) return;

      if (!isFrozen && activeTool === 'BOM') {
          const nextNumber = activeStep.tags?.length > 0 ? Math.max(...activeStep.tags.map(t => t.number)) + 1 : 1;
          const newTag = { id: Date.now().toString(), x: point3D.x, y: point3D.y, z: point3D.z, number: nextNumber, linkedPinId: null };
          const updatedSteps = currentSteps.map(s => s.id === activeStepId ? { ...s, tags: [...(s.tags||[]), newTag] } : s);
          setActiveAssembly(prev => ({ ...prev, instructionSteps: updatedSteps }));
          setActiveTagId(newTag.id);
          setActiveTool('ORBIT'); 
          try { await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { instructionSteps: updatedSteps }); } catch (err) {}
      } 
      else if (isFrozen && activeTool === 'CALLOUT') {
          const newCallout = { id: Date.now().toString(), x: point3D.x, y: point3D.y, z: point3D.z, text: "New Note..." };
          const updatedSteps = currentSteps.map(s => s.id === activeStepId ? { ...s, callouts: [...(s.callouts||[]), newCallout] } : s);
          setActiveAssembly(prev => ({ ...prev, instructionSteps: updatedSteps }));
          try { await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { instructionSteps: updatedSteps }); } catch (err) {}
      }
  };

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
      padding: '8px 16px',
      background: activeTool === toolName ? 'var(--ink)' : 'transparent',
      color: activeTool === toolName ? '#fff' : 'var(--ink)',
      border: activeTool === toolName ? '1px solid var(--ink)' : '1px solid var(--line)',
      cursor: 'pointer',
      fontFamily: 'var(--mono)',
      fontSize: '10px',
      textTransform: 'uppercase',
      letterSpacing: '.1em',
      borderRadius: '2px',
      transition: 'all 0.2s'
  });

  const activeStepObj = (activeAssembly?.instructionSteps || []).find(s => s.id === activeStepId);
  const activeTags = activeStepObj?.tags || [];
  const activeCallouts = activeStepObj?.callouts || [];
  const activeDrawings = activeStepObj?.drawings || [];
  const nodeClusters = activeAssembly?.nodeClusters || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '30px', fontFamily: 'var(--sans)', backgroundColor: 'transparent', minHeight: '100vh' }}>
      
      <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: '4px' }}>Exploded View & BOM Mapping Studio</span>
          <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>Interactive 3D Instructions</h2>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
        
        <div style={{ width: activeAssembly ? '320px' : '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {masterAssemblies.length === 0 && (
              <div style={{ background: 'var(--paper)', padding: '40px', border: '1px dashed var(--line)', textAlign: 'center', color: 'var(--ink-soft)', fontFamily: 'var(--serif)', fontSize: '1.2rem', fontStyle: 'italic' }}>
                  No Master Assemblies found. Classify an assembly as "CPQ Enabled" or "MASTER" in Tab 4/Tab 2 to begin.
              </div>
          )}
          {masterAssemblies.map(asm => {
             const hasCAD = !!asm.manufacturingSpecs?.cadUrl;
             return (
              <div key={asm.id} onClick={() => { setActiveAssembly(asm); setExplodeFactor(0); setMeshCount(0); setIsFrozen(false); setActiveTool('ORBIT'); }} style={{ background: activeAssembly?.id === asm.id ? 'var(--paper-2)' : '#fff', border: activeAssembly?.id === asm.id ? '1px solid var(--brass)' : '1px solid var(--line)', cursor: 'pointer', display: 'flex', flexDirection: 'column', transition: 'all 0.2s', boxShadow: activeAssembly?.id === asm.id ? '0 4px 12px rgba(0,0,0,0.05)' : 'none' }}>
                <div style={{ padding: '6px 12px', background: hasCAD ? 'var(--paper)' : 'var(--paper-2)', color: 'var(--ink-soft)', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', textAlign: 'center', borderBottom: '1px solid var(--line)' }}>
                    <span>{hasCAD ? '3D CAD Available' : 'No CAD Uploaded'}</span>
                </div>
                <div style={{ padding: '16px' }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink)' }}>{asm.legacyErpId !== "PENDING" && asm.legacyErpId !== "N/A" ? asm.legacyErpId : asm.itemId}</div>
                  <div style={{ fontFamily: 'var(--sans)', fontSize: '1rem', fontWeight: 500, color: 'var(--ink)', marginTop: '8px' }}>{asm.itemName}</div>
                </div>
              </div>
             )
          })}
        </div>

        {activeAssembly && (
          <div style={{ flex: 1, background: '#fff', border: '1px solid var(--line)', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', borderRadius: '2px', overflow: 'hidden' }}>
            
            <div style={{ padding: '24px 30px', background: 'var(--paper-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
              <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>{activeAssembly.itemName} - Builder</h3>
              <button onClick={() => setActiveAssembly(null)} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', fontSize: '1.5rem', cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ padding: '30px', display: 'flex', gap: '30px', flex: 1 }}>
              
              <div style={{ border: isFrozen ? '2px solid var(--brass)' : '1px solid var(--line)', background: 'var(--paper)', display: 'flex', flexDirection: 'column', flex: 1.5, minHeight: '600px', position: 'relative', transition: 'all 0.2s', borderRadius: '2px' }}>
                 
                 <div style={{ padding: '20px', background: '#fff', borderBottom: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: '20px', zIndex: 100 }}>
                     
                     {/* TOOLBAR */}
                     <div style={{ display: 'flex', gap: '12px', background: isFrozen ? 'var(--paper-2)' : '#fff', padding: '16px', border: '1px solid var(--line)', borderRadius: '2px' }}>
                         {!isFrozen ? (
                             <>
                                 <button onClick={() => setActiveTool('ORBIT')} style={getToolStyle('ORBIT')}>Orbit</button>
                                 <button onClick={() => setActiveTool('BOM')} style={getToolStyle('BOM')}>BOM Tag</button>
                                 <button onClick={() => { setIsFrozen(true); setActiveTool('CALLOUT'); }} style={{ ...getToolStyle('FREEZE'), marginLeft: 'auto', background: 'var(--ink)', color: '#fff', border: 'none' }}>
                                     Freeze for Markup
                                 </button>
                             </>
                         ) : (
                             <>
                                 <button onClick={() => setActiveTool('CALLOUT')} style={getToolStyle('CALLOUT')}>Text Note</button>
                                 <button onClick={() => setActiveTool('DRAW')} style={getToolStyle('DRAW')}>Fineliner</button>
                                 <button onClick={handleUnfreeze} style={{ ...getToolStyle('UNFREEZE'), marginLeft: 'auto', background: 'transparent', color: 'var(--ink)', border: '1px solid var(--ink)' }}>
                                     Unfreeze View
                                 </button>
                                 {activeTool === 'DRAW' && (
                                     <button onClick={() => clearDrawings()} style={{ background: 'transparent', color: '#d9534f', border: '1px solid #d9534f', padding: '8px 16px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', cursor: 'pointer' }}>Clear Lines</button>
                                 )}
                             </>
                         )}
                     </div>

                     <div style={{ display: 'flex', gap: '20px', alignItems: 'center', justifyContent: 'space-between' }}>
                         <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                             <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: isFrozen ? 'var(--ink-soft)' : 'var(--ink)' }}>Explode Behavior:</label>
                             <div style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: '2px', overflow: 'hidden', background: '#fff' }}>
                                 <button disabled={isFrozen} onClick={() => setExplodeMode('INDIVIDUAL')} style={{ padding: '8px 16px', background: explodeMode === 'INDIVIDUAL' ? (isFrozen ? 'var(--paper)' : 'var(--ink)') : 'transparent', color: explodeMode === 'INDIVIDUAL' ? '#fff' : (isFrozen ? 'var(--ink-soft)' : 'var(--ink)'), border: 'none', cursor: isFrozen ? 'not-allowed' : 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase' }}>Individual Parts</button>
                                 <button disabled={isFrozen} onClick={() => setExplodeMode('GROUPED')} style={{ padding: '8px 16px', background: explodeMode === 'GROUPED' ? (isFrozen ? 'var(--paper)' : 'var(--ink)') : 'transparent', color: explodeMode === 'GROUPED' ? '#fff' : (isFrozen ? 'var(--ink-soft)' : 'var(--ink)'), border: 'none', cursor: isFrozen ? 'not-allowed' : 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase' }}>Sub-Assemblies</button>
                             </div>
                         </div>
                         <div style={{ display: 'flex', gap: '8px' }}>
                             <button disabled={isFrozen} onClick={() => triggerZoom('IN')} style={{ padding: '8px 16px', background: isFrozen ? 'var(--paper-2)' : 'var(--ink)', color: isFrozen ? 'var(--ink-soft)' : '#fff', border: 'none', cursor: isFrozen ? 'not-allowed' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px' }}>Zoom +</button>
                             <button disabled={isFrozen} onClick={() => triggerZoom('OUT')} style={{ padding: '8px 16px', background: isFrozen ? 'var(--paper-2)' : 'var(--ink)', color: isFrozen ? 'var(--ink-soft)' : '#fff', border: 'none', cursor: isFrozen ? 'not-allowed' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px' }}>Zoom -</button>
                         </div>
                     </div>

                     <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: isFrozen ? 'var(--ink-soft)' : 'var(--ink)' }}>Explode Amount:</label>
                        <input type="range" min="0" max="100" value={explodeFactor} onChange={(e) => setExplodeFactor(e.target.value)} disabled={!activeAssembly.manufacturingSpecs?.cadUrl || meshCount <= 1 || isFrozen} style={{ flex: 1, cursor: isFrozen ? 'not-allowed' : 'pointer' }} />
                     </div>
                 </div>
                 
                 <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                    {!activeAssembly.manufacturingSpecs?.cadUrl ? (
                        <div style={{ color: 'var(--ink-soft)', fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: '1.2rem', padding: '60px', textAlign: 'center' }}>A 3D CAD model (.glb) is required. Upload one in Tab 3.</div>
                    ) : (
                        <>
                            {/* SVG FINELINER OVERLAY */}
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
                                    <polyline key={line.id} points={line.points.map(p => `${p.x},${p.y}`).join(' ')} stroke="var(--brass)" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                                ))}
                                {currentLine && currentLine.points && (
                                    <polyline points={currentLine.points.map(p => `${p.x},${p.y}`).join(' ')} stroke="var(--brass)" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                                )}
                            </svg>

                            <Canvas camera={{ position: [5, 5, 5], fov: 50 }}>
                                <ambientLight intensity={0.5} />
                                <directionalLight position={[10, 10, 5]} intensity={1} />
                                
                                <OrbitControls makeDefault enabled={!isFrozen && activeTool !== 'DRAW'} />
                                <CameraController zoomTrigger={zoomTrigger} />
                                
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
                                            <div onClick={(e) => { e.stopPropagation(); setActiveTagId(tag.id); }} style={{ width: '24px', height: '24px', background: isActive ? 'var(--ink)' : '#fff', color: isActive ? '#fff' : 'var(--ink)', border: '1px solid var(--ink)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: '10px', cursor: 'pointer', transform: 'translate(-50%, -50%)', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>{tag.number}</div>
                                            {isActive && (
                                                <div style={{ position: 'absolute', top: '15px', left: '15px', width: '220px', background: '#fff', border: '1px solid var(--line)', padding: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                                                    <label style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Assign BOM Component</label>
                                                    <select value={tag.linkedPinId || ''} onChange={(e) => updateTagAssignment(tag.id, e.target.value)} style={{ width: '100%', padding: '8px', fontSize: '0.85rem', fontFamily: 'var(--sans)', border: '1px solid var(--line)', marginBottom: '12px', outline: 'none' }}>
                                                        <option value="">-- SELECT PART --</option>
                                                        {bomParts.map(p => ( <option key={p.id} value={p.id}>{p.partName}</option> ))}
                                                    </select>
                                                    <button onClick={() => removeTag(tag.id)} style={{ width: '100%', padding: '8px', background: 'transparent', color: '#d9534f', border: '1px solid #d9534f', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', cursor: 'pointer' }}>Remove Tag</button>
                                                </div>
                                            )}
                                        </Html>
                                    )
                                })}

                                {/* RENDER TEXT CALLOUTS */}
                                {activeCallouts.map(c => (
                                    <Html key={c.id} position={[c.x, c.y, c.z]} zIndexRange={[100, 0]}>
                                        <div style={{ position: 'relative' }}>
                                            <div style={{ width: '8px', height: '8px', background: 'var(--brass)', borderRadius: '50%', transform: 'translate(-50%, -50%)' }}></div>
                                            
                                            <div style={{ position: 'absolute', top: '-40px', left: '30px', width: '220px', background: 'rgba(255, 255, 255, 0.95)', border: '1px solid var(--line)', padding: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                                                <div style={{ position: 'absolute', top: '40px', left: '-30px', width: '30px', height: '1px', background: 'var(--line)' }}></div>
                                                
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', borderBottom: '1px solid var(--line)', paddingBottom: '6px' }}>
                                                    <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Note</span>
                                                    <button onClick={(e) => { e.stopPropagation(); removeCallout(c.id); }} style={{ background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', fontSize: '1rem', padding: 0 }}>×</button>
                                                </div>
                                                
                                                <textarea 
                                                    value={c.text} 
                                                    onChange={(e) => updateCalloutText(c.id, e.target.value)} 
                                                    onPointerDown={(e) => e.stopPropagation()} 
                                                    style={{ width: '100%', minHeight: '60px', border: 'none', background: 'transparent', outline: 'none', fontFamily: 'var(--sans)', fontSize: '0.85rem', resize: 'vertical', color: 'var(--ink)' }}
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

              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
                 
                 <div style={{ display: 'flex', gap: '12px', background: 'var(--paper)', padding: '16px', border: '1px solid var(--line)' }}>
                     <button onClick={() => setRightPanelTab('PAGES')} style={{ padding: '10px 20px', background: rightPanelTab === 'PAGES' ? 'var(--ink)' : 'transparent', color: rightPanelTab === 'PAGES' ? '#fff' : 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', border: rightPanelTab === 'PAGES' ? 'none' : '1px solid var(--line)', cursor: 'pointer', transition: 'all 0.2s' }}>Instruction Pages</button>
                     <button onClick={() => setRightPanelTab('SOPS')} style={{ padding: '10px 20px', background: rightPanelTab === 'SOPS' ? 'var(--ink)' : 'transparent', color: rightPanelTab === 'SOPS' ? '#fff' : 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', border: rightPanelTab === 'SOPS' ? 'none' : '1px solid var(--line)', cursor: 'pointer', transition: 'all 0.2s' }}>Shop Floor SOPs</button>
                 </div>

                 {rightPanelTab === 'PAGES' && (
                     <>
                        <div style={{ background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                            <div style={{ padding: '16px 20px', background: 'var(--paper-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
                                <span style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)' }}>Pages & Views</span>
                                <button onClick={() => handleCreateStep(activeAssembly)} style={{ background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', padding: '6px 12px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>+ New Page</button>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '250px', overflowY: 'auto' }}>
                                {(activeAssembly.instructionSteps || []).map((step, idx) => (
                                    <div key={step.id} onClick={() => { setActiveStepId(step.id); setIsFrozen(false); setActiveTool('ORBIT'); }} style={{ display: 'flex', alignItems: 'center', padding: '12px 20px', background: activeStepId === step.id ? 'var(--paper-2)' : '#fff', borderBottom: '1px solid var(--line)', cursor: 'pointer', borderLeft: activeStepId === step.id ? '4px solid var(--brass)' : '4px solid transparent' }}>
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', marginRight: '12px' }}>{idx + 1}.</div>
                                        <input value={step.title} onChange={(e) => updateStepTitle(step.id, e.target.value)} onClick={e => e.stopPropagation()} style={{ flex: 1, padding: '8px', border: activeStepId === step.id ? '1px solid var(--line)' : '1px solid transparent', background: activeStepId === step.id ? '#fff' : 'transparent', fontFamily: 'var(--sans)', fontSize: '0.95rem', color: 'var(--ink)', outline: 'none' }} />
                                        <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', textTransform: 'uppercase', margin: '0 16px' }}>{step.tags?.length || 0} Pins</span>
                                        <button onClick={(e) => { e.stopPropagation(); handleDeleteStep(step.id); }} style={{ background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', fontSize: '1.1rem' }}>×</button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div style={{ flex: 1, background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                            <div style={{ padding: '16px 20px', background: 'var(--paper-2)', color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', borderBottom: '1px solid var(--line)' }}>
                                Parts for: {activeStepObj?.title || 'Current Page'}
                            </div>
                            <div style={{ padding: '20px', flex: 1, overflowY: 'auto' }}>
                                {activeTags.length === 0 ? (
                                    <div style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)', fontSize: '1.1rem', textAlign: 'center', marginTop: '30px' }}>Click directly on the 3D model to attach parts to this page.</div>
                                ) : (
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--sans)', fontSize: '0.9rem' }}>
                                        <thead>
                                            <tr style={{ background: 'var(--paper)', borderBottom: '1px solid var(--line)' }}>
                                                <th style={{ padding: '12px', textAlign: 'center', width: '60px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Item</th>
                                                <th style={{ padding: '12px', textAlign: 'center', width: '60px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Qty</th>
                                                <th style={{ padding: '12px', textAlign: 'left', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Description</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {activeTags.sort((a,b) => a.number - b.number).map(tag => {
                                                const bomPart = bomParts.find(p => p.id === tag.linkedPinId);
                                                return (
                                                    <tr key={tag.id} onClick={() => setActiveTagId(tag.id)} style={{ borderBottom: '1px solid var(--line)', background: activeTagId === tag.id ? 'var(--paper-2)' : '#fff', cursor: 'pointer' }}>
                                                        <td style={{ padding: '12px', textAlign: 'center', fontFamily: 'var(--mono)' }}>{tag.number}</td>
                                                        <td style={{ padding: '12px', textAlign: 'center' }}>{bomPart ? (bomPart.defaultQty || 1) : '-'}</td>
                                                        <td style={{ padding: '12px', color: bomPart ? 'var(--ink)' : '#d9534f' }}>
                                                            <div style={{ fontWeight: bomPart ? 500 : 400 }}>{bomPart ? bomPart.partName : "Unassigned Part"}</div>
                                                            {bomPart && bomPart.legacyErpId !== "PENDING" && <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', marginTop: '4px' }}>{bomPart.legacyErpId}</div>}
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
                     <div style={{ flex: 1, background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                         <div style={{ padding: '16px 20px', background: 'var(--paper-2)', color: 'var(--ink)', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, borderBottom: '1px solid var(--line)' }}>
                             Factory Floor Routing & SOPs
                         </div>
                         <div style={{ padding: '30px', flex: 1, overflowY: 'auto' }}>
                             {!activeAssembly.manufacturingSpecs?.shopRoutings || activeAssembly.manufacturingSpecs.shopRoutings.length === 0 ? (
                                 <div style={{ color: 'var(--ink-soft)', textAlign: 'center', marginTop: '40px', border: '1px dashed var(--line)', padding: '40px', background: 'var(--paper)' }}>
                                     <div style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', marginBottom: '10px' }}>No Factory Floor Programs are linked to this Master Assembly.</div>
                                     <div style={{ fontFamily: 'var(--sans)', fontSize: '0.95rem' }}>A Shop Floor Engineer must build the routing on their tablet and sync it to the HQ Master Library.</div>
                                 </div>
                             ) : (
                                 <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                                     {activeAssembly.manufacturingSpecs.shopRoutings.map((op, idx) => (
                                         <div key={idx} style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px' }}>
                                             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--line)', paddingBottom: '12px' }}>
                                                 <span style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)' }}>OP {idx + 1}: {op.machine}</span>
                                                 <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', background: 'var(--paper-2)', border: '1px solid var(--line)', color: 'var(--ink)', padding: '6px 12px' }}>
                                                     {op.progName}
                                                 </span>
                                             </div>
                                             <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '16px' }}>
                                                 Setup Time: {op.setupTime}m | Run Time: {op.timePerPiece}m
                                             </div>
                                             <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Operator Instructions / SOP</label>
                                             <textarea 
                                                value={sopEdits[op.progId] !== undefined ? sopEdits[op.progId] : op.steps}
                                                onChange={(e) => setSopEdits({...sopEdits, [op.progId]: e.target.value})}
                                                style={{ width: '100%', minHeight: '120px', padding: '16px', boxSizing: 'border-box', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none', resize: 'vertical' }}
                                             />
                                         </div>
                                     ))}
                                     
                                     <button onClick={handleSyncSops} style={{ padding: '16px', background: 'var(--ink)', color: '#fff', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', border: 'none', cursor: 'pointer', transition: 'background 0.2s' }}>
                                         Sync SOPs to Shop Floor Tablets
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