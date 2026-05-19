import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, query, where, doc, writeBatch, updateDoc, addDoc, serverTimestamp, getDocs } from "firebase/firestore";

// --- EXTENDED APP TARGET SCHEMAS ---
const SCHEMAS = {
    INVENTORY: [
        { key: 'legacyErpId', label: 'NS Internal ID (Unique)', required: true },
        { key: 'itemName', label: 'Item Name / Description', required: true },
        { key: 'productType', label: 'Product Type', required: false },
        { key: 'basePrice', label: 'Base Price ($)', required: true },
        { key: 'cost', label: 'Unit Cost ($)', required: false },
        { key: 'uom', label: 'Unit of Measure', required: false },
        { key: 'finishDetail', label: 'Finish', required: false },
        { key: 'vendorName', label: 'Vendor Name', required: false }
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
    ]
};

const ERPPushPullTab = ({ currentUser, activeBrand }) => {
  const [activeView, setActiveView] = useState('NETSUITE'); 
  const [prodSubView, setProdSubView] = useState('DISPATCH'); 
  const [syncCategory, setSyncCategory] = useState('FABRICATION'); 
  
  // --- LIVE DATA STATE ---
  const [jobs, setJobs] = useState([]);
  const [activeJobId, setActiveJobId] = useState(null);
  const [syncData, setSyncData] = useState({ FABRICATION: { outbound: [], inbound: [] }, FINISHING: { outbound: [], inbound: [] } });
  
  // --- NS EXPORT TRACKING ---
  const [nsMetrics, setNsMetrics] = useState({ invTotal: 0, invPending: 0, asmTotal: 0, asmPending: 0, bomTotal: 0 });

  const [terminalLogs, setTerminalLogs] = useState(["> SYSTEM ONLINE. WAITING FOR LIVE DISPATCH COMMANDS..."]);
  const [mapperConfig, setMapperConfig] = useState(null); 
  const [fieldMap, setFieldMap] = useState({});
  
  const fileInputInvRef = useRef(null);
  const fileInputAsmRef = useRef(null);
  const fileInputBomRef = useRef(null);

  const activeJob = jobs.find(j => j.id === activeJobId);

  const logToTerminal = (message) => setTerminalLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);

  // ============================================================================
  // LIVE FIREBASE LISTENERS (Data Sync & NS Metrics)
  // ============================================================================
  useEffect(() => {
    // 1. LISTEN FOR APPROVED JOBS
    const qJobs = query(collection(db, "Jobs"), where("status", "==", "APPROVED"));
    const unsubJobs = onSnapshot(qJobs, (snap) => {
        const fetchedJobs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setJobs(fetchedJobs);
        if (fetchedJobs.length > 0 && !activeJobId) setActiveJobId(fetchedJobs[0].id);
    });

    // 2. FETCH NS METRICS (Inventory & Assemblies)
    const qParts = query(collection(db, "Approved_Designs"));
    const unsubParts = onSnapshot(qParts, (snap) => {
        const parts = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        const inv = parts.filter(p => p.partClass === "Inventory");
        const asm = parts.filter(p => p.partClass === "Assembly");
        
        setNsMetrics(prev => ({
            ...prev,
            invTotal: inv.length,
            invPending: inv.filter(p => p.legacyErpId === "PENDING").length,
            asmTotal: asm.length,
            asmPending: asm.filter(p => p.legacyErpId === "PENDING").length
        }));

        // Populate Outbound Fabrication (Missing Programs)
        const missingPrograms = inv.filter(p => p.manufacturingSpecs?.isInHouse && (!p.manufacturingSpecs?.programNum || p.manufacturingSpecs.programNum === ""))
            .map(p => ({ id: p.id, name: p.itemName, type: p.manufacturingSpecs?.productType, status: "Missing CNC Program" }));
        setSyncData(prev => ({ ...prev, FABRICATION: { ...prev.FABRICATION, outbound: missingPrograms } }));
    });

    // 3. FETCH NS METRICS (BOMs)
    const qBoms = query(collection(db, "assembly_pins"));
    const unsubBoms = onSnapshot(qBoms, (snap) => {
        setNsMetrics(prev => ({ ...prev, bomTotal: snap.docs.length }));
    });

    // 4. LISTEN FOR FINISHING / INBOUND (Unchanged from before)
    const unsubFinishes = onSnapshot(doc(db, "system", "master_finishes"), (docSnap) => {
        if (docSnap.exists() && docSnap.data().finishes) {
            const missingRecipes = docSnap.data().finishes.filter(f => !f.hasFloorRecipe).map(f => ({ id: f.id, name: f.name, type: f.type, status: "Pending Floor Recipe" }));
            setSyncData(prev => ({ ...prev, FINISHING: { ...prev.FINISHING, outbound: missingRecipes } }));
        }
    });

    return () => { unsubJobs(); unsubParts(); unsubBoms(); unsubFinishes(); };
  }, [activeJobId]);


  // ============================================================================
  // NETSUITE DYNAMIC CSV EXPORTERS
  // ============================================================================
  const generateNetSuiteCSV = async (type) => {
      logToTerminal(`[NS HUB] QUERYING DATABASE FOR ${type} EXPORT...`);
      let csvContent = "data:text/csv;charset=utf-8,";
      let count = 0;

      try {
          if (type === 'INVENTORY') {
              const snap = await getDocs(query(collection(db, "Approved_Designs"), where("partClass", "==", "Inventory")));
              csvContent += "PLM_ID,NS_InternalID,ItemName,ProductType,BasePrice,Cost,UOM,Finish,Vendor\n";
              snap.docs.forEach(d => {
                  const data = d.data();
                  const specs = data.manufacturingSpecs || {};
                  // Only push if it was created in the app (PENDING) or if you want a full sync
                  csvContent += `${data.id},${data.legacyErpId || ''},"${data.itemName || ''}",${specs.productType || ''},${specs.basePrice || 0},${specs.cost || 0},${specs.uom || ''},"${specs.finishDetail || ''}","${specs.vendorName || ''}"\n`;
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
              // BOM requires joining the assembly ID and the component ID
              const asmSnap = await getDocs(query(collection(db, "Approved_Designs"), where("partClass", "==", "Assembly")));
              const assemblies = {};
              asmSnap.docs.forEach(d => assemblies[d.data().itemId] = d.data().legacyErpId || "PENDING");

              const pinSnap = await getDocs(collection(db, "assembly_pins"));
              csvContent += "Assembly_NS_ID,Component_NS_ID,Quantity\n";
              pinSnap.docs.forEach(d => {
                  const data = d.data();
                  const asmErpId = assemblies[data.assemblyId] || data.assemblyId;
                  csvContent += `${asmErpId},${data.legacyErpId || data.partId},${data.defaultQty || 1}\n`;
                  count++;
              });
          }
          else if (type === 'SALES_ORDER') {
              csvContent += "ExternalID,Customer,Date,Item,Quantity,Rate,Amount,Memo\n";
              activeJob?.cpqData?.items?.forEach(item => { 
                  csvContent += `${activeJob.jobId},${activeJob.customer?.name || ''},${new Date().toLocaleDateString()},${item.sku},${item.qty},0.00,0.00,${activeJob.sidemark || ''}\n`; 
                  count++;
              });
          }

          logToTerminal(`✅ [NS HUB] GENERATED CSV WITH ${count} ROWS. DOWNLOADING...`);
          const encodedUri = encodeURI(csvContent);
          const link = document.createElement("a"); 
          link.setAttribute("href", encodedUri); 
          link.setAttribute("download", `NS_SYNC_${type.toUpperCase()}_${Date.now()}.csv`);
          document.body.appendChild(link); link.click(); document.body.removeChild(link);

      } catch (err) {
          console.error(err);
          logToTerminal(`❌ [NS ERROR] CSV EXPORT FAILED.`);
      }
  };


  // ============================================================================
  // ETL CSV IMPORTER ENGINE
  // ============================================================================
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

  const handleImportClick = (e, importType) => {
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
              if (hLower.includes('itemname') || hLower.includes('displayname')) initialMap['itemName'] = h;
              if (hLower.includes('baseprice') || hLower === 'price') initialMap['basePrice'] = h;
              if (hLower.includes('cost') || hLower === 'purchaseprice') initialMap['cost'] = h;
              if (hLower === 'type') initialMap['productType'] = h;
              if (hLower.includes('parent') || hLower.includes('assembly')) initialMap['assemblyErpId'] = h;
              if (hLower.includes('component') || hLower.includes('member')) initialMap['componentErpId'] = h;
              if (hLower.includes('qty') || hLower === 'quantity') initialMap['qty'] = h;
          });
          setFieldMap(initialMap); setMapperConfig({ type: importType, data, headers });
          if (fileInputInvRef.current) fileInputInvRef.current.value = '';
          if (fileInputAsmRef.current) fileInputAsmRef.current.value = '';
          if (fileInputBomRef.current) fileInputBomRef.current.value = '';
      };
      reader.readAsText(file);
  };

  const executeImport = async () => {
      const schema = SCHEMAS[mapperConfig.type];
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
                  const docRef = doc(db, "Approved_Designs", newId);
                  batch.set(docRef, {
                      id: newId, itemId: newId, legacyErpId: mappedRow.legacyErpId.toUpperCase() || "PENDING", itemName: mappedRow.itemName.toUpperCase(),
                      brandId: currentBrand, partClass: "Inventory", sharedBrands: [currentBrand], 
                      manufacturingSpecs: { productType: mappedRow.productType || "COMPONENT", cost: parseFloat(mappedRow.cost) || 0, basePrice: parseFloat(mappedRow.basePrice) || 0, uom: mappedRow.uom || "EA", finishDetail: mappedRow.finishDetail || "N/A", vendorName: mappedRow.vendorName || "" }
                  }, { merge: true });
              } 
              else if (mapperConfig.type === 'ASSEMBLIES' && mappedRow.itemName) {
                  const newId = `${currentBrand.toUpperCase()}-ASM-${mappedRow.legacyErpId || Math.floor(1000+Math.random()*90000)}`;
                  const docRef = doc(db, "Approved_Designs", newId);
                  batch.set(docRef, {
                      id: newId, itemId: newId, partClass: "Assembly", brandId: currentBrand, legacyErpId: mappedRow.legacyErpId.toUpperCase() || "PENDING", itemName: mappedRow.itemName.toUpperCase(), lifecycleStatus: "APPROVED"
                  }, { merge: true });
              }
              else if (mapperConfig.type === 'BOMS' && mappedRow.assemblyErpId && mappedRow.componentErpId) {
                  const newId = `BOM-${Math.floor(10000+Math.random()*90000)}`;
                  const docRef = doc(db, "assembly_pins", newId);
                  batch.set(docRef, {
                      id: newId,
                      assemblyId: mappedRow.assemblyErpId.toUpperCase(), // Using ERP ID directly for now
                      partId: mappedRow.componentErpId.toUpperCase(),
                      legacyErpId: mappedRow.componentErpId.toUpperCase(),
                      partName: "NS IMPORTED COMPONENT",
                      defaultQty: parseInt(mappedRow.qty) || 1,
                      isExistingLibraryPart: true,
                      author: "NS_SYNC",
                      createdAt: new Date().toISOString()
                  });
              }
              count++;
          });
          await batch.commit();
          logToTerminal(`✅ [MDM SUCCESS] ${count} ITEMS MAPPED & IMPORTED!`); alert(`Success! ${count} items were imported.`); setMapperConfig(null); 
      } catch (error) {
          console.error(error); logToTerminal(`❌ [MDM ERROR] IMPORT FAILED: ${error.message}`); alert("Import failed."); setMapperConfig({ ...mapperConfig, isProcessing: false });
      }
  };

  const handleDispatch = async (node) => {
      if (!activeJob) return;
      logToTerminal(`INITIATING LIVE PUSH TO ${node.toUpperCase()} NODE...`);
      try {
          await updateDoc(doc(db, "Jobs", activeJob.id), { [`dispatchStatus.${node}`]: true, updatedAt: serverTimestamp() });
          logToTerminal(`✅ SUCCESS: ${activeJob.jobId} -> ${node.toUpperCase()} QUEUE.`);
      } catch (err) { logToTerminal(`❌ ERROR: Failed to dispatch job to ${node}.`); }
  };

  const handleSyncData = async (category, direction, id) => {
      if (direction === 'outbound') {
          logToTerminal(`📡 SENDING REQUEST TO ${category} FLOOR APP...`);
          try {
              await addDoc(collection(db, "floor_sync_requests"), { category, type: "DATA_REQUEST", targetId: id, status: "SENT_TO_FLOOR", createdAt: serverTimestamp() });
              logToTerminal(`✅ FLOOR APP RECEIVED DATA. WAITING FOR OPERATOR INPUT.`);
          } catch (err) { console.error(err); }
      } else {
          logToTerminal(`📡 INGESTING ${category} RECORD INTO MASTER PLM...`);
          try {
              await updateDoc(doc(db, "floor_sync_requests", id), { status: "APPROVED", updatedAt: serverTimestamp() });
              logToTerminal(`✅ INGESTED TO TAB 4 MASTER LIBRARY.`);
          } catch (err) { console.error(err); }
      }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', fontFamily: 'monospace', backgroundColor: '#e5e5e5', minHeight: '100vh', position: 'relative' }}>
      
      <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '5px 5px 0 #000' }}>
        <div><h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.4rem', color: '#007bff' }}>12. ERP & Data Mapping</h2><span style={{ fontSize: '0.7rem', color: '#666' }}>NETSUITE HUB & FIREBASE SPOKE ROUTING</span></div>
        <div style={{ display: 'flex', gap: '10px', background: '#eee', padding: '5px', border: '2px solid #000' }}>
          <button onClick={() => setActiveView('NETSUITE')} style={{ padding: '8px 20px', background: activeView === 'NETSUITE' ? '#007bff' : 'transparent', color: activeView === 'NETSUITE' ? '#fff' : '#666', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>🔄 NETSUITE HUB (SYNC)</button>
          <button onClick={() => setActiveView('PRODUCTION')} style={{ padding: '8px 20px', background: activeView === 'PRODUCTION' ? '#d9534f' : 'transparent', color: activeView === 'PRODUCTION' ? '#fff' : '#666', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>🏭 PRODUCTION SPOKES (ROUTING)</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '20px', alignItems: 'stretch', flex: 1 }}>

        {/* ========================================================================= */}
        {/* VIEW 1: NETSUITE HUB                                                      */}
        {/* ========================================================================= */}
        {activeView === 'NETSUITE' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                    
                    {/* INVENTORY */}
                    <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 rgba(0,0,0,0.1)' }}>
                        <div style={{ padding: '10px 15px', background: '#28a745', color: '#fff', fontWeight: 'bold', borderBottom: '2px solid #000', display: 'flex', justifyContent: 'space-between' }}>
                            <span>📦 INVENTORY (ITEMS)</span>
                            {nsMetrics.invPending > 0 && <span style={{ background: '#ffc107', color: '#000', padding: '2px 6px', fontSize: '0.7rem', borderRadius: '4px' }}>{nsMetrics.invPending} PENDING PUSH</span>}
                        </div>
                        <div style={{ padding: '15px', fontSize: '0.8rem', flex: 1 }}>
                            <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{nsMetrics.invTotal} Total Items</div>
                            <div style={{ color: '#555', marginTop: '5px' }}>Items created in the PLM without a NetSuite ID will be flagged as Pending Push.</div>
                        </div>
                        <div style={{ display: 'flex', borderTop: '2px solid #000', marginTop: 'auto' }}>
                            <input type="file" accept=".csv" ref={fileInputInvRef} onChange={(e) => handleImportClick(e, 'INVENTORY')} style={{ display: 'none' }} />
                            <button onClick={() => fileInputInvRef.current.click()} style={{ flex: 1.5, padding: '15px 10px', background: '#eafaf1', color: '#28a745', fontWeight: 'bold', cursor: 'pointer', border: 'none', borderRight: '2px solid #000' }}>⬆️ IMPORT CSV</button>
                            <button onClick={() => generateNetSuiteCSV('INVENTORY')} style={{ flex: 1, padding: '15px 10px', background: '#28a745', color: '#fff', fontWeight: 'bold', cursor: 'pointer', border: 'none' }}>⬇️ EXPORT {nsMetrics.invPending > 0 ? 'PENDING' : 'ALL'}</button>
                        </div>
                    </div>

                    {/* ASSEMBLIES */}
                    <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 rgba(0,0,0,0.1)' }}>
                        <div style={{ padding: '10px 15px', background: '#6c757d', color: '#fff', fontWeight: 'bold', borderBottom: '2px solid #000', display: 'flex', justifyContent: 'space-between' }}>
                            <span>⚙️ MASTER ASSEMBLIES</span>
                            {nsMetrics.asmPending > 0 && <span style={{ background: '#ffc107', color: '#000', padding: '2px 6px', fontSize: '0.7rem', borderRadius: '4px' }}>{nsMetrics.asmPending} PENDING PUSH</span>}
                        </div>
                        <div style={{ padding: '15px', fontSize: '0.8rem', flex: 1 }}>
                            <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{nsMetrics.asmTotal} Total Assemblies</div>
                            <div style={{ color: '#555', marginTop: '5px' }}>Parent Assembly headers used in CPQ and Manufacturing logic.</div>
                        </div>
                        <div style={{ display: 'flex', borderTop: '2px solid #000', marginTop: 'auto' }}>
                            <input type="file" accept=".csv" ref={fileInputAsmRef} onChange={(e) => handleImportClick(e, 'ASSEMBLIES')} style={{ display: 'none' }} />
                            <button onClick={() => fileInputAsmRef.current.click()} style={{ flex: 1.5, padding: '15px 10px', background: '#f8f9fa', color: '#6c757d', fontWeight: 'bold', cursor: 'pointer', border: 'none', borderRight: '2px solid #000' }}>⬆️ IMPORT CSV</button>
                            <button onClick={() => generateNetSuiteCSV('ASSEMBLIES')} style={{ flex: 1, padding: '15px 10px', background: '#6c757d', color: '#fff', fontWeight: 'bold', cursor: 'pointer', border: 'none' }}>⬇️ EXPORT {nsMetrics.asmPending > 0 ? 'PENDING' : 'ALL'}</button>
                        </div>
                    </div>

                    {/* BOMS */}
                    <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 rgba(0,0,0,0.1)' }}>
                        <div style={{ padding: '10px 15px', background: '#17a2b8', color: '#fff', fontWeight: 'bold', borderBottom: '2px solid #000', display: 'flex', justifyContent: 'space-between' }}>
                            <span>🏗️ MASTER BOMS (COMPONENTS)</span>
                        </div>
                        <div style={{ padding: '15px', fontSize: '0.8rem', flex: 1 }}>
                            <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{nsMetrics.bomTotal} Total BOM Connections</div>
                            <div style={{ color: '#555', marginTop: '5px' }}>Links Component Items to Assembly Items. Push these *after* syncing Items and Assemblies.</div>
                        </div>
                        <div style={{ display: 'flex', borderTop: '2px solid #000', marginTop: 'auto' }}>
                            <input type="file" accept=".csv" ref={fileInputBomRef} onChange={(e) => handleImportClick(e, 'BOMS')} style={{ display: 'none' }} />
                            <button onClick={() => fileInputBomRef.current.click()} style={{ flex: 1.5, padding: '15px 10px', background: '#e0f7fa', color: '#17a2b8', fontWeight: 'bold', cursor: 'pointer', border: 'none', borderRight: '2px solid #000' }}>⬆️ IMPORT CSV</button>
                            <button onClick={() => generateNetSuiteCSV('BOMS')} style={{ flex: 1, padding: '15px 10px', background: '#17a2b8', color: '#fff', fontWeight: 'bold', cursor: 'pointer', border: 'none' }}>⬇️ EXPORT BOMS</button>
                        </div>
                    </div>

                    {/* CUSTOMERS / SO SYNC */}
                    <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 rgba(0,0,0,0.1)' }}>
                        <div style={{ padding: '10px 15px', background: '#000', color: '#fff', fontWeight: 'bold', borderBottom: '2px solid #000' }}>📑 TRANSACTIONAL SYNC</div>
                        <div style={{ padding: '15px', fontSize: '0.8rem', flex: 1, color: '#666', fontStyle: 'italic' }}>
                            Sales Orders and Customer sync generated directly from the Dispatch Queue.
                        </div>
                        <div style={{ display: 'flex', borderTop: '2px solid #000', marginTop: 'auto' }}>
                            <button onClick={() => generateNetSuiteCSV('SALES_ORDER')} style={{ flex: 1, padding: '15px 10px', background: '#000', color: '#fff', fontWeight: 'bold', cursor: 'pointer', border: 'none' }}>📥 EXPORT SALES ORDERS</button>
                        </div>
                    </div>

                </div>
            </div>
        )}

        {/* ========================================================================= */}
        {/* VIEW 2: PRODUCTION ROUTING & CROSS-APP DATA SYNC                          */}
        {/* ========================================================================= */}
        {activeView === 'PRODUCTION' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div style={{ display: 'flex', gap: '10px', background: '#e9ecef', padding: '10px', border: '2px solid #000' }}>
                    <button onClick={() => setProdSubView('DISPATCH')} style={{ padding: '10px 20px', background: prodSubView === 'DISPATCH' ? '#000' : 'transparent', color: prodSubView === 'DISPATCH' ? '#fff' : '#000', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>🚀 JOB DISPATCH QUEUE</button>
                    <button onClick={() => setProdSubView('DATA_SYNC')} style={{ padding: '10px 20px', background: prodSubView === 'DATA_SYNC' ? '#007bff' : 'transparent', color: prodSubView === 'DATA_SYNC' ? '#fff' : '#000', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>🔄 CROSS-APP DATA SYNC</button>
                </div>

                {prodSubView === 'DISPATCH' && (
                    <div style={{ display: 'flex', gap: '20px', flex: 1 }}>
                        <div style={{ width: '380px', display: 'flex', flexDirection: 'column', flexShrink: 0, background: '#fff', border: '2px solid #000', boxShadow: '8px 8px 0 rgba(0,0,0,0.1)' }}>
                            <div style={{ padding: '12px 15px', background: '#000', color: '#fff', borderBottom: '2px solid #000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>📥 DISPATCH QUEUE</span><span style={{ fontSize: '0.8rem', fontWeight: 'bold', background: '#28a745', padding: '3px 8px', borderRadius: '12px' }}>{jobs.length} READY</span>
                            </div>
                            <div style={{ padding: '15px', display: 'flex', flexDirection: 'column', gap: '10px', background: '#f8f9fa', minHeight: '500px', overflowY: 'auto' }}>
                                {jobs.length === 0 && <div style={{ color: '#999', fontStyle: 'italic', fontSize: '0.8rem', textAlign: 'center' }}>Queue is empty.</div>}
                                {jobs.map(job => {
                                    const isSelected = job.id === activeJobId;
                                    return (
                                        <div key={job.id} onClick={() => setActiveJobId(job.id)} style={{ background: isSelected ? '#e6f2ff' : '#fff', border: `2px solid ${isSelected ? '#007bff' : '#ccc'}`, padding: '12px', cursor: 'pointer' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}><span style={{ fontWeight: 'bold', color: isSelected ? '#007bff' : '#333' }}>{job.jobId}</span></div>
                                            <div style={{ fontSize: '0.8rem', color: '#666', fontWeight: 'bold' }}>{job.customer?.name || "Unknown"}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '15px' }}>
                            {!activeJob ? ( <div style={{ flex: 1, background: '#fff', border: '2px dashed #ccc', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontWeight: 'bold' }}>SELECT A JOB TO ROUTE</div> ) : (
                                <>
                                    <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', boxShadow: '5px 5px 0 #d9534f' }}>
                                        <div style={{ padding: '15px', flex: 1, display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                            <div style={{ fontWeight: 'bold', fontSize: '1rem', color: '#d9534f', borderBottom: '1px solid #eee', paddingBottom: '5px' }}>🏭 FIREBASE: SHOP FLOOR APP</div>
                                        </div>
                                        <div style={{ width: '180px', background: '#f8f9fa', borderLeft: '2px solid #000', display: 'flex', padding: '15px' }}>
                                            <button onClick={() => handleDispatch('fabrication')} disabled={activeJob.dispatchStatus?.fabrication} style={{ width: '100%', background: activeJob.dispatchStatus?.fabrication ? '#ccc' : '#d9534f', color: '#fff', fontWeight: 'bold', border: '2px solid #000', cursor: activeJob.dispatchStatus?.fabrication ? 'not-allowed' : 'pointer' }}>{activeJob.dispatchStatus?.fabrication ? '✅ ROUTED' : 'PUSH TO SHOP'}</button>
                                        </div>
                                    </div>
                                    <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', boxShadow: '5px 5px 0 #6f42c1' }}>
                                        <div style={{ padding: '15px', flex: 1, display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                            <div style={{ fontWeight: 'bold', fontSize: '1rem', color: '#6f42c1', borderBottom: '1px solid #eee', paddingBottom: '5px' }}>🎨 FIREBASE: FINISHING FLOOR APP</div>
                                        </div>
                                        <div style={{ width: '180px', background: '#f8f9fa', borderLeft: '2px solid #000', display: 'flex', padding: '15px' }}>
                                            <button onClick={() => handleDispatch('finishing')} disabled={activeJob.dispatchStatus?.finishing} style={{ width: '100%', background: activeJob.dispatchStatus?.finishing ? '#ccc' : '#6f42c1', color: '#fff', fontWeight: 'bold', border: '2px solid #000', cursor: activeJob.dispatchStatus?.finishing ? 'not-allowed' : 'pointer' }}>{activeJob.dispatchStatus?.finishing ? '✅ ROUTED' : 'PUSH TO PAINT'}</button>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}

                {prodSubView === 'DATA_SYNC' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', flex: 1 }}>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button onClick={() => setSyncCategory('FABRICATION')} style={{ padding: '10px 20px', background: syncCategory === 'FABRICATION' ? '#d9534f' : '#f8f9fa', color: syncCategory === 'FABRICATION' ? '#fff' : '#666', border: `2px solid ${syncCategory === 'FABRICATION' ? '#000' : '#ccc'}`, fontWeight: 'bold', cursor: 'pointer' }}>🏭 FABRICATION DEPT (PROGRAMS)</button>
                            <button onClick={() => setSyncCategory('FINISHING')} style={{ padding: '10px 20px', background: syncCategory === 'FINISHING' ? '#6f42c1' : '#f8f9fa', color: syncCategory === 'FINISHING' ? '#fff' : '#666', border: `2px solid ${syncCategory === 'FINISHING' ? '#000' : '#ccc'}`, fontWeight: 'bold', cursor: 'pointer' }}>🎨 FINISHING DEPT (RECIPES)</button>
                        </div>
                        <div style={{ display: 'flex', gap: '20px', flex: 1 }}>
                            
                            {/* OUTBOUND */}
                            <div style={{ flex: 1, background: '#fff', border: `2px solid ${syncCategory === 'FINISHING' ? '#6f42c1' : '#d9534f'}`, display: 'flex', flexDirection: 'column', boxShadow: `8px 8px 0 ${syncCategory === 'FINISHING' ? 'rgba(111, 66, 193, 0.2)' : 'rgba(217, 83, 79, 0.2)'}` }}>
                                <div style={{ padding: '15px', background: syncCategory === 'FINISHING' ? '#6f42c1' : '#d9534f', color: '#fff', borderBottom: '2px solid #000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>📤 OUTBOUND: PLM TO FLOOR</span>
                                    <span style={{ fontSize: '0.8rem', fontWeight: 'bold', background: '#fff', color: syncCategory === 'FINISHING' ? '#6f42c1' : '#d9534f', padding: '3px 8px', borderRadius: '12px' }}>{syncData[syncCategory]?.outbound.length || 0} PENDING</span>
                                </div>
                                <div style={{ padding: '20px', flex: 1, background: '#f8f9fa', overflowY: 'auto' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                        {syncData[syncCategory]?.outbound.length === 0 && <div style={{ textAlign: 'center', color: '#999', marginTop: '40px' }}>All items mapped.</div>}
                                        {syncData[syncCategory]?.outbound.map(item => (
                                            <div key={item.id} style={{ background: '#fff', border: '1px solid #ccc', borderLeft: '5px solid #ffc107', padding: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <div>
                                                    <div style={{ fontWeight: 'bold', fontSize: '1rem', color: '#333' }}>{item.name}</div>
                                                    <div style={{ fontSize: '0.7rem', color: '#666' }}>ID: {item.id} | Type: {item.type}</div>
                                                    <div style={{ fontSize: '0.7rem', color: '#d9534f', fontWeight: 'bold', marginTop: '5px' }}>⚠️ {item.status}</div>
                                                </div>
                                                <button onClick={() => handleSyncData(syncCategory, 'outbound', item.id)} style={{ padding: '10px 15px', background: syncCategory === 'FINISHING' ? '#6f42c1' : '#d9534f', color: '#fff', fontWeight: 'bold', border: '2px solid #000', cursor: 'pointer' }}>🔔 PING FLOOR APP</button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* INBOUND */}
                            <div style={{ flex: 1, background: '#fff', border: '2px solid #28a745', display: 'flex', flexDirection: 'column', boxShadow: '8px 8px 0 rgba(40, 167, 69, 0.2)' }}>
                                <div style={{ padding: '15px', background: '#28a745', color: '#fff', borderBottom: '2px solid #000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>📥 INBOUND: FLOOR TO PLM</span>
                                    <span style={{ fontSize: '0.8rem', fontWeight: 'bold', background: '#fff', color: '#28a745', padding: '3px 8px', borderRadius: '12px' }}>{syncData[syncCategory]?.inbound.length || 0} PENDING</span>
                                </div>
                                <div style={{ padding: '20px', flex: 1, background: '#f8f9fa', overflowY: 'auto' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                        {syncData[syncCategory]?.inbound.length === 0 && <div style={{ textAlign: 'center', color: '#999', marginTop: '40px' }}>No inbound items.</div>}
                                        {syncData[syncCategory]?.inbound.map(item => (
                                            <div key={item.id} style={{ background: '#fff', border: '1px solid #ccc', borderLeft: '5px solid #17a2b8', padding: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <div>
                                                    <div style={{ fontWeight: 'bold', fontSize: '1rem', color: '#333' }}>{item.name}</div>
                                                    <div style={{ fontSize: '0.7rem', color: '#666' }}>ID: {item.id} | Author: {item.author}</div>
                                                    <div style={{ fontSize: '0.7rem', color: '#17a2b8', fontWeight: 'bold', marginTop: '5px' }}>ℹ️ {item.status}</div>
                                                </div>
                                                <button onClick={() => handleSyncData(syncCategory, 'inbound', item.id)} style={{ padding: '10px 15px', background: '#28a745', color: '#fff', fontWeight: 'bold', border: '2px solid #1e7e34', cursor: 'pointer' }}>
                                                    {syncCategory === 'FINISHING' ? '✅ INGEST RECIPE' : '✅ LINK TO PART'}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        )}
      </div>

      <div style={{ height: '120px', flexShrink: 0, background: '#1e1e1e', border: '2px solid #000', padding: '15px', color: '#00ff00', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '5px', boxShadow: '5px 5px 0 #000' }}>
          <div style={{ borderBottom: '1px solid #444', paddingBottom: '5px', marginBottom: '5px', fontSize: '0.7rem', color: '#aaa', fontWeight: 'bold' }}>{`// SYSTEM EVENT LOG`}</div>
          {terminalLogs.map((log, i) => <div key={i} style={{ fontSize: '0.75rem' }}>{log}</div> )}
      </div>

      {/* ========================================================================= */}
      {/* VISUAL ETL MAPPER MODAL                                                   */}
      {/* ========================================================================= */}
      {mapperConfig && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
            <div style={{ background: '#fff', border: '4px solid #000', width: '90%', maxWidth: '1000px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '20px 20px 0 #000' }}>
                <div style={{ padding: '20px', background: '#28a745', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000' }}>
                    <div><h2 style={{ margin: 0, fontSize: '1.5rem', textTransform: 'uppercase' }}>ETL Mapper: {mapperConfig.type}</h2></div>
                    <button onClick={() => setMapperConfig(null)} disabled={mapperConfig.isProcessing} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '2rem', cursor: 'pointer' }}>×</button>
                </div>
                <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                    <div style={{ flex: 1.5, padding: '20px', borderRight: '2px solid #000', overflowY: 'auto', background: '#f8f9fa' }}>
                        <div style={{ fontWeight: 'bold', marginBottom: '15px', color: '#000', borderBottom: '2px solid #ccc', paddingBottom: '5px' }}>COLUMN ALIGNMENT</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                            {SCHEMAS[mapperConfig.type].map(schemaField => (
                                <div key={schemaField.key} style={{ display: 'flex', alignItems: 'center', gap: '15px', background: '#fff', padding: '10px', border: '1px solid #ccc' }}>
                                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}><span style={{ fontWeight: 'bold', fontSize: '0.85rem' }}>{schemaField.label}</span><span style={{ fontSize: '0.65rem', color: schemaField.required ? '#d9534f' : '#888', fontWeight: 'bold' }}>App Field: `{schemaField.key}` {schemaField.required ? '(REQUIRED)' : ''}</span></div>
                                    <div style={{ fontSize: '1.2rem', color: '#ccc' }}>➔</div>
                                    <div style={{ flex: 1 }}>
                                        <select value={fieldMap[schemaField.key] || ""} onChange={(e) => setFieldMap({ ...fieldMap, [schemaField.key]: e.target.value })} style={{ width: '100%', padding: '8px', fontSize: '0.85rem', border: `2px solid ${fieldMap[schemaField.key] ? '#28a745' : '#ccc'}`, outline: 'none', background: fieldMap[schemaField.key] ? '#eafaf1' : '#fff' }}>
                                            <option value="">-- Ignore / Leave Blank --</option>
                                            {mapperConfig.headers.map(header => <option key={header} value={header}>{header}</option>)}
                                        </select>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', background: '#fff' }}>
                        <div style={{ fontWeight: 'bold', marginBottom: '15px', color: '#007bff', borderBottom: '2px solid #ccc', paddingBottom: '5px' }}>LIVE DATA PREVIEW (Row 1)</div>
                        <div style={{ flex: 1, background: '#1e1e1e', color: '#00ff00', padding: '15px', fontFamily: 'monospace', fontSize: '0.8rem', overflowY: 'auto', border: '2px solid #000' }}>
                            {"{\n"}
                            {SCHEMAS[mapperConfig.type].map(field => {
                                const mappedHeader = fieldMap[field.key]; const sampleValue = mappedHeader ? mapperConfig.data[0]?.[mappedHeader] : null;
                                return ( <div key={field.key} style={{ paddingLeft: '15px', marginBottom: '5px' }}><span style={{ color: '#ffb86c' }}>"{field.key}"</span>: {sampleValue ? <span style={{ color: '#f1fa8c' }}> "{sampleValue}"</span> : <span style={{ color: '#6272a4', fontStyle: 'italic' }}> null</span>},</div> )
                            })}
                            {"}"}
                        </div>
                        <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#666', textAlign: 'center' }}>Total Rows Detected: {mapperConfig.data.length}</div>
                            <button onClick={executeImport} disabled={mapperConfig.isProcessing} style={{ padding: '15px', background: mapperConfig.isProcessing ? '#ccc' : '#28a745', color: '#fff', fontWeight: 'bold', fontSize: '1.2rem', border: '2px solid #000', cursor: mapperConfig.isProcessing ? 'not-allowed' : 'pointer', boxShadow: '3px 3px 0 #1e7e34' }}>{mapperConfig.isProcessing ? "WRITING TO DATABASE..." : "EXECUTE IMPORT"}</button>
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