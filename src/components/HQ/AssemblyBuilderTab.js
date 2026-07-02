import React, { useState, useRef, useEffect } from 'react';
import { db, storage } from '../../firebase';
import { doc, setDoc } from 'firebase/firestore';
import { ref as sRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';

// Step-by-step assembly builder: the designer uploads ONE .glb per slot (all the choices for that slot
// stacked inside the file). We KNOW each slot's position/category/location, so there's nothing to
// decipher — each file becomes a cluster directly. On Build we merge every layer into one combined .glb
// (the working cadUrl), and write nodeClusters[] + assembly_pins straight from the explicit structure.
// Parts are used at their exported world position; a per-layer X/Y/Z nudge handles files that aren't
// pre-aligned.

const DRACO = 'https://www.gstatic.com/draco/versioned/decoders/1.5.5/';
const CATEGORIES = ['POLE', 'RING', 'BRACKET', 'BACKPLATE', 'FINIAL', 'END', 'OTHER'];
const POSITIONS = ['SHARED', 'LEFT', 'CENTER', 'RIGHT'];
const LOCATIONS = ['', 'WALL', 'CEILING', 'INSIDE', 'OPEN'];

const DEFAULT_SLOTS = [
    { id: 'pole', label: 'Pole', category: 'POLE', position: 'SHARED', location: '' },
    { id: 'rings', label: 'Rings', category: 'RING', position: 'SHARED', location: '' },
    { id: 'left_bracket', label: 'Left Bracket', category: 'BRACKET', position: 'LEFT', location: 'WALL' },
    { id: 'left_backplate', label: 'Left Backplate', category: 'BACKPLATE', position: 'LEFT', location: 'WALL' },
    { id: 'left_finial', label: 'Left Finial', category: 'FINIAL', position: 'LEFT', location: '' },
    { id: 'center_bracket', label: 'Center Bracket', category: 'BRACKET', position: 'CENTER', location: 'WALL' },
    { id: 'center_backplate', label: 'Center Backplate', category: 'BACKPLATE', position: 'CENTER', location: 'WALL' },
    { id: 'right_bracket', label: 'Right Bracket', category: 'BRACKET', position: 'RIGHT', location: 'WALL' },
    { id: 'right_backplate', label: 'Right Backplate', category: 'BACKPLATE', position: 'RIGHT', location: 'WALL' },
    { id: 'right_finial', label: 'Right Finial', category: 'FINIAL', position: 'RIGHT', location: '' },
];

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
    const [slots, setSlots] = useState(DEFAULT_SLOTS.map(s => ({ ...s })));
    // per-slot layer: { scene, url, fileName, parts:[], items:{part:itemNo}, offset:{x,y,z} }
    const [layers, setLayers] = useState({});
    const [busy, setBusy] = useState('');
    const [log, setLog] = useState([]);
    const loaderRef = useRef(null);
    if (!loaderRef.current) loaderRef.current = makeLoader();

    const addLog = (m, t = 'info') => setLog(p => [{ t: new Date().toLocaleTimeString(), m, type: t }, ...p].slice(0, 40));

    useEffect(() => () => { Object.values(layers).forEach(l => l.url && URL.revokeObjectURL(l.url)); }, []); // eslint-disable-line

    const onUpload = async (slot, file) => {
        if (!file) return;
        setBusy(slot.id);
        try {
            const buf = await file.arrayBuffer();
            const url = URL.createObjectURL(new Blob([buf]));
            const gltf = await new Promise((res, rej) => loaderRef.current.parse(buf, '', res, rej));
            const scene = gltf.scene;
            const parts = topLevelParts(scene);
            const items = {}; parts.forEach(p => { items[p] = ''; });
            setLayers(prev => {
                if (prev[slot.id]?.url) URL.revokeObjectURL(prev[slot.id].url);
                return { ...prev, [slot.id]: { scene, url, fileName: file.name, parts, items, offset: { x: 0, y: 0, z: 0 } } };
            });
            addLog(`Loaded ${slot.label}: ${file.name} — ${parts.length} part(s)`, 'success');
        } catch (e) { addLog(`Failed to load ${file.name}: ${e.message || e}`, 'error'); alert('Could not read that .glb:\n' + (e.message || e)); }
        setBusy('');
    };

    const setItem = (slotId, part, val) => setLayers(prev => ({ ...prev, [slotId]: { ...prev[slotId], items: { ...prev[slotId].items, [part]: val } } }));
    const nudge = (slotId, axis, val) => setLayers(prev => ({ ...prev, [slotId]: { ...prev[slotId], offset: { ...prev[slotId].offset, [axis]: Number(val) || 0 } } }));
    const removeLayer = (slotId) => setLayers(prev => { const n = { ...prev }; if (n[slotId]?.url) URL.revokeObjectURL(n[slotId].url); delete n[slotId]; return n; });
    const addSlot = () => setSlots(s => [...s, { id: `slot_${Date.now()}`, label: 'New Slot', category: 'OTHER', position: 'SHARED', location: '' }]);
    const patchSlot = (id, patch) => setSlots(s => s.map(x => x.id === id ? { ...x, ...patch } : x));
    const removeSlot = (id) => { removeLayer(id); setSlots(s => s.filter(x => x.id !== id)); };

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
            filledSlots.forEach(slot => {
                const layer = layers[slot.id];
                const g = layer.scene.clone(true);
                g.position.set(layer.offset.x, layer.offset.y, layer.offset.z);
                const groupName = `${slot.label.toUpperCase().replace(/\s+/g, '-')}`;
                g.name = groupName;
                combined.add(g);
                const nodeNames = [groupName, ...allNodeNames(g)];
                const clusterId = `CLUSTER-${slot.id}-${Date.now()}`;
                clusters.push({ id: clusterId, name: groupName, nodes: [...new Set(nodeNames)], category: slot.category, position: slot.position, location: slot.location || '' });
                // One BOM pin per choice that has an item # entered.
                Object.entries(layer.items).forEach(([part, itemNo]) => {
                    if (itemNo && itemNo.trim()) pins.push({ assemblyId: asmId, clusterId, partId: itemNo.trim().toUpperCase(), defaultQty: 1, choiceNode: part });
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
