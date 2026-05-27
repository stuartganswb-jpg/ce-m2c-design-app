import React, { useState, useEffect, useRef } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, query, where, doc, writeBatch, serverTimestamp, getDocs, deleteDoc } from "firebase/firestore";

// --- BASE STATIC SCHEMAS ---
const BASE_SCHEMAS = {
    INVENTORY: [
        { key: 'legacyErpId', label: 'NS Internal ID (Unique)', required: true },
        { key: 'itemName', label: 'Item Name / Description', required: true },
        { key: 'productType', label: 'Product Type', required: false },
        { key: 'basePrice', label: 'Base Price ($)', required: true },
        { key: 'cost', label: 'Unit Cost ($)', required: false },
        { key: 'uom', label: 'Unit of Measure', required: false }
    ],
    ASSEMBLIES: [
        { key: 'legacyErpId', label: 'NS Internal ID (Unique)', required: true },
        { key: 'itemName', label: 'Assembly Name', required: true },
        { key: 'collection', label: 'Collection', required: false }
    ],
    BOMS: [
        { key: 'assemblyErpId', label: 'Assembly NS ID (Parent)', required: true },
        { key: 'componentErpId', label: 'Component NS ID (Child)', required: true },
        { key: 'qty', label: 'BOM Quantity', required: true }
    ],
    win_outsource_finishes: [
        { key: 'legacyErpId', label: 'NS Internal ID (Unique)', required: true },
        { key: 'name', label: 'Finish Name', required: true },
        { key: 'description', label: 'Description', required: false },
        { key: 'multiplier', label: 'Price Multiplier', required: false },
        { key: 'vendor', label: 'Approved Vendor', required: false }
    ]
};

const ERPPushPullTab = ({ currentUser, activeBrand }) => {
  const [activeView, setActiveView] = useState('NETSUITE'); 
  
  // --- LIVE DATA STATE ---
  const [jobs, setJobs] = useState([]);
  const [activeJobId, setActiveJobId] = useState(null);
  const [libraryParts, setLibraryParts] = useState([]);
  
  const [dispatchForm, setDispatchForm] = useState({ soNum: '', lines: {} });
  
  // --- DYNAMIC ERP CONFIGURATION ---
  const [systemWindows, setSystemWindows] = useState({ inHouseFinishes: [], outsourceFinishes: [] });
  const [customWindows, setCustomWindows] = useState([]);
  const [dynamicSchemas, setDynamicSchemas] = useState(BASE_SCHEMAS);
  const [nsMetrics, setNsMetrics] = useState({ invTotal: 0, invPending: 0, asmTotal: 0, asmPending: 0, bomTotal: 0, osFinTotal: 0, osFinPending: 0 });

  const [terminalLogs, setTerminalLogs] = useState(["> SYSTEM ONLINE. WAITING FOR LIVE DISPATCH COMMANDS..."]);
  const [mapperConfig, setMapperConfig] = useState(null); 
  const [fieldMap, setFieldMap] = useState({});
  
  const fileInputRefs = useRef({}); 

  const activeJob = jobs.find(j => j.id === activeJobId);
  const logToTerminal = (message) => setTerminalLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);

  useEffect(() => {
    if (currentUser) {
        logToTerminal(`> USER IDENTIFIED: ${currentUser}`);
    }

    const unsubWindows = onSnapshot(doc(db, "system", "window_config"), (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            setSystemWindows(data.system || { inHouseFinishes: [], outsourceFinishes: [] });
            setCustomWindows(data.custom || []);
            
            const newSchemas = { ...BASE_SCHEMAS };
            (data.custom || []).forEach(w => {
                const schema = [
                    { key: 'legacyErpId', label: 'NS Internal ID (Unique)', required: true },
                    { key: 'name', label: 'Item Name', required: true }
                ];
                if (w.hasCode) schema.push({ key: 'code', label: 'Item Code', required: false });
                if (w.hasVendor) schema.push({ key: 'vendor', label: 'Approved Vendor', required: false });
                if (w.hasMultiplier) schema.push({ key: 'multiplier', label: 'Multiplier (x)', required: false });
                newSchemas[w.id] = schema;
            });

            setDynamicSchemas(newSchemas);
        }
    });

    const qJobs = query(collection(db, "jobs"), where("status", "==", "APPROVED"), where("brandId", "==", activeBrand));
    const unsubJobs = onSnapshot(qJobs, (snap) => {
        const fetchedJobs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setJobs(fetchedJobs);
        if (fetchedJobs.length > 0 && !activeJobId) setActiveJobId(fetchedJobs[0].id);
    });

    const qParts = query(collection(db, "Approved_Designs"));
    const unsubParts = onSnapshot(qParts, (snap) => {
        const parts = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setLibraryParts(parts);
        const inv = parts.filter(p => p.partClass === "Inventory");
        const asm = parts.filter(p => p.partClass === "Assembly");
        setNsMetrics(prev => ({ ...prev, invTotal: inv.length, invPending: inv.filter(p => p.legacyErpId === "PENDING").length, asmTotal: asm.length, asmPending: asm.filter(p => p.legacyErpId === "PENDING").length }));
    });

    const unsubBoms = onSnapshot(collection(db, "assembly_pins"), (snap) => setNsMetrics(prev => ({ ...prev, bomTotal: snap.docs.length })));
    const unsubOsFinishes = onSnapshot(collection(db, "hq_outsource_finishes"), (snap) => {
        const osFins = snap.docs.map(doc => doc.data());
        setNsMetrics(prev => ({ ...prev, osFinTotal: osFins.length, osFinPending: osFins.filter(f => f.legacyErpId === "PENDING").length }));
    });

    return () => { unsubWindows(); unsubJobs(); unsubParts(); unsubBoms(); unsubOsFinishes(); };
  }, [activeJobId, activeBrand, currentUser]);

  useEffect(() => {
      if (activeJob) {
          const lines = {};
          if (activeJob.linkedAssemblyId) {
              lines[activeJob.linkedAssemblyId] = { woNum: '', route: 'SHOP_FLOOR', isMaster: true };
          }
          
          if (activeJob?.cpqData?.configuration && typeof activeJob.cpqData.configuration === 'object') {
              Object.values(activeJob.cpqData.configuration).forEach(partId => {
                  if (partId) lines[partId] = { woNum: '', route: 'FINISHING_FLOOR', isMaster: false };
              });
          }
          setDispatchForm({ soNum: '', lines });
      }
  }, [activeJob]);

  const determineShopRouting = (part) => {
      if (!part) return 'Custom Fabrication';
      const pType = (part.manufacturingSpecs?.productType || '').toUpperCase();
      const pName = (part.itemName || '').toUpperCase();
      
      if (pType.includes('POLE') || pType.includes('ROD') || pType.includes('TUBE') || pName.includes('POLE') || pName.includes('ROD')) {
          return 'Cut to Size Rods';
      }
      return 'Custom Fabrication';
  };

  const handleExecuteDispatch = async () => {
      if (!dispatchForm.soNum) return alert("❌ NetSuite Sales Order Number is required to dispatch.");
      
      let dispatchCount = 0;
      try {
          const batch = writeBatch(db);
          
          for (const [partId, config] of Object.entries(dispatchForm.lines)) {
              if (!config.woNum) continue; 
              
              const part = libraryParts.find(p => p.id === partId);
              const partName = part ? part.itemName : partId;
              const shopCategory = determineShopRouting(part);
              const clientContext = activeJob?.customer?.name || activeJob?.clientName || 'Standard Order';

              // 🏭 1. FIXED: Correctly targeting "shop_custom_orders"
              if (config.route === 'SHOP_FLOOR' || config.route === 'BOTH') {
                  const shopRef = doc(collection(db, "shop_custom_orders"));
                  batch.set(shopRef, {
                      partNum: partId,
                      item: partName,
                      woNum: config.woNum,
                      soNum: dispatchForm.soNum,
                      qty: 1, 
                      priority: Date.now(), 
                      category: shopCategory, 
                      jobType: shopCategory,
                      department: shopCategory,
                      status: 'Pending', // Shop Floor expects Capital 'Pending'
                      cpqSpecs: activeJob.cpqData?.configuration || {},
                      imageUrl: activeJob?.imageUrl || part?.finalImageUrl || null,
                      note: activeJob?.note || '', 
                      clientName: clientContext, 
                      t: serverTimestamp()
                  });
                  dispatchCount++;
              }

              // 🎨 2. FIXED: Correctly setting "currentPhase: 'Setup'"
              if (config.route === 'FINISHING_FLOOR' || config.route === 'BOTH') {
                  // Finishing app creates doc ID based on WO#
                  const finRef = doc(db, "fin_workorders", config.woNum);
                  batch.set(finRef, {
                      id: config.woNum,
                      displayId: config.woNum,
                      partId: partId,
                      itemName: partName,
                      recipe: activeJob.cpqData?.finish || 'Standard Finish', // SetupQueue looks for wo.recipe
                      woNum: config.woNum,
                      soId: dispatchForm.soNum, // SetupQueue uses soId
                      totalParts: 1, // SetupQueue uses totalParts
                      type: 'sales', // Match SetupQueue expectations
                      customer: clientContext, // SetupQueue uses customer
                      currentPhase: 'Setup', // CRITICAL FIX for the queue filter
                      stepStatus: 'Pending', // CRITICAL FIX for the queue filter
                      cpqSpecs: activeJob.cpqData?.configuration || {},
                      imageUrl: activeJob?.imageUrl || part?.finalImageUrl || null,
                      note: activeJob?.note || '', 
                      reqDate: activeJob?.reqDate || new Date(Date.now() + 12096e5).toISOString().split('T')[0],
                      createdAt: serverTimestamp()
                  });
                  dispatchCount++;
              }
          }
          
          if (dispatchCount === 0) return alert("⚠️ No Work Orders assigned. Please assign at least one WO# to dispatch.");

          batch.update(doc(db, "jobs", activeJob.id), { 
              status: 'IN_PRODUCTION', 
              dispatchDate: serverTimestamp(),
              soNum: dispatchForm.soNum
          });
          
          await batch.commit();
          logToTerminal(`✅ SUCCESS: Dispatched ${dispatchCount} Work Orders to Factory Floors.`);
          alert(`✅ Success! ${dispatchCount} Work Orders dispatched to factory floors.`);
          setActiveJobId(null);
      } catch (err) {
          console.error(err);
          logToTerminal(`❌ ERROR: Failed to execute dispatch payload.`);
          alert("Failed to dispatch orders.");
      }
  };

  const handleOverrideAndPush = async () => {
      if (!window.confirm("⚠️ DEV WARNING: This will inject dummy SO/WO numbers and push to the floor. Proceed?")) return;

      const dummySo = `SO-TEST-${Math.floor(1000 + Math.random() * 9000)}`;
      const batch = writeBatch(db);
      let dispatchCount = 0;
      let lineIndex = 1;

      for (const [partId, config] of Object.entries(dispatchForm.lines)) {
          const dummyWo = `WO-TEST-${Math.floor(100 + Math.random() * 900)}-${lineIndex}`;
          const part = libraryParts.find(p => p.id === partId);
          const partName = part ? part.itemName : partId;
          const route = config.route || 'SHOP_FLOOR'; 
          const shopCategory = determineShopRouting(part);
          const clientContext = activeJob?.customer?.name || activeJob?.clientName || 'Standard Order';

          // 🏭 THE GOLDEN PAYLOAD: Shop Floor Override
          if (route === 'SHOP_FLOOR' || route === 'BOTH') {
              const shopRef = doc(collection(db, "shop_custom_orders"));
              batch.set(shopRef, {
                  partNum: partId,
                  item: partName,
                  woNum: dummyWo,
                  soNum: dummySo,
                  qty: 1,
                  priority: Date.now(),
                  category: shopCategory, 
                  jobType: shopCategory,
                  department: shopCategory,
                  status: 'Pending',
                  cpqSpecs: activeJob?.cpqData?.configuration || {},
                  imageUrl: activeJob?.imageUrl || part?.finalImageUrl || null, 
                  note: activeJob?.note || '', 
                  clientName: clientContext, 
                  t: serverTimestamp()
              });
              dispatchCount++;
          }

          // 🎨 THE GOLDEN PAYLOAD: Finishing Floor Override
          if (route === 'FINISHING_FLOOR' || route === 'BOTH') {
              const finRef = doc(db, "fin_workorders", dummyWo);
              batch.set(finRef, {
                  id: dummyWo,
                  displayId: dummyWo,
                  partId: partId,
                  itemName: partName,
                  recipe: activeJob?.cpqData?.finish || 'Standard Finish',
                  woNum: dummyWo,
                  soId: dummySo,
                  totalParts: 1,
                  type: 'sales',
                  customer: clientContext,
                  currentPhase: 'Setup', 
                  stepStatus: 'Pending', 
                  cpqSpecs: activeJob?.cpqData?.configuration || {},
                  imageUrl: activeJob?.imageUrl || part?.finalImageUrl || null,
                  note: activeJob?.note || '',
                  reqDate: activeJob?.reqDate || new Date(Date.now() + 12096e5).toISOString().split('T')[0],
                  createdAt: serverTimestamp()
              });
              dispatchCount++;
          }
          lineIndex++;
      }

      if (dispatchCount === 0) return alert("⚠️ No lines available to override and dispatch.");

      batch.update(doc(db, "jobs", activeJob.id), {
          status: 'IN_PRODUCTION',
          dispatchDate: serverTimestamp(),
          soNum: dummySo
      });

      try {
          await batch.commit();
          logToTerminal(`⚠️ DEV OVERRIDE: Dispatched ${dispatchCount} Work Orders with dummy IDs.`);
          alert(`✅ DEV OVERRIDE: Pushed ${dispatchCount} items to production with dummy SO/WOs.`);
          setActiveJobId(null);
      } catch (err) {
          console.error(err);
          logToTerminal(`❌ OVERRIDE ERROR: Failed to dispatch.`);
          alert("Override Dispatch Failed.");
      }
  };

  const handleDeleteJob = async (jobId, e) => {
      e.stopPropagation();
      if (!window.confirm("Reject and delete this order from the holding queue?")) return;
      try {
          await deleteDoc(doc(db, "jobs", jobId));
          if (activeJobId === jobId) setActiveJobId(null);
          logToTerminal(`✅ SYSTEM: JOB REJECTED FROM QUEUE.`);
      } catch (err) { console.error(err); alert("Failed to delete job."); }
  };

  const getPartName = (id) => {
      const part = libraryParts.find(p => p.id === id);
      return part ? part.itemName : id;
  };

  // -- CSV / MDM Logic --
  const generateNetSuiteCSV = async (type, windowConfig = null) => {
      logToTerminal(`[NS HUB] QUERYING DATABASE FOR ${windowConfig ? windowConfig.name : type} EXPORT...`);
      let csvContent = "data:text/csv;charset=utf-8,";
      let count = 0;

      try {
          if (type === 'INVENTORY') {
              const snap = await getDocs(query(collection(db, "Approved_Designs"), where("partClass", "==", "Inventory")));
              csvContent += "PLM_ID,NS_InternalID,ItemName,ProductType,BasePrice,Cost,UOM\n";
              snap.docs.forEach(d => {
                  const data = d.data(); const specs = data.manufacturingSpecs || {};
                  csvContent += `${data.id},${data.legacyErpId || ''},"${data.itemName || ''}",${specs.productType || ''},${specs.basePrice || 0},${specs.cost || 0},${specs.uom || ''}\n`;
                  count++;
              });
          } 
          else if (type === 'ASSEMBLIES') {
              const snap = await getDocs(query(collection(db, "Approved_Designs"), where("partClass", "==", "Assembly")));
              csvContent += "PLM_ID,NS_InternalID,AssemblyName,Collection\n";
              snap.docs.forEach(d => {
                  const data = d.data();
                  csvContent += `${data.id},${data.legacyErpId || ''},"${data.itemName || ''}","${data.collection || ''}"\n`;
                  count++;
              });
          }
          else if (type === 'BOMS') {
              const asmSnap = await getDocs(query(collection(db, "Approved_Designs"), where("partClass", "==", "Assembly")));
              const assemblies = {}; asmSnap.docs.forEach(d => assemblies[d.data().itemId] = d.data().legacyErpId || "PENDING");
              const pinSnap = await getDocs(collection(db, "assembly_pins"));
              csvContent += "Assembly_NS_ID,Component_NS_ID,Quantity\n";
              pinSnap.docs.forEach(d => {
                  const data = d.data(); const asmErpId = assemblies[data.assemblyId] || data.assemblyId;
                  csvContent += `${asmErpId},${data.legacyErpId || data.partId},${data.defaultQty || 1}\n`; count++;
              });
          }
          else if (type === 'win_outsource_finishes') {
              const snap = await getDocs(collection(db, "hq_outsource_finishes"));
              csvContent += "PLM_ID,NS_InternalID,FinishName,Description,Multiplier,Vendor\n";
              snap.docs.forEach(d => {
                  const data = d.data();
                  csvContent += `${data.id},${data.legacyErpId || ''},"${data.name || ''}","${data.description || ''}",${data.multiplier || 1},"${data.vendor || ''}"\n`; count++;
              });
          }
          else if (type === 'DYNAMIC_ASSET' && windowConfig) {
              const snap = await getDocs(query(collection(db, "hq_dynamic_data"), where("windowId", "==", windowConfig.id)));
              let headers = ["PLM_ID", "NS_InternalID", "Name"];
              if (windowConfig.hasCode) headers.push("Code");
              if (windowConfig.hasVendor) headers.push("Vendor");
              if (windowConfig.hasMultiplier) headers.push("Multiplier");
              csvContent += headers.join(",") + "\n";

              snap.docs.forEach(d => {
                  const data = d.data();
                  let row = [`${data.id}`, `${data.legacyErpId || ''}`, `"${data.name || ''}"`];
                  if (windowConfig.hasCode) row.push(`"${data.code || ''}"`);
                  if (windowConfig.hasVendor) row.push(`"${data.vendor || ''}"`);
                  if (windowConfig.hasMultiplier) row.push(`${data.multiplier || 1}`);
                  csvContent += row.join(",") + "\n";
                  count++;
              });
          }

          logToTerminal(`✅ [NS HUB] GENERATED CSV WITH ${count} ROWS. DOWNLOADING...`);
          const encodedUri = encodeURI(csvContent);
          const link = document.createElement("a"); 
          link.setAttribute("href", encodedUri); 
          link.setAttribute("download", `NS_SYNC_${windowConfig ? windowConfig.id : type}_${Date.now()}.csv`);
          document.body.appendChild(link); link.click(); document.body.removeChild(link);

      } catch (err) { console.error(err); logToTerminal(`❌ [NS ERROR] CSV EXPORT FAILED.`); }
  };

  const parseCSV = (text) => {
      const lines = text.split('\n').filter(l => l.trim() !== '');
      if (lines.length === 0) return [];
      const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
      const data = lines.slice(1).map(line => {
          const match = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
          let obj = {}; headers.forEach((h, i) => { obj[h] = match[i] ? match[i].replace(/(^"|"$)/g, '').trim() : ''; });
          return obj;
      });
      return { headers, data };
  };

  const handleImportClick = (e, importType, windowConfig = null) => {
      const file = e.target.files[0];
      if (!file) return;
      logToTerminal(`[MDM] READING ${importType} FILE: ${file.name}...`);
      const reader = new FileReader();
      reader.onload = (event) => {
          const { headers, data } = parseCSV(event.target.result);
          logToTerminal(`[MDM] PARSED ${data.length} ROWS. OPENING VISUAL MAPPER...`);
          const initialMap = {};
          headers.forEach(h => {
              const hLower = h.toLowerCase();
              if (hLower.includes('internalid') || hLower === 'id') initialMap['legacyErpId'] = h;
              if (hLower.includes('name') || hLower.includes('displayname') || hLower.includes('item')) initialMap[importType === 'INVENTORY' || importType === 'ASSEMBLIES' ? 'itemName' : 'name'] = h;
              if (hLower.includes('baseprice') || hLower === 'price') initialMap['basePrice'] = h;
              if (hLower.includes('cost') || hLower === 'purchaseprice') initialMap['cost'] = h;
              if (hLower === 'type') initialMap['productType'] = h;
              if (hLower.includes('parent') || hLower.includes('assembly')) initialMap['assemblyErpId'] = h;
              if (hLower.includes('component') || hLower.includes('member')) initialMap['componentErpId'] = h;
              if (hLower.includes('qty') || hLower === 'quantity') initialMap['qty'] = h;
              if (hLower.includes('vendor')) initialMap['vendor'] = h;
              if (hLower.includes('multiplier')) initialMap['multiplier'] = h;
              if (hLower === 'code') initialMap['code'] = h;
          });
          setFieldMap(initialMap); 
          setMapperConfig({ type: importType, data, headers, windowConfig });
          
          if (fileInputRefs.current[importType]) fileInputRefs.current[importType].value = '';
          if (windowConfig && fileInputRefs.current[windowConfig.id]) fileInputRefs.current[windowConfig.id].value = '';
      };
      reader.readAsText(file);
  };

  const executeImport = async () => {
      const schemaKey = mapperConfig.type === 'DYNAMIC_ASSET' ? mapperConfig.windowConfig.id : mapperConfig.type;
      const schema = dynamicSchemas[schemaKey];
      const missingRequired = schema.filter(field => field.required && !fieldMap[field.key]);
      if (missingRequired.length > 0) return alert(`Please map required fields: ${missingRequired.map(f => f.label).join(', ')}`);

      logToTerminal(`[MDM] EXECUTING BATCH IMPORT FOR ${mapperConfig.data.length} ROWS...`);
      setMapperConfig({ ...mapperConfig, isProcessing: true });

      try {
          const batch = writeBatch(db);
          let count = 0; const currentBrand = activeBrand || 'ce';

          mapperConfig.data.forEach(row => {
              const mappedRow = {};
              Object.keys(fieldMap).forEach(appKey => { mappedRow[appKey] = row[fieldMap[appKey]] || ""; });

              if (mapperConfig.type === 'INVENTORY' && mappedRow.itemName) {
                  const newId = `${currentBrand.toUpperCase()}-INV-${mappedRow.legacyErpId || Math.floor(1000+Math.random()*90000)}`;
                  batch.set(doc(db, "Approved_Designs", newId), { id: newId, itemId: newId, legacyErpId: mappedRow.legacyErpId.toUpperCase() || "PENDING", itemName: mappedRow.itemName.toUpperCase(), brandId: currentBrand, partClass: "Inventory", manufacturingSpecs: { productType: mappedRow.productType || "COMPONENT" } }, { merge: true });
              } 
              else if (mapperConfig.type === 'ASSEMBLIES' && mappedRow.itemName) {
                  const newId = `${currentBrand.toUpperCase()}-ASM-${mappedRow.legacyErpId || Math.floor(1000+Math.random()*90000)}`;
                  batch.set(doc(db, "Approved_Designs", newId), { id: newId, itemId: newId, partClass: "Assembly", brandId: currentBrand, legacyErpId: mappedRow.legacyErpId.toUpperCase() || "PENDING", itemName: mappedRow.itemName.toUpperCase(), lifecycleStatus: "APPROVED" }, { merge: true });
              }
              else if (mapperConfig.type === 'BOMS' && mappedRow.assemblyErpId && mappedRow.componentErpId) {
                  const newId = `BOM-${Math.floor(10000+Math.random()*90000)}`;
                  batch.set(doc(db, "assembly_pins", newId), { id: newId, assemblyId: mappedRow.assemblyErpId.toUpperCase(), partId: mappedRow.componentErpId.toUpperCase(), legacyErpId: mappedRow.componentErpId.toUpperCase(), defaultQty: parseInt(mappedRow.qty) || 1, isExistingLibraryPart: true });
              }
              else if (mapperConfig.type === 'win_outsource_finishes' && mappedRow.name) {
                  const safeId = `FIN-${mappedRow.name.toUpperCase().replace(/[^A-Z0-9]/g, '')}`;
                  batch.set(doc(db, "hq_outsource_finishes", safeId), { id: safeId, legacyErpId: mappedRow.legacyErpId.toUpperCase() || "PENDING", name: mappedRow.name.toUpperCase(), description: mappedRow.description || "", multiplier: parseFloat(mappedRow.multiplier) || 1.0, vendor: mappedRow.vendor || "" }, { merge: true });
              }
              else if (mapperConfig.type === 'DYNAMIC_ASSET' && mapperConfig.windowConfig && mappedRow.name) {
                  const safeId = `ASSET-${Date.now()}-${Math.floor(Math.random()*1000)}`;
                  batch.set(doc(db, "hq_dynamic_data", safeId), { id: safeId, windowId: mapperConfig.windowConfig.id, legacyErpId: mappedRow.legacyErpId.toUpperCase() || "PENDING", name: mappedRow.name.toUpperCase(), code: mappedRow.code || '', vendor: mappedRow.vendor || '', multiplier: parseFloat(mappedRow.multiplier) || 1.0 }, { merge: true });
              }
              count++;
          });
          await batch.commit();
          logToTerminal(`✅ [MDM SUCCESS] ${count} ITEMS MAPPED & IMPORTED!`); alert(`Success! ${count} items were imported.`); setMapperConfig(null); 
      } catch (error) { console.error(error); logToTerminal(`❌ [MDM ERROR] IMPORT FAILED.`); alert("Import failed."); setMapperConfig(null); }
  };

  const getDynamicSchema = (winConfig) => {
      if (!winConfig) return [];
      return dynamicSchemas[winConfig.id] || [];
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', fontFamily: 'monospace', backgroundColor: '#e5e5e5', minHeight: '100vh', position: 'relative' }}>
      
      <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '5px 5px 0 #000' }}>
        <div><h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.4rem', color: '#007bff' }}>12. ERP & Data Mapping</h2></div>
        <div style={{ display: 'flex', gap: '10px', background: '#eee', padding: '5px', border: '2px solid #000' }}>
          <button onClick={() => setActiveView('NETSUITE')} style={{ padding: '8px 20px', background: activeView === 'NETSUITE' ? '#007bff' : 'transparent', color: activeView === 'NETSUITE' ? '#fff' : '#666', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>🔄 NETSUITE HUB (SYNC)</button>
          <button onClick={() => setActiveView('PRODUCTION')} style={{ padding: '8px 20px', background: activeView === 'PRODUCTION' ? '#d9534f' : 'transparent', color: activeView === 'PRODUCTION' ? '#fff' : '#666', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>🏭 SMART FACTORY DISPATCHER</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '20px', alignItems: 'stretch', flex: 1 }}>

        {activeView === 'NETSUITE' && (
            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '20px', alignContent: 'start' }}>
                
                <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 rgba(0,0,0,0.1)' }}>
                    <div style={{ padding: '10px 15px', background: '#28a745', color: '#fff', fontWeight: 'bold', borderBottom: '2px solid #000', display: 'flex', justifyContent: 'space-between' }}>
                        <span>📦 INVENTORY (ITEMS)</span>
                        {nsMetrics.invPending > 0 && <span style={{ background: '#ffc107', color: '#000', padding: '2px 6px', fontSize: '0.7rem', borderRadius: '4px' }}>{nsMetrics.invPending} PENDING PUSH</span>}
                    </div>
                    <div style={{ padding: '15px', fontSize: '0.8rem', flex: 1 }}><div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{nsMetrics.invTotal} Items</div></div>
                    <div style={{ display: 'flex', borderTop: '2px solid #000', marginTop: 'auto' }}>
                        <input type="file" accept=".csv" ref={el => fileInputRefs.current['INVENTORY'] = el} onChange={(e) => handleImportClick(e, 'INVENTORY')} style={{ display: 'none' }} />
                        <button onClick={() => fileInputRefs.current['INVENTORY'].click()} style={{ flex: 1.5, padding: '15px 10px', background: '#eafaf1', color: '#28a745', fontWeight: 'bold', cursor: 'pointer', border: 'none', borderRight: '2px solid #000' }}>⬆️ IMPORT CSV</button>
                        <button onClick={() => generateNetSuiteCSV('INVENTORY')} style={{ flex: 1, padding: '15px 10px', background: '#28a745', color: '#fff', fontWeight: 'bold', cursor: 'pointer', border: 'none' }}>⬇️ EXPORT</button>
                    </div>
                </div>

                <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 rgba(0,0,0,0.1)' }}>
                    <div style={{ padding: '10px 15px', background: '#6c757d', color: '#fff', fontWeight: 'bold', borderBottom: '2px solid #000', display: 'flex', justifyContent: 'space-between' }}>
                        <span>⚙️ MASTER ASSEMBLIES</span>
                        {nsMetrics.asmPending > 0 && <span style={{ background: '#ffc107', color: '#000', padding: '2px 6px', fontSize: '0.7rem', borderRadius: '4px' }}>{nsMetrics.asmPending} PENDING PUSH</span>}
                    </div>
                    <div style={{ padding: '15px', fontSize: '0.8rem', flex: 1 }}><div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{nsMetrics.asmTotal} Assemblies</div></div>
                    <div style={{ display: 'flex', borderTop: '2px solid #000', marginTop: 'auto' }}>
                        <input type="file" accept=".csv" ref={el => fileInputRefs.current['ASSEMBLIES'] = el} onChange={(e) => handleImportClick(e, 'ASSEMBLIES')} style={{ display: 'none' }} />
                        <button onClick={() => fileInputRefs.current['ASSEMBLIES'].click()} style={{ flex: 1.5, padding: '15px 10px', background: '#f8f9fa', color: '#6c757d', fontWeight: 'bold', cursor: 'pointer', border: 'none', borderRight: '2px solid #000' }}>⬆️ IMPORT CSV</button>
                        <button onClick={() => generateNetSuiteCSV('ASSEMBLIES')} style={{ flex: 1, padding: '15px 10px', background: '#6c757d', color: '#fff', fontWeight: 'bold', cursor: 'pointer', border: 'none' }}>⬇️ EXPORT</button>
                    </div>
                </div>

                <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 rgba(0,0,0,0.1)' }}>
                    <div style={{ padding: '10px 15px', background: '#17a2b8', color: '#fff', fontWeight: 'bold', borderBottom: '2px solid #000', display: 'flex', justifyContent: 'space-between' }}>
                        <span>🏗️ MASTER BOMS</span>
                    </div>
                    <div style={{ padding: '15px', fontSize: '0.8rem', flex: 1 }}><div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{nsMetrics.bomTotal} Connections</div></div>
                    <div style={{ display: 'flex', borderTop: '2px solid #000', marginTop: 'auto' }}>
                        <input type="file" accept=".csv" ref={el => fileInputRefs.current['BOMS'] = el} onChange={(e) => handleImportClick(e, 'BOMS')} style={{ display: 'none' }} />
                        <button onClick={() => fileInputRefs.current['BOMS'].click()} style={{ flex: 1.5, padding: '15px 10px', background: '#e0f7fa', color: '#17a2b8', fontWeight: 'bold', cursor: 'pointer', border: 'none', borderRight: '2px solid #000' }}>⬆️ IMPORT CSV</button>
                        <button onClick={() => generateNetSuiteCSV('BOMS')} style={{ flex: 1, padding: '15px 10px', background: '#17a2b8', color: '#fff', fontWeight: 'bold', cursor: 'pointer', border: 'none' }}>⬇️ EXPORT BOMS</button>
                    </div>
                </div>

                {systemWindows.outsourceFinishes?.includes(activeBrand) && (
                    <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 rgba(0,0,0,0.1)' }}>
                        <div style={{ padding: '10px 15px', background: '#17a2b8', color: '#fff', fontWeight: 'bold', borderBottom: '2px solid #000', display: 'flex', justifyContent: 'space-between' }}>
                            <span>🚚 OUTSOURCED FINISHES</span>
                        </div>
                        <div style={{ padding: '15px', fontSize: '0.8rem', flex: 1 }}><div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>Export Profiles</div></div>
                        <div style={{ display: 'flex', borderTop: '2px solid #000', marginTop: 'auto' }}>
                            <input type="file" accept=".csv" ref={el => fileInputRefs.current['win_outsource_finishes'] = el} onChange={(e) => handleImportClick(e, 'win_outsource_finishes')} style={{ display: 'none' }} />
                            <button onClick={() => fileInputRefs.current['win_outsource_finishes'].click()} style={{ flex: 1.5, padding: '15px 10px', background: '#e0f7fa', color: '#17a2b8', fontWeight: 'bold', cursor: 'pointer', border: 'none', borderRight: '2px solid #000' }}>⬆️ IMPORT CSV</button>
                            <button onClick={() => generateNetSuiteCSV('win_outsource_finishes')} style={{ flex: 1, padding: '15px 10px', background: '#17a2b8', color: '#fff', fontWeight: 'bold', cursor: 'pointer', border: 'none' }}>⬇️ EXPORT</button>
                        </div>
                    </div>
                )}

                {customWindows.filter(w => w.brands.includes(activeBrand)).map(w => (
                    <div key={w.id} style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 rgba(0,0,0,0.1)' }}>
                        <div style={{ padding: '10px 15px', background: '#e83e8c', color: '#fff', fontWeight: 'bold', borderBottom: '2px solid #000', display: 'flex', justifyContent: 'space-between', textTransform: 'uppercase' }}>
                            <span>🪟 {w.name}</span>
                        </div>
                        <div style={{ padding: '15px', fontSize: '0.8rem', flex: 1 }}>
                            <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>Dynamic Link</div>
                            <div style={{ color: '#555', marginTop: '5px' }}>Custom dictionary entries from Tab 4.</div>
                        </div>
                        <div style={{ display: 'flex', borderTop: '2px solid #000', marginTop: 'auto' }}>
                            <input type="file" accept=".csv" ref={el => fileInputRefs.current[w.id] = el} onChange={(e) => handleImportClick(e, 'DYNAMIC_ASSET', w)} style={{ display: 'none' }} />
                            <button onClick={() => fileInputRefs.current[w.id].click()} style={{ flex: 1.5, padding: '15px 10px', background: '#fce4ec', color: '#e83e8c', fontWeight: 'bold', cursor: 'pointer', border: 'none', borderRight: '2px solid #000' }}>⬆️ IMPORT CSV</button>
                            <button onClick={() => generateNetSuiteCSV('DYNAMIC_ASSET', w)} style={{ flex: 1, padding: '15px 10px', background: '#e83e8c', color: '#fff', fontWeight: 'bold', cursor: 'pointer', border: 'none' }}>⬇️ EXPORT ALL</button>
                        </div>
                    </div>
                ))}
            </div>
        )}

        {activeView === 'PRODUCTION' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
                
                <div style={{ display: 'flex', gap: '20px', flex: 1 }}>
                    
                    {/* LEFT: HOLDING ZONE QUEUE */}
                    <div style={{ width: '400px', display: 'flex', flexDirection: 'column', flexShrink: 0, background: '#fff', border: '2px solid #000', boxShadow: '8px 8px 0 rgba(0,0,0,0.1)' }}>
                        <div style={{ padding: '15px', background: '#000', color: '#fff', borderBottom: '2px solid #000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 'bold', fontSize: '1.2rem' }}>📥 PENDING ERP SYNC</span>
                            <span style={{ fontSize: '0.8rem', fontWeight: 'bold', background: '#d9534f', padding: '3px 8px', borderRadius: '12px' }}>{jobs.length} HOLDING</span>
                        </div>
                        <div style={{ padding: '15px', display: 'flex', flexDirection: 'column', gap: '10px', background: '#f8f9fa', minHeight: '500px', overflowY: 'auto' }}>
                            {jobs.length === 0 && <div style={{ color: '#999', fontStyle: 'italic', fontSize: '0.9rem', textAlign: 'center', marginTop: '40px' }}>No approved quotes waiting for ERP identifiers.</div>}
                            
                            {jobs.map(job => {
                                const isSelected = job.id === activeJobId;
                                return (
                                    <div key={job.id} onClick={() => setActiveJobId(job.id)} style={{ background: isSelected ? '#e6f2ff' : '#fff', border: `2px solid ${isSelected ? '#007bff' : '#ccc'}`, padding: '15px', cursor: 'pointer', transition: '0.2s', borderLeft: isSelected ? '6px solid #007bff' : '6px solid #ccc' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                            <span style={{ fontWeight: 'bold', color: isSelected ? '#007bff' : '#333', fontSize: '1.1rem' }}>{job.jobId}</span>
                                            <button onClick={(e) => handleDeleteJob(job.id, e)} style={{ background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', fontSize: '1.1rem' }} title="Reject Job">✖</button>
                                        </div>
                                        <div style={{ fontSize: '0.9rem', color: '#000', fontWeight: 'bold' }}>{job.customer?.name || "Unknown Client"}</div>
                                        <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '5px' }}>Sidemark: {job.sidemark}</div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* RIGHT: LINE ITEM DISSECTION & ROUTING */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '15px' }}>
                        {!activeJob ? ( 
                            <div style={{ flex: 1, background: '#fff', border: '2px dashed #ccc', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontWeight: 'bold', fontSize: '1.2rem' }}>
                                SELECT A JOB TO INJECT ERP DATA AND DISPATCH
                            </div> 
                        ) : (
                            <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '8px 8px 0 rgba(0,0,0,0.1)' }}>
                                
                                {/* GLOBAL JOB INFO */}
                                <div style={{ padding: '20px', background: '#eafaf1', borderBottom: '2px solid #000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: '#1e7e34' }}>JOB DISPATCH ROUTER</div>
                                        <div style={{ fontSize: '0.9rem', color: '#666', marginTop: '5px' }}>Routing configured line items to factory floor apps.</div>
                                    </div>
                                    
                                    <div style={{ background: '#fff', padding: '10px 15px', border: '2px solid #1e7e34', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <label style={{ fontWeight: 'bold', fontSize: '0.9rem', color: '#1e7e34' }}>SALES ORDER #:</label>
                                        <input 
                                            type="text" 
                                            placeholder="e.g. SO-99214" 
                                            value={dispatchForm.soNum} 
                                            onChange={e => setDispatchForm({...dispatchForm, soNum: e.target.value})} 
                                            style={{ padding: '8px', fontSize: '1.1rem', border: '2px solid #ccc', outline: 'none', fontWeight: 'bold', width: '200px' }} 
                                        />
                                    </div>
                                </div>

                                {/* LINE ITEM ROUTING TABLE */}
                                <div style={{ padding: '20px', flex: 1 }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                        <thead>
                                            <tr style={{ background: '#333', color: '#fff', fontSize: '0.85rem' }}>
                                                <th style={{ padding: '12px', textAlign: 'left', borderBottom: '2px solid #000' }}>COMPONENT NAME / DESCRIPTION</th>
                                                <th style={{ padding: '12px', textAlign: 'left', borderBottom: '2px solid #000', width: '150px' }}>WORK ORDER #</th>
                                                <th style={{ padding: '12px', textAlign: 'left', borderBottom: '2px solid #000', width: '200px' }}>FACTORY DESTINATION</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {Object.entries(dispatchForm.lines).map(([partId, config]) => {
                                                const rowBg = config.woNum ? '#f4fbff' : '#fff';
                                                return (
                                                    <tr key={partId} style={{ borderBottom: '1px solid #ccc', background: rowBg }}>
                                                        <td style={{ padding: '15px', fontSize: '0.95rem' }}>
                                                            {config.isMaster && <span style={{ background: '#000', color: '#fff', padding: '3px 6px', fontSize: '0.65rem', marginRight: '10px', borderRadius: '3px', fontWeight: 'bold' }}>MASTER</span>}
                                                            <strong style={{ color: config.isMaster ? '#000' : '#555' }}>{getPartName(partId)}</strong>
                                                            <div style={{ fontSize: '0.7rem', color: '#888', marginTop: '4px' }}>PLM ID: {partId}</div>
                                                        </td>
                                                        <td style={{ padding: '15px' }}>
                                                            <input 
                                                                type="text" 
                                                                placeholder="WO #" 
                                                                value={config.woNum}
                                                                onChange={(e) => setDispatchForm(prev => ({
                                                                    ...prev, 
                                                                    lines: { ...prev.lines, [partId]: { ...config, woNum: e.target.value } }
                                                                }))}
                                                                style={{ width: '100%', padding: '10px', border: config.woNum ? '2px solid #007bff' : '1px solid #ccc', fontWeight: 'bold', boxSizing: 'border-box' }}
                                                            />
                                                        </td>
                                                        <td style={{ padding: '15px' }}>
                                                            <select 
                                                                value={config.route}
                                                                onChange={(e) => setDispatchForm(prev => ({
                                                                    ...prev, 
                                                                    lines: { ...prev.lines, [partId]: { ...config, route: e.target.value } }
                                                                }))}
                                                                style={{ width: '100%', padding: '10px', border: '2px solid #333', fontWeight: 'bold', background: '#fff', cursor: 'pointer' }}
                                                            >
                                                                <option value="SHOP_FLOOR">Shop Floor (Custom Tab)</option>
                                                                <option value="FINISHING_FLOOR">Finishing Floor (Paint)</option>
                                                                <option value="BOTH">Both Floors (Routed)</option>
                                                            </select>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>

                                <div style={{ padding: '20px', background: '#f8f9fa', borderTop: '2px solid #000', display: 'flex', justifyContent: 'flex-end', gap: '15px' }}>
                                    <button 
                                        onClick={handleOverrideAndPush}
                                        style={{ padding: '15px 30px', background: '#ffc107', color: '#000', fontSize: '1.2rem', fontWeight: 'bold', border: '2px solid #856404', cursor: 'pointer', boxShadow: '4px 4px 0 #856404' }}
                                    >
                                        ⚠️ TEST: OVERRIDE & PUSH
                                    </button>
                                    <button 
                                        onClick={handleExecuteDispatch}
                                        style={{ padding: '15px 30px', background: '#d9534f', color: '#fff', fontSize: '1.2rem', fontWeight: 'bold', border: 'none', cursor: 'pointer', boxShadow: '4px 4px 0 #851c19' }}
                                    >
                                        EXECUTE FLOOR DISPATCH 🚀
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )}
      </div>

      <div style={{ height: '120px', flexShrink: 0, background: '#1e1e1e', border: '2px solid #000', padding: '15px', color: '#00ff00', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '5px', boxShadow: '5px 5px 0 #000' }}>
          <div style={{ borderBottom: '1px solid #444', paddingBottom: '5px', marginBottom: '5px', fontSize: '0.7rem', color: '#aaa', fontWeight: 'bold' }}>{`// SYSTEM EVENT LOG`}</div>
          {terminalLogs.map((log, i) => <div key={i} style={{ fontSize: '0.75rem' }}>{log}</div> )}
      </div>

      {mapperConfig && !mapperConfig.isProcessing && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
            <div style={{ background: '#fff', border: '4px solid #000', width: '90%', maxWidth: '1000px', display: 'flex', flexDirection: 'column', boxShadow: '20px 20px 0 #000' }}>
                <div style={{ padding: '20px', background: '#28a745', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000' }}>
                    <div><h2 style={{ margin: 0, fontSize: '1.5rem', textTransform: 'uppercase' }}>ETL Mapper: {mapperConfig.windowConfig ? mapperConfig.windowConfig.name : mapperConfig.type.replace(/_/g, ' ')}</h2></div>
                    <button onClick={() => setMapperConfig(null)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '2rem', cursor: 'pointer' }}>×</button>
                </div>
                <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                    <div style={{ flex: 1.5, padding: '20px', borderRight: '2px solid #000', overflowY: 'auto', background: '#f8f9fa' }}>
                        <div style={{ fontWeight: 'bold', marginBottom: '15px', color: '#000', borderBottom: '2px solid #ccc', paddingBottom: '5px' }}>COLUMN ALIGNMENT</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                            {(mapperConfig.type === 'DYNAMIC_ASSET' ? getDynamicSchema(mapperConfig.windowConfig) : dynamicSchemas[mapperConfig.type]).map(schemaField => (
                                <div key={schemaField.key} style={{ display: 'flex', alignItems: 'center', gap: '15px', background: '#fff', padding: '10px', border: '1px solid #ccc' }}>
                                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}><span style={{ fontWeight: 'bold', fontSize: '0.85rem' }}>{schemaField.label}</span></div>
                                    <div style={{ fontSize: '1.2rem', color: '#ccc' }}>➔</div>
                                    <div style={{ flex: 1 }}>
                                        <select value={fieldMap[schemaField.key] || ""} onChange={(e) => setFieldMap({ ...fieldMap, [schemaField.key]: e.target.value })} style={{ width: '100%', padding: '8px', fontSize: '0.85rem', border: `2px solid ${fieldMap[schemaField.key] ? '#28a745' : '#ccc'}` }}>
                                            <option value="">-- Ignore --</option>
                                            {mapperConfig.headers.map(header => <option key={header} value={header}>{header}</option>)}
                                        </select>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', background: '#fff' }}>
                        <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#666', textAlign: 'center' }}>Total Rows Detected: {mapperConfig.data.length}</div>
                            <button onClick={executeImport} style={{ padding: '15px', background: '#28a745', color: '#fff', fontWeight: 'bold', fontSize: '1.2rem', border: '2px solid #000', cursor: 'pointer', boxShadow: '3px 3px 0 #1e7e34' }}>EXECUTE IMPORT</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
      )}

    </div>
  );
};

export default ERPPushPullTab;