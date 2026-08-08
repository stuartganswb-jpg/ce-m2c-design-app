import React, { useState, useEffect } from 'react';
import { db, storage } from '../../firebase';
import { mergeWindowConfig } from './systemWindows';
import { collection, onSnapshot, query, where, doc, setDoc, updateDoc, deleteDoc, getDocs, deleteField } from "firebase/firestore";
import { ref, uploadBytesResumable, uploadBytes, getDownloadURL } from "firebase/storage";
import { loadGLBScene, snapshotPNG } from '../Shared/componentExport';
import { generateOnboardingXlsx } from '../Shared/onboardingXlsx';
import { validateAssemblyAlignment } from '../Shared/assemblyTags';
import { SOURCING, sourcingOf, sourcingPatch } from '../Shared/sourcing';
import { SIZE_FAMILIES, buildSizeIndex } from '../Shared/sizeMatrix';
import { customerKeys, findClientPriceRow } from '../Shared/clientPricing';

// Fabricut-style spec-sheet generator (hidden-line drawings from the working GLB) — lazy so
// the drawing engine only loads when opened.
const SpecSheetModal = React.lazy(() => import('../SpecSheet/SpecSheetModal'));
const SopViewer = React.lazy(() => import('../Shared/SopViewer'));

const AVAILABLE_BRANDS = [
  { id: 'm2c', name: 'M2C Studio' },
  { id: 'uniquity', name: 'Uniquity' }, 
  { id: 'ce', name: 'Classical Elements' }, 
  { id: 'leyla', name: 'Leyla Gans' }
];

const BOMTab = ({ currentUser, activeBrand }) => {
  const [assemblies, setAssemblies] = useState([]);
  const [selectedAssemblyId, setSelectedAssemblyId] = useState("");
  const [capturingThumb, setCapturingThumb] = useState(false);
  const [showSpecSheet, setShowSpecSheet] = useState(false);
  const [uploadingDrawing, setUploadingDrawing] = useState(false); // static shop-drawing PDF attach
  const [showSops, setShowSops] = useState(false); // read-only viewer of the Tab .6 SOP pages
  const [bulkThumb, setBulkThumb] = useState({ running: false, done: 0, total: 0 });
  
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [routingFilter, setRoutingFilter] = useState("ALL"); 
  const [collectionFilter, setCollectionFilter] = useState(""); 
  const [watchlistFilter, setWatchlistFilter] = useState(""); 

  const [bomPins, setBomPins] = useState([]);
  const [libraryParts, setLibraryParts] = useState([]);
  
  // 🚀 FIXED: Added bracketMounts, feeTypes, and cpqRoutingTypes to the global state
  const [globalLists, setGlobalLists] = useState({ 
      uom: [], prodTypes: [], watchLists: [], vendors: [], outsourceActions: [], 
      pillowSizes: [], fillTypes: [], flangeStyles: [], stitchTypes: [], seamCounts: [], 
      partHandling: [], inventoryTypes: [], assemblyTypes: [], projections: [], customers: [],
      bracketMounts: [], feeTypes: [], cpqRoutingTypes: [], bins: []
  }); 
  const [windowConfig, setWindowConfig] = useState(mergeWindowConfig(null));
  
  const [customSchema, setCustomSchema] = useState([]);
  const [dynamicAssets, setDynamicAssets] = useState([]);
  const [collectionsData, setCollectionsData] = useState([]);
  
  const [customersData, setCustomersData] = useState([]);
  // Onboarding price-list export: finishes (for the "across the top" band), CPQ flows (to know which
  // finishes are tagged for the assembly), brand logos (branding), + the export's own customer pick.
  const [globalFinishes, setGlobalFinishes] = useState([]);
  const [cpqFlows, setCpqFlows] = useState([]);
  const [brandLogos, setBrandLogos] = useState({});
  const [onboardCustomerId, setOnboardCustomerId] = useState("");
  const [onboarding, setOnboarding] = useState(false);

  const [activeComponent, setActiveComponent] = useState(null);
  const [editSpecs, setEditSpecs] = useState({ customData: {}, dynamicDicts: {}, cpqCategories: [], collections: [], clientPricing: [], sharedBrands: [], bomRevision: "" });
  const [isSaving, setIsSaving] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);   // BOM pin → existing library part remap
  const [reassignSearch, setReassignSearch] = useState("");
  const [mismatchScan, setMismatchScan] = useState(null);    // cross-assembly placeholder-vs-real audit
  const [scanningMismatches, setScanningMismatches] = useState(false);
  const [collectionAudit, setCollectionAudit] = useState(null); // parts pinned across / against collections
  const [auditingCollections, setAuditingCollections] = useState(false);
  const [alignScan, setAlignScan] = useState(null);             // canonical tag-spec alignment audit (1.5/1.6 ↔ 2/3/CPQ/Vision)
  const [aligningScan, setAligningScan] = useState(false);

  const [newClientPricing, setNewClientPricing] = useState({ customerId: '', clientSku: '', price: '' }); 

  const [assemblyDetails, setAssemblyDetails] = useState({
      itemName: "", legacyErpId: "", productType: "", routingType: "UNASSIGNED", project: "",
      basePrice: "", cost: "", weight: "", pdfUrl: "", cadUrl: "", bomRevision: "",
      isProjectManaged: false, binLocation: "",
      partHandling: "", uom: "EA", pillowSize: "", fillType: "", flangeStyle: "", stitchType: "", seamCount: "", outsourceAction: "", watchList: "NONE",
      dynamicDicts: {}, customData: {}, collections: [], clientPricing: [], sharedBrands: []
  });

  const [pdfFile, setPdfFile] = useState(null);
  const [cadFile, setCadFile] = useState(null); 
  const [assemblyPdfFile, setAssemblyPdfFile] = useState(null);
  const [assemblyCadFile, setAssemblyCadFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [cadUploadProgress, setCadUploadProgress] = useState(0); 

  useEffect(() => {
    const unsubSchema = onSnapshot(doc(db, "system", "master_schema"), (docSnap) => {
      if (docSnap.exists() && docSnap.data().inventoryFields) setCustomSchema(docSnap.data().inventoryFields);
    });
    
    const unsubLists = onSnapshot(doc(db, "system", "master_lists"), (docSnap) => {
      if (docSnap.exists()) {
          const data = docSnap.data();
          // 🚀 FIXED: Now properly downloading all dictionaries so the Vision Engine dropdowns render
          setGlobalLists({
              uom: data.uom || [], prodTypes: data.prodTypes || [],
              watchLists: data.watchLists || [], vendors: data.vendors || [], outsourceActions: data.outsourceActions || [],
              pillowSizes: data.pillowSizes || [], fillTypes: data.fillTypes || [], flangeStyles: data.flangeStyles || [],
              stitchTypes: data.stitchTypes || [], seamCounts: data.seamCounts || [],
              partHandling: data.partHandling || [],
              inventoryTypes: data.inventoryTypes || [], 
              assemblyTypes: data.assemblyTypes || [],
              projections: data.projections || [],
              customers: data.customers || [],
              bracketMounts: data.bracketMounts || [],
              feeTypes: data.feeTypes || [],
              cpqRoutingTypes: data.cpqRoutingTypes || [],
              bins: data.bins || []
          });
      }
    });
    
    const unsubWindowConfig = onSnapshot(doc(db, "system", "window_config"), (docSnap) => {
      setWindowConfig(mergeWindowConfig(docSnap.data()));
    });
    const unsubAssets = onSnapshot(collection(db, "hq_dynamic_data"), snap => setDynamicAssets(snap.docs.map(d => ({id: d.id, ...d.data()}))));
    const unsubCollections = onSnapshot(collection(db, "hq_collections"), snap => setCollectionsData(snap.docs.map(d => ({id: d.id, ...d.data()}))));
    
    const unsubCustomers = onSnapshot(collection(db, "crm_records"), snap => {
        const onlyCustomers = snap.docs
            .map(d => ({id: d.id, ...d.data()}))
            .filter(record => record.type === 'CUSTOMER');
        setCustomersData(onlyCustomers);
    });

    // For the onboarding sheet: master finishes (code/name/texture), CPQ flows (which finishes are
    // tagged per assembly), and the per-brand logo.
    const unsubFinishes = onSnapshot(doc(db, "system", "master_finishes"), (snap) => { if (snap.exists() && snap.data().finishes) setGlobalFinishes(snap.data().finishes); });
    const unsubFlows = onSnapshot(collection(db, "cpq_flows"), snap => setCpqFlows(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const unsubLogos = onSnapshot(doc(db, "hq_config", "brand_logos"), (snap) => { if (snap.exists()) setBrandLogos(snap.data()); });

    return () => { unsubSchema(); unsubLists(); unsubWindowConfig(); unsubAssets(); unsubCollections(); unsubCustomers(); unsubFinishes(); unsubFlows(); unsubLogos(); };
  }, []);

  useEffect(() => {
    if (!activeBrand) return;
    const q = query(collection(db, "Approved_Designs"), where("brandId", "==", activeBrand), where("partClass", "==", "Assembly"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      let docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      docs.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setAssemblies(docs);
      // Default to the first mainline assembly (routingType MAIN or a PRODUCT) — the only ones this tab lists.
      const firstMain = docs.find(d => (d.routingType || '').toUpperCase() === 'MAIN' || (d.recordType || '').toUpperCase() === 'PRODUCT');
      if (firstMain && !selectedAssemblyId) setSelectedAssemblyId(firstMain.itemId);
    });
    return () => unsubscribe();
  }, [activeBrand, selectedAssemblyId]);

  useEffect(() => {
    if (!selectedAssemblyId) { setBomPins([]); return; }
    const q = query(collection(db, "assembly_pins"), where("assemblyId", "==", selectedAssemblyId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      // Doc id LAST so a stale stored `id` field can never mask the real document.
      setBomPins(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
    });
    return () => unsubscribe();
  }, [selectedAssemblyId]);

  useEffect(() => {
    if (!activeBrand) return;
    const q = query(collection(db, "Approved_Designs"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      let docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      docs = docs.filter(d => d.brandId === activeBrand || (d.sharedBrands && d.sharedBrands.includes(activeBrand)));
      setLibraryParts(docs);
    });
    return () => unsubscribe();
  }, [activeBrand]);

  const selectedAssemblyData = assemblies.find(a => a.itemId === selectedAssemblyId);

  // Capture a thumbnail of the WHOLE assembly from its .glb (3/4 render), the assembly-level
  // counterpart to the per-component thumbnails generated in Visual Assembly.
  const handleCaptureAssemblyThumbnail = async () => {
      const cadUrl = selectedAssemblyData?.manufacturingSpecs?.cadUrl;
      if (!cadUrl) return alert("This assembly has no 3D CAD (.glb) to capture.");
      setCapturingThumb(true);
      try {
          const scene = await loadGLBScene(cadUrl);
          const png = await snapshotPNG(scene, 768);
          const sref = ref(storage, `assembly_thumbnails/${activeBrand}_${selectedAssemblyData.itemId}.png`);
          await uploadBytes(sref, png, { contentType: 'image/png' });
          await updateDoc(doc(db, "Approved_Designs", selectedAssemblyData.id), { finalImageUrl: await getDownloadURL(sref) });
          alert("✅ Assembly thumbnail captured.");
      } catch (e) { console.error(e); alert("Capture failed: " + (e.message || e)); }
      finally { setCapturingThumb(false); }
  };

  // Bulk: render + save a .glb thumbnail for EVERY filtered assembly that has a cadUrl but no image.
  // Sequential so we never hold many offscreen WebGL contexts at once (snapshotPNG releases each after).
  const handleBulkThumbnails = async () => {
      const targets = filteredAssemblies.filter(a => a.manufacturingSpecs?.cadUrl && !a.finalImageUrl);
      // Size-variant siblings (CPQ scales the base geometry — H2-1BE etc.) have no .glb of their
      // own, so the render pass can't reach them; same part, different size → the BASE item's
      // thumbnail is still valid for part verification, so those get a copy pass instead.
      const sibCandidates = filteredAssemblies.filter(a => !a.manufacturingSpecs?.cadUrl && !a.finalImageUrl && a.manufacturingSpecs?.customData?.sizeKey);
      if (!targets.length && !sibCandidates.length) return alert('Every assembly matching the current filters already has a thumbnail. Adjust the filters, or use the per-assembly Re-capture button on one that has an image.');
      if (!window.confirm(`Thumbnails for ${targets.length + sibCandidates.length} assembly(ies) missing an image:\n\n• ${targets.length} rendered offscreen from their .glb\n• ${sibCandidates.length} size-variants copied from their base-size sibling's image\n\nThis can take a little while for a large render batch. You can keep working; leaving the tab cancels it.`)) return;
      setBulkThumb({ running: true, done: 0, total: targets.length });
      let ok = 0, fail = 0;
      for (let i = 0; i < targets.length; i++) {
          const a = targets[i];
          try {
              const scene = await loadGLBScene(a.manufacturingSpecs.cadUrl);
              const png = await snapshotPNG(scene, 768);
              const sref = ref(storage, `assembly_thumbnails/${activeBrand}_${a.itemId}.png`);
              await uploadBytes(sref, png, { contentType: 'image/png' });
              await updateDoc(doc(db, "Approved_Designs", a.id), { finalImageUrl: await getDownloadURL(sref) });
              ok++;
          } catch (e) { console.error('Bulk thumbnail failed for', a.itemId, e); fail++; }
          setBulkThumb({ running: true, done: i + 1, total: targets.length });
      }
      // Copy pass: size siblings inherit the base-diameter item's image (same geometry, scaled).
      let copied = 0, noBase = 0;
      try {
          const idx = buildSizeIndex(assemblies);
          for (const s of sibCandidates) {
              const sk = s.manufacturingSpecs.customData.sizeKey;
              const fam = SIZE_FAMILIES[sk.family];
              if (!fam) { noBase++; continue; }
              const base = idx.get(`${sk.family}|${fam.baseDia}|${sk.style}|${sk.projLetter || ''}`);
              const img = base && base.id !== s.id ? (base.finalImageUrl || base.componentImageUrl) : null;
              if (!img) { noBase++; continue; }
              await updateDoc(doc(db, "Approved_Designs", s.id), { finalImageUrl: img });
              copied++;
          }
      } catch (e) { console.error('Size-sibling thumbnail pass failed', e); }
      setBulkThumb({ running: false, done: 0, total: 0 });
      alert(`✅ Thumbnails: ${ok} generated${copied ? ` · ${copied} copied from base-size siblings` : ''}${fail ? ` · ${fail} failed (see console — usually a missing/invalid .glb)` : ''}${noBase ? ` · ${noBase} size-variant(s) skipped (their base-size item has no image yet — generate the base first, then run again)` : ''}.`);
  };

  useEffect(() => {
      if (selectedAssemblyData) {
          const legacyCollection = selectedAssemblyData.collection && selectedAssemblyData.collection !== 'N/A' ? [selectedAssemblyData.collection] : [];
          const currentCollections = selectedAssemblyData.manufacturingSpecs?.collections || legacyCollection;

          setAssemblyDetails({
              itemName: selectedAssemblyData.itemName || "",
              legacyErpId: selectedAssemblyData.legacyErpId === "PENDING" ? "" : (selectedAssemblyData.legacyErpId || ""),
              productType: selectedAssemblyData.manufacturingSpecs?.productType || selectedAssemblyData.productType || "",
              collections: currentCollections,
              routingType: selectedAssemblyData.routingType || "UNASSIGNED",
              project: selectedAssemblyData.project || "",
              basePrice: selectedAssemblyData.manufacturingSpecs?.basePrice || "",
              cost: selectedAssemblyData.manufacturingSpecs?.cost || "",
              weight: selectedAssemblyData.manufacturingSpecs?.weight || "",
              pdfUrl: selectedAssemblyData.manufacturingSpecs?.pdfUrl || "",
              cadUrl: selectedAssemblyData.manufacturingSpecs?.cadUrl || "",
              bomRevision: selectedAssemblyData.manufacturingSpecs?.bomRevision || "",
              isProjectManaged: selectedAssemblyData.manufacturingSpecs?.isProjectManaged || false,
              binLocation: selectedAssemblyData.manufacturingSpecs?.binLocation || "",
              partHandling: selectedAssemblyData.manufacturingSpecs?.partHandling || "",
              uom: selectedAssemblyData.manufacturingSpecs?.uom || "EA",
              pillowSize: selectedAssemblyData.manufacturingSpecs?.pillowSize || "",
              fillType: selectedAssemblyData.manufacturingSpecs?.fillType || "",
              flangeStyle: selectedAssemblyData.manufacturingSpecs?.flangeStyle || "",
              stitchType: selectedAssemblyData.manufacturingSpecs?.stitchType || "",
              seamCount: selectedAssemblyData.manufacturingSpecs?.seamCount || "",
              outsourceAction: selectedAssemblyData.manufacturingSpecs?.outsourceAction || "",
              watchList: selectedAssemblyData.manufacturingSpecs?.watchList || "NONE",
              dynamicDicts: selectedAssemblyData.manufacturingSpecs?.dynamicDicts || {},
              customData: selectedAssemblyData.manufacturingSpecs?.customData || {},
              clientPricing: selectedAssemblyData.clientPricing || [],
              sharedBrands: selectedAssemblyData.sharedBrands || [activeBrand]
          });
      }
  }, [selectedAssemblyData, activeBrand]);

  const renderOptionFallback = (currentVal, optionsArray) => {
      const safeVal = String(currentVal || "").trim().toUpperCase();
      if (!safeVal || safeVal === "N/A" || safeVal === "UNASSIGNED" || safeVal === "NONE") return null;
      const safeArr = (optionsArray || []).map(o => String(o).trim().toUpperCase());
      if (!safeArr.includes(safeVal)) {
          return <option value={safeVal}>{currentVal} (Imported ERP Value)</option>;
      }
      return null;
  };

  const dynamicProdTypes = Array.from(new Set([
      ...(globalLists.prodTypes || []).map(p => p.toUpperCase()), 
      ...assemblies.map(p => (p.productType || p.manufacturingSpecs?.productType || "").toUpperCase()).filter(Boolean)
  ])).sort();

  const dynamicCollections = Array.from(new Set([
      ...collectionsData.map(c => c.name.toUpperCase()), 
      ...assemblies.flatMap(p => p.manufacturingSpecs?.collections ? p.manufacturingSpecs.collections.map(c => c.toUpperCase()) : (p.manufacturingSpecs?.customData?.collection && p.manufacturingSpecs.customData.collection !== 'N/A' ? [p.manufacturingSpecs.customData.collection.toUpperCase()] : []))
  ])).sort();

  const dynamicWatchlists = Array.from(new Set([
      ...(globalLists.watchLists || []).map(w => w.toUpperCase()), 
      ...assemblies.map(p => {
          const specs = p.manufacturingSpecs || {};
          const nsWatchlist = specs.customData?.watchlist && specs.customData.watchlist !== 'N/A' ? specs.customData.watchlist.toUpperCase() : "NONE";
          return specs.watchList ? specs.watchList.toUpperCase() : nsWatchlist;
      }).filter(w => w !== "NONE")
  ])).sort();

  const filteredAssemblies = assemblies.filter(part => {
      const term = searchTerm.toLowerCase();
      const specs = part.manufacturingSpecs || {};

      // The BOM Engine builds MAINLINE assemblies only (routingType MAIN, or a PRODUCT from Inception);
      // sub-assemblies / parts are edited in the Master Library.
      if ((part.routingType || '').toUpperCase() !== 'MAIN' && (part.recordType || '').toUpperCase() !== 'PRODUCT') return false;

      const matchesSearch = part.itemName?.toLowerCase().includes(term) ||
                            (part.legacyErpId && part.legacyErpId.toLowerCase().includes(term)) || 
                            (part.itemId && part.itemId.toLowerCase().includes(term));
      
      let matchesType = typeFilter === "" || (specs.productType || "").toUpperCase() === typeFilter.toUpperCase() || (part.productType || "").toUpperCase() === typeFilter.toUpperCase();
      
      const nsCollection = specs.customData?.collection ? [specs.customData.collection.toUpperCase()] : [];
      const partCollections = specs.collections ? specs.collections.map(c=>c.toUpperCase()) : nsCollection;
      let matchesCollection = collectionFilter === "" || partCollections.includes(collectionFilter.toUpperCase()); 
      
      let matchesRouting = routingFilter === "ALL" || (routingFilter === "UNASSIGNED" ? (!part.routingType || part.routingType === "UNASSIGNED") : (part.routingType?.toUpperCase() === routingFilter.toUpperCase()));

      const nsWatchlist = specs.customData?.watchlist && specs.customData.watchlist !== 'N/A' ? specs.customData.watchlist.toUpperCase() : "NONE";
      const currentWatchList = specs.watchList ? specs.watchList.toUpperCase() : nsWatchlist;
      let matchesWatchlist = watchlistFilter === "" || currentWatchList === watchlistFilter.toUpperCase();
      
      return matchesSearch && matchesType && matchesCollection && matchesRouting && matchesWatchlist;
  });

  const populatedBOM = bomPins.map(pin => {
      const masterPart = libraryParts.find(p => p.id === pin.partId || p.legacyErpId === pin.partId || p.itemId === pin.partId || p.netSuiteInternalId == pin.partId);
      return { ...pin, masterPart: masterPart || null };
  });

  // MASTER BOM SCAN — audit the selected assembly's BOM so nothing ghosts out of a quote or push:
  // every pin resolves to a real library part (or is a legit fee/hidden), no orphan/duplicate pins,
  // no cluster silently contributing zero BOM lines, priced parts actually carry prices + paint
  // variants, no retired parts. Read-only; prints a report.
  const handleMasterBomScan = () => {
      if (!selectedAssemblyData) return alert('Select an assembly first.');
      const clusters = selectedAssemblyData.nodeClusters || [];
      const clusterById = {}; clusters.forEach(c => { clusterById[c.id] = c; });
      const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9/]/g, '');
      const byCode = new Map();
      libraryParts.forEach(p => [p.id, p.itemId, p.legacyErpId].forEach(c => { const k = norm(c); if (k && k !== 'PENDING' && !byCode.has(k)) byCode.set(k, p); }));
      const findPart = (key) => byCode.get(norm(key)) || null;

      const ghosts = [], feeNoEntity = [], hiddenPins = [], orphanPins = [], dupNodes = [], noPrice = [], noType = [], retired = [], missingP = [];
      const nodeCount = {};
      bomPins.forEach(pin => {
          const label = pin.partName || pin.partId || pin.id;
          if (pin.choiceNode) { nodeCount[pin.choiceNode] = (nodeCount[pin.choiceNode] || 0) + 1; }
          if (pin.clusterId && !clusterById[pin.clusterId]) orphanPins.push(label);
          if (pin.isHiddenPart) { hiddenPins.push(label); return; }
          const part = findPart(pin.partId) || (pin.legacyErpId ? findPart(pin.legacyErpId) : null);
          if (!part) {
              if (pin.isFee) feeNoEntity.push(label);       // fee with no entity: prices only via option price
              else ghosts.push(`${label} (${pin.partId})`); // REAL problem: BOM line will not resolve
              return;
          }
          if (pin.isFee) return; // fee entity resolved — price comes from it, no physical checks
          const code = (part.legacyErpId && part.legacyErpId !== 'PENDING') ? part.legacyErpId : (part.itemId || part.id);
          const specs = part.manufacturingSpecs || {};
          if (specs.isRetired) retired.push(code);
          const pt = specs.productType;
          if (!pt || /uncategor/i.test(String(pt))) noType.push(code);
          // Price can live on the base OR its finish variants — flag only when NONE carry a price.
          const basePriced = parseFloat(specs.basePrice) > 0;
          const pVar = byCode.get(norm(`${code}/P`));
          const pPriced = pVar && parseFloat(pVar.manufacturingSpecs?.basePrice) > 0;
          if (!basePriced && !pPriced) noPrice.push(code);
          if (!String(code).includes('/') && !pVar) missingP.push(code);
      });
      Object.entries(nodeCount).forEach(([n, c]) => { if (c > 1) dupNodes.push(`${n} ×${c}`); });
      const emptyClusters = clusters.filter(c => !c.hidden && !bomPins.some(p => p.clusterId === c.id)).map(c => c.name);

      const sect = (title, arr, always) => (arr.length || always) ? `\n${title} (${arr.length})${arr.length ? ':\n  ' + arr.slice(0, 15).join('\n  ') + (arr.length > 15 ? `\n  …+${arr.length - 15} more` : '') : ''}` : '';
      const problems = ghosts.length + orphanPins.length + dupNodes.length + emptyClusters.length + retired.length;
      alert(`🔍 MASTER BOM SCAN — ${selectedAssemblyData.itemName}\n${bomPins.length} pin(s) · ${clusters.length} cluster(s) · ${hiddenPins.length} hidden · ${bomPins.filter(p => p.isFee).length} fee\n`
          + (problems === 0 ? '\n✅ No structural problems — every pin resolves, no orphans/duplicates, no silent clusters.\n' : '')
          + sect('❌ GHOST PINS — do not resolve to any library item (BOM/pricing will miss them)', ghosts)
          + sect('❌ ORPHAN PINS — cluster no longer exists', orphanPins)
          + sect('❌ DUPLICATE PINS on one node', dupNodes)
          + sect('⚠ CLUSTERS WITH NO PINS — contribute zero BOM lines', emptyClusters)
          + sect('⚠ RETIRED PARTS still pinned', retired)
          + sect('⚠ NO PRICE on base OR /P variant', noPrice)
          + sect('⚠ NO /P PAINT VARIANT in library (paint finishes will bill the unpriced base)', missingP)
          + sect('⚠ NO PRODUCT TYPE (shows as NO TYPE)', noType)
          + sect('ℹ FEE PINS WITHOUT A FEE ENTITY — price only via the option price', feeNoEntity)
      );
  };

  // Build + download the customer onboarding / price-list .xlsx for the selected main assembly.
  // Items come from the assembly's BOM pins → library parts; category + hidden come from its
  // nodeClusters; the finish band comes from the assembly's CPQ flow(s). A chosen customer fills the
  // per-customer id / SKU / price columns from each part's clientPricing.
  const handleGenerateOnboarding = async () => {
      if (!selectedAssemblyData) return alert("Select a main assembly first.");
      setOnboarding(true);
      try {
          const asm = selectedAssemblyData;
          const clusterById = {}; (asm.nodeClusters || []).forEach(c => { clusterById[c.id] = c; });
          // Shared clientPricing matcher (id ∪ name ∪ companyName) — the strict-id match here
          // dropped name-keyed rows from the export's SKU/price columns while CPQ honoured them.
          const onboardCust = onboardCustomerId ? customersData.find(c => c.id === onboardCustomerId) : null;
          const onboardKeys = customerKeys(onboardCustomerId, onboardCust);
          const classify = (raw) => { const t = String(raw || '').toUpperCase(); if (t.includes('BACKPLATE') || t.includes('BACK PLATE')) return 'BACKPLATE'; if (t.includes('BRACKET')) return 'BRACKET'; if (t.includes('FINIAL')) return 'FINIAL'; if (t.includes('RING')) return 'RING'; if (t.includes('POLE') || t.includes('ROD')) return 'POLE'; if (t.includes('END')) return 'END'; return 'OTHER'; };
          // One row per unique item (a part repeated across positions lists once); skip hidden + retired.
          const byPart = {};
          (bomPins || []).forEach(pin => {
              const cl = pin.clusterId ? clusterById[pin.clusterId] : null;
              if (cl && cl.hidden) return;
              const part = libraryParts.find(p => p.id === pin.partId || p.legacyErpId === pin.partId || p.itemId === pin.partId || p.netSuiteInternalId == pin.partId);
              if (!part || part.manufacturingSpecs?.isRetired) return;
              const key = part.id || part.legacyErpId || pin.partId;
              if (byPart[key]) return;
              const cp = findClientPriceRow(part.clientPricing, onboardKeys);
              byPart[key] = {
                  cat: classify(cl?.category || part.manufacturingSpecs?.productType || part.productType),
                  thumbnailUrl: part.finalImageUrl || part.componentImageUrl || part.manufacturingSpecs?.finalImageUrl || '',
                  erpId: (part.legacyErpId && part.legacyErpId !== 'PENDING') ? part.legacyErpId : (part.itemId || ''),
                  description: part.itemName || '',
                  salesPrice: part.manufacturingSpecs?.basePrice,
                  customerSku: cp?.clientSku || '',
                  customerPrice: cp?.price,
              };
          });
          const items = Object.values(byPart);
          if (!items.length) return alert("No sellable items found for this assembly (after removing hidden/retired). Check its BOM pins + Node-Grouping tags.");
          const ORDER = [['POLE', 'Poles / Rods'], ['FINIAL', 'Finials'], ['RING', 'Rings'], ['BRACKET', 'Brackets'], ['BACKPLATE', 'Backplates'], ['END', 'End Treatments'], ['OTHER', 'Other Hardware']];
          const groups = ORDER.map(([cat, label]) => ({ label, items: items.filter(i => i.cat === cat).sort((a, b) => String(a.erpId).localeCompare(String(b.erpId))) })).filter(g => g.items.length);
          // Finishes tagged on this assembly's flow(s); if nothing is explicitly restricted, all apply.
          const flows = cpqFlows.filter(f => f.linkedAssemblyId === asm.id || f.linkedAssemblyId === asm.itemId);
          const finishIds = new Set();
          flows.forEach(f => {
              (f.defaultFinishOptions || []).forEach(id => finishIds.add(id));
              (f.steps || []).forEach(s => { (s.finishAllowedOptions || []).forEach(id => finishIds.add(id)); (s.styleOptions || []).forEach(o => (o.finishAllowedOptions || []).forEach(id => finishIds.add(id))); });
          });
          let finishes = [...finishIds].map(id => { const fn = globalFinishes.find(g => g.id === id); return fn ? { code: fn.code, name: fn.name } : null; }).filter(Boolean);
          if (!finishes.length) finishes = globalFinishes.map(g => ({ code: g.code, name: g.name }));
          finishes.sort((a, b) => String(a.code || a.name).localeCompare(String(b.code || b.name)));
          const brand = AVAILABLE_BRANDS.find(b => b.id === activeBrand);
          const cust = onboardCustomerId ? customersData.find(c => c.id === onboardCustomerId) : null;
          await generateOnboardingXlsx({
              brandName: brand?.name || (activeBrand || '').toUpperCase(),
              logoUrl: brandLogos[activeBrand] || '',
              assemblyName: asm.itemName || asm.itemId || 'Assembly',
              assemblyErpId: (asm.legacyErpId && asm.legacyErpId !== 'PENDING') ? asm.legacyErpId : '',
              finishes, groups,
              customer: cust ? { id: cust.id, name: cust.companyName || cust.name || cust.id } : null,
              fileName: `${(brand?.name || activeBrand || 'brand').replace(/[^a-z0-9]/gi, '_')}_${(asm.itemName || asm.itemId || 'assembly').replace(/[^a-z0-9]/gi, '_')}_onboarding.xlsx`,
          });
      } catch (e) { console.error("Onboarding export failed", e); alert("Onboarding export failed: " + (e?.message || e)); }
      setOnboarding(false);
  };

  // Quick-create a Master Library part right from the BOM Engine — same doc shape as the 1.6 Item
  // Starter Kit. Used when a BOM pin references an item that isn't in the library yet (and by the
  // ＋ New Library Item button), so nobody has to detour through another tab. Sync/push it to
  // NetSuite afterward (tab 11 write-back: exact item-id matches LINK, the rest CREATE — no dupes).
  const createLibraryPart = async ({ code, name, productType }) => {
      const erp = String(code || '').trim().toUpperCase();
      if (!erp) return null;
      const id = `${String(activeBrand || 'CE').toUpperCase()}-INV-${Date.now()}`;
      const partDoc = {
          id, itemId: id, legacyErpId: erp, itemName: String(name || erp).toUpperCase(),
          brandId: activeBrand, sharedBrands: [activeBrand],
          partClass: 'Inventory', routingType: 'STANDARD', project: '',
          manufacturingSpecs: { productType: String(productType || 'Uncategorized').toUpperCase(), uom: 'EA', status: 'NEEDS_SPECS' }
      };
      await setDoc(doc(db, "Approved_Designs", id), partDoc);
      return partDoc;
  };

  const openComponentEditor = (bomItem) => {
      if (!bomItem.masterPart) {
          const code = String(bomItem.partId || '').toUpperCase();
          const guessType = (bomItem.partName || code).match(/BRACKET|BACKPLATE|FINIAL|RING|POLE|ROD/i)?.[0]?.toUpperCase() || '';
          if (!window.confirm(`"${bomItem.partName || code}" (${code}) isn't in the Master Library.\n\nCreate it now as a new library item? You can fill its specs immediately after, then sync it to NetSuite (tab 11 write-back links exact matches / creates the rest — no duplicates).`)) return;
          createLibraryPart({ code, name: bomItem.partName, productType: guessType })
              .then(p => { if (p) openComponentEditor({ ...bomItem, masterPart: p }); })
              .catch(e => { console.error('quick-create failed', e); alert('Create failed — check console.'); });
          return;
      }
      setActiveComponent(bomItem);
      setPdfFile(null); setCadFile(null); 
      
      const baseSpecs = bomItem.masterPart.manufacturingSpecs || {};
      const parametricData = baseSpecs.parametric || { isCutToSize: false, fixedDiameter: "", maxLength: "", widthOffset: "", cadProfile: "CYLINDER", length: "", width: "", height: "" };
      const customData = baseSpecs.customData || {}; 
      const dynamicDicts = baseSpecs.dynamicDicts || {};
      const cpqCategories = baseSpecs.cpqCategories || []; 
      const isInHouse = baseSpecs.isInHouse !== undefined ? baseSpecs.isInHouse : true;
      const partHandling = baseSpecs.partHandling || ""; 

      const legacyCollection = baseSpecs.collection && baseSpecs.collection !== 'N/A' ? [baseSpecs.collection] : [];
      const currentCollections = baseSpecs.collections || legacyCollection;

      setEditSpecs({ 
          ...baseSpecs, 
          parametric: parametricData, 
          customData, 
          dynamicDicts,
          collections: currentCollections,
          cpqCategories, 
          isInHouse, 
          partHandling,
          bomRevision: baseSpecs.bomRevision || "",
          project: bomItem.masterPart.project || "",
          routingType: bomItem.masterPart.routingType || "",
          clientPricing: bomItem.masterPart.clientPricing || [],
          sharedBrands: bomItem.masterPart.sharedBrands || [activeBrand],
          tempName: bomItem.masterPart.itemName, 
          tempLegacyId: bomItem.masterPart.legacyErpId === "PENDING" ? "" : bomItem.masterPart.legacyErpId
      });
  };

  // Re-point this BOM pin to an EXISTING library part (fixes CAD-node carryovers like "H1-1EC_V61"
  // that were saved as a new placeholder instead of the real part). Only the pin's link changes —
  // its position/cluster/thumbnail stay. The leftover placeholder part should then be deleted.
  const reassignComponentPart = async (part) => {
      if (!activeComponent?.id) return;
      const label = part.legacyErpId && part.legacyErpId !== 'PENDING' ? part.legacyErpId : (part.itemId || part.id);
      if (!window.confirm(`Re-point this BOM component to "${part.itemName}" (${label})?\n\nThe pin keeps its position; only the linked library part changes. Remember to delete the leftover placeholder part from the library afterward.`)) return;
      try {
          // Same contract as Visual Assembly's reassign: the pin's fee role FOLLOWS the part
          // (Fee/Charge entity keeps it a fee; a normal item clears it), hidden is cleared, and the
          // partial update preserves choiceNode/targetNode/choiceSort so 1.6 + CPQ stay intact.
          const isFeePart = part.partClass === 'Fee' || part.isFee === true || String(part.manufacturingSpecs?.productType || '').toUpperCase() === 'FEE';
          await updateDoc(doc(db, "assembly_pins", activeComponent.id), {
              partId: part.itemId || part.id,
              partName: part.itemName,
              legacyErpId: part.legacyErpId || 'N/A',
              specs: part.manufacturingSpecs || {},
              isExistingLibraryPart: true,
              status: 'SPECS_LOCKED',
              isFee: isFeePart, isHiddenPart: false
          });
          setActiveComponent(null); setReassignOpen(false); setReassignSearch("");
          alert(`Reassigned to ${part.itemName}.`);
      } catch (e) { console.error('reassign failed', e); alert('Reassign failed — check console.'); }
  };

  // Scan ALL assemblies for BOM pins pointing at a PENDING/NEEDS_SPECS placeholder whose name matches
  // an existing REAL library part (the CAD-node carryover pattern) — so they can be cleaned up too.
  const isPlaceholderPart = (p) => !p || p.manufacturingSpecs?.status === 'NEEDS_SPECS' || !p.legacyErpId || p.legacyErpId === 'PENDING';
  const runMismatchScan = async () => {
      setScanningMismatches(true);
      try {
          const realParts = libraryParts.filter(p => !isPlaceholderPart(p));
          const snap = await getDocs(collection(db, "assembly_pins"));
          const results = [];
          snap.docs.forEach(d => {
              const pin = { id: d.id, ...d.data() };
              const linked = libraryParts.find(p => p.id === pin.partId || p.itemId === pin.partId || p.legacyErpId === pin.partId);
              if (!isPlaceholderPart(linked)) return; // pin already points at a real, specced part — fine
              const nm = String(pin.partName || (linked && linked.itemName) || '').toUpperCase();
              if (!nm) return;
              const base = nm.replace(/[ _-]?V\d+$/i, '').trim();
              const match = realParts.find(p => (!linked || p.id !== linked.id) && ((p.itemName || '').toUpperCase() === nm || (base && (p.itemName || '').toUpperCase() === base)));
              if (match) results.push({ pin, linkedName: pin.partName || (linked && linked.itemName) || pin.partId, match });
          });
          results.sort((a, b) => String(a.pin.assemblyId || '').localeCompare(String(b.pin.assemblyId || '')));
          setMismatchScan(results);
      } catch (e) { console.error('mismatch scan failed', e); alert('Scan failed — check console.'); }
      finally { setScanningMismatches(false); }
  };
  // One-click fix from the scan: re-point a pin to the suggested real part.
  const linkPinToPart = async (pin, part) => {
      try {
          await updateDoc(doc(db, "assembly_pins", pin.id), {
              partId: part.itemId || part.id, partName: part.itemName,
              legacyErpId: part.legacyErpId || 'N/A', specs: part.manufacturingSpecs || {},
              isExistingLibraryPart: true, status: 'SPECS_LOCKED'
          });
          setMismatchScan(prev => (prev || []).filter(r => r.pin.id !== pin.id));
      } catch (e) { console.error('link failed', e); alert('Link failed — check console.'); }
  };

  // Read-only audit: which BOM-pinned parts live across / against collection lines. A part pinned into
  // assemblies of MORE THAN ONE collection, or pinned into an assembly whose collection its own tag does
  // NOT share, is surfaced for review — it's what makes the Vision/CPQ pickers collection-scope a part
  // out of a flow. Some are legitimately shared (universal hardware); others are mis-pins. You decide.
  const colsOfPart = (p) => {
      const specs = p?.manufacturingSpecs || {};
      const arr = (Array.isArray(specs.collections) && specs.collections.length)
          ? specs.collections
          : (specs.customData?.collection ? [specs.customData.collection] : []);
      return arr.map(c => String(c || '').toUpperCase().trim()).filter(Boolean);
  };
  const runCollectionAudit = async () => {
      setAuditingCollections(true);
      try {
          const asmByItemId = {};
          assemblies.forEach(a => { if (a.itemId) asmByItemId[a.itemId] = a; });

          const snap = await getDocs(collection(db, "assembly_pins"));
          const byPart = new Map(); // partId -> { part, partCols, asms:[{asm, asmCols}] }
          snap.docs.forEach(d => {
              const pin = { id: d.id, ...d.data() };
              const asm = asmByItemId[pin.assemblyId];
              if (!asm) return; // assembly not in this brand's library / not found
              const part = libraryParts.find(p => p.id === pin.partId || p.itemId === pin.partId || p.legacyErpId === pin.partId || (pin.legacyErpId && p.legacyErpId === pin.legacyErpId));
              if (!part) return; // unresolved pins are the "Find Part Mismatches" scan's job
              const key = part.id;
              if (!byPart.has(key)) byPart.set(key, { part, partCols: colsOfPart(part), asms: [] });
              byPart.get(key).asms.push({ asm, asmCols: colsOfPart(asm) });
          });

          const real = (c) => c && c !== 'N/A';
          const flagged = [];
          byPart.forEach(({ part, partCols, asms }) => {
              const asmColSet = new Set();
              asms.forEach(a => a.asmCols.forEach(c => { if (real(c)) asmColSet.add(c); }));
              const partTagged = partCols.filter(real);
              // Assemblies whose (tagged) collection the part's own (tagged) collection doesn't share.
              const mismatchAsms = asms.filter(a => {
                  const ac = a.asmCols.filter(real);
                  return ac.length && partTagged.length && !ac.some(c => partTagged.includes(c));
              });
              const multiCollection = asmColSet.size > 1;
              if (multiCollection || mismatchAsms.length) {
                  flagged.push({ part, partCols: partTagged, asms, multiCollection, mismatchCount: mismatchAsms.length, asmCollections: [...asmColSet].sort() });
              }
          });
          flagged.sort((a, b) => (b.asmCollections.length - a.asmCollections.length) || (b.asms.length - a.asms.length) || String(a.part.itemName || '').localeCompare(String(b.part.itemName || '')));
          setCollectionAudit(flagged);
      } catch (e) { console.error('collection audit failed', e); alert('Collection audit failed — check console.'); }
      finally { setAuditingCollections(false); }
  };

  // Flow Alignment Scan — validates every clustered assembly (and its linked CPQ flows) against the
  // canonical tag spec (Shared/assemblyTags.js): dialect vocab values, missing/contradicting cluster
  // tags, pins whose return-ness only lives in a NAME, parts missing the specs Vision reads
  // (bracketType / projection / parametric dims), and steps Vision can't classify. Read-only except
  // the per-row FIX buttons (normalize a dialect value / apply a name-derived suggestion).
  const runAlignmentScan = async () => {
      setAligningScan(true);
      try {
          const pinSnap = await getDocs(collection(db, "assembly_pins"));
          const pinsByAsm = {};
          pinSnap.docs.forEach(d => {
              const p = { id: d.id, ...d.data() };
              if (!p.assemblyId) return;
              (pinsByAsm[p.assemblyId] = pinsByAsm[p.assemblyId] || []).push(p);
          });
          const results = [];
          // Scope: the SELECTED assembly when one is picked; otherwise whatever the filters show.
          const scope = selectedAssemblyId
              ? assemblies.filter(a => a.itemId === selectedAssemblyId || a.id === selectedAssemblyId)
              : filteredAssemblies;
          scope.filter(a => (a.nodeClusters || []).length).forEach(a => {
              const pins = pinsByAsm[a.itemId] || pinsByAsm[a.id] || [];
              const issues = validateAssemblyAlignment({ assembly: a, pins, parts: libraryParts, flows: cpqFlows });
              issues.forEach(i => results.push({ ...i, docId: a.id }));
          });
          const rank = { ERROR: 0, WARN: 1, INFO: 2 };
          results.sort((x, y) => (rank[x.severity] - rank[y.severity]) || String(x.assemblyName).localeCompare(String(y.assemblyName)));
          setAlignScan(results);
      } catch (e) { console.error('alignment scan failed', e); alert('Alignment scan failed — check console.'); }
      finally { setAligningScan(false); }
  };
  // One-click fix from the scan: patch a cluster's tag on the assembly doc, a pin's tag, a part spec
  // (dotted path, e.g. bracketType derived from the cluster), or delete a stale orphaned pin.
  const applyAlignFix = async (row) => {
      try {
          if (row.fix?.type === 'cluster') {
              const asm = assemblies.find(a => a.id === row.docId);
              if (!asm) return alert('Assembly not loaded.');
              const clusters = (asm.nodeClusters || []).map(c => c.id === row.fix.clusterId ? { ...c, ...row.fix.patch } : c);
              await updateDoc(doc(db, "Approved_Designs", row.docId), { nodeClusters: clusters });
          } else if (row.fix?.type === 'pin') {
              await updateDoc(doc(db, "assembly_pins", row.fix.pinId), row.fix.patch);
          } else if (row.fix?.type === 'part') {
              await updateDoc(doc(db, "Approved_Designs", row.fix.partDocId), row.fix.patch);
          } else if (row.fix?.type === 'deletePin') {
              if (!window.confirm('Delete this stale pin? Its cluster no longer exists, so nothing references it — removing it cleans the BOM/Vision pin lists.')) return;
              await deleteDoc(doc(db, "assembly_pins", row.fix.pinId));
          } else return;
          setAlignScan(prev => (prev || []).filter(r => r !== row));
      } catch (e) { console.error('align fix failed', e); alert('Fix failed — check console.'); }
  };

  const handleSpecChange = (e) => setEditSpecs({ ...editSpecs, [e.target.name]: e.target.value });
  const handleAssemblySpecChange = (e) => setAssemblyDetails({ ...assemblyDetails, [e.target.name]: e.target.value });
  const handleParametricChange = (e) => setEditSpecs({ ...editSpecs, parametric: { ...editSpecs.parametric, [e.target.name]: e.target.type === 'checkbox' ? e.target.checked : e.target.value } });
  
  const handleCustomFieldChange = (key, value) => setEditSpecs(prev => ({ ...prev, customData: { ...(prev.customData || {}), [key]: value } }));
  const handleAssemblyCustomFieldChange = (key, value) => setAssemblyDetails(prev => ({ ...prev, customData: { ...(prev.customData || {}), [key]: value } }));

  const handleDictChange = (dictId, value) => setEditSpecs(prev => ({ ...prev, dynamicDicts: { ...(prev.dynamicDicts || {}), [dictId]: value } }));
  const handleAssemblyDictChange = (dictId, value) => setAssemblyDetails(prev => ({ ...prev, dynamicDicts: { ...(prev.dynamicDicts || {}), [dictId]: value } }));

  const handleToggleCollection = (collectionName, isAssembly = false) => {
      if (isAssembly) {
          const current = assemblyDetails.collections || [];
          setAssemblyDetails({ ...assemblyDetails, collections: current.includes(collectionName) ? current.filter(c => c !== collectionName) : [...current, collectionName] });
      } else {
          const current = editSpecs.collections || [];
          setEditSpecs({ ...editSpecs, collections: current.includes(collectionName) ? current.filter(c => c !== collectionName) : [...current, collectionName] });
      }
  };

  const handleCpqCategoryToggle = (categoryId) => {
      const current = editSpecs.cpqCategories || [];
      const updated = current.includes(categoryId) ? current.filter(id => id !== categoryId) : [...current, categoryId];
      setEditSpecs({ ...editSpecs, cpqCategories: updated });
  };

  const getCustomerDisplay = (val) => {
      if (!val) return 'N/A';
      const dbCust = customersData.find(c => c.id === val || c.customerId === val || c.legacyId === val);
      if (dbCust) return `${dbCust.companyName || dbCust.name || 'Unknown'} - ${val}`;
      const listCust = globalLists.customers?.find(c => {
          if (typeof c === 'string') return c === val || c.includes(val);
          return c.id === val || c.name === val;
      });
      if (listCust) {
          if (typeof listCust === 'string') return listCust;
          return `${listCust.name} - ${listCust.id}`;
      }
      return val;
  };

  const handleAddClientPricing = (isAssembly = false) => {
      if (!newClientPricing.customerId) return alert("Select a customer from the dropdown.");
      if (isAssembly) {
          setAssemblyDetails(prev => ({ ...prev, clientPricing: [...(prev.clientPricing || []), { ...newClientPricing }] }));
      } else {
          setEditSpecs(prev => ({ ...prev, clientPricing: [...(prev.clientPricing || []), { ...newClientPricing }] }));
      }
      setNewClientPricing({ customerId: '', clientSku: '', price: '' });
  };

  const handleRemoveClientPricing = (idx, isAssembly = false) => {
      if (isAssembly) {
          setAssemblyDetails(prev => ({ ...prev, clientPricing: prev.clientPricing.filter((_, i) => i !== idx) }));
      } else {
          setEditSpecs(prev => ({ ...prev, clientPricing: prev.clientPricing.filter((_, i) => i !== idx) }));
      }
  };

  const handleBrandToggle = (brandId, isAssembly = false) => {
      if (isAssembly) {
          let currentShared = assemblyDetails.sharedBrands || [];
          if (currentShared.includes(brandId)) currentShared = currentShared.filter(id => id !== brandId); else currentShared.push(brandId);
          setAssemblyDetails({ ...assemblyDetails, sharedBrands: currentShared });
      } else {
          let currentShared = editSpecs.sharedBrands || [];
          if (currentShared.includes(brandId)) currentShared = currentShared.filter(id => id !== brandId); else currentShared.push(brandId);
          setEditSpecs({ ...editSpecs, sharedBrands: currentShared });
      }
  };

  const handleDynamicFileUpload = async (key, file, isAssembly = false) => {
      if (!file) return;
      const storageRef = ref(storage, `custom_uploads/${activeBrand}_${Date.now()}_${file.name}`);
      const uploadTask = uploadBytesResumable(storageRef, file);
      
      uploadTask.on("state_changed", null, 
          (err) => { console.error(err); alert("File upload failed."); },
          async () => { 
              const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
              if (isAssembly) handleAssemblyCustomFieldChange(key, downloadURL);
              else handleCustomFieldChange(key, downloadURL);
          }
      );
  };

  const saveAssemblyDetails = async () => {
      if (!selectedAssemblyData) return;
      setIsSaving(true);
      try {
          let finalPdfUrl = assemblyDetails.pdfUrl || "";
          if (assemblyPdfFile) {
              const storageRef = ref(storage, `prints/${activeBrand}_${assemblyDetails.legacyErpId || selectedAssemblyData.itemId}_${assemblyPdfFile.name}`);
              const uploadTask = uploadBytesResumable(storageRef, assemblyPdfFile);
              await new Promise((resolve, reject) => { uploadTask.on("state_changed", null, reject, async () => { finalPdfUrl = await getDownloadURL(uploadTask.snapshot.ref); resolve(); }); });
          }

          let finalCadUrl = assemblyDetails.cadUrl || "";
          if (assemblyCadFile) {
              const cadStorageRef = ref(storage, `cad_models/${activeBrand}_${assemblyDetails.legacyErpId || selectedAssemblyData.itemId}_${assemblyCadFile.name}`);
              const cadUploadTask = uploadBytesResumable(cadStorageRef, assemblyCadFile);
              await new Promise((resolve, reject) => { cadUploadTask.on("state_changed", null, reject, async () => { finalCadUrl = await getDownloadURL(cadUploadTask.snapshot.ref); resolve(); }); });
          }

          const currentSpecs = selectedAssemblyData.manufacturingSpecs || {};
          delete currentSpecs.collection; 
          
          await updateDoc(doc(db, "Approved_Designs", selectedAssemblyData.id), {
              itemName: assemblyDetails.itemName.toUpperCase(),
              legacyErpId: assemblyDetails.legacyErpId.toUpperCase() || "PENDING",
              productType: assemblyDetails.productType,
              routingType: assemblyDetails.routingType,
              project: assemblyDetails.project || "",
              clientPricing: assemblyDetails.clientPricing || [], 
              sharedBrands: assemblyDetails.sharedBrands || [activeBrand], 
              manufacturingSpecs: { 
                  ...currentSpecs, 
                  basePrice: assemblyDetails.basePrice, 
                  cost: assemblyDetails.cost,
                  weight: assemblyDetails.weight,
                  bomRevision: assemblyDetails.bomRevision,
                  pdfUrl: finalPdfUrl,
                  cadUrl: finalCadUrl,
                  isProjectManaged: assemblyDetails.isProjectManaged,
                  binLocation: assemblyDetails.binLocation,
                  partHandling: assemblyDetails.partHandling,
                  uom: assemblyDetails.uom,
                  collections: assemblyDetails.collections, 
                  pillowSize: assemblyDetails.pillowSize,
                  fillType: assemblyDetails.fillType,
                  flangeStyle: assemblyDetails.flangeStyle,
                  stitchType: assemblyDetails.stitchType,
                  seamCount: assemblyDetails.seamCount,
                  outsourceAction: assemblyDetails.outsourceAction,
                  watchList: assemblyDetails.watchList,
                  dynamicDicts: assemblyDetails.dynamicDicts,
                  customData: assemblyDetails.customData 
              },
              updatedAt: new Date().toISOString()
          });
          setTimeout(() => { setIsSaving(false); setAssemblyPdfFile(null); setAssemblyCadFile(null); }, 600);
      } catch (err) {
          console.error(err); setIsSaving(false); alert("Failed to save assembly details.");
      }
  };

  const saveGlobalUpdates = async () => {
      if (!activeComponent?.masterPart) return;
      setIsSaving(true);
      
      let finalPdfUrl = editSpecs.pdfUrl || "";
      if (pdfFile) {
        const storageRef = ref(storage, `prints/${activeBrand}_${activeComponent.masterPart.legacyErpId}_${pdfFile.name}`);
        const uploadTask = uploadBytesResumable(storageRef, pdfFile);
        await new Promise((resolve, reject) => { uploadTask.on("state_changed", (snap) => setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)), (err) => reject(err), async () => { finalPdfUrl = await getDownloadURL(uploadTask.snapshot.ref); resolve(); }); });
      }

      let finalCadUrl = editSpecs.cadUrl || "";
      if (cadFile) {
        const cadStorageRef = ref(storage, `cad_models/${activeBrand}_${activeComponent.masterPart.legacyErpId}_${cadFile.name}`);
        const cadUploadTask = uploadBytesResumable(cadStorageRef, cadFile);
        await new Promise((resolve, reject) => { cadUploadTask.on("state_changed", (snap) => setCadUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)), (err) => reject(err), async () => { finalCadUrl = await getDownloadURL(cadUploadTask.snapshot.ref); resolve(); }); });
      }

      const compiledSpecs = { 
          ...editSpecs, 
          bomRevision: editSpecs.bomRevision || "",
          pdfUrl: finalPdfUrl, 
          cadUrl: finalCadUrl,
          status: "SPECS_LOCKED" 
      };
      delete compiledSpecs.collection;
      
      const finalName = editSpecs.tempName || activeComponent.masterPart.itemName;
      const finalLegacyId = (editSpecs.tempLegacyId || activeComponent.masterPart.legacyErpId).toUpperCase();

      try {
          await updateDoc(doc(db, "Approved_Designs", activeComponent.masterPart.id), {
              itemName: finalName, 
              legacyErpId: finalLegacyId, 
              routingType: editSpecs.routingType || "", 
              project: editSpecs.project || "",
              productType: editSpecs.productType || "",
              clientPricing: editSpecs.clientPricing || [], 
              sharedBrands: editSpecs.sharedBrands || [activeBrand], 
              manufacturingSpecs: compiledSpecs,
              updatedAt: new Date().toISOString()
          });
          
          setTimeout(() => { setIsSaving(false); setActiveComponent(null); setUploadProgress(0); setCadUploadProgress(0); }, 600);
      } catch (err) {
          console.error(err); setIsSaving(false); alert("Failed to save global updates.");
      }
  };

  const totalCost = populatedBOM.reduce((sum, item) => sum + ((item.masterPart?.manufacturingSpecs?.cost || item.masterPart?.manufacturingSpecs?.basePrice || 0) * (item.defaultQty || 1)), 0);

  const isAssembly = activeComponent?.masterPart?.partClass === 'Assembly' || activeComponent?.masterPart?.partClass === 'Master Assembly';

  const fieldStyle = { width: '100%', padding: '10px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--sans)', fontSize: '0.9rem', outline: 'none' };
  const labelStyle = { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' };
  const sectionHeaderStyle = { margin: '0 0 20px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)', borderBottom: '1px solid var(--line)', paddingBottom: '10px' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', fontFamily: 'var(--sans)', backgroundColor: 'transparent', minHeight: '100vh' }}>

      {mismatchScan !== null && (
        <div onClick={() => setMismatchScan(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', width: '760px', maxHeight: '82vh', borderRadius: '2px', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 48px rgba(0,0,0,0.18)' }}>
            <div style={{ padding: '22px 28px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>Part Mismatches</h3>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                  {mismatchScan.length} BOM pin{mismatchScan.length === 1 ? '' : 's'} on a placeholder that matches a real part
                </span>
              </div>
              <button onClick={() => setMismatchScan(null)} style={{ background: 'none', border: 'none', fontSize: '1.6rem', color: 'var(--ink-soft)', cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ padding: '16px 28px', overflowY: 'auto' }}>
              {mismatchScan.length === 0 ? (
                <div style={{ padding: '30px', textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)', fontSize: '1.2rem' }}>No mismatches found — every BOM pin links to a real part. ✓</div>
              ) : mismatchScan.map(r => {
                const asmName = assemblies.find(a => a.itemId === r.pin.assemblyId)?.itemName || r.pin.assemblyId;
                const matchErp = r.match.legacyErpId && r.match.legacyErpId !== 'PENDING' ? r.match.legacyErpId : (r.match.itemId || r.match.id);
                return (
                  <div key={r.pin.id} style={{ display: 'grid', gridTemplateColumns: '1.3fr 1.3fr auto', gap: '14px', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
                    <div>
                      <div style={{ fontWeight: 500, color: 'var(--ink)', fontSize: '0.9rem' }}>{r.linkedName}</div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', textTransform: 'uppercase' }}>placeholder · in {asmName}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>→ {r.match.itemName}</div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--brass)', textTransform: 'uppercase' }}>{matchErp}</div>
                    </div>
                    <button onClick={() => linkPinToPart(r.pin, r.match)} style={{ padding: '8px 14px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Link →</button>
                  </div>
                );
              })}
            </div>
            {mismatchScan.length > 0 && (
              <div style={{ padding: '14px 28px', borderTop: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                "Link" re-points the pin to the real part. Delete the leftover placeholder parts from the Master Library afterward.
              </div>
            )}
          </div>
        </div>
      )}

      {alignScan !== null && (
        <div onClick={() => setAlignScan(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', width: '900px', maxHeight: '86vh', borderRadius: '2px', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 48px rgba(0,0,0,0.18)' }}>
            <div style={{ padding: '22px 28px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>Flow Alignment Scan</h3>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                  {alignScan.filter(r => r.severity === 'ERROR').length} errors · {alignScan.filter(r => r.severity === 'WARN').length} warnings · {alignScan.filter(r => r.severity === 'INFO').length} info — {selectedAssemblyId ? 'selected assembly' : 'filtered assemblies'} · canonical tag spec (1.5/1.6 ↔ tabs 2/3, CPQ, Vision)
                </span>
              </div>
              <button onClick={() => setAlignScan(null)} style={{ background: 'none', border: 'none', fontSize: '1.6rem', color: 'var(--ink-soft)', cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ padding: '14px 28px', overflowY: 'auto' }}>
              {alignScan.length === 0 ? (
                <div style={{ padding: '30px', textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)', fontSize: '1.2rem' }}>Fully aligned — every cluster, pin, part and flow step reads canonically. ✓</div>
              ) : (
                [...new Set(alignScan.map(r => r.assemblyName))].map(an => (
                  <div key={an} style={{ marginBottom: '14px' }}>
                    <div style={{ fontFamily: 'var(--serif)', fontSize: '1.05rem', color: 'var(--ink)', padding: '6px 0', borderBottom: '1px solid var(--line)' }}>{an}</div>
                    {alignScan.filter(r => r.assemblyName === an).map((r, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 0', borderBottom: '1px dotted var(--line)' }}>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '8px', fontWeight: 700, color: '#fff', background: r.severity === 'ERROR' ? '#b91c1c' : r.severity === 'WARN' ? '#b45309' : 'var(--ink-soft)', padding: '2px 6px', borderRadius: '2px', flexShrink: 0 }}>{r.severity}</span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '8px', color: 'var(--ink-soft)', textTransform: 'uppercase', flexShrink: 0, width: '52px' }}>{r.area}</span>
                        <span style={{ fontSize: '0.83rem', color: 'var(--ink)', flex: 1 }}>{r.text}{(r.count || 1) > 1 && <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--brass)', marginLeft: '6px' }}>×{r.count}</span>}</span>
                        {r.fix && <button onClick={() => applyAlignFix(r)} style={{ padding: '5px 12px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', flexShrink: 0 }}>Fix →</button>}
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
            <div style={{ padding: '12px 28px', borderTop: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
              Fix → applies the suggested tag (cluster or pin). After fixing pins/clusters, REGENERATE the flow (keep prices) so the steps re-stamp from tags.
            </div>
          </div>
        </div>
      )}

      {collectionAudit !== null && (
        <div onClick={() => setCollectionAudit(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', width: '820px', maxHeight: '84vh', borderRadius: '2px', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 48px rgba(0,0,0,0.18)' }}>
            <div style={{ padding: '22px 28px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>Cross-Collection Pin Audit</h3>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                  {collectionAudit.length} part{collectionAudit.length === 1 ? '' : 's'} pinned across / against collections
                </span>
              </div>
              <button onClick={() => setCollectionAudit(null)} style={{ background: 'none', border: 'none', fontSize: '1.6rem', color: 'var(--ink-soft)', cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ padding: '16px 28px', overflowY: 'auto' }}>
              {collectionAudit.length === 0 ? (
                <div style={{ padding: '30px', textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)', fontSize: '1.2rem' }}>No cross-collection pins — every pinned part stays within its collection. ✓</div>
              ) : collectionAudit.map(r => (
                <div key={r.part.id} style={{ padding: '14px 0', borderBottom: '1px solid var(--line)' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 500, color: 'var(--ink)', fontSize: '0.95rem' }}>{r.part.itemName || '(unnamed)'}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--brass)', textTransform: 'uppercase' }}>{r.part.legacyErpId && r.part.legacyErpId !== 'PENDING' ? r.part.legacyErpId : (r.part.itemId || r.part.id)}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', textTransform: 'uppercase' }}>tagged: {r.partCols.length ? r.partCols.join(', ') : '— untagged —'}</span>
                    {r.multiCollection && <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: '#fff', background: '#b45309', padding: '2px 6px', textTransform: 'uppercase' }}>in {r.asmCollections.length} collections</span>}
                    {r.mismatchCount > 0 && <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: '#fff', background: '#b91c1c', padding: '2px 6px', textTransform: 'uppercase' }}>tagged ≠ assembly</span>}
                  </div>
                  <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    {r.asms.map((a, i) => {
                      const ac = a.asmCols.filter(c => c && c !== 'N/A');
                      const mism = ac.length && r.partCols.length && !ac.some(c => r.partCols.includes(c));
                      return (
                        <div key={i} style={{ display: 'flex', gap: '10px', fontSize: '0.82rem', color: mism ? '#b91c1c' : 'var(--ink-soft)' }}>
                          <span style={{ minWidth: '280px' }}>{mism ? '⚠ ' : ''}in <b style={{ fontWeight: 500 }}>{a.asm.itemName || a.asm.itemId}</b></span>
                          <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', paddingTop: '2px' }}>{a.asmCols.length ? a.asmCols.join(', ') : '— untagged —'}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ padding: '14px 28px', borderTop: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
              Read-only. ⚠ = the assembly's collection isn't among the part's tags. Fix by re-pinning in Node Grouping, or add the missing collection tag to the part / assembly in the Master Library.
            </div>
          </div>
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: '16px', borderRadius: '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)' }}>Bill of Materials Engine</h2>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', paddingLeft: '16px', borderLeft: '1px solid var(--line)' }}>{filteredAssemblies.length} Assemblies</span>
              </div>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Global Component Data Sync</span>
          </div>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
              
              <select value={routingFilter} onChange={(e) => setRoutingFilter(e.target.value)} style={{ padding: '10px 12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.9rem', outline: 'none', background: 'var(--paper-2)', minWidth: '150px' }}>
                  <option value="ALL">All Routing Types</option>
                  <option value="UNASSIGNED">Unassigned / Pending</option>
                  {(globalLists.assemblyTypes || []).map(type => (
                      <option key={type} value={type}>{type}</option>
                  ))}
              </select>
              
              {windowConfig.system.prodTypes?.includes(activeBrand) && (
                  <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ padding: '10px 12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.9rem', outline: 'none' }}>
                      <option value="">All Categories</option>
                      {dynamicProdTypes.map(pt => <option key={pt} value={pt}>{pt}</option>)}
                  </select>
              )}

              {windowConfig.system.collections?.includes(activeBrand) && (
                  <select value={collectionFilter} onChange={(e) => setCollectionFilter(e.target.value)} style={{ padding: '10px 12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.9rem', outline: 'none' }}>
                      <option value="">All Collections</option>
                      {dynamicCollections.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
              )}

              {windowConfig.system.watchLists?.includes(activeBrand) && (
                  <select value={watchlistFilter} onChange={(e) => setWatchlistFilter(e.target.value)} style={{ padding: '10px 12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.9rem', outline: 'none' }}>
                      <option value="">All Watchlists</option>
                      <option value="NONE">None / Unassigned</option>
                      {dynamicWatchlists.map(w => <option key={w} value={w}>{w}</option>)}
                  </select>
              )}

              <input placeholder="Search Name, ERP ID..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ width: '200px', padding: '10px 12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.9rem', outline: 'none' }} />

              <button onClick={runMismatchScan} disabled={scanningMismatches} title="Scan every assembly for BOM components linked to a placeholder part that matches a real library part." style={{ padding: '10px 14px', border: '1px solid var(--brass)', background: '#fff', color: 'var(--ink)', cursor: scanningMismatches ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' }}>
                  {scanningMismatches ? 'Scanning…' : '⚲ Find Part Mismatches'}
              </button>

              <button onClick={runCollectionAudit} disabled={auditingCollections} title="Read-only: list every BOM-pinned part that is pinned into assemblies of more than one collection, or into an assembly whose collection its own tag doesn't share. This is what makes Vision/CPQ scope a part out of a flow — review to catch mis-pins." style={{ padding: '10px 14px', border: '1px solid var(--brass)', background: '#fff', color: 'var(--ink)', cursor: auditingCollections ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' }}>
                  {auditingCollections ? 'Auditing…' : '⬖ Cross-Collection Pins'}
              </button>

              <button onClick={runAlignmentScan} disabled={aligningScan} title="Audit every clustered assembly + its CPQ flows against the canonical tag spec: dialect vocab (INSIDE/OPEN vs END/WALL), missing or name-contradicting cluster tags, end choices whose return-ness only lives in a NAME, parts missing bracketType/projection/dims (what Vision reads), and steps Vision can't classify. One-click fixes where safe." style={{ padding: '10px 14px', border: '1px solid var(--brass)', background: '#fff', color: 'var(--ink)', cursor: aligningScan ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' }}>
                  {aligningScan ? 'Scanning…' : '⚖ Flow Alignment Scan'}
              </button>

              <button onClick={async () => {
                  const code = window.prompt('New library item — ERP item # (e.g. H2-75LBE):');
                  if (!code || !code.trim()) return;
                  const erp = code.trim().toUpperCase();
                  const existing = libraryParts.find(p => String(p.legacyErpId || '').toUpperCase() === erp);
                  if (existing) return alert(`"${erp}" already exists in the library: ${existing.itemName || existing.id}. No duplicate created.`);
                  const name = window.prompt('Item name / description:', erp) || erp;
                  const pt = window.prompt('Product type (BRACKET / BACKPLATE / FINIAL / POLE / RING / …):', '') || '';
                  try {
                      await createLibraryPart({ code: erp, name, productType: pt });
                      alert(`✅ Created ${erp}. Fill its specs from any BOM row or the Master Library, then run tab 11's "Push Items → NetSuite" — exact item-id matches LINK (no duplicates), the rest are CREATED in NetSuite.`);
                  } catch (e) { console.error('create failed', e); alert('Create failed — check console.'); }
              }} title="Create a new Master Library item right here (same shape as the 1.6 Item Starter Kit). Sync to NetSuite from tab 11 afterward — exact item-id matches are linked, never duplicated." style={{ padding: '10px 14px', border: '1px solid var(--ink)', background: '#fff', color: 'var(--ink)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' }}>
                  ＋ New Library Item
              </button>

              <button onClick={handleBulkThumbnails} disabled={bulkThumb.running} title="Render + save a thumbnail from the .glb for every filtered assembly that's missing an image (works after clusters are assigned)" style={{ padding: '10px 14px', border: '1px solid var(--ink)', background: bulkThumb.running ? 'var(--ink-soft)' : 'var(--ink)', color: '#fff', cursor: bulkThumb.running ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' }}>
                  {bulkThumb.running ? `⚙ ${bulkThumb.done}/${bulkThumb.total}…` : '🖼 Generate Missing Thumbnails'}
              </button>

              <select value={selectedAssemblyId} onChange={(e) => { setSelectedAssemblyId(e.target.value); setActiveComponent(null); }} style={{ padding: '10px 16px', border: '2px solid var(--ink)', fontFamily: 'var(--sans)', fontSize: '0.95rem', minWidth: '300px', outline: 'none', background: '#fff', marginLeft: 'auto', fontWeight: 500 }}>
                  <option value="" disabled>-- Select Assembly to Edit --</option>
                  {filteredAssemblies.map(a => (
                      <option key={a.id} value={a.itemId}>
                          [{a.routingType ? a.routingType.toUpperCase() : 'UNASSIGNED'}] {a.legacyErpId && a.legacyErpId !== "N/A" && a.legacyErpId !== "PENDING" ? `${a.legacyErpId} : ` : ''}{a.itemName}
                      </option>
                  ))}
              </select>
          </div>
      </div>

      <div style={{ display: 'flex', gap: '24px', alignItems: 'stretch', flex: 1 }}>
        
        <div style={{ width: '380px', background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', flexShrink: 0, borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
            <div style={{ padding: '20px 24px', background: 'var(--paper-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
                <span style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)' }}>Components</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink)', border: '1px solid var(--line)', padding: '4px 8px', borderRadius: '2px', background: '#fff' }}>Cost: ${totalCost.toFixed(2)}</span>
            </div>
            
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px', background: 'var(--paper)' }}>
                {populatedBOM.length === 0 && <div style={{ textAlign: 'center', color: 'var(--ink-soft)', marginTop: '40px', fontStyle: 'italic', fontSize: '0.9rem' }}>No components found. Sync from NetSuite to build BOM.</div>}
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {populatedBOM.map(item => {
                        const isSelected = activeComponent?.id === item.id;
                        const isNew = item.masterPart?.manufacturingSpecs?.status === "NEEDS_SPECS";
                        const master = item.masterPart || {};
                        const specs = master.manufacturingSpecs || {};

                        return (
                            <div 
                                key={item.id} 
                                onClick={() => openComponentEditor(item)}
                                style={{ background: '#fff', border: `1px solid ${isSelected ? 'var(--brass)' : 'var(--line)'}`, display: 'flex', cursor: 'pointer', transition: 'all 0.2s ease', boxShadow: isSelected ? '0 4px 12px rgba(0,0,0,0.05)' : 'none' }}
                            >
                                <div style={{ width: '80px', height: '80px', background: 'var(--paper-2)', borderRight: '1px solid var(--line)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                                    {(item.thumbUrl || master.finalImageUrl || master.componentImageUrl) ? (
                                        <img src={item.thumbUrl || master.finalImageUrl || master.componentImageUrl} alt="Part" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    ) : (
                                        <span style={{ fontSize: '1.2rem', color: 'var(--ink-soft)', opacity: 0.5 }}>⚙️</span>
                                    )}
                                </div>

                                <div style={{ padding: '12px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                        <div style={{ fontWeight: 500, fontSize: '0.95rem', color: 'var(--ink)' }}>{item.partName || master.itemName || item.partId}</div>
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>QTY: {item.defaultQty}</div>
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginTop: '4px' }}>
                                        {/* ERP item # first (the code people actually know), app id only as last resort. */}
                                        <span style={{ color: 'var(--ink)' }}>{(master.legacyErpId && !['PENDING', 'N/A'].includes(master.legacyErpId) && master.legacyErpId)
                                            || (item.legacyErpId && !['PENDING', 'N/A'].includes(item.legacyErpId) && item.legacyErpId)
                                            || item.partId}</span> | {specs.productType || "NO TYPE"}
                                        {/* Cluster placement chips — location · position · hidden, same tags 1.5/1.6 show. */}
                                        {(() => {
                                            const cl = (selectedAssemblyData?.nodeClusters || []).find(c => c.id === item.clusterId);
                                            const chips = cl ? [cl.location, cl.position, cl.hidden ? 'HIDDEN' : ''].filter(Boolean) : [];
                                            return chips.length ? chips.map(t => <span key={t} style={{ fontFamily: 'var(--mono)', fontSize: '8px', textTransform: 'uppercase', border: '1px solid var(--line)', padding: '1px 5px', marginLeft: '6px', color: 'var(--ink-soft)', borderRadius: '2px', letterSpacing: '.04em' }}>{t}</span>) : null;
                                        })()}
                                    </div>
                                    {isNew && <div style={{ fontSize: '9px', fontFamily: 'var(--mono)', color: '#d9534f', textTransform: 'uppercase', marginTop: '6px' }}>Needs Specs</div>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>

        <div style={{ flex: 1, background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
            
            <div style={{ padding: '24px 30px', background: 'var(--paper-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
                <div>
                    <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>
                        {activeComponent ? "Global Part Data" : "Assembly Metadata & Pricing"}
                    </h3>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', marginTop: '4px', display: 'block' }}>
                        {activeComponent ? "Changes made here update the Master Library globally." : "Review and set root metadata for this assembly."}
                    </span>
                </div>
                {activeComponent && <span style={{ background: '#fff', border: '1px solid var(--line)', color: 'var(--ink)', padding: '6px 12px', fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.1em' }}>{activeComponent.masterPart?.legacyErpId || activeComponent.partId}</span>}
            </div>

            <div style={{ padding: '30px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '30px' }}>
                
                {!activeComponent ? (
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                        {selectedAssemblyData ? (
                            <>
                                <div style={{ textAlign: 'center', marginBottom: '40px' }}>
                                    {selectedAssemblyData.finalImageUrl ? (
                                        <img src={selectedAssemblyData.finalImageUrl} alt="Assembly" style={{ maxWidth: '80%', maxHeight: '350px', objectFit: 'contain', border: '1px solid var(--line)', padding: '10px', background: 'var(--paper-2)' }} />
                                    ) : (
                                        <div style={{ height: '200px', background: 'var(--paper-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed var(--line)', color: 'var(--ink-soft)', flexDirection: 'column' }}>
                                            <span style={{ fontFamily: 'var(--sans)', fontSize: '0.9rem' }}>No Image Available</span>
                                            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', marginTop: '10px', color: 'var(--ink-soft)' }}>Capture from the .glb below, or via Visual Engine</span>
                                        </div>
                                    )}
                                    {selectedAssemblyData.manufacturingSpecs?.cadUrl && (
                                        <div style={{ marginTop: '12px', display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                                            <button onClick={handleCaptureAssemblyThumbnail} disabled={capturingThumb} style={{ padding: '10px 20px', background: capturingThumb ? 'var(--ink-soft)' : 'var(--ink)', color: '#fff', border: 'none', cursor: capturingThumb ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                                                {capturingThumb ? '⚙ Capturing…' : (selectedAssemblyData.finalImageUrl ? '⚙ Re-capture Assembly Thumbnail' : '⚙ Capture Assembly Thumbnail')}
                                            </button>
                                            <button onClick={() => setShowSpecSheet(true)} style={{ padding: '10px 20px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                                                📐 Spec Sheets
                                            </button>
                                            {(selectedAssemblyData.instructionSteps?.length > 0 || selectedAssemblyData.manufacturingSpecs?.sopCadUrl) && (
                                                <button onClick={() => setShowSops(true)} title="Shop-floor SOP pages built in Tab .6 (Interactive 3D Instructions)" style={{ padding: '10px 20px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                                                    📋 Shop SOPs
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Static shop drawing (Stuart 2026-07-15): ONE drawn PDF per mainline assembly —
                                    standing rules/drawings/notes that apply to EVERY job under it (not generated
                                    from CPQ jobs). The shop floor Custom tab shows a 📄 Drawing button next to
                                    View Item whenever an order's cart lines point at an assembly that has one. */}
                                <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: '2px', padding: '14px 20px', marginBottom: '30px', display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
                                    <div style={{ flex: 1, minWidth: '220px' }}>
                                        <label style={labelStyle}>Static Shop Drawing (floor PDF)</label>
                                        <span style={{ fontFamily: 'var(--sans)', fontSize: '0.82rem', color: 'var(--ink-soft)', display: 'block' }}>
                                            {selectedAssemblyData.staticShopDrawing?.url
                                                ? <>Attached: <b>{selectedAssemblyData.staticShopDrawing.name || 'drawing.pdf'}</b> — every custom-floor job under this assembly gets a 📄 Drawing button.</>
                                                : 'Attach a drawn PDF with the standing rules, drawings and notes for every job under this mainline assembly — the shop floor Custom tab gets a 📄 Drawing button next to View Item.'}
                                        </span>
                                    </div>
                                    {selectedAssemblyData.staticShopDrawing?.url && (
                                        <>
                                            <a href={selectedAssemblyData.staticShopDrawing.url} target="_blank" rel="noreferrer" style={{ padding: '10px 18px', background: 'var(--ink)', color: '#fff', textDecoration: 'none', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>📄 View</a>
                                            <button onClick={async () => {
                                                if (!window.confirm('Remove the static shop drawing from this assembly?\n\nThe floor button disappears; the file itself stays in storage.')) return;
                                                try { await updateDoc(doc(db, 'Approved_Designs', selectedAssemblyData.id), { staticShopDrawing: deleteField() }); } catch (err) { alert('Failed: ' + (err.message || err)); }
                                            }} style={{ padding: '10px 14px', background: 'transparent', color: '#d9534f', border: '1px solid #d9534f', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>× Remove</button>
                                        </>
                                    )}
                                    <label style={{ padding: '10px 18px', background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', cursor: uploadingDrawing ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                                        {uploadingDrawing ? 'Uploading…' : (selectedAssemblyData.staticShopDrawing?.url ? 'Replace PDF' : '⇪ Attach PDF')}
                                        <input type="file" accept="application/pdf" style={{ display: 'none' }} disabled={uploadingDrawing} onChange={async (e) => {
                                            const file = e.target.files && e.target.files[0]; e.target.value = '';
                                            if (!file) return;
                                            if (file.type !== 'application/pdf') { alert('PDF only.'); return; }
                                            setUploadingDrawing(true);
                                            try {
                                                const sref = ref(storage, `shop_drawings/${activeBrand}_${selectedAssemblyData.itemId}_${Date.now()}.pdf`);
                                                await uploadBytes(sref, file, { contentType: 'application/pdf' });
                                                const url = await getDownloadURL(sref);
                                                await updateDoc(doc(db, 'Approved_Designs', selectedAssemblyData.id), { staticShopDrawing: { url, name: file.name, uploadedAt: Date.now() } });
                                                alert('✓ Shop drawing attached — live on the custom floor for every job under this assembly.');
                                            } catch (err) { alert('Upload failed: ' + (err.message || err)); }
                                            setUploadingDrawing(false);
                                        }} />
                                    </label>
                                </div>

                                {/* Customer onboarding / price-list export — one branded .xlsx for this assembly. */}
                                <div style={{ background: 'var(--paper)', border: '1px solid var(--brass)', borderRadius: '2px', padding: '18px 20px', marginBottom: '30px', display: 'flex', gap: '14px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                    <div style={{ flex: 1, minWidth: '220px' }}>
                                        <label style={{ ...labelStyle, color: 'var(--brass)' }}>Customer Onboarding Sheet</label>
                                        <span style={{ fontFamily: 'var(--sans)', fontSize: '0.82rem', color: 'var(--ink-soft)', display: 'block' }}>Branded price list of this assembly's items (thumbnail · ERP id · description · price), grouped by tag, with the configurator's finishes across the top. Hidden-tagged parts are omitted.</span>
                                    </div>
                                    <div style={{ minWidth: '220px' }}>
                                        <label style={labelStyle}>Customer pricing (optional)</label>
                                        <select value={onboardCustomerId} onChange={e => setOnboardCustomerId(e.target.value)} style={fieldStyle}>
                                            <option value="">List price only</option>
                                            {customersData.map(c => <option key={c.id} value={c.id}>{(c.companyName || c.name || c.id)}</option>)}
                                        </select>
                                    </div>
                                    <button onClick={handleGenerateOnboarding} disabled={onboarding} style={{ padding: '11px 22px', background: onboarding ? 'var(--ink-soft)' : 'var(--ink)', color: '#fff', border: 'none', cursor: onboarding ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' }}>
                                        {onboarding ? '⚙ Building…' : '⬇ Generate Excel'}
                                    </button>
                                    <button onClick={handleMasterBomScan} title="Audit this assembly's BOM: ghost pins that resolve to no library item, orphan/duplicate pins, clusters contributing zero BOM lines, retired parts, missing prices and missing /P paint variants, missing product types. Read-only." style={{ padding: '11px 22px', background: 'transparent', color: 'var(--brass)', border: '1px solid var(--brass)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' }}>
                                        🔍 Master BOM Scan
                                    </button>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>

                                    <div>
                                        <h4 style={sectionHeaderStyle}>Parent Assembly Details</h4>
                                        
                                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '20px', marginBottom: '20px' }}>
                                            <div><label style={labelStyle}>Assembly Name</label><input name="itemName" value={assemblyDetails.itemName} onChange={handleAssemblySpecChange} style={fieldStyle} /></div>
                                            <div><label style={labelStyle}>ERP ID</label><input name="legacyErpId" value={assemblyDetails.legacyErpId} onChange={handleAssemblySpecChange} placeholder="PENDING" style={{ ...fieldStyle, textTransform: 'uppercase' }} /></div>
                                            <div><label style={labelStyle}>BOM Revision</label><input name="bomRevision" value={assemblyDetails.bomRevision || ''} onChange={handleAssemblySpecChange} placeholder="e.g. Rev A" style={fieldStyle} /></div>
                                        </div>

                                        <div style={{ marginBottom: '20px' }}>
                                            <label style={labelStyle}>Warehouse Bin Location (Barcode/Ref)</label>
                                            <input name="binLocation" value={assemblyDetails.binLocation} onChange={handleAssemblySpecChange} placeholder="e.g. KIT-SHELF-B" style={{ ...fieldStyle, textTransform: 'uppercase' }} />
                                        </div>

                                        <div style={{ background: 'var(--paper-2)', padding: '20px', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: '15px' }}>
                                            <input type="checkbox" checked={assemblyDetails.isProjectManaged} onChange={e => setAssemblyDetails({...assemblyDetails, isProjectManaged: e.target.checked})} style={{ transform: 'scale(1.2)', cursor: 'pointer' }} />
                                            <div>
                                                <div style={{ fontFamily: 'var(--sans)', fontSize: '0.95rem', fontWeight: 500, color: 'var(--ink)' }}>Flag as Complex Project (Route to Project Mgmt)</div>
                                                <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '4px' }}>Checking this box ensures that when this product is quoted/ordered, it routes to the Project Management dashboard for multi-WO/PO dissection.</div>
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <h4 style={sectionHeaderStyle}>Client-Specific Pricing & SKUs</h4>
                                        <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-end', marginBottom: '20px' }}>
                                            <div style={{ flex: 2 }}>
                                                <label style={labelStyle}>Customer (Name - ID)</label>
                                                <select value={newClientPricing.customerId} onChange={e => setNewClientPricing({...newClientPricing, customerId: e.target.value})} style={fieldStyle}>
                                                    <option value="">Select Customer...</option>
                                                    {customersData.length > 0 ? (
                                                        customersData.map(c => <option key={c.id} value={c.id}>{c.companyName || c.name} - {c.id}</option>)
                                                    ) : (
                                                        (globalLists.customers || []).map((c, idx) => {
                                                            const val = typeof c === 'string' ? c : c.id;
                                                            return <option key={val || idx} value={val}>{getCustomerDisplay(val)}</option>
                                                        })
                                                    )}
                                                </select>
                                            </div>
                                            <div style={{ flex: 2 }}>
                                                <label style={labelStyle}>Client SKU / Part #</label>
                                                <input value={newClientPricing.clientSku} onChange={e => setNewClientPricing({...newClientPricing, clientSku: e.target.value})} placeholder="e.g. Brimar-8483" style={fieldStyle} />
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <label style={labelStyle}>Custom Price ($)</label>
                                                <input type="number" step="0.01" value={newClientPricing.price} onChange={e => setNewClientPricing({...newClientPricing, price: e.target.value})} placeholder="0.00" style={fieldStyle} />
                                            </div>
                                            <button onClick={() => handleAddClientPricing(true)} style={{ padding: '10px 20px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Add</button>
                                        </div>
                                        
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            {(assemblyDetails.clientPricing || []).length === 0 && <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No custom client pricing assigned. Defaults to Base Price.</div>}
                                            {(assemblyDetails.clientPricing || []).map((cp, idx) => (
                                                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--paper)', border: '1px solid var(--line)', padding: '12px 16px' }}>
                                                    <div style={{ display: 'flex', gap: '24px', fontSize: '0.9rem', width: '100%', alignItems: 'center', color: 'var(--ink)' }}>
                                                        <span style={{ fontWeight: 500, flex: 1 }}>{getCustomerDisplay(cp.customerId)}</span>
                                                        <span style={{ flex: 1, color: 'var(--ink-soft)' }}>SKU: <span style={{ color: 'var(--ink)' }}>{cp.clientSku || 'N/A'}</span></span>
                                                        <span style={{ fontWeight: 500, width: '80px', textAlign: 'right' }}>${parseFloat(cp.price || 0).toFixed(2)}</span>
                                                    </div>
                                                    <button onClick={() => handleRemoveClientPricing(idx, true)} style={{ background: 'none', border: 'none', color: '#d9534f', fontSize: '1.2rem', cursor: 'pointer', marginLeft: '16px' }}>×</button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div>
                                        <h4 style={sectionHeaderStyle}>Record Visibility & Sharing</h4>
                                        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', padding: '20px', background: 'var(--paper-2)', border: '1px solid var(--line)' }}>
                                            {AVAILABLE_BRANDS.map(brand => {
                                                const isOwner = selectedAssemblyData.brandId === brand.id; 
                                                const isShared = assemblyDetails.sharedBrands?.includes(brand.id);
                                                return ( 
                                                    <label key={brand.id} style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px', cursor: isOwner ? 'not-allowed' : 'pointer', opacity: isOwner ? 0.6 : 1, color: 'var(--ink)' }}>
                                                        <input type="checkbox" checked={isOwner || isShared} disabled={isOwner} onChange={() => handleBrandToggle(brand.id, true)} />
                                                        {brand.name} {isOwner && "(Owner)"}
                                                    </label> 
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div>
                                        <h4 style={sectionHeaderStyle}>Classification & Attributes</h4>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                            
                                            <div>
                                                <label style={labelStyle}>Product Type</label>
                                                <select name="productType" value={String(assemblyDetails.productType || "").toUpperCase()} onChange={handleAssemblySpecChange} style={fieldStyle}>
                                                    <option value="">Select...</option>
                                                    {(globalLists.prodTypes || []).map(pt => <option key={pt} value={String(pt).toUpperCase()}>{pt}</option>)}
                                                    {renderOptionFallback(assemblyDetails.productType, globalLists.prodTypes)}
                                                </select>
                                            </div>
                                            <div>
                                                <label style={labelStyle}>Routing Classification</label>
                                                <select name="routingType" value={String(assemblyDetails.routingType || "").toUpperCase()} onChange={handleAssemblySpecChange} style={{ ...fieldStyle, textTransform: 'uppercase' }}>
                                                    <option value="">Unassigned</option>
                                                    {(globalLists.assemblyTypes || []).map(t => <option key={t} value={String(t).toUpperCase()}>{t}</option>)}
                                                    {renderOptionFallback(assemblyDetails.routingType, globalLists.assemblyTypes)}
                                                </select>
                                            </div>
                                            <div><label style={labelStyle}>Project / Grouping</label><input name="project" value={assemblyDetails.project || ""} onChange={handleAssemblySpecChange} style={fieldStyle} /></div>

                                            {windowConfig.system.partHandling?.includes(activeBrand) && (
                                                <div>
                                                    <label style={labelStyle}>Part Handling</label>
                                                    <select name="partHandling" value={String(assemblyDetails.partHandling || "").toUpperCase()} onChange={handleAssemblySpecChange} style={fieldStyle}>
                                                        <option value="">Unassigned / Standard</option>
                                                        {(globalLists.partHandling || []).map(ph => <option key={ph} value={String(ph).toUpperCase()}>{ph}</option>)}
                                                        {renderOptionFallback(assemblyDetails.partHandling, globalLists.partHandling)}
                                                    </select>
                                                </div>
                                            )}

                                            <div>
                                                <label style={labelStyle}>UOM</label>
                                                <select name="uom" value={String(assemblyDetails.uom || "EA").toUpperCase()} onChange={handleAssemblySpecChange} style={fieldStyle}>
                                                    <option value="">Select...</option>
                                                    {(globalLists.uom || []).map(u => <option key={u} value={String(u).toUpperCase()}>{u}</option>)}
                                                    {renderOptionFallback(assemblyDetails.uom, globalLists.uom)}
                                                </select>
                                            </div>
                                            
                                            {windowConfig.system.collections?.includes(activeBrand) && (
                                                <div style={{ gridColumn: 'span 2' }}>
                                                    <label style={labelStyle}>Collections (Multi-Select for CPQ)</label>
                                                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', padding: '16px', border: '1px solid var(--line)', background: 'var(--paper)', maxHeight: '150px', overflowY: 'auto' }}>
                                                        {collectionsData.length === 0 && <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No collections defined in Admin.</span>}
                                                        {collectionsData.map(c => {
                                                            const isSelected = (assemblyDetails.collections || []).includes(c.name);
                                                            return (
                                                                <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', cursor: 'pointer', background: isSelected ? 'var(--ink)' : '#fff', color: isSelected ? '#fff' : 'var(--ink)', border: `1px solid ${isSelected ? 'var(--ink)' : 'var(--line)'}`, padding: '6px 14px', borderRadius: '20px', transition: 'all 0.2s' }}>
                                                                    <input type="checkbox" checked={isSelected} onChange={() => handleToggleCollection(c.name, true)} style={{ display: 'none' }} />
                                                                    {c.name}
                                                                </label>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                            
                                            {windowConfig.system.pillowSizes?.includes(activeBrand) && (
                                                <div><label style={labelStyle}>Pillow Size</label><select name="pillowSize" value={assemblyDetails.pillowSize || ""} onChange={handleAssemblySpecChange} style={fieldStyle}><option value="">Select...</option>{(globalLists.pillowSizes || []).map(x => <option key={x} value={x}>{x}</option>)}</select></div>
                                            )}
                                            {windowConfig.system.fillTypes?.includes(activeBrand) && (
                                                <div><label style={labelStyle}>Fill Type</label><select name="fillType" value={assemblyDetails.fillType || ""} onChange={handleAssemblySpecChange} style={fieldStyle}><option value="">Select...</option>{(globalLists.fillTypes || []).map(x => <option key={x} value={x}>{x}</option>)}</select></div>
                                            )}
                                            {windowConfig.system.flangeStyles?.includes(activeBrand) && (
                                                <div><label style={labelStyle}>Edge/Flange</label><select name="flangeStyle" value={assemblyDetails.flangeStyle || ""} onChange={handleAssemblySpecChange} style={fieldStyle}><option value="">Select...</option>{(globalLists.flangeStyles || []).map(x => <option key={x} value={x}>{x}</option>)}</select></div>
                                            )}
                                            {windowConfig.system.stitchTypes?.includes(activeBrand) && (
                                                <div><label style={labelStyle}>Stitch Routing</label><select name="stitchType" value={assemblyDetails.stitchType || ""} onChange={handleAssemblySpecChange} style={fieldStyle}><option value="">Select...</option>{(globalLists.stitchTypes || []).map(x => <option key={x} value={x}>{x}</option>)}</select></div>
                                            )}
                                            {windowConfig.system.seamCounts?.includes(activeBrand) && (
                                                <div><label style={labelStyle}>Seam Count</label><select name="seamCount" value={assemblyDetails.seamCount || ""} onChange={handleAssemblySpecChange} style={fieldStyle}><option value="">Select...</option>{(globalLists.seamCounts || []).map(x => <option key={x} value={x}>{x}</option>)}</select></div>
                                            )}
                                            {windowConfig.system.outsourceActions?.includes(activeBrand) && (
                                                <div>
                                                    <label style={labelStyle}>Outsource Action</label>
                                                    <select name="outsourceAction" value={String(assemblyDetails.outsourceAction || "").toUpperCase()} onChange={handleAssemblySpecChange} style={fieldStyle}>
                                                        <option value="">Select...</option>
                                                        {(globalLists.outsourceActions || []).map(x => <option key={x} value={String(x).toUpperCase()}>{x}</option>)}
                                                        {renderOptionFallback(assemblyDetails.outsourceAction, globalLists.outsourceActions)}
                                                    </select>
                                                </div>
                                            )}
                                            
                                            {windowConfig.custom.filter(w => (w.brands || []).includes(activeBrand)).map(w => (
                                                <div key={w.id}>
                                                    <label style={labelStyle}>{w.name}</label>
                                                    <select value={assemblyDetails.dynamicDicts?.[w.id] || ""} onChange={(e) => handleAssemblyDictChange(w.id, e.target.value)} style={fieldStyle}>
                                                        <option value="">Select...</option><option value="N/A">N/A</option>
                                                        {dynamicAssets.filter(a => a.windowId === w.id).map(a => <option key={a.id} value={a.name}>{a.name} {a.code ? `(${a.code})` : ''}</option>)}
                                                    </select>
                                                </div>
                                            ))}

                                            {customSchema.map(field => (
                                                <div key={field.key}>
                                                    <label style={labelStyle}>{field.label} (Custom)</label>
                                                    {field.type === 'dropdown' ? (
                                                        <select value={assemblyDetails.customData?.[field.key] || ""} onChange={(e) => handleAssemblyCustomFieldChange(field.key, e.target.value)} style={fieldStyle}>
                                                            <option value="">Select...</option>{(field.options || "").split(',').map(opt => <option key={opt.trim()} value={opt.trim()}>{opt.trim()}</option>)}
                                                        </select>
                                                    ) : field.type === 'file' ? (
                                                        <div style={{ background: 'var(--paper)', padding: '12px', border: '1px solid var(--line)' }}>
                                                            {assemblyDetails.customData?.[field.key] && <a href={assemblyDetails.customData[field.key]} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem', color: 'var(--ink)', textDecoration: 'underline', display: 'block', marginBottom: '8px' }}>View Current File</a>}
                                                            <input type="file" onChange={(e) => handleDynamicFileUpload(field.key, e.target.files[0], true)} style={{ fontSize: '0.85rem', fontFamily: 'var(--sans)' }} />
                                                        </div>
                                                    ) : (
                                                        <input type={field.type} value={assemblyDetails.customData?.[field.key] || ""} onChange={(e) => handleAssemblyCustomFieldChange(field.key, e.target.value)} style={fieldStyle} />
                                                    )}
                                                </div>
                                            ))}

                                            <div style={{ gridColumn: 'span 2' }}>
                                                <label style={labelStyle}>Assign to Watchlist</label>
                                                <select name="watchList" value={assemblyDetails.watchList || "NONE"} onChange={handleAssemblySpecChange} style={fieldStyle}>
                                                    <option value="NONE">None</option>
                                                    {(globalLists.watchLists || []).map(w => <option key={w} value={w}>{w}</option>)}
                                                </select>
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <h4 style={sectionHeaderStyle}>Hardware CPQ Metadata (Vision Engine)</h4>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', background: 'var(--paper-2)', padding: '24px', border: '1px solid var(--line)' }}>
                                            <div>
                                                <label style={labelStyle}>Bracket Projection (Inches)</label>
                                                <select value={String(assemblyDetails.customData?.projection || "").toUpperCase()} onChange={(e) => handleAssemblyCustomFieldChange("projection", e.target.value)} style={fieldStyle}>
                                                    <option value="">-- No Projection / Not Bracket --</option>
                                                    {(globalLists.projections || []).map(p => <option key={p} value={String(p).toUpperCase()}>{p}" Projection</option>)}
                                                    {renderOptionFallback(assemblyDetails.customData?.projection, globalLists.projections)}
                                                </select>
                                            </div>
                                            <div>
                                                <label style={labelStyle}>Bracket Mount Type</label>
                                                <select value={String(assemblyDetails.customData?.bracketType || "").toUpperCase()} onChange={(e) => handleAssemblyCustomFieldChange("bracketType", e.target.value)} style={fieldStyle}>
                                                    <option value="">-- Not a Bracket --</option>
                                                    {(globalLists.bracketMounts || []).map(m => <option key={m} value={String(m).toUpperCase()}>{m}</option>)}
                                                    {renderOptionFallback(assemblyDetails.customData?.bracketType, globalLists.bracketMounts)}
                                                </select>
                                            </div>
                                            <div style={{ gridColumn: 'span 2' }}>
                                                <label style={labelStyle}>Service / Fee Type (Auto-Append)</label>
                                                <select value={String(assemblyDetails.customData?.feeType || "").toUpperCase()} onChange={(e) => handleAssemblyCustomFieldChange("feeType", e.target.value)} style={fieldStyle}>
                                                    <option value="">-- No Special Fee --</option>
                                                    {(globalLists.feeTypes || []).map(f => <option key={f} value={String(f).toUpperCase()}>{f}</option>)}
                                                    {renderOptionFallback(assemblyDetails.customData?.feeType, globalLists.feeTypes)}
                                                </select>
                                                <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', display: 'block', marginTop: '6px' }}>If selected, the Vision System will automatically bill for this item when triggered.</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <h4 style={sectionHeaderStyle}>Pricing, Logistics & Documents</h4>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', marginBottom: '30px' }}>
                                            <div>
                                                <label style={labelStyle}>Assembly Base Price ($)</label>
                                                <input name="basePrice" type="number" step="0.01" value={assemblyDetails.basePrice} onChange={handleAssemblySpecChange} placeholder="0.00" style={fieldStyle} />
                                                <span style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', display: 'block', marginTop: '4px' }}>Standalone CPQ Base Price</span>
                                            </div>
                                            <div>
                                                <label style={labelStyle}>Assembly Unit Cost ($)</label>
                                                <input name="cost" type="number" step="0.01" value={assemblyDetails.cost} onChange={handleAssemblySpecChange} placeholder="0.00" style={fieldStyle} />
                                                <span style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', display: 'block', marginTop: '4px' }}>Internal Cost (Optional)</span>
                                            </div>
                                            <div>
                                                <label style={labelStyle}>Weight (lbs)</label>
                                                <input name="weight" type="number" step="0.01" value={assemblyDetails.weight || ""} onChange={handleAssemblySpecChange} placeholder="0.00" style={fieldStyle} />
                                                <span style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', display: 'block', marginTop: '4px' }}>Total Assembly Weight</span>
                                            </div>
                                        </div>
                                        
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', background: 'var(--paper)', padding: '24px', border: '1px solid var(--line)' }}>
                                            <div>
                                                <label style={labelStyle}>Upload Master Print (PDF)</label>
                                                {assemblyDetails.pdfUrl && <a href={assemblyDetails.pdfUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem', color: 'var(--ink)', textDecoration: 'underline', display: 'block', marginBottom: '10px' }}>View Current PDF</a>}
                                                <input type="file" accept="application/pdf" onChange={(e) => setAssemblyPdfFile(e.target.files[0])} style={{ fontSize: '0.85rem', fontFamily: 'var(--sans)' }} />
                                            </div>
                                            <div>
                                                <label style={labelStyle}>Master 3D CAD (.glb)</label>
                                                {assemblyDetails.cadUrl ? (
                                                    <div style={{ marginBottom: '10px' }}>
                                                        <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginBottom: '6px' }}>Synced from Inception</div>
                                                        <a href={assemblyDetails.cadUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem', color: 'var(--ink)', textDecoration: 'underline', display: 'block' }}>Download Current .GLB</a>
                                                    </div>
                                                ) : (
                                                    <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginBottom: '10px' }}>No 3D Model Found</div>
                                                )}
                                                <input type="file" accept=".glb" onChange={(e) => setAssemblyCadFile(e.target.files[0])} style={{ fontSize: '0.85rem', fontFamily: 'var(--sans)' }} />
                                            </div>
                                        </div>
                                    </div>

                                    <button onClick={saveAssemblyDetails} style={{ padding: '16px', background: isSaving ? 'var(--brass-light)' : 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'background 0.2s' }}>
                                        {isSaving ? "Saving..." : "Save Assembly Metadata & Files"}
                                    </button>
                                </div>
                                <div style={{ textAlign: 'center', marginTop: '30px', fontSize: '0.9rem', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)' }}>Select a component from the BOM list on the left to edit its global master data.</div>
                            </>
                        ) : (
                            <div style={{ color: 'var(--ink-soft)', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontStyle: 'italic', textAlign: 'center', marginTop: '100px' }}>Awaiting Assembly Selection</div>
                        )}
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                        {/* Re-point this BOM pin to the correct existing library part (CAD-node carryover fix) */}
                        <div style={{ background: '#fff', border: '1px solid var(--brass)', padding: '20px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                    <h4 style={{ ...sectionHeaderStyle, margin: 0 }}>Linked Library Part</h4>
                                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                                        {activeComponent.masterPart?.itemName} · {activeComponent.masterPart?.legacyErpId && activeComponent.masterPart.legacyErpId !== 'PENDING' ? activeComponent.masterPart.legacyErpId : activeComponent.partId}
                                    </span>
                                </div>
                                <button onClick={() => { setReassignOpen(o => !o); setReassignSearch(""); }} style={{ padding: '8px 14px', background: reassignOpen ? 'var(--paper-2)' : 'var(--ink)', color: reassignOpen ? 'var(--ink)' : '#fff', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                                    {reassignOpen ? 'Cancel' : '⇄ Reassign to existing part'}
                                </button>
                            </div>
                            {reassignOpen && (() => {
                                const term = reassignSearch.trim().toLowerCase();
                                const matches = term.length < 2 ? [] : libraryParts
                                    .filter(p => p.id !== activeComponent.partId && p.itemId !== activeComponent.partId)
                                    .filter(p => (p.itemName || '').toLowerCase().includes(term) || (p.legacyErpId || '').toLowerCase().includes(term) || (p.itemId || '').toLowerCase().includes(term))
                                    .slice(0, 30);
                                return (
                                    <div style={{ marginTop: '16px' }}>
                                        <input autoFocus value={reassignSearch} onChange={e => setReassignSearch(e.target.value)} placeholder="Search Master Library by name or ERP ID…" style={{ ...fieldStyle, marginBottom: '10px' }} />
                                        <div style={{ maxHeight: '240px', overflowY: 'auto', border: '1px solid var(--line)' }}>
                                            {term.length < 2 ? (
                                                <div style={{ padding: '14px', fontSize: '0.85rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>Type at least 2 characters to search.</div>
                                            ) : matches.length === 0 ? (
                                                <div style={{ padding: '14px', fontSize: '0.85rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No library parts match.</div>
                                            ) : matches.map(p => (
                                                <div key={p.id} onClick={() => reassignComponentPart(p)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--line)', cursor: 'pointer' }} onMouseOver={e => e.currentTarget.style.background = 'var(--paper-2)'} onMouseOut={e => e.currentTarget.style.background = '#fff'}>
                                                    <div>
                                                        <div style={{ fontWeight: 500, color: 'var(--ink)', fontSize: '0.9rem' }}>{p.itemName}</div>
                                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', textTransform: 'uppercase' }}>{p.legacyErpId && p.legacyErpId !== 'PENDING' ? p.legacyErpId : (p.itemId || p.id)} · {p.manufacturingSpecs?.productType || 'NO TYPE'}</div>
                                                    </div>
                                                    <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--brass)', textTransform: 'uppercase' }}>Link →</span>
                                                </div>
                                            ))}
                                        </div>
                                        <p style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', marginTop: '8px', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                                            Re-points this BOM pin (keeps its position). Afterward, delete the leftover placeholder part from the library.
                                        </p>
                                    </div>
                                );
                            })()}
                        </div>

                        <div style={{ background: 'var(--paper-2)', border: '1px solid var(--line)', padding: '24px' }}>
                            <h4 style={sectionHeaderStyle}>CPQ Configuration Mapping</h4>
                            <p style={{ fontSize: '0.9rem', color: 'var(--ink-soft)', marginBottom: '20px', lineHeight: '1.5' }}>
                                If this component is highly configurable, do not assign a single fixed texture. Instead, map it to a CPQ Option Category below so the customer can configure it at checkout.
                            </p>
                            
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', background: '#fff', padding: '20px', border: '1px solid var(--line)' }}>
                                <label style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', color: 'var(--ink)' }}>
                                    <input type="checkbox" checked={editSpecs.cpqCategories?.includes('master_finishes')} onChange={() => handleCpqCategoryToggle('master_finishes')} />
                                    Master Finishes (Global Metals/Wood)
                                </label>
                                
                                {windowConfig.custom.filter(w => w.brands.includes(activeBrand)).map(w => (
                                    <label key={w.id} style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', color: 'var(--ink)' }}>
                                        <input type="checkbox" checked={editSpecs.cpqCategories?.includes(w.id)} onChange={() => handleCpqCategoryToggle(w.id)} />
                                        {w.name}
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div>
                            <h4 style={sectionHeaderStyle}>Identification & Logistics</h4>
                            
                            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '20px', marginBottom: '20px' }}>
                                <div><label style={labelStyle}>Record Name / Description</label><input name="tempName" value={editSpecs.tempName !== undefined ? editSpecs.tempName : activeComponent.masterPart.itemName} onChange={handleSpecChange} style={fieldStyle} /></div>
                                <div><label style={labelStyle}>ERP Legacy ID</label><input name="tempLegacyId" value={editSpecs.tempLegacyId !== undefined ? editSpecs.tempLegacyId : (activeComponent.masterPart.legacyErpId === "PENDING" ? "" : activeComponent.masterPart.legacyErpId)} onChange={handleSpecChange} placeholder="e.g. P-1234" style={{ ...fieldStyle, textTransform: 'uppercase' }} /></div>
                                <div><label style={labelStyle}>BOM Revision</label><input name="bomRevision" value={editSpecs.bomRevision || ''} onChange={handleSpecChange} placeholder="N/A" style={fieldStyle} /></div>
                            </div>

                            <div style={{ marginBottom: '30px' }}>
                                <label style={labelStyle}>Warehouse Bin Location (Barcode/Ref)</label>
                                <input name="binLocation" value={editSpecs.binLocation || ""} onChange={handleSpecChange} placeholder="e.g. A1-B2-04" style={{ ...fieldStyle, textTransform: 'uppercase' }} />
                                <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginTop: '6px' }}>Used by the Pick/Pack App to guide operators to the physical item location.</div>
                            </div>

                            {/* Three-way sourcing — same vocabulary as the Master Library editor
                                (Shared/sourcing.js). BOTH = we make it AND buy it; it shows both
                                field sets and Stock View asks PO-or-WO at order time. */}
                            <div style={{ display: 'flex', gap: '15px', marginBottom: '20px' }}>
                                {[SOURCING.IN, SOURCING.OUT, SOURCING.BOTH].map(mode => {
                                    const on = sourcingOf(editSpecs) === mode;
                                    const label = mode === SOURCING.IN ? 'In-House Manufacturing' : mode === SOURCING.OUT ? 'Outsourced / Vendor' : 'Both';
                                    return <button key={mode} onClick={() => setEditSpecs({ ...editSpecs, ...sourcingPatch(mode) })} style={{ flex: 1, padding: '12px', background: on ? 'var(--ink)' : 'transparent', color: on ? '#fff' : 'var(--ink)', border: '1px solid var(--ink)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>{label}</button>;
                                })}
                            </div>

                            <div style={{ background: 'var(--paper-2)', padding: '24px', border: '1px solid var(--line)' }}>
                                {sourcingOf(editSpecs) === SOURCING.BOTH && <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '12px' }}>⚒ Made here</div>}
                                {sourcingOf(editSpecs) !== SOURCING.OUT && (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                                        <div><label style={labelStyle}>Program #</label><input name="programNum" value={editSpecs.programNum || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                                        <div><label style={labelStyle}>Raw Mat</label><input name="material" value={editSpecs.material || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                                        {sourcingOf(editSpecs) !== SOURCING.BOTH && <div><label style={labelStyle}>Weight (lbs)</label><input name="weight" type="number" step="0.01" value={editSpecs.weight || ""} onChange={handleSpecChange} style={fieldStyle} /></div>}
                                        {sourcingOf(editSpecs) !== SOURCING.BOTH && <div><label style={labelStyle}>Base Price ($)</label><input name="basePrice" type="number" step="0.01" value={editSpecs.basePrice || ""} onChange={handleSpecChange} style={fieldStyle} /></div>}
                                        {sourcingOf(editSpecs) !== SOURCING.BOTH && <div><label style={labelStyle}>Base Cost ($)</label><input name="cost" type="number" step="0.01" value={editSpecs.cost || ""} onChange={handleSpecChange} style={fieldStyle} /></div>}
                                        {sourcingOf(editSpecs) !== SOURCING.BOTH && <div><label style={labelStyle}>Reorder Pt (ROP)</label><input name="reorderPoint" type="number" value={editSpecs.reorderPoint || ""} onChange={handleSpecChange} style={fieldStyle} /></div>}
                                    </div>
                                )}
                                {sourcingOf(editSpecs) === SOURCING.BOTH && <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', margin: '24px 0 12px', paddingTop: '20px', borderTop: '1px solid var(--line)' }}>🏷 Bought — vendor</div>}
                                {sourcingOf(editSpecs) !== SOURCING.IN && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '15px' }}>
                                            <div><label style={labelStyle}>Vendor Name</label><select name="vendorName" value={editSpecs.vendorName || ""} onChange={handleSpecChange} style={fieldStyle}><option value="">Select Vendor...</option>{(globalLists.vendors || []).map(v => <option key={v} value={v}>{v}</option>)}</select></div>
                                            <div><label style={labelStyle}>Vendor Part # / SKU</label><input name="vendorId" value={editSpecs.vendorId || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                                            <div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between' }}><label style={labelStyle}>Purchase Link (URL)</label>{editSpecs.vendorUrl && <a href={editSpecs.vendorUrl.startsWith('http') ? editSpecs.vendorUrl : `https://${editSpecs.vendorUrl}`} target="_blank" rel="noreferrer" style={{ fontSize: '0.8rem', color: 'var(--ink)' }}>Open ↗</a>}</div>
                                                <input name="vendorUrl" value={editSpecs.vendorUrl || ""} onChange={handleSpecChange} placeholder="https://..." style={fieldStyle} />
                                            </div>
                                            <div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between' }}><label style={labelStyle}>Alt Item Link (URL)</label>{editSpecs.altVendorUrl && <a href={editSpecs.altVendorUrl.startsWith('http') ? editSpecs.altVendorUrl : `https://${editSpecs.altVendorUrl}`} target="_blank" rel="noreferrer" style={{ fontSize: '0.8rem', color: 'var(--ink)' }}>Open ↗</a>}</div>
                                                <input name="altVendorUrl" value={editSpecs.altVendorUrl || ""} onChange={handleSpecChange} placeholder="https://..." style={fieldStyle} />
                                            </div>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '15px' }}>
                                            <div><label style={labelStyle}>Base Price ($)</label><input name="basePrice" type="number" step="0.01" value={editSpecs.basePrice || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                                            <div><label style={labelStyle}>Base Cost ($)</label><input name="cost" type="number" step="0.01" value={editSpecs.cost || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                                            <div><label style={labelStyle}>Weight (lbs)</label><input name="weight" type="number" step="0.01" value={editSpecs.weight || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                                            <div><label style={labelStyle}>MOQ</label><input name="moq" type="number" value={editSpecs.moq || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                                            <div><label style={labelStyle}>Lead (Days)</label><input name="leadTime" type="number" value={editSpecs.leadTime || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                                            <div><label style={labelStyle}>Reorder Pt (ROP)</label><input name="reorderPoint" type="number" value={editSpecs.reorderPoint || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                                        </div>
                                    </div>
                                )}
                            </div>

                        </div>

                        <div>
                            <h4 style={sectionHeaderStyle}>Client-Specific Pricing & SKUs</h4>
                            
                            <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-end', marginBottom: '20px' }}>
                                <div style={{ flex: 2 }}>
                                    <label style={labelStyle}>Customer (Name - ID)</label>
                                    <select value={newClientPricing.customerId} onChange={e => setNewClientPricing({...newClientPricing, customerId: e.target.value})} style={fieldStyle}>
                                        <option value="">Select Customer...</option>
                                        {customersData.length > 0 ? (
                                            customersData.map(c => <option key={c.id} value={c.id}>{c.companyName || c.name} - {c.id}</option>)
                                        ) : (
                                            (globalLists.customers || []).map((c, idx) => {
                                                const val = typeof c === 'string' ? c : c.id;
                                                return <option key={val || idx} value={val}>{getCustomerDisplay(val)}</option>
                                            })
                                        )}
                                    </select>
                                </div>
                                <div style={{ flex: 2 }}>
                                    <label style={labelStyle}>Client SKU / Part #</label>
                                    <input value={newClientPricing.clientSku} onChange={e => setNewClientPricing({...newClientPricing, clientSku: e.target.value})} placeholder="e.g. Brimar-8483" style={fieldStyle} />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={labelStyle}>Custom Price ($)</label>
                                    <input type="number" step="0.01" value={newClientPricing.price} onChange={e => setNewClientPricing({...newClientPricing, price: e.target.value})} placeholder="0.00" style={fieldStyle} />
                                </div>
                                <button onClick={() => handleAddClientPricing(false)} style={{ padding: '10px 20px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Add</button>
                            </div>
                            
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {(editSpecs.clientPricing || []).length === 0 && <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No custom client pricing assigned. Defaults to Base Price.</div>}
                                {(editSpecs.clientPricing || []).map((cp, idx) => (
                                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--paper)', border: '1px solid var(--line)', padding: '12px 16px' }}>
                                        <div style={{ display: 'flex', gap: '24px', fontSize: '0.9rem', width: '100%', alignItems: 'center', color: 'var(--ink)' }}>
                                            <span style={{ fontWeight: 500, flex: 1 }}>{getCustomerDisplay(cp.customerId)}</span>
                                            <span style={{ flex: 1, color: 'var(--ink-soft)' }}>SKU: <span style={{ color: 'var(--ink)' }}>{cp.clientSku || 'N/A'}</span></span>
                                            <span style={{ fontWeight: 500, width: '80px', textAlign: 'right' }}>${parseFloat(cp.price || 0).toFixed(2)}</span>
                                        </div>
                                        <button onClick={() => handleRemoveClientPricing(idx, false)} style={{ background: 'none', border: 'none', color: '#d9534f', fontSize: '1.2rem', cursor: 'pointer', marginLeft: '16px' }}>×</button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div>
                            <h4 style={sectionHeaderStyle}>Record Visibility & Sharing</h4>
                            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', padding: '20px', background: 'var(--paper-2)', border: '1px solid var(--line)' }}>
                                {AVAILABLE_BRANDS.map(brand => {
                                    const isOwner = activeComponent.masterPart.brandId === brand.id; 
                                    const isShared = editSpecs.sharedBrands?.includes(brand.id);
                                    return ( 
                                        <label key={brand.id} style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px', cursor: isOwner ? 'not-allowed' : 'pointer', opacity: isOwner ? 0.6 : 1, color: 'var(--ink)' }}>
                                            <input type="checkbox" checked={isOwner || isShared} disabled={isOwner} onChange={() => handleBrandToggle(brand.id, false)} />
                                            {brand.name} {isOwner && "(Owner)"}
                                        </label> 
                                    );
                                })}
                            </div>
                        </div>

                        <div>
                            <h4 style={sectionHeaderStyle}>Core Static Attributes</h4>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                
                                <div>
                                    <label style={labelStyle}>Prod Type</label>
                                    <select name="productType" value={String(editSpecs.productType || "").toUpperCase()} onChange={handleSpecChange} style={fieldStyle}>
                                        <option value="">Select...</option>
                                        {(globalLists.prodTypes || []).map(pt => <option key={pt} value={String(pt).toUpperCase()}>{pt}</option>)}
                                        {renderOptionFallback(editSpecs.productType, globalLists.prodTypes)}
                                    </select>
                                </div>
                                
                                <div>
                                    <label style={labelStyle}>{isAssembly ? 'Routing Classification' : 'Inventory Category'}</label>
                                    <select name="routingType" value={String(editSpecs.routingType || "").toUpperCase()} onChange={handleSpecChange} style={{ ...fieldStyle, textTransform: 'uppercase' }}>
                                        <option value="">Unassigned</option>
                                        {(isAssembly ? (globalLists.assemblyTypes || []) : (globalLists.inventoryTypes || [])).map(t => <option key={t} value={String(t).toUpperCase()}>{t}</option>)}
                                        {renderOptionFallback(editSpecs.routingType, isAssembly ? globalLists.assemblyTypes : globalLists.inventoryTypes)}
                                    </select>
                                </div>
                                
                                <div><label style={labelStyle}>Project / Grouping</label><input name="project" value={editSpecs.project || ""} onChange={handleSpecChange} style={fieldStyle} /></div>

                                {windowConfig.system.partHandling?.includes(activeBrand) && (
                                    <div>
                                        <label style={labelStyle}>Part Handling</label>
                                        <select name="partHandling" value={String(editSpecs.partHandling || "").toUpperCase()} onChange={handleSpecChange} style={{ ...fieldStyle, textTransform: 'uppercase' }}>
                                            <option value="">Unassigned / Standard</option>
                                            {(globalLists.partHandling || []).map(ph => <option key={ph} value={String(ph).toUpperCase()}>{ph}</option>)}
                                            {renderOptionFallback(editSpecs.partHandling, globalLists.partHandling)}
                                        </select>
                                    </div>
                                )}

                                <div>
                                    <label style={labelStyle}>UOM</label>
                                    <select name="uom" value={String(editSpecs.uom || "EA").toUpperCase()} onChange={handleSpecChange} style={fieldStyle}>
                                        {(globalLists.uom || []).map(u => <option key={u} value={String(u).toUpperCase()}>{u}</option>)}
                                        {renderOptionFallback(editSpecs.uom, globalLists.uom)}
                                    </select>
                                </div>
                                
                                {windowConfig.system.collections?.includes(activeBrand) && (
                                    <div style={{ gridColumn: 'span 2' }}>
                                        <label style={labelStyle}>Collections (Multi-Select for CPQ)</label>
                                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', padding: '16px', border: '1px solid var(--line)', background: 'var(--paper)', maxHeight: '150px', overflowY: 'auto' }}>
                                            {collectionsData.length === 0 && <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No collections defined in Admin.</span>}
                                            {collectionsData.map(c => {
                                                const isSelected = (editSpecs.collections || []).includes(c.name);
                                                return (
                                                    <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', cursor: 'pointer', background: isSelected ? 'var(--ink)' : '#fff', color: isSelected ? '#fff' : 'var(--ink)', border: `1px solid ${isSelected ? 'var(--ink)' : 'var(--line)'}`, padding: '6px 14px', borderRadius: '20px', transition: 'all 0.2s' }}>
                                                        <input type="checkbox" checked={isSelected} onChange={() => handleToggleCollection(c.name)} style={{ display: 'none' }} />
                                                        {c.name}
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                                
                                {windowConfig.system.pillowSizes?.includes(activeBrand) && (
                                    <div><label style={labelStyle}>Pillow Size</label><select name="pillowSize" value={editSpecs.pillowSize || ""} onChange={handleSpecChange} style={fieldStyle}><option value="">Select...</option>{(globalLists.pillowSizes || []).map(x => <option key={x} value={x}>{x}</option>)}</select></div>
                                )}
                                {windowConfig.system.fillTypes?.includes(activeBrand) && (
                                    <div><label style={labelStyle}>Fill Type</label><select name="fillType" value={editSpecs.fillType || ""} onChange={handleSpecChange} style={fieldStyle}><option value="">Select...</option>{(globalLists.fillTypes || []).map(x => <option key={x} value={x}>{x}</option>)}</select></div>
                                )}
                                {windowConfig.system.flangeStyles?.includes(activeBrand) && (
                                    <div><label style={labelStyle}>Edge/Flange</label><select name="flangeStyle" value={editSpecs.flangeStyle || ""} onChange={handleSpecChange} style={fieldStyle}><option value="">Select...</option>{(globalLists.flangeStyles || []).map(x => <option key={x} value={x}>{x}</option>)}</select></div>
                                )}
                                {windowConfig.system.stitchTypes?.includes(activeBrand) && (
                                    <div><label style={labelStyle}>Stitch Routing</label><select name="stitchType" value={editSpecs.stitchType || ""} onChange={handleSpecChange} style={fieldStyle}><option value="">Select...</option>{(globalLists.stitchTypes || []).map(x => <option key={x} value={x}>{x}</option>)}</select></div>
                                )}
                                {windowConfig.system.seamCounts?.includes(activeBrand) && (
                                    <div><label style={labelStyle}>Seam Count</label><select name="seamCount" value={editSpecs.seamCount || ""} onChange={handleSpecChange} style={fieldStyle}><option value="">Select...</option>{(globalLists.seamCounts || []).map(x => <option key={x} value={x}>{x}</option>)}</select></div>
                                )}
                                {windowConfig.system.outsourceActions?.includes(activeBrand) && (
                                    <div>
                                        <label style={labelStyle}>Outsource Action</label>
                                        <select name="outsourceAction" value={String(editSpecs.outsourceAction || "").toUpperCase()} onChange={handleSpecChange} style={fieldStyle}>
                                            <option value="">Select...</option>
                                            {(globalLists.outsourceActions || []).map(x => <option key={x} value={String(x).toUpperCase()}>{x}</option>)}
                                            {renderOptionFallback(editSpecs.outsourceAction, globalLists.outsourceActions)}
                                        </select>
                                    </div>
                                )}
                                
                                {windowConfig.custom.filter(w => (w.brands || []).includes(activeBrand)).map(w => (
                                    <div key={w.id}>
                                        <label style={labelStyle}>{w.name}</label>
                                        <select value={editSpecs.dynamicDicts?.[w.id] || ""} onChange={(e) => handleDictChange(w.id, e.target.value)} style={fieldStyle}>
                                            <option value="">Select...</option><option value="N/A">N/A</option>
                                            {dynamicAssets.filter(a => a.windowId === w.id).map(a => <option key={a.id} value={a.name}>{a.name} {a.code ? `(${a.code})` : ''}</option>)}
                                        </select>
                                    </div>
                                ))}

                                {customSchema.map(field => (
                                    <div key={field.key}>
                                        <label style={labelStyle}>{field.label} (Custom)</label>
                                        {field.type === 'dropdown' ? (
                                            <select value={editSpecs.customData?.[field.key] || ""} onChange={(e) => handleCustomFieldChange(field.key, e.target.value)} style={fieldStyle}>
                                                <option value="">Select...</option>{(field.options || "").split(',').map(opt => <option key={opt.trim()} value={opt.trim()}>{opt.trim()}</option>)}
                                            </select>
                                        ) : field.type === 'file' ? (
                                            <div style={{ background: 'var(--paper)', padding: '12px', border: '1px solid var(--line)' }}>
                                                {editSpecs.customData?.[field.key] && <a href={editSpecs.customData[field.key]} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem', color: 'var(--ink)', textDecoration: 'underline', display: 'block', marginBottom: '8px' }}>View Current File</a>}
                                                <input type="file" onChange={(e) => handleDynamicFileUpload(field.key, e.target.files[0], false)} style={{ fontSize: '0.85rem', fontFamily: 'var(--sans)' }} />
                                            </div>
                                        ) : (
                                            <input type={field.type} value={editSpecs.customData?.[field.key] || ""} onChange={(e) => handleCustomFieldChange(field.key, e.target.value)} style={fieldStyle} />
                                        )}
                                    </div>
                                ))}

                                <div style={{ gridColumn: 'span 2' }}>
                                    <label style={labelStyle}>Assign to Watchlist</label>
                                    <select name="watchList" value={editSpecs.watchList || "NONE"} onChange={handleSpecChange} style={fieldStyle}>
                                        <option value="NONE">None</option>
                                        {(globalLists.watchLists || []).map(w => <option key={w} value={w}>{w}</option>)}
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div>
                            <h4 style={sectionHeaderStyle}>Hardware CPQ Metadata (Vision Engine)</h4>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', background: 'var(--paper-2)', padding: '24px', border: '1px solid var(--line)' }}>
                                <div>
                                    <label style={labelStyle}>Bracket Projection (Inches)</label>
                                    <select value={String(editSpecs.customData?.projection || "").toUpperCase()} onChange={(e) => handleCustomFieldChange("projection", e.target.value)} style={fieldStyle}>
                                        <option value="">-- No Projection / Not Bracket --</option>
                                        {(globalLists.projections || []).map(p => <option key={p} value={String(p).toUpperCase()}>{p}" Projection</option>)}
                                        {renderOptionFallback(editSpecs.customData?.projection, globalLists.projections)}
                                    </select>
                                </div>
                                <div>
                                    <label style={labelStyle}>Bracket Mount Type</label>
                                    <select value={String(editSpecs.customData?.bracketType || "").toUpperCase()} onChange={(e) => handleCustomFieldChange("bracketType", e.target.value)} style={fieldStyle}>
                                        <option value="">-- Not a Bracket --</option>
                                        {(globalLists.bracketMounts || []).map(m => <option key={m} value={String(m).toUpperCase()}>{m}</option>)}
                                        {renderOptionFallback(editSpecs.customData?.bracketType, globalLists.bracketMounts)}
                                    </select>
                                </div>
                                <div style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '6px 0' }}>
                                    <input type="checkbox" checked={!!editSpecs.customData?.isReturnBracket} onChange={(e) => handleCustomFieldChange("isReturnBracket", e.target.checked)} style={{ width: '16px', height: '16px', cursor: 'pointer', marginTop: '2px', flexShrink: 0 }} />
                                    <div>
                                        <label style={labelStyle}>Is Return Bracket (End-Return)</label>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginTop: '2px' }}>Sits right at the pole end and its width adds to the O2O. End-return brackets are the only ones placed at the very end — and they're never offered as a center support. (e.g. FIWERA, FICERA)</div>
                                    </div>
                                </div>
                                {!!editSpecs.customData?.isReturnBracket && (
                                    <div>
                                        <label style={labelStyle}>Bracket Arm Thickness (in)</label>
                                        <input type="number" step="0.125" value={editSpecs.customData?.armThickness ?? ''} onChange={(e) => handleCustomFieldChange("armThickness", e.target.value)} placeholder="e.g. 0.5" style={fieldStyle} />
                                        <div style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', marginTop: '4px' }}>Adds to the O2O on each return end, on top of the half-backplate.</div>
                                    </div>
                                )}
                                {(editSpecs.productType || '').toUpperCase().includes('BACKPLATE') && (
                                    <div>
                                        <label style={labelStyle}>Backplate Orientation (drives O2O)</label>
                                        <select value={String(editSpecs.customData?.bpOrientation || 'VERTICAL').toUpperCase()} onChange={(e) => handleCustomFieldChange("bpOrientation", e.target.value)} style={fieldStyle}>
                                            <option value="VERTICAL">Vertical — Width is along the pole (½ Width / side)</option>
                                            <option value="HORIZONTAL">Horizontal — Length is along the pole (½ Length / side)</option>
                                            <option value="SQUARE">Square — Width = Height (½ Width / side)</option>
                                            <option value="ROUND">Round — Diameter (½ Diameter / side)</option>
                                        </select>
                                        <div style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', marginTop: '4px' }}>O2O uses the Geometry dimension along the pole — <strong>Vertical → ½ Width</strong> · <strong>Horizontal → ½ Length</strong> · <strong>Square → ½ Width</strong> · <strong>Round → ½ Diameter (Width)</strong>. Set L / W / H in “Geometry &amp; Z-Index Rules” above.</div>
                                    </div>
                                )}
                                <div style={{ gridColumn: 'span 2' }}>
                                    <label style={labelStyle}>Service / Fee Type (Auto-Append)</label>
                                    <select value={String(editSpecs.customData?.feeType || "").toUpperCase()} onChange={(e) => handleCustomFieldChange("feeType", e.target.value)} style={fieldStyle}>
                                        <option value="">-- No Special Fee --</option>
                                        {(globalLists.feeTypes || []).map(f => <option key={f} value={String(f).toUpperCase()}>{f}</option>)}
                                        {renderOptionFallback(editSpecs.customData?.feeType, globalLists.feeTypes)}
                                    </select>
                                    <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', fontStyle: 'italic', display: 'block', marginTop: '6px' }}>If selected, the Vision System will automatically bill for this item when triggered.</span>
                                </div>
                            </div>
                        </div>

                        <div>
                            <h4 style={sectionHeaderStyle}>Geometry & Z-Index Rules</h4>
                            <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', marginBottom: '24px' }}>
                                    <div><label style={labelStyle}>Length (in)</label><input name="length" type="number" step="0.1" value={editSpecs.parametric?.length || ""} onChange={handleParametricChange} style={fieldStyle} /></div>
                                    <div><label style={labelStyle}>Width (in)</label><input name="width" type="number" step="0.1" value={editSpecs.parametric?.width || ""} onChange={handleParametricChange} style={fieldStyle} /></div>
                                    <div><label style={labelStyle}>Height (in)</label><input name="height" type="number" step="0.1" value={editSpecs.parametric?.height || ""} onChange={handleParametricChange} style={fieldStyle} /></div>
                                </div>
                                <div style={{ marginBottom: '24px' }}>
                                    <label style={{ fontSize: '0.9rem', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <input type="checkbox" name="isCutToSize" checked={editSpecs.parametric?.isCutToSize || false} onChange={handleParametricChange} />
                                        Dynamic Custom Length Allowed (Stretchable Pole / Track)
                                    </label>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                    <div style={{ gridColumn: 'span 2' }}><label style={labelStyle}>Z-Index / Render Layer</label><input name="layeringSequence" type="number" step="10" value={editSpecs.layeringSequence || ""} onChange={handleSpecChange} placeholder="e.g. 10 (Back), 30 (Front)" style={fieldStyle} /></div>
                                    <div style={{ gridColumn: 'span 2', background: 'var(--paper-2)', padding: '20px', border: '1px solid var(--line)' }}><label style={labelStyle}>Width Offset / Deduction (Inches)</label><input name="widthOffset" type="number" step="0.125" value={editSpecs.parametric?.widthOffset || ""} onChange={handleParametricChange} style={fieldStyle} /></div>
                                </div>
                            </div>
                        </div>

                        <div>
                            <h4 style={sectionHeaderStyle}>Documents</h4>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', background: 'var(--paper)', padding: '24px', border: '1px solid var(--line)' }}>
                                <div>
                                    <label style={labelStyle}>Upload Print (PDF)</label>
                                    {editSpecs.pdfUrl && <a href={editSpecs.pdfUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem', color: 'var(--ink)', textDecoration: 'underline', display: 'block', marginBottom: '10px' }}>View Current PDF</a>}
                                    <input type="file" accept="application/pdf" onChange={(e) => setPdfFile(e.target.files[0])} style={{ fontSize: '0.85rem', fontFamily: 'var(--sans)' }} />
                                    {uploadProgress > 0 && <progress value={uploadProgress} max="100" style={{ width: '100%', marginTop: '10px' }}/>}
                                </div>
                                <div>
                                    <label style={labelStyle}>3D CAD Model (.glb / .gltf)</label>
                                    {editSpecs.cadUrl && <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginBottom: '10px' }}>✓ 3D Model Assigned</div>}
                                    <input type="file" accept=".glb,.gltf" onChange={(e) => setCadFile(e.target.files[0])} style={{ fontSize: '0.85rem', fontFamily: 'var(--sans)' }} />
                                    {cadUploadProgress > 0 && <progress value={cadUploadProgress} max="100" style={{ width: '100%', marginTop: '10px' }}/>}
                                </div>
                            </div>
                        </div>

                        <div style={{ paddingTop: '20px' }}>
                            <button onClick={saveGlobalUpdates} style={{ width: '100%', padding: '16px', background: isSaving ? 'var(--brass-light)' : 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'background 0.3s ease' }}>
                                {isSaving ? "Saving..." : "Save Global Part Data"}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
      </div>
      {showSpecSheet && selectedAssemblyData && (
        <React.Suspense fallback={null}>
          <SpecSheetModal assembly={selectedAssemblyData} pins={bomPins} libraryParts={libraryParts} onClose={() => setShowSpecSheet(false)} />
        </React.Suspense>
      )}
      {showSops && selectedAssemblyData && (
        <React.Suspense fallback={null}>
          <SopViewer assembly={selectedAssemblyData} onClose={() => setShowSops(false)} />
        </React.Suspense>
      )}
    </div>
  );
};

export default BOMTab;