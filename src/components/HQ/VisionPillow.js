import React, { useState, useRef, useEffect } from 'react';
import { db } from '../../firebase';
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

const VisionPillow = ({ currentUser, activeBrand, visionConfigs, libraryParts, globalLists }) => {
  const [isPushingToCPQ, setIsPushingToCPQ] = useState(false);
  
  const fabrics = libraryParts.filter(p => ['TEXTILE', 'FABRIC', 'RAW MATERIAL'].includes(p.manufacturingSpecs?.productType));
  const trims = libraryParts.filter(p => ['TRIMMING', 'COMPONENT'].includes(p.manufacturingSpecs?.productType));

  const [visScale, setVisScale] = useState(1.0); 
  const [visPan, setVisPan] = useState({ x: 0, y: 0 });
  const [engTool, setEngTool] = useState("pan"); 

  const [drawStart, setDrawStart] = useState(null);
  const [drawCurrent, setDrawCurrent] = useState(null);
  const [fabricTags, setFabricTags] = useState([]); 

  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState(null);

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
    e.target.setPointerCapture(e.pointerId);
    const pt = getAdjustedSvgPoint(e.clientX, e.clientY);

    if (engTool === "pan") { setIsPanning(true); setPanStart({ clientX: e.clientX, clientY: e.clientY }); return; }
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
  };

  const onPointerMove = (e) => {
    const pt = getAdjustedSvgPoint(e.clientX, e.clientY);
    if (engTool === "seam" && drawStart) { setDrawCurrent(pt); return; }

    if (engTool === "pan" && isPanning && panStart) {
      const svg = svgRef.current; if (!svg) return;
      const ptC = svg.createSVGPoint(); ptC.x = e.clientX; ptC.y = e.clientY;
      const ptS = svg.createSVGPoint(); ptS.x = panStart.clientX; ptS.y = panStart.clientY;
      const inv = svg.getScreenCTM().inverse();
      const dx = ptC.matrixTransform(inv).x - ptS.matrixTransform(inv).x;
      const dy = ptC.matrixTransform(inv).y - ptS.matrixTransform(inv).y;
      
      setVisPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      setPanStart({ clientX: e.clientX, clientY: e.clientY });
    }
  };

  const onPointerUp = () => {
      setIsPanning(false);
      if (engTool === "seam" && drawStart && drawCurrent) {
          const newSeam = { id: Date.now(), x1: drawStart.x, y1: drawStart.y, x2: drawCurrent.x, y2: drawCurrent.y, treatment: 'STANDARD', trimId: '' };
          setPillowData(prev => ({ ...prev, seams: [...prev.seams, newSeam] }));
          setDrawStart(null); setDrawCurrent(null);
      }
  };

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
      if (pillowData.fabrics.includes('')) return alert("❌ Please assign a Master Fabric to all panels before pushing.");
      setIsPushingToCPQ(true);

      const draftId = `DRAFT-${Date.now()}`;
      
      // Calculate the specific string needed for the translation engine mapped to the seeded flow
      const seamCountString = pillowData.seams.length === 1 ? '1 Seam' : `${pillowData.seams.length} Seams`;

      const payload = {
          id: draftId, brandId: activeBrand, category: 'PILLOW', status: 'DRAFT_FROM_VISION',
          specs: { 
              ...pillowData, 
              tags: fabricTags,
              seamCount: seamCountString // Allows CPQ to map to the cost matrix!
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

  const renderOuterTrim = (W, H) => {
      const { top, bottom, left, right } = pillowData.outerTrim;
      if (!top && !bottom && !left && !right) return null;
      
      const ruffle = (length, isHorizontal) => {
          const loops = Math.floor(length / 10);
          return Array.from({ length: loops }).map((_, i) => {
              const base = i * 10;
              if (isHorizontal) {
                  return <path key={i} d={`M ${base} 0 C ${base-5} -15, ${base+15} -15, ${base+10} 0`} fill="none" stroke="#d4af37" strokeWidth="2" />;
              } else {
                  return <path key={i} d={`M 0 ${base} C -15 ${base-5}, -15 ${base+15}, 0 ${base+10}`} fill="none" stroke="#d4af37" strokeWidth="2" />;
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

  const { w, h } = getPillowDimensions();
  const W = w * S * 2; 
  const H = h * S * 2;
  const cX = 500; const cY = 300;
  const isFlange = (pillowData.flange || '').toUpperCase().includes('FLANGE') || (pillowData.flange || '').toUpperCase().includes('WELT');
  const isRailroadMain = (pillowData.stitch || '').toUpperCase().includes('RAILROAD');

  return (
    <div style={{ display: 'flex', gap: '20px', alignItems: 'stretch' }}>
        
        <div style={{ width: '450px', background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '8px 8px 0 rgba(0,0,0,0.1)', overflow: 'hidden' }}>
            <div style={{ padding: '20px', background: '#000', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, textTransform: 'uppercase' }}>TEXTILE CONFIGURATOR</h3>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                
                <div style={{ background: '#f8f9fa', padding: '15px', border: '1px solid #ccc' }}>
                    <label style={{ fontSize: '0.75rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>1. DIMENSIONS & FILL:</label>
                    <select value={pillowData.size} onChange={e => setPillowData({...pillowData, size: e.target.value})} style={{ width: '100%', padding: '8px', border: '1px solid #000', marginBottom: '10px', fontWeight: 'bold' }}>
                        <option value="">-- Select Size --</option>
                        {(globalLists.pillowSizes || []).map(sz => <option key={sz} value={sz}>{sz}</option>)}
                    </select>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <div style={{ flex: 1 }}>
                            <label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>FILL TYPE:</label>
                            <select value={pillowData.fill} onChange={e => setPillowData({...pillowData, fill: e.target.value})} style={{ width: '100%', padding: '8px', border: '1px solid #ccc' }}>
                                <option value="">-- Select Fill --</option>
                                {(globalLists.fillTypes || []).map(ft => <option key={ft} value={ft}>{ft}</option>)}
                            </select>
                        </div>
                        <div style={{ flex: 1 }}>
                            <label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>EDGE / FLANGE:</label>
                            <select value={pillowData.flange} onChange={e => setPillowData({...pillowData, flange: e.target.value})} style={{ width: '100%', padding: '8px', border: '1px solid #ccc' }}>
                                <option value="">-- Select Edge --</option>
                                {(globalLists.flangeStyles || []).map(fl => <option key={fl} value={fl}>{fl}</option>)}
                            </select>
                        </div>
                    </div>
                    {isFlange && <div style={{ marginTop: '10px' }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>FLANGE SIZE (IN):</label><input type="number" step="0.5" value={pillowData.flangeSize} onChange={e => setPillowData({...pillowData, flangeSize: parseFloat(e.target.value)||0})} style={{ width: '100%', padding: '6px', border: '1px solid #ccc', boxSizing: 'border-box' }} /></div>}
                </div>

                <div style={{ background: '#eafaf1', padding: '15px', border: '2px solid #28a745' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <h4 style={{ margin: 0, color: '#1e7e34' }}>2. FABRIC PANELS ({pillowData.fabrics.length})</h4>
                        <button onClick={addFabricPanel} style={{ background: '#28a745', color: '#fff', border: 'none', padding: '5px 10px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.7rem' }}>+ ADD PANEL</button>
                    </div>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {pillowData.fabrics.map((fabId, index) => {
                            const labelChar = String.fromCharCode(65 + index); // A, B, C
                            return (
                                <div key={index} style={{ border: '1px solid #28a745', padding: '10px', background: '#fff', display: 'flex', gap: '10px', alignItems: 'center' }}>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '3px' }}>PANEL {labelChar} FABRIC:</label>
                                        <select value={fabId} onChange={e => updateFabric(index, e.target.value)} style={{ width: '100%', padding: '6px', border: '1px solid #ccc' }}>
                                            <option value="">-- Assign Master Fabric --</option>
                                            {fabrics.map(f => <option key={f.id} value={f.id}>{f.itemName}</option>)}
                                        </select>
                                    </div>
                                    {pillowData.fabrics.length > 1 && <button onClick={() => removeFabricPanel(index)} style={{ background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', fontSize: '1rem' }}>✖</button>}
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div style={{ background: '#fdf3f4', padding: '15px', border: '2px solid #d9534f', opacity: pillowData.seams.length > 0 ? 1 : 0.6 }}>
                    <h4 style={{ margin: '0 0 5px 0', color: '#d9534f' }}>3. SEAM TREATMENTS ({pillowData.seams.length})</h4>
                    <p style={{ fontSize: '0.7rem', color: '#666', marginTop: 0 }}>Use the ✂️ DRAW SEAM tool on the canvas to slice panels.</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {pillowData.seams.map((seam, index) => (
                            <div key={seam.id} style={{ border: '1px solid #d9534f', padding: '10px', background: '#fff' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                                    <label style={{ fontSize: '0.7rem', fontWeight: 'bold' }}>SEAM {index + 1}:</label>
                                    <button onClick={() => removeSeam(seam.id)} style={{ background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', fontWeight: 'bold' }}>✖</button>
                                </div>
                                <select value={seam.treatment} onChange={e => updateSeamTreatment(seam.id, 'treatment', e.target.value)} style={{ width: '100%', padding: '6px', border: '1px solid #ccc', marginBottom: '5px' }}>
                                    <option value="">-- Select Seam Treatment --</option>
                                    {(globalLists.stitchTypes || []).map(st => <option key={st} value={st}>{st}</option>)}
                                </select>
                                {(seam.treatment || '').toUpperCase().includes('FRINGE') && (
                                    <select value={seam.trimId} onChange={e => updateSeamTreatment(seam.id, 'trimId', e.target.value)} style={{ width: '100%', padding: '6px', border: '2px solid #d4af37', background: '#fff9e6' }}>
                                        <option value="">-- Select Master Trim --</option>
                                        {trims.map(t => <option key={t.id} value={t.id}>{t.itemName}</option>)}
                                    </select>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                <div style={{ background: '#fff9e6', padding: '15px', border: '2px solid #d4af37' }}>
                    <h4 style={{ margin: '0 0 10px 0', color: '#b8860b' }}>4. OUTER EDGE TRIM</h4>
                    <select value={pillowData.outerTrim.trimId} onChange={e => setPillowData({...pillowData, outerTrim: {...pillowData.outerTrim, trimId: e.target.value}})} style={{ width: '100%', padding: '8px', border: '1px solid #d4af37', marginBottom: '10px' }}>
                        <option value="">-- No Outer Trim --</option>
                        {trims.map(t => <option key={t.id} value={t.id}>{t.itemName}</option>)}
                    </select>
                    
                    {pillowData.outerTrim.trimId && (
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '5px' }}>
                            {['top', 'bottom', 'left', 'right'].map(edge => (
                                <label key={edge} style={{ fontSize: '0.75rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={pillowData.outerTrim[edge]} onChange={(e) => setPillowData({...pillowData, outerTrim: {...pillowData.outerTrim, [edge]: e.target.checked}})} />
                                    {edge.toUpperCase()}
                                </label>
                            ))}
                        </div>
                    )}

                    <div style={{ marginTop: '15px', borderTop: '1px solid #d4af37', paddingTop: '15px' }}>
                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold', display: 'block', marginBottom: '5px', color: '#28a745' }}>MAIN CONSTRUCTION STITCH:</label>
                        <select value={pillowData.stitch} onChange={e => setPillowData({...pillowData, stitch: e.target.value})} style={{ width: '100%', padding: '8px', border: '1px solid #28a745' }}>
                            <option value="">-- Select Main Stitch --</option>
                            {(globalLists.stitchTypes || []).filter(s => !s.toUpperCase().includes('FRINGE')).map(st => <option key={st} value={st}>{st}</option>)}
                        </select>
                    </div>
                </div>

            </div>

            <div style={{ padding: '15px', background: '#d9534f', color: '#fff', fontWeight: 'bold', fontSize: '0.9rem', borderTop: '2px solid #000' }}>SEWING FLOOR B.O.M</div>
            <div style={{ padding: '15px', fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '8px', background: '#fce4ec' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dotted #d9534f', paddingBottom: '5px' }}><span>Face / Back Cut (inc. seam):</span><strong>{w + 1}" x {h + 1}"</strong></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dotted #d9534f', paddingBottom: '5px' }}><span>Insert / Fill Required:</span><strong>{pillowData.size} ({pillowData.fill})</strong></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dotted #d9534f', paddingBottom: '5px' }}><span>Total Trim Yardage Req:</span><strong>{calculateTrimYards()} Yds</strong></div>
                <div style={{ marginTop: '10px' }}>
                    <button onClick={handlePushToCPQ} disabled={isPushingToCPQ} style={{ width: '100%', padding: '12px', background: isPushingToCPQ ? '#ccc' : '#28a745', color: '#fff', fontWeight: 'bold', border: '2px solid #1e7e34', cursor: isPushingToCPQ ? 'not-allowed' : 'pointer', fontSize: '1rem' }}>
                        {isPushingToCPQ ? "SAVING..." : "💾 PUSH TO CPQ"}
                    </button>
                </div>
            </div>
        </div>

        <div style={{ flex: 1, background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '10px 10px 0 #000' }}>
            <div style={{ padding: '10px 15px', background: '#e9ecef', borderBottom: '2px solid #000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
               <div style={{ display: 'flex', gap: '5px' }}>
                 <button onClick={() => setEngTool("pan")} style={{ padding: '6px 12px', background: engTool === "pan" ? '#000' : '#fff', color: engTool === "pan" ? '#fff' : '#000', border: '1px solid #000', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.8rem' }}>✋ PAN</button>
                 <button onClick={() => setEngTool("seam")} style={{ padding: '6px 12px', background: engTool === "seam" ? '#d9534f' : '#fff', color: engTool === "seam" ? '#fff' : '#000', border: '2px solid #d9534f', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.8rem' }}>✂️ DRAW SEAM</button>
                 <button onClick={() => setEngTool("tag")} style={{ padding: '6px 12px', background: engTool === "tag" ? '#007bff' : '#fff', color: engTool === "tag" ? '#fff' : '#000', border: '2px solid #007bff', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.8rem' }}>🏷️ TAG FABRIC</button>
                 <button onClick={() => { setPillowData(p => ({...p, seams: []})); setFabricTags([]); }} style={{ padding: '6px 12px', background: '#fff', border: '1px solid #ccc', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 'bold' }}>CLEAR CANVAS</button>
               </div>
               <div style={{ display: 'flex', gap: '5px' }}>
                  <button onClick={() => setVisScale(s => Math.min(s + 0.25, 4))} style={{ padding: '6px 12px', fontWeight: 'bold', cursor: 'pointer', border: '1px solid #000', background: '#fff' }}>➕</button>
                  <button onClick={() => setVisScale(s => Math.max(s - 0.25, 0.5))} style={{ padding: '6px 12px', fontWeight: 'bold', cursor: 'pointer', border: '1px solid #000', background: '#fff' }}>➖</button>
                  <button onClick={() => { setVisScale(1.0); setVisPan({x:0, y:0}); }} style={{ padding: '6px 12px', cursor: 'pointer', fontSize: '0.75rem', border: '1px solid #000', background: '#fff', fontWeight: 'bold' }}>RESET VIEW</button>
               </div>
            </div>
            
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#f8f9fa', minHeight: '650px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
               <svg ref={svgRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} viewBox="0 0 1000 600" style={{ width: '100%', height: '100%', display: 'block', cursor: engTool === 'pan' ? (isPanning?'grabbing':'crosshair') : (engTool === 'seam' ? 'crosshair' : 'default') }}>
                  <g ref={innerGroupRef} transform={`translate(${visPan.x}, ${visPan.y}) translate(500, 300) scale(${visScale}) translate(-500, -300)`}>
                    
                    {Array.from({ length: 15 }).map((_, i) => <line key={`h-${i}`} x1="0" y1={i * 40} x2="1000" y2={i * 40} stroke="#e0e0e0" strokeWidth="1" />)}
                    {Array.from({ length: 25 }).map((_, i) => <line key={`v-${i}`} x1={i * 40} y1="0" x2={i * 40} y2="600" stroke="#e0e0e0" strokeWidth="1" />)}
                    
                    <g>
                        <defs><clipPath id="pillowClip"><rect x={cX - W/2} y={cY - H/2} width={W} height={H} rx={20} /></clipPath></defs>
                        <g transform={`translate(${cX - W/2}, ${cY - H/2})`}>
                            <rect x="0" y="0" width={W} height={H} fill="#eafaf1" stroke="#e83e8c" strokeWidth="4" strokeDasharray={isRailroadMain ? '8,8' : 'none'} rx={20} />
                            {isFlange && <rect x={-pillowData.flangeSize * S*2} y={-pillowData.flangeSize * S*2} width={W + pillowData.flangeSize * S*4} height={H + pillowData.flangeSize * S*4} fill="none" stroke="#d9534f" strokeWidth="2" strokeDasharray="4,4" rx={25} opacity="0.8" />}
                            {renderOuterTrim(W, H)}
                        </g>
                        
                        <g clipPath="url(#pillowClip)">
                            {pillowData.seams.map(s => {
                                const isFringe = (s.treatment || '').toUpperCase().includes('FRINGE'); 
                                const isRR = (s.treatment || '').toUpperCase().includes('RAILROAD');
                                return (
                                    <g key={s.id}>
                                        <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="#000" strokeWidth="3" strokeDasharray={isRR ? "5,5" : "none"} />
                                        {isFringe && <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="#d4af37" strokeWidth="10" strokeDasharray="2,6" opacity="0.7" />}
                                    </g>
                                );
                            })}
                            
                            {drawStart && drawCurrent && engTool === 'seam' && <line x1={drawStart.x} y1={drawStart.y} x2={drawCurrent.x} y2={drawCurrent.y} stroke="#d9534f" strokeWidth="3" strokeDasharray="5,5" />}
                        </g>

                        {fabricTags.map(tag => (
                            <g key={tag.id}>
                                <circle cx={tag.x} cy={tag.y} r="3" fill="#007bff" />
                                <line x1={tag.x} y1={tag.y} x2={tag.x + 30} y2={tag.y - 40} stroke="#007bff" strokeWidth="1.5" />
                                <circle cx={tag.x + 30} cy={tag.y - 40} r="10" fill="#fff" stroke="#007bff" strokeWidth="2" />
                                <text x={tag.x + 30} y={tag.y - 36} fill="#007bff" fontSize="10" fontWeight="bold" textAnchor="middle">{tag.label}</text>
                            </g>
                        ))}

                        <text x={cX} y={cY - H/2 - 30} fill="#666" fontSize="14" fontWeight="bold" textAnchor="middle">{w}" x {h}"</text>
                        <text x={cX} y={cY - H/2 - 15} fill="#d9534f" fontSize="10" fontWeight="bold" textAnchor="middle">{isFlange ? `+ ${pillowData.flangeSize}" Flange` : 'Knife Edge'}</text>
                    </g>

                  </g>
               </svg>
            </div>
        </div>
    </div>
  );
};

export default VisionPillow;