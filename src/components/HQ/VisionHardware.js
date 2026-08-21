import React, { useState, useEffect, useRef, useMemo } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, query, where, doc, setDoc, serverTimestamp } from "firebase/firestore";
import { SIZE_STEP_TYPE, sizeSelectionsOf, makeSizeSwap, returnsAllowedFor, isReturnOption, buildSizeIndex, partAllowedAtSize, projInchesOfSel } from '../Shared/sizeMatrix';
import { pinProjectionOf } from '../Shared/hardwareAdapter';
import { platePoolFrom, plateStillOffered } from '../Shared/platePool';
import { computeBayMath } from '../Shared/bayMath';

const VisionHardware = ({ currentUser, activeBrand, visionConfigs, activeSession }) => {
  // Default to TAKEOFF as Step 1
  const [viewMode, setViewMode] = useState('TAKEOFF');
  const [showQuotePanel, setShowQuotePanel] = useState(false);
  const [isPushingToCPQ, setIsPushingToCPQ] = useState(false);

  // --- LINE ITEM CONTEXT ---
  const [sidemark, setSidemark] = useState('');

  // --- VISUAL MODE STATE ---
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
  const [showManualFab, setShowManualFab] = useState(false); // collapsed by default: dims auto-fill from the selected bracket; open only for one-off custom overrides
  const [editingDraftId, setEditingDraftId] = useState(null); // a saved session line loaded for editing — Save Line updates it IN PLACE
  const [loadDraftPick, setLoadDraftPick] = useState('');
  const [engOverlayPos, setEngOverlayPos] = useState({ x: 500, y: 400 });
  const [perspectiveStretch, setPerspectiveStretch] = useState({ L: 0, R: 0 }); 
  const [visScale, setVisScale] = useState(1.0); 
  const [visPan, setVisPan] = useState({ x: 0, y: 0 });

  // --- TAKEOFF MODE STATE ---
  const [takeoffBg, setTakeoffBg] = useState(null);
  const [takeoffTool, setTakeoffTool] = useState("pan");
  const takeoffFileInputRef = useRef(null);
  const [takeoffCalPoints, setTakeoffCalPoints] = useState([]);
  const [takeoffRealInches, setTakeoffRealInches] = useState("60");
  const [takeoffPPI, setTakeoffPPI] = useState(4.5);
  const [isTakeoffCalibrated, setIsTakeoffCalibrated] = useState(false);
  const [takeoffMeasurements, setTakeoffMeasurements] = useState([]);
  const [takeoffMeasurePoints, setTakeoffMeasurePoints] = useState([]);
  const [takeoffMousePos, setTakeoffMousePos] = useState(null);
  const [takeoffScale, setTakeoffScale] = useState(1.0);
  const [takeoffPan, setTakeoffPan] = useState({ x: 0, y: 0 });
  
  // --- ENGINEERING MODE STATE ---
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

  const [quoteFlowId, setQuoteFlowId] = useState("");
  const [quoteSelections, setQuoteSelections] = useState({ collection: '' });
  const [dynamicConfigParams, setDynamicConfigParams] = useState({});
  const [flowPins, setFlowPins] = useState([]);

  const defaultEngData = {
    shape: 'STRAIGHT', inputMode: 'ORDERING',   
    w1: 30, w2: 80, w3: 30, a1: 135, a2: 135, bowDepth: 15,            
    mountLeft: 'OPEN', mountRight: 'OPEN', mountCenter: 'OPEN', mountOuter: 'OPEN',      
    endStyle: 'FINIAL', endStyleRight: '', proj: "", bracketId: "", bracketIdRight: "", bracketIdCenter: "", backplateIdLeft: "", backplateIdRight: "", backplateIdCenter: "", poleDiameter: 1.0, bracketW: 3.0, finialW: 3.5,
    bracketThickness: 0.25, insideMountDeduct: 0.25, returnRadius: 4.0, gripAllowance: 8.5       
  };

  const [engData, setEngData] = useState(defaultEngData);

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

    return () => { unsubParts(); unsubFinishes(); unsubOutsource(); unsubCollections(); unsubFlows(); unsubDynamic(); };
  }, [activeBrand]);

  const activeFlow = useMemo(() => {
      return cpqFlows.find(f => f.id === quoteFlowId);
  }, [quoteFlowId, cpqFlows]);

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

  const getStepForCategory = (cat) => {
      if (!activeFlow) return null;
      return (activeFlow.steps || []).find(s => {
          const isFinish = (s.dataSource || '').toLowerCase() === 'master_finishes' || (s.title || '').toLowerCase().includes('finish');
          if (isFinish) return false; 
          return getStepCategory(s) === cat;
      });
  };

  const bracketStep = getStepForCategory('BRACKET');

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

      // Flow-level fabrication preset is AUTHORITATIVE (one CPQ flow per bracket
      // projection; CPQ item/finish selections must never change fabrication). When set,
      // it seeds Vision's projection + end style and the bracket selection can't override.
      const hasPresetProj = activeFlow.fabProjection !== undefined && activeFlow.fabProjection !== '' && activeFlow.fabProjection !== null;
      // 🎯 Single-assembly flows (H2 pivot): the stamped implied projection (one proj: tag on the
      // assembly — no Bracket Projection question generated) seeds the fab Projection like a
      // preset, and the stamped rod diameter (the flow IS one diameter) seeds Pole Dia so the
      // bend deduct + auto-place bracket spacing follow. Multi-tag flows leave proj to the
      // PROJ_SELECT pick (pickStep drives it). Flows without the stamps are untouched.
      const impliedNum = parseFloat(String(activeFlow.impliedProjInches ?? ''));
      const hasImplied = !!activeFlow.singleAssembly && Number.isFinite(impliedNum);
      const groupDia = parseFloat(String(activeFlow.sizeGroupSort ?? ''));
      const hasGroupDia = !!activeFlow.singleAssembly && Number.isFinite(groupDia) && groupDia > 0 && groupDia < 90;
      const presetProj = hasPresetProj ? parseFloat(activeFlow.fabProjection) : (hasImplied ? impliedNum : null);
      const presetEndStyle = activeFlow.fabEndStyle || null;
      const presetShape = activeFlow.fabShape || null; // bay configuration: STRAIGHT | MITERED | BOW

      let detectedProj = presetProj;
      let detectedEndStyle = presetEndStyle;

      // Legacy pin-sniffing ("a BENT_RETURN fee pin means this whole flow is a French Return
      // flow") predates per-assembly flows, where returns are OPTIONS — never seed an end style
      // or projection from pins on a singleAssembly flow.
      if ((detectedProj === null || !detectedEndStyle) && !activeFlow.singleAssembly) {
          flowPins.forEach(pin => {
              const part = libraryParts.find(p => p.id === pin.partId || p.legacyErpId === pin.legacyErpId);
              if (part) {
                  const cData = part.manufacturingSpecs?.customData || {};
                  // ⚠ THE TAG IS THE PROJECTION (Stuart 2026-08-21). The pin's projInches is what
                  // gates the new engine and what renders; the item's customData.projection is the
                  // older field, unmaintained on collections tagged since 1.6 arrived. Read the tag
                  // first so both tools engineer the same depth, and keep the item as a fallback
                  // only for collections pinned before the tag existed.
                  if (detectedProj === null) {
                      const tagged = pinProjectionOf([pin], part);
                      if (tagged != null) detectedProj = tagged;
                      else if (cData.projection) detectedProj = parseFloat(cData.projection);
                  }
                  if (!detectedEndStyle && cData.feeType === 'BENT_RETURN') detectedEndStyle = 'RETURN_BEND';
                  if (!detectedEndStyle && cData.feeType === 'MITER_RETURN') detectedEndStyle = 'RETURN_MITER';
                  if (!detectedEndStyle && part.manufacturingSpecs?.productType === 'FINIAL') detectedEndStyle = 'FINIAL';
              }
          });
          if (!detectedEndStyle && activeFlow.name.toUpperCase().includes("FRENCH RETURN")) {
              detectedEndStyle = 'RETURN_BEND';
          }
      }

      setEngData(prev => {
          const updates = { ...prev };
          let changed = false;
          // A flow preset wins even when a bracket is selected; detection only seeds when unset.
          if (detectedProj !== null && prev.proj !== detectedProj && (hasPresetProj || hasImplied || !prev.bracketId)) { updates.proj = detectedProj; changed = true; }
          if (detectedEndStyle && prev.endStyle !== detectedEndStyle) { updates.endStyle = detectedEndStyle; changed = true; }
          if (presetShape && prev.shape !== presetShape) { updates.shape = presetShape; changed = true; }
          if (hasGroupDia && parseFloat(prev.poleDiameter) !== groupDia) { updates.poleDiameter = groupDia; changed = true; }
          return changed ? updates : prev;
      });

      if (detectedProj !== null && (hasPresetProj || hasImplied || !engData.bracketId)) setIsCustomProj(false);
  }, [activeFlow, flowPins, libraryParts]);

  // (Old engData.bracketId → single-bracket-step sync removed: Fabrication Settings are now driven
  // by the FLOW STEPS per position — see the flow-mirror block below bpDims — which writes the step
  // selections directly, exactly like CPQ tab 8.)

  useEffect(() => {
      if (engData.bracketId) {
          const part = libraryParts.find(p => p.id === engData.bracketId);
          if (part) {
              const cData = part.manufacturingSpecs?.customData || {};
              const pData = part.manufacturingSpecs?.parametric || {};
              // Flow preset projection wins; otherwise take it from the selected bracket.
              const hasPresetProj = activeFlow?.fabProjection !== undefined && activeFlow?.fabProjection !== '' && activeFlow?.fabProjection !== null;
              // ⚠ THE SELECTED BRACKET'S 1.6 TAG IS THE DEPTH THIS DRAWING IS ENGINEERED AT
              // (Stuart 2026-08-21: "make it use the projection for the 1.6 tags"). It is the same
              // number the configurator gates that bracket by and the same number the render is
              // built from, so the drawing, the quote and the model cannot describe three different
              // poles. The item's own field stands in only where a collection has no tag.
              const taggedProj = pinProjectionOf(flowPins, part);
              const proj = hasPresetProj ? parseFloat(activeFlow.fabProjection)
                  : (taggedProj != null ? taggedProj : (parseFloat(cData.projection) || parseFloat(engData.proj) || 0));
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
  }, [engData.bracketId, libraryParts, activeFlow, flowPins]);

  // Auto-set each end's End Style from its mount + bracket: an INSIDE mount is a flush cut; otherwise
  // an Is-Return bracket miters back into the wall. Leaves the style alone when neither applies, so a
  // manual choice / flow preset still sticks. Re-fires on a mount or bracket change (style read via
  // prev, not a dep), so it never loops.
  useEffect(() => {
      const isRet = (id) => !!libraryParts.find(p => p.id === id)?.manufacturingSpecs?.customData?.isReturnBracket;
      const sideStyle = (mount, bktId) => mount === 'INSIDE' ? 'FLUSH' : ((bktId && isRet(bktId)) ? 'RETURN_MITER' : null);
      const lMount = engData.shape === 'STRAIGHT' ? engData.mountLeft : engData.mountOuter;
      const rMount = engData.shape === 'STRAIGHT' ? engData.mountRight : engData.mountOuter;
      const lStyle = sideStyle(lMount, engData.bracketId);
      const rStyle = sideStyle(rMount, engData.bracketIdRight);
      setEngData(prev => {
          const next = { ...prev };
          let changed = false;
          if (lStyle && prev.endStyle !== lStyle) { next.endStyle = lStyle; changed = true; }
          if (rStyle && (prev.endStyleRight || prev.endStyle) !== rStyle) { next.endStyleRight = rStyle; changed = true; }
          return changed ? next : prev;
      });
  }, [engData.bracketId, engData.bracketIdRight, engData.mountLeft, engData.mountRight, engData.mountOuter, engData.shape, libraryParts]);

  // Per-option projection: a Choose/Swap bracket option can carry its own projection
  // (e.g. standard 4.25" vs mini 4.125" backplate — same rendering, different fab).
  // When such an option is selected, its projection drives the fabrication math,
  // overriding the flow preset. Blank option projection = fall back to the preset.
  useEffect(() => {
      if (!bracketStep || bracketStep.type !== 'STYLE_SWAP') return;
      const selId = dynamicConfigParams[bracketStep.id];
      if (!selId) return;
      const opt = (bracketStep.styleOptions || []).find(o => (o.optId || o.partId) === selId);
      if (opt && opt.projection !== undefined && opt.projection !== '' && opt.projection !== null) {
          const p = parseFloat(opt.projection);
          if (!isNaN(p)) {
              setEngData(prev => prev.proj === p ? prev : { ...prev, proj: p });
              setIsCustomProj(false);
          }
      }
  }, [bracketStep, dynamicConfigParams]);

  const safeProj = parseFloat(engData.proj) || 0;

  // A part's collection tags, uppercased. The collection to SCOPE the fabrication pickers to is the
  // operator's explicit pick, else the flow's linked assembly's collection tag — derived automatically so
  // it works without manually choosing a collection. Some assemblies are pinned with cross-collection
  // brackets, so without this scope the wrong arms leak into a flow (e.g. Brimar / Simple Elegance / 1"
  // arms under a fabricut 3/4" flow).
  const collectionOf = (p) => (p.manufacturingSpecs?.collections || (p.manufacturingSpecs?.customData?.collection ? [p.manufacturingSpecs.customData.collection] : [])).map(c => (c || '').toUpperCase());
  const scopeCollection = useMemo(() => {
      if (quoteSelections.collection) return quoteSelections.collection.toUpperCase();
      const asm = activeFlow?.linkedAssemblyId ? libraryParts.find(p => p.id === activeFlow.linkedAssemblyId) : null;
      return (asm ? collectionOf(asm)[0] : '') || '';
  }, [quoteSelections.collection, activeFlow, libraryParts]);
  // In-scope test shared by the arm + backplate lists. hasPins = the flow's assembly has pins.
  const partInScope = (p, hasPins) => {
      const cols = collectionOf(p);
      if (hasPins) {
          // Pins are authoritative: show pinned parts, but drop a pinned part explicitly tagged to a
          // DIFFERENT collection (a shared/dirty assembly mustn't leak cross-collection arms). Untagged
          // pinned parts are kept — the pin is intentional.
          // legacyErpId matches ONLY on a REAL code — 'N/A'/'PENDING' placeholders used to match each
          // other, which made every placeholder-coded record look "pinned" and leaked stray parts
          // (e.g. cluster component-file assemblies) into the pickers. partId matches id/itemId/erp.
          const realCode = (v) => v && v !== 'N/A' && v !== 'PENDING';
          const pinned = flowPins.some(pin =>
              (pin.partId && (pin.partId === p.id || pin.partId === p.itemId || (realCode(p.legacyErpId) && pin.partId === p.legacyErpId)))
              || (realCode(pin.legacyErpId) && pin.legacyErpId === p.legacyErpId));
          if (!pinned) return false;
          if (scopeCollection && cols.length > 0 && !cols.includes(scopeCollection) && !cols.includes('N/A')) return false;
          return true;
      }
      // No pins: scope strictly by the flow's collection tag so a flow that isn't linked to a pinned
      // assembly (e.g. Brimar Combined) still populates from tags, without dumping the whole brand in.
      if (!scopeCollection) return false;
      return cols.includes(scopeCollection) || cols.includes('N/A');
  };

  const allBrackets = useMemo(() => {
      const step = getStepForCategory('BRACKET');
      const hasPins = flowPins.length > 0;
      return libraryParts.filter(p => {
          const pt = (p.manufacturingSpecs?.productType || '').toUpperCase();
          if (!pt.includes('BRACKET')) return false;
          if (!partInScope(p, hasPins)) return false;
          if (step && step.allowedOptions?.length > 0 && !step.allowedOptions.includes(p.id)) return false;
          return true;
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryParts, scopeCollection, activeFlow, flowPins]);

  // Narrow brackets by mount (open→wall, ceiling→ceiling, inside→inside) for the Outer/Left/
  // Right + Center pickers. Center excludes end-return brackets. Tolerant on the bracketType
  // vocabulary. The currently-selected bracket is always kept in its list so a mount change
  // never silently drops a pick.
  const bracketMatchesMount = (b, mount) => {
      const bt = (b.manufacturingSpecs?.customData?.bracketType || '').toUpperCase();
      const m = (mount || '').toUpperCase();
      // No mount set, OR a bracket with no bracketType tag (mount-agnostic) -> always eligible. Mounts
      // default to 'OPEN', so without this an untagged bracket is silently dropped from every arm list
      // (it can't match 'WALL') even though it's pinned to the flow — while backplates, which skip this
      // filter, still show. That was the "backplates populate but arms don't" bug.
      if (!m || !bt) return true;
      if (m === 'OPEN') return bt.includes('WALL');
      if (m === 'CEILING') return bt.includes('CEIL');
      // 'END' = the canonical spelling of inside-mount (Shared/assemblyTags.js); accept both dialects.
      if (m === 'INSIDE') return bt.includes('INSIDE') || bt.includes('IM') || bt.includes('END');
      return true;
  };
  const isReturnBracketPart = (b) => !!b.manufacturingSpecs?.customData?.isReturnBracket;
  const keepSelected = (list, selId) => (selId && !list.some(b => b.id === selId)) ? list.concat(allBrackets.filter(b => b.id === selId)) : list;
  const leftMount = engData.shape === 'STRAIGHT' ? engData.mountLeft : engData.mountOuter;
  const rightMount = engData.shape === 'STRAIGHT' ? engData.mountRight : engData.mountOuter;
  const leftBrackets = keepSelected(allBrackets.filter(b => bracketMatchesMount(b, leftMount)), engData.bracketId);
  const rightBrackets = keepSelected(allBrackets.filter(b => bracketMatchesMount(b, rightMount)), engData.bracketIdRight);
  const centerBrackets = keepSelected(allBrackets.filter(b => !isReturnBracketPart(b) && bracketMatchesMount(b, engData.mountCenter)), engData.bracketIdCenter);

  // Backplates for the end-return arms (productType BACKPLATE) — same pin + collection scope as the arms.
  const allBackplates = libraryParts.filter(p => {
      const pt = (p.manufacturingSpecs?.productType || '').toUpperCase();
      if (!pt.includes('BACKPLATE') && !pt.includes('BACK PLATE')) return false;
      return partInScope(p, flowPins.length > 0);
  });
  const bpDims = (id) => { const par = libraryParts.find(p => p.id === id)?.manufacturingSpecs?.parametric || {}; return { w: parseFloat(par.width) || 0, l: parseFloat(par.length) || 0 }; };

  // ================= FLOW-MIRROR FABRICATION =================
  // Fabrication Settings fields mirror the CPQ flow's steps 1:1, per position — End Style L/R = the
  // Left/Right End Treatment steps' options; L/C/R Bracket = that position's Bracket & Mount step;
  // L/C/R Backplate = that step's sub-chooser. Selections are stored as the STEP selections
  // (dynamicConfigParams[stepId] = optId — the same shape CPQ uses and the push carries), and engData
  // (part ids / end styles / mounts) is DERIVED from them for the fab math. Grey rules are copied
  // from CPQTab: a chosen return greys+clears that side's bracket (when the step carries returnOnly
  // plates), return plates scope in/out, a basic bracket greys the plate. Works identically for
  // 1.5- and 1.6-built assemblies because it reads only the generated steps' canonical tags.
  const flowSteps = activeFlow?.steps || [];
  const upperS = (s) => String(s || '').toUpperCase();
  const endStepFor = (pos) => flowSteps.find(s => /end treatment/i.test(s.title || '') && upperS(s.position) === pos);
  const bracketStepFor = (pos) => flowSteps.find(s => (s.stepRole === 'BRACKET' || /bracket/i.test(s.title || '')) && !/end treatment/i.test(s.title || '') && upperS(s.position) === pos);
  const stepEndL = endStepFor('LEFT'), stepEndR = endStepFor('RIGHT');
  const stepBrL = bracketStepFor('LEFT'), stepBrR = bracketStepFor('RIGHT'), stepBrC = bracketStepFor('CENTER');
  const flowDriven = !!(stepEndL || stepEndR || stepBrL || stepBrR || stepBrC);
  // SIZE-MATRIX steps (Fabricut H1): Rod Diameter / Projection mirror into window 3 like every
  // other step (dynamicConfigParams[stepId] = optId, push carries them). The fab math reads the
  // SIZED parts — engData part ids resolve through sizeSwapPart so projection + plate dims are the
  // selected size's, and poleDiameter follows the diameter answer.
  const sizeSteps = flowSteps.filter(s => s.type === SIZE_STEP_TYPE);
  // 🎯 Single-assembly flows (H2 pivot): the generated Bracket Projection question renders with
  // the SIZE steps; the pick gates proj-tagged options (projTagOk) and drives engData.proj.
  const projSelectSteps = flowSteps.filter(s => s.type === 'PROJ_SELECT');
  const sizeSel = sizeSelectionsOf(activeFlow, dynamicConfigParams);
  const sizeBundle = makeSizeSwap(activeFlow, dynamicConfigParams, libraryParts);
  const sizeSwapPart = sizeBundle.swap;
  // No french/miter returns at the 3-5/8" projection, and size-native extras (1-3/8" wood/
  // acrylic) only at their own diameter — filters every flow-driven picker + auto-clear.
  const visionSizeIndex = useMemo(() => buildSizeIndex(libraryParts), [libraryParts]);
  // 🎯 Per-assembly projection context (H2 pivot) — mirrors CPQTab exactly: the PROJ_SELECT pick
  // (or the flow's stamped implied projection) gates proj-tagged options. A bracket's proj: tag is
  // the exact projection the physical item IS; a return-type option's tag is a MINIMUM depth.
  // Fabricut/legacy flows carry neither the step nor the stamp → flowProjSel null → every option
  // passes untouched.
  const flowProjSel = useMemo(() => {
      const st = (activeFlow?.steps || []).find(s => s.type === 'PROJ_SELECT');
      if (!st) {
          const imp = parseFloat(String(activeFlow?.impliedProjInches ?? ''));
          return Number.isFinite(imp) ? imp : null;
      }
      const o = (st.styleOptions || []).find(x => x.optId === dynamicConfigParams[st.id]);
      const f = parseFloat(String(o?.projInches ?? '').replace(/[^0-9.]/g, ''));
      return Number.isFinite(f) ? f : null;
  }, [activeFlow, dynamicConfigParams]);
  const projTagOk = (o) => {
      if (flowProjSel == null || !o?.projInches) return true;
      const f = parseFloat(String(o.projInches).replace(/[^0-9.]/g, ''));
      if (!Number.isFinite(f)) return true;
      const et = String(o.endTreatment || '').toUpperCase();
      const returnish = et === 'FRENCH_RETURN' || et === 'MITER_RETURN'
          || (o.isFee && /return|miter|mitre|french|bend/i.test(String(o.partName || '')));
      return returnish ? (flowProjSel >= f - 0.01) : (Math.abs(f - flowProjSel) < 0.01);
  };
  const optAllowedAtSize = (o) => {
      if (!sizeSel) return true;
      return partAllowedAtSize(partOfOpt(o), sizeSel, visionSizeIndex);
  };
  const endOptsFor = (st) => {
      let os = st?.styleOptions || [];
      if (sizeSel && !returnsAllowedFor(sizeSel)) os = os.filter(o => !isReturnOption(o));
      return os.filter(o => optAllowedAtSize(o) && projTagOk(o));
  };
  const brOptsFor = (st) => (st?.styleOptions || []).filter(o => optAllowedAtSize(o) && projTagOk(o));
  const optOf = (step, sel) => step ? ((step.styleOptions || []).find(o => (o.optId || o.partId) === sel) || null) : null;
  const optSel = (step) => optOf(step, step ? dynamicConfigParams[step.id] : null);
  const subOf = (step, sel) => step ? ((step.subOptions || []).find(o => (o.optId || o.partId) === sel) || null) : null;
  const optIsReturn = (o) => {
      const t = upperS(o?.endTreatment);
      if (t) return t === 'FRENCH_RETURN' || t === 'MITER_RETURN' || t === 'INSIDE_MOUNT';
      if (!o) return false;
      if (/^OPT-(BEND|MITER)/i.test(o.optId || '')) return true;
      return /bend|return|miter|mitre|mtr|french/i.test(String(o.partName || ''));
  };
  const endStyleOf = (o) => {
      const t = upperS(o?.endTreatment);
      if (t === 'FRENCH_RETURN') return 'RETURN_BEND';
      if (t === 'MITER_RETURN') return 'RETURN_MITER';
      if (t === 'INSIDE_MOUNT') return 'FLUSH';
      if (t === 'FINIAL') return 'FINIAL';
      if (/^OPT-FLUSH/i.test(o?.optId || '')) return 'FLUSH';
      if (/^OPT-BEND/i.test(o?.optId || '')) return 'RETURN_BEND';
      if (/^OPT-MITER/i.test(o?.optId || '')) return 'RETURN_MITER';
      return o ? 'FINIAL' : '';
  };
  const partOfOpt = (o) => { if (!o) return null; const find = (k) => k && libraryParts.find(p => p.id === k || p.itemId === k || p.legacyErpId === k); return find(o.partId) || find(o.partName) || null; };
  const optLabel = (o) => { const p = sizeSwapPart(partOfOpt(o)); return p ? `${p.itemName}${p.legacyErpId && p.legacyErpId !== 'PENDING' ? ` - ${p.legacyErpId}` : ''}` : (o.partName || o.optId); };
  const returnChosenAt = (pos) => pos === 'LEFT' ? optIsReturn(optSel(stepEndL)) : pos === 'RIGHT' ? optIsReturn(optSel(stepEndR)) : false;
  // ⚠ A RETURN REPLACES THAT END'S BRACKET — FULL STOP (Stuart 2026-08-21: "return selected then
  // left and right bracket choices grey out"). This used to fire only where the bracket step
  // happened to carry `returnOnly` plates, which is a fact about PLATES and says nothing about who
  // carries the rod. H1-138 has no rtn-only plates on that step, so its brackets stayed selectable
  // beside a french return — the drawing offering hardware the quote had already replaced.
  // The engine's rule has no such precondition (BRACKET_REPLACING_ROLES), and neither has this now.
  // An inside mount counts too: optIsReturn covers it, and it carries the rod the same way.
  const brLockedAt = (step, pos) => !!(step && returnChosenAt(pos));
  // END RETURN ARM (Flat Iron pattern): a bracket option flagged isReturnArm (or whose part carries
  // customData.isReturnBracket) IS the end treatment — that side's End Style greys + clears.
  const armOfOpt = (o) => !!(o && (o.isReturnArm || partOfOpt(o)?.manufacturingSpecs?.customData?.isReturnBracket));
  const armChosenAt = (pos) => pos === 'LEFT' ? armOfOpt(optSel(stepBrL)) : pos === 'RIGHT' ? armOfOpt(optSel(stepBrR)) : false;
  // BASIC = takes no backplate. The 1.6 BASIC flag is canonical (option.isBasic); the option's
  // raw partName AND the resolved LIBRARY part's name both backstop it — linked pins carry the
  // bare item code as partName, so an item NAMED "Basic Bracket" must still grey the plates.
  const basicSelAt = (step) => { const o = optSel(step); return !!(o && (o.isBasic || /basic/i.test(o.partName || '') || /basic/i.test(partOfOpt(o)?.itemName || ''))); };
  // ── WHICH PLATES THIS ARM SITS ON ────────────────────────────────────────────────────────
  // ⚠ THE PICKER AND THE SWEEP MUST NOT DISAGREE (Stuart 2026-08-21: "when backplate choices are
  // made, the math in the vision correctly adjusts but the selection does not stick"). They each
  // had their own copy of this rule and the copies had drifted: the picker fell back to the plain
  // plates when no return plate survived the size gate, the sweep did not — so a plate was OFFERED,
  // chosen, read by the fabrication math, and deleted a moment later. The drawing adjusted, the
  // dropdown blanked, and nothing could push back to CPQ because the selection was gone.
  //
  // It lives in Shared/platePool now and BOTH readers call it, in the engine's own order.
  const subPoolFrom = (subs, flags) => platePoolFrom(subs, flags, (o) => optAllowedAtSize(o) && projTagOk(o));
  const subPoolAt = (step, pos) => {
      const subs = step?.subOptions || [];
      const sel = optSel(step);
      return subPoolFrom(subs, {
          returnChosen: returnChosenAt(pos) || !!sel?.isReturnArm,
          inlineBracket: !!sel?.usesReturnPlates,
      });
  };
  const pickStep = (stepId, optId) => setDynamicConfigParams(prev => {
      const next = { ...prev };
      if (optId) next[stepId] = optId; else delete next[stepId];
      // 📏 The flow's Bracket Projection DRIVES the fabrication "Projection (in)" field (Stuart
      // 2026-07-24) — that field feeds the parametric drawing + shop drawing, so a size pick here
      // re-asserts it (DIA picks too: a dia change can self-heal the projection). Manual edits to
      // the field below stay possible afterward — that's the one-off custom-bracket escape hatch.
      const st = (activeFlow?.steps || []).find(s => s.id === stepId && s.type === SIZE_STEP_TYPE);
      if (st) {
          const inches = projInchesOfSel(sizeSelectionsOf(activeFlow, next));
          if (inches != null) setTimeout(() => setEngData(pe => ({ ...pe, proj: inches })), 0);
      }
      // 🎯 A Bracket Projection pick (PROJ_SELECT, single-assembly flows) drives the fab
      // Projection field the same way a size pick does.
      const pst = (activeFlow?.steps || []).find(s => s.id === stepId && s.type === 'PROJ_SELECT');
      if (pst && optId) {
          const o = (pst.styleOptions || []).find(x => (x.optId || x.partId) === optId);
          const f = parseFloat(String(o?.projInches ?? '').replace(/[^0-9.]/g, ''));
          if (Number.isFinite(f)) setTimeout(() => setEngData(pe => ({ ...pe, proj: f })), 0);
      }
      return next;
  });

  // Seed step selections from restored engData part ids (drafts saved before the flow-driven pickers).
  useEffect(() => {
      if (!flowDriven) return;
      setDynamicConfigParams(prev => {
          const next = { ...prev }; let ch = false;
          [[stepBrL, engData.bracketId], [stepBrR, engData.bracketIdRight], [stepBrC, engData.bracketIdCenter]].forEach(([st, pid]) => {
              if (!st || !pid || next[st.id]) return;
              const o = (st.styleOptions || []).find(x => { const p = partOfOpt(x); return p && p.id === pid; });
              if (o) { next[st.id] = o.optId || o.partId; ch = true; }
          });
          return ch ? next : prev;
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFlow, engData.bracketId, engData.bracketIdRight, engData.bracketIdCenter, libraryParts]);

  // CPQ-mirror auto-clear: return greys+clears the bracket; basic bracket clears the plate; a plate
  // from the wrong mode (return ↔ regular) clears on flip.
  useEffect(() => {
      if (!flowDriven) return;
      setDynamicConfigParams(prev => {
          let changed = false; const next = { ...prev };
          // Size rule: flipping Projection to 3-5/8" removes return availability — clear a selected
          // french/miter return so the config can't carry an impossible combination.
          if (sizeSel && !returnsAllowedFor(sizeSel)) {
              [stepEndL, stepEndR].forEach(st => {
                  if (!st || !next[st.id]) return;
                  const o = optOf(st, next[st.id]);
                  if (o && isReturnOption(o)) { delete next[st.id]; changed = true; }
              });
          }
          // 🎯 Projection-tag sweep (single-assembly flows): flipping the Bracket Projection
          // clears any selection whose proj: tag no longer fits — brackets (exact), returns
          // (minimum), and plate sub-picks. No-op when the flow carries no projection context.
          if (flowProjSel != null) {
              [stepEndL, stepEndR, stepBrL, stepBrR, stepBrC].forEach(st => {
                  if (!st) return;
                  const o = optOf(st, next[st.id]);
                  if (o && !projTagOk(o)) { delete next[st.id]; changed = true; }
                  const so = subOf(st, next[`${st.id}__sub`]);
                  if (so && !projTagOk(so)) { delete next[`${st.id}__sub`]; changed = true; }
              });
          }
          [['LEFT', stepBrL], ['RIGHT', stepBrR], ['CENTER', stepBrC]].forEach(([pos, st]) => {
              if (!st) return;
              const endSt = pos === 'LEFT' ? stepEndL : pos === 'RIGHT' ? stepEndR : null;
              const endOpt = endSt ? optOf(endSt, next[endSt.id]) : null;
              const locked = !!optIsReturn(endOpt);      // the return carries the rod — see brLockedAt
              if (locked && next[st.id]) { delete next[st.id]; changed = true; }
              const bo = optOf(st, next[st.id]);
              // A selected END RETURN ARM clears that side's End Treatment (the arm IS the end).
              if (endSt && next[endSt.id] && bo && (bo.isReturnArm || partOfOpt(bo)?.manufacturingSpecs?.customData?.isReturnBracket)) { delete next[endSt.id]; changed = true; }
              const basic = !!(bo && (bo.isBasic || /basic/i.test(bo.partName || '')));
              if (basic && next[`${st.id}__sub`]) { delete next[`${st.id}__sub`]; changed = true; }
              const subs = st.subOptions || [];
              if (subs.some(o => o.returnOnly || o.inlineOnly) && next[`${st.id}__sub`]) {
                  // THE SAME POOL THE PICKER OFFERED. Re-deriving it here is what let the two
                  // disagree; a plate that is on screen is a plate that stays chosen.
                  const pool = subPoolFrom(subs, {
                      returnChosen: optIsReturn(endOpt) || !!bo?.isReturnArm,
                      inlineBracket: !!bo?.usesReturnPlates,
                  });
                  const so = subOf(st, next[`${st.id}__sub`]);
                  if (so && !plateStillOffered(pool, so)) { delete next[`${st.id}__sub`]; changed = true; }
              }
          });
          return changed ? next : prev;
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dynamicConfigParams, activeFlow]);

  // Derive engData (fab math inputs) FROM the step selections: part ids for dims, end styles, and
  // the INSIDE mount flip for inside-mount ends.
  useEffect(() => {
      if (!flowDriven) return;
      setEngData(prev => {
          const u = { ...prev }; let ch = false;
          // One-way writes: a step SELECTION sets the engData part id; NO selection leaves engData
          // alone (drafts / auto-derived values survive). Clearing happens only when the step was
          // return-locked — the return legitimately removed the bracket.
          // Part ids resolve through the size matrix (H1-75BE → H1-1B6) so the auto-synced dims —
          // bracket projection, plate width/length — are the SELECTED size's, not the master's.
          [[stepBrL, 'bracketId', 'LEFT'], [stepBrR, 'bracketIdRight', 'RIGHT'], [stepBrC, 'bracketIdCenter', '']].forEach(([st, key, pos]) => {
              if (!st) return; const o = optOf(st, dynamicConfigParams[st.id]);
              if (o) { const pid = sizeSwapPart(partOfOpt(o))?.id || ''; if (pid && (prev[key] || '') !== pid) { u[key] = pid; ch = true; } }
              else if (pos && brLockedAt(st, pos) && prev[key]) { u[key] = ''; ch = true; }
          });
          [[stepBrL, 'backplateIdLeft', 'LEFT'], [stepBrR, 'backplateIdRight', 'RIGHT'], [stepBrC, 'backplateIdCenter', 'CENTER']].forEach(([st, key]) => {
              if (!st) return; const o = subOf(st, dynamicConfigParams[`${st.id}__sub`]);
              if (o) { const pid = sizeSwapPart(partOfOpt(o))?.id || ''; if (pid && (prev[key] || '') !== pid) { u[key] = pid; ch = true; } }
              else if (basicSelAt(st) && prev[key]) { u[key] = ''; ch = true; }
          });
          // The Rod Diameter answer IS the pole diameter (drives the bend deduct = dia/2).
          if (sizeSel?.diaInches && parseFloat(prev.poleDiameter) !== sizeSel.diaInches) { u.poleDiameter = sizeSel.diaInches; ch = true; }
          [[stepEndL, 'endStyle', 'mountLeft'], [stepEndR, 'endStyleRight', 'mountRight']].forEach(([st, key, mkey]) => {
              if (!st) return; const o = optOf(st, dynamicConfigParams[st.id]); if (!o) return;
              const style = endStyleOf(o);
              if (style && prev[key] !== style) { u[key] = style; ch = true; }
              const im = upperS(o.endTreatment) === 'INSIDE_MOUNT';
              if (prev.shape === 'STRAIGHT') { const want = im ? 'INSIDE' : (prev[mkey] === 'INSIDE' ? 'OPEN' : prev[mkey]); if (prev[mkey] !== want) { u[mkey] = want; ch = true; } }
          });
          return ch ? u : prev;
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dynamicConfigParams, activeFlow, libraryParts]);
  // ================= END FLOW-MIRROR =================

  // --- HARDWARE MATH CALCULATIONS ---
  // The pole/wall solve + raw-cut & O2O ("does it fit?") math now lives in Shared/bayMath.js
  // (computeBayMath) so the customer portal's measurement intake can run the IDENTICAL fit math
  // (verbatim copy in portal/src/shared/ — same rule as sizeMatrix/priceLevels). Inputs and
  // outputs are unchanged; only the names still read below are destructured (the module also
  // returns the shop-only intermediates — orderL/C/R, deducts, raw adds — so the portal draft
  // can store them). The SVG/plan-view geometry below stays component-local: drawing, not fit math.
  const rad = (deg) => (deg * Math.PI) / 180;
  const S = 3.5;
  let bowCX=500, bowCY=250, bowStartAngle=0, bowEndAngle=0, bowWallPath="", bowHWPath="";
  const {
      isLeftInside, isRightInside, endStyleL, endStyleR,
      mDeduct1, mDeduct2, wall1, wall2, wall3, pole1, pole2, pole3, sawAngle1, sawAngle2,
      rawLeft, rawCenter, rawRight, poleO2O, endAddL, endAddR, totalSystemO2O,
      poleFeetQty, qtyMiters, qtyBends, qtyMiterReturns, qtyFinials, recRings, bowR, bowHW_R,
  } = computeBayMath({ engData, safeProj, libraryParts });

  const qtyBrackets = attachments.filter(a => a.type === 'bracket').length;
  const qtyCenterBrackets = attachments.filter(a => a.type === 'bracket' && /center/i.test(a.note || '')).length;
  const qtySplices = attachments.filter(a => a.type === 'splice').length;
  const qtyCustomProjBrackets = isCustomProj ? qtyBrackets : 0;

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
          // Build the plan-view arc paths (were declared but never assigned → curved pole rendered blank).
          // Minor arc (large-arc=0), sweep=1 so it bulges UP through the top — matching the bracket-placement
          // locus at lines ~504/1302. bowWallPath = chord wall (radius bowR); bowHWPath = the curved pole (radius bowHW_R).
          const largeArc = Math.abs(bowEndAngle - bowStartAngle) > Math.PI ? 1 : 0;
          bowWallPath = `M ${P2.x} ${P2.y} A ${rW_px} ${rW_px} 0 ${largeArc} 1 ${P3.x} ${P3.y}`;
          bowHWPath = `M ${HS.x} ${HS.y} A ${rH_px} ${rH_px} 0 ${largeArc} 1 ${HE.x} ${HE.y}`;
      }
  }

  let drawHS = { ...HS }; let drawHE = { ...HE };
  const rBend = engData.returnRadius * S;
  if (endStyleL === 'RETURN_BEND' && !isLeftInside) {
      let inVec = {x: 1, y: 0};
      if (engData.shape === 'MITERED') { const dx = HC1.x - HS.x; const dy = HC1.y - HS.y; const len = Math.sqrt(dx*dx + dy*dy) || 1; inVec = {x: dx/len, y: dy/len}; }
      if (engData.shape !== 'BOW') drawHS = { x: HS.x + inVec.x * rBend, y: HS.y + inVec.y * rBend };
  }
  if (endStyleR === 'RETURN_BEND' && !isRightInside) {
      let inVec = {x: -1, y: 0};
      if (engData.shape === 'MITERED') { const dx = HC2.x - HE.x; const dy = HC2.y - HE.y; const len = Math.sqrt(dx*dx + dy*dy) || 1; inVec = {x: dx/len, y: dy/len}; }
      if (engData.shape !== 'BOW') drawHE = { x: HE.x + inVec.x * rBend, y: HE.y + inVec.y * rBend };
  }

  const renderEndTreatment = (isLeft, forceFlatten = false) => {
      const isInside = isLeft ? isLeftInside : isRightInside;
      const es = isLeft ? endStyleL : endStyleR;
      const startOrig = isLeft ? HS : HE; const stopPoint = isLeft ? drawHS : drawHE; const norm = isLeft ? nL : nR; 
      if (isInside) return forceFlatten ? null : <line x1={startOrig.x - norm.y*15} y1={startOrig.y + norm.x*15} x2={startOrig.x + norm.y*15} y2={startOrig.y - norm.x*15} stroke="var(--line)" strokeWidth="6" />;
      if (es === 'FINIAL') {
          let outVec = {x: -1, y: 0};
          if (engData.shape === 'STRAIGHT') outVec = isLeft ? {x: -1, y: 0} : {x: 1, y: 0};
          else if (engData.shape === 'MITERED') { const dx = (isLeft?HS:HE).x - (isLeft?HC1:HC2).x; const dy = (isLeft?HS:HE).y - (isLeft?HC1:HC2).y; const len = Math.sqrt(dx*dx + dy*dy) || 1; outVec = {x: dx/len, y: dy/len}; }
          else if (engData.shape === 'BOW') { const rx = startOrig.x - bowCX; const ry = startOrig.y - bowCY; const rlen = Math.sqrt(rx*rx + ry*ry) || 1; outVec = isLeft ? {x: ry/rlen, y: -rx/rlen} : {x: -ry/rlen, y: rx/rlen}; }
          const fw = engData.finialW * S;
          return forceFlatten ? <circle cx={startOrig.x + outVec.x * fw} cy="0" r="10" fill="var(--brass)" /> : <line x1={startOrig.x} y1={startOrig.y} x2={startOrig.x + outVec.x*fw} y2={startOrig.y + outVec.y*fw} stroke="var(--brass)" strokeWidth="6" />;
      }
      if (es === 'RETURN_MITER') {
          const wx = startOrig.x + norm.x * (safeProj * S); const wy = startOrig.y + norm.y * (safeProj * S);
          let outVec = {x: -1, y: 0};
          if (engData.shape === 'STRAIGHT') outVec = isLeft ? {x: -1, y: 0} : {x: 1, y: 0};
          if (engData.shape === 'MITERED') { const dx = (isLeft?HS:HE).x - (isLeft?HC1:HC2).x; const dy = (isLeft?HS:HE).y - (isLeft?HC1:HC2).y; const len = Math.sqrt(dx*dx + dy*dy) || 1; outVec = {x: dx/len, y: dy/len}; }
          if (forceFlatten) return <line x1={startOrig.x} y1="0" x2={startOrig.x} y2="-15" stroke="var(--brass)" strokeWidth="8" />;
          return ( <g><line x1={startOrig.x} y1={startOrig.y} x2={wx} y2={wy} stroke="var(--brass)" strokeWidth="1.5" /><line x1={startOrig.x + outVec.x*2 - norm.x*2} y1={startOrig.y + outVec.y*2 - norm.y*2} x2={startOrig.x - outVec.x*2 + norm.x*2} y2={startOrig.y - outVec.y*2 + norm.y*2} stroke="#fff" strokeWidth="0.5" /></g> );
      }
      if (es === 'RETURN_BEND') {
          const r = engData.returnRadius * S; const projPx = safeProj * S;
          let outVec = {x: -1, y: 0};
          if (engData.shape === 'STRAIGHT') outVec = isLeft ? {x: -1, y: 0} : {x: 1, y: 0};
          if (engData.shape === 'MITERED') { const dx = (isLeft?HS:HE).x - (isLeft?HC1:HC2).x; const dy = (isLeft?HS:HE).y - (isLeft?HC1:HC2).y; const len = Math.sqrt(dx*dx + dy*dy) || 1; outVec = {x: dx/len, y: dy/len}; }
          if (engData.shape === 'BOW') { const rx = stopPoint.x - bowCX; const ry = stopPoint.y - bowCY; const rlen = Math.sqrt(rx*rx + ry*ry) || 1; outVec = isLeft ? {x: ry/rlen, y: -rx/rlen} : {x: -ry/rlen, y: rx/rlen}; }
          const arcCX = stopPoint.x + norm.x * r; const arcCY = stopPoint.y + norm.y * r; const arcEndX = arcCX + outVec.x * r; const arcEndY = arcCY + outVec.y * r; const sweep = isLeft ? 1 : 0; const wallX = arcEndX + norm.x * (projPx - r); const wallY = arcEndY + norm.y * (projPx - r);
          if (forceFlatten) return <line x1={stopPoint.x} y1="0" x2={stopPoint.x} y2="-15" stroke="var(--brass)" strokeWidth="8" />;
          return ( <g><path d={`M ${stopPoint.x} ${stopPoint.y} A ${r} ${r} 0 0 ${sweep} ${arcEndX} ${arcEndY}`} fill="none" stroke="var(--brass)" strokeWidth="1.5" />{projPx > r && <line x1={arcEndX} y1={arcEndY} x2={wallX} y2={wallY} stroke="var(--brass)" strokeWidth="1.5" />}</g> );
      }
      return null;
  };

  const renderHardwareElevation = () => {
      const eHSx = drawHS.x - perspectiveStretch.L; const eHEx = drawHE.x + perspectiveStretch.R;
      return (
          <g>
              {engData.shape === 'STRAIGHT' && <line x1={eHSx} y1="0" x2={eHEx} y2="0" stroke="var(--brass)" strokeWidth="8" />}
              {engData.shape === 'MITERED' && ( <g><polyline points={`${eHSx},0 ${HC1.x},0 ${HC2.x},0 ${eHEx},0`} fill="none" stroke="var(--brass)" strokeWidth="8" strokeLinejoin="miter" /><line x1={HC1.x} y1="-5" x2={HC1.x} y2="5" stroke="var(--ink)" strokeWidth="1" opacity="0.5" /><line x1={HC2.x} y1="-5" x2={HC2.x} y2="5" stroke="var(--ink)" strokeWidth="1" opacity="0.5" /></g> )}
              {engData.shape === 'BOW' && <line x1={eHSx} y1="0" x2={eHEx} y2="0" stroke="var(--brass)" strokeWidth="8" />}
              
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
                                  <circle cx={x} cy={y} r="4" fill="var(--ink)" />
                                  <line x1={x} y1={y} x2={x + nX * (safeProj * S)} y2={y + nY * (safeProj * S)} stroke="var(--ink-soft)" strokeWidth="2" />
                              </g>
                          ) : (
                              <g>
                                  <line x1={x - nX*8 - nY*4} y1={y - nY*8 + nX*4} x2={x + nX*8 - nY*4} y2={y + nY*8 + nX*4} stroke="var(--ink)" strokeWidth="2" />
                                  <line x1={x - nX*8 + nY*4} y1={y - nY*8 - nX*4} x2={x + nX*8 + nY*4} y2={y + nY*8 - nX*4} stroke="var(--ink)" strokeWidth="2" />
                              </g>
                          )}
                          <line x1={x} y1={y-5} x2={x} y2={y-80} stroke={att.type==='bracket'?'var(--ink)':'var(--ink)'} strokeWidth="1" strokeDasharray="2,2" />
                          <foreignObject x={x - 55} y={y - 135} width="110" height="50" style={{ overflow: 'visible' }}>
                              <div style={{ background: '#fff', border: `1px solid ${att.type==='bracket'?'var(--line)':'var(--line)'}`, display: 'flex', flexDirection: 'column', padding: '4px', borderRadius: '2px', boxShadow: '0 2px 5px rgba(0,0,0,0.05)' }}><input type="number" value={att.distInches} step="0.125" onChange={(e) => handleUpdateAttachmentDist(att.id, e.target.value)} onPointerDown={e => e.stopPropagation()} style={{ width: '100%', fontSize: '12px', fontFamily: 'var(--sans)', textAlign: 'center', border: 'none', background: 'var(--paper)', outline: 'none' }} /><span style={{ fontSize: '9px', fontFamily: 'var(--mono)', textTransform: 'uppercase', color: 'var(--ink-soft)', textAlign: 'center', margin: '2px 0' }}>from {att.ref === 'START' ? seg.nA : seg.nB}</span><input type="text" placeholder="Notes..." value={att.note||''} onChange={(e) => handleUpdateAttachmentNote(att.id, e.target.value)} onPointerDown={e => e.stopPropagation()} style={{ width: '100%', fontSize: '10px', fontFamily: 'var(--sans)', border: '1px solid var(--line)', outline: 'none', textAlign: 'center' }} /></div>
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
              <line x1={pA.x + offsetDir.x*2} y1={pA.y + offsetDir.y*2} x2={sp.x + offsetDir.x*2} y2={sp.y + offsetDir.y*2} stroke="var(--line)" strokeWidth="1" />
              <line x1={pB.x + offsetDir.x*2} y1={pB.y + offsetDir.y*2} x2={ep.x + offsetDir.x*2} y2={ep.y + offsetDir.y*2} stroke="var(--line)" strokeWidth="1" />
              <line x1={sp.x} y1={sp.y} x2={ep.x} y2={ep.y} stroke="var(--ink)" strokeWidth="0.5" strokeDasharray="2,2" />
              <line x1={sp.x - 2 + offsetDir.x*2} y1={sp.y - 2 + offsetDir.y*2} x2={sp.x + 2 - offsetDir.x*2} y2={sp.y + 2 - offsetDir.y*2} stroke="var(--ink)" strokeWidth="1" />
              <line x1={ep.x - 2 + offsetDir.x*2} y1={ep.y - 2 + offsetDir.y*2} x2={ep.x + 2 - offsetDir.x*2} y2={ep.y + 2 - offsetDir.y*2} stroke="var(--ink)" strokeWidth="1" />
              <rect x={mid.x - 45} y={mid.y - 9} width="90" height="18" fill="var(--paper)" />
              <text x={mid.x} y={mid.y + 4} fill="var(--ink)" fontSize="11" fontFamily="var(--mono)" letterSpacing=".05em" textAnchor="middle">{label}</text>
          </g>
      );
  };

  const handleUpdateAttachmentDist = (id, newDist) => { setAttachments(atts => atts.map(a => a.id === id ? { ...a, distInches: parseFloat(newDist) || 0 } : a)); };
  const handleUpdateAttachmentNote = (id, text) => { setAttachments(atts => atts.map(a => a.id === id ? { ...a, note: text } : a)); };

  // Auto-place brackets along a STRAIGHT pole. Support rules:
  //  • max span between supports = 48" — tightened to 36" when the rod is ¾" (poleDiameter ≤ .76)
  //  • a return end COUNTS AS a support (French bend, miter return, inside-mount socket — anything
  //    that kills the finial step in CPQ): no end bracket is placed there. A selected return/end
  //    ARM still places its bracket at 0" — the arm itself is that end's support. So a 96" pole
  //    with French returns recommends just one center bracket.
  //  • splices are KEPT, and each one gets a support bracket recommended at its position.
  const handleAutoPlaceBrackets = () => {
      if (engData.shape !== 'STRAIGHT') return alert("Auto-place currently supports straight poles. Miter / Bow are coming next.");
      const segLen = pole2;
      if (!segLen || segLen <= 0) return alert("Enter the pole width / measurements first so there's a length to lay out.");
      const keptSplices = attachments.filter(a => a.type === 'splice');
      if (attachments.some(a => a.type === 'bracket') && !window.confirm("Replace the current bracket placements with a fresh auto-layout? Splices are kept (each gets a support bracket); manual bracket positions are cleared.")) return;
      const isRet = (id) => !!libraryParts.find(p => p.id === id)?.manufacturingSpecs?.customData?.isReturnBracket;
      const isRetStyle = (s) => s === 'RETURN_BEND' || s === 'RETURN_MITER';
      const snap = (n) => Math.round(n * 8) / 8;
      const maxSpan = (parseFloat(engData.poleDiameter) || 1) <= 0.76 ? 36 : 48; // ¾" rod carries less — tighter spacing
      let idc = Date.now();
      const next = [];
      const supports = [];
      // Ends: an arm pick always places its bracket (at 0" when it's a return/end arm or the end
      // returns); a return style or inside mount with NO arm is self-supporting — supported, but
      // nothing to place.
      [[engData.bracketId, endStyleL, isLeftInside, 'START', 'End · L'], [engData.bracketIdRight, endStyleR, isRightInside, 'END', 'End · R']].forEach(([bktId, style, inside, ref, note]) => {
          const selfSupported = isRetStyle(style) || inside;
          if (bktId) {
              const off = (isRet(bktId) || selfSupported) ? 0 : 3;
              next.push({ id: idc++, type: 'bracket', segId: 2, distInches: snap(off), ref, note });
              supports.push(ref === 'START' ? off : segLen - off);
          } else if (selfSupported) {
              supports.push(ref === 'START' ? 0 : segLen); // return / socket holds this end
          } else {
              next.push({ id: idc++, type: 'bracket', segId: 2, distInches: snap(3), ref, note });
              supports.push(ref === 'START' ? 3 : segLen - 3);
          }
      });
      // Splices: keep them, and recommend a support bracket at each splice position.
      keptSplices.forEach(sp => {
          const d = parseFloat(sp.distInches) || 0;
          next.push({ id: idc++, type: 'bracket', segId: 2, distInches: snap(d), ref: sp.ref || 'START', note: 'Splice support' });
          supports.push(sp.ref === 'END' ? segLen - d : d);
      });
      // Fill every remaining gap so no span between supports exceeds maxSpan.
      supports.sort((a, b) => a - b);
      for (let i = 0; i < supports.length - 1; i++) {
          const a = supports[i], b = supports[i + 1];
          const nMid = Math.ceil((b - a) / maxSpan) - 1;
          for (let k = 1; k <= nMid; k++) next.push({ id: idc++, type: 'bracket', segId: 2, distInches: snap(a + ((b - a) * k) / (nMid + 1)), ref: 'START', note: 'Center' });
      }
      setAttachments([...next, ...keptSplices]);
  };
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
    
    if (viewMode === 'TAKEOFF' && takeoffTool === "pan") { setIsPanning(true); setPanStart({ clientX: e.clientX, clientY: e.clientY }); return; }
    if (viewMode === 'VISUAL' && visualTool === "pan") { setIsPanning(true); setPanStart({ clientX: e.clientX, clientY: e.clientY }); return; }
    if (viewMode === 'ENGINEERING' && engTool === "pan") { setIsPanning(true); setPanStart({ clientX: e.clientX, clientY: e.clientY }); return; }

    const pt = getAdjustedSvgPoint(e.clientX, e.clientY);
    if (!pt) return; 

    if (viewMode === 'TAKEOFF' && takeoffTool === "calibrate") {
      if (takeoffCalPoints.length >= 2) { setTakeoffCalPoints([pt]); setIsTakeoffCalibrated(false); } 
      else {
        const updatedPoints = [...takeoffCalPoints, pt]; setTakeoffCalPoints(updatedPoints);
        if (updatedPoints.length === 2) { 
           const pxDist = Math.sqrt(Math.pow(updatedPoints[1].x - updatedPoints[0].x, 2) + Math.pow(updatedPoints[1].y - updatedPoints[0].y, 2));
           const val = parseFloat(takeoffRealInches) || 0;
           if (val > 0) setTakeoffPPI(pxDist / val);
           setIsTakeoffCalibrated(true); setTakeoffTool("measure"); 
        }
      }
      return;
    }

    if (viewMode === 'TAKEOFF' && takeoffTool === "measure") {
      if (takeoffMeasurePoints.length === 1) {
          const pt1 = takeoffMeasurePoints[0]; const pt2 = pt;
          const pxDist = Math.sqrt(Math.pow(pt2.x - pt1.x, 2) + Math.pow(pt2.y - pt1.y, 2));
          const inches = takeoffPPI > 0 ? (pxDist / takeoffPPI) : 0;
          const newMeasurement = { id: Date.now(), p1: pt1, p2: pt2, inches: parseFloat(inches.toFixed(2)), label: `Measurement ${takeoffMeasurements.length + 1}` };
          setTakeoffMeasurements([...takeoffMeasurements, newMeasurement]);
          setTakeoffMeasurePoints([]);
      } else {
          setTakeoffMeasurePoints([pt]);
      }
      return;
    }

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
                const dist = Math.round(displayDist * 8) / 8;
                const placed = [{ id: Date.now(), type: engTool, segId: closestSeg.id, distInches: dist, ref: ref, note: '' }];
                // A splice needs support: recommend a bracket at the same position (unless one already sits within 1").
                if (engTool === 'splice') {
                    const absOf = (a) => a.ref === 'END' ? closestSeg.len - (parseFloat(a.distInches) || 0) : (parseFloat(a.distInches) || 0);
                    const abs = ref === 'END' ? closestSeg.len - dist : dist;
                    const hasNear = attachments.some(a => a.type === 'bracket' && a.segId === closestSeg.id && Math.abs(absOf(a) - abs) <= 1);
                    if (!hasNear) placed.push({ id: Date.now() + 1, type: 'bracket', segId: closestSeg.id, distInches: dist, ref: ref, note: 'Splice support' });
                }
                setAttachments([...attachments, ...placed]);
            }
        }
    }
  };

  const onPointerMove = (e) => {
    if (viewMode === 'TAKEOFF' && takeoffTool === 'measure' && takeoffMeasurePoints.length === 1) {
        const pt = getAdjustedSvgPoint(e.clientX, e.clientY);
        if (pt) setTakeoffMousePos(pt);
    }
    
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
          
          if (viewMode === 'TAKEOFF') setTakeoffPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
          else if (viewMode === 'VISUAL') setVisPan(prev => ({ x: prev.x + dx, y: prev.y + dy })); 
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

  const handleTakeoffUpload = (e) => {
    if (e.target.files[0]) {
      setTakeoffBg({ name: e.target.files[0].name, url: URL.createObjectURL(e.target.files[0]) });
      setTakeoffMeasurements([]); setTakeoffMeasurePoints([]); setTakeoffCalPoints([]); setIsTakeoffCalibrated(false); 
      setTakeoffScale(1); setTakeoffPan({ x: 0, y: 0 }); setTakeoffTool("calibrate"); 
    }
  };

  const pushMeasurementToEng = (m) => {
      setEngData(prev => ({ ...prev, w2: m.inches, inputMode: 'ORDERING' }));
      setSidemark(m.label);
      setViewMode('ENGINEERING');
  };
  
  const handleDropConfig = () => {
    const config = visionConfigs.find(c => c.id === selectedConfigId);
    if (!config || !isCalibrated) return;
    const realWidthInches = config.specs?.w2 || config.specs?.width || 80;
    const itemWidthPx = realWidthInches * pixelsPerInch; const itemHeightPx = 6 * pixelsPerInch;
    setPlacedItems([...placedItems, { id: `PLACED-${Date.now()}`, configId: config.id, name: config.jobName || config.sidemark || config.id, x: 500 - itemWidthPx/2, y: 400 - itemHeightPx/2, width: itemWidthPx, height: itemHeightPx, color: 'var(--ink)', label: config.sidemark || "Configured Assembly", realWidth: realWidthInches }]);
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

  // Load a saved session line (cpq_drafts) back onto the Engineering board — dimensions,
  // bracket/splice placements, and shop notes restore for editing. Save Line then UPDATES that
  // same draft (same id), so a later Reopen-in-CPQ / re-finalize carries the corrected numbers.
  const sessionDrafts = (visionConfigs || []).filter(c => c.masterQuoteId === activeSession?.quoteId && c.spatialData);
  const handleLoadDraft = (id) => {
      const cfg = (visionConfigs || []).find(c => c.id === id);
      if (!cfg || !cfg.spatialData) return alert("This saved line carries no board data to load.");
      const { attachments: savedAtts, shopNotes: savedNotes, ...savedEng } = cfg.spatialData;
      setEngData({ ...defaultEngData, ...savedEng });
      setAttachments(Array.isArray(savedAtts) ? savedAtts : []);
      setShopNotes(Array.isArray(savedNotes) ? savedNotes : []);
      setSidemark(cfg.sidemark || '');
      const flowId = cfg.flowId || cfg.linkedCpqFlowId || cfg.cpqFlowId;
      if (flowId) setQuoteFlowId(flowId);
      const { engineeringNotes: _en, collection: savedCollection, bracketId: _bid, ...stepParams } = cfg.specs || {};
      setDynamicConfigParams(stepParams || {});
      setQuoteSelections({ collection: savedCollection || '' });
      setEditingDraftId(cfg.id);
      setViewMode('ENGINEERING');
  };

  const handlePushToCPQ = async () => {
      if (!activeSession?.quoteId) return alert("Please select a customer in the main header to initialize a session.");
      if (!sidemark) return alert("Please enter a Sidemark for this specific item.");
      if (!quoteFlowId) return alert("Please select a CPQ Flow in Step 1.");
      // NO bracket requirement here (removed 2026-07-08 per Stuart): a french/miter return or an
      // end-return arm ACTS as the bracket, and short poles (<60") may legitimately skip a center —
      // demanding engData.bracketId blocked every return-end line. The save-gate button already
      // guides the operator to settle the left end; the draft simply carries no bracketId when none
      // applies and CPQ opens without a pre-selected bracket.

      setIsPushingToCPQ(true);
      // Editing a loaded line → keep its id so the draft UPDATES in place (re-finalize picks it up).
      const draftId = editingDraftId || `DRAFT-${Date.now()}`;

      let capturedSvg = "";
      if (svgRef.current) {
          const clone = svgRef.current.cloneNode(true);
          clone.style.backgroundColor = "#ffffff";
          
          let svgStr = new XMLSerializer().serializeToString(clone);
          
          svgStr = svgStr.replace(/var\(--brass\)/g, '#c5a059')
                         .replace(/var\(--ink\)/g, '#1c1a16')
                         .replace(/var\(--ink-soft\)/g, '#524e46')
                         .replace(/var\(--line\)/g, '#e2ded5')
                         .replace(/var\(--paper\)/g, '#f4f0e6')
                         .replace(/var\(--paper-2\)/g, '#faf8f4')
                         .replace(/var\(--dark\)/g, '#2a2a2a');
          
          svgStr = svgStr.replace(/transform="[^"]*"/i, 'transform="translate(0, 0) translate(500, 300) scale(1.7) translate(-500, -300)"');
          svgStr = svgStr.replace(/<foreignObject[\s\S]*?<\/foreignObject>/g, '');
          capturedSvg = svgStr;
      }

      // Hanger placement capture: each placed bracket marks where an FIPBH (passing-bracket
      // hanger) mounts; each splice marks where an FIPBHS (splice hanger) mounts. Resolve each
      // marker's distance-from-edge into a readable position and carry the list to the
      // shop-floor BOM (engineeringNotes -> fabNotes) so the floor knows where to set the
      // hidden hangers. Applies to every Flat Iron flow (data-driven off the placed markers).
      const edgeNamesForSeg = (segId) => (
          engData.shape === 'MITERED'
              ? ({ 1: ['L.Edge', 'L.Miter'], 2: ['L.Miter', 'R.Miter'], 3: ['R.Miter', 'R.Edge'] }[segId] || ['L.Edge', 'R.Edge'])
              : ['L.Edge', 'R.Edge']
      );
      let _bSeq = 0, _sSeq = 0;
      const hangerLocations = attachments.map(att => {
          const isBracket = att.type === 'bracket';
          const pair = edgeNamesForSeg(att.segId);
          const fromEdge = att.ref === 'START' ? pair[0] : pair[1];
          const seq = isBracket ? ++_bSeq : ++_sSeq;
          return {
              code: isBracket ? 'FIPBH' : 'FIPBHS',
              anchor: isBracket ? `Bracket ${seq}` : `Splice ${seq}`,
              position: `${att.distInches}" from ${fromEdge}`,
              note: att.note || ''
          };
      });

      const payload = {
          id: draftId, brandId: activeBrand, category: 'HARDWARE', status: 'DRAFT_FROM_VISION', 
          jobName: activeSession.jobName, 
          sidemark: sidemark,
          customerId: activeSession.customerId, 
          linkedAssemblyId: activeFlow?.linkedAssemblyId || null,
          linkedCpqFlowId: activeFlow?.id || null, 
          flowId: activeFlow?.id || null,          
          cpqFlowId: activeFlow?.id || null, 
          masterQuoteId: activeSession.quoteId,      
          specs: {
              collection: quoteSelections.collection,
              bracketId: engData.bracketId,
              engineeringNotes: {
                  poleFeetQty, qtyBrackets, qtyCenterBrackets, recRings, qtyFinials, qtySplices, qtyMiters,
                  qtyBends, qtyMiterReturns, qtyCustomProjBrackets, shape: engData.shape,
                  poleO2O, totalSystemO2O, pole1, pole2, pole3, hangerLocations, svgString: capturedSvg,
                  // Shop-floor cut sheet: per-segment finished lengths (above), raw cut lengths, miter
                  // saw angles + wall angles, bend radius + pole diameter — so the floor cuts/bends from
                  // the engineered numbers without re-deriving them.
                  sawAngle1, sawAngle2, wallAngleL: engData.a1, wallAngleR: engData.a2,
                  rawLeft, rawCenter, rawRight, returnRadius: engData.returnRadius, poleDiameter: engData.poleDiameter
              },
              ...dynamicConfigParams
          }, 
          spatialData: { ...engData, attachments, shopNotes }, 
          author: currentUser, createdAt: serverTimestamp() 
      };
      
      try {
          await setDoc(doc(db, "cpq_drafts", draftId), payload);
          alert(editingDraftId
              ? `✅ "${sidemark}" UPDATED (same line ${draftId}). Reopen the quote in CPQ / re-finalize to carry the new numbers through.`
              : `✅ "${sidemark}" line saved to session! Canvas cleared for the next line.`);

          setEditingDraftId(null);
          setLoadDraftPick('');
          setSidemark('');
          setAttachments([]);
          setShopNotes([]);
          setQuoteFlowId('');
          setDynamicConfigParams({});
          setQuoteSelections({ collection: '' });
          setEngData(defaultEngData);
          setShowQuotePanel(false);
      } 
      catch (e) { console.error(e); alert("Error saving line to session."); } 
      finally { setIsPushingToCPQ(false); }
  };

  const fieldStyle = { width: '100%', padding: '12px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none' };
  const labelStyle = { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px', letterSpacing: '.1em' };

  let currentCursor = 'crosshair';
  if (viewMode === 'VISUAL') currentCursor = visualTool === 'pan' ? (isPanning ? 'grabbing' : 'grab') : 'crosshair';
  else if (viewMode === 'TAKEOFF') currentCursor = takeoffTool === 'pan' ? (isPanning ? 'grabbing' : 'grab') : 'crosshair';
  else if (viewMode === 'ENGINEERING') currentCursor = engTool === 'pan' ? (isPanning ? 'grabbing' : 'grab') : 'crosshair';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', fontFamily: 'var(--sans)', backgroundColor: 'transparent', minHeight: '100vh', overflow: 'hidden' }}>
      
      <div style={{ display: 'flex', background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
          {['TAKEOFF', 'ENGINEERING', 'VISUAL'].map(mode => (
             <button key={mode} onClick={() => setViewMode(mode)} style={{ flex: 1, padding: '16px', background: viewMode === mode ? 'var(--paper-2)' : 'transparent', color: viewMode === mode ? 'var(--ink)' : 'var(--ink-soft)', border: 'none', borderBottom: viewMode === mode ? '2px solid var(--brass)' : '2px solid transparent', fontFamily: 'var(--mono)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer', outline: 'none', transition: 'all 0.2s' }}>
                 {mode === 'TAKEOFF' ? '1. Plan Take-Offs' : mode === 'ENGINEERING' ? '2. Hardware Engine' : '3. Visual Overlay'}
             </button>
          ))}
      </div>

      <div style={{ display: 'flex', gap: '24px', alignItems: 'stretch', flex: 1, opacity: activeSession?.quoteId ? 1 : 0.4, pointerEvents: activeSession?.quoteId ? 'auto' : 'none' }}>
          
          {!showQuotePanel && (
            <div style={{ width: (viewMode === 'VISUAL' || viewMode === 'TAKEOFF') ? '340px' : '480px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '24px' }}>
                
                {viewMode === 'ENGINEERING' && (
                  <>
                    <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                        <div style={{ padding: '16px 20px', background: 'var(--paper-2)', color: 'var(--ink)', fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, borderBottom: '1px solid var(--line)' }}>1. Line Item Details & CPQ Flow</div>
                        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div>
                                <label style={labelStyle}>* Line Item Sidemark</label>
                                <input type="text" placeholder="e.g. Master Bath Window" value={sidemark} onChange={e => setSidemark(e.target.value)} style={{...fieldStyle, border: '1px solid var(--brass)'}} />
                            </div>
                            <div>
                                <label style={labelStyle}>* Assign Hardware Collection (CPQ)</label>
                                <select value={quoteFlowId} onChange={e => { setQuoteFlowId(e.target.value); setDynamicConfigParams({}); }} style={fieldStyle}>
                                    <option value="">-- SELECT MATCHING CPQ FLOW --</option>
                                    {(() => {
                                        // 🎯 Single-assembly siblings (H2 pivot): flows stamped sizeGroupLabel
                                        // collapse under one optgroup per collection, one entry per rod
                                        // diameter — mirrors the CPQ landing. Unstamped flows (Fabricut H1,
                                        // legacy) render exactly as before.
                                        const groups = {};
                                        cpqFlows.forEach(f => { if (f.sizeGroupLabel) (groups[f.sizeGroupLabel] = groups[f.sizeGroupLabel] || []).push(f); });
                                        Object.values(groups).forEach(list => list.sort((a, b) => (a.sizeGroupSort ?? 99) - (b.sizeGroupSort ?? 99)));
                                        return [
                                            ...cpqFlows.filter(f => !f.sizeGroupLabel).map(f => <option key={f.id} value={f.id}>{f.name}</option>),
                                            ...Object.keys(groups).sort().map(g => (
                                                <optgroup key={g} label={g}>
                                                    {groups[g].map(f => <option key={f.id} value={f.id}>{f.sizeGroupChoice || f.name}</option>)}
                                                </optgroup>
                                            ))
                                        ];
                                    })()}
                                </select>
                            </div>
                        </div>
                    </div>

                    <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                        <div style={{ padding: '16px 20px', background: 'var(--paper-2)', color: 'var(--ink)', fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--line)' }}>
                            <span>2. Spatial Parameters</span>
                            <select value={engData.inputMode} onChange={e => setEngData({...engData, inputMode: e.target.value})} style={{ fontFamily: 'var(--sans)', fontSize: '0.85rem', background: 'transparent', color: 'var(--ink)', border: 'none', outline: 'none', cursor: 'pointer' }}>
                                <option value="ORDERING">Use Ordering Length (Pole)</option>
                                <option value="WALL">Use Wall Dimensions</option>
                            </select>
                        </div>
                        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            <div style={{ display: 'flex', gap: '20px' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={labelStyle}>Bay Configuration</label>
                                    <select value={engData.shape} onChange={e => setEngData({...engData, shape: e.target.value})} style={fieldStyle}>
                                        <option value="STRAIGHT">Straight Pole</option>
                                        <option value="MITERED">Mitered Bay (3-Seg)</option>
                                        <option value="BOW">Curved Bay</option>
                                    </select>
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={labelStyle}>Mount ({engData.shape === 'STRAIGHT' ? 'L / C / R' : 'Ends / Center'})</label>
                                    {engData.shape === 'STRAIGHT' ? (
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <select value={engData.mountLeft} onChange={e => setEngData({...engData, mountLeft: e.target.value})} style={fieldStyle}>
                                                <option value="OPEN">L: Open</option><option value="INSIDE">L: Inside</option><option value="CEILING">L: Ceiling</option>
                                            </select>
                                            <select value={engData.mountCenter} onChange={e => setEngData({...engData, mountCenter: e.target.value})} style={fieldStyle}>
                                                <option value="OPEN">C: Open</option><option value="INSIDE">C: Inside</option><option value="CEILING">C: Ceiling</option>
                                            </select>
                                            <select value={engData.mountRight} onChange={e => setEngData({...engData, mountRight: e.target.value})} style={fieldStyle}>
                                                <option value="OPEN">R: Open</option><option value="INSIDE">R: Inside</option><option value="CEILING">R: Ceiling</option>
                                            </select>
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <select value={engData.mountOuter} onChange={e => setEngData({...engData, mountOuter: e.target.value})} style={fieldStyle}>
                                                <option value="OPEN">Ends: Open</option><option value="INSIDE">Ends: Inside</option><option value="CEILING">Ends: Ceiling</option>
                                            </select>
                                            <select value={engData.mountCenter} onChange={e => setEngData({...engData, mountCenter: e.target.value})} style={fieldStyle}>
                                                <option value="OPEN">C: Open</option><option value="INSIDE">C: Inside</option><option value="CEILING">C: Ceiling</option>
                                            </select>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '16px' }}>
                                {engData.shape === 'MITERED' && <div style={{ flex: 1 }}><label style={labelStyle}>{engData.inputMode === 'ORDERING' ? 'L Ordering (in)' : 'Left Wall (in)'}</label><input type="number" value={engData.w1} onChange={e => setEngData({...engData, w1: parseFloat(e.target.value)||0})} style={fieldStyle} /></div>}
                                <div style={{ flex: 1 }}><label style={labelStyle}>{engData.shape === 'BOW' ? 'Chord W' : (engData.inputMode === 'ORDERING' ? 'C Ordering (in)' : 'Center Wall (in)')}</label><input type="number" value={engData.w2} onChange={e => setEngData({...engData, w2: parseFloat(e.target.value)||0})} style={fieldStyle} /></div>
                                {engData.shape === 'MITERED' && <div style={{ flex: 1 }}><label style={labelStyle}>{engData.inputMode === 'ORDERING' ? 'R Ordering (in)' : 'Right Wall (in)'}</label><input type="number" value={engData.w3} onChange={e => setEngData({...engData, w3: parseFloat(e.target.value)||0})} style={fieldStyle} /></div>}
                                {engData.shape === 'BOW' && <div style={{ flex: 1 }}><label style={labelStyle}>Bow Depth</label><input type="number" value={engData.bowDepth} onChange={e => setEngData({...engData, bowDepth: parseFloat(e.target.value)||0})} style={fieldStyle} /></div>}
                            </div>
                            {engData.shape === 'MITERED' && (
                                <div style={{ display: 'flex', gap: '16px' }}>
                                    <div style={{ flex: 1 }}><label style={labelStyle}>L Angle (deg)</label><input type="number" value={engData.a1} onChange={e => setEngData({...engData, a1: parseFloat(e.target.value)||0})} style={fieldStyle} /></div>
                                    <div style={{ flex: 1 }}><label style={labelStyle}>R Angle (deg)</label><input type="number" value={engData.a2} onChange={e => setEngData({...engData, a2: parseFloat(e.target.value)||0})} style={fieldStyle} /></div>
                                </div>
                            )}
                        </div>
                    </div>
                    
                    <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                        <div style={{ padding: '16px 20px', background: 'var(--paper-2)', color: 'var(--ink)', fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, borderBottom: '1px solid var(--line)' }}>3. Fabrication Settings</div>
                        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            {/* SIZE-MATRIX (Fabricut H1): Rod Diameter + Bracket Projection — the two top-level
                                flow questions. Every picker below re-labels + every dim re-syncs to the chosen
                                size; unanswered = the flow's base size (3/4" × 4-5/8"). */}
                            {(sizeSteps.length > 0 || projSelectSteps.length > 0) && (
                                <div style={{ display: 'flex', gap: '16px' }}>
                                    {[...sizeSteps, ...projSelectSteps].map(st => (
                                        <div key={st.id} style={{ flex: 1 }}>
                                            <label style={labelStyle}>{st.title} · from flow</label>
                                            <select value={dynamicConfigParams[st.id] || ''} onChange={e => pickStep(st.id, e.target.value)} style={fieldStyle}>
                                                <option value="">{st.type === 'PROJ_SELECT' ? '-- Select Projection --' : `-- Default (${st.sizeAxis === 'DIA' ? '3/4"' : '4-5/8"'}) --`}</option>
                                                {(st.styleOptions || []).map(o => <option key={o.optId} value={o.optId}>{o.partName}</option>)}
                                            </select>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {/* Bracket selection — independent Left / Center / Right (fill all three). bracketId = Left
                                for back-compat (dim-sync + push-to-CPQ); bracketIdRight = Right; bracketIdCenter = Center. */}
                            <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={labelStyle}>Left End Bracket{leftMount ? ` · ${leftMount}` : ''} (Auto-Syncs Dims)</label>
                                    {stepBrL ? (
                                        <select value={dynamicConfigParams[stepBrL.id] || ''} disabled={brLockedAt(stepBrL, 'LEFT')} onChange={e => pickStep(stepBrL.id, e.target.value)} style={{ ...fieldStyle, opacity: brLockedAt(stepBrL, 'LEFT') ? 0.45 : 1 }}>
                                            <option value="">{brLockedAt(stepBrL, 'LEFT') ? '— replaced by the return —' : '-- Select --'}</option>
                                            {brOptsFor(stepBrL).map(o => <option key={o.optId || o.partId} value={o.optId || o.partId}>{optLabel(o)}</option>)}
                                        </select>
                                    ) : (
                                        <select value={engData.bracketId || ''} onChange={e => setEngData(prev => ({ ...prev, bracketId: e.target.value }))} style={fieldStyle}>
                                            <option value="">{quoteFlowId ? '-- Select --' : '-- Select CPQ Flow First --'}</option>
                                            {leftBrackets.map(b => <option key={b.id} value={b.id}>{b.itemName} {b.legacyErpId && b.legacyErpId !== 'PENDING' ? `- ${b.legacyErpId}` : ''}</option>)}
                                        </select>
                                    )}
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={labelStyle}>Right End Bracket{rightMount ? ` · ${rightMount}` : ''}</label>
                                    {stepBrR ? (
                                        <select value={dynamicConfigParams[stepBrR.id] || ''} disabled={brLockedAt(stepBrR, 'RIGHT')} onChange={e => pickStep(stepBrR.id, e.target.value)} style={{ ...fieldStyle, opacity: brLockedAt(stepBrR, 'RIGHT') ? 0.45 : 1 }}>
                                            <option value="">{brLockedAt(stepBrR, 'RIGHT') ? '— replaced by the return —' : '-- Select --'}</option>
                                            {brOptsFor(stepBrR).map(o => <option key={o.optId || o.partId} value={o.optId || o.partId}>{optLabel(o)}</option>)}
                                        </select>
                                    ) : (
                                        <select value={engData.bracketIdRight || ''} onChange={e => setEngData(prev => ({ ...prev, bracketIdRight: e.target.value }))} style={fieldStyle}>
                                            <option value="">-- Select --</option>
                                            {rightBrackets.map(b => <option key={b.id} value={b.id}>{b.itemName} {b.legacyErpId && b.legacyErpId !== 'PENDING' ? `- ${b.legacyErpId}` : ''}</option>)}
                                        </select>
                                    )}
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={labelStyle}>Center Bracket · passing</label>
                                    {stepBrC ? (
                                        <select value={dynamicConfigParams[stepBrC.id] || ''} onChange={e => pickStep(stepBrC.id, e.target.value)} style={fieldStyle}>
                                            <option value="">-- Select Center Style --</option>
                                            {brOptsFor(stepBrC).map(o => <option key={o.optId || o.partId} value={o.optId || o.partId}>{optLabel(o)}</option>)}
                                        </select>
                                    ) : (
                                        <select value={engData.bracketIdCenter || ''} onChange={e => setEngData(prev => ({ ...prev, bracketIdCenter: e.target.value }))} style={fieldStyle}>
                                            <option value="">-- Select Center Style --</option>
                                            {centerBrackets.map(b => <option key={b.id} value={b.id}>{b.itemName} {b.legacyErpId && b.legacyErpId !== 'PENDING' ? `- ${b.legacyErpId}` : ''}</option>)}
                                        </select>
                                    )}
                                </div>
                            </div>
                            {/* Backplate step — the end-return arms attach at the MIDDLE of these, so each side's
                                half-dimension (width if vertical / length if horizontal) feeds the Total System O2O.
                                Selection + captured dims here; the O2O contribution is wired after the formula is confirmed. */}
                            <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                                {[['Left Backplate', stepBrL, 'LEFT', 'backplateIdLeft'], ['Right Backplate', stepBrR, 'RIGHT', 'backplateIdRight'], ['Center Backplate', stepBrC, 'CENTER', 'backplateIdCenter']].map(([lbl, st, pos, legacyKey]) => (
                                    <div key={lbl} style={{ flex: 1 }}>
                                        <label style={labelStyle}>{lbl}</label>
                                        {st ? (() => {
                                            const basic = basicSelAt(st);
                                            const pool = subPoolAt(st, pos);
                                            const none = !(st.subOptions || []).length;
                                            return (
                                                <select value={dynamicConfigParams[`${st.id}__sub`] || ''} disabled={basic || none} onChange={e => pickStep(`${st.id}__sub`, e.target.value)} style={{ ...fieldStyle, opacity: (basic || none) ? 0.45 : 1 }}>
                                                    <option value="">{basic ? '— basic bracket · no backplate —' : none ? '— no backplates on this step —' : '-- Select Backplate --'}</option>
                                                    {pool.map(o => { const p = partOfOpt(o); const d = p ? bpDims(p.id) : { w: 0, l: 0 }; return <option key={o.optId || o.partId} value={o.optId || o.partId}>{optLabel(o)}{(d.l || d.w) ? ` · ${d.l}L × ${d.w}W` : ''}</option>; })}
                                                </select>
                                            );
                                        })() : (
                                            <select value={engData[legacyKey] || ''} onChange={e => setEngData(prev => ({ ...prev, [legacyKey]: e.target.value }))} style={fieldStyle}>
                                                <option value="">-- Select Backplate --</option>
                                                {allBackplates.map(b => { const d = bpDims(b.id); return <option key={b.id} value={b.id}>{b.itemName}{(d.l || d.w) ? ` · ${d.l}L × ${d.w}W` : ''}</option>; })}
                                            </select>
                                        )}
                                    </div>
                                ))}
                            </div>
                            {sessionDrafts.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <select value={loadDraftPick} onChange={e => setLoadDraftPick(e.target.value)} style={{ ...fieldStyle, flex: 1 }}>
                                            <option value="">Load saved line… ({sessionDrafts.length})</option>
                                            {sessionDrafts.map(c => <option key={c.id} value={c.id}>{(c.sidemark || c.jobName || c.id)}{editingDraftId === c.id ? ' · editing' : ''}</option>)}
                                        </select>
                                        <button onClick={() => loadDraftPick && handleLoadDraft(loadDraftPick)} disabled={!loadDraftPick} title="Restore this saved line's dimensions, bracket/splice placements, and shop notes onto the board for editing" style={{ padding: '12px 18px', background: loadDraftPick ? 'var(--ink)' : 'var(--paper-2)', color: loadDraftPick ? '#fff' : 'var(--ink-soft)', border: 'none', cursor: loadDraftPick ? 'pointer' : 'not-allowed', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Load</button>
                                    </div>
                                    {editingDraftId && <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--brass)', letterSpacing: '.05em' }}>✎ Editing "{sidemark || editingDraftId}" — saving the line updates it in place.</div>}
                                </div>
                            )}
                            <button onClick={handleAutoPlaceBrackets} disabled={engData.shape !== 'STRAIGHT'} title={engData.shape !== 'STRAIGHT' ? 'Auto-place currently supports straight poles' : 'Bracket every 48" (36" on ¾" rod). Return / inside-mount ends count as supports; splices are kept and each gets a support bracket. Slide / edit / remove them in the Engineering view.'} style={{ padding: '12px 16px', background: engData.shape === 'STRAIGHT' ? 'var(--brass)' : 'var(--paper-2)', color: engData.shape === 'STRAIGHT' ? '#fff' : 'var(--ink-soft)', border: 'none', cursor: engData.shape === 'STRAIGHT' ? 'pointer' : 'not-allowed', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>⚙ Auto-Place Brackets · ends + centers (edit in Engineering view)</button>
                            <div style={{ display: 'flex', gap: '16px' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={labelStyle}>Projection (in)</label>
                                    <input type="number" step="0.125" value={engData.proj} onChange={e => setEngData({...engData, proj: parseFloat(e.target.value)||0})} style={fieldStyle} />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={labelStyle}>End Style · Left{stepEndL ? ' · from flow' : ''}</label>
                                    {stepEndL ? (
                                        <select value={dynamicConfigParams[stepEndL.id] || ''} disabled={armChosenAt('LEFT')} onChange={e => pickStep(stepEndL.id, e.target.value)} style={{ ...fieldStyle, opacity: armChosenAt('LEFT') ? 0.45 : 1 }}>
                                            <option value="">{armChosenAt('LEFT') ? '— end return arm selected —' : '-- Choose End Treatment --'}</option>
                                            {endOptsFor(stepEndL).map(o => <option key={o.optId || o.partId} value={o.optId || o.partId}>{optLabel(o)}</option>)}
                                        </select>
                                    ) : (
                                        <select value={engData.endStyle} onChange={e => setEngData({...engData, endStyle: e.target.value})} style={fieldStyle}>
                                            <option value="FLUSH">Flush Cut</option>
                                            <option value="FINIAL">Finials</option>
                                            <option value="RETURN_MITER">Miter Return</option>
                                            <option value="RETURN_BEND">Bent Return (FR)</option>
                                        </select>
                                    )}
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={labelStyle}>End Style · Right{stepEndR ? ' · from flow' : ''}</label>
                                    {stepEndR ? (
                                        <select value={dynamicConfigParams[stepEndR.id] || ''} disabled={armChosenAt('RIGHT')} onChange={e => pickStep(stepEndR.id, e.target.value)} style={{ ...fieldStyle, opacity: armChosenAt('RIGHT') ? 0.45 : 1 }}>
                                            <option value="">{armChosenAt('RIGHT') ? '— end return arm selected —' : '-- Choose End Treatment --'}</option>
                                            {endOptsFor(stepEndR).map(o => <option key={o.optId || o.partId} value={o.optId || o.partId}>{optLabel(o)}</option>)}
                                        </select>
                                    ) : (
                                        <select value={engData.endStyleRight || engData.endStyle} onChange={e => setEngData({...engData, endStyleRight: e.target.value})} style={fieldStyle}>
                                            <option value="FLUSH">Flush Cut</option>
                                            <option value="FINIAL">Finials</option>
                                            <option value="RETURN_MITER">Miter Return</option>
                                            <option value="RETURN_BEND">Bent Return (FR)</option>
                                        </select>
                                    )}
                                </div>
                            </div>
                            {/* These dims auto-fill from the selected bracket / master library — collapsed by
                                default. Open only to override for one-off custom work outside the library. */}
                            <div style={{ marginTop: '4px' }}>
                                <button type="button" onClick={() => setShowManualFab(v => !v)} style={{ width: '100%', textAlign: 'left', background: 'var(--paper)', border: '1px solid var(--line)', padding: '12px 20px', cursor: 'pointer', fontFamily: 'var(--sans)', color: 'var(--ink-soft)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                                    <span style={{ fontSize: '0.8rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{showManualFab ? '▾' : '▸'} Manual Dimension Overrides</span>
                                    <span style={{ fontSize: '0.72rem' }}>Auto-filled from the selected bracket · open only for one-off custom</span>
                                </button>
                                {showManualFab && (<div style={{ marginTop: '4px' }}>
                                    <div style={{ display: 'flex', gap: '16px', background: 'var(--paper)', padding: '20px', border: '1px solid var(--line)' }}>
                                        <div style={{ flex: 1 }}><label style={labelStyle}>Bracket W. (in)</label><input type="number" step="0.125" value={engData.bracketW} onChange={e => setEngData({...engData, bracketW: parseFloat(e.target.value)||0})} style={fieldStyle} /></div>
                                        <div style={{ flex: 1 }}><label style={labelStyle}>Bracket Thick. (in)</label><input type="number" step="0.125" value={engData.bracketThickness} onChange={e => setEngData({...engData, bracketThickness: parseFloat(e.target.value)||0})} style={fieldStyle} /></div>
                                        <div style={{ flex: 1 }}><label style={labelStyle}>Pole Dia. (in)</label><input type="number" step="0.125" value={engData.poleDiameter} onChange={e => setEngData({...engData, poleDiameter: parseFloat(e.target.value)||0})} style={fieldStyle} /></div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '16px', background: 'var(--paper)', padding: '20px', border: '1px solid var(--line)', borderTop: 'none' }}>
                                        <div style={{ flex: 1 }}><label style={labelStyle}>Bend Radius (in)</label><input type="number" step="0.125" value={engData.returnRadius} onChange={e => setEngData({...engData, returnRadius: parseFloat(e.target.value)||0})} disabled={endStyleL !== 'RETURN_BEND' && endStyleR !== 'RETURN_BEND'} style={{ ...fieldStyle, opacity: (endStyleL === 'RETURN_BEND' || endStyleR === 'RETURN_BEND') ? 1 : 0.4 }} /></div>
                                        <div style={{ flex: 1 }}><label style={labelStyle}>Grip Allowance (in)</label><input type="number" step="0.125" value={engData.gripAllowance} onChange={e => setEngData({...engData, gripAllowance: parseFloat(e.target.value)||0})} disabled={endStyleL !== 'RETURN_BEND' && endStyleR !== 'RETURN_BEND'} style={{ ...fieldStyle, opacity: (endStyleL === 'RETURN_BEND' || endStyleR === 'RETURN_BEND') ? 1 : 0.4 }} /></div>
                                        <div style={{ flex: 1 }}><label style={labelStyle}>IM Deduct. (in)</label><input type="number" step="0.125" value={engData.insideMountDeduct} onChange={e => setEngData({...engData, insideMountDeduct: parseFloat(e.target.value)||0})} style={fieldStyle} /></div>
                                    </div>
                                </div>)}
                            </div>
                        </div>
                    </div>
                  </>
                )}

                {viewMode === 'TAKEOFF' && (
                  <>
                    <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                        <div style={{ padding: '16px 20px', background: 'var(--paper-2)', color: 'var(--ink)', fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, borderBottom: '1px solid var(--line)' }}>1. Upload Floor Plan</div>
                        <div style={{ padding: '24px' }}>
                            <input type="file" accept="image/png, image/jpeg, image/webp" ref={takeoffFileInputRef} onChange={handleTakeoffUpload} style={{ display: 'none' }} />
                            <button onClick={() => takeoffFileInputRef.current.click()} style={{ width: '100%', padding: '16px', background: 'transparent', color: 'var(--ink)', border: '1px dashed var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>Select Floor Plan</button>
                            <div style={{ fontSize: '9px', color: 'var(--ink-soft)', marginTop: '8px', textAlign: 'center' }}>*Note: Please convert PDFs to PNG or JPG. Browsers cannot natively draw lines over PDF documents.</div>
                        </div>
                    </div>
                    <div style={{ background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', opacity: takeoffBg ? 1 : 0.5, borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                        <div style={{ padding: '16px 20px', background: takeoffTool === 'calibrate' ? 'var(--ink)' : 'var(--paper-2)', color: takeoffTool === 'calibrate' ? '#fff' : 'var(--ink)', fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, borderBottom: '1px solid var(--line)' }}>2. Calibrate Scale</div>
                        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div>
                                <label style={labelStyle}>Known Dimension (Inches)</label>
                                <input type="number" value={takeoffRealInches} onChange={(e) => setTakeoffRealInches(e.target.value)} disabled={!takeoffBg} style={{ ...fieldStyle, background: takeoffBg ? '#fff' : 'var(--paper)' }} />
                            </div>
                            <div style={{ display: 'flex', gap: '12px' }}>
                                <button onClick={() => { setTakeoffTool("calibrate"); setTakeoffCalPoints([]); setIsTakeoffCalibrated(false); }} disabled={!takeoffBg} style={{ flex: 1, padding: '12px', background: takeoffTool === "calibrate" ? 'var(--ink)' : 'var(--paper-2)', color: takeoffTool === "calibrate" ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', cursor: takeoffBg ? 'pointer' : 'not-allowed', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                                    {takeoffCalPoints.length === 1 ? "Click Point 2..." : (isTakeoffCalibrated ? "Re-Calibrate Line" : "Draw Scale Line")}
                                </button>
                            </div>
                        </div>
                    </div>
                    <div style={{ background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', opacity: isTakeoffCalibrated ? 1 : 0.5, borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', flex: 1 }}>
                        <div style={{ padding: '16px 20px', background: takeoffTool === 'measure' ? 'var(--ink)' : 'var(--paper-2)', color: takeoffTool === 'measure' ? '#fff' : 'var(--ink)', fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>3. Take-Off Measurements</span>
                            <button onClick={() => setTakeoffTool('measure')} disabled={!isTakeoffCalibrated} style={{ background: takeoffTool === 'measure' ? '#fff' : 'var(--ink)', color: takeoffTool === 'measure' ? 'var(--ink)' : '#fff', border: 'none', padding: '6px 12px', fontSize: '10px', fontFamily: 'var(--mono)', textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.2s' }}>Measure</button>
                        </div>
                        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto' }}>
                            {takeoffMeasurements.length === 0 && <span style={{ color: 'var(--ink-soft)', fontSize: '0.9rem', fontStyle: 'italic' }}>No measurements captured. Click 'Measure' and draw across openings.</span>}
                            {takeoffMeasurements.map(m => (
                                <div key={m.id} style={{ border: '1px solid var(--line)', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', background: 'var(--paper)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <input type="text" value={m.label} onChange={e => { const v = e.target.value; setTakeoffMeasurements(arr => arr.map(x => x.id === m.id ? {...x, label: v} : x)); }} style={{ border: 'none', borderBottom: '1px solid var(--line)', background: 'transparent', outline: 'none', fontFamily: 'var(--sans)', fontSize: '0.95rem', width: '140px', color: 'var(--ink)' }} />
                                        <strong style={{ fontFamily: 'var(--mono)', color: 'var(--brass)', fontSize: '1.1rem' }}>{m.inches.toFixed(1)}"</strong>
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <button onClick={() => pushMeasurementToEng(m)} style={{ flex: 1, padding: '10px', background: 'var(--ink)', color: '#fff', border: 'none', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', cursor: 'pointer' }}>Send to Canvas</button>
                                        <button onClick={() => setTakeoffMeasurements(arr => arr.filter(x => x.id !== m.id))} style={{ padding: '10px 14px', background: 'transparent', color: '#d9534f', border: '1px solid #d9534f', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px' }}>X</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                  </>
                )}

                {viewMode === 'VISUAL' && (
                  <>
                    <div style={{ background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                        <div style={{ padding: '16px 20px', background: 'var(--paper-2)', color: 'var(--ink)', fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, borderBottom: '1px solid var(--line)' }}>File Upload</div>
                        <div style={{ padding: '24px' }}>
                            <input type="file" accept="image/png, image/jpeg" ref={fileInputRef} onChange={handleFileUpload} style={{ display: 'none' }} />
                            <button onClick={() => fileInputRef.current.click()} style={{ width: '100%', padding: '16px', background: 'transparent', color: 'var(--ink)', border: '1px dashed var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>Select Front Elevation</button>
                        </div>
                    </div>
                    <div style={{ background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', opacity: activeBg ? 1 : 0.5, borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                        <div style={{ padding: '16px 20px', background: visualTool === 'calibrate' ? 'var(--ink)' : 'var(--paper-2)', color: visualTool === 'calibrate' ? '#fff' : 'var(--ink)', fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, borderBottom: '1px solid var(--line)' }}>Calibrate Scale</div>
                        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div>
                                <label style={labelStyle}>Known Dimension (Inches)</label>
                                <input type="number" value={realInches} onChange={(e) => { const val = e.target.value; setRealInches(val); if(calPoints.length===2 && parseFloat(val) > 0) { setPixelsPerInch(Math.sqrt(Math.pow(calPoints[1].x - calPoints[0].x, 2) + Math.pow(calPoints[1].y - calPoints[0].y, 2)) / parseFloat(val)); setEngData(prev => ({ ...prev, w2: val })); } }} disabled={!activeBg} style={{ ...fieldStyle, background: activeBg ? '#fff' : 'var(--paper)' }} />
                            </div>
                            <div style={{ display: 'flex', gap: '12px' }}>
                                <button onClick={() => setVisualTool("calibrate")} disabled={!activeBg} style={{ flex: 1, padding: '12px', background: visualTool === "calibrate" ? 'var(--ink)' : 'var(--paper-2)', color: visualTool === "calibrate" ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', cursor: activeBg ? 'pointer' : 'not-allowed', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                                    {calPoints.length === 1 ? "Click Point 2..." : (isCalibrated ? "Re-draw Line" : "Draw Line")}
                                </button>
                                {calPoints.length > 0 && <button onClick={() => { setCalPoints([]); setIsCalibrated(false); setVisualTool("calibrate"); }} style={{ padding: '12px 16px', background: 'transparent', color: '#d9534f', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase' }} title="Clear Calibration">Clear</button>}
                            </div>
                        </div>
                    </div>
                    <div style={{ background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', opacity: isCalibrated ? 1 : 0.5, borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                        <div style={{ padding: '16px 20px', background: 'var(--paper-2)', color: 'var(--ink)', fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, borderBottom: '1px solid var(--line)' }}>Drop CPQ Config</div>
                        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <select value={selectedConfigId} onChange={(e) => setSelectedConfigId(e.target.value)} disabled={!isCalibrated || visionConfigs.length === 0} style={{ ...fieldStyle, background: isCalibrated ? '#fff' : 'var(--paper)' }}>
                                {visionConfigs.length === 0 && <option value="">No configs found.</option>}
                                {visionConfigs.map(cfg => <option key={cfg.id} value={cfg.id}>{cfg.jobName || cfg.sidemark || cfg.id}</option>)}
                            </select>
                            <button onClick={handleDropConfig} disabled={!isCalibrated || visionConfigs.length === 0} style={{ width: '100%', padding: '16px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: isCalibrated && visionConfigs.length > 0 ? 'pointer' : 'not-allowed', opacity: isCalibrated && visionConfigs.length > 0 ? 1 : 0.5, fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Place In Room</button>
                        </div>
                    </div>
                    {activePlacedId && (
                        <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', borderBottom: '1px solid var(--line)', paddingBottom: '8px' }}>Nudge Position Cockpit</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', width: '180px', margin: '0 auto' }}>
                                <div></div><button onClick={() => moveItem('up')} style={{ padding: '12px', cursor: 'pointer', background: 'var(--paper-2)', border: '1px solid var(--line)', color: 'var(--ink)' }}>▲</button><div></div>
                                <button onClick={() => moveItem('left')} style={{ padding: '12px', cursor: 'pointer', background: 'var(--paper-2)', border: '1px solid var(--line)', color: 'var(--ink)' }}>◀</button>
                                <button onClick={() => { setVisScale(1.0); setVisPan({x:0, y:0}); }} style={{ padding: '12px', cursor: 'pointer', background: 'var(--paper)', border: '1px solid var(--line)', color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase' }}>CTR</button>
                                <button onClick={() => moveItem('right')} style={{ padding: '12px', cursor: 'pointer', background: 'var(--paper-2)', border: '1px solid var(--line)', color: 'var(--ink)' }}>▶</button>
                                <div></div><button onClick={() => moveItem('down')} style={{ padding: '12px', cursor: 'pointer', background: 'var(--paper-2)', border: '1px solid var(--line)', color: 'var(--ink)' }}>▼</button><div></div>
                            </div>
                            {activePlacedId === 'ENG_OVERLAY' && (
                                <div style={{ marginTop: '16px', borderTop: '1px solid var(--line)', paddingTop: '16px' }}>
                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink)', marginBottom: '12px' }}>Perspective Tweaks (Visual Only)</div>
                                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}><span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', width: '40px' }}>L-POLE:</span><input type="range" min="-150" max="150" value={perspectiveStretch.L} onChange={(e) => setPerspectiveStretch(prev => ({...prev, L: parseInt(e.target.value)}))} style={{ flex: 1 }} /></div>
                                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '12px' }}><span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', width: '40px' }}>R-POLE:</span><input type="range" min="-150" max="150" value={perspectiveStretch.R} onChange={(e) => setPerspectiveStretch(prev => ({...prev, R: parseInt(e.target.value)}))} style={{ flex: 1 }} /></div>
                                </div>
                            )}
                            <button onClick={() => removeItem(activePlacedId)} style={{ width: '100%', padding: '12px', background: 'transparent', color: '#d9534f', border: '1px solid #d9534f', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', marginTop: '12px', transition: 'all 0.2s' }}>Remove Selected</button>
                        </div>
                    )}
                  </>
                )}
            </div>
          )}

          <div style={{ flex: showQuotePanel ? 2 : 1, display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid var(--line)', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', minHeight: '600px', borderRadius: '2px', overflow: 'hidden' }}>
              
              {viewMode === 'VISUAL' ? (
                  <div style={{ padding: '16px 20px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <button onClick={() => setVisualTool("pan")} style={{ padding: '8px 16px', background: visualTool === "pan" ? 'var(--ink)' : '#fff', color: visualTool === "pan" ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', cursor: 'pointer', letterSpacing: '.1em', transition: 'all 0.2s' }}>Pan Viewport</button>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => setVisScale(s => Math.min(s + 0.25, 4))} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer' }}>➕</button>
                        <button onClick={() => setVisScale(s => Math.max(s - 0.25, 0.5))} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer' }}>➖</button>
                        <button onClick={() => { setVisScale(1); setVisPan({x:0, y:0}); }} style={{ padding: '8px 16px', background: 'var(--paper)', border: '1px solid var(--line)', color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', cursor: 'pointer', letterSpacing: '.1em' }}>Reset</button>
                    </div>
                  </div>
              ) : viewMode === 'TAKEOFF' ? (
                  <div style={{ padding: '16px 20px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <button onClick={() => setTakeoffTool("pan")} style={{ padding: '8px 16px', background: takeoffTool === "pan" ? 'var(--ink)' : '#fff', color: takeoffTool === "pan" ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', cursor: 'pointer', letterSpacing: '.1em', transition: 'all 0.2s' }}>Pan Viewport</button>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => setTakeoffScale(s => Math.min(s + 0.25, 4))} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer' }}>➕</button>
                        <button onClick={() => setTakeoffScale(s => Math.max(s - 0.25, 0.5))} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer' }}>➖</button>
                        <button onClick={() => { setTakeoffScale(1); setTakeoffPan({x:0, y:0}); }} style={{ padding: '8px 16px', background: 'var(--paper)', border: '1px solid var(--line)', color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', cursor: 'pointer', letterSpacing: '.1em' }}>Reset</button>
                    </div>
                  </div>
              ) : (
                  <div style={{ padding: '16px 20px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                        <button onClick={() => setShowQuotePanel(!showQuotePanel)} style={{ padding: '8px 16px', background: showQuotePanel ? 'var(--ink)' : 'var(--brass)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'background 0.2s' }}>
                            {showQuotePanel ? "Back to Drawing" : "Configure Item Parameters"}
                        </button>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => setEngTool("pan")} style={{ padding: '8px 16px', background: engTool === "pan" ? 'var(--ink)' : '#fff', color: engTool === "pan" ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer', transition: 'all 0.2s' }}>Pan</button>
                        <button onClick={() => setEngTool("bracket")} style={{ padding: '8px 16px', background: engTool === "bracket" ? 'var(--ink)' : '#fff', color: engTool === "bracket" ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer', transition: 'all 0.2s' }}>Bracket</button>
                        <button onClick={() => setEngTool("splice")} style={{ padding: '8px 16px', background: engTool === "splice" ? 'var(--ink)' : '#fff', color: engTool === "splice" ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer', transition: 'all 0.2s' }}>Splice</button>
                        <button onClick={() => setEngTool("note")} style={{ padding: '8px 16px', background: engTool === "note" ? 'var(--ink)' : '#fff', color: engTool === "note" ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer', transition: 'all 0.2s' }}>Note</button>
                        <button onClick={() => {setAttachments([]); setShopNotes([]);}} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--line)', color: '#d9534f', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>Clear</button>
                    </div>
                  </div>
              )}

              <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: (viewMode === 'VISUAL' || viewMode === 'TAKEOFF') ? 'var(--dark)' : 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {viewMode === 'VISUAL' && !activeBg && <div style={{ color: 'var(--ink-soft)', textAlign: 'center' }}><div style={{ fontSize: '3rem', marginBottom: '16px', opacity: 0.5 }}>🖼️</div><h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500 }}>No Elevation Loaded</h3></div>}
                  {viewMode === 'TAKEOFF' && !takeoffBg && <div style={{ color: 'var(--ink-soft)', textAlign: 'center' }}><div style={{ fontSize: '3rem', marginBottom: '16px', opacity: 0.5 }}>📏</div><h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500 }}>Upload Floor Plan for Take-Offs</h3></div>}

                  {(viewMode === 'ENGINEERING' || (viewMode === 'VISUAL' && activeBg) || (viewMode === 'TAKEOFF' && takeoffBg)) && (
                      <svg ref={svgRef} viewBox="0 0 1000 600" style={{ width: '100%', height: '100%', display: 'block', cursor: currentCursor, touchAction: 'none' }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
                          <g ref={innerGroupRef} transform={`translate(${viewMode === 'VISUAL' ? visPan.x : viewMode === 'TAKEOFF' ? takeoffPan.x : engPan.x}, ${viewMode === 'VISUAL' ? visPan.y : viewMode === 'TAKEOFF' ? takeoffPan.y : engPan.y}) translate(500, 300) scale(${viewMode === 'VISUAL' ? visScale : viewMode === 'TAKEOFF' ? takeoffScale : engScale}) translate(-500, -300)`}>
                              
                              {viewMode === 'TAKEOFF' && takeoffBg && (
                                  <g>
                                      <image href={takeoffBg.url} x="0" y="0" width="1000" height="600" preserveAspectRatio="xMidYMid slice" opacity="0.85" />
                                      {takeoffCalPoints.map((pt, i) => <g key={`tcal-${i}`} transform={`translate(${pt.x}, ${pt.y})`}><circle cx="0" cy="0" r="1.5" fill="var(--brass)" /><line x1="-6" y1="0" x2="-2" y2="0" stroke="var(--brass)" strokeWidth="1.5" /><line x1="2" y1="0" x2="6" y2="0" stroke="var(--brass)" strokeWidth="1.5" /><line x1="0" y1="-6" x2="0" y2="-2" stroke="var(--brass)" strokeWidth="1.5" /><line x1="0" y1="2" x2="0" y2="6" stroke="var(--brass)" strokeWidth="1.5" /></g>)}
                                      {takeoffCalPoints.length === 2 && (() => {
                                          const midX = (takeoffCalPoints[0].x + takeoffCalPoints[1].x) / 2; const midY = (takeoffCalPoints[0].y + takeoffCalPoints[1].y) / 2;
                                          const dx = takeoffCalPoints[1].x - takeoffCalPoints[0].x; const dy = takeoffCalPoints[1].y - takeoffCalPoints[0].y;
                                          const len = Math.sqrt(dx * dx + dy * dy); const nx = -dy / len; const ny = dx / len;
                                          const offX = midX + nx * 40; const offY = midY + ny * 40;
                                          return (<g><line x1={takeoffCalPoints[0].x} y1={takeoffCalPoints[0].y} x2={takeoffCalPoints[1].x} y2={takeoffCalPoints[1].y} stroke="var(--brass)" strokeWidth="2" strokeDasharray="3,3" /><line x1={midX} y1={midY} x2={offX} y2={offY} stroke="var(--brass)" strokeWidth="1.5" /><rect x={offX - 45} y={offY - 12} width="90" height="24" fill="#fff" stroke="var(--line)" strokeWidth="1" /><text x={offX} y={offY + 4} fill="var(--ink)" fontSize="11" fontFamily="var(--mono)" letterSpacing=".05em" textAnchor="middle">{takeoffRealInches}" SPEC</text></g>);
                                      })()}
                                      
                                      {takeoffMeasurements.map(m => (
                                          <g key={m.id}>
                                              <line x1={m.p1.x} y1={m.p1.y} x2={m.p2.x} y2={m.p2.y} stroke="var(--brass)" strokeWidth="3" />
                                              <circle cx={m.p1.x} cy={m.p1.y} r="4" fill="var(--brass)" />
                                              <circle cx={m.p2.x} cy={m.p2.y} r="4" fill="var(--brass)" />
                                              <rect x={(m.p1.x+m.p2.x)/2 - 30} y={(m.p1.y+m.p2.y)/2 - 12} width="60" height="24" fill="#fff" stroke="var(--brass)" strokeWidth="1" />
                                              <text x={(m.p1.x+m.p2.x)/2} y={(m.p1.y+m.p2.y)/2 + 4} fill="var(--ink)" fontSize="10" fontFamily="var(--mono)" textAnchor="middle">{m.inches.toFixed(1)}"</text>
                                          </g>
                                      ))}

                                      {takeoffMeasurePoints.length === 1 && takeoffMousePos && (
                                          <g>
                                            <line x1={takeoffMeasurePoints[0].x} y1={takeoffMeasurePoints[0].y} x2={takeoffMousePos.x} y2={takeoffMousePos.y} stroke="var(--ink)" strokeWidth="2" strokeDasharray="4,4" />
                                            <circle cx={takeoffMeasurePoints[0].x} cy={takeoffMeasurePoints[0].y} r="4" fill="var(--brass)" />
                                          </g>
                                      )}
                                  </g>
                              )}

                              {viewMode === 'VISUAL' && activeBg && (
                                  <g>
                                      <image href={activeBg.url} x="0" y="0" width="1000" height="600" preserveAspectRatio="xMidYMid slice" opacity="0.85" />
                                      {calPoints.map((pt, i) => <g key={`cal-${i}`} transform={`translate(${pt.x}, ${pt.y})`}><circle cx="0" cy="0" r="1.5" fill="var(--ink)" /><line x1="-6" y1="0" x2="-2" y2="0" stroke="var(--ink)" strokeWidth="1.5" /><line x1="2" y1="0" x2="6" y2="0" stroke="var(--ink)" strokeWidth="1.5" /><line x1="0" y1="-6" x2="0" y2="-2" stroke="var(--ink)" strokeWidth="1.5" /><line x1="0" y1="2" x2="0" y2="6" stroke="var(--ink)" strokeWidth="1.5" /></g>)}
                                      {calPoints.length === 2 && (() => {
                                          const midX = (calPoints[0].x + calPoints[1].x) / 2; const midY = (calPoints[0].y + calPoints[1].y) / 2;
                                          const dx = calPoints[1].x - calPoints[0].x; const dy = calPoints[1].y - calPoints[0].y;
                                          const len = Math.sqrt(dx * dx + dy * dy); const nx = -dy / len; const ny = dx / len;
                                          const offX = midX + nx * 40; const offY = midY + ny * 40;
                                          return (<g><line x1={calPoints[0].x} y1={calPoints[0].y} x2={calPoints[1].x} y2={calPoints[1].y} stroke="var(--ink)" strokeWidth="2" strokeDasharray="3,3" /><line x1={midX} y1={midY} x2={offX} y2={offY} stroke="var(--ink)" strokeWidth="1.5" /><rect x={offX - 45} y={offY - 12} width="90" height="24" fill="#fff" stroke="var(--line)" strokeWidth="1" /><text x={offX} y={offY + 4} fill="var(--ink)" fontSize="11" fontFamily="var(--mono)" letterSpacing=".05em" textAnchor="middle">{realInches}" SPEC</text></g>);
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
                                              <rect x="0" y="0" width={item.width} height={item.height} fill={item.color} fillOpacity="0.6" stroke={isSelected ? '#fff' : 'transparent'} strokeWidth={isSelected ? '2' : '0'} />
                                              <circle cx={item.width} cy={0} r="3" fill={item.color} stroke="#fff" strokeWidth="1.5" />
                                              <path d={`M ${item.width} 0 L ${item.width + 10} -10 L ${item.width + 20} -10`} fill="none" stroke={item.color} strokeWidth="2" />
                                              <foreignObject x={item.width + 20} y="-22" width="120" height="40" style={{ overflow: 'visible' }}>
                                                  <div style={{ background: '#fff', border: `1px solid var(--line)`, padding: '6px 10px', boxShadow: `0 4px 12px rgba(0,0,0,0.1)` }}><div style={{ fontWeight: 500, fontSize: '10px', fontFamily: 'var(--sans)', color: 'var(--ink)', lineHeight: '1.2' }}>{item.label}</div><div style={{ fontSize: '9px', fontFamily: 'var(--mono)', textTransform: 'uppercase', color: 'var(--ink-soft)', marginTop: '4px' }}>W: {item.realWidth}"</div></div>
                                              </foreignObject>
                                              </g>
                                          );
                                      })}
                                  </g>
                              )}

                              {viewMode === 'ENGINEERING' && (
                                  <g>
                                      {Array.from({ length: 15 }).map((_, i) => <line key={`h-${i}`} x1="0" y1={i * 40} x2="1000" y2={i * 40} stroke="var(--line)" strokeWidth="1" />)}
                                      {Array.from({ length: 25 }).map((_, i) => <line key={`v-${i}`} x1={i * 40} y1="0" x2={i * 40} y2="600" stroke="var(--line)" strokeWidth="1" />)}
                                  </g>
                              )}

                              {viewMode === 'ENGINEERING' && isCustomProj && (
                                  <g transform="translate(500, 50)"><rect x="-225" y="-24" width="450" height="40" fill="#fff" stroke="#d9534f" strokeWidth="2" rx="2" /><text x="0" y="2" fill="#d9534f" fontSize="13" fontFamily="var(--mono)" letterSpacing=".1em" fontWeight="bold" textAnchor="middle">⚠️ CUSTOM PROJECTION REQUESTED: {engData.proj}" ⚠️</text></g>
                              )}

                              {viewMode === 'ENGINEERING' && (
                                  <g>
                                      {engData.shape === 'STRAIGHT' && <g><line x1={P2.x} y1={P2.y} x2={P3.x} y2={P3.y} stroke="var(--ink-soft)" strokeWidth="2" opacity="0.3" /><text x={500} y={P2.y - 30} fill="var(--ink-soft)" fontSize="11" fontFamily="var(--mono)" letterSpacing=".05em" textAnchor="middle">WALL B: {wall2.toFixed(1)}"</text><text x={500} y={HS.y + 40} fill="var(--brass)" fontSize="11" fontFamily="var(--mono)" letterSpacing=".05em" textAnchor="middle">TUBE B CUT: {rawCenter.toFixed(2)}"</text></g>}
                                      {engData.shape === 'MITERED' && <g><polyline points={`${P1.x},${P1.y} ${P2.x},${P2.y} ${P3.x},${P3.y} ${P4.x},${P4.y}`} fill="none" stroke="var(--ink-soft)" strokeWidth="2" opacity="0.3" /><text x={500} y={P2.y - 30} fill="var(--ink-soft)" fontSize="11" fontFamily="var(--mono)" letterSpacing=".05em" textAnchor="middle">WALL B: {wall2.toFixed(1)}"</text><text x={500} y={HC1.y + 40} fill="var(--brass)" fontSize="11" fontFamily="var(--mono)" letterSpacing=".05em" textAnchor="middle">TUBE B CUT: {rawCenter.toFixed(2)}"</text><text x={(P1.x+P2.x)/2 - 10} y={(P1.y+P2.y)/2 - 30} fill="var(--ink-soft)" fontSize="11" fontFamily="var(--mono)" letterSpacing=".05em" textAnchor="middle">WALL A: {wall1.toFixed(1)}"</text><text x={(HS.x+HC1.x)/2 + 10} y={(HS.y+HC1.y)/2 + 40} fill="var(--brass)" fontSize="11" fontFamily="var(--mono)" letterSpacing=".05em" textAnchor="middle">TUBE A CUT: {rawLeft.toFixed(2)}"</text><text x={(P3.x+P4.x)/2 + 10} y={(P3.y+P4.y)/2 - 30} fill="var(--ink-soft)" fontSize="11" fontFamily="var(--mono)" letterSpacing=".05em" textAnchor="middle">WALL C: {wall3.toFixed(1)}"</text><text x={(HC2.x+HE.x)/2 - 10} y={(HC2.y+HE.y)/2 + 40} fill="var(--brass)" fontSize="11" fontFamily="var(--mono)" letterSpacing=".05em" textAnchor="middle">TUBE C CUT: {rawRight.toFixed(2)}"</text></g>}
                                      {engData.shape === 'BOW' && <g><path d={bowWallPath} fill="none" stroke="var(--ink-soft)" strokeWidth="2" opacity="0.3" /><text x={500} y={P2.y - 30} fill="var(--ink-soft)" fontSize="11" fontFamily="var(--mono)" letterSpacing=".05em" textAnchor="middle">CHORD B: {wall2.toFixed(1)}"</text><text x={500} y={HS.y + 40} fill="var(--brass)" fontSize="11" fontFamily="var(--mono)" letterSpacing=".05em" textAnchor="middle">TUBE B CUT: {rawCenter.toFixed(2)}"</text></g>}

                                      {engData.shape === 'STRAIGHT' && renderDimLine(HS, HE, {x:0,y:1}, 65, `C-to-C: ${(pole2).toFixed(1)}"`)}
                                      {engData.shape === 'MITERED' && <g>{renderDimLine(HS, HC1, {x:-nL.x, y:-nL.y}, 65, `C-to-C: ${(pole1).toFixed(1)}"`)}{renderDimLine(HC1, HC2, {x:0, y:1}, 65, `C-to-C: ${(pole2).toFixed(1)}"`)}{renderDimLine(HC2, HE, {x:-nR.x, y:-nR.y}, 65, `C-to-C: ${(pole3).toFixed(1)}"`)}</g>}

                                      {engData.shape === 'STRAIGHT' && <line x1={drawHS.x} y1={drawHS.y} x2={drawHE.x} y2={drawHE.y} stroke="var(--brass)" strokeWidth="2" />}
                                      {engData.shape === 'MITERED' && <polyline points={`${drawHS.x},${drawHS.y} ${HC1.x},${HC1.y} ${HC2.x},${HC2.y} ${drawHE.x},${drawHE.y}`} fill="none" stroke="var(--brass)" strokeWidth="2" />}
                                      {engData.shape === 'BOW' && bowHWPath && <path d={bowHWPath} fill="none" stroke="var(--brass)" strokeWidth="2" />}

                                      {engData.shape === 'MITERED' && sawAngle1 > 0 && <g><line x1={HC1.x} y1={HC1.y + 15} x2={HC1.x + 60} y2={HC1.y + 100} stroke="var(--ink-soft)" strokeWidth="1" strokeDasharray="2,2" /><rect x={HC1.x + 20} y={HC1.y + 90} width="80" height="20" fill="#fff" stroke="var(--line)" strokeWidth="1" /><text x={HC1.x + 60} y={HC1.y + 104} fill="var(--ink)" fontSize="10" fontFamily="var(--mono)" letterSpacing=".05em" textAnchor="middle">{sawAngle1.toFixed(1)}° MITER</text></g>}
                                      {engData.shape === 'MITERED' && sawAngle2 > 0 && <g><line x1={HC2.x} y1={HC2.y + 15} x2={HC2.x - 60} y2={HC2.y + 100} stroke="var(--ink-soft)" strokeWidth="1" strokeDasharray="2,2" /><rect x={HC2.x - 100} y={HC2.y + 90} width="80" height="20" fill="#fff" stroke="var(--line)" strokeWidth="1" /><text x={HC2.x - 60} y={HC2.y + 104} fill="var(--ink)" fontSize="10" fontFamily="var(--mono)" letterSpacing=".05em" textAnchor="middle">{sawAngle2.toFixed(1)}° MITER</text></g>}

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

                                          const distFromA = att.ref === 'START' ? att.distInches : (seg.len - att.distInches);
                                          const t = distFromA / seg.len; let x = 0; let y = 0;
                                          let nX = seg.norm ? seg.norm.x : 0;
                                          let nY = seg.norm ? seg.norm.y : -1;
                                          if (seg.isBow) {
                                              const angle = bowStartAngle + t * (bowEndAngle - bowStartAngle); const rH_px = bowHW_R * S;
                                              x = bowCX + rH_px * Math.cos(angle); y = bowCY + rH_px * Math.sin(angle);
                                              // Mount radially: perpendicular to the curve and straight back to the wall arc (like the miter's
                                              // wall normal) instead of a fixed straight-up stem, so the loop sits square over the curved pole.
                                              nX = Math.cos(angle); nY = Math.sin(angle);
                                          } else { x = seg.pA.x + t * (seg.pB.x - seg.pA.x); y = seg.pA.y + t * (seg.pB.y - seg.pA.y); }

                                          return (
                                              <g key={att.id}>
                                                  {att.type === 'bracket' ? (
                                                      <g>
                                                          <circle cx={x} cy={y} r="4" fill="var(--ink)" />
                                                          <line x1={x} y1={y} x2={x + nX * (safeProj * S)} y2={y + nY * (safeProj * S)} stroke="var(--ink-soft)" strokeWidth="2" />
                                                      </g>
                                                  ) : (
                                                      <g>
                                                          <line x1={x - nX*8 - nY*4} y1={y - nY*8 + nX*4} x2={x + nX*8 - nY*4} y2={y + nY*8 + nX*4} stroke="var(--ink)" strokeWidth="2" />
                                                          <line x1={x - nX*8 + nY*4} y1={y - nY*8 - nX*4} x2={x + nX*8 + nY*4} y2={y + nY*8 - nX*4} stroke="var(--ink)" strokeWidth="2" />
                                                      </g>
                                                  )}
                                                  <line x1={x} y1={y-5} x2={x} y2={y-80} stroke={att.type==='bracket'?'var(--line)':'var(--line)'} strokeWidth="1" strokeDasharray="2,2" />
                                                  <foreignObject x={x - 60} y={y - 145} width="120" height="60" style={{ overflow: 'visible' }}>
                                                      <div style={{ background: '#fff', border: `1px solid var(--line)`, display: 'flex', flexDirection: 'column', padding: '6px', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}><input type="number" value={att.distInches} step="0.125" onChange={(e) => handleUpdateAttachmentDist(att.id, e.target.value)} onPointerDown={e => e.stopPropagation()} style={{ width: '100%', fontSize: '13px', fontFamily: 'var(--sans)', fontWeight: 500, textAlign: 'center', border: '1px solid var(--line)', background: 'var(--paper-2)', outline: 'none', boxSizing: 'border-box' }} /><span style={{ fontSize: '9px', fontFamily: 'var(--mono)', color: 'var(--ink-soft)', textTransform: 'uppercase', textAlign: 'center', margin: '4px 0' }}>from {att.ref === 'START' ? seg.nA : seg.nB}</span><input type="text" placeholder="Notes..." value={att.note||''} onChange={(e) => handleUpdateAttachmentNote(att.id, e.target.value)} onPointerDown={e => e.stopPropagation()} style={{ width: '100%', fontSize: '11px', fontFamily: 'var(--sans)', border: '1px solid var(--line)', outline: 'none', textAlign: 'center', boxSizing: 'border-box' }} /></div>
                                                  </foreignObject>
                                              </g>
                                          );
                                      })}
                                      {shopNotes.map(n => (
                                          <g key={n.id}><circle cx={n.x} cy={n.y} r="4" fill="var(--ink)" /><line x1={n.x} y1={n.y} x2={n.x + 20} y2={n.y - 70} stroke="var(--ink)" strokeWidth="1" /><foreignObject x={n.x + 20} y={n.y - 120} width="180" height="60" style={{ overflow: 'visible' }}><textarea value={n.text} placeholder="Type shop floor note here..." onChange={(e) => handleUpdateShopNote(n.id, e.target.value)} onPointerDown={e => e.stopPropagation()} style={{ width: '100%', height: '100%', fontSize: '12px', fontFamily: 'var(--sans)', border: '1px solid var(--line)', background: '#fff', outline: 'none', resize: 'none', padding: '10px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', boxSizing: 'border-box' }} /></foreignObject></g>
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
                  <div style={{ background: '#fff', borderTop: '1px solid var(--line)', display: 'flex', minHeight: '140px' }}>
                      <div style={{ flex: 1, padding: '24px', borderRight: '1px solid var(--line)' }}>
                          <h4 style={{ margin: '0 0 16px 0', fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)' }}>Client Details & Ordering</h4>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.9rem', fontFamily: 'var(--sans)' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--ink)' }}><span style={{ color: 'var(--ink-soft)' }}>Pole O2O (Edge-to-Edge):</span><strong style={{ fontWeight: 500 }}>{poleO2O.toFixed(2)}"</strong></div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--ink)' }}><span style={{ color: 'var(--ink-soft)' }}>Total System O2O (+ Brackets):</span><strong style={{ fontWeight: 500 }}>{totalSystemO2O.toFixed(2)}"</strong></div>
                              <div style={{ fontSize: '0.72rem', color: 'var(--ink-soft)', textAlign: 'right' }}>= {poleO2O.toFixed(2)} pole + {endAddL.toFixed(2)} L + {endAddR.toFixed(2)} R</div>
                              {(engData.backplateIdLeft || engData.backplateIdRight) && (
                                  <div style={{ fontSize: '0.72rem', color: 'var(--ink-soft)', textAlign: 'right' }}>Backplate · L {bpDims(engData.backplateIdLeft).l}×{bpDims(engData.backplateIdLeft).w} · R {bpDims(engData.backplateIdRight).l}×{bpDims(engData.backplateIdRight).w}</div>
                              )}
                              {engData.shape === 'MITERED' && <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px' }}><span style={{ color: 'var(--ink-soft)' }}>Left Wall C2C:</span><strong style={{ fontWeight: 500 }}>{pole1.toFixed(2)}"</strong></div>}
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--ink-soft)' }}>{engData.shape === 'STRAIGHT' ? 'Main Wall C2C:' : 'Center Wall C2C:'}</span><strong style={{ fontWeight: 500 }}>{pole2.toFixed(2)}"</strong></div>
                              {engData.shape === 'MITERED' && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--ink-soft)' }}>Right Wall C2C:</span><strong style={{ fontWeight: 500 }}>{pole3.toFixed(2)}"</strong></div>}
                              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--ink)', marginTop: '8px' }}><span style={{ color: 'var(--ink-soft)' }}>End Style{endStyleL !== endStyleR ? ' (L / R)' : ''}:</span><strong style={{ fontWeight: 500 }}>{endStyleL.replace('_', ' ')}{endStyleL !== endStyleR ? ' / ' + endStyleR.replace('_', ' ') : ''}</strong></div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--ink)' }}><span style={{ color: 'var(--ink-soft)' }}>Projection:</span><strong style={{ fontWeight: 500 }}>{isCustomProj ? `CUSTOM (${engData.proj}")` : `${engData.proj}"`}</strong></div>
                          </div>
                      </div>
                      <div style={{ flex: 1, padding: '24px', background: 'var(--paper-2)' }}>
                          <h4 style={{ margin: '0 0 16px 0', fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)' }}>Shop Floor BOM & Raw Cuts</h4>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.9rem', fontFamily: 'var(--sans)' }}>
                              {engData.shape === 'MITERED' && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--ink-soft)' }}>Tube A Raw Cut:</span><strong style={{ fontWeight: 500 }}>{rawLeft.toFixed(2)}"</strong></div>}
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--ink-soft)' }}>{engData.shape === 'STRAIGHT' ? 'Main Tube Raw Cut:' : 'Tube B Raw Cut:'}</span><strong style={{ fontWeight: 500 }}>{rawCenter.toFixed(2)}"</strong></div>
                              {engData.shape === 'MITERED' && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--ink-soft)' }}>Tube C Raw Cut:</span><strong style={{ fontWeight: 500 }}>{rawRight.toFixed(2)}"</strong></div>}
                              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--ink)', marginTop: '8px' }}><span style={{ color: 'var(--ink-soft)' }}>Total Splices Req:</span><strong style={{ fontWeight: 500 }}>{qtySplices}</strong></div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--ink)' }}><span style={{ color: 'var(--ink-soft)' }}>Total Brackets Req:</span><strong style={{ fontWeight: 500 }}>{qtyBrackets}</strong></div>
                          </div>
                      </div>
                  </div>
              )}
          </div>

          {showQuotePanel && (
              <div style={{ width: '450px', background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', zIndex: 100 }}>
                  <div style={{ padding: '24px 30px', background: 'var(--paper-2)', color: 'var(--ink)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500 }}>Item Configuration Check</h3>
                  </div>

                  <div style={{ flex: 1, overflowY: 'auto', padding: '30px', display: 'flex', flexDirection: 'column', gap: '30px', background: '#fff' }}>
                      
                      <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', padding: '24px' }}>
                          <h4 style={{ margin: '0 0 20px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)', borderBottom: '1px solid var(--line)', paddingBottom: '10px' }}>Collection Assignment</h4>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                              <div>
                                  <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px', letterSpacing: '.1em' }}>Collection (Filters Hardware)</label>
                                  <select value={quoteSelections.collection} onChange={e => { setQuoteSelections({...quoteSelections, collection: e.target.value}); setDynamicConfigParams({}); }} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', background: '#fff', outline: 'none' }}>
                                      <option value="">-- No Collection Restriction --</option>
                                      {collectionsData.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                                  </select>
                              </div>
                          </div>
                      </div>

                      <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', padding: '24px' }}>
                          <h4 style={{ margin: '0 0 20px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)', borderBottom: '1px solid var(--line)', paddingBottom: '10px' }}>Engineering Export (To CPQ)</h4>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', fontSize: '0.9rem', color: 'var(--ink)' }}>
                              
                              {!activeFlow ? (
                                  <div style={{ color: '#d9534f', fontStyle: 'italic', padding: '16px', border: '1px dashed #d9534f', background: '#fdf2f2' }}>
                                      ⚠️ WARNING: No CPQ Flow selected.
                                      <br/><br/>
                                      To configure options, please select a CPQ Flow in the left panel.
                                  </div>
                              ) : (
                                  <>
                                      <div style={{ background: 'var(--paper-2)', padding: '20px', border: '1px solid var(--line)' }}>
                                          <div style={{ fontWeight: 500, marginBottom: '12px', fontFamily: 'var(--serif)', fontSize: '1.2rem', color: 'var(--ink)' }}>Math Synchronized</div>
                                          <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: '1.8', color: 'var(--ink-soft)' }}>
                                              <li>Pole Length: <strong style={{ color: 'var(--ink)', fontWeight: 500 }}>{poleFeetQty} FT</strong></li>
                                              {qtyBrackets > 0 && <li>Brackets: <strong style={{ color: 'var(--ink)', fontWeight: 500 }}>{qtyBrackets}</strong></li>}
                                              {recRings > 0 && <li>Rec. Rings: <strong style={{ color: 'var(--ink)', fontWeight: 500 }}>{recRings}</strong></li>}
                                              {qtyFinials > 0 && <li>Finials: <strong style={{ color: 'var(--ink)', fontWeight: 500 }}>{qtyFinials}</strong></li>}
                                              {qtySplices > 0 && <li>Splices: <strong style={{ color: 'var(--ink)', fontWeight: 500 }}>{qtySplices}</strong></li>}
                                              {qtyMiters > 0 && <li>Miters: <strong style={{ color: 'var(--ink)', fontWeight: 500 }}>{qtyMiters}</strong></li>}
                                              {qtyBends > 0 && <li>Bent Returns: <strong style={{ color: 'var(--ink)', fontWeight: 500 }}>{qtyBends}</strong></li>}
                                          </ul>
                                      </div>
                                      <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', fontStyle: 'italic', lineHeight: '1.5' }}>
                                          Clicking 'Send to CPQ Cart' will bundle these quantities and attach them as a reference sheet in the final configuration tool.
                                      </div>
                                  </>
                              )}
                          </div>
                      </div>

                  </div>
                  
                  <div style={{ padding: '30px', background: 'var(--paper-2)', borderTop: '1px solid var(--line)' }}>
                      {(() => {
                          // The left end is "settled" by ANY of: a bracket pick (legacy engData or a flow-step
                          // selection), OR a chosen return / end-return-arm — which REPLACE the bracket, so
                          // demanding engData.bracketId then would block every french-return line forever.
                          const leftSettled = !!engData.bracketId
                              || !!(stepBrL && dynamicConfigParams[stepBrL.id])
                              || returnChosenAt('LEFT') || armChosenAt('LEFT');
                          const blocked = isPushingToCPQ || !activeFlow || !leftSettled;
                          return (
                              <button onClick={handlePushToCPQ} disabled={blocked} style={{ width: '100%', padding: '16px', background: blocked ? 'var(--paper)' : 'var(--ink)', color: blocked ? 'var(--ink-soft)' : '#fff', border: 'none', cursor: blocked ? 'not-allowed' : 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>
                                  {isPushingToCPQ ? 'Saving Draft...' : (!activeFlow ? 'Select a CPQ Flow first' : !leftSettled ? 'Pick a Left bracket OR a return/arm end first' : 'Save Line & Draw Next')}
                              </button>
                          );
                      })()}
                  </div>
              </div>
          )}
      </div>
    </div>
  );
};

export default VisionHardware;