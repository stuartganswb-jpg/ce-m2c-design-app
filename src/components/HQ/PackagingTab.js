import React, { useState, useRef, useCallback, useEffect } from 'react';

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

// --- MOCK DATABASE ---
const MOCK_PACKAGING_QUEUE = [
  {
    jobId: 'JOB-9042',
    customer: 'Smith Residence',
    status: 'READY FOR PACKING',
    boxSize: { id: 'BOX-A', name: 'Standard Long Box', w: 90, h: 8 },
    items: [
      { id: 'TUBE-1', name: 'Main Pole', type: 'extruded', w: 80, h: 1.0 },
      { id: 'FIN-1', name: 'Left Finial', type: 'static', w: 3.5, h: 3.5 },
      { id: 'FIN-2', name: 'Right Finial', type: 'static', w: 3.5, h: 3.5 },
      { id: 'BRK-1', name: 'Center Bracket', type: 'static', w: 3.0, h: 4.0 },
      { id: 'BRK-2', name: 'L Bracket', type: 'static', w: 3.0, h: 4.0 },
      { id: 'BRK-3', name: 'R Bracket', type: 'static', w: 3.0, h: 4.0 }
    ]
  }
];

// --- UTILITIES & DXF GENERATION ---
const uid = () => Math.random().toString(36).slice(2, 9);
const snapTo = (v, inc) => Math.round(v / inc) * inc;
const fmt = (n, d = 4) => parseFloat(n.toFixed(d));

function moveShape(s, dx, dy) {
  if (s.type === "ellipse") return { ...s, cx: s.cx + dx, cy: s.cy + dy };
  if (s.type === "rect")    return { ...s, x: s.x + dx, y: s.y + dy };
  if (s.type === "line")    return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy };
  return s;
}

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
        e("10",n(s.cx),"20",n(-s.cy),"30","0");
        e("40",n(s.rx));
      } else {
        e("0","ELLIPSE","8","0");
        e("10",n(s.cx),"20",n(-s.cy),"30","0");
        if (s.rx >= s.ry) {
          e("11",n(s.rx),"21","0","31","0");
          e("40",n(s.ry / s.rx));
        } else {
          e("11","0","21",n(s.ry),"31","0");
          e("40",n(s.rx / s.ry));
        }
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
    }
  }
  e("0","ENDSEC","0","EOF");
  return buf.join("\n");
}

// --- MAIN COMPONENT ---
const PackagingTab = () => {
  // Job State
  const [jobs] = useState(MOCK_PACKAGING_QUEUE);
  const [activeJobId, setActiveJobId] = useState(MOCK_PACKAGING_QUEUE[0].jobId);
  const activeJob = jobs.find(j => j.jobId === activeJobId);

  // Canvas State
  const [foamW,  setFoamW]  = useState(activeJob ? activeJob.boxSize.w : 90);
  const [foamH,  setFoamH]  = useState(activeJob ? activeJob.boxSize.h : 8);
  const [shapes,    setShapes]    = useState([]);
  const [sel,       setSel]       = useState(new Set());
  const [tool,      setTool]      = useState("select");
  const [lineThick, setLineThick] = useState(0.25);
  const [snapOn,    setSnapOn]    = useState(true);
  const [snapInc,   setSnapInc]   = useState(0.5);
  const [cursor,    setCursor]    = useState(null);

  // Interaction Refs
  const drawRef    = useRef(null);
  const previewRef = useRef(null);
  const dragRef    = useRef(null);
  const shiftRef   = useRef(false);
  const svgRef     = useRef(null);
  const [, tick]   = useState(0);

  const PAD = 2;
  const VB  = { x: -PAD, y: -PAD, w: foamW + 2 * PAD, h: foamH + 2 * PAD };

  // Sync canvas size to selected job safely
  useEffect(() => {
    if (activeJob) {
      setFoamW(activeJob.boxSize.w);
      setFoamH(activeJob.boxSize.h);
    }
  }, [activeJobId, activeJob]);

  // Keyboard events
  useEffect(() => {
    const down = e => {
      shiftRef.current = e.shiftKey;
      if (e.key === "Escape") {
        drawRef.current = null; previewRef.current = null;
        tick(n => n + 1);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && e.target.tagName !== "INPUT") {
        setSel(prev => {
          if (!prev.size) return prev;
          setShapes(s => s.filter(x => !prev.has(x.id)));
          return new Set();
        });
      }
    };
    const up = e => { shiftRef.current = e.shiftKey; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  // Canvas coordinate mapping
  const getPoint = useCallback((e) => {
    const svg = svgRef.current;
    if (!svg) return [0, 0];
    const r = svg.getBoundingClientRect();
    let x = VB.x + (e.clientX - r.left)  * (VB.w / r.width);
    let y = VB.y + (e.clientY - r.top)   * (VB.h / r.height);
    if (snapOn) { x = snapTo(x, snapInc); y = snapTo(y, snapInc); }
    return [x, y];
  }, [VB, snapOn, snapInc]);

  // Mouse Mechanics
  const onMouseDown = useCallback((e) => {
    if (e.button !== 0 || tool === "select") return;
    const [x, y] = getPoint(e);
    drawRef.current    = { sx: x, sy: y };
    previewRef.current = { sx: x, sy: y, cx: x, cy: y };
  }, [tool, getPoint]);

  const onMouseMove = useCallback((e) => {
    const [x, y] = getPoint(e);
    setCursor([x, y]);

    if (drawRef.current) {
      previewRef.current = { ...previewRef.current, cx: x, cy: y };
      tick(n => n + 1);
    }
    if (dragRef.current) {
      const { startX, startY, origShapes, ids } = dragRef.current;
      const dx = x - startX, dy = y - startY;
      setShapes(origShapes.map(s => ids.has(s.id) ? moveShape(s, dx, dy) : s));
    }
  }, [getPoint]);

  const onMouseUp = useCallback((e) => {
    if (dragRef.current) { dragRef.current = null; return; }
    if (!drawRef.current) return;

    const [x, y] = getPoint(e);
    const { sx, sy } = drawRef.current;
    drawRef.current = null; previewRef.current = null;
    tick(n => n + 1);

    const dx = x - sx, dy = y - sy;
    if (Math.abs(dx) < 0.04 && Math.abs(dy) < 0.04) return; 

    const constrained = shiftRef.current;
    let s = { id: uid() };

    if (tool === "ellipse") {
      let rx = Math.abs(dx) / 2, ry = Math.abs(dy) / 2;
      if (constrained) rx = ry = Math.min(rx, ry);
      s = { ...s, type: "ellipse", cx: (sx + x) / 2, cy: (sy + y) / 2, rx, ry };
    } else if (tool === "rect") {
      let w = Math.abs(dx), h = Math.abs(dy);
      if (constrained) w = h = Math.min(w, h);
      s = { ...s, type: "rect", x: Math.min(sx, x), y: Math.min(sy, y), width: w, height: h };
    } else if (tool === "line") {
      s = { ...s, type: "line", x1: sx, y1: sy, x2: x, y2: y, thickness: lineThick };
    }

    setShapes(prev => [...prev, s]);
  }, [getPoint, tool, lineThick]);

  const onShapeDown = useCallback((e, id) => {
    if (tool !== "select") return;
    e.stopPropagation();
    const [x, y] = getPoint(e);
    setSel(prev => {
      const next = e.shiftKey ? new Set(prev) : new Set(prev.has(id) ? prev : []);
      next.add(id);
      dragRef.current = { ids: next, startX: x, startY: y, origShapes: shapes };
      return next;
    });
  }, [tool, getPoint, shapes]);

  // Export
  const handleExportDXF = () => {
    const data = generateDXF(shapes);
    const blob = new Blob([data], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeJob.jobId}_FOAM_CUT.dxf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // UI Helpers
  const renderPreview = () => {
    const p = previewRef.current;
    if (!p || !drawRef.current) return null;
    const dx = p.cx - p.sx, dy = p.cy - p.sy;
    const c = shiftRef.current;
    const style = { fill: "rgba(176, 141, 87, 0.1)", stroke: theme.brass, strokeWidth: 0.05, strokeDasharray: ".2 .1" };

    if (tool === "ellipse") {
      let rx = Math.abs(dx) / 2, ry = Math.abs(dy) / 2;
      if (c) rx = ry = Math.min(rx, ry);
      return <ellipse cx={(p.sx + p.cx) / 2} cy={(p.sy + p.cy) / 2} rx={rx || .001} ry={ry || .001} {...style} />;
    }
    if (tool === "rect") {
      let w = Math.abs(dx), h = Math.abs(dy);
      if (c) w = h = Math.min(w, h);
      return <rect x={Math.min(p.sx, p.cx)} y={Math.min(p.sy, p.cy)} width={w} height={h} {...style} />;
    }
    if (tool === "line") {
      return <line x1={p.sx} y1={p.sy} x2={p.cx} y2={p.cy} stroke={theme.brass} strokeWidth={lineThick || .05} strokeDasharray=".2 .1" />;
    }
    return null;
  };

  const renderShape = (s) => {
    const selected = sel.has(s.id);
    const stroke   = selected ? theme.brass : theme.ink;
    const sw       = 0.05;
    const common   = {
      key: s.id, stroke, strokeWidth: sw,
      style: { cursor: tool === "select" ? "grab" : "crosshair" },
      onMouseDown: (e) => onShapeDown(e, s.id),
    };

    const fillActive = "rgba(176, 141, 87, 0.15)";
    const fillInactive = "rgba(28, 26, 22, 0.05)";

    if (s.type === "ellipse")
      return <ellipse {...common} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} fill={selected ? fillActive : fillInactive} />;
    if (s.type === "rect")
      return <rect {...common} x={s.x} y={s.y} width={s.width} height={s.height} fill={selected ? fillActive : fillInactive} />;
    if (s.type === "line")
      return <line {...common} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} strokeWidth={s.thickness || sw} strokeLinecap="round" stroke={selected ? theme.brass : theme.ink} />;
    return null;
  };

  const btnStyle = (active = false) => ({
    padding: "6px 12px",
    borderRadius: "2px",
    border: `1px solid ${active ? theme.ink : theme.line}`,
    background: active ? theme.ink : "transparent",
    color: active ? "#fff" : theme.inkSoft,
    fontFamily: theme.mono,
    fontSize: "10px",
    letterSpacing: ".1em",
    textTransform: "uppercase",
    cursor: "pointer",
    transition: "all 0.2s"
  });

  return (
    <div style={{ display: 'flex', gap: '20px', height: 'calc(100vh - 180px)', backgroundColor: theme.paper, fontFamily: theme.sans }}>
      
      {/* LEFT PANEL: QUEUE */}
      <div style={{ width: '260px', display: 'flex', flexDirection: 'column', flexShrink: 0, border: `1px solid ${theme.line}`, background: '#fff' }}>
        <div style={{ padding: '15px', borderBottom: `1px solid ${theme.line}`, background: theme.paper2 }}>
          <span style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.15em', textTransform: 'uppercase', color: theme.inkSoft }}>Queue</span>
          <h3 style={{ margin: '5px 0 0 0', fontFamily: theme.serif, fontSize: '1.2rem', color: theme.ink }}>Packaging</h3>
        </div>
        
        <div style={{ padding: '15px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {jobs.map(job => {
            const isActive = job.jobId === activeJobId;
            return (
              <div 
                key={job.jobId} 
                onClick={() => setActiveJobId(job.jobId)} 
                style={{ 
                  padding: '12px', 
                  cursor: 'pointer', 
                  border: `1px solid ${isActive ? theme.brass : theme.line}`, 
                  background: isActive ? '#fff' : 'transparent',
                  transition: 'border 0.2s'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                  <span style={{ fontFamily: theme.mono, fontSize: '11px', color: isActive ? theme.brass : theme.ink }}>{job.jobId}</span>
                </div>
                <div style={{ fontSize: '0.85rem', fontWeight: 500, color: theme.ink }}>{job.customer}</div>
                <div style={{ fontSize: '0.75rem', color: theme.inkSoft, marginTop: '4px' }}>Items: {job.items.length}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* CENTER PANEL: DXF WORKSPACE */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', border: `1px solid ${theme.line}`, background: '#fff' }}>
        <div style={{ padding: '12px 15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${theme.line}`, background: theme.paper2 }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            {["select", "rect", "ellipse", "line"].map((t) => (
              <button key={t} style={btnStyle(tool === t)} onClick={() => setTool(t)}>
                {t}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
             <span style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft }}>
               SHEET: {foamW}" x {foamH}"
             </span>
             <button onClick={handleExportDXF} style={{ ...btnStyle(true), background: theme.brass, border: 'none' }}>
                Export DXF
             </button>
          </div>
        </div>

        <div style={{ flex: 1, background: theme.paper, overflow: 'hidden', position: 'relative' }}>
          <svg
            ref={svgRef}
            viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`}
            style={{ width: "100%", height: "100%", cursor: tool === "select" ? "default" : "crosshair" }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={() => setCursor(null)}
            onClick={e => { if (e.target === svgRef.current && tool === "select") setSel(new Set()); }}
          >
            {/* Base Sheet */}
            <rect x={0} y={0} width={foamW} height={foamH} fill="#fff" stroke={theme.line} strokeWidth={.1} />

            {/* Grid */}
            {Array.from({ length: Math.ceil(foamW) }).map((_, i) => (
              <line key={`gx${i}`} x1={i} y1={0} x2={i} y2={foamH} stroke={theme.line} strokeWidth={.02} />
            ))}
            {Array.from({ length: Math.ceil(foamH) }).map((_, i) => (
              <line key={`gy${i}`} x1={0} y1={i} x2={foamW} y2={i} stroke={theme.line} strokeWidth={.02} />
            ))}

            {shapes.map(renderShape)}
            {renderPreview()}
          </svg>
        </div>
      </div>

      {/* RIGHT PANEL: STATIC POST-IT REFERENCE */}
      <div style={{ width: '240px', padding: '20px', background: theme.paper2, border: `1px solid ${theme.line}`, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.15em', textTransform: 'uppercase', color: theme.brass }}>Static Reference</span>
        <h3 style={{ margin: '5px 0 15px 0', fontFamily: theme.serif, fontSize: '1.2rem', color: theme.ink }}>Required Parts</h3>
        
        <div style={{ fontSize: '0.8rem', color: theme.inkSoft, marginBottom: '15px' }}>
          <strong>Box Assinged:</strong> {activeJob.boxSize.name} <br/>
          ({activeJob.boxSize.w}" x {activeJob.boxSize.h}")
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, overflowY: 'auto' }}>
          {activeJob.items.map(item => (
            <div key={item.id} style={{ background: '#fff', padding: '10px', border: `1px solid ${theme.line}` }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 500, color: theme.ink }}>{item.name}</div>
              <div style={{ fontSize: '0.75rem', color: theme.inkSoft, fontFamily: theme.mono, marginTop: '4px' }}>
                {item.w}" x {item.h}"
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};

export default PackagingTab;