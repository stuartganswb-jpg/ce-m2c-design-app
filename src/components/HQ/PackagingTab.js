import React, { useState } from 'react';

// --- MOCK DATABASE (Jobs passed from ERP/Fabrication) ---
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

const PackagingTab = () => {
  const [jobs, setJobs] = useState(MOCK_PACKAGING_QUEUE);
  const [activeJobId, setActiveJobId] = useState(MOCK_PACKAGING_QUEUE[0].jobId);
  const [foamBuffer, setFoamBuffer] = useState(0.5); // Inches of foam between parts

  const activeJob = jobs.find(j => j.jobId === activeJobId);

  // --- FAKE PACKING ALGORITHM ---
  // In production, you would use a "2D Bin Packing Algorithm" to automatically sort these arrays.
  const calculateLayout = () => {
      if (!activeJob) return [];
      let layout = [];
      let currentX = foamBuffer;
      
      // Pack the long pole at the top
      const pole = activeJob.items.find(i => i.type === 'extruded');
      if (pole) {
          layout.push({ ...pole, x: currentX, y: foamBuffer });
      }

      // Pack static hardware below the pole
      let hwX = foamBuffer;
      let hwY = foamBuffer * 2 + (pole ? pole.h : 0);
      
      activeJob.items.filter(i => i.type === 'static').forEach(item => {
          layout.push({ ...item, x: hwX, y: hwY });
          hwX += item.w + foamBuffer;
      });

      return layout;
  };

  const layout = calculateLayout();
  const S = 10; // SVG Scale multiplier for rendering

  // --- DXF GENERATION SIMULATION ---
  const handleExportDXF = () => {
      // 1. We construct a basic ASCII DXF payload from our layout array
      let dxfString = `0\nSECTION\n2\nENTITIES\n`;
      
      layout.forEach(item => {
          // Drawing rectangles for the laser cutter
          dxfString += `0\nLWPOLYLINE\n8\nCutLayer\n90\n4\n`; // Simplified DXF polyline header
          dxfString += `10\n${item.x}\n20\n${item.y}\n`;
          dxfString += `10\n${item.x + item.w}\n20\n${item.y}\n`;
          dxfString += `10\n${item.x + item.w}\n20\n${item.y + item.h}\n`;
          dxfString += `10\n${item.x}\n20\n${item.y + item.h}\n`;
      });
      dxfString += `0\nENDSEC\n0\nEOF\n`;

      // 2. Create a blob and force the browser to download it
      const blob = new Blob([dxfString], { type: 'application/dxf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${activeJob.jobId}_FOAM_CUT.dxf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      alert(`✅ Generated DXF File for LightBurn:\n\n${activeJob.jobId}_FOAM_CUT.dxf\n\nContains ${layout.length} precise laser-cut paths with a ${foamBuffer}" foam buffer.`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', fontFamily: 'monospace', backgroundColor: '#e5e5e5', minHeight: '100vh' }}>
      
      {/* HEADER */}
      <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '5px 5px 0 #000' }}>
        <div>
          <h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.4rem', color: '#007bff' }}>7. Packaging Module</h2>
          <span style={{ fontSize: '0.7rem', color: '#666' }}>CUSTOM FOAM INSERT GENERATION & SHIPPING</span>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <span style={{ fontWeight: 'bold', fontSize: '0.8rem', color: '#d9534f' }}>● LIGHTBURN INTEGRATION READY</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '25px', alignItems: 'stretch' }}>
        
        {/* LEFT PANEL: PACKING QUEUE */}
        <div style={{ width: '380px', display: 'flex', flexDirection: 'column', flexShrink: 0, background: '#fff', border: '2px solid #000', boxShadow: '8px 8px 0 rgba(0,0,0,0.1)' }}>
            <div style={{ padding: '12px 15px', background: '#000', color: '#fff', borderBottom: '2px solid #000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>📦 PACKING QUEUE</span>
            </div>
            
            <div style={{ padding: '15px', display: 'flex', flexDirection: 'column', gap: '10px', background: '#f8f9fa', minHeight: '600px' }}>
                {jobs.map(job => (
                    <div key={job.jobId} onClick={() => setActiveJobId(job.jobId)} style={{ background: job.jobId === activeJobId ? '#e6f2ff' : '#fff', border: `2px solid ${job.jobId === activeJobId ? '#007bff' : '#ccc'}`, padding: '12px', cursor: 'pointer' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                            <span style={{ fontWeight: 'bold', color: '#007bff' }}>{job.jobId}</span>
                            <span style={{ fontSize: '0.65rem', fontWeight: 'bold', background: '#ffc107', padding: '2px 5px' }}>{job.status}</span>
                        </div>
                        <div style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>{job.customer}</div>
                        <div style={{ fontSize: '0.7rem', color: '#666', marginTop: '5px' }}>Items: {job.items.length} | Box: {job.boxSize.id}</div>
                    </div>
                ))}
            </div>
        </div>

        {/* RIGHT PANEL: DXF VISUALIZER & EXPORT */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            {!activeJob ? (
                <div style={{ flex: 1, background: '#fff', border: '2px dashed #ccc', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontWeight: 'bold' }}>SELECT A JOB TO GENERATE PACKAGING</div>
            ) : (
                <div style={{ flex: 1, background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 #000' }}>
                    
                    {/* CONTROLS */}
                    <div style={{ padding: '15px', background: '#f4f4f4', borderBottom: '2px solid #000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                            <div>
                                <label style={{ fontSize: '0.65rem', fontWeight: 'bold', display: 'block' }}>ASSIGNED BOX:</label>
                                <select style={{ padding: '5px', fontSize: '0.8rem', fontWeight: 'bold' }} defaultValue={activeJob.boxSize.id}>
                                    <option value="BOX-A">Standard Long (90" x 8")</option>
                                    <option value="BOX-B">Oversize (120" x 10")</option>
                                </select>
                            </div>
                            <div>
                                <label style={{ fontSize: '0.65rem', fontWeight: 'bold', display: 'block' }}>FOAM BUFFER (IN):</label>
                                <input type="number" step="0.125" value={foamBuffer} onChange={e => setFoamBuffer(parseFloat(e.target.value)||0)} style={{ width: '60px', padding: '5px', fontSize: '0.8rem', fontWeight: 'bold' }} />
                            </div>
                        </div>
                        <button onClick={handleExportDXF} style={{ padding: '10px 20px', background: '#d9534f', color: '#fff', fontWeight: 'bold', border: '2px solid #000', cursor: 'pointer', boxShadow: '2px 2px 0 #000' }}>
                            ⬇️ EXPORT .DXF FOR LIGHTBURN
                        </button>
                    </div>

                    {/* SVG DXF VISUALIZER */}
                    <div style={{ padding: '10px', background: '#e9ecef', fontSize: '0.7rem', fontWeight: 'bold', color: '#666', borderBottom: '1px solid #ccc' }}>
                        LASER PATH PREVIEW (TOP DOWN)
                    </div>
                    <div style={{ flex: 1, background: '#222', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg viewBox={`0 0 ${activeJob.boxSize.w * S} ${activeJob.boxSize.h * S}`} style={{ width: '95%', height: 'auto', background: '#333', border: '4px solid #555' }}>
                            
                            {/* Grid Lines */}
                            {Array.from({ length: 20 }).map((_, i) => <line key={`v-${i}`} x1={i * 10 * S} y1="0" x2={i * 10 * S} y2={activeJob.boxSize.h * S} stroke="#444" strokeWidth="1" />)}
                            
                            {/* Foam Cutouts (The DXF Paths) */}
                            {layout.map((item, index) => (
                                <g key={index}>
                                    {/* The physical part inside the foam */}
                                    <rect x={item.x * S} y={item.y * S} width={item.w * S} height={item.h * S} fill="#888" opacity="0.5" />
                                    {/* The DXF Laser Path (Red) */}
                                    <rect x={item.x * S} y={item.y * S} width={item.w * S} height={item.h * S} fill="none" stroke="#ff0000" strokeWidth="2" strokeDasharray="4,2" />
                                    <text x={(item.x + item.w/2) * S} y={(item.y + item.h/2) * S + 4} fill="#fff" fontSize="8" fontWeight="bold" textAnchor="middle">{item.name}</text>
                                </g>
                            ))}
                        </svg>
                    </div>

                </div>
            )}

        </div>
      </div>
    </div>
  );
};

export default PackagingTab;