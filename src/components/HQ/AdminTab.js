import React, { useState, useEffect, useRef } from 'react';
import { db, storage } from '../../firebase';
import { collection, onSnapshot, doc, setDoc, deleteDoc, getDocs, query, where, updateDoc, orderBy, limit, writeBatch } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

// Firestore rejects `undefined` field values (only null is allowed). Recursively drop undefined
// keys so a flow/step that's missing some optional fields (e.g. an imported template) can save.
const stripUndefined = (v) => {
    if (Array.isArray(v)) return v.map(stripUndefined);
    if (v && typeof v === 'object') {
        const out = {};
        for (const k of Object.keys(v)) { if (v[k] !== undefined) out[k] = stripUndefined(v[k]); }
        return out;
    }
    return v;
};

// CONSTANTS FOR GLOBAL PERMISSIONS
const SHOP_TABS = ['floor', 'milling', 'scheduler', 'custom', 'logs', 'export', 'routings', 'programs', 'tooling', 'messaging', 'reports', 'livio', 'assets', 'admin'];
// Mirrors the Finishing app's TABS (FinishingFloor.js). 'MANAGEMENT' was retired (its user/perms
// admin moved here to HQ); 'PRODUCTION TIMES' is the finishing timers + time-matrix config tab.
const FIN_TABS = ['SETUP QUEUE', 'ACTIVE FLOOR', 'FINISH RECIPES', 'SUPPLIES', 'PRODUCTION TIMES', 'OS COMMS', 'ASSET GALLERY', 'DAILY SUMMARY'];
const PICK_TABS = ['QUEUE', 'PACKING', 'COUNT', 'CONVERT', 'TRANSFER', 'PLATING', 'GALLERY', 'MESSAGING']; // mirrors PickPackApp TABS

// NetSuite plumbing (mirror of ERPPushPullTab) for creating a flow's rollup item.
const BRAND_NETSUITE_MAP = {
    'm2c': { subsidiary: "3", location: "19" },
    'uniquity': { subsidiary: "6", location: "20" },
    'ce': { subsidiary: "2", location: "17" },
    'leyla': { subsidiary: "5", location: "18" }
};
const NS_FUNCTION_URL = "https://netsuiteproxy-f3h3jadzaq-uc.a.run.app";
const NS_REST_BASE = "https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1";
const NS_SUITEQL_URL = "https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql";
// Income account every rollup (non-inventory sale) item posts to: 4001 SALES-HOUSE, acctid 249.
const NS_ROLLUP_INCOME_ACCT = "249";
// Tax schedule for rollup items: "No Taxable", NetSuite id 2.
const NS_ROLLUP_TAX_SCHEDULE = "2";

const AdminTab = ({ currentUser, activeBrand, perms, setPerms, TABS }) => {
  const [activeSection, setActiveSection] = useState("CPQ_FLOWS"); 
  
  const [users, setUsers] = useState([]);
  
  const [dynamicRoles, setDynamicRoles] = useState(['admin', 'executive', 'design_team', 'sales_rep', 'operator', 'programmer', 'floor_manager', 'paint_manager']);
  
  // ADDED STATE FOR FLOOR PERMISSIONS
  const [shopPerms, setShopPerms] = useState({});
  const [finPerms, setFinPerms] = useState({});
  const [pickPerms, setPickPerms] = useState({}); // 🚀 ADDED WMS PERMISSIONS

  const [adminForm, setAdminForm] = useState({ uName: '', uPin: '', uRole: 'operator', oldId: '' });
  const [newRole, setNewRole] = useState('');

  const [cpqFlows, setCpqFlows] = useState([]);
  const [activeFlowId, setActiveFlowId] = useState(null);
  const [globalLists, setGlobalLists] = useState({});
  const [allApprovedDesigns, setAllApprovedDesigns] = useState([]); 
  const [linkedBomPins, setLinkedBomPins] = useState([]); 
  
  const [customDataWindows, setCustomDataWindows] = useState([]);
  
  const [globalFinishes, setGlobalFinishes] = useState([]);
  const [outsourceFinishes, setOutsourceFinishes] = useState([]);
  const [colGlobalFinishes, setColGlobalFinishes] = useState([]); // legacy hq_global_finishes collection
  const [inhouseFinishes, setInhouseFinishes] = useState([]);     // legacy hq_inhouse_finishes collection
  const [floorRecipes, setFloorRecipes] = useState([]);          // Finishing Floor source (fin_recipes), keyed by code
  const [dynamicAssets, setDynamicAssets] = useState([]);
  const [libraryParts, setLibraryParts] = useState([]);

  const [crmDiscounts, setCrmDiscounts] = useState([]);
  const [newDiscount, setNewDiscount] = useState({ code: '', description: '', percent: '' });
  const [crmListInput, setCrmListInput] = useState({ salesReps: '', paymentTerms: '' });
  const [platingFeesDoc, setPlatingFeesDoc] = useState({ rules: {} }); // system/plating_fees
  const [feeEdits, setFeeEdits] = useState({}); // local edits: { PRODUCTTYPE: { fee:string, unit:'ea'|'ft' } }
  const [newFeeType, setNewFeeType] = useState('');

  const [newStep, setNewStep] = useState({ 
      id: null, title: '', type: 'DROPDOWN', dataSource: '', required: true, 
      priceMap: {}, geometryMap: {}, targetNodes: '', allowedOptions: [],
      useClientPricing: false, priceOverride: '', partHandling: '', calculatorTemplate: '', qtyHelperText: '',
      basePrice: '', linkedItemId: '' 
  });

  const [newFlowName, setNewFlowName] = useState("");
  const [generateAsmId, setGenerateAsmId] = useState(""); // assembly the "Generate Flow from Tags" button reads
  const [flowSettings, setFlowSettings] = useState({ name: '', legacyErpId: '', basePrice: '', linkedAssemblyId: '', nsRollupItemId: '', nsRollupItemName: '', fabEndStyle: '', fabProjection: '', fabShape: '', defaultFinishOptions: [], hiddenClusters: [] });
  const [isSavingFlowSettings, setIsSavingFlowSettings] = useState(false);
  const [zoomImg, setZoomImg] = useState(null);   // {url,label} for the cluster-image lightbox
  const [isCreatingRollup, setIsCreatingRollup] = useState(false);

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

  const [systemLogs, setSystemLogs] = useState([]);
  const [logFilter, setLogFilter] = useState({ app: 'ALL', user: '' });
  const [newMasterPin, setNewMasterPin] = useState("");

  const DOCUMENT_TYPES = ['QUOTE', 'SALES_ORDER', 'WORK_ORDER', 'PACKING_SLIP', 'INVOICE', 'FACTORY_ROUTER'];
  const BRANDS_LIST = ['m2c', 'uniquity', 'ce', 'leyla']; 

  const currentActiveUser = users.find(u => u.name === currentUser);
  const isSuperAdmin = currentActiveUser?.role === "superadmin" || currentActiveUser?.superAdmin === true;

  useEffect(() => {
      const unsubUsers = onSnapshot(collection(db, "hq_users"), (snap) => setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
      const unsubRoles = onSnapshot(doc(db, "hq_config", "roles"), (docSnap) => { if (docSnap.exists() && docSnap.data().list) setDynamicRoles(docSnap.data().list); });
      const unsubSchema = onSnapshot(doc(db, "system", "master_schema"), (docSnap) => { if (docSnap.exists() && docSnap.data().inventoryFields) setCustomSchema(docSnap.data().inventoryFields); });
      const unsubRules = onSnapshot(doc(db, "system", "cpq_rules"), (docSnap) => { if (docSnap.exists() && docSnap.data().rules) setCpqRules(docSnap.data().rules); });
      const unsubFlows = onSnapshot(collection(db, "cpq_flows"), (snap) => setCpqFlows(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
      
      const unsubLists = onSnapshot(doc(db, "system", "master_lists"), (docSnap) => {
          if (docSnap.exists()) setGlobalLists(docSnap.data());
      });

      const unsubPlatingFees = onSnapshot(doc(db, "system", "plating_fees"), (docSnap) => setPlatingFeesDoc(docSnap.exists() ? docSnap.data() : { rules: {} }));

      // 🚀 LISTEN FOR FLOOR PERMISSIONS
      const unsubShopPerms = onSnapshot(doc(db, "shop_config", "permissions"), (docSnap) => { if (docSnap.exists()) setShopPerms(docSnap.data()); });
      const unsubFinPerms = onSnapshot(doc(db, "fin_config", "permissions"), (docSnap) => { if (docSnap.exists()) setFinPerms(docSnap.data()); });
      const unsubPickPerms = onSnapshot(doc(db, "pick_config", "permissions"), (docSnap) => { if (docSnap.exists()) setPickPerms(docSnap.data()); });

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
      // Finishes can also live in the legacy collections the Asset Gallery uses — read them so the
      // CPQ finish picker is a strict superset of every store (in-house + outsourced + legacy).
      const unsubColGlobal = onSnapshot(collection(db, "hq_global_finishes"), (snap) => setColGlobalFinishes(snap.docs.map(d => ({id: d.id, ...d.data()}))), () => {});
      const unsubInhouse = onSnapshot(collection(db, "hq_inhouse_finishes"), (snap) => setInhouseFinishes(snap.docs.map(d => ({id: d.id, ...d.data()}))), () => {});
      // Read-only mirror of the Finishing Floor recipes so in-house finishes (incl. ones not yet
      // synced up to system/master_finishes, e.g. new MEP codes) are selectable in CPQ flows.
      // NOTE: read only — the floor→HQ sync writer (handleSyncFloorRecipes) is untouched.
      const unsubFloor = onSnapshot(collection(db, "fin_recipes"), (snap) => setFloorRecipes(snap.docs.map(d => ({id: d.id, ...d.data()}))), () => {});

      const unsubLogos = onSnapshot(doc(db, "hq_config", "brand_logos"), (docSnap) => { if (docSnap.exists()) setBrandLogos(docSnap.data()); });
      const unsubForms = onSnapshot(doc(db, "hq_config", "form_templates"), (docSnap) => { 
          if (docSnap.exists()) {
              setFormTemplates(docSnap.data());
          }
      });

      return () => { unsubUsers(); unsubRoles(); unsubSchema(); unsubRules(); unsubFlows(); unsubLists(); unsubPlatingFees(); unsubDiscounts(); unsubAssemblies(); unsubWindowConfig(); unsubFinishes(); unsubOutsource(); unsubColGlobal(); unsubInhouse(); unsubFloor(); unsubDynamic(); unsubLogos(); unsubForms(); unsubShopPerms(); unsubFinPerms(); unsubPickPerms(); };
  }, [activeBrand]);

  useEffect(() => {
      if (formTemplates[activeFormType]) {
          setFormEditor(formTemplates[activeFormType]);
      } else {
          setFormEditor({ header: '', footer: '', terms: '' });
      }
  }, [activeFormType, formTemplates]);

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
                      ...hqSnap.docs.map(d => ({ id: d.id, app: 'HQ/WMS', ...d.data() }))
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

  // Populate the editor ONCE per flow selection. Re-running on every cpqFlows snapshot (e.g. after
  // Apply-Finishes or any save elsewhere) would overwrite the operator's unsaved edits — most
  // visibly the Master Assembly link, which then reads back as "UNLINKED" and the cluster badges
  // disappear. The ref lets a genuine flow switch re-load, but a same-flow snapshot won't clobber.
  const loadedFlowRef = useRef(null);
  useEffect(() => {
      if (!activeFlowId || cpqFlows.length === 0) return;
      if (loadedFlowRef.current === activeFlowId) return;
      const flow = cpqFlows.find(f => f.id === activeFlowId);
      if (!flow) return;
      loadedFlowRef.current = activeFlowId;
      setFlowSettings({
          name: flow.name || '',
          legacyErpId: flow.legacyErpId || '',
          basePrice: flow.basePrice || '',
          linkedAssemblyId: flow.linkedAssemblyId || '',
          nsRollupItemId: flow.nsRollupItemId || '',
          nsRollupItemName: flow.nsRollupItemName || '',
          fabEndStyle: flow.fabEndStyle || '',
          fabProjection: flow.fabProjection !== undefined && flow.fabProjection !== null ? flow.fabProjection : '',
          fabShape: flow.fabShape || '',
          defaultFinishOptions: flow.defaultFinishOptions || [],
          hiddenClusters: flow.hiddenClusters || []
      });
      setNewStep({ id: null, title: '', type: 'DROPDOWN', dataSource: '', required: true, priceMap: {}, geometryMap: {}, targetNodes: '', allowedOptions: [], useClientPricing: false, priceOverride: '', partHandling: '', calculatorTemplate: '', qtyHelperText: '', basePrice: '', linkedItemId: '' });
      setInspectedNodes([]);
  }, [activeFlowId, cpqFlows]);

  useEffect(() => {
      if (!flowSettings.linkedAssemblyId) { setLinkedBomPins([]); return; }
      const linkedAsm = allApprovedDesigns.find(a => a.id === flowSettings.linkedAssemblyId || a.itemId === flowSettings.linkedAssemblyId);
      if(!linkedAsm) return;
      
      const unsub = onSnapshot(collection(db, "assembly_pins"), (snap) => {
          const pins = snap.docs.map(d => d.data()).filter(p => p.assemblyId === linkedAsm.itemId);
          setLinkedBomPins(pins);
      });
      return () => unsub();
  }, [flowSettings.linkedAssemblyId, masterAssemblies]);


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

  // Plating fee schedule (by product type) — the plater PO/packing-list service cost in PickPack.
  const STD_PLATING_FEES = { 'BACKPLATE': { fee: 10, unit: 'ea' }, 'BRACKET': { fee: 12, unit: 'ea' }, 'FINIAL': { fee: 10, unit: 'ea' }, 'RING': { fee: 3, unit: 'ea' }, 'POLE ROUND': { fee: 20, unit: 'ft' }, 'POLE SQUARE': { fee: 25, unit: 'ft' }, 'SCREW': { fee: 1, unit: 'ea' }, 'SAMPLE CHIP': { fee: 3, unit: 'ea' } };
  const setFeeField = (type, field, value) => setFeeEdits(prev => {
      const base = prev[type] || { fee: platingFeesDoc.rules?.[type]?.fee ?? '', unit: platingFeesDoc.rules?.[type]?.unit || 'ea' };
      return { ...prev, [type]: { ...base, [field]: value } };
  });
  const handleLoadStdPlatingFees = () => setFeeEdits(prev => {
      const next = { ...prev };
      Object.entries(STD_PLATING_FEES).forEach(([t, v]) => { next[t] = { fee: String(v.fee), unit: v.unit }; });
      return next;
  });
  const handleAddFeeType = () => {
      const t = newFeeType.trim().toUpperCase();
      if (!t) return;
      setFeeEdits(prev => ({ ...prev, [t]: prev[t] || { fee: '', unit: 'ea' } }));
      setNewFeeType('');
  };
  const handleSavePlatingFees = async () => {
      const rules = { ...(platingFeesDoc.rules || {}) };
      Object.entries(feeEdits).forEach(([t, v]) => {
          const fee = parseFloat(v.fee);
          if (v.fee === '' || isNaN(fee)) delete rules[t];           // blank = remove the fee for this type
          else rules[t] = { fee, unit: v.unit || 'ea' };
      });
      await setDoc(doc(db, "system", "plating_fees"), { rules }, { merge: false });
      // Keep the master product-type dictionary aligned: a type that has a plating fee must also be
      // assignable to items in the library. Add any fee-type not already present (case-insensitive).
      const existing = globalLists.prodTypes || [];
      const existingUpper = new Set(existing.map(t => String(t).toUpperCase()));
      const toAdd = Object.keys(rules).filter(t => !existingUpper.has(t.toUpperCase()));
      if (toAdd.length) await setDoc(doc(db, "system", "master_lists"), { prodTypes: [...existing, ...toAdd] }, { merge: true });
      setFeeEdits({});
      alert(`Plating fees saved.${toAdd.length ? `\n\nAlso added to the master Product Type list (now assignable to items): ${toAdd.join(', ')}.` : ''}`);
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
      const linkedAsm = allApprovedDesigns.find(a => a.id === flowSettings.linkedAssemblyId || a.itemId === flowSettings.linkedAssemblyId);
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

  // 🚀 UNIFIED PERMISSION TOGGLES
  const handleHqPermToggle = (role, tab) => {
      const rolePerms = perms[role] || [];
      setPerms({ ...perms, [role]: rolePerms.includes(tab) ? rolePerms.filter(t => t !== tab) : [...rolePerms, tab] });
  };
  const handleShopPermToggle = (role, tab) => {
      const rolePerms = shopPerms[role] || [];
      setShopPerms({ ...shopPerms, [role]: rolePerms.includes(tab) ? rolePerms.filter(t => t !== tab) : [...rolePerms, tab] });
  };
  const handleFinPermToggle = (role, tab) => {
      const rolePerms = finPerms[role] || [];
      setFinPerms({ ...finPerms, [role]: rolePerms.includes(tab) ? rolePerms.filter(t => t !== tab) : [...rolePerms, tab] });
  };
  const handlePickPermToggle = (role, tab) => {
      const rolePerms = pickPerms[role] || [];
      setPickPerms({ ...pickPerms, [role]: rolePerms.includes(tab) ? rolePerms.filter(t => t !== tab) : [...rolePerms, tab] });
  };

  // 🚀 MASS SAVE TO ALL DATABASES
  const handleSavePermissions = async () => { 
      try {
          await setDoc(doc(db, "hq_config", "permissions"), perms); 
          await setDoc(doc(db, "shop_config", "permissions"), shopPerms);
          await setDoc(doc(db, "fin_config", "permissions"), finPerms);
          await setDoc(doc(db, "pick_config", "permissions"), pickPerms);
          alert("✅ Global Permissions Matrix Saved Successfully!"); 
      } catch (e) {
          console.error(e);
          alert("Failed to save permissions.");
      }
  };

  const handleSaveUser = async () => {
      if(!adminForm.uName || !adminForm.uPin) return alert("Name and PIN are required.");
      // Super admin is a protected, hidden status — the role dropdown can't represent it. When
      // editing an existing user, carry forward the superAdmin flag and never downgrade a super
      // admin's role through this editor (only the Super Admin → Master PIN flow changes it).
      const existing = { ...(users.find(u => u.id === adminForm.oldId || u.pin === adminForm.uPin) || {}) };
      delete existing.id; // drop the synthetic doc-id field; it isn't stored data
      const wasSuperAdmin = existing.superAdmin === true || String(existing.role || '').toLowerCase().replace(/[^a-z]/g, '') === 'superadmin';
      if (adminForm.oldId && adminForm.oldId !== adminForm.uPin) await deleteDoc(doc(db, "hq_users", adminForm.oldId));
      await setDoc(doc(db, "hq_users", adminForm.uPin), {
          ...existing,
          name: adminForm.uName,
          pin: adminForm.uPin,
          role: wasSuperAdmin ? (existing.role || 'superadmin') : adminForm.uRole,
          ...(wasSuperAdmin ? { superAdmin: true } : {}),
      });
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

  const handleExportFlow = () => {
      if (!activeFlow) return alert("Select a flow first, then Export.");
      const { id, ...rest } = activeFlow; // drop id so importing always makes a fresh flow
      const blob = new Blob([JSON.stringify(rest, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${String(activeFlow.name || 'flow').replace(/[^a-z0-9]+/gi, '-')}.json`;
      a.click(); URL.revokeObjectURL(url);
  };

  const handleImportFlow = async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
          const parsed = JSON.parse(await file.text());
          const flowId = `FLOW-${Date.now()}`;
          const { id, ...rest } = parsed;
          const name = `${String(rest.name || 'IMPORTED FLOW').toUpperCase()} (IMPORTED — REVIEW)`;
          // Creates a fresh, isolated flow for review — strip _note helper keys from steps first.
          const steps = (Array.isArray(rest.steps) ? rest.steps : []).map(s => { const { _note, ...keep } = s || {}; return keep; });
          await setDoc(doc(db, "cpq_flows", flowId), stripUndefined({ ...rest, id: flowId, brandId: activeBrand, name, steps }));
          setActiveFlowId(flowId);
          alert(`Imported "${name}". It's a fresh, isolated flow — review each step, fill any PLACEHOLDER part IDs / mesh names, then Save. Nothing goes live until you use it in a quote.`);
      } catch (err) { console.error("Flow import failed:", err); alert("Import failed — that file isn't valid flow JSON."); }
      e.target.value = '';
  };

  // One-click flow build from the assembly's Node-Grouping tags. Groups tagged clusters by
  // Category + part (unioning each part's placement nodes into one option), then stamps out the
  // standard hardware steps fully wired — no hand-picking pins. Creates a NEW flow; touches nothing.
  const handleGenerateHardwareFlow = async () => {
      const asmId = generateAsmId || flowSettings.linkedAssemblyId;
      const asm = masterAssemblies.find(a => a.id === asmId) || allApprovedDesigns.find(a => a.id === asmId || a.itemId === asmId);
      if (!asm) return alert("Pick a Master Assembly from the dropdown next to Generate, then click Generate.");
      let pins = [];
      try { const snap = await getDocs(query(collection(db, "assembly_pins"), where("assemblyId", "==", asm.itemId))); pins = snap.docs.map(d => d.data()); } catch (e) { console.warn("pin load failed", e); }
      const pinByCluster = {};
      pins.forEach(p => { if (p.clusterId) pinByCluster[p.clusterId] = p; });
      const partsById = {};
      allApprovedDesigns.forEach(p => { partsById[p.id] = p; if (p.itemId) partsById[p.itemId] = p; if (p.legacyErpId) partsById[p.legacyErpId] = p; });
      const classifyCat = (pt) => { const t = String(pt || '').toUpperCase(); if (t.includes('BACKPLATE') || t.includes('BACK PLATE')) return 'BACKPLATE'; if (t.includes('BRACKET')) return 'BRACKET'; if (t.includes('FINIAL')) return 'FINIAL'; if (t.includes('RING')) return 'RING'; if (t.includes('POLE') || t.includes('ROD')) return 'POLE'; return ''; };
      // Category from the cluster tag, falling back to the pin's part product type (so clusters
      // tagged only with Location/Position still classify).
      const catOf = (cl) => { if (cl.category) return String(cl.category).toUpperCase(); const pin = pinByCluster[cl.id]; const part = pin && partsById[pin.partId]; return classifyCat(part?.manufacturingSpecs?.productType || part?.productType); };
      const clusters = (asm.nodeClusters || []).filter(c => catOf(c));
      if (!clusters.length) return alert("No usable clusters — none have a Category tag or a classifiable part. Tag them in Node Grouping first (or set the parts' Product Type).");
      // De-union: each distinct (part, position, location) placement is its OWN option, so the
      // position splits you make in Node Grouping are never merged back together. Each option
      // carries its position + location tags so steps can be organized per position.
      const groupPlacements = (cat, filterFn) => {
          const map = {};
          clusters.filter(c => catOf(c) === cat && (!filterFn || filterFn(c))).forEach(cl => {
              const pin = pinByCluster[cl.id];
              const partId = pin?.partId || cl.name;
              const partName = pin?.partName || cl.name;
              const position = (cl.position || '').toUpperCase();
              const location = (cl.location || '').toUpperCase();
              const key = [partId, position, location].join('|');
              const e = map[key] = map[key] || { optId: `OPT-${cat}-${String(partId).replace(/[^A-Za-z0-9]/g, '').slice(0, 28)}-${position || 'X'}-${location || 'X'}`, partId, partName, position, location, nodes: new Set() };
              (cl.nodes || cl.meshes || []).forEach(n => { if (n) e.nodes.add(n); });
          });
          return Object.values(map).map(e => ({ optId: e.optId, partId: e.partId, partName: e.partName, position: e.position, location: e.location, targetNode: [...e.nodes].join(', '), price: 0 }));
      };
      const geom = (opts) => { const g = {}; opts.forEach(o => { if (o.targetNode) g[o.optId] = o.targetNode; }); return g; };

      const pole = groupPlacements('POLE');
      const finial = groupPlacements('FINIAL');
      const brackets = groupPlacements('BRACKET');
      const backplates = groupPlacements('BACKPLATE');
      const poleNodes = pole.map(o => o.targetNode).filter(Boolean).join(', ');
      const rings = groupPlacements('RING');
      const ringNodes = rings.map(o => o.targetNode).filter(Boolean).join(', ');

      // Backplates ride as a SECOND chooser on their position's bracket step, so you pick the
      // correct plate among the several at that position (not auto-merged). Any backplate whose
      // position has no bracket step falls back to its own per-position step so nothing is lost.
      const bracketPositions = new Set(brackets.map(b => b.position || ''));
      const looseBackplates = backplates.filter(bp => !bracketPositions.has(bp.position || ''));

      const ts = Date.now();
      const steps = [];
      let n = 0;
      const add = (extra) => steps.push({ id: `STEP-${ts}-${++n}`, ...extra });

      // Per-position steps: bracket + mount are ONE coherent choice driven by the cluster's own
      // tags, so picking e.g. "Left — Ceiling" simply shows that bracket — there's no separate
      // global Mount step to contradict it. A position is emitted only if it has clusters, so the
      // generated flow adapts to whatever you tagged (unknown positions fall through under their
      // own label; untagged collapse to a single base step).
      const POS_LABEL = { LEFT: 'Left', CENTER: 'Center', RIGHT: 'Right', '': '' };
      const addPerPosition = (opts, base, { clone = false, subOpts = null, subLabel = '' } = {}) => {
          const present = [...new Set(opts.map(o => o.position || ''))];
          const ordered = ['LEFT', 'CENTER', 'RIGHT', ''].filter(p => present.includes(p))
              .concat(present.filter(p => !['LEFT', 'CENTER', 'RIGHT', ''].includes(p)));
          ordered.forEach(pos => {
              const group = opts.filter(o => (o.position || '') === pos);
              if (!group.length) return;
              const label = POS_LABEL[pos] !== undefined ? POS_LABEL[pos] : pos;
              const subs = subOpts ? subOpts.filter(o => (o.position || '') === pos) : [];
              add({
                  title: label ? `${label} ${base}` : base,
                  type: 'STYLE_SWAP', partHandling: 'Custom', required: false, finishDataSource: 'master_finishes',
                  ...(clone && pos === 'CENTER' ? { isCenterClone: true, qtyHelperText: 'Number of center passing brackets' } : {}),
                  styleOptions: group, geometryMap: geom(group),
                  ...(subs.length ? { subLabel, subOptions: subs, subGeometryMap: geom(subs) } : {})
              });
          });
      };

      // End Treatment per END position (Left/Right/...), each with that end's finials plus the
      // shared miter / bend / flush fee options, so each end is finished independently. With no
      // position-tagged finials it collapses to a single End Treatment (just the fee options).
      const addEndTreatment = (opts) => {
          const present = [...new Set(opts.map(o => o.position || ''))];
          const ordered = ['LEFT', 'CENTER', 'RIGHT', ''].filter(p => present.includes(p))
              .concat(present.filter(p => !['LEFT', 'CENTER', 'RIGHT', ''].includes(p)));
          (ordered.length ? ordered : ['']).forEach(pos => {
              const group = opts.filter(o => (o.position || '') === pos);
              const label = POS_LABEL[pos] !== undefined ? POS_LABEL[pos] : pos;
              const sfx = pos || 'X';
              add({
                  title: label ? `${label} End Treatment` : 'End Treatment',
                  type: 'STYLE_SWAP', partHandling: 'Small Parts', required: false, finishDataSource: 'master_finishes',
                  styleOptions: [...group,
                      { optId: `OPT-MITER-${sfx}`, partId: '', partName: 'Mitered Return (fee — set price)', targetNode: '', price: 0 },
                      { optId: `OPT-BEND-${sfx}`, partId: '', partName: 'Bent Return (fee — set price)', targetNode: '', price: 0 },
                      { optId: `OPT-FLUSH-${sfx}`, partId: '', partName: 'Flush Cut', targetNode: '', price: 0 }],
                  geometryMap: geom(group)
              });
          });
      };

      // Step 1 = Pole/Rod MATERIAL chooser — ONLY when there's more than one material. With a single
      // material the choice is fixed, so it folds into the combined Length & Finish step below.
      if (pole.length > 1) add({ title: 'Pole / Rod Material', type: 'STYLE_SWAP', partHandling: 'Custom', hideQty: true, required: true, styleOptions: pole, geometryMap: geom(pole) });
      // Length & Finish — always present (the core pole step; carries the pole geometry). When there's a
      // single material, this IS the combined "choose length + finish" step.
      add({ title: 'Pole Length & Finish', type: 'VISUAL_DIMENSIONS', dataSource: 'master_finishes', partHandling: 'Custom', calculatorTemplate: 'calc_straight_pole', qtyHelperText: 'Pole length (feet)', required: true, geometryMap: {}, targetNodes: poleNodes });
      // Part-chooser steps are emitted only when they actually have options — 0-choice steps are skipped.
      addPerPosition(brackets, 'Bracket & Mount', { clone: true, subOpts: backplates, subLabel: 'Backplate' }); // adds nothing if brackets is empty
      if (looseBackplates.length) addPerPosition(looseBackplates, 'Backplate');
      if (finial.length) addEndTreatment(finial);
      if (rings.length) add({ title: 'Rings', type: 'DROPDOWN', dataSource: 'master_finishes', partHandling: 'Small Parts', qtyHelperText: 'Number of rings', geometryMap: {}, targetNodes: ringNodes });
      // Fee steps — always kept, as-is.
      add({ title: 'Splice', type: 'STATIC_FEE', qtyHelperText: 'Number of splices', basePrice: '0' });
      add({ title: 'Cut / Splice Fee', type: 'STATIC_FEE', qtyHelperText: 'Per cut / splice', basePrice: '0' });

      const flowId = `FLOW-${ts}`;
      try {
          await setDoc(doc(db, "cpq_flows", flowId), stripUndefined({
              id: flowId, brandId: activeBrand, name: `${String(asm.itemName || 'HARDWARE').toUpperCase()} — GENERATED`,
              legacyErpId: 'PENDING', basePrice: '0', linkedAssemblyId: asm.id,
              fabShape: 'STRAIGHT', fabEndStyle: '', fabProjection: '', defaultFinishOptions: [], hiddenClusters: [], steps
          }));
          setActiveFlowId(flowId);
          const posCount = (arr) => new Set(arr.map(o => o.position || '')).size;
          alert(`Generated "${String(asm.itemName || 'HARDWARE')} — GENERATED" from your tags:\n• Pole materials: ${pole.length}\n• Bracket+mount options: ${brackets.length} across ${posCount(brackets)} position step(s)\n• Backplates: ${backplates.length} (each position's plates are a 2nd chooser on its bracket step; ${looseBackplates.length} standalone)\n• Finials: ${finial.length} (End Treatment split per end)\n\n${pole.length <= 1 ? 'Single pole material → material + length/finish combined into ONE step. ' : ''}Steps with 0 options skipped${finial.length ? '' : ' (no End Treatment)'}${rings.length ? '' : ', no Rings'}. Bracket steps carry a Backplate chooser; fee steps (Splice, Cut/Splice) kept as-is. Review + set prices, then test. Nothing was deleted.`);
      } catch (err) { console.error("Generate failed:", err); alert("Generate failed: " + (err?.message || err)); }
  };

  const handleSaveFlowSettings = async () => {
      if (!activeFlowId) return;
      setIsSavingFlowSettings(true);
      try {
          const formattedName = flowSettings.name.toUpperCase();
          const formattedErpId = (flowSettings.legacyErpId || 'PENDING').toUpperCase();

          await setDoc(doc(db, "cpq_flows", activeFlowId), stripUndefined({ ...flowSettings, name: formattedName, legacyErpId: formattedErpId }), { merge: true });
          
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

  // Push the flow-level default finishes down onto EVERY step (most collections offer
  // the same finishes across all steps). The finish picker renders whenever a step has
  // finishDataSource set (CPQTab), so it isn't STYLE_SWAP-only:
  //  - a finish-list step (dataSource === 'master_finishes') -> scope its own options
  //    via allowedOptions
  //  - any other component step (STYLE_SWAP, part dropdown, dimensions, visual) -> add
  //    the finish sub-picker via finishDataSource + finishAllowedOptions
  // Fees (STATIC_FEE) are skipped. Operators then deselect the rare exceptions per step.
  const handleApplyFinishesToSteps = async () => {
      if (!activeFlowId || !activeFlow) return;
      const def = flowSettings.defaultFinishOptions || [];
      const steps = activeFlow.steps || [];
      const eligible = steps.filter(s => s.type !== 'STATIC_FEE');
      if (eligible.length === 0) return alert("This flow has no steps that can carry a finish (only fees).");
      if (!window.confirm(`Apply ${def.length} default finish(es) to all ${eligible.length} step(s)? This overwrites each step's current finish list.`)) return;
      const updatedSteps = steps.map(s => {
          if (s.type === 'STATIC_FEE') return s;
          if (s.dataSource === 'master_finishes') {
              // The step's own options ARE finishes — scope them directly.
              return { ...s, allowedOptions: [...def] };
          }
          // Component step — offer the finishes as a secondary picker on the selection.
          return { ...s, finishDataSource: 'master_finishes', finishAllowedOptions: [...def] };
      });
      try {
          await updateDoc(doc(db, "cpq_flows", activeFlowId), stripUndefined({ steps: updatedSteps, defaultFinishOptions: def }));
          alert(`Applied default finishes to ${eligible.length} step(s).`);
      } catch (err) {
          console.error("Error applying finishes to steps:", err);
          alert("Failed to apply finishes to steps.");
      }
  };

  // Create a 1:1 NetSuite non-inventory (sale) item for this flow, so the ERP push has a
  // dedicated rollup line to bundle all labor + fees into. Stores the returned internal
  // id on the flow doc -> ERPPushPullTab maps to it instead of the hardcoded default.
  // Look up an item's internal id by its (unique) name via SuiteQL. NetSuite returns the
  // id of a newly-created item only in a Location header the proxy doesn't forward, so we
  // resolve the id this way — which also makes create idempotent (re-clicks re-map instead
  // of erroring on NetSuite's unique-itemid rule).
  const findNsItemIdByName = async (name) => {
      const resp = await fetch(NS_FUNCTION_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
              targetUrl: NS_SUITEQL_URL,
              method: 'POST',
              payload: { q: `SELECT id FROM item WHERE itemid = '${name.replace(/'/g, "''")}'` }
          })
      });
      const data = await resp.json();
      if (resp.ok && Array.isArray(data.items) && data.items.length > 0) {
          return String(data.items[data.items.length - 1].id);
      }
      return null;
  };

  const handleCreateRollupItem = async () => {
      if (!activeFlowId) return;
      const flowName = (flowSettings.name || '').trim().toUpperCase();
      if (!flowName) return alert("Give the flow a name first — the rollup item is named to match it.");
      if (!window.confirm(`Create / map the NetSuite rollup item "${flowName}" for this flow? (Safe to re-run — it maps to the existing item if one already exists.)`)) return;

      setIsCreatingRollup(true);
      try {
          // 1. If an item with this name already exists (e.g. a prior attempt created it but
          //    we couldn't read the id), map to it instead of creating a duplicate.
          let newId = await findNsItemIdByName(flowName);

          // 2. Otherwise create it, then resolve the id by name.
          if (!newId) {
              const sub = (BRAND_NETSUITE_MAP[activeBrand] || { subsidiary: "2" }).subsidiary;
              const payload = {
                  itemid: flowName,
                  displayname: flowName,
                  subsidiary: { items: [{ id: sub }] },
                  incomeaccount: { id: NS_ROLLUP_INCOME_ACCT },
                  taxschedule: { id: NS_ROLLUP_TAX_SCHEDULE }
              };
              const response = await fetch(NS_FUNCTION_URL, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ targetUrl: `${NS_REST_BASE}/nonInventorySaleItem`, method: 'POST', payload })
              });
              const result = await response.json();
              if (!response.ok) throw new Error(`NetSuite rejected [${response.status}]: ${JSON.stringify(result)}`);

              newId = result.id || result.recordId || result.internalId ||
                  (result.links && result.links[0]?.href ? result.links[0].href.split('/').pop() : null) ||
                  await findNsItemIdByName(flowName);
          }

          if (!newId) throw new Error(`Item created but couldn't resolve its internal id. Look up "${flowName}" in NetSuite and set it manually.`);

          // Fill the flow's ERP Item ID with the item NAME/CODE (= flowName, derived from
          // the master assembly name and used as the rollup item's NetSuite itemid), so the
          // top-of-page field populates automatically and cascades to the master on Save.
          await setDoc(doc(db, "cpq_flows", activeFlowId), {
              nsRollupItemId: String(newId),
              nsRollupItemName: flowName,
              legacyErpId: flowName
          }, { merge: true });
          setFlowSettings(prev => ({ ...prev, nsRollupItemId: String(newId), nsRollupItemName: flowName, legacyErpId: flowName }));
          alert(`✅ Rollup item "${flowName}" mapped to this flow (NetSuite internal id ${newId}). The ERP Item ID has been set to "${flowName}".`);
      } catch (err) {
          console.error("Rollup item create failed:", err);
          alert(`Failed to create the NetSuite rollup item.\n\n${err.message}`);
      } finally {
          setIsCreatingRollup(false);
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
          setFlowSettings({ name: '', legacyErpId: '', basePrice: '', linkedAssemblyId: '', nsRollupItemId: '', nsRollupItemName: '', fabEndStyle: '', fabProjection: '', fabShape: '', defaultFinishOptions: [], hiddenClusters: [] });
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
                  // Default the small/custom division flag from the linked part so
                  // auto-generated flows are tagged at authoring time (WORK_ORDER_CONTRACT §7).
                  partHandling: libPart?.manufacturingSpecs?.partHandling || '',
                  calculatorTemplate: '',
                  qtyHelperText: ''
              };
          });

          const updatedSteps = [...(flow.steps || []), ...generatedSteps];
          await setDoc(doc(db, "cpq_flows", flow.id), stripUndefined({ ...flow, steps: updatedSteps }), { merge: true });
          alert(`✅ Successfully synced ${generatedSteps.length} configuration steps from the Master File Cabinet!`);
      } catch (err) {
          console.error("Auto-sync failed:", err);
          alert("Failed to auto-generate steps.");
      }
  };

  const handleAddStepToFlow = async (flow) => {
      if (!newStep.title) return alert("Step title is required");
      // Fees roll into the flow's NetSuite rollup item, so they don't map to a physical
      // part and don't need a Part Handling / Routing division.
      if (newStep.type !== 'STATIC_FEE' && !newStep.mountSelector && !newStep.partHandling) return alert("❌ ERROR: Part Handling / Routing is required for every step.");

      try {
          let updatedSteps;
          if (newStep.id) {
              updatedSteps = flow.steps.map(s => s.id === newStep.id ? newStep : s);
          } else {
              updatedSteps = [...(flow.steps || []), { ...newStep, id: `STEP-${Date.now()}` }];
          }
          await setDoc(doc(db, "cpq_flows", flow.id), stripUndefined({ ...flow, steps: updatedSteps }));
          setNewStep({ id: null, title: '', type: 'DROPDOWN', dataSource: '', required: true, priceMap: {}, geometryMap: {}, targetNodes: '', allowedOptions: [], useClientPricing: false, priceOverride: '', partHandling: '', calculatorTemplate: '', qtyHelperText: '', basePrice: '', linkedItemId: '' });
      } catch (err) { console.error("Error saving step:", err); alert("Save failed: " + (err?.message || err)); }
  };

  const handleDeleteStep = async (flow, stepId) => {
      if (!window.confirm("Delete this configuration step?")) return;
      try {
          const updatedSteps = flow.steps.filter(s => s.id !== stepId);
          await setDoc(doc(db, "cpq_flows", flow.id), stripUndefined({ ...flow, steps: updatedSteps }));
      } catch (err) { console.error("Error deleting step:", err); }
  };

  const handleMoveStep = async (flow, index, direction) => {
      const updatedSteps = [...flow.steps];
      if (direction === 'UP' && index > 0) {
          [updatedSteps[index - 1], updatedSteps[index]] = [updatedSteps[index], updatedSteps[index - 1]];
      } else if (direction === 'DOWN' && index < updatedSteps.length - 1) {
          [updatedSteps[index + 1], updatedSteps[index]] = [updatedSteps[index], updatedSteps[index + 1]];
      }
      await setDoc(doc(db, "cpq_flows", flow.id), stripUndefined({ ...flow, steps: updatedSteps }));
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
      const promptStr = window.prompt(`Type "DELETE ALL JOBS" to wipe ALL ${activeBrand.toUpperCase()} jobs across HQ, Shop Floor, Finishing & Packaging:`);
      if (promptStr !== "DELETE ALL JOBS") return;
      try {
          // A CPQ job fans out into order docs across every floor (WORK_ORDER_CONTRACT shared orderKey),
          // so an HQ-only nuke left orphans on the Shop/Finishing floors. Cascade brand-scoped through
          // the whole order lifecycle. Note the field name differs: jobs/cpq_drafts use brandId, the
          // order docs use brand. Each collection is guarded so one failure can't abort the rest.
          const targets = [
              { col: "jobs", field: "brandId" },
              { col: "cpq_drafts", field: "brandId" },
              { col: "hq_sales_orders", field: "brand" },
              { col: "hq_work_orders", field: "brand" },
              { col: "shop_custom_orders", field: "brand" },
              { col: "shop_milling", field: "brand" },
              { col: "fin_workorders", field: "brand" },
              { col: "packaging_orders", field: "brand" },
          ];
          let total = 0;
          const summary = [];
          for (const t of targets) {
              try {
                  const snap = await getDocs(query(collection(db, t.col), where(t.field, "==", activeBrand)));
                  await Promise.all(snap.docs.map(d => deleteDoc(doc(db, t.col, d.id))));
                  if (snap.docs.length) summary.push(`${t.col}: ${snap.docs.length}`);
                  total += snap.docs.length;
              } catch (e) { console.error(`Nuke ${t.col} failed:`, e); summary.push(`${t.col}: ⚠️ ${e.message}`); }
          }
          alert(`✅ Nuked ${total} ${activeBrand.toUpperCase()} job doc(s) across all floors.\n\n${summary.join("\n") || "(nothing found)"}`);
      } catch(e) { console.error(e); alert("❌ Nuke failed: " + e.message); }
  };

  // 🚀 UPDATED: Wipes Assemblies AND their BOM Pins to prevent ghosts
  const handleNukeAssemblies = async () => { 
      const promptStr = window.prompt(`Type "DELETE ALL ASSEMBLIES" to confirm wiping ${activeBrand.toUpperCase()} assemblies AND BOM pins:`); 
      if (promptStr === "DELETE ALL ASSEMBLIES") {
          try {
              // 1. Get this brand's Assemblies
              const snap = await getDocs(query(collection(db, "Approved_Designs"), where("partClass", "in", ["Assembly", "Master Assembly"]), where("brandId", "==", activeBrand)));
              const brandAsmIds = new Set(snap.docs.map(d => d.id));

              // 2. Get the BOM Pins that belong to THIS brand's assemblies only — scoping by the
              // pin's assemblyId so the nuke can't reach into other brands' pins (pins have no
              // brandId field, so we match on the assemblies we're deleting).
              const pinsSnap = await getDocs(collection(db, "assembly_pins"));
              const brandPins = pinsSnap.docs.filter(d => {
                  const aid = d.data().assemblyId;
                  return aid && brandAsmIds.has(aid);
              });

              const allDocs = [
                  ...snap.docs.map(d => doc(db, "Approved_Designs", d.id)),
                  ...brandPins.map(d => doc(db, "assembly_pins", d.id))
              ];

              // 3. Delete in batches to bypass Firebase 500 document limits
              const chunkSize = 400;
              for (let i = 0; i < allDocs.length; i += chunkSize) {
                  const chunk = allDocs.slice(i, i + chunkSize);
                  const batch = writeBatch(db);
                  chunk.forEach(docRef => batch.delete(docRef));
                  await batch.commit();
              }

              alert(`✅ ALL ${activeBrand.toUpperCase()} ASSEMBLIES AND BOM PINS NUKED.`);
          } catch(e) { 
              console.error(e); 
              alert("❌ Failed to nuke database: " + e.message);
          }
      }
  };
  
  const handleNukeFlows = async () => {
      const promptStr = window.prompt(`Type "DELETE ALL FLOWS" to confirm wiping ${activeBrand.toUpperCase()} CPQ flows:`);
      if (promptStr === "DELETE ALL FLOWS") {
          try {
              const snap = await getDocs(query(collection(db, "cpq_flows"), where("brandId", "==", activeBrand)));
              await Promise.all(snap.docs.map(d => deleteDoc(doc(db, "cpq_flows", d.id))));
              alert(`✅ ALL ${activeBrand.toUpperCase()} CPQ FLOWS NUKED (${snap.docs.length}).`);
          } catch(e) { console.error(e); alert("❌ Failed to nuke flows: " + e.message); }
      }
  };

  const handleNukeLibrary = async () => {
      const promptStr = window.prompt(`Type "DELETE MASTER LIBRARY" to confirm wiping ${activeBrand.toUpperCase()} inventory:`); 
      if (promptStr === "DELETE MASTER LIBRARY") {
          try {
              const snap = await getDocs(query(collection(db, "Approved_Designs"), where("partClass", "==", "Inventory"), where("brandId", "==", activeBrand)));
              await Promise.all(snap.docs.map(d => deleteDoc(doc(db, "Approved_Designs", d.id))));
              alert(`✅ ${activeBrand.toUpperCase()} MASTER INVENTORY NUKED.`);
          } catch(e) { console.error(e); }
      }
  };

  const handleNukeCustomers = async () => { 
      const promptStr = window.prompt(`Type "DELETE ALL CUSTOMERS" to confirm wiping ${activeBrand.toUpperCase()} customers:`); 
      if (promptStr === "DELETE ALL CUSTOMERS") {
          try {
              const snap = await getDocs(collection(db, "crm_records"));
              const toDelete = snap.docs.filter(d => {
                  const data = d.data();
                  return data.type === "CUSTOMER" && (data.brandId === activeBrand || (data.sharedBrands && data.sharedBrands.includes(activeBrand)));
              });
              
              await Promise.all(toDelete.map(d => deleteDoc(doc(db, "crm_records", d.id))));
              alert(`✅ ALL ${activeBrand.toUpperCase()} CUSTOMERS NUKED.`);
          } catch(e) { 
              console.error(e); 
              alert(`❌ FAILED: ${e.message}`);
          }
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
          // Union every finish store: in-house master doc + legacy collections + outsourced, then the
          // live Finishing Floor recipes LAST (so a synced finish keeps its real id, and an unsynced
          // floor code still shows). Dedupe by code (falls back to id) so each finish appears once.
          const floor = floorRecipes.map(r => ({ id: r.id, code: r.id, name: String(r.id || '').toUpperCase() }));
          const seen = new Set(); const out = [];
          for (const f of [...globalFinishes, ...colGlobalFinishes, ...inhouseFinishes, ...outsourceFinishes, ...floor]) {
              const id = f.id || f.code; if (!id) continue;
              const key = String(f.code || f.id).trim().toUpperCase(); if (seen.has(key)) continue;
              // Label = code + name combined when they differ (newer finishes carry the code in a
              // separate field, e.g. MEP*), else whichever field holds the recognizable value.
              const cd = f.code ? String(f.code).trim() : '';
              const nm = f.name ? String(f.name).trim() : '';
              const label = (cd && nm && cd.toUpperCase() !== nm.toUpperCase()) ? `${cd} — ${nm}` : (nm || cd || id);
              seen.add(key); out.push({ id, name: label });
          }
          return out.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
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
  const linkedAsm = allApprovedDesigns.find(a => a.id === flowSettings.linkedAssemblyId || a.itemId === flowSettings.linkedAssemblyId);

  const optionsToMap = (newStep.allowedOptions && newStep.allowedOptions.length > 0) 
      ? availableSourceItems.filter(opt => newStep.allowedOptions.includes(opt.id)) 
      : availableSourceItems;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', fontFamily: 'var(--sans)', backgroundColor: 'transparent', minHeight: '100vh' }}>
      
      <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: '4px' }}>System Administration</span>
          <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>Master Controls</h2>
        </div>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--brass)', border: '1px solid var(--brass)', padding: '4px 8px', borderRadius: '2px' }}>Role: {currentUser}</span>
      </div>

      <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
        
        <div style={{ width: '250px', background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', flexShrink: 0, borderRadius: '2px', overflow: 'hidden' }}>
          <div style={{ padding: '20px 15px', background: 'var(--paper-2)', color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '11px', letterSpacing: '.1em', textTransform: 'uppercase', borderBottom: '1px solid var(--line)' }}>Settings Menu</div>
          
          <AdminNavButton active={activeSection === "CPQ_FLOWS"} onClick={() => setActiveSection("CPQ_FLOWS")} label="CPQ Flow Builder" icon="⚙️" />
          <AdminNavButton active={activeSection === "RULES"} onClick={() => setActiveSection("RULES")} label="CPQ Logic Engine" icon="📐" />
          <AdminNavButton active={activeSection === "CRM_SETTINGS"} onClick={() => setActiveSection("CRM_SETTINGS")} label="CRM & Sales Config" icon="👥" />
          <AdminNavButton active={activeSection === "FORMS"} onClick={() => setActiveSection("FORMS")} label="Form Templates" icon="📝" />
          <AdminNavButton active={activeSection === "USERS"} onClick={() => setActiveSection("USERS")} label="User Matrix" icon="🔐" />
          <AdminNavButton active={activeSection === "PLATING_FEES"} onClick={() => setActiveSection("PLATING_FEES")} label="Plating Fees" icon="🧪" />
          
          <button onClick={() => setActiveSection("DANGER")} style={{ padding: '16px 20px', textAlign: 'left', background: activeSection === "DANGER" ? '#fdf2f2' : '#fff', color: '#d9534f', border: 'none', borderBottom: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', cursor: 'pointer', borderLeft: activeSection === "DANGER" ? '2px solid #d9534f' : '2px solid transparent', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '1.1rem' }}>⚠️</span> Danger Zone
          </button>
          
          {isSuperAdmin && (
              <button onClick={() => setActiveSection("SUPER_ADMIN")} style={{ padding: '16px 20px', textAlign: 'left', background: activeSection === "SUPER_ADMIN" ? 'var(--paper-2)' : '#fff', color: 'var(--ink)', border: 'none', fontFamily: 'var(--sans)', fontSize: '0.95rem', cursor: 'pointer', borderLeft: activeSection === "SUPER_ADMIN" ? '2px solid var(--ink)' : '2px solid transparent', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '1.1rem' }}>🕵️‍♂️</span> Super Admin
              </button>
          )}
        </div>

        <div style={{ flex: 1, background: '#fff', border: '1px solid var(--line)', minHeight: '600px', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
          
          {/* --- FLOW BUILDER --- */}
          {activeSection === "CPQ_FLOWS" && (
            <div style={{ display: 'flex', flex: 1, height: '100%' }}>
                
                <div style={{ width: '350px', borderRight: '1px solid var(--line)', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', background: 'var(--paper)' }}>
                    <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500 }}>Active CPQ Flows</h3>
                    
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <input value={newFlowName} onChange={e => setNewFlowName(e.target.value)} placeholder="e.g., CHANDELIER CONFIG" style={{ flex: 1, padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} />
                        <button onClick={handleCreateNewFlow} style={{ background: 'var(--ink)', color: '#fff', border: 'none', padding: '0 15px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase' }}>Add</button>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={handleExportFlow} title="Download the selected flow as JSON (back up / copy to another collection)" style={{ flex: 1, background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)', padding: '8px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase' }}>Export Flow</button>
                        <label title="Create a fresh flow from a JSON file (for review before use)" style={{ flex: 1, textAlign: 'center', background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)', padding: '8px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase' }}>Import Flow<input type="file" accept="application/json,.json" onChange={handleImportFlow} style={{ display: 'none' }} /></label>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <select value={generateAsmId} onChange={e => setGenerateAsmId(e.target.value)} title="Master Assembly to build the flow from" style={{ padding: '8px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.82rem', outline: 'none', background: '#fff' }}>
                            <option value="">— assembly to generate from —</option>
                            {masterAssemblies.map(a => <option key={a.id} value={a.id}>{a.itemName}{a.legacyErpId ? ` [${a.legacyErpId}]` : ''}</option>)}
                        </select>
                        <button onClick={handleGenerateHardwareFlow} title="Build a complete hardware flow automatically from the picked assembly's Node-Grouping tags — no hand-picking pins" style={{ background: 'var(--brass)', color: '#fff', border: 'none', padding: '12px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>⚙ Generate Flow from Tags</button>
                    </div>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto', flex: 1 }}>
                        {cpqFlows.filter(f => f.brandId === activeBrand).length === 0 && <div style={{color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.9rem'}}>No flows exist. Create one above!</div>}
                        {cpqFlows.filter(f => f.brandId === activeBrand).map(flow => (
                            <div key={flow.id} onClick={() => setActiveFlowId(flow.id)} style={{ padding: '16px', border: `1px solid ${activeFlowId === flow.id ? 'var(--brass)' : 'var(--line)'}`, background: activeFlowId === flow.id ? 'var(--paper-2)' : '#fff', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: '0.95rem', fontWeight: 500, color: 'var(--ink)' }}>{flow.name}</span>
                                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--brass)' }}>{flow.steps?.length || 0} Steps</span>
                                </div>
                                {flow.legacyErpId && <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>ERP ID: {flow.legacyErpId}</div>}
                            </div>
                        ))}
                    </div>

                    {orphanedAssemblies.length > 0 && (
                        <div style={{ marginTop: '20px', borderTop: '1px solid var(--line)', paddingTop: '20px' }}>
                            <h4 style={{ margin: '0 0 10px 0', fontFamily: 'var(--serif)', fontSize: '1.1rem', color: '#d9534f' }}>Pending CPQ Setup</h4>
                            <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginBottom: '15px' }}>These assemblies were flagged for CPQ routing but don't have a flow yet.</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {orphanedAssemblies.map(asm => (
                                    <button 
                                        key={asm.id}
                                        onClick={() => handleAutoCreateFlowForAssembly(asm)}
                                        style={{ padding: '12px', background: 'transparent', color: '#d9534f', border: '1px solid #d9534f', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', transition: 'all 0.2s' }}
                                        onMouseOver={e => { e.currentTarget.style.background = '#d9534f'; e.currentTarget.style.color = '#fff'; }}
                                        onMouseOut={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#d9534f'; }}
                                    >
                                        + Create Flow: {asm.itemName}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div style={{ flex: 1, padding: '30px', overflowY: 'auto' }}>
                    {!activeFlow ? (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)', fontSize: '1.2rem', height: '100%' }}>Select or create a flow to edit.</div>
                    ) : (
                        <div>
                            <div id="main-assembly-settings" style={{ background: 'var(--paper-2)', border: '1px solid var(--line)', padding: '24px', marginBottom: '30px', borderRadius: '2px', scrollMarginTop: '20px' }}>
                                <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: '15px', marginBottom: '20px' }}>
                                    <h4 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500 }}>File Cabinet Link (Master Assembly)</h4>
                                </div>
                                
                                <div style={{ marginBottom: '20px' }}>
                                    <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Link to Master Assembly</label>
                                    <select 
                                        value={flowSettings.linkedAssemblyId || ""} 
                                        onChange={(e) => {
                                            const asm = masterAssemblies.find(a => a.id === e.target.value);
                                            const patch = {
                                                linkedAssemblyId: e.target.value,
                                                legacyErpId: asm?.legacyErpId || '',
                                                name: asm?.itemName || flowSettings.name,
                                                basePrice: asm?.manufacturingSpecs?.basePrice || flowSettings.basePrice
                                            };
                                            setFlowSettings({ ...flowSettings, ...patch });
                                            // Persist the link immediately so it survives a reload (not just until the next Save).
                                            if (activeFlowId) updateDoc(doc(db, "cpq_flows", activeFlowId), stripUndefined(patch)).catch(err => console.error("Link save failed:", err));
                                        }}
                                        style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', background: '#fff' }}
                                    >
                                        <option value="">-- UNLINKED (STANDALONE FLOW) --</option>
                                        {masterAssemblies.map(a => <option key={a.id} value={a.id}>{a.itemName} {a.legacyErpId && `[${a.legacyErpId}]`}</option>)}
                                    </select>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '15px' }}>
                                    <div>
                                        <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>CPQ Flow Name</label>
                                        <input value={flowSettings.name} onChange={e => setFlowSettings({...flowSettings, name: e.target.value})} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} />
                                    </div>
                                    <div>
                                        <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>ERP Item ID</label>
                                        <input value={flowSettings.legacyErpId} onChange={e => setFlowSettings({...flowSettings, legacyErpId: e.target.value})} placeholder="e.g. ASM-1234" style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} />
                                    </div>
                                    <div>
                                        <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Base Price ($)</label>
                                        <input type="number" step="0.01" value={flowSettings.basePrice} onChange={e => setFlowSettings({...flowSettings, basePrice: e.target.value})} placeholder="0.00" style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} />
                                    </div>
                                </div>
                                
                                <div style={{ marginTop: '20px', padding: '16px 20px', background: 'var(--paper)', border: '1px solid var(--line)' }}>
                                    <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '6px' }}>Fabrication Preset (drives the Vision Hardware tool)</label>
                                    <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', display: 'block', marginBottom: '12px' }}>This flow is 1:1 with a bay configuration + end style + bracket projection — set it here and Vision auto-applies it. CPQ item/finish picks never change fabrication.</span>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                                        <div>
                                            <label style={{ fontSize: '0.8rem', color: 'var(--ink)', display: 'block', marginBottom: '6px' }}>Bay Configuration</label>
                                            <select value={flowSettings.fabShape || ''} onChange={e => setFlowSettings({...flowSettings, fabShape: e.target.value})} style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }}>
                                                <option value="">-- None (auto) --</option>
                                                <option value="STRAIGHT">Straight Pole</option>
                                                <option value="MITERED">Mitered Bay</option>
                                                <option value="BOW">Curved Bay</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label style={{ fontSize: '0.8rem', color: 'var(--ink)', display: 'block', marginBottom: '6px' }}>End Style</label>
                                            <select value={flowSettings.fabEndStyle || ''} onChange={e => setFlowSettings({...flowSettings, fabEndStyle: e.target.value})} style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }}>
                                                <option value="">-- None (auto-detect) --</option>
                                                <option value="FLUSH">Flush Cut (Inside Mount)</option>
                                                <option value="RETURN_BEND">Bent Return (FR)</option>
                                                <option value="RETURN_MITER">Mitered Return</option>
                                                <option value="FINIAL">Finial</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label style={{ fontSize: '0.8rem', color: 'var(--ink)', display: 'block', marginBottom: '6px' }}>Bracket Projection (")</label>
                                            <input type="number" step="0.125" value={flowSettings.fabProjection} onChange={e => setFlowSettings({...flowSettings, fabProjection: e.target.value})} placeholder="e.g. 3.5" style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} />
                                        </div>
                                    </div>
                                </div>

                                <div style={{ marginTop: '20px', padding: '16px 20px', background: 'var(--paper)', border: '1px solid var(--line)' }}>
                                    <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '6px' }}>Default Finishes (cascade to every step)</label>
                                    <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', display: 'block', marginBottom: '12px' }}>Pick the finishes this collection offers. "Apply to all steps" seeds every Choose/Swap step with these — then deselect the rare exceptions on individual steps. Leave empty to allow every finish.</span>
                                    <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 16px', background: '#fff', border: '1px solid var(--line)', padding: '12px' }}>
                                        {getDataSourceItems('master_finishes').map(f => {
                                            const checked = (flowSettings.defaultFinishOptions || []).includes(f.id);
                                            return (
                                                <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '3px 0', fontSize: '0.85rem', color: 'var(--ink)', cursor: 'pointer' }}>
                                                    <input type="checkbox" checked={checked} onChange={(e) => {
                                                        const set = new Set(flowSettings.defaultFinishOptions || []);
                                                        if (e.target.checked) set.add(f.id); else set.delete(f.id);
                                                        setFlowSettings({ ...flowSettings, defaultFinishOptions: [...set] });
                                                    }} />
                                                    {f.name}
                                                </label>
                                            );
                                        })}
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
                                        <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>{(flowSettings.defaultFinishOptions || []).length} finish(es) selected</span>
                                        <button onClick={handleApplyFinishesToSteps} style={{ padding: '10px 18px', background: 'var(--brass)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Apply to all steps ↓</button>
                                    </div>
                                </div>

                                {linkedAsm?.nodeClusters?.length > 0 && (
                                <div style={{ marginTop: '20px', padding: '16px 20px', background: 'var(--paper)', border: '1px solid var(--line)' }}>
                                    <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '6px' }}>Hide Geometry (other configs)</label>
                                    <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', display: 'block', marginBottom: '12px' }}>When one CAD file holds several configs (e.g. wall / ceiling / end brackets), hide the regions this flow should NOT show. Clusters are grouped by the Location/Position tags set in Node Grouping — toggle a whole region header in one click (e.g. hide all "CEILING · LEFT").</span>
                                    <div style={{ maxHeight: '300px', overflowY: 'auto', background: '#fff', border: '1px solid var(--line)', padding: '12px' }}>
                                        {(() => {
                                            const clusters = linkedAsm.nodeClusters;
                                            const hidden = new Set(flowSettings.hiddenClusters || []);
                                            const groups = {};
                                            clusters.forEach(cl => {
                                                const key = (cl.location || cl.position) ? `${cl.location || ''}|${cl.position || ''}` : '__UNGROUPED__';
                                                (groups[key] = groups[key] || { location: cl.location || '', position: cl.position || '', clusters: [] }).clusters.push(cl);
                                            });
                                            const POS = { LEFT: 0, CENTER: 1, RIGHT: 2 };
                                            const entries = Object.entries(groups).sort(([ka, a], [kb, b]) => {
                                                if (ka === '__UNGROUPED__') return 1;
                                                if (kb === '__UNGROUPED__') return -1;
                                                return (a.location || '').localeCompare(b.location || '') || ((POS[a.position] ?? 9) - (POS[b.position] ?? 9)) || (a.position || '').localeCompare(b.position || '');
                                            });
                                            const toggleRegion = (ids, allHidden) => {
                                                const set = new Set(hidden);
                                                ids.forEach(id => allHidden ? set.delete(id) : set.add(id));
                                                setFlowSettings({ ...flowSettings, hiddenClusters: [...set] });
                                            };
                                            const toggleOne = (id, on) => {
                                                const set = new Set(flowSettings.hiddenClusters || []);
                                                if (on) set.add(id); else set.delete(id);
                                                setFlowSettings({ ...flowSettings, hiddenClusters: [...set] });
                                            };
                                            return entries.map(([key, g]) => {
                                                const ids = g.clusters.map(c => c.id);
                                                const allHidden = ids.every(id => hidden.has(id));
                                                const someHidden = ids.some(id => hidden.has(id));
                                                const label = key === '__UNGROUPED__' ? 'UNGROUPED' : [g.location, g.position].filter(Boolean).join(' · ');
                                                return (
                                                    <div key={key} style={{ marginBottom: '10px' }}>
                                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', background: 'var(--paper-2)', borderLeft: `2px solid ${allHidden ? 'var(--ink-soft)' : 'var(--brass)'}`, cursor: key === '__UNGROUPED__' ? 'default' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink)' }}>
                                                            {key !== '__UNGROUPED__' && <input type="checkbox" checked={allHidden} ref={el => { if (el) el.indeterminate = !allHidden && someHidden; }} onChange={() => toggleRegion(ids, allHidden)} style={{ width: '15px', height: '15px', accentColor: 'var(--brass)', cursor: 'pointer' }} />}
                                                            <span style={{ fontWeight: 600 }}>{label}</span>
                                                            <span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}>· {g.clusters.length}{allHidden ? ' · hidden' : ''}</span>
                                                        </label>
                                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 16px', padding: '6px 0 0 14px' }}>
                                                            {g.clusters.map(cl => {
                                                                const checked = hidden.has(cl.id);
                                                                return (
                                                                    <label key={cl.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '3px 0', fontSize: '0.82rem', color: 'var(--ink)', cursor: 'pointer', opacity: checked ? 0.5 : 1 }}>
                                                                        <input type="checkbox" checked={checked} onChange={(e) => toggleOne(cl.id, e.target.checked)} />
                                                                        {cl.imageUrl
                                                                            ? <img src={cl.imageUrl} alt="" onClick={(e) => { e.preventDefault(); setZoomImg({ url: cl.imageUrl, label: cl.name }); }} title="Click to enlarge" style={{ width: '26px', height: '26px', objectFit: 'contain', background: 'var(--paper)', border: '1px solid var(--line)', flexShrink: 0, cursor: 'zoom-in' }} />
                                                                            : <span style={{ width: '26px', height: '26px', flexShrink: 0, border: '1px dashed var(--line)' }} />}
                                                                        <span style={{ textDecoration: checked ? 'line-through' : 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cl.name}</span>
                                                                    </label>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                );
                                            });
                                        })()}
                                    </div>
                                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', display: 'block', marginTop: '10px' }}>{(flowSettings.hiddenClusters || []).length} cluster(s) hidden in this flow · Save and Cascade to apply</span>
                                </div>
                                )}

                                <div style={{ marginTop: '20px', padding: '16px 20px', background: flowSettings.nsRollupItemId ? 'var(--paper)' : '#fff7ed', border: `1px solid ${flowSettings.nsRollupItemId ? 'var(--line)' : 'var(--brass)'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }}>
                                    <div>
                                        <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '4px' }}>NetSuite Rollup Item (labor + fees bundle)</label>
                                        {flowSettings.nsRollupItemId ? (
                                            <span style={{ fontFamily: 'var(--sans)', fontSize: '0.95rem', color: 'var(--ink)' }}>
                                                <strong>{flowSettings.nsRollupItemName || 'Mapped'}</strong> · internal id <span style={{ fontFamily: 'var(--mono)' }}>{flowSettings.nsRollupItemId}</span> ✓
                                            </span>
                                        ) : (
                                            <span style={{ fontFamily: 'var(--sans)', fontSize: '0.9rem', color: 'var(--ink-soft)' }}>No rollup item yet — the ERP push will fall back to the shared default (61502). Create a 1:1 item so pricing maps cleanly.</span>
                                        )}
                                    </div>
                                    <button onClick={handleCreateRollupItem} disabled={isCreatingRollup} style={{ flexShrink: 0, padding: '12px 18px', background: flowSettings.nsRollupItemId ? 'transparent' : 'var(--brass)', color: flowSettings.nsRollupItemId ? 'var(--ink)' : '#fff', border: flowSettings.nsRollupItemId ? '1px solid var(--line)' : 'none', cursor: isCreatingRollup ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' }}>
                                        {isCreatingRollup ? 'Creating…' : (flowSettings.nsRollupItemId ? 'Re-create Item' : 'Create Rollup Item in NetSuite')}
                                    </button>
                                </div>

                                <div style={{ display: 'flex', gap: '15px', marginTop: '24px' }}>
                                    <button onClick={handleSaveFlowSettings} style={{ flex: 2, padding: '12px 24px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                                        {isSavingFlowSettings ? "Syncing..." : "Save and Cascade to Master"}
                                    </button>
                                    <button onClick={handleDeleteFlow} style={{ flex: 1, padding: '12px 24px', background: 'transparent', color: '#d9534f', border: '1px solid #d9534f', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }} onMouseOver={e => { e.currentTarget.style.background = '#d9534f'; e.currentTarget.style.color = '#fff'; }} onMouseOut={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#d9534f'; }}>
                                        Delete Flow
                                    </button>
                                </div>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 20px 0', borderBottom: '1px solid var(--line)', paddingBottom: '15px' }}>
                                <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500 }}>Configure Steps</h3>
                                <button onClick={() => document.getElementById('main-assembly-settings')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} style={{ padding: '10px 16px', background: '#fff', color: 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.05em', whiteSpace: 'nowrap' }}>↑ Main Assembly Settings</button>
                            </div>
                            
                            {flowSettings.linkedAssemblyId && (
                                <div style={{ background: 'var(--paper)', border: '1px solid var(--brass)', padding: '20px', marginBottom: '30px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <h4 style={{ margin: '0 0 8px 0', fontFamily: 'var(--serif)', fontSize: '1.2rem', color: 'var(--brass)' }}>Auto-Sync Available</h4>
                                        <span style={{ fontSize: '0.9rem', color: 'var(--ink-soft)' }}>Detected <strong>{linkedBomPins.length} Sub-Assemblies/Components</strong> in the Master File Cabinet.</span>
                                    </div>
                                    <button onClick={() => handleAutoSyncBOM(activeFlow)} style={{ padding: '12px 24px', background: 'var(--brass)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                                        Auto-Generate Steps
                                    </button>
                                </div>
                            )}

                            {/* MANUAL STEP BUILDER */}
                            <div style={{ background: newStep.id ? 'var(--paper-2)' : '#fff', padding: '24px', border: newStep.id ? '1px solid var(--brass)' : '1px solid var(--line)', marginBottom: '30px', borderRadius: '2px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 20px 0' }}>
                                    <h4 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: newStep.id ? 'var(--brass)' : 'var(--ink)' }}>
                                        {newStep.id ? "Edit Step" : "Manual Step Builder"}
                                    </h4>
                                    {newStep.id && (
                                        <button onClick={() => document.getElementById('main-assembly-settings')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} style={{ padding: '8px 14px', background: '#fff', color: 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.05em', whiteSpace: 'nowrap' }}>↑ Main Assembly Settings</button>
                                    )}
                                </div>
                                
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                    <input value={newStep.title} onChange={e => setNewStep({...newStep, title: e.target.value})} placeholder="Step Title (e.g. Select Bracket Style)" style={{ padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} />
                                    
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                                        <select value={newStep.type} onChange={e => setNewStep({...newStep, type: e.target.value, dataSource: e.target.value === 'STATIC_FEE' ? '' : newStep.dataSource})} style={{ padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }}>
                                            <option value="DROPDOWN">Dropdown List</option>
                                            <option value="STYLE_SWAP">Choose / Swap Style</option>
                                            <option value="VISUAL_GRID">Visual Grid (Images/Textures)</option>
                                            <option value="VISUAL_DIMENSIONS">Visual Grid + Dimensions</option>
                                            <option value="DIMENSIONS">Dimensional Input Only</option>
                                            <option value="STATIC_FEE">Static Fee / Quantity</option>
                                        </select>
                                        
                                        <select value={newStep.dataSource} onChange={e => setNewStep({...newStep, dataSource: e.target.value, allowedOptions: []})} disabled={newStep.type === 'DIMENSIONS' || newStep.type === 'STATIC_FEE' || newStep.type === 'STYLE_SWAP'} style={{ padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', opacity: (newStep.type === 'DIMENSIONS' || newStep.type === 'STATIC_FEE' || newStep.type === 'STYLE_SWAP') ? 0.5 : 1 }}>
                                            <option value="">-- SELECT DATA SOURCE --</option>
                                            <optgroup label="Core Libraries">
                                                <option value="master_finishes">Master Finishes</option>
                                            </optgroup>
                                            <optgroup label="Master Library: Product Types">
                                                {(globalLists.prodTypes || []).map(pt => <option key={pt} value={pt}>Type: {pt}</option>)}
                                            </optgroup>
                                            <optgroup label="Master Library: Routing Types">
                                                {(globalLists.inventoryTypes || []).map(it => <option key={it} value={it}>Routing: {it} (Inv)</option>)}
                                                {(globalLists.assemblyTypes || []).map(at => <option key={at} value={at}>Routing: {at} (Asm)</option>)}
                                            </optgroup>
                                            {customDataWindows.length > 0 && (
                                                <optgroup label="CPQ Asset Dictionaries">
                                                    {customDataWindows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                                                </optgroup>
                                            )}
                                            <optgroup label="Simple Lists">
                                                <option value="uom">UOMs</option>
                                                <option value="pillowSizes">Pillow Sizes</option>
                                                <option value="fillTypes">Fill Types</option>
                                                <option value="flangeStyles">Edge Styles</option>
                                                <option value="stitchTypes">Stitch Routing</option>
                                                <option value="seamCounts">Seam Counts</option>
                                            </optgroup>
                                        </select>
                                    </div>

                                    {(newStep.type === 'VISUAL_DIMENSIONS' || newStep.type === 'DIMENSIONS' || newStep.calculatorTemplate) && (
                                        <div style={{ background: 'var(--paper-2)', padding: '15px', border: '1px solid var(--line)' }}>
                                            <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Calculator Template</label>
                                            <select value={newStep.calculatorTemplate || ''} onChange={e => setNewStep({...newStep, calculatorTemplate: e.target.value})} style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }}>
                                                <option value="">-- No Calculator --</option>
                                                <option value="calc_french_return_1in">1" French Return (+17" cut, C2C -1", Qty = Feet)</option>
                                                <option value="calc_mitered_bay">Mitered Bay (Wall A/B/C + Angles, Qty = Feet)</option>
                                                <option value="calc_curved_bay">Curved Bay (Arc / Radius, Qty = Feet)</option>
                                                <option value="calc_straight_pole">Straight Pole (Qty = Feet)</option>
                                            </select>
                                        </div>
                                    )}

                                    <div style={{ background: '#fff', padding: '15px', border: '1px solid var(--line)' }}>
                                        <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Helper Text</label>
                                        <input 
                                            value={newStep.qtyHelperText || ''} 
                                            onChange={e => setNewStep({...newStep, qtyHelperText: e.target.value})} 
                                            placeholder="e.g. Enter 4 rings per foot."
                                            style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }}
                                        />
                                    </div>

                                    {newStep.type === 'STYLE_SWAP' && (
                                    <div style={{ background: '#fff', padding: '15px', border: '1px solid var(--line)' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                            <input type="checkbox" checked={!!newStep.isCenterClone} onChange={e => setNewStep({...newStep, isCenterClone: e.target.checked})} />
                                            <span style={{ fontSize: '0.85rem', color: 'var(--ink)' }}>Clone along pole (center passing bracket)</span>
                                        </label>
                                        <span style={{ fontSize: '0.72rem', color: 'var(--ink-soft)', display: 'block', marginTop: '6px' }}>The selected bracket is cloned by this step's quantity and spaced evenly down the pole in the live rendering. Only one center bracket needs to exist in the .glb (at the middle of the pole).</span>
                                    </div>
                                    )}

                                    <div style={{ background: '#fff', padding: '15px', border: '1px solid var(--line)' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                            <input type="checkbox" checked={!!newStep.mountSelector} onChange={e => setNewStep({...newStep, mountSelector: e.target.checked})} />
                                            <span style={{ fontSize: '0.85rem', color: 'var(--ink)' }}>Tag-driven Mount selector</span>
                                        </label>
                                        <span style={{ fontSize: '0.72rem', color: 'var(--ink-soft)', display: 'block', marginTop: '6px' }}>Options come from the assembly's Location tags (Wall / Ceiling / Inside). Picking one hides every end cluster of the OTHER locations — no geometryMap or data source needed. Use a DROPDOWN step.</span>
                                        {newStep.mountSelector && (
                                            <div style={{ marginTop: '10px' }}>
                                                <label style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '6px' }}>Applies to position</label>
                                                <select value={newStep.mountPosition || ''} onChange={e => setNewStep({...newStep, mountPosition: e.target.value})} style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }}>
                                                    <option value="">All positions (whole mount)</option>
                                                    <option value="LEFT">Left only</option>
                                                    <option value="RIGHT">Right only</option>
                                                </select>
                                            </div>
                                        )}
                                    </div>

                                    {newStep.type !== 'STYLE_SWAP' && (
                                    <div style={{ background: '#fff', padding: '20px', border: '1px solid var(--line)' }}>
                                        <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '15px' }}>Item Mapping & Base Price</label>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                            <div>
                                                 <label style={{ fontSize: '0.85rem', color: 'var(--ink)', display: 'block', marginBottom: '6px' }}>Link to Library Item</label>
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
                                                 }} style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }}>
                                                     <option value="">-- No Item Linked --</option>
                                                     {allApprovedDesigns.filter(p => p.partClass === 'Inventory' || p.partClass === 'Assembly').map(p => <option key={p.id} value={p.id}>{p.itemName}</option>)}
                                                 </select>
                                            </div>
                                            <div>
                                                <label style={{ fontSize: '0.85rem', color: 'var(--ink)', display: 'block', marginBottom: '6px' }}>Step Base Price ($)</label>
                                                <div style={{ display: 'flex', gap: '8px' }}>
                                                    <input 
                                                        type="number" 
                                                        step="0.01" 
                                                        value={newStep.basePrice !== undefined && newStep.basePrice !== null && newStep.basePrice !== '' ? newStep.basePrice : ''} 
                                                        onChange={e => setNewStep({...newStep, basePrice: e.target.value})} 
                                                        placeholder="0.00" 
                                                        style={{ flex: 1, padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} 
                                                    />
                                                    <button 
                                                        onClick={() => {
                                                            const selectedId = newStep.linkedItemId || newStep.linkedPinId;
                                                            if (!selectedId) return alert("Please link a library item first.");
                                                            const part = allApprovedDesigns.find(p => p.id === selectedId || p.itemId === selectedId || p.legacyErpId === selectedId);
                                                            if (part) {
                                                                const bp = parseFloat(part.manufacturingSpecs?.basePrice) || parseFloat(part.basePrice) || 0;
                                                                setNewStep(prev => ({...prev, basePrice: bp}));
                                                            }
                                                        }}
                                                        style={{ padding: '0 15px', background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase' }}>
                                                        Fetch
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    )}

                                    {newStep.dataSource && availableSourceItems.length > 0 && newStep.type !== 'DIMENSIONS' && newStep.type !== 'STATIC_FEE' && (
                                        <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '20px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                                                <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Restrict Options</span>
                                                <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>{newStep.allowedOptions?.length || 0} Restricted</span>
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', maxHeight: '200px', overflowY: 'auto', background: 'var(--paper)', padding: '15px', border: '1px solid var(--line)' }}>
                                                {availableSourceItems.map(item => (
                                                    <label key={item.id} style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--ink)' }}>
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
                                    
                                    {newStep.type !== 'STYLE_SWAP' && (
                                    <div style={{ background: 'var(--paper)', padding: '20px', border: '1px solid var(--line)' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                                            <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Target 3D Mesh / Node</label>
                                            <button 
                                                onClick={handleInspectNodes} 
                                                disabled={isInspecting}
                                                style={{ padding: '6px 12px', background: '#fff', color: 'var(--ink)', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', cursor: isInspecting ? 'wait' : 'pointer' }}
                                            >
                                                {isInspecting ? 'Scanning...' : 'Inspect 3D Nodes'}
                                            </button>
                                        </div>

                                        {linkedAsm?.nodeClusters?.length > 0 && (
                                            <div style={{ marginBottom: '15px', background: '#fff', border: '1px solid var(--line)', padding: '15px' }}>
                                                <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: '10px' }}>Saved Sub-Assemblies</div>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                                    {linkedAsm.nodeClusters.map(cluster => {
                                                        const clusterNodes = cluster.nodes || cluster.meshes || [];
                                                        return (
                                                            <span 
                                                                key={cluster.id} 
                                                                onClick={() => setNewStep(prev => ({...prev, targetNodes: prev.targetNodes ? `${prev.targetNodes}, ${clusterNodes.join(', ')}` : clusterNodes.join(', ')}))} 
                                                                style={{ background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)', padding: '6px 12px', fontSize: '0.8rem', cursor: 'pointer', borderRadius: '2px' }}
                                                            >
                                                                {cluster.name}
                                                            </span>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                        
                                        {inspectedNodes.length > 0 && (
                                            <div style={{ marginBottom: '15px', background: '#fff', border: '1px solid var(--line)', padding: '15px', maxHeight: '150px', overflowY: 'auto' }}>
                                                <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: '10px' }}>Available Meshes</div>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                                    {inspectedNodes.map((node, i) => (
                                                        <span key={i} onClick={() => setNewStep(prev => ({...prev, targetNodes: prev.targetNodes ? `${prev.targetNodes}, ${node}` : node}))} style={{ background: 'var(--paper-2)', padding: '4px 8px', fontSize: '0.8rem', cursor: 'pointer', border: '1px solid var(--line)' }}>
                                                            {node}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        <input value={newStep.targetNodes || ''} onChange={e => setNewStep({...newStep, targetNodes: e.target.value})} placeholder="e.g., Pole_Top, Bracket_Base" style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} />
                                    </div>
                                    )}

                                    {newStep.type === 'STYLE_SWAP' && (
                                        <div style={{ background: '#fff', padding: '20px', border: '1px solid var(--line)', marginTop: '10px' }}>
                                            <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '6px' }}>Style Options — choose which BOM items can be swapped</label>
                                            <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', display: 'block', marginBottom: '12px' }}>Items and their 3D mesh nodes come from this assembly's BOM (set in Node Cluster / BOM Engine). Not listed? Add it to the BOM first.</span>

                                            {(newStep.styleOptions || []).length > 0 && (
                                                <div style={{ marginBottom: '16px', padding: '12px 16px', background: 'var(--paper)', border: '1px solid var(--brass)' }}>
                                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '8px' }}>Configured Options ({(newStep.styleOptions || []).length}) — what the customer chooses between on this step</div>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                        {(newStep.styleOptions || []).map(o => {
                                                            const okey = o.optId || o.partId;
                                                            const part = allApprovedDesigns.find(d => d.id === o.partId || d.itemId === o.partId);
                                                            const img = part?.componentImageUrl || part?.finalImageUrl;
                                                            return (
                                                                <div key={okey} style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#fff', border: '1px solid var(--line)', padding: '6px 8px' }}>
                                                                    {img
                                                                        ? <img src={img} alt="" onClick={() => setZoomImg({ url: img, label: o.partName || okey })} title="Click to enlarge" style={{ width: '34px', height: '34px', objectFit: 'contain', background: 'var(--paper)', cursor: 'zoom-in', flexShrink: 0 }} />
                                                                        : <span style={{ width: '34px', height: '34px', flexShrink: 0, border: '1px dashed var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '7px', color: 'var(--ink-soft)' }}>no img</span>}
                                                                    <span style={{ flex: 1, fontSize: '0.9rem', color: 'var(--ink)' }}>{o.partName || okey}</span>
                                                                    <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)' }}>{(o.price !== undefined && o.price !== '' && o.price !== null) ? `$${o.price}` : ''}</span>
                                                                    <button onClick={() => setNewStep(prev => { const opts = (prev.styleOptions || []).filter(x => (x.optId || x.partId) !== okey); const geometryMap = {}; opts.forEach(x => { geometryMap[x.optId || x.partId] = x.targetNode; }); return { ...prev, styleOptions: opts, geometryMap }; })} title="Remove this option" style={{ background: 'transparent', border: 'none', color: '#d9534f', fontSize: '1.1rem', lineHeight: 1, cursor: 'pointer', padding: '0 6px' }}>×</button>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                    <div style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', marginTop: '8px', fontStyle: 'italic' }}>Add more by checking BOM components below. Custom options not in the BOM (e.g. Wood / Metal rod, which have no library part yet) live here and aren't shown as checkboxes.</div>
                                                </div>
                                            )}

                                            {!flowSettings.linkedAssemblyId ? (
                                                <div style={{ fontSize: '0.9rem', color: '#d9534f', fontStyle: 'italic' }}>Link a Master Assembly to this flow first (in the settings above).</div>
                                            ) : linkedBomPins.length === 0 ? (
                                                <div style={{ fontSize: '0.9rem', color: '#d9534f', fontStyle: 'italic' }}>No BOM components found for this assembly. Add them in Node Cluster / BOM Engine.</div>
                                            ) : (
                                                <div>
                                                    {linkedBomPins.map((pin, pinIdx) => {
                                                        // A part can repeat at several positions (Left/Center/Right). Each pin is
                                                        // its own instance; identify options by a SHORT, safe id (clusterId / matched
                                                        // cluster id) — NEVER the raw mesh list (its commas/periods make a bad,
                                                        // oversized Firestore map key) and not partId (which collapses repeats). optId
                                                        // is set below, after the cluster is resolved.
                                                        // Resolve the pin's cluster by id OR by mesh overlap (many pins predate clusterId),
                                                        // so the Location/Position tags surface regardless of how the pin was bound.
                                                        const _norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
                                                        const _pinMeshes = String(pin.targetNode || '').split(',').map(_norm).filter(Boolean);
                                                        const _matches = (linkedAsm?.nodeClusters || []).filter(c => (pin.clusterId && c.id === pin.clusterId) || (c.nodes || c.meshes || []).some(n => _pinMeshes.includes(_norm(n))));
                                                        const cluster = _matches.find(c => c.location || c.position) || _matches[0]; // prefer a tagged match over an untagged duplicate
                                                        const posLabel = [cluster?.location, cluster?.position].filter(Boolean).join(' · ');
                                                        const locLabel = posLabel || (cluster?.name || pin.partName || '').replace(/_/g, ' ');
                                                        const optId = pin.clusterId || cluster?.id || pin.partId; // short + unique per placement
                                                        const matches = (o) => (o.optId ? o.optId === optId : o.partId === pin.partId);
                                                        const sel = (newStep.styleOptions || []).find(matches);
                                                        const part = allApprovedDesigns.find(d => d.id === pin.partId || d.legacyErpId === pin.partId || d.itemId === pin.partId);
                                                        const defaultPrice = parseFloat(part?.manufacturingSpecs?.basePrice) || 0;
                                                        const meshNode = pin.targetNode || pin.partName;
                                                        return (
                                                            <div key={`${optId}-${pinIdx}`} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                                                                <input type="checkbox" checked={!!sel} onChange={(e) => {
                                                                    setNewStep(prev => {
                                                                        const opts = (prev.styleOptions || []).filter(o => !matches(o));
                                                                        if (e.target.checked) opts.push({ optId, partId: pin.partId, partName: pin.partName, targetNode: meshNode, price: defaultPrice });
                                                                        const geometryMap = {};
                                                                        opts.forEach(o => { geometryMap[o.optId || o.partId] = o.targetNode; });
                                                                        return { ...prev, styleOptions: opts, geometryMap };
                                                                    });
                                                                }} />
                                                                {cluster?.imageUrl
                                                                    ? <img src={cluster.imageUrl} alt="" onClick={() => setZoomImg({ url: cluster.imageUrl, label: locLabel })} title="Click to enlarge" style={{ width: '40px', height: '40px', objectFit: 'contain', background: 'var(--paper)', border: '1px solid var(--line)', flexShrink: 0, cursor: 'zoom-in' }} />
                                                                    : <span style={{ width: '40px', height: '40px', flexShrink: 0, border: '1px dashed var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '7px', color: 'var(--ink-soft)', textAlign: 'center' }}>no img</span>}
                                                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                                    {(cluster?.location || cluster?.position) && (
                                                                        <div style={{ display: 'flex', gap: '4px' }}>
                                                                            {cluster?.location && <span style={{ fontFamily: 'var(--mono)', fontSize: '8px', background: 'var(--ink)', color: '#fff', padding: '2px 6px', textTransform: 'uppercase', letterSpacing: '.05em', borderRadius: '2px' }}>{cluster.location}</span>}
                                                                            {cluster?.position && <span style={{ fontFamily: 'var(--mono)', fontSize: '8px', background: 'var(--brass)', color: '#fff', padding: '2px 6px', textTransform: 'uppercase', letterSpacing: '.05em', borderRadius: '2px' }}>{cluster.position}</span>}
                                                                        </div>
                                                                    )}
                                                                    <span style={{ fontSize: '0.9rem', color: 'var(--ink)', fontWeight: 500 }}>{pin.partName}</span>
                                                                </div>
                                                                <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={meshNode}>mesh: {meshNode}</span>
                                                                <span style={{ color: 'var(--ink-soft)', fontSize: '0.8rem' }}>$</span>
                                                                <input type="number" step="0.01" disabled={!sel} value={sel ? (sel.price ?? defaultPrice) : defaultPrice} onChange={(e) => {
                                                                    const v = parseFloat(e.target.value) || 0;
                                                                    setNewStep(prev => ({ ...prev, styleOptions: (prev.styleOptions || []).map(o => matches(o) ? { ...o, price: v } : o) }));
                                                                }} style={{ width: '90px', padding: '6px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', opacity: sel ? 1 : 0.4 }} />
                                                                <span style={{ color: 'var(--ink-soft)', fontSize: '0.7rem', fontFamily: 'var(--mono)', textTransform: 'uppercase' }} title="2D layer stacking order — higher paints on top of the pole">Z</span>
                                                                <input type="number" disabled={!sel} value={sel && sel.layerZ !== undefined && sel.layerZ !== null ? sel.layerZ : ''} placeholder={String(parseInt(part?.manufacturingSpecs?.layeringSequence) || 10)} onChange={(e) => {
                                                                    const v = e.target.value;
                                                                    setNewStep(prev => ({ ...prev, styleOptions: (prev.styleOptions || []).map(o => matches(o) ? { ...o, layerZ: v === '' ? '' : (parseInt(v) || 0) } : o) }));
                                                                }} style={{ width: '56px', padding: '6px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', opacity: sel ? 1 : 0.4 }} />
                                                                <span style={{ color: 'var(--ink-soft)', fontSize: '0.7rem', fontFamily: 'var(--mono)', textTransform: 'uppercase' }} title="Bracket projection (in) for this option — drives Vision fabrication math (e.g. 4.25 standard vs 4.125 mini). Blank = use the flow's projection.">Proj″</span>
                                                                <input type="number" step="0.125" disabled={!sel} value={sel && sel.projection !== undefined && sel.projection !== null ? sel.projection : ''} placeholder="flow" onChange={(e) => {
                                                                    const v = e.target.value;
                                                                    setNewStep(prev => ({ ...prev, styleOptions: (prev.styleOptions || []).map(o => matches(o) ? { ...o, projection: v === '' ? '' : (parseFloat(v) || 0) } : o) }));
                                                                }} style={{ width: '64px', padding: '6px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', opacity: sel ? 1 : 0.4 }} />
                                                            </div>
                                                        );
                                                    })}
                                                    <label style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--ink)' }}>
                                                        <input type="checkbox" checked={!!newStep.finishDataSource} onChange={(e) => setNewStep({...newStep, finishDataSource: e.target.checked ? 'master_finishes' : '', finishAllowedOptions: e.target.checked ? ((newStep.finishAllowedOptions && newStep.finishAllowedOptions.length) ? newStep.finishAllowedOptions : [...(flowSettings.defaultFinishOptions || [])]) : []})} />
                                                        Also let the customer pick a Finish for the chosen style (applied to its mesh)
                                                    </label>

                                                    {newStep.finishDataSource && (
                                                        <div style={{ marginTop: '12px', marginLeft: '28px', padding: '12px 16px', background: 'var(--paper)', border: '1px solid var(--line)' }}>
                                                            <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '4px' }}>Available Finishes for this step</div>
                                                            <span style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', display: 'block', marginBottom: '10px' }}>Check the finishes to offer. Leave all unchecked to allow every finish.</span>
                                                            <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 16px' }}>
                                                                {getDataSourceItems('master_finishes').map(f => {
                                                                    const checked = (newStep.finishAllowedOptions || []).includes(f.id);
                                                                    return (
                                                                        <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '3px 0', fontSize: '0.85rem', color: 'var(--ink)', cursor: 'pointer' }}>
                                                                            <input type="checkbox" checked={checked} onChange={(e) => {
                                                                                setNewStep(prev => {
                                                                                    const set = new Set(prev.finishAllowedOptions || []);
                                                                                    if (e.target.checked) set.add(f.id); else set.delete(f.id);
                                                                                    return { ...prev, finishAllowedOptions: [...set] };
                                                                                });
                                                                            }} />
                                                                            {f.name}
                                                                        </label>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Per-style finish overrides: scope the finish list to an individual
                                                        style option (e.g. Wood rod -> wood-clear finishes, Metal rod ->
                                                        metal finishes). An option with its own list overrides the step
                                                        default above; left empty it inherits the step default. Iterates
                                                        styleOptions directly, so hand-authored options (not BOM pins) edit here too. */}
                                                    {newStep.finishDataSource && (newStep.styleOptions || []).length > 0 && (
                                                        <div style={{ marginTop: '12px', marginLeft: '28px', padding: '12px 16px', background: 'var(--paper)', border: '1px dashed var(--line)' }}>
                                                            <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '4px' }}>Per-style finish overrides (optional)</div>
                                                            <span style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', display: 'block', marginBottom: '10px' }}>Scope finishes per style — e.g. a Wood rod offers wood-clear finishes, a Metal rod offers metal finishes. Leave a style's list empty to use the step default above.</span>
                                                            {(newStep.styleOptions || []).map((o, oi) => {
                                                                const okey = o.optId || o.partId;
                                                                const list = o.finishAllowedOptions || [];
                                                                return (
                                                                    <details key={okey || oi} style={{ marginBottom: '8px', border: '1px solid var(--line)', background: '#fff' }}>
                                                                        <summary style={{ cursor: 'pointer', padding: '8px 12px', fontSize: '0.85rem', color: 'var(--ink)', fontWeight: 500 }}>
                                                                            {o.partName || okey} <span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}>— {list.length ? `${list.length} finish(es)` : 'step default'}</span>
                                                                        </summary>
                                                                        <div style={{ maxHeight: '160px', overflowY: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 16px', padding: '8px 12px', borderTop: '1px solid var(--line)' }}>
                                                                            {getDataSourceItems('master_finishes').map(f => {
                                                                                const checked = list.includes(f.id);
                                                                                return (
                                                                                    <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '3px 0', fontSize: '0.85rem', color: 'var(--ink)', cursor: 'pointer' }}>
                                                                                        <input type="checkbox" checked={checked} onChange={(e) => {
                                                                                            setNewStep(prev => ({ ...prev, styleOptions: (prev.styleOptions || []).map(so => {
                                                                                                if ((so.optId || so.partId) !== okey) return so;
                                                                                                const set = new Set(so.finishAllowedOptions || []);
                                                                                                if (e.target.checked) set.add(f.id); else set.delete(f.id);
                                                                                                return { ...so, finishAllowedOptions: [...set] };
                                                                                            }) }));
                                                                                        }} />
                                                                                        {f.name}
                                                                                    </label>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    </details>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {newStep.type === 'STATIC_FEE' ? (
                                        <div style={{ background: 'var(--paper)', padding: '20px', border: '1px solid var(--line)', marginTop: '10px' }}>
                                            <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '6px' }}>Fee Step</label>
                                            <span style={{ fontFamily: 'var(--sans)', fontSize: '0.9rem', color: 'var(--ink-soft)' }}>This is a fee — it rolls into the flow's NetSuite rollup item, so it needs no part, routing, or item association. Just set the amount under Pricing Rules.</span>
                                        </div>
                                    ) : (
                                    <div style={{ background: '#fff', padding: '20px', border: `1px solid ${!newStep.partHandling ? '#d9534f' : 'var(--line)'}`, marginTop: '10px' }}>
                                        <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '10px' }}>Part Handling & Routing <span style={{ color: '#d9534f' }}>* Required</span></label>
                                        <select value={newStep.partHandling || ''} onChange={e => setNewStep({...newStep, partHandling: e.target.value})} style={{ width: '100%', padding: '12px', border: `1px solid ${!newStep.partHandling ? '#d9534f' : 'var(--line)'}`, outline: 'none', fontFamily: 'var(--sans)' }}>
                                            <option value="">-- SELECT ROUTING --</option>
                                            {(globalLists.partHandling || ['Small Parts', 'Custom']).map(ph => (
                                                <option key={ph} value={ph}>{ph}</option>
                                            ))}
                                        </select>
                                    </div>
                                    )}

                                    <div style={{ background: 'var(--paper-2)', padding: '20px', border: '1px solid var(--line)', marginTop: '10px' }}>
                                        <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '15px' }}>Pricing Rules</label>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                            <label style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', color: 'var(--ink)' }}>
                                                <input type="checkbox" checked={newStep.useClientPricing || false} onChange={e => setNewStep({...newStep, useClientPricing: e.target.checked})} />
                                                Enable Client-Specific Pricing
                                            </label>
                                            <div>
                                                <label style={{ fontSize: '0.8rem', color: 'var(--ink)', display: 'block', marginBottom: '6px' }}>Flat Price Override ($)</label>
                                                <input type="number" step="0.01" value={newStep.priceOverride || ''} onChange={e => setNewStep({...newStep, priceOverride: e.target.value})} style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} />
                                            </div>
                                        </div>
                                    </div>
                                    
                                    {optionsToMap.length > 0 && optionsToMap.length < 100 && newStep.type !== 'DIMENSIONS' && newStep.type !== 'STATIC_FEE' && (
                                        <div style={{ background: '#fff', padding: '20px', border: '1px solid var(--line)' }}>
                                            <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: '15px' }}>Option Properties</div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: '15px', maxHeight: '300px', overflowY: 'auto' }}>
                                                <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>Option Name</div>
                                                <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>Upcharge ($)</div>
                                                <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>Geometry Swap (Mesh)</div>
                                                
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
                                                            <div style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', color: 'var(--ink)' }}>
                                                                {opt.name}
                                                            </div>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                <input type="number" step="0.5" value={newStep.priceMap?.[opt.id] || ""} onChange={(e) => setNewStep(prev => ({ ...prev, priceMap: { ...prev.priceMap, [opt.id]: parseFloat(e.target.value) || 0 } }))} placeholder="0.00" style={{ width: '100%', padding: '8px', border: '1px solid var(--line)', outline: 'none' }} disabled={newStep.useClientPricing || !!newStep.priceOverride} />
                                                            </div>
                                                            <div>
                                                                <input value={newStep.geometryMap?.[opt.id] || ""} onChange={(e) => setNewStep(prev => ({ ...prev, geometryMap: { ...prev.geometryMap, [opt.id]: e.target.value } }))} placeholder="Mesh to Show" style={{ width: '100%', padding: '8px', border: '1px solid var(--line)', outline: 'none' }} />
                                                            </div>
                                                        </React.Fragment>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    <label style={{ fontSize: '0.9rem', display: 'flex', gap: '10px', marginTop: '15px' }}>
                                        <input type="checkbox" checked={newStep.required} onChange={e => setNewStep({...newStep, required: e.target.checked})} /> Required Step
                                    </label>
                                    
                                    <div style={{ display: 'flex', gap: '15px', marginTop: '10px' }}>
                                        <button onClick={() => handleAddStepToFlow(activeFlow)} disabled={(newStep.type !== 'STATIC_FEE' && !newStep.mountSelector && !newStep.partHandling) || (newStep.type === 'STYLE_SWAP' ? !(newStep.styleOptions && newStep.styleOptions.length) : ((newStep.type !== 'DIMENSIONS' && newStep.type !== 'STATIC_FEE' && !newStep.mountSelector) && !newStep.dataSource))} style={{ flex: 1, padding: '15px', background: (newStep.type !== 'STATIC_FEE' && !newStep.mountSelector && !newStep.partHandling) ? 'var(--ink-soft)' : 'var(--ink)', color: '#fff', border: 'none', cursor: (newStep.type !== 'STATIC_FEE' && !newStep.mountSelector && !newStep.partHandling) ? 'not-allowed' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                                            {newStep.id ? "Save Edits to Step" : "Add Step"}
                                        </button>
                                        {newStep.id && (
                                            <button onClick={() => setNewStep({ id: null, title: '', type: 'DROPDOWN', dataSource: '', required: true, priceMap: {}, geometryMap: {}, targetNodes: '', allowedOptions: [], useClientPricing: false, priceOverride: '', partHandling: '', calculatorTemplate: '', qtyHelperText: '', basePrice: '', linkedItemId: '' })} style={{ padding: '15px 30px', background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                                                Cancel
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                {(activeFlow.steps || []).map((step, idx) => (
                                    <div key={step.id} style={{ padding: '24px', background: '#fff', border: '1px solid var(--line)', borderLeft: '4px solid var(--brass)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '2px', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
                                        <div>
                                            <div style={{ fontWeight: 500, fontSize: '1.1rem', fontFamily: 'var(--serif)', color: 'var(--ink)' }}>Step {idx + 1}: {step.title}</div>
                                            <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '8px' }}>
                                                Type: {step.type} | Data: {step.dataSource || 'N/A'} | Req: {step.required ? 'Yes' : 'No'}
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <button onClick={() => handleMoveStep(activeFlow, idx, 'UP')} disabled={idx === 0} style={{ padding: '8px', cursor: idx === 0 ? 'not-allowed' : 'pointer', background: 'var(--paper-2)', border: '1px solid var(--line)' }}>⬆️</button>
                                            <button onClick={() => handleMoveStep(activeFlow, idx, 'DOWN')} disabled={idx === activeFlow.steps.length - 1} style={{ padding: '8px', cursor: idx === activeFlow.steps.length - 1 ? 'not-allowed' : 'pointer', background: 'var(--paper-2)', border: '1px solid var(--line)' }}>⬇️</button>
                                            <button onClick={() => setNewStep(step)} style={{ padding: '8px 20px', background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', marginLeft: '10px' }}>Edit</button>
                                            <button onClick={() => handleDeleteStep(activeFlow, step.id)} style={{ padding: '8px 20px', background: 'transparent', color: '#d9534f', border: '1px solid #d9534f', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase' }}>Del</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
          )}

          {/* --- DYNAMIC CPQ RULES ENGINE --- */}
          {activeSection === "RULES" && (
            <div style={{ padding: '40px', maxWidth: '1000px' }}>
              <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: '15px', marginBottom: '30px' }}>
                  <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500 }}>Dynamic CPQ Rules Engine</h3>
                  <p style={{ margin: '8px 0 0 0', fontSize: '0.9rem', color: 'var(--ink-soft)' }}>Define conditional logic using attributes. Rules actively dictate CPQ behaviors and UI filters in Tab 8.</p>
              </div>
              
              <div style={{ background: 'var(--paper-2)', border: '1px solid var(--line)', padding: '24px', marginBottom: '30px', borderRadius: '2px' }}>
                  <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '12px' }}>AI Assist: Describe Your Rule</label>
                  <div style={{ display: 'flex', gap: '15px' }}>
                      <input value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} placeholder="e.g. 'If weight class is light, disable the trim step'" style={{ flex: 1, padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} />
                      <button onClick={handleAiGenerateRule} disabled={isGeneratingAi || !aiPrompt} style={{ padding: '12px 24px', background: isGeneratingAi ? '#ccc' : 'var(--ink)', color: '#fff', border: 'none', cursor: isGeneratingAi ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                          {isGeneratingAi ? 'Generating...' : 'Generate'}
                      </button>
                  </div>
              </div>

              <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '30px', marginBottom: '40px', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                  <h4 style={{ margin: '0 0 20px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500 }}>Manual Rule Builder</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                      <div style={{ gridColumn: 'span 2' }}>
                          <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Rule Name / Description</label>
                          <input value={newRule.name} onChange={e => setNewRule({...newRule, name: e.target.value})} placeholder="e.g. Light Fabrics Cannot Have Trim" style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} />
                      </div>
                      
                      <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', padding: '20px' }}>
                          <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: '12px' }}>IF SELECTION CONDITION</div>
                          <select value={newRule.conditionField} onChange={e => setNewRule({...newRule, conditionField: e.target.value})} style={{ width: '100%', padding: '10px', marginBottom: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }}>
                              <option value="">-- Select Trigger Attribute --</option>
                              <optgroup label="Core Specs">
                                  <option value="productType">Product Type</option>
                                  <option value="collections">Collection (use CONTAINS)</option>
                              </optgroup>
                              <optgroup label="Bracket / Hardware">
                                  <option value="customData.isReturnBracket">Is Return Bracket (End-Return) — value TRUE/FALSE</option>
                                  <option value="customData.bracketType">Bracket Type / Mount</option>
                                  <option value="customData.projection">Projection</option>
                                  <option value="customData.bpOrientation">Backplate Orientation</option>
                                  <option value="customData.armThickness">Bracket Arm Thickness</option>
                                  <option value="customData.feeType">Fee Type</option>
                              </optgroup>
                              <optgroup label="Dynamic Schema">
                                  {customSchema.map(f => <option key={f.key} value={`customData.${f.key}`}>{f.label}</option>)}
                              </optgroup>
                          </select>
                          <div style={{ display: 'flex', gap: '10px' }}>
                              <select value={newRule.conditionOp} onChange={e => setNewRule({...newRule, conditionOp: e.target.value})} style={{ flex: 1, padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }}>
                                  <option value="EQUALS">EQUALS</option><option value="NOT_EQUALS">NOT EQUALS</option><option value="CONTAINS">CONTAINS</option>
                              </select>
                              <input value={newRule.conditionVal} onChange={e => setNewRule({...newRule, conditionVal: e.target.value})} placeholder="Value (e.g. LIGHTWEIGHT)" style={{ flex: 2, padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} />
                          </div>
                      </div>

                      <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', padding: '20px' }}>
                          <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: '12px' }}>THEN EFFECT</div>
                          <select value={newRule.effectField} onChange={e => setNewRule({...newRule, effectField: e.target.value})} style={{ width: '100%', padding: '10px', marginBottom: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }}>
                              <option value="">-- Select Target System Rule --</option>
                              <optgroup label="UI Controls">
                                  <option value="UI.disableStep">DISABLE Step (Name)</option>
                                  <option value="UI.hideFinishes">HIDE Specific Finishes</option>
                              </optgroup>
                              <optgroup label="Hardware Mathematics">
                                  <option value="MATH.maxBracketSpacing">SET Max Bracket Spacing (in)</option>
                                  <option value="MATH.frenchReturn1in">APPLY 1" French Return Logic</option>
                                  <option value="MATH.miteredBay">APPLY Mitered Bay Logic</option>
                                  <option value="MATH.curvedBay">APPLY Curved Bay Logic</option>
                              </optgroup>
                          </select>
                          <input value={newRule.effectVal} onChange={e => setNewRule({...newRule, effectVal: e.target.value})} placeholder="Effect Value (e.g. Select Trim)" style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} />
                      </div>
                  </div>
                  <button onClick={handleAddRule} style={{ width: '100%', padding: '16px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', marginTop: '24px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Inject Rule Into CPQ</button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  {cpqRules.length === 0 && <div style={{ padding: '20px', background: 'var(--paper-2)', color: 'var(--ink-soft)', fontStyle: 'italic', border: '1px solid var(--line)' }}>No dynamic rules configured yet.</div>}
                  {cpqRules.map(rule => (
                      <div key={rule.id} style={{ background: '#fff', border: '1px solid var(--line)', borderLeft: '4px solid var(--brass)', padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                              <div style={{ fontWeight: 500, fontSize: '1.2rem', fontFamily: 'var(--serif)', color: 'var(--ink)' }}>{rule.name}</div>
                              <div style={{ fontSize: '0.85rem', marginTop: '8px', display: 'flex', gap: '20px', color: 'var(--ink-soft)' }}>
                                  <span><strong style={{fontFamily: 'var(--mono)'}}>IF:</strong> {rule.conditionField.replace('customData.', '')} {rule.conditionOp} "{rule.conditionVal}"</span>
                                  <span><strong style={{fontFamily: 'var(--mono)'}}>THEN:</strong> {rule.effectField} = "{rule.effectVal}"</span>
                              </div>
                          </div>
                          <button onClick={() => handleDeleteRule(rule.id)} style={{ background: 'none', border: 'none', color: '#d9534f', fontSize: '1.2rem', cursor: 'pointer' }}>🗑️</button>
                      </div>
                  ))}
              </div>
            </div>
          )}

          {/* --- CRM & SALES CONFIGURATION VIEW --- */}
          {activeSection === "CRM_SETTINGS" && (
              <div style={{ padding: '40px', maxWidth: '1200px' }}>
                  <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: '15px', marginBottom: '30px' }}>
                      <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500 }}>CRM & Sales Dictionaries</h3>
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
                      
                      {/* DISCOUNT CODES */}
                      <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', display: 'flex', flexDirection: 'column', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                          <h4 style={{ margin: '0 0 20px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, borderBottom: '1px solid var(--line)', paddingBottom: '10px' }}>Discount Codes</h4>
                          <div style={{ background: 'var(--paper-2)', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px', border: '1px solid var(--line)' }}>
                              <div style={{ display: 'flex', gap: '15px' }}>
                                  <div style={{ flex: 1 }}><label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '6px' }}>Code</label><input value={newDiscount.code} onChange={e => setNewDiscount({...newDiscount, code: e.target.value})} placeholder="e.g. AD" style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', outline: 'none', textTransform: 'uppercase' }} /></div>
                                  <div style={{ flex: 1 }}><label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '6px' }}>Disc %</label><input type="number" value={newDiscount.percent} onChange={e => setNewDiscount({...newDiscount, percent: e.target.value})} placeholder="e.g. 20" style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', outline: 'none' }} /></div>
                              </div>
                              <div>
                                  <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '6px' }}>Description</label>
                                  <input value={newDiscount.description} onChange={e => setNewDiscount({...newDiscount, description: e.target.value})} placeholder="e.g. Architect/Designer Tier" style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', outline: 'none' }} />
                              </div>
                              <button onClick={handleAddDiscount} style={{ padding: '12px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', marginTop: '8px' }}>Add Discount</button>
                          </div>

                          <div style={{ flex: 1, overflowY: 'auto', maxHeight: '300px' }}>
                              {crmDiscounts.length === 0 && <span style={{ fontSize: '0.9rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No discount codes defined.</span>}
                              {crmDiscounts.map(d => (
                                  <div key={d.code} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--paper)', padding: '16px', borderBottom: '1px solid var(--line)' }}>
                                      <div>
                                          <div style={{ fontWeight: 500, color: 'var(--ink)', fontSize: '1.1rem' }}>{d.code} <span style={{ color: 'var(--brass)', fontFamily: 'var(--mono)', fontSize: '0.85rem' }}>(-{d.percent}%)</span></div>
                                          <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '4px' }}>{d.description}</div>
                                      </div>
                                      <button onClick={() => handleRemoveDiscount(d.code)} style={{ background: 'none', border: 'none', color: '#d9534f', fontSize: '1.2rem', cursor: 'pointer' }}>🗑️</button>
                                  </div>
                              ))}
                          </div>
                      </div>

                      {/* PAYMENT TERMS & SALES REPS */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                          
                          <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                              <h4 style={{ margin: '0 0 15px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, borderBottom: '1px solid var(--line)', paddingBottom: '10px' }}>Payment Terms</h4>
                              <div style={{ display: 'flex', gap: '15px', marginBottom: '20px' }}>
                                  <input value={crmListInput.paymentTerms || ''} onChange={e => setCrmListInput({...crmListInput, paymentTerms: e.target.value})} placeholder="e.g. Net 60" style={{ flex: 1, padding: '10px', border: '1px solid var(--line)', outline: 'none' }} />
                                  <button onClick={() => handleAddCrmList('paymentTerms')} style={{ padding: '0 20px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase' }}>Add</button>
                              </div>
                              <div style={{ maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                  {(globalLists.paymentTerms || []).length === 0 && <span style={{ fontSize: '0.9rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No terms defined.</span>}
                                  {(globalLists.paymentTerms || []).map(term => (
                                      <div key={term} style={{ display: 'flex', justifyContent: 'space-between', background: 'var(--paper)', padding: '12px', border: '1px solid var(--line)' }}>
                                          <span style={{ fontSize: '0.95rem', color: 'var(--ink)' }}>{term}</span>
                                          <span onClick={() => handleRemoveCrmList('paymentTerms', term)} style={{ color: '#d9534f', cursor: 'pointer', fontSize: '1.2rem' }}>×</span>
                                      </div>
                                  ))}
                              </div>
                          </div>

                          <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                              <h4 style={{ margin: '0 0 15px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, borderBottom: '1px solid var(--line)', paddingBottom: '10px' }}>Sales Representatives</h4>
                              <div style={{ display: 'flex', gap: '15px', marginBottom: '20px' }}>
                                  <input value={crmListInput.salesReps || ''} onChange={e => setCrmListInput({...crmListInput, salesReps: e.target.value})} placeholder="Rep Name" style={{ flex: 1, padding: '10px', border: '1px solid var(--line)', outline: 'none' }} />
                                  <button onClick={() => handleAddCrmList('salesReps')} style={{ padding: '0 20px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase' }}>Add</button>
                              </div>
                              <div style={{ maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                  {(globalLists.salesReps || []).length === 0 && <span style={{ fontSize: '0.9rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No sales reps defined.</span>}
                                  {(globalLists.salesReps || []).map(rep => (
                                      <div key={rep} style={{ display: 'flex', justifyContent: 'space-between', background: 'var(--paper)', padding: '12px', border: '1px solid var(--line)' }}>
                                          <span style={{ fontSize: '0.95rem', color: 'var(--ink)' }}>{rep}</span>
                                          <span onClick={() => handleRemoveCrmList('salesReps', rep)} style={{ color: '#d9534f', cursor: 'pointer', fontSize: '1.2rem' }}>×</span>
                                      </div>
                                  ))}
                              </div>
                          </div>

                      </div>
                  </div>
              </div>
          )}

          {/* --- FORMS & BRANDING VIEW --- */}
          {activeSection === "PLATING_FEES" && (() => {
            const allTypes = Array.from(new Set([
              ...Object.keys(platingFeesDoc.rules || {}),
              ...Object.keys(feeEdits),
              ...((globalLists.prodTypes || []).map(t => String(t).toUpperCase())),
            ])).sort();
            const feeVal = (t) => (feeEdits[t] !== undefined ? feeEdits[t].fee : (platingFeesDoc.rules?.[t]?.fee ?? ''));
            const unitVal = (t) => (feeEdits[t] !== undefined ? feeEdits[t].unit : (platingFeesDoc.rules?.[t]?.unit || 'ea'));
            const dirty = Object.keys(feeEdits).length > 0;
            const cell = { padding: '10px 14px', borderBottom: '1px solid var(--line)', fontSize: '0.92rem' };
            const inp = { padding: '8px 10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', fontSize: '0.9rem' };
            return (
            <div style={{ padding: '40px', maxWidth: '900px' }}>
              <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: '15px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <div>
                  <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500 }}>Plating Fees</h3>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Plating-service cost by product type — used by PickPack's plater PO & packing list. Separate from the NetSuite assembly cost.</span>
                </div>
                <button onClick={handleLoadStdPlatingFees} style={{ padding: '8px 14px', background: '#fff', color: 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' }}>Load standard fees</button>
              </div>
              <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', overflow: 'hidden', marginBottom: '20px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ background: 'var(--paper-2)' }}>
                    <tr>
                      <th style={{ ...cell, textAlign: 'left', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Product Type</th>
                      <th style={{ ...cell, textAlign: 'left', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', width: '160px' }}>Fee ($)</th>
                      <th style={{ ...cell, textAlign: 'left', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', width: '160px' }}>Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allTypes.length === 0 ? (
                      <tr><td colSpan={3} style={{ ...cell, textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No product types yet. Add one below, or "Load standard fees".</td></tr>
                    ) : allTypes.map(t => (
                      <tr key={t}>
                        <td style={{ ...cell, fontWeight: 500, color: 'var(--ink)' }}>{t}</td>
                        <td style={cell}><input type="number" min="0" step="0.01" value={feeVal(t)} onChange={e => setFeeField(t, 'fee', e.target.value)} placeholder="—" style={{ ...inp, width: '110px', textAlign: 'right' }} /></td>
                        <td style={cell}>
                          <select value={unitVal(t)} onChange={e => setFeeField(t, 'unit', e.target.value)} style={{ ...inp, background: '#fff' }}>
                            <option value="ea">per piece</option>
                            <option value="ft">per foot</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '24px' }}>
                <input value={newFeeType} onChange={e => setNewFeeType(e.target.value.toUpperCase())} placeholder="Add a product type (e.g. SCREW)" style={{ ...inp, flex: 1 }} onKeyDown={e => { if (e.key === 'Enter') handleAddFeeType(); }} />
                <button onClick={handleAddFeeType} style={{ padding: '0 18px', height: '36px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase' }}>Add Type</button>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={handleSavePlatingFees} disabled={!dirty} style={{ padding: '12px 24px', background: dirty ? 'var(--ink)' : 'var(--paper-2)', color: dirty ? '#fff' : 'var(--ink-soft)', border: dirty ? 'none' : '1px solid var(--line)', cursor: dirty ? 'pointer' : 'not-allowed', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>{dirty ? 'Save Plating Fees' : 'Saved'}</button>
              </div>
              <p style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', marginTop: '14px', textTransform: 'uppercase', letterSpacing: '.05em', lineHeight: 1.6 }}>
                Cost per line = fee × qty. Poles are per-foot and their qty is already in feet (from the custom sales order), so the math is the same. Clear a fee to remove that type. Pole Round / Pole Square are their own product types.
              </p>
            </div>
            );
          })()}

          {activeSection === "FORMS" && (
            <div style={{ padding: '40px', maxWidth: '1200px' }}>
              <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: '15px', marginBottom: '30px' }}>
                <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500 }}>Document Templates & Branding</h3>
              </div>
              
              <div style={{ display: 'flex', gap: '30px' }}>
                  {/* LOGO MANAGER */}
                  <div style={{ flex: 1, background: 'var(--paper)', border: '1px solid var(--line)', padding: '30px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      <h4 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500 }}>Brand Logos</h4>
                      <p style={{ fontSize: '0.9rem', color: 'var(--ink-soft)', margin: 0 }}>Upload SVG files for infinitely scalable, high-resolution document branding.</p>
                      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                          {BRANDS_LIST.map(bKey => (
                              <div key={bKey} style={{ background: '#fff', border: '1px solid var(--line)', padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                                      <strong style={{ fontFamily: 'var(--mono)', textTransform: 'uppercase' }}>{bKey}</strong>
                                      <div style={{ width: '80px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                          {brandLogos[bKey] ? <img src={brandLogos[bKey]} alt={bKey} style={{ maxWidth: '100%', maxHeight: '100%' }} /> : <span style={{ fontSize: '0.7rem', color: 'var(--ink-soft)' }}>NONE</span>}
                                      </div>
                                  </div>
                                  <label style={{ background: 'var(--paper-2)', border: '1px solid var(--line)', color: 'var(--ink)', padding: '10px 16px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', cursor: isUploadingLogo ? 'wait' : 'pointer' }}>
                                      {isUploadingLogo ? 'Uploading...' : 'Upload SVG'}
                                      <input type="file" accept=".svg,.png" style={{ display: 'none' }} onChange={(e) => handleLogoUpload(e, bKey)} disabled={isUploadingLogo} />
                                  </label>
                              </div>
                          ))}
                      </div>
                  </div>

                  {/* FORM BUILDER */}
                  <div style={{ flex: 1.5, background: '#fff', border: '1px solid var(--line)', padding: '30px', display: 'flex', flexDirection: 'column', gap: '20px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                      <h4 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500 }}>Template Configurator</h4>
                      
                      <div>
                          <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Document Type</label>
                          <select value={activeFormType} onChange={(e) => setActiveFormType(e.target.value)} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', background: 'var(--paper)' }}>
                              {DOCUMENT_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                          </select>
                      </div>

                      <div>
                          <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Global Header Notes</label>
                          <textarea value={formEditor.header} onChange={e => setFormEditor({...formEditor, header: e.target.value})} placeholder="e.g. Thank you for your business!" rows={3} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', resize: 'vertical' }} />
                      </div>

                      <div>
                          <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Global Footer Notes</label>
                          <textarea value={formEditor.footer} onChange={e => setFormEditor({...formEditor, footer: e.target.value})} placeholder="e.g. Please remit payment within 30 days." rows={3} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', resize: 'vertical' }} />
                      </div>

                      <div>
                          <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Terms & Conditions (Fine Print)</label>
                          <textarea value={formEditor.terms} onChange={e => setFormEditor({...formEditor, terms: e.target.value})} placeholder="Standard legal terms..." rows={5} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', fontSize: '0.85rem', resize: 'vertical' }} />
                      </div>

                      <button onClick={handleSaveFormTemplate} style={{ width: '100%', padding: '16px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', marginTop: '10px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                          Save {activeFormType.replace('_', ' ')} Template
                      </button>
                  </div>
              </div>
            </div>
          )}

          {/* --- UNIFIED USER DIRECTORY & MATRIX --- */}
          {activeSection === "USERS" && (
            <div style={{ padding: '40px', maxWidth: '1100px' }}>
              <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: '15px', marginBottom: '30px' }}>
                <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500 }}>Global User Directory & Access Matrix</h3>
                <p style={{ margin: '8px 0 0 0', fontSize: '0.9rem', color: 'var(--ink-soft)' }}>Changes saved here will sync across all terminals instantly.</p>
              </div>
              
              <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', padding: '24px', marginBottom: '30px' }}>
                <h4 style={{ margin: '0 0 15px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500 }}>System Roles</h4>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
                  {dynamicRoles.map(role => (
                    <span key={role} style={{ background: 'var(--ink)', color: '#fff', padding: '8px 16px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '12px', borderRadius: '2px' }}>
                      {role.toUpperCase().replace(/_/g, ' ')}
                      {role !== 'admin' && <button onClick={() => handleDeleteRole(role)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, opacity: 0.6 }}>✖</button>}
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '15px' }}>
                  <input value={newRole} onChange={e => setNewRole(e.target.value)} placeholder="New Role (e.g. Sales Rep)" style={{ padding: '12px', border: '1px solid var(--line)', width: '300px', outline: 'none', fontFamily: 'var(--sans)' }} />
                  <button onClick={handleAddRole} style={{ padding: '0 24px', background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase' }}>Add Role</button>
                </div>
              </div>
              
              {/* 🚀 THE MASTER PERMISSIONS MATRIX */}
              <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '30px', marginBottom: '30px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <h4 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500 }}>Unified Permissions Matrix</h4>
                    <button onClick={handleSavePermissions} style={{ padding: '12px 24px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Save All Matrix Rules</button>
                </div>
                
                {/* HQ MATRIX */}
                <div style={{ marginBottom: '40px' }}>
                    <h5 style={{ margin: '0 0 10px 0', fontFamily: 'var(--mono)', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', background: 'var(--paper-2)', padding: '8px', border: '1px solid var(--line)' }}>HQ Application Tabs</h5>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontFamily: 'var(--sans)' }}>
                        <thead style={{ background: '#fff', borderBottom: '1px solid var(--line)' }}>
                            <tr>
                                <th style={{ padding: '15px', textAlign: 'left', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Tab</th>
                                {dynamicRoles.map(r => (<th key={r} style={{ padding: '15px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{r.replace(/_/g, ' ')}</th>))}
                            </tr>
                        </thead>
                        <tbody>
                            {TABS.map(tab => (
                            <tr key={tab} style={{ borderBottom: '1px solid var(--line)' }}>
                                <td style={{ padding: '15px', textAlign: 'left', color: 'var(--ink)', fontWeight: 500 }}>{tab}</td>
                                {dynamicRoles.map(role => (
                                    <td key={role} style={{ padding: '15px' }}>
                                        <input type="checkbox" checked={perms[role]?.includes(tab) || false} onChange={() => handleHqPermToggle(role, tab)} style={{ cursor: 'pointer' }} />
                                    </td>
                                ))}
                            </tr>
                            ))}
                        </tbody>
                        </table>
                    </div>
                </div>

                {/* SHOP FLOOR MATRIX */}
                <div style={{ marginBottom: '40px' }}>
                    <h5 style={{ margin: '0 0 10px 0', fontFamily: 'var(--mono)', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', background: 'var(--paper-2)', padding: '8px', border: '1px solid var(--line)' }}>Shop Floor Application Tabs</h5>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontFamily: 'var(--sans)' }}>
                        <thead style={{ background: '#fff', borderBottom: '1px solid var(--line)' }}>
                            <tr>
                                <th style={{ padding: '15px', textAlign: 'left', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Tab</th>
                                {dynamicRoles.map(r => (<th key={r} style={{ padding: '15px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{r.replace(/_/g, ' ')}</th>))}
                            </tr>
                        </thead>
                        <tbody>
                            {SHOP_TABS.map(tab => (
                            <tr key={tab} style={{ borderBottom: '1px solid var(--line)' }}>
                                <td style={{ padding: '15px', textAlign: 'left', color: 'var(--ink)', fontWeight: 500 }}>{tab}</td>
                                {dynamicRoles.map(role => (
                                    <td key={role} style={{ padding: '15px' }}>
                                        <input type="checkbox" checked={shopPerms[role]?.includes(tab) || false} onChange={() => handleShopPermToggle(role, tab)} style={{ cursor: 'pointer' }} />
                                    </td>
                                ))}
                            </tr>
                            ))}
                        </tbody>
                        </table>
                    </div>
                </div>

                {/* FINISHING FLOOR MATRIX */}
                <div style={{ marginBottom: '40px' }}>
                    <h5 style={{ margin: '0 0 10px 0', fontFamily: 'var(--mono)', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', background: 'var(--paper-2)', padding: '8px', border: '1px solid var(--line)' }}>Finishing Floor Application Tabs</h5>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontFamily: 'var(--sans)' }}>
                        <thead style={{ background: '#fff', borderBottom: '1px solid var(--line)' }}>
                            <tr>
                                <th style={{ padding: '15px', textAlign: 'left', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Tab</th>
                                {dynamicRoles.map(r => (<th key={r} style={{ padding: '15px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{r.replace(/_/g, ' ')}</th>))}
                            </tr>
                        </thead>
                        <tbody>
                            {FIN_TABS.map(tab => (
                            <tr key={tab} style={{ borderBottom: '1px solid var(--line)' }}>
                                <td style={{ padding: '15px', textAlign: 'left', color: 'var(--ink)', fontWeight: 500 }}>{tab}</td>
                                {dynamicRoles.map(role => (
                                    <td key={role} style={{ padding: '15px' }}>
                                        <input type="checkbox" checked={finPerms[role]?.includes(tab) || false} onChange={() => handleFinPermToggle(role, tab)} style={{ cursor: 'pointer' }} />
                                    </td>
                                ))}
                            </tr>
                            ))}
                        </tbody>
                        </table>
                    </div>
                </div>

                {/* WAREHOUSE / PICK PACK MATRIX */}
                <div style={{ marginBottom: '20px' }}>
                    <h5 style={{ margin: '0 0 10px 0', fontFamily: 'var(--mono)', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', background: 'var(--paper-2)', padding: '8px', border: '1px solid var(--line)' }}>Warehouse / Pick & Pack Tabs</h5>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontFamily: 'var(--sans)' }}>
                        <thead style={{ background: '#fff', borderBottom: '1px solid var(--line)' }}>
                            <tr>
                                <th style={{ padding: '15px', textAlign: 'left', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Tab</th>
                                {dynamicRoles.map(r => (<th key={r} style={{ padding: '15px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{r.replace(/_/g, ' ')}</th>))}
                            </tr>
                        </thead>
                        <tbody>
                            {PICK_TABS.map(tab => (
                            <tr key={tab} style={{ borderBottom: '1px solid var(--line)' }}>
                                <td style={{ padding: '15px', textAlign: 'left', color: 'var(--ink)', fontWeight: 500 }}>{tab}</td>
                                {dynamicRoles.map(role => (
                                    <td key={role} style={{ padding: '15px' }}>
                                        <input type="checkbox" checked={pickPerms[role]?.includes(tab) || false} onChange={() => handlePickPermToggle(role, tab)} style={{ cursor: 'pointer' }} />
                                    </td>
                                ))}
                            </tr>
                            ))}
                        </tbody>
                        </table>
                    </div>
                </div>

              </div>

              <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '30px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                <h4 style={{ margin: '0 0 20px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500 }}>Global User Directory</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 2fr', gap: '15px', marginBottom: '20px' }}>
                  <input value={adminForm.uName} onChange={e => setAdminForm({...adminForm, uName: e.target.value})} placeholder="User Name" disabled={!!adminForm.oldId} style={{ padding: '12px', border: '1px solid var(--line)', background: adminForm.oldId ? 'var(--paper)' : '#fff', outline: 'none', fontFamily: 'var(--sans)' }} />
                  <input value={adminForm.uPin} onChange={e => setAdminForm({...adminForm, uPin: e.target.value})} placeholder="4-Digit PIN" maxLength="4" style={{ padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} />
                  <select value={adminForm.uRole} onChange={e => setAdminForm({...adminForm, uRole: e.target.value})} style={{ padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }}>{dynamicRoles.map(r => <option key={r} value={r}>{r.toUpperCase().replace(/_/g, ' ')}</option>)}</select>
                </div>
                <div style={{ display: 'flex', gap: '15px', marginBottom: '30px' }}>
                  <button onClick={handleSaveUser} style={{ flex: 1, padding: '16px', background: adminForm.oldId ? 'var(--brass)' : 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>{adminForm.oldId ? 'Update User' : 'Add User'}</button>
                  {adminForm.oldId && <button onClick={() => setAdminForm({ uName: '', uPin: '', uRole: dynamicRoles[0], oldId: '' })} style={{ padding: '16px 30px', background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase' }}>Cancel</button>}
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontFamily: 'var(--sans)' }}>
                  <thead style={{ background: 'var(--paper)' }}>
                      <tr>
                          <th style={{ padding: '15px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Name</th>
                          <th style={{ padding: '15px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Role</th>
                          <th style={{ padding: '15px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}></th>
                      </tr>
                  </thead>
                  <tbody>
                      {users.map(u => (
                          <tr key={u.id} style={{ borderBottom: '1px solid var(--line)' }}>
                              <td style={{ padding: '15px', color: 'var(--ink)' }}>{u.name}</td>
                              <td style={{ padding: '15px', color: 'var(--ink-soft)' }}>{u.role?.toUpperCase().replace(/_/g, ' ')}</td>
                              <td style={{ padding: '15px', textAlign: 'right' }}>
                                  <button onClick={() => setAdminForm({ uName: u.name, uPin: u.pin || '', uRole: u.role || dynamicRoles[0], oldId: u.id })} style={{ background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink)', padding: '6px 12px', fontSize: '10px', fontFamily: 'var(--mono)', textTransform: 'uppercase', cursor: 'pointer', marginRight: '10px' }}>Edit</button>
                                  <button onClick={() => handleDeleteUser(u)} style={{ background: 'transparent', border: 'none', color: '#d9534f', fontSize: '1.2rem', cursor: 'pointer' }}>🗑️</button>
                              </td>
                          </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* --- DANGER ZONE VIEW --- */}
          {activeSection === "DANGER" && (
            <div style={{ padding: '40px', maxWidth: '800px' }}>
              <h3 style={{ margin: '0 0 20px 0', fontFamily: 'var(--serif)', fontSize: '1.6rem', color: '#d9534f', borderBottom: '1px solid var(--line)', paddingBottom: '15px' }}>Danger Zone (Dataflash)</h3>
              <p style={{ color: '#fff', background: '#d9534f', padding: '15px', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Actions taken here are permanent and cannot be undone.</p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '30px' }}>
                <div style={{ border: '1px solid #d9534f', padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff' }}>
                  <div>
                      <h4 style={{ margin: '0 0 8px 0', fontFamily: 'var(--serif)', fontSize: '1.2rem', color: '#d9534f' }}>Wipe All Jobs, Drafts, & Pipeline</h4>
                      <div style={{fontSize:'0.9rem', color:'var(--ink-soft)'}}>Clears all Sales Orders, Work Orders, and CPQ quotes.</div>
                  </div>
                  <button onClick={handleNukeJobs} style={{ padding: '16px 24px', background: '#d9534f', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Nuke Pipeline</button>
                </div>
                
                <div style={{ border: '1px solid #d9534f', padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff' }}>
                  <div>
                      <h4 style={{ margin: '0 0 8px 0', fontFamily: 'var(--serif)', fontSize: '1.2rem', color: '#d9534f' }}>Wipe All Master Assemblies</h4>
                      <div style={{fontSize:'0.9rem', color:'var(--ink-soft)'}}>Deletes all BOMs and Top-Level Configurations.</div>
                  </div>
                  <button onClick={handleNukeAssemblies} style={{ padding: '16px 24px', background: '#d9534f', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Nuke Assemblies</button>
                </div>
                <div style={{ border: '1px solid #d9534f', padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff' }}>
                  <div>
                      <h4 style={{ margin: '0 0 8px 0', fontFamily: 'var(--serif)', fontSize: '1.2rem', color: '#d9534f' }}>Wipe All CPQ Flows</h4>
                      <div style={{fontSize:'0.9rem', color:'var(--ink-soft)'}}>Deletes every CPQ flow for this brand (steps, geometry maps, hide-cluster lists).</div>
                  </div>
                  <button onClick={handleNukeFlows} style={{ padding: '16px 24px', background: '#d9534f', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Nuke Flows</button>
                </div>
                <div style={{ border: '1px solid #d9534f', padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff' }}>
                  <div>
                      <h4 style={{ margin: '0 0 8px 0', fontFamily: 'var(--serif)', fontSize: '1.2rem', color: '#d9534f' }}>Wipe All Customers</h4>
                      <div style={{fontSize:'0.9rem', color:'var(--ink-soft)'}}>Deletes all customer records and address books for this brand.</div>
                  </div>
                  <button onClick={handleNukeCustomers} style={{ padding: '16px 24px', background: '#d9534f', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Nuke Customers</button>
                </div>
                <div style={{ border: '1px solid #d9534f', padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff' }}>
                  <div>
                      <h4 style={{ margin: '0 0 8px 0', fontFamily: 'var(--serif)', fontSize: '1.2rem', color: '#d9534f' }}>Wipe Master Inventory Library</h4>
                      <div style={{fontSize:'0.9rem', color:'var(--ink-soft)'}}>Deletes all raw materials, components, and hardware.</div>
                  </div>
                  <button onClick={handleNukeLibrary} style={{ padding: '16px 24px', background: '#d9534f', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Nuke Inventory</button>
                </div>
              </div>
            </div>
          )}

          {/* --- SUPER ADMIN VIEW (TAB 15.5) --- */}
          {activeSection === "SUPER_ADMIN" && isSuperAdmin && (
            <div style={{ padding: '40px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: '15px', marginBottom: '30px' }}>
                <h3 style={{ margin: '0 0 12px 0', fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500 }}>Master Analytics & Surveillance</h3>
              </div>

              {/* PIN CHANGER */}
              <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', padding: '30px', marginBottom: '40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                      <h4 style={{ margin: '0 0 8px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', color: 'var(--ink)' }}>Master PIN Controls</h4>
                      <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--ink-soft)' }}>Update your global access PIN. Your Super Admin status will migrate automatically.</p>
                  </div>
                  <div style={{ display: 'flex', gap: '15px' }}>
                      <input 
                          type="password" 
                          value={newMasterPin} 
                          onChange={e => setNewMasterPin(e.target.value)} 
                          placeholder="NEW PIN" 
                          maxLength="4"
                          style={{ padding: '12px', fontSize: '1.2rem', textAlign: 'center', width: '150px', outline: 'none', border: '1px solid var(--line)', fontFamily: 'var(--mono)' }} 
                      />
                      <button onClick={handleUpdateMasterPin} style={{ background: 'var(--ink)', color: '#fff', padding: '0 24px', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Update</button>
                  </div>
              </div>

              {/* GLOBAL LOG SURVEILLANCE */}
              <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '30px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                      <h4 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500 }}>Global System Logs</h4>
                      <div style={{ display: 'flex', gap: '15px' }}>
                          <input 
                              type="text" 
                              placeholder="Filter by User..." 
                              value={logFilter.user} 
                              onChange={e => setLogFilter({...logFilter, user: e.target.value.toLowerCase()})} 
                              style={{ padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} 
                          />
                          <select 
                              value={logFilter.app} 
                              onChange={e => setLogFilter({...logFilter, app: e.target.value})} 
                              style={{ padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }}
                          >
                              <option value="ALL">ALL APPS</option>
                              <option value="HQ">HQ</option>
                              <option value="SHOP FLOOR">SHOP FLOOR</option>
                              <option value="FINISHING">FINISHING</option>
                          </select>
                      </div>
                  </div>

                  <div style={{ maxHeight: '600px', overflowY: 'auto', border: '1px solid var(--line)' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', textAlign: 'left', fontFamily: 'var(--sans)' }}>
                          <thead style={{ background: 'var(--paper)', position: 'sticky', top: 0 }}>
                              <tr>
                                  <th style={{ padding: '15px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Timestamp</th>
                                  <th style={{ padding: '15px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>App</th>
                                  <th style={{ padding: '15px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Location</th>
                                  <th style={{ padding: '15px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>User</th>
                                  <th style={{ padding: '15px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Action</th>
                              </tr>
                          </thead>
                          <tbody>
                              {systemLogs
                                  .filter(log => logFilter.app === 'ALL' || log.app === logFilter.app)
                                  .filter(log => !logFilter.user || log.u?.toLowerCase().includes(logFilter.user))
                                  .map((log, idx) => (
                                      <tr key={idx} style={{ borderBottom: '1px solid var(--line)' }}>
                                          <td style={{ padding: '15px', color: 'var(--ink-soft)' }}>{log.t?.toDate ? log.t.toDate().toLocaleString() : '-'}</td>
                                          <td style={{ padding: '15px', fontWeight: 500, color: 'var(--ink)' }}>{log.app}</td>
                                          <td style={{ padding: '15px' }}><span style={{ background: 'var(--paper-2)', border: '1px solid var(--line)', padding: '4px 8px', fontSize: '0.8rem', color: 'var(--ink)' }}>{log.cat || log.tab || 'system'}</span></td>
                                          <td style={{ padding: '15px', color: 'var(--ink)' }}>{log.u || log.user || 'Unknown'}</td>
                                          <td style={{ padding: '15px', color: 'var(--ink-soft)' }}>{log.msg || log.action}</td>
                                      </tr>
                              ))}
                              {systemLogs.length === 0 && <tr><td colSpan="5" style={{ padding: '30px', textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No logs found.</td></tr>}
                          </tbody>
                      </table>
                  </div>
              </div>
            </div>
          )}

        </div>
      </div>

      {zoomImg && (
        <div onClick={() => setZoomImg(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,18,15,0.75)', zIndex: 11000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', cursor: 'zoom-out' }}>
          <img src={zoomImg.url} alt={zoomImg.label} style={{ maxWidth: '70vw', maxHeight: '75vh', objectFit: 'contain', background: '#fff', border: '1px solid var(--line)', padding: '12px' }} />
          <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: '#fff', letterSpacing: '.05em' }}>{zoomImg.label} · click anywhere to close</div>
        </div>
      )}
    </div>
  );
};

// Reusable UI Components for the Admin Tab
const AdminNavButton = ({ active, onClick, label, icon }) => (
    <button 
        onClick={onClick} 
        style={{ 
            padding: '16px 20px', textAlign: 'left', cursor: 'pointer', border: 'none', display: 'flex', alignItems: 'center', gap: '12px',
            background: active ? 'var(--paper)' : 'transparent',
            borderLeft: active ? '2px solid var(--brass)' : '2px solid transparent',
            borderBottom: '1px solid var(--line)',
            color: active ? 'var(--ink)' : 'var(--ink-soft)',
            fontFamily: 'var(--sans)', fontSize: '0.95rem', transition: 'all 0.2s ease'
        }}
    >
        <span style={{ fontSize: '1.1rem', opacity: active ? 1 : 0.6 }}>{icon}</span>
        {label}
    </button>
);

export default AdminTab;