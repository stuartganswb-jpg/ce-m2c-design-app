import React, { useState, useEffect } from 'react';
import { db, storage } from '../../firebase';
import { collection, onSnapshot, doc, setDoc, deleteDoc, getDocs, query, where, updateDoc, orderBy, limit } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

const AdminTab = ({ currentUser, activeBrand, perms, setPerms, TABS }) => {
  const [activeSection, setActiveSection] = useState("NETSUITE_SYNC"); 
  
  const [users, setUsers] = useState([]);
  const [dynamicRoles, setDynamicRoles] = useState(['admin', 'executive', 'design_team', 'sales_rep']);
  const [adminForm, setAdminForm] = useState({ uName: '', uPin: '', uRole: 'sales_rep', oldId: '' });
  const [newRole, setNewRole] = useState('');

  const [cpqFlows, setCpqFlows] = useState([]);
  const [activeFlowId, setActiveFlowId] = useState(null);
  const [globalLists, setGlobalLists] = useState({});
  const [allApprovedDesigns, setAllApprovedDesigns] = useState([]); 
  const [linkedBomPins, setLinkedBomPins] = useState([]); 
  
  const [customDataWindows, setCustomDataWindows] = useState([]);
  
  const [globalFinishes, setGlobalFinishes] = useState([]);
  const [outsourceFinishes, setOutsourceFinishes] = useState([]);
  const [dynamicAssets, setDynamicAssets] = useState([]);
  const [libraryParts, setLibraryParts] = useState([]);

  const [crmDiscounts, setCrmDiscounts] = useState([]);
  const [newDiscount, setNewDiscount] = useState({ code: '', description: '', percent: '' });
  const [crmListInput, setCrmListInput] = useState({ salesReps: '', paymentTerms: '' });

  const [newStep, setNewStep] = useState({ 
      id: null, title: '', type: 'DROPDOWN', dataSource: '', required: true, 
      priceMap: {}, geometryMap: {}, targetNodes: '', allowedOptions: [],
      useClientPricing: false, priceOverride: '', partHandling: '', calculatorTemplate: '', qtyHelperText: '',
      basePrice: '', linkedItemId: '' 
  });

  const [newFlowName, setNewFlowName] = useState("");
  const [flowSettings, setFlowSettings] = useState({ name: '', legacyErpId: '', basePrice: '', linkedAssemblyId: '' });
  const [isSavingFlowSettings, setIsSavingFlowSettings] = useState(false);

  const [inspectedNodes, setInspectedNodes] = useState([]);
  const [isInspecting, setIsInspecting] = useState(false);

  const [customSchema, setCustomSchema] = useState([]);
  const [cpqRules, setCpqRules] = useState([]);
  const [newRule, setNewRule] = useState({ name: '', conditionField: '', conditionOp: 'EQUALS', conditionVal: '', effectField: '', effectVal: '' });
  const [aiPrompt, setAiPrompt] = useState("");
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);

  const [brandLogos, setBrandLogos] = useState({});
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [formTemplates, setFormTemplates] = useState({});
  const [activeFormType, setActiveFormType] = useState('QUOTE');
  const [formEditor, setFormEditor] = useState({ header: '', footer: '', terms: '' });

  const [nsSubsidiaryId, setNsSubsidiaryId] = useState("3"); 
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncLog, setSyncLog] = useState([]);

  // --- SUPER ADMIN STATE ---
  const [systemLogs, setSystemLogs] = useState([]);
  const [logFilter, setLogFilter] = useState({ app: 'ALL', user: '' });
  const [newMasterPin, setNewMasterPin] = useState("");

  const DOCUMENT_TYPES = ['QUOTE', 'SALES_ORDER', 'WORK_ORDER', 'PACKING_SLIP', 'INVOICE', 'FACTORY_ROUTER'];
  const BRANDS_LIST = ['m2c', 'uniquity', 'ce', 'leyla']; 

  const FIREBASE_FUNCTION_URL = "https://netsuiteproxy-f3h3jadzaq-uc.a.run.app"; 

  // Identify if the current logged-in user is the Master Admin 
  const currentActiveUser = users.find(u => u.name === currentUser);
const isSuperAdmin = currentUser === "Master Admin" || currentActiveUser?.pin === "1032" || currentActiveUser?.superAdmin === true;

  useEffect(() => {
      const unsubUsers = onSnapshot(collection(db, "hq_users"), (snap) => setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
      const unsubRoles = onSnapshot(doc(db, "hq_config", "roles"), (docSnap) => { if (docSnap.exists() && docSnap.data().list) setDynamicRoles(docSnap.data().list); });
      const unsubSchema = onSnapshot(doc(db, "system", "master_schema"), (docSnap) => { if (docSnap.exists() && docSnap.data().inventoryFields) setCustomSchema(docSnap.data().inventoryFields); });
      const unsubRules = onSnapshot(doc(db, "system", "cpq_rules"), (docSnap) => { if (docSnap.exists() && docSnap.data().rules) setCpqRules(docSnap.data().rules); });
      const unsubFlows = onSnapshot(collection(db, "cpq_flows"), (snap) => setCpqFlows(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
      
      const unsubLists = onSnapshot(doc(db, "system", "master_lists"), (docSnap) => { 
          if (docSnap.exists()) setGlobalLists(docSnap.data()); 
      });

      const unsubDiscounts = onSnapshot(doc(db, "system", "crm_discounts"), (docSnap) => { 
          if (docSnap.exists() && docSnap.data().list) setCrmDiscounts(docSnap.data().list); 
      });
      
      const unsubAssemblies = onSnapshot(collection(db, "Approved_Designs"), (snap) => {
          const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          setAllApprovedDesigns(docs);
          setLibraryParts(docs.filter(d => d.partClass === 'Inventory'));
      });

      const unsubWindowConfig = onSnapshot(doc(db, "system", "window_config"), (docSnap) => {
          if (docSnap.exists() && docSnap.data().custom) {
              setCustomDataWindows(docSnap.data().custom);
          }
      });

      const unsubFinishes = onSnapshot(doc(db, "system", "master_finishes"), (snap) => { if(snap.exists() && snap.data().finishes) setGlobalFinishes(snap.data().finishes); });
      const unsubOutsource = onSnapshot(collection(db, "hq_outsource_finishes"), (snap) => setOutsourceFinishes(snap.docs.map(d => ({id: d.id, ...d.data()}))));
      const unsubDynamic = onSnapshot(collection(db, "hq_dynamic_data"), (snap) => setDynamicAssets(snap.docs.map(d => ({id: d.id, ...d.data()}))));

      const unsubLogos = onSnapshot(doc(db, "hq_config", "brand_logos"), (docSnap) => { if (docSnap.exists()) setBrandLogos(docSnap.data()); });
      const unsubForms = onSnapshot(doc(db, "hq_config", "form_templates"), (docSnap) => { 
          if (docSnap.exists()) {
              setFormTemplates(docSnap.data());
          }
      });

      return () => { unsubUsers(); unsubRoles(); unsubSchema(); unsubRules(); unsubFlows(); unsubLists(); unsubDiscounts(); unsubAssemblies(); unsubWindowConfig(); unsubFinishes(); unsubOutsource(); unsubDynamic(); unsubLogos(); unsubForms(); };
  }, [activeBrand]);

  useEffect(() => {
      if (formTemplates[activeFormType]) {
          setFormEditor(formTemplates[activeFormType]);
      } else {
          setFormEditor({ header: '', footer: '', terms: '' });
      }
  }, [activeFormType, formTemplates]);

  // Fetch Global Logs across all apps when Super Admin tab is opened
  useEffect(() => {
      if (activeSection === "SUPER_ADMIN" && isSuperAdmin) {
          const fetchGlobalLogs = async () => {
              try {
                  const shopSnap = await getDocs(query(collection(db, "shop_logs"), orderBy("t", "desc"), limit(150)));
                  const finSnap = await getDocs(query(collection(db, "fin_logs"), orderBy("t", "desc"), limit(150)));
                  const hqSnap = await getDocs(query(collection(db, "hq_logs"), orderBy("t", "desc"), limit(150)));

                  let combined = [
                      ...shopSnap.docs.map(d => ({ id: d.id, app: 'SHOP FLOOR', ...d.data() })),
                      ...finSnap.docs.map(d => ({ id: d.id, app: 'FINISHING', ...d.data() })),
                      ...hqSnap.docs.map(d => ({ id: d.id, app: 'HQ', ...d.data() }))
                  ];
                  
                  combined.sort((a, b) => {
                      const timeA = a.t?.toMillis ? a.t.toMillis() : 0;
                      const timeB = b.t?.toMillis ? b.t.toMillis() : 0;
                      return timeB - timeA;
                  });
                  setSystemLogs(combined);
              } catch(e) { console.error("Error fetching global logs:", e); }
          };
          fetchGlobalLogs();
      }
  }, [activeSection, isSuperAdmin]);

  const masterAssemblies = allApprovedDesigns.filter(d => {
      const isBrandMatch = d.brandId === activeBrand || (d.sharedBrands && d.sharedBrands.includes(activeBrand));
      if (!isBrandMatch) return false;

      const rType = (d.routingType || "").toUpperCase();
      const cpqTypes = (globalLists.cpqRoutingTypes || []).map(t => t.toUpperCase());

      return d.partClass === 'Master Assembly' || 
             cpqTypes.includes(rType) || 
             rType === 'MASTER' || 
             rType === 'MAIN' ||
             rType.includes('CPQ');
  });

  useEffect(() => {
      if (activeFlowId && cpqFlows.length > 0) {
          const flow = cpqFlows.find(f => f.id === activeFlowId);
          if (flow) {
              setFlowSettings({ 
                  name: flow.name || '', 
                  legacyErpId: flow.legacyErpId || '', 
                  basePrice: flow.basePrice || '',
                  linkedAssemblyId: flow.linkedAssemblyId || ''
              });
              setNewStep({ id: null, title: '', type: 'DROPDOWN', dataSource: '', required: true, priceMap: {}, geometryMap: {}, targetNodes: '', allowedOptions: [], useClientPricing: false, priceOverride: '', partHandling: '', calculatorTemplate: '', qtyHelperText: '', basePrice: '', linkedItemId: '' });
          }
      }
      setInspectedNodes([]); 
  }, [activeFlowId, cpqFlows]);

  useEffect(() => {
      if (!flowSettings.linkedAssemblyId) { setLinkedBomPins([]); return; }
      const linkedAsm = masterAssemblies.find(a => a.id === flowSettings.linkedAssemblyId);
      if(!linkedAsm) return;
      
      const unsub = onSnapshot(collection(db, "assembly_pins"), (snap) => {
          const pins = snap.docs.map(d => d.data()).filter(p => p.assemblyId === linkedAsm.itemId);
          setLinkedBomPins(pins);
      });
      return () => unsub();
  }, [flowSettings.linkedAssemblyId, masterAssemblies]);

  const addLog = (msg, type = 'info') => {
      const time = new Date().toLocaleTimeString();
      setSyncLog(prev => [{ time, msg, type }, ...prev]);
  };

  const executeSuiteQL = async (queryStr) => {
      const targetUrl = `https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`;

      const response = await fetch(FIREBASE_FUNCTION_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
              targetUrl: targetUrl,
              method: 'POST',
              payload: { q: queryStr }
          })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(`NetSuite Error: ${JSON.stringify(data)}`);
      return data;
  };

  const handleUpdateMasterPin = async () => {
      if (!newMasterPin || newMasterPin.length !== 4) return alert("Master PIN must be exactly 4 digits.");
      if (!currentActiveUser) return alert("Error locating your user profile.");
      if (!window.confirm(`Update your Master PIN from ${currentActiveUser.pin} to ${newMasterPin}?`)) return;

      try {
          await setDoc(doc(db, "hq_users", newMasterPin), { 
              ...currentActiveUser, 
              pin: newMasterPin,
              superAdmin: true 
          });
          if (currentActiveUser.id !== newMasterPin) {
              await deleteDoc(doc(db, "hq_users", currentActiveUser.id));
          }
          
          alert("✅ Master PIN successfully updated. You may need to log back in for changes to reflect globally.");
          setNewMasterPin("");
      } catch(e) {
          console.error(e);
          alert("Failed to update Master PIN.");
      }
  };

  const handleSyncCustomers = async () => {
      if (!nsSubsidiaryId) return alert("Please enter a Target Subsidiary ID.");
      setIsSyncing(true);
      addLog(`Initiating Customer Sync for Subsidiary [${nsSubsidiaryId}]...`, 'info');

      try {
          const q = `SELECT id, companyname, email, phone, creditlimit, terms FROM customer WHERE subsidiary = ${nsSubsidiaryId} AND isinactive = 'F'`;
          const result = await executeSuiteQL(q);
          const records = result.items || [];
          
          addLog(`Downloaded ${records.length} active customers. Writing to CRM Database...`, 'success');

          let successCount = 0;
          for (const c of records) {
              const safeId = `CUST-${c.id}`;
              const docRef = doc(db, "crm_records", safeId);
              await setDoc(docRef, {
                  id: safeId,
                  type: 'CUSTOMER',
                  name: c.companyname || `Customer ${c.id}`,
                  email: c.email || '',
                  phone: c.phone || '',
                  creditLimit: parseFloat(c.creditlimit) || 0,
                  terms: c.terms || '',
                  billingAddress: '',
                  shippingAddresses: [],
                  discountCode: '',
                  contact: '',
                  salesRep: '',
                  notes: 'Imported from NetSuite',
                  ytd: 0, mtd: 0, openOrders: 0
              }, { merge: true });
              successCount++;
          }
          addLog(`✅ Successfully synced ${successCount} CRM records.`, 'success');

      } catch (err) {
          console.error(err);
          addLog(`❌ FAILED: ${err.message}`, 'error');
      }
      setIsSyncing(false);
  };

  const handleSyncVendors = async () => {
      setIsSyncing(true);
      addLog(`Initiating Vendor Sync for External Co-Op CRM...`, 'info');

      try {
          const q = `SELECT id, companyname, email, phone, terms FROM vendor WHERE isinactive = 'F'`;
          const result = await executeSuiteQL(q);
          const records = result.items || [];
          
          addLog(`Downloaded ${records.length} active vendors. Writing to CRM Database...`, 'success');

          let successCount = 0;
          for (const v of records) {
              const safeId = `VEND-${v.id}`;
              const docRef = doc(db, "crm_records", safeId);
              
              await setDoc(docRef, {
                  id: safeId,
                  type: 'VENDOR',
                  name: v.companyname || `Vendor ${v.id}`,
                  email: v.email || '',
                  phone: v.phone || '',
                  terms: v.terms || '',
                  notes: 'Imported from NetSuite',
                  status: 'ACTIVE'
              }, { merge: true });
              successCount++;
          }
          addLog(`✅ Successfully synced ${successCount} Vendor records.`, 'success');

      } catch (err) {
          console.error(err);
          addLog(`❌ FAILED: ${err.message}`, 'error');
      }
      setIsSyncing(false);
  };

  const handleSyncItems = async (itemType) => {
      setIsSyncing(true);
      
      const typeDesc = itemType === 'Inventory' ? 'Inventory Items' : 'Assemblies / Kits';
      addLog(`Initiating Advanced CPQ Data Sync for [${typeDesc}]...`, 'info');

      try {
          const typeFilter = itemType === 'Inventory' ? "item.itemtype = 'InvtPart'" : "item.itemtype = 'Assembly'";
          const q = `
              SELECT 
                  item.id, 
                  item.itemid, 
                  item.displayname,
                  BUILTIN.DF(item.custitem_bit_product_type) AS product_type,
                  BUILTIN.DF(item.custitem_bit_itemcollection) AS collection,
                  BUILTIN.DF(item.custitem_bit_watchlist) AS watchlist,
                  BUILTIN.DF(item.stockunit) AS uom,
                  item.custitem9 AS baseprice,
                  Vendor.companyname AS vendor_name,
                  ItemVendor.vendorcode AS vendor_part_number,
                  ItemVendor.purchaseprice AS lastpurchaseprice,
                  ItemVendor.preferredvendor
              FROM 
                  item
              LEFT JOIN 
                  ItemVendor ON ItemVendor.item = item.id
              LEFT JOIN
                  Vendor ON ItemVendor.vendor = Vendor.id
              WHERE 
                  item.custitem_sync_to_cpq = 'T' 
                  AND item.isinactive = 'F' 
                  AND ${typeFilter}
          `;
          
          const result = await executeSuiteQL(q);
          const rawRecords = result.items || [];
          
          const uniqueRecordsMap = {};
          for (const row of rawRecords) {
              const itemId = row.id;
              if (!uniqueRecordsMap[itemId]) {
                  uniqueRecordsMap[itemId] = row;
              } else {
                  const isNewPreferred = row.preferredvendor === 'T';
                  const isOldPreferred = uniqueRecordsMap[itemId].preferredvendor === 'T';
                  const oldHasVendor = !!uniqueRecordsMap[itemId].vendor_name;
                  const newHasVendor = !!row.vendor_name;

                  if (isNewPreferred && !isOldPreferred) {
                      uniqueRecordsMap[itemId] = row;
                  } else if (!oldHasVendor && newHasVendor && !isOldPreferred) {
                      uniqueRecordsMap[itemId] = row;
                  }
              }
          }
          const records = Object.values(uniqueRecordsMap);
          
          addLog(`Downloaded ${records.length} unique items with enriched metadata. Updating Library...`, 'success');

          let successCount = 0;
          for (const item of records) {
              const newId = `${activeBrand.toUpperCase()}-${itemType === 'Inventory' ? 'INV' : 'ASM'}-${item.id}`;
              
              const existingMatch = allApprovedDesigns.find(d => d.legacyErpId === item.itemid);
              const targetDocId = existingMatch ? existingMatch.id : newId;

              const pTypeClean = (item.product_type || '').toLowerCase().trim();
              const uomClean = (item.uom || '').toLowerCase().trim();
              
              const isPoleOrLinear = pTypeClean === 'pole' || pTypeClean === 'poles' || uomClean === 'ft' || uomClean === 'foot' || uomClean === 'feet';
              const autoPartHandling = isPoleOrLinear ? 'Custom' : 'Small Parts';
              const autoIsCutToSize = isPoleOrLinear; 
              
              const hasVendor = item.vendor_name && item.vendor_name.trim() !== '';

              const payload = {
                  id: targetDocId,
                  itemId: targetDocId,
                  legacyErpId: item.itemid || item.id,
                  netSuiteInternalId: item.id, 
                  itemName: item.displayname || item.itemid,
                  brandId: activeBrand,
                  partClass: itemType,
                  sharedBrands: [activeBrand]
              };

              if (!existingMatch) {
                  payload.manufacturingSpecs = {
                      basePrice: parseFloat(item.baseprice) || 0, 
                      cost: parseFloat(item.lastpurchaseprice) || 0, 
                      isInHouse: !hasVendor, 
                      status: "IMPORTED_FROM_ERP",
                      productType: item.product_type || 'Uncategorized',
                      uom: item.uom || 'EA',
                      binNumber: 'Pending Map',
                      partHandling: autoPartHandling, 
                      parametric: { isCutToSize: autoIsCutToSize }, 
                      vendorName: item.vendor_name || '', 
                      vendorId: item.vendor_part_number || '', 
                      customData: {
                          collection: item.collection || '',
                          watchlist: item.watchlist || ''
                      },
                      dynamicDicts: {}
                  };
                  payload.createdAt = new Date().toISOString();
              } else {
                  payload.manufacturingSpecs = {
                      ...existingMatch.manufacturingSpecs,
                      basePrice: parseFloat(item.baseprice) || existingMatch.manufacturingSpecs?.basePrice || 0,
                      cost: parseFloat(item.lastpurchaseprice) || existingMatch.manufacturingSpecs?.cost || 0,
                      isInHouse: hasVendor ? false : (existingMatch.manufacturingSpecs?.isInHouse !== undefined ? existingMatch.manufacturingSpecs.isInHouse : true),
                      productType: item.product_type || existingMatch.manufacturingSpecs?.productType || 'Uncategorized',
                      uom: item.uom || existingMatch.manufacturingSpecs?.uom || 'EA',
                      partHandling: existingMatch.manufacturingSpecs?.partHandling || autoPartHandling,
                      vendorName: item.vendor_name || existingMatch.manufacturingSpecs?.vendorName || '',
                      vendorId: item.vendor_part_number || existingMatch.manufacturingSpecs?.vendorId || '',
                      parametric: {
                          ...(existingMatch.manufacturingSpecs?.parametric || {}),
                          isCutToSize: existingMatch.manufacturingSpecs?.parametric?.isCutToSize !== undefined 
                                       ? existingMatch.manufacturingSpecs.parametric.isCutToSize 
                                       : autoIsCutToSize
                      },
                      customData: {
                          ...(existingMatch.manufacturingSpecs?.customData || {}),
                          collection: item.collection || existingMatch.manufacturingSpecs?.customData?.collection || '',
                          watchlist: item.watchlist || existingMatch.manufacturingSpecs?.customData?.watchlist || ''
                      }
                  };
                  payload.updatedAt = new Date().toISOString();
              }

              await setDoc(doc(db, "Approved_Designs", targetDocId), payload, { merge: true });
              successCount++;
          }
          addLog(`✅ Successfully synced and enriched ${successCount} library items.`, 'success');

      } catch (err) {
          console.error(err);
          addLog(`❌ FAILED: ${err.message}`, 'error');
      }
      setIsSyncing(false);
  };

  const handleAddDiscount = async () => {
      if (!newDiscount.code || !newDiscount.percent) return alert("Code and Percentage are required.");
      const updated = [...crmDiscounts, { ...newDiscount, code: newDiscount.code.toUpperCase(), percent: parseFloat(newDiscount.percent) || 0 }];
      await setDoc(doc(db, "system", "crm_discounts"), { list: updated }, { merge: true });
      setNewDiscount({ code: '', description: '', percent: '' });
  };

  const handleRemoveDiscount = async (code) => {
      if (!window.confirm(`Delete discount code ${code}?`)) return;
      const updated = crmDiscounts.filter(d => d.code !== code);
      await setDoc(doc(db, "system", "crm_discounts"), { list: updated }, { merge: true });
  };

  const handleAddCrmList = async (listKey) => {
      const val = crmListInput[listKey]?.trim();
      if (!val) return;
      const updatedList = [...(globalLists[listKey] || []), val];
      await setDoc(doc(db, "system", "master_lists"), { [listKey]: updatedList }, { merge: true });
      setCrmListInput({ ...crmListInput, [listKey]: '' });
  };

  const handleRemoveCrmList = async (listKey, val) => {
      if (!window.confirm(`Remove ${val}?`)) return;
      const updatedList = (globalLists[listKey] || []).filter(item => item !== val);
      await setDoc(doc(db, "system", "master_lists"), { [listKey]: updatedList }, { merge: true });
  };

  const handleInspectNodes = () => {
      if (!flowSettings.linkedAssemblyId) return alert("Please link a Master Assembly to this CPQ Flow first.");
      const linkedAsm = masterAssemblies.find(a => a.id === flowSettings.linkedAssemblyId);
      if (!linkedAsm || !linkedAsm.manufacturingSpecs?.cadUrl) return alert("The linked Master Assembly does not have a 3D CAD (.glb) file attached.");

      setIsInspecting(true);
      const loader = new GLTFLoader();
      loader.load(
          linkedAsm.manufacturingSpecs.cadUrl, 
          (gltf) => {
              const nodes = [];
              gltf.scene.traverse((child) => {
                  if (child.isMesh) {
                      nodes.push(child.name);
                  }
              });
              if (nodes.length === 0) alert("No meshes found in this file.");
              else setInspectedNodes(nodes);
              setIsInspecting(false);
          },
          undefined,
          (error) => {
              console.error(error);
              alert("Failed to load 3D file for inspection.");
              setIsInspecting(false);
          }
      );
  };

  const handleAddRole = async () => {
      if (!newRole.trim()) return alert("Role name required.");
      const safeRole = newRole.toLowerCase().replace(/[^a-z0-9]/g, "_");
      if (dynamicRoles.includes(safeRole)) return alert("Role already exists.");
      await setDoc(doc(db, "hq_config", "roles"), { list: [...dynamicRoles, safeRole] }, { merge: true });
      setNewRole('');
  };
  const handleDeleteRole = async (role) => {
      if (!window.confirm(`Delete role: ${role}?`)) return;
      await setDoc(doc(db, "hq_config", "roles"), { list: dynamicRoles.filter(r => r !== role) }, { merge: true });
  };
  const handlePermToggle = (role, tab) => {
      const rolePerms = perms[role] || [];
      const newPerms = rolePerms.includes(tab) ? rolePerms.filter(t => t !== tab) : [...rolePerms, tab];
      setPerms({ ...perms, [role]: newPerms });
  };
  const handleSavePermissions = async () => { await setDoc(doc(db, "hq_config", "permissions"), perms); alert("Matrix Saved!"); };
  const handleSaveUser = async () => {
      if(!adminForm.uName || !adminForm.uPin) return alert("Name and PIN are required.");
      if (adminForm.oldId && adminForm.oldId !== adminForm.uPin) await deleteDoc(doc(db, "hq_users", adminForm.oldId));
      await setDoc(doc(db, "hq_users", adminForm.uPin), { name: adminForm.uName, pin: adminForm.uPin, role: adminForm.uRole });
      setAdminForm({ uName: '', uPin: '', uRole: dynamicRoles[0] || 'operator', oldId: '' });
  };
  const handleDeleteUser = async (u) => { if(!window.confirm(`Terminate ${u.name}?`)) return; await deleteDoc(doc(db, "hq_users", u.id)); };

  const handleCreateNewFlow = async () => {
      if (!newFlowName.trim()) return alert("Please enter a flow name (e.g., CUSTOM PILLOW)");
      const flowId = `FLOW-${Date.now()}`;
      try {
          await setDoc(doc(db, "cpq_flows", flowId), { id: flowId, brandId: activeBrand, name: newFlowName.toUpperCase(), legacyErpId: 'PENDING', basePrice: 0, steps: [] });
          setNewFlowName(""); setActiveFlowId(flowId);
      } catch (err) { console.error("Error creating flow:", err); alert("Database Error. Check Firestore Rules."); }
  };

  const handleSaveFlowSettings = async () => {
      if (!activeFlowId) return;
      setIsSavingFlowSettings(true);
      try {
          const formattedName = flowSettings.name.toUpperCase();
          const formattedErpId = (flowSettings.legacyErpId || 'PENDING').toUpperCase();

          await setDoc(doc(db, "cpq_flows", activeFlowId), { ...flowSettings, name: formattedName, legacyErpId: formattedErpId }, { merge: true });
          
          if (flowSettings.linkedAssemblyId) {
              await updateDoc(doc(db, "Approved_Designs", flowSettings.linkedAssemblyId), {
                  linkedCpqFlowId: activeFlowId,
                  legacyErpId: formattedErpId,
                  "manufacturingSpecs.basePrice": parseFloat(flowSettings.basePrice) || 0
              });
          }

          setTimeout(() => setIsSavingFlowSettings(false), 500);
      } catch (err) {
          console.error("Error saving flow settings:", err);
          setIsSavingFlowSettings(false);
          alert("Failed to sync settings with Master Assembly.");
      }
  };

  const handleDeleteFlow = async () => {
      if (!activeFlowId) return;
      if (!window.confirm("Are you sure you want to delete this CPQ Flow? This will remove all configuration steps for this product.")) return;
      
      try {
          if (flowSettings.linkedAssemblyId) {
              try {
                  await updateDoc(doc(db, "Approved_Designs", flowSettings.linkedAssemblyId), {
                      linkedCpqFlowId: null
                  });
              } catch(e) {
                  console.warn("Linked assembly not found or already deleted. Proceeding with Flow deletion.");
              }
          }
          await deleteDoc(doc(db, "cpq_flows", activeFlowId));
          setActiveFlowId(null);
          setFlowSettings({ name: '', legacyErpId: '', basePrice: '', linkedAssemblyId: '' });
      } catch (err) {
          console.error("Error deleting flow:", err);
          alert("Failed to delete the CPQ Flow.");
      }
  };

  const handleAutoCreateFlowForAssembly = async (asm) => {
      const flowId = `FLOW-${Date.now()}`;
      try {
          await setDoc(doc(db, "cpq_flows", flowId), { 
              id: flowId, 
              brandId: activeBrand, 
              name: `${asm.itemName} CONFIGURATOR`, 
              legacyErpId: asm.legacyErpId !== 'PENDING' ? asm.legacyErpId : '', 
              basePrice: asm.manufacturingSpecs?.basePrice || 0,
              linkedAssemblyId: asm.id,
              steps: [] 
          });
          await updateDoc(doc(db, "Approved_Designs", asm.id), { linkedCpqFlowId: flowId });
          setActiveFlowId(flowId);
      } catch (err) { console.error(err); alert("Error generating automated flow."); }
  };

  const handleAutoSyncBOM = async (flow) => {
      if (linkedBomPins.length === 0) return alert("No BOM sub-assemblies found in this Master File Cabinet.");
      if (!window.confirm("Auto-generate CPQ steps for all components mapped to this Master Assembly?")) return;
      
      try {
          const generatedSteps = linkedBomPins.map((pin, idx) => {
              const libPart = allApprovedDesigns.find(d => d.id === pin.partId || d.legacyErpId === pin.partId || d.itemId === pin.partId);
              let bp = 0;
              if (libPart) {
                  const specs = libPart.manufacturingSpecs || {};
                  const bPrice = parseFloat(specs.basePrice) || 0;
                  bp = bPrice > 0 ? bPrice : 0; 
              }

              return {
                  id: `STEP-AUTO-${Date.now()}-${idx}`,
                  title: `Select Finish for ${pin.partName}`,
                  type: 'DROPDOWN',
                  dataSource: 'master_finishes',
                  required: true,
                  priceMap: {},
                  geometryMap: {},
                  targetNodes: pin.targetNode || pin.partName, 
                  linkedPinId: pin.partId,
                  linkedItemId: pin.partId, 
                  basePrice: bp,
                  allowedOptions: [],
                  useClientPricing: false,
                  priceOverride: '',
                  partHandling: '',
                  calculatorTemplate: '',
                  qtyHelperText: ''
              };
          });

          const updatedSteps = [...(flow.steps || []), ...generatedSteps];
          await setDoc(doc(db, "cpq_flows", flow.id), { ...flow, steps: updatedSteps }, { merge: true });
          alert(`✅ Successfully synced ${generatedSteps.length} configuration steps from the Master File Cabinet!`);
      } catch (err) {
          console.error("Auto-sync failed:", err);
          alert("Failed to auto-generate steps.");
      }
  };

  const handleAddStepToFlow = async (flow) => {
      if (!newStep.title) return alert("Step title is required");
      if (!newStep.partHandling) return alert("❌ ERROR: Part Handling / Routing is required for every step.");

      try {
          let updatedSteps;
          if (newStep.id) {
              updatedSteps = flow.steps.map(s => s.id === newStep.id ? newStep : s);
          } else {
              updatedSteps = [...(flow.steps || []), { ...newStep, id: `STEP-${Date.now()}` }];
          }
          await setDoc(doc(db, "cpq_flows", flow.id), { ...flow, steps: updatedSteps });
          setNewStep({ id: null, title: '', type: 'DROPDOWN', dataSource: '', required: true, priceMap: {}, geometryMap: {}, targetNodes: '', allowedOptions: [], useClientPricing: false, priceOverride: '', partHandling: '', calculatorTemplate: '', qtyHelperText: '', basePrice: '', linkedItemId: '' });
      } catch (err) { console.error("Error saving step:", err); alert("Database Error."); }
  };

  const handleDeleteStep = async (flow, stepId) => {
      if (!window.confirm("Delete this configuration step?")) return;
      try {
          const updatedSteps = flow.steps.filter(s => s.id !== stepId);
          await setDoc(doc(db, "cpq_flows", flow.id), { ...flow, steps: updatedSteps });
      } catch (err) { console.error("Error deleting step:", err); }
  };

  const handleMoveStep = async (flow, index, direction) => {
      const updatedSteps = [...flow.steps];
      if (direction === 'UP' && index > 0) {
          [updatedSteps[index - 1], updatedSteps[index]] = [updatedSteps[index], updatedSteps[index - 1]];
      } else if (direction === 'DOWN' && index < updatedSteps.length - 1) {
          [updatedSteps[index + 1], updatedSteps[index]] = [updatedSteps[index], updatedSteps[index + 1]];
      }
      await setDoc(doc(db, "cpq_flows", flow.id), { ...flow, steps: updatedSteps });
  };

  const handleAiGenerateRule = () => {
      if (!aiPrompt) return;
      setIsGeneratingAi(true);
      setTimeout(() => {
          let generatedRule = { name: `AI: ${aiPrompt.substring(0, 30)}...`, conditionField: '', conditionOp: 'EQUALS', conditionVal: '', effectField: '', effectVal: '' };
          const txt = aiPrompt.toLowerCase();

          if (txt.includes("french return") && txt.includes("1")) {
              generatedRule.name = "1in French Return Math Logic";
              generatedRule.conditionField = "productType"; 
              generatedRule.conditionVal = "FRENCH RETURN";
              generatedRule.effectField = "MATH.frenchReturn1in"; 
              generatedRule.effectVal = "true";
          } else if (txt.includes("mitered")) {
              generatedRule.name = "Mitered Bay Math Logic";
              generatedRule.conditionField = "productType"; 
              generatedRule.conditionVal = "MITERED BAY";
              generatedRule.effectField = "MATH.miteredBay"; 
              generatedRule.effectVal = "true";
          } else if (txt.includes("light") && (txt.includes("fabric") || txt.includes("weight"))) { 
              generatedRule.conditionField = "customData.weightClass"; generatedRule.conditionVal = "LIGHTWEIGHT"; 
              generatedRule.effectField = "UI.disableStep"; generatedRule.effectVal = "Select Trim / Fringe";
          } else if (txt.includes("heavy") || txt.includes("weight")) { 
              generatedRule.conditionField = "customData.weightClass"; generatedRule.conditionVal = "HEAVY"; 
              generatedRule.effectField = "MATH.maxBracketSpacing"; generatedRule.effectVal = "30";
          }

          setNewRule(generatedRule); setAiPrompt(""); setIsGeneratingAi(false);
          alert("✨ AI successfully parsed your request and pre-filled the rule parameters!");
      }, 1000);
  };

  const handleAddRule = async () => {
      if (!newRule.name || !newRule.conditionField || !newRule.effectField) return alert("Fill in required fields.");
      const updatedRules = [...cpqRules, { id: `RULE-${Date.now()}`, ...newRule }];
      await setDoc(doc(db, "system", "cpq_rules"), { rules: updatedRules }, { merge: true });
      setNewRule({ name: '', conditionField: '', conditionOp: 'EQUALS', conditionVal: '', effectField: '', effectVal: '' });
  };

  const handleDeleteRule = async (ruleId) => {
      const updatedRules = cpqRules.filter(r => r.id !== ruleId);
      await setDoc(doc(db, "system", "cpq_rules"), { rules: updatedRules }, { merge: true });
  };

  const handleNukeJobs = async () => {
      const promptStr = window.prompt('Type "DELETE ALL JOBS" to confirm this permanent wipeout:');
      if (promptStr === "DELETE ALL JOBS") {
          try {
              const jobsSnap = await getDocs(collection(db, "jobs"));
              const draftsSnap = await getDocs(collection(db, "cpq_drafts"));
              await Promise.all([...jobsSnap.docs.map(d => deleteDoc(doc(db, "jobs", d.id))), ...draftsSnap.docs.map(d => deleteDoc(doc(db, "cpq_drafts", d.id)))]);
              alert("✅ ALL PIPELINE JOBS AND DRAFTS HAVE BEEN NUKED.");
          } catch(e) { console.error(e); }
      }
  };

  const handleNukeAssemblies = async () => { 
      const promptStr = window.prompt('Type "DELETE ALL ASSEMBLIES" to confirm:'); 
      if (promptStr === "DELETE ALL ASSEMBLIES") {
          try {
              const snap = await getDocs(query(collection(db, "Approved_Designs"), where("partClass", "in", ["Assembly", "Master Assembly"])));
              await Promise.all(snap.docs.map(d => deleteDoc(doc(db, "Approved_Designs", d.id))));
              alert("✅ ALL ASSEMBLIES NUKED.");
          } catch(e) { console.error(e); }
      }
  };
  
  const handleNukeLibrary = async () => { 
      const promptStr = window.prompt('Type "DELETE MASTER LIBRARY" to confirm:'); 
      if (promptStr === "DELETE MASTER LIBRARY") {
          try {
              const snap = await getDocs(query(collection(db, "Approved_Designs"), where("partClass", "==", "Inventory")));
              await Promise.all(snap.docs.map(d => deleteDoc(doc(db, "Approved_Designs", d.id))));
              alert("✅ MASTER INVENTORY NUKED.");
          } catch(e) { console.error(e); }
      }
  };

  const handleLogoUpload = async (e, brandKey) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.type !== "image/svg+xml" && file.type !== "image/png") {
          return alert("Please upload an SVG or PNG file. SVG is highly recommended for documents.");
      }
      setIsUploadingLogo(true);
      try {
          const logoRef = ref(storage, `brand_logos/${brandKey}_logo_${Date.now()}.${file.name.split('.').pop()}`);
          await uploadBytes(logoRef, file);
          const dlUrl = await getDownloadURL(logoRef);
          
          await setDoc(doc(db, "hq_config", "brand_logos"), { [brandKey]: dlUrl }, { merge: true });
          alert(`✅ Logo updated for ${brandKey.toUpperCase()}`);
      } catch (err) {
          console.error(err);
          alert("Failed to upload logo.");
      }
      setIsUploadingLogo(false);
  };

  const handleSaveFormTemplate = async () => {
      try {
          await setDoc(doc(db, "hq_config", "form_templates"), {
              [activeFormType]: formEditor
          }, { merge: true });
          alert(`✅ Template saved for ${activeFormType.replace('_', ' ')}`);
      } catch (err) {
          console.error(err);
          alert("Failed to save template.");
      }
  };

  const getDataSourceItems = (source) => {
      if (!source) return [];
      if (source === 'master_finishes') {
          return [
              ...globalFinishes.map(f => ({ id: f.id, name: f.name })), 
              ...outsourceFinishes.map(f => ({ id: f.id, name: f.name }))
          ];
      }
      
      if (globalLists.prodTypes?.includes(source)) {
          return allApprovedDesigns.filter(p => p.manufacturingSpecs?.productType === source || p.productType === source).map(p => ({ id: p.id, name: p.itemName }));
      }
      if (globalLists.inventoryTypes?.includes(source) || globalLists.assemblyTypes?.includes(source)) {
          return allApprovedDesigns.filter(p => p.routingType === source).map(p => ({ id: p.id, name: p.itemName }));
      }

      const customAssets = dynamicAssets.filter(a => a.windowId === source);
      if (customAssets.length > 0) return customAssets.map(a => ({ id: a.id, name: a.name }));
      if (globalLists[source]) return globalLists[source].map(v => ({ id: v, name: v }));
      if (source === 'master_fabrics') return allApprovedDesigns.filter(p => ['TEXTILE', 'FABRIC', 'RAW MATERIAL'].includes(p.manufacturingSpecs?.productType)).map(p => ({ id: p.id, name: p.itemName }));
      if (source === 'master_trims') return allApprovedDesigns.filter(p => ['TRIMMING', 'COMPONENT'].includes(p.manufacturingSpecs?.productType)).map(p => ({ id: p.id, name: p.itemName }));
      return [];
  };

  const activeFlow = cpqFlows.find(f => f.id === activeFlowId);
  const orphanedAssemblies = masterAssemblies.filter(asm => !cpqFlows.some(flow => flow.linkedAssemblyId === asm.id));
  const availableSourceItems = getDataSourceItems(newStep.dataSource);
  const linkedAsm = masterAssemblies.find(a => a.id === flowSettings.linkedAssemblyId);

  const optionsToMap = (newStep.allowedOptions && newStep.allowedOptions.length > 0) 
      ? availableSourceItems.filter(opt => newStep.allowedOptions.includes(opt.id)) 
      : availableSourceItems;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', fontFamily: 'monospace', backgroundColor: '#e5e5e5', minHeight: '100vh' }}>
      <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '5px 5px 0 #000' }}>
        <div><h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.4rem' }}>11. System Administration</h2><span style={{ fontSize: '0.7rem', color: '#666' }}>SUPERUSER ACCESS GRANTED: {currentUser}</span></div>
      </div>

      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
        <div style={{ width: '250px', background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 #000', flexShrink: 0 }}>
          <div style={{ padding: '15px', background: '#000', color: '#fff', fontWeight: 'bold' }}>SYSTEM CONTROLS</div>
          <button onClick={() => setActiveSection("CPQ_FLOWS")} style={{ padding: '15px', textAlign: 'left', background: activeSection === "CPQ_FLOWS" ? '#f4f4f4' : '#fff', border: 'none', borderBottom: '1px solid #eee', fontWeight: 'bold', cursor: 'pointer', borderLeft: activeSection === "CPQ_FLOWS" ? '4px solid #007bff' : '4px solid transparent' }}>⚙️ CPQ FLOW BUILDER</button>
          <button onClick={() => setActiveSection("RULES")} style={{ padding: '15px', textAlign: 'left', background: activeSection === "RULES" ? '#f4f4f4' : '#fff', border: 'none', borderBottom: '1px solid #eee', fontWeight: 'bold', cursor: 'pointer', borderLeft: activeSection === "RULES" ? '4px solid #007bff' : '4px solid transparent' }}>📐 CPQ LOGIC ENGINE</button>
          <button onClick={() => setActiveSection("CRM_SETTINGS")} style={{ padding: '15px', textAlign: 'left', background: activeSection === "CRM_SETTINGS" ? '#f4f4f4' : '#fff', border: 'none', borderBottom: '1px solid #eee', fontWeight: 'bold', cursor: 'pointer', borderLeft: activeSection === "CRM_SETTINGS" ? '4px solid #fd7e14' : '4px solid transparent' }}>👥 CRM & SALES CONFIG</button>
          <button onClick={() => setActiveSection("NETSUITE_SYNC")} style={{ padding: '15px', textAlign: 'left', background: activeSection === "NETSUITE_SYNC" ? '#f4f4f4' : '#fff', border: 'none', borderBottom: '1px solid #eee', fontWeight: 'bold', cursor: 'pointer', borderLeft: activeSection === "NETSUITE_SYNC" ? '4px solid #6f42c1' : '4px solid transparent' }}>🌐 NETSUITE SYNC</button>
          <button onClick={() => setActiveSection("FORMS")} style={{ padding: '15px', textAlign: 'left', background: activeSection === "FORMS" ? '#f4f4f4' : '#fff', border: 'none', borderBottom: '1px solid #eee', fontWeight: 'bold', cursor: 'pointer', borderLeft: activeSection === "FORMS" ? '4px solid #28a745' : '4px solid transparent' }}>📝 FORM TEMPLATES</button>
          <button onClick={() => setActiveSection("USERS")} style={{ padding: '15px', textAlign: 'left', background: activeSection === "USERS" ? '#f4f4f4' : '#fff', border: 'none', borderBottom: '1px solid #eee', fontWeight: 'bold', cursor: 'pointer', borderLeft: activeSection === "USERS" ? '4px solid #007bff' : '4px solid transparent' }}>👥 USER MATRIX</button>
          <button onClick={() => setActiveSection("DANGER")} style={{ padding: '15px', textAlign: 'left', background: activeSection === "DANGER" ? '#ffebee' : '#fff', color: '#d9534f', border: 'none', fontWeight: 'bold', cursor: 'pointer', borderLeft: activeSection === "DANGER" ? '4px solid #d9534f' : '4px solid transparent' }}>⚠️ DANGER ZONE</button>
          
          {/* HIDDEN SUPER ADMIN TAB */}
          {isSuperAdmin && (
              <button onClick={() => setActiveSection("SUPER_ADMIN")} style={{ padding: '15px', textAlign: 'left', background: activeSection === "SUPER_ADMIN" ? '#f4f4f4' : '#fff', color: '#000', border: 'none', borderBottom: '1px solid #eee', fontWeight: 'bold', cursor: 'pointer', borderLeft: activeSection === "SUPER_ADMIN" ? '4px solid #000' : '4px solid transparent' }}>
                  🕵️‍♂️ 15.5 SUPER ADMIN
              </button>
          )}
        </div>

        <div style={{ flex: 1, background: '#fff', border: '2px solid #000', minHeight: '600px', boxShadow: '10px 10px 0 #000' }}>
          
          {/* NETSUITE INTEGRATION MODULE */}
          {activeSection === "NETSUITE_SYNC" && (
              <div style={{ padding: '30px', display: 'flex', gap: '20px', alignItems: 'stretch' }}>
                  
                  {/* Left Column: Sync Controls */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000', paddingBottom: '10px' }}>
                          <h3 style={{ margin: 0, color: '#6f42c1' }}>🌐 NETSUITE MASTER SYNC (PULL)</h3>
                      </div>
                      
                      <div style={{ background: '#f8f9fa', border: '2px solid #000', padding: '15px' }}>
                          <label style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#007bff', display: 'block', marginBottom: '5px' }}>TARGET SUBSIDIARY ID (Optional in Safe Mode):</label>
                          <input 
                              type="number" 
                              value={nsSubsidiaryId} 
                              onChange={e => setNsSubsidiaryId(e.target.value)} 
                              placeholder="e.g. 3 (Classical Elements)" 
                              style={{ width: '100%', padding: '10px', border: '2px solid #007bff', boxSizing: 'border-box', fontWeight: 'bold', fontSize: '1.2rem' }} 
                          />
                          <p style={{ fontSize: '0.7rem', color: '#666', marginTop: '5px' }}>The Internal ID of the NetSuite subsidiary you want to import data from.</p>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                          <button onClick={handleSyncCustomers} disabled={isSyncing} style={{ padding: '20px', background: isSyncing ? '#ccc' : '#fd7e14', color: '#fff', fontWeight: 'bold', border: '2px solid #000', cursor: isSyncing ? 'wait' : 'pointer', textAlign: 'left', fontSize: '1rem', boxShadow: '4px 4px 0 rgba(0,0,0,0.1)' }}>
                              ⬇️ 1. SYNC ACTIVE CUSTOMERS
                              <div style={{ fontSize: '0.65rem', fontWeight: 'normal', marginTop: '5px' }}>SuiteQL: Pulls all active customers mapped to Subsidiary {nsSubsidiaryId}.</div>
                          </button>

                          <button onClick={handleSyncVendors} disabled={isSyncing} style={{ padding: '20px', background: isSyncing ? '#ccc' : '#17a2b8', color: '#fff', fontWeight: 'bold', border: '2px solid #000', cursor: isSyncing ? 'wait' : 'pointer', textAlign: 'left', fontSize: '1rem', boxShadow: '4px 4px 0 rgba(0,0,0,0.1)' }}>
                              ⬇️ 1.5 SYNC ACTIVE VENDORS (CO-OP CRM)
                              <div style={{ fontSize: '0.65rem', fontWeight: 'normal', marginTop: '5px' }}>SuiteQL: Pulls all active external vendors/co-ops from NetSuite.</div>
                          </button>
                          
                          <button onClick={() => handleSyncItems('Inventory')} disabled={isSyncing} style={{ padding: '20px', background: isSyncing ? '#ccc' : '#007bff', color: '#fff', fontWeight: 'bold', border: '2px solid #000', cursor: isSyncing ? 'wait' : 'pointer', textAlign: 'left', fontSize: '1rem', boxShadow: '4px 4px 0 rgba(0,0,0,0.1)' }}>
                              ⬇️ 2. SYNC INVENTORY / COMPONENTS
                              <div style={{ fontSize: '0.65rem', fontWeight: 'normal', marginTop: '5px' }}>SuiteQL: Pulls non-assembly items where "Sync to CPQ App" is checked.</div>
                          </button>

                          <button onClick={() => handleSyncItems('Assembly')} disabled={isSyncing} style={{ padding: '20px', background: isSyncing ? '#ccc' : '#28a745', color: '#fff', fontWeight: 'bold', border: '2px solid #000', cursor: isSyncing ? 'wait' : 'pointer', textAlign: 'left', fontSize: '1rem', boxShadow: '4px 4px 0 rgba(0,0,0,0.1)' }}>
                              ⬇️ 3. SYNC KITS / ASSEMBLIES
                              <div style={{ fontSize: '0.65rem', fontWeight: 'normal', marginTop: '5px' }}>SuiteQL: Pulls Assembly Items where "Sync to CPQ App" is checked.</div>
                          </button>
                      </div>
                  </div>

                  {/* Right Column: Terminal */}
                  <div style={{ flex: 1, background: '#1e1e1e', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 #000' }}>
                      <div style={{ padding: '10px 15px', background: '#333', color: '#fff', fontWeight: 'bold', fontSize: '0.8rem', borderBottom: '2px solid #000', display: 'flex', justifyContent: 'space-between' }}>
                          <span>>_ SUITEQL TERMINAL</span>
                          <button onClick={() => setSyncLog([])} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '0.7rem' }}>CLEAR</button>
                      </div>
                      <div style={{ padding: '15px', display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                          {syncLog.length === 0 && <span style={{ color: '#666' }}>Awaiting command...</span>}
                          {syncLog.map((log, idx) => {
                              let color = '#fff';
                              if (log.type === 'error') color = '#ff4d4d';
                              if (log.type === 'success') color = '#28a745';
                              if (log.type === 'warn') color = '#ffc107';
                              
                              return (
                                  <div key={idx} style={{ color, borderBottom: '1px dotted #333', paddingBottom: '4px' }}>
                                      <span style={{ color: '#888', marginRight: '8px' }}>[{log.time}]</span>
                                      {log.msg}
                                  </div>
                              );
                          })}
                      </div>
                  </div>
              </div>
          )}

          {/* FLOW BUILDER */}
          {activeSection === "CPQ_FLOWS" && (
            <div style={{ display: 'flex', flex: 1, height: '100%' }}>
                
                <div style={{ width: '350px', borderRight: '2px solid #000', padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px', background: '#f8f9fa' }}>
                    <h3 style={{ margin: 0, color: '#007bff' }}>ACTIVE CPQ FLOWS</h3>
                    
                    <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                        <input value={newFlowName} onChange={e => setNewFlowName(e.target.value)} placeholder="e.g., CHANDELIER CONFIG" style={{ flex: 1, padding: '8px', border: '1px solid #ccc' }} />
                        <button onClick={handleCreateNewFlow} style={{ background: '#28a745', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer', padding: '0 15px' }}>ADD</button>
                    </div>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px', overflowY: 'auto', flex: 1 }}>
                        {cpqFlows.filter(f => f.brandId === activeBrand).length === 0 && <div style={{color: '#999', fontStyle: 'italic', fontSize: '0.8rem'}}>No flows exist. Create one above!</div>}
                        {cpqFlows.filter(f => f.brandId === activeBrand).map(flow => (
                            <div key={flow.id} onClick={() => setActiveFlowId(flow.id)} style={{ padding: '15px', border: `2px solid ${activeFlowId === flow.id ? '#007bff' : '#ccc'}`, background: activeFlowId === flow.id ? '#e6f2ff' : '#fff', cursor: 'pointer', fontWeight: 'bold', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span>{flow.name}</span>
                                    <span style={{ color: '#007bff' }}>{flow.steps?.length || 0} Steps</span>
                                </div>
                                {flow.legacyErpId && <div style={{ fontSize: '0.65rem', color: '#666' }}>ERP ID: {flow.legacyErpId}</div>}
                            </div>
                        ))}
                    </div>

                    {orphanedAssemblies.length > 0 && (
                        <div style={{ marginTop: '20px', borderTop: '2px solid #ccc', paddingTop: '15px' }}>
                            <h4 style={{ margin: '0 0 10px 0', color: '#e83e8c', fontSize: '0.85rem' }}>⚠️ PENDING CPQ SETUP</h4>
                            <div style={{ fontSize: '0.7rem', color: '#666', marginBottom: '10px' }}>These assemblies were flagged for CPQ routing but don't have a flow yet.</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {orphanedAssemblies.map(asm => (
                                    <button 
                                        key={asm.id}
                                        onClick={() => handleAutoCreateFlowForAssembly(asm)}
                                        style={{ padding: '10px', background: '#e83e8c', color: '#fff', fontWeight: 'bold', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: '0.75rem', boxShadow: '2px 2px 0 rgba(0,0,0,0.2)' }}
                                    >
                                        + CREATE FLOW: {asm.itemName}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div style={{ flex: 1, padding: '20px', overflowY: 'auto' }}>
                    {!activeFlow ? (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontWeight: 'bold', height: '100%' }}>SELECT OR CREATE A FLOW TO EDIT</div>
                    ) : (
                        <div>
                            <div style={{ background: '#eafaf1', border: '2px solid #28a745', padding: '15px', marginBottom: '20px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #28a745', paddingBottom: '10px', marginBottom: '15px' }}>
                                    <h4 style={{ margin: '0', color: '#1e7e34' }}>🗄️ FILE CABINET LINK (MASTER ASSEMBLY)</h4>
                                </div>
                                
                                <div style={{ marginBottom: '15px' }}>
                                    <label style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#333' }}>LINK TO MASTER ASSEMBLY (FROM TAB 2):</label>
                                    <select 
                                        value={flowSettings.linkedAssemblyId || ""} 
                                        onChange={(e) => {
                                            const asm = masterAssemblies.find(a => a.id === e.target.value);
                                            setFlowSettings({
                                                ...flowSettings, 
                                                linkedAssemblyId: e.target.value, 
                                                legacyErpId: asm?.legacyErpId || '', 
                                                name: asm?.itemName || flowSettings.name, 
                                                basePrice: asm?.manufacturingSpecs?.basePrice || flowSettings.basePrice 
                                            });
                                        }}
                                        style={{ width: '100%', padding: '10px', border: '2px solid #28a745', boxSizing: 'border-box', fontWeight: 'bold', background: '#fff' }}
                                    >
                                        <option value="">-- UNLINKED (STANDALONE FLOW) --</option>
                                        {masterAssemblies.map(a => <option key={a.id} value={a.id}>{a.itemName} {a.legacyErpId && `[${a.legacyErpId}]`}</option>)}
                                    </select>
                                </div>

                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <div style={{ flex: 2 }}>
                                        <label style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#333' }}>CPQ FLOW NAME:</label>
                                        <input value={flowSettings.name} onChange={e => setFlowSettings({...flowSettings, name: e.target.value})} style={{ width: '100%', padding: '8px', border: '1px solid #ccc', boxSizing: 'border-box', fontWeight: 'bold' }} />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#007bff' }}>ERP ITEM ID:</label>
                                        <input value={flowSettings.legacyErpId} onChange={e => setFlowSettings({...flowSettings, legacyErpId: e.target.value})} placeholder="e.g. ASM-1234" style={{ width: '100%', padding: '8px', border: '2px solid #007bff', boxSizing: 'border-box' }} />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#CC6600' }}>BASE PRICE ($):</label>
                                        <input type="number" step="0.01" value={flowSettings.basePrice} onChange={e => setFlowSettings({...flowSettings, basePrice: e.target.value})} placeholder="0.00" style={{ width: '100%', padding: '8px', border: '2px solid #CC6600', boxSizing: 'border-box' }} />
                                    </div>
                                </div>
                                
                                <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
                                    <button onClick={handleSaveFlowSettings} style={{ flex: 2, padding: '10px 20px', background: isSavingFlowSettings ? '#ccc' : '#000', color: '#fff', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>
                                        {isSavingFlowSettings ? "SYNCING TO DATABASE..." : "💾 SAVE AND CASCADE TO MASTER ASSEMBLY"}
                                    </button>
                                    <button onClick={handleDeleteFlow} style={{ flex: 1, padding: '10px 20px', background: '#d9534f', color: '#fff', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>
                                        🗑️ DELETE FLOW
                                    </button>
                                </div>
                            </div>

                            <h3 style={{ margin: '0 0 15px 0', color: '#000', borderBottom: '2px solid #eee', paddingBottom: '10px' }}>CONFIGURE CONFIGURATOR STEPS</h3>
                            
                            {flowSettings.linkedAssemblyId && (
                                <div style={{ background: '#f0f8ff', padding: '15px', border: '2px dashed #007bff', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <h4 style={{ margin: '0 0 5px 0', color: '#007bff' }}>⚡ AUTO-SYNC AVAILABLE</h4>
                                        <span style={{ fontSize: '0.8rem', color: '#666' }}>Detected <strong>{linkedBomPins.length} Sub-Assemblies/Components</strong> in the Master File Cabinet.</span>
                                    </div>
                                    <button onClick={() => handleAutoSyncBOM(activeFlow)} style={{ padding: '10px 20px', background: '#007bff', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer', boxShadow: '2px 2px 0 rgba(0,0,0,0.2)' }}>
                                        AUTO-GENERATE STEPS ➔
                                    </button>
                                </div>
                            )}

                            <div style={{ background: newStep.id ? '#fff3cd' : '#f8f9fa', padding: '15px', border: newStep.id ? '2px dashed #ffc107' : '1px solid #ccc', marginBottom: '20px' }}>
                                <h4 style={{ margin: '0 0 10px 0', color: newStep.id ? '#856404' : '#000' }}>
                                    {newStep.id ? "✏️ EDIT STEP" : "+ MANUAL STEP BUILDER"}
                                </h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    <input value={newStep.title} onChange={e => setNewStep({...newStep, title: e.target.value})} placeholder="Step Title (e.g. Select Bracket Style)" style={{ padding: '8px', border: '1px solid #ccc' }} />
                                    <div style={{ display: 'flex', gap: '10px' }}>
                                        <select value={newStep.type} onChange={e => setNewStep({...newStep, type: e.target.value, dataSource: e.target.value === 'STATIC_FEE' ? '' : newStep.dataSource})} style={{ flex: 1, padding: '8px', border: '1px solid #ccc' }}>
                                            <option value="DROPDOWN">Dropdown List</option>
                                            <option value="VISUAL_GRID">Visual Grid (Images/Textures)</option>
                                            <option value="VISUAL_DIMENSIONS">Visual Grid + Dimensions (2-in-1)</option>
                                            <option value="DIMENSIONS">Dimensional Input Only (Math)</option>
                                            <option value="STATIC_FEE">Static Fee / Quantity Only</option>
                                        </select>
                                        
                                        <select value={newStep.dataSource} onChange={e => setNewStep({...newStep, dataSource: e.target.value, allowedOptions: []})} disabled={newStep.type === 'DIMENSIONS' || newStep.type === 'STATIC_FEE'} style={{ flex: 1, padding: '8px', border: '2px solid #007bff', fontWeight: 'bold', opacity: (newStep.type === 'DIMENSIONS' || newStep.type === 'STATIC_FEE') ? 0.5 : 1 }}>
                                            <option value="">-- SELECT DATA SOURCE --</option>
                                            <optgroup label="Core Libraries">
                                                <option value="master_finishes">Master Finishes (In-House & Outsource)</option>
                                            </optgroup>
                                            <optgroup label="Master Library: Product Types">
                                                {(globalLists.prodTypes || []).map(pt => <option key={pt} value={pt}>Product Type: {pt}</option>)}
                                            </optgroup>
                                            <optgroup label="Master Library: Routing Types">
                                                {(globalLists.inventoryTypes || []).map(it => <option key={it} value={it}>Routing: {it} (Inventory)</option>)}
                                                {(globalLists.assemblyTypes || []).map(at => <option key={at} value={at}>Routing: {at} (Assembly)</option>)}
                                            </optgroup>
                                            {customDataWindows.length > 0 && (
                                                <optgroup label="CPQ Asset Dictionaries (Tab 4)">
                                                    {customDataWindows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                                                </optgroup>
                                            )}
                                            <optgroup label="Simple Lists (Tab 4)">
                                                <option value="uom">UOMs</option>
                                                <option value="pillowSizes">Pillow Sizes</option>
                                                <option value="fillTypes">Fill Types</option>
                                                <option value="flangeStyles">Edge / Flange Styles</option>
                                                <option value="stitchTypes">Stitch Routing</option>
                                                <option value="seamCounts">Seam Counts</option>
                                            </optgroup>
                                        </select>
                                    </div>

                                    {(newStep.type === 'VISUAL_DIMENSIONS' || newStep.type === 'DIMENSIONS' || newStep.calculatorTemplate) && (
                                        <div style={{ background: '#eafaf1', padding: '10px', border: '1px solid #28a745' }}>
                                            <label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#1e7e34', display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '5px' }}>
                                                📐 HARDWARE MATH / CALCULATOR TEMPLATE (OPTIONAL)
                                            </label>
                                            <select value={newStep.calculatorTemplate || ''} onChange={e => setNewStep({...newStep, calculatorTemplate: e.target.value})} style={{ width: '100%', padding: '8px', border: '2px solid #28a745', boxSizing: 'border-box', fontWeight: 'bold' }}>
                                                <option value="">-- NO CALCULATOR (Standard Step) --</option>
                                                <option value="calc_french_return_1in">1" French Return (+17" cut, C2C -1", Qty = Feet)</option>
                                                <option value="calc_mitered_bay">Mitered Bay (Wall A/B/C + Angles, Qty = Feet)</option>
                                                <option value="calc_curved_bay">Curved Bay (Arc / Radius, Qty = Feet)</option>
                                                <option value="calc_straight_pole">Straight Pole (Qty = Feet)</option>
                                            </select>
                                            <span style={{ fontSize: '0.65rem', color: '#666', display: 'block', marginTop: '4px' }}>Attaching a calculator will render dimension inputs (Length, Type, etc.) and auto-calculate the Step Quantity based on the formula.</span>
                                        </div>
                                    )}

                                    <div style={{ background: '#fff', padding: '10px', border: '1px solid #ccc' }}>
                                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>STEP QUANTITY DESCRIPTION (Helper Text):</label>
                                        <input 
                                            value={newStep.qtyHelperText || ''} 
                                            onChange={e => setNewStep({...newStep, qtyHelperText: e.target.value})} 
                                            placeholder="e.g. Enter 4 rings per foot of pole." 
                                            style={{ width: '100%', padding: '8px', border: '1px solid #ccc', boxSizing: 'border-box' }} 
                                        />
                                    </div>

                                    <div style={{ background: '#fff', padding: '10px', border: '1px solid #ccc', marginTop: '10px' }}>
                                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '10px' }}>
                                            🏷️ STEP BASE PRICE / ITEM MAPPING
                                        </label>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                                            <div>
                                                 <label style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#666', display: 'block', marginBottom: '4px' }}>LINK TO LIBRARY ITEM (AUTO-PULLS PRICE):</label>
                                                 <select value={newStep.linkedItemId || newStep.linkedPinId || ''} onChange={e => {
                                                     const selectedId = e.target.value;
                                                     const part = allApprovedDesigns.find(p => p.id === selectedId || p.itemId === selectedId || p.legacyErpId === selectedId);
                                                     let extractedPrice = '';
                                                     
                                                     if (part) {
                                                         const specs = part.manufacturingSpecs || {};
                                                         const bp = specs.basePrice !== undefined && specs.basePrice !== "" ? parseFloat(specs.basePrice) : 0;
                                                         if (bp > 0) extractedPrice = bp;
                                                         else extractedPrice = 0;
                                                     }
                                                     
                                                     setNewStep(prev => ({...prev, linkedItemId: selectedId, linkedPinId: selectedId, basePrice: extractedPrice}));
                                                 }} style={{ width: '100%', padding: '8px', border: '1px solid #ccc', boxSizing: 'border-box', fontWeight: 'bold' }}>
                                                     <option value="">-- No Item Linked --</option>
                                                     {allApprovedDesigns.filter(p => p.partClass === 'Inventory' || p.partClass === 'Assembly').map(p => <option key={p.id} value={p.id}>{p.itemName} {p.legacyErpId && p.legacyErpId !== 'PENDING' ? `[${p.legacyErpId}]` : ''}</option>)}
                                                 </select>
                                            </div>
                                            <div>
                                                <label style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#333', display: 'block', marginBottom: '4px' }}>STEP BASE PRICE ($):</label>
                                                <div style={{ display: 'flex', gap: '5px' }}>
                                                    <input 
                                                        type="number" 
                                                        step="0.01" 
                                                        value={newStep.basePrice !== undefined && newStep.basePrice !== null && newStep.basePrice !== '' ? newStep.basePrice : ''} 
                                                        onChange={e => setNewStep({...newStep, basePrice: e.target.value})} 
                                                        placeholder="e.g. 15.00" 
                                                        style={{ flex: 1, padding: '8px', border: '2px solid #28a745', boxSizing: 'border-box', fontWeight: 'bold' }} 
                                                    />
                                                    <button 
                                                        onClick={() => {
                                                            const selectedId = newStep.linkedItemId || newStep.linkedPinId;
                                                            if (!selectedId) return alert("Please link a library item first.");
                                                            const part = allApprovedDesigns.find(p => p.id === selectedId || p.itemId === selectedId || p.legacyErpId === selectedId);
                                                            if (part) {
                                                                const bp = parseFloat(part.manufacturingSpecs?.basePrice) || parseFloat(part.basePrice) || 0;
                                                                setNewStep(prev => ({...prev, basePrice: bp}));
                                                            } else {
                                                                alert("Item not found in library.");
                                                            }
                                                        }}
                                                        style={{ padding: '8px 12px', background: '#28a745', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.7rem' }}>
                                                        🔄 FETCH
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {newStep.dataSource && availableSourceItems.length > 0 && newStep.type !== 'DIMENSIONS' && newStep.type !== 'STATIC_FEE' && (
                                        <div style={{ background: '#fff', border: '1px solid #ccc', padding: '10px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                                <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#007bff' }}>🔍 RESTRICT AVAILABLE OPTIONS (Leave empty to allow all):</span>
                                                <span style={{ fontSize: '0.65rem', color: '#666', fontWeight: 'bold' }}>{newStep.allowedOptions?.length || 0} Restricted Selected</span>
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px', maxHeight: '150px', overflowY: 'auto', background: '#f8f9fa', padding: '10px', border: '1px solid #eee' }}>
                                                {availableSourceItems.map(item => (
                                                    <label key={item.id} style={{ fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={(newStep.allowedOptions || []).includes(item.id)}
                                                            onChange={(e) => {
                                                                const curr = newStep.allowedOptions || [];
                                                                if (e.target.checked) setNewStep({...newStep, allowedOptions: [...curr, item.id]});
                                                                else setNewStep({...newStep, allowedOptions: curr.filter(id => id !== item.id)});
                                                            }}
                                                        />
                                                        {item.name}
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    
                                    <div style={{ background: '#e3f2fd', padding: '10px', border: '1px solid #007bff' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                                            <label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#007bff' }}>🎯 TARGET 3D MESH/NODE NAME (FOR GLOBAL TEXTURE CHANGES)</label>
                                            <button 
                                                onClick={handleInspectNodes} 
                                                disabled={isInspecting}
                                                style={{ padding: '3px 8px', background: '#fff', color: '#007bff', border: '1px solid #007bff', fontSize: '0.65rem', fontWeight: 'bold', cursor: isInspecting ? 'wait' : 'pointer' }}
                                            >
                                                {isInspecting ? 'SCANNING...' : '🔍 INSPECT 3D NODES'}
                                            </button>
                                        </div>

                                        {linkedAsm?.nodeClusters?.length > 0 && (
                                            <div style={{ marginBottom: '10px', background: '#eafaf1', border: '1px solid #28a745', padding: '10px' }}>
                                                <div style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#1e7e34', marginBottom: '5px' }}>📦 SAVED SUB-ASSEMBLIES (FROM TAB 1.5):</div>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                                                    {linkedAsm.nodeClusters.map(cluster => {
                                                        const clusterNodes = cluster.nodes || cluster.meshes || [];
                                                        return (
                                                            <span 
                                                                key={cluster.id} 
                                                                onClick={() => setNewStep(prev => ({...prev, targetNodes: prev.targetNodes ? `${prev.targetNodes}, ${clusterNodes.join(', ')}` : clusterNodes.join(', ')}))} 
                                                                style={{ background: '#28a745', color: '#fff', padding: '4px 8px', fontSize: '0.65rem', cursor: 'pointer', borderRadius: '4px', fontWeight: 'bold', boxShadow: '2px 2px 0 rgba(0,0,0,0.1)' }}
                                                            >
                                                                {cluster.name} ({clusterNodes.length} Nodes)
                                                            </span>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                        
                                        {inspectedNodes.length > 0 && (
                                            <div style={{ marginBottom: '10px', background: '#fff', border: '1px solid #ccc', padding: '5px', maxHeight: '100px', overflowY: 'auto' }}>
                                                <div style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#666', marginBottom: '5px' }}>AVAILABLE MESHES IN FILE:</div>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                                                    {inspectedNodes.map((node, i) => (
                                                        <span key={i} onClick={() => setNewStep(prev => ({...prev, targetNodes: prev.targetNodes ? `${prev.targetNodes}, ${node}` : node}))} style={{ background: '#eee', padding: '2px 5px', fontSize: '0.65rem', cursor: 'pointer', border: '1px solid #ccc' }}>
                                                            {node}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        <input value={newStep.targetNodes || ''} onChange={e => setNewStep({...newStep, targetNodes: e.target.value})} placeholder="e.g., Pole_Top, Bracket_Base" style={{ width: '100%', padding: '8px', border: '1px solid #007bff', boxSizing: 'border-box' }} />
                                        <span style={{ fontSize: '0.65rem', color: '#666', display: 'block', marginTop: '4px' }}>If this is a "Finish" step, it applies the texture to these meshes. Comma separate for multiple.</span>
                                    </div>

                                    <div style={{ background: '#eafaf1', padding: '10px', border: '1px solid #28a745', marginTop: '10px' }}>
                                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#1e7e34', display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '5px' }}>
                                            🛤️ PART HANDLING & ROUTING <span style={{ color: '#d9534f' }}>*REQUIRED</span>
                                        </label>
                                        <select value={newStep.partHandling || ''} onChange={e => setNewStep({...newStep, partHandling: e.target.value})} style={{ width: '100%', padding: '8px', border: '1px solid #28a745', boxSizing: 'border-box', fontWeight: 'bold', textTransform: 'uppercase' }}>
                                            <option value="">-- SELECT HANDLING ROUTE --</option>
                                            {(globalLists.partHandling || ['Small Parts', 'Custom']).map(ph => (
                                                <option key={ph} value={ph}>{ph.toUpperCase()}</option>
                                            ))}
                                        </select>
                                        <span style={{ fontSize: '0.65rem', color: '#666', display: 'block', marginTop: '4px' }}>Groups parts with identical handling together in production (e.g. Finishing vs Shop Floor). This list is managed in Tab 4 Master Lists.</span>
                                    </div>

                                    <div style={{ background: '#fff3cd', padding: '10px', border: '1px solid #ffeeba', marginTop: '10px' }}>
                                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#856404', display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '10px' }}>
                                            💰 ADVANCED PRICING RULES
                                        </label>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                                            <label style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 'bold', color: '#856404' }}>
                                                <input type="checkbox" checked={newStep.useClientPricing || false} onChange={e => setNewStep({...newStep, useClientPricing: e.target.checked})} style={{ transform: 'scale(1.2)' }} />
                                                Enable Client-Specific Pricing (From Tab 3 Mapping)
                                            </label>
                                            <div>
                                                <label style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#dc3545', display: 'block', marginBottom: '4px' }}>FLAT PRICE OVERRIDE ($):</label>
                                                <input type="number" step="0.01" value={newStep.priceOverride || ''} onChange={e => setNewStep({...newStep, priceOverride: e.target.value})} placeholder="Overrides all other pricing" style={{ width: '100%', padding: '8px', border: '1px solid #dc3545', boxSizing: 'border-box', fontWeight: 'bold' }} />
                                            </div>
                                        </div>
                                    </div>
                                    
                                    {optionsToMap.length > 0 && optionsToMap.length < 100 && newStep.type !== 'DIMENSIONS' && newStep.type !== 'STATIC_FEE' && (
                                        <div style={{ background: '#fff', padding: '10px', border: '1px solid #007bff' }}>
                                            <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#007bff', marginBottom: '10px' }}>OPTION PROPERTIES: COST UPCHARGES & GEOMETRY SWAPPING</div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: '10px', maxHeight: '250px', overflowY: 'auto' }}>
                                                <div style={{ fontSize: '0.65rem', color: '#666', fontWeight: 'bold' }}>OPTION NAME (BASE PRICE)</div>
                                                <div style={{ fontSize: '0.65rem', color: '#666', fontWeight: 'bold' }}>PRICE UPCHARGE ($)</div>
                                                <div style={{ fontSize: '0.65rem', color: '#666', fontWeight: 'bold' }}>ASSOC. MESH (VISIBILITY)</div>
                                                
                                                {optionsToMap.map(opt => {
                                                    const partObj = allApprovedDesigns.find(p => p.id === opt.id) || dynamicAssets.find(a => a.id === opt.id) || globalFinishes.find(f => f.id === opt.id) || outsourceFinishes.find(f => f.id === opt.id);
                                                    let bp = 0;
                                                    if (partObj) {
                                                        if (partObj.manufacturingSpecs?.basePrice) bp = parseFloat(partObj.manufacturingSpecs.basePrice);
                                                        else if (partObj.basePrice) bp = parseFloat(partObj.basePrice);
                                                    }
                                                    if (isNaN(bp)) bp = 0;

                                                    return (
                                                        <React.Fragment key={opt.id}>
                                                            <div style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                                                                {opt.name} {bp > 0 && <span style={{ color: '#28a745', marginLeft: '5px', fontWeight: 'bold' }}>(${bp.toFixed(2)})</span>}
                                                            </div>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                                                <span style={{ fontWeight: 'bold' }}>+$</span>
                                                                <input type="number" step="0.5" value={newStep.priceMap?.[opt.id] || ""} onChange={(e) => setNewStep(prev => ({ ...prev, priceMap: { ...prev.priceMap, [opt.id]: parseFloat(e.target.value) || 0 } }))} placeholder="0.00" style={{ width: '100%', padding: '6px', border: '1px solid #ccc', fontWeight: 'bold' }} disabled={newStep.useClientPricing || !!newStep.priceOverride} />
                                                            </div>
                                                            <div>
                                                                <input value={newStep.geometryMap?.[opt.id] || ""} onChange={(e) => setNewStep(prev => ({ ...prev, geometryMap: { ...prev.geometryMap, [opt.id]: e.target.value } }))} placeholder="Mesh to Show (e.g. Bracket_Deluxe)" style={{ width: '100%', padding: '6px', border: '1px solid #ccc' }} />
                                                            </div>
                                                        </React.Fragment>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    <label style={{ fontSize: '0.8rem', display: 'flex', gap: '10px' }}>
                                        <input type="checkbox" checked={newStep.required} onChange={e => setNewStep({...newStep, required: e.target.checked})} /> Required Step
                                    </label>
                                    <div style={{ display: 'flex', gap: '10px' }}>
                                        <button onClick={() => handleAddStepToFlow(activeFlow)} disabled={(newStep.type !== 'DIMENSIONS' && newStep.type !== 'STATIC_FEE') && !newStep.dataSource} style={{ flex: 1, padding: '10px', background: newStep.id ? '#ffc107' : '#000', color: newStep.id ? '#000' : '#fff', fontWeight: 'bold', border: newStep.id ? '2px solid #856404' : 'none', cursor: ((newStep.type === 'DIMENSIONS' || newStep.type === 'STATIC_FEE') || newStep.dataSource) ? 'pointer' : 'not-allowed', opacity: ((newStep.type === 'DIMENSIONS' || newStep.type === 'STATIC_FEE') || newStep.dataSource) ? 1 : 0.5 }}>
                                            {newStep.id ? "💾 SAVE EDITS TO STEP" : "➕ MANUAL ADD STEP"}
                                        </button>
                                        {newStep.id && (
                                            <button onClick={() => setNewStep({ id: null, title: '', type: 'DROPDOWN', dataSource: '', required: true, priceMap: {}, geometryMap: {}, targetNodes: '', allowedOptions: [], useClientPricing: false, priceOverride: '', partHandling: '', calculatorTemplate: '', qtyHelperText: '', basePrice: '', linkedItemId: '' })} style={{ padding: '10px 20px', background: '#fff', color: '#333', border: '2px solid #ccc', fontWeight: 'bold', cursor: 'pointer' }}>
                                                CANCEL EDIT
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {(activeFlow.steps || []).map((step, idx) => (
                                    <div key={step.id} style={{ padding: '15px', background: '#fff', border: '2px solid #ccc', borderLeft: '6px solid #28a745', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div>
                                            <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>Step {idx + 1}: {step.title}</div>
                                            <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '5px' }}>
                                                Type: <strong style={{ color: (step.type.includes('DIMENSIONS') || step.type === 'STATIC_FEE') ? '#e83e8c' : '#333'}}>{step.type}</strong> | Data: <span style={{ color: '#007bff', fontWeight: 'bold' }}>{step.dataSource || 'N/A'}</span> | Required: {step.required ? 'Yes' : 'No'}
                                            </div>
                                            {step.basePrice !== undefined && step.basePrice !== '' && step.basePrice !== null && (
                                                <div style={{ fontSize: '0.65rem', color: '#28a745', marginTop: '3px', fontWeight: 'bold' }}>
                                                    🏷️ BASE PRICE: ${parseFloat(step.basePrice).toFixed(2)}
                                                </div>
                                            )}
                                            {step.allowedOptions && step.allowedOptions.length > 0 && (
                                                <div style={{ fontSize: '0.65rem', color: '#CC6600', marginTop: '3px', fontWeight: 'bold' }}>🔍 RESTRICTED TO: {step.allowedOptions.length} specific options.</div>
                                            )}
                                            {step.calculatorTemplate && <div style={{ fontSize: '0.65rem', color: '#1e7e34', marginTop: '3px', fontWeight: 'bold' }}>📐 CALCULATOR: {step.calculatorTemplate}</div>}
                                            {step.qtyHelperText && <div style={{ fontSize: '0.65rem', color: '#6f42c1', marginTop: '3px', fontWeight: 'bold' }}>ℹ️ HELPER TEXT: {step.qtyHelperText}</div>}
                                            {step.targetNodes && <div style={{ fontSize: '0.65rem', color: '#e83e8c', marginTop: '3px', fontWeight: 'bold' }}>🎨 APPLYING TEXTURES TO: {step.targetNodes.substring(0, 30)}{step.targetNodes.length > 30 ? '...' : ''}</div>}
                                            {step.geometryMap && Object.values(step.geometryMap).some(Boolean) && <div style={{ fontSize: '0.65rem', color: '#28a745', marginTop: '3px', fontWeight: 'bold' }}>🧊 GEOMETRY SWAPPING ACTIVE</div>}
                                            
                                            {step.useClientPricing && <div style={{ fontSize: '0.65rem', color: '#856404', marginTop: '3px', fontWeight: 'bold' }}>💰 CLIENT PRICING ENABLED</div>}
                                            {step.priceOverride && <div style={{ fontSize: '0.65rem', color: '#dc3545', marginTop: '3px', fontWeight: 'bold' }}>⚠️ PRICE OVERRIDE: ${step.priceOverride}</div>}
                                            {step.partHandling && <div style={{ fontSize: '0.65rem', color: '#1e7e34', marginTop: '3px', fontWeight: 'bold' }}>🛤️ ROUTING: {step.partHandling}</div>}
                                        </div>
                                        <div style={{ display: 'flex', gap: '5px' }}>
                                            <button onClick={() => handleMoveStep(activeFlow, idx, 'UP')} disabled={idx === 0} style={{ padding: '5px', cursor: idx === 0 ? 'not-allowed' : 'pointer', background: '#f4f4f4', border: '1px solid #ccc' }}>⬆️</button>
                                            <button onClick={() => handleMoveStep(activeFlow, idx, 'DOWN')} disabled={idx === activeFlow.steps.length - 1} style={{ padding: '5px', cursor: idx === activeFlow.steps.length - 1 ? 'not-allowed' : 'pointer', background: '#f4f4f4', border: '1px solid #ccc' }}>⬇️</button>
                                            <button onClick={() => setNewStep(step)} style={{ padding: '5px 15px', background: '#007bff', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer', marginLeft: '10px' }}>EDIT</button>
                                            <button onClick={() => handleDeleteStep(activeFlow, step.id)} style={{ padding: '5px 15px', background: '#d9534f', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>DEL</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
          )}

          {/* DYNAMIC CPQ RULES ENGINE */}
          {activeSection === "RULES" && (
            <div style={{ padding: '30px' }}>
              <h3 style={{ margin: '0 0 5px 0', borderBottom: '2px solid #000', paddingBottom: '10px', color: '#007bff', textTransform: 'uppercase' }}>Dynamic CPQ Rules Engine</h3>
              <p style={{ color: '#666', fontSize: '0.85rem', marginBottom: '20px' }}>Define conditional logic using the dynamic attributes built in Tab 4. These rules actively dictate CPQ behaviors and UI filters in Tab 8.</p>
              
              <div style={{ background: '#f0f8ff', border: '2px dashed #007bff', padding: '15px', marginBottom: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#007bff', display: 'flex', alignItems: 'center', gap: '5px' }}>✨ AI ASSIST: DESCRIBE YOUR RULE</label>
                  <div style={{ display: 'flex', gap: '10px' }}>
                      <input value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} placeholder="e.g. 'If weight class is light, disable the trim step'" style={{ flex: 1, padding: '10px', border: '1px solid #ccc', boxSizing: 'border-box' }} />
                      <button onClick={handleAiGenerateRule} disabled={isGeneratingAi || !aiPrompt} style={{ padding: '10px 20px', background: isGeneratingAi ? '#ccc' : '#007bff', color: '#fff', fontWeight: 'bold', border: 'none', cursor: isGeneratingAi ? 'wait' : 'pointer' }}>{isGeneratingAi ? 'GENERATING...' : 'GENERATE PARAMETERS'}</button>
                  </div>
              </div>

              <div style={{ background: '#eafaf1', border: '2px solid #28a745', padding: '20px', marginBottom: '30px' }}>
                  <h4 style={{ margin: '0 0 15px 0', color: '#28a745' }}>+ MANUAL RULE BUILDER</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                      <div style={{ gridColumn: 'span 2' }}>
                          <label style={{ fontSize: '0.7rem', fontWeight: 'bold' }}>RULE NAME / DESCRIPTION:</label>
                          <input value={newRule.name} onChange={e => setNewRule({...newRule, name: e.target.value})} placeholder="e.g. Light Fabrics Cannot Have Trim" style={{ width: '100%', padding: '10px', border: '1px solid #ccc', boxSizing: 'border-box' }} />
                      </div>
                      
                      <div style={{ background: '#fff', border: '1px solid #ccc', padding: '10px' }}>
                          <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#007bff', marginBottom: '10px' }}>IF SELECTION CONDITION:</div>
                          <select value={newRule.conditionField} onChange={e => setNewRule({...newRule, conditionField: e.target.value})} style={{ width: '100%', padding: '8px', marginBottom: '10px', border: '1px solid #ccc' }}>
                              <option value="">-- Select Trigger Attribute --</option>
                              <optgroup label="Core Specs">
                                  <option value="productType">Product Type</option>
                              </optgroup>
                              <optgroup label="Dynamic Schema (Tab 4)">
                                  {customSchema.map(f => <option key={f.key} value={`customData.${f.key}`}>{f.label}</option>)}
                              </optgroup>
                          </select>
                          <div style={{ display: 'flex', gap: '10px' }}>
                              <select value={newRule.conditionOp} onChange={e => setNewRule({...newRule, conditionOp: e.target.value})} style={{ flex: 1, padding: '8px', border: '1px solid #ccc' }}>
                                  <option value="EQUALS">EQUALS</option><option value="NOT_EQUALS">NOT EQUALS</option><option value="CONTAINS">CONTAINS</option>
                              </select>
                              <input value={newRule.conditionVal} onChange={e => setNewRule({...newRule, conditionVal: e.target.value})} placeholder="Value (e.g. LIGHTWEIGHT)" style={{ flex: 2, padding: '8px', border: '1px solid #ccc', boxSizing: 'border-box' }} />
                          </div>
                      </div>

                      <div style={{ background: '#fff', border: '1px solid #ccc', padding: '10px' }}>
                          <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#CC6600', marginBottom: '10px' }}>THEN EFFECT:</div>
                          <select value={newRule.effectField} onChange={e => setNewRule({...newRule, effectField: e.target.value})} style={{ width: '100%', padding: '8px', marginBottom: '10px', border: '1px solid #ccc' }}>
                              <option value="">-- Select Target System Rule --</option>
                              <optgroup label="UI Controls">
                                  <option value="UI.disableStep">DISABLE Step (Name)</option>
                                  <option value="UI.hideFinishes">HIDE Specific Finishes</option>
                              </optgroup>
                              <optgroup label="Hardware Calculations & Mathematics">
                                  <option value="MATH.maxBracketSpacing">SET Max Bracket Spacing (in)</option>
                                  <option value="MATH.frenchReturn1in">APPLY 1" French Return Logic (17" add, 1" C2C ded)</option>
                                  <option value="MATH.miteredBay">APPLY Mitered Bay Logic (Wall A/B/C + Angles)</option>
                                  <option value="MATH.curvedBay">APPLY Curved Bay Logic (Arc/Radius)</option>
                              </optgroup>
                          </select>
                          <input value={newRule.effectVal} onChange={e => setNewRule({...newRule, effectVal: e.target.value})} placeholder="Effect Value (e.g. Select Trim / Fringe)" style={{ width: '100%', padding: '8px', border: '1px solid #ccc', boxSizing: 'border-box' }} />
                      </div>
                  </div>
                  <button onClick={handleAddRule} style={{ width: '100%', padding: '12px', background: '#28a745', color: '#fff', fontWeight: 'bold', border: 'none', cursor: 'pointer', marginTop: '15px' }}>➕ INJECT RULE INTO CPQ</button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {cpqRules.length === 0 && <div style={{ padding: '20px', background: '#f8f9fa', fontStyle: 'italic', color: '#666', border: '1px dashed #ccc' }}>No dynamic rules configured yet.</div>}
                  {cpqRules.map(rule => (
                      <div key={rule.id} style={{ background: '#fff', border: '2px solid #333', borderLeft: '6px solid #28a745', padding: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '4px 4px 0 rgba(0,0,0,0.05)' }}>
                          <div>
                              <div style={{ fontWeight: 'bold', fontSize: '1.1rem', color: '#333' }}>{rule.name}</div>
                              <div style={{ fontSize: '0.8rem', marginTop: '5px', display: 'flex', gap: '15px', color: '#555' }}>
                                  <span><strong style={{color:'#007bff'}}>IF:</strong> {rule.conditionField.replace('customData.', '')} {rule.conditionOp} "{rule.conditionVal}"</span>
                                  <span><strong style={{color:'#CC6600'}}>THEN:</strong> {rule.effectField} = "{rule.effectVal}"</span>
                              </div>
                          </div>
                          <button onClick={() => handleDeleteRule(rule.id)} style={{ background: 'none', border: 'none', color: '#d9534f', fontSize: '1.2rem', cursor: 'pointer' }}>🗑️</button>
                      </div>
                  ))}
              </div>
            </div>
          )}

          {/* CRM & SALES CONFIGURATION VIEW */}
          {activeSection === "CRM_SETTINGS" && (
              <div style={{ padding: '30px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000', paddingBottom: '10px', marginBottom: '20px' }}>
                      <h3 style={{ margin: 0 }}>👥 CRM & SALES DICTIONARIES</h3>
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                      
                      {/* DISCOUNT CODES */}
                      <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 #17a2b8' }}>
                          <h4 style={{ margin: '0 0 15px 0', color: '#17a2b8', borderBottom: '2px solid #eee', paddingBottom: '5px' }}>💰 DISCOUNT CODES</h4>
                          <div style={{ background: '#e0f7fa', padding: '10px', display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '15px' }}>
                              <div style={{ display: 'flex', gap: '10px' }}>
                                  <div style={{ flex: 1 }}><label style={{ fontSize: '0.7rem', fontWeight: 'bold' }}>CODE:</label><input value={newDiscount.code} onChange={e => setNewDiscount({...newDiscount, code: e.target.value})} placeholder="e.g. AD" style={{ width: '100%', padding: '6px', border: '1px solid #ccc', textTransform: 'uppercase' }} /></div>
                                  <div style={{ flex: 1 }}><label style={{ fontSize: '0.7rem', fontWeight: 'bold' }}>DISC %:</label><input type="number" value={newDiscount.percent} onChange={e => setNewDiscount({...newDiscount, percent: e.target.value})} placeholder="e.g. 20" style={{ width: '100%', padding: '6px', border: '1px solid #ccc' }} /></div>
                              </div>
                              <div>
                                  <label style={{ fontSize: '0.7rem', fontWeight: 'bold' }}>DESCRIPTION:</label>
                                  <input value={newDiscount.description} onChange={e => setNewDiscount({...newDiscount, description: e.target.value})} placeholder="e.g. Architect/Designer Tier" style={{ width: '100%', padding: '6px', border: '1px solid #ccc' }} />
                              </div>
                              <button onClick={handleAddDiscount} style={{ padding: '8px', background: '#17a2b8', color: '#fff', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>+ ADD DISCOUNT</button>
                          </div>

                          <div style={{ flex: 1, overflowY: 'auto', maxHeight: '300px' }}>
                              {crmDiscounts.length === 0 && <span style={{ fontSize: '0.8rem', color: '#999', fontStyle: 'italic' }}>No discount codes defined.</span>}
                              {crmDiscounts.map(d => (
                                  <div key={d.code} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8f9fa', padding: '10px', borderBottom: '1px solid #eee' }}>
                                      <div>
                                          <div style={{ fontWeight: 'bold', color: '#000', fontSize: '1rem' }}>{d.code} <span style={{ color: '#28a745' }}>(-{d.percent}%)</span></div>
                                          <div style={{ fontSize: '0.75rem', color: '#666' }}>{d.description}</div>
                                      </div>
                                      <button onClick={() => handleRemoveDiscount(d.code)} style={{ background: 'none', border: 'none', color: '#d9534f', fontSize: '1.2rem', cursor: 'pointer' }}>🗑️</button>
                                  </div>
                              ))}
                          </div>
                      </div>

                      {/* PAYMENT TERMS & SALES REPS */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                          
                          <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', boxShadow: '5px 5px 0 #6f42c1' }}>
                              <h4 style={{ margin: '0 0 15px 0', color: '#6f42c1', borderBottom: '2px solid #eee', paddingBottom: '5px' }}>🤝 PAYMENT TERMS</h4>
                              <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                                  <input value={crmListInput.paymentTerms || ''} onChange={e => setCrmListInput({...crmListInput, paymentTerms: e.target.value})} placeholder="e.g. Net 60" style={{ flex: 1, padding: '8px', border: '1px solid #ccc' }} />
                                  <button onClick={() => handleAddCrmList('paymentTerms')} style={{ padding: '8px 15px', background: '#6f42c1', color: '#fff', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>ADD</button>
                              </div>
                              <div style={{ maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                  {(globalLists.paymentTerms || []).length === 0 && <span style={{ fontSize: '0.8rem', color: '#999', fontStyle: 'italic' }}>No terms defined.</span>}
                                  {(globalLists.paymentTerms || []).map(term => (
                                      <div key={term} style={{ display: 'flex', justifyContent: 'space-between', background: '#f4f4f4', padding: '8px', border: '1px solid #eee' }}>
                                          <span style={{ fontWeight: 'bold', fontSize: '0.85rem' }}>{term}</span>
                                          <span onClick={() => handleRemoveCrmList('paymentTerms', term)} style={{ color: '#d9534f', cursor: 'pointer', fontWeight: 'bold' }}>×</span>
                                      </div>
                                  ))}
                              </div>
                          </div>

                          <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', boxShadow: '5px 5px 0 #e83e8c' }}>
                              <h4 style={{ margin: '0 0 15px 0', color: '#e83e8c', borderBottom: '2px solid #eee', paddingBottom: '5px' }}>👔 SALES REPRESENTATIVES</h4>
                              <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                                  <input value={crmListInput.salesReps || ''} onChange={e => setCrmListInput({...crmListInput, salesReps: e.target.value})} placeholder="Rep Name" style={{ flex: 1, padding: '8px', border: '1px solid #ccc' }} />
                                  <button onClick={() => handleAddCrmList('salesReps')} style={{ padding: '8px 15px', background: '#e83e8c', color: '#fff', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>ADD</button>
                              </div>
                              <div style={{ maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                  {(globalLists.salesReps || []).length === 0 && <span style={{ fontSize: '0.8rem', color: '#999', fontStyle: 'italic' }}>No sales reps defined.</span>}
                                  {(globalLists.salesReps || []).map(rep => (
                                      <div key={rep} style={{ display: 'flex', justifyContent: 'space-between', background: '#f4f4f4', padding: '8px', border: '1px solid #eee' }}>
                                          <span style={{ fontWeight: 'bold', fontSize: '0.85rem' }}>{rep}</span>
                                          <span onClick={() => handleRemoveCrmList('salesReps', rep)} style={{ color: '#d9534f', cursor: 'pointer', fontWeight: 'bold' }}>×</span>
                                      </div>
                                  ))}
                              </div>
                          </div>

                      </div>
                  </div>
              </div>
          )}

          {/* FORMS & BRANDING VIEW */}
          {activeSection === "FORMS" && (
            <div style={{ padding: '30px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000', paddingBottom: '10px', marginBottom: '20px' }}>
                <h3 style={{ margin: 0 }}>📝 DOCUMENT TEMPLATES & BRANDING</h3>
              </div>
              
              <div style={{ display: 'flex', gap: '20px' }}>
                  {/* LOGO MANAGER */}
                  <div style={{ flex: 1, background: '#f8f9fa', border: '1px solid #ccc', padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                      <h4 style={{ margin: 0, color: '#007bff' }}>1. BRAND LOGO MANAGER</h4>
                      <p style={{ fontSize: '0.8rem', color: '#666', margin: 0 }}>Upload SVG files for infinitely scalable, high-resolution document branding.</p>
                      
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                          {BRANDS_LIST.map(bKey => (
                              <div key={bKey} style={{ background: '#fff', border: '2px solid #000', padding: '15px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                  <strong style={{ textTransform: 'uppercase' }}>{bKey}</strong>
                                  <div style={{ height: '80px', background: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed #ccc' }}>
                                      {brandLogos[bKey] ? <img src={brandLogos[bKey]} alt={bKey} style={{ maxWidth: '100%', maxHeight: '100%' }} /> : <span style={{ fontSize: '0.7rem', color: '#999' }}>NO LOGO UPLOADED</span>}
                                  </div>
                                  <label style={{ background: isUploadingLogo ? '#ccc' : '#000', color: '#fff', padding: '8px', fontSize: '0.7rem', fontWeight: 'bold', cursor: isUploadingLogo ? 'wait' : 'pointer' }}>
                                      {isUploadingLogo ? 'UPLOADING...' : 'UPLOAD SVG LOGO'}
                                      <input type="file" accept=".svg,.png" style={{ display: 'none' }} onChange={(e) => handleLogoUpload(e, bKey)} disabled={isUploadingLogo} />
                                  </label>
                              </div>
                          ))}
                      </div>
                  </div>

                  {/* FORM BUILDER */}
                  <div style={{ flex: 1.5, background: '#fff', border: '2px solid #000', padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                      <h4 style={{ margin: 0, color: '#28a745' }}>2. DOCUMENT TEMPLATE CONFIGURATOR</h4>
                      <p style={{ fontSize: '0.8rem', color: '#666', margin: 0 }}>Define the standard text blocks that will appear on generated PDFs.</p>
                      
                      <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>DOCUMENT TYPE:</label>
                          <select value={activeFormType} onChange={(e) => setActiveFormType(e.target.value)} style={{ width: '100%', padding: '10px', border: '2px solid #28a745', fontWeight: 'bold' }}>
                              {DOCUMENT_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                          </select>
                      </div>

                      <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>GLOBAL HEADER NOTES:</label>
                          <textarea value={formEditor.header} onChange={e => setFormEditor({...formEditor, header: e.target.value})} placeholder="e.g. Thank you for your business!" rows={3} style={{ width: '100%', padding: '10px', border: '1px solid #ccc', boxSizing: 'border-box', fontFamily: 'sans-serif' }} />
                      </div>

                      <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>GLOBAL FOOTER NOTES:</label>
                          <textarea value={formEditor.footer} onChange={e => setFormEditor({...formEditor, footer: e.target.value})} placeholder="e.g. Please remit payment within 30 days." rows={3} style={{ width: '100%', padding: '10px', border: '1px solid #ccc', boxSizing: 'border-box', fontFamily: 'sans-serif' }} />
                      </div>

                      <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>TERMS & CONDITIONS (Fine Print):</label>
                          <textarea value={formEditor.terms} onChange={e => setFormEditor({...formEditor, terms: e.target.value})} placeholder="Standard legal terms..." rows={5} style={{ width: '100%', padding: '10px', border: '1px solid #ccc', boxSizing: 'border-box', fontSize: '0.75rem', fontFamily: 'sans-serif' }} />
                      </div>

                      <button onClick={handleSaveFormTemplate} style={{ width: '100%', padding: '15px', background: '#28a745', color: '#fff', fontWeight: 'bold', border: 'none', cursor: 'pointer', marginTop: '10px' }}>
                          💾 SAVE {activeFormType.replace('_', ' ')} TEMPLATE
                      </button>
                  </div>
              </div>
            </div>
          )}

          {/* USERS VIEW */}
          {activeSection === "USERS" && (
            <div style={{ padding: '30px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000', paddingBottom: '10px', marginBottom: '20px' }}>
                <h3 style={{ margin: 0 }}>USER DIRECTORY & ACCESS MATRIX</h3>
              </div>
              <div style={{ background: '#f8f9fa', border: '1px solid #ccc', padding: '15px', marginBottom: '20px' }}>
                <h4 style={{ margin: '0 0 10px 0', color: '#007bff' }}>1. SYSTEM ROLES</h4>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
                  {dynamicRoles.map(role => (
                    <span key={role} style={{ background: '#000', color: '#fff', padding: '5px 10px', fontSize: '0.8rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {role.toUpperCase().replace(/_/g, ' ')}
                      {role !== 'admin' && <button onClick={() => handleDeleteRole(role)} style={{ background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', padding: 0, fontWeight: 'bold' }}>✖</button>}
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <input value={newRole} onChange={e => setNewRole(e.target.value)} placeholder="New Role (e.g. Sales Rep)" style={{ padding: '8px', border: '1px solid #ccc', width: '250px' }} />
                  <button onClick={handleAddRole} style={{ padding: '8px 15px', background: '#007bff', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>+ ADD ROLE</button>
                </div>
              </div>
              <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', marginBottom: '20px', overflowX: 'auto' }}>
                <h4 style={{ margin: '0 0 10px 0' }}>2. PERMISSIONS MATRIX</h4>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', textAlign: 'center' }}>
                  <thead style={{ background: '#333', color: '#fff' }}><tr><th style={{ padding: '10px', textAlign: 'left', borderBottom: '2px solid #000' }}>TAB</th>{dynamicRoles.map(r => (<th key={r} style={{ padding: '10px', borderLeft: '1px solid #555' }}>{r.toUpperCase().replace(/_/g, ' ')}</th>))}</tr></thead>
                  <tbody>
                    {TABS.map(tab => (
                      <tr key={tab} style={{ borderBottom: '1px solid #eee' }}><td style={{ padding: '10px', textAlign: 'left', fontWeight: 'bold', borderRight: '2px solid #333' }}>{tab}</td>{dynamicRoles.map(role => (<td key={role} style={{ padding: '10px', borderLeft: '1px solid #eee' }}><input type="checkbox" checked={perms[role]?.includes(tab) || false} onChange={() => handlePermToggle(role, tab)} style={{ cursor: 'pointer', transform: 'scale(1.3)' }} /></td>))}</tr>
                    ))}
                  </tbody>
                </table>
                <button onClick={handleSavePermissions} style={{ width: '100%', padding: '10px', background: '#28a745', color: '#fff', fontWeight: 'bold', border: 'none', cursor: 'pointer', marginTop: '15px' }}>💾 SAVE MATRIX CONFIGURATION</button>
              </div>
              <div style={{ background: '#fff', border: '2px solid #000', padding: '15px' }}>
                <h4 style={{ margin: '0 0 10px 0' }}>3. USER DIRECTORY</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 2fr', gap: '10px', marginBottom: '10px' }}>
                  <input value={adminForm.uName} onChange={e => setAdminForm({...adminForm, uName: e.target.value})} placeholder="User Name" disabled={!!adminForm.oldId} style={{ padding: '8px', border: '1px solid #ccc', background: adminForm.oldId ? '#eee' : '#fff' }} />
                  <input value={adminForm.uPin} onChange={e => setAdminForm({...adminForm, uPin: e.target.value})} placeholder="4-Digit PIN" maxLength="4" style={{ padding: '8px', border: '1px solid #ccc' }} />
                  <select value={adminForm.uRole} onChange={e => setAdminForm({...adminForm, uRole: e.target.value})} style={{ padding: '8px', border: '1px solid #ccc' }}>{dynamicRoles.map(r => <option key={r} value={r}>{r.toUpperCase().replace(/_/g, ' ')}</option>)}</select>
                </div>
                <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                  <button onClick={handleSaveUser} style={{ flex: 1, padding: '10px', background: adminForm.oldId ? '#007bff' : '#000', color: '#fff', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>{adminForm.oldId ? 'UPDATE USER' : '+ ADD USER'}</button>
                  {adminForm.oldId && <button onClick={() => setAdminForm({ uName: '', uPin: '', uRole: dynamicRoles[0], oldId: '' })} style={{ padding: '10px', background: '#888', color: '#fff', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>CANCEL</button>}
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                  <thead style={{ background: '#eee' }}><tr><th style={{ padding: '10px', borderBottom: '2px solid #000' }}>NAME</th><th style={{ padding: '10px', borderBottom: '2px solid #000' }}>ROLE</th><th style={{ padding: '10px', borderBottom: '2px solid #000', textAlign: 'right' }}>ACTIONS</th></tr></thead>
                  <tbody>{users.map(u => (<tr key={u.id} style={{ borderBottom: '1px solid #eee' }}><td style={{ padding: '10px', fontWeight: 'bold' }}>{u.name}</td><td style={{ padding: '10px', color: '#666' }}>{u.role?.toUpperCase().replace(/_/g, ' ')}</td><td style={{ padding: '10px', textAlign: 'right' }}><button onClick={() => setAdminForm({ uName: u.name, uPin: u.pin || '', uRole: u.role || dynamicRoles[0], oldId: u.id })} style={{ background: '#fff', border: '1px solid #007bff', color: '#007bff', padding: '4px 8px', fontSize: '0.7rem', fontWeight: 'bold', cursor: 'pointer', marginRight: '5px' }}>EDIT</button><button onClick={() => handleDeleteUser(u)} style={{ background: '#fff0f0', border: '1px solid #ffcccc', color: '#d9534f', padding: '4px 8px', fontSize: '0.7rem', fontWeight: 'bold', cursor: 'pointer' }}>DEL</button></td></tr>))}</tbody>
                </table>
              </div>
            </div>
          )}

          {/* DANGER ZONE VIEW */}
          {activeSection === "DANGER" && (
            <div style={{ padding: '30px' }}>
              <h3 style={{ marginTop: 0, borderBottom: '2px solid #d9534f', paddingBottom: '10px', color: '#d9534f' }}>⚠️ DANGER ZONE (DATAFLASH)</h3>
              <p style={{ color: '#000', fontWeight: 'bold', background: '#ffc107', padding: '10px' }}>ACTIONS TAKEN HERE ARE PERMANENT.</p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '30px' }}>
                <div style={{ border: '2px solid #d9534f', padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div><h4 style={{ margin: '0 0 5px 0' }}>WIPE ALL JOBS, DRAFTS, & PIPELINE</h4><div style={{fontSize:'0.8rem', color:'#666'}}>Clears all Sales Orders, Work Orders, and CPQ quotes.</div></div>
                  <button onClick={handleNukeJobs} style={{ padding: '15px', background: '#d9534f', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>NUKE PIPELINE</button>
                </div>
                
                <div style={{ border: '2px solid #d9534f', padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div><h4 style={{ margin: '0 0 5px 0' }}>WIPE ALL MASTER ASSEMBLIES</h4><div style={{fontSize:'0.8rem', color:'#666'}}>Deletes all BOMs and Top-Level Configurations.</div></div>
                  <button onClick={handleNukeAssemblies} style={{ padding: '15px', background: '#d9534f', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>NUKE ASSEMBLIES</button>
                </div>
                
                <div style={{ border: '2px solid #d9534f', padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div><h4 style={{ margin: '0 0 5px 0' }}>WIPE MASTER INVENTORY LIBRARY</h4><div style={{fontSize:'0.8rem', color:'#666'}}>Deletes all raw materials, components, and hardware.</div></div>
                  <button onClick={handleNukeLibrary} style={{ padding: '15px', background: '#d9534f', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>NUKE INVENTORY</button>
                </div>
              </div>
            </div>
          )}

          {/* SUPER ADMIN VIEW (TAB 15.5) */}
          {activeSection === "SUPER_ADMIN" && isSuperAdmin && (
            <div style={{ padding: '30px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000', paddingBottom: '10px', marginBottom: '20px' }}>
                <h3 style={{ margin: 0, textTransform: 'uppercase' }}>🕵️‍♂️ Master Analytics & Surveillance</h3>
              </div>

              {/* PIN CHANGER */}
              <div style={{ background: '#000', color: '#fff', border: '2px solid #333', padding: '20px', marginBottom: '30px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                      <h4 style={{ margin: '0 0 5px 0', color: '#f39c12' }}>MASTER PIN CONTROLS</h4>
                      <p style={{ margin: 0, fontSize: '0.8rem', color: '#ccc' }}>Update your global access PIN. Your Super Admin status will automatically migrate to the new PIN.</p>
                  </div>
                  <div style={{ display: 'flex', gap: '10px' }}>
                      <input 
                          type="password" 
                          value={newMasterPin} 
                          onChange={e => setNewMasterPin(e.target.value)} 
                          placeholder="NEW 4-DIGIT PIN" 
                          maxLength="4"
                          style={{ padding: '10px', fontSize: '1.2rem', textAlign: 'center', width: '150px', fontWeight: 'bold', border: '2px solid #f39c12', background: '#333', color: '#fff' }} 
                      />
                      <button onClick={handleUpdateMasterPin} style={{ background: '#f39c12', color: '#000', padding: '10px 20px', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>UPDATE PIN</button>
                  </div>
              </div>

              {/* GLOBAL LOG SURVEILLANCE */}
              <div style={{ background: '#fff', border: '2px solid #000', padding: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                      <h4 style={{ margin: 0 }}>GLOBAL SYSTEM LOGS</h4>
                      <div style={{ display: 'flex', gap: '10px' }}>
                          <input 
                              type="text" 
                              placeholder="Filter by User..." 
                              value={logFilter.user} 
                              onChange={e => setLogFilter({...logFilter, user: e.target.value.toLowerCase()})} 
                              style={{ padding: '8px', border: '1px solid #ccc' }} 
                          />
                          <select 
                              value={logFilter.app} 
                              onChange={e => setLogFilter({...logFilter, app: e.target.value})} 
                              style={{ padding: '8px', border: '1px solid #ccc', fontWeight: 'bold' }}
                          >
                              <option value="ALL">ALL APPS</option>
                              <option value="HQ">HQ</option>
                              <option value="SHOP FLOOR">SHOP FLOOR</option>
                              <option value="FINISHING">FINISHING</option>
                          </select>
                      </div>
                  </div>

                  <div style={{ maxHeight: '500px', overflowY: 'auto', border: '1px solid #eee' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                          <thead style={{ background: '#f4f4f4', position: 'sticky', top: 0 }}>
                              <tr>
                                  <th style={{ padding: '10px', borderBottom: '2px solid #000' }}>TIMESTAMP</th>
                                  <th style={{ padding: '10px', borderBottom: '2px solid #000' }}>APP</th>
                                  <th style={{ padding: '10px', borderBottom: '2px solid #000' }}>CATEGORY / TAB</th>
                                  <th style={{ padding: '10px', borderBottom: '2px solid #000' }}>USER</th>
                                  <th style={{ padding: '10px', borderBottom: '2px solid #000' }}>ACTION</th>
                              </tr>
                          </thead>
                          <tbody>
                              {systemLogs
                                  .filter(log => logFilter.app === 'ALL' || log.app === logFilter.app)
                                  .filter(log => !logFilter.user || log.u?.toLowerCase().includes(logFilter.user))
                                  .map((log, idx) => (
                                      <tr key={idx} style={{ borderBottom: '1px solid #eee', background: idx % 2 === 0 ? '#fff' : '#fcfcfc' }}>
                                          <td style={{ padding: '10px', color: '#666' }}>{log.t?.toDate ? log.t.toDate().toLocaleString() : '-'}</td>
                                          <td style={{ padding: '10px', fontWeight: 'bold', color: log.app === 'HQ' ? '#6f42c1' : log.app === 'SHOP FLOOR' ? '#007bff' : '#CC6600' }}>{log.app}</td>
                                          <td style={{ padding: '10px' }}><span style={{ background: '#eee', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem' }}>{log.cat || log.tab || 'system'}</span></td>
                                          <td style={{ padding: '10px', fontWeight: 'bold' }}>{log.u || log.user || 'Unknown'}</td>
                                          <td style={{ padding: '10px' }}>{log.msg || log.action}</td>
                                      </tr>
                              ))}
                              {systemLogs.length === 0 && <tr><td colSpan="5" style={{ padding: '20px', textAlign: 'center', color: '#999' }}>No logs found.</td></tr>}
                          </tbody>
                      </table>
                  </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default AdminTab;