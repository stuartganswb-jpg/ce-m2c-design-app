import React, { useState, useRef, useEffect } from 'react';
import { db } from '../../firebase';
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

const VisionPillow = ({ currentUser, activeBrand, visionConfigs, libraryParts, globalLists, activeSession }) => {
  const [viewMode, setViewMode] = useState('ENGINEERING');
  const [isPushingToCPQ, setIsPushingToCPQ] = useState(false);
  
  const fabrics = libraryParts.filter(p => ['TEXTILE', 'FABRIC', 'RAW MATERIAL'].includes(p.manufacturingSpecs?.productType));
  const trims = libraryParts.filter(p => ['TRIMMING', 'COMPONENT'].includes(p.manufacturingSpecs?.productType));

  // --- CANVAS & TOOL STATE ---
  const [visScale, setVisScale] = useState(1.0); 
  const [visPan, setVisPan] = useState({ x: 0, y: 0 });
  const [engTool, setEngTool] = useState("pan"); 

  const [drawStart, setDrawStart] = useState(null);
  const [drawCurrent, setDrawCurrent] = useState(null);
  const [fabricTags, setFabricTags] = useState([]); 

  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState(null);

  // --- VISUAL OVERLAY STATE ---
  const [activeBg, setActiveBg] = useState(null); 
  const [visualTool, setVisualTool] = useState("pan"); 
  const fileInputRef = useRef(null);
  const [calPoints, setCalPoints] = useState([]); 
  const [realInches, setRealInches] = useState("60");
  const [pixelsPerInch, setPixelsPerInch] = useState(4.5); 
  const [isCalibrated, setIsCalibrated] = useState(false);
  const [placedItems, setPlacedItems] = useState([]);
  const [activePlacedId, setActivePlacedId] = useState(null);

  const svgRef = useRef(null);
  const innerGroupRef = useRef(null);

  const [pillowData, setPillowData] = useState({ 
      size: globalLists.pillowSizes?.[0] || '22x22 Square', 
      fabrics: [''], 
      seams: [], 
      flange: 'NONE', 
      flangeSize: 0, 
      fill: globalLists.fillTypes?.[0] || 'DOWN', 
      stitch: globalLists.stitchTypes?.[0] || 'STANDARD',
      outerTrim: { trimId: '', top: false, bottom: false, left: false, right: false }
  });

  const S = 3.5;
  
  // FIXED: Declared at the top level so the sidebar UI can read it
  const isFlange = (pillowData.flange || '').toUpperCase().includes('FLANGE') || (pillowData.flange || '').toUpperCase().includes('WELT');

  useEffect(() => {
      if (fabricTags.length > pillowData.fabrics.length) {
          setFabricTags(prev => prev.slice(0, pillowData.fabrics.length));
      }
  }, [pillowData.fabrics.length, fabricTags.length]);

  const getPillowDimensions = () => {
      const match = (pillowData.size || '').match(/(\d+)x(\d+)/);
      if (match) return { w: parseInt(match[1]), h: parseInt(match[2]) };
      return { w: 22, h: 22 };
  };

  const calculateTrimYards = () => {
      const { w, h } = getPillowDimensions();
      let totalInches = 0;
      
      if (pillowData.outerTrim.top) totalInches += w;
      if (pillowData.outerTrim.bottom) totalInches += w;
      if (pillowData.outerTrim.left) totalInches += h;
      if (pillowData.outerTrim.right) totalInches += h;
      
      pillowData.seams.forEach(seam => {
          if ((seam.treatment || '').toUpperCase().includes('FRINGE')) {
              const lenPx = Math.sqrt(Math.pow(seam.x2 - seam.x1, 2) + Math.pow(seam.y2 - seam.y1, 2));
              totalInches += (lenPx / (S * 2)); 
          }
      });

      return (totalInches / 36).toFixed(2);
  };

  // --- SVG INTERACTION HANDLERS ---
  const getAdjustedSvgPoint = (clientX, clientY) => {
    const svg = svgRef.current; const group = innerGroupRef.current;
    if (!svg || !group) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint(); pt.x = clientX; pt.y = clientY;
    return pt.matrixTransform(group.getScreenCTM().inverse());
  };

  const onPointerDown = (e) => {
    try { e.target.setPointerCapture(e.pointerId); } catch(err) {}
    
    if (viewMode === 'VISUAL' && visualTool === "pan") { setIsPanning(true); setPanStart({ clientX: e.clientX, clientY: e.clientY }); return; }
    if (viewMode === 'ENGINEERING' && engTool === "pan") { setIsPanning(true); setPanStart({ clientX: e.clientX, clientY: e.clientY }); return; }

    const pt = getAdjustedSvgPoint(e.clientX, e.clientY);
    if (!pt) return;

    if (viewMode === 'VISUAL' && visualTool === "calibrate") {
        if (calPoints.length >= 2) { setCalPoints([pt]); setIsCalibrated(false); } 
        else {
            const updatedPoints = [...calPoints, pt]; setCalPoints(updatedPoints);
            if (updatedPoints.length === 2) { 
                const pxDist = Math.sqrt(Math.pow(updatedPoints[1].x - updatedPoints[0].x, 2) + Math.pow(updatedPoints[1].y - updatedPoints[0].y, 2));
                const val = parseFloat(realInches) || 0;
                if (val > 0) setPixelsPerInch(pxDist / val);
                setIsCalibrated(true); setVisualTool("pan"); 
            }
        }
        return;
    }

    if (viewMode === 'ENGINEERING') {
        if (engTool === "seam") { setDrawStart(pt); setDrawCurrent(pt); return; }
        if (engTool === "tag") {
            const nextIndex = fabricTags.length;
            if (nextIndex >= pillowData.fabrics.length) {
                alert(`You have only created ${pillowData.fabrics.length} fabric panel(s). Use the ✂️ DRAW SEAM tool to slice the pillow and create more panels to tag.`);
                return;
            }
            const label = String.fromCharCode(65 + nextIndex); // 65 is 'A'
            setFabricTags([...fabricTags, { id: Date.now(), x: pt.x, y: pt.y, label }]);
            return;
        }
    }
  };

  const onPointerMove = (e) => {
    const pt = getAdjustedSvgPoint(e.clientX, e.clientY);
    if (engTool === "seam" && drawStart && viewMode === 'ENGINEERING') { setDrawCurrent(pt); return; }

    if (isPanning && panStart) {
      if (!svgRef.current || !innerGroupRef.current) return;
      try {
          const svg = svgRef.current;
          const ctm = innerGroupRef.current.getScreenCTM();
          if (!ctm) return;
          const ptC = svg.createSVGPoint(); ptC.x = e.clientX; ptC.y = e.clientY;
          const ptS = svg.createSVGPoint(); ptS.x = panStart.clientX; ptS.y = panStart.clientY;
          const inv = ctm.inverse();
          const dx = ptC.matrixTransform(inv).x - ptS.matrixTransform(inv).x;
          const dy = ptC.matrixTransform(inv).y - ptS.matrixTransform(inv).y;
          setVisPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
          setPanStart({ clientX: e.clientX, clientY: e.clientY });
      } catch(err) {}
    }
  };

  const onPointerUp = () => {
      setIsPanning(false);
      if (engTool === "seam" && drawStart && drawCurrent && viewMode === 'ENGINEERING') {
          const newSeam = { id: Date.now(), x1: drawStart.x, y1: drawStart.y, x2: drawCurrent.x, y2: drawCurrent.y, treatment: 'STANDARD', trimId: '' };
          setPillowData(prev => ({ ...prev, seams: [...prev.seams, newSeam] }));
          setDrawStart(null); setDrawCurrent(null);
      }
  };

  // --- VISUAL OVERLAY HANDLERS ---
  const handleFileUpload = (e) => {
    if (e.target.files[0]) {
      setActiveBg({ name: e.target.files[0].name, url: URL.createObjectURL(e.target.files[0]) });
      setPlacedItems([]); setCalPoints([]); setIsCalibrated(false); 
      setVisScale(1); setVisPan({ x: 0, y: 0 }); setVisualTool("calibrate"); 
    }
  };

  const placeCurrentPillow = () => {
      if (!isCalibrated) return;
      const { w, h } = getPillowDimensions();
      const itemWidthPx = w * pixelsPerInch; 
      const itemHeightPx = h * pixelsPerInch;
      
      const newPlacedItem = {
          id: `PLACED-${Date.now()}`,
          pillowData: JSON.parse(JSON.stringify(pillowData)), // Snapshot current config
          fabricTags: JSON.parse(JSON.stringify(fabricTags)),
          x: 500 - itemWidthPx/2, 
          y: 300 - itemHeightPx/2,
          w: w, h: h
      };
      setPlacedItems([...placedItems, newPlacedItem]);
      setVisualTool("pan");
  };

  const moveItem = (dir) => {
    if (!activePlacedId) return;
    let nx = 0; let ny = 0;
    if (dir === 'up') ny -= 2; if (dir === 'down') ny += 2;
    if (dir === 'left') nx -= 2; if (dir === 'right') nx += 2;
    setPlacedItems(placedItems.map(item => { if (item.id !== activePlacedId) return item; return { ...item, x: item.x + nx, y: item.y + ny }; }));
  };

  const removeItem = (id) => { 
      setPlacedItems(placedItems.filter(i => i.id !== id)); 
      if (activePlacedId === id) setActivePlacedId(null); 
  };

  // --- DATA MODIFIERS ---
  const updateFabric = (index, val) => {
      const newFabs = [...pillowData.fabrics];
      newFabs[index] = val;
      setPillowData({...pillowData, fabrics: newFabs});
  };

  const addFabricPanel = () => { setPillowData(prev => ({ ...prev, fabrics: [...prev.fabrics, ''] })); };
  const removeFabricPanel = (index) => {
      if (pillowData.fabrics.length <= 1) return;
      const newFabs = [...pillowData.fabrics];
      newFabs.splice(index, 1);
      setPillowData({...pillowData, fabrics: newFabs});
  };

  const updateSeamTreatment = (id, field, val) => {
      setPillowData(prev => ({ ...prev, seams: prev.seams.map(s => s.id === id ? { ...s, [field]: val } : s) }));
  };

  const removeSeam = (id) => {
      setPillowData(prev => ({ ...prev, seams: prev.seams.filter(s => s.id !== id) }));
  };

  const handlePushToCPQ = async () => {
      if (!activeSession?.quoteId) return alert("Please select a customer in the main header to initialize a session.");
      if (pillowData.fabrics.includes('')) return alert("❌ Please assign a Master Fabric to all panels before pushing.");
      setIsPushingToCPQ(true);

      const draftId = `DRAFT-${Date.now()}`;
      const seamCountString = pillowData.seams.length === 1 ? '1 Seam' : `${pillowData.seams.length} Seams`;

      const payload = {
          id: draftId, brandId: activeBrand, category: 'PILLOW', status: 'DRAFT_FROM_VISION',
          jobName: activeSession.jobName,
          customerId: activeSession.customerId,
          masterQuoteId: activeSession.quoteId,
          specs: { 
              ...pillowData, 
              tags: fabricTags,
              seamCount: seamCountString
          }, 
          author: currentUser, createdAt: serverTimestamp()
      };

      try {
          await setDoc(doc(db, "cpq_drafts", draftId), payload);
          alert("✅ Pillow Configuration successfully pushed to CPQ Cart!\n\nOpen Tab 8 (CPQ) to pull this draft in and complete pricing/quoting.");
      } catch (e) {
          console.error(e); alert("Error pushing to CPQ.");
      } finally { setIsPushingToCPQ(false); }
  };

  // --- RENDER HELPERS ---
  const renderOuterTrim = (pData, W, H) => {
      const { top, bottom, left, right } = pData.outerTrim;
      if (!top && !bottom && !left && !right) return null;
      
      const ruffle = (length, isHorizontal) => {
          const loops = Math.floor(length / 10);
          return Array.from({ length: loops }).map((_, i) => {
              const base = i * 10;
              if (isHorizontal) {
                  return <path key={i} d={`M ${base} 0 C ${base-5} -15, ${base+15} -15, ${base+10} 0`} fill="none" stroke="var(--brass)" strokeWidth="2" />;
              } else {
                  return <path key={i} d={`M 0 ${base} C -15 ${base-5}, -15 ${base+15}, 0 ${base+10}`} fill="none" stroke="var(--brass)" strokeWidth="2" />;
              }
          });
      };

      return (
          <g>
              {top && <g transform="translate(0, 0)">{ruffle(W, true)}</g>}
              {bottom && <g transform={`translate(0, ${H}) scale(1, -1)`}>{ruffle(W, true)}</g>}
              {left && <g transform="translate(0, 0)">{ruffle(H, false)}</g>}
              {right && <g transform={`translate(${W}, 0) scale(-1, 1)`}>{ruffle(H, false)}</g>}
          </g>
      );
  };

  // Reusable Pillow Renderer Component (used for both Canvas and Visual Overlay)
  const PillowRenderer = ({ data, tags, x, y, displayScale }) => {
      const match = (data.size || '').match(/(\d+)x(\d+)/);
      const dw = match ? parseInt(match[1]) : 22;
      const dh = match ? parseInt(match[2]) : 22;
      
      // Calculate drawing width/height based on scale
      const drawingW = dw * displayScale; 
      const drawingH = dh * displayScale;
      
      const isInternalFlange = (data.flange || '').toUpperCase().includes('FLANGE') || (data.flange || '').toUpperCase().includes('WELT');
      const isRailroadMain = (data.stitch || '').toUpperCase().includes('RAILROAD');

      // The drawn seams need to be scaled relatively. Original drawings use S*2 scale.
      const seamScale = displayScale / (S * 2);

      return (
          <g transform={`translate(${x}, ${y})`}>
              <defs><clipPath id={`pillowClip-${data.id || 'main'}`}><rect x="0" y="0" width={drawingW} height={drawingH} rx={10} /></clipPath></defs>
              <g>
                  <rect x="0" y="0" width={drawingW} height={drawingH} fill="var(--paper-2)" stroke="var(--ink)" strokeWidth="2" strokeDasharray={isRailroadMain ? '8,8' : 'none'} rx={10} />
                  {isInternalFlange && <rect x={-data.flangeSize * displayScale} y={-data.flangeSize * displayScale} width={drawingW + data.flangeSize * displayScale * 2} height={drawingH + data.flangeSize * displayScale * 2} fill="none" stroke="var(--ink)" strokeWidth="1" strokeDasharray="4,4" rx={15} opacity="0.8" />}
                  {renderOuterTrim(data, drawingW, drawingH)}
              </g>
              
              <g clipPath={`url(#pillowClip-${data.id || 'main'})`}>
                  {data.seams.map(s => {
                      const isFringe = (s.treatment || '').toUpperCase().includes('FRINGE'); 
                      const isRR = (s.treatment || '').toUpperCase().includes('RAILROAD');
                      
                      // Map the original center-based drawing coordinates to the top-left based drawing coordinates
                      const mapX = (origX) => (origX - (500 - (dw * S * 2)/2)) * seamScale;
                      const mapY = (origY) => (origY - (300 - (dh * S * 2)/2)) * seamScale;

                      return (
                          <g key={s.id}>
                              <line x1={mapX(s.x1)} y1={mapY(s.y1)} x2={mapX(s.x2)} y2={mapY(s.y2)} stroke="var(--ink)" strokeWidth="2" strokeDasharray={isRR ? "5,5" : "none"} />
                              {isFringe && <line x1={mapX(s.x1)} y1={mapY(s.y1)} x2={mapX(s.x2)} y2={mapY(s.y2)} stroke="var(--brass)" strokeWidth="6" strokeDasharray="2,6" opacity="0.7" />}
                          </g>
                      );
                  })}
              </g>
              {tags && tags.map(tag => {
                  const mapX = (tag.x - (500 - (dw * S * 2)/2)) * seamScale;
                  const mapY = (tag.y - (300 - (dh * S * 2)/2)) * seamScale;
                  return (
                      <g key={tag.id}>
                          <circle cx={mapX} cy={mapY} r="3" fill="var(--ink)" />
                          <line x1={mapX} y1={mapY} x2={mapX + 20} y2={mapY - 30} stroke="var(--ink)" strokeWidth="1.5" />
                          <circle cx={mapX + 20} cy={mapY - 30} r="8" fill="#fff" stroke="var(--ink)" strokeWidth="2" />
                          <text x={mapX + 20} y={mapY - 27} fill="var(--ink)" fontSize="8" fontFamily="var(--sans)" fontWeight="bold" textAnchor="middle">{tag.label}</text>
                      </g>
                  );
              })}
          </g>
      );
  };

  const fieldStyle = { width: '100%', padding: '12px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none' };
  const labelStyle = { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px', letterSpacing: '.1em' };
  const sectionHeaderStyle = { margin: '0 0 20px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)', borderBottom: '1px solid var(--line)', paddingBottom: '10px' };

  let currentCursor = 'crosshair';
  if (viewMode === 'VISUAL') currentCursor = visualTool === 'pan' ? (isPanning ? 'grabbing' : 'grab') : 'crosshair';
  else if (viewMode === 'ENGINEERING') currentCursor = engTool === 'pan' ? (isPanning ? 'grabbing' : 'grab') : (engTool === 'seam' ? 'crosshair' : 'default');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', fontFamily: 'var(--sans)', backgroundColor: 'transparent', minHeight: '100vh', overflow: 'hidden' }}>
      
      <div style={{ display: 'flex', background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
          {['ENGINEERING', 'VISUAL'].map(mode => (
             <button key={mode} onClick={() => setViewMode(mode)} style={{ flex: 1, padding: '16px', background: viewMode === mode ? 'var(--paper-2)' : 'transparent', color: viewMode === mode ? 'var(--ink)' : 'var(--ink-soft)', border: 'none', borderBottom: viewMode === mode ? '2px solid var(--brass)' : '2px solid transparent', fontFamily: 'var(--mono)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer', outline: 'none', transition: 'all 0.2s' }}>
                 {mode === 'ENGINEERING' ? '1. Textile Configurator' : '2. Visual Room Overlay'}
             </button>
          ))}
      </div>

      <div style={{ display: 'flex', gap: '24px', alignItems: 'stretch', flex: 1, opacity: activeSession?.quoteId ? 1 : 0.4, pointerEvents: activeSession?.quoteId ? 'auto' : 'none' }}>
        
        {/* LEFT COLUMN - CONFIGURATOR OR VISUAL TOOLS */}
        <div style={{ width: '450px', background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', overflowY: 'auto' }}>
            
            <div style={{ padding: '20px 24px', background: 'var(--paper-2)', color: 'var(--ink)', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, borderBottom: '1px solid var(--line)' }}>
                {viewMode === 'ENGINEERING' ? 'Pillow Design Engine' : 'Room Drop Cockpit'}
            </div>

            {viewMode === 'ENGINEERING' ? (
                <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    
                    <div style={{ background: '#fff', padding: '20px', border: '1px solid var(--line)' }}>
                        <h4 style={sectionHeaderStyle}>1. Dimensions & Fill</h4>
                        <div style={{ marginBottom: '16px' }}>
                            <label style={labelStyle}>Size Category</label>
                            <select value={pillowData.size} onChange={e => setPillowData({...pillowData, size: e.target.value})} style={fieldStyle}>
                                <option value="">-- Select Size --</option>
                                {(globalLists.pillowSizes || []).map(sz => <option key={sz} value={sz}>{sz}</option>)}
                            </select>
                        </div>
                        <div style={{ display: 'flex', gap: '16px' }}>
                            <div style={{ flex: 1 }}>
                                <label style={labelStyle}>Fill Type</label>
                                <select value={pillowData.fill} onChange={e => setPillowData({...pillowData, fill: e.target.value})} style={fieldStyle}>
                                    <option value="">-- Select Fill --</option>
                                    {(globalLists.fillTypes || []).map(ft => <option key={ft} value={ft}>{ft}</option>)}
                                </select>
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={labelStyle}>Edge / Flange</label>
                                <select value={pillowData.flange} onChange={e => setPillowData({...pillowData, flange: e.target.value})} style={fieldStyle}>
                                    <option value="">-- Select Edge --</option>
                                    {(globalLists.flangeStyles || []).map(fl => <option key={fl} value={fl}>{fl}</option>)}
                                </select>
                            </div>
                        </div>
                        {isFlange && <div style={{ marginTop: '16px' }}><label style={labelStyle}>Flange Size (Inches)</label><input type="number" step="0.5" value={pillowData.flangeSize} onChange={e => setPillowData({...pillowData, flangeSize: parseFloat(e.target.value)||0})} style={fieldStyle} /></div>}
                    </div>

                    <div style={{ background: 'var(--paper)', padding: '20px', border: '1px solid var(--line)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <h4 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>2. Fabric Panels ({pillowData.fabrics.length})</h4>
                            <button onClick={addFabricPanel} style={{ background: 'var(--ink)', color: '#fff', border: 'none', padding: '6px 12px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>Add Panel</button>
                        </div>
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {pillowData.fabrics.map((fabId, index) => {
                                const labelChar = String.fromCharCode(65 + index); // A, B, C
                                return (
                                    <div key={index} style={{ border: '1px solid var(--line)', padding: '16px', background: '#fff', display: 'flex', gap: '16px', alignItems: 'center' }}>
                                        <div style={{ flex: 1 }}>
                                            <label style={labelStyle}>Panel {labelChar} Fabric</label>
                                            <select value={fabId} onChange={e => updateFabric(index, e.target.value)} style={fieldStyle}>
                                                <option value="">-- Assign Master Fabric --</option>
                                                {fabrics.map(f => <option key={f.id} value={f.id}>{f.itemName}</option>)}
                                            </select>
                                        </div>
                                        {pillowData.fabrics.length > 1 && <button onClick={() => removeFabricPanel(index)} style={{ background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: '1.2rem', padding: '0 8px' }}>×</button>}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div style={{ background: '#fff', padding: '20px', border: '1px solid var(--line)', opacity: pillowData.seams.length > 0 ? 1 : 0.6 }}>
                        <h4 style={sectionHeaderStyle}>3. Seam Treatments ({pillowData.seams.length})</h4>
                        <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: 0, marginBottom: '20px' }}>Use the ✂️ DRAW SEAM tool on the canvas to slice panels.</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {pillowData.seams.map((seam, index) => (
                                <div key={seam.id} style={{ border: '1px solid var(--line)', padding: '16px', background: 'var(--paper-2)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                        <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink)' }}>Seam {index + 1}</label>
                                        <button onClick={() => removeSeam(seam.id)} style={{ background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', textDecoration: 'underline' }}>Remove</button>
                                    </div>
                                    <select value={seam.treatment} onChange={e => updateSeamTreatment(seam.id, 'treatment', e.target.value)} style={{ ...fieldStyle, marginBottom: '12px' }}>
                                        <option value="">-- Select Seam Treatment --</option>
                                        {(globalLists.stitchTypes || []).map(st => <option key={st} value={st}>{st}</option>)}
                                    </select>
                                    {(seam.treatment || '').toUpperCase().includes('FRINGE') && (
                                        <select value={seam.trimId} onChange={e => updateSeamTreatment(seam.id, 'trimId', e.target.value)} style={{ ...fieldStyle, border: '1px solid var(--brass)' }}>
                                            <option value="">-- Select Master Trim --</option>
                                            {trims.map(t => <option key={t.id} value={t.id}>{t.itemName}</option>)}
                                        </select>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div style={{ background: 'var(--paper)', padding: '20px', border: '1px solid var(--line)' }}>
                        <h4 style={sectionHeaderStyle}>4. Outer Edge Trim</h4>
                        <select value={pillowData.outerTrim.trimId} onChange={e => setPillowData({...pillowData, outerTrim: {...pillowData.outerTrim, trimId: e.target.value}})} style={{ ...fieldStyle, marginBottom: '16px' }}>
                            <option value="">-- No Outer Trim --</option>
                            {trims.map(t => <option key={t.id} value={t.id}>{t.itemName}</option>)}
                        </select>
                        
                        {pillowData.outerTrim.trimId && (
                            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' }}>
                                {['top', 'bottom', 'left', 'right'].map(edge => (
                                    <label key={edge} style={{ fontSize: '0.85rem', fontFamily: 'var(--sans)', color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                        <input type="checkbox" checked={pillowData.outerTrim[edge]} onChange={(e) => setPillowData({...pillowData, outerTrim: {...pillowData.outerTrim, [edge]: e.target.checked}})} />
                                        <span style={{ textTransform: 'capitalize' }}>{edge}</span>
                                    </label>
                                ))}
                            </div>
                        )}

                        <div style={{ borderTop: '1px solid var(--line)', paddingTop: '16px' }}>
                            <label style={labelStyle}>Main Construction Stitch</label>
                            <select value={pillowData.stitch} onChange={e => setPillowData({...pillowData, stitch: e.target.value})} style={fieldStyle}>
                                <option value="">-- Select Main Stitch --</option>
                                {(globalLists.stitchTypes || []).filter(s => !s.toUpperCase().includes('FRINGE')).map(st => <option key={st} value={st}>{st}</option>)}
                            </select>
                        </div>
                    </div>
                </div>
            ) : (
                <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    <div style={{ background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', borderRadius: '2px' }}>
                        <div style={{ padding: '16px 20px', background: 'var(--paper-2)', color: 'var(--ink)', fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, borderBottom: '1px solid var(--line)' }}>1. Upload Room Scene</div>
                        <div style={{ padding: '24px' }}>
                            <input type="file" accept="image/png, image/jpeg, image/webp" ref={fileInputRef} onChange={handleFileUpload} style={{ display: 'none' }} />
                            <button onClick={() => fileInputRef.current.click()} style={{ width: '100%', padding: '16px', background: 'transparent', color: 'var(--ink)', border: '1px dashed var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>Select Room Image</button>
                        </div>
                    </div>
                    <div style={{ background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', opacity: activeBg ? 1 : 0.5, borderRadius: '2px' }}>
                        <div style={{ padding: '16px 20px', background: visualTool === 'calibrate' ? 'var(--ink)' : 'var(--paper-2)', color: visualTool === 'calibrate' ? '#fff' : 'var(--ink)', fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, borderBottom: '1px solid var(--line)' }}>2. Calibrate Scale</div>
                        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div>
                                <label style={labelStyle}>Known Dimension (Inches)</label>
                                <input type="number" value={realInches} onChange={(e) => setRealInches(e.target.value)} disabled={!activeBg} style={{ ...fieldStyle, background: activeBg ? '#fff' : 'var(--paper)' }} />
                            </div>
                            <div style={{ display: 'flex', gap: '12px' }}>
                                <button onClick={() => { setVisualTool("calibrate"); setCalPoints([]); setIsCalibrated(false); }} disabled={!activeBg} style={{ flex: 1, padding: '12px', background: visualTool === "calibrate" ? 'var(--ink)' : 'var(--paper-2)', color: visualTool === "calibrate" ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', cursor: activeBg ? 'pointer' : 'not-allowed', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                                    {calPoints.length === 1 ? "Click Point 2..." : (isCalibrated ? "Re-draw Line" : "Draw Scale Line")}
                                </button>
                            </div>
                        </div>
                    </div>
                    <div style={{ background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', opacity: isCalibrated ? 1 : 0.5, borderRadius: '2px' }}>
                        <div style={{ padding: '16px 20px', background: 'var(--paper-2)', color: 'var(--ink)', fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, borderBottom: '1px solid var(--line)' }}>3. Drop Pillow</div>
                        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <button onClick={placeCurrentPillow} disabled={!isCalibrated} style={{ width: '100%', padding: '16px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: isCalibrated ? 'pointer' : 'not-allowed', opacity: isCalibrated ? 1 : 0.5, fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Drop Current Design to Canvas</button>
                        </div>
                    </div>

                    {activePlacedId && (
                        <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', borderRadius: '2px' }}>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', borderBottom: '1px solid var(--line)', paddingBottom: '8px' }}>Nudge Position Cockpit</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', width: '180px', margin: '0 auto' }}>
                                <div></div><button onClick={() => moveItem('up')} style={{ padding: '12px', cursor: 'pointer', background: 'var(--paper-2)', border: '1px solid var(--line)', color: 'var(--ink)' }}>▲</button><div></div>
                                <button onClick={() => moveItem('left')} style={{ padding: '12px', cursor: 'pointer', background: 'var(--paper-2)', border: '1px solid var(--line)', color: 'var(--ink)' }}>◀</button>
                                <button onClick={() => { setVisScale(1.0); setVisPan({x:0, y:0}); }} style={{ padding: '12px', cursor: 'pointer', background: 'var(--paper)', border: '1px solid var(--line)', color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase' }}>CTR</button>
                                <button onClick={() => moveItem('right')} style={{ padding: '12px', cursor: 'pointer', background: 'var(--paper-2)', border: '1px solid var(--line)', color: 'var(--ink)' }}>▶</button>
                                <div></div><button onClick={() => moveItem('down')} style={{ padding: '12px', cursor: 'pointer', background: 'var(--paper-2)', border: '1px solid var(--line)', color: 'var(--ink)' }}>▼</button><div></div>
                            </div>
                            <button onClick={() => removeItem(activePlacedId)} style={{ width: '100%', padding: '12px', background: 'transparent', color: '#d9534f', border: '1px solid #d9534f', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', marginTop: '12px', transition: 'all 0.2s' }}>Remove Selected</button>
                        </div>
                    )}
                </div>
            )}

            {viewMode === 'ENGINEERING' && (
                <div style={{ background: 'var(--paper)', borderTop: '1px solid var(--line)' }}>
                    <div style={{ padding: '16px 24px', background: 'var(--ink)', color: '#fff', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Sewing Floor B.O.M</div>
                    <div style={{ padding: '24px', fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: '12px', color: 'var(--ink)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dotted var(--line)', paddingBottom: '8px' }}><span>Face / Back Cut (inc. seam):</span><strong style={{ fontWeight: 500 }}>{getPillowDimensions().w + 1}" x {getPillowDimensions().h + 1}"</strong></div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dotted var(--line)', paddingBottom: '8px' }}><span>Insert / Fill Required:</span><strong style={{ fontWeight: 500 }}>{pillowData.size} ({pillowData.fill})</strong></div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dotted var(--line)', paddingBottom: '8px' }}><span>Total Trim Yardage Req:</span><strong style={{ fontWeight: 500 }}>{calculateTrimYards()} Yds</strong></div>
                        <div style={{ marginTop: '16px' }}>
                            <button onClick={handlePushToCPQ} disabled={isPushingToCPQ || !activeSession?.quoteId} style={{ width: '100%', padding: '16px', background: (isPushingToCPQ || !activeSession?.quoteId) ? 'var(--paper-2)' : 'var(--ink)', color: (isPushingToCPQ || !activeSession?.quoteId) ? 'var(--ink-soft)' : '#fff', border: 'none', cursor: (isPushingToCPQ || !activeSession?.quoteId) ? 'not-allowed' : 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>
                                {isPushingToCPQ ? "Saving..." : "Push Config to CPQ"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>

        {/* RIGHT COLUMN - CANVAS */}
        <div style={{ flex: 1, background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
               {viewMode === 'ENGINEERING' ? (
                   <div style={{ display: 'flex', gap: '8px' }}>
                     <button onClick={() => setEngTool("pan")} style={{ padding: '8px 16px', background: engTool === "pan" ? 'var(--ink)' : '#fff', color: engTool === "pan" ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer', transition: 'all 0.2s' }}>Pan</button>
                     <button onClick={() => setEngTool("seam")} style={{ padding: '8px 16px', background: engTool === "seam" ? 'var(--ink)' : '#fff', color: engTool === "seam" ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer', transition: 'all 0.2s' }}>Draw Seam</button>
                     <button onClick={() => setEngTool("tag")} style={{ padding: '8px 16px', background: engTool === "tag" ? 'var(--ink)' : '#fff', color: engTool === "tag" ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer', transition: 'all 0.2s' }}>Tag Fabric</button>
                     <button onClick={() => { setPillowData(p => ({...p, seams: []})); setFabricTags([]); }} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--line)', color: '#d9534f', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>Clear</button>
                   </div>
               ) : (
                   <div style={{ display: 'flex', gap: '8px' }}>
                     <button onClick={() => setVisualTool("pan")} style={{ padding: '8px 16px', background: visualTool === "pan" ? 'var(--ink)' : '#fff', color: visualTool === "pan" ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', cursor: 'pointer', letterSpacing: '.1em', transition: 'all 0.2s' }}>Pan Viewport</button>
                   </div>
               )}
               
               <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => setVisScale(s => Math.min(s + 0.25, 4))} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer' }}>➕</button>
                  <button onClick={() => setVisScale(s => Math.max(s - 0.25, 0.5))} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer' }}>➖</button>
                  <button onClick={() => { setVisScale(1.0); setVisPan({x:0, y:0}); }} style={{ padding: '8px 16px', background: 'var(--paper)', border: '1px solid var(--line)', color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', cursor: 'pointer', letterSpacing: '.1em' }}>Reset</button>
               </div>
            </div>
            
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: viewMode === 'VISUAL' ? 'var(--dark)' : 'var(--paper)', minHeight: '650px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
               {viewMode === 'VISUAL' && !activeBg && <div style={{ color: 'var(--ink-soft)', textAlign: 'center' }}><div style={{ fontSize: '3rem', marginBottom: '16px', opacity: 0.5 }}>🖼️</div><h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500 }}>No Room Scene Loaded</h3></div>}

               {(viewMode === 'ENGINEERING' || (viewMode === 'VISUAL' && activeBg)) && (
                   <svg ref={svgRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} viewBox="0 0 1000 600" style={{ width: '100%', height: '100%', display: 'block', cursor: currentCursor }}>
                      <g ref={innerGroupRef} transform={`translate(${visPan.x}, ${visPan.y}) translate(500, 300) scale(${visScale}) translate(-500, -300)`}>
                        
                        {viewMode === 'VISUAL' && activeBg && (
                            <g>
                                <image href={activeBg.url} x="0" y="0" width="1000" height="600" preserveAspectRatio="xMidYMid slice" opacity="0.85" />
                                {calPoints.map((pt, i) => <g key={`cal-${i}`} transform={`translate(${pt.x}, ${pt.y})`}><circle cx="0" cy="0" r="1.5" fill="var(--ink)" /><line x1="-6" y1="0" x2="-2" y2="0" stroke="var(--ink)" strokeWidth="1.5" /><line x1="2" y1="0" x2="6" y2="0" stroke="var(--ink)" strokeWidth="1.5" /><line x1="0" y1="-6" x2="0" y2="-2" stroke="var(--ink)" strokeWidth="1.5" /><line x1="0" y1="2" x2="0" y2="6" stroke="var(--ink)" strokeWidth="1.5" /></g>)}
                                {calPoints.length === 2 && (() => {
                                    const midX = (calPoints[0].x + calPoints[1].x) / 2; const midY = (calPoints[0].y + calPoints[1].y) / 2;
                                    const dx = calPoints[1].x - calPoints[0].x; const dy = calPoints[1].y - calPoints[0].y;
                                    const len = Math.sqrt(dx * dx + dy * dy); const nx = -dy / len; const ny = dx / len;
                                    const offX = midX + nx * 40; const offY = midY + ny * 40;
                                    return (<g><line x1={calPoints[0].x} y1={calPoints[0].y} x2={calPoints[1].x} y2={calPoints[1].y} stroke="var(--ink)" strokeWidth="2" strokeDasharray="3,3" /><line x1={midX} y1={midY} x2={offX} y2={offY} stroke="var(--ink)" strokeWidth="1.5" /><rect x={offX - 45} y={offY - 12} width="90" height="24" fill="#fff" stroke="var(--line)" strokeWidth="1" /><text x={offX} y={offY + 4} fill="var(--ink)" fontSize="11" fontFamily="var(--mono)" letterSpacing=".05em" textAnchor="middle">{realInches}" SPEC</text></g>);
                                })()}

                                {placedItems.map(item => {
                                    const isSelected = item.id === activePlacedId;
                                    return (
                                        <g key={item.id} transform={`translate(${item.x}, ${item.y})`} onClick={(e) => { e.stopPropagation(); setActivePlacedId(item.id); }} style={{ cursor: 'move' }}>
                                            {/* We wrap the PillowRenderer to isolate the event handling and scaling */}
                                            <g>
                                                {/* Selection Highlight */}
                                                {isSelected && <rect x="-5" y="-5" width={(item.w * pixelsPerInch) + 10} height={(item.h * pixelsPerInch) + 10} fill="transparent" stroke="#fff" strokeWidth="2" strokeDasharray="4,4" />}
                                                <PillowRenderer data={item.pillowData} tags={item.fabricTags} x={0} y={0} displayScale={pixelsPerInch} />
                                            </g>
                                        </g>
                                    );
                                })}
                            </g>
                        )}

                        {viewMode === 'ENGINEERING' && (
                            <g>
                                {Array.from({ length: 15 }).map((_, i) => <line key={`h-${i}`} x1="0" y1={i * 40} x2="1000" y2={i * 40} stroke="var(--line)" strokeWidth="1" />)}
                                {Array.from({ length: 25 }).map((_, i) => <line key={`v-${i}`} x1={i * 40} y1="0" x2={i * 40} y2="600" stroke="var(--line)" strokeWidth="1" />)}
                                
                                <PillowRenderer 
                                    data={pillowData} 
                                    tags={fabricTags} 
                                    x={500 - (getPillowDimensions().w * S * 2)/2} 
                                    y={300 - (getPillowDimensions().h * S * 2)/2} 
                                    displayScale={S * 2} 
                                />

                                {drawStart && drawCurrent && engTool === 'seam' && <line x1={drawStart.x} y1={drawStart.y} x2={drawCurrent.x} y2={drawCurrent.y} stroke="var(--ink)" strokeWidth="3" strokeDasharray="5,5" />}
                                
                                <text x={500} y={300 - (getPillowDimensions().h * S * 2)/2 - 30} fill="var(--ink-soft)" fontSize="14" fontWeight="500" fontFamily="var(--sans)" textAnchor="middle">{getPillowDimensions().w}" x {getPillowDimensions().h}"</text>
                                <text x={500} y={300 - (getPillowDimensions().h * S * 2)/2 - 15} fill="var(--ink)" fontSize="10" fontFamily="var(--mono)" letterSpacing=".05em" textAnchor="middle">
                                    {(pillowData.flange || '').toUpperCase().includes('FLANGE') || (pillowData.flange || '').toUpperCase().includes('WELT') ? `+ ${pillowData.flangeSize}" Flange` : 'Knife Edge'}
                                </text>
                            </g>
                        )}

                      </g>
                   </svg>
               )}
            </div>
        </div>
      </div>
    </div>
  );
};

export default VisionPillow;