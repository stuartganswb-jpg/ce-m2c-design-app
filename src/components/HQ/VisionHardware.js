import React, { useState, useRef, useEffect, useMemo } from 'react';
import { db } from '../../firebase';
import { doc, setDoc, serverTimestamp, collection, onSnapshot, query, where } from "firebase/firestore";

const VisionHardware = ({ currentUser, activeBrand, visionConfigs }) => {
  const [viewMode, setViewMode] = useState('ENGINEERING');
  const [showQuotePanel, setShowQuotePanel] = useState(false);
  const [isPushingToCPQ, setIsPushingToCPQ] = useState(false);

  const [activeBg, setActiveBg] = useState(null); 
  const [visualTool, setVisualTool] = useState("pan"); 
  const fileInputRef = useRef(null);
  const [calPoints, setCalPoints] = useState([]); 
  const [realInches, setRealInches] = useState("60");
  const [pixelsPerInch, setPixelsPerInch] = useState(4.5); 
  const [isCalibrated, setIsCalibrated] = useState(false);
  
  const [selectedConfigId, setSelectedConfigId] = useState("");
  const [placedItems, setPlacedItems] = useState([]);
  const [activePlacedId, setActivePlacedId] = useState(null);

  const [showEngOverlay, setShowEngOverlay] = useState(false);
  const [engOverlayPos, setEngOverlayPos] = useState({ x: 500, y: 400 });
  const [perspectiveStretch, setPerspectiveStretch] = useState({ L: 0, R: 0 }); 

  const [visScale, setVisScale] = useState(1.0); 
  const [visPan, setVisPan] = useState({ x: 0, y: 0 });
  
  const [engScale, setEngScale] = useState(1.7); 
  const [engPan, setEngPan] = useState({ x: 0, y: 0 });
  const [engTool, setEngTool] = useState("pan"); 
  const [attachments, setAttachments] = useState([]); 
  const [shopNotes, setShopNotes] = useState([]); 
  
  const [libraryParts, setLibraryParts] = useState([]);
  const [globalFinishes, setGlobalFinishes] = useState([]);
  const [outsourceFinishes, setOutsourceFinishes] = useState([]);
  const [collectionsData, setCollectionsData] = useState([]);
  
  const [cpqFlows, setCpqFlows] = useState([]);
  const [dynamicAssets, setDynamicAssets] = useState([]);
  const [globalLists, setGlobalLists] = useState({});

  // QUOTING ENGINE STATE
  const [quoteFlowId, setQuoteFlowId] = useState("");
  const [quoteSelections, setQuoteSelections] = useState({ 
      collection: '', 
      poleId: '', poleFinishId: '', 
      bracketFinishId: '', 
      finialId: '', finialFinishId: '', 
      ringId: '', ringFinishId: '' 
  });
  
  const [dynamicConfigParams, setDynamicConfigParams] = useState({});
  const [stepQuantities, setStepQuantities] = useState({ rings: 0 }); 
  const [flowPins, setFlowPins] = useState([]);

  // ENGINEERING MATH STATE
  const [engData, setEngData] = useState({
    jobName: '', sidemark: '', shape: 'STRAIGHT', inputMode: 'ORDERING',   
    w1: 30, w2: 80, w3: 30, a1: 135, a2: 135, bowDepth: 15,            
    mountLeft: 'OPEN', mountRight: 'OPEN', mountOuter: 'OPEN',      
    endStyle: 'FINIAL', proj: "", bracketId: "", poleDiameter: 1.0, bracketW: 3.0, finialW: 3.5,          
    bracketThickness: 0.25, insideMountDeduct: 0.25, returnRadius: 4.0, gripAllowance: 8.5       
  });

  const [isCustomProj, setIsCustomProj] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState(null);
  const svgRef = useRef(null);
  const innerGroupRef = useRef(null);

  useEffect(() => {
    if (!activeBrand) return;
    const unsubParts = onSnapshot(query(collection(db, "Approved_Designs")), (snapshot) => {
        let docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        docs = docs.filter(d => d.brandId === activeBrand || (d.sharedBrands && d.sharedBrands.includes(activeBrand)));
        setLibraryParts(docs);
    });
    const unsubFinishes = onSnapshot(doc(db, "system", "master_finishes"), (docSnap) => { if (docSnap.exists() && docSnap.data().finishes) setGlobalFinishes(docSnap.data().finishes); });
    const unsubOutsource = onSnapshot(collection(db, "hq_outsource_finishes"), (snap) => { setOutsourceFinishes(snap.docs.map(d => ({id: d.id, ...d.data()}))); });
    const unsubCollections = onSnapshot(collection(db, "hq_collections"), snap => { setCollectionsData(snap.docs.map(d => ({id: d.id, ...d.data()}))); });
    const unsubFlows = onSnapshot(query(collection(db, "cpq_flows")), (snap) => {
        const flows = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(f => f.brandId === activeBrand);
        setCpqFlows(flows);
    });
    const unsubDynamic = onSnapshot(collection(db, "hq_dynamic_data"), (snap) => setDynamicAssets(snap.docs.map(d => ({id: d.id, ...d.data()}))));
    const unsubLists = onSnapshot(doc(db, "system", "master_lists"), (docSnap) => { if (docSnap.exists()) setGlobalLists(docSnap.data()); });

    return () => { unsubParts(); unsubFinishes(); unsubOutsource(); unsubCollections(); unsubFlows(); unsubDynamic(); unsubLists(); };
  }, [activeBrand]);

  const activeFlow = useMemo(() => {
      return cpqFlows.find(f => f.id === quoteFlowId);
  }, [quoteFlowId, cpqFlows]);

  // 🚀 DYNAMIC STEP CATEGORY SNIFFER
  const getStepCategory = (step) => {
      if (!step) return '';
      const t = (step.title || '').toLowerCase();
      const ds = (step.dataSource || '').toLowerCase();
      
      if (ds === 'master_finishes' || t.includes('finish') || t.includes('color') || t.includes('patina')) return 'FINISH';
      if (t.includes('pole') || t.includes('tube') || t.includes('rod') || ds.includes('pole')) return 'POLE';
      if (t.includes('bracket') || ds.includes('bracket')) return 'BRACKET';
      if (t.includes('finial') || ds.includes('finial')) return 'FINIAL';
      if (t.includes('ring') || ds.includes('ring')) return 'RING';
      if (t.includes('splice') || ds.includes('splice')) return 'SPLICE';
      return 'OTHER';
  };

  // 🚀 FETCH SPECIFIC HARDWARE COMPONENT STEPS FROM ACTIVE FLOW
  const getStepForCategory = (cat) => {
      if (!activeFlow) return null;
      return activeFlow.steps.find(s => {
          const isFinish = (s.dataSource || '').toLowerCase() === 'master_finishes' || (s.title || '').toLowerCase().includes('finish');
          if (isFinish) return false; 
          return getStepCategory(s) === cat;
      });
  };

  // 🚀 FETCH FINISH STEPS FOR SPECIFIC COMPONENTS
  const getFinishStep = (compName) => {
      if (!activeFlow) return null;
      const finishSteps = activeFlow.steps.filter(s => {
          const t = (s.title || '').toLowerCase();
          const ds = (s.dataSource || '').toLowerCase();
          return ds === 'master_finishes' || t.includes('finish') || t.includes('color') || t.includes('patina');
      });
      if (finishSteps.length === 0) return null;
      
      const specific = finishSteps.find(s => s.title.toLowerCase().includes(compName.toLowerCase()));
      if (specific) return specific;
      
      const generic = finishSteps.find(s => {
          const t = s.title.toLowerCase();
          return !t.includes('pole') && !t.includes('tube') && !t.includes('bracket') && !t.includes('finial') && !t.includes('ring');
      });
      return generic || finishSteps[0];
  };

  useEffect(() => {
      if (!activeFlow?.linkedAssemblyId) { setFlowPins([]); return; }
      const linkedAsm = libraryParts.find(p => p.id === activeFlow.linkedAssemblyId);
      const searchId = linkedAsm ? linkedAsm.itemId : activeFlow.linkedAssemblyId;
      const q = query(collection(db, "assembly_pins"), where("assemblyId", "==", searchId));
      const unsub = onSnapshot(q, snap => setFlowPins(snap.docs.map(d => d.data())));
      return () => unsub();
  }, [activeFlow, libraryParts]);

  useEffect(() => {
      if (!activeFlow) return;

      let detectedProj = null;
      let detectedEndStyle = null;

      flowPins.forEach(pin => {
          const part = libraryParts.find(p => p.id === pin.partId || p.legacyErpId === pin.legacyErpId);
          if (part) {
              const cData = part.manufacturingSpecs?.customData || {};
              if (!detectedProj && cData.projection) detectedProj = parseFloat(cData.projection);
              if (cData.feeType === 'BENT_RETURN') detectedEndStyle = 'RETURN_BEND';
              if (cData.feeType === 'MITER_RETURN') detectedEndStyle = 'RETURN_MITER';
              if (!detectedEndStyle && part.manufacturingSpecs?.productType === 'FINIAL') detectedEndStyle = 'FINIAL';
          }
      });

      if (!detectedEndStyle && activeFlow.name.toUpperCase().includes("FRENCH RETURN")) {
          detectedEndStyle = 'RETURN_BEND';
      }

      setEngData(prev => {
          const updates = { ...prev };
          let changed = false;
          if (detectedProj && !prev.bracketId && prev.proj !== detectedProj) { updates.proj = detectedProj; changed = true; }
          if (detectedEndStyle && prev.endStyle !== detectedEndStyle) { updates.endStyle = detectedEndStyle; changed = true; }
          return changed ? updates : prev;
      });
      
      if (detectedProj && !engData.bracketId) setIsCustomProj(false);
  }, [activeFlow, flowPins, libraryParts]);

  useEffect(() => {
      if (engData.bracketId) {
          const part = libraryParts.find(p => p.id === engData.bracketId);
          if (part) {
              const cData = part.manufacturingSpecs?.customData || {};
              const pData = part.manufacturingSpecs?.parametric || {};
              
              const proj = parseFloat(cData.projection) || parseFloat(engData.proj) || 0;
              const bw = parseFloat(cData.bracketW || pData.width || pData.bracketW) || 3.0;
              const bt = parseFloat(cData.bracketThickness || pData.thickness || pData.bracketThickness) || 0.25;

              setEngData(prev => {
                  let changed = false;
                  let updates = { ...prev };
                  if (proj && prev.proj !== proj) { updates.proj = proj; changed = true; }
                  if (bw && prev.bracketW !== bw) { updates.bracketW = bw; changed = true; }
                  if (bt && prev.bracketThickness !== bt) { updates.bracketThickness = bt; changed = true; }
                  return changed ? updates : prev;
              });
              
              if (proj) setIsCustomProj(false);
          }
      }
  }, [engData.bracketId, libraryParts]);

  const safeProj = parseFloat(engData.proj) || 0;

  // 🚀 NATIVE OPTIONS - NOW RESPECTS CPQ FLOW RESTRICTIONS
  const getNativeOptions = (categoryString) => {
      const step = getStepForCategory(categoryString);

      return libraryParts.filter(p => {
          if (p.manufacturingSpecs?.customData?.feeType) return false;
          
          const pType = (p.manufacturingSpecs?.productType || p.productType || '').toUpperCase();
          if (!pType.includes(categoryString)) return false;

          const collectionsArray = p.manufacturingSpecs?.collections || (p.manufacturingSpecs?.customData?.collection ? [p.manufacturingSpecs.customData.collection] : []);
          const upperCollections = collectionsArray.map(c => c.toUpperCase());
          const selCollection = (quoteSelections.collection || "").toUpperCase();
          
          if (selCollection && upperCollections.length > 0 && !upperCollections.includes(selCollection)) {
              if (!upperCollections.includes('N/A')) return false; 
          }

          // Force step restrictions from CPQ Flow if present
          if (step && step.allowedOptions?.length > 0) {
              if (!step.allowedOptions.includes(p.id)) return false;
          }

          return true;
      });
  };

  const getFinishOptions = (compName) => {
      const step = getFinishStep(compName);
      const allF = [...globalFinishes, ...outsourceFinishes].map(f => ({ id: f.id, name: f.name, code: f.code }));
      
      if (step && step.allowedOptions?.length > 0) {
          return allF.filter(f => step.allowedOptions.includes(f.id));
      }
      return allF;
  };

  const allBrackets = useMemo(() => {
      const step = getStepForCategory('BRACKET');
      return libraryParts.filter(p => {
          const pt = (p.manufacturingSpecs?.productType || '').toUpperCase();
          if (!pt.includes('BRACKET')) return false;

          const collectionsArray = p.manufacturingSpecs?.collections || (p.manufacturingSpecs?.customData?.collection ? [p.manufacturingSpecs.customData.collection] : []);
          const upperCollections = collectionsArray.map(c => c.toUpperCase());
          const selCollection = (quoteSelections.collection || "").toUpperCase();
          
          if (selCollection && upperCollections.length > 0 && !upperCollections.includes(selCollection)) {
              if (!upperCollections.includes('N/A')) return false; 
          }

          if (step && step.allowedOptions?.length > 0) {
              if (!step.allowedOptions.includes(p.id)) return false;
          }

          return true;
      });
  }, [libraryParts, quoteSelections.collection, activeFlow]);

  const getOptionsForStep = (step) => {
      if (!step || !step.dataSource) return [];
      let options = [];

      const isProdType = globalLists.prodTypes?.includes(step.dataSource);
      const isRoutingType = globalLists.inventoryTypes?.includes(step.dataSource) || globalLists.assemblyTypes?.includes(step.dataSource);

      if (isProdType || isRoutingType) {
          options = libraryParts.filter(p => {
              if (p.manufacturingSpecs?.customData?.feeType) return false;
              if (isProdType && p.manufacturingSpecs?.productType !== step.dataSource && p.productType !== step.dataSource) return false;
              if (isRoutingType && p.routingType !== step.dataSource) return false;
              
              const collectionsArray = p.manufacturingSpecs?.collections || (p.manufacturingSpecs?.customData?.collection ? [p.manufacturingSpecs.customData.collection] : []);
              const upperCollections = collectionsArray.map(c => c.toUpperCase());
              const selCollection = (quoteSelections.collection || "").toUpperCase();
              
              if (selCollection && upperCollections.length > 0 && !upperCollections.includes(selCollection)) {
                  if (!upperCollections.includes('N/A')) return false; 
              }

              const cat = getStepCategory(step);
              if (!isCustomProj && p.manufacturingSpecs?.customData?.projection && safeProj > 0 && cat !== 'BRACKET') {
                  if (parseFloat(p.manufacturingSpecs.customData.projection) !== safeProj) return false;
              }

              return true;
          }).map(p => ({
              id: p.id,
              itemName: p.itemName,
              code: p.legacyErpId
          }));
      } else if (step.dataSource === 'master_finishes') {
          const inHouse = globalFinishes.map(f => ({ id: f.id, itemName: f.name, code: f.code }));
          const outsource = outsourceFinishes.map(f => ({ id: f.id, itemName: f.name }));
          options = [...inHouse, ...outsource];
      } else {
          const customAssets = dynamicAssets.filter(a => a.windowId === step.dataSource);
          if (customAssets.length > 0) {
              options = customAssets.map(a => ({ id: a.id, itemName: a.name, code: a.code }));
          } else if (globalLists[step.dataSource]) {
              options = globalLists[step.dataSource].map(val => ({ id: val, itemName: val }));
          }
      }

      if (step.allowedOptions && step.allowedOptions.length > 0) {
          return options.filter(opt => step.allowedOptions.includes(opt.id));
      }
      return options;
  };

  const uniqueProjections = [...new Set(libraryParts.map(p => p.manufacturingSpecs?.customData?.projection).filter(Boolean))].sort((a,b) => parseFloat(a) - parseFloat(b));

  const rad = (deg) => (deg * Math.PI) / 180;
  const S = 3.5; 
  let mDeduct1=0, mDeduct2=0, wall1=engData.w1, wall2=engData.w2, wall3=engData.w3, pole1=0, pole2=0, pole3=0, sawAngle1=0, sawAngle2=0;
  let bowCX=500, bowCY=250, bowR=0, bowHW_R=0, bowStartAngle=0, bowEndAngle=0, bowWallPath="", bowHWPath="";

  const isLeftInside = engData.shape === 'STRAIGHT' ? engData.mountLeft === 'INSIDE' : engData.mountOuter === 'INSIDE';
  const isRightInside = engData.shape === 'STRAIGHT' ? engData.mountRight === 'INSIDE' : engData.mountOuter === 'INSIDE';
  
  const bendDeductL = (!isLeftInside && engData.endStyle === 'RETURN_BEND') ? (engData.poleDiameter / 2) : 0;
  const bendDeductR = (!isRightInside && engData.endStyle === 'RETURN_BEND') ? (engData.poleDiameter / 2) : 0;
  const imDeductL = isLeftInside ? engData.insideMountDeduct : 0;
  const imDeductR = isRightInside ? engData.insideMountDeduct : 0;

  if (engData.shape === 'STRAIGHT') {
      if (engData.inputMode === 'WALL') { wall2 = engData.w2; pole2 = wall2 - bendDeductL - bendDeductR - imDeductL - imDeductR; } 
      else { pole2 = engData.w2 - bendDeductL - bendDeductR - imDeductL - imDeductR; wall2 = engData.w2; }
  } else if (engData.shape === 'MITERED') {
      mDeduct1 = engData.a1 === 180 ? 0 : safeProj * Math.tan(rad((180 - engData.a1) / 2));
      mDeduct2 = engData.a2 === 180 ? 0 : safeProj * Math.tan(rad((180 - engData.a2) / 2));
      if (engData.inputMode === 'WALL') { pole1 = Math.max(0, wall1 - mDeduct1 - imDeductL); pole2 = Math.max(0, wall2 - mDeduct1 - mDeduct2); pole3 = Math.max(0, wall3 - mDeduct2 - imDeductR); } 
      else { pole1 = engData.w1 - bendDeductL - imDeductL; wall1 = pole1 + mDeduct1 + imDeductL; pole2 = engData.w2; wall2 = pole2 + mDeduct1 + mDeduct2; pole3 = engData.w3 - bendDeductR - imDeductR; wall3 = pole3 + mDeduct2 + imDeductR; }
      sawAngle1 = engData.a1 === 180 ? 0 : 90 - (engData.a1 / 2); sawAngle2 = engData.a2 === 180 ? 0 : 90 - (engData.a2 / 2);
  } else if (engData.shape === 'BOW') {
      const c = engData.w2; const h = engData.bowDepth;
      if (h > 0) {
        const rInput = (h/2) + ((c*c)/(8*h)); const theta = 2 * Math.asin(c / (2 * rInput));
        if (engData.inputMode === 'WALL') { bowR = rInput; bowHW_R = bowR - safeProj; pole2 = Math.max(0, (bowHW_R * theta) - imDeductL - imDeductR); wall2 = c; } 
        else { bowHW_R = rInput; bowR = bowHW_R + safeProj; pole2 = (bowHW_R * theta) - imDeductL - imDeductR; wall2 = 2 * bowR * Math.sin(theta / 2); }
      }
  }

  let endFootprint = 0; let endRawAdd = 0;    
  if (engData.endStyle === 'FINIAL') { endFootprint = engData.finialW; endRawAdd = 0; } 
  else if (engData.endStyle === 'RETURN_MITER') { endFootprint = Math.max(0, (engData.bracketW - engData.poleDiameter) / 2); endRawAdd = 0; } 
  else if (engData.endStyle === 'RETURN_BEND') { endFootprint = Math.max(0, (engData.bracketW - engData.poleDiameter) / 2); endRawAdd = engData.gripAllowance; }

  const addL_TOL = isLeftInside ? 0 : endFootprint; const addR_TOL = isRightInside ? 0 : endFootprint;
  const addL_RAW = isLeftInside ? 0 : endRawAdd; const addR_RAW = isRightInside ? 0 : endRawAdd;
  const orderL = pole1 + bendDeductL + imDeductL; const orderR = pole3 + bendDeductR + imDeductR;
  const orderC = engData.shape === 'STRAIGHT' ? (pole2 + bendDeductL + bendDeductR + imDeductL + imDeductR) : (engData.shape === 'BOW' ? pole2 + imDeductL + imDeductR : pole2);
  const tolLeft = engData.shape === 'MITERED' ? orderL + addL_TOL : 0; const tolRight = engData.shape === 'MITERED' ? orderR + addR_TOL : 0;
  const tolCenter = (engData.shape === 'STRAIGHT' || engData.shape === 'BOW') ? orderC + addL_TOL + addR_TOL : orderC;
  const rawLeft = engData.shape === 'MITERED' ? pole1 + addL_RAW : 0; const rawRight = engData.shape === 'MITERED' ? pole3 + addR_RAW : 0;
  const rawCenter = (engData.shape === 'STRAIGHT' || engData.shape === 'BOW') ? pole2 + addL_RAW + addR_RAW : pole2;
  
  const systemC2C = orderL + orderC + orderR;
  const systemO2O = tolLeft + tolCenter + tolRight;
  const totalPoleRawInches = rawLeft + rawCenter + rawRight;
  
  const poleFeetQty = Math.ceil(totalPoleRawInches / 12) || 0;
  const qtyBrackets = attachments.filter(a => a.type === 'bracket').length;
  const qtySplices = attachments.filter(a => a.type === 'splice').length;
  const qtyMiters = engData.shape === 'MITERED' ? 2 : 0;
  const qtyBends = engData.endStyle === 'RETURN_BEND' ? ((isLeftInside ? 0 : 1) + (isRightInside ? 0 : 1)) : 0;
  const qtyMiterReturns = engData.endStyle === 'RETURN_MITER' ? ((isLeftInside ? 0 : 1) + (isRightInside ? 0 : 1)) : 0;
  const qtyCustomProjBrackets = isCustomProj ? qtyBrackets : 0;
  const qtyFinials = engData.endStyle === 'FINIAL' ? ((isLeftInside ? 0 : 1) + (isRightInside ? 0 : 1)) : 0;
  const disableFinials = engData.endStyle === 'RETURN_BEND' || engData.endStyle === 'RETURN_MITER';
  
  const recRings = Math.ceil(systemO2O / 12) * 4;

  useEffect(() => {
      setStepQuantities(prev => ({ ...prev, rings: prev.rings || recRings }));
  }, [recRings]);

  // 🚀 SYNC QUANTITIES AND AUTO-SELECTORS
  useEffect(() => {
      if (!activeFlow) return;

      let changedQuotes = false;
      let updatesQ = { ...quoteSelections };

      const poleOpts = getNativeOptions('POLE');
      if (poleOpts.length === 1 && updatesQ.poleId !== poleOpts[0].id) { updatesQ.poleId = poleOpts[0].id; changedQuotes = true; }

      const ringOpts = getNativeOptions('RING');
      if (ringOpts.length === 1 && updatesQ.ringId !== ringOpts[0].id) { updatesQ.ringId = ringOpts[0].id; changedQuotes = true; }

      const finialOpts = getNativeOptions('FINIAL');
      if (finialOpts.length === 1 && updatesQ.finialId !== finialOpts[0].id && !disableFinials) { updatesQ.finialId = finialOpts[0].id; changedQuotes = true; }

      const poleFinOpts = getFinishOptions('pole');
      if (poleFinOpts.length === 1 && updatesQ.poleFinishId !== poleFinOpts[0].id) { updatesQ.poleFinishId = poleFinOpts[0].id; changedQuotes = true; }

      const brFinOpts = getFinishOptions('bracket');
      if (brFinOpts.length === 1 && updatesQ.bracketFinishId !== brFinOpts[0].id) { updatesQ.bracketFinishId = brFinOpts[0].id; changedQuotes = true; }

      const ringFinOpts = getFinishOptions('ring');
      if (ringFinOpts.length === 1 && updatesQ.ringFinishId !== ringFinOpts[0].id) { updatesQ.ringFinishId = ringFinOpts[0].id; changedQuotes = true; }

      const finialFinOpts = getFinishOptions('finial');
      if (finialFinOpts.length === 1 && updatesQ.finialFinishId !== finialFinOpts[0].id && !disableFinials) { updatesQ.finialFinishId = finialFinOpts[0].id; changedQuotes = true; }

      if (changedQuotes) setQuoteSelections(updatesQ);
      
      if (allBrackets.length === 1 && engData.bracketId !== allBrackets[0].id) {
          setEngData(prev => ({...prev, bracketId: allBrackets[0].id}));
      }

      setStepQuantities(prev => {
          const updates = { ...prev };
          activeFlow.steps.forEach(step => {
              const cat = getStepCategory(step);
              if (cat === 'SPLICE') updates[step.id] = qtySplices;
              else if (!updates[step.id] && !['POLE','BRACKET','FINIAL','RING','FINISH'].includes(cat)) updates[step.id] = 1; 
          });
          return updates;
      });

      setDynamicConfigParams(prev => {
          let updates = { ...prev };
          let changed = false;
          activeFlow.steps.forEach(step => {
              const opts = getOptionsForStep(step);
              if (opts.length === 1 && prev[step.id] !== opts[0].id) {
                  updates[step.id] = opts[0].id;
                  changed = true;
              }
          });
          return changed ? updates : prev;
      });

  }, [activeFlow, qtySplices, disableFinials, libraryParts, globalFinishes, outsourceFinishes, quoteSelections.collection, allBrackets]);

  const feeSkuSplice = libraryParts.find(p => p.manufacturingSpecs?.customData?.feeType === 'SPLICE');
  const feeSkuMiter = libraryParts.find(p => p.manufacturingSpecs?.customData?.feeType === 'MITER_CUT');
  const feeSkuBend = libraryParts.find(p => p.manufacturingSpecs?.customData?.feeType === 'BENT_RETURN');
  const feeSkuMiterReturn = libraryParts.find(p => p.manufacturingSpecs?.customData?.feeType === 'MITER_RETURN');
  const feeSkuCustomProj = libraryParts.find(p => p.manufacturingSpecs?.customData?.feeType === 'CUSTOM_PROJ');

  const P2 = { x: 500 - (wall2 * S)/2, y: 250 }; const P3 = { x: 500 + (wall2 * S)/2, y: 250 };
  let P1 = P2, P4 = P3, HS = {x: 0, y: 0}, HE = {x: 0, y: 0}, HC1 = {x: 0, y: 0}, HC2 = {x: 0, y: 0}, nL = {x: 0, y: -1}, nR = {x: 0, y: -1}; 

  if (engData.shape === 'STRAIGHT') {
      HS = { x: 500 - (pole2 * S)/2, y: P2.y + safeProj * S }; HE = { x: 500 + (pole2 * S)/2, y: P3.y + safeProj * S }; nL = { x: 0, y: -1 }; nR = { x: 0, y: -1 };
  } else if (engData.shape === 'MITERED') {
      const t1 = rad(180 - engData.a1); const t2 = rad(180 - engData.a2);
      P1 = { x: P2.x - (wall1 * S) * Math.cos(t1), y: P2.y + (wall1 * S) * Math.sin(t1) }; P4 = { x: P3.x + (wall3 * S) * Math.cos(t2), y: P3.y + (wall3 * S) * Math.sin(t2) };
      HC1 = { x: P2.x + (mDeduct1 * S), y: P2.y + (safeProj * S) }; HC2 = { x: P3.x - (mDeduct2 * S), y: P3.y + (safeProj * S) };
      HS = { x: HC1.x - (pole1 * S) * Math.cos(t1), y: HC1.y + (pole1 * S) * Math.sin(t1) }; HE = { x: HC2.x + (pole3 * S) * Math.cos(t2), y: HC2.y + (pole3 * S) * Math.sin(t2) };
      const ndxL = P1.x - HS.x; const ndyL = P1.y - HS.y; const nlenL = Math.sqrt(ndxL*ndxL + ndyL*ndyL) || 1; nL = { x: ndxL/nlenL, y: ndyL/nlenL };
      const ndxR = P4.x - HE.x; const ndyR = P4.y - HE.y; const nlenR = Math.sqrt(ndxR*ndxR + ndyR*ndyR) || 1; nR = { x: ndxR/nlenR, y: ndyR/nlenR };
  } else if (engData.shape === 'BOW') {
      if (engData.bowDepth > 0) {
          const rW_px = bowR * S; const rH_px = bowHW_R * S; bowCX = 500; bowCY = P2.y + rW_px - engData.bowDepth * S;
          bowStartAngle = Math.atan2(P2.y - bowCY, P2.x - bowCX); bowEndAngle = Math.atan2(P3.y - bowCY, P3.x - bowCX);
          if (bowEndAngle < bowStartAngle) bowEndAngle += 2 * Math.PI;
          HS = { x: bowCX + rH_px * Math.cos(bowStartAngle), y: bowCY + rH_px * Math.sin(bowStartAngle) }; HE = { x: bowCX + rH_px * Math.cos(bowEndAngle), y: bowCY + rH_px * Math.sin(bowEndAngle) };
          const ndxL = P2.x - HS.x; const ndyL = P2.y - HS.y; const nlenL = Math.sqrt(ndxL*ndxL + ndyL*ndyL) || 1; nL = { x: ndxL/nlenL, y: ndyL/nlenL };
          const ndxR = P3.x - HE.x; const ndyR = P3.y - HE.y; const nlenR = Math.sqrt(ndxR*ndxR + ndyR*ndyR) || 1; nR = { x: ndxR/nlenR, y: ndyR/nlenR };
          bowWallPath = `M ${P2.x} ${P2.y} A ${rW_px} ${rW_px} 0 0 1 ${P3.x} ${P3.y}`; bowHWPath = `M ${HS.x} ${HS.y} A ${rH_px} ${rH_px} 0 0 1 ${HE.x} ${HE.y}`;
      }
  }

  let drawHS = { ...HS }; let drawHE = { ...HE };
  if (engData.endStyle === 'RETURN_BEND') {
      const r = engData.returnRadius * S;
      if (!isLeftInside) {
          let inVec = {x: 1, y: 0};
          if (engData.shape === 'MITERED') { const dx = HC1.x - HS.x; const dy = HC1.y - HS.y; const len = Math.sqrt(dx*dx + dy*dy) || 1; inVec = {x: dx/len, y: dy/len}; } 
          else if (engData.shape === 'BOW') { const angleShift = r / (bowHW_R * S); bowStartAngle += angleShift; drawHS = { x: bowCX + (bowHW_R*S) * Math.cos(bowStartAngle), y: bowCY + (bowHW_R*S) * Math.sin(bowStartAngle) }; bowHWPath = `M ${drawHS.x} ${drawHS.y} A ${bowHW_R*S} ${bowHW_R*S} 0 0 1 ${drawHE.x} ${drawHE.y}`; }
          if (engData.shape !== 'BOW') drawHS = { x: HS.x + inVec.x * r, y: HS.y + inVec.y * r };
      }
      if (!isRightInside) {
          let inVec = {x: -1, y: 0};
          if (engData.shape === 'MITERED') { const dx = HC2.x - HE.x; const dy = HC2.y - HE.y; const len = Math.sqrt(dx*dx + dy*dy) || 1; inVec = {x: dx/len, y: dy/len}; } 
          else if (engData.shape === 'BOW') { const angleShift = r / (bowHW_R * S); bowEndAngle -= angleShift; drawHE = { x: bowCX + (bowHW_R*S) * Math.cos(bowEndAngle), y: bowCY + (bowHW_R*S) * Math.sin(bowEndAngle) }; bowHWPath = `M ${drawHS.x} ${drawHS.y} A ${bowHW_R*S} ${bowHW_R*S} 0 0 1 ${drawHE.x} ${drawHE.y}`; }
          if (engData.shape !== 'BOW') drawHE = { x: HE.x + inVec.x * r, y: HE.y + inVec.y * r };
      }
  }

  const renderEndTreatment = (isLeft, forceFlatten = false) => {
      const isInside = isLeft ? isLeftInside : isRightInside;
      const startOrig = isLeft ? HS : HE; const stopPoint = isLeft ? drawHS : drawHE; const norm = isLeft ? nL : nR; 
      if (isInside) return forceFlatten ? null : <line x1={startOrig.x - norm.y*15} y1={startOrig.y + norm.x*15} x2={startOrig.x + norm.y*15} y2={startOrig.y - norm.x*15} stroke="#888" strokeWidth="6" />;
      if (engData.endStyle === 'FINIAL') {
          let outVec = {x: -1, y: 0};
          if (engData.shape === 'STRAIGHT') outVec = isLeft ? {x: -1, y: 0} : {x: 1, y: 0};
          else if (engData.shape === 'MITERED') { const dx = (isLeft?HS:HE).x - (isLeft?HC1:HC2).x; const dy = (isLeft?HS:HE).y - (isLeft?HC1:HC2).y; const len = Math.sqrt(dx*dx + dy*dy) || 1; outVec = {x: dx/len, y: dy/len}; }
          else if (engData.shape === 'BOW') { const rx = startOrig.x - bowCX; const ry = startOrig.y - bowCY; const rlen = Math.sqrt(rx*rx + ry*ry) || 1; outVec = isLeft ? {x: ry/rlen, y: -rx/rlen} : {x: -ry/rlen, y: rx/rlen}; }
          const fw = engData.finialW * S;
          return forceFlatten ? <circle cx={startOrig.x + outVec.x * fw} cy="0" r="10" fill="#d4af37" /> : <line x1={startOrig.x} y1={startOrig.y} x2={startOrig.x + outVec.x*fw} y2={startOrig.y + outVec.y*fw} stroke="#d4af37" strokeWidth="6" />;
      }
      if (engData.endStyle === 'RETURN_MITER') {
          const wx = startOrig.x + norm.x * (safeProj * S); const wy = startOrig.y + norm.y * (safeProj * S);
          let outVec = {x: -1, y: 0};
          if (engData.shape === 'STRAIGHT') outVec = isLeft ? {x: -1, y: 0} : {x: 1, y: 0};
          if (engData.shape === 'MITERED') { const dx = (isLeft?HS:HE).x - (isLeft?HC1:HC2).x; const dy = (isLeft?HS:HE).y - (isLeft?HC1:HC2).y; const len = Math.sqrt(dx*dx + dy*dy) || 1; outVec = {x: dx/len, y: dy/len}; }
          if (forceFlatten) return <line x1={startOrig.x} y1="0" x2={startOrig.x} y2="-15" stroke="#d4af37" strokeWidth="8" />;
          return ( <g><line x1={startOrig.x} y1={startOrig.y} x2={wx} y2={wy} stroke="#d4af37" strokeWidth="1.5" /><line x1={startOrig.x + outVec.x*2 - norm.x*2} y1={startOrig.y + outVec.y*2 - norm.y*2} x2={startOrig.x - outVec.x*2 + norm.x*2} y2={startOrig.y - outVec.y*2 + norm.y*2} stroke="#fff" strokeWidth="0.5" /></g> );
      }
      if (engData.endStyle === 'RETURN_BEND') {
          const r = engData.returnRadius * S; const projPx = safeProj * S;
          let outVec = {x: -1, y: 0};
          if (engData.shape === 'STRAIGHT') outVec = isLeft ? {x: -1, y: 0} : {x: 1, y: 0};
          if (engData.shape === 'MITERED') { const dx = (isLeft?HS:HE).x - (isLeft?HC1:HC2).x; const dy = (isLeft?HS:HE).y - (isLeft?HC1:HC2).y; const len = Math.sqrt(dx*dx + dy*dy) || 1; outVec = {x: dx/len, y: dy/len}; }
          if (engData.shape === 'BOW') { const rx = stopPoint.x - bowCX; const ry = stopPoint.y - bowCY; const rlen = Math.sqrt(rx*rx + ry*ry) || 1; outVec = isLeft ? {x: ry/rlen, y: -rx/rlen} : {x: -ry/rlen, y: rx/rlen}; }
          const arcCX = stopPoint.x + norm.x * r; const arcCY = stopPoint.y + norm.y * r; const arcEndX = arcCX + outVec.x * r; const arcEndY = arcCY + outVec.y * r; const sweep = isLeft ? 1 : 0; const wallX = arcEndX + norm.x * (projPx - r); const wallY = arcEndY + norm.y * (projPx - r);
          if (forceFlatten) return <line x1={stopPoint.x} y1="0" x2={stopPoint.x} y2="-15" stroke="#d4af37" strokeWidth="8" />;
          return ( <g><path d={`M ${stopPoint.x} ${stopPoint.y} A ${r} ${r} 0 0 ${sweep} ${arcEndX} ${arcEndY}`} fill="none" stroke="#d4af37" strokeWidth="1.5" />{projPx > r && <line x1={arcEndX} y1={arcEndY} x2={wallX} y2={wallY} stroke="#d4af37" strokeWidth="1.5" />}</g> );
      }
      return null;
  };

  const renderHardwareElevation = () => {
      const eHSx = drawHS.x - perspectiveStretch.L; const eHEx = drawHE.x + perspectiveStretch.R;
      return (
          <g>
              {engData.shape === 'STRAIGHT' && <line x1={eHSx} y1="0" x2={eHEx} y2="0" stroke="#d4af37" strokeWidth="8" />}
              {engData.shape === 'MITERED' && ( <g><polyline points={`${eHSx},0 ${HC1.x},0 ${HC2.x},0 ${eHEx},0`} fill="none" stroke="#d4af37" strokeWidth="8" strokeLinejoin="miter" /><line x1={HC1.x} y1="-5" x2={HC1.x} y2="5" stroke="#000" strokeWidth="1" opacity="0.5" /><line x1={HC2.x} y1="-5" x2={HC2.x} y2="5" stroke="#000" strokeWidth="1" opacity="0.5" /></g> )}
              {engData.shape === 'BOW' && <line x1={eHSx} y1="0" x2={eHEx} y2="0" stroke="#d4af37" strokeWidth="8" />}
              
              {attachments.map(att => {
                  let seg = null;
                  if (engData.shape === 'STRAIGHT') { if(att.segId===2) seg = { pA: HS, pB: HE, len: pole2, norm: {x:0, y:-1}, nA: "L.Edge", nB: "R.Edge" }; }
                  else if (engData.shape === 'MITERED') {
                      if (att.segId===1) seg = { pA: HS, pB: HC1, len: pole1, norm: nL, nA: "L.Edge", nB: "L.Miter" };
                      if (att.segId===2) seg = { pA: HC1, pB: HC2, len: pole2, norm: {x:0, y:-1}, nA: "L.Miter", nB: "R.Miter" };
                      if (att.segId===3) seg = { pA: HC2, pB: HE, len: pole3, norm: nR, nA: "R.Miter", nB: "R.Edge" };
                  } else if (engData.shape === 'BOW') {
                      seg = { pA: HS, pB: HE, len: pole2, norm: {x:0, y:-1}, nA: "L.Edge", nB: "R.Edge", isBow: true };
                  }
                  if (!seg) return null;

                  const nX = seg.norm ? seg.norm.x : 0;
                  const nY = seg.norm ? seg.norm.y : -1;

                  const distFromA = att.ref === 'START' ? att.distInches : (seg.len - att.distInches);
                  const t = distFromA / seg.len; let x = 0; let y = 0;
                  if (seg.isBow) { const angle = bowStartAngle + t * (bowEndAngle - bowStartAngle); const rH_px = bowHW_R * S; x = bowCX + rH_px * Math.cos(angle); y = bowCY + rH_px * Math.sin(angle); } 
                  else { x = seg.pA.x + t * (seg.pB.x - seg.pA.x); y = seg.pA.y + t * (seg.pB.y - seg.pA.y); }

                  return (
                      <g key={att.id}>
                          {att.type === 'bracket' ? (
                              <g>
                                  <circle cx={x} cy={y} r="4" fill="#28a745" />
                                  <line x1={x} y1={y} x2={x + nX * (safeProj * S)} y2={y + nY * (safeProj * S)} stroke="#999" strokeWidth="2" />
                              </g>
                          ) : (
                              <g>
                                  <line x1={x - nX*8 - nY*4} y1={y - nY*8 + nX*4} x2={x + nX*8 - nY*4} y2={y + nY*8 + nX*4} stroke="#d9534f" strokeWidth="2" />
                                  <line x1={x - nX*8 + nY*4} y1={y - nY*8 - nX*4} x2={x + nX*8 + nY*4} y2={y + nY*8 - nX*4} stroke="#d9534f" strokeWidth="2" />
                              </g>
                          )}
                          <line x1={x} y1={y-5} x2={x} y2={y-80} stroke={att.type==='bracket'?'#28a745':'#d9534f'} strokeWidth="1" strokeDasharray="2,2" />
                          <foreignObject x={x - 55} y={y - 135} width="110" height="50" style={{ overflow: 'visible' }}>
                              <div style={{ background: '#fff', border: `2px solid ${att.type==='bracket'?'#28a745':'#d9534f'}`, display: 'flex', flexDirection: 'column', padding: '4px', borderRadius: '4px', boxShadow: '0 2px 5px rgba(0,0,0,0.3)' }}><input type="number" value={att.distInches} step="0.125" onChange={(e) => handleUpdateAttachmentDist(att.id, e.target.value)} onPointerDown={e => e.stopPropagation()} style={{ width: '100%', fontSize: '12px', fontWeight: 'bold', textAlign: 'center', border: 'none', background: '#e9ecef', outline: 'none' }} /><span style={{ fontSize: '9px', color: '#666', textAlign: 'center', margin: '2px 0' }}>from {att.ref === 'START' ? seg.nA : seg.nB}</span><input type="text" placeholder="Notes..." value={att.note||''} onChange={(e) => handleUpdateAttachmentNote(att.id, e.target.value)} onPointerDown={e => e.stopPropagation()} style={{ width: '100%', fontSize: '10px', border: '1px solid #ccc', outline: 'none', textAlign: 'center' }} /></div>
                          </foreignObject>
                      </g>
                  );
              })}
              <g transform={`translate(${-perspectiveStretch.L}, 0)`}>{renderEndTreatment(true, true)}</g>
              <g transform={`translate(${perspectiveStretch.R}, 0)`}>{renderEndTreatment(false, true)}</g>
          </g>
      );
  };

  const renderDimLine = (pA, pB, offsetDir, offsetDist, label) => {
      const ox = offsetDir.x * offsetDist; const oy = offsetDir.y * offsetDist; const sp = { x: pA.x + ox, y: pA.y + oy }; const ep = { x: pB.x + ox, y: pB.y + oy }; const mid = { x: (sp.x + ep.x)/2, y: (sp.y + ep.y)/2 };
      return (
          <g>
              <line x1={pA.x + offsetDir.x*2} y1={pA.y + offsetDir.y*2} x2={sp.x + offsetDir.x*2} y2={sp.y + offsetDir.y*2} stroke="#ccc" strokeWidth="0.5" />
              <line x1={pB.x + offsetDir.x*2} y1={pB.y + offsetDir.y*2} x2={ep.x + offsetDir.x*2} y2={ep.y + offsetDir.y*2} stroke="#ccc" strokeWidth="0.5" />
              <line x1={sp.x} y1={sp.y} x2={ep.x} y2={ep.y} stroke="#007bff" strokeWidth="0.5" strokeDasharray="2,2" />
              <line x1={sp.x - 2 + offsetDir.x*2} y1={sp.y - 2 + offsetDir.y*2} x2={sp.x + 2 - offsetDir.x*2} y2={sp.y + 2 - offsetDir.y*2} stroke="#007bff" strokeWidth="1" />
              <line x1={ep.x - 2 + offsetDir.x*2} y1={ep.y - 2 + offsetDir.y*2} x2={ep.x + 2 - offsetDir.x*2} y2={ep.y + 2 - offsetDir.y*2} stroke="#007bff" strokeWidth="1" />
              <rect x={mid.x - 35} y={mid.y - 9} width="70" height="18" fill="#f8f9fa" />
              <text x={mid.x} y={mid.y + 4} fill="#007bff" fontSize="12" fontWeight="bold" textAnchor="middle">{label}</text>
          </g>
      );
  };

  const handleUpdateAttachmentDist = (id, newDist) => { setAttachments(atts => atts.map(a => a.id === id ? { ...a, distInches: parseFloat(newDist) || 0 } : a)); };
  const handleUpdateAttachmentNote = (id, text) => { setAttachments(atts => atts.map(a => a.id === id ? { ...a, note: text } : a)); };
  const handleUpdateShopNote = (id, text) => { setShopNotes(notes => notes.map(n => n.id === id ? { ...n, text: text } : n)); };

  const getAdjustedSvgPoint = (clientX, clientY) => {
    const svg = svgRef.current; const group = innerGroupRef.current;
    if (!svg || !group) return null;
    try {
        const pt = svg.createSVGPoint(); pt.x = clientX; pt.y = clientY;
        return pt.matrixTransform(group.getScreenCTM().inverse());
    } catch(err) { return null; }
  };

  const onPointerDown = (e) => {
    try { e.target.setPointerCapture(e.pointerId); } catch(err) {}
    if (viewMode === 'VISUAL' && visualTool === "pan") { setIsPanning(true); setPanStart({ clientX: e.clientX, clientY: e.clientY }); return; }
    if (viewMode === 'ENGINEERING' && engTool === "pan") { setIsPanning(true); setPanStart({ clientX: e.clientX, clientY: e.clientY }); return; }

    const pt = getAdjustedSvgPoint(e.clientX, e.clientY);
    if (!pt) return; 

    if (viewMode === 'VISUAL' && visualTool === "calibrate") {
      if (calPoints.length >= 2) { setCalPoints([pt]); setIsCalibrated(false); } 
      else {
        const updatedPoints = [...calPoints, pt]; setCalPoints(updatedPoints);
        if (updatedPoints.length === 2) { 
           const pxDist = Math.sqrt(Math.pow(updatedPoints[1].x - updatedPoints[0].x, 2) + Math.pow(updatedPoints[1].y - updatedPoints[0].y, 2));
           const val = parseFloat(realInches) || 0;
           if (val > 0) { setPixelsPerInch(pxDist / val); setEngData(prev => ({ ...prev, w2: val })); }
           setIsCalibrated(true); setVisualTool("pan"); 
        }
      }
      return;
    }

    if (viewMode === 'ENGINEERING') {
        if (engTool === 'note') { setShopNotes([...shopNotes, { id: Date.now(), x: pt.x, y: pt.y, text: '' }]); setEngTool('pan'); return; }
        if (engTool === 'bracket' || engTool === 'splice') {
            const hwSegments = [];
            if (engData.shape === 'STRAIGHT') { hwSegments.push({ id: 2, pA: HS, pB: HE, len: pole2, norm: {x:0, y:-1}, nA: "L.Edge", nB: "R.Edge" }); }
            else if (engData.shape === 'MITERED') {
                hwSegments.push({ id: 1, pA: HS, pB: HC1, len: pole1, norm: nL, nA: "L.Edge", nB: "L.Miter" });
                hwSegments.push({ id: 2, pA: HC1, pB: HC2, len: pole2, norm: {x:0, y:-1}, nA: "L.Miter", nB: "R.Miter" });
                hwSegments.push({ id: 3, pA: HC2, pB: HE, len: pole3, norm: nR, nA: "R.Miter", nB: "R.Edge" });
            } else if (engData.shape === 'BOW') { 
                hwSegments.push({ id: 2, pA: HS, pB: HE, len: pole2, norm: {x:0, y:-1}, nA: "L.Edge", nB: "R.Edge", isBow: true }); 
            }
            
            let closestSeg = null; let minDist = Infinity; let distFromA = 0;
            hwSegments.forEach(seg => {
                const dx = seg.pB.x - seg.pA.x; const dy = seg.pB.y - seg.pA.y;
                const lenSq = dx*dx + dy*dy; if (lenSq === 0) return;
                const t = Math.max(0, Math.min(1, ((pt.x - seg.pA.x)*dx + (pt.y - seg.pA.y)*dy) / lenSq));
                const px = seg.pA.x + t * dx; const py = seg.pA.y + t * dy;
                const dSq = Math.pow(pt.x - px, 2) + Math.pow(pt.y - py, 2);
                if (dSq < minDist) { minDist = dSq; closestSeg = seg; distFromA = t * seg.len; }
            });
            if (closestSeg) {
                let finalDist = distFromA;
                if (engTool === 'splice') { const center = closestSeg.len / 2; if (Math.abs(finalDist - center) < (closestSeg.len * 0.15)) finalDist = center; }
                let ref = 'START'; let displayDist = finalDist;
                if (finalDist > closestSeg.len / 2) { ref = 'END'; displayDist = closestSeg.len - finalDist; }
                setAttachments([...attachments, { id: Date.now(), type: engTool, segId: closestSeg.id, distInches: displayDist, ref: ref, note: '' }]);
            }
        }
    }
  };

  const onPointerMove = (e) => {
    if (isPanning && panStart) {
      if (!svgRef.current || !innerGroupRef.current) return;
      try {
          const svg = svgRef.current;
          const ctm = innerGroupRef.current.getScreenCTM();
          if (!ctm) return;
          const ptC = svg.createSVGPoint(); ptC.x = e.clientX; ptC.y = e.clientY;
          const ptS = svg.createSVGPoint(); ptS.x = panStart.clientX; ptS.y = panStart.clientY;
          const inv = ctm.inverse();
          const dx = ptC.matrixTransform(inv).x - ptS.matrixTransform(inv).x;
          const dy = ptC.matrixTransform(inv).y - ptS.matrixTransform(inv).y;
          if (viewMode === 'VISUAL') setVisPan(prev => ({ x: prev.x + dx, y: prev.y + dy })); 
          else setEngPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
          setPanStart({ clientX: e.clientX, clientY: e.clientY });
      } catch(err) {}
    }
  };

  const onPointerUp = () => setIsPanning(false);

  const handleFileUpload = (e) => {
    if (e.target.files[0]) {
      setActiveBg({ name: e.target.files[0].name, url: URL.createObjectURL(e.target.files[0]) });
      setPlacedItems([]); setCalPoints([]); setIsCalibrated(false); 
      setVisScale(1); setVisPan({ x: 0, y: 0 }); setVisualTool("calibrate"); 
    }
  };
  
  const handleDropConfig = () => {
    const config = visionConfigs.find(c => c.id === selectedConfigId);
    if (!config || !isCalibrated) return;
    const realWidthInches = config.specs?.w2 || config.specs?.width || 80;
    const itemWidthPx = realWidthInches * pixelsPerInch; const itemHeightPx = 6 * pixelsPerInch;
    setPlacedItems([...placedItems, { id: `PLACED-${Date.now()}`, configId: config.id, name: config.jobName || config.sidemark || config.id, x: 500 - itemWidthPx/2, y: 400 - itemHeightPx/2, width: itemWidthPx, height: itemHeightPx, color: '#007bff', label: config.sidemark || "Configured Assembly", realWidth: realWidthInches }]);
    setVisualTool("pan"); 
  };

  const moveItem = (dir) => {
    if (!activePlacedId) return;
    let nx = 0; let ny = 0;
    if (dir === 'up') ny -= 2; if (dir === 'down') ny += 2;
    if (dir === 'left') nx -= 2; if (dir === 'right') nx += 2;
    if (activePlacedId === 'ENG_OVERLAY') { setEngOverlayPos(prev => ({ x: prev.x + nx, y: prev.y + ny })); return; }
    setPlacedItems(placedItems.map(item => { if (item.id !== activePlacedId) return item; return { ...item, x: item.x + nx, y: item.y + ny }; }));
  };

  const removeItem = (id) => { 
      if (id === 'ENG_OVERLAY') { setShowEngOverlay(false); setActivePlacedId(null); setPerspectiveStretch({L:0, R:0}); return; }
      setPlacedItems(placedItems.filter(i => i.id !== id)); if (activePlacedId === id) setActivePlacedId(null); 
  };

  const handlePushToCPQ = async () => {
      if (!quoteSelections.poleId) return alert("Please select a Pole / Tube to proceed.");
      if (engData.proj > 0 && !engData.bracketId) return alert("Please select a Bracket in the Fabrication Settings to proceed.");

      const hasMissingRequirements = activeFlow?.steps?.some(step => {
          if (step.type === 'DIMENSIONS') return false; 
          
          const cat = getStepCategory(step);
          if (['POLE','BRACKET','FINIAL','RING','FINISH'].includes(cat)) return false; 
          
          if (step.required && !dynamicConfigParams[step.id]) return true;
          return false;
      });

      if (hasMissingRequirements) return alert("Please complete all required dynamic options in the configuration.");
      
      setIsPushingToCPQ(true);
      const draftId = `QUOTE-${Date.now()}`;
      
      const mappedQuantities = {
          pole: poleFeetQty,
          bracket: qtyBrackets,
          ring: stepQuantities.rings || recRings,
          finial: qtyFinials,
          splice: qtySplices,
          miter: qtyMiters,
          bend: qtyBends,
          miterReturn: qtyMiterReturns,
          customProj: qtyCustomProjBrackets
      };

      if (activeFlow) {
          activeFlow.steps.forEach(step => {
              const cat = getStepCategory(step);
              if (!['POLE','BRACKET','FINIAL','RING','FINISH'].includes(cat)) {
                  mappedQuantities[step.id] = stepQuantities[step.id] || 1;
              }
          });
      }

      const payload = { 
          id: draftId, brandId: activeBrand, category: 'HARDWARE', status: 'DRAFT_FROM_VISION', 
          jobName: engData.jobName, sidemark: engData.sidemark, 
          linkedAssemblyId: activeFlow?.linkedAssemblyId || null,
          linkedCpqFlowId: activeFlow?.id || null, 
          flowId: activeFlow?.id || null,          
          cpqFlowId: activeFlow?.id || null,       
          specs: {
              collection: quoteSelections.collection,
              poleId: quoteSelections.poleId,
              poleFinishId: quoteSelections.poleFinishId,
              bracketId: engData.bracketId,
              bracketFinishId: quoteSelections.bracketFinishId,
              finialId: quoteSelections.finialId,
              finialFinishId: quoteSelections.finialFinishId,
              ringId: quoteSelections.ringId,
              ringFinishId: quoteSelections.ringFinishId,
              quantities: mappedQuantities,
              ...dynamicConfigParams
          }, 
          spatialData: { ...engData, attachments, shopNotes }, 
          author: currentUser, createdAt: serverTimestamp() 
      };
      
      try { await setDoc(doc(db, "cpq_drafts", draftId), payload); alert("✅ Configuration pushed to CPQ Cart!"); setShowQuotePanel(false); } 
      catch (e) { console.error(e); alert("Error pushing to CPQ."); } 
      finally { setIsPushingToCPQ(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', fontFamily: 'monospace', backgroundColor: '#e5e5e5', minHeight: '100vh', overflow: 'hidden' }}>
      
      <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '5px 5px 0 #000' }}>
        <div><h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.4rem', color: '#007bff' }}>9. Client Vision System</h2><span style={{ fontSize: '0.7rem', color: '#666' }}>DRAPERY HARDWARE ENGINE</span></div>
        <div style={{ display: 'flex', gap: '10px', background: '#eee', padding: '5px', border: '2px solid #000' }}>
          <button onClick={() => { setViewMode('VISUAL'); setShowQuotePanel(false); }} style={{ padding: '10px 20px', background: viewMode === 'VISUAL' && !showQuotePanel ? '#007bff' : 'transparent', color: viewMode === 'VISUAL' && !showQuotePanel ? '#fff' : '#666', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>🖼️ VISUAL OVERLAY</button>
          <button onClick={() => { setViewMode('ENGINEERING'); setShowQuotePanel(false); }} style={{ padding: '10px 20px', background: viewMode === 'ENGINEERING' && !showQuotePanel ? '#d9534f' : 'transparent', color: viewMode === 'ENGINEERING' && !showQuotePanel ? '#fff' : '#666', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>📐 TOP-DOWN BOM</button>
        </div>
        <button onClick={() => setShowQuotePanel(!showQuotePanel)} style={{ padding: '10px 20px', background: showQuotePanel ? '#000' : '#28a745', color: '#fff', fontWeight: 'bold', border: 'none', cursor: 'pointer', borderRadius: '4px', boxShadow: '3px 3px 0 rgba(0,0,0,0.2)' }}>{showQuotePanel ? "🔙 BACK TO DRAWING" : "💲 CONFIGURE & QUOTE ➔"}</button>
      </div>

      <div style={{ display: 'flex', gap: '20px', alignItems: 'stretch', flex: 1 }}>
          
          {!showQuotePanel && (
            <div style={{ width: viewMode === 'VISUAL' ? '340px' : '480px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '15px' }}>
                
                {viewMode === 'ENGINEERING' && (
                    <div style={{ background: '#e6f2ff', border: '2px solid #007bff' }}>
                        <div style={{ padding: '10px', background: '#007bff', color: '#fff', fontWeight: 'bold', fontSize: '0.8rem' }}>1. SYSTEM ARCHITECTURE (CPQ FLOW)</div>
                        <div style={{ padding: '15px' }}>
                            <select value={quoteFlowId} onChange={e => { setQuoteFlowId(e.target.value); setDynamicConfigParams({}); }} style={{ width: '100%', padding: '12px', border: '2px solid #007bff', fontWeight: 'bold', fontSize: '1rem' }}>
                                <option value="">-- SELECT MATCHING CPQ FLOW --</option>
                                {cpqFlows.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                            </select>
                        </div>
                    </div>
                )}

                {viewMode === 'VISUAL' ? (
                  <>
                    <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ padding: '10px', background: '#000', color: '#fff', fontWeight: 'bold', fontSize: '0.8rem' }}>FILE UPLOAD</div>
                        <div style={{ padding: '15px' }}><input type="file" accept="image/png, image/jpeg" ref={fileInputRef} onChange={handleFileUpload} style={{ display: 'none' }} /><button onClick={() => fileInputRef.current.click()} style={{ width: '100%', padding: '10px', background: '#fff', color: '#007bff', fontWeight: 'bold', border: '2px dashed #007bff', cursor: 'pointer' }}>📂 SELECT FRONT ELEVATION</button></div>
                    </div>
                    <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', opacity: activeBg ? 1 : 0.5 }}>
                        <div style={{ padding: '10px', background: visualTool === 'calibrate' ? '#007bff' : '#000', color: '#fff', fontWeight: 'bold', fontSize: '0.8rem' }}>CALIBRATE SCALE</div>
                        <div style={{ padding: '15px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <div><label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>KNOWN DIMENSION (INCHES):</label><input type="number" value={realInches} onChange={(e) => { const val = e.target.value; setRealInches(val); if(calPoints.length===2 && parseFloat(val) > 0) { setPixelsPerInch(Math.sqrt(Math.pow(calPoints[1].x - calPoints[0].x, 2) + Math.pow(calPoints[1].y - calPoints[0].y, 2)) / parseFloat(val)); setEngData(prev => ({ ...prev, w2: val })); } }} disabled={!activeBg} style={{ width: '100%', padding: '8px', border: '2px solid #000', fontWeight: 'bold', fontSize: '1rem', background: activeBg ? '#fff' : '#eee', boxSizing: 'border-box' }} /></div>
                            <div style={{ display: 'flex', gap: '5px' }}>
                                <button onClick={() => setVisualTool("calibrate")} disabled={!activeBg} style={{ flex: 1, padding: '10px', background: visualTool === "calibrate" ? '#007bff' : '#eee', color: visualTool === "calibrate" ? '#fff' : '#000', fontWeight: 'bold', border: '2px solid #000', cursor: activeBg ? 'pointer' : 'not-allowed' }}>📏 {calPoints.length === 1 ? "CLICK POINT 2..." : (isCalibrated ? "RE-DRAW LINE" : "DRAW LINE")}</button>
                                {calPoints.length > 0 && <button onClick={() => { setCalPoints([]); setIsCalibrated(false); setVisualTool("calibrate"); }} style={{ padding: '10px', background: '#d9534f', color: '#fff', fontWeight: 'bold', border: '2px solid #000', cursor: 'pointer' }} title="Clear Calibration">✖️</button>}
                            </div>
                        </div>
                    </div>
                    <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', opacity: isCalibrated ? 1 : 0.5 }}>
                        <div style={{ padding: '10px', background: '#28a745', color: '#fff', fontWeight: 'bold', fontSize: '0.8rem' }}>DROP CPQ CONFIG</div>
                        <div style={{ padding: '15px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <select value={selectedConfigId} onChange={(e) => setSelectedConfigId(e.target.value)} disabled={!isCalibrated || visionConfigs.length === 0} style={{ width: '100%', padding: '10px', border: '2px solid #000', fontWeight: 'bold', background: isCalibrated ? '#fff' : '#eee', boxSizing: 'border-box' }}>
                                {visionConfigs.length === 0 && <option value="">No configs found.</option>}
                                {visionConfigs.map(cfg => <option key={cfg.id} value={cfg.id}>{cfg.jobName || cfg.sidemark || cfg.id}</option>)}
                            </select>
                            <button onClick={handleDropConfig} disabled={!isCalibrated || visionConfigs.length === 0} style={{ width: '100%', padding: '12px', background: '#28a745', color: '#fff', fontWeight: 'bold', border: 'none', cursor: isCalibrated && visionConfigs.length > 0 ? 'pointer' : 'not-allowed', opacity: isCalibrated && visionConfigs.length > 0 ? 1 : 0.5 }}>➕ PLACE IN ROOM</button>
                        </div>
                    </div>
                    {activePlacedId && (
                        <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <div style={{ fontSize: '0.75rem', fontWeight: 'bold', borderBottom: '1px solid #eee', paddingBottom: '4px' }}>NUDGE POSITION COCKPIT</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '5px', width: '150px', margin: '0 auto' }}>
                                <div></div><button onClick={() => moveItem('up')} style={{ padding: '8px', cursor: 'pointer', fontWeight: 'bold' }}>▲</button><div></div>
                                <button onClick={() => moveItem('left')} style={{ padding: '8px', cursor: 'pointer', fontWeight: 'bold' }}>◀</button>
                                <button onClick={() => { setVisScale(1.0); setVisPan({x:0, y:0}); }} style={{ padding: '8px', fontSize: '0.6rem', cursor: 'pointer' }}>CTR</button>
                                <button onClick={() => moveItem('right')} style={{ padding: '8px', cursor: 'pointer', fontWeight: 'bold' }}>▶</button>
                                <div></div><button onClick={() => moveItem('down')} style={{ padding: '8px', cursor: 'pointer', fontWeight: 'bold' }}>▼</button><div></div>
                            </div>
                            {activePlacedId === 'ENG_OVERLAY' && (
                                <div style={{ marginTop: '10px', borderTop: '1px solid #eee', paddingTop: '10px' }}>
                                    <div style={{ fontSize: '0.65rem', fontWeight: 'bold', marginBottom: '5px', color: '#007bff' }}>PERSPECTIVE TWEAKS (VISUAL ONLY)</div>
                                    <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}><span style={{ fontSize: '0.6rem', width: '40px' }}>L-POLE:</span><input type="range" min="-150" max="150" value={perspectiveStretch.L} onChange={(e) => setPerspectiveStretch(prev => ({...prev, L: parseInt(e.target.value)}))} style={{ flex: 1 }} /></div>
                                    <div style={{ display: 'flex', gap: '5px', alignItems: 'center', marginTop: '5px' }}><span style={{ fontSize: '0.6rem', width: '40px' }}>R-POLE:</span><input type="range" min="-150" max="150" value={perspectiveStretch.R} onChange={(e) => setPerspectiveStretch(prev => ({...prev, R: parseInt(e.target.value)}))} style={{ flex: 1 }} /></div>
                                </div>
                            )}
                            <button onClick={() => removeItem(activePlacedId)} style={{ width: '100%', padding: '6px', background: '#fff', color: '#d9534f', border: '1px solid #d9534f', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.7rem', marginTop: '5px' }}>REMOVE SELECTED</button>
                        </div>
                    )}
                  </>
                ) : (
                  <>
                    <div style={{ background: '#fff', border: '2px solid #000' }}>
                        <div style={{ padding: '10px', background: '#000', color: '#fff', fontWeight: 'bold', fontSize: '0.8rem', display: 'flex', justifyContent: 'space-between' }}>
                            <span>2. SPATIAL PARAMETERS</span>
                            <select value={engData.inputMode} onChange={e => setEngData({...engData, inputMode: e.target.value})} style={{ fontSize: '0.65rem', background: '#444', color: '#fff', border: 'none', outline: 'none' }}><option value="ORDERING">USE ORDERING LENGTH (POLE)</option><option value="WALL">USE WALL DIMENSIONS</option></select>
                        </div>
                        <div style={{ padding: '15px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <div style={{ display: 'flex', gap: '10px' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>BAY CONFIGURATION:</label>
                                    <select value={engData.shape} onChange={e => setEngData({...engData, shape: e.target.value})} style={{ width: '100%', padding: '6px', border: '1px solid #ccc' }}><option value="STRAIGHT">STRAIGHT POLE</option><option value="MITERED">MITERED BAY (3-SEG)</option><option value="BOW">CURVED BOW</option></select>
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#d9534f' }}>MOUNT (WALL/WALL):</label>
                                    {engData.shape === 'STRAIGHT' ? (
                                        <div style={{ display: 'flex', gap: '5px' }}>
                                            <select value={engData.mountLeft} onChange={e => setEngData({...engData, mountLeft: e.target.value})} style={{ flex: 1, padding: '6px', border: '1px solid #d9534f' }}><option value="OPEN">L: OPEN</option><option value="INSIDE">L: INSIDE</option><option value="CEILING">L: CEILING</option></select>
                                            <select value={engData.mountRight} onChange={e => setEngData({...engData, mountRight: e.target.value})} style={{ flex: 1, padding: '6px', border: '1px solid #d9534f' }}><option value="OPEN">R: OPEN</option><option value="INSIDE">R: INSIDE</option><option value="CEILING">R: CEILING</option></select>
                                        </div>
                                    ) : (
                                        <select value={engData.mountOuter} onChange={e => setEngData({...engData, mountOuter: e.target.value})} style={{ width: '100%', padding: '6px', border: '1px solid #d9534f', fontWeight: 'bold' }}><option value="OPEN">OPEN ENDS (WALL)</option><option value="INSIDE">INSIDE (WALL TO WALL)</option><option value="CEILING">CEILING MOUNT</option></select>
                                    )}
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '5px' }}>
                                {engData.shape === 'MITERED' && <div style={{ flex: 1 }}><label style={{ fontSize: '0.6rem', fontWeight: 'bold' }}>{engData.inputMode === 'ORDERING' ? 'L ORDERING (IN):' : 'LEFT WALL (IN):'}</label><input type="number" value={engData.w1} onChange={e => setEngData({...engData, w1: parseFloat(e.target.value)||0})} style={{ width: '100%', padding: '6px', border: '1px solid #ccc', boxSizing: 'border-box' }} /></div>}
                                <div style={{ flex: 1 }}><label style={{ fontSize: '0.6rem', fontWeight: 'bold' }}>{engData.shape === 'BOW' ? 'CHORD W:' : (engData.inputMode === 'ORDERING' ? 'C ORDERING (IN):' : 'CENTER WALL (IN):')}</label><input type="number" value={engData.w2} onChange={e => setEngData({...engData, w2: parseFloat(e.target.value)||0})} style={{ width: '100%', padding: '6px', border: '1px solid #ccc', boxSizing: 'border-box' }} /></div>
                                {engData.shape === 'MITERED' && <div style={{ flex: 1 }}><label style={{ fontSize: '0.6rem', fontWeight: 'bold' }}>{engData.inputMode === 'ORDERING' ? 'R ORDERING (IN):' : 'RIGHT WALL (IN):'}</label><input type="number" value={engData.w3} onChange={e => setEngData({...engData, w3: parseFloat(e.target.value)||0})} style={{ width: '100%', padding: '6px', border: '1px solid #ccc', boxSizing: 'border-box' }} /></div>}
                                {engData.shape === 'BOW' && <div style={{ flex: 1 }}><label style={{ fontSize: '0.6rem', fontWeight: 'bold' }}>BOW DEPTH:</label><input type="number" value={engData.bowDepth} onChange={e => setEngData({...engData, bowDepth: parseFloat(e.target.value)||0})} style={{ width: '100%', padding: '6px', border: '1px solid #ccc', boxSizing: 'border-box' }} /></div>}
                            </div>
                            {engData.shape === 'MITERED' && (
                                <div style={{ display: 'flex', gap: '5px' }}>
                                    <div style={{ flex: 1 }}><label style={{ fontSize: '0.6rem', fontWeight: 'bold' }}>L ANGLE (DEG):</label><input type="number" value={engData.a1} onChange={e => setEngData({...engData, a1: parseFloat(e.target.value)||0})} style={{ width: '100%', padding: '6px', border: '1px solid #ccc', boxSizing: 'border-box' }} /></div>
                                    <div style={{ flex: 1 }}><label style={{ fontSize: '0.6rem', fontWeight: 'bold' }}>R ANGLE (DEG):</label><input type="number" value={engData.a2} onChange={e => setEngData({...engData, a2: parseFloat(e.target.value)||0})} style={{ width: '100%', padding: '6px', border: '1px solid #ccc', boxSizing: 'border-box' }} /></div>
                                </div>
                            )}
                        </div>
                    </div>
                    <div style={{ background: '#fff', border: '2px solid #000' }}>
                        <div style={{ padding: '10px', background: '#000', color: '#fff', fontWeight: 'bold', fontSize: '0.8rem' }}>3. FABRICATION SETTINGS</div>
                        <div style={{ padding: '15px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <div style={{ display: 'flex', gap: '10px' }}>
                                <div style={{ flex: 1.5 }}>
                                    <label style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#d4af37' }}>SELECT BRACKET (AUTO-SYNCS DIMS):</label>
                                    <select 
                                        value={engData.bracketId || ''} 
                                        onChange={e => setEngData(prev => ({ ...prev, bracketId: e.target.value }))}
                                        style={{ width: '100%', padding: '6px', border: '2px solid #d4af37', fontWeight: 'bold', boxSizing: 'border-box' }}
                                    >
                                        <option value="">-- SELECT BRACKET --</option>
                                        {allBrackets.map(b => <option key={b.id} value={b.id}>{b.itemName} {b.legacyErpId && b.legacyErpId !== 'PENDING' ? `- ${b.legacyErpId}` : ''}</option>)}
                                    </select>
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>PROJECTION (IN):</label>
                                    <input type="number" step="0.125" value={engData.proj} onChange={e => setEngData({...engData, proj: parseFloat(e.target.value)||0})} style={{ width: '100%', padding: '6px', border: '1px solid #ccc', boxSizing: 'border-box' }} />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>END STYLE:</label>
                                    <select value={engData.endStyle} onChange={e => setEngData({...engData, endStyle: e.target.value})} style={{ width: '100%', padding: '6px', border: '1px solid #ccc' }}><option value="FLUSH">FLUSH CUT</option><option value="FINIAL">FINIALS</option><option value="RETURN_MITER">MITER RETURN</option><option value="RETURN_BEND">BENT RETURN (FR)</option></select>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '5px', background: '#f9f9f9', padding: '10px', border: '1px solid #eee' }}>
                                <div style={{ flex: 1 }}><label style={{ fontSize: '0.6rem', fontWeight: 'bold' }}>BRACKET W. (IN):</label><input type="number" step="0.125" value={engData.bracketW} onChange={e => setEngData({...engData, bracketW: parseFloat(e.target.value)||0})} style={{ width: '100%', padding: '6px', border: '1px solid #ccc', boxSizing: 'border-box' }} /></div>
                                <div style={{ flex: 1 }}><label style={{ fontSize: '0.6rem', fontWeight: 'bold' }}>BRACKET THICK. (IN):</label><input type="number" step="0.125" value={engData.bracketThickness} onChange={e => setEngData({...engData, bracketThickness: parseFloat(e.target.value)||0})} style={{ width: '100%', padding: '6px', border: '1px solid #ccc', boxSizing: 'border-box' }} /></div>
                                <div style={{ flex: 1 }}><label style={{ fontSize: '0.6rem', fontWeight: 'bold' }}>POLE DIA. (IN):</label><input type="number" step="0.125" value={engData.poleDiameter} onChange={e => setEngData({...engData, poleDiameter: parseFloat(e.target.value)||0})} style={{ width: '100%', padding: '6px', border: '1px solid #ccc', boxSizing: 'border-box' }} /></div>
                            </div>
                            <div style={{ display: 'flex', gap: '10px', background: '#f9f9f9', padding: '10px', border: '1px solid #eee' }}>
                                <div style={{ flex: 1 }}><label style={{ fontSize: '0.6rem', fontWeight: 'bold', color: '#d9534f' }}>BEND RADIUS (IN):</label><input type="number" step="0.125" value={engData.returnRadius} onChange={e => setEngData({...engData, returnRadius: parseFloat(e.target.value)||0})} disabled={engData.endStyle !== 'RETURN_BEND'} style={{ width: '100%', padding: '6px', border: '1px solid #d9534f', boxSizing: 'border-box', opacity: engData.endStyle === 'RETURN_BEND' ? 1 : 0.4 }} /></div>
                                <div style={{ flex: 1 }}><label style={{ fontSize: '0.6rem', fontWeight: 'bold', color: '#d9534f' }}>GRIP ALLOWANCE (IN):</label><input type="number" step="0.125" value={engData.gripAllowance} onChange={e => setEngData({...engData, gripAllowance: parseFloat(e.target.value)||0})} disabled={engData.endStyle !== 'RETURN_BEND'} style={{ width: '100%', padding: '6px', border: '1px solid #d9534f', boxSizing: 'border-box', opacity: engData.endStyle === 'RETURN_BEND' ? 1 : 0.4 }} /></div>
                                <div style={{ flex: 1 }}><label style={{ fontSize: '0.6rem', fontWeight: 'bold', color: '#888' }}>IM DEDUCT. (IN):</label><input type="number" step="0.125" value={engData.insideMountDeduct} onChange={e => setEngData({...engData, insideMountDeduct: parseFloat(e.target.value)||0})} style={{ width: '100%', padding: '6px', border: '1px solid #888', boxSizing: 'border-box' }} /></div>
                            </div>
                        </div>
                    </div>
                  </>
                )}
            </div>
          )}

          <div style={{ flex: showQuotePanel ? 2 : 1, display: 'flex', flexDirection: 'column', background: '#fff', border: '2px solid #000', boxShadow: '10px 10px 0 #000', minHeight: '600px' }}>
              
              {viewMode === 'VISUAL' ? (
                  <div style={{ padding: '10px 15px', background: '#f4f4f4', borderBottom: '2px solid #000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <button onClick={() => setVisualTool("pan")} style={{ padding: '6px 12px', background: visualTool === "pan" ? '#000' : '#fff', color: visualTool === "pan" ? '#fff' : '#000', border: '1px solid #000', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.75rem' }}>✋ PAN VIEWPORT</button>
                    <div style={{ display: 'flex', gap: '5px' }}><button onClick={() => setVisScale(s => Math.min(s + 0.25, 4))} style={{ padding: '4px 10px', fontWeight: 'bold', cursor: 'pointer' }}>➕</button><button onClick={() => setVisScale(s => Math.max(s - 0.25, 0.5))} style={{ padding: '4px 10px', fontWeight: 'bold', cursor: 'pointer' }}>➖</button><button onClick={() => { setVisScale(1); setVisPan({x:0, y:0}); }} style={{ padding: '4px 10px', cursor: 'pointer', fontSize: '0.7rem' }}>RESET</button></div>
                  </div>
              ) : (
                  <div style={{ padding: '10px 15px', background: '#e9ecef', borderBottom: '2px solid #000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>JOB:</label><input type="text" value={engData.jobName} onChange={e => setEngData({...engData, jobName: e.target.value})} style={{ width: '120px', padding: '4px', fontSize: '0.7rem', border: '1px solid #ccc' }} /></div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>SIDEMARK:</label><input type="text" value={engData.sidemark} onChange={e => setEngData({...engData, sidemark: e.target.value})} style={{ width: '120px', padding: '4px', fontSize: '0.7rem', border: '1px solid #ccc' }} /></div>
                    </div>
                    <div style={{ display: 'flex', gap: '5px' }}>
                        <button onClick={() => setEngTool("pan")} style={{ padding: '4px 8px', background: engTool === "pan" ? '#000' : '#fff', color: engTool === "pan" ? '#fff' : '#000', border: '1px solid #000', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.7rem' }}>✋ PAN</button>
                        <button onClick={() => setEngTool("bracket")} style={{ padding: '4px 8px', background: engTool === "bracket" ? '#28a745' : '#fff', color: engTool === "bracket" ? '#fff' : '#000', border: '1px solid #000', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.7rem' }}>📍 BRACKET</button>
                        <button onClick={() => setEngTool("splice")} style={{ padding: '4px 8px', background: engTool === "splice" ? '#d9534f' : '#fff', color: engTool === "splice" ? '#fff' : '#000', border: '1px solid #000', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.7rem' }}>✂️ SPLICE</button>
                        <button onClick={() => setEngTool("note")} style={{ padding: '4px 8px', background: engTool === "note" ? '#ffc107' : '#fff', color: '#000', border: '1px solid #000', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.7rem' }}>📝 NOTE</button>
                        <button onClick={() => {setAttachments([]); setShopNotes([]);}} style={{ padding: '4px 8px', background: '#fff', border: '1px solid #ccc', fontSize: '0.7rem', cursor: 'pointer' }}>CLEAR</button>
                    </div>
                  </div>
              )}

              <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: viewMode === 'VISUAL' ? '#1e1e1e' : '#f8f9fa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {viewMode === 'VISUAL' && !activeBg && <div style={{ color: '#666', textAlign: 'center' }}><div style={{ fontSize: '3rem', marginBottom: '10px' }}>🖼️</div><h3 style={{ margin: 0, color: '#999' }}>NO PLAN LOADED</h3></div>}

                  {(viewMode === 'ENGINEERING' || activeBg) && (
                      <svg ref={svgRef} viewBox="0 0 1000 600" style={{ width: '100%', height: '100%', display: 'block', cursor: (viewMode==='VISUAL'?visualTool:engTool) === 'pan' ? (isPanning?'grabbing':'grab') : 'crosshair', touchAction: 'none' }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
                          <g ref={innerGroupRef} transform={`translate(${viewMode==='VISUAL'?visPan.x:engPan.x}, ${viewMode==='VISUAL'?visPan.y:engPan.y}) translate(500, 300) scale(${viewMode==='VISUAL'?visScale:engScale}) translate(-500, -300)`}>
                              
                              {viewMode === 'VISUAL' && activeBg && (
                                  <g>
                                      <image href={activeBg.url} x="0" y="0" width="1000" height="600" preserveAspectRatio="xMidYMid slice" opacity="0.85" />
                                      {calPoints.map((pt, i) => <g key={`cal-${i}`} transform={`translate(${pt.x}, ${pt.y})`}><circle cx="0" cy="0" r="1.5" fill="#007bff" /><line x1="-6" y1="0" x2="-2" y2="0" stroke="#007bff" strokeWidth="1.5" /><line x1="2" y1="0" x2="6" y2="0" stroke="#007bff" strokeWidth="1.5" /><line x1="0" y1="-6" x2="0" y2="-2" stroke="#007bff" strokeWidth="1.5" /><line x1="0" y1="2" x2="0" y2="6" stroke="#007bff" strokeWidth="1.5" /></g>)}
                                      {calPoints.length === 2 && (() => {
                                          const midX = (calPoints[0].x + calPoints[1].x) / 2; const midY = (calPoints[0].y + calPoints[1].y) / 2;
                                          const dx = calPoints[1].x - calPoints[0].x; const dy = calPoints[1].y - calPoints[0].y;
                                          const len = Math.sqrt(dx * dx + dy * dy); const nx = -dy / len; const ny = dx / len;
                                          const offX = midX + nx * 40; const offY = midY + ny * 40;
                                          return (<g><line x1={calPoints[0].x} y1={calPoints[0].y} x2={calPoints[1].x} y2={calPoints[1].y} stroke="#007bff" strokeWidth="2" strokeDasharray="3,3" /><line x1={midX} y1={midY} x2={offX} y2={offY} stroke="#007bff" strokeWidth="1.5" /><rect x={offX - 35} y={offY - 12} width="70" height="24" fill="#fff" stroke="#007bff" strokeWidth="1.5" /><text x={offX} y={offY + 4} fill="#000" fontSize="12" fontWeight="bold" textAnchor="middle">{realInches}" SPEC</text></g>);
                                      })()}
                                      {showEngOverlay && (
                                          <g transform={`translate(${engOverlayPos.x}, ${engOverlayPos.y}) scale(${pixelsPerInch / S}) translate(-500, 0)`} onClick={(e) => { e.stopPropagation(); setActivePlacedId('ENG_OVERLAY'); }} style={{ cursor: 'move' }}>
                                              <rect x="0" y="-30" width="1000" height="60" fill="transparent" stroke={activePlacedId === 'ENG_OVERLAY' ? '#fff' : 'none'} strokeWidth="2" strokeDasharray="4,4" />
                                              {renderHardwareElevation()}
                                          </g>
                                      )}
                                      {placedItems.map(item => {
                                          const isSelected = item.id === activePlacedId;
                                          return (
                                              <g key={item.id} transform={`translate(${item.x}, ${item.y})`} onClick={(e) => { e.stopPropagation(); setActivePlacedId(item.id); }} style={{ cursor: 'move' }}>
                                              <rect x="0" y="0" width={item.width} height={item.height} fill={item.color} fillOpacity="0.6" stroke={isSelected ? '#fff' : '#000'} strokeWidth={isSelected ? '4' : '2'} strokeDasharray={isSelected ? 'none' : '2,2'} />
                                              <circle cx={item.width} cy={0} r="3" fill={item.color} stroke="#fff" strokeWidth="1.5" />
                                              <path d={`M ${item.width} 0 L ${item.width + 10} -10 L ${item.width + 20} -10`} fill="none" stroke={item.color} strokeWidth="2" />
                                              <foreignObject x={item.width + 20} y="-22" width="100" height="40" style={{ overflow: 'visible' }}>
                                                  <div style={{ background: '#fff', border: `2px solid ${item.color}`, padding: '3px 5px', boxShadow: `2px 2px 0 ${item.color}` }}><div style={{ fontWeight: 'bold', fontSize: '9px', color: '#000', lineHeight: '1.1' }}>{item.label}</div><div style={{ fontSize: '8px', color: '#666', marginTop: '2px', borderTop: '1px solid #ccc', paddingTop: '2px' }}>W: {item.realWidth}"</div></div>
                                              </foreignObject>
                                              </g>
                                          );
                                      })}
                                  </g>
                              )}

                              {viewMode === 'ENGINEERING' && (
                                  <g>
                                      {Array.from({ length: 15 }).map((_, i) => <line key={`h-${i}`} x1="0" y1={i * 40} x2="1000" y2={i * 40} stroke="#e0e0e0" strokeWidth="1" />)}
                                      {Array.from({ length: 25 }).map((_, i) => <line key={`v-${i}`} x1={i * 40} y1="0" x2={i * 40} y2="600" stroke="#e0e0e0" strokeWidth="1" />)}
                                  </g>
                              )}

                              {viewMode === 'ENGINEERING' && isCustomProj && (
                                  <g transform="translate(500, 50)"><rect x="-225" y="-20" width="450" height="30" fill="#ffcccc" stroke="#d9534f" strokeWidth="2" rx="5" /><text x="0" y="0" fill="#d9534f" fontSize="16" fontWeight="bold" textAnchor="middle">⚠️ CUSTOM PROJECTION REQUESTED: {engData.proj}" ⚠️</text></g>
                              )}

                              {viewMode === 'ENGINEERING' && (
                                  <g>
                                      {engData.shape === 'STRAIGHT' && <g><line x1={P2.x} y1={P2.y} x2={P3.x} y2={P3.y} stroke="#aaa" strokeWidth="3" /><text x={500} y={P2.y - 30} fill="#666" fontSize="12" fontWeight="bold" textAnchor="middle">WALL B: {wall2.toFixed(1)}"</text><text x={500} y={HS.y + 40} fill="#b8860b" fontSize="12" fontWeight="bold" textAnchor="middle">TUBE B CUT: {rawCenter.toFixed(2)}"</text></g>}
                                      {engData.shape === 'MITERED' && <g><polyline points={`${P1.x},${P1.y} ${P2.x},${P2.y} ${P3.x},${P3.y} ${P4.x},${P4.y}`} fill="none" stroke="#aaa" strokeWidth="3" /><text x={500} y={P2.y - 30} fill="#666" fontSize="12" fontWeight="bold" textAnchor="middle">WALL B: {wall2.toFixed(1)}"</text><text x={500} y={HC1.y + 40} fill="#b8860b" fontSize="12" fontWeight="bold" textAnchor="middle">TUBE B CUT: {rawCenter.toFixed(2)}"</text><text x={(P1.x+P2.x)/2 - 10} y={(P1.y+P2.y)/2 - 30} fill="#666" fontSize="12" fontWeight="bold" textAnchor="middle">WALL A: {wall1.toFixed(1)}"</text><text x={(HS.x+HC1.x)/2 + 10} y={(HS.y+HC1.y)/2 + 40} fill="#b8860b" fontSize="12" fontWeight="bold" textAnchor="middle">TUBE A CUT: {rawLeft.toFixed(2)}"</text><text x={(P3.x+P4.x)/2 + 10} y={(P3.y+P4.y)/2 - 30} fill="#666" fontSize="12" fontWeight="bold" textAnchor="middle">WALL C: {wall3.toFixed(1)}"</text><text x={(HC2.x+HE.x)/2 - 10} y={(HC2.y+HE.y)/2 + 40} fill="#b8860b" fontSize="12" fontWeight="bold" textAnchor="middle">TUBE C CUT: {rawRight.toFixed(2)}"</text></g>}
                                      {engData.shape === 'BOW' && <g><path d={bowWallPath} fill="none" stroke="#aaa" strokeWidth="3" /><text x={500} y={P2.y - 30} fill="#666" fontSize="12" fontWeight="bold" textAnchor="middle">CHORD B: {wall2.toFixed(1)}"</text><text x={500} y={HS.y + 40} fill="#b8860b" fontSize="12" fontWeight="bold" textAnchor="middle">TUBE B CUT: {rawCenter.toFixed(2)}"</text></g>}

                                      {engData.shape === 'STRAIGHT' && renderDimLine(HS, HE, {x:0,y:1}, 65, `C-to-C: ${(pole2).toFixed(1)}"`)}
                                      {engData.shape === 'MITERED' && <g>{renderDimLine(HS, HC1, {x:-nL.x, y:-nL.y}, 65, `C-to-C: ${(pole1).toFixed(1)}"`)}{renderDimLine(HC1, HC2, {x:0, y:1}, 65, `C-to-C: ${(pole2).toFixed(1)}"`)}{renderDimLine(HC2, HE, {x:-nR.x, y:-nR.y}, 65, `C-to-C: ${(pole3).toFixed(1)}"`)}</g>}

                                      {engData.shape === 'STRAIGHT' && <line x1={drawHS.x} y1={drawHS.y} x2={drawHE.x} y2={drawHE.y} stroke="#d4af37" strokeWidth="1.5" />}
                                      {engData.shape === 'MITERED' && <polyline points={`${drawHS.x},${drawHS.y} ${HC1.x},${HC1.y} ${HC2.x},${HC2.y} ${drawHE.x},${drawHE.y}`} fill="none" stroke="#d4af37" strokeWidth="1.5" />}
                                      {engData.shape === 'BOW' && bowHWPath && <path d={bowHWPath} fill="none" stroke="#d4af37" strokeWidth="1.5" />}

                                      {engData.shape === 'MITERED' && sawAngle1 > 0 && <g><line x1={HC1.x} y1={HC1.y + 15} x2={HC1.x + 60} y2={HC1.y + 100} stroke="#666" strokeWidth="1" strokeDasharray="2,2" /><rect x={HC1.x + 30} y={HC1.y + 93} width="60" height="14" fill="#fff" stroke="#666" strokeWidth="1" /><text x={HC1.x + 60} y={HC1.y + 103} fill="#000" fontSize="10" fontWeight="bold" textAnchor="middle">{sawAngle1.toFixed(1)}° MITER</text></g>}
                                      {engData.shape === 'MITERED' && sawAngle2 > 0 && <g><line x1={HC2.x} y1={HC2.y + 15} x2={HC2.x - 60} y2={HC2.y + 100} stroke="#666" strokeWidth="1" strokeDasharray="2,2" /><rect x={HC2.x - 90} y={HC2.y + 93} width="60" height="14" fill="#fff" stroke="#666" strokeWidth="1" /><text x={HC2.x - 60} y={HC2.y + 103} fill="#000" fontSize="10" fontWeight="bold" textAnchor="middle">{sawAngle2.toFixed(1)}° MITER</text></g>}

                                      {attachments.map(att => {
                                          let seg = null;
                                          if (engData.shape === 'STRAIGHT') { if(att.segId===2) seg = { pA: HS, pB: HE, len: pole2, norm: {x:0, y:-1}, nA: "L.Edge", nB: "R.Edge" }; }
                                          else if (engData.shape === 'MITERED') {
                                              if (att.segId===1) seg = { pA: HS, pB: HC1, len: pole1, norm: nL, nA: "L.Edge", nB: "L.Miter" };
                                              if (att.segId===2) seg = { pA: HC1, pB: HC2, len: pole2, norm: {x:0, y:-1}, nA: "L.Miter", nB: "R.Miter" };
                                              if (att.segId===3) seg = { pA: HC2, pB: HE, len: pole3, norm: nR, nA: "R.Miter", nB: "R.Edge" };
                                          } else if (engData.shape === 'BOW') {
                                              seg = { pA: HS, pB: HE, len: pole2, norm: {x:0, y:-1}, nA: "L.Edge", nB: "R.Edge", isBow: true };
                                          }
                                          if (!seg) return null;

                                          const nX = seg.norm ? seg.norm.x : 0;
                                          const nY = seg.norm ? seg.norm.y : -1;

                                          const distFromA = att.ref === 'START' ? att.distInches : (seg.len - att.distInches);
                                          const t = distFromA / seg.len; let x = 0; let y = 0;
                                          if (seg.isBow) { const angle = bowStartAngle + t * (bowEndAngle - bowStartAngle); const rH_px = bowHW_R * S; x = bowCX + rH_px * Math.cos(angle); y = bowCY + rH_px * Math.sin(angle); } 
                                          else { x = seg.pA.x + t * (seg.pB.x - seg.pA.x); y = seg.pA.y + t * (seg.pB.y - seg.pA.y); }

                                          return (
                                              <g key={att.id}>
                                                  {att.type === 'bracket' ? (
                                                      <g>
                                                          <circle cx={x} cy={y} r="4" fill="#28a745" />
                                                          <line x1={x} y1={y} x2={x + nX * (safeProj * S)} y2={y + nY * (safeProj * S)} stroke="#999" strokeWidth="2" />
                                                      </g>
                                                  ) : (
                                                      <g>
                                                          <line x1={x - nX*8 - nY*4} y1={y - nY*8 + nX*4} x2={x + nX*8 - nY*4} y2={y + nY*8 + nX*4} stroke="#d9534f" strokeWidth="2" />
                                                          <line x1={x - nX*8 + nY*4} y1={y - nY*8 - nX*4} x2={x + nX*8 + nY*4} y2={y + nY*8 - nX*4} stroke="#d9534f" strokeWidth="2" />
                                                      </g>
                                                  )}
                                                  <line x1={x} y1={y-5} x2={x} y2={y-80} stroke={att.type==='bracket'?'#28a745':'#d9534f'} strokeWidth="1" strokeDasharray="2,2" />
                                                  <foreignObject x={x - 55} y={y - 135} width="110" height="50" style={{ overflow: 'visible' }}>
                                                      <div style={{ background: '#fff', border: `2px solid ${att.type==='bracket'?'#28a745':'#d9534f'}`, display: 'flex', flexDirection: 'column', padding: '4px', borderRadius: '4px', boxShadow: '0 2px 5px rgba(0,0,0,0.3)' }}><input type="number" value={att.distInches} step="0.125" onChange={(e) => handleUpdateAttachmentDist(att.id, e.target.value)} onPointerDown={e => e.stopPropagation()} style={{ width: '100%', fontSize: '12px', fontWeight: 'bold', textAlign: 'center', border: 'none', background: '#e9ecef', outline: 'none' }} /><span style={{ fontSize: '9px', color: '#666', textAlign: 'center', margin: '2px 0' }}>from {att.ref === 'START' ? seg.nA : seg.nB}</span><input type="text" placeholder="Notes..." value={att.note||''} onChange={(e) => handleUpdateAttachmentNote(att.id, e.target.value)} onPointerDown={e => e.stopPropagation()} style={{ width: '100%', fontSize: '10px', border: '1px solid #ccc', outline: 'none', textAlign: 'center' }} /></div>
                                                  </foreignObject>
                                              </g>
                                          );
                                      })}

                                      {shopNotes.map(n => (
                                          <g key={n.id}><circle cx={n.x} cy={n.y} r="4" fill="#ffc107" /><line x1={n.x} y1={n.y} x2={n.x + 20} y2={n.y - 70} stroke="#ffc107" strokeWidth="2" /><foreignObject x={n.x + 20} y={n.y - 120} width="160" height="50" style={{ overflow: 'visible' }}><textarea value={n.text} placeholder="Type shop floor note here..." onChange={(e) => handleUpdateShopNote(n.id, e.target.value)} onPointerDown={e => e.stopPropagation()} style={{ width: '100%', height: '100%', fontSize: '12px', fontWeight: 'bold', border: '2px solid #ffc107', background: '#fff3cd', outline: 'none', resize: 'none', padding: '6px', boxShadow: '0 2px 5px rgba(0,0,0,0.2)' }} /></foreignObject></g>
                                      ))}

                                      {renderEndTreatment(true)}
                                      {renderEndTreatment(false)}
                                  </g>
                              )}
                          </g>
                      </svg>
                  )}
              </div>

              {viewMode === 'ENGINEERING' && !showQuotePanel && (
                  <div style={{ background: '#fff', borderTop: '2px solid #000', display: 'flex', minHeight: '120px' }}>
                      <div style={{ flex: 1, padding: '15px', borderRight: '1px solid #ccc' }}>
                          <h4 style={{ margin: '0 0 10px 0', color: '#007bff' }}>📋 CLIENT DETAILS & ORDERING</h4>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '0.8rem' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#1e7e34' }}><span>System O2O (Outside-to-Outside edges including backplates):</span><strong>{systemO2O.toFixed(2)}"</strong></div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#007bff' }}><span>System C2C (Center-to-Center):</span><strong>{systemC2C.toFixed(2)}"</strong></div>
                              {engData.shape === 'MITERED' && <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '5px' }}><span>Left Wall C2C:</span><strong>{pole1.toFixed(2)}"</strong></div>}
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{engData.shape === 'STRAIGHT' ? 'Main Wall C2C:' : 'Center Wall C2C:'}</span><strong>{pole2.toFixed(2)}"</strong></div>
                              {engData.shape === 'MITERED' && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Right Wall C2C:</span><strong>{pole3.toFixed(2)}"</strong></div>}
                              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#666', marginTop: '5px' }}><span>End Style:</span><strong>{engData.endStyle.replace('_', ' ')}</strong></div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#666' }}><span>Projection:</span><strong>{isCustomProj ? `CUSTOM (${engData.proj}")` : `${engData.proj}"`}</strong></div>
                          </div>
                      </div>
                      <div style={{ flex: 1, padding: '15px', background: '#f8f9fa' }}>
                          <h4 style={{ margin: '0 0 10px 0', color: '#b8860b' }}>⚙️ SHOP FLOOR BOM & RAW CUTS</h4>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '0.8rem' }}>
                              {engData.shape === 'MITERED' && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>TUBE A RAW CUT:</span><strong>{rawLeft.toFixed(2)}"</strong></div>}
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{engData.shape === 'STRAIGHT' ? 'MAIN TUBE RAW CUT:' : 'TUBE B RAW CUT:'}</span><strong>{rawCenter.toFixed(2)}"</strong></div>
                              {engData.shape === 'MITERED' && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>TUBE C RAW CUT:</span><strong>{rawRight.toFixed(2)}"</strong></div>}
                              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#6f42c1', marginTop: '5px' }}><span>Total Splices Req:</span><strong>{qtySplices}</strong></div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#28a745' }}><span>Total Brackets Req:</span><strong>{qtyBrackets}</strong></div>
                          </div>
                      </div>
                  </div>
              )}
          </div>

          {showQuotePanel && (
              <div style={{ width: '400px', background: '#fff', border: '3px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '-10px 0 20px rgba(0,0,0,0.1)', zIndex: 100 }}>
                  <div style={{ padding: '15px 20px', background: '#28a745', color: '#fff', borderBottom: '2px solid #000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3 style={{ margin: 0, fontSize: '1.2rem', textTransform: 'uppercase' }}>CPQ QUOTING ENGINE</h3>
                  </div>

                  <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px', background: '#f8f9fa' }}>
                      
                      <div style={{ background: '#fff', border: '2px solid #000', padding: '15px' }}>
                          <h4 style={{ margin: '0 0 15px 0', color: '#007bff', borderBottom: '2px solid #eee', paddingBottom: '5px' }}>SYSTEM & COLLECTION</h4>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                              <div>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>CPQ FLOW / CONFIGURATOR:</label>
                                  <select value={quoteFlowId} onChange={e => { setQuoteFlowId(e.target.value); setDynamicConfigParams({}); }} style={{ width: '100%', padding: '10px', border: '2px solid #007bff', fontWeight: 'bold' }}>
                                      <option value="">-- NO FLOW SELECTED --</option>
                                      {cpqFlows.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                                  </select>
                              </div>
                              <div>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>COLLECTION (FILTERS HARDWARE):</label>
                                  <select value={quoteSelections.collection} onChange={e => { setQuoteSelections({...quoteSelections, collection: e.target.value}); setDynamicConfigParams({}); }} style={{ width: '100%', padding: '10px', border: '1px solid #000', fontWeight: 'bold', background: '#e6f2ff' }}>
                                      <option value="">-- NO COLLECTION RESTRICTION --</option>
                                      {collectionsData.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                                  </select>
                              </div>
                          </div>
                      </div>

                      <div style={{ background: '#fff', border: '2px solid #000', padding: '15px' }}>
                          <h4 style={{ margin: '0 0 15px 0', color: '#1e7e34', borderBottom: '2px solid #eee', paddingBottom: '5px' }}>CORE HARDWARE & COMPONENTS</h4>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                              
                              {/* POLE */}
                              <div style={{ background: '#eafaf1', padding: '10px', border: '1px solid #28a745' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}><label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>MAIN TUBE / POLE:</label><span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#1e7e34' }}>{poleFeetQty} FT REQ</span></div>
                                  <select value={quoteSelections.poleId} onChange={e => setQuoteSelections({...quoteSelections, poleId: e.target.value})} style={{ width: '100%', padding: '10px', border: '1px solid #000', marginBottom: '5px' }}><option value="">-- SELECT TUBE/POLE --</option>{getNativeOptions('POLE').map(p => <option key={p.id} value={p.id}>{p.itemName} {p.legacyErpId ? `[${p.legacyErpId}]` : ''}</option>)}</select>
                                  <select value={quoteSelections.poleFinishId} onChange={e => setQuoteSelections({...quoteSelections, poleFinishId: e.target.value})} style={{ width: '100%', padding: '8px', border: '1px solid #ccc', fontSize: '0.8rem' }}><option value="">-- SELECT FINISH --</option>{getFinishOptions('pole').map(f => <option key={f.id} value={f.id}>{f.name} {f.code ? `[${f.code}]` : ''}</option>)}</select>
                              </div>

                              {/* BRACKET */}
                              {qtyBrackets > 0 && (
                                  <div style={{ background: '#eafaf1', padding: '10px', border: '1px solid #28a745' }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}><label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>BRACKETS ({isCustomProj ? "CUSTOM" : `${engData.proj}"`} PROJ):</label><span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#1e7e34' }}>QTY: {qtyBrackets}</span></div>
                                      <select disabled value={engData.bracketId} style={{ width: '100%', padding: '10px', border: '1px dashed #ccc', marginBottom: '5px', background: '#f4f4f4' }}><option value="">-- SELECTED IN FAB SETTINGS --</option>{allBrackets.map(p => <option key={p.id} value={p.id}>{p.itemName}</option>)}</select>
                                      <select value={quoteSelections.bracketFinishId} onChange={e => setQuoteSelections({...quoteSelections, bracketFinishId: e.target.value})} style={{ width: '100%', padding: '8px', border: '1px solid #ccc', fontSize: '0.8rem' }}><option value="">-- SELECT FINISH --</option>{getFinishOptions('bracket').map(f => <option key={f.id} value={f.id}>{f.name} {f.code ? `[${f.code}]` : ''}</option>)}</select>
                                  </div>
                              )}

                              {/* RINGS */}
                              <div style={{ background: '#eafaf1', padding: '10px', border: '1px solid #28a745' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}><label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>OPTIONAL RINGS:</label><span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#1e7e34' }}>REC: {recRings} RINGS</span></div>
                                  <select value={quoteSelections.ringId} onChange={e => setQuoteSelections({...quoteSelections, ringId: e.target.value})} style={{ width: '100%', padding: '10px', border: '1px solid #000', marginBottom: '5px' }}><option value="">-- NO RINGS / TRAVERSE --</option>{getNativeOptions('RING').map(p => <option key={p.id} value={p.id}>{p.itemName} {p.legacyErpId ? `[${p.legacyErpId}]` : ''}</option>)}</select>
                                  {quoteSelections.ringId && (
                                      <>
                                          <select value={quoteSelections.ringFinishId} onChange={e => setQuoteSelections({...quoteSelections, ringFinishId: e.target.value})} style={{ width: '100%', padding: '8px', border: '1px solid #ccc', fontSize: '0.8rem', marginBottom: '5px' }}><option value="">-- SELECT FINISH --</option>{getFinishOptions('ring').map(f => <option key={f.id} value={f.id}>{f.name} {f.code ? `[${f.code}]` : ''}</option>)}</select>
                                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff', padding: '5px', border: '1px solid #ccc' }}>
                                              <span style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>TOTAL RINGS TO ORDER:</span>
                                              <input type="number" min="1" value={stepQuantities.rings} onChange={e => setStepQuantities({...stepQuantities, rings: parseInt(e.target.value) || 0})} style={{ width: '60px', padding: '5px', textAlign: 'center', border: '2px solid #000', fontWeight: 'bold' }} />
                                          </div>
                                      </>
                                  )}
                              </div>

                              {/* FINIALS */}
                              <div style={{ background: '#eafaf1', padding: '10px', border: '1px solid #28a745', opacity: disableFinials ? 0.5 : 1 }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}><label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>FINIALS:</label><span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: disableFinials ? '#999' : '#1e7e34' }}>{disableFinials ? "N/A (BENT RETURN)" : `QTY: ${qtyFinials}`}</span></div>
                                  <select disabled={disableFinials} value={quoteSelections.finialId} onChange={e => setQuoteSelections({...quoteSelections, finialId: e.target.value})} style={{ width: '100%', padding: '10px', border: '1px solid #000', marginBottom: '5px' }}><option value="">-- SELECT FINIAL --</option>{getNativeOptions('FINIAL').map(p => <option key={p.id} value={p.id}>{p.itemName} {p.legacyErpId ? `[${p.legacyErpId}]` : ''}</option>)}</select>
                                  {!disableFinials && quoteSelections.finialId && <select value={quoteSelections.finialFinishId} onChange={e => setQuoteSelections({...quoteSelections, finialFinishId: e.target.value})} style={{ width: '100%', padding: '8px', border: '1px solid #ccc', fontSize: '0.8rem' }}><option value="">-- SELECT FINISH --</option>{getFinishOptions('finial').map(f => <option key={f.id} value={f.id}>{f.name} {f.code ? `[${f.code}]` : ''}</option>)}</select>}
                              </div>
                          </div>
                      </div>

                      {/* DYNAMIC CPQ EXTRAS */}
                      {activeFlow && activeFlow.steps.filter(s => { const cat = getStepCategory(s); return !['POLE','BRACKET','RING','FINIAL','FINISH'].includes(cat) && s.type !== 'DIMENSIONS'; }).length > 0 && (
                          <div style={{ background: '#fff', border: '2px dashed #007bff', padding: '15px' }}>
                              <h4 style={{ margin: '0 0 15px 0', color: '#007bff', borderBottom: '2px solid #eee', paddingBottom: '5px' }}>EXTRA CPQ CONFIGURATIONS</h4>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                  {activeFlow.steps.map(step => {
                                      const cat = getStepCategory(step);
                                      if (['POLE','BRACKET','RING','FINIAL','FINISH'].includes(cat) || step.type === 'DIMENSIONS') return null;
                                      
                                      const options = getOptionsForStep(step);
                                      return (
                                          <div key={step.id}>
                                              <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>{step.title}:</label>
                                              <select value={dynamicConfigParams[step.id] || ''} onChange={e => setDynamicConfigParams({...dynamicConfigParams, [step.id]: e.target.value})} style={{ width: '100%', padding: '8px', border: '1px solid #000' }}>
                                                  <option value="">-- SELECT OPTION --</option>
                                                  {options.map(opt => <option key={opt.id} value={opt.id}>{opt.itemName} {opt.code ? `[${opt.code}]` : ''}</option>)}
                                              </select>
                                          </div>
                                      )
                                  })}
                              </div>
                          </div>
                      )}

                      <div style={{ background: '#fff', border: '2px solid #000', padding: '15px' }}>
                          <h4 style={{ margin: '0 0 15px 0', color: '#d9534f', borderBottom: '2px solid #eee', paddingBottom: '5px' }}>FABRICATION FEES</h4>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.75rem' }}>
                              {(qtyBends > 0 || qtyMiterReturns > 0 || qtyMiters > 0) && <div style={{ display: 'flex', justifyContent: 'space-between', color: '#856404', fontWeight: 'bold' }}><span>END FABRICATION:</span><strong>{(qtyBends || qtyMiterReturns || qtyMiters)}x</strong></div>}
                              {qtySplices > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', color: '#856404', fontWeight: 'bold' }}><span>SPLICES:</span><strong>{qtySplices}x</strong></div>}
                              {qtyCustomProjBrackets > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', color: '#d9534f', fontWeight: 'bold' }}><span>CUSTOM PROJ. BRACKETS:</span><strong>{qtyCustomProjBrackets}x</strong></div>}
                              {!qtyBends && !qtyMiterReturns && !qtyMiters && !qtySplices && !qtyCustomProjBrackets && <div style={{ color: '#999', fontStyle: 'italic' }}>No additional fabrication fees detected.</div>}
                          </div>
                      </div>

                  </div>
                  
                  <div style={{ padding: '20px', background: '#000', borderTop: '2px solid #000' }}>
                      <button onClick={handlePushToCPQ} disabled={isPushingToCPQ || !quoteSelections.poleId || !engData.bracketId} style={{ width: '100%', padding: '15px', background: (isPushingToCPQ || !quoteSelections.poleId || !engData.bracketId) ? '#666' : '#28a745', color: '#fff', fontWeight: 'bold', border: 'none', cursor: (isPushingToCPQ || !quoteSelections.poleId || !engData.bracketId) ? 'not-allowed' : 'pointer', fontSize: '1.1rem', transition: '0.2s' }}>
                          {isPushingToCPQ ? 'SAVING DRAFT...' : '🛒 SEND TO CPQ CART'}
                      </button>
                  </div>
              </div>
          )}
      </div>
    </div>
  );
};

export default VisionHardware;