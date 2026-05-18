import React, { useState, useRef } from 'react';
import { db } from '../firebase';
import { doc, writeBatch } from "firebase/firestore";

// --- MOCK DATABASE (Jobs passed from Tab 10 Coop) ---
const MOCK_APPROVED_JOBS = [
  {
    jobId: 'JOB-9042', status: 'APPROVED',
    customer: { id: 'CUST-882', name: 'Smith Residence' }, sidemark: 'Guest Bedroom One',
    cpqData: { totalPrice: 1450.00, finish: 'Matte Brass', items: [{ sku: 'TUBE-100-STL', desc: '1.0" Steel Tube', qty: 1 }, { sku: 'BRK-DEC-MB', desc: 'Deco Bracket', qty: 3 }] },
    visionData: { shape: 'MITERED', poleDiameter: 1.0, cutList: { tubeB: 80.00 } },
    dispatchStatus: { nsSalesOrder: false, fabrication: false, finishing: false, packing: false }
  }
];

// --- MOCK CROSS-APP SYNC DATA ---
const MOCK_SYNC_DATA = {
    FINISHING: {
        outbound: [
            { id: 'FIN-001', name: 'CHAMPAGNE METALLIC', type: 'PLATING', status: 'Pending Floor Recipe' },
            { id: 'FIN-002', name: 'BURNISHED SILVER', type: 'PLATING', status: 'Pending Floor Recipe' }
        ],
        inbound: [
            { id: 'FLR-991', name: 'CUSTOM ANTIQUE BRASS (RUSH)', author: 'John (Paint Dept)', status: 'Pending PLM Approval & Texture' }
        ]
    },
    FABRICATION: {
        outbound: [
            { id: 'CE-INV-8832', name: 'MITERED ELBOW 1.0"', type: 'COMPONENT', status: 'Missing CNC Program' },
            { id: 'CE-INV-1105', name: 'FLUTED CYLINDER FINIAL', type: 'HARDWARE', status: 'Missing CNC Program' }
        ],
        inbound: [
            { id: 'PRG-LATHE-042', name: 'CUSTOM FLUTED PROFILE v2', author: 'Mike (Machinist)', status: 'Unlinked Program File' }
        ]
    }
};

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
        { key: 'collection', label: 'Collection', required: false },
        { key: 'vendorName', label: 'Vendor Name', required: false },
        { key: 'vendorId', label: 'Vendor ID', required: false },
        { key: 'leadTime', label: 'Lead Time (Days)', required: false },
        { key: 'moq', label: 'Minimum Order Qty', required: false },
        { key: 'material', label: 'Raw Material', required: false },
    ],
    ASSEMBLIES: [
        { key: 'legacyErpId', label: 'NS Internal ID (Unique)', required: true },
        { key: 'itemName', label: 'Assembly Name', required: true },
        { key: 'description', label: 'Description', required: false },
        { key: 'collection', label: 'Collection', required: false }
    ]
};

const ERPPushPullTab = ({ currentUser, activeBrand }) => {
  const [activeView, setActiveView] = useState('NETSUITE'); 
  const [prodSubView, setProdSubView] = useState('DISPATCH'); // 'DISPATCH' or 'DATA_SYNC'
  const [syncCategory, setSyncCategory] = useState('FABRICATION'); // 'FABRICATION' or 'FINISHING'
  
  const [jobs, setJobs] = useState(MOCK_APPROVED_JOBS);
  const [activeJobId, setActiveJobId] = useState(MOCK_APPROVED_JOBS[0]?.jobId || null);
  const [terminalLogs, setTerminalLogs] = useState(["> SYSTEM ONLINE. WAITING FOR DISPATCH COMMANDS..."]);
  
  const [mapperConfig, setMapperConfig] = useState(null); 
  const [fieldMap, setFieldMap] = useState({});
  const [syncData, setSyncData] = useState(MOCK_SYNC_DATA);
  
  const fileInputInvRef = useRef(null);
  const fileInputAsmRef = useRef(null);
  const activeJob = jobs.find(j => j.jobId === activeJobId);

  const logToTerminal = (message) => setTerminalLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);

  const handleDispatch = (node) => {
      if (!activeJob) return;
      logToTerminal(`INITIATING PUSH TO ${node.toUpperCase()} NODE...`);
      setTimeout(() => {
          logToTerminal(`✅ SUCCESS: ${activeJob.jobId} -> ${node.toUpperCase()} QUEUE.`);
          setJobs(prevJobs => prevJobs.map(job => {
              if (job.jobId === activeJob.jobId) return { ...job, dispatchStatus: { ...job.dispatchStatus, [node]: true } };
              return job;
          }));
      }, 800);
  };

  const handleSyncData = (category, direction, id) => {
      if (direction === 'outbound') {
          logToTerminal(`📡 PUSHING DATA TO ${category} APP: Ref ${id}`);
          setTimeout(() => {
              logToTerminal(`✅ FLOOR APP RECEIVED DATA. WAITING FOR FLOOR OPERATOR INPUT.`);
              setSyncData(prev => ({
                  ...prev,
                  [category]: { ...prev[category], outbound: prev[category].outbound.filter(f => f.id !== id) }
              }));
          }, 800);
      } else {
          logToTerminal(`📡 INGESTING ${category} RECORD INTO MASTER PLM: Ref ${id}`);
          setTimeout(() => {
              logToTerminal(`✅ INGESTED TO TAB 4 MASTER LIBRARY.`);
              setSyncData(prev => ({
                  ...prev,
                  [category]: { ...prev[category], inbound: prev[category].inbound.filter(f => f.id !== id) }
              }));
          }, 800);
      }
  };

  const generateCSV = (type) => {
      logToTerminal(`GENERATING MAPPED CSV FOR NETSUITE: [${type.toUpperCase()}]`);
      let csvContent = "data:text/csv;charset=utf-8,ExternalID,Customer,Date,Item,Quantity,Rate,Amount,Memo\n";
      activeJob?.cpqData.items.forEach(item => { csvContent += `${activeJob.jobId},${activeJob.customer.name},${new Date().toLocaleDateString()},${item.sku},${item.qty},0.00,0.00,${activeJob.sidemark}\n`; });
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a"); link.setAttribute("href", encodedUri); link.setAttribute("download", `NS_SYNC_${type.toUpperCase()}_${Date.now()}.csv`);
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
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
              if (hLower.includes('uom') || hLower === 'unit') initialMap['uom'] = h;
              if (hLower.includes('vendor') && !hLower.includes('id')) initialMap['vendorName'] = h;
              if (hLower.includes('lead')) initialMap['leadTime'] = h;
          });
          setFieldMap(initialMap); setMapperConfig({ type: importType, data, headers });
          if (fileInputInvRef.current) fileInputInvRef.current.value = '';
          if (fileInputAsmRef.current) fileInputAsmRef.current.value = '';
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
              if (!mappedRow.itemName) return; 

              if (mapperConfig.type === 'INVENTORY') {
                  const newId = `${currentBrand.toUpperCase()}-INV-${mappedRow.legacyErpId || Math.floor(1000+Math.random()*90000)}`;
                  const docRef = doc(db, "Approved_Designs", newId);
                  batch.set(docRef, {
                      id: newId, itemId: newId, legacyErpId: mappedRow.legacyErpId.toUpperCase() || "PENDING", itemName: mappedRow.itemName.toUpperCase(),
                      brandId: currentBrand, partClass: "Inventory", sharedBrands: [currentBrand], 
                      manufacturingSpecs: {
                          productType: mappedRow.productType || "COMPONENT", cost: parseFloat(mappedRow.cost) || 0, basePrice: parseFloat(mappedRow.basePrice) || 0, uom: mappedRow.uom || "EA", finishDetail: mappedRow.finishDetail || "N/A", collection: mappedRow.collection || "N/A", watchList: "NONE", isInHouse: mappedRow.vendorName ? false : true, vendorName: mappedRow.vendorName || "", vendorId: mappedRow.vendorId || "", leadTime: mappedRow.leadTime || "", moq: mappedRow.moq || "", material: mappedRow.material || "", layeringSequence: "10",
                          parametric: { isCutToSize: false, fixedDiameter: "", maxLength: "", widthOffset: "", cadProfile: "CYLINDER" }
                      },
                      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
                  }, { merge: true });
              } else if (mapperConfig.type === 'ASSEMBLIES') {
                  const newId = `${currentBrand.toUpperCase()}-ASM-${mappedRow.legacyErpId || Math.floor(1000+Math.random()*90000)}`;
                  const docRef = doc(db, "Approved_Designs", newId);
                  batch.set(docRef, {
                      id: newId, itemId: newId, partClass: "Assembly", brandId: currentBrand, legacyErpId: mappedRow.legacyErpId.toUpperCase() || "PENDING", itemName: mappedRow.itemName.toUpperCase(), description: mappedRow.description || "", collection: mappedRow.collection || "N/A", lifecycleStatus: "APPROVED", approvals: { designer: true, technical: true, machinist: true }, subAssemblies: [], outsourceKits: [], spatialCallouts: [],
                      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
                  }, { merge: true });
              }
              count++;
          });
          await batch.commit();
          logToTerminal(`✅ [MDM SUCCESS] ${count} ITEMS MAPPED & IMPORTED!`); alert(`Success! ${count} items were imported.`); setMapperConfig(null); 
      } catch (error) {
          console.error(error); logToTerminal(`❌ [MDM ERROR] IMPORT FAILED: ${error.message}`); alert("Import failed."); setMapperConfig({ ...mapperConfig, isProcessing: false });
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
                    <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 rgba(0,0,0,0.1)' }}>
                        <div style={{ padding: '10px 15px', background: '#007bff', color: '#fff', fontWeight: 'bold', borderBottom: '2px solid #000' }}>👥 CUSTOMERS</div>
                        <div style={{ padding: '20px', fontSize: '0.8rem', flex: 1, color: '#666', fontStyle: 'italic' }}>Customer CRM bidirectional sync is running in mocked environment mode.</div>
                        <div style={{ display: 'flex', borderTop: '2px solid #000', marginTop: 'auto' }}>
                            <button onClick={() => generateCSV('customers')} style={{ flex: 1, padding: '15px 10px', background: '#f8f9fa', fontWeight: 'bold', cursor: 'pointer', border: 'none', borderRight: '1px solid #ccc' }}>📄 EXPORT CSV</button>
                            <button style={{ flex: 1, padding: '15px 10px', background: '#eee', color: '#999', fontWeight: 'bold', cursor: 'not-allowed', border: 'none' }}>API SYNC</button>
                        </div>
                    </div>
                    <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 rgba(0,0,0,0.1)' }}>
                        <div style={{ padding: '10px 15px', background: '#28a745', color: '#fff', fontWeight: 'bold', borderBottom: '2px solid #000' }}>📦 INVENTORY (MDM HUB)</div>
                        <div style={{ padding: '15px', fontSize: '0.8rem', flex: 1 }}><div style={{ color: '#555', lineHeight: '1.4' }}>Upload NS Item Export CSV. Fields mapped here will populate Tab 4 (Master Library).</div></div>
                        <div style={{ display: 'flex', borderTop: '2px solid #000', marginTop: 'auto' }}>
                            <input type="file" accept=".csv" ref={fileInputInvRef} onChange={(e) => handleImportClick(e, 'INVENTORY')} style={{ display: 'none' }} />
                            <button onClick={() => fileInputInvRef.current.click()} style={{ flex: 1.5, padding: '15px 10px', background: '#28a745', color: '#fff', fontWeight: 'bold', cursor: 'pointer', border: 'none', borderRight: '2px solid #000' }}>⬆️ UPLOAD CSV</button>
                            <button onClick={() => logToTerminal('Exporting Inventory CSV...')} style={{ flex: 1, padding: '15px 10px', background: '#f8f9fa', fontWeight: 'bold', cursor: 'pointer', border: 'none' }}>📄 EXPORT</button>
                        </div>
                    </div>
                    <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 rgba(0,0,0,0.1)' }}>
                        <div style={{ padding: '10px 15px', background: '#6c757d', color: '#fff', fontWeight: 'bold', borderBottom: '2px solid #000' }}>⚙️ MASTER ASSEMBLIES</div>
                        <div style={{ padding: '15px', fontSize: '0.8rem', flex: 1 }}><div style={{ color: '#555', lineHeight: '1.4' }}>Upload NS Assembly Export CSV. Mapped items will auto-approve for Tab 8 (CPQ).</div></div>
                        <div style={{ display: 'flex', borderTop: '2px solid #000', marginTop: 'auto' }}>
                            <input type="file" accept=".csv" ref={fileInputAsmRef} onChange={(e) => handleImportClick(e, 'ASSEMBLIES')} style={{ display: 'none' }} />
                            <button onClick={() => fileInputAsmRef.current.click()} style={{ flex: 1.5, padding: '15px 10px', background: '#6c757d', color: '#fff', fontWeight: 'bold', cursor: 'pointer', border: 'none', borderRight: '2px solid #000' }}>⬆️ UPLOAD CSV</button>
                            <button onClick={() => logToTerminal('Exporting Assemblies CSV...')} style={{ flex: 1, padding: '15px 10px', background: '#f8f9fa', fontWeight: 'bold', cursor: 'pointer', border: 'none' }}>📄 EXPORT</button>
                        </div>
                    </div>
                </div>

                <div style={{ background: '#fff', border: '2px solid #000', flex: 1, display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 rgba(0,0,0,0.1)' }}>
                    <div style={{ padding: '12px 15px', background: '#000', color: '#fff', fontWeight: 'bold', borderBottom: '2px solid #000' }}>📑 TRANSACTIONAL SYNC (SALES ORDERS & WORK ORDERS)</div>
                    <div style={{ display: 'flex', flex: 1 }}>
                        <div style={{ width: '300px', borderRight: '2px solid #000', background: '#f8f9fa', padding: '15px', overflowY: 'auto' }}>
                            <div style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#666', marginBottom: '10px' }}>APPROVED JOBS WAITING FOR NS SO:</div>
                            {jobs.map(job => (
                                <div key={job.jobId} onClick={() => setActiveJobId(job.jobId)} style={{ background: job.jobId === activeJobId ? '#e6f2ff' : '#fff', border: `2px solid ${job.jobId === activeJobId ? '#007bff' : '#ccc'}`, padding: '10px', cursor: 'pointer', marginBottom: '10px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}><span style={{color:'#007bff'}}>{job.jobId}</span><span>${job.cpqData.totalPrice.toFixed(2)}</span></div>
                                    <div style={{ fontSize: '0.75rem', color: '#555', marginTop: '5px' }}>{job.customer.name}</div>
                                </div>
                            ))}
                        </div>
                        <div style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            {activeJob ? (
                                <>
                                    <div style={{ display: 'flex', gap: '20px' }}>
                                        <div style={{ flex: 1, background: '#f4f4f4', padding: '15px', border: '1px solid #ccc' }}>
                                            <div style={{ fontWeight: 'bold', fontSize: '0.8rem', borderBottom: '1px solid #bbb', paddingBottom: '5px', marginBottom: '10px', color: '#007bff' }}>NS SALES ORDER PAYLOAD</div>
                                            <ul style={{ margin: 0, paddingLeft: '15px', fontSize: '0.8rem', lineHeight: '1.6' }}><li><strong>Customer:</strong> {activeJob.customer.id}</li><li><strong>Memo:</strong> {activeJob.sidemark}</li><li><strong>Total:</strong> ${activeJob.cpqData.totalPrice.toFixed(2)}</li></ul>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '15px', marginTop: 'auto' }}>
                                        <button onClick={() => generateCSV('salesOrder')} style={{ flex: 1, padding: '15px', background: '#000', color: '#fff', fontWeight: 'bold', border: '2px solid #000', cursor: 'pointer', fontSize: '1rem' }}>📥 EXPORT CSV (SALES ORDER)</button>
                                    </div>
                                </>
                            ) : ( <div style={{ color: '#999', margin: 'auto' }}>Select a job from the queue.</div> )}
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
                
                {/* SUB-NAVIGATION */}
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
                                {jobs.map(job => {
                                    const isSelected = job.jobId === activeJobId;
                                    return (
                                        <div key={job.jobId} onClick={() => setActiveJobId(job.jobId)} style={{ background: isSelected ? '#e6f2ff' : '#fff', border: `2px solid ${isSelected ? '#007bff' : '#ccc'}`, padding: '12px', cursor: 'pointer' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}><span style={{ fontWeight: 'bold', color: isSelected ? '#007bff' : '#333' }}>{job.jobId}</span></div>
                                            <div style={{ fontSize: '0.8rem', color: '#666', fontWeight: 'bold' }}>{job.customer.name}</div>
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
                                            <button onClick={() => handleDispatch('fabrication')} disabled={activeJob.dispatchStatus.fabrication} style={{ width: '100%', background: activeJob.dispatchStatus.fabrication ? '#ccc' : '#d9534f', color: '#fff', fontWeight: 'bold', border: '2px solid #000', cursor: activeJob.dispatchStatus.fabrication ? 'not-allowed' : 'pointer' }}>{activeJob.dispatchStatus.fabrication ? '✅ ROUTED' : 'PUSH TO SHOP'}</button>
                                        </div>
                                    </div>
                                    <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', boxShadow: '5px 5px 0 #6f42c1' }}>
                                        <div style={{ padding: '15px', flex: 1, display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                            <div style={{ fontWeight: 'bold', fontSize: '1rem', color: '#6f42c1', borderBottom: '1px solid #eee', paddingBottom: '5px' }}>🎨 FIREBASE: FINISHING FLOOR APP</div>
                                        </div>
                                        <div style={{ width: '180px', background: '#f8f9fa', borderLeft: '2px solid #000', display: 'flex', padding: '15px' }}>
                                            <button onClick={() => handleDispatch('finishing')} disabled={activeJob.dispatchStatus.finishing} style={{ width: '100%', background: activeJob.dispatchStatus.finishing ? '#ccc' : '#6f42c1', color: '#fff', fontWeight: 'bold', border: '2px solid #000', cursor: activeJob.dispatchStatus.finishing ? 'not-allowed' : 'pointer' }}>{activeJob.dispatchStatus.finishing ? '✅ ROUTED' : 'PUSH TO PAINT'}</button>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}

                {/* --- BI-DIRECTIONAL DATA SYNC MODULE --- */}
                {prodSubView === 'DATA_SYNC' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', flex: 1 }}>
                        
                        {/* CATEGORY SELECTOR */}
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button onClick={() => setSyncCategory('FABRICATION')} style={{ padding: '10px 20px', background: syncCategory === 'FABRICATION' ? '#d9534f' : '#f8f9fa', color: syncCategory === 'FABRICATION' ? '#fff' : '#666', border: `2px solid ${syncCategory === 'FABRICATION' ? '#000' : '#ccc'}`, fontWeight: 'bold', cursor: 'pointer' }}>🏭 FABRICATION DEPT (PROGRAMS)</button>
                            <button onClick={() => setSyncCategory('FINISHING')} style={{ padding: '10px 20px', background: syncCategory === 'FINISHING' ? '#6f42c1' : '#f8f9fa', color: syncCategory === 'FINISHING' ? '#fff' : '#666', border: `2px solid ${syncCategory === 'FINISHING' ? '#000' : '#ccc'}`, fontWeight: 'bold', cursor: 'pointer' }}>🎨 FINISHING DEPT (RECIPES)</button>
                        </div>

                        <div style={{ display: 'flex', gap: '20px', flex: 1 }}>
                            
                            {/* OUTBOUND */}
                            <div style={{ flex: 1, background: '#fff', border: `2px solid ${syncCategory === 'FINISHING' ? '#6f42c1' : '#d9534f'}`, display: 'flex', flexDirection: 'column', boxShadow: `8px 8px 0 ${syncCategory === 'FINISHING' ? 'rgba(111, 66, 193, 0.2)' : 'rgba(217, 83, 79, 0.2)'}` }}>
                                <div style={{ padding: '15px', background: syncCategory === 'FINISHING' ? '#6f42c1' : '#d9534f', color: '#fff', borderBottom: '2px solid #000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>📤 OUTBOUND: PLM TO FLOOR</span>
                                    <span style={{ fontSize: '0.8rem', fontWeight: 'bold', background: '#fff', color: syncCategory === 'FINISHING' ? '#6f42c1' : '#d9534f', padding: '3px 8px', borderRadius: '12px' }}>{syncData[syncCategory].outbound.length} PENDING</span>
                                </div>
                                <div style={{ padding: '20px', flex: 1, background: '#f8f9fa' }}>
                                    <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '15px', fontStyle: 'italic' }}>
                                        {syncCategory === 'FINISHING' 
                                            ? "Finishes created in PLM Tab 4 that need a chemical/process recipe mapped by the floor team." 
                                            : "Parts created in PLM Tab 4 marked as In-House that need a CNC/Machine program assigned by the Floor team."}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                        {syncData[syncCategory].outbound.length === 0 && <div style={{ textAlign: 'center', color: '#999', marginTop: '40px' }}>All items mapped.</div>}
                                        {syncData[syncCategory].outbound.map(item => (
                                            <div key={item.id} style={{ background: '#fff', border: '1px solid #ccc', borderLeft: '5px solid #ffc107', padding: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <div>
                                                    <div style={{ fontWeight: 'bold', fontSize: '1rem', color: '#333' }}>{item.name}</div>
                                                    <div style={{ fontSize: '0.7rem', color: '#666' }}>ID: {item.id} | Type: {item.type}</div>
                                                    <div style={{ fontSize: '0.7rem', color: '#d9534f', fontWeight: 'bold', marginTop: '5px' }}>⚠️ {item.status}</div>
                                                </div>
                                                <button onClick={() => handleSyncData(syncCategory, 'outbound', item.id)} style={{ padding: '10px 15px', background: syncCategory === 'FINISHING' ? '#6f42c1' : '#d9534f', color: '#fff', fontWeight: 'bold', border: '2px solid #000', cursor: 'pointer' }}>
                                                    🔔 PING FLOOR APP
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* INBOUND */}
                            <div style={{ flex: 1, background: '#fff', border: '2px solid #28a745', display: 'flex', flexDirection: 'column', boxShadow: '8px 8px 0 rgba(40, 167, 69, 0.2)' }}>
                                <div style={{ padding: '15px', background: '#28a745', color: '#fff', borderBottom: '2px solid #000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>📥 INBOUND: FLOOR TO PLM</span>
                                    <span style={{ fontSize: '0.8rem', fontWeight: 'bold', background: '#fff', color: '#28a745', padding: '3px 8px', borderRadius: '12px' }}>{syncData[syncCategory].inbound.length} PENDING</span>
                                </div>
                                <div style={{ padding: '20px', flex: 1, background: '#f8f9fa' }}>
                                    <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '15px', fontStyle: 'italic' }}>
                                        {syncCategory === 'FINISHING' 
                                            ? "Custom finishes created by floor operators that need to be approved into the PLM Master Dictionary." 
                                            : "New G-Code/Machine programs uploaded by floor operators that need to be linked to a Master Part in PLM."}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                        {syncData[syncCategory].inbound.length === 0 && <div style={{ textAlign: 'center', color: '#999', marginTop: '40px' }}>No inbound items.</div>}
                                        {syncData[syncCategory].inbound.map(item => (
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