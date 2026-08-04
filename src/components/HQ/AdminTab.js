import React, { useState, useEffect, useRef } from 'react';
import { traverseEnds, offeredChoices, traverseRoleOf, dedupeByPart, isRider, needsSetupStep, setupsOffered } from '../Shared/traverseTags';
import { db, storage, functions } from '../../firebase';
import { httpsCallable } from "firebase/functions";
import { collection, onSnapshot, doc, setDoc, deleteDoc, getDocs, query, where, updateDoc, orderBy, limit, writeBatch } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import FormPreview from '../Shared/FormPreview';
import { PICK_TABS, pickTabLabel } from '../Shared/pickTabs';
import { printForm } from '../Shared/printForm';
import { sizeFamilyOfParts, buildSizeSteps, SIZE_STEP_TYPE, SIZE_FAMILIES, sizeKeyOf } from '../Shared/sizeMatrix';
import { nsProxyFetch } from "../Shared/nsProxy";

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


// Roles treated as OFFICE (not floor). Kept OUT of fin_users so they don't clutter the finishing/chip
// employee selections. Everything else (operator, painter, finisher, *_manager, custom floor roles…) is
// floor and DOES mirror to fin_users so its PIN works for chip start/stop.
const OFFICE_ROLES = ['superadmin', 'admin', 'executive', 'design_team', 'sales_rep', 'programmer'];
// Bulk-purge targets: unambiguously-office roles safe to strip from fin_users (never a floor worker). Omits
// 'admin' since a finishing supervisor could plausibly carry it — remove those one-by-one instead.
const PURGEABLE_OFFICE_ROLES = ['superadmin', 'executive', 'design_team', 'sales_rep', 'programmer'];

// NetSuite plumbing (mirror of ERPPushPullTab) for creating a flow's rollup item.
const BRAND_NETSUITE_MAP = {
    'm2c': { subsidiary: "3", location: "19" },
    'uniquity': { subsidiary: "6", location: "20" },
    'ce': { subsidiary: "2", location: "17" },
    'leyla': { subsidiary: "5", location: "18" }
};
const NS_REST_BASE = "https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1";
const NS_SUITEQL_URL = "https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql";
// Income account every rollup (non-inventory sale) item posts to: 4001 SALES-HOUSE, acctid 249.
const NS_ROLLUP_INCOME_ACCT = "249";
// Tax schedule for rollup items: "No Taxable", NetSuite id 2.
const NS_ROLLUP_TAX_SCHEDULE = "2";

// Code-grammar rules for size families whose sizeKeys stamp by RULE (no importer needed):
// dia tokens are LONGEST-FIRST so H2-138… never parses as dia '1'. Style = the remainder,
// which is identical across sizes by the naming convention (H2-05BE / H2-75BE / … all 'BE').
// rx = the registry's codeRx — ONE grammar: sizeMatrix parses the same rx into VIRTUAL sizeKeys
// for items created after a stamp run, so the stamper and the runtime gate can never drift.
const SIZE_STAMP_RULES = {
    'H2-RND': { rx: SIZE_FAMILIES['H2-RND'].codeRx, note: 'H2-<dia><style> · dia 05 / 75 / 1 / 138 · Simple Elegance' },
};

const AdminTab = ({ currentUser, activeBrand, TABS }) => {
    // ===== 🧬 SIZE-FAMILY STAMPER (Stuart 2026-07-22) =====
    // Stamps manufacturingSpecs.customData.sizeKey onto every item matching the family's code
    // grammar — the ONLY missing piece for combining sibling assemblies (H2-05/75/1/138) into
    // ONE flow: once stamped, generating from the ¾" master auto-injects the Rod Diameter +
    // Projection steps (line ~935) and every option resolves to the selected diameter's item.
    const [stampFam, setStampFam] = useState('H2-RND');
    const [stampBusy, setStampBusy] = useState(false);
    const [stampPreview, setStampPreview] = useState(null);
    const scanSizeStamps = async () => {
        const rule = SIZE_STAMP_RULES[stampFam];
        if (!rule) return;
        setStampBusy(true);
        try {
            // The tab already holds a live snapshot of the whole collection — scan in memory,
            // zero network. (Fallback fetch only if the section is opened before the load lands.)
            let pool = allApprovedDesigns;
            if (!pool || !pool.length) {
                const snap = await getDocs(collection(db, 'Approved_Designs'));
                pool = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            }
            const parts = pool
                .filter(x => !activeBrand || x.brandId === activeBrand || (Array.isArray(x.sharedBrands) && x.sharedBrands.includes(activeBrand)));
            const famPrefix = stampFam.split('-')[0]; // 'H2' — near-miss diagnostics
            const rows = []; const byDia = {}; const nearMiss = []; let already = 0;
            parts.forEach(p => {
                const code = String((p.legacyErpId && p.legacyErpId !== 'PENDING' ? p.legacyErpId : p.itemId) || '').trim().toUpperCase();
                if (!code || code.includes('/')) return; // finish variants never carry sizeKeys
                const m = code.match(rule.rx);
                if (!m) {
                    // Anything that LOOKS family-ish but doesn't parse gets surfaced — this is how a
                    // code-shape mismatch (space, missing dash, different prefix) names itself.
                    if (code.startsWith(famPrefix) && nearMiss.length < 15) nearMiss.push(code);
                    return;
                }
                const dia = m[1], style = m[2];
                const sk = p.manufacturingSpecs?.customData?.sizeKey;
                if (sk && sk.family === stampFam && sk.dia === dia && sk.style === style) { already++; return; }
                rows.push({ id: p.id, code, dia, style });
                byDia[dia] = (byDia[dia] || 0) + 1;
            });
            setStampPreview({ rows, byDia, already, nearMiss, scanned: parts.length });
            // Belt & suspenders: the result also announces itself — a quiet inline line was missed once.
            alert(`🧬 Scan complete\n\nScanned ${parts.length} item(s) in this brand\nMatched ${rows.length + already} · new to stamp ${rows.length}${already ? ` · already stamped ${already}` : ''}${rows.length ? `\n${Object.entries(byDia).map(([d, n]) => `dia ${d}: ${n}`).join(' · ')}\n\nHit ✓ Stamp in the panel to apply.` : ''}${(!rows.length && !already) ? `\n\n⚠ 0 items matched the ${stampFam} grammar.` : ''}${nearMiss.length ? `\n\nNear-misses (family prefix, wrong shape):\n${nearMiss.join(', ')}` : ''}`);
        } catch (e) { alert('Scan failed: ' + (e.message || e)); }
        finally { setStampBusy(false); }
    };
    const applySizeStamps = async () => {
        if (!stampPreview || !stampPreview.rows.length) return;
        if (!window.confirm(`🧬 Stamp ${stampFam} size keys onto ${stampPreview.rows.length} item(s)?\n\n${Object.entries(stampPreview.byDia).map(([d, n]) => `dia ${d}: ${n}`).join(' · ')}${stampPreview.already ? `\n(${stampPreview.already} already stamped — skipped)` : ''}\n\nThis is what lets ONE flow cover every diameter. Afterwards: generate the flow from the ¾" master assembly.`)) return;
        setStampBusy(true);
        try {
            let n = 0;
            for (const r of stampPreview.rows) {
                await updateDoc(doc(db, 'Approved_Designs', r.id), { 'manufacturingSpecs.customData.sizeKey': { family: stampFam, dia: r.dia, style: r.style, projLetter: '' } });
                n++;
            }
            alert(`✅ Stamped ${n} item(s) with ${stampFam} size keys.\n\nNOW: pick the ¾" master (H2-75) under "assembly to generate from" and Generate — the Rod Diameter + Projection steps inject automatically, options native to one size scope to it, and missing size variants fall back to the base item.`);
            setStampPreview(null);
        } catch (e) { alert('Stamping failed: ' + (e.message || e)); }
        finally { setStampBusy(false); }
    };
    // ===== END SIZE-FAMILY STAMPER =====
  const [activeSection, setActiveSection] = useState("CPQ_FLOWS"); 
  
  const [users, setUsers] = useState([]);
  const [finUsers, setFinUsers] = useState([]); // legacy Finishing-floor directory (fin_users) — merged in for visibility + import
  const [staffLogins, setStaffLogins] = useState([]); // OuterGate daily sign-in accounts (staff_logins mirror)

  const [dynamicRoles, setDynamicRoles] = useState(['admin', 'executive', 'design_team', 'sales_rep', 'operator', 'programmer', 'floor_manager', 'paint_manager']);
  
  // ADDED STATE FOR FLOOR PERMISSIONS
  // hqPerms is loaded LIVE from hq_config/permissions (not the `perms` prop). The prop is a login-time
  // shortcut — a master-PIN (1032) login sets it to just { admin: TABS }, so saving that back would blank
  // every other role's HQ tabs. Editing the real doc directly avoids that data loss.
  const [hqPerms, setHqPerms] = useState({});
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
  const [linkItemSearch, setLinkItemSearch] = useState(""); // CPQ step "Link to Library Item" search box
  const [generateAsmId, setGenerateAsmId] = useState(""); // assembly the "Generate Flow from Tags" button reads
  const [genSingleAsm, setGenSingleAsm] = useState(false); // 🎯 single-assembly mode: this assembly's tags only — no union/review/SIZE steps
  const [genBayConfig, setGenBayConfig] = useState("STRAIGHT"); // bay configuration the generated flow is stamped with (drives fabShape + the pole calculatorTemplate so Vision Hardware math matches)
  const [flowSettings, setFlowSettings] = useState({ name: '', legacyErpId: '', basePrice: '', linkedAssemblyId: '', nsRollupItemId: '', nsRollupItemName: '', fabEndStyle: '', fabProjection: '', fabShape: '', defaultFinishOptions: [], hiddenClusters: [] });
  const [isSavingFlowSettings, setIsSavingFlowSettings] = useState(false);
  const [zoomImg, setZoomImg] = useState(null);   // {url,label} for the cluster-image lightbox
  // 🔍 Generate-time REVIEW GATE payload — non-null renders the review modal, whose buttons call
  // payload.resolve(...) to resume the generator awaiting inside handleGenerateHardwareFlow.
  const [flowReview, setFlowReview] = useState(null);
  const [isCreatingRollup, setIsCreatingRollup] = useState(false);


  const [customSchema, setCustomSchema] = useState([]);
  const [cpqRules, setCpqRules] = useState([]);
  const [newRule, setNewRule] = useState({ name: '', conditionField: '', conditionOp: 'EQUALS', conditionVal: '', effectField: '', effectVal: '' });

  const [brandLogos, setBrandLogos] = useState({});
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [formTemplates, setFormTemplates] = useState({});
  const [activeFormType, setActiveFormType] = useState('QUOTE');
  const [formEditor, setFormEditor] = useState({ header: '', footer: '', terms: '' });
  const [previewBrand, setPreviewBrand] = useState(activeBrand || 'ce'); // brand whose logo the form preview shows
  const [previewDocNum, setPreviewDocNum] = useState('SO10293');         // sample doc/SO number for the preview barcode

  const [systemLogs, setSystemLogs] = useState([]);
  const [logFilter, setLogFilter] = useState({ app: 'ALL', user: '' });
  const [newMasterPin, setNewMasterPin] = useState("");

  const DOCUMENT_TYPES = ['QUOTE', 'SALES_ORDER', 'WORK_ORDER', 'PACKING_SLIP', 'INVOICE', 'FACTORY_ROUTER'];
  const BRANDS_LIST = ['m2c', 'uniquity', 'ce', 'leyla']; 

  const currentActiveUser = users.find(u => u.name === currentUser);
  const isSuperAdmin = currentActiveUser?.role === "superadmin" || currentActiveUser?.superAdmin === true;

  // Roles the permission matrices + user dropdown expose. The managed list (dynamicRoles) UNION every
  // role actually assigned to a user (hq_users + legacy fin_users) — lowercased to match how PickPack /
  // ShopFloor / Finishing look up perms (role.toLowerCase()). Without this, a finishing role like
  // "painter" has no column, so CHIPS (and other tabs) can never be granted to it.
  const roleKey = (r) => String(r || '').toLowerCase().trim();
  const allRoles = Array.from(new Set([
    ...dynamicRoles.map(roleKey),
    ...users.map(u => roleKey(u.role)),
    ...finUsers.map(u => roleKey(u.role)),
  ])).filter(r => r && r !== 'superadmin').sort();

  useEffect(() => {
      const unsubUsers = onSnapshot(collection(db, "hq_users"), (snap) => setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
      const unsubFinUsers = onSnapshot(collection(db, "fin_users"), (snap) => setFinUsers(snap.docs.map(d => ({ id: d.id, ...d.data() }))), () => { });
      // Daily sign-in accounts (OuterGate). Server-written mirror of Firebase Auth; admin-read.
      const unsubStaffLogins = onSnapshot(collection(db, "staff_logins"), (snap) => setStaffLogins(snap.docs.map(d => ({ id: d.id, ...d.data() }))), () => { });
      const unsubRoles = onSnapshot(doc(db, "hq_config", "roles"), (docSnap) => { if (docSnap.exists() && docSnap.data().list) setDynamicRoles(docSnap.data().list); });
      const unsubHqPerms = onSnapshot(doc(db, "hq_config", "permissions"), (docSnap) => { if (docSnap.exists()) setHqPerms(docSnap.data()); });
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

      return () => { unsubUsers(); unsubFinUsers(); unsubStaffLogins(); unsubRoles(); unsubHqPerms(); unsubSchema(); unsubRules(); unsubFlows(); unsubLists(); unsubPlatingFees(); unsubDiscounts(); unsubAssemblies(); unsubWindowConfig(); unsubFinishes(); unsubOutsource(); unsubColGlobal(); unsubInhouse(); unsubFloor(); unsubDynamic(); unsubLogos(); unsubForms(); unsubShopPerms(); unsubFinPerms(); unsubPickPerms(); };
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
      const rolePerms = hqPerms[role] || [];
      setHqPerms({ ...hqPerms, [role]: rolePerms.includes(tab) ? rolePerms.filter(t => t !== tab) : [...rolePerms, tab] });
  };
  const handleShopPermToggle = (role, tab) => {
      const rolePerms = shopPerms[role] || [];
      setShopPerms({ ...shopPerms, [role]: rolePerms.includes(tab) ? rolePerms.filter(t => t !== tab) : [...rolePerms, tab] });
  };
  const handleFinPermToggle = (role, tab) => {
      const rolePerms = finPerms[role] || [];
      setFinPerms({ ...finPerms, [role]: rolePerms.includes(tab) ? rolePerms.filter(t => t !== tab) : [...rolePerms, tab] });
  };
  // Force-scan roles (warehouse): when a role is on this list, the click-to-pick bin chips are hidden
  // in Pick & Pack — that operator must scan the bin. Stored on the same pick_config/permissions doc.
  const handleForceScanToggle = (role) => {
      const cur = pickPerms.forceScanRoles || [];
      setPickPerms({ ...pickPerms, forceScanRoles: cur.includes(role) ? cur.filter(r => r !== role) : [...cur, role] });
  };
  // Roles that can see the management-only chip reports (per-step timers + who-did-what roll-up).
  const handleChipReportToggle = (role) => {
      const cur = pickPerms.chipReportRoles || [];
      setPickPerms({ ...pickPerms, chipReportRoles: cur.includes(role) ? cur.filter(r => r !== role) : [...cur, role] });
  };
  const handlePickPermToggle = (role, tab) => {
      const rolePerms = pickPerms[role] || [];
      setPickPerms({ ...pickPerms, [role]: rolePerms.includes(tab) ? rolePerms.filter(t => t !== tab) : [...rolePerms, tab] });
  };

  // 🚀 MASS SAVE TO ALL DATABASES
  const handleSavePermissions = async () => { 
      try {
          // Guard: never overwrite the HQ matrix with an empty object (would blank every role's tabs). If
          // the live doc hasn't loaded into hqPerms yet, skip the HQ write rather than wipe it.
          if (hqPerms && Object.keys(hqPerms).length) await setDoc(doc(db, "hq_config", "permissions"), hqPerms);
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
      const effRole = wasSuperAdmin ? (existing.role || 'superadmin') : adminForm.uRole;
      // PIN changed → drop the OLD doc from BOTH directories
      if (adminForm.oldId && adminForm.oldId !== adminForm.uPin) {
          await deleteDoc(doc(db, "hq_users", adminForm.oldId));
          await deleteDoc(doc(db, "fin_users", adminForm.oldId)).catch(() => { });
      }
      await setDoc(doc(db, "hq_users", adminForm.uPin), {
          ...existing,
          name: adminForm.uName,
          pin: adminForm.uPin,
          role: effRole,
          ...(wasSuperAdmin ? { superAdmin: true } : {}),
      });
      // Mirror to fin_users (chip start/stop PINs + finishing dropdowns) ONLY for floor/finishing roles.
      // Office roles are kept out — and actively removed if a floor→office change happened — so they don't
      // clutter the floor employee selections.
      if (OFFICE_ROLES.includes(roleKey(effRole))) {
          await deleteDoc(doc(db, "fin_users", adminForm.uPin)).catch(() => { });
      } else {
          await setDoc(doc(db, "fin_users", adminForm.uPin), { name: adminForm.uName, pin: adminForm.uPin, role: effRole }, { merge: true }).catch(() => { });
      }
      setAdminForm({ uName: '', uPin: '', uRole: dynamicRoles[0] || 'operator', oldId: '' });
  };
  // Terminate removes the person from BOTH directories, so a deleted duplicate can't linger as a chip PIN.
  const handleDeleteUser = async (u) => { if(!window.confirm(`Terminate ${u.name}? This removes them from HQ and the finishing (chip PIN) directory.`)) return; const key = String(u.pin || u.id); await deleteDoc(doc(db, "hq_users", u.id)); await deleteDoc(doc(db, "fin_users", key)).catch(() => { }); };

  // ===== DAILY SIGN-IN ACCOUNTS (OUTER GATE) — Stuart 2026-07-25 =====
  // Every person needs TWO identities: this email/password account (the once-a-day gate in front of
  // everything) and their PIN row below (role + permissions). The email side used to be hand-made in
  // the Firebase console because creating an Auth user needs the Admin SDK; these buttons call the
  // createStaffLogin & co. callables instead. A new hire is now: create the login here → send them
  // the setup link → add their PIN row below. Accounts made in the console still work — "Find
  // console-made accounts" adopts them so they can be managed here too.
  const ALLOWED_LOGIN_DOMAINS = ['classicalelements.com', 'm2cstudio.com', 'uniquitystyle.com', 'leylagans.com', 'thelab-hp.com'];
  const [loginForm, setLoginForm] = useState({ email: '', name: '', pin: '', external: false, expires: '' });
  const [loginBusy, setLoginBusy] = useState('');
  const [inviteLink, setInviteLink] = useState(null); // { email, link } shown until dismissed
  const [unlinkedLogins, setUnlinkedLogins] = useState(null); // null = not scanned yet

  const callLogin = async (fn, payload) => {
      const res = await httpsCallable(functions, fn)(payload || {});
      return res.data || {};
  };
  const copyInvite = async (link) => {
      try { await navigator.clipboard.writeText(link); alert('Setup link copied — send it to them. It lets them set their own password.'); }
      catch (e) { window.prompt('Copy the setup link:', link); }
  };
  const handleCreateLogin = async () => {
      const mail = loginForm.email.trim().toLowerCase();
      if (!mail) return alert('Email is required.');
      const dom = mail.split('@')[1] || '';
      // Off-domain is allowed ONLY as an explicit outside-collaborator grant — per address, never
      // per domain (adding "gmail.com" to the company list would admit the whole provider).
      if (!ALLOWED_LOGIN_DOMAINS.includes(dom) && !loginForm.external) {
          return alert(`"${dom}" is not a company domain.\n\nTick "Outside collaborator" to grant this ONE address access, or use a company email.\n\nCompany domains: ${ALLOWED_LOGIN_DOMAINS.join(', ')}`);
      }
      const expMs = loginForm.expires ? new Date(`${loginForm.expires}T23:59:59`).getTime() : null;
      if (loginForm.external && !window.confirm(
          `Grant OUTSIDE ACCESS to ${mail}?\n\n` +
          `This one address can sign in like staff. What they can DO is set by the PIN + role you give them below — but note any staff PIN can read and write the core data collections, so give them a limited role and remove access when the engagement ends.\n\n` +
          (expMs ? `Access auto-expires after ${loginForm.expires}.` : 'No expiry date set — access lasts until you revoke it.'))) return;
      setLoginBusy('create');
      try {
          const d = await callLogin('createStaffLogin', { email: mail, name: loginForm.name, pin: loginForm.pin, external: !!loginForm.external, expiresAt: expMs });
          setInviteLink({ email: mail, link: d.setupLink });
          if (d.setupLink) copyInvite(d.setupLink);
          setLoginForm({ email: '', name: '', pin: '', external: false, expires: '' });
          if (d.adopted) alert(`${mail} already existed in Firebase — it is now linked here and manageable from this panel.`);
      } catch (e) { alert(e.message || String(e)); }
      finally { setLoginBusy(''); }
  };
  // Extend / revoke an outside grant without deleting the account.
  const handleAccessChange = async (l, mode) => {
      if (mode === 'revoke' && !window.confirm(`Revoke outside access for ${l.email}?\n\nTheir next sign-in attempt is refused at the PIN step. The account stays (re-grant any time).`)) return;
      let expMs;
      if (mode === 'extend') {
          const d = window.prompt('New expiry date (YYYY-MM-DD) — leave blank for no expiry:', l.expiresAt ? new Date(l.expiresAt).toISOString().slice(0, 10) : '');
          if (d === null) return;
          expMs = d.trim() ? new Date(`${d.trim()}T23:59:59`).getTime() : null;
          if (expMs !== null && Number.isNaN(expMs)) return alert('That date could not be read — use YYYY-MM-DD.');
      }
      setLoginBusy(l.id);
      try {
          await callLogin('setStaffLoginAccess', mode === 'revoke' ? { uid: l.id, external: false } : { uid: l.id, expiresAt: expMs });
      } catch (e) { alert(e.message || String(e)); }
      finally { setLoginBusy(''); }
  };
  const handleReinvite = async (l) => {
      setLoginBusy(l.id);
      try { const d = await callLogin('getStaffLoginSetupLink', { uid: l.id }); if (d.setupLink) { setInviteLink({ email: l.email, link: d.setupLink }); copyInvite(d.setupLink); } }
      catch (e) { alert(e.message || String(e)); }
      finally { setLoginBusy(''); }
  };
  const handleToggleLogin = async (l) => {
      const turningOff = l.active !== false;
      if (turningOff && !window.confirm(`Disable ${l.email}?\n\nThey can no longer sign in — and because the PIN screen requires a live daily sign-in, that blocks their PIN access everywhere too.`)) return;
      setLoginBusy(l.id);
      try { await callLogin('setStaffLoginStatus', { uid: l.id, active: !turningOff }); }
      catch (e) { alert(e.message || String(e)); }
      finally { setLoginBusy(''); }
  };
  const handleDeleteLogin = async (l) => {
      if (!window.confirm(`Permanently DELETE the sign-in account ${l.email}?\n\nTheir PIN row (role + permissions) is NOT touched — remove that separately if they've left.`)) return;
      setLoginBusy(l.id);
      try { await callLogin('deleteStaffLogin', { uid: l.id }); }
      catch (e) { alert(e.message || String(e)); }
      finally { setLoginBusy(''); }
  };
  const scanUnlinked = async () => {
      setLoginBusy('scan');
      try {
          const d = await callLogin('listUnlinkedStaffLogins');
          setUnlinkedLogins(d.users || []);
          if (!(d.users || []).length) alert('✓ Every company account in Firebase is already listed here.');
      } catch (e) { alert(e.message || String(e)); }
      finally { setLoginBusy(''); }
  };
  const adoptUnlinked = async () => {
      const uids = (unlinkedLogins || []).map(u => u.uid);
      if (!uids.length) return;
      setLoginBusy('adopt');
      try {
          const d = await callLogin('adoptStaffLogins', { uids });
          alert(`✓ ${d.linked} account(s) linked — they appear in the list now. Nothing about the accounts themselves changed.`);
          setUnlinkedLogins([]);
      } catch (e) { alert(e.message || String(e)); }
      finally { setLoginBusy(''); }
  };

  // Rebuild the sanitized `directory` projection (name/role/superAdmin, no PIN) that the floor apps
  // read instead of hq_users. Ongoing edits sync automatically via the mirrorUserToDirectory trigger;
  // this button seeds/repairs existing users. Safe to re-run.
  const [syncingDir, setSyncingDir] = useState(false);
  const syncDirectory = async () => {
    setSyncingDir(true);
    try {
      const res = await httpsCallable(functions, 'backfillUserDirectory')();
      alert(`✓ Directory synced — ${res.data?.synced ?? 0} user(s) projected (names/roles only, no PINs).`);
    } catch (err) {
      console.error(err);
      alert('Directory sync failed: ' + (err.message || err));
    } finally {
      setSyncingDir(false);
    }
  };

  // Legacy Finishing-floor employees live in fin_users (chip-PIN checks + finishing dropdowns still use
  // it). HQ login / permissions read hq_users, so those users were invisible here and couldn't get into
  // WMS. Copy any fin_users PIN missing from hq_users INTO hq_users (non-destructive: fin_users kept,
  // existing hq_users untouched). Dedupe is by PIN (the hq_users doc id), so re-running is safe.
  const finToImport = finUsers.filter(f => f.pin && !new Set(users.map(u => String(u.pin))).has(String(f.pin)));
  const importFinishingUsers = async () => {
      if (!finUsers.length) return alert("No legacy fin_users found to import.");
      if (!finToImport.length) return alert(`All ${finUsers.length} finishing user(s) already exist in the HQ directory. Nothing to import.`);
      if (!window.confirm(`Import ${finToImport.length} legacy Finishing user(s) into the HQ directory?\n\n• They'll be able to log into HQ / WMS and appear here for permissions.\n• Existing users are left unchanged; fin_users is NOT deleted (chip PINs still use it).`)) return;
      try {
          for (const f of finToImport) {
              await setDoc(doc(db, "hq_users", String(f.pin)), { name: f.name || 'Finishing User', pin: String(f.pin), role: roleKey(f.role) || 'operator', importedFromFin: true }, { merge: true });
          }
          alert(`Imported ${finToImport.length} finishing user(s) into the HQ directory.\n\nTheir roles now appear as columns in the WMS permission matrix — check CHIPS (and any other tabs) for those roles to grant access.`);
      } catch (e) { alert('Import failed: ' + e.message); }
  };

  // Office users that leaked into fin_users clutter the floor employee selections. Strip the ones whose
  // role is unambiguously office (never a floor worker) — they stay in hq_users, only the finishing mirror
  // is removed.
  const finOfficeUsers = finUsers.filter(f => PURGEABLE_OFFICE_ROLES.includes(roleKey(f.role)));
  const purgeOfficeFromFin = async () => {
      if (!finOfficeUsers.length) return;
      if (!window.confirm(`Remove ${finOfficeUsers.length} office user(s) from the finishing (chip PIN) directory so they don't clutter floor selections?\n\nThey stay in HQ; only their finishing-list mirror is removed.`)) return;
      try {
          for (const f of finOfficeUsers) await deleteDoc(doc(db, "fin_users", String(f.pin || f.id))).catch(() => { });
          alert(`Removed ${finOfficeUsers.length} office user(s) from the finishing list.`);
      } catch (e) { alert('Cleanup failed: ' + e.message); }
  };

  // Per-user membership of the finishing/chip selection list (fin_users). Direct control — no role
  // guessing: check = on the floor/chip dropdowns, uncheck = removed from them (still an HQ user).
  const finPins = new Set(finUsers.map(f => String(f.pin)));
  const toggleFloorUser = async (u) => {
      const pin = String(u.pin || u.id);
      if (!pin) return;
      try {
          if (finPins.has(pin)) await deleteDoc(doc(db, "fin_users", pin));
          else await setDoc(doc(db, "fin_users", pin), { name: u.name, pin, role: roleKey(u.role) }, { merge: true });
      } catch (e) { alert('Update failed: ' + e.message); }
  };

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

  // Bay configuration the generated flow is stamped with. Each entry keeps the flow-level fabShape
  // (what Vision Hardware reads to drive its whole bay diagram/math) IN SYNC with the pole step's
  // calculatorTemplate (what the CPQ configurator renders), so the two can never disagree.
  const BAY_CONFIGS = {
      STRAIGHT:      { fabShape: 'STRAIGHT', calc: 'calc_straight_pole',     endStyle: '',            poleTitle: 'Pole Length & Finish',      qtyHelper: 'Pole length (feet)' },
      FRENCH_RETURN: { fabShape: 'STRAIGHT', calc: 'calc_french_return_1in', endStyle: 'RETURN_BEND', poleTitle: 'Pole Length & Finish',      qtyHelper: 'Finished length C2C (feet)' },
      MITERED:       { fabShape: 'MITERED',  calc: 'calc_mitered_bay',       endStyle: '',            poleTitle: 'Bay Pole — Walls & Angles', qtyHelper: 'Total run (feet)' },
      BOW:           { fabShape: 'BOW',      calc: 'calc_curved_bay',        endStyle: '',            poleTitle: 'Curved Bay Pole — Arc',     qtyHelper: 'Arc length (feet)' },
  };

  // One-click flow build from the assembly's Node-Grouping tags. Groups tagged clusters by
  // Category + part (unioning each part's placement nodes into one option), then stamps out the
  // standard hardware steps fully wired — no hand-picking pins. Creates a NEW flow; touches nothing.
  // inPlaceFlowId → rebuild STEPS on an existing flow (keeping its id + all flow-level settings +
  // per-option prices) instead of spawning a new flow. bayConfigKey overrides which bay config to
  // rebuild with (defaults to the flow's stored bayConfig, then the dropdown).
  const handleGenerateHardwareFlow = async ({ inPlaceFlowId = null, bayConfigKey = null } = {}) => {
      const oldFlow = inPlaceFlowId ? cpqFlows.find(f => f.id === inPlaceFlowId) : null;
      const bay = BAY_CONFIGS[bayConfigKey || oldFlow?.bayConfig || genBayConfig] || BAY_CONFIGS.STRAIGHT;
      const asmId = inPlaceFlowId ? oldFlow?.linkedAssemblyId : (generateAsmId || flowSettings.linkedAssemblyId);
      const asm = masterAssemblies.find(a => a.id === asmId) || allApprovedDesigns.find(a => a.id === asmId || a.itemId === asmId);
      // 🎯 SINGLE-ASSEMBLY MODE (Stuart 2026-07-24 pivot): this assembly's tags ONLY — no family
      // union, no review gate, no SIZE steps. The flow gets sizeGroup* stamps instead, and the
      // CPQ landing collapses the sibling flows into one "pick rod diameter first" entry.
      // Regenerates keep the mode from the flow doc.
      const singleMode = inPlaceFlowId ? !!oldFlow?.singleAssembly : genSingleAsm;
      let groupFields = {};
      if (singleMode && asm) {
          const codesToTry = [
              String((asm.legacyErpId && asm.legacyErpId !== 'PENDING' ? asm.legacyErpId : asm.itemId) || '').trim().toUpperCase(),
              String(asm.itemName || '').trim().toUpperCase(),
          ];
          for (const fk of Object.keys(SIZE_FAMILIES)) {
              const f = SIZE_FAMILIES[fk];
              if (!f.codeRx) continue;
              const bare = new RegExp(f.codeRx.source.replace('([A-Z].*)$', '$'));
              const m = codesToTry.map(c => c.match(bare)).find(Boolean);
              if (m) {
                  const d = f.dia.options.find(o => o.value === m[1]);
                  groupFields = { sizeGroupLabel: f.label.replace(/ Round$/i, ''), sizeGroupChoice: d?.label || m[1], sizeGroupSort: d?.inches ?? 99 };
                  break;
              }
          }
      }
      if (!asm) return alert(inPlaceFlowId
          ? "This flow has no linked assembly to regenerate from. Set its Linked Assembly in flow settings first."
          : "Pick a Master Assembly from the dropdown next to Generate, then click Generate.");
      let pins = [];
      try { const snap = await getDocs(query(collection(db, "assembly_pins"), where("assemblyId", "==", asm.itemId))); pins = snap.docs.map(d => d.data()); } catch (e) { console.warn("pin load failed", e); }
      const pinByCluster = {};
      pins.forEach(p => { if (p.clusterId) pinByCluster[p.clusterId] = p; });
      // ALL pins per cluster — Assembly-Builder clusters stack many CHOICES in one cluster, each with
      // its own pin + choiceNode; the generator fans those out into one option per choice (below).
      const pinsByCluster = {};
      pins.forEach(p => { if (p.clusterId) (pinsByCluster[p.clusterId] = pinsByCluster[p.clusterId] || []).push(p); });
      const partsById = {};
      allApprovedDesigns.forEach(p => { partsById[p.id] = p; if (p.itemId) partsById[p.itemId] = p; if (p.legacyErpId) partsById[p.legacyErpId] = p; });
      const classifyCat = (pt) => { const t = String(pt || '').toUpperCase(); if (t.includes('BACKPLATE') || t.includes('BACK PLATE')) return 'BACKPLATE'; if (t.includes('BRACKET')) return 'BRACKET'; if (t.includes('FINIAL')) return 'FINIAL'; if (t.includes('RING')) return 'RING'; if (t.includes('POLE') || t.includes('ROD')) return 'POLE'; return ''; };
      // Category from the cluster tag, falling back to the pin's part product type (so clusters
      // tagged only with Location/Position still classify).
      const catOf = (cl) => { if (cl.category) return String(cl.category).toUpperCase(); const pin = pinByCluster[cl.id]; const part = pin && partsById[pin.partId]; return classifyCat(part?.manufacturingSpecs?.productType || part?.productType); };
      // HIDDEN clusters (e.g. bushings) are BOM-only accessories: never a customer choice/step, but
      // auto-included in the BOM when their position is used. Pull them out of the step-building set and
      // index their part by position → attached to that position's first step as includedParts.
      const hiddenByPos = {};
      (asm.nodeClusters || []).filter(c => c.hidden).forEach(cl => {
          const pin = pinByCluster[cl.id];
          const partId = pin?.partId;
          if (!partId) return; // needs a BOM pin (item #) to include anything
          const key = (cl.position || '').toUpperCase();
          (hiddenByPos[key] = hiddenByPos[key] || []).push({ partId, partName: pin?.partName || cl.name, qty: parseInt(pin?.defaultQty) || 1 });
      });
      // Hidden CHOICES that carry a REAL item # (fasteners/standoffs the designer stacked inside a
      // choosable cluster and hid in 1.6): same BOM-only semantics as hidden clusters — never an
      // option, geometry force-hidden, but INCLUDED in the BOM at their cluster's position. Synthetic
      // HIDDEN-… ids (pure stray-geometry hides with no item #) still contribute nothing.
      (asm.nodeClusters || []).filter(c => !c.hidden).forEach(cl => {
          (pinsByCluster[cl.id] || []).filter(p => p.isHiddenPart && p.partId && !String(p.partId).startsWith('HIDDEN-')).forEach(pin => {
              const key = (cl.position || '').toUpperCase();
              (hiddenByPos[key] = hiddenByPos[key] || []).push({ partId: pin.partId, partName: pin.partName || cl.name, qty: parseInt(pin.defaultQty) || 1 });
          });
      });
      const posGotHidden = new Set();
      const takeIncluded = (pos) => { const k = (pos || '').toUpperCase(); if (posGotHidden.has(k) || !(hiddenByPos[k] || []).length) return null; posGotHidden.add(k); return hiddenByPos[k]; };

      const clusters = (asm.nodeClusters || []).filter(c => catOf(c) && !c.hidden);
      if (!clusters.length) return alert("No usable clusters — none have a Category tag or a classifiable part. Tag them in Node Grouping first (or set the parts' Product Type).");

      // 🔍 Review provenance: which SOURCE assembly each cluster's options came from — master
      // clusters stamped here, union clones stamped as they're pushed (below). The review modal
      // groups its checklist by this label, so Stuart sees exactly what each sibling contributed.
      const masterSrcLabel = `${asm.itemName || asm.itemId} (master)`;
      const srcByCluster = {};
      clusters.forEach(cl => { srcByCluster[cl.id] = masterSrcLabel; });

      // 🧬 FAMILY UNION (Stuart 2026-07-24: "this finial in the .05 is not being shown") — the
      // combined flow offers what's pinned on ANY sibling assembly of the master's size family,
      // not just the master's own pins. A style existing only at one diameter (H2-05FDB) joins
      // as its OWN option: native to its dia, partAllowedAtSize hides it at the others, and
      // sizeVariantOf still swaps per-dia where siblings exist. Styles the master already
      // carries are SKIPPED — master options own the render geometry. Sibling-only options have
      // no nodes in the master GLB: they price/BOM correctly; the render shows that end without
      // the mesh until the designer adds the shape to the master file. Families without a
      // codeRx (Fabricut H1) never union — those flows are byte-identical to before.
      // STYLE-KEYED per-diameter tag map — filled by the union pass from EVERY family pin
      // (master + siblings, including deduped duplicates: a deduped H2-05LB still contributes
      // its .75 proj tag under dia '05'), read back at option emission as projByDia/mountByDia.
      const tagsByStyle = {};
      const styleKeyFor = (partId, partName, pos, cat) => {
          const sk = sizeKeyOf(partsById[partId]) || sizeKeyOf({ legacyErpId: partId });
          return `${sk ? `S:${sk.style}` : `P:${String(partId || partName || '').toUpperCase()}`}|${pos}|${cat}`;
      };
      const unionReport = [];
      // Family identity is needed OUTSIDE the union try too: the review gate below opens for every
      // codeRx family even when the union pass itself failed, so the ⚠ FAILED line lands inside
      // the modal instead of a lost alert. (sizeFamilyOfParts is pure — nothing here can throw.)
      const famKey = singleMode ? null : sizeFamilyOfParts(pins.map(p => partsById[p.partId]).filter(Boolean));
      const fam = famKey ? SIZE_FAMILIES[famKey] : null;
      try {
          const bareRx = fam?.codeRx ? new RegExp(fam.codeRx.source.replace('([A-Z].*)$', '$')) : null;
          if (bareRx) {
              // Assemblies may carry their family code in legacyErpId, itemId OR just itemName
              // (1.6-built assemblies often have PENDING erp ids) — accept any of the three.
              const codeU = (d) => String((d?.legacyErpId && d.legacyErpId !== 'PENDING' ? d.legacyErpId : d?.itemId) || '').trim().toUpperCase();
              const asmMatches = (a) => bareRx.test(codeU(a)) || bareRx.test(String(a.itemName || '').trim().toUpperCase());
              const siblings = allApprovedDesigns.filter(a =>
                  a.id !== asm.id && asmMatches(a) && Array.isArray(a.nodeClusters) && a.nodeClusters.length &&
                  (a.brandId === asm.brandId || (Array.isArray(a.sharedBrands) && a.sharedBrands.includes(asm.brandId))));
              if (!siblings.length) unionReport.push(`no sibling assemblies matched ${bareRx} in this brand`);
              // Identity of a choice = family STYLE (stamped or code-parsed) at a position+category;
              // non-family parts (return/miter fees, shared hardware) key by part id instead.
              const keyFor = styleKeyFor;
              const seenKeys = new Set();
              // PER-DIAMETER TAG MAP (Stuart 2026-07-24: "the projections offered needs to read
              // the tags") — a deduped sibling pin still contributes its proj:/mount: tags under
              // ITS OWN diameter, keyed by the same style identity. Options later pick this up
              // as projByDia, so the ½" entry of a merged LB option is the H2-05 pin's .75.
              const diaOfPart = (partId) => (sizeKeyOf(partsById[partId]) || sizeKeyOf({ legacyErpId: partId }))?.dia || null;
              const recordTags = (p, pos, cat) => {
                  const d = diaOfPart(p.partId);
                  if (!d) return;
                  const k = keyFor(p.partId, p.partName, pos, cat);
                  const slot = tagsByStyle[k] = tagsByStyle[k] || { projByDia: {}, mountByDia: {} };
                  if (p.projInches && String(p.projInches).trim()) slot.projByDia[d] = String(p.projInches).trim().toUpperCase();
                  if (p.mountType && String(p.mountType).trim()) slot.mountByDia[d] = String(p.mountType).trim().toUpperCase();
              };
              clusters.forEach(cl => {
                  const cat = catOf(cl); const pos = (cl.position || '').toUpperCase();
                  (pinsByCluster[cl.id] || []).forEach(p => { if (!p.isHiddenPart && p.partId) { seenKeys.add(keyFor(p.partId, p.partName, pos, cat)); recordTags(p, pos, cat); } });
              });
              for (const sib of siblings) {
                  let sibPins = [];
                  try { const s = await getDocs(query(collection(db, "assembly_pins"), where("assemblyId", "==", sib.itemId))); sibPins = s.docs.map(d => d.data()); } catch (e) { console.warn('union pin load failed', sib.itemId, e); }
                  const addedCodes = [];
                  const skippedIds = [];
                  const byCl = {};
                  sibPins.forEach(p => { if (p.clusterId) (byCl[p.clusterId] = byCl[p.clusterId] || []).push(p); });
                  (sib.nodeClusters || []).filter(c => !c.hidden).forEach(cl => {
                      const pos = (cl.position || '').toUpperCase();
                      const catGuess = cl.category ? String(cl.category).toUpperCase() : '';
                      const fresh = (byCl[cl.id] || [])
                          .filter(p => p.choiceNode && String(p.choiceNode).trim() && p.partId && !p.isHiddenPart && !String(p.partId).startsWith('HIDDEN-'))
                          .filter(p => {
                              // Junk/stale pins whose partId isn't a real library item (raw node
                              // names like H205IMRIGHT) never union — they'd show everywhere.
                              if (!partsById[p.partId]) { skippedIds.push(p.partId); return false; }
                              const cat = catGuess || classifyCat(partsById[p.partId]?.manufacturingSpecs?.productType || partsById[p.partId]?.productType);
                              if (!cat) return false;
                              // Tags ride even when the CHOICE dedupes: this diameter's proj:/mount:
                              // land under its dia on the surviving option's projByDia/mountByDia.
                              recordTags(p, pos, cat);
                              const k = keyFor(p.partId, p.partName, pos, cat);
                              if (seenKeys.has(k)) return false;
                              seenKeys.add(k);
                              return true;
                          });
                      if (!fresh.length) return;
                      const nsId = `UNION-${sib.itemId}-${cl.id}`;
                      // nodes restricted to the fresh choices' own subtrees — the single-choice
                      // path reads cl.nodes, and the clone must never drag duplicate choices'
                      // node names along.
                      clusters.push({ ...cl, id: nsId, nodes: fresh.map(p => String(p.choiceNode).trim()) });
                      pinsByCluster[nsId] = fresh;
                      pinByCluster[nsId] = fresh[0];
                      srcByCluster[nsId] = sib.itemName || sib.itemId; // review modal groups by contributing sibling
                      fresh.forEach(p => addedCodes.push(p.partId));
                  });
                  unionReport.push(`${sib.itemName || sib.itemId}: ${sibPins.length} pin(s) → +${addedCodes.length}${addedCodes.length ? ` (${addedCodes.join(', ')})` : ''}${skippedIds.length ? ` · skipped ${skippedIds.length} not-in-library (${[...new Set(skippedIds)].join(', ')})` : ''}`);
              }
          } else {
              unionReport.push('no size family / no codeRx — union skipped (expected for H1)');
          }
      } catch (e) { unionReport.push(`⚠ FAILED: ${e.message || e}`); console.warn('family union skipped:', e); }
      // The union names what it did on every generate — a missing sibling option (H2-05FDB
      // invisible at ½") must be diagnosable from this report alone, never a silent skip. For
      // codeRx families the report now renders INSIDE the review modal (below) instead of an
      // alert; the alert remains for the bypass paths (H1 / no family), which see no modal.
      if (unionReport.length && !fam?.codeRx && !singleMode) alert(`🧬 Family union:\n\n${unionReport.join('\n')}\n\n(+N = choices added from that sibling; styles the master already carries are deduped and resolve per-diameter automatically.)`);
      // De-union: every option is CLUSTER-scoped (see both paths in groupPlacements) — each cluster
      // placement is its own option with its own flags/geometry, so position splits and same-part
      // regular-vs-RETURN plate copies are never merged back together.
      const groupPlacements = (cat, filterFn) => {
          const map = {};
          clusters.filter(c => catOf(c) === cat && (!filterFn || filterFn(c))).forEach(cl => {
              const position = (cl.position || '').toUpperCase();
              const location = (cl.location || '').toUpperCase();
              // Assembly-Builder cluster = many choices stacked in one cluster, each pin carrying its
              // own choiceNode (that choice's node subtree). Fan those out to ONE option per choice so
              // the configurator offers Ball Finial / End Cap / French Return… instead of one lumped
              // "FINIALS+RETURNS" option — each choice shows only its own geometry (choiceNode controls
              // its whole subtree by ancestor match). ≥2 choice pins = Assembly-Builder cluster.
              const choicePins = (pinsByCluster[cl.id] || []).filter(p => p.choiceNode && String(p.choiceNode).trim() && !p.isHiddenPart);
              // Shared flag derivation — BOTH paths (fan-out AND single-choice) stamp the same flags.
              // The single-choice path used to stamp NOTHING, so one-part-per-cluster assemblies
              // (Brimar style) lost endTreatment/isFee/returnOnly on every option: returns didn't grey
              // brackets, fee entities didn't bill, return plates didn't scope. returnOnly also
              // consults the resolved LIBRARY part's name ("Mounting Base for 1\" French Return") —
              // linked pins carry the ERP code as partName, so the pin name alone can't tell.
              const RETURNISH = /bend|return|miter|mitre|mtr|french/i;
              const clusterReturnish = RETURNISH.test(String(cl.name || '')) || !!cl.returnOnly; // 1.5's 'RETURN plates' toggle counts too
              const flagsFor = (p) => {
                  const feePart = partsById[p.partId];
                  const et = String(p.endTreatment || '').toUpperCase();
                  // EXPLICIT pool flags beat the name heuristics: an explicitly-INLINE copy must not
                  // also read as a return plate just because the shared part's library name says
                  // "for Returns" (Fabricut's inline RBP/RCP copies) — that put BOTH copies in the
                  // return pool. Name-derived return-ness applies only when no inline flag exists.
                  const inlineish = !!(p.inlineOnly || cl.inlineOnly);
                  const explicitRtn = p.returnOnly === true || !!cl.returnOnly;
                  const nameRtn = RETURNISH.test(String(cl.name || '')) || RETURNISH.test(String(p.partName || '')) || RETURNISH.test(String(feePart?.itemName || ''));
                  const returnish = et ? (et === 'FRENCH_RETURN' || et === 'MITER_RETURN' || et === 'INSIDE_MOUNT')
                      : (inlineish ? false : (explicitRtn || nameRtn));
                  const feeish = p.isFee || feePart?.partClass === 'Fee' || String(feePart?.manufacturingSpecs?.productType || '').toUpperCase() === 'FEE';
                  // END RETURN ARM (Flat Iron pattern): a BRACKET choice that IS the end treatment — the
                  // arm mimics the miter. Selecting it greys that side's End Treatment step in CPQ/Vision.
                  // Canonical source = the part's customData.isReturnBracket; pin.isReturnArm overrides.
                  const returnArm = !!(p.isReturnArm || cl.isReturnArm || feePart?.manufacturingSpecs?.customData?.isReturnBracket);
                  return { et, returnish, feeish, feePart, returnArm, inlineish };
              };
              if (choicePins.length >= 2) {
                  // Cluster-scoped options: the SAME part can live in two clusters at one position (a
                  // plate in both the regular backplate stack AND the RETURN backplate cluster), so key
                  // per cluster — picking one copy must never light the other. Clusters named
                  // bend/return/miter/french are marked returnOnly: the CPQ sub-picker shows those
                  // plates only while that end's treatment is a return (and hides the regular ones) —
                  // the stronger rule needed when returns keep the bracket step. Options keep the
                  // author's arrow order via choiceSort.
                  const cshort = String(cl.id || '').replace(/[^A-Za-z0-9]/g, '').slice(-6);
                  [...choicePins].sort((a, b) => ((a.choiceSort ?? 9999) - (b.choiceSort ?? 9999)) || String(a.partName || '').localeCompare(String(b.partName || ''))).forEach(p => {
                      const pid = p.partId || cl.name;
                      // Explicit endTreatment tag (1.6 per-choice select / pin.endTreatment) is CANONICAL;
                      // name regexes are the legacy fallback (flagsFor).
                      const { et, returnish, feeish, returnArm, inlineish } = flagsFor(p);
                      const key = [cl.id, pid, position, location].join('|');
                      const e = map[key] = map[key] || { optId: `OPT-${cat}-${String(pid).replace(/[^A-Za-z0-9]/g, '').slice(0, 24)}-${position || 'X'}-${location || 'X'}-C${cshort}`, partId: pid, partName: p.partName || pid, position, location, _srcName: srcByCluster[cl.id], nodes: new Set(), ...(et ? { endTreatment: et } : {}), ...(returnish ? { returnOnly: true } : {}), // TRAVERSE tags ride the option so the generator can bucket fascia / track / carrier and
                          // scope by drive (Stuart 2026-08-04). Absent on every pole assembly.
                          ...(p.traverseRole ? { traverseRole: String(p.traverseRole).toUpperCase() } : {}), ...(p.driveType ? { driveType: String(p.driveType).toUpperCase() } : {}), ...(p.trvSetup ? { trvSetup: String(p.trvSetup).toUpperCase() } : {}), ...(p.alwaysShown ? { alwaysShown: true } : {}) };
                      e.nodes.add(String(p.choiceNode).trim());
                      // Fee choice: geometry + selection kept, bills as a fee (entity-priced when the
                      // partId is a Fee-class entity like CE-FEE-4594); ERP push never BOMs it.
                      if (feeish) { e.isFee = true; e.partName = `${p.partName || 'Charge'} (fee)`; }
                      if (returnArm) e.isReturnArm = true;
                      if (inlineish) e.inlineOnly = true;
                      if (p.isBasic) e.isBasic = true;
                      if (p.usesReturnPlates || cl.usesReturnPlates) e.usesReturnPlates = true;
                      // CUSTOMER-ONLY choice (1.6 cust gate): the option carries the restriction —
                      // CPQ + the portal show it only when that customer is selected / logged in.
                      if (Array.isArray(p.customerIds) && p.customerIds.length) { e.customerIds = p.customerIds; e.customerNames = p.customerNames || []; }
                      // Two-part finial pairing (1.6 COLLAR checkbox + collar: dropdown) rides the
                      // options exactly like customerIds — the pairing pass below reads these.
                      if (p.isCollar) e.isCollar = true;
                      if (p.requiresCollar && String(p.requiresCollar).trim()) e.requiresCollar = String(p.requiresCollar).trim();
                      // Explicit bracket projection (1.6 proj: select, 4.5-dictionary inches value):
                      // the option shows only at its projection — entered data, never code guessing.
                      if (p.projInches && String(p.projInches).trim()) e.projInches = String(p.projInches).trim().toUpperCase();
                      if (p.projLetter && String(p.projLetter).trim()) e.projLetter = String(p.projLetter).trim().toUpperCase();
                      if (p.mountType && String(p.mountType).trim()) e.mountType = String(p.mountType).trim().toUpperCase();
                  });
                  return;
              }
              // Single-choice cluster → one option for the whole cluster, with the SAME flag stamping
              // as the fan-out path (endTreatment / fee / returnOnly / basic / rtn-bp from the pin).
              // CLUSTER-SCOPED key, same as the fan-out path: the SAME part can live in two clusters
              // at one position (Flat Iron's FIHBP outer=RETURN plate AND inner=regular plate, both
              // WALL·LEFT) — a part+position key MERGED them into one option that unioned their flags
              // AND geometry, so picking either lit both plates and return scoping couldn't separate
              // them. Keyed per cluster, each copy is its own option with its own flags/nodes.
              const pin = pinByCluster[cl.id];
              const pid = pin?.partId || cl.name;
              const cshortL = String(cl.id || '').replace(/[^A-Za-z0-9]/g, '').slice(-6);
              const keyL = [cl.id, pid, position, location].join('|');
              const e = map[keyL] = map[keyL] || { optId: `OPT-${cat}-${String(pid).replace(/[^A-Za-z0-9]/g, '').slice(0, 24)}-${position || 'X'}-${location || 'X'}-C${cshortL}`, partId: pid, partName: pin?.partName || cl.name, position, location, _srcName: srcByCluster[cl.id], nodes: new Set(), // A cluster with ONE pin took this branch and lost every traverse tag — which is why the
                  // F-clip stayed in the Pole / Rod Material picker no matter how it was tagged.
                  ...(pin?.traverseRole ? { traverseRole: String(pin.traverseRole).toUpperCase() } : {}), ...(pin?.driveType ? { driveType: String(pin.driveType).toUpperCase() } : {}), ...(pin?.trvSetup ? { trvSetup: String(pin.trvSetup).toUpperCase() } : {}), ...(pin?.alwaysShown ? { alwaysShown: true } : {}) };
              (cl.nodes || cl.meshes || []).forEach(n => { if (n) e.nodes.add(n); });
              if (pin) {
                  const { et, returnish, feeish, returnArm, inlineish } = flagsFor(pin);
                  if (et) e.endTreatment = et;
                  if (returnArm) e.isReturnArm = true;
                  if (inlineish) e.inlineOnly = true;
                  if (returnish) e.returnOnly = true;
                  if (feeish) { e.isFee = true; e.partName = `${pin.partName || 'Charge'} (fee)`; }
                  if (pin.isBasic) e.isBasic = true;
                  if (pin.usesReturnPlates || cl.usesReturnPlates) e.usesReturnPlates = true;
                  if (Array.isArray(pin.customerIds) && pin.customerIds.length) { e.customerIds = pin.customerIds; e.customerNames = pin.customerNames || []; }
                  if (pin.isCollar) e.isCollar = true;
                  if (pin.requiresCollar && String(pin.requiresCollar).trim()) e.requiresCollar = String(pin.requiresCollar).trim();
                  if (pin.projInches && String(pin.projInches).trim()) e.projInches = String(pin.projInches).trim().toUpperCase();
                  if (pin.projLetter && String(pin.projLetter).trim()) e.projLetter = String(pin.projLetter).trim().toUpperCase();
                  if (pin.mountType && String(pin.mountType).trim()) e.mountType = String(pin.mountType).trim().toUpperCase();
              } else if (clusterReturnish && !cl.inlineOnly) {
                  e.returnOnly = true; // unpinned cluster named …RETURN… still scopes to returns (unless flagged INLINE)
              }
              if (!pin && cl.isReturnArm) e.isReturnArm = true; // 1.5 cluster toggle, no pin yet
              if (!pin && cl.inlineOnly) e.inlineOnly = true;
              if (!pin && cl.usesReturnPlates) e.usesReturnPlates = true;
          });
          return Object.values(map).map(e => {
              const tags = tagsByStyle[styleKeyFor(e.partId, e.partName, e.position, cat)];
              return { optId: e.optId, partId: e.partId, partName: e.partName, position: e.position, location: e.location, targetNode: [...e.nodes].join(', '), price: 0, ...(e.endTreatment ? { endTreatment: e.endTreatment } : {}), ...(e.isFee ? { isFee: true } : {}), ...(e.returnOnly ? { returnOnly: true } : {}), ...(e.inlineOnly ? { inlineOnly: true } : {}), ...(e.isReturnArm ? { isReturnArm: true } : {}), ...(e.isBasic ? { isBasic: true } : {}), ...(e.usesReturnPlates ? { usesReturnPlates: true } : {}), ...(e.customerIds ? { customerIds: e.customerIds, customerNames: e.customerNames || [] } : {}), ...(e.isCollar ? { isCollar: true } : {}), ...(e.requiresCollar ? { requiresCollar: e.requiresCollar } : {}), ...(e.projInches ? { projInches: e.projInches } : {}), ...(e.projLetter ? { projLetter: e.projLetter } : {}), ...(e.mountType ? { mountType: e.mountType } : {}), ...(tags && Object.keys(tags.projByDia).length ? { projByDia: tags.projByDia } : {}), ...(tags && Object.keys(tags.mountByDia).length ? { mountByDia: tags.mountByDia } : {}), ...(e._srcName ? { _srcName: e._srcName } : {}), // ⛔ THE OPTION IS REBUILT FROM A WHITELIST. Adding the traverse tags to the map entry was
                  // not enough — this return decides what actually leaves groupPlacements, and it
                  // silently dropped them, so the generator saw a traverse assembly as an ordinary
                  // pole one and emitted the pole steps unchanged (Stuart 2026-08-04: "i loaded
                  // choices and retagged flow and see no difference").
                  ...(e.traverseRole ? { traverseRole: e.traverseRole } : {}), ...(e.driveType ? { driveType: e.driveType } : {}), ...(e.trvSetup ? { trvSetup: e.trvSetup } : {}), ...(e.alwaysShown ? { alwaysShown: true } : {}) };
          });
      };
      const geom = (opts) => { const g = {}; opts.forEach(o => { if (o.targetNode) g[o.optId] = o.targetNode; }); return g; };

      // 🏷 Per-choice CATEGORY OVERRIDE (1.6 cat: select — Stuart 2026-07-24: designer dropped the
      // return backplate into a FINIAL slot): pins whose catOverride differs from their cluster's
      // category re-home into a synthetic single-choice cluster of the override category (same
      // position/location), so mis-slotted parts pool correctly without touching the file. A
      // cluster left with zero pins is dropped so it can't emit a phantom unpinned option.
      {
          const emptied = new Set();
          [...clusters].forEach(cl => {
              const clCat = catOf(cl);
              const list = pinsByCluster[cl.id] || [];
              const movers = list.filter(p => p.catOverride && String(p.catOverride).toUpperCase() !== clCat);
              if (!movers.length) return;
              pinsByCluster[cl.id] = list.filter(p => !movers.includes(p));
              movers.forEach((p, i) => {
                  const cat = String(p.catOverride).toUpperCase();
                  const nsId = `OVR-${cat}-${cl.id}-${i}`;
                  // A pin authored in a FINIAL slot carries finial-row artifacts — endTreatment
                  // 'FINIAL', collar fields — that POISON its new pool: an explicit endTreatment
                  // beats the return-name heuristics in flagsFor, so a re-homed return backplate
                  // emitted without returnOnly and CPQ's return→bracket lock never fired (Stuart
                  // 2026-07-26, H2-RBP right side). Strip END-only fields for non-FINIAL homes;
                  // the cluster's own name ("…RETURNS") then classifies the plate return-only,
                  // and the row's rtn-only checkbox (now shown for overridden rows) is explicit.
                  const moved = cat === 'FINIAL' ? p : (({ endTreatment, isCollar, requiresCollar, ...rest }) => rest)(p);
                  clusters.push({ ...cl, id: nsId, category: cat, nodes: [String(moved.choiceNode || '').trim()].filter(Boolean) });
                  pinsByCluster[nsId] = [moved];
                  pinByCluster[nsId] = moved;
              });
              if (!pinsByCluster[cl.id].length) emptied.add(cl.id);
              else if (pinByCluster[cl.id] && movers.includes(pinByCluster[cl.id])) pinByCluster[cl.id] = pinsByCluster[cl.id][0];
          });
          for (let i = clusters.length - 1; i >= 0; i--) if (emptied.has(clusters[i].id)) clusters.splice(i, 1);
      }
      // 🎯 Single-assembly mode: a cluster with ZERO pins emits nothing (Stuart 2026-07-24:
      // deleted every pin on the designer's H2-05-FINIAL clusters, yet 'H2-05-FINIAL-LEFT'
      // kept appearing — the legacy cluster-name fallback option). In the pin-era model every
      // real choice has a pin; the fallback stays for legacy assemblies and union generates.
      const prunedClusterNodes = [];
      if (singleMode) {
          for (let i = clusters.length - 1; i >= 0; i--) {
              if (!(pinsByCluster[clusters[i].id] || []).length) {
                  // A skipped cluster's meshes are CONTROLLED BY NOTHING — uncontrolled geometry
                  // renders permanently (Stuart 2026-07-24: deleted FDB scale-up copies floating
                  // on the 1-3/8" model). Force-hide every node so the geometry dies with the pins.
                  prunedClusterNodes.push(...(clusters[i].nodes || []));
                  clusters.splice(i, 1);
              }
          }
          // PARTIAL deletes (Stuart 2026-07-24: ghost acrylic jewels on both ends — the 🗑-deleted
          // duplicate rows' meshes): a fan-out CHOICE cluster's nodes that no surviving pin
          // controls render permanently. Force-hide them — the renderer's show-wins rule (an
          // explicit show from the selected option's geometry beats an incidental hide) keeps
          // every SELECTED choice's meshes visible even when their names land in this list.
          // Single-pin clusters (always-on poles/rings/collar companions) are never touched.
          clusters.forEach(cl => {
              const cps = (pinsByCluster[cl.id] || []).filter(p => p.choiceNode && String(p.choiceNode).trim() && !p.isHiddenPart);
              if (cps.length < 2) return;
              const controlled = new Set(cps.map(p => String(p.choiceNode).trim()));
              (cl.nodes || []).forEach(n => { const nn = String(n).trim(); if (nn && !controlled.has(nn)) prunedClusterNodes.push(nn); });
          });
      }
      let pole = groupPlacements('POLE');
      // 🧊 Two-part acrylic finials: a COLLAR choice is NOT a customer choice — it's companion
      // geometry that renders WITH the top choices paired to it. Collars leave the option pool;
      // their nodes are APPENDED to each paired option's geometry (so top+collar show and the
      // step's metal finish lands on the collar), and the option remembers its pre-merge top
      // nodes (acrylicTopNodes) so the AC master-finish chip override targets ONLY the acrylic.
      // Detection is EXPLICIT (1.6 COLLAR checkbox → pin.isCollar): partName holds the bare item
      // code (H2-138AFC), so a text heuristic alone can't see "acrylic"/"collar" — the old
      // name-only detection failed exactly there. AFC-coded / "acrylic collar"-named options stay
      // as a fallback for unflagged legacy pins.
      // Pairing is EXPLICIT too (1.6 collar: dropdown → pin.requiresCollar = the collar's item #):
      // that option gets THAT collar's nodes (matched by partId/partName — linked pins carry the
      // ERP code as partName — preferring the same position). Options WITHOUT requiresCollar keep
      // the legacy same-side append ONLY when the pool has exactly one collar (unambiguous).
      const finialAll = groupPlacements('FINIAL');
      const optTxt = (o) => `${o.partName || ''} ${o.partId || ''}`;
      const isCollarOpt = (o) => !!o.isCollar || /(^|[^A-Z])AFC([^A-Z]|$)/i.test(optTxt(o)) || (/ACRYLIC/i.test(optTxt(o)) && /COLLAR/i.test(optTxt(o)));
      const collarPool = finialAll.filter(isCollarOpt);
      let finial = finialAll.filter(o => !isCollarOpt(o));
      if (collarPool.length) {
          const normId = (v) => String(v || '').trim().toUpperCase();
          finial.forEach(o => {
              let mates = [];
              if (o.requiresCollar) {
                  const want = normId(o.requiresCollar);
                  const byId = collarPool.filter(c => normId(c.partId) === want || normId(c.partName) === want);
                  const samePos = byId.filter(c => (c.position || '') === (o.position || ''));
                  mates = samePos.length ? samePos : byId.slice(0, 1);
              } else if (collarPool.length === 1 && /ACRYLIC/i.test(optTxt(o))) {
                  mates = collarPool.filter(c => (c.position || '') === (o.position || ''));
              }
              const extra = mates.map(c => c.targetNode).filter(Boolean).join(', ');
              if (!extra) return;
              o.acrylicTopNodes = o.targetNode || '';
              o.targetNode = o.targetNode ? `${o.targetNode}, ${extra}` : extra;
          });
      }
      let brackets = groupPlacements('BRACKET');
      let backplates = groupPlacements('BACKPLATE');
      let rings = groupPlacements('RING');

      // ── 🔍 GENERATE-TIME REVIEW GATE (Stuart 2026-07-24: explicit control over heuristics) ──
      // For codeRx families (the ones the union runs on — H2 today; H1 has no codeRx and
      // bypasses this entirely), STOP here with every option pool computed but NOTHING written,
      // and open the review modal: a per-source-assembly checklist of every option about to be
      // emitted + the diameter × projection matrix, pre-checked to exactly what the current
      // tags/dias logic would do (or to the flow's last stored review on regenerate). The
      // generator resumes only on "Generate with checked" — unchecked options are dropped from
      // the pools below, and the checked matrix is baked into the SIZE-PROJ step's dias arrays
      // + persisted as flow.reviewExclusions (whose projMatrix taggedProjInchesAtDia serves to
      // the CPQ cards, so tags can never resurface an unchecked projection).
      // Identity of a reviewable option = partId|position|category — optIds embed the cluster
      // id (changes on re-import), this survives regenerates, so exclusions stay sticky.
      const reviewKeyOf = (o, cat) => `${String(o.partId || o.partName || '').trim().toUpperCase()}|${String(o.position || '').toUpperCase()}|${cat}`;
      let review = null;
      if (fam?.codeRx) {
          const persisted = (inPlaceFlowId && oldFlow?.reviewExclusions) || null;
          const exSeed = new Set(Array.isArray(persisted?.optionKeys) ? persisted.optionKeys : []);
          // Sections per source assembly, master first, in pool order (pole → finial → bracket →
          // backplate → ring). Junk options — partId resolving to nothing or to a name-less doc
          // (the H205IMLEFT/H205IMRIGHT class) — flag ⚠ and start UNCHECKED, always: even a
          // previously-generated junk option must be re-ticked deliberately to survive a review.
          const sections = [];
          const bySrc = new Map();
          const sectionFor = (src) => { if (!bySrc.has(src)) { const s = { src, options: [] }; bySrc.set(src, s); sections.push(s); } return bySrc.get(src); };
          sectionFor(masterSrcLabel);
          const pushPool = (cat, list) => list.forEach(o => {
              const lib = partsById[o.partId];
              const junk = !lib || !String(lib.itemName || '').trim();
              const key = reviewKeyOf(o, cat);
              const sec = sectionFor(o._srcName || masterSrcLabel);
              const dup = sec.options.find(x => x.key === key);
              if (dup) { dup.copies += 1; return; } // same part+position+category in 2 clusters (regular vs RETURN copy) = ONE checkbox controlling both
              sec.options.push({
                  key, cat, junk, copies: 1,
                  position: o.position || '',
                  name: junk ? String(o.partName || o.partId || '?') : String(lib.itemName || o.partName),
                  itemNo: lib ? String((lib.legacyErpId && lib.legacyErpId !== 'PENDING' ? lib.legacyErpId : lib.itemId) || lib.id || '') : String(o.partId || ''),
                  flags: [o.isFee && 'fee', o.returnOnly && 'return', o.inlineOnly && 'inline', o.isCollar && 'collar'].filter(Boolean),
                  checked: junk ? false : !exSeed.has(key),
              });
          });
          pushPool('POLE', pole); pushPool('FINIAL', finial); pushPool('BRACKET', brackets); pushPool('BACKPLATE', backplates); pushPool('RING', rings);
          // Matrix seed — "current behavior" per diameter: the union's tag map when any pins are
          // tagged there (what the CPQ cards would offer), else the family's static dias[]
          // defaults. A stored review (regenerate) wins over both, per dia row it covers.
          const rnd = (n) => Math.round(n * 1000) / 1000;
          const tagInchesByDia = {};
          Object.values(tagsByStyle).forEach(t => Object.entries(t.projByDia || {}).forEach(([d, v]) => {
              const f = parseFloat(String(v).replace(/[^0-9.]/g, ''));
              if (Number.isFinite(f)) (tagInchesByDia[d] = tagInchesByDia[d] || new Set()).add(rnd(f));
          }));
          const cellDefault = (diaVal, po) => {
              const set = tagInchesByDia[diaVal];
              if (set && set.size) return Number.isFinite(po.inches) && set.has(rnd(po.inches));
              return !po.dias || po.dias.includes(diaVal);
          };
          const cellPersisted = (diaVal, po) => {
              const arr = persisted?.projMatrix?.[diaVal];
              if (!Array.isArray(arr)) return null;
              return Number.isFinite(po.inches) && arr.some(v => Math.abs(parseFloat(v) - po.inches) < 0.01);
          };
          const cellSeed = [];
          fam.dia.options.forEach(d => fam.proj.options.forEach(po => {
              const p = cellPersisted(d.value, po);
              if (p == null ? cellDefault(d.value, po) : p) cellSeed.push(`${d.value}|${po.optId}`);
          }));
          // Tag measurements with no family projection option can never be offered — name them so
          // a "missing" projection is diagnosable (add the one-line family option, regenerate).
          const strayTags = [];
          Object.entries(tagInchesByDia).forEach(([d, set]) => [...set].forEach(i => {
              if (!fam.proj.options.some(po => Number.isFinite(po.inches) && Math.abs(po.inches - i) < 0.01))
                  strayTags.push(`${i}" @ ${fam.dia.options.find(x => x.value === d)?.label || d}`);
          }));
          review = await new Promise((resolve) => setFlowReview({
              famLabel: fam.label, asmName: asm.itemName || asm.itemId,
              flowName: oldFlow?.name || null, isRegen: !!inPlaceFlowId, hadPersisted: !!persisted,
              unionReport: [...unionReport], sections,
              diaOptions: fam.dia.options.map(d => ({ value: d.value, label: d.label })),
              projOptions: fam.proj.options.map(po => ({ optId: po.optId, label: po.label })),
              cellSeed, strayTags, resolve,
          }));
          setFlowReview(null);
          if (!review) return; // ✋ cancelled — nothing written, nothing changed
      }
      // Drop what the review unchecked (no review = keep-all) and strip the _srcName helper, so
      // bypass families (H1) emit options byte-identical to the pre-review generator.
      const scrub = (list, cat) => list
          .filter(o => !review || !review.excludedKeys.has(reviewKeyOf(o, cat)))
          .map(({ _srcName, ...rest }) => rest);
      pole = scrub(pole, 'POLE'); finial = scrub(finial, 'FINIAL');
      brackets = scrub(brackets, 'BRACKET'); backplates = scrub(backplates, 'BACKPLATE'); rings = scrub(rings, 'RING');
      // RIDERS ARE NEVER A CUSTOMER CHOICE. An F-clip or a carrier is built, not picked — but it is
      // pinned on a POLE-category cluster, so it was showing up in the Pole / Rod Material dropdown
      // beside the actual rods (Stuart 2026-08-04, "H1-2TRVCLP — F-Clip Hanger" in that list). They
      // are collected separately by the traverse block and ride as includedParts.
      const dropRiders = (list) => list.filter(o => !isRider(o));
      const riderPool = [...pole, ...finial, ...brackets, ...backplates, ...rings].filter(isRider);
      pole = dropRiders(pole); finial = dropRiders(finial);
      brackets = dropRiders(brackets); backplates = dropRiders(backplates); rings = dropRiders(rings);

      // Split the pole: LEFT/RIGHT-tagged segments are END-POLE (bend vs straight) that must follow
      // that end's End Treatment selection; everything else (CENTER / untagged / shared) is the main
      // run that's always shown. This is what lets a french-return end and a finial end coexist —
      // each end shows its own pole geometry instead of one global step-1 pole. End segments carry
      // their geometry into the End Treatment step (see addEndTreatment); the center run stays on.
      const isEndPos = (o) => ['LEFT', 'RIGHT'].includes((o.position || '').toUpperCase());
      const centerPole = pole.filter(o => !isEndPos(o));
      const endPole = pole.filter(o => isEndPos(o));
      const poleNodes = centerPole.map(o => o.targetNode).filter(Boolean).join(', ');
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
      const addPerPosition = (opts, base, { clone = false, subOpts = null, subLabel = '', stepRole = '' } = {}) => {
          const present = [...new Set(opts.map(o => o.position || ''))];
          const ordered = ['LEFT', 'CENTER', 'RIGHT', ''].filter(p => present.includes(p))
              .concat(present.filter(p => !['LEFT', 'CENTER', 'RIGHT', ''].includes(p)));
          ordered.forEach(pos => {
              const group = opts.filter(o => (o.position || '') === pos);
              if (!group.length) return;
              const label = POS_LABEL[pos] !== undefined ? POS_LABEL[pos] : pos;
              const subs = subOpts ? subOpts.filter(o => (o.position || '') === pos) : [];
              const inc = takeIncluded(pos);
              add({
                  title: label ? `${label} ${base}` : base,
                  type: 'STYLE_SWAP', partHandling: 'Custom', required: false, finishDataSource: 'master_finishes', useClientPricing: true,
                  position: pos, ...(stepRole ? { stepRole } : {}),
                  // Only the CENTER bracket step takes a quantity (a long pole can carry several
                  // passing brackets); LEFT/RIGHT positions are structurally one each (Stuart 2026-07-10).
                  ...(clone && pos === 'CENTER' ? { isCenterClone: true, qtyHelperText: 'Number of center passing brackets' } : { hideQty: true }),
                  styleOptions: group, geometryMap: geom(group),
                  ...(subs.length ? { subLabel, subOptions: subs, subGeometryMap: geom(subs) } : {}),
                  ...(inc ? { includedParts: inc } : {})
              });
          });
      };

      // End Treatment per END position (Left/Right/...), each with that end's finials plus the
      // shared miter / bend / flush fee options, so each end is finished independently. With no
      // position-tagged finials it collapses to a single End Treatment (just the fee options).
      //
      // POLE MODEL (BRIMAR-style): one SHORT rod = the center run, always shown; the LONG rod is
      // layered TWICE and tagged position LEFT + RIGHT (endPoleOpts) so each side hides independently.
      // We wire that side's long rod into THIS step's geometryMap so it follows the end's own pick:
      //   • real finial (or Flush) → SHOW this side's long rod, so the finial sits on the full length.
      //   • french / bent / mitered RETURN → do NOT list the long rod, so picking it HIDES the long
      //     rod on that side and the short center rod carries the return length.
      // The long rod is always CONTROLLED (listed under Flush below), so it hides on a return even if
      // no real finial lists it — that's the "flag" you asked for: the return SELECTION is the flag,
      // no separate field to track. Returns are recognized by keyword (french/return/bend/miter/...)
      // in the option's part name or id. bendNodes only matters if a distinct bend GEOMETRY is tagged
      // (not the case here — there's no separate bend segment). No L/R pole segments → behaves as before.
      const BEND_RE = /bend|return|miter|mitre|mtr|curv|french|\bfr\b/i;
      const addEndTreatment = (opts, endPoleOpts = []) => {
          const present = [...new Set([...opts, ...endPoleOpts].map(o => o.position || ''))];
          const ordered = ['LEFT', 'CENTER', 'RIGHT', ''].filter(p => present.includes(p))
              .concat(present.filter(p => !['LEFT', 'CENTER', 'RIGHT', ''].includes(p)));
          (ordered.length ? ordered : ['']).forEach(pos => {
              const group = opts.filter(o => (o.position || '') === pos);
              const ends = endPoleOpts.filter(o => (o.position || '') === pos);
              const bendNodes = ends.filter(o => BEND_RE.test(`${o.partName || ''} ${o.optId || ''}`))
                  .map(o => o.targetNode).filter(Boolean).join(', ');
              const straightNodes = ends.filter(o => !BEND_RE.test(`${o.partName || ''} ${o.optId || ''}`))
                  .map(o => o.targetNode).filter(Boolean).join(', ');
              const label = POS_LABEL[pos] !== undefined ? POS_LABEL[pos] : pos;
              const sfx = pos || 'X';
              const inc = takeIncluded(pos);
              // Real finials → long (straight) rod shown; a return-type option (french/bent/miter,
              // even if authored as a "finial" choice) hides it. Flush always controls the long rod
              // so it can hide on a return even when every option this side is a return.
              const gmap = {};
              group.forEach(o => {
                  // The option's explicit endTreatment tag (from the 1.6 per-choice select, via the
                  // pin) is CANONICAL: FRENCH/MITER return or INSIDE_MOUNT hides the long rod half,
                  // FINIAL shows it. The name/leaf regex below is only the legacy fallback for
                  // options generated from pre-spec pins.
                  const et = String(o.endTreatment || '').toUpperCase();
                  let isReturn;
                  if (et) {
                      // ROD DISPLAY ONLY: just true returns swap to the short rod (the bend replaces the
                      // overhang). INSIDE_MOUNT renders like a FINIAL — the long rod stays — while still
                      // replacing the bracket (that gating lives in CPQTab's isReturnChosenForPos).
                      isReturn = et === 'FRENCH_RETURN' || et === 'MITER_RETURN';
                  } else {
                      // Geometry check uses only each node's LEAF label (after the "S5-<CLUSTER>__n_"
                      // prefix): a return renamed to a fee entity ("CE-FEE-5138") is still recognized by
                      // its node ("…34X14RNDBENDLEFT…"), but the cluster-name prefix ("…FINIALS-+-RETURNS")
                      // must NOT count — it made every finial read as a return and detach the long rod.
                      const leaves = String(o.targetNode || '').split(',').map(s => { const seg = String(s).trim().split('__').pop() || ''; return seg.replace(/^\d+_?/, ''); }).join(' ');
                      isReturn = BEND_RE.test(`${o.partName || ''} ${o.optId || ''} ${leaves}`);
                  }
                  const nodes = [o.targetNode, isReturn ? '' : straightNodes].filter(Boolean).join(', ');
                  if (nodes) gmap[o.optId] = nodes;
              });
              if (bendNodes) { gmap[`OPT-MITER-${sfx}`] = bendNodes; gmap[`OPT-BEND-${sfx}`] = bendNodes; }
              if (straightNodes) gmap[`OPT-FLUSH-${sfx}`] = straightNodes;
              // Built-in Mitered/Bent fee options exist for flows whose returns are PURE bend-rod
              // geometry (endPole segments). When this position already has its OWN modeled return
              // choice (a pin tagged FRENCH/MITER return — e.g. Brimar's CE-FEE-4594 bend), the
              // built-ins are redundant do-nothing duplicates — skip them.
              const hasOwnReturn = group.some(o => {
                  const t = String(o.endTreatment || '').toUpperCase();
                  return t === 'FRENCH_RETURN' || t === 'MITER_RETURN';
              });
              // Return FEE ITEMS (customData.feeType FRENCH_RETURN / MITER_RETURN, base doc only):
              // linking one as the option's partId lets the fee price through the item — per-customer
              // clientPricing, painted (/P) vs plated (/EP) by the end's chosen finish, and the
              // Fabricut price levels — instead of a single flat author price. Author option prices
              // still override when set; fee items never push as NetSuite lines (they ride the rollup).
              const feeItemFor = (t) => allApprovedDesigns.find(p =>
                  String(p.manufacturingSpecs?.customData?.feeType || '').toUpperCase() === t &&
                  !String(p.legacyErpId || p.itemId || '').includes('/') &&
                  (p.brandId === activeBrand || (p.sharedBrands || []).includes(activeBrand)));
              const groupFilled = group.map(o => {
                  const t = String(o.endTreatment || '').toUpperCase();
                  if ((t === 'FRENCH_RETURN' || t === 'MITER_RETURN') && !o.partId) {
                      const fi = feeItemFor(t);
                      if (fi) return { ...o, partId: fi.id };
                  }
                  return o;
              });
              const mtrFee = feeItemFor('MITER_RETURN');
              const frFee = feeItemFor('FRENCH_RETURN');
              add({
                  title: label ? `${label} End Treatment` : 'End Treatment',
                  // one end = one treatment — never a quantity (Stuart 2026-07-10)
                  type: 'STYLE_SWAP', partHandling: 'Small Parts', required: false, hideQty: true, finishDataSource: 'master_finishes', useClientPricing: true,
                  // position lets an option flagged "hides bracket" (ticked per option in the step editor)
                  // disable THIS side's outer Bracket & Mount step in CPQTab. Off by default — a return
                  // that still needs its bracket/backplate (e.g. french-return backplates) keeps the step.
                  position: pos,
                  styleOptions: [...groupFilled,
                      // 🎯 Single-assembly flows NEVER get the built-in return fees (Stuart 2026-07-24:
                      // "there are no returns on 1.6 for the H2-05" — these synthetic, tag-less options
                      // were what kept showing at ½"). In that model returns exist ONLY as pinned fee
                      // choices with their own min-projection tags.
                      ...(hasOwnReturn || singleMode ? [] : [
                          { optId: `OPT-MITER-${sfx}`, partId: mtrFee ? mtrFee.id : '', partName: mtrFee ? (mtrFee.itemName || 'Mitered Return') : 'Mitered Return (fee — set price)', targetNode: bendNodes, price: 0, endTreatment: 'MITER_RETURN', isFee: true },
                          { optId: `OPT-BEND-${sfx}`, partId: frFee ? frFee.id : '', partName: frFee ? (frFee.itemName || 'Bent Return') : 'Bent Return (fee — set price)', targetNode: bendNodes, price: 0, endTreatment: 'FRENCH_RETURN', isFee: true }]),
                      { optId: `OPT-FLUSH-${sfx}`, partId: '', partName: 'Flush Cut', targetNode: straightNodes, price: 0 }],
                  geometryMap: gmap,
                  ...(inc ? { includedParts: inc } : {})
              });
          });
      };

      // ── TRAVERSE (Stuart 2026-08-03/04) ────────────────────────────────────────────────────────
      // A traverse system is a different grammar, so it gets its own steps AHEAD of the pole ones:
      // fascia first, then the track, then the drive. Every one of these is gated on tagged pins
      // existing, so a pole assembly emits exactly what it emitted before — nothing here runs.
      const allOpts = [...pole, ...finial, ...brackets, ...backplates, ...rings, ...riderPool];
      const trvAll = allOpts.filter(o => traverseRoleOf(o));
      const isTraverse = trvAll.length > 0;
      if (isTraverse) {
          // ONE MATERIAL, LISTED ONCE. A double pins the SAME rod in the front cluster AND the
          // rear one, so the picker was offering every material twice (Stuart 2026-08-04:
          // "currently showing 4 choices should just be 2").
          const fascia = dedupeByPart(offeredChoices(allOpts, { role: 'FASCIA' }));
          const track = offeredChoices(allOpts, { role: 'TRACK' });
          // NEVER A QUESTION, ALWAYS BUILT: carriers ride inside, and the F-CLIP attaches the track
          // to the fascia. Both are cut/consumed per configuration, neither is ever chosen.
          const riders = riderPool.filter(o => ['CARRIER', 'FCLIP'].includes(traverseRoleOf(o)) || o.alwaysShown);
          const riderInc = riders.length
              ? riders.map(o => ({ partId: o.partId, partName: o.partName, qty: 1, traverseRole: traverseRoleOf(o) }))
              : null;

          // ── 1. FASCIA — BUILT EXACTLY LIKE THE POLE (Stuart 2026-08-04: "the fascia step needs to
          //    act like a pole step... first choose from material there are wood and metal fascia
          //    loaded, then based off this selection we will choose the appropriate finish and enter
          //    length"). Same two shapes the pole uses, for the same reason: with SEVERAL materials
          //    the material step owns the finish (each option carries its own scoped finish list) and
          //    the length step is dimensions only; with ONE material there is nothing to choose, so
          //    finish and length combine into a single step.
          const fasciaNodes = fascia.map(o => o.targetNode).filter(Boolean).join(', ');
          if (fascia.length > 1) {
              add({ title: 'Fascia Material', type: 'STYLE_SWAP', partHandling: 'Custom', hideQty: true, required: true, useClientPricing: true, styleOptions: fascia, geometryMap: geom(fascia) });
              add({ title: 'Fascia Length', type: 'DIMENSIONS', partHandling: 'Custom', calculatorTemplate: bay.calc, qtyHelperText: bay.qtyHelper, required: true, useClientPricing: true, geometryMap: {}, targetNodes: fasciaNodes, ...(riderInc ? { includedParts: riderInc } : {}) });
          } else if (fascia.length === 1) {
              add({ title: 'Fascia Length & Finish', type: 'VISUAL_DIMENSIONS', dataSource: 'master_finishes', partHandling: 'Custom', calculatorTemplate: bay.calc, qtyHelperText: bay.qtyHelper, required: true, useClientPricing: true, geometryMap: {}, targetNodes: fasciaNodes, ...(fascia[0]?.partId ? { linkedItemId: fascia[0].partId } : {}), ...(riderInc ? { includedParts: riderInc } : {}) });
          }

          // ── 2. TRACK, with the DRIVE as its SUB-CHOICE (Stuart 2026-08-04: "on each track we
          //    choose between the motorized and manual traverse ends"). The drive belongs TO a
          //    track, not to the order — same shape as a backplate hanging off its bracket, so a
          //    two-track system can be motorised on one and manual on the other. A standalone step
          //    could not have expressed that.
          if (track.length) {
              // THE ENDS ARE REAL PARTS (Stuart 2026-08-04: "should i just tag them the ends?").
              // They were synthetic Motorized/Manual labels with no partId — nothing to bill and
              // nothing to render. Tagged trv: end + their drive, the ENDS themselves become the
              // track's sub-choice, so picking one picks an actual part.
              const { ends, isChoice } = traverseEnds(allOpts);
              // Only one drive → nothing to ask, but the end still has to be BUILT. It rides as an
              // included part instead of vanishing for want of a question.
              const endInc = (!isChoice && ends.length)
                  ? ends.map(o => ({ partId: o.partId, partName: o.partName, qty: 1, traverseRole: 'TRV_END' }))
                  : null;
              const inc = [...(riderInc || []), ...(endInc || []), ...(!fascia.length && riderInc ? [] : [])];
              add({
                  title: 'Track', type: 'STYLE_SWAP', partHandling: 'Custom', required: true, hideQty: true,
                  finishDataSource: 'master_finishes', useClientPricing: true, stepRole: 'TRACK',
                  styleOptions: track, geometryMap: geom(track),
                  ...(isChoice ? { subLabel: 'Traverse End', subOptions: ends, subGeometryMap: geom(ends) } : {}),
                  ...((fascia.length ? (endInc || []) : inc).length ? { includedParts: fascia.length ? endInc : inc } : {}),
              });
          }

          // ── 2b. SINGLE OR DOUBLE — asked right after the fascia, because it decides which
          //    tracks and which brackets exist. Only when the assembly carries BOTH.
          if (needsSetupStep(allOpts)) add({
              id: 'TRV-SETUP', title: 'Single or Double', type: 'STYLE_SWAP', stepRole: 'TRV_SETUP',
              partHandling: 'Small Parts', required: true, hideQty: true, useClientPricing: true,
              styleOptions: setupsOffered(allOpts).map(t => ({
                  optId: `OPT-SETUP-${t}`, partId: '', partName: t === 'DOUBLE' ? 'Double (two tracks)' : 'Single (one track)',
                  trvSetup: t, price: 0, targetNode: '',
              })),
              geometryMap: {},
          });

          // ── 3. RINGS ONLY ON THE FRONT POLE. On a traverse system the rings belong to the
          //    decorative front pole, never to the track — the carriers do that job inside it.
          rings = rings.filter(o => String(o.position || '').toUpperCase() === 'FRONT');
      }

      // Step 1 = Pole/Rod MATERIAL chooser — ONLY when there's more than one material. With a single
      // material the choice is fixed, so it folds into the combined Length & Finish step below.
      if (centerPole.length > 1) add({ title: 'Pole / Rod Material', type: 'STYLE_SWAP', partHandling: 'Custom', hideQty: true, required: true, useClientPricing: true, styleOptions: centerPole, geometryMap: geom(centerPole) });
      // Length & Finish — always present (the core pole step; carries the pole geometry). When there's a
      // single material, this IS the combined "choose length + finish" step. The calculatorTemplate +
      // title follow the chosen bay configuration so the configurator math matches the flow's fabShape.
      const poleInc = takeIncluded(''); // shared/untagged hidden accessories ride the always-present pole step
      // linkedItemId = the pole ITEM (single-material case): this step's selection is the FINISH, so
      // without it the pricing engine has no physical part to price the per-foot qty against.
      // Multi-material flows (Flat Iron steel/wood; Fabricut once wood/acrylic land): the MATERIAL
      // step above owns the finish (per-option scoped lists), so the Length step is dimensions +
      // footage ONLY — no second finish chooser (type DIMENSIONS carries no dataSource and passes
      // the required-gate without a selection). Single-material keeps the combined Length & Finish
      // step exactly as before.
      // ON A TRAVERSE ASSEMBLY THE FASCIA IS THE POLE STEP. The pole step is otherwise ALWAYS
      // emitted (it carries the core geometry and the fab maths) — but a traverse system with no
      // pole pins would get an empty "Length & Finish" asking for a rod that does not exist. Skip
      // it only in that exact case: a traverse system that DOES have a front pole still gets both.
      if (!(isTraverse && centerPole.length === 0)) add(centerPole.length > 1
          ? { title: bay.poleTitle.replace(/ & Finish/i, ''), type: 'DIMENSIONS', partHandling: 'Custom', calculatorTemplate: bay.calc, qtyHelperText: bay.qtyHelper, required: true, useClientPricing: true, geometryMap: {}, targetNodes: poleNodes, ...(poleInc ? { includedParts: poleInc } : {}) }
          : { title: bay.poleTitle, type: 'VISUAL_DIMENSIONS', dataSource: 'master_finishes', partHandling: 'Custom', calculatorTemplate: bay.calc, qtyHelperText: bay.qtyHelper, required: true, useClientPricing: true, geometryMap: {}, targetNodes: poleNodes, ...(centerPole[0]?.partId ? { linkedItemId: centerPole[0].partId } : {}), ...(poleInc ? { includedParts: poleInc } : {}) });
      // End Treatment comes BEFORE the brackets on purpose: picking a return here can remove that end's
      // outer bracket step (returnHidesBracket), so the customer settles each end first and never picks
      // a bracket that then disappears. It's ALWAYS emitted — even with 0 finials it carries the Mitered
      // / Bent / Flush return options that render the end shape and feed the fab math.
      addEndTreatment(finial, endPole);
      // Part-chooser steps are emitted only when they actually have options — 0-choice steps are skipped.
      addPerPosition(brackets, 'Bracket & Mount', { clone: true, subOpts: backplates, subLabel: 'Backplate', stepRole: 'BRACKET' }); // adds nothing if brackets is empty
      if (looseBackplates.length) addPerPosition(looseBackplates, 'Backplate');
      if (rings.length) add({ title: 'Rings', type: 'STYLE_SWAP', partHandling: 'Small Parts', finishDataSource: 'master_finishes', useClientPricing: true, qtyHelperText: 'Number of rings', styleOptions: rings, geometryMap: geom(rings) });
      // Fee steps — always kept, as-is.
      add({ title: 'Splice', type: 'STATIC_FEE', qtyHelperText: 'Number of splices', basePrice: '0' });
      add({ title: 'Cut / Splice Fee', type: 'STATIC_FEE', qtyHelperText: 'Per cut / splice', basePrice: '0' });

      // SIZE MATRIX: when the assembly's pinned parts belong to a size family (sizeKey stamped by
      // the Fabricut importer), inject the two top-level SIZE steps — Rod Diameter + Bracket
      // Projection — with FIXED ids (SIZE-DIA / SIZE-PROJ) so selections and saved quotes survive
      // regenerates. One flow then covers the whole diameter × projection matrix: CPQ pricing, ERP
      // push and Vision resolve every configured part through Shared/sizeMatrix at quote time.
      const usedParts = [...new Set(pins.map(p => p.partId).filter(Boolean))].map(pid => partsById[pid]).filter(Boolean);
      const sizeFamily = singleMode ? null : sizeFamilyOfParts(usedParts);
      // 🔍 Reviewed matrix → baked + persisted. The SIZE-PROJ step's per-option dias arrays
      // become EXACTLY the checked diameters (explicit even when they match the registry, so the
      // registry fallback can never resurrect an unchecked diameter; a projection checked
      // nowhere is dropped outright). reviewExclusions rides the flow doc: optionKeys re-seed
      // the next review, projMatrix is what taggedProjInchesAtDia serves to the CPQ cards.
      let reviewExclusions = null;
      if (review && fam) {
          const projMatrix = {}; const diasByOpt = {};
          fam.dia.options.forEach(d => {
              projMatrix[d.value] = [];
              fam.proj.options.forEach(po => {
                  if (!review.cells.has(`${d.value}|${po.optId}`)) return;
                  (diasByOpt[po.optId] = diasByOpt[po.optId] || []).push(d.value);
                  if (Number.isFinite(po.inches)) projMatrix[d.value].push(po.inches);
              });
          });
          review.diasByOpt = diasByOpt;
          reviewExclusions = { optionKeys: [...review.excludedKeys].sort(), projMatrix, reviewedAt: ts };
      }
      if (!sizeFamily && singleMode) {
          // 🎯 Per-assembly Projection question FROM THE TAGS (Stuart 2026-07-24: "it needs to
          // check back to the tags on the brackets") — the distinct proj: values across this
          // assembly's options become a top-level PROJ_SELECT step; the pick gates tagged
          // options in CPQ (projTagOk). Zero or one distinct tag = no question needed.
          // Dedupe by PARSED inches — dictionary spellings differ ('6' vs '6.00' made two 6" cards).
          // RETURN-type options are EXCLUDED: their tag is a minimum-depth gate, not a projection
          // the assembly sells — counting them created phantom projection cards (a 4-5/8" card at
          // ½" from the French Return's min tag).
          const byF = new Map();
          [...brackets, ...backplates, ...finial].forEach(o => {
              if (!o.projInches) return;
              const et = String(o.endTreatment || '').toUpperCase();
              if (et === 'FRENCH_RETURN' || et === 'MITER_RETURN' || (o.isFee && /return|miter|mitre|french|bend/i.test(String(o.partName || '')))) return;
              const f = Math.round(parseFloat(String(o.projInches).replace(/[^0-9.]/g, '')) * 1000) / 1000;
              if (Number.isFinite(f) && !byF.has(f)) byF.set(f, String(o.projInches));
          });
          const tagVals = [...byF.entries()].map(([f, raw]) => ({ f, raw })).sort((a, b) => a.f - b.f);
          // ONE distinct bracket projection = no question asked — stamp it as the flow's IMPLIED
          // projection so min-tagged returns still gate against it (½" implies .75 → returns
          // tagged 4-5/8 can never appear). null clears a stale implied value on regenerate.
          groupFields.impliedProjInches = tagVals.length === 1 ? tagVals[0].f : null;
          if (tagVals.length >= 2) {
              const lbl = (f) => f === 0.75 ? '.75" Projection' : f === 3.625 ? '3-5/8" Projection' : f === 4.625 ? '4-5/8" Projection' : f === 6 ? '6" Projection' : `${f}" Projection`;
              steps.unshift({ id: 'PROJ-CHOICE', title: 'Bracket Projection', type: 'PROJ_SELECT', stepRole: 'SIZE', required: true, hideQty: true, styleOptions: tagVals.map(x => ({ optId: `PROJ-${String(x.f).replace(/\./g, '_')}`, partName: lbl(x.f), projInches: x.raw })) });
          }
      }
      if (sizeFamily) {
          const sizeSteps = buildSizeSteps(sizeFamily);
          if (review?.diasByOpt) {
              const ps = sizeSteps.find(s => s.sizeAxis === 'PROJ');
              if (ps) ps.styleOptions = ps.styleOptions.map(o => ({ ...o, dias: review.diasByOpt[o.optId] || [] })).filter(o => o.dias.length);
          }
          steps.unshift(...sizeSteps);
      }

      // Force-hidden meshes = every cluster tagged hidden (e.g. bushings), by cluster id — the runtime
      // + the flow-settings hidden-clusters editor both key on cluster ids. (BOM inclusion of those
      // parts is handled separately via includedParts / hiddenByPos.)
      const newHidden = (asm.nodeClusters || []).filter(c => c.hidden).map(c => c.id);
      // Per-NODE force-hides: choices marked "hide" in the Assembly Builder assign tool (pins with
      // isHiddenPart) — e.g. a stray part the designer left visible. Finer-grained than the
      // cluster-level hiddenClusters; the runtime hides these names unconditionally.
      const hiddenNodes = [...new Set([
          ...pins.filter(p => p.isHiddenPart && p.choiceNode).map(p => String(p.choiceNode).trim()),
          ...prunedClusterNodes.map(n => String(n).trim()).filter(Boolean),
      ])];

      // Diagnostic so a lumped (un-fanned-out) choosable step is instantly explainable: per category,
      // how many clusters vs pins vs pins-carrying-a-choiceNode. Assembly-Builder fan-out needs ≥2
      // choice-pins in ONE cluster; "0 choice-pin(s)" almost always means no item # was entered per
      // choice, so there's nothing telling the generator the finials are separate options.
      const pinDiag = ['FINIAL', 'RING', 'BRACKET', 'BACKPLATE'].map(cat => {
          const cs = clusters.filter(c => catOf(c) === cat);
          if (!cs.length) return null;
          const pn = cs.reduce((s, c) => s + (pinsByCluster[c.id] || []).length, 0);
          const cp = cs.reduce((s, c) => s + (pinsByCluster[c.id] || []).filter(p => p.choiceNode && String(p.choiceNode).trim()).length, 0);
          return `${cat}: ${cs.length} cluster(s), ${pn} pin(s), ${cp} choice-pin(s)`;
      }).filter(Boolean).join('\n• ');

      // ── IN-PLACE REGENERATE ──────────────────────────────────────────────────────────────────
      // Rebuild the STEPS on the existing flow (same id) from the current tags + latest generator
      // logic, then copy per-option prices back by (step title, optId) so nothing priced is lost.
      // Every flow-level setting the user configured (name, ids, fab shape/endStyle/projection, base
      // price, rollup, finishes) is left untouched — only steps + hiddenClusters + bayConfig change.
      if (inPlaceFlowId && oldFlow) {
          const norm = (s) => String(s == null ? '' : s).trim().toUpperCase();
          // Preserve everything the CPQ author set per option that the generator doesn't itself emit:
          // price, layer Z, per-option projection (Vision), the hides-bracket flag, and per-style finish
          // scoping. Matched by (step title || optId) — both are stable across regenerations.
          const USER_OPT_FIELDS = ['price', 'layerZ', 'projection', 'hidesBracket', 'finishAllowedOptions'];
          const oldOptByKey = {}; const oldOptByPart = {}; const feeByTitle = {}; const priceByTitle = {}; const ovrByTitle = {};
          (oldFlow.steps || []).forEach(s => {
              const t = norm(s.title);
              [...(s.styleOptions || []), ...(s.subOptions || [])].forEach(o => {
                  const k = o && (o.optId || o.partId);
                  if (k != null) oldOptByKey[`${t}||${k}`] = o;
                  // Secondary index: optIds embed the cluster id, which CHANGES when the assembly is
                  // re-imported — (title, partId, position) survives that, so authored prices do too.
                  if (o && o.partId) { const pk = `${t}||${o.partId}||${norm(o.position)}`; if (!oldOptByPart[pk]) oldOptByPart[pk] = o; }
              });
              if (s.type === 'STATIC_FEE' && s.basePrice !== undefined) feeByTitle[t] = s.basePrice;
              // Step-level prices the author set survive a regenerate on EVERY step, not just fees.
              if (s.type !== 'STATIC_FEE' && s.basePrice !== undefined && s.basePrice !== '') priceByTitle[t] = s.basePrice;
              if (s.priceOverride !== undefined && s.priceOverride !== '') ovrByTitle[t] = s.priceOverride;
          });
          const applyUser = (opts, t) => (opts || []).map(o => {
              const old = oldOptByKey[`${t}||${o.optId || o.partId}`]
                  || (o.partId ? oldOptByPart[`${t}||${o.partId}||${norm(o.position)}`] : null);
              if (!old) return o;
              const merged = { ...o };
              USER_OPT_FIELDS.forEach(f => { if (old[f] !== undefined) merged[f] = old[f]; });
              return merged;
          });
          const mergedSteps = steps.map(s => {
              const t = norm(s.title);
              const next = { ...s };
              if (next.styleOptions) next.styleOptions = applyUser(next.styleOptions, t);
              if (next.subOptions) next.subOptions = applyUser(next.subOptions, t);
              if (next.type === 'STATIC_FEE' && feeByTitle[t] !== undefined) next.basePrice = feeByTitle[t];
              if (next.type !== 'STATIC_FEE' && priceByTitle[t] !== undefined && (next.basePrice === undefined || next.basePrice === '')) next.basePrice = priceByTitle[t];
              if (ovrByTitle[t] !== undefined && (next.priceOverride === undefined || next.priceOverride === '')) next.priceOverride = ovrByTitle[t];
              return next;
          });
          try {
              await updateDoc(doc(db, "cpq_flows", inPlaceFlowId), stripUndefined({ steps: mergedSteps, hiddenClusters: newHidden, hiddenNodes, bayConfig: bayConfigKey || oldFlow.bayConfig || genBayConfig, sizeFamily: singleMode ? null : (sizeFamily || oldFlow.sizeFamily || null), ...(singleMode ? { singleAssembly: true, ...groupFields } : {}), ...(reviewExclusions ? { reviewExclusions } : {}) }));
              alert(`✅ Regenerated "${oldFlow.name}" in place — ${mergedSteps.length} steps rebuilt from current tags + latest generator logic.\n\nCarried over your per-option settings (price, projection, layer, hides-bracket, finishes) where the option still exists (${Object.keys(oldOptByKey).length} option(s) matched). Flow settings (name, IDs, fab shape/projection, rollup) left untouched. Review any new/changed steps, set prices on anything new, then test.${reviewExclusions ? `\n\n🔍 Review applied — ${reviewExclusions.optionKeys.length} option(s) excluded, projection matrix baked into the SIZE steps. Saved on the flow: the next regenerate pre-checks from this review.` : ''}\n\n[diagnostic — why choices may be lumped]\n• ${pinDiag}`);
          } catch (err) { console.error("Regenerate failed:", err); alert("Regenerate failed: " + (err?.message || err)); }
          return;
      }

      const flowId = `FLOW-${ts}`;
      try {
          await setDoc(doc(db, "cpq_flows", flowId), stripUndefined({
              id: flowId, brandId: activeBrand, name: `${String(asm.itemName || 'HARDWARE').toUpperCase()} — GENERATED`,
              ...(singleMode ? { singleAssembly: true, ...groupFields } : {}),
              legacyErpId: 'PENDING', basePrice: '0', linkedAssemblyId: asm.id, bayConfig: bayConfigKey || genBayConfig,
              fabShape: bay.fabShape, fabEndStyle: bay.endStyle, fabProjection: '', defaultFinishOptions: [],
              hiddenClusters: newHidden, hiddenNodes, steps, sizeFamily: sizeFamily || null,
              ...(reviewExclusions ? { reviewExclusions } : {})
          }));
          setActiveFlowId(flowId);
          const posCount = (arr) => new Set(arr.map(o => o.position || '')).size;
          const bayLabel = { STRAIGHT: 'Straight Pole', FRENCH_RETURN: '1" French Return', MITERED: 'Mitered Bay', BOW: 'Curved Bay' }[genBayConfig] || genBayConfig;
          alert(`Generated "${String(asm.itemName || 'HARDWARE')} — GENERATED" from your tags:\n• Bay configuration: ${bayLabel} → fabShape ${bay.fabShape} + ${bay.calc}\n• Pole materials (center run): ${centerPole.length}${endPole.length ? `\n• End-pole segments: ${endPole.length} → wired into the L/R End Treatment steps (bend vs straight follows each end's pick)` : ''}\n• Bracket+mount options: ${brackets.length} across ${posCount(brackets)} position step(s)\n• Backplates: ${backplates.length} (each position's plates are a 2nd chooser on its bracket step; ${looseBackplates.length} standalone)\n• Finials: ${finial.length} (End Treatment always emitted — carries the Miter/Bend/Flush return options)\n\n${centerPole.length <= 1 ? 'Single pole material → material + length/finish combined into ONE step. ' : ''}fabShape + pole calculator are kept in sync so Vision Hardware math matches. Review + set prices/projection, then test. Nothing was deleted.${reviewExclusions ? `\n\n🔍 Review applied — ${reviewExclusions.optionKeys.length} option(s) excluded, projection matrix baked into the SIZE steps. Saved on the flow: the next regenerate pre-checks from this review.` : ''}\n\n[diagnostic — why choices may be lumped]\n• ${pinDiag}`);
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
              // Size-group flows share ONE rollup name/ERP id across all siblings — cascading
              // that shared name into each ASSEMBLY's legacyErpId would stomp the doc's own code
              // (H2-05 …), which the 🧬 stamper, spec sheets and codeRx grammar parse. Grouped
              // flows keep the link + price sync but leave the assembly's own code alone.
              const isGrouped = !!cpqFlows.find(f => f.id === activeFlowId)?.sizeGroupLabel;
              await updateDoc(doc(db, "Approved_Designs", flowSettings.linkedAssemblyId), {
                  linkedCpqFlowId: activeFlowId,
                  ...(isGrouped ? {} : { legacyErpId: formattedErpId }),
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
      // SIZE GROUPS (Stuart 2026-07-26: "do i save those finishes on all 4?"): one product = one
      // finish palette — applying from ANY sibling stamps EVERY flow in the group in one click
      // (same rule as the shared rollup item), so the diameters can never drift apart. Per-step
      // exceptions can still be hand-edited on a specific flow afterwards.
      const groupLabel = String(activeFlow.sizeGroupLabel || '').trim();
      const targets = groupLabel ? cpqFlows.filter(f => f.sizeGroupLabel === groupLabel) : [activeFlow];
      // Selector steps carry no finish picker: fees, SIZE steps, and the per-assembly Bracket
      // Projection question (PROJ_SELECT) are all questions, not parts.
      const isSelector = (s) => s.type === 'STATIC_FEE' || s.type === SIZE_STEP_TYPE || s.type === 'PROJ_SELECT';
      const eligibleCount = targets.reduce((n, fl) => n + (fl.steps || []).filter(s => !isSelector(s)).length, 0);
      if (eligibleCount === 0) return alert("No steps here can carry a finish (only fees/selectors).");
      if (!window.confirm(groupLabel
          ? `Apply ${def.length} default finish(es) to ALL ${targets.length} ${groupLabel} flows (${targets.map(f => f.sizeGroupChoice || f.name).join(', ')}) — ${eligibleCount} step(s) total? This overwrites each step's current finish list on every sibling.`
          : `Apply ${def.length} default finish(es) to all ${eligibleCount} step(s)? This overwrites each step's current finish list.`)) return;
      try {
          for (const fl of targets) {
              const updatedSteps = (fl.steps || []).map(s => {
                  if (isSelector(s)) return s;
                  if (s.dataSource === 'master_finishes') {
                      // The step's own options ARE finishes — scope them directly.
                      return { ...s, allowedOptions: [...def] };
                  }
                  // Component step — offer the finishes as a secondary picker on the selection.
                  return { ...s, finishDataSource: 'master_finishes', finishAllowedOptions: [...def] };
              });
              await updateDoc(doc(db, "cpq_flows", fl.id), stripUndefined({ steps: updatedSteps, defaultFinishOptions: def }));
          }
          alert(groupLabel
              ? `Applied the ${def.length}-finish palette to all ${targets.length} ${groupLabel} flows (${eligibleCount} step(s)).`
              : `Applied default finishes to ${eligibleCount} step(s).`);
      } catch (err) {
          console.error("Error applying finishes to steps:", err);
          alert("Failed to apply finishes to steps: " + (err?.message || err));
      }
  };

  // Create a 1:1 NetSuite non-inventory (sale) item for this flow, so the ERP push has a
  // dedicated rollup line to bundle all labor + fees into. Stores the returned internal
  // id on the flow doc -> ERPPushPullTab maps to it instead of the hardcoded default.
  // Look up an item's internal id by its (unique) name via SuiteQL. NetSuite returns the
  // id of a newly-created item only in a Location header the proxy doesn't forward, so we
  // resolve the id this way — which also makes create idempotent (re-clicks re-map instead
  // of erroring on NetSuite's unique-itemid rule).
  // NetSuite fetch with polite retries: the account has an integration CONCURRENCY limit, so a
  // burst of activity (item syncs in another tab, the team's CSV imports, other integrations)
  // returns 429 CONCURRENCY_LIMIT_EXCEEDED. That's congestion, not failure — wait and retry
  // (2s / 5s / 10s) before surfacing an error.
  const nsFetchWithRetry = async (body, tries = 4) => {
      let resp, text;
      for (let attempt = 1; attempt <= tries; attempt++) {
          resp = await nsProxyFetch(body);
          text = await resp.text();
          const busy = resp.status === 429 || /CONCURRENCY_LIMIT_EXCEEDED/i.test(text);
          if (!busy || attempt === tries) break;
          await new Promise(r => setTimeout(r, [0, 2000, 5000, 10000][attempt] || 10000));
      }
      let data; try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }
      return { ok: resp.ok, status: resp.status, data };
  };

  const findNsItemIdByName = async (name) => {
      const { ok, data } = await nsFetchWithRetry({
          targetUrl: NS_SUITEQL_URL,
          method: 'POST',
          payload: { q: `SELECT id FROM item WHERE itemid = '${name.replace(/'/g, "''")}'` }
      });
      if (ok && Array.isArray(data.items) && data.items.length > 0) {
          return String(data.items[data.items.length - 1].id);
      }
      return null;
  };

  const handleCreateRollupItem = async () => {
      if (!activeFlowId) return;
      // SIZE GROUPS (per-assembly H2 model, Stuart 2026-07-26: "the combined holding unit"): the
      // per-diameter sibling flows are ONE product, so they share ONE rollup item named after the
      // GROUP — the same precedent as the Fabricut combined flow, where one item covers every
      // diameter and the size lives in the pushed line's description/config. This button creates/
      // maps that single item and stamps EVERY sibling flow in one click; ERPPushPull needs no
      // change (it reads nsRollupItemId per flow, and sharing an id is fine).
      const activeF = cpqFlows.find(f => f.id === activeFlowId);
      const groupLabel = String(activeF?.sizeGroupLabel || '').trim();
      const siblings = groupLabel ? cpqFlows.filter(f => f.sizeGroupLabel === groupLabel) : [];
      const flowName = (groupLabel || flowSettings.name || '').trim().toUpperCase();
      if (!flowName) return alert("Give the flow a name first — the rollup item is named to match it.");
      if (!window.confirm(groupLabel
          ? `Create / map ONE NetSuite rollup item "${flowName}" shared by ALL ${siblings.length} ${groupLabel} flows (${siblings.map(f => f.sizeGroupChoice || f.name).join(', ')})?\n\nEvery configured ${groupLabel} quote rolls its labor + fees into this item regardless of the diameter picked — the inventory parts still push as their own lines. (Safe to re-run — it maps to the existing item if one already exists.)`
          : `Create / map the NetSuite rollup item "${flowName}" for this flow? (Safe to re-run — it maps to the existing item if one already exists.)`)) return;

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
              const { ok: createOk, status: createStatus, data: result } = await nsFetchWithRetry({ targetUrl: `${NS_REST_BASE}/nonInventorySaleItem`, method: 'POST', payload });
              if (!createOk) {
                  const busy = createStatus === 429 || /CONCURRENCY_LIMIT_EXCEEDED/i.test(JSON.stringify(result));
                  throw new Error(busy
                      ? `NetSuite is at its concurrent-request limit right now (another sync/import is running — possibly in another tab or by the team). The app already retried 4×. Wait ~30 seconds and click again; it's safe to re-run.`
                      : `NetSuite rejected [${createStatus}]: ${JSON.stringify(result)}`);
              }

              newId = result.id || result.recordId || result.internalId ||
                  (result.links && result.links[0]?.href ? result.links[0].href.split('/').pop() : null) ||
                  await findNsItemIdByName(flowName);
          }

          if (!newId) throw new Error(`Item created but couldn't resolve its internal id. Look up "${flowName}" in NetSuite and set it manually.`);

          // Fill the flow's ERP Item ID with the item NAME/CODE (= flowName, derived from
          // the master assembly name and used as the rollup item's NetSuite itemid), so the
          // top-of-page field populates automatically and cascades to the master on Save.
          // Size groups: EVERY sibling flow gets the same mapping in one pass.
          const targets = (groupLabel && siblings.length) ? siblings : [{ id: activeFlowId }];
          for (const f of targets) {
              await setDoc(doc(db, "cpq_flows", f.id), {
                  nsRollupItemId: String(newId),
                  nsRollupItemName: flowName,
                  legacyErpId: flowName
              }, { merge: true });
          }
          setFlowSettings(prev => ({ ...prev, nsRollupItemId: String(newId), nsRollupItemName: flowName, legacyErpId: flowName }));
          alert(groupLabel
              ? `✅ ONE rollup item "${flowName}" (NetSuite internal id ${newId}) mapped to all ${targets.length} ${groupLabel} flows. Labor + fees on any diameter's quote roll into it.`
              : `✅ Rollup item "${flowName}" mapped to this flow (NetSuite internal id ${newId}). The ERP Item ID has been set to "${flowName}".`);
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

  const handleAddStepToFlow = async (flow) => {
      if (!newStep.title) return alert("Step title is required");
      // Fees roll into the flow's NetSuite rollup item, so they don't map to a physical
      // part and don't need a Part Handling / Routing division.
      if (newStep.type !== 'STATIC_FEE' && !newStep.partHandling) return alert("❌ ERROR: Part Handling / Routing is required for every step.");

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
  const availableSourceItems = getDataSourceItems(newStep.dataSource);
  const linkedAsm = allApprovedDesigns.find(a => a.id === flowSettings.linkedAssemblyId || a.itemId === flowSettings.linkedAssemblyId);
  // GENERATED-FLOW MODE (Stuart 2026-07-11): a flow with a linked assembly is built by the tag
  // generator — manual step wiring is hidden; only prices, finishes, required and flow settings
  // stay editable, so the old step machinery can't fight the generator.
  const isGeneratedFlow = !!(activeFlow?.linkedAssemblyId || flowSettings.linkedAssemblyId);

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
                    {/* 🧬 SIZE-FAMILY STAMPER — combine sibling assemblies (H2-05/75/1/138) into ONE flow */}
                    <div style={{ border: '1px solid var(--brass)', padding: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--brass)' }}>🧬 Size-Family Stamper v4 — one flow per family</div>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', minWidth: 0 }}>
                            {/* minWidth:0 everywhere: a <select> with long option text refuses to shrink in flex
                                (min-width:auto), overflowed the 350px column, and pushed the Scan button UNDER
                                the right-hand pane — visible but click-dead. */}
                            <select value={stampFam} onChange={e => { setStampFam(e.target.value); setStampPreview(null); }} title={SIZE_STAMP_RULES[stampFam]?.note || ''} style={{ flex: 1, minWidth: 0, maxWidth: '100%', padding: '7px', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '0.75rem', outline: 'none', background: '#fff' }}>
                                {Object.keys(SIZE_STAMP_RULES).map(f => <option key={f} value={f}>{f} — {SIZE_STAMP_RULES[f].note}</option>)}
                            </select>
                            <button onClick={scanSizeStamps} disabled={stampBusy} style={{ padding: '7px 12px', background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)', cursor: stampBusy ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase' }}>{stampBusy ? '⟳…' : '🔍 Scan'}</button>
                        </div>
                        {stampPreview && (
                            <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink)', lineHeight: 1.7, background: 'var(--paper-2)', border: '1px solid var(--line)', padding: '8px 10px' }}>
                                <div>Scanned {stampPreview.scanned} item{stampPreview.scanned === 1 ? '' : 's'} · matched {stampPreview.rows.length + stampPreview.already} · new to stamp {stampPreview.rows.length}{stampPreview.already ? ` · already stamped ${stampPreview.already}` : ''}</div>
                                {stampPreview.rows.length > 0 && (
                                    <div>To stamp: {Object.entries(stampPreview.byDia).map(([d, n]) => `dia ${d} × ${n}`).join(' · ')}
                                        <button onClick={applySizeStamps} disabled={stampBusy} style={{ marginLeft: '8px', padding: '6px 12px', background: 'var(--brass)', color: '#fff', border: 'none', cursor: stampBusy ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase' }}>{stampBusy ? '⟳ Stamping…' : `✓ Stamp ${stampPreview.rows.length}`}</button>
                                    </div>
                                )}
                                {stampPreview.rows.length === 0 && stampPreview.already > 0 && <div style={{ color: '#3a7d44' }}>All matching items already carry {stampFam} keys — generate from the ¾" master below (regenerate if the flow predates the stamps).</div>}
                                {stampPreview.rows.length === 0 && !stampPreview.already && <div style={{ color: '#d9534f' }}>0 items matched the {stampFam} code grammar in this brand.</div>}
                                {stampPreview.nearMiss && stampPreview.nearMiss.length > 0 && (
                                    <div style={{ color: '#d9534f', overflowWrap: 'anywhere' }}>Near-misses (start with the family prefix but don't parse — this is the code-shape clue): {stampPreview.nearMiss.join(', ')}</div>
                                )}
                            </div>
                        )}
                        <div style={{ fontFamily: 'var(--sans)', fontSize: '0.72rem', color: 'var(--ink-soft)' }}>Stamp once → pick the ¾" master (H2-75) below → Generate. Diameter + Projection steps inject automatically; every option resolves to the chosen size.</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <select value={generateAsmId} onChange={e => setGenerateAsmId(e.target.value)} title="Master Assembly to build the flow from" style={{ padding: '8px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.82rem', outline: 'none', background: '#fff' }}>
                            <option value="">— assembly to generate from —</option>
                            {masterAssemblies.map(a => <option key={a.id} value={a.id}>{a.itemName}{a.legacyErpId ? ` [${a.legacyErpId}]` : ''}</option>)}
                        </select>
                        <label title="THIS ASSEMBLY'S TAGS ONLY (Stuart 2026-07-24): no family union, no review gate, no Rod Diameter/Projection steps — the flow contains exactly what's pinned on this one assembly. The flow is stamped with its size group (from the assembly code), so CPQ collapses the sibling flows into one 'pick rod diameter first' landing entry. Generate one flow per diameter this way." style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.05em', color: genSingleAsm ? 'var(--brass)' : 'var(--ink-soft)', cursor: 'pointer' }}>
                            <input type="checkbox" checked={genSingleAsm} onChange={e => setGenSingleAsm(e.target.checked)} style={{ width: '15px', height: '15px', margin: 0, cursor: 'pointer' }} />
                            🎯 Single-assembly flow — this assembly's tags only (per-diameter; no union, no size steps)
                        </label>
                        <select value={genBayConfig} onChange={e => setGenBayConfig(e.target.value)} title="Bay configuration the generated flow is stamped with — sets the flow's fabShape AND the pole calculator together so Vision Hardware's bay math matches the configurator. Generate once per configuration (e.g. a separate Mitered Bay / Curved Bay flow for the same assembly)." style={{ padding: '8px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.82rem', outline: 'none', background: '#fff' }}>
                            <option value="STRAIGHT">Bay config: Straight Pole</option>
                            <option value="FRENCH_RETURN">Bay config: 1" French Return (bent ends)</option>
                            <option value="MITERED">Bay config: Mitered Bay (Wall A/B/C)</option>
                            <option value="BOW">Bay config: Curved Bay (arc)</option>
                        </select>
                        <button onClick={() => handleGenerateHardwareFlow()} title="Build a complete hardware flow automatically from the picked assembly's Node-Grouping tags — no hand-picking pins" style={{ background: 'var(--brass)', color: '#fff', border: 'none', padding: '12px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>⚙ Generate Flow from Tags</button>
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
                                {flowSettings.linkedAssemblyId && (
                                    <div style={{ marginTop: '12px' }}>
                                        <button onClick={() => { if (window.confirm("Regenerate this flow's steps from the linked assembly's current tags + the latest generator logic?\n\nPrices are kept for options that still exist. All flow settings (name, IDs, fab shape/projection, rollup) stay. New or changed steps may need prices set. Nothing is deleted — the flow keeps its id, so BOM/CPQ links are preserved.")) handleGenerateHardwareFlow({ inPlaceFlowId: activeFlowId }); }} style={{ width: '100%', padding: '12px 24px', background: 'transparent', color: 'var(--brass)', border: '1px solid var(--brass)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>↻ Regenerate Steps from Tags (keep prices)</button>
                                        <span style={{ display: 'block', marginTop: '6px', fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)' }}>Rebuilds steps in place from the assembly's tags + latest generator logic — no delete, prices &amp; settings kept. Use this after retagging or a generator update instead of delete + regenerate.</span>
                                    </div>
                                )}
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 20px 0', borderBottom: '1px solid var(--line)', paddingBottom: '15px' }}>
                                <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500 }}>Configure Steps</h3>
                                <button onClick={() => document.getElementById('main-assembly-settings')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} style={{ padding: '10px 16px', background: '#fff', color: 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.05em', whiteSpace: 'nowrap' }}>↑ Main Assembly Settings</button>
                            </div>

                            {isGeneratedFlow && !newStep.id && (
                                <div style={{ background: 'var(--paper)', border: '1px solid var(--brass)', padding: '18px 22px', marginBottom: '30px', borderRadius: '2px' }}>
                                    <span style={{ fontFamily: 'var(--serif)', fontSize: '1.05rem', color: 'var(--ink)' }}>Generated flow — steps are built from the linked assembly's tags.</span>
                                    <span style={{ display: 'block', fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '6px' }}>Model + tag in 1.5 / 1.6, then ↻ Regenerate above. Click a step's EDIT to set option prices and finish scoping (both survive regenerates). Manual step-building is off for generated flows.</span>
                                </div>
                            )}
                            {(!isGeneratedFlow || newStep.id) && (
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
                                    <input value={newStep.title} disabled={isGeneratedFlow} title={isGeneratedFlow ? 'Generated step — the title is the regenerate match key; it comes from the tags.' : undefined} onChange={e => setNewStep({...newStep, title: e.target.value})} placeholder="Step Title (e.g. Select Bracket Style)" style={{ padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', opacity: isGeneratedFlow ? 0.6 : 1 }} />
                                    
                                    {!isGeneratedFlow && (
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
                                    )}

                                    {!isGeneratedFlow && (newStep.type === 'VISUAL_DIMENSIONS' || newStep.type === 'DIMENSIONS' || newStep.calculatorTemplate) && (
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

                                    {!isGeneratedFlow && (
                                    <div style={{ background: '#fff', padding: '15px', border: '1px solid var(--line)' }}>
                                        <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Helper Text</label>
                                        <input 
                                            value={newStep.qtyHelperText || ''} 
                                            onChange={e => setNewStep({...newStep, qtyHelperText: e.target.value})} 
                                            placeholder="e.g. Enter 4 rings per foot."
                                            style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }}
                                        />
                                    </div>
                                    )}

                                    {!isGeneratedFlow && newStep.type === 'STYLE_SWAP' && (
                                    <div style={{ background: '#fff', padding: '15px', border: '1px solid var(--line)' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                            <input type="checkbox" checked={!!newStep.isCenterClone} onChange={e => setNewStep({...newStep, isCenterClone: e.target.checked})} />
                                            <span style={{ fontSize: '0.85rem', color: 'var(--ink)' }}>Clone along pole (center passing bracket)</span>
                                        </label>
                                        <span style={{ fontSize: '0.72rem', color: 'var(--ink-soft)', display: 'block', marginTop: '6px' }}>The selected bracket is cloned by this step's quantity and spaced evenly down the pole in the live rendering. Only one center bracket needs to exist in the .glb (at the middle of the pole).</span>
                                    </div>
                                    )}

                                    {isGeneratedFlow && newStep.type === 'STATIC_FEE' && (
                                    <div style={{ background: '#fff', padding: '20px', border: '1px solid var(--line)' }}>
                                        <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '10px' }}>Fee Amount ($)</label>
                                        <input type="number" step="0.01" value={newStep.basePrice !== undefined && newStep.basePrice !== null && newStep.basePrice !== '' ? newStep.basePrice : ''} onChange={e => setNewStep({...newStep, basePrice: e.target.value})} placeholder="0.00" style={{ width: '200px', padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} />
                                    </div>
                                    )}
                                    {!isGeneratedFlow && newStep.type !== 'STYLE_SWAP' && (
                                    <div style={{ background: '#fff', padding: '20px', border: '1px solid var(--line)' }}>
                                        <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '15px' }}>Item Mapping & Base Price</label>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                            <div>
                                                 <label style={{ fontSize: '0.85rem', color: 'var(--ink)', display: 'block', marginBottom: '6px' }}>Link to Library Item</label>
                                                 {(() => {
                                                     const codeOf = (p) => String((p.legacyErpId && !['PENDING', 'N/A'].includes(String(p.legacyErpId).toUpperCase())) ? p.legacyErpId : (p.itemId || p.id || '')).toUpperCase();
                                                     const selId = newStep.linkedItemId || newStep.linkedPinId || '';
                                                     const linked = selId && allApprovedDesigns.find(p => p.id === selId || p.itemId === selId || p.legacyErpId === selId);
                                                     const linkItem = (part) => {
                                                         const specs = part?.manufacturingSpecs || {};
                                                         const bp = specs.basePrice !== undefined && specs.basePrice !== "" ? parseFloat(specs.basePrice) : 0;
                                                         setNewStep(prev => ({ ...prev, linkedItemId: part.id, linkedPinId: part.id, basePrice: bp > 0 ? bp : 0 }));
                                                         setLinkItemSearch("");
                                                     };
                                                     if (linked) return (
                                                         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', padding: '10px', border: '1px solid var(--brass)', background: 'var(--paper-2)' }}>
                                                             <span style={{ fontFamily: 'var(--sans)', fontSize: '0.9rem', color: 'var(--ink)' }}><b style={{ fontFamily: 'var(--mono)' }}>{codeOf(linked)}</b> — {linked.itemName}</span>
                                                             <button onClick={() => setNewStep(prev => ({ ...prev, linkedItemId: '', linkedPinId: '' }))} title="Clear" style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', fontSize: '1.2rem', cursor: 'pointer', lineHeight: 1 }}>×</button>
                                                         </div>
                                                     );
                                                     const term = linkItemSearch.trim().toLowerCase();
                                                     const matches = !term ? [] : allApprovedDesigns
                                                         .filter(p => (p.partClass === 'Inventory' || p.partClass === 'Assembly') && (codeOf(p).toLowerCase().includes(term) || String(p.itemName || '').toLowerCase().includes(term)))
                                                         .sort((a, b) => codeOf(a).localeCompare(codeOf(b), undefined, { numeric: true, sensitivity: 'base' }))
                                                         .slice(0, 50);
                                                     return (
                                                         <div>
                                                             <input value={linkItemSearch} onChange={e => setLinkItemSearch(e.target.value)} placeholder="Search by item # or name…" style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', boxSizing: 'border-box' }} />
                                                             {term && (
                                                                 <div style={{ maxHeight: '220px', overflowY: 'auto', border: '1px solid var(--line)', borderTop: 'none' }}>
                                                                     {matches.map(p => (
                                                                         <div key={p.id} onClick={() => linkItem(p)} style={{ padding: '9px 12px', cursor: 'pointer', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                                                                             <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink)', fontWeight: 600 }}>{codeOf(p)}</span>
                                                                             <span style={{ fontFamily: 'var(--sans)', fontSize: '0.85rem', color: 'var(--ink-soft)', textAlign: 'right' }}>{p.itemName}</span>
                                                                         </div>
                                                                     ))}
                                                                     {matches.length === 0 && <div style={{ padding: '10px 12px', fontStyle: 'italic', color: 'var(--ink-soft)', fontSize: '0.85rem' }}>No matches.</div>}
                                                                 </div>
                                                             )}
                                                         </div>
                                                     );
                                                 })()}
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

                                    {!isGeneratedFlow && newStep.dataSource && availableSourceItems.length > 0 && newStep.type !== 'DIMENSIONS' && newStep.type !== 'STATIC_FEE' && (
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
                                                                    <span style={{ color: 'var(--ink-soft)', fontSize: '0.8rem' }}>$</span>
                                                                    <input type="number" step="0.01" value={o.price !== undefined && o.price !== null ? o.price : ''} placeholder="item"
                                                                        title="Author price override for this option (per foot on a Pole/Rod Material step). 0 or blank = price from the item itself (finish variant, then base). Persisted by Save Step below."
                                                                        onChange={(e) => { const v = e.target.value; setNewStep(prev => ({ ...prev, styleOptions: (prev.styleOptions || []).map(x => (x.optId || x.partId) === okey ? { ...x, price: v === '' ? '' : (parseFloat(v) || 0) } : x) })); }}
                                                                        style={{ width: '84px', padding: '5px 6px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', fontSize: '0.85rem' }} />
                                                                    <label title="When this option is the customer's pick, hide this step's position outer Bracket & Mount step (e.g. a french return that replaces the end bracket). Leave OFF to keep the bracket step — e.g. when you still offer french-return backplates there." style={{ display: 'flex', alignItems: 'center', gap: '4px', fontFamily: 'var(--mono)', fontSize: '8px', letterSpacing: '.05em', textTransform: 'uppercase', color: o.hidesBracket ? 'var(--brass)' : 'var(--ink-soft)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                                                        <input type="checkbox" checked={!!o.hidesBracket} onChange={(e) => setNewStep(prev => ({ ...prev, styleOptions: (prev.styleOptions || []).map(x => (x.optId || x.partId) === okey ? { ...x, hidesBracket: e.target.checked } : x) }))} style={{ cursor: 'pointer' }} />
                                                                        hides bracket
                                                                    </label>
                                                                    <button onClick={() => setNewStep(prev => { const opts = (prev.styleOptions || []).filter(x => (x.optId || x.partId) !== okey); const geometryMap = {}; opts.forEach(x => { geometryMap[x.optId || x.partId] = x.targetNode; }); return { ...prev, styleOptions: opts, geometryMap }; })} title="Remove this option" style={{ background: 'transparent', border: 'none', color: '#d9534f', fontSize: '1.1rem', lineHeight: 1, cursor: 'pointer', padding: '0 6px' }}>×</button>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                    <div style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', marginTop: '8px', fontStyle: 'italic' }}>Add more by checking BOM components below. Custom options not in the BOM (e.g. Wood / Metal rod, which have no library part yet) live here and aren't shown as checkboxes.</div>
                                                </div>
                                            )}

                                            {isGeneratedFlow ? (
                                                <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>Generated flow — options come from the assembly's tags (Regenerate to add/remove them). Set each option's price in the list above, then Save Step. The BOM-pin checkboxes are disabled here: they key options differently and would create duplicates alongside the generated ones.</div>
                                            ) : !flowSettings.linkedAssemblyId ? (
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

                                    {!isGeneratedFlow && (newStep.type === 'STATIC_FEE' ? (
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
                                    ))}

                                    {!isGeneratedFlow && (
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
                                    )}

                                    {!isGeneratedFlow && optionsToMap.length > 0 && optionsToMap.length < 100 && newStep.type !== 'DIMENSIONS' && newStep.type !== 'STATIC_FEE' && (
                                        <div style={{ background: '#fff', padding: '20px', border: '1px solid var(--line)' }}>
                                            <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: '15px' }}>Option Properties</div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', maxHeight: '300px', overflowY: 'auto' }}>
                                                <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>Option Name</div>
                                                <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>Upcharge ($)</div>
                                                
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
                                        <button onClick={() => handleAddStepToFlow(activeFlow)} disabled={(newStep.type !== 'STATIC_FEE' && !newStep.partHandling) || (newStep.type === 'STYLE_SWAP' ? !(newStep.styleOptions && newStep.styleOptions.length) : ((newStep.type !== 'DIMENSIONS' && newStep.type !== 'STATIC_FEE') && !newStep.dataSource))} style={{ flex: 1, padding: '15px', background: (newStep.type !== 'STATIC_FEE' && !newStep.partHandling) ? 'var(--ink-soft)' : 'var(--ink)', color: '#fff', border: 'none', cursor: (newStep.type !== 'STATIC_FEE' && !newStep.partHandling) ? 'not-allowed' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
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
                            )}

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
                                            {!isGeneratedFlow && (<>
                                            <button onClick={() => handleMoveStep(activeFlow, idx, 'UP')} disabled={idx === 0} style={{ padding: '8px', cursor: idx === 0 ? 'not-allowed' : 'pointer', background: 'var(--paper-2)', border: '1px solid var(--line)' }}>⬆️</button>
                                            <button onClick={() => handleMoveStep(activeFlow, idx, 'DOWN')} disabled={idx === activeFlow.steps.length - 1} style={{ padding: '8px', cursor: idx === activeFlow.steps.length - 1 ? 'not-allowed' : 'pointer', background: 'var(--paper-2)', border: '1px solid var(--line)' }}>⬇️</button></>)}
                                            <button onClick={() => setNewStep(step)} style={{ padding: '8px 20px', background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', marginLeft: '10px' }}>Edit</button>
                                            {!isGeneratedFlow && (<button onClick={() => handleDeleteStep(activeFlow, step.id)} style={{ padding: '8px 20px', background: 'transparent', color: '#d9534f', border: '1px solid #d9534f', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase' }}>Del</button>)}
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

              {/* LIVE FORM PREVIEW — reflects the header/footer/terms above + the brand logo, with the
                  doc number printed and barcoded at the bottom (the NetSuite spine on every form). */}
              <div style={{ marginTop: '30px', background: 'var(--paper)', border: '1px solid var(--line)', padding: '24px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', marginBottom: '24px' }}>
                      <h4 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500 }}>Live Preview — {activeFormType.replace('_', ' ')}</h4>
                      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
                          <label style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              Brand
                              <select value={previewBrand} onChange={e => setPreviewBrand(e.target.value)} style={{ padding: '8px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', background: '#fff' }}>
                                  {BRANDS_LIST.map(b => <option key={b} value={b}>{b.toUpperCase()}</option>)}
                              </select>
                          </label>
                          <label style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              Sample No.
                              <input value={previewDocNum} onChange={e => setPreviewDocNum(e.target.value)} style={{ padding: '8px', border: '1px solid var(--line)', fontFamily: 'var(--mono)', width: '140px' }} />
                          </label>
                          <button onClick={() => printForm(<FormPreview type={activeFormType} brand={previewBrand} logoUrl={brandLogos[previewBrand]} header={formEditor.header} footer={formEditor.footer} terms={formEditor.terms} docNumber={previewDocNum} />, `${activeFormType.replace('_', ' ')} ${previewDocNum}`)} style={{ padding: '10px 16px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>🖨 Print</button>
                      </div>
                  </div>
                  <div style={{ overflowX: 'auto', paddingBottom: '10px' }}>
                      <FormPreview type={activeFormType} brand={previewBrand} logoUrl={brandLogos[previewBrand]} header={formEditor.header} footer={formEditor.footer} terms={formEditor.terms} docNumber={previewDocNum} />
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
                                {allRoles.map(r => (<th key={r} style={{ padding: '15px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{r.replace(/_/g, ' ')}</th>))}
                            </tr>
                        </thead>
                        <tbody>
                            {TABS.map(tab => (
                            <tr key={tab} style={{ borderBottom: '1px solid var(--line)' }}>
                                <td style={{ padding: '15px', textAlign: 'left', color: 'var(--ink)', fontWeight: 500 }}>{pickTabLabel(tab)}</td>
                                {allRoles.map(role => (
                                    <td key={role} style={{ padding: '15px' }}>
                                        <input type="checkbox" checked={hqPerms[role]?.includes(tab) || false} onChange={() => handleHqPermToggle(role, tab)} style={{ cursor: 'pointer' }} />
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
                                {allRoles.map(r => (<th key={r} style={{ padding: '15px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{r.replace(/_/g, ' ')}</th>))}
                            </tr>
                        </thead>
                        <tbody>
                            {SHOP_TABS.map(tab => (
                            <tr key={tab} style={{ borderBottom: '1px solid var(--line)' }}>
                                <td style={{ padding: '15px', textAlign: 'left', color: 'var(--ink)', fontWeight: 500 }}>{pickTabLabel(tab)}</td>
                                {allRoles.map(role => (
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
                                {allRoles.map(r => (<th key={r} style={{ padding: '15px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{r.replace(/_/g, ' ')}</th>))}
                            </tr>
                        </thead>
                        <tbody>
                            {FIN_TABS.map(tab => (
                            <tr key={tab} style={{ borderBottom: '1px solid var(--line)' }}>
                                <td style={{ padding: '15px', textAlign: 'left', color: 'var(--ink)', fontWeight: 500 }}>{pickTabLabel(tab)}</td>
                                {allRoles.map(role => (
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
                                {allRoles.map(r => (<th key={r} style={{ padding: '15px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{r.replace(/_/g, ' ')}</th>))}
                            </tr>
                        </thead>
                        <tbody>
                            {PICK_TABS.map(tab => (
                            <tr key={tab} style={{ borderBottom: '1px solid var(--line)' }}>
                                <td style={{ padding: '15px', textAlign: 'left', color: 'var(--ink)', fontWeight: 500 }}>{pickTabLabel(tab)}</td>
                                {allRoles.map(role => (
                                    <td key={role} style={{ padding: '15px' }}>
                                        <input type="checkbox" checked={pickPerms[role]?.includes(tab) || false} onChange={() => handlePickPermToggle(role, tab)} style={{ cursor: 'pointer' }} />
                                    </td>
                                ))}
                            </tr>
                            ))}
                            {/* Behaviour toggle (not a tab): force this role to SCAN bins — hides the click-to-pick chips. */}
                            <tr style={{ borderTop: '2px solid var(--ink)', background: 'var(--paper)' }}>
                                <td style={{ padding: '15px', textAlign: 'left', color: 'var(--ink)', fontWeight: 600 }}>🔒 Force Bin Scan <span style={{ fontWeight: 400, color: 'var(--ink-soft)', fontSize: '0.8rem' }}>(hide click-to-pick)</span></td>
                                {allRoles.map(role => (
                                    <td key={role} style={{ padding: '15px' }}>
                                        <input type="checkbox" checked={(pickPerms.forceScanRoles || []).includes(role)} onChange={() => handleForceScanToggle(role)} disabled={['admin', 'superadmin'].includes(role)} title={['admin', 'superadmin'].includes(role) ? 'Admins always keep click-to-pick' : ''} style={{ cursor: ['admin', 'superadmin'].includes(role) ? 'not-allowed' : 'pointer' }} />
                                    </td>
                                ))}
                            </tr>
                            {/* Behaviour toggle: which roles can see the management-only chip reports (timers + roll-up). */}
                            <tr style={{ background: 'var(--paper)' }}>
                                <td style={{ padding: '15px', textAlign: 'left', color: 'var(--ink)', fontWeight: 600 }}>📊 Chip Reports <span style={{ fontWeight: 400, color: 'var(--ink-soft)', fontSize: '0.8rem' }}>(mgmt: timers + who-did-what)</span></td>
                                {allRoles.map(role => (
                                    <td key={role} style={{ padding: '15px' }}>
                                        <input type="checkbox" checked={['admin', 'superadmin'].includes(role) || (pickPerms.chipReportRoles || []).includes(role)} onChange={() => handleChipReportToggle(role)} disabled={['admin', 'superadmin'].includes(role)} title={['admin', 'superadmin'].includes(role) ? 'Admins always see reports' : ''} style={{ cursor: ['admin', 'superadmin'].includes(role) ? 'not-allowed' : 'pointer' }} />
                                    </td>
                                ))}
                            </tr>
                        </tbody>
                        </table>
                    </div>
                </div>

              </div>

              <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '30px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', gap: '16px', flexWrap: 'wrap' }}>
                  <h4 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500 }}>Global User Directory</h4>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>
                    {finUsers.length} legacy Finishing user{finUsers.length === 1 ? '' : 's'} on file
                    {finToImport.length > 0
                      ? <button onClick={importFinishingUsers} style={{ marginLeft: '12px', padding: '9px 16px', background: 'var(--brass)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>⇩ Import {finToImport.length} missing into HQ</button>
                      : <span style={{ marginLeft: '12px', color: '#3a7d44' }}>✓ all present in HQ directory</span>}
                    {finOfficeUsers.length > 0 && <button onClick={purgeOfficeFromFin} title="Remove office users from the finishing (chip PIN) directory" style={{ marginLeft: '12px', padding: '9px 16px', background: 'transparent', color: '#d9534f', border: '1px solid #d9534f', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>✖ Remove {finOfficeUsers.length} office from floor list</button>}
                    <button onClick={syncDirectory} disabled={syncingDir} title="Rebuild the sanitized name/role directory the floor apps read (no PINs exposed). Safe to re-run." style={{ marginLeft: '12px', padding: '9px 16px', background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', cursor: syncingDir ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>{syncingDir ? 'Syncing…' : '⟳ Sync Directory'}</button>
                  </div>
                </div>
                {/* ===== DAILY SIGN-IN ACCOUNTS (OUTER GATE) — no more Firebase console ===== */}
                <div style={{ border: '1px solid var(--line)', background: 'var(--paper)', padding: '20px', marginBottom: '26px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px', flexWrap: 'wrap', gap: '10px' }}>
                    <h4 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500 }}>✉ Daily Sign-In Accounts</h4>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em' }}>{staffLogins.length} account{staffLogins.length === 1 ? '' : 's'} · the email gate in front of the PIN screen</span>
                  </div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--ink-soft)', lineHeight: 1.6, marginBottom: '16px' }}>
                    Each person needs an email account here <em>and</em> a PIN row below. Create the login, send them the setup link (they choose their own password), then add their PIN + role underneath. Allowed domains: <span style={{ fontFamily: 'var(--mono)', fontSize: '0.75rem', color: 'var(--ink)' }}>{ALLOWED_LOGIN_DOMAINS.join(' · ')}</span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '2.2fr 1.6fr 1.4fr auto', gap: '10px', alignItems: 'stretch' }}>
                    <input value={loginForm.email} onChange={e => setLoginForm({ ...loginForm, email: e.target.value })} placeholder="name@classicalelements.com" style={{ padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} />
                    <input value={loginForm.name} onChange={e => setLoginForm({ ...loginForm, name: e.target.value })} placeholder="Display name" style={{ padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} />
                    <select value={loginForm.pin} onChange={e => setLoginForm({ ...loginForm, pin: e.target.value })} title="Optionally tie this login to a person's PIN row so the table below shows who still needs an account" style={{ padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }}>
                      <option value="">Link to PIN… (optional)</option>
                      {users.map(u => <option key={u.id} value={u.pin || u.id}>{u.name}</option>)}
                    </select>
                    <button onClick={handleCreateLogin} disabled={loginBusy === 'create'} style={{ padding: '12px 22px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: loginBusy === 'create' ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' }}>{loginBusy === 'create' ? 'Creating…' : '+ Create Login'}</button>
                  </div>

                  {/* Outside collaborators: contract engineers etc. Granted per EXACT address — never
                      by adding their domain, which would admit everyone at that provider. */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginTop: '10px', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--ink)' }}>
                      <input type="checkbox" checked={loginForm.external} onChange={e => setLoginForm({ ...loginForm, external: e.target.checked, expires: e.target.checked && !loginForm.expires ? new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) : loginForm.expires })} style={{ width: '15px', height: '15px', cursor: 'pointer' }} />
                      Outside collaborator <span style={{ color: 'var(--ink-soft)' }}>(non-company email — grants this one address)</span>
                    </label>
                    {loginForm.external && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
                        Access until
                        <input type="date" value={loginForm.expires} onChange={e => setLoginForm({ ...loginForm, expires: e.target.value })} style={{ padding: '7px 10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} />
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '9px' }}>blank = no expiry</span>
                      </label>
                    )}
                  </div>

                  {inviteLink && (
                    <div style={{ marginTop: '14px', padding: '14px', background: '#fff', border: '1px solid var(--brass)' }}>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--brass)', marginBottom: '8px' }}>Password setup link · {inviteLink.email} · copied to your clipboard</div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', wordBreak: 'break-all', lineHeight: 1.5 }}>{inviteLink.link}</div>
                      <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                        <button onClick={() => copyInvite(inviteLink.link)} style={{ padding: '8px 14px', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em' }}>Copy again</button>
                        <button onClick={() => setInviteLink(null)} style={{ padding: '8px 14px', background: 'transparent', border: 'none', color: 'var(--ink-soft)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em' }}>Dismiss</button>
                      </div>
                    </div>
                  )}

                  {staffLogins.length > 0 && (
                    <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {[...staffLogins].sort((a, b) => String(a.email).localeCompare(String(b.email))).map(l => {
                        const person = users.find(u => String(u.pin || u.id) === String(l.pin || ''));
                        const off = l.active === false;
                        return (
                          <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '11px 14px', background: '#fff', border: '1px solid var(--line)', opacity: off ? 0.55 : 1 }}>
                            <span style={{ flex: 1, color: 'var(--ink)', fontSize: '0.9rem' }}>{l.email}</span>
                            <span style={{ flex: 1, color: 'var(--ink-soft)', fontSize: '0.85rem' }}>{person ? `${person.name} · PIN row linked` : (l.name || '')}</span>
                            {l.external && (() => {
                                const expired = l.expiresAt && Date.now() > Number(l.expiresAt);
                                return (
                                    <span title={l.expiresAt ? `Outside collaborator · access ${expired ? 'EXPIRED' : 'until'} ${new Date(Number(l.expiresAt)).toLocaleDateString()}` : 'Outside collaborator · no expiry set'}
                                        style={{ fontFamily: 'var(--mono)', fontSize: '8px', textTransform: 'uppercase', letterSpacing: '.08em', color: expired ? '#d9534f' : 'var(--brass)', border: `1px solid ${expired ? '#d9534f' : 'var(--brass)'}`, padding: '3px 7px', whiteSpace: 'nowrap' }}>
                                        {expired ? 'Expired' : 'Outside'}{l.expiresAt && !expired ? ` · ${new Date(Number(l.expiresAt)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}
                                    </span>
                                );
                            })()}
                            {l.external && <button onClick={() => handleAccessChange(l, 'extend')} disabled={loginBusy === l.id} title="Change or clear the expiry date" style={{ padding: '6px 10px', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase' }}>Expiry</button>}
                            {l.external && <button onClick={() => handleAccessChange(l, 'revoke')} disabled={loginBusy === l.id} title="End outside access now (account kept — re-grant any time)" style={{ padding: '6px 10px', background: 'transparent', border: '1px solid #d9534f', color: '#d9534f', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase' }}>Revoke</button>}
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', color: off ? '#d9534f' : '#3a7d44', width: '70px' }}>{off ? 'Disabled' : 'Active'}</span>
                            <button onClick={() => handleReinvite(l)} disabled={loginBusy === l.id} title="New password-setup link (new hire, or they forgot it)" style={{ padding: '6px 12px', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase' }}>Setup link</button>
                            <button onClick={() => handleToggleLogin(l)} disabled={loginBusy === l.id} style={{ padding: '6px 12px', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase' }}>{off ? 'Enable' : 'Disable'}</button>
                            <button onClick={() => handleDeleteLogin(l)} disabled={loginBusy === l.id} title="Delete this sign-in account (the PIN row is untouched)" style={{ background: 'transparent', border: 'none', color: '#d9534f', fontSize: '1.1rem', cursor: 'pointer' }}>🗑️</button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Accounts made by hand in the Firebase console before this panel existed. */}
                  <div style={{ marginTop: '14px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <button onClick={scanUnlinked} disabled={loginBusy === 'scan'} title="Find company accounts that exist in Firebase Auth but aren't listed here (the ones you created in the console)" style={{ padding: '9px 16px', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em' }}>{loginBusy === 'scan' ? 'Scanning…' : '⌕ Find console-made accounts'}</button>
                    {unlinkedLogins && unlinkedLogins.length > 0 && (
                      <>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)' }}>{unlinkedLogins.length} unlisted: {unlinkedLogins.slice(0, 4).map(u => u.email).join(', ')}{unlinkedLogins.length > 4 ? '…' : ''}</span>
                        <button onClick={adoptUnlinked} disabled={loginBusy === 'adopt'} style={{ padding: '9px 16px', background: 'var(--brass)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em' }}>{loginBusy === 'adopt' ? 'Linking…' : `⇩ Link all ${unlinkedLogins.length} into this list`}</button>
                      </>
                    )}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 2fr', gap: '15px', marginBottom: '20px' }}>
                  <input value={adminForm.uName} onChange={e => setAdminForm({...adminForm, uName: e.target.value})} placeholder="User Name" disabled={!!adminForm.oldId} style={{ padding: '12px', border: '1px solid var(--line)', background: adminForm.oldId ? 'var(--paper)' : '#fff', outline: 'none', fontFamily: 'var(--sans)' }} />
                  <input value={adminForm.uPin} onChange={e => setAdminForm({...adminForm, uPin: e.target.value})} placeholder="4-Digit PIN" maxLength="4" style={{ padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} />
                  <select value={adminForm.uRole} onChange={e => setAdminForm({...adminForm, uRole: e.target.value})} style={{ padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }}>{allRoles.map(r => <option key={r} value={r}>{r.toUpperCase().replace(/_/g, ' ')}</option>)}</select>
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
                          <th title="Has a daily email sign-in account (OuterGate). Without one they cannot reach the PIN screen at all." style={{ padding: '15px', borderBottom: '1px solid var(--line)', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Sign-In</th>
                          <th title="On the finishing/chip employee selection lists (fin_users)" style={{ padding: '15px', borderBottom: '1px solid var(--line)', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Floor / Chips</th>
                          <th style={{ padding: '15px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}></th>
                      </tr>
                  </thead>
                  <tbody>
                      {users.map(u => (
                          <tr key={u.id} style={{ borderBottom: '1px solid var(--line)' }}>
                              <td style={{ padding: '15px', color: 'var(--ink)' }}>{u.name}</td>
                              <td style={{ padding: '15px', color: 'var(--ink-soft)' }}>{u.role?.toUpperCase().replace(/_/g, ' ')}</td>
                              <td style={{ padding: '15px', textAlign: 'center' }}>
                                  {(() => {
                                      // Linked by PIN, or by the email stamped on the user doc at creation.
                                      const lg = staffLogins.find(l => (l.pin && String(l.pin) === String(u.pin || u.id))
                                          || (u.outerEmail && String(l.email || '').toLowerCase() === String(u.outerEmail).toLowerCase()));
                                      if (!lg) return <span title="No daily sign-in account — create one in the panel above, or they can't get past the login screen." style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: '#d9534f', letterSpacing: '.06em' }}>NONE</span>;
                                      return <span title={`${lg.email}${lg.active === false ? ' (disabled)' : ''}`} style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: lg.active === false ? '#d9534f' : '#3a7d44' }}>{lg.active === false ? '⊘' : '✓'}</span>;
                                  })()}
                              </td>
                              <td style={{ padding: '15px', textAlign: 'center' }}>
                                  <input type="checkbox" checked={finPins.has(String(u.pin || u.id))} onChange={() => toggleFloorUser(u)} title="Show this person on finishing/chip employee selections" style={{ cursor: 'pointer', width: '16px', height: '16px' }} />
                              </td>
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

      {flowReview && <FlowReviewModal review={flowReview} />}

      {zoomImg && (
        <div onClick={() => setZoomImg(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,18,15,0.75)', zIndex: 11000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', cursor: 'zoom-out' }}>
          <img src={zoomImg.url} alt={zoomImg.label} style={{ maxWidth: '70vw', maxHeight: '75vh', objectFit: 'contain', background: '#fff', border: '1px solid var(--line)', padding: '12px' }} />
          <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: '#fff', letterSpacing: '.05em' }}>{zoomImg.label} · click anywhere to close</div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 🔍 FLOW REVIEW MODAL — the generate-time gate handleGenerateHardwareFlow awaits on (codeRx
// families only; H1 bypasses). Pure checkbox state over the payload the generator computed:
// per-source-assembly option checklist + the diameter × projection matrix + the union report.
// Cancel resolves null (nothing written); "Generate with checked" resolves the exclusion sets
// and the awaiting generator resumes. Junk options (⚠ partId not in the library, or a name-less
// doc) always arrive pre-unchecked — surviving a review takes a deliberate tick.
const FlowReviewModal = ({ review }) => {
    const [excluded, setExcluded] = useState(() => new Set(review.sections.flatMap(s => s.options.filter(o => !o.checked).map(o => o.key))));
    const [cells, setCells] = useState(() => new Set(review.cellSeed));
    const toggleOpt = (key) => setExcluded(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
    const toggleCell = (id) => setCells(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    const totalOpts = review.sections.reduce((s, x) => s + x.options.length, 0);
    const keptOpts = totalOpts - excluded.size;
    const mono = { fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '.08em' };
    const th = { ...mono, fontSize: '9.5px', color: 'var(--ink-soft)', padding: '8px 12px', textAlign: 'center', background: 'var(--paper-2)' };
    const btn = { padding: '10px 18px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' };
    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,18,15,0.75)', zIndex: 12000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
            <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', width: 'min(900px, 96vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
                <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--line)' }}>
                    <div style={{ ...mono, fontSize: '12px', color: 'var(--brass)' }}>🔍 Review before generate — {review.famLabel}</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '6px', fontFamily: 'var(--sans)' }}>
                        {review.isRegen
                            ? <>Regenerating <b style={{ color: 'var(--ink)' }}>{review.flowName || 'flow'}</b> from <b style={{ color: 'var(--ink)' }}>{review.asmName}</b> — nothing is written until “Generate with checked”. </>
                            : <>New flow from <b style={{ color: 'var(--ink)' }}>{review.asmName}</b> — nothing is written until “Generate with checked”. </>}
                        {review.hadPersisted ? 'Pre-checked from this flow’s last review (new arrivals follow the current tags/dias).' : 'Pre-checked to the current tags/dias behavior.'}
                    </div>
                </div>
                <div style={{ overflowY: 'auto', padding: '18px 24px', flex: 1 }}>
                    <div style={{ ...mono, fontSize: '10px', color: 'var(--ink-soft)', marginBottom: '6px' }}>🧬 Family union</div>
                    <div style={{ background: 'var(--paper-2)', border: '1px solid var(--line)', padding: '10px 12px', fontFamily: 'var(--mono)', fontSize: '10.5px', lineHeight: 1.6, color: 'var(--ink)', whiteSpace: 'pre-wrap', marginBottom: '18px' }}>
                        {(review.unionReport.length ? review.unionReport.join('\n') : '— nothing to report —')
                            + '\n\n(+N = choices added from that sibling; styles the master already carries are deduped and resolve per-diameter automatically.)'}
                    </div>
                    <div style={{ ...mono, fontSize: '10px', color: 'var(--ink-soft)', marginBottom: '6px' }}>📏 Diameter × Projection — checked = offered on the Bracket Projection cards at that diameter</div>
                    <div style={{ border: '1px solid var(--line)', marginBottom: '8px', overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', fontFamily: 'var(--sans)' }}>
                            <thead><tr>
                                <th style={{ ...th, textAlign: 'left' }}>Rod Diameter</th>
                                {review.projOptions.map(po => <th key={po.optId} style={th}>{po.label}</th>)}
                            </tr></thead>
                            <tbody>
                                {review.diaOptions.map(d => {
                                    const rowCount = review.projOptions.filter(po => cells.has(`${d.value}|${po.optId}`)).length;
                                    return (
                                        <tr key={d.value} style={{ borderTop: '1px solid var(--line)' }}>
                                            <td style={{ padding: '8px 12px', color: rowCount ? 'var(--ink)' : '#b23b2e', fontWeight: 500 }}>{d.label}{rowCount ? '' : ' — no projections offered!'}</td>
                                            {review.projOptions.map(po => {
                                                const id = `${d.value}|${po.optId}`;
                                                return (
                                                    <td key={po.optId} style={{ padding: '8px 12px', textAlign: 'center' }}>
                                                        <input type="checkbox" checked={cells.has(id)} onChange={() => toggleCell(id)} style={{ accentColor: 'var(--brass)', width: '15px', height: '15px', cursor: 'pointer' }} />
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    {review.strayTags.length > 0 && (
                        <div style={{ fontSize: '0.78rem', color: '#b23b2e', marginBottom: '10px', fontFamily: 'var(--sans)' }}>
                            ⚠ Tagged on pins but not offerable — no matching family projection option: {review.strayTags.join(' · ')}. Add the one-line option to SIZE_FAMILIES, then regenerate.
                        </div>
                    )}
                    <div style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', marginBottom: '18px', fontFamily: 'var(--sans)' }}>
                        Unchecked projections are baked out of the flow (SIZE-PROJ dias + stored review matrix) — brackets tagged only at an unchecked projection stop appearing at that diameter.
                    </div>
                    {review.sections.filter(s => s.options.length).map(sec => (
                        <div key={sec.src} style={{ marginBottom: '16px' }}>
                            <div style={{ ...mono, fontSize: '10px', color: 'var(--brass)', borderBottom: '1px solid var(--line)', paddingBottom: '5px', marginBottom: '4px' }}>{sec.src} · {sec.options.length} option(s)</div>
                            {sec.options.map(o => (
                                <label key={o.key} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 4px', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={!excluded.has(o.key)} onChange={() => toggleOpt(o.key)} style={{ accentColor: 'var(--brass)', width: '15px', height: '15px', cursor: 'pointer', flexShrink: 0 }} />
                                    <span style={{ fontSize: '0.85rem', fontFamily: 'var(--sans)', color: o.junk ? '#b23b2e' : 'var(--ink)', textDecoration: excluded.has(o.key) ? 'line-through' : 'none', opacity: excluded.has(o.key) ? 0.55 : 1 }}>
                                        {o.junk ? `⚠ ${o.name} (not in library)` : o.name}
                                    </span>
                                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', marginLeft: 'auto', flexShrink: 0, letterSpacing: '.04em' }}>
                                        {o.itemNo ? `${o.itemNo} · ` : ''}{o.cat}{o.position ? ` · ${o.position}` : ''}{o.copies > 1 ? ` · ×${o.copies} placements` : ''}{o.flags.length ? ` · ${o.flags.join(' ')}` : ''}
                                    </span>
                                </label>
                            ))}
                        </div>
                    ))}
                </div>
                <div style={{ padding: '14px 24px', borderTop: '1px solid var(--line)', display: 'flex', gap: '12px', justifyContent: 'flex-end', alignItems: 'center', background: 'var(--paper-2)' }}>
                    <div style={{ ...mono, fontSize: '10px', color: 'var(--ink-soft)', marginRight: 'auto' }}>{keptOpts}/{totalOpts} options · {cells.size} matrix cell(s) checked</div>
                    <button onClick={() => review.resolve(null)} style={{ ...btn, background: 'transparent', color: 'var(--ink-soft)', border: '1px solid var(--line)' }}>✕ Cancel — write nothing</button>
                    <button onClick={() => review.resolve({ excludedKeys: new Set(excluded), cells: new Set(cells) })} style={{ ...btn, background: 'var(--brass)', color: '#fff', border: 'none' }}>⚙ Generate with checked</button>
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