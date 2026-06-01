import React, { useState, useEffect, useMemo } from 'react';
import { db, storage } from '../../firebase';
import { collection, onSnapshot, doc, setDoc, serverTimestamp, query, where, getDoc } from "firebase/firestore";
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { useGLTF, OrbitControls, Bounds, Html, Environment, ContactShadows } from '@react-three/drei';

const globalTextureCache = {};

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

const CPQTab = ({ currentUser, activeBrand }) => {
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
  const [jobData, setJobData] = useState({ customerId: '', jobName: '', sidemark: '' });
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [virtualFeeSteps, setVirtualFeeSteps] = useState([]);

  const [activeAssemblyId, setActiveAssemblyId] = useState('');
  const [activeAssembly, setActiveAssembly] = useState(null);
  const [activeDraftId, setActiveDraftId] = useState(null);

  const [viewMode, setViewMode] = useState("3D");

  useEffect(() => {
      if (!activeBrand) return;
      
      const unsubFlows = onSnapshot(query(collection(db, "cpq_flows"), where("brandId", "==", activeBrand)), (snap) => setCpqFlows(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
      const unsubRules = onSnapshot(doc(db, "system", "cpq_rules"), (snap) => { if(snap.exists() && snap.data().rules) setCpqRules(snap.data().rules); });
      const unsubDrafts = onSnapshot(query(collection(db, "cpq_drafts"), where("brandId", "==", activeBrand), where("status", "==", "DRAFT_FROM_VISION")), (snap) => setPreviousDrafts(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
      
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

  const allActiveSteps = useMemo(() => {
      if (!activeFlow) return [];
      return [...(activeFlow.steps || []), ...virtualFeeSteps];
  }, [activeFlow, virtualFeeSteps]);

  useEffect(() => {
      if (!activeFlow) return;
      
      setStepQuantities(prev => {
          const updates = { ...prev };
          let changed = false;
          (activeFlow.steps || []).forEach(step => {
              if (updates[step.id] === undefined) {
                  updates[step.id] = 1;
                  changed = true;
              }
          });
          return changed ? updates : prev;
      });
  }, [activeFlow]);

  const activeStep = allActiveSteps[currentStepIndex];
  const availableProductTypes = [...new Set(libraryParts.map(p => p.manufacturingSpecs?.productType).filter(Boolean))];

  const getOptionsForStep = (step) => {
      if (!step || !step.dataSource) return [];
      let options = [];

      if (globalLists.inventoryTypes?.includes(step.dataSource) || globalLists.assemblyTypes?.includes(step.dataSource) || globalLists.prodTypes?.includes(step.dataSource)) {
          options = libraryParts.filter(p => {
              if (p.manufacturingSpecs?.customData?.feeType) return false;
              if (globalLists.prodTypes?.includes(step.dataSource) && p.manufacturingSpecs?.productType !== step.dataSource && p.productType !== step.dataSource) return false;
              if ((globalLists.inventoryTypes?.includes(step.dataSource) || globalLists.assemblyTypes?.includes(step.dataSource)) && p.routingType !== step.dataSource) return false;
              return true;
          }).map(p => ({ id: p.id, itemName: p.itemName, code: p.legacyErpId, price: p.manufacturingSpecs?.basePrice || 0, img: p.finalImageUrl }));
      } else if (step.dataSource === 'master_finishes') {
          options = [
              ...globalFinishes.map(f => ({ id: f.id, itemName: f.name, code: f.code })),
              ...outsourceFinishes.map(f => ({ id: f.id, itemName: f.name }))
          ];
      } else {
          const customAssets = dynamicAssets.filter(a => a.windowId === step.dataSource);
          if (customAssets.length > 0) options = customAssets.map(a => ({ id: a.id, itemName: a.name, code: a.code, price: a.basePrice || 0, img: a.imageUrl }));
          else if (globalLists[step.dataSource]) options = globalLists[step.dataSource].map(val => ({ id: val, itemName: val }));
          else if (step.dataSource === 'master_fabrics') {
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
      if (!draft) return alert("Draft not found.");
      
      let targetFlow = null;
      if (draft.flowId || draft.cpqFlowId || draft.linkedCpqFlowId) {
          targetFlow = cpqFlows.find(f => f.id === (draft.flowId || draft.cpqFlowId || draft.linkedCpqFlowId));
      }
      
      if (!targetFlow) {
          if (draft.category === 'PILLOW') targetFlow = cpqFlows.find(f => f.name.includes("PILLOW"));
          if (draft.category === 'HARDWARE' || draft.category === 'HARDWARE_ASSEMBLY') targetFlow = cpqFlows.find(f => f.name.includes("HARDWARE"));
      }

      if (!targetFlow) return alert("Cannot resume draft: No matching CPQ flow setup for this product.");

      setActiveFlowId(targetFlow.id);
      setActiveDraftId(draft.id);
      setJobData(prev => ({...prev, jobName: draft.jobName || '', sidemark: draft.sidemark || ''}));
      
      const translatedParams = {};
      
      if (draft.category === 'PILLOW') {
          (targetFlow.steps || []).forEach(step => {
              if (step.title.toLowerCase().includes("size")) translatedParams[step.id] = draft.specs?.size;
              if (step.title.toLowerCase().includes("fill")) translatedParams[step.id] = draft.specs?.fill;
              if (step.title.toLowerCase().includes("fabric")) translatedParams[step.id] = draft.specs?.fabrics?.[0]; 
              if (step.title.toLowerCase().includes("flange") || step.title.toLowerCase().includes("edge")) translatedParams[step.id] = draft.specs?.flange;
              if (step.title.toLowerCase().includes("trim") && draft.specs?.outerTrim?.trimId) translatedParams[step.id] = draft.specs.outerTrim.trimId;
              if (step.title.toLowerCase().includes("stitch")) translatedParams[step.id] = draft.specs?.stitch;
              if (step.title.toLowerCase().includes("seam") && draft.specs?.seamCount) translatedParams[step.id] = draft.specs.seamCount;
          });
      } else {
          Object.keys(draft.specs || {}).forEach(key => {
              if (key !== 'collection' && key !== 'quantities' && key !== 'engineeringNotes') {
                  translatedParams[key] = draft.specs[key];
              }
          });
      }

      const newVirtualSteps = [];
      const quantities = draft.specs?.quantities || draft.cpqData?.quantities || {};

      if (quantities) {
          const createVirtualStep = (feeKey, title, dataSourceType) => {
              if (quantities[feeKey] > 0) {
                  const virtualId = `VIRTUAL_FEE_${feeKey.toUpperCase()}`;
                  newVirtualSteps.push({
                      id: virtualId,
                      title: title,
                      type: 'READ_ONLY_FEE',
                      isVirtual: true,
                      qty: quantities[feeKey]
                  });
                  const feeItem = libraryParts.find(p => p.manufacturingSpecs?.customData?.feeType === dataSourceType);
                  if (feeItem) {
                      translatedParams[virtualId] = feeItem.id;
                  }
              }
          };

          createVirtualStep('splice', 'Appended Splice Fee', 'SPLICE');
          createVirtualStep('miter', 'Appended Miter Cut Fee', 'MITER_CUT');
          createVirtualStep('bend', 'Appended Bent Return Fee', 'BENT_RETURN');
          createVirtualStep('miterReturn', 'Appended Miter Return Fee', 'MITER_RETURN');
          createVirtualStep('customProj', 'Appended Custom Proj Setup', 'CUSTOM_PROJ');
      }

      setVirtualFeeSteps(newVirtualSteps);
      setDynamicConfigParams(translatedParams);
      
      let initialQuantities = {};
      if (draft.specs?.engineeringNotes) {
          const notes = draft.specs.engineeringNotes;
          (targetFlow.steps || []).forEach(step => {
              const t = (step.title || '').toLowerCase();
              if (t.includes('pole') || t.includes('tube')) initialQuantities[step.id] = notes.poleFeetQty || 1;
              else if (t.includes('bracket')) initialQuantities[step.id] = notes.qtyBrackets || 1;
              else if (t.includes('ring')) initialQuantities[step.id] = notes.recRings || 1;
              else if (t.includes('finial')) initialQuantities[step.id] = notes.qtyFinials || 1;
              else initialQuantities[step.id] = 1;
          });
      } else if (draft.specs?.quantities || draft.cpqData?.quantities) {
          initialQuantities = draft.specs?.quantities || draft.cpqData?.quantities;
      }

      setStepQuantities(initialQuantities);
      
      if (draft.cpqData?.dimensions || draft.spatialData) {
          setDimensionInputs(draft.cpqData?.dimensions || draft.spatialData);
      }

      setCurrentStepIndex(0);
      alert("Engineering Data Loaded! Please follow the Post-It Note on the left to complete your selections.");
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
              if (updated.type === 'C2C') { c2c = baseLength; o2o = baseLength + 1; } 
              else { o2o = baseLength; c2c = baseLength - 1; }
              cutLength = o2o + 17; 
              calculatedQty = Math.max(1, Math.ceil(cutLength / 12)); 
              updated.calc_o2o = o2o; updated.calc_c2c = c2c; updated.calc_cutLength = cutLength;
          } else if (template === 'calc_straight_pole') {
              let baseLength = parseFloat(updated.length) || 0;
              calculatedQty = Math.max(1, Math.ceil(baseLength / 12));
              updated.calc_cutLength = baseLength;
          } else if (template === 'calc_mitered_bay') {
              let a = parseFloat(updated.wallA) || 0; let b = parseFloat(updated.wallB) || 0; let c = parseFloat(updated.wallC) || 0;
              calculatedQty = Math.max(1, Math.ceil((a + b + c + 12) / 12)); 
              updated.calc_cutLength = a + b + c + 12; 
          } else if (template === 'calc_curved_bay') {
              let baseLength = parseFloat(updated.length) || 0;
              calculatedQty = Math.max(1, Math.ceil((baseLength + 12) / 12)); 
              updated.calc_cutLength = baseLength + 12;
          }

          if (value !== '') setStepQuantities(sq => ({...sq, [stepId]: calculatedQty}));
          return { ...prev, [stepId]: updated };
      });
  };

  const currentTotal = useMemo(() => {
      if (!activeFlow) return 0;
      let total = parseFloat(activeFlow.basePrice) || 0;
      const quantities = stepQuantities; 

      allActiveSteps.forEach(step => {
          const selectedValueId = dynamicConfigParams[step.id];
          if (selectedValueId || step.type === 'DIMENSIONS') {
              let qtyMultiplier = step.isVirtual ? step.qty : (quantities[step.id] !== undefined ? quantities[step.id] : 1);

              if (step.priceOverride) {
                  total += parseFloat(step.priceOverride) * qtyMultiplier;
              } else if (selectedValueId) {
                  let stepPrice = 0;
                  const partObj = libraryParts.find(p => p.id === selectedValueId) || 
                                  dynamicAssets.find(a => a.id === selectedValueId) ||
                                  globalFinishes.find(f => f.id === selectedValueId) ||
                                  outsourceFinishes.find(f => f.id === selectedValueId);

                  if (partObj) {
                      if (partObj.manufacturingSpecs?.basePrice) stepPrice = parseFloat(partObj.manufacturingSpecs.basePrice);
                      else if (partObj.basePrice) stepPrice = parseFloat(partObj.basePrice);
                  }

                  if (step.useClientPricing && jobData.customerId && partObj?.clientPricing) {
                      const cp = partObj.clientPricing.find(c => c.customerId === jobData.customerId);
                      if (cp && cp.price !== undefined && cp.price !== "") stepPrice = parseFloat(cp.price);
                  }

                  let upcharge = 0;
                  if (step.priceMap && step.priceMap[selectedValueId]) {
                      upcharge = parseFloat(step.priceMap[selectedValueId]) || 0;
                  }

                  let finalP = stepPrice + upcharge;
                  let mlt = (partObj && partObj.multiplier) ? parseFloat(partObj.multiplier) : 1.0;
                  total += (finalP * mlt * qtyMultiplier);
              }
          }
      });
      return total;
  }, [dynamicConfigParams, stepQuantities, activeFlow, libraryParts, dynamicAssets, globalFinishes, outsourceFinishes, allActiveSteps, jobData.customerId]);

  useEffect(() => { setPricing({ base: currentTotal, finalPrice: currentTotal }); }, [currentTotal]);

  const handleParamChange = (stepId, value) => {
      setDynamicConfigParams(prev => ({ ...prev, [stepId]: value }));
      
      if (stepQuantities[stepId] === undefined) {
          const step = allActiveSteps.find(s => s.id === stepId);
          let defaultQty = 1;
          if (step && activeBomPins.length > 0) {
              const pin = activeBomPins.find(p => p.partId === step.linkedPinId);
              if (pin && pin.defaultQty) defaultQty = pin.defaultQty;
          }
          setStepQuantities(prev => ({...prev, [stepId]: defaultQty}));
      }
  };

  const handleNextStep = () => {
      if (!activeFlow) return;
      let nextIndex = currentStepIndex + 1;
      while (nextIndex < allActiveSteps.length && engineFlags.disabledSteps.includes(allActiveSteps[nextIndex].title)) {
          nextIndex++;
      }
      if (nextIndex < allActiveSteps.length) setCurrentStepIndex(nextIndex);
  };

  const handleFinalizeQuote = async () => {
      if (!jobData.customerId || !jobData.sidemark) return alert("❌ Please select a Customer and enter a Sidemark.");
      const jobId = `QUOTE-${Date.now()}`;
      const customerName = combinedCustomers.find(c => c.id === jobData.customerId)?.name || jobData.customerId;
      
      const draftData = activeDraftId ? previousDrafts.find(d => d.id === activeDraftId) : null;
      let fullQuantities = { ...stepQuantities };
      
      if (draftData?.specs?.engineeringNotes) {
          const notes = draftData.specs.engineeringNotes;
          if (notes.qtySplices > 0) fullQuantities['VIRTUAL_SPLICE'] = notes.qtySplices;
          if (notes.qtyBends > 0) fullQuantities['VIRTUAL_BEND'] = notes.qtyBends;
          if (notes.qtyMiters > 0) fullQuantities['VIRTUAL_MITER'] = notes.qtyMiters;
          if (notes.qtyMiterReturns > 0) fullQuantities['VIRTUAL_MITER_RTN'] = notes.qtyMiterReturns;
          if (notes.qtyCustomProjBrackets > 0) fullQuantities['VIRTUAL_CUSTOM_PROJ'] = notes.qtyCustomProjBrackets;
      }

      const payload = {
          jobId: jobId, brandId: activeBrand, status: 'CONFIGURED',
          customer: { id: jobData.customerId, name: customerName },
          jobName: jobData.jobName, sidemark: jobData.sidemark,
          flowId: activeFlow?.id || null, 
          linkedAssemblyId: activeAssemblyId || null,
          isProjectManaged: activeAssembly?.manufacturingSpecs?.isProjectManaged || false, 
          cpqData: { 
              totalPrice: pricing.finalPrice, 
              configuration: dynamicConfigParams,
              quantities: fullQuantities, 
              dimensions: dimensionInputs,
              appliedRules: engineFlags.warnings 
          },
          dispatchStatus: { nsSalesOrder: false, fabrication: false, finishing: false, sewing: false, packing: false },
          dateSaved: new Date().toISOString().split('T')[0], author: currentUser, createdAt: serverTimestamp()
      };
      
      try {
          await setDoc(doc(db, "jobs", jobId), payload);
          await generateFactoryRouter(payload);
          if (activeAssembly?.manufacturingSpecs?.isProjectManaged) alert(`✅ COMPLEX QUOTE & FACTORY ROUTER GENERATED!\n\nRouted to Tab 10.5 (Project Management) for multi-order dissection.`);
          else alert(`✅ STANDARD QUOTE & FACTORY ROUTER GENERATED!\n\nRouted to Tab 10 (External Coop) for standard approval.`);
          
          setActiveFlowId(""); setDynamicConfigParams({}); setStepQuantities({}); setDimensionInputs({}); setCurrentStepIndex(0); 
          setActiveAssemblyId(""); setShowCheckoutModal(false); setJobData({ customerId: '', jobName: '', sidemark: '' });
          setActiveDraftId(null); setVirtualFeeSteps([]);
      } catch (err) { console.error(err); alert("Failed to save quote."); }
  };

  const generateFactoryRouter = async (job) => {
      const printWindow = window.open('', '_blank', 'width=800,height=900');
      let dimensionHtml = '';
      
      if (job.cpqData?.dimensions && Object.keys(job.cpqData.dimensions).length > 0) {
          dimensionHtml = `
              <div style="margin-top: 20px; border: 2px dashed #000; padding: 15px; background: #fff3cd;">
                  <h4 style="margin: 0 0 10px 0; color: #856404; text-transform: uppercase;">⚠️ DIMENSIONAL SHOP CUT SHEET</h4>
                  <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                      ${Object.entries(job.cpqData.dimensions).map(([stepId, dims]) => `
                          <tr><td colspan="2" style="padding: 10px; font-weight: bold; background: #e9ecef; border-top: 2px solid #000;">${allActiveSteps.find(s => s.id === stepId)?.title || stepId}</td></tr>
                          ${Object.entries(dims).filter(([k,v]) => !k.startsWith('calc_') && v !== '').map(([key, val]) => `
                              <tr>
                                  <td style="padding: 4px 8px; border-bottom: 1px solid #eee;">INPUT: ${key.toUpperCase()}</td>
                                  <td style="padding: 4px 8px; border-bottom: 1px solid #eee;">${val}</td>
                              </tr>
                          `).join('')}
                          ${dims.calc_cutLength ? `
                              <tr>
                                  <td style="padding: 8px; border-bottom: 1px dashed #d9534f; color: #d9534f; font-weight: bold; font-size: 14px;">SHOP RAW CUT LENGTH</td>
                                  <td style="padding: 8px; border-bottom: 1px dashed #d9534f; font-weight: bold; font-size: 16px; color: #d9534f;">${dims.calc_cutLength}"</td>
                              </tr>
                          ` : ''}
                          ${dims.calc_o2o ? `
                              <tr>
                                  <td style="padding: 4px 8px; border-bottom: 1px solid #eee; font-weight: bold;">FINISHED O2O</td>
                                  <td style="padding: 4px 8px; border-bottom: 1px solid #eee; font-weight: bold;">${dims.calc_o2o}"</td>
                              </tr>
                          ` : ''}
                          ${dims.calc_c2c ? `
                              <tr>
                                  <td style="padding: 4px 8px; border-bottom: 1px solid #eee; font-weight: bold;">FINISHED C2C</td>
                                  <td style="padding: 4px 8px; border-bottom: 1px solid #eee; font-weight: bold;">${dims.calc_c2c}"</td>
                              </tr>
                          ` : ''}
                      `).join('')}
                  </table>
              </div>
          `;
      }

      const html = `
        <html>
          <head>
            <title>ROUTER_${job.jobId}</title>
            <style>
              body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 40px; color: #000; max-width: 800px; margin: 0 auto; }
              .header { display: flex; justify-content: space-between; border-bottom: 4px solid #000; padding-bottom: 20px; margin-bottom: 30px; }
              .brand { font-size: 32px; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; }
              .doc-type { font-size: 24px; color: #fff; background: #000; padding: 5px 15px; text-transform: uppercase; }
              .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 40px; background: #f8f9fa; padding: 20px; border: 2px solid #000; }
              .label { font-size: 12px; font-weight: bold; color: #666; text-transform: uppercase; }
              .val { font-size: 18px; font-weight: bold; }
              .specs { margin-bottom: 40px; border: 2px solid #000; }
              .spec-header { background: #000; color: #fff; padding: 10px 15px; font-weight: bold; text-transform: uppercase; }
              .spec-row { display: flex; justify-content: space-between; padding: 12px 15px; border-bottom: 1px solid #ccc; font-size: 14px; }
            </style>
          </head>
          <body>
            <div class="header">
              <div class="brand">${activeBrand}</div>
              <div class="doc-type">FACTORY ROUTER</div>
            </div>
            <div class="meta-grid">
              <div><span class="label">Sidemark / Project:</span><br/><span class="val">${job.sidemark}</span></div>
              <div><span class="label">Job ID:</span><br/><span class="val">${job.jobId}</span></div>
              <div><span class="label">Customer:</span><br/><span class="val">${job.customer?.name}</span></div>
              <div><span class="label">Date Engineered:</span><br/><span class="val">${job.dateSaved}</span></div>
            </div>
            <div class="specs">
              <div class="spec-header">BILL OF MATERIALS (BOM)</div>
              <div class="spec-row" style="background:#eee; font-weight:bold;"><span>COMPONENT</span><span>QTY</span></div>
              
              ${Object.entries(job.cpqData.configuration || {}).map(([stepId, valueId]) => {
                  const step = allActiveSteps?.find(s => s.id === stepId);
                  if (!step) return ''; 
                  
                  const qty = job.cpqData.quantities[stepId] || 1;
                  const partObj = libraryParts.find(p => p.id === valueId) || dynamicAssets.find(a => a.id === valueId) || globalFinishes.find(f => f.id === valueId) || outsourceFinishes.find(f => f.id === valueId);
                  return `<div class="spec-row"><span>${step.title}: <strong>${partObj?.itemName || partObj?.name || valueId}</strong></span><span>${qty}</span></div>`;
              }).join('')}
              
              ${Object.entries(job.cpqData.quantities || {}).map(([key, qty]) => {
                  if (key.startsWith('VIRTUAL_')) {
                      return `<div class="spec-row"><span>AUTO-APPENDED FEE: <strong>${key.replace('VIRTUAL_', '')}</strong></span><span>${qty}</span></div>`;
                  }
                  return '';
              }).join('')}
            </div>
            ${dimensionHtml}
            <script> window.onload = function() { window.print(); } </script>
          </body>
        </html>
      `;
      printWindow.document.write(html);
      printWindow.document.close();
  };

  const renderOptionPrice = (opt, step) => {
      const partObj = libraryParts.find(p => p.id === opt.id) || 
                      dynamicAssets.find(a => a.id === opt.id) ||
                      globalFinishes.find(f => f.id === opt.id) ||
                      outsourceFinishes.find(f => f.id === opt.id);
      
      let nativeP = 0;
      if (partObj) {
          if (partObj.manufacturingSpecs?.basePrice) nativeP = parseFloat(partObj.manufacturingSpecs.basePrice);
          else if (partObj.basePrice) nativeP = parseFloat(partObj.basePrice);
      }

      if (step.useClientPricing && jobData.customerId && partObj?.clientPricing) {
          const cp = partObj.clientPricing.find(c => c.customerId === jobData.customerId);
          if (cp && cp.price !== undefined && cp.price !== "") nativeP = parseFloat(cp.price);
      }

      let upP = step.priceMap?.[opt.id] ? parseFloat(step.priceMap[opt.id]) : 0;
      let finalP = nativeP + upP;

      if (step.priceOverride !== undefined && step.priceOverride !== "") {
          finalP = parseFloat(step.priceOverride);
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

  const textureOverrides = useMemo(() => {
      if (!activeFlow) return {};
      const overrides = {};
      
      allActiveSteps.forEach(step => {
          if (step.isVirtual) return; 
          const selectedValueId = dynamicConfigParams[step.id];
          if (selectedValueId && step.targetNodes) {
              const allF = [...globalFinishes, ...outsourceFinishes];
              const dynamicF = dynamicAssets;
              const fData = allF.find(f => f.id === selectedValueId) || dynamicF.find(d => d.id === selectedValueId);
              
              if (fData?.textureUrl) overrides[step.targetNodes] = fData.textureUrl;
          }
      });
      return overrides;
  }, [dynamicConfigParams, activeFlow, globalFinishes, outsourceFinishes, dynamicAssets, allActiveSteps]);

  const visibilityOverrides = useMemo(() => {
      if (!activeFlow) return {};
      const overrides = {};
      
      allActiveSteps.forEach(step => {
          if (step.isVirtual) return; 
          const selectedValueId = dynamicConfigParams[step.id];
          if (selectedValueId && step.geometryMap && Object.keys(step.geometryMap).length > 0) {
              Object.keys(step.geometryMap).forEach(optId => {
                  const targetMesh = step.geometryMap[optId];
                  if (targetMesh) overrides[targetMesh] = (optId === selectedValueId);
              });
          }
      });
      return overrides;
  }, [dynamicConfigParams, activeFlow, allActiveSteps]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', fontFamily: 'monospace', backgroundColor: '#e5e5e5', minHeight: '100vh' }}>
      
      <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '5px 5px 0 #000' }}>
        <div>
            <h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.4rem', color: '#007bff' }}>8. Configure, Price, Quote (CPQ)</h2>
            <span style={{ fontSize: '0.7rem', color: '#666' }}>PARAMETRIC PRICING & VISUALIZATION</span>
        </div>
        <div style={{ fontSize: '1.2rem', fontWeight: 'bold', background: '#eafaf1', padding: '10px 20px', border: '2px solid #28a745', color: '#1e7e34', boxShadow: '3px 3px 0 #28a745' }}>
            EST. MSRP: ${pricing.finalPrice.toFixed(2)}
        </div>
      </div>

      <div style={{ background: '#f0f8ff', border: '2px solid #007bff', padding: '15px', display: 'flex', alignItems: 'center', gap: '15px', boxShadow: '5px 5px 0 rgba(0,0,0,0.1)' }}>
          <div style={{ fontWeight: 'bold', color: '#007bff', fontSize: '1.1rem' }}>🤝 ACTIVE CUSTOMER:</div>
          <select 
              value={jobData.customerId} 
              onChange={e => setJobData({...jobData, customerId: e.target.value})} 
              style={{ flex: 1, padding: '10px', fontSize: '1rem', border: '2px solid #007bff', outline: 'none', fontWeight: 'bold' }}
          >
              <option value="">-- Select Customer to Activate Live Client Pricing --</option>
              {combinedCustomers.map(c => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
          </select>
          {!jobData.customerId && <span style={{ fontSize: '0.8rem', color: '#d9534f', fontWeight: 'bold' }}>⚠️ Base MSRP will be shown until customer is selected.</span>}
      </div>

      <div style={{ display: 'flex', gap: '20px', alignItems: 'stretch' }}>
          
          <div style={{ width: '450px', display: 'flex', flexDirection: 'column', gap: '20px', flexShrink: 0 }}>
              
              <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 rgba(0,0,0,0.1)' }}>
                 <div style={{ padding: '10px', background: '#000', color: '#fff', fontWeight: 'bold', fontSize: '0.8rem' }}>STEP 1: SELECT PRODUCT CATEGORY / FLOW</div>
                 <div style={{ padding: '15px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    
                    {cpqFlows.length > 0 && (
                        <select value={activeFlowId} onChange={(e) => { setActiveFlowId(e.target.value); setCurrentStepIndex(0); setDynamicConfigParams({}); setStepQuantities({}); setDimensionInputs({}); setProductType(''); setActiveAssemblyId(''); setVirtualFeeSteps([]); setActiveDraftId(null); }} style={{ width: '100%', padding: '12px', border: '2px solid #007bff', fontWeight: 'bold', fontSize: '1rem', background: '#e6f2ff' }}>
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

              {!activeFlowId && (
                  <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 rgba(0,0,0,0.1)' }}>
                      <div style={{ padding: '10px', background: '#007bff', color: '#fff', fontWeight: 'bold', fontSize: '0.8rem', textTransform: 'uppercase' }}>
                          📥 IMPORT ENGINEERING DRAFTS
                      </div>
                      <div style={{ padding: '15px', display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '300px', overflowY: 'auto' }}>
                          {previousDrafts.length === 0 ? <div style={{ color: '#999', fontStyle: 'italic', fontSize: '0.8rem' }}>No pending drafts from the Vision tab.</div> : (
                              previousDrafts.map(draft => (
                                  <div key={draft.id} onClick={() => handleResumeDraft(draft.id)} style={{ background: '#f8f9fa', border: '1px solid #ccc', padding: '10px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '5px', transition: '0.2s' }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                          <span style={{ fontWeight: 'bold', color: '#007bff', fontSize: '0.85rem' }}>{draft.category} DRAFT</span>
                                          <span style={{ fontSize: '0.65rem', color: '#fff', background: '#28a745', padding: '3px 6px', fontWeight: 'bold' }}>IMPORT</span>
                                      </div>
                                      <div style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>{draft.sidemark || draft.jobName || 'Unnamed Job'}</div>
                                      <div style={{ fontSize: '0.65rem', color: '#666' }}>{new Date(draft.createdAt?.seconds * 1000).toLocaleString()}</div>
                                  </div>
                              ))
                          )}
                      </div>
                  </div>
              )}

              {activeFlow && activeStep && (
                  <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 #28a745', flex: 1 }}>
                      <div style={{ padding: '15px', background: '#28a745', color: '#fff', fontWeight: 'bold', fontSize: '1.1rem', display: 'flex', justifyContent: 'space-between' }}>
                          <span>STEP {currentStepIndex + 1} OF {allActiveSteps.length}: {activeStep.title}</span>
                      </div>
                      
                      <div style={{ padding: '20px', flex: 1, overflowY: 'auto', maxHeight: '400px' }}>
                          
                          {(activeStep.type === 'VISUAL_GRID' || activeStep.type === 'VISUAL_DIMENSIONS') && !activeStep.isVirtual && (
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '15px' }}>
                                  {getOptionsForStep(activeStep).map(opt => (
                                      <div key={opt.id} onClick={() => handleParamChange(activeStep.id, opt.id)} style={{ border: `2px solid ${dynamicConfigParams[activeStep.id] === opt.id ? '#007bff' : '#ccc'}`, padding: '10px', textAlign: 'center', cursor: 'pointer', background: dynamicConfigParams[activeStep.id] === opt.id ? '#e6f2ff' : '#fff' }}>
                                          <div style={{ width: '100%', height: '80px', background: opt.finalImageUrl ? `url(${opt.finalImageUrl}) center/cover` : '#eee', marginBottom: '10px' }} />
                                          <div style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>{opt.itemName}{renderOptionPrice(opt, activeStep)}</div>
                                      </div>
                                  ))}
                              </div>
                          )}

                          {(activeStep.type === 'DROPDOWN' || activeStep.type === 'DIMENSIONS') && activeStep.type !== 'VISUAL_DIMENSIONS' && activeStep.dataSource && !activeStep.isVirtual && (
                              <select value={dynamicConfigParams[activeStep.id] || ''} onChange={(e) => handleParamChange(activeStep.id, e.target.value)} style={{ width: '100%', padding: '12px', border: '2px solid #000', fontSize: '1rem', marginBottom: '15px' }}>
                                  <option value="">-- Select Option --</option>
                                  {getOptionsForStep(activeStep).map(opt => (
                                      <option key={opt.id} value={opt.id}>{opt.itemName}{renderOptionPrice(opt, activeStep)}</option>
                                  ))}
                              </select>
                          )}

                          {activeStep.isVirtual && (
                              <div style={{ padding: '20px', background: '#eafaf1', border: '1px solid #28a745', textAlign: 'center' }}>
                                  <div style={{ fontSize: '2rem', marginBottom: '10px' }}>✅</div>
                                  <div style={{ fontWeight: 'bold', color: '#1e7e34', fontSize: '1.1rem' }}>FEE AUTO-APPENDED</div>
                                  <div style={{ color: '#666', fontSize: '0.8rem', marginTop: '5px' }}>Quantity: {activeStep.qty}x</div>
                                  <div style={{ color: '#999', fontSize: '0.7rem', marginTop: '10px', fontStyle: 'italic' }}>This fee was detected from the Vision Engine and mathematically locked to the quote.</div>
                              </div>
                          )}

                          {!activeStep.isVirtual && (activeStep.calculatorTemplate || activeStep.type === 'DIMENSIONS' || activeStep.type === 'VISUAL_DIMENSIONS') && (
                              <div style={{ padding: '15px', background: '#eafaf1', borderTop: '2px solid #000', borderBottom: '2px solid #000' }}>
                                  <h4 style={{ margin: '0 0 10px 0', color: '#1e7e34' }}>📐 DIMENSIONAL INPUT</h4>
                                  
                                  {(activeStep.calculatorTemplate === 'calc_french_return_1in' || activeStep.calculatorTemplate === 'calc_straight_pole' || activeStep.calculatorTemplate === 'calc_curved_bay') && (
                                      <div style={{ display: 'flex', gap: '15px' }}>
                                          {activeStep.calculatorTemplate !== 'calc_straight_pole' && (
                                              <div style={{ flex: 1 }}>
                                                  <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>MEASUREMENT TYPE:</label>
                                                  <select 
                                                      value={dimensionInputs[activeStep.id]?.type || 'O2O'} 
                                                      onChange={(e) => handleDimensionChange(activeStep.id, 'type', e.target.value, activeStep.calculatorTemplate)}
                                                      style={{ width: '100%', padding: '10px', border: '1px solid #ccc', fontWeight: 'bold' }}
                                                  >
                                                      <option value="O2O">A. Outside Edge to Outside Edge (O2O)</option>
                                                      <option value="C2C">B. Center to Center (C2C)</option>
                                                  </select>
                                              </div>
                                          )}
                                          <div style={{ flex: 1 }}>
                                              <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>FINISHED LENGTH (INCHES):</label>
                                              <input 
                                                  type="number" min="0" placeholder="e.g. 84"
                                                  value={dimensionInputs[activeStep.id]?.length || ''} 
                                                  onChange={(e) => handleDimensionChange(activeStep.id, 'length', e.target.value, activeStep.calculatorTemplate)}
                                                  style={{ width: '100%', padding: '10px', border: '1px solid #ccc', fontWeight: 'bold', boxSizing: 'border-box' }}
                                              />
                                          </div>
                                      </div>
                                  )}

                                  {activeStep.calculatorTemplate === 'calc_mitered_bay' && (
                                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                                          <div>
                                              <label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>WALL A (Left):</label>
                                              <input type="number" min="0" placeholder="Inches" value={dimensionInputs[activeStep.id]?.wallA || ''} onChange={(e) => handleDimensionChange(activeStep.id, 'wallA', e.target.value, activeStep.calculatorTemplate)} style={{ width: '100%', padding: '8px', border: '1px solid #ccc', boxSizing: 'border-box' }} />
                                          </div>
                                          <div>
                                              <label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>WALL B (Center):</label>
                                              <input type="number" min="0" placeholder="Inches" value={dimensionInputs[activeStep.id]?.wallB || ''} onChange={(e) => handleDimensionChange(activeStep.id, 'wallB', e.target.value, activeStep.calculatorTemplate)} style={{ width: '100%', padding: '8px', border: '1px solid #ccc', boxSizing: 'border-box' }} />
                                          </div>
                                          <div>
                                              <label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>WALL C (Right):</label>
                                              <input type="number" min="0" placeholder="Inches" value={dimensionInputs[activeStep.id]?.wallC || ''} onChange={(e) => handleDimensionChange(activeStep.id, 'wallC', e.target.value, activeStep.calculatorTemplate)} style={{ width: '100%', padding: '8px', border: '1px solid #ccc', boxSizing: 'border-box' }} />
                                          </div>
                                      </div>
                                  )}

                                  {dimensionInputs[activeStep.id]?.length > 0 && activeStep.calculatorTemplate === 'calc_french_return_1in' && (
                                      <div style={{ marginTop: '10px', fontSize: '0.75rem', color: '#1e7e34', background: '#fff', padding: '10px', border: '2px solid #28a745', boxShadow: '2px 2px 0 rgba(0,0,0,0.1)' }}>
                                          <strong style={{display:'block', marginBottom:'5px', color:'#000'}}>MATH LOGIC (1" French Return):</strong> 
                                          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'10px', marginBottom:'5px'}}>
                                              <div style={{background:'#eee', padding:'5px', textAlign:'center'}}><strong>O2O:</strong> {dimensionInputs[activeStep.id].calc_o2o}"</div>
                                              <div style={{background:'#eee', padding:'5px', textAlign:'center'}}><strong>C2C:</strong> {dimensionInputs[activeStep.id].calc_c2c}"</div>
                                              <div style={{background:'#ffeeba', padding:'5px', textAlign:'center', color:'#856404', border:'1px solid #856404'}}><strong>CUT LENGTH:</strong> {dimensionInputs[activeStep.id].calc_cutLength}"</div>
                                          </div>
                                          Required raw pole is +17" over O2O length. Sold per foot (rounded up). 
                                          Calculated Purchase Quantity: <strong>{stepQuantities[activeStep.id] || 1} Feet</strong>.
                                      </div>
                                  )}
                              </div>
                          )}
                      </div>

                      {!activeStep.isVirtual && (
                          <div style={{ padding: '15px', background: '#f8f9fa', borderBottom: '2px solid #000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div style={{ fontSize: '0.8rem', color: '#666', lineHeight: '1.4', flex: 1, paddingRight: '15px' }}>
                                  <strong>STEP QUANTITY:</strong><br/>
                                  <span style={{ fontSize: '0.7rem' }}>{activeStep.qtyHelperText || 'Adjust to multiply option logic (e.g. 4 rings per foot).'}</span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                  <button onClick={() => {
                                      let current = stepQuantities[activeStep.id];
                                      if (current === undefined || current === '') current = 1;
                                      else current = parseInt(current);
                                      setStepQuantities({...stepQuantities, [activeStep.id]: Math.max(1, current - 1)});
                                  }} style={{ padding: '8px 12px', background: '#000', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer', fontSize: '1rem' }}>-</button>
                                  
                                  <input 
                                      type="number" 
                                      min="1" 
                                      value={stepQuantities[activeStep.id] !== undefined ? stepQuantities[activeStep.id] : 1} 
                                      onChange={e => {
                                          const val = e.target.value;
                                          setStepQuantities({...stepQuantities, [activeStep.id]: val === '' ? '' : parseInt(val)});
                                      }} 
                                      style={{ width: '50px', padding: '10px', border: '2px solid #000', textAlign: 'center', fontWeight: 'bold', fontSize: '1.1rem', outline: 'none' }} 
                                  />
                                  
                                  <button onClick={() => {
                                      let current = stepQuantities[activeStep.id];
                                      if (current === undefined || current === '') current = 1;
                                      else current = parseInt(current);
                                      setStepQuantities({...stepQuantities, [activeStep.id]: current + 1});
                                  }} style={{ padding: '8px 12px', background: '#000', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer', fontSize: '1rem' }}>+</button>
                              </div>
                          </div>
                      )}

                      {engineFlags.warnings.length > 0 && (
                           <div style={{ background: '#fff3cd', borderTop: '2px solid #ffc107', padding: '10px 15px' }}>
                               {engineFlags.warnings.map((log, i) => <div key={i} style={{ fontSize: '0.75rem', color: '#856404', fontWeight: 'bold' }}>{log}</div>)}
                           </div>
                      )}

                      <div style={{ padding: '15px', display: 'flex', justifyContent: 'space-between' }}>
                          <button onClick={() => setCurrentStepIndex(Math.max(0, currentStepIndex - 1))} disabled={currentStepIndex === 0} style={{ padding: '10px 20px', border: '2px solid #000', background: currentStepIndex === 0 ? '#333' : '#fff', color: currentStepIndex === 0 ? '#fff' : '#000', fontWeight: 'bold', cursor: currentStepIndex === 0 ? 'not-allowed' : 'pointer' }}>BACK</button>
                          
                          {currentStepIndex < allActiveSteps.length - 1 ? (
                              <button onClick={handleNextStep} disabled={activeStep.required && !dynamicConfigParams[activeStep.id] && activeStep.type !== 'DIMENSIONS' && !activeStep.isVirtual} style={{ padding: '10px 20px', border: '2px solid #000', background: activeStep.required && !dynamicConfigParams[activeStep.id] && activeStep.type !== 'DIMENSIONS' && !activeStep.isVirtual ? '#ccc' : '#000', color: '#fff', fontWeight: 'bold', cursor: activeStep.required && !dynamicConfigParams[activeStep.id] && activeStep.type !== 'DIMENSIONS' && !activeStep.isVirtual ? 'not-allowed' : 'pointer' }}>NEXT STEP</button>
                          ) : (
                              <button onClick={() => setShowCheckoutModal(true)} disabled={activeStep.required && !dynamicConfigParams[activeStep.id] && activeStep.type !== 'DIMENSIONS' && !activeStep.isVirtual} style={{ padding: '10px 20px', border: '2px solid #28a745', background: activeStep.required && !dynamicConfigParams[activeStep.id] && activeStep.type !== 'DIMENSIONS' && !activeStep.isVirtual ? '#ccc' : '#28a745', color: '#fff', fontWeight: 'bold', cursor: activeStep.required && !dynamicConfigParams[activeStep.id] && activeStep.type !== 'DIMENSIONS' && !activeStep.isVirtual ? 'not-allowed' : 'pointer' }}>FINALIZE CART</button>
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
                              <ambientLight intensity={0.9} /> 
                              <directionalLight position={[5, 10, 5]} intensity={0.7} />
                              <Environment preset="warehouse" /> 
                              <ContactShadows position={[0, -0.5, 0]} opacity={0.5} scale={10} blur={2} far={4} />
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
                      
                      {activeDraftId && previousDrafts.find(d => d.id === activeDraftId)?.specs?.engineeringNotes && (
                          <div style={{
                              position: 'absolute', bottom: '20px', left: '20px', width: '220px',
                              background: '#fffcd6', padding: '15px', boxShadow: '3px 3px 10px rgba(0,0,0,0.3)',
                              transform: 'rotate(-2deg)', border: '1px solid #e3e4a3', zIndex: 100,
                              color: '#333'
                          }}>
                              <div style={{ fontWeight: 'bold', borderBottom: '1px solid #ccc', paddingBottom: '5px', marginBottom: '10px', fontSize: '0.8rem', color: '#007bff' }}>
                                  📌 ENGINEERING SPECS
                              </div>
                              {(() => {
                                  const draft = previousDrafts.find(d => d.id === activeDraftId);
                                  const notes = draft.specs.engineeringNotes;
                                  return (
                                      <div style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '5px', fontFamily: 'monospace' }}>
                                          {draft.jobName && <div><strong>JOB:</strong> {draft.jobName}</div>}
                                          {draft.sidemark && <div><strong>MARK:</strong> {draft.sidemark}</div>}
                                          <div style={{ marginTop: '5px', color: '#1e7e34' }}><strong>POLE:</strong> {notes.poleFeetQty} FT</div>
                                          {notes.qtyBrackets > 0 && <div><strong>BRACKETS:</strong> {notes.qtyBrackets}</div>}
                                          {notes.recRings > 0 && <div><strong>RINGS:</strong> {notes.recRings}</div>}
                                          {notes.qtyFinials > 0 && <div><strong>FINIALS:</strong> {notes.qtyFinials}</div>}
                                          {notes.qtySplices > 0 && <div style={{ color: '#d9534f' }}><strong>SPLICES:</strong> {notes.qtySplices}</div>}
                                          {notes.qtyMiters > 0 && <div style={{ color: '#d9534f' }}><strong>MITERS:</strong> {notes.qtyMiters}</div>}
                                          {notes.qtyBends > 0 && <div style={{ color: '#d9534f' }}><strong>BENDS:</strong> {notes.qtyBends}</div>}
                                          {notes.qtyMiterReturns > 0 && <div style={{ color: '#d9534f' }}><strong>MITER RTN:</strong> {notes.qtyMiterReturns}</div>}
                                      </div>
                                  )
                              })()}
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
                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#d9534f', display: 'block', marginBottom: '5px' }}>* VERIFY CUSTOMER:</label>
                        <select value={jobData.customerId} onChange={e => setJobData({...jobData, customerId: e.target.value})} style={{ width: '100%', padding: '10px', fontSize: '1rem', border: '2px solid #d9534f', outline: 'none', background: '#fff9fa' }}>
                            <option value="">-- Choose Customer --</option>
                            {combinedCustomers.map(c => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
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

    </div>
  );
};

export default CPQTab;