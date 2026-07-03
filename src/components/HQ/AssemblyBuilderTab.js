import React, { useState, useRef, useEffect } from 'react';
import { db, storage } from '../../firebase';
import { doc, setDoc, getDoc, getDocs, updateDoc, collection, query, where, onSnapshot } from 'firebase/firestore';
import { ref as sRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';
import { buildCodeIndex, matchItemByName } from '../Shared/itemCodeMatch';

// Step-by-step assembly builder: the designer uploads ONE .glb per slot (all the choices for that slot
// stacked inside the file). We KNOW each slot's position/category/location, so there's nothing to
// decipher — each file becomes a cluster directly. On Build we merge every layer into one combined .glb
// (the working cadUrl), and write nodeClusters[] + assembly_pins straight from the explicit structure.
// Parts are used at their exported world position; a per-layer X/Y/Z nudge handles files that aren't
// pre-aligned.

const DRACO = 'https://www.gstatic.com/draco/versioned/decoders/1.5.5/';
const CATEGORIES = ['POLE', 'RING', 'BRACKET', 'BACKPLATE', 'FINIAL', 'END', 'OTHER'];
const POSITIONS = ['SHARED', 'LEFT', 'CENTER', 'RIGHT', 'FRONT', 'BACK'];
const LOCATIONS = ['', 'WALL', 'CEILING', 'INSIDE', 'OPEN'];

// Two authoring workflows. Every slot is OPTIONAL — upload only what this assembly uses; the CPQ
// flow is generated from the slots you actually fill. `desc` is the on-screen note explaining the
// slot's role so the tagging matches how the generator + 3D engine read it.
//
// STANDARD BAY — the per-end pole model: a SHORT rod tagged CENTER (always shown, carries the
// french-return ends) plus the LONG rod split at center into a LEFT half and a RIGHT half. Each end's
// finial/return choices stack in that end's FINIAL slot; naming a choice with "return"/"french"/etc.
// makes the generator hide that side's long half so the return renders short. (See System Admin →
// Generate; this is the mixed-end fix.)
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
    { id: 'left_end', label: 'Left End — finials + returns', category: 'FINIAL', position: 'LEFT', location: '', desc: 'Stack ALL left-end choices in one file: finials + french/bent/mitered returns. Name the return choices with "return"/"french" so they hide the left long half.' },
    { id: 'right_end', label: 'Right End — finials + returns', category: 'FINIAL', position: 'RIGHT', location: '', desc: 'Stack ALL right-end choices: finials + returns. Name returns with "return"/"french" so they hide the right long half.' },
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

// Top-level named parts in a loaded scene = the CHOICES for that slot.
const topLevelParts = (scene) => {
    const out = [];
    (scene.children || []).forEach(c => { if (c.name) out.push(c.name); });
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
    const [assignData, setAssignData] = useState(null); // { asmId, asmName, rows:[{clusterId,clusterName,category,position,found,choices:[{nodeName,label,itemNo}]}] }
    const [assignBusy, setAssignBusy] = useState(false);
    const loaderRef = useRef(null);
    if (!loaderRef.current) loaderRef.current = makeLoader();
    // Master-Library ERP-code index for auto-matching item #s from node names (designer's convention:
    // node name = "<ITEM#> <POSITION>"). Fetched once, cached for the session.
    const codeIndexRef = useRef(null);
    const ensureCodeIndex = async () => {
        if (codeIndexRef.current) return codeIndexRef.current;
        const snap = await getDocs(collection(db, 'Approved_Designs'));
        codeIndexRef.current = buildCodeIndex(snap.docs.map(d => { const x = d.data(); return { legacyErpId: x.legacyErpId, itemId: x.itemId }; }));
        return codeIndexRef.current;
    };

    const addLog = (m, t = 'info') => setLog(p => [{ t: new Date().toLocaleTimeString(), m, type: t }, ...p].slice(0, 40));

    useEffect(() => () => { Object.values(layers).forEach(l => l.url && URL.revokeObjectURL(l.url)); }, []); // eslint-disable-line

    // Existing brand assemblies (for the node-name repair tool below).
    useEffect(() => {
        if (!activeBrand) return;
        const qy = query(collection(db, 'Approved_Designs'), where('brandId', '==', activeBrand), where('partClass', '==', 'Assembly'));
        const unsub = onSnapshot(qy, snap => setRepairList(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.itemName || '').localeCompare(String(b.itemName || '')))));
        return () => unsub();
    }, [activeBrand]);

    const onUpload = async (slot, file) => {
        if (!file) return;
        setBusy(slot.id);
        try {
            const buf = await file.arrayBuffer();
            const url = URL.createObjectURL(new Blob([buf]));
            const gltf = await new Promise((res, rej) => loaderRef.current.parse(buf, '', res, rej));
            const scene = gltf.scene;
            const parts = topLevelParts(scene);
            // Auto-prefill each choice's item # from the Master Library by node name ("<ITEM#> <POS>"
            // convention) — the designer's naming does the data entry; hardware matches nothing → blank.
            const index = await ensureCodeIndex().catch(() => null);
            const items = {}; let hit = 0;
            parts.forEach(p => { const m = index ? matchItemByName(p, index) : null; items[p] = m ? m.code : ''; if (m) hit++; });
            setLayers(prev => {
                if (prev[slot.id]?.url) URL.revokeObjectURL(prev[slot.id].url);
                return { ...prev, [slot.id]: { scene, url, fileName: file.name, parts, items, offset: { x: 0, y: 0, z: 0 } } };
            });
            addLog(`Loaded ${slot.label}: ${file.name} — ${parts.length} part(s), ${hit} item #(s) auto-matched`, 'success');
        } catch (e) { addLog(`Failed to load ${file.name}: ${e.message || e}`, 'error'); alert('Could not read that .glb:\n' + (e.message || e)); }
        setBusy('');
    };

    const setItem = (slotId, part, val) => setLayers(prev => ({ ...prev, [slotId]: { ...prev[slotId], items: { ...prev[slotId].items, [part]: val } } }));
    const nudge = (slotId, axis, val) => setLayers(prev => ({ ...prev, [slotId]: { ...prev[slotId], offset: { ...prev[slotId].offset, [axis]: Number(val) || 0 } } }));
    const removeLayer = (slotId) => setLayers(prev => { const n = { ...prev }; if (n[slotId]?.url) URL.revokeObjectURL(n[slotId].url); delete n[slotId]; return n; });
    const addSlot = () => setSlots(s => [...s, { id: `slot_${Date.now()}`, label: 'New Slot', category: 'OTHER', position: 'SHARED', location: '', desc: '' }]);
    const patchSlot = (id, patch) => setSlots(s => s.map(x => x.id === id ? { ...x, ...patch } : x));
    const removeSlot = (id) => { removeLayer(id); setSlots(s => s.filter(x => x.id !== id)); };

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

    const build = async () => {
        if (!assemblyName.trim()) return alert('Name the assembly first.');
        if (!filledSlots.length) return alert('Upload at least one slot .glb first.');
        if (!window.confirm(`Build "${assemblyName}" from ${filledSlots.length} slot file(s)?\n\nThis merges them into one .glb, creates the assembly with ${filledSlots.length} cluster(s), and writes its BOM.`)) return;
        setBusy('build');
        try {
            // 1) Combine every layer into one scene, each slot wrapped in a named group = its cluster.
            const combined = new THREE.Group();
            combined.name = assemblyName.toUpperCase().trim();
            const clusters = [], pins = [];
            const asmId = `${activeBrand.toUpperCase()}-ASM-${Date.now()}`;
            filledSlots.forEach((slot, slotIdx) => {
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
                const prefix = `S${slotIdx}-${pretty}`.replace(/[^A-Za-z0-9-]/g, '').slice(0, 44);
                g.name = prefix;
                const topMap = {};
                let ni = 0;
                g.traverse(node => {
                    if (node === g) return;
                    const orig = node.name || '';
                    const nn = `${prefix}__${ni++}${orig ? '_' + orig.replace(/[^A-Za-z0-9]/g, '').slice(0, 24) : ''}`;
                    if (node.parent === g && orig && !(orig in topMap)) topMap[orig] = nn;
                    node.name = nn;
                });
                combined.add(g);
                const clusterId = `CLUSTER-${slot.id}-${Date.now()}`;
                clusters.push({ id: clusterId, name: pretty, nodes: [prefix, ...allNodeNames(g)], category: slot.category, position: slot.position, location: slot.location || '' });
                // One BOM pin per choice that has an item # entered; choiceNode points at the renamed node.
                Object.entries(layer.items).forEach(([part, itemNo]) => {
                    if (itemNo && itemNo.trim()) pins.push({ assemblyId: asmId, clusterId, partId: itemNo.trim().toUpperCase(), defaultQty: 1, choiceNode: topMap[part] || part });
                });
            });

            // 2) Export the combined scene → binary .glb.
            addLog('Merging + exporting combined .glb…', 'info');
            const glbBuffer = await new Promise((res, rej) => {
                new GLTFExporter().parse(combined, (result) => res(result), (err) => rej(err), { binary: true });
            });
            const blob = new Blob([glbBuffer], { type: 'model/gltf-binary' });

            // 3) Upload to Storage.
            const path = `assemblies/${activeBrand}_${assemblyName.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.glb`;
            const task = uploadBytesResumable(sRef(storage, path), blob);
            const cadUrl = await new Promise((res, rej) => task.on('state_changed', null, rej, async () => res(await getDownloadURL(task.snapshot.ref))));
            addLog(`Uploaded combined model (${(blob.size / 1e6).toFixed(1)} MB).`, 'success');

            // 4) Create the assembly doc (mainline PRODUCT) with clusters, then write BOM pins.
            await setDoc(doc(db, 'Approved_Designs', asmId), {
                id: asmId, itemId: asmId, itemName: assemblyName.toUpperCase().trim(),
                brandId: activeBrand, sharedBrands: [activeBrand],
                partClass: 'Assembly', routingType: 'MAIN', recordType: 'PRODUCT',
                nodeClusters: clusters,
                manufacturingSpecs: { cadUrl, status: 'BUILT_FROM_LAYERS' },
                builtFromLayers: filledSlots.map(s => ({ slot: s.label, file: layers[s.id].fileName })),
                createdAt: Date.now(), updatedAt: Date.now(), author: currentUser || ''
            }, { merge: true });
            for (const p of pins) await setDoc(doc(db, 'assembly_pins', `PIN-${asmId}-${p.clusterId}-${p.partId}`.replace(/[^A-Za-z0-9-]/g, '_')), { id: `PIN-${asmId}-${p.clusterId}`, ...p });

            addLog(`✅ Built "${assemblyName}" — ${clusters.length} clusters, ${pins.length} BOM pin(s).`, 'success');
            alert(`✅ Assembly "${assemblyName}" built.\n\n${clusters.length} clusters (already tagged position + category), ${pins.length} BOM lines. It's ready in Visual Assembly / BOM / Vision — no Auto-Group needed. Generate its CPQ flow in System Admin when ready.`);
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
                let g = scene.getObjectByName((cl.nodes && cl.nodes[0]) || cl.name) || scene.getObjectByName(cl.name);
                if (!g) { const wants = new Set([norm(cl.nodes && cl.nodes[0]), norm(cl.name)].filter(Boolean)); scene.traverse(n => { if (!g && !n.isMesh && wants.has(norm(n.name))) g = n; }); }
                // Last resort: the scene node whose subtree contains the most of this cluster's node names.
                if (!g) { const want = new Set((cl.nodes || []).map(norm)); let best = null, bestScore = 0; scene.traverse(n => { if (n.isMesh) return; let sc = 0; n.traverse(d => { if (want.has(norm(d.name))) sc++; }); if (sc > bestScore) { bestScore = sc; best = n; } }); if (bestScore > 0) g = best; }
                return g;
            };
            // Auto-match: existing pin wins, else derive the item # from the node name against the
            // Master Library ("<ITEM#> <POSITION>" naming). Hardware matches nothing → stays blank.
            const index = await ensureCodeIndex().catch(() => null);
            let matched = 0;
            const rows = clusters.map(cl => {
                const grp = findGrp(cl);
                const kids = grp ? (grp.children || []).map(c => c.name).filter(Boolean) : [];
                return {
                    clusterId: cl.id, clusterName: cl.name, category: (cl.category || '').toUpperCase(), position: (cl.position || '').toUpperCase(),
                    found: !!grp,
                    choices: kids.map(nm => {
                        const label = choiceLabel(nm);
                        let itemNo = pinByNode[nm]?.partId || '';
                        if (!itemNo && index) { const m = matchItemByName(label, index); if (m) { itemNo = m.code; matched++; } }
                        return { nodeName: nm, label, itemNo };
                    })
                };
            });
            setAssignData({ asmId: data.itemId || assignId, asmName: data.itemName || assignId, rows });
            const missing = rows.filter(r => !r.found).length;
            addLog(`Loaded ${rows.length} cluster(s), ${rows.reduce((s, r) => s + r.choices.length, 0)} choice node(s) from "${data.itemName}" — ${matched} item #(s) auto-matched from node names.${missing ? ` ⚠ ${missing} cluster(s) had no group match.` : ''}`, missing ? 'error' : 'success');
            if (missing) addLog(`Scene top nodes: ${(scene.children || []).flatMap(c => [c.name, ...(c.children || []).map(k => k.name)]).filter(Boolean).slice(0, 24).join(' | ')}`, 'info');
        } catch (e) { console.error(e); addLog(`Load choices failed: ${e.message || e}`, 'error'); alert('Load failed:\n\n' + (e.message || e)); }
        setAssignBusy(false);
    };
    const setChoiceItem = (ci, cj, val) => setAssignData(prev => { const rows = prev.rows.map((r, i) => i !== ci ? r : { ...r, choices: r.choices.map((c, j) => j !== cj ? c : { ...c, itemNo: val }) }); return { ...prev, rows }; });
    const handleSaveItemNumbers = async () => {
        if (!assignData) return;
        setAssignBusy(true);
        try {
            let n = 0;
            for (const r of assignData.rows) {
                for (const ch of r.choices) {
                    if (!ch.itemNo || !ch.itemNo.trim()) continue;
                    const partId = ch.itemNo.trim().toUpperCase();
                    const pid = `PIN-${assignData.asmId}-${r.clusterId}-${partId}`.replace(/[^A-Za-z0-9-]/g, '_');
                    await setDoc(doc(db, 'assembly_pins', pid), { id: pid, assemblyId: assignData.asmId, clusterId: r.clusterId, partId, partName: ch.label || partId, defaultQty: 1, choiceNode: ch.nodeName });
                    n++;
                }
            }
            addLog(`✅ Saved ${n} choice pin(s).`, 'success');
            alert(`✅ Wrote ${n} item number(s) as choice pins.\n\nNow REGENERATE the CPQ flow (System Admin → the flow → "Regenerate Steps from Tags (keep prices)") — clusters with 2+ item-numbered choices fan out into individual options (Ball Finial / End Cap / …). Choices you left blank stay as always-on shared geometry.`);
        } catch (e) { console.error(e); addLog(`Save failed: ${e.message || e}`, 'error'); alert('Save failed:\n\n' + (e.message || e)); }
        setAssignBusy(false);
    };

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
                <input value={assemblyName} onChange={e => setAssemblyName(e.target.value)} placeholder="Assembly name / item #…" style={{ ...inp, minWidth: '260px' }} />
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
                        {assignData.rows.filter(r => r.choices.length > 0).map((r, ci) => {
                            const realCi = assignData.rows.indexOf(r);
                            return (
                                <div key={r.clusterId} style={{ border: '1px solid var(--line)', borderRadius: '2px', padding: '10px 12px' }}>
                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink)', marginBottom: '8px' }}>
                                        {r.clusterName} <span style={{ color: 'var(--ink-soft)' }}>· {r.category || '—'}{r.position ? ' · ' + r.position : ''} · {r.choices.length} node(s){r.found ? '' : ' · ⚠ group not found'}</span>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px', gap: '6px 10px', alignItems: 'center' }}>
                                        {r.choices.map((c, cj) => (
                                            <React.Fragment key={c.nodeName}>
                                                <span title={c.nodeName} style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</span>
                                                <input value={c.itemNo} onChange={e => setChoiceItem(realCi, cj, e.target.value)} placeholder="item # (blank = hardware)" style={{ ...inp, padding: '5px 8px', fontSize: '0.78rem', fontFamily: 'var(--mono)' }} />
                                            </React.Fragment>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                        <button onClick={handleSaveItemNumbers} disabled={assignBusy} style={{ padding: '12px', background: assignBusy ? 'var(--paper-2)' : '#3a7d44', color: assignBusy ? 'var(--ink-soft)' : '#fff', border: 'none', cursor: assignBusy ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 600 }}>
                            {assignBusy ? 'Saving…' : '⬇ Save Item Numbers as Choice Pins'}
                        </button>
                    </div>
                )}
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
                                    <input value={slot.label} onChange={e => patchSlot(slot.id, { label: e.target.value })} style={{ ...inp, padding: '6px 8px', fontSize: '0.8rem', fontWeight: 500 }} />
                                    <select value={slot.category} onChange={e => patchSlot(slot.id, { category: e.target.value })} style={sel}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select>
                                    <select value={slot.position} onChange={e => patchSlot(slot.id, { position: e.target.value })} style={sel}>{POSITIONS.map(c => <option key={c}>{c}</option>)}</select>
                                    <select value={slot.location} onChange={e => patchSlot(slot.id, { location: e.target.value })} style={sel}>{LOCATIONS.map(c => <option key={c} value={c}>{c || '—'}</option>)}</select>
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
                                        <input type="file" accept=".glb,.gltf" style={{ display: 'none' }} onChange={e => onUpload(slot, e.target.files[0])} />
                                    </label>
                                    {layer && <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>{layer.fileName} · {layer.parts.length} choice(s)</span>}
                                    {layer && <button onClick={() => removeLayer(slot.id)} style={{ ...sel, cursor: 'pointer', marginLeft: 'auto' }}>clear</button>}
                                </div>
                                {layer && (
                                    <div style={{ marginTop: '10px', borderTop: '1px dashed var(--line)', paddingTop: '10px' }}>
                                        <div style={{ ...lbl, marginBottom: '6px' }}>Choices → item # (each becomes a CPQ swap option + BOM line)</div>
                                        {layer.parts.map(part => (
                                            <div key={part} style={{ display: 'grid', gridTemplateColumns: '1fr 130px', gap: '8px', alignItems: 'center', marginBottom: '5px' }}>
                                                <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{part}</span>
                                                <input value={layer.items[part]} onChange={e => setItem(slot.id, part, e.target.value)} placeholder="item #" style={{ ...inp, padding: '5px 8px', fontSize: '0.78rem', fontFamily: 'var(--mono)' }} />
                                            </div>
                                        ))}
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
                        {busy === 'build' ? 'Building…' : `⚙ Build Assembly (${filledSlots.length} slot${filledSlots.length === 1 ? '' : 's'})`}
                    </button>
                </div>

                {/* RIGHT: live preview */}
                <div style={{ ...card, position: 'sticky', top: '16px', height: '78vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', background: 'var(--paper)', fontFamily: 'var(--serif)', fontSize: '1.1rem', color: 'var(--ink)' }}>Live Preview — {filledSlots.length} layer(s)</div>
                    <div style={{ flex: 1, background: '#f2efe8' }}>
                        <Canvas camera={{ position: [5, 5, 5], fov: 45 }}>
                            <ambientLight intensity={0.8} />
                            <directionalLight position={[10, 10, 5]} intensity={1} />
                            <directionalLight position={[-8, 4, -6]} intensity={0.5} />
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
        </div>
    );
}

export default AssemblyBuilderTab;
