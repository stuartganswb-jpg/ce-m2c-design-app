import React, { useState, useRef, useCallback, useEffect } from 'react';
import * as THREE from 'three';
import { db } from '../../firebase';
import { collection, query, where, onSnapshot, addDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';

// --- THEME & STYLING ---
const theme = {
  paper: '#faf8f4',
  paper2: '#f2efe8',
  ink: '#1c1a16',
  inkSoft: '#524e46',
  brass: '#b08d57',
  line: 'rgba(28,26,22,.14)',
  serif: "'Cormorant Garamond', Georgia, serif",
  sans: "'Inter', -apple-system, sans-serif",
  mono: "'IBM Plex Mono', monospace"
};

// --- UTILITIES ---
const uid = () => Math.random().toString(36).slice(2, 9);
const snapTo = (v, inc) => Math.round(v / inc) * inc;
const fmt = (n, d = 4) => parseFloat(n.toFixed(d));

function moveShape(s, dx, dy) {
  if (s.type === "ellipse") return { ...s, cx: s.cx + dx, cy: s.cy + dy };
  if (s.type === "rect")    return { ...s, x: s.x + dx, y: s.y + dy };
  if (s.type === "line")    return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy };
  if (s.type === "polygon") return { ...s, points: s.points.map(p => ({ x: p.x + dx, y: p.y + dy })) };
  return s;
}

// --- DXF GENERATOR ---
function generateDXF(shapes) {
  const buf = [];
  const e = (...args) => args.forEach(a => buf.push(String(a)));
  const n = v => parseFloat(v.toFixed(6));

  e("0","SECTION","2","HEADER");
  e("9","$ACADVER","1","AC1015");
  e("9","$INSUNITS","70","1"); 
  e("0","ENDSEC");
  e("0","SECTION","2","ENTITIES");

  for (const s of shapes) {
    if (s.type === "ellipse") {
      if (Math.abs(s.rx - s.ry) < 1e-4) {
        e("0","CIRCLE","8","0");
        e("10",n(s.cx),"20",n(-s.cy),"30","0","40",n(s.rx));
      } else {
        e("0","ELLIPSE","8","0");
        e("10",n(s.cx),"20",n(-s.cy),"30","0");
        if (s.rx >= s.ry) { e("11",n(s.rx),"21","0","31","0","40",n(s.ry / s.rx)); } 
        else              { e("11","0","21",n(s.ry),"31","0","40",n(s.rx / s.ry)); }
        e("41","0","42","6.2831853");
      }
    } else if (s.type === "rect") {
      e("0","LWPOLYLINE","8","0","90","4","70","1");
      e("10",n(s.x),           "20",n(-s.y));
      e("10",n(s.x + s.width), "20",n(-s.y));
      e("10",n(s.x + s.width), "20",n(-(s.y + s.height)));
      e("10",n(s.x),           "20",n(-(s.y + s.height)));
    } else if (s.type === "line") {
      const thick = s.thickness || 0;
      if (thick < 1e-4) {
        e("0","LINE","8","0");
        e("10",n(s.x1),"20",n(-s.y1),"30","0");
        e("11",n(s.x2),"21",n(-s.y2),"31","0");
      } else {
        const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 1e-4) {
          const nx = (-dy / len) * (thick / 2);
          const ny = ( dx / len) * (thick / 2);
          e("0","LWPOLYLINE","8","0","90","4","70","1");
          e("10",n(s.x1 + nx),"20",n(-(s.y1 + ny)));
          e("10",n(s.x2 + nx),"20",n(-(s.y2 + ny)));
          e("10",n(s.x2 - nx),"20",n(-(s.y2 - ny)));
          e("10",n(s.x1 - nx),"20",n(-(s.y1 - ny)));
        }
      }
    } else if (s.type === "polygon" && s.points?.length >= 3) {
      e("0","LWPOLYLINE","8","0","90",s.points.length,"70","1");
      for (const p of s.points) e("10",n(p.x),"20",n(-p.y));
    }
  }
  e("0","ENDSEC","0","EOF");
  return buf.join("\n");
}

// --- IMAGE PROCESSING & CV ALGORITHMS ---
function dilateDisk(grid, W, H, r) {
  if (r < 1) return grid;
  const out = new Uint8Array(W * H);
  const r2 = r * r;
  const ri = Math.ceil(r);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!grid[y * W + x]) continue;
      for (let dy = -ri; dy <= ri; dy++) {
        const ny = y + dy; if (ny < 0 || ny >= H) continue;
        for (let dx = -ri; dx <= ri; dx++) {
          if (dx * dx + dy * dy > r2) continue;
          const nx = x + dx; if (nx < 0 || nx >= W) continue;
          out[ny * W + nx] = 1;
        }
      }
    }
  }
  return out;
}

function marchingSquares(grid, W, H) {
  const G = (x, y) => (x >= 0 && x < W && y >= 0 && y < H && grid[y * W + x]) ? 1 : 0;
  const segs = [];
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const idx = (G(x,y)<<3) | (G(x+1,y)<<2) | (G(x+1,y+1)<<1) | G(x,y+1);
      if (!idx || idx === 15) continue;
      const T={x:x+.5,y}, R={x:x+1,y:y+.5}, B={x:x+.5,y:y+1}, L={x,y:y+.5};
      const add = (a, b) => segs.push([{...a}, {...b}]);
      switch (idx) {
        case 1: case 14: add(L,B); break;
        case 2: case 13: add(B,R); break;
        case 3: case 12: add(L,R); break;
        case 4: case 11: add(T,R); break;
        case 6: case 9:  add(T,B); break;
        case 7: case 8:  add(T,L); break;
        case 5: add(T,R); add(L,B); break;
        case 10: add(T,L); add(B,R); break;
      }
    }
  }
  if (!segs.length) return [];
  const ptKey = p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  const adj = new Map();
  segs.forEach((seg, i) => {
    [0, 1].forEach(pi => {
      const k = ptKey(seg[pi]);
      if (!adj.has(k)) adj.set(k, []);
      adj.get(k).push({ i, pi });
    });
  });
  const used = new Uint8Array(segs.length);
  const chains = [];
  for (let s = 0; s < segs.length; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const chain = [{...segs[s][0]}, {...segs[s][1]}];
    let ext = true;
    while (ext) {
      ext = false;
      const tail = chain[chain.length - 1];
      for (const {i, pi} of (adj.get(ptKey(tail)) || [])) {
        if (used[i]) continue;
        used[i] = 1; chain.push({...segs[i][1 - pi]}); ext = true; break;
      }
    }
    if (chain.length >= 3) chains.push(chain);
  }
  return chains.sort((a, b) => b.length - a.length)[0] || [];
}

function rdp(pts, eps) {
  if (pts.length <= 2) return pts;
  const [p0, pn] = [pts[0], pts[pts.length - 1]];
  const len = Math.hypot(pn.x - p0.x, pn.y - p0.y);
  let maxD = 0, maxI = 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = len < 1e-9 ? Math.hypot(pts[i].x - p0.x, pts[i].y - p0.y) : Math.abs((pn.y - p0.y) * pts[i].x - (pn.x - p0.x) * pts[i].y + pn.x * p0.y - pn.y * p0.x) / len;
    if (d > maxD) { maxD = d; maxI = i; }
  }
  if (maxD <= eps) return [p0, pn];
  return [...rdp(pts.slice(0, maxI + 1), eps).slice(0, -1), ...rdp(pts.slice(maxI), eps)];
}

function chaikin(pts, iters = 3) {
  let p = pts;
  for (let k = 0; k < iters; k++) {
    const next = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      next.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y });
      next.push({ x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y });
    }
    p = next;
  }
  return p;
}

// --- GLTF LOADING & TRACING ---
async function loadGLTF(file) {
  // Static string import to bypass Vercel Webpack CI error
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  
  const url = URL.createObjectURL(file);
  try { 
    return await new Promise((res, rej) => new GLTFLoader().load(url, res, null, rej)); 
  } finally { 
    URL.revokeObjectURL(url); 
  }
}

function renderSilhouette(gltfScene, euler, SIZE = 512) {
  const scene = new THREE.Scene();
  const model = gltfScene.clone(true);
  model.rotation.set(...euler);
  model.traverse(c => { if (c.isMesh) c.material = new THREE.MeshBasicMaterial({ color: 0, side: THREE.DoubleSide }); });
  scene.add(model);

  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const half = Math.max(size.x * 0.6 || 1, size.z * 0.6 || 1);
  const cam = new THREE.OrthographicCamera(-half, half, half, -half, -5000, 5000);
  cam.position.set(center.x, center.y + 1000, center.z);
  cam.lookAt(center); cam.up.set(0, 0, -1); cam.updateProjectionMatrix();

  const offscreen = document.createElement("canvas");
  offscreen.width = offscreen.height = SIZE;
  const renderer = new THREE.WebGLRenderer({ canvas: offscreen, preserveDrawingBuffer: true, antialias: false });
  renderer.setSize(SIZE, SIZE); renderer.setClearColor(0xffffff, 1);
  renderer.render(scene, cam); renderer.dispose();

  const c2 = document.createElement("canvas");
  c2.width = c2.height = SIZE;
  c2.getContext("2d").drawImage(offscreen, 0, 0);
  const imgData = c2.getContext("2d").getImageData(0, 0, SIZE, SIZE);

  const grid = new Uint8Array(SIZE * SIZE);
  let minX = SIZE, maxX = 0, minY = SIZE, maxY = 0;
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (imgData.data[i * 4] < 200) {
      grid[i] = 1;
      const x = i % SIZE, y = Math.floor(i / SIZE);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return { grid, W: SIZE, H: SIZE, minX, maxX, minY, maxY };
}

async function traceGLB({ gltfScene, euler, partW, partH, clearance, foamW, foamH }) {
  const { grid, W, H, minX, maxX, minY, maxY } = renderSilhouette(gltfScene, euler);
  if (minX > maxX) throw new Error("Model rendered empty — try a different orientation.");

  const pxPerIn = (maxX - minX + 1) / partW;
  const dilated = dilateDisk(grid, W, H, Math.max(0, Math.round(clearance * pxPerIn)));
  const raw = marchingSquares(dilated, W, H);
  if (!raw.length) throw new Error("Contour trace failed — model may be too small.");

  const scaleX = partW / (maxX - minX + 1), scaleY = partH / (maxY - minY + 1);
  let dMinX = W, dMaxX = 0, dMinY = H, dMaxY = 0;
  for (let i = 0; i < W * H; i++) {
    if (dilated[i]) {
      const x = i % W, y = Math.floor(i / W);
      if (x < dMinX) dMinX = x; if (x > dMaxX) dMaxX = x;
      if (y < dMinY) dMinY = y; if (y > dMaxY) dMaxY = y;
    }
  }

  const offX = (foamW - ((dMaxX - dMinX + 1) * scaleX)) / 2;
  const offY = (foamH - ((dMaxY - dMinY + 1) * scaleY)) / 2;
  return chaikin(rdp(raw, 1.5), 3).map(p => ({
    x: fmt((p.x - dMinX) * scaleX + offX),
    y: fmt((p.y - dMinY) * scaleY + offY),
  }));
}

// --- GLB PREVIEW MODAL ---
function GLBModal({ gltfScene, foamW, foamH, onClose, onTrace }) {
  const canvasRef = useRef(null), rendRef = useRef(null), sceneRef = useRef(null), camRef = useRef(null), modelRef = useRef(null), dragRef = useRef(null);
  const [euler, setEuler] = useState([0, 0, 0]);
  const [partW, setPartW] = useState(6), [partH, setPartH] = useState(4), [clearance, setClearance] = useState(0.125);
  const [tracing, setTracing] = useState(false), [error, setError] = useState("");

  useEffect(() => {
    const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio); renderer.setSize(400, 300); renderer.setClearColor(theme.paper2);
    rendRef.current = renderer;
    const scene = new THREE.Scene(); sceneRef.current = scene;
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9); dir.position.set(3, 8, 5); scene.add(dir);
    scene.add(new THREE.GridHelper(100, 20, theme.line, theme.line));

    const model = gltfScene.clone(true); modelRef.current = model; scene.add(model);
    const box = new THREE.Box3().setFromObject(model), center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    model.position.sub(center);
    const cam = new THREE.PerspectiveCamera(38, 400/300, 0.001, 10000); camRef.current = cam;
    cam.position.set(0, Math.max(size.x, size.y, size.z) * 1.8, Math.max(size.x, size.y, size.z) * 2.2); cam.lookAt(0, 0, 0);
    renderer.render(scene, cam);
    return () => renderer.dispose();
  }, [gltfScene]);

  useEffect(() => {
    if (modelRef.current && rendRef.current) {
      modelRef.current.rotation.set(...euler);
      rendRef.current.render(sceneRef.current, camRef.current);
    }
  }, [euler]);

  const onMove = e => { if (dragRef.current) setEuler([dragRef.current.e[0] + (e.clientY - dragRef.current.y) * 0.007, dragRef.current.e[1] + (e.clientX - dragRef.current.x) * 0.007, 0]); };
  const handleTrace = async () => {
    setTracing(true); setError("");
    try { onTrace(await traceGLB({ gltfScene, euler, partW, partH, clearance, foamW, foamH })); } 
    catch (err) { setError(err.message || "Trace failed."); } finally { setTracing(false); }
  };

  const inpStyle = { width: "100%", padding: "8px", border: `1px solid ${theme.line}`, background: '#fff', fontSize: '0.8rem', fontFamily: theme.sans };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(28,26,22,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: theme.paper, padding: "30px", border: `1px solid ${theme.line}`, width: "460px", display: "flex", flexDirection: "column", gap: "20px" }}>
        <div>
          <span style={{ fontFamily: theme.mono, fontSize: "10px", color: theme.brass, textTransform: "uppercase" }}>GLB Orientation</span>
          <h2 style={{ fontFamily: theme.serif, margin: "5px 0 0 0", color: theme.ink }}>Extract Part Silhouette</h2>
        </div>
        <div style={{ border: `1px solid ${theme.line}`, background: theme.paper2 }}>
          <canvas ref={canvasRef} style={{ width: 400, height: 300, cursor: "grab" }} onMouseDown={e => dragRef.current = { x: e.clientX, y: e.clientY, e: [...euler] }} onMouseMove={onMove} onMouseUp={() => dragRef.current = null} onMouseLeave={() => dragRef.current = null} />
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          {[ {l:"Top", e:[-Math.PI/2,0,0]}, {l:"Front", e:[0,0,0]}, {l:"Side", e:[0,Math.PI/2,0]} ].map(p => (
            <button key={p.l} onClick={() => setEuler(p.e)} style={{ flex: 1, padding: "8px", border: `1px solid ${theme.line}`, background: "#fff", cursor: "pointer", fontFamily: theme.sans, fontSize: "0.8rem" }}>{p.l}</button>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
          <div><label style={{ display: "block", fontSize: "0.7rem", fontFamily: theme.sans, color: theme.inkSoft, marginBottom: "4px" }}>Part Width (in)</label><input type="number" value={partW} onChange={e=>setPartW(parseFloat(e.target.value)||0)} style={inpStyle} /></div>
          <div><label style={{ display: "block", fontSize: "0.7rem", fontFamily: theme.sans, color: theme.inkSoft, marginBottom: "4px" }}>Part Height (in)</label><input type="number" value={partH} onChange={e=>setPartH(parseFloat(e.target.value)||0)} style={inpStyle} /></div>
          <div><label style={{ display: "block", fontSize: "0.7rem", fontFamily: theme.sans, color: theme.inkSoft, marginBottom: "4px" }}>Clearance (in)</label><input type="number" step="0.125" value={clearance} onChange={e=>setClearance(parseFloat(e.target.value)||0)} style={inpStyle} /></div>
        </div>
        {error && <div style={{ color: "red", fontSize: "0.8rem", fontFamily: theme.sans }}>{error}</div>}
        <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
          <button onClick={handleTrace} disabled={tracing} style={{ flex: 1, padding: "12px", background: theme.ink, color: "#fff", border: "none", cursor: tracing ? "wait" : "pointer", fontFamily: theme.sans, fontSize: "0.9rem" }}>{tracing ? "Tracing..." : "Generate Cutout Path"}</button>
          <button onClick={onClose} style={{ padding: "12px 20px", background: "transparent", color: theme.ink, border: `1px solid ${theme.line}`, cursor: "pointer" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// --- MAIN COMPONENT ---
const PackagingTab = ({ activeBrand }) => {
  // Database States
  const [jobs, setJobs] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [activeJobId, setActiveJobId] = useState(null);
  
  // Canvas State
  const [foamW,  setFoamW]  = useState(90);
  const [foamH,  setFoamH]  = useState(8);
  const [shapes, setShapes] = useState([]);
  const [sel,    setSel]    = useState(new Set());
  const [tool,   setTool]   = useState("select");
  const [snapOn, setSnapOn] = useState(true);
  const [cursor, setCursor] = useState(null);

  // GLB State
  const [glbScene, setGlbScene] = useState(null);
  const [glbModal, setGlbModal] = useState(false);

  // Interaction Refs
  const drawRef = useRef(null), previewRef = useRef(null), dragRef = useRef(null), shiftRef = useRef(false), svgRef = useRef(null);
  const [, tick] = useState(0);

  const PAD = 2;
  const VB = { x: -PAD, y: -PAD, w: foamW + 2 * PAD, h: foamH + 2 * PAD };

  // --- Real-time Firebase Subscriptions ---
  useEffect(() => {
    // 1. Listen to jobs that require packaging (Dispatched from RTG)
    const qJobs = query(collection(db, "jobs"), where("status", "==", "PACKAGING"));
    const unsubJobs = onSnapshot(qJobs, (snap) => {
      const liveJobs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setJobs(liveJobs);
      if (liveJobs.length > 0 && !activeJobId) setActiveJobId(liveJobs[0].id);
    });

    // 2. Listen to saved packaging templates
    const brandQuery = activeBrand ? query(collection(db, "packaging_templates"), where("brandId", "==", activeBrand)) : collection(db, "packaging_templates");
    const unsubTemplates = onSnapshot(brandQuery, (snap) => {
      setTemplates(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => { unsubJobs(); unsubTemplates(); };
  }, [activeBrand, activeJobId]);

  const activeJob = jobs.find(j => j.id === activeJobId);

  // Update canvas to match job's required box size if defined
  useEffect(() => {
    if (activeJob?.boxSize) {
      setFoamW(activeJob.boxSize.w || 90);
      setFoamH(activeJob.boxSize.h || 8);
    }
  }, [activeJob]);

  // --- Keyboard & Mouse Mechanics ---
  useEffect(() => {
    const down = e => {
      shiftRef.current = e.shiftKey;
      if (e.key === "Escape") { drawRef.current = null; previewRef.current = null; tick(n => n + 1); }
      if ((e.key === "Delete" || e.key === "Backspace") && e.target.tagName !== "INPUT") {
        setSel(prev => { if (!prev.size) return prev; setShapes(s => s.filter(x => !prev.has(x.id))); return new Set(); });
      }
    };
    const up = e => { shiftRef.current = e.shiftKey; };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  const getPoint = useCallback((e) => {
    const svg = svgRef.current; if (!svg) return [0, 0];
    const r = svg.getBoundingClientRect();
    let x = VB.x + (e.clientX - r.left) * (VB.w / r.width);
    let y = VB.y + (e.clientY - r.top) * (VB.h / r.height);
    if (snapOn) { x = snapTo(x, 0.5); y = snapTo(y, 0.5); }
    return [x, y];
  }, [VB, snapOn]);

  const onMouseDown = useCallback(e => {
    if (e.button !== 0 || tool === "select") return;
    const [x, y] = getPoint(e);
    drawRef.current = { sx: x, sy: y }; previewRef.current = { sx: x, sy: y, cx: x, cy: y };
  }, [tool, getPoint]);

  const onMouseMove = useCallback(e => {
    const [x, y] = getPoint(e); setCursor([x, y]);
    if (drawRef.current) { previewRef.current = { ...previewRef.current, cx: x, cy: y }; tick(n => n + 1); }
    if (dragRef.current) {
      const { startX, startY, origShapes, ids } = dragRef.current;
      setShapes(origShapes.map(s => ids.has(s.id) ? moveShape(s, x - startX, y - startY) : s));
    }
  }, [getPoint]);

  const onMouseUp = useCallback(e => {
    if (dragRef.current) { dragRef.current = null; return; }
    if (!drawRef.current) return;
    const [x, y] = getPoint(e);
    const { sx, sy } = drawRef.current;
    drawRef.current = null; previewRef.current = null; tick(n => n + 1);
    if (Math.abs(x - sx) < 0.04 && Math.abs(y - sy) < 0.04) return; 

    const c = shiftRef.current; let s = { id: uid() };
    if (tool === "ellipse") { let r = Math.max(Math.abs(x-sx)/2, Math.abs(y-sy)/2); s = { ...s, type: "ellipse", cx: (sx+x)/2, cy: (sy+y)/2, rx: c?r:Math.abs(x-sx)/2, ry: c?r:Math.abs(y-sy)/2 }; }
    else if (tool === "rect") { let w = Math.abs(x-sx), h = Math.abs(y-sy); if(c) w=h=Math.min(w,h); s = { ...s, type: "rect", x: Math.min(sx, x), y: Math.min(sy, y), width: w, height: h }; }
    else if (tool === "line") { s = { ...s, type: "line", x1: sx, y1: sy, x2: x, y2: y, thickness: 0.25 }; }
    setShapes(prev => [...prev, s]);
  }, [getPoint, tool]);

  const onShapeDown = useCallback((e, id) => {
    if (tool !== "select") return;
    e.stopPropagation();
    const [x, y] = getPoint(e);
    setSel(prev => { const next = e.shiftKey ? new Set(prev) : new Set(prev.has(id) ? prev : []); next.add(id); dragRef.current = { ids: next, startX: x, startY: y, origShapes: shapes }; return next; });
  }, [tool, getPoint, shapes]);


  // --- Actions ---
  const handleExportDXF = () => {
    if(!activeJob) return;
    const data = generateDXF(shapes);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/dxf' }));
    a.download = `${activeJob.id}_FOAM_CUT.dxf`; a.click(); URL.revokeObjectURL(a.href);
  };

  const handleGLBUpload = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try { const gltf = await loadGLTF(file); setGlbScene(gltf.scene); setGlbModal(true); } 
    catch (err) { alert(err.message); }
    e.target.value = "";
  };

  const saveTemplate = async () => {
    const name = prompt("Enter a name for this layout template:");
    if (!name) return;
    await addDoc(collection(db, "packaging_templates"), {
      name, shapes, foamW, foamH, brandId: activeBrand || 'global', createdAt: serverTimestamp()
    });
  };

  const loadTemplate = (tpl) => {
    if (window.confirm(`Load template "${tpl.name}"? Current canvas will be overwritten.`)) {
      setShapes(tpl.shapes.map(s => ({ ...s, id: uid() }))); // Re-ID to avoid canvas conflicts
      setFoamW(tpl.foamW); setFoamH(tpl.foamH);
    }
  };

  const deleteTemplate = async (id) => {
    if (window.confirm("Delete this saved template permanently?")) {
      await deleteDoc(doc(db, "packaging_templates", id));
    }
  };

  // --- Rendering Helpers ---
  const renderShape = (s) => {
    const selected = sel.has(s.id);
    const stroke = selected ? theme.brass : theme.ink;
    const fill = selected ? "rgba(176, 141, 87, 0.15)" : "rgba(28, 26, 22, 0.05)";
    const sw = 0.05;
    const common = { key: s.id, stroke, strokeWidth: sw, style: { cursor: tool === "select" ? "grab" : "crosshair" }, onMouseDown: (e) => onShapeDown(e, s.id) };

    if (s.type === "ellipse") return <ellipse {...common} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} fill={fill} />;
    if (s.type === "rect")    return <rect {...common} x={s.x} y={s.y} width={s.width} height={s.height} fill={fill} />;
    if (s.type === "line")    return <line {...common} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} strokeWidth={s.thickness || sw} strokeLinecap="round" stroke={stroke} />;
    if (s.type === "polygon") return <polygon {...common} points={s.points.map(p => `${p.x},${p.y}`).join(" ")} fill={fill} />;
    return null;
  };

  const btnStyle = (active = false) => ({
    padding: "6px 12px", borderRadius: "2px", border: `1px solid ${active ? theme.ink : theme.line}`,
    background: active ? theme.ink : "transparent", color: active ? "#fff" : theme.inkSoft,
    fontFamily: theme.mono, fontSize: "10px", letterSpacing: ".1em", textTransform: "uppercase", cursor: "pointer"
  });

  return (
    <div style={{ display: 'flex', gap: '20px', height: 'calc(100vh - 180px)', backgroundColor: theme.paper, fontFamily: theme.sans }}>
      
      {/* LEFT PANEL: ERP JOBS & TEMPLATES */}
      <div style={{ width: '280px', display: 'flex', flexDirection: 'column', flexShrink: 0, border: `1px solid ${theme.line}`, background: '#fff' }}>
        
        {/* Active Dispatch Queue */}
        <div style={{ padding: '15px', borderBottom: `1px solid ${theme.line}`, background: theme.paper2 }}>
          <span style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.15em', textTransform: 'uppercase', color: theme.inkSoft }}>RTG Dispatch</span>
          <h3 style={{ margin: '5px 0 0 0', fontFamily: theme.serif, fontSize: '1.2rem', color: theme.ink }}>Packaging Queue</h3>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '15px', display: 'flex', flexDirection: 'column', gap: '10px', borderBottom: `1px solid ${theme.line}` }}>
          {jobs.length === 0 ? <div style={{ fontSize: '0.8rem', color: theme.inkSoft, fontStyle: 'italic' }}>No orders currently require packaging.</div> : null}
          {jobs.map(job => {
            const isActive = job.id === activeJobId;
            return (
              <div key={job.id} onClick={() => setActiveJobId(job.id)} style={{ padding: '12px', cursor: 'pointer', border: `1px solid ${isActive ? theme.brass : theme.line}`, background: isActive ? '#fff' : 'transparent' }}>
                <div style={{ fontFamily: theme.mono, fontSize: '11px', color: isActive ? theme.brass : theme.ink }}>{job.id}</div>
                <div style={{ fontSize: '0.85rem', fontWeight: 500, color: theme.ink, marginTop: '4px' }}>{job.customer || 'Standard Order'}</div>
                <div style={{ fontSize: '0.75rem', color: theme.inkSoft, marginTop: '4px' }}>Items: {job.items?.length || 0}</div>
              </div>
            );
          })}
        </div>

        {/* Database Templates */}
        <div style={{ padding: '15px', background: theme.paper }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
             <span style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.15em', textTransform: 'uppercase', color: theme.inkSoft }}>Saved Layouts</span>
             <button onClick={saveTemplate} style={{ ...btnStyle(false), padding: '4px 8px' }}>+ Save</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '150px', overflowY: 'auto' }}>
            {templates.map(tpl => (
              <div key={tpl.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px', border: `1px solid ${theme.line}`, background: '#fff', fontSize: '0.75rem' }}>
                <span style={{ color: theme.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tpl.name}</span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button onClick={() => loadTemplate(tpl)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.brass }}>Load</button>
                  <button onClick={() => deleteTemplate(tpl.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'red' }}>✕</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CENTER PANEL: DXF WORKSPACE */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', border: `1px solid ${theme.line}`, background: '#fff' }}>
        <div style={{ padding: '12px 15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${theme.line}`, background: theme.paper2 }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            {["select", "rect", "ellipse", "line"].map((t) => (
              <button key={t} style={btnStyle(tool === t)} onClick={() => setTool(t)}>{t}</button>
            ))}
            <label style={{ ...btnStyle(false), border: `1px dashed ${theme.brass}`, color: theme.brass, marginLeft: '10px', display: 'flex', alignItems: 'center' }}>
               + Extract .GLB Silhouette
               <input type="file" accept=".glb,.gltf" onChange={handleGLBUpload} style={{ display: "none" }} />
            </label>
          </div>
          <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
             <span style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft }}>SHEET: {foamW}" x {foamH}"</span>
             <button onClick={handleExportDXF} disabled={!activeJob} style={{ ...btnStyle(true), background: activeJob ? theme.brass : theme.line, border: 'none' }}>Export DXF</button>
          </div>
        </div>

        <div style={{ flex: 1, background: theme.paper, overflow: 'hidden', position: 'relative' }}>
          <svg
            ref={svgRef} viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`}
            style={{ width: "100%", height: "100%", cursor: tool === "select" ? "default" : "crosshair" }}
            onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={() => setCursor(null)}
            onClick={e => { if (e.target === svgRef.current && tool === "select") setSel(new Set()); }}
          >
            <rect x={0} y={0} width={foamW} height={foamH} fill="#fff" stroke={theme.line} strokeWidth={.1} />
            {/* Grid */}
            {Array.from({ length: Math.ceil(foamW) }).map((_, i) => <line key={`gx${i}`} x1={i} y1={0} x2={i} y2={foamH} stroke={theme.line} strokeWidth={.02} />)}
            {Array.from({ length: Math.ceil(foamH) }).map((_, i) => <line key={`gy${i}`} x1={0} y1={i} x2={foamW} y2={i} stroke={theme.line} strokeWidth={.02} />)}

            {shapes.map(renderShape)}
            
            {/* Preview Box for Drawing */}
            {previewRef.current && drawRef.current && tool === "rect" && (
               <rect x={Math.min(previewRef.current.sx, previewRef.current.cx)} y={Math.min(previewRef.current.sy, previewRef.current.cy)} width={Math.abs(previewRef.current.cx - previewRef.current.sx)} height={Math.abs(previewRef.current.cy - previewRef.current.sy)} fill="rgba(176,141,87,0.1)" stroke={theme.brass} strokeWidth={0.05} strokeDasharray=".2 .1" />
            )}
            {previewRef.current && drawRef.current && tool === "ellipse" && (
               <ellipse cx={(previewRef.current.sx + previewRef.current.cx) / 2} cy={(previewRef.current.sy + previewRef.current.cy) / 2} rx={Math.abs(previewRef.current.cx - previewRef.current.sx) / 2} ry={Math.abs(previewRef.current.cy - previewRef.current.sy) / 2} fill="rgba(176,141,87,0.1)" stroke={theme.brass} strokeWidth={0.05} strokeDasharray=".2 .1" />
            )}
            {previewRef.current && drawRef.current && tool === "line" && (
               <line x1={previewRef.current.sx} y1={previewRef.current.sy} x2={previewRef.current.cx} y2={previewRef.current.cy} stroke={theme.brass} strokeWidth={0.25} strokeDasharray=".2 .1" />
            )}
          </svg>
        </div>
      </div>

      {/* RIGHT PANEL: JOB PARTS REFERENCE */}
      <div style={{ width: '240px', padding: '20px', background: theme.paper2, border: `1px solid ${theme.line}`, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.15em', textTransform: 'uppercase', color: theme.brass }}>Order Requirements</span>
        <h3 style={{ margin: '5px 0 15px 0', fontFamily: theme.serif, fontSize: '1.2rem', color: theme.ink }}>Bill of Materials</h3>
        
        {activeJob ? (
          <>
            <div style={{ fontSize: '0.8rem', color: theme.inkSoft, marginBottom: '15px' }}>
              <strong>Assigned Box:</strong><br/>
              {activeJob.boxSize?.name || "Standard Box"}<br/>
              ({activeJob.boxSize?.w || foamW}" x {activeJob.boxSize?.h || foamH}")
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, overflowY: 'auto' }}>
              {activeJob.items?.map((item, idx) => (
                <div key={item.id || idx} style={{ background: '#fff', padding: '10px', border: `1px solid ${theme.line}` }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 500, color: theme.ink }}>{item.name}</div>
                  <div style={{ fontSize: '0.75rem', color: theme.inkSoft, fontFamily: theme.mono, marginTop: '4px' }}>
                    {item.w}" x {item.h}"
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
           <div style={{ fontSize: '0.8rem', color: theme.inkSoft, fontStyle: 'italic' }}>Select a job from the queue.</div>
        )}
      </div>

      {/* MODALS */}
      {glbModal && glbScene && (
        <GLBModal
          gltfScene={glbScene} foamW={foamW} foamH={foamH}
          onClose={() => { setGlbModal(false); setGlbScene(null); }}
          onTrace={(pts) => {
            setShapes(prev => [...prev, { id: uid(), type: "polygon", points: pts }]);
            setGlbModal(false); setGlbScene(null);
          }}
        />
      )}

    </div>
  );
};

export default PackagingTab;