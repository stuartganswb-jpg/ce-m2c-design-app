import React, { useState, useRef, useEffect } from 'react';
import { TRAVERSE_ROLES, DRIVE_TYPES, TRV_SETUPS, suggestSetupFromName } from '../Shared/traverseTags';
import { db, storage } from '../../firebase';
import { doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, collection, query, where, onSnapshot } from 'firebase/firestore';
import { ref as sRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';
import { buildCodeIndex, matchItemByName, normCode, nameCategorySignature } from '../Shared/itemCodeMatch';
import { analyzeFusionFbx, buildGlbFromAnalysis, UNIT_CHOICES } from '../Shared/fusionImport';
import { isolateCluster, snapshotPNG } from '../Shared/componentExport';
import { downloadItemStarterTemplate, parseItemStarterWorkbook } from '../Shared/itemStarterXlsx';
import { TAG_CATEGORIES, TAG_LOCATIONS, END_TREATMENTS, normalizeLocation, normalizePosition, normalizeCategory, suggestTagsFromName } from '../Shared/assemblyTags';
import { sheet2dChoiceNode } from '../Shared/sheet2d';

// Step-by-step assembly builder: the designer uploads ONE .glb per slot (all the choices for that slot
// stacked inside the file). We KNOW each slot's position/category/location, so there's nothing to
// decipher — each file becomes a cluster directly. On Build we merge every layer into one combined .glb
// (the working cadUrl), and write nodeClusters[] + assembly_pins straight from the explicit structure.
// Parts are used at their exported world position; a per-layer X/Y/Z nudge handles files that aren't
// pre-aligned.

const DRACO = 'https://www.gstatic.com/draco/versioned/decoders/1.5.5/';
// Canonical tag vocabularies — shared with 1.5 / Vision / CPQ via Shared/assemblyTags.js.
// (1.6 used to speak its own dialect: INSIDE/OPEN locations, END/OTHER categories — that drift
// is what broke tag alignment across tabs. All writes below normalize to canonical.)
const CATEGORIES = [...TAG_CATEGORIES.filter(c => c !== 'OTHER'), 'OTHER'];
const POSITIONS = ['SHARED', 'LEFT', 'CENTER', 'RIGHT', 'FRONT', 'BACK'];
const LOCATIONS = ['', ...TAG_LOCATIONS];

// Two authoring workflows. Every slot is OPTIONAL — upload only what this assembly uses; the CPQ
// flow is generated from the slots you actually fill. `desc` is the on-screen note explaining the
// slot's role so the tagging matches how the generator + 3D engine read it.
//
// STANDARD BAY — the per-end pole model: a SHORT rod tagged CENTER (always shown, carries the
// french-return ends) plus the LONG rod split at center into a LEFT half and a RIGHT half. Each end's
// finial/return choices stack in that end's FINIAL slot; naming a choice with "return"/"french"/etc.
// makes the generator hide that side's long half so the return renders short. (See System Admin →
// Generate; this is the mixed-end fix.)
// SHOP FLOOR SOP MODEL (Stuart 2026-07-15): a DEDICATED slot at the bottom of both templates.
// The designer loads ONLY the pieces needed for the instruction/SOP sheets (positioned, one of
// each) — it is exported as its OWN .glb (manufacturingSpecs.sopCadUrl), NEVER merged into the
// working model, and generates no clusters/pins. Tab .6 (Interactive 3D Instructions) builds the
// SOP pages on this model; the BOM Engine + shop floor open them in the SOP viewer.
const SOP_SLOT_DEF = { id: 'sop', label: 'Shop Floor SOPs & Instructions', category: 'SOP', position: 'SHARED', location: '', desc: 'NOT part of the sellable model: load only the pieces needed for the shop-floor instruction sheets. Saved as its own .glb on the assembly; build the annotated pages in Tab .6, view from BOM Engine + Custom floor.' };
// SPEC SHEET LAYOUT SLOT (Stuart 2026-07-20): same dedicated-slot idea for the 📐 Spec Sheet
// generator. The designer draws the spec-sheet LAYOUT in Fusion — flat orthographic arrangement,
// one of each component, code-named nodes, at every pole size / projection the sheet must show
// (the combined Fabricut .75 / 1 / 1-3/8 masters the original files couldn't produce). It exports
// as its OWN .glb (manufacturingSpecs.specCadUrl), never merged; the 📐 tool prefers it over the
// sellable model and derives its choices from the scene's code-named nodes at true scale.
const SPEC_SLOT_DEF = { id: 'spec', label: 'Spec Sheet Layout (📐)', category: 'SPEC', position: 'SHARED', location: '', desc: 'NOT part of the sellable model: the flat spec-sheet layout drawn in Fusion — one of each component, code-named nodes, true positions per pole size/projection. Saved as its own .glb; the 📐 Spec Sheet generator draws from THIS instead of the merged model.' };

// Shared hardware never pins; a blank choice whose name LOOKS like a real part is a different
// story — it PARKS (Stuart 2026-07-22: designer/IT timing — the item # doesn't exist in the
// library yet, so the choice holds as hidden geometry until the # is assigned).
const HARDWARE_RE = /screw|standoff|stand-off|washer|\bnut\b|bolt|rivet|spring|grommet/i;
const looksRealPart = (label) => !HARDWARE_RE.test(String(label || '')) && /\d/.test(String(label || '')) && String(label || '').replace(/[^A-Za-z0-9]/g, '').length >= 6;

const STANDARD_SLOTS = [
    { id: 'short_rod', label: 'Short Rod — center (always shown)', category: 'POLE', position: 'CENTER', location: '', desc: 'The short french-return-length rod. Always visible — it carries the return ends. Tag position CENTER.' },
    { id: 'long_left', label: 'Long Rod — LEFT half', category: 'POLE', position: 'LEFT', location: '', desc: 'Left half of the full-length rod (split at center). Auto-hidden when the LEFT end is a return, shown for a finial.' },
    { id: 'long_right', label: 'Long Rod — RIGHT half', category: 'POLE', position: 'RIGHT', location: '', desc: 'Right half of the full-length rod (split at center). Auto-hidden when the RIGHT end is a return, shown for a finial.' },
    { id: 'rings', label: 'Rings', category: 'RING', position: 'SHARED', location: '', desc: 'Optional decorative rings.' },
    { id: 'left_bracket', label: 'Left Bracket', category: 'BRACKET', position: 'LEFT', location: 'WALL', desc: 'Left mounting bracket. Stack mount variants (wall/ceiling) inside as choices.' },
    { id: 'left_backplate', label: 'Left Backplate', category: 'BACKPLATE', position: 'LEFT', location: 'WALL', desc: 'Rides as a 2nd chooser on the left bracket step.' },
    { id: 'center_bracket', label: 'Center Bracket', category: 'BRACKET', position: 'CENTER', location: 'WALL', desc: 'Center / passing bracket(s).' },
    { id: 'center_backplate', label: 'Center Backplate', category: 'BACKPLATE', position: 'CENTER', location: 'WALL', desc: '2nd chooser on the center bracket step.' },
    { id: 'right_bracket', label: 'Right Bracket', category: 'BRACKET', position: 'RIGHT', location: 'WALL', desc: 'Right mounting bracket.' },
    { id: 'right_backplate', label: 'Right Backplate', category: 'BACKPLATE', position: 'RIGHT', location: 'WALL', desc: 'Rides as a 2nd chooser on the right bracket step.' },
    { id: 'left_return_backplate', label: 'Left RETURN Backplate', category: 'BACKPLATE', position: 'LEFT', location: 'WALL', desc: 'Backplates offered ONLY when the LEFT end is a french/bent/mitered return (the RETURN in this label is what scopes them). Regular plates hide while a return is chosen.' },
    { id: 'right_return_backplate', label: 'Right RETURN Backplate', category: 'BACKPLATE', position: 'RIGHT', location: 'WALL', desc: 'Backplates offered ONLY when the RIGHT end is a return. Keep RETURN in the label — that is what scopes them.' },
    { id: 'left_end', label: 'Left End — finials + returns', category: 'FINIAL', position: 'LEFT', location: '', desc: 'Stack ALL left-end choices in one file: finials + french/bent/mitered returns. Name the return choices with "return"/"french" so they hide the left long half.' },
    { id: 'right_end', label: 'Right End — finials + returns', category: 'FINIAL', position: 'RIGHT', location: '', desc: 'Stack ALL right-end choices: finials + returns. Name returns with "return"/"french" so they hide the right long half.' },
    SOP_SLOT_DEF,
    SPEC_SLOT_DEF,
];

// DOUBLE BRACKET — same idea, but the bracket carries TWO rows: a FRONT pole+finials and a BACK
// pole+finials. Both rows are always shown (no left/right pole split here); each row's finial choices
// stack in its FINIAL slot. Positions FRONT/BACK keep the two rows as separate generated steps.
const DOUBLE_SLOTS = [
    { id: 'dbl_left_bracket', label: 'Left Double Bracket', category: 'BRACKET', position: 'LEFT', location: 'WALL', desc: 'Left bracket that holds both the front and back rods. Stack mount variants as choices.' },
    { id: 'dbl_center_bracket', label: 'Center Double Bracket', category: 'BRACKET', position: 'CENTER', location: 'WALL', desc: 'Optional center / passing double bracket.' },
    { id: 'dbl_right_bracket', label: 'Right Double Bracket', category: 'BRACKET', position: 'RIGHT', location: 'WALL', desc: 'Right bracket that holds both rods.' },
    { id: 'front_pole', label: 'Front Pole', category: 'POLE', position: 'FRONT', location: '', desc: 'The front-row rod. Always shown. Stack material/length choices inside.' },
    { id: 'front_finials', label: 'Front Finials', category: 'FINIAL', position: 'FRONT', location: '', desc: 'Front-row finial choices (both ends). Stack all options in one file.' },
    { id: 'back_pole', label: 'Back Pole', category: 'POLE', position: 'BACK', location: '', desc: 'The back-row rod. Always shown. Stack material/length choices inside.' },
    { id: 'back_finials', label: 'Back Finials', category: 'FINIAL', position: 'BACK', location: '', desc: 'Back-row finial choices (both ends). Stack all options in one file.' },
    { id: 'dbl_rings', label: 'Rings', category: 'RING', position: 'SHARED', location: '', desc: 'Optional decorative rings (either row).' },
    SOP_SLOT_DEF,
    SPEC_SLOT_DEF,
];

const TEMPLATES = {
    standard: { label: 'Standard Bay', hint: 'Per-end pole: short center rod + long rod split into L/R halves; returns hide their half.', slots: STANDARD_SLOTS },
    double: { label: 'Double Bracket', hint: 'Two rows on one bracket: front pole + finials and back pole + finials.', slots: DOUBLE_SLOTS },
};

// One shared loader (Draco-enabled) for parsing + merge.
const makeLoader = () => {
    const draco = new DRACOLoader(); draco.setDecoderPath(DRACO);
    const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
    return loader;
};

// The CHOICES in a slot .glb. Exporters differ: some files list every choice as its own scene root
// (LEFT BACKPLATE → 16 roots), others wrap everything in ONE file-named root (CENTER BACKPLATE →
// 1 root, 25 plates inside) — which used to surface as a single unusable "choice". AUTO-UNWRAP:
// while there's exactly one named container holding 2+ named children, descend into it. Deeper
// mixed nesting is handled per-row with the ⤢ split button.
const slotChoiceNames = (scene) => {
    let level = (scene.children || []).filter(c => c.name);
    let guard = 0;
    while (level.length === 1 && guard++ < 4) {
        const kids = (level[0].children || []).filter(c => c.name);
        if (kids.length >= 2) level = kids; else break;
    }
    let out = level.map(c => c.name);
    if (!out.length) scene.traverse(o => { if (o.isMesh && o.name) out.push(o.name); });
    return [...new Set(out)];
};
const allNodeNames = (obj) => { const n = []; obj.traverse(o => { if (o.name) n.push(o.name); }); return [...new Set(n)]; };

function AssemblyBuilderTab({ currentUser, activeBrand }) {
    const [assemblyName, setAssemblyName] = useState('');
    const [template, setTemplate] = useState('standard');
    const [slots, setSlots] = useState(TEMPLATES.standard.slots.map(s => ({ ...s })));
    // per-slot layer: { scene, url, fileName, parts:[], items:{part:itemNo}, offset:{x,y,z} }
    const [layers, setLayers] = useState({});
    const [busy, setBusy] = useState('');
    const [log, setLog] = useState([]);
    const [repairList, setRepairList] = useState([]);   // existing assemblies you can repair
    const [repairId, setRepairId] = useState('');
    const [repairBusy, setRepairBusy] = useState(false);
    const [assignId, setAssignId] = useState('');       // assembly whose choices we're assigning item #s to
    const [assignData, setAssignData] = useState(null); // { asmId, asmName, rows:[{clusterId,clusterName,category,position,found,choices:[{nodeName,label,itemNo,thumb}]}] }
    const [assignBusy, setAssignBusy] = useState(false);
    const [codeOptions, setCodeOptions] = useState([]); // alphabetical Master-Library codes for the item # picker
    const assignGenRef = useRef(0);                      // invalidates in-flight thumbnail runs on reload
    const [zoomThumb, setZoomThumb] = useState(null);    // { url, label } — enlarged thumbnail overlay
    // FUSION IMPORT (.fbx → house .glb, replaces the Blender pass): { slot, fileName, buffer,
    // analysis, rows:[{key,keep,finalName,origName,bodies,tris,size}], unitId, mode, busy, err }
    const [fusionJob, setFusionJob] = useState(null);
    const assignSceneRef = useRef(null);                 // loaded scene kept for split/thumbnails
    const [assignModelInfo, setAssignModelInfo] = useState(null); // { docId, itemId, cadFile } — the fork check
    const [syncId, setSyncId] = useState('');            // assembly whose pins we're linking to the library
    const [syncBusy, setSyncBusy] = useState(false);
    const [starterBusy, setStarterBusy] = useState(false); // Item Starter Kit upload in flight
    const [extendId, setExtendId] = useState('');          // '' = build NEW; else append slots to this assembly
    // Picking an extend target POPULATES context (Stuart 2026-07-14 — selecting one previously
    // changed nothing visible): the existing merged .glb loads into the Live Preview as a base
    // layer, and its current clusters list as a read-only panel so you can see what's already
    // there before appending new slots.
    const [extendInfo, setExtendInfo] = useState(null);     // { scene, clusters, name, loading, error }
    useEffect(() => {
        let dead = false;
        (async () => {
            if (!extendId) { setExtendInfo(null); return; }
            setExtendInfo({ scene: null, clusters: [], name: '', loading: true, error: '' });
            try {
                const exSnap = await getDoc(doc(db, 'Approved_Designs', extendId));
                const ex = exSnap.exists() ? exSnap.data() : null;
                if (!ex) throw new Error('Assembly not found.');
                const url = ex.manufacturingSpecs?.cadUrl;
                let scene = null;
                if (url) {
                    const buf = await (await fetch(url)).arrayBuffer();
                    const gltf = await new Promise((res, rej) => loaderRef.current.parse(buf, '', res, rej));
                    scene = gltf.scene;
                }
                if (dead) return;
                setExtendInfo({ scene, clusters: ex.nodeClusters || [], name: ex.itemName || extendId, loading: false, error: url ? '' : 'No .glb on this assembly — extending will fail until one exists.' });
            } catch (e) {
                console.error('Extend preview load failed', e);
                if (!dead) setExtendInfo({ scene: null, clusters: [], name: '', loading: false, error: e.message || String(e) });
            }
        })();
        return () => { dead = true; };
    }, [extendId]); // eslint-disable-line react-hooks/exhaustive-deps
    const loaderRef = useRef(null);
    if (!loaderRef.current) loaderRef.current = makeLoader();
    // Master-Library ERP-code index for auto-matching item #s from node names (designer's convention:
    // node name = "<ITEM#> <POSITION>"). Fetched once, cached for the session.
    const codeIndexRef = useRef(null);
    const ensureCodeIndex = async () => {
        // Brand-scoped: only the active brand's items (own or shared) feed the picker + auto-match,
        // so the search list isn't polluted with other brands' codes. Cache is keyed by brand.
        if (codeIndexRef.current?.brand === activeBrand) return codeIndexRef.current.index;
        const snap = await getDocs(collection(db, 'Approved_Designs'));
        const raw = snap.docs.map(d => d.data())
            .filter(x => !activeBrand || x.brandId === activeBrand || (Array.isArray(x.sharedBrands) && x.sharedBrands.includes(activeBrand)));
        const parts = raw.map(x => ({ legacyErpId: x.legacyErpId, itemId: x.itemId, itemName: x.itemName }));
        // FEE ENTITIES by every code they carry (Stuart 2026-08-14: "the fee items are not
        // available from the dropdown"). Fees often have NO ERP Legacy ID — their stable
        // reference is the itemId (CE-FEE-4594) — so the "real ERP codes only" picker filter
        // silently dropped exactly the records a FEE choice needs to link for client pricing.
        const feeCodes = new Set();
        raw.forEach(x => { if (x.partClass === 'Fee') [x.legacyErpId, x.itemId].forEach(c => { if (c && c !== 'PENDING') feeCodes.add(String(c).toUpperCase()); }); });
        const index = buildCodeIndex(parts);
        // Normalized-code COLLISIONS are kept (H1-75BPR ring vs H1-75BP-R backplate both norm to
        // H175BPR) — byNorm maps norm → ARRAY of entries; exact-raw lookups pick within it.
        const byNorm = new Map(); index.forEach(e => { const a = byNorm.get(e.norm); if (a) a.push(e); else byNorm.set(e.norm, [e]); });
        codeIndexRef.current = { brand: activeBrand, index, byNorm, feeCodes };
        return index;
    };
    // Suggestions = real ERP codes, never app-internal itemIds — PLUS fee entities under every
    // code they carry (fees often have no ERP id; their itemId IS the reference the FEE choice
    // links for client pricing — labeled "· FEE" so they read as charges in the picker).
    const optionsFromIndex = (index) => {
        const fees = codeIndexRef.current?.feeCodes || new Set();
        return index
            .filter(e => (e.code === e.erp || fees.has(String(e.code).toUpperCase())) && !/-\d{12,}/.test(e.code))
            .map(e => fees.has(String(e.code).toUpperCase()) ? { ...e, name: `${e.name || ''} · FEE`.trim() } : e)
            .sort((a, b) => a.code.localeCompare(b.code));
    };
    // CRM customers for the per-choice CUSTOMER-ONLY gate (loaded with the code index refresh).
    const [custList, setCustList] = useState(null);
    const ensureCustomers = async () => {
        if (custList) return custList;
        try {
            const s = await getDocs(collection(db, 'crm_records'));
            const list = s.docs.map(d => ({ id: d.id, ...d.data() }))
                .filter(c => String(c.id).startsWith('CUST-') || String(c.recordType || '').toUpperCase() === 'CUSTOMER')
                .map(c => ({ id: c.id, name: c.name || c.companyName || c.id }))
                .sort((a, b) => a.name.localeCompare(b.name));
            setCustList(list);
            return list;
        } catch (e) { setCustList([]); return []; }
    };
    // 4.5 Master Dictionaries (system/master_lists): the proj:/mount: selects on bracket choices
    // offer EXACTLY the vocabulary the Master Library editor + Vision engine use (BRACKET
    // PROJECTIONS / BRACKET MOUNT TYPES) — add a projection there (e.g. .75) and it appears here,
    // so CPQ and Vision can never drift apart.
    const [dictLists, setDictLists] = useState(null);
    const ensureDictLists = async () => {
        if (dictLists) return dictLists;
        try {
            const s = await getDoc(doc(db, 'system', 'master_lists'));
            const d = s.exists() ? s.data() : {};
            const lists = { projections: Array.isArray(d.projections) ? d.projections : [], bracketMounts: Array.isArray(d.bracketMounts) ? d.bracketMounts : [] };
            setDictLists(lists);
            return lists;
        } catch (e) { const empty = { projections: [], bracketMounts: [] }; setDictLists(empty); return empty; }
    };
    // FRESH index on user actions (Stuart 2026-07-22): items/ALIASES created in another tab
    // mid-session never appeared in the picker because the index was cached once per session
    // (H2-1BE alias invisible to Load Choices). Slot drops + Load Choices now re-fetch.
    const refreshCodeIndex = async () => {
        codeIndexRef.current = null;
        ensureCustomers(); // customer gate picker rides along (fire-and-forget)
        ensureDictLists(); // proj:/mount: dictionary vocabulary rides along too
        const index = await ensureCodeIndex().catch(() => null);
        if (index) setCodeOptions(optionsFromIndex(index));
        return index;
    };
    // Library-link fields for a typed/matched item # — the shape Visual Assembly writes for an
    // existing library part, so builder pins read as LINKED (not new/leftover) everywhere. partName
    // stays the ERP code (CPQ appends the description for display); partId follows VA's convention
    // of the part's itemId. Returns {} when the code isn't in the brand library (typo → plain pin).
    const libLinkFields = (code) => {
        const list = codeIndexRef.current?.byNorm?.get(normCode(code)) || [];
        // Exact raw code wins over a norm-collision sibling — a typed H1-75BPR must never
        // link to H1-75BP-R just because the dashes strip the same.
        const raw = String(code || '').trim().toUpperCase();
        const e = list.find(x => String(x.code).toUpperCase() === raw) || list[0];
        if (!e) return {};
        const erp = (e.erp && e.erp !== 'PENDING') ? e.erp : e.code;
        return { partId: e.itemId || e.code, partName: erp, legacyErpId: erp, isExistingLibraryPart: true, status: 'SPECS_LOCKED' };
    };
    // Two-part finials: LIVE candidates for the collar: pairing dropdowns — derived from the
    // CURRENT on-screen row state (assign rows / build slots), so ticking COLLAR or typing an
    // item # lists the collar IMMEDIATELY in the same session, before any save (saved pins
    // still arrive here via Load Choices → rows, so the persisted path keeps working).
    // codes = collar-flagged choices WITH an item # (deduped — a LEFT+RIGHT pair of the same
    // collar lists once; the stored value is the item # exactly as assigned, which the flow
    // generator matches against the collar option's partId/partName). pending = collar-flagged
    // choices still MISSING an item # (e.g. legacy FEE-workaround pins reload with a blank
    // item # box) — surfaced as disabled ⚠ rows so a fresh tick is visibly acknowledged and
    // the fix (type that choice's item #) is obvious instead of a silently empty list.
    const collarCandidatesOf = (allChoices) => {
        const seen = new Set(); const codes = []; const pending = [];
        (allChoices || []).forEach(c => {
            if (!c?.isCollar) return;
            const code = String(c.itemNo || '').trim();
            if (!code) { pending.push(String(c.label || c.nodeName || 'collar choice')); return; }
            const k = code.toUpperCase();
            if (!seen.has(k)) { seen.add(k); codes.push(code); }
        });
        return { codes, pending };
    };

    const addLog = (m, t = 'info') => setLog(p => [{ t: new Date().toLocaleTimeString(), m, type: t }, ...p].slice(0, 40));

    // CODE COLLISION AUDIT (Stuart 2026-07-16): dash-only twins are common in this catalog
    // (H1-75BPR ring vs H1-75BP-R backplate → both normalize to H175BPR). This scan lists every
    // group of DISTINCT codes sharing one normalized form. ✓ = their NAMES carry different
    // category words, so the matcher's tie-break tells them apart automatically; ⚠ = names too
    // similar — rename one (put ring/backplate/bracket/finial/pole in the name) so it can.
    const [audit, setAudit] = useState(null);
    const [auditBusy, setAuditBusy] = useState(false);
    const runCollisionAudit = async () => {
        setAuditBusy(true);
        try {
            const snap = await getDocs(collection(db, 'Approved_Designs'));
            const parts = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .filter(x => !activeBrand || x.brandId === activeBrand || (Array.isArray(x.sharedBrands) && x.sharedBrands.includes(activeBrand)));
            const groups = new Map(); // norm -> Map(rawCode -> {code, name, cls})
            parts.forEach(p => {
                [p.legacyErpId, p.itemId].forEach(code => {
                    if (!code || code === 'PENDING' || /-\d{12,}/.test(String(code))) return; // skip app-internal ids
                    const n = normCode(code);
                    if (n.length < 4) return;
                    const raw = String(code).toUpperCase();
                    const g = groups.get(n) || new Map();
                    if (!g.has(raw)) g.set(raw, { code: String(code), name: p.itemName || '', cls: p.partClass || '' });
                    groups.set(n, g);
                });
            });
            const found = [...groups.entries()]
                .filter(([, g]) => g.size > 1)
                .map(([norm, g]) => {
                    const items = [...g.values()];
                    const sigs = new Set(items.map(it => nameCategorySignature(it.name)));
                    return { norm, items, breakable: sigs.size > 1 };
                })
                .sort((a, b) => (a.breakable === b.breakable ? a.norm.localeCompare(b.norm) : (a.breakable ? 1 : -1)));
            setAudit(found);
            addLog(`Collision audit: ${found.length} colliding code group(s)${found.length ? ` — ${found.filter(f => !f.breakable).length} need a rename` : ''}.`, found.some(f => !f.breakable) ? 'error' : 'success');
        } catch (e) { alert('Audit failed: ' + (e.message || e)); }
        setAuditBusy(false);
    };

    useEffect(() => () => { Object.values(layers).forEach(l => l.url && URL.revokeObjectURL(l.url)); }, []); // eslint-disable-line

    // Existing brand assemblies for the Repair + Assign dropdowns — MAINLINE only (routingType MAIN
    // or recordType PRODUCT): this tool exists for main CPQ assemblies, so sub-assemblies/orphans
    // would only clutter the pick list.
    useEffect(() => {
        if (!activeBrand) return;
        const qy = query(collection(db, 'Approved_Designs'), where('brandId', '==', activeBrand), where('partClass', '==', 'Assembly'));
        const unsub = onSnapshot(qy, snap => setRepairList(
            snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .filter(a => a.routingType === 'MAIN' || a.recordType === 'PRODUCT')
                .sort((a, b) => String(a.itemName || '').localeCompare(String(b.itemName || '')))
        ));
        return () => unsub();
    }, [activeBrand]);

    // Fusion .fbx dropped on a slot → analyze + open the conversion checklist instead of the
    // normal .glb path. Convert & Load then feeds the produced .glb through onUpload as usual.
    const openFusionImport = async (slot, file) => {
        // Export flavor SEEDS from the destination slot (playbook 4.5b): the 📐 spec slot wants
        // TRUE METERS (the sheet generator's math is metric), everything that merges wants inches.
        // The toggle stays overridable — downloading a registry-cell spec GLB from any slot is
        // legitimate — but the default now matches where the file was dropped, and Convert & Load
        // confirms a mismatch instead of silently merging metre-scale geometry at 1/39 size.
        setFusionJob({ slot, fileName: file.name, buffer: null, analysis: null, rows: [], unitId: 'cm', mode: slot?.id === 'spec' ? 'SPEC' : 'PRODUCTION', busy: true, err: '' });
        try {
            const buffer = await file.arrayBuffer();
            const analysis = await analyzeFusionFbx(buffer);
            const index = await ensureCodeIndex().catch(() => null);
            const rows = analysis.components.map(c => {
                const m = index ? matchItemByName(c.cleanName, index, normalizeCategory(slot.category) || slot.category) : null;
                // hardware/screw bodies default to KEPT (they render) but keep their cleaned name;
                // a matched item code becomes the suggested canonical mesh name.
                return { key: c.key, keep: true, origName: c.origName, bodies: c.bodies, tris: c.tris, size: c.size, finalName: m ? `${m.code}${/LEFT|RIGHT/i.test(slot.position || '') ? ` ${slot.position}` : ''}` : c.cleanName, matched: !!m };
            });
            setFusionJob(j => j && j.fileName === file.name ? { ...j, buffer, analysis, rows, unitId: analysis.unitGuess, busy: false } : j);
            addLog(`Fusion import: ${file.name} — ${analysis.components.length} component(s), units read ${analysis.unitGuess.toUpperCase()} (FBX factor ${analysis.unitScaleFactor ?? '?'})`, 'info');
        } catch (e) {
            console.error(e);
            setFusionJob(j => j && j.fileName === file.name ? { ...j, busy: false, err: e.message || String(e) } : j);
        }
    };
    const runFusionConvert = async (download) => {
        const job = fusionJob;
        if (!job || !job.analysis) return;
        // MATCH-RATE GATE (playbook 4.5a). An unmatched kept component was SILENT: it merges under
        // its cleaned Fusion name, indistinguishable from deliberate shared hardware, and the spec
        // path skips non-code nodes without a word. Genuine hardware sails through un-named; the
        // gate names everything else so a typo'd Fusion component can't slide by as "hardware".
        const kept = job.rows.filter(r => r.keep);
        const unmatched = kept.filter(r => !r.matched && !HARDWARE_RE.test(r.finalName || r.origName));
        if (unmatched.length) {
            const list = unmatched.slice(0, 8).map(r => `• ${r.finalName || r.origName}`).join('\n');
            const more = unmatched.length > 8 ? `\n…and ${unmatched.length - 8} more` : '';
            const consequence = download
                ? 'In a spec GLB, a node that is not an EXACT library code is silently skipped by the 📐 generator.'
                : 'They merge as shared geometry under their Fusion names — no item pin, no BOM line.';
            if (!window.confirm(`${kept.length - unmatched.length} of ${kept.length} kept component(s) matched a Master Library code. These did NOT:\n\n${list}${more}\n\n${consequence}\n\nIf any of these IS a real part, fix its name (or the library) before converting.\n\nConvert anyway?`)) return;
        }
        // Flavor ↔ destination mismatch (Convert & Load only — Download goes wherever the user
        // intends): metre-scale geometry in a merge slot lands at 1/39 size with no later warning;
        // inch geometry in the 📐 slot makes the sheet lean on its two-state unit guess.
        if (!download) {
            const specSlot = job.slot?.id === 'spec';
            if (specSlot && job.mode !== 'SPEC' && !window.confirm('This file is loading into the 📐 SPEC slot but the export flavor is Production (inches). The sheet generator expects TRUE METERS here.\n\nConvert as inches anyway?')) return;
            if (!specSlot && job.mode === 'SPEC' && !window.confirm(`This file is loading into the ${job.slot?.label || 'merge'} slot but the export flavor is Spec (true m). Merged geometry is expected in INCHES — metre-scale merges ~39× too small.\n\nConvert as meters anyway?`)) return;
        }
        setFusionJob(j => ({ ...j, busy: true, err: '' }));
        try {
            const buf = await buildGlbFromAnalysis(job.analysis, job.rows, { mode: job.mode, unitId: job.unitId });
            const outName = job.fileName.replace(/\.fbx$/i, '') + (job.mode === 'SPEC' ? ' SPEC' : '') + '.glb';
            if (download) {
                const url = URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }));
                const a = document.createElement('a'); a.href = url; a.download = outName; a.click();
                URL.revokeObjectURL(url);
                setFusionJob(j => ({ ...j, busy: false }));
                addLog(`Fusion import: ${outName} downloaded (${job.mode}).`, 'success');
            } else {
                const glbFile = new File([buf], outName, { type: 'model/gltf-binary' });
                const slot = job.slot;
                setFusionJob(null);
                addLog(`Fusion import: converted ${job.fileName} → ${outName} (${job.mode}, units ${job.unitId}).`, 'success');
                await onUpload(slot, glbFile);
            }
        } catch (e) {
            console.error(e);
            setFusionJob(j => j ? { ...j, busy: false, err: e.message || String(e) } : j);
        }
    };

    const onUpload = async (slot, file) => {
        if (!file) return;
        if (/\.fbx$/i.test(file.name || '')) { openFusionImport(slot, file); return; }
        setBusy(slot.id);
        try {
            const buf = await file.arrayBuffer();
            const url = URL.createObjectURL(new Blob([buf]));
            const gltf = await new Promise((res, rej) => loaderRef.current.parse(buf, '', res, rej));
            const scene = gltf.scene;
            const names = slotChoiceNames(scene);
            // Auto-prefill each choice's item # from the Master Library by node name ("<ITEM#> <POS>"
            // convention) — the designer's naming does the data entry; hardware matches nothing → blank.
            // FRESH fetch: aliases/items created since the tab loaded must be matchable.
            const index = await refreshCodeIndex().catch(() => null);
            let hit = 0;
            // End slots (category FINIAL) seed each choice's explicit endTreatment tag from its name —
            // a one-time suggestion the user can override; other categories never carry the tag (a
            // "RETURN backplate" must not be mistaken for a return CHOICE).
            const isEndSlot = normalizeCategory(slot.category) === 'FINIAL';
            const choices = names.map(nm => {
                const m = index ? matchItemByName(nm, index, normalizeCategory(slot.category) || slot.category) : null;
                if (m) hit++;
                const et = isEndSlot ? (suggestTagsFromName(nm).endTreatment || 'FINIAL') : '';
                return { nodeName: nm, label: nm, itemNo: m ? m.code : '', endTreatment: et, isFee: et === 'FRENCH_RETURN' || et === 'MITER_RETURN', isHidden: false, isBasic: false, usesReturnPlates: false, isReturnArm: false, returnOnly: false, inlineOnly: false, isCollar: false, requiresCollar: '', projInches: '', mountType: '', catOverride: '', custIds: [], custNames: [], traverseRole: '', driveType: '', trvSetup: '', alwaysShown: false, note: '', thumb: '' };
            });
            setLayers(prev => {
                if (prev[slot.id]?.url) URL.revokeObjectURL(prev[slot.id].url);
                return { ...prev, [slot.id]: { scene, url, fileName: file.name, choices, offset: { x: 0, y: 0, z: 0 } } };
            });
            addLog(`Loaded ${slot.label}: ${file.name} — ${names.length} choice(s), ${hit} item #(s) auto-matched`, 'success');
            genSlotThumbs(slot.id, scene, names);
        } catch (e) { addLog(`Failed to load ${file.name}: ${e.message || e}`, 'error'); alert('Could not read that .glb:\n' + (e.message || e)); }
        setBusy('');
    };

    const nudge = (slotId, axis, val) => setLayers(prev => ({ ...prev, [slotId]: { ...prev[slotId], offset: { ...prev[slotId].offset, [axis]: Number(val) || 0 } } }));
    const removeLayer = (slotId) => setLayers(prev => { const n = { ...prev }; if (n[slotId]?.url) URL.revokeObjectURL(n[slotId].url); delete n[slotId]; return n; });
    const addSlot = () => setSlots(s => [...s, { id: `slot_${Date.now()}`, label: 'New Slot', category: 'OTHER', position: 'SHARED', location: '', desc: 'Type a descriptive label (e.g. "Left Return Backplate") — category & position tag themselves from it.' }]);
    const patchSlot = (id, patch) => setSlots(s => s.map(x => x.id === id ? { ...x, ...patch } : x));
    const removeSlot = (id) => { removeLayer(id); setSlots(s => s.filter(x => x.id !== id)); };

    // Smart "+ Slot": infer category/position from the label as it's typed ("Left Return Backplate" →
    // BACKPLATE · LEFT) so custom slots never ship with the OTHER/SHARED default mis-tag. Stops
    // guessing the moment the user touches category/position by hand (manualMeta).
    const inferSlotMeta = (label) => {
        const L = String(label || '').toUpperCase();
        let category = '';
        if (/BACKPLATE|BACK PLATE|COVER PLATE/.test(L)) category = 'BACKPLATE';
        else if (/BRACKET|ARM\b/.test(L)) category = 'BRACKET';
        else if (/FINIAL|\bEND\b/.test(L)) category = 'FINIAL';
        else if (/RING/.test(L)) category = 'RING';
        else if (/POLE|ROD\b/.test(L)) category = 'POLE';
        let position = '';
        if (/LEFT/.test(L)) position = 'LEFT';
        else if (/RIGHT/.test(L)) position = 'RIGHT';
        else if (/CENTER|CENTRE|MIDDLE/.test(L)) position = 'CENTER';
        else if (/FRONT/.test(L)) position = 'FRONT';
        else if (/\bBACK\b/.test(L) && !/BACKPLATE|BACK PLATE/.test(L)) position = 'BACK';
        return { category, position };
    };
    const patchSlotLabel = (id, label) => setSlots(s => s.map(x => {
        if (x.id !== id) return x;
        const next = { ...x, label };
        if (!x.manualMeta) {
            const inf = inferSlotMeta(label);
            if (inf.category) next.category = inf.category;
            if (inf.position) next.position = inf.position;
            if ((inf.category === 'BACKPLATE' || inf.category === 'BRACKET') && !next.location) next.location = 'WALL';
        }
        return next;
    }));

    // Per-choice editing in the uploader — same surface as the assign tool (patch by nodeName, ▲▼
    // ordering that Build persists as choiceSort, and ⤢ split for wrapper nodes holding several parts).
    const setSlotChoicePatch = (slotId, nodeName, patch) => setLayers(prev => prev[slotId] ? { ...prev, [slotId]: { ...prev[slotId], choices: prev[slotId].choices.map(c => c.nodeName === nodeName ? { ...c, ...patch } : c) } } : prev);
    const moveSlotChoice = (slotId, nodeName, dir) => setLayers(prev => {
        const layer = prev[slotId];
        if (!layer) return prev;
        const i = layer.choices.findIndex(c => c.nodeName === nodeName);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= layer.choices.length) return prev;
        const choices = [...layer.choices];
        [choices[i], choices[j]] = [choices[j], choices[i]];
        return { ...prev, [slotId]: { ...layer, choices } };
    });
    const splitSlotChoice = (slotId, nodeName) => {
        const layer = layers[slotId];
        const node = layer?.scene?.getObjectByName(nodeName);
        const kids = node ? (node.children || []).map(c => c.name).filter(Boolean) : [];
        if (!kids.length) return alert('This node has no named sub-parts to split into — it is a single mesh.\n\nTWO-PART FINIALS (collar + acrylic top): the seam must come from the FILE — have the designer model the collar and the top as TWO SEPARATE COMPONENTS in Fusion, each named its own item code (component names ARE the codes). Re-export/upload and both pieces list here as their own choices — no split needed.');
        const index = codeIndexRef.current?.brand === activeBrand ? codeIndexRef.current.index : null;
        const slotDef = slots.find(s => s.id === slotId);
        const isEndSlot = normalizeCategory(slotDef?.category) === 'FINIAL';
        setLayers(prev => prev[slotId] ? {
            ...prev,
            [slotId]: {
                ...prev[slotId],
                choices: prev[slotId].choices.flatMap(c => c.nodeName !== nodeName ? [c] : kids.map(nm => {
                    const m = index ? matchItemByName(nm, index, normalizeCategory(slotDef?.category) || slotDef?.category) : null;
                    const et = isEndSlot ? (suggestTagsFromName(nm).endTreatment || 'FINIAL') : '';
                    return { nodeName: nm, label: nm, itemNo: m ? m.code : '', endTreatment: et, isFee: et === 'FRENCH_RETURN' || et === 'MITER_RETURN', isHidden: false, isBasic: false, usesReturnPlates: false, isReturnArm: false, returnOnly: false, inlineOnly: false, isCollar: false, requiresCollar: '', projInches: '', mountType: '', catOverride: '', custIds: [], custNames: [], traverseRole: '', driveType: '', trvSetup: '', alwaysShown: false, note: '', thumb: '' };
                }))
            }
        } : prev);
        addLog(`Split "${nodeName}" into ${kids.length} sub-part(s).`, 'info');
        genSlotThumbs(slotId, layer.scene, kids);
    };

    // Switch workflow template. If anything's already uploaded, confirm first (uploads are cleared
    // because the new template's slots have different ids). Nothing here touches saved data.
    const switchTemplate = (key) => {
        if (key === template) return;
        if (Object.keys(layers).length && !window.confirm(`Switch to the "${TEMPLATES[key].label}" workflow? This resets the slots and clears the ${Object.keys(layers).length} file(s) you've uploaded (nothing saved is affected).`)) return;
        Object.values(layers).forEach(l => l.url && URL.revokeObjectURL(l.url));
        setLayers({});
        setTemplate(key);
        setSlots(TEMPLATES[key].slots.map(s => ({ ...s })));
    };

    const filledSlots = slots.filter(s => layers[s.id]);

    // Export + upload the SOP slot's scene as its OWN .glb — never merged into the working model,
    // no renaming (Fusion names ARE the codes, useful on the instruction sheets), no clusters/pins.
    const exportAndUploadSop = async (layer, asmName) => {
        const g = layer.scene.clone(true);
        g.position.set(layer.offset.x, layer.offset.y, layer.offset.z);
        const buf = await new Promise((res, rej) => new GLTFExporter().parse(g, r => res(r), e => rej(e), { binary: true }));
        const blob = new Blob([buf], { type: 'model/gltf-binary' });
        const path = `sop_models/${activeBrand}_${String(asmName).replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.glb`;
        const task = uploadBytesResumable(sRef(storage, path), blob);
        return new Promise((res, rej) => task.on('state_changed', null, rej, async () => res(await getDownloadURL(task.snapshot.ref))));
    };
    // Spec-sheet layout: identical own-.glb export, its own storage folder, no renaming — the
    // Fusion node names ARE the codes the 📐 tool classifies by.
    const exportAndUploadSpec = async (layer, asmName) => {
        const g = layer.scene.clone(true);
        g.position.set(layer.offset.x, layer.offset.y, layer.offset.z);
        const buf = await new Promise((res, rej) => new GLTFExporter().parse(g, r => res(r), e => rej(e), { binary: true }));
        const blob = new Blob([buf], { type: 'model/gltf-binary' });
        const path = `spec_models/${activeBrand}_${String(asmName).replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.glb`;
        const task = uploadBytesResumable(sRef(storage, path), blob);
        return new Promise((res, rej) => task.on('state_changed', null, rej, async () => res(await getDownloadURL(task.snapshot.ref))));
    };

    const build = async () => {
        const extendTarget = extendId ? repairList.find(a => a.id === extendId) : null;
        if (!extendTarget && !assemblyName.trim()) return alert('Name the assembly first.');
        // FORK GUARD (playbook 4.5c). A new build mints <BRAND>-ASM-<now> with no uniqueness
        // check — typing the name of an assembly that already exists silently creates a SECOND
        // document with its own clusters and pins, both valid-looking, while every flow/BOM/spec
        // link stays on the first. The doc id is the linkage; Extend is how an existing assembly
        // grows. This can't auto-switch to Extend (the operator may genuinely want a variant), so
        // it names the collision and makes the fork an informed choice.
        if (!extendTarget) {
            const nameNorm = assemblyName.trim().toUpperCase();
            const clash = repairList.find(a => String(a.itemName || '').trim().toUpperCase() === nameNorm);
            if (clash && !window.confirm(`⚠ An assembly named "${clash.itemName}" already exists (${clash.itemId || clash.id}).\n\nBuilding NEW creates a SECOND document — flows, BOM and spec links stay on the existing one. To grow the existing assembly, Cancel and pick it under EXTEND instead.\n\nReally create a second "${nameNorm}"?`)) return;
        }
        // The SOP + SPEC slots never merge into the sellable model — each exports as its own .glb.
        const sopLayer = layers['sop'];
        const specLayer = layers['spec'];
        const mergeSlots = filledSlots.filter(s => s.id !== 'sop' && s.id !== 'spec');
        if (!mergeSlots.length && !(extendTarget && (sopLayer || specLayer))) return alert('Upload at least one slot .glb first.\n\n(The SOP / Spec Sheet slots on their own can only be ATTACHED to an existing assembly — pick one under Extend.)');
        // Side-slot-only attach: geometry, clusters and pins untouched — upload + point the url(s).
        if (!mergeSlots.length && extendTarget && (sopLayer || specLayer)) {
            const what = [sopLayer && 'SOP/instructions', specLayer && '📐 Spec Sheet layout'].filter(Boolean).join(' + ');
            if (!window.confirm(`Attach the ${what} model to "${extendTarget.itemName}"?\n\nThe working model, clusters and pins are untouched.`)) return;
            setBusy('build');
            try {
                const patch = { updatedAt: Date.now() };
                if (sopLayer) {
                    const sopUrl = await exportAndUploadSop(sopLayer, extendTarget.itemName || extendTarget.id);
                    patch['manufacturingSpecs.sopCadUrl'] = sopUrl;
                    patch['manufacturingSpecs.sopCadFile'] = sopLayer.fileName || '';
                }
                if (specLayer) {
                    const specUrl = await exportAndUploadSpec(specLayer, extendTarget.itemName || extendTarget.id);
                    patch['manufacturingSpecs.specCadUrl'] = specUrl;
                    patch['manufacturingSpecs.specCadFile'] = specLayer.fileName || '';
                }
                await updateDoc(doc(db, 'Approved_Designs', extendTarget.id), patch);
                addLog(`✅ ${what} model attached to "${extendTarget.itemName}".`, 'success');
                alert(`✅ ${what} attached to "${extendTarget.itemName}".${sopLayer ? '\n\n• Tab .6 (Interactive 3D Instructions) now builds its pages on the SOP model.' : ''}${specLayer ? '\n\n• The 📐 Spec Sheet generator now draws this assembly from the spec layout (proper scale, every pole size/projection in the file).' : ''}`);
                setExtendId('');
            } catch (e) { console.error(e); addLog(`Attach failed: ${e.message || e}`, 'error'); alert('Attach failed:\n\n' + (e.message || e)); }
            setBusy('');
            return;
        }
        // ── PREFLIGHT ── catch the whole "built with 0 pins / mis-tagged slots / typo'd item #s"
        // class of failure BEFORE anything is written. Warnings don't block — you confirm through them.
        const index = codeIndexRef.current?.brand === activeBrand ? codeIndexRef.current.index : await ensureCodeIndex().catch(() => null);
        const knownNorms = new Set((index || []).map(e => e.norm));
        const warnings = [];
        mergeSlots.forEach(slot => {
            const ch = layers[slot.id].choices || [];
            const suspicious = ch.filter(c => !(c.itemNo && c.itemNo.trim()) && !c.isFee && !c.isHidden && !HARDWARE_RE.test(c.label) && /\d/.test(c.label) && c.label.replace(/[^A-Za-z0-9]/g, '').length >= 6);
            if (suspicious.length) warnings.push(`• ${slot.label}: ${suspicious.length} BLANK choice(s) that look like real parts (${suspicious.slice(0, 3).map(c => c.label).join(', ')}${suspicious.length > 3 ? ', …' : ''})`);
            const unknown = ch.filter(c => c.itemNo && c.itemNo.trim() && index && !knownNorms.has(normCode(c.itemNo)));
            if (unknown.length) warnings.push(`• ${slot.label}: item #(s) not in the ${String(activeBrand || '').toUpperCase()} library (typo?): ${unknown.map(c => c.itemNo).join(', ')}`);
            if (!slot.category || slot.category === 'OTHER') warnings.push(`• ${slot.label}: category is OTHER — the flow generator will misfile this cluster. Tag it.`);
            if (/RETURN/i.test(slot.label) && /PLATE/i.test(slot.label) && slot.category !== 'BACKPLATE') warnings.push(`• ${slot.label}: labeled a return backplate but category is ${slot.category || '—'} — should be BACKPLATE.`);
        });
        // DUPLICATE-SLOT WARNING on Extend (playbook 4.5e). Extend is append-only: re-uploading a
        // slot that already built a cluster ADDS a second cluster and a second copy of its
        // geometry — it never replaces (and 1.5's cluster delete removes the record, not the
        // mesh). Nothing dedupes, so at minimum the duplicate must be a CHOICE, not a surprise.
        if (extendTarget) {
            const existingNames = new Set((extendTarget.nodeClusters || []).map(c => String(c.name || '').toUpperCase()));
            mergeSlots.forEach(slot => {
                const pretty = `${slot.label.toUpperCase().replace(/\s+/g, '-')}`;
                if (existingNames.has(pretty)) warnings.push(`• ${slot.label}: this assembly ALREADY has a "${pretty}" cluster — extending ADDS A SECOND copy of its geometry (it never replaces). Fix choices via Load Choices instead, unless a second copy is intended.`);
            });
        }
        const summary = mergeSlots.map(s => {
            const ch = layers[s.id].choices || [];
            const pinned = ch.filter(c => (c.itemNo && c.itemNo.trim()) || c.isFee || c.isHidden).length;
            return `• ${s.label}: ${ch.length} choice(s) — ${pinned} pinned (item/fee/hide), ${ch.length - pinned} blank`;
        }).join('\n');
        if (!window.confirm(`${extendTarget ? `ADD ${mergeSlots.length} slot(s) to "${extendTarget.itemName}" (existing slots/pins untouched)` : `Build "${assemblyName}" from ${mergeSlots.length} slot file(s)`}?\n\nPREFLIGHT\n${summary}\n${warnings.length ? `\n⚠ CHECK FIRST\n${warnings.join('\n')}\n` : '\n✓ No issues detected.\n'}${sopLayer ? '\n+ SOP/instructions model attached as its OWN .glb (not merged).\n' : ''}\nBlank choices stay as always-visible shared geometry. Continue?`)) return;
        setBusy('build');
        try {
            // 1) Base scene: a fresh Group for a NEW assembly, or the EXISTING merged .glb when
            // EXTENDING — new slots are appended as additional named groups; existing geometry,
            // clusters, item #s and flags are untouched (same doc id → BOM/CPQ/flow links survive).
            let combined, asmId, asmName;
            let existingClusters = [], existingBuiltFrom = [], oldCadUrl = '';
            if (extendTarget) {
                const exSnap = await getDoc(doc(db, 'Approved_Designs', extendTarget.id));
                const ex = exSnap.data() || {};
                asmId = ex.itemId || extendTarget.id;
                asmName = ex.itemName || extendTarget.id;
                existingClusters = ex.nodeClusters || [];
                existingBuiltFrom = ex.builtFromLayers || [];
                oldCadUrl = ex.manufacturingSpecs?.cadUrl || '';
                if (!oldCadUrl) throw new Error('This assembly has no .glb to extend.');
                const baseBuf = await (await fetch(oldCadUrl)).arrayBuffer();
                const baseGltf = await new Promise((res, rej) => loaderRef.current.parse(baseBuf, '', res, rej));
                const s = baseGltf.scene;
                if (s.children.length === 1 && !s.children[0].isMesh) combined = s.children[0];
                else { combined = new THREE.Group(); combined.name = String(asmName).toUpperCase(); [...s.children].forEach(c => combined.add(c)); }
            } else {
                combined = new THREE.Group();
                combined.name = assemblyName.toUpperCase().trim();
                asmId = `${activeBrand.toUpperCase()}-ASM-${Date.now()}`;
                asmName = assemblyName;
            }
            const clusters = [], pins = [];
            // Slot prefixes continue AFTER the existing clusters so namespaces can never collide.
            const slotOffset = existingClusters.length;
            mergeSlots.forEach((slot, slotIdx) => {
                const layer = layers[slot.id];
                const g = layer.scene.clone(true);
                g.position.set(layer.offset.x, layer.offset.y, layer.offset.z);
                const pretty = `${slot.label.toUpperCase().replace(/\s+/g, '-')}`;
                // CRITICAL: rename EVERY node in this slot to a slot-unique name before we collect names
                // or export. GLB exporters reuse generic names ("Scene", "Object_0", "mesh_0", material
                // names) across files, so without this two slots' clusters list the SAME node names and
                // the 3D engine (which matches visibility by name) can't tell them apart — that's what
                // makes some groups correct and others bleed together. A per-slot prefix guarantees each
                // cluster owns a distinct namespace, and renaming BEFORE export keeps the stored cluster
                // node names in exact sync with the .glb. cluster.name stays the pretty label (display +
                // generator fallback partId). topMap remaps each choice's top-level name for its pin.
                // UNIQUE ACROSS TIME (2026-08-16 incident: the prefix was just the section COUNT, so
                // deleting sections let the next build re-mint the SAME S<n> name — her wood-rod
                // upload collided with the orphaned geometry of an earlier attempt and with the
                // acrylic slot minted at the same offset, and everything downstream matches by name).
                const mint = Date.now().toString(36).slice(-5).toUpperCase();
                const prefix = `S${slotOffset + slotIdx}${mint}-${pretty}`.replace(/[^A-Za-z0-9-]/g, '').slice(0, 44);
                g.name = prefix;
                // Map each CHOICE node's original name → its renamed name (choices may sit a level
                // deeper than the group after auto-unwrap/split, so match by name set, not by parent).
                // Traversal is parent-first, so a top-level choice wins over a same-named deep dupe.
                const choiceSet = new Set((layer.choices || []).map(c => c.nodeName));
                const topMap = {};
                let ni = 0;
                g.traverse(node => {
                    if (node === g) return;
                    const orig = node.name || '';
                    const nn = `${prefix}__${ni++}${orig ? '_' + orig.replace(/[^A-Za-z0-9]/g, '').slice(0, 24) : ''}`;
                    if (orig && choiceSet.has(orig) && !(orig in topMap)) topMap[orig] = nn;
                    node.name = nn;
                });
                combined.add(g);
                const clusterId = `CLUSTER-${slot.id}-${Date.now()}`;
                // Cluster tags are written CANONICAL (normalize the slot template values) so 1.5 /
                // tab 2 / the generator / Vision all read the same vocabulary.
                clusters.push({ id: clusterId, name: pretty, nodes: [prefix, ...allNodeNames(g)], category: normalizeCategory(slot.category) || slot.category, position: normalizePosition(slot.position) || slot.position, location: normalizeLocation(slot.location) || '' });
                // Full pin schema — identical to the assign tool, so a built assembly needs NO
                // follow-up pass: item / fee / hidden / basic flags + the arrow order (choiceSort).
                (layer.choices || []).forEach((ch, idx) => {
                    const hasItem = ch.itemNo && ch.itemNo.trim();
                    if (!hasItem && !ch.isFee && !ch.isHidden) {
                        // Blank + hardware-looking = shared hardware, no pin. Blank + REAL-looking
                        // = ⏸ PARK: hidden geometry pin until the item # exists (designer/IT timing).
                        if (!looksRealPart(ch.label)) return;
                        const slugP = (ch.label || 'PART').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 18);
                        const nodeP = topMap[ch.nodeName] || ch.nodeName;
                        pins.push({ assemblyId: asmId, clusterId, partId: `HIDDEN-${slugP}`, partName: ch.label || `HIDDEN-${slugP}`, defaultQty: 1, choiceNode: nodeP, targetNode: nodeP, choiceSort: idx, isHiddenPart: true, parked: true, ...(String(ch.note || '').trim() ? { designerNote: String(ch.note).trim() } : {}) });
                        return;
                    }
                    const slug = (ch.label || 'PART').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 18);
                    // A hidden choice WITH an item # keeps the real id — the generator includes it in the
                    // BOM (includedParts) at its cluster's position. HIDDEN-… synthetic = geometry-only.
                    const partId = hasItem ? ch.itemNo.trim().toUpperCase() : (ch.isHidden ? `HIDDEN-${slug}` : `FEE-${slug}`);
                    const node = topMap[ch.nodeName] || ch.nodeName;
                    // endTreatment: the explicit per-choice tag (finial vs french/miter return vs inside
                    // mount). THE canonical signal — the generator/CPQ no longer have to sniff names.
                    const et = (ch.catOverride && String(ch.catOverride).toUpperCase() !== 'FINIAL') ? '' : (ch.endTreatment || '');
                    pins.push({
                        assemblyId: asmId, clusterId, partId, partName: ch.label || partId, defaultQty: 1,
                        // targetNode mirrors choiceNode so Visual Assembly's node-thumbnail + pin
                        // display work on builder pins; libLinkFields marks matched items as LINKED
                        // library parts (isExistingLibraryPart etc.) instead of new/leftover.
                        choiceNode: node, targetNode: node, choiceSort: idx,
                        ...(et ? { endTreatment: et } : {}),
                        ...(ch.isFee && !ch.isHidden ? { isFee: true } : {}),
                        ...(ch.isHidden ? { isHiddenPart: true } : {}),
                        ...(ch.isBasic && !ch.isFee && !ch.isHidden ? { isBasic: true } : {}), ...(ch.usesReturnPlates && !ch.isFee && !ch.isHidden ? { usesReturnPlates: true } : {}), ...(ch.isReturnArm && !ch.isFee && !ch.isHidden ? { isReturnArm: true } : {}), ...(ch.returnOnly && !ch.isFee && !ch.isHidden ? { returnOnly: true } : {}), ...(ch.inlineOnly && !ch.isFee && !ch.isHidden ? { inlineOnly: true } : {}),
                        ...(hasItem && !ch.isFee && Array.isArray(ch.custIds) && ch.custIds.length ? { customerIds: ch.custIds, customerNames: ch.custNames || [] } : {}),
                        // Two-part finial pairing (COLLAR checkbox / collar: dropdown) — persisted
                        // exactly like customerIds so the generator pairs tops to their collar.
                        ...(hasItem && !ch.isFee && ch.isCollar ? { isCollar: true } : {}),
                        ...(hasItem && !ch.isFee && !ch.isCollar && String(ch.requiresCollar || '').trim() ? { requiresCollar: String(ch.requiresCollar).trim() } : {}), ...(hasItem && String(ch.projInches || '').trim() ? { projInches: String(ch.projInches).trim().toUpperCase() } : {}), ...(hasItem && !ch.isFee && String(ch.mountType || '').trim() ? { mountType: String(ch.mountType).trim().toUpperCase() } : {}), ...(hasItem && String(ch.catOverride || '').trim() ? { catOverride: String(ch.catOverride).trim().toUpperCase() } : {}), ...(String(ch.traverseRole || '').trim() ? { traverseRole: String(ch.traverseRole).trim().toUpperCase() } : {}), ...(String(ch.driveType || '').trim() ? { driveType: String(ch.driveType).trim().toUpperCase() } : {}), ...(String(ch.trvSetup || '').trim() ? { trvSetup: String(ch.trvSetup).trim().toUpperCase() } : {}), ...(ch.alwaysShown && !ch.isFee ? { alwaysShown: true } : {}), // THE FEE'S TYPED CODE, IN A FIELD OF ITS OWN (Stuart 2026-08-04: "the bug that keeps
                    // whipping out all my miter fees is still, they are yet again gone"). partId was
                    // carrying it, and partId is rewritten by anything that re-saves a choice — once it
                    // became the synthetic FEE-<slug> the code was unrecoverable. This field is written
                    // by nothing else and read back first, so the code survives a bad round-trip.
                    ...(ch.isFee && String(ch.itemNo || '').trim() ? { feeItemNo: String(ch.itemNo).trim().toUpperCase() } : {}),
                        // DESIGNER NOTE (Stuart 2026-08-10, for the H1-138 uploads): typed at upload,
                        // shown in Load Choices — "which bracket is this and where does it sit" travels
                        // with the pin instead of living in someone's memory. Display-only downstream.
                        ...(String(ch.note || '').trim() ? { designerNote: String(ch.note).trim() } : {}),
                        ...(hasItem && !ch.isFee ? libLinkFields(ch.itemNo) : {})
                    });
                });
            });

            // 2) Export the combined scene → binary .glb.
            addLog('Merging + exporting combined .glb…', 'info');
            const glbBuffer = await new Promise((res, rej) => {
                new GLTFExporter().parse(combined, (result) => res(result), (err) => rej(err), { binary: true });
            });
            const blob = new Blob([glbBuffer], { type: 'model/gltf-binary' });

            // 3) Upload to Storage.
            const path = `assemblies/${activeBrand}_${String(asmName).replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.glb`;
            const task = uploadBytesResumable(sRef(storage, path), blob);
            const cadUrl = await new Promise((res, rej) => task.on('state_changed', null, rej, async () => res(await getDownloadURL(task.snapshot.ref))));
            addLog(`Uploaded combined model (${(blob.size / 1e6).toFixed(1)} MB).`, 'success');

            // SOP model (if loaded): its OWN .glb alongside the working model — Tab .6 builds on it.
            let sopUrl = '';
            if (sopLayer) {
                addLog('Exporting + uploading SOP/instructions model…', 'info');
                sopUrl = await exportAndUploadSop(sopLayer, asmName);
            }
            // Spec-sheet layout (if loaded): its OWN .glb — the 📐 generator prefers it.
            let specUrl = '';
            if (specLayer) {
                addLog('Exporting + uploading 📐 spec-sheet layout…', 'info');
                specUrl = await exportAndUploadSpec(specLayer, asmName);
            }

            // 4) Write the assembly doc. EXTEND = append clusters + swap cadUrl on the SAME doc (old
            // .glb kept as backup; nothing existing is rewritten). NEW = create the mainline PRODUCT.
            if (extendTarget) {
                await updateDoc(doc(db, 'Approved_Designs', extendTarget.id), {
                    nodeClusters: [...existingClusters, ...clusters],
                    'manufacturingSpecs.cadUrl': cadUrl,
                    'manufacturingSpecs.cadUrlBackup': oldCadUrl,
                    ...(sopUrl ? { 'manufacturingSpecs.sopCadUrl': sopUrl, 'manufacturingSpecs.sopCadFile': sopLayer.fileName || '' } : {}),
                    ...(specUrl ? { 'manufacturingSpecs.specCadUrl': specUrl, 'manufacturingSpecs.specCadFile': specLayer.fileName || '' } : {}),
                    builtFromLayers: [...existingBuiltFrom, ...mergeSlots.map(s => ({ slot: s.label, file: layers[s.id].fileName }))],
                    updatedAt: Date.now()
                });
            } else {
                await setDoc(doc(db, 'Approved_Designs', asmId), {
                    id: asmId, itemId: asmId, itemName: assemblyName.toUpperCase().trim(),
                    brandId: activeBrand, sharedBrands: [activeBrand],
                    partClass: 'Assembly', routingType: 'MAIN', recordType: 'PRODUCT',
                    // Builder output is deliberately authored — stamp the Inception sign-offs so it flows
                    // everywhere that gates on approvals (e.g. Visual Assembly) without an Inception pass.
                    approvals: { designer: currentUser || 'BUILDER', technical: currentUser || 'BUILDER', machinist: currentUser || 'BUILDER' },
                    nodeClusters: clusters,
                    manufacturingSpecs: { cadUrl, status: 'BUILT_FROM_LAYERS', ...(sopUrl ? { sopCadUrl: sopUrl, sopCadFile: sopLayer.fileName || '' } : {}), ...(specUrl ? { specCadUrl: specUrl, specCadFile: specLayer.fileName || '' } : {}) },
                    builtFromLayers: mergeSlots.map(s => ({ slot: s.label, file: layers[s.id].fileName })),
                    createdAt: Date.now(), updatedAt: Date.now(), author: currentUser || ''
                }, { merge: true });
            }
            // Stored id MUST equal the real doc id — Visual Assembly addresses pins by pin.id for
            // reassign/qty/delete, and a mismatched stored id makes those writes hit a nonexistent path.
            // pinIdFor (node-name hash) — the SAME id the assign path uses (playbook 4.5d). The old
            // PIN-<asm>-<cluster>-<part> formula collided whenever several choices in one slot
            // legitimately share a code (the three-miter-fee case: last write wins, the rest vanish
            // and reload blank). The assign path was fixed on 2026-08-04; the build path kept the
            // old formula. New clusters get collision-free ids; existing pins keep theirs (Extend
            // never rewrites them, and the assign path self-heals per node on the next save).
            for (const p of pins) {
                const pid = pinIdFor(asmId, p.clusterId, p.partId, p.choiceNode);
                await setDoc(doc(db, 'assembly_pins', pid), { id: pid, ...p });
            }

            addLog(`✅ ${extendTarget ? 'Extended' : 'Built'} "${asmName}" — ${clusters.length} ${extendTarget ? 'NEW ' : ''}clusters, ${pins.length} BOM pin(s).`, 'success');
            alert(extendTarget
                ? `✅ Added ${clusters.length} slot(s) to "${asmName}" — existing slots, item #s and flags untouched (old .glb kept as backup).\n\nNow REGENERATE its CPQ flow (System Admin → "Regenerate Steps from Tags — keep prices") so the new choices appear, and hard-refresh other open tabs.`
                : `✅ Assembly "${asmName}" built.\n\n${clusters.length} clusters (already tagged position + category), ${pins.length} BOM lines. It's ready in Visual Assembly / BOM / Vision — no Auto-Group needed. Generate its CPQ flow in System Admin when ready.`);
            if (extendTarget) setExtendId('');
        } catch (e) { console.error(e); addLog(`Build failed: ${e.message || e}`, 'error'); alert('Build failed:\n\n' + (e.message || e)); }
        setBusy('');
    };

    // REPAIR an assembly built before the unique-name fix: its clusters share generic node names
    // ("Body1", screw names, …) across slots, so the 3D engine can't tell them apart. Each slot is
    // still its OWN named group inside the merged .glb (the group name = the cluster name), so we can
    // find each group, re-namespace its whole subtree to unique names, rewrite that cluster's node
    // list, re-export/upload the .glb, and remap the pins — WITHOUT re-uploading files or touching any
    // tags / item numbers. Old .glb is kept as a backup. Runs in the authenticated app (App Check ok).
    const handleRepairNodeNames = async () => {
        if (!repairId) return alert('Pick an assembly to repair.');
        const target = repairList.find(a => a.id === repairId);
        if (!target) return;
        if (!window.confirm(`Repair node names on "${target.itemName}"?\n\nRewrites the merged .glb so every slot gets unique node names (fixes clusters sharing names / bleeding together) and updates its clusters — WITHOUT re-uploading files or changing your tags or item numbers. The old .glb is kept as a backup.`)) return;
        setRepairBusy(true);
        try {
            addLog(`Repairing "${target.itemName}"…`, 'info');
            const snap = await getDoc(doc(db, 'Approved_Designs', repairId));
            const data = snap.data() || {};
            const cadUrl = data.manufacturingSpecs?.cadUrl;
            const clusters = (data.nodeClusters || []).map(c => ({ ...c }));
            if (!cadUrl) throw new Error('This assembly has no cadUrl (.glb) to repair.');
            if (!clusters.length) throw new Error('This assembly has no nodeClusters to repair.');
            // Already repaired? Node names are unique — re-running would just re-namespace pointlessly and
            // fail the name lookup (groups are now prefixed). Stop with a friendly nudge.
            if (data.manufacturingSpecs?.nodeNamesRepairedAt) {
                setRepairBusy(false);
                return alert(`"${target.itemName}" was already repaired — its node names are unique, nothing to fix.\n\nNext step: use the "Assign item numbers to choices" card below (Load Choices) to give each finial an item # so the choices split into individual options.`);
            }

            const buf = await (await fetch(cadUrl)).arrayBuffer();
            const gltf = await new Promise((res, rej) => loaderRef.current.parse(buf, '', res, rej));
            const scene = gltf.scene;
            const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

            const clusterTopMap = {}; // clusterId -> { originalTopLevelName: newName }
            let matched = 0;
            clusters.forEach((cl, i) => {
                // Find this cluster's slot group by its stored group-node name (nodes[0]) or cluster name;
                // fall back to a normalized match over both.
                let grp = scene.getObjectByName((cl.nodes && cl.nodes[0]) || cl.name) || scene.getObjectByName(cl.name);
                if (!grp) { const wants = new Set([norm((cl.nodes && cl.nodes[0]) || ''), norm(cl.name)].filter(Boolean)); scene.traverse(n => { if (!grp && !n.isMesh && wants.has(norm(n.name))) grp = n; }); }
                if (!grp) { addLog(`⚠ no group node for cluster "${cl.name}" — left as-is`, 'error'); return; }
                matched++;
                const prefix = `S${i}-${norm(cl.name)}`.slice(0, 44);
                const newNames = [];
                const topMap = {};
                let ni = 0;
                const rename = (node, isRoot) => {
                    const orig = node.name || '';
                    const nn = isRoot ? prefix : `${prefix}__${ni++}${orig ? '_' + orig.replace(/[^A-Za-z0-9]/g, '').slice(0, 24) : ''}`;
                    if (!isRoot && node.parent === grp && orig && !(orig in topMap)) topMap[orig] = nn;
                    node.name = nn;
                    newNames.push(nn);
                };
                rename(grp, true);
                grp.traverse(n => { if (n !== grp) rename(n, false); });
                cl.nodes = [...new Set(newNames)];
                clusterTopMap[cl.id] = topMap;
            });
            if (!matched) throw new Error('Could not find any slot groups in the .glb by cluster name — this assembly may not have been built by the Assembly Builder. Nothing changed.');

            addLog('Re-exporting repaired .glb…', 'info');
            const glbBuffer = await new Promise((res, rej) => new GLTFExporter().parse(scene, r => res(r), e => rej(e), { binary: true }));
            const blob = new Blob([glbBuffer], { type: 'model/gltf-binary' });
            const path = `assemblies/${activeBrand}_${String(target.itemName || 'asm').replace(/[^a-z0-9]/gi, '_')}_repaired_${Date.now()}.glb`;
            const up = uploadBytesResumable(sRef(storage, path), blob);
            const newCadUrl = await new Promise((res, rej) => up.on('state_changed', null, rej, async () => res(await getDownloadURL(up.snapshot.ref))));

            await updateDoc(doc(db, 'Approved_Designs', repairId), {
                nodeClusters: clusters,
                'manufacturingSpecs.cadUrl': newCadUrl,
                'manufacturingSpecs.cadUrlBackup': cadUrl,
                'manufacturingSpecs.nodeNamesRepairedAt': Date.now(),
                updatedAt: Date.now()
            });

            // Remap each pin's choiceNode to its renamed node.
            let pinFixed = 0;
            const pinSnap = await getDocs(query(collection(db, 'assembly_pins'), where('assemblyId', '==', data.itemId || repairId)));
            for (const pd of pinSnap.docs) {
                const pin = pd.data();
                const tm = clusterTopMap[pin.clusterId];
                if (tm && pin.choiceNode && tm[pin.choiceNode]) { await updateDoc(pd.ref, { choiceNode: tm[pin.choiceNode] }); pinFixed++; }
            }

            addLog(`✅ Repaired "${target.itemName}" — ${matched}/${clusters.length} clusters re-namespaced, ${pinFixed} pin(s) remapped.`, 'success');
            alert(`✅ Repaired "${target.itemName}".\n\n${matched} of ${clusters.length} clusters now have unique node names (no more shared "Body1" collisions). Tags + item numbers untouched; the old .glb is kept as a backup.\n\nHard-refresh (⌘⇧R), then re-open it in Node Grouping — the groups should be clean. Any cluster logged as "no group node" was hand-added and needs a manual look.`);
        } catch (e) { console.error(e); addLog(`Repair failed: ${e.message || e}`, 'error'); alert('Repair failed:\n\n' + (e.message || e)); }
        setRepairBusy(false);
    };

    // ASSIGN ITEM NUMBERS to an existing assembly's stacked choices — for assemblies built without
    // item #s (0 pins), so the CPQ generator has nothing to split the choices by. Reads the .glb, lists
    // each cluster's top-level child nodes (= its choices), and lets you type an item # per real choice
    // (leave shared hardware like screws/standoffs blank → stays always-on). Writes one assembly_pin per
    // filled choice with choiceNode = that node, so the generator fans them out into individual options.
    const choiceLabel = (nm) => String(nm || '').split('__').pop().replace(/^\d+_?/, '') || String(nm || '');
    // 🗑 DELETE AN ENTIRE SECTION (Stuart 2026-08-14: designer re-uploading the whole finial
    // sections — "keep the overall file size/download time down"). Reuses the repair pipeline:
    // fetch the merged .glb fresh, REMOVE the cluster's group node, re-export + upload (old .glb
    // kept as backup on the doc), then drop the cluster record and delete its pins. The geometry
    // actually leaves the file, so the download shrinks; the replacement section arrives via
    // ➕ Extend as usual, and a flow Regenerate clears the old options.
    const deleteSection = async (r) => {
        if (!assignId || !assignData) return;
        if (!window.confirm(`🗑 DELETE the entire "${r.clusterName}" section?\n\n• ${r.choices.length} choice node(s) and their pins are removed\n• Its geometry is REMOVED from the .glb (file shrinks; the old .glb is kept as a backup on the record)\n• REGENERATE the flow afterwards — the section's options disappear\n\nUpload the replacement section with ➕ Extend. This cannot be undone in place.`)) return;
        setAssignBusy(true);
        try {
            const dref = doc(db, 'Approved_Designs', assignId);
            const snapD = await getDoc(dref);
            const data = snapD.data() || {};
            const cadUrl = data.manufacturingSpecs?.cadUrl;
            const cl = (data.nodeClusters || []).find(x => x.id === r.clusterId) || {};
            let newCadUrl = null;
            if (cadUrl) {
                // ⏳ PHASE FEEDBACK (Stuart 2026-08-14: the delete "appears to time out" — it never
                // hung; the strip re-processes the ENTIRE merged .glb (download → parse → re-export →
                // re-upload), minutes on a big file, with parse/export freezing the tab. He left, the
                // writes landed in the background, and the UI never confirmed. Log every phase — with a
                // paint yield before the sync freezes so the lines actually show — % during the upload,
                // and an alert at the end = the confirmation that was missing.)
                addLog(`⏳ Deleting "${r.clusterName}" — downloading the merged .glb… On a large assembly this takes a few minutes and the tab may briefly FREEZE mid-way. Stay on this tab until the confirmation pops up.`, 'info');
                await new Promise(res => setTimeout(res, 60));
                const buf = await (await fetch(cadUrl)).arrayBuffer();
                addLog(`Parsing ${(buf.byteLength / 1048576).toFixed(1)} MB… (the tab may freeze for a moment)`, 'info');
                await new Promise(res => setTimeout(res, 60));
                const gltf = await new Promise((res, rej) => loaderRef.current.parse(buf, '', res, rej));
                const scene = gltf.scene;
                const nrm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
                // ⚠ SHARED-NAME GUARD (2026-08-16 incident, H1-138): a duplicate upload's cluster
                // carried the SAME group/node names as the real finial pack — the strip resolved
                // the name to the REAL pack's group and removed the wrong geometry. If any OTHER
                // section still claims a name this one stores, the delete is RECORD-ONLY: never
                // strip geometry a sibling section can still be pointing at.
                const mineNames = new Set([...(cl.nodes || []), cl.name, r.clusterName].filter(Boolean).map(nrm));
                const sharedWith = (data.nodeClusters || []).find(x => x.id !== r.clusterId && [...(x.nodes || []), x.name].filter(Boolean).some(n => mineNames.has(nrm(n))));
                let grp = null;
                if (sharedWith) {
                    addLog(`⚠ "${sharedWith.name || 'another section'}" claims the same group/node name(s) — records removed, geometry left in place so the sibling keeps its meshes.`, 'error');
                } else {
                    grp = scene.getObjectByName((cl.nodes && cl.nodes[0]) || cl.name || r.clusterName);
                    if (!grp) { const wants = new Set([nrm((cl.nodes && cl.nodes[0]) || ''), nrm(cl.name || r.clusterName)].filter(Boolean)); scene.traverse(n => { if (!grp && !n.isMesh && wants.has(nrm(n.name))) grp = n; }); }
                }
                if (grp) {
                    grp.removeFromParent();
                    addLog(`Re-exporting the .glb without "${r.clusterName}"… (the tab may freeze for a moment)`, 'info');
                    await new Promise(res => setTimeout(res, 60));
                    const glbBuffer = await new Promise((res, rej) => new GLTFExporter().parse(scene, out => res(out), e => rej(e), { binary: true }));
                    const blob = new Blob([glbBuffer], { type: 'model/gltf-binary' });
                    const path = `assemblies/${activeBrand}_${String(data.itemName || 'asm').replace(/[^a-z0-9]/gi, '_')}_sectiondel_${Date.now()}.glb`;
                    const up = uploadBytesResumable(sRef(storage, path), blob);
                    let lastPct = 0;
                    newCadUrl = await new Promise((res, rej) => up.on('state_changed', (s) => {
                        const pct = Math.round((s.bytesTransferred / s.totalBytes) * 100);
                        if (pct - lastPct >= 25 || (pct === 100 && lastPct < 100)) { lastPct = pct; addLog(`Uploading the stripped .glb (${(s.totalBytes / 1048576).toFixed(1)} MB)… ${pct}%`, 'info'); }
                    }, rej, async () => res(await getDownloadURL(up.snapshot.ref))));
                } else if (!sharedWith) {
                    addLog(`⚠ "${r.clusterName}" group not found in the .glb — records removed, geometry left in the file (Repair Node Names or the re-upload merge can strip it later).`, 'error');
                }
            }
            await updateDoc(dref, {
                nodeClusters: (data.nodeClusters || []).filter(x => x.id !== r.clusterId),
                ...(newCadUrl ? { 'manufacturingSpecs.cadUrl': newCadUrl, 'manufacturingSpecs.cadUrlBackup': cadUrl } : {}),
                updatedAt: Date.now()
            });
            const pinsSnap = await getDocs(query(collection(db, 'assembly_pins'), where('assemblyId', '==', data.itemId || assignId), where('clusterId', '==', r.clusterId)));
            for (const d of pinsSnap.docs) await deleteDoc(d.ref);
            addLog(`🗑 Section "${r.clusterName}" deleted — ${pinsSnap.size} pin(s) removed${newCadUrl ? ', geometry stripped from the .glb (old kept as backup)' : ''}. REGENERATE the flow, then ➕ Extend with the replacement section.`, 'success');
            // The explicit confirmation (matches deleteChoice) — before the choices reload, which
            // re-downloads and re-parses the new .glb and is itself another long silent stretch.
            alert(`🗑 Section "${r.clusterName}" deleted.\n\n• ${pinsSnap.size} pin(s) removed${newCadUrl ? '\n• Geometry stripped from the .glb — the file shrank (old .glb kept as backup on the record)' : '\n• ⚠ Group not found in the .glb — records removed, geometry left in the file'}\n\nNext: REGENERATE the flow, then ➕ Extend with the replacement section.\n\nOK reloads the choices list (downloads the new .glb — give it a moment).`);
            setAssignBusy(false);
            await handleLoadChoices();
            return;
        } catch (e) {
            console.error('Section delete failed:', e);
            alert('Section delete failed: ' + (e.message || e) + '\n\nNothing may be half-deleted — reload choices to see the current state.');
        }
        setAssignBusy(false);
    };

    // ↩ RESTORE THE PREVIOUS .GLB (2026-08-16 incident: a section-delete strip resolved a
    // duplicate's shared group name to the REAL finial pack and removed the wrong geometry).
    // Every strip stores the pre-strip file as cadUrlBackup — this swaps cadUrl ↔ cadUrlBackup
    // (restore is itself undoable the same way). Cluster records and pins are untouched.
    const restoreGlbBackup = async () => {
        if (!assignId) return;
        setAssignBusy(true);
        try {
            const dref = doc(db, 'Approved_Designs', assignId);
            const data = (await getDoc(dref)).data() || {};
            const cur = data.manufacturingSpecs?.cadUrl;
            const bak = data.manufacturingSpecs?.cadUrlBackup;
            if (!bak) { alert('No .glb backup on this record — nothing to restore.'); setAssignBusy(false); return; }
            if (!window.confirm(`↩ Restore the previous .glb?\n\nThe model file goes back to the version saved before the last section-delete strip; the current (stripped) file becomes the new backup, so you can swap forward again. Cluster records and pins are NOT changed.\n\nOK reloads the choices from the restored file (give it a moment).`)) { setAssignBusy(false); return; }
            await updateDoc(dref, { 'manufacturingSpecs.cadUrl': bak, 'manufacturingSpecs.cadUrlBackup': cur, updatedAt: Date.now() });
            addLog('↩ Restored the previous .glb — the stripped file is now the backup. Reloading choices…', 'success');
            await handleLoadChoices();
        } catch (e) {
            console.error('Restore failed:', e);
            alert('Restore failed: ' + (e.message || e));
        }
        setAssignBusy(false);
    };

    // 🧹 STRIP UNCLAIMED GEOMETRY (2026-08-16): record-only section deletes and failed uploads
    // leave groups in the .glb that NO section claims — and unclaimed nodes render PERMANENTLY in
    // the CPQ (nothing controls them). Removes (a) top-level groups whose names no cluster stores,
    // and (b) LATER duplicates of a name an earlier sibling already carries — the engine resolves
    // names first-match, so the kept copy is exactly the one the engine already uses. Old .glb
    // kept as backup (↩ restorable).
    const stripOrphanGeometry = async () => {
        if (!assignId) return;
        setAssignBusy(true);
        try {
            const dref = doc(db, 'Approved_Designs', assignId);
            const data = (await getDoc(dref)).data() || {};
            const cadUrl = data.manufacturingSpecs?.cadUrl;
            if (!cadUrl) { alert('No .glb on this record.'); setAssignBusy(false); return; }
            const claimed = new Set();
            (data.nodeClusters || []).forEach(cl => [cl.name, ...(cl.nodes || [])].filter(Boolean).forEach(n => claimed.add(String(n))));
            addLog('🧹 Downloading the .glb to scan for unclaimed geometry… (large files take a few minutes; the tab may freeze)', 'info');
            await new Promise(res => setTimeout(res, 60));
            const buf = await (await fetch(cadUrl)).arrayBuffer();
            const gltf = await new Promise((res, rej) => loaderRef.current.parse(buf, '', res, rej));
            const scene = gltf.scene;
            const root = (scene.children.length === 1 && !scene.children[0].isMesh) ? scene.children[0] : scene;
            // RECURSIVE (2026-08-16: the top-level-only walk reported "all clear" while two
            // orphaned ghost rods sat one level DOWN — extend-merges nest earlier roots as
            // wrapper groups, so an orphan inside a wrapper that also holds claimed geometry
            // was invisible. Depth-first: descend into claimed groups, strip any group at any
            // depth whose subtree holds no claimed name, or that repeats an already-seen name
            // (the engine resolves names first-match, so the kept copy is the one it uses).
            const seenNames = new Set();
            const orphans = [];
            const visit = (g) => {
                [...g.children].forEach(ch => {
                    if (ch.isMesh) return; // a kept group's meshes belong to it
                    const names = [];
                    ch.traverse(n => { if (n.name) names.push(n.name); });
                    const isClaimed = names.some(n => claimed.has(n));
                    const isDupe = ch.name && seenNames.has(ch.name);
                    if (!isClaimed || isDupe) { orphans.push(ch); return; }
                    if (ch.name) seenNames.add(ch.name);
                    visit(ch);
                });
            };
            visit(root);
            if (!orphans.length) { alert('🧹 Nothing to strip — every group in the .glb belongs to a section.'); setAssignBusy(false); return; }
            if (!window.confirm(`🧹 Remove ${orphans.length} unclaimed/duplicate group(s) from the .glb?\n\n${orphans.slice(0, 12).map(o => '• ' + (o.name || '(unnamed)')).join('\n')}${orphans.length > 12 ? '\n…' : ''}\n\nThese belong to NO section (deleted records, failed uploads, or later same-named twins) — in the CPQ they render permanently because nothing controls them. The current .glb is kept as the backup (↩ restorable).`)) { setAssignBusy(false); return; }
            orphans.forEach(o => o.removeFromParent());
            addLog('Re-exporting the cleaned .glb… (the tab may freeze for a moment)', 'info');
            await new Promise(res => setTimeout(res, 60));
            const glbBuffer = await new Promise((res, rej) => new GLTFExporter().parse(scene, out => res(out), e => rej(e), { binary: true }));
            const blob = new Blob([glbBuffer], { type: 'model/gltf-binary' });
            const path = `assemblies/${activeBrand}_${String(data.itemName || 'asm').replace(/[^a-z0-9]/gi, '_')}_orphanstrip_${Date.now()}.glb`;
            const up = uploadBytesResumable(sRef(storage, path), blob);
            let lastPct = 0;
            const newCadUrl = await new Promise((res, rej) => up.on('state_changed', (s) => {
                const pct = Math.round((s.bytesTransferred / s.totalBytes) * 100);
                if (pct - lastPct >= 25 || (pct === 100 && lastPct < 100)) { lastPct = pct; addLog(`Uploading the cleaned .glb (${(s.totalBytes / 1048576).toFixed(1)} MB)… ${pct}%`, 'info'); }
            }, rej, async () => res(await getDownloadURL(up.snapshot.ref))));
            await updateDoc(dref, { 'manufacturingSpecs.cadUrl': newCadUrl, 'manufacturingSpecs.cadUrlBackup': cadUrl, updatedAt: Date.now() });
            addLog(`🧹 Stripped ${orphans.length} unclaimed group(s) — the .glb is back to exactly what the sections claim. Reloading…`, 'success');
            alert(`🧹 Stripped ${orphans.length} unclaimed/duplicate group(s).\n\nThe .glb now contains exactly what the sections claim (old file kept as backup — ↩ restorable).\n\nOK reloads the choices list.`);
            setAssignBusy(false);
            await handleLoadChoices();
            return;
        } catch (e) {
            console.error('Orphan strip failed:', e);
            alert('Orphan strip failed: ' + (e.message || e));
        }
        setAssignBusy(false);
    };

    // ✎ RECLASSIFY A SECTION (Stuart 2026-08-15: "once selected at upload, i can't make a change
    // there" — the wood-rod slots came in as POLE·SHARED with no way to make them the LEFT/RIGHT
    // halves). Rewrites the cluster's category/position on the assembly record; the pins stay
    // linked (they key by clusterId — the generator reads placement from the CLUSTER at generate
    // time), so a flow Regenerate is all that's needed afterwards.
    const reclassSection = async (r, patch) => {
        if (!assignId) return;
        const next = { category: patch.category !== undefined ? patch.category : (r.category || ''), position: patch.position !== undefined ? patch.position : (r.position || '') };
        if (!window.confirm(`✎ Reclassify "${r.clusterName}"?\n\n${r.category || '—'} · ${r.position || 'shared'}  →  ${next.category || '—'} · ${next.position || 'shared'}\n\nThe section's ${r.choices.length} choice(s) and pins stay linked — REGENERATE the flow afterwards to apply.`)) return;
        setAssignBusy(true);
        try {
            const dref = doc(db, 'Approved_Designs', assignId);
            const data = (await getDoc(dref)).data() || {};
            await updateDoc(dref, { nodeClusters: (data.nodeClusters || []).map(cl => cl.id === r.clusterId ? { ...cl, ...patch } : cl), updatedAt: Date.now() });
            addLog(`✎ "${r.clusterName}" reclassified → ${next.category || '—'} · ${next.position || 'shared'}. REGENERATE the flow to apply.`, 'success');
            await handleLoadChoices();
        } catch (e) {
            console.error('Reclassify failed:', e);
            alert('Reclassify failed: ' + (e.message || e));
        }
        setAssignBusy(false);
    };

    // 2D tear-sheet section: add a blank choice row (name + item # typed by the operator; the
    // synthetic 2D__ choiceNode is its stable id — pins/BOM/generator read it like any node name).
    const addChoice2d = (clusterId) => {
        setAssignData(prev => prev ? {
            ...prev,
            rows: prev.rows.map(r => r.clusterId === clusterId ? {
                ...r,
                choices: [...r.choices, { nodeName: sheet2dChoiceNode(clusterId, Date.now() % 1000000), label: '', itemNo: '', imgUrl: '', endTreatment: '', isFee: false, isHidden: false, parked: false, isBasic: false, usesReturnPlates: false, isReturnArm: false, returnOnly: false, inlineOnly: false, isCollar: false, requiresCollar: '', projInches: '', mountType: '', catOverride: '', custIds: [], custNames: [], traverseRole: '', driveType: '', trvSetup: '', alwaysShown: false, note: '', thumb: '' }],
            } : r),
        } : prev);
    };

    const handleLoadChoices = async () => {
        if (!assignId) return alert('Pick an assembly.');
        setAssignBusy(true);
        try {
            const snap = await getDoc(doc(db, 'Approved_Designs', assignId));
            const data = snap.data() || {};
            const cadUrl = data.manufacturingSpecs?.cadUrl;
            const clusters = data.nodeClusters || [];
            // ── 2D TEAR-SHEET PATH (Stuart 2026-08-14, M2C lighting): no .glb — rows come from the
            // drawn region clusters, choices are the region's pins + operator-added rows (➕ choice).
            // Pins save through the exact same writer below; synthetic 2D__ node ids never go stale.
            if (!cadUrl && data.manufacturingSpecs?.sheet2d?.url) {
                const pinSnap2 = await getDocs(query(collection(db, 'assembly_pins'), where('assemblyId', '==', data.itemId || assignId)));
                const byCl2 = {};
                pinSnap2.docs.forEach(d => { const p = d.data(); if (p.clusterId) (byCl2[p.clusterId] = byCl2[p.clusterId] || []).push(p); });
                const index2 = await refreshCodeIndex().catch(() => null);
                const byItemId2 = new Map();
                (index2 || []).forEach(e => { if (e.itemId && e.erp && e.erp !== 'PENDING') byItemId2.set(e.itemId, e.erp); });
                const rows2 = clusters.filter(c => c.region2d && !c.hidden).map(cl => {
                    const pins2 = (byCl2[cl.id] || []).sort((a, b) => ((a.choiceSort ?? 1e9) - (b.choiceSort ?? 1e9)));
                    const choices = pins2.map(pin => {
                        const synthetic = /^(HIDDEN|FEE)-/.test(String(pin?.partId || ''));
                        let itemNo = '';
                        if (pin.isFee) itemNo = pin.feeItemNo || (!synthetic && pin.partId ? pin.partId : '');
                        else {
                            const liveErp = byItemId2.get(pin.partId) || '';
                            if (liveErp) itemNo = liveErp;
                            else if (pin.legacyErpId && !['N/A', 'PENDING'].includes(pin.legacyErpId) && pin.legacyErpId !== pin.partId) itemNo = pin.legacyErpId;
                            else if (!synthetic && pin.partId && !/-\d{12,}/.test(String(pin.partId))) itemNo = pin.partId;
                        }
                        return { nodeName: pin.choiceNode, label: pin.partName || '', itemNo, imgUrl: pin.imageUrl || '', endTreatment: '', isFee: !!pin.isFee, isHidden: !!pin.isHiddenPart && !pin.parked, parked: !!pin.parked, isBasic: false, usesReturnPlates: false, isReturnArm: false, returnOnly: false, inlineOnly: false, isCollar: false, requiresCollar: '', projInches: '', mountType: '', catOverride: '', custIds: pin.customerIds || [], custNames: pin.customerNames || [], traverseRole: '', driveType: '', trvSetup: '', alwaysShown: !!pin.alwaysShown, note: pin.designerNote || '', thumb: '' };
                    });
                    return { clusterId: cl.id, clusterName: cl.name, category: (cl.category || '').toUpperCase(), position: (cl.position || '').toUpperCase(), found: true, is2d: true, choices };
                });
                assignSceneRef.current = null;
                setAssignModelInfo({ docId: assignId, itemId: data.itemId || assignId, cadFile: '2D tear sheet (no .glb)' });
                setAssignData({ asmId: data.itemId || assignId, asmName: data.itemName || assignId, rows: rows2 });
                addLog(`Loaded ${rows2.length} tear-sheet section(s), ${rows2.reduce((s, r) => s + r.choices.length, 0)} choice(s) from "${data.itemName}" — 2D mode: ➕ choice on a section header adds an option (name + item #), then Save Assignments as usual.`, 'success');
                setAssignBusy(false);
                return;
            }
            if (!cadUrl) throw new Error('This assembly has no .glb (cadUrl).');
            addLog('⏳ Loading choices — downloading the .glb…', 'info');
            await new Promise(res => setTimeout(res, 60));
            const buf = await (await fetch(cadUrl)).arrayBuffer();
            const gltf = await new Promise((res, rej) => loaderRef.current.parse(buf, '', res, rej));
            const scene = gltf.scene;
            // Prefill from any existing pins (keyed by choiceNode).
            const pinSnap = await getDocs(query(collection(db, 'assembly_pins'), where('assemblyId', '==', data.itemId || assignId)));
            const pinByNode = {}; pinSnap.docs.forEach(d => { const p = d.data(); if (p.choiceNode) pinByNode[p.choiceNode] = p; });
            const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
            const findGrp = (cl) => {
                // Meshes are allowed matches: a 1-node cluster created in 1.5 (a pole half, a french-return
                // bend) resolves to a leaf MESH, not a group — skipping meshes made those clusters vanish
                // from this tool entirely. Parent-first traversal + strict > keeps wrappers winning when
                // both a group and its mesh match.
                let g = scene.getObjectByName((cl.nodes && cl.nodes[0]) || cl.name) || scene.getObjectByName(cl.name);
                if (!g) { const wants = new Set([norm(cl.nodes && cl.nodes[0]), norm(cl.name)].filter(Boolean)); scene.traverse(n => { if (!g && wants.has(norm(n.name))) g = n; }); }
                // Last resort: the scene node whose subtree contains the most of this cluster's node names.
                if (!g) { const want = new Set((cl.nodes || []).map(norm)); let best = null, bestScore = 0; scene.traverse(n => { let sc = 0; n.traverse(d => { if (want.has(norm(d.name))) sc++; }); if (sc > bestScore) { bestScore = sc; best = n; } }); if (bestScore > 0) g = best; }
                return g;
            };
            // Auto-match: existing pin wins, else derive the item # from the node name against the
            // Master Library ("<ITEM#> <POSITION>" naming). Hardware matches nothing → stays blank.
            // FRESH fetch (Load Choices is a user action): a just-created alias must show up here.
            const index = await refreshCodeIndex().catch(() => null);
            // Live translation itemId → CURRENT ERP code, so linked pins always display the record's
            // item # even when the pin's stored legacyErpId predates the code being assigned.
            const byItemId = new Map();
            (index || []).forEach(e => { if (e.itemId && e.erp && e.erp !== 'PENDING') byItemId.set(e.itemId, e.erp); });
            let matched = 0;
            // Auto-expand to wherever pins were SAVED: if a wrapper was split and its children pinned,
            // re-listing the unsplit wrapper would show blank rows and look like the work was lost
            // (the pins are in the DB, just not displayed). Descend until each leaf either carries a
            // pin itself or has no pinned descendants.
            const pinnedUnder = (node) => { let hit = false; node.traverse(d => { if (d !== node && pinByNode[d.name]) hit = true; }); return hit; };
            const leafNames = (node) => (pinByNode[node.name] || !pinnedUnder(node)) ? [node.name] : (node.children || []).filter(c => c.name).flatMap(leafNames);
            const skippedHusks = [], skippedExcluded = [];
            const rows = clusters.map(cl => {
                const grp = findGrp(cl);
                let kids = grp ? (grp.children || []).filter(c => c.name).flatMap(leafNames) : [];
                // Single-node cluster (1.5-created pole half / bend / bushing): the matched node IS the
                // one choice — without this the row had zero choices and was hidden from the list.
                if (grp && !kids.length && grp.name) kids = [grp.name];
                // ⛔ THE ROWS COME FROM THE SCENE, NOT THE CLUSTER RECORD (Stuart 2026-08-10, the
                // CPQBrimar husk that "comes back every time"): deleting pins or pruning the record
                // never stopped a name that lives in the .glb from re-listing here. Filter at the
                // actual source — the scene walk. Two rules, PINNED NAMES ALWAYS LIST (pins must
                // stay visible/deletable; ✗ chip + rebind manage broken ones):
                // (1) a name 🗑-excluded on the cluster record stays gone across every Load;
                // (2) an unpinned name with NO mesh anywhere beneath it is an empty husk baked in
                //     by a whole-assembly export — it can never render and never was a choice.
                const excluded = new Set(cl.excludedNodes || []);
                kids = kids.filter(nm => {
                    if (pinByNode[nm]) return true;
                    if (excluded.has(nm)) { skippedExcluded.push(nm); return false; }
                    const nd = grp ? (grp.getObjectByName(nm) || scene.getObjectByName(nm)) : scene.getObjectByName(nm);
                    let mesh = false; if (nd) nd.traverse(d => { if (d.isMesh) mesh = true; });
                    if (nd && !mesh) { skippedHusks.push(nm); return false; }
                    return true;
                });
                const isEndCluster = normalizeCategory(cl.category) === 'FINIAL';
                const choices = kids.map(nm => {
                    const label = choiceLabel(nm);
                    const pin = pinByNode[nm];
                    const flagged = !!(pin?.isFee || pin?.isHiddenPart);
                    // Display the ERP code (a linked pin's partId is the library itemId, not the code).
                    // Hidden pins CAN carry a real item # (BOM-included hardware) — show it; only the
                    // synthetic HIDDEN-/FEE- placeholder ids stay blank.
                    // Chain: (1) LIVE library — pin.partId (itemId) → that part's current ERP code;
                    // (2) the pin's stored legacyErpId when it's a real code (not N/A/PENDING and not
                    // the internal id echoed back); (3) typed-code pins (partId IS the code, no
                    // timestamp tail); else blank → node-name auto-match fills it. NEVER the app
                    // internal id — it looked wrong and re-linked wrong.
                    const synthetic = /^(HIDDEN|FEE)-/.test(String(pin?.partId || ''));
                    let itemNo = '';
                    // 🩹 A FEE PIN LOST ITS TYPED CODE ON EVERY RELOAD (Stuart 2026-08-04: "if i leave
                    // the fee checked it erases my saved id... it losses it over and over").
                    // The SAVE was always right — a fee with an item # stores partId = that code. The
                    // RELOAD skipped fees entirely, so the box came back empty; saving again from that
                    // empty state then rewrote partId as the synthetic FEE-<slug> and the real code was
                    // gone for good. The `!pin.isFee` guard exists to stop a fee auto-matching some
                    // library part by NAME — it was never meant to discard the code the operator typed.
                    // (`flagged` already blocks the name auto-match below, so reading it back is safe.)
                    if (pin && pin.isFee) {
                        // Its own field first; partId only if it was not clobbered into FEE-<slug>.
                        itemNo = pin.feeItemNo || (!synthetic && pin.partId ? pin.partId : '');
                    } else if (pin && !pin.isFee) {
                        const liveErp = byItemId.get(pin.partId) || '';
                        if (liveErp) itemNo = liveErp;
                        else if (pin.legacyErpId && !['N/A', 'PENDING'].includes(pin.legacyErpId) && pin.legacyErpId !== pin.partId) itemNo = pin.legacyErpId;
                        else if (!synthetic && pin.partId && pin.legacyErpId === pin.partId && !/-\d{12,}/.test(pin.partId)) itemNo = pin.partId;
                    }
                    if (!itemNo && !flagged && index) { const m = matchItemByName(label, index, normalizeCategory(cl.category) || cl.category); if (m) { itemNo = m.code; matched++; } }
                    // endTreatment: saved pin tag wins; unsaved end-cluster rows seed from the name.
                    const et = pin?.endTreatment || (isEndCluster ? (suggestTagsFromName(label).endTreatment || 'FINIAL') : '');
                    // 1.5 cluster flags SEED the checkboxes when the pin doesn't carry them yet (returnOnly on
                    // BACKPLATE clusters, isReturnArm on BRACKET clusters) — tagging in Node Grouping shows up
                    // here automatically; saving stamps it onto the pins so both stay in sync.
                    // A PARKED pin reloads as a plain blank choice (⏸ hint shows) — NOT as HIDE-checked,
                    // otherwise assigning its item # later would save it as a hidden BOM part.
                    return { nodeName: nm, label, itemNo, endTreatment: et, isFee: !!pin?.isFee, isHidden: !!pin?.isHiddenPart && !pin?.parked, parked: !!pin?.parked, isBasic: !!pin?.isBasic, usesReturnPlates: !!(pin?.usesReturnPlates || cl.usesReturnPlates), isReturnArm: !!(pin?.isReturnArm || cl.isReturnArm), returnOnly: !!(pin?.returnOnly || cl.returnOnly), inlineOnly: !!(pin?.inlineOnly || cl.inlineOnly), isCollar: !!pin?.isCollar, requiresCollar: pin?.requiresCollar || '', projInches: pin?.projInches || '', mountType: pin?.mountType || '', catOverride: pin?.catOverride || '', custIds: pin?.customerIds || [], custNames: pin?.customerNames || [], traverseRole: pin?.traverseRole || '', driveType: pin?.driveType || '', trvSetup: pin?.trvSetup || suggestSetupFromName(label, itemNo, nm), alwaysShown: !!pin?.alwaysShown, note: pin?.designerNote || '', thumb: '' };
                });
                // Restore the saved arrow order (unsaved rows keep file order after the sorted ones).
                choices.sort((a, b) => (pinByNode[a.nodeName]?.choiceSort ?? 1e9) - (pinByNode[b.nodeName]?.choiceSort ?? 1e9));
                return {
                    clusterId: cl.id, clusterName: cl.name, category: (cl.category || '').toUpperCase(), position: (cl.position || '').toUpperCase(),
                    found: !!grp,
                    choices
                };
            });
            assignSceneRef.current = scene;
            // Identity line for the fork check (Brimar 2026-08-10): WHICH doc + WHICH .glb this
            // pass is editing — compared against CPQ's strip, a mismatch = the flow links another
            // record entirely, and no amount of Load Choices here can affect what CPQ renders.
            setAssignModelInfo({ docId: assignId, itemId: data.itemId || assignId, cadFile: String(cadUrl).split('/').pop().split('?')[0] });
            setAssignData({ asmId: data.itemId || assignId, asmName: data.itemName || assignId, rows });
            const missing = rows.filter(r => !r.found).length;
            addLog(`Loaded ${rows.length} cluster(s), ${rows.reduce((s, r) => s + r.choices.length, 0)} choice node(s) from "${data.itemName}" — ${matched} item #(s) auto-matched from node names.${missing ? ` ⚠ ${missing} cluster(s) had no group match.` : ''}`, missing ? 'error' : 'success');
            if (skippedHusks.length) addLog(`⛔ ${skippedHusks.length} empty named husk(s) NOT listed — names in the .glb with no geometry inside (whole-assembly-export artifacts): ${skippedHusks.slice(0, 8).join(', ')}${skippedHusks.length > 8 ? ` +${skippedHusks.length - 8} more` : ''}. They can never render; they are not choices.`, 'error');
            if (skippedExcluded.length) addLog(`🗑 ${skippedExcluded.length} previously deleted node(s) stayed deleted: ${skippedExcluded.slice(0, 8).join(', ')}${skippedExcluded.length > 8 ? ` +${skippedExcluded.length - 8} more` : ''}.`, 'info');
            genThumbs(rows.flatMap(r => r.choices.map(c => c.nodeName)), ++assignGenRef.current);
            if (missing) addLog(`Scene top nodes: ${(scene.children || []).flatMap(c => [c.name, ...(c.children || []).map(k => k.name)]).filter(Boolean).slice(0, 24).join(' | ')}`, 'info');
        } catch (e) { console.error(e); addLog(`Load choices failed: ${e.message || e}`, 'error'); alert('Load failed:\n\n' + (e.message || e)); }
        setAssignBusy(false);
    };
    // Patch one choice by (clusterId, nodeName) — name-keyed so rows stay correct after a split
    // reshuffles indices.
    // Scene membership + rebind candidates for the ✗ not-in-model picker. Candidates = named
    // top-level scene nodes (and their direct children) not already claimed by any row's choice.
    const nodeMissing = (nm) => {
        const scene = assignSceneRef.current;
        if (!scene || !nm) return false;
        // Mesh-aware, matching Save's reconciliation: a named husk with no geometry inside
        // counts as MISSING (it can never render), so the ✗ chip and the strip agree.
        let hit = false;
        scene.traverse(nd => { if (!hit && nd.isMesh) { let a = nd; while (a && !hit) { if (a.name === nm) hit = true; a = a.parent; } } });
        return !hit;
    };
    const rebindCandidates = () => {
        const scene = assignSceneRef.current;
        if (!scene) return [];
        const claimed = new Set();
        (assignData?.rows || []).forEach(rr => rr.choices.forEach(ch => claimed.add(ch.nodeName)));
        const out = [];
        (scene.children || []).forEach(top => {
            if (top.name && !claimed.has(top.name)) out.push(top.name);
            (top.children || []).forEach(kid => { if (kid.name && !claimed.has(kid.name)) out.push(kid.name); });
        });
        return out.sort();
    };
    const setChoicePatch = (clusterId, nodeName, patch) => setAssignData(prev => prev ? { ...prev, rows: prev.rows.map(r => r.clusterId !== clusterId ? r : { ...r, choices: r.choices.map(c => c.nodeName === nodeName ? { ...c, ...patch } : c) }) } : prev);

    // Reorder a choice within its cluster (▲▼). The order is saved as choiceSort and drives the
    // generated option order, so Left/Right sides can be made to list identically.
    const moveChoice = (clusterId, nodeName, dir) => setAssignData(prev => {
        if (!prev) return prev;
        return {
            ...prev,
            rows: prev.rows.map(r => {
                if (r.clusterId !== clusterId) return r;
                const i = r.choices.findIndex(c => c.nodeName === nodeName);
                const j = i + dir;
                if (i < 0 || j < 0 || j >= r.choices.length) return r;
                const choices = [...r.choices];
                [choices[i], choices[j]] = [choices[j], choices[i]];
                return { ...r, choices };
            })
        };
    });

    // 🗑 Delete a choice = purge its PIN DOCS (Stuart 2026-07-24: a node once saved with a junk
    // item # — e.g. partId 'H205IMRIGHT', its own node name — keeps its stale pin doc even after
    // the row is blanked/parked on a later save, and the flow generator keeps fanning the stale
    // pin out as a CPQ option; the designer should NOT have to re-upload the GLB). Removes EVERY
    // assembly_pins doc for this node, matched by the SAME identity the reload (pinByNode) and
    // the save-sync (byNode) use — assemblyId query + exact choiceNode — deliberately NOT
    // filtered by clusterId, so a stray doc left under a re-created/old cluster id (which Load
    // Choices would still display via pinByNode) dies too. The 3D node stays in the file; Load
    // Choices lists it again as a blank row while the geometry exists.
    const deleteChoice = async (clusterId, nodeName, label, itemNo) => {
        if (!assignData || assignBusy) return;
        if (!window.confirm(`Delete choice "${label || nodeName}"?\n\nNode: ${nodeName}\nItem #: ${itemNo && itemNo.trim() ? itemNo.trim() : '— none —'}\n\nThis removes EVERY saved pin for this node (including stale ones with junk item #s) so it can never appear in a generated flow. The 3D node stays in the file — Load Choices will list it again as a blank row if the geometry still exists.`)) return;
        setAssignBusy(true);
        try {
            const snap = await getDocs(query(collection(db, 'assembly_pins'), where('assemblyId', '==', assignData.asmId)));
            const victims = snap.docs.filter(d => d.data().choiceNode === nodeName);
            for (const v of victims) await deleteDoc(v.ref);
            const ids = [...new Set(victims.map(v => v.data().partId).filter(Boolean))].join(', ');
            // KILL THE RESURRECTION LOOP (Stuart 2026-08-10: 'the delete tool for the parked
            // CPQBrimar row comes back every time'). Deleting pins alone left the CLUSTER record —
            // Load Choices re-listed it as a blank row, and Save re-parked it, forever. When this
            // was the row's LAST choice, remove the cluster record itself (the geometry stays in
            // the .glb, unreferenced by any option or hide list).
            const row = assignData.rows.find(r => r.clusterId === clusterId);
            const lastChoice = row && row.choices.length === 1 && row.choices[0].nodeName === nodeName;
            let nodeDropped = false;
            if (lastChoice && window.confirm(`Also remove the cluster record "${row.clusterName}"?\n\nWithout this, Load Choices lists the node again as a blank row (and Save re-parks it). The geometry stays in the .glb — it just stops being a choice anywhere.`)) {
                const asnap = await getDoc(doc(db, 'Approved_Designs', assignId));
                const adata = asnap.data() || {};
                await updateDoc(doc(db, 'Approved_Designs', assignId), { nodeClusters: (adata.nodeClusters || []).filter(cl => cl.id !== clusterId), updatedAt: Date.now() });
                addLog(`🗑 Cluster record "${row.clusterName}" removed — the node stops being a choice.`, 'success');
                nodeDropped = true;
            } else if (!lastChoice && row && !victims.length) {
                // PINLESS choice in a MULTI-node cluster (Stuart 2026-08-10, the CPQBrimar husk):
                // no pins to delete and the cluster survives (other choices), so the delete did
                // NOTHING. Load Choices lists rows FROM THE SCENE, so pruning the record's nodes
                // list alone can't stop the re-listing (the first shipped fix proved that) — the
                // name must go on the cluster's excludedNodes list, which the Load-time scene walk
                // honors. Pruning nodes[] too keeps the generator's mapping clean.
                if (window.confirm(`No saved pins existed for "${label || nodeName}" — deleting pins alone changes nothing.\n\nRemove the NODE as a choice of "${row.clusterName}"?\n\nIt goes on the cluster's exclusion list — Load Choices stops listing it, permanently. The geometry (if any) stays in the .glb.`)) {
                    const asnap = await getDoc(doc(db, 'Approved_Designs', assignId));
                    const adata = asnap.data() || {};
                    await updateDoc(doc(db, 'Approved_Designs', assignId), {
                        nodeClusters: (adata.nodeClusters || []).map(cl => cl.id !== clusterId ? cl : { ...cl, nodes: (cl.nodes || []).filter(n => n !== nodeName), excludedNodes: [...new Set([...(cl.excludedNodes || []), nodeName])] }),
                        updatedAt: Date.now()
                    });
                    addLog(`🗑 Node "${nodeName}" excluded from cluster "${row.clusterName}" — Load Choices stops listing it.`, 'success');
                    nodeDropped = true;
                }
            }
            setAssignData(prev => prev ? { ...prev, rows: prev.rows.map(r => r.clusterId !== clusterId ? r : { ...r, choices: r.choices.filter(c => c.nodeName !== nodeName) }) } : prev);
            addLog(`🗑 Deleted ${victims.length} pin doc(s) for node "${nodeName}"${ids ? ` (partId: ${ids})` : ''}.`, 'success');
            alert(victims.length
                ? `🗑 Deleted ${victims.length} saved pin doc(s) for node "${nodeName}"${ids ? `\n(partId: ${ids})` : ''}.\n\nNow REGENERATE the CPQ flow (System Admin → the flow → "Regenerate Steps from Tags") — this option disappears from the generated steps.`
                : nodeDropped
                    ? `🗑 Node "${nodeName}" is no longer a choice — it was removed from the cluster record. Load Choices will NOT list it again.`
                    : `No saved pin docs existed for node "${nodeName}" — nothing was in the database. The row is removed from this list; Load Choices will list it again while the geometry exists.`);
        } catch (e) { console.error(e); addLog(`Delete choice failed: ${e.message || e}`, 'error'); alert('Delete failed:\n\n' + (e.message || e)); }
        setAssignBusy(false);
    };

    // Sequential thumbnail renderer (each snapshot opens+closes its own GL context; 448px source is
    // crisp enough for the click-to-zoom overlay at 44px display). Keyed by nodeName so in-flight
    // results land correctly even after splits; isCancelled aborts a superseded run.
    const snapThumbSeq = (scene, nodeNames, isCancelled, apply) => {
        (async () => {
            for (const nm of nodeNames) {
                if (isCancelled()) return;
                try {
                    const g = isolateCluster(scene, [nm]);
                    if (!g.children.length) continue;
                    const blob = await snapshotPNG(g, 448);
                    const thumbUrl = URL.createObjectURL(blob);
                    if (isCancelled()) { URL.revokeObjectURL(thumbUrl); return; }
                    apply(nm, thumbUrl);
                } catch { /* a node with no snapshot just keeps its placeholder */ }
            }
        })();
    };
    const genThumbs = (nodeNames, gen) => {
        const scene = assignSceneRef.current;
        if (!scene) return;
        snapThumbSeq(scene, nodeNames, () => assignGenRef.current !== gen, (nm, thumbUrl) =>
            setAssignData(prev => prev ? { ...prev, rows: prev.rows.map(r => ({ ...r, choices: r.choices.map(c => c.nodeName === nm ? { ...c, thumb: thumbUrl } : c) })) } : prev));
    };
    // Slot-uploader thumbnails: same renderer, applied to a layer's choices (per-slot generation
    // counter so re-uploading a slot cancels its older run).
    const slotGenRef = useRef({});
    const genSlotThumbs = (slotId, scene, nodeNames) => {
        const gen = (slotGenRef.current[slotId] || 0) + 1;
        slotGenRef.current[slotId] = gen;
        snapThumbSeq(scene, nodeNames, () => slotGenRef.current[slotId] !== gen, (nm, thumbUrl) =>
            setLayers(prev => prev[slotId] ? { ...prev, [slotId]: { ...prev[slotId], choices: prev[slotId].choices.map(c => c.nodeName === nm ? { ...c, thumb: thumbUrl } : c) } } : prev));
    };

    // SPLIT a choice that's really several items merged under one wrapper node (e.g. a whole stack of
    // backplates exported as one root): replace the row with the wrapper's named child nodes, each its
    // own choice with auto-match + thumbnail. Client-side only until Save.
    const splitChoice = (clusterId, nodeName) => {
        const scene = assignSceneRef.current;
        if (!scene) return alert('Load choices first.');
        const node = scene.getObjectByName(nodeName);
        const kids = node ? (node.children || []).map(c => c.name).filter(Boolean) : [];
        if (!kids.length) return alert('This node has no named sub-parts to split into — it is a single mesh.\n\nTWO-PART FINIALS (collar + acrylic top): the seam must come from the FILE — have the designer model the collar and the top as TWO SEPARATE COMPONENTS in Fusion, each named its own item code (component names ARE the codes). Re-export/upload and both pieces list here as their own choices — no split needed.');
        const index = codeIndexRef.current?.brand === activeBrand ? codeIndexRef.current.index : null;
        setAssignData(prev => prev ? {
            ...prev,
            rows: prev.rows.map(r => r.clusterId !== clusterId ? r : {
                ...r,
                choices: r.choices.flatMap(c => c.nodeName !== nodeName ? [c] : kids.map(nm => {
                    const label = choiceLabel(nm);
                    const m = index ? matchItemByName(label, index) : null;
                    const et = normalizeCategory(r.category) === 'FINIAL' ? (suggestTagsFromName(label).endTreatment || 'FINIAL') : '';
                    return { nodeName: nm, label, itemNo: m ? m.code : '', endTreatment: et, isFee: et === 'FRENCH_RETURN' || et === 'MITER_RETURN', isHidden: false, isBasic: false, usesReturnPlates: false, isReturnArm: false, returnOnly: false, inlineOnly: false, isCollar: false, requiresCollar: '', projInches: '', mountType: '', catOverride: '', custIds: [], custNames: [], traverseRole: '', driveType: '', trvSetup: '', alwaysShown: false, note: '', thumb: '' };
                }))
            })
        } : prev);
        addLog(`Split "${choiceLabel(nodeName)}" into ${kids.length} sub-part(s).`, 'info');
        genThumbs(kids, assignGenRef.current);
    };
    // ⛔ A PIN ID MUST BE UNIQUE PER CHOICE, NOT PER ITEM # (Stuart 2026-08-04: "the fees are again
  // gone after save", after two earlier fixes that were both looking in the wrong place).
  //
  // The id was `PIN-<asm>-<cluster>-<partId>`. His three miter-return choices in ONE cluster all
  // carry the SAME code (H1-2TRVMTR — one fee item, three arm lengths), so all three resolved to
  // the SAME document: each setDoc overwrote the last and only the final choice kept a pin. Reload
  // indexes pins BY CHOICE NODE, so the other two came back blank — "gone", over and over.
  //
  // Nothing about fees caused this. A fee is simply where it surfaces first, because a fee code is
  // the one thing several choices legitimately share. The node name now goes into the id, so two
  // choices can never collide. Old ids self-heal: the delete pass removes any pin on this node
  // whose id is not the new one.
  const pinIdFor = (asmId, clusterId, partId, nodeName) => {
      const node = String(nodeName || '');
      let h = 0; for (let i = 0; i < node.length; i++) { h = (h * 31 + node.charCodeAt(i)) | 0; }
      return `PIN-${asmId}-${clusterId}-${partId}-${Math.abs(h).toString(36).slice(0, 6)}`.replace(/[^A-Za-z0-9-]/g, '_');
  };

  // ⇄ SIDE SWAP (Brimar 2026-08-10: the beveled end cap rendered on the RIGHT when picked on the
  // LEFT — its L/R clusters carry each other's nodes, v4001↔v4, the inverse of every working twin).
  // Swaps the geometry records between a LEFT/RIGHT pair: cluster node lists, their pins, and the
  // on-screen rows. Self-contained — regenerate the flow afterwards.
  const twinOf = (r) => {
      const pos = String(r.position || '').toUpperCase();
      if (pos !== 'LEFT' && pos !== 'RIGHT') return null;
      const want = pos === 'LEFT' ? 'RIGHT' : 'LEFT';
      const base = (nm) => String(nm || '').toUpperCase().replace(/\b(LEFT|RIGHT)\b/g, '').replace(/\s+/g, ' ').trim();
      return (assignData?.rows || []).find(x => x.clusterId !== r.clusterId
          && String(x.position || '').toUpperCase() === want && base(x.clusterName) === base(r.clusterName)) || null;
  };
  const swapSides = async (r) => {
      const twin = twinOf(r);
      if (!twin) return;
      if (r.choices.length !== twin.choices.length) return alert(`Can't auto-swap: "${r.clusterName}" has ${r.choices.length} node(s) and "${twin.clusterName}" has ${twin.choices.length} — pair them up manually (⤢ split can help) first.`);
      if (!window.confirm(`⇄ Swap the geometry between "${r.clusterName}" and "${twin.clusterName}"?\n\nUse when LEFT and RIGHT render on each other's ends (the clusters carry each other's nodes). Swaps the cluster records and their pins, then REGENERATE the flow.`)) return;
      setAssignBusy(true);
      try {
          const snap = await getDoc(doc(db, 'Approved_Designs', assignId));
          const data = snap.data() || {};
          const nodesOfId = (id) => (data.nodeClusters || []).find(c => c.id === id)?.nodes || null;
          const rNodes = nodesOfId(r.clusterId), tNodes = nodesOfId(twin.clusterId);
          if (rNodes && tNodes) {
              await updateDoc(doc(db, 'Approved_Designs', assignId), {
                  nodeClusters: (data.nodeClusters || []).map(cl =>
                      cl.id === r.clusterId ? { ...cl, nodes: tNodes }
                      : cl.id === twin.clusterId ? { ...cl, nodes: rNodes } : cl),
                  updatedAt: Date.now(),
              });
          }
          // Pins: rewrite each side's pins onto the counterpart node (id embeds the node hash —
          // delete + recreate, same true-sync rule as Save).
          const pairs = new Map();
          r.choices.forEach((c, i) => { pairs.set(c.nodeName, twin.choices[i].nodeName); pairs.set(twin.choices[i].nodeName, c.nodeName); });
          const pinSnap2 = await getDocs(query(collection(db, 'assembly_pins'), where('assemblyId', '==', assignData.asmId)));
          for (const d of pinSnap2.docs) {
              const p = d.data();
              if ((p.clusterId === r.clusterId || p.clusterId === twin.clusterId) && pairs.has(p.choiceNode)) {
                  const newNode = pairs.get(p.choiceNode);
                  const pid = pinIdFor(assignData.asmId, p.clusterId, p.partId, newNode);
                  await deleteDoc(d.ref);
                  await setDoc(doc(db, 'assembly_pins', pid), { ...p, id: pid, choiceNode: newNode, targetNode: newNode });
              }
          }
          setAssignData(prev => prev ? { ...prev, rows: prev.rows.map(x =>
              x.clusterId === r.clusterId ? { ...x, choices: x.choices.map((c, i) => ({ ...c, nodeName: twin.choices[i].nodeName })) }
              : x.clusterId === twin.clusterId ? { ...x, choices: x.choices.map((c, i) => ({ ...c, nodeName: r.choices[i].nodeName })) } : x) } : prev);
          addLog(`⇄ Swapped geometry: "${r.clusterName}" ↔ "${twin.clusterName}".`, 'success');
          alert(`⇄ Swapped. Now REGENERATE the flow (System Admin → Regenerate Steps from Tags) — the sides render where they're picked.`);
      } catch (e) { console.error(e); alert('Swap failed:\n\n' + (e.message || e)); }
      setAssignBusy(false);
  };

  const handleSaveItemNumbers = async () => {
        if (!assignData) return;
        setAssignBusy(true);
        try {
            // True SYNC, not append-only: the pin doc id embeds the partId, so renumbering a choice
            // would otherwise leave the old pin behind (stale duplicates that confuse the generator
            // and the next Load Choices). Fetch what exists, delete anything superseded or cleared.
            const pinSnap = await getDocs(query(collection(db, 'assembly_pins'), where('assemblyId', '==', assignData.asmId)));
            const byNode = {}; pinSnap.docs.forEach(d => { const p = d.data(); if (p.choiceNode) (byNode[p.choiceNode] = byNode[p.choiceNode] || []).push({ ref: d.ref, docId: d.id }); });
            // ── RECONCILE NODE RECORDS AGAINST THE LIVE MODEL (Brimar 2026-08-10: 25 stale
            // 'body…' names survived Load Choices → Save → Regenerate, and the new elbow never
            // rendered). Load Choices fixed PINS; the stale names live in the CLUSTER node lists,
            // which nothing rewrote — and the single-choice generator path emits cl.nodes, so they
            // re-entered every regenerate. The assign pass already holds the loaded scene: correct
            // every recorded name against it — exact match kept, else matched by LEAF label (the
            // re-export renamed S<n>-…__i_<leaf> wrappers), else DROPPED from the record and named
            // in the save alert. After this save, the flow can only reference real geometry.
            const scene = assignSceneRef.current;
            let renamed = 0, droppedStale = []; let reconStatus = 'ran';
            if (scene) {
                // MESH-AWARE (Brimar 2026-08-10, the 0/0-vs-25-missing paradox): the merged file
                // carries EMPTY named nodes — husks like body1 with no geometry inside — so a
                // name-presence check said 'all fine' while CPQ (which only counts nodes that
                // actually contain meshes) said 'not found'. A recorded name now exists only if
                // its subtree holds at least one mesh; husks reconcile away like any stale name.
                const inScene = new Set();
                scene.traverse(nd => { if (nd.isMesh) { let a = nd; while (a) { if (a.name) inScene.add(a.name); a = a.parent; } } });
                const leafNorm = (s) => choiceLabel(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
                const byLeaf = new Map();
                inScene.forEach(nm => { const k = leafNorm(nm); if (k && !byLeaf.has(k)) byLeaf.set(k, nm); });
                const fix = (name) => { if (!name) return null; if (inScene.has(name)) return name; return byLeaf.get(leafNorm(name)) || null; };
                // Rows first — pins below are written from these names.
                assignData.rows.forEach(rr => rr.choices.forEach(ch => {
                    const fixed = fix(ch.nodeName);
                    if (fixed && fixed !== ch.nodeName) {
                        // Old-name pins must be swept by the true-sync delete under the NEW name.
                        (byNode[fixed] = byNode[fixed] || []).push(...(byNode[ch.nodeName] || []));
                        delete byNode[ch.nodeName];
                        ch.nodeName = fixed; renamed++;
                    }
                }));
                // Then the cluster RECORDS on the assembly doc.
                try {
                    const asnap = await getDoc(doc(db, 'Approved_Designs', assignId));
                    const adata = asnap.data() || {};
                    let patched = false;
                    const rowNodesByCluster = {};
                    assignData.rows.forEach(rr => rr.choices.forEach(ch => { (rowNodesByCluster[rr.clusterId] = rowNodesByCluster[rr.clusterId] || []).push(ch.nodeName); }));
                    const nextClusters = (adata.nodeClusters || []).map(cl => {
                        const fixedNodes = [];
                        (cl.nodes || []).forEach(nm => {
                            const f = fix(nm);
                            if (f) { if (!fixedNodes.includes(f)) fixedNodes.push(f); if (f !== nm) patched = true; }
                            else { droppedStale.push(nm); patched = true; }
                        });
                        // Rows are authoritative: a rebound choice's node joins its cluster record here.
                        (rowNodesByCluster[cl.id] || []).forEach(nm => { if (nm && inScene.has(nm) && !fixedNodes.includes(nm)) { fixedNodes.push(nm); patched = true; } });
                        return fixedNodes.length !== (cl.nodes || []).length || patched ? { ...cl, nodes: fixedNodes } : cl;
                    });
                    if (patched) await updateDoc(doc(db, 'Approved_Designs', assignId), { nodeClusters: nextClusters, updatedAt: Date.now() });
                } catch (reconErr) {
                    console.error('cluster reconciliation FAILED', reconErr);
                    addLog(`⚠ Node reconciliation FAILED: ${reconErr.message || reconErr} — the cluster records were NOT corrected; the flow will keep referencing stale names.`, 'error');
                    reconStatus = `FAILED — ${reconErr.message || reconErr}`;
                }
            }
            if (!scene) {
                // 2D tear-sheet assemblies have no scene and synthetic 2D__ node ids that never go
                // stale — reconciliation is a no-op, not a warning.
                if ((assignData.rows || []).some(rr => rr.is2d)) reconStatus = 'ran';
                else { addLog('⚠ Node reconciliation skipped — no loaded scene (run Load Choices first in this session).', 'error'); reconStatus = 'SKIPPED — no loaded scene'; }
            }
            let n = 0, fees = 0, hides = 0, removed = 0, parked = 0;
            for (const r of assignData.rows) {
                for (let idx = 0; idx < r.choices.length; idx++) {
                    const ch = r.choices[idx];
                    const hasItem = ch.itemNo && ch.itemNo.trim();
                    const existing = byNode[ch.nodeName] || [];
                    if (!hasItem && !ch.isFee && !ch.isHidden) {
                        if (looksRealPart(ch.label)) {
                            // ⏸ PARK (Stuart 2026-07-22): a real part with no item # yet (designer ↔
                            // IT/library timing) — held as a hidden geometry pin so the node vanishes
                            // from the model AND the flow until the # arrives. Load Choices keeps
                            // listing it; assigning the # later replaces this pin (true sync above).
                            const slugP = (ch.label || 'PART').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 18);
                            const partIdP = `HIDDEN-${slugP}`;
                            const pidP = pinIdFor(assignData.asmId, r.clusterId, partIdP, ch.nodeName);
                            for (const old of existing) { if (old.docId !== pidP) { await deleteDoc(old.ref); removed++; } }
                            await setDoc(doc(db, 'assembly_pins', pidP), { id: pidP, assemblyId: assignData.asmId, clusterId: r.clusterId, partId: partIdP, partName: ch.label || partIdP, defaultQty: 1, choiceNode: ch.nodeName, targetNode: ch.nodeName, choiceSort: idx, isHiddenPart: true, parked: true, ...(String(ch.note || '').trim() ? { designerNote: String(ch.note).trim() } : {}) });
                            parked++;
                            continue;
                        }
                        // Cleared back to blank (= hardware): remove any pin this node had.
                        for (const old of existing) { await deleteDoc(old.ref); removed++; }
                        continue;
                    }
                    // Hidden choice: force-hidden in every configuration (stray/duplicate geometry).
                    // Fee choice (e.g. a french-return bend): renders as a selectable option but bills
                    // as a fee, not a BOM item. Synthetic partIds keep the pin doc id unique.
                    const slug = (ch.label || 'PART').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 18);
                    // A hidden choice WITH an item # keeps the real id — the generator includes it in the
                    // BOM (includedParts) at its cluster's position. HIDDEN-… synthetic = geometry-only.
                    const partId = hasItem ? ch.itemNo.trim().toUpperCase() : (ch.isHidden ? `HIDDEN-${slug}` : `FEE-${slug}`);
                    const pid = pinIdFor(assignData.asmId, r.clusterId, partId, ch.nodeName);
                    for (const old of existing) { if (old.docId !== pid) { await deleteDoc(old.ref); removed++; } }
                    await setDoc(doc(db, 'assembly_pins', pid), { id: pid, assemblyId: assignData.asmId, clusterId: r.clusterId, partId, partName: ch.label || partId, defaultQty: 1, choiceNode: ch.nodeName, targetNode: ch.nodeName, choiceSort: idx, ...(ch.endTreatment && !(ch.catOverride && String(ch.catOverride).toUpperCase() !== 'FINIAL') ? { endTreatment: ch.endTreatment } : {}), ...(ch.isFee && !ch.isHidden ? { isFee: true } : {}), ...(ch.isHidden ? { isHiddenPart: true } : {}), ...(ch.isBasic && !ch.isFee && !ch.isHidden ? { isBasic: true } : {}), ...(ch.usesReturnPlates && !ch.isFee && !ch.isHidden ? { usesReturnPlates: true } : {}), ...(ch.isReturnArm && !ch.isFee && !ch.isHidden ? { isReturnArm: true } : {}), ...(ch.returnOnly && !ch.isFee && !ch.isHidden ? { returnOnly: true } : {}), ...(ch.inlineOnly && !ch.isFee && !ch.isHidden ? { inlineOnly: true } : {}), ...(hasItem && !ch.isFee && Array.isArray(ch.custIds) && ch.custIds.length ? { customerIds: ch.custIds, customerNames: ch.custNames || [] } : {}), ...(hasItem && !ch.isFee && ch.isCollar ? { isCollar: true } : {}), ...(hasItem && !ch.isFee && !ch.isCollar && String(ch.requiresCollar || '').trim() ? { requiresCollar: String(ch.requiresCollar).trim() } : {}), ...(hasItem && String(ch.projInches || '').trim() ? { projInches: String(ch.projInches).trim().toUpperCase() } : {}), ...(hasItem && !ch.isFee && String(ch.mountType || '').trim() ? { mountType: String(ch.mountType).trim().toUpperCase() } : {}), ...(hasItem && String(ch.catOverride || '').trim() ? { catOverride: String(ch.catOverride).trim().toUpperCase() } : {}), ...(String(ch.traverseRole || '').trim() ? { traverseRole: String(ch.traverseRole).trim().toUpperCase() } : {}), ...(String(ch.driveType || '').trim() ? { driveType: String(ch.driveType).trim().toUpperCase() } : {}), ...(String(ch.trvSetup || '').trim() ? { trvSetup: String(ch.trvSetup).trim().toUpperCase() } : {}), ...(ch.alwaysShown && !ch.isFee ? { alwaysShown: true } : {}), // THE FEE'S TYPED CODE, IN A FIELD OF ITS OWN (Stuart 2026-08-04: "the bug that keeps
                    // whipping out all my miter fees is still, they are yet again gone"). partId was
                    // carrying it, and partId is rewritten by anything that re-saves a choice — once it
                    // became the synthetic FEE-<slug> the code was unrecoverable. This field is written
                    // by nothing else and read back first, so the code survives a bad round-trip.
                    ...(ch.isFee && String(ch.itemNo || '').trim() ? { feeItemNo: String(ch.itemNo).trim().toUpperCase() } : {}), ...(String(ch.note || '').trim() ? { designerNote: String(ch.note).trim() } : {}), ...(hasItem && !ch.isFee ? libLinkFields(ch.itemNo) : {}),
                    // 2D tear-sheet rows: the operator-typed choice NAME is the display name the CPQ
                    // option card shows — it must survive the libLink partName (= ERP code) overwrite.
                    ...(r.is2d && String(ch.label || '').trim() ? { partName: String(ch.label).trim() } : {}),
                    // HYBRID material rail (Leyla): the choice's swatch image (m2cstudio materials URL).
                    ...(r.is2d && String(ch.imgUrl || '').trim() ? { imageUrl: String(ch.imgUrl).trim() } : {}) });
                    n++; if (ch.isFee && !ch.isHidden) fees++; if (ch.isHidden) hides++;
                }
            }
            addLog(`✅ Saved ${n} choice pin(s) (${fees} fee, ${hides} hidden${parked ? `, ${parked} ⏸ parked` : ''}${removed ? `, ${removed} stale removed` : ''}${renamed ? `, ${renamed} node name(s) reconciled to the live model` : ''}${droppedStale.length ? `, ${droppedStale.length} stale node record(s) dropped` : ''}).`, 'success');
            alert(`✅ Wrote ${n} choice pin(s)${fees ? ` — ${fees} marked as FEE (renders its geometry, bills as a fee, no BOM item)` : ''}${parked ? `\n\n⏸ ${parked} choice(s) PARKED (no item # yet) — hidden from the model and the flow. When the item # lands in the library, come back, LOAD CHOICES, type it in, save, and regenerate — the part appears on the CPQ.` : ''}.${reconStatus !== 'ran' ? `\n\n⚠ NODE RECONCILIATION ${reconStatus} — stale names were NOT cleaned; fix this before regenerating.` : `\n\n🔧 Node reconciliation ran: ${renamed} renamed, ${droppedStale.length} stale name(s) dropped${droppedStale.length ? ` (${droppedStale.slice(0, 6).join(', ')}${droppedStale.length > 6 ? '…' : ''})` : ''}.`}\n\nNow REGENERATE the CPQ flow (System Admin → the flow → "Regenerate Steps from Tags (keep prices)") — clusters with 2+ choices fan out into individual options. Hardware left blank stays as always-on shared geometry.`);
        } catch (e) { console.error(e); addLog(`Save failed: ${e.message || e}`, 'error'); alert('Save failed:\n\n' + (e.message || e)); }
        setAssignBusy(false);
    };

    // SYNC BOM ↔ LIBRARY: retrofit pins that were written before pins carried the Visual-Assembly
    // link fields — they show as "new/leftover" (brass) there even though the item #s are real.
    // Resolves every item pin against the brand library (tolerantly, by id/itemId/legacyErpId) and
    // stamps the linked shape VA writes itself (partId=itemId, legacyErpId, isExistingLibraryPart,
    // specs, SPECS_LOCKED) + targetNode=choiceNode so per-choice node thumbnails work. Fee/hidden
    // pins keep their role (only gain targetNode). Item #s, flags, and order are never changed.
    const handleSyncPinsToLibrary = async () => {
        if (!syncId) return alert('Pick an assembly.');
        const target = repairList.find(a => a.id === syncId);
        setSyncBusy(true);
        try {
            const snap = await getDocs(collection(db, 'Approved_Designs'));
            const partsAll = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .filter(x => !activeBrand || x.brandId === activeBrand || (Array.isArray(x.sharedBrands) && x.sharedBrands.includes(activeBrand)));
            // byRaw (exact code) is consulted FIRST — a pin saying H1-75BPR must join the ring,
            // not the H1-75BP-R backplate it collides with after normalization.
            const byNorm = new Map(); const byRaw = new Map();
            const rawOf = (v) => String(v || '').trim().toUpperCase();
            partsAll.forEach(p => { [p.legacyErpId, p.itemId, p.id].forEach(c => { if (!c || c === 'PENDING') return; const raw = rawOf(c); if (raw && !byRaw.has(raw)) byRaw.set(raw, p); const n = normCode(c); if (n.length >= 4 && !byNorm.has(n)) byNorm.set(n, p); }); });
            const pinSnap = await getDocs(query(collection(db, 'assembly_pins'), where('assemblyId', '==', target?.itemId || syncId)));
            let linked = 0, already = 0, flagged = 0; const unresolved = [];
            for (const d of pinSnap.docs) {
                const pin = d.data();
                const patch = {};
                if (!pin.targetNode && pin.choiceNode) patch.targetNode = pin.choiceNode;
                if (pin.isFee || pin.isHiddenPart) { flagged++; }
                else if (pin.isExistingLibraryPart) { already++; }
                else {
                    const part = byRaw.get(rawOf(pin.partId)) || byRaw.get(rawOf(pin.legacyErpId)) || byRaw.get(rawOf(pin.partName))
                        || byNorm.get(normCode(pin.partId)) || byNorm.get(normCode(pin.legacyErpId)) || byNorm.get(normCode(pin.partName));
                    if (part) {
                        const erp = (part.legacyErpId && part.legacyErpId !== 'PENDING') ? part.legacyErpId : (part.itemId || part.id);
                        Object.assign(patch, { partId: part.itemId || part.id, partName: erp, legacyErpId: erp, isExistingLibraryPart: true, specs: part.manufacturingSpecs || {}, status: 'SPECS_LOCKED' });
                        linked++;
                    } else unresolved.push(pin.partName || pin.partId);
                }
                if (Object.keys(patch).length) await updateDoc(d.ref, patch);
            }
            addLog(`✅ Library sync "${target?.itemName}": ${linked} linked, ${already} already linked, ${flagged} fee/hidden, ${unresolved.length} unresolved.`, unresolved.length ? 'error' : 'success');
            alert(`✅ Synced "${target?.itemName}" BOM to the Master Library.\n\n• ${linked} pin(s) linked to existing parts — no longer "new/leftover" in Visual Assembly\n• ${already} already linked · ${flagged} fee/hidden left as-is\n${unresolved.length ? `• ⚠ ${unresolved.length} not found in the ${String(activeBrand || '').toUpperCase()} library (typo? other brand?): ${[...new Set(unresolved)].slice(0, 8).join(', ')}${unresolved.length > 8 ? ', …' : ''}` : '• Every item pin resolved.'}\n\nThumbnails: NODE THUMB in Visual Assembly now renders just that choice's node and stamps the library item.`);
        } catch (e) { console.error(e); alert('Sync failed:\n\n' + (e.message || e)); }
        setSyncBusy(false);
    };

    // ITEM STARTER KIT: upload the filled template → create the items in the Master Library under a
    // Project, so 1.6 auto-match / pickers find them immediately. Duplicate ERP ids (already in the
    // brand library) are skipped, so an unedited sample row can never double a real item.
    const handleStarterUpload = async (file) => {
        if (!file) return;
        setStarterBusy(true);
        try {
            const rows = await parseItemStarterWorkbook(file);
            if (!rows.length) { alert('No item rows found (Item ID column empty?).'); setStarterBusy(false); return; }
            await ensureCodeIndex();
            const byNorm = codeIndexRef.current?.byNorm || new Map();
            const parseBool = (v, dflt) => { const s = String(v || '').trim().toUpperCase(); if (!s) return dflt; return s === 'TRUE' || s === 'YES' || s === '1'; };
            let created = 0; const skipped = [];
            for (let i = 0; i < rows.length; i++) {
                const r = rows[i];
                const erp = r.itemId.toUpperCase();
                // Skip only an EXACT existing code — a norm-collision sibling (H1-75BP-R vs
                // H1-75BPR) must not block creating the genuinely new item.
                if ((byNorm.get(normCode(erp)) || []).some(x => String(x.code).toUpperCase() === erp)) { skipped.push(erp); continue; }
                const isFeeClass = /fee/i.test(r.entityClass || '');
                const id = `${String(activeBrand || 'CE').toUpperCase()}-${isFeeClass ? 'FEE' : 'INV'}-${Date.now()}-${i}`;
                const customData = {};
                if (r.projection) customData.projection = r.projection;
                if (r.backplateOrientation) customData.bpOrientation = r.backplateOrientation.toUpperCase(); // canonical key — Vision O2O reads bpOrientation (legacy backplateOrientation had zero readers)
                if (parseBool(r.isReturnBracket, false)) customData.isReturnBracket = true;
                await setDoc(doc(db, 'Approved_Designs', id), {
                    id, itemId: id, legacyErpId: erp, itemName: (r.name || erp).toUpperCase(),
                    brandId: activeBrand, sharedBrands: [activeBrand],
                    partClass: isFeeClass ? 'Fee' : 'Inventory', routingType: 'STANDARD',
                    project: r.project || '', ...(isFeeClass ? { isFee: true } : {}),
                    manufacturingSpecs: {
                        productType: (r.productType || (isFeeClass ? 'FEE' : 'Uncategorized')).toUpperCase(),
                        ...(r.basePrice ? { basePrice: r.basePrice } : {}),
                        ...(r.cost ? { cost: r.cost } : {}),
                        ...(r.weight ? { weight: r.weight } : {}),
                        uom: r.uom || 'EA',
                        ...(r.partHandling ? { partHandling: r.partHandling } : {}),
                        ...(r.watchList ? { watchList: r.watchList.toUpperCase() } : {}),
                        ...(r.collection ? { collections: [r.collection.toUpperCase()] } : {}),
                        ...(r.paintSize ? { paintSize: r.paintSize.toUpperCase() } : {}),
                        ...(r.vendorName ? { vendorName: r.vendorName } : {}),
                        ...(r.vendorSku ? { vendorId: r.vendorSku } : {}),
                        isInHouse: parseBool(r.isInHouse, true),
                        isStocked: parseBool(r.isStocked, false),
                        customData
                    },
                    createdAt: Date.now(), updatedAt: Date.now(), author: currentUser || ''
                });
                created++;
            }
            codeIndexRef.current = null; // refresh the auto-match index so new items are found immediately
            addLog(`✅ Item Starter Kit: ${created} item(s) created${skipped.length ? `, ${skipped.length} skipped (already exist)` : ''}.`, 'success');
            alert(`✅ Created ${created} item(s) in the ${String(activeBrand || '').toUpperCase()} library${rows[0]?.project ? ` under project "${rows[0].project}"` : ''}.\n${skipped.length ? `\nSkipped (already exist): ${skipped.slice(0, 10).join(', ')}${skipped.length > 10 ? ', …' : ''}\n` : ''}\nThey're live for 1.6 auto-match + pickers now. Prices/fields can be mass-edited later in tab 4.5.`);
        } catch (e) { console.error(e); alert('Starter Kit upload failed:\n\n' + (e.message || e)); }
        setStarterBusy(false);
    };

    // LIVE collar-candidate lists, recomputed EVERY render straight from the row/slot state in
    // scope right now — the collar: dropdowns react to a COLLAR tick or an item # keystroke
    // instantly, no Save + Load Choices round-trip (see collarCandidatesOf).
    const assignCollarCands = collarCandidatesOf((assignData?.rows || []).flatMap(r => r.choices || []));
    const slotCollarCands = collarCandidatesOf(Object.values(layers).flatMap(l => l.choices || []));

    // ---- styles ----
    const card = { background: '#fff', border: '1px solid var(--line)', borderRadius: '2px' };
    const lbl = { fontFamily: 'var(--mono)', fontSize: '9px', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-soft)' };
    const sel = { padding: '6px', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', background: '#fff' };
    const inp = { padding: '8px 10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', fontSize: '0.85rem' };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', fontFamily: 'var(--sans)' }}>
            <div style={{ ...card, padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                <div>
                    <span style={{ ...lbl, color: 'var(--brass)' }}>Step-by-step layered assembly</span>
                    <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>Assembly Builder</h2>
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <select value={extendId} onChange={e => setExtendId(e.target.value)} title="Extend an existing builder assembly: uploaded slots are APPENDED — existing geometry, clusters, item #s and flags are untouched (same doc, so BOM/CPQ/flow links survive). Leave on 'New assembly' to create fresh." style={{ ...sel, padding: '9px', minWidth: '250px' }}>
                        <option value="">— New assembly —</option>
                        {repairList.map(a => <option key={a.id} value={a.id}>➕ Extend: {a.itemName || a.id}</option>)}
                    </select>
                    <input value={extendId ? (repairList.find(a => a.id === extendId)?.itemName || '') : assemblyName} disabled={!!extendId} onChange={e => setAssemblyName(e.target.value)} placeholder="Assembly name / item #…" style={{ ...inp, minWidth: '260px', ...(extendId ? { background: 'var(--paper-2)', color: 'var(--ink-soft)' } : {}) }} />
                </div>
            </div>

            {/* Workflow template picker — swaps the slot scaffold. Every slot is optional. */}
            <div style={{ ...card, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                <span style={lbl}>Workflow</span>
                <div style={{ display: 'flex', gap: '8px' }}>
                    {Object.entries(TEMPLATES).map(([key, t]) => (
                        <button key={key} onClick={() => switchTemplate(key)}
                            style={{ padding: '8px 14px', border: `1px solid ${template === key ? 'var(--ink)' : 'var(--line)'}`, background: template === key ? 'var(--ink)' : '#fff', color: template === key ? '#fff' : 'var(--ink)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', borderRadius: '2px' }}>
                            {t.label}
                        </button>
                    ))}
                </div>
                <span style={{ fontFamily: 'var(--sans)', fontSize: '0.82rem', color: 'var(--ink-soft)', flex: 1, minWidth: '220px' }}>{TEMPLATES[template].hint}</span>
                <span style={{ ...lbl, color: 'var(--brass)' }}>Every slot optional — upload only what's used; the flow builds from filled slots</span>
            </div>

            {/* Item Starter Kit — step 0: create the flow's items in the library before building. */}
            <div style={{ ...card, borderColor: 'var(--brass)', padding: '16px 18px', display: 'flex', gap: '14px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '260px' }}>
                    <span style={{ ...lbl, color: 'var(--brass)' }}>Item Starter Kit (step 0)</span>
                    <span style={{ fontFamily: 'var(--sans)', fontSize: '0.82rem', color: 'var(--ink-soft)', display: 'block' }}>Download the pre-filled template (every item kind a flow needs: pole + /P variant, rings, brackets, regular/return backplates, finials, fee entities — fields mirror tab 4.5), fill it in with your series + a Project name, and upload. Items are created in the library so auto-match finds them; existing ERP ids are skipped.</span>
                </div>
                <button onClick={() => downloadItemStarterTemplate(activeBrand)} style={{ padding: '11px 18px', background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' }}>⬇ Download Template</button>
                <label style={{ padding: '11px 18px', background: starterBusy ? 'var(--paper-2)' : 'var(--ink)', color: starterBusy ? 'var(--ink-soft)' : '#fff', cursor: starterBusy ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' }}>
                    {starterBusy ? '⚙ Creating…' : '⬆ Upload & Create Items'}
                    <input type="file" accept=".xlsx" style={{ display: 'none' }} onChange={e => { handleStarterUpload(e.target.files[0]); e.target.value = ''; }} />
                </label>
            </div>

            {/* Repair tool — fix an assembly built before the unique-node-name fix (no re-upload). */}
            <div style={{ ...card, borderColor: 'var(--brass)', padding: '16px 18px', display: 'flex', gap: '14px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '240px' }}>
                    <span style={{ ...lbl, color: 'var(--brass)' }}>Repair node names (built before the fix)</span>
                    <span style={{ fontFamily: 'var(--sans)', fontSize: '0.82rem', color: 'var(--ink-soft)', display: 'block' }}>If a built assembly's clusters share node names and bleed together in Node Grouping, this re-namespaces every slot's nodes uniquely and rewrites the clusters — no re-upload, tags &amp; item numbers untouched, old .glb kept as backup.</span>
                </div>
                <div style={{ minWidth: '260px' }}>
                    <span style={lbl}>Assembly</span>
                    <select value={repairId} onChange={e => setRepairId(e.target.value)} style={{ ...sel, width: '100%', padding: '9px' }}>
                        <option value="">Select an assembly…</option>
                        {repairList.map(a => <option key={a.id} value={a.id}>{a.itemName || a.id}</option>)}
                    </select>
                </div>
                <button onClick={handleRepairNodeNames} disabled={repairBusy || !repairId} style={{ padding: '11px 22px', background: repairBusy ? 'var(--paper-2)' : 'var(--ink)', color: repairBusy ? 'var(--ink-soft)' : '#fff', border: 'none', cursor: repairBusy ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' }}>
                    {repairBusy ? '⚙ Repairing…' : '⚙ Repair Node Names'}
                </button>
            </div>

            {/* Code collision audit — punctuation-only twin codes shadow each other in auto-match. */}
            <div style={{ ...card, borderColor: 'var(--brass)', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '240px' }}>
                        <span style={{ ...lbl, color: 'var(--brass)' }}>Code collision audit</span>
                        <span style={{ fontFamily: 'var(--sans)', fontSize: '0.82rem', color: 'var(--ink-soft)', display: 'block' }}>Finds item #s that differ only by punctuation (H1-75BPR vs H1-75BP-R) — twins can shadow each other in auto-match and pickers. ✓ = the names tell them apart, the matcher handles it. ⚠ = rename one item so its part type (ring / backplate / bracket / finial / pole) is in the name.</span>
                    </div>
                    <button onClick={runCollisionAudit} disabled={auditBusy} style={{ padding: '11px 22px', background: auditBusy ? 'var(--paper-2)' : 'var(--ink)', color: auditBusy ? 'var(--ink-soft)' : '#fff', border: 'none', cursor: auditBusy ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' }}>
                        {auditBusy ? '⚙ Scanning…' : '🔎 Scan Library'}
                    </button>
                </div>
                {audit && (
                    <div style={{ maxHeight: '280px', overflowY: 'auto', borderTop: '1px solid var(--line)' }}>
                        {audit.length === 0 && <div style={{ padding: '12px 0', fontFamily: 'var(--sans)', fontSize: '0.85rem', color: '#3a7d44' }}>✓ No punctuation-only code collisions in the {String(activeBrand || '').toUpperCase()} library.</div>}
                        {audit.map(g => (
                            <div key={g.norm} style={{ display: 'flex', gap: '12px', alignItems: 'baseline', padding: '8px 0', borderBottom: '1px solid var(--paper-2)' }}>
                                <span style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: g.breakable ? '#3a7d44' : '#d9534f', minWidth: '16px' }}>{g.breakable ? '✓' : '⚠'}</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    {g.items.map(it => (
                                        <div key={it.code} style={{ fontFamily: 'var(--sans)', fontSize: '0.85rem', color: 'var(--ink)' }}>
                                            <span style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{it.code}</span>
                                            <span style={{ color: 'var(--ink-soft)' }}> — {it.name || '(no name)'}{it.cls ? ` · ${it.cls}` : ''}</span>
                                        </div>
                                    ))}
                                    {!g.breakable && <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: '#d9534f', marginTop: '2px' }}>names too similar — the matcher can't tell these apart; rename one in the Master Library</div>}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Assign item numbers to an existing assembly's choices (for assemblies built with 0 pins). */}
            <div style={{ ...card, borderColor: 'var(--brass)', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '240px' }}>
                        <span style={{ ...lbl, color: 'var(--brass)' }}>Assign item numbers to choices</span>
                        <span style={{ fontFamily: 'var(--sans)', fontSize: '0.82rem', color: 'var(--ink-soft)', display: 'block' }}>For an assembly built without item numbers: lists each cluster's stacked choices from the .glb. Type an item # per real choice; leave shared hardware (screws / standoffs) blank. Clusters with 2+ item-numbered choices fan out into individual options after you regenerate the flow.</span>
                    </div>
                    <div style={{ minWidth: '240px' }}>
                        <span style={lbl}>Assembly</span>
                        <select value={assignId} onChange={e => { setAssignId(e.target.value); setAssignData(null); }} style={{ ...sel, width: '100%', padding: '9px' }}>
                            <option value="">Select an assembly…</option>
                            {repairList.map(a => <option key={a.id} value={a.id}>{a.itemName || a.id}</option>)}
                        </select>
                    </div>
                    <button onClick={handleLoadChoices} disabled={assignBusy || !assignId} style={{ padding: '11px 18px', background: assignBusy ? 'var(--paper-2)' : 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)', cursor: assignBusy ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' }}>
                        {assignBusy ? '⚙ Loading…' : 'Load Choices'}
                    </button>
                    <button onClick={restoreGlbBackup} disabled={assignBusy || !assignId} title="RESTORE THE PREVIOUS .GLB — every section-delete strip keeps the pre-strip file as a backup on the record. This swaps the model back to it (the current file becomes the new backup, so you can swap forward again). Cluster records and pins are NOT changed. Use when a strip removed geometry a surviving section still needed." style={{ padding: '11px 14px', background: '#fff', color: 'var(--ink-soft)', border: '1px solid var(--line)', cursor: assignBusy ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' }}>
                        ↩ Restore .glb backup
                    </button>
                    <button onClick={stripOrphanGeometry} disabled={assignBusy || !assignId} title="STRIP UNCLAIMED GEOMETRY — removes .glb groups that NO section claims (leftovers of record-only deletes and failed uploads) plus later same-named duplicate groups. Unclaimed nodes render PERMANENTLY in the CPQ, so run this after cleaning up sections. Old .glb kept as backup (↩ restorable)." style={{ padding: '11px 14px', background: '#fff', color: 'var(--ink-soft)', border: '1px solid var(--line)', cursor: assignBusy ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' }}>
                        🧹 Strip unclaimed
                    </button>
                </div>

                {assignData && assignModelInfo && (
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', letterSpacing: '.04em', margin: '8px 0 2px' }}>
                        EDITING · doc {assignModelInfo.docId} · itemId {assignModelInfo.itemId} · model {assignModelInfo.cadFile} — CPQ's red strip names ITS model; if they differ, the flow links another record.
                    </div>
                )}
                {assignData && (
                    <div style={{ borderTop: '1px dashed var(--line)', paddingTop: '10px', maxHeight: '46vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {/* 🧭 TROUBLESHOOTING ORDER (Stuart 2026-08-16: "group them all... all poles/rods
                            come first, then all finials left, all finials right, all brackets left, all
                            backplates left, all brackets center, all backplates center"). Display-only —
                            pins, stored order and the generator are untouched.
                            ZERO-CHOICE SECTIONS NOW SHOW (they were hidden, which is how the designer's
                            new wood-rod slot "disappeared": its nodes weren't found in the current .glb
                            — usually a name collision with an older copy of the same item — so it loaded
                            with 0 choices and the old filter dropped it from the list entirely). */}
                        {[...assignData.rows].sort((a, b) => {
                            const rank = (r) => {
                                const cat = normalizeCategory(r.category);
                                const posRank = { LEFT: 0, CENTER: 1, RIGHT: 2 }[String(r.position || '').toUpperCase()] ?? 3;
                                if (cat === 'POLE') return [0, 0, 0];
                                if (cat === 'FINIAL') return [1, posRank, 0];
                                if (cat === 'BRACKET') return [2, posRank, 0];
                                if (cat === 'BACKPLATE') return [2, posRank, 1];
                                if (cat === 'RING') return [3, 0, 0];
                                return [4, 0, 0];
                            };
                            const ra = rank(a), rb = rank(b);
                            return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2] || String(a.clusterName || '').localeCompare(String(b.clusterName || ''));
                        }).map((r) => {
                            return (
                                <div key={r.clusterId} style={{ border: '1px solid var(--line)', borderRadius: '2px', padding: '10px 12px' }}>
                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink)', marginBottom: '8px' }}>
                                        {r.clusterName} <span style={{ color: 'var(--ink-soft)' }}>· {r.category || '—'}{r.position ? ' · ' + r.position : ''} · {r.choices.length} node(s){r.found ? '' : ' · ⚠ group not found'}</span>{!r.is2d && r.choices.length === 0 && <span style={{ color: '#d9534f' }}> · ⚠ EMPTY — its nodes weren't found in the current .glb. Usual cause: a name collision with an OLDER section holding the same item (🗑 the stale twin, then re-upload this one via ➕ Extend).</span>}{twinOf(r) && <button onClick={() => swapSides(r)} disabled={assignBusy} title="LEFT and RIGHT render on each other's ends? The clusters carry each other's nodes — this swaps the geometry records (clusters + pins) with the twin, then Regenerate." style={{ marginLeft: '10px', border: '1px solid var(--line)', background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '8px', letterSpacing: '.05em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: '2px' }}>⇄ sides</button>}
                                        {r.is2d && <button onClick={() => addChoice2d(r.clusterId)} disabled={assignBusy} title="Add a choice to this tear-sheet section — type its display name (what the CPQ card shows) and its item #, then Save Assignments." style={{ marginLeft: '8px', border: '1px solid var(--brass)', background: '#fff', color: 'var(--brass)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '8px', letterSpacing: '.05em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: '2px' }}>➕ choice</button>}
                                        <button onClick={() => deleteSection(r)} disabled={assignBusy} title="Delete this ENTIRE section: every choice + pin, and its geometry is stripped from the .glb so the file shrinks (old .glb kept as backup). For re-uploading a whole section via ➕ Extend." style={{ marginLeft: '8px', border: '1px solid #d9534f', background: '#fff', color: '#d9534f', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '8px', letterSpacing: '.05em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: '2px' }}>🗑 section</button>
                                        {/* ✎ RECLASS — the slot's category/position were locked in at upload; these two
                                            selects rewrite the CLUSTER record (pins ride along), then Regenerate. */}
                                        {!r.is2d && <select value={String(r.category || '').toUpperCase()} disabled={assignBusy} title="RECLASSIFY CATEGORY — chosen at upload, editable here. Moves this whole section's choices into that pool (POLE = rod/material options, RING = the Rings step, …) on the next flow Regenerate. Pins stay linked." onChange={e => { if (e.target.value !== String(r.category || '').toUpperCase()) reclassSection(r, { category: e.target.value }); }} style={{ marginLeft: '8px', border: '1px solid var(--line)', background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '8px', letterSpacing: '.05em', textTransform: 'uppercase', padding: '2px 4px', borderRadius: '2px' }}>
                                            {[...new Set(['POLE', 'FINIAL', 'BRACKET', 'BACKPLATE', 'RING', 'OTHER', String(r.category || '').toUpperCase()])].filter(Boolean).map(cat => <option key={cat} value={cat}>{cat.toLowerCase()}</option>)}
                                        </select>}
                                        {!r.is2d && <select value={['LEFT', 'CENTER', 'RIGHT'].includes(String(r.position || '').toUpperCase()) ? String(r.position).toUpperCase() : ''} disabled={assignBusy} title="RECLASSIFY POSITION — chosen at upload, editable here. LEFT/RIGHT on a POLE section = that side's end-half (follows the End Treatment pick); shared/CENTER = the always-shown run (what the material step offers). On the next flow Regenerate. Pins stay linked." onChange={e => { const cur = ['LEFT', 'CENTER', 'RIGHT'].includes(String(r.position || '').toUpperCase()) ? String(r.position).toUpperCase() : ''; if (e.target.value !== cur) reclassSection(r, { position: e.target.value }); }} style={{ marginLeft: '4px', border: '1px solid var(--line)', background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '8px', letterSpacing: '.05em', textTransform: 'uppercase', padding: '2px 4px', borderRadius: '2px' }}>
                                            <option value="">shared</option>
                                            {['LEFT', 'CENTER', 'RIGHT'].map(p => <option key={p} value={p}>{p.toLowerCase()}</option>)}
                                        </select>}
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: normalizeCategory(r.category) === 'FINIAL' ? '48px minmax(150px,230px) 220px 122px minmax(300px,1fr) 72px' : '48px minmax(150px,230px) 220px minmax(300px,1fr) 72px', gap: '6px 12px', alignItems: 'center' }}>
                                        {r.choices.map((c) => (
                                            <React.Fragment key={c.nodeName}>
                                                {c.thumb
                                                    ? <img src={c.thumb} alt="" title="Click to enlarge" onClick={() => setZoomThumb({ url: c.thumb, label: `${r.clusterName} · ${c.label}${c.itemNo ? ` · ${c.itemNo}` : ''}` })} style={{ width: '44px', height: '44px', objectFit: 'contain', background: 'var(--paper-2)', border: '1px solid var(--line)', borderRadius: '2px', cursor: 'zoom-in' }} />
                                                    : <span style={{ width: '44px', height: '44px', border: '1px dashed var(--line)', borderRadius: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '7px', color: 'var(--ink-soft)' }}>…</span>}
                                                <span style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                                                    {r.is2d
                                                        ? <input value={c.label} placeholder="choice name — what the CPQ card shows (e.g. GOLDEN BRASS)" title="Display name for this choice on the configurator" onChange={e => setChoicePatch(r.clusterId, c.nodeName, { label: e.target.value })} style={{ ...inp, padding: '4px 6px', fontSize: '10px', fontFamily: 'var(--mono)', textTransform: 'uppercase', flex: 1, minWidth: 0, borderColor: c.label ? 'var(--line)' : 'var(--brass)' }} />
                                                        : <span title={c.nodeName} style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</span>}
                                                    {!r.is2d && <button onClick={() => splitChoice(r.clusterId, c.nodeName)} title="This row is really several parts merged under one wrapper node — split it into its named sub-parts, each with its own thumbnail and item #." style={{ border: '1px solid var(--line)', background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '8px', letterSpacing: '.05em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: '2px', flexShrink: 0 }}>⤢ split</button>}
                                                </span>
                                                {(() => { const willPark = !(c.itemNo && c.itemNo.trim()) && !c.isFee && !c.isHidden && looksRealPart(c.label); const missing = nodeMissing(c.nodeName); return (
                                                <span style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
                                                <input value={c.itemNo} list="ab-item-codes" onChange={e => setChoicePatch(r.clusterId, c.nodeName, { itemNo: e.target.value })} title={willPark ? 'No item # yet — on save this choice PARKS: the node hides from the model AND the flow until you assign the # (Load Choices keeps listing it). Perfect for parts IT hasn\'t set up yet.' : undefined} placeholder={c.isFee ? 'fee — item # optional (links the fee entity, e.g. CE-FEE-4594, for pricing)' : (c.isHidden ? 'hidden — item # optional (adds it to the BOM)' : (willPark ? '⏸ parks on save — no item # yet' : 'item # — type to search (blank = hardware)'))} style={{ ...inp, padding: '5px 8px', fontSize: '0.78rem', fontFamily: 'var(--mono)', borderColor: c.isFee ? 'var(--line)' : (c.itemNo ? 'var(--brass)' : (willPark ? 'var(--brass)' : 'var(--line)')), borderStyle: willPark ? 'dashed' : 'solid', opacity: c.isFee ? 0.5 : 1 }} />
                                                <input value={c.note || ''} onChange={e => setChoicePatch(r.clusterId, c.nodeName, { note: e.target.value })} placeholder="designer note — what is it / where does it sit" maxLength={120} title="Typed at upload (or here) — saved on the pin, shown every time Load Choices lists this part." style={{ ...inp, padding: '3px 8px', fontSize: '0.72rem', fontStyle: 'italic', borderColor: c.note ? 'var(--brass)' : 'var(--line)', opacity: 0.85 }} />
                                                {r.is2d && (
                                                    <input value={c.imgUrl || ''} onChange={e => setChoicePatch(r.clusterId, c.nodeName, { imgUrl: e.target.value })} placeholder="swatch image URL — the material photo the hybrid CPQ leader-lines to (m2cstudio materials page)" title="HYBRID material rail (Leyla): paste the material's image URL (e.g. the tassel color swatch from m2cstudio.com/materials). When this choice is selected in the CPQ, its swatch appears on the right with an architect leader line to the render." style={{ ...inp, padding: '3px 8px', fontSize: '0.7rem', fontFamily: 'var(--mono)', borderColor: c.imgUrl ? 'var(--brass)' : 'var(--line)', opacity: 0.9 }} />
                                                )}
                                                {/* ✗ REBIND (Brimar elbow, 2026-08-10): this row's recorded node matches NOTHING
                                                    in the loaded model — even by leaf name — so it can never render. Pick the
                                                    real scene node; Save writes it through pins AND the cluster record. */}
                                                {missing && (
                                                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <span style={{ fontFamily: 'var(--mono)', fontSize: '8px', color: '#b00020', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>✗ not in model</span>
                                                        <select value="" onChange={e => { if (e.target.value) setChoicePatch(r.clusterId, c.nodeName, { nodeName: e.target.value }); }} title="Re-bind this choice to a node that actually exists in the .glb — candidates are top-level scene nodes not already claimed by another row." style={{ ...inp, padding: '2px 4px', fontSize: '8px', fontFamily: 'var(--mono)', flex: 1, minWidth: 0, borderColor: '#b00020' }}>
                                                            <option value="">rebind to real node…</option>
                                                            {rebindCandidates().map(nm => <option key={nm} value={nm}>{choiceLabel(nm)} ({nm.length > 34 ? nm.slice(0, 34) + '…' : nm})</option>)}
                                                        </select>
                                                    </span>
                                                )}
                                                </span>
                                                ); })()}
                                                {normalizeCategory(r.category) === 'FINIAL' && (normalizeCategory(c.catOverride || r.category) !== 'FINIAL' ? (
                                                    <span title="Re-homed by the cat: override — end treatment only applies to finial-slot choices; this row now carries its new category's flags instead." style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: '#d9534f', textTransform: 'uppercase', letterSpacing: '.05em' }}>→ {String(c.catOverride).toLowerCase()}</span>
                                                ) : (
                                                    <select value={c.endTreatment || ''} title="END TREATMENT — the explicit tag the generator + CPQ + Vision read (replaces name-sniffing). FINIAL = decorative end. FRENCH/MITER RETURN = fee, replaces this side's bracket + hides the long rod half. INSIDE MOUNT = real part, replaces the bracket." onChange={e => { const et = e.target.value; setChoicePatch(r.clusterId, c.nodeName, { endTreatment: et, ...(et === 'FRENCH_RETURN' || et === 'MITER_RETURN' ? { isFee: true, isHidden: false, isBasic: false, usesReturnPlates: false } : {}) }); }} style={{ ...inp, padding: '4px 6px', fontSize: '9px', fontFamily: 'var(--mono)', textTransform: 'uppercase', width: '118px', borderColor: c.endTreatment && c.endTreatment !== 'FINIAL' ? 'var(--brass)' : 'var(--line)' }}>
                                                        <option value="">— end type —</option>
                                                        {END_TREATMENTS.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                                                    </select>
                                                ))}
                                                {/* WRAPPING flags cell — same fix as the slot rows (Liesl 2026-08-12). */}
                                                <span style={{ display: 'flex', flexWrap: 'wrap', gap: '7px 18px', alignItems: 'center', minWidth: 0 }}>
                                                    <label title="Fee choice (e.g. a french-return bend): shows this geometry as a selectable option, bills as a fee — no item # / BOM line. Position comes from the cluster's tag." style={{ display: 'flex', alignItems: 'center', gap: '6px', fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.05em', textTransform: 'uppercase', color: c.isFee ? 'var(--brass)' : 'var(--ink-soft)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                                        <input type="checkbox" checked={!!c.isFee} onChange={e => setChoicePatch(r.clusterId, c.nodeName, { isFee: e.target.checked, ...(e.target.checked ? { isHidden: false, isBasic: false, usesReturnPlates: false } : {}) })} style={{ cursor: 'pointer', width: '15px', height: '15px', margin: 0, flexShrink: 0 }} />
                                                        fee
                                                    </label>
                                                    <label title="Hide this node in EVERY configuration (stray/duplicate geometry that should never render). Takes effect after regenerating the flow." style={{ display: 'flex', alignItems: 'center', gap: '6px', fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.05em', textTransform: 'uppercase', color: c.isHidden ? '#d9534f' : 'var(--ink-soft)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                                        <input type="checkbox" checked={!!c.isHidden} onChange={e => setChoicePatch(r.clusterId, c.nodeName, { isHidden: e.target.checked, ...(e.target.checked ? { isFee: false, isBasic: false, usesReturnPlates: false } : {}) })} style={{ cursor: 'pointer', width: '15px', height: '15px', margin: 0, flexShrink: 0 }} />
                                                        hide
                                                    </label>
                                                    <label title="Basic bracket: takes NO backplate — when the customer selects this bracket, the backplate picker greys out and stays None. Keep the item # filled; this flag just disables the plate pairing." style={{ display: 'flex', alignItems: 'center', gap: '6px', fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.05em', textTransform: 'uppercase', color: c.isBasic ? 'var(--brass)' : 'var(--ink-soft)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                                        <input type="checkbox" checked={!!c.isBasic} onChange={e => setChoicePatch(r.clusterId, c.nodeName, { isBasic: e.target.checked, ...(e.target.checked ? { isFee: false, isHidden: false, usesReturnPlates: false } : {}) })} style={{ cursor: 'pointer', width: '15px', height: '15px', margin: 0, flexShrink: 0 }} />
                                                        basic
                                                    </label>
                                                    <label title="INLINE BRACKET (the bracket-side sibling of the basic tag): while this In Line arm is the selected bracket, the plate picker shows the INLINE plates (inl-only copies) — or the RETURN plates when the flow has no inline copies. This tag is how the system knows a bracket is In Line." style={{ display: 'flex', alignItems: 'center', gap: '6px', fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.05em', textTransform: 'uppercase', color: c.usesReturnPlates ? 'var(--brass)' : 'var(--ink-soft)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                                        <input type="checkbox" checked={!!c.usesReturnPlates} onChange={e => setChoicePatch(r.clusterId, c.nodeName, { usesReturnPlates: e.target.checked, ...(e.target.checked ? { isFee: false, isHidden: false, isBasic: false } : {}) })} style={{ cursor: 'pointer', width: '15px', height: '15px', margin: 0, flexShrink: 0 }} />
                                                        inl-bkt
                                                    </label>
                                                    {/* TRAVERSE (Stuart 2026-08-03). A traverse system is a different grammar, not a
                                                        pole with different parts: the FASCIA is chosen first, the TRACK is a finish
                                                        choice whose CUT depends on the drive, and the CARRIERS ride inside and are
                                                        never chosen at all. Blank on every other assembly, so nothing changes for
                                                        pole flows. */}
                                                    <select value={c.traverseRole || ''} title="TRAVERSE ROLE — FASCIA (the track face, chosen first) · TRACK (finish choice; its cut length differs by drive) · CARRIER (rides inside, never offered) · BRACKET / BACKPLATE (mixed assemblies, e.g. H1-138: traverse-ONLY attachments — offered only while the traverse unit, a pole choice tagged fascia/track, is selected; the standard brackets hide in their place, and swap back on a standard rod). Leave blank on pole assemblies." onChange={e => { const tr = e.target.value; setChoicePatch(r.clusterId, c.nodeName, { traverseRole: tr, ...(['CARRIER', 'FCLIP'].includes(tr) ? { alwaysShown: true, isHidden: false, isFee: false } : {}) }); }} style={{ ...inp, padding: '3px 5px', fontSize: '9px', fontFamily: 'var(--mono)', width: '112px', maxWidth: '112px', borderColor: c.traverseRole ? 'var(--brass)' : 'var(--line)', color: c.traverseRole ? 'var(--brass)' : 'var(--ink-soft)' }}>
                                                        <option value="">trv: — none —</option>
                                                        {TRAVERSE_ROLES.map(t => <option key={t} value={t}>trv: {t === 'TRV_END' ? 'end' : t === 'TRV_BRACKET' ? 'bracket' : t === 'TRV_BACKPLATE' ? 'backplate' : t === 'TRV_PART' ? 'trv-only' : t.toLowerCase()}</option>)}
                                                    </select>
                                                    <select value={c.driveType || ''} title="DRIVE — MOTORIZED or MANUAL. Blank = BOTH, which is the common case (a fascia is a fascia however the track is driven), so the default costs nothing. The generator only adds a Motorised/Manual step when an assembly actually carries choices for BOTH." onChange={e => setChoicePatch(r.clusterId, c.nodeName, { driveType: e.target.value })} style={{ ...inp, padding: '3px 5px', fontSize: '9px', fontFamily: 'var(--mono)', width: '112px', maxWidth: '112px', borderColor: c.driveType ? 'var(--brass)' : 'var(--line)', color: c.driveType ? 'var(--brass)' : 'var(--ink-soft)' }}>
                                                        <option value="">drive: — both —</option>
                                                        {DRIVE_TYPES.map(d => <option key={d} value={d}>drive: {d.toLowerCase()}</option>)}
                                                    </select>
                                                    {/* SINGLE vs DOUBLE — a double is two tracks on one bracket, so the bracket
                                                        IS a different part and only one of the two tracks exists on a single.
                                                        Blank = suits both, which is most things. */}
                                                    <select value={c.trvSetup || ''} title="SINGLE / DOUBLE — tag a bracket for the setup it fits, and each track for the setup it belongs to (front = single, rear = double). Blank = suits both. The Single-or-Double step is only asked when the assembly carries choices for BOTH." onChange={e => setChoicePatch(r.clusterId, c.nodeName, { trvSetup: e.target.value })} style={{ ...inp, padding: '3px 5px', fontSize: '9px', fontFamily: 'var(--mono)', width: '112px', maxWidth: '112px', borderColor: c.trvSetup ? 'var(--brass)' : 'var(--line)', color: c.trvSetup ? 'var(--brass)' : 'var(--ink-soft)' }}>
                                                        <option value="">setup: — both (shared) —</option>
                                                        {TRV_SETUPS.map(t => <option key={t} value={t}>setup: {t.toLowerCase()}</option>)}
                                                    </select>
                                                    <label title="ALWAYS SHOWN — present in every configuration, never offered, never swapped. A REAL part: it bills and it renders (grey). This is what carriers need — 'hide' is its opposite and means never render at all." style={{ display: 'flex', alignItems: 'center', gap: '6px', fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.05em', textTransform: 'uppercase', color: c.alwaysShown ? 'var(--brass)' : 'var(--ink-soft)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                                        <input type="checkbox" checked={!!c.alwaysShown} onChange={e => setChoicePatch(r.clusterId, c.nodeName, { alwaysShown: e.target.checked, ...(e.target.checked ? { isHidden: false, isFee: false } : {}) })} style={{ cursor: 'pointer', width: '15px', height: '15px', margin: 0, flexShrink: 0 }} />
                                                        always
                                                    </label>
                                                    {normalizeCategory(c.catOverride || r.category) === 'FINIAL' && (
                                                        <label title="COLLAR — this choice is the metal collar of a TWO-PART finial: companion geometry, never offered as its own option. Pair each top to it via the tops' collar: dropdown; on regenerate the collar renders WITH those tops (the step's metal finish lands on the collar; the AC chip keeps an acrylic top clear)." style={{ display: 'flex', alignItems: 'center', gap: '6px', fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.05em', textTransform: 'uppercase', color: c.isCollar ? 'var(--brass)' : 'var(--ink-soft)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                                            <input type="checkbox" checked={!!c.isCollar} onChange={e => setChoicePatch(r.clusterId, c.nodeName, { isCollar: e.target.checked, ...(e.target.checked ? { isFee: false, isHidden: false, requiresCollar: '' } : {}) })} style={{ cursor: 'pointer', width: '15px', height: '15px', margin: 0, flexShrink: 0 }} />
                                                            collar
                                                        </label>
                                                    )}
                                                    <select disabled={!!c.isFee} value={c.isFee ? '' : ((c.custIds && c.custIds[0]) || '')} title={c.isFee ? "Not available on a FEE choice — customer scope is not saved for fees (the pin drops it). Put the customer's pricing on the fee ITEM in the Master Library instead." : "CUSTOMER-ONLY choice: pick a customer and this option shows on the CPQ (and their portal) ONLY when that customer is selected — everyone else never sees it. '— all —' = visible to every customer (poles, rings, common parts)."} onFocus={() => ensureCustomers()} onChange={e => { const id = e.target.value; const nm = ((custList || []).find(x => x.id === id) || {}).name || ''; setChoicePatch(r.clusterId, c.nodeName, { custIds: id ? [id] : [], custNames: id ? [nm] : [] }); }} style={{ ...inp, padding: '3px 4px', fontSize: '9px', fontFamily: 'var(--mono)', width: '110px', maxWidth: '110px', borderColor: (c.custIds && c.custIds.length) ? 'var(--brass)' : 'var(--line)', color: (c.custIds && c.custIds.length) ? 'var(--brass)' : 'var(--ink-soft)' }}>
                                                        <option value="">cust: all</option>
                                                        {(custList || []).map(cu => <option key={cu.id} value={cu.id}>{cu.name}</option>)}
                                                        {c.custIds && c.custIds[0] && !(custList || []).some(x => x.id === c.custIds[0]) && <option value={c.custIds[0]}>{(c.custNames && c.custNames[0]) || c.custIds[0]}</option>}
                                                    </select>
                                                    {normalizeCategory(c.catOverride || r.category) === 'FINIAL' && !c.isCollar && (
                                                        <select value={c.requiresCollar || ''} title="PAIR WITH COLLAR (two-part finial top): pick the COLLAR-flagged choice (its item #) this top renders WITH — the generated option shows top+collar together, same side preferred. '— none —' = a one-piece finial. A ⚠ row = a choice ticked COLLAR that still needs its item # typed in." onChange={e => setChoicePatch(r.clusterId, c.nodeName, { requiresCollar: e.target.value })} style={{ ...inp, padding: '3px 4px', fontSize: '9px', fontFamily: 'var(--mono)', width: '110px', maxWidth: '110px', borderColor: c.requiresCollar ? 'var(--brass)' : 'var(--line)', color: c.requiresCollar ? 'var(--brass)' : 'var(--ink-soft)' }}>
                                                            <option value="">collar: — none —</option>
                                                            {assignCollarCands.codes.map(code => <option key={code} value={code}>{code}</option>)}
                                                            {assignCollarCands.pending.map((lbl, i) => <option key={`pend-${i}`} value="" disabled>⚠ {lbl} — needs item #</option>)}
                                                            {c.requiresCollar && !assignCollarCands.codes.some(code => code.toUpperCase() === String(c.requiresCollar).toUpperCase()) && <option value={c.requiresCollar}>{c.requiresCollar}</option>}
                                                        </select>
                                                    )}
                                                    {/* PROJECTION ON END CHOICES TOO (Stuart 2026-08-04: "i would need to add
                                                        them to the projections to the miter returns and return arms to help limit
                                                        the choices to match"). A traverse RETURN ARM is tagged FINIAL — it sits in
                                                        the finial position — so the dropdown was hidden on exactly the rows whose
                                                        projection has to match the bracket's. Any tagged end treatment gets it. */}
                                                    {/* BACKPLATES tag proj: too (Stuart 2026-08-14, H1-138: a backplate per bracket per projection). */}
                                                    {(['BRACKET', 'BACKPLATE'].includes(normalizeCategory(c.catOverride || r.category)) || !!String(c.endTreatment || '').trim()) && (
                                                        <select value={c.projInches || ''} title="PROJECTION — the 4.5 Master-Dictionary list (BRACKET PROJECTIONS). Brackets: the exact projection this item IS (shows only at that projection). FRENCH/MITER RETURN choices: the MINIMUM projection (returns need depth — tag 4-5/8 and they show at 4-5/8 AND 6, hidden below). '— any —' = always offered." onChange={e => setChoicePatch(r.clusterId, c.nodeName, { projInches: e.target.value })} style={{ ...inp, padding: '3px 4px', fontSize: '9px', fontFamily: 'var(--mono)', width: '110px', maxWidth: '110px', borderColor: c.projInches ? 'var(--brass)' : 'var(--line)', color: c.projInches ? 'var(--brass)' : 'var(--ink-soft)' }}>
                                                            <option value="">proj: — any —</option>
                                                            {((dictLists && dictLists.projections) || []).map(p => <option key={p} value={String(p).toUpperCase()}>proj: {p}"</option>)}
                                                        </select>
                                                    )}
                                                    {/* BACKPLATES tag mount: too (ceiling backplates — Stuart 2026-08-14). */}
                                                    {['BRACKET', 'BACKPLATE'].includes(normalizeCategory(c.catOverride || r.category)) && !c.isFee && (
                                                        <select value={c.mountType || ''} title="BRACKET MOUNT TYPE — the 4.5 Master-Dictionary list (BRACKET MOUNT TYPES); saved on the pin in the same vocabulary the Library editor + Vision engine use." onChange={e => setChoicePatch(r.clusterId, c.nodeName, { mountType: e.target.value })} style={{ ...inp, padding: '3px 4px', fontSize: '9px', fontFamily: 'var(--mono)', width: '110px', maxWidth: '110px', borderColor: c.mountType ? 'var(--brass)' : 'var(--line)', color: c.mountType ? 'var(--brass)' : 'var(--ink-soft)' }}>
                                                            <option value="">mount: — any —</option>
                                                            {((dictLists && dictLists.bracketMounts) || []).map(m => <option key={m} value={String(m).toUpperCase()}>mount: {m}</option>)}
                                                        </select>
                                                    )}
                                                    {/* An inside-mount bracket IS an end treatment (the H2-138 arrangement = canonical):
                                                        the generator re-homes it into this side's End Treatment step on Regenerate. Say so. */}
                                                    {normalizeCategory(c.catOverride || r.category) === 'BRACKET' && !c.isFee && normalizeLocation(c.mountType) === 'END' && (
                                                        <span title="Inside mount = an END TREATMENT: on Regenerate this choice pools into this side's End Treatment step tagged INSIDE MOUNT — it replaces the bracket (no separate bracket pick), excludes the finial, and the long rod stays. Same behavior as loading it in the END slot (the H2-138 arrangement)." style={{ fontFamily: 'var(--mono)', fontSize: '8px', color: 'var(--brass)', textTransform: 'uppercase', letterSpacing: '.05em', whiteSpace: 'nowrap' }}>→ end treatment</span>
                                                    )}
                                                    <select value={c.catOverride || ''} title="CATEGORY OVERRIDE — re-homes this choice into another pool at generate: a return backplate the designer dropped into a FINIAL slot pools with the BACKPLATES once set. Blank = the cluster's own category. No re-upload needed." onChange={e => setChoicePatch(r.clusterId, c.nodeName, { catOverride: e.target.value })} style={{ ...inp, padding: '3px 4px', fontSize: '9px', fontFamily: 'var(--mono)', width: '110px', maxWidth: '110px', borderColor: c.catOverride ? '#d9534f' : 'var(--line)', color: c.catOverride ? '#d9534f' : 'var(--ink-soft)' }}>
                                                        <option value="">cat: cluster</option>
                                                        {['BRACKET', 'BACKPLATE', 'FINIAL', 'POLE', 'RING'].map(k => <option key={k} value={k}>cat: {k.toLowerCase()}</option>)}
                                                    </select>
                                                    {normalizeCategory(c.catOverride || r.category) === 'BRACKET' && (
                                                        <label title="END RETURN ARM (Flat Iron pattern): this bracket IS the end treatment — selecting it greys that side's finial / inside-mount step; its backplate stays choosable (unless basic). Auto-detected when the library part is flagged isReturnBracket; check here to force it." style={{ display: 'flex', alignItems: 'center', gap: '6px', fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.05em', textTransform: 'uppercase', color: c.isReturnArm ? 'var(--brass)' : 'var(--ink-soft)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                                            <input type="checkbox" checked={!!c.isReturnArm} onChange={e => setChoicePatch(r.clusterId, c.nodeName, { isReturnArm: e.target.checked })} style={{ cursor: 'pointer', width: '15px', height: '15px', margin: 0, flexShrink: 0 }} />
                                                            end-arm
                                                        </label>
                                                    )}
                                                    {normalizeCategory(c.catOverride || r.category) === 'BACKPLATE' && (
                                                        <label title="RETURN BACKPLATE: offered ONLY while this end is a french/miter return or an end-return arm — the regular plates hide then (and this one hides otherwise). Use for the plates that pair with the return/arm." style={{ display: 'flex', alignItems: 'center', gap: '6px', fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.05em', textTransform: 'uppercase', color: c.returnOnly ? 'var(--brass)' : 'var(--ink-soft)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                                            <input type="checkbox" checked={!!c.returnOnly} onChange={e => setChoicePatch(r.clusterId, c.nodeName, { returnOnly: e.target.checked })} style={{ cursor: 'pointer', width: '15px', height: '15px', margin: 0, flexShrink: 0 }} />
                                                            rtn-only
                                                        </label>
                                                    )}
                                                    {normalizeCategory(c.catOverride || r.category) === 'BACKPLATE' && (
                                                        <label title="INLINE BACKPLATE: the INLINE-bracket copy of a shared return-style plate — offered ONLY while an inl-bkt (In Line) bracket is selected; the return-position copies (rtn-only) show for actual returns. Flows without inl-only plates fall back to rtn-only for In Line brackets." style={{ display: 'flex', alignItems: 'center', gap: '6px', fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.05em', textTransform: 'uppercase', color: c.inlineOnly ? 'var(--brass)' : 'var(--ink-soft)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                                            <input type="checkbox" checked={!!c.inlineOnly} onChange={e => setChoicePatch(r.clusterId, c.nodeName, { inlineOnly: e.target.checked })} style={{ cursor: 'pointer', width: '15px', height: '15px', margin: 0, flexShrink: 0 }} />
                                                            inl-only
                                                        </label>
                                                    )}
                                                </span>
                                                <span style={{ display: 'flex', gap: '2px' }}>
                                                    <button onClick={() => moveChoice(r.clusterId, c.nodeName, -1)} title="Move up — order is saved and drives the option order in the configurator (match Left/Right sides)" style={{ border: '1px solid var(--line)', background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer', fontSize: '9px', padding: '2px 5px', borderRadius: '2px' }}>▲</button>
                                                    <button onClick={() => moveChoice(r.clusterId, c.nodeName, 1)} title="Move down" style={{ border: '1px solid var(--line)', background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer', fontSize: '9px', padding: '2px 5px', borderRadius: '2px' }}>▼</button>
                                                    <button onClick={() => deleteChoice(r.clusterId, c.nodeName, c.label, c.itemNo)} title="Delete this choice — removes EVERY saved pin for this node (including stale ones with junk item #s) so it can never appear in a generated flow. The 3D node stays in the file; Load Choices will list it again as a blank row if the geometry still exists." style={{ border: '1px solid #d9534f', background: '#fff', color: '#d9534f', cursor: 'pointer', fontSize: '9px', padding: '2px 5px', borderRadius: '2px' }}>🗑</button>
                                                </span>
                                            </React.Fragment>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                        <button onClick={handleSaveItemNumbers} disabled={assignBusy} style={{ padding: '12px', background: assignBusy ? 'var(--paper-2)' : '#3a7d44', color: assignBusy ? 'var(--ink-soft)' : '#fff', border: 'none', cursor: assignBusy ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 600 }}>
                            {assignBusy ? 'Saving…' : '⬇ Save Item Numbers as Choice Pins'}
                        </button>
                        <span style={{ fontFamily: 'var(--sans)', fontSize: '0.78rem', color: 'var(--ink-soft)', textAlign: 'center' }}>Safe to save in passes — saved numbers come back prefilled on the next Load Choices; blanks just don't create pins yet.</span>
                    </div>
                )}
            </div>

            {/* Sync BOM ↔ Library: link an assembly's pins to their existing Master-Library parts. */}
            <div style={{ ...card, borderColor: 'var(--brass)', padding: '16px 18px', display: 'flex', gap: '14px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '240px' }}>
                    <span style={{ ...lbl, color: 'var(--brass)' }}>Sync BOM ↔ Library</span>
                    <span style={{ fontFamily: 'var(--sans)', fontSize: '0.82rem', color: 'var(--ink-soft)', display: 'block' }}>If Visual Assembly shows this assembly's items as new/leftover (brass) even though the item #s are real: links every pin to its existing Master-Library part (name, ERP id, specs) and wires per-choice node thumbnails. Item #s, flags &amp; order unchanged.</span>
                </div>
                <div style={{ minWidth: '260px' }}>
                    <span style={lbl}>Assembly</span>
                    <select value={syncId} onChange={e => setSyncId(e.target.value)} style={{ ...sel, width: '100%', padding: '9px' }}>
                        <option value="">Select an assembly…</option>
                        {repairList.map(a => <option key={a.id} value={a.id}>{a.itemName || a.id}</option>)}
                    </select>
                </div>
                <button onClick={handleSyncPinsToLibrary} disabled={syncBusy || !syncId} style={{ padding: '11px 22px', background: syncBusy ? 'var(--paper-2)' : 'var(--ink)', color: syncBusy ? 'var(--ink-soft)' : '#fff', border: 'none', cursor: syncBusy ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' }}>
                    {syncBusy ? '⚙ Syncing…' : '⚙ Link Pins to Library'}
                </button>
            </div>

            {/* FLEX-WRAP, not a fixed grid (Liesl 2026-08-12: "see all check boxes on screen
                without having to scroll over to see those hidden by assembly visual") — when the
                window can't fit slot rows AND the 3D visual side by side, the visual WRAPS BELOW
                instead of sitting on top of the checkboxes. Wide screens look exactly as before. */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '18px', alignItems: 'flex-start' }}>
                {/* LEFT: slot uploader */}
                <div style={{ ...card, flex: '1.15 1 680px', minWidth: 0, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '78vh', overflowY: 'auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', color: 'var(--ink)' }}>Slots — one .glb each (choices stacked inside)</span>
                        <button onClick={addSlot} style={{ ...sel, cursor: 'pointer', background: 'var(--paper-2)' }}>+ Slot</button>
                    </div>
                    {slots.map(slot => {
                        const layer = layers[slot.id];
                        return (
                            <div key={slot.id} style={{ border: `1px solid ${layer ? 'var(--brass)' : 'var(--line)'}`, background: layer ? 'var(--paper)' : '#fff', padding: '12px', borderRadius: '2px' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 0.9fr auto', gap: '8px', alignItems: 'center' }}>
                                    <input value={slot.label} onChange={e => patchSlotLabel(slot.id, e.target.value)} style={{ ...inp, padding: '6px 8px', fontSize: '0.8rem', fontWeight: 500 }} />
                                    <select value={slot.category} onChange={e => patchSlot(slot.id, { category: e.target.value, manualMeta: true })} style={sel}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select>
                                    <select value={slot.position} onChange={e => patchSlot(slot.id, { position: e.target.value, manualMeta: true })} style={sel}>{POSITIONS.map(c => <option key={c}>{c}</option>)}</select>
                                    <select value={slot.location} onChange={e => patchSlot(slot.id, { location: e.target.value, manualMeta: true })} style={sel}>{LOCATIONS.map(c => <option key={c} value={c}>{c || '—'}</option>)}</select>
                                    <button onClick={() => removeSlot(slot.id)} title="Remove slot" style={{ border: 'none', background: 'none', color: 'var(--ink-soft)', cursor: 'pointer', fontSize: '1.1rem' }}>×</button>
                                </div>
                                {slot.desc && (
                                    <div style={{ marginTop: '6px', fontFamily: 'var(--sans)', fontSize: '0.78rem', lineHeight: 1.4, color: 'var(--ink-soft)' }}>
                                        <span style={{ fontFamily: 'var(--mono)', fontSize: '8px', letterSpacing: '.1em', textTransform: 'uppercase', color: layer ? 'var(--brass)' : 'var(--ink-soft)', border: '1px solid var(--line)', borderRadius: '2px', padding: '1px 5px', marginRight: '7px', whiteSpace: 'nowrap' }}>optional</span>
                                        {slot.desc}
                                    </div>
                                )}
                                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '8px' }}>
                                    <label style={{ ...sel, cursor: 'pointer', background: 'var(--ink)', color: '#fff', textTransform: 'uppercase' }}>
                                        {busy === slot.id ? 'Loading…' : (layer ? 'Replace .glb' : 'Upload .glb')}
                                        <input type="file" accept=".glb,.gltf,.fbx" style={{ display: 'none' }} onChange={e => onUpload(slot, e.target.files[0])} />
                                    </label>
                                    {layer && <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>{layer.fileName} · {(layer.choices || []).length} choice(s)</span>}
                                    {layer && <button onClick={() => removeLayer(slot.id)} style={{ ...sel, cursor: 'pointer', marginLeft: 'auto' }}>clear</button>}
                                </div>
                                {layer && (
                                    <div style={{ marginTop: '10px', borderTop: '1px dashed var(--line)', paddingTop: '10px' }}>
                                        <div style={{ ...lbl, marginBottom: '6px' }}>Choices → item # (each becomes a CPQ swap option + BOM line) · blank = shared hardware</div>
                                        <div style={{ display: 'grid', gridTemplateColumns: normalizeCategory(slot.category) === 'FINIAL' ? '40px minmax(130px,200px) 180px 110px minmax(280px,1fr) 40px' : '40px minmax(130px,200px) 180px minmax(280px,1fr) 40px', gap: '5px 10px', alignItems: 'center' }}>
                                            {(layer.choices || []).map(c => (
                                                <React.Fragment key={c.nodeName}>
                                                    {c.thumb
                                                        ? <img src={c.thumb} alt="" title="Click to enlarge" onClick={() => setZoomThumb({ url: c.thumb, label: `${slot.label} · ${c.label}${c.itemNo ? ` · ${c.itemNo}` : ''}` })} style={{ width: '38px', height: '38px', objectFit: 'contain', background: 'var(--paper-2)', border: '1px solid var(--line)', borderRadius: '2px', cursor: 'zoom-in' }} />
                                                        : <span style={{ width: '38px', height: '38px', border: '1px dashed var(--line)', borderRadius: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '7px', color: 'var(--ink-soft)' }}>…</span>}
                                                    <span style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
                                                        <span title={c.nodeName} style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</span>
                                                        <button onClick={() => splitSlotChoice(slot.id, c.nodeName)} title="Several parts merged under one wrapper node? Split it into its named sub-parts, each with its own thumbnail and item #." style={{ border: '1px solid var(--line)', background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '8px', letterSpacing: '.05em', textTransform: 'uppercase', padding: '1px 5px', borderRadius: '2px', flexShrink: 0 }}>⤢</button>
                                                    </span>
                                                    <span style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
                                                        <input value={c.itemNo} list="ab-item-codes" onChange={e => setSlotChoicePatch(slot.id, c.nodeName, { itemNo: e.target.value })} placeholder={c.isFee ? 'fee — item # optional (links the fee entity, e.g. CE-FEE-4594, for pricing)' : (c.isHidden ? 'hidden — item # optional (adds to BOM)' : 'item # — type to search')} style={{ ...inp, padding: '4px 7px', fontSize: '0.75rem', fontFamily: 'var(--mono)', borderColor: c.isFee ? 'var(--line)' : (c.itemNo ? 'var(--brass)' : 'var(--line)'), opacity: c.isFee ? 0.5 : 1 }} />
                                                        {/* DESIGNER NOTE — same grid CELL as the item # (a sibling input became its
                                                            own grid cell and wrecked the row layout, Stuart 2026-08-10). */}
                                                        <input value={c.note || ''} onChange={e => setSlotChoicePatch(slot.id, c.nodeName, { note: e.target.value })} placeholder="note — what is it / where does it sit" maxLength={120} style={{ ...inp, padding: '3px 7px', fontSize: '0.7rem', fontStyle: 'italic', borderColor: c.note ? 'var(--brass)' : 'var(--line)', opacity: 0.85 }} />
                                                    </span>
                                                    {normalizeCategory(slot.category) === 'FINIAL' && (normalizeCategory(c.catOverride || slot.category) !== 'FINIAL' ? (
                                                        <span title="Re-homed by the cat: override — end treatment only applies to finial-slot choices; this row now carries its new category's flags instead." style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: '#d9534f', textTransform: 'uppercase', letterSpacing: '.05em' }}>→ {String(c.catOverride).toLowerCase()}</span>
                                                    ) : (
                                                        <select value={c.endTreatment || ''} title="END TREATMENT — the explicit tag the generator + CPQ + Vision read (no more name-sniffing). FINIAL = decorative end. FRENCH/MITER RETURN = fee, replaces this side's bracket + hides the long rod half. INSIDE MOUNT = real part, replaces the bracket." onChange={e => { const et = e.target.value; setSlotChoicePatch(slot.id, c.nodeName, { endTreatment: et, ...(et === 'FRENCH_RETURN' || et === 'MITER_RETURN' ? { isFee: true, isHidden: false, isBasic: false, usesReturnPlates: false } : {}) }); }} style={{ ...inp, padding: '3px 5px', fontSize: '8px', fontFamily: 'var(--mono)', textTransform: 'uppercase', width: '106px', borderColor: c.endTreatment && c.endTreatment !== 'FINIAL' ? 'var(--brass)' : 'var(--line)' }}>
                                                            <option value="">— end type —</option>
                                                            {END_TREATMENTS.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                                                        </select>
                                                    ))}
                                                    {/* WRAPPING flags cell (Liesl 2026-08-12): flex-wrap folds the checkboxes
                                                        into more rows instead of widening the grid past the visible panel. */}
                                                    <span style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', alignItems: 'center', minWidth: 0 }}>
                                                        <label title="Fee choice (e.g. a french-return bend): selectable option that bills as a fee — no item # / BOM line." style={{ display: 'flex', alignItems: 'center', gap: '5px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: c.isFee ? 'var(--brass)' : 'var(--ink-soft)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                                            <input type="checkbox" checked={!!c.isFee} onChange={e => setSlotChoicePatch(slot.id, c.nodeName, { isFee: e.target.checked, ...(e.target.checked ? { isHidden: false, isBasic: false, usesReturnPlates: false } : {}) })} style={{ cursor: 'pointer', width: '15px', height: '15px', margin: 0, flexShrink: 0 }} />fee
                                                        </label>
                                                        <label title="Force-hidden in every configuration (stray geometry that should never render)." style={{ display: 'flex', alignItems: 'center', gap: '5px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: c.isHidden ? '#d9534f' : 'var(--ink-soft)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                                            <input type="checkbox" checked={!!c.isHidden} onChange={e => setSlotChoicePatch(slot.id, c.nodeName, { isHidden: e.target.checked, ...(e.target.checked ? { isFee: false, isBasic: false, usesReturnPlates: false } : {}) })} style={{ cursor: 'pointer', width: '15px', height: '15px', margin: 0, flexShrink: 0 }} />hide
                                                        </label>
                                                        <label title="Basic bracket: takes NO backplate — the backplate picker greys to None when this bracket is selected. Keep the item # filled." style={{ display: 'flex', alignItems: 'center', gap: '5px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: c.isBasic ? 'var(--brass)' : 'var(--ink-soft)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                                            <input type="checkbox" checked={!!c.isBasic} onChange={e => setSlotChoicePatch(slot.id, c.nodeName, { isBasic: e.target.checked, ...(e.target.checked ? { isFee: false, isHidden: false, usesReturnPlates: false } : {}) })} style={{ cursor: 'pointer', width: '15px', height: '15px', margin: 0, flexShrink: 0 }} />basic
                                                        </label>
                                                        <label title="INLINE BRACKET (the bracket-side sibling of the basic tag): while this In Line arm is the selected bracket, the plate picker shows the INLINE plates (inl-only copies) — or the RETURN plates when the flow has no inline copies. This tag is how the system knows a bracket is In Line." style={{ display: 'flex', alignItems: 'center', gap: '5px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: c.usesReturnPlates ? 'var(--brass)' : 'var(--ink-soft)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                                            <input type="checkbox" checked={!!c.usesReturnPlates} onChange={e => setSlotChoicePatch(slot.id, c.nodeName, { usesReturnPlates: e.target.checked, ...(e.target.checked ? { isFee: false, isHidden: false, isBasic: false } : {}) })} style={{ cursor: 'pointer', width: '15px', height: '15px', margin: 0, flexShrink: 0 }} />inl-bkt
                                                        </label>
                                                        {normalizeCategory(c.catOverride || slot.category) === 'FINIAL' && (
                                                            <label title="COLLAR — this choice is the metal collar of a TWO-PART finial: companion geometry, never its own option. Pair each top via the tops' collar: dropdown." style={{ display: 'flex', alignItems: 'center', gap: '5px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: c.isCollar ? 'var(--brass)' : 'var(--ink-soft)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                                                <input type="checkbox" checked={!!c.isCollar} onChange={e => setSlotChoicePatch(slot.id, c.nodeName, { isCollar: e.target.checked, ...(e.target.checked ? { isFee: false, isHidden: false, requiresCollar: '' } : {}) })} style={{ cursor: 'pointer', width: '15px', height: '15px', margin: 0, flexShrink: 0 }} />collar
                                                            </label>
                                                        )}
                                                        <select disabled={!!c.isFee} value={c.isFee ? '' : ((c.custIds && c.custIds[0]) || '')} title={c.isFee ? "Not available on a FEE choice — customer scope is not saved for fees. Put the customer's pricing on the fee ITEM in the Master Library." : "CUSTOMER-ONLY choice: shows on CPQ/portal only for this customer ('cust: all' = everyone)."} onFocus={() => ensureCustomers()} onChange={e => { const id = e.target.value; const nm = ((custList || []).find(x => x.id === id) || {}).name || ''; setSlotChoicePatch(slot.id, c.nodeName, { custIds: id ? [id] : [], custNames: id ? [nm] : [] }); }} style={{ ...inp, padding: '3px 4px', fontSize: '9px', fontFamily: 'var(--mono)', width: '110px', maxWidth: '110px', borderColor: (c.custIds && c.custIds.length) ? 'var(--brass)' : 'var(--line)', color: (c.custIds && c.custIds.length) ? 'var(--brass)' : 'var(--ink-soft)' }}>
                                                            <option value="">cust: all</option>
                                                            {(custList || []).map(cu => <option key={cu.id} value={cu.id}>{cu.name}</option>)}
                                                        </select>
                                                        {normalizeCategory(c.catOverride || slot.category) === 'FINIAL' && !c.isCollar && (
                                                            <select value={c.requiresCollar || ''} title="PAIR WITH COLLAR (two-part finial top): pick the COLLAR-flagged choice (its item #) this top renders WITH. '— none —' = a one-piece finial. A ⚠ row = a choice ticked COLLAR that still needs its item # typed in." onChange={e => setSlotChoicePatch(slot.id, c.nodeName, { requiresCollar: e.target.value })} style={{ ...inp, padding: '3px 4px', fontSize: '9px', fontFamily: 'var(--mono)', width: '110px', maxWidth: '110px', borderColor: c.requiresCollar ? 'var(--brass)' : 'var(--line)', color: c.requiresCollar ? 'var(--brass)' : 'var(--ink-soft)' }}>
                                                                <option value="">collar: — none —</option>
                                                                {slotCollarCands.codes.map(code => <option key={code} value={code}>{code}</option>)}
                                                                {slotCollarCands.pending.map((lbl, i) => <option key={`pend-${i}`} value="" disabled>⚠ {lbl} — needs item #</option>)}
                                                                {c.requiresCollar && !slotCollarCands.codes.some(code => code.toUpperCase() === String(c.requiresCollar).toUpperCase()) && <option value={c.requiresCollar}>{c.requiresCollar}</option>}
                                                            </select>
                                                        )}
                                                        {(['BRACKET', 'BACKPLATE'].includes(normalizeCategory(c.catOverride || slot.category)) || !!String(c.endTreatment || '').trim()) && (
                                                            <select value={c.projInches || ''} title="PROJECTION — 4.5 Master-Dictionary list. Brackets: the exact projection this item IS. FRENCH/MITER RETURN choices: the MINIMUM projection (tag 4-5/8 → shows at 4-5/8 AND 6). '— any —' = always offered." onChange={e => setSlotChoicePatch(slot.id, c.nodeName, { projInches: e.target.value })} style={{ ...inp, padding: '3px 4px', fontSize: '9px', fontFamily: 'var(--mono)', width: '110px', maxWidth: '110px', borderColor: c.projInches ? 'var(--brass)' : 'var(--line)', color: c.projInches ? 'var(--brass)' : 'var(--ink-soft)' }}>
                                                                <option value="">proj: — any —</option>
                                                                {((dictLists && dictLists.projections) || []).map(p => <option key={p} value={String(p).toUpperCase()}>proj: {p}"</option>)}
                                                            </select>
                                                        )}
                                                        {['BRACKET', 'BACKPLATE'].includes(normalizeCategory(c.catOverride || slot.category)) && !c.isFee && (
                                                            <select value={c.mountType || ''} title="BRACKET MOUNT TYPE — the 4.5 Master-Dictionary list (BRACKET MOUNT TYPES); saved on the pin in the Vision vocabulary." onChange={e => setSlotChoicePatch(slot.id, c.nodeName, { mountType: e.target.value })} style={{ ...inp, padding: '3px 4px', fontSize: '9px', fontFamily: 'var(--mono)', width: '110px', maxWidth: '110px', borderColor: c.mountType ? 'var(--brass)' : 'var(--line)', color: c.mountType ? 'var(--brass)' : 'var(--ink-soft)' }}>
                                                                <option value="">mount: — any —</option>
                                                                {((dictLists && dictLists.bracketMounts) || []).map(m => <option key={m} value={String(m).toUpperCase()}>mount: {m}</option>)}
                                                            </select>
                                                        )}
                                                        {normalizeCategory(c.catOverride || slot.category) === 'BRACKET' && !c.isFee && normalizeLocation(c.mountType) === 'END' && (
                                                            <span title="Inside mount = an END TREATMENT: on Regenerate this choice pools into this side's End Treatment step tagged INSIDE MOUNT — it replaces the bracket, excludes the finial, and the long rod stays. Same as loading it in the END slot (the H2-138 arrangement)." style={{ fontFamily: 'var(--mono)', fontSize: '8px', color: 'var(--brass)', textTransform: 'uppercase', letterSpacing: '.05em', whiteSpace: 'nowrap' }}>→ end treatment</span>
                                                        )}
                                                        <select value={c.catOverride || ''} title="CATEGORY OVERRIDE — re-homes this choice into another pool at generate (blank = the cluster's own category)." onChange={e => setSlotChoicePatch(slot.id, c.nodeName, { catOverride: e.target.value })} style={{ ...inp, padding: '3px 4px', fontSize: '9px', fontFamily: 'var(--mono)', width: '110px', maxWidth: '110px', borderColor: c.catOverride ? '#d9534f' : 'var(--line)', color: c.catOverride ? '#d9534f' : 'var(--ink-soft)' }}>
                                                            <option value="">cat: cluster</option>
                                                            {['BRACKET', 'BACKPLATE', 'FINIAL', 'POLE', 'RING'].map(k => <option key={k} value={k}>cat: {k.toLowerCase()}</option>)}
                                                        </select>
                                                        {normalizeCategory(c.catOverride || slot.category) === 'BRACKET' && (
                                                            <label title="END RETURN ARM (Flat Iron pattern): this bracket IS the end treatment — greys that side's finial / inside-mount step; backplate stays choosable (unless basic)." style={{ display: 'flex', alignItems: 'center', gap: '5px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: c.isReturnArm ? 'var(--brass)' : 'var(--ink-soft)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                                                <input type="checkbox" checked={!!c.isReturnArm} onChange={e => setSlotChoicePatch(slot.id, c.nodeName, { isReturnArm: e.target.checked })} style={{ cursor: 'pointer', width: '15px', height: '15px', margin: 0, flexShrink: 0 }} />end-arm
                                                            </label>
                                                        )}
                                                        {normalizeCategory(c.catOverride || slot.category) === 'BACKPLATE' && (
                                                            <label title="RETURN BACKPLATE: offered ONLY while this end is a return / end-return arm; regular plates hide then." style={{ display: 'flex', alignItems: 'center', gap: '5px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: c.returnOnly ? 'var(--brass)' : 'var(--ink-soft)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                                                <input type="checkbox" checked={!!c.returnOnly} onChange={e => setSlotChoicePatch(slot.id, c.nodeName, { returnOnly: e.target.checked })} style={{ cursor: 'pointer', width: '15px', height: '15px', margin: 0, flexShrink: 0 }} />rtn-only
                                                            </label>
                                                        )}
                                                        {normalizeCategory(c.catOverride || slot.category) === 'BACKPLATE' && (
                                                            <label title="INLINE BACKPLATE: inline-bracket copy of a shared return-style plate — offered only while an inl-bkt bracket is selected." style={{ display: 'flex', alignItems: 'center', gap: '5px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: c.inlineOnly ? 'var(--brass)' : 'var(--ink-soft)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                                                <input type="checkbox" checked={!!c.inlineOnly} onChange={e => setSlotChoicePatch(slot.id, c.nodeName, { inlineOnly: e.target.checked })} style={{ cursor: 'pointer', width: '15px', height: '15px', margin: 0, flexShrink: 0 }} />inl-only
                                                            </label>
                                                        )}
                                                    </span>
                                                    <span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                        <button onClick={() => moveSlotChoice(slot.id, c.nodeName, -1)} title="Move up — order is saved (choiceSort) and drives the option order in the configurator" style={{ border: '1px solid var(--line)', background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer', fontSize: '8px', padding: '1px 4px', borderRadius: '2px' }}>▲</button>
                                                        <button onClick={() => moveSlotChoice(slot.id, c.nodeName, 1)} title="Move down" style={{ border: '1px solid var(--line)', background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer', fontSize: '8px', padding: '1px 4px', borderRadius: '2px' }}>▼</button>
                                                    </span>
                                                </React.Fragment>
                                            ))}
                                        </div>
                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px' }}>
                                            <span style={lbl}>Nudge</span>
                                            {['x', 'y', 'z'].map(ax => (
                                                <label key={ax} style={{ display: 'flex', alignItems: 'center', gap: '3px', fontFamily: 'var(--mono)', fontSize: '10px' }}>{ax.toUpperCase()}
                                                    <input type="number" step="0.1" value={layer.offset[ax]} onChange={e => nudge(slot.id, ax, e.target.value)} style={{ width: '54px', ...inp, padding: '4px', fontSize: '0.75rem' }} />
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    <button onClick={build} disabled={busy === 'build' || !filledSlots.length} style={{ marginTop: '8px', padding: '15px', background: busy === 'build' ? 'var(--paper-2)' : '#3a7d44', color: busy === 'build' ? 'var(--ink-soft)' : '#fff', border: 'none', cursor: busy === 'build' ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 600 }}>
                        {busy === 'build' ? 'Building…' : (extendId ? `⚙ Add ${filledSlots.length} Slot${filledSlots.length === 1 ? '' : 's'} to Assembly` : `⚙ Build Assembly (${filledSlots.length} slot${filledSlots.length === 1 ? '' : 's'})`)}
                    </button>
                </div>

                {/* RIGHT: live preview */}
                <div style={{ ...card, flex: '1 1 380px', minWidth: '340px', position: 'sticky', top: '16px', height: '78vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', background: 'var(--paper)', fontFamily: 'var(--serif)', fontSize: '1.1rem', color: 'var(--ink)' }}>
                        Live Preview — {filledSlots.length} layer(s){extendId ? (extendInfo?.loading ? ' · loading existing…' : extendInfo?.scene ? ' · + existing assembly' : '') : ''}
                    </div>
                    {extendId && (
                        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', background: '#fff8ec', maxHeight: '150px', overflowY: 'auto' }}>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-soft)', marginBottom: '6px' }}>
                                Extending: {extendInfo?.name || '…'} — existing content (untouched; new slots are APPENDED)
                            </div>
                            {extendInfo?.loading && <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>Loading the existing assembly…</div>}
                            {extendInfo?.error && <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: '#d9534f' }}>⚠ {extendInfo.error}</div>}
                            {!extendInfo?.loading && (extendInfo?.clusters || []).length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                    {extendInfo.clusters.map(c => (
                                        <span key={c.id} style={{ fontFamily: 'var(--mono)', fontSize: '9px', background: '#fff', border: '1px solid var(--line)', padding: '3px 8px', color: 'var(--ink)' }}>
                                            {c.name || c.id}{c.category ? ` · ${c.category}` : ''}{c.position ? ` · ${c.position}` : ''}{(c.nodes || []).length ? ` · ${(c.nodes || []).length}n` : ''}
                                        </span>
                                    ))}
                                </div>
                            )}
                            {!extendInfo?.loading && !(extendInfo?.clusters || []).length && !extendInfo?.error && (
                                <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>No clusters recorded on this assembly.</div>
                            )}
                        </div>
                    )}
                    <div style={{ flex: 1, background: '#f2efe8' }}>
                        <Canvas camera={{ position: [5, 5, 5], fov: 45 }}>
                            <ambientLight intensity={0.8} />
                            <directionalLight position={[10, 10, 5]} intensity={1} />
                            <directionalLight position={[-8, 4, -6]} intensity={0.5} />
                            {extendInfo?.scene && <primitive object={extendInfo.scene} />}
                            {filledSlots.map(slot => (
                                <primitive key={slot.id} object={layers[slot.id].scene} position={[layers[slot.id].offset.x, layers[slot.id].offset.y, layers[slot.id].offset.z]} />
                            ))}
                            <OrbitControls makeDefault />
                            <gridHelper args={[10, 10, '#c9c4ba', '#e5e1d8']} />
                        </Canvas>
                    </div>
                    {log.length > 0 && (
                        <div style={{ maxHeight: '110px', overflowY: 'auto', padding: '8px 12px', borderTop: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', background: '#fff' }}>
                            {log.map((l, i) => <div key={i} style={{ color: l.type === 'error' ? '#d9534f' : l.type === 'success' ? '#3a7d44' : 'var(--ink-soft)' }}><span style={{ opacity: .5 }}>[{l.t}]</span> {l.m}</div>)}
                        </div>
                    )}
                </div>
            </div>

            {/* Searchable item-# picker source, shared by the uploader AND the assign tool: type in
                any item field to filter this alphabetical Master-Library list (native datalist). */}
            <datalist id="ab-item-codes">
                {codeOptions.map(o => <option key={o.code} value={o.code}>{o.name}</option>)}
            </datalist>

            {/* Enlarged-thumbnail overlay: click any choice thumbnail to identify the part; click
                anywhere (or ×) to close. */}
            {zoomThumb && (
                <div onClick={() => setZoomThumb(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,18,14,0.72)', zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}>
                    <div style={{ background: '#fff', borderRadius: '2px', padding: '18px 18px 14px', maxWidth: 'min(640px, 92vw)', textAlign: 'center', boxShadow: '0 18px 60px rgba(0,0,0,0.35)' }}>
                        <img src={zoomThumb.url} alt="" style={{ width: 'min(560px, 84vw)', height: 'min(560px, 60vh)', objectFit: 'contain', background: 'var(--paper-2)', border: '1px solid var(--line)' }} />
                        <div style={{ marginTop: '10px', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink)', wordBreak: 'break-all' }}>{zoomThumb.label}</div>
                        <div style={{ marginTop: '4px', fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.08em' }}>click anywhere to close</div>
                    </div>
                </div>
            )}

            {/* ⚙ FUSION IMPORT — .fbx → house .glb conversion checklist (replaces the Blender pass):
                unit hypothesis + measured dims (the validator), keep/drop + rename per component,
                PRODUCTION (inches) vs SPEC (true meters) export. */}
            {fusionJob && (() => {
                const job = fusionJob;
                const unit = UNIT_CHOICES.find(u => u.id === job.unitId) || UNIT_CHOICES[0];
                const dimsIn = (size) => size.map(v => v * unit.toIn);
                const fmt = (v) => (v >= 10 ? v.toFixed(1) : v.toFixed(2));
                const suspicious = (d) => d.some(v => v > 120) || Math.max(...d) < 0.05;
                const keptCount = job.rows.filter(r => r.keep).length;
                const totalTris = job.rows.filter(r => r.keep).reduce((s, r) => s + r.tris, 0);
                const patchRow = (key, patch) => setFusionJob(j => ({ ...j, rows: j.rows.map(r => r.key === key ? { ...r, ...patch } : r) }));
                return (
                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,18,14,0.72)', zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ background: '#fff', borderRadius: '2px', padding: '26px 28px', width: 'min(860px, 94vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 18px 60px rgba(0,0,0,0.35)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
                                <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.5rem', color: 'var(--ink)' }}>⚙ Fusion Import — {job.slot?.label}</h3>
                                <button onClick={() => setFusionJob(null)} style={{ background: 'transparent', border: 'none', fontSize: '1.3rem', cursor: 'pointer', color: 'var(--ink-soft)', lineHeight: 1 }}>×</button>
                            </div>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '14px' }}>
                                {job.fileName}{job.analysis ? ` · FBX unit factor ${job.analysis.unitScaleFactor ?? '?'} · ${job.rows.length} component(s)` : ''} · no Blender required
                            </div>

                            {job.busy && !job.analysis && <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'var(--serif)', fontStyle: 'italic', color: 'var(--ink-soft)', fontSize: '1.1rem' }}>Reading Fusion export…</div>}
                            {job.err && <div style={{ padding: '12px 14px', background: '#fdf0ef', border: '1px solid #d9534f', color: '#a94442', fontFamily: 'var(--mono)', fontSize: '11px', marginBottom: '12px' }}>{job.err}</div>}

                            {job.analysis && (
                                <>
                                    <div style={{ display: 'flex', gap: '18px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
                                        <div>
                                            <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-soft)', display: 'block', marginBottom: '4px' }}>Source units (auto-detected — dims below must read right)</span>
                                            <div style={{ display: 'flex', gap: '6px' }}>
                                                {UNIT_CHOICES.map(u => (
                                                    <button key={u.id} onClick={() => setFusionJob(j => ({ ...j, unitId: u.id }))} style={{ padding: '7px 12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', cursor: 'pointer', border: `1px solid ${job.unitId === u.id ? 'var(--brass)' : 'var(--line)'}`, background: job.unitId === u.id ? 'var(--brass)' : '#fff', color: job.unitId === u.id ? '#fff' : 'var(--ink)' }}>{u.label}</button>
                                                ))}
                                            </div>
                                        </div>
                                        <div>
                                            <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-soft)', display: 'block', marginBottom: '4px' }}>Export flavor</span>
                                            <div style={{ display: 'flex', gap: '6px' }}>
                                                <button onClick={() => setFusionJob(j => ({ ...j, mode: 'PRODUCTION' }))} title="Geometry in inches — the master-GLB render convention (CPQ / Vision)" style={{ padding: '7px 12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', cursor: 'pointer', border: `1px solid ${job.mode === 'PRODUCTION' ? 'var(--ink)' : 'var(--line)'}`, background: job.mode === 'PRODUCTION' ? 'var(--ink)' : '#fff', color: job.mode === 'PRODUCTION' ? '#fff' : 'var(--ink)' }}>Production (in)</button>
                                                <button onClick={() => setFusionJob(j => ({ ...j, mode: 'SPEC' }))} title="Geometry in TRUE meters — for spec-master assemblies the 📐 dimension tool measures" style={{ padding: '7px 12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', cursor: 'pointer', border: `1px solid ${job.mode === 'SPEC' ? 'var(--ink)' : 'var(--line)'}`, background: job.mode === 'SPEC' ? 'var(--ink)' : '#fff', color: job.mode === 'SPEC' ? '#fff' : 'var(--ink)' }}>Spec (true m)</button>
                                            </div>
                                        </div>
                                        <div style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>{keptCount}/{job.rows.length} kept · ~{Math.round(totalTris / 1000)}k tris</div>
                                    </div>

                                    <div style={{ overflowY: 'auto', border: '1px solid var(--line)', flex: 1, minHeight: '160px' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                            <thead style={{ position: 'sticky', top: 0, background: 'var(--paper)' }}>
                                                <tr>{['Keep', 'Mesh name (edit — item code + SIDE)', 'Fusion component', 'Bodies', 'Tris', `W × H × D (inches)`].map((h, i) => <th key={h} style={{ padding: '8px 10px', textAlign: i >= 3 ? 'center' : 'left', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-soft)', borderBottom: '2px solid var(--ink)' }}>{h}</th>)}</tr>
                                            </thead>
                                            <tbody>
                                                {job.rows.map(r => {
                                                    const d = dimsIn(r.size);
                                                    const bad = suspicious(d);
                                                    return (
                                                        <tr key={r.key} style={{ opacity: r.keep ? 1 : 0.45 }}>
                                                            <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--paper-2)' }}><input type="checkbox" checked={r.keep} onChange={e => patchRow(r.key, { keep: e.target.checked })} /></td>
                                                            <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--paper-2)' }}>
                                                                <input value={r.finalName} onChange={e => patchRow(r.key, { finalName: e.target.value })} style={{ width: '100%', padding: '6px 8px', border: `1px solid ${r.matched ? '#7dbb81' : 'var(--line)'}`, fontFamily: 'var(--mono)', fontSize: '11px', outline: 'none', boxSizing: 'border-box' }} />
                                                            </td>
                                                            <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--paper-2)', fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.origName}>{r.origName}</td>
                                                            <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--paper-2)', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink-soft)' }}>{r.bodies}</td>
                                                            <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--paper-2)', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink-soft)' }}>{(r.tris / 1000).toFixed(1)}k</td>
                                                            <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--paper-2)', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '11px', color: bad ? '#d9534f' : 'var(--ink)', fontWeight: bad ? 700 : 400 }} title={bad ? 'Implausible size — wrong source-unit hypothesis? Switch units above until these read as real inches.' : ''}>{d.map(fmt).join(' × ')}{bad ? ' ⚠' : ''}</td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>

                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', margin: '10px 0 14px' }}>
                                        Green name = matched to a Master Library code. Bodies merge to ONE mesh per row (position+normal only, neutral material — the engine colors by finish). ⚠ dims = pick a different source unit before converting; these numbers are what the spec sheets will measure.
                                    </div>

                                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                                        <button onClick={() => setFusionJob(null)} style={{ padding: '12px 22px', background: 'transparent', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase' }}>Cancel</button>
                                        <button onClick={() => runFusionConvert(true)} disabled={job.busy || !keptCount} style={{ padding: '12px 22px', background: '#fff', border: '1px solid var(--ink)', color: 'var(--ink)', cursor: job.busy || !keptCount ? 'not-allowed' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase' }}>{job.busy ? 'Working…' : '⬇ Download .glb'}</button>
                                        <button onClick={() => runFusionConvert(false)} disabled={job.busy || !keptCount} style={{ padding: '12px 22px', background: job.busy || !keptCount ? 'var(--paper-2)' : 'var(--brass)', color: job.busy || !keptCount ? 'var(--ink-soft)' : '#fff', border: 'none', cursor: job.busy || !keptCount ? 'not-allowed' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' }}>{job.busy ? 'Converting…' : '✓ Convert & Load into Slot'}</button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}

export default AssemblyBuilderTab;
