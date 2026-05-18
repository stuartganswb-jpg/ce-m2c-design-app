import React, { useState } from 'react';

const AdminTab = ({ currentUser, activeBrand }) => {
  const [activeSection, setActiveSection] = useState("DATA"); 
  
  const [users, setUsers] = useState([
    { id: 1, name: "STUART GANS", email: "stuart@example.com", role: "SUPER_ADMIN" },
    { id: 2, name: "ENGINEERING TEAM", email: "eng@example.com", role: "ENGINEER" },
    { id: 3, name: "SHOP FLOOR 1", email: "floor1@example.com", role: "OPERATOR" },
    { id: 4, name: "VENDOR A", email: "vendor@example.com", role: "VENDOR_EXTERNAL" }
  ]);

  // --- UPGRADED MASTER DATA (Finishes are now robust objects) ---
  const [masterData, setMasterData] = useState({
    finishes: [
      { id: "FIN-MB", name: "MATTE BRASS", description: "Standard warm brushed brass, clear coated.", hex: "#d4af37", multiplier: 1.0 },
      { id: "FIN-PN", name: "POLISHED NICKEL", description: "High gloss nickel plate over brass base.", hex: "#e8e8e8", multiplier: 1.1 },
      { id: "FIN-AB", name: "ANTIQUE BRONZE", description: "Hand-rubbed dark oil bronze finish.", hex: "#4a3728", multiplier: 1.15 },
      { id: "FIN-CM", name: "CHAMPAGNE METALLIC", description: "Soft gold/silver hybrid powder coat.", hex: "#d1c7b7", multiplier: 1.05 },
      { id: "FIN-RAW", name: "RAW / UNFINISHED", description: "Machine finish, no plating or coating.", hex: "#999999", multiplier: 0.8 },
      { id: "FIN-NA", name: "N/A", description: "Not applicable for this component.", hex: "#ffffff", multiplier: 1.0 }
    ],
    productTypes: ["HARDWARE", "TRIMMING", "LIGHTING", "TEXTILE", "JEWELRY", "PACKAGING", "RAW MATERIAL", "COMPONENT"],
    uom: ["EA", "FT", "MTR", "YD", "IN", "LB", "SET", "PAIR"],
    collections: ["HARLOW", "SIGNATURE", "COASTAL", "MODERN ARCHITECTURAL", "N/A"],
    watchlists: ["NONE", "FALL 26", "SPRING 27", "CRITICAL EXPEDITE", "DISCONTINUED RISK", "LONG LEAD TIME"],
    vendors: ["VEND-101 (ACME PLATING)", "VEND-202 (PRIME ASSEMBLY)", "VEND-303 (LUXURY TEXTILES CO.)", "VEND-404 (CUSTOM MACHINING)"],
    outsourceActions: ["FINISHING", "POLISHING", "ASSEMBLY", "WIRING", "SEWING"]
  });

  const [engineeringRules, setEngineeringRules] = useState({
    maxBracketSpacing: 48,
    defaultRingsPerFoot: 4,
    minimumCutLength: 12
  });

  // --- NEW: ROBUST FINISH FORM STATE ---
  const [newFinish, setNewFinish] = useState({ id: "", name: "", description: "", hex: "#000000", multiplier: "1.0" });
  const [newInputs, setNewInputs] = useState({ productType: "", watchlist: "", uom: "", collection: "", vendor: "", outsourceAction: "" });

  // --- MASTER DATA CRUD HANDLERS ---
  const handleAddFinish = () => {
    if (!newFinish.id.trim() || !newFinish.name.trim()) return alert("Finish ID and Name are required.");
    
    // Check for duplicate ID to protect relational integrity
    if (masterData.finishes.find(f => f.id === newFinish.id.toUpperCase())) {
      return alert("A finish with this ID already exists.");
    }

    const newItem = { 
      id: newFinish.id.toUpperCase(), 
      name: newFinish.name.toUpperCase(), 
      description: newFinish.description,
      hex: newFinish.hex,
      multiplier: parseFloat(newFinish.multiplier) || 1.0 
    };
    
    setMasterData({ ...masterData, finishes: [...masterData.finishes, newItem] });
    setNewFinish({ id: "", name: "", description: "", hex: "#000000", multiplier: "1.0" }); // Reset
  };

  const handleRemoveFinish = (id) => {
    setMasterData({ ...masterData, finishes: masterData.finishes.filter(f => f.id !== id) });
  };

  const handleAddSimpleItem = (category, inputKey) => {
    const val = newInputs[inputKey].trim().toUpperCase();
    if (!val) return;
    if (!masterData[category].includes(val)) {
      setMasterData({ ...masterData, [category]: [...masterData[category], val] });
    }
    setNewInputs({ ...newInputs, [inputKey]: "" });
  };

  const handleRemoveSimpleItem = (category, item) => {
    setMasterData({ ...masterData, [category]: masterData[category].filter(i => i !== item) });
  };

  // Danger Zone Actions
  const handleNukeAssemblies = async () => {
    const prompt = window.prompt('Type "DELETE ALL ASSEMBLIES" to confirm:');
    if (prompt === "DELETE ALL ASSEMBLIES") alert("INITIATING WIPEOUT: Deleting all Master Assemblies...");
  };

  const handleNukeLibrary = async () => {
    const prompt = window.prompt('Type "DELETE MASTER LIBRARY" to confirm:');
    if (prompt === "DELETE MASTER LIBRARY") alert("INITIATING WIPEOUT: Deleting all Master Library Inventory...");
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', fontFamily: 'monospace', backgroundColor: '#e5e5e5', minHeight: '100vh' }}>
      
      <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '5px 5px 0 #000' }}>
        <div>
          <h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.4rem' }}>11. System Administration</h2>
          <span style={{ fontSize: '0.7rem', color: '#666' }}>SUPERUSER ACCESS GRANTED: {currentUser}</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
        
        <div style={{ width: '250px', background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 #000', flexShrink: 0 }}>
          <div style={{ padding: '15px', background: '#000', color: '#fff', fontWeight: 'bold' }}>SYSTEM CONTROLS</div>
          <button onClick={() => setActiveSection("USERS")} style={{ padding: '15px', textAlign: 'left', background: activeSection === "USERS" ? '#f4f4f4' : '#fff', border: 'none', borderBottom: '1px solid #eee', fontWeight: 'bold', cursor: 'pointer', borderLeft: activeSection === "USERS" ? '4px solid #007bff' : '4px solid transparent' }}>👥 USER MATRIX</button>
          <button onClick={() => setActiveSection("DATA")} style={{ padding: '15px', textAlign: 'left', background: activeSection === "DATA" ? '#f4f4f4' : '#fff', border: 'none', borderBottom: '1px solid #eee', fontWeight: 'bold', cursor: 'pointer', borderLeft: activeSection === "DATA" ? '4px solid #007bff' : '4px solid transparent' }}>🗂️ MASTER DATA</button>
          <button onClick={() => setActiveSection("RULES")} style={{ padding: '15px', textAlign: 'left', background: activeSection === "RULES" ? '#f4f4f4' : '#fff', border: 'none', borderBottom: '1px solid #eee', fontWeight: 'bold', cursor: 'pointer', borderLeft: activeSection === "RULES" ? '4px solid #007bff' : '4px solid transparent' }}>📐 GLOBAL ENG RULES</button>
          <button onClick={() => setActiveSection("ERP")} style={{ padding: '15px', textAlign: 'left', background: activeSection === "ERP" ? '#f4f4f4' : '#fff', border: 'none', borderBottom: '1px solid #eee', fontWeight: 'bold', cursor: 'pointer', borderLeft: activeSection === "ERP" ? '4px solid #007bff' : '4px solid transparent' }}>🔄 ERP INTEGRATION</button>
          <button onClick={() => setActiveSection("DANGER")} style={{ padding: '15px', textAlign: 'left', background: activeSection === "DANGER" ? '#ffebee' : '#fff', color: '#d9534f', border: 'none', fontWeight: 'bold', cursor: 'pointer', borderLeft: activeSection === "DANGER" ? '4px solid #d9534f' : '4px solid transparent' }}>⚠️ DANGER ZONE</button>
        </div>

        <div style={{ flex: 1, background: '#fff', border: '2px solid #000', minHeight: '600px', boxShadow: '10px 10px 0 #000' }}>
          
          {/* USERS VIEW */}
          {activeSection === "USERS" && (
            <div style={{ padding: '30px' }}>
              <h3 style={{ marginTop: 0, borderBottom: '2px solid #000', paddingBottom: '10px' }}>USER ACCESS & PERMISSION MATRIX</h3>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '15px' }}>
                <button style={{ padding: '10px 15px', background: '#007bff', color: '#fff', fontWeight: 'bold', border: '2px solid #000', cursor: 'pointer' }}>+ INVITE NEW USER</button>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: '#eee' }}>
                    <th style={{ padding: '12px', borderBottom: '2px solid #000' }}>OPERATOR NAME</th>
                    <th style={{ padding: '12px', borderBottom: '2px solid #000' }}>EMAIL (SSO ID)</th>
                    <th style={{ padding: '12px', borderBottom: '2px solid #000' }}>SYSTEM ROLE</th>
                    <th style={{ padding: '12px', borderBottom: '2px solid #000' }}>STATUS</th>
                    <th style={{ padding: '12px', borderBottom: '2px solid #000' }}>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} style={{ borderBottom: '1px solid #ccc' }}>
                      <td style={{ padding: '12px', fontWeight: 'bold' }}>{u.name}</td>
                      <td style={{ padding: '12px', color: '#666' }}>{u.email}</td>
                      <td style={{ padding: '12px' }}>
                        <select value={u.role} onChange={() => {}} style={{ padding: '5px', fontWeight: 'bold', background: u.role === "SUPER_ADMIN" ? '#fff3cd' : '#fff' }}>
                          <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                          <option value="ENGINEER">ENGINEER</option>
                          <option value="OPERATOR">SHOP FLOOR OPERATOR</option>
                          <option value="VENDOR_EXTERNAL">EXTERNAL VENDOR</option>
                        </select>
                      </td>
                      <td style={{ padding: '12px', color: 'green', fontWeight: 'bold' }}>ACTIVE</td>
                      <td style={{ padding: '12px' }}><button style={{ cursor: 'pointer' }}>EDIT PERMS</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* FULL CRUD MASTER DATA VIEW */}
          {activeSection === "DATA" && (
            <div style={{ padding: '30px' }}>
              <h3 style={{ marginTop: 0, borderBottom: '2px solid #000', paddingBottom: '10px' }}>MASTER DATA DICTIONARIES</h3>
              <p style={{ color: '#666', fontSize: '0.85rem' }}>These lists populate global dropdowns across the platform. Ensure ERP IDs match your external systems.</p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '20px' }}>
                
                {/* --- UPGRADED FINISHES TABLE --- */}
                <div style={{ border: '2px solid #ccc', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ padding: '10px 15px', background: '#000', color: '#fff', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between' }}>
                    <span>FINISHES, COATINGS & PATINAS</span>
                    <span style={{ fontSize: '0.7rem' }}>DRIVES CPQ COLOR & PRICING</span>
                  </div>
                  
                  {/* The Finishes List */}
                  <div style={{ maxHeight: '300px', overflowY: 'auto', background: '#fff' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.8rem' }}>
                      <thead style={{ position: 'sticky', top: 0, background: '#eee', boxShadow: '0 2px 2px rgba(0,0,0,0.1)' }}>
                        <tr>
                          <th style={{ padding: '8px 10px', width: '30px' }}>CLR</th>
                          <th style={{ padding: '8px 10px', width: '100px' }}>FINISH ID</th>
                          <th style={{ padding: '8px 10px', width: '180px' }}>FINISH NAME</th>
                          <th style={{ padding: '8px 10px' }}>INTERNAL DESCRIPTION</th>
                          <th style={{ padding: '8px 10px', width: '80px', textAlign: 'center' }}>MULT (x)</th>
                          <th style={{ padding: '8px 10px', width: '40px', textAlign: 'center' }}>DEL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {masterData.finishes.map(f => (
                          <tr key={f.id} style={{ borderBottom: '1px solid #eee' }}>
                            <td style={{ padding: '8px 10px' }}>
                              <div style={{ width: '20px', height: '20px', background: f.hex, border: '1px solid #000', borderRadius: '50%' }}></div>
                            </td>
                            <td style={{ padding: '8px 10px', fontWeight: 'bold', color: '#007bff' }}>{f.id}</td>
                            <td style={{ padding: '8px 10px', fontWeight: 'bold' }}>{f.name}</td>
                            <td style={{ padding: '8px 10px', color: '#666' }}>{f.description}</td>
                            <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                              <input type="number" step="0.05" defaultValue={f.multiplier} style={{ width: '50px', padding: '3px', textAlign: 'center', border: '1px solid #ccc', fontWeight: 'bold' }} />
                            </td>
                            <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                              <span onClick={() => handleRemoveFinish(f.id)} style={{ cursor: 'pointer', color: '#d9534f', fontWeight: 'bold' }}>✖</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Add New Finish Form */}
                  <div style={{ background: '#f8f9fa', borderTop: '2px solid #ccc', padding: '15px' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '10px', color: '#007bff' }}>+ ADD NEW FINISH TO DATABASE:</div>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <input type="color" value={newFinish.hex} onChange={(e) => setNewFinish({...newFinish, hex: e.target.value})} style={{ width: '40px', height: '35px', cursor: 'pointer', border: '1px solid #000', padding: 0 }} title="CPQ Hex Color" />
                      <input value={newFinish.id} onChange={(e) => setNewFinish({...newFinish, id: e.target.value})} placeholder="ID (e.g. FIN-101)" style={{ width: '120px', padding: '8px', border: '1px solid #ccc' }} />
                      <input value={newFinish.name} onChange={(e) => setNewFinish({...newFinish, name: e.target.value})} placeholder="Finish Name" style={{ width: '180px', padding: '8px', border: '1px solid #ccc' }} />
                      <input value={newFinish.description} onChange={(e) => setNewFinish({...newFinish, description: e.target.value})} placeholder="Notes / Description" style={{ flex: 1, padding: '8px', border: '1px solid #ccc' }} />
                      <input type="number" step="0.05" value={newFinish.multiplier} onChange={(e) => setNewFinish({...newFinish, multiplier: e.target.value})} placeholder="Mult" style={{ width: '70px', padding: '8px', border: '1px solid #ccc', textAlign: 'center' }} title="Price Multiplier" />
                      <button onClick={handleAddFinish} style={{ padding: '8px 20px', background: '#000', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>SAVE</button>
                    </div>
                  </div>
                </div>

                {/* --- STANDARD GRID DICTIONARIES --- */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                  
                  {/* Product Types */}
                  <div style={{ border: '2px solid #ccc', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '10px', background: '#eee', fontWeight: 'bold', borderBottom: '2px solid #ccc' }}>PRODUCT TYPES</div>
                    <div style={{ padding: '10px', display: 'flex', flexWrap: 'wrap', gap: '5px', maxHeight: '120px', overflowY: 'auto' }}>
                      {masterData.productTypes.map(pt => (
                        <span key={pt} style={{ background: '#f4f4f4', padding: '5px 10px', border: '1px solid #ddd', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
                          {pt} <span onClick={() => handleRemoveSimpleItem('productTypes', pt)} style={{ color: '#d9534f', cursor: 'pointer', fontWeight: 'bold' }}>×</span>
                        </span>
                      ))}
                    </div>
                    <div style={{ display: 'flex', borderTop: '1px solid #ccc', marginTop: 'auto' }}>
                      <input value={newInputs.productType} onChange={(e) => setNewInputs({...newInputs, productType: e.target.value})} placeholder="New product type..." style={{ flex: 1, padding: '8px', border: 'none', outline: 'none' }} />
                      <button onClick={() => handleAddSimpleItem('productTypes', 'productType')} style={{ padding: '8px 15px', background: '#000', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>+</button>
                    </div>
                  </div>

                  {/* Watchlists */}
                  <div style={{ border: '2px solid #ccc', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '10px', background: '#eee', fontWeight: 'bold', borderBottom: '2px solid #ccc' }}>WATCHLIST TAGS</div>
                    <div style={{ padding: '10px', display: 'flex', flexWrap: 'wrap', gap: '5px', maxHeight: '120px', overflowY: 'auto' }}>
                      {masterData.watchlists.map(wl => (
                        <span key={wl} style={{ background: '#fff3cd', padding: '5px 10px', border: '1px solid #ffeeba', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '5px', color: '#856404' }}>
                          {wl} <span onClick={() => handleRemoveSimpleItem('watchlists', wl)} style={{ color: '#d9534f', cursor: 'pointer', fontWeight: 'bold' }}>×</span>
                        </span>
                      ))}
                    </div>
                    <div style={{ display: 'flex', borderTop: '1px solid #ccc', marginTop: 'auto' }}>
                      <input value={newInputs.watchlist} onChange={(e) => setNewInputs({...newInputs, watchlist: e.target.value})} placeholder="New watchlist tag..." style={{ flex: 1, padding: '8px', border: 'none', outline: 'none' }} />
                      <button onClick={() => handleAddSimpleItem('watchlists', 'watchlist')} style={{ padding: '8px 15px', background: '#000', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>+</button>
                    </div>
                  </div>

                  {/* UOM and Collections (Side by Side) */}
                  <div style={{ display: 'flex', gap: '10px', gridColumn: 'span 2' }}>
                    {/* UOM */}
                    <div style={{ flex: 1, border: '2px solid #ccc', display: 'flex', flexDirection: 'column' }}>
                      <div style={{ padding: '10px', background: '#eee', fontWeight: 'bold', borderBottom: '2px solid #ccc', fontSize: '0.8rem' }}>UOMs</div>
                      <div style={{ padding: '10px', display: 'flex', flexWrap: 'wrap', gap: '5px', maxHeight: '100px', overflowY: 'auto' }}>
                        {masterData.uom.map(u => (
                           <span key={u} style={{ background: '#f4f4f4', padding: '3px 6px', border: '1px solid #ddd', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
                             {u} <span onClick={() => handleRemoveSimpleItem('uom', u)} style={{ color: '#d9534f', cursor: 'pointer' }}>×</span>
                           </span>
                        ))}
                      </div>
                      <div style={{ display: 'flex', borderTop: '1px solid #ccc', marginTop: 'auto' }}>
                        <input value={newInputs.uom} onChange={(e) => setNewInputs({...newInputs, uom: e.target.value})} placeholder="Add UOM..." style={{ flex: 1, padding: '6px', border: 'none', outline: 'none', fontSize: '0.7rem' }} />
                        <button onClick={() => handleAddSimpleItem('uom', 'uom')} style={{ padding: '6px 10px', background: '#000', color: '#fff', border: 'none', cursor: 'pointer' }}>+</button>
                      </div>
                    </div>
                    {/* COLLECTIONS */}
                    <div style={{ flex: 1, border: '2px solid #ccc', display: 'flex', flexDirection: 'column' }}>
                      <div style={{ padding: '10px', background: '#eee', fontWeight: 'bold', borderBottom: '2px solid #ccc', fontSize: '0.8rem' }}>COLLECTIONS</div>
                      <div style={{ padding: '10px', display: 'flex', flexWrap: 'wrap', gap: '5px', maxHeight: '100px', overflowY: 'auto' }}>
                        {masterData.collections.map(c => (
                           <span key={c} style={{ background: '#f4f4f4', padding: '3px 6px', border: '1px solid #ddd', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
                             {c} <span onClick={() => handleRemoveSimpleItem('collections', c)} style={{ color: '#d9534f', cursor: 'pointer' }}>×</span>
                           </span>
                        ))}
                      </div>
                      <div style={{ display: 'flex', borderTop: '1px solid #ccc', marginTop: 'auto' }}>
                        <input value={newInputs.collection} onChange={(e) => setNewInputs({...newInputs, collection: e.target.value})} placeholder="Add Collection..." style={{ flex: 1, padding: '6px', border: 'none', outline: 'none', fontSize: '0.7rem' }} />
                        <button onClick={() => handleAddSimpleItem('collections', 'collection')} style={{ padding: '6px 10px', background: '#000', color: '#fff', border: 'none', cursor: 'pointer' }}>+</button>
                      </div>
                    </div>
                  </div>

                </div>

              </div>

              {/* LOGISTICS & OUTSOURCING */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: '20px' }}>
                {/* Vendors */}
                <div style={{ border: '2px solid #6f42c1', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ padding: '10px', background: '#f3e5f5', color: '#6f42c1', fontWeight: 'bold', borderBottom: '2px solid #6f42c1' }}>APPROVED OUTSOURCE VENDORS</div>
                  <div style={{ padding: '10px', display: 'flex', flexWrap: 'wrap', gap: '5px', maxHeight: '150px', overflowY: 'auto' }}>
                    {masterData.vendors.map(v => (
                      <span key={v} style={{ background: '#fff', padding: '5px 10px', border: '1px solid #6f42c1', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        {v} <span onClick={() => handleRemoveSimpleItem('vendors', v)} style={{ color: '#d9534f', cursor: 'pointer', fontWeight: 'bold' }}>×</span>
                      </span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', borderTop: '1px solid #6f42c1', marginTop: 'auto' }}>
                    <input value={newInputs.vendor} onChange={(e) => setNewInputs({...newInputs, vendor: e.target.value})} placeholder="e.g. VEND-505 (NEW COMPANY)" style={{ flex: 1, padding: '8px', border: 'none', outline: 'none' }} />
                    <button onClick={() => handleAddSimpleItem('vendors', 'vendor')} style={{ padding: '8px 15px', background: '#6f42c1', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>+</button>
                  </div>
                </div>

                {/* Outsource Actions */}
                <div style={{ border: '2px solid #6f42c1', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ padding: '10px', background: '#f3e5f5', color: '#6f42c1', fontWeight: 'bold', borderBottom: '2px solid #6f42c1' }}>OUTSOURCE ACTIONS / PURPOSES</div>
                  <div style={{ padding: '10px', display: 'flex', flexWrap: 'wrap', gap: '5px', maxHeight: '150px', overflowY: 'auto' }}>
                    {masterData.outsourceActions.map(a => (
                      <span key={a} style={{ background: '#fff', padding: '5px 10px', border: '1px solid #6f42c1', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        {a} <span onClick={() => handleRemoveSimpleItem('outsourceActions', a)} style={{ color: '#d9534f', cursor: 'pointer', fontWeight: 'bold' }}>×</span>
                      </span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', borderTop: '1px solid #6f42c1', marginTop: 'auto' }}>
                    <input value={newInputs.outsourceAction} onChange={(e) => setNewInputs({...newInputs, outsourceAction: e.target.value})} placeholder="e.g. POWDER COATING" style={{ flex: 1, padding: '8px', border: 'none', outline: 'none' }} />
                    <button onClick={() => handleAddSimpleItem('outsourceActions', 'outsourceAction')} style={{ padding: '8px 15px', background: '#6f42c1', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>+</button>
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* GLOBAL RULES VIEW */}
          {activeSection === "RULES" && (
            <div style={{ padding: '30px' }}>
              <h3 style={{ marginTop: 0, borderBottom: '2px solid #000', paddingBottom: '10px', color: '#007bff' }}>GLOBAL ENGINEERING & CPQ RULES</h3>
              <p style={{ color: '#666', fontSize: '0.85rem' }}>These parameters act as the default math fallbacks for the CPQ and Shop Floor Drawing engines.</p>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: '20px' }}>
                <div style={{ background: '#f8f9fa', padding: '20px', border: '1px solid #ccc' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>MAX BRACKET SPACING (INCHES):</label>
                  <p style={{ fontSize: '0.7rem', color: '#666', marginTop: 0 }}>Auto-calculates the required number of brackets in a CPQ quote based on pole length.</p>
                  <input type="number" defaultValue={engineeringRules.maxBracketSpacing} style={{ width: '100%', padding: '12px', border: '2px solid #007bff', fontSize: '1.2rem', fontWeight: 'bold' }} />
                </div>

                <div style={{ background: '#f8f9fa', padding: '20px', border: '1px solid #ccc' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>DEFAULT RINGS PER FOOT:</label>
                  <p style={{ fontSize: '0.7rem', color: '#666', marginTop: 0 }}>The baseline starting value for CPQ ring calculations.</p>
                  <input type="number" defaultValue={engineeringRules.defaultRingsPerFoot} style={{ width: '100%', padding: '12px', border: '2px solid #007bff', fontSize: '1.2rem', fontWeight: 'bold' }} />
                </div>
              </div>
              <button style={{ marginTop: '20px', padding: '15px 30px', background: '#000', color: '#fff', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>SAVE GLOBAL RULES</button>
            </div>
          )}

          {/* ERP VIEW */}
          {activeSection === "ERP" && (
            <div style={{ padding: '30px' }}>
              <h3 style={{ marginTop: 0, borderBottom: '2px solid #000', paddingBottom: '10px' }}>ERP PUSH / PULL INTEGRATION</h3>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: '20px' }}>
                <div style={{ background: '#f8f9fa', border: '2px dashed #007bff', padding: '20px', textAlign: 'center' }}>
                  <h4 style={{ margin: '0 0 10px 0', color: '#007bff' }}>⬇️ IMPORT FROM ERP (CSV)</h4>
                  <p style={{ fontSize: '0.8rem', color: '#666', marginBottom: '20px' }}>Drag and drop a master inventory CSV to bulk-upload components into Tab 4.</p>
                  <button style={{ padding: '10px 20px', background: '#fff', border: '2px solid #007bff', color: '#007bff', fontWeight: 'bold', cursor: 'pointer' }}>SELECT CSV FILE</button>
                </div>
                
                <div style={{ background: '#f8f9fa', border: '2px dashed #28a745', padding: '20px', textAlign: 'center' }}>
                  <h4 style={{ margin: '0 0 10px 0', color: '#28a745' }}>⬆️ EXPORT TO ERP (CSV)</h4>
                  <p style={{ fontSize: '0.8rem', color: '#666', marginBottom: '20px' }}>Download a fully formatted CSV of all Approved Master Assemblies and BOM routing structures.</p>
                  <button style={{ padding: '10px 20px', background: '#28a745', border: 'none', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}>GENERATE EXPORT FILE</button>
                </div>
              </div>
            </div>
          )}

          {/* DANGER ZONE VIEW */}
          {activeSection === "DANGER" && (
            <div style={{ padding: '30px' }}>
              <h3 style={{ marginTop: 0, borderBottom: '2px solid #d9534f', paddingBottom: '10px', color: '#d9534f' }}>⚠️ DANGER ZONE (DATAFLASH)</h3>
              <p style={{ color: '#000', fontWeight: 'bold', background: '#ffc107', padding: '10px' }}>
                ACTIONS TAKEN HERE ARE PERMANENT. THEY WILL IMMEDIATELY WIPE FIREBASE DATA. DO NOT USE IN PRODUCTION.
              </p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '30px' }}>
                <div style={{ border: '2px solid #d9534f', padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h4 style={{ margin: '0 0 5px 0' }}>WIPE ALL MASTER ASSEMBLIES</h4>
                    <span style={{ fontSize: '0.8rem', color: '#666' }}>Deletes all data from Tab 1 and Tab 2, including routing.</span>
                  </div>
                  <button onClick={handleNukeAssemblies} style={{ padding: '15px', background: '#d9534f', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>NUKE ASSEMBLIES</button>
                </div>

                <div style={{ border: '2px solid #d9534f', padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h4 style={{ margin: '0 0 5px 0' }}>WIPE MASTER INVENTORY LIBRARY</h4>
                    <span style={{ fontSize: '0.8rem', color: '#666' }}>Deletes all standalone parts from Tab 4. Will break active BOMs.</span>
                  </div>
                  <button onClick={handleNukeLibrary} style={{ padding: '15px', background: '#d9534f', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>NUKE INVENTORY</button>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default AdminTab;