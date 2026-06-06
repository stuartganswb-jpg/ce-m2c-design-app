import React, { useState, useEffect, useMemo } from 'react';
import { db, storage } from '../../firebase';
import { collection, onSnapshot, doc, setDoc, deleteDoc, serverTimestamp, query, where } from "firebase/firestore";
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { useGLTF, OrbitControls, Bounds, Html, Environment, ContactShadows } from '@react-three/drei';

const globalTextureCache = {};

const SearchableCustomerSelect = ({ value, onChange, customers, placeholder, style }) => {
    const [search, setSearch] = useState('');
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        if (value) {
            const c = customers.find(x => x.id === value);
            if (c) setSearch(`${c.name} (${c.id})`);
        } else {
            setSearch('');
        }
    }, [value, customers]);

    const filtered = customers.filter(c => 
        c.name.toLowerCase().includes(search.toLowerCase()) || 
        c.id.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div style={{ position: 'relative', flex: 1 }}>
            <input 
                type="text"
                value={search}
                onChange={(e) => {
                    setSearch(e.target.value);
                    setIsOpen(true);
                    if (e.target.value === '') onChange('');
                }}
                onFocus={() => setIsOpen(true)}
                onBlur={() => setTimeout(() => setIsOpen(false), 200)}
                placeholder={placeholder}
                style={{ ...style, width: '100%', boxSizing: 'border-box' }}
            />
            {isOpen && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid var(--line)', maxHeight: '250px', overflowY: 'auto', zIndex: 10000, boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                    {filtered.length === 0 && <div style={{ padding: '12px', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--sans)', fontSize: '0.9rem' }}>No matches found...</div>}
                    {filtered.map(c => (
                        <div 
                            key={c.id}
                            onMouseDown={() => {
                                onChange(c.id);
                                setSearch(`${c.name} (${c.id})`);
                                setIsOpen(false);
                            }}
                            style={{ padding: '12px', borderBottom: '1px solid var(--line)', cursor: 'pointer', background: value === c.id ? 'var(--paper-2)' : '#fff', color: 'var(--ink)', fontSize: '0.9rem', fontFamily: 'var(--sans)' }}
                        >
                            {c.name} <span style={{color: 'var(--ink-soft)', fontSize: '0.75rem'}}>({c.id})</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const DynamicModel = ({ url, textureOverrides, visibilityOverrides }) => {
    const { scene } = useGLTF(url, 'https://www.gstatic.com/draco/versioned/decoders/1.5.5/');
    const clonedScene = useMemo(() => scene.clone(true), [scene]);
    
    const textureOverridesString = JSON.stringify(textureOverrides);
    const visibilityOverridesString = JSON.stringify(visibilityOverrides);

    useEffect(() => {
        clonedScene.traverse((child) => {
            if (child.isMesh && child.userData.originalMaterial === undefined) {
                child.userData.originalMaterial = child.material.clone();
                child.userData.originalVisible = child.visible;
            }
        });

        const texMap = {}; 

        const applyAllOverrides = () => {
            clonedScene.traverse((child) => {
                if (child.isMesh && child.userData.originalMaterial) {
                    const meshName = child.name.toLowerCase();

                    let isVis = child.userData.originalVisible;
                    if (visibilityOverrides && Object.keys(visibilityOverrides).length > 0) {
                        for (const [targetStr, isVisibleFlag] of Object.entries(visibilityOverrides)) {
                            const targets = targetStr.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
                            if (targets.some(t => meshName === t || meshName.startsWith(t + '_') || meshName.startsWith(t + '.'))) {
                                isVis = isVisibleFlag;
                            }
                        }
                    }
                    child.visible = isVis;

                    let matchedTexUrl = null;
                    if (textureOverrides && Object.keys(textureOverrides).length > 0) {
                        for (const [targetStr, texUrl] of Object.entries(textureOverrides)) {
                            const targets = targetStr.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
                            if (targets.some(t => meshName === t || meshName.startsWith(t + '_') || meshName.startsWith(t + '.'))) {
                                matchedTexUrl = texUrl;
                            }
                        }
                    }

                    if (matchedTexUrl && texMap[matchedTexUrl]) {
                        const newMat = child.userData.originalMaterial.clone();
                        newMat.map = texMap[matchedTexUrl];
                        newMat.color = new THREE.Color(0xffffff); 
                        newMat.envMapIntensity = 1.0; 
                        newMat.needsUpdate = true;
                        child.material = newMat;
                    } else {
                        child.material = child.userData.originalMaterial;
                    }
                }
            });
        };

        if (!textureOverrides || Object.keys(textureOverrides).length === 0) {
            applyAllOverrides();
            return;
        }

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
                        loadedCount++; 
                        if (loadedCount === uniqueUrls.length) applyAllOverrides();
                    }
                );
            }
        });
    }, [clonedScene, textureOverridesString, visibilityOverridesString]);

    return <primitive object={clonedScene} />;
};

const CPQTab = ({ currentUser, activeBrand, cart, setCart }) => {
  const [liveAssemblies, setLiveAssemblies] = useState([]);
  const [liveCustomers, setLiveCustomers] = useState([]); 
  const [previousDrafts, setPreviousDrafts] = useState([]); 
  const [cpqRules, setCpqRules] = useState([]);
  const [cpqFlows, setCpqFlows] = useState([]);
  
  const [libraryParts, setLibraryParts] = useState([]);
  const [activeBomPins, setActiveBomPins] = useState([]); 

  const [globalLists, setGlobalLists] = useState({});
  const [globalFinishes, setGlobalFinishes] = useState([]);
  const [outsourceFinishes, setOutsourceFinishes] = useState([]);
  const [dynamicAssets, setDynamicAssets] = useState([]);

  const [productType, setProductType] = useState(''); 
  const [activeFlowId, setActiveFlowId] = useState("");
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  
  const [dynamicConfigParams, setDynamicConfigParams] = useState({});
  const [stepQuantities, setStepQuantities] = useState({}); 
  const [dimensionInputs, setDimensionInputs] = useState({});

  const [engineFlags, setEngineFlags] = useState({ disabledSteps: [], warnings: [] });
  
  const [pricing, setPricing] = useState({ base: 0, finalPrice: 0 });
  const [pricingBreakdown, setPricingBreakdown] = useState([]);
  
  const [jobData, setJobData] = useState({ 
      customerId: '', 
      jobName: '', 
      sidemark: '',
      shippingMethod: 'SAVED', 
      shippingAddressId: '', 
      customShippingAddress: { attention: '', addressee: '', addr1: '', addr2: '', city: '', state: '', zip: '', country: 'US' }
  });
  
  const [assemblyQty, setAssemblyQty] = useState(1);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [showCartSuccessModal, setShowCartSuccessModal] = useState(false);

  const [activeAssemblyId, setActiveAssemblyId] = useState('');
  const [activeAssembly, setActiveAssembly] = useState(null);
  
  // NEW: Store masterQuoteId to ensure we append to the right parent Job
  const [activeMasterQuoteId, setActiveMasterQuoteId] = useState(null);
  const [activeDraftId, setActiveDraftId] = useState(null);
  const [activeDraftSvg, setActiveDraftSvg] = useState(null);

  const [viewMode, setViewMode] = useState("3D");

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

      const unsubCrm = onSnapshot(collection(db, "crm_records"), (snap) => {
          const customers = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => r.type === 'CUSTOMER');
          setLiveCustomers(customers);
      });

      return () => { unsubFlows(); unsubParts(); unsubLists(); unsubRules(); unsubDrafts(); unsubFinishes(); unsubOutsource(); unsubDynamic(); unsubCrm(); };
  }, [activeBrand]);

  const combinedCustomers = useMemo(() => {
      const merged = [...liveCustomers];
      (globalLists.customers || []).forEach(cName => {
          if (!merged.some(c => c.name === cName || c.id === cName)) {
              merged.push({ id: cName, name: cName });
          }
      });
      return merged;
  }, [liveCustomers, globalLists.customers]);

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

  useEffect(() => {
      if (!activeAssemblyId || !liveAssemblies.length) { setActiveBomPins([]); return; }
      const asm = liveAssemblies.find(a => a.id === activeAssemblyId);
      if (!asm) return;
      const unsub = onSnapshot(query(collection(db, "assembly_pins"), where("assemblyId", "==", asm.itemId)), (snap) => {
          setActiveBomPins(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      });
      return () => unsub();
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
      } else if (globalLists.inventoryTypes?.includes(step.dataSource) || globalLists.assemblyTypes?.includes(step.dataSource) || globalLists.prodTypes?.includes(step.dataSource)) {
          const allParts = [...libraryParts, ...liveAssemblies];
          options = allParts.filter(p => p.routingType === step.dataSource || p.manufacturingSpecs?.productType === step.dataSource || p.productType === step.dataSource).map(p => ({
              id: p.id,
              itemName: p.itemName,
              finalImageUrl: p.finalImageUrl || p.manufacturingSpecs?.finalImageUrl,
              code: p.legacyErpId,
              clientPricing: p.clientPricing,
              basePrice: p.manufacturingSpecs?.basePrice
          }));
      } else {
          const customAssets = dynamicAssets.filter(a => a.windowId === step.dataSource);
          if (customAssets.length > 0) {
              options = customAssets.map(a => ({ id: a.id, itemName: a.name, finalImageUrl: a.textureUrl, code: a.code, multiplier: a.multiplier }));
          } else if (globalLists[step.dataSource]) {
              options = globalLists[step.dataSource].map(val => ({ id: val, itemName: val }));
          } else if (step.dataSource === 'master_fabrics') {
              const allParts = [...libraryParts, ...liveAssemblies];
              options = allParts.filter(p => ['TEXTILE', 'FABRIC', 'RAW MATERIAL'].includes(p.manufacturingSpecs?.productType));
          } else if (step.dataSource === 'master_trims') {
              const allParts = [...libraryParts, ...liveAssemblies];
              options = allParts.filter(p => ['TRIMMING', 'COMPONENT'].includes(p.manufacturingSpecs?.productType));
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
      if (draft.category === 'HARDWARE') {
          targetFlow = cpqFlows.find(f => f.id === draft.cpqFlowId || f.id === draft.flowId || f.id === draft.linkedCpqFlowId);
          if (!targetFlow) targetFlow = cpqFlows.find(f => f.name.includes("HARDWARE"));
      }

      if (!targetFlow) return alert("Cannot resume draft: No matching CPQ flow setup for this category.");

      setActiveFlowId(targetFlow.id);
      setActiveDraftId(draft.id);
      
      if (draft.masterQuoteId) {
          setActiveMasterQuoteId(draft.masterQuoteId);
      }

      if (draft.specs?.engineeringNotes?.svgString) {
          setActiveDraftSvg(draft.specs.engineeringNotes.svgString);
      } else {
          setActiveDraftSvg(null);
      }
      
      setJobData(prev => ({
          ...prev,
          jobName: draft.jobName || prev.jobName,
          sidemark: draft.sidemark || prev.sidemark
      }));
      
      const translatedParams = {};
      const newStepQuantities = {};
      const engineeringNotes = draft.specs?.engineeringNotes;

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
          
          if (engineeringNotes) {
              const lowerTitle = step.title.toLowerCase();
              if (lowerTitle.includes("bracket")) {
                  newStepQuantities[step.id] = engineeringNotes.qtyBrackets !== undefined ? engineeringNotes.qtyBrackets : 0;
              }
              if (lowerTitle.includes("ring")) {
                  newStepQuantities[step.id] = engineeringNotes.recRings !== undefined ? engineeringNotes.recRings : 0;
              }
              if (lowerTitle.includes("finial") || lowerTitle.includes("endcap")) {
                  newStepQuantities[step.id] = engineeringNotes.qtyFinials !== undefined ? engineeringNotes.qtyFinials : 0;
              }
              if (lowerTitle.includes("splice") || lowerTitle.includes("connector")) {
                  newStepQuantities[step.id] = engineeringNotes.qtySplices !== undefined ? engineeringNotes.qtySplices : 0;
              }
          }
      });

      if (draft.category === 'HARDWARE' || !draft.category) {
          Object.assign(translatedParams, draft.specs);
      }

      setDynamicConfigParams(translatedParams);
      setStepQuantities(prev => ({...prev, ...newStepQuantities}));
      setShowCloneModal(false);
      setCurrentStepIndex(0);
      
      if (draft.category === 'HARDWARE') {
          alert("Hardware Draft Loaded!\n\nPlease reference the pinned Engineering Specs to manually enter quantities and fees.");
      } else {
          alert("Draft visual data translated and mapped to CPQ Flow!");
      }
  };

  const handleDeleteDraft = async (id) => {
      if (window.confirm("Permanently delete this draft from the system?")) {
          try { await deleteDoc(doc(db, "cpq_drafts", id)); } 
          catch (err) { console.error(err); }
      }
  };

  const handleClearAllDrafts = async () => {
      if (window.confirm("⚠️ WARNING: This will permanently delete ALL abandoned drafts in the system. Are you sure?")) {
          try {
              const deletePromises = previousDrafts.map(d => deleteDoc(doc(db, "cpq_drafts", d.id)));
              await Promise.all(deletePromises);
              alert("✅ All drafts have been wiped from the system.");
          } catch(err) { console.error(err); }
      }
  };

  useEffect(() => {
      if (!cpqRules || cpqRules.length === 0) return;
      let newFlags = { disabledSteps: [], warnings: [] };
      const selectedItemIds = Object.values(dynamicConfigParams);
      
      const allParts = [...libraryParts, ...liveAssemblies];
      
      const selectedParts = selectedItemIds.map(id => {
          return allParts.find(p => p.id === id) || 
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
  }, [dynamicConfigParams, cpqRules, libraryParts, liveAssemblies, dynamicAssets, globalFinishes, outsourceFinishes]);

  const handleDimensionChange = (stepId, key, value, template) => {
      setDimensionInputs(prev => {
          const current = prev[stepId] || { length: '', type: 'O2O', wallA: '', wallB: '', wallC: '' };
          const updated = { ...current, [key]: value };
          
          let calculatedQty = 1;
          let cutLength = 0;
          let o2o = 0;
          let c2c = 0;
          
          if (template === 'calc_french_return_1in') {
              let baseLength = parseFloat(updated.length) || 0;
              
              if (updated.type === 'C2C') {
                  c2c = baseLength;
                  o2o = baseLength + 1; 
              } else {
                  o2o = baseLength;
                  c2c = baseLength - 1; 
              }
              
              cutLength = o2o + 17; 
              calculatedQty = Math.max(1, Math.ceil(cutLength / 12)); 
              
              updated.calc_o2o = o2o;
              updated.calc_c2c = c2c;
              updated.calc_cutLength = cutLength;

          } else if (template === 'calc_straight_pole') {
              let baseLength = parseFloat(updated.length) || 0;
              calculatedQty = Math.max(1, Math.ceil(baseLength / 12));
              updated.calc_cutLength = baseLength;

          } else if (template === 'calc_mitered_bay') {
              let a = parseFloat(updated.wallA) || 0;
              let b = parseFloat(updated.wallB) || 0;
              let c = parseFloat(updated.wallC) || 0;
              calculatedQty = Math.max(1, Math.ceil((a + b + c + 12) / 12)); 
              updated.calc_cutLength = a + b + c + 12; 

          } else if (template === 'calc_curved_bay') {
              let baseLength = parseFloat(updated.length) || 0;
              calculatedQty = Math.max(1, Math.ceil((baseLength + 12) / 12)); 
              updated.calc_cutLength = baseLength + 12;
          }

          if (value !== '') {
              setStepQuantities(sq => ({...sq, [stepId]: calculatedQty}));
          }
          
          return { ...prev, [stepId]: updated };
      });
  };

  useEffect(() => {
      if (!activeFlow) return;
      
      let breakdown = [];
      let baseAssemblyPrice = activeAssembly?.manufacturingSpecs?.basePrice ? parseFloat(activeAssembly.manufacturingSpecs.basePrice) : 0;
      if (!activeAssembly && activeFlow.basePrice) baseAssemblyPrice = parseFloat(activeFlow.basePrice);

      if (baseAssemblyPrice > 0) {
          breakdown.push({ name: activeAssembly ? activeAssembly.itemName : activeFlow.name, qty: 1, price: baseAssemblyPrice, total: baseAssemblyPrice });
      }

      let total = baseAssemblyPrice;
      const allParts = [...libraryParts, ...liveAssemblies];

      activeFlow.steps.forEach(step => {
          const selectedValue = dynamicConfigParams[step.id];
          
          let rawQty = stepQuantities[step.id];
          let qty = 1;
          if (rawQty !== undefined && rawQty !== '') {
              qty = parseInt(rawQty) || 0; 
          } else {
              qty = activeBomPins.find(p => p.partId === step.linkedPinId)?.defaultQty || 1;
          }

          const hasBasePrice = step.basePrice !== undefined && step.basePrice !== null && step.basePrice !== '';

          if (selectedValue || step.type === 'DIMENSIONS' || step.type === 'STATIC_FEE' || hasBasePrice) {
              
              let stepPrice = hasBasePrice ? parseFloat(step.basePrice) : 0;
              
              if (step.linkedItemId && step.useClientPricing && jobData.customerId) {
                  const basePartObj = allParts.find(p => p.id === step.linkedItemId);
                  if (basePartObj && basePartObj.clientPricing) {
                      const cp = basePartObj.clientPricing.find(c => c.customerId === jobData.customerId);
                      if (cp && cp.price !== undefined && cp.price !== "") {
                          stepPrice = parseFloat(cp.price); 
                      }
                  }
              }

              let multiplier = 1.0;
              let itemName = step.title;

              if (selectedValue) {
                  const partObj = allParts.find(p => p.id === selectedValue) || 
                                  dynamicAssets.find(a => a.id === selectedValue) ||
                                  globalFinishes.find(f => f.id === selectedValue) ||
                                  outsourceFinishes.find(f => f.id === selectedValue);

                  if (partObj) itemName = `${step.title} (${partObj.itemName || partObj.name})`;

                  let optionNativePrice = 0;
                  if (partObj) {
                      if (partObj.manufacturingSpecs?.basePrice) optionNativePrice = parseFloat(partObj.manufacturingSpecs.basePrice);
                      else if (partObj.basePrice) optionNativePrice = parseFloat(partObj.basePrice);
                  }

                  if (step.useClientPricing && jobData.customerId && partObj?.clientPricing) {
                      const cp = partObj.clientPricing.find(c => c.customerId === jobData.customerId);
                      if (cp && cp.price !== undefined && cp.price !== "") {
                          optionNativePrice = parseFloat(cp.price);
                      }
                  }

                  let upcharge = 0;
                  if (step.priceMap && step.priceMap[selectedValue]) {
                      upcharge = parseFloat(step.priceMap[selectedValue]) || 0;
                  }

                  stepPrice += optionNativePrice + upcharge;

                  if (partObj && partObj.multiplier && parseFloat(partObj.multiplier) > 1.0) {
                      multiplier = parseFloat(partObj.multiplier);
                  }
              }

              if (step.priceOverride !== undefined && step.priceOverride !== "") {
                  stepPrice = parseFloat(step.priceOverride);
              }
              
              let lineTotal = stepPrice * multiplier * qty;
              
              if (lineTotal > 0 || stepPrice > 0 || step.type === 'STATIC_FEE') {
                  breakdown.push({ name: itemName, qty: qty, price: stepPrice * multiplier, total: lineTotal });
              }

              total += lineTotal;
          }
      });

      setPricing({ base: total, finalPrice: total });
      setPricingBreakdown(breakdown);
  }, [dynamicConfigParams, stepQuantities, activeFlow, activeAssembly, dynamicAssets, outsourceFinishes, jobData.customerId, libraryParts, liveAssemblies, activeBomPins, globalFinishes]);

  const handleParamChange = (stepId, value) => setDynamicConfigParams(prev => ({ ...prev, [stepId]: value }));

  const handleNextStep = () => {
      if (!activeFlow) return;
      let nextIndex = currentStepIndex + 1;
      while (nextIndex < activeFlow.steps.length && engineFlags.disabledSteps.includes(activeFlow.steps[nextIndex].title)) {
          nextIndex++;
      }
      if (nextIndex < activeFlow.steps.length) setCurrentStepIndex(nextIndex);
  };

  const handleAddToCart = () => {
      const item = {
          id: Date.now().toString(),
          masterQuoteId: activeMasterQuoteId,
          assemblyId: activeAssemblyId,
          assemblyName: activeAssembly?.itemName || activeFlow?.name || 'Configured Item',
          flowId: activeFlowId,
          qty: assemblyQty,
          pricing: { ...pricing },
          pricingBreakdown: [...pricingBreakdown],
          dynamicConfigParams: { ...dynamicConfigParams },
          stepQuantities: { ...stepQuantities },
          dimensionInputs: { ...dimensionInputs },
          engineeringNotes: activeDraftId ? previousDrafts.find(d => d.id === activeDraftId)?.specs?.engineeringNotes : null,
          draftSvg: activeDraftSvg
      };
      setCart([...cart, item]);
      
      setActiveFlowId("");
      setDynamicConfigParams({});
      setStepQuantities({});
      setDimensionInputs({});
      setCurrentStepIndex(0);
      setActiveAssemblyId("");
      setActiveDraftId(null);
      setActiveDraftSvg(null);
      setAssemblyQty(1);

      setShowCartSuccessModal(true);
  };

  const handleFinalizeQuote = async () => {
      if (!jobData.customerId || !jobData.sidemark) return alert("Please select a Customer and enter a Sidemark.");
      if (cart.length === 0) return alert("Your cart is empty. Please add an assembly first.");

      // If a masterQuoteId exists in the cart, use it. Otherwise, fallback to a new ID.
      const targetJobId = cart[0].masterQuoteId || activeMasterQuoteId || `QUOTE-${Date.now()}`;
      const customerName = combinedCustomers.find(c => c.id === jobData.customerId)?.name || jobData.customerId;
      
      let grandTotal = 0;
      let mergedBreakdown = [];
      let mergedNotesObj = null; 
      let mergedDraftSvg = null; 

      cart.forEach((item) => {
          grandTotal += item.pricing.finalPrice * item.qty;
          
          mergedBreakdown.push({
              name: `▶ ${item.assemblyName}`,
              qty: item.qty,
              total: item.pricing.finalPrice * item.qty,
              isHeader: true
          });

          item.pricingBreakdown.forEach(line => {
              mergedBreakdown.push({
                  name: `  - ${line.name}`,
                  qty: line.qty * item.qty,
                  price: line.price,
                  total: line.total * item.qty
              });
          });

          if (!mergedNotesObj && item.engineeringNotes) mergedNotesObj = item.engineeringNotes;
          if (!mergedDraftSvg && item.draftSvg) mergedDraftSvg = item.draftSvg;
      });

      const payload = {
          jobId: targetJobId, brandId: activeBrand, status: 'CONFIGURED',
          customer: { id: jobData.customerId, name: customerName },
          jobName: jobData.jobName, sidemark: jobData.sidemark,
          flowId: cart[0].flowId || null, 
          linkedAssemblyId: cart[0].assemblyId || null,
          isProjectManaged: activeAssembly?.manufacturingSpecs?.isProjectManaged || false, 
          
          shippingMethod: jobData.shippingMethod || 'SAVED',
          shippingAddressId: jobData.shippingAddressId || null,
          customShippingAddress: jobData.shippingMethod === 'CUSTOM' ? jobData.customShippingAddress : null,

          cpqData: { 
              totalPrice: grandTotal, 
              appliedRules: engineFlags.warnings,
              breakdown: mergedBreakdown,
              cartItems: cart 
          },
          engineeringNotes: mergedNotesObj, 
          dispatchStatus: { nsSalesOrder: false, fabrication: false, finishing: false, sewing: false, packing: false },
          dateSaved: new Date().toISOString().split('T')[0], author: currentUser, createdAt: serverTimestamp()
      };
      
      try {
          // Use merge: true so if the quote was initialized in Vision, we append the configuration to it.
          await setDoc(doc(db, "jobs", targetJobId), payload, { merge: true });
          
          if (mergedDraftSvg) {
              await setDoc(doc(db, "crm_files", `DRAWING-${Date.now()}`), {
                  customerId: jobData.customerId,
                  jobId: targetJobId,
                  sidemark: jobData.sidemark,
                  dateSaved: new Date().toISOString(),
                  type: 'VISION_DRAWING',
                  svgData: mergedDraftSvg
              });
          }
          
          if (activeDraftId) {
              await deleteDoc(doc(db, "cpq_drafts", activeDraftId));
          }

          await generateOrderDocuments(payload, mergedDraftSvg);

          if (activeAssembly?.manufacturingSpecs?.isProjectManaged) {
              alert(`✅ Quote Generated!\nRouted to Tab 10.5 (Project Management) for multi-order dissection.`);
          } else {
              alert(`✅ Quote Generated!\nRouted to Tab 10 (External Coop) for standard approval.`);
          }
          
          setCart([]);
          localStorage.removeItem('hq_global_cart');
          setShowCheckoutModal(false);
          setJobData({ customerId: '', jobName: '', sidemark: '', shippingMethod: 'SAVED', shippingAddressId: '', customShippingAddress: { attention: '', addressee: '', addr1: '', addr2: '', city: '', state: '', zip: '', country: 'US' } });
          setActiveMasterQuoteId(null);

      } catch (err) { 
          console.error(err); 
          alert("Failed to save quote."); 
      }
  };

  const generateOrderDocuments = async (job, draftSvg) => {
      const printWindow = window.open('', '_blank');
      
      let mathSection = '';
      if (job.engineeringNotes) {
          const notes = job.engineeringNotes;
          mathSection = `
              <div style="background: #faf8f4; border: 1px dashed rgba(28,26,22,.14); padding: 20px;">
                  <h4 style="margin:0 0 15px 0; color: #1c1a16; font-family: Georgia, serif; text-transform: uppercase;">Engineering Dimensions</h4>
                  <table style="width: 100%; border-collapse: collapse; font-size: 14px; font-family: sans-serif;">
                      <tr>
                          <td style="padding: 8px; border-bottom: 1px solid rgba(28,26,22,.14); color: #524e46;">Pole O2O (Edge-to-Edge):</td>
                          <td style="padding: 8px; border-bottom: 1px solid rgba(28,26,22,.14); font-weight: bold;">${notes.poleO2O ? notes.poleO2O.toFixed(2) + '"' : 'N/A'}</td>
                      </tr>
                      <tr>
                          <td style="padding: 8px; border-bottom: 1px solid rgba(28,26,22,.14); color: #524e46;">Total System O2O (+ Brackets):</td>
                          <td style="padding: 8px; border-bottom: 1px solid rgba(28,26,22,.14); font-weight: bold;">${notes.totalSystemO2O ? notes.totalSystemO2O.toFixed(2) + '"' : 'N/A'}</td>
                      </tr>
                      ${notes.shape === 'MITERED' ? `
                      <tr>
                          <td style="padding: 8px; border-bottom: 1px solid rgba(28,26,22,.14); color: #524e46;">Left Wall C2C:</td>
                          <td style="padding: 8px; border-bottom: 1px solid rgba(28,26,22,.14); font-weight: bold;">${notes.pole1 ? notes.pole1.toFixed(2) + '"' : 'N/A'}</td>
                      </tr>
                      ` : ''}
                      <tr>
                          <td style="padding: 8px; border-bottom: 1px solid rgba(28,26,22,.14); color: #524e46;">${notes.shape === 'STRAIGHT' ? 'Main Wall C2C:' : 'Center Wall C2C:'}</td>
                          <td style="padding: 8px; border-bottom: 1px solid rgba(28,26,22,.14); font-weight: bold;">${notes.pole2 ? notes.pole2.toFixed(2) + '"' : 'N/A'}</td>
                      </tr>
                      ${notes.shape === 'MITERED' ? `
                      <tr>
                          <td style="padding: 8px; border-bottom: 1px solid rgba(28,26,22,.14); color: #524e46;">Right Wall C2C:</td>
                          <td style="padding: 8px; border-bottom: 1px solid rgba(28,26,22,.14); font-weight: bold;">${notes.pole3 ? notes.pole3.toFixed(2) + '"' : 'N/A'}</td>
                      </tr>
                      ` : ''}
                  </table>
              </div>
          `;
      }

      const html = `
        <html>
          <head>
            <title>${job.jobId} - Documents</title>
            <style>
              body { font-family: 'Inter', -apple-system, sans-serif; color: #1c1a16; margin: 0; padding: 0; background: #525659; }
              .page { background: #faf8f4; width: 8.5in; min-height: 11in; padding: 0.5in; margin: 0.25in auto; box-sizing: border-box; box-shadow: 0 0 10px rgba(0,0,0,0.5); position: relative; }
              @media print {
                  body { background: #fff; }
                  .page { margin: 0; border: none; box-shadow: none; width: 100%; min-height: auto; page-break-after: always; padding: 0.25in; }
              }
              .header { display: flex; justify-content: space-between; border-bottom: 1px solid rgba(28,26,22,.14); padding-bottom: 15px; margin-bottom: 30px; align-items: flex-end; }
              .brand { font-size: 28px; font-weight: 500; font-family: 'Cormorant Garamond', Georgia, serif; text-transform: uppercase; letter-spacing: 0.05em; line-height: 1; }
              .doc-type { font-size: 11px; font-family: 'IBM Plex Mono', monospace; color: #524e46; letter-spacing: .15em; text-transform: uppercase; }
              
              .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 40px; }
              .label { font-size: 10px; font-family: 'IBM Plex Mono', monospace; color: #524e46; text-transform: uppercase; letter-spacing: .1em; }
              .val { font-size: 14px; font-weight: 500; margin-top: 4px; display: block; }
              
              .split-layout { display: flex; gap: 30px; margin-bottom: 40px; align-items: flex-start; }
              .column-left { flex: 1.5; }
              .column-right { flex: 1; }

              .section-box { border: 1px solid rgba(28,26,22,.14); background: #fff; padding: 20px; margin-bottom: 20px; }
              .section-header { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 18px; margin-bottom: 15px; border-bottom: 1px solid rgba(28,26,22,.14); padding-bottom: 10px; }
              
              .row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid rgba(28,26,22,.08); font-size: 13px; }
              .row:last-child { border-bottom: none; }
              .row.total { font-weight: 500; font-size: 16px; border-top: 1px solid rgba(28,26,22,.14); border-bottom: none; margin-top: 10px; padding-top: 15px; }
              
              .signature-block { margin-top: 60px; display: flex; justify-content: space-between; gap: 30px; }
              .sig-line { flex: 1; border-top: 1px solid rgba(28,26,22,.14); padding-top: 8px; font-size: 10px; font-family: 'IBM Plex Mono', monospace; color: #524e46; text-align: left; text-transform: uppercase; letter-spacing: .1em; }
            </style>
          </head>
          <body>
            
            <div class="page">
                <div class="header">
                  <div class="brand">${activeBrand}</div>
                  <div class="doc-type">Quotation</div>
                </div>
                
                <div class="meta-grid">
                  <div><span class="label">Project / Sidemark</span><span class="val">${job.sidemark}</span></div>
                  <div><span class="label">Quote ID</span><span class="val">${job.jobId}</span></div>
                  <div><span class="label">Prepared For</span><span class="val">${job.customer?.name}</span></div>
                  <div><span class="label">Date</span><span class="val">${job.dateSaved}</span></div>
                </div>

                <div class="split-layout">
                    <div class="column-left">
                        <div class="section-box">
                            <div class="section-header">Configuration Details</div>
                            ${job.cpqData?.breakdown?.map(item => `
                                <div class="row" style="${item.isHeader ? 'font-weight: bold; background: #f4f0e6; padding: 8px;' : ''}">
                                    <span style="flex: 3;">${item.name}</span>
                                    <span style="flex: 1; text-align: center; color: #524e46;">${item.isHeader ? '' : `Qty: ${item.qty}`}</span>
                                    <span style="flex: 1; text-align: right;">$${item.total.toFixed(2)}</span>
                                </div>
                            `).join('')}
                            <div class="row total">
                                <span style="flex: 4; text-align: right; padding-right: 20px; font-family: 'Cormorant Garamond', serif;">Total Estimate</span>
                                <span style="flex: 1; text-align: right;">$${job.cpqData?.totalPrice?.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>
                    <div class="column-right">
                        ${mathSection}
                    </div>
                </div>

                <div class="signature-block">
                    <div class="sig-line">Client Approval</div>
                    <div class="sig-line" style="max-width: 200px;">Date</div>
                </div>
            </div>

            <div class="page">
                <div class="header">
                  <div class="brand">${activeBrand}</div>
                  <div class="doc-type">Factory Router</div>
                </div>
                
                <div class="meta-grid">
                  <div><span class="label">Project / Sidemark</span><span class="val">${job.sidemark}</span></div>
                  <div><span class="label">Work Order ID</span><span class="val">${job.jobId}</span></div>
                </div>

                <div class="split-layout">
                    <div class="column-left">
                        <div class="section-box">
                            <div class="section-header">Bill of Materials</div>
                            <div class="row" style="color: #524e46; font-family: 'IBM Plex Mono', monospace; font-size: 10px; text-transform: uppercase;">
                                <span style="flex: 3;">Component</span>
                                <span style="flex: 1; text-align: right;">Req. Qty</span>
                            </div>
                            ${job.cpqData?.breakdown?.map(item => `
                                <div class="row" style="${item.isHeader ? 'font-weight: bold; background: #f4f0e6; padding: 8px;' : ''}">
                                    <span style="flex: 3; font-weight: 500;">${item.name}</span>
                                    <span style="flex: 1; text-align: right; font-size: 14px; font-weight: 500;">${item.isHeader ? '' : item.qty}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    <div class="column-right">
                        ${mathSection}
                    </div>
                </div>
            </div>
            
            ${draftSvg ? `
            <div class="page">
                <div class="header">
                  <div class="brand">${activeBrand}</div>
                  <div class="doc-type">Engineering Drawing</div>
                </div>
                <div class="meta-grid">
                  <div><span class="label">Sidemark</span><span class="val">${job.sidemark}</span></div>
                  <div><span class="label">Quote ID</span><span class="val">${job.jobId}</span></div>
                </div>
                <div style="width: 100%; border: 1px solid rgba(28,26,22,.14); background: #fff; padding: 20px; margin-top: 20px; box-sizing: border-box;">
                    ${draftSvg}
                </div>
                <div class="signature-block">
                    <div class="sig-line">Fabrication Sign-Off</div>
                    <div class="sig-line" style="max-width: 200px;">Date</div>
                </div>
            </div>
            ` : ''}

            <script> 
                window.onload = function() { 
                    setTimeout(() => window.print(), 500); 
                } 
            </script>
          </body>
        </html>
      `;
      printWindow.document.write(html);
      printWindow.document.close();
  };

  const renderOptionPrice = (opt, currentStep) => {
      const allParts = [...libraryParts, ...liveAssemblies];
      const partObj = allParts.find(p => p.id === opt.id) || 
                      dynamicAssets.find(a => a.id === opt.id) ||
                      globalFinishes.find(f => f.id === opt.id) ||
                      outsourceFinishes.find(f => f.id === opt.id);
      
      let nativeP = 0;
      if (partObj) {
          if (partObj.manufacturingSpecs?.basePrice) nativeP = parseFloat(partObj.manufacturingSpecs.basePrice);
          else if (partObj.basePrice) nativeP = parseFloat(partObj.basePrice);
      }

      if (currentStep.useClientPricing && jobData.customerId && partObj?.clientPricing) {
          const cp = partObj.clientPricing.find(c => c.customerId === jobData.customerId);
          if (cp && cp.price !== undefined && cp.price !== "") nativeP = parseFloat(cp.price);
      }

      let upP = currentStep.priceMap?.[opt.id] ? parseFloat(currentStep.priceMap[opt.id]) : 0;
      let finalP = nativeP + upP;

      if (currentStep.priceOverride !== undefined && currentStep.priceOverride !== "") {
          finalP = parseFloat(currentStep.priceOverride);
      }

      if (finalP > 0) return ` (+$${finalP.toFixed(2)})`;
      return '';
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
              const allParts = [...libraryParts, ...liveAssemblies];
              const libPart = allParts.find(p => p.id === valueId);
              if (libPart) { foundAsset = libPart; zIdx = parseInt(libPart.manufacturingSpecs?.layeringSequence) || 10; }
          }
          if (foundAsset) {
              const tex = foundAsset.textureUrl || foundAsset.finalImageUrl;
              if (tex) layers.push({ textureUrl: tex, zIndex: zIdx, name: foundAsset.itemName || foundAsset.name });
          }
      });
      return layers.sort((a, b) => a.zIndex - b.zIndex);
  };

  const textureOverrides = useMemo(() => {
      if (!activeFlow) return {};
      const overrides = {};
      
      activeFlow.steps?.forEach(step => {
          const selectedValueId = dynamicConfigParams[step.id];
          if (selectedValueId && step.targetNodes) {
              const allF = [...globalFinishes, ...outsourceFinishes];
              const dynamicF = dynamicAssets;
              const fData = allF.find(f => f.id === selectedValueId) || dynamicF.find(d => d.id === selectedValueId);
              
              if (fData?.textureUrl) overrides[step.targetNodes] = fData.textureUrl;
          }
      });
      return overrides;
  }, [dynamicConfigParams, activeFlow, globalFinishes, outsourceFinishes, dynamicAssets]);

  const visibilityOverrides = useMemo(() => {
      if (!activeFlow) return {};
      const overrides = {};
      
      activeFlow.steps?.forEach(step => {
          const selectedValueId = dynamicConfigParams[step.id];
          if (selectedValueId && step.geometryMap && Object.keys(step.geometryMap).length > 0) {
              Object.keys(step.geometryMap).forEach(optId => {
                  const targetMesh = step.geometryMap[optId];
                  if (targetMesh) overrides[targetMesh] = (optId === selectedValueId);
              });
          }
      });
      return overrides;
  }, [dynamicConfigParams, activeFlow]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', fontFamily: 'var(--sans)', backgroundColor: 'transparent', minHeight: '100vh' }}>
      
      {/* HEADER */}
      <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: '4px' }}>Parametric Pricing & Visualization</span>
            <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>Configure, Price, Quote (CPQ)</h2>
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <div style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, background: 'var(--paper-2)', padding: '12px 24px', border: '1px solid var(--line)', color: 'var(--ink)' }}>
                Config Total: ${(pricing.finalPrice * assemblyQty).toFixed(2)}
            </div>
            <button onClick={() => setShowCheckoutModal(true)} disabled={cart.length === 0} style={{ padding: '16px 24px', background: cart.length > 0 ? 'var(--brass)' : 'var(--paper)', color: cart.length > 0 ? '#fff' : 'var(--ink-soft)', border: 'none', cursor: cart.length > 0 ? 'pointer' : 'not-allowed', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>
                Checkout ({cart.length} Items)
            </button>
            <button onClick={() => setShowCloneModal(true)} style={{ padding: '16px 24px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Resume Draft</button>
            <button onClick={() => { setActiveFlowId(""); setDynamicConfigParams({}); setStepQuantities({}); setDimensionInputs({}); setCurrentStepIndex(0); setActiveAssemblyId(""); setProductType(""); setActiveDraftId(null); setActiveDraftSvg(null); setCart([]); localStorage.removeItem('hq_global_cart'); setAssemblyQty(1); setActiveMasterQuoteId(null); setJobData({ customerId: '', jobName: '', sidemark: '', shippingMethod: 'SAVED', shippingAddressId: '', customShippingAddress: { attention: '', addressee: '', addr1: '', addr2: '', city: '', state: '', zip: '', country: 'US' } }); }} style={{ padding: '16px 24px', background: 'transparent', color: 'var(--ink-soft)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }} onMouseOver={e => e.currentTarget.style.color='var(--ink)'} onMouseOut={e => e.currentTarget.style.color='var(--ink-soft)'}>Clear All</button>
        </div>
      </div>

      <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', display: 'flex', alignItems: 'center', gap: '20px', borderRadius: '2px', boxShadow: '0 2px 8px rgba(0,0,0,0.02)', opacity: activeMasterQuoteId ? 0.6 : 1, pointerEvents: activeMasterQuoteId ? 'none' : 'auto' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', letterSpacing: '.1em' }}>Active Customer:</div>
          <select 
              value={jobData.customerId} 
              onChange={e => setJobData({...jobData, customerId: e.target.value})} 
              style={{ flex: 1, padding: '12px', fontSize: '0.95rem', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', background: activeMasterQuoteId ? 'transparent' : 'var(--paper)', cursor: activeMasterQuoteId ? 'not-allowed' : 'pointer' }}
              disabled={!!activeMasterQuoteId}
          >
              <option value="">-- Select Customer to Activate Live Client Pricing --</option>
              {combinedCustomers.map(c => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
          </select>
          {activeMasterQuoteId ? (
              <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)' }}>Locked by active Global Job: {activeMasterQuoteId}</span>
          ) : (
              !jobData.customerId && <span style={{ fontSize: '0.85rem', color: 'var(--brass)', fontStyle: 'italic', fontFamily: 'var(--serif)' }}>Base MSRP will be shown until customer is selected.</span>
          )}
      </div>

      <div style={{ display: 'flex', gap: '24px', alignItems: 'stretch' }}>
          
          <div style={{ width: '400px', display: 'flex', flexDirection: 'column', gap: '24px', flexShrink: 0 }}>
              
              <div style={{ background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                 <div style={{ padding: '16px 20px', background: 'var(--paper-2)', color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', borderBottom: '1px solid var(--line)' }}>Step 1: Select Flow</div>
                 <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    
                    {cpqFlows.length > 0 && (
                        <select value={activeFlowId} onChange={(e) => { setActiveFlowId(e.target.value); setCurrentStepIndex(0); setDynamicConfigParams({}); setStepQuantities({}); setDimensionInputs({}); setProductType(''); setActiveAssemblyId(''); setActiveDraftId(null); setActiveDraftSvg(null); setAssemblyQty(1); }} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none' }}>
                            <option value="">-- Launch Custom CPQ Flow --</option>
                            {cpqFlows.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                    )}

                    {!activeFlowId && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '10px' }}>
                            <div style={{ width: '100%', fontSize: '0.85rem', color: 'var(--ink-soft)' }}>Or Select Standard Category:</div>
                            <select value={productType} onChange={(e) => {setProductType(e.target.value); setActiveAssemblyId('');}} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none' }}>
                                <option value="">-- Select Product Category --</option>
                                {availableProductTypes.map(pt => <option key={pt} value={pt}>{pt}</option>)}
                            </select>
                        </div>
                    )}
                 </div>
              </div>

              {activeFlow && currentStep && (
                  <div style={{ background: '#fff', border: '1px solid var(--brass)', display: 'flex', flexDirection: 'column', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', flex: 1 }}>
                      <div style={{ padding: '20px 24px', background: 'var(--paper)', color: 'var(--ink)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500 }}>Step {currentStepIndex + 1} of {activeFlow.steps.length}: {currentStep.title}</span>
                          {(currentStep.basePrice !== undefined && currentStep.basePrice !== null && currentStep.basePrice !== '') && (
                              <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', border: '1px solid var(--line)', padding: '4px 8px' }}>
                                  Base: ${parseFloat(currentStep.basePrice).toFixed(2)}
                              </span>
                          )}
                      </div>
                      
                      <div style={{ padding: '24px', flex: 1, overflowY: 'auto', maxHeight: '400px' }}>
                          
                          {(currentStep.type === 'VISUAL_GRID' || currentStep.type === 'VISUAL_DIMENSIONS') && (
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                                  {getOptionsForStep(currentStep).map(opt => (
                                      <div key={opt.id} onClick={() => handleParamChange(currentStep.id, opt.id)} style={{ border: `1px solid ${dynamicConfigParams[currentStep.id] === opt.id ? 'var(--brass)' : 'var(--line)'}`, padding: '12px', textAlign: 'center', cursor: 'pointer', background: dynamicConfigParams[currentStep.id] === opt.id ? 'var(--paper-2)' : '#fff', transition: 'all 0.2s' }}>
                                          <div style={{ width: '100%', height: '80px', background: opt.finalImageUrl ? `url(${opt.finalImageUrl}) center/cover` : 'var(--paper-2)', marginBottom: '12px' }} />
                                          <div style={{ fontSize: '0.85rem', color: 'var(--ink)' }}>{opt.itemName}<span style={{color: 'var(--ink-soft)'}}>{renderOptionPrice(opt, currentStep)}</span></div>
                                      </div>
                                  ))}
                              </div>
                          )}

                          {currentStep.type === 'DROPDOWN' && currentStep.dataSource && (
                              <select value={dynamicConfigParams[currentStep.id] || ''} onChange={(e) => handleParamChange(currentStep.id, e.target.value)} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', fontSize: '0.95rem', fontFamily: 'var(--sans)', marginBottom: '20px', outline: 'none' }}>
                                  <option value="">-- Select Option --</option>
                                  {getOptionsForStep(currentStep).map(opt => (
                                      <option key={opt.id} value={opt.id}>{opt.itemName}{renderOptionPrice(opt, currentStep)}</option>
                                  ))}
                              </select>
                          )}

                          {currentStep.type === 'STATIC_FEE' && (
                              <div style={{ padding: '24px', background: 'var(--paper)', border: '1px dashed var(--line)', textAlign: 'center', marginBottom: '20px' }}>
                                  <div style={{ fontFamily: 'var(--serif)', fontSize: '1.6rem', color: 'var(--ink)' }}>
                                      {(currentStep.priceOverride || currentStep.basePrice) ? `+$${parseFloat(currentStep.priceOverride || currentStep.basePrice).toFixed(2)} ea` : 'Variable Fee'}
                                  </div>
                                  <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '8px' }}>
                                      Adjust step quantity below to calculate total fee.
                                  </div>
                              </div>
                          )}

                          {(currentStep.calculatorTemplate || currentStep.type === 'DIMENSIONS' || currentStep.type === 'VISUAL_DIMENSIONS') && (
                              <div style={{ padding: '20px', background: activeDraftSvg ? '#eef0f2' : 'var(--paper-2)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)', marginBottom: '20px', opacity: activeDraftSvg ? 0.7 : 1 }}>
                                  <h4 style={{ margin: '0 0 16px 0', fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500 }}>Dimensional Input</h4>
                                  {activeDraftSvg && <div style={{ fontSize: '10px', fontFamily: 'var(--mono)', color: 'var(--brass)', textTransform: 'uppercase', marginBottom: '12px' }}>Locked (Controlled by Vision Tool)</div>}
                                  
                                  {(currentStep.calculatorTemplate === 'calc_french_return_1in' || currentStep.calculatorTemplate === 'calc_straight_pole' || currentStep.calculatorTemplate === 'calc_curved_bay') && (
                                      <div style={{ display: 'flex', gap: '16px' }}>
                                          {currentStep.calculatorTemplate !== 'calc_straight_pole' && (
                                              <div style={{ flex: 1 }}>
                                                  <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Measurement Type</label>
                                                  <select 
                                                      value={dimensionInputs[currentStep.id]?.type || 'O2O'} 
                                                      onChange={(e) => handleDimensionChange(currentStep.id, 'type', e.target.value, currentStep.calculatorTemplate)}
                                                      disabled={!!activeDraftSvg}
                                                      style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', cursor: activeDraftSvg ? 'not-allowed' : 'pointer', background: activeDraftSvg ? 'transparent' : '#fff' }}
                                                  >
                                                      <option value="O2O">A. Outside Edge to Outside Edge (O2O)</option>
                                                      <option value="C2C">B. Center to Center (C2C)</option>
                                                  </select>
                                              </div>
                                          )}
                                          <div style={{ flex: 1 }}>
                                              <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Finished Length (in)</label>
                                              <input 
                                                  type="number" min="0" placeholder="e.g. 84"
                                                  value={dimensionInputs[currentStep.id]?.length || ''} 
                                                  onChange={(e) => handleDimensionChange(currentStep.id, 'length', e.target.value, currentStep.calculatorTemplate)}
                                                  disabled={!!activeDraftSvg}
                                                  style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', boxSizing: 'border-box', outline: 'none', fontFamily: 'var(--sans)', cursor: activeDraftSvg ? 'not-allowed' : 'text', background: activeDraftSvg ? 'transparent' : '#fff' }}
                                              />
                                          </div>
                                      </div>
                                  )}

                                  {currentStep.calculatorTemplate === 'calc_mitered_bay' && (
                                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                                          <div>
                                              <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Wall A (Left)</label>
                                              <input type="number" min="0" placeholder="Inches" value={dimensionInputs[currentStep.id]?.wallA || ''} onChange={(e) => handleDimensionChange(currentStep.id, 'wallA', e.target.value, currentStep.calculatorTemplate)} disabled={!!activeDraftSvg} style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', boxSizing: 'border-box', outline: 'none', cursor: activeDraftSvg ? 'not-allowed' : 'text', background: activeDraftSvg ? 'transparent' : '#fff' }} />
                                          </div>
                                          <div>
                                              <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Wall B (Center)</label>
                                              <input type="number" min="0" placeholder="Inches" value={dimensionInputs[currentStep.id]?.wallB || ''} onChange={(e) => handleDimensionChange(currentStep.id, 'wallB', e.target.value, currentStep.calculatorTemplate)} disabled={!!activeDraftSvg} style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', boxSizing: 'border-box', outline: 'none', cursor: activeDraftSvg ? 'not-allowed' : 'text', background: activeDraftSvg ? 'transparent' : '#fff' }} />
                                          </div>
                                          <div>
                                              <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Wall C (Right)</label>
                                              <input type="number" min="0" placeholder="Inches" value={dimensionInputs[currentStep.id]?.wallC || ''} onChange={(e) => handleDimensionChange(currentStep.id, 'wallC', e.target.value, currentStep.calculatorTemplate)} disabled={!!activeDraftSvg} style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', boxSizing: 'border-box', outline: 'none', cursor: activeDraftSvg ? 'not-allowed' : 'text', background: activeDraftSvg ? 'transparent' : '#fff' }} />
                                          </div>
                                      </div>
                                  )}

                                  {dimensionInputs[currentStep.id]?.length > 0 && currentStep.calculatorTemplate === 'calc_french_return_1in' && (
                                      <div style={{ marginTop: '16px', fontSize: '0.85rem', color: 'var(--ink-soft)', background: '#fff', padding: '16px', border: '1px solid var(--line)' }}>
                                          <strong style={{display:'block', marginBottom:'8px', color:'var(--ink)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase'}}>Math Logic (1" French Return)</strong> 
                                          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'12px', marginBottom:'12px'}}>
                                              <div style={{background:'var(--paper)', padding:'8px', textAlign:'center', border: '1px solid var(--line)'}}>O2O: {dimensionInputs[currentStep.id].calc_o2o}"</div>
                                              <div style={{background:'var(--paper)', padding:'8px', textAlign:'center', border: '1px solid var(--line)'}}>C2C: {dimensionInputs[currentStep.id].calc_c2c}"</div>
                                              <div style={{background:'var(--paper)', padding:'8px', textAlign:'center', color:'var(--ink)', border:'1px solid var(--brass)'}}>CUT LENGTH: {dimensionInputs[currentStep.id].calc_cutLength}"</div>
                                          </div>
                                          Calculated Purchase Quantity: <strong>{stepQuantities[currentStep.id] || 1} Feet</strong>.
                                      </div>
                                  )}
                              </div>
                          )}
                      </div>

                      <div style={{ padding: '20px 24px', background: 'var(--paper)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ color: 'var(--ink-soft)', flex: 1, paddingRight: '20px' }}>
                              <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink)', display: 'block', marginBottom: '4px' }}>Step Quantity</span>
                              <span style={{ fontSize: '0.85rem' }}>{currentStep.qtyHelperText || 'Adjust to multiply option logic.'}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                              <button onClick={() => {
                                  let current = stepQuantities[currentStep.id];
                                  if (current === undefined || current === '') current = activeBomPins.find(p => p.partId === currentStep.linkedPinId)?.defaultQty || 1;
                                  else current = parseInt(current);
                                  setStepQuantities({...stepQuantities, [currentStep.id]: Math.max(0, current - 1)});
                              }} style={{ width: '36px', height: '36px', background: '#fff', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer', fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>-</button>
                              
                              <input 
                                  type="number" 
                                  min="0" 
                                  value={stepQuantities[currentStep.id] !== undefined ? stepQuantities[currentStep.id] : (activeBomPins.find(p => p.partId === currentStep.linkedPinId)?.defaultQty || 1)} 
                                  onChange={e => {
                                      const val = e.target.value;
                                      setStepQuantities({...stepQuantities, [currentStep.id]: val === '' ? '' : parseInt(val)});
                                  }} 
                                  style={{ width: '60px', padding: '8px', border: '1px solid var(--line)', textAlign: 'center', fontSize: '1.1rem', fontFamily: 'var(--sans)', outline: 'none' }} 
                              />
                              
                              <button onClick={() => {
                                  let current = stepQuantities[currentStep.id];
                                  if (current === undefined || current === '') current = activeBomPins.find(p => p.partId === currentStep.linkedPinId)?.defaultQty || 1;
                                  else current = parseInt(current);
                                  setStepQuantities({...stepQuantities, [currentStep.id]: current + 1});
                              }} style={{ width: '36px', height: '36px', background: '#fff', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer', fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                          </div>
                      </div>

                      {engineFlags.warnings.length > 0 && (
                           <div style={{ background: 'var(--paper-2)', borderTop: '1px solid var(--brass)', padding: '16px 24px' }}>
                               {engineFlags.warnings.map((log, i) => <div key={i} style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)' }}>{log}</div>)}
                           </div>
                      )}

                      <div style={{ padding: '24px', display: 'flex', justifyContent: 'space-between', background: '#fff' }}>
                          <button onClick={() => setCurrentStepIndex(Math.max(0, currentStepIndex - 1))} disabled={currentStepIndex === 0} style={{ padding: '12px 24px', border: '1px solid var(--line)', background: 'transparent', color: currentStepIndex === 0 ? 'var(--line)' : 'var(--ink)', cursor: currentStepIndex === 0 ? 'not-allowed' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Back</button>
                          
                          {currentStepIndex < activeFlow.steps.length - 1 ? (
                              <button onClick={handleNextStep} disabled={currentStep.required && !dynamicConfigParams[currentStep.id] && currentStep.type !== 'DIMENSIONS' && currentStep.type !== 'STATIC_FEE'} style={{ padding: '12px 24px', border: 'none', background: currentStep.required && !dynamicConfigParams[currentStep.id] && currentStep.type !== 'DIMENSIONS' && currentStep.type !== 'STATIC_FEE' ? 'var(--line)' : 'var(--ink)', color: '#fff', cursor: currentStep.required && !dynamicConfigParams[currentStep.id] && currentStep.type !== 'DIMENSIONS' && currentStep.type !== 'STATIC_FEE' ? 'not-allowed' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'background 0.2s' }}>Next Step</button>
                          ) : (
                              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                  <span style={{ fontSize: '10px', fontFamily: 'var(--mono)', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Total QTY:</span>
                                  <input type="number" min="1" value={assemblyQty} onChange={e => setAssemblyQty(parseInt(e.target.value)||1)} style={{ width: '60px', padding: '8px', border: '1px solid var(--line)', outline: 'none' }} />
                                  <button onClick={handleAddToCart} disabled={currentStep.required && !dynamicConfigParams[currentStep.id] && currentStep.type !== 'DIMENSIONS' && currentStep.type !== 'STATIC_FEE'} style={{ padding: '12px 24px', border: 'none', background: currentStep.required && !dynamicConfigParams[currentStep.id] && currentStep.type !== 'DIMENSIONS' && currentStep.type !== 'STATIC_FEE' ? 'var(--line)' : 'var(--brass)', color: '#fff', cursor: currentStep.required && !dynamicConfigParams[currentStep.id] && currentStep.type !== 'DIMENSIONS' && currentStep.type !== 'STATIC_FEE' ? 'not-allowed' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'background 0.2s' }}>Add to Quote Cart</button>
                              </div>
                          )}
                      </div>
                  </div>
              )}

              {!activeFlowId && productType && (
                 <div style={{ background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                    <div style={{ padding: '16px 20px', background: 'var(--paper-2)', color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', borderBottom: '1px solid var(--line)' }}>Step 2: Select Approved Design</div>
                    <div style={{ padding: '24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '16px', maxHeight: '300px', overflowY: 'auto' }}>
                       {availableAssemblies.length === 0 ? <span style={{ fontSize: '0.9rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No approved assemblies found.</span> : (
                           availableAssemblies.map(asm => (
                              <button key={asm.id} onClick={() => setActiveAssemblyId(asm.id)} style={{ padding: '16px', background: activeAssemblyId === asm.id ? 'var(--paper-2)' : '#fff', color: 'var(--ink)', border: `1px solid ${activeAssemblyId === asm.id ? 'var(--brass)' : 'var(--line)'}`, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', transition: 'all 0.2s' }}>
                                 <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>{asm.legacyErpId !== "PENDING" ? asm.legacyErpId : asm.itemId}</div>
                                 <div style={{ textAlign: 'center', fontFamily: 'var(--sans)', fontSize: '0.9rem' }}>{asm.itemName}</div>
                              </button>
                           ))
                       )}
                    </div>
                    {activeAssemblyId && (
                         <div style={{ padding: '20px 24px', borderTop: '1px solid var(--line)', background: '#fff' }}>
                             <button onClick={() => setShowCheckoutModal(true)} style={{ width: '100%', padding: '16px', border: 'none', background: 'var(--brass)', color: '#fff', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Finish Hardware Configuration</button>
                         </div>
                    )}
                 </div>
              )}
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px', minHeight: '800px' }}>
              <div style={{ flex: 1, background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
                  
                  <div style={{ padding: '20px 24px', background: 'var(--paper)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 999, borderBottom: '1px solid var(--line)' }}>
                      <div style={{ color: 'var(--ink)', fontSize: '1.2rem', fontFamily: 'var(--serif)', fontWeight: 500 }}>
                          Live {viewMode} Engine
                      </div>
                      <div style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: '2px', overflow: 'hidden', background: '#fff' }}>
                          <button onClick={() => setViewMode('2D')} style={{ padding: '8px 16px', background: viewMode === '2D' ? 'var(--ink)' : 'transparent', color: viewMode === '2D' ? '#fff' : 'var(--ink)', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', transition: 'all 0.2s' }}>2D</button>
                          <button onClick={() => setViewMode('3D')} disabled={!activeAssembly?.manufacturingSpecs?.cadUrl} style={{ padding: '8px 16px', background: viewMode === '3D' ? 'var(--ink)' : 'transparent', color: viewMode === '3D' ? '#fff' : 'var(--ink-soft)', border: 'none', cursor: activeAssembly?.manufacturingSpecs?.cadUrl ? 'pointer' : 'not-allowed', opacity: activeAssembly?.manufacturingSpecs?.cadUrl ? 1 : 0.5, fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', transition: 'all 0.2s' }}>3D</button>
                      </div>
                  </div>
                  
                  <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--paper-2)' }}>
                      {!activeAssembly ? (
                          <div style={{ color: 'var(--ink-soft)', textAlign: 'center', zIndex: 1 }}>
                              <div style={{ fontSize: '2rem', marginBottom: '16px', opacity: 0.5 }}>⚙️</div>
                              <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontWeight: 500, fontSize: '1.4rem' }}>Visual Engine Ready</h3>
                              <p style={{ fontSize: '0.9rem', maxWidth: '300px', margin: '12px auto' }}>Select a flow and assembly to begin configuration.</p>
                          </div>
                      ) : viewMode === '3D' ? (
                         <Canvas camera={{ position: [5, 5, 5], fov: 50 }} style={{ width: '100%', height: '100%' }}>
                              <ambientLight intensity={0.9} /> 
                              <directionalLight position={[5, 10, 5]} intensity={0.7} />
                              <Environment preset="warehouse" /> 
                              <ContactShadows position={[0, -0.5, 0]} opacity={0.5} scale={10} blur={2} far={4} />
                              <OrbitControls makeDefault />
                              <Bounds fit clip margin={1.2}>
                                  <DynamicModel 
                                      url={activeAssembly.manufacturingSpecs.cadUrl} 
                                      textureOverrides={textureOverrides} 
                                      visibilityOverrides={visibilityOverrides}
                                  />
                              </Bounds>
                          </Canvas>
                      ) : (
                          <div style={{ position: 'absolute', inset: '30px' }}>
                              {get2DRenderLayers().map((layer, idx) => (
                                  <div key={idx} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: layer.zIndex }}>
                                      {layer.textureUrl ? (
                                          <img src={layer.textureUrl} alt={layer.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                                      ) : (
                                          <div style={{ width: '100%', height: '100%', border: '1px dashed var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-soft)', fontFamily: 'var(--sans)', fontSize: '0.85rem', textAlign: 'center' }}>
                                              {layer.name}<br/>(Missing Asset)
                                          </div>
                                      )}
                                  </div>
                              ))}
                          </div>
                      )}
                      
                      {/* --- STATIC HARDWARE POST-IT OVERLAY --- */}
                      {activeDraftId && previousDrafts.find(d => d.id === activeDraftId)?.specs?.engineeringNotes && (
                          <div style={{
                              position: 'absolute', top: '24px', left: '24px', width: '280px',
                              background: '#fdfbf7', padding: '20px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
                              transform: 'rotate(1deg)', border: '1px solid var(--brass)', zIndex: 100,
                              color: 'var(--ink)', fontFamily: 'var(--sans)'
                          }}>
                              <div style={{ fontFamily: 'var(--serif)', fontWeight: 500, borderBottom: '1px solid var(--line)', paddingBottom: '10px', marginBottom: '16px', fontSize: '1.2rem', textAlign: 'center' }}>
                                  Engineering Specs
                                  <div style={{fontSize: '9px', fontFamily: 'var(--mono)', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', marginTop: '6px'}}>Manual Entry Required</div>
                              </div>
                              {(() => {
                                  const draft = previousDrafts.find(d => d.id === activeDraftId);
                                  const notes = draft.specs.engineeringNotes;
                                  return (
                                      <div style={{ fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                          {draft.jobName && <div><span style={{fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', marginRight: '6px'}}>JOB</span> {draft.jobName}</div>}
                                          {draft.sidemark && <div><span style={{fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', marginRight: '6px'}}>MARK</span> {draft.sidemark}</div>}
                                          
                                          <div style={{ background: '#fff', padding: '12px', border: '1px solid var(--line)', marginTop: '8px' }}>
                                              
                                              <div style={{ color: 'var(--ink)', fontSize: '0.85rem', marginBottom: '12px', borderBottom: '1px dashed var(--line)', paddingBottom: '10px' }}>
                                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}><span style={{color: 'var(--ink-soft)'}}>Pole O2O (Edge-to-Edge):</span> <span>{notes.poleO2O?.toFixed(2)}"</span></div>
                                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}><span style={{color: 'var(--ink-soft)'}}>Total System O2O:</span> <span>{notes.totalSystemO2O?.toFixed(2)}"</span></div>
                                                  
                                                  {notes.shape === 'MITERED' && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}><span style={{color: 'var(--ink-soft)'}}>Left Wall C2C:</span> <span>{notes.pole1?.toFixed(2)}"</span></div>}
                                                  
                                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}><span style={{color: 'var(--ink-soft)'}}>{notes.shape === 'STRAIGHT' ? 'Main Wall C2C:' : 'Center Wall C2C:'}</span> <span>{notes.pole2?.toFixed(2)}"</span></div>
                                                  
                                                  {notes.shape === 'MITERED' && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{color: 'var(--ink-soft)'}}>Right Wall C2C:</span> <span>{notes.pole3?.toFixed(2)}"</span></div>}
                                              </div>

                                              <div style={{ color: 'var(--ink)', fontWeight: 500, marginBottom: '12px', fontSize: '0.9rem', textAlign: 'center' }}>
                                                  Pole Qty (ft) to Enter: {notes.poleFeetQty}
                                              </div>
                                              
                                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', color: 'var(--ink-soft)' }}>
                                                {notes.qtyBrackets > 0 && <div>Brackets: {notes.qtyBrackets}</div>}
                                                {notes.recRings > 0 && <div>Rings (Rec): {notes.recRings}</div>}
                                                {notes.qtyFinials > 0 && <div>Finials: {notes.qtyFinials}</div>}
                                              </div>
                                          </div>

                                          {(notes.qtySplices > 0 || notes.qtyBends > 0 || notes.qtyMiters > 0 || notes.qtyMiterReturns > 0) && (
                                              <div style={{ background: 'var(--paper-2)', padding: '12px', border: '1px solid var(--line)', marginTop: '8px' }}>
                                                  <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink)', display: 'block', marginBottom: '8px' }}>Fees to Add</span>
                                                  {notes.qtySplices > 0 && <div>• Splice Fee: x{notes.qtySplices}</div>}
                                                  {notes.qtyBends > 0 && <div>• Bent Return Fee: x{notes.qtyBends}</div>}
                                                  {notes.qtyMiters > 0 && <div>• Miter Cut Fee: x{notes.qtyMiters}</div>}
                                                  {notes.qtyMiterReturns > 0 && <div>• Miter Return Fee: x{notes.qtyMiterReturns}</div>}
                                              </div>
                                          )}
                                      </div>
                                  )
                              })()}
                          </div>
                      )}

                  </div>
              </div>

              <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '30px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                  <div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: '8px' }}>Estimated Unit Price</div>
                      <div style={{ fontFamily: 'var(--serif)', fontSize: '2.4rem', fontWeight: 500, color: 'var(--ink)' }}>${pricing.finalPrice.toFixed(2)}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'right', fontSize: '0.85rem', maxWidth: '350px' }}>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', borderBottom: '1px solid var(--line)', paddingBottom: '6px', marginBottom: '6px', color: 'var(--ink)' }}>Pricing Breakdown</div>
                      <div style={{ maxHeight: '80px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px', paddingRight: '10px' }}>
                          {pricingBreakdown.map((item, i) => (
                              <div key={i} style={{ display: 'flex', justifyContent: 'flex-end', gap: '20px' }}>
                                  <span style={{ color: 'var(--ink-soft)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' }}>{item.name} (x{item.qty})</span>
                                  <span style={{ color: 'var(--ink)', minWidth: '60px' }}>${item.total.toFixed(2)}</span>
                              </div>
                          ))}
                      </div>
                      <div style={{ borderTop: '1px solid var(--line)', marginTop: '6px', paddingTop: '8px', fontSize: '0.9rem', color: 'var(--ink-soft)' }}>
                          Total Dynamic Sum: <span style={{ color: 'var(--ink)', marginLeft: '8px' }}>${pricing.base.toFixed(2)}</span>
                      </div>
                  </div>
              </div>
          </div>
      </div>

      {showCartSuccessModal && (
          <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
              <div style={{ background: '#fff', width: '450px', padding: '30px', borderRadius: '4px', boxShadow: '0 12px 48px rgba(0,0,0,0.2)', textAlign: 'center' }}>
                  <div style={{ fontSize: '3rem', marginBottom: '16px' }}>✅</div>
                  <h2 style={{ margin: '0 0 12px 0', fontFamily: 'var(--serif)', fontSize: '1.8rem', color: 'var(--ink)' }}>Added to Quote Cart</h2>
                  <p style={{ fontSize: '1rem', color: 'var(--ink-soft)', marginBottom: '30px', lineHeight: '1.5' }}>
                      Your configured assembly has been saved to the cart. What would you like to do next?
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <button onClick={() => setShowCartSuccessModal(false)} style={{ padding: '16px', background: 'var(--paper-2)', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>
                          Configure Another Item Here
                      </button>
                      <button onClick={() => {
                          setShowCartSuccessModal(false);
                          window.dispatchEvent(new CustomEvent('NAVIGATE_TAB', { detail: 'VISION' }));
                      }} style={{ padding: '16px', background: 'var(--ink)', border: 'none', color: '#fff', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>
                          Draw Next Item in Vision Tool
                      </button>
                      <button onClick={() => { setShowCartSuccessModal(false); setShowCheckoutModal(true); }} style={{ padding: '16px', background: 'var(--brass)', border: 'none', color: '#fff', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s', marginTop: '12px' }}>
                          Proceed to Checkout
                      </button>
                  </div>
              </div>
          </div>
      )}

      {showCheckoutModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
            <div style={{ background: '#fff', border: '1px solid var(--line)', width: '550px', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 48px rgba(0,0,0,0.1)', borderRadius: '2px' }}>
                <div style={{ padding: '24px 30px', background: 'var(--paper-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
                    <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)' }}>Finalize & Assign Quote</h2>
                    <button onClick={() => setShowCheckoutModal(false)} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', fontSize: '1.5rem', cursor: 'pointer' }}>×</button>
                </div>
                
                <div style={{ padding: '30px', flex: 1, display: 'flex', flexDirection: 'column', gap: '24px', maxHeight: '80vh', overflowY: 'auto' }}>
                    
                    <div style={{ padding: '24px', background: 'var(--paper)', border: '1px solid var(--line)', textAlign: 'center' }}>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: '8px' }}>Cart Total ({cart.length} Items)</div>
                        <div style={{ fontFamily: 'var(--serif)', fontSize: '2.4rem', fontWeight: 500, color: 'var(--ink)' }}>
                            ${cart.reduce((sum, item) => sum + (item.pricing.finalPrice * item.qty), 0).toFixed(2)}
                        </div>
                    </div>

                    <div>
                        <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>* Verify Customer</label>
                        <select value={jobData.customerId} onChange={e => setJobData({...jobData, customerId: e.target.value})} disabled={!!activeMasterQuoteId} style={{ width: '100%', padding: '12px', fontSize: '1rem', border: '1px solid var(--line)', outline: 'none', background: activeMasterQuoteId ? 'transparent' : '#fff', fontFamily: 'var(--sans)', cursor: activeMasterQuoteId ? 'not-allowed' : 'pointer' }}>
                            <option value="">-- Choose Customer --</option>
                            {combinedCustomers.map(c => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
                        </select>
                    </div>

                    {jobData.customerId && (
                        <div style={{ background: '#fff', padding: '24px', border: '1px solid var(--line)' }}>
                            <h4 style={{ margin: '0 0 16px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500 }}>Shipping Destination</h4>
                            
                            <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', pointerEvents: activeMasterQuoteId ? 'none' : 'auto', opacity: activeMasterQuoteId ? 0.6 : 1 }}>
                                <button 
                                    onClick={() => {
                                        const cust = combinedCustomers.find(c => c.id === jobData.customerId);
                                        const defaultId = cust?.shippingAddresses?.[0]?.addressBookId || '';
                                        setJobData({...jobData, shippingMethod: 'SAVED', shippingAddressId: defaultId});
                                    }} 
                                    style={{ flex: 1, padding: '12px', background: jobData.shippingMethod === 'SAVED' ? 'var(--ink)' : '#fff', color: jobData.shippingMethod === 'SAVED' ? '#fff' : 'var(--ink)', border: '1px solid var(--ink)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}
                                >
                                    Saved Addresses
                                </button>
                                <button 
                                    onClick={() => setJobData({...jobData, shippingMethod: 'CUSTOM', shippingAddressId: ''})} 
                                    style={{ flex: 1, padding: '12px', background: jobData.shippingMethod === 'CUSTOM' ? 'var(--ink)' : '#fff', color: jobData.shippingMethod === 'CUSTOM' ? '#fff' : 'var(--ink)', border: '1px solid var(--ink)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}
                                >
                                    Custom Drop-Ship
                                </button>
                            </div>

                            {jobData.shippingMethod === 'SAVED' ? (
                                <div>
                                    {(!combinedCustomers.find(c => c.id === jobData.customerId)?.shippingAddresses?.length) ? (
                                        <div style={{ color: 'var(--ink-soft)', fontSize: '0.9rem', fontStyle: 'italic', padding: '16px', background: 'var(--paper)', border: '1px solid var(--line)' }}>
                                            No synced NetSuite addresses found for this customer. Please use Custom Drop-Ship.
                                        </div>
                                    ) : (
                                        <select 
                                            value={jobData.shippingAddressId} 
                                            onChange={e => setJobData({...jobData, shippingAddressId: e.target.value})}
                                            disabled={!!activeMasterQuoteId}
                                            style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none', background: activeMasterQuoteId ? 'transparent' : '#fff', cursor: activeMasterQuoteId ? 'not-allowed' : 'pointer' }}
                                        >
                                            <option value="">-- Select Saved Address --</option>
                                            {combinedCustomers.find(c => c.id === jobData.customerId)?.shippingAddresses.map(addr => (
                                                <option key={addr.addressBookId} value={addr.addressBookId}>
                                                    {addr.label} - {addr.addr1}, {addr.city} {addr.state}
                                                </option>
                                            ))}
                                        </select>
                                    )}
                                </div>
                            ) : (
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', opacity: activeMasterQuoteId ? 0.6 : 1 }}>
                                    <div style={{ gridColumn: 'span 2' }}>
                                        <input disabled={!!activeMasterQuoteId} placeholder="Attention / Contact Name" value={jobData.customShippingAddress.attention} onChange={e => setJobData({...jobData, customShippingAddress: {...jobData.customShippingAddress, attention: e.target.value}})} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--sans)', outline: 'none', background: activeMasterQuoteId ? 'transparent' : '#fff' }} />
                                    </div>
                                    <div style={{ gridColumn: 'span 2' }}>
                                        <input disabled={!!activeMasterQuoteId} placeholder="Addressee / Company Name" value={jobData.customShippingAddress.addressee} onChange={e => setJobData({...jobData, customShippingAddress: {...jobData.customShippingAddress, addressee: e.target.value}})} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--sans)', outline: 'none', background: activeMasterQuoteId ? 'transparent' : '#fff' }} />
                                    </div>
                                    <div style={{ gridColumn: 'span 2' }}>
                                        <input disabled={!!activeMasterQuoteId} placeholder="Street Address 1" value={jobData.customShippingAddress.addr1} onChange={e => setJobData({...jobData, customShippingAddress: {...jobData.customShippingAddress, addr1: e.target.value}})} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--sans)', outline: 'none', background: activeMasterQuoteId ? 'transparent' : '#fff' }} />
                                    </div>
                                    <div style={{ gridColumn: 'span 2' }}>
                                        <input disabled={!!activeMasterQuoteId} placeholder="Street Address 2 (Suite, Unit, etc.)" value={jobData.customShippingAddress.addr2} onChange={e => setJobData({...jobData, customShippingAddress: {...jobData.customShippingAddress, addr2: e.target.value}})} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--sans)', outline: 'none', background: activeMasterQuoteId ? 'transparent' : '#fff' }} />
                                    </div>
                                    <div>
                                        <input disabled={!!activeMasterQuoteId} placeholder="City" value={jobData.customShippingAddress.city} onChange={e => setJobData({...jobData, customShippingAddress: {...jobData.customShippingAddress, city: e.target.value}})} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--sans)', outline: 'none', background: activeMasterQuoteId ? 'transparent' : '#fff' }} />
                                    </div>
                                    <div style={{ display: 'flex', gap: '12px' }}>
                                        <input disabled={!!activeMasterQuoteId} placeholder="State" value={jobData.customShippingAddress.state} onChange={e => setJobData({...jobData, customShippingAddress: {...jobData.customShippingAddress, state: e.target.value}})} style={{ flex: 1, padding: '12px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--sans)', outline: 'none', background: activeMasterQuoteId ? 'transparent' : '#fff' }} />
                                        <input disabled={!!activeMasterQuoteId} placeholder="Zip" value={jobData.customShippingAddress.zip} onChange={e => setJobData({...jobData, customShippingAddress: {...jobData.customShippingAddress, zip: e.target.value}})} style={{ flex: 1, padding: '12px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--sans)', outline: 'none', background: activeMasterQuoteId ? 'transparent' : '#fff' }} />
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    <div>
                        <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Job Name (Optional)</label>
                        <input type="text" placeholder="e.g. Master Suite Reno" disabled={!!activeMasterQuoteId} value={jobData.jobName} onChange={e => setJobData({...jobData, jobName: e.target.value})} style={{ width: '100%', padding: '12px', fontFamily: 'var(--sans)', fontSize: '1rem', border: '1px solid var(--line)', outline: 'none', boxSizing: 'border-box', background: activeMasterQuoteId ? 'transparent' : '#fff', cursor: activeMasterQuoteId ? 'not-allowed' : 'text' }} />
                    </div>
                    <div>
                        <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>* Sidemark (Global for Order)</label>
                        <input type="text" placeholder="e.g. Guest Bedroom 1" disabled={!!activeMasterQuoteId} value={jobData.sidemark} onChange={e => setJobData({...jobData, sidemark: e.target.value})} style={{ width: '100%', padding: '12px', fontFamily: 'var(--sans)', fontSize: '1rem', border: '1px solid var(--brass)', outline: 'none', boxSizing: 'border-box', background: activeMasterQuoteId ? 'transparent' : '#fff', cursor: activeMasterQuoteId ? 'not-allowed' : 'text' }} />
                    </div>

                    <button onClick={handleFinalizeQuote} style={{ width: '100%', padding: '16px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', marginTop: '16px', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'background 0.2s' }}>
                        Submit Quote to Pipeline
                    </button>
                </div>
            </div>
        </div>
      )}

      {showCloneModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
            <div style={{ background: '#fff', border: '1px solid var(--line)', width: '800px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 48px rgba(0,0,0,0.1)', borderRadius: '2px' }}>
                <div style={{ padding: '24px 30px', background: 'var(--paper-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
                    <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)' }}>Resume Draft / Clone Quote</h2>
                    <button onClick={() => setShowCloneModal(false)} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', fontSize: '2rem', cursor: 'pointer' }}>×</button>
                </div>
                
                <div style={{ padding: '16px 30px', background: 'var(--paper)', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>
                    <button onClick={handleClearAllDrafts} style={{ padding: '10px 20px', background: 'transparent', color: '#d9534f', border: '1px solid #d9534f', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>
                        Wipe All Abandoned Drafts
                    </button>
                </div>

                <div style={{ padding: '30px', flex: 1, overflowY: 'auto' }}>
                    {previousDrafts.length === 0 ? <div style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)', fontSize: '1.2rem', textAlign: 'center' }}>No drafts pushed from Vision Tab yet.</div> : (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                            {previousDrafts.map(draft => (
                                <div key={draft.id} style={{ background: '#fff', border: '1px solid var(--line)', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px', transition: 'all 0.2s', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                        <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink)' }}>Draft: {draft.category}</span>
                                        <div style={{ display: 'flex', gap: '12px' }}>
                                            <button onClick={() => handleDeleteDraft(draft.id)} style={{ background: 'none', color: '#d9534f', border: 'none', fontSize: '0.9rem', cursor: 'pointer' }}>🗑️</button>
                                            <button onClick={() => handleResumeDraft(draft.id)} style={{ background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)', padding: '6px 12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', cursor: 'pointer' }}>Resume</button>
                                        </div>
                                    </div>
                                    <div style={{ fontSize: '0.95rem', color: 'var(--ink)' }}>Generated by: {draft.author}</div>
                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>{new Date(draft.createdAt?.seconds * 1000).toLocaleString()}</div>
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