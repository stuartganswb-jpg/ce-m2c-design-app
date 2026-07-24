import React, { useState, useRef, useEffect } from 'react';
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
        const parts = snap.docs.map(d => d.data())
            .filter(x => !activeBrand || x.brandId === activeBrand || (Array.isArray(x.sharedBrands) && x.sharedBrands.includes(activeBrand)))
            .map(x => ({ legacyErpId: x.legacyErpId, itemId: x.itemId, itemName: x.itemName }));
        const index = buildCodeIndex(parts);
        // Normalized-code COLLISIONS are kept (H1-75BPR ring vs H1-75BP-R backplate both norm to
        // H175BPR) — byNorm maps norm → ARRAY of entries; exact-raw lookups pick within it.
        const byNorm = new Map(); index.forEach(e => { const a = byNorm.get(e.norm); if (a) a.push(e); else byNorm.set(e.norm, [e]); });
        codeIndexRef.current = { brand: activeBrand, index, byNorm };
        return index;
    };
    const optionsFromIndex = (index) => index.filter(e => e.code === e.erp && !/-\d{12,}/.test(e.code)).sort((a, b) => a.code.localeCompare(b.code)); // suggestions = real ERP codes only, never app-internal itemIds
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
        setFusionJob({ slot, fileName: file.name, buffer: null, analysis: null, rows: [], unitId: 'cm', mode: 'PRODUCTION', busy: true, err: '' });
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
                return { nodeName: nm, label: nm, itemNo: m ? m.code : '', endTreatment: et, isFee: et === 'FRENCH_RETURN' || et === 'MITER_RETURN', isHidden: false, isBasic: false, usesReturnPlates: false, isReturnArm: false, returnOnly: false, inlineOnly: false, isCollar: false, requiresCollar: '', projInches: '', mountType: '', custIds: [], custNames: [], thumb: '' };
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
                    return { nodeName: nm, label: nm, itemNo: m ? m.code : '', endTreatment: et, isFee: et === 'FRENCH_RETURN' || et === 'MITER_RETURN', isHidden: false, isBasic: false, usesReturnPlates: false, isReturnArm: false, returnOnly: false, inlineOnly: false, isCollar: false, requiresCollar: '', projInches: '', mountType: '', custIds: [], custNames: [], thumb: '' };
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
                const prefix = `S${slotOffset + slotIdx}-${pretty}`.replace(/[^A-Za-z0-9-]/g, '').slice(0, 44);
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
                        pins.push({ assemblyId: asmId, clusterId, partId: `HIDDEN-${slugP}`, partName: ch.label || `HIDDEN-${slugP}`, defaultQty: 1, choiceNode: nodeP, targetNode: nodeP, choiceSort: idx, isHiddenPart: true, parked: true });
                        return;
                    }
                    const slug = (ch.label || 'PART').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 18);
                    // A hidden choice WITH an item # keeps the real id — the generator includes it in the
                    // BOM (includedParts) at its cluster's position. HIDDEN-… synthetic = geometry-only.
                    const partId = hasItem ? ch.itemNo.trim().toUpperCase() : (ch.isHidden ? `HIDDEN-${slug}` : `FEE-${slug}`);
                    const node = topMap[ch.nodeName] || ch.nodeName;
                    // endTreatment: the explicit per-choice tag (finial vs french/miter return vs inside
                    // mount). THE canonical signal — the generator/CPQ no longer have to sniff names.
                    const et = ch.endTreatment || '';
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
                        ...(hasItem && !ch.isFee && !ch.isCollar && String(ch.requiresCollar || '').trim() ? { requiresCollar: String(ch.requiresCollar).trim() } : {}), ...(hasItem && !ch.isFee && String(ch.projInches || '').trim() ? { projInches: String(ch.projInches).trim().toUpperCase() } : {}), ...(hasItem && !ch.isFee && String(ch.mountType || '').trim() ? { mountType: String(ch.mountType).trim().toUpperCase() } : {}),
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
            for (const p of pins) {
                const pid = `PIN-${asmId}-${p.clusterId}-${p.partId}`.replace(/[^A-Za-z0-9-]/g, '_');
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
    const handleLoadChoices = async () => {
        if (!assignId) return alert('Pick an assembly.');
        setAssignBusy(true);
        try {
            const snap = await getDoc(doc(db, 'Approved_Designs', assignId));
            const data = snap.data() || {};
            const cadUrl = data.manufacturingSpecs?.cadUrl;
            const clusters = data.nodeClusters || [];
            if (!cadUrl) throw new Error('This assembly has no .glb (cadUrl).');
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
            const rows = clusters.map(cl => {
                const grp = findGrp(cl);
                let kids = grp ? (grp.children || []).filter(c => c.name).flatMap(leafNames) : [];
                // Single-node cluster (1.5-created pole half / bend / bushing): the matched node IS the
                // one choice — without this the row had zero choices and was hidden from the list.
                if (grp && !kids.length && grp.name) kids = [grp.name];
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
                    if (pin && !pin.isFee) {
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
                    return { nodeName: nm, label, itemNo, endTreatment: et, isFee: !!pin?.isFee, isHidden: !!pin?.isHiddenPart && !pin?.parked, parked: !!pin?.parked, isBasic: !!pin?.isBasic, usesReturnPlates: !!(pin?.usesReturnPlates || cl.usesReturnPlates), isReturnArm: !!(pin?.isReturnArm || cl.isReturnArm), returnOnly: !!(pin?.returnOnly || cl.returnOnly), inlineOnly: !!(pin?.inlineOnly || cl.inlineOnly), isCollar: !!pin?.isCollar, requiresCollar: pin?.requiresCollar || '', projInches: pin?.projInches || '', mountType: pin?.mountType || '', custIds: pin?.customerIds || [], custNames: pin?.customerNames || [], thumb: '' };
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
            setAssignData({ asmId: data.itemId || assignId, asmName: data.itemName || assignId, rows });
            const missing = rows.filter(r => !r.found).length;
            addLog(`Loaded ${rows.length} cluster(s), ${rows.reduce((s, r) => s + r.choices.length, 0)} choice node(s) from "${data.itemName}" — ${matched} item #(s) auto-matched from node names.${missing ? ` ⚠ ${missing} cluster(s) had no group match.` : ''}`, missing ? 'error' : 'success');
            genThumbs(rows.flatMap(r => r.choices.map(c => c.nodeName)), ++assignGenRef.current);
            if (missing) addLog(`Scene top nodes: ${(scene.children || []).flatMap(c => [c.name, ...(c.children || []).map(k => k.name)]).filter(Boolean).slice(0, 24).join(' | ')}`, 'info');
        } catch (e) { console.error(e); addLog(`Load choices failed: ${e.message || e}`, 'error'); alert('Load failed:\n\n' + (e.message || e)); }
        setAssignBusy(false);
    };
    // Patch one choice by (clusterId, nodeName) — name-keyed so rows stay correct after a split
    // reshuffles indices.
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
                    return { nodeName: nm, label, itemNo: m ? m.code : '', endTreatment: et, isFee: et === 'FRENCH_RETURN' || et === 'MITER_RETURN', isHidden: false, isBasic: false, usesReturnPlates: false, isReturnArm: false, returnOnly: false, inlineOnly: false, isCollar: false, requiresCollar: '', projInches: '', mountType: '', custIds: [], custNames: [], thumb: '' };
                }))
            })
        } : prev);
        addLog(`Split "${choiceLabel(nodeName)}" into ${kids.length} sub-part(s).`, 'info');
        genThumbs(kids, assignGenRef.current);
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
                            const pidP = `PIN-${assignData.asmId}-${r.clusterId}-${partIdP}`.replace(/[^A-Za-z0-9-]/g, '_');
                            for (const old of existing) { if (old.docId !== pidP) { await deleteDoc(old.ref); removed++; } }
                            await setDoc(doc(db, 'assembly_pins', pidP), { id: pidP, assemblyId: assignData.asmId, clusterId: r.clusterId, partId: partIdP, partName: ch.label || partIdP, defaultQty: 1, choiceNode: ch.nodeName, targetNode: ch.nodeName, choiceSort: idx, isHiddenPart: true, parked: true });
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
                    const pid = `PIN-${assignData.asmId}-${r.clusterId}-${partId}`.replace(/[^A-Za-z0-9-]/g, '_');
                    for (const old of existing) { if (old.docId !== pid) { await deleteDoc(old.ref); removed++; } }
                    await setDoc(doc(db, 'assembly_pins', pid), { id: pid, assemblyId: assignData.asmId, clusterId: r.clusterId, partId, partName: ch.label || partId, defaultQty: 1, choiceNode: ch.nodeName, targetNode: ch.nodeName, choiceSort: idx, ...(ch.endTreatment ? { endTreatment: ch.endTreatment } : {}), ...(ch.isFee && !ch.isHidden ? { isFee: true } : {}), ...(ch.isHidden ? { isHiddenPart: true } : {}), ...(ch.isBasic && !ch.isFee && !ch.isHidden ? { isBasic: true } : {}), ...(ch.usesReturnPlates && !ch.isFee && !ch.isHidden ? { usesReturnPlates: true } : {}), ...(ch.isReturnArm && !ch.isFee && !ch.isHidden ? { isReturnArm: true } : {}), ...(ch.returnOnly && !ch.isFee && !ch.isHidden ? { returnOnly: true } : {}), ...(ch.inlineOnly && !ch.isFee && !ch.isHidden ? { inlineOnly: true } : {}), ...(hasItem && !ch.isFee && Array.isArray(ch.custIds) && ch.custIds.length ? { customerIds: ch.custIds, customerNames: ch.custNames || [] } : {}), ...(hasItem && !ch.isFee && ch.isCollar ? { isCollar: true } : {}), ...(hasItem && !ch.isFee && !ch.isCollar && String(ch.requiresCollar || '').trim() ? { requiresCollar: String(ch.requiresCollar).trim() } : {}), ...(hasItem && !ch.isFee && String(ch.projInches || '').trim() ? { projInches: String(ch.projInches).trim().toUpperCase() } : {}), ...(hasItem && !ch.isFee && String(ch.mountType || '').trim() ? { mountType: String(ch.mountType).trim().toUpperCase() } : {}), ...(hasItem && !ch.isFee ? libLinkFields(ch.itemNo) : {}) });
                    n++; if (ch.isFee && !ch.isHidden) fees++; if (ch.isHidden) hides++;
                }
            }
            addLog(`✅ Saved ${n} choice pin(s) (${fees} fee, ${hides} hidden${parked ? `, ${parked} ⏸ parked` : ''}${removed ? `, ${removed} stale removed` : ''}).`, 'success');
            alert(`✅ Wrote ${n} choice pin(s)${fees ? ` — ${fees} marked as FEE (renders its geometry, bills as a fee, no BOM item)` : ''}${parked ? `\n\n⏸ ${parked} choice(s) PARKED (no item # yet) — hidden from the model and the flow. When the item # lands in the library, come back, LOAD CHOICES, type it in, save, and regenerate — the part appears on the CPQ.` : ''}.\n\nNow REGENERATE the CPQ flow (System Admin → the flow → "Regenerate Steps from Tags (keep prices)") — clusters with 2+ choices fan out into individual options. Hardware left blank stays as always-on shared geometry.`);
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
                </div>

                {assignData && (
                    <div style={{ borderTop: '1px dashed var(--line)', paddingTop: '10px', maxHeight: '46vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {assignData.rows.filter(r => r.choices.length > 0).map((r) => {
                            return (
                                <div key={r.clusterId} style={{ border: '1px solid var(--line)', borderRadius: '2px', padding: '10px 12px' }}>
                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink)', marginBottom: '8px' }}>
                                        {r.clusterName} <span style={{ color: 'var(--ink-soft)' }}>· {r.category || '—'}{r.position ? ' · ' + r.position : ''} · {r.choices.length} node(s){r.found ? '' : ' · ⚠ group not found'}</span>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: normalizeCategory(r.category) === 'FINIAL' ? '48px minmax(150px,230px) 220px 122px minmax(300px,1fr) 46px' : '48px minmax(150px,230px) 220px minmax(300px,1fr) 46px', gap: '6px 12px', alignItems: 'center' }}>
                                        {r.choices.map((c) => (
                                            <React.Fragment key={c.nodeName}>
                                                {c.thumb
                                                    ? <img src={c.thumb} alt="" title="Click to enlarge" onClick={() => setZoomThumb({ url: c.thumb, label: `${r.clusterName} · ${c.label}${c.itemNo ? ` · ${c.itemNo}` : ''}` })} style={{ width: '44px', height: '44px', objectFit: 'contain', background: 'var(--paper-2)', border: '1px solid var(--line)', borderRadius: '2px', cursor: 'zoom-in' }} />
                                                    : <span style={{ width: '44px', height: '44px', border: '1px dashed var(--line)', borderRadius: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '7px', color: 'var(--ink-soft)' }}>…</span>}
                                                <span style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                                                    <span title={c.nodeName} style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</span>
                                                    <button onClick={() => splitChoice(r.clusterId, c.nodeName)} title="This row is really several parts merged under one wrapper node — split it into its named sub-parts, each with its own thumbnail and item #." style={{ border: '1px solid var(--line)', background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '8px', letterSpacing: '.05em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: '2px', flexShrink: 0 }}>⤢ split</button>
                                                </span>
                                                {(() => { const willPark = !(c.itemNo && c.itemNo.trim()) && !c.isFee && !c.isHidden && looksRealPart(c.label); return (
                                                <input value={c.itemNo} list="ab-item-codes" onChange={e => setChoicePatch(r.clusterId, c.nodeName, { itemNo: e.target.value })} title={willPark ? 'No item # yet — on save this choice PARKS: the node hides from the model AND the flow until you assign the # (Load Choices keeps listing it). Perfect for parts IT hasn\'t set up yet.' : undefined} placeholder={c.isFee ? 'fee — item # optional (links the fee entity, e.g. CE-FEE-4594, for pricing)' : (c.isHidden ? 'hidden — item # optional (adds it to the BOM)' : (willPark ? '⏸ parks on save — no item # yet' : 'item # — type to search (blank = hardware)'))} style={{ ...inp, padding: '5px 8px', fontSize: '0.78rem', fontFamily: 'var(--mono)', borderColor: c.isFee ? 'var(--line)' : (c.itemNo ? 'var(--brass)' : (willPark ? 'var(--brass)' : 'var(--line)')), borderStyle: willPark ? 'dashed' : 'solid', opacity: c.isFee ? 0.5 : 1 }} />
                                                ); })()}
                                                {normalizeCategory(r.category) === 'FINIAL' && (
                                                    <select value={c.endTreatment || ''} title="END TREATMENT — the explicit tag the generator + CPQ + Vision read (replaces name-sniffing). FINIAL = decorative end. FRENCH/MITER RETURN = fee, replaces this side's bracket + hides the long rod half. INSIDE MOUNT = real part, replaces the bracket." onChange={e => { const et = e.target.value; setChoicePatch(r.clusterId, c.nodeName, { endTreatment: et, ...(et === 'FRENCH_RETURN' || et === 'MITER_RETURN' ? { isFee: true, isHidden: false, isBasic: false, usesReturnPlates: false } : {}) }); }} style={{ ...inp, padding: '4px 6px', fontSize: '9px', fontFamily: 'var(--mono)', textTransform: 'uppercase', width: '118px', borderColor: c.endTreatment && c.endTreatment !== 'FINIAL' ? 'var(--brass)' : 'var(--line)' }}>
                                                        <option value="">— end type —</option>
                                                        {END_TREATMENTS.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                                                    </select>
                                                )}
                                                <span style={{ display: 'grid', gridTemplateColumns: 'repeat(3, max-content)', gap: '7px 18px', alignItems: 'center', justifyContent: 'start' }}>
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
                                                    {normalizeCategory(r.category) === 'FINIAL' && (
                                                        <label title="COLLAR — this choice is the metal collar of a TWO-PART finial: companion geometry, never offered as its own option. Pair each top to it via the tops' collar: dropdown; on regenerate the collar renders WITH those tops (the step's metal finish lands on the collar; the AC chip keeps an acrylic top clear)." style={{ display: 'flex', alignItems: 'center', gap: '6px', fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.05em', textTransform: 'uppercase', color: c.isCollar ? 'var(--brass)' : 'var(--ink-soft)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                                            <input type="checkbox" checked={!!c.isCollar} onChange={e => setChoicePatch(r.clusterId, c.nodeName, { isCollar: e.target.checked, ...(e.target.checked ? { isFee: false, isHidden: false, requiresCollar: '' } : {}) })} style={{ cursor: 'pointer', width: '15px', height: '15px', margin: 0, flexShrink: 0 }} />
                                                            collar
                                                        </label>
                                                    )}
                                                    <select value={(c.custIds && c.custIds[0]) || ''} title="CUSTOMER-ONLY choice: pick a customer and this option shows on the CPQ (and their portal) ONLY when that customer is selected — everyone else never sees it. '— all —' = visible to every customer (poles, rings, common parts)." onFocus={() => ensureCustomers()} onChange={e => { const id = e.target.value; const nm = ((custList || []).find(x => x.id === id) || {}).name || ''; setChoicePatch(r.clusterId, c.nodeName, { custIds: id ? [id] : [], custNames: id ? [nm] : [] }); }} style={{ ...inp, padding: '3px 4px', fontSize: '9px', fontFamily: 'var(--mono)', width: '110px', maxWidth: '110px', borderColor: (c.custIds && c.custIds.length) ? 'var(--brass)' : 'var(--line)', color: (c.custIds && c.custIds.length) ? 'var(--brass)' : 'var(--ink-soft)' }}>
                                                        <option value="">cust: all</option>
                                                        {(custList || []).map(cu => <option key={cu.id} value={cu.id}>{cu.name}</option>)}
                                                        {c.custIds && c.custIds[0] && !(custList || []).some(x => x.id === c.custIds[0]) && <option value={c.custIds[0]}>{(c.custNames && c.custNames[0]) || c.custIds[0]}</option>}
                                                    </select>
                                                    {normalizeCategory(r.category) === 'FINIAL' && !c.isCollar && (
                                                        <select value={c.requiresCollar || ''} title="PAIR WITH COLLAR (two-part finial top): pick the COLLAR-flagged choice (its item #) this top renders WITH — the generated option shows top+collar together, same side preferred. '— none —' = a one-piece finial. A ⚠ row = a choice ticked COLLAR that still needs its item # typed in." onChange={e => setChoicePatch(r.clusterId, c.nodeName, { requiresCollar: e.target.value })} style={{ ...inp, padding: '3px 4px', fontSize: '9px', fontFamily: 'var(--mono)', width: '110px', maxWidth: '110px', borderColor: c.requiresCollar ? 'var(--brass)' : 'var(--line)', color: c.requiresCollar ? 'var(--brass)' : 'var(--ink-soft)' }}>
                                                            <option value="">collar: — none —</option>
                                                            {assignCollarCands.codes.map(code => <option key={code} value={code}>{code}</option>)}
                                                            {assignCollarCands.pending.map((lbl, i) => <option key={`pend-${i}`} value="" disabled>⚠ {lbl} — needs item #</option>)}
                                                            {c.requiresCollar && !assignCollarCands.codes.some(code => code.toUpperCase() === String(c.requiresCollar).toUpperCase()) && <option value={c.requiresCollar}>{c.requiresCollar}</option>}
                                                        </select>
                                                    )}
                                                    {normalizeCategory(r.category) === 'BRACKET' && !c.isFee && (
                                                        <select value={c.projInches || ''} title="BRACKET PROJECTION — offers the 4.5 Master-Dictionary list (BRACKET PROJECTIONS), the same vocabulary the Library editor + Vision engine use, so CPQ and Vision never drift. The option shows in CPQ only while the matching projection is selected; '— any —' = fits every projection." onChange={e => setChoicePatch(r.clusterId, c.nodeName, { projInches: e.target.value })} style={{ ...inp, padding: '3px 4px', fontSize: '9px', fontFamily: 'var(--mono)', width: '110px', maxWidth: '110px', borderColor: c.projInches ? 'var(--brass)' : 'var(--line)', color: c.projInches ? 'var(--brass)' : 'var(--ink-soft)' }}>
                                                            <option value="">proj: — any —</option>
                                                            {((dictLists && dictLists.projections) || []).map(p => <option key={p} value={String(p).toUpperCase()}>proj: {p}"</option>)}
                                                        </select>
                                                    )}
                                                    {normalizeCategory(r.category) === 'BRACKET' && !c.isFee && (
                                                        <select value={c.mountType || ''} title="BRACKET MOUNT TYPE — the 4.5 Master-Dictionary list (BRACKET MOUNT TYPES); saved on the pin in the same vocabulary the Library editor + Vision engine use." onChange={e => setChoicePatch(r.clusterId, c.nodeName, { mountType: e.target.value })} style={{ ...inp, padding: '3px 4px', fontSize: '9px', fontFamily: 'var(--mono)', width: '110px', maxWidth: '110px', borderColor: c.mountType ? 'var(--brass)' : 'var(--line)', color: c.mountType ? 'var(--brass)' : 'var(--ink-soft)' }}>
                                                            <option value="">mount: — any —</option>
                                                            {((dictLists && dictLists.bracketMounts) || []).map(m => <option key={m} value={String(m).toUpperCase()}>mount: {m}</option>)}
                                                        </select>
                                                    )}
                                                    {normalizeCategory(r.category) === 'BRACKET' && (
                                                        <label title="END RETURN ARM (Flat Iron pattern): this bracket IS the end treatment — selecting it greys that side's finial / inside-mount step; its backplate stays choosable (unless basic). Auto-detected when the library part is flagged isReturnBracket; check here to force it." style={{ display: 'flex', alignItems: 'center', gap: '6px', fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.05em', textTransform: 'uppercase', color: c.isReturnArm ? 'var(--brass)' : 'var(--ink-soft)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                                            <input type="checkbox" checked={!!c.isReturnArm} onChange={e => setChoicePatch(r.clusterId, c.nodeName, { isReturnArm: e.target.checked })} style={{ cursor: 'pointer', width: '15px', height: '15px', margin: 0, flexShrink: 0 }} />
                                                            end-arm
                                                        </label>
                                                    )}
                                                    {normalizeCategory(r.category) === 'BACKPLATE' && (
                                                        <label title="RETURN BACKPLATE: offered ONLY while this end is a french/miter return or an end-return arm — the regular plates hide then (and this one hides otherwise). Use for the plates that pair with the return/arm." style={{ display: 'flex', alignItems: 'center', gap: '6px', fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.05em', textTransform: 'uppercase', color: c.returnOnly ? 'var(--brass)' : 'var(--ink-soft)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                                            <input type="checkbox" checked={!!c.returnOnly} onChange={e => setChoicePatch(r.clusterId, c.nodeName, { returnOnly: e.target.checked })} style={{ cursor: 'pointer', width: '15px', height: '15px', margin: 0, flexShrink: 0 }} />
                                                            rtn-only
                                                        </label>
                                                    )}
                                                    {normalizeCategory(r.category) === 'BACKPLATE' && (
                                                        <label title="INLINE BACKPLATE: the INLINE-bracket copy of a shared return-style plate — offered ONLY while an inl-bkt (In Line) bracket is selected; the return-position copies (rtn-only) show for actual returns. Flows without inl-only plates fall back to rtn-only for In Line brackets." style={{ display: 'flex', alignItems: 'center', gap: '6px', fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.05em', textTransform: 'uppercase', color: c.inlineOnly ? 'var(--brass)' : 'var(--ink-soft)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                                            <input type="checkbox" checked={!!c.inlineOnly} onChange={e => setChoicePatch(r.clusterId, c.nodeName, { inlineOnly: e.target.checked })} style={{ cursor: 'pointer', width: '15px', height: '15px', margin: 0, flexShrink: 0 }} />
                                                            inl-only
                                                        </label>
                                                    )}
                                                </span>
                                                <span style={{ display: 'flex', gap: '2px' }}>
                                                    <button onClick={() => moveChoice(r.clusterId, c.nodeName, -1)} title="Move up — order is saved and drives the option order in the configurator (match Left/Right sides)" style={{ border: '1px solid var(--line)', background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer', fontSize: '9px', padding: '2px 5px', borderRadius: '2px' }}>▲</button>
                                                    <button onClick={() => moveChoice(r.clusterId, c.nodeName, 1)} title="Move down" style={{ border: '1px solid var(--line)', background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer', fontSize: '9px', padding: '2px 5px', borderRadius: '2px' }}>▼</button>
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

            <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: '18px', alignItems: 'start' }}>
                {/* LEFT: slot uploader */}
                <div style={{ ...card, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '78vh', overflowY: 'auto' }}>
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
                                                    <input value={c.itemNo} list="ab-item-codes" onChange={e => setSlotChoicePatch(slot.id, c.nodeName, { itemNo: e.target.value })} placeholder={c.isFee ? 'fee — item # optional (links the fee entity, e.g. CE-FEE-4594, for pricing)' : (c.isHidden ? 'hidden — item # optional (adds to BOM)' : 'item # — type to search')} style={{ ...inp, padding: '4px 7px', fontSize: '0.75rem', fontFamily: 'var(--mono)', borderColor: c.isFee ? 'var(--line)' : (c.itemNo ? 'var(--brass)' : 'var(--line)'), opacity: c.isFee ? 0.5 : 1 }} />
                                                    {normalizeCategory(slot.category) === 'FINIAL' && (
                                                        <select value={c.endTreatment || ''} title="END TREATMENT — the explicit tag the generator + CPQ + Vision read (no more name-sniffing). FINIAL = decorative end. FRENCH/MITER RETURN = fee, replaces this side's bracket + hides the long rod half. INSIDE MOUNT = real part, replaces the bracket." onChange={e => { const et = e.target.value; setSlotChoicePatch(slot.id, c.nodeName, { endTreatment: et, ...(et === 'FRENCH_RETURN' || et === 'MITER_RETURN' ? { isFee: true, isHidden: false, isBasic: false, usesReturnPlates: false } : {}) }); }} style={{ ...inp, padding: '3px 5px', fontSize: '8px', fontFamily: 'var(--mono)', textTransform: 'uppercase', width: '106px', borderColor: c.endTreatment && c.endTreatment !== 'FINIAL' ? 'var(--brass)' : 'var(--line)' }}>
                                                            <option value="">— end type —</option>
                                                            {END_TREATMENTS.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                                                        </select>
                                                    )}
                                                    <span style={{ display: 'grid', gridTemplateColumns: 'repeat(3, max-content)', gap: '6px 14px', alignItems: 'center', justifyContent: 'start' }}>
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
                                                        {normalizeCategory(slot.category) === 'FINIAL' && (
                                                            <label title="COLLAR — this choice is the metal collar of a TWO-PART finial: companion geometry, never its own option. Pair each top via the tops' collar: dropdown." style={{ display: 'flex', alignItems: 'center', gap: '5px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: c.isCollar ? 'var(--brass)' : 'var(--ink-soft)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                                                <input type="checkbox" checked={!!c.isCollar} onChange={e => setSlotChoicePatch(slot.id, c.nodeName, { isCollar: e.target.checked, ...(e.target.checked ? { isFee: false, isHidden: false, requiresCollar: '' } : {}) })} style={{ cursor: 'pointer', width: '15px', height: '15px', margin: 0, flexShrink: 0 }} />collar
                                                            </label>
                                                        )}
                                                        <select value={(c.custIds && c.custIds[0]) || ''} title="CUSTOMER-ONLY choice: shows on CPQ/portal only for this customer ('cust: all' = everyone)." onFocus={() => ensureCustomers()} onChange={e => { const id = e.target.value; const nm = ((custList || []).find(x => x.id === id) || {}).name || ''; setSlotChoicePatch(slot.id, c.nodeName, { custIds: id ? [id] : [], custNames: id ? [nm] : [] }); }} style={{ ...inp, padding: '3px 4px', fontSize: '9px', fontFamily: 'var(--mono)', width: '110px', maxWidth: '110px', borderColor: (c.custIds && c.custIds.length) ? 'var(--brass)' : 'var(--line)', color: (c.custIds && c.custIds.length) ? 'var(--brass)' : 'var(--ink-soft)' }}>
                                                            <option value="">cust: all</option>
                                                            {(custList || []).map(cu => <option key={cu.id} value={cu.id}>{cu.name}</option>)}
                                                        </select>
                                                        {normalizeCategory(slot.category) === 'FINIAL' && !c.isCollar && (
                                                            <select value={c.requiresCollar || ''} title="PAIR WITH COLLAR (two-part finial top): pick the COLLAR-flagged choice (its item #) this top renders WITH. '— none —' = a one-piece finial. A ⚠ row = a choice ticked COLLAR that still needs its item # typed in." onChange={e => setSlotChoicePatch(slot.id, c.nodeName, { requiresCollar: e.target.value })} style={{ ...inp, padding: '3px 4px', fontSize: '9px', fontFamily: 'var(--mono)', width: '110px', maxWidth: '110px', borderColor: c.requiresCollar ? 'var(--brass)' : 'var(--line)', color: c.requiresCollar ? 'var(--brass)' : 'var(--ink-soft)' }}>
                                                                <option value="">collar: — none —</option>
                                                                {slotCollarCands.codes.map(code => <option key={code} value={code}>{code}</option>)}
                                                                {slotCollarCands.pending.map((lbl, i) => <option key={`pend-${i}`} value="" disabled>⚠ {lbl} — needs item #</option>)}
                                                                {c.requiresCollar && !slotCollarCands.codes.some(code => code.toUpperCase() === String(c.requiresCollar).toUpperCase()) && <option value={c.requiresCollar}>{c.requiresCollar}</option>}
                                                            </select>
                                                        )}
                                                        {normalizeCategory(slot.category) === 'BRACKET' && !c.isFee && (
                                                            <select value={c.projInches || ''} title="BRACKET PROJECTION — the 4.5 Master-Dictionary list (BRACKET PROJECTIONS); the option shows in CPQ only while the matching projection is selected. '— any —' = fits every projection." onChange={e => setSlotChoicePatch(slot.id, c.nodeName, { projInches: e.target.value })} style={{ ...inp, padding: '3px 4px', fontSize: '9px', fontFamily: 'var(--mono)', width: '110px', maxWidth: '110px', borderColor: c.projInches ? 'var(--brass)' : 'var(--line)', color: c.projInches ? 'var(--brass)' : 'var(--ink-soft)' }}>
                                                                <option value="">proj: — any —</option>
                                                                {((dictLists && dictLists.projections) || []).map(p => <option key={p} value={String(p).toUpperCase()}>proj: {p}"</option>)}
                                                            </select>
                                                        )}
                                                        {normalizeCategory(slot.category) === 'BRACKET' && !c.isFee && (
                                                            <select value={c.mountType || ''} title="BRACKET MOUNT TYPE — the 4.5 Master-Dictionary list (BRACKET MOUNT TYPES); saved on the pin in the Vision vocabulary." onChange={e => setSlotChoicePatch(slot.id, c.nodeName, { mountType: e.target.value })} style={{ ...inp, padding: '3px 4px', fontSize: '9px', fontFamily: 'var(--mono)', width: '110px', maxWidth: '110px', borderColor: c.mountType ? 'var(--brass)' : 'var(--line)', color: c.mountType ? 'var(--brass)' : 'var(--ink-soft)' }}>
                                                                <option value="">mount: — any —</option>
                                                                {((dictLists && dictLists.bracketMounts) || []).map(m => <option key={m} value={String(m).toUpperCase()}>mount: {m}</option>)}
                                                            </select>
                                                        )}
                                                        {normalizeCategory(slot.category) === 'BRACKET' && (
                                                            <label title="END RETURN ARM (Flat Iron pattern): this bracket IS the end treatment — greys that side's finial / inside-mount step; backplate stays choosable (unless basic)." style={{ display: 'flex', alignItems: 'center', gap: '5px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: c.isReturnArm ? 'var(--brass)' : 'var(--ink-soft)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                                                <input type="checkbox" checked={!!c.isReturnArm} onChange={e => setSlotChoicePatch(slot.id, c.nodeName, { isReturnArm: e.target.checked })} style={{ cursor: 'pointer', width: '15px', height: '15px', margin: 0, flexShrink: 0 }} />end-arm
                                                            </label>
                                                        )}
                                                        {normalizeCategory(slot.category) === 'BACKPLATE' && (
                                                            <label title="RETURN BACKPLATE: offered ONLY while this end is a return / end-return arm; regular plates hide then." style={{ display: 'flex', alignItems: 'center', gap: '5px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: c.returnOnly ? 'var(--brass)' : 'var(--ink-soft)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                                                <input type="checkbox" checked={!!c.returnOnly} onChange={e => setSlotChoicePatch(slot.id, c.nodeName, { returnOnly: e.target.checked })} style={{ cursor: 'pointer', width: '15px', height: '15px', margin: 0, flexShrink: 0 }} />rtn-only
                                                            </label>
                                                        )}
                                                        {normalizeCategory(slot.category) === 'BACKPLATE' && (
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
                <div style={{ ...card, position: 'sticky', top: '16px', height: '78vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
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
