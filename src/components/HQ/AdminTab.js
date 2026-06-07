import React, { useState, useEffect } from 'react';
import { db, storage } from '../../firebase';
import { collection, onSnapshot, doc, setDoc, deleteDoc, getDocs, query, where, updateDoc, orderBy, limit } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

const AdminTab = ({ currentUser, activeBrand, perms, setPerms, TABS }) => {
  // Changed default tab since NETSUITE_SYNC is gone
  const [activeSection, setActiveSection] = useState("CPQ_FLOWS"); 
  
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

  // --- SUPER ADMIN STATE ---
  const [systemLogs, setSystemLogs] = useState([]);
  const [logFilter, setLogFilter] = useState({ app: 'ALL', user: '' });
  const [newMasterPin, setNewMasterPin] = useState("");

  const DOCUMENT_TYPES = ['QUOTE', 'SALES_ORDER', 'WORK_ORDER', 'PACKING_SLIP', 'INVOICE', 'FACTORY_ROUTER'];
  const BRANDS_LIST = ['m2c', 'uniquity', 'ce', 'leyla']; 

  const currentActiveUser = users.find(u => u.name === currentUser);
  const isSuperAdmin = currentUser === "Master Admin" || currentActiveUser?.role === "superadmin" || currentActiveUser?.superAdmin === true;

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
      const promptStr = window.prompt(`Type "DELETE ALL JOBS" to confirm wiping ${activeBrand.toUpperCase()} jobs:`);
      if (promptStr === "DELETE ALL JOBS") {
          try {
              const jobsSnap = await getDocs(query(collection(db, "jobs"), where("brandId", "==", activeBrand)));
              const draftsSnap = await getDocs(query(collection(db, "cpq_drafts"), where("brandId", "==", activeBrand)));
              await Promise.all([...jobsSnap.docs.map(d => deleteDoc(doc(db, "jobs", d.id))), ...draftsSnap.docs.map(d => deleteDoc(doc(db, "cpq_drafts", d.id)))]);
              alert(`✅ ALL ${activeBrand.toUpperCase()} PIPELINE JOBS AND DRAFTS HAVE BEEN NUKED.`);
          } catch(e) { console.error(e); }
      }
  };

  const handleNukeAssemblies = async () => { 
      const promptStr = window.prompt(`Type "DELETE ALL ASSEMBLIES" to confirm wiping ${activeBrand.toUpperCase()} assemblies:`); 
      if (promptStr === "DELETE ALL ASSEMBLIES") {
          try {
              const snap = await getDocs(query(collection(db, "Approved_Designs"), where("partClass", "in", ["Assembly", "Master Assembly"]), where("brandId", "==", activeBrand)));
              await Promise.all(snap.docs.map(d => deleteDoc(doc(db, "Approved_Designs", d.id))));
              alert(`✅ ALL ${activeBrand.toUpperCase()} ASSEMBLIES NUKED.`);
          } catch(e) { console.error(e); }
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
                            <div style={{ background: 'var(--paper-2)', border: '1px solid var(--line)', padding: '24px', marginBottom: '30px', borderRadius: '2px' }}>
                                <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: '15px', marginBottom: '20px' }}>
                                    <h4 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500 }}>File Cabinet Link (Master Assembly)</h4>
                                </div>
                                
                                <div style={{ marginBottom: '20px' }}>
                                    <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Link to Master Assembly</label>
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
                                
                                <div style={{ display: 'flex', gap: '15px', marginTop: '24px' }}>
                                    <button onClick={handleSaveFlowSettings} style={{ flex: 2, padding: '12px 24px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                                        {isSavingFlowSettings ? "Syncing..." : "Save and Cascade to Master"}
                                    </button>
                                    <button onClick={handleDeleteFlow} style={{ flex: 1, padding: '12px 24px', background: 'transparent', color: '#d9534f', border: '1px solid #d9534f', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }} onMouseOver={e => { e.currentTarget.style.background = '#d9534f'; e.currentTarget.style.color = '#fff'; }} onMouseOut={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#d9534f'; }}>
                                        Delete Flow
                                    </button>
                                </div>
                            </div>

                            <h3 style={{ margin: '0 0 20px 0', fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, borderBottom: '1px solid var(--line)', paddingBottom: '15px' }}>Configure Steps</h3>
                            
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
                                <h4 style={{ margin: '0 0 20px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: newStep.id ? 'var(--brass)' : 'var(--ink)' }}>
                                    {newStep.id ? "Edit Step" : "Manual Step Builder"}
                                </h4>
                                
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                    <input value={newStep.title} onChange={e => setNewStep({...newStep, title: e.target.value})} placeholder="Step Title (e.g. Select Bracket Style)" style={{ padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} />
                                    
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                                        <select value={newStep.type} onChange={e => setNewStep({...newStep, type: e.target.value, dataSource: e.target.value === 'STATIC_FEE' ? '' : newStep.dataSource})} style={{ padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }}>
                                            <option value="DROPDOWN">Dropdown List</option>
                                            <option value="VISUAL_GRID">Visual Grid (Images/Textures)</option>
                                            <option value="VISUAL_DIMENSIONS">Visual Grid + Dimensions</option>
                                            <option value="DIMENSIONS">Dimensional Input Only</option>
                                            <option value="STATIC_FEE">Static Fee / Quantity</option>
                                        </select>
                                        
                                        <select value={newStep.dataSource} onChange={e => setNewStep({...newStep, dataSource: e.target.value, allowedOptions: []})} disabled={newStep.type === 'DIMENSIONS' || newStep.type === 'STATIC_FEE'} style={{ padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', opacity: (newStep.type === 'DIMENSIONS' || newStep.type === 'STATIC_FEE') ? 0.5 : 1 }}>
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

                                    <div style={{ background: '#fff', padding: '20px', border: '1px solid var(--line)', marginTop: '10px' }}>
                                        <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '10px' }}>Part Handling & Routing</label>
                                        <select value={newStep.partHandling || ''} onChange={e => setNewStep({...newStep, partHandling: e.target.value})} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }}>
                                            <option value="">-- SELECT ROUTING --</option>
                                            {(globalLists.partHandling || ['Small Parts', 'Custom']).map(ph => (
                                                <option key={ph} value={ph}>{ph}</option>
                                            ))}
                                        </select>
                                    </div>

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
                                        <button onClick={() => handleAddStepToFlow(activeFlow)} disabled={(newStep.type !== 'DIMENSIONS' && newStep.type !== 'STATIC_FEE') && !newStep.dataSource} style={{ flex: 1, padding: '15px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: ((newStep.type === 'DIMENSIONS' || newStep.type === 'STATIC_FEE') || newStep.dataSource) ? 'pointer' : 'not-allowed', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', opacity: ((newStep.type === 'DIMENSIONS' || newStep.type === 'STATIC_FEE') || newStep.dataSource) ? 1 : 0.5 }}>
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

          {/* --- USERS VIEW --- */}
          {activeSection === "USERS" && (
            <div style={{ padding: '40px', maxWidth: '1000px' }}>
              <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: '15px', marginBottom: '30px' }}>
                <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500 }}>User Directory & Access Matrix</h3>
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
              
              <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '30px', marginBottom: '30px', overflowX: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                <h4 style={{ margin: '0 0 20px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500 }}>Permissions Matrix</h4>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontFamily: 'var(--sans)' }}>
                  <thead style={{ background: 'var(--paper)', borderBottom: '1px solid var(--line)' }}>
                      <tr>
                          <th style={{ padding: '15px', textAlign: 'left', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Tab</th>
                          {dynamicRoles.map(r => (<th key={r} style={{ padding: '15px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{r.replace(/_/g, ' ')}</th>))}
                      </tr>
                  </thead>
                  <tbody>
                    {TABS.map(tab => (
                      <tr key={tab} style={{ borderBottom: '1px solid var(--line)' }}>
                          <td style={{ padding: '15px', textAlign: 'left', color: 'var(--ink)' }}>{tab}</td>
                          {dynamicRoles.map(role => (
                              <td key={role} style={{ padding: '15px' }}>
                                  <input type="checkbox" checked={perms[role]?.includes(tab) || false} onChange={() => handlePermToggle(role, tab)} style={{ cursor: 'pointer' }} />
                              </td>
                          ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button onClick={handleSavePermissions} style={{ width: '100%', padding: '16px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', marginTop: '24px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Save Matrix Configuration</button>
              </div>

              <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '30px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                <h4 style={{ margin: '0 0 20px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500 }}>User Directory</h4>
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
                <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500 }}>Master Analytics & Surveillance</h3>
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