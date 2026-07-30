import React, { useState, useEffect } from 'react';
import { useRetiredSet } from '../Shared/retiredItems';
import { db, storage } from '../../firebase';
import { mergeWindowConfig } from './systemWindows';
import { collection, onSnapshot, query, where, doc, setDoc, deleteDoc, getDocs, writeBatch, updateDoc } from "firebase/firestore";
import { fixMojibake } from '../Shared/textRepair';
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { subscribeProgramPrints, resolvePrintUrlAny } from '../Shared/programPrints';
import { fabricutCodeOf } from '../Shared/priceLevels';
import { SOURCING, SOURCING_LABEL, sourcingOf, sourcingPatch } from '../Shared/sourcing';
import { nsProxyFetch } from "../Shared/nsProxy";


const AVAILABLE_BRANDS = [
  { id: 'm2c', name: 'M2C Studio' },
  { id: 'uniquity', name: 'Uniquity' }, 
  { id: 'ce', name: 'Classical Elements' }, 
  { id: 'leyla', name: 'Leyla Gans' }
];

// DEFAULT_SYSTEM_WINDOWS + merge logic now live in ./systemWindows (single source of truth).

// Finish code = the assembly suffix (base + CODE → base/CODE); some finish docs hold it in `name` (matches PickPack).
const finishCodeOf = (f) => String((f && (f.code || f.name)) || '').toUpperCase();
// Brand → NetSuite location id (for the base-stock check when routing outsourced finished assemblies).
const BRAND_NS_LOCATION = { m2c: "19", uniquity: "22", ce: "17", leyla: "18" };

// 🔤 Mojibake repair lives in Shared/textRepair (also runs on Mass Update CSV imports).
const MOJI_ITEM_FIELDS = ['itemName', 'description', 'itemDescription'];

const LibraryTab = ({ currentUser, activeBrand, focusItemId, clearFocus }) => {
  const [isAdmin] = useState(true);

  const [inventory, setInventory] = useState([]);
  const retiredSet = useRetiredSet(); // retired "- OLD" items (by internal ID) hidden from the browse list
  const [syncingThumbs, setSyncingThumbs] = useState(null);   // {done,total} while syncing, else null
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [partClassFilter, setPartClassFilter] = useState("ALL"); 
  const [collectionFilter, setCollectionFilter] = useState(""); 
  const [watchlistFilter, setWatchlistFilter] = useState("");
  const [appOnlyFilter, setAppOnlyFilter] = useState(false); // show only app-created parts with no NetSuite item #
  
  const [customSchema, setCustomSchema] = useState([]);
  const [dynamicAssets, setDynamicAssets] = useState([]);
  const [outsourceFinishes, setOutsourceFinishes] = useState([]); // hq_outsource_finishes — detect/route outsourced finished assemblies in the WO tool
  const [collectionsData, setCollectionsData] = useState([]);
  const [showCollMgr, setShowCollMgr] = useState(false);
  const [liveVendors, setLiveVendors] = useState([]); 
  const [liveCustomers, setLiveCustomers] = useState([]); 
  
  const [globalLists, setGlobalLists] = useState({ 
      uom: [], prodTypes: [], watchLists: [], vendors: [], outsourceActions: [],
      pillowSizes: [], fillTypes: [], flangeStyles: [], stitchTypes: [], seamCounts: [], assemblyTypes: [],
      cpqRoutingTypes: [], customers: [], partHandling: [], inventoryTypes: [], projections: [],
      bracketMounts: [], feeTypes: []
  });
  
  const [windowConfig, setWindowConfig] = useState(mergeWindowConfig(null));
  const [activeBomPins, setActiveBomPins] = useState([]); 

  const [activePart, setActivePart] = useState(null);
  const [printMap, setPrintMap] = useState(new Map()); // program name -> program-print doc
  const [editSpecs, setEditSpecs] = useState({ customData: {}, dynamicDicts: {}, clientPricing: [], collections: [], bomRevision: "" }); 
  const [isSaving, setIsSaving] = useState(false);
  
  const [newClientPricing, setNewClientPricing] = useState({ customerId: '', clientSku: '', price: '', clientSalesPrice: '' });
  const [isBulkFab, setIsBulkFab] = useState(false); // bulk Fabricut → clientPricing writer running
  const [aliasForm, setAliasForm] = useState({ code: '', name: '', price: '', collection: '' }); // alias creator
  const [orphanMode, setOrphanMode] = useState(false);     // show only unreferenced, NS-less items
  const [orphanUsedSet, setOrphanUsedSet] = useState(null); // every part id/code referenced by a BOM or flow
  const [orphanBusy, setOrphanBusy] = useState(false);
  const [mojiBusy, setMojiBusy] = useState(false);         // 🔤 garbled-text repair running
  const [tempFilter, setTempFilter] = useState(false);     // ⏳ show only TEMP-flagged legacy items
  const [tempBusy, setTempBusy] = useState(false);         // ☢ temp-nuke running

  const [pdfFile, setPdfFile] = useState(null);
  const [cadFile, setCadFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [cadUploadProgress, setCadUploadProgress] = useState(0); 
  const [dynamicUploadProgress, setDynamicUploadProgress] = useState({});
  const [cloneSourceId, setCloneSourceId] = useState("");

  const [userPerms, setUserPerms] = useState([]);
  const [isPushingErp, setIsPushingErp] = useState(false);
  const [woTargetQty, setWoTargetQty] = useState(1);

  useEffect(() => {
      if (!currentUser) return;
      // Sanitized name/role projection (no PINs) — hq_users is admin-locked.
      const unsubUser = onSnapshot(collection(db, "directory"), (snap) => {
          const users = snap.docs.map(d => d.data());
          const me = users.find(u => u.name === currentUser);
          
          if (me && me.role) {
              onSnapshot(doc(db, "hq_config", "permissions"), (permSnap) => {
                  if (permSnap.exists()) setUserPerms(permSnap.data()[me.role] || []);
              });
          }
      });
      return () => unsubUser();
  }, [currentUser]);

  const hasErpWriteAccess = isAdmin || userPerms.includes("ERP_WRITE_BACK");

  useEffect(() => {
    const unsubSchema = onSnapshot(doc(db, "system", "master_schema"), (docSnap) => { if (docSnap.exists() && docSnap.data().inventoryFields) setCustomSchema(docSnap.data().inventoryFields); });
    const unsubAssets = onSnapshot(collection(db, "hq_dynamic_data"), snap => setDynamicAssets(snap.docs.map(d => ({id: d.id, ...d.data()}))));
    const unsubCollections = onSnapshot(collection(db, "hq_collections"), snap => setCollectionsData(snap.docs.map(d => ({id: d.id, ...d.data()})))); 
    const unsubVendors = onSnapshot(query(collection(db, "crm_records"), where("type", "==", "VENDOR")), snap => setLiveVendors(snap.docs.map(d => ({id: d.id, ...d.data()}))));
    
    const unsubCustomers = onSnapshot(query(collection(db, "crm_records"), where("type", "==", "CUSTOMER")), snap => {
        const allCusts = snap.docs.map(d => ({id: d.id, ...d.data()}));
        setLiveCustomers(allCusts.filter(c => c.brandId === activeBrand || (c.sharedBrands && c.sharedBrands.includes(activeBrand))));
    });

    const unsubLists = onSnapshot(doc(db, "system", "master_lists"), (docSnap) => {
      if (docSnap.exists()) {
          const data = docSnap.data();
          setGlobalLists({ 
              uom: data.uom || [], prodTypes: data.prodTypes || [], 
              watchLists: data.watchLists || [], vendors: data.vendors || [], outsourceActions: data.outsourceActions || [],
              pillowSizes: data.pillowSizes || [], fillTypes: data.fillTypes || [], flangeStyles: data.flangeStyles || [], 
              stitchTypes: data.stitchTypes || [], seamCounts: data.seamCounts || [], assemblyTypes: data.assemblyTypes || [],
              cpqRoutingTypes: data.cpqRoutingTypes || [], customers: data.customers || [], partHandling: data.partHandling || [], 
              inventoryTypes: data.inventoryTypes || [], projections: data.projections || [], bins: data.bins || [],
              bracketMounts: data.bracketMounts || [], feeTypes: data.feeTypes || []
          });
      }
    });

    const unsubWindowConfig = onSnapshot(doc(db, "system", "window_config"), (docSnap) => {
      setWindowConfig(mergeWindowConfig(docSnap.data()));
    });

    const unsubPrints = subscribeProgramPrints(db, setPrintMap);

    const unsubOutsource = onSnapshot(collection(db, "hq_outsource_finishes"), snap => setOutsourceFinishes(snap.docs.map(d => ({ id: d.id, ...d.data() }))));

    return () => { unsubSchema(); unsubAssets(); unsubCollections(); unsubLists(); unsubWindowConfig(); unsubVendors(); unsubCustomers(); unsubPrints(); unsubOutsource(); };
  }, [activeBrand]);

  useEffect(() => {
    if (!activeBrand) return;
    const q = query(collection(db, "Approved_Designs"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      let docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      docs = docs.filter(d => d.brandId === activeBrand || (d.sharedBrands && d.sharedBrands.includes(activeBrand)));
      docs.sort((a, b) => (a.legacyErpId || a.itemName).localeCompare(b.legacyErpId || b.itemName));
      setInventory(docs);
    });
    return () => unsubscribe();
  }, [activeBrand]);

  useEffect(() => {
      if (!activePart || (activePart.partClass !== 'Master Assembly' && activePart.partClass !== 'Assembly')) { 
          setActiveBomPins([]); 
          return; 
      }
      const q = query(collection(db, "assembly_pins"), where("assemblyId", "==", activePart.itemId));
      const unsubscribe = onSnapshot(q, (snapshot) => { setActiveBomPins(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))); });
      return () => unsubscribe();
  }, [activePart]);

  useEffect(() => {
      if (focusItemId && inventory.length > 0) {
          const partToFocus = inventory.find(p => p.id === focusItemId);
          if (partToFocus) {
              openPartDetails(partToFocus);
              if (clearFocus) clearFocus();
          }
      }
  }, [focusItemId, inventory, clearFocus]);

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
      ...inventory.map(p => (p.productType || p.manufacturingSpecs?.productType || "").toUpperCase()).filter(Boolean)
  ])).sort();

  const dynamicCollections = Array.from(new Set([
      ...collectionsData.map(c => c.name.toUpperCase()), 
      ...inventory.flatMap(p => p.manufacturingSpecs?.collections ? p.manufacturingSpecs.collections.map(c => c.toUpperCase()) : (p.manufacturingSpecs?.customData?.collection && p.manufacturingSpecs.customData.collection !== 'N/A' ? [p.manufacturingSpecs.customData.collection.toUpperCase()] : []))
  ])).sort();

  // WHAT KIND OF RECORD IS OPEN — drives which editor sections render (Stuart 2026-07-28: fields
  // "should really only show when the correct item type is selected to help simplify data entry").
  // Fee detection mirrors the FEES class filter above verbatim, so the editor and the list agree.
  const openPT = String(editSpecs.productType || '').toUpperCase();
  const openErp = String(activePart?.legacyErpId || activePart?.itemId || editSpecs.tempLegacyId || '').toUpperCase();
  const isFeeRecord = openPT === 'FEE' || activePart?.partClass === 'Fee' || /(^|-)FEE-/.test(openErp);
  const isBracketRecord = openPT.includes('BRACKET');
  const isBackplateRecord = openPT.includes('BACKPLATE') || openPT.includes('BACK PLATE');
  const isAssemblyRecord = activePart?.partClass === 'Assembly' || activePart?.partClass === 'Master Assembly';
  // Geometry (L/W/H) feeds the O2O maths for plates/brackets and cut-to-size parts; nothing else reads it.
  const usesGeometry = isBracketRecord || isBackplateRecord || !!editSpecs.parametric?.isCutToSize;

  const dynamicWatchlists = Array.from(new Set([
      ...(globalLists.watchLists || []).map(w => w.toUpperCase()), 
      ...inventory.map(p => {
          const specs = p.manufacturingSpecs || {};
          const nsWatchlist = specs.customData?.watchlist && specs.customData.watchlist !== 'N/A' ? specs.customData.watchlist.toUpperCase() : "NONE";
          return specs.watchList ? specs.watchList.toUpperCase() : nsWatchlist;
      }).filter(w => w !== "NONE")
  ])).sort();

  const dynamicUoms = Array.from(new Set([
      ...(globalLists.uom || []).map(u => u.toUpperCase()),
      ...inventory.map(p => (p.manufacturingSpecs?.uom || "").toUpperCase()).filter(Boolean)
  ])).sort();

  const dynamicVendors = Array.from(new Set([
      ...liveVendors.map(v => v.name.toUpperCase()),
      ...inventory.map(p => (p.manufacturingSpecs?.vendorName || "").toUpperCase()).filter(Boolean)
  ])).sort();

  // ---- ORPHAN SCAN (test leftovers): items with NO NetSuite id that NOTHING references --------
  // "Used" = appears in any assembly BOM line (assembly_pins partId, or IS an assembly that has
  // pins) or anywhere in a CPQ flow (linked assembly/item/pin, style/sub option, included part).
  // Fresh scan each time the toggle turns on, so it reflects deletions/regenerates immediately.
  const scanOrphans = async () => {
      if (orphanMode) { setOrphanMode(false); return; }
      setOrphanBusy(true);
      try {
          const used = new Set();
          const addRef = (v) => { const s = String(v || '').trim().toUpperCase(); if (s && s !== 'PENDING' && s !== 'N/A') used.add(s); };
          const pinsSnap = await getDocs(collection(db, 'assembly_pins'));
          pinsSnap.docs.forEach(d => { const x = d.data() || {}; addRef(x.partId); addRef(x.assemblyId); });
          const flowsSnap = await getDocs(collection(db, 'cpq_flows'));
          flowsSnap.docs.forEach(d => {
              const f = d.data() || {};
              addRef(f.linkedAssemblyId);
              (f.steps || []).forEach(s => {
                  addRef(s.linkedItemId); addRef(s.linkedPinId);
                  [...(s.styleOptions || []), ...(s.subOptions || [])].forEach(o => addRef(o && o.partId));
                  (s.includedParts || []).forEach(ip => addRef(ip && ip.partId));
              });
          });
          setOrphanUsedSet(used);
          setOrphanMode(true);
      } catch (e) { alert('Usage scan failed: ' + (e.message || e)); }
      setOrphanBusy(false);
  };
  const isOrphanPart = (part) => {
      if (part.netSuiteInternalId) return false;
      if (!orphanUsedSet) return true;
      const idU = String(part.id || '').toUpperCase();
      const erpU = String(part.legacyErpId || part.itemId || '').toUpperCase();
      return !orphanUsedSet.has(idU) && (!erpU || erpU === 'PENDING' || !orphanUsedSet.has(erpU));
  };
  const deleteSingleOrphan = async (part, e) => {
      e.stopPropagation(); // the card's onClick opens the editor — a delete tap must never do both
      const label = `${part.legacyErpId && part.legacyErpId !== 'PENDING' ? part.legacyErpId : (part.itemId || part.id)} — ${part.itemName || ''}`;
      if (!window.confirm(`Delete "${label}"?\n\nNo NetSuite id · not referenced by any BOM or CPQ flow.\n\nThis cannot be undone.`)) return;
      try {
          await deleteDoc(doc(db, 'Approved_Designs', part.id));
          if (activePart?.id === part.id) setActivePart(null);
      } catch (err) { alert('Delete failed: ' + (err.message || err)); }
  };
  // 🔤 Repair mojibake in library item text AND the option labels already baked into CPQ flows
  // (the generator copies itemName into styleOptions at Generate time, so both need the sweep —
  // fixing both means no re-import and no regenerate).
  const fixEncoding = async () => {
    setMojiBusy(true);
    try {
      const itemFixes = [];
      inventory.forEach(p => {
        const upd = {};
        MOJI_ITEM_FIELDS.forEach(f => { const v = p[f]; const r = fixMojibake(v); if (r !== v) upd[f] = r; });
        if (Object.keys(upd).length) itemFixes.push({ id: p.id, upd, before: p.itemName, after: upd.itemName || p.itemName });
      });
      const flowSnap = await getDocs(collection(db, 'cpq_flows'));
      const flowFixes = [];
      flowSnap.docs.forEach(fd => {
        const data = fd.data();
        let changed = false;
        const fixOpt = (o) => {
          if (!o || typeof o !== 'object') return o;
          const r = { ...o };
          ['name', 'label', 'description'].forEach(k => { if (typeof r[k] === 'string') { const f = fixMojibake(r[k]); if (f !== r[k]) { r[k] = f; changed = true; } } });
          if (Array.isArray(r.subOptions)) r.subOptions = r.subOptions.map(fixOpt);
          if (Array.isArray(r.includedParts)) r.includedParts = r.includedParts.map(fixOpt);
          return r;
        };
        const steps = (data.steps || []).map(st => {
          const s2 = { ...st };
          ['title', 'stepTitle', 'description'].forEach(k => { if (typeof s2[k] === 'string') { const f = fixMojibake(s2[k]); if (f !== s2[k]) { s2[k] = f; changed = true; } } });
          if (Array.isArray(s2.styleOptions)) s2.styleOptions = s2.styleOptions.map(fixOpt);
          if (Array.isArray(s2.includedParts)) s2.includedParts = s2.includedParts.map(fixOpt);
          return s2;
        });
        const name2 = fixMojibake(data.name);
        if (name2 !== data.name) changed = true;
        if (changed) flowFixes.push({ id: fd.id, steps, name: name2 });
      });
      if (!itemFixes.length && !flowFixes.length) { alert('🔤 Scan clean — no garbled text in item names/descriptions or CPQ flow labels.'); return; }
      const sample = itemFixes.slice(0, 5).map(x => `• ${x.before}  →  ${x.after}`).join('\n');
      if (!window.confirm(`🔤 Fix garbled imported text (UTF-8 that was read as Windows-1252)?\n\n${itemFixes.length} library item(s) · ${flowFixes.length} CPQ flow(s)\n\n${sample}${itemFixes.length > 5 ? `\n…and ${itemFixes.length - 5} more` : ''}\n\nOnly provably-garbled strings change; clean text is untouched.`)) return;
      for (const x of itemFixes) await updateDoc(doc(db, 'Approved_Designs', x.id), x.upd);
      for (const f of flowFixes) await updateDoc(doc(db, 'cpq_flows', f.id), { steps: f.steps, name: f.name });
      alert(`✅ Repaired ${itemFixes.length} item(s) + ${flowFixes.length} flow(s).\n\nCPQ options read clean immediately (no regenerate needed); 1.6 Load Choices shows clean names on its next fresh index.`);
    } catch (e) { alert('Encoding fix failed: ' + (e.message || e)); }
    finally { setMojiBusy(false); }
  };

  // ☢ TEMP NUKE — the planned end-of-life for custitem_app_temp legacy items (loaded only so the
  // finishing floor could run 100% in-app until discontinuation). Deletes every TEMP-flagged item
  // in this brand EXCEPT any that a BOM or CPQ flow references (those are listed, never touched).
  // NetSuite items themselves are untouched — and the confirm reminds that the sync flag must be
  // unchecked in NetSuite too, or the next item sync re-imports them.
  const nukeTempItems = async () => {
    setTempBusy(true);
    try {
      const temps = inventory.filter(p => p.manufacturingSpecs?.isTemp === true);
      if (!temps.length) { alert('No TEMP-flagged items in this brand.\n\n(Items gain the ⏳ flag when the 11.1 item sync sees the NetSuite checkbox custitem_app_temp checked.)'); return; }
      // Same usage sources as the Orphans scan: any BOM pin or CPQ flow reference blocks deletion.
      const used = new Set();
      const addRef = (v) => { const s = String(v || '').trim().toUpperCase(); if (s && s !== 'PENDING' && s !== 'N/A') used.add(s); };
      const pinsSnap = await getDocs(collection(db, 'assembly_pins'));
      pinsSnap.docs.forEach(d => { const x = d.data() || {}; addRef(x.partId); addRef(x.assemblyId); });
      const flowsSnap = await getDocs(collection(db, 'cpq_flows'));
      flowsSnap.docs.forEach(d => {
        const f = d.data() || {};
        addRef(f.linkedAssemblyId);
        (f.steps || []).forEach(s => {
          addRef(s.linkedItemId); addRef(s.linkedPinId);
          [...(s.styleOptions || []), ...(s.subOptions || [])].forEach(o => addRef(o && o.partId));
          (s.includedParts || []).forEach(ip => addRef(ip && ip.partId));
        });
      });
      const isRefd = (p) => used.has(String(p.id || '').toUpperCase()) || used.has(String(p.legacyErpId || p.itemId || '').toUpperCase());
      const blocked = temps.filter(isRefd);
      const clear = temps.filter(p => !isRefd(p));
      const nameOf = (p) => (p.legacyErpId && p.legacyErpId !== 'PENDING' ? p.legacyErpId : (p.itemId || p.id));
      if (!clear.length) { alert(`☢ Nothing deletable: all ${temps.length} TEMP item(s) are referenced by a BOM or CPQ flow:\n\n${blocked.slice(0, 12).map(nameOf).join(', ')}${blocked.length > 12 ? '…' : ''}\n\nRemove those references first.`); return; }
      const typed = window.prompt(`☢ NUKE ${clear.length} TEMP item(s) from the app library (brand: ${activeBrand?.toUpperCase()})?\n\nSample: ${clear.slice(0, 8).map(nameOf).join(', ')}${clear.length > 8 ? '…' : ''}${blocked.length ? `\n\nSkipped (referenced by BOM/flow): ${blocked.length} — ${blocked.slice(0, 6).map(nameOf).join(', ')}${blocked.length > 6 ? '…' : ''}` : ''}\n\nNetSuite items are NOT touched. This cannot be undone.\n\nType NUKE to confirm:`);
      if (typed !== 'NUKE') { if (typed !== null) alert('Cancelled — you must type NUKE exactly.'); return; }
      let deleted = 0;
      for (let i = 0; i < clear.length; i += 400) {
        const batch = writeBatch(db);
        clear.slice(i, i + 400).forEach(p => batch.delete(doc(db, 'Approved_Designs', p.id)));
        await batch.commit();
        deleted += Math.min(400, clear.length - i);
      }
      alert(`☢ Deleted ${deleted} TEMP item(s).${blocked.length ? ` Skipped ${blocked.length} still referenced by a BOM/flow.` : ''}\n\n⚠ FINISH THE JOB IN NETSUITE: uncheck "Sync to CPQ" (custitem_sync_to_cpq) — or mark them OLD (custitem28) — on these items, otherwise the next 11.1 item sync re-imports them.`);
    } catch (e) { alert('Temp nuke failed: ' + (e.message || e)); }
    finally { setTempBusy(false); }
  };

  const deleteOrphans = async (list) => {
      if (!list.length) return alert('Nothing shown to delete.');
      const preview = list.slice(0, 15).map(p => `• ${p.legacyErpId && p.legacyErpId !== 'PENDING' ? p.legacyErpId : (p.itemId || p.id)} — ${p.itemName || ''}`).join('\n');
      if (!window.confirm(`Permanently DELETE the ${list.length} item(s) currently shown?\n\nAll have NO NetSuite id and are NOT referenced by any assembly BOM or CPQ flow.\n\n${preview}${list.length > 15 ? `\n…+${list.length - 15} more` : ''}\n\nThis cannot be undone.`)) return;
      setOrphanBusy(true);
      let n = 0, failed = 0;
      for (const p of list) {
          try { await deleteDoc(doc(db, 'Approved_Designs', p.id)); n++; }
          catch (e) { console.error('Orphan delete failed:', p.id, e); failed++; }
      }
      setOrphanBusy(false);
      alert(`🧹 Deleted ${n} orphan item(s)${failed ? ` — ${failed} failed (see console)` : ''}.`);
  };

  const filteredInventory = inventory.filter(part => {
    if (part.manufacturingSpecs?.isRetired === true || retiredSet.has(String(part.netSuiteInternalId || ''))) return false; // hide retired (custitem28 / locked) items from the browse list
    if (tempFilter && part.manufacturingSpecs?.isTemp !== true) return false; // ⏳ TEMP view: only custitem_app_temp legacy items
    const term = searchTerm.toLowerCase();
    const specs = part.manufacturingSpecs || {};

    const matchesSearch = part.itemName?.toLowerCase().includes(term) || 
                          (part.legacyErpId && part.legacyErpId.toLowerCase().includes(term)) || 
                          (part.itemId && part.itemId.toLowerCase().includes(term)) ||
                          (specs.binLocation && specs.binLocation.toLowerCase().includes(term)) || 
                          (part.clientPricing && part.clientPricing.some(cp => 
                              (cp.clientSku && cp.clientSku.toLowerCase().includes(term)) || 
                              (cp.customerId && cp.customerId.toLowerCase().includes(term))
                          ));
    
    let matchesType = typeFilter === "" || (specs.productType || "").toUpperCase() === typeFilter.toUpperCase() || (part.productType || "").toUpperCase() === typeFilter.toUpperCase();
    
    const nsCollection = specs.customData?.collection ? [specs.customData.collection.toUpperCase()] : [];
    const partCollections = specs.collections ? specs.collections.map(c=>c.toUpperCase()) : nsCollection;
    let matchesCollection = collectionFilter === "" || partCollections.includes(collectionFilter.toUpperCase()); 
    
    let matchesClass = true;

    if (partClassFilter !== "ALL") {
        if (partClassFilter === "INVENTORY") matchesClass = part.partClass === "Inventory" && specs.isInHouse !== false;
        else if (partClassFilter === "OUTSOURCED") matchesClass = part.partClass === "Inventory" && specs.isInHouse === false;
        // Fees & charges (french/miter return fees, cut fees…) — same test the CPQ's isFeePart uses,
        // so what prices as a fee is what filters as a fee. They carry clientPricing + fabricut
        // structs like any item (per-customer fee pricing lives right on the fee record).
        // Fees match by product type, class, OR the code convention (CE-FEE-…): NetSuite-synced
        // fee items can come back with their own product type, so the code pattern is the
        // reliable catch-all (Stuart 2026-07-22 — the App-only button stopped finding them all).
        else if (partClassFilter === "FEES") matchesClass = String(specs.productType || part.productType || '').toUpperCase() === 'FEE' || part.partClass === 'Fee' || /(^|-)FEE-/.test(String(part.legacyErpId || part.itemId || '').toUpperCase());
        else if (partClassFilter === "UNASSIGNED") matchesClass = (part.partClass === "Assembly" || part.partClass === "Master Assembly") && (!part.routingType || part.routingType === "UNASSIGNED");
        else matchesClass = (part.partClass === "Assembly" || part.partClass === "Master Assembly") && part.routingType?.toUpperCase() === partClassFilter.toUpperCase();
    }

    const nsWatchlist = specs.customData?.watchlist && specs.customData.watchlist !== 'N/A' ? specs.customData.watchlist.toUpperCase() : "NONE";
    const currentWatchList = specs.watchList ? specs.watchList.toUpperCase() : nsWatchlist;
    let matchesWatchlist = watchlistFilter === "" || currentWatchList === watchlistFilter.toUpperCase();
    
    // "App-only" = no real NetSuite item # — created in-app (legacyErpId is PENDING/N/A/blank) and never
    // synced (no netSuiteInternalId). Lets you find residual app-generated parts to clean up.
    const noNsNumber = (!part.legacyErpId || ['PENDING', 'N/A'].includes(String(part.legacyErpId).toUpperCase())) && !part.netSuiteInternalId;
    const matchesAppOnly = !appOnlyFilter || noNsNumber;

    // Orphan mode: no NetSuite id AND unreferenced by any assembly BOM or CPQ flow (scan-built set).
    const matchesOrphan = !orphanMode || isOrphanPart(part);

    return matchesSearch && matchesType && matchesCollection && matchesClass && matchesWatchlist && matchesAppOnly && matchesOrphan;
  });

  // Firestore rejects `undefined` field values outright — recursively drop them so a save can
  // never throw "Unsupported field value: undefined" over an optional field (same guard AdminTab
  // uses for flow docs).
  const stripUndefinedDeep = (v) => {
    if (Array.isArray(v)) return v.map(stripUndefinedDeep);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v)) { if (v[k] !== undefined) out[k] = stripUndefinedDeep(v[k]); }
      return out;
    }
    return v;
  };

  const openPartDetails = (part) => {
    setActivePart(part); setPdfFile(null); setCadFile(null); setDynamicUploadProgress({}); setCloneSourceId(""); setWoTargetQty(1);
    
    const baseSpecs = part.manufacturingSpecs || {};
    const parametricData = baseSpecs.parametric || { isCutToSize: false, fixedDiameter: "", length: "", width: "", height: "" };
    const customData = baseSpecs.customData || {}; 
    const dynamicDicts = baseSpecs.dynamicDicts || {};
    const isInHouse = baseSpecs.isInHouse !== undefined ? baseSpecs.isInHouse : true;
    let shared = part.sharedBrands || []; if (!shared.includes(part.brandId)) shared = [...shared, part.brandId];
    
    const legacyCollection = baseSpecs.collection && baseSpecs.collection !== 'N/A' ? [baseSpecs.collection.toUpperCase()] : [];
    const nsCollection = customData.collection && customData.collection !== 'N/A' ? [customData.collection.toUpperCase()] : [];
    const currentCollections = baseSpecs.collections ? baseSpecs.collections.map(c => c.toUpperCase()) : (nsCollection.length > 0 ? nsCollection : legacyCollection);

    const nsWatchlist = customData.watchlist && customData.watchlist !== 'N/A' ? customData.watchlist.toUpperCase() : "NONE";
    const currentWatchList = baseSpecs.watchList ? baseSpecs.watchList.toUpperCase() : nsWatchlist;

    setEditSpecs({ 
        ...baseSpecs, 
        parametric: parametricData, 
        customData, 
        dynamicDicts, 
        isInHouse, 
        sharedBrands: shared, 
        tempName: part.itemName, 
        tempLegacyId: part.legacyErpId === "PENDING" ? "" : part.legacyErpId,
        clientPricing: part.clientPricing || [], 
        binLocation: baseSpecs.binLocation || "", 
        bomRevision: baseSpecs.bomRevision || "",
        project: part.project || "",
        collections: currentCollections, 
        routingType: part.routingType || "",
        productType: (part.productType || baseSpecs.productType || "").toUpperCase(),
        uom: (baseSpecs.uom || "EA").toUpperCase(),
        watchList: currentWatchList,
        isProjectManaged: baseSpecs.isProjectManaged || false,
        partHandling: baseSpecs.partHandling || "",
        customOverrideFee: !!baseSpecs.customOverrideFee,
        weight: baseSpecs.weight || "",
        wallMount: baseSpecs.wallMount || { partId: "", desc: "" }
    });
  };

  const handleCloneSpecs = () => {
    if(!cloneSourceId) return;
    if(!window.confirm("Overwrite current specs with cloned data? This pulls all attributes and CPQ rules.")) return;
    const source = inventory.find(p => p.id === cloneSourceId);
    if(!source || !source.manufacturingSpecs) return;
    const clonedSpecs = JSON.parse(JSON.stringify(source.manufacturingSpecs));
    
    const legacyCollection = clonedSpecs.collection && clonedSpecs.collection !== 'N/A' ? [clonedSpecs.collection] : [];
    clonedSpecs.collections = clonedSpecs.collections || legacyCollection;

    setEditSpecs(prev => ({ 
        ...prev, 
        ...clonedSpecs, 
        tempName: prev.tempName, 
        tempLegacyId: prev.tempLegacyId, 
        clientPricing: prev.clientPricing, 
        binLocation: prev.binLocation, 
        pdfUrl: prev.pdfUrl, 
        cadUrl: prev.cadUrl,
        partHandling: prev.partHandling,
        customOverrideFee: prev.customOverrideFee,
        project: prev.project,
        routingType: prev.routingType,
        productType: prev.productType,
        bomRevision: prev.bomRevision || clonedSpecs.bomRevision,
        weight: prev.weight || clonedSpecs.weight
    }));
    setCloneSourceId("");
  };

  const handleSpecChange = (e) => setEditSpecs({ ...editSpecs, [e.target.name]: e.target.value });
  const handleDictChange = (dictId, value) => setEditSpecs(prev => ({ ...prev, dynamicDicts: { ...(prev.dynamicDicts || {}), [dictId]: value } }));
  const handleParametricChange = (e) => setEditSpecs({ ...editSpecs, parametric: { ...editSpecs.parametric, [e.target.name]: e.target.type === 'checkbox' ? e.target.checked : e.target.value } });
  const handleCustomFieldChange = (key, value) => setEditSpecs(prev => ({ ...prev, customData: { ...(prev.customData || {}), [key]: value } }));
  const handleBrandToggle = (brandId) => { let currentShared = editSpecs.sharedBrands || []; if (currentShared.includes(brandId)) currentShared = currentShared.filter(id => id !== brandId); else currentShared.push(brandId); setEditSpecs({ ...editSpecs, sharedBrands: currentShared }); };

  const handleToggleCollection = (collectionName) => {
      const current = editSpecs.collections || [];
      const updated = current.includes(collectionName) ? current.filter(c => c !== collectionName) : [...current, collectionName];
      setEditSpecs({ ...editSpecs, collections: updated });
  };

  const handleAddClientPricing = () => {
      if (!newClientPricing.customerId) return alert("Select a customer from the dropdown.");
      setEditSpecs(prev => ({
          ...prev,
          clientPricing: [...(prev.clientPricing || []), { ...newClientPricing }]
      }));
      setNewClientPricing({ customerId: '', clientSku: '', price: '', clientSalesPrice: '' });
  };

  const handleRemoveClientPricing = (idx) => {
      setEditSpecs(prev => ({ ...prev, clientPricing: prev.clientPricing.filter((_, i) => i !== idx) }));
  };

  // ---- ALIASES (Stuart 2026-07-14) ---------------------------------------------------------
  // An ALIAS is a separate library record with its OWN item id, description and price that
  // points back to a MAIN item via manufacturingSpecs.aliasOf. CPQ quotes price/name from the
  // alias (it's just the selected part); the ERP push resolves aliasOf → the MAIN item before
  // building NetSuite lines (existing behavior in ERPPushPullTab), so the BOM, NetSuite and all
  // demand (Sales Snapshot reads NetSuite) land on the main item automatically. Aliases carry
  // no NetSuite id and are never pushed as items.
  const codeOfPart = (p) => (p?.legacyErpId && p.legacyErpId !== 'PENDING' ? p.legacyErpId : p?.itemId) || p?.id || '';
  const aliasesOf = (main) => {
      if (!main) return [];
      const keys = [main.id, main.itemId, main.legacyErpId].filter(Boolean).map(x => String(x).toUpperCase());
      return inventory.filter(p => {
          const a = p.manufacturingSpecs?.aliasOf || p.aliasOf;
          return a && keys.includes(String(a).toUpperCase());
      });
  };
  const createAlias = async () => {
      if (!activePart) return;
      const code = aliasForm.code.trim().toUpperCase();
      if (!code) return alert('Enter the alias item id (e.g. H2-1BE).');
      if (inventory.some(p => [p.itemId, p.legacyErpId].filter(Boolean).map(x => String(x).toUpperCase()).includes(code))) {
          return alert(`"${code}" already exists in the library — pick a unique alias id.`);
      }
      const mainCode = codeOfPart(activePart);
      const specs = activePart.manufacturingSpecs || {};
      const id = `ALIAS-${code.replace(/[^A-Za-z0-9-]/g, '_')}-${Date.now().toString().slice(-6)}`;
      try {
          await setDoc(doc(db, 'Approved_Designs', id), {
              id, itemId: code, legacyErpId: code,
              itemName: aliasForm.name.trim() || activePart.itemName || code,
              brandId: activePart.brandId || activeBrand,
              sharedBrands: activePart.sharedBrands || [activePart.brandId || activeBrand],
              partClass: activePart.partClass || 'Inventory',
              productType: activePart.productType || specs.productType || '',
              routingType: activePart.routingType || '',
              clientPricing: [],
              manufacturingSpecs: {
                  aliasOf: mainCode,
                  basePrice: aliasForm.price === '' ? '' : (parseFloat(aliasForm.price) || 0),
                  productType: specs.productType || '', partHandling: specs.partHandling || '',
                  uom: specs.uom || 'EA', paintSize: specs.paintSize || '',
                  collections: aliasForm.collection ? [aliasForm.collection] : [],
                  customData: { ...(specs.customData?.bpOrientation ? { bpOrientation: specs.customData.bpOrientation } : {}) },
              },
              createdAt: new Date().toISOString(), createdBy: currentUser || 'ALIAS_TOOL'
          });
          setAliasForm({ code: '', name: '', price: '', collection: '' });
          alert(`✅ Alias ${code} created → points to ${mainCode}.\n\nCPQ quotes use the alias's name & price; the BOM, NetSuite push and all demand land on ${mainCode}. Pin ${code} in an assembly / flow to offer it.`);
      } catch (e) { alert('Failed to create the alias: ' + (e.message || e)); }
  };
  const deleteAlias = async (a) => {
      if (!window.confirm(`Delete alias ${codeOfPart(a)} ("${a.itemName}")?\n\nThe main item is untouched. Any flow options pinned to this alias will stop resolving.`)) return;
      try { await deleteDoc(doc(db, 'Approved_Designs', a.id)); } catch (e) { alert('Delete failed: ' + (e.message || e)); }
  };

  // ---- FABRICUT ⇄ CLIENT PRICING ----------------------------------------------------------
  const findByCode = (c) => inventory.find(p => String(p.legacyErpId || p.itemId || '').toUpperCase() === String(c || '').toUpperCase());
  const fabricutCustomer = () => liveCustomers.find(c => /fabricut/i.test(String(c.name || '')));
  // One Client Pricing row from an item's fabricut struct: SKU = pattern #, Client Cost = CE →
  // Fabricut price ("Sale Price" column), Client Sales = Fabricut wholesale (retail ÷ 2 when the
  // sheet had no wholesale). Group-priced docs (explicit null — BP plates) are skipped: their
  // story lives in "Priced in conjunction with…", not in a $ row.
  const fabClientRowFor = (part, fab, custId) => {
      const cost = fab.cost !== undefined ? fab.cost : fab.paintedCost;
      const retail = fab.retail !== undefined ? fab.retail : fab.paintedRetail;
      if (cost === null && retail === null) return null; // included-with-arm ($0 group pricing)
      if (cost === undefined && retail === undefined) return null; // no direct/sellable tier
      let sales = fab.wholesale !== undefined ? fab.wholesale : fab.paintedWholesale;
      if (sales === undefined || sales === null) sales = Number.isFinite(parseFloat(retail)) ? parseFloat(retail) / 2 : '';
      const sku = fabricutCodeOf({ ...part, manufacturingSpecs: { ...(part.manufacturingSpecs || {}), fabricut: fab } }, findByCode, outsourceFinishes) || '';
      return { customerId: custId, clientSku: sku, price: (cost === null || cost === undefined) ? '' : cost, clientSalesPrice: sales === null ? '' : sales, source: 'FABRICUT' };
  };
  // Bulk: every item carrying direct Fabricut pricing gets/refreshes its Fabricut client-pricing
  // row — the in-app control surface Stuart asked for (no more sheet re-upload just to see them).
  const bulkFabricutClientPricing = async () => {
      const cust = fabricutCustomer();
      if (!cust) return alert("No CRM customer matching 'Fabricut' found for this brand — sync the Fabricut customer (11.1) first, or add rows manually.");
      const targets = inventory.filter(p => {
          const f = p.manufacturingSpecs?.fabricut;
          return f && (f.cost !== undefined || f.retail !== undefined) && !(f.cost === null && f.retail === null);
      });
      if (!targets.length) return alert('No items with direct Fabricut pricing found in this brand.');
      if (!window.confirm(`Write/refresh the "${cust.name}" Client Pricing row on ${targets.length} item(s)?\n\n• Client SKU = Fabricut pattern #\n• Client Cost = CE → Fabricut price\n• Client Sales = Fabricut wholesale (retail ÷ 2 when blank)\n\nExisting ${cust.name} rows are replaced; other customers' rows are untouched. Group-priced plates ($0 included) are skipped.`)) return;
      setIsBulkFab(true);
      let n = 0, failed = 0;
      for (const p of targets) {
          const row = fabClientRowFor(p, p.manufacturingSpecs.fabricut, cust.id);
          if (!row) continue;
          const rows = [...(p.clientPricing || []).filter(cp => cp.customerId !== cust.id), row];
          try { await setDoc(doc(db, 'Approved_Designs', p.id), { clientPricing: rows }, { merge: true }); n++; }
          catch (e) { console.error('Fabricut client-pricing write failed:', p.legacyErpId, e); failed++; }
      }
      setIsBulkFab(false);
      alert(`✅ ${n} item(s) now carry the ${cust.name} Client Pricing row${failed ? ` (${failed} failed — see console)` : ''}.\n\nReopen any item to review; rows are editable/removable per item.`);
  };

  const handleDynamicFileUpload = async (key, file) => {
      if (!file) return;
      const safeId = activePart.legacyErpId !== "PENDING" ? activePart.legacyErpId : activePart.itemId;
      const storageRef = ref(storage, `dynamic_assets/${activeBrand}_${safeId}_${key}_${Date.now()}`);
      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on("state_changed", 
          (snap) => setDynamicUploadProgress(prev => ({ ...prev, [key]: Math.round((snap.bytesTransferred / snap.totalBytes) * 100) })),
          (err) => { console.error(err); alert("Upload failed"); },
          async () => { 
              const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
              handleCustomFieldChange(key, downloadURL); setDynamicUploadProgress(prev => ({ ...prev, [key]: 0 }));
          }
      );
  };

  // Sync Thumbnails: match library parts to Asset Gallery images by pattern + finish and set
  // finalImageUrl on any that are missing one. Part codes are "<pattern>/<finish>" (e.g.
  // "H1-138BE/P01"); assets store patternId + finishId. Finishes are normalised (the gallery
  // zero-pads — EP01 — while parts don't — EP1), so leading zeros are stripped on both sides.
  // Re-runnable: as new images are uploaded, re-run to fill more parts.
  const handleSyncThumbnails = async () => {
      const normFinish = (s) => String(s || '').toUpperCase().trim().replace(/^([A-Z]+)0*(\d+)$/, '$1$2');
      const split = (erp) => {
          const i = String(erp || '').indexOf('/');
          return i < 0 ? null : { pattern: erp.slice(0, i).toUpperCase().trim(), finish: normFinish(erp.slice(i + 1)) };
      };
      try {
          setSyncingThumbs({ done: 0, total: 0 });
          const snap = await getDocs(collection(db, "global_assets"));
          const assetMap = new Map();
          snap.docs.forEach(d => {
              const a = d.data();
              const img = a.thumbnailUrl || a.url || a.originalUrl;
              if (a.patternId && img) assetMap.set(`${String(a.patternId).toUpperCase().trim()}|${normFinish(a.finishId)}`, img);
          });

          // Parts in this brand that have no image yet and carry a pattern/finish code.
          const candidates = inventory.filter(p =>
              (p.brandId === activeBrand || (p.sharedBrands && p.sharedBrands.includes(activeBrand))) &&
              !p.finalImageUrl && p.legacyErpId && p.legacyErpId.includes('/'));

          const hits = [];
          candidates.forEach(p => {
              const k = split(p.legacyErpId);
              const img = k && assetMap.get(`${k.pattern}|${k.finish}`);
              if (img) hits.push({ id: p.id, img });
          });

          if (hits.length === 0) { setSyncingThumbs(null); return alert(`No new matches. Checked ${candidates.length} image-less part(s) against ${assetMap.size} gallery image(s).`); }

          // Commit in chunks (Firestore batch cap 500).
          let done = 0;
          for (let i = 0; i < hits.length; i += 400) {
              const chunk = hits.slice(i, i + 400);
              const batch = writeBatch(db);
              chunk.forEach(h => batch.update(doc(db, "Approved_Designs", h.id), { finalImageUrl: h.img }));
              await batch.commit();
              done += chunk.length;
              setSyncingThumbs({ done, total: hits.length });
          }
          setSyncingThumbs(null);
          alert(`✅ Synced ${hits.length} thumbnail(s) from the Asset Gallery (of ${candidates.length} image-less parts).`);
      } catch (e) { console.error(e); setSyncingThumbs(null); alert("Sync failed: " + (e.message || e)); }
  };

  const handleCreateNewPart = () => {
    const actualClass = partClassFilter === 'ALL' || partClassFilter === 'INVENTORY' || partClassFilter === 'OUTSOURCED' ? 'Inventory' : 'Assembly';
    const newId = `${activeBrand.toUpperCase()}-${actualClass === 'Inventory' ? 'INV' : 'ASM'}-${Math.floor(1000+Math.random()*9000)}`;
    
    setActivePart({ isNew: true, id: newId, itemId: newId, legacyErpId: "PENDING", itemName: `NEW ${actualClass.toUpperCase()}`, brandId: activeBrand, partClass: actualClass });
    setEditSpecs({ productType: "", uom: "EA", collections: [], project: "", routingType: "", watchList: "NONE", tempName: `NEW ${actualClass.toUpperCase()}`, tempLegacyId: "", clientPricing: [], bomRevision: "", binLocation: "", isInHouse: partClassFilter !== 'OUTSOURCED', programNum: "", material: "", layeringSequence: "10", vendorName: "", vendorId: "", vendorUrl: "", altVendorUrl: "", cost: "", leadTime: "", moq: "", weight: "", reorderPoint: "", sharedBrands: [activeBrand], customData: {}, dynamicDicts: {}, parametric: { isCutToSize: false, fixedDiameter: "", length: "", width: "", height: "" }, isProjectManaged: false, partHandling: "", customOverrideFee: false }); 
    setPdfFile(null); setCadFile(null); setCloneSourceId(""); setWoTargetQty(1);
  };

  const handleDeletePart = async () => {
    if (!activePart || activePart.isNew) return setActivePart(null);
    if (window.confirm(`Permanently delete ${activePart.legacyErpId || activePart.itemId}? This cannot be undone.`)) {
      try { await deleteDoc(doc(db, "Approved_Designs", activePart.id)); setActivePart(null); } catch (err) { console.error(err); }
    }
  };

  const savePartUpdates = async () => {
    if (!activePart) return;
    setIsSaving(true);
    // EVERYTHING lives inside the try (2026-07-26, the H2-05 silent hang): the id line below used
    // to run BEFORE the try — a 1.6-built ASSEMBLY carrying no legacyErpId at all threw
    // `undefined.toUpperCase()` there, the function died before any catch existed, and the button
    // sat on "Saving..." forever with no message. Regular items always carry an ERP id, which is
    // why only assemblies hung. PENDING is the app-wide "no ERP code yet" convention.
    try {
    let finalPdfUrl = editSpecs.pdfUrl || "";
    if (pdfFile) {
      const storageRef = ref(storage, `prints/${activeBrand}_${editSpecs.tempLegacyId || activePart.legacyErpId || activePart.id}_${pdfFile.name}`);
      const uploadTask = uploadBytesResumable(storageRef, pdfFile);
      await new Promise((resolve, reject) => { uploadTask.on("state_changed", (snap) => setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)), (err) => reject(err), async () => { finalPdfUrl = await getDownloadURL(uploadTask.snapshot.ref); resolve(); }); });
    }

    let finalCadUrl = editSpecs.cadUrl || "";
    if (cadFile) {
      const cadStorageRef = ref(storage, `cad_models/${activeBrand}_${editSpecs.tempLegacyId || activePart.legacyErpId || activePart.id}_${cadFile.name}`);
      const cadUploadTask = uploadBytesResumable(cadStorageRef, cadFile);
      await new Promise((resolve, reject) => { cadUploadTask.on("state_changed", (snap) => setCadUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)), (err) => reject(err), async () => { finalCadUrl = await getDownloadURL(cadUploadTask.snapshot.ref); resolve(); }); });
    }

    const compiledSpecs = { ...editSpecs, pdfUrl: finalPdfUrl, cadUrl: finalCadUrl };
    delete compiledSpecs.collection;

    const finalName = editSpecs.tempName || activePart.itemName || "";
    const finalLegacyId = String(editSpecs.tempLegacyId || activePart.legacyErpId || "PENDING").toUpperCase();

      const payload = stripUndefinedDeep({
          itemName: finalName,
          legacyErpId: finalLegacyId,
          clientPricing: editSpecs.clientPricing || [],
          sharedBrands: editSpecs.sharedBrands || [activePart.brandId || activeBrand],
          project: editSpecs.project || "",
          routingType: editSpecs.routingType || "",
          productType: editSpecs.productType || "",
          manufacturingSpecs: compiledSpecs,
          updatedAt: new Date().toISOString()
      });

      // MERGE ONLY WHAT THIS EDITOR OWNS (2026-07-26, the H2-05 stuck save): the old write spread
      // the ENTIRE captured doc back over itself — on a 1.6-built ASSEMBLY that re-sent a stale
      // copy of nodeClusters/revisions/GLB metadata (ballooning the write and racing other
      // sessions' assembly work). merge:true keeps every untouched field exactly as it is, so
      // only the fields this editor actually edits ride the wire. New parts still need their
      // identity fields, which live on the draft activePart (isNew itself must never persist).
      if (activePart.isNew) {
          const { isNew, itemName: _draftName, legacyErpId: _draftErp, ...identity } = activePart;
          Object.assign(payload, stripUndefinedDeep(identity), { createdAt: new Date().toISOString() });
      }
      // A write that never settles used to leave the button on "Saving..." forever with no
      // message — race a watchdog so a dead connection or a stale tab SAYS so instead.
      await Promise.race([
          setDoc(doc(db, "Approved_Designs", activePart.id), payload, { merge: true }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Save timed out after 20 seconds — check your connection; if the 'new version is live' banner is up, tap it (or hard-refresh) and try again. Nothing was saved.")), 20000)),
      ]);
      setTimeout(() => { setIsSaving(false); setActivePart(null); setUploadProgress(0); setCadUploadProgress(0); }, 500);
    } catch (err) { console.error(err); setIsSaving(false); alert(`Failed to save: ${err?.message || err}`); }
  };

  const handlePushUpdatesToNetSuite = async () => {
      if (!activePart || activePart.legacyErpId === "PENDING" || !activePart.netSuiteInternalId) {
          return alert("This item is not mapped to a NetSuite Internal ID yet. Sync it from ERP first.");
      }
      if (!window.confirm(`Push current local updates for ${activePart.legacyErpId} directly to NetSuite?`)) return;

      setIsPushingErp(true);
      try {
          const nsId = activePart.netSuiteInternalId;

          const payload = {
              itemid: editSpecs.tempLegacyId || activePart.legacyErpId,
              displayname: editSpecs.tempName || activePart.itemName,
              cost: parseFloat(editSpecs.cost) || 0,
              custitem9: parseFloat(editSpecs.basePrice) || 0
          };

          const pushWith = async (recordType) => {
              const targetUrl = `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/${recordType}/${nsId}`;
              const response = await nsProxyFetch({ targetUrl, method: 'PATCH', payload });
              const result = await response.json();
              return { ok: response.ok, result };
          };

          // partClass is the app's notion (Inventory vs Assembly), but the actual NetSuite record
          // type can differ — e.g. a part converted to an assembly code (FIRWW15) keeps partClass
          // 'Inventory' yet maps to a NetSuite assemblyitem. Prefer a previously-confirmed NS type,
          // else derive from partClass; on a type-mismatch NetSuite tells us the real type — retry
          // with it and remember it so future pushes go straight there.
          let recordType = activePart.netSuiteRecordType || (activePart.partClass === 'Inventory' ? 'inventoryitem' : 'assemblyitem');
          let { ok, result } = await pushWith(recordType);
          if (!ok) {
              const actual = JSON.stringify(result || '').match(/different type:\s*([a-z]+)/i)?.[1];
              if (actual && actual.toLowerCase() !== recordType) {
                  recordType = actual.toLowerCase();
                  ({ ok, result } = await pushWith(recordType));
              }
              if (!ok) throw new Error(JSON.stringify(result));
          }

          // Remember the confirmed record type so the retry isn't needed next time.
          if (activePart.netSuiteRecordType !== recordType) {
              try { await setDoc(doc(db, "Approved_Designs", activePart.id), { netSuiteRecordType: recordType }, { merge: true }); } catch (_) { /* non-fatal */ }
          }

          alert("✅ Successfully updated NetSuite ERP record!");
      } catch (error) {
          console.error("NetSuite Push Error:", error);
          alert(`❌ Failed to push to NetSuite. Check console for details.`);
      }
      setIsPushingErp(false);
  };

  const handleSyncShopRoutings = async () => {
      if (!window.confirm("Scan the Shop Floor database and import/update all machine routings and programs to HQ?")) return;

      try {
          const routingsSnap = await getDocs(collection(db, "shop_routings"));
          const programsSnap = await getDocs(collection(db, "shop_programs"));

          const programsMap = {};
          programsSnap.docs.forEach(d => programsMap[d.id] = d.data());

          let updatedCount = 0;
          const batch = writeBatch(db);

          routingsSnap.docs.forEach(routingDoc => {
              const rData = routingDoc.data();
              const targetPart = inventory.find(p => p.id === rData.partId || p.legacyErpId === rData.partId);

              if (targetPart) {
                  const bundledOps = rData.ops.map(op => {
                      const prog = programsMap[op.progId] || {};
                      return {
                          machine: op.machine,
                          progId: op.progId,
                          progName: prog.name || 'Unknown',
                          setupTime: prog.setupTime || 0,
                          timePerPiece: prog.timePerPiece || 0,
                          steps: prog.steps || ''
                      };
                  });

                  const hqRef = doc(db, "Approved_Designs", targetPart.id);
                  batch.update(hqRef, {
                      "manufacturingSpecs.shopRoutings": bundledOps
                  });
                  updatedCount++;
              }
          });

          await batch.commit();
          alert(`✅ Successfully synced ${updatedCount} Shop Routings to HQ Master Library!`);
      } catch (error) {
          console.error(error);
          alert("Sync Failed. Check console.");
      }
  };

  // Build an "Approved" Stock Build WO for a part and push it to RTG Dispatch. Returns the WO id.
  // Firestore doc ids can't contain "/", and finished assemblies carry it (e.g. H1-138BF/EP1) — sanitize it
  // out of the DOC id while keeping the real part number on the record (woDisplayId / partErpId) for display.
  const createStockBuildWO = async (part, qty) => {
      const stamp = Date.now().toString().slice(-6);
      const safeErp = String(part.legacyErpId).replace(/[^A-Za-z0-9]+/g, '-');
      const newWoId = `WO-${safeErp}-${stamp}`;
      // Source numbers only (2026-07-17): app id until the NetSuite WO posts, then nsWoTran.
      await setDoc(doc(db, "hq_work_orders", newWoId), {
          id: newWoId, woId: newWoId,
          woDisplayId: `WO-${part.legacyErpId}-${stamp}`, partErpId: part.legacyErpId,
          brand: activeBrand, status: "Approved", customer: "Internal Stock",
          hqJobId: part.id, totalParts: Number(qty),
          reqDate: new Date(Date.now() + 12096e5).toISOString().split('T')[0],
          type: "Stock Build", createdAt: Date.now()
      });
      return newWoId;
  };

  const handleGenerateWO = async () => {
      if (!activePart || activePart.legacyErpId === "PENDING") {
          return alert("Part must be saved with an ERP Legacy ID before generating a Work Order.");
      }
      const qty = Number(woTargetQty) || 0;
      if (qty <= 0) return alert("Enter a target quantity.");

      const erp = String(activePart.legacyErpId);
      // Outsourced finished assembly? code = base/CODE where CODE is an outsourced finish (e.g. H1-138BF/EP1).
      const slash = erp.lastIndexOf('/');
      const suffix = slash > -1 ? erp.slice(slash + 1).toUpperCase() : '';
      const outFinish = suffix ? outsourceFinishes.find(f => finishCodeOf(f) === suffix) : null;

      if (outFinish) {
          // Route via the base: base in stock → PickPack Plating; base short → shop-floor WO to make the base first.
          const baseErp = erp.slice(0, slash);
          const basePart = inventory.find(p => String(p.legacyErpId || p.itemId || '').toUpperCase() === baseErp.toUpperCase());
          if (!basePart) return alert(`Can't route ${erp}: its base component ${baseErp} isn't in the library. Add/sync ${baseErp} first.`);
          if (!window.confirm(`Generate plating demand for ${qty}x ${erp}?\n\nWe'll check stock of the base ${baseErp}:\n• in stock → PickPack Plating (pull + plate)\n• short → a shop-floor WO to build ${baseErp} first.`)) return;

          // Live NetSuite on-hand for the base at this brand's location.
          let onHand;
          try {
              const locationId = BRAND_NS_LOCATION[activeBrand] || "17";
              const q = `SELECT SUM(AggregateItemLocation.quantityonhand) AS onhand FROM Item LEFT JOIN AggregateItemLocation ON AggregateItemLocation.item = Item.id WHERE UPPER(Item.itemid) = '${baseErp.toUpperCase().replace(/'/g, "''")}' AND AggregateItemLocation.location = ${locationId} GROUP BY Item.itemid`;
              const resp = await nsProxyFetch({ targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`, method: 'POST', payload: { q } });
              const data = await resp.json().catch(() => ({}));
              if (!resp.ok) throw new Error(JSON.stringify(data));
              onHand = (data.items && data.items[0]) ? (parseInt(data.items[0].onhand) || 0) : 0;
          } catch (err) {
              console.error("Base stock check failed:", err);
              return alert(`Couldn't check NetSuite stock for ${baseErp} — nothing was created. Try again.`);
          }

          try {
              if (onHand >= qty) {
                  // Base in stock → plating to-do for PickPack (operator pulls + plates from there).
                  // Generate a plating WO# so the job/label has a reference for the plating company.
                  const demandId = `PLD-${activeBrand.toUpperCase()}-${Date.now()}`;
                  const woNum = `PLW-${activeBrand.toUpperCase()}-${Date.now().toString().slice(-6)}`;
                  await setDoc(doc(db, "plating_demand", demandId), {
                      id: demandId, brandId: activeBrand, status: 'open', woNum,
                      baseItemId: basePart.id, baseErpId: baseErp.toUpperCase(), targetErpId: erp.toUpperCase(),
                      finishCode: suffix, finishName: outFinish.name || '',
                      qty, source: 'library-wo', createdBy: currentUser?.name || 'Unknown', createdAt: Date.now()
                  });
                  alert(`✅ ${baseErp} in stock (${onHand} on hand). Sent ${qty}x → PickPack Plating ("Needs Plating", WO ${woNum}) to pull + plate into ${erp}.`);
              } else {
                  // Base short → shop-floor WO to build the base; plate it after.
                  const woId = await createStockBuildWO(basePart, qty);
                  alert(`⚠️ ${baseErp} short (${onHand} on hand, need ${qty}). Generated shop-floor WO ${woId} to build ${baseErp}; plate it into ${erp} after it's made.`);
              }
              setWoTargetQty(1);
          } catch (err) {
              console.error("Plating demand routing error:", err);
              alert("Failed to route the demand. Check console.");
          }
          return;
      }

      // Default: in-house / non-finish → shop-floor Stock Build WO for this part.
      if (!window.confirm(`Generate a Stock Build Work Order for ${qty}x ${erp}?`)) return;
      try {
          const woId = await createStockBuildWO(activePart, qty);
          alert(`✅ Work Order ${woId} successfully pushed to RTG Dispatch!`);
          setWoTargetQty(1);
      } catch (err) {
          console.error("WO Generation Error:", err);
          alert("Failed to generate Work Order. Check console.");
      }
  };

  const fieldStyle = { width: '100%', padding: '12px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none', background: '#fff' };
  const labelStyle = { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px', letterSpacing: '.1em' };
  const sectionHeaderStyle = { margin: '0 0 20px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)', borderBottom: '1px solid var(--line)', paddingBottom: '10px' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '30px', fontFamily: 'var(--sans)', backgroundColor: 'transparent', minHeight: '100vh' }}>
      
      <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)' }}>Master Library</h2>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', paddingLeft: '16px', borderLeft: '1px solid var(--line)' }}>{inventory.length} Approved Records</span>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          
          <select value={partClassFilter} onChange={(e) => setPartClassFilter(e.target.value)} style={{ padding: '10px 12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.9rem', outline: 'none', background: 'var(--paper-2)', minWidth: '150px' }}>
              <option value="ALL">All Classes</option>
              <option value="INVENTORY">Raw Mat / Components (In-House)</option>
              <option value="OUTSOURCED">Outsourced Components</option>
              <option value="FEES">Fees & Charges</option>
              <optgroup label="Assemblies & Kits">
                  <option value="UNASSIGNED">Unassigned / Pending</option>
                  {(globalLists.assemblyTypes || []).map(type => (
                      <option key={type} value={type}>{type}</option>
                  ))}
              </optgroup>
          </select>
          
          <button onClick={handleCreateNewPart} style={{ padding: '10px 20px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>+ New Record</button>

          <button onClick={handleSyncThumbnails} disabled={!!syncingThumbs} title="Match image-less parts to Asset Gallery images by pattern + finish (e.g. H1-138BE / P01) and set their thumbnails. Re-runnable as you add images." style={{ padding: '10px 20px', background: syncingThumbs ? 'var(--ink-soft)' : 'var(--brass)', color: '#fff', border: 'none', cursor: syncingThumbs ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' }}>
              {syncingThumbs ? `⟳ Syncing ${syncingThumbs.done}/${syncingThumbs.total}` : '⟳ Sync Thumbnails'}
          </button>
          
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

          <input placeholder="Search Name, ERP, Bin..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ width: '200px', padding: '10px 12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.9rem', outline: 'none' }} />
          <button onClick={() => setAppOnlyFilter(v => !v)} title="Show only app-created parts with no NetSuite item # (legacyErpId PENDING + no internal id) — for finding residual items to clean up" style={{ padding: '10px 14px', border: `1px solid ${appOnlyFilter ? 'var(--brass)' : 'var(--line)'}`, background: appOnlyFilter ? 'var(--brass)' : '#fff', color: appOnlyFilter ? '#fff' : 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.05em', cursor: 'pointer', whiteSpace: 'nowrap' }}>{appOnlyFilter ? '✓ App-only (no NS#)' : 'App-only (no NS#)'}</button>
          <button onClick={() => setPartClassFilter(v => v === 'FEES' ? 'ALL' : 'FEES')} title="Show ONLY fee items — matched by product type FEE, class Fee, or the CE-FEE-… code convention, so NetSuite-synced fees show too (they no longer surface under App-only)" style={{ padding: '10px 14px', border: `1px solid ${partClassFilter === 'FEES' ? 'var(--brass)' : 'var(--line)'}`, background: partClassFilter === 'FEES' ? 'var(--brass)' : '#fff', color: partClassFilter === 'FEES' ? '#fff' : 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.05em', cursor: 'pointer', whiteSpace: 'nowrap' }}>{partClassFilter === 'FEES' ? '✓ 💲 Fees only' : '💲 Fees only'}</button>
          <button onClick={fixEncoding} disabled={mojiBusy} title="Repair garbled imported text (e.g. 1â€³ → 1″): UTF-8 that was mis-read as Windows-1252 during an import. Sweeps item names/descriptions AND the option labels baked into CPQ flows; only provably-garbled strings are changed — clean text can't be touched." style={{ padding: '10px 14px', border: '1px solid var(--line)', background: '#fff', color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.05em', cursor: mojiBusy ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}>{mojiBusy ? '⟳ Fixing…' : '🔤 Fix garbled text'}</button>
          <button onClick={() => setTempFilter(v => !v)} title="Show only TEMP-flagged items — legacy NetSuite items loaded temporarily (checkbox custitem_app_temp) so finishing can run 100% in-app until they're discontinued" style={{ padding: '10px 14px', border: `1px solid ${tempFilter ? 'var(--brass)' : 'var(--line)'}`, background: tempFilter ? 'var(--brass)' : '#fff', color: tempFilter ? '#fff' : 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.05em', cursor: 'pointer', whiteSpace: 'nowrap' }}>{tempFilter ? '✓ ⏳ Temp items' : '⏳ Temp items'}</button>
          {tempFilter && (
              <button onClick={nukeTempItems} disabled={tempBusy} title="Delete ALL TEMP-flagged items in this brand from the app library (items referenced by a BOM or CPQ flow are skipped and listed). NetSuite is untouched — uncheck their sync flag there too, or the next item sync brings them back. Typed confirmation required." style={{ padding: '10px 14px', border: 'none', background: '#d9534f', color: '#fff', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.05em', cursor: tempBusy ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}>{tempBusy ? '⟳ Working…' : '☢ Nuke temp items'}</button>
          )}
          <button onClick={scanOrphans} disabled={orphanBusy} title="Scan every assembly BOM (assembly_pins) and every CPQ flow (linked assemblies/items, style & sub options, included parts), then show ONLY items with no NetSuite id that nothing references — test leftovers safe to clean out" style={{ padding: '10px 14px', border: `1px solid ${orphanMode ? '#d9534f' : 'var(--line)'}`, background: orphanMode ? '#d9534f' : '#fff', color: orphanMode ? '#fff' : 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.05em', cursor: orphanBusy ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}>{orphanBusy ? '⟳ Scanning…' : orphanMode ? '✓ 🧹 Orphans' : '🧹 Orphans (unused · no NS#)'}</button>
          {orphanMode && !orphanBusy && (
              <button onClick={() => deleteOrphans(filteredInventory)} disabled={filteredInventory.length === 0} title="Delete every item currently shown (all unreferenced + NetSuite-less). Search/filters narrow what's shown first." style={{ padding: '10px 14px', border: 'none', background: filteredInventory.length ? '#d9534f' : 'var(--paper-2)', color: filteredInventory.length ? '#fff' : 'var(--ink-soft)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.05em', cursor: filteredInventory.length ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap' }}>🗑 Delete {filteredInventory.length} shown</button>
          )}
        </div>
      </div>

      {isAdmin && (
        <div style={{ marginBottom: '20px' }}>
          <button onClick={() => setShowCollMgr(v => !v)} style={{ background: 'transparent', border: '1px solid var(--line)', padding: '8px 16px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer', color: 'var(--ink-soft)' }}>
            {showCollMgr ? '▾' : '▸'} Manage Collection Brands ({collectionsData.length})
          </button>
          {showCollMgr && (
            <div style={{ marginTop: '12px', border: '1px solid var(--line)', background: 'var(--paper-2)', padding: '20px', borderRadius: '2px' }}>
              <p style={{ marginTop: 0, fontSize: '0.85rem', color: 'var(--ink-soft)' }}>Assign each collection to a brand — collections only appear under their own brand across the app. New collections are auto-branded to wherever they're created.</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '10px' }}>
                {[...collectionsData].sort((a, b) => String(a.name).localeCompare(String(b.name))).map(c => {
                  const dupCount = collectionsData.filter(x => String(x.name).trim().toUpperCase() === String(c.name).trim().toUpperCase()).length;
                  return (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', background: '#fff', border: dupCount > 1 ? '1px solid var(--brass)' : '1px solid var(--line)', padding: '10px 14px' }}>
                    <span style={{ fontFamily: 'var(--sans)', fontSize: '0.95rem', fontWeight: 500, color: 'var(--ink)' }}>{c.name}{dupCount > 1 && <span title="Duplicate name — delete the extra to merge" style={{ marginLeft: '8px', fontFamily: 'var(--mono)', fontSize: '8px', color: '#fff', background: 'var(--brass)', padding: '1px 5px', textTransform: 'uppercase' }}>Dup ×{dupCount}</span>}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <select value={c.brandId || ''} onChange={async (e) => { try { await setDoc(doc(db, 'hq_collections', c.id), { brandId: e.target.value }, { merge: true }); } catch (err) { console.error(err); alert('Update failed: ' + (err.message || err)); } }} style={{ padding: '6px 10px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.85rem' }}>
                        <option value="">— Unassigned —</option>
                        {AVAILABLE_BRANDS.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                      <button title="Delete this collection record (items keep their collection name)" onClick={async () => { if (!window.confirm(`Delete collection record "${c.name}"?${dupCount > 1 ? '\n\nThis is a duplicate — items reference the collection by name, so they stay grouped under the remaining one.' : '\n\nItems will keep the name but it will no longer be a registered collection.'}`)) return; try { await deleteDoc(doc(db, 'hq_collections', c.id)); } catch (err) { console.error(err); alert('Delete failed: ' + (err.message || err)); } }} style={{ background: 'transparent', border: 'none', color: '#d9534f', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1, padding: '0 4px' }}>×</button>
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>

        <div style={{ flex: activePart ? 1 : 1, display: 'grid', gridTemplateColumns: activePart ? 'repeat(auto-fill, minmax(200px, 1fr))' : 'repeat(auto-fill, minmax(250px, 1fr))', gap: '16px', alignContent: 'start' }}>
          {filteredInventory.length === 0 && <div style={{ color: 'var(--ink-soft)', fontStyle: 'italic', padding: '24px', fontFamily: 'var(--serif)', fontSize: '1.2rem' }}>No {partClassFilter === 'ALL' ? 'records' : partClassFilter} found in this category.</div>}
          {filteredInventory.map(part => {
            const specs = part.manufacturingSpecs || {};
            const nsWatchlist = specs.customData?.watchlist && specs.customData.watchlist !== 'N/A' ? specs.customData.watchlist.toUpperCase() : "NONE";
            const currentWatchList = specs.watchList ? specs.watchList.toUpperCase() : nsWatchlist;
            const isWatchlist = currentWatchList !== "NONE";
            const displayId = part.legacyErpId && part.legacyErpId !== "PENDING" ? part.legacyErpId : part.itemId;
            const isSharedIn = part.brandId !== activeBrand; 

            let classColor = 'var(--ink-soft)'; 
            if (part.partClass === 'Assembly') classColor = 'var(--ink)'; 
            if (part.partClass === 'Master Assembly') classColor = 'var(--brass)'; 

            return (
              <div key={part.id} onClick={() => openPartDetails(part)} style={{ background: '#fff', border: activePart?.id === part.id ? `1px solid ${classColor}` : '1px solid var(--line)', cursor: 'pointer', position: 'relative', display: 'flex', flexDirection: 'column', transition: 'all 0.2s', boxShadow: activePart?.id === part.id ? '0 4px 12px rgba(0,0,0,0.05)' : 'none' }}>
                {isWatchlist && <div style={{ position: 'absolute', top: '-10px', right: '-10px', background: '#d9534f', color: '#fff', padding: '4px 8px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', zIndex: 2, boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>★ {currentWatchList}</div>}
                {isSharedIn && <div style={{ position: 'absolute', top: '10px', left: '10px', background: 'var(--paper-2)', color: 'var(--ink)', padding: '4px 8px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', zIndex: 2 }}>Shared from {part.brandId.toUpperCase()}</div>}
                {orphanMode && <button onClick={(e) => deleteSingleOrphan(part, e)} title="Delete this orphan item (no NetSuite id · unreferenced by any BOM or CPQ flow)" style={{ position: 'absolute', top: '10px', right: '10px', zIndex: 3, width: '28px', height: '28px', background: '#d9534f', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '1.05rem', lineHeight: 1, boxShadow: '0 2px 6px rgba(0,0,0,0.2)' }}>×</button>}

                <div style={{ height: '180px', background: 'var(--paper)', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {(part.finalImageUrl || part.componentImageUrl) ? <img src={part.finalImageUrl || part.componentImageUrl} alt="Part" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ color: 'var(--ink-soft)', fontFamily: 'var(--sans)', fontSize: '0.85rem' }}>{part.manufacturingSpecs?.cadUrl ? '🧊 3D CAD' : 'No Image'}</span>}
                </div>

                <div style={{ padding: '20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: classColor, marginBottom: '8px' }}>{displayId} <span style={{opacity: 0.6}}>({part.partClass})</span></div>
                  {specs.aliasOf && <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--brass)', marginBottom: '6px' }}>🔗 alias → {specs.aliasOf}</div>}
                  
                  {part.clientPricing && part.clientPricing.length > 0 && (
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink)', marginBottom: '4px' }}>
                          {part.clientPricing.length} Client Mapping(s)
                      </div>
                  )}
                  {specs.binLocation && (
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: '8px' }}>
                          Bin: {specs.binLocation}
                      </div>
                  )}

                  <div style={{ fontFamily: 'var(--sans)', fontSize: '1rem', fontWeight: 500, lineHeight: '1.4', color: 'var(--ink)', flex: 1 }}>{part.itemName}</div>
                  
                  {part.partClass === "Inventory" ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--line)', paddingTop: '12px', marginTop: '16px' }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{specs.productType || "No Type"}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{specs.parametric?.length || 0}L × {specs.parametric?.width || 0}W</span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--line)', paddingTop: '12px', marginTop: '16px' }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{part.project || 'No Project'}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{part.routingType || 'Unassigned'}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {activePart && (
          <div style={{ flex: 1.5, background: '#fff', border: '1px solid var(--line)', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', position: 'sticky', top: '20px', maxHeight: '90vh', overflowY: 'auto', borderRadius: '2px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '24px 30px', background: 'var(--paper-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 10, borderBottom: '1px solid var(--line)' }}>
              <div>
                  <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>{activePart.isNew ? `New ${partClassFilter} Setup` : (activePart.legacyErpId !== "PENDING" ? activePart.legacyErpId : activePart.itemId)}</h3>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', marginTop: '4px', display: 'block' }}>{activePart.isNew ? "Define Master Details Below" : activePart.itemName}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {!activePart.isNew && (() => {
                  const url = resolvePrintUrlAny(printMap, [activePart.legacyErpId, activePart.itemName, activePart.itemId, activePart.manufacturingSpecs?.programNum, editSpecs.programNum]);
                  return url
                    ? <button onClick={() => window.open(url, '_blank')} style={{ background: 'var(--paper)', color: 'var(--ink)', border: '1px solid var(--line)', padding: '8px 14px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer', whiteSpace: 'nowrap' }}>🖨 Print</button>
                    : <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', border: '1px dashed var(--line)', padding: '8px 12px', whiteSpace: 'nowrap' }}>No print on file</span>;
                })()}
                <button onClick={() => setActivePart(null)} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', fontSize: '1.5rem', cursor: 'pointer' }}>×</button>
              </div>
            </div>

            <div style={{ padding: '30px', display: 'flex', flexDirection: 'column', gap: '30px' }}>
              
              {activePart.partClass !== 'Inventory' && (
                  <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', padding: '24px' }}>
                      <h4 style={sectionHeaderStyle}>Assembly Configuration</h4>
                      
                      <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '16px', display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
                          <input 
                              type="checkbox" 
                              checked={editSpecs.isProjectManaged || false} 
                              onChange={e => setEditSpecs({...editSpecs, isProjectManaged: e.target.checked})} 
                              style={{ cursor: 'pointer' }} 
                          />
                          <div>
                              <div style={{ fontFamily: 'var(--sans)', fontSize: '0.95rem', fontWeight: 500, color: 'var(--ink)' }}>Flag as Complex Project (Route to Project Mgmt)</div>
                              <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '4px' }}>Checking this box ensures that when this product is quoted/ordered, it routes to the Project Management dashboard for multi-WO/PO dissection.</div>
                          </div>
                      </div>
                      
                      {activePart.revisions && activePart.revisions.length > 0 && (
                          <div style={{ marginBottom: '24px' }}>
                              <label style={labelStyle}>Revision Gallery ({activePart.revisions.length} Angles/Images)</label>
                              <div style={{ display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '12px' }}>
                                  {activePart.revisions.map((rev, idx) => (
                                      <div key={idx} style={{ flexShrink: 0, width: '100px', height: '100px', border: rev.url === activePart.finalImageUrl || rev.url === activePart.manufacturingSpecs?.cadUrl ? '2px solid var(--brass)' : '1px solid var(--line)', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                                          {rev.is3D || rev.name?.includes('3D') ? <span style={{fontFamily: 'var(--sans)', fontSize: '0.85rem', color: 'var(--ink-soft)'}}>3D CAD</span> : <img src={rev.url} alt="Rev" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '4px' }} />}
                                          {(rev.url === activePart.finalImageUrl || rev.url === activePart.manufacturingSpecs?.cadUrl) && <div style={{ position: 'absolute', bottom: 0, width: '100%', background: 'var(--brass)', color: '#fff', fontFamily: 'var(--mono)', fontSize: '8px', textTransform: 'uppercase', textAlign: 'center', letterSpacing: '.1em', padding: '2px 0' }}>Master</div>}
                                      </div>
                                  ))}
                              </div>
                          </div>
                      )}

                      {(activePart.partClass === 'Master Assembly' || activePart.partClass === 'Assembly') && (
                          <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '20px' }}>
                              <div style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)', marginBottom: '12px' }}>File Cabinet: {activePart.legacyErpId !== "PENDING" ? activePart.legacyErpId : activePart.itemId}</div>
                              {activeBomPins.length === 0 ? (
                                  <div style={{ fontSize: '0.9rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>↳ No nested components pinned yet. (Sync from ERP or drop pins in Visual Assembly)</div>
                              ) : (
                                  activeBomPins.map(pin => (
                                      <div key={pin.id} style={{ fontFamily: 'var(--sans)', fontSize: '0.9rem', color: 'var(--ink)', marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                          <span style={{ color: 'var(--ink-soft)' }}>↳</span> 
                                          <span><strong>{pin.defaultQty || 1}x</strong> {pin.partName || pin.partId}</span>
                                      </div>
                                  ))
                              )}
                          </div>
                      )}
                  </div>
              )}

              <div style={{ background: 'var(--paper-2)', padding: '24px', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <label style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)', display: 'block', marginBottom: '8px' }}>
                      Clone CPQ Attributes & Specs
                  </label>
                  <div style={{ display: 'flex', gap: '16px' }}>
                      <select value={cloneSourceId} onChange={(e) => setCloneSourceId(e.target.value)} style={fieldStyle}>
                          <option value="">-- Select Source Record --</option>
                          {inventory.filter(p => p.id !== activePart.id).map(p => (
                              <option key={p.id} value={p.id}>{p.legacyErpId && p.legacyErpId !== "PENDING" ? `[${p.legacyErpId}] ` : ''}{p.itemName}</option>
                          ))}
                      </select>
                      <button onClick={handleCloneSpecs} disabled={!cloneSourceId} style={{ padding: '0 24px', background: cloneSourceId ? 'var(--ink)' : 'transparent', color: cloneSourceId ? '#fff' : 'var(--ink-soft)', border: cloneSourceId ? 'none' : '1px solid var(--line)', cursor: cloneSourceId ? 'pointer' : 'not-allowed', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>Clone Data</button>
                  </div>
              </div>

              <div>
                 <h4 style={sectionHeaderStyle}>Identification</h4>
                 
                 <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '20px', marginBottom: '24px' }}>
                     <div>
                         <label style={labelStyle}>Record Name / Description</label>
                         <input name="tempName" value={editSpecs.tempName !== undefined ? editSpecs.tempName : activePart.itemName} onChange={handleSpecChange} style={fieldStyle} />
                     </div>
                     <div>
                         <label style={labelStyle}>ERP Legacy ID (Internal)</label>
                         <input name="tempLegacyId" value={editSpecs.tempLegacyId !== undefined ? editSpecs.tempLegacyId : (activePart.legacyErpId === "PENDING" ? "" : activePart.legacyErpId)} onChange={handleSpecChange} placeholder="e.g. P-1234" style={{ ...fieldStyle, textTransform: 'uppercase' }} />
                     </div>
                     <div>
                         <label style={labelStyle}>BOM Revision</label>
                         <input name="bomRevision" value={editSpecs.bomRevision || ''} onChange={handleSpecChange} placeholder="N/A" style={fieldStyle} />
                     </div>
                 </div>

                 <div style={{ marginBottom: '30px' }}>
                     <label style={labelStyle}>Warehouse Bin Location (Barcode/Ref)</label>
                     <input name="binLocation" value={editSpecs.binLocation || ''} onChange={handleSpecChange} placeholder="e.g. A1-B2-04" style={{ ...fieldStyle, textTransform: 'uppercase' }} />
                     <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '6px' }}>Used by the Pick/Pack App to guide operators to the physical item location.</div>
                 </div>

                 <div style={{ background: 'var(--paper)', padding: '24px', border: '1px solid var(--line)' }}>
                    <h4 style={{ margin: '0 0 20px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)', borderBottom: '1px solid var(--line)', paddingBottom: '10px' }}>Client-Specific Pricing & SKUs</h4>
                    
                    <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', marginBottom: '24px' }}>
                        <div style={{ flex: 1.5 }}>
                            <label style={labelStyle}>Customer (Name - ID)</label>
                           <select value={newClientPricing.customerId} onChange={e => setNewClientPricing({...newClientPricing, customerId: e.target.value})} style={fieldStyle}>
                                <option value="">Select Customer...</option>
                                {/* Store the customer ID (was the NAME — which the CPQ's id-based match never found). */}
                                {liveCustomers.map(c => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
                            </select>
                        </div>
                        <div style={{ flex: 1.5 }}>
                            <label style={labelStyle}>Client SKU / Part #</label>
                            <input value={newClientPricing.clientSku} onChange={e => setNewClientPricing({...newClientPricing, clientSku: e.target.value})} placeholder="e.g. Brimar-8483" style={fieldStyle} />
                        </div>
                        <div style={{ flex: 1 }}>
                            <label style={labelStyle}>Client Cost ($)</label>
                            <input type="number" step="0.01" value={newClientPricing.price} onChange={e => setNewClientPricing({...newClientPricing, price: e.target.value})} placeholder="0.00" style={fieldStyle} />
                        </div>
                        <div style={{ flex: 1 }}>
                            <label style={labelStyle}>Client Sales Price ($)</label>
                            <input type="number" step="0.01" value={newClientPricing.clientSalesPrice} onChange={e => setNewClientPricing({...newClientPricing, clientSalesPrice: e.target.value})} placeholder="0.00" style={fieldStyle} />
                        </div>
                        <button onClick={handleAddClientPricing} style={{ padding: '12px 24px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Add</button>
                    </div>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {(editSpecs.clientPricing || []).length === 0 && <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No custom client pricing assigned. Defaults to Base Price.</div>}
                        {(editSpecs.clientPricing || []).map((cp, idx) => (
                            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', border: '1px solid var(--line)', padding: '12px 16px' }}>
                                <div style={{ display: 'flex', gap: '24px', fontSize: '0.9rem', width: '100%', alignItems: 'center', color: 'var(--ink)' }}>
                                    <span style={{ fontWeight: 500, flex: 1 }}>{(liveCustomers.find(c => c.id === cp.customerId)?.name || cp.customerId)}{liveCustomers.some(c => c.id === cp.customerId) && <span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}> ({cp.customerId})</span>}</span>
                                    <span style={{ flex: 1, color: 'var(--ink-soft)' }}>SKU: <span style={{ color: 'var(--ink)' }}>{cp.clientSku || 'N/A'}</span></span>
                                    <span style={{ width: '100px', textAlign: 'right' }}>Cost: ${parseFloat(cp.price || 0).toFixed(2)}</span>
                                    <span style={{ fontWeight: 500, width: '120px', textAlign: 'right' }}>Sales: ${parseFloat(cp.clientSalesPrice || 0).toFixed(2)}</span>
                                </div>
                                <button onClick={() => handleRemoveClientPricing(idx)} style={{ background: 'none', border: 'none', color: '#d9534f', fontSize: '1.2rem', cursor: 'pointer', marginLeft: '16px' }}>×</button>
                            </div>
                        ))}
                    </div>
                 </div>

                 {/* FABRICUT PRICING & GROUPING — reads/writes the SAME manufacturingSpecs.fabricut
                     struct the CrossReference import stamps and the CPQ price levels consume
                     (Shared/priceLevels.js). Blank = no data at that tier (standard pricing);
                     "included w/ arm" = explicit null = quotes $0 (the arm price covers it). */}
                 {(() => {
                     const fab = editSpecs.fabricut;
                     const codeUp = String(editSpecs.tempLegacyId || activePart.legacyErpId || '').toUpperCase();
                     const isBpPlate = /(^|-)R?BP(-|\/|$)/.test(codeUp);
                     const isCpPlate = /(^|-)R?CP(-|\/|$)/.test(codeUp);
                     if (!fab) return (
                         <div style={{ marginTop: '30px' }}>
                             <button onClick={() => setEditSpecs(prev => ({ ...prev, fabricut: { source: 'MANUAL', importedAt: new Date().toISOString() } }))} style={{ padding: '10px 18px', background: 'transparent', border: '1px dashed var(--line)', color: 'var(--ink-soft)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>＋ Add Fabricut Pricing</button>
                         </div>
                     );
                     const setF = (k, v) => setEditSpecs(prev => ({ ...prev, fabricut: { ...(prev.fabricut || {}), [k]: v } }));
                     const numVal = (v) => (v === null || v === undefined) ? '' : v;
                     const TIERS = [
                         { key: 'direct', label: `This item's price${fab.tier ? ` · tier ${fab.tier}` : ''}`, hint: 'finish variants, single-finish & species items', f: { cost: 'cost', wholesale: 'wholesale', retail: 'retail' } },
                         { key: 'painted', label: 'Painted tier (/P)', hint: 'on the mill base — prices the painted variants', f: { cost: 'paintedCost', wholesale: 'paintedWholesale', retail: 'paintedRetail' } },
                         { key: 'plated', label: 'Plated tier (/EP1–6)', hint: 'on the mill base — prices the plated variants', f: { cost: 'platedCost', wholesale: 'platedWholesale', retail: 'platedRetail' } },
                     ];
                     const tierIncluded = (t) => fab[t.f.cost] === null && fab[t.f.retail] === null;
                     const toggleIncl = (t) => (e) => {
                         const v = e.target.checked ? null : '';
                         setEditSpecs(prev => ({ ...prev, fabricut: { ...(prev.fabricut || {}), [t.f.cost]: v, [t.f.wholesale]: v, [t.f.retail]: v } }));
                     };
                     const cpCost = fab.cost !== undefined ? fab.cost : (fab.platedCost !== undefined ? fab.platedCost : fab.paintedCost);
                     const cpRetail = fab.retail !== undefined ? fab.retail : (fab.platedRetail !== undefined ? fab.platedRetail : fab.paintedRetail);
                     let groupSuggest = '';
                     if (isBpPlate) groupSuggest = 'Included with bracket arms — $0 (the arm price covers this backplate)';
                     else if (isCpPlate) {
                         const c = parseFloat(cpCost), r = parseFloat(cpRetail);
                         groupSuggest = `Upcharge included with bracket arms${Number.isFinite(c) ? ` — +$${c.toFixed(2)} cost` : ''}${Number.isFinite(r) ? ` / +$${r.toFixed(2)} retail` : ''} over the included backplate`;
                     }
                     const resolvedCode = fabricutCodeOf({ ...activePart, legacyErpId: codeUp, manufacturingSpecs: { ...(activePart.manufacturingSpecs || {}), fabricut: fab } }, findByCode, outsourceFinishes);
                     const cellStyle = { flex: 1 };
                     return (
                         <div style={{ marginTop: '30px', background: 'var(--paper)', padding: '24px', border: '1px solid var(--brass)' }}>
                             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '1px solid var(--line)', paddingBottom: '10px', marginBottom: '18px' }}>
                                 <h4 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>Fabricut Pricing & Grouping</h4>
                                 <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{fab.source || 'CrossReference'}{fab.importedAt ? ` · ${String(fab.importedAt).slice(0, 10)}` : ''} · drives the CPQ price levels</span>
                             </div>

                             {resolvedCode && <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink)', marginBottom: '14px' }}>Resolved pattern #: <b>{resolvedCode}</b>{codeUp.includes('/') ? <span style={{ color: 'var(--ink-soft)' }}> (codes live on the base item)</span> : null}</div>}

                             {TIERS.map(t => {
                                 const incl = tierIncluded(t);
                                 return (
                                     <div key={t.key} style={{ display: 'flex', gap: '14px', alignItems: 'flex-end', marginBottom: '14px' }}>
                                         <div style={{ width: '230px' }}>
                                             <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink)' }}>{t.label}</div>
                                             <div style={{ fontSize: '0.72rem', color: 'var(--ink-soft)' }}>{t.hint}</div>
                                         </div>
                                         {[['Cost (CE → Fabricut)', t.f.cost], ['Wholesale', t.f.wholesale], ['Retail (MSRP)', t.f.retail]].map(([lbl, k]) => (
                                             <div key={k} style={cellStyle}>
                                                 <label style={{ ...labelStyle, marginBottom: '4px' }}>{lbl}</label>
                                                 <input type="number" step="0.01" disabled={incl} value={numVal(fab[k])} placeholder={k.toLowerCase().includes('wholesale') ? 'retail ÷ 2' : '—'} onChange={e => setF(k, e.target.value === '' ? '' : (parseFloat(e.target.value) || 0))} style={{ ...fieldStyle, opacity: incl ? 0.4 : 1 }} />
                                             </div>
                                         ))}
                                         <label title="Explicit $0 — this tier is priced in conjunction with the arm (the arm price covers it)" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.05em', color: incl ? 'var(--brass)' : 'var(--ink-soft)', cursor: 'pointer', paddingBottom: '12px', whiteSpace: 'nowrap' }}>
                                             <input type="checkbox" checked={incl} onChange={toggleIncl(t)} /> $0 · w/ arm
                                         </label>
                                     </div>
                                 );
                             })}

                             <div style={{ display: 'flex', gap: '14px', marginTop: '4px', marginBottom: '16px' }}>
                                 {[['Pattern # (painted)', 'fabCodePainted'], ['Pattern # (premium /EP)', 'fabCodePremium'], ['Pattern # (base)', 'fabCodeBase']].map(([lbl, k]) => (
                                     <div key={k} style={{ flex: 1 }}>
                                         <label style={{ ...labelStyle, marginBottom: '4px' }}>{lbl}</label>
                                         <input value={fab[k] || ''} onChange={e => setF(k, e.target.value.toUpperCase())} placeholder={codeUp.includes('/') ? 'set on the base item' : '—'} style={{ ...fieldStyle, textTransform: 'uppercase' }} />
                                     </div>
                                 ))}
                             </div>

                             <div style={{ marginBottom: '18px' }}>
                                 <label style={{ ...labelStyle, marginBottom: '4px' }}>Priced in conjunction with…</label>
                                 <div style={{ display: 'flex', gap: '10px' }}>
                                     <input value={fab.pricedWith || ''} onChange={e => setF('pricedWith', e.target.value)} placeholder={groupSuggest || 'e.g. Priced in conjunction with H1 bracket arms'} style={{ ...fieldStyle, flex: 1 }} />
                                     {groupSuggest && !fab.pricedWith && <button onClick={() => setF('pricedWith', groupSuggest)} style={{ padding: '0 16px', background: 'var(--paper-2)', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Use suggestion</button>}
                                 </div>
                                 {(isBpPlate || isCpPlate) && <div style={{ fontSize: '0.78rem', color: 'var(--brass)', marginTop: '6px' }}>{isBpPlate ? 'Backplate — the group pricing rule quotes this at $0; the bracket arm carries the value.' : 'Coverplate — quotes as a flat upcharge alongside the bracket arm (the numbers above are that upcharge).'}</div>}
                             </div>

                             <div style={{ display: 'flex', gap: '12px', borderTop: '1px dashed var(--line)', paddingTop: '14px' }}>
                                 <button onClick={() => {
                                     const cust = fabricutCustomer();
                                     if (!cust) return alert("No CRM customer matching 'Fabricut' found for this brand — sync the Fabricut customer (11.1) first, or add the row manually above.");
                                     const row = fabClientRowFor(activePart, fab, cust.id);
                                     if (!row) return alert('This item has no direct sellable Fabricut price (group-priced $0 plates stay out of Client Pricing — their rule shows above).');
                                     setEditSpecs(prev => ({ ...prev, clientPricing: [...(prev.clientPricing || []).filter(cp => cp.customerId !== cust.id), row] }));
                                 }} style={{ padding: '10px 16px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>↑ Add to Client Pricing (this item)</button>
                                 <button onClick={bulkFabricutClientPricing} disabled={isBulkFab} style={{ padding: '10px 16px', background: isBulkFab ? 'var(--paper-2)' : 'var(--brass)', color: isBulkFab ? 'var(--ink-soft)' : '#fff', border: 'none', cursor: isBulkFab ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>{isBulkFab ? 'Writing…' : '⇄ Populate Client Pricing — ALL Fabricut items'}</button>
                                 <span style={{ alignSelf: 'center', fontSize: '0.75rem', color: 'var(--ink-soft)' }}>SKU = pattern # · Client Cost = CE → Fabricut · Sales = wholesale. Save the record to keep field edits.</span>
                             </div>
                         </div>
                     );
                 })()}

                 {/* ALIASES — alternate item ids that point back to this item (or, on an alias
                     record, the link home). CPQ prices/names from the alias; BOM, NetSuite push and
                     demand always resolve to the MAIN item. */}
                 {(() => {
                     const myAliasOf = activePart?.manufacturingSpecs?.aliasOf || activePart?.aliasOf || '';
                     if (myAliasOf) {
                         const mainPart = inventory.find(p => [p.id, p.itemId, p.legacyErpId].filter(Boolean).map(x => String(x).toUpperCase()).includes(String(myAliasOf).toUpperCase()));
                         return (
                             <div style={{ marginTop: '30px', background: '#fff8ec', padding: '20px 24px', border: '1px solid var(--brass)' }}>
                                 <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--brass)', marginBottom: '6px' }}>🔗 This record is an ALIAS</div>
                                 <div style={{ fontSize: '0.9rem', color: 'var(--ink)' }}>
                                     Points to <b>{myAliasOf}</b>{mainPart ? ` — ${mainPart.itemName}` : ' (main item not found in this brand!)'}. Name & Base Price on THIS record drive CPQ quotes; the BOM, NetSuite push and all demand land on the main item.
                                     {mainPart && <button onClick={() => openPartDetails(mainPart)} style={{ marginLeft: '12px', padding: '6px 12px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase' }}>Open main item</button>}
                                 </div>
                             </div>
                         );
                     }
                     const myAliases = aliasesOf(activePart);
                     return (
                         <div style={{ marginTop: '30px', background: 'var(--paper)', padding: '24px', border: '1px solid var(--line)' }}>
                             <h4 style={{ margin: '0 0 6px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>Aliases — alternate item ids</h4>
                             <div style={{ fontSize: '0.82rem', color: 'var(--ink-soft)', marginBottom: '16px' }}>
                                 Sell this exact item under a different id, description and price (e.g. {codeOfPart(activePart) || 'H1-1BE'} → H2-1BE "Standard Bracket" for a new collection). CPQ uses the alias's name & price; the BOM, NetSuite push and stock demand always roll back to <b>{codeOfPart(activePart)}</b>. Pin the alias code in an assembly / flow to offer it.
                             </div>
                             {myAliases.length > 0 && (
                                 <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
                                     {myAliases.map(a => (
                                         <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '14px', background: '#fff', border: '1px solid var(--line)', padding: '10px 14px' }}>
                                             <span style={{ fontFamily: 'var(--mono)', fontSize: '12px', fontWeight: 700, color: 'var(--ink)' }}>{codeOfPart(a)}</span>
                                             <span style={{ flex: 1, fontSize: '0.9rem', color: 'var(--ink-soft)' }}>{a.itemName}{(a.manufacturingSpecs?.collections || []).length ? ` · ${(a.manufacturingSpecs.collections).join(', ')}` : ''}</span>
                                             <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink)' }}>{a.manufacturingSpecs?.basePrice !== '' && a.manufacturingSpecs?.basePrice != null ? `$${parseFloat(a.manufacturingSpecs.basePrice || 0).toFixed(2)}` : 'no price'}</span>
                                             <button onClick={() => openPartDetails(a)} style={{ padding: '6px 12px', background: 'var(--paper-2)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase' }}>Open</button>
                                             <button onClick={() => deleteAlias(a)} style={{ background: 'none', border: 'none', color: '#d9534f', fontSize: '1.1rem', cursor: 'pointer' }}>×</button>
                                         </div>
                                     ))}
                                 </div>
                             )}
                             <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                 <div style={{ width: '160px' }}><label style={labelStyle}>Alias item id</label><input value={aliasForm.code} onChange={e => setAliasForm({ ...aliasForm, code: e.target.value.toUpperCase() })} placeholder="e.g. H2-1BE" style={{ ...fieldStyle, textTransform: 'uppercase' }} /></div>
                                 <div style={{ flex: 2, minWidth: '200px' }}><label style={labelStyle}>Description</label><input value={aliasForm.name} onChange={e => setAliasForm({ ...aliasForm, name: e.target.value })} placeholder={`e.g. Standard Bracket (defaults to "${activePart?.itemName || ''}")`} style={fieldStyle} /></div>
                                 <div style={{ width: '120px' }}><label style={labelStyle}>Base price ($)</label><input type="number" step="0.01" value={aliasForm.price} onChange={e => setAliasForm({ ...aliasForm, price: e.target.value })} placeholder="own price" style={fieldStyle} /></div>
                                 <div style={{ width: '180px' }}><label style={labelStyle}>Collection</label>
                                     <select value={aliasForm.collection} onChange={e => setAliasForm({ ...aliasForm, collection: e.target.value })} style={fieldStyle}>
                                         <option value="">— none —</option>
                                         {dynamicCollections.map(c => <option key={c} value={c}>{c}</option>)}
                                     </select>
                                 </div>
                                 <button onClick={createAlias} disabled={!aliasForm.code.trim()} style={{ padding: '12px 20px', background: aliasForm.code.trim() ? 'var(--ink)' : 'var(--paper-2)', color: aliasForm.code.trim() ? '#fff' : 'var(--ink-soft)', border: 'none', cursor: aliasForm.code.trim() ? 'pointer' : 'not-allowed', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>＋ Create Alias</button>
                             </div>
                         </div>
                     );
                 })()}

                 <div style={{ marginTop: '30px', background: 'var(--paper-2)', padding: '24px', border: '1px solid var(--line)' }}>
                   <label style={labelStyle}>Record Visibility & Cross-Brand Sharing</label>
                   <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                     {AVAILABLE_BRANDS.map(brand => {
                        const isOwner = activePart.brandId === brand.id; const isShared = editSpecs.sharedBrands?.includes(brand.id);
                        return ( <label key={brand.id} style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px', cursor: isOwner ? 'not-allowed' : 'pointer', opacity: isOwner ? 0.6 : 1, color: 'var(--ink)' }}><input type="checkbox" checked={isOwner || isShared} disabled={isOwner} onChange={() => handleBrandToggle(brand.id)} />{brand.name} {isOwner && "(Owner)"}</label> );
                     })}
                   </div>
                 </div>
              </div>

              <div>
                 <h4 style={sectionHeaderStyle}>Core Attributes</h4>
                 <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                   
                   {windowConfig.system.prodTypes?.includes(activeBrand) && (
                       <div>
                           <label style={labelStyle}>Prod Type</label>
                           <select name="productType" value={String(editSpecs.productType || "").toUpperCase()} onChange={handleSpecChange} style={fieldStyle}>
                               <option value="">Select...</option>
                               {dynamicProdTypes.map(pt => <option key={pt} value={String(pt).toUpperCase()}>{pt}</option>)}
                               {renderOptionFallback(editSpecs.productType, dynamicProdTypes)}
                           </select>
                       </div>
                   )}

                   {/* 🔩 Backplates/cover plates typically (not always) need a wall mount — pair it here
                       and CPQ auto-adds one per plate to the BOM (cart line + NetSuite push). */}
                   {/PLATE/i.test(String(editSpecs.productType || '')) && (<>
                       <div>
                           <label style={labelStyle}>Wall Mount Part #</label>
                           <input value={editSpecs.wallMount?.partId || ''} onChange={e => setEditSpecs(prev => ({ ...prev, wallMount: { ...(prev.wallMount || {}), partId: e.target.value.toUpperCase() } }))} placeholder="blank = none" title="Item # of the matching wall mount. When set, every CPQ order of this plate includes one mount per plate — in the cart breakdown and the NetSuite push." style={{ ...fieldStyle, textTransform: 'uppercase' }} />
                       </div>
                       <div>
                           <label style={labelStyle}>Wall Mount Description</label>
                           <input value={editSpecs.wallMount?.desc || ''} onChange={e => setEditSpecs(prev => ({ ...prev, wallMount: { ...(prev.wallMount || {}), desc: e.target.value } }))} placeholder="e.g. Toggle anchor kit" style={fieldStyle} />
                       </div>
                   </>)}

                   <div>
                       <label style={labelStyle}>{activePart.partClass === 'Inventory' ? 'Inventory Category' : 'Routing Classification'}</label>
                       <select name="routingType" value={String(editSpecs.routingType || "").toUpperCase()} onChange={handleSpecChange} style={{ ...fieldStyle, textTransform: 'uppercase' }}>
                           <option value="">Unassigned</option>
                           {(activePart.partClass === 'Inventory' ? (globalLists.inventoryTypes || []) : (globalLists.assemblyTypes || [])).map(t => <option key={t} value={String(t).toUpperCase()}>{t}</option>)}
                           {renderOptionFallback(editSpecs.routingType, activePart.partClass === 'Inventory' ? globalLists.inventoryTypes : globalLists.assemblyTypes)}
                       </select>
                   </div>
                   
                   <div>
                       <label style={labelStyle}>Project / Grouping</label>
                       <input name="project" value={editSpecs.project || ""} onChange={handleSpecChange} style={fieldStyle} />
                   </div>

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
                   
                   {isFeeRecord && (
                   <>
                   {/* CUSTOM OVERRIDE FEE (Stuart 2026-07-28): ticking this puts the fee in CPQ's
                       per-step "custom work" dropdown. The fee's OWN Part Handling above decides
                       which floor the overridden step goes to — Custom = shop, Small Parts =
                       finishing — so a new fee type works the moment it's ticked, no code change. */}
                   <div>
                       <label style={labelStyle}>Custom Override Fee</label>
                       <label style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '11px 12px', border: `1px solid ${editSpecs.customOverrideFee ? 'var(--brass)' : 'var(--line)'}`, cursor: 'pointer', background: '#fff' }}>
                           <input type="checkbox" name="customOverrideFee" checked={!!editSpecs.customOverrideFee} onChange={e => setEditSpecs(prev => ({ ...prev, customOverrideFee: e.target.checked }))} />
                           <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.06em', color: editSpecs.customOverrideFee ? 'var(--ink)' : 'var(--ink-soft)' }}>
                               OFFER IN CPQ'S CUSTOM-WORK DROPDOWN
                           </span>
                       </label>
                       <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', marginTop: '4px' }}>
                           Its Part Handling above sets the destination floor; its base price is the fee's floor rate.
                       </div>
                   </div>
                   </>
                   )}

                   {/* A fee's whole commercial definition is its price, so for fee records it sits
                       HERE in Core Attributes rather than down in Logistics (Stuart 2026-07-28:
                       "except base price, which to be honest should be moved up to the Core
                       Attributes area"). Physical parts keep theirs in the make/buy block. */}
                   {isFeeRecord && (
                       <div>
                           <label style={labelStyle}>Base Price ($)</label>
                           <input name="basePrice" type="number" step="0.01" value={editSpecs.basePrice || ""} onChange={handleSpecChange} style={fieldStyle} />
                           <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', marginTop: '4px' }}>The fee's rate — and its floor when used as a custom override.</div>
                       </div>
                   )}

                   {windowConfig.system.uom?.includes(activeBrand) && (
                       <div>
                           <label style={labelStyle}>UOM</label>
                           <select name="uom" value={String(editSpecs.uom || "EA").toUpperCase()} onChange={handleSpecChange} style={fieldStyle}>
                               {dynamicUoms.map(u => <option key={u} value={String(u).toUpperCase()}>{u}</option>)}
                               {renderOptionFallback(editSpecs.uom, dynamicUoms)}
                           </select>
                       </div>
                   )}

                   {windowConfig.system.collections?.includes(activeBrand) && (
                       <div style={{ gridColumn: 'span 2' }}>
                           <label style={labelStyle}>Collections (Multi-Select for CPQ)</label>
                           <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', padding: '16px', border: '1px solid var(--line)', background: 'var(--paper)', maxHeight: '150px', overflowY: 'auto' }}>
                               {dynamicCollections.length === 0 && <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No collections defined.</span>}
                               {dynamicCollections.map(cName => {
                                   const isSelected = (editSpecs.collections || []).includes(cName);
                                   return (
                                       <label key={cName} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', cursor: 'pointer', background: isSelected ? 'var(--ink)' : '#fff', color: isSelected ? '#fff' : 'var(--ink)', border: `1px solid ${isSelected ? 'var(--ink)' : 'var(--line)'}`, padding: '6px 14px', borderRadius: '20px', transition: 'all 0.2s' }}>
                                           <input type="checkbox" checked={isSelected} onChange={() => handleToggleCollection(cName)} style={{ display: 'none' }} />
                                           {cName}
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
                   
                   {!isFeeRecord && windowConfig.system.outsourceActions?.includes(activeBrand) && (
                       <div>
                           <label style={labelStyle}>Outsource Action</label>
                           <select name="outsourceAction" value={String(editSpecs.outsourceAction || "").toUpperCase()} onChange={handleSpecChange} style={fieldStyle}>
                               <option value="">Select...</option>
                               {(globalLists.outsourceActions || []).map(x => <option key={x} value={String(x).toUpperCase()}>{x}</option>)}
                               {renderOptionFallback(editSpecs.outsourceAction, globalLists.outsourceActions)}
                           </select>
                       </div>
                   )}
                   
                   {!isFeeRecord && windowConfig.custom.filter(w => (w.brands || []).includes(activeBrand)).map(w => (
                       <div key={w.id}>
                           <label style={labelStyle}>{w.name}</label>
                           <select value={editSpecs.dynamicDicts?.[w.id] || ""} onChange={(e) => handleDictChange(w.id, e.target.value)} style={fieldStyle}>
                               <option value="">Select...</option><option value="N/A">N/A</option>
                               {dynamicAssets.filter(a => a.windowId === w.id).map(a => <option key={a.id} value={a.name}>{a.name} {a.code ? `(${a.code})` : ''}</option>)}
                           </select>
                       </div>
                   ))}

                   {!isFeeRecord && customSchema.map(field => (
                       <div key={field.key}>
                           <label style={labelStyle}>{field.label} (Custom)</label>
                           {field.type === 'dropdown' ? (
                               <select value={editSpecs.customData?.[field.key] || ""} onChange={(e) => handleCustomFieldChange(field.key, e.target.value)} style={fieldStyle}>
                                   <option value="">Select...</option>{(field.options || "").split(',').map(opt => <option key={opt.trim()} value={opt.trim()}>{opt.trim()}</option>)}
                               </select>
                           ) : field.type === 'file' ? (
                               <div style={{ background: 'var(--paper)', padding: '12px', border: '1px solid var(--line)' }}>
                                   {editSpecs.customData?.[field.key] && <a href={editSpecs.customData[field.key]} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem', color: 'var(--ink)', textDecoration: 'underline', display: 'block', marginBottom: '8px' }}>View Current File</a>}
                                   <input type="file" onChange={(e) => handleDynamicFileUpload(field.key, e.target.files[0])} style={{ fontSize: '0.85rem', fontFamily: 'var(--sans)' }} />
                                   {dynamicUploadProgress[field.key] > 0 && <progress value={dynamicUploadProgress[field.key]} max="100" style={{ width: '100%', marginTop: '8px' }} />}
                               </div>
                           ) : (
                               <input type={field.type} value={editSpecs.customData?.[field.key] || ""} onChange={(e) => handleCustomFieldChange(field.key, e.target.value)} style={fieldStyle} />
                           )}
                       </div>
                   ))}

                   {!isFeeRecord && windowConfig.system.watchLists?.includes(activeBrand) && (
                       <div style={{ gridColumn: 'span 2' }}>
                           <label style={labelStyle}>Assign to Watchlist</label>
                           <select name="watchList" value={editSpecs.watchList || "NONE"} onChange={handleSpecChange} style={fieldStyle}>
                               <option value="NONE">None</option>
                               {dynamicWatchlists.map(w => <option key={w} value={w}>{w}</option>)}
                           </select>
                       </div>
                   )}
                 </div>
              </div>

              {/* Only the item types these fields actually describe: brackets carry projection /
                  mount / return / arm thickness, backplates carry orientation, fees carry the fee
                  type. A ring or a pole shows none of it. */}
              {(isBracketRecord || isBackplateRecord || isFeeRecord) && (
              <div style={{ background: 'var(--paper-2)', padding: '24px', border: '1px solid var(--line)', marginTop: '10px' }}>
                  <h4 style={sectionHeaderStyle}>{isFeeRecord && !isBracketRecord && !isBackplateRecord ? 'Fee Metadata' : 'Hardware CPQ Metadata (Vision Engine)'}</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                      {isBracketRecord && (
                      <div>
                          <label style={labelStyle}>Bracket Projection (Inches)</label>
                          <select value={String(editSpecs.customData?.projection || "").toUpperCase()} onChange={(e) => handleCustomFieldChange("projection", e.target.value)} style={fieldStyle}>
                              <option value="">-- No Projection / Not Bracket --</option>
                              {(globalLists.projections || []).map(p => <option key={p} value={String(p).toUpperCase()}>{p}" Projection</option>)}
                              {renderOptionFallback(editSpecs.customData?.projection, globalLists.projections)}
                          </select>
                      </div>
                      )}
                      {isBracketRecord && (
                      <div>
                          <label style={labelStyle}>Bracket Mount Type</label>
                          <select value={String(editSpecs.customData?.bracketType || "").toUpperCase()} onChange={(e) => handleCustomFieldChange("bracketType", e.target.value)} style={fieldStyle}>
                              <option value="">-- Not a Bracket --</option>
                              {(globalLists.bracketMounts || []).map(m => <option key={m} value={String(m).toUpperCase()}>{m}</option>)}
                              {renderOptionFallback(editSpecs.customData?.bracketType, globalLists.bracketMounts)}
                          </select>
                      </div>
                      )}
                      {isBracketRecord && (
                      <div style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '6px 0' }}>
                          <input type="checkbox" checked={!!editSpecs.customData?.isReturnBracket} onChange={(e) => handleCustomFieldChange("isReturnBracket", e.target.checked)} style={{ width: '16px', height: '16px', cursor: 'pointer', marginTop: '2px', flexShrink: 0 }} />
                          <div>
                              <label style={labelStyle}>Is Return Bracket (End-Return)</label>
                              <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginTop: '2px' }}>Sits right at the pole end and its width adds to the O2O. End-return brackets are the only ones placed at the very end — and they're never offered as a center support. (e.g. FIWERA, FICERA)</div>
                          </div>
                      </div>
                      )}
                      {isBracketRecord && !!editSpecs.customData?.isReturnBracket && (
                          <div>
                              <label style={labelStyle}>Bracket Arm Thickness (in)</label>
                              <input type="number" step="0.125" value={editSpecs.customData?.armThickness ?? ''} onChange={(e) => handleCustomFieldChange("armThickness", e.target.value)} placeholder="e.g. 0.5 (½&quot; flat-iron)" style={fieldStyle} />
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
                      {isFeeRecord && (
                      <div style={{ gridColumn: 'span 2' }}>
                          <label style={labelStyle}>Service / Fee Type (Auto-Append)</label>
                          <select value={String(editSpecs.customData?.feeType || "").toUpperCase()} onChange={(e) => handleCustomFieldChange("feeType", e.target.value)} style={fieldStyle}>
                              <option value="">-- No Special Fee --</option>
                              {(globalLists.feeTypes || []).map(f => <option key={f} value={String(f).toUpperCase()}>{f}</option>)}
                              {renderOptionFallback(editSpecs.customData?.feeType, globalLists.feeTypes)}
                          </select>
                          <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', display: 'block', marginTop: '6px' }}>If selected, the Vision System will automatically bill for this item when triggered.</span>
                      </div>
                      )}
                  </div>
              </div>
              )}

              {/* A fee has no sourcing, vendor, stock or paint size — its price now lives in Core
                  Attributes, so this whole block is irrelevant to it. */}
              {!isFeeRecord && (
              <div>
                <h4 style={sectionHeaderStyle}>Logistics, Sourcing & Pricing</h4>
                
                {/* THREE-WAY SOURCING (Stuart 2026-07-28). "Both" = we make it AND we buy it — the
                    H1/H2 assemblies. It writes isInHouse TRUE plus the app-owned sourcingMode, so
                    screens that don't know about Both still route it to a work order (safe side),
                    while the Stock View vendor modal asks PO-or-WO per item at order time. */}
                <div style={{ display: 'flex', gap: '16px', marginBottom: '8px' }}>
                    {[SOURCING.IN, SOURCING.OUT, SOURCING.BOTH].map(mode => {
                        const on = sourcingOf(editSpecs) === mode;
                        return (
                            <button key={mode} onClick={() => setEditSpecs({ ...editSpecs, ...sourcingPatch(mode) })} style={{ flex: 1, padding: '12px', background: on ? 'var(--ink)' : 'transparent', color: on ? '#fff' : 'var(--ink)', border: '1px solid var(--ink)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>{SOURCING_LABEL[mode]}</button>
                        );
                    })}
                </div>
                {sourcingOf(editSpecs) === SOURCING.BOTH && (
                    <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginBottom: '16px' }}>Made here <em>and</em> bought. Replenishment asks which one each time — Stock View's vendor step offers this item's vendor or “⚒ make in-house”, defaulting to the work order. Fill in both the in-house and the vendor details below.</div>
                )}
                {sourcingOf(editSpecs) !== SOURCING.BOTH && <div style={{ marginBottom: '8px' }} />}

                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '24px', cursor: 'pointer', background: editSpecs.isStocked ? 'rgba(176,141,87,.08)' : 'transparent', border: `1px solid ${editSpecs.isStocked ? 'var(--brass)' : 'var(--line)'}`, padding: '14px 16px' }}>
                    <input type="checkbox" checked={!!editSpecs.isStocked} onChange={(e) => setEditSpecs({ ...editSpecs, isStocked: e.target.checked })} style={{ width: '16px', height: '16px', marginTop: '2px', cursor: 'pointer', flexShrink: 0 }} />
                    <span style={{ fontSize: '0.9rem', color: 'var(--ink)' }}>Stocked finished assembly
                        <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', display: 'block', marginTop: '4px' }}>Check for finished assemblies you hold in stock (e.g. a stocked <code>/P</code> collection) rather than finish-to-order. On a CPQ quote this pushes the full finished assembly to NetSuite to consume stock — just like an outsourced finish — instead of the core part plus a finishing work order.</span>
                    </span>
                </label>
                
                <div style={{ background: 'var(--paper-2)', padding: '24px', border: '1px solid var(--line)' }}>
                  {/* BOTH shows the make-it fields AND the buy-it fields. The four shared ones
                      (weight / price / cost / ROP) render once, in the vendor block, so a Both item
                      never shows the same input twice. */}
                  {sourcingOf(editSpecs) === SOURCING.BOTH && <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '12px' }}>⚒ Made here</div>}
                  {sourcingOf(editSpecs) !== SOURCING.OUT && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                        <div><label style={labelStyle}>Program #</label><input name="programNum" value={editSpecs.programNum || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                        <div><label style={labelStyle}>Raw Mat</label><input name="material" value={editSpecs.material || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                        {sourcingOf(editSpecs) !== SOURCING.BOTH && <div><label style={labelStyle}>Weight (lbs)</label><input name="weight" type="number" step="0.01" value={editSpecs.weight || ""} onChange={handleSpecChange} style={fieldStyle} /></div>}
                        {sourcingOf(editSpecs) !== SOURCING.BOTH && <div><label style={labelStyle}>Base Price ($)</label><input name="basePrice" type="number" step="0.01" value={editSpecs.basePrice || ""} onChange={handleSpecChange} style={fieldStyle} /></div>}
                        {sourcingOf(editSpecs) !== SOURCING.BOTH && <div><label style={labelStyle}>Base Cost ($)</label><input name="cost" type="number" step="0.01" value={editSpecs.cost || ""} onChange={handleSpecChange} style={fieldStyle} /></div>}
                        {sourcingOf(editSpecs) !== SOURCING.BOTH && <div><label style={labelStyle}>Reorder Pt (ROP)</label><input name="reorderPoint" type="number" value={editSpecs.reorderPoint || ""} onChange={handleSpecChange} style={fieldStyle} /></div>}
                        <div><label style={labelStyle}>Paint Size</label>
                            <select name="paintSize" value={editSpecs.paintSize || ""} onChange={handleSpecChange} style={{ ...fieldStyle, background: '#fff' }}>
                                <option value="">—</option>
                                <option value="S">S — 70 / section</option>
                                <option value="M">M — 35 / section</option>
                                <option value="L">L — 22 / section</option>
                            </select>
                        </div>
                    </div>
                  )}
                  {sourcingOf(editSpecs) === SOURCING.BOTH && <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', margin: '24px 0 12px', paddingTop: '20px', borderTop: '1px solid var(--line)' }}>🏷 Bought — vendor</div>}
                  {sourcingOf(editSpecs) !== SOURCING.IN && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
                        <div>
                            <label style={labelStyle}>Vendor Name (From CRM)</label>
                            <select name="vendorName" value={editSpecs.vendorName || ""} onChange={handleSpecChange} style={fieldStyle}>
                                <option value="">Select Vendor...</option>
                                {dynamicVendors.map(v => <option key={v} value={v}>{v}</option>)}
                            </select>
                        </div>
                        <div><label style={labelStyle}>Vendor Part # / SKU</label><input name="vendorId" value={editSpecs.vendorId || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}><label style={labelStyle}>Purchase Link (URL)</label>{editSpecs.vendorUrl && <a href={editSpecs.vendorUrl.startsWith('http') ? editSpecs.vendorUrl : `https://${editSpecs.vendorUrl}`} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem', color: 'var(--ink)', textDecoration: 'underline' }}>Open ↗</a>}</div>
                            <input name="vendorUrl" value={editSpecs.vendorUrl || ""} onChange={handleSpecChange} placeholder="https://..." style={fieldStyle} />
                        </div>
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}><label style={labelStyle}>Alt Item Link (URL)</label>{editSpecs.altVendorUrl && <a href={editSpecs.altVendorUrl.startsWith('http') ? editSpecs.altVendorUrl : `https://${editSpecs.altVendorUrl}`} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem', color: 'var(--ink)', textDecoration: 'underline' }}>Open ↗</a>}</div>
                            <input name="altVendorUrl" value={editSpecs.altVendorUrl || ""} onChange={handleSpecChange} placeholder="https://..." style={fieldStyle} />
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
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
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', background: 'var(--paper)', padding: '24px', border: '1px solid var(--line)', marginTop: '20px' }}>
                  <div>
                      <label style={labelStyle}>Upload Print (PDF)</label>
                      {editSpecs.pdfUrl && <a href={editSpecs.pdfUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem', color: 'var(--ink)', textDecoration: 'underline', display: 'block', marginBottom: '10px' }}>View Current PDF</a>}
                      <input type="file" accept="application/pdf" onChange={(e) => setPdfFile(e.target.files[0])} style={{ fontSize: '0.85rem', fontFamily: 'var(--sans)' }} />
                      {uploadProgress > 0 && <progress value={uploadProgress} max="100" style={{ width: '100%', marginTop: '8px' }}/>}
                  </div>
                  <div>
                      <label style={labelStyle}>3D CAD Model (.glb / .gltf)</label>
                      {editSpecs.cadUrl && <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginBottom: '10px' }}>✓ 3D Model Assigned</div>}
                      <input type="file" accept=".glb,.gltf" onChange={(e) => setCadFile(e.target.files[0])} style={{ fontSize: '0.85rem', fontFamily: 'var(--sans)' }} />
                      {cadUploadProgress > 0 && <progress value={cadUploadProgress} max="100" style={{ width: '100%', marginTop: '8px' }}/>}
                  </div>
                </div>
              </div>
              )}

              {activePart.partClass !== 'Master Assembly' && (
                  <div style={{ background: '#fff', border: '1px solid var(--brass)', padding: '24px', marginBottom: '30px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                      <h4 style={{ margin: '0 0 16px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>
                          Generate Production Work Order
                      </h4>
                      <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end' }}>
                          <div style={{ flex: 1 }}>
                              <label style={labelStyle}>Target Qty</label>
                              <input 
                                  type="number" 
                                  min="1"
                                  value={woTargetQty} 
                                  onChange={e => setWoTargetQty(e.target.value)} 
                                  style={fieldStyle} 
                              />
                          </div>
                          <button 
                              onClick={handleGenerateWO}
                              style={{ flex: 2, padding: '12px 24px', background: 'var(--brass)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'background 0.2s' }}
                          >
                              Push to RTG Dispatch
                          </button>
                      </div>
                      <span style={{ display: 'block', marginTop: '12px', fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
                          This generates an "Approved" Stock Build WO and sends it directly to Tab 13 (RTG Dispatch).
                      </span>
                  </div>
              )}

              {/* L/W/H feed the O2O maths for plates and brackets (and cut-to-size lengths); the
                  Z-index only matters where the part renders. Fees have neither. */}
              {!isFeeRecord && (
              <div>
                <h4 style={sectionHeaderStyle}>Geometry & Z-Index Rules</h4>
                <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px' }}>
                    {(usesGeometry || isAssemblyRecord) && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', marginBottom: '24px' }}>
                      <div><label style={labelStyle}>Length (in)</label><input name="length" type="number" step="0.1" value={editSpecs.parametric?.length || ""} onChange={handleParametricChange} style={fieldStyle} /></div>
                      <div><label style={labelStyle}>Width (in)</label><input name="width" type="number" step="0.1" value={editSpecs.parametric?.width || ""} onChange={handleParametricChange} style={fieldStyle} /></div>
                      <div><label style={labelStyle}>Height (in)</label><input name="height" type="number" step="0.1" value={editSpecs.parametric?.height || ""} onChange={handleParametricChange} style={fieldStyle} /></div>
                    </div>
                    )}
                    <div style={{ marginBottom: '24px' }}>
                      <label style={{ fontSize: '0.9rem', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <input type="checkbox" name="isCutToSize" checked={editSpecs.parametric?.isCutToSize || false} onChange={handleParametricChange} />
                          Dynamic Custom Length Allowed (Stretchable Pole / Track)
                      </label>
                    </div>
                    {isAssemblyRecord && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                      <div style={{ gridColumn: 'span 2' }}><label style={labelStyle}>Z-Index / Render Layer</label><input name="layeringSequence" type="number" step="10" value={editSpecs.layeringSequence || ""} onChange={handleSpecChange} placeholder="e.g. 10 (Back), 30 (Front)" style={fieldStyle} /></div>
                      
                    </div>
                    )}
                </div>
              </div>
              )}

              <div style={{ display: 'flex', gap: '16px', marginTop: '20px', flexWrap: 'wrap' }}>
                <button onClick={savePartUpdates} style={{ flex: 2, padding: '16px', background: isSaving ? 'var(--brass-light)' : 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'background 0.3s ease', minWidth: '200px' }}>
                    {isSaving ? "Saving..." : "Save Configuration"}
                </button>
                
                {hasErpWriteAccess && activePart.netSuiteInternalId && (
                    <button 
                        onClick={handlePushUpdatesToNetSuite} 
                        disabled={isPushingErp} 
                        style={{ flex: 1.5, padding: '16px', background: isPushingErp ? 'var(--paper)' : '#fff', color: isPushingErp ? 'var(--ink-soft)' : 'var(--ink)', border: '1px solid var(--ink)', cursor: isPushingErp ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.3s ease', minWidth: '150px' }}
                    >
                        {isPushingErp ? "Syncing..." : "Write to ERP"}
                    </button>
                )}
                
                {!activePart.isNew && (
                    <button onClick={handleDeletePart} style={{ flex: 1, padding: '16px', background: 'transparent', color: '#d9534f', border: '1px solid #d9534f', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s', minWidth: '120px' }} onMouseOver={e => { e.currentTarget.style.background = '#d9534f'; e.currentTarget.style.color = '#fff'; }} onMouseOut={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#d9534f'; }}>
                        Delete
                    </button>
                )}
              </div>
             <div style={{ marginTop: '20px' }}>
                <button 
                    onClick={handleSyncShopRoutings} 
                    style={{ width: '100%', background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', padding: '16px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'background 0.2s' }}
                    onMouseOver={e => { e.currentTarget.style.background = 'var(--paper-2)'; }} 
                    onMouseOut={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                    Sync Shop Routings
                </button>
              </div>

            </div>
          </div>
        )}
      </div>

    </div>
  );
};

export default LibraryTab;