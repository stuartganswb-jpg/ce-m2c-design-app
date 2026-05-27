import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, doc, setDoc, serverTimestamp, query, where } from "firebase/firestore";
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { useGLTF, OrbitControls, Bounds } from '@react-three/drei';

const globalTextureCache = {};

// 🚀 UPGRADED: Strict Target Matching & PBR Scalar Wiping
const DynamicModel = ({ url, textureOverrides, visibilityOverrides }) => {
    const { scene } = useGLTF(url);
    const clonedScene = useMemo(() => scene.clone(true), [scene]);
    
    const textureOverridesString = JSON.stringify(textureOverrides);
    const visibilityOverridesString = JSON.stringify(visibilityOverrides);

    useEffect(() => {
        // 1. Safely backup original materials AND visibility state ONCE
        clonedScene.traverse((child) => {
            if (child.isMesh && child.userData.originalMaterial === undefined) {
                child.userData.originalMaterial = child.material.clone();
                child.userData.originalVisible = child.visible;
            }
        });

        const texMap = {}; // Will hold the loaded texture objects

        // 2. The Unified Execution Engine
        const applyAllOverrides = () => {
            clonedScene.traverse((child) => {
                if (child.isMesh && child.userData.originalMaterial) {
                    const meshName = child.name.toLowerCase();

                    // --- A. VISIBILITY LOGIC (Geometry Swapping) ---
                    let isVis = child.userData.originalVisible;
                    if (visibilityOverrides && Object.keys(visibilityOverrides).length > 0) {
                        for (const [targetStr, isVisibleFlag] of Object.entries(visibilityOverrides)) {
                            // Split clusters, trim spaces, and ensure no empty strings
                            const targets = targetStr.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
                            // 🚀 EXACT MATCH OR R3F SUFFIX ONLY (No more .includes() overreach!)
                            if (targets.some(t => meshName === t || meshName.startsWith(t + '_'))) {
                                isVis = isVisibleFlag;
                            }
                        }
                    }
                    child.visible = isVis;

                    // --- B. TEXTURE LOGIC (Color Swapping) ---
                    let matchedTexUrl = null;
                    if (textureOverrides && Object.keys(textureOverrides).length > 0) {
                        for (const [targetStr, texUrl] of Object.entries(textureOverrides)) {
                            const targets = targetStr.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
                            if (targets.some(t => meshName === t || meshName.startsWith(t + '_'))) {
                                matchedTexUrl = texUrl;
                            }
                        }
                    }

                    if (matchedTexUrl && texMap[matchedTexUrl]) {
                        const newMat = child.userData.originalMaterial.clone();
                        
                        newMat.map = texMap[matchedTexUrl];
                        newMat.color = new THREE.Color(0xffffff); // Force pure white base
                        
                        // 🚀 CRITICAL PBR FIX: Explicitly kill CAD metallic scalars so Wood looks like Wood
                        newMat.metalness = 0.0; 
                        newMat.roughness = 0.8; 
                        
                        newMat.normalMap = null;
                        newMat.bumpMap = null;
                        newMat.roughnessMap = null;
                        newMat.metalnessMap = null;
                        newMat.clearcoatMap = null;
                        
                        newMat.needsUpdate = true;
                        child.material = newMat;
                    } else {
                        // Safely restore original CAD look for untouched parts
                        child.material = child.userData.originalMaterial;
                    }
                }
            });
        };

        // If no textures to load, just apply geometry swaps immediately
        if (!textureOverrides || Object.keys(textureOverrides).length === 0) {
            applyAllOverrides();
            return;
        }

        // 3. Smart Async Loader (Loads Unique URLs only once)
        const uniqueUrls = [...new Set(Object.values(textureOverrides))].filter(Boolean);
        let loadedCount = 0;

        if (uniqueUrls.length === 0) {
            applyAllOverrides();
            return;
        }

        uniqueUrls.forEach(url => {
            if (globalTextureCache[url]) {
                texMap[url] = globalTextureCache[url];
                loadedCount++;
                if (loadedCount === uniqueUrls.length) applyAllOverrides();
            } else {
                const loader = new THREE.TextureLoader();
                loader.setCrossOrigin('anonymous');
                loader.load(
                    url, 
                    (tex) => {
                        tex.wrapS = THREE.RepeatWrapping;
                        tex.wrapT = THREE.RepeatWrapping;
                        tex.colorSpace = THREE.SRGBColorSpace;
                        globalTextureCache[url] = tex; 
                        texMap[url] = tex;
                        loadedCount++;
                        if (loadedCount === uniqueUrls.length) applyAllOverrides();
                    },
                    undefined,
                    (err) => {
                        console.error("Failed to load texture:", url, err);
                        loadedCount++; // Fail gracefully so the rest of the model still loads
                        if (loadedCount === uniqueUrls.length) applyAllOverrides();
                    }
                );
            }
        });
    }, [clonedScene, textureOverridesString, visibilityOverridesString]);

    return <primitive object={clonedScene} />;
};

const CPQTab = ({ currentUser, activeBrand }) => {
  const [liveAssemblies, setLiveAssemblies] = useState([]);
  const [liveCustomers, setLiveCustomers] = useState([]); 
  const [previousDrafts, setPreviousDrafts] = useState([]); 
  const [cpqRules, setCpqRules] = useState([]);
  const [cpqFlows, setCpqFlows] = useState([]);
  
  const [libraryParts, setLibraryParts] = useState([]);
  const [globalLists, setGlobalLists] = useState({});
  const [globalFinishes, setGlobalFinishes] = useState([]);
  const [outsourceFinishes, setOutsourceFinishes] = useState([]);
  const [dynamicAssets, setDynamicAssets] = useState([]);

  const [productType, setProductType] = useState(''); 
  const [activeFlowId, setActiveFlowId] = useState("");
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [dynamicConfigParams, setDynamicConfigParams] = useState({});
  const [engineFlags, setEngineFlags] = useState({ disabledSteps: [], warnings: [] });
  
  const [pricing, setPricing] = useState({ base: 0, finalPrice: 0 });
  const [jobData, setJobData] = useState({ customerId: '', jobName: '', sidemark: '' });
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [showCloneModal, setShowCloneModal] = useState(false);

  const [activeAssemblyId, setActiveAssemblyId] = useState('');
  const [activeAssembly, setActiveAssembly] = useState(null);

  const [viewMode, setViewMode] = useState("2D");

  useEffect(() => {
      if (!activeBrand) return;
      
      const unsubFlows = onSnapshot(query(collection(db, "cpq_flows"), where("brandId", "==", activeBrand)), (snap) => setCpqFlows(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
      const unsubRules = onSnapshot(doc(db, "system", "cpq_rules"), (snap) => { if(snap.exists() && snap.data().rules) setCpqRules(snap.data().rules); });
      const unsubDrafts = onSnapshot(query(collection(db, "cpq_drafts"), where("brandId", "==", activeBrand)), (snap) => setPreviousDrafts(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
      
      const unsubParts = onSnapshot(query(collection(db, "Approved_Designs")), (snap) => {
          let docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          docs = docs.filter(d => d.brandId === activeBrand || (d.sharedBrands && d.sharedBrands.includes(activeBrand)));
          
          setLibraryParts(docs.filter(d => d.partClass === "Inventory"));
          setLiveAssemblies(docs.filter(d => d.partClass === "Assembly" || d.partClass === "Master Assembly"));
      });

      const unsubLists = onSnapshot(doc(db, "system", "master_lists"), (docSnap) => { if (docSnap.exists()) setGlobalLists(docSnap.data()); });
      const unsubFinishes = onSnapshot(doc(db, "system", "master_finishes"), (snap) => { if(snap.exists() && snap.data().finishes) setGlobalFinishes(snap.data().finishes); });
      const unsubOutsource = onSnapshot(collection(db, "hq_outsource_finishes"), (snap) => setOutsourceFinishes(snap.docs.map(d => ({id: d.id, ...d.data()}))));
      const unsubDynamic = onSnapshot(collection(db, "hq_dynamic_data"), (snap) => setDynamicAssets(snap.docs.map(d => ({id: d.id, ...d.data()}))));

      setLiveCustomers([
        { id: 'CUST-882', name: 'Smith Residence (Tier 1)' },
        { id: 'CUST-310', name: 'The Harrison Project (Wholesale)' },
        { id: 'CUST-105', name: 'Alvarez Villa (Trade)' }
      ]);

      return () => { unsubFlows(); unsubParts(); unsubLists(); unsubRules(); unsubDrafts(); unsubFinishes(); unsubOutsource(); unsubDynamic(); };
  }, [activeBrand]);

  const activeFlow = cpqFlows.find(f => f.id === activeFlowId);

  useEffect(() => {
      if (activeFlow && activeFlow.linkedAssemblyId) {
          setActiveAssemblyId(activeFlow.linkedAssemblyId);
      }
  }, [activeFlow]);

  useEffect(() => {
      if (activeAssemblyId) {
          const asm = liveAssemblies.find(a => a.id === activeAssemblyId);
          setActiveAssembly(asm || null);
          if (asm?.manufacturingSpecs?.cadUrl) {
              setViewMode("3D");
          } else {
              setViewMode("2D");
          }
      } else {
          setActiveAssembly(null);
          setViewMode("2D");
      }
  }, [activeAssemblyId, liveAssemblies]);

  const currentStep = activeFlow?.steps?.[currentStepIndex];
  const availableProductTypes = [...new Set(libraryParts.map(p => p.manufacturingSpecs?.productType).filter(Boolean))];

  const getOptionsForStep = (step) => {
      if (!step || !step.dataSource) return [];
      let options = [];

      if (step.dataSource === 'master_finishes') {
          const inHouse = globalFinishes.map(f => ({ id: f.id, itemName: f.name, finalImageUrl: f.textureUrl, code: f.code }));
          const outsource = outsourceFinishes.map(f => ({ id: f.id, itemName: f.name, finalImageUrl: f.textureUrl, multiplier: f.multiplier }));
          options = [...inHouse, ...outsource];
      } else {
          const customAssets = dynamicAssets.filter(a => a.windowId === step.dataSource);
          if (customAssets.length > 0) {
              options = customAssets.map(a => ({ id: a.id, itemName: a.name, finalImageUrl: a.textureUrl, code: a.code, multiplier: a.multiplier }));
          } else if (globalLists[step.dataSource]) {
              options = globalLists[step.dataSource].map(val => ({ id: val, itemName: val }));
          } else if (step.dataSource === 'master_fabrics') {
              options = libraryParts.filter(p => ['TEXTILE', 'FABRIC', 'RAW MATERIAL'].includes(p.manufacturingSpecs?.productType));
          } else if (step.dataSource === 'master_trims') {
              options = libraryParts.filter(p => ['TRIMMING', 'COMPONENT'].includes(p.manufacturingSpecs?.productType));
          }
      }

      if (step.allowedOptions && step.allowedOptions.length > 0) {
          return options.filter(opt => step.allowedOptions.includes(opt.id));
      }

      return options;
  };

  const handleResumeDraft = (draftId) => {
      const draft = previousDrafts.find(d => d.id === draftId);
      if (!draft) return;

      let targetFlow = null;
      if (draft.category === 'PILLOW') targetFlow = cpqFlows.find(f => f.name.includes("PILLOW"));
      if (draft.category === 'HARDWARE') targetFlow = cpqFlows.find(f => f.name.includes("HARDWARE"));

      if (!targetFlow) return alert("Cannot resume draft: No matching CPQ flow setup for this category in Tab 10.");

      setActiveFlowId(targetFlow.id);
      
      const translatedParams = {};
      targetFlow.steps.forEach(step => {
          if (draft.category === 'PILLOW') {
              if (step.title.toLowerCase().includes("size")) translatedParams[step.id] = draft.specs?.size;
              if (step.title.toLowerCase().includes("fill")) translatedParams[step.id] = draft.specs?.fill;
              if (step.title.toLowerCase().includes("fabric")) translatedParams[step.id] = draft.specs?.fabrics?.[0]; 
              if (step.title.toLowerCase().includes("flange") || step.title.toLowerCase().includes("edge")) translatedParams[step.id] = draft.specs?.flange;
              if (step.title.toLowerCase().includes("trim") && draft.specs?.outerTrim?.trimId) translatedParams[step.id] = draft.specs.outerTrim.trimId;
              if (step.title.toLowerCase().includes("stitch")) translatedParams[step.id] = draft.specs?.stitch;
              if (step.title.toLowerCase().includes("seam") && draft.specs?.seamCount) translatedParams[step.id] = draft.specs.seamCount;
          }
      });

      setDynamicConfigParams(translatedParams);
      setShowCloneModal(false);
      setCurrentStepIndex(0);
      alert("Draft visual data translated and mapped to CPQ Flow!");
  };

  useEffect(() => {
      if (!cpqRules || cpqRules.length === 0) return;
      let newFlags = { disabledSteps: [], warnings: [] };
      const selectedItemIds = Object.values(dynamicConfigParams);
      
      const selectedParts = selectedItemIds.map(id => {
          return libraryParts.find(p => p.id === id) || 
                 dynamicAssets.find(a => a.id === id) || 
                 globalFinishes.find(f => f.id === id) ||
                 outsourceFinishes.find(f => f.id === id) ||
                 { id: id, itemName: id }; 
      });

      selectedParts.forEach(part => {
          const specs = part.manufacturingSpecs || part; 
          cpqRules.forEach(rule => {
              let testVal = rule.conditionField.startsWith('customData.') ? specs.customData?.[rule.conditionField.split('.')[1]] : specs[rule.conditionField] || part[rule.conditionField];
              
              if (testVal !== undefined && testVal !== null) {
                  const safeTest = String(testVal).toUpperCase();
                  const safeCond = String(rule.conditionVal).toUpperCase();
                  if (rule.conditionOp === 'EQUALS' && safeTest === safeCond) {
                      if (rule.effectField === 'UI.disableStep') {
                          newFlags.disabledSteps.push(rule.effectVal);
                          const warningMsg = `⚠️ Step "${rule.effectVal}" is disabled because ${part.itemName || part.name} is ${safeCond}.`;
                          if (!newFlags.warnings.includes(warningMsg)) newFlags.warnings.push(warningMsg);
                      }
                  }
              }
          });
      });
      setEngineFlags(newFlags);
  }, [dynamicConfigParams, cpqRules, libraryParts, dynamicAssets, globalFinishes, outsourceFinishes]);

  useEffect(() => {
      if (!activeFlow) return;
      
      let total = activeAssembly?.manufacturingSpecs?.basePrice ? parseFloat(activeAssembly.manufacturingSpecs.basePrice) : 0;
      if (!activeAssembly && activeFlow.basePrice) total = parseFloat(activeFlow.basePrice);

      activeFlow.steps.forEach(step => {
          const selectedValue = dynamicConfigParams[step.id];
          if (selectedValue) {
              if (step.priceMap && step.priceMap[selectedValue]) {
                  total += parseFloat(step.priceMap[selectedValue]);
              }
              
              const dynAsset = dynamicAssets.find(a => a.id === selectedValue);
              if (dynAsset && dynAsset.multiplier > 1.0) total *= dynAsset.multiplier;
              
              const outFin = outsourceFinishes.find(a => a.id === selectedValue);
              if (outFin && outFin.multiplier > 1.0) total *= outFin.multiplier;
          }
      });

      setPricing({ base: total, finalPrice: total });
  }, [dynamicConfigParams, activeFlow, activeAssembly, dynamicAssets, outsourceFinishes]);

  const handleParamChange = (stepId, value) => setDynamicConfigParams(prev => ({ ...prev, [stepId]: value }));

  const handleNextStep = () => {
      if (!activeFlow) return;
      let nextIndex = currentStepIndex + 1;
      while (nextIndex < activeFlow.steps.length && engineFlags.disabledSteps.includes(activeFlow.steps[nextIndex].title)) {
          nextIndex++;
      }
      if (nextIndex < activeFlow.steps.length) setCurrentStepIndex(nextIndex);
  };

  const handleFinalizeQuote = async () => {
      if (!jobData.customerId || !jobData.sidemark) return alert("❌ Please select a Customer and enter a Sidemark.");
      const jobId = `QUOTE-${Date.now()}`;
      const customerName = liveCustomers.find(c => c.id === jobData.customerId)?.name || "Unknown";
      
      const payload = {
          jobId: jobId, brandId: activeBrand, status: 'CONFIGURED',
          customer: { id: jobData.customerId, name: customerName },
          jobName: jobData.jobName, sidemark: jobData.sidemark,
          flowId: activeFlow?.id || null, 
          linkedAssemblyId: activeAssemblyId || null,
          isProjectManaged: activeAssembly?.manufacturingSpecs?.isProjectManaged || false, // 🚀 NEW: Complex Project Routing Flag
          cpqData: { 
              totalPrice: pricing.finalPrice, 
              configuration: dynamicConfigParams, 
              appliedRules: engineFlags.warnings 
          },
          dispatchStatus: { nsSalesOrder: false, fabrication: false, finishing: false, sewing: false, packing: false },
          dateSaved: new Date().toISOString().split('T')[0], author: currentUser, createdAt: serverTimestamp()
      };
      
      try {
          await setDoc(doc(db, "jobs", jobId), payload);
          // 🚀 Updated Alert to reflect dynamic routing based on the flag
          if (activeAssembly?.manufacturingSpecs?.isProjectManaged) {
              alert(`✅ COMPLEX QUOTE GENERATED!\n\nRouted to Tab 10.5 (Project Management) for multi-order dissection.`);
          } else {
              alert(`✅ STANDARD QUOTE GENERATED!\n\nRouted to Tab 10 (External Coop) for standard approval.`);
          }
          setActiveFlowId(""); setDynamicConfigParams({}); setCurrentStepIndex(0); 
          setActiveAssemblyId(""); setShowCheckoutModal(false); setJobData({ customerId: '', jobName: '', sidemark: '' });
      } catch (err) { console.error(err); alert("Failed to save quote."); }
  };

  const get2DRenderLayers = () => {
      const layers = [];
      if (activeAssembly && activeAssembly.finalImageUrl) {
          layers.push({ textureUrl: activeAssembly.finalImageUrl, zIndex: 1, name: activeAssembly.itemName });
      }
      Object.entries(dynamicConfigParams).forEach(([stepId, valueId]) => {
          let foundAsset = dynamicAssets.find(a => a.id === valueId) || globalFinishes.find(f => f.id === valueId) || outsourceFinishes.find(f => f.id === valueId);
          let zIdx = foundAsset ? 30 : 10;
          if (!foundAsset) {
              const libPart = libraryParts.find(p => p.id === valueId);
              if (libPart) { foundAsset = libPart; zIdx = parseInt(libPart.manufacturingSpecs?.layeringSequence) || 10; }
          }
          if (foundAsset) {
              const tex = foundAsset.textureUrl || foundAsset.finalImageUrl;
              if (tex) layers.push({ textureUrl: tex, zIndex: zIdx, name: foundAsset.itemName || foundAsset.name });
          }
      });
      return layers.sort((a, b) => a.zIndex - b.zIndex);
  };

  const get3DTextureOverrides = () => {
      const overrides = {};
      Object.entries(dynamicConfigParams).forEach(([stepId, valueId]) => {
          const step = activeFlow?.steps?.find(s => s.id === stepId);
          if (!step || !step.targetNodes) return; 

          const foundAsset = dynamicAssets.find(a => a.id === valueId) || globalFinishes.find(f => f.id === valueId) || outsourceFinishes.find(f => f.id === valueId) || libraryParts.find(p => p.id === valueId);
          
          if (foundAsset) {
              const tex = foundAsset.textureUrl || foundAsset.finalImageUrl;
              if (tex) overrides[step.targetNodes] = tex;
          }
      });
      return overrides;
  };

  const get3DVisibilityOverrides = () => {
      const overrides = {};
      activeFlow?.steps?.forEach(step => {
          if (step.geometryMap && Object.keys(step.geometryMap).length > 0) {
              // Preemptively hide all meshes that belong to any option in this step
              Object.values(step.geometryMap).forEach(meshString => {
                  if (meshString) {
                      meshString.split(',').forEach(m => {
                          if (m.trim()) overrides[m.trim().toLowerCase()] = false;
                      });
                  }
              });

              // Un-hide the specific mesh tied to the user's current selection
              const selectedVal = dynamicConfigParams[step.id];
              if (selectedVal && step.geometryMap[selectedVal]) {
                  step.geometryMap[selectedVal].split(',').forEach(m => {
                      if (m.trim()) overrides[m.trim().toLowerCase()] = true;
                  });
              }
          }
      });
      return overrides;
  };

  const availableAssemblies = liveAssemblies.filter(a => {
      if (!productType) return true;
      return a.manufacturingSpecs?.productType === productType; 
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', fontFamily: 'monospace', backgroundColor: '#e5e5e5', minHeight: '100vh' }}>
      
      <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '5px 5px 0 #000' }}>
        <div>
          <h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.4rem', color: '#007bff' }}>8. Dynamic CPQ Engine</h2>
          <span style={{ fontSize: '0.7rem', color: '#666' }}>CONFIGURE, PRICE, QUOTE</span>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => setShowCloneModal(true)} style={{ padding: '8px 15px', background: '#000', color: '#fff', fontWeight: 'bold', border: '2px solid #000', cursor: 'pointer' }}>📥 RESUME DRAFT / CLONE QUOTE</button>
            <button onClick={() => { setActiveFlowId(""); setDynamicConfigParams({}); setCurrentStepIndex(0); setActiveAssemblyId(""); setProductType(""); }} style={{ padding: '8px 15px', background: '#fff', color: '#d9534f', fontWeight: 'bold', border: '2px solid #d9534f', cursor: 'pointer' }}>🗑️ CLEAR QUOTE</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '20px', alignItems: 'stretch' }}>
          
          <div style={{ width: '450px', display: 'flex', flexDirection: 'column', gap: '20px', flexShrink: 0 }}>
              
              <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 rgba(0,0,0,0.1)' }}>
                 <div style={{ padding: '10px', background: '#000', color: '#fff', fontWeight: 'bold', fontSize: '0.8rem' }}>STEP 1: SELECT PRODUCT CATEGORY / FLOW</div>
                 <div style={{ padding: '15px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    
                    {cpqFlows.length > 0 && (
                        <select value={activeFlowId} onChange={(e) => { setActiveFlowId(e.target.value); setCurrentStepIndex(0); setDynamicConfigParams({}); setProductType(''); setActiveAssemblyId(''); }} style={{ width: '100%', padding: '12px', border: '2px solid #007bff', fontWeight: 'bold', fontSize: '1rem', background: '#e6f2ff' }}>
                            <option value="">-- Launch Custom CPQ Flow --</option>
                            {cpqFlows.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                    )}

                    {!activeFlowId && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
                            <div style={{ width: '100%', fontSize: '0.7rem', fontWeight: 'bold', color: '#666' }}>OR SELECT STANDARD INVENTORY CATEGORY:</div>
                            <select value={productType} onChange={(e) => {setProductType(e.target.value); setActiveAssemblyId('');}} style={{ width: '100%', padding: '12px', border: '2px solid #000', fontWeight: 'bold' }}>
                                <option value="">-- Select Product Category --</option>
                                {availableProductTypes.map(pt => <option key={pt} value={pt}>{pt}</option>)}
                            </select>
                        </div>
                    )}
                 </div>
              </div>

              {activeFlow && currentStep && (
                  <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 #28a745', flex: 1 }}>
                      <div style={{ padding: '15px', background: '#28a745', color: '#fff', fontWeight: 'bold', fontSize: '1.1rem', display: 'flex', justifyContent: 'space-between' }}>
                          <span>STEP {currentStepIndex + 1} OF {activeFlow.steps.length}: {currentStep.title}</span>
                      </div>
                      
                      <div style={{ padding: '20px', flex: 1, overflowY: 'auto', maxHeight: '400px' }}>
                          {currentStep.type === 'VISUAL_GRID' ? (
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                                  {getOptionsForStep(currentStep).map(opt => {
                                      const priceUpcharge = currentStep.priceMap?.[opt.id] ? ` (+$${currentStep.priceMap[opt.id]})` : '';
                                      return (
                                          <div key={opt.id} onClick={() => handleParamChange(currentStep.id, opt.id)} style={{ border: `2px solid ${dynamicConfigParams[currentStep.id] === opt.id ? '#007bff' : '#ccc'}`, padding: '10px', textAlign: 'center', cursor: 'pointer', background: dynamicConfigParams[currentStep.id] === opt.id ? '#e6f2ff' : '#fff' }}>
                                              <div style={{ width: '100%', height: '80px', background: opt.finalImageUrl ? `url(${opt.finalImageUrl}) center/cover` : '#eee', marginBottom: '10px' }} />
                                              <div style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>{opt.itemName}{priceUpcharge}</div>
                                          </div>
                                      );
                                  })}
                              </div>
                          ) : (
                              <select value={dynamicConfigParams[currentStep.id] || ''} onChange={(e) => handleParamChange(currentStep.id, e.target.value)} style={{ width: '100%', padding: '12px', border: '2px solid #000', fontSize: '1rem' }}>
                                  <option value="">-- Select Option --</option>
                                  {getOptionsForStep(currentStep).map(opt => {
                                      const priceUpcharge = currentStep.priceMap?.[opt.id] ? ` (+$${currentStep.priceMap[opt.id]})` : '';
                                      return <option key={opt.id} value={opt.id}>{opt.itemName}{priceUpcharge}</option>;
                                  })}
                              </select>
                          )}
                      </div>

                      {engineFlags.warnings.length > 0 && (
                           <div style={{ background: '#fff3cd', borderTop: '2px solid #ffc107', padding: '10px 15px' }}>
                               {engineFlags.warnings.map((log, i) => <div key={i} style={{ fontSize: '0.75rem', color: '#856404', fontWeight: 'bold' }}>{log}</div>)}
                           </div>
                      )}

                      <div style={{ padding: '15px', borderTop: '2px solid #eee', display: 'flex', justifyContent: 'space-between' }}>
                          <button onClick={() => setCurrentStepIndex(Math.max(0, currentStepIndex - 1))} disabled={currentStepIndex === 0} style={{ padding: '10px 20px', border: '2px solid #000', background: '#fff', fontWeight: 'bold', cursor: currentStepIndex === 0 ? 'not-allowed' : 'pointer' }}>BACK</button>
                          
                          {currentStepIndex < activeFlow.steps.length - 1 ? (
                              <button onClick={handleNextStep} disabled={currentStep.required && !dynamicConfigParams[currentStep.id]} style={{ padding: '10px 20px', border: '2px solid #000', background: currentStep.required && !dynamicConfigParams[currentStep.id] ? '#ccc' : '#000', color: '#fff', fontWeight: 'bold', cursor: currentStep.required && !dynamicConfigParams[currentStep.id] ? 'not-allowed' : 'pointer' }}>NEXT STEP</button>
                          ) : (
                              <button onClick={() => setShowCheckoutModal(true)} disabled={currentStep.required && !dynamicConfigParams[currentStep.id]} style={{ padding: '10px 20px', border: '2px solid #28a745', background: currentStep.required && !dynamicConfigParams[currentStep.id] ? '#ccc' : '#28a745', color: '#fff', fontWeight: 'bold', cursor: currentStep.required && !dynamicConfigParams[currentStep.id] ? 'not-allowed' : 'pointer' }}>FINISH CONFIGURATION</button>
                          )}
                      </div>
                  </div>
              )}

              {!activeFlowId && productType && (
                 <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 rgba(0,0,0,0.1)' }}>
                    <div style={{ padding: '10px', background: '#000', color: '#fff', fontWeight: 'bold', fontSize: '0.8rem' }}>STEP 2: SELECT APPROVED DESIGN</div>
                    <div style={{ padding: '15px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px', maxHeight: '200px', overflowY: 'auto' }}>
                       {availableAssemblies.length === 0 ? <span style={{ fontSize: '0.8rem', color: '#999' }}>No approved assemblies found.</span> : (
                           availableAssemblies.map(asm => (
                              <button key={asm.id} onClick={() => setActiveAssemblyId(asm.id)} style={{ padding: '10px', background: activeAssemblyId === asm.id ? '#28a745' : '#fff', color: activeAssemblyId === asm.id ? '#fff' : '#333', border: `2px solid ${activeAssemblyId === asm.id ? '#1e7e34' : '#ccc'}`, fontWeight: 'bold', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}>
                                 <div style={{ fontSize: '0.7rem', opacity: 0.8 }}>{asm.legacyErpId !== "PENDING" ? asm.legacyErpId : asm.itemId}</div>
                                 <div style={{ textAlign: 'center' }}>{asm.itemName}</div>
                              </button>
                           ))
                       )}
                    </div>
                    {activeAssemblyId && (
                         <div style={{ padding: '15px', borderTop: '2px solid #eee' }}>
                             <button onClick={() => setShowCheckoutModal(true)} style={{ width: '100%', padding: '10px 20px', border: '2px solid #28a745', background: '#28a745', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}>FINISH HARDWARE CONFIGURATION</button>
                         </div>
                    )}
                 </div>
              )}
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px', minHeight: '800px' }}>
              <div style={{ flex: 1, background: '#fff', border: '2px solid #000', boxShadow: '10px 10px 0 #000', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
                  
                  <div style={{ padding: '15px', background: '#f8f9fa', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 999, borderBottom: '2px solid #000' }}>
                      <div style={{ color: '#000', fontSize: '1.2rem', fontWeight: 'bold' }}>
                          LIVE {viewMode} ENGINE
                      </div>
                      <div style={{ display: 'flex', border: '2px solid #007bff', borderRadius: '4px', overflow: 'hidden' }}>
                          <button onClick={() => setViewMode('2D')} style={{ padding: '5px 15px', background: viewMode === '2D' ? '#007bff' : 'transparent', color: viewMode === '2D' ? '#fff' : '#007bff', fontWeight: 'bold', border: 'none', cursor: 'pointer', fontSize: '0.8rem' }}>🖼️ 2D</button>
                          <button onClick={() => setViewMode('3D')} disabled={!activeAssembly?.manufacturingSpecs?.cadUrl} style={{ padding: '5px 15px', background: viewMode === '3D' ? '#007bff' : 'transparent', color: viewMode === '3D' ? '#fff' : '#007bff', fontWeight: 'bold', border: 'none', cursor: activeAssembly?.manufacturingSpecs?.cadUrl ? 'pointer' : 'not-allowed', opacity: activeAssembly?.manufacturingSpecs?.cadUrl ? 1 : 0.5, fontSize: '0.8rem' }}>🧊 3D</button>
                      </div>
                  </div>
                  
                  <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {!activeAssembly ? (
                          <div style={{ color: '#666', textAlign: 'center', zIndex: 1 }}>
                              <div style={{ fontSize: '3rem', marginBottom: '10px' }}>⚙️</div>
                              <h3 style={{ margin: 0 }}>Visual Engine Ready</h3>
                              <p style={{ fontSize: '0.8rem', maxWidth: '300px', margin: '10px auto' }}>Select a flow and assembly to begin configuration.</p>
                          </div>
                      ) : viewMode === '3D' ? (
                          <Canvas camera={{ position: [5, 5, 5], fov: 50 }} style={{ width: '100%', height: '100%' }}>
                              <ambientLight intensity={0.7} />
                              <directionalLight position={[10, 20, 5]} intensity={1.5} />
                              <OrbitControls makeDefault />
                              <Bounds fit clip margin={1.2}>
                                  <DynamicModel 
                                      url={activeAssembly.manufacturingSpecs.cadUrl} 
                                      textureOverrides={get3DTextureOverrides()} 
                                      visibilityOverrides={get3DVisibilityOverrides()}
                                  />
                              </Bounds>
                          </Canvas>
                      ) : (
                          <div style={{ position: 'absolute', inset: '20px' }}>
                              {get2DRenderLayers().map((layer, idx) => (
                                  <div key={idx} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: layer.zIndex }}>
                                      {layer.textureUrl ? (
                                          <img src={layer.textureUrl} alt={layer.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                                      ) : (
                                          <div style={{ width: '100%', height: '100%', border: '2px dashed #000', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#000', fontWeight: 'bold', fontSize: '0.8rem', textAlign: 'center' }}>
                                              {layer.name}<br/>(Missing Asset)
                                          </div>
                                      )}
                                  </div>
                              ))}
                          </div>
                      )}
                  </div>
              </div>

              <div style={{ background: '#fff', border: '2px solid #000', padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '5px 5px 0 #d9534f' }}>
                  <div>
                      <div style={{ fontSize: '0.8rem', color: '#666', fontWeight: 'bold', marginBottom: '5px' }}>ESTIMATED UNIT PRICE</div>
                      <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#d9534f' }}>${pricing.finalPrice.toFixed(2)}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', textAlign: 'right', fontSize: '0.8rem' }}>
                      <div>Total Dynamic Sum: <span style={{ fontWeight: 'bold' }}>${pricing.base.toFixed(2)}</span></div>
                  </div>
              </div>
          </div>
      </div>

      {showCheckoutModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
            <div style={{ background: '#fff', border: '4px solid #000', width: '500px', display: 'flex', flexDirection: 'column', boxShadow: '20px 20px 0 #000' }}>
                <div style={{ padding: '20px', background: '#000', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000' }}>
                    <h2 style={{ margin: 0, fontSize: '1.2rem', textTransform: 'uppercase' }}>💾 FINALIZE & ASSIGN QUOTE</h2>
                    <button onClick={() => setShowCheckoutModal(false)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.5rem', cursor: 'pointer' }}>×</button>
                </div>
                <div style={{ padding: '20px', flex: 1, display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    
                    <div style={{ padding: '15px', background: '#eafaf1', border: '1px solid #28a745', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#28a745' }}>FINAL CONFIGURED PRICE</div>
                        <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>${pricing.finalPrice.toFixed(2)}</div>
                    </div>

                    <div>
                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#d9534f', display: 'block', marginBottom: '5px' }}>* SELECT CUSTOMER:</label>
                        <select value={jobData.customerId} onChange={e => setJobData({...jobData, customerId: e.target.value})} style={{ width: '100%', padding: '10px', fontSize: '1rem', border: '2px solid #d9534f', outline: 'none', background: '#fff9fa' }}>
                            <option value="">-- Choose Customer --</option>
                            {liveCustomers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>

                    <div>
                        <label style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#666', display: 'block', marginBottom: '5px' }}>JOB NAME (Optional):</label>
                        <input type="text" placeholder="e.g. Master Suite Reno" value={jobData.jobName} onChange={e => setJobData({...jobData, jobName: e.target.value})} style={{ width: '100%', padding: '10px', fontSize: '0.9rem', border: '1px solid #ccc', outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                        <label style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#d9534f', display: 'block', marginBottom: '5px' }}>* SIDEMARK:</label>
                        <input type="text" placeholder="e.g. Guest Bedroom 1" value={jobData.sidemark} onChange={e => setJobData({...jobData, sidemark: e.target.value})} style={{ width: '100%', padding: '10px', fontSize: '0.9rem', border: '2px solid #d9534f', background: '#fff9fa', outline: 'none', boxSizing: 'border-box' }} />
                    </div>

                    <button onClick={handleFinalizeQuote} style={{ width: '100%', padding: '15px', background: '#28a745', color: '#fff', fontSize: '1.1rem', fontWeight: 'bold', border: '2px solid #1e7e34', cursor: 'pointer', marginTop: '10px' }}>
                        ✅ SUBMIT QUOTE TO PIPELINE
                    </button>
                </div>
            </div>
        </div>
      )}

      {showCloneModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
            <div style={{ background: '#fff', border: '4px solid #000', width: '800px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '20px 20px 0 #000' }}>
                <div style={{ padding: '20px', background: '#000', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000' }}>
                    <h2 style={{ margin: 0, fontSize: '1.5rem', textTransform: 'uppercase' }}>📥 RESUME DRAFT / CLONE QUOTE</h2>
                    <button onClick={() => setShowCloneModal(false)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '2rem', cursor: 'pointer' }}>×</button>
                </div>
                <div style={{ padding: '20px', flex: 1, overflowY: 'auto', background: '#f8f9fa' }}>
                    {previousDrafts.length === 0 ? <div style={{ color: '#666', fontStyle: 'italic' }}>No drafts pushed from Vision Tab yet.</div> : (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                            {previousDrafts.map(draft => (
                                <div key={draft.id} onClick={() => handleResumeDraft(draft.id)} style={{ background: '#fff', border: '2px solid #000', padding: '15px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '8px', transition: '0.2s', boxShadow: '4px 4px 0 rgba(0,0,0,0.1)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                        <span style={{ fontWeight: 'bold', color: '#007bff' }}>DRAFT: {draft.category}</span>
                                        <span style={{ fontSize: '0.7rem', color: '#fff', background: '#d9534f', padding: '2px 5px' }}>RESUME</span>
                                    </div>
                                    <div style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>Generated by: {draft.author}</div>
                                    <div style={{ fontSize: '0.75rem', color: '#666' }}>{new Date(draft.createdAt?.seconds * 1000).toLocaleString()}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
      )}

    </div>
  );
};

export default CPQTab;